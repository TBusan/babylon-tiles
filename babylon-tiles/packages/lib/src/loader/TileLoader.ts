/**
 * @description: 瓦片加载器实现
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';

import type { ITileLoader, TileLoadParams } from './ITileLoader.js';
import type { IProjection } from '../projection/IProjection.js';
import type { ISource } from '../source/ISource.js';
import { TileGeometry } from '../geometry/TileGeometry.js';
import { TileMaterial } from '../material/TileMaterial.js';
import { TextureCache } from './TextureCache.js';
import { loaderFactory } from './LoaderFactory.js';

/**
 * 平瓦片边缘出血量（Mapbox tile overdraw）：四边各外扩 2 纹素（256px 瓦片）。
 * 用于消除深缩放（z=17/18）时相邻瓦片共享边落在子像素位置、两侧 mesh 独立
 * 光栅化导致的极细白色缝隙——外扩后相邻瓦片重叠，配合 CLAMP 采样同一边缘内容。
 */
const TILE_UV_BLEED = 2 / 256;

/**
 * 瓦片加载器类
 * 负责加载瓦片的几何体和材质，包含投影坐标变换
 */
export class TileLoader implements ITileLoader {
	/** 当前实例的下载计数（非 static，避免多地图实例互相干扰） */
	private _downloadingThreads = 0;

	/** 等待下载槽位的队列（FIFO，由 _releaseSlot 唤醒） */
	private _slotWaiters: Array<() => void> = [];

	private _bounds: [number, number, number, number] = [-180, -85, 180, 85];

	/** 场景 */
	private readonly _scene: Scene;

	/** 错误材质 */
	private readonly _errorMaterial: StandardMaterial;

	/** 背景材质 */
	public readonly backgroundMaterial: StandardMaterial;

	/** 调试标志 */
	public debug = 0;

	/**
	 * 构造函数
	 * @param scene - Babylon.js 场景
	 * @param projection - 投影对象
	 */
	constructor(scene: Scene, projection: IProjection) {
		this._scene = scene;
		this._projection = projection;

		// 确保内置加载器（image/mvt/terrain-rgb/lerc/quantized-mesh）已注册。
		// 幂等：用户先注册的同名 dataType 自定义 loader 不会被覆盖。
		loaderFactory.ensureBuiltinLoaders();

		// 创建错误材质
		this._errorMaterial = new StandardMaterial('error-material', scene);
		this._errorMaterial.diffuseColor = new Color3(1, 0, 0);
		this._errorMaterial.alpha = 0; // 透明，不显示

		// 创建背景材质
		this.backgroundMaterial = TileMaterial.createBackgroundMaterial(scene);
	}

	private _projection: IProjection;

	/** 获取投影对象 */
	public get projection(): IProjection {
		return this._projection;
	}

	/** 获取投影ID（便捷访问） */
	public get projectionID(): string {
		return this._projection.ID;
	}

	/** 设置投影对象 */
	public set projection(value: IProjection) {
		this._projection = value;
		// 更新所有数据源的投影范围
		this._updateImgProjBounds();
		this._updateDemProjBounds();
	}

	private _imgSource: ISource[] = [];

	/** 获取影像数据源 */
	public get imgSource(): ISource[] {
		return this._imgSource;
	}

	/** 设置影像数据源 */
	public set imgSource(value: ISource[]) {
		this._imgSource = value;
		this._updateImgProjBounds();
	}

	private _demSource?: ISource;

	/** 获取地形数据源 */
	public get demSource(): ISource | undefined {
		return this._demSource;
	}

	/** 设置地形数据源 */
	public set demSource(value: ISource | undefined) {
		this._demSource = value;
		this._updateDemProjBounds();
	}
	/** DEM 加载失败告警计数（限制重复告警刷屏，如空 token 时每瓦片失败都会进来） */
	private _demFailWarned = 0;

	/** 获取边界 */
	public get bounds(): [number, number, number, number] {
		return this._bounds;
	}

	/** 设置边界 */
	public set bounds(value: [number, number, number, number]) {
		this._bounds = value;
	}

	/** 最大下载线程数 */
	public maxThreads: number = 10;

	/** 获取当前下载数量 */
	public get downloadingThreads(): number {
		return this._downloadingThreads;
	}

	/**
	 * 更新影像数据源的投影范围
	 */
	private _updateImgProjBounds(): void {
		const proj = this._projection;
		this._imgSource.forEach(source => {
			source._projectionBounds = proj.getProjBoundsFromLonLat(
				source.bounds || this._bounds
			);
		});
	}

	/**
	 * 更新地形数据源的投影范围
	 */
	private _updateDemProjBounds(): void {
		const proj = this._projection;
		if (this._demSource) {
			this._demSource._projectionBounds = proj.getProjBoundsFromLonLat(
				this._demSource.bounds || this._bounds
			);
		}
	}

