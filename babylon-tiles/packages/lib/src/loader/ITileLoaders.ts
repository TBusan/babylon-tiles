/**
 * Tile loader interfaces
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { Mesh, Material, VertexData } from "@babylonjs/core";
import { ISource } from "../source";
import { TileLoadingManager } from "./TileLoadingManager";
import type { IProjection } from "../map/projection";

export type BoundsType = [number, number, number, number];

/**
 * Tile coordinates type
 */
export type TileCoords = {
  /** Tile X coordinate */
  x: number;
  /** Tile Y coordinate */
  y: number;
  /** Tile Z coordinate (zoom level) */
  z: number;
};

/**
 * Tile load parameters type, includes tile projection bounds and lat/lon bounds
 */
export type TileLoadParamsType = TileCoords & {
  /** Tile projection bounds (or clip bounds) */
  bounds: BoundsType;
  /** Tile lat/lon bounds */
  lonLatBounds?: BoundsType;
};

/**
 * Tile load parameters with source
 */
export type TileSourceLoadParamsType<TSource extends ISource = ISource> = TileLoadParamsType & {
  /** Tile data source */
  source: TSource;
};

/**
 * Tile load parameters with clip bounds
 */
export type TileLoadClipParamsType<TSource extends ISource = ISource> = TileSourceLoadParamsType<TSource> & {
  clipBounds: [number, number, number, number];
};

/**
 * Tile loader interface
 */
export interface ITileLoader {
  /** Number of downloading threads */
  downloadingThreads: number;
  /** Debug level */
  debug: number;
  /** Tile loading manager */
  manager: TileLoadingManager;
  /** Image data sources */
  imgSource: ISource[];
  /** DEM data source */
  demSource: ISource | undefined;
  /** Projection ID */
  projectionID: string;
  /** Map projection */
  projection: IProjection;
  /** Map background material */
  backgroundMaterial: Material;
  /** Lat/lon bounds */
  bounds: BoundsType;
  /** Load tile data */
  load(params: TileCoords): Promise<Mesh>;
  /** Unload tile model */
  unload(tileMesh: Mesh): void;
  /** Update tile data */
  update(tileMesh: Mesh, params: TileCoords, updateMaterial: boolean, updateGeometry: boolean): Promise<Mesh>;
}

/**
 * Loader metadata type
 */
export type ITileLoaderInfo = {
  /** Loader version */
  version: string;
  /** Loader author */
  author?: string;
  /** Loader description */
  description?: string;
};

/**
 * Tile material loader interface, used to load tile images
 */
export interface ITileMaterialLoader<TMaterial extends Material = Material> {
  isMaterialLoader?: true;
  /** Loader info */
  info: ITileLoaderInfo;
  /** Data type identifier */
  dataType: string;
  /** Load image data */
  load(params: TileSourceLoadParamsType): Promise<TMaterial>;
  /** Unload material data */
  unload?(material: TMaterial): void;
}

/**
 * Tile geometry loader interface, used to load tile terrain
 */
export interface ITileGeometryLoader<TGeometry extends VertexData = VertexData> {
  isMaterialLoader?: false;
  /** Loader info */
  info: ITileLoaderInfo;
  /** Data type identifier */
  dataType: string;
  /** Load terrain data */
  load(params: TileSourceLoadParamsType): Promise<TGeometry>;
  /** Unload geometry data */
  unload?(geometry: TGeometry): void;
}

