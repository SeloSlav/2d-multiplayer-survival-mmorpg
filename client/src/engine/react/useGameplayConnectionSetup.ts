/**
 * useGameplayConnectionSetup - Runtime-backed gameplay connection bootstrap.
 *
 * Extracts the last large connection-setup block from `useSpacetimeTables`, including
 * table binding assembly and cached fire-patch hydration.
 */
import { useCallback, type MutableRefObject } from 'react';
import type { DbConnection } from '../../generated';
import { setupGameplayConnection } from '../adapters/spacetime/gameplayConnectionSetup';
import { createGameplayTableBindings } from '../adapters/spacetime/createGameplayTableBindings';
import { gameplaySubscriptionsRuntime } from '../runtime/gameplaySubscriptionsRuntime';

type SubscriptionHandle = { unsubscribe: () => void } | null;
type GameplayTableStateRegistry = ReturnType<
  (typeof import('./useGameplayTableStateRegistry'))['useGameplayTableStateRegistry']
>;

interface UseGameplayConnectionSetupOptions {
  connection: DbConnection | null;
  cancelPlacementRef: MutableRefObject<() => void>;
  subscribeToChunk: (chunkIndex: number) => SubscriptionHandle[];
  tableState: GameplayTableStateRegistry;
}

function bootstrapCachedFirePatches(
  connection: DbConnection,
  setFirePatches: GameplayTableStateRegistry['setFirePatches'],
) {
  const existingFirePatches = Array.from(connection.db.fire_patch.iter());
  if (existingFirePatches.length === 0) {
    return;
  }

  setFirePatches((prev) => {
    const newMap = new Map(prev);
    existingFirePatches.forEach((fp) => {
      newMap.set(fp.id.toString(), fp);
      console.log(
        `[FIRE_PATCH] Added cached fire patch ${fp.id} at (${fp.posX.toFixed(1)}, ${fp.posY.toFixed(1)})`,
      );
    });
    return newMap;
  });
}

