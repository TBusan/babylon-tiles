/**
 * @description: 内置几何体加载器（地形底图：terrain-rgb / lerc / quantized-mesh）
 * @author: Babylon-Tile Team
 *
 * 三个 loader 是核心渲染能力（地形底图），经 LoaderFactory 注册后与插件 loader
 * 走同一分发路径（TileLoader.loadGeometry → getGeometryLoader(demSource.dataType)）。
 *
 * 逻辑逐行提炼自 TileLoader.loadGeometry 硬编码三分支，行为保持一致：
 * - terrain-rgb：超采样（k/shift 裁父级 maxLevel 瓦片子区域）→ WorkerPool/主线程解析
 *   → Martini 自适应三角网 / 固定分段回退 / 平瓦片兜底
 * - lerc：lerc 解码 → 子区域裁剪 → Martini
 * - quantized-mesh：服务瓦片 TIN 解码合并 → 本地 mercator 均匀网格重采样 → Martini
 *
 * 设计约定（与 TileMaterialLoaders 一致）：
 * - 无状态单例：不绑定具体 Scene/Projection，scene/projection 从 load(params) 取。
 * - worldScale = bounds[2] - bounds[0]，等价于 projection.mapWidth / 2^z
 *   （getProjBoundsFromXYZ 返回瓦片宽度 = mapWidth/2^z，与投影 lon0 无关），
 *   因此内置几何 loader 不绑定投影即可复用，仅 quantized-mesh 需要 projection.unProject。
 * - 默认配置（terrainSegments=64/martiniMaxError=10/useMartini=true/useWorkerParse=true）
 *   与 three-tile 默认一致；多地图场景不互相污染。
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh';

import type { ISource } from '../source/ISource.js';
import type {
	ITileGeometryLoader,
	TileSourceLoadParamsType,
	ITileLoaderInfo,
} from './ITileLoaders.js';
import { TileGeometry, getBoundarySkirtEdges } from '../geometry/TileGeometry.js';
import { resolveMartiniMaxError } from '../geometry/terrainError.js';
import { TerrainRGBParser } from './TerrainRGBLoader.js';
import { TerrainWorkerPool } from './WorkerPool.js';
import { LercTerrainLoader } from './LercTerrainLoader.js';
import {
	QuantizedMeshLoader,
	QuantizedMeshTileData,
} from './QuantizedMeshLoader.js';

/** 共享的瓦片 UV 边缘出血量（与 TileLoader 一致） */
const TILE_UV_BLEED = 2 / 256;

/**
 * Terrain-RGB 地形几何体加载器（核心底图能力）
 * 读取 standard terrain-rgb 高程瓦片（RGB 编码）→ 解析为 Float32 高程 →
 * Martini RTIN 自适应三角网。支持超采样（z > maxLevel 裁父级瓦片子区域）、
 * Worker 池解析、非正方形 DEM 的固定分段回退。
 */
export class TerrainRGBGeometryLoader implements ITileGeometryLoader<Mesh> {
	/** 标识为几何体加载器 */
	public readonly isMaterialLoader = false;

	/** 加载器信息 */
	public readonly info: ITileLoaderInfo = {
		version: '1.0.0',
		author: 'Babylon-Tile Team',
		description: 'Standard terrain-rgb DEM tile loader',
	};

	/** 数据类型标识 */
	public readonly dataType = 'terrain-rgb';

	/** 地形瓦片分段数（默认 64，平衡精度与性能） */
	public terrainSegments: number = 64;

	/** Martini 参考误差（米），默认 10 */
	public martiniMaxError: number = 10;

	/** 是否使用 Martini 自适应三角网（默认 true，需要 DEM 为 2^n+1 尺寸） */
	public useMartini: boolean = true;

	/** 是否使用 Worker 池解析地形数据（默认 true，避免阻塞主线程） */
	public useWorkerParse: boolean = true;

	/** 调试标志（>0 时输出加载告警） */
	public debug = 0;

