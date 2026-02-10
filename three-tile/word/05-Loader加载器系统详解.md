# Loader 加载器系统详解

## 概述

Loader 系统是 Three-Tile 的核心数据加载模块，采用工厂模式和插件化设计，支持多种影像和地形数据格式的扩展。

**源码位置**: `packages/lib/src/loader/`

## 模块结构

```
loader/
├── ITileLoaders.ts          # 接口定义
├── LoaderFactory.ts         # 加载器工厂
├── TileLoadingManager.ts    # 加载管理器
├── TileLoader.ts            # 瓦片加载器
├── TileMapLoader.ts         # 地图瓦片加载器
├── TileMaterialLoader.ts    # 材质加载器基类
├── TileGeometryLoader.ts    # 几何体加载器基类
├── tileImageLoader/         # 影像加载器
│   └── TileImageLoader.ts
├── terrainRGBLoader/        # Terrain-RGB 加载器
│   ├── TerrainRGBLoader.ts
│   ├── parse.ts
│   └── parse.worker.ts
└── terrainLercLoader/       # Lerc 加载器
    ├── TileGeometryLercLoader.ts
    ├── parse.ts
    └── parse.worker.ts
```

## 核心接口

### ITileLoader

瓦片加载器的顶层接口：

```typescript
export interface ITileLoader {
    downloadingThreads: number;  // 正在进行的下载数
    debug: number;               // 调试级别
    manager: TileLoadingManager; // 加载管理器
    imgSource: ISource[];        // 影像数据源
    demSource: ISource;          // 地形数据源
    projectionID: string;        // 投影ID
    backgroundMaterial: TileBackgroundMaterial; // 背景材质
    bounds: BoundsType;          // 经纬度范围

    load(params: TileCoords): Promise<Mesh>;
    unload(tileMesh: Mesh): void;
    update(tileMesh: Mesh, params: TileCoords, updateMaterial: boolean, updateGeometry: boolean): Promise<Mesh>;
}
```

### ITileMaterialLoader

影像材质加载器接口：

```typescript
export interface ITileMaterialLoader<TMaterial extends Material = Material> {
    isMaterialLoader?: true;
    info: ITileLoaderInfo;       // 加载器信息
    dataType: string;            // 数据类型标识

    load(params: TileSourceLoadParamsType): Promise<TMaterial>;
    unload?(material: TMaterial): void;
}
```

### ITileGeometryLoader

地形几何体加载器接口：

```typescript
export interface ITileGeometryLoader<TGeometry extends BufferGeometry = BufferGeometry> {
    isMaterialLoader?: false;
    info: ITileLoaderInfo;       // 加载器信息
    dataType: string;            // 数据类型标识

    load(params: TileSourceLoadParamsType): Promise<TGeometry>;
    unload?(geometry: TGeometry): void;
}
```

## 加载器工厂 (LoaderFactory)

单例工厂类，管理所有加载器的注册和获取：

```typescript
export const LoaderFactory = {
    manager: new TileLoadingManager(),
    demLoaderMap: new Map<string, ITileGeometryLoader>(),
    imgLoaderMap: new Map<string, ITileMaterialLoader>(),

    // 注册材质加载器
    registerMaterialLoader(loader: ITileMaterialLoader) {
        LoaderFactory.imgLoaderMap.set(loader.dataType, loader);
        loader.info.author = loader.info.author ?? author.name;
    },

    // 注册几何体加载器
    registerGeometryLoader(loader: ITileGeometryLoader) {
        LoaderFactory.demLoaderMap.set(loader.dataType, loader);
        loader.info.author = loader.info.author ?? author.name;
    },

    // 获取材质加载器
    getMaterialLoader(source: ISource | string) {
        const dataType = typeof source === "string" ? source : source.dataType;
        const loader = LoaderFactory.imgLoaderMap.get(dataType);
        if (loader) return loader;
        throw `Image source dataType "${dataType}" is not support!`;
    },

    // 获取几何体加载器
    getGeometryLoader(source: ISource | string) {
        const dataType = typeof source === "string" ? source : source.dataType;
        const loader = LoaderFactory.demLoaderMap.get(dataType);
        if (loader) return loader;
        throw `Terrain source dataType "${dataType}" is not support!`;
    },

    // 获取所有加载器
    getLoaders() {
        return {
            imgLoaders: Array.from(LoaderFactory.imgLoaderMap.values()),
            demLoaders: Array.from(LoaderFactory.demLoaderMap.values()),
        };
    },
};
```

