/**
 * @description: Cesium quantized-mesh 地形格式解析器
 * https://github.com/CesiumGS/quantized-mesh
 *
 * 二进制布局：
 * - Header 88 bytes：Center(3×f64)、MinimumHeight/MaximumHeight(2×f32)、
 *   BoundingSphere(center 3×f64 + radius f64)、HorizonOcclusionPoint(3×f64)
 * - vertexCount(ui32) → u/v/height 各 vertexCount 个 ui16（zig-zag 增量编码）
 * - triangleCount(ui32) → 索引（high-water-mark 编码；vertexCount>65536 用 ui32 否则 ui16）
 * - EdgeIndices（west/south/east/north 各 ui32 计数 + 索引数组）
 * - 可选 Extensions（ui8 id + ui32 length + data），本加载器跳过
 *
 * 字节序：规范为大端（Cesium ion / AWS），但部分服务（如 Mars3D）输出
 * 整个文件为小端。由调用方通过 littleEndian 参数显式指定（本加载器不做
 * 自动检测）。注意 Center 字段是 ECEF 笛卡尔坐标（非经纬度），本加载器
 * 不依赖它，顶点经纬度由瓦片坐标算出的 bounds 插值得到。
 *
 * 顶点解码：u/32767 线性插值经度（u=0 西、u=32767 东），v/32767 插值纬度
 * （v=0 南、v=32767 北），height 在 [MinimumHeight, MaximumHeight] 插值。
 *
 * 本加载器输出服务瓦片 TIN（经纬度+高程顶点 + 三角形），供 TileLoader 在
 * 本地瓦片建立 mercator 均匀规则网格后经 TIN 插值取高程（保证相邻瓦片
 * 共享边网格点物理重合、无裂缝，且复用现有 Martini 地形管线）。
 */

/**
 * 解码后的 quantized-mesh 瓦片数据
 */
export interface QuantizedMeshTileData {
	/** 顶点经度（度，索引对齐 lon/lat/height） */
	lon: Float32Array;
	/** 顶点纬度（度） */
	lat: Float32Array;
	/** 顶点高程（米） */
	height: Float32Array;
	/** 三角形索引（3 的倍数） */
	triangles: Uint32Array;
	/** 服务瓦片经纬度边界 [west, south, east, north] */
	bounds: [number, number, number, number];
	/** 服务瓦片顶点经纬度范围（用于经度桶裁剪） */
	lonMin: number;
	lonMax: number;
	latMin: number;
	latMax: number;
}

/** 经度桶：每桶存 bbox 经度范围覆盖该桶的三角形索引（加速插值定位） */
interface LonBucket {
	lonMin: number;
	lonMax: number;
	latMin: number;
	latMax: number;
	triangles: number[];
}

/**
 * quantized-mesh 解析器
 */
export class QuantizedMeshLoader {
	/** 经度桶数量（插值加速：每桶三角形数 ≈ T/64） */
	private static readonly BUCKET_COUNT = 64;

