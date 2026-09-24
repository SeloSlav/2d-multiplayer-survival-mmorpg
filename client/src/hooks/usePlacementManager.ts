import { useState, useCallback, useRef, useEffect } from 'react';
import { DbConnection } from '../generated';
import { ItemDefinition } from '../generated/types';
import { TILE_SIZE } from '../config/gameConfig';
import { isSeedItemValid, requiresWaterPlacement, requiresBeachPlacement, requiresAlpinePlacement, requiresTundraPlacement, isPineconeBlockedOnBeach, isBirchCatkinBlockedOnAlpine, requiresTemperateOnlyPlacement } from '../utils/plantsUtils';
import { HEARTH_HEIGHT, HEARTH_RENDER_Y_OFFSET } from '../utils/renderers/hearthRenderingUtils'; // For Matron's Chest placement adjustment
import { playImmediateSound } from './useSoundSystem';
import { getPlacementConfig, snapToPlacementGrid, shouldUseGridSnapping } from '../config/placeablePlacementConfig';
import { checkPlacementOverlap } from '../utils/renderers/placementRenderingUtils';
import { getMonumentRestrictionRadiusForType } from '../utils/renderers/buildingRestrictionRulesUtils';
import { isWaterTileTag } from '../utils/tileTypeGuards';
import { getAdjacentDoorEdge, getDoorEdgeForCursor, getDoorEdgePosition, isDoorEdgeOnFoundation } from '../utils/doorPlacementGeometry';

// Minimum distance between planted seeds (in pixels)
const MIN_SEED_DISTANCE = 20;

// Cache chunk lookups per active DB connection to avoid O(n) scans on every tile query.
const chunkLookupCache = new WeakMap<DbConnection, { chunkSize: number; chunksByCoord: Map<string, any>; refreshedAt: number }>();

// Type for the information needed to start placement
export interface PlacementItemInfo {
  itemDefId: bigint;
  itemName: string;
  iconAssetName: string;
  instanceId: bigint;
}

// Type for the state managed by the hook
export interface PlacementState {
  isPlacing: boolean;
  placementInfo: PlacementItemInfo | null;
  placementError: string | null;
  placementWarning: string | null;
}

// Type for the functions returned by the hook
export interface PlacementActions {
  startPlacement: (itemInfo: PlacementItemInfo) => void;
  cancelPlacement: () => void;
  attemptPlacement: (worldX: number, worldY: number, isPlacementTooFar?: boolean) => void;
  setPlacementWarning: (warning: string | null) => void;
  clearPlacementError: () => void;
}

/**
 * Gets tile type from compressed chunk data (matching GameCanvas.tsx logic)
 * Returns tile type tag string or null if not found
 */
function getTileTypeFromChunkData(connection: DbConnection | null, tileX: number, tileY: number): string | null {
  if (!connection) return null;

  let lookup = chunkLookupCache.get(connection);
  if (!lookup) {
    const chunksByCoord = new Map<string, any>();
    let chunkSize = 8;
    for (const chunk of connection.db.world_chunk_data.iter()) {
      if (chunk.chunkSize) chunkSize = chunk.chunkSize;
      chunksByCoord.set(`${chunk.chunkX},${chunk.chunkY}`, chunk);
    }
    lookup = { chunkSize, chunksByCoord, refreshedAt: Date.now() };
    chunkLookupCache.set(connection, lookup);
  }

  // Calculate which chunk this tile belongs to (matching GameCanvas.tsx logic)
  const chunkSize = lookup.chunkSize;
  const chunkX = Math.floor(tileX / chunkSize);
  const chunkY = Math.floor(tileY / chunkSize);

  let chunk = lookup.chunksByCoord.get(`${chunkX},${chunkY}`);
  if (!chunk && Date.now() - lookup.refreshedAt > 500) {
    for (const loadedChunk of connection.db.world_chunk_data.iter()) {
      lookup.chunksByCoord.set(`${loadedChunk.chunkX},${loadedChunk.chunkY}`, loadedChunk);
    }
    lookup.refreshedAt = Date.now();
    chunk = lookup.chunksByCoord.get(`${chunkX},${chunkY}`);
  }
  if (!chunk) return null;

  // Calculate local tile position within the chunk (matching GameCanvas.tsx logic)
  const localX = tileX % chunkSize;
  const localY = tileY % chunkSize;

  // Handle negative mod (for negative tile coordinates)
  const localTileX = localX < 0 ? localX + chunkSize : localX;
  const localTileY = localY < 0 ? localY + chunkSize : localY;

  // Use chunk.chunkSize (which may differ from default) for index calculation
  const actualChunkSize = chunk.chunkSize || chunkSize;
  const tileIndex = localTileY * actualChunkSize + localTileX;

  // Check bounds and extract tile type
  if (tileIndex >= 0 && tileIndex < chunk.tileTypes.length) {
    const tileTypeU8 = chunk.tileTypes[tileIndex];
    // Convert Uint8 to tile type tag (matching server-side enum in lib.rs TileType::to_u8)
    switch (tileTypeU8) {
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
      case 12: return 'TundraGrass'; // Grassy patches in tundra biome
      case 13: return 'Tilled'; // Tilled soil for farming (uses Dirt graphics)
      case 14: return 'DeepSea';
      default: return 'Grass';
    }
  }

  return null; // No compressed data found for this position
}

/**
 * Converts world pixel coordinates to tile coordinates
 */
function worldPosToTileCoords(worldX: number, worldY: number): { tileX: number; tileY: number } {
  const TILE_SIZE = 48; // pixels per tile (matches server TILE_SIZE_PX and GameCanvas.tsx)
  const tileX = Math.floor(worldX / TILE_SIZE);
  const tileY = Math.floor(worldY / TILE_SIZE);
  return { tileX, tileY };
}

/**
 * Checks if a world position is on a water tile (Sea, DeepSea, or HotSpringWater type).
 * Uses compressed chunk data for efficient lookup.
 * Returns true if the position is on water.
 */
function isPositionOnWater(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) {
    return false; // If no connection, allow placement (fallback)
  }

  const { tileX, tileY } = worldPosToTileCoords(worldX, worldY);
  
  // Use compressed chunk data lookup
  const tileType = getTileTypeFromChunkData(connection, tileX, tileY);
  // Match all water tiles - consistent with placementRenderingUtils
  const isWater = isWaterTileTag(tileType);
  return isWater;
}

/**
 * Checks if a world position is on a beach tile (Beach type).
 * Uses compressed chunk data for efficient lookup.
 * Returns true if the position is on a beach.
 */
