/**
 * @description: 地图上下文（每 TileMap 一个实例）
 * 集中承载地图级共享状态，消除原模块级可变单例（cameraWorldPosition/frustum/
 * activeFades/全局纹理缓存/全局 Worker 池）造成的多地图串扰：
 * - A 图的相机/视锥不再污染 B 图的 LOD 判定与视锥裁剪；
 * - 淡入状态、纹理缓存、材质引用计数按地图/Engine 作用域隔离。
 * @author: Babylon-Tile Team
 * @date: 2026-08-08
 */

import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';

import { FrustumEx } from './FrustumEx.js';
import type { TextureCacheImpl } from '../loader/TextureCache.js';
import { createTextureCache, getCacheForEngine } from '../loader/TextureCache.js';
import { FadeController } from './TileFade.js';
import type { ITileLoader } from '../loader/ITileLoader.js';

/**
 * 地图上下文。
 *
 * 生命周期：
 * - TileMap 构造时创建，写入根瓦片 `rootTile._context`，并反引用 loader；
 * - TileMap.dispose 时由 fade.dispose() 取消进行中的淡入；纹理缓存为 Engine 作用域，
 *   不随单张地图销毁（同引擎其他地图继续复用）。
 *
 * 访问约定：瓦片统一经 `this._root._context` 读取（沿用既有 _root 分发模式）；
 * 裸瓦片（测试/编辑器）无根上下文时由 Tile 回退内部默认实例。
 */
export class TileMapContext {
	/** 相机世界坐标（TileMap.update 每 tick 写入） */
	public readonly cameraWorldPosition = new Vector3();

	/** 场景视锥体（TileMap.update 每 tick 由 vpMatrix 计算） */
	public readonly frustum = new FrustumEx();

	/** 视图-投影合成矩阵（零分配复用，Babylon 行向量约定 V·P） */
	public readonly vpMatrix = new Matrix();

	/** 纹理缓存（Engine 作用域，由 getCacheForEngine 提供） */
	public readonly textureCache: TextureCacheImpl;

	/** 交叉淡入控制器（每地图独立，避免淡入状态跨地图共享） */
	public readonly fade: FadeController;

	/** 瓦片加载器反引用（Tile 释放资源时委托 releaseMesh，见 ITileLoader.releaseMesh） */
	public loader?: ITileLoader;

	constructor(textureCache: TextureCacheImpl) {
		this.textureCache = textureCache;
		this.fade = new FadeController();
	}

	/** 为 Engine 创建地图上下文（纹理缓存按 Engine 作用域共享，同引擎多图复用） */
	public static createForEngine(engine: AbstractEngine): TileMapContext {
		return new TileMapContext(getCacheForEngine(engine));
	}

	/** 创建独立默认上下文（裸瓦片/单测用，缓存不进入 Engine 共享表） */
	public static createDefault(): TileMapContext {
		return new TileMapContext(createTextureCache());
	}
}