	/**
	 * 加载 terrain-rgb 地形网格
	 * @param params - 加载参数（含 source/coords/bounds/scene）
	 * @returns 地形网格；无 URL 时返回 undefined（回退平瓦片）
	 */
	public async load(params: TileSourceLoadParamsType): Promise<Mesh | undefined> {
		const { source, x, y, z, bounds, scene } = params;
		if (!scene) {
			throw new Error('TerrainRGBGeometryLoader: scene not provided in params');
		}

		// DEM 超采样：z 超过 source.maxLevel 时，取父级 maxLevel 瓦片并裁剪本瓦片的子区域，
		// 地形延续到更深层级，避免深缩放"突然变平"
		const demZ = Math.min(z, source.maxLevel);
		const k = z - demZ;
		const shift = 1 << k; // k=0 时为 1（未超采样），URL 即本瓦片
		const demX = Math.floor(x / shift);
		const demY = Math.floor(y / shift);
		const url = source.getUrl(demX, demY, demZ);
		if (!url) {
			return undefined; // 无 URL：回退平瓦片
		}

		const imgData = await this._loadImageData(url);

		// 使用 Worker 池或主线程解析地形数据
		let dem = this.useWorkerParse
			? await TerrainWorkerPool.parse(imgData)
			: TerrainRGBParser.parse(imgData);

		if (k > 0) {
			dem = this._cropDemQuadrant(
				dem,
				k,
				x - demX * shift, // 本瓦片在父瓦片内的列象限（向东递增）
				y - demY * shift  // 行象限（向南递增）
			);
		}

		// DEM 高程为原始米制（与 three-tile 一致），直接使用，无需缩放
		const heightScale = 1;
		const skirtHeight = 100; // 米制裙边高度

		// 瓦片世界尺寸缩放系数 S = mapWidth / 2^z（米/瓦片单位），等价于 bounds 宽度。
		// 瓦片几何位于倾斜局部空间（X/Z 单位 1、Y 米制），而节点世界矩阵为 diag(S,1,S)。
		// 计算法线时必须先在"S 倍"的世界尺寸空间做（否则 X/Z 跨度 ~1/256 会把法线压成
		// 水平），并据此映射回局部空间存储。
		const worldScale = bounds[2] - bounds[0];

		// 检查 DEM 数据是否为 2^n+1 尺寸（Martini 要求）
		const gridSize = Math.floor(Math.sqrt(dem.length));
		const isPerfectSquare = gridSize * gridSize === dem.length;
		const isMartiniCompatible =
			this.useMartini &&
			isPerfectSquare &&
			((gridSize - 1) & (gridSize - 2)) === 0; // 2^n+1 检测

		if (isMartiniCompatible) {
			// 使用 Martini RTIN 自适应三角网
			// maxError 按瓦片尺寸缩放：固定绝对米制误差会让低层级大瓦片细化到满分辨率
			// （单瓦片 6 万+ 顶点 → 帧率骤降）。用相对瓦片尺寸的误差控制顶点预算。
			const maxError = resolveMartiniMaxError(z, worldScale, this.martiniMaxError, { gridSize });
			return TileGeometry.createMartiniTile(
				`tile-${z}-${x}-${y}-geometry`,
				scene,
				dem,
				maxError,
				skirtHeight,
				heightScale,
				worldScale,
				getBoundarySkirtEdges(x, y, z)
			);
		}

		// 回退：DEM 非正方形时无法确定行距，降级为平瓦片（防御性兜底）
		if (!isPerfectSquare) {
			if (this.debug > 0) {
				console.warn(`DEM data is not square (length=${dem.length}), fallback to flat tile.`);
			}
			return TileGeometry.createFlatTile(
				`tile-${z}-${x}-${y}-geometry`,
				scene,
				1,
				1,
				TILE_UV_BLEED
			);
		}

		// 回退：使用固定分段网格
		// DEM 为 gridSize×gridSize，第 0 行在北；几何网格 gy=0 在南 →
		// 按 (segments+1)² 重采样并翻转行，与 createTile 的 heights 布局一致
		const segments = this.terrainSegments;
		const grid = segments + 1;
		const heights = new Float32Array(grid * grid);
		for (let gy = 0; gy < grid; gy++) {
			for (let gx = 0; gx < grid; gx++) {
				// 几何南边(gy=0) 对应 DEM 最后一行（北行翻转）
				const demRow = Math.round(((segments - gy) * (gridSize - 1)) / segments);
				const demCol = Math.round((gx * (gridSize - 1)) / segments);
				heights[gy * grid + gx] = dem[demRow * gridSize + demCol] || 0;
			}
		}

		return TileGeometry.createTile(
			`tile-${z}-${x}-${y}-geometry`,
			{
				scene,
				width: 1,
				height: 1,
				segmentsW: segments,
				segmentsH: segments,
				heights,
				skirtHeight,
				worldScale,
			}
		);
	}

	/**
	 * 卸载几何体
	 */
	public unload(geometry: Mesh): void {
		geometry.dispose();
	}

