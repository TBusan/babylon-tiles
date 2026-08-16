# Changelog

本仓库使用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格。版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 工程基线：ESLint（flat config + typescript-eslint）、Prettier、`pnpm lint` / `pnpm format` / `pnpm typecheck`
- lib / plugin 全面开启 TypeScript `strict`
- `LICENSE`（MIT）、`CONTRIBUTING.md`、`CHANGELOG.md`

### Changed

- lib `TileMap` `source-changed` 事件类型扩展为含 `undefined`（`demSource` 可空）
- plugin `SingleTifDEMLoader` 改用 `IFD.width/height` 读取 TIFF 尺寸（替代 `t256/t257` 索引）
- `pnpm build` 根脚本改为 `pnpm -r build`（修复原 filter 语法失效）

### Fixed

- `GroundGroup` / `utils.ts` 中 `&&` 短路表达式改为显式 `if`
- 清理未使用的导入与死代码（`TILE_UV_BLEED` 副本、`posZ` 等）

### Removed

- 不再跟踪 Vite 临时文件 `*.timestamp-*.mjs`
- 删除 `tools/` 下 100+ 一次性 CDP 诊断脚本与截图；可复用工具（`mock_dem_server.mjs` / `gen_glb.mjs` / `pnggrid.mjs`）迁至 `scripts/` 并附 README
