/**
 * Babylon.js Tile Map Demo
 * 交互与视觉效果对齐 three-tile（TileMapControls MAP 模式）
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';

import {
	TileMap,
	TileMapControls,
	GDSource,
	CesiumTerrainSource,
	MapBoxSource,
	MapBoxTerrainSource,
	QuickSources,
	registerImgLoader,
} from '@babylon-tile/lib';
import type { ISource } from '@babylon-tile/lib';
import { GeoJSONSource, GroundGroup, GeoJSONLoader } from '@babylon-tile/plugin';

// 注册 geojson 覆盖层材质加载器（plugin 的 loader 需显式注册到 loaderFactory，
// 否则 getMaterialLoader('geojson') 抛错被吞掉 → 覆盖层静默缺失）
registerImgLoader(new GeoJSONLoader());

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
// 大世界渲染：Float64 CPU 矩阵 + 浮点原点（着色器 uniform/attribute 相对相机偏移），
// 解决平面地图 ±2e7 米坐标下的位置抖动与瓦片接缝精度问题。
const engine = new Engine(canvas, true, { useLargeWorldRendering: true });

// ======================== 常量 ========================
const BACK_COLOR = new Color4(0.859, 0.941, 1.0, 1.0); // 0xdbf0ff 浅天蓝

// ======================== 地形（默认 Cesium ion；Mapbox token 保留备用） ========================
// 如需切回 Mapbox raster-dem，把 demSource 改为：
//   new MapBoxTerrainSource({ token: MAPBOX_TOKEN })
// 并在 import 中补回 MapBoxTerrainSource。此 token 为真实 token，刻意保留，不可回退。
const MAPBOX_TOKEN = 'pk.eyJ1IjoidGJ1c2FuIiwiYSI6ImNtZjY2emZneDBkY24ybXB4cmpvdmwzNWYifQ.h6tcQ380WN5AW6fZr08how';

/**
 * Mars3D 免费 quantized-mesh 地形源（国内可达，无需 token）
 * 走 vite proxy（/terrain → https://data1.mars3d.cn），由代理改写 Referer/Origin 绕过防盗链。
 * Mars3D 瓦片为小端字节序 + 2×2 根瓦片网格，Accept 头按服务要求配置。
 */
function createMars3DTerrain(): CesiumTerrainSource {
	return new CesiumTerrainSource({
		url: '/terrain/{z}/{x}/{y}.terrain',
		tilingScheme: 'EPSG:4326',
		tms: true,
		numberOfLevelZeroTilesX: 2,
		numberOfLevelZeroTilesY: 2,
		littleEndian: true,
		headers: {
			Accept: 'application/vnd.quantized-mesh;extensions=octvertexnormals,application/octet-stream;q=0.9,*/*;q=0.01',
		},
	});
}

/**
 * 手动矢量面填充：凸多边形 fan 三角网 + 半透明材质
 * @param scene - 场景
 * @param pts - 多边形世界坐标点（凸多边形即可）
 * @param color - 填充色
 */
function createPolygonFill(scene: Scene, pts: Vector3[], color: Color3): Mesh {
	const mesh = new Mesh('vec-poly-fill', scene);
	const positions: number[] = [];
	pts.forEach((p) => positions.push(p.x, p.y, p.z));
	const indices: number[] = [];
	for (let i = 1; i < pts.length - 1; i++) {
		indices.push(0, i, i + 1);
	}
	// 平面法线（多边形大致在水平面，翻转朝上以免背面渲染成暗色）
	const n = Vector3.Cross(pts[1].subtract(pts[0]), pts[2].subtract(pts[0])).normalize();
	if (n.y < 0) {
		n.scaleInPlace(-1);
	}
	const normals: number[] = [];
	pts.forEach(() => normals.push(n.x, n.y, n.z));

	const vd = new VertexData();
	vd.positions = positions;
	vd.normals = normals;
	vd.indices = indices;
	vd.applyToMesh(mesh);

	const mat = new StandardMaterial('vec-poly-mat', scene);
	mat.diffuseColor = color;
	mat.alpha = 0.4;
	mat.backFaceCulling = false;
	mesh.material = mat;
	return mesh;
}

