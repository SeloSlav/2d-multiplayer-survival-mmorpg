import { useMemo, useCallback } from 'react';
import { gameConfig } from '../config/gameConfig';
import {
  Player as SpacetimeDBPlayer,
  Tree as SpacetimeDBTree,
  Stone as SpacetimeDBStone,
  Campfire as SpacetimeDBCampfire,
  Furnace as SpacetimeDBFurnace, // ADDED: Furnace import
  Lantern as SpacetimeDBLantern,
  HarvestableResource as SpacetimeDBHarvestableResource,
  DroppedItem as SpacetimeDBDroppedItem,
  WoodenStorageBox as SpacetimeDBWoodenStorageBox,
  SleepingBag as SpacetimeDBSleepingBag,
  PlayerCorpse as SpacetimeDBPlayerCorpse,
  Stash as SpacetimeDBStash,
  Projectile as SpacetimeDBProjectile,
  Shelter as SpacetimeDBShelter,
  Cloud as SpacetimeDBCloud,
  PlantedSeed as SpacetimeDBPlantedSeed,
  RainCollector as SpacetimeDBRainCollector,
  WildAnimal as SpacetimeDBWildAnimal,
  ViperSpittle as SpacetimeDBViperSpittle,
  AnimalCorpse as SpacetimeDBAnimalCorpse,
  Barrel as SpacetimeDBBarrel, // ADDED Barrel type
  // Grass as SpacetimeDBGrass // Will use InterpolatedGrassData instead
} from '../generated';
import {
  isPlayer, isTree, isStone, isCampfire, isHarvestableResource, isDroppedItem, isWoodenStorageBox,
  isSleepingBag,
  isStash,
  isPlayerCorpse,
  isGrass, // Type guard might need adjustment or can work if structure is similar enough
  isShelter, // ADDED Shelter type guard import (will be created in typeGuards.ts)
  isRainCollector, // ADDED RainCollector type guard import
  isWildAnimal, // ADDED WildAnimal type guard import
  isAnimalCorpse, // ADDED AnimalCorpse type guard import
  isBarrel, // ADDED Barrel type guard import
  isLantern, // ADDED Lantern type guard import
  isSeaStack // ADDED SeaStack type guard import
} from '../utils/typeGuards';
import { InterpolatedGrassData } from './useGrassInterpolation'; // Import InterpolatedGrassData

export interface ViewportBounds {
  viewMinX: number;
  viewMaxX: number;
  viewMinY: number;
  viewMaxY: number;
}

interface EntityFilteringResult {
  visibleHarvestableResources: SpacetimeDBHarvestableResource[];
  visibleDroppedItems: SpacetimeDBDroppedItem[];
  visibleCampfires: SpacetimeDBCampfire[];
  visibleFurnaces: SpacetimeDBFurnace[]; // ADDED: Furnaces
  visiblePlayers: SpacetimeDBPlayer[];
  visibleTrees: SpacetimeDBTree[];
  visibleStones: SpacetimeDBStone[];
  visibleWoodenStorageBoxes: SpacetimeDBWoodenStorageBox[];
  visibleSleepingBags: SpacetimeDBSleepingBag[];
  visibleProjectiles: SpacetimeDBProjectile[];
  visibleHarvestableResourcesMap: Map<string, SpacetimeDBHarvestableResource>;
  visibleCampfiresMap: Map<string, SpacetimeDBCampfire>;
  visibleFurnacesMap: Map<string, SpacetimeDBFurnace>; // ADDED: Furnaces map
  visibleLanternsMap: Map<string, SpacetimeDBLantern>;
  visibleDroppedItemsMap: Map<string, SpacetimeDBDroppedItem>;
  visibleBoxesMap: Map<string, SpacetimeDBWoodenStorageBox>;
  visibleProjectilesMap: Map<string, SpacetimeDBProjectile>;
  visiblePlayerCorpses: SpacetimeDBPlayerCorpse[];
  visiblePlayerCorpsesMap: Map<string, SpacetimeDBPlayerCorpse>;
  visibleStashes: SpacetimeDBStash[];
  visibleStashesMap: Map<string, SpacetimeDBStash>;
  visibleSleepingBagsMap: Map<string, SpacetimeDBSleepingBag>;
  visibleTreesMap: Map<string, SpacetimeDBTree>;
  groundItems: (SpacetimeDBSleepingBag)[];
  ySortedEntities: YSortedEntityType[];
  visibleGrass: InterpolatedGrassData[]; // Use InterpolatedGrassData
  visibleGrassMap: Map<string, InterpolatedGrassData>; // Use InterpolatedGrassData
  visibleShelters: SpacetimeDBShelter[]; // ADDED
  visibleSheltersMap: Map<string, SpacetimeDBShelter>; // ADDED
  visibleLanterns: SpacetimeDBLantern[];
  visiblePlantedSeeds: SpacetimeDBPlantedSeed[];
  visiblePlantedSeedsMap: Map<string, SpacetimeDBPlantedSeed>; // ADDED
  visibleClouds: SpacetimeDBCloud[]; // ADDED
  visibleRainCollectors: SpacetimeDBRainCollector[];
  visibleRainCollectorsMap: Map<string, SpacetimeDBRainCollector>;
  visibleWildAnimals: SpacetimeDBWildAnimal[]; // ADDED
  visibleWildAnimalsMap: Map<string, SpacetimeDBWildAnimal>; // ADDED
  visibleViperSpittles: SpacetimeDBViperSpittle[]; // ADDED
  visibleViperSpittlesMap: Map<string, SpacetimeDBViperSpittle>; // ADDED
  visibleAnimalCorpses: SpacetimeDBAnimalCorpse[]; // ADDED
  visibleAnimalCorpsesMap: Map<string, SpacetimeDBAnimalCorpse>; // ADDED
  visibleBarrels: SpacetimeDBBarrel[]; // ADDED
  visibleBarrelsMap: Map<string, SpacetimeDBBarrel>; // ADDED
  visibleSeaStacks: any[]; // ADDED
  visibleSeaStacksMap: Map<string, any>; // ADDED
}

