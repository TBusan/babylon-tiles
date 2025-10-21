# Babylon Tile

Core library for Babylon.js tile map and terrain loading.

## Features

- 🗺️ Dynamic LOD (Level of Detail) tile system
- 🏔️ DEM/terrain support
- 📐 Multiple map projections (Web Mercator, WGS84)
- 🎯 Efficient frustum culling
- 🔌 Extensible loader system

## Installation

```bash
npm install babylon-tile @babylonjs/core
```

## Quick Start

```typescript
import { TileMap, registerImgLoader, TileImageLoader } from 'babylon-tile';
import { Scene } from '@babylonjs/core';

// Register image loader
registerImgLoader(new TileImageLoader());

// Create tile map
const map = new TileMap({
  scene: scene,
  imgSource: {
    dataType: 'image',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    minLevel: 0,
    maxLevel: 18,
    projectionID: '3857',
    attribution: '© OpenStreetMap',
  },
  minLevel: 2,
  maxLevel: 18,
});

// Update in render loop
scene.registerBeforeRender(() => {
  map.update(camera);
});
```

## API Documentation

### TileMap

Main class for creating and managing tile maps.

#### Constructor

```typescript
new TileMap(params: MapParams)
```

#### Parameters

- `scene`: Babylon.js Scene
- `imgSource`: Image tile source(s)
- `demSource`: (Optional) DEM/terrain source
- `minLevel`: Minimum zoom level
- `maxLevel`: Maximum zoom level
- `lon0`: (Optional) Central meridian (0, 90, -90)
- `bounds`: (Optional) Map bounds [minLon, minLat, maxLon, maxLat]

#### Methods

- `update(camera)`: Update tile tree (call in render loop)
- `geo2world(geo: Vector3)`: Convert lat/lon to world coordinates
- `world2geo(world: Vector3)`: Convert world to lat/lon coordinates

### Loaders

#### registerImgLoader(loader)

Register a custom image tile loader.

#### registerDEMLoader(loader)

Register a custom DEM/terrain loader.

## License

MIT

