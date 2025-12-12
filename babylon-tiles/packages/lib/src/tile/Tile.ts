/**
 * @description: LOD Tile
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { Mesh, TransformNode, Scene, Camera, Vector3, BoundingBox, Matrix, Plane, BoundingInfo } from "@babylonjs/core";
import { ITileLoader } from "../loader/ITileLoaders";

/** Maximum download threads */
const MAXTHREADS = 10;

/** Camera world position (shared across all tiles) */
const cameraWorldPosition = new Vector3();

/** Camera reference (updated once per frame at root tile) */
let currentCamera: Camera | null = null;

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
  
  /** Get root tile (for internal use) */
  protected get rootTile(): Tile {
    return this._root;
  }

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
    // Use cameraWorldPosition (updated in root tile's update) instead of camera.position directly
    // Matching three-tile: cameraWorldPosition.distanceTo(this._checkPoint)
    const distToCamera = Vector3.Distance(this._checkPoint, cameraWorldPosition);
    
    // Ensure _sizeInWorld is valid
    if (this._sizeInWorld <= 0) {
      console.warn(`[Tile distRatio] Invalid _sizeInWorld: ${this._sizeInWorld} for tile ${this.z}/${this.x}/${this.y}`);
      return Infinity;
    }
    
    const ratio = distToCamera / this._sizeInWorld;
    const finalRatio = this.inFrustum ? ratio * 0.8 : ratio * 2;
    
    // Debug for root tile
    if (this.z === 0 && Math.abs(finalRatio) < 0.01) {
      console.log(`[Tile distRatio] Debug for root tile:`, {
        distToCamera: distToCamera.toFixed(2),
        sizeInWorld: this._sizeInWorld.toFixed(2),
        ratio: ratio.toFixed(6),
        inFrustum: this.inFrustum,
        finalRatio: finalRatio.toFixed(6),
        checkPoint: this._checkPoint.asArray(),
        cameraPos: cameraWorldPosition.asArray()
      });
    }
    
    return finalRatio;
  }

  /** Is tile in frustum */
  public get inFrustum(): boolean {
    // If no bounding box, cannot determine (should not happen after computeTileSize)
    if (!this._bbox) {
      return false;
    }
    
    // If camera not set yet, assume in frustum (for initial load)
    if (!currentCamera) {
      return true;
    }
    
    // In Babylon.js, use camera.isInFrustum() with BoundingInfo
    // Create a BoundingInfo from the bounding box
    const boundingInfo = new BoundingInfo(this._bbox.minimum, this._bbox.maximum);
    return currentCamera.isInFrustum(boundingInfo);
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
    
    // In Three.js, up.set(0, 0, 1) rotates tiles to XZ plane (Z-axis up)
    // In Babylon.js, tiles inherit rotation from parent TileMap, so no need to rotate here
    // But we ensure matrix is computed
    this.computeWorldMatrix(true);
  }

  /**
   * Compute tile size, checkpoint, bbox
   * Matches three-tile's computeTileSize logic
   */
  private computeTileSize(debug: number) {
    // Create local bounding box (matching three-tile: new Box3(new Vector3(-0.5, -0.5), new Vector3(0.5, 0.5)))
    const localMin = new Vector3(-0.5, -0.5, -300);
    const localMax = new Vector3(0.5, 0.5, 9000);
    
    // Transform to world coordinates (matching three-tile: .applyMatrix4(this.matrixWorld))
    const worldMatrix = this.getWorldMatrix();
    const worldMin = Vector3.TransformCoordinates(localMin, worldMatrix);
    const worldMax = Vector3.TransformCoordinates(localMax, worldMatrix);
    
    // Create world bounding box
    this._bbox = new BoundingBox(worldMin, worldMax);

    // Distance check point - tile center world coordinate (matching three-tile)
    // Note: _checkPoint.y will be updated in _startLoad to the geometry's max height
    const centerWorld = Vector3.TransformCoordinates(Vector3.Zero(), worldMatrix);
    this._checkPoint.x = centerWorld.x;
    this._checkPoint.z = centerWorld.z;
    // Preserve y if already set (from geometry), otherwise use center y
    if (this._checkPoint.y === 0 && this._model) {
      // If y is still 0 and we have a model, use center y for now
      // It will be updated in _startLoad with the actual geometry max height
      this._checkPoint.y = centerWorld.y;
    }

    // Tile size - diagonal length in world coordinates (matching three-tile: this._bbox.getSize(tempVec3).length())
    const worldSize = worldMax.subtract(worldMin);
    this._sizeInWorld = worldSize.length();
    
    // Assert that size is reasonable (matching three-tile: console.assert(this._sizeInWorld > 10))
    if (this._sizeInWorld <= 10) {
      console.warn(`[Tile] Tile size too small: ${this._sizeInWorld} for tile ${this.z}/${this.x}/${this.y}`);
    }
    
    // Debug log for root tile to verify size calculation
    if (this.z === 0) {
      console.log(`[Tile computeTileSize] Root tile ${this.z}/${this.x}/${this.y}:`, {
        localSize: '1.0 (from -0.5 to 0.5)',
        worldMin: worldMin.asArray(),
        worldMax: worldMax.asArray(),
        worldSize: worldSize.asArray(),
        sizeInWorld: this._sizeInWorld,
        scaling: this.scaling.asArray(),
        worldMatrix: worldMatrix.m.slice(0, 4) // First row of matrix
      });
    }

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

    // Set root tile (matching three-tile logic)
    if (this.parent instanceof Tile) {
      this._root = this.parent._root;
    }
    // Root tile should have z=0 (assertion matching three-tile)
    if (this._root.z !== 0) {
      console.warn(`[Tile] Root tile should have z=0, but got z=${this._root.z}`);
    }

    const { loader, minLevel, camera } = params;

    // If root tile, store camera reference and position once per frame
    // Matching three-tile: if (this.z === 0) { camera.getWorldPosition(cameraWorldPosition); frustum.setFromProjectionMatrix(...); }
    // In Babylon.js, we use camera.position directly and store camera reference for frustum checks
    if (this.z === 0) {
      cameraWorldPosition.copyFrom(camera.position);
      currentCamera = camera;
    }

    // Compute tile size, bounding box (matching three-tile: must compute before checking inFrustum)
    if (this._sizeInWorld < 0) {
      this.computeTileSize(loader.debug);
    }

    // Download or update tile (only if in frustum or at min level)
    // Matching three-tile: if (this.z >= minLevel && loader.downloadingThreads < MAXTHREADS)
    // Note: three-tile doesn't check inFrustum in shouldLoad condition, only checks downloadingThreads
    // The frustum check is done in LOD logic, not in loading logic
    const shouldLoad = this.z >= minLevel && loader.downloadingThreads < MAXTHREADS;
    
    // Debug for child tiles to understand why they're not loading
    if (this.z > 0 && !this.model && this.parent instanceof Tile) {
      console.log(`[Tile update] Child tile ${this.z}/${this.x}/${this.y} shouldLoad check:`, {
        z: this.z,
        minLevel: minLevel,
        zGteMinLevel: this.z >= minLevel,
        downloadingThreads: loader.downloadingThreads,
        maxThreads: MAXTHREADS,
        inFrustum: this.inFrustum,
        zLteMinLevel: this.z <= minLevel,
        shouldLoad: shouldLoad,
        sizeInWorld: this._sizeInWorld,
        hasBbox: !!this._bbox
      });
    }
    
    if (shouldLoad) {
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
   * Matches three-tile's LODEvaluate logic exactly
   */
  protected LOD(params: TileUpdateParams) {
    const { loader, minLevel, maxLevel, LODThreshold } = params;
    
    const currentDistRatio = this.distRatio;
    const currentInFrustum = this.inFrustum;
    
    // Match three-tile's LODEvaluate logic exactly
    // 1. Remove if not leaf and z > maxLevel
    if (!this.isLeaf && this.z > maxLevel) {
      if (this.subTiles) {
        this.subTiles.forEach((child) => child.unLoad(loader, true));
        this._subTiles = undefined;
        this.showing = true;
      }
      return;
    }
    
    // 2. Create children if leaf and conditions met
    // Matching three-tile's LODEvaluate exactly:
    // tile.isLeaf && tile.inFrustum && tile.z < maxLevel && distRatio < threshold && (tile.showing || tile.z <= minLevel)
    const shouldCreate = this.isLeaf && 
                         currentInFrustum && 
                         this.z < maxLevel && 
                         currentDistRatio < LODThreshold && 
                         (this.showing || this.z <= minLevel);
    
    // Debug LOD conditions for root tile
    if (this.z === 0) {
      const distToCamera = Vector3.Distance(this._checkPoint, cameraWorldPosition);
      console.log(`[Tile LOD] z=${this.z}, distRatio=${currentDistRatio.toFixed(6)}, LODThreshold=${LODThreshold}, inFrustum=${currentInFrustum}, maxLevel=${maxLevel}, hasModel=${!!this.model}, hasSubTiles=${!!this.subTiles}, showing=${this.showing}, isLeaf=${this.isLeaf}`);
      console.log(`[Tile LOD] Camera distance: ${distToCamera.toFixed(2)}, tile size: ${this._sizeInWorld.toFixed(2)}, distRatio: ${currentDistRatio.toFixed(6)}`);
      console.log(`[Tile LOD] Should create children: ${shouldCreate}, breakdown:`, {
        isLeaf: this.isLeaf,
        inFrustum: currentInFrustum,
        zLessThanMaxLevel: this.z < maxLevel,
        distRatioLessThanThreshold: currentDistRatio < LODThreshold,
        showingOrZLeMinLevel: (this.showing || this.z <= minLevel),
        showing: this.showing,
        z: this.z,
        minLevel: minLevel
      });
    }
    
    if (shouldCreate) {
      // Create children
      if (!this.subTiles) {
        console.log(`[Tile LOD] Creating children for tile ${this.z}/${this.x}/${this.y}`);
        const newTiles = this.createChildren(loader);
        this._subTiles = newTiles;
        // In three-tile: this.add(...newTiles) and child.updateMatrixWorld()
        // In Babylon.js: parent is set in createChildren, and computeWorldMatrix is called
        // Ensure children are ready for update
        newTiles.forEach(child => {
          // Set root reference for children (matching three-tile behavior)
          // In three-tile, root is set in update() when parent instanceof Tile
          // But we need to set it here for immediate use
          if (child.parent instanceof Tile) {
            (child as any)._root = this._root;
          }
          console.log(`[Tile LOD] Created child tile ${child.z}/${child.x}/${child.y}, parent=${child.parent?.name}`);
        });
        
        // Update visibility after creating children
        // Root tile should hide when children are created (will show again when children are loaded)
        if (this.model) {
          this.showing = false; // Hide parent when children are created
        }
        
        // Note: In three-tile, children are updated in the recursive call at the end of update()
        // We don't immediately update children here - they will be updated in the recursive loop
        // This matches three-tile's behavior: child.updateMatrixWorld() is called, but not child.update()
      }
    } 
    // 3. Remove children if not leaf and conditions met (matching three-tile logic exactly)
    else if (!this.isLeaf && this.z >= minLevel && currentDistRatio > LODThreshold) {
      // Match three-tile: if (this.model) { this.showing = true; this.unLoad(loader, false); }
      if (this.subTiles) {
        if (this.model) {
          this.showing = true;
        }
        // unLoad(loader, false) means unload children but not self
        // This matches three-tile's behavior
        this.unLoad(loader, false);
      }
    }
  }

  /**
   * Create child tiles
   * Matches three-tile's createChildren logic
   */
  private createChildren(loader: ITileLoader): Tile[] {
    const children: Tile[] = [];
    const nextZ = this.z + 1;
    const baseX = this.x * 2;
    const baseY = this.y * 2;
    const p = 0.25;  // Position offset
    const sx = 0.5;  // Scale X
    const sy = 0.5;  // Scale Y
    const sz = 1.0;  // Scale Z

    // Handle EPSG:4326 special case (only 2 children at level 0)
    if (this.z === 0 && loader.projectionID === "4326") {
      const y = this.y;
      const t1 = new Tile(baseX, y, nextZ, this.getScene());
      t1.parent = this;
      t1.position.set(-p, 0, 0);
      t1.scaling.set(sx, 1.0, sz);
      t1.computeWorldMatrix(true);
      children.push(t1);

      const t2 = new Tile(baseX + 1, y, nextZ, this.getScene());
      t2.parent = this;
      t2.position.set(p, 0, 0);
      t2.scaling.set(sx, 1.0, sz);
      t2.computeWorldMatrix(true);
      children.push(t2);
    } else {
      // Normal case: 4 children
      const y = baseY;
      // Create 4 children matching three-tile order: top-left, top-right, bottom-left, bottom-right
      const positions = [
        [-p, p, 0],   // top-left
        [p, p, 0],    // top-right
        [-p, -p, 0],  // bottom-left
        [p, -p, 0]    // bottom-right
      ];
      
      for (let i = 0; i < 4; i++) {
        const dx = i % 2;
        const dy = Math.floor(i / 2);
        const child = new Tile(baseX + dx, y + dy, nextZ, this.getScene());
        child.parent = this;
        child.position.set(positions[i][0], positions[i][1], positions[i][2]);
        child.scaling.set(sx, sy, sz);
        // Compute world matrix immediately (equivalent to updateMatrixWorld in three.js)
        child.computeWorldMatrix(true);
        children.push(child);
      }
    }

    return children;
  }

  /**
   * Check if 4 sibling tiles are all loaded
   * Matching three-tile's _checkVisible logic exactly
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
    // Note: In three-tile, _checkVisible doesn't handle root tile case
    // Root tile's showing is managed elsewhere
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
    
    // Ensure mesh position is at origin (0, 0, 0) relative to Tile node
    // In three-tile, mesh is created without explicit position, so it defaults to (0, 0, 0)
    this._model.position.set(0, 0, 0);
    this._model.scaling.set(1, 1, 1);
    this._model.rotation.set(0, 0, 0);
    
    // Set parent - in Babylon.js, setting parent automatically handles scene hierarchy
    // The mesh will be removed from scene rootNodes and added as child of this Tile
    this._model.parent = this;
    
    // Update mesh world matrix to ensure correct bounding box calculation
    this._model.computeWorldMatrix(true);
    
    // Update mesh bounding info (matching three-tile: this._model.geometry.computeBoundingBox())
    if (this._model.geometry) {
      this._model.refreshBoundingInfo();
      const boundingInfo = this._model.getBoundingInfo();
      if (boundingInfo) {
        // Set _checkPoint.y to the maximum height
        // In three-tile: this._checkPoint.y = this._model.geometry.boundingBox?.max.z || 0;
        // In three-tile, after up.set(0,0,1), the geometry is in XZ plane, so height is in local Z
        // In Babylon.js, after rotation.x = -PI/2, local Z becomes world Y
        // So we use worldMax.y as the height
        const worldMax = boundingInfo.boundingBox.maximumWorld;
        this._checkPoint.y = worldMax.y || 0;
        console.log(`[Tile] Set _checkPoint.y to ${this._checkPoint.y} for tile ${this.z}/${this.x}/${this.y} (from world bounding box max y: ${worldMax.y})`);
      }
    }
    
    // Ensure mesh is in the scene (should be automatic via parent chain, but verify)
    const scene = this.getScene();
    if (scene && !scene.meshes.includes(this._model)) {
      console.warn(`[Tile] Mesh not in scene.meshes for tile ${this.z}/${this.x}/${this.y}, adding manually`);
      // This shouldn't be necessary, but just in case
      scene.addMesh(this._model, false);
    }
    
    // Explicitly add mesh to this tile's children (matching three-tile: this.add(this._model))
    // In Babylon.js, setting parent should handle this, but we ensure it's added
    if (this._model.parent !== this) {
      this._model.parent = this;
    }
    
    // Ensure mesh is visible and enabled by default
    this._model.isVisible = true;
    this._model.setEnabled(true);
    
    // Check visibility and set showing
    // Matching three-tile: this.isLeaf && this._checkVisible();
    // Only call _checkVisible for leaf tiles
    // For root tile (z=0), if it's a leaf (no children yet), ensure showing is true
    if (this.isLeaf) {
      this._checkVisible();
    } else if (this.z === 0 && !this.subTiles) {
      // Root tile without children should be visible
      this.showing = true;
    }
    
    console.log(`[Tile] After load for tile ${this.z}/${this.x}/${this.y}, showing=${this.showing}, isLeaf=${this.isLeaf}, model.isVisible=${this.model?.isVisible}`);
    
    // Log mesh details for debugging
    if (this._model) {
      const worldMatrix = this._model.getWorldMatrix();
      const worldPosition = Vector3.TransformCoordinates(Vector3.Zero(), worldMatrix);
      console.log(`[Tile] Mesh details for tile ${this.z}/${this.x}/${this.y}:`, {
        name: this._model.name,
        isVisible: this._model.isVisible,
        isEnabled: this._model.isEnabled(),
        localPosition: this._model.position.asArray(),
        worldPosition: worldPosition.asArray(),
        localScaling: this._model.scaling.asArray(),
        parent: this._model.parent?.name,
        hasGeometry: !!this._model.geometry,
        hasMaterial: !!this._model.material,
        verticesCount: this._model.getTotalVertices(),
        inScene: scene?.meshes.includes(this._model),
        boundingInfo: this._model.getBoundingInfo() ? {
          min: this._model.getBoundingInfo()!.boundingBox.minimumWorld.asArray(),
          max: this._model.getBoundingInfo()!.boundingBox.maximumWorld.asArray()
        } : null
      });
    }
    
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
    
    // Update mesh world matrix
    this._model.computeWorldMatrix(true);
    
    // Update mesh bounding info (matching three-tile: this.model.geometry.computeBoundingBox())
    if (this._model.geometry) {
      this._model.refreshBoundingInfo();
      const boundingInfo = this._model.getBoundingInfo();
      if (boundingInfo) {
        // Set _checkPoint.y to the maximum height
        // After rotation.x = -PI/2, local Z becomes world Y
        const worldMax = boundingInfo.boundingBox.maximumWorld;
        this._checkPoint.y = worldMax.y || 0;
      }
    }
    
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
   * Matches three-tile's unLoad behavior exactly
   */
  public unLoad(loader: ITileLoader, unLoadSelf = true) {
    // Unload sub tiles (matching three-tile: always unload children with unLoadSelf=true)
    if (this.subTiles) {
      this.subTiles.forEach((child) => {
        child.unLoad(loader, true);
      });
      // In three-tile: this.remove(...this.subTiles)
      // In Babylon.js, children are automatically removed when parent is set to null or disposed
      // But we should clear the reference
      this._subTiles = undefined;
    }
    // Unload self (only if unLoadSelf is true)
    if (unLoadSelf && this.model) {
      loader.unload(this.model);
      this._model = undefined;
    }
    return this;
  }
}

