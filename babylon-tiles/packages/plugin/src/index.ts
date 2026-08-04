/**
 * @babylon-tile/plugin
 * Babylon.js 瓦片地图库 - 可插拔扩展
 *
 * 架构约定（用户明确）：
 * - 与地图/坐标/相机/鼠标交互相关 → lib 核心（@babylon-tile/lib）。
 * - 本包只放可插拔扩展：loader 插件（影响"数据怎么渲染"）+ 装饰/特效/UI 辅助。
 * - mvt 矢量底图属核心（lib），不在本包；geojson 矢量覆盖层留在此包。
 * - limitCameraHeight 已并入 lib TileMapControls 的 minHeight/maxHeight 相机属性。
 */

// 功能插件
export * from './fakeEarth/EarthMaskMaterial.js';
export * from './fakeEarth/FakeEarth.js';
export * from './fog/MapFog.js';
export * from './compass/Compass.js';
export * from './groundGroup/GroundGroup.js';
export * from './utils/utils.js';
export * from './postprocessing/Filter1.js';
export * from './indexDBCache/index.js';

// loader 插件
export * from './wireframeLoader/TileMaterialWrieLoader.js';
export * from './normalLoder/TileMateriaNormalLoader.js';
export * from './debugLoader/DebugeLoader.js';
export * from './logoLoader/TileMateriaLogoLoader.js';
export * from './singleImageLoader/SingleImageSource.js';
export * from './singleImageLoader/SingleImageLoader.js';
export * from './singleTifDEMLoader/parse.js';
export * from './singleTifDEMLoader/SingleTifDEMSource.js';
export * from './singleTifDEMLoader/SingleTifDEMLoader.js';
export * from './geojsonLoader/GeoJSONSource.js';
export * from './geojsonLoader/GeoJSONLoader.js';
export * from './elevationLoader/ElevationShader.js';
export * from './elevationLoader/ElevationLoader.js';

// 版本信息
export const version = '1.0.0';
export const author = { name: 'Babylon-Tile Team', email: 'team@example.com' };
