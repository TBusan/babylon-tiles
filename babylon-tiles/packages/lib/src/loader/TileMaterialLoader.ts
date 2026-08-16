/**
 * @description: 瓦片材质加载器抽象基类（插件材质 loader 继承）
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile 的 TileMaterialLoader：
 * - load() 统一走 getSafeTileUrlAndBounds（超级别回退取父瓦片）→ doLoad(url, {clipBounds})
 * - createMaterial(scene) 创建默认瓦片材质（子类可覆盖，如 elevation 返回 ShaderMaterial）
 * - Babylon 材质必须绑定 Scene，因此 scene 取自 params.scene（由 TileLoader 分发时填充），
 *   区别于 three.js（材质与场景无关）。
 */

import type { Scene } from '@babylonjs/core/scene';
import { Material } from '@babylonjs/core/Materials/material';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';

import type {
	ITileMaterialLoader,
	ITileLoaderInfo,
	TileLoadClipParamsType,
	TileSourceLoadParamsType,
} from './ITileLoaders.js';
import { TileMaterial } from '../material/TileMaterial.js';
import { getSafeTileUrlAndBounds } from './TileMaterialLoaders.js';

/**
 * 图片材质加载器抽象基类
 * 子类实现 doLoad(url, params) 返回瓦片纹理（Canvas 绘制/网络解码等）。
 */
export abstract class TileMaterialLoader implements ITileMaterialLoader<Material> {
	/** 加载器信息 */
	public readonly info: ITileLoaderInfo = {
		version: '1.0.0',
		description: 'Image loader base class',
	};

	/** 数据类型标识（子类覆盖） */
	public dataType = '';

	/** 标识为材质加载器 */
	public readonly isMaterialLoader = true;

	/**
	 * 加载瓦片材质
	 * @param params - 加载参数（含 source/coords/bounds/scene）
	 * @returns 瓦片材质；scene 缺失时抛错（调用方 catch 兜底回退背景材质）
	 */
	public async load(params: TileSourceLoadParamsType): Promise<Material | undefined> {
		const { source, x, y, z, scene } = params;
		if (!scene) {
			throw new Error(`TileMaterialLoader(${this.dataType}): scene not provided in params`);
		}

		const material = this.createMaterial(scene);
		if (!material) {
			return undefined;
		}

		// 超级别回退：z > maxLevel 时取父瓦片 URL + 子区域裁剪范围
		const { url, clipBounds } = getSafeTileUrlAndBounds(source, x, y, z);
		if (url) {
			const texture = await this.doLoad(url, { ...params, clipBounds });
			if (texture) {
				const std = material as StandardMaterial;
				std.diffuseTexture = texture;
				// 瓦片纹理边缘必须 CLAMP（与内置 image loader 一致，避免接缝）
				texture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
				texture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
				std.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
			}
		}
		return material;
	}

	/**
	 * 卸载材质（释放纹理与材质）
	 */
	public unload(material: Material): void {
		const std = material as StandardMaterial;
		if (std.diffuseTexture) {
			std.diffuseTexture.dispose();
		}
		material.dispose();
	}

	/**
	 * 创建默认瓦片材质（子类可覆盖）
	 * @param scene - Babylon 场景
	 * @returns 默认透明瓦片材质
	 */
	public createMaterial(scene: Scene): Material {
		return TileMaterial.createTileMaterial({
			scene,
			name: `${this.dataType}-tile-material`,
			transparent: true,
		});
	}

	/**
	 * 下载/绘制瓦片纹理（抽象）
	 * @param url - 瓦片 URL
	 * @param params - 加载参数（含 clipBounds）
	 * @returns 瓦片纹理；返回 undefined 表示无纹理（保持默认材质）
	 */
	protected abstract doLoad(url: string, params: TileLoadClipParamsType): Promise<Texture | undefined>;
}
