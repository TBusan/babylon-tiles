# LOD 子瓦片不加载问题分析

## 问题描述
从控制台日志可以看到：
- ✅ rootTile (0/0/0) 成功加载
- ✅ 网络请求发出且成功
- ✅ Texture 加载成功
- ❌ 移动鼠标、滚轮缩放后，没有触发子瓦片加载

## 问题分析

### LOD 触发条件

在 `Tile.ts` 的 `LOD()` 方法中，创建子瓦片的条件是：

```typescript
if (this.z < maxLevel && this.distRatio < LODThreshold && this.inFrustum) {
  if (!this.subTiles) {
    this._subTiles = this.createChildren(loader);
  }
}
```

**三个条件必须同时满足**:
1. `this.z < maxLevel` - 当前层级小于最大层级
2. `this.distRatio < LODThreshold` - 距离比例小于 LOD 阈值
3. `this.inFrustum` - 瓦片在视锥体内

### 可能的问题点

#### 问题 1: distRatio 计算问题

```typescript
public get distRatio() {
  const distToCamera = Vector3.Distance(this._checkPoint, this._root.getScene().activeCamera!.position);
  const ratio = distToCamera / this._sizeInWorld;
  return this.inFrustum ? ratio * 0.8 : ratio * 2;
}
```

**可能的原因**:
- 相机距离过大，导致 `distRatio` 始终大于 `LODThreshold`
- `_sizeInWorld` 计算不正确
- `_checkPoint` 位置不正确

#### 问题 2: inFrustum 判断问题

```typescript
public get inFrustum(): boolean {
  if (!this._bbox || !this._root.getScene().activeCamera) return false;
  if (this._model) {
    return this._root.getScene().activeCamera!.isInFrustum(this._model);
  }
  return this._bbox ? this._root.getScene().activeCamera!.isInFrustum(this._bbox) : false;
}
```

**Three.js 版本的不同**:
```typescript
// Three.js 使用预计算的 frustum
public get inFrustum(): boolean {
  return !!this._bbox && frustum.intersectsBox(this._bbox);
}
```

**可能的问题**:
- Babylon.js 的 `isInFrustum()` 可能返回 false
- BoundingBox 的坐标系统可能不正确
- 没有正确更新 world matrix

#### 问题 3: LODThreshold 值问题

默认值是 1，但可能需要调整。Three.js demo 中也是 1，但相机距离和单位可能不同。

## 调试步骤

### 步骤 1: 查看 LOD 条件日志

重新构建并运行 demo，查看控制台输出：

```
[Tile LOD] z=0, distRatio=XXX, LODThreshold=1, inFrustum=true/false, maxLevel=18
[Tile LOD] Should create children: true/false
```

### 步骤 2: 分析输出

#### 场景 A: `inFrustum = false`
**问题**: BoundingBox 或视锥体判断有问题
**解决方案**: 
1. 检查 `_bbox` 是否正确创建
2. 检查 `computeWorldMatrix` 是否正确调用
3. 简化 `inFrustum` 判断，暂时返回 `true` 测试

#### 场景 B: `distRatio > LODThreshold`
**问题**: 相机距离太远或 LOD 阈值太小
**解决方案**:
1. 增加 `LODThreshold` 值（例如改为 2 或 5）
2. 调整相机初始距离
3. 检查 `_sizeInWorld` 和 `_checkPoint` 计算

#### 场景 C: 条件都满足但不创建子瓦片
**问题**: `createChildren` 方法有问题
**解决方案**: 检查子瓦片创建逻辑

## 快速修复方案

### 方案 1: 临时禁用 inFrustum 检查（用于测试）

```typescript
public get inFrustum(): boolean {
  // 临时返回 true 测试
  return true;
}
```

### 方案 2: 增加 LODThreshold

在 `demo/main.ts` 中：

```typescript
const map = new BT.TileMap({
  scene: viewer.scene,
  imgSource: imgSource,
  minLevel: 0,
  maxLevel: 18,
  debug: 0,
});

// 增加 LOD 阈值
map.LODThreshold = 2;  // 或 5，或更大
```

### 方案 3: 调整相机初始位置