function isPositionOnBeach(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) {
    return false; // If no connection, allow placement (fallback)
  }

  const { tileX, tileY } = worldPosToTileCoords(worldX, worldY);
  
  // Use compressed chunk data lookup
  const tileType = getTileTypeFromChunkData(connection, tileX, tileY);
  return tileType === 'Beach';
}

/**
 * Check if a position is on alpine tiles (for alpine-restricted plants)
 */
function isPositionOnAlpine(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) {
    return false;
  }

  const { tileX, tileY } = worldPosToTileCoords(worldX, worldY);
  const tileType = getTileTypeFromChunkData(connection, tileX, tileY);
  return tileType === 'Alpine';
}

/**
 * Check if a position is on tundra tiles (for tundra-restricted plants)
 * Includes both Tundra and TundraGrass tile types
 */
function isPositionOnTundra(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) {
    return false;
  }

  const { tileX, tileY } = worldPosToTileCoords(worldX, worldY);
  const tileType = getTileTypeFromChunkData(connection, tileX, tileY);
  return tileType === 'Tundra' || tileType === 'TundraGrass';
}

function isPositionOnFoundation(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) return false;
  const FOUNDATION_TILE_SIZE = 96;
  const cellX = Math.floor(worldX / FOUNDATION_TILE_SIZE);
  const cellY = Math.floor(worldY / FOUNDATION_TILE_SIZE);
  for (const foundation of connection.db.foundation_cell.iter()) {
    if (foundation.cellX === cellX && foundation.cellY === cellY && !foundation.isDestroyed) {
      return true;
    }
  }
  return false;
}

function isFoundationOnlyPelt(itemName: string): boolean {
  return itemName === 'Wolf Pelt' ||
    itemName === 'Fox Pelt' ||
    itemName === 'Polar Bear Pelt' ||
    itemName === 'Walrus Pelt';
}

/**
 * Check if a position is on shore (land tile adjacent to water)
 * Returns true if the position is NOT on water AND has at least one adjacent water tile.
 * Used for fish trap placement validation.
 */
function isPositionOnShore(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) {
    return false;
  }

  // Must NOT be on water itself
  if (isPositionOnWater(connection, worldX, worldY)) {
    return false;
  }
  
  const { tileX, tileY } = worldPosToTileCoords(worldX, worldY);
  
  // Check 8 adjacent tiles for water
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      
      const checkTileX = tileX + dx;
      const checkTileY = tileY + dy;
      
      // Get tile type from chunk data
      const tileType = getTileTypeFromChunkData(connection, checkTileX, checkTileY);
      if (isWaterTileTag(tileType)) {
        return true; // Found adjacent water - this is a shore position
      }
    }
  }
  
  return false; // No adjacent water tiles found
}

/**
 * Check if a position is within a certain distance of shore (land adjacent to water)
 * Used for fish trap placement which can be placed in water near shore.
 * OPTIMIZED: Early exits when shore found, expands outward in rings.
 */
function isPositionNearShore(connection: DbConnection | null, worldX: number, worldY: number, maxDistancePx: number): boolean {
  if (!connection) return false;
  
  // Fast path: Check if directly on shore
  if (isPositionOnShore(connection, worldX, worldY)) {
    return true;
  }
  
  const TILE_SIZE_LOCAL = 48;
  const { tileX: centerTileX, tileY: centerTileY } = worldPosToTileCoords(worldX, worldY);
  const onWater = isPositionOnWater(connection, worldX, worldY);
  
  // Max search radius in tiles
  const maxRadiusTiles = Math.ceil(maxDistancePx / TILE_SIZE_LOCAL) + 1;
  const maxDistSq = maxDistancePx * maxDistancePx;
  
  // Expand outward in rings - find nearest tile of opposite type (water/land boundary = shore)
  for (let ring = 1; ring <= maxRadiusTiles; ring++) {
    for (let i = -ring; i <= ring; i++) {
      // Check 4 edges of the ring
      const checks = [
        { x: centerTileX + i, y: centerTileY - ring }, // Top edge
        { x: centerTileX + i, y: centerTileY + ring }, // Bottom edge
        { x: centerTileX - ring, y: centerTileY + i }, // Left edge
        { x: centerTileX + ring, y: centerTileY + i }, // Right edge
      ];
      
      for (const check of checks) {
        const tileType = getTileTypeFromChunkData(connection, check.x, check.y);
        if (tileType === null) continue;
        
        const tileIsWater = isWaterTileTag(tileType);
        
        // Found boundary (water/land transition) = shore nearby
        if (tileIsWater !== onWater) {
          // Calculate distance to this tile
          const tileCenterX = (check.x + 0.5) * TILE_SIZE_LOCAL;
          const tileCenterY = (check.y + 0.5) * TILE_SIZE_LOCAL;
          const dx = worldX - tileCenterX;
          const dy = worldY - tileCenterY;
          const distSq = dx * dx + dy * dy;
          
          if (distSq <= maxDistSq) {
            return true; // Found shore within range
          }
        }
      }
    }
    
    // Early exit if ring is beyond max distance
    const minRingDist = (ring - 1) * TILE_SIZE_LOCAL;
    if (minRingDist * minRingDist > maxDistSq) {
      break;
    }
  }
  
  return false; // No shore found within range
}

/**
 * Check if fish trap placement is blocked (not within 600px of shore)
 * Fish traps can be placed in water within 600px of shore.
 */
function isFishTrapPlacementBlocked(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) return false;
  
  const FISH_TRAP_MAX_DISTANCE_FROM_SHORE = 600.0;
  
  // Fish traps can be placed within 600px of shore
  if (!isPositionNearShore(connection, worldX, worldY, FISH_TRAP_MAX_DISTANCE_FROM_SHORE)) {
    return true; // Block if not near shore
  }
  
  return false; // Valid placement
}

/**
 * Calculates the distance to the nearest shore (non-water tile) from a water position.
 * Returns distance in pixels, or -1 if position is not on water.
 */
