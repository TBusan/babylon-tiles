# Material 材质系统详解

## 概述

Material 材质系统负责处理瓦片的视觉效果，包括影像纹理显示、矢量数据渲染、着色器效果等。

**源码位置**: `packages/lib/src/material/`

## 模块结构

```
material/
├── TileMaterial.ts           # 基础瓦片材质
├── shader/
│   ├── TileShaderMaterial.ts # 自定义着色器材质（已废弃）
│   └── filter/
│       └── TileFilterMaterial.ts  # 滤镜材质
└── vectorTileRenderer/       # 矢量瓦片渲染器
    ├── IVectorTileRender.ts  # 接口定义
    └── VectorTileRender.ts   # 渲染器实现
```

## ITileMaterial 接口

```typescript
export interface ITileMaterial extends Material {
    map?: Texture | null;  // 纹理贴图
}
```

## TileMaterial 基础材质

继承自 Three.js 的 `MeshStandardMaterial`，是瓦片的标准材质：

```typescript
export class TileMaterial extends MeshStandardMaterial {
    constructor(params: MeshLambertMaterialParameters = {}) {
        super({
            ...{
                transparent: false,
                side: FrontSide  // 只渲染正面
            },
            ...params
        });
    }
}
```

### 特点

| 属性 | 默认值 | 说明 |
|------|--------|------|
| `transparent` | false | 不透明 |
| `side` | FrontSide | 只渲染正面，提高性能 |
| 继承自 | MeshStandardMaterial | 支持光照效果 |

## 多材质叠加

Three-Tile 使用多材质叠加的方式实现多图层显示：

```typescript
// TileLoader.load() 方法中的材质组织
const materials: Material[] = [this.backgroundMaterial];  // 背景层

// 遍历影像源，每层一个材质
for (const source of sources) {
    const material = await loader.load({ source, ...params });
    materials.push(material);  // 叠加影像层
}

// 创建 Mesh
const mesh = new Mesh(geometry, materials);

// 设置几何体分组，每个材质对应一组顶点
geometry.clearGroups();
for (let i = 0; i < materials.length; i++) {
    geometry.addGroup(0, Infinity, i);
}
```

### 材质层级

```
┌────────────────────────────────────┐
│  material[2] - 第二影像层           │
├────────────────────────────────────┤
│  material[1] - 第一影像层           │
├────────────────────────────────────┤
│  material[0] - 背景层               │
└────────────────────────────────────┘
            ↓
     BufferGeometry
```

## TileShaderMaterial 着色器材质（已废弃）

这是一个自定义着色器材质，目前不再使用，但保留了代码供参考：

```typescript
export class TileShaderMaterial extends ShaderMaterial {
    public constructor(parameters: TileMaterialParameters) {
        super({
            uniforms: UniformsUtils.merge([
                ShaderLib.lambert.uniforms,
                {
                    map1: { value: null },  // 第二张纹理
                    diffuse: { value: new Color(0xffffff) },
                },
            ]),
            vertexShader: vert,  // 自定义顶点着色器
            fragmentShader: frag, // 自定义片段着色器
            lights: true,
            transparent: parameters.transparent || true,
            wireframe: parameters.wireframe || false,
            fog: true,
        });

        this.uniforms.map.value = parameters.map;
        this.uniforms.map1.value = parameters.map1;
    }
}
```

### 废弃原因

1. **动态层数问题**: 着色器中难以传入动态数量的纹理
2. **接缝问题**: 用着色器实现地形渲染难以解决瓦片接缝
3. **射线检测**: 无法通过着色器实现射线法获取高程

目前改用多重材质叠加方式实现多图层显示。

## TileFilterMaterial 滤镜材质

使用自定义着色器实现图像滤镜效果：