const createScene = async (): Promise<Scene> => {
	const scene = new Scene(engine);
	scene.clearColor = BACK_COLOR;

	// 雾效（对齐 three-tile FogExp2）
	scene.fogMode = Scene.FOGMODE_EXP2;
	scene.fogColor = new Color3(BACK_COLOR.r, BACK_COLOR.g, BACK_COLOR.b);
	scene.fogDensity = 0; // 初始为 0，动态调整

	// ======================== 相机（对齐 three-tile PerspectiveCamera(70, ...)） ========================
	// 初始视点：甘南/积石山（104°E 35°N）。
	// 注意：地图投影由影像源决定（GDSource.projectionID='3857' → Web Mercator，lon0=90），
	// 不是 WGS84 线性投影；104°E 35°N 的墨卡托世界坐标为 geo2world(104,35) =
	// (1558472.87, 0, 4163881.14)（1° 经度 ≈ 111.3km，纬度 35° 墨卡托北向 ≈ 4163.9km）。
	// 半径 12000（z≈11，瓦片 ~9.8km）：相机高 = radius·cos(β) ≈ 6000m，
	// 该区域 DEM 海拔 2400-2900m（3000m 级山峰），相机需明显高出峰顶，
	// 否则初始视图会被山体遮挡只剩天空（radius=5000 时相机 y≈2500 与山峰同高）。
	const camera = new ArcRotateCamera(
		'camera',
		-Math.PI / 2,
		Math.PI / 3,
		12000,
		new Vector3(1558472.87, 0, 4163881.14),
		scene
	);
	camera.fov = (70 * Math.PI) / 180; // 70° FOV（three-tile 默认 70）

	// 相机控制：使用 lib 提供的 TileMapControls（MAP 模式：左键平移、右键旋转），
	// attachControl/距离与仰角限制/惯性/每帧动态缩放速度/平移灵敏度/方位角锁定/
	// 动态 far/限高均由其内部维护，不再在此内联重复。
	const controls = new TileMapControls(camera);

	// ======================== 光照（对齐 three-tile AmbientLight + DirectionalLight） ========================
	const hemiLight = new HemisphericLight('hemiLight', new Vector3(0, 1, 0), scene);
	hemiLight.intensity = 0.8;

	const dirLight = new DirectionalLight('dirLight', new Vector3(0, -1, -0.5), scene);
	dirLight.position = new Vector3(0, 2e3, 1e3);
	dirLight.intensity = 0.6;

	// ======================== 地图（lon0=90 对齐 three-tile 默认亚洲中心） ========================
	// 当前底图（可切换）。所有内置源 projectionID='3857'（Web Mercator），切换不改变地图投影。
	let _basemap: ISource = new GDSource({ style: 'img', minLevel: 2, maxLevel: 18 });
	let _geojsonActive = false;
	let _geojsonSource: GeoJSONSource | null = null;
	let _vectorsShown = false;
	let _glbRoot: TransformNode | null = null;

	const map = TileMap.create({
		scene,
		imgSource: _basemap,
		demSource: createMars3DTerrain(),
		minLevel: 2,
		maxLevel: 18,
		lon0: 90, // 中央经度 90°E（对齐 three-tile demo）
		debug: 1,
	});

	// ======================== 伪球体 FakeEarth（远距离显示地球弧线） ========================
	const fakeEarth = createFakeEarth(scene, map);

	map.addObservable('ready', () => {
		console.log('Map ready!!!!!!');
	});

	// 每个瓦片加载都输出会刷屏（高缩放时数百行），仅在调试时打开
	const DEBUG_TILE_LOG = false;
	map.addObservable('tile-loaded', ({ tile }) => {
		if (DEBUG_TILE_LOG) {
			console.log(`Tile loaded: ${tile.x}, ${tile.y}, ${tile.z}`);
		}
	});

	// ======================== 底图 / 地形切换 + 点线面 + GLB 示例 ========================
	// imgSource/demSource setter 赋值即自动 reload；渲染循环每帧 map.update(camera) 完成加载。

	/** 重新应用影像源数组：底图 +（可选）geojson 覆盖层 */
	function applyImgSource() {
		const sources: ISource[] = [_basemap];
		if (_geojsonActive && _geojsonSource) {
			sources.push(_geojsonSource);
		}
		map.imgSource = sources;
	}

	/**
	 * 相机取景：对准经纬度中心（保持当前方位，调整目标与距离）。
	 * 演示数据分散在 100km+ 范围（若尔盖湿地 ~130km 宽、兰州在 35°N 北边 ~120km），
	 * 默认相机 radius=12000 视野只有 ~10km，不加取景点击按钮看不到数据。
	 */
	function focusOn(lon: number, lat: number, radius: number, alt = 0): void {
		const w = map.geo2world(new Vector3(lon, lat, alt));
		camera.setTarget(new Vector3(w.x, w.y, w.z));
		camera.radius = radius;
	}

	/** 底图切换：影像 / 路网 / OSM / Mapbox 卫星 */
	function switchBasemap(name: string) {
		switch (name) {
			case 'cva':
				_basemap = new GDSource({ style: 'cva', minLevel: 2, maxLevel: 18 });
				break;
			case 'osm':
				_basemap = QuickSources.osm({ minLevel: 2 });
				break;
			case 'mapbox':
				_basemap = new MapBoxSource({ token: MAPBOX_TOKEN, style: 'mapbox.satellite' });
				break;
			default:
				_basemap = new GDSource({ style: 'img', minLevel: 2, maxLevel: 18 });
				break;
		}
		applyImgSource();
	}

	/** 地形切换：Mars3D / Mapbox terrain-rgb / 无地形（平面） */
	function switchTerrain(name: string) {
		switch (name) {
			case 'mapbox':
				map.demSource = new MapBoxTerrainSource({ token: MAPBOX_TOKEN });
				break;
			case 'none':
				map.demSource = undefined;
				break;
			default:
				map.demSource = createMars3DTerrain();
				break;
		}
	}

	/** GeoJSON 覆盖层开关（叠在底图之上，保留底图） */
	function toggleGeoJSONOverlay(): boolean {
		_geojsonActive = !_geojsonActive;
		if (_geojsonActive && !_geojsonSource) {
			_geojsonSource = new GeoJSONSource({
				url: '/demo_features.geojson',
				style: {
					minLevel: 2,
					maxLevel: 18,
					color: '#ff5252',
					weight: 2,
					opacity: 0.9,
					fill: true,
					fillColor: '#ff5252',
					fillOpacity: 0.18,
					textField: 'name',
					fontColor: '#ffffff',
				},
			});
		}
		applyImgSource();
		if (_geojsonActive) {
			// 取景到若尔盖湿地（多边形 ~130km 宽）
			focusOn(102.9, 33.8, 190000);
		}
		return _geojsonActive;
	}

	// 手动点线面数据：geo2world(lon, lat, alt) 定位，挂 _vectorGroup 统一清除
	const _vectorGroup = new TransformNode('demo-vectors', scene);
	_vectorGroup.setEnabled(false);

	/** 手动点线面开关（重建场景内的矢量 Mesh） */
	function toggleManualVectors(): boolean {
		_vectorsShown = !_vectorsShown;
		_vectorGroup.getChildren().forEach((c) => c.dispose());
		if (!_vectorsShown) {
			_vectorGroup.setEnabled(false);
			return false;
		}
		_vectorGroup.setEnabled(true);

		// 点：城市位置球体（alt=3200 略高于地表，避免被起伏遮挡）
		const CITIES: Array<[number, number, string]> = [
			[103.83, 36.06, '兰州'],
			[103.2, 35.6, '临夏'],
			[102.9, 35.0, '合作'],
			[102.9, 33.6, '若尔盖'],
			[103.2, 34.0, '迭部'],
		];
		const pointMat = new StandardMaterial('vec-point-mat', scene);
		pointMat.diffuseColor = new Color3(1, 0.4, 0.2);
		pointMat.specularColor = new Color3(0.2, 0.2, 0.2);
		for (const [lon, lat, name] of CITIES) {
			const sph = MeshBuilder.CreateSphere(`vec-point-${name}`, { diameter: 300, segments: 12 }, scene);
			sph.material = pointMat;
			sph.position = map.geo2world(new Vector3(lon, lat, 3200));
			sph.setParent(_vectorGroup);
		}

		// 线：兰州-若尔盖 示意道路
		const ROAD: Array<[number, number]> = [
			[103.83, 36.06],
			[103.2, 35.6],
			[102.9, 35.0],
			[103.2, 34.0],
			[103.9, 33.4],
			[104.1, 33.2],
			[103.8, 30.7],
		];
		const linePts = ROAD.map(([lon, lat]) => map.geo2world(new Vector3(lon, lat, 3100)));
		const line = MeshBuilder.CreateLines('vec-line', { points: linePts }, scene);
		line.color = new Color3(0.2, 0.6, 1);
		line.setParent(_vectorGroup);

		// 面：若尔盖湿地（外轮廓 + 半透明填充）
		const POLY: Array<[number, number]> = [
			[102.2, 34.4],
			[103.6, 34.4],
			[103.6, 33.2],
			[102.2, 33.2],
		];
		const polyPts = POLY.map(([lon, lat]) => map.geo2world(new Vector3(lon, lat, 3000)));
		const outline = MeshBuilder.CreateLines('vec-poly-outline', { points: [...polyPts, polyPts[0]] }, scene);
		outline.color = new Color3(1, 0.7, 0.2);
		outline.setParent(_vectorGroup);

		const fill = createPolygonFill(scene, polyPts, new Color3(1, 0.7, 0.2));
		fill.name = 'vec-poly-fill';
		fill.setParent(_vectorGroup);

		// 取景到矢量区（兰州 36.06°N ~ 若尔盖 33.6°N，~270km 南北跨度）
		focusOn(103.4, 34.8, 330000);
		return true;
	}

	// GLB 模型示例：SceneLoader 加载，GroundGroup 贴地
	let _groundGroup: GroundGroup | null = null;

	/** 加载 GLB 模型（已加载则先移除再重新加载） */
	async function loadGLB(): Promise<boolean> {
		if (_glbRoot) {
			removeGLB();
		}
		try {
			const result = await SceneLoader.ImportMeshAsync('', '/', 'demo_model.glb', scene);
			const root = result.meshes[0];
			if (!root) {
				return false;
			}
			root.name = 'demo-glb';
			root.position = map.geo2world(new Vector3(103.8, 35.0, 2800));
			if (!_groundGroup) {
				_groundGroup = new GroundGroup('glb-ground', map, { updateEveryTile: true });
			}
			_groundGroup.add(root);
			_glbRoot = root;
			// 取景到 GLB 位置
			focusOn(103.8, 35.0, 45000);
			return true;
		} catch (e) {
			console.error('GLB load failed:', e);
			return false;
		}
	}

	/** 移除 GLB 模型 */
	function removeGLB(): void {
		if (_glbRoot) {
			_glbRoot.dispose();
			_glbRoot = null;
		}
	}

	// ======================== 工具栏事件 ========================
	const toolbar = document.getElementById('toolbar');
	toolbar?.querySelectorAll<HTMLButtonElement>('button[data-basemap]').forEach((btn) => {
		btn.addEventListener('click', () => {
			switchBasemap(btn.dataset.basemap!);
			toolbar.querySelectorAll('button[data-basemap]').forEach((b) => b.classList.remove('active'));
			btn.classList.add('active');
		});
	});
	toolbar?.querySelectorAll<HTMLButtonElement>('button[data-terrain]').forEach((btn) => {
		btn.addEventListener('click', () => {
			switchTerrain(btn.dataset.terrain!);
			toolbar.querySelectorAll('button[data-terrain]').forEach((b) => b.classList.remove('active'));
			btn.classList.add('active');
		});
	});

	const btnGeojson = document.getElementById('btn-geojson');
	btnGeojson?.addEventListener('click', () => {
		const on = toggleGeoJSONOverlay();
		btnGeojson.classList.toggle('active', on);
		btnGeojson.textContent = on ? 'GeoJSON ✓' : 'GeoJSON';
	});
	const btnVectors = document.getElementById('btn-vectors');
	btnVectors?.addEventListener('click', () => {
		const on = toggleManualVectors();
		btnVectors.classList.toggle('active', on);
		btnVectors.textContent = on ? '点线面 ✓' : '点线面';
	});
	document.getElementById('btn-glb')?.addEventListener('click', () => {
		void loadGLB();
	});
	document.getElementById('btn-glb-remove')?.addEventListener('click', () => {
		removeGLB();
	});

	// (window as any).__switches 见下方；controls 供调试探针访问
	(window as any).__scene = scene;
	(window as any).__map = map;
	(window as any).__camera = camera;
	(window as any).__controls = controls;
	(window as any).__switches = {
		switchBasemap,
		switchTerrain,
		toggleGeoJSONOverlay,
		toggleManualVectors,
		loadGLB,
		removeGLB,
		state: () => ({
			basemap: _basemap.url,
			geojson: _geojsonActive,
			vectors: _vectorsShown,
			glb: !!_glbRoot,
		}),
	};

	// ======================== 渲染循环（动态相机参数由 TileMapControls 维护，这里只处理地图/雾/FakeEarth） ========================
	scene.registerBeforeRender(() => {
		map.update(camera);

		const dist = camera.radius;
		const beta = Math.max(camera.beta, 0.01); // 当前仰角（polar angle）

		// 动态雾密度（对齐 three-tile: density = polar/(dist+1) * factor * 0.2）
		scene.fogDensity = (beta / (dist + 1)) * 0.2;

		// 伪球体可见性（远距离 + 非完全俯视时显示）
		if (fakeEarth) {
			fakeEarth.setEnabled(dist > 5e5 && beta < Math.PI / 2);
		}
	});

	window.addEventListener('resize', () => {
		engine.resize();
	});

	return scene;
};

