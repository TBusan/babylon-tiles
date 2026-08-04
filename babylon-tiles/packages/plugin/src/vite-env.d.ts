/**
 * 模块声明：Vite `?raw` 导入（compass.txt 内联 HTML/SVG）
 */
declare module '*?raw' {
	const src: string;
	export default src;
}
