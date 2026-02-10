# TileMap 地图模块详解

## 概述

`TileMap` 是 Three-Tile 的地图管理类，继承自 Three.js 的 `Object3D`，负责管理整个地图的生命周期、坐标转换、数据源管理和事件分发。

**源码位置**: `packages/lib/src/map/TileMap.ts`

## 类结构

```typescript
export class TileMap extends Object3D<TileMapEventMap> {
    // 核心组件
    public readonly rootTile: Tile;           // 根瓦片
    public readonly loader: ITileMapLoader;   // 瓦片加载器

    // LOD 控制
    public autoUpdate = true;                 // 自动更新
    public updateInterval = 100;              // 更新间隔(ms)
    private _LODThreshold = 1;                // LOD阈值

    // 层级控制
    private _minLevel = 2;                    // 最小层级
    private _maxLevel = 19;                   // 最大层级

    // 数据源
    public imgSource: ISource[];              // 影像数据源
    public demSource: ISource;                // 高程数据源

    // 投影
    public projection: IProjection;           // 地图投影
}
```

## 创建地图

### 静态工厂方法

```typescript
public static create(params: MapParams) {
    return new TileMap(params);
}
```

### 地图参数

```typescript
export type MapParams = {
    debug?: number;                    // 调试模式: 0关闭, 1开启, 2显示包围盒
    loader?: TileMapLoader;            // 自定义加载器
    rootTile?: Tile;                   // 自定义根瓦片
    imgSource: ISource[] | ISource;    // 影像数据源（必需）
    demSource?: ISource;               // 高程数据源（可选）
    backgroundColor?: ColorRepresentation; // 背景色
    bounds?: [number, number, number, number]; // 经纬度范围
    minLevel?: number;                 // 最小缩放级别
    maxLevel?: number;                 // 最大缩放级别
    lon0?: ProjectCenterLongitude;     // 中央经线 (-90 | 0 | 90)
};
```

### 构造函数

```typescript
public constructor(params: MapParams) {
    super();
    this.up.set(0, 0, 1);  // 设置Z轴向上

    // 解构参数，设置默认值
    const {
        loader = new TileMapLoader(),
        rootTile = new Tile(),
        minLevel = 2,
        maxLevel = 20,
        imgSource,
        demSource,
        backgroundColor,
        bounds,
        lon0 = 0,
        debug = 0,
    } = params;

    // 初始化属性
    this._minLevel = minLevel;
    this._maxLevel = maxLevel;
    this.loader = loader;
    this.rootTile = rootTile;

    // 设置背景色和范围
    backgroundColor && this.loader.backgroundMaterial.color.set(backgroundColor);
    bounds && (this.loader.bounds = bounds);
    this.debug = this.loader.debug = debug;
    this.lon0 = lon0;

    // 设置数据源
    this.imgSource = Array.isArray(imgSource) ? imgSource : [imgSource];
    this.demSource = demSource;

    // 添加根瓦片到地图
    this.add(rootTile);

    // 调整地图大小
    this._resize();

    // 绑定事件
    attachEvent(this);

    // 监听加载完成事件
    const onLoadingComplete = () => {
        this.dispatchEvent({ type: "ready" });
        this.removeEventListener("loading-complete", onLoadingComplete);
    };
    this.addEventListener("loading-complete", onLoadingComplete);
}
```

## 投影管理

### 设置中央经线

```typescript
public set lon0(value) {
    if (this.projection.lon0 !== value) {
        // 检查最小层级
        if (value != 0 && this.minLevel < 1) {
            console.warn(`Map centralMeridian is ${this.lon0}, minLevel must > 0`);
        }
        // 重新创建投影
        this.projection = ProjectFactory.createFromID(
            this.projection.ID,
            value
        );
        this.updateSource();
    }
}
```

中央经线影响地图的投影中心，可设置为 -90、0、90，解决跨日期线问题。

### 投影与地图尺寸

```typescript
private _resize() {
    // 根据投影调整地图大小
    this.rootTile.scale.set(
        this.projection.mapWidth,   // 东西方向尺寸
        this.projection.mapHeight,  // 南北方向尺寸
        this.projection.mapDepth    // 高度方向尺寸
    );
    this.rootTile.updateMatrix();
    this.rootTile.updateMatrixWorld();
}
```

不同投影有不同的尺寸：
- **EPSG:3857 (墨卡托)**: mapWidth = mapHeight = 2π × 6378137m
- **EPSG:4326 (WGS84)**: mapWidth = 36000000m, mapHeight = 18000000m

## 数据源管理

### 设置影像数据源

```typescript
public set imgSource(value: ISource | ISource[]) {
    const sources = Array.isArray(value) ? value : [value];
    if (sources.length === 0) {
        throw new Error("imgSource can not be empty");
    }

    // 将第一个影像层的投影设置为地图投影
    this.projection = ProjectFactory.createFromID(
        sources[0].projectionID,
        this.projection.lon0
    );
    this.loader.imgSource = sources;
    this.updateSource(true, false);

    this.dispatchEvent({ type: "source-changed", source: value });
}
```

