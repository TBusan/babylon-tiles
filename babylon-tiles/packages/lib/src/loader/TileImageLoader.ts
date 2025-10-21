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
    if (!url) {
      throw new Error(`Failed to get URL for tile ${z}/${x}/${y}`);
    }

    // Create material
    const material = new StandardMaterial(`tile-material-${z}-${x}-${y}`, this.scene);
    
    // Load texture
    const texture = new Texture(url, this.scene, undefined, undefined, undefined, () => {
      // Texture loaded successfully
    }, (message) => {
      console.error(`Failed to load texture: ${message}`);
    });

    material.diffuseTexture = texture;
    material.specularColor.set(0, 0, 0);
    material.alpha = source.opacity;

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

