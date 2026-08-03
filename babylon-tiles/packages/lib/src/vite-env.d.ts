/// <reference types="vite/client" />

// lerc-wasm.wasm?url：vite 构建时把 wasm 拷贝到产物目录并返回其 URL，
// 供 lerc 解码器的 load({ locateFile }) 定位（避免依赖运行时自动探测失败）。
declare module '*.wasm?url' {
	const url: string;
	export default url;
}
