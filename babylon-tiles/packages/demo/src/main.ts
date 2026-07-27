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

import { TileMap, ArcGisSource } from '@babylon-tile/lib';

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true);

const createScene = async (): Promise<Scene> => {
	const scene = new Scene(engine);
	scene.clearColor = new Color4(0.1, 0.1, 0.15, 1.0);

	// 地图采用 Web Mercator 投影，整体尺寸约 4e7 单位（地球周长量级）。
	// 相机半径必须与之匹配：three-tile 默认从 ~2.8e7 高度俯视整张地图。
	// radius 过小（如 1000）相当于在 4e7 单位的地图上放大到单个纹素，
	// 而 (lon0=0, lat0=0) 落在海面，纹素近乎纯黑，看起来一片空白。
	const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 2.8e7, Vector3.Zero(), scene);
	camera.attachControl(canvas, true);
	camera.wheelDeltaPercentage = 0.05; // 按比例缩放，适配大尺度地图（绝对 wheelPrecision 在千万级半径下无效）
	camera.lowerRadiusLimit = 10;
	camera.upperRadiusLimit = 1e8; // 允许缩放到可见整张地图
	camera.upperBetaLimit = Math.PI / 2;
	camera.minZ = 1;
	camera.maxZ = 100000000;
	// 地图平铺在 X-Z 平面（Y 为海拔高度）。右键平移只应在水平面内移动相机目标，
	// 不能沿 Y 抬升/压低目标，否则地图会“飘”离地面。
	camera.panningAxis = new Vector3(1, 0, 1);

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
		// ArcRotateCamera 的平移量 = 像素位移 / panningSensibility（世界单位，与相机半径无关）。
		// 在 4e7 量级的地图上，默认值（50）一次拖拽只移动几个单位，肉眼几乎看不出，
		// 表现为“右键拖不动地图”。让灵敏度随半径变化，使拖拽手感在各缩放级别下都近似 1:1。
		camera.panningSensibility = 1000 / camera.radius;
	});

	window.addEventListener('resize', () => {
		engine.resize();
	});

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
