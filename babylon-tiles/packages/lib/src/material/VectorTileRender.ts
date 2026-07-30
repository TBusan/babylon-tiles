/**
 * @description: 矢量瓦片渲染器
 * 使用 Canvas 2D 将矢量要素（点、线、面）栅格化为纹理
 * 移植自 three-tile 的 VectorTileRender
 *
 * 支持：
 * - 点要素（文本标注）
 * - 线要素（道路、河流等）
 * - 面要素（建筑物、行政区等）
 * - 自定义样式（颜色、线宽、填充、阴影、虚线等）
 */

import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { Scene } from '@babylonjs/core/scene';

/**
 * 矢量要素类型
 */
export enum VectorFeatureTypes {
	Unknown = 0,
	Point = 1,
	Linestring = 2,
	Polygon = 3,
}

/**
 * 2D 点
 */
export type Point = { x: number; y: number };

/**
 * 矢量要素
 */
export interface VectorFeature {
	/** 几何数据：点数组的数组（多部分几何） */
	geometry: Point[][];
	/** 属性表 */
	properties?: Record<string, unknown>;
	/** 要素大小（可选） */
	size?: number;
}

/**
 * 矢量绘图样式（参考 Leaflet Path 样式）
 */
export interface VectorStyle {
	/** 最小显示层级 */
	minLevel?: number;
	/** 最大显示层级 */
	maxLevel?: number;
	/** 是否绘制线条 */
	stroke?: boolean;
	/** 线条颜色 */
	color?: string;
	/** 线条宽度 */
	weight?: number;
	/** 线条透明度 */
	opacity?: number;
	/** 虚线样式 [dash, gap, ...] */
	dashArray?: number[];
	/** 虚线偏移 */
	dashOffset?: number;
	/** 是否填充区域 */
	fill?: boolean;
	/** 填充颜色 */
	fillColor?: string;
	/** 填充透明度 */
	fillOpacity?: number;
	/** 填充规则 */
	fillRule?: CanvasFillRule;
	/** 文本字体 */
	font?: string;
	/** 文本颜色 */
	fontColor?: string;
	/** 文本偏移 [x, y] */
	fontOffset?: [number, number];
	/** 文本字段名（从 properties 中取值） */
	textField?: string;
	/** 阴影模糊 */
	shadowBlur?: number;
	/** 阴影颜色 */
	shadowColor?: string;
	/** 阴影偏移 [x, y] */
	shadowOffset?: [number, number];
}

/** 样式集合（按图层名索引） */
export type VectorStyles = Record<string, VectorStyle>;

/**
 * 矢量瓦片渲染器
 * 将矢量要素绘制到 Canvas 2D 上下文
 */
export class VectorTileRender {
	/**
	 * 渲染单个矢量要素
	 * @param ctx Canvas 2D 渲染上下文
	 * @param type 要素类型
	 * @param feature 要素数据
	 * @param style 绘图样式
	 * @param scale 坐标缩放倍数（瓦片尺寸 / 256）
	 */
	public render(
		ctx: CanvasRenderingContext2D,
		type: VectorFeatureTypes,
		feature: VectorFeature,
		style: VectorStyle,
		scale: number = 1
	): void {
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		// 设置阴影效果
		if ((style.shadowBlur ?? 0) > 0) {
			ctx.shadowBlur = style.shadowBlur ?? 2;
			ctx.shadowColor = style.shadowColor ?? 'black';
			ctx.shadowOffsetX = style.shadowOffset?.[0] ?? 0;
			ctx.shadowOffsetY = style.shadowOffset?.[1] ?? 0;
		}

		// 根据要素类型构建路径
		switch (type) {
			case VectorFeatureTypes.Point:
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.font = style.font ?? '14px Arial';
				ctx.fillStyle = style.fontColor ?? 'white';
				this._renderPointText(ctx, feature, scale, style.textField ?? 'name', style.fontOffset ?? [0, -8]);
				break;
			case VectorFeatureTypes.Linestring:
				this._renderLineString(ctx, feature, scale);
				break;
			case VectorFeatureTypes.Polygon:
				this._renderPolygon(ctx, feature, scale);
				break;
			default:
				break;
		}

		// 渲染填充
		if (style.fill || type === VectorFeatureTypes.Point) {
			ctx.globalAlpha = style.fillOpacity ?? 0.5;
			ctx.fillStyle = style.fillColor ?? style.color ?? '#3388ff';
			ctx.fill(style.fillRule ?? 'evenodd');
		}

		// 渲染线条
		if ((style.stroke ?? true) && (style.weight ?? 1) > 0) {
			ctx.globalAlpha = style.opacity ?? 1;
			ctx.lineWidth = style.weight ?? 1;
			ctx.strokeStyle = style.color ?? '#3388ff';
			ctx.setLineDash(style.dashArray ?? []);
			if (style.dashOffset) {
				ctx.lineDashOffset = style.dashOffset;
			}
			ctx.stroke();
		}

		// 重置阴影和全局透明度
		ctx.shadowBlur = 0;
		ctx.globalAlpha = 1;
	}

