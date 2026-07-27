import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
	plugins: [
		dts({
			insertTypesEntry: true,
		}),
	],
	build: {
		lib: {
			entry: 'src/index.ts',
			name: 'BabylonTile',
			fileName: 'index',
			formats: ['es', 'umd']
		},
		rollupOptions: {
			// 将所有 babylonjs 子路径导入也标记为 external，避免打包两份 Babylon.js
			external: (id: string) => {
				return id.startsWith('@babylonjs/core') || id.startsWith('@babylonjs/loaders');
			},
			output: {
				globals: {
					'@babylonjs/core': 'BABYLON',
					'@babylonjs/loaders': 'BABYLON'
				}
			}
		}
	}
});
