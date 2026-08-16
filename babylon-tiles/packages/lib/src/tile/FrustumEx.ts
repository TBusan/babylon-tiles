/**
 * @description: 视锥体扩展类，提供8个角点和AABB相交检测
 * Ported from three-tile's FrustumEx for Babylon.js (Y-up coordinate system)
 * @author: Babylon-Tile Team
 * @date: 2025-07-25
 */

import { Plane } from '@babylonjs/core/Maths/math.plane';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import type { BoundingBox } from '@babylonjs/core/Culling/boundingBox';

/**
 * 计算三个平面的交点
 * 解线性方程组 A * x = b，其中 A 是3x3的法线矩阵
 */
function findIntersectionPoint(plane1: Plane, plane2: Plane, plane3: Plane, target: Vector3): Vector3 {
	// 构建系数矩阵 A（法线作为行）
	const a11 = plane1.normal.x,
		a12 = plane1.normal.y,
		a13 = plane1.normal.z;
	const a21 = plane2.normal.x,
		a22 = plane2.normal.y,
		a23 = plane2.normal.z;
	const a31 = plane3.normal.x,
		a32 = plane3.normal.y,
		a33 = plane3.normal.z;

	// 行列式
	const det = a11 * (a22 * a33 - a23 * a32) - a12 * (a21 * a33 - a23 * a31) + a13 * (a21 * a32 - a22 * a31);

	if (Math.abs(det) < 1e-10) {
		target.set(0, 0, 0);
		return target;
	}

	// 常数项向量
	const b1 = -plane1.d,
		b2 = -plane2.d,
		b3 = -plane3.d;

	// Cramer法则求解
	const invDet = 1 / det;
	target.x = (b1 * (a22 * a33 - a23 * a32) - a12 * (b2 * a33 - a23 * b3) + a13 * (b2 * a32 - a22 * b3)) * invDet;
	target.y = (a11 * (b2 * a33 - a23 * b3) - b1 * (a21 * a33 - a23 * a31) + a13 * (a21 * b3 - b2 * a31)) * invDet;
	target.z = (a11 * (a22 * b3 - b2 * a32) - a12 * (a21 * b3 - b2 * a31) + b1 * (a21 * a32 - a22 * a31)) * invDet;

	return target;
}

/**
 * 视锥体扩展类
 * 除了6个裁剪平面外，还计算8个角点用于调试和相交测试
 */
export class FrustumEx {
	/** 6个视锥体平面 [左, 右, 下, 上, 近, 远] */
	public planes: Plane[];

	/** 8个视锥体角点 */
	public points: Vector3[];

	constructor() {
		this.planes = Array.from({ length: 6 }, () => new Plane(0, 0, 0, 0));
		this.points = Array.from({ length: 8 }, () => new Vector3());
	}

	/**
	 * 从视图-投影矩阵设置视锥体平面
	 * @param m 组合的视图-投影矩阵
	 *
	 * Babylon.js Matrix.toArray() 返回行主序数组：m[row * 4 + col]
	 * 行向量约定 v' = v * M，因此「裁剪坐标 w 分量所在的行」是第 4 行。
	 * 平面提取使用「列」求和：col3 ± col_k（k = 0,1,2），与 Babylon.js
	 * 官方 Frustum.GetPlanesToRef 完全一致（NDC z ∈ [-1,1]，isNDCHalfZRange=false）。
	 * 注意不要使用 Three.js（列主序 / 列向量）的「行」提取公式。
	 */
	setFromProjectionMatrix(m: Matrix): this {
		const { planes } = this;
		const me = m.m; // Babylon.js 行主序 Float32Array: me[row*4+col]，避免 toArray() 每次分配

		// 就地更新已有 Plane（避免每次更新分配 6 个 Plane 对象）
		this._setPlane(planes[0], me[3] + me[0], me[7] + me[4], me[11] + me[8], me[15] + me[12]); // 左: col3 + col0
		this._setPlane(planes[1], me[3] - me[0], me[7] - me[4], me[11] - me[8], me[15] - me[12]); // 右: col3 - col0
		this._setPlane(planes[2], me[3] + me[1], me[7] + me[5], me[11] + me[9], me[15] + me[13]); // 下: col3 + col1
		this._setPlane(planes[3], me[3] - me[1], me[7] - me[5], me[11] - me[9], me[15] - me[13]); // 上: col3 - col1
		this._setPlane(planes[4], me[3] + me[2], me[7] + me[6], me[11] + me[10], me[15] + me[14]); // 近: col3 + col2
		this._setPlane(planes[5], me[3] - me[2], me[7] - me[6], me[11] - me[10], me[15] - me[14]); // 远: col3 - col2

		this.calculateFrustumPoints();
		return this;
	}

	/** 就地写入并归一化一个平面（零分配） */
	private _setPlane(plane: Plane, a: number, b: number, c: number, d: number): void {
		const len = Math.sqrt(a * a + b * b + c * c);
		if (len > 0) {
			plane.normal.set(a / len, b / len, c / len);
			plane.d = d / len;
		} else {
			plane.normal.set(a, b, c);
			plane.d = d;
		}
	}

	/**
	 * 计算8个视锥体角点（三平面交点）
	 */
	private calculateFrustumPoints(): void {
		const { planes, points } = this;
		findIntersectionPoint(planes[0], planes[3], planes[4], points[0]); // 近左上
		findIntersectionPoint(planes[1], planes[3], planes[4], points[1]); // 近右上
		findIntersectionPoint(planes[0], planes[2], planes[4], points[2]); // 近左下
		findIntersectionPoint(planes[1], planes[2], planes[4], points[3]); // 近右下
		findIntersectionPoint(planes[0], planes[3], planes[5], points[4]); // 远左上
		findIntersectionPoint(planes[1], planes[3], planes[5], points[5]); // 远右上
		findIntersectionPoint(planes[0], planes[2], planes[5], points[6]); // 远左下
		findIntersectionPoint(planes[1], planes[2], planes[5], points[7]); // 远右下
	}

	/**
	 * 检测包围盒是否与视锥体相交
	 * 使用p-vertex方法：对每个平面，找到包围盒中最可能在该平面外侧的顶点
	 * @param box AABB包围盒（世界坐标）
	 * @returns 是否相交或包含
	 */
	intersectsBox(box: BoundingBox): boolean {
		const { planes } = this;
		const { minimumWorld, maximumWorld } = box;

		for (const plane of planes) {
			// p-vertex: 对于法线分量 > 0 的轴取最大值，否则取最小值
			const px = plane.normal.x > 0 ? maximumWorld.x : minimumWorld.x;
			const py = plane.normal.y > 0 ? maximumWorld.y : minimumWorld.y;
			const pz = plane.normal.z > 0 ? maximumWorld.z : minimumWorld.z;

			// p-vertex在平面外侧则不相交
			// dotCoordinate = normal·point + d，< 0 表示在平面外侧
			if (plane.normal.x * px + plane.normal.y * py + plane.normal.z * pz + plane.d < 0) {
				return false;
			}
		}

		return true;
	}
}
