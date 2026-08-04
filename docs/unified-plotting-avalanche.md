# 修复 Mars3D 地形起伏失真 + 三源旋转接缝闪烁

## Context

用户报告两个问题（已通过 CDP 实测定位根因）：

1. **Mars3D quantized-mesh 地形起伏不符合真实地形**。根因：`QuantizedMeshLoader.ts` 的 **high-water-mark 索引解码算法完全错误**（用 `code===highest / code<highest / code>highest` 三分支把 raw code 当索引，实际 raw code 是 `highest - index` 的差）。错误 TIN → 本地 DEM 插值大量未命中 → **~400/1168 顶点 y=0 空洞**（实测 A 瓦片 nZero=407），demMax 不足（应为 1909m 山区）。正确解码验证：cov 43.4%→100%、interpolate 命中 38.8%→98.5%、demMax=1909.8m、zeroRef=0/900。

2. **Mapbox/ArcGIS（及 Mars3D）鼠标右键旋转时瓦片拼接处不断闪烁**。两个叠加根因：
   - **裙边共面 z-fight（主因，所有源通用）**：每个瓦片四边都加 100m 裙边（`_addMartiniSkirts`）。相邻瓦片 A 右裙边（x=+0.5）与 B 左裙边（x=-0.5）在世界坐标**同一平面**，表面高程一致时**完全共面重叠** → 旋转掠射角深度精度下降 → 交替渲染闪烁。实测 z=14 瓦片约一半顶点是水平法线裙边。
   - **Martini 边界简化不对称 → 共享边台阶**：相邻瓦片独立 RTIN 简化，边界顶点集不同（实测 A 右边界 47 顶点 vs B 左边界 19 顶点，标准模式 A 边界 8 点 vs B 28 点），共享边一侧真实采样、另一侧线性内插 → 台阶（≤maxError=75m）。加上空洞悬崖（1157m，Mars3D 特有），掠射角可见裂缝边缘抖动。

**目标**：修复索引解码（问题 1）→ Mars3D 地形正确无空洞；Martini 边界满分辨率 + 裙边只加数据边界（问题 2）→ 共享边无缝、无共面裙边 → 旋转不再闪烁。

**CDP 验证阶段新发现（问题 3）**：修复 1/2/3 后 Mars3D 地形虽有真实几何高度（maxY 1376-1898m、无空洞），但**渲染无起伏明暗**（看起来平坦）。根因不是 worldScale——实测法线 buffer `ny≈0.001` 恰是 `_computeTerrainNormals` 倾斜局部法线的设计值（`ny≈Wy/S≈0.61/2446`），证明 worldScale=2446 正确生效。真正 bug 是 `Tile.computeWorldMatrix` 手动拼接分支跳过 `super`，导致 Babylon 的 `_nonUniformScaling` 状态传播从不执行 → 瓦片 `_nonUniformScaling` 恒 false → 地形 mesh 的 `NONUNIFORMSCALING` define 关闭 → 着色器用 `mat3(finalWorld)` 而非 inverse-transpose 变换倾斜局部法线 → 法线被非均匀缩放 `diag(S,1,S)` 压成水平 → 无坡度明暗。见「修复 4」。

**固定约束**：只改 `babylon-tiles/` 下源码；main.ts 真实 Mapbox token 绝不回退；中文回复。

---

## 修复 1：QuantizedMeshLoader 索引解码（问题 1）

`packages/lib/src/loader/QuantizedMeshLoader.ts` L148-156：

```js
// 错误算法（raw code 被当成索引）
if (code === highest) { indices[i] = highest; highest++; }
else if (code < highest) { indices[i] = code; }
else { indices[i] = code - 1; highest++; }
```
改为 Cesium 规范（`CesiumTerrainProvider.js` `decompressIndices_`）：
```js
// high-water-mark 解码：raw code = highest - index
indices[i] = highest - code;
if (code === 0) highest++;
```

只此一处。`decode` 顶点/zig-zag、`interpolate`、`buildBuckets` 均正确不改。

---

## 修复 2：Martini 边界满分辨率（共享边无缝）

`packages/lib/src/geometry/Martini.ts` `getGeometryData` 的 `countElements`（L199）与 `processTriangle`（L230）细分条件：

```js
// 原：if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * size + mx] > maxError)
// 改：接触边界线的三角形强制细分（不通过 errors 传播，避免全瓦片细分）
const tileSize = size - 1;
const touchesBoundary =
  ax === 0 || bx === 0 || cx === 0 || ax === tileSize || bx === tileSize || cx === tileSize ||
  ay === 0 || by === 0 || cy === 0 || ay === tileSize || by === tileSize || cy === tileSize;
if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && (touchesBoundary || errors[my * size + mx] > maxError))
```

