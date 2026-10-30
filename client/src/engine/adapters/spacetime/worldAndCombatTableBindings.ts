import type { Identity } from 'spacetimedb';
import type * as SpacetimeDB from '../../../generated/types';
import type { Projectile as SpacetimeDBProjectile } from '../../../generated/types';
import type { MutableRef, StateSetter } from '../../types';
import type { GameplayTableBindings } from './gameplayConnectionSetup';
import { recordProjectileDebugEvent } from '../../../utils/projectileDebug';

type MapSetter<T> = StateSetter<Map<string, T>>;
type ValueSetter<T> = StateSetter<T>;
type Ref<T> = MutableRef<T>;

type WorldBindingKey =
  | 'tree'
  | 'stone'
  | 'rune_stone'
  | 'cairn'
  | 'player_discovered_cairn'
  | 'world_state'
  | 'cloud'
  | 'grass'
  | 'grass_state'
  | 'water_patch'
  | 'fertilizer_patch'
  | 'fire_patch'
  | 'placed_explosive'
  | 'sea_stack'
  | 'fumarole'
  | 'basalt_column'
  | 'living_coral'
  | 'chunk_weather'
  | 'drone_event';

type CombatBindingKey =
  | 'player'
  | 'knocked_out_status'
  | 'projectile'
  | 'death_marker'
  | 'player_dodge_roll_state'
  | 'fishing_session'
  | 'sound_event'
  | 'continuous_sound'
  | 'wild_animal'
  | 'animal_corpse'
  | 'caribou_breeding_data'
  | 'walrus_breeding_data'
  | 'caribou_rut_state'
  | 'walrus_rut_state';

type WorldTableBindingGroup = Pick<GameplayTableBindings, WorldBindingKey>;
type CombatTableBindingGroup = Pick<GameplayTableBindings, CombatBindingKey>;

interface CreateWorldTableBindingsOptions {
  connectionIdentity: Identity | null;
  cancelPlacement: () => void;
  hasSpatialSubscription: (chunkIndex: number) => boolean;
  ensureSpatialChunkSubscribed: (chunkIndex: number) => void;
  getSubscribedChunks: () => number[];
  setTrees: MapSetter<SpacetimeDB.Tree>;
  setStones: MapSetter<SpacetimeDB.Stone>;
  setRuneStones: MapSetter<SpacetimeDB.RuneStone>;
  setCairns: MapSetter<SpacetimeDB.Cairn>;
  setPlayerDiscoveredCairns: MapSetter<SpacetimeDB.PlayerDiscoveredCairn>;
  setWorldState: ValueSetter<SpacetimeDB.WorldState | null>;
  setClouds: MapSetter<SpacetimeDB.Cloud>;
  setGrass: MapSetter<SpacetimeDB.Grass>;
  setGrassState: MapSetter<SpacetimeDB.GrassState>;
  setWaterPatches: MapSetter<SpacetimeDB.WaterPatch>;
  setFertilizerPatches: MapSetter<SpacetimeDB.FertilizerPatch>;
  setFirePatches: MapSetter<SpacetimeDB.FirePatch>;
  setPlacedExplosives: MapSetter<SpacetimeDB.PlacedExplosive>;
  setSeaStacks: MapSetter<SpacetimeDB.SeaStack>;
  setFumaroles: MapSetter<SpacetimeDB.Fumarole>;
  setBasaltColumns: MapSetter<SpacetimeDB.BasaltColumn>;
  setLivingCorals: MapSetter<SpacetimeDB.LivingCoral>;
  setChunkWeather: StateSetter<Map<string, any>>;
  setDroneEvents: MapSetter<SpacetimeDB.DroneEvent>;
  treeBatchRef: Ref<SpacetimeDB.Tree[]>;
  treeFlushScheduledRef: Ref<boolean>;
  stoneBatchRef: Ref<SpacetimeDB.Stone[]>;
  stoneFlushScheduledRef: Ref<boolean>;
  chunkWeatherRef: Ref<Map<string, any>>;
  chunkWeatherUpdateTimeoutRef: Ref<ReturnType<typeof setTimeout> | null>;
}

interface CreateCombatTableBindingsOptions {
  connectionIdentity: Identity | null;
  setPlayers: StateSetter<Map<string, SpacetimeDB.Player>>;
  setLocalPlayerRegistered: StateSetter<boolean>;
  setKnockedOutStatus: MapSetter<SpacetimeDB.KnockedOutStatus>;
  setProjectiles: StateSetter<Map<string, SpacetimeDBProjectile>>;
  setDeathMarkers: MapSetter<SpacetimeDB.DeathMarker>;
  setPlayerDodgeRollStates: StateSetter<Map<string, SpacetimeDB.PlayerDodgeRollState>>;
  setFishingSessions: MapSetter<SpacetimeDB.FishingSession>;
  setSoundEvents: MapSetter<SpacetimeDB.SoundEvent>;
  setContinuousSounds: MapSetter<SpacetimeDB.ContinuousSound>;
  setWildAnimals: StateSetter<Map<string, SpacetimeDB.WildAnimal>>;
  setHostileDeathEvents: StateSetter<Array<{ id: string; x: number; y: number; species: string; timestamp: number }>>;
  setAnimalCorpses: MapSetter<SpacetimeDB.AnimalCorpse>;
  setCaribouBreedingData: MapSetter<SpacetimeDB.CaribouBreedingData>;
  setWalrusBreedingData: MapSetter<SpacetimeDB.WalrusBreedingData>;
  setCaribouRutState: ValueSetter<SpacetimeDB.CaribouRutState | null>;
  setWalrusRutState: ValueSetter<SpacetimeDB.WalrusRutState | null>;
  playersRef: Ref<Map<string, SpacetimeDB.Player>>;
  lastPlayerRenderTimeRef: Ref<number>;
  playerRenderPendingRef: Ref<boolean>;
  playerRenderTimerRef: Ref<ReturnType<typeof setTimeout> | null>;
  projectilesRef: Ref<Map<string, SpacetimeDBProjectile>>;
  projectilesUpdateTimeoutRef: Ref<ReturnType<typeof setTimeout> | null>;
  projectileBatchIntervalMs: number;
  playerDodgeRollStatesRef: Ref<Map<string, SpacetimeDB.PlayerDodgeRollState>>;
  wildAnimalsRef: Ref<Map<string, SpacetimeDB.WildAnimal>>;
  wildAnimalsUpdateTimeoutRef: Ref<ReturnType<typeof setTimeout> | null>;
  wildAnimalBatchIntervalMs: number;
  hostileDeathCleanupTimeoutsRef: Ref<Set<ReturnType<typeof setTimeout>>>;
  hostileDeathEventsMax: number;
}

