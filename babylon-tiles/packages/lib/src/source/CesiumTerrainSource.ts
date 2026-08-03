/**
 * @description: Cesium quantized-mesh 地形数据源
 * @author: Babylon-Tile Team
 *
 * 用于加载 Cesium 生态的 quantized-mesh 地形瓦片（如 AWS elevation-tiles-prod、
 * Cesium ion terrain）。瓦片为二进制 TIN 格式，由 QuantizedMeshLoader 解码。
 *
 * 关键：quantized-mesh 服务网格与本地 3857 瓦片网格**不一定同构**。
 * - EPSG:3857 + slippy：与本地瓦片同网格，服务瓦片坐标由本地瓦片坐标直接推导。
 * - EPSG:4326 + tms（默认）：服务瓦片是等经纬度网格。服务瓦片数按根瓦片数
 *   倍增（numberOfLevelZeroTilesX/Y，Mars3D 为 2×2 → n_x=n_y=2^(z+1)）。
 *   getTileCoordsForBounds 选择服务层级 zz ≈ z - log2(rootX) 使服务瓦片经度
 *   跨度与本地瓦片相当，并返回**覆盖本地瓦片经纬度边界的所有服务瓦片**
 *   （纬向 3857 拉伸通常覆盖多块），供 TileLoader 合并解码后的 TIN。
 *
 * 注意：本类返回的坐标可直接用于 getUrl（URL 坐标即服务坐标），因此 isTMS
 * 保持 false，不做基类的二次翻转。字节序由 littleEndian 指定（Mars3D 为小端）。
 */

import { TileSource, type SourceOptions } from './TileSource.js';

/**
 * Cesium 地形数据源配置
 */
export interface CesiumTerrainSourceOptions extends SourceOptions {
	/** URL 模板（默认空，需提供，如 'https://…/terrain/{z}/{x}/{y}.terrain'） */
	url?: string;
	/** 瓦片网格方案：'EPSG:4326'（默认）| 'EPSG:3857' */
	tilingScheme?: 'EPSG:4326' | 'EPSG:3857';
	/** 是否 TMS 坐标系（y=0 在北行），默认 true（4326 服务惯例） */
	tms?: boolean;
	/** 最小显示级别，默认 0 */
	minLevel?: number;
	/** 最大显示级别，默认 15 */
	maxLevel?: number;
	/**
	 * Cesium ion access token（可选）。
	 * 填了 token 且未提供 url 时，初始化时自动调 Cesium ion API
	 * （/v1/assets/{assetId}/endpoint）解析真实瓦片 URL 并附带
	 * Authorization: Bearer <token> 请求头。
	 */
	token?: string;
	/** Cesium ion asset id（默认 1 = Cesium World Terrain） */
	assetId?: number;
	/** 根层级（level 0）X 方向瓦片数，默认 2（标准 Cesium GlobalGeographic 2 列根） */
	numberOfLevelZeroTilesX?: number;
	/**
	 * 根层级（level 0）Y 方向瓦片数，默认 1（标准 Cesium GlobalGeographic）。
	 * Mars3D 等部分服务为 2（全球 2×2 根瓦片，n_x = n_y = 2^(z+1)）。
	 */
	numberOfLevelZeroTilesY?: number;
	/**
	 * 瓦片是否小端字节序（默认 false = 规范大端）。
	 * Mars3D 等部分服务整个文件为小端，需置 true。
	 */
	littleEndian?: boolean;
	/**
	 * 附加请求头（如 quantized-mesh 服务要求的 Accept 协商头）。
	 * 由外部按实际服务配置，不在本类内部写死。
	 */
	headers?: Record<string, string>;
}

/**
 * 覆盖本地瓦片的服务瓦片坐标 + 其经纬度边界
 */
export interface QuantizedMeshTileCoords {
	/** 服务瓦片 X（可直接用于 getUrl） */
	x: number;
	/** 服务瓦片 Y（可直接用于 getUrl，tms 或 slippy 由 source.tms 决定） */
	y: number;
	/** 服务瓦片层级（可能低于本地层级，保证覆盖） */
	z: number;
	/** 服务瓦片经纬度边界 [west, south, east, north]（用于解码顶点经纬度） */
	lonLatBounds: [number, number, number, number];
}

/**
 * Cesium quantized-mesh 地形数据源
 */
