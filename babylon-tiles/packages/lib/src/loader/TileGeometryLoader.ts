/**
 * @description: Tile Geometry Loader (Flat plane)
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { VertexData } from "@babylonjs/core";
import { ITileGeometryLoader, TileSourceLoadParamsType, ITileLoaderInfo } from "./ITileLoaders";
import { TileLoader } from "./TileLoader";
import { TileGeometry } from "../geometry";

/**
 * Tile geometry loader for loading flat plane geometry
 */
export class TileGeometryLoader extends TileLoader implements ITileGeometryLoader<VertexData> {
  public isMaterialLoader = false as const;
  public dataType = "flat";
  public info: ITileLoaderInfo = this.createInfo("1.0.0", "Babylon Tiles", "Flat plane geometry loader");

  /**
   * Load flat plane geometry
   */
  public async load(params: TileSourceLoadParamsType): Promise<VertexData> {
    const tileGeo = new TileGeometry();
    return tileGeo.vertexData;
  }

  /**
   * Unload geometry
   */
  public unload(geometry: VertexData): void {
    // VertexData doesn't need explicit disposal
  }
}

