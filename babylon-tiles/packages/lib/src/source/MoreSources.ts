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
 * MapBox 地形数据源配置
 */
export interface MapBoxTerrainSourceOptions extends SourceOptions {
	/** MapBox 访问令牌 */
	token?: string;
	/** 瓦片集 ID，默认 'mapbox.terrain-rgb' */
	tileset?: string;
}

/**
 * MapBox 地形数据源（Mapbox raster-dem，Terrain-RGB 编码）
 * 高程瓦片为 256px PNG，解析后为 257×257 网格（2^8+1），Martini 兼容。
 * 超出 maxLevel 的层级由 TileLoader 的 DEM 超采样裁剪（父级瓦片子区域）承担。
 */
export class MapBoxTerrainSource extends TileSource {
	/** 数据类型标识 */
	public dataType: string = 'terrain-rgb';

	/** 版权信息 */
	public attribution: string = '© Mapbox';

	/** 最大显示级别（raster-dem 可靠层级；更深由超采样承担） */
	public maxLevel: number = 14;

	/** MapBox 访问令牌 */
	public token: string = '';

	/** 瓦片集 ID */
	public tileset: string = 'mapbox.terrain-rgb';

	/** 默认 URL 模板 */
	public url: string = 'https://api.mapbox.com/v4/{tileset}/{z}/{x}/{y}.pngraw?access_token={token}';

	/**
	 * 构造函数
	 * @param options - MapBox 地形数据源配置
	 */
	constructor(options: MapBoxTerrainSourceOptions = {}) {
		super(options);
		// 注意：super 的 Object.assign 先应用 options，但 useDefineForClassFields 下
		// 子类字段初始化器随后会覆盖回默认值，故这里把可覆盖字段从 options 重新取回
		// （?? 可保留 maxLevel=0 之类的合法值）。
		this.dataType = options.dataType ?? 'terrain-rgb';
		this.attribution = options.attribution ?? '© Mapbox';
		this.maxLevel = options.maxLevel ?? 14;
		this.token = options.token ?? '';
		this.tileset = options.tileset ?? 'mapbox.terrain-rgb';

		if (options.url) {
			this.url = options.url;
		}
	}

	/**
	 * 获取瓦片 URL
	 */
	public getUrl(x: number, y: number, z: number): string {
		return super.getUrl(x, y, z, { tileset: this.tileset });
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

	/**
	 * URL 模板（{host}/{gdstyle} 由 getUrl 按 style 注入）：
	 *  - img/ter → 卫星影像服务 webst0X…style=6（z≤2 即有全球影像）
	 *  - cva     → 路网服务 webrd0X…style=8
	 * 高德路网/矢量服务在低层级（z≤2）返回 179 字节纯白空白瓦片，只有卫星服务有低层级影像。
	 */
	public url: string =
		'https://{host}0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style={gdstyle}&x={x}&y={y}&z={z}';

	/**
	 * 构造函数
	 * @param options - 高德地图数据源配置
	 */
	constructor(options: GDSourceOptions = {}) {
		super(options);
		this.style = options.style || 'img';
		this.subdomains = options.subdomains || '1234';
		// 卫星影像覆盖全球（含南极洲，z≤2 即有影像），声明 lat ±90 全范围，
		// 避免南部瓦片（z=2 的 y=3 行，lat -45..-90）触发 _clipTexture 的边界
		// 裁剪：原默认 bounds [-85,85] 会让这些瓦片走 Canvas 重编码 → data: 纹理
		// + 透明材质，既多一次图像解码又改变渲染管线。路网（cva）在南极高纬
		// 无数据，保持原有 ±85 裁剪行为。
		this.bounds = options.bounds || (this.style === 'cva' ? [-180, -85, 180, 85] : [-180, -90, 180, 90]);
	}

	/**
	 * 按 style 选择高德瓦片服务（修复原实现忽略 style、始终用路网 style=8 的问题）
	 * @param x - 瓦片 X 坐标
	 * @param y - 瓦片 Y 坐标
	 * @param z - 瓦片层级
	 * @returns 完整的瓦片 URL
	 */
	public override getUrl(x: number, y: number, z: number): string {
		// 高德无独立地形瓦片，ter 回退到卫星影像
		const satellite = this.style === 'img' || this.style === 'ter';
		return super.getUrl(x, y, z, {
			host: satellite ? 'webst' : 'webrd',
			gdstyle: satellite ? 6 : 8,
		});
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
			let digit = 0;
			const mask = 1 << (i - 1);
			// Bing quadkey：从最高位开始，x 位贡献 1，y 位贡献 2
			if ((x & mask) !== 0) {
				digit += 1;
			}
			if ((y & mask) !== 0) {
				digit += 2;
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
			// projectionID 默认值为 '3857'（TileSource 基类），允许同时匹配
			// 'EPSG:3857' 与 '3857' 两种写法（原实现只匹配带 EPSG 前缀的形式）
			crs: /3857/.test(this.projectionID) ? 'EPSG:3857' : 'EPSG:4326',
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
	gaodeImage: (options?: Omit<GDSourceOptions, 'style'>) => new GDSource({ ...options, style: 'img' }),

	/**
	 * 高德街道地图
	 */
	gaodeStreet: (options?: Omit<GDSourceOptions, 'style'>) => new GDSource({ ...options, style: 'cva' }),

	/**
	 * 百度街道地图
	 */
	baiduStreet: (options?: Omit<BaiduSourceOptions, 'style'>) => new BaiduSource({ ...options, style: 'vec' }),

	/**
	 * 百度卫星影像
	 */
	baiduImage: (options?: Omit<BaiduSourceOptions, 'style'>) => new BaiduSource({ ...options, style: 'img' }),

	/**
	 * Google 街道地图
	 */
	googleStreet: (options?: Omit<GoogleSourceOptions, 'type'>) => new GoogleSource({ ...options, type: 'm' }),

	/**
	 * Google 卫星影像
	 */
	googleSatellite: (options?: Omit<GoogleSourceOptions, 'type'>) => new GoogleSource({ ...options, type: 's' }),

	/**
	 * Google 地形图
	 */
	googleTerrain: (options?: Omit<GoogleSourceOptions, 'type'>) => new GoogleSource({ ...options, type: 't' }),
};
