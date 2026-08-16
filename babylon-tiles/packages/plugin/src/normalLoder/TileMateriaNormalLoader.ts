/**
 * @description: Normal 法线材质加载器
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile normalLoder（three.js MeshNormalMaterial）：
 * - dataType='normal'，把顶点法线编码为 RGB 颜色输出，用于调试地形法线。
 * - Babylon 无 MeshNormalMaterial，用 ShaderMaterial 实现同样的「法线→颜色」。
 */

import { Material } from '@babylonjs/core/Materials/material';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';

import { ITileMaterialLoader, ITileLoaderInfo, TileSourceLoadParamsType } from '@babylon-tile/lib';

/** 顶点着色器：输出局部空间法线 */
const vertexSrc = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
uniform mat4 worldViewProjection;

varying vec3 vNormal;

void main() {
    vNormal = normalize(normal);
    gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

/** 片元着色器：法线映射到 RGB（与 three.js MeshNormalMaterial 一致） */
const fragmentSrc = /* glsl */ `
precision highp float;

varying vec3 vNormal;

void main() {
    vec3 c = vNormal * 0.5 + 0.5;
    gl_FragColor = vec4(c, 1.0);
}
`;

/**
 * Normal 材质加载器
 * 将瓦片顶点法线（world 空间）以颜色形式输出，方便调试地形法线朝向。
 */
export class TileMateriaNormalLoader implements ITileMaterialLoader<Material> {
	/** 加载器信息 */
	public readonly info: ITileLoaderInfo = {
		version: '1.0.0',
		description: 'Tile normal material loader.',
	};

	/** 数据类型标识 */
	public readonly dataType = 'normal';

	/** 标识为材质加载器 */
	public readonly isMaterialLoader = true;

	/**
	 * 加载法线着色材质
	 * @param params - 加载参数
	 * @returns 法线着色材质；scene 缺失时返回 undefined（静默跳过）
	 */
	public async load(params: TileSourceLoadParamsType): Promise<Material | undefined> {
		const { scene, x, y, z, source } = params;
		if (!scene) return undefined;

		const material = new ShaderMaterial(
			`normal-${z}-${x}-${y}`,
			scene,
			{
				vertexSource: vertexSrc,
				fragmentSource: fragmentSrc,
			},
			{
				attributes: ['position', 'normal'],
				uniforms: ['worldViewProjection'],
			}
		);
		// 与瓦片几何绕序兼容（见 TileMaterial 中关于手性系/背面剔除的说明）
		material.backFaceCulling = false;
		material.alpha = source.opacity ?? 1;
		return material;
	}

	/**
	 * 卸载材质
	 */
	public unload(material: Material): void {
		material.dispose();
	}
}
