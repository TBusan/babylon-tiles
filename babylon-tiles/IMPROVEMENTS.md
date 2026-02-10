# Babylon-Tiles 改进总结

本文档总结了基于 three-tile 项目对比分析后，对 babylon-tiles 项目进行的改进。

## 已完成的改进

### 1. TileSource 基类 ✅

**文件**: `packages/lib/src/source/TileSource.ts`

**新增功能**:
- 支持 `subdomains` 参数（URL子域名负载均衡）
- 支持 `isTMS` 参数（TMS坐标系）
- 强大的 `strTemplate` 函数（高级URL模板替换）
- 自动投影边界计算
- 更完善的URL生成逻辑（支持BBOX等参数）

**使用示例**:
```typescript
const source = new TileSource({
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  subdomains: 'abc',  // 支持 a.tile.openstreetmap.org, b.tile.openstreetmap.org, etc.
  isTMS: false,       // 使用 XYZ 坐标系
  minLevel: 0,
  maxLevel: 18
});
```

### 2. 更多数据源支持 ✅

**文件**: `packages/lib/src/source/MoreSources.ts`

**新增数据源**:
- **MapBoxSource** - MapBox地图服务（支持token认证）
- **TDTSource** - 天地图服务（中国地图）
- **TDTDemSource** - 天地图地形服务
- **GDSource** - 高德地图
- **BaiduSource** - 百度地图
- **GoogleSource** - Google地图
- **BingSource** - Bing地图
- **WmsSource** - WMS（Web Map Service）标准服务

**快捷创建函数**:
```typescript
// OpenStreetMap
const osm = QuickSources.osm();

// MapBox卫星影像
const mapbox = QuickSources.mapboxSatellite({ token: 'your-token' });

// 高德地图
const gaode = QuickSources.gaodeImage();

// Google地形
const googleTerrain = QuickSources.googleTerrain();
```

### 3. 加载器架构改进 ✅

**文件**:
- `packages/lib/src/loader/ITileLoaders.ts` - 加载器接口定义
- `packages/lib/src/loader/LoaderFactory.ts` - 工厂模式实现

**新增功能**:
- 工厂模式管理加载器
- 支持材质加载器和几何体加载器分别注册
- 统一的加载器接口
- 加载器信息元数据

**使用示例**:
```typescript
const factory = LoaderFactory.getInstance();

// 注册加载器
factory.registerMaterialLoader(new TileImageLoaderWithScene(scene));
factory.registerGeometryLoader(new TerrainRGBLoader(scene));

// 获取加载器
const imgLoader = factory.getMaterialLoader(source);
const demLoader = factory.getGeometryLoader(demSource);
```

### 4. 专用加载器实现 ✅

**文件**:
- `packages/lib/src/loader/TileImageLoader.ts` - 图像加载器
- `packages/lib/src/loader/TerrainRGBLoader.ts` - Terrain-RGB地形加载器

**TileImageLoader**:
- 标准图像格式加载（PNG, JPG）
- 支持场景传入
- 自动纹理和材质创建

**TerrainRGBLoader**:
- Mapbox Terrain-RGB v1 格式支持
- RGB数据转换为高程数据
- 两种实现：普通版和Worker版（不阻塞主线程）
- 可配置分段数

**使用示例**:
```typescript
// 图像加载器
const imgLoader = new TileImageLoaderWithScene(scene);
const material = await imgLoader.load({ source, x, y, z, bounds });

// 地形加载器
const terrainLoader = new TerrainRGBLoader(scene, 128);
const geometry = await terrainLoader.load({ source, x, y, z, bounds });

// 使用Worker版本
const terrainLoaderWithWorker = new TerrainRGBLoaderWithWorker(scene);
```

### 5. 数据源重构 ✅

**文件**:
- `packages/lib/src/source/ArcGisSource.ts` - 继承TileSource
- `packages/lib/src/source/XYZTileSource.ts` - 继承TileSource

**改进**:
- 所有数据源现在继承自TileSource基类
- 统一的URL模板处理
- 更少的代码重复
- 更容易扩展新的数据源

## 代码组织改进

