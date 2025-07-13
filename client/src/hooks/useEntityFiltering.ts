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

interface ViewportBounds {
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
  const currentTime = Date.now();
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
      (e.respawnAt === null || e.respawnAt === undefined) && isEntityInView(e, viewBounds, currentTime)
    ) : [],
    [harvestableResources, isEntityInView, viewBounds, currentTime]
  );

  const visibleDroppedItems = useMemo(() => 
    // Check source map
    droppedItems ? Array.from(droppedItems.values()).filter(e => isEntityInView(e, viewBounds, currentTime))
    : [],
    [droppedItems, isEntityInView, viewBounds, currentTime]
  );

  const visibleCampfires = useMemo(() => 
    // Check source map
    campfires ? Array.from(campfires.values()).filter(e => isEntityInView(e, viewBounds, currentTime) && !e.isDestroyed)
    : [],
    [campfires, isEntityInView, viewBounds, currentTime]
  );

  const visibleFurnaces = useMemo(() => 
    // Check source map - same filtering as campfires
    furnaces ? Array.from(furnaces.values()).filter(e => isEntityInView(e, viewBounds, currentTime) && !e.isDestroyed)
    : [],
    [furnaces, isEntityInView, viewBounds, currentTime]
  );

  const visibleLanterns = useMemo(() => {
    if (!lanterns) return [];
    
    const allLanterns = Array.from(lanterns.values());
    const visibleFiltered = allLanterns.filter(e => isEntityInView(e, viewBounds, currentTime) && !e.isDestroyed);
    
    return visibleFiltered;
  }, [lanterns, isEntityInView, viewBounds, currentTime]);

  const visiblePlayers = useMemo(() => {
    // console.log('[useEntityFiltering] Computing visiblePlayers. players map size:', players?.size);
    
    if (!players) {
      // console.log('[useEntityFiltering] No players map, returning empty array');
      return [];
    }
    
    // Debug: Check the Map contents directly
    // console.log('[useEntityFiltering] Players Map contents:');
    let mapIndex = 0;
    players.forEach((player, key) => {
      // console.log(`  [${mapIndex}] Key: ${key}, Player:`, {
      // });
      mapIndex++;
    });
    
    // Debug: Check Array.from conversion
    const playersArray = Array.from(players.values());
    // console.log('[useEntityFiltering] After Array.from conversion:', playersArray.length, 'players');
    playersArray.forEach((player, index) => {
      // console.log(`  Array[${index}]:`, {
      // });
    });
    
    // Debug: Test filtering one by one
    const filteredPlayers: any[] = [];
    playersArray.forEach((player, index) => {
      // console.log(`[useEntityFiltering] Filtering player ${index}:`, {
      // });
      
             // Call isEntityInView and capture result
       const isInView = isEntityInView(player, viewBounds, currentTime);
       
       // console.log(`  isInView: ${isInView}`);
       
       if (isInView) {
         filteredPlayers.push(player);
       }
    });
    
    // console.log('[useEntityFiltering] Final filtered players count:', filteredPlayers.length);
    return filteredPlayers;
  }, [players, isEntityInView, viewBounds, currentTime]);

  const visibleTrees = useMemo(() => 
    // Check source map
    trees ? Array.from(trees.values()).filter(e => e.health > 0 && isEntityInView(e, viewBounds, currentTime))
    : [],
    [trees, isEntityInView, viewBounds, currentTime]
  );

  const visibleStones = useMemo(() => 
    // Check source map
    stones ? Array.from(stones.values()).filter(e => e.health > 0 && isEntityInView(e, viewBounds, currentTime))
    : [],
    [stones, isEntityInView, viewBounds, currentTime]
  );

  const visibleWoodenStorageBoxes = useMemo(() => 
    // Check source map
    woodenStorageBoxes ? Array.from(woodenStorageBoxes.values()).filter(e => isEntityInView(e, viewBounds, currentTime))
    : [],
    [woodenStorageBoxes, isEntityInView, viewBounds, currentTime]
  );
  
  const visibleSleepingBags = useMemo(() => 
    // Check source map
    sleepingBags ? Array.from(sleepingBags.values())
      .filter(e => isEntityInView(e, viewBounds, currentTime))
      : []
    ,[sleepingBags, isEntityInView, viewBounds, currentTime]
  );

  const visiblePlayerCorpses = useMemo(() => 
    // Add check: If playerCorpses is undefined or null, return empty array
    playerCorpses ? Array.from(playerCorpses.values())
      .filter(e => isEntityInView(e, viewBounds, currentTime))
      : []
    ,[playerCorpses, isEntityInView, viewBounds, currentTime]
  );

  const visibleStashes = useMemo(() => 
    stashes ? Array.from(stashes.values()).filter(e => isEntityInView(e, viewBounds, currentTime))
    : [],
    [stashes, isEntityInView, viewBounds, currentTime]
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
      e.health > 0 && isEntityInView(e, viewBounds, currentTime)
    ) : [],
    [grass, isEntityInView, viewBounds, currentTime]
  ); // grass parameter is now Map<string, InterpolatedGrassData>

  // ADDED: Filter visible shelters
  const visibleShelters = useMemo(() => {
    const filtered = shelters ? Array.from(shelters.values()).filter(e => !e.isDestroyed && isEntityInView(e, viewBounds, currentTime)) : [];
    // console.log('[useEntityFiltering] Filtered visibleShelters count:', filtered.length, filtered); // DEBUG LOG 2
    return filtered;
  }, [shelters, isEntityInView, viewBounds, currentTime]);

  const visibleClouds = useMemo(() => 
    clouds ? Array.from(clouds.values()).filter(e => isEntityInView(e, viewBounds, currentTime))
    : [],
    [clouds, isEntityInView, viewBounds, currentTime]
  );

  const visiblePlantedSeeds = useMemo(() => 
    plantedSeeds ? Array.from(plantedSeeds.values()).filter(e => isEntityInView(e, viewBounds, currentTime))
    : [],
    [plantedSeeds, isEntityInView, viewBounds, currentTime]
  );

  const visibleRainCollectors = useMemo(() => 
    rainCollectors ? Array.from(rainCollectors.values()).filter(e => !e.isDestroyed && isEntityInView(e, viewBounds, currentTime))
    : [],
    [rainCollectors, isEntityInView, viewBounds, currentTime]
  );

  const visibleWildAnimals = useMemo(() => 
    wildAnimals ? Array.from(wildAnimals.values()).filter(e => isEntityInView(e, viewBounds, currentTime))
    : [],
    [wildAnimals, isEntityInView, viewBounds, currentTime]
  );

  const visibleViperSpittles = useMemo(() => 
    viperSpittles ? Array.from(viperSpittles.values()).filter(e => isEntityInView(e, viewBounds, currentTime))
    : [],
    [viperSpittles, isEntityInView, viewBounds, currentTime]
  );

  const visibleAnimalCorpses = useMemo(() => {
    const result = animalCorpses ? Array.from(animalCorpses.values()).filter(e => {
      const inView = isEntityInView(e, viewBounds, currentTime);
      // Convert microseconds to milliseconds for proper comparison
      const despawnTimeMs = Number(e.despawnAt.__timestamp_micros_since_unix_epoch__ / 1000n);
      const notDespawned = currentTime < despawnTimeMs; // Check if current time is before despawn time
      return inView && notDespawned;
    }) : [];
    // console.log(`🦴 [ANIMAL CORPSE FILTERING] Total corpses: ${animalCorpses?.size || 0}, Visible after filtering: ${result.length}, IDs: [${result.map(c => c.id).join(', ')}]`);
    return result;
  }, [animalCorpses, isEntityInView, viewBounds, currentTime]);

  const visibleBarrels = useMemo(() => 
    barrels ? Array.from(barrels.values()).filter(e => 
      !e.respawnAt && isEntityInView(e, viewBounds, currentTime) // Don't show if respawning (destroyed)
    ) : [],
    [barrels, isEntityInView, viewBounds, currentTime]
  );

  const visibleSeaStacks = useMemo(() => 
    seaStacks ? Array.from(seaStacks.values()).filter(e => isEntityInView(e, viewBounds, currentTime))
    : [],
    [seaStacks, isEntityInView, viewBounds, currentTime]
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

  // Group entities for rendering
  const groundItems = useMemo(() => [
    ...visibleSleepingBags,
  ], [visibleSleepingBags]);

  // Y-sorted entities with sorting and correct type structure
  const ySortedEntities = useMemo(() => {
    // console.log('[DEBUG] visiblePlayers.length:', visiblePlayers.length, 'total players:', players.size);
    if (visiblePlayers.length === 0 && players.size > 0) {
      // console.log('[DEBUG] Players exist but none are visible! Viewport culling issue?');
      const firstPlayer = Array.from(players.values())[0];
      // console.log('[DEBUG] First player sample:', firstPlayer);
      // console.log('[DEBUG] Player position:', firstPlayer.positionX, firstPlayer.positionY);
      console.log('[DEBUG] Viewport bounds - view area:', { cameraOffsetX, cameraOffsetY, canvasWidth, canvasHeight });
      
      // Calculate and show actual viewport bounds
      const buffer = 64 * 3; // Same as in getViewportBounds
      const viewMinX = -cameraOffsetX - buffer;
      const viewMaxX = -cameraOffsetX + canvasWidth + buffer;
      const viewMinY = -cameraOffsetY - buffer;
      const viewMaxY = -cameraOffsetY + canvasHeight + buffer;
      console.log('[DEBUG] Actual viewport bounds:', { viewMinX, viewMaxX, viewMinY, viewMaxY });
      console.log('[DEBUG] Player within bounds?', firstPlayer.positionX >= viewMinX && firstPlayer.positionX <= viewMaxX && firstPlayer.positionY >= viewMinY && firstPlayer.positionY <= viewMaxY);
    }
    const mappedEntities: YSortedEntityType[] = [
      // Map each entity type to the { type, entity } structure
      ...visiblePlayers.map(p => ({ type: 'player' as const, entity: p })),
      ...visibleTrees.map(t => ({ type: 'tree' as const, entity: t })),
      ...visibleStones.filter(stone => stone.health > 0).map(s => ({ type: 'stone' as const, entity: s })),
      ...visibleWoodenStorageBoxes.map(b => ({ type: 'wooden_storage_box' as const, entity: b })),
      ...visibleStashes.map(st => ({ type: 'stash' as const, entity: st })),
      ...visibleCampfires.map(cf => ({ type: 'campfire' as const, entity: cf })),
      ...visibleFurnaces.map(f => ({ type: 'furnace' as const, entity: f })), // ADDED: Furnaces
      ...visibleLanterns.map(l => ({ type: 'lantern' as const, entity: l })),
      ...visibleDroppedItems.map(di => ({ type: 'dropped_item' as const, entity: di })),
      ...visiblePlayerCorpses.map(c => ({ type: 'player_corpse' as const, entity: c })),
      ...visibleProjectiles.map(p => ({ type: 'projectile' as const, entity: p })),
      ...visibleShelters.map(s => ({ type: 'shelter' as const, entity: s })),
      ...visibleGrass.map(g => ({ type: 'grass' as const, entity: g })), // g is InterpolatedGrassData
      ...visiblePlantedSeeds.map(p => ({ type: 'planted_seed' as const, entity: p })),
      ...visibleRainCollectors.map(r => ({ type: 'rain_collector' as const, entity: r })),
      ...visibleWildAnimals.map(w => ({ type: 'wild_animal' as const, entity: w })),
      ...visibleViperSpittles.map(v => ({ type: 'viper_spittle' as const, entity: v })),
      ...visibleAnimalCorpses.map(a => ({ type: 'animal_corpse' as const, entity: a })),
      ...visibleBarrels.map(b => ({ type: 'barrel' as const, entity: b })),
      ...visibleSeaStacks.map(s => ({ type: 'sea_stack' as const, entity: s })),
      ...visibleHarvestableResources.map(hr => ({ type: 'harvestable_resource' as const, entity: hr })),
    ];
    
    // console.log('[DEBUG] Y-sorted entities - potatoes:', mappedEntities.filter(e => e.type === 'potato'));
    // console.log('[DEBUG] visiblePotatoes count:', visiblePotatoes.length);
    

    
    // Filter out any potential null/undefined entries AFTER mapping (just in case)
    const validEntities = mappedEntities.filter(e => e && e.entity);

    const getSortY = (item: YSortedEntityType): number => {
      const entity = item.entity;
      let sortY = 0;

      if (isPlayer(entity)) {
        // Players sort by their foot position (bottom of sprite)
        // Add offset to move from center to foot position
        sortY = entity.positionY + 48; // Add half player height to get foot position
        console.log(`[PLAYER DEBUG] Player Y-sort: ${sortY} (original: ${entity.positionY})`);
        return sortY;
      }

      // Trees should sort by their base/trunk position (bottom of sprite)
      if (isTree(entity)) {
        // Trees are tall, so we sort by their base position
        // No offset needed - use the actual base position
        sortY = entity.posY;
        return sortY;
      }

      // Sea stacks should sort by their water line level (visual interaction point)
      if (isSeaStack(entity)) {
        // Sea stacks sort by their water line level for proper player interaction
        // The water line is 55px above the underwater base (HEIGHT_OFFSET from seaStackRenderingUtils.ts)
        const WATER_LINE_OFFSET = 55; // Must match HEIGHT_OFFSET in seaStackRenderingUtils.ts
        sortY = entity.posY - WATER_LINE_OFFSET;
        return sortY;
      }

      // Stones should sort by their base position
      if (isStone(entity)) {
        // Stones are ground-level objects
        sortY = entity.posY;
        return sortY;
      }

      // Wooden storage boxes should sort by their base position
      if (isWoodenStorageBox(entity)) {
        // Boxes are ground objects, sort by their base
        sortY = entity.posY;
        return sortY;
      }

      // Stashes should sort by their base position (small ground objects)
      if (isStash(entity)) {
        // Stashes are small ground objects, sort by their base
        sortY = entity.posY;
        return sortY;
      }

      // Explicit handling for Shelter
      if (isShelter(entity)) {
        sortY = entity.posY;
        return sortY;
      }

      // Ground resources (harvestable resources) sort by their base
      if (isHarvestableResource(entity)) {
        // These are ground-level resources
        sortY = entity.posY;
        return sortY;
      }

      // Dropped items sort by their base
      if (isDroppedItem(entity)) {
        sortY = entity.posY;
        return sortY;
      }
 
      if (isCampfire(entity)) { 
        // Campfires are ground objects - sort by their base position
        // Account for visual rendering offset so players render behind campfires appropriately
        // Subtract offset to make campfire "claim more northern space" in Y-sorting
        sortY = entity.posY; // Offset to account for visual positioning
        return sortY;
      }

      // Check for furnace using same logic as campfire
      if ((entity as any).fuelInventoryId !== undefined && (entity as any).isBurning !== undefined) {
        // Furnaces are ground objects like campfires - sort by their base position
        sortY = (entity as any).posY;
        return sortY;
      }

      // Check for lantern using proper type guard
      if (isLantern(entity)) {
        // Lanterns use the same Y-sorting as campfires and other ground objects
        // Use the base position for proper Y-sorting so players can walk behind them
        sortY = entity.posY;
        return sortY;
      }

      // if (isGrass(entity)) {
      //   // Grass/bushes are ground-level decorations
      //   // entity here is already InterpolatedGrassData due to how ySortedEntities is constructed
      //   sortY = (entity as InterpolatedGrassData).serverPosY;
      //   return sortY;
      // }

      // Handle projectiles - calculate current Y position
      if ((entity as any).startPosX !== undefined && (entity as any).startPosY !== undefined && (entity as any).velocityY !== undefined) {
        const projectile = entity as any;
        const startTime = Number(projectile.startTime.microsSinceUnixEpoch / 1000n);
        const elapsedSeconds = (currentTime - startTime) / 1000.0;
        sortY = projectile.startPosY + projectile.velocityY * elapsedSeconds;
        return sortY;
      }

      // Handle planted seeds - they should sort by their base position like other ground items
      if ((entity as any).posX !== undefined && (entity as any).seedType !== undefined) {
        sortY = (entity as any).posY;
        return sortY;
      }

      // Handle wild animals - sort by their foot position
      if (isWildAnimal(entity)) {
        // Wild animals should sort by their base position (foot)
        sortY = entity.posY;
        return sortY;
      }

      // Handle viper spittles - calculate current Y position like projectiles
      if ((entity as any).viperId !== undefined && (entity as any).startPosX !== undefined) {
        const spittle = entity as any;
        const startTime = Number(spittle.startTime.microsSinceUnixEpoch / 1000n);
        const elapsedSeconds = (currentTime - startTime) / 1000.0;
        sortY = spittle.startPosY + spittle.velocityY * elapsedSeconds;
        return sortY;
      }

      // Handle animal corpses - sort by their base position like player corpses
      if (isAnimalCorpse(entity)) {
        // Animal corpses are ground objects, sort by their base
        sortY = entity.posY;
        return sortY;
      }

      // Handle barrels - sort by their base position like other ground objects
      if (isBarrel(entity)) {
        // Barrels are ground objects, sort by their base
        sortY = entity.posY;
        return sortY;
      }

      // For other entities, use their standard posY if it exists, otherwise default or handle error.
      // This check is a bit broad, ideally, each type in YSortedEntityType should have a defined posY or equivalent.
      if ((entity as any).posY !== undefined) {
        sortY = (entity as any).posY;
      } else if ((entity as any).positionY !== undefined) {
        sortY = (entity as any).positionY;
      } else {
        console.warn("Entity type in getSortY does not have a standard posY or positionY property:", entity);
        sortY = 0; // Default sortY if no position found
      }
      return sortY;
    };

    // Sort the mapped entities using the adjusted Y value
    validEntities.sort((a, b) => {
      const yA = getSortY(a);
      const yB = getSortY(b);
      
      // Debug logging for player vs campfire interactions (commented out to reduce console spam)
      // if ((a.type === 'player' && b.type === 'campfire') || (a.type === 'campfire' && b.type === 'player')) {
      //   console.log(`[Y-SORT] ${a.type}(${yA.toFixed(1)}) vs ${b.type}(${yB.toFixed(1)}) | Diff: ${Math.abs(yA - yB).toFixed(1)} | Close: ${Math.abs(yA - yB) <= 0.1}`);
      // }
      
      // Primary sort by Y position
      if (Math.abs(yA - yB) > 0.1) { // Revert back to 0.1
        return yA - yB;
      }
      
      // Debug logging when type priority kicks in (commented out to reduce console spam)
      // if ((a.type === 'player' && b.type === 'campfire') || (a.type === 'campfire' && b.type === 'player')) {
      //   console.log(`[TYPE-PRIORITY] Using type priority: ${a.type} vs ${b.type}`);
      // }
      
      // Secondary sort: When Y positions are very close, use entity type priority
      // Trees should render behind wild animals at the same Y position
      const getTypePriority = (type: string): number => {
        switch (type) {
          case 'sea_stack': return 1;   // Sea stacks render behind most things like trees (tall background structures)
          case 'tree': return 2;        // Trees render behind most things
          case 'stone': return 3;       // Stones
          case 'wild_animal': return 4; // Wild animals render in front of trees and sea stacks
          case 'wooden_storage_box': return 5;
          case 'stash': return 6;
          case 'campfire': return 7;  // Campfires are ground objects like storage boxes
          case 'furnace': return 7.5; // Furnaces are ground objects, slightly in front of campfires
          case 'lantern': return 8;
          case 'grass': return 9;
          case 'planted_seed': return 10;
          case 'dropped_item': return 11;
          case 'harvestable_resource': return 12;
          case 'rain_collector': return 18;
          case 'projectile': return 19;
          case 'viper_spittle': return 19; // Same priority as projectiles
          case 'animal_corpse': return 20; // Same priority as player corpses
          case 'player_corpse': return 20;
          case 'player': return 21;     // Players render in front of most things including sea stacks
          case 'shelter': return 25;    // Shelters render behind EVERYTHING including players
          default: return 15;
        }
      };
      
      return getTypePriority(b.type) - getTypePriority(a.type); // Reversed to match Y-sorting
    });

    return validEntities;
  }, [
    visiblePlayers, visibleTrees, visibleStones, visibleWoodenStorageBoxes, 
    visiblePlayerCorpses, visibleStashes, 
    visibleCampfires, visibleFurnaces, visibleLanterns, visibleDroppedItems, // ADDED: visibleFurnaces
    visibleProjectiles, visibleGrass, // visibleGrass is now InterpolatedGrassData[]
    visibleShelters, // ADDED visibleShelters to dependencies
    visiblePlantedSeeds, // ADDED visiblePlantedSeeds to dependencies
    visibleRainCollectors, // ADDED visibleRainCollectors to dependencies
    visibleWildAnimals, // ADDED visibleWildAnimals to dependencies
    visibleViperSpittles, // ADDED visibleViperSpittles to dependencies
    visibleAnimalCorpses, // ADDED visibleAnimalCorpses to dependencies
    visibleBarrels, // ADDED visibleBarrels to dependencies
    visibleSeaStacks, // ADDED visibleSeaStacks to dependencies
    visibleHarvestableResources, // ADDED visibleHarvestableResources to dependencies
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