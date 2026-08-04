/**
 * @description: 高程着色材质加载器
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile elevationLoader：
 * - dataType='elevation'，extends TileMaterialLoader，覆盖 createMaterial(scene)
 *   返回 ElevationShader（Babylon 材质必须绑定 scene，故场景经 createMaterial 传入）。
 * - minHeight/maxHeight 属性在创建材质时应用到着色器。
 */

import { Material } from '@babylonjs/core/Materials/material';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

import { TileMaterialLoader } from '@babylon-tile/lib';
import { ElevationShader } from './ElevationShader.js';

/**
 * 高程着色材质加载器
 */
export class ElevationLoader extends TileMaterialLoader {
	/** 数据类型标识 */
	public dataType = 'elevation';

	private _minHeight: number;
	private _maxHeight: number;

	/**
	 * 构造函数
	 * @param minHeight 最小高度（着色归一化下界）
	 * @param maxHeight 最大高度（着色归一化上界）
	 */
	public constructor(minHeight: number = 0, maxHeight: number = 3000) {
		super();
		this._minHeight = minHeight;
		this._maxHeight = maxHeight;
	}

	public get maxHeight(): number {
		return this._maxHeight;
	}
	public set maxHeight(value: number) {
		this._maxHeight = value;
	}

	public get minHeight(): number {
		return this._minHeight;
	}
	public set minHeight(value: number) {
		this._minHeight = value;
	}

	/**
	 * 创建高程着色材质（覆盖抽象基类）
	 * @param scene Babylon 场景
	 * @returns 高程着色材质
	 */
	public createMaterial(scene: Scene): Material {
		return new ElevationShader(scene, this._minHeight, this._maxHeight);
	}

	/**
	 * 无外部纹理（纯着色器），返回 undefined
	 */
	protected async doLoad(): Promise<Texture | undefined> {
		return undefined;
	}
}