// Define a unified entity type for sorting
export type YSortedEntityType =
  | { type: 'player'; entity: SpacetimeDBPlayer }
  | { type: 'tree'; entity: SpacetimeDBTree }
  | { type: 'stone'; entity: SpacetimeDBStone }
  | { type: 'wooden_storage_box'; entity: SpacetimeDBWoodenStorageBox }
  | { type: 'player_corpse'; entity: SpacetimeDBPlayerCorpse }
  | { type: 'stash'; entity: SpacetimeDBStash }
  | { type: 'harvestable_resource'; entity: SpacetimeDBHarvestableResource }
  | { type: 'campfire'; entity: SpacetimeDBCampfire }
  | { type: 'furnace'; entity: SpacetimeDBFurnace } // ADDED: Furnace type
  | { type: 'lantern'; entity: SpacetimeDBLantern }
  | { type: 'dropped_item'; entity: SpacetimeDBDroppedItem }
  | { type: 'projectile'; entity: SpacetimeDBProjectile }
  | { type: 'shelter'; entity: SpacetimeDBShelter }
  | { type: 'grass'; entity: InterpolatedGrassData }
  | { type: 'planted_seed'; entity: SpacetimeDBPlantedSeed }
  | { type: 'rain_collector'; entity: SpacetimeDBRainCollector }
  | { type: 'wild_animal'; entity: SpacetimeDBWildAnimal }
  | { type: 'viper_spittle'; entity: SpacetimeDBViperSpittle }
  | { type: 'animal_corpse'; entity: SpacetimeDBAnimalCorpse }
  | { type: 'barrel'; entity: SpacetimeDBBarrel }
  | { type: 'sea_stack'; entity: any }; // Server-provided sea stack entities

