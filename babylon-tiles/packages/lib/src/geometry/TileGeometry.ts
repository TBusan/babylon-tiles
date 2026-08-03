/**
 * @description: 瓦片几何体类
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Martini } from './Martini.js';

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
				let posZ = (v - 0.5) * height;

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

		// 计算法向量：有高程数据时使用 ComputeNormals 计算真实法线，
		// 否则使用默认向上法线（平面瓦片）
		const normals: number[] = [];
		if (heights) {
			VertexData.ComputeNormals(positions, indices, normals);
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
	private static _addSkirts(
		vertexData: VertexData,
		segmentsW: number,
		segmentsH: number,
		skirtHeight: number
	): void {
		const positions = vertexData.positions as number[];
		const normals = vertexData.normals as number[];
		const uvs = vertexData.uvs as number[];
		const indices = vertexData.indices as number[];

		const cols = segmentsW + 1;
		const rows = segmentsH + 1;
		let nextIndex = positions.length / 3;

		// 辅助函数：添加一条边缘的裙边
		const addEdge = (
			edgeIndices: number[],
			normalX: number,
			normalZ: number
		) => {
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
	 * @returns 瓦片网格
	 */
	public static createMartiniTile(
		name: string,
		scene: Scene,
		terrain: Float32Array,
		maxError: number = 0,
		skirtHeight: number = 0,
		heightScale: number = 1
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

		// 计算法向量
		const normals: number[] = [];
		VertexData.ComputeNormals(vertexData.positions, vertexData.indices, normals);
		vertexData.normals = normals;

		// 添加裙边（从边缘顶点向下延伸）
		if (skirtHeight > 0) {
			TileGeometry._addMartiniSkirts(vertexData, gridSize, skirtHeight);
		}

		// 创建网格
		const mesh = new Mesh(name, scene);
		vertexData.applyToMesh(mesh);

		return mesh;
	}

	/**
	 * 为 Martini 生成的不规则网格添加裙边
	 * 通过检测边界顶点（x/z 在 ±0.5 边缘）来识别外边缘
	 * @private
	 */
	private static _addMartiniSkirts(
		vertexData: VertexData,
		gridSize: number,
		skirtHeight: number
	): void {
		const positions = vertexData.positions as number[];
		const normals = vertexData.normals as number[];
		const uvs = vertexData.uvs as number[];
		const indices = vertexData.indices as number[];

		const vertexCount = positions.length / 3;
		const eps = 0.001; // 边界检测容差

		// 收集四条边缘上的顶点索引
		const bottomEdge: number[] = []; // z ≈ -0.5
		const topEdge: number[] = [];    // z ≈ +0.5
		const leftEdge: number[] = [];   // x ≈ -0.5
		const rightEdge: number[] = [];  // x ≈ +0.5

		for (let i = 0; i < vertexCount; i++) {
			const x = positions[i * 3];
			const z = positions[i * 3 + 2];

			if (Math.abs(z - (-0.5)) < eps) bottomEdge.push(i);
			if (Math.abs(z - 0.5) < eps) topEdge.push(i);
			if (Math.abs(x - (-0.5)) < eps) leftEdge.push(i);
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

		addEdge(bottomEdge, 0, -1);
		addEdge(topEdge, 0, 1);
		addEdge(leftEdge, -1, 0);
		addEdge(rightEdge, 1, 0);
	}
}
