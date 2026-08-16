/**
 * @description: 内置材质加载器（影像 image + 矢量底图 mvt）
 * @author: Babylon-Tile Team
 *
 * 这两个 loader 是核心渲染能力（底图来源），经 LoaderFactory 注册后与插件 loader
 * 走同一分发路径（TileLoader.loadMaterial → getMaterialLoader(source.dataType)）。
 *
 * 设计约定：
 * - 无状态单例：不绑定具体 Scene，scene 从 load(params).scene 取（Babylon 材质必须
 *   绑定场景，three.js 材质与场景无关——这是两者架构差异，见 ITileLoaders.ts）。
 * - worldScale 等瓦片尺寸派生自 params.bounds，不依赖 TileLoader 实例配置。
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Scene } from '@babylonjs/core/scene';

import type { ISource } from '../source/ISource.js';
import type { MVTStyleType } from '../source/MVTSource.js';
import type { ITileMaterialLoader, TileSourceLoadParamsType, ITileLoaderInfo } from './ITileLoaders.js';
import { TileMaterial } from '../material/TileMaterial.js';
import { VectorTileRender, VectorFeature, VectorFeatureTypes, VectorStyle } from '../material/VectorTileRender.js';
import { TextureCache, type TextureCacheImpl } from './TextureCache.js';

/**
 * 获取安全的瓦片 URL 和裁剪范围
 * 当请求级别 > 数据源 maxLevel 时，回退到最大级别瓦片并计算子区域裁剪坐标
 * @param source - 数据源
 * @param x - 瓦片 X 坐标
 * @param y - 瓦片 Y 坐标
 * @param z - 瓦片层级
 * @returns url 和 clipBounds [0-1 范围的裁剪区域]
 */
export function getSafeTileUrlAndBounds(
	source: ISource,
	x: number,
	y: number,
	z: number
): { url: string | undefined; clipBounds: [number, number, number, number] } {
	// 请求级别 < 最小级别，返回空
	if (z < source.minLevel) {
		return { url: undefined, clipBounds: [0, 0, 1, 1] };
	}

	// 请求级别 <= 最大级别，正常加载
	if (z <= source.maxLevel) {
		return { url: source.getUrl(x, y, z), clipBounds: [0, 0, 1, 1] };
	}

	// 超级别回退：从最大级别瓦片中截取子区域
	const dl = z - source.maxLevel;
	const parentX = x >> dl;
	const parentY = y >> dl;
	const parentZ = z - dl;
	const url = source.getUrl(parentX, parentY, parentZ);

	// 计算当前瓦片在父级瓦片中的相对位置（0-1 范围）
	const sep = Math.pow(2, dl);
	const size = 1 / sep;
	const offsetX = (x % sep) * size;
	const offsetY = (y % sep) * size;
	const clipBounds: [number, number, number, number] = [offsetX, offsetY, offsetX + size, offsetY + size];

	return { url, clipBounds };
}

/**
 * 检查瓦片是否需要边界裁剪（部分超出数据源 bounds）
 */
export function needsBoundsClip(source: ISource, tileBounds: [number, number, number, number]): boolean {
	if (!source._projectionBounds) return false;
	const mb = source._projectionBounds;
	// 瓦片完全在数据源范围内，无需裁剪
	return !(mb[0] <= tileBounds[0] && mb[1] <= tileBounds[1] && mb[2] >= tileBounds[2] && mb[3] >= tileBounds[3]);
}

/**
 * 影像瓦片材质加载器（核心底图能力）
 * 加载标准图像瓦片（PNG/JPG/WebP），支持超级别回退、数据源边界裁剪、
 * TextureCache 缓存复用。逻辑自 TileLoader.loadMaterial 单源部分提炼，行为保持一致。
 */
export class ImageTileMaterialLoader implements ITileMaterialLoader<StandardMaterial> {
	/** 标识为材质加载器 */
	public readonly isMaterialLoader = true;

	/** 加载器信息 */
	public readonly info: ITileLoaderInfo = {
		version: '1.0.0',
		author: 'Babylon-Tile Team',
		description: 'Standard tile image loader for PNG, JPG formats',
	};

	/** 数据类型标识 */
	public readonly dataType = 'image';

	/** 调试标志（>0 时输出加载告警） */
	public debug = 0;

