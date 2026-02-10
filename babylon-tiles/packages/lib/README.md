# Babylon-Tile

使用 Babylon.js 实现的轻量级 3D 地图瓦片渲染库，支持动态 LOD（细节层次）、多数据源加载、地形高程渲染等功能。

## 特性

- 🌍 **多投影支持** - 支持 WGS84 (EPSG:4326) 和 Web Mercator (EPSG:3857) 投影
- 📦 **动态 LOD** - 基于相机距离的四叉树 LOD 系统
- 🗺️ **多数据源** - 支持 XYZ 瓦片、ArcGIS 地图服务等
- 🏔️ **地形支持** - 支持 DEM 高程数据加载
- 🎨 **灵活的材质系统** - 支持标准材质和 PBR 材质
- ⚡ **高性能** - 视锥剔除、并发加载、资源优化
- 🔌 **可扩展** - 插件式架构，易于扩展

## 安装

```bash
npm install @babylon-tile/lib
```

## 快速开始

### 基本用法

```typescript
import { Engine, Scene } from '@babylonjs/core';
import { TileMap, ArcGisSource } from '@babylon-tile/lib';

// 创建 Babylon.js 引擎和场景
const canvas = document.getElementById('canvas');
const engine = new Engine(canvas);
const scene = new Scene(engine);

// 创建地图
const map = TileMap.create({
    scene,
    imgSource: new ArcGisSource({
        serverType: 'World_Imagery',
        minLevel: 2,
        maxLevel: 18,
    }),
    minLevel: 2,
    maxLevel: 18,
    lon0: 0,
});

// 将地图添加到场景
map.parent = scene.createTransformNode('root');

// 渲染循环
engine.runRenderLoop(() => {
    // 获取场景中的相机
    const camera = scene.cameras[0];
    if (camera) {
        map.update(camera);
    }
    scene.render();
});
```

### 使用自定义数据源

```typescript
import { XYZTileSource, TileMap } from '@babylon-tile/lib';

const map = TileMap.create({
    scene,
    imgSource: new XYZTileSource({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        dataType: 'image',
        projectionID: 'EPSG:3857',
        minLevel: 0,
        maxLevel: 19,
    }),
});
```

### 多数据源叠加

```typescript
const map = TileMap.create({
    scene,
    imgSource: [
        new ArcGisSource({ serverType: 'World_Imagery' }),
        new XYZTileSource({
            url: 'https://example.com/overlay/{z}/{x}/{y}.png',
            opacity: 0.7,
            transparent: true,
        }),
    ],
});
```

### 地形高程

```typescript
import { DemSource } from '@babylon-tile/lib';

const map = TileMap.create({
    scene,
    imgSource: new ArcGisSource({ serverType: 'World_Imagery' }),
    demSource: new DemSource({
        url: 'https://example.com/dem/{z}/{x}/{y}.png',
    }),
});
```

## API 文档

### TileMap

地图主类，管理整个瓦片系统。

```typescript
const map = TileMap.create({
    scene,              // Babylon.js 场景
    imgSource,          // 影像数据源
    demSource?,         // 地形数据源（可选）
    minLevel?: 2,       // 最小缩放级别
    maxLevel?: 20,      // 最大缩放级别
    lon0?: 0,           // 中央子午线（-90 | 0 | 90）
    LODThreshold?: 1,   // LOD 阈值
    debug?: 0,          // 调试标志（0: 关闭, 1: 开启, 2: 显示包围盒）
});
```

#### 主要方法

- `geo2world(geo)` - 地理坐标转世界坐标
- `world2geo(world)` - 世界坐标转地理坐标
- `update(camera)` - 更新瓦片树
- `reload()` - 重新加载地图

#### 事件

```typescript
map.addObservable('ready', () => {
    console.log('Map ready!');
});

map.addObservable('tile-loaded', ({ tile }) => {
    console.log('Tile loaded:', tile.name);
});
```

### 数据源

#### XYZTileSource

标准的 XYZ 瓦片数据源。

```typescript
const source = new XYZTileSource({
    url: 'https://example.com/{z}/{x}/{y}.png',
    dataType: 'image',
    projectionID: 'EPSG:3857',
    minLevel: 0,
    maxLevel: 19,
    opacity: 1,
    transparent: false,
});
```

#### ArcGisSource

ArcGIS 地图服务数据源。

```typescript
const source = new ArcGisSource({
    serverType: 'World_Imagery',  // 或其他预定义服务
    minLevel: 2,
    maxLevel: 18,
});

// 快捷方法
const imagery = ArcGisSources.imagery();
const street = ArcGisSources.street();
const topo = ArcGisSources.topo();
```

### 投影系统

```typescript
import { ProjectionFactory } from '@babylon-tile/lib';

// WGS84 投影
const wgs84 = ProjectionFactory.createWGS84(lon0);

// Web Mercator 投影
const webMercator = ProjectionFactory.createWebMercator(lon0);
```

## 性能优化建议

1. **控制 LOD 阈值** - 调整 `LODThreshold` 来平衡性能和质量
2. **限制缩放级别** - 设置合理的 `minLevel` 和 `maxLevel`
3. **使用边界** - 设置 `bounds` 限制加载范围
4. **调整更新频率** - 修改 `updateInterval` 控制更新频率

## 示例

查看 `packages/demo` 目录中的完整示例。

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 运行 demo
cd packages/demo
pnpm dev
```

## License

MIT

## 致谢

本项目参考了 [three-tile](https://github.com/sxguojf/three-tile) 项目的实现。
