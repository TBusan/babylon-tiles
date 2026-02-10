/**
 * @description: WGS84 地理投影（EPSG:4326）
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { IProjection, ProjectedPoint, GeoPoint } from './IProjection.js';

/**
 * WGS84 地理坐标投影
 * 将经纬度直接线性投影到平面坐标
 * 中央子午线决定投影中心
 */
export class WGS84Projection implements IProjection {
	/** 投影类型标识 */
	public readonly ID = 'EPSG:4326';

	private _lon0: number;

	/** 地球周长（单位：米） */
	private static readonly EARTH_CIRCUMFERENCE = 40075016.686;

	/**
	 * 构造函数
	 * @param lon0 - 中央子午线经度（-90, 0, 90），默认为 0
	 */
	constructor(lon0: -90 | 0 | 90 = 0) {
		this._lon0 = lon0;
	}

	/** 获取中央子午线经度 */
	public get lon0(): number {
		return this._lon0;
	}

	/** 设置中央子午线经度 */
	public set lon0(value: number) {
		if (value !== -90 && value !== 0 && value !== 90) {
			console.warn(`lon0 must be -90, 0, or 90, got ${value}`);
			this._lon0 = 0;
		} else {
			this._lon0 = value;
		}
	}

	/**
	 * 地图宽度（地球周长，单位：米）
	 */
	public get mapWidth(): number {
		return WGS84Projection.EARTH_CIRCUMFERENCE;
	}

	/**
	 * 地图高度（地球周长的一半，从南极到北极，单位：米）
	 */
	public get mapHeight(): number {
		return WGS84Projection.EARTH_CIRCUMFERENCE / 2;
	}

	/**
	 * 地图深度（单位：米）
	 * 用于地形高度范围
	 */
	public get mapDepth(): number {
		return 9000;
	}

	/**
	 * 将地理坐标（经纬度）投影到地图坐标
	 * 使用简单的线性投影：x = (lon - lon0) * 100 * 1000, y = lat * 100 * 1000
	 * @param lon - 经度（单位：度）
	 * @param lat - 纬度（单位：度）
	 * @returns 投影后的坐标点（单位：米）
	 */
	public project(lon: number, lat: number): ProjectedPoint {
		// 将经度减去中央子午线，然后转换为米（1度 = 100km）
		const x = (lon - this._lon0) * 100 * 1000;
		// 将纬度转换为米（1度 = 100km）
		const y = lat * 100 * 1000;
		return { x, y };
	}

	/**
	 * 将地图坐标反投影到地理坐标
	 * @param x - 投影坐标 X（单位：米）
	 * @param y - 投影坐标 Y（单位：米）
	 * @returns 地理坐标点（经度、纬度，单位：度）
	 */
	public unProject(x: number, y: number): GeoPoint {
		// 将米转换为经度，加上中央子午线
		const lon = x / (100 * 1000) + this._lon0;
		// 将米转换为纬度
		const lat = y / (100 * 1000);
		return { lon, lat };
	}

	/**
	 * 获取投影的边界范围（投影坐标）
	 * @param bounds - 地理坐标边界 [minLon, minLat, maxLon, maxLat]
	 * @returns 投影坐标边界 [minX, minY, maxX, maxY]
	 */
	public getProjBoundsFromLonLat(bounds: [number, number, number, number]): [number, number, number, number] {
		const [minLon, minLat, maxLon, maxLat] = bounds;
		const min = this.project(minLon, minLat);
		const max = this.project(maxLon, maxLat);
		return [min.x, min.y, max.x, max.y];
	}
}