	/**
	 * 加载影像瓦片材质
	 * @param params - 加载参数（含 source/coords/bounds/scene）
	 * @returns 瓦片材质；返回 undefined 表示该瓦片无此源材质（URL 缺失/纹理加载失败），
	 *          调用方跳过该源回退背景材质（与 three-tile 静默跳过语义一致）
	 */
	public async load(params: TileSourceLoadParamsType): Promise<StandardMaterial | undefined> {
		const { source, x, y, z, scene } = params;
		if (!scene) {
			throw new Error('ImageTileMaterialLoader: scene not provided in params');
		}

		// 纹理缓存：TileLoader 分发时按 Engine 作用域填充（getCacheForEngine）；插件直调时回退全局兼容层
		const cache = params.cache ?? TextureCache;

		// 获取安全的瓦片 URL 和裁剪范围（处理超级别回退）
		const { url, clipBounds } = getSafeTileUrlAndBounds(source, x, y, z);
		if (!url) {
			return undefined; // 无 URL：跳过该源（调用方已按 minLevel 过滤，此处为防御）
		}

		// 阻塞等待纹理下载完成（下载槽位由 TileLoader.load 统一预留）
		let texture = await this._loadTexture(url, scene, cache, { x, y, z });
		if (!texture) {
			return undefined; // 加载失败/超时：跳过该源，回退背景材质
		}

		// 如果需要裁剪（超级别回退或边界裁剪）
		const needsClip = clipBounds[0] !== 0 || clipBounds[1] !== 0 || clipBounds[2] !== 1 || clipBounds[3] !== 1;
		const needBoundClip = needsBoundsClip(source, params.bounds);

		if (needsClip || needBoundClip) {
			const clipped = await this._clipTexture(texture, url, clipBounds, source, params.bounds, scene);
			// 裁剪产物替换源纹理：本瓦片不再持有源纹理，交还缓存供其他瓦片复用
			if (clipped !== texture) {
				cache.release(texture);
				texture = clipped;
			}
		}

		// 创建材质
		return TileMaterial.createTileMaterial({
			scene,
			name: `tile-${z}-${x}-${y}-material`,
			diffuseTexture: texture,
			opacity: source.opacity ?? 1,
			transparent: source.transparent ?? (needsClip || needBoundClip),
		});
	}

	/**
	 * 卸载材质（释放纹理与材质）
	 */
	public unload(material: StandardMaterial): void {
		if (material.diffuseTexture) {
			material.diffuseTexture.dispose();
		}
		material.dispose();
	}

