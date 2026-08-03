/**
 * @description: 瓦片工具函数
 * Ported from three-tile's tile/util.ts for Babylon.js (Y-up coordinate system)
 * @author: Babylon-Tile Team
 * @date: 2025-07-25
 */

import type { Scene } from '@babylonjs/core/scene';

import { Tile } from './Tile.js';
import type { ITileLoader } from '../loader/ITileLoader.js';

/**
 * LOD 动作类型
 */
export enum LODAction {
	/** 无操作 */
	NONE = 'none',
	/** 创建子瓦片（细化） */
	CREATE = 'create',
	/** 删除子瓦片（合并） */
	REMOVE = 'remove',
}

/**
 * 根据摄像机到瓦片的距离，评估瓦片是否需要细化或合并
 * 与 three-tile 的 LODEvaluate 完全一致
 * @param tile 瓦片实例
 * @param minLevel 地图最小层级
 * @param maxLevel 地图最大层级
 * @param threshold 瓦片LOD阈值
 * @returns LODAction 细化、合并或无动作
 */
export function LODEvaluate(
	tile: Tile,
	minLevel: number,
	maxLevel: number,
	threshold: number
): LODAction {
	// 非叶子且超过最大层级 → 删除子瓦片
	if (!tile.isLeaf && tile.z > maxLevel) {
		return LODAction.REMOVE;
	}

	const distRatio = tile.distRatio;

	// LOD 阈值死区：CREATE 与 REMOVE 使用不同阈值（±10%），避免相机停在边界附近时
	// CREATE↔REMOVE 反复切换（反复重建 + 重新下载子瓦片）。死区 [0.9, 1.1]。
	// 基于 three-tile LODEvaluate，但将共用 threshold 拆分为两档。

	// 叶子瓦片、在视锥体内、距离比例小于阈值、且在显示或小于最小层级 → 创建子瓦片
	if (
		tile.isLeaf &&
		tile.inFrustum &&
		tile.z < maxLevel &&
		distRatio < threshold * 0.9 &&
		(tile.showing || tile.z <= minLevel)
	) {
		return LODAction.CREATE;
	}

	// 非叶子、达到最小层级、距离比例大于阈值 → 删除子瓦片
	if (
		!tile.isLeaf &&
		tile.z >= minLevel &&
		distRatio > threshold * 1.1
	) {
		return LODAction.REMOVE;
	}

	return LODAction.NONE;
}

/**
 * 创建单个瓦片实例并设置位置和缩放
 * Babylon.js Y-up: 地图平铺在 X-Z 平面，Y 为海拔高度
 * @param x 瓦片X坐标
 * @param y 瓦片Y坐标
 * @param z 瓦片层级
 * @param px 位置X
 * @param py 位置Z（Babylon Y-up中表示为Z轴位置）
 * @param sx 缩放X
 * @param sy 缩放Z（Babylon Y-up中表示为Z轴缩放）
 * @param sz 缩放Y（Babylon Y-up中表示为Y轴缩放，通常为1）
 * @returns 瓦片实例
 */
function createTile(
	x: number,
	y: number,
	z: number,
	px: number,
	py: number,
	sx: number,
	sy: number,
	sz: number,
	scene: Scene
): Tile {
	const tile = new Tile(x, y, z, scene);
	// Babylon Y-up: 位置在 X-Z 平面上，Y=0
	tile.position.set(px, 0, py);
	// Babylon Y-up: 缩放 X 和 Z 控制水平大小，Y 控制厚度
	tile.scaling.set(sx, sz, sy);
	return tile;
}

/**
 * 创建子瓦片（四叉树分裂）
 * 与 three-tile 的 createChildren 完全一致，适配 Babylon Y-up 坐标系统
 * @param parentTile 父瓦片
 * @param loader 瓦片加载器
 * @returns 子瓦片数组
 */
export function createChildren(parentTile: Tile, loader: ITileLoader): Tile[] {
	const { x: parentX, y: parentY, z: parentZ } = parentTile;
	const children: Tile[] = [];
	const scene = parentTile.getScene();

	const x = parentX * 2;
	const z = parentZ + 1;
	const p = 0.25;
	const sx = 0.5;
	const sz = 1.0;

	if (parentZ === 0 && loader.projectionID === '4326') {
		// EPSG:4326 瓦片0级只有2块子瓦片
		const y = parentY;
		const sy = 1.0;
		const t1 = createTile(x, y, z, -p, 0, sx, sy, sz, scene);
		const t2 = createTile(x + 1, y, z, p, 0, sx, sy, sz, scene);
		children.push(t1, t2);
	} else {
		// 其它情况都为4块子瓦片
		const y = parentY * 2;
		const sy = 0.5;
		const t1 = createTile(x, y, z, -p, p, sx, sy, sz, scene);
		const t2 = createTile(x + 1, y, z, p, p, sx, sy, sz, scene);
		const t3 = createTile(x, y + 1, z, -p, -p, sx, sy, sz, scene);
		const t4 = createTile(x + 1, y + 1, z, p, -p, sx, sy, sz, scene);
		children.push(t1, t2, t3, t4);
	}

	return children;
}

/**
 * 计算瓦片的地理边界
 * @param x 瓦片 X 坐标
 * @param y 瓦片 Y 坐标
 * @param z 瓦片层级
 * @returns 地理坐标边界 [minLon, minLat, maxLon, maxLat]
 */
export function getTileLonLatBounds(
	x: number,
	y: number,
	z: number
): [number, number, number, number] {
	const n = Math.pow(2, z);
	const tileSizeLon = 360 / n;
	const tileSizeLat = 180 / n;

	const minLon = x * tileSizeLon - 180;
	const maxLon = minLon + tileSizeLon;
	const maxLat = 90 - y * tileSizeLat;
	const minLat = maxLat - tileSizeLat;

	return [minLon, minLat, maxLon, maxLat];
}

/**
 * 将地理坐标转换为瓦片坐标
 * @param lon 经度
 * @param lat 纬度
 * @param level 瓦片层级
 * @returns 瓦片坐标 [x, y, level]
 */
export function geoToTile(lon: number, lat: number, level: number): [number, number, number] {
	const n = Math.pow(2, level);
	let x = Math.floor(((lon + 180) / 360) * n);
	let y = Math.floor(((90 - lat) / 180) * n);

	x = Math.max(0, Math.min(x, n - 1));
	y = Math.max(0, Math.min(y, n - 1));

	return [x, y, level];
}

/**
 * 将瓦片坐标转换为地理坐标（瓦片中心点）
 * @param x 瓦片 X 坐标
 * @param y 瓦片 Y 坐标
 * @param z 瓦片层级
 * @returns 地理坐标 [lon, lat]
 */
export function tileToGeo(x: number, y: number, z: number): [number, number] {
	const n = Math.pow(2, z);
	const tileSize = 360 / n;

	const lon = x * tileSize + tileSize / 2 - 180;
	const lat = 90 - y * tileSize - tileSize / 2;

	return [lon, lat];
}
