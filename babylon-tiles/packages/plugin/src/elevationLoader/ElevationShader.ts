/**
 * @description: 高程分段着色材质
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile elevationLoader/ElevationShader：
 * - 按顶点高度分段着色（水/沙滩/草地/岩石/雪），带简单方向光。
 * - Babylon 网格 Y=高度（区别于 three-tile 的 position.z），shader 用 position.y。
 */

import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';

/** 顶点着色器：输出世界空间法线与顶点高度 */
const vertexSrc = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 worldViewProjection;

varying vec3 vNormalW;
varying float vHeight;

void main() {
    vNormalW = normalize(mat3(world) * normal);
    vHeight = position.y;
    gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

/** 片元着色器：高度分段混合颜色 + 简单光照 */
const fragmentSrc = /* glsl */ `
precision highp float;

varying vec3 vNormalW;
varying float vHeight;

uniform float uMinHeight;
uniform float uMaxHeight;
uniform vec3 uWaterColor;
uniform vec3 uSandColor;
uniform vec3 uGrassColor;
uniform vec3 uRockColor;
uniform vec3 uSnowColor;

// 平滑过渡函数
float smoothBlend(float edge0, float edge1, float x) {
    float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

void main() {
    // 归一化高度 (0到1之间)
    float normalizedHeight = (vHeight - uMinHeight) / (uMaxHeight - uMinHeight);

    // 定义各高度段的阈值
    float waterLevel = 0.2;
    float sandLevel = 0.3;
    float grassLevel = 0.6;
    float rockLevel = 0.85;

    // 根据高度混合颜色
    vec3 color;

    if (normalizedHeight < waterLevel) {
        // 水区域 - 深蓝色到浅蓝色
        float t = smoothBlend(0.0, waterLevel, normalizedHeight);
        color = mix(uWaterColor * 0.5, uWaterColor, t);
    } else if (normalizedHeight < sandLevel) {
        // 沙滩区域 - 浅蓝色到沙色
        float t = smoothBlend(waterLevel, sandLevel, normalizedHeight);
        color = mix(uWaterColor, uSandColor, t);
    } else if (normalizedHeight < grassLevel) {
        // 草地区域 - 沙色到绿色
        float t = smoothBlend(sandLevel, grassLevel, normalizedHeight);
        color = mix(uSandColor, uGrassColor, t);
    } else if (normalizedHeight < rockLevel) {
        // 岩石区域 - 绿色到棕色
        float t = smoothBlend(grassLevel, rockLevel, normalizedHeight);
        color = mix(uGrassColor, uRockColor, t);
    } else {
        // 雪地区域 - 棕色到白色
        float t = smoothBlend(rockLevel, 1.0, normalizedHeight);
        color = mix(uRockColor, uSnowColor, t);
    }

    // 添加简单光照效果（基于法线）
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
    float diffuse = dot(normalize(vNormalW), lightDir) * 0.5 + 0.5;
    color *= diffuse;

    gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * 高程分段着色材质
 */
export class ElevationShader extends ShaderMaterial {
	private _minHeight = 0;
	private _maxHeight = 1000;

	/** 获取最小高度 */
	public get minHeight(): number {
		return this._minHeight;
	}
	/** 设置最小高度 */
	public set minHeight(value: number) {
		this._minHeight = value;
		this.setFloat('uMinHeight', value);
	}
	/** 获取最大高度 */
	public get maxHeight(): number {
		return this._maxHeight;
	}
	/** 设置最大高度 */
	public set maxHeight(value: number) {
		this._maxHeight = value;
		this.setFloat('uMaxHeight', value);
	}

	constructor(scene: Scene, minH: number, maxH: number) {
		super(
			'eleator-shader',
			scene,
			{
				vertexSource: vertexSrc,
				fragmentSource: fragmentSrc,
			},
			{
				attributes: ['position', 'normal'],
				uniforms: [
					'world',
					'worldViewProjection',
					'uMinHeight',
					'uMaxHeight',
					'uWaterColor',
					'uSandColor',
					'uGrassColor',
					'uRockColor',
					'uSnowColor',
				],
			}
		);
		this._minHeight = minH;
		this._maxHeight = maxH;
		this.setFloat('uMinHeight', minH);
		this.setFloat('uMaxHeight', maxH);
		this.setColor3('uWaterColor', new Color3(0.1, 0.3, 0.7));
		this.setColor3('uSandColor', new Color3(0.76, 0.7, 0.5));
		this.setColor3('uGrassColor', new Color3(0.3, 0.6, 0.2));
		this.setColor3('uRockColor', new Color3(0.5, 0.4, 0.3));
		this.setColor3('uSnowColor', new Color3(0.95, 0.95, 1.0));
		// 与瓦片几何绕序兼容（见 TileMaterial 手性系说明）
		this.backFaceCulling = false;
	}
}