/**
 * 创建伪球体（FakeEarth）
 * 对齐 three-tile 的 FakeEarth：远距离时在地图下方显示一个深色球体 + 大气辉光
 */
function createFakeEarth(scene: Scene, map: TileMap) {
	// 注册 shader
	Effect.ShadersStore['fakeEarthVertexShader'] = `
		precision highp float;
		attribute vec3 position;
		attribute vec2 uv;
		uniform mat4 worldViewProjection;
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = worldViewProjection * vec4(position, 1.0);
		}
	`;
	Effect.ShadersStore['fakeEarthFragmentShader'] = `
		precision highp float;
		varying vec2 vUv;
		uniform vec3 airColor;
		void main() {
			float d = distance(vUv, vec2(0.5));
			d = d * d * 100.0;
			if (d < 0.86) {
				float a = smoothstep(0.0, 1.0, d);
				gl_FragColor = vec4(vec3(0.0), a);
			} else if (d <= 0.98) {
				float c = (d - 0.86) / (0.98 - 0.86);
				gl_FragColor = vec4(mix(vec3(0.0), airColor, pow(c, 8.0)), 1.0);
			} else if (d <= 1.0) {
				float c = (d - 0.98) / (1.0 - 0.98);
				gl_FragColor = vec4(mix(airColor, vec3(0.6), pow(c, 2.0)), 1.0);
			} else if (d <= 1.5) {
				float c = (d - 1.0) / (1.5 - 1.0);
				gl_FragColor = vec4(mix(vec3(0.6), vec3(0.859, 0.941, 1.0), c), 1.0 - c);
			} else {
				discard;
			}
		}
	`;

	const earthMat = new ShaderMaterial('fakeEarthMat', scene, 'fakeEarth', {
		attributes: ['position', 'uv'],
		uniforms: ['worldViewProjection', 'airColor'],
	});
	earthMat.setVector3('airColor', new Vector3(0.4, 0.6, 0.8));
	earthMat.backFaceCulling = false;
	earthMat.alpha = 1.0;
	earthMat.needAlphaBlending = () => true;
	earthMat.disableDepthWrite = true;

	// 创建一个平面（对齐 three-tile PlaneGeometry(5,5)），放在地图下方
	const plane = MeshBuilder.CreatePlane('fakeEarth', { size: 5 }, scene);
	plane.material = earthMat;
	plane.rotation.x = Math.PI / 2; // 平放在 XZ 平面
	plane.position.y = -0.01; // 略低于地图
	plane.setParent(map);
	plane.renderingGroupId = 0;
	plane.infiniteDistance = false;

	return plane;
}

createScene().then((scene) => {
	engine.runRenderLoop(() => {
		scene.render();
		updateStats();
	});
});

function updateStats() {
	const fpsEl = document.getElementById('fps');
	if (fpsEl) {
		fpsEl.textContent = engine.getFps().toFixed();
	}
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
