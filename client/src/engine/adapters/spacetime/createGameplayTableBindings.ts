import type { Identity } from 'spacetimedb';
import type { DbConnection } from '../../../generated';
import type * as SpacetimeDB from '../../../generated/types';
import type { MutableRef, StateSetter } from '../../types';
import type {
  Projectile as SpacetimeDBProjectile,
  RangedWeaponStats as SpacetimeDBRangedWeaponStats,
} from '../../../generated/types';
import type { GameplayTableBindings } from './gameplayConnectionSetup';
import { composeGameplayTableBindings } from './gameplayTableBindings';
import { createProgressionTableBindings } from './progressionTableBindings';
import {
  createItemsTableBindings,
  createStructuresTableBindings,
} from './structureAndItemTableBindings';
import {
  createCombatTableBindings,
  createWorldTableBindings,
} from './worldAndCombatTableBindings';

type MapSetter<T> = StateSetter<Map<string, T>>;
type ValueSetter<T> = StateSetter<T>;
type Ref<T> = MutableRef<T>;

interface CreateGameplayTableBindingsOptions {
  connection: DbConnection;
  connectionIdentity: Identity | null;
  cancelPlacement: () => void;
  hasSpatialSubscription: (chunkIndex: number) => boolean;
  ensureSpatialChunkSubscribed: (chunkIndex: number) => void;
  getSubscribedChunks: () => number[];
  setPlayers: MapSetter<SpacetimeDB.Player>;
  setTrees: MapSetter<SpacetimeDB.Tree>;
  setStones: MapSetter<SpacetimeDB.Stone>;
  setRuneStones: MapSetter<SpacetimeDB.RuneStone>;
  setCairns: MapSetter<SpacetimeDB.Cairn>;
  setPlayerDiscoveredCairns: MapSetter<SpacetimeDB.PlayerDiscoveredCairn>;
  setCampfires: MapSetter<SpacetimeDB.Campfire>;
  setBarbecues: MapSetter<SpacetimeDB.Barbecue>;
  setFurnaces: MapSetter<SpacetimeDB.Furnace>;
  setLanterns: MapSetter<SpacetimeDB.Lantern>;
  setTurrets: MapSetter<SpacetimeDB.Turret>;
  setHomesteadHearths: MapSetter<SpacetimeDB.HomesteadHearth>;
  setBrothPots: MapSetter<SpacetimeDB.BrothPot>;
  setHarvestableResources: MapSetter<SpacetimeDB.HarvestableResource>;
  setPlantedSeeds: MapSetter<SpacetimeDB.PlantedSeed>;
  setItemDefinitions: MapSetter<SpacetimeDB.ItemDefinition>;
  setInventoryItems: MapSetter<SpacetimeDB.InventoryItem>;
  setWorldState: ValueSetter<SpacetimeDB.WorldState | null>;
  setActiveEquipments: MapSetter<SpacetimeDB.ActiveEquipment>;
  setDroppedItems: MapSetter<SpacetimeDB.DroppedItem>;
  setWoodenStorageBoxes: MapSetter<SpacetimeDB.WoodenStorageBox>;
  setRecipes: MapSetter<SpacetimeDB.Recipe>;
  setCraftingQueueItems: MapSetter<SpacetimeDB.CraftingQueueItem>;
  setLocalPlayerRegistered: StateSetter<boolean>;
  setSleepingBags: MapSetter<SpacetimeDB.SleepingBag>;
  setPlayerCorpses: MapSetter<SpacetimeDB.PlayerCorpse>;
  setStashes: MapSetter<SpacetimeDB.Stash>;
  setRainCollectors: MapSetter<SpacetimeDB.RainCollector>;
  setWaterPatches: MapSetter<SpacetimeDB.WaterPatch>;
  setFertilizerPatches: MapSetter<SpacetimeDB.FertilizerPatch>;
  setFirePatches: MapSetter<SpacetimeDB.FirePatch>;
  setPlacedExplosives: MapSetter<SpacetimeDB.PlacedExplosive>;
  setActiveConsumableEffects: MapSetter<SpacetimeDB.ActiveConsumableEffect>;
  setClouds: MapSetter<SpacetimeDB.Cloud>;
  setDroneEvents: MapSetter<SpacetimeDB.DroneEvent>;
  setGrass: MapSetter<SpacetimeDB.Grass>;
  setGrassState: MapSetter<SpacetimeDB.GrassState>;
  setKnockedOutStatus: MapSetter<SpacetimeDB.KnockedOutStatus>;
  setRangedWeaponStats: MapSetter<SpacetimeDBRangedWeaponStats>;
  setProjectiles: MapSetter<SpacetimeDBProjectile>;
  setDeathMarkers: MapSetter<SpacetimeDB.DeathMarker>;
  setShelters: MapSetter<SpacetimeDB.Shelter>;
  setMinimapCache: ValueSetter<SpacetimeDB.MinimapCache | null>;
  setPlayerDodgeRollStates: MapSetter<SpacetimeDB.PlayerDodgeRollState>;
  setFishingSessions: MapSetter<SpacetimeDB.FishingSession>;
  setSoundEvents: MapSetter<SpacetimeDB.SoundEvent>;
  setContinuousSounds: MapSetter<SpacetimeDB.ContinuousSound>;
  setPlayerDrinkingCooldowns: MapSetter<SpacetimeDB.PlayerDrinkingCooldown>;
  setWildAnimals: MapSetter<SpacetimeDB.WildAnimal>;
  setHostileDeathEvents: StateSetter<Array<{ id: string; x: number; y: number; species: string; timestamp: number }>>;
  setAnimalCorpses: MapSetter<SpacetimeDB.AnimalCorpse>;
  setBarrels: MapSetter<SpacetimeDB.Barrel>;
  setRoadLampposts: MapSetter<SpacetimeDB.RoadLamppost>;
  setSeaStacks: MapSetter<SpacetimeDB.SeaStack>;
  setFumaroles: MapSetter<SpacetimeDB.Fumarole>;
  setBasaltColumns: MapSetter<SpacetimeDB.BasaltColumn>;
  setLivingCorals: MapSetter<SpacetimeDB.LivingCoral>;
  setFoundationCells: MapSetter<SpacetimeDB.FoundationCell>;
  setWallCells: MapSetter<SpacetimeDB.WallCell>;
  setDoors: MapSetter<SpacetimeDB.Door>;
  setFences: MapSetter<SpacetimeDB.Fence>;
  setChunkWeather: StateSetter<Map<string, any>>;
  setAlkStations: MapSetter<SpacetimeDB.AlkStation>;
  setAlkContracts: MapSetter<SpacetimeDB.AlkContract>;
  setAlkPlayerContracts: MapSetter<SpacetimeDB.AlkPlayerContract>;
  setAlkState: ValueSetter<SpacetimeDB.AlkState | null>;
  setPlayerShardBalance: MapSetter<SpacetimeDB.PlayerShardBalance>;
  setMemoryGridProgress: MapSetter<SpacetimeDB.MemoryGridProgress>;
  setMonumentParts: MapSetter<any>;
  setLargeQuarries: MapSetter<any>;
  setPlayerStats: MapSetter<SpacetimeDB.PlayerStats>;
  setAchievementDefinitions: MapSetter<SpacetimeDB.AchievementDefinition>;
  setPlayerAchievements: MapSetter<SpacetimeDB.PlayerAchievement>;
  setAchievementUnlockNotifications: MapSetter<SpacetimeDB.AchievementUnlockNotification>;
  setLevelUpNotifications: MapSetter<SpacetimeDB.LevelUpNotification>;
  setDailyLoginNotifications: MapSetter<SpacetimeDB.DailyLoginNotification>;
  setProgressNotifications: MapSetter<SpacetimeDB.ProgressNotification>;
  setComparativeStatNotifications: MapSetter<SpacetimeDB.ComparativeStatNotification>;
  setLeaderboardEntries: MapSetter<SpacetimeDB.LeaderboardEntry>;
  setDailyLoginRewards: MapSetter<SpacetimeDB.DailyLoginReward>;
  setPlantConfigDefinitions: MapSetter<SpacetimeDB.PlantConfigDefinition>;
  setDiscoveredPlants: MapSetter<SpacetimeDB.PlayerDiscoveredPlant>;
  setCaribouBreedingData: MapSetter<SpacetimeDB.CaribouBreedingData>;
  setWalrusBreedingData: MapSetter<SpacetimeDB.WalrusBreedingData>;
  setCaribouRutState: ValueSetter<SpacetimeDB.CaribouRutState | null>;
  setWalrusRutState: ValueSetter<SpacetimeDB.WalrusRutState | null>;
  campfireBatchRef: Ref<SpacetimeDB.Campfire[]>;
  campfireFlushScheduledRef: Ref<boolean>;
  harvestableResourceBatchRef: Ref<Array<{ op: 'set'; id: string; resource: SpacetimeDB.HarvestableResource } | { op: 'delete'; id: string }>>;
  harvestableResourceFlushScheduledRef: Ref<boolean>;
  droppedItemBatchRef: Ref<Array<{ op: 'set'; id: string; item: SpacetimeDB.DroppedItem } | { op: 'delete'; id: string }>>;
  droppedItemFlushScheduledRef: Ref<boolean>;
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
  treeBatchRef: Ref<SpacetimeDB.Tree[]>;
  treeFlushScheduledRef: Ref<boolean>;
  stoneBatchRef: Ref<SpacetimeDB.Stone[]>;
  stoneFlushScheduledRef: Ref<boolean>;
  chunkWeatherRef: Ref<Map<string, any>>;
  chunkWeatherUpdateTimeoutRef: Ref<ReturnType<typeof setTimeout> | null>;
}

