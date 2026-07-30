/**
 * @description: 瓦片地图类
 * Ported from three-tile's TileMap.ts for Babylon.js (Y-up coordinate system)
 * @author: Babylon-Tile Team
 * @date: 2025-07-25
 */

import type { Camera } from '@babylonjs/core/Cameras/camera';
import { TransformNode as BabylonTransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Vector3 as BabylonVector3 } from '@babylonjs/core/Maths/math.vector';
import type { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { Observable } from '@babylonjs/core/Misc/observable';
import { Ray } from '@babylonjs/core/Culling/ray';

import { Tile } from './Tile.js';
import { TileLoader } from '../loader/TileLoader.js';
import type { ITileLoader } from '../loader/ITileLoader.js';
import type { IProjection } from '../projection/IProjection.js';
import { ProjectionFactory } from '../projection/ProjectionFactory.js';
import type { ISource } from '../source/ISource.js';
import { TerrainWorkerPool } from '../loader/WorkerPool.js';

/**
 * 地面信息类型
 */
export interface LocationInfo {
	/** 点击点世界坐标 */
	point: Vector3;
	/** 地理坐标（经度、纬度、高度） */
	location: Vector3;
	/** 法向量 */
	normal: Vector3;
}

/**
 * 地图事件类型
 */
export interface TileMapEventMap {
	/** 准备就绪事件 */
	ready: {};
	/** 更新事件 */
	update: { delta: number };
	/** 投影改变事件 */
	'projection-changed': { projection: IProjection };
	/** 数据源改变事件 */
	'source-changed': { source: ISource | ISource[] };
	/** 瓦片创建事件 */
	'tile-created': { tile: Tile };
	/** 瓦片加载完成事件 */
	'tile-loaded': { tile: Tile };
	/** 瓦片卸载事件 */
	'tile-unload': { tile: Tile };
	/** 瓦片可见状态改变事件 */
	'tile-visible-changed': { tile: Tile; visible: boolean };
	/** 加载开始事件（从空闲状态进入加载状态） */
	'loading-start': {};
	/** 加载进度事件 */
	'loading-progress': { downloading: number; loaded: number };
	/** 加载完成事件（所有待加载瓦片完成） */
	'loading-complete': { loaded: number };
}

/** 地图投影中心经度类型 */
type ProjectCenterLongitude = -90 | 0 | 90;

/** 地图创建参数 */
export interface MapParams {
	/** 场景 */
	scene: Scene;
	/** 是否开启调试模式 (0: 关闭, 1: 开启, 2: 显示包围盒) */
	debug?: number;
	/** 地图数据加载器 */
	loader?: ITileLoader;
	/** 根瓦片 */
	rootTile?: Tile;
	/** 影像数据源 */
	imgSource: ISource | ISource[];
	/** 高程数据源 */
	demSource?: ISource;
	/** 背景色 */
	backgroundColor?: Color3;
	/** 地图经纬度范围 [minLon, minLat, maxLon, maxLat] */
	bounds?: [number, number, number, number];
	/** 最小缩放级别 */
	minLevel?: number;
	/** 最大缩放级别 */
	maxLevel?: number;
	/** 投影中心经度 */
	lon0?: ProjectCenterLongitude;
	/** LOD 阈值 */
	LODThreshold?: number;
}

/**
 * 瓦片地图类
 * 管理整个瓦片地图系统，包括瓦片树、投影、数据源等
 * 地图平铺在 X-Z 平面（Babylon Y-up），Y 轴为海拔高度
 */
export class TileMap extends BabylonTransformNode {
	/** 名称 */
	public readonly name = 'map';

	/** 是否为 LOD 模型 */
	public readonly isLOD = true;

	/** 地图是否在每帧渲染时自动更新 */
	public autoUpdate = true;

	/** 调试标志 */
	public debug = 0;

	/** 瓦片树更新间隔（单位：毫秒） */
	public updateInterval = 100;

	/** 根瓦片 */
	public readonly rootTile: Tile;

	/** 瓦片数据加载器 */
	public readonly loader: ITileLoader;

	/** 场景 */
	private readonly _mapScene: Scene;

	/** 上次更新时间 */
	private _lastUpdateTime = 0;

	/** 事件 Observable 映射 */
	private _observables: Map<keyof TileMapEventMap, Observable<any>> = new Map();

	private _mask = -1;

	/** 加载进度跟踪 */
	private _wasLoading = false;
	private _loadedCount = 0;

	private _minLevel = 2;

	/** 获取地图最小缩放级别 */
	public get minLevel(): number {
		return this._minLevel;
	}

	/** 设置地图最小缩放级别 */
	public set minLevel(value: number) {
		this._minLevel = value;
	}

	private _maxLevel = 20;

	/** 获取地图最大缩放级别 */
	public get maxLevel(): number {
		return this._maxLevel;
	}

	/** @deprecated 废弃，它会自动根据数据源的最大缩放级别设置 */
	public set maxLevel(value: number) {
		this._maxLevel = value;
	}

	private _LODThreshold = 1;

	/** 获取 LOD 阈值 */
	public get LODThreshold(): number {
		return this._LODThreshold;
	}

	/** 设置 LOD 阈值 */
	public set LODThreshold(value: number) {
		this._LODThreshold = value;
	}

	/** 获取中央子午线经度 */
	public get lon0(): number {
		return this.projection.lon0;
	}

	/** 设置中央子午线经度 */
	public set lon0(value: ProjectCenterLongitude) {
		if (this.projection.lon0 !== value) {
			if (value !== 0 && this._minLevel < 1) {
				console.warn(`Map centralMeridian is ${this.lon0}, minLevel must > 0`);
			}
			this.projection = ProjectionFactory.createFromID(this.projection.ID, value);
			this._updateSource();
		}
	}

	/** 获取地图投影对象 */
	public get projection(): IProjection {
		return this.loader.projection;
	}

	/** 设置地图投影对象 */
	private set projection(proj: IProjection) {
		if (proj.ID !== this.loader.projection.ID || proj.lon0 !== this.loader.projection.lon0) {
			(this.loader as TileLoader).projection = proj;
			this._resize();
			this.reload();
			if (this.debug > 0) {
				console.log('Map Projection Changed:', proj.ID, proj.lon0);
			}
			this._notifyObservers('projection-changed', { projection: proj });
		}
	}

	/** 获取影像数据源 */
	public get imgSource(): ISource[] {
		return this.loader.imgSource;
	}

	/** 设置影像数据源 */
	public set imgSource(value: ISource | ISource[]) {
		const sources = Array.isArray(value) ? value : [value];
		if (sources.length === 0) {
			throw new Error('imgSource can not be empty');
		}

		// 将第一个影像层的投影设置为地图投影
		this.projection = ProjectionFactory.createFromID(
			sources[0].projectionID,
			this.projection.lon0 as -90 | 0 | 90
		);
		this.loader.imgSource = sources;
		this._updateSource();

		if (this.debug > 0) {
			console.log('Img Source Changed:', sources);
		}
		this._notifyObservers('source-changed', { source: value });
	}

	/** 获取地形数据源 */
	public get demSource(): ISource | undefined {
		return this.loader.demSource;
	}

	/** 设置地形数据源 */
	public set demSource(value: ISource | undefined) {
		if (this.loader.demSource === value) {
			return;
		}
		this.loader.demSource = value;
		this._updateSource();

		if (this.debug > 0) {
			console.log('DEM Source Changed:', this.demSource);
		}
		this._notifyObservers('source-changed', { source: value });
	}

	/** 获取背景色 */
	public get backgroundColor(): Color3 {
		return (this.loader as TileLoader).backgroundMaterial.diffuseColor;
	}

	/** 设置背景色 */
	public set backgroundColor(value: Color3) {
		(this.loader as TileLoader).backgroundMaterial.diffuseColor = value;
	}

	/** 获取地图经纬度范围 */
	public get bounds(): [number, number, number, number] | undefined {
		return (this.loader as TileLoader).bounds;
	}

	/** 设置地图经纬度范围 */
	public set bounds(value: [number, number, number, number] | undefined) {
		if (value) {
			(this.loader as TileLoader).bounds = value;
		}
	}

	/**
	 * 地图创建工厂函数
	 * @param params 地图参数
	 * @returns 地图对象
	 */
	public static create(params: MapParams): TileMap {
		return new TileMap(params);
	}

	/**
	 * 构造函数
	 * @param params 地图参数
	 */
	public constructor(params: MapParams) {
		super('TileMap', params.scene);

		this._mapScene = params.scene;

		const {
			loader,
			rootTile,
			minLevel = 2,
			imgSource,
			demSource,
			backgroundColor,
			bounds,
			lon0 = 0,
			debug = 0,
			LODThreshold = 1,
		} = params;

		this._minLevel = minLevel;
		this._LODThreshold = LODThreshold;
		this.debug = debug;

		// 创建加载器
		this.loader = loader || new TileLoader(this._mapScene, ProjectionFactory.createWGS84(lon0));
		(this.loader as TileLoader).debug = debug;

		// 创建根瓦片
		this.rootTile = rootTile || new Tile(0, 0, 0, this._mapScene);

		// 设置背景色
		if (backgroundColor) {
			this.backgroundColor = backgroundColor;
		}

		// 设置边界
		if (bounds) {
			(this.loader as TileLoader).bounds = bounds;
		}

		// 根瓦片加入地图
		this.rootTile.setParent(this);

		// 调整地图大小
		this._resize();

		// 设置中央子午线
		this.lon0 = lon0;

		// 设置数据源
		this.imgSource = Array.isArray(imgSource) ? imgSource : [imgSource];
		if (demSource) {
			this.demSource = demSource;
		}

		// 初始化事件
		this._initEvents();

		// 准备就绪
		this._onReady();
	}

	/**
	 * 计算并缓存最大缩放级别
	 */
	private _getMaxLevel(): number {
		let maxLevel = 0;
		this.imgSource.forEach(source => (maxLevel = Math.max(maxLevel, source.maxLevel)));
		if (this.demSource) {
			maxLevel = Math.max(maxLevel, this.demSource.maxLevel);
		}
		if (this.debug) {
			console.log('Max Level:', maxLevel);
		}
		return maxLevel;
	}

	/**
	 * 调整地图大小（Babylon Y-up: 地图平铺在 X-Z 平面）
	 */
	private _resize(): void {
		// 拉伸地图到投影大小（X-Z 平面，Y 为海拔）
		this.rootTile.scaling.set(
			this.projection.mapWidth,
			this.projection.mapDepth,    // = 1 (flat in Y, which is altitude)
			this.projection.mapHeight
		);
		this.rootTile.computeWorldMatrix(true);
		// 投影切换后根瓦片缩放改变，失效缓存的尺寸/包围盒
		this.rootTile.invalidateTileSize();
	}

	/**
	 * 初始化事件
	 */
	private _initEvents(): void {
		// 监听根瓦片事件并转发（因为事件通过 _root 分发）
		const events: Array<keyof TileMapEventMap> = [
			'tile-created',
			'tile-loaded',
			'tile-unload',
			'tile-visible-changed',
		];

		events.forEach(eventName => {
			this.rootTile.addEventListener(eventName as any, (data: any) => {
				this._notifyObservers(eventName, data);
			});
		});
	}

	/**
	 * 准备就绪
	 */
	private _onReady(): void {
		setTimeout(() => {
			this._notifyObservers('ready', {});
		}, 0);
	}

	/**
	 * 模型更新回调函数
	 * @param camera 相机
	 */
	public update(camera: Camera): void {
		if (!this.autoUpdate) {
			return;
		}

		const currentTime = Date.now();
		const elapsed = currentTime - this._lastUpdateTime;

		// 控制瓦片树更新速率（与 three-tile 一致：100ms 间隔）
		if (elapsed > this.updateInterval) {
			this.rootTile.update({
				camera,
				loader: this.loader,
				minLevel: this._minLevel,
				maxLevel: this._maxLevel,
				LODThreshold: this._LODThreshold,
			});

			// 加载进度事件跟踪
			this._trackLoadingProgress();

			this._notifyObservers('update', { delta: elapsed });
			this._lastUpdateTime = currentTime;
		}
	}

	/**
	 * 跟踪加载进度并触发相应事件
	 * 当 downloading 从 0 变为 >0 时触发 loading-start
	 * 当 downloading 从 >0 变为 0 时触发 loading-complete
	 */
	private _trackLoadingProgress(): void {
		const downloading = this.loader.downloadingThreads;
		const isLoading = downloading > 0;

		if (isLoading && !this._wasLoading) {
			// 进入加载状态
			this._notifyObservers('loading-start', {});
		} else if (!isLoading && this._wasLoading) {
			// 加载完成
			this._notifyObservers('loading-complete', { loaded: this._loadedCount });
			this._loadedCount = 0;
		} else if (isLoading) {
			// 加载进行中
			this._loadedCount++;
			this._notifyObservers('loading-progress', {
				downloading,
				loaded: this._loadedCount,
			});
		}

		this._wasLoading = isLoading;
	}

	/**
	 * 更新地图数据
	 */
	private _updateSource(): void {
		this._maxLevel = this._getMaxLevel();
		this.rootTile.reload(false);
	}

	/**
	 * 重新加载地图数据
	 * @param dispose 是否销毁全部瓦片（默认 true）
	 */
	public reload(dispose = true): void {
		this.rootTile.reload(dispose);
	}

	/**
	 * 地理坐标转换为地图模型坐标
	 * Babylon Y-up: 投影 X → 世界 X, 投影 Y(northing) → 世界 Z, 海拔 → 世界 Y
	 * @param geo 地理坐标（经度、纬度、高度）
	 * @returns 模型坐标 (x, altitude, z)
	 */
	public geo2map(geo: Vector3): Vector3 {
		const pos = this.projection.project(geo.x, geo.y);
		return new BabylonVector3(pos.x, geo.z, pos.y);
	}

	/**
	 * 地理坐标转换为世界坐标
	 * @param geo 地理坐标（经度、纬度、高度）
	 * @returns 世界坐标
	 */
	public geo2world(geo: Vector3): Vector3 {
		const mapPos = this.geo2map(geo);
		return BabylonVector3.TransformCoordinates(mapPos, this.getWorldMatrix());
	}

	/**
	 * 地图模型坐标转换为地理坐标
	 * Babylon Y-up: 世界 X → 投影 X, 世界 Z → 投影 Y(northing), 世界 Y → 海拔
	 * @param map 模型坐标 (x, altitude, z)
	 * @returns 地理坐标（经度、纬度、高度）
	 */
	public map2geo(map: Vector3): Vector3 {
		const position = this.projection.unProject(map.x, map.z);
		return new BabylonVector3(position.lon, position.lat, map.y);
	}

	/**
	 * 世界坐标转换为地理坐标
	 * @param world 世界坐标
	 * @returns 地理坐标（经度、纬度、高度）
	 */
	public world2geo(world: Vector3): Vector3 {
		const invMatrix = this.getWorldMatrix().clone();
		invMatrix.invert();
		const map = BabylonVector3.TransformCoordinates(world.clone(), invMatrix);
		return this.map2geo(map);
	}

	/**
	 * 获取当前正在下载的瓦片数量
	 */
	public get downloading(): number {
		return this.loader.downloadingThreads;
	}

	/**
	 * 递归遍历瓦片树
	 */
	private _traverseTiles(node: BabylonTransformNode, callback: (tile: Tile) => void): void {
		if (node instanceof Tile) {
			callback(node);
		}
		node.getChildren().forEach(child => {
			this._traverseTiles(child as BabylonTransformNode, callback);
		});
	}

	/**
	 * 获取地图瓦片状态统计信息
	 */
	public getTileCount(): {
		total: number;
		leaf: number;
		visible: number;
		inFrustum: number;
		maxLevel: number;
		downloading: number;
	} {
		let total = 0,
			leaf = 0,
			visible = 0,
			inFrustum = 0,
			maxLevel = 0;

		this._traverseTiles(this.rootTile, tile => {
			total++;
			if (tile.isLeaf) {
				leaf++;
				if (tile.showing) visible++;
				if (tile.inFrustum) inFrustum++;
			}
			if (tile.z > maxLevel) maxLevel = tile.z;
		});

		return {
			total,
			leaf,
			visible,
			inFrustum,
			maxLevel,
			downloading: this.loader.downloadingThreads,
		};
	}

	/**
	 * 添加事件监听
	 */
	public addObservable<K extends keyof TileMapEventMap>(
		event: K,
		callback: (data: TileMapEventMap[K]) => void
	): void {
		if (!this._observables.has(event)) {
			this._observables.set(event, new Observable());
		}
		this._observables.get(event)?.add(callback);
	}

	/**
	 * 移除事件监听
	 */
	public removeObservable<K extends keyof TileMapEventMap>(
		event: K,
		callback: (data: TileMapEventMap[K]) => void
	): void {
		const observable = this._observables.get(event);
		if (observable) {
			observable.removeCallback(callback);
		}
	}

	/**
	 * 通知观察者
	 */
	private _notifyObservers<K extends keyof TileMapEventMap>(event: K, data: TileMapEventMap[K]): void {
		const observable = this._observables.get(event);
		if (observable) {
			observable.notifyObservers(data, this._mask, event as string);
		}
	}

	/**
	 * 从屏幕坐标获取地面信息（射线检测）
	 * 从相机发射射线穿过屏幕点，与地图瓦片网格求交
	 * @param screenX 屏幕 X 坐标（像素）
	 * @param screenY 屏幕 Y 坐标（像素）
	 * @param camera 相机
	 * @returns 地面信息（世界坐标、经纬度、法向量），未命中返回 undefined
	 */
	public getLocalInfoFromScreen(
		screenX: number,
		screenY: number,
		camera: Camera
	): LocationInfo | undefined {
		const scene = this._mapScene;
		// 使用 Babylon.js 内置 pick 进行射线检测
		const pickResult = scene.pick(screenX, screenY, (mesh) => {
			// 只检测地图瓦片网格（排除覆盖层和辅助对象）
			return mesh.parent instanceof Tile;
		}, true, camera);

		if (!pickResult || !pickResult.hit || !pickResult.pickedPoint) {
			return undefined;
		}

		return this._buildLocationInfo(pickResult.pickedPoint, pickResult.getNormal(true));
	}

	/**
	 * 从世界坐标获取地面信息
	 * 从世界坐标点向下发射射线，与地图瓦片求交
	 * @param worldPoint 世界坐标点
	 * @returns 地面信息，未命中返回 undefined
	 */
	public getLocalInfoFromWorld(worldPoint: Vector3): LocationInfo | undefined {
		const scene = this._mapScene;
		// 从世界坐标点向下发射射线
		const origin = new BabylonVector3(worldPoint.x, worldPoint.y + 10000, worldPoint.z);
		const direction = new BabylonVector3(0, -1, 0);
		const ray = new Ray(origin, direction, 20000);

		const pickResult = scene.pickWithRay(ray, (mesh) => {
			return mesh.parent instanceof Tile;
		}, true);

		if (!pickResult || !pickResult.hit || !pickResult.pickedPoint) {
			return undefined;
		}

		return this._buildLocationInfo(pickResult.pickedPoint, pickResult.getNormal(true));
	}

	/**
	 * 构建地面信息对象
	 */
	private _buildLocationInfo(
		point: BabylonVector3,
		normal: BabylonVector3 | null
	): LocationInfo {
		const geo = this.world2geo(point);
		return {
			point: point.clone(),
			location: geo,
			normal: normal ? normal.clone() : new BabylonVector3(0, 1, 0),
		};
	}

	/**
	 * 释放地图资源（包括瓦片树、事件、加载器材质、Worker 池）
	 */
	public dispose(): void {
		// 卸载瓦片树
		this.rootTile.unload();
		this.rootTile.dispose();

		// 清理所有 Observable
		this._observables.forEach(observable => observable.clear());
		this._observables.clear();

		// 释放加载器中的共享材质
		const loader = this.loader as TileLoader;
		if (loader.backgroundMaterial) {
			loader.backgroundMaterial.dispose();
		}

		// 释放全局 Worker 池
		TerrainWorkerPool.dispose();

		// 调用父类 dispose（释放 TransformNode）
		super.dispose();
	}
}
