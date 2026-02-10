# Tile 瓦片模块详解

## 概述

`Tile` 类是 Three-Tile 的核心组件，实现了基于四叉树的动态 LOD（Level of Detail）瓦片系统。每个瓦片可以细分为 4 个子瓦片，形成一个树状结构。

**源码位置**: `packages/lib/src/tile/Tile.ts`

## 类结构

```typescript
export class Tile extends Object3D<TTileEventMap> {
    // 瓦片坐标
    public readonly x: number;    // 瓦片X坐标
    public readonly y: number;    // 瓦片Y坐标
    public readonly z: number;    // 瓦片层级

    // 瓦片状态
    private _isLoading: boolean;      // 是否正在加载
    private _model: Mesh | undefined; // 瓦片模型
    private _subTiles: Tile[];        // 子瓦片数组

    // 空间信息
    private _checkPoint: Vector3;     // 距离检测点（世界坐标）
    private _bbox: Box3;              // 包围盒（世界坐标）
    private _sizeInWorld: number;     // 世界空间大小

    // 根瓦片引用
    private _root: Tile;              // 根瓦片
}
```

## 核心属性解析

### 1. 瓦片坐标 (x, y, z)

```typescript
// 瓦片坐标系统
// z: 层级，0为最顶层（全球），数值越大细节越多
// x: 经度方向上的瓦片索引
// y: 纬度方向上的瓦片索引
```

瓦片坐标遵循标准的 XYZ 瓦片编号方案：
- 0 层：全球只有 1 个瓦片 `(0,0,0)`
- 1 层：4 个瓦片
- n 层：2^n × 2^n 个瓦片

### 2. 距离比率 (distRatio)

```typescript
public get distRatio() {
    const distToCamera = cameraWorldPosition.distanceTo(this._checkPoint);
    const ratio = distToCamera / this._sizeInWorld;
    return this.inFrustum ? ratio * 0.8 : ratio * 2;
}
```

**用途**: LOD 评估的关键指标

- `inFrustum = true`: 距离比率 × 0.8（更宽松，容易细化）
- `inFrustum = false`: 距离比率 × 2（更严格，不容易细化）

### 3. 包围盒 (_bbox)

```typescript
private computeTileSize(debug: number) {
    // 计算包围盒（世界坐标）
    this._bbox = new Box3(new Vector3(-0.5, -0.5), new Vector3(0.5, 0.5))
        .applyMatrix4(this.matrixWorld);

    // 垂直方向扩展到包含地形高度
    this._bbox.min.setY(-300);
    this._bbox.max.setY(9000);
}
```

包围盒在垂直方向被大幅扩展，以确保包含各种地形高度。

## 核心方法解析

### 1. update() - 瓦片更新

每帧调用的核心方法，负责瓦片的加载和更新：

```typescript
public update(params: TileUpdateParames) {
    // 1. 获取根瓦片引用
    if (this.parent instanceof Tile) {
        this._root = this.parent._root;
    }

    // 2. 根瓦片计算视锥体和相机位置
    if (this.z === 0) {
        camera.getWorldPosition(cameraWorldPosition);
        frustum.setFromProjectionMatrix(
            tempMat4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        );
    }

    // 3. 计算瓦片大小、包围盒
    if (this._sizeInWorld < 0) {
        this.computeTileSize(loader.debug);
    }

    // 4. 加载或更新瓦片数据
    if (this.z >= minLevel && loader.downloadingThreads < MAXTHREADS) {
        if (!this.model) {
            this._startLoad(loader);  // 首次加载
        } else if (this._isDirty && this.inFrustum) {
            this._startUpdate(loader); // 更新数据
        }
    }

    // 5. LOD 评估
    this.LOD(params);

    // 6. 递归更新子瓦片
    this.subTiles?.forEach(child => child.update(params));
}
```

### 2. LOD() - 细节层次评估

```typescript
protected LOD(params: TileUpdateParames) {
    const action = LODEvaluate(this, minLevel, maxLevel, LODThreshold);

    if (action === LODAction.create) {
        // 细化：创建子瓦片
        const newTiles = createChildren(this, loader);
        this.add(...newTiles);
        this._subTiles = newTiles;
        // 触发事件
        newTiles.forEach(child => {
            this._root.dispatchEvent({ type: "tile-created", tile: child });
        });
    } else if (action === LODAction.remove) {
        // 合并：移除子瓦片
        if (this.model) {
            this.showing = true;
            this.unLoad(loader, false);
        }
    }
}
```

### 3. _startLoad() - 加载瓦片数据

```typescript
private async _startLoad(loader: ITileLoader) {
    this._isLoading = true;
    // 调用加载器获取模型
    this._model = await loader.load(this);
    this._model.geometry.computeBoundingBox();
    // 更新检测点高度为地形最高点
    this._checkPoint.y = this._model.geometry.boundingBox?.max.z || 0;
    // 叶子瓦片检查可见性
    this.isLeaf && this._checkVisible();
    this._isLoading = false;
    // 触发加载完成事件
    this._root.dispatchEvent({ type: "tile-loaded", tile: this });
    this.add(this._model);
}
```

