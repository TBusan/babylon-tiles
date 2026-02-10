/**
 * @description: ArcGIS 地图服务数据源
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import { TileSource, type SourceOptions } from './TileSource.js';

/**
 * ArcGIS 地图服务数据源配置
 */
export interface ArcGisSourceOptions extends SourceOptions {
	/** 地图样式，默认为 'World_Imagery' */
	style?: string;
}

/**
 * ArcGIS 地图服务数据源
 * 支持 ArcGIS Online 的预定义服务和自定义服务
 */
export class ArcGisSource extends TileSource {
	/** 数据类型标识 */
	public dataType: string = 'image';

	/** 版权信息 */
	public attribution: string = 'ArcGIS';

	/** 地图样式 */
	public style: string = 'World_Imagery';

	/** 默认 URL 模板 */
	public url: string = 'https://services.arcgisonline.com/arcgis/rest/services/{style}/MapServer/tile/{z}/{y}/{x}';

	/**
	 * 构造函数
	 * @param options - ArcGIS 瓦片源配置
	 */
	constructor(options: ArcGisSourceOptions = {}) {
		super(options);
		this.style = options.style || 'World_Imagery';

		// 如果没有提供自定义 URL，使用默认模板
		if (!options.url) {
			this.url = 'https://services.arcgisonline.com/arcgis/rest/services/{style}/MapServer/tile/{z}/{y}/{x}';
		}
	}

	/**
	 * 获取瓦片 URL（重写父类方法以支持 style 参数）
	 * @param x - 瓦片 X 坐标
	 * @param y - 瓦片 Y 坐标
	 * @param z - 瓦片层级
	 * @returns 完整的瓦片 URL
	 */
	public getUrl(x: number, y: number, z: number): string {
		// 调用父类方法，传入 style 参数
		return super.getUrl(x, y, z, { style: this.style });
	}
}

/**
 * ArcGIS 地形数据源
 * 用于加载高程数据（LERC 格式）
 */
export class ArcGisDemSource extends TileSource {
	/** 数据类型标识 */
	public dataType: string = 'lerc';

	/** 版权信息 */
	public attribution: string = 'ArcGIS';

	/** 最小显示级别 */
	public minLevel: number = 5;

	/** 最大显示级别 */
	public maxLevel: number = 13;

	/** 默认 URL */
	public url: string =
		'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer/tile/{z}/{y}/{x}';

	/**
	 * 构造函数
	 * @param options - ArcGIS 地形数据源配置
	 */
	constructor(options: Omit<ArcGisSourceOptions, 'dataType' | 'style'> = {}) {
		super(options);

		// 如果没有提供自定义 URL，使用默认的地形服务 URL
		if (!options.url) {
			this.url =
				'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer/tile/{z}/{y}/{x}';
		}
	}
}

/**
 * 常用的 ArcGIS 数据源快捷创建函数
 */
export const ArcGisSources = {
	/**
	 * ArcGIS World Imagery（卫星影像）
	 */
	imagery: (options?: Omit<ArcGisSourceOptions, 'style' | 'url'>) =>
		new ArcGisSource({ ...options, style: 'World_Imagery' }),

	/**
	 * ArcGIS World Street Map（街道地图）
	 */
	street: (options?: Omit<ArcGisSourceOptions, 'style' | 'url'>) =>
		new ArcGisSource({ ...options, style: 'World_Street_Map' }),

	/**
	 * ArcGIS World Topo Map（地形地图）
	 */
	topo: (options?: Omit<ArcGisSourceOptions, 'style' | 'url'>) =>
		new ArcGisSource({ ...options, style: 'World_Topo_Map' }),

	/**
	 * ArcGIS Terrain Base（地形底图）
	 */
	terrain: (options?: Omit<ArcGisSourceOptions, 'style' | 'url'>) =>
		new ArcGisSource({ ...options, style: 'World_Terrain_Base' }),

	/**
	 * ArcGIS Ocean Basemap（海洋底图）
	 */
	ocean: (options?: Omit<ArcGisSourceOptions, 'style' | 'url'>) =>
		new ArcGisSource({ ...options, style: 'Ocean_Basemap' }),

	/**
	 * ArcGIS NatGeo World Map（国家地理世界地图）
	 */
	natgeo: (options?: Omit<ArcGisSourceOptions, 'style' | 'url'>) =>
		new ArcGisSource({ ...options, style: 'NatGeo_World_Map' }),

	/**
	 * ArcGIS Dark Gray Base（深灰色底图）
	 */
	dark: (options?: Omit<ArcGisSourceOptions, 'style' | 'url'>) =>
		new ArcGisSource({ ...options, style: 'Canvas/World_Dark_Gray_Base' }),

	/**
	 * ArcGIS Light Gray Base（浅灰色底图）
	 */
	light: (options?: Omit<ArcGisSourceOptions, 'style' | 'url'>) =>
		new ArcGisSource({ ...options, style: 'Canvas/World_Light_Gray_Base' }),
};
