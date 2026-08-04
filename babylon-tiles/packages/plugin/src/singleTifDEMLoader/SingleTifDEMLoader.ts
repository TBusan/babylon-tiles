/**
 * @description: 单张 TIF DEM 地形加载器
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile singleTifDEMLoader：
 * - dataType='single-tif'，用 utif 解码整幅 GeoTIFF，按瓦片投影边界裁剪并缩放成
 *   规则网格（非 Martini，因为 parse 输出 targetSize×targetSize 不保证 2^n+1）。
 * - 用 TileGeometry.createTile 生成网格（Babylon Y-up，posY=高程）。
 *
 * 行序说明：parse 输出第 0 行为源影像第 0 行（北），而 createTile 的 heights 索引
 * y=0 为南（posZ=-0.5），因此按行翻转，等价于 three-tile setData 的
 * `dem[(height-y-1)*width+x]`（见 [[babylon-tiles-orientation-conventions]]）。
 */

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import {
	ITileGeometryLoader,
	ITileLoaderInfo,
	TileGeometry,
	TileSourceLoadParamsType,
} from '@babylon-tile/lib';
import UTIF from 'utif';
import { SingleTifDEMSource } from './SingleTifDEMSource.js';
import { DEMType, parse } from './parse.js';

/**
 * 单张 TIF DEM 地形加载器
 */
export class SingleTifDEMLoader implements ITileGeometryLoader<Mesh> {
	/** 加载器信息 */
	public readonly info: ITileLoaderInfo = {
		author: 'chaoxl',
		version: '1.0.0',
		description: 'TIF DEM terrain loader. It can load single tif dem.',
	};

	/** 数据类型标识 */
	public readonly dataType = 'single-tif';

	/** 标识为几何体加载器 */
	public readonly isMaterialLoader = false;

	/**
	 * 加载瓦片几何体
	 * @param params 加载参数（含 source/coords/bounds/scene）
	 * @returns 瓦片网格；scene 缺失或层级过低/无 url 时返回 undefined（回退平瓦片）
	 */
	public async load(params: TileSourceLoadParamsType<SingleTifDEMSource>): Promise<Mesh | undefined> {
		const { source, z, bounds, scene, x, y } = params;
		if (!scene) return undefined;

		// 获取 TIF 文件的 URL（单张图与瓦片坐标无关）
		const url = source.getUrl(0, 0, 0);
		// 请求的瓦片不在数据源范围内或没有 url，直接返回空几何体（回退平瓦片）
		if (z < source.minLevel || !url) {
			return undefined;
		}

		// 抽稀像素点，根据瓦片层级计算目标像素大小，并限制在 2~256 之间
		const targetSize = Math.min(Math.max((z + 2) * 3, 2), 256);

		// 如果数据未加载，加载并解析 TIF 文件
		if (!source.data) {
			const buffer = await this._loadArrayBuffer(url);
			source.data = this.getTIFFRaster(buffer);
		}

		// 按当前瓦片投影边界裁剪 DEM 到 targetSize×targetSize
		const dem = parse(source.data, source._projectionBounds!, bounds, targetSize, targetSize);

		// 行翻转：parse 第 0 行为北，createTile heights 第 0 行为南
		const size = targetSize;
		const flipped = new Float32Array(dem.length);
		for (let r = 0; r < size; r++) {
			flipped.set(dem.subarray(r * size, (r + 1) * size), (size - 1 - r) * size);
		}

		// 世界宽度（用于世界尺寸空间法线，与内置 terrain-rgb 一致）
		const worldScale = bounds[2] - bounds[0];

		return TileGeometry.createTile(`tif-${z}-${x}-${y}`, {
			scene,
			heights: flipped,
			segmentsW: size - 1,
			segmentsH: size - 1,
			skirtHeight: source.skirtHeight,
			worldScale,
		});
	}

	/**
	 * 从 ArrayBuffer 中读取 TIFF 图像的栅格数据
	 * @param buffer 包含 TIFF 图像数据的 ArrayBuffer
	 * @returns 包含栅格数据的对象，包含 buffer、width 和 height 属性
	 */
	public getTIFFRaster(buffer: ArrayBuffer): DEMType {
		const ifds = UTIF.decode(buffer);
		UTIF.decodeImage(buffer, ifds[0]);
		const buf = new Float32Array(ifds[0].data.buffer);
		return {
			buffer: buf,
			width: ifds[0].t256[0],
			height: ifds[0].t257[0],
		};
	}

	/**
	 * 加载 ArrayBuffer（带安全超时）
	 */
	private _loadArrayBuffer(url: string): Promise<ArrayBuffer> {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.responseType = 'arraybuffer';
			let settled = false;
			const settle = (fn: () => void) => {
				if (!settled) {
					settled = true;
					clearTimeout(timeout);
					fn();
				}
			};
			const timeout = setTimeout(() => {
				settle(() => reject(new Error(`TIF load timeout: ${url}`)));
			}, 30000);
			xhr.onload = () => {
				if (xhr.status >= 200 && xhr.status < 300) {
					settle(() => resolve(xhr.response as ArrayBuffer));
				} else {
					settle(() => reject(new Error(`TIF load failed: ${xhr.status} ${url}`)));
				}
			};
			xhr.onerror = () => settle(() => reject(new Error(`TIF load failed: ${url}`)));
			xhr.open('GET', url, true);
			xhr.send();
		});
	}
}
