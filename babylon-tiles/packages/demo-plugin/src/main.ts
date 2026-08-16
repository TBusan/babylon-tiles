/**
 * @babylon-tile/demo-plugin
 * 插件系统测试 demo：
 * - lib 核心：TileMapControls（相机/交互核心，含 yaw/pitch/roll + minHeight/maxHeight 限高）
 * - 注册插件 loader：wireframe / debug / logo / normal / elevation / geojson / single-tif
 * - 功能插件：createFakeEarth / MapFog / Compass / GroundGroup / Filter1
 * - 视图切换：影像 / 线框 / 调试 / 法线 / 高程 / Logo / GeoJSON
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

import {
	TileMap,
	GDSource,
	TileMapControls,
	registerImgLoader,
	registerDEMLoader,
	getTileLoaders,
} from '@babylon-tile/lib';
import {
	TileMaterialWrieLoader,
	TileMaterialDebugeLoader,
	TileMaterialLogoLoader,
	TileMateriaNormalLoader,
	ElevationLoader,
	GeoJSONSource,
	GeoJSONLoader,
	SingleTifDEMLoader,
	SingleTifDEMSource,
	createFakeEarth,
	MapFog,
	Compass,
	GroundGroup,
	Filter1,
} from '@babylon-tile/plugin';

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true);

// ======================== 常量 ========================
const BACK_COLOR = new Color4(0.859, 0.941, 1.0, 1.0); // 0xdbf0ff 浅天蓝

// 真实 Mapbox token，刻意保留，不可回退（备用 raster-dem 源）
const MAPBOX_TOKEN = 'pk.eyJ1IjoidGJ1c2FuIiwiYSI6ImNtZjY2emZneDBkY24ybXB4cmpvdmwzNWYifQ.h6tcQ380WN5AW6fZr08how';

// 合成 DEM 覆盖范围（经纬度）与相机起始点（104°E 35°N）
const DEM_BOUNDS: [number, number, number, number] = [102, 33, 106, 37];
const CAMERA_TARGET = new Vector3(1558472.87, 0, 4163881.14);

// ======================== 注册插件 loader（进 LoaderFactory，与内置 loader 一视同仁） ========================
registerImgLoader(new TileMaterialWrieLoader());
registerImgLoader(new TileMaterialDebugeLoader());
registerImgLoader(new TileMaterialLogoLoader());
registerImgLoader(new TileMateriaNormalLoader());
registerImgLoader(new ElevationLoader(0, 3000));
registerImgLoader(new GeoJSONLoader());
registerDEMLoader(new SingleTifDEMLoader());

/**
 * 生成合成 DEM 高度场（平滑起伏，行 0 为北）
 * 对齐单 TIF 解析语义：buffer 行优先，row 0 对应最北（maxLat）。
 */
function createSyntheticDEM(
	width = 512,
	height = 512
): {
	buffer: Float32Array;
	width: number;
	height: number;
} {
	const buffer = new Float32Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const nx = x / (width - 1);
			const ny = y / (height - 1);
			let h = 1500;
			h += 500 * Math.sin(nx * Math.PI * 2 * 2.5) * Math.cos(ny * Math.PI * 2 * 1.8);
			h += 250 * Math.sin(nx * Math.PI * 2 * 6 + 1.2) * Math.sin(ny * Math.PI * 2 * 4.3);
			h += 120 * Math.sin(nx * Math.PI * 2 * 13 + 0.7) * Math.cos(ny * Math.PI * 2 * 9.1);
			h += 80 * Math.cos(ny * Math.PI * 2 * 17 + 2.1);
			buffer[y * width + x] = h;
		}
	}
	return { buffer, width, height };
}

/**
 * 从合成 DEM 构造地表高度查询（世界坐标 XZ → 高程）
 * 供 TileMapControls.groundHeightAt 防穿地使用（相机不可低于山体）。
 */
