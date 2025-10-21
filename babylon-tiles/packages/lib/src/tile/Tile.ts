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
    return this.inFrustum ? ratio * 0.8 : ratio * 2;
  }

  /** Is tile in frustum */
  public get inFrustum(): boolean {
    if (!this._bbox || !this._root.getScene().activeCamera) return false;
    return this._root.getScene().activeCamera!.isInFrustum(this._model || this);
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

  private get _isDirty(): boolean {
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
        this._startLoad(loader);
        return;
      }

      // Update dirty tile
      if (this._isDirty && this.inFrustum) {
        const childrenUpdated = !this.subTiles?.some((child) => child._isDirty);
        if (childrenUpdated) {
          this._startUpdate(loader);
          return;
        }
      }
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
    
    // Simplified LOD evaluation
    if (this.z < maxLevel && this.distRatio < LODThreshold && this.inFrustum) {
      // Create children
      if (!this.subTiles) {
        this._subTiles = this.createChildren(loader);
      }
    } else if (this.z > minLevel && this.distRatio > LODThreshold * 2) {
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
    this._model = await loader.load(this);
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