function calculateShoreDistance(connection: DbConnection | null, worldX: number, worldY: number): number {
  if (!connection) {
    return -1;
  }
  
  const TILE_SIZE = 48; // pixels per tile (matches server TILE_SIZE_PX and GameCanvas.tsx)
  const MAX_SEARCH_RADIUS_PIXELS = 200.0; // Matching server-side limit (20 meters = 200 pixels)
  const MAX_SEARCH_RADIUS_TILES = Math.ceil(MAX_SEARCH_RADIUS_PIXELS / TILE_SIZE); // ~5 tiles
  
  const { tileX: centerTileX, tileY: centerTileY } = worldPosToTileCoords(worldX, worldY);
  // First verify we're on water
  if (!isPositionOnWater(connection, worldX, worldY)) {
    return -1; // Not on water
  }
  
  // Search outward in concentric circles to find nearest non-water tile
  // Limit search to MAX_SEARCH_RADIUS_TILES to match server-side 500 pixel limit
  for (let radius = 1; radius <= MAX_SEARCH_RADIUS_TILES; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        // Only check tiles on the perimeter of the current radius
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        
        const checkTileX = centerTileX + dx;
        const checkTileY = centerTileY + dy;
        
        // Find this tile using compressed chunk data
        const checkTileType = getTileTypeFromChunkData(connection, checkTileX, checkTileY);
        
        // If this tile is not water, we found shore
        if (!isWaterTileTag(checkTileType)) {
          const distancePixels = radius * TILE_SIZE;
          const finalDistance = Math.min(distancePixels, MAX_SEARCH_RADIUS_PIXELS);
          // Cap at MAX_SEARCH_RADIUS_PIXELS to match server behavior
          return finalDistance;
        }
      }
    }
  }
  
  return MAX_SEARCH_RADIUS_PIXELS + 1; // Beyond max search radius
}

/**
 * Checks if Reed Rhizome placement is valid (water within 20m of shore).
 * Returns true if placement should be blocked.
 */
function isReedRhizomePlacementBlocked(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) {
    return false;
  }
  
  // Reed Rhizomes must be on water
  const isOnWater = isPositionOnWater(connection, worldX, worldY);
  if (!isOnWater) {
    return true; // Block if not on water
  }
  
  // Reed Rhizomes must be within 50m (500 pixels) of shore - MATCHING SERVER-SIDE LIMIT
  const shoreDistance = calculateShoreDistance(connection, worldX, worldY);
  const MAX_SHORE_DISTANCE = 200.0; // 50 meters = 500 pixels (matching server-side constant)
  
  if (shoreDistance < 0 || shoreDistance > MAX_SHORE_DISTANCE) {
    return true; // Block if too far from shore
  }
  return false; // Valid placement
}

/**
 * Checks if Seaweed Frond placement is valid (any water tile, no shore restriction).
 * Returns true if placement should be blocked.
 * No snorkeling required - just needs to be on water.
 */
function isSeaweedFrondPlacementBlocked(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) {
    return false;
  }
  
  // Seaweed Fronds can be planted on any water tile (no shore restriction)
  const isOnWater = isPositionOnWater(connection, worldX, worldY);
  if (!isOnWater) {
    return true; // Block if not on water
  }
  return false; // Valid placement on client side
}

/**
 * Checks if Beach Lyme Grass Seeds placement is valid (beach tiles only).
 * Returns true if placement should be blocked.
 */
function isBeachLymeGrassPlacementBlocked(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) return false;
  
  // Beach Lyme Grass Seeds must be on beach tiles
  if (!isPositionOnBeach(connection, worldX, worldY)) {
    return true; // Block if not on beach
  }
  
  return false; // Valid placement
}

/**
 * Checks if alpine plant placement is valid (alpine tiles only).
 * Used for: Arctic Poppy Seeds
 * Returns true if placement should be blocked.
 */
function isAlpinePlacementBlocked(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) return false;
  
  // Alpine plants must be on alpine tiles
  if (!isPositionOnAlpine(connection, worldX, worldY)) {
    return true; // Block if not on alpine
  }
  
  return false; // Valid placement
}

/**
 * Checks if tundra plant placement is valid (tundra tiles only).
 * Used for: Crowberry Seeds, Fireweed Seeds
 * Returns true if placement should be blocked.
 */
function isTundraPlacementBlocked(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) return false;
  
  // Tundra plants must be on tundra or tundra grass tiles
  if (!isPositionOnTundra(connection, worldX, worldY)) {
    return true; // Block if not on tundra
  }
  
  return false; // Valid placement
}

/**
 * Checks if Pinecone (conifer tree seed) placement is blocked.
 * Pinecones cannot be planted on beach tiles - conifers don't grow in sandy, salt-spray environments.
 * Returns true if placement should be blocked.
 */
function isPineconePlacementBlocked(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) return false;
  
  // Pinecones cannot be planted on beach tiles
  if (isPositionOnBeach(connection, worldX, worldY)) {
    return true; // Block if on beach
  }
  
  return false; // Valid placement
}

/**
 * Checks if Birch Catkin (deciduous tree seed) placement is blocked.
 * Birch Catkins cannot be planted on alpine tiles - deciduous trees can't grow on rocky alpine terrain.
 * Returns true if placement should be blocked.
 */
function isBirchCatkinPlacementBlocked(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) return false;
  
  // Birch Catkins cannot be planted on alpine tiles
  if (isPositionOnAlpine(connection, worldX, worldY)) {
    return true; // Block if on alpine
  }
  
  return false; // Valid placement
}

/**
 * Checks if temperate-only tree seed placement is blocked.
 * Crab Apple Seeds and Hazelnuts can only be planted on temperate tiles (grass/forest).
 * Returns true if placement should be blocked (on beach, alpine, or tundra).
 */
function isTemperatePlacementBlocked(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) return false;
  
  // Temperate-only plants cannot be on beach, alpine, or tundra tiles
  const isBeach = isPositionOnBeach(connection, worldX, worldY);
  const isAlpine = isPositionOnAlpine(connection, worldX, worldY);
  const isTundra = isPositionOnTundra(connection, worldX, worldY);
  
  if (isBeach || isAlpine || isTundra) {
    return true; // Block if on non-temperate tiles
  }
  
  return false; // Valid placement on temperate tiles (grass/forest)
}

/**
 * Checks if placement should be blocked due to water tiles or terrain restrictions.
 * This applies to shelters, camp fires, lanterns, stashes, wooden storage boxes, sleeping bags, and most seeds.
 * Reed Rhizomes have special handling and require water near shore.
 * Seaweed Fronds have special handling and require water (no shore restriction).
 * Beach Lyme Grass Seeds and Scurvy Grass Seeds have special handling and require beach tiles.
 * Pinecone (conifer) cannot be planted on beach tiles.
 * Birch Catkin (deciduous) cannot be planted on alpine tiles.
 */
