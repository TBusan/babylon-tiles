/**
 * @description: 瓦片图像加载器
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

import type { ISource } from '../source/ISource.js';
import type { ITileMaterialLoader, TileSourceLoadParamsType, ITileLoaderInfo } from './ITileLoaders.js';
import { TileMaterial } from '../material/TileMaterial.js';

/**
 * 瓦片图像加载器
 * 用于加载标准的图像瓦片格式（如 PNG, JPG）
 */
export class TileImageLoader implements ITileMaterialLoader<StandardMaterial> {
	/** 标识为材质加载器 */
	public readonly isMaterialLoader = true;

	/** 加载器信息 */
	public readonly info: ITileLoaderInfo = {
		version: '1.0.0',
		author: 'Babylon-Tile Team',
		description: 'Standard tile image loader for PNG, JPG formats',
	};

	/** 数据类型标识 */
	public readonly dataType = 'image';

	/**
	 * 加载图像瓦片材质
	 * @param params - 加载参数，包含数据源和瓦片坐标
	 * @returns Promise<StandardMaterial> - 加载后的材质
	 */
	public async load(params: TileSourceLoadParamsType): Promise<StandardMaterial> {
		const { source, x, y, z } = params;

		// 获取瓦片 URL
		const url = source.getUrl(x, y, z);

		// 创建材质
		const scene = this._getScene();
		const material = TileMaterial.createTileMaterial({
			scene,
			name: `tile-${z}-${x}-${y}-material`,
			diffuseTexture: new Texture(url, scene),
			opacity: source.opacity ?? 1,
			transparent: source.transparent ?? false,
		});

		return material;
	}

	/**
	 * 卸载材质
	 * @param material - 要卸载的材质
	 */
	public unload(material: StandardMaterial): void {
		// 释放纹理资源
		if (material.diffuseTexture) {
			material.diffuseTexture.dispose();
		}
		// 释放材质资源
		material.dispose();
	}

	/**
	 * 获取当前场景（从全局或参数中）
	 * 这是一个临时实现，实际使用时应该从上下文中获取
	 */
	private _getScene(): Scene {
		// TODO: 从上下文或参数中获取场景
		// 这是一个简化实现，实际使用时需要改进
		throw new Error('Scene not provided. Please implement proper scene management.');
	}
}

/**
 * 带场景的图像加载器
 * 改进版本，可以通过构造函数传入场景
 */
export class TileImageLoaderWithScene implements ITileMaterialLoader<StandardMaterial> {
	/** 标识为材质加载器 */
	public readonly isMaterialLoader = true;

	/** 加载器信息 */
	public readonly info: ITileLoaderInfo = {
		version: '1.0.0',
		author: 'Babylon-Tile Team',
		description: 'Standard tile image loader with scene support',
	};

	/** 数据类型标识 */
	public readonly dataType = 'image';

	/** 场景 */
	private readonly _scene: Scene;

	/**
	 * 构造函数
	 * @param scene - Babylon.js 场景
	 */
	constructor(scene: Scene) {
		this._scene = scene;
	}

	/**
	 * 加载图像瓦片材质
	 */
	public async load(params: TileSourceLoadParamsType): Promise<StandardMaterial> {
		const { source, x, y, z } = params;
		const url = source.getUrl(x, y, z);

		const material = TileMaterial.createTileMaterial({
			scene: this._scene,
			name: `tile-${z}-${x}-${y}-material`,
			diffuseTexture: new Texture(url, this._scene),
			opacity: source.opacity ?? 1,
			transparent: source.transparent ?? false,
		});

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
}
