/**
 * @description: Martini maxError 分辨率方案（按瓦片尺寸标定）
 * @author: Babylon-Tile Team
 *
 * 问题：`martiniMaxError` 若为绝对米制误差，低层级大瓦片 DEM 网格间距 S/256
 * 达千米级，固定 10m 会把瓦片细化到满分辨率（单瓦片 6 万+ 顶点 → 帧率骤降）。
 *
 * 解法：误差按「相对瓦片尺寸」标定。定义 cells = 误差占瓦片格子数的比例
 * （≈ 屏幕空间误差 ∝ cells），cells 随层级 z 递减：低层级（远处、占屏小）
 * 放宽省顶点，高层级（近处）收紧保精度。对齐 Mapbox「zoom 控精度」与
 * three-tile「按 zoom 降采样」的做法，且不依赖相机（无加载时刻采样滞后坑）。
 */

/**
 * maxError 解析选项
 */
export interface MaxErrorOptions {
	/** 参考层级，默认 14（= martiniMaxError 语义锚点） */
	refZoom?: number;
	/** DEM 网格尺寸（terrain-rgb=256，LERC=512），默认 256 */
	gridSize?: number;
	/** 每降 falloff 层，cells 翻倍，默认 3 */
	falloff?: number;
	/** 每瓦片最低格子误差数（近处精度下限），默认 2 */
	cellsMin?: number;
	/** 最高格子误差数（远处性能上限），默认 16 */
	cellsMax?: number;
}

/**
 * 解析瓦片的 Martini maxError（米制）
 *
 * 公式（worldScale = mapWidth/2^z，故 mapWidth = worldScale·2^z）：
 * ```
 * S_ref     = mapWidth / 2^refZoom = worldScale · 2^(z-refZoom)
 * cellsAtRef = refError / (S_ref / gridSize)              // z=refZoom 处 cells
 * cells     = clamp(cellsAtRef · 2^((refZoom-z)/falloff), cellsMin, cellsMax)
 * return    = cells · worldScale / gridSize                // 转回米制 maxError
 * ```
 *
 * 默认参数效果：z=14→2 cells（≈19m）、z=11→2.1（≈160m）、z=8→4.2（≈1.3km）、
 * z=5→8.4（≈20km）。参数以 CDP 探针实测校准（目标 z=14 瓦片顶点 ≤1 万、
 * 全场景总顶点 ≤40 万）。
 *
 * @param z - 瓦片层级（请求层级，超采样时也用显示层级而非父级）
 * @param worldScale - 瓦片世界宽度（米）= mapWidth / 2^z
 * @param refError - 参考层级处允许误差（米），默认 10（对齐原 martiniMaxError 语义）
 * @param opts - 可选参数
 * @returns 米制 Martini maxError
 */
export function resolveMartiniMaxError(
	z: number,
	worldScale: number,
	refError: number = 10,
	opts?: MaxErrorOptions
): number {
	const refZoom = opts?.refZoom ?? 14;
	const gridSize = opts?.gridSize ?? 256;
	const falloff = opts?.falloff ?? 3;
	const cellsMin = opts?.cellsMin ?? 2;
	const cellsMax = opts?.cellsMax ?? 16;

	// 参考层级处瓦片世界宽度（米）：worldScale·2^(z-refZoom)
	const sRef = worldScale * Math.pow(2, z - refZoom);

	// z=refZoom 处每瓦片格子误差数（相对比例，≈ 屏幕空间误差）
	const cellsAtRef = refError / (sRef / gridSize);

	// cells 随层级递减（低层级放宽、高层级收紧），clamp 到 [cellsMin, cellsMax]
	const cells = Math.min(Math.max(cellsAtRef * Math.pow(2, (refZoom - z) / falloff), cellsMin), cellsMax);

	// 转回米制 maxError
	return (cells * worldScale) / gridSize;
}
