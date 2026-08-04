import { defineConfig } from 'vite';

export default defineConfig({
	server: {
		port: 3001,
		open: true,
		proxy: {
			// Mars3D 地形防盗链：校验 Referer/Origin 为 studio.mars3d.cn。
			// 浏览器 fetch 无法设置 Referer（forbidden header），故由 dev server
			// 代理并改写上游请求头。生产部署需在网关/CDN 层做同样改写。
			'/terrain': {
				target: 'https://data1.mars3d.cn',
				changeOrigin: true,
				headers: {
					Referer: 'http://studio.mars3d.cn/',
					Origin: 'http://studio.mars3d.cn',
				},
			},
		},
	},
	build: {
		outDir: 'dist',
		sourcemap: true,
	},
});