function isWaterPlacementBlocked(connection: DbConnection | null, placementInfo: PlacementItemInfo | null, worldX: number, worldY: number): boolean {
  if (!connection || !placementInfo) {
    return false;
  }

  const itemNameLower = placementInfo.itemName.toLowerCase().trim();
  
  // Special case: Seaweed Frond - must be on water (no shore restriction, no snorkeling required)
  const isSeaweedItem = itemNameLower.includes('seaweed') || itemNameLower.includes('frond');
  
  if (isSeaweedItem) {
    return isSeaweedFrondPlacementBlocked(connection, worldX, worldY);
  }

  // Special case: Reed Rhizome - must be on water NEAR shore
  if (requiresWaterPlacement(placementInfo.itemName)) {
    return isReedRhizomePlacementBlocked(connection, worldX, worldY);
  }

  // Special case: Seeds that require beach placement (like Beach Lyme Grass Seeds)
  if (requiresBeachPlacement(placementInfo.itemName)) {
    return isBeachLymeGrassPlacementBlocked(connection, worldX, worldY);
  }

  // Special case: Seeds that require alpine placement (Arctic Poppy Seeds)
  if (requiresAlpinePlacement(placementInfo.itemName)) {
    return isAlpinePlacementBlocked(connection, worldX, worldY);
  }

  // Special case: Seeds that require tundra placement (Crowberry Seeds, Fireweed Seeds)
  if (requiresTundraPlacement(placementInfo.itemName)) {
    return isTundraPlacementBlocked(connection, worldX, worldY);
  }

  // Special case: Pinecone (conifer tree seed) - cannot be planted on beach tiles
  if (isPineconeBlockedOnBeach(placementInfo.itemName)) {
    if (isPineconePlacementBlocked(connection, worldX, worldY)) {
      return true;
    }
  }

  // Special case: Birch Catkin (deciduous tree seed) - cannot be planted on alpine tiles
  if (isBirchCatkinBlockedOnAlpine(placementInfo.itemName)) {
    if (isBirchCatkinPlacementBlocked(connection, worldX, worldY)) {
      return true;
    }
  }

  // Special case: Crab Apple Seeds and Hazelnuts - temperate only (grass/forest)
  if (requiresTemperateOnlyPlacement(placementInfo.itemName)) {
    if (isTemperatePlacementBlocked(connection, worldX, worldY)) {
      return true;
    }
  }

  // Special case: Fish Trap - must be placed on shore (land adjacent to water)
  if (placementInfo.itemName === 'Fish Trap') {
    return isFishTrapPlacementBlocked(connection, worldX, worldY);
  }

  // List of items that cannot be placed on water
  const waterBlockedItems = ['Camp Fire', 'Furnace', 'Barbecue', 'Lantern', 'Ancestral Ward', 'Signal Disruptor', 'Memory Resonance Beacon', 'Wooden Storage Box', 'Large Wooden Storage Box', 'Pantry', 'Compost', 'Tanning Rack', 'Scarecrow', 'Sleeping Bag', 'Stash', 'Shelter', 'Reed Rain Collector', "Matron's Chest", 'Repair Bench', 'Cooking Station', 'Wooden Beehive', "Babushka's Surprise", "Matriarch's Wrath"];
  
  // Seeds that don't require water or beach (most seeds) cannot be planted on water
  const isSeedButNotSpecialSeed = isSeedItemValid(placementInfo.itemName) && 
                                   !requiresWaterPlacement(placementInfo.itemName) && 
                                   !requiresBeachPlacement(placementInfo.itemName);
  
  if (waterBlockedItems.includes(placementInfo.itemName) || isSeedButNotSpecialSeed) {
    return isPositionOnWater(connection, worldX, worldY);
  }
  
  return false;
}

/**
 * Checks if a seed placement is blocked because there's already a seed on this tile.
 * Returns true if the placement should be blocked (one seed per tile rule).
 */
function isSeedPlacementOnOccupiedTile(connection: DbConnection | null, placementInfo: PlacementItemInfo | null, worldX: number, worldY: number): boolean {
  if (!connection || !placementInfo) return false;
  
  // Only check for seed items
  if (!isSeedItemValid(placementInfo.itemName)) return false;
  
  const TILE_SIZE_LOCAL = 48; // pixels per tile
  const targetTileX = Math.floor(worldX / TILE_SIZE_LOCAL);
  const targetTileY = Math.floor(worldY / TILE_SIZE_LOCAL);
  
  // Check if any planted seed exists on this tile
  for (const seed of connection.db.planted_seed.iter()) {
    const seedTileX = Math.floor(seed.posX / TILE_SIZE_LOCAL);
    const seedTileY = Math.floor(seed.posY / TILE_SIZE_LOCAL);
    
    if (seedTileX === targetTileX && seedTileY === targetTileY) {
      return true; // Tile is occupied
    }
  }
  
  return false; // Tile is free
}

// NOTE: Storage box collision validation is now handled server-side only
// This allows consistent behavior with other placeable items like furnaces
// The server's wooden_storage_box.rs handles all collision validation

// NOTE: isStorageBoxCollision function removed - server handles all collision validation
// This ensures consistent behavior with furnaces and other placeable items

/**
 * Checks if placement is blocked due to monument zones (ALK stations, rune stones, hot springs, quarries).
 * Returns true if placement should be blocked.
 */