	/**
	 * 获取瓦片经过投影变换后的坐标和边界
	 * @param x 瓦片X坐标
	 * @param y 瓦片Y坐标（四叉树坐标，y=0 为北行，与标准 XYZ 瓦片 URL 一致）
	 * @param z 瓦片层级
	 * @returns 变换后的坐标和边界
	 */
	private getTileCoords(x: number, y: number, z: number): {
		x: number;
		y: number;
		z: number;
		bounds: [number, number, number, number];
		lonLatBounds: [number, number, number, number];
	} {
		// 根据中央经线变换瓦片X坐标
		const newX = this._projection.getTileXWithCenterLon(x, z);
		// getProjBoundsFromXYZ 内部公式已假定 y=0 为北行（与四叉树/标准 XYZ 一致），
		// 直接使用原始 y（与 three-tile 参考实现一致，无需翻转）。
		const bounds = this._projection.getProjBoundsFromXYZ(x, y, z);
		const lonLatBounds = this._projection.getLonLatBoundsFromXYZ(x, y, z);

		// URL 使用原始 y（四叉树 y 与标准 XYZ URL y 一致）
		return { x: newX, y, z, bounds, lonLatBounds };
	}

	/**
	 * 加载瓦片数据
	 * 多影像源叠加方案：
	 *   Babylon.js 不支持 Three.js 风格的材质数组叠加渲染，
	 *   改用「多层网格」方案：基底网格 + N 个覆盖子网格（alpha 混合）。
	 *   每个覆盖层是主网格的 child，随主网格一起变换和释放。
	 * @param params - 瓦片加载参数或 Tile 对象
	 * @returns Promise<Mesh> 瓦片网格（可能包含覆盖层子节点）
	 */
	public async load(params: TileLoadParams | any): Promise<Mesh> {
		// 同步预留下载槽位（在任何 await 之前），将并发限制在 maxThreads 以内。
		// 之前的实现把 _downloadingThreads++ 放在 loadMaterial 的 await 之后，
		// 导致一帧内所有无模型瓦片在同一同步遍历中通过 _needsLoad 门槛后，
		// 计数器瞬间飙升至远超 maxThreads（峰值可达 28-40），
		// 从而在队列排空之前阻塞所有后续下载。
		await this._acquireSlot();

		try {
			// 提取瓦片坐标
			const x = params.x;
			const y = params.y;
			const z = params.z;

			// 应用投影坐标变换
			const coords = this.getTileCoords(x, y, z);

			// 加载几何体
			const geometry = await this.loadGeometry(coords);

			// 加载材质并应用（基底 + 多影像源覆盖层）
			const materials = await this.loadMaterial(coords);
			this._applyMaterials(geometry, materials, x, y, z);

			return geometry;
		} finally {
			this._releaseSlot();
		}
	}

