import { TERRAIN_PALETTE, WATER_TERRAINS } from './visualContract';
export const TERRAIN_KINDS = Object.keys(TERRAIN_PALETTE);
export const WATER_DEPTH = {Sea:1.35, DeepSea:3.15, HotSpringWater:.72} as const;
const clamp = (n:number, a=0, b=1) => Math.max(a, Math.min(b,n));
export interface TerrainTile { worldX?: number; worldY?: number; tileType?: unknown }
function tileTag(row: TerrainTile): string { return typeof row.tileType === 'string' ? row.tileType : (row.tileType as { tag?: string })?.tag ?? 'Grass'; }
export interface TerrainField { data: Uint8Array; width: number; height: number; minX: number; minY: number; coast: Map<string, number> }
const COAST_NEIGHBORS = Array.from({ length: 121 }, (_, i) => ({ dx: i % 11 - 5, dy: Math.floor(i / 11) - 5 }))
  .map(p => ({ ...p, distance: Math.hypot(p.dx, p.dy) - .5 })).sort((a, b) => a.distance - b.distance);
export function createTerrainField(tiles: Iterable<TerrainTile>, includeCoast = true): TerrainField {
  const rows = [...tiles];
  if (!rows.length) return { data: new Uint8Array([0, 0, 0, 0]), width: 1, height: 1, minX: 0, minY: 0, coast: new Map() };
  const minX = Math.min(...rows.map(t => t.worldX ?? 0)) - 1, minY = Math.min(...rows.map(t => t.worldY ?? 0)) - 1;
  const width = Math.max(...rows.map(t => t.worldX ?? 0)) - minX + 2, height = Math.max(...rows.map(t => t.worldY ?? 0)) - minY + 2;
  const data = new Uint8Array(width * height * 4), coast = new Map<string, number>(), signed = new Float32Array(width * height);
  // 0 = unknown, 1 = dry, 2 = wet. Avoid 121 string-map lookups and square
  // roots per texel whenever a streamed terrain window changes.
  const occupancy = new Uint8Array(width * height);
  for (const row of rows) {
    const i = ((row.worldY ?? 0) - minY) * width + (row.worldX ?? 0) - minX, type = tileTag(row);
    occupancy[i] = WATER_TERRAINS.has(type) ? 2 : 1;
    data[i * 4] = Math.max(0, TERRAIN_KINDS.indexOf(type));
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const wet = occupancy[y * width + x] === 2;
    let distance = 6;
    for (const neighbor of COAST_NEIGHBORS) {
      if (neighbor.distance >= distance) break;
      const nx = x + neighbor.dx, ny = y + neighbor.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const other = occupancy[ny * width + nx];
      if (other && (other === 2) !== wet) { distance = neighbor.distance; break; }
    }
    const sd = wet ? distance : -distance, offset = (y * width + x) * 4;
    signed[y * width + x] = sd; data[offset + 2] = wet ? 255 : 0;
  }
  const blur = (source: Float32Array) => {
    const result = new Float32Array(source.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += source[Math.max(0, Math.min(height - 1, y + dy)) * width + Math.max(0, Math.min(width - 1, x + dx))] * (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
      result[y * width + x] = sum / 16;
    }
    return result;
  };
  const smoothCoast = blur(blur(signed)), depths = new Float32Array(signed.length);
  let shelf = new Float32Array(signed.length);
  for (let i = 0; i < shelf.length; i++) shelf[i] = TERRAIN_KINDS[data[i * 4]] === 'DeepSea' ? 1 : 0;
  for (let i = 0; i < 5; i++) shelf = blur(shelf);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, sd = smoothCoast[i], kind = TERRAIN_KINDS[data[i * 4]];
    const target = kind === 'HotSpringWater' ? WATER_DEPTH.HotSpringWater : WATER_TERRAINS.has(kind) ? WATER_DEPTH.Sea + (WATER_DEPTH.DeepSea - WATER_DEPTH.Sea) * shelf[i] : 0;
    const t = clamp(sd / 4), depth = target * t * t * (3 - 2 * t);
    depths[i] = depth; data[i * 4 + 1] = clamp((sd + 8) / 16) * 255; if (includeCoast) coast.set(`${minX + x},${minY + y}`, sd);
  }
  const smoothDepth = blur(blur(depths));
  for (let i = 0; i < smoothDepth.length; i++) data[i * 4 + 3] = clamp(smoothDepth[i] / 4) * 255;
  return { data, width, height, minX, minY, coast };
}

export function sampleTerrainDepth(field: TerrainField, x: number, y: number): number {
  const gx = x / 48 - field.minX - .5, gy = y / 48 - field.minY - .5;
  const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
  const at = (dx: number, dy: number) => field.data[(Math.max(0, Math.min(field.height - 1, iy + dy)) * field.width + Math.max(0, Math.min(field.width - 1, ix + dx))) * 4 + 3] / 255 * 4;
  return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
}

