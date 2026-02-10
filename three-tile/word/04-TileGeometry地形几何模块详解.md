# TileGeometry 地形几何模块详解

## 概述

`TileGeometry` 模块负责处理瓦片的地形几何数据，包括从 DEM (数字高程模型) 数据生成 3D 地形网格、计算法向量、添加裙边等功能。

**源码位置**: `packages/lib/src/geometry/`

## 模块组成

```
geometry/
├── GeometryDataTypes.ts   # 数据类型定义
├── TileGeometry.ts        # 几何体类
├── utils.ts               # 工具函数
├── skirt.ts               # 裙边处理
├── Martini.ts             # Martini 地形简化算法
└── index.ts               # 模块导出
```

## 数据类型定义

### GeometryDataType

```typescript
export type GeometryDataType = {
    attributes: AttributesType;
    indices: Uint16Array | Uint32Array;
};
```

### AttributesType

```typescript
export type AttributesType = {
    position: {
        value: Float32Array;  // 顶点坐标 [x, y, z, ...]
        size: number;         // 3 (xyz)
    };
    texcoord: {
        value: Float32Array;  // UV坐标 [u, v, ...]
        size: number;         // 2 (uv)
    };
    normal: {
        value: Float32Array;  // 法向量 [nx, ny, nz, ...]
        size: number;         // 3 (nx, ny, nz)
    };
};
```

## TileGeometry 类

```typescript
export class TileGeometry extends BufferGeometry {
    public type = "TileGeometry";

    public constructor() {
        super();
        // 默认创建一个简单的四边形几何体
        const data = new Float32Array([0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0]);
        this.setData(data);
    }

    public setData(data: GeometryDataType | Float32Array, skirtHeight: number = 1000) {
        // 1. 转换 DEM 数据为几何体数据
        let geoData = data instanceof Float32Array ? getGeometryDataFromDem(data) : data;

        // 2. 添加裙边（防止瓦片接缝）
        geoData = addSkirt(geoData.attributes, geoData.indices, skirtHeight);

        // 3. 设置几何体属性
        const { attributes, indices } = geoData;
        this.setIndex(new BufferAttribute(indices, 1));
        this.setAttribute("position", new BufferAttribute(attributes.position.value, attributes.position.size));
        this.setAttribute("uv", new BufferAttribute(attributes.texcoord.value, attributes.texcoord.size));
        this.setAttribute("normal", new BufferAttribute(attributes.normal.value, attributes.normal.size));

        // 4. 计算包围盒和包围球
        this.computeBoundingBox();
        this.computeBoundingSphere();

        return this;
    }
}
```

## DEM 数据转换 (utils.ts)

### getGeometryDataFromDem()

从 DEM 数组生成完整的几何体数据：

```typescript
export function getGeometryDataFromDem(dem: Float32Array): GeometryDataType {
    if (dem.length < 4) {
        throw new Error(`DEM array must > 4, got ${dem.length}!`);
    }

    // DEM 是 size × size 的正方形网格
    const size = Math.floor(Math.sqrt(dem.length));
    const width = size;
    const height = size;

    // 生成三角形索引
    const indices = getGridIndices(height, width);
    // 生成顶点属性
    const attributes = getAttributes(dem, height, width);

    return { attributes, indices };
}
```

### 顶点属性生成

```typescript
function getAttributes(dem: Float32Array, height: number, width: number): AttributesType {
    const numVertices = width * height;
    const vertices = new Float32Array(numVertices * 3);
    const uvs = new Float32Array(numVertices * 2);

    let index = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // 归一化坐标 (0 ~ 1)
            const xNorm = x / (width - 1);
            const yNorm = y / (height - 1);

            // UV坐标
            uvs[index * 2] = xNorm;
            uvs[index * 2 + 1] = yNorm;

            // 顶点位置: 坐标范围 -0.5 ~ 0.5
            vertices[index * 3] = xNorm - 0.5;           // X
            vertices[index * 3 + 1] = yNorm - 0.5;       // Y
            vertices[index * 3 + 2] = dem[(height - y - 1) * width + x]; // Z (高程)

            index++;
        }
    }

    return {
        position: { value: vertices, size: 3 },
        texcoord: { value: uvs, size: 2 },
        normal: { value: getNormals(vertices, getGridIndices(height, width)), size: 3 },
    };
}
```

### 网格索引生成

