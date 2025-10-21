# Babylon Tile Plugin

Plugin package for Babylon Tile, providing additional loaders and utilities.

## Features

- 🎬 BabylonViewer - Ready-to-use 3D viewer
- 🗺️ Pre-configured map sources
- 🔧 Additional loaders and utilities

## Installation

```bash
npm install babylon-tile-plugin babylon-tile @babylonjs/core
```

## Quick Start

```typescript
import { BabylonViewer, arcGisImgSource } from 'babylon-tile-plugin';
import { TileMap, registerImgLoader, TileImageLoader } from 'babylon-tile';

// Register loaders
registerImgLoader(new TileImageLoader());

// Create viewer
const viewer = new BabylonViewer('renderCanvas');

// Create map
const map = new TileMap({
  scene: viewer.scene,
  imgSource: arcGisImgSource,
  minLevel: 2,
  maxLevel: 18,
});

// Update in render loop
viewer.scene.registerBeforeRender(() => {
  map.update(viewer.camera);
});
```

## API Documentation

### BabylonViewer

Ready-to-use 3D viewer with camera controls.

```typescript
const viewer = new BabylonViewer('canvasId');
```

### Map Sources

Pre-configured tile sources:

- `arcGisImgSource`: ArcGIS World Imagery
- `arcGisDemSource`: ArcGIS World Terrain
- `osmSource`: OpenStreetMap

## License

MIT

