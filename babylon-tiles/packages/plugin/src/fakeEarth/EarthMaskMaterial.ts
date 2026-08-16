/**
 * @description: 伪球体（FakeEarth）材质
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile fakeEarth/EarthMaskMaterial + demo main.ts 内联 createFakeEarth：
 * - ShaderMaterial：UV 距离中心越远 → 球体/内发光/白边/外泛光/透明。
 * - demo 已验证的关键设置：needAlphaBlending=()=>true、disableDepthWrite、backFaceCulling=false。
 */

import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';

const vertexSrc = /* glsl */ `
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

const fragmentSrc = /* glsl */ `
precision highp float;

varying vec2 vUv;
uniform vec3 airColor;

void main() {
    // 当前点距中点的距离
    float d = distance(vUv, vec2(0.5));
    d = d * d * 100.0;

    if (d < 0.86) {
        // 球体颜色（中心透明，边缘渐变到不透明）
        float a = smoothstep(0.0, 1.0, d);
        gl_FragColor = vec4(vec3(0.0), a);
    } else if (d <= 0.98) {
        // 内发光
        float c = (d - 0.86) / (0.98 - 0.86);
        gl_FragColor = vec4(mix(vec3(0.0), airColor, pow(c, 8.0)), 1.0);
    } else if (d <= 1.0) {
        // 白边
        float c = (d - 0.98) / (1.0 - 0.98);
        gl_FragColor = vec4(mix(airColor, vec3(0.6), pow(c, 2.0)), 1.0);
    } else if (d <= 1.5) {
        // 外泛光
        float c = (d - 1.0) / (1.5 - 1.0);
        gl_FragColor = vec4(mix(vec3(0.6), airColor, c), 1.0 - c);
    } else {
        // 球体外透明
        discard;
    }
}
`;

/**
 * 伪球体材质
 */
export class EarthMaskMaterial extends ShaderMaterial {
	private _bkColor: Color3;
	private _airColor: Color3;

	/** 背景色（shader 未使用，仅为 API 兼容保留） */
	public get bkColor(): Color3 {
		return this._bkColor;
	}
	public set bkColor(value: Color3) {
		this._bkColor = value;
	}
	/** 大气辉光颜色 */
	public get airColor(): Color3 {
		return this._airColor;
	}
	public set airColor(value: Color3) {
		this._airColor = value;
		this.setColor3('airColor', value);
	}

	public constructor(scene: Scene, parameters: { bkColor: Color3; airColor: Color3 }) {
		super(
			'earth-mask-material',
			scene,
			{
				vertexSource: vertexSrc,
				fragmentSource: fragmentSrc,
			},
			{
				attributes: ['position', 'uv'],
				uniforms: ['worldViewProjection', 'airColor'],
			}
		);
		this._bkColor = parameters.bkColor;
		this._airColor = parameters.airColor;
		this.setColor3('airColor', parameters.airColor);
		this.backFaceCulling = false;
		this.alpha = 1.0;
		// 该材质用 gl_FragColor 的 alpha 做混合（demo 已验证）
		this.needAlphaBlending = () => true;
		this.disableDepthWrite = true;
	}
}