```typescript
export function getGridIndices(height: number, width: number) {
    const numIndices = 6 * (width - 1) * (height - 1);
    const indices = new Uint16Array(numIndices);

    let index = 0;
    for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
            // 四个顶点索引
            const a = y * width + x;       // 左上
            const b = a + 1;                // 右上
            const c = a + width;            // 左下
            const d = c + 1;                // 右下

            // 两个三角形: abc 和 cbd
            const baseIndex = index * 6;
            indices[baseIndex] = a;
            indices[baseIndex + 1] = b;
            indices[baseIndex + 2] = c;
            indices[baseIndex + 3] = c;
            indices[baseIndex + 4] = b;
            indices[baseIndex + 5] = d;

            index++;
        }
    }
    return indices;
}
```

网格索引生成图解：

```
a ----- b       a ----- b
|     / |       | \     |
|   /   |  →    |   \   |
| /     |       |     \ |
c ----- d       c ----- d

三角形1: abc      三角形2: cbd
```

### 法向量计算

```typescript
export function getNormals(vertices: Float32Array, indices: Uint16Array | Uint32Array): Float32Array {
    const normals = new Float32Array(vertices.length);

    for (let i = 0; i < indices.length; i += 3) {
        // 获取三角形三个顶点
        const i0 = indices[i] * 3;
        const i1 = indices[i + 1] * 3;
        const i2 = indices[i + 2] * 3;

        // 获取顶点坐标
        const v0 = [vertices[i0], vertices[i0 + 1], vertices[i0 + 2]];
        const v1 = [vertices[i1], vertices[i1 + 1], vertices[i1 + 2]];
        const v2 = [vertices[i2], vertices[i2 + 1], vertices[i2 + 2]];

        // 计算边向量
        const edge1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
        const edge2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];

        // 叉乘计算法向量
        const normal = [
            edge1[1] * edge2[2] - edge1[2] * edge2[1],
            edge1[2] * edge2[0] - edge1[0] * edge2[2],
            edge1[0] * edge2[1] - edge1[1] * edge2[0]
        ];

        // 归一化
        const length = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2);
        if (length > 0) {
            normal[0] /= length;
            normal[1] /= length;
            normal[2] /= length;
        }

        // 三个顶点共享同一个法向量
        for (let j = 0; j < 3; j++) {
            normals[i0 + j] = normals[i1 + j] = normals[i2 + j] = normal[j];
        }
    }

    return normals;
}
```

## 裙边处理 (skirt.ts)

### 为什么需要裙边？

不同 LOD 层级的瓦片边缘高度不一致，会产生明显的裂缝。裙边通过在瓦片边缘添加向下延伸的三角形来掩盖这些裂缝。

```
无裙边情况:           有裙边情况:
┌────────┐           ┌────────┐
│  Tile  │           │  Tile  │
├────────┤           ├──┬──┬──┤ ← 裙边
│  Tile  │           │  Tile  │
└────────┘           └────────┘
      ↑ 裂缝              无裂缝
```

### addSkirt() 函数

```typescript
export function addSkirt(
    attributes: AttributesType,
    triangles: Uint16Array | Uint32Array,
    skirtHeight: number,
    outsideIndices?: EdgeIndices
): GeometryDataType {
    // 1. 获取外部边缘
    const outsideEdges = outsideIndices
        ? getOutsideEdgesFromIndices(outsideIndices, attributes.position.value)
        : getOutsideEdgesFromTriangles(triangles);

    const edgeCount = outsideEdges.length;

    // 2. 为每条边创建裙边数据
    const newPosition = new Float32Array(edgeCount * 6);      // 每边2个顶点 × 3坐标
    const newTexcoord0 = new Float32Array(edgeCount * 4);     // 每边2个顶点 × 2纹理
    const newTriangles = new ...(edgeCount * 6);             // 每边2个三角形 × 3索引
    const newNormals = new Float32Array(edgeCount * 6);      // 每边2个顶点 × 3法线

    for (let i = 0; i < edgeCount; i++) {
        updateAttributesForNewEdge({
            edge: outsideEdges[i],
            edgeIndex: i,
            attributes,
            skirtHeight,
            newPosition,
            newTexcoord0,
            newTriangles,
            newNormals,
        });
    }

    // 3. 合并原数据和裙边数据
    attributes.position.value = concatenateTypedArrays(attributes.position.value, newPosition);
    attributes.texcoord.value = concatenateTypedArrays(attributes.texcoord.value, newTexcoord0);
    attributes.normal.value = concatenateTypedArrays(attributes.normal.value, newNormals);

    return {
        attributes,
        indices: concatenateTypedArrays(triangles, newTriangles),
    };
}
```