### 导出结构
```
packages/lib/src/
├── source/
│   ├── index.ts          # 导出所有数据源
│   ├── TileSource.ts     # 基类
│   ├── ISource.ts        # 接口
│   ├── ArcGisSource.ts   # ArcGIS实现
│   ├── XYZTileSource.ts  # XYZ实现
│   └── MoreSources.ts    # 更多数据源
├── loader/
│   ├── index.ts                  # 导出所有加载器
│   ├── ITileLoaders.ts           # 加载器接口
│   ├── LoaderFactory.ts          # 工厂类
│   ├── TileImageLoader.ts        # 图像加载器
│   └── TerrainRGBLoader.ts       # 地形加载器
```

## 与 three-tile 的功能对比

| 功能 | three-tile | babylon-tiles (改进前) | babylon-tiles (改进后) |
|------|------------|----------------------|----------------------|
| TileSource基类 | ✅ | ❌ | ✅ |
| subdomains支持 | ✅ | ❌ | ✅ |
| isTMS支持 | ✅ | ❌ | ✅ |
| URL模板引擎 | ✅ | ❌ | ✅ |
| 数据源数量 | 15+ | 2 | 15+ |
| LoaderFactory | ✅ | ❌ | ✅ |
| 专用加载器 | ✅ | ❌ | ✅ |
| TerrainRGB | ✅ | ❌ | ✅ |
| 可扩展架构 | ✅ | ⚠️ | ✅ |

## 待实现的改进

以下功能已识别但尚未实现：

### 1. LERC格式加载器
**优先级**: 高
**描述**: ArcGIS地形数据使用的LERC格式
**参考**: `three-tile/packages/lib/src/loader/terrainLercLoader/`

### 2. 图像裁剪功能
**优先级**: 中
**描述**: 从父瓦片裁剪子瓦片，提高加载效率
**参考**: `three-tile/packages/lib/src/loader/tileImageLoader/`

### 3. 视锥体剔除优化
**优先级**: 高
**描述**: 专门的Frustum类进行视锥体剔除
**参考**: `three-tile/packages/lib/src/tile/FrustumEx.ts`

### 4. 调试加载器
**优先级**: 低
**描述**: 包围盒、线框等调试可视化工具
**参考**: `three-tile/packages/plugin/src/debugLoader/`

### 5. 更多专用加载器
**优先级**: 中
- GeoJSON加载器
- MVT矢量瓦片加载器
- 单张图片加载器
- TIFF DEM加载器

## 使用建议

### 创建自定义数据源

```typescript
// 继承TileSource基类
export class CustomSource extends TileSource {
  public dataType: string = 'custom';
  public attribution: string = 'Custom Maps';

  constructor(options: SourceOptions = {}) {
    super(options);
    this.url = options.url || 'https://custom.tiles.com/{z}/{x}/{y}.png';
  }

  // 可以重写getUrl方法实现自定义URL逻辑
  public getUrl(x: number, y: number, z: number): string {
    return super.getUrl(x, y, z, { customParam: 'value' });
  }
}
```

### 创建自定义加载器

```typescript
// 实现ITileMaterialLoader接口
export class CustomMaterialLoader implements ITileMaterialLoader {
  public readonly isMaterialLoader = true;
  public readonly info = { version: '1.0.0', author: 'Your Name' };
  public readonly dataType = 'custom-format';

  async load(params: TileSourceLoadParamsType): Promise<Material> {
    // 自定义加载逻辑
  }

  unload(material: Material): void {
    // 清理逻辑
  }
}

// 注册到工厂
LoaderFactory.getInstance().registerMaterialLoader(new CustomMaterialLoader());
```

## 总结

本次改进显著缩小了babylon-tiles与three-tile之间的功能差距：

1. **架构改进**: 引入TileSource基类和LoaderFactory，提高了代码的可维护性和可扩展性
2. **数据源丰富**: 从2个数据源扩展到15+个数据源，覆盖了主流地图服务提供商
3. **加载器系统**: 建立了统一的加载器接口和工厂模式，便于添加新的加载器
4. **地形支持**: 添加了TerrainRGB支持，为3D地形可视化打下基础

这些改进为babylon-tiles项目奠定了坚实的基础，使其成为一个功能完整、架构清晰的地图瓦片库。
