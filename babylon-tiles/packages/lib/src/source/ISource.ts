/**
 * @description: 数据源接口定义
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

/**
 * 瓦片边界类型 [minX, minY, maxX, maxY]
 */
export type BoundsType = [number, number, number, number];

/**
 * 数据源接口
 * 定义了瓦片数据来源的抽象接口
 */
export interface ISource {
	/** 数据类型标识（用于选择对应的加载器） */
	dataType: string;

	/** 数据源 URL 模板（支持 {x}, {y}, {z} 占位符） */
	url: string;

	/** 投影类型标识 */
	projectionID: string;

	/** 最小显示级别（小于此级别不加载数据） */
	minLevel: number;

	/** 最大显示级别（大于此级别不加载数据） */
	maxLevel: number;

	/** 透明度（0-1） */
	opacity?: number;

	/** 是否透明 */
	transparent?: boolean;

	/** 数据源的投影边界（投影坐标，内部使用） */
	_projectionBounds?: BoundsType;

	/**
	 * 获取瓦片 URL
	 * @param x - 瓦片 X 坐标
	 * @param y - 瓦片 Y 坐标
	 * @param z - 瓦片层级
	 * @returns 完整的瓦片 URL
	 */
	getUrl(x: number, y: number, z: number): string;
}