export function useEntityFiltering(
  players: Map<string, SpacetimeDBPlayer>,
  trees: Map<string, SpacetimeDBTree>,
  stones: Map<string, SpacetimeDBStone>,
  campfires: Map<string, SpacetimeDBCampfire>,
  furnaces: Map<string, SpacetimeDBFurnace>, // ADDED: Furnaces parameter
  lanterns: Map<string, SpacetimeDBLantern>,
  harvestableResources: Map<string, SpacetimeDBHarvestableResource>,
  droppedItems: Map<string, SpacetimeDBDroppedItem>,
  woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>,
  sleepingBags: Map<string, SpacetimeDBSleepingBag>,
  playerCorpses: Map<string, SpacetimeDBPlayerCorpse>,
  stashes: Map<string, SpacetimeDBStash>,
  cameraOffsetX: number,
  cameraOffsetY: number,
  canvasWidth: number,
  canvasHeight: number,
  grass: Map<string, InterpolatedGrassData>, // Use InterpolatedGrassData
  projectiles: Map<string, SpacetimeDBProjectile>,
  shelters: Map<string, SpacetimeDBShelter>, // ADDED shelters argument
  clouds: Map<string, SpacetimeDBCloud>, // ADDED clouds argument
  plantedSeeds: Map<string, SpacetimeDBPlantedSeed>,
  rainCollectors: Map<string, SpacetimeDBRainCollector>,
  wildAnimals: Map<string, SpacetimeDBWildAnimal>, // ADDED wildAnimals argument
  viperSpittles: Map<string, SpacetimeDBViperSpittle>, // ADDED viperSpittles argument
  animalCorpses: Map<string, SpacetimeDBAnimalCorpse>, // ADDED animalCorpses argument
  barrels: Map<string, SpacetimeDBBarrel>, // ADDED barrels argument
  seaStacks: Map<string, any> // ADDED sea stacks argument
): EntityFilteringResult {
  // Get consistent timestamp for all projectile calculations in this frame
  // CRITICAL FIX: Use stable timestamp to prevent infinite re-renders
  const currentTime = useMemo(() => Date.now(), []);

  // Only update timestamp every second to prevent constant re-renders
  const stableTimestamp = useMemo(() => {
    const now = Date.now();
    return Math.floor(now / 1000) * 1000; // Round to nearest second
  }, [Math.floor(Date.now() / 1000)]);
  // Removed debug log that was causing excessive console output

  // Calculate viewport bounds
  const getViewportBounds = useCallback((): ViewportBounds => {
    const buffer = gameConfig.tileSize * 3; // Increased from 2 to 3 for better coverage
    const viewMinX = -cameraOffsetX - buffer;
    const viewMaxX = -cameraOffsetX + canvasWidth + buffer;
    const viewMinY = -cameraOffsetY - buffer;
    const viewMaxY = -cameraOffsetY + canvasHeight + buffer;
    return { viewMinX, viewMaxX, viewMinY, viewMaxY };
  }, [cameraOffsetX, cameraOffsetY, canvasWidth, canvasHeight]);

  // Entity visibility check
  const isEntityInView = useCallback((entity: any, bounds: ViewportBounds, timestamp: number): boolean => {
    let x: number | undefined;
    let y: number | undefined;
    let width: number = gameConfig.tileSize;
    let height: number = gameConfig.tileSize;

    if (isPlayer(entity)) {
      x = entity.positionX;
      y = entity.positionY;
      width = 64; // Approx player size
      height = 64;
    } else if (isTree(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 240; // Increased from 96 to 240 to account for larger tree visuals and shadows
      height = 320; // Increased from 128 to 320 to account for taller tree visuals
    } else if (isStone(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 64;
      height = 64;
    } else if (isCampfire(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 64;
      height = 64;
    } else if ((entity as any).fuelInventoryId !== undefined && (entity as any).isBurning !== undefined) {
      // Handle furnaces - same dimensions as campfires for visibility check
      x = (entity as any).posX;
      y = (entity as any).posY;
      width = 144; // Doubled from 72 to 144 to match rendering size
      height = 144; // Doubled from 72 to 144 to match rendering size
    } else if (isLantern(entity)) {
      // Handle lanterns using proper type guard
      x = entity.posX;
      y = entity.posY;
      width = 48;
      height = 56;
    } else if (isHarvestableResource(entity)) {
      x = entity.posX;
      y = entity.posY;
    } else if (isDroppedItem(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 32;
      height = 32;
    } else if (isWoodenStorageBox(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 64;
      height = 64;
    } else if (isSleepingBag(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 64;
      height = 32;
    } else if (isStash(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 32;
      height = 32;
    } else if ((entity as any).startPosX !== undefined && (entity as any).startPosY !== undefined) {
      // Handle projectiles - calculate current position based on time
      const projectile = entity as any;
      const startTime = Number(projectile.startTime.microsSinceUnixEpoch / 1000n);
      const elapsedSeconds = (timestamp - startTime) / 1000.0;
      x = projectile.startPosX + projectile.velocityX * elapsedSeconds;
      y = projectile.startPosY + projectile.velocityY * elapsedSeconds;
      width = 32;
      height = 32;
    } else if (isShelter(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 384; // Based on SHELTER_RENDER_WIDTH
      height = 384; // Based on SHELTER_RENDER_HEIGHT
    } else if (isGrass(entity)) {
      // After isGrass, entity could be SpacetimeDBGrass or InterpolatedGrassData
      if ('serverPosX' in entity && typeof entity.serverPosX === 'number') { // It's InterpolatedGrassData
        x = entity.serverPosX;
        y = (entity as any).serverPosY;
      } else { // It's SpacetimeDBGrass (should ideally not happen if input is always InterpolatedGrassData)
        x = (entity as any).posX;
        y = (entity as any).posY;
      }
      width = 48;
      height = 48;
    } else if ((entity as any).posX !== undefined && (entity as any).seedType !== undefined) {
      // Handle planted seeds - check for seed-specific properties
      x = (entity as any).posX;
      y = (entity as any).posY;
      width = 24; // Small seed size
      height = 24;
    } else if (isWildAnimal(entity)) {
      x = entity.posX;
      y = entity.posY;
      // All wild animals now use the same square dimensions for consistency
      width = 96;
      height = 96;
    } else if ((entity as any).viperId !== undefined && (entity as any).startPosX !== undefined) {
      // Handle viper spittles - calculate current position based on time
      const spittle = entity as any;
      const startTime = Number(spittle.startTime.microsSinceUnixEpoch / 1000n);
      const elapsedSeconds = (timestamp - startTime) / 1000.0;
      x = spittle.startPosX + spittle.velocityX * elapsedSeconds;
      y = spittle.startPosY + spittle.velocityY * elapsedSeconds;
      width = 24; // Small spittle size
      height = 24;
    } else if (isAnimalCorpse(entity)) {
      // Handle animal corpses
      x = entity.posX;
      y = entity.posY;
      width = 96; // Same size as wild animals
      height = 96;
    } else if (isBarrel(entity)) {
      // Handle barrels
      x = entity.posX;
      y = entity.posY;
      width = 48; // Barrel width
      height = 48; // Barrel height
    } else if (isSeaStack(entity)) {
      // Handle sea stacks - they're large tall structures like trees but bigger
      x = entity.posX;
      y = entity.posY;
      width = 400; // Sea stacks are large - use the same as BASE_WIDTH in rendering
      height = 600; // Sea stacks are tall - generous height for Y-sorting visibility
    } else {
      return false; // Unknown entity type
    }

    if (x === undefined || y === undefined) return false;

    // AABB overlap check
    return (
      x + width / 2 > bounds.viewMinX &&
      x - width / 2 < bounds.viewMaxX &&
      y + height / 2 > bounds.viewMinY &&
      y - height / 2 < bounds.viewMaxY
    );
  }, []);

  // Get viewport bounds
  const viewBounds = useMemo(() => getViewportBounds(), [getViewportBounds]);

  // Filter entities by visibility
  const visibleHarvestableResources = useMemo(() => 
    // Check source map
    harvestableResources ? Array.from(harvestableResources.values()).filter(e => 
              (e.respawnAt === null || e.respawnAt === undefined) && isEntityInView(e, viewBounds, stableTimestamp)
    ) : [],
    [harvestableResources, isEntityInView, viewBounds, stableTimestamp]
  );

  const visibleDroppedItems = useMemo(() => 
    // Check source map
          droppedItems ? Array.from(droppedItems.values()).filter(e => isEntityInView(e, viewBounds, stableTimestamp))
    : [],
    [droppedItems, isEntityInView, viewBounds, stableTimestamp]
  );

  const visibleCampfires = useMemo(() => 
    // Check source map
          campfires ? Array.from(campfires.values()).filter(e => isEntityInView(e, viewBounds, stableTimestamp) && !e.isDestroyed)
    : [],
    [campfires, isEntityInView, viewBounds, stableTimestamp]
  );

  const visibleFurnaces = useMemo(() => 
    // Check source map - same filtering as campfires
          furnaces ? Array.from(furnaces.values()).filter(e => isEntityInView(e, viewBounds, stableTimestamp) && !e.isDestroyed)
    : [],
    [furnaces, isEntityInView, viewBounds, stableTimestamp]
  );

  const visibleLanterns = useMemo(() => {
    if (!lanterns) return [];
    
    const allLanterns = Array.from(lanterns.values());
    const visibleFiltered = allLanterns.filter(e => isEntityInView(e, viewBounds, stableTimestamp) && !e.isDestroyed);
    
    return visibleFiltered;
  }, [lanterns, isEntityInView, viewBounds, stableTimestamp]);

  const visiblePlayers = useMemo(() => {
    if (!players) return [];
    return Array.from(players.values()).filter(e => isEntityInView(e, viewBounds, stableTimestamp));
  }, [players, isEntityInView, viewBounds, stableTimestamp]);

  const visibleTrees = useMemo(() => 
    trees ? Array.from(trees.values()).filter(e => e.health > 0 && isEntityInView(e, viewBounds, stableTimestamp))
    : [],
    [trees, isEntityInView, viewBounds, stableTimestamp]
  );

  const visibleStones = useMemo(() => 
    stones ? Array.from(stones.values()).filter(e => e.health > 0 && isEntityInView(e, viewBounds, stableTimestamp))
    : [],
    [stones, isEntityInView, viewBounds, stableTimestamp]
  );

  const visibleWoodenStorageBoxes = useMemo(() => 
    // Check source map
          woodenStorageBoxes ? Array.from(woodenStorageBoxes.values()).filter(e => isEntityInView(e, viewBounds, stableTimestamp))
    : [],
    [woodenStorageBoxes, isEntityInView, viewBounds, stableTimestamp]
  );
  
  const visibleSleepingBags = useMemo(() => 
    // Check source map
    sleepingBags ? Array.from(sleepingBags.values())
      .filter(e => isEntityInView(e, viewBounds, stableTimestamp))
      : []
    ,[sleepingBags, isEntityInView, viewBounds, stableTimestamp]
  );

  const visiblePlayerCorpses = useMemo(() => 
    // Add check: If playerCorpses is undefined or null, return empty array
    playerCorpses ? Array.from(playerCorpses.values())
      .filter(e => isEntityInView(e, viewBounds, stableTimestamp))
      : []
    ,[playerCorpses, isEntityInView, viewBounds, stableTimestamp]
  );

  const visibleStashes = useMemo(() => 
    stashes ? Array.from(stashes.values()).filter(e => isEntityInView(e, viewBounds, stableTimestamp))
    : [],
    [stashes, isEntityInView, viewBounds, stableTimestamp]
  );

  const visibleProjectiles = useMemo(() => {
    const projectilesArray = Array.from(projectiles.values());
    
    // For projectiles, use minimal filtering to ensure they're always visible in production
    // Skip complex timing calculations that could cause issues with network latency
    const filtered = projectilesArray.filter(projectile => {
      // Simple bounds check using start position (no timing calculations)
      const startX = projectile.startPosX;
      const startY = projectile.startPosY;
      
      // Very generous bounds check - if the projectile started anywhere near the viewport,
      // let it through (it will be properly positioned in the render function)
      const margin = 1000; // Large margin to account for projectile travel
      return (
        startX > viewBounds.viewMinX - margin &&
        startX < viewBounds.viewMaxX + margin &&
        startY > viewBounds.viewMinY - margin &&
        startY < viewBounds.viewMaxY + margin
      );
    });
    
    // Debug logging for projectiles
    if (projectilesArray.length > 0 || filtered.length > 0) {
      console.log(`🏹 [FILTERING] Total projectiles: ${projectilesArray.length}, Visible: ${filtered.length}`);
      if (filtered.length > 0) {
        console.log(`🏹 [FILTERING] Visible projectile IDs:`, filtered.map(p => p.id));
      }
    }
    
    return filtered;
  }, [projectiles, viewBounds]);

  const visibleGrass = useMemo(() => 
    grass ? Array.from(grass.values()).filter(e => 
              e.health > 0 && isEntityInView(e, viewBounds, stableTimestamp)
    ) : [],
    [grass, isEntityInView, viewBounds, stableTimestamp]
  ); // grass parameter is now Map<string, InterpolatedGrassData>

  // ADDED: Filter visible shelters
  const visibleShelters = useMemo(() => {
    const filtered = shelters ? Array.from(shelters.values()).filter(e => !e.isDestroyed && isEntityInView(e, viewBounds, stableTimestamp)) : [];
    // console.log('[useEntityFiltering] Filtered visibleShelters count:', filtered.length, filtered); // DEBUG LOG 2
    return filtered;
  }, [shelters, isEntityInView, viewBounds, stableTimestamp]);

  const visibleClouds = useMemo(() => 
    clouds ? Array.from(clouds.values()).filter(e => isEntityInView(e, viewBounds, stableTimestamp))
    : [],
    [clouds, isEntityInView, viewBounds, stableTimestamp]
  );

  const visiblePlantedSeeds = useMemo(() => 
    plantedSeeds ? Array.from(plantedSeeds.values()).filter(e => isEntityInView(e, viewBounds, stableTimestamp))
    : [],
    [plantedSeeds, isEntityInView, viewBounds, stableTimestamp]
  );

  const visibleRainCollectors = useMemo(() => 
    rainCollectors ? Array.from(rainCollectors.values()).filter(e => !e.isDestroyed && isEntityInView(e, viewBounds, stableTimestamp))
    : [],
    [rainCollectors, isEntityInView, viewBounds, stableTimestamp]
  );

  const visibleWildAnimals = useMemo(() => 
    wildAnimals ? Array.from(wildAnimals.values()).filter(e => isEntityInView(e, viewBounds, stableTimestamp))
    : [],
    [wildAnimals, isEntityInView, viewBounds, stableTimestamp]
  );

  const visibleViperSpittles = useMemo(() => 
    viperSpittles ? Array.from(viperSpittles.values()).filter(e => isEntityInView(e, viewBounds, stableTimestamp))
    : [],
    [viperSpittles, isEntityInView, viewBounds, stableTimestamp]
  );

  const visibleAnimalCorpses = useMemo(() => {
    const result = animalCorpses ? Array.from(animalCorpses.values()).filter(e => {
      const inView = isEntityInView(e, viewBounds, stableTimestamp);
      // Convert microseconds to milliseconds for proper comparison
      const despawnTimeMs = Number(e.despawnAt.__timestamp_micros_since_unix_epoch__ / 1000n);
              const notDespawned = stableTimestamp < despawnTimeMs; // Check if current time is before despawn time
      return inView && notDespawned;
    }) : [];
    // console.log(`🦴 [ANIMAL CORPSE FILTERING] Total corpses: ${animalCorpses?.size || 0}, Visible after filtering: ${result.length}, IDs: [${result.map(c => c.id).join(', ')}]`);
    return result;
  }, [animalCorpses, isEntityInView, viewBounds, stableTimestamp]);

  const visibleBarrels = useMemo(() => 
    barrels ? Array.from(barrels.values()).filter(e => 
      !e.respawnAt && isEntityInView(e, viewBounds, stableTimestamp) // Don't show if respawning (destroyed)
    ) : [],
    [barrels, isEntityInView, viewBounds, stableTimestamp]
  );

  const visibleSeaStacks = useMemo(() => 
    seaStacks ? Array.from(seaStacks.values()).filter(e => isEntityInView(e, viewBounds, stableTimestamp))
    : [],
    [seaStacks, isEntityInView, viewBounds, stableTimestamp]
  );

  const visibleHarvestableResourcesMap = useMemo(() => 
    new Map(visibleHarvestableResources.map(hr => [hr.id.toString(), hr])), 
    [visibleHarvestableResources]
  );

  const visibleCampfiresMap = useMemo(() => 
    new Map(visibleCampfires.map(c => [c.id.toString(), c])), 
    [visibleCampfires]
  );

  const visibleFurnacesMap = useMemo(() => 
    new Map(visibleFurnaces.map(f => [f.id.toString(), f])), 
    [visibleFurnaces]
  );

  const visibleLanternsMap = useMemo(() => 
    new Map(visibleLanterns.map(l => [l.id.toString(), l])), 
    [visibleLanterns]
  );
  
  const visibleDroppedItemsMap = useMemo(() => 
    new Map(visibleDroppedItems.map(i => [i.id.toString(), i])), 
    [visibleDroppedItems]
  );
  
  const visibleBoxesMap = useMemo(() => 
    new Map(visibleWoodenStorageBoxes.map(b => [b.id.toString(), b])), 
    [visibleWoodenStorageBoxes]
  );

    const visiblePlantedSeedsMap = useMemo(() => 
    new Map(visiblePlantedSeeds.map(p => [p.id.toString(), p])), 
    [visiblePlantedSeeds]
  );

  const visibleRainCollectorsMap = useMemo(() => 
    new Map(visibleRainCollectors.map(r => [r.id.toString(), r])), 
    [visibleRainCollectors]
  );

  const visibleWildAnimalsMap = useMemo(() => 
    new Map(visibleWildAnimals.map(w => [w.id.toString(), w])), 
    [visibleWildAnimals]
  );

  const visibleProjectilesMap = useMemo(() => 
    new Map(visibleProjectiles.map(p => [p.id.toString(), p])), 
    [visibleProjectiles]
  );

  const visiblePlayerCorpsesMap = useMemo(() => {
    const map = new Map<string, SpacetimeDBPlayerCorpse>();
    visiblePlayerCorpses.forEach(c => map.set(c.id.toString(), c));
    return map;
  }, [visiblePlayerCorpses]);

  const visibleStashesMap = useMemo(() => new Map(visibleStashes.map(st => [st.id.toString(), st])), [visibleStashes]);

  const visibleSleepingBagsMap = useMemo(() => 
    new Map(visibleSleepingBags.map(sl => [sl.id.toString(), sl])), 
    [visibleSleepingBags]
  );

  const visibleTreesMap = useMemo(() => {
    const map = new Map<string, SpacetimeDBTree>();
    visibleTrees.forEach(e => map.set(e.id.toString(), e));
    return map;
  }, [visibleTrees]);

  const groundItems = useMemo(() => visibleSleepingBags, [visibleSleepingBags]);

  const visibleGrassMap = useMemo(() => 
    new Map(visibleGrass.map(g => [g.id.toString(), g])),
    [visibleGrass]
  ); // visibleGrass is now InterpolatedGrassData[]

  // ADDED: Map for visible shelters
  const visibleSheltersMap = useMemo(() =>
    new Map(visibleShelters.map(s => [s.id.toString(), s])),
    [visibleShelters]
  );

  // ADDED: Map for visible viper spittles
  const visibleViperSpittlesMap = useMemo(() =>
    new Map(visibleViperSpittles.map(v => [v.id.toString(), v])),
    [visibleViperSpittles]
  );

  // ADDED: Map for visible animal corpses
  const visibleAnimalCorpsesMap = useMemo(() =>
    new Map(visibleAnimalCorpses.map(a => [a.id.toString(), a])),
    [visibleAnimalCorpses]
  );

  // ADDED: Map for visible barrels
  const visibleBarrelsMap = useMemo(() =>
    new Map(visibleBarrels.map(b => [b.id.toString(), b])),
    [visibleBarrels]
  );

  // ADDED: Map for visible sea stacks
  const visibleSeaStacksMap = useMemo(() =>
    new Map(visibleSeaStacks.map(s => [s.id.toString(), s])),
    [visibleSeaStacks]
  );

  // Y-sorted entities with PERFORMANCE OPTIMIZED sorting
  const ySortedEntities = useMemo(() => {
    // PERFORMANCE FIX: Instead of concatenating arrays and sorting every frame,
    // pre-calculate Y-sort values and use a more efficient approach
    
    // Early exit if no entities
    const totalEntities = visiblePlayers.length + visibleTrees.length + visibleStones.length + 
                         visibleWoodenStorageBoxes.length + visibleCampfires.length + visibleFurnaces.length +
                         visibleLanterns.length + visibleDroppedItems.length + visibleProjectiles.length +
                         visibleShelters.length + visibleGrass.length + visiblePlantedSeeds.length +
                         visibleRainCollectors.length + visibleWildAnimals.length + visibleViperSpittles.length +
                         visibleAnimalCorpses.length + visibleBarrels.length + visibleSeaStacks.length +
                         visibleHarvestableResources.length + visiblePlayerCorpses.length + visibleStashes.length;
    
    if (totalEntities === 0) return [];
    
    // PERFORMANCE: Pre-allocate array with known size to avoid dynamic resizing
    const sortedEntities: Array<{ y: number; priority: number; item: YSortedEntityType }> = [];
    sortedEntities.length = totalEntities; // Pre-allocate
    let index = 0;
    
    // PERFORMANCE: Inline Y-calculation and priority assignment to avoid function calls
    // Process each entity type with optimized inline logic
    
    // Players - Priority 21, Y = positionY + 48
    for (const player of visiblePlayers) {
      sortedEntities[index++] = {
        y: player.positionY + 48,
        priority: 21,
        item: { type: 'player' as const, entity: player }
      };
    }
    
    // Trees - Priority 2, Y = posY
    for (const tree of visibleTrees) {
      sortedEntities[index++] = {
        y: tree.posY,
        priority: 2,
        item: { type: 'tree' as const, entity: tree }
      };
    }
    
    // Stones - Priority 3, Y = posY (filter health > 0 inline)
    for (const stone of visibleStones) {
      if (stone.health > 0) {
        sortedEntities[index++] = {
          y: stone.posY,
          priority: 3,
          item: { type: 'stone' as const, entity: stone }
        };
      }
    }
    
    // Storage boxes - Priority 5, Y = posY
    for (const box of visibleWoodenStorageBoxes) {
      sortedEntities[index++] = {
        y: box.posY,
        priority: 5,
        item: { type: 'wooden_storage_box' as const, entity: box }
      };
    }
    
    // Stashes - Priority 6, Y = posY
    for (const stash of visibleStashes) {
      sortedEntities[index++] = {
        y: stash.posY,
        priority: 6,
        item: { type: 'stash' as const, entity: stash }
      };
    }
    
    // Campfires - Priority 7, Y = posY
    for (const campfire of visibleCampfires) {
      sortedEntities[index++] = {
        y: campfire.posY,
        priority: 7,
        item: { type: 'campfire' as const, entity: campfire }
      };
    }
    
    // Furnaces - Priority 7.5, Y = posY
    for (const furnace of visibleFurnaces) {
      sortedEntities[index++] = {
        y: furnace.posY,
        priority: 7.5,
        item: { type: 'furnace' as const, entity: furnace }
      };
    }
    
    // Lanterns - Priority 8, Y = posY
    for (const lantern of visibleLanterns) {
      sortedEntities[index++] = {
        y: lantern.posY,
        priority: 8,
        item: { type: 'lantern' as const, entity: lantern }
      };
    }
    
    // Grass - Priority 9, Y = serverPosY
    for (const grass of visibleGrass) {
      sortedEntities[index++] = {
        y: grass.serverPosY,
        priority: 9,
        item: { type: 'grass' as const, entity: grass }
      };
    }
    
    // Planted seeds - Priority 10, Y = posY
    for (const seed of visiblePlantedSeeds) {
      sortedEntities[index++] = {
        y: seed.posY,
        priority: 10,
        item: { type: 'planted_seed' as const, entity: seed }
      };
    }
    
    // Dropped items - Priority 11, Y = posY
    for (const item of visibleDroppedItems) {
      sortedEntities[index++] = {
        y: item.posY,
        priority: 11,
        item: { type: 'dropped_item' as const, entity: item }
      };
    }
    
    // Harvestable resources - Priority 12, Y = posY
    for (const resource of visibleHarvestableResources) {
      sortedEntities[index++] = {
        y: resource.posY,
        priority: 12,
        item: { type: 'harvestable_resource' as const, entity: resource }
      };
    }
    
    // Rain collectors - Priority 18, Y = posY
    for (const collector of visibleRainCollectors) {
      sortedEntities[index++] = {
        y: collector.posY,
        priority: 18,
        item: { type: 'rain_collector' as const, entity: collector }
      };
    }
    
    // Projectiles - Priority 19, Y = calculated position
    for (const projectile of visibleProjectiles) {
        const startTime = Number(projectile.startTime.microsSinceUnixEpoch / 1000n);
      const elapsedSeconds = (stableTimestamp - startTime) / 1000.0;
      const currentY = projectile.startPosY + projectile.velocityY * elapsedSeconds;
      sortedEntities[index++] = {
        y: currentY,
        priority: 19,
        item: { type: 'projectile' as const, entity: projectile }
      };
    }
    
    // Viper spittles - Priority 19, Y = calculated position
    for (const spittle of visibleViperSpittles) {
      const startTime = Number(spittle.startTime.microsSinceUnixEpoch / 1000n);
      const elapsedSeconds = (stableTimestamp - startTime) / 1000.0;
      const currentY = spittle.startPosY + spittle.velocityY * elapsedSeconds;
      sortedEntities[index++] = {
        y: currentY,
        priority: 19,
        item: { type: 'viper_spittle' as const, entity: spittle }
      };
    }
    
    // Animal corpses - Priority 20, Y = posY
    for (const corpse of visibleAnimalCorpses) {
      sortedEntities[index++] = {
        y: corpse.posY,
        priority: 20,
        item: { type: 'animal_corpse' as const, entity: corpse }
      };
    }
    
    // Player corpses - Priority 20, Y = posY
    for (const corpse of visiblePlayerCorpses) {
      sortedEntities[index++] = {
        y: corpse.posY,
        priority: 20,
        item: { type: 'player_corpse' as const, entity: corpse }
      };
    }
    
    // Wild animals - Priority 4, Y = posY
    for (const animal of visibleWildAnimals) {
      sortedEntities[index++] = {
        y: animal.posY,
        priority: 4,
        item: { type: 'wild_animal' as const, entity: animal }
      };
    }
    
    // Barrels - Priority 15, Y = posY
    for (const barrel of visibleBarrels) {
      sortedEntities[index++] = {
        y: barrel.posY,
        priority: 15,
        item: { type: 'barrel' as const, entity: barrel }
      };
    }
    
    // Sea stacks - Priority 1, Y = posY - 55 (water line offset)
    for (const seaStack of visibleSeaStacks) {
      sortedEntities[index++] = {
        y: seaStack.posY - 55,
        priority: 1,
        item: { type: 'sea_stack' as const, entity: seaStack }
      };
    }
    
    // Shelters - Priority 25, Y = posY - 200 (visual base is 200px from bottom of image)
    for (const shelter of visibleShelters) {
      sortedEntities[index++] = {
        y: shelter.posY - 100, // Adjust for visual base position
        priority: 25,
        item: { type: 'shelter' as const, entity: shelter }
      };
    }
    
    // Trim array to actual size (in case some entities were filtered out)
    sortedEntities.length = index;
    
    // PERFORMANCE: Use optimized sort with pre-calculated values
    sortedEntities.sort((a, b) => {
      // Primary sort by Y position
      const yDiff = a.y - b.y;
      if (Math.abs(yDiff) > 0.1) {
        return yDiff;
      }
      // Secondary sort by priority when Y positions are close
      return b.priority - a.priority; // Reversed for correct rendering order
    });
    
    // Extract just the items for rendering
    return sortedEntities.map(entry => entry.item);
  },
    // Dependencies remain the same
    [visiblePlayers, visibleTrees, visibleStones, visibleWoodenStorageBoxes, 
    visiblePlayerCorpses, visibleStashes, 
    visibleCampfires, visibleFurnaces, visibleLanterns, visibleDroppedItems,
    visibleProjectiles, visibleGrass,
    visibleShelters,
    visiblePlantedSeeds,
    visibleRainCollectors,
    visibleWildAnimals,
    visibleViperSpittles,
    visibleAnimalCorpses,
    visibleBarrels,
    visibleSeaStacks,
    visibleHarvestableResources,
    stableTimestamp // Only include stableTimestamp for projectile calculations
  ]);

  return {
    visibleHarvestableResources,
    visibleDroppedItems,
    visibleCampfires,
    visibleLanterns,
    visiblePlayers,
    visibleTrees,
    visibleStones,
    visibleWoodenStorageBoxes,
    visibleSleepingBags,
    visiblePlayerCorpses,
    visibleStashes,
    visibleProjectiles,
    visibleHarvestableResourcesMap,
    visibleCampfiresMap,
    visibleLanternsMap,
    visibleDroppedItemsMap,
    visibleBoxesMap,
    visibleProjectilesMap,
    visiblePlayerCorpsesMap,
    visibleStashesMap,
    visibleSleepingBagsMap,
    visibleTreesMap,
    groundItems,
    ySortedEntities,
    visibleGrass,
    visibleGrassMap,
    visibleShelters,
    visibleSheltersMap,
    visibleClouds,
    visiblePlantedSeeds,
    visiblePlantedSeedsMap,
    visibleRainCollectors,
    visibleRainCollectorsMap,
    visibleWildAnimals,
    visibleWildAnimalsMap,
    visibleViperSpittles,
    visibleViperSpittlesMap,
    visibleAnimalCorpses,
    visibleAnimalCorpsesMap,
    visibleBarrels,
    visibleBarrelsMap,
    visibleSeaStacks, 
    visibleSeaStacksMap,
    visibleFurnaces,
    visibleFurnacesMap,
  };
} 