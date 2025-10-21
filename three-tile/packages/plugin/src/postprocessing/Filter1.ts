import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { Camera, Scene, WebGLRenderer } from "three";
import { HueSaturationShader, BrightnessContrastShader, ShaderPass, RenderPass } from "three/examples/jsm/Addons.js";

export class Fillter {
	private _scene: Scene;
	private _camera: Camera;
	private _renderer: WebGLRenderer;
	private _composer: EffectComposer;
	private _hueSaturationPass: ShaderPass;
	private _brightnessContrastPass: ShaderPass;

	public set hue(value: number) {
		this._hueSaturationPass.uniforms.hue.value = value; // 色调
	}
	public get hue() {
		return this._hueSaturationPass.uniforms.hue.value; // 色调
	}

	public set saturation(value: number) {
		this._hueSaturationPass.uniforms.saturation.value = value; // 饱和度
	}

	public get brightness() {
		return this._brightnessContrastPass.uniforms.brightness.value; // 亮度
	}
	public set brightness(value: number) {
		this._brightnessContrastPass.uniforms.brightness.value = value; // 亮度
	}

	public get contrast() {
		return this._brightnessContrastPass.uniforms.contrast.value; // 对比度
	}
	public set contrast(value: number) {
		this._brightnessContrastPass.uniforms.contrast.value = value; // 对比度
	}

	public set enable(value: boolean) {
		this._composer.passes.forEach(pass => (pass.enabled = value));
	}

	constructor(params: { scene: Scene; camera: Camera; renderer: WebGLRenderer }) {
		this._scene = params.scene;
		this._camera = params.camera;
		this._renderer = params.renderer;
		// 创建 EffectComposer
		const composer = new EffectComposer(this._renderer);

		// 第一步：渲染原始场景
		const renderPass = new RenderPass(this._scene, this._camera);
		composer.addPass(renderPass);

		// 第二步：调整色调和饱和度
		this._hueSaturationPass = new ShaderPass(HueSaturationShader);
		composer.addPass(this._hueSaturationPass);

		// 第三步：调整亮度和对比度
		this._brightnessContrastPass = new ShaderPass(BrightnessContrastShader);
		composer.addPass(this._brightnessContrastPass);

		// 监听窗口大小变化，调整 EffectComposer 的大小
		new ResizeObserver(() => {
			const width = this._renderer.domElement.clientWidth;
			const height = this._renderer.domElement.clientHeight;
			this._composer.setSize(width, height);
		}).observe(this._renderer.domElement);

		this._composer = composer;
	}

	public update() {
		this._composer.render(); // 渲染场景
	}
}
