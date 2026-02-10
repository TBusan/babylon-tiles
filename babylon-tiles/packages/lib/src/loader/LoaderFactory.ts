/**
 * @description: 瓦片加载器工厂
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { ISource } from '../source/ISource.js';
import type { ITileGeometryLoader, ITileMaterialLoader } from './ITileLoaders.js';

const author = { name: 'Babylon-Tile Team' };

/**
 * 加载器工厂类
 * 用于注册、获取和管理瓦片加载器
 */
export class LoaderFactory {
	/** 加载器实例（单例） */
	private static _instance: LoaderFactory;

	/** DEM（地形）加载器映射表 */
	private readonly _demLoaderMap = new Map<string, ITileGeometryLoader>();

	/** 图像（材质）加载器映射表 */
	private readonly _imgLoaderMap = new Map<string, ITileMaterialLoader>();

	/**
	 * 私有构造函数（单例模式）
	 */
	private constructor() {}

	/**
	 * 获取工厂实例
	 */
	public static getInstance(): LoaderFactory {
		if (!LoaderFactory._instance) {
			LoaderFactory._instance = new LoaderFactory();
		}
		return LoaderFactory._instance;
	}

	/**
	 * 注册材质加载器
	 * @param loader - 材质加载器实例
	 */
	public registerMaterialLoader(loader: ITileMaterialLoader): void {
		this._imgLoaderMap.set(loader.dataType, loader);
		loader.info.author = loader.info.author || author.name;
	}

	/**
	 * 注册几何体加载器
	 * @param loader - 几何体加载器实例
	 */
	public registerGeometryLoader(loader: ITileGeometryLoader): void {
		this._demLoaderMap.set(loader.dataType, loader);
		loader.info.author = loader.info.author || author.name;
	}

	/**
	 * 根据数据源获取材质加载器
	 * @param source - 数据源或数据类型字符串
	 * @returns 材质加载器实例
	 * @throws 当找不到对应的加载器时抛出错误
	 */
	public getMaterialLoader(source: ISource | string): ITileMaterialLoader {
		const dataType = typeof source === 'string' ? source : source.dataType;
		const loader = this._imgLoaderMap.get(dataType);

		if (!loader) {
			throw new Error(`Image source dataType "${dataType}" is not supported!`);
		}

		return loader;
	}

	/**
	 * 根据数据源获取几何体加载器
	 * @param source - 数据源或数据类型字符串
	 * @returns 几何体加载器实例
	 * @throws 当找不到对应的加载器时抛出错误
	 */
	public getGeometryLoader(source: ISource | string): ITileGeometryLoader {
		const dataType = typeof source === 'string' ? source : source.dataType;
		const loader = this._demLoaderMap.get(dataType);

		if (!loader) {
			throw new Error(`Terrain source dataType "${dataType}" is not supported!`);
		}

		return loader;
	}

	/**
	 * 获取所有已注册的加载器
	 * @returns 包含图像加载器和地形加载器的对象
	 */
	public getAllLoaders(): {
		imgLoaders: ITileMaterialLoader[];
		demLoaders: ITileGeometryLoader[];
	} {
		return {
			imgLoaders: Array.from(this._imgLoaderMap.values()),
			demLoaders: Array.from(this._demLoaderMap.values()),
		};
	}

	/**
	 * 检查是否支持指定的数据类型
	 * @param dataType - 数据类型标识
	 * @param type - 加载器类型 ('image' | 'dem' | 'all')
	 * @returns 是否支持该数据类型
	 */
	public isSupported(dataType: string, type: 'image' | 'dem' | 'all' = 'all'): boolean {
		if (type === 'image' || type === 'all') {
			if (this._imgLoaderMap.has(dataType)) {
				return true;
			}
		}
		if (type === 'dem' || type === 'all') {
			if (this._demLoaderMap.has(dataType)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * 注销材质加载器
	 * @param dataType - 数据类型标识
	 */
	public unregisterMaterialLoader(dataType: string): boolean {
		return this._imgLoaderMap.delete(dataType);
	}

	/**
	 * 注销几何体加载器
	 * @param dataType - 数据类型标识
	 */
	public unregisterGeometryLoader(dataType: string): boolean {
		return this._demLoaderMap.delete(dataType);
	}

	/**
	 * 清空所有已注册的加载器
	 */
	public clear(): void {
		this._imgLoaderMap.clear();
		this._demLoaderMap.clear();
	}
}

/**
 * 导出工厂实例的便捷方法
 */
export const loaderFactory = LoaderFactory.getInstance();
