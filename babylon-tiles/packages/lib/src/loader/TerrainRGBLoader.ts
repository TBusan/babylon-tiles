/**
 * @description: Terrain-RGB 地形解析器
 * @author: Babylon-Tile Team
 * @date: 2025-01-23
 *
 * Mapbox Terrain-RGB 格式解析器
 * https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-rgb-v1/
 *
 * 注：旧 TerrainRGBLoader/TerrainRGBLoaderWithWorker 类已废弃移除——加载路径统一走
 * LoaderFactory 分发的 TerrainRGBGeometryLoader（见 TileGeometryLoaders.ts）。
 */

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
		const p = Math.floor(Math.sqrt(pixelCount));

		// 非正方形数据：保持原行为（逐像素线性输出）
		if (p * p !== pixelCount) {
			const dem = new Float32Array(pixelCount);
			for (let i = 0; i < pixelCount; i++) {
				dem[i] = this._getZ(imgData, i);
			}
			return dem;
		}

		// 正方形 p×p（如 256px 瓦片）上采样为 (p+1)×(p+1)（如 257×257，2^n+1）：
		// 复制最后一行/列作为南缘/东缘采样点。这样每个瓦片都包含与相邻瓦片共享的
		// 边缘采样点（边缘高度一致、无缝），且网格满足 Martini 的 2^n+1 要求。
		// （TileLoader 的 DEM 超采样裁剪依赖这一点：256 无法被二等分为两个 2^n+1。）
		const dem = new Float32Array((p + 1) * (p + 1));
		for (let i = 0; i < pixelCount; i++) {
			const r = Math.floor(i / p);
			const c = i - r * p;
			dem[r * (p + 1) + c] = this._getZ(imgData, i);
		}
		// 南缘（复制最后一行）
		for (let c = 0; c < p; c++) {
			dem[p * (p + 1) + c] = dem[(p - 1) * (p + 1) + c];
		}
		// 东缘（复制最后一列）
		for (let r = 0; r < p; r++) {
			dem[r * (p + 1) + p] = dem[r * (p + 1) + (p - 1)];
		}
		// 东南角
		dem[p * (p + 1) + p] = dem[(p - 1) * (p + 1) + (p - 1)];
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
		// 直接按索引读取，避免 imgData.slice() 为每个像素分配一个 4 元素数组。
		// 一张 256×256 瓦片有 65536 个像素，原实现每像素一次 slice 分配 +
		// 解构，是主线程解析地形的主耗时点。
		const r = imgData[index];
		const g = imgData[index + 1];
		const b = imgData[index + 2];
		const a = imgData[index + 3];

		// 透明像素直接返回高度 0
		if (a === 0) {
			return 0;
		}

		// RGB to height 公式（Mapbox Terrain-RGB）
		// height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
		return -10000 + (((r << 16) | (g << 8) | b) * 0.1);
	}
}
