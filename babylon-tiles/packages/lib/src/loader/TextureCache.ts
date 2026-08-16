/**
 * @description: 瓦片纹理缓存（按 URL LRU 复用，消除旋转/缩放 churn 时的重复下载与 GPU 上传）
 * @author: Babylon-Tile Team
 * @date: 2026-08-03
 */

import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';

/** 缓存的最大纹理数（LRU 逐出最久未使用的条目） */
const DEFAULT_MAX_ENTRIES = 512;

/**
 * 瓦片纹理缓存
 *
 * 瓦片被 LOD REMOVE 卸载后会释放材质与纹理；当相机旋转/缩放使同一瓦片重新
 * CREATE 时，若纹理仍在缓存中则直接复用，避免重新网络下载 + 解码 + GPU 上传。
 * 深缩放（z=18）旋转时视锥扫过新区域、瓦片反复进出视锥产生的加载风暴是
 * 帧率骤降的主因，缓存直接消除了重复下载。
 *
 * 缓存持有「引用计数」语义：
 * - 每个瓦片通过 _loadTexture 拿到纹理时调用 retain()（缓存命中或下载成功）；
 * - 瓦片卸载/被裁剪替换时调用 release()；
 * - release() 后若引用计数归零且纹理已不在缓存中（被 LRU 逐出），则立即 dispose，
 *   避免 GPU 纹理泄漏；
 * - 仍被缓存持有的纹理（引用计数归零但未逐出）不 dispose，留待其他瓦片复用。
 * LRU 逐出时仅移除引用：若此刻已无持有者则 dispose，否则留待最后一次 release()
 * 时 dispose（此时该纹理已不在缓存中）。
 */
export class TextureCacheImpl {
	private _map = new Map<string, Texture>();
	private _order: string[] = [];
	private _refs = new Map<BaseTexture, number>();
	/** 纹理→URL 反向映射，使 _isInCache 从 O(n) 降为 O(1) */
	private _urlOf = new Map<BaseTexture, string>();
	private _maxEntries: number;

	constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
		this._maxEntries = maxEntries;
	}

	/** 获取缓存中的纹理（命中时提升 LRU 优先级；不改变引用计数） */
	public get(url: string): Texture | undefined {
		const tex = this._map.get(url);
		if (tex) {
			const idx = this._order.indexOf(url);
			if (idx >= 0) {
				this._order.splice(idx, 1);
				this._order.push(url);
			}
		}
		return tex;
	}

	/** 存入纹理；超过上限时 LRU 逐出（无持有者的纹理直接 dispose） */
	public put(url: string, texture: Texture): void {
		if (!this._map.has(url)) {
			this._order.push(url);
		} else {
			// 同 URL 替换新纹理时，旧纹理的映射失效
			const prev = this._map.get(url);
			if (prev && prev !== texture) {
				this._urlOf.delete(prev);
			}
		}
		this._map.set(url, texture);
		this._urlOf.set(texture, url);
		while (this._order.length > this._maxEntries) {
			const evictedUrl = this._order.shift();
			if (evictedUrl !== undefined) {
				const tex = this._map.get(evictedUrl);
				this._map.delete(evictedUrl);
				if (tex !== undefined) {
					this._urlOf.delete(tex);
					if ((this._refs.get(tex) ?? 0) <= 0) {
						this._refs.delete(tex);
						tex.dispose();
					}
				}
			}
		}
	}

	/** 一个瓦片开始持有该纹理（缓存命中或下载成功时调用） */
	public retain(texture: BaseTexture): void {
		this._refs.set(texture, (this._refs.get(texture) ?? 0) + 1);
	}

	/**
	 * 一个瓦片释放该纹理。
	 * 引用计数归零且纹理已不在缓存中（被逐出/从未缓存）时立即 dispose。
	 */
	public release(texture: BaseTexture): void {
		// 无引用记录：防止重复 release 导致 dispose 两次
		if (!this._refs.has(texture)) {
			return;
		}
		const n = (this._refs.get(texture) ?? 0) - 1;
		if (n <= 0) {
			this._refs.delete(texture);
			if (!this._isInCache(texture)) {
				texture.dispose();
			}
		} else {
			this._refs.set(texture, n);
		}
	}

	private _isInCache(texture: BaseTexture): boolean {
		return this._urlOf.has(texture);
	}

	/** 缓存条目数 */
	public get size(): number {
		return this._map.size;
	}

	/** 清空缓存；默认 dispose 剩余纹理（地图销毁时调用） */
	public clear(disposeTextures = true): void {
		if (disposeTextures) {
			for (const tex of this._map.values()) {
				tex.dispose();
			}
		}
		this._map.clear();
		this._order.length = 0;
		this._refs.clear();
		this._urlOf.clear();
	}
}

/** 全局共享实例（兼容层：未传入 cache 的插件 loader 回退使用） */
export const TextureCache = new TextureCacheImpl();

/** Engine 作用域缓存表：随引擎 GC 自动回收，无需手动 clear */
const cachesByEngine = new WeakMap<AbstractEngine, TextureCacheImpl>();

/**
 * 获取 Engine 对应的纹理缓存（懒创建）。
 * 多地图（同场景多图 / 多引擎）按 Engine 共享：同一引擎内销毁一张地图不会清空
 * 其他地图仍在使用的纹理，纹理随引擎释放而回收。
 */
export function getCacheForEngine(engine: AbstractEngine): TextureCacheImpl {
	let cache = cachesByEngine.get(engine);
	if (!cache) {
		cache = new TextureCacheImpl();
		cachesByEngine.set(engine, cache);
	}
	return cache;
}

/** 创建独立缓存实例（裸瓦片 / 单测用，不进入 Engine 共享表） */
export function createTextureCache(maxEntries?: number): TextureCacheImpl {
	return new TextureCacheImpl(maxEntries);
}
