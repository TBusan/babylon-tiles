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
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import '@babylonjs/loaders/glTF';

import { TileMap, GDSource } from '@babylon-tile/lib';

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true);

// ======================== 常量（对齐 three-tile TileMapControls） ========================
const BACK_COLOR = new Color4(0.859, 0.941, 1.0, 1.0); // 0xdbf0ff 浅天蓝
const MAP_MAX_BETA = Math.PI / 2.1; // ≈ 85.7° 最大仰角
const REST_AZIMUTH_DIST = 8e6; // 超过此距离锁定方位角
const MAX_DISTANCE = 3e7;
const MIN_DISTANCE = 10;

const createScene = async (): Promise<Scene> => {
	const scene = new Scene(engine);
	scene.clearColor = BACK_COLOR;

	// 雾效（对齐 three-tile FogExp2）
	scene.fogMode = Scene.FOGMODE_EXP2;
	scene.fogColor = new Color3(BACK_COLOR.r, BACK_COLOR.g, BACK_COLOR.b);
	scene.fogDensity = 0; // 初始为 0，动态调整

	// ======================== 相机（对齐 three-tile PerspectiveCamera(70, ...)） ========================
	const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 2.8e7, Vector3.Zero(), scene);
	camera.fov = 70 * Math.PI / 180; // 70° FOV（three-tile 默认 70）
	// ---- 鼠标按键映射：MAP 模式 = 左键平移、右键旋转（与 three-tile 一致）----
	// attachControl(noPreventDefault, useCtrlForPanning, panningMouseButton)
	// panningMouseButton=0 → 左键平移，右键自动变为旋转
	camera.attachControl(true, true, 0);

	// ---- 缩放设置 ----
	camera.wheelDeltaPercentage = 0.02; // 基础值，会在渲染循环中动态调整
	camera.lowerRadiusLimit = MIN_DISTANCE;
	camera.upperRadiusLimit = MAX_DISTANCE;

	// ---- 角度限制 ----
	camera.upperBetaLimit = MAP_MAX_BETA;
	camera.lowerBetaLimit = 0.05;
	camera.lowerAlphaLimit = -Infinity;
	camera.upperAlphaLimit = Infinity;

	// ---- 深度范围 ----
	// near 使用固定小值：动态 near 有一帧延迟，快速缩放时会裁剪地面导致瓦片不加载
	camera.minZ = 1;
	camera.maxZ = 5e7;

	// ---- 平移设置（对齐 three-tile screenSpacePanning=false） ----
	camera.panningAxis = new Vector3(1, 0, 1); // 只在 XZ 水平面平移
	camera.panningSensibility = 2500 / camera.radius;

	// ---- 阻尼/惯性（对齐 three-tile dampingFactor=0.1） ----
	// Babylon inertia=0 表示无惯性（立即停止），=1 表示永远滑动
	// three-tile dampingFactor=0.1 → 每帧保留 90% 速度 → Babylon inertia ≈ 0.9
	// 但 three-tile 的 damping 更紧凑，这里用 0.85 使手感接近
	camera.inertia = 0.85;
	camera.panningInertia = 0.85;

	// ======================== 光照（对齐 three-tile AmbientLight + DirectionalLight） ========================
	const hemiLight = new HemisphericLight('hemiLight', new Vector3(0, 1, 0), scene);
	hemiLight.intensity = 0.8;

	const dirLight = new DirectionalLight('dirLight', new Vector3(0, -1, -0.5), scene);
	dirLight.position = new Vector3(0, 2e3, 1e3);
	dirLight.intensity = 0.6;

	// ======================== 地图（lon0=90 对齐 three-tile 默认亚洲中心） ========================
	const map = TileMap.create({
		scene,
		imgSource: [
			// 原 ArcGisSource(World_Imagery) 在国内网络不可达（连接超时），
			// 瓦片永远加载不完导致地图停滞。改用无需 token 的高德影像源。
			new GDSource({
				style: 'img',
				minLevel: 2,
				maxLevel: 18,
			}),
		],
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

	// Expose for debugging
	(window as any).__scene = scene;
	(window as any).__map = map;
	(window as any).__camera = camera;

	// ======================== 渲染循环（动态相机参数，对齐 three-tile TileMapControls.onChange） ========================
	scene.registerBeforeRender(() => {
		map.update(camera);

		const dist = camera.radius;
		const beta = Math.max(camera.beta, 0.01); // 当前仰角（polar angle）

		// 1. 动态缩放速度：zoomSpeed = max(log(dist/1e3), 1)
		const zoomSpeed = Math.max(Math.log(dist / 1e3), 1);
		camera.wheelDeltaPercentage = 0.01 * zoomSpeed;

		// 2. 动态平移灵敏度
		// 注：panningAxis=(1,0,1) 使屏幕Y方向有效速度为 X 方向的 sin(beta) 倍，
		// 这是 Babylon.js 的固有行为，不能通过每帧修改 inertialPanningY 来补偿（会导致指数放大）。
		// 通过适当降低 sensibility 使整体平移速度匹配 three-tile 的手感。
		camera.panningSensibility = 2000 / dist;

		// 3. 方位角锁定：远距离时锁定朝北（对齐 three-tile restAzimuthDist=8e6）
		if (dist > REST_AZIMUTH_DIST) {
			camera.lowerAlphaLimit = -Math.PI / 2;
			camera.upperAlphaLimit = -Math.PI / 2;
		} else {
			camera.lowerAlphaLimit = -Infinity;
			camera.upperAlphaLimit = Infinity;
		}

		// 4. 动态仰角限制：maxPolar = min((1e7/dist)^2, MAP_MAX_BETA)
		const maxBeta = Math.min(Math.pow(1e7 / dist, 2), MAP_MAX_BETA);
		camera.upperBetaLimit = Math.max(maxBeta, camera.lowerBetaLimit ?? 0.05);

		// 5. 动态 far（near 固定为 1，避免一帧延迟导致近裁面裁剪地面）
		// far = clamp((dist / (polar/1.5)) * 7, 2e4, maxDist*2)
		const far = Math.min(Math.max((dist / (beta / 1.5)) * 7, 2e4), MAX_DISTANCE * 2);
		camera.maxZ = far;

		// 6. 动态雾密度（对齐 three-tile: density = polar/(dist+1) * factor * 0.2）
		scene.fogDensity = (beta / (dist + 1)) * 0.2;

		// 7. 伪球体可见性（远距离 + 非完全俯视时显示）
		if (fakeEarth) {
			fakeEarth.setEnabled(dist > 5e5 && beta < Math.PI / 2);
		}

		// 8. 相机防穿地（简化版：限制 target.y 不低于 0）
		if (camera.target.y < 0) {
			camera.target.y = 0;
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
