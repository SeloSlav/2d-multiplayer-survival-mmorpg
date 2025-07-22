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

// ===== HELPER FUNCTIONS FOR Y-SORTING =====
const getEntityY = (item: YSortedEntityType, timestamp: number): number => {
  const { entity, type } = item;
  switch (type) {
    case 'player':
      return entity.positionY + 48;
    case 'tree':
    case 'stone':
    case 'wooden_storage_box':
    case 'stash':
    case 'campfire':
    case 'furnace':
    case 'lantern':
    case 'planted_seed':
    case 'dropped_item':
    case 'harvestable_resource':
    case 'rain_collector':
    case 'animal_corpse':
    case 'player_corpse':
    case 'wild_animal':
    case 'barrel':
      return entity.posY;
    case 'grass':
      return entity.serverPosY;
    case 'projectile': {
      const startTime = Number(entity.startTime.microsSinceUnixEpoch / 1000n);
      const elapsedSeconds = (timestamp - startTime) / 1000.0;
      return entity.startPosY + entity.velocityY * elapsedSeconds;
    }
    case 'viper_spittle': {
      const startTime = Number(entity.startTime.microsSinceUnixEpoch / 1000n);
      const elapsedSeconds = (timestamp - startTime) / 1000.0;
      return entity.startPosY + entity.velocityY * elapsedSeconds;
    }
    case 'sea_stack':
      return entity.posY - 55;
    case 'shelter':
      return entity.posY - 100;
    default:
      return 0;
  }
};

const getEntityPriority = (item: YSortedEntityType): number => {
  switch (item.type) {
    case 'sea_stack': return 1;
    case 'tree': return 2;
    case 'stone': return 3;
    case 'wild_animal': return 4;
    case 'wooden_storage_box': return 5;
    case 'stash': return 6;
    case 'campfire': return 7;
    case 'furnace': return 7.5;
    case 'lantern': return 8;
    case 'grass': return 9;
    case 'planted_seed': return 10;
    case 'dropped_item': return 11;
    case 'harvestable_resource': return 12;
    case 'barrel': return 15;
    case 'rain_collector': return 18;
    case 'projectile': return 19;
    case 'viper_spittle': return 19;
    case 'animal_corpse': return 20;
    case 'player_corpse': return 20;
    case 'player': return 21;
    case 'shelter': return 25;
    default: return 0;
  }
};


// ===== PERFORMANCE OPTIMIZATION CONSTANTS =====
const PERFORMANCE_MODE = {
  // Frame-based throttling for different entity types
  TREE_UPDATE_INTERVAL: 3,          // Update trees every 3 frames
  STONE_UPDATE_INTERVAL: 5,         // Update stones every 5 frames  
  RESOURCE_UPDATE_INTERVAL: 2,      // Update resources every 2 frames
  DECORATION_UPDATE_INTERVAL: 10,   // Update decorations every 10 frames
  
  // Distance-based culling (squared for performance) - MUCH LESS AGGRESSIVE
  TREE_CULL_DISTANCE_SQ: 2000 * 2000,      // 2000px radius (much larger)
  STONE_CULL_DISTANCE_SQ: 1800 * 1800,     // 1800px radius (much larger)
  RESOURCE_CULL_DISTANCE_SQ: 1600 * 1600,  // 1600px radius (much larger)
  DECORATION_CULL_DISTANCE_SQ: 1400 * 1400, // 1400px radius (much larger)
  
  // Entity count limiting - MUCH HIGHER LIMITS
  MAX_TREES_PER_FRAME: 200,        // Increased from 50 to 200
  MAX_STONES_PER_FRAME: 100,       // Increased from 30 to 100
  MAX_RESOURCES_PER_FRAME: 80,     // Increased from 25 to 80
  MAX_DECORATIONS_PER_FRAME: 150,  // Increased from 20 to 150
  
  // Emergency mode thresholds - MUCH HIGHER BEFORE EMERGENCY
  EMERGENCY_TOTAL_ENTITIES: 800,   // Increased from 200 to 500
  EMERGENCY_FPS_THRESHOLD: 30,     // Increased from 45 to 30
  
  // Viewport expansion for conservative culling - MUCH LARGER BUFFER
  VIEWPORT_EXPANSION_FACTOR: 2.5,  // Increased from 1.5 to 2.5 (show 2.5x viewport size)
  EMERGENCY_MAX_TREES: 100,
  EMERGENCY_MAX_RESOURCES: 40,
  EMERGENCY_MAX_DECORATIONS: 50,
};

