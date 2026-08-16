/**
 * @description: Wireframe 线框材质加载器
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile wireframeLoader：
 * - dataType='wireframe'，按层级 z 生成色相 hsl(z*14)，线框显示瓦片网格。
 * - 作为 loader 插件注册进 LoaderFactory，imgSource.dataType='wireframe' 时启用。
 */

import { Material } from '@babylonjs/core/Materials/material';
import { Color3 } from '@babylonjs/core/Maths/math.color';

import { ITileMaterialLoader, ITileLoaderInfo, TileSourceLoadParamsType } from '@babylon-tile/lib';
import { TileMaterial } from '@babylon-tile/lib';

/**
 * Wireframe 材质加载器
 */
export class TileMaterialWrieLoader implements ITileMaterialLoader<Material> {
	/** 加载器信息 */
	public readonly info: ITileLoaderInfo = {
		version: '1.0.0',
		description: 'Tile wireframe material loader.',
	};

	/** 数据类型标识 */
	public readonly dataType = 'wireframe';

	/** 标识为材质加载器 */
	public readonly isMaterialLoader = true;

	/**
	 * 加载线框材质
	 * @param params - 加载参数
	 * @returns 线框材质；scene 缺失时返回 undefined（静默跳过）
	 */
	public async load(params: TileSourceLoadParamsType): Promise<Material | undefined> {
		const { scene, z, source, x, y } = params;
		if (!scene) return undefined;

		// 按层级色相：不同层级的瓦片用不同颜色线框，便于观察 LOD 切换
		const color = Color3.FromHSV((z * 14) % 360, 1, 0.5);
		return TileMaterial.createTileMaterial({
			scene,
			name: `wireframe-${z}-${x}-${y}`,
			diffuseColor: color,
			transparent: true,
			opacity: source.opacity ?? 1,
			wireframe: true,
			backFaceCulling: false,
		});
	}

	/**
	 * 卸载材质
	 */
	public unload(material: Material): void {
		material.dispose();
	}
}
