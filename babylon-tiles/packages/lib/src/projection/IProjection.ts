/**
 * @description: 投影接口定义
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

/**
 * 投影后的坐标点
 */
export interface ProjectedPoint {
	/** X 坐标（投影坐标，单位：米） */
	x: number;
	/** Y 坐标（投影坐标，单位：米） */
	y: number;
}

/**
 * 地理坐标点
 */
export interface GeoPoint {
	/** 经度（单位：度） */
	lon: number;
	/** 纬度（单位：度） */
	lat: number;
}

/**
 * 地图投影接口
 * 定义了地理坐标（经纬度）与投影坐标（米）之间的转换
 */
export interface IProjection {
	/** 投影类型标识（如 'EPSG:4326', 'EPSG:3857'） */
	readonly ID: string;

	/** 中央子午线经度（-90, 0, 90） */
	lon0: number;

	/** 地图宽度（单位：米） */
	readonly mapWidth: number;

	/** 地图高度（单位：米） */
	readonly mapHeight: number;

	/** 地图深度（单位：米） */
	readonly mapDepth: number;

	/**
	 * 将地理坐标（经纬度）投影到地图坐标
	 * @param lon - 经度（单位：度）
	 * @param lat - 纬度（单位：度）
	 * @returns 投影后的坐标点（单位：米）
	 */
	project(lon: number, lat: number): ProjectedPoint;

	/**
	 * 将地图坐标反投影到地理坐标
	 * @param x - 投影坐标 X（单位：米）
	 * @param y - 投影坐标 Y（单位：米）
	 * @returns 地理坐标点（经度、纬度，单位：度）
	 */
	unProject(x: number, y: number): GeoPoint;

	/**
	 * 获取投影的边界范围（投影坐标）
	 * @param bounds - 地理坐标边界 [minLon, minLat, maxLon, maxLat]
	 * @returns 投影坐标边界 [minX, minY, maxX, maxY]
	 */
	getProjBoundsFromLonLat(bounds: [number, number, number, number]): [number, number, number, number];
}
