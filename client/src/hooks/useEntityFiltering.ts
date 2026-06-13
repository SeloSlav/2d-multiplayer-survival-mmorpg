/**
 * useEntityFiltering - Viewport culling and Y-sorted entity arrays for rendering.
 *
 * This hook filters all game entities by viewport bounds and produces Y-sorted arrays
 * for correct draw order (entities lower on screen draw on top). Used by GameCanvas and
 * renderingUtils to render only visible entities in proper depth order.
 *
 * Responsibilities:
 * 1. VIEWPORT CULLING: Filters trees, stones, players, structures, animals, etc. by
 *    viewBounds + buffer. Excludes respawning entities (respawnAt !== 0).
 *
 * 2. Y-SORTING: Merges all visible entities into a single Y-sorted array for
 *    renderingUtils. Handles tall structures (campfires, furnaces) with custom
 *    sort offsets for correct overlap.
 *
 * 3. COMPOUND BUILDINGS: Detects and groups compound monuments (e.g., large furnaces)
 *    for unified rendering and interaction.
 *
 * 4. MAPS & ARRAYS: Returns both Map<string, Entity> for lookups and pre-sorted
 *    arrays for efficient render loops. No direct SpacetimeDB subscriptions.
 */

import { useMemo, useCallback, useRef } from 'react';
import { Timestamp } from 'spacetimedb';
import { gameConfig, FOUNDATION_TILE_SIZE, foundationCellToWorldCenter } from '../config/gameConfig';

/**
 * Helper to check if a respawnAt timestamp indicates the entity is NOT respawning.
 * After the schema change, respawnAt is always a Timestamp.
 * UNIX_EPOCH (microsSinceUnixEpoch === 0n) means "not respawning" (alive/available).
 * Any positive value means "respawning" (destroyed/harvested, waiting to respawn).
 */
export const isNotRespawning = (respawnAt: Timestamp | null | undefined): boolean => {
  if (respawnAt === null || respawnAt === undefined) return true;
  return respawnAt.microsSinceUnixEpoch === 0n;
};
import {
  Player as SpacetimeDBPlayer,
  Tree as SpacetimeDBTree,
  Stone as SpacetimeDBStone,
  RuneStone as SpacetimeDBRuneStone,
  Cairn as SpacetimeDBCairn,
  Campfire as SpacetimeDBCampfire,
  Furnace as SpacetimeDBFurnace, // ADDED: Furnace import
  Barbecue as SpacetimeDBBarbecue, // ADDED: Barbecue import
  Lantern as SpacetimeDBLantern,
  Turret as SpacetimeDBTurret, // ADDED: Turret import
  HomesteadHearth as SpacetimeDBHomesteadHearth, // ADDED: Homestead Hearth import
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
  BrothPot as SpacetimeDBBrothPot,
  WildAnimal as SpacetimeDBWildAnimal,
  AnimalCorpse as SpacetimeDBAnimalCorpse,
  Barrel as SpacetimeDBBarrel, // ADDED Barrel type
  RoadLamppost as SpacetimeDBRoadLamppost, // ADDED: Aleutian whale oil lampposts along roads
  FoundationCell as SpacetimeDBFoundationCell, // ADDED: Building foundations
  WallCell as SpacetimeDBWallCell, // ADDED: Building walls
  Door as SpacetimeDBDoor, // ADDED: Building doors
  Fence as SpacetimeDBFence, // ADDED: Building fences
  Fumarole as SpacetimeDBFumarole, // ADDED: Fumaroles (geothermal vents)
  BasaltColumn as SpacetimeDBBasaltColumn, // ADDED: Basalt columns (decorative obstacles)
  AlkStation as SpacetimeDBAlkStation, // ADDED: ALK delivery stations
  // StormPile removed - storms now spawn HarvestableResources and DroppedItems directly
  LivingCoral as SpacetimeDBLivingCoral, // Living coral for underwater harvesting (uses combat system)
  // Grass as SpacetimeDBGrass // Will use InterpolatedGrassData instead
} from '../generated/types';
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
import { COMPOUND_BUILDINGS, getBuildingWorldPosition, getMonumentBuildings } from '../config/compoundBuildings'; // Import compound buildings config
import { hasActiveStoneDestruction, checkStoneDestructionVisibility } from '../utils/renderers/stoneRenderingUtils'; // Import stone destruction tracking
import { hasActiveCoralDestruction, checkCoralDestructionVisibility } from '../utils/renderers/livingCoralRenderingUtils'; // Import coral destruction tracking
import { checkBarrelDestructionVisibility } from '../utils/renderers/barrelRenderingUtils'; // Barrel destruction chunks
import { BOX_TYPE_LARGE, BOX_TYPE_COMPOST, BOX_TYPE_TANNING_RACK, BOX_TYPE_REPAIR_BENCH, BOX_TYPE_COOKING_STATION, BOX_TYPE_SCARECROW, BOX_TYPE_PLAYER_BEEHIVE, BOX_TYPE_WILD_BEEHIVE } from '../utils/renderers/woodenStorageBoxRenderingUtils'; // Import box type constants for y-sorting
import { getProjectileVisualDedupKey } from '../utils/renderers/projectileRenderingUtils';
// Ward radius constants for expanded viewport filtering (to render ward circles even when ward is off-screen)
import { 
  LANTERN_TYPE_LANTERN,
  ANCESTRAL_WARD_RADIUS_PX, 
  SIGNAL_DISRUPTOR_RADIUS_PX, 
  MEMORY_BEACON_RADIUS_PX 
} from '../utils/renderers/lanternRenderingUtils';

export interface ViewportBounds {
  viewMinX: number;
  viewMaxX: number;
  viewMinY: number;
  viewMaxY: number;
}

// PERFORMANCE: Typed AABB check - avoids isEntityInView type-detection chain when dimensions are known
export function isInView(x: number, y: number, width: number, height: number, bounds: ViewportBounds): boolean {
  return (
    x + width / 2 > bounds.viewMinX &&
    x - width / 2 < bounds.viewMaxX &&
    y + height / 2 > bounds.viewMinY &&
    y - height / 2 < bounds.viewMaxY
  );
}

// Import building visibility utilities
import { getBuildingClusters, getPlayerBuildingClusterId, shouldMaskFoundation, detectEntranceWayFoundations, detectNorthWallFoundations, detectSouthWallFoundations, type BuildingCluster } from '../utils/buildingVisibilityUtils';

interface EntityFilteringResult {
  visibleHarvestableResources: SpacetimeDBHarvestableResource[];
  visibleDroppedItems: SpacetimeDBDroppedItem[];
  visibleCampfires: SpacetimeDBCampfire[];
  visibleFurnaces: SpacetimeDBFurnace[]; // ADDED: Furnaces
  visibleBarbecues: SpacetimeDBBarbecue[]; // ADDED: Barbecues
  visibleHomesteadHearths: SpacetimeDBHomesteadHearth[]; // ADDED: Homestead Hearths
  visiblePlayers: SpacetimeDBPlayer[];
  visibleTrees: SpacetimeDBTree[];
  visibleStones: SpacetimeDBStone[];
  visibleRuneStones: SpacetimeDBRuneStone[];
  visibleCairns: SpacetimeDBCairn[];
  visibleCairnsMap: Map<string, SpacetimeDBCairn>;
  visibleWoodenStorageBoxes: SpacetimeDBWoodenStorageBox[];
  visibleSleepingBags: SpacetimeDBSleepingBag[];
  visibleProjectiles: SpacetimeDBProjectile[];
  visibleHarvestableResourcesMap: Map<string, SpacetimeDBHarvestableResource>;
  visibleCampfiresMap: Map<string, SpacetimeDBCampfire>;
  visibleFurnacesMap: Map<string, SpacetimeDBFurnace>; // ADDED: Furnaces map
  visibleBarbecuesMap: Map<string, SpacetimeDBBarbecue>; // ADDED: Barbecues map
  visibleLanternsMap: Map<string, SpacetimeDBLantern>;
  visibleTurrets: SpacetimeDBTurret[]; // ADDED: Turrets
  visibleTurretsMap: Map<string, SpacetimeDBTurret>; // ADDED: Turrets map
  visibleHomesteadHearthsMap: Map<string, SpacetimeDBHomesteadHearth>; // ADDED: Homestead Hearths map
  visibleDroppedItemsMap: Map<string, SpacetimeDBDroppedItem>;
  visibleBoxesMap: Map<string, SpacetimeDBWoodenStorageBox>;
  visibleProjectilesMap: Map<string, SpacetimeDBProjectile>;
  visiblePlayerCorpses: SpacetimeDBPlayerCorpse[];
  visiblePlayerCorpsesMap: Map<string, SpacetimeDBPlayerCorpse>;
  visibleStashes: SpacetimeDBStash[];
  visibleStashesMap: Map<string, SpacetimeDBStash>;
  visibleSleepingBagsMap: Map<string, SpacetimeDBSleepingBag>;
  visibleTreesMap: Map<string, SpacetimeDBTree>;
  visibleStonesMap: Map<string, SpacetimeDBStone>;
  visibleRuneStonesMap: Map<string, SpacetimeDBRuneStone>;
  groundItems: (SpacetimeDBSleepingBag)[];
  ySortedEntities: YSortedEntityType[];
  visibleGrass: InterpolatedGrassData[]; // Use InterpolatedGrassData
  visibleGrassMap: Map<string, InterpolatedGrassData>; // Use InterpolatedGrassData
  visibleShelters: SpacetimeDBShelter[]; // ADDED
  visibleSheltersMap: Map<string, SpacetimeDBShelter>; // ADDED
  visibleLanterns: SpacetimeDBLantern[];
  visiblePlantedSeeds: SpacetimeDBPlantedSeed[];
  visiblePlantedSeedsMap: Map<string, SpacetimeDBPlantedSeed>;
  visibleClouds: SpacetimeDBCloud[];
  visibleRainCollectors: SpacetimeDBRainCollector[];
  visibleRainCollectorsMap: Map<string, SpacetimeDBRainCollector>;
  visibleBrothPots: SpacetimeDBBrothPot[];
  visibleBrothPotsMap: Map<string, SpacetimeDBBrothPot>;
  visibleWildAnimals: SpacetimeDBWildAnimal[]; // ADDED
  visibleWildAnimalsMap: Map<string, SpacetimeDBWildAnimal>; // ADDED
  visibleAnimalCorpses: SpacetimeDBAnimalCorpse[];
  visibleAnimalCorpsesMap: Map<string, SpacetimeDBAnimalCorpse>;
  visibleBarrels: SpacetimeDBBarrel[];
  visibleBarrelsMap: Map<string, SpacetimeDBBarrel>;
  visibleRoadLampposts: SpacetimeDBRoadLamppost[];
  visibleRoadLamppostsMap: Map<string, SpacetimeDBRoadLamppost>;
  visibleFumaroles: SpacetimeDBFumarole[];
  visibleFumarolesMap: Map<string, SpacetimeDBFumarole>;
  visibleBasaltColumns: SpacetimeDBBasaltColumn[];
  visibleBasaltColumnsMap: Map<string, SpacetimeDBBasaltColumn>;
  visibleSeaStacks: any[];
  visibleSeaStacksMap: Map<string, any>;
  visibleAlkStations: SpacetimeDBAlkStation[];
  visibleAlkStationsMap: Map<string, SpacetimeDBAlkStation>;
  visibleFoundationCells: SpacetimeDBFoundationCell[];
  visibleFoundationCellsMap: Map<string, SpacetimeDBFoundationCell>;
  visibleWallCells: SpacetimeDBWallCell[];
  visibleWallCellsMap: Map<string, SpacetimeDBWallCell>;
  visibleDoors: SpacetimeDBDoor[];
  visibleDoorsMap: Map<string, SpacetimeDBDoor>;
  visibleFences: SpacetimeDBFence[];
  visibleFencesMap: Map<string, SpacetimeDBFence>;
  buildingClusters: Map<string, BuildingCluster>;
  playerBuildingClusterId: string | null;
  // StormPile removed - storms now spawn HarvestableResources and DroppedItems directly
  visibleLivingCorals: SpacetimeDBLivingCoral[]; // Living corals (uses combat system)
  visibleLivingCoralsMap: Map<string, SpacetimeDBLivingCoral>; // Living corals map
  swimmingPlayersForBottomHalf: SpacetimeDBPlayer[]; // Single source of truth: players whose bottom half renders before water overlay
}

// Define a unified entity type for sorting
export type YSortedEntityType =
  | { type: 'player'; entity: SpacetimeDBPlayer }
  | { type: 'tree'; entity: SpacetimeDBTree }
  | { type: 'stone'; entity: SpacetimeDBStone }
  | { type: 'rune_stone'; entity: SpacetimeDBRuneStone }
  | { type: 'cairn'; entity: SpacetimeDBCairn }
  | { type: 'wooden_storage_box'; entity: SpacetimeDBWoodenStorageBox }
  | { type: 'player_corpse'; entity: SpacetimeDBPlayerCorpse }
  | { type: 'stash'; entity: SpacetimeDBStash }
  | { type: 'harvestable_resource'; entity: SpacetimeDBHarvestableResource }
  | { type: 'campfire'; entity: SpacetimeDBCampfire }
  | { type: 'furnace'; entity: SpacetimeDBFurnace } // ADDED: Furnace type
  | { type: 'barbecue'; entity: SpacetimeDBBarbecue } // ADDED: Barbecue type
  | { type: 'lantern'; entity: SpacetimeDBLantern }
  | { type: 'turret'; entity: SpacetimeDBTurret } // ADDED: Turret type
  | { type: 'homestead_hearth'; entity: SpacetimeDBHomesteadHearth } // ADDED: Homestead Hearth type
  | { type: 'dropped_item'; entity: SpacetimeDBDroppedItem }
  | { type: 'projectile'; entity: SpacetimeDBProjectile }
  | { type: 'shelter'; entity: SpacetimeDBShelter }
  | { type: 'grass'; entity: InterpolatedGrassData }
  | { type: 'planted_seed'; entity: SpacetimeDBPlantedSeed }
  | { type: 'rain_collector'; entity: SpacetimeDBRainCollector }
  | { type: 'broth_pot'; entity: SpacetimeDBBrothPot }
  | { type: 'wild_animal'; entity: SpacetimeDBWildAnimal }
  | { type: 'animal_corpse'; entity: SpacetimeDBAnimalCorpse }
  | { type: 'barrel'; entity: SpacetimeDBBarrel }
  | { type: 'road_lamppost'; entity: SpacetimeDBRoadLamppost } // ADDED: Aleutian whale oil lampposts along roads
  | { type: 'sea_stack'; entity: any } // Server-provided sea stack entities
  | { type: 'sleeping_bag'; entity: SpacetimeDBSleepingBag } // ADDED: Sleeping bags
  | { type: 'foundation_cell'; entity: SpacetimeDBFoundationCell } // ADDED: Building foundations
  | { type: 'wall_cell'; entity: SpacetimeDBWallCell } // ADDED: Building walls
  | { type: 'door'; entity: SpacetimeDBDoor } // ADDED: Building doors
  | { type: 'fence'; entity: SpacetimeDBFence } // ADDED: Building fences
  | { type: 'fog_overlay'; entity: { clusterId: string; bounds: { minX: number; minY: number; maxX: number; maxY: number }; entranceWayFoundations?: string[]; clusterFoundationCoords?: string[]; northWallFoundations?: string[]; southWallFoundations?: string[] } } // ADDED: Fog of war overlay (renders above placeables, below walls)
  | { type: 'fumarole'; entity: SpacetimeDBFumarole } // ADDED: Fumaroles (geothermal vents in quarries)
  | { type: 'basalt_column'; entity: SpacetimeDBBasaltColumn } // ADDED: Basalt columns (decorative obstacles in quarries)
  | { type: 'alk_station'; entity: SpacetimeDBAlkStation } // ADDED: ALK delivery stations
  | { type: 'compound_building'; entity: CompoundBuildingEntity } // ADDED: Static ALK compound buildings
  | { type: 'monument_doodad'; entity: CompoundBuildingEntity } // ADDED: Monument parts - player in front when in bottom 25% of sprite
  // StormPile removed - storms now spawn HarvestableResources and DroppedItems directly
  | { type: 'living_coral'; entity: SpacetimeDBLivingCoral } // Living coral reefs (uses combat system)
  | { type: 'swimmingPlayerTopHalf'; entity: SpacetimeDBPlayer; yPosition: number; playerId: string }; // Phase 3c: swimming player top half (pre-merged in useEntityFiltering)

// Type for compound buildings in Y-sorted system
export interface CompoundBuildingEntity {
  id: string;
  worldX: number;
  worldY: number;
  width: number;
  height: number;
  imagePath: string;
  anchorYOffset: number;
  isCenter?: boolean; // For monuments: marks the center piece for building restriction overlay
  rotationRad?: number; // Rotation in radians for monument parts with custom orientation
  monumentType?: string; // For monument doodads: FishingVillage, HuntingVillage, etc.
  partType?: string; // For monument doodads: campfire, hut, lodge, etc.
}

const SIMPLE_YSORT_TYPES = new Set<YSortedEntityType['type']>([
  'dropped_item', 'harvestable_resource', 'projectile', 'animal_corpse', 'player_corpse',
  'barrel', 'road_lamppost', 'sleeping_bag', 'sea_stack', 'living_coral', 'barbecue',
  'turret', 'furnace', 'lantern', 'homestead_hearth', 'planted_seed', 'rain_collector',
  'wooden_storage_box', 'stash', 'cairn', 'rune_stone', 'basalt_column', 'fence'
]);

const SMALL_GROUND_TYPES = new Set<YSortedEntityType['type']>([
  'barrel', 'road_lamppost', 'harvestable_resource', 'grass'
]);

const TALL_STRUCTURE_TYPES = new Set<YSortedEntityType['type']>([
  'tree', 'stone', 'monument_doodad', 'compound_building'
]);

const FOG_MASKED_PLACEABLE_TYPES = new Set<YSortedEntityType['type']>([
  'wooden_storage_box', 'stash', 'campfire', 'furnace', 'lantern',
  'homestead_hearth', 'barrel', 'rain_collector', 'sleeping_bag'
]);

const NORTH_WALL_PLACEABLE_TYPES = new Set<YSortedEntityType['type']>([
  'campfire', 'furnace', 'lantern', 'homestead_hearth', 'wooden_storage_box',
  'stash', 'barrel', 'rain_collector', 'sleeping_bag', 'broth_pot'
]);

