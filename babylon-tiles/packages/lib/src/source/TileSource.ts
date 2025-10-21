/**
 * @description: Tile Source
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { ISource, ProjectionType } from "./ISource";

/**
 * Tile source class
 */
export class TileSource implements ISource {
  public dataType: string;
  public url: string;
  public attribution: string;
  public minLevel: number;
  public maxLevel: number;
  public projectionID: ProjectionType;
  public opacity: number;
  public transparent: boolean;
  public isTMS?: boolean;
  public bounds?: [number, number, number, number];
  public _projectionBounds: [number, number, number, number];

  constructor(options: Partial<ISource> & { url: string; dataType: string }) {
    this.dataType = options.dataType;
    this.url = options.url;
    this.attribution = options.attribution || "";
    this.minLevel = options.minLevel || 0;
    this.maxLevel = options.maxLevel || 18;
    this.projectionID = options.projectionID || "3857";
    this.opacity = options.opacity ?? 1;
    this.transparent = options.transparent ?? false;
    this.isTMS = options.isTMS;
    this.bounds = options.bounds;
    this._projectionBounds = options._projectionBounds || [-180, -85.05112878, 180, 85.05112878];
  }

  /**
   * Get tile URL from x, y, z coordinates
   */
  public getUrl(x: number, y: number, z: number, obj?: { [name: string]: any }): string | undefined {
    let url = this.url;
    
    // Handle TMS scheme
    const tileY = this.isTMS ? Math.pow(2, z) - 1 - y : y;
    
    // Replace placeholders
    url = url.replace(/\{x\}/g, x.toString());
    url = url.replace(/\{y\}/g, tileY.toString());
    url = url.replace(/\{z\}/g, z.toString());
    
    // Handle subdomain
    if (url.includes("{s}")) {
      const subdomains = obj?.subdomains || ["a", "b", "c"];
      const subdomain = subdomains[Math.floor(Math.random() * subdomains.length)];
      url = url.replace(/\{s\}/g, subdomain);
    }
    
    return url;
  }
}