function deleteMapEntry<T>(setter: MapSetter<T>, key: string): void {
  setter((prev) => {
    const next = new Map(prev);
    next.delete(key);
    return next;
  });
}

function replaceMapEntry<T>(setter: MapSetter<T>, key: string, value: T): void {
  setter((prev) => new Map(prev).set(key, value));
}

export function createGameplayTableBindings({
  connection,
  connectionIdentity,
  cancelPlacement,
  hasSpatialSubscription,
  ensureSpatialChunkSubscribed,
  getSubscribedChunks,
  setPlayers,
  setTrees,
  setStones,
  setRuneStones,
  setCairns,
  setPlayerDiscoveredCairns,
  setCampfires,
  setBarbecues,
  setFurnaces,
  setLanterns,
  setTurrets,
  setHomesteadHearths,
  setBrothPots,
  setHarvestableResources,
  setPlantedSeeds,
  setItemDefinitions,
  setInventoryItems,
  setWorldState,
  setActiveEquipments,
  setDroppedItems,
  setWoodenStorageBoxes,
  setRecipes,
  setCraftingQueueItems,
  setLocalPlayerRegistered,
  setSleepingBags,
  setPlayerCorpses,
  setStashes,
  setRainCollectors,
  setWaterPatches,
  setFertilizerPatches,
  setFirePatches,
  setPlacedExplosives,
  setActiveConsumableEffects,
  setClouds,
  setDroneEvents,
  setGrass,
  setGrassState,
  setKnockedOutStatus,
  setRangedWeaponStats,
  setProjectiles,
  setDeathMarkers,
  setShelters,
  setMinimapCache,
  setPlayerDodgeRollStates,
  setFishingSessions,
  setSoundEvents,
  setContinuousSounds,
  setPlayerDrinkingCooldowns,
  setWildAnimals,
  setHostileDeathEvents,
  setAnimalCorpses,
  setBarrels,
  setRoadLampposts,
  setSeaStacks,
  setFumaroles,
  setBasaltColumns,
  setLivingCorals,
  setFoundationCells,
  setWallCells,
  setDoors,
  setFences,
  setChunkWeather,
  setAlkStations,
  setAlkContracts,
  setAlkPlayerContracts,
  setAlkState,
  setPlayerShardBalance,
  setMemoryGridProgress,
  setMonumentParts,
  setLargeQuarries,
  setPlayerStats,
  setAchievementDefinitions,
  setPlayerAchievements,
  setAchievementUnlockNotifications,
  setLevelUpNotifications,
  setDailyLoginNotifications,
  setProgressNotifications,
  setComparativeStatNotifications,
  setLeaderboardEntries,
  setDailyLoginRewards,
  setPlantConfigDefinitions,
  setDiscoveredPlants,
  setCaribouBreedingData,
  setWalrusBreedingData,
  setCaribouRutState,
  setWalrusRutState,
  campfireBatchRef,
  campfireFlushScheduledRef,
  harvestableResourceBatchRef,
  harvestableResourceFlushScheduledRef,
  droppedItemBatchRef,
  droppedItemFlushScheduledRef,
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
  treeBatchRef,
  treeFlushScheduledRef,
  stoneBatchRef,
  stoneFlushScheduledRef,
  chunkWeatherRef,
  chunkWeatherUpdateTimeoutRef,
}: CreateGameplayTableBindingsOptions): GameplayTableBindings {
  const campfireBindings: Pick<GameplayTableBindings, 'campfire'> = {
    campfire: {
      onInsert: (_ctx: unknown, campfire: SpacetimeDB.Campfire) => {
        campfireBatchRef.current.push(campfire);
        if (!campfireFlushScheduledRef.current) {
          campfireFlushScheduledRef.current = true;
          queueMicrotask(() => {
            const batch = campfireBatchRef.current;
            campfireBatchRef.current = [];
            campfireFlushScheduledRef.current = false;
            for (const entry of batch) {
              if (connectionIdentity && entry.placedBy?.isEqual(connectionIdentity)) {
                cancelPlacement();
                break;
              }
            }
            setCampfires((prev) => {
              const next = new Map(prev);
              for (const entry of batch) {
                next.set(entry.id.toString(), entry);
              }
              return next;
            });
          });
        }
      },
      onUpdate: (_ctx: unknown, _oldCampfire: SpacetimeDB.Campfire, newCampfire: SpacetimeDB.Campfire) => {
        replaceMapEntry(setCampfires, newCampfire.id.toString(), newCampfire);
      },
      onDelete: (_ctx: unknown, campfire: SpacetimeDB.Campfire) => {
        deleteMapEntry(setCampfires, campfire.id.toString());
      },
    },
  };

  const scheduleHarvestableResourceFlush = () => {
    if (harvestableResourceFlushScheduledRef.current) {
      return;
    }
    harvestableResourceFlushScheduledRef.current = true;
    queueMicrotask(() => {
      const batch = harvestableResourceBatchRef.current;
      harvestableResourceBatchRef.current = [];
      harvestableResourceFlushScheduledRef.current = false;
      if (batch.length === 0) {
        return;
      }
      setHarvestableResources((prev) => {
        const next = new Map(prev);
        for (const entry of batch) {
          if (entry.op === 'set') {
            next.set(entry.id, entry.resource);
          } else {
            next.delete(entry.id);
          }
        }
        return next;
      });
    });
  };

  const scheduleDroppedItemFlush = () => {
    if (droppedItemFlushScheduledRef.current) {
      return;
    }
    droppedItemFlushScheduledRef.current = true;
    queueMicrotask(() => {
      const batch = droppedItemBatchRef.current;
      droppedItemBatchRef.current = [];
      droppedItemFlushScheduledRef.current = false;
      if (batch.length === 0) {
        return;
      }
      setDroppedItems((prev) => {
        const next = new Map(prev);
        for (const entry of batch) {
          if (entry.op === 'set') {
            next.set(entry.id, entry.item);
          } else {
            next.delete(entry.id);
          }
        }
        return next;
      });
    });
  };

  return composeGameplayTableBindings({
    progression: createProgressionTableBindings({
      connectionIdentity,
      setPlayerStats,
      setAchievementDefinitions,
      setPlayerAchievements,
      setAchievementUnlockNotifications,
      setLevelUpNotifications,
      setDailyLoginNotifications,
      setProgressNotifications,
      setComparativeStatNotifications,
      setLeaderboardEntries,
      setDailyLoginRewards,
      setPlantConfigDefinitions,
      setDiscoveredPlants,
      setAlkContracts,
      setAlkPlayerContracts,
      setAlkState,
      setPlayerShardBalance,
      setMemoryGridProgress,
      setAlkStations,
      setMonumentParts,
      setLargeQuarries,
    }),
    structures: {
      ...campfireBindings,
      ...createStructuresTableBindings({
        connectionIdentity,
        cancelPlacement,
        setBarbecues,
        setFurnaces,
        setLanterns,
        setTurrets,
        setHomesteadHearths,
        setBrothPots,
        setWoodenStorageBoxes,
        setSleepingBags,
        setStashes,
        setRainCollectors,
        setShelters,
        setBarrels,
        setRoadLampposts,
        setFoundationCells,
        setWallCells,
        setDoors,
        setFences,
      }),
    },
    items: {
      harvestable_resource: {
        onInsert: (_ctx: unknown, resource: SpacetimeDB.HarvestableResource) => {
          harvestableResourceBatchRef.current.push({ op: 'set', id: resource.id.toString(), resource });
          scheduleHarvestableResourceFlush();
        },
        onUpdate: (_ctx: unknown, oldResource: SpacetimeDB.HarvestableResource, newResource: SpacetimeDB.HarvestableResource) => {
          const changed =
            oldResource.posX !== newResource.posX ||
            oldResource.posY !== newResource.posY ||
            (oldResource.respawnAt?.microsSinceUnixEpoch ?? 0n) !== (newResource.respawnAt?.microsSinceUnixEpoch ?? 0n);
          if (changed) {
            harvestableResourceBatchRef.current.push({ op: 'set', id: newResource.id.toString(), resource: newResource });
            scheduleHarvestableResourceFlush();
          }
        },
        onDelete: (_ctx: unknown, resource: SpacetimeDB.HarvestableResource) => {
          harvestableResourceBatchRef.current.push({ op: 'delete', id: resource.id.toString() });
          scheduleHarvestableResourceFlush();
        },
      },
      planted_seed: {
        onInsert: (_ctx: unknown, seed: SpacetimeDB.PlantedSeed) => {
          replaceMapEntry(setPlantedSeeds, seed.id.toString(), seed);
        },
        onUpdate: (_ctx: unknown, oldSeed: SpacetimeDB.PlantedSeed, newSeed: SpacetimeDB.PlantedSeed) => {
          const changed = oldSeed.willMatureAt !== newSeed.willMatureAt || oldSeed.chunkIndex !== newSeed.chunkIndex;
          if (changed) {
            replaceMapEntry(setPlantedSeeds, newSeed.id.toString(), newSeed);
          }
        },
        onDelete: (_ctx: unknown, seed: SpacetimeDB.PlantedSeed) => {
          deleteMapEntry(setPlantedSeeds, seed.id.toString());
        },
      },
      dropped_item: {
        onInsert: (_ctx: unknown, item: SpacetimeDB.DroppedItem) => {
          droppedItemBatchRef.current.push({ op: 'set', id: item.id.toString(), item });
          scheduleDroppedItemFlush();
        },
        onUpdate: (_ctx: unknown, _oldItem: SpacetimeDB.DroppedItem, newItem: SpacetimeDB.DroppedItem) => {
          droppedItemBatchRef.current.push({ op: 'set', id: newItem.id.toString(), item: newItem });
          scheduleDroppedItemFlush();
        },
        onDelete: (_ctx: unknown, item: SpacetimeDB.DroppedItem) => {
          droppedItemBatchRef.current.push({ op: 'delete', id: item.id.toString() });
          scheduleDroppedItemFlush();
        },
      },
      ...createItemsTableBindings({
        setItemDefinitions,
        setInventoryItems,
        setActiveEquipments,
        setRecipes,
        setCraftingQueueItems,
        setActiveConsumableEffects,
        setRangedWeaponStats,
        setPlayerDrinkingCooldowns,
        setMinimapCache,
      }),
    },
    world: createWorldTableBindings({
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
    }),
    combat: createCombatTableBindings({
      connection,
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
    }),
    social: {
      player_corpse: {
        onInsert: (_ctx: unknown, corpse: SpacetimeDB.PlayerCorpse) => {
          replaceMapEntry(setPlayerCorpses, corpse.id.toString(), corpse);
        },
        onUpdate: (_ctx: unknown, _oldCorpse: SpacetimeDB.PlayerCorpse, newCorpse: SpacetimeDB.PlayerCorpse) => {
          replaceMapEntry(setPlayerCorpses, newCorpse.id.toString(), newCorpse);
        },
        onDelete: (_ctx: unknown, corpse: SpacetimeDB.PlayerCorpse) => {
          deleteMapEntry(setPlayerCorpses, corpse.id.toString());
        },
      },
    },
  });
}
