/**
 * @description: Map sources
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { TileSource } from "babylon-tile";

/**
 * ArcGIS World Imagery source
 */
export const arcGisImgSource = new TileSource({
  dataType: "image",
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "© Esri",
  minLevel: 0,
  maxLevel: 18,
  projectionID: "3857",
});

/**
 * ArcGIS World Terrain source
 */
export const arcGisDemSource = new TileSource({
  dataType: "terrain-rgb",
  url: "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer/tile/{z}/{y}/{x}",
  attribution: "© Esri",
  minLevel: 0,
  maxLevel: 13,
  projectionID: "3857",
});

/**
 * OpenStreetMap source
 */
export const osmSource = new TileSource({
  dataType: "image",
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors",
  minLevel: 0,
  maxLevel: 18,
  projectionID: "3857",
});

/**
 * Mapbox Satellite source (requires API key)
 */
export function createMapboxSatellite(accessToken: string) {
  return new TileSource({
    dataType: "image",
    url: `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.png?access_token=${accessToken}`,
    attribution: "© Mapbox",
    minLevel: 0,
    maxLevel: 18,
    projectionID: "3857",
  });
}