## TileLoader 核心类

瓦片加载器的主要实现，负责协调影像和地形的加载：

```typescript
export class TileLoader implements ITileLoader {
    private static _downloadingThreads = 0;
    private _bounds: BoundsType = [-180, -85, 180, 85];
    private _imgSource: ISource[] = [];
    private _demSource: ISource | undefined;

    // 错误处理材质
    private readonly _errorMaterial = new MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0,
    });
    private readonly _errorGeometry = new TileGeometry();

    // 背景材质（底层填充）
    public readonly backgroundMaterial = new MeshBasicMaterial({ color: 0x112233 });

    /**
     * 加载瓦片（几何体 + 材质）
     */
    public async load(params: TileLoadParamsType): Promise<Mesh> {
        const geometry = await this.loadGeometry(params);
        const materials = await this.loadMaterial(params);

        // 为每个材质组设置几何体分组
        geometry.clearGroups();
        for (let i = 0; i < materials.length; i++) {
            geometry.addGroup(0, Infinity, i);
        }

        return new Mesh(geometry, materials);
    }

    /**
     * 加载几何体（地形）
     */
    protected async loadGeometry(params: TileLoadParamsType): Promise<BufferGeometry> {
        let geometry: BufferGeometry;
        const { bounds, z } = params;

        // 检查是否有地形数据源且在范围内
        if (this.demSource && z >= this.demSource.minLevel && this._intersectsBounds(this.demSource, bounds)) {
            const loader = LoaderFactory.getGeometryLoader(this.demSource);
            const source = this.demSource;

            TileLoader._downloadingThreads++;
            geometry = await loader.load({ source, ...params })
                .catch(e => {
                    if (this.debug > 0) console.error("Load Geometry Error:", e);
                    return this._errorGeometry;
                })
                .finally(() => {
                    TileLoader._downloadingThreads--;
                });

            // 绑定卸载事件
            if (geometry != this._errorGeometry) {
                const dispose = (evt: { target: BufferGeometry }) => {
                    loader.unload && loader.unload(evt.target);
                    evt.target.removeEventListener("dispose", dispose);
                };
                geometry.addEventListener("dispose", dispose);
            }
        } else {
            geometry = new TileGeometry();
        }

        return geometry;
    }

    /**
     * 加载材质（影像）
     */
    protected async loadMaterial(params: TileLoadParamsType): Promise<Material[]> {
        const materials: Material[] = [this.backgroundMaterial];
        const { bounds, z } = params;

        // 筛选在范围内的影像源
        const sources = this.imgSource.filter(source =>
            z >= source.minLevel && this._intersectsBounds(source, bounds)
        );

        for (const source of sources) {
            const loader = LoaderFactory.getMaterialLoader(source);

            TileLoader._downloadingThreads++;
            const material = await loader.load({ source, ...params })
                .catch(e => {
                    if (this.debug > 0) console.error("Load Material Error:", e);
                    return this._errorMaterial;
                })
                .finally(() => {
                    TileLoader._downloadingThreads--;
                });

            if (material !== this._errorMaterial && material !== this.backgroundMaterial) {
                // 裁剪纹理
                if ("map" in material && material.map instanceof Texture) {
                    const texture = material.map;
                    if (texture.image) {
                        texture.image = tileBoundsClip(texture.image, source._projectionBounds, params.bounds);
                    }
                    texture.needsUpdate = true;
                }

                material.opacity = source.opacity;
                material.transparent = source.transparent;

                // 绑定卸载事件
                const dispose = (evt: { target: Material }) => {
                    loader.unload && loader.unload(evt.target);
                    evt.target.removeEventListener("dispose", dispose);
                };
                material.addEventListener("dispose", dispose);

                materials.push(material);
            }
        }

        return materials;
    }

    /**
     * 更新瓦片数据
     */
    public async update(tileMesh: Mesh, params: TileLoadParamsType, updateMaterial: boolean, updateGeometry: boolean) {
        if (updateGeometry) {
            const oldGeometry = tileMesh.geometry;
            tileMesh.geometry = await this.loadGeometry(params);
            tileMesh.geometry.groups = oldGeometry.groups;
            oldGeometry.dispose();
        }
        if (updateMaterial) {
            const oldMaterial = Array.isArray(tileMesh.material) ? tileMesh.material : [tileMesh.material];
            const material = await this.loadMaterial(params);
            tileMesh.material = material;
            tileMesh.geometry.clearGroups();
            for (let i = 0; i < material.length; i++) {
                tileMesh.geometry.addGroup(0, Infinity, i);
            }
            for (const m of oldMaterial) {
                m.dispose();
            }
        }
        return tileMesh;
    }

    /**
     * 卸载瓦片
     */
    public unload(tileMesh: Mesh): void {
        const materials = Array.isArray(tileMesh.material) ? tileMesh.material : [tileMesh.material];
        for (const m of materials) {
            m.dispose();
            tileMesh.geometry.groups.pop();
        }
        tileMesh.geometry.dispose();
    }
}
```

