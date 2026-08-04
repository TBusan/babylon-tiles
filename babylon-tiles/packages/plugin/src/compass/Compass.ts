/**
 * @description: 罗盘（DOM+SVG 小飞机）
 * @author: Babylon-Tile Team
 *
 * 对齐 three-tile compass/Compass：
 * - 一个 DOM 罗盘（含小飞机 SVG 与 N/W/E/S 文字），监听 TileMapControls.onChange，
 *   飞机随俯仰角 rotateX、文字随偏航角 rotate。
 * - 复用 onChange：组合已有回调而非覆盖。
 */

import html from './compass.txt?raw';
import { TileMapControls } from '@babylon-tile/lib';

/**
 * 罗盘类
 */
export class Compass {
	/** 罗盘顶层 dom */
	public dom = document.createElement('div');
	/** 罗盘中的小飞机 */
	public plane: HTMLElement | null | undefined;
	/** 罗盘中的文字 */
	public text: HTMLElement | null | undefined;
	/** 地图控制器 */
	public controls: TileMapControls;

	/**
	 * 构造函数
	 * @param controls 地图控制器
	 */
	public constructor(controls: TileMapControls) {
		this.controls = controls;
		this.dom.innerHTML = html;
		this.dom.style.width = '100%';
		this.dom.style.height = '100%';
		this.plane = this.dom.querySelector<HTMLElement>('#tt-compass-plane');
		this.text = this.dom.querySelector<HTMLElement>('#tt-compass-text');

		// 控制器发生变化时旋转飞机和文字（组合已有 onChange）
		const prevOnChange = controls.onChange;
		controls.onChange = () => {
			prevOnChange?.();
			if (this.plane && this.text) {
				// polar = beta = π/2 - pitch；文字反向旋转偏航角使 N 指向世界北
				const polar = Math.PI / 2 - controls.getPitch();
				this.plane.style.transform = `rotateX(${polar}rad)`;
				this.text.style.transform = `rotate(${-controls.getYaw()}rad)`;
			}
		};
		this.dom.onclick = () => open('https://github.com/sxguojf/three-tile');
	}
}
