/**
 * @description: 瓦片加载器接口定义
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { Material } from '@babylonjs/core/Materials/material';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Geometry } from '@babylonjs/core/Meshes/geometry';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { ISource, BoundsType } from '../source/ISource.js';

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
	/** 加载影像数据 */
	load(params: TileSourceLoadParamsType): Promise<TMaterial>;
	/** 卸载材质数据 */
	unload?(material: TMaterial): void;
}

/**
 * 瓦片几何体加载器接口
 * 用于加载瓦片地形数据
 */
export interface ITileGeometryLoader<TGeometry extends Geometry | VertexData = VertexData> {
	/** 标识为几何体加载器 */
	isMaterialLoader?: false;
	/** 加载器信息 */
	info: ITileLoaderInfo;
	/** 数据类型标识 */
	dataType: string;
	/** 加载地形数据 */
	load(params: TileSourceLoadParamsType): Promise<TGeometry>;
	/** 卸载几何体数据 */
	unload?(geometry: TGeometry): void;
}
