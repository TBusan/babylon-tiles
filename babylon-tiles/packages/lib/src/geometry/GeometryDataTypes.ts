/**
 * @description: Define geometry data type
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

/**
 * Geometry Attributes type
 */
export type AttributesType = {
  position: {
    value: Float32Array;
    size: number;
  };
  texcoord: {
    value: Float32Array;
    size: number;
  };
  normal: {
    value: Float32Array;
    size: number;
  };
};

/**
 * Geometry Attributes and indices type
 */
export type GeometryDataType = {
  attributes: AttributesType;
  indices: Uint16Array | Uint32Array;
};

