# Getting Started with Babylon Tiles

## 快速开始

### 1. 安装依赖

```bash
cd babylon-tiles
pnpm install
```

如果没有安装 pnpm：
```bash
npm install -g pnpm
```

### 2. 构建项目

```bash
# 构建所有包
pnpm build

# 或者分别构建
pnpm build:lib     # 构建核心库
pnpm build:plugin  # 构建插件
```

### 3. 运行演示

```bash
pnpm dev
```

浏览器会自动打开 http://localhost:3000

## 项目架构

### 核心库 (packages/lib)

提供基础的瓦片地图功能：

- **tile/**: 瓦片类和LOD系统
- **map/**: 地图类和投影系统
- **geometry/**: 几何体生成和处理
- **loader/**: 加载器接口和实现
- **source/**: 数据源定义

### 插件库 (packages/plugin)

提供扩展功能：

- **BabylonViewer**: 开箱即用的3D查看器
- **mapSource/**: 预配置的地图数据源
- 更多插件功能待扩展

### 演示应用 (packages/demo)

完整的使用示例，展示如何集成和使用库。

## 核心功能实现状态

✅ 已完成：
- 基础瓦片系统
- 动态LOD
- 地图投影（3857, 4326）
- 图像瓦片加载
- 基础几何体生成
- Babylon.js查看器
- 演示应用

🚧 待完善：
- Martini地形网格生成
- terrainRGB加载器
- LERC地形加载器
- 矢量瓦片支持
- 更多辅助功能

## 使用示例

### 最小示例

```typescript
import { Engine, Scene, ArcRotateCamera, Vector3 } from '@babylonjs/core';
import { TileMap, registerImgLoader, TileImageLoader } from 'babylon-tile';

// 创建引擎和场景
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const engine = new Engine(canvas);
const scene = new Scene(engine);

// 创建相机
const camera = new ArcRotateCamera(
  'camera',
  -Math.PI / 2,
  Math.PI / 4,
  5000000,
  Vector3.Zero(),
  scene
);
camera.attachControl(canvas, true);

// 注册加载器
registerImgLoader(new TileImageLoader());

// 创建地图
const map = new TileMap({
  scene: scene,
  imgSource: {
    dataType: 'image',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
    minLevel: 0,
    maxLevel: 18,
    projectionID: '3857',
  },
  minLevel: 2,
  maxLevel: 18,
});

// 地图旋转到水平面
map.rotation.x = -Math.PI / 2;

// 渲染循环
engine.runRenderLoop(() => {
  map.update(camera);
  scene.render();
});
```

## 开发建议

### 1. 代码结构

遵循与 three-tile 相似的结构，便于理解和迁移。

### 2. Babylon.js 特定适配

- 使用 `TransformNode` 替代 Three.js 的 `Object3D`
- 使用 `VertexData` 替代 `BufferGeometry`
- 使用 `StandardMaterial` 替代 Three.js 材质
- 使用 Babylon.js 的坐标系统（左手坐标系）

### 3. 性能考虑

- 合理设置 LOD 阈值
- 限制最大瓦片层级
- 使用视锥体剔除
- 及时释放不需要的资源

## 调试技巧

### 1. 启用调试模式

```typescript
const map = new TileMap({
  // ...
  debug: 1, // 启用基本调试信息
});
```

### 2. 查看瓦片信息

```typescript
// 统计瓦片数量
let tileCount = 0;
map.rootTile.getDescendants().forEach(node => {
  if ((node as any).isTile) tileCount++;
});
console.log('Tiles:', tileCount);

// 查看下载状态
console.log('Downloading:', map.downloading);
```

### 3. 检查投影

```typescript
console.log('Projection:', map.projection.ID);
console.log('Map size:', map.projection.mapWidth, map.projection.mapHeight);
```

## 常见问题

### Q: 为什么瓦片不显示？

A: 检查以下几点：
1. 是否正确注册了加载器
2. 数据源URL是否正确
3. 是否在渲染循环中调用了 `map.update()`
4. 检查浏览器控制台是否有错误

### Q: 如何提高性能？

A: 尝试以下方法：
1. 降低 `maxLevel`
2. 增加 `LODThreshold`
3. 减小视锥体范围
4. 使用较低分辨率的数据源

### Q: 如何添加自定义数据源？

A: 参考 USAGE.md 中的"自定义数据源"章节。

## 下一步

1. 查看 [USAGE.md](./USAGE.md) 了解详细使用方法
2. 查看 `packages/demo/src/main.ts` 了解完整示例
3. 参考 three-tile 的实现扩展更多功能

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT

