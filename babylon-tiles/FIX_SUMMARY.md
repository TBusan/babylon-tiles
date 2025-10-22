# 底图资源加载问题修复总结

## 问题描述
Demo 中创建地图时提示 "Map created successfully!"，但浏览器 Network 中没有请求加载 ArcGIS 服务器的底图资源。

## 根本原因
底图资源无法加载的根本原因是 **Babylon.js Scene 对象未正确传递给相关组件**，导致：
1. `TileMapLoader` 无法创建带有 Scene 的 `Mesh` 和 `StandardMaterial`
2. `TileImageLoader` 无法创建带有 Scene 的 `Texture`
3. 没有 Scene，Babylon.js 无法正确渲染和管理资源

## 修复内容

### 1. 修复 `TileMapLoader.ts`
**文件**: `babylon-tiles/packages/lib/src/loader/TileMapLoader.ts`

#### 修改点 1: 添加 Scene 属性和构造函数参数
```typescript
export class TileMapLoader implements ITileLoader {
  public scene: Scene;  // 新增
  
  constructor(scene: Scene) {  // 修改：添加 scene 参数
    this.scene = scene;
    this.manager = new TileLoadingManager();
    this.imgSource = [];
    this.projection = ProjectFactory.createFromID("3857");
    this.backgroundMaterial = new StandardMaterial("background", scene);  // 修改：传递 scene
    this.backgroundMaterial.diffuseColor = new Color3(0.5, 0.5, 0.5);
  }
}
```

#### 修改点 2: 在 load 方法中传递 Scene
```typescript
public async load(params: TileCoords): Promise<Mesh> {
  this._downloadingThreads++;
  try {
    // 修改：创建 mesh 时传递 scene
    const mesh = new Mesh(`tile-${params.z}-${params.x}-${params.y}`, this.scene);
    
    // 加载几何体和材质...
    return mesh;
  } finally {
    this._downloadingThreads--;
  }
}
```

#### 修改点 3: 在 loadMaterial 中动态设置 loader 的 scene
```typescript
private async loadMaterial(params: TileCoords): Promise<StandardMaterial | null> {
  const loader = LoaderFactory.getMaterialLoader(source.dataType);
  if (!loader) {
    console.warn(`No material loader found for type: ${source.dataType}`);
    return null;
  }

  // 新增：为 loader 设置 scene
  if ('scene' in loader && !loader.scene) {
    (loader as any).scene = this.scene;
  }

  // 加载材质...
}
```

### 2. 修复 `TileMap.ts`
**文件**: `babylon-tiles/packages/lib/src/map/TileMap.ts`

#### 修改点: 构造函数中传递 Scene 给 TileMapLoader
```typescript
public constructor(params: MapParams) {
  super("map", params.scene);
  
  const {
    loader = new TileMapLoader(params.scene),  // 修改：传递 scene
    rootTile = new Tile(0, 0, 0, params.scene),
    // ... 其他参数
  } = params;
  
  // ... 初始化代码
}
```

### 3. 修复 `demo/main.ts`
**文件**: `babylon-tiles/packages/demo/src/main.ts`

#### 修改点 1: registerLoaders 函数接收 viewer 参数
```typescript
// 修改：添加 viewer 参数
function registerLoaders(viewer: Plugin.BabylonViewer) {
  console.log("======================================================");
  console.log(`Babylon Tiles V${BT.version}`);
  console.log("======================================================");

  // 修改：传递 scene 给 TileImageLoader
  const imgLoader = new BT.TileImageLoader(viewer.scene);
  BT.registerImgLoader(imgLoader);

  // ... 其他代码
}
```

#### 修改点 2: 调整 main 函数中的调用顺序
```typescript
function main() {
  // Hide loading indicator
  setTimeout(() => {
    document.querySelector("#loading")?.classList.add("hidden");
  }, 1000);

  // 1. 先创建 viewer
  const viewer = initViewer();

  // 2. 然后注册 loaders（需要 viewer.scene）
  registerLoaders(viewer);

  // 3. 创建 map
  const map = createMap(viewer);

  // 4. 注册渲染循环
  viewer.scene.registerBeforeRender(() => {
    map.update(viewer.camera);
  });

  // 5. 更新信息显示
  updateInfo(map, viewer);

  console.log("Demo initialized successfully!");
}
```

## 数据流程

修复后的完整数据流程：

```
1. main() 
   ↓
2. initViewer() → 创建 BabylonViewer (包含 scene)
   ↓
3. registerLoaders(viewer) → 注册 TileImageLoader(scene)
   ↓
4. createMap(viewer) 
   ↓
5. new TileMap({ scene, imgSource, ... })
   ↓
6. new TileMapLoader(scene) → 保存 scene 引用
   ↓
7. 渲染循环: map.update(camera)
   ↓
8. tile.update() → tile._startLoad(loader)
   ↓
9. loader.load(tile) → 
   - new Mesh(name, scene)
   - loadMaterial() → loader.load({ x, y, z, source })
     ↓
10. TileImageLoader.load()
    - source.getUrl(x, y, z) → 生成 URL
    - new StandardMaterial(name, scene)
    - new Texture(url, scene) → 发起网络请求 ✅
    ↓
11. 浏览器 Network 中可以看到瓦片请求 ✅
```

## 关键要点

1. **Scene 是必需的**: Babylon.js 的所有渲染对象（Mesh、Material、Texture）都需要关联到 Scene
2. **Scene 传递链**: Scene 从 TileMap → TileMapLoader → Mesh/Material → Texture
3. **Loader 注册**: TileImageLoader 需要在创建时接收 scene，或在使用前动态设置
4. **初始化顺序**: 必须先创建 viewer（包含 scene），然后才能注册 loaders

## 验证方法

修复后，应该能够在浏览器中看到：
1. Console 输出 "Map created successfully!"
2. Network 面板中有对 ArcGIS 服务器的瓦片请求
3. URL 格式类似: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`
4. 3D 视图中显示地图底图纹理

## 相关文件
- `babylon-tiles/packages/lib/src/loader/TileMapLoader.ts`
- `babylon-tiles/packages/lib/src/map/TileMap.ts`
- `babylon-tiles/packages/lib/src/loader/TileImageLoader.ts`
- `babylon-tiles/packages/demo/src/main.ts`