两处（`countElements` + `processTriangle`，保持一致性）。

**效果（已用 Node 复刻验证）**：65×65 相邻瓦片边界顶点从不对称（8 vs 28）→ 双方满分辨率 256 个，物理重合、高程一致（共享边 DEM 同一插值）→ **无台阶**。

**性能代价**：边界带满分辨率。65×65 DEM +600 顶点/瓦片（1100→1700，可接受）；257×257（terrain-rgb）+3000。若验证阶段 257 超预算，给 Martini `getGeometryData` 加可选 `forceBoundary: boolean`（默认 false），仅 quantized-mesh（65×65）路径开启——实现时先全局开启，验证决定。

---

## 修复 3：裙边只加数据边界（消除共面 z-fight 闪烁）

**`packages/lib/src/geometry/TileGeometry.ts`**：
- `createMartiniTile` 增加 `skirtEdges?: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean }`（默认 undefined = 当前四边全加，兼容其他调用）。
- `_addMartiniSkirts(vertexData, gridSize, skirtHeight, skirtEdges?)`：`addEdge(bottomEdge...)` 等四行按 `skirtEdges` 过滤。内部瓦片（全 false）不生成裙边。
- 新增 helper `getBoundarySkirtEdges(x, y, z)`：返回 `{ top: y===0, bottom: y===maxCoord, left: x===0, right: x===maxCoord }`，`maxCoord = (1<<z)-1`。y 约定 = slippy y=0 北（memory：y=0 north, Z+ north, DEM row 0 north）。实现时用影像 UV 对照确认映射。

**`packages/lib/src/loader/TileLoader.ts`** 三处调用传 `skirtEdges`：
- terrain-rgb 分支（L527 `createMartiniTile`）→ `getBoundarySkirtEdges(coords.x, coords.y, coords.z)`。
- quantized-mesh 分支（L789 `createMartiniTile`）→ 同上。
- lerc 分支（L651 `LercTerrainLoader.createTerrainMesh`）→ 新增 `x, y` 参数透传（内部 `createMartiniTile` 传 `skirtEdges`）；瓦片名 `lerc-terrain-z${z}` 补 x/y 避免同名 mesh 冲突（`lerc-terrain-z${z}-${x}-${y}`）。

**效果**：内部共享边无裙边 → 无共面重叠 → 旋转掠射角不再 z-fight 闪烁。数据边界（全球地图外缘）仍保留裙边遮盖侧面。

---

## 修复 4：Tile.computeWorldMatrix 补 `_nonUniformScaling` 状态传播（问题 3，地形无起伏明暗）

**现象与证据链**（已用 CDP + node 复刻确认）：
- 实测 z=14 瓦片法线 buffer `ny≈0.001` 用真实三角形复刻 `_computeTerrainNormals`：worldScale=2446 时中间世界法线 `Wy=0.61`，但**存入 buffer 的局部法线** `L = normalize(S·Wx, Wy, S·Wz)` 的 `ny ≈ Wy/|L| ≈ 0.61/2446 ≈ 2.5e-4` —— 与实测同量级。**这证明 worldScale=2446 正确生效**（之前误判为 worldScale=1 是复现时打印了中间结果而非最终存储）。
- 着色器 `default.vertex.js` 只有 `#ifdef NONUNIFORMSCALING` 才用 `inverse-transpose` 变换法线；否则用 `mat3(finalWorld)`。对非均匀 `diag(S,1,S)` 世界矩阵，后者把倾斜局部法线 X/Z 放大 S 倍 → 归一化后压成水平 → 无坡度明暗。
- `defines["NONUNIFORMSCALING"] = mesh.nonUniformScaling`（materialHelper.functions.js:420），只读 mesh 布尔，不检查世界矩阵。
- `Tile.computeWorldMatrix`（`packages/lib/src/tile/Tile.ts` L142-183）：z≥1 子瓦片（`parent instanceof Tile`）走**手动矩阵拼接分支**，从不调 `super.computeWorldMatrix` → Babylon `transformNode.js` L1099-1114 的传播逻辑（scaling 非均匀→true / 继承父节点）从不执行 → 子瓦片 `_nonUniformScaling` 恒为初始 false → 地形 mesh（child of Tile，自身 scaling=(1,1,1)）继承 false → define 关闭。

**修复**（`packages/lib/src/tile/Tile.ts` `computeWorldMatrix` 手动分支，`localMatrix.multiplyToRef(parentWorld, this._worldMatrix)` 之后、`return` 之前）：

