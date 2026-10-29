import { isOceanTileU8 } from '../../utils/tileTypeGuards';

interface Chunk { chunkSize?: number; tileTypes: ArrayLike<number> }
interface ShoreAmbience { distanceToShore: number; shoreAmbienceGain: number }
const SILENT: ShoreAmbience = { distanceToShore: Infinity, shoreAmbienceGain: 0 };
const RAYS = Array.from({ length: 16 }, (_, i) => [Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)]);
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Rivers and oceans both arrive as Sea tiles. Estimate exposure from long,
 * unobstructed water rays; narrow channels stay quiet even when ocean-connected.
 * Unknown streamed tiles never count as open sea, and hot springs never source surf. */
export class ShoreAmbienceRuntime {
  private chunks: Map<string, Chunk> | undefined;
  private chunkCount = -1;
  private playerX = NaN;
  private playerY = NaN;
  private readonly exposure = new Map<string, boolean>();
  private cached = SILENT;

  update(chunks: Map<string, Chunk> | undefined, player: { positionX?: number; positionY?: number } | null | undefined, tileSize: number): ShoreAmbience {
    if (!player || !chunks?.size) return SILENT;
    const x = player.positionX ?? 0, y = player.positionY ?? 0;
    const changed = chunks !== this.chunks || chunks.size !== this.chunkCount;
    if (!changed && Math.hypot(x - this.playerX, y - this.playerY) < tileSize / 2) return this.cached;
    if (changed) this.exposure.clear();
    this.chunks = chunks; this.chunkCount = chunks.size; this.playerX = x; this.playerY = y;
    const size = chunks.values().next().value?.chunkSize ?? 8;
    const at = (tx: number, ty: number): number | undefined => {
      if (tx < 0 || ty < 0) return undefined;
      const chunk = chunks.get(`${Math.floor(tx / size)},${Math.floor(ty / size)}`);
      return chunk?.tileTypes[(ty % size) * (chunk.chunkSize ?? size) + tx % size];
    };
    const exposed = (tx: number, ty: number): boolean => {
      const key = `${tx},${ty}`, cached = this.exposure.get(key);
      if (cached !== undefined) return cached;
      let open = 0;
      for (const [dx, dy] of RAYS) {
        let reach = 1;
        for (; reach <= 24; reach++) if (!isOceanTileU8(at(tx + Math.round(dx * reach), ty + Math.round(dy * reach)))) break;
        if (reach > 24) open++;
      }
      const result = open >= 5;
      this.exposure.set(key, result);
      return result;
    };
    let ocean = Infinity, river = Infinity;
    const px = Math.floor(x / tileSize), py = Math.floor(y / tileSize), radius = Math.ceil(800 / tileSize);
    for (let ty = Math.max(0, py - radius); ty <= py + radius; ty++) for (let tx = Math.max(0, px - radius); tx <= px + radius; tx++) {
      if (!isOceanTileU8(at(tx, ty))) continue;
      // Measure to the actual bank rather than every water tile (open water is quiet).
      if (!NEIGHBORS.some(([dx, dy]) => {
        const tile = at(tx + dx, ty + dy);
        return tile !== undefined && !isOceanTileU8(tile) && tile !== 6;
      })) continue;
      const distance = Math.hypot(x - (tx + .5) * tileSize, y - (ty + .5) * tileSize);
      if (distance > 800) continue;
      if (exposed(tx, ty)) ocean = Math.min(ocean, distance);
      else river = Math.min(river, distance);
    }
    const fade = (distance: number, near: number, far: number) => Math.max(0, Math.min(1, 1 - (distance - near) / (far - near)));
    this.cached = { distanceToShore: ocean, shoreAmbienceGain: Math.max(fade(ocean, 50, 800), .22 * fade(river, 35, 300)) };
    return this.cached;
  }

  stop(): void { this.chunks = undefined; this.chunkCount = -1; this.exposure.clear(); this.playerX = NaN; this.playerY = NaN; this.cached = SILENT; }
}
