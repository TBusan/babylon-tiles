/**
 * @description: Add skirt to geometry
 * @author: Babylon Tiles
 * @date: 2025-10-21
 * Based on: https://github.com/visgl/loaders.gl/blob/master/modules/terrain/src/lib/helpers/skirt.ts
 */

import { AttributesType, GeometryDataType } from "./GeometryDataTypes";

type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;
type TypedArrayConstructor = new (length: number) => TypedArray;

export function concatenateTypedArrays<T extends TypedArray>(...typedArrays: T[]): T {
  const arrays = typedArrays;
  const TypedArrayConstructor =
    ((arrays && arrays.length > 1 && arrays[0].constructor) as TypedArrayConstructor) || null;
  if (!TypedArrayConstructor) {
    throw new Error(
      "concatenateTypedArrays - incorrect quantity of arguments or arguments have incompatible data types"
    );
  }

  const sumLength = arrays.reduce((acc, value) => acc + value.length, 0);
  const result = new TypedArrayConstructor(sumLength) as T;
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

/**
 * Add skirt to existing mesh
 * @param attributes - POSITION and TEXCOORD_0 attributes data
 * @param triangles - indices array of the mesh geometry
 * @param skirtHeight - height of the skirt geometry
 * @returns - geometry data with added skirt
 */
export function addSkirt(
  attributes: AttributesType,
  triangles: Uint16Array | Uint32Array,
  skirtHeight: number
): GeometryDataType {
  const outsideEdges = getOutsideEdgesFromTriangles(triangles);

  const edgeCount = outsideEdges.length;
  const newPosition = new Float32Array(edgeCount * 6);
  const newTexcoord0 = new Float32Array(edgeCount * 4);
  const newTriangles = new (triangles.constructor as new (length: number) => Uint16Array | Uint32Array)(
    edgeCount * 6
  );
  const newNormals = new Float32Array(edgeCount * 6);

  for (let i = 0; i < edgeCount; i++) {
    updateAttributesForNewEdge({
      edge: outsideEdges[i],
      edgeIndex: i,
      attributes,
      skirtHeight,
      newPosition,
      newTexcoord0,
      newTriangles,
      newNormals,
    });
  }

  attributes.position.value = concatenateTypedArrays(attributes.position.value, newPosition);
  attributes.texcoord.value = concatenateTypedArrays(attributes.texcoord.value, newTexcoord0);
  attributes.normal.value = concatenateTypedArrays(attributes.normal.value, newNormals);
  const resultTriangles = concatenateTypedArrays(triangles, newTriangles);

  return {
    attributes,
    indices: resultTriangles,
  };
}

/**
 * Get geometry edges that are located on a border of the mesh
 * @param triangles - indices array of the mesh geometry
 * @returns - outside edges data
 */
function getOutsideEdgesFromTriangles(triangles: Uint16Array | Uint32Array | number[]): number[][] {
  const edges: number[][] = [];
  const triArray = Array.isArray(triangles) ? triangles : Array.from(triangles);

  for (let i = 0; i < triArray.length; i += 3) {
    const a = triArray[i];
    const b = triArray[i + 1];
    const c = triArray[i + 2];
    edges.push([a, b], [b, c], [c, a]);
  }

  edges.sort(([a1, b1], [a2, b2]) => {
    const minA = Math.min(a1, b1);
    const minB = Math.min(a2, b2);
    return minA !== minB ? minA - minB : Math.max(a1, b1) - Math.max(a2, b2);
  });

  const outsideEdges: number[][] = [];
  for (let i = 0; i < edges.length; i++) {
    if (i + 1 < edges.length && edges[i][0] === edges[i + 1][1] && edges[i][1] === edges[i + 1][0]) {
      i++;
    } else {
      outsideEdges.push(edges[i]);
    }
  }

  return outsideEdges;
}

type UpdateAttributesArgs = {
  edge: number[];
  edgeIndex: number;
  attributes: AttributesType;
  skirtHeight: number;
  newPosition: Float32Array;
  newTexcoord0: Float32Array;
  newTriangles: Uint16Array | Uint32Array | number[];
  newNormals: Float32Array;
};

/**
 * Update attributes for a new edge
 */
function updateAttributesForNewEdge({
  edge,
  edgeIndex,
  attributes,
  skirtHeight,
  newPosition,
  newTexcoord0,
  newTriangles,
  newNormals,
}: UpdateAttributesArgs): void {
  const positionsLength = attributes.position.value.length;
  const vertex1Offset = edgeIndex * 2;
  const vertex2Offset = vertex1Offset + 1;

  newPosition.set(attributes.position.value.subarray(edge[0] * 3, edge[0] * 3 + 3), vertex1Offset * 3);
  newPosition[vertex1Offset * 3 + 2] = newPosition[vertex1Offset * 3 + 2] - skirtHeight;
  newPosition.set(attributes.position.value.subarray(edge[1] * 3, edge[1] * 3 + 3), vertex2Offset * 3);
  newPosition[vertex2Offset * 3 + 2] = newPosition[vertex2Offset * 3 + 2] - skirtHeight;

  newTexcoord0.set(attributes.texcoord.value.subarray(edge[0] * 2, edge[0] * 2 + 2), vertex1Offset * 2);
  newTexcoord0.set(attributes.texcoord.value.subarray(edge[1] * 2, edge[1] * 2 + 2), vertex2Offset * 2);

  const triangle1Offset = edgeIndex * 2 * 3;
  newTriangles[triangle1Offset] = edge[0];
  newTriangles[triangle1Offset + 1] = positionsLength / 3 + vertex2Offset;
  newTriangles[triangle1Offset + 2] = edge[1];

  newTriangles[triangle1Offset + 3] = positionsLength / 3 + vertex2Offset;
  newTriangles[triangle1Offset + 4] = edge[0];
  newTriangles[triangle1Offset + 5] = positionsLength / 3 + vertex1Offset;

  newNormals[triangle1Offset] = 0;
  newNormals[triangle1Offset + 1] = 0;
  newNormals[triangle1Offset + 2] = 1;
  newNormals[triangle1Offset + 3] = 0;
  newNormals[triangle1Offset + 4] = 0;
  newNormals[triangle1Offset + 5] = 1;
}

