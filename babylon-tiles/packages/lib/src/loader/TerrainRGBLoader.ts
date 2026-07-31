/**
 * @description: Terrain-RGB 地形加载器
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 *
 * Mapbox Terrain-RGB 格式解析器
 * https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-rgb-v1/
 */

import type { Geometry } from '@babylonjs/core/Meshes/geometry';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

import type { ITileGeometryLoader, TileSourceLoadParamsType, ITileLoaderInfo } from './ITileLoaders.js';
import type { ISource } from '../source/ISource.js';

/**
 * Terrain-RGB 解析器
 * 将 RGB 图像数据转换为高程数据
 */
export class TerrainRGBParser {
	/**
	 * 解析图像数据为高程数组
	 * @param imgData - 图像像素数据
	 * @returns 高程数组（Float32Array）
	 */
	public static parse(imgData: Uint8ClampedArray): Float32Array {
		const pixelCount = imgData.length >>> 2; // 除以4得到像素数量
		const dem = new Float32Array(pixelCount);

		for (let i = 0; i < pixelCount; i++) {
			dem[i] = this._getZ(imgData, i);
		}

		return dem;
	}

	/**
	 * 从图像数据中获取单个像素的高程值
	 * Mapbox Terrain-RGB v1 规范
	 * @param imgData - 图像数据
	 * @param i - 像素索引
	 * @returns 高程值（米）
	 */
	private static _getZ(imgData: Uint8ClampedArray, i: number): number {
		const index = i * 4;
		const [r, g, b, a] = imgData.slice(index, index + 4);

		// 透明像素直接返回高度 0
		if (a === 0) {
			return 0;
		}

		// RGB to height 公式（Mapbox Terrain-RGB）
		// height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
		const h = -10000 + (((r << 16) | (g << 8) | b) * 0.1);
		return h;
	}
}

/**
 * Terrain-RGB 地形加载器
 * 用于加载 Mapbox Terrain-RGB 格式的地形瓦片
 */
export class TerrainRGBLoader implements ITileGeometryLoader<VertexData> {
	/** 标识为几何体加载器 */
	public readonly isMaterialLoader = false;

	/** 加载器信息 */
	public readonly info: ITileLoaderInfo = {
		version: '1.0.0',
		author: 'Babylon-Tile Team',
		description: 'Mapbox Terrain-RGB terrain loader',
	};

	/** 数据类型标识 */
	public readonly dataType = 'terrain-rgb';

	/** 场景 */
	private readonly _scene: Scene;

	/** 瓦片分段数（默认 128x128） */
	private readonly _segments: number;

	/**
	 * 构造函数
	 * @param scene - Babylon.js 场景
	 * @param segments - 瓦片分段数（默认 128）
	 */
	constructor(scene: Scene, segments: number = 128) {
		this._scene = scene;
		this._segments = segments;
	}

	/**
	 * 加载地形数据并创建几何体
	 * @param params - 加载参数
	 * @returns Promise<VertexData> - 地形顶点数据
	 */
	public async load(params: TileSourceLoadParamsType): Promise<VertexData> {
		const { source, x, y, z } = params;
		const url = source.getUrl(x, y, z);

		// 加载图像
		const imgData = await this._loadImageData(url);

		// 解析为高程数据
		const dem = TerrainRGBParser.parse(imgData);

		// 创建地形几何体
		const vertexData = this._createTerrainVertexData(dem, this._segments);

		return vertexData;
	}

	/**
	 * 卸载几何体
	 */
	public unload(geometry: VertexData): void {
		// Babylon.js 几何体需要通过 Mesh 来释放
		// 这里只是一个接口实现
	}

	/**
	 * 加载图像数据
	 * @param url - 图像 URL
	 * @returns Promise<Uint8ClampedArray> - 图像像素数据
	 */
	private async _loadImageData(url: string): Promise<Uint8ClampedArray> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.crossOrigin = 'anonymous';

			img.onload = () => {
				// 创建 canvas 来读取像素数据
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
				reject(new Error(`Failed to load image: ${url}`));
			};

			img.src = url;
		});
	}

	/**
	 * 从高程数据创建顶点数据
	 * @param dem - 高程数组
	 * @param segments - 分段数
	 * @returns VertexData - 顶点数据
	 */
	private _createTerrainVertexData(dem: Float32Array, segments: number): VertexData {
		const size = Math.sqrt(dem.length);
		const vertexData = new VertexData();

		// 创建位置数组
		const positions: number[] = [];
		const indices: number[] = [];
		const normals: number[] = [];
		const uvs: number[] = [];

		// 生成顶点
		for (let i = 0; i <= segments; i++) {
			for (let j = 0; j <= segments; j++) {
				// 计算在 DEM 数组中的索引（DEM 第 0 行在北，几何 i=0 在南 → 行翻转）
				const demX = Math.floor((j / segments) * (size - 1));
				const demY = Math.floor(((segments - i) / segments) * (size - 1));
				const demIndex = demY * size + demX;

				// 归一化坐标（0-1）
				const x = j / segments;
				const y = i / segments;
				const z = dem[demIndex] || 0;

				// Babylon.js Y-up 坐标系：X水平, Y海拔, Z水平（y=0 在南）
				positions.push(x - 0.5, z, y - 0.5);
				uvs.push(x, y); // v=0 在南（贴图北端贴北，与 invertY 默认 true 一致）
				normals.push(0, 1, 0); // Y-up 法线
			}
		}

		// 生成索引（三角形）
		for (let i = 0; i < segments; i++) {
			for (let j = 0; j < segments; j++) {
				const a = i * (segments + 1) + j;
				const b = a + 1;
				const c = a + segments + 1;
				const d = c + 1;

				// 两个三角形组成一个方块
				indices.push(a, c, b);
				indices.push(b, c, d);
			}
		}

		vertexData.positions = positions;
		vertexData.indices = indices;
		vertexData.normals = normals;
		vertexData.uvs = uvs;

		return vertexData;
	}
}

