/**
 * @description: 瓦片加载器接口定义
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { IProjection } from '../projection/IProjection.js';
import type { BoundsType } from '../source/ISource.js';
import type { ISource } from '../source/ISource.js';

// 前向声明 Tile 类型
import type { Tile } from '../tile/Tile.js';

/**
 * 瓦片加载参数
 */
export interface TileLoadParams {
	/** 瓦片 X 坐标 */
	x: number;
	/** 瓦片 Y 坐标 */
	y: number;
	/** 瓦片层级 */
	z: number;
	/** 瓦片边界（投影坐标） */
	bounds: BoundsType;
	/** 数据源 */
	source?: ISource;
}

/**
 * 瓦片加载器接口
 * 定义了加载、更新和卸载瓦片数据的方法
 */
export interface ITileLoader {
	/** 投影对象 */
	projection: IProjection;

	/** 投影ID（便捷访问） */
	readonly projectionID: string;

	/** 影像数据源 */
	imgSource: ISource[];

	/** 地形数据源 */
	demSource?: ISource;

	/** 当前下载数量 */
	readonly downloadingThreads: number;

	/** 最大下载线程数 */
	maxThreads: number;

	/** 调试标志（0: 不调试, 1: 调试, 2: 显示包围盒） */
	debug: number;

	/**
	 * 加载瓦片数据
	 * @param params - 瓦片加载参数或 Tile 对象
	 * @returns Promise<Mesh> 瓦片网格
	 */
	load(params: TileLoadParams | Tile): Promise<Mesh>;

	/**
	 * 更新瓦片数据
	 * @param mesh - 要更新的瓦片网格
	 * @param params - 瓦片加载参数或 Tile 对象
	 * @param updateMaterial - 是否更新材质
	 * @param updateGeometry - 是否更新几何体
	 * @returns Promise<Mesh> 更新后的瓦片网格
	 */
	update(mesh: Mesh, params: TileLoadParams | Tile, updateMaterial: boolean, updateGeometry: boolean): Promise<Mesh>;

	/**
	 * 卸载瓦片数据
	 * @param mesh - 要卸载的瓦片网格
	 */
	unload(mesh: Mesh): void;
}