function replaceMapEntry<T>(setter: MapSetter<T>, key: string, value: T): void {
  setter((prev) => new Map(prev).set(key, value));
}

function deleteMapEntry<T>(setter: MapSetter<T>, key: string): void {
  setter((prev) => {
    const next = new Map(prev);
    next.delete(key);
    return next;
  });
}

function upsertMapState<T>(setter: MapSetter<T>, key: string, value: T): void {
  setter((prev) => {
    if (prev.get(key) === value) return prev;
    const next = new Map(prev);
    next.set(key, value);
    return next;
  });
}

function maybeCancelPlacement(
  connectionIdentity: Identity | null,
  placedBy: Identity | null | undefined,
  cancelPlacement: () => void,
): void {
  if (connectionIdentity && placedBy && placedBy.isEqual(connectionIdentity)) {
    cancelPlacement();
  }
}

export function createWorldTableBindings({
  connectionIdentity,
  cancelPlacement,
  hasSpatialSubscription,
  ensureSpatialChunkSubscribed,
  getSubscribedChunks,
  setTrees,
  setStones,
  setRuneStones,
  setCairns,
  setPlayerDiscoveredCairns,
  setWorldState,
  setClouds,
  setGrass,
  setGrassState,
  setWaterPatches,
  setFertilizerPatches,
  setFirePatches,
  setPlacedExplosives,
  setSeaStacks,
  setFumaroles,
  setBasaltColumns,
  setLivingCorals,
  setChunkWeather,
  setDroneEvents,
  treeBatchRef,
  treeFlushScheduledRef,
  stoneBatchRef,
  stoneFlushScheduledRef,
  chunkWeatherRef,
  chunkWeatherUpdateTimeoutRef,
}: CreateWorldTableBindingsOptions): WorldTableBindingGroup {
  const scheduleChunkWeatherUpdate = () => {
    if (chunkWeatherUpdateTimeoutRef.current) return;
    chunkWeatherUpdateTimeoutRef.current = setTimeout(() => {
      setChunkWeather(new Map(chunkWeatherRef.current));
      chunkWeatherUpdateTimeoutRef.current = null;
    }, 250);
  };

  return {
    tree: {
      onInsert: (_ctx: any, tree: SpacetimeDB.Tree) => {
        treeBatchRef.current.push(tree);
        if (!treeFlushScheduledRef.current) {
          treeFlushScheduledRef.current = true;
          queueMicrotask(() => {
            const batch = treeBatchRef.current;
            treeBatchRef.current = [];
            treeFlushScheduledRef.current = false;
            setTrees((prev) => {
              const next = new Map(prev);
              for (const value of batch) next.set(value.id.toString(), value);
              return next;
            });
          });
        }
      },
      onUpdate: (_ctx: any, oldTree: SpacetimeDB.Tree, newTree: SpacetimeDB.Tree) => {
        const visuallySignificant =
          Math.abs(oldTree.posX - newTree.posX) > 0.1 ||
          Math.abs(oldTree.posY - newTree.posY) > 0.1 ||
          Math.abs(oldTree.health - newTree.health) > 0.1 ||
          oldTree.treeType !== newTree.treeType ||
          (oldTree.respawnAt?.microsSinceUnixEpoch ?? 0n) !== (newTree.respawnAt?.microsSinceUnixEpoch ?? 0n);
        if (visuallySignificant) {
          replaceMapEntry(setTrees, newTree.id.toString(), newTree);
        }
      },
      onDelete: (_ctx: any, tree: SpacetimeDB.Tree) => deleteMapEntry(setTrees, tree.id.toString()),
    },
    stone: {
      onInsert: (_ctx: any, stone: SpacetimeDB.Stone) => {
        stoneBatchRef.current.push(stone);
        if (!stoneFlushScheduledRef.current) {
          stoneFlushScheduledRef.current = true;
          queueMicrotask(() => {
            const batch = stoneBatchRef.current;
            stoneBatchRef.current = [];
            stoneFlushScheduledRef.current = false;
            setStones((prev) => {
              const next = new Map(prev);
              for (const value of batch) next.set(value.id.toString(), value);
              return next;
            });
          });
        }
      },
      onUpdate: (_ctx: any, oldStone: SpacetimeDB.Stone, newStone: SpacetimeDB.Stone) => {
        const visuallySignificant =
          Math.abs(oldStone.posX - newStone.posX) > 0.1 ||
          Math.abs(oldStone.posY - newStone.posY) > 0.1 ||
          Math.abs(oldStone.health - newStone.health) > 0.1 ||
          (oldStone.respawnAt?.microsSinceUnixEpoch ?? 0n) !== (newStone.respawnAt?.microsSinceUnixEpoch ?? 0n);
        if (visuallySignificant) {
          replaceMapEntry(setStones, newStone.id.toString(), newStone);
        }
      },
      onDelete: (_ctx: any, stone: SpacetimeDB.Stone) => deleteMapEntry(setStones, stone.id.toString()),
    },
    rune_stone: {
      onInsert: (_ctx: any, runeStone: SpacetimeDB.RuneStone) => replaceMapEntry(setRuneStones, runeStone.id.toString(), runeStone),
      onUpdate: (_ctx: any, oldRuneStone: SpacetimeDB.RuneStone, newRuneStone: SpacetimeDB.RuneStone) => {
        const visuallySignificant =
          Math.abs(oldRuneStone.posX - newRuneStone.posX) > 0.1 ||
          Math.abs(oldRuneStone.posY - newRuneStone.posY) > 0.1 ||
          oldRuneStone.runeType !== newRuneStone.runeType;
        if (visuallySignificant) {
          replaceMapEntry(setRuneStones, newRuneStone.id.toString(), newRuneStone);
        }
      },
      onDelete: (_ctx: any, runeStone: SpacetimeDB.RuneStone) => deleteMapEntry(setRuneStones, runeStone.id.toString()),
    },
    cairn: {
      onInsert: (_ctx: any, cairn: SpacetimeDB.Cairn) => replaceMapEntry(setCairns, cairn.id.toString(), cairn),
      onUpdate: (_ctx: any, oldCairn: SpacetimeDB.Cairn, newCairn: SpacetimeDB.Cairn) => {
        const visuallySignificant =
          Math.abs(oldCairn.posX - newCairn.posX) > 0.1 ||
          Math.abs(oldCairn.posY - newCairn.posY) > 0.1 ||
          oldCairn.loreId !== newCairn.loreId;
        if (visuallySignificant) {
          replaceMapEntry(setCairns, newCairn.id.toString(), newCairn);
        }
      },
      onDelete: (_ctx: any, cairn: SpacetimeDB.Cairn) => deleteMapEntry(setCairns, cairn.id.toString()),
    },
    player_discovered_cairn: {
      onInsert: (_ctx: any, discovery: SpacetimeDB.PlayerDiscoveredCairn) => {
        console.log(`[useSpacetimeTables] PlayerDiscoveredCairn INSERT: id=${discovery.id}, cairnId=${discovery.cairnId}, playerIdentity=${discovery.playerIdentity?.toHexString()?.slice(0, 16)}...`);
        setPlayerDiscoveredCairns((prev) => {
          const next = new Map(prev).set(discovery.id.toString(), discovery);
          console.log(`[useSpacetimeTables] PlayerDiscoveredCairns map now has ${next.size} entries`);
          return next;
        });
      },
      onUpdate: (_ctx: any, _oldDiscovery: SpacetimeDB.PlayerDiscoveredCairn, newDiscovery: SpacetimeDB.PlayerDiscoveredCairn) => {
        console.log(`[useSpacetimeTables] PlayerDiscoveredCairn UPDATE: id=${newDiscovery.id}`);
        replaceMapEntry(setPlayerDiscoveredCairns, newDiscovery.id.toString(), newDiscovery);
      },
      onDelete: (_ctx: any, discovery: SpacetimeDB.PlayerDiscoveredCairn) => {
        console.log(`[useSpacetimeTables] PlayerDiscoveredCairn DELETE: id=${discovery.id}`);
        deleteMapEntry(setPlayerDiscoveredCairns, discovery.id.toString());
      },
    },
    world_state: {
      onInsert: (_ctx: any, state: SpacetimeDB.WorldState) => setWorldState(state),
      onUpdate: (_ctx: any, oldState: SpacetimeDB.WorldState, newState: SpacetimeDB.WorldState) => {
        const timeTagChanged = (oldState.timeOfDay?.tag ?? '') !== (newState.timeOfDay?.tag ?? '');
        const significantChange =
          timeTagChanged ||
          oldState.cycleProgress !== newState.cycleProgress ||
          oldState.isFullMoon !== newState.isFullMoon ||
          oldState.cycleCount !== newState.cycleCount;
        if (significantChange) setWorldState(newState);
      },
      onDelete: () => setWorldState(null),
    },
    cloud: {
      onInsert: (_ctx: any, cloud: SpacetimeDB.Cloud) => replaceMapEntry(setClouds, cloud.id.toString(), cloud),
      onUpdate: (_ctx: any, _oldCloud: SpacetimeDB.Cloud, newCloud: SpacetimeDB.Cloud) => replaceMapEntry(setClouds, newCloud.id.toString(), newCloud),
      onDelete: (_ctx: any, cloud: SpacetimeDB.Cloud) => deleteMapEntry(setClouds, cloud.id.toString()),
    },
    grass: {
      onInsert: (_ctx: any, item: SpacetimeDB.Grass) => upsertMapState(setGrass, item.id.toString(), item),
      onUpdate: (_ctx: any, _oldItem: SpacetimeDB.Grass, newItem: SpacetimeDB.Grass) => upsertMapState(setGrass, newItem.id.toString(), newItem),
      onDelete: (_ctx: any, item: SpacetimeDB.Grass) => deleteMapEntry(setGrass, item.id.toString()),
    },
    grass_state: {
      onInsert: (_ctx: any, item: SpacetimeDB.GrassState) => replaceMapEntry(setGrassState, item.grassId.toString(), item),
      onUpdate: (_ctx: any, oldItem: SpacetimeDB.GrassState, newItem: SpacetimeDB.GrassState) => {
        const hasChanges = oldItem.isAlive !== newItem.isAlive || oldItem.respawnAt !== newItem.respawnAt;
        if (hasChanges) {
          replaceMapEntry(setGrassState, newItem.grassId.toString(), newItem);
        }
      },
      onDelete: (_ctx: any, item: SpacetimeDB.GrassState) => deleteMapEntry(setGrassState, item.grassId.toString()),
    },
    water_patch: {
      onInsert: (_ctx: any, waterPatch: SpacetimeDB.WaterPatch) => {
        if (connectionIdentity && !hasSpatialSubscription(waterPatch.chunkIndex)) {
          console.log(`[WATER_PATCH] Received water patch insert for chunk ${waterPatch.chunkIndex} but not subscribed - subscribing now`);
          ensureSpatialChunkSubscribed(waterPatch.chunkIndex);
        }
        replaceMapEntry(setWaterPatches, waterPatch.id.toString(), waterPatch);
      },
      onUpdate: (_ctx: any, _oldWaterPatch: SpacetimeDB.WaterPatch, newWaterPatch: SpacetimeDB.WaterPatch) =>
        replaceMapEntry(setWaterPatches, newWaterPatch.id.toString(), newWaterPatch),
      onDelete: (_ctx: any, waterPatch: SpacetimeDB.WaterPatch) => deleteMapEntry(setWaterPatches, waterPatch.id.toString()),
    },
    fertilizer_patch: {
      onInsert: (_ctx: any, fertilizerPatch: SpacetimeDB.FertilizerPatch) => {
        if (connectionIdentity && !hasSpatialSubscription(fertilizerPatch.chunkIndex)) {
          console.log(`[FERTILIZER_PATCH] Received fertilizer patch insert for chunk ${fertilizerPatch.chunkIndex} but not subscribed - subscribing now`);
          ensureSpatialChunkSubscribed(fertilizerPatch.chunkIndex);
        }
        replaceMapEntry(setFertilizerPatches, fertilizerPatch.id.toString(), fertilizerPatch);
      },
      onUpdate: (_ctx: any, _oldFertilizerPatch: SpacetimeDB.FertilizerPatch, newFertilizerPatch: SpacetimeDB.FertilizerPatch) =>
        replaceMapEntry(setFertilizerPatches, newFertilizerPatch.id.toString(), newFertilizerPatch),
      onDelete: (_ctx: any, fertilizerPatch: SpacetimeDB.FertilizerPatch) => deleteMapEntry(setFertilizerPatches, fertilizerPatch.id.toString()),
    },
    fire_patch: {
      onInsert: (_ctx: any, firePatch: SpacetimeDB.FirePatch) => {
        console.log(`[FIRE_PATCH] Insert callback: fire patch ${firePatch.id} at chunk ${firePatch.chunkIndex}, pos (${firePatch.posX.toFixed(1)}, ${firePatch.posY.toFixed(1)})`);
        if (connectionIdentity && !hasSpatialSubscription(firePatch.chunkIndex)) {
          console.log(`[FIRE_PATCH] Received fire patch insert for chunk ${firePatch.chunkIndex} but not subscribed - subscribing now`);
          ensureSpatialChunkSubscribed(firePatch.chunkIndex);
        }
        setFirePatches((prev) => {
          const next = new Map(prev).set(firePatch.id.toString(), firePatch);
          console.log(`[FIRE_PATCH] State updated, total fire patches: ${next.size}`);
          return next;
        });
      },
      onUpdate: (_ctx: any, _oldFirePatch: SpacetimeDB.FirePatch, newFirePatch: SpacetimeDB.FirePatch) =>
        replaceMapEntry(setFirePatches, newFirePatch.id.toString(), newFirePatch),
      onDelete: (_ctx: any, firePatch: SpacetimeDB.FirePatch) => deleteMapEntry(setFirePatches, firePatch.id.toString()),
    },
    placed_explosive: {
      onInsert: (_ctx: any, explosive: SpacetimeDB.PlacedExplosive) => {
        const subscribedChunks = getSubscribedChunks().sort((a, b) => a - b);
        const isChunkSubscribed = subscribedChunks.includes(explosive.chunkIndex);
        console.log(`[EXPLOSIVE INSERT] id=${explosive.id}, type=${explosive.explosiveType.tag}, pos=(${explosive.posX.toFixed(1)}, ${explosive.posY.toFixed(1)}), chunk=${explosive.chunkIndex}`);
        console.log(`[EXPLOSIVE INSERT] Subscribed chunks: [${subscribedChunks.slice(0, 20).join(', ')}${subscribedChunks.length > 20 ? '...' : ''}] (total: ${subscribedChunks.length})`);
        console.log(`[EXPLOSIVE INSERT] Chunk ${explosive.chunkIndex} is ${isChunkSubscribed ? 'IN' : 'NOT IN'} subscribed chunks`);
        replaceMapEntry(setPlacedExplosives, explosive.id.toString(), explosive);
        maybeCancelPlacement(connectionIdentity, explosive.placedBy, cancelPlacement);
      },
      onUpdate: (_ctx: any, _oldExplosive: SpacetimeDB.PlacedExplosive, newExplosive: SpacetimeDB.PlacedExplosive) =>
        replaceMapEntry(setPlacedExplosives, newExplosive.id.toString(), newExplosive),
      onDelete: (_ctx: any, explosive: SpacetimeDB.PlacedExplosive) => deleteMapEntry(setPlacedExplosives, explosive.id.toString()),
    },
    sea_stack: {
      onInsert: (_ctx: any, seaStack: SpacetimeDB.SeaStack) => replaceMapEntry(setSeaStacks, seaStack.id.toString(), seaStack),
      onUpdate: (_ctx: any, _oldSeaStack: SpacetimeDB.SeaStack, newSeaStack: SpacetimeDB.SeaStack) => replaceMapEntry(setSeaStacks, newSeaStack.id.toString(), newSeaStack),
      onDelete: (_ctx: any, seaStack: SpacetimeDB.SeaStack) => deleteMapEntry(setSeaStacks, seaStack.id.toString()),
    },
    fumarole: {
      onInsert: (_ctx: any, fumarole: SpacetimeDB.Fumarole) => replaceMapEntry(setFumaroles, fumarole.id.toString(), fumarole),
      onUpdate: (_ctx: any, oldFumarole: SpacetimeDB.Fumarole, newFumarole: SpacetimeDB.Fumarole) => {
        const visuallySignificant =
          Math.abs(oldFumarole.posX - newFumarole.posX) > 0.1 ||
          Math.abs(oldFumarole.posY - newFumarole.posY) > 0.1 ||
          oldFumarole.attachedBrothPotId !== newFumarole.attachedBrothPotId ||
          oldFumarole.slotInstanceId0 !== newFumarole.slotInstanceId0 ||
          oldFumarole.slotDefId0 !== newFumarole.slotDefId0 ||
          oldFumarole.slotInstanceId1 !== newFumarole.slotInstanceId1 ||
          oldFumarole.slotDefId1 !== newFumarole.slotDefId1 ||
          oldFumarole.slotInstanceId2 !== newFumarole.slotInstanceId2 ||
          oldFumarole.slotDefId2 !== newFumarole.slotDefId2 ||
          oldFumarole.slotInstanceId3 !== newFumarole.slotInstanceId3 ||
          oldFumarole.slotDefId3 !== newFumarole.slotDefId3 ||
          oldFumarole.slotInstanceId4 !== newFumarole.slotInstanceId4 ||
          oldFumarole.slotDefId4 !== newFumarole.slotDefId4 ||
          oldFumarole.slotInstanceId5 !== newFumarole.slotInstanceId5 ||
          oldFumarole.slotDefId5 !== newFumarole.slotDefId5;
        if (visuallySignificant) {
          replaceMapEntry(setFumaroles, newFumarole.id.toString(), newFumarole);
        }
      },
      onDelete: (_ctx: any, fumarole: SpacetimeDB.Fumarole) => deleteMapEntry(setFumaroles, fumarole.id.toString()),
    },
    basalt_column: {
      onInsert: (_ctx: any, basaltColumn: SpacetimeDB.BasaltColumn) => replaceMapEntry(setBasaltColumns, basaltColumn.id.toString(), basaltColumn),
      onUpdate: (_ctx: any, oldBasaltColumn: SpacetimeDB.BasaltColumn, newBasaltColumn: SpacetimeDB.BasaltColumn) => {
        const visuallySignificant =
          Math.abs(oldBasaltColumn.posX - newBasaltColumn.posX) > 0.1 ||
          Math.abs(oldBasaltColumn.posY - newBasaltColumn.posY) > 0.1 ||
          oldBasaltColumn.columnType !== newBasaltColumn.columnType;
        if (visuallySignificant) {
          replaceMapEntry(setBasaltColumns, newBasaltColumn.id.toString(), newBasaltColumn);
        }
      },
      onDelete: (_ctx: any, basaltColumn: SpacetimeDB.BasaltColumn) => deleteMapEntry(setBasaltColumns, basaltColumn.id.toString()),
    },
    living_coral: {
      onInsert: (_ctx: any, coral: SpacetimeDB.LivingCoral) => replaceMapEntry(setLivingCorals, coral.id.toString(), coral),
      onUpdate: (_ctx: any, oldCoral: SpacetimeDB.LivingCoral, newCoral: SpacetimeDB.LivingCoral) => {
        const visuallySignificant =
          Math.abs(oldCoral.posX - newCoral.posX) > 0.1 ||
          Math.abs(oldCoral.posY - newCoral.posY) > 0.1 ||
          oldCoral.resourceRemaining !== newCoral.resourceRemaining ||
          (oldCoral.respawnAt?.microsSinceUnixEpoch ?? 0n) !== (newCoral.respawnAt?.microsSinceUnixEpoch ?? 0n);
        if (visuallySignificant) {
          replaceMapEntry(setLivingCorals, newCoral.id.toString(), newCoral);
        }
      },
      onDelete: (_ctx: any, coral: SpacetimeDB.LivingCoral) => deleteMapEntry(setLivingCorals, coral.id.toString()),
    },
    chunk_weather: {
      onInsert: (_ctx: any, weather: any) => {
        chunkWeatherRef.current.set(weather.chunkIndex.toString(), weather);
        scheduleChunkWeatherUpdate();
      },
      onUpdate: (_ctx: any, _oldWeather: any, newWeather: any) => {
        chunkWeatherRef.current.set(newWeather.chunkIndex.toString(), newWeather);
        scheduleChunkWeatherUpdate();
      },
      onDelete: (_ctx: any, weather: any) => {
        chunkWeatherRef.current.delete(weather.chunkIndex.toString());
        scheduleChunkWeatherUpdate();
      },
    },
    drone_event: {
      onInsert: (_ctx: any, event: SpacetimeDB.DroneEvent) => replaceMapEntry(setDroneEvents, event.id.toString(), event),
      onDelete: (_ctx: any, event: SpacetimeDB.DroneEvent) => deleteMapEntry(setDroneEvents, event.id.toString()),
    },
  };
}

