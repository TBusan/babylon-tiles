# Babylon 9 精度升级方案（平面地图精度问题）

## Context（背景与结论）

用户问：新版 Babylon.js 有了"世界相机"（`GeospatialCamera`），babylon-tiles 用它会更好吗？

**调研结论**：`GeospatialCamera` 是 **ECEF 球体地球相机**（行星居中于原点、`center/yaw/pitch/radius` 绕球导航、配套 `GeospatialClippingBehavior` 只接受 `GeospatialCamera`）。而本项目是**平面 Web Mercator 地图**（`TileMap` 单位四边形缩放到米，X=东、Y=海拔、Z=北，范围 ±2,000 万米）。范式不兼容，换用等于把投影/瓦片定位/地形高程/法线/雾/裁剪/拾取全部改成球面——**不采用**。

但"世界相机"同批带来的精度机制正是本项目缺的：
1. **CPU 位置抖动**：Babylon 7 矩阵用 `Float32Array`，世界坐标 ±2e7 处 ulp≈2.4m，`Tile._checkPoint`/`getBBox()` CPU 侧量化 → 瓦片边缘错位。
2. **GPU 瓦片接缝**：`worldViewProjection` uniform 携带大平移，Float32 打包量化（±4e6 处 ~0.5m），大坐标近地缩放时相邻瓦片边缘错位。
3. **深度 z-fighting**：`TileMapControls` 固定 `near=1, far=5e7`，相机高 6km 时每深度步 ≈2.1m。

**方案**（用户确认：**直接升到 Babylon 9.x 最新 9.21.2**，目的解决平面地图精度问题）：
- 引擎开启 **`useLargeWorldRendering: true`**（9.x 中强制 `useHighPrecisionMatrix`(Float64 CPU 矩阵) + 所有 scene 开 `floatingOriginMode`，且在 shader 层同时偏移 **uniform 和 attribute** → CPU 与 GPU 精度全覆盖）。浮点原点只在 Float64→Float32 打包边界做偏移，**所有公开 getter 与 JS 空间坐标读取保持原世界坐标** → 手写 `Tile.computeWorldMatrix`、视锥裁剪、LOD、`geo2world`/`world2geo`、拾取全部不受影响且更精确。
- `TileMapControls` 增加**动态 near/far**（借鉴 GeospatialClippingBehavior 的 near=离地高度×系数，far 保留现有平面算法）。
- **9.x 输入系统迁移**（必需）：`_panningMouseButton` → `camera.movement.input.setInteraction`；其余旧属性（`panningSensibility`/`wheelDeltaPercentage`/`inertia`/`panningAxis`/`minZ`/`maxZ`/`attachControl`）9.x 保留向后兼容，验证即可。

> 已核实：7.54.3 就支持 `useHighPrecisionMatrix`（CPU 侧 Float64），但 **floating origin 是 8/9.x 独有**（7.54 core 无 `floatingOrigin`）。因用户选 9.x，CPU+GPU 一起拿到。`GeospatialClippingBehavior` 仅接受 `GeospatialCamera`，**不可用**于本项目平面相机。

---

## 实施步骤

### Step 1 — 升级 Babylon 7.54.3 → 9.21.2（4 个包 + lockfile）

改 `package.json` 中 `@babylonjs/*` 为 `^9.21.2`：
- `packages/lib/package.json`：`@babylonjs/core`、`@babylonjs/loaders`
- `packages/plugin/package.json`：`@babylonjs/core`
- `packages/demo/package.json`：`@babylonjs/core`、`@babylonjs/loaders`、`@babylonjs/gui`（`gui` 声明了但未 import，可一并升或删）
- `packages/demo-plugin/package.json`：`@babylonjs/core`

`pnpm install` 重新生成 lockfile；`pnpm typecheck` + `pnpm build` 修编译错误。**empirical 收敛**：9.x 对本项目 API（`Scene.fogMode/pick`、`TransformNode.computeWorldMatrix` 覆写签名、`Matrix.ComposeToRef/multiplyToRef/TransformCoordinates`、`Effect.ShadersStore`、`ShaderMaterial`、`useLogarithmicDepth`、`BoundingBox`、`SceneLoader`）应无破坏，若编译/启动报错逐条修复。