export class CesiumTerrainSource extends TileSource {
	/** 数据类型标识 */
	public dataType: string = 'quantized-mesh';

	/** 版权信息 */
	public attribution: string = '© Cesium terrain';

	/** 最小显示级别 */
	public minLevel: number = 0;

	/** 最大显示级别 */
	public maxLevel: number = 15;

	/** 瓦片网格方案 */
	public tilingScheme: 'EPSG:4326' | 'EPSG:3857' = 'EPSG:4326';

	/** 是否 TMS 坐标系（y=0 在北行） */
	public tms: boolean = true;

	/** Cesium ion access token（空则不附加认证头） */
	public token: string = '';

	/** Cesium ion asset id（默认 1 = Cesium World Terrain） */
	public assetId: number = 1;

	/** 根层级（level 0）X 方向瓦片数，默认 2（标准 Cesium GlobalGeographic） */
	public numberOfLevelZeroTilesX: number = 2;

	/** 根层级（level 0）Y 方向瓦片数，默认 1；Mars3D 等部分服务为 2 */
	public numberOfLevelZeroTilesY: number = 1;

	/** 瓦片是否小端字节序（默认 false = 规范大端；Mars3D 等部分服务为 true） */
	public littleEndian: boolean = false;

	/** 附加请求头（如 quantized-mesh 服务要求的 Accept 协商头），由外部配置 */
	public headers: Record<string, string> = {};

	/**
	 * 构造函数
	 * @param options - Cesium 地形数据源配置
	 */
	constructor(options: CesiumTerrainSourceOptions = {}) {
		super(options);
		// super 的 Object.assign 先应用 options，但 useDefineForClassFields 下子类字段
		// 初始化器随后覆盖回默认值，故这里把可覆盖字段从 options 重新取回。
		this.dataType = options.dataType ?? 'quantized-mesh';
		this.attribution = options.attribution ?? '© Cesium terrain';
		this.minLevel = options.minLevel ?? 0;
		this.maxLevel = options.maxLevel ?? 15;
		this.tilingScheme = options.tilingScheme ?? 'EPSG:4326';
		this.tms = options.tms ?? true;
		this.token = options.token ?? '';
		this.assetId = options.assetId ?? 1;
		this.numberOfLevelZeroTilesX = options.numberOfLevelZeroTilesX ?? 2;
		this.numberOfLevelZeroTilesY = options.numberOfLevelZeroTilesY ?? 1;
		this.littleEndian = options.littleEndian ?? false;
		this.headers = options.headers ?? {};

		if (options.url) {
			this.url = options.url;
		}
		// URL 坐标即服务坐标（getTileCoordsForBounds 已按 tms/slippy 生成），不做基类翻转
		this.isTMS = false;
	}

	/**
	 * 初始化瓦片 URL：有 token 且未显式提供 url 时，调 Cesium ion API 解析
	 * asset 的真实瓦片端点（如 Cesium World Terrain assetId=1 的 endpoint 返回
	 * https://assets.ion.cesium.com/us-east-1/asset_depot/1/CesiumWorldTerrain/v1.2/）。
	 * TileLoader 的 quantized-mesh 分支在首次请求前调用（幂等，url 已设则跳过）。
	 * 解析失败抛错，由调用方回退平瓦片。
	 */
	public async init(): Promise<void> {
		if (this.url || !this.token) {
			return;
		}
		const resp = await fetch(
			`https://api.cesium.com/v1/assets/${this.assetId}/endpoint`,
			{ headers: { Authorization: `Bearer ${this.token}` } }
		);
		if (!resp.ok) {
			throw new Error(`Cesium ion endpoint request failed: ${resp.status}`);
		}
		const meta = (await resp.json()) as { url?: string };
		const base = (meta.url || '').replace(/\/+$/, '');
		if (!base) {
			throw new Error(`Cesium ion endpoint returned no url for asset ${this.assetId}`);
		}
		this.url = `${base}/{z}/{x}/{y}.terrain?v=1`;
	}

	/**
	 * 获取请求头。
	 * 返回外部配置的 headers（如 quantized-mesh 服务要求的 Accept 协商头），
	 * 并叠加 Cesium ion 的 Authorization: Bearer <token>（有 token 时）。
	 * TileLoader 的 quantized-mesh 分支在 fetch 时调用。
	 * 注意：Referer/Origin 是浏览器 forbidden header，无法在此设置，
	 * 需由部署层（如 vite proxy 改写上游头）处理。
	 */
	public getRequestHeaders(): Record<string, string> {
		const headers: Record<string, string> = { ...this.headers };
		if (this.token) {
			headers['Authorization'] = `Bearer ${this.token}`;
		}
		return headers;
	}

