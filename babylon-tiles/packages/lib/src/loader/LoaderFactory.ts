/**
 * @description: Loader Factory
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { Material, VertexData } from "@babylonjs/core";
import { ITileMaterialLoader, ITileGeometryLoader } from "./ITileLoaders";

/**
 * Loader factory for managing and registering loaders
 */
export class LoaderFactory {
  private static materialLoaders = new Map<string, ITileMaterialLoader<Material>>();
  private static geometryLoaders = new Map<string, ITileGeometryLoader<VertexData>>();

  /**
   * Register a material loader
   */
  public static registerMaterialLoader(loader: ITileMaterialLoader<Material>): void {
    if (this.materialLoaders.has(loader.dataType)) {
      console.warn(`Material loader for type '${loader.dataType}' already exists, overwriting...`);
    }
    this.materialLoaders.set(loader.dataType, loader);
  }

  /**
   * Register a geometry loader
   */
  public static registerGeometryLoader(loader: ITileGeometryLoader<VertexData>): void {
    if (this.geometryLoaders.has(loader.dataType)) {
      console.warn(`Geometry loader for type '${loader.dataType}' already exists, overwriting...`);
    }
    this.geometryLoaders.set(loader.dataType, loader);
  }

  /**
   * Get a material loader by data type
   */
  public static getMaterialLoader(dataType: string): ITileMaterialLoader<Material> | undefined {
    return this.materialLoaders.get(dataType);
  }

  /**
   * Get a geometry loader by data type
   */
  public static getGeometryLoader(dataType: string): ITileGeometryLoader<VertexData> | undefined {
    return this.geometryLoaders.get(dataType);
  }

  /**
   * Get all registered loaders
   */
  public static getLoaders() {
    return {
      imgLoaders: Array.from(this.materialLoaders.values()),
      demLoaders: Array.from(this.geometryLoaders.values()),
    };
  }

  /**
   * Clear all registered loaders
   */
  public static clear(): void {
    this.materialLoaders.clear();
    this.geometryLoaders.clear();
  }
}

