/**
 * @description: 瓦片材质类
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

/**
 * 瓦片材质选项
 */
export interface TileMaterialOptions {
	/** 场景 */
	scene: Scene;
	/** 材质名称 */
	name?: string;
	/** 漫反射纹理 */
	diffuseTexture?: Texture;
	/** 法线纹理 */
	normalTexture?: Texture;
	/** 是否使用 PBR 材质 */
	usePBR?: boolean;
	/** 漫反射颜色 */
	diffuseColor?: Color3;
	/** 环境颜色 */
	emissiveColor?: Color3;
	/** 透明度（0-1） */
	opacity?: number;
	/** 是否透明 */
	transparent?: boolean;
	/** 背面剔除 */
	backFaceCulling?: boolean;
	/** 镜面反射颜色 */
	specularColor?: Color3;
	/** 粗糙度（仅 PBR） */
	roughness?: number;
	/** 金属度（仅 PBR） */
	metallic?: number;
	/** 是否线框模式 */
	wireframe?: boolean;
}

/**
 * 瓦片材质类
 * 用于创建和管理地图瓦片的渲染材质
 */
export class TileMaterial {
	/**
	 * 创建标准瓦片材质
	 * @param options - 材质选项
	 * @returns 标准材质
	 */
	public static createTileMaterial(options: TileMaterialOptions): StandardMaterial {
		const {
			scene,
			name = 'tile-material',
			diffuseTexture,
			normalTexture,
			diffuseColor,
			emissiveColor,
			opacity = 1,
			transparent = false,
			backFaceCulling = true,
			specularColor,
			wireframe = false,
		} = options;

		const material = new StandardMaterial(name, scene);

		// 设置漫反射纹理
		if (diffuseTexture) {
			material.diffuseTexture = diffuseTexture;
			// 优化纹理设置
			diffuseTexture.updateSamplingMode(2); // TRILINEAR sampling
		} else if (diffuseColor) {
			material.diffuseColor = diffuseColor;
		} else {
			material.diffuseColor = new Color3(1, 1, 1);
		}

		// 设置法线纹理
		if (normalTexture) {
			material.bumpTexture = normalTexture;
			material.bumpTexture.level = 1; // 法线强度
		}

		// 设置环境色（默认无自发光）
		if (emissiveColor) {
			material.emissiveColor = emissiveColor;
		} else {
			material.emissiveColor = new Color3(0, 0, 0);
		}

		// 设置镜面反射颜色
		if (specularColor) {
			material.specularColor = specularColor;
		} else {
			// 默认无镜面反射（类似土地）
			material.specularColor = new Color3(0.1, 0.1, 0.1);
		}

		// 设置透明度
		material.alpha = opacity;
		if (transparent || opacity < 1) {
			material.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
		}

		// 设置背面剔除
		material.backFaceCulling = backFaceCulling;

		// 设置线框模式
		material.wireframe = wireframe;

		return material;
	}

	/**
	 * 创建 PBR 瓦片材质
	 * @param options - 材质选项
	 * @returns PBR 材质
	 */
	public static createPBRMaterial(options: TileMaterialOptions): PBRMaterial {
		const {
			scene,
			name = 'tile-pbr-material',
			diffuseTexture,
			normalTexture,
			diffuseColor,
			emissiveColor,
			opacity = 1,
			transparent = false,
			backFaceCulling = true,
			roughness = 0.8,
			metallic = 0,
		} = options;

		const material = new PBRMaterial(name, scene);

		// 设置漫反射纹理/颜色
		if (diffuseTexture) {
			material.albedoTexture = diffuseTexture;
			diffuseTexture.updateSamplingMode(2); // TRILINEAR sampling
		} else if (diffuseColor) {
			material.albedoColor = diffuseColor;
		} else {
			material.albedoColor = new Color3(1, 1, 1);
		}

		// 设置法线纹理
		if (normalTexture) {
			material.bumpTexture = normalTexture;
		}

		// 设置环境色
		if (emissiveColor) {
			material.emissiveColor = emissiveColor;
		}

		// 设置粗糙度和金属度
		material.microSurface = 1 - roughness; // Babylon.js 使用 smoothness 而不是 roughness
		material.metallic = metallic;

		// 设置透明度
		material.alpha = opacity;
		if (transparent || opacity < 1) {
			material.transparencyMode = PBRMaterial.MATERIAL_ALPHABLEND;
		}

		// 设置背面剔除
		material.backFaceCulling = backFaceCulling;

		// 启用物理光照
		material.usePhysicalLightFalloff = true;

		return material;
	}

	/**
	 * 创建背景材质（用于瓦片未加载时显示）
	 * @param scene - 场景
	 * @param color - 背景颜色
	 * @returns 背景材质
	 */
	public static createBackgroundMaterial(scene: Scene, color: Color3 = new Color3(0.1, 0.1, 0.15)): StandardMaterial {
		return TileMaterial.createTileMaterial({
			scene,
			name: 'tile-background-material',
			diffuseColor: color,
			specularColor: new Color3(0, 0, 0),
		});
	}

	/**
	 * 创建错误材质（用于加载失败时显示）
	 * @param scene - 场景
	 * @returns 错误材质
	 */
	public static createErrorMaterial(scene: Scene): StandardMaterial {
		const material = new StandardMaterial('tile-error-material', scene);
		material.diffuseColor = new Color3(1, 0, 0); // 红色
		material.alpha = 0; // 透明，不显示
		material.specularColor = new Color3(0, 0, 0);
		return material;
	}

	/**
	 * 创建调试材质（显示瓦片边界）
	 * @param scene - 场景
	 * @param color - 调试颜色
	 * @returns 调试材质
	 */
	public static createDebugMaterial(scene: Scene, color: Color3 = new Color3(1, 0, 1)): StandardMaterial {
		return TileMaterial.createTileMaterial({
			scene,
			name: 'tile-debug-material',
			diffuseColor: color,
			wireframe: true,
		});
	}

	/**
	 * 从 URL 创建纹理材质
	 * @param scene - 场景
	 * @param textureUrl - 纹理 URL
	 * @param options - 材质选项
	 * @returns 材质
	 */
	public static createFromUrl(
		scene: Scene,
		textureUrl: string,
		options?: Partial<TileMaterialOptions>
	): StandardMaterial {
		const texture = new Texture(textureUrl, scene);
		texture.hasAlpha = options?.transparent || false;

		return TileMaterial.createTileMaterial({
			scene,
			name: options?.name || 'tile-url-material',
			diffuseTexture: texture,
			opacity: options?.opacity,
			transparent: options?.transparent,
		});
	}

	/**
	 * 创建线框材质（用于调试）
	 * @param scene - 场景
	 * @param color - 线框颜色
	 * @returns 线框材质
	 */
	public static createWireframeMaterial(
		scene: Scene,
		color: Color3 = new Color3(0, 1, 0)
	): StandardMaterial {
		const material = new StandardMaterial('tile-wireframe-material', scene);
		material.wireframe = true;
		material.emissiveColor = color;
		material.disableLighting = true;
		return material;
	}
}
