import type { DbConnection } from '../../generated';
import type {
  AnimalCorpse,
  GrassState,
  PlacedExplosive,
  PlayerDiscoveredCairn,
  WildAnimal,
} from '../../generated/types';
import {
  cleanupCutGrassEffectSystem,
  handleGrassStateDestroyed,
} from '../../effects/cutGrassEffect';
import { triggerExplosionEffect } from '../../utils/renderers/explosiveRenderingUtils';
import { triggerAnimalCorpseDestructionEffect } from '../../utils/renderers/animalCorpseRenderingUtils';
import { triggerBarrelDestructionEffect } from '../../utils/renderers/barrelRenderingUtils';
import { isLiveDetonation, recordWorldExplosion, recordWorldGrassCut } from '../presentation/world3d/presentationEffectEvents';
import { bindGrassCutEvents } from './grassCutEventRuntime';
import { bindBarrelBreakEvents } from './barrelBreakEventRuntime';

type CairnInsertListener = (ctx: unknown, discovery: PlayerDiscoveredCairn) => void;
type PlacedExplosiveDeleteListener = (ctx: unknown, explosive: PlacedExplosive) => void;
type AnimalCorpseDeleteListener = (ctx: unknown, corpse: AnimalCorpse) => void;
type WildAnimalInsertListener = (ctx: unknown, animal: WildAnimal) => void;
type ImmediateSoundPlayer = (soundType: 'cairn_unlock', volume?: number) => void;

let hasDispatchedHostileEncounterEvent = false;

class GameplayEventEffectsRuntime {
  private activeConnection: DbConnection | null = null;
  private localPlayerId: string | null = null;
  private playImmediateSound: ImmediateSoundPlayer | null = null;
  private playedCairnIds = new Set<string>();
  private detachGrassCutEvents: (() => void) | null = null;
  private cairnInsertListener: CairnInsertListener | null = null;
  private placedExplosiveDeleteListener: PlacedExplosiveDeleteListener | null = null;
  private animalCorpseDeleteListener: AnimalCorpseDeleteListener | null = null;
  private detachBarrelBreakEvents: (() => void) | null = null;
  private wildAnimalInsertListener: WildAnimalInsertListener | null = null;

