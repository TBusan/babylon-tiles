/**
 * @description: 单 TIF 高程数据源
 * @author: Babylon-Tile Team
 *
 * dataType='single-tif'。整幅 GeoTIFF DEM 按 bounds 贴地显示，瓦片几何体按
 * 层级从 DEM 中裁剪子区域生成规则网格。
 */

import { SourceOptions, TileSource } from '@babylon-tile/lib';
import { DEMType } from './parse.js';

/**
 * 单 TIF 图像高程数据源
 */
export class SingleTifDEMSource extends TileSource {
	/** 该数据源的类型标识 */
	public dataType = 'single-tif';
	/** 瓦片裙边高度（m） */
	public skirtHeight = 1000;
	/** 高程数据，内部使用 */
	public data?: DEMType;

	constructor(options: SourceOptions = {}) {
		super(options);
		// 基类构造函数已 Object.assign 一次，这里再赋值一次以覆盖派生字段初始值
		// （useDefineForClassFields 下派生字段在 super() 返回后初始化，会重置
		// data/skirtHeight，须在最后再赋一次，见 GeoJSONSource 同款修复）
		Object.assign(this, options);
	}
}
