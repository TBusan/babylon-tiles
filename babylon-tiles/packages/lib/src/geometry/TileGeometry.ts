/**
 * @description: 瓦片几何体类
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Martini } from './Martini.js';

/**
 * 裙边生成开关：指定瓦片的哪些边生成裙边。
 * 缺省（undefined）的边默认生成；内部共享边置 false 可避免与相邻瓦片裙边
 * 在同一平面共面重叠（旋转掠射角时 z-fight 闪烁）。
 */
export interface SkirtEdges {
	/** 北边（z=+0.5，slippy y=0） */
	top?: boolean;
	/** 南边（z=-0.5，slippy y=2^z-1） */
	bottom?: boolean;
	/** 西边（x=-0.5，slippy x=0） */
	left?: boolean;
	/** 东边（x=+0.5，slippy x=2^z-1） */
	right?: boolean;
}

/**
 * 按瓦片全局坐标计算数据边界裙边：全球金字塔边缘（x=0 / x=2^z-1、y=0 / y=2^z-1）
 * 无相邻瓦片，需裙边遮盖侧面；内部共享边靠 Martini 边界满分辨率保证无缝，不需裙边。
 * @param x 瓦片列（slippy）
 * @param y 瓦片行（slippy，y=0 北）
 * @param z 瓦片层级
 */
export function getBoundarySkirtEdges(x: number, y: number, z: number): SkirtEdges {
	const maxCoord = (1 << z) - 1;
	return {
		top: y === 0,
		bottom: y === maxCoord,
		left: x === 0,
		right: x === maxCoord,
	};
}

/**
 * 瓦片几何体选项
 */
export interface TileGeometryOptions {
	/** 场景 */
	scene: Scene;
	/** 瓦片宽度（单位：米，默认为 1） */
	width?: number;
	/** 瓦片高度（单位：米，默认为 1） */
	height?: number;
	/** 宽度方向分段数（默认为 1） */
	segmentsW?: number;
	/** 高度方向分段数（默认为 1） */
	segmentsH?: number;
	/** 高程数据（可选，用于地形） */
	heights?: Float32Array;
	/** 裙边高度（用于消除瓦片间缝隙，单位：米，默认为 0） */
	skirtHeight?: number;
	/** 是否翻转 X 轴（默认为 false） */
	flipX?: boolean;
	/**
	 * 边缘出血量（Mapbox tile overdraw）：四边各外扩比例，默认 0。
	 * 平瓦片路径用于消除深缩放时相邻瓦片共享边的亚像素缝隙——
	 * 位置外扩 + UV 外扩（名义边仍映射 0/1），外扩区靠 CLAMP 采样边缘纹素。
	 */
	bleed?: number;
	/**
	 * 瓦片世界宽度（米）。地形（heights）路径用于在"世界尺寸"空间计算法线：
	 * 瓦片几何位于倾斜局部空间（X/Z ∈ [-0.5,0.5]，Y = 米制高程），而世界矩阵为非均匀
	 * 缩放 diag(S,1,S)。若直接对倾斜几何 ComputeNormals，法线近似水平 + 微弱 Y，
	 * 着色器 inverse-transpose（NONUNIFORMSCALING，把 X/Z 除以 S）会把它压成 (0,±1,0)，
	 * 地形全黑或全亮。正确做法：先在 X/Z × S 的世界尺寸空间算真实世界法线，再映射回
	 * 倾斜局部空间（X/Z × S），着色器 inverse-transpose 恰好恢复原方向。
	 * 默认 1（平瓦片无影响）。
	 */
	worldScale?: number;
}

/**
 * 瓦片几何体类
 * 用于创建和管理地图瓦片的网格几何体
 */
