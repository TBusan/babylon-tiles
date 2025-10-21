/**
 * @description: Base projection class
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { IProjection, ProjectionType } from "./IProjection";

/**
 * Base projection class
 */
export abstract class Projection implements IProjection {
  public abstract readonly ID: ProjectionType;
  public abstract readonly mapWidth: number;
  public abstract readonly mapHeight: number;
  public abstract readonly mapDepth: number;
  
  public lon0: number;

  constructor(lon0: number = 0) {
    this.lon0 = lon0;
  }

  public abstract project(lon: number, lat: number): { x: number; y: number };
  public abstract unProject(x: number, y: number): { lon: number; lat: number };

  /**
   * Get tile X coordinate considering central meridian offset
   */
  public getTileXWithCenterLon(x: number, z: number): number {
    const numTiles = Math.pow(2, z);
    let tileX = x;
    
    if (this.lon0 === 90) {
      tileX = x - numTiles / 4;
    } else if (this.lon0 === -90) {
      tileX = x + numTiles / 4;
    }
    
    // Handle wrap around
    if (tileX < 0) tileX += numTiles;
    if (tileX >= numTiles) tileX -= numTiles;
    
    return tileX;
  }

  /**
   * Get projection bounds from lat/lon bounds
   */
  public getProjBoundsFromLonLat(bounds: [number, number, number, number]): [number, number, number, number] {
    const [minLon, minLat, maxLon, maxLat] = bounds;
    const min = this.project(minLon, minLat);
    const max = this.project(maxLon, maxLat);
    return [min.x, min.y, max.x, max.y];
  }

  /**
   * Get projection bounds from tile XYZ
   */
  public getProjBoundsFromXYZ(x: number, y: number, z: number): [number, number, number, number] {
    const numTiles = Math.pow(2, z);
    const tileSize = this.mapWidth / numTiles;
    
    const minX = -this.mapWidth / 2 + x * tileSize;
    const maxX = minX + tileSize;
    const maxY = this.mapHeight / 2 - y * tileSize;
    const minY = maxY - tileSize;
    
    return [minX, minY, maxX, maxY];
  }

  /**
   * Get lat/lon bounds from tile XYZ
   */
  public getLonLatBoundsFromXYZ(x: number, y: number, z: number): [number, number, number, number] {
    const [minX, minY, maxX, maxY] = this.getProjBoundsFromXYZ(x, y, z);
    const min = this.unProject(minX, minY);
    const max = this.unProject(maxX, maxY);
    return [min.lon, min.lat, max.lon, max.lat];
  }
}

