/// <reference lib="webworker" />
import { buildTerrain } from './terrainBuild';
import type { TerrainTile } from './terrainField';
const worker=self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage=(event:MessageEvent<{id:number;tiles:TerrainTile[]}>)=>{
  const result=buildTerrain(event.data.tiles),g=result.ground;
  worker.postMessage({id:event.data.id,result},[result.field.data.buffer,g.positions.buffer,g.normals.buffer,g.coordinates.buffer,g.indices.buffer]);
};
