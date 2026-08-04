/**
 * @description: MVT（Mapbox Vector Tile）矢量底图数据源
 * @author: Babylon-Tile Team
 *
 * mvt 是矢量底图（核心渲染能力，经 lib 内置 MVTileMaterialLoader 渲染），
 * 区别于 geojson（矢量覆盖层，plugin 插件）。MVTSource 扩展 TileSource：
 * - dataType = 'mvt'（LoaderFactory 分发到 MVTileMaterialLoader）
 * - style：按图层名索引的样式表（VectorStyles），决定各图层在瓦片上的绘制方式
 * - transparent 默认 true：矢量瓦片为透明底 + 矢量图形（道路/水系/建筑等）
 */

import { TileSource, SourceOptions } from './TileSource.js';
import type { VectorStyles } from '../material/VectorTileRender.js';

/**
 * MVT 矢量瓦片样式表：{ layer: { 图层名: 样式 } }
 */
export type MVTStyleType = { layer: VectorStyles };

/**
 * MVT 数据源配置选项
 */
export type MVTSourceOptions = SourceOptions & {
	/** 矢量样式表（按图层名索引） */
	style?: MVTStyleType;
};

/**
 * MVT 矢量底图数据源
 */
export class MVTSource extends TileSource {
	/** 数据类型标识 */
	public dataType = 'mvt';

	/** 矢量样式表（按图层名索引） */
	public style?: MVTStyleType;

	/** 矢量瓦片默认透明（透明底 + 矢量图形） */
	public transparent: boolean = true;

	/**
	 * 构造函数
	 * @param options - 数据源配置选项（含 style）
	 */
	constructor(options?: MVTSourceOptions) {
		super(options);
		Object.assign(this, options);
	}
}
