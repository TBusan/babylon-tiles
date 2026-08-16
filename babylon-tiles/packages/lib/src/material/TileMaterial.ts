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
import { Constants } from '@babylonjs/core/Engines/constants';

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
			// 默认关闭背面剔除。瓦片几何体的顶点绕序是从 three.js（右手系）移植过来的，
			// 在 three.js 的右手裁剪空间里它是正面（FrontSide 可见）；但 Babylon.js 默认左手系，
			// 同一绕序在屏幕空间里变成了背面，若开启 backFaceCulling 会把每一块瓦片四边形都剔除，
			// 表现为整屏空白/黑屏。相机被 upperBetaLimit 限制在地平线以上，永远看不到四边形底面，
			// 因此关闭剔除在视觉上与 three.js 的 FrontSide 等价，且不影响光照（法线属性仍朝上）。
			backFaceCulling = false,
			specularColor,
			wireframe = false,
		} = options;

		const material = new StandardMaterial(name, scene);

		// 设置漫反射纹理
		if (diffuseTexture) {
			material.diffuseTexture = diffuseTexture;
			// 瓦片纹理边缘必须 CLAMP：默认 REPEAT 会让 UV=0/1 处的双线性采样
			// 取到同一张瓦片对侧边缘的纹素，在每块瓦片边界混入错误颜色，形成
			// 明显接缝（three-tile 用 ClampToEdgeWrapping，此处移植时漏掉了）。
			diffuseTexture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
			diffuseTexture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
			// 双线性过滤（LINEAR_LINEAR，无 mipmap）：避免 mipmap 在不同瓦片
			// 层级不一致时在边界产生亮度差异。
			diffuseTexture.updateSamplingMode(Constants.TEXTURE_BILINEAR_SAMPLINGMODE);
		} else if (diffuseColor) {
			material.diffuseColor = diffuseColor;
		} else {
			material.diffuseColor = new Color3(1, 1, 1);
		}

		// 设置法线纹理
		if (normalTexture) {
			material.bumpTexture = normalTexture;
			material.bumpTexture.level = 1; // 法线强度
			normalTexture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
			normalTexture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
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
			// 见 createTileMaterial 中关于绕序/手性系的说明：移植自 three.js 右手系的绕序在
			// Babylon 左手系下是背面，开启剔除会导致整屏空白，故默认关闭。
			backFaceCulling = false,
			roughness = 0.8,
			metallic = 0,
		} = options;

		const material = new PBRMaterial(name, scene);

		// 设置漫反射纹理/颜色
		if (diffuseTexture) {
			material.albedoTexture = diffuseTexture;
			// 同 createTileMaterial：瓦片纹理边缘必须 CLAMP，否则双线性采样
			// 在 UV=0/1 处混入同瓦片对侧边缘纹素，产生明显接缝。
			diffuseTexture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
			diffuseTexture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
			diffuseTexture.updateSamplingMode(Constants.TEXTURE_BILINEAR_SAMPLINGMODE);
		} else if (diffuseColor) {
			material.albedoColor = diffuseColor;
		} else {
			material.albedoColor = new Color3(1, 1, 1);
		}

		// 设置法线纹理
		if (normalTexture) {
			material.bumpTexture = normalTexture;
			normalTexture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
			normalTexture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
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
	public static createWireframeMaterial(scene: Scene, color: Color3 = new Color3(0, 1, 0)): StandardMaterial {
		const material = new StandardMaterial('tile-wireframe-material', scene);
		material.wireframe = true;
		material.emissiveColor = color;
		material.disableLighting = true;
		return material;
	}
}