	/**
	 * 批量渲染多个要素
	 * @param ctx Canvas 2D 上下文
	 * @param features 要素列表 [type, feature, style][]
	 * @param scale 缩放倍数
	 */
	public renderBatch(
		ctx: CanvasRenderingContext2D,
		features: Array<{ type: VectorFeatureTypes; feature: VectorFeature; style: VectorStyle }>,
		scale: number = 1
	): void {
		for (const { type, feature, style } of features) {
			this.render(ctx, type, feature, style, scale);
		}
	}

	/**
	 * 创建 Babylon.js 动态纹理
	 * 将矢量要素渲染到 DynamicTexture 上
	 *
	 * @param scene Babylon.js 场景
	 * @param name 纹理名称
	 * @param size 纹理尺寸（像素，默认 256）
	 * @param drawCallback 绘制回调（在 Canvas 上下文中绘制矢量要素）
	 * @returns DynamicTexture
	 */
	public static createTexture(
		scene: Scene,
		name: string,
		size: number = 256,
		drawCallback: (ctx: CanvasRenderingContext2D, size: number) => void
	): DynamicTexture {
		const texture = new DynamicTexture(name, size, scene, false);
		const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;

		// 清空画布（透明背景）
		ctx.clearRect(0, 0, size, size);

		// 执行绘制
		drawCallback(ctx, size);

		// 更新纹理
		texture.update();

		return texture;
	}

	// ─── 私有渲染方法 ───────────────────────────────────────

	/** 渲染点要素（文本标注） */
	private _renderPointText(
		ctx: CanvasRenderingContext2D,
		feature: VectorFeature,
		scale: number,
		textField: string,
		fontOffset: [number, number]
	): void {
		const points = feature.geometry;

		// 绘制点标记
		ctx.beginPath();
		for (const point of points) {
			for (const p of point) {
				ctx.moveTo(p.x * scale + 2, p.y * scale);
				ctx.arc(p.x * scale, p.y * scale, 2, 0, 2 * Math.PI);
			}
		}

		// 绘制文本标注
		const properties = feature.properties;
		if (properties && properties[textField]) {
			ctx.fillText(
				properties[textField] as string,
				points[0][0].x * scale + fontOffset[0],
				points[0][0].y * scale + fontOffset[1]
			);
		}
	}

	/** 渲染线要素 */
	private _renderLineString(
		ctx: CanvasRenderingContext2D,
		feature: VectorFeature,
		scale: number
	): void {
		const lines = feature.geometry;

		ctx.beginPath();
		for (const line of lines) {
			for (let i = 0; i < line.length; i++) {
				const { x, y } = line[i];
				if (i === 0) {
					ctx.moveTo(x * scale, y * scale);
				} else {
					ctx.lineTo(x * scale, y * scale);
				}
			}
		}
	}

	/** 渲染面要素 */
	private _renderPolygon(
		ctx: CanvasRenderingContext2D,
		feature: VectorFeature,
		scale: number
	): void {
		const polygons = feature.geometry;

		ctx.beginPath();
		for (const ring of polygons) {
			for (let j = 0; j < ring.length; j++) {
				const { x, y } = ring[j];
				if (j === 0) {
					ctx.moveTo(x * scale, y * scale);
				} else {
					ctx.lineTo(x * scale, y * scale);
				}
			}
			ctx.closePath();
		}
	}
}