export function createCombatTableBindings({
  connectionIdentity,
  setPlayers,
  setLocalPlayerRegistered,
  setKnockedOutStatus,
  setProjectiles,
  setDeathMarkers,
  setPlayerDodgeRollStates,
  setFishingSessions,
  setSoundEvents,
  setContinuousSounds,
  setWildAnimals,
  setHostileDeathEvents,
  setAnimalCorpses,
  setCaribouBreedingData,
  setWalrusBreedingData,
  setCaribouRutState,
  setWalrusRutState,
  playersRef,
  lastPlayerRenderTimeRef,
  playerRenderPendingRef,
  playerRenderTimerRef,
  projectilesRef,
  projectilesUpdateTimeoutRef,
  projectileBatchIntervalMs,
  playerDodgeRollStatesRef,
  wildAnimalsRef,
  wildAnimalsUpdateTimeoutRef,
  wildAnimalBatchIntervalMs,
  hostileDeathCleanupTimeoutsRef,
  hostileDeathEventsMax,
}: CreateCombatTableBindingsOptions): CombatTableBindingGroup {
  const scheduleProjectileUpdate = () => {
    if (projectilesUpdateTimeoutRef.current) return;
    projectilesUpdateTimeoutRef.current = setTimeout(() => {
      setProjectiles(new Map(projectilesRef.current));
      projectilesUpdateTimeoutRef.current = null;
    }, projectileBatchIntervalMs);
  };

  const scheduleWildAnimalUpdate = () => {
    if (wildAnimalsUpdateTimeoutRef.current) return;
    wildAnimalsUpdateTimeoutRef.current = setTimeout(() => {
      setWildAnimals(new Map(wildAnimalsRef.current));
      wildAnimalsUpdateTimeoutRef.current = null;
    }, wildAnimalBatchIntervalMs);
  };

  return {
    player: {
      onInsert: (_ctx: any, player: SpacetimeDB.Player) => {
        playersRef.current.set(player.identity.toHexString(), player);
        setPlayers(new Map(playersRef.current));
        if (connectionIdentity && player.identity.toHexString() === connectionIdentity.toHexString()) {
          console.log('[useSpacetimeTables] Local player matched! Setting localPlayerRegistered = true.');
          setLocalPlayerRegistered(true);
        }
      },
      onUpdate: (_ctx: any, oldPlayer: SpacetimeDB.Player, newPlayer: SpacetimeDB.Player) => {
        const playerHexId = newPlayer.identity.toHexString();
        playersRef.current.set(playerHexId, newPlayer);

        const oldLastHitTimeMicros = oldPlayer.lastHitTime ? BigInt(oldPlayer.lastHitTime.__timestamp_micros_since_unix_epoch__) : null;
        const newLastHitTimeMicros = newPlayer.lastHitTime ? BigInt(newPlayer.lastHitTime.__timestamp_micros_since_unix_epoch__) : null;
        const lastHitTimeChanged = oldLastHitTimeMicros !== newLastHitTimeMicros;
        const statsChanged =
          Math.round(oldPlayer.health) !== Math.round(newPlayer.health) ||
          Math.round(oldPlayer.stamina) !== Math.round(newPlayer.stamina) ||
          Math.round(oldPlayer.hunger) !== Math.round(newPlayer.hunger) ||
          Math.round(oldPlayer.thirst) !== Math.round(newPlayer.thirst) ||
          Math.round(oldPlayer.warmth) !== Math.round(newPlayer.warmth);
        const stateChanged =
          oldPlayer.isSprinting !== newPlayer.isSprinting ||
          oldPlayer.direction !== newPlayer.direction ||
          oldPlayer.jumpStartTimeMs !== newPlayer.jumpStartTimeMs ||
          oldPlayer.isDead !== newPlayer.isDead ||
          oldPlayer.isTorchLit !== newPlayer.isTorchLit ||
          oldPlayer.isHeadlampLit !== newPlayer.isHeadlampLit;
        const onlineStatusChanged = oldPlayer.isOnline !== newPlayer.isOnline;
        const usernameChanged = oldPlayer.username !== newPlayer.username;
        const isImmediate = statsChanged || stateChanged || onlineStatusChanged || usernameChanged || lastHitTimeChanged;

        if (isImmediate) {
          if (playerRenderTimerRef.current) {
            clearTimeout(playerRenderTimerRef.current);
            playerRenderTimerRef.current = null;
          }
          setPlayers(new Map(playersRef.current));
          lastPlayerRenderTimeRef.current = performance.now();
          playerRenderPendingRef.current = false;
          return;
        }

        const now = performance.now();
        const timeSinceLastRender = now - lastPlayerRenderTimeRef.current;
        if (timeSinceLastRender >= 50) {
          setPlayers(new Map(playersRef.current));
          lastPlayerRenderTimeRef.current = now;
          playerRenderPendingRef.current = false;
          if (playerRenderTimerRef.current) {
            clearTimeout(playerRenderTimerRef.current);
            playerRenderTimerRef.current = null;
          }
        } else if (!playerRenderPendingRef.current) {
          playerRenderPendingRef.current = true;
          const remainingMs = 50 - timeSinceLastRender;
          playerRenderTimerRef.current = setTimeout(() => {
            setPlayers(new Map(playersRef.current));
            lastPlayerRenderTimeRef.current = performance.now();
            playerRenderPendingRef.current = false;
            playerRenderTimerRef.current = null;
          }, remainingMs);
        }
      },
      onDelete: (_ctx: any, deletedPlayer: SpacetimeDB.Player) => {
        playersRef.current.delete(deletedPlayer.identity.toHexString());
        setPlayers(new Map(playersRef.current));
        if (connectionIdentity && deletedPlayer.identity && deletedPlayer.identity.isEqual(connectionIdentity)) {
          console.warn('[useSpacetimeTables] Local player deleted from server.');
          setLocalPlayerRegistered(false);
        }
      },
    },
    knocked_out_status: {
      onInsert: (_ctx: any, status: SpacetimeDB.KnockedOutStatus) => replaceMapEntry(setKnockedOutStatus, status.playerId.toHexString(), status),
      onUpdate: (_ctx: any, _oldStatus: SpacetimeDB.KnockedOutStatus, newStatus: SpacetimeDB.KnockedOutStatus) =>
        replaceMapEntry(setKnockedOutStatus, newStatus.playerId.toHexString(), newStatus),
      onDelete: (_ctx: any, status: SpacetimeDB.KnockedOutStatus) => deleteMapEntry(setKnockedOutStatus, status.playerId.toHexString()),
    },
    projectile: {
      onInsert: (_ctx: any, projectile: SpacetimeDBProjectile) => {
        projectilesRef.current.set(projectile.id.toString(), projectile);
        const localIdentity = connectionIdentity?.toHexString?.();
        const ownerId = projectile.ownerId?.toHexString?.();
        if (localIdentity && ownerId === localIdentity && projectile.sourceType === 0) {
          recordProjectileDebugEvent('table-insert', {
            id: projectile.id.toString(),
            clientShotId: projectile.clientShotId,
            ownerId,
            startPosX: projectile.startPosX,
            startPosY: projectile.startPosY,
            velocityX: projectile.velocityX,
            velocityY: projectile.velocityY,
          });
        }
        setProjectiles(new Map(projectilesRef.current));
      },
      onUpdate: (_ctx: any, _oldProjectile: SpacetimeDBProjectile, newProjectile: SpacetimeDBProjectile) => {
        projectilesRef.current.set(newProjectile.id.toString(), newProjectile);
        scheduleProjectileUpdate();
      },
      onDelete: (_ctx: any, projectile: SpacetimeDBProjectile) => {
        const localIdentity = connectionIdentity?.toHexString?.();
        const ownerId = projectile.ownerId?.toHexString?.();
        if (localIdentity && ownerId === localIdentity && projectile.sourceType === 0) {
          recordProjectileDebugEvent('table-delete', {
            id: projectile.id.toString(),
            clientShotId: projectile.clientShotId,
            ownerId,
          });
        }
        projectilesRef.current.delete(projectile.id.toString());
        scheduleProjectileUpdate();
      },
    },
    death_marker: {
      onInsert: (_ctx: any, marker: SpacetimeDB.DeathMarker) => replaceMapEntry(setDeathMarkers, marker.playerId.toHexString(), marker),
      onUpdate: (_ctx: any, _oldMarker: SpacetimeDB.DeathMarker, newMarker: SpacetimeDB.DeathMarker) =>
        replaceMapEntry(setDeathMarkers, newMarker.playerId.toHexString(), newMarker),
      onDelete: (_ctx: any, marker: SpacetimeDB.DeathMarker) => deleteMapEntry(setDeathMarkers, marker.playerId.toHexString()),
    },
    player_dodge_roll_state: {
      onInsert: (_ctx: any, dodgeState: SpacetimeDB.PlayerDodgeRollState) => {
        const playerKey = dodgeState.playerId.toHexString();
        const existingState = playerDodgeRollStatesRef.current.get(playerKey) as any;
        const clientReceptionTimeMs =
          existingState && existingState.startTimeMs === dodgeState.startTimeMs
            ? existingState.clientReceptionTimeMs
            : Date.now();
        const stateWithReceptionTime = { ...dodgeState, clientReceptionTimeMs };
        playerDodgeRollStatesRef.current.set(playerKey, stateWithReceptionTime as any);
        setPlayerDodgeRollStates(new Map(playerDodgeRollStatesRef.current));
      },
      onUpdate: (_ctx: any, _oldDodgeState: SpacetimeDB.PlayerDodgeRollState, newDodgeState: SpacetimeDB.PlayerDodgeRollState) => {
        const playerKey = newDodgeState.playerId.toHexString();
        const existingState = playerDodgeRollStatesRef.current.get(playerKey) as any;
        const clientReceptionTimeMs =
          existingState && existingState.startTimeMs === newDodgeState.startTimeMs
            ? existingState.clientReceptionTimeMs
            : Date.now();
        const stateWithReceptionTime = { ...newDodgeState, clientReceptionTimeMs };
        playerDodgeRollStatesRef.current.set(playerKey, stateWithReceptionTime as any);
        setPlayerDodgeRollStates(new Map(playerDodgeRollStatesRef.current));
      },
      onDelete: (_ctx: any, dodgeState: SpacetimeDB.PlayerDodgeRollState) => {
        playerDodgeRollStatesRef.current.delete(dodgeState.playerId.toHexString());
        setPlayerDodgeRollStates(new Map(playerDodgeRollStatesRef.current));
      },
    },
    fishing_session: {
      onInsert: (_ctx: any, session: SpacetimeDB.FishingSession) => replaceMapEntry(setFishingSessions, session.playerId.toHexString(), session),
      onUpdate: (_ctx: any, _oldSession: SpacetimeDB.FishingSession, newSession: SpacetimeDB.FishingSession) => {
        console.log('[useSpacetimeTables] FishingSession UPDATE:', newSession.playerId.toHexString());
        replaceMapEntry(setFishingSessions, newSession.playerId.toHexString(), newSession);
      },
      onDelete: (_ctx: any, session: SpacetimeDB.FishingSession) => {
        console.log('[useSpacetimeTables] FishingSession DELETE:', session.playerId.toHexString());
        deleteMapEntry(setFishingSessions, session.playerId.toHexString());
      },
    },
    sound_event: {
      onInsert: (_ctx: any, soundEvent: SpacetimeDB.SoundEvent) => replaceMapEntry(setSoundEvents, soundEvent.id.toString(), soundEvent),
      onUpdate: (_ctx: any, _oldSoundEvent: SpacetimeDB.SoundEvent, newSoundEvent: SpacetimeDB.SoundEvent) =>
        replaceMapEntry(setSoundEvents, newSoundEvent.id.toString(), newSoundEvent),
      onDelete: (_ctx: any, soundEvent: SpacetimeDB.SoundEvent) => deleteMapEntry(setSoundEvents, soundEvent.id.toString()),
    },
    continuous_sound: {
      onInsert: (_ctx: any, continuousSound: SpacetimeDB.ContinuousSound) =>
        replaceMapEntry(setContinuousSounds, continuousSound.objectId.toString(), continuousSound),
      onUpdate: (_ctx: any, _oldContinuousSound: SpacetimeDB.ContinuousSound, newContinuousSound: SpacetimeDB.ContinuousSound) =>
        replaceMapEntry(setContinuousSounds, newContinuousSound.objectId.toString(), newContinuousSound),
      onDelete: (_ctx: any, continuousSound: SpacetimeDB.ContinuousSound) => deleteMapEntry(setContinuousSounds, continuousSound.objectId.toString()),
    },
    wild_animal: {
      onInsert: (_ctx: any, animal: SpacetimeDB.WildAnimal) => {
        wildAnimalsRef.current.set(animal.id.toString(), animal);
        scheduleWildAnimalUpdate();
      },
      onUpdate: (_ctx: any, _oldAnimal: SpacetimeDB.WildAnimal, newAnimal: SpacetimeDB.WildAnimal) => {
        wildAnimalsRef.current.set(newAnimal.id.toString(), newAnimal);
        scheduleWildAnimalUpdate();
      },
      onDelete: (_ctx: any, animal: SpacetimeDB.WildAnimal) => {
        if (animal.isHostileNpc) {
          const speciesTag = (animal.species as { tag?: string })?.tag ?? String(animal.species);
          const deathEvent = {
            id: `death-${animal.id}-${Date.now()}`,
            x: animal.posX,
            y: animal.posY,
            species: speciesTag,
            timestamp: Date.now(),
          };
          setHostileDeathEvents((prev) => {
            const next = [...prev, deathEvent];
            return next.length > hostileDeathEventsMax ? next.slice(-hostileDeathEventsMax) : next;
          });
          const timeoutId = setTimeout(() => {
            hostileDeathCleanupTimeoutsRef.current.delete(timeoutId);
            setHostileDeathEvents((prev) => prev.filter((entry) => entry.id !== deathEvent.id));
          }, 3000);
          hostileDeathCleanupTimeoutsRef.current.add(timeoutId);
        }
        wildAnimalsRef.current.delete(animal.id.toString());
        scheduleWildAnimalUpdate();
      },
    },
    animal_corpse: {
      onInsert: (_ctx: any, corpse: SpacetimeDB.AnimalCorpse) => replaceMapEntry(setAnimalCorpses, corpse.id.toString(), corpse),
      onUpdate: (_ctx: any, _oldCorpse: SpacetimeDB.AnimalCorpse, newCorpse: SpacetimeDB.AnimalCorpse) => replaceMapEntry(setAnimalCorpses, newCorpse.id.toString(), newCorpse),
      onDelete: (_ctx: any, corpse: SpacetimeDB.AnimalCorpse) => deleteMapEntry(setAnimalCorpses, corpse.id.toString()),
    },
    caribou_breeding_data: {
      onInsert: (_ctx: any, data: SpacetimeDB.CaribouBreedingData) => replaceMapEntry(setCaribouBreedingData, data.animalId.toString(), data),
      onUpdate: (_ctx: any, _oldData: SpacetimeDB.CaribouBreedingData, newData: SpacetimeDB.CaribouBreedingData) =>
        replaceMapEntry(setCaribouBreedingData, newData.animalId.toString(), newData),
      onDelete: (_ctx: any, data: SpacetimeDB.CaribouBreedingData) => deleteMapEntry(setCaribouBreedingData, data.animalId.toString()),
    },
    walrus_breeding_data: {
      onInsert: (_ctx: any, data: SpacetimeDB.WalrusBreedingData) => replaceMapEntry(setWalrusBreedingData, data.animalId.toString(), data),
      onUpdate: (_ctx: any, _oldData: SpacetimeDB.WalrusBreedingData, newData: SpacetimeDB.WalrusBreedingData) =>
        replaceMapEntry(setWalrusBreedingData, newData.animalId.toString(), newData),
      onDelete: (_ctx: any, data: SpacetimeDB.WalrusBreedingData) => deleteMapEntry(setWalrusBreedingData, data.animalId.toString()),
    },
    caribou_rut_state: {
      onInsert: (_ctx: any, data: SpacetimeDB.CaribouRutState) => setCaribouRutState(data),
      onUpdate: (_ctx: any, _oldData: SpacetimeDB.CaribouRutState, newData: SpacetimeDB.CaribouRutState) => setCaribouRutState(newData),
      onDelete: () => setCaribouRutState(null),
    },
    walrus_rut_state: {
      onInsert: (_ctx: any, data: SpacetimeDB.WalrusRutState) => setWalrusRutState(data),
      onUpdate: (_ctx: any, _oldData: SpacetimeDB.WalrusRutState, newData: SpacetimeDB.WalrusRutState) => setWalrusRutState(newData),
      onDelete: () => setWalrusRutState(null),
    },
  };
}
