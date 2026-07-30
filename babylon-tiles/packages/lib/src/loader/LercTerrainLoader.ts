/**
 * @description: ArcGIS LERC 格式地形加载器
 * LERC = Limited Error Raster Compression
 * https://github.com/Esri/lerc
 *
 * 由于 LERC 解码器是外部依赖（lerc npm 包），
 * 本模块定义解码器接口并提供完整的加载管线：
 * 解码 → 子区域裁剪 → Martini 简化 → Babylon.js 网格
 */

import type { Scene } from '@babylonjs/core/scene';
import { TileGeometry } from '../geometry/TileGeometry.js';
import { Martini } from '../geometry/Martini.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';

/**
 * LERC 解码结果
 */
export interface LercDecodeResult {
	/** 高程数据（行优先） */
	pixels: number[][];
	/** 宽度（列数） */
	width: number;
	/** 高度（行数） */
	height: number;
}

/**
 * LERC 解码器接口
 * 用户需要注入实际的 LERC 解码实现（如 lerc npm 包）
 *
 * 使用示例：
 * ```ts
 * import Lerc from 'lerc';
 * LercTerrainLoader.setDecoder((buffer) => Lerc.decode(buffer));
 * ```
 */
export type LercDecoder = (buffer: ArrayBuffer) => LercDecodeResult;

/**
 * DEM 数据类型
 */
interface DEMData {
	array: Float32Array;
	width: number;
	height: number;
}

/**
 * 各层级对应的 Martini 最大误差（米）
 * 层级越低（视野越大），允许误差越大以减少三角形数量
 */
const MAX_ERRORS: Record<number, number> = {
	0: 7000, 1: 6000, 2: 5000, 3: 4000, 4: 3000,
	5: 2500, 6: 2000, 7: 1500, 8: 800, 9: 500,
	10: 200, 11: 100, 12: 40, 13: 12, 14: 5,
	15: 2, 16: 1, 17: 0.5, 18: 0.2, 19: 0.1, 20: 0.01,
};

/**
 * LERC 地形加载器
 * 支持 ArcGIS LERC 格式的高程数据加载和渲染
 */
export class LercTerrainLoader {
	/** 全局 LERC 解码器（需要用户注入） */
	private static _decoder: LercDecoder | null = null;

	/**
	 * 设置 LERC 解码器
	 * @param decoder 解码函数（通常来自 lerc npm 包）
	 */
	public static setDecoder(decoder: LercDecoder): void {
		LercTerrainLoader._decoder = decoder;
	}

	/**
	 * 检查解码器是否已设置
	 */
	public static get isDecoderAvailable(): boolean {
		return LercTerrainLoader._decoder !== null;
	}

	/**
	 * 从 ArrayBuffer 加载 LERC 地形并创建网格
	 *
	 * @param buffer LERC 编码的二进制数据
	 * @param z 瓦片层级（用于确定 Martini 误差阈值）
	 * @param clipBounds 裁剪范围 [minX, minY, maxX, maxY]（0-1 归一化）
	 * @param scene Babylon.js 场景
	 * @param heightScale 高程缩放因子（米 → 局部坐标）
	 * @param skirtHeight 裙边高度（局部坐标）
	 * @returns 地形网格
	 */
	public static createTerrainMesh(
		buffer: ArrayBuffer,
		z: number,
		clipBounds: [number, number, number, number],
		scene: Scene,
		heightScale: number = 1,
		skirtHeight: number = 0
	): Mesh {
		if (!LercTerrainLoader._decoder) {
			throw new Error(
				'LERC decoder not set. Call LercTerrainLoader.setDecoder() first. ' +
				'Example: LercTerrainLoader.setDecoder((buf) => Lerc.decode(buf))'
			);
		}

		// 1. 解码 LERC 数据
		let demData = LercTerrainLoader._decode(buffer);

		// 2. 如果需要裁剪（超级别回退）
		const needsClip = clipBounds[2] - clipBounds[0] < 1;
		if (needsClip) {
			demData = LercTerrainLoader._getSubDEM(demData, clipBounds);
		}

		// 3. 使用 Martini 生成自适应三角网
		const { array: terrain, width: gridSize } = demData;
		const maxError = MAX_ERRORS[z] ?? 0;

		return TileGeometry.createMartiniTile(
			`lerc-terrain-z${z}`,
			scene,
			terrain,
			maxError,
			skirtHeight,
			heightScale
		);
	}

	/**
	 * 解码 LERC 二进制数据为高程数组
	 */
	private static _decode(buffer: ArrayBuffer): DEMData {
		const result = LercTerrainLoader._decoder!(buffer);
		const { height, width, pixels } = result;

		// 提取第一个波段的高程数据
		const demArray = new Float32Array(height * width);
		for (let i = 0; i < demArray.length; i++) {
			demArray[i] = pixels[0][i];
		}

		return { array: demArray, width, height };
	}

	/**
	 * 从父级 DEM 中裁剪子区域
	 * 用于超级别回退：请求的层级超过数据源最大层级时，从父瓦片截取
	 */
	private static _getSubDEM(
		demData: DEMData,
		bounds: [number, number, number, number]
	): DEMData {
		const { sx, sy, sw, sh } = LercTerrainLoader._getBoundsCoord(bounds, demData.width);

		// Martini 需要 2^n + 1 尺寸
		const targetWidth = sw + 1;
		const targetHeight = sh + 1;

		// 裁剪并缩放到目标尺寸
		const demArray = LercTerrainLoader._clipAndResize(
			demData.array,
			demData.width,
			sx, sy, sw, sh,
			targetWidth, targetHeight
		);

		return { array: demArray, width: targetWidth, height: targetHeight };
	}

	/**
	 * 将归一化裁剪范围转换为像素坐标
	 */
	private static _getBoundsCoord(
		clipBounds: [number, number, number, number],
		targetSize: number
	): { sx: number; sy: number; sw: number; sh: number } {
		const sx = Math.floor(clipBounds[0] * targetSize);
		const sy = Math.floor(clipBounds[1] * targetSize);
		const sw = Math.floor((clipBounds[2] - clipBounds[0]) * targetSize);
		const sh = Math.floor((clipBounds[3] - clipBounds[1]) * targetSize);
		return { sx, sy, sw, sh };
	}

	/**
	 * 裁剪并缩放高程数组
	 * 先裁剪出子区域，再双线性缩放到目标尺寸
	 */
	private static _clipAndResize(
		buffer: Float32Array,
		srcWidth: number,
		sx: number, sy: number, sw: number, sh: number,
		dw: number, dh: number
	): Float32Array {
		// 裁剪
		const clipped = new Float32Array(sw * sh);
		for (let row = 0; row < sh; row++) {
			for (let col = 0; col < sw; col++) {
				clipped[row * sw + col] = buffer[(row + sy) * srcWidth + (col + sx)];
			}
		}

		// 缩放到目标尺寸
		const resized = new Float32Array(dh * dw);
		for (let row = 0; row < dh; row++) {
			for (let col = 0; col < dw; col++) {
				const sourceX = Math.min(Math.round((col * sw) / dw), sw - 1);
				const sourceY = Math.min(Math.round((row * sh) / dh), sh - 1);
				resized[row * dw + col] = clipped[sourceY * sw + sourceX];
			}
		}

		return resized;
	}

	/**
	 * 从 URL 加载 LERC 数据
	 * @param url LERC 文件 URL
	 * @returns ArrayBuffer
	 */
	public static async fetchBuffer(url: string): Promise<ArrayBuffer> {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to fetch LERC data: ${response.status} ${response.statusText}`);
		}
		return response.arrayBuffer();
	}
}
