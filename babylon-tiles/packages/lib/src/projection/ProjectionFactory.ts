/**
 * @description: 投影工厂类
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { IProjection } from './IProjection.js';
import { WGS84Projection } from './WGS84Projection.js';
import { WebMercatorProjection } from './WebMercatorProjection.js';

/**
 * 投影工厂类
 * 用于创建不同类型的投影对象
 */
export class ProjectionFactory {
	/**
	 * 根据投影类型 ID 和中央子午线创建投影对象
	 * @param projectionID - 投影类型标识（'EPSG:4326' 或 'EPSG:3857'）
	 * @param lon0 - 中央子午线经度（-90, 0, 90），默认为 0
	 * @returns 投影对象
	 */
	public static createFromID(projectionID: string, lon0: -90 | 0 | 90 = 0): IProjection {
		switch (projectionID) {
			case 'EPSG:4326':
				return new WGS84Projection(lon0);
			case 'EPSG:3857':
				return new WebMercatorProjection(lon0);
			default:
				console.warn(`Unknown projection ID: ${projectionID}, using EPSG:4326`);
				return new WGS84Projection(lon0);
		}
	}

	/**
	 * 创建 WGS84 投影
	 * @param lon0 - 中央子午线经度（-90, 0, 90），默认为 0
	 * @returns WGS84 投影对象
	 */
	public static createWGS84(lon0: -90 | 0 | 90 = 0): WGS84Projection {
		return new WGS84Projection(lon0);
	}

	/**
	 * 创建 Web Mercator 投影
	 * @param lon0 - 中央子午线经度（-90, 0, 90），默认为 0
	 * @returns Web Mercator 投影对象
	 */
	public static createWebMercator(lon0: -90 | 0 | 90 = 0): WebMercatorProjection {
		return new WebMercatorProjection(lon0);
	}
}