在 `demo/main.ts` 中：

```typescript
viewer.setCameraPosition(
  -Math.PI / 2,  // alpha
  Math.PI / 4,   // beta  
  1000000,       // radius - 尝试减小这个值，例如改为 500000
  Vector3.Zero()
);
```

### 方案 4: 修复 BoundingBox 坐标系

检查 `computeTileSize` 方法：

```typescript
private computeTileSize(debug: number) {
  // Tile bounding box - world coordinates
  const min = new Vector3(-0.5, -0.5, -300);
  const max = new Vector3(0.5, 0.5, 9000);
  
  // 确保使用正确的世界矩阵
  this.computeWorldMatrix(true);
  this._bbox = new BoundingBox(min, max, this.getWorldMatrix());
  
  // Distance check point - tile center world coordinate
  this._checkPoint = Vector3.TransformCoordinates(Vector3.Zero(), this.getWorldMatrix());
  
  // Tile size - diagonal length
  const size = max.subtract(min);
  this._sizeInWorld = size.length();
  
  return this._sizeInWorld;
}
```

## 推荐的修复顺序

1. **首先**: 添加调试日志（已完成），查看 LOD 条件
2. **如果 inFrustum = false**: 修复 BoundingBox 或临时返回 true
3. **如果 distRatio 太大**: 增加 LODThreshold 或减小相机距离
4. **如果条件都满足**: 检查 createChildren 逻辑

## Three.js 的完整 LOD 实现对比

### Three.js 版本

```typescript
// 在 update 开始时预计算 frustum
if (this.z === 0) {
  camera.getWorldPosition(cameraWorldPosition);
  frustum.setFromProjectionMatrix(
    tempMat4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  );
}

// inFrustum 使用预计算的 frustum
public get inFrustum(): boolean {
  return !!this._bbox && frustum.intersectsBox(this._bbox);
}
```

### Babylon.js 当前版本

```typescript
// 每次都调用 camera.isInFrustum
public get inFrustum(): boolean {
  if (!this._bbox || !this._root.getScene().activeCamera) return false;
  if (this._model) {
    return this._root.getScene().activeCamera!.isInFrustum(this._model);
  }
  return this._bbox ? this._root.getScene().activeCamera!.isInFrustum(this._bbox) : false;
}
```

**关键差异**: Three.js 使用 Box3 并预计算 frustum，Babylon.js 直接调用 camera 方法。

## 建议的完整修复

### 方案 A: 模仿 Three.js 实现（推荐）

```typescript
// 在 Tile 类顶部添加静态变量
const cameraWorldPosition = Vector3.Zero();
let frustumPlanes: Plane[] | null = null;

export class Tile extends TransformNode {
  // ...
  
  public update(params: TileUpdateParams) {
    // ...
    
    // 如果是根瓦片，预计算 frustum
    if (this.z === 0 && this._root.getScene().activeCamera) {
      const camera = this._root.getScene().activeCamera;
      camera.position.cloneToRef(cameraWorldPosition);
      
      // Babylon.js 获取 frustum planes
      frustumPlanes = camera.getFrustumPlanes();
    }
    
    // ...
  }
  
  public get inFrustum(): boolean {
    if (!this._bbox) return false;
    if (!frustumPlanes) return true;  // 如果没有 frustum，假设在内
    
    // 使用 BoundingBox.intersectsPlanes 检查
    return this._bbox.intersectsPlanes(frustumPlanes);
  }
}
```

### 方案 B: 简化实现（快速修复）

```typescript
public get inFrustum(): boolean {
  // 简单检查：如果有 model，用 model；否则返回 true
  if (this._model) {
    return this._root.getScene().activeCamera!.isInFrustum(this._model);
  }
  return true;  // 对于没有 model 的瓦片（正在加载），假设在视锥体内
}
```

## 总结

**最可能的问题**: `inFrustum` 返回 false 或 `distRatio` 过大

**立即行动**:
1. 查看调试日志输出
2. 根据日志选择合适的修复方案
3. 测试验证

**长期方案**: 实现与 Three.js 一致的 frustum 预计算和 BoundingBox 检查逻辑

