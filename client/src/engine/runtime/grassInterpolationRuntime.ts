import type {
  Grass as SpacetimeDBGrass,
  GrassAppearanceType,
  GrassState as SpacetimeDBGrassState,
} from '../../generated/types';
import type { Timestamp as SpacetimeDBTimestamp } from 'spacetimedb';

interface GrassInterpolationState {
  id: string;
  originalId: bigint;
  serverPosX: number;
  serverPosY: number;
  posX: number;
  posY: number;
  lastKnownPosX: number;
  lastKnownPosY: number;
  targetPosX: number;
  targetPosY: number;
  lastServerUpdateTimeMs: number;
  appearanceType: GrassAppearanceType;
  chunkIndex: number;
  swayOffsetSeed: number;
  swaySpeed: number;
  health: number;
  lastHitTime: SpacetimeDBTimestamp | null;
  respawnAt: SpacetimeDBTimestamp | null;
}

export interface InterpolatedGrassData extends GrassInterpolationState {
  currentRenderPosX: number;
  currentRenderPosY: number;
}

interface GrassInterpolationRuntimeOptions {
  serverGrass: Map<string, SpacetimeDBGrass>;
  serverGrassState: Map<string, SpacetimeDBGrassState>;
}

export class GrassInterpolationRuntime {
  private readonly interpolatedStates = new Map<string, GrassInterpolationState>();
  private readonly renderableGrass = new Map<string, InterpolatedGrassData>();
  private previousServerGrass = new Map<string, SpacetimeDBGrass>();
  private previousServerGrassState = new Map<string, SpacetimeDBGrassState>();
  private readonly seenGrassStateIds = new Set<string>();

  update({
    serverGrass,
    serverGrassState,
  }: GrassInterpolationRuntimeOptions): Map<string, InterpolatedGrassData> {
    const now = performance.now();
    const currentGrassIds = new Set<string>();

    serverGrassState.forEach((_, id) => {
      this.seenGrassStateIds.add(id);
    });

    serverGrass.forEach((grass, id) => {
      currentGrassIds.add(id);
      const previousState = this.interpolatedStates.get(id);
      const previousGrass = this.previousServerGrass.get(id);
      const grassState = serverGrassState.get(id);
      const previousGrassState = this.previousServerGrassState.get(id);

      const staticDataChanged = !previousGrass
        || previousGrass.appearanceType !== grass.appearanceType
        || previousGrass.chunkIndex !== grass.chunkIndex
        || previousGrass.swayOffsetSeed !== grass.swayOffsetSeed
        || previousGrass.swaySpeed !== grass.swaySpeed;
      const dynamicDataChanged = !grassState
        || !previousGrassState
        || previousGrassState.isAlive !== grassState.isAlive
        || !Object.is(previousGrassState.lastHitTime, grassState.lastHitTime)
        || !Object.is(previousGrassState.respawnAt, grassState.respawnAt);
      const isAlive = grassState ? grassState.isAlive : false;

      if (!isAlive) {
        if (previousState || this.seenGrassStateIds.has(id)) {
          this.interpolatedStates.delete(id);
          this.renderableGrass.delete(id);
        }
        return;
      }

      if (!previousState || staticDataChanged || dynamicDataChanged) {
        const newState: GrassInterpolationState = {
          id,
          originalId: grass.id,
          serverPosX: grass.posX,
          serverPosY: grass.posY,
          posX: grass.posX,
          posY: grass.posY,
          lastKnownPosX: grass.posX,
          lastKnownPosY: grass.posY,
          targetPosX: grass.posX,
          targetPosY: grass.posY,
          lastServerUpdateTimeMs: now,
          appearanceType: grass.appearanceType,
          chunkIndex: grass.chunkIndex,
          swayOffsetSeed: grass.swayOffsetSeed,
          swaySpeed: grass.swaySpeed,
          health: grassState?.health ?? 0,
          lastHitTime: grassState?.lastHitTime ?? null,
          respawnAt: grassState?.respawnAt ?? null,
        };

        this.interpolatedStates.set(id, newState);
        this.renderableGrass.set(id, {
          ...newState,
          currentRenderPosX: newState.targetPosX,
          currentRenderPosY: newState.targetPosY,
        });
      }
    });

    this.interpolatedStates.forEach((_, id) => {
      if (!currentGrassIds.has(id)) {
        this.interpolatedStates.delete(id);
        this.renderableGrass.delete(id);
        this.seenGrassStateIds.delete(id);
      }
    });

    this.previousServerGrass = new Map(serverGrass);
    this.previousServerGrassState = new Map(serverGrassState);

    return this.renderableGrass;
  }

  stop(): void {
    this.interpolatedStates.clear();
    this.renderableGrass.clear();
    this.previousServerGrass.clear();
    this.previousServerGrassState.clear();
    this.seenGrassStateIds.clear();
  }
}