export class TileGeometry {
	/**
	 * 创建瓦片网格
	 * @param name - 网格名称
	 * @param options - 几何体选项
	 * @returns 瓦片网格
	 */
	public static createTile(name: string, options: TileGeometryOptions): Mesh {
		const {
			scene,
			width = 1,
			height = 1,
			segmentsW = 1,
			segmentsH = 1,
			heights,
			skirtHeight = 0,
			flipX = false,
			bleed = 0,
			worldScale = 1,
		} = options;

		// 创建顶点数据
		const vertexData = new VertexData();

		// 生成顶点
		const positions: number[] = [];
		const uvs: number[] = [];
		const indices: number[] = [];

		// 生成顶点和索引
		for (let y = 0; y <= segmentsH; y++) {
			for (let x = 0; x <= segmentsW; x++) {
				// 归一化坐标（0到1）
				const u = x / segmentsW;
				const v = y / segmentsH;

				// 实际坐标（-0.5 到 0.5）
				let posX = (u - 0.5) * width;
				const posZ = (v - 0.5) * height;

				// 应用高程数据
				let posY = 0;
				if (heights) {
					const index = y * (segmentsW + 1) + x;
					posY = heights[index] || 0;
				}

				// 如果需要翻转 X 轴
				if (flipX) {
					posX = -posX;
				}

				if (bleed > 0) {
					// 边缘出血（Mapbox tile overdraw）：位置四边各外扩 bleed，
					// UV 同步外扩到 [-bleed, 1+bleed]——名义边（±0.5）仍映射 0/1，
					// 外扩区由纹理 CLAMP 采样边缘纹素，相邻瓦片重叠覆盖共享边，
					// 消除深缩放时亚像素缝隙透出清屏色。
					const S = 1 + 2 * bleed;
					positions.push(posX * S, posY, posZ * S);
					uvs.push(0.5 + (posX * S) / width, 0.5 + (posZ * S) / height);
				} else {
					// 添加位置
					positions.push(posX, posY, posZ);

					// 添加 UV 坐标
					uvs.push(u, v);
				}
			}
		}

		// 生成索引
		for (let y = 0; y < segmentsH; y++) {
			for (let x = 0; x < segmentsW; x++) {
				const topLeft = y * (segmentsW + 1) + x;
				const topRight = topLeft + 1;
				const bottomLeft = (y + 1) * (segmentsW + 1) + x;
				const bottomRight = bottomLeft + 1;

				// 第一个三角形
				indices.push(topLeft, bottomLeft, topRight);
				// 第二个三角形
				indices.push(topRight, bottomLeft, bottomRight);
			}
		}

		// 计算法向量：有高程数据时在世界尺寸空间计算真实法线（见 _computeTerrainNormals），
		// 否则使用默认向上法线（平面瓦片）
		const normals: number[] = [];
		if (heights) {
			normals.push(...TileGeometry._computeTerrainNormals(positions, indices, worldScale));
		} else {
			for (let i = 0; i < positions.length / 3; i++) {
				normals.push(0, 1, 0);
			}
		}

		// 设置顶点数据
		vertexData.positions = positions;
		vertexData.normals = normals;
		vertexData.uvs = uvs;
		vertexData.indices = indices;

		// 如果有裙边，添加四方向裙边几何体
		if (skirtHeight > 0) {
			TileGeometry._addSkirts(vertexData, segmentsW, segmentsH, skirtHeight);
		}

		// 创建网格
		const mesh = new Mesh(name, scene);
		vertexData.applyToMesh(mesh);

		return mesh;
	}

