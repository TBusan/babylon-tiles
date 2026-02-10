/**
 * @description: XYZ 标准瓦片数据源
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import { TileSource, type SourceOptions } from './TileSource.js';

/**
 * XYZ 标准瓦片数据源配置
 */
export interface XYZSourceOptions extends SourceOptions {
	/** URL 模板（支持 {x}, {y}, {z} 占位符） */
	url: string;
}

/**
 * XYZ 标准瓦片数据源
 * 支持标准的 XYZ 瓦片服务（如 OpenStreetMap）
 */
export class XYZTileSource extends TileSource {
	/** 数据类型标识 */
	public dataType: string = 'image';

	/**
	 * 构造函数
	 * @param options - XYZ 瓦片源配置
	 */
	constructor(options: XYZSourceOptions) {
		super(options);
	}
}