export function useGameplayConnectionSetup({
  connection,
  cancelPlacementRef,
  subscribeToChunk,
  tableState,
}: UseGameplayConnectionSetupOptions) {
  return useCallback(() => {
    if (!connection || gameplaySubscriptionsRuntime.isConnectionSetupComplete()) {
      return;
    }

    console.log('[useSpacetimeTables] ENTERING gameplay subscription runtime connection setup.');

    const tableBindings = createGameplayTableBindings({
      connection,
      connectionIdentity: connection.identity ?? null,
      cancelPlacement: () => cancelPlacementRef.current(),
      hasSpatialSubscription: (chunkIndex) => gameplaySubscriptionsRuntime.hasSpatialSubscription(chunkIndex),
      ensureSpatialChunkSubscribed: (chunkIndex) =>
        gameplaySubscriptionsRuntime.ensureChunkSubscribed(chunkIndex, subscribeToChunk),
      getSubscribedChunks: () => gameplaySubscriptionsRuntime.getSubscribedChunks(),
      setPlayers: tableState.setPlayers,
      setTrees: tableState.setTrees,
      setStones: tableState.setStones,
      setRuneStones: tableState.setRuneStones,
      setCairns: tableState.setCairns,
      setPlayerDiscoveredCairns: tableState.setPlayerDiscoveredCairns,
      setCampfires: tableState.setCampfires,
      setBarbecues: tableState.setBarbecues,
      setFurnaces: tableState.setFurnaces,
      setLanterns: tableState.setLanterns,
      setTurrets: tableState.setTurrets,
      setHomesteadHearths: tableState.setHomesteadHearths,
      setBrothPots: tableState.setBrothPots,
      setHarvestableResources: tableState.setHarvestableResources,
      setPlantedSeeds: tableState.setPlantedSeeds,
      setItemDefinitions: tableState.setItemDefinitions,
      setInventoryItems: tableState.setInventoryItems,
      setWorldState: tableState.setWorldState,
      setActiveEquipments: tableState.setActiveEquipments,
      setDroppedItems: tableState.setDroppedItems,
      setWoodenStorageBoxes: tableState.setWoodenStorageBoxes,
      setRecipes: tableState.setRecipes,
      setCraftingQueueItems: tableState.setCraftingQueueItems,
      setLocalPlayerRegistered: tableState.setLocalPlayerRegistered,
      setSleepingBags: tableState.setSleepingBags,
      setPlayerCorpses: tableState.setPlayerCorpses,
      setStashes: tableState.setStashes,
      setRainCollectors: tableState.setRainCollectors,
      setWaterPatches: tableState.setWaterPatches,
      setFertilizerPatches: tableState.setFertilizerPatches,
      setFirePatches: tableState.setFirePatches,
      setPlacedExplosives: tableState.setPlacedExplosives,
      setActiveConsumableEffects: tableState.setActiveConsumableEffects,
      setClouds: tableState.setClouds,
      setDroneEvents: tableState.setDroneEvents,
      setGrass: tableState.setGrass,
      setGrassState: tableState.setGrassState,
      setKnockedOutStatus: tableState.setKnockedOutStatus,
      setRangedWeaponStats: tableState.setRangedWeaponStats,
      setProjectiles: tableState.setProjectiles,
      setDeathMarkers: tableState.setDeathMarkers,
      setShelters: tableState.setShelters,
      setMinimapCache: tableState.setMinimapCache,
      setPlayerDodgeRollStates: tableState.setPlayerDodgeRollStates,
      setFishingSessions: tableState.setFishingSessions,
      setSoundEvents: tableState.setSoundEvents,
      setContinuousSounds: tableState.setContinuousSounds,
      setPlayerDrinkingCooldowns: tableState.setPlayerDrinkingCooldowns,
      setWildAnimals: tableState.setWildAnimals,
      setHostileDeathEvents: tableState.setHostileDeathEvents,
      setAnimalCorpses: tableState.setAnimalCorpses,
      setBarrels: tableState.setBarrels,
      setRoadLampposts: tableState.setRoadLampposts,
      setSeaStacks: tableState.setSeaStacks,
      setFumaroles: tableState.setFumaroles,
      setBasaltColumns: tableState.setBasaltColumns,
      setLivingCorals: tableState.setLivingCorals,
      setFoundationCells: tableState.setFoundationCells,
      setWallCells: tableState.setWallCells,
      setDoors: tableState.setDoors,
      setFences: tableState.setFences,
      setChunkWeather: tableState.setChunkWeather,
      setAlkStations: tableState.setAlkStations,
      setAlkContracts: tableState.setAlkContracts,
      setAlkPlayerContracts: tableState.setAlkPlayerContracts,
      setAlkState: tableState.setAlkState,
      setPlayerShardBalance: tableState.setPlayerShardBalance,
      setMemoryGridProgress: tableState.setMemoryGridProgress,
      setMonumentParts: tableState.setMonumentParts,
      setLargeQuarries: tableState.setLargeQuarries,
      setPlayerStats: tableState.setPlayerStats,
      setAchievementDefinitions: tableState.setAchievementDefinitions,
      setPlayerAchievements: tableState.setPlayerAchievements,
      setAchievementUnlockNotifications: tableState.setAchievementUnlockNotifications,
      setLevelUpNotifications: tableState.setLevelUpNotifications,
      setDailyLoginNotifications: tableState.setDailyLoginNotifications,
      setProgressNotifications: tableState.setProgressNotifications,
      setComparativeStatNotifications: tableState.setComparativeStatNotifications,
      setLeaderboardEntries: tableState.setLeaderboardEntries,
      setDailyLoginRewards: tableState.setDailyLoginRewards,
      setPlantConfigDefinitions: tableState.setPlantConfigDefinitions,
      setDiscoveredPlants: tableState.setDiscoveredPlants,
      setCaribouBreedingData: tableState.setCaribouBreedingData,
      setWalrusBreedingData: tableState.setWalrusBreedingData,
      setCaribouRutState: tableState.setCaribouRutState,
      setWalrusRutState: tableState.setWalrusRutState,
      campfireBatchRef: tableState.campfireBatchRef,
      campfireFlushScheduledRef: tableState.campfireFlushScheduledRef,
      harvestableResourceBatchRef: tableState.harvestableResourceBatchRef,
      harvestableResourceFlushScheduledRef: tableState.harvestableResourceFlushScheduledRef,
      droppedItemBatchRef: tableState.droppedItemBatchRef,
      droppedItemFlushScheduledRef: tableState.droppedItemFlushScheduledRef,
      playersRef: tableState.playersRef,
      lastPlayerRenderTimeRef: tableState.lastPlayerRenderTimeRef,
      playerRenderPendingRef: tableState.playerRenderPendingRef,
      playerRenderTimerRef: tableState.playerRenderTimerRef,
      projectilesRef: tableState.projectilesRef,
      projectilesUpdateTimeoutRef: tableState.projectilesUpdateTimeoutRef,
      projectileBatchIntervalMs: tableState.PROJECTILE_BATCH_INTERVAL_MS,
      playerDodgeRollStatesRef: tableState.playerDodgeRollStatesRef,
      wildAnimalsRef: tableState.wildAnimalsRef,
      wildAnimalsUpdateTimeoutRef: tableState.wildAnimalsUpdateTimeoutRef,
      wildAnimalBatchIntervalMs: tableState.WILD_ANIMAL_BATCH_INTERVAL_MS,
      hostileDeathCleanupTimeoutsRef: tableState.hostileDeathCleanupTimeoutsRef,
      hostileDeathEventsMax: tableState.HOSTILE_DEATH_EVENTS_MAX,
      treeBatchRef: tableState.treeBatchRef,
      treeFlushScheduledRef: tableState.treeFlushScheduledRef,
      stoneBatchRef: tableState.stoneBatchRef,
      stoneFlushScheduledRef: tableState.stoneFlushScheduledRef,
      chunkWeatherRef: tableState.chunkWeatherRef,
      chunkWeatherUpdateTimeoutRef: tableState.chunkWeatherUpdateTimeoutRef,
    });

    const currentInitialSubs = setupGameplayConnection({
      connection,
      tableBindings,
    });

    bootstrapCachedFirePatches(connection, tableState.setFirePatches);
    gameplaySubscriptionsRuntime.replaceNonSpatialHandles(currentInitialSubs);
    gameplaySubscriptionsRuntime.markConnectionSetupComplete();
  }, [cancelPlacementRef, connection, subscribeToChunk, tableState]);
}
