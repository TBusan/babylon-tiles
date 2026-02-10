/**
 * @description: 更多地图数据源
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import { TileSource, type SourceOptions } from './TileSource.js';

/**
 * MapBox 数据源配置
 */
export interface MapBoxSourceOptions extends SourceOptions {
	/** MapBox 访问令牌 */
	token: string;
	/** 地图样式，默认 'mapbox.satellite' */
	style?: string;
	/** 图片格式，默认 'png' */
	format?: string;
}

/**
 * MapBox 地图数据源
 */
export class MapBoxSource extends TileSource {
	/** 数据类型标识 */
	public dataType: string = 'image';

	/** 版权信息 */
	public attribution: string = 'MapBox';

	/** 最大显示级别 */
	public maxLevel: number = 19;

	/** MapBox 访问令牌 */
	public token: string = '';

	/** 地图样式 */
	public style: string = 'mapbox.satellite';

	/** 图片格式 */
	public format: string = 'png';

	/** 默认 URL 模板 */
	public url: string = 'https://api.mapbox.com/v4/{style}/{z}/{x}/{y}.{format}?access_token={token}';

	/**
	 * 构造函数
	 * @param options - MapBox 数据源配置
	 */
	constructor(options: MapBoxSourceOptions) {
		super(options);
		this.token = options.token || '';
		this.style = options.style || 'mapbox.satellite';
		this.format = options.format || 'png';

		if (!options.url) {
			this.url = 'https://api.mapbox.com/v4/{style}/{z}/{x}/{y}.{format}?access_token={token}';
		}
	}

	/**
	 * 获取瓦片 URL
	 */
	public getUrl(x: number, y: number, z: number): string {
		return super.getUrl(x, y, z, { style: this.style, format: this.format });
	}
}

/**
 * 天地图数据源配置
 */
export interface TDTSourceOptions extends SourceOptions {
	/** 天地图访问令牌 */
	token: string;
	/** 地图样式 */
	style?: 'img_w' | 'cia_w' | 'cva_w' | 'ibo_w' | 'ter_w' | 'vec_w' | 'cta_w' | 'img_c' | 'cia_c';
}

/**
 * 天地图数据源
 */
export class TDTSource extends TileSource {
	/** 数据类型标识 */
	public dataType: string = 'image';

	/** 版权信息 */
	public attribution: string = '天地图[GS(2023)336号]';

	/** 天地图访问令牌 */
	public token: string = '';

	/** 地图样式 */
	public style: 'img_w' | 'cia_w' | 'cva_w' | 'ibo_w' | 'ter_w' | 'vec_w' | 'cta_w' | 'img_c' | 'cia_c' = 'img_w';

	/** URL 子域名 */
	public subdomains: string | string[] = '01234';

	/** 默认 URL 模板 */
	public url: string = 'https://t{s}.tianditu.gov.cn/DataServer?T={style}&x={x}&y={y}&l={z}&tk={token}';

	/**
	 * 构造函数
	 * @param options - 天地图数据源配置
	 */
	constructor(options: TDTSourceOptions) {
		super(options);
		this.token = options.token || '';
		this.style = options.style || 'img_w';
		this.subdomains = options.subdomains || '01234';

		if (!options.url) {
			this.url = 'https://t{s}.tianditu.gov.cn/DataServer?T={style}&x={x}&y={y}&l={z}&tk={token}';
		}
	}

	/**
	 * 获取瓦片 URL
	 */
	public getUrl(x: number, y: number, z: number): string {
		return super.getUrl(x, y, z, { style: this.style });
	}
}

/**
 * 天地图地形数据源
 */
export class TDTDemSource extends TileSource {
	/** 数据类型标识 */
	public dataType: string = 'lerc';

	/** 版权信息 */
	public attribution: string = '天地图[GS(2023)336号]';

	/** 天地图访问令牌 */
	public token: string = '';

	/** URL 子域名 */
	public subdomains: string | string[] = '01234';

	/** 默认 URL 模板 */
	public url: string = 'https://t{s}.tianditu.gov.cn/mapservice/swdx?T=elv_c&tk={token}&x={x}&y={y}&l={z}';

	/**
	 * 构造函数
	 * @param options - 天地图数据源配置
	 */
	constructor(options: Omit<TDTSourceOptions, 'style'>) {
		super(options);
		this.token = (options.token as string) || '';
		this.subdomains = (options.subdomains as string | string[]) || '01234';

		if (!options.url) {
			this.url = 'https://t{s}.tianditu.gov.cn/mapservice/swdx?T=elv_c&tk={token}&x={x}&y={y}&l={z}';
		}
	}
}

/**
 * 高德地图数据源配置
 */
export interface GDSourceOptions extends SourceOptions {
	/** 地图样式 */
	style?: 'img' | 'cva' | 'ter';
}

/**
 * 高德地图数据源
 */
export class GDSource extends TileSource {
	/** 数据类型标识 */
	public dataType: string = 'image';

