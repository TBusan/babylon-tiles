/**
 * @description: 瓦片加载器实现
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh';
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

/**
 * 瓦片加载器类
 * 负责加载瓦片的几何体和材质，包含投影坐标变换
 */
export class TileLoader implements ITileLoader {
	private static _downloadingThreads = 0;

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
		return TileLoader._downloadingThreads;
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
	 * @param y 瓦片Y坐标
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
		// 计算瓦片投影范围
		const bounds = this._projection.getProjBoundsFromXYZ(x, y, z);
		// 计算瓦片经纬度范围
		const lonLatBounds = this._projection.getLonLatBoundsFromXYZ(x, y, z);

		return { x: newX, y, z, bounds, lonLatBounds };
	}

	/**
	 * 加载瓦片数据
	 * @param params - 瓦片加载参数或 Tile 对象
	 * @returns Promise<Mesh> 瓦片网格
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

		// 设置材质
		// 使用最后一个（影像）材质直接渲染，跳过背景材质
		// 注意：Babylon.js 的 MultiMaterial + SubMesh 设计用于将不同材质
		// 分配给几何体的不同部分，不适用于 Three.js 风格的图层叠加。
		// layers[0] = backgroundMaterial, layers[1..N] = imageMaterials
		if (materials.length > 1) {
			// 多个影像源时，使用最后的材质（最顶层）
			geometry.material = materials[materials.length - 1];
		} else {
			geometry.material = materials[0];
		}

		return geometry;
	}

	/**
	 * 更新瓦片数据
	 * @param mesh - 要更新的瓦片网格
	 * @param params - 瓦片加载参数
	 * @param updateMaterial - 是否更新材质
	 * @param updateGeometry - 是否更新几何体
	 * @returns Promise<Mesh> 更新后的瓦片网格
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

		if (updateGeometry) {
			// 替换几何体数据（不销毁整个mesh）
			await this.updateGeometry(mesh, coords);
		}

		if (updateMaterial) {
			await this.updateMaterialForMesh(mesh, coords);
		}

		return mesh;
	}

	/**
	 * 更新网格的几何体
	 */
	private async updateGeometry(
		mesh: Mesh,
		coords: { x: number; y: number; z: number; bounds: [number, number, number, number]; lonLatBounds: [number, number, number, number] }
	): Promise<void> {
		const newGeomMesh = await this.loadGeometry(coords);
		const newGeom = newGeomMesh.geometry;
		if (newGeom) {
			// Dispose old geometry GPU resources
			(mesh as any)._geometry?.dispose();
			// Assign new geometry
			(mesh as any)._geometry = newGeom;
			// Detach from temp mesh to prevent double-dispose
			(newGeomMesh as any)._geometry = null;
		}
		// Dispose temp mesh shell only (geometry was transferred)
		newGeomMesh.dispose(false, true);
	}

	/**
	 * 更新网格的材质
	 */
	private async updateMaterialForMesh(
		mesh: Mesh,
		coords: { x: number; y: number; z: number; bounds: [number, number, number, number]; lonLatBounds: [number, number, number, number] }
	): Promise<void> {
		const materials = await this.loadMaterial(coords);
		if (mesh.material) {
			const oldMaterial = mesh.material;
			mesh.material = materials[0];
			oldMaterial.dispose();
		} else {
			mesh.material = materials[0];
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

	/**
	 * 加载几何体
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
				this._intersectsBounds(this._demSource, coords.bounds)
			) {
				TileLoader._downloadingThreads++;

				try {
					const geometry = TileGeometry.createTile(
						`tile-${coords.z}-${coords.x}-${coords.y}-geometry`,
						{
							scene: this._scene,
							width: 1,
							height: 1,
							segmentsW: 1,
							segmentsH: 1,
							skirtHeight: 100,
						}
					);

					return geometry;
				} finally {
					TileLoader._downloadingThreads--;
				}
			} else {
				// 创建平瓦片
				return TileGeometry.createFlatTile(
					`tile-${coords.z}-${coords.x}-${coords.y}-geometry`,
					this._scene
				);
			}
		} catch (error) {
			if (this.debug > 0) {
				console.error('Load Geometry Error:', error);
			}
			return TileGeometry.createFlatTile('error-geometry', this._scene);
		}
	}

	/**
	 * 加载材质
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

		// 过滤符合条件的影像源
		const sources = this._imgSource.filter(
			source =>
				coords.z >= source.minLevel &&
				this._intersectsBounds(source, coords.bounds)
		);

		// 加载每个数据源的材质
		for (const source of sources) {
			try {
				// 获取瓦片 URL（使用变换后的坐标）
				const url = source.getUrl(coords.x, coords.y, coords.z);

				if (!url) {
					continue;
				}

				TileLoader._downloadingThreads++;

				// 等待纹理加载完成（与 three-tile 行为一致）
				const texture = await this._loadTexture(url, coords);

				// 创建材质
				const material = TileMaterial.createTileMaterial({
					scene: this._scene,
					name: `tile-${coords.z}-${coords.x}-${coords.y}-material`,
					diffuseTexture: texture,
					opacity: source.opacity ?? 1,
					transparent: source.transparent ?? false,
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
	 * 加载纹理（Promise 包装，确保等待加载完成）
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
					TileLoader._downloadingThreads--;
					resolve(tex);
				}
			};

			// 安全超时：防止纹理加载永不完成导致 _isLoading 卡死
			const timeout = setTimeout(() => {
				if (this.debug > 0) {
					console.warn(`Texture load timeout for tile ${coords.z}-${coords.x}-${coords.y}`);
				}
				settle(texture);
			}, 30000);

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
