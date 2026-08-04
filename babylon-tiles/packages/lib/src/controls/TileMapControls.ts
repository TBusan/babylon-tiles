/**
 * @description: 瓦片地图相机控制器（核心）
 * @author: Babylon-Tile Team
 *
 * 相机控制/鼠标交互是核心能力（缺它无法查看地图），归入 lib 而非插件。
 * 把 demo main.ts 内联的动态相机逻辑提炼为可复用核心类，对齐 three-tile
 * TileMapControls（three.js OrbitControls 扩展）：
 * - MAP 模式：左键平移、右键旋转、滚轮缩放（对齐 three-tile controlsMode="MAP"）
 * - ORBIT 模式：左键旋转、右键平移、滚轮缩放（对齐 controlsMode="ORBIT"）
 * - 每帧动态参数：缩放速度/平移灵敏度/方位角锁定/仰角限制/far 随距离调整
 * - yaw / pitch / roll 支持（用户明确补齐 yaw）
 * - minHeight / maxHeight 限高（相机属性，防穿地/防飞过头，用户决定不单独做插件）
 */

import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';

/**
 * 相机控制模式
 * MAP：左键平移、右键旋转（地图浏览）
 * ORBIT：左键旋转、右键平移（模型轨道浏览）
 */
export type ControlsMode = 'MAP' | 'ORBIT';

/**
 * 瓦片地图相机控制器
 *
 * 包装 ArcRotateCamera，把 three-tile TileMapControls 的动态控制逻辑移植到
 * Babylon.js。所有相机参数（缩放速度/灵敏度/角度限制/far）每帧在
 * registerBeforeRender 中自动调整，无需用户手动维护。
 */
export class TileMapControls {
	/** 地图最大仰角（rad），默认 Math.PI / 2.1 ≈ 85.7° */
	public mapMaxPolarAngle: number = Math.PI / 2.1;

	/** 相机距离超过该值时锁定方位角朝北（对齐 three-tile restAzimuthDist=8e6） */
	public restAzimuthDist = 8e6;

	/** 是否启用随距离动态缩放速度（默认 true） */
	public dymamicZoomSpeed = true;

	/** 最小相机距离 */
	public minDistance = 10;

	/** 最大相机距离 */
	public maxDistance = 3e7;

	/** 最小仰角（rad），相机不可低于该角度 */
	public lowerBetaLimit = 0.05;

	/** 相机最低高度（世界 Y），低于地表/设定值时上抬。默认 0（地表） */
	public minHeight = 0;

	/** 相机最高高度（世界 Y），高于该值时下压。默认 Infinity（不限） */
	public maxHeight = Infinity;

	/**
	 * 地表高度查询回调（世界坐标 XZ → 高度 Y）。用于结合地形防穿地：
	 * 每帧取 minHeight = max(this.minHeight, groundHeightAt(x, z))。
	 * 不设置时只按绝对 minHeight 钳制。
	 */
	public groundHeightAt: ((x: number, z: number) => number) | null = null;

	/** 控制变化回调（每帧调整后触发，可用于驱动 map.update(camera) 等） */
	public onChange: (() => void) | null = null;

	private readonly _camera: ArcRotateCamera;
	private readonly _scene: Scene;

	private _controlsMode: ControlsMode = 'MAP';
	private _roll = 0;

	/** 每帧动态调整回调（存引用以便 dispose 注销） */
	private readonly _onBeforeRender = (): void => {
		this._update();
		this.onChange?.();
	};

