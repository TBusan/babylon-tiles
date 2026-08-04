/**
 * @description: 工具函数
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile utils：
 * - getLocalFromMouse：鼠标事件 → 地面信息（lib getLocalInfoFromScreen 直接接收像素坐标）。
 * - getAttributions：汇总影像 + DEM 数据源的版权信息。
 */

import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { TileMap, ISource } from '@babylon-tile/lib';

/**
 * 从鼠标事件获取地面地理坐标
 * 注：lib 的 LocationInfo.location 为地理坐标 (lon, lat, height)，与 three-tile 的
 * 本地坐标语义不同（lib 顶层导出 world2geo 供换算）。
 * @param mouseEvent - 鼠标事件
 * @param map - 地图
 * @param camera - 相机
 * @returns 地理坐标 (lon, lat, height)，未命中返回 undefined
 */
export function getLocalFromMouse(
	mouseEvent: MouseEvent,
	map: TileMap,
	camera: Camera
): Vector3 | undefined {
	const { currentTarget, offsetX, offsetY } = mouseEvent;
	if (currentTarget instanceof HTMLElement) {
		// lib getLocalInfoFromScreen 直接接收画布像素坐标
		const info = map.getLocalInfoFromScreen(offsetX, offsetY, camera);
		return info?.location;
	}
	throw new Error('mouseEvent.currentTarget is not HTMLElement!');
}

/**
 * 获取地图版权信息
 * @param map - 地图
 * @returns 版权信息数组（去重）
 */
export function getAttributions(map: TileMap): string[] {
	const attributions = new Set<string>();
	const imgSources = map.imgSource;
	imgSources.forEach(source => {
		const attr = getAttribution(source);
		attr && attributions.add(attr);
	});
	if (map.demSource) {
		const attr = getAttribution(map.demSource);
		attr && attributions.add(attr);
	}
	return Array.from(attributions);
}

/**
 * ISource 接口未声明 attribution（具体实现类才声明），此处安全取值
 */
function getAttribution(source: ISource): string | undefined {
	return (source as unknown as { attribution?: string }).attribution;
}