```typescript
export class TileFilterMaterial extends ShaderMaterial implements ITileMaterial {
    private _map: Texture | null = null;

    public get map() {
        return this._map;
    }
    public set map(value: Texture | null) {
        this._map = value;
        this.uniforms.u_texture.value = value;
    }

    public constructor() {
        super({
            uniforms: UniformsUtils.merge([
                UniformsLib.fog,
                {
                    u_texture: { value: null },
                    brightness: { value: 0.5 },   // 亮度
                    contrast: { value: 0.5 },     // 对比度
                    hue: { value: 0.5 },          // 色调
                    saturation: { value: 0.5 },   // 饱和度
                },
            ]),
            transparent: true,
            depthTest: false,
            vertexShader: vert,
            fragmentShader: frag,
            lights: false,
        });
    }
}
```

### 片段着色器

```glsl
varying vec2 vUv;
uniform float brightness;
uniform float contrast;
uniform float hue;
uniform float saturation;
uniform sampler2D u_texture;

void main() {
    vec4 texColor = texture2D(u_texture, vUv);

    // 反色
    texColor.rgb = vec3(1.0) - texColor.rgb;

    // 亮度调整
    texColor.rgb = mix(vec3(0.0), texColor.rgb, brightness);

    // 对比度调整
    texColor.rgb = mix(vec3(0.5), texColor.rgb, contrast);

    // 色调旋转
    float angle = hue * 3.14159265;
    float s = sin(angle), c = cos(angle);
    vec3 weights = (vec3(2.0 * c, -sqrt(3.0) * s - c, sqrt(3.0) * s - c) + 1.0) / 3.0;
    float len = length(texColor.rgb);
    texColor.rgb = vec3(
        dot(texColor.rgb, weights.xyz),
        dot(texColor.rgb, weights.zxy),
        dot(texColor.rgb, weights.yzx)
    );

    // 饱和度调整
    float average = (texColor.r + texColor.g + texColor.b) / 3.0;
    if(saturation > 0.0) {
        texColor.rgb += (average - texColor.rgb) * (1.0 - 1.0 / (1.001 - saturation));
    } else {
        texColor.rgb += (average - texColor.rgb) * (-saturation);
    }

    // 颜色叠加
    texColor.rgb = texColor.rgb * 0.6 + vec3(0.12 * 2.0, 0.16 * 2.0, 0.2 * 2.0);

    gl_FragColor = texColor;
}
```

### 滤镜效果

| uniform | 效果 | 范围 |
|---------|------|------|
| `brightness` | 亮度 | 0 ~ 1 |
| `contrast` | 对比度 | 0 ~ 1 |
| `hue` | 色调旋转 | 0 ~ 1 |
| `saturation` | 饱和度 | 0 ~ 1 |

## 矢量瓦片渲染

VectorTileRender 类用于在 Canvas 上绘制矢量数据：

```typescript
export class VectorTileRender {
    /**
     * 渲染矢量要素
     */
    public render(
        ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
        type: VectorFeatureTypes,
        feature: VectorFeature,
        style: VectorStyle,
        scale: number = 1
    ): void {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // 设置阴影
        if ((style.shadowBlur ?? 0) > 0) {
            ctx.shadowBlur = style.shadowBlur ?? 2;
            ctx.shadowColor = style.shadowColor ?? "black";
            ctx.shadowOffsetX = style.shadowOffset ? style.shadowOffset[0] : 0;
            ctx.shadowOffsetY = style.shadowOffset ? style.shadowOffset[1] : 0;
        }

        // 根据要素类型渲染
        switch (type) {
            case VectorFeatureTypes.Point:
                this._renderPointText(ctx, feature, scale, ...);
                break;
            case VectorFeatureTypes.Linestring:
                this._renderLineString(ctx, feature, scale);
                break;
            case VectorFeatureTypes.Polygon:
                this._renderPolygon(ctx, feature, scale);
                break;
        }

        // 填充
        if (style.fill || type === VectorFeatureTypes.Point) {
            ctx.globalAlpha = style.fillOpacity || 0.5;
            ctx.fillStyle = style.fillColor || style.color || "#3388ff";
            ctx.fill(style.fillRule || "evenodd");
        }

        // 描边
        if ((style.stroke ?? true) && (style.weight ?? 1) > 0) {
            ctx.globalAlpha = style.opacity || 1;
            ctx.lineWidth = style.weight || 1;
            ctx.strokeStyle = style.color || "#3388ff";
            ctx.setLineDash(style.dashArray || []);
            ctx.stroke();
        }
    }
}
```

