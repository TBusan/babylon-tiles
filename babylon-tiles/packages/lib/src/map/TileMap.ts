/**
 * @description: Tile Map for Babylon.js
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { TransformNode, Scene, Camera, Vector3, Color3, Matrix } from "@babylonjs/core";
import { ISource } from "../source";
import { Tile } from "../tile";
import { ITileLoader } from "../loader/ITileLoaders";
import { IProjection, ProjectFactory } from "./projection";
import { TileMapLoader } from "./TileMapLoader";

/** Map projection center longitude type */
type ProjectCenterLongitude = 0 | 90 | -90;

/** Map creation parameters */
export type MapParams = {
  debug?: number; // Debug mode: 0: off, 1: on, 2: show tile box
  loader?: TileMapLoader; // Map data loader
  rootTile?: Tile; // Root tile
  imgSource: ISource[] | ISource; // Image source
  demSource?: ISource; // Terrain source
  backgroundColor?: Color3; // Background color
  bounds?: [number, number, number, number]; // Map lat/lon bounds
  minLevel?: number; // Minimum zoom level
  maxLevel?: number; // Maximum zoom level
  lon0?: ProjectCenterLongitude; // Projection center longitude
  scene: Scene; // Babylon scene
};

/**
 * Tile map model
 */
export class TileMap extends TransformNode {
  /** Name */
  public readonly name = "map";

  /** Map auto update flag */
  public autoUpdate = true;

  /** Debug flag */
  public debug = 0;

  /** Tile tree update interval (ms) */
  public updateInterval = 100;

  /** Root tile */
  public readonly rootTile: Tile;

  /** Tile data loader */
  public readonly loader: ITileLoader;

  /** Babylon scene */
  public readonly scene: Scene;

  private _minLevel = 2;
  /** Get map minimum zoom level */
  public get minLevel() {
    return this._minLevel;
  }
  /** Set map minimum zoom level */
  public set minLevel(value: number) {
    this._minLevel = value;
  }

  private _maxLevel = 19;
  /** Get map maximum zoom level */
  public get maxLevel() {
    return this._maxLevel;
  }
  /** Set map maximum zoom level */
  public set maxLevel(value: number) {
    this._maxLevel = value;
  }

  /** Get central meridian longitude */
  public get lon0() {
    return this.projection.lon0;
  }

  /** Set central meridian longitude */
  public set lon0(value) {
    if (this.projection.lon0 !== value) {
      this.projection = ProjectFactory.createFromID(this.projection.ID, value);
      this.updateSource();
    }
  }

  /** Get map projection */
  public get projection(): IProjection {
    return this.loader.projection;
  }

  /** Set map projection */
  private set projection(proj: IProjection) {
    if (proj.ID != this.projection.ID || proj.lon0 != this.lon0) {
      this.loader.projection = proj;
      this._resize();
      this.reload();
    }
  }

  /** Get image data sources */
  public get imgSource(): ISource[] {
    return this.loader.imgSource;
  }

  /** Set image data sources */
  public set imgSource(value: ISource | ISource[]) {
    const sources = Array.isArray(value) ? value : [value];
    if (sources.length === 0) {
      throw new Error("imgSource cannot be empty");
    }
    this.projection = ProjectFactory.createFromID(sources[0].projectionID, this.projection.lon0);
    this.loader.imgSource = sources;
    this.updateSource(true, false);
  }

  /** Get terrain data source */
  public get demSource(): ISource | undefined {
    return this.loader.demSource;
  }

  /** Set terrain data source */
  public set demSource(value: ISource | undefined) {
    this.loader.demSource = value;
    this.updateSource(false, true);
  }

  private _LODThreshold = 1;
  /** Get LOD threshold */
  public get LODThreshold() {
    return this._LODThreshold;
  }
  /** Set LOD threshold */
  public set LODThreshold(value) {
    this._LODThreshold = value;
  }

  /** Get map lat/lon bounds */
  public get bounds() {
    return this.loader.bounds;
  }
  /** Set map lat/lon bounds */
  public set bounds(value) {
    this.loader.bounds = value;
  }

  /**
   * Map creation factory function
   */
  public static create(params: MapParams) {
    return new TileMap(params);
  }

  /**
   * Map model constructor
   */
  public constructor(params: MapParams) {
    super("map", params.scene);
    
    const {
      loader = new TileMapLoader(),
      rootTile = new Tile(0, 0, 0, params.scene),
      minLevel = 2,
      maxLevel = 20,
      imgSource,
      demSource,
      bounds,
      lon0 = 0,
      debug = 0,
      scene,
    } = params;

    this.scene = scene;
    this._minLevel = minLevel;
    this._maxLevel = maxLevel;

    this.loader = loader;
    this.rootTile = rootTile;
    this.rootTile.parent = this;

    bounds && (this.loader.bounds = bounds);
    this.debug = this.loader.debug = debug;
    this.lon0 = lon0;

    this.imgSource = Array.isArray(imgSource) ? imgSource : [imgSource];
    this.demSource = demSource;

    this._resize();
  }

  private _resize() {
    // Stretch map to projection size
    this.rootTile.scaling.set(this.projection.mapWidth, this.projection.mapHeight, this.projection.mapDepth);
    this.rootTile.computeWorldMatrix(true);
  }

  /**
   * Model update callback, called every frame
   */
  public update(camera: Camera) {
    if (this.autoUpdate) {
      this.rootTile.update({
        camera,
        loader: this.loader,
        minLevel: this.minLevel,
        maxLevel: this.maxLevel,
        LODThreshold: this.LODThreshold,
      });
    }
  }

  /**
   * Reload map data
   */
  public updateSource(updateMaterial = true, updateGeometry = true) {
    this.rootTile.updateData(updateMaterial, updateGeometry);
  }

  /**
   * Destroy all tiles and reload
   */
  public reload() {
    this.rootTile.reload(this.loader);
  }

  /**
   * Release map resources and remove from scene
   */
  public dispose() {
    this.reload();
    super.dispose();
  }

  /**
   * Geographic coordinates to map model coordinates
   */
  public geo2map(geo: Vector3) {
    const pos = this.projection.project(geo.x, geo.y);
    return new Vector3(pos.x, pos.y, geo.z);
  }

  /**
   * Geographic coordinates to world coordinates
   */
  public geo2world(geo: Vector3) {
    const mapPos = this.geo2map(geo);
    return Vector3.TransformCoordinates(mapPos, this.getWorldMatrix());
  }

  /**
   * Map model coordinates to geographic coordinates
   */
  public map2geo(pos: Vector3) {
    const position = this.projection.unProject(pos.x, pos.y);
    return new Vector3(position.lon, position.lat, pos.z);
  }

  /**
   * World coordinates to geographic coordinates
   */
  public world2geo(world: Vector3) {
    const localPos = Vector3.TransformCoordinates(world, Matrix.Invert(this.getWorldMatrix()));
    return this.map2geo(localPos);
  }

  /**
   * Get current downloading tile count
   */
  public get downloading() {
    return this.loader.downloadingThreads;
  }
}

