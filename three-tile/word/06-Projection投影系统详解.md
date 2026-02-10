# Projection 投影系统详解

## 概述

Projection 投影系统负责地理坐标（经纬度）与地图投影坐标之间的转换，是地理信息系统（GIS）的核心组件。Three-Tile 支持两种主流地图投影：Web Mercator (EPSG:3857) 和 WGS84 (EPSG:4326)。

**源码位置**: `packages/lib/src/map/projection/`

## 模块结构

```
projection/
├── IProjection.ts        # 投影接口定义
├── BaseProjection.ts     # 投影抽象基类
├── ProjMCT.ts           # Web Mercator 投影
├── ProjWGS.ts           # WGS84 线性投影
├── ProjectFactory.ts    # 投影工厂
└── index.ts             # 模块导出
```

## 投影接口 (IProjection)

```typescript
export type ProjectionType = "3857" | "4326";

export interface IProjection {
    readonly ID: ProjectionType;      // 投影ID
    readonly mapWidth: number;        // 地图宽度（米）
    readonly mapHeight: number;       // 地图高度（米）
    readonly mapDepth: number;        // 地图深度比例
    readonly lon0: number;            // 中央经线

    // 地理坐标 → 投影坐标
    project(lon: number, lat: number): { x: number; y: number };

    // 投影坐标 → 地理坐标
    unProject(x: number, y: number): { lon: number; lat: number };

    // 根据中央经线调整瓦片X坐标
    getTileXWithCenterLon(x: number, z: number): number;

    // 经纬度范围 → 投影范围
    getProjBoundsFromLonLat(bounds: [number, number, number, number]): [number, number, number, number];

    // 瓦片坐标 → 投影范围
    getProjBoundsFromXYZ(x: number, y: number, z: number): [number, number, number, number];

    // 瓦片坐标 → 经纬度范围
    getLonLatBoundsFromXYZ(x: number, y: number, z: number): [number, number, number, number];
}
```

## 投影基类 (BaseProjection)

```typescript
export abstract class Projection implements IProjection {
    abstract ID: ProjectionType;
    abstract mapWidth: number;
    abstract mapHeight: number;
    abstract mapDepth: number;
    abstract project(lon: number, lat: number): { x: number; y: number };
    abstract unProject(x: number, y: number): { lon: number; lat: number };

    private _lon0: number = 0;

    public get lon0(): number {
        return this._lon0;
    }

    public constructor(centerLon: number = 0) {
        this._lon0 = centerLon;
    }

    /**
     * 根据中央经线调整瓦片X坐标
     * 解决跨日期线问题
     */
    public getTileXWithCenterLon(x: number, z: number): number {
        const n = Math.pow(2, z);  // 当前层级的瓦片总数
        // 计算偏移量
        let newx = x + Math.round((n / 360) * this._lon0);
        // 处理环绕
        if (newx >= n) {
            newx -= n;
        } else if (newx < 0) {
            newx += n;
        }
        return newx;
    }

    /**
     * 经纬度范围转投影坐标范围
     */
    public getProjBoundsFromLonLat(bounds: [number, number, number, number]): [number, number, number, number] {
        // 判断是否为全球范围
        const withCenter = bounds[2] - bounds[0] > 180;
        const p1 = this.project(
            bounds[0] + (withCenter ? this._lon0 : 0),
            bounds[1]
        );
        const p2 = this.project(
            bounds[2] + (withCenter ? this._lon0 : 0),
            bounds[3]
        );
        return [
            Math.min(p1.x, p2.x),
            Math.min(p1.y, p2.y),
            Math.max(p1.x, p2.x),
            Math.max(p1.y, p2.y)
        ];
    }

    /**
     * 瓦片坐标转投影范围
     */
    public getProjBoundsFromXYZ(x: number, y: number, z: number): [number, number, number, number] {
        const worldSize = Math.PI * 6378137;  // 地球周长的一半
        const tileSize = (2 * worldSize) / Math.pow(2, z);
        const minX = -worldSize + x * tileSize;
        const minY = worldSize - (y + 1) * tileSize;
        const maxX = -worldSize + (x + 1) * tileSize;
        const maxY = worldSize - y * tileSize;
        return [minX, minY, maxX, maxY];
    }

    /**
     * 瓦片坐标转经纬度范围
     */
    public getLonLatBoundsFromXYZ(x: number, y: number, z: number): [number, number, number, number] {
        const projectBounds = this.getProjBoundsFromXYZ(x, y, z);
        const p1 = this.unProject(projectBounds[0], projectBounds[1]);
        const p2 = this.unProject(projectBounds[2], projectBounds[3]);
        return [p1.lon, p1.lat, p2.lon, p2.lat];
    }
}
```

## Web Mercator 投影 (EPSG:3857)

墨卡托投影是 Web 地图的标准投影，Google Maps、OpenStreetMap 等都使用此投影。

```typescript
const EarthRad = 6378137;  // 地球半径（米）

export class ProjMCT extends Projection implements IProjection {
    public readonly ID = "3857";
    public mapWidth = 2 * Math.PI * EarthRad;   // 地球周长
    public mapHeight = this.mapWidth;           // 正方形地图
    public mapDepth = 1;

    /**
     * 经纬度 → 投影坐标
     */
    public project(lon: number, lat: number): { x: number; y: number } {
        const lonRad = (lon - this.lon0) * (Math.PI / 180);  // 考虑中央经线偏移
        const latRad = lat * (Math.PI / 180);

        const x = EarthRad * lonRad;
        const y = EarthRad * Math.log(Math.tan(Math.PI / 4 + latRad / 2));

        return { x, y };
    }

    /**
     * 投影坐标 → 经纬度
     */
    public unProject(x: number, y: number): { lon: number; lat: number } {
        let lon = (x / EarthRad) * (180 / Math.PI) + this.lon0;  // 考虑中央经线偏移
        if (lon > 180) lon -= 360;  // 处理跨日期线

        const latRad = 2 * Math.atan(Math.exp(y / EarthRad)) - Math.PI / 2;
        const lat = latRad * (180 / Math.PI);

        return { lat, lon };
    }
}
```