	/**
	 * 加载纹理（Promise 包装，阻塞等待完成）
	 * 使用 settled 标志确保只结算一次（超时/成功/失败仅其一）
	 * 失败/超时时 resolve(undefined)：让该影像源被跳过，瓦片回退到背景材质
	 * @param url - 纹理 URL
	 * @param scene - Babylon 场景
	 * @param coords - 瓦片坐标（用于调试）
	 * @returns Promise<Texture | undefined>
	 */
	private _loadTexture(
		url: string,
		scene: Scene,
		cache: TextureCacheImpl,
		coords: { x: number; y: number; z: number }
	): Promise<Texture | undefined> {
		// 命中缓存：直接复用已上传 GPU 的纹理，跳过网络下载 + 解码 + 上传
		const cached = cache.get(url);
		if (cached) {
			cache.retain(cached);
			return Promise.resolve(cached);
		}

		return new Promise<Texture | undefined>((resolve) => {
			let settled = false;
			let texture: Texture | undefined;

			const fail = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				if (texture) {
					texture.dispose();
				}
				resolve(undefined);
			};

			const succeed = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				if (texture) {
					cache.put(url, texture);
					cache.retain(texture);
				}
				resolve(texture);
			};

			// 安全超时：防止纹理加载永不完成导致 _isLoading 卡死
			const timeout = setTimeout(() => {
				if (this.debug > 0) {
					console.warn(`Texture load timeout for tile ${coords.z}-${coords.x}-${coords.y}`);
				}
				fail();
			}, 15000);

			try {
				texture = new Texture(
					url,
					scene,
					true, // noMipmap
					undefined, // invertY
					Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
					succeed,
					(_message?: string, _exception?: any) => {
						if (this.debug > 0) {
							console.error(`Texture load error for tile ${coords.z}-${coords.x}-${coords.y}:`, _message);
						}
						fail();
					}
				);
			} catch {
				fail();
			}
		});
	}

	/**
	 * 裁剪纹理：支持超级别子区域截取 + 数据源边界裁剪
	 * 通过 Canvas 2D 操作实现图像裁剪
	 */
	private async _clipTexture(
		texture: Texture,
		url: string,
		clipBounds: [number, number, number, number],
		source: ISource,
		tileBounds: [number, number, number, number],
		scene: Scene
	): Promise<Texture> {
		try {
			// 加载原始图像
			const image = await this._loadImageElement(url);
			const size = image.width;

			// 创建 Canvas 进行裁剪
			const canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			const ctx = canvas.getContext('2d');
			if (!ctx) return texture;

			// 超级别裁剪：从父瓦片中截取子区域
			const needsSubClip = clipBounds[0] !== 0 || clipBounds[1] !== 0 || clipBounds[2] !== 1 || clipBounds[3] !== 1;

			if (needsSubClip) {
				const sx = Math.floor(clipBounds[0] * size);
				const sy = Math.floor(clipBounds[1] * size);
				const sw = Math.floor((clipBounds[2] - clipBounds[0]) * size);
				const sh = Math.floor((clipBounds[3] - clipBounds[1]) * size);
				ctx.drawImage(image, sx, sy, sw, sh, 0, 0, size, size);
			} else {
				ctx.drawImage(image, 0, 0);
			}

			// 数据源边界裁剪：将超出部分设为透明
			if (needsBoundsClip(source, tileBounds) && source._projectionBounds) {
				const mb = source._projectionBounds;
				const [tileMinX, tileMinY, tileMaxX, tileMaxY] = tileBounds;

				// 计算交集
				const intersectMinX = Math.max(tileMinX, mb[0]);
				const intersectMaxX = Math.min(tileMaxX, mb[2]);
				const intersectMinY = Math.max(tileMinY, mb[1]);
				const intersectMaxY = Math.min(tileMaxY, mb[3]);

				if (intersectMinX < intersectMaxX && intersectMinY < intersectMaxY) {
					const tileW = tileMaxX - tileMinX;
					const tileH = tileMaxY - tileMinY;

					// 转换为像素坐标
					const x1 = ((intersectMinX - tileMinX) / tileW) * size;
					const x2 = ((intersectMaxX - tileMinX) / tileW) * size;
					// Y 轴翻转（图像坐标 Y 向下，投影坐标 Y 向上）
					const y1 = size - ((intersectMaxY - tileMinY) / tileH) * size;
					const y2 = size - ((intersectMinY - tileMinY) / tileH) * size;

					// 使用 destination-in 保留交集区域
					ctx.globalCompositeOperation = 'destination-in';
					ctx.beginPath();
					ctx.rect(x1, y1, x2 - x1, y2 - y1);
					ctx.fill();
				}
			}

			// 从 Canvas 创建新纹理
			const clippedTexture = new Texture(null, scene);
			clippedTexture.updateURL(canvas.toDataURL());

			// 原始纹理由 TextureCache 持有，供其他瓦片复用，不在此处释放
			return clippedTexture;
		} catch (error) {
			if (this.debug > 0) {
				console.warn('Texture clip failed, using original:', error);
			}
			return texture;
		}
	}

	/**
	 * 加载图像元素（用于 Canvas 裁剪操作），带安全超时
	 */
	private _loadImageElement(url: string): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			let settled = false;
			const settle = (fn: () => void) => {
				if (!settled) {
					settled = true;
					clearTimeout(timeout);
					fn();
				}
			};
			const timeout = setTimeout(() => {
				if (this.debug > 0) {
					console.warn(`Image load timeout for ${url}`);
				}
				settle(() => reject(new Error(`Image load timeout: ${url}`)));
			}, 15000);
			img.onload = () => settle(() => resolve(img));
			img.onerror = () => settle(() => reject(new Error(`Failed to load image: ${url}`)));
			img.src = url;
		});
	}
}

/**
 * MVT 矢量底图材质加载器（核心底图能力）
 * 解码 Mapbox Vector Tile（@mapbox/vector-tile + pbf，动态加载）→ 绘制到
 * DynamicTexture → 包材。与影像底图（ImageTileMaterialLoader）并列，同为核心。
 *
 * 解析依赖动态 import（沿用 LercTerrainLoader.ensureDecoder 先例）：
 * 主 bundle 不膨胀，首次使用 mvt 底图时才加载 vector-tile/pbf。
 */
export class MVTileMaterialLoader implements ITileMaterialLoader<StandardMaterial> {
	/** 标识为材质加载器 */
	public readonly isMaterialLoader = true;

	/** 加载器信息 */
	public readonly info: ITileLoaderInfo = {
		version: '1.0.0',
		author: 'Babylon-Tile Team',
		description: 'MVT (Mapbox Vector Tile) base-map loader',
	};

	/** 数据类型标识 */
	public readonly dataType = 'mvt';

	/** 矢量瓦片渲染器 */
	private readonly _render = new VectorTileRender();

	/** 解码器动态加载 Promise（避免并发重复 import） */
	private _decoderPromise: Promise<{ VectorTile: any; Pbf: any }> | null = null;

	/** 调试标志 */
	public debug = 0;

