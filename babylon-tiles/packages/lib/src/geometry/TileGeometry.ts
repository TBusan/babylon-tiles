/**
 * @description: 瓦片几何体类
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';

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
		} = options;

		// 创建顶点数据
		const vertexData = new VertexData();

		// 生成顶点
		const positions: number[] = [];
		const normals: number[] = [];
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

				// 添加位置
				positions.push(posX, posY, posZ);

				// 添加法向量（默认向上）
				normals.push(0, 1, 0);

				// 添加 UV 坐标
				uvs.push(u, v);
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

		// 设置顶点数据
		vertexData.positions = positions;
		vertexData.normals = normals;
		vertexData.uvs = uvs;
		vertexData.indices = indices;

		// 如果有裙边，添加裙边几何体
		if (skirtHeight > 0) {
			TileGeometry._addSkirt(vertexData, width, height, segmentsW, segmentsH, skirtHeight, positions);
		}

		// 创建网格
		const mesh = new Mesh(name, scene);
		vertexData.applyToMesh(mesh);

		return mesh;
	}

	/**
	 * 添加裙边（用于消除瓦片间的缝隙）
	 * @private
	 */
	private static _addSkirt(
		vertexData: VertexData,
		tileWidth: number,
		tileHeight: number,
		segmentsW: number,
		segmentsH: number,
		skirtHeight: number,
		originalPositions: number[]
	): void {
		const skirtPositions: number[] = [...originalPositions];
		const skirtNormals: number[] = [];
		const skirtUVs: number[] = [];
		const skirtIndices: number[] = [];

		const originalVertexCount = (segmentsW + 1) * (segmentsH + 1);
		let skirtIndex = originalVertexCount;

		// 下边裙边
		for (let x = 0; x <= segmentsW; x++) {
			const originalIdx = x * 3;
			const pos = {
				x: originalPositions[originalIdx],
				y: originalPositions[originalIdx + 1],
				z: originalPositions[originalIdx + 2],
			};

			// 添加裙边顶点
			skirtPositions.push(pos.x, pos.y - skirtHeight, pos.z);
			skirtNormals.push(0, 0, -1);
			skirtUVs.push(x / segmentsW, 0);

			// 添加索引（连接到原始边缘）
			if (x < segmentsW) {
				const idx1 = x;
				const idx2 = x + 1;
				const idx3 = skirtIndex;
				const idx4 = skirtIndex + 1;

				skirtIndices.push(idx1, idx2, idx3);
				skirtIndices.push(idx2, idx4, idx3);
			}

			skirtIndex++;
		}

		// 更新顶点数据
		vertexData.positions = skirtPositions;
		vertexData.normals = [...vertexData.normals, ...skirtNormals];
		vertexData.uvs = [...vertexData.uvs, ...skirtUVs];
		vertexData.indices = [...vertexData.indices, ...skirtIndices];
	}

	/**
	 * 创建平瓦片（无地形）
	 * @param name - 网格名称
	 * @param scene - 场景
	 * @param width - 宽度
	 * @param height - 高度
	 * @returns 瓦片网格
	 */
	public static createFlatTile(name: string, scene: Scene, width = 1, height = 1): Mesh {
		return TileGeometry.createTile(name, {
			scene,
			width,
			height,
			segmentsW: 1,
			segmentsH: 1,
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
}