	/**
	 * 加载图像像素数据（用于 DEM 解析）
	 * @param url - 图像 URL
	 * @returns Promise<Uint8ClampedArray> RGBA 像素数据
	 */
	private _loadImageData(url: string): Promise<Uint8ClampedArray> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			let settled = false;
			const settle = (fn: () => void) => {
				if (!settled) {
					settled = true;
					clearTimeout(timeout);
					fn();
				}
			};

			// 安全超时：DEM 图片挂起时若无限等待，load() 的下载槽位会永久泄漏，
			// 10 个槽位最终全部卡死。
			const timeout = setTimeout(() => {
				if (this.debug > 0) {
					console.warn(`DEM image load timeout for ${url}`);
				}
				// 中止挂起的下载
				img.src = '';
				settle(() => reject(new Error(`DEM image load timeout: ${url}`)));
			}, 15000);

			img.onload = () => {
				try {
					const canvas = document.createElement('canvas');
					canvas.width = img.width;
					canvas.height = img.height;
					const ctx = canvas.getContext('2d');
					if (!ctx) {
						settle(() => reject(new Error('Failed to get 2D context')));
						return;
					}
					ctx.drawImage(img, 0, 0);
					const imgData = ctx.getImageData(0, 0, img.width, img.height);
					settle(() => resolve(imgData.data));
				} catch (e) {
					settle(() => reject(e as Error));
				}
			};

			img.onerror = () => {
				settle(() => reject(new Error(`Failed to load DEM image: ${url}`)));
			};

			img.src = url;
		});
	}

	/**
	 * 从父级 DEM 网格裁剪出子瓦片的子区域（DEM 超采样）
	 * @param dem - 父级 DEM 高程数组（第 0 行在北）
	 * @param k - 超采样级差（本瓦片 z 与父级 z 的差值）
	 * @param subX - 本瓦片在父瓦片内的列象限（0..2^k-1，向东递增）
	 * @param subY - 本瓦片在父瓦片内的行象限（0..2^k-1，向南递增）
	 * @returns 裁剪后的高程数组（子网格尺寸恒为 2^n+1，Martini 兼容）
	 */
	private _cropDemQuadrant(dem: Float32Array, k: number, subX: number, subY: number): Float32Array {
		const parentSize = Math.floor(Math.sqrt(dem.length));
		const div = Math.pow(2, k);
		// 子网格在父网格中的行/列范围（两端均含）；subY 向南递增，而 DEM 第 0 行在北，
		// 故从父级 row0 起按序连续截取即可保持"行 0 在北"约定，Martini 内部翻转不变。
		const col0 = Math.round((subX * (parentSize - 1)) / div);
		const col1 = Math.round(((subX + 1) * (parentSize - 1)) / div);
		const row0 = Math.round((subY * (parentSize - 1)) / div);
		const row1 = Math.round(((subY + 1) * (parentSize - 1)) / div);
		const cols = col1 - col0 + 1;
		const rows = row1 - row0 + 1;
		const out = new Float32Array(cols * rows);
		for (let r = 0; r < rows; r++) {
			const srcRow = row0 + r;
			for (let c = 0; c < cols; c++) {
				out[r * cols + c] = dem[srcRow * parentSize + col0 + c];
			}
		}
		return out;
	}
}

/**
 * LERC 地形几何体加载器（ArcGIS / 天地图二进制地形，核心底图能力）
 * 二进制 buffer → lerc 解码 → 子区域裁剪（超采样）→ Martini 网格。
 */
export class LercGeometryLoader implements ITileGeometryLoader<Mesh> {
	/** 标识为几何体加载器 */
	public readonly isMaterialLoader = false;

	/** 加载器信息 */
	public readonly info: ITileLoaderInfo = {
		version: '1.0.0',
		author: 'Babylon-Tile Team',
		description: 'ArcGIS LERC binary terrain tile loader',
	};

	/** 数据类型标识 */
	public readonly dataType = 'lerc';

	/** Martini 参考误差（米），默认 10 */
	public martiniMaxError: number = 10;

	/** 调试标志 */
	public debug = 0;

	/**
	 * 加载 LERC 地形网格
	 * @param params - 加载参数（含 source/coords/bounds/scene）
	 * @returns 地形网格；无 URL 时返回 undefined（回退平瓦片）
	 */
	public async load(params: TileSourceLoadParamsType): Promise<Mesh | undefined> {
		const { source, x, y, z, bounds, scene } = params;
		if (!scene) {
			throw new Error('LercGeometryLoader: scene not provided in params');
		}

		// 与 terrain-rgb 一致的超采样：z > maxLevel 时取父级 maxLevel 瓦片
		const demZ = Math.min(z, source.maxLevel);
		const k = z - demZ;
		const shift = 1 << k;
		const demX = Math.floor(x / shift);
		const demY = Math.floor(y / shift);
		const url = source.getUrl(demX, demY, demZ);
		if (!url) {
			return undefined; // 无 URL：回退平瓦片
		}

		// 动态加载 lerc 解码器（失败抛错，由 TileLoader catch 回退平瓦片）
		await LercTerrainLoader.ensureDecoder();
		const buffer = await LercTerrainLoader.fetchBuffer(url);

		// 本瓦片在父瓦片内的象限 → 归一化裁剪范围 [minX, minY, maxX, maxY]
		// （minY 为北，与 DEM 第 0 行在北一致；k=0 未超采样则全范围）
		const subX = x - demX * shift;
		const subY = y - demY * shift;
		const clipBounds: [number, number, number, number] = k > 0
			? [subX / shift, subY / shift, (subX + 1) / shift, (subY + 1) / shift]
			: [0, 0, 1, 1];

		// DEM 高程为原始米制（与 terrain-rgb 一致），无需缩放
		const heightScale = 1;
		const skirtHeight = 100; // 米制裙边高度

		// 瓦片世界尺寸缩放系数 S = mapWidth / 2^z（等价于 bounds 宽度），用于世界尺寸空间算法线
		const worldScale = bounds[2] - bounds[0];

		return LercTerrainLoader.createTerrainMesh(
			buffer,
			z,
			x,
			y,
			clipBounds,
			scene,
			heightScale,
			skirtHeight,
			worldScale,
			this.martiniMaxError
		);
	}

	/**
	 * 卸载几何体
	 */
	public unload(geometry: Mesh): void {
		geometry.dispose();
	}
}

/**
 * quantized-mesh 地形几何体加载器（Cesium 地形，核心底图能力）
 * 服务瓦片 TIN 解码 → 本地瓦片 mercator 均匀规则网格重采样 → Martini 网格。
 *
 * 相邻本地瓦片共享边上的网格点（同经度 + 同 mercator 纬度线，因共享边物理位置重合）
 * 经同一服务瓦片插值 → 高程一致 → 无裂缝；UV 由 Martini 按网格归一化生成（v=0 在南），
 * 与影像瓦片对齐。
 */
export class QuantizedMeshGeometryLoader implements ITileGeometryLoader<Mesh> {
	/** 标识为几何体加载器 */
	public readonly isMaterialLoader = false;

	/** 加载器信息 */
	public readonly info: ITileLoaderInfo = {
		version: '1.0.0',
		author: 'Babylon-Tile Team',
		description: 'Cesium quantized-mesh terrain tile loader',
	};

	/** 数据类型标识 */
	public readonly dataType = 'quantized-mesh';

	/** Martini 参考误差（米），默认 10 */
	public martiniMaxError: number = 10;

	/** 调试标志 */
	public debug = 0;

