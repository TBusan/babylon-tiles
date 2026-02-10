/**
 * @description: 动态 LOD 瓦片类
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { TransformNode as BabylonTransformNode } from '@babylonjs/core/Meshes/transformNode';
import { BoundingBox } from '@babylonjs/core';
import { Vector3 as BabylonVector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';

import type { ITileLoader } from '../loader/ITileLoader.js';
import { createChildTiles, evaluateLOD, getTileProjBounds, LODAction } from './util.js';
import type { IProjection } from '../projection/IProjection.js';

/** 最大下载线程数 */
const MAXTHREADS = 10;

/**
 * 瓦片事件类型
 */
export interface TileEventMap {
	/** 瓦片创建事件 */
	'tile-created': { tile: Tile };
	/** 瓦片加载完成事件 */
	'tile-loaded': { tile: Tile };
	/** 瓦片卸载事件 */
	'tile-unload': { tile: Tile };
	/** 瓦片可见状态改变事件 */
	'tile-visible-changed': { tile: Tile; visible: boolean };
}

/**
 * 瓦片更新参数
 */
export interface TileUpdateParams {
	/** 相机 */
	camera: Camera;
	/** 瓦片加载器 */
	loader: ITileLoader;
	/** 最小层级 */
	minLevel: number;
	/** 最大层级 */
	maxLevel: number;
	/** 瓦片 LOD 阈值 */
	LODThreshold: number;
	/** 投影对象 */
	projection: IProjection;
}

/**
 * 动态 LOD（DLOD）地图瓦片类
 * 用于表示地图中的一块瓦片，瓦片可以包含子瓦片，以四叉树方式管理
 */
export class Tile extends BabylonTransformNode {
	/** 瓦片 X 坐标 */
	public readonly x: number;

	/** 瓦片 Y 坐标 */
	public readonly y: number;

	/** 瓦片层级 */
	public readonly z: number;

	/** 是否为瓦片 */
	public readonly isTile = true;

	/** 瓦片是否正在加载中 */
	private _isLoading = false;

	/** 根瓦片 */
	private _root: Tile = this;

	/** 瓦片距离检测点世界坐标 */
	private _tileCheckPoint: BabylonVector3;

	/** 瓦片在世界坐标系中的大小 */
	private _sizeInWorld = -1;

	/** 瓦片包围盒（世界坐标） */
	private _bbox: BoundingBox | null = null;

	/** 瓦片模型 */
	private _model: Mesh | undefined;

	/** 子瓦片 */
	private _subTiles: Tile[] | undefined;

	/** 事件观察者映射 */
	private _eventObservers: Map<keyof TileEventMap, Array<(data: any) => void>> = new Map();

	/** 是否更新材质 */
	private _needsMaterialUpdate = false;

	/** 是否更新几何体 */
	private _needsGeometryUpdate = false;

	/**
	 * 构造函数
	 * @param x - 瓦片 X 坐标
	 * @param y - 瓦片 Y 坐标
	 * @param z - 瓦片层级
	 * @param scene - 场景
	 */
	public constructor(x = 0, y = 0, z = 0, scene?: Scene) {
		super(`Tile ${z}-${x}-${y}`, scene);
		this.x = x;
		this.y = y;
		this.z = z;

		// 初始化检测点
		this._tileCheckPoint = new BabylonVector3();
	}

	/**
	 * 获取瓦片模型
	 */
	public get model(): Mesh | undefined {
		return this._model;
	}

	/**
	 * 获取子瓦片
	 */
	public get subTiles(): Tile[] | undefined {
		return this._subTiles;
	}

	/**
	 * 获取瓦片是否在视锥体内
	 */
	public get inFrustum(): boolean {
		return this._bbox !== null;
	}

	/**
	 * 获取是否为叶子瓦片
	 */
	public get isLeaf(): boolean {
		return !this._subTiles || this._subTiles.length === 0;
	}

	/**
	 * 获取瓦片是否显示
	 */
	public get showing(): boolean {
		return this._model ? this._model.isEnabled() : false;
	}

	/**
	 * 设置瓦片是否显示
	 */
	public set showing(value: boolean) {
		if (this._model) {
			this._model.setEnabled(value);

			// 触发可见性改变事件
			this._dispatchEvent('tile-visible-changed', { tile: this, visible: value });
		}
	}

