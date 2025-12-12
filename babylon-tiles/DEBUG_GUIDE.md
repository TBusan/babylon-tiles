# Babylon Tiles 调试指南

## 当前问题
地图创建成功但没有加载底图瓦片资源，浏览器 Network 中没有看到对 ArcGIS 服务器的请求。

## 已添加的调试日志

### 1. TileMap 构造函数日志
```
[TileMap] Constructor called
[TileMap] Setting imgSource
[TileMap] Constructor completed. RootTile: ...
```

### 2. TileMap update 方法日志（首次调用）
```
[TileMap] First update call
```

### 3. Tile update 方法日志
```
[Tile] Starting load for tile z/x/y
[Tile] Calling loader.load for tile z/x/y
[Tile] Loaded model for tile z/x/y
```

### 4. TileMapLoader load 方法日志
```
[TileMapLoader] Loading tile z/x/y
[TileMapLoader] Created mesh for tile z/x/y
[TileMapLoader] Applied geometry to tile z/x/y
[TileMapLoader] Applied material to tile z/x/y
```

### 5. TileImageLoader load 方法日志
```
[TileImageLoader] Generated URL for tile z/x/y: <url>
[TileImageLoader] Created material for tile z/x/y
[TileImageLoader] Texture loaded successfully for tile z/x/y
[TileImageLoader] Returning material for tile z/x/y
```

## 预期的日志流程

如果一切正常，您应该在控制台看到以下顺序的日志：

```
1. [TileMap] Constructor called { minLevel: 2, maxLevel: 18, lon0: 0, debug: 0 }
2. [TileMap] Setting imgSource [TileSource]
3. [TileMap] Constructor completed. RootTile: Tile
4. Map created successfully!
5. [TileMap] First update call { camera, minLevel, maxLevel, ... }
6. [Tile] Starting load for tile 0/0/0
7. [Tile] Calling loader.load for tile 0/0/0
8. [TileMapLoader] Loading tile 0/0/0
9. [TileMapLoader] Created mesh for tile 0/0/0
10. [TileMapLoader] Applied geometry to tile 0/0/0
11. [TileImageLoader] Generated URL for tile 0/0/0: https://server.arcgisonline.com/...
12. [TileImageLoader] Created material for tile 0/0/0
13. [TileMapLoader] Applied material to tile 0/0/0
14. [Tile] Loaded model for tile 0/0/0
15. [TileImageLoader] Texture loaded successfully for tile 0/0/0
16. [Network] 请求 https://server.arcgisonline.com/.../tile/0/0/0
```

## 可能的问题点

### 问题 1: update 方法没有被调用
**症状**: 只看到构造函数日志，没有看到 "First update call"

**可能原因**:
- `viewer.scene.registerBeforeRender` 没有正确注册
- `map.autoUpdate` 被设置为 false
- 渲染循环没有启动

**解决方法**:
检查 `main.ts` 中的渲染循环注册：
```typescript
viewer.scene.registerBeforeRender(() => {
  map.update(viewer.camera);
});
```

### 问题 2: Tile.update 没有被调用
**症状**: 看到 "First update call"，但没有看到 "[Tile] Starting load"

**可能原因**:
- `rootTile.parent` 没有正确设置
- `minLevel` 设置问题（rootTile z=0，但 minLevel=2）
- `loader.downloadingThreads >= MAXTHREADS`

**解决方法**:
1. 检查 `Tile.ts` 的 update 方法条件：
```typescript
if (!this.parent || this._isLoading) {
  return; // 如果没有 parent，会直接返回
}
```

2. 检查 minLevel 条件：
```typescript
if (this.z >= minLevel && loader.downloadingThreads < MAXTHREADS) {
  // rootTile 的 z=0，如果 minLevel=2，这个条件不满足！
}
```

**这是关键问题！** rootTile 的 z=0，但 minLevel=2，所以 rootTile 不会加载数据！

### 问题 3: loader.load 没有被调用
**症状**: 看到 "[Tile] Starting load"，但没有看到 "[TileMapLoader] Loading"

**可能原因**:
- loader 未正确传递
- async/await 出错

### 问题 4: URL 没有生成
**症状**: 看到 loader.load 调用，但没有看到 "Generated URL"

**可能原因**:
- imgSource 没有正确设置
- LoaderFactory 没有找到对应的 loader

## 核心问题分析

### 🔴 关键问题：minLevel 与 rootTile.z 不匹配

在 Three.js 版本中，rootTile 的 z=0，但 demo 中设置 `minLevel: 2`。

查看 `Tile.ts` 的 update 方法：
```typescript
if (this.z >= minLevel && loader.downloadingThreads < MAXTHREADS) {
  // Download tile
  if (!this.model) {
    this._startLoad(loader);
    return;
  }
}
```

**rootTile (z=0) < minLevel (2)**，所以 rootTile 永远不会加载！

### 解决方案

有两种解决方案：

#### 方案 1: 修改 demo 中的 minLevel（推荐）
```typescript
const map = new BT.TileMap({
  scene: viewer.scene,
  imgSource: imgSource,
  minLevel: 0,  // 改为 0，允许 rootTile 加载
  maxLevel: 18,
  // ...
});
```

#### 方案 2: 修改 Tile.ts 的逻辑
让 rootTile (z=0) 总是尝试加载，无论 minLevel 是多少：
```typescript
// 特殊处理 rootTile
const isRootTile = this.z === 0;
if ((isRootTile || this.z >= minLevel) && loader.downloadingThreads < MAXTHREADS) {
  if (!this.model) {
    this._startLoad(loader);
    return;
  }
}
```

## 验证步骤

### 步骤 1: 重新构建 lib 包
```bash
cd packages/lib
npm run build
```

### 步骤 2: 修改 demo
将 `minLevel` 从 2 改为 0：
```typescript
const map = new BT.TileMap({
  scene: viewer.scene,
  imgSource: imgSource,
  minLevel: 0,  // 修改这里
  maxLevel: 18,
  debug: 0,
});
```

### 步骤 3: 启动 demo 并查看控制台
```bash
cd packages/demo
npm run dev
```

打开浏览器开发者工具，查看：
1. **Console** - 应该看到上述日志序列
2. **Network** - 应该看到对 ArcGIS 的请求

### 步骤 4: 检查渲染
如果看到网络请求但没有渲染：
- 检查材质是否正确应用
- 检查 mesh 是否可见 (`mesh.isVisible = true`)
- 检查 mesh 是否在场景中
- 检查相机位置和方向

## 其他潜在问题

### 场景图结构问题

在 Three.js 中：
```typescript
this.add(rootTile);  // 明确将 rootTile 添加到 map
```

在 Babylon.js 中：
```typescript
this.rootTile.parent = this;  // 设置父子关系
```

在 Babylon.js 中，设置 `parent` 应该足够建立场景图关系，但需要确保：
1. TileMap 本身在场景中
2. rootTile 的 scene 正确设置
3. 子 mesh 正确添加到 tile

### Mesh 可见性问题

检查创建的 mesh 是否默认可见：
```typescript
const mesh = new Mesh(`tile-${params.z}-${params.x}-${params.y}`, this.scene);
mesh.isVisible = true;  // 确保可见
mesh.setEnabled(true);  // 确保启用
```

## 总结

**最可能的问题**: `minLevel: 2` 导致 `rootTile (z=0)` 不满足加载条件。

**立即行动**: 将 demo 中的 `minLevel` 改为 0，重新构建并测试。

