# Martini 地形简化算法详解

## 概述

Martini 算法是由 Mapbox 开发的高效地形网格简化算法，基于 RTIN (Right-Triangulated Irregular Networks，右三角不规则网络) 方法。该算法能够根据指定的误差阈值快速生成简化地形网格。

**源码位置**: `packages/lib/src/geometry/Martini.ts`

**原始论文**: "Right Triangulated Irregular Networks"
**参考实现**: https://github.com/mapbox/martini

## 算法原理

### RTIN 结构

RTIN 使用二叉树结构组织三角形层次：

```
层级0 (最粗糙):
┌─────────────────────────────────────┐
│                                     │
│                                     │
│                    /│               │
│                  /  │               │
│                /    │               │
│              /      │               │
│            /        │               │
│          /          │               │
│        /            │               │
│      /              │               │
│    /                │               │
│  /                  │               │
│/                    │               │
└─────────────────────────────────────┘
```

每次细分将一个三角形分成两个较小的直角三角形。

### 三角形坐标系统

算法使用隐式二叉树存储三角形坐标，避免显式存储：

```
设三角形索引为 i，其坐标 (ax, ay), (bx, by) 通过以下方式计算：

1. id = i + 2
2. 根据 id 的二进制位遍历树结构
3. 每次根据位值决定左半或右半
4. 最终得到三角形的两个顶点坐标
```

## Martini 类

```typescript
export class Martini {
    public gridSize: number;          // 网格尺寸 (2^n + 1)
    public numTriangles: number;      // 三角形数量
    public numParentTriangles: number; // 父三角形数量
    public indices: Uint32Array;      // 三角形索引
    public coords: Uint16Array;       // 三角形坐标

    public constructor(gridSize: number = 257) {
        this.gridSize = gridSize;
        const tileSize = gridSize - 1;

        // 网格尺寸必须是 2^n + 1
        if (tileSize & (tileSize - 1)) {
            throw new Error(`Expected grid size to be 2^n+1, got ${gridSize}.`);
        }

        // 计算三角形数量
        this.numTriangles = tileSize * tileSize * 2 - 2;
        this.numParentTriangles = this.numTriangles - tileSize * tileSize;

        this.indices = new Uint32Array(this.gridSize * this.gridSize);

        // 预计算所有可能的三角形坐标
        this.coords = new Uint16Array(this.numTriangles * 4);

        for (let i = 0; i < this.numTriangles; i++) {
            this._getTriangleCoords(i);
        }
    }

    /**
     * 获取三角形坐标
     */
    private _getTriangleCoords(i: number): void {
        let id = i + 2;
        let ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0;

        // 根据最低位确定三角形方向
        if (id & 1) {
            // 左下三角形
            bx = by = cx = tileSize;
        } else {
            // 右上三角形
            ax = ay = cy = tileSize;
        }

        // 遍历二进制位，在二叉树中定位
        while ((id >>= 1) > 1) {
            const mx = (ax + bx) >> 1;
            const my = (ay + by) >> 1;

            if (id & 1) {
                // 左半
                bx = ax; by = ay;
                ax = cx; ay = cy;
            } else {
                // 右半
                ax = bx; ay = by;
                bx = cx; by = cy;
            }
            cx = mx; cy = my;
        }

        const k = i * 4;
        this.coords[k + 0] = ax;
        this.coords[k + 1] = ay;
        this.coords[k + 2] = bx;
        this.coords[k + 3] = by;
    }

    public createTile(terrain: Float32Array): MartiniTile {
        return new MartiniTile(terrain, this);
    }
}
```

## MartiniTile 类

```typescript
class MartiniTile {
    public martini: Martini;
    public terrain: Float32Array;  // 高程数据
    public errors: Float32Array;   // 误差数据

    public constructor(terrain: Float32Array, martini: Martini) {
        const size = martini.gridSize;

        if (terrain.length !== size * size) {
            throw new Error(
                `Expected terrain data of length ${size * size} (${size} x ${size}), got ${terrain.length}.`
            );
        }

        this.terrain = terrain;
        this.martini = martini;
        this.errors = new Float32Array(terrain.length);
        this.update();
    }
}
```