	/**
	 * 计算瓦片大小、包围盒等
	 */
	private computeTileSize(projection: IProjection): number {
		// 获取瓦片的投影边界
		const bounds = getTileProjBounds(this.x, this.y, this.z, projection);

		// 计算瓦片在本地坐标系中的范围（归一化到 0-1）
		const min = new BabylonVector3(-0.5, -0.5, 0);
		const max = new BabylonVector3(0.5, 0.5, 0);

		// 应用世界变换矩阵
		const worldMin = BabylonVector3.TransformCoordinates(min, this.getWorldMatrix());
		const worldMax = BabylonVector3.TransformCoordinates(max, this.getWorldMatrix());

		// 创建包围盒
		this._bbox = new BoundingBox(worldMin, worldMax);

		// 距离检测点（瓦片中心世界坐标）
		this._tileCheckPoint = BabylonVector3.TransformCoordinates(new BabylonVector3(0, 0, 0), this.getWorldMatrix());

		// 瓦片大小（对角线长度）
		this._sizeInWorld = BabylonVector3.Distance(worldMin, worldMax);

		return this._sizeInWorld;
	}

	/**
	 * 瓦片更新，该函数在每帧渲染中被调用
	 * @param params 瓦片更新参数
	 */
	public update(params: TileUpdateParams): void {
		// 没有父节点或正在加载时不进行更新
		if (!this.parent || this._isLoading) {
			return;
		}

		// 设置根瓦片
		if (this.parent instanceof Tile) {
			this._root = this.parent._root;
		}

		const { loader, minLevel, LODThreshold, projection } = params;

		// 如果是根瓦片，计算视锥体（简化处理）
		if (this.z === 0) {
			// 这里可以在实际实现中添加视锥体计算
		}

		// 计算瓦片大小、包围盒等
		if (this._sizeInWorld < 0) {
			this.computeTileSize(projection);
		}

		// 如果当前层级 >= 最小层级 且 下载线程数 < 最大下载线程数
		if (this.z >= minLevel && loader.downloadingThreads < MAXTHREADS) {
			// 下载瓦片
			if (!this._model) {
				this._startLoad(loader);
				return;
			}

			// 更新脏瓦片
			if (this._tileIsDirty && this.inFrustum) {
				const childrenUpdated = !this._subTiles?.some(child => child._tileIsDirty);
				if (childrenUpdated) {
					this._startUpdate(loader);
					return;
				}
			}
		}

		// LOD
		this.LOD(params);

		// 递归更新子瓦片
		this._subTiles?.forEach(child => child.update(params));
	}

	/**
	 * LOD (Level of Detail)
	 * @param params 瓦片更新参数
	 */
	protected LOD(params: TileUpdateParams): LODAction {
		const { loader, minLevel, maxLevel, LODThreshold, camera } = params;

		// 计算距离比例
		const distToCamera = BabylonVector3.Distance(camera.globalPosition, this._tileCheckPoint);
		const distRatio = this.inFrustum ? (distToCamera / this._sizeInWorld) * 0.8 : (distToCamera / this._sizeInWorld) * 2;

		// LOD 评估
		const action = evaluateLOD(distRatio, minLevel, maxLevel, this.z, this.inFrustum, LODThreshold);

		if (action === LODAction.CREATE) {
			// 创建子瓦片
			const childCoords = createChildTiles(this.x, this.y, this.z);
			const newTiles = childCoords.map(([x, y, z]) => new Tile(x, y, z, this.getScene()));

			this._subTiles = newTiles;

			// 设置子瓦片的位置和缩放
			newTiles.forEach(child => {
				child.position.set((child.x / 2 - 0.5) * 2, (child.y / 2 - 0.5) * 2, 0);
				child.scaling.set(0.5, 0.5, 1);
				child.computeWorldMatrix(true);
				child.parent = this;
			});

			// 触发事件
			newTiles.forEach(child => this._dispatchEvent('tile-created', { tile: child }));
		} else if (action === LODAction.REMOVE) {
			// 删除子瓦片
			if (this._model) {
				this.showing = true;
				this.unLoad(loader, false);
			}
		}

		return action;
	}

	/**
	 * 检查 4 个兄弟瓦片是否全部下载完成
	 */
	private _checkVisible(): Tile {
		const parent = this.parent;
		if (parent instanceof Tile) {
			if (parent._model) {
				const subTiles = parent._subTiles;
				if (subTiles) {
					const allLoaded = !subTiles.some(child => !child._model);
					subTiles.forEach(child => (child.showing = allLoaded));
					parent.showing = !allLoaded;
				}
			} else {
				this.showing = true;
			}
		}
		return this;
	}

