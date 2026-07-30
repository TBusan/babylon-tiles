/**
 * @description: 影像滤镜材质
 * 支持亮度、对比度、饱和度、色调调节
 * 基于 Babylon.js ShaderMaterial 实现
 *
 * 移植自 three-tile 的 TileFilterMaterial
 */

import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

// 注册自定义 Shader 到 Babylon.js ShaderStore
const FILTER_VERTEX_SHADER = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FILTER_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D u_texture;
uniform float brightness;
uniform float contrast;
uniform float hue;
uniform float saturation;
uniform float alpha;

void main() {
    vec4 texColor = texture2D(u_texture, vUv);

    // 亮度调节：mix(black, color, brightness)
    texColor.rgb = mix(vec3(0.0), texColor.rgb, brightness);

    // 对比度调节：mix(gray, color, contrast)
    texColor.rgb = mix(vec3(0.5), texColor.rgb, contrast);

    // 色调旋转（hue rotation）
    float angle = hue * 3.14159265;
    float s = sin(angle), c = cos(angle);
    vec3 weights = (vec3(2.0 * c, -sqrt(3.0) * s - c, sqrt(3.0) * s - c) + 1.0) / 3.0;
    texColor.rgb = vec3(
        dot(texColor.rgb, weights.xyz),
        dot(texColor.rgb, weights.zxy),
        dot(texColor.rgb, weights.yzx)
    );

    // 饱和度调节
    float average = (texColor.r + texColor.g + texColor.b) / 3.0;
    if (saturation > 0.0) {
        texColor.rgb += (average - texColor.rgb) * (1.0 - 1.0 / (1.001 - saturation));
    } else {
        texColor.rgb += (average - texColor.rgb) * (-saturation);
    }

    gl_FragColor = vec4(texColor.rgb, texColor.a * alpha);
}
`;

// 注册 shader 到全局 ShaderStore
Effect.ShadersStore['tileFilterVertexShader'] = FILTER_VERTEX_SHADER;
Effect.ShadersStore['tileFilterFragmentShader'] = FILTER_FRAGMENT_SHADER;

/**
 * 滤镜参数
 */
export interface FilterOptions {
	/** 亮度 (0-2，默认 1 = 原始亮度) */
	brightness?: number;
	/** 对比度 (0-2，默认 1 = 原始对比度) */
	contrast?: number;
	/** 色调旋转 (0-1，默认 0 = 不旋转) */
	hue?: number;
	/** 饱和度 (-1 到 1，默认 0 = 原始饱和度) */
	saturation?: number;
	/** 透明度 (0-1，默认 1) */
	opacity?: number;
}

/**
 * 影像滤镜材质
 * 在标准纹理材质基础上添加亮度/对比度/饱和度/色调后处理
 *
 * 使用示例：
 * ```ts
 * const filterMat = TileFilterMaterial.create(scene, {
 *     brightness: 1.2,
 *     contrast: 1.1,
 *     saturation: -0.3,
 * });
 * filterMat.setTexture('u_texture', myTexture);
 * mesh.material = filterMat;
 * ```
 */
export class TileFilterMaterial extends ShaderMaterial {
	/**
	 * 创建滤镜材质
	 * @param scene Babylon.js 场景
	 * @param options 滤镜参数
	 * @returns ShaderMaterial 实例
	 */
	public static create(scene: Scene, options: FilterOptions = {}): TileFilterMaterial {
		return new TileFilterMaterial(scene, options);
	}

	constructor(scene: Scene, options: FilterOptions = {}) {
		const {
			brightness = 1.0,
			contrast = 1.0,
			hue = 0.0,
			saturation = 0.0,
			opacity = 1.0,
		} = options;

		super('tileFilterMaterial', scene, 'tileFilter', {
			attributes: ['position', 'uv'],
			uniforms: ['worldViewProjection', 'brightness', 'contrast', 'hue', 'saturation', 'alpha'],
			samplers: ['u_texture'],
		});

		// 设置默认 uniform 值
		this.setFloat('brightness', brightness);
		this.setFloat('contrast', contrast);
		this.setFloat('hue', hue);
		this.setFloat('saturation', saturation);
		this.setFloat('alpha', opacity);

		// 启用透明
		this.alphaMode = 2; // BABYLON.Constants.ALPHA_COMBINE
		this.backFaceCulling = true;
	}

	/** 设置亮度 */
	public set brightness(value: number) {
		this.setFloat('brightness', value);
	}

	/** 设置对比度 */
	public set contrast(value: number) {
		this.setFloat('contrast', value);
	}

	/** 设置色调旋转 */
	public set hue(value: number) {
		this.setFloat('hue', value);
	}

	/** 设置饱和度 */
	public set saturation(value: number) {
		this.setFloat('saturation', value);
	}

	/** 设置透明度 */
	public set opacity(value: number) {
		this.setFloat('alpha', value);
	}

	/**
	 * 设置 diffuse 纹理
	 * @param texture 纹理对象
	 */
	public set diffuseTexture(texture: Texture | null) {
		if (texture) {
			this.setTexture('u_texture', texture);
		}
	}
}
