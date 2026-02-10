/**
 * @description: Web Mercator 投影（EPSG:3857）
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { IProjection, ProjectedPoint, GeoPoint } from './IProjection.js';

/**
 * Web Mercator 投影（也称为 Pseudo-Mercator 或 Google Mercator）
 * 广泛用于 Web 地图服务（如 Google Maps、Bing Maps、OpenStreetMap）
 */
export class WebMercatorProjection implements IProjection {
	/** 投影类型标识 */
	public readonly ID = 'EPSG:3857';

	private _lon0: number;

	/** 地球半径（单位：米） */
	private static readonly EARTH_RADIUS = 6378137;

	/** 投影范围（单位：米） */
	private static readonly MAX_EXTENT = 20037508.342789244;

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
	 * 地图宽度（单位：米）
	 */
	public get mapWidth(): number {
		return WebMercatorProjection.MAX_EXTENT * 2;
	}

	/**
	 * 地图高度（单位：米）
	 */
	public get mapHeight(): number {
		return WebMercatorProjection.MAX_EXTENT * 2;
	}

	/**
	 * 地图深度（单位：米）
	 */
	public get mapDepth(): number {
		return 9000;
	}

	/**
	 * 将地理坐标（经纬度）投影到地图坐标
	 * 使用 Web Mercator 投影公式
	 * @param lon - 经度（单位：度）
	 * @param lat - 纬度（单位：度）
	 * @returns 投影后的坐标点（单位：米）
	 */
	public project(lon: number, lat: number): ProjectedPoint {
		const R = WebMercatorProjection.EARTH_RADIUS;
		const lonRad = ((lon - this._lon0) * Math.PI) / 180;
		const latRad = (lat * Math.PI) / 180;

		const x = R * lonRad;
		const y = R * Math.log(Math.tan(Math.PI / 4 + latRad / 2));

		return { x, y };
	}

	/**
	 * 将地图坐标反投影到地理坐标
	 * @param x - 投影坐标 X（单位：米）
	 * @param y - 投影坐标 Y（单位：米）
	 * @returns 地理坐标点（经度、纬度，单位：度）
	 */
	public unProject(x: number, y: number): GeoPoint {
		const R = WebMercatorProjection.EARTH_RADIUS;

		const lonRad = x / R;
		const latRad = 2 * Math.atan(Math.exp(y / R)) - Math.PI / 2;

		const lon = (lonRad * 180) / Math.PI + this._lon0;
		const lat = (latRad * 180) / Math.PI;

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