	/**
	 * 等待可用的下载槽位（并发不超过 maxThreads）。
	 * 槽位在 load() 入口同步预留下载；满时进入等待队列，由 _releaseSlot 唤醒。
	 */
	private _acquireSlot(): Promise<void> {
		if (this._downloadingThreads < this.maxThreads) {
			this._downloadingThreads++;
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			this._slotWaiters.push(resolve);
		});
	}

	/** 释放下载槽位并唤醒下一个等待者 */
	private _releaseSlot(): void {
		this._downloadingThreads--;
		const next = this._slotWaiters.shift();
		if (next) {
			this._downloadingThreads++;
			next();
		}
	}

	/**
	 * 更新瓦片数据
	 * 当需要更新几何体时，创建新网格替代旧网格（避免操作私有属性）
	 * @param mesh - 要更新的瓦片网格
	 * @param params - 瓦片加载参数
	 * @param updateMaterial - 是否更新材质
	 * @param updateGeometry - 是否更新几何体
	 * @returns Promise<Mesh> 更新后的瓦片网格（可能是新实例）
	 */
	public async update(
		mesh: Mesh,
		params: TileLoadParams | any,
		updateMaterial: boolean,
		updateGeometry: boolean
	): Promise<Mesh> {
		const x = params.x;
		const y = params.y;
		const z = params.z;
		const coords = this.getTileCoords(x, y, z);

		let resultMesh = mesh;
		let materials: Material[] | undefined;

		// 先加载新材质（若需要），确保后续更新失败时旧状态仍完整
		if (updateMaterial) {
			materials = await this.loadMaterial(coords);
		}

		if (updateGeometry) {
			// 创建新网格替代旧网格，避免直接操作 _geometry 私有属性
			const newMesh = await this.loadGeometry(coords);
			newMesh.setParent(mesh.parent);
			newMesh.position.copyFrom(mesh.position);
			newMesh.scaling.copyFrom(mesh.scaling);
			newMesh.computeWorldMatrix(true);

			// 释放旧网格：base 材质共享时保留，其余材质/纹理与 overlays 一并释放
			const sharedBase =
				mesh.material !== undefined &&
				mesh.material !== null &&
				mesh.material !== this.backgroundMaterial &&
				this._isMaterialUsedElsewhere(mesh.material, mesh);
			if (mesh.material && mesh.material !== this.backgroundMaterial && !sharedBase) {
				const textures = mesh.material.getActiveTextures();
				for (const tex of textures) {
					TextureCache.release(tex);
				}
				mesh.material.dispose();
			}
			// 覆盖层子网格的材质/纹理一并释放（mesh.dispose 不负责材质，避免误伤缓存纹理）
			for (const child of mesh.getChildMeshes()) {
				if (child.material) {
					const textures = child.material.getActiveTextures();
					for (const tex of textures) {
						TextureCache.release(tex);
					}
					child.material.dispose();
				}
			}
			mesh.geometry?.dispose();
			// 共享 base 材质时避免递归释放材质/纹理（否则会连带销毁共享材质）；
			// 非共享时材质/纹理已在上方手动释放，这里只释放网格自身与子网格几何
			mesh.dispose(false, false);

			resultMesh = newMesh;
		} else if (updateMaterial) {
			// 仅更新材质：释放旧 base 材质（共享材质保留）与旧 overlays 子网格
			if (mesh.material && mesh.material !== this.backgroundMaterial && !this._isMaterialUsedElsewhere(mesh.material, mesh)) {
				const textures = mesh.material.getActiveTextures();
				for (const tex of textures) {
					TextureCache.release(tex);
				}
				mesh.material.dispose();
			}
			for (const child of [...mesh.getChildMeshes()]) {
				if (child.material) {
					const textures = child.material.getActiveTextures();
					for (const tex of textures) {
						TextureCache.release(tex);
					}
					child.material.dispose();
				}
				child.dispose();
			}
		}

		if (materials) {
			// 统一按 load() 语义重建材质层：基底用第一个影像，其余影像重建 overlays
			this._applyMaterials(resultMesh, materials, x, y, z);
		}

		return resultMesh;
	}

	/**
	 * 为网格应用材质：第一个影像设为基底材质，其余影像创建覆盖层（child of 基底网格）
	 * materials[0] = backgroundMaterial, materials[1..N] = imageMaterials
	 * @param mesh - 基底网格
	 * @param materials - 材质数组
	 * @param x - 瓦片 X 坐标（用于覆盖层命名）
	 * @param y - 瓦片 Y 坐标
	 * @param z - 瓦片层级
	 */
	private _applyMaterials(
		mesh: Mesh,
		materials: Material[],
		x: number,
		y: number,
		z: number
	): void {
		if (materials.length <= 1) {
			// 无影像源，使用背景材质
			mesh.material = materials[0];
			return;
		}

		// 第一个影像设为基底材质
		mesh.material = materials[1];

		// 其余影像创建覆盖层（child of 基底网格）
		for (let i = 2; i < materials.length; i++) {
			const overlay = TileGeometry.createFlatTile(
				`tile-${z}-${x}-${y}-overlay-${i}`,
				this._scene
			);
			overlay.material = materials[i];
			// 微小 Y 偏移防止 z-fighting（局部空间，会被父瓦片缩放放大）
			overlay.position.y = 0.0001 * i;
			overlay.setParent(mesh);
			overlay.computeWorldMatrix(true);
		}
	}

	/**
	 * 检查材质是否被其他网格引用（用于避免 dispose 共享材质）
	 * @param material - 待检查的材质
	 * @param excludeMesh - 排除的网格（通常是正在更新的网格）
	 * @returns 是否被其他网格引用
	 */
	private _isMaterialUsedElsewhere(material: Material, excludeMesh: Mesh): boolean {
		return this._scene.meshes.some((m) => m !== excludeMesh && m.material === material);
	}

	/**
	 * 卸载瓦片数据
	 * @param mesh - 要卸载的瓦片网格
	 */
	public unload(mesh: Mesh): void {
		if (mesh.material && mesh.material !== this.backgroundMaterial) {
			const textures = mesh.material.getActiveTextures();
			for (const tex of textures) {
				TextureCache.release(tex);
			}
			mesh.material.dispose();
		}
		for (const child of mesh.getChildMeshes()) {
			if (child.material) {
				const textures = child.material.getActiveTextures();
				for (const tex of textures) {
					TextureCache.release(tex);
				}
				child.material.dispose();
			}
		}
		mesh.geometry?.dispose();
		mesh.dispose();
	}

	/**
	 * 加载几何体
	 * 有 DEM 数据源时按 dataType 分发到几何体加载器（内置 terrain-rgb/lerc/
	 * quantized-mesh + 插件），否则创建平瓦片。DEM 过滤（minLevel/bounds 相交）
	 * 保留在此；超采样等细节在 loader 内部，行为与提炼前一致。
	 * @param coords - 变换后的瓦片坐标
	 * @returns Promise<Mesh> 瓦片Mesh
	 */
	private async loadGeometry(coords: {
		x: number;
		y: number;
		z: number;
		bounds: [number, number, number, number];
		lonLatBounds: [number, number, number, number];
	}): Promise<Mesh> {
		try {
			// 有地形数据源且层级 >= 最小层级且与数据源边界相交时加载地形；
			// 层级超过 demSource.maxLevel 时的超采样由内置 loader 内部处理
			// （terrain-rgb/lerc 裁父级 maxLevel 瓦片子区域；quantized-mesh 由
			// source 定位服务瓦片层级，不走 demZ/k/shift）。
			if (
				this._demSource &&
				coords.z >= this._demSource.minLevel &&
				this._intersectsBounds(this._demSource, coords.bounds)
			) {
				try {
					// 按 dataType 分发到几何体加载器（内置 + 插件一视同仁）
					const loader = loaderFactory.getGeometryLoader(this._demSource.dataType);
					const geometry = await loader.load({
						...coords,
						source: this._demSource,
						scene: this._scene,
						projection: this._projection,
					});
					// loader 返回 undefined（无 URL 等跳过）：回退平瓦片
					if (geometry) {
						return geometry;
					}
				} catch (error) {
					if (this.debug > 0 && this._demFailWarned < 3) {
						this._demFailWarned++;
						console.warn(`DEM load failed for tile ${coords.z}-${coords.x}-${coords.y}, fallback to flat:`, error);
					}
				}
			}

			// 无 DEM 或 DEM 加载失败：创建平瓦片（带边缘出血，消除深缩放共享边缝隙）
			return TileGeometry.createFlatTile(
				`tile-${coords.z}-${coords.x}-${coords.y}-geometry`,
				this._scene,
				1,
				1,
				TILE_UV_BLEED
			);
		} catch (error) {
			if (this.debug > 0) {
				console.error('Load Geometry Error:', error);
			}
			return TileGeometry.createFlatTile('error-geometry', this._scene, 1, 1, TILE_UV_BLEED);
		}
	}

	/**
	 * 加载材质
	 * 与 three-tile 行为一致：阻塞等待纹理下载完成后再返回材质。
	 * 支持超级别回退加载：当请求级别 > 数据源 maxLevel 时，从最大级别瓦片截取子区域。
	 * 支持纹理边界裁剪：当瓦片部分超出数据源 bounds 时，将超出部分设为透明。
	 * @param coords - 变换后的瓦片坐标
	 * @returns Promise<Material[]> 材质数组
	 */
	private async loadMaterial(coords: {
		x: number;
		y: number;
		z: number;
		bounds: [number, number, number, number];
		lonLatBounds: [number, number, number, number];
	}): Promise<Material[]> {
		const materials: Material[] = [this.backgroundMaterial];

		// 过滤符合条件的影像源（层级 >= minLevel 且与数据源边界相交）
		const sources = this._imgSource.filter(
			source =>
				coords.z >= source.minLevel &&
				this._intersectsBounds(source, coords.bounds)
		);

		// 加载每个数据源的材质：按 dataType 分发到材质加载器（内置 image/mvt + 插件）。
		// 超级别回退/纹理缓存/边界裁剪等细节在 loader 内部，行为与提炼前一致。
		for (const source of sources) {
			try {
				const loader = loaderFactory.getMaterialLoader(source.dataType);
				const material = await loader.load({
					...coords,
					source,
					scene: this._scene,
					projection: this._projection,
				});
				// loader 返回 undefined（URL 缺失/纹理加载失败/层级不符）：静默跳过该源
				if (material) {
					materials.push(material);
				}
			} catch (error) {
				if (this.debug > 0) {
					console.error('Load Material Error:', error);
				}
			}
		}

		return materials;
	}

	/**
	 * 检查瓦片是否与数据源边界相交
	 * @param source - 数据源
	 * @param tileBounds - 瓦片投影边界
	 * @returns 是否相交
	 */
	private _intersectsBounds(
		source: ISource,
		tileBounds: [number, number, number, number]
	): boolean {
		if (!source._projectionBounds) {
			return true; // 如果数据源没有设置边界，默认相交
		}

		const mapBounds = source._projectionBounds;
		return (
			tileBounds[2] >= mapBounds[0] &&
			tileBounds[3] >= mapBounds[1] &&
			tileBounds[0] <= mapBounds[2] &&
			tileBounds[1] <= mapBounds[3]
		);
	}
}
