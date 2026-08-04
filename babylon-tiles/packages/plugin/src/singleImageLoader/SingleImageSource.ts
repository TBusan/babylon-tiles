/**
 * @description: 单影像数据源
 * @author: Babylon-Tile Team
 *
 * dataType='single-image'。整幅图片按 bounds 贴地显示，瓦片根据当前层级从
 * 原图裁剪对应子区域。
 */

import { SourceOptions, TileSource } from '@babylon-tile/lib';

/**
 * 单影像数据源
 */
export class SingleImageSource extends TileSource {
	/** 该数据源的类型标识 */
	public dataType = 'single-image';
	/** 影像数据，内部使用 */
	public image?: HTMLImageElement;

	constructor(options: SourceOptions = {}) {
		super(options);
		// 同 GeoJSONSource：派生字段初始值会覆盖 super 中 Object.assign 的选项，
		// 末尾再赋一次以保留 image 等传入数据
		Object.assign(this, options);
	}
}
