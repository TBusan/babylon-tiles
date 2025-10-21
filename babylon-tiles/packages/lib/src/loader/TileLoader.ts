/**
 * @description: Base Tile Loader
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { ITileLoaderInfo } from "./ITileLoaders";

/**
 * Base tile loader class
 */
export abstract class TileLoader {
  /** Loader info */
  public abstract info: ITileLoaderInfo;
  /** Data type identifier */
  public abstract dataType: string;

  /**
   * Create a simple loader info object
   */
  protected createInfo(version: string, author?: string, description?: string): ITileLoaderInfo {
    return {
      version,
      author,
      description,
    };
  }
}

