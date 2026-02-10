/**
 * Babylon.js Tile Map Demo
 * 演示如何使用 babylon-tile 库
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import '@babylonjs/loaders/glTF';

import { TileMap, ArcGisSource } from '@babylon-tile/lib';

// 创建引擎
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true);

// 创建场景
const createScene = async (): Promise<Scene> => {
	const scene = new Scene(engine);
	scene.clearColor = new Color4(0.1, 0.1, 0.15, 1.0);

	// 创建相机
	const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 1000, Vector3.Zero(), scene);
	camera.attachControl(canvas, true);
	camera.wheelPrecision = 50;
	camera.lowerRadiusLimit = 10;
	camera.upperRadiusLimit = 10000000;
	camera.upperBetaLimit = Math.PI / 2;

	// 创建光源
	const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
	light.intensity = 1;

	// 创建地图
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

	// 监听地图事件
	map.addObservable('ready', () => {
		console.log('Map ready!!!!!!');
	});

	map.addObservable('tile-loaded', ({ tile }) => {
		console.log(`Tile loaded: ${tile.x}, ${tile.y}, ${tile.z}`);
	});

	// 在渲染循环中更新地图
	scene.registerBeforeRender(() => {
		map.update(camera);
	});

	// 监听窗口大小变化
	window.addEventListener('resize', () => {
		engine.resize();
	});

	return scene;
};

// 创建并运行场景
createScene().then(scene => {
	// 渲染循环
	engine.runRenderLoop(() => {
		scene.render();

		// 更新统计信息
		updateStats(scene);
	});

	// 初始化事件监听
	initEventListeners(scene);
});

/**
 * 更新统计信息
 */
function updateStats(scene: Scene) {
	const fps = engine.getFps().toFixed();
	const fpsEl = document.getElementById('fps');
	if (fpsEl) {
		fpsEl.textContent = fps;
	}
}

/**
 * 初始化事件监听
 */
function initEventListeners(scene: Scene) {
	const canvas = scene.getEngine().getRenderingCanvas();
	if (!canvas) return;

	// 鼠标移动事件
	canvas.addEventListener('mousemove', evt => {
		// 这里可以添加鼠标位置拾取逻辑
	});
}

// 显示加载状态
const loadingEl = document.getElementById('loading');
if (loadingEl) {
	loadingEl.style.display = 'block';
	setTimeout(() => {
		loadingEl.style.display = 'none';
	}, 1000);
}

console.log('Babylon.js Tile Map Demo Started');
console.log('Version: 1.0.0');
