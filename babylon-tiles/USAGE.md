# Babylon Tiles 使用指南

## 项目简介

Babylon Tiles 是一个基于 Babylon.js 的瓦片地图和地形加载系统，模仿 three-tile 的实现方式。

## 安装

### 使用 pnpm (推荐)

```bash
# 安装依赖
pnpm install

# 构建核心库
pnpm build:lib

# 构建插件库
pnpm build:plugin

# 运行演示
pnpm dev
```

### 使用 npm

```bash
npm install
npm run build
npm run dev
```

## 项目结构

```
babylon-tiles/
├── packages/
│   ├── lib/          # 核心库
│   │   ├── src/
│   │   │   ├── tile/      # 瓦片系统
│   │   │   ├── map/       # 地图和投影
│   │   │   ├── geometry/  # 几何体处理
│   │   │   ├── loader/    # 加载器系统
│   │   │   └── source/    # 数据源
│   │   └── package.json
│   ├── plugin/       # 插件库
│   │   ├── src/
│   │   │   ├── BabylonViewer.ts  # 3D查看器
│   │   │   └── mapSource/        # 预配置数据源
│   │   └── package.json
│   └── demo/         # 演示应用
│       ├── src/
│       │   └── main.ts
│       ├── index.html
│       └── package.json
└── package.json
```

## 核心概念

### 1. TileMap (瓦片地图)

主要的地图类，管理整个瓦片树和LOD系统。

```typescript
import { TileMap } from 'babylon-tile';

const map = new TileMap({
  scene: scene,               // Babylon场景
  imgSource: imgSource,       // 影像数据源
  demSource: demSource,       // 地形数据源（可选）
  minLevel: 2,               // 最小层级
  maxLevel: 18,              // 最大层级
  lon0: 0,                   // 中央子午线
  bounds: [minLon, minLat, maxLon, maxLat], // 地图范围（可选）
});
```

### 2. Tile (瓦片)

单个瓦片节点，采用四叉树结构实现动态LOD。

### 3. Loader (加载器)

加载器系统支持多种数据格式：

- **TileImageLoader**: 加载影像瓦片
- **TileGeometryLoader**: 加载平面几何体
- 可自定义扩展其他加载器

### 4. Projection (投影)

支持两种地图投影：

- **3857**: Web墨卡托投影
- **4326**: WGS84地理坐标投影

## 基本使用

### 1. 创建简单的平面地图

```typescript
import { TileMap, registerImgLoader, TileImageLoader } from 'babylon-tile';
import { BabylonViewer, osmSource } from 'babylon-tile-plugin';

// 注册加载器
registerImgLoader(new TileImageLoader());

// 创建查看器
const viewer = new BabylonViewer('renderCanvas');

// 创建地图
const map = new TileMap({
  scene: viewer.scene,
  imgSource: osmSource,
  minLevel: 2,
  maxLevel: 18,
});

// 在渲染循环中更新
viewer.scene.registerBeforeRender(() => {
  map.update(viewer.camera);
});
```

### 2. 添加地形

```typescript
import { arcGisImgSource, arcGisDemSource } from 'babylon-tile-plugin';

const map = new TileMap({
  scene: viewer.scene,
  imgSource: arcGisImgSource,
  demSource: arcGisDemSource,  // 添加DEM数据源
  minLevel: 2,
  maxLevel: 15,
});
```

### 3. 坐标转换

```typescript
// 地理坐标转世界坐标
const worldPos = map.geo2world(new Vector3(lon, lat, height));

// 世界坐标转地理坐标
const geoPos = map.world2geo(worldPos);
```

### 4. 自定义数据源

```typescript
import { TileSource } from 'babylon-tile';

const customSource = new TileSource({
  dataType: 'image',
  url: 'https://your-tile-server.com/{z}/{x}/{y}.png',
  attribution: '© Your Attribution',
  minLevel: 0,
  maxLevel: 18,
  projectionID: '3857',
  opacity: 1.0,
  transparent: false,
});
```

## 高级功能

### 自定义加载器

```typescript
import { ITileMaterialLoader, TileSourceLoadParamsType } from 'babylon-tile';
import { StandardMaterial } from '@babylonjs/core';

class CustomImageLoader implements ITileMaterialLoader<StandardMaterial> {
  public dataType = 'custom-image';
  public info = {
    version: '1.0.0',
    author: 'Your Name',
    description: 'Custom image loader',
  };

  public async load(params: TileSourceLoadParamsType): Promise<StandardMaterial> {
    // 实现自定义加载逻辑
    const material = new StandardMaterial(`custom-${params.z}-${params.x}-${params.y}`);
    // ... 加载纹理等
    return material;
  }

  public unload(material: StandardMaterial): void {
    material.dispose();
  }
}

// 注册自定义加载器
registerImgLoader(new CustomImageLoader());
```

## 性能优化

1. **调整LOD阈值**: 
```typescript
map.LODThreshold = 1.5; // 默认1.0，值越大瓦片越密集
```

2. **设置更新间隔**:
```typescript
map.updateInterval = 200; // 毫秒，默认100
```

3. **限制层级范围**:
```typescript
map.minLevel = 3;  // 提高最小层级
map.maxLevel = 16; // 降低最大层级
```

## 调试

启用调试模式：

```typescript
const map = new TileMap({
  // ...
  debug: 1, // 0:关闭 1:基本调试 2:显示包围盒
});
```

## 常见问题

### 1. 瓦片不显示

- 检查数据源URL是否正确
- 确认已注册相应的加载器
- 检查浏览器控制台错误信息

### 2. 性能问题

- 降低最大层级
- 增加LOD阈值
- 减少同时显示的瓦片数量

### 3. 坐标转换不准确

- 确认使用正确的投影类型
- 检查中央子午线设置(lon0)

## 与 three-tile 的对应关系

| three-tile | babylon-tiles | 说明 |
|-----------|--------------|------|
| GLViewer | BabylonViewer | 3D查看器 |
| BufferGeometry | VertexData | 几何体数据 |
| Material | StandardMaterial | 材质 |
| Mesh | Mesh | 网格 |
| Object3D | TransformNode | 场景节点 |

## 示例项目

查看 `packages/demo` 目录获取完整示例。

## 下一步

- 实现更多加载器（terrainRGB, LERC等）
- 添加矢量瓦片支持
- 实现Martini地形网格生成
- 添加更多辅助功能（罗盘、测量工具等）

## 许可证

MIT

