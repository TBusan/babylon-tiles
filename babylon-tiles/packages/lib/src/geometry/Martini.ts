/**
 * @description: Martini RTIN 地形简化算法
 * 基于 Mapbox Martini (https://github.com/mapbox/martini)
 * 适配 Babylon.js Y-up 坐标系
 *
 * RTIN = Right-Triangulated Irregular Networks
 * 根据 maxError 阈值动态决定三角形细分程度，
 * 在平坦区域使用少量三角形，在复杂地形区域使用更多三角形。
 */

/**
 * Martini 几何数据输出格式
 */
export interface MartiniGeometryData {
	/** 顶点位置 (x, y, z) — Babylon Y-up: x/z 水平, y 海拔 */
	positions: Float32Array;
	/** UV 纹理坐标 */
	uvs: Float32Array;
	/** 三角形索引 */
	indices: Uint32Array;
	/** 顶点数量 */
	vertexCount: number;
}

/**
 * Martini 网格生成器
 * 预计算 RTIN 二叉树中所有可能三角形的坐标
 */
export class Martini {
	/** 网格尺寸（必须为 2^n + 1） */
	public readonly gridSize: number;

	/** 三角形总数 */
	public readonly numTriangles: number;

	/** 父级三角形数量 */
	public readonly numParentTriangles: number;

	/** 三角形索引查找表 */
	public readonly indices: Uint32Array;

	/** 所有可能三角形的顶点坐标 */
	public readonly coords: Uint16Array;

	/**
	 * @param gridSize 网格尺寸，必须为 2^n + 1（默认 257 = 2^8 + 1）
	 */
	constructor(gridSize: number = 257) {
		this.gridSize = gridSize;
		const tileSize = gridSize - 1;

		if (tileSize & (tileSize - 1)) {
			throw new Error(`Expected grid size to be 2^n+1, got ${gridSize}.`);
		}

		this.numTriangles = tileSize * tileSize * 2 - 2;
		this.numParentTriangles = this.numTriangles - tileSize * tileSize;
		this.indices = new Uint32Array(this.gridSize * this.gridSize);

		// 预计算 RTIN 二叉树中所有三角形的坐标
		this.coords = new Uint16Array(this.numTriangles * 4);

		for (let i = 0; i < this.numTriangles; i++) {
			let id = i + 2;
			let ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0;

			if (id & 1) {
				bx = by = cx = tileSize; // 左下三角形
			} else {
				ax = ay = cy = tileSize; // 右上三角形
			}

			while ((id >>= 1) > 1) {
				const mx = (ax + bx) >> 1;
				const my = (ay + by) >> 1;

				if (id & 1) {
					// 左半部分
					bx = ax; by = ay;
					ax = cx; ay = cy;
				} else {
					// 右半部分
					ax = bx; ay = by;
					bx = cx; by = cy;
				}
				cx = mx;
				cy = my;
			}

			const k = i * 4;
			this.coords[k + 0] = ax;
			this.coords[k + 1] = ay;
			this.coords[k + 2] = bx;
			this.coords[k + 3] = by;
		}
	}

	/**
	 * 从地形数据创建瓦片实例
	 * @param terrain 高程数据（gridSize * gridSize）
	 */
	public createTile(terrain: Float32Array): MartiniTile {
		return new MartiniTile(terrain, this);
	}
}

/**
 * Martini 瓦片实例
 * 对特定高程数据计算误差图，并根据阈值生成自适应三角网
 */
export class MartiniTile {
	/** 父级 Martini 生成器 */
	public readonly martini: Martini;

	/** 高程数据 */
	public readonly terrain: Float32Array;

	/** 误差图 */
	public readonly errors: Float32Array;

	constructor(terrain: Float32Array, martini: Martini) {
		const size = martini.gridSize;

		if (terrain.length !== size * size) {
			throw new Error(
				`Expected terrain data of length ${size * size} (${size} x ${size}), got ${terrain.length}.`
			);
		}

		this.terrain = terrain;
		this.martini = martini;
		this.errors = new Float32Array(terrain.length);
		this._update();
	}

	/**
	 * 计算误差图
	 * 从最小三角形开始向上累积误差
	 */
	private _update(): void {
		const { numTriangles, numParentTriangles, coords, gridSize: size } = this.martini;
		const { terrain, errors } = this;

		for (let i = numTriangles - 1; i >= 0; i--) {
			const k = i * 4;
			const ax = coords[k + 0];
			const ay = coords[k + 1];
			const bx = coords[k + 2];
			const by = coords[k + 3];
			const mx = (ax + bx) >> 1;
			const my = (ay + by) >> 1;
			const cx = mx + my - ay;
			const cy = my + ax - mx;

			// 计算三角形长边中点的插值误差
			const interpolatedHeight = (terrain[ay * size + ax] + terrain[by * size + bx]) / 2;
			const middleIndex = my * size + mx;
			const middleError = Math.abs(interpolatedHeight - terrain[middleIndex]);

			errors[middleIndex] = Math.max(errors[middleIndex], middleError);

			if (i < numParentTriangles) {
				// 大三角形：累积子三角形误差
				const leftChildIndex = ((ay + cy) >> 1) * size + ((ax + cx) >> 1);
				const rightChildIndex = ((by + cy) >> 1) * size + ((bx + cx) >> 1);
				errors[middleIndex] = Math.max(
					errors[middleIndex],
					errors[leftChildIndex],
					errors[rightChildIndex]
				);
			}
		}
	}

