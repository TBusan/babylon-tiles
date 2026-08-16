/**
 * @description: 新瓦片交叉淡入（消除缩放/加载时跨 LOD 衔接处的生硬弹出）
 * 每地图一个 FadeController 实例（挂在 TileMapContext 上），
 * 替代原模块级 activeFades/attachedScenes 全局单例——多地图（同场景多图）不再互相干扰。
 * @author: Babylon-Tile Team
 * @date: 2026-08-03
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Tile } from './Tile.js';

interface ActiveFade {
	tile: Tile;
	/** 开始淡入时的模型；若瓦片被卸载/模型被替换则失效 */
	model: Mesh;
	materials: StandardMaterial[];
	start: number;
	duration: number;
}

/** 淡入时长（毫秒） */
const FADE_DURATION = 220;

/**
 * 交叉淡入控制器（每地图实例）。
 *
 * 淡入期间材质为半透明（叠加在仍显示的父瓦片之上），完成后恢复不透明。
 * 通过场景 onBeforeRenderObservable 每帧推进；无活跃淡入时注销 observer 避免空转。
 * 同场景双控制器各自注册 observer 可接受（推进开销可忽略）。
 */
export class FadeController {
	private _activeFades: ActiveFade[] = [];
	// 强 Map：dispose 时需遍历注销 observer；随 FadeController（挂 TileMapContext）同生命周期，
	// 地图销毁时显式清空，不构成场景泄漏。
	private _attachedScenes = new Map<Scene, Observer<Scene>>();
	private _disposed = false;

	/** 当前活跃的淡入数量（调试/探针用） */
	public get fadeCount(): number {
		return this._activeFades.length;
	}

	/**
	 * 开始瓦片材质淡入。
	 * @param tile 新加载完成的瓦片
	 * @param model 开始淡入时瓦片挂载的模型（用于检测卸载/替换）
	 * @param materials 该瓦片的全部材质（基底 + 多影像覆盖层）
	 */
	public begin(tile: Tile, model: Mesh, materials: StandardMaterial[]): void {
		if (materials.length === 0 || this._disposed) {
			return;
		}
		// 已在淡入中的瓦片不重复注册
		if (this._activeFades.some((f) => f.tile === tile)) {
			return;
		}
		for (const mat of materials) {
			mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
			mat.alpha = 0;
		}
		this._activeFades.push({ tile, model, materials, start: performance.now(), duration: FADE_DURATION });

		const scene = tile.getScene();
		if (!this._attachedScenes.has(scene)) {
			const observer = scene.onBeforeRenderObservable.add(() => this._advance(scene));
			this._attachedScenes.set(scene, observer);
		}
	}

	/** 瓦片是否正在淡入（供 updateVisibility 保持父瓦片可见，避免透明露出背景/清屏色） */
	public isFading(tile: Tile): boolean {
		return this._activeFades.some((f) => f.tile === tile);
	}

	/**
	 * 取消进行中的淡入并注销 observer。
	 * 恢复材质为不透明，避免地图销毁后 advance() 触碰已释放材质（闪黑/半透明残留）。
	 * 材质本身不在此处 dispose——它们随瓦片 unload 经 loader releaseMesh 释放。
	 */
	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		for (const f of this._activeFades) {
			for (const mat of f.materials) {
				mat.alpha = 1;
				mat.transparencyMode = StandardMaterial.MATERIAL_OPAQUE;
			}
		}
		this._activeFades.length = 0;
		for (const [scene, observer] of this._attachedScenes) {
			scene.onBeforeRenderObservable.remove(observer);
		}
		this._attachedScenes.clear();
	}

	/** 每帧推进所有活跃淡入；全部完成后注销该场景的 observer */
	private _advance(scene: Scene): void {
		if (this._disposed) {
			return;
		}
		if (this._activeFades.length === 0) {
			const observer = this._attachedScenes.get(scene);
			if (observer) {
				scene.onBeforeRenderObservable.remove(observer);
				this._attachedScenes.delete(scene);
			}
			return;
		}
		const now = performance.now();
		for (let i = this._activeFades.length - 1; i >= 0; i--) {
			const f = this._activeFades[i];
			// 瓦片被卸载/模型被替换（材质已释放或不再属于该瓦片）：直接移除，不再推进
			if (f.tile.model !== f.model) {
				this._activeFades.splice(i, 1);
				continue;
			}
			const k = Math.min((now - f.start) / f.duration, 1);
			for (const mat of f.materials) {
				mat.alpha = k;
			}
			if (k >= 1) {
				for (const mat of f.materials) {
					mat.alpha = 1;
					mat.transparencyMode = StandardMaterial.MATERIAL_OPAQUE;
				}
				this._activeFades.splice(i, 1);
			}
		}
	}
}
