/**
 * @description: Babylon Viewer (equivalent to GLViewer in three-tile)
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color4,
} from "@babylonjs/core";

/**
 * Babylon viewer for displaying tile map
 */
export class BabylonViewer {
  public engine: Engine;
  public scene: Scene;
  public camera: ArcRotateCamera;
  public canvas: HTMLCanvasElement;

  constructor(canvasId: string) {
    // Get canvas element
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) {
      throw new Error(`Canvas element with id "${canvasId}" not found`);
    }
    this.canvas = canvas;

    // Create engine
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });

    // Create scene
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.5, 0.7, 1.0, 1.0);

    // Create camera
    this.camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 2,
      Math.PI / 4,
      1000000,
      Vector3.Zero(),
      this.scene
    );
    this.camera.attachControl(canvas, true);
    this.camera.lowerRadiusLimit = 100;
    this.camera.upperRadiusLimit = 50000000;
    this.camera.wheelPrecision = 0.1;
    this.camera.panningSensibility = 100;

    // Create light
    const light = new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);
    light.intensity = 1.2;

    // Run render loop
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    // Handle window resize
    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }

  /**
   * Dispose viewer
   */
  public dispose() {
    this.engine.dispose();
  }

  /**
   * Get camera distance
   */
  public getCameraDistance(): number {
    return this.camera.radius;
  }

  /**
   * Set camera position
   */
  public setCameraPosition(alpha: number, beta: number, radius: number, target?: Vector3) {
    this.camera.alpha = alpha;
    this.camera.beta = beta;
    this.camera.radius = radius;
    if (target) {
      this.camera.target = target;
    }
  }
}