const SHELTER_PLACEABLE_TYPES = new Set<YSortedEntityType['type']>([
  'broth_pot', 'campfire', 'furnace', 'barbecue', 'lantern', 'wooden_storage_box',
  'stash', 'barrel', 'rain_collector', 'sleeping_bag'
]);

const FLYING_BIRD_GROUND_TYPES = new Set<YSortedEntityType['type']>([
  'tree', 'stone', 'rune_stone', 'basalt_column', 'fumarole',
  'wooden_storage_box', 'stash', 'campfire', 'furnace', 'lantern', 'homestead_hearth',
  'planted_seed', 'dropped_item', 'harvestable_resource', 'barrel', 'rain_collector',
  'broth_pot', 'sleeping_bag', 'animal_corpse', 'player_corpse', 'foundation_cell', 'alk_station'
]);

const TREE_STONE_Y_OVERLAP_PX = 120;
const MONUMENT_FOOTPRINT_PADDING = 24;

const getMonumentDoodadFraction = (doodad: CompoundBuildingEntity): number => {
  if (doodad.imagePath === 'fv_campfire.png' || doodad.imagePath === 'av_campfire.png') return 0.75;
  const pt = doodad.partType ?? '';
  if (pt === 'hv_drying_rack' || pt === 'fv_drying_rack' || pt === 'av_drying_rack') return 0.25;
  return 0.25;
};

const getSmallGroundEntityPosition = (entity: any, type: string): { x: number; y: number } => {
  if (type === 'grass' && ('serverPosX' in (entity ?? {}))) {
    return { x: (entity as any).serverPosX ?? 0, y: (entity as any).serverPosY ?? 0 };
  }
  return { x: entity?.posX ?? entity?.positionX ?? 0, y: entity?.posY ?? entity?.positionY ?? 0 };
};

const isSmallWithinMonumentFootprint = (
  small: { x: number; y: number },
  tallEntity: any,
  pad: number
): boolean => {
  const w = tallEntity?.width ?? 0;
  const h = tallEntity?.height ?? 0;
  const anchor = tallEntity?.anchorYOffset ?? 0;
  const worldX = tallEntity?.worldX ?? 0;
  const worldY = tallEntity?.worldY ?? 0;
  const left = worldX - w / 2 - pad;
  const right = worldX + w / 2 + pad;
  const top = worldY - h + anchor - pad;
  const bottom = worldY + anchor + pad;
  return small.x >= left && small.x <= right && small.y >= top && small.y <= bottom;
};

const isSmallNearTreeOrStone = (smallY: number, tallY: number): boolean =>
  Math.abs(smallY - tallY) < TREE_STONE_Y_OVERLAP_PX;

const isPlaceableInFogBounds = (
  placeable: any,
  fogBounds: { minX: number; minY: number; maxX: number; maxY: number }
): boolean => {
  if (!placeable || !placeable.posX || !placeable.posY) return false;
  return placeable.posX >= fogBounds.minX &&
         placeable.posX < fogBounds.maxX &&
         placeable.posY >= fogBounds.minY &&
         placeable.posY < fogBounds.maxY;
};

// ===== HELPER FUNCTIONS FOR Y-SORTING =====
const PLAYER_SORT_FEET_OFFSET_PX = 48;
const getEntityY = (item: YSortedEntityType, timestamp: number): number => {
  const { entity, type } = item;
  // Keep this in sync with grassRenderingUtils.ts render anchor math.
  const GRASS_RENDER_Y_SORT_OFFSET = 5;
  switch (type) {
    case 'player':
      // Player Y position: use positionY (foot position) + 48 to get head/center
      // This ensures players always render above foundations and walls on the same tile
      // Add a larger offset to ensure players on foundations render above them, even with rounding issues
      // Increased from 0.5 to 2.0 to handle edge cases where player positionY might be slightly below tile edge
      const player = entity as SpacetimeDBPlayer;
      // CRITICAL: Players use positionY, not posY. This must match their actual world Y coordinate.
      const playerY = player.positionY;
      // Only check for truly invalid values - 0 is a valid Y coordinate
      if (playerY === undefined || playerY === null || (typeof playerY === 'number' && isNaN(playerY))) {
        console.error('[getEntityY] Player has invalid positionY:', {
          identity: player.identity?.toHexString(),
          positionX: player.positionX,
          positionY: player.positionY,
          hasPosY: 'posY' in player,
          posY: (player as any).posY,
          playerKeys: Object.keys(player)
        });
        // Use a reasonable fallback based on positionX if available, otherwise use 0
        // This ensures players still sort correctly relative to each other
        return (player.positionX !== undefined ? player.positionX : 0) + 1000000; // Large offset to put invalid players at bottom
      }
      // Return the actual Y position - this should be the world Y coordinate
      return playerY + PLAYER_SORT_FEET_OFFSET_PX + 2.0;
    case 'tree':
    case 'stone':
    case 'stash':
    case 'campfire':
    case 'furnace':
    case 'barbecue': // ADDED: Barbecue (same as campfire)
    case 'lantern':
    case 'homestead_hearth': // ADDED: Homestead Hearth (same as campfire)
    case 'planted_seed':
    case 'dropped_item':
      // Tall structures / placeables: Subtract offset to account for visual height extending
      // above foot position, and to ensure they render before monuments (underneath buildings)
      return entity.posY - 100;
    case 'harvestable_resource':
      // Harvestable resources (mushrooms, hemp, pumpkins, corn, etc.) are small ground-level
      // items that should Y-sort naturally with the player. No large negative offset needed.
      return entity.posY;
    case 'wooden_storage_box': {
      // Tall box types (repair bench, cooking station, scarecrow, compost, large)
      // need proper y-sorting using actual posY so player walks behind them correctly.
      // Small/flat boxes keep the -100 offset to render under buildings.
      const box = entity as SpacetimeDBWoodenStorageBox;
      if (box.boxType === BOX_TYPE_LARGE ||
          box.boxType === BOX_TYPE_COMPOST ||
          box.boxType === BOX_TYPE_TANNING_RACK ||
          box.boxType === BOX_TYPE_REPAIR_BENCH ||
          box.boxType === BOX_TYPE_COOKING_STATION ||
          box.boxType === BOX_TYPE_SCARECROW ||
          box.boxType === BOX_TYPE_PLAYER_BEEHIVE ||
          box.boxType === BOX_TYPE_WILD_BEEHIVE) {
        return entity.posY;
      }
      return entity.posY - 100;
    }
    case 'sleeping_bag':
      // Sleeping bags are flat ground placeables like small boxes and stashes.
      // Keep them under players via the explicit comparator rules below, but let them
      // participate in normal ground-placeable depth sorting so foundations don't cover them.
      return entity.posY - 100;
    case 'rain_collector':
    case 'animal_corpse':
    case 'player_corpse':
    case 'wild_animal':
    case 'road_lamppost': // ADDED: Aleutian whale oil lampposts (same as barrels - tall road structures)
    case 'basalt_column': // ADDED: Basalt columns sort by Y position (tall obstacles)
    // storm_pile removed - storms now spawn HarvestableResources and DroppedItems directly
    case 'living_coral': // Living coral reefs sort by Y position (uses combat system)
      // CRITICAL FIX: Use actual Y position for proper depth sorting relative to players
      return entity.posY;
    case 'barrel': {
      // Barrels: Y-sort by visual base (where sprite meets ground) - matches barrelRenderingUtils draw position
      const variantIndex = Number((entity as { variant?: number }).variant ?? 0);
      const baseYOffset = variantIndex === 4 ? 24 : variantIndex === 6 ? 28 : 12; // Buoy 192px, large barrel 172px
      // Buoy (6): move pink Y-sort line up - use midpoint of buoy (96px above base) so it sorts correctly with swimming players
      const buoySortUp = variantIndex === 6 ? 96 : 0;
      return entity.posY - baseYOffset - buoySortUp;
    }
    case 'fumarole': {
      // HARD SAFETY RULE: players should never appear under fumaroles.
      // Push fumaroles far back in Y-sort so they consistently render beneath players.
      const FUMAROLE_SORT_BACK_OFFSET_PX = 1000;
      return entity.posY - FUMAROLE_SORT_BACK_OFFSET_PX;
    }
    case 'turret':
      // Turret: 256x256 sprite centered on posY, visual base (wooden platform) is ~80px below center
      // Y-sort by the visual base so players in front render correctly
      return entity.posY + 80;
    case 'broth_pot':
      // CRITICAL: Broth pot sits ON TOP of campfires/fumaroles (same posY position).
      // Adding a significant offset (10) ensures broth_pot ALWAYS sorts AFTER its heat source
      // through natural Y-sorting. The offset must be large enough to survive the sort
      // algorithm's partitioning, but small enough not to affect sorting relative to
      // entities that are actually at different Y positions (10px is within visual overlap).
      return entity.posY + 10;
    case 'cairn': {
      // Cairns: posY is the visual base (where stones meet ground), but the sprite
      // has extra space at the bottom. The visual base is offset upward from sprite bottom.
      // Use posY directly for Y-sorting (it already represents the visual base).
      const cairn = entity as SpacetimeDBCairn;
      return cairn.posY; // posY is already the visual base position
    }
    case 'alk_station': {
      // ALK stations: worldPosY is the sprite's BOTTOM, but the visual "foot level" 
      // (where players walk) is much HIGHER due to:
      // 1. ~24% transparent space at top of 1024px source image
      // 2. Building's architectural base/stairs extending above ground level
      // The collision center is offset 170px up from worldPosY, so the visual foot
      // is roughly there. Use this for Y-sorting so players in front render correctly.
      const alkStation = entity as SpacetimeDBAlkStation;
      const ALK_STATION_VISUAL_FOOT_OFFSET = 170; // Match collision Y offset
      return alkStation.worldPosY - ALK_STATION_VISUAL_FOOT_OFFSET;
    }
    case 'compound_building': {
      // Use sprite BOTTOM for Y-sort so building renders on top of entities at its base.
      // Player-vs-building uses explicit threshold (bottom 12.5%) in comparator.
      const building = entity as CompoundBuildingEntity;
      return building.worldY + (building.anchorYOffset || 0);
    }
    case 'monument_doodad': {
      // Use sprite BOTTOM (worldY + anchor) for Y-sort so monument consistently renders on top of
      // harvestables/grass at its base. Player-vs-monument uses explicit threshold (bottom 25%).
      const doodad = entity as CompoundBuildingEntity;
      return doodad.worldY + (doodad.anchorYOffset || 0);
    }
    case 'foundation_cell': {
      // Foundation cells use cell coordinates - convert to world pixel Y
      // Use top edge of tile (cellY * 48) to ensure foundations render below players
      // Players standing on foundations will have positionY at or near the top edge
      const foundation = entity as SpacetimeDBFoundationCell;
      return foundation.cellY * 48; // TILE_SIZE = 48, use top edge for Y-sorting
    }
    case 'fog_overlay': {
      // Fog overlays must ALWAYS render above placeables but BELOW walls for realism
      // Use the ACTUAL center Y of the building cluster for natural Y-sorting
      // The explicit sorting checks (lines 1484-1489) ensure walls ALWAYS render above fog
      // Using the actual building Y position ensures fog sorts correctly relative to placeables
      const fogEntity = entity as { clusterId: string; bounds: { minX: number; minY: number; maxX: number; maxY: number }; entranceWayFoundations?: string[]; clusterFoundationCoords?: string[]; northWallFoundations?: string[]; southWallFoundations?: string[] };
      // Use center Y of the building for natural sorting
      const centerY = (fogEntity.bounds.minY + fogEntity.bounds.maxY) / 2;
      return centerY;
    }
    case 'door': {
      const door = entity as SpacetimeDBDoor;
      const FOUNDATION_TILE_SIZE = 96;
      const foundationTopY = door.cellY * FOUNDATION_TILE_SIZE;
      if (door.edge === 0) {
        // North door: use foundation top - WORKING PERFECTLY
        return foundationTopY;
      } else {
        // South door: use foundation bottom + player sprite height (matches comparator)
        return foundationTopY + FOUNDATION_TILE_SIZE + 48;
      }
    }
    case 'fence': {
      // Fences use world position directly (posX, posY) on 48px tile grid
      const fence = entity as SpacetimeDBFence;
      return fence.posY; // Use tile center Y for sorting
    }
    case 'wall_cell': {
      const wall = entity as SpacetimeDBWallCell;
      const FOUNDATION_TILE_SIZE = 96;
      const baseY = wall.cellY * FOUNDATION_TILE_SIZE;
      const isTriangle = wall.foundationShape >= 2 && wall.foundationShape <= 5;
      
      if (isTriangle) {
        // Triangle walls: use foundation center
        return baseY + FOUNDATION_TILE_SIZE / 2;
      } else if (wall.edge === 0) {
        // North wall: use foundation top - WORKING PERFECTLY
        return baseY;
      } else if (wall.edge === 2) {
        // South wall: use foundation BOTTOM + player sprite height
        // This matches the comparator which checks playerHeadY >= foundationBottomY
        // playerHeadY = playerFeetY - 48, so threshold is foundationBottomY + 48
        return baseY + FOUNDATION_TILE_SIZE + 48;
      } else {
        // East/west walls: use foundation top
        return baseY;
      }
    }
    case 'grass':
      return entity.serverPosY;
    case 'projectile': {
      const startTime = Number(entity.startTime.microsSinceUnixEpoch / 1000n);
      const elapsedSeconds = Math.max(0, (timestamp - startTime) / 1000.0);
      return entity.startPosY + entity.velocityY * elapsedSeconds;
    }
    case 'sea_stack':
      return entity.posY;
    case 'shelter':
      return entity.posY - 100;
    case 'rune_stone':
      return entity.posY;
    case 'swimmingPlayerTopHalf':
      return (item as { yPosition: number }).yPosition;
    default:
      return 0;
  }
};

const getEntityPriority = (item: YSortedEntityType): number => {
  switch (item.type) {
    case 'sea_stack': return 1;
    case 'tree': return 2;
    case 'stone': return 3;
    case 'rune_stone': return 3.5; // Render between stones and animals
    case 'cairn': return 3.5; // Render at same priority as rune stones
    case 'wild_animal': {
      // Flying birds should render above everything (trees, stones, players, etc.)
      const animal = item.entity as SpacetimeDBWildAnimal;
      const isBird = animal.species.tag === 'Tern' || animal.species.tag === 'Crow';
      if (isBird && animal.isFlying === true) {
        return 25; // Higher than walls (22-23) and players (21) - renders on top
      }
      return 4; // Normal animals render at priority 4
    }
    case 'wooden_storage_box': return 5;
    case 'stash': return 6;
    case 'campfire': return 7;
    case 'furnace': return 7.5;
    case 'barbecue': return 7.3; // ADDED: Barbecue (between furnace and homestead hearth)
    case 'lantern': return 8;
    case 'homestead_hearth': return 7.2; // ADDED: Homestead Hearth (between furnace and lantern)
    case 'grass': return 9;
    case 'planted_seed': return 10;
    case 'dropped_item': return 11;
    case 'harvestable_resource': return 12;
    case 'sleeping_bag': return 13; // Render after dropped items, before barrels
    case 'barrel': return 15;
    case 'road_lamppost': return 15; // Same layer as barrels (tall road structures)
    case 'fumarole': return 14; // ADDED: Fumaroles render slightly before barrels (ground vents)
    case 'basalt_column': return 16; // ADDED: Basalt columns render after barrels (tall obstacles)
    // storm_pile removed - storms now spawn HarvestableResources and DroppedItems directly
    case 'living_coral': return 14.5; // Living corals render near fumaroles (underwater, uses combat)
    case 'alk_station': return 2; // ALK stations Y-sort like trees (tall structures with base at worldPosY)
    case 'rain_collector': return 18;
    case 'broth_pot': return 18; // Same as rain collector (similar placeable container)
    case 'foundation_cell': return 0.5; // ADDED: Foundations render early (ground level)
    // Render projectiles above player sprites to avoid self-body occlusion
    // when firing (most noticeable on right-facing shots).
    case 'projectile': return 21.25;
    case 'animal_corpse': return 20;
    case 'player_corpse': return 20;
    case 'player': return 21; // Players render before fog overlays (below ceiling tiles)
    case 'swimmingPlayerTopHalf': return 21; // Same as player (swimming top half)
    case 'fog_overlay': return 21.5; // ADDED: Fog overlays render above players (21) but below walls (22+)
    case 'wall_cell': {
      const wall = item.entity as SpacetimeDBWallCell;
      if (wall.edge === 0 || wall.edge === 2) {
        // North/south walls render above players and fog overlays
        return 22; // Render after players (priority 21) and fog (21.5)
      } else {
        // East/west walls render ABOVE north walls (closer to viewer in 3/4 perspective)
        return 23; // Higher priority than north walls (22) to render on top
      }
    }
    case 'door': return 22; // Doors render at same level as walls
    case 'compound_building': return 13; // Static ALK compound buildings
    case 'monument_doodad': return 13; // Monument doodads (shipwreck, fishing village, etc.)
    case 'shelter': return 25;
    default: return 0;
  }
};

// Helper function to check if a player is on the same tile as a foundation/wall
const isPlayerOnSameTileAsBuilding = (
  player: SpacetimeDBPlayer,
  building: SpacetimeDBFoundationCell | SpacetimeDBWallCell
): boolean => {
  const TILE_SIZE = 48;
  // Convert player position to tile coordinates (using floor to match server-side logic)
  const playerTileX = Math.floor(player.positionX / TILE_SIZE);
  const playerTileY = Math.floor(player.positionY / TILE_SIZE);
  
  // Foundation cells use 96px grid (2x world tiles)
  // A foundation cell at (cellX, cellY) covers world tiles:
  // X: cellX * 2 to cellX * 2 + 1
  // Y: cellY * 2 to cellY * 2 + 1
  const foundationCellWorldTileMinX = building.cellX * 2;
  const foundationCellWorldTileMaxX = building.cellX * 2 + 1;
  const foundationCellWorldTileMinY = building.cellY * 2;
  const foundationCellWorldTileMaxY = building.cellY * 2 + 1;
  
  // Check if player is within the foundation cell's world tile range
  const isOnSameTile = playerTileX >= foundationCellWorldTileMinX && 
                       playerTileX <= foundationCellWorldTileMaxX &&
                       playerTileY >= foundationCellWorldTileMinY && 
                       playerTileY <= foundationCellWorldTileMaxY;
  
  return isOnSameTile;
};

