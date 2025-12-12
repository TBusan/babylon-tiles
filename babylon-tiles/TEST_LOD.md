# LOD 子瓦片加载测试指南

## 当前状态

已添加详细的调试日志来诊断 LOD 问题：
- ✅ LOD 条件检查日志
- ✅ distRatio 计算日志  
- ✅ inFrustum 判断日志

## 测试步骤

### 1. 重新构建 lib 包

```bash
cd babylon-tiles/packages/lib
npm run build
```

### 2. 启动 demo

```bash
cd ../demo
npm run dev
```

### 3. 查看控制台输出

打开浏览器开发者工具，查看控制台，应该看到类似：

```
[TileMap] First update call
[Tile] Starting load for tile 0/0/0
...
[Tile] Loaded model for tile 0/0/0
[Tile inFrustum] Mesh frustum check for tile 0/0/0: true/false
[Tile LOD] z=0, distRatio=XXX, LODThreshold=1, inFrustum=true/false, maxLevel=18
[Tile LOD] Should create children: true/false
```

### 4. 分析日志并采取行动

#### 场景 A: `inFrustum = false`

**日志示例**:
```
[Tile inFrustum] Mesh frustum check for tile 0/0/0: false
[Tile LOD] inFrustum=false
[Tile LOD] Should create children: false
```

**问题**: 视锥体检查失败

**解决方案**: 
```typescript
// 在 Tile.ts 中临时修改
public get inFrustum(): boolean {
  return true;  // 强制返回 true 测试
}
```

重新构建并测试，如果子瓦片开始加载，说明确实是 frustum 检查的问题。

#### 场景 B: `distRatio` 太大

**日志示例**:
```
[Tile inFrustum] Mesh frustum check for tile 0/0/0: true
[Tile distRatio] distToCamera=5000000, sizeInWorld=XXX, ratio=YYY, finalRatio=ZZZ
[Tile LOD] z=0, distRatio=100, LODThreshold=1, inFrustum=true
[Tile LOD] Should create children: false  ← distRatio > LODThreshold
```

**问题**: 相机距离太远

**解决方案 1 - 调整相机距离**:
```typescript
// 在 demo/main.ts 的 initViewer() 中
viewer.setCameraPosition(
  -Math.PI / 2,
  Math.PI / 4,
  500000,  // 减小这个值，原来是 5000000
  Vector3.Zero()
);
```

**解决方案 2 - 增加 LOD 阈值**:
```typescript
// 在 demo/main.ts 的 createMap() 中
const map = new BT.TileMap({
  // ...
});
map.LODThreshold = 5;  // 增加阈值
```

#### 场景 C: 条件都满足但不创建

**日志示例**:
```
[Tile LOD] Should create children: true
// 但没有看到 "Creating children for tile 0/0/0"
```

**问题**: createChildren 方法有问题或被跳过

**检查**: 确认 `!this.subTiles` 条件

#### 场景 D: 创建了子瓦片但没有加载

**日志示例**:
```
[Tile LOD] Creating children for tile 0/0/0
// 但没有看到 "[Tile] Starting load for tile 1/x/y"
```

**问题**: 子瓦片的 update 没有被调用

**检查**: 
1. 确认 `this.subTiles?.forEach((child) => child.update(params))` 被执行
2. 检查子瓦片的 `parent` 是否正确设置

## 预期的正常日志流程

```
1. [TileMap] First update call
2. [Tile] Starting load for tile 0/0/0
3. [Tile] Loaded model for tile 0/0/0
4. [Tile inFrustum] Mesh frustum check for tile 0/0/0: true
5. [Tile LOD] z=0, distRatio=0.5, LODThreshold=1, inFrustum=true, maxLevel=18
6. [Tile LOD] Should create children: true  ← 条件满足
7. [Tile LOD] Creating children for tile 0/0/0  ← 创建子瓦片
8. [Tile] Starting load for tile 1/0/0  ← 开始加载子瓦片
9. [Tile] Starting load for tile 1/0/1
10. [Tile] Starting load for tile 1/1/0
11. [Tile] Starting load for tile 1/1/1
```

## 快速修复测试

### 测试 1: 强制 inFrustum = true

```typescript
// Tile.ts
public get inFrustum(): boolean {
  return true;
}
```

### 测试 2: 增大 LOD 阈值

```typescript
// demo/main.ts - createMap()
map.LODThreshold = 10;  // 大幅增加
```

### 测试 3: 减小相机距离

```typescript
// demo/main.ts - initViewer()
viewer.setCameraPosition(
  -Math.PI / 2,
  Math.PI / 4,
  100000,  // 从 5000000 减小到 100000
  Vector3.Zero()
);
```

### 测试 4: 组合修复

同时应用测试 1、2、3，看看哪个有效。

## 根据日志的修复决策树

```
控制台有 LOD 日志？
├─ 否 → LOD 方法没有被调用
│       ├─ 检查 update 方法是否执行
│       └─ 检查 this.model 是否存在
│
└─ 是 → 查看 "Should create children"
    ├─ false → 检查三个条件
    │   ├─ inFrustum = false → 修复 frustum 检查
    │   ├─ distRatio > LODThreshold → 调整相机或阈值
    │   └─ z >= maxLevel → 检查层级设置
    │
    └─ true → 查看 "Creating children"
        ├─ 没有此日志 → this.subTiles 已存在
        │       └─ 检查为什么子瓦片没有更新
        │
        └─ 有此日志 → 查看子瓦片加载日志
            ├─ 没有加载日志 → update 递归有问题
            └─ 有加载日志 → LOD 工作正常！
```

## 推荐的修复顺序

1. **查看日志** - 确定是哪个条件不满足
2. **快速测试** - 使用上述快速修复测试
3. **精确修复** - 根据测试结果实施正确的修复
4. **验证** - 确认子瓦片正常加载
5. **清理** - 移除调试日志

## 成功标志

修复成功后，应该看到：
- ✅ rootTile (0/0/0) 加载
- ✅ 4 个 level-1 子瓦片 (1/0/0, 1/0/1, 1/1/0, 1/1/1) 加载
- ✅ 滚轮缩放时，根据距离动态加载/卸载瓦片
- ✅ Network 面板显示多个层级的瓦片请求
- ✅ 3D 视图中地图细节随缩放增加

## 下一步

运行测试并将控制台日志反馈，我会根据日志输出提供精确的修复方案。

