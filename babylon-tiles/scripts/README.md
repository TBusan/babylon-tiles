# scripts/

开发辅助脚本（从 `tools/` 收编的可复用工具；一次性 CDP 诊断脚本已删除）。

| 脚本                  | 用途                                                                                              | 用法                                            |
| --------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `mock_dem_server.mjs` | 本地 Mock Mapbox Terrain-RGB DEM 服务（无需 token），高斯山体位于 104E 35N，Web Mercator 瓦片坐标 | `node scripts/mock_dem_server.mjs`（端口 9009） |
| `gen_glb.mjs`         | 重新生成 `packages/demo/public/demo_model.glb`（最小合法 glTF 2.0 二进制，供 demo 的 GLB 示例）   | `node scripts/gen_glb.mjs`                      |
| `pnggrid.mjs`         | 从 PNG 采样网格区域并打印平均颜色（诊断截图用）                                                   | `node scripts/pnggrid.mjs <file> [rows] [cols]` |
