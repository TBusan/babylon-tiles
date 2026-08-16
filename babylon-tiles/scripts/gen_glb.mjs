#!/usr/bin/env node
/**
 * 生成 packages/demo/public/demo_model.glb —— 最小合法 GLB（glTF 2.0 二进制容器）
 * 内容：flat-shaded 彩色立方体（24 顶点/36 索引），缩放 300 烘焙进节点变换，
 *       供 demo「加载 GLB 模型」示例使用（SceneLoader.ImportMeshAsync + GroundGroup 贴地）。
 *
 * 结构：
 *   header(12B) = magic 'glTF' | version=2 | totalLength
 *   chunk0 JSON  = chunkLength | type 'JSON' | jsonText(padded with 0x20)
 *   chunk1 BIN   = chunkLength | type 'BIN\0' | binData(padded with 0x00)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../packages/demo/public/demo_model.glb');

// ---- 立方体几何（单位立方体 ±0.5，6 面 × 4 顶点，CCW-from-outside 绕序） ----
const FACES = [
	{
		n: [0, 0, 1],
		v: [
			[-0.5, -0.5, 0.5],
			[0.5, -0.5, 0.5],
			[0.5, 0.5, 0.5],
			[-0.5, 0.5, 0.5],
		],
	}, // +Z
	{
		n: [0, 0, -1],
		v: [
			[0.5, -0.5, -0.5],
			[-0.5, -0.5, -0.5],
			[-0.5, 0.5, -0.5],
			[0.5, 0.5, -0.5],
		],
	}, // -Z
	{
		n: [1, 0, 0],
		v: [
			[0.5, -0.5, 0.5],
			[0.5, -0.5, -0.5],
			[0.5, 0.5, -0.5],
			[0.5, 0.5, 0.5],
		],
	}, // +X
	{
		n: [-1, 0, 0],
		v: [
			[-0.5, -0.5, -0.5],
			[-0.5, -0.5, 0.5],
			[-0.5, 0.5, 0.5],
			[-0.5, 0.5, -0.5],
		],
	}, // -X
	{
		n: [0, 1, 0],
		v: [
			[-0.5, 0.5, 0.5],
			[0.5, 0.5, 0.5],
			[0.5, 0.5, -0.5],
			[-0.5, 0.5, -0.5],
		],
	}, // +Y
	{
		n: [0, -1, 0],
		v: [
			[-0.5, -0.5, -0.5],
			[0.5, -0.5, -0.5],
			[0.5, -0.5, 0.5],
			[-0.5, -0.5, 0.5],
		],
	}, // -Y
];

const positions = [];
const normals = [];
const indices = [];
for (const face of FACES) {
	const base = indices.length === 0 ? 0 : positions.length / 3;
	for (const v of face.v) {
		positions.push(...v);
		normals.push(...face.n);
	}
	indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// ---- 构建 BIN 数据（4 字节对齐） ----
const posBuf = Buffer.from(new Float32Array(positions).buffer);
const nrmBuf = Buffer.from(new Float32Array(normals).buffer);
const idxBuf = Buffer.from(new Uint16Array(indices).buffer);
const posLen = posBuf.byteLength; // 24 * 3 * 4 = 288
const nrmLen = nrmBuf.byteLength; // 288
const idxOffset = posLen + nrmLen; // 576
const bin = Buffer.concat([posBuf, nrmBuf, idxBuf]);

// ---- JSON chunk ----
const json = {
	asset: { version: '2.0', generator: 'babylon-tiles-demo' },
	scene: 0,
	scenes: [{ nodes: [0] }],
	nodes: [
		{
			name: 'DemoCube',
			mesh: 0,
			// 缩放 300 烘焙进节点：模型几何为 1×1×1 立方体，加载后即为 300m 方块
			scale: [300, 300, 300],
		},
	],
	meshes: [
		{
			name: 'DemoCubeMesh',
			primitives: [
				{
					attributes: { POSITION: 0, NORMAL: 1 },
					indices: 2,
					material: 0,
					mode: 4, // TRIANGLES
				},
			],
		},
	],
	materials: [
		{
			name: 'Orange',
			pbrMetallicRoughness: {
				baseColorFactor: [0.95, 0.55, 0.15, 1.0],
				metallicFactor: 0.0,
				roughnessFactor: 0.9,
			},
		},
	],
	accessors: [
		{
			bufferView: 0,
			componentType: 5126,
			count: 24,
			type: 'VEC3',
			min: [-0.5, -0.5, -0.5],
			max: [0.5, 0.5, 0.5],
		},
		{ bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
		{ bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
	],
	bufferViews: [
		{ buffer: 0, byteOffset: 0, byteLength: posLen },
		{ buffer: 0, byteOffset: posLen, byteLength: nrmLen },
		{ buffer: 0, byteOffset: idxOffset, byteLength: idxBuf.byteLength },
	],
	buffers: [{ byteLength: bin.byteLength }],
};

const jsonText = JSON.stringify(json, null, 1);
const jsonBuf = Buffer.from(jsonText, 'utf8');
const jsonPadded = Buffer.alloc(Math.ceil(jsonBuf.byteLength / 4) * 4);
jsonBuf.copy(jsonPadded); // 剩余填 0x20（JSON chunk 惯例用空格填充）

const binPadded = Buffer.alloc(Math.ceil(bin.byteLength / 4) * 4);
bin.copy(binPadded); // 剩余填 0x00

// ---- 组装 GLB ----
const total = 12 + 8 + jsonPadded.byteLength + 8 + binPadded.byteLength;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // 'glTF'
header.writeUInt32LE(2, 4); // version 2
header.writeUInt32LE(total, 8);

const jsonChunk = Buffer.alloc(8);
jsonChunk.writeUInt32LE(jsonPadded.byteLength, 0);
jsonChunk.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

const binChunk = Buffer.alloc(8);
binChunk.writeUInt32LE(binPadded.byteLength, 0);
binChunk.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, jsonChunk, jsonPadded, binChunk, binPadded]));

console.log(`WROTE ${OUT} (${total} bytes, ${jsonText.length} json, ${bin.byteLength} bin)`);
