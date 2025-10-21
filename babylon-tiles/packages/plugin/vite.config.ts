import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'BabylonTilePlugin',
      formats: ['es', 'umd'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'umd.cjs'}`,
    },
    rollupOptions: {
      external: ['@babylonjs/core', 'babylon-tile'],
      output: {
        globals: {
          '@babylonjs/core': 'BABYLON',
          'babylon-tile': 'BabylonTile',
        },
      },
    },
  },
});