### 矢量要素类型

```typescript
enum VectorFeatureTypes {
    Point = 1,        // 点
    Linestring = 2,   // 线
    Polygon = 3       // 面
}
```

### 样式参数

```typescript
interface VectorStyle {
    color?: string;           // 线条颜色
    fillColor?: string;       // 填充颜色
    opacity?: number;         // 不透明度
    fillOpacity?: number;     // 填充不透明度
    weight?: number;          // 线宽
    fill?: boolean;           // 是否填充
    stroke?: boolean;         // 是否描边
    fillRule?: CanvasFillRule; // 填充规则
    dashArray?: number[];     // 虚线样式
    shadowBlur?: number;      // 阴影模糊
    shadowColor?: string;     // 阴影颜色
    shadowOffset?: [number, number]; // 阴影偏移
    font?: string;            // 字体
    fontColor?: string;       // 字体颜色
    fontOffset?: [number, number]; // 字体偏移
    textField?: string;       // 文本字段
}
```

### 点要素渲染

```typescript
private _renderPointText(ctx, feature, scale, textFiled, fontOffset) {
    const points = feature.geometry;
    ctx.beginPath();

    // 绘制点
    for (const point of points) {
        for (let i = 0; i < point.length; i++) {
            const p = point[i];
            ctx.arc(p.x * scale, p.y * scale, 2, 0, 2 * Math.PI);
        }
    }

    // 绘制标签
    const properties = feature.properties;
    if (properties && properties[textFiled]) {
        ctx.fillText(
            properties[textFiled],
            points[0][0].x * scale + fontOffset[0],
            points[0][0].y * scale + fontOffset[1]
        );
    }
}
```

### 线要素渲染

```typescript
private _renderLineString(ctx, feature, scale) {
    const lines = feature.geometry;
    ctx.beginPath();

    for (const line of lines) {
        for (let i = 0; i < line.length; i++) {
            const { x, y } = line[i];
            if (i === 0) {
                ctx.moveTo(x * scale, y * scale);
            } else {
                ctx.lineTo(x * scale, y * scale);
            }
        }
    }
}
```

### 面要素渲染

```typescript
private _renderPolygon(ctx, feature, scale) {
    const polygons = feature.geometry;
    ctx.beginPath();

    for (const ring of polygons) {
        for (let j = 0; j < ring.length; j++) {
            const { x, y } = ring[j];
            if (j === 0) {
                ctx.moveTo(x * scale, y * scale);
            } else {
                ctx.lineTo(x * scale, y * scale);
            }
        }
        ctx.closePath();
    }
}
```

## 材质数据流程

```
数据源 (ISource)
    │
    ▼
TileMaterialLoader.load()
    │
    ├──► getSafeTileUrlAndBounds()  ──► URL + 裁剪范围
    │
    ▼
doLoad()  ──► 下载图像
    │
    ├──► TileImageLoader: ImageLoader → Texture
    ├──► 矢量渲染: Canvas → Texture
    └──► 自定义加载器
    │
    ▼
createMaterial()  ──► 创建 TileMaterial
    │
    ▼
material.map = texture
    │
    ▼
TileLoader.loadMaterial()  ──► 收集所有材质层
    │
    ▼
new Mesh(geometry, materials[])  ──► 创建 Mesh
```

## 材质优化建议

1. **使用纹理压缩**: 减少 GPU 内存占用
2. **设置合理的 `anisotropy`**: 改善倾斜视角的纹理质量
3. **控制 `generateMipmaps`**: 根据需求决定是否生成 mipmap
4. **复用材质**: 相同配置的瓦片共享材质实例
5. **适时 dispose**: 不再使用的材质及时释放资源
