import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
	plugins: [
		dts({
			outDir: ['./dist'],
			rollupTypes: true,
		}),
	],
	build: {
		target: 'es2020',
		outDir: './dist',
		lib: {
			entry: './src/index.ts',
			name: 'BabylonTilePlugin',
			fileName: 'index',
		},
		rollupOptions: {
			external: [/^@babylonjs\//, /^@babylon-tile\//, 'geojson-vt', 'utif'],
			output: {},
		},
		// sourcemap: true,
	},
});
