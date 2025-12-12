/**
 * @description: Babylon Tiles Demo
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { Vector3 } from "@babylonjs/core";
import * as BT from "babylon-tile";
import * as Plugin from "babylon-tile-plugin";

// Register loaders
function registerLoaders(viewer: Plugin.BabylonViewer) {
  console.log("======================================================");
  console.log(`Babylon Tiles V${BT.version}`);
  console.log("======================================================");

  // Register image loader with scene
  const imgLoader = new BT.TileImageLoader(viewer.scene);
  BT.registerImgLoader(imgLoader);

  // Register flat geometry loader
  const geoLoader = new BT.TileGeometryLoader();
  BT.registerDEMLoader(geoLoader);

  const loaders = BT.getTileLoaders();
  console.log("Tile Loaders:");
  loaders.imgLoaders.forEach((loader) => {
    console.log(`* Image Loader: '${loader.dataType}' Author: '${loader.info.author}'`);
  });
  loaders.demLoaders.forEach((loader) => {
    console.log(`* DEM Loader: '${loader.dataType}' Author: '${loader.info.author}'`);
  });
  console.log("======================================================");

  // Update version display
  document.querySelector<HTMLSpanElement>("#version")!.innerText = BT.version;
}

// Create map
function createMap(viewer: Plugin.BabylonViewer) {
  // Image data source
  const imgSource = Plugin.arcGisImgSource;
  debugger
  // DEM data source (optional, comment out for flat map)
  // const demSource = Plugin.arcGisDemSource;

  // Create map object
  const map = new BT.TileMap({
    scene: viewer.scene,
    // Image data source
    imgSource: imgSource,
    // Terrain data source
    // demSource: demSource,
    // Map projection center longitude
    lon0: 0,
    // Minimum zoom level (changed from 2 to 0 to allow rootTile to load)
    minLevel: 0,
    // Maximum zoom level
    maxLevel: 18,
    // Map lat/lon bounds (optional)
    // bounds: [60, 0, 145, 60],
    // Debug flag
    debug: 0,
  });

  // 🔧 FIX: Increase LOD threshold to match the distance ratio
  // distRatio is around 430, so we need a much larger threshold
  map.LODThreshold = 500;

  // Rotate map to horizontal plane
  map.rotation.x = -Math.PI / 2;

  console.log("Map created successfully!");
  console.log("Map details:", {
    position: map.position.asArray(),
    rotation: map.rotation.asArray(),
    scaling: map.scaling.asArray(),
    rootTilePosition: map.rootTile.position.asArray(),
    rootTileScaling: map.rootTile.scaling.asArray()
  });

  return map;
}

// Initialize viewer
function initViewer() {
  const viewer = new Plugin.BabylonViewer("renderCanvas");

  // Set initial camera position
  // 🔧 FIX: Reduce camera distance to get better LOD behavior
  viewer.setCameraPosition(
    -Math.PI / 2,  // alpha (longitude)
    Math.PI / 4,   // beta (latitude)
    1000,       // radius (distance) - reduced from 5000000
    Vector3.Zero() // target
  );

  console.log("Camera details:", {
    position: viewer.camera.position.asArray(),
    target: viewer.camera.target.asArray(),
    radius: viewer.camera.radius,
    alpha: viewer.camera.alpha,
    beta: viewer.camera.beta
  });

  return viewer;
}

// Update info display
function updateInfo(map: BT.TileMap, viewer: Plugin.BabylonViewer) {
  const tileCountElement = document.querySelector<HTMLSpanElement>("#tileCount");
  const downloadingElement = document.querySelector<HTMLSpanElement>("#downloading");
  const cameraInfoElement = document.querySelector<HTMLSpanElement>("#cameraInfo");

  setInterval(() => {
    // Count tiles
    let tileCount = 0;
    map.rootTile.getDescendants().forEach((node) => {
      if ((node as any).isTile) {
        tileCount++;
      }
    });

    if (tileCountElement) {
      tileCountElement.innerText = tileCount.toString();
    }

    if (downloadingElement) {
      downloadingElement.innerText = map.downloading.toString();
    }

    if (cameraInfoElement) {
      const camera = viewer.camera;
      const distance = Math.floor(viewer.getCameraDistance());
      cameraInfoElement.innerText = `α:${camera.alpha.toFixed(2)} β:${camera.beta.toFixed(2)} d:${distance}`;
    }
  }, 100);
}

// Main function
function main() {
  // Hide loading indicator
  setTimeout(() => {
    document.querySelector("#loading")?.classList.add("hidden");
  }, 1000);

  debugger
  // Create viewer
  const viewer = initViewer();

  // Register loaders (需要先创建 viewer 才能传递 scene)
  registerLoaders(viewer);

  // Create map
  const map = createMap(viewer);

  // Update map in render loop
  viewer.scene.registerBeforeRender(() => {
    map.update(viewer.camera);
  });

  // Update info display
  updateInfo(map, viewer);

  console.log("Demo initialized successfully!");
  console.log("Use mouse to navigate:");
  console.log("- Left click + drag: Rotate");
  console.log("- Right click + drag: Pan");
  console.log("- Mouse wheel: Zoom");
}

// Start application
main();

