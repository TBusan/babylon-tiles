/**
 * @description: 瓦片加载器接口定义
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { Material } from '@babylonjs/core/Materials/material';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { ISource, BoundsType } from '../source/ISource.js';
import type { IProjection } from '../projection/IProjection.js';
import type { TextureCacheImpl } from './TextureCache.js';

// 重新导出 BoundsType 以保持一致性
export type { BoundsType };

/**
 * 瓦片坐标类型
 */
export type TileCoords = {
	/** 瓦片 X 坐标 */
	x: number;
	/** 瓦片 Y 坐标 */
	y: number;
	/** 瓦片 Z 坐标（层级） */
	z: number;
};

/**
 * 瓦片加载参数类型
 */
export type TileLoadParamsType = TileCoords & {
	/** 瓦片投影范围（或裁剪范围） */
	bounds: BoundsType;
	/** 瓦片经纬度范围 */
	lonLatBounds?: BoundsType;
};

/**
 * 带数据源的瓦片加载参数类型
 */
export type TileSourceLoadParamsType<TSource extends ISource = ISource> = TileLoadParamsType & {
	/** 瓦片数据源 */
	source: TSource;
	/**
	 * Babylon 场景（材质/纹理必须绑定场景）。
	 * Babylon 材质不能脱离场景创建，而 three.js 材质与场景无关——插件 loader 的
	 * load(params) 原本没有 scene，故扩展此字段由 TileLoader 分发时填充 this._scene，
	 * 使 loader 保持无状态单例（不绑定具体场景，多地图可复用）。
	 */
	scene?: Scene;
	/**
	 * 地图投影。部分 loader（如 quantized-mesh 重采样）需要反投影世界坐标→经纬度，
	 * 由 TileLoader 分发时填充 this._projection。内置 loader 均不依赖（worldScale 从
	 * bounds 宽度派生，等价于 projection.mapWidth/2^z），仅按需使用。
	 */
	projection?: IProjection;
	/**
	 * 纹理缓存（Engine 作用域，见 getCacheForEngine）。由 TileLoader 分发时填充；
	 * 内置 loader 经此访问缓存（多地图按引擎共享）。插件 loader 未填充时回退全局单例，
	 * 收尾后移除兼容层。
	 */
	cache?: TextureCacheImpl;
};

/**
 * 带裁剪范围的瓦片加载参数类型
 */
export type TileLoadClipParamsType<TSource extends ISource = ISource> = TileSourceLoadParamsType<TSource> & {
	/** 裁剪边界 */
	clipBounds: [number, number, number, number];
};

/**
 * 加载器元数据类型
 */
export type ITileLoaderInfo = {
	/** 加载器版本号 */
	version: string;
	/** 加载器作者 */
	author?: string;
	/** 加载器说明 */
	description?: string;
};

/**
 * 瓦片材质加载器接口
 * 用于加载瓦片影像数据
 */
export interface ITileMaterialLoader<TMaterial extends Material = Material> {
	/** 标识为材质加载器 */
	isMaterialLoader?: true;
	/** 加载器信息 */
	info: ITileLoaderInfo;
	/** 数据类型标识 */
	dataType: string;
	/**
	 * 加载影像数据。返回 undefined 表示「该瓦片无此源材质」（如 URL 缺失/纹理加载
	 * 失败/层级不符），调用方跳过该源回退背景材质——与 three-tile 的静默跳过语义一致。
	 */
	load(params: TileSourceLoadParamsType): Promise<TMaterial | undefined>;
	/** 卸载材质数据 */
	unload?(material: TMaterial): void;
}

/**
 * 瓦片几何体加载器接口
 * 用于加载瓦片地形数据
 */
export interface ITileGeometryLoader<TGeometry extends Mesh = Mesh> {
	/** 标识为几何体加载器 */
	isMaterialLoader?: false;
	/** 加载器信息 */
	info: ITileLoaderInfo;
	/** 数据类型标识 */
	dataType: string;
	/**
	 * 加载地形数据，返回瓦片网格。返回 undefined 表示「该瓦片无此源几何体」
	 * （如 URL 缺失），调用方回退平瓦片。加载失败时抛错由调用方 catch 兜底。
	 */
	load(params: TileSourceLoadParamsType): Promise<TGeometry | undefined>;
	/** 卸载几何体数据 */
	unload?(geometry: TGeometry): void;
}
