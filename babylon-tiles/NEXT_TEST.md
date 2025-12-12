# 下一次测试指南

## 当前状态

根据您的日志：
```
[Tile inFrustum] Mesh frustum check for tile 0/0/0: true
[Tile LOD] Should create children: false
```

## 关键发现

1. ✅ `inFrustum = true` - 视锥体检查通过
2. ❌ `Should create children: false` - LOD 条件不满足
3. ❌ **没有看到 `distRatio` 的值** - 这是关键问题！

## 已添加的新日志

刚才我添加了更多调试日志，现在**重新构建并测试**，您应该看到：

```bash
cd babylon-tiles/packages/lib
npm run build

cd ../demo
npm run dev
```

## 预期的新日志

现在应该每帧都能看到：

```
[Tile] Reached LOD check for tile 0/0/0, hasModel=true/false
[Tile LOD] z=0, distRatio=XXX, LODThreshold=1, inFrustum=true, maxLevel=18, hasModel=true/false, hasSubTiles=false
[Tile LOD] Should create children: true/false
```

## 诊断场景

### 场景 1: 看到 `isLoading=true`

```
[Tile] Skipping update for tile 0/0/0 - isLoading=true
```

**问题**: 瓦片一直在加载状态，永远不会完成

**可能原因**:
- `_startLoad` 方法中的 async 操作出错
- `_isLoading` 没有正确重置

### 场景 2: `distRatio` 非常大

```
[Tile LOD] distRatio=500.00, LODThreshold=1
```

**问题**: 相机距离太远

**临时修复**:
```typescript
// 在 demo/main.ts 的 createMap() 后添加
map.LODThreshold = 1000;  // 大幅增加阈值
```

### 场景 3: 没有到达 LOD 检查

如果根本看不到 `[Tile] Reached LOD check`，说明：
- `_isLoading` 一直是 true
- 或者 update 方法根本没被调用

## 两个主要问题

### 问题 1: 瓦片没有显示（更严重）

您提到"加载的瓦片并没有在界面上显示出来"。

**可能原因**:
1. Mesh 不可见
2. 相机位置/方向不对
3. Material 没有正确应用
4. Mesh 没有正确添加到场景

**检查方法**:
在浏览器控制台手动检查：
```javascript
// 查看场景中的所有 mesh
viewer.scene.meshes.forEach(m => console.log(m.name, m.isVisible, m.material));
```

### 问题 2: LOD 不工作

这是我们正在诊断的问题。

## 立即行动清单

### 步骤 1: 重新构建
```bash
cd babylon-tiles/packages/lib
npm run build
```

### 步骤 2: 启动 demo
```bash
cd ../demo
npm run dev
```

### 步骤 3: 查看新日志

特别注意：
- 是否看到 `Reached LOD check`？
- `distRatio` 的具体值是多少？
- `hasModel` 是 true 还是 false？
- 是否看到 `isLoading=true`？

### 步骤 4: 检查可见性

在浏览器控制台执行：
```javascript
// 查看所有瓦片 mesh
viewer.scene.meshes.filter(m => m.name.startsWith('tile-')).forEach(m => {
  console.log(m.name, {
    isVisible: m.isVisible,
    isEnabled: m.isEnabled(),
    position: m.position,
    material: m.material?.name,
    parent: m.parent?.name
  });
});
```

## 快速修复尝试

### 修复 A: 强制可见性

在 `TileMapLoader.ts` 的 `load` 方法中添加：

```typescript
mesh.isVisible = true;
mesh.setEnabled(true);
console.log(`[TileMapLoader] Mesh visibility set: ${mesh.isVisible}, enabled: ${mesh.isEnabled()}`);
```

### 修复 B: 增大 LOD 阈值

在 `demo/main.ts` 中：

```typescript
const map = new BT.TileMap({
  // ...
});
map.LODThreshold = 100;  // 临时设置一个很大的值
```

### 修复 C: 调整相机

```typescript
viewer.setCameraPosition(
  0,              // alpha
  Math.PI / 4,    // beta
  100000,         // radius - 大幅减小
  Vector3.Zero()
);
```

## 决策树

```
重新构建后查看日志
│
├─ 看到 "Reached LOD check"？
│  ├─ 是 → 查看 distRatio
│  │  ├─ distRatio > 100 → 增大 LODThreshold 或减小相机距离
│  │  └─ distRatio < 1 → 应该创建子瓦片，检查其他条件
│  │
│  └─ 否 → 查看是否有 "isLoading=true"
│     ├─ 是 → _isLoading 没有正确重置，检查 _startLoad
│     └─ 否 → update 方法没被调用，检查渲染循环
│
└─ 瓦片是否可见？
   ├─ 否 → 修复可见性问题（修复 A）
   └─ 是 → 继续诊断 LOD 问题
```

## 预期的完整日志流程

```
[TileMap] First update call
[Tile] Starting load for tile 0/0/0
[Tile] Calling loader.load for tile 0/0/0
[TileMapLoader] Loading tile 0/0/0
[TileMapLoader] Created mesh for tile 0/0/0
[TileMapLoader] Applied geometry to tile 0/0/0
[TileImageLoader] Generated URL for tile 0/0/0: ...
[TileMapLoader] Applied material to tile 0/0/0
[Tile] Loaded model for tile 0/0/0
[TileImageLoader] Texture loaded successfully for tile 0/0/0

// 后续每帧应该看到：
[Tile] Reached LOD check for tile 0/0/0, hasModel=true
[Tile inFrustum] Mesh frustum check for tile 0/0/0: true
[Tile LOD] z=0, distRatio=0.50, LODThreshold=1, inFrustum=true, maxLevel=18, hasModel=true, hasSubTiles=false
[Tile LOD] Should create children: true
[Tile LOD] Creating children for tile 0/0/0
[Tile] Starting load for tile 1/0/0
[Tile] Starting load for tile 1/0/1
[Tile] Starting load for tile 1/1/0
[Tile] Starting load for tile 1/1/1
```

## 请提供

1. **新的控制台日志** - 特别是：
   - 是否看到 "Reached LOD check"？
   - distRatio 的值
   - 是否看到 "isLoading=true"？

2. **可见性检查结果** - 在控制台执行上述命令的输出

3. **3D 视图截图** - 让我看看实际渲染情况

有了这些信息，我就能精确定位问题并给出解决方案！

