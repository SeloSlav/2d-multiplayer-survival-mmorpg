import { gameConfig } from '../../config/gameConfig';
import { detectHotSprings } from '../../utils/hotSpringDetector';
import { detectQuarries } from '../../utils/quarryDetector';
import { isOceanTileTag, isWaterTileTag } from '../../utils/tileTypeGuards';

const EMPTY_MAP = new Map<string, unknown>();
const WORLD_TILE_RENDER_BUFFER_TILES = 4;

interface WorldChunkData {
  chunkSize?: number;
  tileTypes: ArrayLike<number>;
  variants?: ArrayLike<number>;
}

interface WorldLookupPlayer {
  positionX?: number;
  positionY?: number;
}

export interface WorldLookupRuntimeOptions {
  worldChunkDataMap: Map<string, WorldChunkData> | undefined;
  cameraOffsetX: number;
  cameraOffsetY: number;
  canvasWidth: number;
  canvasHeight: number;
  localPlayer: WorldLookupPlayer | null | undefined;
}

export interface WorldLookupRuntimeSnapshot {
  visibleWorldTiles: Map<string, unknown>;
  waterTileLookup: Map<string, boolean>;
  seaTransitionTileLookup: Map<string, boolean>;
  detectedHotSprings: ReturnType<typeof detectHotSprings>;
  detectedQuarries: ReturnType<typeof detectQuarries>;
  distanceToShore: number;
  distanceToMapEdge: number;
}

function typeFromU8(value: number): string {
  switch (value) {
    case 0: return 'Grass';
    case 1: return 'Dirt';
    case 2: return 'DirtRoad';
    case 3: return 'Sea';
    case 4: return 'Beach';
    case 5: return 'Sand';
    case 6: return 'HotSpringWater';
    case 7: return 'Quarry';
    case 8: return 'Asphalt';
    case 9: return 'Forest';
    case 10: return 'Tundra';
    case 11: return 'Alpine';
    case 12: return 'TundraGrass';
    case 13: return 'Tilled';
    case 14: return 'DeepSea';
    default: return 'Grass';
  }
}

function getWorldChunkSize(worldChunkDataMap: Map<string, WorldChunkData> | undefined): number {
  if (!worldChunkDataMap || worldChunkDataMap.size === 0) return 8;
  const firstChunk = worldChunkDataMap.values().next().value;
  return firstChunk?.chunkSize ?? 8;
}

export class WorldLookupRuntime {
  private lastShoreCheckPos = { x: 0, y: 0 };
  private cachedDistanceToShore = 9999;

  update({
    worldChunkDataMap,
    cameraOffsetX,
    cameraOffsetY,
    canvasWidth,
    canvasHeight,
    localPlayer,
  }: WorldLookupRuntimeOptions): WorldLookupRuntimeSnapshot {
    const tileSize = gameConfig.tileSize;
    const viewTileX = Math.floor((-cameraOffsetX) / tileSize);
    const viewTileY = Math.floor((-cameraOffsetY) / tileSize);
    const bufferedViewTileX = viewTileX - WORLD_TILE_RENDER_BUFFER_TILES;
    const bufferedViewTileY = viewTileY - WORLD_TILE_RENDER_BUFFER_TILES;
    const worldChunkSize = getWorldChunkSize(worldChunkDataMap);

    const visibleWorldTiles = this.buildVisibleWorldTiles({
      worldChunkDataMap,
      canvasWidth,
      canvasHeight,
      tileSize,
      worldChunkSize,
      bufferedViewTileX,
      bufferedViewTileY,
    });
    const waterTileLookup = this.buildWaterTileLookup(visibleWorldTiles);
    const seaTransitionTileLookup = this.buildSeaTransitionTileLookup(visibleWorldTiles);

    return {
      visibleWorldTiles,
      waterTileLookup,
      seaTransitionTileLookup,
      detectedHotSprings: detectHotSprings((worldChunkDataMap ?? EMPTY_MAP) as Map<string, never>),
      detectedQuarries: detectQuarries((worldChunkDataMap ?? EMPTY_MAP) as Map<string, never>),
      distanceToShore: this.getDistanceToShore({
        localPlayer,
        waterTileLookup,
        tileSize,
      }),
      distanceToMapEdge: this.getDistanceToMapEdge(localPlayer),
    };
  }

  stop(): void {
    this.lastShoreCheckPos = { x: 0, y: 0 };
    this.cachedDistanceToShore = 9999;
  }

  private buildVisibleWorldTiles({
    worldChunkDataMap,
    canvasWidth,
    canvasHeight,
    tileSize,
    worldChunkSize,
    bufferedViewTileX,
    bufferedViewTileY,
  }: {
    worldChunkDataMap: Map<string, WorldChunkData> | undefined;
    canvasWidth: number;
    canvasHeight: number;
    tileSize: number;
    worldChunkSize: number;
    bufferedViewTileX: number;
    bufferedViewTileY: number;
  }): Map<string, unknown> {
    const map = new Map<string, unknown>();
    const extraTiles = WORLD_TILE_RENDER_BUFFER_TILES * 2;
    const tilesHorz = Math.ceil(canvasWidth / tileSize) + extraTiles;
    const tilesVert = Math.ceil(canvasHeight / tileSize) + extraTiles;
    const minTileX = Math.max(0, bufferedViewTileX);
    const minTileY = Math.max(0, bufferedViewTileY);
    const maxTileX = bufferedViewTileX + tilesHorz;
    const maxTileY = bufferedViewTileY + tilesVert;
    const chunkSource = worldChunkDataMap ?? new Map<string, WorldChunkData>();

    for (let ty = minTileY; ty < maxTileY; ty++) {
      for (let tx = minTileX; tx < maxTileX; tx++) {
        const cx = Math.floor(tx / worldChunkSize);
        const cy = Math.floor(ty / worldChunkSize);
        const chunk = chunkSource.get(`${cx},${cy}`);
        if (!chunk) continue;
        const localX = tx % worldChunkSize;
        const localY = ty % worldChunkSize;
        if (localX < 0 || localY < 0) continue;
        const chunkSize = chunk.chunkSize ?? worldChunkSize;
        const idx = localY * chunkSize + localX;
        if (idx < 0 || idx >= chunk.tileTypes.length) continue;
        map.set(`${tx}_${ty}`, {
          worldX: tx,
          worldY: ty,
          tileType: { tag: typeFromU8(chunk.tileTypes[idx]) },
          variant: chunk.variants?.[idx] ?? 0,
        });
      }
    }

    return map;
  }