// Check if player is on the same tile OR adjacent to a wall (for Y-sorting purposes)
const isPlayerNearWall = (
  player: SpacetimeDBPlayer,
  wall: SpacetimeDBWallCell
): boolean => {
  const TILE_SIZE = 48;
  const playerTileX = Math.floor(player.positionX / TILE_SIZE);
  const playerTileY = Math.floor(player.positionY / TILE_SIZE);
  
  const foundationCellWorldTileMinX = wall.cellX * 2;
  const foundationCellWorldTileMaxX = wall.cellX * 2 + 1;
  const foundationCellWorldTileMinY = wall.cellY * 2;
  const foundationCellWorldTileMaxY = wall.cellY * 2 + 1;
  
  // Check if player is within X range of the wall (same column +/- 1 tile for margin)
  const isInXRange = playerTileX >= foundationCellWorldTileMinX - 1 && 
                     playerTileX <= foundationCellWorldTileMaxX + 1;
  
  if (!isInXRange) return false;
  
  // Check if player is within Y range: from 2 tiles north to 3 tiles south of foundation
  // This covers all approach directions
  const northBound = foundationCellWorldTileMinY - 2;
  const southBound = foundationCellWorldTileMaxY + 3; // Extended south range for approaching from below
  
  const isInYRange = playerTileY >= northBound && playerTileY <= southBound;
  
  return isInYRange;
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

// Frame counter for throttling
let frameCounter = 0;

// Cache for pre-filtered entities to avoid recalculation
const entityCache = new Map<string, {
  entities: any[];
  lastUpdateFrame: number;
  lastPlayerX: number;
  lastPlayerY: number;
  sourceRef: unknown;
  filterToken?: unknown;
}>();

// ===== PERFORMANCE LOGGING SYSTEM =====
// REMOVED: Performance logging system to reduce overhead

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
function getPlayerPosition(
  players: Map<string, SpacetimeDBPlayer>,
  localPlayerId?: string
): { x: number; y: number } | null {
  if (!players || players.size === 0) return null;

  // Prefer the local player if we know their ID
  if (localPlayerId) {
    const localPlayer = players.get(localPlayerId);
    if (localPlayer) {
      return { x: localPlayer.positionX, y: localPlayer.positionY };
    }
  }

  // Fallback: use the first available player (e.g., in spectator mode)
  for (const firstPlayer of players.values()) {
    return { x: firstPlayer.positionX, y: firstPlayer.positionY };
  }
  return null;
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

// PERFORMANCE: Direct iteration - avoids Array.from() intermediate allocation
function filterMapToArray<T>(map: Map<string, T> | undefined, predicate: (e: T) => boolean): T[] {
  if (!map) return [];
  const result: T[] = [];
  for (const e of map.values()) {
    if (predicate(e)) result.push(e);
  }
  return result;
}

// Build ID maps without intermediate `.map()` allocations.
function arrayToIdMap<T, K extends string | number | bigint>(
  entities: T[],
  getId: (entity: T) => K
): Map<string, T> {
  const map = new Map<string, T>();
  for (const entity of entities) {
    map.set(String(getId(entity)), entity);
  }
  return map;
}

// Cached entity filtering with frame-based throttling
function getCachedFilteredEntities<T extends { posX: number; posY: number }>(
  entities: Map<string, T> | undefined,
  cacheKey: string,
  updateInterval: number,
  maxDistanceSq: number,
  maxCount: number,
  playerPos: { x: number; y: number } | null,
  additionalFilter?: (entity: T) => boolean,
  filterToken?: unknown
): T[] {
  if (!entities || !playerPos) return [];
  
  const cache = entityCache.get(cacheKey);
  
  // Check if we can use cached results
  if (cache && 
      cache.sourceRef === entities &&
      cache.filterToken === filterToken &&
      (frameCounter - cache.lastUpdateFrame) < updateInterval &&
      Math.abs(cache.lastPlayerX - playerPos.x) < 100 &&
      Math.abs(cache.lastPlayerY - playerPos.y) < 100) {
    return cache.entities;
  }
  
  // Need to update cache (direct iteration avoids temporary Array.from allocation)
  const entityArray: T[] = [];
  for (const entity of entities.values()) {
    if (!additionalFilter || additionalFilter(entity)) {
      entityArray.push(entity);
    }
  }
  
  // Apply distance-based filtering
  const filteredEntities = filterEntitiesByDistance(
    entityArray,
    playerPos,
    maxDistanceSq,
    maxCount
  );
  
  // Update cache
  entityCache.set(cacheKey, {
    entities: filteredEntities,
    lastUpdateFrame: frameCounter,
    lastPlayerX: playerPos.x,
    lastPlayerY: playerPos.y,
    sourceRef: entities,
    filterToken
  });
  
  return filteredEntities;
}

export function useEntityFiltering(
  players: Map<string, SpacetimeDBPlayer>,
  trees: Map<string, SpacetimeDBTree>,
  stones: Map<string, SpacetimeDBStone>,
  runeStones: Map<string, SpacetimeDBRuneStone>,
  cairns: Map<string, SpacetimeDBCairn>,
  campfires: Map<string, SpacetimeDBCampfire>,
  furnaces: Map<string, SpacetimeDBFurnace>, // ADDED: Furnaces parameter
  barbecues: Map<string, SpacetimeDBBarbecue>, // ADDED: Barbecues parameter
  lanterns: Map<string, SpacetimeDBLantern>,
  turrets: Map<string, SpacetimeDBTurret>, // ADDED: Turrets parameter
  homesteadHearths: Map<string, SpacetimeDBHomesteadHearth>, // ADDED: Homestead Hearths parameter
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
  brothPots: Map<string, SpacetimeDBBrothPot>,
  wildAnimals: Map<string, SpacetimeDBWildAnimal>, // ADDED wildAnimals argument
  animalCorpses: Map<string, SpacetimeDBAnimalCorpse>, // ADDED animalCorpses argument
  barrels: Map<string, SpacetimeDBBarrel>, // ADDED barrels argument
  roadLampposts: Map<string, SpacetimeDBRoadLamppost>, // ADDED: Aleutian whale oil lampposts along roads (caller passes ?? new Map())
  fumaroles: Map<string, SpacetimeDBFumarole>, // ADDED fumaroles argument
  basaltColumns: Map<string, SpacetimeDBBasaltColumn>, // ADDED basalt columns argument
  seaStacks: Map<string, any>, // ADDED sea stacks argument
  foundationCells: Map<string, SpacetimeDBFoundationCell>, // ADDED: Building foundations
  wallCells: Map<string, SpacetimeDBWallCell>, // ADDED: Building walls
  doors: Map<string, SpacetimeDBDoor>, // ADDED: Building doors
  fences: Map<string, SpacetimeDBFence>, // ADDED: Building fences
  localPlayerId: string | undefined, // ADDED: Local player ID for building visibility
  isLocalPlayerSnorkeling?: boolean, // Phase 3c: Local player snorkeling (swimming players split-render when false)
  localPlayerPredictedPosition?: { x: number; y: number } | null, // Phase 3c fix: Use for swimming top half Y-sort (matches render position)
  isTreeFalling?: (treeId: string) => boolean, // NEW: Check if tree is falling
  worldChunkData?: Map<string, any>, // ADDED: World chunk data for tile type lookups
  alkStations?: Map<string, SpacetimeDBAlkStation>, // ADDED: ALK delivery stations
  monumentParts?: Map<string, any>, // ADDED: Unified monument parts (shipwreck, fishing village, whale bone graveyard)
  // StormPile removed - storms now spawn HarvestableResources and DroppedItems directly
  livingCorals?: Map<string, SpacetimeDBLivingCoral>, // Living corals (uses combat system)
  seaTransitionTileLookup?: Map<string, boolean>, // Shore transition tiles (Beach/Sea, Beach/HotSpringWater, Asphalt/Sea): player renders full sprite, no swimming split
  waterTileLookup?: Map<string, boolean> // Fast local tile water detection for immediate land/sea sprite transitions
): EntityFilteringResult {
  // Increment frame counter for throttling
  frameCounter++;
  
  // Get player position for distance calculations
  const playerPos = getPlayerPosition(players, localPlayerId);  
  
  // Emergency mode removed

  // Get frame time for stable calculations across the function
  const currentTime = Date.now();

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
    } else if ((entity as any).runeType !== undefined) {
      // Handle rune stones - similar to stones but slightly larger
      x = (entity as any).posX;
      y = (entity as any).posY;
      width = 150; // TARGET_RUNE_STONE_WIDTH_PX
      height = 150;
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
    } else if ((entity as any).id !== undefined && (entity as any).posX !== undefined && (entity as any).posY !== undefined && (entity as any).slotInstanceId0 !== undefined) {
      // Handle homestead hearths - check for slotInstanceId0 field (unique to hearths)
      x = (entity as any).posX;
      y = (entity as any).posY;
      width = 96; // HEARTH_WIDTH
      height = 96; // HEARTH_HEIGHT
    } else if (isHarvestableResource(entity)) {
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
      const elapsedSeconds = Math.max(0, (timestamp - startTime) / 1000.0);
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
    } else if ((entity as any).loreId !== undefined) {
      // Handle cairns - they have a unique loreId property
      x = (entity as any).posX;
      y = (entity as any).posY;
      width = 256; // TARGET_CAIRN_WIDTH_PX
      height = 256; // Same as width for cairns
    } else if ((entity as any).turretType !== undefined) {
      // Handle turrets - monument turrets are 2x size (512x512)
      x = (entity as any).posX;
      y = (entity as any).posY;
      if ((entity as any).isMonument) {
        width = 512; // MONUMENT_TURRET_WIDTH
        height = 512; // MONUMENT_TURRET_HEIGHT
      } else {
        width = 256; // TURRET_WIDTH
        height = 256; // TURRET_HEIGHT
      }
    } else if ((entity as any).nearBarrelCluster !== undefined && (entity as any).chunkIndex !== undefined) {
      // Handle road lampposts - Aleutian whale oil lampposts along dirt roads
      x = (entity as any).posX;
      y = (entity as any).posY;
      width = 128; // ROAD_LAMP_WIDTH
      height = 192; // ROAD_LAMP_HEIGHT (tall structure)
    } else if ((entity as any).id !== undefined && (entity as any).posX !== undefined && (entity as any).posY !== undefined && (entity as any).chunkIndex !== undefined) {
      // Handle fumaroles and basalt columns - they have id, posX, posY, and chunkIndex
      x = (entity as any).posX;
      y = (entity as any).posY;
      // Check if it's a basalt column (has columnType field) or fumarole
      if ((entity as any).columnType !== undefined) {
        // Basalt column - tall obstacle (2.5x bigger for cover)
        width = 200; // BASALT_COLUMN_WIDTH
        height = 300; // BASALT_COLUMN_HEIGHT
      } else {
        // Fumarole - ground vent
        width = 96; // FUMAROLE_WIDTH
        height = 96; // FUMAROLE_HEIGHT
      }
    } else {
      return false; // Unknown entity type
    }

    if (x === undefined || y === undefined) return false;
    return isInView(x, y, width, height, bounds);
  }, []);

  // PERFORMANCE: Stabilize viewBounds - skip entity filtering on small camera moves.
  // 32px = ~half tile; reduces lag when walking through dense entity areas.
  const VIEW_BOUNDS_THRESHOLD = 32;
  const viewBoundsRef = useRef<ViewportBounds | null>(null);
  const viewBounds = useMemo(() => {
    const fresh = getViewportBounds();
    const prev = viewBoundsRef.current;
    if (prev &&
        Math.abs(fresh.viewMinX - prev.viewMinX) < VIEW_BOUNDS_THRESHOLD &&
        Math.abs(fresh.viewMinY - prev.viewMinY) < VIEW_BOUNDS_THRESHOLD) {
      return prev;
    }
    viewBoundsRef.current = fresh;
    return fresh;
  }, [getViewportBounds]);

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
      (tree) => {
        // Include tree if it has health OR if it's currently falling
        // Destroyed trees (health === 0) are only shown during their falling animation
        const isFalling = isTreeFalling ? isTreeFalling(tree.id.toString()) : false;
        // respawnAt > 0 (not UNIX_EPOCH) means tree is destroyed and respawning
        const isDestroyed = !isNotRespawning(tree.respawnAt);
        
        // Show tree if: it has health, OR (it's falling AND destroyed)
        // Explicitly exclude destroyed trees that are not falling (similar to resources)
        if (isDestroyed && !isFalling) {
          return false;
        }
        
        return (tree.health > 0 || isFalling) && isEntityInView(tree, viewBounds, stableTimestamp);
      },
      isTreeFalling
    );
  }, [trees, playerPos, viewBounds, stableTimestamp, frameCounter, isTreeFalling]);

  let cachedVisibleStones = useMemo(() => {
    if (!playerPos) return [];

    return getCachedFilteredEntities(
      stones,
      'stones',
      PERFORMANCE_MODE.STONE_UPDATE_INTERVAL,
      PERFORMANCE_MODE.STONE_CULL_DISTANCE_SQ,
      PERFORMANCE_MODE.MAX_STONES_PER_FRAME,
      playerPos,
      // Include stones with health > 0 OR stones with active/newly-triggered destruction effect
      // checkStoneDestructionVisibility detects destruction transitions and triggers effects
      (stone) => (stone.health > 0 || checkStoneDestructionVisibility(stone)) && isEntityInView(stone, viewBounds, stableTimestamp)
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
      (resource) => isNotRespawning(resource.respawnAt) && 
                    isEntityInView(resource, viewBounds, stableTimestamp)
    );
  }, [harvestableResources, playerPos, viewBounds, stableTimestamp, frameCounter]);

  // Use cached results instead of original filtering
  let visibleTrees = cachedVisibleTrees;
  const visibleStones = cachedVisibleStones;
  const visibleRuneStones = useMemo(() =>
    filterMapToArray(runeStones, e => isInView(e.posX, e.posY, 150, 150, viewBounds)),
    [runeStones, viewBounds]
  );
  const visibleCairns = useMemo(() =>
    filterMapToArray(cairns, e => isInView(e.posX, e.posY, 256, 256, viewBounds)),
    [cairns, viewBounds]
  );
  let visibleHarvestableResources = cachedVisibleResources;

  // Keep original filtering for less expensive entity types
  const visibleDroppedItems = useMemo(() =>
    filterMapToArray(droppedItems, e => isInView(e.posX, e.posY, 32, 32, viewBounds)),
    [droppedItems, viewBounds]
  );

  const visibleCampfires = useMemo(() =>
    filterMapToArray(campfires, e => !e.isDestroyed && isInView(e.posX, e.posY, 64, 64, viewBounds)),
    [campfires, viewBounds]
  );

  const visibleFurnaces = useMemo(() =>
    filterMapToArray(furnaces, e => !e.isDestroyed && isInView(e.posX, e.posY, 144, 144, viewBounds)),
    [furnaces, viewBounds]
  );

  const visibleBarbecues = useMemo(() =>
    filterMapToArray(barbecues, e => !e.isDestroyed && isInView(e.posX, e.posY, 64, 64, viewBounds)),
    [barbecues, viewBounds]
  );

  const visibleLanterns = useMemo(() => {
    if (!lanterns) return [];
    const visibleFiltered: SpacetimeDBLantern[] = [];

    // Filter lanterns, but for wards we need expanded bounds to include radius circles
    for (const e of lanterns.values()) {
      if (e.isDestroyed) continue;
      
      // Regular lanterns use standard viewport filtering
      if (e.lanternType === LANTERN_TYPE_LANTERN || !e.isBurning) {
        if (isEntityInView(e, viewBounds, stableTimestamp)) {
          visibleFiltered.push(e);
        }
        continue;
      }
      
      // For active wards, check if their radius circle would be visible
      // A circle is visible if its center is within (radius) pixels of the viewport
      let wardRadius = 0;
      if (e.lanternType === 1) wardRadius = ANCESTRAL_WARD_RADIUS_PX;
      else if (e.lanternType === 2) wardRadius = SIGNAL_DISRUPTOR_RADIUS_PX;
      else if (e.lanternType === 3) wardRadius = MEMORY_BEACON_RADIUS_PX;
      
      // Expand view bounds by ward radius to check if the radius circle would be visible
      const expandedBounds = {
        viewMinX: viewBounds.viewMinX - wardRadius,
        viewMaxX: viewBounds.viewMaxX + wardRadius,
        viewMinY: viewBounds.viewMinY - wardRadius,
        viewMaxY: viewBounds.viewMaxY + wardRadius,
      };
      
      if (isEntityInView(e, expandedBounds, stableTimestamp)) {
        visibleFiltered.push(e);
      }
    }

    return visibleFiltered;
  }, [lanterns, isEntityInView, viewBounds, stableTimestamp]);

  const visibleTurrets = useMemo(() => {
    if (!turrets) return [];
    const result: SpacetimeDBTurret[] = [];

    // Filter turrets - same pattern as lanterns
    for (const e of turrets.values()) {
      if (e.isDestroyed) continue;
      if (isEntityInView(e, viewBounds, stableTimestamp)) {
        result.push(e);
      }
    }
    return result;
  }, [turrets, isEntityInView, viewBounds, stableTimestamp]);

  const visibleHomesteadHearths = useMemo(() => 
    filterMapToArray(homesteadHearths, e => !e.isDestroyed && isInView(e.posX, e.posY, 96, 96, viewBounds)),
    [homesteadHearths, viewBounds]
  );

  const visiblePlayers = useMemo(() => {
    if (!players) return [];
    const result: SpacetimeDBPlayer[] = [];
    for (const e of players.values()) {
      if (!e.isOnline) continue;

      const playerId = e.identity?.toHexString();
      const isLocalPlayer = Boolean(localPlayerId && playerId === localPlayerId);

      // The camera follows predicted local movement, while the replicated server
      // position can lag briefly at chunk boundaries. Never cull the local player
      // from the render list because of that transient mismatch.
      if (isLocalPlayer) {
        result.push(e);
        continue;
      }

      if (isInView(e.positionX, e.positionY, 64, 64, viewBounds)) result.push(e);
    }
    return result;
  }, [players, viewBounds, localPlayerId]);

  const visibleWoodenStorageBoxes = useMemo(() =>
    filterMapToArray(woodenStorageBoxes, e => isInView(e.posX, e.posY, 64, 64, viewBounds)),
    [woodenStorageBoxes, viewBounds]
  );
  
  const visibleSleepingBags = useMemo(() =>
    filterMapToArray(sleepingBags, e => isInView(e.posX, e.posY, 64, 32, viewBounds)),
    [sleepingBags, viewBounds]
  );

  const visiblePlayerCorpses = useMemo(() =>
    filterMapToArray(playerCorpses, e => isInView(e.posX, e.posY, 64, 64, viewBounds)),
    [playerCorpses, viewBounds]
  );

  const visibleStashes = useMemo(() =>
    filterMapToArray(stashes, e => isInView(e.posX, e.posY, 32, 32, viewBounds)),
    [stashes, viewBounds]
  );

  const visibleProjectiles = useMemo(() => {
    // Projectiles are short-lived and relatively low-count compared to static entities.
    // Avoid trajectory-based culling here to prevent directional pop-in regressions.
    return Array.from(projectiles.values());
  }, [projectiles]);

  // PERFORMANCE: More aggressive grass culling
  // ALSO: Filter out grass on water tiles (Sea, HotSpringWater)
  let visibleGrass = useMemo(() => {
    if (!grass || !playerPos) {
      return [];
    }
    
    const result: InterpolatedGrassData[] = [];
    const chunkSize = gameConfig.chunkSizeTiles;
    const tileSize = gameConfig.tileSize;

    for (const e of grass.values()) {
      if (e.health <= 0) {
        continue;
      }
      if (!isEntityInView(e, viewBounds, stableTimestamp)) {
        continue;
      }
      
      // Filter out grass on water tiles
      const tileX = Math.floor(e.serverPosX / tileSize);
      const tileY = Math.floor(e.serverPosY / tileSize);
      const chunkX = Math.floor(tileX / chunkSize);
      const chunkY = Math.floor(tileY / chunkSize);

      const chunk = worldChunkData?.get(`${chunkX},${chunkY}`);
      if (chunk) {
        const localTileX = ((tileX % chunkSize) + chunkSize) % chunkSize;
        const localTileY = ((tileY % chunkSize) + chunkSize) % chunkSize;
        const tileIndex = localTileY * (chunk.chunkSize || chunkSize) + localTileX;

        if (tileIndex >= 0 && tileIndex < chunk.tileTypes.length) {
          const tileTypeU8 = chunk.tileTypes[tileIndex];
          if (tileTypeU8 === 3 || tileTypeU8 === 6 || tileTypeU8 === 14) {
            continue;
          }
        }
      }
      
      result.push(e);
    }

    return result;
  }, [grass, playerPos, viewBounds, stableTimestamp, frameCounter, worldChunkData]);

  // ADDED: Filter visible shelters
  const visibleShelters = useMemo(() =>
    filterMapToArray(shelters, e => !e.isDestroyed && isInView(e.posX, e.posY, 384, 384, viewBounds)),
    [shelters, viewBounds]
  );

  const visibleClouds = useMemo(() =>
    filterMapToArray(clouds, e => isInView(e.posX, e.posY, 96, 96, viewBounds)),
    [clouds, viewBounds]
  );

  const visiblePlantedSeeds = useMemo(() => {
    if (!plantedSeeds) return [];
    const filtered: SpacetimeDBPlantedSeed[] = [];
    for (const e of plantedSeeds.values()) {
      if (isEntityInView(e, viewBounds, stableTimestamp)) {
        filtered.push(e);
      }
    }
    return filtered;
  }, [plantedSeeds, plantedSeeds?.size, isEntityInView, viewBounds, stableTimestamp]);

  const visibleRainCollectors = useMemo(() =>
    filterMapToArray(rainCollectors, e => !e.isDestroyed && isInView(e.posX, e.posY, 256, 256, viewBounds)),
    [rainCollectors, viewBounds]
  );

  const visibleBrothPots = useMemo(() =>
    filterMapToArray(brothPots, e => !e.isDestroyed && isInView(e.posX, e.posY, 64, 64, viewBounds)),
    [brothPots, viewBounds]
  );

  const visibleWildAnimals = useMemo(() => {
    if (!wildAnimals) return [];
    
    // CRITICAL FIX: Add generous padding for animals to prevent disappearing during chunk transitions
    // Animals can move quickly between chunks, so we need to show them even if they're slightly
    // outside the normal viewport bounds during transitions
    const animalPadding = 200; // Generous padding for fast-moving animals
    
    const result: SpacetimeDBWildAnimal[] = [];
    for (const e of wildAnimals.values()) {
      if (e.health <= 0) continue;
      if (e.state.tag === 'Burrowed') continue;
      const paddedBounds = {
        viewMinX: viewBounds.viewMinX - animalPadding,
        viewMaxX: viewBounds.viewMaxX + animalPadding,
        viewMinY: viewBounds.viewMinY - animalPadding,
        viewMaxY: viewBounds.viewMaxY + animalPadding,
      };
      if (isInView(e.posX, e.posY, 96, 96, paddedBounds)) result.push(e);
    }
    return result;
  }, [wildAnimals, viewBounds]);

  const visibleAnimalCorpses = useMemo(() => {
    if (!animalCorpses) return [];
    const result: SpacetimeDBAnimalCorpse[] = [];
    for (const e of animalCorpses.values()) {
      const despawnTimeMs = Number(e.despawnAt.__timestamp_micros_since_unix_epoch__ / 1000n);
      const notDespawned = stableTimestamp < despawnTimeMs;
      if (isInView(e.posX, e.posY, 96, 96, viewBounds) && notDespawned) result.push(e);
    }
    return result;
  }, [animalCorpses, viewBounds, stableTimestamp]);

  const visibleBarrels = useMemo(() =>
    filterMapToArray(barrels, e => {
      const isBuoy = (e.variant ?? 0) === 6;
      if (isBuoy) return isInView(e.posX, e.posY, 48, 48, viewBounds); // Buoy never respawns
      return (isNotRespawning(e.respawnAt) || checkBarrelDestructionVisibility(e)) && isInView(e.posX, e.posY, 48, 48, viewBounds);
    }),
    [barrels, viewBounds]
  );

  const visibleRoadLampposts = useMemo(() =>
    filterMapToArray(roadLampposts, e => isInView(e.posX, e.posY, 128, 192, viewBounds)),
    [roadLampposts, viewBounds]
  );

  const visibleFumaroles = useMemo(() =>
    filterMapToArray(fumaroles, e => isInView(e.posX, e.posY, 96, 96, viewBounds)),
    [fumaroles, viewBounds]
  );

  const visibleBasaltColumns = useMemo(() =>
    filterMapToArray(basaltColumns, e => isInView(e.posX, e.posY, 200, 300, viewBounds)),
    [basaltColumns, viewBounds]
  );

  // ALK delivery stations filtering - use worldPosX/worldPosY instead of posX/posY
  const visibleAlkStations = useMemo(() => {
    if (!alkStations) return [];
    const result: SpacetimeDBAlkStation[] = [];
    for (const station of alkStations.values()) {
      if (!station.isActive) continue;
      // ALK stations use worldPosX/worldPosY - manually check viewport bounds
      const x = station.worldPosX;
      const y = station.worldPosY;
      const buffer = 1200; // Very large buffer for tall industrial landmarks (960px tall, 768px wide at 6x scale)
      if (x >= viewBounds.viewMinX - buffer &&
          x <= viewBounds.viewMaxX + buffer &&
          y >= viewBounds.viewMinY - buffer &&
          y <= viewBounds.viewMaxY + buffer) {
        result.push(station);
      }
    }
    return result;
  }, [alkStations, viewBounds]);

  // Static ALK compound buildings (barracks, garage, shed, etc.) - 87.5% Y-sort threshold
  const visibleStaticCompoundBuildings = useMemo(() => {
    return COMPOUND_BUILDINGS.map(building => {
      const worldPos = getBuildingWorldPosition(building);
      return {
        id: building.id,
        worldX: worldPos.x,
        worldY: worldPos.y,
        width: building.width,
        height: building.height,
        imagePath: building.imagePath,
        anchorYOffset: building.anchorYOffset,
        isCenter: building.isCenter,
      };
    }).filter(building => {
      const buffer = 500;
      const left = building.worldX - building.width / 2;
      const right = building.worldX + building.width / 2;
      const top = building.worldY - building.height + building.anchorYOffset;
      const bottom = building.worldY;
      return right + buffer >= viewBounds.viewMinX &&
             left - buffer <= viewBounds.viewMaxX &&
             bottom + buffer >= viewBounds.viewMinY &&
             top - buffer <= viewBounds.viewMaxY;
    });
  }, [viewBounds]);

  // Monument doodads (shipwreck, fishing village, hunting village, etc.) - 50/50 Y-sort (sprite center)
  const visibleMonumentDoodads = useMemo(() => {
    const allMonumentParts: any[] = [];
    if (monumentParts) {
      for (const part of monumentParts.values()) {
        allMonumentParts.push({
          id: part.id,
          worldX: part.worldX,
          worldY: part.worldY,
          imagePath: part.imagePath,
          partType: part.partType || '',
          isCenter: part.isCenter,
          collisionRadius: part.collisionRadius,
          monumentType: part.monumentType?.tag || 'Unknown',
          rotationRad: part.rotationRad ?? 0,
        });
      }
    }
    const monumentBuildings = getMonumentBuildings(allMonumentParts);
    return monumentBuildings.map(building => {
      const worldPos = getBuildingWorldPosition(building);
      return {
        id: building.id,
        worldX: worldPos.x,
        worldY: worldPos.y,
        width: building.width,
        height: building.height,
        imagePath: building.imagePath,
        anchorYOffset: building.anchorYOffset,
        isCenter: building.isCenter,
        rotationRad: building.rotationRad ?? 0,
        monumentType: building.monumentType,
        partType: building.partType,
      };
    }).filter(building => {
      // Center-only parts (e.g. weather station) need larger buffer so restriction overlay is visible when player is near the zone
      const buffer = (building.isCenter && (!building.imagePath || building.imagePath.length === 0)) ? 2100 : 500;
      const left = building.worldX - building.width / 2;
      const right = building.worldX + building.width / 2;
      const top = building.worldY - building.height + building.anchorYOffset;
      const bottom = building.worldY;
      return right + buffer >= viewBounds.viewMinX &&
             left - buffer <= viewBounds.viewMaxX &&
             bottom + buffer >= viewBounds.viewMinY &&
             top - buffer <= viewBounds.viewMaxY;
    });
  }, [viewBounds, monumentParts]);

  const visibleSeaStacks = useMemo(() =>
    filterMapToArray(seaStacks, e => isInView(e.posX, e.posY, 400, 600, viewBounds)),
    [seaStacks, viewBounds]
  );

  // StormPile removed - storms now spawn HarvestableResources and DroppedItems directly

  // Living corals filtering - underwater coral reefs (uses combat system)
  // Include corals that are not respawning OR have active destruction effects
  const visibleLivingCorals = useMemo(() =>
    filterMapToArray(livingCorals, e =>
      (isNotRespawning(e.respawnAt) || hasActiveCoralDestruction(e.id.toString())) && isInView(e.posX, e.posY, 64, 64, viewBounds)
    ),
    [livingCorals, viewBounds]
  );

  // ADDED: Filter visible foundation cells
  // CRITICAL FIX: Depend on foundationCells.size to ensure recalculation when subscription data loads
  const visibleFoundationCells = useMemo(() => {
    if (!foundationCells || typeof foundationCells.values !== 'function') return [];
    
    // Foundation cells use cell coordinates - need custom viewport check
    const result: SpacetimeDBFoundationCell[] = [];
    for (const foundation of foundationCells.values()) {
      if (foundation.isDestroyed) continue;
      
      // Convert foundation cell coordinates to world pixel coordinates (center of foundation cell)
      const worldX = (foundation.cellX * 96) + 48; // FOUNDATION_TILE_SIZE = 96
      const worldY = (foundation.cellY * 96) + 48;
      
      // Check if foundation is in viewport
      if (worldX >= viewBounds.viewMinX && worldX <= viewBounds.viewMaxX &&
          worldY >= viewBounds.viewMinY && worldY <= viewBounds.viewMaxY) {
        result.push(foundation);
      }
    }
    return result;
  }, [foundationCells, foundationCells?.size, viewBounds, stableTimestamp]);

  // Extract wall map size BEFORE useMemo to ensure React detects changes
  const wallMapSize = wallCells?.size || 0;
  
  // ADDED: Filter visible wall cells
  // CRITICAL FIX: Depend on wallMapSize to ensure recalculation when subscription data loads
  const visibleWallCells = useMemo(() => {
    if (!wallCells || typeof wallCells.values !== 'function') return [];
    
    // Wall cells use foundation cell coordinates - need custom viewport check
    // North/south walls extend beyond foundation boundaries (2 tiles tall), so need extra padding
    const FOUNDATION_TILE_SIZE = 96;
    const padding = 50; // Extra padding to catch walls on edges
    const northSouthWallHeight = FOUNDATION_TILE_SIZE * 2; // North/south walls are 2 foundation cells tall
    
    const result: SpacetimeDBWallCell[] = [];
    for (const wall of wallCells.values()) {
      if (wall.isDestroyed) continue;
      
      // Convert foundation cell coordinates to world pixel coordinates (center of foundation cell)
      const worldX = (wall.cellX * FOUNDATION_TILE_SIZE) + 48;
      const worldY = (wall.cellY * FOUNDATION_TILE_SIZE) + 48;
      
      // North/south walls extend beyond foundation boundaries (both extend upward)
      if (wall.edge === 0 || wall.edge === 2) {
        // Both north and south walls extend upward for isometric depth
        // North wall: extends from top edge upward
        // South wall: extends from bottom edge upward
        const foundationTopY = wall.cellY * FOUNDATION_TILE_SIZE;
        const foundationBottomY = foundationTopY + FOUNDATION_TILE_SIZE;
        
        if (wall.edge === 0) {
          // North wall - extends upward from top edge
          const minY = foundationTopY - northSouthWallHeight; // Top of wall extends upward
          const maxY = foundationTopY; // Bottom of wall is at foundation top
          if (worldX >= viewBounds.viewMinX - padding && worldX <= viewBounds.viewMaxX + padding &&
              maxY >= viewBounds.viewMinY - padding && minY <= viewBounds.viewMaxY + padding) {
            result.push(wall);
          }
          continue;
        } else {
          // South wall - extends upward from bottom edge
          const minY = foundationBottomY - northSouthWallHeight; // Top of wall (extends upward from bottom)
          const maxY = foundationBottomY; // Bottom of wall is at foundation bottom
          if (worldX >= viewBounds.viewMinX - padding && worldX <= viewBounds.viewMaxX + padding &&
              maxY >= viewBounds.viewMinY - padding && minY <= viewBounds.viewMaxY + padding) {
            result.push(wall);
          }
          continue;
        }
      } else {
        // East/west walls - standard padding
        if (worldX >= viewBounds.viewMinX - padding && worldX <= viewBounds.viewMaxX + padding &&
            worldY >= viewBounds.viewMinY - padding && worldY <= viewBounds.viewMaxY + padding) {
          result.push(wall);
        }
      }
    }
    return result;
  }, [wallCells, wallMapSize, viewBounds, stableTimestamp]);

  // Extract door map size BEFORE useMemo to ensure React detects changes
  const doorMapSize = doors?.size || 0;

  // ADDED: Filter visible doors
  const visibleDoors = useMemo(() => {
    if (!doors || typeof doors.values !== 'function') return [];
    
    const padding = 50; // Extra padding to catch doors on edges
    
    const result: SpacetimeDBDoor[] = [];
    for (const door of doors.values()) {
      // Doors use world position directly (posX, posY)
      const worldX = door.posX;
      const worldY = door.posY;
      
      if (worldX >= viewBounds.viewMinX - padding && worldX <= viewBounds.viewMaxX + padding &&
          worldY >= viewBounds.viewMinY - padding && worldY <= viewBounds.viewMaxY + padding) {
        result.push(door);
      }
    }
    return result;
  }, [doors, doorMapSize, viewBounds, stableTimestamp]);

  // Extract foundation map size BEFORE building clusters computation to ensure React detects changes
  const foundationMapSize = foundationCells?.size || 0;

  // ADDED: Calculate building clusters for fog of war
  const buildingClusters = useMemo(() => {
    if (!foundationCells || !wallCells) return new Map();
    return getBuildingClusters(foundationCells, wallCells);
  }, [foundationCells, foundationMapSize, wallCells, wallMapSize]);

  // ADDED: Determine which building cluster the local player is in
  const playerBuildingClusterId = useMemo(() => {
    const localPlayer = localPlayerId ? players.get(localPlayerId) : undefined;
    return getPlayerBuildingClusterId(localPlayer, buildingClusters);
  }, [localPlayerId, players, buildingClusters]);

  const visibleHarvestableResourcesMap = useMemo(() =>
    arrayToIdMap(visibleHarvestableResources, hr => hr.id),
    [visibleHarvestableResources]
  );

  const visibleCampfiresMap = useMemo(() =>
    arrayToIdMap(visibleCampfires, c => c.id),
    [visibleCampfires]
  );

  const visibleFurnacesMap = useMemo(() =>
    arrayToIdMap(visibleFurnaces, f => f.id),
    [visibleFurnaces]
  );

  const visibleBarbecuesMap = useMemo(() =>
    arrayToIdMap(visibleBarbecues, b => b.id),
    [visibleBarbecues]
  );

  const visibleLanternsMap = useMemo(() =>
    arrayToIdMap(visibleLanterns, l => l.id),
    [visibleLanterns]
  );

  const visibleTurretsMap = useMemo(() =>
    arrayToIdMap(visibleTurrets, t => t.id),
    [visibleTurrets]
  );

  const visibleHomesteadHearthsMap = useMemo(() =>
    arrayToIdMap(visibleHomesteadHearths, h => h.id),
    [visibleHomesteadHearths]
  ); 

  const visibleDroppedItemsMap = useMemo(() =>
    arrayToIdMap(visibleDroppedItems, i => i.id),
    [visibleDroppedItems]
  );
  
  const visibleBoxesMap = useMemo(() =>
    arrayToIdMap(visibleWoodenStorageBoxes, b => b.id),
    [visibleWoodenStorageBoxes]
  );

  const visiblePlantedSeedsMap = useMemo(() =>
    arrayToIdMap(visiblePlantedSeeds, p => p.id),
    [visiblePlantedSeeds]
  );

  const visibleRainCollectorsMap = useMemo(() =>
    arrayToIdMap(visibleRainCollectors, r => r.id),
    [visibleRainCollectors]
  );

  const visibleBrothPotsMap = useMemo(() =>
    arrayToIdMap(visibleBrothPots, b => b.id),
    [visibleBrothPots]
  );

  const visibleWildAnimalsMap = useMemo(() =>
    arrayToIdMap(visibleWildAnimals, w => w.id),
    [visibleWildAnimals]
  );

  const visibleProjectilesMap = useMemo(() =>
    arrayToIdMap(visibleProjectiles, p => p.id),
    [visibleProjectiles]
  );

  const visiblePlayerCorpsesMap = useMemo(() => {
    const map = new Map<string, SpacetimeDBPlayerCorpse>();
    visiblePlayerCorpses.forEach(c => map.set(c.id.toString(), c));
    return map;
  }, [visiblePlayerCorpses]);

  const visibleStashesMap = useMemo(() => arrayToIdMap(visibleStashes, st => st.id), [visibleStashes]);

  const visibleSleepingBagsMap = useMemo(() =>
    arrayToIdMap(visibleSleepingBags, sl => sl.id),
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

  const visibleRuneStonesMap = useMemo(() => {
    const map = new Map<string, SpacetimeDBRuneStone>();
    visibleRuneStones.forEach(e => map.set(e.id.toString(), e));
    return map;
  }, [visibleRuneStones]);

  const visibleCairnsMap = useMemo(() => {
    const map = new Map<string, SpacetimeDBCairn>();
    visibleCairns.forEach(e => map.set(e.id.toString(), e));
    return map;
  }, [visibleCairns]);

  const visibleWoodenStorageBoxesMap = useMemo(() => {
    const map = new Map<string, SpacetimeDBWoodenStorageBox>();
    visibleWoodenStorageBoxes.forEach(e => map.set(e.id.toString(), e));
    return map;
  }, [visibleWoodenStorageBoxes]);

  const groundItems = useMemo(() => visibleSleepingBags, [visibleSleepingBags]);

  const visibleGrassMap = useMemo(() =>
    arrayToIdMap(visibleGrass, g => g.id),
    [visibleGrass]
  ); // visibleGrass is now InterpolatedGrassData[]

  // ADDED: Map for visible shelters
  const visibleSheltersMap = useMemo(() =>
    arrayToIdMap(visibleShelters, s => s.id),
    [visibleShelters]
  );

  // ADDED: Map for visible animal corpses
  const visibleAnimalCorpsesMap = useMemo(() =>
    arrayToIdMap(visibleAnimalCorpses, a => a.id),
    [visibleAnimalCorpses]
  );

  // ADDED: Map for visible barrels
  const visibleBarrelsMap = useMemo(() =>
    arrayToIdMap(visibleBarrels, b => b.id),
    [visibleBarrels]
  );

  // ADDED: Map for visible road lampposts
  const visibleRoadLamppostsMap = useMemo(() =>
    arrayToIdMap(visibleRoadLampposts, l => l.id),
    [visibleRoadLampposts]
  );

  const visibleFumarolesMap = useMemo(() =>
    arrayToIdMap(visibleFumaroles, f => f.id),
    [visibleFumaroles]
  );

  const visibleBasaltColumnsMap = useMemo(() =>
    arrayToIdMap(visibleBasaltColumns, b => b.id),
    [visibleBasaltColumns]
  );

  const visibleAlkStationsMap = useMemo(() =>
    arrayToIdMap(visibleAlkStations, s => s.stationId),
    [visibleAlkStations]
  );

  // ADDED: Map for visible sea stacks
  const visibleSeaStacksMap = useMemo(() =>
    arrayToIdMap(visibleSeaStacks, s => s.id),
    [visibleSeaStacks]
  );

  // StormPile removed - storms now spawn HarvestableResources and DroppedItems directly

  // ADDED: Map for visible living corals
  const visibleLivingCoralsMap = useMemo(() =>
    arrayToIdMap(visibleLivingCorals, c => c.id),
    [visibleLivingCorals]
  );

  // ADDED: Map for visible foundation cells
  const visibleFoundationCellsMap = useMemo(() =>
    arrayToIdMap(visibleFoundationCells, f => f.id),
    [visibleFoundationCells]
  );

  // ADDED: Map for visible wall cells
  const visibleWallCellsMap = useMemo(() =>
    arrayToIdMap(visibleWallCells, w => w.id),
    [visibleWallCells]
  );

  // ADDED: Map for visible doors
  const visibleDoorsMap = useMemo(() =>
    arrayToIdMap(visibleDoors, d => d.id),
    [visibleDoors]
  );

  // Extract fence map size BEFORE useMemo to ensure React detects changes
  const fenceMapSize = fences?.size || 0;

  // ADDED: Filter visible fences
  const visibleFences = useMemo(() => {
    if (!fences || typeof fences.values !== 'function') return [];
    
    const padding = 50; // Extra padding to catch fences on edges
    
    const result: SpacetimeDBFence[] = [];
    for (const fence of fences.values()) {
      if (fence.isDestroyed) continue;
      
      // Fences use world position directly (posX, posY)
      const worldX = fence.posX;
      const worldY = fence.posY;
      
      if (worldX >= viewBounds.viewMinX - padding && worldX <= viewBounds.viewMaxX + padding &&
          worldY >= viewBounds.viewMinY - padding && worldY <= viewBounds.viewMaxY + padding) {
        result.push(fence);
      }
    }
    return result;
  }, [fences, fenceMapSize, viewBounds, stableTimestamp]);

  // ADDED: Map for visible fences
  const visibleFencesMap = useMemo(() =>
    arrayToIdMap(visibleFences, f => f.id),
    [visibleFences]
  );

  // ===== CACHED Y-SORTING WITH DIRTY FLAG SYSTEM =====
  // PERFORMANCE: Cache includes pre-computed sort keys for faster comparisons
  // Internal type extends YSortedEntityType with pre-computed _ySortKey and _priority
  type YSortedEntityWithKey = YSortedEntityType & { _ySortKey: number; _priority: number };
  
  // Cache for Y-sorted entities to avoid recalculating every frame
  const ySortedCache = useMemo(() => ({
    entities: [] as YSortedEntityWithKey[],
    swimmingPlayersForBottomHalf: [] as SpacetimeDBPlayer[],
    lastLocalPlayerTileKey: '' as string,
    lastUpdateFrame: -1,
    lastEntityCounts: {} as Record<string, number>,
    lastDroppedItemsSignature: '' as string,
    lastHarvestableResourcesSignature: '' as string,
    lastProjectileSignature: '' as string,
    lastFoundationMapSize: 0, // Track foundation map size separately
    lastWallMapSize: 0, // Track wall map size separately
    isDirty: true
  }), []);

  // PERFORMANCE: Cache corpse hit check - only recompute every 150ms instead of every frame
  const corpseHitCheckCache = useRef<{ timestamp: number; result: boolean }>({ timestamp: 0, result: false });
  
  // Helper to check if entity counts changed significantly
  const hasEntityCountChanged = useCallback((newCounts: Record<string, number>) => {
    const oldCounts = ySortedCache.lastEntityCounts;
    for (const [key, count] of Object.entries(newCounts)) {
      if (Math.abs((oldCounts[key] || 0) - count) > 5) { // Only resort if count changed by more than 5
        return true;
      }
    }
    return false;
  }, [ySortedCache]);

  // Y-sorted entities with PERFORMANCE OPTIMIZED sorting
  // CRITICAL: Force recalculation when map sizes change (subscription data loads)
  // Note: wallMapSize and foundationMapSize are already extracted above
  const playerMapSize = players?.size || 0;
  
  const ySortedMemoResult = useMemo(() => {
    // Detect dropped-item content changes (not just count deltas).
    // Important for rapid create/delete/replace flows where count may stay stable.
    const droppedItemsSignature = visibleDroppedItems
      .map(item => `${item.id.toString()}:${item.itemDefId}:${item.quantity}`)
      .sort()
      .join('|');
    const harvestableResourcesSignature = visibleHarvestableResources
      .map(resource => `${resource.id.toString()}:${resource.respawnAt?.microsSinceUnixEpoch?.toString?.() ?? '0'}`)
      .sort()
      .join('|');
    const projectileSignature = visibleProjectiles
      .map(projectile => getProjectileVisualDedupKey(projectile))
      .sort()
      .join('|');

    // Calculate current entity counts
    const currentEntityCounts = {
      players: visiblePlayers.length,
      trees: visibleTrees.length,
      stones: visibleStones.length,
      boxes: visibleWoodenStorageBoxes.length,
      campfires: visibleCampfires.length,
      furnaces: visibleFurnaces.length,
      barbecues: visibleBarbecues.length,
      lanterns: visibleLanterns.length,
      homesteadHearths: visibleHomesteadHearths.length, // ADDED: Homestead Hearths count
      droppedItems: visibleDroppedItems.length,
      projectiles: visibleProjectiles.length,
      shelters: visibleShelters.length,
      grass: visibleGrass.length,
      plantedSeeds: visiblePlantedSeeds.length,
      rainCollectors: visibleRainCollectors.length,
      brothPots: visibleBrothPots.length,
      wildAnimals: visibleWildAnimals.length,
      animalCorpses: visibleAnimalCorpses.length,
      barrels: visibleBarrels.length,
      fumaroles: visibleFumaroles.length,
      basaltColumns: visibleBasaltColumns.length,
      seaStacks: visibleSeaStacks.length,
      foundationCells: visibleFoundationCells.length,
      harvestableResources: visibleHarvestableResources.length,
      playerCorpses: visiblePlayerCorpses.length,
      stashes: visibleStashes.length,
      wallCells: visibleWallCells.length,
      compoundBuildings: visibleStaticCompoundBuildings.length + visibleMonumentDoodads.length,
    };
    
    // Calculate fog overlay count (building clusters that should be masked)
    let fogOverlayCount = 0;
    if (buildingClusters && buildingClusters.size > 0) {
      const processedClusters = new Set<string>();
      visibleFoundationCells.forEach(foundation => {
        if (foundation.isDestroyed) return;

        // Find which cluster this foundation belongs to
        for (const [clusterId, cluster] of buildingClusters) {
          if (cluster.foundationIds.has(foundation.id) && !processedClusters.has(clusterId)) {
            // Check if this cluster should be masked
            const shouldMask = cluster.isEnclosed && playerBuildingClusterId !== clusterId;
            if (shouldMask) {
          fogOverlayCount++;
              processedClusters.add(clusterId);
            }
            break;
          }
        }
      });
    }
    
    const totalEntities = Object.values(currentEntityCounts).reduce((sum, count) => sum + count, 0) + fogOverlayCount;
    
    // Early exit if no entities
    if (totalEntities === 0) return { entities: [], swimmingPlayersForBottomHalf: [] };
    
    // CRITICAL FIX: Force re-sort when foundation/wall data first loads OR when player data loads
    // This fixes the issue where players render below tiles on initial login
    // because player data loads before foundation/wall data (or vice versa)
    const foundationsJustLoaded = visibleFoundationCells.length > 0 && 
      (!ySortedCache.lastEntityCounts || ySortedCache.lastEntityCounts.foundationCells === 0);
    const wallsJustLoaded = visibleWallCells.length > 0 && 
      (!ySortedCache.lastEntityCounts || ySortedCache.lastEntityCounts.wallCells === 0);
    const playersJustLoaded = visiblePlayers.length > 0 && 
      (!ySortedCache.lastEntityCounts || ySortedCache.lastEntityCounts.players === 0);
    
    // CRITICAL FIX: Also check if player data loaded AFTER foundations/walls were already present
    // This handles the case where foundations load first, then player loads later
    const foundationsWerePresent = ySortedCache.lastEntityCounts && 
      (ySortedCache.lastEntityCounts.foundationCells || 0) > 0;
    const wallsWerePresent = ySortedCache.lastEntityCounts && 
      (ySortedCache.lastEntityCounts.wallCells || 0) > 0;
    const playerJustLoadedWithTilesPresent = playersJustLoaded && (foundationsWerePresent || wallsWerePresent);
    
    // CRITICAL FIX: Check if we now have BOTH players AND foundations/walls present,
    // but the cache was calculated when one was missing. This handles race conditions
    // where data loads in different orders on login.
    const hasPlayersNow = visiblePlayers.length > 0;
    const hasTilesNow = visibleFoundationCells.length > 0 || visibleWallCells.length > 0;
    const hadPlayersBefore = ySortedCache.lastEntityCounts && (ySortedCache.lastEntityCounts.players || 0) > 0;
    const hadTilesBefore = ySortedCache.lastEntityCounts && 
      ((ySortedCache.lastEntityCounts.foundationCells || 0) > 0 || 
       (ySortedCache.lastEntityCounts.wallCells || 0) > 0);
    
    // CRITICAL FIX: Force recalculation when wall count increases (new wall placed)
    const wallCountIncreased = ySortedCache.lastEntityCounts && 
      visibleWallCells.length > (ySortedCache.lastEntityCounts.wallCells || 0);
    
    // CRITICAL FIX: Force recalculation when foundation count increases (new foundation placed)
    const foundationCountIncreased = ySortedCache.lastEntityCounts && 
      visibleFoundationCells.length > (ySortedCache.lastEntityCounts.foundationCells || 0);
    const bothPresentNowButNotBefore = hasPlayersNow && hasTilesNow && (!hadPlayersBefore || !hadTilesBefore);
    
    // NOTE: Previously had `hasBothPlayersAndTiles` which disabled caching entirely when players + tiles existed.
    // This caused 60 re-sorts/sec even when nothing changed. Removed as the other safeguards
    // (foundationsJustLoaded, wallsJustLoaded, bothPresentNowButNotBefore, etc.) already handle the
    // subscription race condition. Now we re-sort every 4 frames (~15fps) for smooth visuals.
    
    // CORPSE SHAKE FIX: Check if any corpse was recently hit (within 250ms)
    // PERFORMANCE: Cache result for 150ms - avoids iterating all corpses every frame
    const CORPSE_SHAKE_CACHE_THRESHOLD_MS = 250;
    const CORPSE_CHECK_CACHE_MS = 150;
    let hasRecentCorpseHit = corpseHitCheckCache.current.result;
    if (stableTimestamp - corpseHitCheckCache.current.timestamp > CORPSE_CHECK_CACHE_MS) {
      hasRecentCorpseHit = false;
      for (const corpse of visibleAnimalCorpses) {
        if (corpse.lastHitTime) {
          const hitTimeMs = Number((corpse.lastHitTime as any).microsSinceUnixEpoch || (corpse.lastHitTime as any).__timestamp_micros_since_unix_epoch__ || 0n) / 1000;
          if (stableTimestamp - hitTimeMs < CORPSE_SHAKE_CACHE_THRESHOLD_MS) {
            hasRecentCorpseHit = true;
            break;
          }
        }
      }
      if (!hasRecentCorpseHit) {
        for (const corpse of visiblePlayerCorpses) {
          if (corpse.lastHitTime) {
            const hitTimeMs = Number((corpse.lastHitTime as any).microsSinceUnixEpoch || (corpse.lastHitTime as any).__timestamp_micros_since_unix_epoch__ || 0n) / 1000;
            if (stableTimestamp - hitTimeMs < CORPSE_SHAKE_CACHE_THRESHOLD_MS) {
              hasRecentCorpseHit = true;
              break;
            }
          }
        }
      }
      corpseHitCheckCache.current = { timestamp: stableTimestamp, result: hasRecentCorpseHit };
    }
    
    // Swimming fix: Force resort when local player moves between tiles (water/land transition)
    const localPlayerTileKey = localPlayerPredictedPosition
      ? `${Math.floor(localPlayerPredictedPosition.x / gameConfig.tileSize)},${Math.floor(localPlayerPredictedPosition.y / gameConfig.tileSize)}`
      : '';
    const localPlayerTileChanged = localPlayerTileKey !== ySortedCache.lastLocalPlayerTileKey;
    const droppedItemsChanged = droppedItemsSignature !== ySortedCache.lastDroppedItemsSignature;
    const harvestableResourcesChanged = harvestableResourcesSignature !== ySortedCache.lastHarvestableResourcesSignature;
    const projectilesChanged = projectileSignature !== ySortedCache.lastProjectileSignature;
    
    // Check if we need to resort
    // PERFORMANCE: Resort every 8 frames (~7.5/sec) - balances smoothness vs cost. Increase to 4 for more responsive.
    const needsResort = ySortedCache.isDirty || 
                       (frameCounter - ySortedCache.lastUpdateFrame) > 8 || // Force resort every 8 frames
                       hasEntityCountChanged(currentEntityCounts) ||
                       droppedItemsChanged || // Keep dropped-item create/delete/replacement visually immediate
                       harvestableResourcesChanged || // Keep harvestable hide/show immediate on harvest/respawn
                       projectilesChanged || // Projectiles are short-lived; stale cached arrows are visually worse than a cheap rebuild
                       foundationsJustLoaded || // Force resort when foundations first load
                       wallsJustLoaded || // Force resort when walls first load
                       wallCountIncreased || // CRITICAL: Force resort when new wall is placed
                       foundationCountIncreased || // CRITICAL: Force resort when new foundation is placed
                       playerJustLoadedWithTilesPresent || // Force resort when player loads with tiles already present
                       bothPresentNowButNotBefore || // Force resort when both players and tiles are now present but weren't both before
                       hasRecentCorpseHit || // CORPSE SHAKE FIX: Force resort when corpse was recently hit
                       localPlayerTileChanged; // SWIMMING FIX: Force resort when local player moves between tiles (water/land)
    
    // Use cached result when no re-sort is needed - significant performance gain!
    if (!needsResort && ySortedCache.entities.length > 0) {
      // Keep cached entity references fresh even when we skip a full re-sort.
      // This prevents visual updates that do not change counts/order (door open state,
      // repaired structure health, etc.) from waiting on movement to become visible.
      const refreshedCachedEntities: YSortedEntityWithKey[] = [];

      for (const cachedEntity of ySortedCache.entities) {
        let latestEntity = cachedEntity.entity;

        if (cachedEntity.type === 'wild_animal') {
          const cachedAnimal = cachedEntity.entity as SpacetimeDBWildAnimal;
          latestEntity = wildAnimals?.get(cachedAnimal.id.toString()) ?? cachedEntity.entity;
        } else if (cachedEntity.type === 'foundation_cell') {
          const cachedFoundation = cachedEntity.entity as SpacetimeDBFoundationCell;
          const latestFoundation = foundationCells?.get(cachedFoundation.id.toString());
          if (!latestFoundation) continue;
          latestEntity = latestFoundation;
        } else if (cachedEntity.type === 'wall_cell') {
          const cachedWall = cachedEntity.entity as SpacetimeDBWallCell;
          const latestWall = wallCells?.get(cachedWall.id.toString());
          if (!latestWall) continue;
          latestEntity = latestWall;
        } else if (cachedEntity.type === 'door') {
          const cachedDoor = cachedEntity.entity as SpacetimeDBDoor;
          const latestDoor = doors?.get(cachedDoor.id.toString());
          if (!latestDoor) continue;
          latestEntity = latestDoor;
        } else if (cachedEntity.type === 'fence') {
          const cachedFence = cachedEntity.entity as SpacetimeDBFence;
          const latestFence = fences?.get(cachedFence.id.toString());
          if (!latestFence) continue;
          latestEntity = latestFence;
        }

        cachedEntity.entity = latestEntity;
        cachedEntity._ySortKey = getEntityY(
          { type: cachedEntity.type, entity: latestEntity } as YSortedEntityType,
          stableTimestamp,
        );
        refreshedCachedEntities.push(cachedEntity);
      }

      ySortedCache.entities = refreshedCachedEntities;

      // Split-render: bottom-half list must stay aligned with who is actually emitted as
      // `swimmingPlayerTopHalf` in the cached entity list. Stale `swimmingPlayersForBottomHalf`
      // while entities still carry swim markers caused legs to never draw in the prep pass.
      const swimBottomFromCachedEntities: SpacetimeDBPlayer[] = [];
      for (const ent of ySortedCache.entities as YSortedEntityWithKey[]) {
        if (ent.type === 'swimmingPlayerTopHalf' && ent.entity) {
          swimBottomFromCachedEntities.push(ent.entity as SpacetimeDBPlayer);
        }
      }

      // Use cached result - huge performance gain!
      return {
        entities: ySortedCache.entities as YSortedEntityType[],
        swimmingPlayersForBottomHalf:
          swimBottomFromCachedEntities.length > 0
            ? swimBottomFromCachedEntities
            : ySortedCache.swimmingPlayersForBottomHalf,
      };
    }
    
    // PERFORMANCE OPTIMIZATION: Pre-compute Y sort keys during entity aggregation
    // This eliminates thousands of getEntityY() and getEntityPriority() calls during sorting
    // Instead of calling these functions O(n log n) times in the comparator,
    // we compute them once per entity (O(n)) and then compare simple numbers
    // (YSortedEntityWithKey type is defined above near ySortedCache)
    
    // PERFORMANCE: Pre-allocate array with known size to avoid dynamic resizing
    const allEntities: YSortedEntityWithKey[] = new Array(totalEntities);
    let index = 0;
    
    // Helper to add entity with pre-computed sort key
    const addEntity = (type: YSortedEntityType['type'], entity: any) => {
      const item = { type, entity } as YSortedEntityType;
      allEntities[index++] = {
        ...item,
        _ySortKey: getEntityY(item, stableTimestamp),
        _priority: getEntityPriority(item)
      } as YSortedEntityWithKey;
    };
    
    // Aggregate all entity types with pre-computed sort keys
    // CRITICAL FIX: For the local player, use the PREDICTED Y position for sorting.
    // The player is RENDERED at the predicted position (client-side prediction for smooth movement),
    // but previously sorted at the SERVER position (player.positionY). When these diverge
    // (e.g., during movement), the player can appear at a different Y than their sort position,
    // causing incorrect rendering order relative to grass and other entities.
    // Phase 3c: Split swimming players - SINGLE SOURCE OF TRUTH for both bottom-half list and top-half in Y-sort
    // Both must use identical logic to prevent half-body glitches (head or body invisible)
    const isSnorkeling = isLocalPlayerSnorkeling ?? false;
    const swimmingPlayersForBottomHalf: SpacetimeDBPlayer[] = [];
    visiblePlayers.forEach(e => {
      const playerId = e.identity?.toHexString() ?? '';
      const isLocal = localPlayerId && playerId === localPlayerId;
      // Use predicted position for local player (matches render position) for consistent tile lookup
      const posX = isLocal && localPlayerPredictedPosition ? localPlayerPredictedPosition.x : e.positionX;
      const posY = isLocal && localPlayerPredictedPosition ? localPlayerPredictedPosition.y : e.positionY;
      const tileKey = `${Math.floor(posX / gameConfig.tileSize)},${Math.floor(posY / gameConfig.tileSize)}`;
      const isOnSeaTransition = seaTransitionTileLookup?.get(tileKey) ?? false;
      // Local player should transition visuals immediately based on predicted tile,
      // instead of waiting for replicated server isOnWater.
      const localPredictedIsOnWater = isLocal && localPlayerPredictedPosition
        ? (waterTileLookup?.get(tileKey) ?? false)
        : undefined;
      const effectiveIsOnWater = (localPredictedIsOnWater ?? e.isOnWater) && !isOnSeaTransition;
      const isSwimming = effectiveIsOnWater && !e.isDead && !e.isKnockedOut && !e.isSnorkeling;
      const isLocalAndSnorkeling = isSnorkeling && isLocal;
      const isRemoteSnorkeling = e.isSnorkeling;
      if (isSwimming && !isLocalAndSnorkeling && !isRemoteSnorkeling) {
        swimmingPlayersForBottomHalf.push(e);
        const sortY = (isLocal && localPlayerPredictedPosition) ? localPlayerPredictedPosition.y : e.positionY;
        const swimItem = {
          type: 'swimmingPlayerTopHalf' as const,
          entity: e,
          yPosition: sortY,
          playerId,
          _ySortKey: sortY,
          _priority: 21
        };
        allEntities[index++] = swimItem as YSortedEntityWithKey;
      } else {
        addEntity('player', e);
      }
    });
    visibleTrees.forEach(e => addEntity('tree', e));
    // Include stones with health > 0 OR stones with active destruction effects
    visibleStones.forEach(e => { if (e.health > 0 || hasActiveStoneDestruction(e.id.toString())) addEntity('stone', e); });
    visibleRuneStones.forEach(e => addEntity('rune_stone', e));
    visibleCairns.forEach(e => addEntity('cairn', e));
    visibleWoodenStorageBoxes.forEach(e => addEntity('wooden_storage_box', e));
    visibleStashes.forEach(e => addEntity('stash', e));
    visibleCampfires.forEach(e => addEntity('campfire', e));
    visibleFurnaces.forEach(e => addEntity('furnace', e));
    visibleBarbecues.forEach(e => addEntity('barbecue', e));
    visibleLanterns.forEach(e => addEntity('lantern', e));
    visibleTurrets.forEach(e => addEntity('turret', e)); // ADDED: Turrets
    visibleHomesteadHearths.forEach(e => addEntity('homestead_hearth', e)); // ADDED: Homestead Hearths
    visibleGrass.forEach(e => addEntity('grass', e));
    visiblePlantedSeeds.forEach(e => addEntity('planted_seed', e));
    visibleDroppedItems.forEach(e => addEntity('dropped_item', e));
    visibleHarvestableResources.forEach(e => addEntity('harvestable_resource', e));
    visibleRainCollectors.forEach(e => addEntity('rain_collector', e));
    visibleBrothPots.forEach(e => addEntity('broth_pot', e));
    visibleProjectiles.forEach(e => addEntity('projectile', e));
    visibleAnimalCorpses.forEach(e => addEntity('animal_corpse', e));
    visiblePlayerCorpses.forEach(e => addEntity('player_corpse', e));
    visibleWildAnimals.forEach(e => addEntity('wild_animal', e));
    visibleBarrels.forEach(e => addEntity('barrel', e));
    visibleRoadLampposts.forEach(e => addEntity('road_lamppost', e)); // ADDED: Road lampposts
    visibleFumaroles.forEach(e => addEntity('fumarole', e)); // ADDED: Fumaroles
    visibleBasaltColumns.forEach(e => addEntity('basalt_column', e)); // ADDED: Basalt columns
    // StormPile removed - storms now spawn HarvestableResources and DroppedItems directly
    // Include living corals that are healthy OR have active destruction effects
    visibleLivingCorals.forEach(e => { if (isNotRespawning(e.respawnAt) || hasActiveCoralDestruction(e.id.toString())) addEntity('living_coral', e); }); // Living corals (uses combat)
    visibleAlkStations.forEach(e => addEntity('alk_station', e)); // ADDED: ALK delivery stations
    visibleStaticCompoundBuildings.forEach(e => addEntity('compound_building', e)); // Static ALK compound buildings
    visibleMonumentDoodads.forEach(e => addEntity('monument_doodad', e)); // Monument doodads (bottom 25% Y-sort)
    visibleSleepingBags.forEach(e => addEntity('sleeping_bag', e)); // ADDED: Sleeping bags
    visibleSeaStacks.forEach(e => addEntity('sea_stack', e));
    visibleShelters.forEach(e => addEntity('shelter', e));
    visibleFoundationCells.forEach(e => addEntity('foundation_cell', e)); // ADDED: Foundations
    
    // ADDED: Add fog overlays for building clusters that should be masked
    // These render above placeables but below walls
    // CRITICAL: Must always check and add fog overlays when player is outside enclosed buildings
    // This ensures consistent fog of war for PVP gameplay
    // IMPORTANT: Add fog overlays BEFORE walls to ensure correct render order
    if (buildingClusters && buildingClusters.size > 0) {
      const processedClusters = new Set<string>();

      visibleFoundationCells.forEach(foundation => {
        if (foundation.isDestroyed) return;

        // Find which cluster this foundation belongs to
        for (const [clusterId, cluster] of buildingClusters) {
          if (cluster.foundationIds.has(foundation.id) && !processedClusters.has(clusterId)) {
            // Check if this cluster should be masked
            const shouldMask = cluster.isEnclosed && playerBuildingClusterId !== clusterId;

        if (shouldMask) {
              // Calculate cluster bounds
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              cluster.cellCoords.forEach((coord: string) => {
                const [cellX, cellY] = coord.split(',').map(Number);
                const worldX = cellX * FOUNDATION_TILE_SIZE;
                const worldY = cellY * FOUNDATION_TILE_SIZE;
                minX = Math.min(minX, worldX);
                minY = Math.min(minY, worldY);
                maxX = Math.max(maxX, worldX + FOUNDATION_TILE_SIZE);
                maxY = Math.max(maxY, worldY + FOUNDATION_TILE_SIZE);
              });

              // Detect entrance way foundations (foundations on perimeter without walls on exposed edges)
              // Get all foundations in this cluster
              const clusterFoundations: SpacetimeDBFoundationCell[] = [];
              for (const f of visibleFoundationCells) {
                if (cluster.foundationIds.has(f.id)) {
                  clusterFoundations.push(f);
                }
              }

              // Detect entrance way foundations (foundations on perimeter without walls OR doors on exposed edges)
              const entranceWayFoundations = detectEntranceWayFoundations(
                clusterFoundations,
                wallCells || new Map(),
                cluster.cellCoords,
                doors // Pass doors so they count as edge coverage (not entrance ways)
              );

              // Detect foundations with north walls OR north doors (for ceiling extension to cover their interiors)
              const northWallFoundations = detectNorthWallFoundations(
                clusterFoundations,
                wallCells || new Map(),
                doors // Pass doors so north doors also get ceiling extension
              );

              // Detect foundations with south walls OR south doors (to prevent ceiling from covering them)
              const southWallFoundations = detectSouthWallFoundations(
                clusterFoundations,
                wallCells || new Map(),
                doors // Pass doors so south doors also prevent ceiling coverage
              );

              addEntity('fog_overlay', {
                  clusterId,
                  bounds: { minX, minY, maxX, maxY },
                  entranceWayFoundations: Array.from(entranceWayFoundations), // Convert Set to Array for serialization
                  clusterFoundationCoords: Array.from(cluster.cellCoords), // Pass all foundation coords to prevent rendering outside building
                  northWallFoundations: Array.from(northWallFoundations), // Pass foundations with north walls for ceiling extension
                  southWallFoundations: Array.from(southWallFoundations) // Pass foundations with south walls to prevent covering them
                });
              processedClusters.add(clusterId);
            }
            break; // Found the cluster, no need to check others
          }
        }
      });
    }
    
    visibleWallCells.forEach(e => addEntity('wall_cell', e)); // ADDED: Walls
    visibleDoors.forEach(e => addEntity('door', e)); // ADDED: Doors
    visibleFences.forEach(e => addEntity('fence', e)); // ADDED: Fences

    // Trim array to actual size in case some entities were filtered out (e.g., stones with 0 health)
    allEntities.length = index;
    
    // PERFORMANCE OPTIMIZATION: Sort using pre-computed _ySortKey and _priority
    // The Y sort key was computed once per entity during aggregation above,
    // eliminating O(n log n) getEntityY() calls during sorting.
    // Special case checks still run, but the final Y comparison uses simple numbers.
    const getPlayerEffectiveY = (player: SpacetimeDBPlayer): number => {
      return player.positionY;
    };
    const isPlayerLike = (t: string) => t === 'player' || t === 'swimmingPlayerTopHalf';
    const getPlayerOrSwimY = (item: YSortedEntityWithKey): number => {
      if (item.type === 'swimmingPlayerTopHalf') return (item as { yPosition: number }).yPosition;
      return getPlayerEffectiveY(item.entity as SpacetimeDBPlayer);
    };
    
    allEntities.sort((a, b) => {
      // ABSOLUTE FIRST CHECK: Broth pot MUST ALWAYS render above campfires and fumaroles
      // Broth pots sit ON TOP of heat sources - no exceptions, no situation where they don't.
      // Players retain normal Y-sorting with broth pot and campfire; this rule only affects pot vs heat source.
      if (a.type === 'broth_pot' && (b.type === 'campfire' || b.type === 'fumarole')) {
        return 1; // Broth pot renders after (above) campfire/fumarole
      }
      if (b.type === 'broth_pot' && (a.type === 'campfire' || a.type === 'fumarole')) {
        return -1; // Broth pot renders after (above) campfire/fumarole
      }
      
      // ABSOLUTE SECOND CHECK: Player vs Fumarole - players ALWAYS render above fumaroles
      // Applies to both land and water (fumaroles in quarries). Must run before any Y/priority fallback.
      if (isPlayerLike(a.type) && b.type === 'fumarole') {
        return 1; // Player renders after (above) fumarole
      }
      if (isPlayerLike(b.type) && a.type === 'fumarole') {
        return -1; // Player renders after (above) fumarole
      }

      // Sleeping bag ALWAYS renders under the player - no y-sorting
      if (a.type === 'sleeping_bag' && isPlayerLike(b.type)) {
        return -1; // Sleeping bag renders before (under) player
      }
      if (isPlayerLike(a.type) && b.type === 'sleeping_bag') {
        return 1; // Player renders after (above) sleeping bag
      }

      // Buoy (variant 6) FIRST: 192px tall - pink Y-sort line moved up to buoy midpoint (matches getEntityY)
      // Player in front when south of buoy midpoint, behind when north
      const BUOY_BASE_Y_OFFSET = 28;
      const BUOY_SORT_UP_PX = 96; // pink line at midpoint (matches getEntityY for barrel variant 6)
      if (isPlayerLike(a.type) && b.type === 'barrel') {
        const barrel = b.entity as SpacetimeDBBarrel & { variant?: number };
        if ((barrel.variant ?? 0) === 6) {
          const playerCenterY = getPlayerOrSwimY(a);
          const buoySortY = barrel.posY - BUOY_BASE_Y_OFFSET - BUOY_SORT_UP_PX; // posY - 124
          return playerCenterY >= buoySortY ? 1 : -1; // Player in front when south of buoy midpoint
        }
      }
      if (a.type === 'barrel' && isPlayerLike(b.type)) {
        const barrel = a.entity as SpacetimeDBBarrel & { variant?: number };
        if ((barrel.variant ?? 0) === 6) {
          const playerCenterY = getPlayerOrSwimY(b);
          const buoySortY = barrel.posY - BUOY_BASE_Y_OFFSET - BUOY_SORT_UP_PX;
          return playerCenterY >= buoySortY ? -1 : 1; // Inverted
        }
      }
      // Sea barrels (variants 3-5 only): swimming player always above water shadows (buoy excluded - has tall top)
      const isSeaBarrelWaterShadow = (barrel: { variant?: number }) => {
        const v = barrel.variant ?? 0;
        return v >= 3 && v < 6; // 3, 4, 5 - excludes buoy (6)
      };
      if (isPlayerLike(a.type) && b.type === 'barrel') {
        const player = a.entity as SpacetimeDBPlayer;
        const barrel = b.entity as SpacetimeDBBarrel & { variant?: number };
        if (player.isOnWater && isSeaBarrelWaterShadow(barrel)) {
          return 1; // Swimming player renders on top of barrel's water shadow
        }
      }
      if (a.type === 'barrel' && isPlayerLike(b.type)) {
        const barrel = a.entity as SpacetimeDBBarrel & { variant?: number };
        const player = b.entity as SpacetimeDBPlayer;
        if (player.isOnWater && isSeaBarrelWaterShadow(barrel)) {
          return -1; // Swimming player renders on top (barrel behind)
        }
      }

      // PERFORMANCE: Fast path for type pairs that only need numeric Y-sort (no special rules)
      // Skips ~50 type checks for common pairs like (dropped_item, harvestable_resource)
      if (SIMPLE_YSORT_TYPES.has(a.type) && SIMPLE_YSORT_TYPES.has(b.type)) {
        const yDiff = a._ySortKey - b._ySortKey;
        if (Math.abs(yDiff) > 0.1) return yDiff;
        return b._priority - a._priority;
      }
      
      // THIRD CHECK: Player vs ALK Station - tall structure Y-sorting
      // This MUST be first to ensure correct rendering for large structures
      // CRITICAL: The ALK station sprite is 1024x1024 but only ~775px has actual building content
      // The top ~24% is transparent PNG. When rendered at 480px, ~115px is transparent at top.
      // The visual "foot" of the building is NOT at worldPosY - it's higher up.
      // We need a large buffer to account for: transparent sprite top (~115px) + player height (48px)
      if (isPlayerLike(a.type) && b.type === 'alk_station') {
        const playerY = getPlayerOrSwimY(a);
        const station = b.entity as SpacetimeDBAlkStation;
        // Buffer accounts for: transparent top of sprite (~115px) + player height (48px) + safety margin
        const ALK_STATION_YSORT_BUFFER = 170; // Matches collision Y offset - where building visually sits
        // Player renders in front if their feet are at or south of the building's visual base
        if (playerY >= station.worldPosY - ALK_STATION_YSORT_BUFFER) {
          return 1; // Player at/near/south of building's visual base - player in front
        }
        return -1; // Player clearly north of building - player behind (station on top)
      }
      if (a.type === 'alk_station' && isPlayerLike(b.type)) {
        const playerY = getPlayerOrSwimY(b);
        const station = a.entity as SpacetimeDBAlkStation;
        const ALK_STATION_YSORT_BUFFER = 170; // Matches collision Y offset - where building visually sits
        if (playerY >= station.worldPosY - ALK_STATION_YSORT_BUFFER) {
          return -1; // Player at/near/south of building's visual base - player in front (inverted)
        }
        return 1; // Player clearly north of building - player behind (inverted)
      }
      
      // ABSOLUTE SECOND CHECK: Player vs Compound Building - tall structure Y-sorting
      // Use 87.5% height threshold: player behind in top 87.5%, in front in bottom 12.5%
      // Monument images are squares (256x256) but actual content is in bottom portion
      // Sprite bounds: top = worldY - height + anchorYOffset, bottom = worldY + anchorYOffset
      // 87.5% threshold = worldY - (height * 0.125) + anchorYOffset (only bottom 12.5% = player in front)
      if (isPlayerLike(a.type) && b.type === 'compound_building') {
        const playerY = getPlayerOrSwimY(a);
        const building = b.entity as CompoundBuildingEntity;
        // Calculate 87.5% Y threshold for sorting (player in front only in bottom 12.5%)
        const sortThresholdY = building.worldY - (building.height * 0.125) + (building.anchorYOffset || 0);
        if (playerY >= sortThresholdY) {
          return 1; // Player in bottom 12.5% of monument - player in front
        }
        return -1; // Player in top 87.5% of monument - player behind (building on top)
      }
      if (a.type === 'compound_building' && isPlayerLike(b.type)) {
        const building = a.entity as CompoundBuildingEntity;
        const playerY = getPlayerOrSwimY(b);
        const sortThresholdY = building.worldY - (building.height * 0.125) + (building.anchorYOffset || 0);
        if (playerY >= sortThresholdY) return -1;
        return 1;
      }

      // CRITICAL: Player vs Shelter - tall structure Y-sorting (same pattern as ALK station)
      // Shelter posY is the bottom/base. Player in front only when near the bottom (south of shelter).
      // Otherwise player is underneath/behind the shelter roof.
      const SHELTER_YSORT_BUFFER = 120; // Visual foot offset - player in front when south of this threshold
      if (isPlayerLike(a.type) && b.type === 'shelter') {
        const playerY = getPlayerOrSwimY(a);
        const shelter = b.entity as SpacetimeDBShelter;
        if (playerY >= shelter.posY - SHELTER_YSORT_BUFFER) {
          return 1; // Player at/near/south of shelter's visual base - player in front
        }
        return -1; // Player north of shelter base - player behind (shelter on top)
      }
      if (a.type === 'shelter' && isPlayerLike(b.type)) {
        const playerY = getPlayerOrSwimY(b);
        const shelter = a.entity as SpacetimeDBShelter;
        if (playerY >= shelter.posY - SHELTER_YSORT_BUFFER) {
          return -1; // Player at/near/south of shelter's visual base - player in front (inverted)
        }
        return 1; // Player north of shelter base - player behind (inverted)
      }

      // Player vs Monument Doodad - ground-level campfires use generous threshold so player head doesn't clip behind stones
      // Formula: sortThresholdY = worldY - (height * fractionFromTop). fractionFromTop = distance from top as fraction of height.
      // For campfire: 0.75 = threshold at 75% from top = bottom 75% in front. For huts/drying racks: 0.25 = bottom 25% in front.
      // Drying racks (hv_drying_rack, fv_drying_rack, av_drying_rack) share same fraction for consistent y-sorting.
      if (isPlayerLike(a.type) && b.type === 'monument_doodad') {
        const playerY = getPlayerOrSwimY(a);
        const doodad = b.entity as CompoundBuildingEntity;
        const fractionFromTop = getMonumentDoodadFraction(doodad);
        const sortThresholdY = doodad.worldY - (doodad.height * fractionFromTop) + (doodad.anchorYOffset || 0);
        if (playerY >= sortThresholdY) return 1; // Player in front
        return -1; // Player behind
      }
      if (a.type === 'monument_doodad' && isPlayerLike(b.type)) {
        const doodad = a.entity as CompoundBuildingEntity;
        const playerY = getPlayerOrSwimY(b);
        const fractionFromTop = getMonumentDoodadFraction(doodad);
        const sortThresholdY = doodad.worldY - (doodad.height * fractionFromTop) + (doodad.anchorYOffset || 0);
        if (playerY >= sortThresholdY) return -1; // Player in front (inverted)
        return 1; // Player behind (inverted)
      }
      
      // Player vs Tree: force stable tree-base layering.
      // Player north of tree base renders behind; south renders in front.
      if (isPlayerLike(a.type) && b.type === 'tree') {
        const playerY = getPlayerOrSwimY(a) + PLAYER_SORT_FEET_OFFSET_PX;
        const tree = b.entity as SpacetimeDBTree;
        return playerY >= tree.posY ? 1 : -1;
      }
      if (a.type === 'tree' && isPlayerLike(b.type)) {
        const tree = a.entity as SpacetimeDBTree;
        const playerY = getPlayerOrSwimY(b) + PLAYER_SORT_FEET_OFFSET_PX;
        return playerY >= tree.posY ? -1 : 1;
      }

      // Player vs Stone: same as trees - player north of stone base renders behind top half.
      if (isPlayerLike(a.type) && b.type === 'stone') {
        const playerY = getPlayerOrSwimY(a) + PLAYER_SORT_FEET_OFFSET_PX;
        const stone = b.entity as SpacetimeDBStone;
        return playerY >= stone.posY ? 1 : -1;
      }
      if (a.type === 'stone' && isPlayerLike(b.type)) {
        const stone = a.entity as SpacetimeDBStone;
        const playerY = getPlayerOrSwimY(b) + PLAYER_SORT_FEET_OFFSET_PX;
        return playerY >= stone.posY ? -1 : 1;
      }

      // Player vs Sea Stack: tall rock - player north of base renders behind
      if (isPlayerLike(a.type) && b.type === 'sea_stack') {
        const playerY = getPlayerOrSwimY(a) + PLAYER_SORT_FEET_OFFSET_PX;
        const stack = b.entity as { posY?: number };
        return playerY >= (stack.posY ?? 0) ? 1 : -1;
      }
      if (a.type === 'sea_stack' && isPlayerLike(b.type)) {
        const stack = a.entity as { posY?: number };
        const playerY = getPlayerOrSwimY(b) + PLAYER_SORT_FEET_OFFSET_PX;
        return playerY >= (stack.posY ?? 0) ? -1 : 1;
      }

      // Player vs tall beehive (wooden_storage_box): same as trees - player north of beehive renders behind
      if (isPlayerLike(a.type) && b.type === 'wooden_storage_box') {
        const box = b.entity as SpacetimeDBWoodenStorageBox;
        if (box.boxType === BOX_TYPE_PLAYER_BEEHIVE || box.boxType === BOX_TYPE_WILD_BEEHIVE) {
          const playerY = getPlayerOrSwimY(a) + PLAYER_SORT_FEET_OFFSET_PX;
          return playerY >= box.posY ? 1 : -1;
        }
      }
      if (a.type === 'wooden_storage_box' && isPlayerLike(b.type)) {
        const box = a.entity as SpacetimeDBWoodenStorageBox;
        if (box.boxType === BOX_TYPE_PLAYER_BEEHIVE || box.boxType === BOX_TYPE_WILD_BEEHIVE) {
          const playerY = getPlayerOrSwimY(b) + PLAYER_SORT_FEET_OFFSET_PX;
          return playerY >= box.posY ? -1 : 1;
        }
      }

      // CRITICAL: Small ground entities vs tall structures - CONSISTENT sorting regardless of player position.
      // Visibility sets change with player (harvestables: 80 closest; grass: viewport). Use spatial footprint
      // so the SAME pair always sorts the same way. For monuments: entities within footprint ALWAYS render
      // BEHIND (inside/underneath) - berry bush, logs, grass at base stay hidden. Trees/stones: same.
      if (SMALL_GROUND_TYPES.has(a.type) && TALL_STRUCTURE_TYPES.has(b.type)) {
        const smallPos = getSmallGroundEntityPosition(a.entity, a.type);
        const tall = b.entity as any;
        if (b.type === 'monument_doodad' || b.type === 'compound_building') {
          if (isSmallWithinMonumentFootprint(smallPos, tall, MONUMENT_FOOTPRINT_PADDING)) {
            return -1; // Monument always on top - stuff at base stays inside/behind
          }
        } else if (isSmallNearTreeOrStone(smallPos.y, tall?.posY ?? 0)) {
          return -1; // Tree/stone in front
        }
      }
      if (TALL_STRUCTURE_TYPES.has(a.type) && SMALL_GROUND_TYPES.has(b.type)) {
        const smallPos = getSmallGroundEntityPosition(b.entity, b.type);
        const tall = a.entity as any;
        if (a.type === 'monument_doodad' || a.type === 'compound_building') {
          if (isSmallWithinMonumentFootprint(smallPos, tall, MONUMENT_FOOTPRINT_PADDING)) {
            return 1; // Monument always on top (inverted)
          }
        } else if (isSmallNearTreeOrStone(smallPos.y, tall?.posY ?? 0)) {
          return 1; // Tree/stone in front (inverted)
        }
      }
      
      // Flying birds MUST render above everything (trees, stones, players, etc.)
      // This ensures birds in flight are always visible above ground entities
      const aAnimal = a.type === 'wild_animal' ? (a.entity as SpacetimeDBWildAnimal) : null;
      const bAnimal = b.type === 'wild_animal' ? (b.entity as SpacetimeDBWildAnimal) : null;
      
      const aIsFlyingBird = aAnimal !== null && 
        (aAnimal.species.tag === 'Tern' || aAnimal.species.tag === 'Crow') &&
        aAnimal.isFlying === true;
      const bIsFlyingBird = bAnimal !== null && 
        (bAnimal.species.tag === 'Tern' || bAnimal.species.tag === 'Crow') &&
        bAnimal.isFlying === true;
      
      // Explicit checks for common ground entities that flying birds should render above
      if (aIsFlyingBird && (b.type === 'tree' || b.type === 'stone' || isPlayerLike(b.type) || b.type === 'rune_stone' || b.type === 'wild_animal')) {
        return 1; // Flying bird renders after (above) ground entity
      }
      if (bIsFlyingBird && (a.type === 'tree' || a.type === 'stone' || isPlayerLike(a.type) || a.type === 'rune_stone' || a.type === 'wild_animal')) {
        return -1; // Flying bird renders after (above) ground entity
      }
      
      // General check: flying bird vs any non-flying entity
      if (aIsFlyingBird && !bIsFlyingBird) {
        return 1; // Flying bird renders after (above) non-flying entities
      }
      if (bIsFlyingBird && !aIsFlyingBird) {
        return -1; // Flying bird renders after (above) non-flying entities
      }
      
      // NOTE: Broth pot vs campfire/fumarole check moved to ABSOLUTE FIRST CHECK at top of comparator
      // NOTE: Player vs fumarole check moved to ABSOLUTE SECOND CHECK at top of comparator
      
      // Grass vs Tree: use relative Y so north grass is behind tree, south grass is in front.
      // This prevents local conflicts with player-vs-grass and player-vs-tree near trunks.
      if (a.type === 'grass' && b.type === 'tree') {
        const grassBaseY = Number((a.entity as any)?.serverPosY ?? 0) + 5;
        const treeY = (b.entity as SpacetimeDBTree).posY;
        return grassBaseY >= treeY ? 1 : -1;
      }
      if (a.type === 'tree' && b.type === 'grass') {
        const treeY = (a.entity as SpacetimeDBTree).posY;
        const grassBaseY = Number((b.entity as any)?.serverPosY ?? 0) + 5;
        return grassBaseY >= treeY ? -1 : 1;
      }

      // Grass vs other tall structures: keep grass behind for clean layering.
      if (a.type === 'grass' && (b.type === 'stone' || b.type === 'basalt_column' || b.type === 'rune_stone' || b.type === 'sea_stack')) {
        return -1; // Grass renders before (behind) tall structure
      }
      if (b.type === 'grass' && (a.type === 'stone' || a.type === 'basalt_column' || a.type === 'rune_stone' || a.type === 'sea_stack')) {
        return 1; // Grass renders before (behind) tall structure
      }
      
      // CRITICAL: Ensure walls ALWAYS render after (above) fog overlays - THIRD CHECK
      // This MUST run early to guarantee walls are never obscured by fog
      // Walls represent the building structure and should always be visible above fog
      // Check BOTH type strings explicitly to ensure we catch all cases
      const aIsFog = a.type === 'fog_overlay';
      const bIsFog = b.type === 'fog_overlay';
      const aIsWall = a.type === 'wall_cell';
      const bIsWall = b.type === 'wall_cell';
      
      // If one is fog and the other is wall, wall ALWAYS wins (renders above)
      // Return IMMEDIATELY to prevent any other logic from interfering
      if (aIsFog && bIsWall) {
        return -1; // Fog renders before (below) wall - absolute precedence, NO EXCEPTIONS
      }
      if (bIsFog && aIsWall) {
        return 1; // Wall renders after (above) fog - absolute precedence, NO EXCEPTIONS
      }
      
      // CRITICAL: Ensure fog ALWAYS renders above players - SECOND CHECK (right after walls)
      // Players must always render below ceiling tiles/fog of war
      if (aIsFog && isPlayerLike(b.type)) {
        return 1; // Fog renders after (above) player - absolute precedence
      }
      if (bIsFog && isPlayerLike(a.type)) {
        return -1; // Fog renders after (above) player - absolute precedence
      }
      
      // CRITICAL: Ensure fog ALWAYS renders above placeables within masked building clusters - THIRD CHECK (after players)
      // This MUST run before any other logic to guarantee placeables are always hidden by fog
      // Fog must render above placeables within the same building cluster
      if (aIsFog && FOG_MASKED_PLACEABLE_TYPES.has(b.type)) {
        const fogEntity = a.entity as { clusterId: string; bounds: { minX: number; minY: number; maxX: number; maxY: number } };
        const placeable = b.entity as any;
        if (isPlaceableInFogBounds(placeable, fogEntity.bounds)) {
          return 1; // Fog renders after (above) placeable - absolute precedence
        }
      }
      
      if (bIsFog && FOG_MASKED_PLACEABLE_TYPES.has(a.type)) {
        const fogEntity = b.entity as { clusterId: string; bounds: { minX: number; minY: number; maxX: number; maxY: number } };
        const placeable = a.entity as any;
        if (isPlaceableInFogBounds(placeable, fogEntity.bounds)) {
          return -1; // Fog renders after (above) placeable - absolute precedence
        }
      }
      
      // NOTE: Broth pot vs campfire/fumarole check moved to absolute top of comparator
      
      // CRITICAL FIX: Explicitly check if a player is on the same tile as a foundation/wall
      // For foundations and east/west walls: player ALWAYS renders after (above)
      // For north/south walls: wall renders after (above) player ONLY when player is on the correct side
      if (isPlayerLike(a.type) && b.type === 'wall_cell') {
        const player = a.entity as SpacetimeDBPlayer;
        const wall = b.entity as SpacetimeDBWallCell;
        const FOUNDATION_TILE_SIZE = 96;
        const foundationTopY = wall.cellY * FOUNDATION_TILE_SIZE;
        const foundationBottomY = foundationTopY + FOUNDATION_TILE_SIZE;
        const isTriangle = wall.foundationShape >= 2 && wall.foundationShape <= 5;
        
        // For triangle foundations, always check if player is near the wall
        // Triangle walls extend beyond the foundation, so we need to check a wider area
        if (isTriangle) {
          const foundationLeftX = wall.cellX * FOUNDATION_TILE_SIZE;
          const foundationRightX = foundationLeftX + FOUNDATION_TILE_SIZE;
          const playerTileX = Math.floor(player.positionX / 48);
          const playerTileY = Math.floor(player.positionY / 48);
          const foundationTileMinX = Math.floor(foundationLeftX / 48);
          const foundationTileMaxX = Math.floor(foundationRightX / 48);
          const foundationTileMinY = Math.floor(foundationTopY / 48);
          const foundationTileMaxY = Math.floor(foundationBottomY / 48);
          
          // Check if player is on foundation tile or adjacent tiles (wider range for triangles)
          const isNearTriangleWall = playerTileX >= foundationTileMinX - 1 && 
                                     playerTileX <= foundationTileMaxX + 1 &&
                                     playerTileY >= foundationTileMinY - 1 && 
                                     playerTileY <= foundationTileMaxY + 1;
          
          if (!isNearTriangleWall) {
            // Player is too far, let normal Y-sorting handle it
            // Continue to next check
          }
        }
        
        // For triangle foundations, handle ALL edges with special logic
        if (isTriangle) {
          // Triangle walls are slanted - need direction-based sorting
          // When player is south of foundation bottom, player should be in front (render above wall)
          // When player is north of foundation bottom, wall should be in front (render above player)
          const foundationCenterY = foundationTopY + FOUNDATION_TILE_SIZE / 2;
          
          if (player.positionY > foundationBottomY) {
            // Player is clearly south - player renders above wall
            return 1; // Player renders after (above) wall
          } else if (player.positionY < foundationTopY) {
            // Player is clearly north - wall renders above player
            return -1; // Wall renders after (above) player
          } else {
            // Player is on or near foundation - use center as threshold
            if (player.positionY > foundationCenterY) {
              return 1; // Player renders after (above) wall
            } else {
              return -1; // Wall renders after (above) player
            }
          }
        } else if (wall.edge === 0) {
          // North wall: use foundation TOP as threshold - WORKING PERFECTLY
          if (player.positionY >= foundationTopY) {
            return 1; // Player renders after wall (player in front)
          } else {
            return -1; // Player renders before wall (wall in front)
          }
        } else if (wall.edge === 2) {
          // South wall: Check player's HEAD position (not feet) against foundation bottom
          // Player's head is 48px above their feet (positionY)
          // Player renders on top when their HEAD is at or below foundation bottom
          const PLAYER_SPRITE_HEIGHT = 48;
          const playerHeadY = player.positionY - PLAYER_SPRITE_HEIGHT;
          if (playerHeadY >= foundationBottomY) {
            return 1; // Player renders after wall (player in front)
          } else {
            return -1; // Player renders before wall (wall in front)
          }
        } else if (wall.edge === 1 || wall.edge === 3) {
          // East/west walls: use foundation top
          if (player.positionY >= foundationTopY) {
            return 1; // Player renders after wall (player in front)
          } else {
            return -1; // Player renders before wall (wall in front)
          }
        }
      }
      if (isPlayerLike(b.type) && a.type === 'wall_cell') {
        const player = b.entity as SpacetimeDBPlayer;
        const wall = a.entity as SpacetimeDBWallCell;
        const FOUNDATION_TILE_SIZE = 96;
        const foundationTopY = wall.cellY * FOUNDATION_TILE_SIZE;
        const foundationBottomY = foundationTopY + FOUNDATION_TILE_SIZE;
        const isTriangle = wall.foundationShape >= 2 && wall.foundationShape <= 5;
        
        // For triangle foundations, always check if player is near the wall
        if (isTriangle) {
          const foundationLeftX = wall.cellX * FOUNDATION_TILE_SIZE;
          const foundationRightX = foundationLeftX + FOUNDATION_TILE_SIZE;
          const playerTileX = Math.floor(player.positionX / 48);
          const playerTileY = Math.floor(player.positionY / 48);
          const foundationTileMinX = Math.floor(foundationLeftX / 48);
          const foundationTileMaxX = Math.floor(foundationRightX / 48);
          const foundationTileMinY = Math.floor(foundationTopY / 48);
          const foundationTileMaxY = Math.floor(foundationBottomY / 48);
          
          // Check if player is on foundation tile or adjacent tiles (wider range for triangles)
          const isNearTriangleWall = playerTileX >= foundationTileMinX - 1 && 
                                     playerTileX <= foundationTileMaxX + 1 &&
                                     playerTileY >= foundationTileMinY - 1 && 
                                     playerTileY <= foundationTileMaxY + 1;
          
          if (!isNearTriangleWall) {
            // Player is too far, let normal Y-sorting handle it
            // Continue to next check
          }
        }
        
        // For triangle foundations, handle ALL edges with special logic FIRST
        if (isTriangle) {
          // Triangle walls are slanted - need direction-based sorting
          // When player is south of foundation bottom, player should be in front (render above wall)
          // When player is north of foundation bottom, wall should be in front (render above player)
          const foundationCenterY = foundationTopY + FOUNDATION_TILE_SIZE / 2;
          
          if (player.positionY > foundationBottomY) {
            // Player is clearly south - player renders above wall
            return -1; // Player renders after (above) wall (inverted for this comparator)
          } else if (player.positionY < foundationTopY) {
            // Player is clearly north - wall renders above player
            return 1; // Wall renders after (above) player (inverted for this comparator)
          } else {
            // Player is on or near foundation - use center as threshold
            if (player.positionY > foundationCenterY) {
              return -1; // Player renders after (above) wall (inverted for this comparator)
            } else {
              return 1; // Wall renders after (above) player (inverted for this comparator)
            }
          }
        } else if (wall.edge === 0) {
          // North wall: use foundation TOP as threshold - WORKING PERFECTLY - inverted
          if (player.positionY >= foundationTopY) {
            return -1; // Player renders after wall (player in front) - inverted
          } else {
            return 1; // Player renders before wall (wall in front) - inverted
          }
        } else if (wall.edge === 2) {
          // South wall: Check player's HEAD position - inverted
          const PLAYER_SPRITE_HEIGHT = 48;
          const playerHeadY = player.positionY - PLAYER_SPRITE_HEIGHT;
          if (playerHeadY >= foundationBottomY) {
            return -1; // Player renders after wall (player in front) - inverted
          } else {
            return 1; // Player renders before wall (wall in front) - inverted
          }
        } else if (wall.edge === 1 || wall.edge === 3) {
          // East/west walls: use foundation top - inverted
          if (player.positionY >= foundationTopY) {
            return -1; // Player renders after wall (player in front) - inverted
          } else {
            return 1; // Player renders before wall (wall in front) - inverted
          }
        }
      }
      // Ensure east/west walls render above north walls (3/4 perspective)
      if (a.type === 'wall_cell' && b.type === 'wall_cell') {
        const wallA = a.entity as SpacetimeDBWallCell;
        const wallB = b.entity as SpacetimeDBWallCell;
        // If walls are on the same tile, east/west should render above north/south
        if (wallA.cellX === wallB.cellX && wallA.cellY === wallB.cellY) {
          const isA_EastWest = wallA.edge === 1 || wallA.edge === 3;
          const isB_EastWest = wallB.edge === 1 || wallB.edge === 3;
          const isA_NorthSouth = wallA.edge === 0 || wallA.edge === 2;
          const isB_NorthSouth = wallB.edge === 0 || wallB.edge === 2;
          
          // If A is east/west and B is north/south, A renders after (above)
          if (isA_EastWest && isB_NorthSouth) {
            return 1;
          }
          // If B is east/west and A is north/south, B renders after (above)
          if (isB_EastWest && isA_NorthSouth) {
            return -1;
          }
        }
      }
      
      // DOOR vs PLAYER Y-sorting
      if (isPlayerLike(a.type) && b.type === 'door') {
        const player = a.entity as SpacetimeDBPlayer;
        const door = b.entity as SpacetimeDBDoor;
        const FOUNDATION_TILE_SIZE = 96;
        const foundationTopY = door.cellY * FOUNDATION_TILE_SIZE;
        const foundationBottomY = foundationTopY + FOUNDATION_TILE_SIZE;
        
        if (door.edge === 0) {
          // North door: use foundation top - WORKING PERFECTLY
          if (player.positionY >= foundationTopY) {
            return 1; // Player renders after door (player in front)
          } else {
            return -1; // Player renders before door (door in front)
          }
        } else {
          // South door: Check player's HEAD position against foundation bottom
          const PLAYER_SPRITE_HEIGHT = 48;
          const playerHeadY = player.positionY - PLAYER_SPRITE_HEIGHT;
          if (playerHeadY >= foundationBottomY) {
            return 1; // Player renders after door (player in front)
          } else {
            return -1; // Player renders before door (door in front)
          }
        }
      }
      if (isPlayerLike(b.type) && a.type === 'door') {
        const player = b.entity as SpacetimeDBPlayer;
        const door = a.entity as SpacetimeDBDoor;
        const FOUNDATION_TILE_SIZE = 96;
        const foundationTopY = door.cellY * FOUNDATION_TILE_SIZE;
        const foundationBottomY = foundationTopY + FOUNDATION_TILE_SIZE;
        
        if (door.edge === 0) {
          // North door: use foundation top - WORKING PERFECTLY - inverted
          if (player.positionY >= foundationTopY) {
            return -1; // Player renders after door (player in front) - inverted
          } else {
            return 1; // Player renders before door (door in front) - inverted
          }
        } else {
          // South door: Check player's HEAD position - inverted
          const PLAYER_SPRITE_HEIGHT = 48;
          const playerHeadY = player.positionY - PLAYER_SPRITE_HEIGHT;
          if (playerHeadY >= foundationBottomY) {
            return -1; // Player renders after door (player in front) - inverted
          } else {
            return 1; // Player renders before door (door in front) - inverted
          }
        }
      }
      
      if (isPlayerLike(a.type) && b.type === 'foundation_cell') {
        const player = a.entity as SpacetimeDBPlayer;
        const foundation = b.entity as SpacetimeDBFoundationCell;
        if (isPlayerOnSameTileAsBuilding(player, foundation)) {
          return 1; // Player renders after (above) foundation
        }
      }
      if (isPlayerLike(b.type) && a.type === 'foundation_cell') {
        const player = b.entity as SpacetimeDBPlayer;
        const foundation = a.entity as SpacetimeDBFoundationCell;
        if (isPlayerOnSameTileAsBuilding(player, foundation)) {
          return -1; // Player renders after (above) foundation
        }
      }
      
      
      // CRITICAL FIX: Placeable objects should ALWAYS render above north walls (edge 0)
      // North walls extend upward visually, so placeables should always render on top
      // Simple rule: if it's a north wall and a placeable object, placeable always wins
      if (NORTH_WALL_PLACEABLE_TYPES.has(a.type) && b.type === 'wall_cell') {
        const wall = b.entity as SpacetimeDBWallCell;
        // For north walls (edge 0), always render placeable above
        if (wall.edge === 0) {
          return 1; // Placeable renders after (above) north wall
        }
      }
      
      if (NORTH_WALL_PLACEABLE_TYPES.has(b.type) && a.type === 'wall_cell') {
        const wall = a.entity as SpacetimeDBWallCell;
        // For north walls (edge 0), always render placeable above
        if (wall.edge === 0) {
          return -1; // Placeable renders after (above) north wall
        }
      }
      
      // SAFETY: Broth pot should render above trees and stones (redundant with early check above for campfire/fumarole)
      if (a.type === 'broth_pot' && (b.type === 'tree' || b.type === 'stone')) {
        return 1; // Pot renders after (above) tree/stone
      }
      if (b.type === 'broth_pot' && (a.type === 'tree' || a.type === 'stone')) {
        return -1; // Pot renders after (above) tree/stone
      }
      
      // SHELTER VS PLACEABLES: Shelters are tall structures that should render ABOVE ground placeables
      // when the placeable is within or near the shelter's visual footprint.
      // Without this, placeables with posY near shelter's visual base (shelter.posY - 100) would incorrectly render above.
      if (a.type === 'shelter' && SHELTER_PLACEABLE_TYPES.has(b.type)) {
        const shelter = a.entity as SpacetimeDBShelter;
        const placeable = b.entity as { posX: number; posY: number };
        // Check if placeable is within shelter's visual footprint (roughly 200px radius)
        const SHELTER_VISUAL_RADIUS = 100;
        const dx = placeable.posX - shelter.posX;
        const dy = placeable.posY - shelter.posY;
        if (dx * dx + dy * dy < SHELTER_VISUAL_RADIUS * SHELTER_VISUAL_RADIUS) {
          return 1; // Shelter renders after (above) placeable within its footprint
        }
      }
      if (b.type === 'shelter' && SHELTER_PLACEABLE_TYPES.has(a.type)) {
        const shelter = b.entity as SpacetimeDBShelter;
        const placeable = a.entity as { posX: number; posY: number };
        const SHELTER_VISUAL_RADIUS = 100;
        const dx = placeable.posX - shelter.posX;
        const dy = placeable.posY - shelter.posY;
        if (dx * dx + dy * dy < SHELTER_VISUAL_RADIUS * SHELTER_VISUAL_RADIUS) {
          return -1; // Shelter renders after (above) placeable within its footprint
        }
      }
      
      // CRITICAL: Flying birds MUST render above trees, stones, and all ground objects regardless of Y position
      // This check runs right before Y-sorting to ensure it's not overridden
      if (aIsFlyingBird && FLYING_BIRD_GROUND_TYPES.has(b.type)) {
        return 1; // Flying bird renders after (above) ground object
      }
      if (bIsFlyingBird && FLYING_BIRD_GROUND_TYPES.has(a.type)) {
        return -1; // Flying bird renders after (above) ground object
      }
      
      // PERFORMANCE OPTIMIZATION: Use pre-computed _ySortKey instead of calling getEntityY()
      // This eliminates O(n log n) function calls during sorting
      const yA = a._ySortKey;
      const yB = b._ySortKey;
      
      // CRITICAL FIX: Handle NaN values that break sorting
      if (isNaN(yA) || isNaN(yB)) {
        console.warn('[ySortedEntities] Invalid Y values detected:', { 
          typeA: a.type, yA, 
          typeB: b.type, yB,
          entityA: a.entity,
          entityB: b.entity
        });
        // Fallback: use pre-computed priority sorting if Y values are invalid
        return b._priority - a._priority;
      }
      
      // Primary sort by Y position
      // Note: Explicit check above ensures walls always render above fog regardless of Y position
      const yDiff = yA - yB;
      if (Math.abs(yDiff) > 0.1) {
        return yDiff;
      }
      
      // Secondary sort by pre-computed priority when Y positions are close
      // PERFORMANCE: Uses pre-computed _priority instead of calling getEntityPriority()
      return b._priority - a._priority;
    });
    
    // PERFORMANCE: Update cache with new sorted result
    ySortedCache.entities = allEntities;
    ySortedCache.swimmingPlayersForBottomHalf = swimmingPlayersForBottomHalf;
    ySortedCache.lastLocalPlayerTileKey = localPlayerTileKey;
    ySortedCache.lastUpdateFrame = frameCounter;
    ySortedCache.lastEntityCounts = currentEntityCounts;
    ySortedCache.lastDroppedItemsSignature = droppedItemsSignature;
    ySortedCache.lastHarvestableResourcesSignature = harvestableResourcesSignature;
    ySortedCache.lastProjectileSignature = projectileSignature;
    ySortedCache.lastFoundationMapSize = foundationCells?.size || 0;
    ySortedCache.lastWallMapSize = wallCells?.size || 0;
    ySortedCache.isDirty = false;
    
    return {
      entities: allEntities as YSortedEntityType[],
      swimmingPlayersForBottomHalf
    };
  },
    // Dependencies for cached Y-sorting
    [visiblePlayers, visibleTrees, visibleStones, visibleRuneStones, visibleCairns, visibleWoodenStorageBoxes, 
    visiblePlayerCorpses, visibleStashes, 
    visibleCampfires, visibleFurnaces, visibleLanterns, visibleDroppedItems,
    visibleProjectiles, visibleGrass,
    visibleShelters,
    visiblePlantedSeeds,
    visibleRainCollectors,
    visibleBrothPots,
    visibleWildAnimals,
    visibleAnimalCorpses,
    visibleBarrels,
    visibleRoadLampposts,
    visibleFumaroles,
    visibleBasaltColumns,
    // visibleStormPiles removed - storms now spawn HarvestableResources and DroppedItems directly
    visibleLivingCorals, // Living corals dependency (uses combat)
    visibleAlkStations, // ADDED: ALK stations dependency
    visibleStaticCompoundBuildings,
    visibleMonumentDoodads,
    visibleSeaStacks,
    visibleHarvestableResources,
    visibleFoundationCells, // ADDED: Foundations dependency
    visibleWallCells, // ADDED: Walls dependency
    visibleDoors, // ADDED: Doors dependency
    foundationCells, // CRITICAL: Depend on raw map to detect when data loads
    foundationMapSize, // CRITICAL: Depend on map size to detect when subscription data arrives
    wallCells, // CRITICAL: Depend on raw map to detect when data loads
    wallMapSize, // CRITICAL: Depend on map size to detect when subscription data arrives
    playerMapSize, // CRITICAL: Depend on player map size to detect when player data loads
    stableTimestamp, // Only include stableTimestamp for projectile calculations
    hasEntityCountChanged, // Add callback dependency
    frameCounter, // Add frame counter for cache invalidation
    buildingClusters, // ADDED: Depend on building clusters for fog overlay calculation
    playerBuildingClusterId, // ADDED: Depend on player building cluster for fog overlay calculation
    seaTransitionTileLookup, // Swimming split-render: transition tiles use full sprite
    waterTileLookup, // Swimming split-render: local player uses predicted tile water immediately
    localPlayerPredictedPosition, // Swimming Y-sort: use predicted pos for local player
    localPlayerId, // Swimming: identify local vs remote
    isLocalPlayerSnorkeling, // Swimming: snorkeling players use full sprite
  ]);

  const { entities: ySortedEntities, swimmingPlayersForBottomHalf } = ySortedMemoResult;

  // Emergency mode removed

  return {
    visibleHarvestableResources,
    visibleDroppedItems,
    visibleCampfires,
    visibleFurnaces, // ADDED: Furnaces
    visibleLanterns,
    visibleTurrets, // ADDED: Turrets (array)
    visibleHomesteadHearths, // ADDED: Homestead Hearths
    visiblePlayers,
    visibleTrees,
    visibleStones,
    visibleRuneStones,
    visibleRuneStonesMap,
    visibleCairns,
    visibleCairnsMap,
    visibleWoodenStorageBoxes,
    visibleSleepingBags,
    visiblePlayerCorpses,
    visibleStashes,
    visibleProjectiles,
    visibleHarvestableResourcesMap,
    visibleCampfiresMap,
    visibleFurnacesMap, // ADDED: Furnaces map
    visibleBarbecues, // ADDED: Barbecues
    visibleBarbecuesMap, // ADDED: Barbecues map
    visibleLanternsMap,
    visibleTurretsMap, // ADDED: Turrets map
    visibleHomesteadHearthsMap, // ADDED: Homestead Hearths map
    visibleDroppedItemsMap,
    visibleBoxesMap,
    visibleProjectilesMap,
    visiblePlayerCorpsesMap,
    visibleStashesMap,
    visibleSleepingBagsMap,
    visibleTreesMap,
    visibleStonesMap,
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
    visibleBrothPots,
    visibleBrothPotsMap,
    visibleWildAnimals,
    visibleWildAnimalsMap,
    visibleAnimalCorpses,
    visibleAnimalCorpsesMap,
    visibleBarrels,
    visibleBarrelsMap,
    visibleRoadLampposts,
    visibleRoadLamppostsMap,
    visibleFumaroles,
    visibleFumarolesMap,
    visibleBasaltColumns,
    visibleBasaltColumnsMap,
    // StormPile removed - storms now spawn HarvestableResources and DroppedItems directly
    visibleLivingCorals,
    visibleLivingCoralsMap,
    visibleSeaStacks, 
    visibleSeaStacksMap,
    visibleFoundationCells,
    visibleFoundationCellsMap,
    visibleWallCells,
    visibleWallCellsMap,
    visibleDoors, // ADDED: Building doors
    visibleDoorsMap, // ADDED: Building doors map
    visibleFences, // ADDED: Building fences
    visibleFencesMap, // ADDED: Building fences map
    buildingClusters, // ADDED: Building clusters for fog of war
    playerBuildingClusterId, // ADDED: Which building the player is in
    visibleAlkStations, // ADDED: ALK delivery stations
    visibleAlkStationsMap, // ADDED: ALK delivery stations map
    swimmingPlayersForBottomHalf, // Single source of truth for swimming bottom-half render (must match Y-sort)
  };
} 
