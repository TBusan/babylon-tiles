/**
 * @description: 瓦片工具函数
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { IProjection } from '../projection/IProjection.js';

/**
 * LOD 动作类型
 */
export enum LODAction {
	/** 保持当前状态 */
	NONE = 'none',
	/** 创建子瓦片 */
	CREATE = 'create',
	/** 删除子瓦片 */
	REMOVE = 'remove',
}

/**
 * 计算瓦片的地理边界
 * @param x - 瓦片 X 坐标
 * @param y - 瓦片 Y 坐标
 * @param z - 瓦片层级
 * @param projection - 投影对象
 * @returns 地理坐标边界 [minLon, minLat, maxLon, maxLat]
 */
export function getTileBounds(
	x: number,
	y: number,
	z: number,
	projection: IProjection
): [number, number, number, number] {
	// 计算该层级的瓦片数量
	const tilesAtLevel = Math.pow(2, z);

	// 计算瓦片的大小（度）
	const tileSize = 360 / tilesAtLevel;

	// 计算瓦片的地理边界
	const minLon = (x * tileSize) - 180;
	const maxLon = minLon + tileSize;
	const maxLat = 90 - (y * tileSize);
	const minLat = maxLat - tileSize;

	return [minLon, minLat, maxLon, maxLat];
}

/**
 * 计算瓦片的投影边界
 * @param x - 瓦片 X 坐标
 * @param y - 瓦片 Y 坐标
 * @param z - 瓦片层级
 * @param projection - 投影对象
 * @returns 投影坐标边界 [minX, minY, maxX, maxY]
 */
export function getTileProjBounds(
	x: number,
	y: number,
	z: number,
	projection: IProjection
): [number, number, number, number] {
	const geoBounds = getTileBounds(x, y, z, projection);
	return projection.getProjBoundsFromLonLat(geoBounds);
}

/**
 * 创建子瓦片（四叉树分裂）
 * @param parentX - 父瓦片 X 坐标
 * @param parentY - 父瓦片 Y 坐标
 * @param parentZ - 父瓦片层级
 * @returns 子瓦片坐标数组 [[x, y, z], ...]
 */
export function createChildTiles(parentX: number, parentY: number, parentZ: number): Array<[number, number, number]> {
	const childZ = parentZ + 1;
	const childX = parentX * 2;
	const childY = parentY * 2;

	return [
		[childX, childY, childZ],
		[childX + 1, childY, childZ],
		[childX, childY + 1, childZ],
		[childX + 1, childY + 1, childZ],
	];
}

/**
 * LOD 评估函数
 * 根据相机距离和瓦片大小判断是否需要创建或删除子瓦片
 * @param distRatio - 距离比例（相机距离/瓦片大小）
 * @param minLevel - 最小层级
 * @param maxLevel - 最大层级
 * @param currentLevel - 当前层级
 * @param inFrustum - 是否在视锥体内
 * @param LODThreshold - LOD 阈值
 * @returns LOD 动作
 */
export function evaluateLOD(
	distRatio: number,
	minLevel: number,
	maxLevel: number,
	currentLevel: number,
	inFrustum: boolean,
	LODThreshold: number
): LODAction {
	// 如果小于最小层级，不创建子瓦片
	if (currentLevel < minLevel) {
		return LODAction.NONE;
	}

	// 如果达到最大层级，不能再创建子瓦片
	if (currentLevel >= maxLevel) {
		return LODAction.REMOVE;
	}

	// 根据距离比例判断
	if (inFrustum) {
		// 在视锥体内，使用较小阈值
		if (distRatio < LODThreshold) {
			return LODAction.CREATE;
		} else if (distRatio > LODThreshold * 2) {
			return LODAction.REMOVE;
		}
	} else {
		// 不在视锥体内，使用较大阈值
		if (distRatio > LODThreshold * 3) {
			return LODAction.REMOVE;
		}
	}

	return LODAction.NONE;
}

/**
 * 计算瓦片在世界坐标系中的大小
 * @param x - 瓦片 X 坐标
 * @param y - 瓦片 Y 坐标
 * @param z - 瓦片层级
 * @param projection - 投影对象
 * @param tileScale - 瓦片缩放（地图的缩放）
 * @returns 瓦片世界大小（对角线长度）
 */
export function getTileWorldSize(
	x: number,
	y: number,
	z: number,
	projection: IProjection,
	tileScale: { x: number; y: number }
): number {
	const bounds = getTileProjBounds(x, y, z, projection);
	const width = (bounds[2] - bounds[0]) * tileScale.x;
	const height = (bounds[3] - bounds[1]) * tileScale.y;
	return Math.sqrt(width * width + height * height);
}

/**
 * 将地理坐标转换为瓦片坐标
 * @param lon - 经度
 * @param lat - 纬度
 * @param level - 瓦片层级
 * @returns 瓦片坐标 [x, y, level]
 */
export function geoToTile(lon: number, lat: number, level: number): [number, number, number] {
	const tilesAtLevel = Math.pow(2, level);

	let x = Math.floor(((lon + 180) / 360) * tilesAtLevel);
	let y = Math.floor(((90 - lat) / 180) * tilesAtLevel);

	// 确保在有效范围内
	x = Math.max(0, Math.min(x, tilesAtLevel - 1));
	y = Math.max(0, Math.min(y, tilesAtLevel - 1));

	return [x, y, level];
}

/**
 * 将瓦片坐标转换为地理坐标（瓦片中心点）
 * @param x - 瓦片 X 坐标
 * @param y - 瓦片 Y 坐标
 * @param level - 瓦片层级
 * @returns 地理坐标 [lon, lat]
 */
export function tileToGeo(x: number, y: number, level: number): [number, number] {
	const tilesAtLevel = Math.pow(2, level);
	const tileSize = 360 / tilesAtLevel;

	const lon = (x * tileSize) + tileSize / 2 - 180;
	const lat = 90 - (y * tileSize) - tileSize / 2;

	return [lon, lat];
}

/**
 * 计算两点之间的距离
 * @param lon1 - 点1经度
 * @param lat1 - 点1纬度
 * @param lon2 - 点2经度
 * @param lat2 - 点2纬度
 * @returns 距离（单位：米，近似值）
 */
export function distanceBetweenGeo(lon1: number, lat1: number, lon2: number, lat2: number): number {
	const R = 6371000; // 地球半径（米）
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLon = ((lon2 - lon1) * Math.PI) / 180;

	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos((lat1 * Math.PI) / 180) *
			Math.cos((lat2 * Math.PI) / 180) *
			Math.sin(dLon / 2) *
			Math.sin(dLon / 2);

	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c;
}

/**
 * 克隆对象
 * @param obj - 要克隆的对象
 * @returns 克隆的对象
 */
export function clone<T>(obj: T): T {
	if (obj === null || typeof obj !== 'object') {
		return obj;
	}

	if (obj instanceof Date) {
		return new Date(obj.getTime()) as unknown as T;
	}

	if (obj instanceof Array) {
		return obj.map(item => clone(item)) as unknown as T;
	}

	const clonedObj = {} as T;
	for (const key in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			clonedObj[key] = clone(obj[key]);
		}
	}

	return clonedObj;
}
