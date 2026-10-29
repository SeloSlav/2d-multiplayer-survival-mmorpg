import { createTerrainField, sampleTerrainDepth } from './terrainField';
import type { TerrainTile, TerrainField } from './terrainField';
import { createTerrainGroundData } from './terrainGroundData';
import type { TerrainGroundData } from './terrainGroundData';
export interface TerrainBuild { field:TerrainField; ground:TerrainGroundData; buildMs:number }
export function buildTerrain(tiles: readonly TerrainTile[]): TerrainBuild {
  const start=performance.now(),field=createTerrainField(tiles,false);
  const ground=createTerrainGroundData(tiles,(x,y)=>sampleTerrainDepth(field,x,y));
  return {field,ground,buildMs:performance.now()-start};
}
