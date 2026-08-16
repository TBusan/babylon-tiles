/**
 * @description: 瓦片加载器实现
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';

import type { ITileLoader, TileLoadParams } from './ITileLoader.js';
import type { Tile } from '../tile/Tile.js';
import type { IProjection } from '../projection/IProjection.js';
import type { ISource } from '../source/ISource.js';
import { TileGeometry } from '../geometry/TileGeometry.js';
import { TileMaterial } from '../material/TileMaterial.js';
import type { TextureCacheImpl } from './TextureCache.js';
import { getCacheForEngine } from './TextureCache.js';
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

	/** 纹理缓存（Engine 作用域；内置 loader 经 params.cache 共享） */
	private readonly _textureCache: TextureCacheImpl;

	/** 材质引用计数（acquire/release；count>1 视为共享，不释放/不淡入） */
	private readonly _materialUsers = new Map<Material, number>();

	/** 持有本 loader 的地图数（背景材质生命周期：归零才 dispose） */
	private _mapUsers = 0;

	/** 是否已 dispose（防重复释放） */
	private _disposed = false;

	private _bounds: [number, number, number, number] = [-180, -85, 180, 85];

	/** 场景 */
	private readonly _scene: Scene;

	/** 背景材质 */
	public readonly backgroundMaterial: StandardMaterial;

	/** 调试标志 */
	public debug = 0;

	/**
	 * 构造函数
	 * @param scene - Babylon.js 场景
	 * @param projection - 投影对象
	 * @param textureCache - 纹理缓存（默认按 Engine 作用域获取；同引擎多图共享）
	 */
	constructor(scene: Scene, projection: IProjection, textureCache?: TextureCacheImpl) {
		this._scene = scene;
		this._projection = projection;
		this._textureCache = textureCache ?? getCacheForEngine(scene.getEngine());

		// 确保内置加载器（image/mvt/terrain-rgb/lerc/quantized-mesh）已注册。
		// 幂等：用户先注册的同名 dataType 自定义 loader 不会被覆盖。
		loaderFactory.ensureBuiltinLoaders();

		// 创建背景材质（loader 永久持有；见 releaseMesh/_releaseMaterial 背景材质特判）
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
		this._imgSource.forEach((source) => {
			source._projectionBounds = proj.getProjBoundsFromLonLat(source.bounds || this._bounds);
		});
	}

	/**
	 * 更新地形数据源的投影范围
	 */
	private _updateDemProjBounds(): void {
		const proj = this._projection;
		if (this._demSource) {
			this._demSource._projectionBounds = proj.getProjBoundsFromLonLat(this._demSource.bounds || this._bounds);
		}
	}

	/**
	 * 获取瓦片经过投影变换后的坐标和边界
	 * @param x 瓦片X坐标
	 * @param y 瓦片Y坐标（四叉树坐标，y=0 为北行，与标准 XYZ 瓦片 URL 一致）
	 * @param z 瓦片层级
	 * @returns 变换后的坐标和边界
	 */
	private getTileCoords(
		x: number,
		y: number,
		z: number
	): {
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
	public async load(params: TileLoadParams | Tile): Promise<Mesh> {
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
		params: TileLoadParams | Tile,
		updateMaterial: boolean,
		updateGeometry: boolean
	): Promise<Mesh> {
		const x = params.x;
		const y = params.y;
		const z = params.z;
		const coords = this.getTileCoords(x, y, z);

		let resultMesh = mesh;
		let materials: Material[] | undefined;

		// update 同样会触发纹理/几何网络下载，需与 load 一致地占用下载槽位，
		// 否则会绕过 maxThreads 并发限制
		await this._acquireSlot();
		try {
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

				// 释放旧网格：材质经引用计数（共享材质 count>1 保留），几何/子网格随 dispose 释放
				this.releaseMesh(mesh);

				resultMesh = newMesh;
			} else if (updateMaterial) {
				// 仅更新材质：释放旧 base 材质（共享材质保留）与旧 overlays 子网格
				this._releaseMaterialsFromMesh(mesh);
				for (const child of [...mesh.getChildMeshes()]) {
					child.dispose();
				}
			}

			if (materials) {
				// 统一按 load() 语义重建材质层：基底用第一个影像，其余影像重建 overlays
				this._applyMaterials(resultMesh, materials, x, y, z);
			}
		} finally {
			this._releaseSlot();
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
	private _applyMaterials(mesh: Mesh, materials: Material[], x: number, y: number, z: number): void {
		if (materials.length <= 1) {
			// 无影像源，使用背景材质
			mesh.material = materials[0];
			return;
		}

		// 第一个影像设为基底材质
		mesh.material = materials[1];
		this._acquireMaterial(materials[1]);

		// 其余影像创建覆盖层（child of 基底网格）
		for (let i = 2; i < materials.length; i++) {
			const overlay = TileGeometry.createFlatTile(`tile-${z}-${x}-${y}-overlay-${i}`, this._scene);
			overlay.material = materials[i];
			this._acquireMaterial(materials[i]);
			// 微小 Y 偏移防止 z-fighting（局部空间，会被父瓦片缩放放大）
			overlay.position.y = 0.0001 * i;
			overlay.setParent(mesh);
			overlay.computeWorldMatrix(true);
		}
	}

	/**
	 * 卸载瓦片数据（按引用计数释放，见 releaseMesh）
	 * @param mesh - 要卸载的瓦片网格
	 */
	public unload(mesh: Mesh): void {
		this.releaseMesh(mesh);
	}

	/**
	 * 按引用计数释放瓦片网格（材质/纹理/几何统一收口）。
	 * 基底材质 + 多影像覆盖层材质逐个 release：count 归零才 dispose（材质与其纹理），
	 * count > 0 表示仍被其他瓦片共享（如插件直接挂载的共享材质），保留。
	 * @param mesh - 要释放的瓦片网格
	 */
	public releaseMesh(mesh: Mesh): void {
		if (!mesh) return;
		this._releaseMaterialsFromMesh(mesh);
		mesh.geometry?.dispose();
		mesh.dispose();
	}

	/** 释放网格所有材质（基底 + 覆盖层），不释放网格本身（仅更新材质时复用网格） */
	private _releaseMaterialsFromMesh(mesh: Mesh): void {
		for (const child of mesh.getChildMeshes()) {
			this._releaseMaterial(child.material, child);
		}
		this._releaseMaterial(mesh.material, mesh);
	}

	/** 材质是否被多个瓦片共享（count > 1）；背景材质恒共享（loader 永久持有） */
	public isMaterialShared(material: Material): boolean {
		if (material === this.backgroundMaterial) {
			return true;
		}
		return (this._materialUsers.get(material) ?? 0) > 1;
	}

	/** 瓦片持有材质：+1（背景材质不计数，由 loader 永久持有） */
	private _acquireMaterial(material: Material | null | undefined): void {
		if (!material || material === this.backgroundMaterial) {
			return;
		}
		this._materialUsers.set(material, (this._materialUsers.get(material) ?? 0) + 1);
	}

	/**
	 * 瓦片释放材质：−1；归零时释放材质引用的纹理（交还缓存）并 dispose 材质。
	 * 背景材质由 loader 永久持有，不参与计数。
	 * @param excludeMesh 正在释放的网格（未跟踪材质回退 O(n) 扫描时排除自身，
	 *                    避免误判「仍在被自己使用」而泄漏）
	 */
	private _releaseMaterial(material: Material | null | undefined, excludeMesh?: AbstractMesh | null): void {
		if (!material || material === this.backgroundMaterial) {
			return;
		}
		const before = this._materialUsers.get(material) ?? 0;
		// debug 断言：refcount 与一次 O(n) 扫描一致（含正在释放的网格——每次持有对应一个
		// 场景网格），防插件直接挂材质导致漏计。仅 debug>=2 时开启，热路径零开销。
		if (this.debug >= 2) {
			const actual = this._scene.meshes.filter((m) => m.material === material).length;
			if (before !== actual) {
				console.warn(`[TileLoader] material refcount mismatch (tracked=${before}, actual=${actual}): ${material.name}`);
			}
		}
		if (before <= 0) {
			// 未跟踪的材质（插件/外部直接挂载，未走 _applyMaterials 计数）：按单引用释放。
			// 兜底：若仍被其他网格使用（共享材质），保留——由插件/其他持有者管理，
			// 对齐旧实现的 _isSharedMaterial 排除自身语义。
			const stillUsed = this._scene.meshes.some((m) => m !== excludeMesh && m.material === material);
			if (stillUsed) {
				return;
			}
			this._disposeMaterial(material);
			return;
		}
		const n = before - 1;
		if (n <= 0) {
			this._materialUsers.delete(material);
			this._disposeMaterial(material);
		} else {
			this._materialUsers.set(material, n);
		}
	}

	/** 释放材质及其引用的纹理（交还缓存供复用） */
	private _disposeMaterial(material: Material): void {
		const textures = material.getActiveTextures();
		for (const tex of textures) {
			this._textureCache.release(tex);
		}
		material.dispose();
	}

	/** 地图持有本 loader：+1（背景材质/资源生命周期由最后一个持有者释放） */
	public retain(): void {
		this._mapUsers++;
	}

	/** 地图释放本 loader：引用归零时 dispose（释放背景材质与残留共享材质） */
	public release(): void {
		this._mapUsers--;
		if (this._mapUsers <= 0) {
			this.dispose();
		}
	}

	/** 释放 loader 资源：背景材质 + 残留共享材质（正常路径下瓦片已全部 releaseMesh） */
	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		if (this.backgroundMaterial) {
			this.backgroundMaterial.dispose();
		}
		// 兜底：仍有引用残留的共享材质直接释放（纹理留在 Engine 作用域缓存，不清理）
		for (const material of this._materialUsers.keys()) {
			material.dispose();
		}
		this._materialUsers.clear();
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
						cache: this._textureCache,
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
			(source) => coords.z >= source.minLevel && this._intersectsBounds(source, coords.bounds)
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
					cache: this._textureCache,
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
	private _intersectsBounds(source: ISource, tileBounds: [number, number, number, number]): boolean {
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