### 4. _checkVisible() - 可见性检查

确保兄弟瓦片全部加载完成后才显示，避免瓦片闪烁：

```typescript
private _checkVisible() {
    const parent = this.parent;
    if (parent instanceof Tile) {
        if (parent.model) {
            const subTiles = parent.subTiles;
            if (subTiles) {
                // 所有子瓦片都加载完成？
                const allLoaded = !subTiles.some(child => !child.model);
                // 同时显示/隐藏所有子瓦片，父瓦片隐藏
                subTiles.forEach(child => (child.showing = allLoaded));
                parent.showing = !allLoaded;
            }
        }
    }
}
```

## LOD 评估算法 (util.ts)

```typescript
export function LODEvaluate(
    tile: Tile,
    minLevel: number,
    maxLevel: number,
    threshold: number
): LODAction {
    // 超过最大层级，移除子瓦片
    if (!tile.isLeaf && tile.z > maxLevel) {
        return LODAction.remove;
    }

    const distRatio = tile.distRatio;

    // 需要细化条件：
    // 1. 是叶子节点
    // 2. 在视锥体内
    // 3. 未达最大层级
    // 4. 距离比率小于阈值
    // 5. 瓦片已显示或在最小层级以上
    if (
        tile.isLeaf &&
        tile.inFrustum &&
        tile.z < maxLevel &&
        distRatio < threshold &&
        (tile.showing || tile.z <= minLevel)
    ) {
        return LODAction.create;
    }

    // 需要合并条件：
    // 1. 不是叶子节点（有子瓦片）
    // 2. 达到最小层级
    // 3. 距离比率大于阈值
    if (!tile.isLeaf && tile.z >= minLevel && distRatio > threshold) {
        return LODAction.remove;
    }

    return LODAction.none;
}
```

## 子瓦片创建 (util.ts)

```typescript
export function createChildren(parentTile: Tile, loader: ITileLoader): Tile[] {
    const { x: parentX, y: parentY, z: parentZ } = parentTile;
    const children: Tile[] = [];

    const x = parentX * 2;      // 子瓦片X = 父瓦片X * 2
    const z = parentZ + 1;      // 子瓦片层级 = 父瓦片层级 + 1
    const p = 0.25;             // 位置偏移量
    const sx = 0.5;             // 缩放比例
    const sz = 1.0;             // Z方向缩放

    // EPSG:4326 投影的0级特殊处理（只有2个子瓦片）
    if (parentZ === 0 && loader.projectionID === "4326") {
        const y = parentY;
        const sy = 1.0;
        const t1 = creatTile(x, y, z, -p, 0, sx, sy, sz);
        const t2 = creatTile(x + 1, y, z, p, 0, sx, sy, sz);
        children.push(t1, t2);
    } else {
        // 标准4叉树细分
        const y = parentY * 2;
        const sy = 0.5;
        const t1 = creatTile(x, y, z, -p, p, sx, sy, sz);     // 左上
        const t2 = creatTile(x + 1, y, z, p, p, sx, sy, sz);  // 右上
        const t3 = creatTile(x, y + 1, z, -p, -p, sx, sy, sz);// 左下
        const t4 = creatTile(x + 1, y + 1, z, p, -p, sx, sy, sz); // 右下
        children.push(t1, t2, t3, t4);
    }

    return children;
}
```

## 事件系统

瓦片事件都由根瓦片发出，便于统一监听：

```typescript
interface TTileEventMap extends Object3DEventMap {
    "tile-created": BaseEvent & { tile: Tile };      // 瓦片创建
    "tile-loaded": BaseEvent & { tile: Tile };       // 瓦片加载完成
    "tile-unload": BaseEvent & { tile: Tile };       // 瓦片卸载
    "tile-visible-changed": BaseEvent & { tile: Tile; visible: boolean }; // 可见性变化
}
```

## 数据流程

```
┌─────────────────────────────────────────────────────────────┐
│                      update() 每帧调用                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  计算空间信息     │
                    │  - 包围盒        │
                    │  - 检测点        │
                    │  - 世界大小      │
                    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  需要加载数据?   │
                    └─────────────────┘
                       │           │
                      是           否
                       │           │
                       ▼           ▼
              ┌─────────────┐   ┌─────────────────┐
              │ _startLoad  │   │    LOD评估       │
              └─────────────┘   └─────────────────┘
                       │                │
                       │        ┌───────┴───────┐
                       │        ▼               ▼
                       │    细化(create)    合并/remove
                       │        │               │
                       │        ▼               ▼
                       │   createChildren    unload()
                       │        │               │
                       └────────┴───────────────┘
                                        │
                                        ▼
                              ┌─────────────────┐
                              │  递归更新子瓦片   │
                              └─────────────────┘
```

## 关键常量

```typescript
const MAXTHREADS = 10;  // 最大并发下载数
```

这是全局下载并发控制，防止过多请求导致性能问题。
