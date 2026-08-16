/**
 * @babylon-tile/lib
 * Babylon.js 瓦片地图库
 */

// 导出投影相关
export * from './projection/IProjection.js';
export * from './projection/WGS84Projection.js';
export * from './projection/WebMercatorProjection.js';
export * from './projection/ProjectionFactory.js';

// 导出数据源相关
export * from './source/index.js';

// 导出几何体相关
export * from './geometry/TileGeometry.js';
export * from './geometry/Martini.js';

// 导出材质相关
export * from './material/TileMaterial.js';
export * from './material/TileFilterMaterial.js';
export * from './material/VectorTileRender.js';

// 导出加载器相关
export * from './loader/index.js';

// 导出瓦片相关
export * from './tile/util.js';
export * from './tile/FrustumEx.js';
export * from './tile/Tile.js';
export * from './tile/TileMap.js';
export * from './tile/TileContext.js';
export * from './tile/TileFade.js';

// 导出相机控制相关（核心：相机控制/鼠标交互）
export * from './controls/index.js';

// 版本信息
export const version = '1.0.0';
export const author = { name: 'Babylon-Tile Team', email: 'team@example.com' };
