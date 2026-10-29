import { BufferAttribute, BufferGeometry } from 'three/webgpu';
import type { TerrainTile } from './terrainField';
import { createTerrainGroundData } from './terrainGroundData';
import type { TerrainGroundData } from './terrainGroundData';

/** Shared vertices form a continuous beach/seabed slope across tile borders. */
export function createTerrainGround(tiles: Iterable<TerrainTile>, depthAt: (x: number, y: number) => number): BufferGeometry {
  return terrainGeometry(createTerrainGroundData([...tiles],depthAt));
}

export function terrainGeometry(data: TerrainGroundData): BufferGeometry {
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(data.positions,3));
  geometry.setAttribute('normal',new BufferAttribute(data.normals,3));
  geometry.setAttribute('terrainCoordinate',new BufferAttribute(data.coordinates,2));
  geometry.setIndex(new BufferAttribute(data.indices,1));geometry.computeBoundingSphere();return geometry;
}