function createGroundHeightAt(
	dem: { buffer: Float32Array; width: number; height: number },
	bounds: [number, number, number, number]
): (x: number, z: number) => number {
	const [minLon, minLat, maxLon, maxLat] = bounds;
	const R = 6378137;
	return (x, z) => {
		// 世界坐标 → 经纬度（Web Mercator，lon0=90）
		const lon = 90 + (x / R) * (180 / Math.PI);
		const lat = (2 * Math.atan(Math.exp(z / R)) - Math.PI / 2) * (180 / Math.PI);
		if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return 0;
		const nx = (lon - minLon) / (maxLon - minLon);
		const ny = (lat - minLat) / (maxLat - minLat);
		const col = Math.min(dem.width - 1, Math.floor(nx * (dem.width - 1)));
		const row = Math.min(dem.height - 1, Math.floor((1 - ny) * (dem.height - 1))); // 行翻转：row 0 为北
		return dem.buffer[row * dem.width + col];
	};
}

const createScene = async (): Promise<Scene> => {
	const scene = new Scene(engine);
	scene.clearColor = BACK_COLOR;

	// ======================== 相机（lib 核心 TileMapControls 接管交互） ========================
	const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 12000, CAMERA_TARGET.clone(), scene);
	camera.fov = (70 * Math.PI) / 180;

	// ======================== 光照 ========================
	const hemiLight = new HemisphericLight('hemiLight', new Vector3(0, 1, 0), scene);
	hemiLight.intensity = 0.8;
	const dirLight = new DirectionalLight('dirLight', new Vector3(0, -1, -0.5), scene);
	dirLight.position = new Vector3(0, 2e3, 1e3);
	dirLight.intensity = 0.6;

	// ======================== 地图（合成 DEM 单 TIF 地形 + 高德影像） ========================
	const dem = createSyntheticDEM(512, 512);
	const map = TileMap.create({
		scene,
		imgSource: new GDSource({ style: 'img', minLevel: 2, maxLevel: 18 }),
		demSource: new SingleTifDEMSource({
			url: 'inline', // 数据内联（loader 不再请求网络），url 需非空
			data: dem,
			minLevel: 2,
			maxLevel: 18,
			bounds: DEM_BOUNDS,
			skirtHeight: 2000,
		}),
		minLevel: 2,
		maxLevel: 18,
		lon0: 90, // 中央经度 90°E（对齐 three-tile demo）
		debug: 1,
	});

	// ======================== lib 核心相机控制器 ========================
	const controls = new TileMapControls(camera);
	controls.minHeight = 0;
	controls.maxHeight = 2e7;
	controls.groundHeightAt = createGroundHeightAt(dem, DEM_BOUNDS); // 防穿地（地形跟随）
	// 每帧驱动地图更新（对齐 demo 的 registerBeforeRender 循环）
	controls.onChange = () => {
		map.update(camera);
	};

	// ======================== 功能插件 ========================
	const fakeEarth = createFakeEarth(scene, map, new Color3(0.1, 0.1, 0.15));
	new MapFog(controls, scene, new Color3(BACK_COLOR.r, BACK_COLOR.g, BACK_COLOR.b));

	const compassHost = document.getElementById('compass');
	if (compassHost) {
		const compass = new Compass(controls);
		compassHost.appendChild(compass.dom);
	}

	const filter = new Filter1({ camera });

	// 贴地模型组：把立方体放到相机目标附近高空，加入组后自动贴地
	const groundGroup = new GroundGroup('ground', map);
	const box = MeshBuilder.CreateBox('box', { size: 300 }, scene);
	const boxMat = new StandardMaterial('boxMat', scene);
	boxMat.diffuseColor = new Color3(1, 0.4, 0.2);
	box.material = boxMat;
	box.position = new Vector3(CAMERA_TARGET.x, 5000, CAMERA_TARGET.z);
	groundGroup.add(box);

	// ======================== 地图事件 ========================
	map.addObservable('ready', () => {
		console.log('Map ready!!!!!!');
	});
	map.addObservable('loading-complete', () => {
		groundGroup.update();
	});

	// ======================== 视图切换 ========================
	/** 构造指定 dataType 的 GD 影像源（GDSource 类字段 dataType 构造后会重置，须构造后赋值） */
	function gdWith(dataType: string): GDSource {
		const gd = new GDSource({ style: 'img', minLevel: 2, maxLevel: 18 });
		gd.dataType = dataType;
		return gd;
	}

	const chinaStyle = {
		minLevel: 2,
		maxLevel: 18,
		color: '#ff5252',
		weight: 2,
		opacity: 0.9,
		fill: true,
		fillColor: '#ff5252',
		fillOpacity: 0.15,
	};

	const VIEWS: Record<string, () => void> = {
		影像: () => {
			map.imgSource = new GDSource({ style: 'img', minLevel: 2, maxLevel: 18 });
		},
		线框: () => {
			map.imgSource = gdWith('wireframe');
		},
		调试: () => {
			map.imgSource = gdWith('debug');
		},
		法线: () => {
			map.imgSource = gdWith('normal');
		},
		高程: () => {
			map.imgSource = gdWith('elevation');
		},
		Logo: () => {
			map.imgSource = gdWith('logo');
		},
		GeoJSON: () => {
			map.imgSource = new GeoJSONSource({ url: '/china.geojson', style: chinaStyle });
		},
	};

	const toolbar = document.getElementById('toolbar');
	toolbar?.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const view = btn.dataset.view!;
			VIEWS[view]?.();
			toolbar.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
			btn.classList.add('active');
		});
	});

	// 滤镜开关
	const filterBtn = document.getElementById('btn-filter');
	filterBtn?.addEventListener('click', () => {
		filter.enable = !filter.enable;
		filterBtn.textContent = filter.enable ? '滤镜 ✓' : '滤镜';
	});

	// ======================== 渲染循环 ========================
	scene.registerBeforeRender(() => {
		// 伪球体远距离可见（对齐 demo 渲染循环）
		const dist = camera.radius;
		const beta = Math.max(camera.beta, 0.01);
		fakeEarth.setEnabled(dist > 5e5 && beta < Math.PI / 2);
	});

	// Expose for debugging / CDP 探针
	(window as any).__scene = scene;
	(window as any).__map = map;
	(window as any).__camera = camera;
	(window as any).__controls = controls;
	(window as any).__filter = filter;
	(window as any).__getTileLoaders = getTileLoaders;
	(window as any).__setView = (name: string) => VIEWS[name]?.();
	(window as any).__MAPBOX_TOKEN = MAPBOX_TOKEN; // 刻意保留的真实 token，供备用 raster-dem 切换
	(window as any).__plugin = {
		TileMaterialWrieLoader,
		TileMaterialDebugeLoader,
		TileMaterialLogoLoader,
		TileMateriaNormalLoader,
		ElevationLoader,
		GeoJSONSource,
		GeoJSONLoader,
		SingleTifDEMLoader,
		SingleTifDEMSource,
	};

	window.addEventListener('resize', () => {
		engine.resize();
	});

	return scene;
};

