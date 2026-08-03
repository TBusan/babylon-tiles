/**
 * @description: ArcGIS LERC 格式地形加载器
 * LERC = Limited Error Raster Compression
 * https://github.com/Esri/lerc
 *
 * 加载管线：解码（lerc npm 包）→ 子区域裁剪（超级别回退）→
 * 2^n+1 上采样 → Martini 简化 → Babylon.js 网格。
 *
 * 解码器默认通过 ensureDecoder() 动态 import('lerc') 自动注入；
 * 也支持手动注入：LercTerrainLoader.setDecoder((buf) => Lerc.decode(buf))。
 */

import type { Scene } from '@babylonjs/core/scene';
import { TileGeometry } from '../geometry/TileGeometry.js';
import { resolveMartiniMaxError } from '../geometry/terrainError.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
// vite 构建时把 lerc 的 wasm 拷贝到产物目录并返回 URL；
// 传给 load({ locateFile }) 避免 lerc 运行时自动探测 wasm 失败（dev/生产均可用）。
import lercWasmUrl from 'lerc/lerc-wasm.wasm?url';

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
 * LERC 地形加载器
 * 支持 ArcGIS LERC 格式的高程数据加载和渲染
 */
export class LercTerrainLoader {
	/** 全局 LERC 解码器（优先用动态 import('lerc') 注入） */
	private static _decoder: LercDecoder | null = null;

	/** ensureDecoder 的初始化 Promise（避免并发重复 import） */
	private static _ensurePromise: Promise<boolean> | null = null;

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
	 * 确保解码器可用：动态 import('lerc') 并缓存到 _decoder。
	 * lerc v4 是 WASM 模块，decode() 依赖 lercLib 初始化，必须先 await load()
	 * 加载 wasm 后 decode 才可用（否则 lercLib.getBlobInfo 为 null 抛错）。
	 * 已手动 setDecoder 时直接成功；import/load 失败返回 false（调用方回退平瓦片）。
	 * @returns 解码器是否可用
	 */
	public static ensureDecoder(): Promise<boolean> {
		if (LercTerrainLoader._decoder) {
			return Promise.resolve(true);
		}
		if (!LercTerrainLoader._ensurePromise) {
			LercTerrainLoader._ensurePromise = import('lerc')
				.then(async (mod: any) => {
					const Lerc = mod.default ?? mod;
					// 初始化 wasm（lercLib 的 getBlobInfo/decode 依赖 wasm 就绪）。
					// locateFile 指向构建产物中的 wasm（?url 导入），避免运行时探测失败。
					if (typeof Lerc.load === 'function') {
						await Lerc.load({ locateFile: () => lercWasmUrl });
					}
					LercTerrainLoader.setDecoder(
						(buffer: ArrayBuffer) => Lerc.decode(buffer) as LercDecodeResult
					);
					return true;
				})
				.catch(() => false);
		}
		return LercTerrainLoader._ensurePromise;
	}

	/**
	 * 从 ArrayBuffer 加载 LERC 地形并创建网格
	 *
	 * @param buffer LERC 编码的二进制数据
	 * @param z 瓦片层级（请求/显示层级，用于确定 Martini 误差阈值）
	 * @param clipBounds 裁剪范围 [minX, minY, maxX, maxY]（0-1 归一化，minY 为北）
	 * @param scene Babylon.js 场景
	 * @param heightScale 高程缩放因子（米 → 局部坐标）
	 * @param skirtHeight 裙边高度（局部坐标）
	 * @param worldScale 瓦片世界宽度（米），用于在世界尺寸空间计算法线，默认 1
	 * @param refError 参考误差（米，z=14 处），默认 10
	 * @returns 地形网格
	 */
	public static createTerrainMesh(
		buffer: ArrayBuffer,
		z: number,
		clipBounds: [number, number, number, number],
		scene: Scene,
		heightScale: number = 1,
		skirtHeight: number = 0,
		worldScale: number = 1,
		refError: number = 10
	): Mesh {
		if (!LercTerrainLoader._decoder) {
			throw new Error(
				'LERC decoder not set. Call LercTerrainLoader.setDecoder() or ensureDecoder() first. ' +
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

		// 3. 确保 2^n+1 尺寸（Martini 要求）：512×512 → 513×513（复制南/东缘）。
		//    超采样裁剪路径（k≥1）产出已是 2^n+1，此步幂等。
		demData = LercTerrainLoader._ensureMartiniSize(demData);

		// 4. 使用 Martini 生成自适应三角网
		const { array: terrain, width: gridSize } = demData;
		// 误差按瓦片尺寸缩放（与 terrain-rgb 统一），z 用显示层级
		const maxError = resolveMartiniMaxError(z, worldScale, refError, { gridSize });

		return TileGeometry.createMartiniTile(
			`lerc-terrain-z${z}`,
			scene,
			terrain,
			maxError,
			skirtHeight,
			heightScale,
			worldScale
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
	 * 确保 DEM 为 2^n+1 正方形（Martini 兼容）。
	 * 非 2^n+1 时上采样为 (p+1)×(p+1)，复制南缘/东缘行（与 TerrainRGBParser.parse
	 * 一致）：每个瓦片包含与相邻瓦片共享的边缘采样点，边缘高度一致、无缝。
	 * @param demData 原始 DEM 数据
	 * @returns 2^n+1 尺寸的 DEM 数据
	 */
	private static _ensureMartiniSize(demData: DEMData): DEMData {
		const { array, width, height } = demData;
		if (width !== height) {
			return demData; // 非正方形交由调用方兜底
		}
		const p = width;
		// 已是 2^n+1（如 257/513）则原样返回
		if (((p - 1) & (p - 2)) === 0) {
			return demData;
		}

		// p×p → (p+1)×(p+1)
		const out = new Float32Array((p + 1) * (p + 1));
		for (let r = 0; r < p; r++) {
			const src = r * p;
			const dst = r * (p + 1);
			for (let c = 0; c < p; c++) {
				out[dst + c] = array[src + c];
			}
		}
		// 南缘（复制最后一行）
		for (let c = 0; c < p; c++) {
			out[p * (p + 1) + c] = out[(p - 1) * (p + 1) + c];
		}
		// 东缘（复制最后一列）
		for (let r = 0; r < p; r++) {
			out[r * (p + 1) + p] = out[r * (p + 1) + (p - 1)];
		}
		// 东南角
		out[p * (p + 1) + p] = out[(p - 1) * (p + 1) + (p - 1)];

		return { array: out, width: p + 1, height: p + 1 };
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
	 * 先裁剪出子区域，再最近邻缩放到目标尺寸
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

		// 最近邻缩放到目标尺寸
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
