/**
 * @description: 贴地模型组
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile groundGroup：
 * - 加入该组的模型将自动贴地（以地图地面高度为参考调整模型高度）。
 * - GroundGroup 本身为 TransformNode，通常直接加入 scene（不 parent 到地图）。
 * - clampToGround 依赖 lib 的 getLocalInfoFromWorld（返回 location.z = 地理高度 = 世界 Y），
 *   且地图根 scaling.y=1 无旋转，故世界 Y 位移 == 局部 Y 位移。
 */

import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { TileMap } from '@babylon-tile/lib';

/**
 * 贴地模型组
 * 加入该组的模型将自动贴地
 */
export class GroundGroup extends TransformNode {
	/** 地图 */
	public map: TileMap;

	/**
	 * 是否每块瓦片下载完成都调整模型高度以贴地；
	 * 若为 false，仅在瓦片全部下载完成后调整一次。
	 */
	public updateAllTiles = false;

	/**
	 * 贴地模型组
	 * @param name - 节点名
	 * @param map - 地图
	 * @param params - { updateEveryTile: 是否每块瓦片下载完成调整模型高度以贴地 }
	 */
	public constructor(name: string, map: TileMap, params = { updateEveryTile: false }) {
		super(name, map.getScene());
		const { updateEveryTile = false } = params;
		this.map = map;
		this.updateAllTiles = updateEveryTile;

		map.addObservable('tile-loaded', () => {
			setTimeout(() => {
				this.updateAllTiles && this.update();
			}, 10);
		});
		map.addObservable('loading-complete', () => {
			setTimeout(() => {
				this.update();
			}, 10);
		});
	}

	/**
	 * 添加模型到组中并立即贴地
	 * setParent(this, true) 保持世界位置不变（对齐 three-tile group.add 的语义）
	 * @param objects - 模型
	 */
	public add(...objects: TransformNode[]): this {
		objects.forEach(obj => {
			obj.setParent(this, true);
		});
		this.update(...objects);
		return this;
	}

	/**
	 * 更新组内模型高度以贴地（或仅更新指定模型）
	 * @param objects - 指定模型（为空则更新全部子模型）
	 */
	public update(...objects: TransformNode[]): this {
		if (objects.length === 0) {
			this.getChildren().forEach(child => {
				clampToGround(this.map, child as TransformNode);
			});
		} else {
			objects.forEach(obj => clampToGround(this.map, obj));
		}
		return this;
	}
}

/**
 * 将指定模型贴地
 * @param map - 地图
 * @param obj - 模型
 */
export function clampToGround(map: TileMap, obj: TransformNode): void {
	if (obj.isDisposed() || !obj.parent) return;
	obj.computeWorldMatrix(true);
	const worldPosition = obj.absolutePosition.clone();
	const info = map.getLocalInfoFromWorld(worldPosition);
	if (info) {
		// 世界空间包围盒底部 Y
		const bottomY = getWorldBottomY(obj);
		const offsetY = info.location.z - bottomY;
		obj.position.y += offsetY;
	}
}

/**
 * 获取节点世界空间包围盒底部 Y
 * 网格直接用 getHierarchyBoundingVectors；TransformNode 组遍历后代网格求并集
 */
function getWorldBottomY(obj: TransformNode): number {
	if (obj instanceof AbstractMesh) {
		const bv = obj.getHierarchyBoundingVectors();
		return bv.min.y;
	}
	let minY = Infinity;
	obj.getChildMeshes().forEach(mesh => {
		const bv = mesh.getHierarchyBoundingVectors();
		if (bv.min.y < minY) minY = bv.min.y;
	});
	return minY === Infinity ? obj.absolutePosition.y : minY;
}