	/**
	 * 构造函数
	 * @param camera - Babylon 环绕相机（ArcRotateCamera）
	 * @param domElement - 交互 DOM 元素（可选；Babylon 默认使用 scene 画布）
	 */
	constructor(camera: ArcRotateCamera, _domElement?: HTMLElement) {
		this._camera = camera;
		this._scene = camera.getScene();

		// 缩放/阻尼/平移基础设置（对齐 three-tile dampingFactor≈0.85 手感）
		camera.wheelDeltaPercentage = 0.02;
		camera.lowerRadiusLimit = this.minDistance;
		camera.upperRadiusLimit = this.maxDistance;
		camera.lowerAlphaLimit = -Infinity;
		camera.upperAlphaLimit = Infinity;
		camera.lowerBetaLimit = this.lowerBetaLimit;
		camera.upperBetaLimit = this.mapMaxPolarAngle;
		camera.minZ = 1; // near 固定小值（动态 near 有一帧延迟，快速缩放会裁掉地面）
		camera.maxZ = 5e7;
		camera.panningAxis = new Vector3(1, 0, 1); // 只在 XZ 水平面平移（screenSpacePanning=false）
		camera.panningSensibility = 2500 / Math.max(camera.radius, 1);
		camera.inertia = 0.85;
		camera.panningInertia = 0.85;

		// 鼠标按键映射（MAP 默认：左键平移、右键旋转）
		camera.attachControl(true, true, 0);
		this._applyControlsMode();

		// 每帧动态调整相机参数
		this._scene.registerBeforeRender(this._onBeforeRender);
	}

	/**
	 * 控制模式
	 * MAP：左键平移、右键旋转；ORBIT：左键旋转、右键平移
	 */
	public get controlsMode(): ControlsMode {
		return this._controlsMode;
	}
	public set controlsMode(value: ControlsMode) {
		this._controlsMode = value;
		this._applyControlsMode();
	}

	/**
	 * 设置偏航角（yaw，rad）。yaw=0 朝北（相机在目标南侧看向北），
	 * 正值绕目标逆时针旋转（俯视）。映射到 ArcRotateCamera.alpha。
	 */
	public setYaw(yaw: number): void {
		this._camera.alpha = yaw;
	}

	/**
	 * 获取偏航角（rad）
	 */
	public getYaw(): number {
		return this._camera.alpha;
	}

	/**
	 * 设置俯仰角（pitch，rad）。pitch 为相对地平面的仰角：
	 * pitch=0 平视、pitch=π/2 俯视。映射到 beta = π/2 - pitch。
	 */
	public setPitch(pitch: number): void {
		this._camera.beta = Math.PI / 2 - pitch;
	}

	/**
	 * 获取俯仰角（rad，相对地平面仰角）
	 */
	public getPitch(): number {
		return Math.PI / 2 - this._camera.beta;
	}

	/**
	 * 获取相机到目标距离（即 ArcRotateCamera.radius）
	 */
	public getDistance(): number {
		return this._camera.radius;
	}

	/**
	 * 设置横滚角（roll，rad）。绕视线轴旋转（ArcRotateCamera 无原生 roll，
	 * 通过每帧绕视线方向旋转 upVector 实现）。0 = 水平。
	 */
	public setRoll(roll: number): void {
		this._roll = roll;
		this._applyRoll();
	}

	/**
	 * 获取横滚角（rad）
	 */
	public getRoll(): number {
		return this._roll;
	}

	/**
	 * 飞行到目标点
	 * @param target - 目标世界坐标
	 * @param radius - 相机距离
	 * @param pitch - 俯仰角（可选，默认保持当前）
	 * @param roll - 横滚角（可选，默认 0）
	 */
	public flyTo(target: Vector3, radius: number, pitch?: number, roll?: number): void {
		this._camera.target.copyFrom(target);
		this._camera.radius = radius;
		if (pitch !== undefined) {
			this.setPitch(pitch);
		}
		if (roll !== undefined) {
			this.setRoll(roll);
		}
	}

	/**
	 * 释放控制器：注销渲染回调与相机输入
	 */
	public dispose(): void {
		this._scene.unregisterBeforeRender(this._onBeforeRender);
		this._camera.detachControl();
	}

	/**
	 * 应用控制模式（切换鼠标按键映射）
	 * Babylon 以 _panningMouseButton 决定平移按钮：0=左键平移（右键自动旋转），
	 * 2=右键平移（左键自动旋转）。无需重新 attachControl。
	 */
	private _applyControlsMode(): void {
		const panButton = this._controlsMode === 'MAP' ? 0 : 2;
		(this._camera as unknown as { _panningMouseButton: number })._panningMouseButton = panButton;
	}