	/**
	 * 添加四方向裙边（用于消除瓦片间的缝隙）
	 * 从网格边缘顶点向下延伸 skirtHeight 高度，形成围挡几何体
	 * @private
	 */
	private static _addSkirts(vertexData: VertexData, segmentsW: number, segmentsH: number, skirtHeight: number): void {
		const positions = vertexData.positions as number[];
		const normals = vertexData.normals as number[];
		const uvs = vertexData.uvs as number[];
		const indices = vertexData.indices as number[];

		const cols = segmentsW + 1;
		const rows = segmentsH + 1;
		let nextIndex = positions.length / 3;

		// 辅助函数：添加一条边缘的裙边
		const addEdge = (edgeIndices: number[], normalX: number, normalZ: number) => {
			const baseIndex = nextIndex;

			// 为边缘上的每个顶点创建对应的裙边顶点（向下延伸）
			for (const idx of edgeIndices) {
				const px = positions[idx * 3];
				const py = positions[idx * 3 + 1];
				const pz = positions[idx * 3 + 2];

				positions.push(px, py - skirtHeight, pz);
				normals.push(normalX, 0, normalZ);
				uvs.push(uvs[idx * 2], uvs[idx * 2 + 1]);
				nextIndex++;
			}

			// 生成裙边三角形（连接原始边缘和裙边边缘）
			for (let i = 0; i < edgeIndices.length - 1; i++) {
				const topA = edgeIndices[i];
				const topB = edgeIndices[i + 1];
				const botA = baseIndex + i;
				const botB = baseIndex + i + 1;

				// 两个三角形组成裙边四边形
				indices.push(topA, botA, topB);
				indices.push(topB, botA, botB);
			}
		};

		// 下边（z 最小行，y=0）
		const bottomEdge: number[] = [];
		for (let x = 0; x < cols; x++) {
			bottomEdge.push(x); // 第一行
		}
		addEdge(bottomEdge, 0, -1);

		// 上边（z 最大行，y=segmentsH）
		const topEdge: number[] = [];
		for (let x = 0; x < cols; x++) {
			topEdge.push((rows - 1) * cols + x); // 最后一行
		}
		addEdge(topEdge, 0, 1);

		// 左边（x 最小列，x=0）
		const leftEdge: number[] = [];
		for (let y = 0; y < rows; y++) {
			leftEdge.push(y * cols); // 每行第一个
		}
		addEdge(leftEdge, -1, 0);

		// 右边（x 最大列，x=segmentsW）
		const rightEdge: number[] = [];
		for (let y = 0; y < rows; y++) {
			rightEdge.push(y * cols + (cols - 1)); // 每行最后一个
		}
		addEdge(rightEdge, 1, 0);
	}

	/**
	 * 创建平瓦片（无地形）
	 * @param name - 网格名称
	 * @param scene - 场景
	 * @param width - 宽度
	 * @param height - 高度
	 * @returns 瓦片网格
	 */
	public static createFlatTile(name: string, scene: Scene, width = 1, height = 1, bleed = 0): Mesh {
		return TileGeometry.createTile(name, {
			scene,
			width,
			height,
			segmentsW: 1,
			segmentsH: 1,
			bleed,
		});
	}

	/**
	 * 创建地形瓦片（带高程数据）
	 * @param name - 网格名称
	 * @param scene - 场景
	 * @param width - 宽度
	 * @param height - 高度
	 * @param segments - 分段数
	 * @param heights - 高程数据数组
	 * @returns 瓦片网格
	 */
	public static createTerrainTile(
		name: string,
		scene: Scene,
		width = 1,
		height = 1,
		segments = 128,
		heights: Float32Array
	): Mesh {
		return TileGeometry.createTile(name, {
			scene,
			width,
			height,
			segmentsW: segments,
			segmentsH: segments,
			heights,
			skirtHeight: 100, // 默认裙边高度
		});
	}

