/**
 * Babylon.js Tile Map Demo
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import '@babylonjs/loaders/glTF';

import { TileMap, ArcGisSource, Tile } from '@babylon-tile/lib';

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true);

const createScene = async (): Promise<Scene> => {
	const scene = new Scene(engine);
	scene.clearColor = new Color4(0.1, 0.1, 0.15, 1.0);

	const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 1000, Vector3.Zero(), scene);
	camera.attachControl(canvas, true);
	camera.wheelPrecision = 50;
	camera.lowerRadiusLimit = 10;
	camera.upperRadiusLimit = 10000000;
	camera.upperBetaLimit = Math.PI / 2;
	camera.minZ = 1;
	camera.maxZ = 100000000;

	const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
	light.intensity = 1;

	const map = TileMap.create({
		scene,
		imgSource: [
			new ArcGisSource({
				style: 'World_Imagery',
				minLevel: 2,
				maxLevel: 18,
			}),
		],
		minLevel: 2,
		maxLevel: 18,
		lon0: 0,
		debug: 1,
	});

	map.addObservable('ready', () => {
		console.log('Map ready!!!!!!');
	});

	map.addObservable('tile-loaded', ({ tile }) => {
		console.log(`Tile loaded: ${tile.x}, ${tile.y}, ${tile.z}`);
	});

	// Expose for debugging
	(window as any).__scene = scene;
	(window as any).__map = map;

	// 在渲染循环中更新地图
	scene.registerBeforeRender(() => {
		map.update(camera);
	});

	window.addEventListener('resize', () => {
		engine.resize();
	});

	// ---- 增强诊断日志：每3秒输出 ----
	let lastLogTime1 = 0;
	scene.registerBeforeRender(() => {
		const now = performance.now();
		if (now - lastLogTime1 >= 3000) {
			const stats = map.getTileCount();
			const meshes = scene.meshes.filter(m => m.material);
			const textured = meshes.filter(m => {
				const mat = m.material as any;
				return mat && (mat.diffuseTexture || mat.albedoTexture);
			});
			// 统计所有 showing 的瓦片（含非叶子）
			let allVisible = 0;
			const visitTile = (t: any) => {
				if (t.showing) allVisible++;
				if (t.subTiles) t.subTiles.forEach((c: any) => visitTile(c));
			};
			visitTile(map.rootTile);
			// 找第一个 showing 且有 model 的瓦片
			let firstShowing: any = null;
			const findFirst = (t: any) => {
				if (firstShowing) return;
				if (t.showing && t._model) {
					firstShowing = t;
					return;
				}
				if (t.subTiles) t.subTiles.forEach((c: any) => findFirst(c));
			};
			findFirst(map.rootTile);
			const tileInfo = firstShowing
				? `firstShow: z${firstShowing.z}(${firstShowing.x},${firstShowing.y}) ` +
				  `pos=(${firstShowing.position.x.toFixed(1)},${firstShowing.position.y.toFixed(1)},${firstShowing.position.z.toFixed(1)}) ` +
				  `scl=(${firstShowing.scaling.x.toFixed(2)},${firstShowing.scaling.y.toFixed(2)},${firstShowing.scaling.z.toFixed(2)}) ` +
				  `mesh.enabled=${firstShowing._model?.isEnabled()} ` +
				  `mesh.pos=(${firstShowing._model?.position.x.toFixed(3)},${firstShowing._model?.position.y.toFixed(3)},${firstShowing._model?.position.z.toFixed(3)}) ` +
				  `mat=${firstShowing._model?.material?.name || 'none'}`
				: 'firstShow: NONE';
			console.log(
				`[TileMap] total=${stats.total} leaf=${stats.leaf} ` +
				`visible(leaf)=${stats.visible} visible(all)=${allVisible} ` +
				`inFrust=${stats.inFrustum} maxLv=${stats.maxLevel} dl=${stats.downloading} | ` +
				`meshes=${meshes.length} tex=${textured.length} FPS=${engine.getFps().toFixed()}`
			);
			console.log(`  ${tileInfo}`);
			lastLogTime1 = now;
		}
	});

	// ---- 3秒后强制所有瓦片可见（调试用） ----
	setTimeout(() => {
		console.log('>>> Enabling Tile.forceVisible = true');
		Tile.forceVisible = true;
	}, 3000);

	return scene;
};

createScene().then(scene => {
	engine.runRenderLoop(() => {
		scene.render();
		updateStats();
	});
	initEventListeners(scene);
});

function updateStats() {
	const fpsEl = document.getElementById('fps');
	if (fpsEl) {
		fpsEl.textContent = engine.getFps().toFixed();
	}
}

function initEventListeners(scene: Scene) {
	const canvas = scene.getEngine().getRenderingCanvas();
	if (!canvas) return;
	canvas.addEventListener('mousemove', _evt => {
		// 鼠标位置拾取逻辑
	});
}

const loadingEl = document.getElementById('loading');
if (loadingEl) {
	loadingEl.style.display = 'block';
	setTimeout(() => {
		loadingEl.style.display = 'none';
	}, 1000);
}

console.log('Babylon.js Tile Map Demo Started');
console.log('Version: 1.0.0');
