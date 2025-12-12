/**
 * @description: LOD Tile
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { Mesh, TransformNode, Scene, Camera, Vector3, BoundingBox, Matrix } from "@babylonjs/core";
import { ITileLoader } from "../loader/ITileLoaders";

/** Maximum download threads */
const MAXTHREADS = 10;

/** Tile update parameters type */
export type TileUpdateParams = {
  /** Camera */
  camera: Camera;
  /** Tile loader */
  loader: ITileLoader;
  /** Minimum level */
  minLevel: number;
  /** Maximum level */
  maxLevel: number;
  /** Tile LOD threshold */
  LODThreshold: number;
};

/**
 * Dynamic LOD (DLOD) map tile class
 */
export class Tile extends TransformNode {
  /** Tile x coordinate */
  public readonly x: number;
  /** Tile y coordinate */
  public readonly y: number;
  /** Tile zoom level */
  public readonly z: number;

  /** Is this a tile */
  public readonly isTile = true;

  /** Is tile currently loading */
  private _isLoading = false;

  /** Root tile */
  private _root: Tile = this;

  /** Tile check point in world coordinates */
  private _checkPoint: Vector3 = Vector3.Zero();

  /** Tile size in world coordinates */
  private _sizeInWorld = -1;

  /** Tile bounding box (world coordinates) */
  private _bbox: BoundingBox | null = null;

  /** Tile model */
  private _model: Mesh | undefined;
  public get model() {
    return this._model;
  }

  /** Sub tiles */
  private _subTiles: Tile[] | undefined;
  public get subTiles() {
    return this._subTiles;
  }

  /** Distance ratio for LOD evaluation */
  public get distRatio() {
    const distToCamera = Vector3.Distance(this._checkPoint, this._root.getScene().activeCamera!.position);
    const ratio = distToCamera / this._sizeInWorld;
    const finalRatio = this.inFrustum ? ratio * 0.8 : ratio * 2;
    
    return finalRatio;
  }

  /** Is tile in frustum */
  public get inFrustum(): boolean {
    if (!this._bbox || !this._root.getScene().activeCamera) return false;
    
    // TODO: Implement proper frustum culling like Three.js
    // For now, return true to test if this is the issue
    // If we have a model mesh, check it directly
    if (this._model) {
      const result = this._root.getScene().activeCamera!.isInFrustum(this._model);
      if (this.z === 0) {
        console.log(`[Tile inFrustum] Mesh frustum check for tile 0/0/0: ${result}`);
      }
      return result;
    }
    
    // For tiles without model (loading), assume they are in frustum
    if (this.z === 0) {
      console.log(`[Tile inFrustum] No model for tile 0/0/0, returning true`);
    }
    return true;
  }

  /** Implementation of ICullable.isInFrustum for Babylon.js */
  public isInFrustum(frustumPlanes: any): boolean {
    return this.inFrustum;
  }

  /** Implementation of ICullable.isCompletelyInFrustum for Babylon.js */
  public isCompletelyInFrustum(frustumPlanes: any): boolean {
    // For now, we'll use the same logic as isInFrustum
    // This can be refined later for more precise culling
    return this.inFrustum;
  }

  /** Is leaf tile */
  public get isLeaf(): boolean {
    return !this.subTiles;
  }

  /** Get if tile is showing */
  public get showing(): boolean {
    return !!this.model?.isVisible;
  }

  /** Set if tile is showing */
  public set showing(value) {
    if (this.model) {
      this.model.isVisible = value;
      this.model.setEnabled(value);
    }
  }

  // Should update material
  private _updateMaterial = false;
  // Should update geometry
  private _updateGeometry = false;

  private get _needsUpdate(): boolean {
    return !!this.model && (this._updateMaterial || this._updateGeometry);
  }

