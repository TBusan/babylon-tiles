/**
 * @description: LOGO 署名材质加载器
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile logoLoader：
 * - extends TileCanvasLoader，把数据源 attribution 文字画在瓦片上（旋转 -45° 倾斜水印）。
 */

import { TileCanvasLoader, TileSourceLoadParamsType } from '@babylon-tile/lib';

/**
 * LOGO 署名材质加载器：在瓦片上绘制数据源版权文字
 */
export class TileMaterialLogoLoader extends TileCanvasLoader {
	/** 加载器信息 */
	public readonly info = {
		version: '1.0.0',
		description: 'Tile logo image loader. It will draw text on the tile.',
	};

	/** 数据类型标识 */
	public dataType = 'logo';

	/**
	 * 在瓦片画布上绘制
	 * @param ctx - 瓦片 Canvas 上下文（256×256）
	 * @param params - 瓦片加载参数
	 */
	protected drawTile(ctx: CanvasRenderingContext2D, params: TileSourceLoadParamsType): void {
		ctx.fillStyle = 'white';
		ctx.shadowColor = 'black';
		ctx.shadowBlur = 5;
		ctx.shadowOffsetX = 1;
		ctx.shadowOffsetY = 1;
		ctx.font = 'bold 14px arial';
		ctx.textAlign = 'center';
		ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2);
		ctx.rotate(-Math.PI / 4);
		const attribution = (params.source as unknown as { attribution?: string }).attribution;
		ctx.fillText(`${attribution ?? ''}`, 0, 0);
	}
}