	/**
	 * 解码 quantized-mesh 二进制数据
	 * @param buffer 瓦片二进制
	 * @param bounds 服务瓦片经纬度边界 [west, south, east, north]（由瓦片坐标算出）
	 * @param littleEndian 是否小端字节序（默认 false = 规范大端；Mars3D 等部分服务为 true）
	 * @returns 解码后的 TIN 数据
	 */
	public static decode(
		buffer: ArrayBuffer,
		bounds: [number, number, number, number],
		littleEndian: boolean = false
	): QuantizedMeshTileData {
		const view = new DataView(buffer);
		const le = littleEndian;
		let offset = 0;

		// ---- Header ----
		// Center（3×f64，ECEF 坐标，本加载器不使用）
		offset += 24;
		// MinimumHeight / MaximumHeight（2×f32）
		const minHeight = view.getFloat32(offset, le);
		const maxHeight = view.getFloat32(offset + 4, le);
		offset += 8;
		// BoundingSphere（center 3×f64 + radius f64）
		offset += 32;
		// HorizonOcclusionPoint（3×f64）
		offset += 24;

		// ---- VertexData ----
		const vertexCount = view.getUint32(offset, le);
		offset += 4;

		const rawU = new Uint16Array(vertexCount);
		const rawV = new Uint16Array(vertexCount);
		const rawH = new Uint16Array(vertexCount);

		for (let i = 0; i < vertexCount; i++) {
			rawU[i] = view.getUint16(offset, le);
			offset += 2;
		}
		for (let i = 0; i < vertexCount; i++) {
			rawV[i] = view.getUint16(offset, le);
			offset += 2;
		}
		for (let i = 0; i < vertexCount; i++) {
			rawH[i] = view.getUint16(offset, le);
			offset += 2;
		}

		const [west, south, east, north] = bounds;
		const lon = new Float32Array(vertexCount);
		const lat = new Float32Array(vertexCount);
		const height = new Float32Array(vertexCount);
		const hScale = (maxHeight - minHeight) / 32767;

		let su = 0, sv = 0, sh = 0;
		for (let i = 0; i < vertexCount; i++) {
			// zig-zag 增量解码
			su += zigZagDecode(rawU[i]);
			sv += zigZagDecode(rawV[i]);
			sh += zigZagDecode(rawH[i]);
			// clamp 到合法范围（量化边界）
			const u = clampInt(su, 0, 32767);
			const v = clampInt(sv, 0, 32767);
			const h = clampInt(sh, 0, 32767);
			lon[i] = west + (u / 32767) * (east - west);
			lat[i] = south + (v / 32767) * (north - south);
			height[i] = minHeight + h * hScale;
		}

		// ---- IndexData（high-water-mark 编码）----
		const triangleCount = view.getUint32(offset, le);
		offset += 4;
		const indexCount = triangleCount * 3;
		const use32 = vertexCount > 65536;
		const indices = new Uint32Array(indexCount);
		let highest = 0;
		const idxSize = use32 ? 4 : 2;
		for (let i = 0; i < indexCount; i++) {
			const code = use32 ? view.getUint32(offset, le) : view.getUint16(offset, le);
			offset += idxSize;
			// high-water-mark 解码：
			//   code == highest → 当前水印（并递增）
			//   code <  highest → 已出现过的索引
			//   code >  highest → 新索引 code-1（并递增水印）
			if (code === highest) {
				indices[i] = highest;
				highest++;
			} else if (code < highest) {
				indices[i] = code;
			} else {
				indices[i] = code - 1;
				highest++;
			}
		}

		// ---- EdgeIndices（本加载器不直接使用，跳过；裙边由 Martini 边界检测承担）----
		// 边索引宽度与三角形索引一致（vc≤65536 用 ui16，否则 ui32）。必须按正确
		// 宽度跳过，否则下一段 count 读错位产生垃圾值 → 越界。规范实现（Cesium
		// ion/AWS）为 ui32，Mars3D 等变体为 ui16，统一按 idxSize 跳过即可。
		for (let e = 0; e < 4; e++) {
			const count = view.getUint32(offset, le);
			offset += 4 + count * idxSize;
		}

		// ---- Extensions（跳过）----

		// 顶点/三角形经纬度范围
		let lonMin = Infinity, lonMax = -Infinity;
		let latMin = Infinity, latMax = -Infinity;
		for (let i = 0; i < vertexCount; i++) {
			if (lon[i] < lonMin) lonMin = lon[i];
			if (lon[i] > lonMax) lonMax = lon[i];
			if (lat[i] < latMin) latMin = lat[i];
			if (lat[i] > latMax) latMax = lat[i];
		}

		return { lon, lat, height, triangles: indices, bounds, lonMin, lonMax, latMin, latMax };
	}

	/**
	 * 在服务 TIN 上插值指定经纬度的高程（重心坐标）。
	 * 用经度桶预筛候选三角形，再逐三角形点测试。
	 * @param data 解码后的 TIN
	 * @param lon 经度（度）
	 * @param lat 纬度（度）
	 * @param buckets 预建经度桶（可由 sampleGrid 一次性构建复用）
	 * @returns 插值高程（米）；未命中任何三角形返回 0
	 */
	public static interpolate(
		data: QuantizedMeshTileData,
		lon: number,
		lat: number,
		buckets: LonBucket[]
	): number {
		// 定位经度桶（±1 邻桶以覆盖 bbox 边界）
		const lonT = (lon - data.lonMin) / (data.lonMax - data.lonMin || 1);
		const b = Math.min(
			QuantizedMeshLoader.BUCKET_COUNT - 1,
			Math.max(0, Math.floor(lonT * QuantizedMeshLoader.BUCKET_COUNT))
		);
		const { triangles } = data;

		for (let bi = Math.max(0, b - 1); bi <= Math.min(b + 1, QuantizedMeshLoader.BUCKET_COUNT - 1); bi++) {
			const bucket = buckets[bi];
			if (lat < bucket.latMin - 0.1 || lat > bucket.latMax + 0.1) continue;
			for (let t = 0; t < bucket.triangles.length; t++) {
				const tri = bucket.triangles[t];
				const i0 = triangles[tri];
				const i1 = triangles[tri + 1];
				const i2 = triangles[tri + 2];
				const h = pointInTriangle(
					lon, lat,
					data.lon[i0], data.lat[i0],
					data.lon[i1], data.lat[i1],
					data.lon[i2], data.lat[i2],
					data.height[i0], data.height[i1], data.height[i2]
				);
				if (h !== null) return h;
			}
		}
		return 0;
	}

