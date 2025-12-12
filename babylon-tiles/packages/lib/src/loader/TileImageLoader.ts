/**
 * @description: Tile Image Loader
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { StandardMaterial, Texture, Scene } from "@babylonjs/core";
import { ITileMaterialLoader, TileSourceLoadParamsType, ITileLoaderInfo } from "./ITileLoaders";
import { TileLoader } from "./TileLoader";

/**
 * Tile image loader for loading image tiles
 */
export class TileImageLoader extends TileLoader implements ITileMaterialLoader<StandardMaterial> {
  public isMaterialLoader = true as const;
  public dataType = "image";
  public info: ITileLoaderInfo = this.createInfo("1.0.0", "Babylon Tiles", "Image tile loader");

  private scene?: Scene;

  constructor(scene?: Scene) {
    super();
    this.scene = scene;
  }

  /**
   * Load image material
   */
  public async load(params: TileSourceLoadParamsType): Promise<StandardMaterial> {
    const { x, y, z, source } = params;
    
    // Get tile URL
    const url = source.getUrl(x, y, z);
    console.log(`[TileImageLoader] Generated URL for tile ${z}/${x}/${y}: ${url}`);
    if (!url) {
      throw new Error(`Failed to get URL for tile ${z}/${x}/${y}`);
    }

    // Create material
    const material = new StandardMaterial(`tile-material-${z}-${x}-${y}`, this.scene);
    console.log(`[TileImageLoader] Created material for tile ${z}/${x}/${y}`);
    
    // Load texture
    const texture = new Texture(url, this.scene, undefined, undefined, undefined, () => {
      console.log(`[TileImageLoader] Texture loaded successfully for tile ${z}/${x}/${y}`);
    }, (message) => {
      console.error(`[TileImageLoader] Failed to load texture for tile ${z}/${x}/${y}: ${message}`);
    });

    material.diffuseTexture = texture;
    material.specularColor.set(0, 0, 0);
    material.alpha = source.opacity;

    console.log(`[TileImageLoader] Returning material for tile ${z}/${x}/${y}`);
    return material;
  }

  /**
   * Unload material
   */
  public unload(material: StandardMaterial): void {
    if (material.diffuseTexture) {
      material.diffuseTexture.dispose();
    }
    material.dispose();
  }
}