function isMonumentZonePlacementBlocked(connection: DbConnection | null, worldX: number, worldY: number): boolean {
  if (!connection) {
    return false; // If no connection, allow placement (fallback)
  }

  // Check ALK stations (same logic as server-side)
  const ALK_STATION_BUILDING_RESTRICTION_MULTIPLIER_CENTRAL = 8.75;
  const ALK_STATION_BUILDING_RESTRICTION_MULTIPLIER_SUBSTATION = 3.0;
  
  for (const station of connection.db.alk_station.iter()) {
    if (!station.isActive) continue;
    
    const dx = worldX - station.worldPosX;
    const dy = worldY - station.worldPosY;
    const distanceSq = dx * dx + dy * dy;
    
    const multiplier = station.stationId === 0 
      ? ALK_STATION_BUILDING_RESTRICTION_MULTIPLIER_CENTRAL
      : ALK_STATION_BUILDING_RESTRICTION_MULTIPLIER_SUBSTATION;
    const restrictionRadius = station.interactionRadius * multiplier;
    const restrictionRadiusSq = restrictionRadius * restrictionRadius;
    
    if (distanceSq <= restrictionRadiusSq) {
      return true; // Blocked by ALK station
    }
  }
  
  // Check rune stones (800px radius)
  const MONUMENT_PLACEMENT_RESTRICTION_RADIUS = 800.0;
  const MONUMENT_PLACEMENT_RESTRICTION_RADIUS_SQ = MONUMENT_PLACEMENT_RESTRICTION_RADIUS * MONUMENT_PLACEMENT_RESTRICTION_RADIUS;
  
  for (const runeStone of connection.db.rune_stone.iter()) {
    const dx = worldX - runeStone.posX;
    const dy = worldY - runeStone.posY;
    const distanceSq = dx * dx + dy * dy;
    
    if (distanceSq <= MONUMENT_PLACEMENT_RESTRICTION_RADIUS_SQ) {
      return true; // Blocked by rune stone
    }
  }
  
  // Check hot springs and quarries (800px radius)
  // We check tiles around the position
  const TILE_SIZE = 48;
  const checkRadiusTiles = Math.ceil(MONUMENT_PLACEMENT_RESTRICTION_RADIUS / TILE_SIZE) + 1;
  const centerTileX = Math.floor(worldX / TILE_SIZE);
  const centerTileY = Math.floor(worldY / TILE_SIZE);
  
  for (let dy = -checkRadiusTiles; dy <= checkRadiusTiles; dy++) {
    for (let dx = -checkRadiusTiles; dx <= checkRadiusTiles; dx++) {
      const checkTileX = centerTileX + dx;
      const checkTileY = centerTileY + dy;
      
      const tileType = getTileTypeFromChunkData(connection, checkTileX, checkTileY);
      
      if (tileType === 'HotSpringWater' || tileType === 'Quarry') {
        const tileCenterX = checkTileX * TILE_SIZE + TILE_SIZE / 2;
        const tileCenterY = checkTileY * TILE_SIZE + TILE_SIZE / 2;
        const tdx = worldX - tileCenterX;
        const tdy = worldY - tileCenterY;
        const distanceSq = tdx * tdx + tdy * tdy;
        
        const restrictionRadius = tileType === 'Quarry' ? 400 : MONUMENT_PLACEMENT_RESTRICTION_RADIUS;
        if (distanceSq <= restrictionRadius * restrictionRadius) {
          return true; // Blocked by hot spring or quarry
        }
      }
    }
  }
  
  // Check monument parts (unified table for fishing village, shipwreck, whale bone graveyard, etc.)
  // NOTE: MonumentType is a tagged union with a `tag` property (e.g., { tag: 'FishingVillage' })
  // All monument restriction radii must match server/src/building.rs values
  for (const part of connection.db.monument_part.iter()) {
    // Only check against the center piece for the exclusion zone
    if (part.isCenter) {
      const dx = worldX - part.worldX;
      const dy = worldY - part.worldY;
      const distanceSq = dx * dx + dy * dy;
      
      const restrictionRadius = getMonumentRestrictionRadiusForType(part.monumentType?.tag);
      if (restrictionRadius > 0 && distanceSq <= restrictionRadius * restrictionRadius) {
        return true; // Blocked by monument
      }
    }
  }

  for (const marsh of connection.db.reed_marsh.iter()) {
    const dx = worldX - marsh.worldX;
    const dy = worldY - marsh.worldY;
    if (dx * dx + dy * dy <= marsh.radiusPx * marsh.radiusPx) return true;
  }
  for (const pool of connection.db.tide_pool.iter()) {
    const dx = worldX - pool.worldX;
    const dy = worldY - pool.worldY;
    if (dx * dx + dy * dy <= pool.radiusPx * pool.radiusPx) return true;
  }
  
  // Check asphalt tiles (compound areas - cannot place anything)
  const tileAtX = Math.floor(worldX / TILE_SIZE);
  const tileAtY = Math.floor(worldY / TILE_SIZE);
  const tileTypeAtPosition = getTileTypeFromChunkData(connection, tileAtX, tileAtY);
  if (tileTypeAtPosition === 'Asphalt') {
    return true; // Cannot place on asphalt/compound areas
  }
  
  return false; // Not blocked
}