## 误差计算

```typescript
public update(): void {
    const { numTriangles, numParentTriangles, coords, gridSize: size } = this.martini;
    const { terrain, errors } = this;

    // 从最底层（最小三角形）向上遍历
    for (let i = numTriangles - 1; i >= 0; i--) {
        const k = i * 4;
        const ax = coords[k + 0];
        const ay = coords[k + 1];
        const bx = coords[k + 2];
        const by = coords[k + 3];

        // 计算中点坐标
        const mx = (ax + bx) >> 1;
        const my = (ay + by) >> 1;
        const cx = mx + my - ay;
        const cy = my + ax - mx;

        // 计算插值高度（两个端点的平均）
        const interpolatedHeight = (terrain[ay * size + ax] + terrain[by * size + bx]) / 2;

        // 计算中点的实际高度与插值高度的差（误差）
        const middleIndex = my * size + mx;
        const middleError = Math.abs(interpolatedHeight - terrain[middleIndex]);

        errors[middleIndex] = Math.max(errors[middleIndex], middleError);

        // 如果是父三角形，累加子三角形的误差
        if (i < numParentTriangles) {
            const leftChildIndex = ((ay + cy) >> 1) * size + ((ax + cx) >> 1);
            const rightChildIndex = ((by + cy) >> 1) * size + ((bx + cx) >> 1);
            errors[middleIndex] = Math.max(
                errors[middleIndex],
                errors[leftChildIndex],
                errors[rightChildIndex]
            );
        }
    }
}
```

### 误差计算图解

```
三角形结构:

A ──────── B
  \       /
    \   /
      M     (中点)
    /   \
  /       \
C ──────── D

误差 = |实际高度(M) - 插值高度((A+B)/2)|
```

## 网格生成

```typescript
public getGeometryData(maxError: number = 0): GeometryDataType {
    const { gridSize: size, indices } = this.martini;
    const { errors } = this;
    let numVertices = 0;
    let numTriangles = 0;
    const max = size - 1;

    indices.fill(0);

    // 第一阶段：统计顶点和三角形数量
    countElements(0, 0, max, max, max, 0);
    countElements(max, max, 0, 0, 0, max);

    // 分配数组
    const vertices = new Uint16Array(numVertices * 2);
    const triangles = new Uint32Array(numTriangles * 3);

    // 第二阶段：填充顶点和三角形数据
    processTriangle(0, 0, max, max, max, 0);
    processTriangle(max, max, 0, 0, 0, max);

    return {
        attributes: this._getMeshAttributes(this.terrain, vertices, triangles),
        indices: triangles,
    };

    function countElements(ax, ay, bx, by, cx, cy) {
        const mx = (ax + bx) >> 1;
        const my = (ay + by) >> 1;

        // 如果三角形跨度大于1且中点误差超过阈值，则细分
        if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * size + mx] > maxError) {
            countElements(cx, cy, ax, ay, mx, my);   // 左子
            countElements(bx, by, cx, cy, mx, my);   // 右子
        } else {
            // 记录顶点索引
            aIndex = ay * size + ax;
            bIndex = by * size + bx;
            cIndex = cy * size + cx;

            if (indices[aIndex] === 0) indices[aIndex] = ++numVertices;
            if (indices[bIndex] === 0) indices[bIndex] = ++numVertices;
            if (indices[cIndex] === 0) indices[cIndex] = ++numVertices;
            numTriangles++;
        }
    }

    function processTriangle(ax, ay, bx, by, cx, cy) {
        const mx = (ax + bx) >> 1;
        const my = (ay + by) >> 1;

        if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * size + mx] > maxError) {
            processTriangle(cx, cy, ax, ay, mx, my);
            processTriangle(bx, by, cx, cy, mx, my);
        } else {
            const a = indices[ay * size + ax] - 1;
            const b = indices[by * size + bx] - 1;
            const c = indices[cy * size + cx] - 1;

            vertices[2 * a] = ax;
            vertices[2 * a + 1] = ay;
            vertices[2 * b] = bx;
            vertices[2 * b + 1] = by;
            vertices[2 * c] = cx;
            vertices[2 * c + 1] = cy;

            triangles[triIndex++] = a;
            triangles[triIndex++] = b;
            triangles[triIndex++] = c;
        }
    }
}
```

