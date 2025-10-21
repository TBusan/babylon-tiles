/**
 * @description: utils of geometry
 * @author: Babylon Tiles
 * @date: 2025-10-21
 */

import { AttributesType, GeometryDataType } from "./GeometryDataTypes";

/**
 * Calculate tile geometry vertices, UV, normals and triangle indices from DEM array
 * @param dem - DEM
 * @returns - vertices, UV, normals and indices
 */
export function getGeometryDataFromDem(dem: Float32Array): GeometryDataType {
  if (dem.length < 4) {
    throw new Error(`DEM array must > 4, got ${dem.length}!`);
  }
  const size = Math.floor(Math.sqrt(dem.length));
  const width = size;
  const height = size;

  // Calculate triangle indices
  const indices = getGridIndices(height, width);
  // Calculate vertex coordinates, UV coordinates and normals
  const attributes = getAttributes(dem, height, width);

  return { attributes, indices };
}

/**
 * Calculate vertices and UV from DEM array
 * @param dem DEM array
 * @param height
 * @param width
 * @returns Vertices and UV
 */
function getAttributes(dem: Float32Array, height: number, width: number): AttributesType {
  const numVertices = width * height;
  // Create vertex array
  const vertices = new Float32Array(numVertices * 3);
  // Create UV coordinate array
  const uvs = new Float32Array(numVertices * 2);
  let index = 0;
  // Iterate through height and width
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Normalize coordinates
      const xNorm = x / (width - 1);
      const yNorm = y / (height - 1);
      // Set UV coordinates
      uvs[index * 2] = xNorm;
      uvs[index * 2 + 1] = yNorm;
      // Set vertex position
      vertices[index * 3] = xNorm - 0.5;
      vertices[index * 3 + 1] = yNorm - 0.5;
      vertices[index * 3 + 2] = dem[(height - y - 1) * width + x];

      index++;
    }
  }
  return {
    // Vertex position attribute
    position: { value: vertices, size: 3 },
    // UV coordinate attribute
    texcoord: { value: uvs, size: 2 },
    // Normal attribute
    normal: { value: getNormals(vertices, getGridIndices(height, width)), size: 3 },
  };
}

/**
 * Get grid index array
 *
 * @param height height
 * @param width width
 * @returns grid index array
 */
export function getGridIndices(height: number, width: number) {
  const numIndices = 6 * (width - 1) * (height - 1);
  const indices = new Uint16Array(numIndices);

  let index = 0;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const a = y * width + x;
      const b = a + 1;
      const c = a + width;
      const d = c + 1;

      const baseIndex = index * 6;
      indices[baseIndex] = a;
      indices[baseIndex + 1] = b;
      indices[baseIndex + 2] = c;
      indices[baseIndex + 3] = c;
      indices[baseIndex + 4] = b;
      indices[baseIndex + 5] = d;

      index++;
    }
  }
  return indices;
}

/**
 * Calculate normals from vertices and indices
 * @param vertices
 * @param indices
 * @param skirtIndex
 * @returns
 */
export function getNormals(vertices: Float32Array, indices: Uint16Array | Uint32Array): Float32Array {
  // Initialize a normal array with the same length as vertices
  const normals = new Float32Array(vertices.length);

  // Iterate through index array
  for (let i = 0; i < indices.length; i += 3) {
    // Get three vertex indices and convert to corresponding vertex index positions
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    // Get coordinates of three vertices
    const v0x = vertices[i0];
    const v0y = vertices[i0 + 1];
    const v0z = vertices[i0 + 2];

    const v1x = vertices[i1];
    const v1y = vertices[i1 + 1];
    const v1z = vertices[i1 + 2];

    const v2x = vertices[i2];
    const v2y = vertices[i2 + 1];
    const v2z = vertices[i2 + 2];

    // Calculate two edge vectors
    const edge1x = v1x - v0x;
    const edge1y = v1y - v0y;
    const edge1z = v1z - v0z;

    const edge2x = v2x - v0x;
    const edge2y = v2y - v0y;
    const edge2z = v2z - v0z;

    // Calculate normal using cross product
    const normalX = edge1y * edge2z - edge1z * edge2y;
    const normalY = edge1z * edge2x - edge1x * edge2z;
    const normalZ = edge1x * edge2y - edge1y * edge2x;

    // Calculate normal length
    const length = Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ);
    const ns = [0, 0, 1];
    if (length > 0) {
      // Normalize normal
      const invLength = 1 / length;
      ns[0] = normalX * invLength;
      ns[1] = normalY * invLength;
      ns[2] = normalZ * invLength;
    }
    for (let i = 0; i < 3; i++) {
      normals[i0 + i] = normals[i1 + i] = normals[i2 + i] = ns[i];
    }
  }
  return normals;
}