/**
 * 使用 Worker 的 Terrain-RGB 加载器
 * 用于在后台线程中解析地形数据，避免阻塞主线程
 */
export class TerrainRGBLoaderWithWorker implements ITileGeometryLoader<VertexData> {
	/** 标识为几何体加载器 */
	public readonly isMaterialLoader = false;

	/** 加载器信息 */
	public readonly info: ITileLoaderInfo = {
		version: '1.0.0',
		author: 'Babylon-Tile Team',
		description: 'Mapbox Terrain-RGB terrain loader with Web Worker support',
	};

	/** 数据类型标识 */
	public readonly dataType = 'terrain-rgb';

	/** 场景 */
	private readonly _scene: Scene;

	/** Worker 代码（内联） */
	private readonly _workerCode: string;

	/** 瓦片分段数 */
	private readonly _segments: number;

	/**
	 * 构造函数
	 * @param scene - Babylon.js 场景
	 * @param segments - 瓦片分段数（默认 128）
	 */
	constructor(scene: Scene, segments: number = 128) {
		this._scene = scene;
		this._segments = segments;

		// 内联 Worker 代码
		this._workerCode = `
			self.onmessage = function(e) {
				const imgData = e.data;
				const pixelCount = imgData.length >>> 2;
				const dem = new Float32Array(pixelCount);

				for (let i = 0; i < pixelCount; i++) {
					const index = i * 4;
					const [r, g, b, a] = [imgData[index], imgData[index + 1], imgData[index + 2], imgData[index + 3]];

					if (a === 0) {
						dem[i] = 0;
					} else {
						dem[i] = -10000 + (((r << 16) | (g << 8) | b) * 0.1);
					}
				}

				self.postMessage(dem, [dem.buffer]);
			};
		`;
	}

	/**
	 * 加载地形数据并创建几何体（使用 Worker）
	 */
	public async load(params: TileSourceLoadParamsType): Promise<VertexData> {
		const { source, x, y, z } = params;
		const url = source.getUrl(x, y, z);

		// 加载图像
		const imgData = await this._loadImageData(url);

		// 使用 Worker 解析
		const dem = await this._parseInWorker(imgData);

		// 创建地形几何体
		const vertexData = this._createTerrainVertexData(dem, this._segments);

		return vertexData;
	}

	/**
	 * 卸载几何体
	 */
	public unload(geometry: VertexData): void {}

	/**
	 * 在 Worker 中解析地形数据
	 */
	private async _parseInWorker(imgData: Uint8ClampedArray): Promise<Float32Array> {
		return new Promise((resolve, reject) => {
			const blob = new Blob([this._workerCode], { type: 'application/javascript' });
			const worker = new Worker(URL.createObjectURL(blob));

			worker.onmessage = (e) => {
				resolve(e.data);
				worker.terminate();
			};

			worker.onerror = (error) => {
				reject(error);
				worker.terminate();
			};

			worker.postMessage(imgData, [imgData.buffer]);
		});
	}

	/**
	 * 加载图像数据
	 */
	private async _loadImageData(url: string): Promise<Uint8ClampedArray> {
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
				reject(new Error(`Failed to load image: ${url}`));
			};

			img.src = url;
		});
	}

	/**
	 * 从高程数据创建顶点数据
	 */
	private _createTerrainVertexData(dem: Float32Array, segments: number): VertexData {
		const size = Math.sqrt(dem.length);
		const vertexData = new VertexData();

		const positions: number[] = [];
		const indices: number[] = [];
		const normals: number[] = [];
		const uvs: number[] = [];

		for (let i = 0; i <= segments; i++) {
			for (let j = 0; j <= segments; j++) {
				const demX = Math.floor((j / segments) * (size - 1));
				const demY = Math.floor((i / segments) * (size - 1));
				const demIndex = demY * size + demX;

				const x = j / segments;
				const y = i / segments;
				const z = dem[demIndex] || 0;

				positions.push(x - 0.5, z, y - 0.5);
				uvs.push(x, 1 - y);
				normals.push(0, 1, 0);
			}
		}

		for (let i = 0; i < segments; i++) {
			for (let j = 0; j < segments; j++) {
				const a = i * (segments + 1) + j;
				const b = a + 1;
				const c = a + segments + 1;
				const d = c + 1;

				indices.push(a, c, b);
				indices.push(b, c, d);
			}
		}

		vertexData.positions = positions;
		vertexData.indices = indices;
		vertexData.normals = normals;
		vertexData.uvs = uvs;

		return vertexData;
	}
}