## 属性生成

```typescript
private _getMeshAttributes(
    terrain: Float32Array,
    vertices: Uint16Array,
    indices: Uint16Array | Uint32Array
): AttributesType {
    const gridSize = Math.floor(Math.sqrt(terrain.length));
    const tileSize = gridSize - 1;
    const numOfVerticies = vertices.length / 2;

    // 顶点位置 [-0.5, 0.5] × [-0.5, 0.5] × [高程]
    const positions = new Float32Array(numOfVerticies * 3);

    // 纹理坐标 [0, 1] × [0, 1]
    const texCoords = new Float32Array(numOfVerticies * 2);

    for (let i = 0; i < numOfVerticies; i++) {
        const x = vertices[i * 2];
        const y = vertices[i * 2 + 1];
        const pixelIdx = y * gridSize + x;

        // 位置：归一化到 -0.5 ~ 0.5
        positions[3 * i + 0] = x / tileSize - 0.5;
        positions[3 * i + 1] = 0.5 - y / tileSize;
        positions[3 * i + 2] = terrain[pixelIdx];

        // UV：0 ~ 1
        texCoords[2 * i + 0] = x / tileSize;
        texCoords[2 * i + 1] = 1 - y / tileSize;
    }

    // 计算法向量
    const normals = getNormals(positions, indices);

    return {
        position: { value: positions, size: 3 },
        texcoord: { value: texCoords, size: 2 },
        normal: { value: normals, size: 3 },
    };
}
```

## 使用示例

```typescript
// 创建 Martini 实例
const martini = new Martini(257);  // 257×257 网格

// 假设已有 DEM 数据
const terrain = new Float32Array(257 * 257);
// ... 填充高程数据

// 创建瓦片
const tile = martini.createTile(terrain);

// 根据误差阈值生成简化网格
const maxError = 10;  // 误差阈值（米）
const geometryData = tile.getGeometryData(maxError);

// 创建几何体
const geometry = new TileGeometry();
geometry.setData(geometryData);
```

## 误差阈值选择

| maxError | 三角形数 | 质量 | 适用场景 |
|----------|----------|------|----------|
| 0 | ~130,000 | 最高 | 近距离观察 |
| 5 | ~30,000 | 高 | 一般观察 |
| 10 | ~15,000 | 中 | 远距离观察 |
| 20+ | ~5,000 | 低 | 背景地形 |

## 算法优势

1. **快速**: O(n) 预处理，O(log n) 查询
2. **可控**: 通过误差阈值精确控制简化程度
3. **自适应**: 根据地形复杂度自动调整网格密度
4. **无裂缝**: 相邻 LOD 层级间无缝过渡
5. **内存友好**: 不需要显式存储整个层次结构

## 数据结构图解

```
高程网格 (5×5 示例):
┌───┬───┬───┬───┬───┐
│ 0 │ 1 │ 2 │ 3 │ 4 │
├───┼───┼───┼───┼───┤
│ 5 │ 6 │ 7 │ 8 │ 9 │
├───┼───┼───┼───┼───┤
│ 10│ 11│ 12│ 13│ 14│
├───┼───┼───┼───┼───┤
│ 15│ 16│ 17│ 18│ 19│
├───┼───┼───┼───┼───┤
│ 20│ 21│ 22│ 23│ 24│
└───┴───┴───┴───┴───┘

RTIN 三角形层次:
          ┌─────────────────┐
          │                 │
          │       /│        │
          │     /  │        │
          │   /    │        │
          │ /      │        │
          │─────────│       │
          │ \      │        │
          │   \    │        │
          │     \  │        │
          │       \│        │
          └─────────────────┘
```
