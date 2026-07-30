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

import type { ITileLoader, TileLoadParams } from './ITileLoader.js';
import type { IProjection } from '../projection/IProjection.js';
import type { ISource } from '../source/ISource.js';
import { TileGeometry } from '../geometry/TileGeometry.js';
import { TileMaterial } from '../material/TileMaterial.js';
import { TerrainRGBParser } from './TerrainRGBLoader.js';
import { TerrainWorkerPool } from './WorkerPool.js';

/**
 * 瓦片加载器类
 * 负责加载瓦片的几何体和材质，包含投影坐标变换
 */
export class TileLoader implements ITileLoader {
	/** 当前实例的下载计数（非 static，避免多地图实例互相干扰） */
	private _downloadingThreads = 0;

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
		// getProjBoundsFromXYZ 内部公式假设 y=0 为南行（TMS 约定），
		// 而四叉树/标准 XYZ 的 y=0 为北行，需要翻转 Y 以获取正确的投影范围。
		const flippedY = Math.pow(2, z) - 1 - y;
		// 计算瓦片投影范围（使用翻转后的 Y）
		const bounds = this._projection.getProjBoundsFromXYZ(x, flippedY, z);
		// 计算瓦片经纬度范围（使用翻转后的 Y）
		const lonLatBounds = this._projection.getLonLatBoundsFromXYZ(x, flippedY, z);

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
		// 提取瓦片坐标
		const x = params.x;
		const y = params.y;
		const z = params.z;

		// 应用投影坐标变换
		const coords = this.getTileCoords(x, y, z);

		// 加载几何体
		const geometry = await this.loadGeometry(coords);

		// 加载材质
		const materials = await this.loadMaterial(coords);

		// materials[0] = backgroundMaterial, materials[1..N] = imageMaterials
		if (materials.length <= 1) {
			// 无影像源，使用背景材质
			geometry.material = materials[0];
		} else if (materials.length === 2) {
			// 单个影像源，直接设置
			geometry.material = materials[1];
		} else {
			// 多个影像源：第一个影像设为基底材质，其余创建覆盖层
			geometry.material = materials[1];

			// 为每个额外影像层创建覆盖网格（child of 基底网格）
			for (let i = 2; i < materials.length; i++) {
				const overlay = TileGeometry.createFlatTile(
					`tile-${z}-${x}-${y}-overlay-${i}`,
					this._scene
				);
				overlay.material = materials[i];
				// 微小 Y 偏移防止 z-fighting（局部空间，会被父瓦片缩放放大）
				overlay.position.y = 0.0001 * i;
				overlay.setParent(geometry);
				overlay.computeWorldMatrix(true);
			}
		}

		return geometry;
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

		if (updateGeometry) {
			// 创建新网格替代旧网格，避免直接操作 _geometry 私有属性
			const newMesh = await this.loadGeometry(coords);
			newMesh.setParent(mesh.parent);
			newMesh.position.copyFrom(mesh.position);
			newMesh.scaling.copyFrom(mesh.scaling);
			newMesh.computeWorldMatrix(true);

			// 释放旧网格
			if (mesh.material && mesh.material !== this.backgroundMaterial) {
				const textures = mesh.material.getActiveTextures();
				for (const tex of textures) {
					tex.dispose();
				}
				mesh.material.dispose();
			}
			mesh.geometry?.dispose();
			mesh.dispose();

			resultMesh = newMesh;
		}

		if (updateMaterial) {
			await this.updateMaterialForMesh(resultMesh, coords);
		}

