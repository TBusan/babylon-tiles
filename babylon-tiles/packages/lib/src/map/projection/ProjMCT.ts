/**
 * @description: Mercator projection (EPSG:3857)
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { Projection } from "./BaseProjection";
import { IProjection } from "./IProjection";

const EarthRad = 6378137; // Earth's radius(m)

/**
 * Mercator projection (Web Mercator, EPSG:3857)
 */
export class ProjMCT extends Projection implements IProjection {
  public readonly ID = "3857"; // projection ID
  public mapWidth = 2 * Math.PI * EarthRad; // E-W scale Earth's circumference(m)
  public mapHeight = this.mapWidth; // S-N scale Earth's circumference(m)
  public mapDepth = 1; // Height scale

  /**
   * Latitude and longitude to projected coordinates
   * @param lon longitude
   * @param lat Latitude
   * @returns projected coordinates
   */
  public project(lon: number, lat: number) {
    const lonRad = (lon - this.lon0) * (Math.PI / 180); // Consider central meridian offset
    const latRad = lat * (Math.PI / 180);
    const x = EarthRad * lonRad;
    const y = EarthRad * Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    return { x, y };
  }

  /**
   * Projected coordinates to latitude and longitude
   * @param x projection x
   * @param y projection y
   * @returns latitude and longitude
   */
  public unProject(x: number, y: number) {
    let lon = (x / EarthRad) * (180 / Math.PI) + this.lon0; // Consider central meridian offset
    if (lon > 180) lon -= 360;
    const latRad = 2 * Math.atan(Math.exp(y / EarthRad)) - Math.PI / 2;
    const lat = latRad * (180 / Math.PI);

    return { lat, lon };
  }
}