	/**
	 * 每帧动态调整（对齐 three-tile TileMapControls.onChange + demo 渲染循环）
	 */
	private _update(): void {
		const cam = this._camera;
		const dist = Math.max(cam.radius, 1);
		const beta = Math.max(cam.beta, 0.01); // 当前仰角（polar angle）

		// 1. 动态缩放速度：zoomSpeed = max(log(dist/1e3), 1)
		if (this.dymamicZoomSpeed) {
			cam.wheelDeltaPercentage = 0.01 * Math.max(Math.log(dist / 1e3), 1);
		}

		// 2. 动态平移灵敏度（panningAxis=(1,0,1) 使屏幕 Y 方向速度为 X 的 sin(beta) 倍，
		//    这是 Babylon 固有行为，通过适当降低 sensibility 匹配手感）
		cam.panningSensibility = 2000 / dist;

		// 3. 方位角锁定：远距离时锁定朝北（restAzimuthDist=8e6）
		if (dist > this.restAzimuthDist) {
			cam.lowerAlphaLimit = -Math.PI / 2;
			cam.upperAlphaLimit = -Math.PI / 2;
		} else {
			cam.lowerAlphaLimit = -Infinity;
			cam.upperAlphaLimit = Infinity;
		}

		// 4. 动态仰角限制：maxPolar = min((1e7/dist)^2, mapMaxPolarAngle)
		const maxBeta = Math.min(Math.pow(1e7 / dist, 2), this.mapMaxPolarAngle);
		cam.upperBetaLimit = Math.max(maxBeta, cam.lowerBetaLimit ?? this.lowerBetaLimit);

		// 5. 动态 far（near 固定为 1）：far = clamp((dist/(beta/1.5))*7, 2e4, maxDistance*2)
		cam.maxZ = Math.min(Math.max((dist / (beta / 1.5)) * 7, 2e4), this.maxDistance * 2);

		// 6. 限高：钳制相机与 target 高度（防穿地/防飞过头）
		this._applyHeightClamp();

		// 7. 横滚：绕当前视线轴旋转 upVector
		this._applyRoll();
	}

	/**
	 * 限高钳制（minHeight/maxHeight + 可选地表查询）
	 */
	private _applyHeightClamp(): void {
		const cam = this._camera;
		let minH = this.minHeight;
		if (this.groundHeightAt) {
			minH = Math.max(minH, this.groundHeightAt(cam.position.x, cam.position.z));
		}

		if (cam.position.y < minH) cam.position.y = minH;
		if (cam.position.y > this.maxHeight) cam.position.y = this.maxHeight;

		// target 同步钳制（防穿地时目标点不能低于地表）
		if (cam.target.y < minH) cam.target.y = minH;
		if (cam.target.y > this.maxHeight) cam.target.y = this.maxHeight;
	}

	/**
	 * 应用横滚：绕视线方向（target - position）旋转 upVector。
	 * roll=0 时恢复默认 up=(0,1,0)。
	 * 保护：视线与 up 近平行（极端俯视）时改用 (0,0,1) 作为基准，避免叉积退化。
	 */
	private _applyRoll(): void {
		const cam = this._camera;
		if (this._roll === 0) {
			if (cam.upVector.x !== 0 || cam.upVector.y !== 1 || cam.upVector.z !== 0) {
				cam.upVector.copyFromFloats(0, 1, 0);
			}
			return;
		}

		const dir = cam.target.subtract(cam.position);
		if (dir.lengthSquared() < 1e-12) return; // 相机与目标重合，视线无意义
		dir.normalize();

		let up0 = Vector3.Up();
		if (Math.abs(Vector3.Dot(up0, dir)) > 0.99) {
			up0 = Vector3.Forward(); // (0,0,1)，避免与视线共线
		}

		const quat = Quaternion.RotationAxis(dir, this._roll);
		cam.upVector.copyFrom(up0.rotateByQuaternionToRef(quat, new Vector3()));
	}
}
