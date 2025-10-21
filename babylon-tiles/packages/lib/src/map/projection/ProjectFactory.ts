/**
 * @description: Projection factory
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { IProjection, ProjectionType } from "./IProjection";
import { ProjMCT } from "./ProjMCT";
import { ProjWGS } from "./ProjWGS";

/**
 * Projection factory for creating projection instances
 */
export class ProjectFactory {
  /**
   * Create a projection instance from projection ID
   * @param id Projection ID (3857 or 4326)
   * @param lon0 Central meridian longitude (default: 0)
   * @returns Projection instance
   */
  public static createFromID(id: ProjectionType, lon0: number = 0): IProjection {
    switch (id) {
      case "3857":
        return new ProjMCT(lon0);
      case "4326":
        return new ProjWGS(lon0);
      default:
        throw new Error(`Unknown projection ID: ${id}`);
    }
  }
}

