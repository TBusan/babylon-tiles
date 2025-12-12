# distRatio 问题修复

## 🔴 问题确诊

从控制台日志明确看到：

```
[Tile LOD] z=0, distRatio=430.11, LODThreshold=1, inFrustum=true, maxLevel=18, hasModel=true, hasSubTiles=false
[Tile LOD] Should create children: false
```

**问题**: `distRatio (430.11) >> LODThreshold (1)`

LOD 条件要求：`distRatio < LODThreshold`
- 实际：430.11 < 1 = **false** ❌
- 结果：永远不会创建子瓦片

## 📊 distRatio 计算分析

```typescript
distRatio = distToCamera / sizeInWorld
```

当前值 430.11 意味着：
- 相机距离瓦片中心非常远
- 或者瓦片的 `sizeInWorld` 很小
- 导致比值很大

## ✅ 已应用的修复

### 修复 1: 增加 LODThreshold

```typescript
// demo/src/main.ts
map.LODThreshold = 500;  // 从默认的 1 增加到 500
```

**效果**: 
- 现在 430.11 < 500 = **true** ✅
- 子瓦片应该会开始创建

### 修复 2: 减小相机距离

```typescript
// demo/src/main.ts - initViewer()
viewer.setCameraPosition(
  -Math.PI / 2,
  Math.PI / 4,
  1000000,  // 从 5000000 减小到 1000000
  Vector3.Zero()
);
```

**效果**:
- 相机更靠近地图
- distRatio 会变小
- 预计新的 distRatio 约为 86（430 * 1000000 / 5000000）

## 🧪 测试步骤

### 1. 重新构建 demo

```bash
cd babylon-tiles/packages/demo
npm run dev
```

### 2. 查看新的控制台日志

应该看到：

```
[Tile LOD] z=0, distRatio=~86, LODThreshold=500, inFrustum=true
[Tile LOD] Should create children: true  ← 现在应该是 true！
[Tile LOD] Creating children for tile 0/0/0
[Tile] Starting load for tile 1/0/0
[Tile] Starting load for tile 1/0/1
[Tile] Starting load for tile 1/1/0
[Tile] Starting load for tile 1/1/1
```

### 3. 测试交互

- **滚轮缩放**: 应该看到瓦片动态加载/卸载
- **鼠标拖动**: 地图应该旋转
- **Network 面板**: 应该看到多个层级的瓦片请求

## 📐 理解 distRatio 和 LODThreshold

### distRatio 的含义

```
distRatio = 相机到瓦片的距离 / 瓦片在世界坐标中的大小
```

- **distRatio 小**: 相机靠近瓦片 → 需要更高细节 → 创建子瓦片
- **distRatio 大**: 相机远离瓦片 → 不需要细节 → 使用当前瓦片

### LODThreshold 的作用

- **阈值越小**: 越容易创建子瓦片，地图越精细，性能开销越大
- **阈值越大**: 越难创建子瓦片，地图越粗糙，性能开销越小

### 典型值对比

| 场景 | 相机距离 | LODThreshold | distRatio | 行为 |
|------|---------|--------------|-----------|------|
| Three.js 默认 | 中等 | 1 | ~0.5-2 | 正常加载 |
| Babylon.js 初始 | 5000000 | 1 | ~430 | 不加载 ❌ |
| Babylon.js 修复后 | 1000000 | 500 | ~86 | 正常加载 ✅ |

## 🔧 长期优化建议

### 方案 A: 调整投影和缩放

检查 `TileMap` 的投影设置，确保地图缩放合理：

```typescript
// TileMap.ts - _resize()
this.rootTile.scaling.set(
  this.projection.mapWidth,
  this.projection.mapHeight,
  this.projection.mapDepth
);
```

可能需要调整这些缩放值。

### 方案 B: 调整瓦片大小计算

检查 `Tile.ts` 的 `computeTileSize` 方法：

```typescript
const min = new Vector3(-0.5, -0.5, -300);
const max = new Vector3(0.5, 0.5, 9000);
const size = max.subtract(min);
this._sizeInWorld = size.length();
```

确保 `_sizeInWorld` 的计算合理。

### 方案 C: 动态 LOD 阈值

根据相机距离动态调整：

```typescript
// 在 TileMap.update 中
const cameraDistance = this.camera.radius; // ArcRotateCamera
const dynamicThreshold = Math.max(1, cameraDistance / 10000);
map.LODThreshold = dynamicThreshold;
```

## 🎯 预期结果

修复后应该看到：

1. ✅ rootTile (0/0/0) 加载
2. ✅ 4 个 level-1 子瓦片加载
3. ✅ 滚轮缩放时动态加载更多层级
4. ✅ Network 面板显示不同层级的请求
5. ✅ 地图细节随缩放增加

## 🐛 如果还有问题

### 问题：子瓦片创建了但看不见

检查：
1. Mesh 的可见性
2. Material 是否正确应用
3. 相机是否能看到子瓦片位置

### 问题：创建了太多子瓦片

降低 LODThreshold：
```typescript
map.LODThreshold = 200;  // 减小一些
```

### 问题：缩放时瓦片加载太慢

调整：
```typescript
// 增加最大下载线程数
const MAXTHREADS = 20;  // 在 Tile.ts 顶部
```

## 📝 总结

**根本原因**: 相机距离设置太大（5000000），导致 distRatio 值过大（430），远超默认的 LODThreshold (1)。

**修复方案**: 
1. 增加 LODThreshold 到 500
2. 减小相机初始距离到 1000000

**效果**: distRatio 约为 86，小于 LODThreshold 500，满足创建子瓦片的条件。

现在重新运行 demo，应该能看到子瓦片正常加载了！🎉