	/**
	 * 使用 Martini RTIN 算法创建自适应地形瓦片
	 * 根据地形复杂度动态决定三角形数量：平坦区域三角形少，复杂区域三角形多
	 *
	 * @param name - 网格名称
	 * @param scene - 场景
	 * @param terrain - 高程数据（gridSize * gridSize，gridSize 必须为 2^n+1）
	 * @param maxError - 最大允许误差（米），默认 0 表示完全精确
	 *                   推荐值：低精度 50-100，中精度 10-30，高精度 1-5
	 * @param skirtHeight - 裙边高度（局部坐标），默认 0
	 * @param heightScale - 高程缩放因子（将米制高程转换为局部坐标），默认 1
	 * @param worldScale - 瓦片世界宽度（米），用于在世界尺寸空间计算法线（见 _computeTerrainNormals），默认 1
	 * @param skirtEdges - 指定哪些边生成裙边（默认 undefined = 四边全部生成）。
	 *                    内部瓦片共享边若两侧都加裙边会在同一平面共面重叠，旋转掠射角时
	 *                    z-fight 闪烁；数据边界（地图外缘）需保留裙边遮盖侧面。
	 *                    由调用方用 getBoundarySkirtEdges 按瓦片坐标计算。
	 * @returns 瓦片网格
	 */
	public static createMartiniTile(
		name: string,
		scene: Scene,
		terrain: Float32Array,
		maxError: number = 0,
		skirtHeight: number = 0,
		heightScale: number = 1,
		worldScale: number = 1,
		skirtEdges?: SkirtEdges
	): Mesh {
		const gridSize = Math.floor(Math.sqrt(terrain.length));

		// 创建 Martini 实例并生成自适应三角网
		const martini = new Martini(gridSize);
		const tile = martini.createTile(terrain);
		const geoData = tile.getGeometryData(maxError);

		// 应用高程缩放
		const positions = geoData.positions;
		for (let i = 0; i < geoData.vertexCount; i++) {
			positions[i * 3 + 1] *= heightScale; // Y 轴（海拔）缩放
		}

		// 构建 VertexData
		const vertexData = new VertexData();
		vertexData.positions = Array.from(positions);
		vertexData.uvs = Array.from(geoData.uvs);
		vertexData.indices = Array.from(geoData.indices);

		// 计算法向量（世界尺寸空间，见 _computeTerrainNormals 注释）
		vertexData.normals = TileGeometry._computeTerrainNormals(
			vertexData.positions as number[],
			vertexData.indices as number[],
			worldScale
		);

		// 添加裙边（从边缘顶点向下延伸；内部共享边不加，避免共面 z-fight）
		if (skirtHeight > 0) {
			TileGeometry._addMartiniSkirts(vertexData, gridSize, skirtHeight, skirtEdges);
		}

		// 创建网格
		const mesh = new Mesh(name, scene);
		vertexData.applyToMesh(mesh);

		return mesh;
	}

	/**
	 * 计算地形瓦片法线。
	 *
	 * 瓦片几何位于倾斜局部空间：X/Z ∈ [-0.5, 0.5]（瓦片单位），Y = 米制高程，
	 * 而瓦片世界矩阵为非均匀缩放 diag(S,1,S)（S = 瓦片世界宽度，约 3×10^5m）。
	 *
	 * 若直接对倾斜几何 ComputeNormals：三角形在 X/Z 方向的跨度（≈1/256）远小于
	 * Y 方向高程差（≈几百米），法线近似水平 + 微弱 Y；着色器 NONUNIFORMSCALING
	 * 分支取 inverse-transpose = diag(1/S,1,1/S)，把法线 X/Z 分量除以 S 压到 ~1e-6，
	 * 微弱 Y 反而占主导 → 法线退化为 (0,±1,0)，坡度方向全部丢失，地形要么全黑
	 * （Y 为负）要么全亮（Y 为正）。
	 *
	 * 正确做法：先在"世界尺寸"空间（X/Z × S，单位一致为米）对同一套索引 ComputeNormals，
	 * 得到真实世界法线 W；再映射回倾斜局部空间存储：L = normalize(S·Wx, Wy, S·Wz)。
	 * 着色器 inverse-transpose 施加 diag(1/S,1,1/S)·L = (Wx, Wy, Wz)/|…| → 归一化后
	 * 恰好恢复 W，坡度方向与明暗关系正确。
	 *
	 * 另注意 Babylon ComputeNormals 默认（左手系）输出与几何右手系绕序相反的法线：
	 * 瓦片绕序按右手系向上（crossY > 0），默认输出却向下 → 需取反（-W）才是朝上法线。
	 *
	 * @param positions - 局部空间顶点位置（X/Y/Z）
	 * @param indices - 三角形索引
	 * @param worldScale - 瓦片世界宽度（米），即非均匀缩放 diag(S,1,S) 的 S
	 * @returns 倾斜局部空间的法线数组（归一化）
	 * @private
	 */
	private static _computeTerrainNormals(positions: number[], indices: number[], worldScale: number): number[] {
		// 世界尺寸临时位置：X/Z 乘 S，Y 保持米制（与真实世界几何一致）
		const worldPositions = new Float32Array(positions.length);
		for (let i = 0; i < positions.length; i += 3) {
			worldPositions[i] = positions[i] * worldScale;
			worldPositions[i + 1] = positions[i + 1];
			worldPositions[i + 2] = positions[i + 2] * worldScale;
		}

		// 在世界尺寸空间计算法线（单位一致，坡度信息完整保留）
		const worldNormals: number[] = [];
		VertexData.ComputeNormals(Array.from(worldPositions), indices, worldNormals);

		// Babylon 默认输出与右手系绕序相反 → 取反得朝上真实世界法线；
		// 再映射回倾斜局部空间（X/Z × S）并归一化，供着色器 inverse-transpose 恢复。
		const normals: number[] = [];
		for (let i = 0; i < worldNormals.length; i += 3) {
			const nx = -worldNormals[i] * worldScale;
			const ny = -worldNormals[i + 1];
			const nz = -worldNormals[i + 2] * worldScale;
			const len = Math.hypot(nx, ny, nz) || 1;
			normals.push(nx / len, ny / len, nz / len);
		}
		return normals;
	}

