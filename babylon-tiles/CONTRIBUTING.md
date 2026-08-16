# 贡献指南

感谢你愿意为 babylon-tiles 贡献代码！请遵循以下约定，保证仓库整洁、可维护。

## 环境

- Node.js ≥ 20
- pnpm ≥ 9（仓库使用 pnpm workspace）

```bash
pnpm install
pnpm build       # 构建全部 packages
pnpm dev         # 启动 demo（Vite dev server）
```

## 提交前检查

提交前必须通过：

```bash
pnpm typecheck   # tsc --noEmit 全包严格类型检查
pnpm lint        # ESLint（0 error）
pnpm format      # Prettier 格式化
pnpm build       # 构建通过
```

CI 会并行运行 `lint → typecheck → build`，任一失败即红灯。

## 代码约定

- **TypeScript `strict` 全开**：新代码不得引入隐式 `any`、未使用变量、`@ts-ignore`。
- **现有 `no-explicit-any` 警告**：逐处收敛中，新代码避免再引入。
- **缩进**：tab；引号：单引号；行尾：随文件（Prettier `endOfLine: auto`）。统一交给 Prettier，不要手工调格式。
- **导入路径**：同包内相对导入带 `.js` 后缀（ESM 兼容），跨包走 `@babylon-tile/*`。
- **注释语言**：中文注释为主（与现有代码一致），关键算法附坐标系/投影约定说明。

## 架构红线

- **禁止新增模块级可变共享状态**（如模块级 `cameraWorldPosition`、全局单例）。多地图共享状态必须挂在 `TileMapContext`（每地图实例）或按 Engine/Scene 作用域隔离。
- **材质/纹理生命周期**：统一走 `TileLoader` 的引用计数（`acquire/release`）与 `releaseMesh`，不得在 Tile 内联释放共享资源。
- **Worker 代码**：必须是真实 `.ts` 文件（Vite 构建时打包），不得手写内联字符串。

## 分支与提交

- 每个 Phase / 独立修复开独立分支，提交信息用 `feat:` / `fix:` / `refactor:` / `chore:` / `docs:` 前缀。
- 涉及行为变更（视觉、数值、公共 API）时，附 Playwright 截图 diff 或说明验证方式。

## 数据源与安全

- demo 中的 Mapbox token 为仓库内提交的演示凭证（标注「不可回退」），**不要移除**。
- Mars3D 防盗链代理（`demo/vite.config.ts` 伪造 Referer/Origin）仅用于本地/CI 演示，不应用于生产。

## 测试

- 纯逻辑（投影、LOD、Martini、纹理缓存、Frustum）写 Vitest 单测（Node 环境）。
- 渲染/多地图回归用 Playwright E2E（真实在线源，走 demo 代理）。
