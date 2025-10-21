/**
 * @description: All exports
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

// Core
export * from "./tile";
// Geometry
export * from "./geometry";
// Loader
export * from "./loader";
// Source
export * from "./source";
// Map
export * from "./map";

import { Material, VertexData } from "@babylonjs/core";
import { ITileGeometryLoader, ITileMaterialLoader, LoaderFactory } from "./loader";

/**
 * Wait for a condition to be met
 * @param conditionFn - Function that returns boolean
 * @param checkInterval - Check interval (milliseconds)
 * @returns Promise that resolves when condition is met
 */
export function waitFor(conditionFn: () => boolean, checkInterval: number = 100): Promise<void> {
  return new Promise((resolve) => {
    const checkCondition = () => {
      if (conditionFn()) {
        resolve();
      } else {
        setTimeout(checkCondition, checkInterval);
      }
    };
    checkCondition();
  });
}

/**
 * Register image loader
 * @param loader Image loader to register
 * @returns Loader
 */
export function registerImgLoader(loader: ITileMaterialLoader) {
  LoaderFactory.registerMaterialLoader(loader);
  return loader;
}

/**
 * Register DEM loader
 * @param loader DEM loader to register
 * @returns Loader
 */
export function registerDEMLoader(loader: ITileGeometryLoader) {
  LoaderFactory.registerGeometryLoader(loader);
  return loader;
}

/**
 * Get image loader
 * @param dataType Data type
 * @returns Loader
 */
export function getImgLoader<T extends ITileMaterialLoader<Material>>(dataType: string) {
  return LoaderFactory.getMaterialLoader(dataType) as T;
}

/**
 * Get DEM loader
 * @param dataType Data type
 * @returns Loader
 */
export function getDEMLoader<T extends ITileGeometryLoader<VertexData>>(dataType: string) {
  return LoaderFactory.getGeometryLoader(dataType) as T;
}

/**
 * Get tile loaders list
 * @returns Loaders list
 */
export function getTileLoaders() {
  return LoaderFactory.getLoaders();
}

// Version info
export const version = "1.0.0";
export const author = {
  name: "Babylon Tiles",
  email: "babylon-tiles@example.com",
};