### 墨卡托投影公式

```
x = R × λ
y = R × ln(tan(π/4 + φ/2))

其中:
- R = 地球半径 (6378137m)
- λ = 经度（弧度）
- φ = 纬度（弧度）
```

### 特点

| 特性 | 说明 |
|------|------|
| **角度保持** | 等角投影，局部角度保持不变 |
| **形状保持** | 小区域形状保持真实 |
| **面积变形** | 高纬度区域面积严重放大 |
| **纬度限制** | 约到 ±85.05°，极地无法显示 |
| **标准** | EPSG:3857, Web Mercator |

## WGS84 线性投影 (EPSG:4326)

直接使用经纬度作为坐标的简单投影：

```typescript
export class ProjWGS extends Projection implements IProjection {
    public readonly ID = "4326";
    public mapWidth = 36000 * 1000;   // 360° × 100000
    public mapHeight = 18000 * 1000;  // 180° × 100000
    public mapDepth = 1;

    /**
     * 经纬度 → 投影坐标
     */
    public project(lon: number, lat: number): { x: number; y: number } {
        return {
            x: (lon - this.lon0) * 100 * 1000,
            y: lat * 100 * 1000
        };
    }

    /**
     * 投影坐标 → 经纬度
     */
    public unProject(x: number, y: number): { lon: number; lat: number } {
        return {
            lon: x / (100 * 1000) + this.lon0,
            lat: y / (100 * 1000)
        };
    }
}
```

### 特点

| 特性 | 说明 |
|------|------|
| **简单直接** | 经纬度线性映射，计算简单 |
| **等距** | 经纬度以相同比例缩放 |
| **形状变形** | 中高纬度形状明显变形 |
| **适用范围** | 全球覆盖，包括极地 |
| **标准** | EPSG:4326, WGS84 |

## 投影工厂 (ProjectFactory)

```typescript
export const ProjectFactory = {
    createFromID: (id: ProjectionType = "3857", lon0: number) => {
        let proj: IProjection;
        switch (id) {
            case "3857":
                proj = new ProjMCT(lon0);
                break;
            case "4326":
                proj = new ProjWGS(lon0);
                break;
            default:
                throw new Error(`Projection ID: ${id} is not supported.`);
        }
        return proj;
    },
};
```

## 中央经线 (lon0)

中央经线决定了地图的投影中心，对于跨日期线区域非常重要：

```typescript
// 设置中央经线为 0°（默认）
map.lon0 = 0;

// 设置中央经线为 90°（东半球中心）
map.lon0 = 90;

// 设置中央经线为 -90°（西半球中心）
map.lon0 = -90;
```

中央经线的影响：
- 调整瓦片 X 坐标，确保数据正确加载
- 影响投影转换时的经度偏移
- 解决跨日期线区域的显示问题

## 投影对比

### 3857 (Web Mercator)

```
优点:
- Web 标准，兼容性好
- 角度和形状保持
- 适合中低纬度区域

缺点:
- 极地区域无法显示
- 高纬度面积变形大
- 不适合距离/面积测量
```

### 4326 (WGS84)

```
优点:
- 全球完整覆盖
- 计算简单快速
- 适合科学可视化

缺点:
- 形状变形明显
- 不符合传统地图习惯
- 商业数据源较少
```

## 坐标转换示例

```typescript
// 创建 Web Mercator 投影
const proj = new ProjMCT(0);

// 北京天安门坐标
const lon = 116.3974;
const lat = 39.9093;

// 地理 → 投影
const p1 = proj.project(lon, lat);
// p1 ≈ { x: 12956497, y: 4851492 }

// 投影 → 地理
const p2 = proj.unProject(p1.x, p1.y);
// p2 ≈ { lon: 116.3974, lat: 39.9093 }

// 瓦片范围 (z=10, x=840, y=410)
const bounds = proj.getProjBoundsFromXYZ(840, 410, 10);
const lonLatBounds = proj.getLonLatBoundsFromXYZ(840, 410, 10);
```

## 瓦片坐标系统

### XYZ 方案

```
z: 层级 (0 = 全球, 数值越大细节越多)
x: 经度方向瓦片索引 (0 ~ 2^z - 1)
y: 纬度方向瓦片索引 (0 ~ 2^z - 1)
```

### 瓦片计算

```typescript
// 经纬度 → 瓦片坐标 (Web Mercator)
function lonLatToTile(lon: number, lat: number, z: number) {
    const n = Math.pow(2, z);
    const x = Math.floor((lon + 180) / 360 * n);
    const y = Math.floor(
        (1 - Math.log(Math.tan(lat * Math.PI / 180) +
        1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n
    );
    return { x, y, z };
}

// 瓦片坐标 → 经纬度范围
function tileToLonLatBounds(x: number, y: number, z: number) {
    const n = Math.pow(2, z);
    const lon1 = x / n * 360 - 180;
    const lon2 = (x + 1) / n * 360 - 180;
    const lat1 = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    const lat2 = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
    return { minLon: lon1, maxLon: lon2, minLat: lat2, maxLat: lat1 };
}
```
