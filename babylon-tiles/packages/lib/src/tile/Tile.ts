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
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

import { FrustumEx } from './FrustumEx.js';
import { createChildren, LODAction, LODEvaluate } from './util.js';
import type { ITileLoader } from '../loader/ITileLoader.js';
import { TextureCache } from '../loader/TextureCache.js';
import { beginTileFadeIn, isTileFadingIn } from './TileFade.js';

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

	/** 加载失败计数（用于指数退避，防止预加载对失败瓦片每 tick 无限重试） */
	private _loadFailCount = 0;

	/** 下次允许重试加载的时间戳（指数退避） */
	private _nextLoadRetryAt = 0;

	/** 根瓦片 */
	private _root: Tile = this;

	/** 瓦片在世界坐标系中的大小（对角线长度） */
	private _sizeInWorld = -1;

	/** 距离检测点（瓦片中心世界坐标，对齐 three-tile _checkPoint） */
	private _checkPoint = new BabylonVector3();

	/** 瓦片包围盒（世界坐标，对齐 three-tile _bbox） */
	private _bbox: BoundingBox | null = null;

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

		// 递归使子节点失效：直接遍历子瓦片 + 模型，避免 getChildTransformNodes()
		// 每帧为每个瓦片分配新数组（高缩放级别下成千上万个瓦片时这是大量 GC 压力）。
		if (this._subTiles) {
			for (const child of this._subTiles) {
				child._currentRenderId = -1;
			}
		}
		if (this._model) {
			this._model._currentRenderId = -1;
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
	 * 对齐 three-tile: 使用缓存的 _checkPoint，避免每次访问分配新对象
	 */
	public get distRatio(): number {
		const distToCamera = BabylonVector3.Distance(cameraWorldPosition, this._checkPoint);
		const ratio = distToCamera / this._sizeInWorld;
		return this._inFrustum ? ratio * 0.8 : ratio * 2;
	}

	/**
	 * 计算瓦片包围盒（世界坐标）
	 * 对齐 three-tile: bbox Y 使用固定值 (-300, 9000) 米
	 * three-tile 原始代码:
	 *   this._bbox = new Box3((-0.5,-0.5),(0.5,0.5)).applyMatrix4(this.matrixWorld)
	 *   this._bbox.min.setY(-300); this._bbox.max.setY(9000);
	 * 由于所有瓦片 Y 缩放 = 1 且无旋转，局部 Y = 世界 Y
	 * @returns 世界坐标包围盒
	 */
	public getBBox(): BoundingBox {
		if (this._bbox) {
			return this._bbox;
		}
		// 对齐 three-tile: 水平范围 (-0.5, 0.5)，Y 固定 (-300, 9000)
		const minLocal = new BabylonVector3(-0.5, -300, -0.5);
		const maxLocal = new BabylonVector3(0.5, 9000, 0.5);
		const worldMatrix = this.getWorldMatrix();
		this._bbox = new BoundingBox(minLocal, maxLocal, worldMatrix);
		return this._bbox;
	}

	/**
	 * 计算瓦片世界大小（对角线长度）
	 * 仅在首次调用时计算（瓦片创建后变换不再改变）
	 * 投影切换等场景通过 invalidateTileSize() 显式失效
	 * @returns 世界空间中对角线长度
	 */
	public getTileSize(): number {
		if (this._sizeInWorld < 0) {
			this._computeTileSize();
		}
		return this._sizeInWorld;
	}

	/**
	 * 失效缓存的瓦片尺寸/包围盒/检测点
	 * 调用场景：投影切换后根瓦片缩放改变、地图节点变换等
	 */
	public invalidateTileSize(): void {
		this._sizeInWorld = -1;
		this._bbox = null;
	}

	/**
	 * 计算瓦片 checkpoint、bbox、size（对齐 three-tile computeTileSize）
	 * 仅在瓦片创建后调用一次，因为瓦片变换在创建后不再改变。
	 * three-tile 原始逻辑:
	 *   this._bbox = new Box3((-0.5,-0.5),(0.5,0.5)).applyMatrix4(this.matrixWorld)
	 *   this._checkPoint = new Vector3().applyMatrix4(this.matrixWorld)
	 *   this._sizeInWorld = this._bbox.getSize().length()
	 *   this._bbox.min.setY(-300); this._bbox.max.setY(9000)
	 */
	private _computeTileSize(): void {
		const wm = this.getWorldMatrix();

		// 距离检测点：瓦片中心世界坐标
		BabylonVector3.TransformCoordinatesToRef(
			BabylonVector3.Zero(), wm, this._checkPoint
		);

		// 瓦片大小：几何体 (-0.5, 0.5) 经世界矩阵变换后的对角线长度
		const p1 = BabylonVector3.TransformCoordinates(
			new BabylonVector3(-0.5, 0, -0.5), wm
		);
		const p2 = BabylonVector3.TransformCoordinates(
			new BabylonVector3(0.5, 0, 0.5), wm
		);
		this._sizeInWorld = BabylonVector3.Distance(p1, p2);

		// 包围盒：固定 Y 范围 (-300, 9000) 米（对齐 three-tile）
		// 由于 Y 缩放始终为 1 且无旋转，局部 Y = 世界 Y
		this._bbox = null; // 清除缓存，getBBox() 会重新创建
	}

	/**
	 * 判断是否需要加载瓦片数据
	 * 对齐 three-tile 行为：
	 * - 没有模型的瓦片：只要下载线程可用就加载（不要求视锥体内）
	 *   three-tile 原始逻辑: if (!this.model) { this._startLoad(loader); return; }
	 * - 有模型的脏瓦片：要求在视锥体内才更新
	 */
	private _needsLoad(loader: ITileLoader, _minLevel: number): boolean {
		// 下载线程数 >= 最大下载线程数，不下载
		if (loader.downloadingThreads >= loader.maxThreads) {
			return false;
		}

		// 加载失败退避：失败过的瓦片按指数退避重试（上限 30s），避免
		// 预加载对永久失败的瓦片每 100ms tick 无限重试（占下载槽 + 刷错误日志）。
		if (this._loadFailCount > 0 && Date.now() < this._nextLoadRetryAt) {
			return false;
		}

		// 没有模型：恢复预加载（与 three-tile 一致）。瓦片树只会在「视锥体内
		// 且正在显示」的父瓦片下创建子瓦片（见 LODEvaluate CREATE），所以已创建
		// 的瓦片都靠近相机，预加载量有界（实测高缩放 ~300 个）。渲染数量不受
		// 影响——可见性由 updateVisibility 控制，只启用视锥体内的瓦片。
		if (!this._model) {
			return true;
		}

		// 不是脏瓦片或不在视野范围内，不更新
		if (!this._tileIsDirty || !this._inFrustum) {
			return false;
		}

		// 先更新子瓦片再更新父瓦片
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
			// Babylon.js 为行向量约定（p·M），合成矩阵顺序必须是 V·P（与 Scene.getTransformMatrix 一致）
			const viewMatrix = camera.getViewMatrix();
			const projMatrix = camera.getProjectionMatrix();
			viewMatrix.multiplyToRef(projMatrix, tempMat);
			frustum.setFromProjectionMatrix(tempMat);
		}

		// 计算瓦片世界大小
		this.getTileSize();

		// 计算是否在视锥体内
		const bbox = this.getBBox();
		this._inFrustum = frustum.intersectsBox(bbox);

		// 可见性不再在此处逐瓦片刷新：改由 TileMap.update 每 tick 结束后从根
		// 全树调用 updateVisibility()（此时所有 _inFrustum 与 _model 已更新完毕）。

		// 下载瓦片数据
		if (this.z >= minLevel && this._needsLoad(loader, minLevel)) {
			if (this._model) {
				this._startModify(loader);
			} else {
				this._startLoad(loader);
			}
			return;
		}

		// LOD
		this.LOD(params);

		// 递归更新子瓦片：先遍历视锥体内的子瓦片，再遍历视锥体外的。
		// 下载槽位（maxThreads）按遍历顺序发放，可见瓦片优先获得槽位，
		// 平移/缩放时当前视野先清晰，屏幕外预加载次之。两遍遍历避免分配数组。
		this._subTiles?.forEach(child => {
			if (child.inFrustum) {
				child.update(params);
			}
		});
		this._subTiles?.forEach(child => {
			if (!child.inFrustum) {
				child.update(params);
			}
		});
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
				// 立即绑定根瓦片：新建子瓦片在首帧 update 前若加载完成，需要
				// 正确的 _root 才能执行全树 updateVisibility（否则 _root 指向自己，
				// 可见性只更新局部子树，延迟 100ms 才恢复）。
				child._root = this._root;
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
	 * 递归更新本瓦片及后代的可见性（从根调用，每 tick 及瓦片加载完成后）。
	 * 核心不变量：任意时刻，一个点最多被一层瓦片网格覆盖——
	 * 父瓦片显示时其整个子树的网格全部隐藏（消除跨级 z-fight）。
	 *
	 * suppressed：被某个显示中的父瓦片覆盖（其子树必须隐藏）。
	 * 规则：
	 *  - 无模型：自身不可见，子瓦片继承 suppressed（无模型父不提供遮挡，不压制子瓦片）；
	 *  - 有模型且为叶子：suppressed 为 false 且在视锥体内才显示；
	 *  - 有模型且有子瓦片：suppressed 为 false 且在视锥体内、且存在「视锥体内未加载」的
	 *    子瓦片（或无任何视锥体内子瓦片，避免边界空洞）时显示，用于填充加载间隙；
	 *    显示时递归压制后代。
	 */
	public updateVisibility(suppressed = false): void {
		// 调试模式：强制所有瓦片可见
		if (Tile.forceVisible) {
			this.showing = true;
			this._subTiles?.forEach(c => c.updateVisibility(false));
			return;
		}

		const subTiles = this._subTiles;

		// 无模型：自身不可见，子瓦片继承 suppressed（minLevel 兼容：z<minLevel 的
		// 瓦片永远不加载，它们的子瓦片（实际显示的瓦片）不应被压制）。
		if (!this._model) {
			subTiles?.forEach(c => c.updateVisibility(suppressed));
			return;
		}

		// 有模型且为叶子：suppressed 为 false 且在视锥体内才显示
		if (!subTiles || subTiles.length === 0) {
			this.showing = !suppressed && this.inFrustum;
			return;
		}

		// 有模型且有子瓦片：视锥体内的子瓦片全部加载完 → 切换到子瓦片显示；
		// 否则本瓦片显示（填充加载间隙 / 边界空洞），并递归压制后代。
		const inFrustumTiles = subTiles.filter(c => c.inFrustum);
		const allLoaded = inFrustumTiles.length > 0 && inFrustumTiles.every(c => !!c._model);
		// 有子瓦片正在交叉淡入时，父瓦片保持可见作为不透明底衬：淡入瓦片
		// alpha=0 的瞬间若父瓦片已隐藏，会露出背景/清屏色（白闪）。
		// 淡入完成后 isTileFadingIn 返回 false，下次 updateVisibility 即隐藏父瓦片。
		const anyFading = inFrustumTiles.some(c => isTileFadingIn(c));
		const shouldShow = !suppressed && this.inFrustum && (!allLoaded || anyFading);
		this.showing = shouldShow;
		if (shouldShow && anyFading) {
			// 父瓦片作为不透明底衬显示；淡入期间所有已加载子瓦片保持可见：
			// 淡入中的子瓦片叠加在父瓦片上，已完成淡入的兄弟瓦片不闪隐。
			// 若把兄弟瓦片一并压制，会在它们的区域露出父瓦片粗纹理，
			// 待 fade 结束后才弹回细纹理——衔接处二次闪烁。
			// 未加载的子瓦片无模型，压制与否不产生任何渲染。
			subTiles.forEach(c => {
				if (c._model) {
					c.updateVisibility(false);
				} else {
					c.updateVisibility(true);
				}
			});
		} else {
			subTiles.forEach(c => c.updateVisibility(suppressed || shouldShow));
		}
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
				// 释放孤儿模型的所有资源（包括多影像叠加的覆盖层子网格材质与基材质；
				// 缓存的纹理交还引用供复用，未缓存的直接释放）
				const childMeshes = model.getChildMeshes();
				for (const child of childMeshes) {
					if (child.material) {
						const textures = child.material.getActiveTextures();
						for (const tex of textures) {
							TextureCache.release(tex);
						}
						child.material.dispose();
					}
				}
				if (model.material) {
					const textures = model.material.getActiveTextures();
					for (const tex of textures) {
						TextureCache.release(tex);
					}
					model.material.dispose();
				}
				model.geometry?.dispose();
				model.dispose();
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

			// 新瓦片交叉淡入：父瓦片（作为填充显示）仍在屏上时，淡入本瓦片
			// 平滑 coarse→fine 的内容替换，消除跨 LOD 衔接处在缩放/加载时的
			// 生硬弹出（闪烁）。父瓦片未显示（无底衬）时直接显示，不淡入。
			this._beginFadeInIfNeeded();

			// 对齐 three-tile: 加载后更新 checkPoint.y 为模型最高海拔
			// three-tile: this._checkPoint.y = this._model.geometry.boundingBox?.max.z || 0
			this._checkPoint.y = model.getBoundingInfo()?.boundingBox?.maximumWorld?.y || 0;

			// 加载成功，重置失败退避
			this._loadFailCount = 0;
			this._nextLoadRetryAt = 0;

			// 全树重算可见性：新模型可能让父瓦片从「填充间隙」切换为隐藏、
			// 本瓦片从隐藏切换为显示（保证同一位置只被一层瓦片覆盖）
			this._root.updateVisibility();

			this._root._dispatchEvent('tile-loaded', { tile: this });
		} catch (error) {
			console.error(`Tile load failed ${this.z}-${this.x}-${this.y}:`, error);
			// 记录失败并设置指数退避：1s, 2s, 4s, ... 上限 30s
			this._loadFailCount++;
			this._nextLoadRetryAt = Date.now() + Math.min(1000 * Math.pow(2, this._loadFailCount), 30000);
		} finally {
			this._isLoading = false;
		}
	}

	/**
	 * 若父瓦片仍在屏上（作为 coarse 填充显示），则对刚加载的模型做交叉淡入。
	 * 只收集本瓦片自己的材质（基底 + 覆盖层子网格）；共享材质（如 backgroundMaterial）
	 * 不淡入，避免影响其他瓦片。
	 */
	private _beginFadeInIfNeeded(): void {
		const parent = this.parent;
		if (!(parent instanceof Tile) || !parent.showing || !this._model) {
			return;
		}

		const mats: StandardMaterial[] = [];
		const base = this._model.material;
		if (base instanceof StandardMaterial && !this._isSharedMaterial(base)) {
			mats.push(base);
		}
		for (const child of this._model.getChildMeshes()) {
			if (child.material instanceof StandardMaterial && !this._isSharedMaterial(child.material)) {
				mats.push(child.material);
			}
		}

		if (mats.length > 0 && this._model) {
			beginTileFadeIn(this, this._model, mats);
		}
	}

	/** 材质是否被其他网格共享（如 backgroundMaterial 被所有回退瓦片共用）——共享材质不淡入 */
	private _isSharedMaterial(material: StandardMaterial): boolean {
		return this._scene.meshes.some(m => m !== this._model && m.material === material);
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
				// 对齐 three-tile: 更新后同步 checkPoint.y
				this._checkPoint.y = newModel.getBoundingInfo()?.boundingBox?.maximumWorld?.y || 0;
				// 替换 _model 后新模型默认启用，立即按当前视锥体重算可见性，
				// 避免视锥体外的瓦片错误显示一帧
				this._root.updateVisibility();
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
	 * 仅卸载自身模型，释放资源（包括多影像叠加的覆盖层子网格）
	 */
	public unloadModel(): void {
		if (this._model) {
			this._model.setParent(null);

			// 释放覆盖层子网格的材质（多影像叠加时创建的 overlay meshes）
			const childMeshes = this._model.getChildMeshes();
			for (const child of childMeshes) {
				if (child.material) {
					const textures = child.material.getActiveTextures();
					for (const tex of textures) {
						TextureCache.release(tex);
					}
					child.material.dispose();
				}
				(child as Mesh).geometry?.dispose();
				child.dispose();
			}

			// 释放主网格材质（缓存的纹理交还引用供复用；未缓存的直接释放）
			const material = this._model.material;
			if (material) {
				const textures = material.getActiveTextures();
				for (const tex of textures) {
					TextureCache.release(tex);
				}
				material.dispose();
			}
			this._model.geometry?.dispose();
			this._model.dispose();
			this._model = undefined;
			this._tileIsDirty = false;
			this._root._dispatchEvent('tile-unload', { tile: this });
		}
	}

	/* istanbul ignore next */
	/**
	 * 仅卸载子瓦片（包括释放 TransformNode 本身）
	 */
	public unloadSubTiles(): void {
		this._subTiles?.forEach(child => {
			child.unloadSubTiles();
			child.unloadModel();
			child.setParent(null);
			child.dispose();
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
