/**
 * @description: Tile Geometry
 * @author: Babylon Tiles  
 * @date: 2025-10-21
 */

import { VertexData, VertexBuffer } from "@babylonjs/core";
import { GeometryDataType } from "./GeometryDataTypes";
import { addSkirt } from "./skirt";
import { getGeometryDataFromDem } from "./utils";

/**
 * Tile geometry for Babylon.js
 */
export class TileGeometry {
  public vertexData: VertexData;

  public constructor() {
    // Create default plane geometry
    const data = new Float32Array([0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0]);
    this.vertexData = this.createVertexData(data);
  }

  /**
   * Set attribute data to geometry
   * @param data geometry or DEM data
   * @param skirtHeight skirt height in meters (default: 1000)
   * @returns this
   */
  public setData(data: GeometryDataType | Float32Array, skirtHeight: number = 1000): this {
    let geoData = data instanceof Float32Array ? getGeometryDataFromDem(data) : data;

    // Add a skirt to the geometry
    geoData = addSkirt(geoData.attributes, geoData.indices, skirtHeight);

    this.vertexData = this.createVertexDataFromGeometry(geoData);
    return this;
  }

  /**
   * Create VertexData from geometry data
   */
  private createVertexDataFromGeometry(geoData: GeometryDataType): VertexData {
    const vertexData = new VertexData();
    
    vertexData.positions = Array.from(geoData.attributes.position.value);
    vertexData.indices = Array.from(geoData.indices);
    vertexData.uvs = Array.from(geoData.attributes.texcoord.value);
    vertexData.normals = Array.from(geoData.attributes.normal.value);

    return vertexData;
  }

  /**
   * Create basic vertex data from DEM
   */
  private createVertexData(dem: Float32Array): VertexData {
    const geoData = getGeometryDataFromDem(dem);
    return this.createVertexDataFromGeometry(geoData);
  }
}

