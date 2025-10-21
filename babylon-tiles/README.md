# Babylon Tiles

> 🗺️ 一个基于 Babylon.js 的瓦片地图和地形加载系统，完全模仿 three-tile 的实现方式

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Babylon.js](https://img.shields.io/badge/Babylon.js-7.0-blue)](https://www.babylonjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)

## ✨ 特性

- 🗺️ **动态LOD瓦片系统** - 基于距离的自动细节层级调整
- 🏔️ **地形支持** - DEM/terrain数据加载和渲染
- 🎨 **多数据源** - 支持多种影像和地形数据源
- 📐 **地图投影** - Web Mercator (3857) 和 WGS84 (4326)
- 🎯 **视锥体剔除** - 高效的渲染优化
- 🔌 **可扩展** - 灵活的加载器插件系统
- 📦 **Monorepo** - pnpm workspace 管理

## 📦 项目结构

```
babylon-tiles/
├── packages/
│   ├── lib/          # 核心库 - 瓦片系统、加载器、投影
│   ├── plugin/       # 插件库 - BabylonViewer、数据源
│   └── demo/         # 演示应用 - 完整使用示例
└── docs/             # 文档
```

## 🚀 快速开始

### 1. 安装依赖

```bash
# 安装 pnpm (如果未安装)
npm install -g pnpm

# 安装项目依赖
cd babylon-tiles
pnpm install
```

### 2. 运行演示

```bash
pnpm dev
```

浏览器将自动打开 http://localhost:3000

### 3. 构建项目

```bash
# 构建所有包
pnpm build

# 或分别构建
pnpm build:lib     # 核心库
pnpm build:plugin  # 插件库
```

## 📖 使用示例

### 基础用法

```typescript
import { TileMap, registerImgLoader, TileImageLoader } from 'babylon-tile';
import { BabylonViewer, arcGisImgSource } from 'babylon-tile-plugin';

// 注册加载器
registerImgLoader(new TileImageLoader());

// 创建3D查看器
const viewer = new BabylonViewer('renderCanvas');

// 创建瓦片地图
const map = new TileMap({
  scene: viewer.scene,
  imgSource: arcGisImgSource,
  minLevel: 2,
  maxLevel: 18,
});

// 地图旋转到水平面
map.rotation.x = -Math.PI / 2;

// 在渲染循环中更新
viewer.scene.registerBeforeRender(() => {
  map.update(viewer.camera);
});
```

### 添加地形

```typescript
import { arcGisDemSource } from 'babylon-tile-plugin';

const map = new TileMap({
  scene: viewer.scene,
  imgSource: arcGisImgSource,
  demSource: arcGisDemSource,  // 添加DEM数据源
  minLevel: 2,
  maxLevel: 15,
});
```

### 坐标转换

```typescript
import { Vector3 } from '@babylonjs/core';

// 地理坐标转世界坐标
const worldPos = map.geo2world(new Vector3(lon, lat, height));

// 世界坐标转地理坐标
const geoPos = map.world2geo(worldPos);
```

## 📚 文档

- [安装指南 (INSTALL.md)](./INSTALL.md) - 详细的安装步骤
- [使用文档 (USAGE.md)](./USAGE.md) - API文档和高级用法
- [快速开始 (GETTING_STARTED.md)](./GETTING_STARTED.md) - 入门教程
- [项目总结 (PROJECT_SUMMARY.md)](./PROJECT_SUMMARY.md) - 架构和实现细节

## 🏗️ 架构

### 核心模块

#### 瓦片系统 (tile/)
- `Tile.ts` - 动态LOD瓦片类，四叉树结构

#### 地图系统 (map/)
- `TileMap.ts` - 主地图类
- `TileMapLoader.ts` - 地图数据加载器
- `projection/` - 投影系统 (3857, 4326)

#### 几何体系统 (geometry/)
- `TileGeometry.ts` - 瓦片几何体
- `utils.ts` - 网格生成、法向量计算
- `skirt.ts` - 裙边生成

#### 加载器系统 (loader/)
- `LoaderFactory.ts` - 加载器工厂
- `TileImageLoader.ts` - 图像瓦片加载
- `TileGeometryLoader.ts` - 几何体加载

#### 数据源 (source/)
- `TileSource.ts` - 瓦片数据源

## 🎯 与 three-tile 的对应关系

| Three.js | Babylon.js | 说明 |
|----------|-----------|------|
| `Object3D` | `TransformNode` | 场景节点 |
| `BufferGeometry` | `VertexData` | 几何体数据 |
| `Material` | `StandardMaterial` | 材质 |
| `Mesh` | `Mesh` | 网格 |
| `GLViewer` | `BabylonViewer` | 3D查看器 |

## ✅ 已实现功能

- [x] 动态LOD瓦片系统
- [x] 地图投影 (3857, 4326)
- [x] 图像瓦片加载
- [x] 平面几何体生成
- [x] 加载器扩展系统
- [x] 坐标转换
- [x] 视锥体剔除
- [x] BabylonViewer
- [x] 完整演示应用

## 🚧 待扩展功能

- [ ] Martini地形网格算法
- [ ] terrainRGB DEM加载器
- [ ] LERC地形加载器
- [ ] 矢量瓦片 (MVT) 支持
- [ ] GeoJSON加载器
- [ ] 罗盘控件
- [ ] 测量工具
- [ ] IndexedDB缓存

## 🛠️ 技术栈

- **Babylon.js 7.0** - 3D渲染引擎
- **TypeScript 5.3** - 类型安全
- **Vite 5.0** - 快速构建
- **pnpm** - 高效包管理

## 📝 开发命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build
pnpm build:lib
pnpm build:plugin

# 清理
pnpm --filter "*" exec rm -rf dist
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

[MIT](./LICENSE)

## 🙏 致谢

本项目基于 [three-tile](https://github.com/sxguojf/three-tile) 的架构设计，感谢原作者的优秀工作！

---

Made with ❤️ using Babylon.js