	/**
	 * 定位覆盖指定经纬度范围（本地瓦片）的所有服务瓦片。
	 * 返回的服务瓦片坐标可直接用于 getUrl；lonLatBounds 供解码器插值顶点经纬度。
	 * 服务瓦片通常小于本地 3857 瓦片（4326 等经纬度网格在纬向覆盖更大），
	 * 故可能返回多块；调用方需合并解码后的 TIN。
	 *
	 * @param lonLatBounds - 本地瓦片经纬度边界 [west, south, east, north]
	 * @param x - 本地瓦片 X（3857 slippy 网格坐标，用于同网格源直接推导）
	 * @param y - 本地瓦片 Y
	 * @param z - 本地瓦片层级
	 * @returns 服务瓦片坐标 + 经纬度边界数组
	 */
	public getTileCoordsForBounds(
		lonLatBounds: [number, number, number, number],
		x: number,
		y: number,
		z: number
	): QuantizedMeshTileCoords[] {
		const [west, south, east, north] = lonLatBounds;

		// 服务层级：使单个服务瓦片经度跨度 ≈ 本地瓦片经度跨度（360/2^z）。
		// 服务经度跨度 = 360 / (2^zz × numberOfLevelZeroTilesX)，故 zz ≈ z - log2(rootX)。
		const zz = Math.min(
			Math.max(z - Math.log2(this.numberOfLevelZeroTilesX), this.minLevel),
			this.maxLevel
		);

		if (this.tilingScheme === 'EPSG:4326') {
			const nX = Math.pow(2, zz) * this.numberOfLevelZeroTilesX;
			const nY = Math.pow(2, zz) * this.numberOfLevelZeroTilesY;
			// 覆盖本地瓦片经纬度范围的完整服务瓦片行列区间。
			// 用 -1e-9 处理开区间：east/south 正好落在瓦片边界时归到前一块。
			const x0 = Math.min(nX - 1, Math.max(0, Math.floor(((west + 180) / 360) * nX)));
			const x1 = Math.min(nX - 1, Math.max(0, Math.floor(((east + 180) / 360) * nX - 1e-9)));
			const y0 = Math.min(nY - 1, Math.max(0, Math.floor(((90 - north) / 180) * nY)));
			const y1 = Math.min(nY - 1, Math.max(0, Math.floor(((90 - south) / 180) * nY - 1e-9)));
			const lonSpan = 360 / nX;
			const latSpan = 180 / nY;
			const list: QuantizedMeshTileCoords[] = [];
			for (let ty = y0; ty <= y1; ty++) {
				for (let tx = x0; tx <= x1; tx++) {
					// tms：y 计数从北向下；slippy：y 计数翻转
					const ySrv = this.tms ? ty : nY - 1 - ty;
					const westS = -180 + tx * lonSpan;
					const northS = 90 - ty * latSpan;
					list.push({
						x: tx,
						y: ySrv,
						z: zz,
						lonLatBounds: [westS, northS - latSpan, westS + lonSpan, northS],
					});
				}
			}
			return list;
		}

		// EPSG:3857 slippy：与本地瓦片同网格（rootX=1），直接推导祖先/同层瓦片坐标
		const n = Math.pow(2, zz);
		const dl = z - zz;
		const sx = dl > 0 ? x >> dl : x;
		const sy = dl > 0 ? y >> dl : y;
		// 服务瓦片经纬度边界（3857 瓦片）
		const worldSize = Math.PI * 6378137;
		const tileSize = (2 * worldSize) / n;
		const minX = -worldSize + sx * tileSize;
		const minY = worldSize - (sy + 1) * tileSize;
		const maxX = minX + tileSize;
		const maxY = worldSize - sy * tileSize;
		const yToLat = (wy: number) =>
			((2 * Math.atan(Math.exp(wy / 6378137)) - Math.PI / 2) * 180) / Math.PI;
		return [
			{
				x: sx,
				y: sy,
				z: zz,
				lonLatBounds: [
					(minX / worldSize) * 180,
					yToLat(minY),
					(maxX / worldSize) * 180,
					yToLat(maxY),
				],
			},
		];
	}
}