const loadingEl = document.getElementById('loading');
if (loadingEl) loadingEl.style.display = 'block';

createScene().then((scene) => {
	engine.runRenderLoop(() => {
		scene.render();
		updateStats();
	});
	if (loadingEl) {
		setTimeout(() => {
			loadingEl.style.display = 'none';
		}, 1000);
	}
});

/** 更新 HUD：FPS / 瓦片数 / 相机姿态 */
function updateStats() {
	const controls = (window as any).__controls as TileMapControls | undefined;
	const map = (window as any).__map as TileMap | undefined;
	const fpsEl = document.getElementById('fps');
	if (fpsEl) fpsEl.textContent = engine.getFps().toFixed();
	const tilesEl = document.getElementById('tiles');
	if (tilesEl && map) {
		const c = map.getTileCount();
		tilesEl.textContent = `${c.total} (下载 ${c.downloading})`;
	}
	const camEl = document.getElementById('cam');
	if (camEl && controls) {
		const yaw = ((controls.getYaw() * 180) / Math.PI).toFixed(1);
		const pitch = ((controls.getPitch() * 180) / Math.PI).toFixed(1);
		const roll = ((controls.getRoll() * 180) / Math.PI).toFixed(1);
		camEl.textContent = `${yaw}° / ${pitch}° / ${roll}°`;
	}
}

console.log('Babylon-Tile Plugin Demo Started');
