/**
 * @description: 数据源基类
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { ISource, BoundsType } from './ISource.js';
import type { IProjection } from '../projection/IProjection.js';

/**
 * 数据源配置选项
 */
export interface SourceOptions {
	/** 数据类型标识（用于选择对应的加载器） */
	dataType?: string;
	/** 版权信息 */
	attribution?: string;
	/** 最小显示级别 */
	minLevel?: number;
	/** 最大显示级别 */
	maxLevel?: number;
	/** 投影类型 */
	projectionID?: string;
	/** 材质透明度（0-1） */
	opacity?: number;
	/** 是否透明 */
	transparent?: boolean;
	/** 地理坐标边界 [minLon, minLat, maxLon, maxLat] */
	bounds?: [number, number, number, number];
	/** URL 模板 */
	url?: string;
	/** URL 子域名（数组或字符串），用于负载均衡 */
	subdomains?: string[] | string;
	/** 是否使用 TMS 瓦片坐标系（默认 false 使用 XYZ） */
	isTMS?: boolean;
	/** 其他自定义数据 */
	[key: string]: unknown;
}

/**
 * 数据源基类
 * 用户可以通过继承此类来自定义数据源
 */
export class TileSource implements ISource {
	/** 数据类型标识 */
	public dataType: string = 'image';

	/** 版权信息 */
	public attribution: string = 'BabylonTiles';

	/** 最小显示级别 */
	public minLevel: number = 0;

	/** 最大显示级别 */
	public maxLevel: number = 18;

	/** 投影类型标识 */
	public projectionID: string = 'EPSG:3857';

	/** URL 模板 */
	public url: string = '';

	/** URL 子域名（用于负载均衡） */
	public subdomains: string[] | string = [];

	/** 材质透明度（0-1） */
	public opacity: number = 1.0;

	/** 是否透明 */
	public transparent: boolean = true;

	/** 是否使用 TMS 瓦片坐标系 */
	public isTMS: boolean = false;

	/** 地理坐标边界 */
	public bounds?: [number, number, number, number];

	/** 投影边界（内部使用） */
	public _projectionBounds: BoundsType = [-Infinity, -Infinity, Infinity, Infinity];

	/** 其他自定义数据 */
	[key: string]: unknown;

	/**
	 * 构造函数
	 * @param options - 数据源配置选项
	 */
	constructor(options?: SourceOptions) {
		if (options) {
			Object.assign(this, options);
		}
	}

	/**
	 * 获取瓦片的投影边界框
	 * @param x - 瓦片 X 坐标
	 * @param y - 瓦片 Y 坐标
	 * @param z - 瓦片层级
	 * @returns 边界框字符串
	 */
	private _getBBox(x: number, y: number, z: number): string {
		const worldSize = Math.PI * 6378137;
		const tileSize = (2 * worldSize) / Math.pow(2, z);
		const minX = -worldSize + x * tileSize;
		const minY = worldSize - (y + 1) * tileSize;
		const maxX = -worldSize + (x + 1) * tileSize;
		const maxY = worldSize - y * tileSize;
		return `${minX},${minY},${maxX},${maxY}`;
	}

	/**
	 * 获取瓦片 URL
	 * @param x - 瓦片 X 坐标
	 * @param y - 瓦片 Y 坐标
	 * @param z - 瓦片层级
	 * @param obj - 额外的模板变量对象
	 * @returns 完整的瓦片 URL
	 */
	public getUrl(x: number, y: number, z: number, obj?: { [name: string]: unknown }): string {
		// 随机选择子域名
		const subLen = Array.isArray(this.subdomains) ? this.subdomains.length : 0;
		let s: string | undefined;
		if (subLen > 0) {
			const index = Math.floor(Math.random() * subLen);
			s = this.subdomains[index];
		}

		// 如果是 TMS 坐标系，反转 Y 坐标
		y = this.isTMS ? Math.pow(2, z) - 1 - y : y;

		// 计算边界框
		const bbox = this._getBBox(x, y, z);

		// 构建模板数据
		const data = {
			...this,
			...{ x, y, z, s, bbox },
			...obj,
		};

		return strTemplate(this.url, data);
	}

	/**
	 * 静态工厂方法：通过配置创建数据源
	 * @param options - 数据源配置选项
	 * @returns 数据源实例
	 */
	public static create(options: SourceOptions): TileSource {
		return new TileSource(options);
	}

	/**
	 * 计算投影边界
	 * @param projection - 投影对象
	 */
	protected _calculateProjectionBounds(projection: IProjection): void {
		if (this.bounds) {
			this._projectionBounds = projection.getProjBoundsFromLonLat(this.bounds);
		}
	}
}

/**
 * 字符串模板函数
 * 支持类似 "Hello {a}, {b}" 的模板字符串，并提供数据对象进行替换
 * @param str - 模板字符串
 * @param data - 数据对象
 * @returns 替换后的字符串
 *
 * @example
 * ```typescript
 * strTemplate('Hello {a}, {b}', {a: 'foo', b: 'bar'}) // 返回 'Hello foo, bar'
 * strTemplate('https://{s}.tile.com/{z}/{x}/{y}.png', {s: 'a', x: 1, y: 2, z: 3})
 * // 返回 'https://a.tile.com/3/1/2.png'
 * ```
 */
export function strTemplate(str: string, data: { [name: string]: unknown }): string {
	const templateRe = /\{ *([\w_-]+) *\}/g;
	return str.replace(templateRe, (str, key) => {
		const value = data[key];
		if (value === undefined || value === null) {
			throw new Error(`source url template error, No value provided for variable: ${str}`);
		}
		return typeof value === 'function' ? (value as (data: unknown) => string)(data) : String(value);
	});
}