	/**
	 * 加载 quantized-mesh 地形网格
	 * @param params - 加载参数（含 source/coords/bounds/lonLatBounds/scene/projection）
	 * @returns 地形网格
	 */
	public async load(params: TileSourceLoadParamsType): Promise<Mesh | undefined> {
		const { source, x, y, z, bounds, lonLatBounds, scene, projection } = params;
		if (!scene) {
			throw new Error('QuantizedMeshGeometryLoader: scene not provided in params');
		}
		if (!projection) {
			throw new Error('QuantizedMeshGeometryLoader: projection not provided in params');
		}
		if (!lonLatBounds) {
			throw new Error('QuantizedMeshGeometryLoader: lonLatBounds not provided in params');
		}

		const qmSource = source as ISource & {
			getTileCoordsForBounds(
				lonLatBounds: [number, number, number, number],
				x: number,
				y: number,
				z: number
			): {
				x: number;
				y: number;
				z: number;
				lonLatBounds: [number, number, number, number];
			}[];
			getRequestHeaders?: () => Record<string, string>;
			littleEndian?: boolean;
		};

		// 1. 定位覆盖本地瓦片的所有服务瓦片（4326 等经纬度网格通常多块覆盖）
		const coordsList = qmSource.getTileCoordsForBounds(lonLatBounds, x, y, z);
		if (!coordsList.length) {
			throw new Error('No quantized-mesh tiles cover the local tile');
		}

		// 2. 请求并解码所有服务瓦片 TIN，合并为一个 TIN
		// 请求头由 source 提供（外部配置的 Accept 协商头 + Cesium ion 认证头等）
		const requestHeaders = qmSource.getRequestHeaders?.();
		const requestInit =
			requestHeaders && Object.keys(requestHeaders).length ? { headers: requestHeaders } : undefined;
		// 字节序由 source 显式指定（Mars3D 等服务为小端），不做自动检测
		const littleEndian = qmSource.littleEndian ?? false;

		const lonArr: number[] = [];
		const latArr: number[] = [];
		const heightArr: number[] = [];
		const triArr: number[] = [];
		let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;

		for (const c of coordsList) {
			const response = await fetch(source.getUrl(c.x, c.y, c.z), requestInit);
			if (!response.ok) {
				// 单个服务瓦片失败不影响其余瓦片（仍可渲染局部）
				if (this.debug > 0) {
					console.warn(`quantized-mesh fetch failed: ${response.status} ${c.x}/${c.y}/${c.z}`);
				}
				continue;
			}
			const tin = QuantizedMeshLoader.decode(await response.arrayBuffer(), c.lonLatBounds, littleEndian);
			// 合并顶点（相邻服务瓦片共享边顶点经纬度一致 → 插值无缝）
			const vBase = lonArr.length;
			for (let i = 0; i < tin.lon.length; i++) {
				lonArr.push(tin.lon[i]);
				latArr.push(tin.lat[i]);
				heightArr.push(tin.height[i]);
			}
			for (let i = 0; i < tin.triangles.length; i++) {
				triArr.push(tin.triangles[i] + vBase);
			}
			if (tin.lonMin < lonMin) lonMin = tin.lonMin;
			if (tin.lonMax > lonMax) lonMax = tin.lonMax;
			if (tin.latMin < latMin) latMin = tin.latMin;
			if (tin.latMax > latMax) latMax = tin.latMax;
		}
		if (lonArr.length === 0) {
			throw new Error('All quantized-mesh tiles failed to load');
		}

		const tin: QuantizedMeshTileData = {
			lon: Float32Array.from(lonArr),
			lat: Float32Array.from(latArr),
			height: Float32Array.from(heightArr),
			triangles: Uint32Array.from(triArr),
			bounds: lonLatBounds,
			lonMin,
			lonMax,
			latMin,
			latMax,
		};

		// 3. 本地瓦片 mercator 均匀规则网格（2^6+1=65，Martini 兼容）。
		//    网格点经度在瓦片内线性（3857 经度投影线性），纬度方向在 mercator y 上均匀；
		//    通过投影 unProject 从世界坐标反算经纬度，保证与服务 TIN 同一经纬度参考。
		//    相邻瓦片共享边网格点物理重合 → 插值高程一致 → 无裂缝。
		const gridSize = 65;
		const dem = new Float32Array(gridSize * gridSize);
		const buckets = QuantizedMeshLoader.buildBuckets(tin);

		const [minX, minY, maxX, maxY] = bounds;
		const worldScale = maxX - minX;
		const centerX = (minX + maxX) * 0.5;
		const centerZ = (minY + maxY) * 0.5;

		for (let row = 0; row < gridSize; row++) {
			// DEM 第 0 行在北（Martini 约定）：row=0 → localZ=+0.5（北），row=N-1 → 南
			const localZ = 0.5 - row / (gridSize - 1);
			const wy = centerZ + localZ * worldScale;
			const rowBase = row * gridSize;
			for (let col = 0; col < gridSize; col++) {
				const localX = col / (gridSize - 1) - 0.5;
				const wx = centerX + localX * worldScale;
				const p = projection.unProject(wx, wy);
				dem[rowBase + col] = QuantizedMeshLoader.interpolate(tin, p.lon, p.lat, buckets);
			}
		}

		// 4. Martini 自适应三角网（法线/裙边/误差缩放与 terrain-rgb 统一）
		const heightScale = 1;
		const skirtHeight = 100; // 米制裙边高度
		const maxError = resolveMartiniMaxError(z, worldScale, this.martiniMaxError, { gridSize });

		return TileGeometry.createMartiniTile(
			`tile-${z}-${x}-${y}-geometry`,
			scene,
			dem,
			maxError,
			skirtHeight,
			heightScale,
			worldScale,
			getBoundarySkirtEdges(x, y, z)
		);
	}

	/**
	 * 卸载几何体
	 */
	public unload(geometry: Mesh): void {
		geometry.dispose();
	}
}