	/**
	 * 确保 mvt 解析库可用：动态 import @mapbox/vector-tile 与 pbf 并缓存。
	 */
	private _ensureDecoder(): Promise<{ VectorTile: any; Pbf: any }> {
		if (!this._decoderPromise) {
			this._decoderPromise = Promise.all([import('@mapbox/vector-tile'), import('pbf')])
				.then(([vtMod, pbfMod]) => {
					const vt = vtMod as any;
					const pbf = (pbfMod as any).default ?? (pbfMod as any);
					return {
						VectorTile: vt.VectorTile,
						Pbf: pbf,
					};
				})
				.catch((e) => {
					this._decoderPromise = null; // 允许重试
					throw new Error(`MVT decoder failed to load: ${e}`);
				});
		}
		return this._decoderPromise;
	}

	/**
	 * 加载 MVT 矢量底图材质
	 * @param params - 加载参数（含 source/coords/bounds/scene）
	 * @returns 瓦片材质；无 URL 时返回 undefined（跳过该源）
	 */
	public async load(params: TileSourceLoadParamsType): Promise<StandardMaterial | undefined> {
		const { source, x, y, z, scene } = params;
		if (!scene) {
			throw new Error('MVTileMaterialLoader: scene not provided in params');
		}

		// 超级别回退与 image 一致（z>maxLevel 取父瓦片）
		const { url } = getSafeTileUrlAndBounds(source, x, y, z);
		if (!url) {
			return undefined; // 无 URL：跳过该源
		}

		// 首次使用动态加载解析库
		const { VectorTile, Pbf } = await this._ensureDecoder();

		// 支持数据源自定义请求头（防盗链/Accept 协商等）
		const headers = (source as { headers?: Record<string, string> }).headers;
		const requestInit = headers && Object.keys(headers).length ? { headers } : undefined;

		const response = await fetch(url, requestInit);
		if (!response.ok) {
			throw new Error(`MVT fetch failed: ${response.status}`);
		}
		const buffer = await response.arrayBuffer();

		const vectorTile = new VectorTile(new Pbf(buffer));

		// 绘制矢量瓦片到 DynamicTexture（256×256，透明背景）
		const style = (source as { style?: MVTStyleType }).style;
		const texture = VectorTileRender.createTexture(scene, `tile-${z}-${x}-${y}-mvt`, 256, (ctx) =>
			this._drawTile(ctx as CanvasRenderingContext2D, vectorTile, style, z)
		);
		texture.hasAlpha = true;

		return TileMaterial.createTileMaterial({
			scene,
			name: `tile-${z}-${x}-${y}-material`,
			diffuseTexture: texture,
			opacity: source.opacity ?? 1,
			transparent: source.transparent ?? true,
		});
	}

	/**
	 * 卸载材质
	 */
	public unload(material: StandardMaterial): void {
		if (material.diffuseTexture) {
			material.diffuseTexture.dispose();
		}
		material.dispose();
	}

	// ─── 私有绘制方法（对齐 three-tile MVTLoader） ─────────────────────

	/**
	 * 在 Canvas 上下文绘制矢量瓦片所有图层
	 */
	private _drawTile(ctx: CanvasRenderingContext2D, vectorTile: any, style: MVTStyleType | undefined, z: number): void {
		const width = 256;

		if (style) {
			// 有 style 时，按样式表逐层绘制（带 minLevel/maxLevel 过滤）
			for (const layerName in style.layer) {
				const layerStyle = style.layer[layerName];
				if (z < (layerStyle.minLevel ?? 1) || z > (layerStyle.maxLevel ?? 20)) {
					continue;
				}
				const layer = vectorTile.layers[layerName];
				if (layer) {
					const scale = width / layer.extent;
					this._renderLayer(ctx, layer, layerStyle, scale);
				}
			}
		} else {
			// 无 style 时，遍历所有图层使用默认样式绘制
			for (const layerName in vectorTile.layers) {
				const layer = vectorTile.layers[layerName];
				const scale = width / layer.extent;
				this._renderLayer(ctx, layer, undefined, scale);
			}
		}
	}

	/**
	 * 绘制单个图层
	 */
	private _renderLayer(ctx: CanvasRenderingContext2D, layer: any, style?: VectorStyle, scale: number = 1): void {
		ctx.save();
		for (let i = 0; i < layer.length; i++) {
			const feature = layer.feature(i);
			this._renderFeature(ctx, feature, style, scale);
		}
		ctx.restore();
	}

	/**
	 * 绘制单个矢量要素
	 */
	private _renderFeature(
		ctx: CanvasRenderingContext2D,
		feature: any,
		style: VectorStyle = {},
		scale: number = 1
	): void {
		const type = [
			VectorFeatureTypes.Unknown,
			VectorFeatureTypes.Point,
			VectorFeatureTypes.Linestring,
			VectorFeatureTypes.Polygon,
		][feature.type];
		const renderFeature: VectorFeature = {
			geometry: feature.loadGeometry(),
			properties: feature.properties,
		};

		this._render.render(ctx, type, renderFeature, style, scale);
	}
}
