/**
 * @description: GeoJSON 覆盖层加载器
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile geojsonLoader：
 * - extends TileMaterialLoader，用 geojson-vt 将 GeoJSON 按瓦片坐标裁剪，
 *   经 lib VectorTileRender 绘制 Canvas 生成瓦片纹理。
 * - dataType='geojson'（矢量**覆盖层**，非底图；mvt 矢量底图已归 lib 核心）。
 */

import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import geojsonvt from 'geojson-vt';

import {
	TileLoadClipParamsType,
	TileMaterialLoader,
	VectorFeature,
	VectorFeatureTypes,
	VectorStyle,
	VectorTileRender,
} from '@babylon-tile/lib';
import { GeoJSONSource } from './GeoJSONSource.js';

/**
 * GeoJSON 覆盖层加载器
 */
export class GeoJSONLoader extends TileMaterialLoader {
	/** 加载器信息 */
	public info = {
		version: '1.0.0',
		author: 'Babylon-Tile Team',
		description: 'GeoJSON 加载器',
	};

	/** 数据类型标识 */
	public readonly dataType = 'geojson';

	/** 瓦片渲染器 */
	private readonly _render = new VectorTileRender();

	/** 空纹理缓存（按场景，避免跨场景绑定错误） */
	private readonly _emptyTextureCache = new WeakMap<Scene, DynamicTexture>();

	/**
	 * 异步加载瓦片纹理
	 * @param url GeoJSON 的 URL 地址
	 * @param params 加载参数，包括数据源、瓦片坐标等
	 * @returns 瓦片纹理
	 */
	protected async doLoad(
		url: string,
		params: TileLoadClipParamsType<GeoJSONSource>
	): Promise<Texture | undefined> {
		const { x, y, z, source, scene } = params;
		if (!scene) return undefined;

		// 判断数据是否加载完成，如果已完成则直接绘制瓦片纹理
		if (source.gv) {
			return this._getTileTexture(source.gv, x, y, z, source.style, scene);
		}

		// 判断是否正在加载数据，如果不是则加载数据并绘制瓦片纹理
		if (!source.loading) {
			source.loading = true;
			source.gv = await this.loadJSON(url);
			source.loading = false;
		}

		// 等待数据加载完成
		await this._waitFor(() => !!source.gv);
		if (!source.gv) return undefined;

		// 加载完成后绘制瓦片纹理
		return this._getTileTexture(source.gv, x, y, z, source.style, scene);
	}

	/**
	 * 异步加载 JSON 文件，创建 geojson-vt 实例返回。
	 * @param url JSON 文件的 URL 地址
	 * @returns 返回 geojsonvt 实例
	 */
	protected async loadJSON(url: string): Promise<any> {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`GeoJSON fetch failed: ${response.status}`);
		}
		const json = await response.json();
		const gv = geojsonvt(json, {
			tolerance: 2,
			extent: 256,
			maxZoom: 20,
			indexMaxZoom: 4,
		});
		return gv;
	}

	/**
	 * 绘制瓦片
	 */
	private drawTile(tile: any, style?: VectorStyle): HTMLCanvasElement {
		const width = 256;
		const height = 256;
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (ctx) {
			ctx.save();
			const features = tile.features;
			for (let i = 0; i < features.length; i++) {
				this._renderFeature(ctx, features[i], style);
			}
			ctx.restore();
		}
		return canvas;
	}

	/**
	 * 渲染单个要素
	 */
	private _renderFeature(
		ctx: CanvasRenderingContext2D,
		feature: any,
		style: VectorStyle = {}
	): void {
		const type = [
			VectorFeatureTypes.Unknown,
			VectorFeatureTypes.Point,
			VectorFeatureTypes.Linestring,
			VectorFeatureTypes.Polygon,
		][feature.type];

		const renderFeature: VectorFeature = {
			geometry: [],
			properties: {},
		};

		for (let i = 0; i < feature.geometry.length; i++) {
			let points;
			if (!Array.isArray(feature.geometry[i][0])) {
				points = [{ x: feature.geometry[i][0], y: feature.geometry[i][1] }];
			} else {
				points = feature.geometry[i].map((p: any) => {
					return { x: p[0], y: p[1] };
				});
			}
			renderFeature.geometry.push(points);
		}
		renderFeature.properties = feature.tags;

		this._render.render(ctx, type, renderFeature, style);
	}

	/**
	 * 根据给定的坐标和样式绘制瓦片纹理
	 * @param gv 地图视图对象（geojson-vt 索引）
	 * @param x 瓦片 x 坐标
	 * @param y 瓦片 y 坐标
	 * @param z 瓦片层级
	 * @param style GeoJSON 样式
	 * @param scene Babylon 场景
	 * @returns 瓦片纹理；瓦片不存在时返回空纹理
	 */
	private _getTileTexture(
		gv: any,
		x: number,
		y: number,
		z: number,
		style: VectorStyle,
		scene: Scene
	): Texture {
		// 读取 xyz 坐标的瓦片数据
		const tile = gv.getTile(z, x, y);
		// 读取失败或不显示返回空纹理
		if (!tile) {
			return this._getEmptyTexture(scene);
		}
		// 绘制瓦片
		const img = this.drawTile(tile, style);
		// 创建纹理对象并返回
		const texture = new DynamicTexture(`geojson-${z}-${x}-${y}`, img, scene, false);
		texture.hasAlpha = true;
		texture.update();
		return texture;
	}

	/**
	 * 创建/获取 1×1 透明空纹理
	 */
	private _getEmptyTexture(scene: Scene): DynamicTexture {
		let texture = this._emptyTextureCache.get(scene);
		if (!texture) {
			texture = new DynamicTexture('geojson-empty', 1, scene, false);
			const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
			ctx.clearRect(0, 0, 1, 1);
			texture.update();
			texture.hasAlpha = true;
			this._emptyTextureCache.set(scene, texture);
		}
		return texture;
	}

	/**
	 * 等待条件满足
	 */
	private _waitFor(condition: () => boolean, timeout = 30000): Promise<void> {
		return new Promise((resolve, reject) => {
			const start = Date.now();
			const check = () => {
				if (condition()) {
					resolve();
				} else if (Date.now() - start > timeout) {
					reject(new Error('GeoJSON load wait timeout'));
				} else {
					setTimeout(check, 16);
				}
			};
			check();
		});
	}
}
