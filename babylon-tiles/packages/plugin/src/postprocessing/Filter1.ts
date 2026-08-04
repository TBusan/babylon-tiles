/**
 * @description: 颜色滤镜（色调/饱和度/亮度/对比度）
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile postprocessing/Filter1（HueSaturationShader + BrightnessContrastShader）：
 * - Babylon PostProcess 挂到相机上自动每帧渲染，无需手写 EffectComposer。
 * - 内联像素着色器注册到 Effect.ShadersStore['filter1PixelShader']。
 */

import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Camera } from '@babylonjs/core/Cameras/camera';

// 注册滤镜片元着色器（色调旋转 + 饱和度 + 亮度 + 对比度）
Effect.ShadersStore['filter1PixelShader'] = /* glsl */ `
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float hue;
uniform float saturation;
uniform float brightness;
uniform float contrast;

vec3 hueRotate(vec3 color, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    mat3 m = mat3(
        0.299 + 0.701 * c + 0.168 * s, 0.587 - 0.587 * c + 0.330 * s, 0.114 - 0.114 * c - 0.497 * s,
        0.299 - 0.299 * c - 0.328 * s, 0.587 + 0.413 * c + 0.035 * s, 0.114 - 0.114 * c + 0.292 * s,
        0.299 - 0.299 * c + 1.250 * s, 0.587 - 0.587 * c - 1.050 * s, 0.114 + 0.886 * c - 0.203 * s
    );
    return m * color;
}

void main() {
    vec4 color = texture2D(textureSampler, vUV);
    // 亮度 / 对比度
    color.rgb += brightness;
    color.rgb = (color.rgb - 0.5) * contrast + 0.5;
    // 饱和度
    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(luma), color.rgb, saturation);
    // 色调
    color.rgb = hueRotate(color.rgb, hue);
    gl_FragColor = color;
}
`;

/**
 * 颜色滤镜
 */
export class Filter1 {
	private readonly _postProcess: PostProcess;
	private readonly _camera: Camera;
	private _enabled = true;
	private _hue = 0;
	private _saturation = 1;
	private _brightness = 0;
	private _contrast = 1;

	/** 色调偏移（rad） */
	public get hue(): number {
		return this._hue;
	}
	public set hue(value: number) {
		this._hue = value;
	}

	/** 饱和度（1 = 原样） */
	public get saturation(): number {
		return this._saturation;
	}
	public set saturation(value: number) {
		this._saturation = value;
	}

	/** 亮度偏移（0 = 原样） */
	public get brightness(): number {
		return this._brightness;
	}
	public set brightness(value: number) {
		this._brightness = value;
	}

	/** 对比度（1 = 原样） */
	public get contrast(): number {
		return this._contrast;
	}
	public set contrast(value: number) {
		this._contrast = value;
	}

	/**
	 * 是否启用滤镜
	 * Babylon 7 的 PostProcess 无 enabled 属性，通过增删相机内部
	 * _postProcesses 列表实现启停（与 three-tile 切换 passes.enabled 等价）。
	 */
	public get enable(): boolean {
		return this._enabled;
	}
	public set enable(value: boolean) {
		this._enabled = value;
		const pps = (
			this._camera as unknown as { _postProcesses: (PostProcess | null)[] }
		)._postProcesses;
		const idx = pps.indexOf(this._postProcess);
		if (value) {
			if (idx === -1) pps.push(this._postProcess);
		} else if (idx !== -1) {
			pps.splice(idx, 1);
		}
	}

	/**
	 * 构造函数
	 * @param params - { camera: 挂载滤镜的相机 }
	 */
	public constructor(params: { camera: Camera }) {
		const { camera } = params;
		this._camera = camera;
		const engine = camera.getScene().getEngine();
		this._postProcess = new PostProcess(
			'filter1',
			'filter1', // fragmentUrl → Effect.ShadersStore['filter1PixelShader']
			['hue', 'saturation', 'brightness', 'contrast'],
			[],
			1.0, // 全分辨率
			camera,
			Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
			engine,
			false
		);
		this._postProcess.onApply = effect => {
			effect.setFloat('hue', this._hue);
			effect.setFloat('saturation', this._saturation);
			effect.setFloat('brightness', this._brightness);
			effect.setFloat('contrast', this._contrast);
		};
	}

	/**
	 * 兼容 three-tile API（Babylon PostProcess 随相机自动渲染，无需手动调用）
	 */
	public update(): void {
		// no-op
	}

	/**
	 * 释放滤镜
	 */
	public dispose(): void {
		this._postProcess.dispose();
	}
}