### Step 2 — 迁移 9.x 相机输入系统（必需）

`packages/lib/src/controls/TileMapControls.ts`：
- 第 106 行 `camera.attachControl(true, true, 0)`：9.x 第三参为 `useCtrlForPanning`（布尔），`0` 即 false，语义保留；改为 `camera.attachControl(true)` 或保留，**运行时验证**左键/右键行为。
- 第 209-212 行 `_applyControlsMode()`：`_panningMouseButton` 在 9.x 已不控制按钮映射，改为 `movement.input.setInteraction`：

```ts
private _applyControlsMode(): void {
  const input = (this._camera as any).movement?.input;
  if (input?.setInteraction) {
    input.resetInputMap();                      // 先恢复默认映射再覆盖
    if (this._controlsMode === 'MAP') {
      input.setInteraction('pointer', { button: 0 }, 'pan');   // 左键平移
      input.setInteraction('pointer', { button: 2 }, 'rotate'); // 右键旋转
    } else {
      input.setInteraction('pointer', { button: 0 }, 'rotate'); // 左键旋转
      input.setInteraction('pointer', { button: 2 }, 'pan');   // 右键平移
    }
  } else {
    // 旧版本兜底：保留 _panningMouseButton 赋值
    (this._camera as unknown as { _panningMouseButton: number })._panningMouseButton =
      this._controlsMode === 'MAP' ? 0 : 2;
  }
}
```

- **灵敏度/惯性**：`panningSensibility`、`wheelDeltaPercentage`、`inertia`、`panningInertia`、`panningAxis`、`minZ`/`maxZ` 在 9.x 均为向后兼容（未定义 input entry `sensitivity` 时回退到旧属性）。运行时若手感/缩放速度不对，改走 `camera.movement.input.getEntry('pointer','rotate').sensitivityX/Y`、`getEntry('wheel','zoom').sensitivity` 或 `camera.movement.zoomSpeed`。
- **运行时必须验证**：MAP 左键平移、右键旋转；ORBIT 相反；滚轮缩放灵敏度与惯性不变。注意 `movement.input` 是 9.0 之后引入，`^9.21.2` 已含，代码需 `?.` 守卫。

### Step 3 — 两个 demo 开启 Large World Rendering

- `packages/demo/src/main.ts:41`：`new Engine(canvas, true)` → `new Engine(canvas, true, { useLargeWorldRendering: true })`
- `packages/demo-plugin/src/main.ts:46`：同上。

lib 无需为 LWR 改动（手写 `computeWorldMatrix`、JS 空间读取、自定义 ShaderMaterial 标准 uniform 名 `world`/`worldViewProjection` 均被自动偏移）。可选：`TileMap` 构造时若引擎无 LWR 打一条 dev 警告。

### Step 4 — `TileMapControls` 动态 near/far（修正版）

`packages/lib/src/controls/TileMapControls.ts`：
- 新增公开旋钮：`dynamicNear = true`、`nearFactor = 0.01`、`minNear = 0.5`
- 第 98 行 `camera.minZ = 1` → `camera.minZ = this.minNear`
- `_update()` 中 **`groundHeightAt` 每帧只查一次**（near 与 `_applyHeightClamp` 共用），far 保底倍数取 **×100**（原方案 ×1000 在高空会把 far 顶到 1.5e8，far 越大深度精度越差）：

```ts
// 在 _update() 里统一算一次地表高度（_applyHeightClamp 也复用它）
let groundY = 0;
if (this.groundHeightAt) {
  groundY = this.groundHeightAt(cam.position.x, cam.position.z);
  this._groundYThisFrame = groundY; // _applyHeightClamp 内改用该缓存
}

if (this.dynamicNear) {
  const groundDist = Math.max(1, cam.position.y - groundY);
  cam.minZ = Math.max(this.minNear, groundDist * this.nearFactor);
}
// 现有动态 far 保留；与 near 保底比例（×100，避免高空 far 反噬）
const far = Math.min(Math.max((dist / (beta / 1.5)) * 7, 2e4), this.maxDistance * 2);
cam.maxZ = Math.max(far, cam.minZ * 100);
```

`nearFactor=0.01` 相对实际离地高度有 100× 安全余量，消除原注释担心的"动态 near 一帧延迟、快速缩放裁地面"。近裁 6km 高时由 1→60m，深度精度由 ~2.1m/步 → ~3.6cm/步。无需改 shader。