// Frame counters for throttling
let frameCounter = 0;
let emergencyMode = false;

// Cache for pre-filtered entities to avoid recalculation
const entityCache = new Map<string, {
  entities: any[];
  lastUpdateFrame: number;
  lastPlayerX: number;
  lastPlayerY: number;
}>();

// ===== PERFORMANCE LOGGING SYSTEM =====
let lastPerformanceLog = 0;
const PERFORMANCE_LOG_INTERVAL = 1000; // Log every 1 second
const PERFORMANCE_LAG_THRESHOLD = 50; // Log if filtering takes more than 50ms

function logPerformanceData(
  processingTime: number,
  entityCounts: {
    trees: number;
    stones: number;
    resources: number;
    campfires: number;
    furnaces: number;
    animals: number;
    grass: number;
    total: number;
  },
  playerPos: { x: number; y: number },
  emergencyMode: boolean
) {
  const now = Date.now();
  const isLagSpike = processingTime > PERFORMANCE_LAG_THRESHOLD;
  const shouldLog = isLagSpike || (now - lastPerformanceLog > PERFORMANCE_LOG_INTERVAL);
  
  if (shouldLog) {
    const prefix = isLagSpike ? "🔥 [LAG SPIKE]" : "📊 [PERFORMANCE]";
    console.log(`${prefix} Entity filtering took ${processingTime.toFixed(2)}ms`);
    // console.log(`  📍 Player position: (${playerPos.x.toFixed(0)}, ${playerPos.y.toFixed(0)})`);
    console.log(`  🌲 Trees: ${entityCounts.trees}, 🪨 Stones: ${entityCounts.stones}, 🌿 Resources: ${entityCounts.resources}`);
    // console.log(`  🔥 Campfires: ${entityCounts.campfires}, ⚒️ Furnaces: ${entityCounts.furnaces}, 🐺 Animals: ${entityCounts.animals}`);
    console.log( `📊 Total: ${entityCounts.total}`);
    // console.log(`  🚨 Emergency mode: ${emergencyMode ? 'ACTIVE' : 'INACTIVE'}`);
    
    if (isLagSpike) {
      console.log(`  ⚠️ LAG SPIKE DETECTED! Processing time: ${processingTime.toFixed(2)}ms`);
    }
    
    lastPerformanceLog = now;
  }
}

// ===== ENTITY COUNTING HELPERS =====
function countEntitiesInRadius(
  entities: any[],
  playerPos: { x: number; y: number },
  radius: number
): { total: number; nearby: number } {
  const radiusSq = radius * radius;
  let nearby = 0;
  
  entities.forEach(entity => {
    const dx = entity.posX - playerPos.x;
    const dy = entity.posY - playerPos.y;
    if (dx * dx + dy * dy <= radiusSq) {
      nearby++;
    }
  });
  
  return { total: entities.length, nearby };
}

// Helper function to get player position for distance calculations
function getPlayerPosition(players: Map<string, SpacetimeDBPlayer>): { x: number; y: number } | null {
  if (!players || players.size === 0) return null;
  
  // Try to find the local player or use the first available player
  const firstPlayer = Array.from(players.values())[0];
  return firstPlayer ? { x: firstPlayer.positionX, y: firstPlayer.positionY } : null;
}

// Optimized distance-based filtering
function filterEntitiesByDistance<T extends { posX: number; posY: number }>(
  entities: T[],
  playerPos: { x: number; y: number },
  maxDistanceSq: number,
  maxCount: number
): T[] {
  if (entities.length === 0) return entities;
  
  // Calculate distances and filter
  const withDistance = entities
    .map(entity => {
      const dx = entity.posX - playerPos.x;
      const dy = entity.posY - playerPos.y;
      return { entity, distanceSq: dx * dx + dy * dy };
    })
    .filter(item => item.distanceSq <= maxDistanceSq)
    .sort((a, b) => a.distanceSq - b.distanceSq) // Sort by distance (closest first)
    .slice(0, maxCount) // Limit count
    .map(item => item.entity);
  
  return withDistance;
}