### 设置高程数据源

```typescript
public set demSource(value: ISource | undefined) {
    this.loader.demSource = value;
    this.updateSource(false, true);
    this.dispatchEvent({ type: "source-changed", source: value });
}
```

### 更新数据源

```typescript
public updateSource(updateMaterial = true, updateGeometry = true) {
    this.rootTile.updateData(updateMaterial, updateGeometry);
}
```

这会遍历整个瓦片树，标记需要更新的瓦片。

## 坐标转换系统

### 地理坐标 → 地图坐标

```typescript
public geo2map(geo: Vector3) {
    const pos = this.projection.project(geo.x, geo.y);
    return new Vector3(pos.x, pos.y, geo.z);
}
```

### 地图坐标 → 地理坐标

```typescript
public map2geo(pos: Vector3) {
    const position = this.projection.unProject(pos.x, pos.y);
    return new Vector3(position.lon, position.lat, pos.z);
}
```

### 地理坐标 → 世界坐标

```typescript
public geo2world(geo: Vector3) {
    return this.localToWorld(this.geo2map(geo));
}
```

### 世界坐标 → 地理坐标

```typescript
public world2geo(world: Vector3) {
    return this.pos2geo(this.worldToLocal(world.clone()));
}
```

## 获取地面信息

### 从地理坐标获取

```typescript
public getLocalInfoFromGeo(geo: Vector3) {
    const pointer = this.geo2world(geo);
    return getLocalInfoFromWorld(this, pointer);
}
```

### 从世界坐标获取

```typescript
public getLocalInfoFromWorld(pos: Vector3) {
    return getLocalInfoFromWorld(this, pos);
}
```

### 从屏幕坐标获取

```typescript
public getLocalInfoFromScreen(camera: Camera, pointer: Vector2) {
    return getLocalInfoFromScreen(camera, this, pointer);
}
```

返回 `LocationInfo` 类型，包含法向量、高度等信息。

## 每帧更新

```typescript
public update(camera: Camera) {
    const elapseTime = this._mapClock.getElapsedTime();

    // 控制更新频率
    if (elapseTime > this.updateInterval / 1000) {
        // 更新根瓦片
        this.rootTile.update({
            camera,
            loader: this.loader,
            minLevel: this.minLevel,
            maxLevel: this.maxLevel,
            LODThreshold: this.LODThreshold,
        });

        // 更新阴影设置
        this.rootTile.castShadow = this.castShadow;
        this.rootTile.receiveShadow = this.receiveShadow;

        // 触发更新事件
        this.dispatchEvent({ type: "update", delta: elapseTime });

        // 重置时钟
        this._mapClock.start();
    }
}
```

## 地图操作

### 重新加载

```typescript
public reload() {
    this.rootTile.reload(this.loader);
}
```

销毁所有瓦片并重新创建，切换投影时必须调用。

### 释放资源

```typescript
public dispose() {
    this.removeFromParent();
    this.reload();
}
```

## 统计信息

```typescript
public getTileCount() {
    let total = 0, visible = 0, inFrustum = 0,
        maxLevel = 0, leaf = 0, downloading = 0;

    this.rootTile.traverse(tile => {
        if (!(tile instanceof Tile)) return;

        total++;
        if (tile.isLeaf) {
            leaf++;
            tile.showing && visible++;
            tile.inFrustum && inFrustum++;
        }
        maxLevel = Math.max(maxLevel, tile.z);
        downloading = this.loader.downloadingThreads;
    });

    return { total, leaf, visible, inFrustum, maxLevel, downloading };
}
```

返回瓦片树的状态统计：
- `total`: 总瓦片数
- `leaf`: 叶子瓦片数
- `visible`: 可见的叶子瓦片数
- `inFrustum`: 视锥体内的叶子瓦片数
- `maxLevel`: 当前最大层级
- `downloading`: 正在下载的瓦片数

## 事件系统

```typescript
interface TileMapEventMap {
    "ready": Event;                      // 地图准备就绪
    "update": Event & { delta: number }; // 每帧更新
    "projection-changed": Event & { projection: IProjection };
    "source-changed": Event & { source: ISource | ISource[] };
    "loading-complete": Event;
}
```

## 使用示例

```typescript
// 创建地图
const map = TileMap.create({
    imgSource: new TileSource({
        url: "https://tile.example.com/{z}/{x}/{y}.png",
        dataType: "image",
        projectionID: "3857",
        minLevel: 0,
        maxLevel: 18
    }),
    demSource: new TileSource({
        url: "https://terrain.example.com/{z}/{x}/{y}.png",
        dataType: "terrain-rgb",
        projectionID: "3857"
    }),
    minLevel: 2,
    maxLevel: 18,
    lon0: 0,
    backgroundColor: 0x112233
});

// 添加到场景
scene.add(map);

// 坐标转换
const worldPos = map.geo2world(new Vector3(116.4, 39.9, 0));

// 监听事件
map.addEventListener("ready", () => {
    console.log("Map is ready!");
});
```
