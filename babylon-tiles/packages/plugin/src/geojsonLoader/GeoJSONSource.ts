/**
 * @description: GeoJSON 覆盖层数据源
 * @author: Babylon-Tile Team
 *
 * dataType='geojson'。geojson 是要素**覆盖层**（非底图），归 plugin。
 * 用 geojson-vt 把 GeoJSON 按瓦片坐标裁剪，绘制 Canvas 生成瓦片纹理。
 */

import { SourceOptions, TileSource, VectorStyle } from '@babylon-tile/lib';

/** GeoJSON 数据源选项 */
export type GeoJSONSourceOptions = SourceOptions & { style?: VectorStyle };

/**
 * GeoJSON 覆盖层数据源
 */
export class GeoJSONSource extends TileSource {
	/** 该数据源的类型标识 */
	public dataType = 'geojson';
	/** 是否正在加载数据 */
	public loading = false;
	/** 绘制样式 */
	public style: VectorStyle = {};
	/** geojson-vt 切片索引（懒加载） */
	public gv: any;

	public constructor(options: GeoJSONSourceOptions) {
		super(options);
		// 基类构造函数已 Object.assign 一次，这里再赋值一次以覆盖派生字段初始值
		// （派生字段在 super() 返回后初始化，会重置 style 等，须在最后再赋一次）
		Object.assign(this, options);
	}
}
