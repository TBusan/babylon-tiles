/**
 * @description: Debug 调试材质加载器
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile debugLoader：
 * - extends TileCanvasLoader，在瓦片画布上画矩形边框与坐标信息（级别/行列/投影边界）。
 */

import { TileCanvasLoader, TileSourceLoadParamsType } from '@babylon-tile/lib';

/**
 * Debug 材质加载器：在瓦片上绘制矩形和坐标信息
 */
export class TileMaterialDebugeLoader extends TileCanvasLoader {
	/** 加载器信息 */
	public readonly info = {
		version: '1.0.0',
		description: 'Tile debug image loader. It will draw a rectangle and coordinate on the tile.',
	};

	/** 数据类型标识 */
	public readonly dataType = 'debug';

	/**
	 * 在瓦片画布上绘制
	 * @param ctx - 瓦片 Canvas 上下文（256×256）
	 * @param params - 瓦片加载参数
	 */
	protected drawTile(ctx: CanvasRenderingContext2D, params: TileSourceLoadParamsType): void {
		const { x, y, z, bounds, lonLatBounds } = params;
		const width = ctx.canvas.width;
		const height = ctx.canvas.height;

		// 边框
		ctx.strokeStyle = '#ccc';
		ctx.lineWidth = 4;
		ctx.strokeRect(5, 5, width - 10, height - 10);

		// 级别与行列号
		ctx.fillStyle = 'white';
		ctx.shadowColor = 'black';
		ctx.shadowBlur = 5;
		ctx.shadowOffsetX = 1;
		ctx.shadowOffsetY = 1;
		ctx.font = 'bold 20px arial';
		ctx.textAlign = 'center';
		ctx.fillText(`Level: ${z}`, width / 2, 50);
		ctx.fillText(`[${x}, ${y}]`, width / 2, 80);

		// 投影边界
		const centerX = width / 2;
		ctx.font = '14px arial';
		ctx.fillText(`[${bounds[0].toFixed(3)}, ${bounds[1].toFixed(3)}]`, centerX, height - 50);
		ctx.fillText(`[${bounds[2].toFixed(3)}, ${bounds[3].toFixed(3)}]`, centerX, height - 30);

		// 经纬度边界
		if (lonLatBounds) {
			ctx.fillText(`[${lonLatBounds[0].toFixed(3)}, ${lonLatBounds[1].toFixed(3)}]`, centerX, height - 120);
			ctx.fillText(`[${lonLatBounds[2].toFixed(3)}, ${lonLatBounds[3].toFixed(3)}]`, centerX, height - 100);
		}
	}
}
