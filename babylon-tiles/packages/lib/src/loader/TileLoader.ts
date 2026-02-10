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
import { getTileProjBounds } from '../tile/util.js';

/**
 * 瓦片加载器类
 * 负责加载瓦片的几何体和材质
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

	/** 设置投影对象 */
	public set projection(value: IProjection) {
		this._projection = value;
	}

	private _imgSource: ISource[] = [];

	/** 获取影像数据源 */
	public get imgSource(): ISource[] {
		return this._imgSource;
	}

	/** 设置影像数据源 */
	public set imgSource(value: ISource[]) {
		this._imgSource = value;
	}

	private _demSource?: ISource;

	/** 获取地形数据源 */
	public get demSource(): ISource | undefined {
		return this._demSource;
	}

	/** 设置地形数据源 */
	public set demSource(value: ISource | undefined) {
		this._demSource = value;
	}

	/** 获取边界 */
	public get bounds(): [number, number, number, number] {
		return this._bounds;
	}

	/** 设置边界 */
	public set bounds(value: [number, number, number, number]) {
		this._bounds = value;
	}

	/** 获取当前下载数量 */
	public get downloadingThreads(): number {
		return TileLoader._downloadingThreads;
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

		// 计算瓦片边界
		const bounds = getTileProjBounds(x, y, z, this._projection);

		// 加载几何体
		const geometry = await this.loadGeometry({ x, y, z, bounds });

		// 加载材质
		const materials = await this.loadMaterial({ x, y, z, bounds });

		// 创建网格
		const mesh = geometry;
		mesh.material = materials[0];

		// 如果有多个材质，创建多材质网格（简化处理，只使用第一个材质）
		// 实际实现中可能需要使用 MultiMaterial

		return mesh;
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
		const bounds = getTileProjBounds(x, y, z, this._projection);

		if (updateGeometry) {
			const newGeometry = await this.loadGeometry({ x, y, z, bounds });
			// 替换几何体数据
			mesh.dispose();
			const newMesh = newGeometry;
			newMesh.material = mesh.material;
			return newMesh;
		}

		if (updateMaterial) {
			const materials = await this.loadMaterial({ x, y, z, bounds });
			mesh.material = materials[0];
		}

		return mesh;
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
	 * @param params - 瓦片参数
	 * @returns Promise<Mesh> 瓦片网格
	 */
	private async loadGeometry(params: { x: number; y: number; z: number; bounds: [number, number, number, number] }): Promise<Mesh> {
		try {
			// 如果有地形数据源且层级 >= 最小层级
			if (this._demSource && params.z >= this._demSource.minLevel && this._intersectsBounds(this._demSource, params.bounds)) {
				TileLoader._downloadingThreads++;

				// 这里应该加载高程数据
				// 简化实现：创建平瓦片
				// 实际实现中需要从 URL 加载高程数据
				const geometry = TileGeometry.createTile(`tile-${params.z}-${params.x}-${params.y}-geometry`, {
					scene: this._scene,
					width: 1,
					height: 1,
					segmentsW: 1,
					segmentsH: 1,
					skirtHeight: 100,
				});

				TileLoader._downloadingThreads--;
				return geometry;
			} else {
				// 创建平瓦片
				return TileGeometry.createFlatTile(`tile-${params.z}-${params.x}-${params.y}-geometry`, this._scene);
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
	 * @param params - 瓦片参数
	 * @returns Promise<Material[]> 材质数组
	 */
	private async loadMaterial(params: { x: number; y: number; z: number; bounds: [number, number, number, number] }): Promise<Material[]> {
		const materials: Material[] = [this.backgroundMaterial];

		// 过滤符合条件的影像源
		const sources = this._imgSource.filter(
			source => params.z >= source.minLevel && this._intersectsBounds(source, params.bounds)
		);

		// 加载每个数据源的材质
		for (const source of sources) {
			try {
				TileLoader._downloadingThreads++;

				// 获取瓦片 URL
				const url = source.getUrl(params.x, params.y, params.z);

				// 创建纹理
				const texture = new Texture(url, this._scene, undefined, undefined, undefined, () => {
					TileLoader._downloadingThreads--;
				});

				// 创建材质
				const material = TileMaterial.createTileMaterial({
					scene: this._scene,
					name: `tile-${params.z}-${params.x}-${params.y}-material`,
					diffuseTexture: texture,
					opacity: source.opacity ?? 1,
					transparent: source.transparent ?? false,
				});

				materials.push(material);
			} catch (error) {
				TileLoader._downloadingThreads--;
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
	 * @param tileBounds - 瓦片边界
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