		return resultMesh;
	}

	/**
	 * 更新网格的材质
	 * 注意：不能 dispose 共享的背景材质（backgroundMaterial）
	 */
	private async updateMaterialForMesh(
		mesh: Mesh,
		coords: { x: number; y: number; z: number; bounds: [number, number, number, number]; lonLatBounds: [number, number, number, number] }
	): Promise<void> {
		const materials = await this.loadMaterial(coords);
		// 使用最后一个材质（最顶层影像），与 load() 逻辑一致
		const newMaterial = materials.length > 1 ? materials[materials.length - 1] : materials[0];
		if (mesh.material) {
			const oldMaterial = mesh.material;
			mesh.material = newMaterial;
			// 仅释放非共享材质（背景材质是全局共享的，不能 dispose）
			if (oldMaterial !== this.backgroundMaterial) {
				const textures = oldMaterial.getActiveTextures();
				for (const tex of textures) {
					tex.dispose();
				}
				oldMaterial.dispose();
			}
		} else {
			mesh.material = newMaterial;
		}
	}

	/**
	 * 卸载瓦片数据
	 * @param mesh - 要卸载的瓦片网格
	 */
	public unload(mesh: Mesh): void {
		if (mesh.material) {
			mesh.material.dispose();
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
			// 如果有地形数据源且层级 >= 最小层级且与数据源边界相交
			if (
				this._demSource &&
				coords.z >= this._demSource.minLevel &&
				coords.z <= this._demSource.maxLevel &&
				this._intersectsBounds(this._demSource, coords.bounds)
			) {
				this._downloadingThreads++;

				try {
					const url = this._demSource.getUrl(coords.x, coords.y, coords.z);
					if (url) {
						const imgData = await this._loadImageData(url);
						
						// 使用 Worker 池或主线程解析地形数据
						const dem = this.useWorkerParse
							? await TerrainWorkerPool.parse(imgData)
							: TerrainRGBParser.parse(imgData);
						
						// 高程归一化：将米制高程转换为地图局部坐标空间
						const mapWidth = this._projection.mapWidth;
						const heightScale = 1 / mapWidth;
						const skirtHeight = 100 / mapWidth;
						
						// 检查 DEM 数据是否为 2^n+1 尺寸（Martini 要求）
						const gridSize = Math.floor(Math.sqrt(dem.length));
						const isMartiniCompatible =
							this.useMartini &&
							gridSize * gridSize === dem.length &&
							((gridSize - 1) & (gridSize - 2)) === 0; // 2^n+1 检测
						
						if (isMartiniCompatible) {
							// 使用 Martini RTIN 自适应三角网
							return TileGeometry.createMartiniTile(
								`tile-${coords.z}-${coords.x}-${coords.y}-geometry`,
								this._scene,
								dem,
								this.martiniMaxError,
								skirtHeight,
								heightScale
							);
						}
						
						// 回退：使用固定分段网格
						const heights = new Float32Array(dem.length);
						for (let i = 0; i < dem.length; i++) {
							heights[i] = dem[i] * heightScale;
						}
						
						const segments = this.terrainSegments;
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
							}
						);
					}
				} catch (error) {
					if (this.debug > 0) {
						console.warn(`DEM load failed for tile ${coords.z}-${coords.x}-${coords.y}, fallback to flat:`, error);
					}
				} finally {
					this._downloadingThreads--;
				}
			}

			// 无 DEM 或 DEM 加载失败：创建平瓦片
			return TileGeometry.createFlatTile(
				`tile-${coords.z}-${coords.x}-${coords.y}-geometry`,
				this._scene
			);
		} catch (error) {
			if (this.debug > 0) {
				console.error('Load Geometry Error:', error);
			}
			return TileGeometry.createFlatTile('error-geometry', this._scene);
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

			img.onload = () => {
				const canvas = document.createElement('canvas');
				canvas.width = img.width;
				canvas.height = img.height;
				const ctx = canvas.getContext('2d');

				if (!ctx) {
					reject(new Error('Failed to get 2D context'));
					return;
				}

				ctx.drawImage(img, 0, 0);
				const imgData = ctx.getImageData(0, 0, img.width, img.height);
				resolve(imgData.data);
			};

			img.onerror = () => {
				reject(new Error(`Failed to load DEM image: ${url}`));
			};

			img.src = url;
		});
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

				this._downloadingThreads++;

				// 阻塞等待纹理下载完成
				let texture = await this._loadTexture(url, coords);

				// 如果需要裁剪（超级别回退或边界裁剪）
				const needsClip = clipBounds[0] !== 0 || clipBounds[1] !== 0 ||
					clipBounds[2] !== 1 || clipBounds[3] !== 1;
				const needsBoundsClip = this._needsBoundsClip(source, coords.bounds);

				if (needsClip || needsBoundsClip) {
					texture = await this._clipTexture(
						texture, url, clipBounds, source, coords.bounds
					);
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

			// 释放原始纹理
			texture.dispose();

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
	 */
	private _loadImageElement(url: string): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
			img.src = url;
		});
	}

	/**
	 * 加载纹理（Promise 包装，阻塞等待完成）
	 * 使用 settled 标志确保 downloadingThreads 计数器仅递减一次
	 * @param url - 纹理 URL
	 * @param coords - 瓦片坐标（用于调试）
	 * @returns Promise<Texture>
	 */
	private _loadTexture(
		url: string,
		coords: { x: number; y: number; z: number }
	): Promise<Texture> {
		return new Promise<Texture>((resolve) => {
			let settled = false;

			const settle = (tex: Texture) => {
				if (!settled) {
					settled = true;
					clearTimeout(timeout);
					this._downloadingThreads--;
					resolve(tex);
				}
			};

			// 安全超时：防止纹理加载永不完成导致 _isLoading 卡死
			const timeout = setTimeout(() => {
				if (this.debug > 0) {
					console.warn(`Texture load timeout for tile ${coords.z}-${coords.x}-${coords.y}`);
				}
				settle(texture);
			}, 15000);

			let texture: Texture;
			try {
				texture = new Texture(
					url,
					this._scene,
					undefined,  // noMipmap
					undefined,  // invertY
					undefined,  // samplingMode
					() => settle(texture),
					(_message?: string, _exception?: any) => {
						if (this.debug > 0) {
							console.error(`Texture load error for tile ${coords.z}-${coords.x}-${coords.y}:`, _message);
						}
						settle(texture);
					}
				);
			} catch (e) {
				// Texture 构造函数抛出异常时仍然需要结算计数器
				settle(texture!);
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
