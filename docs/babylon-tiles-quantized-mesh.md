---
name: babylon-tiles-quantized-mesh
description: quantized-mesh (Cesium) 格式与服务变体：Mars3D 小端 + edge indices u16 + 2×2 根瓦片；edge-skip 必须按 idxSize 跳（曾越界 RangeError）
metadata: 
  node_type: memory
  type: project
  originSessionId: 8006b01f-2ac0-4a90-8835-44bef711382b
  modified: 2026-08-03T10:26:52.505Z
---

Cesium quantized-mesh 接入（Mars3D data1.mars3d.cn）已验证真实渲染。关键格式事实：

- **Header 88B**：Center(3×f64 ECEF，不用) + MinH/MaxH(2×f32 @24) + BoundingSphere(4×f64) + HorizonOcclusionPoint(3×f64)。vertexCount @88 (u32)。
- **顶点**：u/v/height 各 vc 个 u16，**zig-zag 增量解码**后 clamp 到 [0,32767]，经度/纬度/高度按 [west,south,east,north] 边界线性插值。
- **索引**：high-water-mark 解码，vc>65536 用 u32 否则 u16（`idxSize`）。
- **EdgeIndices 宽度 = 三角形索引宽度**（按 idxSize，不是固定 u32）。**Mars3D 输出 u16**。decode 的 edge-skip 若固定 `count*4`（u32）会在读下一段 count 时错位产生垃圾值 → `offset += 4+garbage*4` 越界 → `RangeError: Offset is outside the bounds of the DataView`。必须 `offset += 4 + count * idxSize`。（2026-08-03 修复，曾致 Mars3D 所有地形瓦片 decode 崩溃，Node 复刻 decode 因没有 edge-skip 循环而"成功"，掩盖了问题。）
- **Mars3D 服务变体**：little-endian（`littleEndian:true`）、EPSG:4326+TMS、`numberOfLevelZeroTilesX/Y=2`（n_x=n_y=2^(z+1)）、防盗链校验 Referer/Origin=studio.mars3d.cn → 只能经 vite proxy 改写。Accept 头需含 `application/vnd.quantized-mesh;extensions=octvertexnormals`。
- **层级映射**：service zz = z - log2(rootX) = z-1（rootX=2）。
- 本加载器**不解析 Extensions**（octvertexnormals 等），法线由本地 `_computeTerrainNormals` 重算。

相关：[[babylon-tiles-map-projection-from-source]]（瓦片坐标/经度网格对齐）、[[babylon-tiles-terrain-normals]]