### Step 5 — 兜底（仅当 Step 4 仍不够）：对数深度

若高空 z-fighting 仍明显：给瓦片材质开 `material.useLogarithmicDepth = true`（`TileMaterial.createTileMaterial/createPBRMaterial` 加选项；插件 StandardMaterial loader 同样处理），**且必须同步手改所有写深度的自定义 ShaderMaterial** 注入对数深度（vertex 改 `gl_Position.z`、fragment 写 `gl_FragDepthEXT`）：`TileFilterMaterial.ts`、`ElevationShader.ts`、`TileMateriaNormalLoader.ts`、`EarthMaskMaterial.ts`、demo 内联 FakeEarth shader。`Filter1.ts` 是后处理无需改。成本最高，最后手段。

---

## 验证

两个 demo 已暴露调试全局 `window.__scene/__map/__camera/__controls`；**主用 demo-plugin**（合成 DEM、可离线，不依赖 GDSource/Mars3D 外网）：

1. **LWR 生效**：`__map.rootTile.getWorldMatrix().m.constructor.name` === `"Float64Array"`；`__scene.floatingOriginOffset` 约等于 `__camera.globalPosition`。
2. **CPU 精度**：同一相机姿态对比前后；`radius≈1e7` 环绕 + 平移，瓦片边缘不闪、远距离子瓦片不 shimmer。
3. **GPU 接缝（新增重点）**：`flyTo` 到远处大坐标（如 103.4/34.8 附近）、**贴近地面高倍缩放**，确认相邻瓦片边缘无错位/裂缝——这是 floating origin 的直接价值点。
4. **深度精度**：缩放时读 `__camera.minZ` 应随相机高度变化；~100km 高度掠射角看远处地形无跨 LOD z-fighting；快速滚轮放大回归确认地面不被动态 near 裁掉。
5. **输入模式回归（新增）**：验证 MAP 左键平移/右键旋转、ORBIT 相反、滚轮缩放、惯性手感与 7.x 一致。
6. **自定义 shader + 偏移**：demo-plugin 切 影像/线框/调试/法线/高程/Logo/GeoJSON 各视图 + 开关 Filter1，全部正常（验证浮点原点对 `ShaderMaterial` uniform 自动偏移）。
7. **拾取/贴地回归**：`getLocalInfoFromScreen` 点选、`GroundGroup` GLB 贴地，拾取精度与贴地正确。
8. **性能**：FPS 无回退（`useHighPrecisionMatrix` 官方测过不更慢）。

## 风险与对策

| 风险 | 对策 |
|---|---|
| 9.x `movement.input` 在早期 9.x 不存在（9.0 后加入） | `^9.21.2` 已含；代码 `?.` 守卫 + 旧 `_panningMouseButton` 兜底 |
| `setInteraction` 覆盖默认映射后 wheel/keyboard 绑定受扰 | 先 `resetInputMap()` 再覆盖 pointer；运行时逐项核对 |
| 9.x 对本项目其余 API 有隐性破坏 | 升级后 typecheck/build/启动逐条收敛；`TransformNode.computeWorldMatrix` 覆写签名重点核对 |
| 浮点原点对某自定义 ShaderMaterial uniform 名不生效 | 全部自定义 shader 用标准名；按验证 6 核对，必要时手动偏移 |
| 动态 near 快速缩放裁地 | `nearFactor=0.01` 安全余量 + 可配置 |
| 对数深度在自定义与内置材质间不一致 | 仅 Step 4 不足时启用，同一提交内改齐所有写深度 shader |
| `@babylonjs/gui` 声明但未用 | 一并升或删除 |

## 关键文件

- `packages/lib/src/controls/TileMapControls.ts`（Step 2、4）
- `packages/demo/src/main.ts`（Step 3；内联 FakeEarth shader 在 Step 5 兜底时改）
- `packages/demo-plugin/src/main.ts`（Step 3）
- 4 个 `packages/*/package.json`（Step 1）
- `packages/lib/src/tile/Tile.ts`（仅验证，无需改）
- 兜底时：`packages/lib/src/material/TileMaterial.ts` + 5 个自定义 shader（见 Step 5）
