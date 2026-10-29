import type { TerrainTile } from './terrainMaterials';
import { WORLD_3D } from './visualContract';

interface Chunk { chunkSize?: number; tileTypes: ArrayLike<number> }
const KINDS = ['Grass', 'Dirt', 'DirtRoad', 'Sea', 'Beach', 'Sand', 'HotSpringWater', 'Quarry', 'Asphalt', 'Forest', 'Tundra', 'Alpine', 'TundraGrass', 'Tilled', 'DeepSea'];

/** Keep a chunk-aligned terrain window, including the coast filter's halo.
 * Walking within a chunk reuses the same mesh/field/water instead of rebuilding
 * all three at each tile boundary. Check contents too: arriving/mutated chunks
 * and tilling must update even when the source Map is mutated in place. */
export class TerrainWindow3d {
  private key = '';
  private cells = new Uint8Array();
  private scratch = new Uint8Array();
  private tiles: TerrainTile[] = [];

  update(chunks: Map<string, Chunk>, frame: {width: number; height: number; cameraOffset: {x:number; y:number}; zoom?:number}): {tiles: TerrainTile[]; reason: 'window' | 'tiles' | 'none'} {
    const size = Math.max(1, chunks.values().next().value?.chunkSize ?? 8);
    const zoom = Math.max(.5, Math.min(2, frame.zoom ?? 1));
    const cx = (-frame.cameraOffset.x + frame.width / 2) / WORLD_3D.tilePixels;
    const cy = (-frame.cameraOffset.y + frame.height / 2) / WORLD_3D.tilePixels;
    const halfX = frame.width / WORLD_3D.tilePixels / zoom / 2, halfY = frame.height / WORLD_3D.tilePixels / zoom / 2;
    const anchorX = Math.floor(cx / size) * size, anchorY = Math.floor(cy / size) * size;
    // Nine tiles cover the signed-distance and shelf smoothing dependencies.
    const minX = Math.max(0, Math.floor((anchorX - halfX - 9) / size) * size);
    const minY = Math.max(0, Math.floor((anchorY - halfY - 9) / size) * size);
    const maxX = Math.ceil((anchorX + size + halfX + 9) / size) * size, maxY = Math.ceil((anchorY + size + halfY + 9) / size) * size;
    const width = Math.max(1, maxX - minX), height = Math.max(1, maxY - minY);
    const key = `${minX}:${minY}:${width}:${height}:${size}`, moved = key !== this.key;
    if (this.scratch.length !== width * height) this.scratch = new Uint8Array(width * height);
    else this.scratch.fill(0);
    for (let by = minY; by < maxY; by += size) for (let bx = minX; bx < maxX; bx += size) {
      const chunk = chunks.get(`${bx / size},${by / size}`);
      if (!chunk) continue;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const source = y * size + x;
        if (source < chunk.tileTypes.length) this.scratch[(by - minY + y) * width + bx - minX + x] = (chunk.tileTypes[source] ?? 0) + 1;
      }
    }
    let changed = moved || this.cells.length !== this.scratch.length;
    if (!changed) for (let i = 0; i < this.cells.length; i++) if (this.cells[i] !== this.scratch[i]) { changed = true; break; }
    if (!changed) return {tiles:this.tiles, reason:'none'};
    const previous = this.cells; this.cells = this.scratch; this.scratch = previous; this.key = key;
    this.tiles = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const type = this.cells[y * width + x];
      if (type) this.tiles.push({worldX:minX + x, worldY:minY + y, tileType:{tag:KINDS[type - 1] ?? 'Grass'}});
    }
    return {tiles:this.tiles, reason:moved ? 'window' : 'tiles'};
  }
}
