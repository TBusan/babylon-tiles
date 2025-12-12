# 瓦片可见性调试指南

## 问题

1. 瓦片加载了但不显示
2. LOD 不工作（不加载子瓦片）
3. 相机距离设置为 1000，非常近

## 立即测试

### 步骤 1: 重新构建并启动

```bash
cd babylon-tiles/packages/lib
npm run build

cd ../demo
# 刷新浏览器即可，demo 会自动热重载
```

### 步骤 2: 查看新的调试日志

控制台应该显示：

```javascript
// 地图详情
Map details: {
  position: [x, y, z],
  rotation: [x, y, z],
  scaling: [x, y, z],
  rootTilePosition: [x, y, z],
  rootTileScaling: [x, y, z]
}

// 相机详情
Camera details: {
  position: [x, y, z],
  target: [x, y, z],
  radius: 1000,
  alpha: -1.57,
  beta: 0.78
}

// Mesh 详情
[TileMapLoader] Mesh details: {
  name: "tile-0-0-0",
  isVisible: true,
  isEnabled: true,
  position: [0, 0, 0],
  scaling: [1, 1, 1],
  hasGeometry: true,
  hasMaterial: true,
  verticesCount: XXX
}
```

### 步骤 3: 在浏览器控制台手动检查

打开浏览器开发者工具，在 Console 中执行：

#### 检查 1: 查看所有瓦片 Mesh

```javascript
const tileMeshes = viewer.scene.meshes.filter(m => m.name.startsWith('tile-'));
console.log('Tile meshes:', tileMeshes.length);
tileMeshes.forEach(m => {
  console.log(m.name, {
    isVisible: m.isVisible,
    isEnabled: m.isEnabled(),
    position: m.absolutePosition.asArray(),
    scaling: m.scaling.asArray(),
    vertices: m.getTotalVertices(),
    hasMaterial: !!m.material,
    parent: m.parent?.name
  });
});
```

#### 检查 2: 查看相机位置

```javascript
console.log('Camera:', {
  position: viewer.camera.position.asArray(),
  target: viewer.camera.target.asArray(),
  direction: viewer.camera.getDirection(BABYLON.Vector3.Forward()).asArray()
});
```

#### 检查 3: 查看 TileMap 和 RootTile

```javascript
console.log('Map:', {
  position: map.position.asArray(),
  worldPosition: map.getAbsolutePosition().asArray(),
  rotation: map.rotation.asArray(),
  scaling: map.scaling.asArray()
});

console.log('RootTile:', {
  position: map.rootTile.position.asArray(),
  worldPosition: map.rootTile.getAbsolutePosition().asArray(),
  scaling: map.rootTile.scaling.asArray(),
  hasModel: !!map.rootTile.model
});

if (map.rootTile.model) {
  console.log('RootTile Model:', {
    position: map.rootTile.model.position.asArray(),
    worldPosition: map.rootTile.model.getAbsolutePosition().asArray(),
    vertices: map.rootTile.model.getTotalVertices(),
    isVisible: map.rootTile.model.isVisible
  });
}
```

#### 检查 4: 尝试手动移动相机看瓦片

```javascript
// 移动相机到瓦片正上方
viewer.camera.position.set(0, 1000, 0);
viewer.camera.target.set(0, 0, 0);
```

#### 检查 5: 强制显示所有 Mesh（测试用）

```javascript
viewer.scene.meshes.forEach(m => {
  if (m.name.startsWith('tile-')) {
    m.isVisible = true;
    m.setEnabled(true);
    console.log('Forced visible:', m.name);
  }
});
```

## 可能的问题和解决方案

### 问题 1: 瓦片在错误的位置

**症状**: Mesh 存在但看不见

**检查**: 
- 瓦片的 `worldPosition` 是否在相机视野范围内？
- 地图是否被旋转到了看不见的角度？

**临时修复**: 移除地图旋转
```typescript
// 在 demo/main.ts 中注释掉
// map.rotation.x = -Math.PI / 2;
```

### 问题 2: 相机距离太近

**症状**: 相机在瓦片内部，看不到表面

**检查**: `camera.radius = 1000` 可能太近了

**修复**: 增加相机距离
```typescript
viewer.setCameraPosition(
  -Math.PI / 2,
  Math.PI / 4,
  10000,  // 增加到 10000
  Vector3.Zero()
);
```

### 问题 3: 地图缩放问题

**症状**: 地图太大或太小

**检查**: `rootTileScaling` 的值

**可能的问题**: 
```javascript
// TileMap.ts - _resize()
this.rootTile.scaling.set(
  this.projection.mapWidth,    // 可能非常大
  this.projection.mapHeight,   // 可能非常大
  this.projection.mapDepth
);
```

### 问题 4: 几何体问题

**症状**: `verticesCount = 0`

**问题**: 几何体没有正确应用

**检查**: TileGeometry 是否正确创建

### 问题 5: 渲染顺序问题

**症状**: Mesh 存在但不渲染

**检查**: 
- 相机的 near/far 平面
- Mesh 的渲染组

## 推荐的诊断流程

```
1. 查看控制台日志
   ├─ 有 "Mesh details"？
   │  ├─ 是 → verticesCount > 0？
   │  │  ├─ 是 → 几何体OK，检查位置
   │  │  └─ 否 → 几何体有问题
   │  └─ 否 → Mesh 没有创建
   │
2. 在控制台执行检查脚本
   ├─ tileMeshes.length > 0？
   │  ├─ 是 → Mesh 存在
   │  └─ 否 → Mesh 没有添加到场景
   │
3. 检查位置关系
   ├─ 相机位置
   ├─ 地图位置
   ├─ 瓦片位置
   └─ 它们是否合理？
   
4. 测试修复
   ├─ 移除地图旋转
   ├─ 调整相机距离
   ├─ 调整相机角度
   └─ 强制显示 Mesh
```

## 快速修复尝试

### 修复 A: 简化场景

```typescript
// 在 demo/main.ts 中
const map = new BT.TileMap({
  scene: viewer.scene,
  imgSource: imgSource,
  minLevel: 0,
  maxLevel: 18,
  debug: 0,
});

// 不要旋转地图
// map.rotation.x = -Math.PI / 2;  // 注释掉

// 设置一个合理的相机位置
viewer.setCameraPosition(
  0,              // alpha
  Math.PI / 4,    // beta (45度俯角)
  5000,           // radius
  Vector3.Zero()
);
```

### 修复 B: 添加一个测试立方体

在 `demo/main.ts` 中添加：

```typescript
// 在 createMap 后添加
function addTestCube(viewer: Plugin.BabylonViewer) {
  const box = BABYLON.MeshBuilder.CreateBox("testBox", { size: 100 }, viewer.scene);
  box.position.set(0, 0, 0);
  const mat = new BABYLON.StandardMaterial("testMat", viewer.scene);
  mat.diffuseColor = new BABYLON.Color3(1, 0, 0);
  box.material = mat;
  console.log("Test cube added at origin");
}

// 在 main() 中调用
const map = createMap(viewer);
addTestCube(viewer);  // 添加测试立方体
```

如果能看到红色立方体，说明渲染是正常的，问题在于瓦片的位置或几何体。

## 下一步

运行测试并提供：

1. **新的控制台日志** - 特别是：
   - Map details
   - Camera details  
   - Mesh details

2. **手动检查的输出** - 执行上述检查脚本

3. **当前视图状态** - 看到了什么？完全空白还是有其他东西？

有了这些信息，我就能精确定位问题！