	/** 版权信息 */
	public attribution: string = '高德地图';

	/** 地图样式 */
	public style: 'img' | 'cva' | 'ter' = 'img';

	/** URL 子域名 */
	public subdomains: string | string[] = '1234';

	/** 默认 URL 模板 */
	public url: string = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';

	/**
	 * 构造函数
	 * @param options - 高德地图数据源配置
	 */
	constructor(options: GDSourceOptions = {}) {
		super(options);
		this.style = options.style || 'img';
		this.subdomains = options.subdomains || '1234';

		if (!options.url) {
			this.url = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';
		}
	}
}

/**
 * 百度地图数据源配置
 */
export interface BaiduSourceOptions extends SourceOptions {
	/** 地图样式 */
	style?: 'vec' | 'img' | 'custom';
}

/**
 * 百度地图数据源
 */
export class BaiduSource extends TileSource {
	/** 数据类型标识 */
	public dataType: string = 'image';

	/** 版权信息 */
	public attribution: string = '百度地图';

	/** 地图样式 */
	public style: 'vec' | 'img' | 'custom' = 'vec';

	/** URL 子域名 */
	public subdomains: string | string[] = '012';

	/** 默认 URL 模板 */
	public url: string = 'https://maponline0{s}.bdimg.com/tile/?qt=tile&x={x}&y={y}&z={z}&styles={style}';

	/**
	 * 构造函数
	 * @param options - 百度地图数据源配置
	 */
	constructor(options: BaiduSourceOptions = {}) {
		super(options);
		this.style = options.style || 'vec';
		this.subdomains = options.subdomains || '012';

		if (!options.url) {
			this.url = 'https://maponline0{s}.bdimg.com/tile/?qt=tile&x={x}&y={y}&z={z}&styles={style}';
		}
	}

	/**
	 * 获取瓦片 URL
	 */
	public getUrl(x: number, y: number, z: number): string {
		return super.getUrl(x, y, z, { style: this.style });
	}
}

/**
 * Google 地图数据源配置
 */
export interface GoogleSourceOptions extends SourceOptions {
	/** 地图类型 */
	type?: 'm' | 's' | 'p' | 't' | 'r';
}

/**
 * Google 地图数据源
 */
export class GoogleSource extends TileSource {
	/** 数据类型标识 */
	public dataType: string = 'image';

	/** 版权信息 */
	public attribution: string = 'Google';

	/** 地图类型 */
	public type: 'm' | 's' | 'p' | 't' | 'r' = 'm';

	/** URL 子域名 */
	public subdomains: string | string[] = '012';

	/** 默认 URL 模板 */
	public url: string = 'https://mt{s}.google.com/vt/lyrs={type}&x={x}&y={y}&z={z}';

	/**
	 * 构造函数
	 * @param options - Google 地图数据源配置
	 */
	constructor(options: GoogleSourceOptions = {}) {
		super(options);
		this.type = options.type || 'm';
		this.subdomains = options.subdomains || '012';

		if (!options.url) {
			this.url = 'https://mt{s}.google.com/vt/lyrs={type}&x={x}&y={y}&z={z}';
		}
	}

	/**
	 * 获取瓦片 URL
	 */
	public getUrl(x: number, y: number, z: number): string {
		return super.getUrl(x, y, z, { type: this.type });
	}
}

/**
 * Bing 地图数据源配置
 */
export interface BingSourceOptions extends SourceOptions {
	/** 地图样式 */
	style?: 'aerial' | 'road' | 'hybrid';
	/** Bing Maps API 密钥 */
	key?: string;
}

/**
 * Bing 地图数据源
 */
export class BingSource extends TileSource {
	/** 数据类型标识 */
	public dataType: string = 'image';

	/** 版权信息 */
	public attribution: string = 'Bing';

	/** 地图样式 */
	public style: 'aerial' | 'road' | 'hybrid' = 'aerial';

	/** Bing Maps API 密钥 */
	public key: string = '';

	/** 默认 URL 模板 */
	public url: string = 'https://ecn.t{s}.tiles.virtualearth.net/tiles/{style}{q}.jpeg?g=1&key={key}';

	/**
	 * 构造函数
	 * @param options - Bing 地图数据源配置
	 */
	constructor(options: BingSourceOptions = {}) {
		super(options);
		this.style = options.style || 'aerial';
		this.key = options.key || '';
		this.subdomains = options.subdomains || '0123';

		if (!options.url) {
			this.url = 'https://ecn.t{s}.tiles.virtualearth.net/tiles/a{q}.jpeg?g=1';
		}
	}

	/**
	 * 获取瓦片 URL（Bing 使用四叉键）
	 */
	public getUrl(x: number, y: number, z: number): string {
		const quadKey = this._tileToQuadKey(x, y, z);
		return super.getUrl(x, y, z, { q: quadKey });
	}