// Cached entity filtering with frame-based throttling
function getCachedFilteredEntities<T extends { posX: number; posY: number }>(
  entities: Map<string, T> | undefined,
  cacheKey: string,
  updateInterval: number,
  maxDistanceSq: number,
  maxCount: number,
  playerPos: { x: number; y: number } | null,
  additionalFilter?: (entity: T) => boolean
): T[] {
  if (!entities || !playerPos) return [];
  
  const cache = entityCache.get(cacheKey);
  
  // Check if we can use cached results
  if (cache && 
      (frameCounter - cache.lastUpdateFrame) < updateInterval &&
      Math.abs(cache.lastPlayerX - playerPos.x) < 100 &&
      Math.abs(cache.lastPlayerY - playerPos.y) < 100) {
    return cache.entities;
  }
  
  // Need to update cache
  let entityArray = Array.from(entities.values());
  
  // Apply additional filter if provided
  if (additionalFilter) {
    entityArray = entityArray.filter(additionalFilter);
  }
  
  // Apply distance-based filtering
  const filteredEntities = filterEntitiesByDistance(
    entityArray,
    playerPos,
    emergencyMode ? (800 * 800) : maxDistanceSq,
    emergencyMode ? PERFORMANCE_MODE.EMERGENCY_MAX_TREES : maxCount
  );
  
  // Update cache
  entityCache.set(cacheKey, {
    entities: filteredEntities,
    lastUpdateFrame: frameCounter,
    lastPlayerX: playerPos.x,
    lastPlayerY: playerPos.y
  });
  
  return filteredEntities;
}

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
  // START PERFORMANCE TIMING
  const filteringStartTime = performance.now();
  
  // Increment frame counter for throttling
  frameCounter++;
  
  // Get player position for distance calculations
  const playerPos = getPlayerPosition(players);
  
  // Count total entities to determine if we need emergency mode
  const totalEntityCount = (trees?.size || 0) + (stones?.size || 0) + 
                          (harvestableResources?.size || 0) + (grass?.size || 0) +
                          (droppedItems?.size || 0) + (wildAnimals?.size || 0);
  
  // Update emergency mode
  const shouldBeEmergencyMode = totalEntityCount > PERFORMANCE_MODE.EMERGENCY_TOTAL_ENTITIES;
  if (shouldBeEmergencyMode !== emergencyMode) {
    emergencyMode = shouldBeEmergencyMode;
    console.log(`🚨 [PERFORMANCE] Emergency mode ${emergencyMode ? 'ACTIVATED' : 'DEACTIVATED'} - ${totalEntityCount} total entities`);
  }

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

  // PERFORMANCE: Use cached filtering for expensive entity types
  let cachedVisibleTrees = useMemo(() => {
    if (!playerPos) return [];
    
    return getCachedFilteredEntities(
      trees,
      'trees',
      PERFORMANCE_MODE.TREE_UPDATE_INTERVAL,
      PERFORMANCE_MODE.TREE_CULL_DISTANCE_SQ,
      PERFORMANCE_MODE.MAX_TREES_PER_FRAME,
      playerPos,
      (tree) => tree.health > 0 && isEntityInView(tree, viewBounds, stableTimestamp)
    );
  }, [trees, playerPos, viewBounds, stableTimestamp, frameCounter]);

  let cachedVisibleStones = useMemo(() => {
    if (!playerPos) return [];
    
    return getCachedFilteredEntities(
      stones,
      'stones',
      PERFORMANCE_MODE.STONE_UPDATE_INTERVAL,
      PERFORMANCE_MODE.STONE_CULL_DISTANCE_SQ,
      PERFORMANCE_MODE.MAX_STONES_PER_FRAME,
      playerPos,
      (stone) => stone.health > 0 && isEntityInView(stone, viewBounds, stableTimestamp)
    );
  }, [stones, playerPos, viewBounds, stableTimestamp, frameCounter]);

  let cachedVisibleResources = useMemo(() => {
    if (!playerPos) return [];
    
    return getCachedFilteredEntities(
      harvestableResources,
      'resources',
      PERFORMANCE_MODE.RESOURCE_UPDATE_INTERVAL,
      PERFORMANCE_MODE.RESOURCE_CULL_DISTANCE_SQ,
      PERFORMANCE_MODE.MAX_RESOURCES_PER_FRAME,
      playerPos,
      (resource) => (resource.respawnAt === null || resource.respawnAt === undefined) && 
                    isEntityInView(resource, viewBounds, stableTimestamp)
    );
  }, [harvestableResources, playerPos, viewBounds, stableTimestamp, frameCounter]);

  // Use cached results instead of original filtering
  let visibleTrees = cachedVisibleTrees;
  const visibleStones = cachedVisibleStones;
  let visibleHarvestableResources = cachedVisibleResources;

  // Keep original filtering for less expensive entity types
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

  // PERFORMANCE: More aggressive grass culling
  let visibleGrass = useMemo(() => {
    if (!grass || !playerPos) return [];
    
    // In emergency mode, severely limit grass rendering
    if (emergencyMode) {
      return getCachedFilteredEntities(
        grass,
        'grass_emergency',
        PERFORMANCE_MODE.DECORATION_UPDATE_INTERVAL,
        (800 * 800),
        PERFORMANCE_MODE.EMERGENCY_MAX_DECORATIONS, // Only 10 grass entities in emergency mode
        playerPos,
        (grassEntity) => grassEntity.health > 0 && isEntityInView(grassEntity, viewBounds, stableTimestamp)
      );
    }
    
    return Array.from(grass.values()).filter(e => 
      e.health > 0 && isEntityInView(e, viewBounds, stableTimestamp)
    );
  }, [grass, playerPos, viewBounds, stableTimestamp, emergencyMode, frameCounter]);

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

  const visibleStonesMap = useMemo(() => {
    const map = new Map<string, SpacetimeDBStone>();
    visibleStones.forEach(e => map.set(e.id.toString(), e));
    return map;
  }, [visibleStones]);

  const visibleWoodenStorageBoxesMap = useMemo(() => {
    const map = new Map<string, SpacetimeDBWoodenStorageBox>();
    visibleWoodenStorageBoxes.forEach(e => map.set(e.id.toString(), e));
    return map;
  }, [visibleWoodenStorageBoxes]);

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

  // ===== CACHED Y-SORTING WITH DIRTY FLAG SYSTEM =====
  // Cache for Y-sorted entities to avoid recalculating every frame
  const ySortedCache = useMemo(() => ({
    entities: [] as YSortedEntityType[],
    lastUpdateFrame: -1,
    lastEntityCounts: {} as Record<string, number>,
    isDirty: true
  }), []);
  
  // Helper to check if entity counts changed significantly
  const hasEntityCountChanged = useCallback((newCounts: Record<string, number>) => {
    const oldCounts = ySortedCache.lastEntityCounts;
    for (const [key, count] of Object.entries(newCounts)) {
      if (Math.abs((oldCounts[key] || 0) - count) > 2) { // Only resort if count changed by more than 2
        return true;
      }
    }
    return false;
  }, [ySortedCache]);

  // Y-sorted entities with PERFORMANCE OPTIMIZED sorting
  const ySortedEntities = useMemo(() => {
    // Calculate current entity counts
    const currentEntityCounts = {
      players: visiblePlayers.length,
      trees: visibleTrees.length,
      stones: visibleStones.length,
      boxes: visibleWoodenStorageBoxes.length,
      campfires: visibleCampfires.length,
      furnaces: visibleFurnaces.length,
      lanterns: visibleLanterns.length,
      droppedItems: visibleDroppedItems.length,
      projectiles: visibleProjectiles.length,
      shelters: visibleShelters.length,
      grass: visibleGrass.length,
      plantedSeeds: visiblePlantedSeeds.length,
      rainCollectors: visibleRainCollectors.length,
      wildAnimals: visibleWildAnimals.length,
      viperSpittles: visibleViperSpittles.length,
      animalCorpses: visibleAnimalCorpses.length,
      barrels: visibleBarrels.length,
      seaStacks: visibleSeaStacks.length,
      harvestableResources: visibleHarvestableResources.length,
      playerCorpses: visiblePlayerCorpses.length,
      stashes: visibleStashes.length
    };
    
    const totalEntities = Object.values(currentEntityCounts).reduce((sum, count) => sum + count, 0);
    
    // Early exit if no entities
    if (totalEntities === 0) return [];
    
    // Check if we need to resort
    const needsResort = ySortedCache.isDirty || 
                       (frameCounter - ySortedCache.lastUpdateFrame) > 10 || // Force resort every 10 frames
                       hasEntityCountChanged(currentEntityCounts);
    
    if (!needsResort && ySortedCache.entities.length > 0) {
      // Use cached result - huge performance gain!
      return ySortedCache.entities;
    }
    
    // PERFORMANCE: Pre-allocate array with known size to avoid dynamic resizing
    const allEntities: YSortedEntityType[] = new Array(totalEntities);
    let index = 0;
    
    // Aggregate all entity types into a single array
    visiblePlayers.forEach(e => allEntities[index++] = { type: 'player', entity: e });
    visibleTrees.forEach(e => allEntities[index++] = { type: 'tree', entity: e });
    visibleStones.forEach(e => { if (e.health > 0) allEntities[index++] = { type: 'stone', entity: e }; });
    visibleWoodenStorageBoxes.forEach(e => allEntities[index++] = { type: 'wooden_storage_box', entity: e });
    visibleStashes.forEach(e => allEntities[index++] = { type: 'stash', entity: e });
    visibleCampfires.forEach(e => allEntities[index++] = { type: 'campfire', entity: e });
    visibleFurnaces.forEach(e => allEntities[index++] = { type: 'furnace', entity: e });
    visibleLanterns.forEach(e => allEntities[index++] = { type: 'lantern', entity: e });
    visibleGrass.forEach(e => allEntities[index++] = { type: 'grass', entity: e });
    visiblePlantedSeeds.forEach(e => allEntities[index++] = { type: 'planted_seed', entity: e });
    visibleDroppedItems.forEach(e => allEntities[index++] = { type: 'dropped_item', entity: e });
    visibleHarvestableResources.forEach(e => allEntities[index++] = { type: 'harvestable_resource', entity: e });
    visibleRainCollectors.forEach(e => allEntities[index++] = { type: 'rain_collector', entity: e });
    visibleProjectiles.forEach(e => allEntities[index++] = { type: 'projectile', entity: e });
    visibleViperSpittles.forEach(e => allEntities[index++] = { type: 'viper_spittle', entity: e });
    visibleAnimalCorpses.forEach(e => allEntities[index++] = { type: 'animal_corpse', entity: e });
    visiblePlayerCorpses.forEach(e => allEntities[index++] = { type: 'player_corpse', entity: e });
    visibleWildAnimals.forEach(e => allEntities[index++] = { type: 'wild_animal', entity: e });
    visibleBarrels.forEach(e => allEntities[index++] = { type: 'barrel', entity: e });
    visibleSeaStacks.forEach(e => allEntities[index++] = { type: 'sea_stack', entity: e });
    visibleShelters.forEach(e => allEntities[index++] = { type: 'shelter', entity: e });

    // Trim array to actual size in case some entities were filtered out (e.g., stones with 0 health)
    allEntities.length = index;
    
    // PERFORMANCE: Sort the array in-place.
    // The comparator function will call helpers, which is computationally more expensive
    // than the old method, but it avoids massive memory allocation, which is the
    // likely cause of the garbage-collection lag spikes.
    allEntities.sort((a, b) => {
      const yA = getEntityY(a, stableTimestamp);
      const yB = getEntityY(b, stableTimestamp);
      
      // Primary sort by Y position
      const yDiff = yA - yB;
      if (Math.abs(yDiff) > 0.1) {
        return yDiff;
      }
      
      // Secondary sort by priority when Y positions are close
      return getEntityPriority(b) - getEntityPriority(a);
    });
    
    // PERFORMANCE: Update cache with new sorted result
    ySortedCache.entities = allEntities;
    ySortedCache.lastUpdateFrame = frameCounter;
    ySortedCache.lastEntityCounts = currentEntityCounts;
    ySortedCache.isDirty = false;
    
    return allEntities;
  },
    // Dependencies for cached Y-sorting
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
    stableTimestamp, // Only include stableTimestamp for projectile calculations
    hasEntityCountChanged, // Add callback dependency
    frameCounter // Add frame counter for cache invalidation
  ]);

  // END PERFORMANCE TIMING
  const filteringEndTime = performance.now();
  const processingTime = filteringEndTime - filteringStartTime;

  // Log performance data
  logPerformanceData(processingTime, {
    trees: visibleTrees.length,
    stones: visibleStones.length,
    resources: visibleHarvestableResources.length,
    campfires: visibleCampfires.length,
    furnaces: visibleFurnaces.length,
    animals: visibleWildAnimals.length,
    grass: visibleGrass.length,
    total: totalEntityCount
  }, playerPos || { x: -cameraOffsetX + canvasWidth / 2, y: -cameraOffsetY + canvasHeight / 2 }, emergencyMode);

  if (emergencyMode) {
    // Filter out grass and limit trees/resources
    visibleGrass = [];
    visibleHarvestableResources = visibleHarvestableResources.slice(0, PERFORMANCE_MODE.EMERGENCY_MAX_RESOURCES);
    visibleTrees = visibleTrees.slice(0, PERFORMANCE_MODE.EMERGENCY_MAX_TREES);
  }

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