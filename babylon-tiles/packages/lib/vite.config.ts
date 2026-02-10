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
			external: ['@babylonjs/core', '@babylonjs/loaders'],
			output: {
				globals: {
					'@babylonjs/core': 'BABYLON',
					'@babylonjs/loaders': 'BABYLON'
				}
			}
		}
	}
});
