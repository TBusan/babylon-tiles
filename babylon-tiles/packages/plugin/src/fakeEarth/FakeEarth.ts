/**
 * @description: 伪球体（FakeEarth）
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile fakeEarth/FakeEarth + demo createFakeEarth：
 * - 一个 5×5 平面，parent 到地图根后会被地图非均匀缩放撑满地图范围，
 *   由 EarthMaskMaterial 在中心绘制"地球 + 大气辉光"。
 */

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { TileMap } from '@babylon-tile/lib';
import { EarthMaskMaterial } from './EarthMaskMaterial.js';

/**
 * 伪球体网格
 */
export class FakeEarth extends Mesh {
	public get bkColor(): Color3 {
		return (this.material as EarthMaskMaterial).bkColor;
	}
	public set bkColor(value: Color3) {
		(this.material as EarthMaskMaterial).bkColor = value;
	}
	public get airColor(): Color3 {
		return (this.material as EarthMaskMaterial).airColor;
	}
	public set airColor(value: Color3) {
		(this.material as EarthMaskMaterial).airColor = value;
	}

	/**
	 * 构造函数
	 * @param scene Babylon 场景
	 * @param bkColor 背景色（保留 API，shader 主要使用 airColor）
	 * @param airColor 大气辉光颜色
	 */
	public constructor(scene: Scene, bkColor: Color3, airColor: Color3 = new Color3(0.4, 0.6, 0.8)) {
		super('fakeEarth', scene);

		this.material = new EarthMaskMaterial(scene, { bkColor, airColor });

		// 生成 5×5 平铺四边形（对齐 three-tile PlaneGeometry(5,5)：先在 XY 平面，
		// 再 rotation.x=π/2 翻转到水平 XZ 平面）
		const size = 5;
		const half = size / 2;
		const vd = new VertexData();
		vd.positions = [-half, -half, 0, half, -half, 0, half, half, 0, -half, half, 0];
		vd.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
		vd.indices = [0, 1, 2, 0, 2, 3];
		vd.applyToMesh(this);

		this.rotation.x = Math.PI / 2; // 平放在 XZ 平面
		this.position.y = -0.01; // 略低于地图
		this.renderingGroupId = 0;
		this.infiniteDistance = false;
	}
}

/**
 * 创建伪球体并挂到地图根下（对齐 demo createFakeEarth）
 * @param scene Babylon 场景
 * @param map 地图
 * @param bkColor 背景色
 * @param airColor 大气辉光颜色
 * @returns 伪球体网格
 */
export function createFakeEarth(
	scene: Scene,
	map: TileMap,
	bkColor: Color3,
	airColor: Color3 = new Color3(0.4, 0.6, 0.8)
): FakeEarth {
	const earth = new FakeEarth(scene, bkColor, airColor);
	earth.setParent(map);
	return earth;
}