	/**
	 * 为 Martini 生成的不规则网格添加裙边
	 * 通过检测边界顶点（x/z 在 ±0.5 边缘）来识别外边缘
	 * @param skirtEdges - 各边是否生成裙边；缺省或对应值非 false 的边生成（undefined = 四边全加）
	 * @private
	 */
	private static _addMartiniSkirts(
		vertexData: VertexData,
		gridSize: number,
		skirtHeight: number,
		skirtEdges?: SkirtEdges
	): void {
		const positions = vertexData.positions as number[];
		const normals = vertexData.normals as number[];
		const uvs = vertexData.uvs as number[];
		const indices = vertexData.indices as number[];

		const vertexCount = positions.length / 3;
		const eps = 0.001; // 边界检测容差

		// 收集四条边缘上的顶点索引
		const bottomEdge: number[] = []; // z ≈ -0.5
		const topEdge: number[] = []; // z ≈ +0.5
		const leftEdge: number[] = []; // x ≈ -0.5
		const rightEdge: number[] = []; // x ≈ +0.5

		for (let i = 0; i < vertexCount; i++) {
			const x = positions[i * 3];
			const z = positions[i * 3 + 2];

			if (Math.abs(z - -0.5) < eps) bottomEdge.push(i);
			if (Math.abs(z - 0.5) < eps) topEdge.push(i);
			if (Math.abs(x - -0.5) < eps) leftEdge.push(i);
			if (Math.abs(x - 0.5) < eps) rightEdge.push(i);
		}

		// 按边缘方向排序（确保裙边三角形连续）
		bottomEdge.sort((a, b) => positions[a * 3] - positions[b * 3]);
		topEdge.sort((a, b) => positions[a * 3] - positions[b * 3]);
		leftEdge.sort((a, b) => positions[a * 3 + 2] - positions[b * 3 + 2]);
		rightEdge.sort((a, b) => positions[a * 3 + 2] - positions[b * 3 + 2]);

		let nextIndex = vertexCount;

		const addEdge = (edgeIndices: number[], normalX: number, normalZ: number) => {
			if (edgeIndices.length < 2) return;
			const baseIndex = nextIndex;

			for (const idx of edgeIndices) {
				const px = positions[idx * 3];
				const py = positions[idx * 3 + 1];
				const pz = positions[idx * 3 + 2];

				positions.push(px, py - skirtHeight, pz);
				normals.push(normalX, 0, normalZ);
				uvs.push(uvs[idx * 2], uvs[idx * 2 + 1]);
				nextIndex++;
			}

			for (let i = 0; i < edgeIndices.length - 1; i++) {
				const topA = edgeIndices[i];
				const topB = edgeIndices[i + 1];
				const botA = baseIndex + i;
				const botB = baseIndex + i + 1;

				indices.push(topA, botA, topB);
				indices.push(topB, botA, botB);
			}
		};

		if (skirtEdges?.bottom !== false) addEdge(bottomEdge, 0, -1);
		if (skirtEdges?.top !== false) addEdge(topEdge, 0, 1);
		if (skirtEdges?.left !== false) addEdge(leftEdge, -1, 0);
		if (skirtEdges?.right !== false) addEdge(rightEdge, 1, 0);
	}
}
