/**
 * @description: Interface of map source
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

/** Project ID */
export type ProjectionType = "3857" | "4326";

/**
 * Source interface
 * All source implements ISource to get url from x/y/z coordinate
 */
export interface ISource {
  /** A string identifies the source data type, it requires the support of the loader. */
  dataType: string;
  /** Tile service url template */
  url: string;
  /** Source attribution info, it allows you to display attribution*/
  attribution: string;
  /** Data min level */
  minLevel: number;
  /** Data max level */
  maxLevel: number;
  /** Data projection */
  projectionID: ProjectionType;
  /** Material opacity */
  opacity: number;
  /** Material transparent */
  transparent: boolean;
  /** is TMS scheme */
  isTMS?: boolean;
  /** Data bounds in lonlat [minLon,minLat,maxLon,maxLat]*/
  bounds?: [number, number, number, number];
  /** Data bounds in Projection, internal use */
  _projectionBounds: [number, number, number, number];
  /** Get url from xyz, internal use */
  getUrl(x: number, y: number, z: number, obj?: { [name: string]: any }): string | undefined;
  /** Any data */
  [key: string]: unknown;
}