```ts
// 手动拼接分支跳过 super.computeWorldMatrix，Babylon transformNode.js 里的
// _nonUniformScaling 传播（scaling 非均匀 → true / 继承父节点）不执行。
// 瓦片缩放恒非均匀（root (mapWidth,1,mapHeight)、子 (0.5,1,0.5)），世界矩阵恒
// diag(Sx,1,Sz)。若不同步，子瓦片 _nonUniformScaling 恒 false → 地形子 mesh 的
// NONUNIFORMSCALING define 关闭 → 着色器用 mat3(finalWorld) 而非 inverse-transpose
// 变换倾斜局部空间法线 → 法线被压成水平 → 地形无起伏明暗（看起来平坦）。
if (!this.ignoreNonUniformScaling) {
    const parentNUS = this.parent ? (this.parent as TransformNode).nonUniformScaling : false;
    this._updateNonUniformScalingState(
        this.scaling.isNonUniformWithinEpsilon(0.000001) || parentNUS
    );
}
```

需在 Tile.ts import `TransformNode`（`@babylonjs/core/TransformNode/transformNode`）。三个 API 均可用：`_updateNonUniformScalingState`（public 方法）、`nonUniformScaling`（public getter）、`isNonUniformWithinEpsilon`（public）。若 cast 顾虑，`(this.parent as any).nonUniformScaling` 亦可。

**效果**：修复后瓦片 `_nonUniformScaling=true` → 地形 mesh 下一帧 super computeWorldMatrix 继承 true → `NONUNIFORMSCALING` define 打开 → shader inverse-transpose 恢复法线 → 地形出现真实坡度明暗。平瓦片/overlay 法线 (0,1,0) 经 inverse-transpose 不变，不受影响。

---

## 涉及文件

- 改：`packages/lib/src/loader/QuantizedMeshLoader.ts`（修复 1）
- 改：`packages/lib/src/geometry/Martini.ts`（修复 2）
- 改：`packages/lib/src/geometry/TileGeometry.ts`（修复 3：`createMartiniTile`/`_addMartiniSkirts` 签名 + `getBoundarySkirtEdges`）
- 改：`packages/lib/src/loader/TileLoader.ts`（修复 3：三处调用传 `skirtEdges`）
- 改：`packages/lib/src/loader/LercTerrainLoader.ts`（修复 3：`createTerrainMesh` 加 x/y 透传）
- 改：`packages/lib/src/tile/Tile.ts`（修复 4：`computeWorldMatrix` 手动分支补 `_nonUniformScaling` 状态同步 + import `TransformNode`）

不改 main.ts（token 保留）；不改 tools/ 诊断脚本（`tmp_node_qm_verify.mjs` 的复刻解码在修复后应同步更新其复刻逻辑以便对比，但非必须）。

---

## 验证

1. **构建**：`packages/lib` `npx tsc --noEmit` + `npx vite build`，demo 重建（`npm run dev` 自动 reload）。
2. **修复 1（Mars3D 起伏）**：CDP 探针（复用 `tools/tmp_verify_mars3d_proxy.mjs` + 顶点分布脚本）：
   - 瓦片 `nZero`（y≈0 顶点）从 ~400 大幅下降；`demMax` 接近 1900m（山区）。
   - 相邻瓦片共享边用**三角形面插值**测量 `maxDy`（从 1157m → <1m）。
3. **修复 2（无缝）**：共享边两侧边界顶点数一致（满分辨率），`maxDy`≈0；顶点预算 65×65 ≤1700/瓦片，全场景 ≤40 万（257 若超预算按上文开关决策）。
4. **修复 3（去闪烁）**：CDP 旋转相机（修改 `scene.activeCamera` 的 alpha/beta）对比修复前后——共享边裙边不再共面，旋转无 z-fight 闪烁；数据边界仍有裙边。
5. **修复 4（地形明暗）**：CDP 探针在 z=14 地形 mesh 上：
   - **A（决定性）**：`mesh.nonUniformScaling` 修复后应 `true`（修复前 false）；`mesh.parent._nonUniformScaling` true；`mesh.parent.scaling.asArray()` 非均匀（[0.5,1,0.5]）。
   - **B（buffer 正确性）**：读 position/normal buffer，取一陡坡顶点局部法线 L，恢复世界法线 `rec = normalize(Lx/S, Ly, Lz/S)`（S=2446），`rec.ny` 应≈坡度（0.3~0.8）——证明 buffer 正确、问题在 shader 变换。
   - **C（明暗对比）**：修复前后截图对比，地形应从「无明暗的平坦」→「有坡度明暗」；平瓦片/overlay 渲染不变。
6. **三源回归**：临时切换 main.ts demSource（Mapbox terrain-rgb / ArcGIS lerc / Mars3D qm），CDP 截图 + 法线探针（downPct≈0）+ 旋转交互确认三源均无闪烁、无裂缝、地形有起伏明暗且法线朝上。验证后恢复 main.ts（Mars3D，token 保留）。
7. 提交变更。
