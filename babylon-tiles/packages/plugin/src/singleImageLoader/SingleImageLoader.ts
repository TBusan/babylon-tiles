/**
 * @description: 单影像材质加载器
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile singleImageLoader：
 * - dataType='single-image'，加载单张图片到数据源 bounds 并贴地。
 * - 每块瓦片根据投影边界从原图裁剪出对应子区域，绘制到 256×256 纹理。
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Scene } from '@babylonjs/core/scene';

import {
	ITileMaterialLoader,
	ITileLoaderInfo,
	TileMaterial,
	TileSourceLoadParamsType,
} from '@babylon-tile/lib';
import { SingleImageSource } from './SingleImageSource.js';

/**
 * 单影像材质加载器
 */
export class SingleImageLoader implements ITileMaterialLoader<StandardMaterial> {
	/** 加载器信息 */
	public readonly info: ITileLoaderInfo = {
		version: '1.0.0',
		description: 'Single image loader. It can load single image to bounds and stick to the ground.',
	};

	/** 数据类型标识 */
	public readonly dataType = 'single-image';

	/** 标识为材质加载器 */
	public readonly isMaterialLoader = true;

	/**
	 * 加载单影像瓦片材质
	 * @param params - 加载参数
	 * @returns 瓦片材质；scene 缺失时返回 undefined（静默跳过）
	 */
	public async load(params: TileSourceLoadParamsType<SingleImageSource>): Promise<StandardMaterial | undefined> {
		const { scene, source, bounds, z, x, y } = params;
		if (!scene) return undefined;

		const material = TileMaterial.createTileMaterial({
			scene,
			name: `single-image-${z}-${x}-${y}`,
			transparent: true,
			opacity: source.opacity,
		});

		const url = source.getUrl(0, 0, 0);

		// 请求的瓦片不在数据源范围内或没有 url，直接返回材质
		if (z < source.minLevel || z > source.maxLevel || !url) {
			return material;
		}

		// 如果图片已加载，则设置纹理后返回材质
		if (source.image?.complete) {
			this._setTexture(material, source.image, source, bounds);
			return material;
		}

		// 加载纹理
		source.image = await this._loadImage(url);
		this._setTexture(material, source.image, source, bounds);
		return material;
	}

	/**
	 * 卸载材质
	 */
	public unload(material: StandardMaterial): void {
		if (material.diffuseTexture) {
			material.diffuseTexture.dispose();
		}
		material.dispose();
	}

	/**
	 * 设置纹理
	 */
	private _setTexture(
		material: StandardMaterial,
		image: HTMLImageElement,
		source: SingleImageSource,
		tileBounds: [number, number, number, number]
	): void {
		const texture = this._getTileTexture(image, source._projectionBounds!, tileBounds, material.getScene());
		material.diffuseTexture = texture;
	}

	/**
	 * 从原图中裁剪当前瓦片子区域，生成 256×256 瓦片纹理
	 * @param image 原图
	 * @param mapBounds 原图覆盖的投影边界 [minX, minY, maxX, maxY]
	 * @param tileBounds 当前瓦片投影边界
	 * @param scene Babylon 场景
	 */
	private _getTileTexture(
		image: HTMLImageElement,
		mapBounds: [number, number, number, number],
		tileBounds: [number, number, number, number],
		scene: Scene
	): DynamicTexture {
		const tileSize = 256;
		const canvas = document.createElement('canvas');
		canvas.width = tileSize;
		canvas.height = tileSize;
		const ctx = canvas.getContext('2d');

		if (ctx && image) {
			const width = image.width;
			const height = image.height;

			const scaleX = (mapBounds[2] - mapBounds[0]) / width;
			const scaleY = (mapBounds[3] - mapBounds[1]) / height;

			// 源图第 0 行为北（投影 Y 增大方向朝北），sy 从图顶（北）开始取
			const sx = (tileBounds[0] - mapBounds[0]) / scaleX;
			const sy = (mapBounds[3] - tileBounds[3]) / scaleY;

			const swidth = (tileBounds[2] - tileBounds[0]) / scaleX;
			const sheight = (tileBounds[3] - tileBounds[1]) / scaleY;

			ctx.drawImage(image, sx, sy, swidth, sheight, 0, 0, tileSize, tileSize);
		}

		const texture = new DynamicTexture(`single-image-${tileBounds[0]}-${tileBounds[1]}`, canvas, scene, false);
		// 瓦片纹理边缘必须 CLAMP（与内置 image loader 一致，避免接缝）
		texture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
		texture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
		texture.hasAlpha = true;
		texture.update();
		return texture;
	}

	/**
	 * 加载图片
	 */
	private _loadImage(url: string): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
			img.src = url;
		});
	}
}
