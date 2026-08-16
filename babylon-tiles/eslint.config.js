/**
 * ESLint flat config（ESLint 9+）
 *
 * 覆盖 monorepo 全部 packages：TypeScript 推荐规则 + Prettier 冲突关闭。
 * 不启用 type-aware 规则（需要 project service，且当前仓库类型层面已由
 * `tsc --noEmit` 兜底），保持 lint 快速、与构建解耦。
 */
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
	{
		ignores: ['**/node_modules/**', '**/dist/**', '**/*.d.ts', 'tools/**', 'scripts/**', 'packages/demo/public/**'],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	prettier,
	{
		rules: {
			// TS 已经处理未使用变量，交给 TS 编译器（tsconfig 控制）
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
			],
			// 显式 any 先用 warning，后续逐处收敛
			'@typescript-eslint/no-explicit-any': 'warn',
			// 空接口/函数先保留现状（大量来自 Babylon 类型体操），后续收敛
			'@typescript-eslint/no-empty-object-type': 'off',
			// 构造函数/方法重载的 this 类规则暂不启用，避免大面积报错
			'@typescript-eslint/ban-types': 'off',
		},
	}
);