	/**
	 * 将 XYZ 坐标转换为 Bing 的四叉键格式
	 */
	private _tileToQuadKey(x: number, y: number, z: number): string {
		let quadKey = '';
		for (let i = z; i > 0; i--) {
			const digit = 0;
			const mask = 1 << (i - 1);
			if ((x & mask) !== 0) {
				// digit += 1;
			}
			if ((y & mask) !== 0) {
				// digit += 2;
			}
			quadKey += digit.toString();
		}
		return quadKey;
	}
}

/**
 * WMS 数据源配置
 */
export interface WmsSourceOptions extends SourceOptions {
	/** WMS 服务图层 */
	layers: string;
	/** WMS 版本 */
	version?: string;
	/** 图片格式 */
	format?: string;
	/** 透明背景 */
	transparent?: boolean;
}

/**
 * WMS（Web Map Service）数据源
 */
export class WmsSource extends TileSource {
	/** 数据类型标识 */
	public dataType: string = 'image';

	/** WMS 服务图层 */
	public layers: string = '';

	/** WMS 版本 */
	public version: string = '1.3.0';

	/** 图片格式 */
	public format: string = 'image/png';

	/** 透明背景 */
	public transparent: boolean = true;

	/**
	 * 构造函数
	 * @param options - WMS 数据源配置
	 */
	constructor(options: WmsSourceOptions) {
		super(options);
		this.layers = options.layers;
		this.version = options.version || '1.3.0';
		this.format = options.format || 'image/png';
		this.transparent = options.transparent !== undefined ? options.transparent : true;
	}

	/**
	 * 获取瓦片 URL
	 */
	public getUrl(x: number, y: number, z: number): string {
		// WMS 使用 BBOX 参数而不是 XYZ
		const bbox = this._wmsGetBBox(x, y, z);
		const baseUrl = this.url.split('?')[0];
		const separator = this.url.includes('?') ? '&' : '?';

		const params = new URLSearchParams({
			service: 'WMS',
			version: this.version,
			request: 'GetMap',
			layers: this.layers,
			styles: '',
			format: this.format,
			transparent: this.transparent.toString(),
			width: '256',
			height: '256',
			bbox: bbox,
			crs: this.projectionID === 'EPSG:3857' ? 'EPSG:3857' : 'EPSG:4326',
		});

		return `${baseUrl}${separator}${params.toString()}`;
	}

	/**
	 * 获取 WMS 边界框
	 */
	private _wmsGetBBox(x: number, y: number, z: number): string {
		const worldSize = Math.PI * 6378137;
		const tileSize = (2 * worldSize) / Math.pow(2, z);
		const minX = -worldSize + x * tileSize;
		const minY = worldSize - (y + 1) * tileSize;
		const maxX = -worldSize + (x + 1) * tileSize;
		const maxY = worldSize - y * tileSize;
		return `${minX},${minY},${maxX},${maxY}`;
	}
}

/**
 * 快捷创建函数集合
 */
export const QuickSources = {
	/**
	 * OpenStreetMap 标准地图
	 */
	osm: (options?: Omit<SourceOptions, 'url'>) =>
		new TileSource({
			...options,
			url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
			subdomains: 'abc',
			attribution: '© OpenStreetMap contributors',
			maxLevel: 19,
		}),

	/**
	 * MapBox 卫星影像
	 */
	mapboxSatellite: (options: MapBoxSourceOptions) =>
		new MapBoxSource({ ...options, style: options.style || 'mapbox.satellite' }),

	/**
	 * MapBox 街道地图
	 */
	mapboxStreets: (options: MapBoxSourceOptions) =>
		new MapBoxSource({ ...options, style: options.style || 'mapbox.streets' }),

	/**
	 * 高德卫星影像
	 */
	gaodeImage: (options?: Omit<GDSourceOptions, 'style'>) =>
		new GDSource({ ...options, style: 'img' }),

	/**
	 * 高德街道地图
	 */
	gaodeStreet: (options?: Omit<GDSourceOptions, 'style'>) =>
		new GDSource({ ...options, style: 'cva' }),

	/**
	 * 百度街道地图
	 */
	baiduStreet: (options?: Omit<BaiduSourceOptions, 'style'>) =>
		new BaiduSource({ ...options, style: 'vec' }),

	/**
	 * 百度卫星影像
	 */
	baiduImage: (options?: Omit<BaiduSourceOptions, 'style'>) =>
		new BaiduSource({ ...options, style: 'img' }),

	/**
	 * Google 街道地图
	 */
	googleStreet: (options?: Omit<GoogleSourceOptions, 'type'>) =>
		new GoogleSource({ ...options, type: 'm' }),

	/**
	 * Google 卫星影像
	 */
	googleSatellite: (options?: Omit<GoogleSourceOptions, 'type'>) =>
		new GoogleSource({ ...options, type: 's' }),

	/**
	 * Google 地形图
	 */
	googleTerrain: (options?: Omit<GoogleSourceOptions, 'type'>) =>
		new GoogleSource({ ...options, type: 't' }),
};
