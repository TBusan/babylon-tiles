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
	public readonly ID = '3857';

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
		return 1;
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
		const withCenter = maxLon - minLon > 180;
		const p1 = this.project(minLon + (withCenter ? this._lon0 : 0), minLat);
		const p2 = this.project(maxLon + (withCenter ? this._lon0 : 0), maxLat);
		return [Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.max(p1.x, p2.x), Math.max(p1.y, p2.y)];
	}

	/**
	 * 根据中央经线取得变换后的瓦片X坐标
	 */
	public getTileXWithCenterLon(x: number, z: number): number {
		const n = Math.pow(2, z);
		let newx = x + Math.round((n / 360) * this._lon0);
		if (newx >= n) {
			newx -= n;
		} else if (newx < 0) {
			newx += n;
		}
		return newx;
	}

	/**
	 * 取得瓦片边界投影坐标范围
	 */
	public getProjBoundsFromXYZ(x: number, y: number, z: number): [number, number, number, number] {
		const worldSize = Math.PI * 6378137;
		const tileSize = (2 * worldSize) / Math.pow(2, z);
		const minX = -worldSize + x * tileSize;
		const minY = worldSize - (y + 1) * tileSize;
		const maxX = -worldSize + (x + 1) * tileSize;
		const maxY = worldSize - y * tileSize;
		return [minX, minY, maxX, maxY];
	}

	/**
	 * 取得瓦片经纬度边界范围
	 */
	public getLonLatBoundsFromXYZ(x: number, y: number, z: number): [number, number, number, number] {
		const projectBounds = this.getProjBoundsFromXYZ(x, y, z);
		const p1 = this.unProject(projectBounds[0], projectBounds[1]);
		const p2 = this.unProject(projectBounds[2], projectBounds[3]);
		return [p1.lon, p1.lat, p2.lon, p2.lat];
	}
}
