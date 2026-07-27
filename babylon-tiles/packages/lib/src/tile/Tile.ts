/**
 * @description: 动态 LOD 瓦片类
 * Ported from three-tile's Tile.ts for Babylon.js (Y-up coordinate system)
 * @author: Babylon-Tile Team
 * @date: 2025-07-25
 */

import type { Camera } from '@babylonjs/core/Cameras/camera';
import { TransformNode as BabylonTransformNode } from '@babylonjs/core/Meshes/transformNode';
import { BoundingBox } from '@babylonjs/core/Culling/boundingBox';
import { Vector3 as BabylonVector3 } from '@babylonjs/core/Maths/math.vector';
import { Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { FrustumEx } from './FrustumEx.js';
import { createChildren, LODAction, LODEvaluate } from './util.js';
import type { ITileLoader } from '../loader/ITileLoader.js';

/** 相机世界坐标（模块级，每帧更新一次） */
const cameraWorldPosition = new BabylonVector3();

/** 场景视锥体（模块级，每帧更新一次） */
const frustum = new FrustumEx();

/** 临时矩阵 */
const tempMat = new Matrix();

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
}

/**
 * 动态 LOD（DLOD）地图瓦片类
 * 地图平铺在 X-Z 平面（Babylon Y-up），Y 轴为海拔高度
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

	/** 瓦片在世界坐标系中的大小（对角线长度） */
	private _sizeInWorld = -1;

	/** 瓦片是否在视锥体内 */
	private _inFrustum = false;

	/** 瓦片模型 */
	private _model?: Mesh;

	/** 子瓦片 */
	private _subTiles?: Tile[];

	/** 是否为脏瓦片 */
	private _tileIsDirty = false;

	/** 调试标志 */
	public get debug(): number {
		return (this._root as any)._debugFlag || 0;
	}

	/** 强制所有瓦片可见（调试用） */
	public static forceVisible = false;

	/** 事件观察者映射 */
	private _eventObservers: Map<keyof TileEventMap, Array<(data: any) => void>> = new Map();

	/**
	 * 构造函数
	 * @param x 瓦片 X 坐标
	 * @param y 瓦片 Y 坐标
	 * @param z 瓦片层级
	 * @param scene 场景（可选）
	 */
	public constructor(x = 0, y = 0, z = 0, scene?: Scene) {
		super(`Tile ${z}-${x}-${y}`, scene);
		this.x = x;
		this.y = y;
		this.z = z;
	}

	/**
	 * 覆写 world matrix 计算
	 * 当父节点也是 Tile 时，手动串联矩阵链
	 * 这匹配 three-tile 中 matrixAutoUpdate=false + updateMatrix() + updateMatrixWorld() 的行为
	 */
	public computeWorldMatrix(force?: boolean): Matrix {
		// 非 Tile 父节点（如 TileMap）使用 Babylon 内置计算
		if (!(this.parent instanceof Tile)) {
			return super.computeWorldMatrix(force);
		}

		// 缓存检查
		if (this._currentRenderId === this._scene.getRenderId() && !force) {
			return this._worldMatrix;
		}

		this._currentRenderId = this._scene.getRenderId();

		// 确保父节点 world matrix 是最新的
		const parentWorld = this.parent.getWorldMatrix();

		// 合成局部矩阵: localMatrix = T(position) * R(rotation) * S(scaling)
		const localMatrix = Matrix.Compose(
			this.scaling,
			this.rotationQuaternion || Quaternion.Identity(),
			this.position
		);

		// Babylon.js 采用行主序 / 行向量约定，层级合成必须是 local * parent，
		// 这与 three.js 列向量约定的 parent * local 正好相反。
		// 若写成 parentWorld * localMatrix，子瓦片的平移不会被父瓦片的缩放放大，
		// 所有瓦片会塌缩到原点附近并互相重叠（同时整屏过度绘制导致帧率崩到 1）。
		localMatrix.multiplyToRef(parentWorld, this._worldMatrix);

		// 递归使子节点失效
		for (const child of this.getChildTransformNodes()) {
			(child as Tile)._currentRenderId = -1;
		}

		return this._worldMatrix;
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
	 * 获取是否为叶子瓦片
	 */
	public get isLeaf(): boolean {
		return !this._subTiles || this._subTiles.length === 0;
	}

	/**
	 * 获取瓦片是否在视锥体内
	 */
	public get inFrustum(): boolean {
		return this._inFrustum;
	}

	/**
	 * 获取瓦片是否显示
	 */
	public get showing(): boolean {
		return !!this._model && this._model.isEnabled();
	}

	/**
	 * 设置瓦片是否显示
	 */
	public set showing(value: boolean) {
		if (this._model) {
			if (value !== this.showing) {
				this._model.setEnabled(value);
				this._root._dispatchEvent('tile-visible-changed', { tile: this, visible: value });
			}
		}
	}

	/**
	 * 获取距离比例（相机距离 / 瓦片世界大小）
	 * 用于 LOD 评估，值越小瓦片越密集
	 */
	public get distRatio(): number {
		const checkPoint = BabylonVector3.TransformCoordinates(
			BabylonVector3.Zero(),
			this.getWorldMatrix()
		);
		// 使用模型 Y 轴最高点（海拔）
		const modelMaxY = this._model?.getBoundingInfo()?.boundingBox?.maximumWorld?.y || 0;
		checkPoint.y = modelMaxY;
		const distToCamera = BabylonVector3.Distance(cameraWorldPosition, checkPoint);
		const ratio = distToCamera / this._sizeInWorld;
		return this._inFrustum ? ratio * 0.8 : ratio * 2;
	}

	/**
	 * 计算瓦片包围盒（世界坐标）
	 * 地图在 X-Z 平面，Y 为海拔高度
	 * @returns 世界坐标包围盒
	 */
	public getBBox(): BoundingBox {
		const s = this.scaling;
		let maxY = 9000;
		if (this._model) {
			maxY = this._model.getBoundingInfo()?.boundingBox?.maximumWorld?.y || 0;
		}
		// 局部坐标：X和Z是水平范围，Y是垂直范围 (-300 到 maxY)
		const minLocal = new BabylonVector3(-s.x, -300, -s.z);
		const maxLocal = new BabylonVector3(s.x, maxY, s.z);
		const worldMatrix = this.getWorldMatrix();
		return new BoundingBox(minLocal, maxLocal, worldMatrix);
	}

	/**
	 * 计算瓦片世界大小（对角线长度）
	 * @returns 世界空间中对角线长度
	 */
	public getTileSize(): number {
		if (this._sizeInWorld < 0) {
			this._computeSizeInWorld();
		}
		return this._sizeInWorld;
	}

	/**
	 * 计算并缓存瓦片世界大小
	 */
	private _computeSizeInWorld(): void {
		const s = this.scaling;
		const wm = this.getWorldMatrix();
		const p1 = BabylonVector3.TransformCoordinates(
			new BabylonVector3(-s.x, 0, -s.z),
			wm
		);
		const p2 = BabylonVector3.TransformCoordinates(
			new BabylonVector3(s.x, 0, s.z),
			wm
		);
		this._sizeInWorld = BabylonVector3.Distance(p1, p2);
	}

	/**
	 * 判断是否需要加载瓦片数据
	 * 与 three-tile 行为对齐：
	 * - 没有模型的瓦片始终加载（不要求视锥体内）
	 * - 脏瓦片更新要求在视锥体内
	 */
	private _needsLoad(loader: ITileLoader): boolean {
		// 下载线程数 >= 最大下载线程数，不下载
		if (loader.downloadingThreads >= loader.maxThreads) {
			return false;
		}

		// 没有模型则下载（与 three-tile 一致：不要求 inFrustum）
		if (!this._model) {
			return true;
		}

		// 不是脏瓦片或不在视野范围内，不更新
		if (!this._tileIsDirty || !this._inFrustum) {
			return false;
		}

		// 先更新子瓦片再更新父瓦片（与 three-tile 一致）
		return !this._subTiles?.some(tile => tile._tileIsDirty);
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

		const { loader, minLevel, camera } = params;

		// 如果是根瓦片，计算一次视锥体和摄像机坐标
		if (this.z === 0) {
			cameraWorldPosition.copyFrom(camera.globalPosition);
			// 计算视图-投影矩阵并设置视锥体
			const viewMatrix = camera.getViewMatrix();
			const projMatrix = camera.getProjectionMatrix();
			projMatrix.multiplyToRef(viewMatrix, tempMat);
			frustum.setFromProjectionMatrix(tempMat);
		}

		// 计算瓦片世界大小
		this.getTileSize();

		// 计算是否在视锥体内
		const bbox = this.getBBox();
		this._inFrustum = frustum.intersectsBox(bbox);

		// 下载瓦片数据
		if (this.z >= minLevel && this._needsLoad(loader)) {
			if (this._model) {
				this._startModify(loader);
			} else {
				this._startLoad(loader);
			}
			return;
		}

		// LOD
		this.LOD(params);

		// 递归更新子瓦片
		this._subTiles?.forEach(child => child.update(params));
	}

	/**
	 * LOD (Level of Detail)
	 * @returns LODAction
	 */
	protected LOD(params: TileUpdateParams): LODAction {
		const { loader, minLevel, maxLevel, LODThreshold } = params;
		const action = LODEvaluate(this, minLevel, maxLevel, LODThreshold);

		if (action === LODAction.CREATE) {
			const newTiles = createChildren(this, loader);
			newTiles.forEach(child => {
				// 保存子瓦片的局部坐标（父瓦片局部空间中的值）
				// Babylon.js setParent 默认保持世界空间不变，这会导致局部值
				// 被父瓦片的大缩放值除以后变得极小。
				// 瓦片层级需要保持局部值不变（与 three-tile 行为一致）
				const savedPos = child.position.clone();
				const savedScale = child.scaling.clone();
				child.setParent(this);
				// 恢复局部坐标，覆盖 setParent 的世界空间保留逻辑
				child.position.copyFrom(savedPos);
				child.scaling.copyFrom(savedScale);
				child.computeWorldMatrix(true);
				this._root._dispatchEvent('tile-created', { tile: child });
			});
			this._subTiles = newTiles;
		} else if (action === LODAction.REMOVE) {
			if (this._model) {
				this.showing = true;
				this.unloadSubTiles();
			}
		}

		return action;
	}

	/**
	 * 瓦片下载完成后，检查4个兄弟瓦片全部下载完成时再显示
	 */
	private _checkVisible(): this {
		// 调试模式：强制所有瓦片可见
		if (Tile.forceVisible) {
			this.showing = true;
			return this;
		}
		const parent = this.parent;
		if (parent instanceof Tile) {
			if (parent._model) {
				const subTiles = parent._subTiles;
				if (subTiles) {
					const allLoaded = !subTiles.some(tile => !tile._model);
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
	 * @param loader 瓦片加载器
	 */
	private async _startLoad(loader: ITileLoader): Promise<void> {
		this._isLoading = true;

		try {
			const model = await loader.load(this);

			// 检查加载完成后瓦片是否仍在树中（可能在加载期间被 LOD REMOVE 卸载）
			if (!this.parent) {
				model.geometry?.dispose();
				if (model.material) {
					(model.material as any).dispose?.();
				}
				return;
			}

			this._model = model;

			// Babylon.js setParent 默认保持世界空间不变，会破坏模型的局部变换
			// 与子瓦片的 bug 相同：父瓦片的大缩放值会整除模型的局部缩放
			// 模型需保持 identity 局部变换以匹配 1×1 单位几何体
			model.setParent(this);
			model.position.set(0, 0, 0);
			model.scaling.set(1, 1, 1);
			model.computeWorldMatrix(true);
			// 在 setParent 和恢复局部变换之后刷新包围盒
			model.refreshBoundingInfo(true, true);

			this.isLeaf && this._checkVisible();

			this._root._dispatchEvent('tile-loaded', { tile: this });
		} catch (error) {
			console.error(`Tile load failed ${this.z}-${this.x}-${this.y}:`, error);
		} finally {
			this._isLoading = false;
		}
	}

	/**
	 * 修改瓦片数据（更新时复用已有模型）
	 * @param loader 瓦片加载器
	 */
	private async _startModify(loader: ITileLoader): Promise<void> {
		if (!this._model) return;

		this._isLoading = true;

		try {
			const newModel = await loader.update(
				this._model,
				this,
				this._tileIsDirty,
				this._tileIsDirty
			);

			if (newModel) {
				this._model = newModel;
				this._model.refreshBoundingInfo(true, true);
				this._root._dispatchEvent('tile-loaded', { tile: this });
			}
		} catch (error) {
			console.error(`Tile modify failed ${this.z}-${this.x}-${this.y}:`, error);
		} finally {
			this._tileIsDirty = false;
			this._isLoading = false;
		}
	}

	/* istanbul ignore next */
	/**
	 * 重新加载瓦片数据
	 * @param dispose 是否销毁瓦片树（true：销毁并重建，false：标记为脏）
	 */
	public reload(dispose = true): void {
		if (dispose) {
			this.unload();
		} else {
			this.getChildTransformNodes().forEach(child => {
				if (child instanceof Tile && (child._model || child._isLoading)) {
					child._tileIsDirty = true;
				}
			});
		}
	}

	/* istanbul ignore next */
	/**
	 * 更新瓦片数据（标记所有有模型或正在加载的子瓦片为脏）
	 */
	public updateData(_updateMaterial: boolean, _updateGeometry: boolean): void {
		this.reload(false);
	}

	/* istanbul ignore next */
	/**
	 * 卸载瓦片（包括子瓦片和自身模型）
	 */
	public unload(): void {
		this.unloadSubTiles();
		this.unloadModel();
	}

	/* istanbul ignore next */
	/**
	 * 仅卸载自身模型，释放资源
	 */
	public unloadModel(): void {
		if (this._model) {
			this._model.setParent(null);
			const material = this._model.material;
			if (material) {
				const mat = material as any;
				for (const key in mat) {
					const value = mat[key];
					if (value && (value as any)._isTexture) {
						(value as any).dispose();
					}
				}
				mat.dispose();
			}
			this._model.geometry?.dispose();
			this._model = undefined;
			this._tileIsDirty = false;
			this._root._dispatchEvent('tile-unload', { tile: this });
		}
	}

	/* istanbul ignore next */
	/**
	 * 仅卸载子瓦片
	 */
	public unloadSubTiles(): void {
		this._subTiles?.forEach(child => {
			child.setParent(null);
			child.unloadModel();
			child.unloadSubTiles();
		});
		this._subTiles = undefined;
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
	 * 触发事件（分发到根瓦片的事件系统）
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