	/**
	 * 下载瓦片数据
	 * @param loader - 瓦片加载器
	 */
	private async _startLoad(loader: ITileLoader): Promise<void> {
		this._isLoading = true;

		try {
			this._model = await loader.load(this);

			if (this._model) {
				// 计算包围盒
				this._model.refreshBoundingInfo(true, true);
				const bbox = this._model.getBoundingInfo().boundingBox;
				this._tileCheckPoint.y = bbox.maximumWorld.y;

				if (this.isLeaf) {
					this._checkVisible();
				}

				// 添加到场景
				this._model.parent = this;

				// 触发事件
				this._dispatchEvent('tile-loaded', { tile: this });
			}
		} catch (error) {
			console.error(`Failed to load tile ${this.name}:`, error);
		} finally {
			this._isLoading = false;
		}
	}

	/**
	 * 更新瓦片数据
	 * @param loader - 瓦片加载器
	 */
	private async _startUpdate(loader: ITileLoader): Promise<void> {
		if (!this._model) {
			return;
		}

		this._isLoading = true;

		try {
			this._model = await loader.update(this._model, this, this._needsMaterialUpdate, this._needsGeometryUpdate);

			if (this._model) {
				this._model.refreshBoundingInfo(true, true);
				const bbox = this._model.getBoundingInfo().boundingBox;
				this._tileCheckPoint.y = bbox.maximumWorld.y;

				this._needsMaterialUpdate = false;
				this._needsGeometryUpdate = false;

				// 触发事件
				this._dispatchEvent('tile-loaded', { tile: this });
			}
		} catch (error) {
			console.error(`Failed to update tile ${this.name}:`, error);
		} finally {
			this._isLoading = false;
		}
	}

	/**
	 * 获取是否需要更新
	 */
	private get _tileIsDirty(): boolean {
		return !!this._model && (this._needsMaterialUpdate || this._needsGeometryUpdate);
	}

	/**
	 * 更新瓦片数据
	 * @param updateMaterial - 是否更新材质
	 * @param updateGeometry - 是否更新几何体
	 */
	public updateData(updateMaterial: boolean, updateGeometry: boolean): void {
		this.getChildren().forEach(child => {
			if (child instanceof Tile && (child._model || child._isLoading)) {
				child._needsMaterialUpdate = updateMaterial;
				child._needsGeometryUpdate = updateGeometry;
			}
		});
	}

	/**
	 * 重新加载瓦片树
	 * @param loader - 瓦片加载器
	 */
	public reload(loader: ITileLoader): void {
		this.unLoad(loader, true);
	}

	/**
	 * 卸载瓦片（包括其子瓦片），释放资源
	 * @param loader - 瓦片加载器
	 * @param unLoadSelf - 是否卸载自身
	 */
	public unLoad(loader: ITileLoader, unLoadSelf = true): void {
		// 卸载子瓦片
		if (this._subTiles) {
			this._subTiles.forEach(child => {
				child.unLoad(loader, true);
			});
			// 移除子节点
			this._subTiles = undefined;
		}

		// 卸载自己
		if (unLoadSelf && this._model) {
			loader.unload(this._model);
			this._dispatchEvent('tile-unload', { tile: this });
			this._model = undefined;
		}
	}

	/**
	 * 添加事件监听
	 */
	public addEventListener<K extends keyof TileEventMap>(
		event: K,
		callback: (event: TileEventMap[K]) => void
	): void {
		if (!this._eventObservers.has(event)) {
			this._eventObservers.set(event, []);
		}
		this._eventObservers.get(event)?.push(callback);
	}

	/**
	 * 移除事件监听
	 */
	public removeEventListener<K extends keyof TileEventMap>(
		event: K,
		callback: (event: TileEventMap[K]) => void
	): void {
		const observers = this._eventObservers.get(event);
		if (observers) {
			const index = observers.findIndex(cb => cb === callback);
			if (index >= 0) {
				observers.splice(index, 1);
			}
		}
	}

	/**
	 * 触发事件
	 */
	private _dispatchEvent<K extends keyof TileEventMap>(event: K, data: TileEventMap[K]): void {
		const observers = this._eventObservers.get(event);
		if (observers) {
			observers.forEach(cb => {
				try {
					cb(data);
				} catch (error) {
					console.error(`Error in event handler for ${event}:`, error);
				}
			});
		}
	}
}