## TileMapLoader 地图瓦片加载器

在 TileLoader 基础上增加投影处理：

```typescript
export class TileMapLoader extends TileLoader implements ITileMapLoader {
    private _projection: IProjection = new ProjMCT(0);

    public override set imgSource(source: ISource[]) {
        super.imgSource = source;
        this._updateImgProjBounds();
    }

    public override set demSource(source: ISource | undefined) {
        super.demSource = source;
        this._updateDemPrjBounds();
    }

    /**
     * 更新影像源的投影范围
     */
    private _updateImgProjBounds() {
        const proj = this._projection;
        this.imgSource.forEach(source => {
            source._projectionBounds = proj.getProjBoundsFromLonLat(source.bounds || this.bounds);
        });
    }

    /**
     * 更新地形源的投影范围
     */
    private _updateDemPrjBounds() {
        const proj = this._projection;
        if (this.demSource) {
            this.demSource._projectionBounds = proj.getProjBoundsFromLonLat(this.demSource.bounds || this.bounds);
        }
    }

    /**
     * 重写 load 方法，增加投影坐标转换
     */
    public override async load(params: TileLoadParamsType): Promise<Mesh> {
        const { x, y, z, bounds, lonLatBounds } = this.getTileCoords(params);
        return super.load({ x, y, z, bounds, lonLatBounds });
    }

    /**
     * 获取投影后的瓦片坐标
     */
    private getTileCoords(params: TileLoadParamsType) {
        const { x, y, z } = params;
        // 根据中央经线调整X坐标
        const newX = this._projection.getTileXWithCenterLon(x, z);
        // 获取投影范围
        const bounds = this._projection.getProjBoundsFromXYZ(x, y, z);
        // 获取经纬度范围
        const lonLatBounds = this._projection.getLonLatBoundsFromXYZ(x, y, z);

        return { x: newX, y, z, bounds, lonLatBounds };
    }
}
```

## 材质加载器基类

```typescript
export abstract class TileMaterialLoader implements ITileMaterialLoader<ITileMaterial> {
    public info = { version, description: "Image loader base class" };
    public dataType = "";
    private _material: ITileMaterial = new TileMaterial();

    public async load(params: TileSourceLoadParamsType): Promise<ITileMaterial> {
        const { source, x, y, z } = params;
        const material = this.createMaterial();

        // 获取安全URL和裁剪范围
        const { url, clipBounds } = getSafeTileUrlAndBounds(source, x, y, z);
        if (url) {
            material.map = await this.doLoad(url, { ...params, clipBounds });
        }

        return material;
    }

    public unload(material: ITileMaterial): void {
        const texture = material.map;
        if (texture) {
            if (texture.image instanceof ImageBitmap) {
                texture.image.close();
            }
            texture.dispose();
        }
    }

    public createMaterial(): ITileMaterial {
        return this.material.clone();
    }

    // 子类实现具体的加载逻辑
    protected abstract doLoad(url: string, params: TileLoadClipParamsType): Promise<Texture>;
}
```

