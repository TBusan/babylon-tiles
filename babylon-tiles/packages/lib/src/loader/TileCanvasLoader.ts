/**
 * @description: Canvas 瓦片材质加载器抽象基类（插件材质 loader 继承）
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile 的 TileCanvasLoader：
 * - load() 创建 256×256 Canvas（DynamicTexture），子类 drawTile(ctx, params) 绘制内容，
 *   再包成透明瓦片材质。
 * - 典型子类：debug（画坐标）、logo（画署名）。
 */

import type { Scene } from '@babylonjs/core/scene';
import { Material } from '@babylonjs/core/Materials/material';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';

import type {
	ITileMaterialLoader,
	ITileLoaderInfo,
	TileSourceLoadParamsType,
} from './ITileLoaders.js';
import { TileMaterial } from '../material/TileMaterial.js';

/**
 * Canvas 材质加载器抽象基类
 * 子类实现 drawTile(ctx, params) 在 256×256 画布上绘制瓦片内容。
 */
export abstract class TileCanvasLoader implements ITileMaterialLoader<Material> {
	/** 加载器信息 */
	public readonly info: ITileLoaderInfo = {
		version: '1.0.0',
		description: 'Canvas tile abstract loader',
	};

	/** 数据类型标识（子类覆盖） */
	public dataType = '';

	/** 标识为材质加载器 */
	public readonly isMaterialLoader = true;

	/**
	 * 加载瓦片材质
	 * @param params - 加载参数（含 source/coords/bounds/scene）
	 * @returns 瓦片材质；scene 缺失时抛错（调用方 catch 兜底）
	 */
	public async load(params: TileSourceLoadParamsType): Promise<Material | undefined> {
		const { scene, source } = params;
		if (!scene) {
			throw new Error(`TileCanvasLoader(${this.dataType}): scene not provided in params`);
		}

		const { x, y, z } = params;
		const texture = new DynamicTexture(`tile-${z}-${x}-${y}-${this.dataType}`, 256, scene, false);
		const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;

		// 清空画布（透明背景）
		ctx.clearRect(0, 0, 256, 256);

		// 子类绘制
		this.drawTile(ctx, params);

		// 更新纹理
		texture.update();
		texture.hasAlpha = true;

		return TileMaterial.createTileMaterial({
			scene,
			name: `tile-${z}-${x}-${y}-material`,
			diffuseTexture: texture,
			opacity: source.opacity ?? 1,
			transparent: true,
		});
	}

	/**
	 * 卸载材质
	 */
	public unload(material: Material): void {
		const std = material as import('@babylonjs/core/Materials/standardMaterial').StandardMaterial;
		if (std.diffuseTexture) {
			std.diffuseTexture.dispose();
		}
		material.dispose();
	}

	/**
	 * 绘制瓦片（抽象，子类实现）
	 * @param ctx - Canvas 2D 上下文（256×256）
	 * @param params - 瓦片加载参数
	 */
	protected abstract drawTile(
		ctx: CanvasRenderingContext2D,
		params: TileSourceLoadParamsType
	): void;
}