  start(
    connection: DbConnection | null,
    localPlayerId: string | null,
    options: { playImmediateSound?: ImmediateSoundPlayer } = {},
  ): void {
    const connectionChanged = this.activeConnection !== connection;
    const playerChanged = this.localPlayerId !== localPlayerId;
    this.playImmediateSound = options.playImmediateSound ?? null;

    if (connectionChanged) {
      this.detachListeners();
      this.activeConnection = connection;
      this.playedCairnIds.clear();
      hasDispatchedHostileEncounterEvent = false;
    }

    if (playerChanged) {
      this.localPlayerId = localPlayerId;
      this.playedCairnIds.clear();
    }

    if (!this.activeConnection) {
      cleanupCutGrassEffectSystem();
      return;
    }

    if (!this.detachGrassCutEvents) this.detachGrassCutEvents = bindGrassCutEvents(this.activeConnection, state => this.grassDestroyed(state));
    if (!this.detachBarrelBreakEvents) this.detachBarrelBreakEvents = bindBarrelBreakEvents(this.activeConnection, triggerBarrelDestructionEffect);

    if (!this.cairnInsertListener) {
      this.cairnInsertListener = (_ctx, discovery) => {
        const currentLocalPlayerId = this.localPlayerId;
        if (!currentLocalPlayerId) {
          return;
        }

        const discoveryPlayerId = discovery.playerIdentity?.toHexString() ?? null;
        if (discoveryPlayerId !== currentLocalPlayerId) {
          return;
        }

        const cairnKey = discovery.cairnId.toString();
        if (this.playedCairnIds.has(cairnKey)) {
          return;
        }

        this.playedCairnIds.add(cairnKey);
        this.playImmediateSound?.('cairn_unlock');
      };
      this.activeConnection.db.player_discovered_cairn.onInsert(this.cairnInsertListener);
    }

    if (!this.placedExplosiveDeleteListener) {
      this.placedExplosiveDeleteListener = (ctx, explosive) => {
        if (explosive.isDud) {
          return;
        }
        const tier = explosive.explosiveType.tag === 'BabushkaSurprise' ? 'babushka' : 'matriarch';
        triggerExplosionEffect(explosive.posX, explosive.posY, explosive.blastRadius, tier);
        if (isLiveDetonation(ctx, explosive))
          recordWorldExplosion(String(explosive.id), explosive.posX, explosive.posY, explosive.blastRadius, tier === 'matriarch');
      };
      this.activeConnection.db.placed_explosive.onDelete(this.placedExplosiveDeleteListener);
    }

    if (!this.animalCorpseDeleteListener) {
      this.animalCorpseDeleteListener = (_ctx, corpse) => {
        const nowMs = Date.now();
        const despawnAtMs = Number(corpse.despawnAt.microsSinceUnixEpoch / 1000n);
        const deletedBeforeNaturalDespawn = nowMs < (despawnAtMs - 500);
        if (corpse.health === 0 || deletedBeforeNaturalDespawn) {
          triggerAnimalCorpseDestructionEffect(corpse);
        }
      };
      this.activeConnection.db.animal_corpse.onDelete(this.animalCorpseDeleteListener);
    }

    if (!this.wildAnimalInsertListener) {
      this.wildAnimalInsertListener = (_ctx, animal) => {
        if (!animal.isHostileNpc) {
          return;
        }
        const storageKey = 'broth_first_hostile_encounter_played';
        if (localStorage.getItem(storageKey) === 'true' || hasDispatchedHostileEncounterEvent) {
          return;
        }
        hasDispatchedHostileEncounterEvent = true;
        window.dispatchEvent(new CustomEvent('sova-first-hostile-encounter'));
      };
      this.activeConnection.db.wild_animal.onInsert(this.wildAnimalInsertListener);
    }
  }

  stop(): void {
    this.detachListeners();
    this.activeConnection = null;
    this.localPlayerId = null;
    this.playedCairnIds.clear();
    hasDispatchedHostileEncounterEvent = false;
    cleanupCutGrassEffectSystem();
  }

  private grassDestroyed(state: GrassState): void {
    const connection = this.activeConnection;
    if (!connection) return;
    const grass = connection.db.grass.id.find(state.grassId);
    if (!grass) return;
    recordWorldGrassCut(String(state.grassId), grass.posX, grass.posY, grass.appearanceType?.tag ?? '');
    handleGrassStateDestroyed(connection, state);
  }

  private detachListeners(): void {
    if (!this.activeConnection) {
      return;
    }

    if (this.detachGrassCutEvents) { this.detachGrassCutEvents(); this.detachGrassCutEvents = null; }

    if (this.cairnInsertListener) {
      this.activeConnection.db.player_discovered_cairn.removeOnInsert(this.cairnInsertListener);
      this.cairnInsertListener = null;
    }

    if (this.placedExplosiveDeleteListener) {
      this.activeConnection.db.placed_explosive.removeOnDelete(this.placedExplosiveDeleteListener);
      this.placedExplosiveDeleteListener = null;
    }

    if (this.animalCorpseDeleteListener) {
      this.activeConnection.db.animal_corpse.removeOnDelete(this.animalCorpseDeleteListener);
      this.animalCorpseDeleteListener = null;
    }

    if (this.detachBarrelBreakEvents) { this.detachBarrelBreakEvents(); this.detachBarrelBreakEvents = null; }

    if (this.wildAnimalInsertListener) {
      this.activeConnection.db.wild_animal.removeOnInsert(this.wildAnimalInsertListener);
      this.wildAnimalInsertListener = null;
    }
  }
}

export const gameplayEventEffectsRuntime = new GameplayEventEffectsRuntime();
