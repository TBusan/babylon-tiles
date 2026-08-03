/**
 * @description: 新瓦片交叉淡入（消除缩放/加载时跨 LOD 衔接处的生硬弹出）
 * @author: Babylon-Tile Team
 * @date: 2026-08-03
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
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

/** 正在淡入的瓦片 */
const activeFades: ActiveFade[] = [];

/** 已注册每帧推进 observer 的场景 */
const attachedScenes = new WeakSet<Scene>();

/**
 * 开始瓦片材质淡入。
 * 淡入期间材质为半透明（叠加在仍显示的父瓦片之上），完成后恢复不透明。
 * @param tile 新加载完成的瓦片
 * @param model 开始淡入时瓦片挂载的模型（用于检测卸载/替换）
 * @param materials 该瓦片的全部材质（基底 + 多影像覆盖层）
 */
export function beginTileFadeIn(tile: Tile, model: Mesh, materials: StandardMaterial[]): void {
	if (materials.length === 0) {
		return;
	}
	// 已在淡入中的瓦片不重复注册
	if (activeFades.some(f => f.tile === tile)) {
		return;
	}
	for (const mat of materials) {
		mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
		mat.alpha = 0;
	}
	activeFades.push({ tile, model, materials, start: performance.now(), duration: FADE_DURATION });

	const scene = tile.getScene();
	if (!attachedScenes.has(scene)) {
		attachedScenes.add(scene);
		scene.onBeforeRenderObservable.add(() => advanceFades());
	}
}

/** 瓦片是否正在淡入（供 updateVisibility 保持父瓦片可见，避免透明露出背景/清屏色） */
export function isTileFadingIn(tile: Tile): boolean {
	return activeFades.some(f => f.tile === tile);
}

/** 当前活跃的淡入数量（调试/探针用） */
export function getFadeCount(): number {
	return activeFades.length;
}

/** 每帧推进所有活跃淡入 */
function advanceFades(): void {
	if (activeFades.length === 0) {
		return;
	}
	const now = performance.now();
	for (let i = activeFades.length - 1; i >= 0; i--) {
		const f = activeFades[i];
		// 瓦片被卸载/模型被替换（材质已释放或不再属于该瓦片）：直接移除，不再推进
		if (f.tile.model !== f.model) {
			activeFades.splice(i, 1);
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
			activeFades.splice(i, 1);
		}
	}
}