	/**
	 * 根据最大误差阈值生成自适应几何数据
	 * 输出适配 Babylon.js Y-up 坐标系：X/Z 水平，Y 海拔
	 *
	 * @param maxError 最大允许误差（单位与高程数据一致，通常为米）
	 *                 值越大三角形越少（性能高、精度低）
	 *                 值越小三角形越多（精度高、性能低）
	 * @returns 几何数据（positions, uvs, indices）
	 */
	public getGeometryData(maxError: number = 0): MartiniGeometryData {
		const { gridSize: size, indices } = this.martini;
		const { errors } = this;
		let numVertices = 0;
		let numTriangles = 0;
		const max = size - 1;
		let aIndex: number, bIndex: number, cIndex: number;

		indices.fill(0);

		// 第一阶段：遍历误差图，标记使用的顶点并计数三角形
		const countElements = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void => {
			const mx = (ax + bx) >> 1;
			const my = (ay + by) >> 1;

			if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * size + mx] > maxError) {
				countElements(cx, cy, ax, ay, mx, my);
				countElements(bx, by, cx, cy, mx, my);
			} else {
				aIndex = ay * size + ax;
				bIndex = by * size + bx;
				cIndex = cy * size + cx;

				if (indices[aIndex] === 0) indices[aIndex] = ++numVertices;
				if (indices[bIndex] === 0) indices[bIndex] = ++numVertices;
				if (indices[cIndex] === 0) indices[cIndex] = ++numVertices;
				numTriangles++;
			}
		};

		countElements(0, 0, max, max, max, 0);
		countElements(max, max, 0, 0, 0, max);

		// 分配输出数组
		const positions = new Float32Array(numVertices * 3);
		const uvs = new Float32Array(numVertices * 2);
		const triangles = new Uint32Array(numTriangles * 3);

		const tileSize = size - 1;
		let triIndex = 0;

		// 第二阶段：填充顶点数据和三角形索引
		const processTriangle = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void => {
			const mx = (ax + bx) >> 1;
			const my = (ay + by) >> 1;

			if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * size + mx] > maxError) {
				processTriangle(cx, cy, ax, ay, mx, my);
				processTriangle(bx, by, cx, cy, mx, my);
			} else {
				const a = indices[ay * size + ax] - 1;
				const b = indices[by * size + bx] - 1;
				const c = indices[cy * size + cx] - 1;

				// 填充顶点坐标（Babylon Y-up: X水平, Y海拔, Z水平）
				this._setVertex(positions, uvs, a, ax, ay, tileSize);
				this._setVertex(positions, uvs, b, bx, by, tileSize);
				this._setVertex(positions, uvs, c, cx, cy, tileSize);

				triangles[triIndex++] = a;
				triangles[triIndex++] = b;
				triangles[triIndex++] = c;
			}
		};

		processTriangle(0, 0, max, max, max, 0);
		processTriangle(max, max, 0, 0, 0, max);

		return {
			positions,
			uvs,
			indices: triangles,
			vertexCount: numVertices,
		};
	}

	/**
	 * 设置单个顶点的位置和 UV 坐标
	 * Babylon.js Y-up: gridX → 世界X, terrain高度 → 世界Y, gridY → 世界Z
	 */
	private _setVertex(
		positions: Float32Array,
		uvs: Float32Array,
		index: number,
		gridX: number,
		gridY: number,
		tileSize: number
	): void {
		// DEM 第 0 行在北，几何网格 gridY=0 在南（Z-）→ 行翻转读取（与 three-tile getAttributes 一致）
		const pixelIdx = (tileSize - gridY) * this.martini.gridSize + gridX;

		// 位置：归一化到 [-0.5, 0.5] 范围
		positions[3 * index + 0] = gridX / tileSize - 0.5;        // X: 水平
		positions[3 * index + 1] = this.terrain[pixelIdx];         // Y: 海拔（Babylon up-axis）
		positions[3 * index + 2] = gridY / tileSize - 0.5;        // Z: 水平

		// UV 坐标：[0, 1] 范围，v=0 在南（贴图北端贴北）
		uvs[2 * index + 0] = gridX / tileSize;
		uvs[2 * index + 1] = gridY / tileSize;
	}
}
