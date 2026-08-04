/**
 * @description: 地图雾效（动态指数雾）
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile fog/MapFog（FogExp2 + controls change）：
 * - 监听 TileMapControls.onChange，按 极角/(距离+5) 动态调整 scene.fogDensity，
 *   缩放越远、俯仰越低雾越浓，模拟大气透视。
 * - 复用 onChange：组合已有回调而非覆盖（兼容 compass 等其它插件共用 onChange）。
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Scene } from '@babylonjs/core/scene';
import { TileMapControls } from '@babylon-tile/lib';

/**
 * 地图雾效
 */
export class MapFog {
	private readonly _controls: TileMapControls;
	private readonly _scene: Scene;
	private _factor = 1.0;

	/** 雾浓度系数 */
	public get factor(): number {
		return this._factor;
	}
	public set factor(value: number) {
		this._factor = value;
		this._update();
	}

	/**
	 * 构造函数
	 * @param controls 地图相机控制器
	 * @param scene Babylon 场景
	 * @param color 雾颜色
	 */
	public constructor(controls: TileMapControls, scene: Scene, color: Color3) {
		this._controls = controls;
		this._scene = scene;
		scene.fogMode = Scene.FOGMODE_EXP2;
		scene.fogColor = color;

		// 组合已有 onChange（不覆盖其它插件的回调）
		const prevOnChange = controls.onChange;
		controls.onChange = () => {
			prevOnChange?.();
			this._update();
		};
	}

	/**
	 * 更新雾浓度
	 * 对齐 three-tile: density = polar/(dist+5) * factor * 0.25
	 */
	private _update(): void {
		const polar = Math.max(Math.PI / 2 - this._controls.getPitch(), 0.1);
		const dist = Math.max(this._controls.getDistance(), 0.1);
		this._scene.fogDensity = (polar / (dist + 5)) * this._factor * 0.25;
	}
}