	/**
	 * 构建经度桶索引（供批量插值复用）
	 * @param data 解码后的 TIN
	 * @returns 经度桶数组
	 */
	public static buildBuckets(data: QuantizedMeshTileData): LonBucket[] {
		const { triangles, lon, lat } = data;
		const buckets: LonBucket[] = [];
		for (let i = 0; i < QuantizedMeshLoader.BUCKET_COUNT; i++) {
			buckets.push({
				lonMin: Infinity,
				lonMax: -Infinity,
				latMin: Infinity,
				latMax: -Infinity,
				triangles: [],
			});
		}
		const span = data.lonMax - data.lonMin || 1;
		for (let t = 0; t < triangles.length; t += 3) {
			const i0 = triangles[t], i1 = triangles[t + 1], i2 = triangles[t + 2];
			const lonMin = Math.min(lon[i0], lon[i1], lon[i2]);
			const lonMax = Math.max(lon[i0], lon[i1], lon[i2]);
			const latMin = Math.min(lat[i0], lat[i1], lat[i2]);
			const latMax = Math.max(lat[i0], lat[i1], lat[i2]);
			const b0 = Math.min(
				QuantizedMeshLoader.BUCKET_COUNT - 1,
				Math.max(0, Math.floor(((lonMin - data.lonMin) / span) * QuantizedMeshLoader.BUCKET_COUNT))
			);
			const b1 = Math.min(
				QuantizedMeshLoader.BUCKET_COUNT - 1,
				Math.max(0, Math.floor(((lonMax - data.lonMin) / span) * QuantizedMeshLoader.BUCKET_COUNT))
			);
			for (let bi = b0; bi <= b1; bi++) {
				const bucket = buckets[bi];
				bucket.triangles.push(t);
				if (lonMin < bucket.lonMin) bucket.lonMin = lonMin;
				if (lonMax > bucket.lonMax) bucket.lonMax = lonMax;
				if (latMin < bucket.latMin) bucket.latMin = latMin;
				if (latMax > bucket.latMax) bucket.latMax = latMax;
			}
		}
		return buckets;
	}
}

/**
 * zig-zag 解码：无符号 → 有符号（(n>>1) ^ -(n&1)）
 */
function zigZagDecode(n: number): number {
	return (n >> 1) ^ -(n & 1);
}

/**
 * 整数 clamp
 */
function clampInt(v: number, min: number, max: number): number {
	return v < min ? min : v > max ? max : v;
}

/**
 * 点在三角形内（经纬度 2D 叉积测试）且返回重心插值高程；不在则返回 null。
 */
function pointInTriangle(
	px: number, py: number,
	ax: number, ay: number,
	bx: number, by: number,
	cx: number, cy: number,
	ha: number, hb: number, hc: number
): number | null {
	// 叉积符号（三角形逆时针，quantized-mesh 默认 CCW）
	const v0x = cx - ax, v0y = cy - ay;
	const v1x = bx - ax, v1y = by - ay;
	const v2x = px - ax, v2y = py - ay;

	const dot00 = v0x * v0x + v0y * v0y;
	const dot01 = v0x * v1x + v0y * v1y;
	const dot02 = v0x * v2x + v0y * v2y;
	const dot11 = v1x * v1x + v1y * v1y;
	const dot12 = v1x * v2x + v1y * v2y;

	const invDenom = dot00 * dot11 - dot01 * dot01;
	// 退化三角形（近共线）
	if (invDenom === 0) return null;

	const u = (dot11 * dot02 - dot01 * dot12) / invDenom;
	const v = (dot00 * dot12 - dot01 * dot02) / invDenom;

	// 含边界（端点容差）
	if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) {
		return ha + u * (hb - ha) + v * (hc - ha);
	}
	return null;
}
