// vite.config.ts
import { defineConfig } from "file:///D:/study/code/webgl/babylon-tiles/babylon-tiles/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.30/node_modules/vite/dist/node/index.js";
import dts from "file:///D:/study/code/webgl/babylon-tiles/babylon-tiles/node_modules/.pnpm/vite-plugin-dts@3.9.1_@type_260c3b2903bd2ab40614a23de7ab1d36/node_modules/vite-plugin-dts/dist/index.mjs";
var vite_config_default = defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true
    })
  ],
  build: {
    lib: {
      entry: "src/index.ts",
      name: "BabylonTile",
      fileName: "index",
      formats: ["es", "umd"]
    },
    rollupOptions: {
      // 将所有 babylonjs 子路径导入也标记为 external，避免打包两份 Babylon.js
      external: (id) => {
        return id.startsWith("@babylonjs/core") || id.startsWith("@babylonjs/loaders");
      },
      output: {
        globals: {
          "@babylonjs/core": "BABYLON",
          "@babylonjs/loaders": "BABYLON"
        }
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxzdHVkeVxcXFxjb2RlXFxcXHdlYmdsXFxcXGJhYnlsb24tdGlsZXNcXFxcYmFieWxvbi10aWxlc1xcXFxwYWNrYWdlc1xcXFxsaWJcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkQ6XFxcXHN0dWR5XFxcXGNvZGVcXFxcd2ViZ2xcXFxcYmFieWxvbi10aWxlc1xcXFxiYWJ5bG9uLXRpbGVzXFxcXHBhY2thZ2VzXFxcXGxpYlxcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRDovc3R1ZHkvY29kZS93ZWJnbC9iYWJ5bG9uLXRpbGVzL2JhYnlsb24tdGlsZXMvcGFja2FnZXMvbGliL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgZHRzIGZyb20gJ3ZpdGUtcGx1Z2luLWR0cyc7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG5cdHBsdWdpbnM6IFtcblx0XHRkdHMoe1xuXHRcdFx0aW5zZXJ0VHlwZXNFbnRyeTogdHJ1ZSxcblx0XHR9KSxcblx0XSxcblx0YnVpbGQ6IHtcblx0XHRsaWI6IHtcblx0XHRcdGVudHJ5OiAnc3JjL2luZGV4LnRzJyxcblx0XHRcdG5hbWU6ICdCYWJ5bG9uVGlsZScsXG5cdFx0XHRmaWxlTmFtZTogJ2luZGV4Jyxcblx0XHRcdGZvcm1hdHM6IFsnZXMnLCAndW1kJ11cblx0XHR9LFxuXHRcdHJvbGx1cE9wdGlvbnM6IHtcblx0XHRcdC8vIFx1NUMwNlx1NjI0MFx1NjcwOSBiYWJ5bG9uanMgXHU1QjUwXHU4REVGXHU1Rjg0XHU1QkZDXHU1MTY1XHU0RTVGXHU2ODA3XHU4QkIwXHU0RTNBIGV4dGVybmFsXHVGRjBDXHU5MDdGXHU1MTREXHU2MjUzXHU1MzA1XHU0RTI0XHU0RUZEIEJhYnlsb24uanNcblx0XHRcdGV4dGVybmFsOiAoaWQ6IHN0cmluZykgPT4ge1xuXHRcdFx0XHRyZXR1cm4gaWQuc3RhcnRzV2l0aCgnQGJhYnlsb25qcy9jb3JlJykgfHwgaWQuc3RhcnRzV2l0aCgnQGJhYnlsb25qcy9sb2FkZXJzJyk7XG5cdFx0XHR9LFxuXHRcdFx0b3V0cHV0OiB7XG5cdFx0XHRcdGdsb2JhbHM6IHtcblx0XHRcdFx0XHQnQGJhYnlsb25qcy9jb3JlJzogJ0JBQllMT04nLFxuXHRcdFx0XHRcdCdAYmFieWxvbmpzL2xvYWRlcnMnOiAnQkFCWUxPTidcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblx0fVxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXNYLFNBQVMsb0JBQW9CO0FBQ25aLE9BQU8sU0FBUztBQUVoQixJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMzQixTQUFTO0FBQUEsSUFDUixJQUFJO0FBQUEsTUFDSCxrQkFBa0I7QUFBQSxJQUNuQixDQUFDO0FBQUEsRUFDRjtBQUFBLEVBQ0EsT0FBTztBQUFBLElBQ04sS0FBSztBQUFBLE1BQ0osT0FBTztBQUFBLE1BQ1AsTUFBTTtBQUFBLE1BQ04sVUFBVTtBQUFBLE1BQ1YsU0FBUyxDQUFDLE1BQU0sS0FBSztBQUFBLElBQ3RCO0FBQUEsSUFDQSxlQUFlO0FBQUE7QUFBQSxNQUVkLFVBQVUsQ0FBQyxPQUFlO0FBQ3pCLGVBQU8sR0FBRyxXQUFXLGlCQUFpQixLQUFLLEdBQUcsV0FBVyxvQkFBb0I7QUFBQSxNQUM5RTtBQUFBLE1BQ0EsUUFBUTtBQUFBLFFBQ1AsU0FBUztBQUFBLFVBQ1IsbUJBQW1CO0FBQUEsVUFDbkIsc0JBQXNCO0FBQUEsUUFDdkI7QUFBQSxNQUNEO0FBQUEsSUFDRDtBQUFBLEVBQ0Q7QUFDRCxDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