## 几何体加载器基类

```typescript
export abstract class TileGeometryLoader implements ITileGeometryLoader<TileGeometry> {
    public info: ITileLoaderInfo = {
        version,
        description: "Terrain loader base class",
    };

    public dataType = "";

    public async load(params: TileSourceLoadParamsType): Promise<TileGeometry> {
        const { source, x, y, z } = params;
        const { url, clipBounds } = getSafeTileUrlAndBounds(source, x, y, z);

        if (!url) {
            return new TileGeometry();
        }

        const geometry = await this.doLoad(url, { ...params, clipBounds });
        LoaderFactory.manager.parseEnd(geometry);  // 触发解析完成事件
        return geometry;
    }

    protected abstract doLoad(url: string, params: TileLoadClipParamsType): Promise<TileGeometry>;
}
```

## 内置加载器

### TileImageLoader

标准影像加载器，支持 xyz 瓦片格式：

```typescript
export class TileImageLoader extends TileMaterialLoader {
    public readonly dataType = "image";
    private loader = new ImageLoader(LoaderFactory.manager);

    protected async doLoad(url: string, params: TileLoadClipParamsType): Promise<Texture> {
        const img = await this.loader.loadAsync(url);
        const texture = new Texture();
        texture.colorSpace = SRGBColorSpace;
        texture.image = img;

        // 从父瓦片中裁剪
        if (params.clipBounds[2] - params.clipBounds[0] < 1) {
            texture.image = getSubImage(img, params.clipBounds);
        }

        return texture;
    }
}
```

### TerrainRGBLoader

Mapbox Terrain-RGB 格式加载器：

```typescript
export class TerrainRGBLoader extends TileGeometryLoader {
    public readonly dataType = "terrain-rgb";
    private imageLoader = new ImageLoader(LoaderFactory.manager);
    private _workerPool = new WorkerPool(0);

    protected async doLoad(url: string, params: TileLoadClipParamsType): Promise<TileGeometry> {
        const img = await this.imageLoader.loadAsync(url);
        const { clipBounds, z } = params;

        // 根据层级计算目标尺寸
        const targetSize = MathUtils.clamp((z + 2) * 3, 2, 64);
        const imgData = getSubImageData(img, clipBounds, targetSize);

        // 使用 Worker 解析 RGB 到高程
        if (this._workerPool.pool === 0) {
            this._workerPool.setWorkerLimit(THREADSNUM);
        }
        const dem = (await this._workerPool.postMessage({ imgData }, [imgData.data.buffer])).data;

        const geometry = new TileGeometry();
        geometry.setData(dem);

        return geometry;
    }
}
```

**Terrain-RGB 编码**：
```
height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
```

## 数据流程

```
Tile.update()
    │
    ▼
TileLoader.load()
    │
    ├──► loadGeometry() ──► LoaderFactory.getGeometryLoader()
    │                           │
    │                           ├──► TerrainRGBLoader
    │                           ├──► TerrainLercLoader
    │                           └──► 自定义加载器
    │
    └──► loadMaterial() ──► LoaderFactory.getMaterialLoader()
                                │
                                ├──► TileImageLoader
                                └──► 自定义加载器
    │
    ▼
Mesh (geometry + materials[])
```

## 自定义加载器

### 注册自定义加载器

```typescript
// 自定义影像加载器
class MyImageLoader extends TileMaterialLoader {
    dataType = "my-image";

    protected async doLoad(url: string, params: TileLoadClipParamsType): Promise<Texture> {
        // 自定义加载逻辑
        const texture = await loadMyTexture(url);
        return texture;
    }
}

// 注册
registerImgLoader(new MyImageLoader());

// 使用
const source = new TileSource({
    url: "https://example.com/{z}/{x}/{y}.png",
    dataType: "my-image"
});
```

## 关键特性

1. **插件化设计**: 通过工厂模式实现加载器的注册和获取
2. **并发控制**: 全局下载线程数限制（默认10）
3. **错误处理**: 加载失败时使用错误材质/几何体
4. **资源管理**: 自动绑定 dispose 事件清理资源
5. **纹理裁剪**: 支持从父瓦片裁剪子瓦片纹理