### 边缘检测

```typescript
function getOutsideEdgesFromTriangles(triangles: Uint16Array | Uint32Array): number[][] {
    const edges: number[][] = [];

    // 提取所有边
    for (let i = 0; i < triangles.length; i += 3) {
        const a = triangles[i];
        const b = triangles[i + 1];
        const c = triangles[i + 2];
        edges.push([a, b], [b, c], [c, a]);
    }

    // 排序边
    edges.sort(([a1, b1], [a2, b2]) => {
        const minA = Math.min(a1, b1);
        const minB = Math.min(a2, b2);
        return minA !== minB ? minA - minB : Math.max(a1, b1) - Math.max(a2, b2);
    });

    // 找出只出现一次的边（外部边）
    const outsideEdges: number[][] = [];
    for (let i = 0; i < edges.length; i++) {
        // 如果当前边与下一条边不重复，则是外部边
        if (i + 1 < edges.length &&
            edges[i][0] === edges[i + 1][1] &&
            edges[i][1] === edges[i + 1][0]) {
            i++; // 跳过内部边
        } else {
            outsideEdges.push(edges[i]);
        }
    }

    return outsideEdges;
}
```

**原理**: 内部边被两个三角形共享（正反向各出现一次），外部边只被一个三角形使用。

### 裙边三角形生成

```typescript
function updateAttributesForNewEdge({ edge, skirtHeight, ... }) {
    const positionsLength = attributes.position.value.length;
    const vertex1Offset = edgeIndex * 2;
    const vertex2Offset = vertex1Offset + 1;

    // 复制边缘顶点坐标，并向下偏移 skirtHeight
    newPosition.set(
        attributes.position.value.subarray(edge[0] * 3, edge[0] * 3 + 3),
        vertex1Offset * 3
    );
    newPosition[vertex1Offset * 3 + 2] -= skirtHeight; // 向下偏移

    newPosition.set(
        attributes.position.value.subarray(edge[1] * 3, edge[1] * 3 + 3),
        vertex2Offset * 3
    );
    newPosition[vertex2Offset * 3 + 2] -= skirtHeight;

    // 复制纹理坐标
    newTexcoord0.set(attributes.texcoord.value.subarray(edge[0] * 2, edge[0] * 2 + 2), vertex1Offset * 2);
    newTexcoord0.set(attributes.texcoord.value.subarray(edge[1] * 2, edge[1] * 2 + 2), vertex2Offset * 2);

    // 创建两个三角形形成裙边
    const triangle1Offset = edgeIndex * 2 * 3;
    newTriangles[triangle1Offset] = edge[0];
    newTriangles[triangle1Offset + 1] = positionsLength / 3 + vertex2Offset;
    newTriangles[triangle1Offset + 2] = edge[1];

    newTriangles[triangle1Offset + 3] = positionsLength / 3 + vertex2Offset;
    newTriangles[triangle1Offset + 4] = edge[0];
    newTriangles[triangle1Offset + 5] = positionsLength / 3 + vertex1Offset;

    // 法向量朝上
    newNormals[triangle1Offset] = 0;
    newNormals[triangle1Offset + 1] = 0;
    newNormals[triangle1Offset + 2] = 1;
    // ... 第二个三角形
}
```

裙边三角形结构：

```
原始边缘:
v0 ──────────── v1
 │              │
 │              │
▼裙边          ▼裙边
v0' ─────────── v1'

三角形1: v0 - v1' - v1
三角形2: v1' - v0 - v0'
```

## 数据流程

```
DEM数据
    │
    ▼
getGeometryDataFromDem()
    │
    ├──► getGridIndices()  ──► 三角形索引数组
    │
    └──► getAttributes()    ──► 顶点属性
              │
              ├──► 顶点坐标
              ├──► UV坐标
              └──► getNormals() ──► 法向量
    │
    ▼
addSkirt()  ──► 添加裙边
    │
    ▼
TileGeometry.setData()  ──► 设置几何体属性
    │
    ▼
BufferGeometry (Three.js)
```

## 关键参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `skirtHeight` | 1000 | 裙边高度（米） |
| DEM 尺寸 | 257×257 | Martini 算法要求的 2^n+1 |
| 坐标范围 | -0.5 ~ 0.5 | 归一化局部坐标 |