  private buildWaterTileLookup(visibleWorldTiles: Map<string, unknown>): Map<string, boolean> {
    const lookup = new Map<string, boolean>();
    visibleWorldTiles.forEach((tile) => {
      const worldTile = tile as { worldX: number; worldY: number; tileType?: { tag?: string } };
      lookup.set(`${worldTile.worldX},${worldTile.worldY}`, isWaterTileTag(worldTile.tileType?.tag));
    });
    return lookup;
  }

  private buildSeaTransitionTileLookup(visibleWorldTiles: Map<string, unknown>): Map<string, boolean> {
    const lookup = new Map<string, boolean>();
    const isLandAtShore = (tileType: string | null) => tileType === 'Beach' || tileType === 'Asphalt';
    const isShoreWater = (tileType: string | null) =>
      isOceanTileTag(tileType) || tileType === 'HotSpringWater';
    const tileTypesByCoord = new Map<string, string>();

    visibleWorldTiles.forEach((tile) => {
      const worldTile = tile as { worldX: number; worldY: number; tileType?: { tag?: string } };
      tileTypesByCoord.set(`${worldTile.worldX},${worldTile.worldY}`, worldTile.tileType?.tag ?? 'Grass');
    });

    const getVisibleTileType = (tx: number, ty: number): string | null =>
      tileTypesByCoord.get(`${tx},${ty}`) ?? null;

    visibleWorldTiles.forEach((tile) => {
      const worldTile = tile as { worldX: number; worldY: number };
      const tx = worldTile.worldX;
      const ty = worldTile.worldY;
      const center = getVisibleTileType(tx, ty);
      const n = getVisibleTileType(tx, ty - 1);
      const s = getVisibleTileType(tx, ty + 1);
      const e = getVisibleTileType(tx + 1, ty);
      const w = getVisibleTileType(tx - 1, ty);
      const hasWater = isShoreWater(n) || isShoreWater(s) || isShoreWater(e) || isShoreWater(w);
      const hasLand = isLandAtShore(n) || isLandAtShore(s) || isLandAtShore(e) || isLandAtShore(w);
      const isTransition = (isShoreWater(center) && hasLand) || (isLandAtShore(center) && hasWater);
      if (isTransition) {
        lookup.set(`${tx},${ty}`, true);
      }
    });

    return lookup;
  }

  private getDistanceToShore({
    localPlayer,
    waterTileLookup,
    tileSize,
  }: {
    localPlayer: WorldLookupPlayer | null | undefined;
    waterTileLookup: Map<string, boolean>;
    tileSize: number;
  }): number {
    if (!localPlayer || waterTileLookup.size === 0) {
      return 9999;
    }

    const playerX = localPlayer.positionX ?? 0;
    const playerY = localPlayer.positionY ?? 0;
    const dx = playerX - this.lastShoreCheckPos.x;
    const dy = playerY - this.lastShoreCheckPos.y;
    if (dx * dx + dy * dy < 96 * 96) {
      return this.cachedDistanceToShore;
    }

    this.lastShoreCheckPos = { x: playerX, y: playerY };
    const playerTileX = Math.floor(playerX / tileSize);
    const playerTileY = Math.floor(playerY / tileSize);
    const maxSearchRadius = 17;

    for (let radius = 0; radius <= maxSearchRadius; radius++) {
      for (let offsetX = -radius; offsetX <= radius; offsetX++) {
        for (let offsetY = -radius; offsetY <= radius; offsetY++) {
          if (Math.abs(offsetX) !== radius && Math.abs(offsetY) !== radius) continue;
          const tileKey = `${playerTileX + offsetX},${playerTileY + offsetY}`;
          if (waterTileLookup.get(tileKey)) {
            const tileWorldX = (playerTileX + offsetX) * tileSize + tileSize / 2;
            const tileWorldY = (playerTileY + offsetY) * tileSize + tileSize / 2;
            const distX = playerX - tileWorldX;
            const distY = playerY - tileWorldY;
            const distance = Math.sqrt(distX * distX + distY * distY);
            this.cachedDistanceToShore = distance;
            return distance;
          }
        }
      }
    }

    this.cachedDistanceToShore = 9999;
    return 9999;
  }

  private getDistanceToMapEdge(localPlayer: WorldLookupPlayer | null | undefined): number {
    if (!localPlayer) return Infinity;
    const playerX = localPlayer.positionX ?? 0;
    const playerY = localPlayer.positionY ?? 0;
    return Math.min(playerX, gameConfig.worldWidthPx - playerX, playerY, gameConfig.worldHeightPx - playerY);
  }
}
