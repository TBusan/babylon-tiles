/**
 * @description: Tile Map Loader
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { Mesh, StandardMaterial, Color3, Scene, VertexData } from "@babylonjs/core";
import { ISource } from "../source";
import { ITileLoader, TileCoords, BoundsType } from "./ITileLoaders";
import { TileLoadingManager } from "./TileLoadingManager";
import { IProjection, ProjectFactory } from "../map/projection";
import { LoaderFactory } from "./LoaderFactory";
import { TileGeometry } from "../geometry";

/**
 * Tile map loader
 */
export class TileMapLoader implements ITileLoader {
  public manager: TileLoadingManager;
  public imgSource: ISource[];
  public demSource: ISource | undefined;
  public projection: IProjection;
  public backgroundMaterial: StandardMaterial;
  public bounds: BoundsType = [-180, -90, 180, 90];
  public debug = 0;

  private _downloadingThreads = 0;

  public get downloadingThreads(): number {
    return this._downloadingThreads;
  }

  public get projectionID(): string {
    return this.projection.ID;
  }

  constructor() {
    this.manager = new TileLoadingManager();
    this.imgSource = [];
    this.projection = ProjectFactory.createFromID("3857");
    this.backgroundMaterial = new StandardMaterial("background");
    this.backgroundMaterial.diffuseColor = new Color3(0.5, 0.5, 0.5);
  }

  /**
   * Load tile data
   */
  public async load(params: TileCoords): Promise<Mesh> {
    this._downloadingThreads++;

    try {
      // Create mesh
      const mesh = new Mesh(`tile-${params.z}-${params.x}-${params.y}`);

      // Load geometry
      const geometry = await this.loadGeometry(params);
      if (geometry) {
        geometry.applyToMesh(mesh);
      }

      // Load material
      const material = await this.loadMaterial(params);
      if (material) {
        mesh.material = material;
      } else {
        mesh.material = this.backgroundMaterial;
      }

      return mesh;
    } finally {
      this._downloadingThreads--;
    }
  }

  /**
   * Load tile geometry
   */
  private async loadGeometry(params: TileCoords): Promise<VertexData | null> {
    if (!this.demSource) {
      // Return flat plane geometry
      const tileGeo = new TileGeometry();
      return tileGeo.vertexData;
    }

    const bounds = this.projection.getProjBoundsFromXYZ(params.x, params.y, params.z);
    const lonLatBounds = this.projection.getLonLatBoundsFromXYZ(params.x, params.y, params.z);

    const loader = LoaderFactory.getGeometryLoader(this.demSource.dataType);
    if (!loader) {
      console.warn(`No geometry loader found for type: ${this.demSource.dataType}`);
      const tileGeo = new TileGeometry();
      return tileGeo.vertexData;
    }

    try {
      const vertexData = await loader.load({
        ...params,
        source: this.demSource,
        bounds,
        lonLatBounds,
      });
      return vertexData;
    } catch (error) {
      console.error("Failed to load geometry:", error);
      const tileGeo = new TileGeometry();
      return tileGeo.vertexData;
    }
  }

  /**
   * Load tile material
   */
  private async loadMaterial(params: TileCoords): Promise<StandardMaterial | null> {
    if (this.imgSource.length === 0) {
      return null;
    }

    const source = this.imgSource[0];
    const bounds = this.projection.getProjBoundsFromXYZ(params.x, params.y, params.z);
    const lonLatBounds = this.projection.getLonLatBoundsFromXYZ(params.x, params.y, params.z);

    const loader = LoaderFactory.getMaterialLoader(source.dataType);
    if (!loader) {
      console.warn(`No material loader found for type: ${source.dataType}`);
      return null;
    }

    try {
      const material = await loader.load({
        ...params,
        source,
        bounds,
        lonLatBounds,
      });
      return material as StandardMaterial;
    } catch (error) {
      console.error("Failed to load material:", error);
      return null;
    }
  }

  /**
   * Unload tile model
   */
  public unload(tileMesh: Mesh): void {
    if (tileMesh.material) {
      tileMesh.material.dispose();
    }
    if (tileMesh.geometry) {
      tileMesh.geometry.dispose();
    }
    tileMesh.dispose();
  }

  /**
   * Update tile data
   */
  public async update(
    tileMesh: Mesh,
    params: TileCoords,
    updateMaterial: boolean,
    updateGeometry: boolean
  ): Promise<Mesh> {
    if (updateGeometry) {
      const geometry = await this.loadGeometry(params);
      if (geometry) {
        geometry.applyToMesh(tileMesh);
      }
    }

    if (updateMaterial) {
      const material = await this.loadMaterial(params);
      if (material) {
        if (tileMesh.material) {
          tileMesh.material.dispose();
        }
        tileMesh.material = material;
      }
    }

    return tileMesh;
  }
}