  /**
   * Constructor
   * @param x - Tile X coordinate, default: 0
   * @param y - Tile Y coordinate, default: 0
   * @param z - Tile zoom level, default: 0
   * @param scene - Babylon scene
   */
  public constructor(x = 0, y = 0, z = 0, scene?: Scene) {
    super(`Tile ${z}-${x}-${y}`, scene);
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /**
   * Compute tile size, checkpoint, bbox
   */
  private computeTileSize(debug: number) {
    // Tile bounding box - world coordinates
    const min = new Vector3(-0.5, -0.5, -300);
    const max = new Vector3(0.5, 0.5, 9000);
    this._bbox = new BoundingBox(min, max, this.getWorldMatrix());

    // Distance check point - tile center world coordinate
    this._checkPoint = Vector3.TransformCoordinates(Vector3.Zero(), this.getWorldMatrix());

    // Tile size - diagonal length
    const size = max.subtract(min);
    this._sizeInWorld = size.length();

    return this._sizeInWorld;
  }

  /**
   * Tile update, called in each frame
   * @param params Tile load parameters
   */
  public update(params: TileUpdateParams) {
    // Don't update if no parent or currently loading
    if (!this.parent || this._isLoading) {
      if (this.z === 0 && this._isLoading) {
        console.log(`[Tile] Skipping update for tile 0/0/0 - isLoading=true`);
      }
      return;
    }

    // Set root tile
    if (this.parent instanceof Tile) {
      this._root = this.parent._root;
    }

    const { loader, minLevel, camera } = params;

    // Compute tile size, bounding box
    if (this._sizeInWorld < 0) {
      this.computeTileSize(loader.debug);
    }

    // Download or update tile
    if (this.z >= minLevel && loader.downloadingThreads < MAXTHREADS) {
      // Download tile
      if (!this.model) {
        console.log(`[Tile] Starting load for tile ${this.z}/${this.x}/${this.y}`);
        this._startLoad(loader);
        return;
      }

      // Update dirty tile
      if (this._needsUpdate && this.inFrustum) {
        const childrenUpdated = !this.subTiles?.some((child) => child._needsUpdate);
        if (childrenUpdated) {
          this._startUpdate(loader);
          return;
        }
      }
    }

    // Log when reaching LOD for root tile
    if (this.z === 0) {
      console.log(`[Tile] Reached LOD check for tile 0/0/0, hasModel=${!!this.model}`);
    }

    // LOD
    this.LOD(params);

    // Recursively update sub tiles
    this.subTiles?.forEach((child) => child.update(params));
  }

  /**
   * LOD (Level of Detail)
   */
  protected LOD(params: TileUpdateParams) {
    const { loader, minLevel, maxLevel, LODThreshold } = params;
    
    // Get values before logging
    const currentDistRatio = this.distRatio;
    const currentInFrustum = this.inFrustum;
    const shouldCreate = this.z < maxLevel && currentDistRatio < LODThreshold && currentInFrustum;
    
    // Debug LOD conditions for root tile - log every time
    if (this.z === 0) {
      console.log(`[Tile LOD] z=${this.z}, distRatio=${currentDistRatio.toFixed(2)}, LODThreshold=${LODThreshold}, inFrustum=${currentInFrustum}, maxLevel=${maxLevel}, hasModel=${!!this.model}, hasSubTiles=${!!this.subTiles}`);
      console.log(`[Tile LOD] Should create children: ${shouldCreate}`);
    }
    
    // Simplified LOD evaluation
    if (shouldCreate) {
      // Create children
      if (!this.subTiles) {
        console.log(`[Tile LOD] Creating children for tile ${this.z}/${this.x}/${this.y}`);
        this._subTiles = this.createChildren(loader);
      }
    } else if (this.z > minLevel && currentDistRatio > LODThreshold * 2) {
      // Remove children
      if (this.subTiles) {
        this.subTiles.forEach((child) => child.unLoad(loader, true));
        this._subTiles = undefined;
        this.showing = true;
      }
    }
  }

  /**
   * Create child tiles
   */
  private createChildren(loader: ITileLoader): Tile[] {
    const children: Tile[] = [];
    const nextZ = this.z + 1;
    const baseX = this.x * 2;
    const baseY = this.y * 2;

    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const child = new Tile(baseX + dx, baseY + dy, nextZ, this.getScene());
        child.parent = this;
        child.position.set((dx - 0.5) * 0.5, (dy - 0.5) * 0.5, 0);
        child.scaling.set(0.5, 0.5, 1);
        children.push(child);
      }
    }

    return children;
  }

  /**
   * Check if 4 sibling tiles are all loaded
   */
  private _checkVisible() {
    const parent = this.parent;
    if (parent instanceof Tile) {
      if (parent.model) {
        const subTiles = parent.subTiles;
        if (subTiles) {
          const allLoaded = !subTiles.some((child) => !child.model);
          subTiles.forEach((child) => (child.showing = allLoaded));
          parent.showing = !allLoaded;
        }
      } else {
        this.showing = true;
      }
    }
    return this;
  }

  /**
   * Download tile data
   */
  private async _startLoad(loader: ITileLoader) {
    this._isLoading = true;
    console.log(`[Tile] Calling loader.load for tile ${this.z}/${this.x}/${this.y}`);
    this._model = await loader.load(this);
    console.log(`[Tile] Loaded model for tile ${this.z}/${this.x}/${this.y}`, this._model);
    this._model.parent = this;
    this.isLeaf && this._checkVisible();
    this._isLoading = false;
  }

  /**
   * Update tile data
   */
  private async _startUpdate(loader: ITileLoader) {
    if (!this.model) {
      return;
    }
    this._isLoading = true;
    this._model = await loader.update(this.model, this, this._updateMaterial, this._updateGeometry);
    this._updateMaterial = false;
    this._updateGeometry = false;
    this._isLoading = false;
  }

  /**
   * Update tile data
   */
  public updateData(updateMaterial: boolean, updateGeometry: boolean) {
    this.getDescendants().forEach((child) => {
      if (child instanceof Tile && (child.model || child._isLoading)) {
        child._updateMaterial = updateMaterial;
        child._updateGeometry = updateGeometry;
      }
    });
    return this;
  }

  /**
   * Reload tile tree
   */
  public reload(loader: ITileLoader) {
    return this.unLoad(loader, true);
  }

  /**
   * Unload tile (including sub tiles), release resources
   */
  public unLoad(loader: ITileLoader, unLoadSelf = true) {
    // Unload sub tiles
    if (this.subTiles) {
      this.subTiles.forEach((child) => {
        child.unLoad(loader, true);
      });
      this._subTiles = undefined;
    }
    // Unload self
    if (unLoadSelf && this.model) {
      loader.unload(this.model);
      this._model = undefined;
    }
    return this;
  }
}

