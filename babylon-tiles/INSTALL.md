# 安装和运行指南

## 项目已创建完成 ✅

Babylon Tiles 项目已经成功创建，包含完整的：

- ✅ 核心库 (packages/lib)
- ✅ 插件库 (packages/plugin)  
- ✅ 演示应用 (packages/demo)

## 快速开始

### 1. 安装 pnpm (如果尚未安装)

```bash
npm install -g pnpm
```

### 2. 安装项目依赖

在 `babylon-tiles` 目录下运行：

```bash
pnpm install
```

这将安装所有包的依赖。

### 3. 构建项目

```bash
# 构建所有包
pnpm build

# 或者分别构建
pnpm build:lib     # 构建核心库
pnpm build:plugin  # 构建插件库
```

### 4. 运行演示

```bash
pnpm dev
```

浏览器将自动打开 http://localhost:3000 并显示瓦片地图。

## 目录说明

```
babylon-tiles/
├── packages/
│   ├── lib/          # 核心库 - 瓦片系统、加载器、投影等
│   ├── plugin/       # 插件库 - BabylonViewer、数据源等
│   └── demo/         # 演示应用 - 完整使用示例
├── README.md         # 项目介绍
├── USAGE.md          # 详细使用文档
├── GETTING_STARTED.md # 快速入门
├── PROJECT_SUMMARY.md # 项目总结
└── package.json      # 根配置文件
```

## 使用示例

### 在你自己的项目中使用

```bash
# 安装依赖
npm install @babylonjs/core

# 在本地开发时，可以使用 pnpm link
cd babylon-tiles/packages/lib
pnpm link --global

cd your-project
pnpm link --global babylon-tile
```

### 基本代码

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

// 更新地图
viewer.scene.registerBeforeRender(() => {
  map.update(viewer.camera);
});
```

## 开发命令

```bash
# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 构建核心库
pnpm build:lib

# 构建插件库
pnpm build:plugin

# 运行演示（会自动构建依赖）
pnpm dev

# 清理构建产物
pnpm --filter "*" exec rm -rf dist
```

## 项目特性

### 已实现 ✅

1. **动态LOD瓦片系统**
   - 基于视锥体的瓦片剔除
   - 距离驱动的细节层级
   - 四叉树结构管理

2. **地图投影**
   - Web Mercator (EPSG:3857)
   - WGS84 (EPSG:4326)
   - 可扩展的投影系统

3. **加载器系统**
   - 图像瓦片加载
   - 平面几何体生成
   - 可注册自定义加载器

4. **坐标转换**
   - 地理坐标 ↔ 世界坐标
   - 投影坐标转换

5. **几何体处理**
   - DEM数据网格生成
   - 自动法向量计算
   - 裙边生成防止缝隙

### 待扩展 🚧

1. Martini地形网格算法
2. terrainRGB/LERC DEM加载器
3. 矢量瓦片 (MVT) 支持
4. GeoJSON加载器
5. 更多辅助工具

## 技术栈

- **Babylon.js 7.0**: 3D渲染引擎
- **TypeScript**: 类型安全
- **Vite**: 构建工具
- **pnpm**: 包管理器

## 文档

- [README.md](./README.md) - 项目介绍
- [USAGE.md](./USAGE.md) - 详细使用文档
- [GETTING_STARTED.md](./GETTING_STARTED.md) - 快速入门
- [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md) - 项目总结

## 常见问题

### Q: pnpm install 失败？

A: 确保安装了 Node.js 16+ 和 pnpm。如果网络问题，可以配置淘宝镜像：

```bash
pnpm config set registry https://registry.npmmirror.com
```

### Q: 构建失败？

A: 按顺序构建：
```bash
pnpm build:lib      # 先构建核心库
pnpm build:plugin   # 再构建插件库
```

### Q: 演示页面空白？

A: 检查浏览器控制台错误信息，确保：
1. 依赖已正确安装
2. 核心库和插件库已构建
3. 网络连接正常（需要加载瓦片数据）

## 下一步

1. 查看 [demo/src/main.ts](./packages/demo/src/main.ts) 学习使用方法
2. 阅读 [USAGE.md](./USAGE.md) 了解详细API
3. 参考 three-tile 扩展更多功能

## 支持

如有问题，请查看：
- 项目文档
- 浏览器控制台错误信息
- three-tile 原项目文档

## 许可证

MIT

