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
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';

import type { ITileLoader, TileLoadParams } from './ITileLoader.js';
import type { IProjection } from '../projection/IProjection.js';
import type { ISource } from '../source/ISource.js';
import { TileGeometry } from '../geometry/TileGeometry.js';
import { TileMaterial } from '../material/TileMaterial.js';
import { TerrainRGBParser } from './TerrainRGBLoader.js';
import { TerrainWorkerPool } from './WorkerPool.js';
import { TextureCache } from './TextureCache.js';

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

	/** 地形瓦片分段数（默认 64，平衡精度与性能） */
	public terrainSegments: number = 64;

	/** Martini 最大误差阈值（米）—— 值越大三角形越少（性能高），值越小越精确 */
	public martiniMaxError: number = 10;

	/** 是否使用 Martini 自适应三角网（默认 true，需要 DEM 数据为 2^n+1 尺寸） */
	public useMartini: boolean = true;

	/** 是否使用 Worker 池解析地形数据（默认 true，避免阻塞主线程） */
	public useWorkerParse: boolean = true;

	/**
	 * 加载几何体
	 * 有 DEM 数据源时加载真实地形，否则创建平瓦片
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
			// 层级超过 demSource.maxLevel 时做 DEM 超采样（裁父级 maxLevel 瓦片的子区域）
			if (
				this._demSource &&
				coords.z >= this._demSource.minLevel &&
				this._intersectsBounds(this._demSource, coords.bounds)
			) {
				try {
					// DEM 超采样：z 超过 demSource.maxLevel 时，取父级 maxLevel 瓦片并裁剪
					// 本瓦片的子区域，地形延续到更深层级，避免深缩放"突然变平"
					const demZ = Math.min(coords.z, this._demSource.maxLevel);
					const k = coords.z - demZ;
					const shift = 1 << k; // k=0 时为 1（未超采样），URL 即本瓦片
					const demX = Math.floor(coords.x / shift);
					const demY = Math.floor(coords.y / shift);
					const url = this._demSource.getUrl(demX, demY, demZ);
					if (url) {
						const imgData = await this._loadImageData(url);

						// 使用 Worker 池或主线程解析地形数据
						let dem = this.useWorkerParse
							? await TerrainWorkerPool.parse(imgData)
							: TerrainRGBParser.parse(imgData);

						if (k > 0) {
							dem = this._cropDemQuadrant(
								dem,
								k,
								coords.x - demX * shift, // 本瓦片在父瓦片内的列象限（向东递增）
								coords.y - demY * shift // 行象限（向南递增）
							);
						}
						
						// DEM 高程为原始米制（与 three-tile 一致），直接使用，无需缩放
						const heightScale = 1;
						const skirtHeight = 100; // 米制裙边高度

						// 瓦片世界尺寸缩放系数 S = mapWidth / 2^z（米/瓦片单位）。
						// 瓦片几何位于倾斜局部空间（X/Z 单位 1、Y 米制），而节点世界矩阵为
						// diag(S,1,S)。计算法线时必须先在"S 倍"的世界尺寸空间做（否则
						// X/Z 跨度 ~1/256 会把法线压成水平），并据此映射回局部空间存储。
						const worldScale = this._projection.mapWidth / Math.pow(2, coords.z);

						// 检查 DEM 数据是否为 2^n+1 尺寸（Martini 要求）
						const gridSize = Math.floor(Math.sqrt(dem.length));
						const isPerfectSquare = gridSize * gridSize === dem.length;
						const isMartiniCompatible =
							this.useMartini &&
							isPerfectSquare &&
							((gridSize - 1) & (gridSize - 2)) === 0; // 2^n+1 检测
						
						if (isMartiniCompatible) {
							// 使用 Martini RTIN 自适应三角网
							return TileGeometry.createMartiniTile(
								`tile-${coords.z}-${coords.x}-${coords.y}-geometry`,
								this._scene,
								dem,
								this.martiniMaxError,
								skirtHeight,
								heightScale,
								worldScale
							);
						}
						
						// 回退：DEM 非正方形时无法确定行距，降级为平瓦片（防御性兜底）
						if (!isPerfectSquare) {
							if (this.debug > 0) {
								console.warn(`DEM data is not square (length=${dem.length}), fallback to flat tile.`);
							}
							return TileGeometry.createFlatTile(
								`tile-${coords.z}-${coords.x}-${coords.y}-geometry`,
								this._scene,
								1,
								1,
								TILE_UV_BLEED
							);
						}

						// 回退：使用固定分段网格
						// DEM 为 gridSize×gridSize，第 0 行在北；几何网格 gy=0 在南 →
						// 按 (segments+1)² 重采样并翻转行，与 createTile 的 heights 布局一致
						const segments = this.terrainSegments;
						const grid = segments + 1;
						const heights = new Float32Array(grid * grid);
						for (let gy = 0; gy < grid; gy++) {
							for (let gx = 0; gx < grid; gx++) {
								// 几何南边(gy=0) 对应 DEM 最后一行（北行翻转）
								const demRow = Math.round(((segments - gy) * (gridSize - 1)) / segments);
								const demCol = Math.round((gx * (gridSize - 1)) / segments);
								heights[gy * grid + gx] = dem[demRow * gridSize + demCol] || 0;
							}
						}

						return TileGeometry.createTile(
							`tile-${coords.z}-${coords.x}-${coords.y}-geometry`,
							{
								scene: this._scene,
								width: 1,
								height: 1,
								segmentsW: segments,
								segmentsH: segments,
								heights,
								skirtHeight,
								worldScale,
							}
						);
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
	 * 加载图像像素数据（用于 DEM 解析）
	 * @param url - 图像 URL
	 * @returns Promise<Uint8ClampedArray> RGBA 像素数据
	 */
	private _loadImageData(url: string): Promise<Uint8ClampedArray> {
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

			// 安全超时：DEM 图片挂起时若无限等待，load() 的下载槽位会永久泄漏，
			// 10 个槽位最终全部卡死（与 _loadImageElement 修复的同类问题）。
			const timeout = setTimeout(() => {
				if (this.debug > 0) {
					console.warn(`DEM image load timeout for ${url}`);
				}
				// 中止挂起的下载
				img.src = '';
				settle(() => reject(new Error(`DEM image load timeout: ${url}`)));
			}, 15000);

			img.onload = () => {
				try {
					const canvas = document.createElement('canvas');
					canvas.width = img.width;
					canvas.height = img.height;
					const ctx = canvas.getContext('2d');
					if (!ctx) {
						settle(() => reject(new Error('Failed to get 2D context')));
						return;
					}
					ctx.drawImage(img, 0, 0);
					const imgData = ctx.getImageData(0, 0, img.width, img.height);
					settle(() => resolve(imgData.data));
				} catch (e) {
					settle(() => reject(e as Error));
				}
			};

			img.onerror = () => {
				settle(() => reject(new Error(`Failed to load DEM image: ${url}`)));
			};

			img.src = url;
		});
	}

	/**
	 * 从父级 DEM 网格裁剪出子瓦片的子区域（DEM 超采样）
	 * @param dem - 父级 DEM 高程数组（第 0 行在北）
	 * @param k - 超采样级差（本瓦片 z 与父级 z 的差值）
	 * @param subX - 本瓦片在父瓦片内的列象限（0..2^k-1，向东递增）
	 * @param subY - 本瓦片在父瓦片内的行象限（0..2^k-1，向南递增）
	 * @returns 裁剪后的高程数组（子网格尺寸恒为 2^n+1，Martini 兼容）
	 */
	private _cropDemQuadrant(dem: Float32Array, k: number, subX: number, subY: number): Float32Array {
		const parentSize = Math.floor(Math.sqrt(dem.length));
		const div = Math.pow(2, k);
		// 子网格在父网格中的行/列范围（两端均含）；subY 向南递增，而 DEM 第 0 行在北，
		// 故从父级 row0 起按序连续截取即可保持"行 0 在北"约定，Martini 内部翻转不变。
		const col0 = Math.round((subX * (parentSize - 1)) / div);
		const col1 = Math.round(((subX + 1) * (parentSize - 1)) / div);
		const row0 = Math.round((subY * (parentSize - 1)) / div);
		const row1 = Math.round(((subY + 1) * (parentSize - 1)) / div);
		const cols = col1 - col0 + 1;
		const rows = row1 - row0 + 1;
		const out = new Float32Array(cols * rows);
		for (let r = 0; r < rows; r++) {
			const srcRow = row0 + r;
			for (let c = 0; c < cols; c++) {
				out[r * cols + c] = dem[srcRow * parentSize + col0 + c];
			}
		}
		return out;
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

		// 加载每个数据源的材质
		for (const source of sources) {
			try {
				// 获取安全的瓦片 URL 和裁剪范围（处理超级别回退）
				const { url, clipBounds } = this._getSafeTileUrlAndBounds(
					source, coords.x, coords.y, coords.z
				);

				if (!url) {
					continue;
				}

				// 阻塞等待纹理下载完成（下载槽位已在 load() 入口统一预留）
				let texture = await this._loadTexture(url, coords);

				// 加载失败/超时（返回 undefined）：跳过该影像源，回退背景材质
				if (!texture) {
					continue;
				}

				// 如果需要裁剪（超级别回退或边界裁剪）
				const needsClip = clipBounds[0] !== 0 || clipBounds[1] !== 0 ||
					clipBounds[2] !== 1 || clipBounds[3] !== 1;
				const needsBoundsClip = this._needsBoundsClip(source, coords.bounds);

				if (needsClip || needsBoundsClip) {
					const clipped = await this._clipTexture(
						texture, url, clipBounds, source, coords.bounds
					);
					// 裁剪产物替换源纹理：本瓦片不再持有源纹理，交还缓存供其他瓦片复用
					if (clipped !== texture) {
						TextureCache.release(texture);
						texture = clipped;
					}
				}

				// 创建材质
				const material = TileMaterial.createTileMaterial({
					scene: this._scene,
					name: `tile-${coords.z}-${coords.x}-${coords.y}-material`,
					diffuseTexture: texture,
					opacity: source.opacity ?? 1,
					transparent: source.transparent ?? (needsClip || needsBoundsClip),
				});

				materials.push(material);
			} catch (error) {
				if (this.debug > 0) {
					console.error('Load Material Error:', error);
				}
			}
		}

		return materials;
	}

	/**
	 * 获取安全的瓦片 URL 和裁剪范围
	 * 当请求级别 > 数据源 maxLevel 时，回退到最大级别瓦片并计算子区域裁剪坐标
	 * @param source - 数据源
	 * @param x - 瓦片 X 坐标
	 * @param y - 瓦片 Y 坐标
	 * @param z - 瓦片层级
	 * @returns url 和 clipBounds [0-1 范围的裁剪区域]
	 */
	private _getSafeTileUrlAndBounds(
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
		const clipBounds: [number, number, number, number] = [
			offsetX, offsetY,
			offsetX + size, offsetY + size
		];

		return { url, clipBounds };
	}

	/**
	 * 检查瓦片是否需要边界裁剪（部分超出数据源 bounds）
	 */
	private _needsBoundsClip(
		source: ISource,
		tileBounds: [number, number, number, number]
	): boolean {
		if (!source._projectionBounds) return false;
		const mb = source._projectionBounds;
		// 瓦片完全在数据源范围内，无需裁剪
		return !(
			mb[0] <= tileBounds[0] &&
			mb[1] <= tileBounds[1] &&
			mb[2] >= tileBounds[2] &&
			mb[3] >= tileBounds[3]
		);
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
		tileBounds: [number, number, number, number]
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
			const needsSubClip = clipBounds[0] !== 0 || clipBounds[1] !== 0 ||
				clipBounds[2] !== 1 || clipBounds[3] !== 1;

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
			if (this._needsBoundsClip(source, tileBounds) && source._projectionBounds) {
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
			const clippedTexture = new Texture(null, this._scene);
			clippedTexture.updateURL(canvas.toDataURL());

			// 原始纹理由 TextureCache 持有，供其他瓦片复用，不在此处释放
			// （裁剪产物是独立纹理，随瓦片卸载正常 dispose）。

			return clippedTexture;
		} catch (error) {
			if (this.debug > 0) {
				console.warn('Texture clip failed, using original:', error);
			}
			return texture;
		}
	}

	/**
	 * 加载图像元素（用于 Canvas 裁剪操作）
	 * 带安全超时：网络不可达/挂起时若无限等待，load() 的下载槽位会永久泄漏，
	 * 最终 10 个槽位全部被卡死，整个地图停止加载（表现为瓦片永远加载不完）。
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

	/**
	 * 加载纹理（Promise 包装，阻塞等待完成）
	 * 使用 settled 标志确保只结算一次（超时/成功/失败仅其一）
	 * 失败/超时时 resolve(undefined)：让该影像源被跳过，瓦片回退到背景材质，
	 * 而不是用一张黑图并把瓦片标记为「已加载」（黑图会被 updateVisibility 当成
	 * 子瓦片已加载，父瓦片因此不会填充间隙，留下空洞）。
	 * @param url - 纹理 URL
	 * @param coords - 瓦片坐标（用于调试）
	 * @returns Promise<Texture | undefined>
	 */
	private _loadTexture(
		url: string,
		coords: { x: number; y: number; z: number }
	): Promise<Texture | undefined> {
		// 命中缓存：直接复用已上传 GPU 的纹理，跳过网络下载 + 解码 + 上传。
		// 旋转/缩放 churn 时同一 URL 的瓦片反复进出视锥，缓存消除了加载风暴。
		const cached = TextureCache.get(url);
		if (cached) {
			// 本瓦片开始持有该纹理（卸载时对应 release 一次）
			TextureCache.retain(cached);
			return Promise.resolve(cached);
		}

		return new Promise<Texture | undefined>((resolve) => {
			let settled = false;
			let texture: Texture | undefined;

			const fail = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				// 释放半成品纹理（new Texture 已加入 scene.textures，不释放会泄漏）
				if (texture) {
					texture.dispose();
				}
				resolve(undefined);
			};

			const succeed = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				// 下载成功后入缓存（下次同 URL 瓦片直接复用），并记录本瓦片的持有
				if (texture) {
					TextureCache.put(url, texture);
					TextureCache.retain(texture);
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
					this._scene,
					true,   // noMipmap：瓦片纹理使用双线性（无 mipmap）过滤（见 TileMaterial），
					        // 生成 mipmap 金字塔只浪费显存与上传带宽，故直接关闭。
					undefined,  // invertY
					Constants.TEXTURE_BILINEAR_SAMPLINGMODE,  // 与 TileMaterial.updateSamplingMode 一致
					succeed,
					(_message?: string, _exception?: any) => {
						if (this.debug > 0) {
							console.error(`Texture load error for tile ${coords.z}-${coords.x}-${coords.y}:`, _message);
						}
						fail();
					}
				);
			} catch (e) {
				// Texture 构造函数抛出异常时仍然需要结算计数器
				fail();
			}
		});
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