export const usePlacementManager = (connection: DbConnection | null): [PlacementState, PlacementActions] => {
  const [placementInfo, setPlacementInfo] = useState<PlacementItemInfo | null>(null);
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [placementWarning, setPlacementWarning] = useState<string | null>(null);

  const isPlacing = placementInfo !== null;
  // Helper function to check if the currently placed item still exists and has quantity > 0
  const checkPlacementItemStillExists = useCallback(() => {
    if (!connection || !placementInfo) return true;
    
    // Find the item instance we're currently placing
    for (const item of connection.db.inventory_item.iter()) {
      if (BigInt(item.instanceId) === placementInfo.instanceId) {
        return item.quantity > 0;
      }
    }
    
    // Item not found, cancel placement
    return false;
  }, [connection, placementInfo]);

  // --- Start Placement --- 
  const startPlacement = useCallback((itemInfo: PlacementItemInfo) => {
    // console.log(`[PlacementManager] Starting placement for: ${itemInfo.itemName} (ID: ${itemInfo.itemDefId})`);
    setPlacementInfo(itemInfo);
    setPlacementError(null);
    setPlacementWarning(null);
  }, []);

  // --- Cancel Placement --- 
  const cancelPlacement = useCallback(() => {
    if (placementInfo) { // Only log if actually cancelling
      // console.log("[PlacementManager] Cancelling placement mode.");
      setPlacementInfo(null);
      setPlacementError(null);
      setPlacementWarning(null);
    }
  }, [placementInfo]); // Depend on placementInfo to check if cancelling is needed

  // SpacetimeDB 2.0: onX/removeOnX reducer callbacks removed. Use .then()/.catch() on reducer Promise instead.

  // Effect to auto-cancel placement when seed stack runs out
  useEffect(() => {
    if (!isPlacing || !placementInfo || !connection) return;
    
    // Only apply this logic to seeds
          // Dynamic seed detection using plant utils - no more hardcoding!
      if (!isSeedItemValid(placementInfo.itemName)) return;
    
    // Check if the item still exists by directly examining the inventory
    let itemFound = false;
    for (const item of connection.db.inventory_item.iter()) {
      if (BigInt(item.instanceId) === placementInfo.instanceId && item.quantity > 0) {
        itemFound = true;
        break;
      }
    }
    
    if (!itemFound) {
      console.log(`[PlacementManager] Seed stack empty, auto-cancelling placement for: ${placementInfo.itemName}`);
      cancelPlacement();
    }
  }, [isPlacing, placementInfo, connection, cancelPlacement, connection?.db.inventory_item]);

  // Keep placement mode synced with inventory while planting seeds.
  // This runs independently of React re-render cadence so the preview
  // disappears promptly when the final seed is consumed.
  useEffect(() => {
    if (!isPlacing || !placementInfo || !connection) return;
    if (!isSeedItemValid(placementInfo.itemName)) return;

    const intervalId = window.setInterval(() => {
      if (!checkPlacementItemStillExists()) {
        cancelPlacement();
      }
    }, 120);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isPlacing, placementInfo, connection, checkPlacementItemStillExists, cancelPlacement]);

  // --- Attempt Placement --- 
  const attemptPlacement = useCallback((worldX: number, worldY: number, isPlacementTooFar?: boolean) => {
    if (!connection || !placementInfo) {
      console.warn("[PlacementManager] Attempted placement with no connection or no item selected.");
      return;
    }

    // Check if the item still exists before attempting placement (especially important for seeds)
    if (!checkPlacementItemStillExists()) {
      console.log(`[PlacementManager] Item no longer exists, cancelling placement for: ${placementInfo.itemName}`);
      cancelPlacement();
      return;
    }

    // console.log(`[PlacementManager] Attempting to place ${placementInfo.itemName} at (${worldX}, ${worldY})`);
    setPlacementError(null); // Clear previous error

    // Snap to placement grid for items that use it (preview will match server placement exactly)
    let placeX = worldX;
    let placeY = worldY;
    if (shouldUseGridSnapping(placementInfo)) {
      const config = getPlacementConfig(placementInfo);
      if (config) {
        const snapped = snapToPlacementGrid(worldX, worldY, config);
        placeX = snapped.x;
        placeY = snapped.y;
      }
    }

    // Doors are placed at a foundation edge, not at the cursor. Validate the
    // actual target used by the reducer for both range and monument proximity.
    let doorTarget: { x: number; y: number; cellX: number; cellY: number; edge: number; shape: number } | null = null;
    if (placementInfo.itemName === 'Wood Door' || placementInfo.itemName === 'Metal Door') {
      let nearestFoundation: { cellX: number; cellY: number; shape: number } | null = null;
      let nearestDistanceSq = (96 * 1.5) ** 2;
      for (const foundation of connection.db.foundation_cell.iter()) {
        if (foundation.isDestroyed) continue;
        const centerX = foundation.cellX * 96 + 48;
        const centerY = foundation.cellY * 96 + 48;
        const distanceSq = (placeX - centerX) ** 2 + (placeY - centerY) ** 2;
        if (distanceSq < nearestDistanceSq) {
          nearestDistanceSq = distanceSq;
          nearestFoundation = foundation;
        }
      }
      if (nearestFoundation) {
        const edge = getDoorEdgeForCursor(nearestFoundation.cellX, nearestFoundation.cellY, placeX, placeY);
        const position = getDoorEdgePosition(nearestFoundation.cellX, nearestFoundation.cellY, edge);
        doorTarget = {
          ...position,
          cellX: nearestFoundation.cellX, cellY: nearestFoundation.cellY, edge, shape: nearestFoundation.shape,
        };
      }
    }

    const targetX = doorTarget?.x ?? placeX;
    const targetY = doorTarget?.y ?? placeY;
    const localIdentity = connection.identity?.toHexString();
    const localPlayer = localIdentity
      ? Array.from(connection.db.player.iter()).find(player => player.identity.toHexString() === localIdentity)
      : undefined;
    const doorIsTooFar = doorTarget && localPlayer
      ? (targetX - localPlayer.positionX) ** 2 + (targetY - localPlayer.positionY) ** 2 > 128 ** 2
      : false;
    if ((doorTarget ? doorIsTooFar : isPlacementTooFar)) {
      setPlacementError('Placement location is too far away.');
      playImmediateSound('error_placement_failed', 1.0);
      return;
    }

    // Check for overlap with existing placeables (grid-snapping items only)
    const { overlaps: isOverlapping } = checkPlacementOverlap(connection, placementInfo, placeX, placeY);
    if (isOverlapping) {
      setPlacementError('Blocked by existing structure');
      playImmediateSound('error_placement_failed', 1.0);
      return;
    }

    // Check for monument zone restriction (use snapped position for grid-snapping items)
    if (isMonumentZonePlacementBlocked(connection, targetX, targetY)) {
      setPlacementError('Too close to monument');
      // Play monument-specific error sound based on item type
      if (isSeedItemValid(placementInfo.itemName)) {
        console.log('[PlacementManager] Client-side validation: Cannot plant in protected monument zone, playing planting monument error sound');
        playImmediateSound('error_planting_monument', 1.0);
      } else {
        console.log('[PlacementManager] Client-side validation: Cannot place in protected monument zone, playing monument error sound');
        playImmediateSound('error_foundation_monument', 1.0);
      }
      return; // Don't proceed with placement
    }

    // Pelts must be placed on a foundation cell (same rule family as Matron's Chest).
    if (isFoundationOnlyPelt(placementInfo.itemName) && !isPositionOnFoundation(connection, placeX, placeY)) {
      setPlacementError('Must be placed on a foundation.');
      playImmediateSound('error_chest_placement', 1.0);
      return;
    }

    // Check for water placement restriction (use snapped position for grid-snapping items)
    if (isWaterPlacementBlocked(connection, placementInfo, placeX, placeY)) {
      if (isSeedItemValid(placementInfo.itemName)) {
        setPlacementError('Invalid location for planting');
        playImmediateSound('error_planting', 1.0);
      }
      return; // Don't proceed with placement
    }

    // Check for one-seed-per-tile restriction (e.g. reed rhizomes on top of each other)
    if (isSeedPlacementOnOccupiedTile(connection, placementInfo, placeX, placeY)) {
      setPlacementError('Blocked by existing structure');
      return; // Don't proceed with placement
    }

    // NOTE: Storage box collision check removed - server handles all collision validation
    // This ensures consistent behavior with furnaces and other placeable items

    try {
      // --- Reducer Mapping Logic --- 
      // This needs to be expanded as more placeable items are added
      switch (placementInfo.itemName) {
        case 'Camp Fire':
          connection.reducers.placeCampfire({ itemInstanceId: BigInt(placementInfo.instanceId), worldX: placeX, worldY: placeY });
          // Note: We don't call cancelPlacement here. 
          // App.tsx's handleCampfireInsert callback will call it upon success.
          break;
        case 'Furnace':
        case 'Large Furnace':
          connection.reducers.placeFurnace({ itemInstanceId: BigInt(placementInfo.instanceId), worldX: placeX, worldY: placeY });
          // Note: We don't call cancelPlacement here. 
          // App.tsx's handleFurnaceInsert callback will call it upon success.
          break;
        case 'Barbecue':
          connection.reducers.placeBarbecue({ itemInstanceId: BigInt(placementInfo.instanceId), worldX: placeX, worldY: placeY });
          // Note: We don't call cancelPlacement here. 
          // App.tsx's handleBarbecueInsert callback will call it upon success.
          break;
        case 'Lantern':
          connection.reducers.placeLantern({ itemInstanceId: BigInt(placementInfo.instanceId), worldX: placeX, worldY: placeY + 34, lanternType: 0 });
          break;
        case 'Ancestral Ward':
          connection.reducers.placeLantern({ itemInstanceId: BigInt(placementInfo.instanceId), worldX: placeX, worldY: placeY + 134, lanternType: 1 });
          break;
        case 'Signal Disruptor':
          connection.reducers.placeLantern({ itemInstanceId: BigInt(placementInfo.instanceId), worldX: placeX, worldY: placeY + 134, lanternType: 2 });
          break;
        case 'Memory Resonance Beacon':
          connection.reducers.placeLantern({ itemInstanceId: BigInt(placementInfo.instanceId), worldX: placeX, worldY: placeY + 134, lanternType: 3 });
          break;
        case 'Tallow Steam Turret':
          connection.reducers.placeTurret({ itemInstanceId: BigInt(placementInfo.instanceId), worldX: placeX, worldY: placeY });
          break;
        case 'Wooden Storage Box':
        case 'Large Wooden Storage Box':
        case 'Pantry':
        case 'Compost':
        case 'Tanning Rack':
        case 'Scarecrow':
        case 'Fish Trap':
        case 'Wooden Beehive':
        case 'Wolf Pelt':
        case 'Fox Pelt':
        case 'Polar Bear Pelt':
        case 'Walrus Pelt':
          connection.reducers.placeWoodenStorageBox({ itemInstanceId: BigInt(placementInfo.instanceId), worldX: placeX, worldY: placeY })
            .catch((err: { status?: { tag?: string; value?: string }; Failed?: string }) => {
              const status = err?.status;
              const errorMsg = status?.tag === 'Failed' && status?.value ? status.value : (err?.Failed ?? 'Failed to place item');
              const errorMsgLower = String(errorMsg).toLowerCase();
              if (errorMsgLower.includes('must be placed on a foundation')) {
                setPlacementError('Must be placed on a foundation.');
                playImmediateSound('error_chest_placement', 1.0);
                return;
              }
              if (errorMsgLower.includes('too far away')) {
                setPlacementError('Placement location is too far away.');
                playImmediateSound('error_placement_failed', 1.0);
              }
            });
          // Assume App.tsx will have a handleWoodenStorageBoxInsert similar to campfire
          break;
        case 'Sleeping Bag':
          connection.reducers.placeSleepingBag({ itemInstanceId: BigInt(placementInfo.instanceId), worldX: placeX, worldY: placeY });
          // Assume App.tsx needs a handleSleepingBagInsert callback to cancel placement on success
          break;
        case 'Stash':
          connection.reducers.placeStash({ itemInstanceId: BigInt(placementInfo.instanceId), worldX: placeX, worldY: placeY });
          // Assume App.tsx will need a handleStashInsert callback to cancel placement on success
          break;
        case "Babushka's Surprise":
        case "Matriarch's Wrath":
          connection.reducers.placeExplosive({ itemInstanceId: BigInt(placementInfo.instanceId), worldX: placeX, worldY: placeY });
          break;
        case 'Shelter':
          connection.reducers.placeShelter({ itemInstanceId: BigInt(placementInfo.instanceId), worldX: placeX, worldY: placeY });
          // Assume App.tsx will need a handleShelterInsert callback (added in useSpacetimeTables)
          // which should call cancelPlacement on success.
          break;
        case 'Reed Rain Collector':
          connection.reducers.placeRainCollector({ itemInstanceId: BigInt(placementInfo.instanceId), worldX: placeX, worldY: placeY });
          // Assume App.tsx will need a handleRainCollectorInsert callback to cancel placement on success
          break;
        case 'Repair Bench':
          connection.reducers.placeRepairBench({ itemInstanceId: BigInt(placementInfo.instanceId), posX: placeX, posY: placeY });
          // Placement will be cancelled when the WoodenStorageBox (boxType=5) is inserted
          break;
        case 'Cooking Station':
          connection.reducers.placeCookingStation({ itemInstanceId: BigInt(placementInfo.instanceId), posX: placeX, posY: placeY });
          // Placement will be cancelled when the WoodenStorageBox (boxType=6) is inserted
          break;
        case "Matron's Chest": {
          const adjustedHearthY = placeY + HEARTH_HEIGHT / 2 + HEARTH_RENDER_Y_OFFSET;
          connection.reducers.placeHomesteadHearth({ itemInstanceId: BigInt(placementInfo.instanceId), worldX: placeX, worldY: adjustedHearthY })
            .catch((err: { status?: { tag?: string; value?: string }; Failed?: string }) => {
              const status = err?.status;
              const errorMsg = status?.tag === 'Failed' && status?.value ? status.value : (err?.Failed ?? 'Failed to place Matron\'s Chest');
              const errorMsgLower = String(errorMsg).toLowerCase();
              if (errorMsgLower.includes('must be placed on a foundation') || errorMsgLower.includes('cannot place matron\'s chest') || errorMsgLower.includes('too far away')) {
                playImmediateSound('error_chest_placement', 1.0);
              }
            });
          break;
        }
        case 'Cerametal Field Cauldron Mk. II':
          // Find nearest heat source (campfire or fumarole) to snap to
          let nearestHeatSource: any = null;
          let nearestDistance = Infinity;
          let heatSourceType: 'campfire' | 'fumarole' | null = null;
          const HEAT_SOURCE_SNAP_DISTANCE = 200; // Maximum distance to snap to heat source (increased for easier placement)
          
          // Check campfires
          for (const campfire of connection.db.campfire.iter()) {
            const dx = worldX - campfire.posX;
            const dy = worldY - campfire.posY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < nearestDistance && distance < HEAT_SOURCE_SNAP_DISTANCE) {
              nearestDistance = distance;
              nearestHeatSource = campfire;
              heatSourceType = 'campfire';
            }
          }
          
          // Check fumaroles (always-on heat sources)
          for (const fumarole of connection.db.fumarole.iter()) {
            const dx = worldX - fumarole.posX;
            const dy = worldY - fumarole.posY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < nearestDistance && distance < HEAT_SOURCE_SNAP_DISTANCE) {
              nearestDistance = distance;
              nearestHeatSource = fumarole;
              heatSourceType = 'fumarole';
            }
          }
          
          if (nearestHeatSource && heatSourceType) {
            if (heatSourceType === 'campfire') {
              // Check if campfire already has a broth pot
              if (nearestHeatSource.attachedBrothPotId !== null && nearestHeatSource.attachedBrothPotId !== undefined) {
                console.log('[PlacementManager] Campfire already has a broth pot attached');
                setPlacementError('Campfire already has a Field Cauldron');
                playImmediateSound('error_field_cauldron_placement', 1.0);
                return;
              }
              
              console.log(`[PlacementManager] Placing broth pot on campfire ${nearestHeatSource.id}`);
              connection.reducers.placeBrothPotOnCampfire({ itemInstanceId: BigInt(placementInfo.instanceId), campfireId: nearestHeatSource.id });
            } else if (heatSourceType === 'fumarole') {
              // Check if fumarole already has a broth pot
              const existingPotOnFumarole = Array.from(connection.db.broth_pot.iter()).find(
                pot => pot.attachedToFumaroleId === nearestHeatSource.id && !pot.isDestroyed
              );
              
              if (existingPotOnFumarole) {
                console.log('[PlacementManager] Fumarole already has a broth pot attached');
                setPlacementError('Fumarole already has a Field Cauldron');
                playImmediateSound('error_field_cauldron_placement', 1.0);
                return;
              }
              
              console.log(`[PlacementManager] Placing broth pot on fumarole ${nearestHeatSource.id} [ALWAYS-ON HEAT]`);
              connection.reducers.placeBrothPotOnFumarole({ itemInstanceId: BigInt(placementInfo.instanceId), fumaroleId: nearestHeatSource.id });
            }
          } else {
            console.log('[PlacementManager] No heat source (campfire or fumarole) nearby to place broth pot');
            setPlacementError('Place on a campfire or fumarole');
            playImmediateSound('error_field_cauldron_placement', 1.0);
          }
          break;
        case 'Wood Door':
        case 'Metal Door': {
          if (!doorTarget) {
            console.log('[PlacementManager] No foundation nearby for door placement');
            playImmediateSound('error_chest_placement', 1.0);
            return;
          }
          const { cellX, cellY, edge, shape } = doorTarget;
          if (!isDoorEdgeOnFoundation(shape, edge)) {
            setPlacementError('No foundation edge here for a door');
            playImmediateSound('error_chest_placement', 1.0);
            return;
          }
          
          // Check for existing wall or door on this edge
          let hasWallOnEdge = false;
          let hasDoorOnEdge = false;
          
          for (const wall of connection.db.wall_cell.iter()) {
            if (wall.cellX === cellX &&
                wall.cellY === cellY &&
                wall.edge === edge && 
                !wall.isDestroyed) {
              hasWallOnEdge = true;
              break;
            }
          }
          
          for (const door of connection.db.door.iter()) {
            if (door.cellX === cellX &&
                door.cellY === cellY &&
                door.edge === edge &&
                !door.isDestroyed) {
              hasDoorOnEdge = true;
              break;
            }
          }

          const adjacent = getAdjacentDoorEdge(cellX, cellY, edge);
          for (const wall of connection.db.wall_cell.iter()) {
            if (wall.cellX === adjacent.cellX && wall.cellY === adjacent.cellY &&
                wall.edge === adjacent.edge && !wall.isDestroyed) hasWallOnEdge = true;
          }
          for (const door of connection.db.door.iter()) {
            if (door.cellX === adjacent.cellX && door.cellY === adjacent.cellY &&
                door.edge === adjacent.edge && !door.isDestroyed) hasDoorOnEdge = true;
          }
          
          if (hasWallOnEdge || hasDoorOnEdge) {
            setPlacementError('A wall or door already occupies this edge');
            playImmediateSound('error_chest_placement', 1.0);
            return;
          }
          
          // Determine door type (0 = Wood, 1 = Metal)
          const doorType = placementInfo.itemName === 'Wood Door' ? 0 : 1;
          
          console.log(`[PlacementManager] Placing ${placementInfo.itemName} on foundation (${cellX}, ${cellY}) edge ${edge}`);
          connection.reducers.placeDoor({
            cellX: BigInt(cellX),
            cellY: BigInt(cellY),
            worldX: placeX,
            worldY: placeY,
            doorType,
          });
          break;
        }
        default:
          // Check if it's a plantable seed using dynamic detection
          if (isSeedItemValid(placementInfo.itemName)) {
            console.log(`[PlacementManager] Calling plantSeed reducer with instance ID: ${placementInfo.instanceId}`);
            connection.reducers.plantSeed({ itemInstanceId: BigInt(placementInfo.instanceId), plantPosX: placeX, plantPosY: placeY })
              .catch((err: { status?: { tag?: string; value?: string }; Failed?: string }) => {
                const status = err?.status;
                const errorMsg = status?.tag === 'Failed' && status?.value ? status.value : (err?.Failed ?? 'Failed to plant seed');
                const errorMsgLower = String(errorMsg).toLowerCase();
                if (errorMsgLower.includes('can only be planted') || errorMsgLower.includes('cannot be planted on water') || errorMsgLower.includes('must be planted')) {
                  playImmediateSound('error_planting', 1.0);
                }
              });
            // Note: Don't auto-cancel placement for seeds - let the system check if there are more seeds
          } else {
            console.error(`[PlacementManager] Unknown item type for placement: ${placementInfo.itemName}`);
            setPlacementError(`Cannot place item: Unknown type '${placementInfo.itemName}'.`);
            // Optionally call cancelPlacement here if placement is impossible?
            // cancelPlacement(); 
          }
          break;
      }
    } catch (err: any) {
      console.error('[PlacementManager] Failed to call placement reducer (client-side error):', err);
      const errorMessage = err?.message || "Failed to place item. Check logs.";
      // Set error state managed by the hook
      setPlacementError(`Placement failed: ${errorMessage}`); 
      // Do NOT cancel placement on error, let user retry or cancel manually
    }
  }, [connection, placementInfo, checkPlacementItemStillExists, cancelPlacement]); // Dependencies

  // Clear placement error when user moves to a valid location (allows preview to turn blue again)
  const clearPlacementError = useCallback(() => {
    setPlacementError(null);
  }, []);

  // Consolidate state and actions for return
  const placementState: PlacementState = { isPlacing, placementInfo, placementError, placementWarning };
  const placementActions: PlacementActions = { startPlacement, cancelPlacement, attemptPlacement, setPlacementWarning, clearPlacementError };

  return [placementState, placementActions];
};
