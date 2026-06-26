import { PlacementItemInfo } from '../../hooks/usePlacementManager';
import { BuildingPlacementState, BuildingMode } from '../../engine/runtime/buildingPlacementRuntime';
// Import dimensions directly from their respective rendering utility files
import { CAMPFIRE_WIDTH_PREVIEW, CAMPFIRE_HEIGHT_PREVIEW } from './campfireRenderingUtils';
import { FURNACE_WIDTH_PREVIEW, FURNACE_HEIGHT_PREVIEW, LARGE_FURNACE_WIDTH, LARGE_FURNACE_HEIGHT } from './furnaceRenderingUtils'; // ADDED: Furnace dimensions
import { BARBECUE_WIDTH_PREVIEW, BARBECUE_HEIGHT_PREVIEW } from './barbecueRenderingUtils'; // ADDED: Barbecue dimensions
import { ENTITY_VISUAL_CONFIG, getPlacementPreviewPosition } from '../entityVisualConfig'; // Centralized visual config
import { 
    LANTERN_WIDTH_PREVIEW, LANTERN_HEIGHT_PREVIEW,
    ANCESTRAL_WARD_WIDTH, ANCESTRAL_WARD_HEIGHT,
    SIGNAL_DISRUPTOR_WIDTH, SIGNAL_DISRUPTOR_HEIGHT,
    MEMORY_BEACON_WIDTH, MEMORY_BEACON_HEIGHT
} from './lanternRenderingUtils';
import { TURRET_WIDTH_PREVIEW, TURRET_HEIGHT_PREVIEW } from './turretRenderingUtils';
import { SLEEPING_BAG_WIDTH, SLEEPING_BAG_HEIGHT } from './sleepingBagRenderingUtils';
import { STASH_WIDTH, STASH_HEIGHT } from './stashRenderingUtils';
import { SHELTER_RENDER_WIDTH, SHELTER_RENDER_HEIGHT } from './shelterRenderingUtils';
import { HEARTH_WIDTH, HEARTH_HEIGHT, HEARTH_RENDER_Y_OFFSET } from './hearthRenderingUtils'; // ADDED: Hearth dimensions
import { COMPOST_WIDTH, COMPOST_HEIGHT, REFRIGERATOR_WIDTH, REFRIGERATOR_HEIGHT, LARGE_BOX_WIDTH, LARGE_BOX_HEIGHT, REPAIR_BENCH_WIDTH, REPAIR_BENCH_HEIGHT, COOKING_STATION_WIDTH, COOKING_STATION_HEIGHT, PLAYER_BEEHIVE_WIDTH, PLAYER_BEEHIVE_HEIGHT, SCARECROW_WIDTH, SCARECROW_HEIGHT } from './woodenStorageBoxRenderingUtils'; // ADDED: Compost, Refrigerator, Large Box, Repair Bench, Cooking Station, Scarecrow, and Beehive dimensions
import { TILE_SIZE, FOUNDATION_TILE_SIZE, worldPixelsToFoundationCell, foundationCellToWorldCenter } from '../../config/gameConfig';
import { getPlacementConfig, snapToPlacementGrid, shouldUseGridSnapping, getPlacementSquareBounds, getBoxTypePlacementConfig, type PlaceablePlacementConfig } from '../../config/placeablePlacementConfig';
import { DbConnection } from '../../generated';
import { isSeedItemValid, requiresWaterPlacement, requiresBeachPlacement, requiresAlpinePlacement, requiresTundraPlacement, isPineconeBlockedOnBeach, isBirchCatkinBlockedOnAlpine, requiresTemperateOnlyPlacement } from '../plantsUtils';
import { renderFoundationPreview, renderWallPreview, renderFencePreview } from './foundationRenderingUtils';
import { isWaterTileTag } from '../tileTypeGuards';

// Import interaction distance constants
const PLAYER_BOX_INTERACTION_DISTANCE_SQUARED = 80.0 * 80.0; // Mirrors interaction target runtime.
const SHELTER_PLACEMENT_MAX_DISTANCE = 256.0;

// Minimum distance between planted seeds (in pixels) - should match usePlacementManager.ts
const MIN_SEED_DISTANCE = 20;

interface RenderPlacementPreviewParams {
    ctx: CanvasRenderingContext2D;
    placementInfo: PlacementItemInfo | null;
    buildingState: BuildingPlacementState | null; // NEW: Building placement state
    itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
    doodadImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
    shelterImageRef?: React.RefObject<HTMLImageElement | null>;
    worldMouseX: number | null;
    worldMouseY: number | null;
    isPlacementTooFar: boolean;
    placementError: string | null;
    onClearPlacementError?: () => void; // Called when cursor moves to valid position so preview can turn blue again
    connection: DbConnection | null;
    worldScale: number; // NEW: World scale for building previews
    viewOffsetX: number; // NEW: View offset for building previews
    viewOffsetY: number; // NEW: View offset for building previews
    localPlayerX: number; // NEW: Player position for validation
    localPlayerY: number; // NEW: Player position for validation
    inventoryItems?: Map<string, any>; // NEW: Inventory items for resource checking
    itemDefinitions?: Map<string, any>; // NEW: Item definitions for resource checking
    foundationTileImagesRef?: React.RefObject<Map<string, HTMLImageElement>>; // ADDED: Foundation tile images
}

/**
 * Converts world pixel coordinates to tile coordinates
 */
export function worldPosToTileCoords(worldX: number, worldY: number): { tileX: number; tileY: number } {
    const TILE_SIZE = 48; // pixels per tile (matches server TILE_SIZE_PX and GameCanvas.tsx)
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    return { tileX, tileY };
}

/** World position to tile key string (e.g. for water/shadow lookups). */
export function worldPosToTileKey(worldX: number, worldY: number): string {
    const { tileX, tileY } = worldPosToTileCoords(worldX, worldY);
    return `${tileX},${tileY}`;
}

// PERFORMANCE FIX: Cache for chunk data lookups to avoid O(n) iteration on every tile check
// This dramatically improves building placement preview performance
const chunkCache: Map<string, { chunkSize: number; tileTypes: Uint8Array }> = new Map();
let cachedChunkSize = 8; // Default chunk size, updated when first chunk is seen
let lastConnectionIdentity: string | null = null; // Track connection changes to invalidate cache

// PERFORMANCE FIX: Spatial index for foundations - O(1) cell lookup instead of O(n) iteration
// Key: "cellX,cellY", Value: array of foundations at that cell
const foundationSpatialIndex: Map<string, Array<{ shape: number; isDestroyed: boolean }>> = new Map();
let foundationIndexVersion = 0;
let lastFoundationCount = 0;

// PERFORMANCE FIX: Spatial hash for grass - quick area checks
// Key: "tileX,tileY" (at 96px granularity, same as foundation cells)
const grassSpatialHash: Map<string, boolean> = new Map();
let grassHashVersion = 0;
let lastGrassCount = 0;

// PERFORMANCE: Seed occupancy index (rebuilt at a short interval).
const plantedSeedTileIndex: Set<string> = new Set();
let lastSeedIndexRefreshMs = 0;
const SEED_INDEX_REFRESH_MS = 250;

// PERFORMANCE: Cache monument-zone validation per tile for preview path.
const monumentZoneTileCache: Map<string, { blocked: boolean; timestamp: number }> = new Map();
const MONUMENT_ZONE_CACHE_TTL_MS = 120;

/**
 * Rebuilds foundation spatial index for O(1) cell lookups
 */
function rebuildFoundationIndex(connection: DbConnection): void {
    foundationSpatialIndex.clear();
    let count = 0;
    for (const foundation of connection.db.foundation_cell.iter()) {
        count++;
        const key = `${foundation.cellX},${foundation.cellY}`;
        let arr = foundationSpatialIndex.get(key);
        if (!arr) {
            arr = [];
            foundationSpatialIndex.set(key, arr);
        }
        arr.push({ shape: foundation.shape as number, isDestroyed: foundation.isDestroyed });
    }
    lastFoundationCount = count;
    foundationIndexVersion++;
}

/**
 * Rebuilds grass spatial hash for quick area checks
 */
function rebuildGrassSpatialHash(connection: DbConnection): void {
    grassSpatialHash.clear();
    let count = 0;
    const FOUNDATION_SIZE = 96;
    // With split tables: grass (static pos) + grassState (is_alive)
    for (const grass of connection.db.grass.iter()) {
        count++;
        // Look up is_alive from grassState table
        const grassState = connection.db.grass_state.grassId.find(grass.id);
        const isAlive = grassState?.isAlive ?? false;
        if (isAlive) {
            // Hash to foundation cell coordinates
            const cellX = Math.floor(grass.posX / FOUNDATION_SIZE);
            const cellY = Math.floor(grass.posY / FOUNDATION_SIZE);
            // Also add to adjacent cells for edge cases
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    grassSpatialHash.set(`${cellX + dx},${cellY + dy}`, true);
                }
            }
        }
    }
    lastGrassCount = count;
    grassHashVersion++;
}

/**
 * Rebuild tile occupancy index for planted seeds.
 * This replaces per-frame full iteration for one-seed-per-tile preview checks.
 */
function rebuildPlantedSeedTileIndex(connection: DbConnection): void {
    plantedSeedTileIndex.clear();
    const TILE_SIZE_LOCAL = 48;
    for (const seed of connection.db.planted_seed.iter()) {
        const tileX = Math.floor(seed.posX / TILE_SIZE_LOCAL);
        const tileY = Math.floor(seed.posY / TILE_SIZE_LOCAL);
        plantedSeedTileIndex.add(`${tileX},${tileY}`);
    }
    lastSeedIndexRefreshMs = Date.now();
}

/**
 * Rebuilds the chunk cache from the database
 * Called when connection changes or cache needs refreshing
 */
function rebuildChunkCache(connection: DbConnection): void {
    chunkCache.clear();
    
    for (const chunk of connection.db.world_chunk_data.iter()) {
        if (chunk.chunkSize && cachedChunkSize !== chunk.chunkSize) {
            cachedChunkSize = chunk.chunkSize;
        }
        const key = `${chunk.chunkX},${chunk.chunkY}`;
        chunkCache.set(key, {
            chunkSize: chunk.chunkSize || 8,
            tileTypes: chunk.tileTypes
        });
    }
}

/**
 * Gets tile type from compressed chunk data (matching GameCanvas.tsx logic)
 * Returns tile type tag string or null if not found
 * 
 * PERFORMANCE FIX: Now uses cached chunk lookup instead of iterating all chunks
 * This reduces tile lookup from O(n_chunks) to O(1) per tile
 */
export function getTileTypeFromChunkData(connection: DbConnection | null, tileX: number, tileY: number): string | null {
    if (!connection) return null;
    
    // PERFORMANCE FIX: Check if we need to rebuild the cache (connection changed)
    const currentIdentity = connection.identity?.toHexString() || 'unknown';
    if (lastConnectionIdentity !== currentIdentity || chunkCache.size === 0) {
        lastConnectionIdentity = currentIdentity;
        rebuildChunkCache(connection);
    }
    
    // Calculate which chunk this tile belongs to
    const chunkX = Math.floor(tileX / cachedChunkSize);
    const chunkY = Math.floor(tileY / cachedChunkSize);
    
    // PERFORMANCE FIX: O(1) lookup instead of O(n) iteration
    const chunkKey = `${chunkX},${chunkY}`;
    const cachedChunk = chunkCache.get(chunkKey);
    
    if (!cachedChunk) {
        return null; // Chunk not in cache
    }
    
    // Calculate local tile position within the chunk
    const localX = tileX % cachedChunkSize;
    const localY = tileY % cachedChunkSize;
    
    // Handle negative mod (for negative tile coordinates)
    const localTileX = localX < 0 ? localX + cachedChunkSize : localX;
    const localTileY = localY < 0 ? localY + cachedChunkSize : localY;
    
    const tileIndex = localTileY * cachedChunk.chunkSize + localTileX;
    
    // Check bounds and extract tile type
    if (tileIndex >= 0 && tileIndex < cachedChunk.tileTypes.length) {
        const tileTypeU8 = cachedChunk.tileTypes[tileIndex];
        // Convert Uint8 to tile type tag (matching server-side enum in lib.rs TileType::to_u8)
        switch (tileTypeU8) {
            case 0: return 'Grass';
            case 1: return 'Dirt';
            case 2: return 'DirtRoad';
            case 3: return 'Sea';
            case 4: return 'Beach';
            case 5: return 'Sand';
            case 6: return 'HotSpringWater'; // Hot spring water pools
            case 7: return 'Quarry'; // Quarry tiles (rocky gray-brown)
            case 8: return 'Asphalt'; // Paved compound areas
            case 9: return 'Forest'; // Dense forested areas
            case 10: return 'Tundra'; // Arctic tundra (northern regions)
            case 11: return 'Alpine'; // High-altitude rocky terrain
            case 12: return 'TundraGrass'; // Grassy patches in tundra biome
            case 13: return 'Tilled'; // Tilled soil for farming (uses Dirt graphics)
            case 14: return 'DeepSea'; // Outer ring - empty deep ocean
            default: return 'Grass';
        }
    }
    return null;
}

/**
 * Call this to invalidate the chunk cache (e.g., when chunks are updated)
 */
export function invalidateChunkCache(): void {
    chunkCache.clear();
}

/**
 * Checks if a world position is on a water tile.
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
    return isWaterTileTag(tileType);
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
    
    const TILE_SIZE_LOCAL = 48;
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
    if (!connection) return -1;
    
    const TILE_SIZE = 48; // pixels per tile (matches server TILE_SIZE_PX and GameCanvas.tsx)
    const MAX_SEARCH_RADIUS_PIXELS = 200.0; // Matching server-side limit (20 meters = 200 pixels)
    const MAX_SEARCH_RADIUS_TILES = Math.ceil(MAX_SEARCH_RADIUS_PIXELS / TILE_SIZE); // ~5 tiles
    
    const { tileX: centerTileX, tileY: centerTileY } = worldPosToTileCoords(worldX, worldY);
    
    // First verify we're on water
    if (!isPositionOnWater(connection, worldX, worldY)) {
        return -1; // Not on water
    }
    
    // Search outward in concentric circles to find nearest non-water tile
    // Limit search to MAX_SEARCH_RADIUS_TILES to match server-side 200 pixel limit
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
                    // Cap at MAX_SEARCH_RADIUS_PIXELS to match server behavior
                    return Math.min(distancePixels, MAX_SEARCH_RADIUS_PIXELS);
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
    if (!connection) return false;
    
    // Reed Rhizomes must be on water
    if (!isPositionOnWater(connection, worldX, worldY)) {
        return true; // Block if not on water
    }
    
    // Reed Rhizomes must be within 50m (500 pixels) of shore - MATCHING SERVER-SIDE LIMIT
    const shoreDistance = calculateShoreDistance(connection, worldX, worldY);
    const MAX_SHORE_DISTANCE = 500.0; // 50 meters = 500 pixels (matching server-side constant)
    
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
    if (!connection) return false;
    
    // Seaweed Fronds must be on water (any water tile - no shore restriction, no snorkeling required)
    if (!isPositionOnWater(connection, worldX, worldY)) {
        return true; // Block if not on water
    }
    
    return false; // Valid placement on water tile
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
 * Checks if an alpine plant placement is blocked (not on alpine tiles)
 * Used for: Arctic Poppy Seeds
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
 * Checks if a tundra plant placement is blocked (not on tundra tiles)
 * Used for: Crowberry Seeds, Fireweed Seeds
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
 * Checks if a temperate-only plant placement is blocked (on beach, alpine, or tundra tiles)
 * Used for: Crab Apple Seeds, Hazelnuts (fruit/nut trees that only grow in temperate climates)
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
 * Pinecone (conifer tree seed) cannot be planted on beach tiles.
 * Birch Catkin (deciduous tree seed) cannot be planted on alpine tiles.
 */
function isWaterPlacementBlocked(connection: DbConnection | null, placementInfo: PlacementItemInfo | null, worldX: number, worldY: number): boolean {
    if (!connection || !placementInfo) {
        return false;
    }

    const itemNameLower = placementInfo.itemName.toLowerCase().trim();

    // Special case: Seaweed Frond - must be on water (no shore restriction, no snorkeling required)
    // Match both "seaweed" and "frond" to handle "Seaweed Frond" item
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
        if (isPositionOnBeach(connection, worldX, worldY)) {
            return true; // Block Pinecone on beach
        }
    }

    // Special case: Birch Catkin (deciduous tree seed) - cannot be planted on alpine tiles
    if (isBirchCatkinBlockedOnAlpine(placementInfo.itemName)) {
        if (isPositionOnAlpine(connection, worldX, worldY)) {
            return true; // Block Birch Catkin on alpine
        }
    }

    // Special case: Crab Apple Seeds and Hazelnuts - temperate only (not beach, alpine, or tundra)
    if (requiresTemperateOnlyPlacement(placementInfo.itemName)) {
        if (isTemperatePlacementBlocked(connection, worldX, worldY)) {
            return true; // Block fruit/nut tree seeds on non-temperate tiles
        }
    }

    // Special case: Fish Trap - must be placed on shore (land adjacent to water)
    if (placementInfo.itemName === 'Fish Trap') {
        return isFishTrapPlacementBlocked(connection, worldX, worldY);
    }

    // List of items that cannot be placed on water
    const waterBlockedItems = ['Camp Fire', 'Furnace', 'Large Furnace', 'Barbecue', 'Lantern', 'Ancestral Ward', 'Signal Disruptor', 'Memory Resonance Beacon', 'Tallow Steam Turret', 'Wooden Storage Box', 'Large Wooden Storage Box', 'Pantry', 'Compost', 'Tanning Rack', 'Scarecrow', 'Sleeping Bag', 'Stash', 'Shelter', 'Reed Rain Collector', 'Repair Bench', 'Cooking Station', "Babushka's Surprise", "Matriarch's Wrath", 'Wooden Beehive'];
    
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
    
    const TILE_SIZE = 48; // pixels per tile
    const targetTileX = Math.floor(worldX / TILE_SIZE);
    const targetTileY = Math.floor(worldY / TILE_SIZE);
    
    if (Date.now() - lastSeedIndexRefreshMs > SEED_INDEX_REFRESH_MS) {
        rebuildPlantedSeedTileIndex(connection);
    }

    return plantedSeedTileIndex.has(`${targetTileX},${targetTileY}`);
}

// NOTE: Client-side storage box collision validation removed
// Server handles all collision validation consistently for all placeable items (furnaces, beehives, etc.)
// This ensures players can place items as close as the server's collision radii allow

/**
 * Checks if a world position is within a monument zone (ALK stations, rune stones, hot springs, quarries)
 * Returns true if the position is blocked due to monument proximity
 * This matches the server-side check_monument_zone_placement logic for consistent preview coloring
 */
function isPositionInMonumentZone(
    connection: DbConnection | null,
    worldX: number,
    worldY: number
): boolean {
    if (!connection) return false;

    const TILE_SIZE_LOCAL = 48;
    const tileX = Math.floor(worldX / TILE_SIZE_LOCAL);
    const tileY = Math.floor(worldY / TILE_SIZE_LOCAL);
    const cacheKey = `${tileX},${tileY}`;
    const cached = monumentZoneTileCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < MONUMENT_ZONE_CACHE_TTL_MS) {
        return cached.blocked;
    }
    
    const MONUMENT_RESTRICTION_RADIUS = 800.0; // For hot springs and rune stones
    const MONUMENT_RESTRICTION_RADIUS_SQ = MONUMENT_RESTRICTION_RADIUS * MONUMENT_RESTRICTION_RADIUS;
    const QUARRY_RESTRICTION_RADIUS = 400.0; // Smaller radius for quarries
    const QUARRY_RESTRICTION_RADIUS_SQ = QUARRY_RESTRICTION_RADIUS * QUARRY_RESTRICTION_RADIUS;
    
    // Check ALK stations
    const ALK_STATION_BUILDING_RESTRICTION_MULTIPLIER_CENTRAL = 8.75;
    const ALK_STATION_BUILDING_RESTRICTION_MULTIPLIER_SUBSTATION = 3.0;
    
    for (const station of connection.db.alk_station.iter()) {
        if (!station.isActive) continue;
        const dx = worldX - station.worldPosX;
        const dy = worldY - station.worldPosY;
        const distSq = dx * dx + dy * dy;
        
        const multiplier = station.stationId === 0 
            ? ALK_STATION_BUILDING_RESTRICTION_MULTIPLIER_CENTRAL 
            : ALK_STATION_BUILDING_RESTRICTION_MULTIPLIER_SUBSTATION;
        const restrictionRadius = station.interactionRadius * multiplier;
        const restrictionRadiusSq = restrictionRadius * restrictionRadius;
        
        if (distSq <= restrictionRadiusSq) {
            monumentZoneTileCache.set(cacheKey, { blocked: true, timestamp: now });
            return true; // Too close to ALK station
        }
    }
    
    // Check rune stones (800px radius)
    for (const runeStone of connection.db.rune_stone.iter()) {
        const dx = worldX - runeStone.posX;
        const dy = worldY - runeStone.posY;
        const distSq = dx * dx + dy * dy;
        if (distSq <= MONUMENT_RESTRICTION_RADIUS_SQ) {
            monumentZoneTileCache.set(cacheKey, { blocked: true, timestamp: now });
            return true; // Too close to rune stone
        }
    }
    
    // Check hot springs and quarries using tile type lookup (different radii)
    const checkRadiusTiles = Math.ceil(MONUMENT_RESTRICTION_RADIUS / TILE_SIZE_LOCAL) + 1;
    const centerTileX = Math.floor(worldX / TILE_SIZE_LOCAL);
    const centerTileY = Math.floor(worldY / TILE_SIZE_LOCAL);
    
    for (let dy = -checkRadiusTiles; dy <= checkRadiusTiles; dy++) {
        for (let dx = -checkRadiusTiles; dx <= checkRadiusTiles; dx++) {
            const checkTileX = centerTileX + dx;
            const checkTileY = centerTileY + dy;
            
            const tileType = getTileTypeFromChunkData(connection, checkTileX, checkTileY);
            if (tileType === 'HotSpringWater' || tileType === 'Quarry') {
                const tileCenterX = checkTileX * TILE_SIZE_LOCAL + TILE_SIZE_LOCAL / 2;
                const tileCenterY = checkTileY * TILE_SIZE_LOCAL + TILE_SIZE_LOCAL / 2;
                const tdx = worldX - tileCenterX;
                const tdy = worldY - tileCenterY;
                const distSq = tdx * tdx + tdy * tdy;
                // Use different radius for quarries vs hot springs
                const restrictionRadiusSq = tileType === 'Quarry' ? QUARRY_RESTRICTION_RADIUS_SQ : MONUMENT_RESTRICTION_RADIUS_SQ;
                if (distSq <= restrictionRadiusSq) {
                    monumentZoneTileCache.set(cacheKey, { blocked: true, timestamp: now });
                    return true; // Too close to hot spring or quarry
                }
            }
        }
    }
    
    // Check monument parts (unified table for fishing village, shipwreck, whale bone graveyard, etc.)
    // NOTE: MonumentType is a tagged union with a `tag` property (e.g., { tag: 'FishingVillage' })
    // All monument restriction radii must match server/src/building.rs values
    const MONUMENT_MINIMUM_RESTRICTION_RADIUS = 800.0; // 800px minimum for all monuments
    const MONUMENT_MINIMUM_RESTRICTION_RADIUS_SQ = MONUMENT_MINIMUM_RESTRICTION_RADIUS * MONUMENT_MINIMUM_RESTRICTION_RADIUS;
    const FISHING_VILLAGE_RESTRICTION_RADIUS = 1000.0; // 25% larger than original 800
    const FISHING_VILLAGE_RESTRICTION_RADIUS_SQ = FISHING_VILLAGE_RESTRICTION_RADIUS * FISHING_VILLAGE_RESTRICTION_RADIUS;
    const SHIPWRECK_RESTRICTION_RADIUS = 1875.0; // 25% larger than original 1500
    const SHIPWRECK_RESTRICTION_RADIUS_SQ = SHIPWRECK_RESTRICTION_RADIUS * SHIPWRECK_RESTRICTION_RADIUS;
    const WHALE_BONE_GRAVEYARD_RESTRICTION_RADIUS = 800.0;
    const WHALE_BONE_GRAVEYARD_RESTRICTION_RADIUS_SQ = WHALE_BONE_GRAVEYARD_RESTRICTION_RADIUS * WHALE_BONE_GRAVEYARD_RESTRICTION_RADIUS;
    
    for (const part of connection.db.monument_part.iter()) {
        // Only check against the center piece for the exclusion zone
        if (part.isCenter) {
            const dx = worldX - part.worldX;
            const dy = worldY - part.worldY;
            const distSq = dx * dx + dy * dy;
            
            // Use different restriction radius based on monument type
            // Larger monuments get larger radii, all others use 800px minimum
            let restrictionRadiusSq: number;
            switch (part.monumentType?.tag) {
                case 'Shipwreck':
                    restrictionRadiusSq = SHIPWRECK_RESTRICTION_RADIUS_SQ;
                    break;
                case 'FishingVillage':
                    restrictionRadiusSq = FISHING_VILLAGE_RESTRICTION_RADIUS_SQ;
                    break;
                case 'WhaleBoneGraveyard':
                    restrictionRadiusSq = WHALE_BONE_GRAVEYARD_RESTRICTION_RADIUS_SQ;
                    break;
                case 'CrashedResearchDrone':
                case 'WeatherStation':
                case 'WolfDen':
                case 'HuntingVillage':
                case 'AlpineVillage':
                default:
                    // 800px minimum for all other monuments (AlpineVillage uses 600px on server)
                    restrictionRadiusSq = MONUMENT_MINIMUM_RESTRICTION_RADIUS_SQ;
            }
            
            if (distSq <= restrictionRadiusSq) {
                monumentZoneTileCache.set(cacheKey, { blocked: true, timestamp: now });
                return true; // Too close to monument
            }
        }
    }
    
    // Check asphalt tiles (compound areas)
    const tileAtX = Math.floor(worldX / TILE_SIZE_LOCAL);
    const tileAtY = Math.floor(worldY / TILE_SIZE_LOCAL);
    const tileTypeAtPosition = getTileTypeFromChunkData(connection, tileAtX, tileAtY);
    if (tileTypeAtPosition === 'Asphalt') {
        monumentZoneTileCache.set(cacheKey, { blocked: true, timestamp: now });
        return true; // Cannot place on asphalt/compound areas
    }

    monumentZoneTileCache.set(cacheKey, { blocked: false, timestamp: now });
    return false;
}

/**
 * Checks if a world position is too close to any wall (with buffer zone)
 * Used to prevent placing placeables on or near walls (client-side validation)
 * Returns true if the position is within the buffer zone around a wall, false otherwise
 */
function isPositionOnWall(
    connection: DbConnection | null,
    worldX: number,
    worldY: number
): boolean {
    if (!connection) return false;
    
    const WALL_COLLISION_THICKNESS = 6.0;
    const PLACEMENT_BUFFER = 24.0; // Buffer zone around walls (prevents placing too close on either side)
    const FOUNDATION_TILE_SIZE = 96;
    
    // Convert world position to foundation cell coordinates
    const cellX = Math.floor(worldX / FOUNDATION_TILE_SIZE);
    const cellY = Math.floor(worldY / FOUNDATION_TILE_SIZE);
    
    // Check walls in nearby cells (±1 cell in each direction to catch edge cases)
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
        for (let offsetY = -1; offsetY <= 1; offsetY++) {
            const checkCellX = cellX + offsetX;
            const checkCellY = cellY + offsetY;
            
            // Iterate through all walls and check if they're on this cell
            for (const wall of connection.db.wall_cell.iter()) {
                if (wall.isDestroyed) continue;
                
                // Only check walls on the cell we're interested in
                if (wall.cellX !== checkCellX || wall.cellY !== checkCellY) continue;
                
                // Calculate wall edge collision bounds using foundation cell coordinates
                const tileLeft = checkCellX * FOUNDATION_TILE_SIZE;
                const tileTop = checkCellY * FOUNDATION_TILE_SIZE;
                const tileRight = tileLeft + FOUNDATION_TILE_SIZE;
                const tileBottom = tileTop + FOUNDATION_TILE_SIZE;
                
                // Determine wall edge bounds with buffer zone on both sides
                // Edge 0 = North (top), 1 = East (right), 2 = South (bottom), 3 = West (left)
                // Buffer extends on both interior and exterior sides of the wall
                let wallMinX: number, wallMaxX: number, wallMinY: number, wallMaxY: number;
                
                switch (wall.edge) {
                    case 0: // North (top edge) - horizontal line
                        // Buffer extends both north (exterior) and south (interior) of the wall
                        wallMinX = tileLeft;
                        wallMaxX = tileRight;
                        wallMinY = tileTop - WALL_COLLISION_THICKNESS / 2.0 - PLACEMENT_BUFFER;
                        wallMaxY = tileTop + WALL_COLLISION_THICKNESS / 2.0 + PLACEMENT_BUFFER;
                        break;
                    case 1: // East (right edge) - vertical line
                        // Buffer extends both east (exterior) and west (interior) of the wall
                        wallMinX = tileRight - WALL_COLLISION_THICKNESS / 2.0 - PLACEMENT_BUFFER;
                        wallMaxX = tileRight + WALL_COLLISION_THICKNESS / 2.0 + PLACEMENT_BUFFER;
                        wallMinY = tileTop;
                        wallMaxY = tileBottom;
                        break;
                    case 2: // South (bottom edge) - horizontal line
                        // Buffer extends both south (exterior) and north (interior) of the wall
                        wallMinX = tileLeft;
                        wallMaxX = tileRight;
                        wallMinY = tileBottom - WALL_COLLISION_THICKNESS / 2.0 - PLACEMENT_BUFFER;
                        wallMaxY = tileBottom + WALL_COLLISION_THICKNESS / 2.0 + PLACEMENT_BUFFER;
                        break;
                    case 3: // West (left edge) - vertical line
                        // Buffer extends both west (exterior) and east (interior) of the wall
                        wallMinX = tileLeft - WALL_COLLISION_THICKNESS / 2.0 - PLACEMENT_BUFFER;
                        wallMaxX = tileLeft + WALL_COLLISION_THICKNESS / 2.0 + PLACEMENT_BUFFER;
                        wallMinY = tileTop;
                        wallMaxY = tileBottom;
                        break;
                    default:
                        continue; // Skip invalid edges
                }
                
                // Check if placement position is within wall collision bounds (including buffer)
                if (worldX >= wallMinX && worldX <= wallMaxX &&
                    worldY >= wallMinY && worldY <= wallMaxY) {
                    return true;
                }
            }
        }
    }
    
    return false;
}

/** AABB overlap: rects overlap iff they intersect */
function rectsOverlap(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
): boolean {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Check if placing at (centerX, centerY) would overlap existing placeables.
 * Returns overlap status and warning message. Only applies to grid-snapping placeables.
 */
export function checkPlacementOverlap(
    connection: DbConnection | null,
    placementInfo: PlacementItemInfo | null,
    centerX: number,
    centerY: number
): { overlaps: boolean; message: string | null } {
    if (!connection || !placementInfo) return { overlaps: false, message: null };
    const config = getPlacementConfig(placementInfo);
    if (!config) return { overlaps: false, message: null }; // Excluded items (broth pot, doors, fish trap) - skip

    const newBounds = getPlacementSquareBounds(centerX, centerY, config);

    const getExistingBounds = (posX: number, posY: number, c: PlaceablePlacementConfig) =>
        getPlacementSquareBounds(posX, posY, c);

    // Campfires
    for (const e of connection.db.campfire.iter()) {
        const c = getPlacementConfig({ itemName: 'Camp Fire', iconAssetName: 'campfire.png' });
        if (c && rectsOverlap(newBounds, getExistingBounds(e.posX, e.posY, c)))
            return { overlaps: true, message: 'Blocked by existing structure' };
    }
    // Furnaces
    for (const e of connection.db.furnace.iter()) {
        const c = getPlacementConfig({ itemName: 'Furnace', iconAssetName: 'furnace.png' });
        if (c && rectsOverlap(newBounds, getExistingBounds(e.posX, e.posY, c)))
            return { overlaps: true, message: 'Blocked by existing structure' };
    }
    // Barbecues
    for (const e of connection.db.barbecue.iter()) {
        const c = getPlacementConfig({ itemName: 'Barbecue', iconAssetName: 'barbecue.png' });
        if (c && rectsOverlap(newBounds, getExistingBounds(e.posX, e.posY, c)))
            return { overlaps: true, message: 'Blocked by existing structure' };
    }
    // Lanterns
    for (const e of connection.db.lantern.iter()) {
        const c = getPlacementConfig({ itemName: 'Lantern', iconAssetName: 'lantern.png' });
        if (c && rectsOverlap(newBounds, getExistingBounds(e.posX, e.posY, c)))
            return { overlaps: true, message: 'Blocked by existing structure' };
    }
    // Turrets
    for (const e of connection.db.turret.iter()) {
        const c = getPlacementConfig({ itemName: 'Tallow Steam Turret', iconAssetName: 'turret_tallow.png' });
        if (c && rectsOverlap(newBounds, getExistingBounds(e.posX, e.posY, c)))
            return { overlaps: true, message: 'Blocked by existing structure' };
    }
    // Stashes
    for (const e of connection.db.stash.iter()) {
        const c = getPlacementConfig({ itemName: 'Stash', iconAssetName: 'stash.png' });
        if (c && rectsOverlap(newBounds, getExistingBounds(e.posX, e.posY, c)))
            return { overlaps: true, message: 'Blocked by existing structure' };
    }
    // Sleeping bags
    for (const e of connection.db.sleeping_bag.iter()) {
        const c = getPlacementConfig({ itemName: 'Sleeping Bag', iconAssetName: 'sleeping_bag.png' });
        if (c && rectsOverlap(newBounds, getExistingBounds(e.posX, e.posY, c)))
            return { overlaps: true, message: 'Blocked by existing structure' };
    }
    // Rain collectors
    for (const e of connection.db.rain_collector.iter()) {
        const c = getPlacementConfig({ itemName: 'Reed Rain Collector', iconAssetName: 'reed_rain_collector.png' });
        if (c && rectsOverlap(newBounds, getExistingBounds(e.posX, e.posY, c)))
            return { overlaps: true, message: 'Blocked by existing structure' };
    }
    // Homestead hearths (Matron's Chest)
    for (const e of connection.db.homestead_hearth.iter()) {
        const c = getPlacementConfig({ itemName: "Matron's Chest", iconAssetName: 'hearth.png' });
        if (c && rectsOverlap(newBounds, getExistingBounds(e.posX, e.posY, c)))
            return { overlaps: true, message: 'Blocked by existing structure' };
    }
    // Wooden storage boxes (various box types)
    for (const e of connection.db.wooden_storage_box.iter()) {
        const c = getBoxTypePlacementConfig(e.boxType);
        if (c && rectsOverlap(newBounds, getExistingBounds(e.posX, e.posY, c)))
            return { overlaps: true, message: 'Blocked by existing structure' };
    }
    // Shelters
    for (const e of connection.db.shelter.iter()) {
        const c = getPlacementConfig({ itemName: 'Shelter', iconAssetName: 'shelter.png' });
        if (c && rectsOverlap(newBounds, getExistingBounds(e.posX, e.posY, c)))
            return { overlaps: true, message: 'Blocked by existing structure' };
    }
    // Broth pots (placed on campfires - have position)
    for (const e of connection.db.broth_pot.iter()) {
        const c = getPlacementConfig({ itemName: 'Camp Fire', iconAssetName: 'campfire.png' });
        if (c) {
            const potBounds = getPlacementSquareBounds(e.posX, e.posY, c);
            if (rectsOverlap(newBounds, potBounds))
                return { overlaps: true, message: 'Blocked by existing structure' };
        }
    }

    return { overlaps: false, message: null };
}

export function isPlacementTooFar(
    placementInfo: PlacementItemInfo | null, 
    playerX: number, 
    playerY: number, 
    worldX: number, 
    worldY: number
): boolean {
    if (!placementInfo) {
        return false;
    }

    const placeDistSq = (worldX - playerX) ** 2 + (worldY - playerY) ** 2;

    // Use appropriate placement range based on item type
    // These should match server-side placement distance constants!
    let clientPlacementRangeSq: number;
    if (placementInfo.iconAssetName === 'shelter.png') {
        // Shelter has a much larger placement range (256px vs 64px for other items)
        clientPlacementRangeSq = SHELTER_PLACEMENT_MAX_DISTANCE * SHELTER_PLACEMENT_MAX_DISTANCE;
    } else if (placementInfo.iconAssetName === 'hearth.png') {
        // Matron's Chest has increased placement range (200px) to make placement easier
        const HEARTH_PLACEMENT_MAX_DISTANCE = 200.0;
        clientPlacementRangeSq = HEARTH_PLACEMENT_MAX_DISTANCE * HEARTH_PLACEMENT_MAX_DISTANCE;
    } else if (placementInfo.iconAssetName === 'field_cauldron.png') {
        // Field Cauldron (broth pot) matches server PLAYER_BROTH_POT_INTERACTION_DISTANCE = 200.0
        const BROTH_POT_PLACEMENT_MAX_DISTANCE = 200.0;
        clientPlacementRangeSq = BROTH_POT_PLACEMENT_MAX_DISTANCE * BROTH_POT_PLACEMENT_MAX_DISTANCE;
    } else if (placementInfo.iconAssetName === 'wood_door.png' || placementInfo.iconAssetName === 'metal_door.png') {
        // Doors match server BUILDING_PLACEMENT_MAX_DISTANCE = 128.0
        const DOOR_PLACEMENT_MAX_DISTANCE = 128.0;
        clientPlacementRangeSq = DOOR_PLACEMENT_MAX_DISTANCE * DOOR_PLACEMENT_MAX_DISTANCE;
    } else if (placementInfo.iconAssetName === 'ancestral_ward.png' || 
               placementInfo.iconAssetName === 'signal_disruptor.png' || 
               placementInfo.iconAssetName === 'memory_beacon.png' ||
               placementInfo.iconAssetName === 'turret_tallow.png' ||
               placementInfo.iconAssetName === 'large_furnace.png') {
        // Wards, turrets, and large furnace have larger placement range (160px) because they have collision
        // (wards: radius 40, turret: radius 50, large furnace: radius 50) - players need to place them further away
        const WARD_PLACEMENT_MAX_DISTANCE = 160.0;
        clientPlacementRangeSq = WARD_PLACEMENT_MAX_DISTANCE * WARD_PLACEMENT_MAX_DISTANCE;
    } else if (placementInfo.iconAssetName === 'beehive_wooden.png' ||
               placementInfo.iconAssetName === 'reed_rain_collector.png' ||
               placementInfo.iconAssetName === 'fish_trap.png') {
        // Large 256x256 objects need increased placement range (200px)
        const LARGE_OBJECT_PLACEMENT_MAX_DISTANCE = 200.0;
        clientPlacementRangeSq = LARGE_OBJECT_PLACEMENT_MAX_DISTANCE * LARGE_OBJECT_PLACEMENT_MAX_DISTANCE;
    } else if (placementInfo.iconAssetName === 'cooking_station.png' ||
               placementInfo.iconAssetName === 'repair_bench.png' ||
               placementInfo.iconAssetName === 'scarecrow.png' ||
               placementInfo.iconAssetName === 'compost.png' ||
               placementInfo.iconAssetName === 'tanning_rack.png') {
        // Medium-large objects (160-192px) need increased placement range (200px)
        const MEDIUM_LARGE_OBJECT_PLACEMENT_MAX_DISTANCE = 200.0;
        clientPlacementRangeSq = MEDIUM_LARGE_OBJECT_PLACEMENT_MAX_DISTANCE * MEDIUM_LARGE_OBJECT_PLACEMENT_MAX_DISTANCE;
    } else if (placementInfo.iconAssetName === 'large_wood_box.png' ||
               placementInfo.iconAssetName === 'sleeping_bag.png' ||
               placementInfo.iconAssetName === 'wolf_pelt.png' ||
               placementInfo.iconAssetName === 'fox_pelt.png' ||
               placementInfo.iconAssetName === 'polar_bear_pelt.png' ||
               placementInfo.iconAssetName === 'walrus_pelt.png') {
        // Medium objects (96px) need slightly increased placement range (120px)
        const MEDIUM_OBJECT_PLACEMENT_MAX_DISTANCE = 120.0;
        clientPlacementRangeSq = MEDIUM_OBJECT_PLACEMENT_MAX_DISTANCE * MEDIUM_OBJECT_PLACEMENT_MAX_DISTANCE;
    } else {
        // Use standard interaction distance for other items (campfires, lanterns, small boxes, etc.)
        clientPlacementRangeSq = PLAYER_BOX_INTERACTION_DISTANCE_SQUARED * 1.1;
    }

    return placeDistSq > clientPlacementRangeSq;
}

/**
 * All placement previews should be perfectly centered on the cursor.
 * Server-side positioning has been adjusted to compensate for renderer anchoring,
 * so placement previews no longer need visual offsets.
 */

// PERFORMANCE FIX: Cache for placement validation results
// Key: "cellX,cellY,shape", Value: { isValid: boolean, timestamp: number }
// This avoids expensive iteration over all entities every frame
const placementValidationCache: Map<string, { isValid: boolean; timestamp: number }> = new Map();
const PLACEMENT_CACHE_TTL_MS = 100; // Cache results for 100ms - fast enough to feel instant but still avoids per-frame recalc

/**
 * Check if foundation placement is valid (client-side validation)
 * Now includes resource checking
 * 
 * PERFORMANCE FIX: Caches results for 500ms to avoid expensive iteration every frame
 */
function isFoundationPlacementValid(
    connection: DbConnection | null,
    cellX: number,
    cellY: number,
    shape: number,
    playerX: number,
    playerY: number,
    inventoryItems?: Map<string, any>,
    itemDefinitions?: Map<string, any>
): boolean {
    if (!connection) return false;

    const BUILDING_PLACEMENT_MAX_DISTANCE = 128.0;
    const BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED = BUILDING_PLACEMENT_MAX_DISTANCE * BUILDING_PLACEMENT_MAX_DISTANCE;
    
    // Cost depends on shape: 50 for full, 25 for triangles
    const REQUIRED_WOOD = (shape === 1) ? 50 : 25; // 1 = Full, 2-5 = Triangles

    // Convert cell coordinates to world pixel coordinates (center of foundation cell)
    const { x: worldX, y: worldY } = foundationCellToWorldCenter(cellX, cellY);

    // Check distance FIRST (cheap check before expensive cache lookup)
    const dx = worldX - playerX;
    const dy = worldY - playerY;
    const distSq = dx * dx + dy * dy;
    if (distSq > BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED) {
        return false;
    }

    // PERFORMANCE FIX: Check cache for this cell/shape combination
    // Distance check is excluded from cache since it depends on player position
    const cacheKey = `${cellX},${cellY},${shape}`;
    const now = performance.now();
    const cached = placementValidationCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < PLACEMENT_CACHE_TTL_MS) {
        return cached.isValid;
    }

    // PERFORMANCE FIX: Check if grass spatial hash needs rebuilding
    // We detect changes by counting entities (simple heuristic)
    let currentGrassCount = 0;
    for (const _ of connection.db.grass.iter()) { currentGrassCount++; if (currentGrassCount > lastGrassCount + 10) break; }
    if (currentGrassCount !== lastGrassCount || grassHashVersion === 0) {
        rebuildGrassSpatialHash(connection);
    }
    
    // Check if position has grass using spatial hash (O(1) lookup instead of O(n) iteration)
    // The hash already includes adjacent cells for edge cases
    if (grassSpatialHash.has(`${cellX},${cellY}`)) {
        // Double-check with actual grass entities only if hash says there might be grass
        // With split tables: grass (static pos) + grassState (is_alive)
        const FOUNDATION_SIZE = 96;
        const foundationMinX = worldX - FOUNDATION_SIZE / 2;
        const foundationMaxX = worldX + FOUNDATION_SIZE / 2;
        const foundationMinY = worldY - FOUNDATION_SIZE / 2;
        const foundationMaxY = worldY + FOUNDATION_SIZE / 2;
        
        for (const grass of connection.db.grass.iter()) {
            // Look up is_alive from grassState table
            const grassState = connection.db.grass_state.grassId.find(grass.id);
            const isAlive = grassState?.isAlive ?? false;
            if (isAlive &&
                grass.posX >= foundationMinX && grass.posX <= foundationMaxX &&
                grass.posY >= foundationMinY && grass.posY <= foundationMaxY) {
                placementValidationCache.set(cacheKey, { isValid: false, timestamp: now });
                return false; // Grass is blocking placement
            }
        }
    }

    // Check if position is near monuments (rune stones, hot springs, quarries)
    // Hot springs and rune stones: 800px, Quarries: 400px
    const MONUMENT_RESTRICTION_RADIUS = 800.0;
    const MONUMENT_RESTRICTION_RADIUS_SQ = MONUMENT_RESTRICTION_RADIUS * MONUMENT_RESTRICTION_RADIUS;
    const QUARRY_RESTRICTION_RADIUS = 400.0;
    const QUARRY_RESTRICTION_RADIUS_SQ = QUARRY_RESTRICTION_RADIUS * QUARRY_RESTRICTION_RADIUS;
    const TILE_SIZE = 48;
    
    // Check rune stones (800px)
    for (const runeStone of connection.db.rune_stone.iter()) {
        const dx = worldX - runeStone.posX;
        const dy = worldY - runeStone.posY;
        const distSq = dx * dx + dy * dy;
        if (distSq <= MONUMENT_RESTRICTION_RADIUS_SQ) {
            placementValidationCache.set(cacheKey, { isValid: false, timestamp: now });
            return false; // Too close to rune stone
        }
    }
    
    // Check hot springs (800px) and quarries (400px) using tile type lookup
    // PERFORMANCE FIX: Reduced check radius from 17 tiles to 8 tiles for better performance
    // The monument restriction is still enforced, but we only check tiles that could realistically be in range
    const OPTIMIZED_CHECK_RADIUS_TILES = 8; // Reduced from ~17 to improve performance
    const foundationTileX = Math.floor(worldX / TILE_SIZE);
    const foundationTileY = Math.floor(worldY / TILE_SIZE);
    
    let foundMonumentTile = false;
    for (let dy = -OPTIMIZED_CHECK_RADIUS_TILES; dy <= OPTIMIZED_CHECK_RADIUS_TILES && !foundMonumentTile; dy++) {
        for (let dx = -OPTIMIZED_CHECK_RADIUS_TILES; dx <= OPTIMIZED_CHECK_RADIUS_TILES && !foundMonumentTile; dx++) {
            const checkTileX = foundationTileX + dx;
            const checkTileY = foundationTileY + dy;
            
            const tileType = getTileTypeFromChunkData(connection, checkTileX, checkTileY);
            if (tileType === 'HotSpringWater' || tileType === 'Quarry') {
                const tileCenterX = (checkTileX * TILE_SIZE) + (TILE_SIZE / 2);
                const tileCenterY = (checkTileY * TILE_SIZE) + (TILE_SIZE / 2);
                const tdx = worldX - tileCenterX;
                const tdy = worldY - tileCenterY;
                const distSq = tdx * tdx + tdy * tdy;
                // Use different radius for quarries vs hot springs
                const restrictionRadiusSq = tileType === 'Quarry' ? QUARRY_RESTRICTION_RADIUS_SQ : MONUMENT_RESTRICTION_RADIUS_SQ;
                if (distSq <= restrictionRadiusSq) {
                    foundMonumentTile = true;
                }
            }
        }
    }
    
    if (foundMonumentTile) {
        placementValidationCache.set(cacheKey, { isValid: false, timestamp: now });
        return false; // Too close to hot spring or quarry
    }
    
    // Check if position is on asphalt tiles (compound areas - cannot build)
    const foundationTileAtX = Math.floor(worldX / TILE_SIZE);
    const foundationTileAtY = Math.floor(worldY / TILE_SIZE);
    const tileTypeAtPosition = getTileTypeFromChunkData(connection, foundationTileAtX, foundationTileAtY);
    if (tileTypeAtPosition === 'Asphalt') {
        placementValidationCache.set(cacheKey, { isValid: false, timestamp: now });
        return false; // Cannot build on asphalt/compound areas
    }
    
    // Check if position is within ALK station monument bounds
    // Building restriction radius MUST match safe zone radius to prevent abuse
    // Central compound (stationId = 0): 7x interactionRadius = ~1750px (~1/3 of original)
    // Substations (stationId 1-4): 3x interactionRadius = ~600px (1/3 of original)
    const ALK_STATION_BUILDING_RESTRICTION_MULTIPLIER_CENTRAL = 8.75;
    const ALK_STATION_BUILDING_RESTRICTION_MULTIPLIER_SUBSTATION = 3.0;
    
    for (const station of connection.db.alk_station.iter()) {
        if (!station.isActive) continue;
        const stationDx = worldX - station.worldPosX;
        const stationDy = worldY - station.worldPosY;
        const stationDistSq = stationDx * stationDx + stationDy * stationDy;
        
        // Calculate building restriction radius (matches safe zone radius)
        const multiplier = station.stationId === 0 
            ? ALK_STATION_BUILDING_RESTRICTION_MULTIPLIER_CENTRAL 
            : ALK_STATION_BUILDING_RESTRICTION_MULTIPLIER_SUBSTATION;
        const restrictionRadius = station.interactionRadius * multiplier;
        const restrictionRadiusSq = restrictionRadius * restrictionRadius;
        
        if (stationDistSq <= restrictionRadiusSq) {
            placementValidationCache.set(cacheKey, { isValid: false, timestamp: now });
            return false; // Too close to ALK station
        }
    }

    // PERFORMANCE FIX: Check if foundation spatial index needs rebuilding
    // We detect changes by counting entities (simple heuristic)
    let currentFoundationCount = 0;
    for (const _ of connection.db.foundation_cell.iter()) { currentFoundationCount++; if (currentFoundationCount > lastFoundationCount + 10) break; }
    if (currentFoundationCount !== lastFoundationCount || foundationIndexVersion === 0) {
        rebuildFoundationIndex(connection);
    }
    
    // PERFORMANCE FIX: Use spatial index for O(1) cell lookup instead of O(n) iteration
    const foundationKey = `${cellX},${cellY}`;
    const foundationsAtCell = foundationSpatialIndex.get(foundationKey);
    
    let foundComplementary = false;
    let foundOverlap = false;
    let foundationCount = 0;
    
    if (foundationsAtCell) {
        for (const foundation of foundationsAtCell) {
            if (!foundation.isDestroyed) {
                foundationCount++;
                const existingShape = foundation.shape;
                
                // Same shape = overlap
                if (existingShape === shape) {
                    placementValidationCache.set(cacheKey, { isValid: false, timestamp: now });
                    return false; // Position occupied
                }
                
                // Full foundation overlaps with anything
                if (existingShape === 1 || shape === 1) { // 1 = Full
                    placementValidationCache.set(cacheKey, { isValid: false, timestamp: now });
                    return false; // Position occupied
                }
                
                // Check if shapes are complementary triangles
                const isComplementary = (
                    (existingShape === 2 && shape === 4) || // TriNW + TriSE
                    (existingShape === 4 && shape === 2) || // TriSE + TriNW
                    (existingShape === 3 && shape === 5) || // TriNE + TriSW
                    (existingShape === 5 && shape === 3)    // TriSW + TriNE
                );
                
                if (isComplementary) {
                    foundComplementary = true; // Mark that we found a complementary triangle
                } else {
                    // Non-complementary shapes overlap
                    foundOverlap = true; // Mark that we found an overlap
                }
            }
        }
    }
    
    // If we found an overlap, block placement
    if (foundOverlap) {
        placementValidationCache.set(cacheKey, { isValid: false, timestamp: now });
        return false;
    }
    
    // If there are already 2 foundations at this cell (two complementary triangles forming a full square),
    // block any further placement
    if (foundationCount >= 2) {
        placementValidationCache.set(cacheKey, { isValid: false, timestamp: now });
        return false; // Already have two triangles forming a full square
    }
    
    // If we found a complementary triangle and no overlaps, allow placement
    // (This handles the case where we're adding the second triangle to form a full square)
    // If no foundations found at all, allow placement

    // Check if player has enough resources (cost depends on shape)
    if (inventoryItems && itemDefinitions) {
        // Find Wood item definition
        let woodDefId: bigint | null = null;
        for (const def of itemDefinitions.values()) {
            if (def.name === 'Wood') {
                woodDefId = def.id;
                break;
            }
        }
        
        if (woodDefId) {
            // Sum up all wood items (inventory + hotbar)
            let totalWood = 0;
            for (const item of inventoryItems.values()) {
                if (item.itemDefId === woodDefId) {
                    totalWood += item.quantity;
                }
            }
            
            if (totalWood < REQUIRED_WOOD) {
                placementValidationCache.set(cacheKey, { isValid: false, timestamp: now });
                return false; // Not enough resources
            }
        } else {
            // Can't find wood definition, assume invalid
            placementValidationCache.set(cacheKey, { isValid: false, timestamp: now });
            return false;
        }
    }

    placementValidationCache.set(cacheKey, { isValid: true, timestamp: now });
    return true;
}

/**
 * Check if wall placement is valid (client-side validation)
 * Checks: foundation exists, no overlapping wall, distance, resources
 */
function isWallPlacementValid(
    connection: DbConnection | null,
    cellX: number,
    cellY: number,
    worldMouseX: number,
    worldMouseY: number,
    playerX: number,
    playerY: number,
    inventoryItems?: Map<string, any>,
    itemDefinitions?: Map<string, any>
): boolean {
    if (!connection) return false;

    const BUILDING_PLACEMENT_MAX_DISTANCE = 128.0;
    const BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED = BUILDING_PLACEMENT_MAX_DISTANCE * BUILDING_PLACEMENT_MAX_DISTANCE;
    
    // Wall cost: 15 wood for Twig tier
    const REQUIRED_WOOD = 15;

    // Convert cell coordinates to world pixel coordinates (center of foundation cell)
    const { x: worldX, y: worldY } = foundationCellToWorldCenter(cellX, cellY);

    // Check distance
    const dx = worldX - playerX;
    const dy = worldY - playerY;
    const distSq = dx * dx + dy * dy;
    if (distSq > BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED) {
        return false;
    }

    // PERFORMANCE FIX: Use spatial index for O(1) foundation lookup
    const foundationKey = `${cellX},${cellY}`;
    const foundationsAtCell = foundationSpatialIndex.get(foundationKey);
    
    let hasFoundation = false;
    let foundationShape = 1; // Default to Full (1)
    
    if (foundationsAtCell) {
        for (const foundation of foundationsAtCell) {
            if (!foundation.isDestroyed) {
                hasFoundation = true;
                foundationShape = foundation.shape;
                break;
            }
        }
    }

    if (!hasFoundation) {
        return false; // No foundation at this location
    }

    // Check if foundation is a triangle (needed for edge detection)
    const isTriangle = foundationShape >= 2 && foundationShape <= 5;

    // Determine edge based on mouse position (same logic as server)
    // Convert foundation cell center to world coordinates
    const { x: foundationCenterX, y: foundationCenterY } = foundationCellToWorldCenter(cellX, cellY);
    const tileCenterX = foundationCenterX;
    const tileCenterY = foundationCenterY;
    const dxFromCenter = worldMouseX - tileCenterX;
    const dyFromCenter = worldMouseY - tileCenterY;
    const absDx = Math.abs(dxFromCenter);
    const absDy = Math.abs(dyFromCenter);
    
    // For triangle foundations, also consider diagonal edges
    let edge: number;
    if (isTriangle) {
        // Calculate distance to diagonal edges
        // Use same logic as preview rendering
        const diagNW_SE_dist = Math.abs(dxFromCenter - dyFromCenter); // Distance to NW-SE diagonal
        const diagNE_SW_dist = Math.abs(dxFromCenter + dyFromCenter); // Distance to NE-SW diagonal
        
        // Check if we're closer to a diagonal than to cardinal edges
        // Use a threshold to prefer diagonals when close
        const minCardinalDist = Math.min(absDx, absDy);
        const minDiagDist = Math.min(diagNW_SE_dist, diagNE_SW_dist);
        
        // Prefer diagonal if it's significantly closer, or if we're very close to diagonal
        if (minDiagDist < minCardinalDist * 1.2 || minDiagDist < 10) {
            // Closer to diagonal
            if (diagNW_SE_dist < diagNE_SW_dist) {
                edge = 5; // DiagNW_SE
            } else {
                edge = 4; // DiagNE_SW
            }
        } else {
            // Closer to cardinal edge
            if (absDy > absDx) {
                edge = dyFromCenter < 0 ? 0 : 2; // North (0) or South (2)
            } else {
                edge = dxFromCenter < 0 ? 3 : 1; // West (3) or East (1)
            }
        }
    } else {
        // Full foundation - only cardinal edges
        if (absDy > absDx) {
            edge = dyFromCenter < 0 ? 0 : 2; // North (0) or South (2)
        } else {
            edge = dxFromCenter < 0 ? 3 : 1; // West (3) or East (1)
        }
    }

    // Check if edge is valid for triangle foundations
    if (isTriangle) {
        // Triangle shapes: 2=TriNW, 3=TriNE, 4=TriSE, 5=TriSW
        // Valid edges for each triangle:
        // TriNW (2): N, W, DiagNW_SE edges (0, 3, 5)
        // TriNE (3): N, E, DiagNE_SW edges (0, 1, 4)
        // TriSE (4): S, E, DiagNW_SE edges (2, 1, 5)
        // TriSW (5): S, W, DiagNE_SW edges (2, 3, 4)
        let isValidEdge = false;
        switch (foundationShape) {
            case 2: // TriNW
                isValidEdge = edge === 0 || edge === 3 || edge === 5; // N, W, or DiagNW_SE
                break;
            case 3: // TriNE
                isValidEdge = edge === 0 || edge === 1 || edge === 4; // N, E, or DiagNE_SW
                break;
            case 4: // TriSE
                isValidEdge = edge === 2 || edge === 1 || edge === 5; // S, E, or DiagNW_SE
                break;
            case 5: // TriSW
                isValidEdge = edge === 2 || edge === 3 || edge === 4; // S, W, or DiagNE_SW
                break;
        }
        if (!isValidEdge) {
            return false; // Invalid edge for triangle foundation
        }
    }

    // Check if a wall already exists at this cell, edge, and facing
    // Also check adjacent tiles for shared edges
    // Note: We don't check facing - walls on same edge block regardless of facing
    // IMPORTANT: Check ALL walls at this cell, not just the detected edge
    // This handles cases where edge detection might be slightly off
    for (const wall of connection.db.wall_cell.iter()) {
        if (wall.cellX === cellX && wall.cellY === cellY && !wall.isDestroyed) {
            // Check if this wall is on the same edge OR a very close edge
            // For diagonal edges, also check if there's a wall on the other diagonal
            if (wall.edge === edge) {
                return false; // Wall already exists at this exact edge
            }
            // For triangle foundations, if we detected a diagonal edge but there's a wall
            // on the other diagonal, that's also invalid (can't have two diagonals)
            if (isTriangle && (edge === 4 || edge === 5) && (wall.edge === 4 || wall.edge === 5)) {
                return false; // Diagonal wall already exists
            }
        }
    }
    
    // Check adjacent tiles for shared edges
    // North edge of (x, y) = South edge of (x, y-1)
    // East edge of (x, y) = West edge of (x+1, y)
    // South edge of (x, y) = North edge of (x, y+1)
    // West edge of (x, y) = East edge of (x-1, y)
    let adjacentCellX: number = 0;
    let adjacentCellY: number = 0;
    let oppositeEdge: number = 0;
    let hasAdjacentTile = false;
    
    if (edge === 0) { // North
        adjacentCellX = cellX;
        adjacentCellY = cellY - 1;
        oppositeEdge = 2; // South
        hasAdjacentTile = true;
    } else if (edge === 1) { // East
        adjacentCellX = cellX + 1;
        adjacentCellY = cellY;
        oppositeEdge = 3; // West
        hasAdjacentTile = true;
    } else if (edge === 2) { // South
        adjacentCellX = cellX;
        adjacentCellY = cellY + 1;
        oppositeEdge = 0; // North
        hasAdjacentTile = true;
    } else if (edge === 3) { // West
        adjacentCellX = cellX - 1;
        adjacentCellY = cellY;
        oppositeEdge = 1; // East
        hasAdjacentTile = true;
    }
    // Diagonal edges (4, 5) don't have adjacent tiles (they're internal to the triangle)
    
    // Check adjacent cell for a wall on the opposite edge (only for cardinal edges)
    if (hasAdjacentTile) {
        for (const wall of connection.db.wall_cell.iter()) {
            if (wall.cellX === adjacentCellX && wall.cellY === adjacentCellY && wall.edge === oppositeEdge && !wall.isDestroyed) {
                return false; // Wall already exists on the shared edge with the adjacent tile
            }
        }
    }

    // Check if player has enough resources
    if (inventoryItems && itemDefinitions) {
        // Find Wood item definition
        let woodDefId: bigint | null = null;
        for (const def of itemDefinitions.values()) {
            if (def.name === 'Wood') {
                woodDefId = def.id;
                break;
            }
        }

        if (!woodDefId) {
            return false; // Wood item definition not found
        }

        // Sum up all wood items (inventory + hotbar)
        let totalWood = 0;
        for (const item of inventoryItems.values()) {
            if (item.itemDefId === woodDefId) {
                totalWood += item.quantity;
            }
        }

        if (totalWood < REQUIRED_WOOD) {
            return false; // Not enough wood
        }
    }

    return true;
}

/**
 * Check if fence placement is valid (client-side validation)
 * Fences now use 96px foundation cell grid (same as walls)
 * Checks: no overlapping fence/wall, distance, resources, water tiles
 */
function isFencePlacementValid(
    connection: DbConnection | null,
    cellX: number,
    cellY: number,
    edge: number, // 0 = North, 1 = East, 2 = South, 3 = West (same as walls)
    worldMouseX: number,
    worldMouseY: number,
    playerX: number,
    playerY: number,
    inventoryItems?: Map<string, any>,
    itemDefinitions?: Map<string, any>
): boolean {
    if (!connection) return false;

    const BUILDING_PLACEMENT_MAX_DISTANCE = 128.0;
    const BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED = BUILDING_PLACEMENT_MAX_DISTANCE * BUILDING_PLACEMENT_MAX_DISTANCE;
    
    // Fence cost: 15 wood
    const REQUIRED_WOOD = 15;
    
    // Foundation cell size (96px) - same as walls
    const FOUNDATION_SIZE = 96;

    // Calculate world position at cell edge (exactly like walls)
    const cellLeft = cellX * FOUNDATION_SIZE;
    const cellRight = cellLeft + FOUNDATION_SIZE;
    const cellTop = cellY * FOUNDATION_SIZE;
    const cellBottom = cellTop + FOUNDATION_SIZE;
    const cellCenterX = cellLeft + FOUNDATION_SIZE / 2;
    const cellCenterY = cellTop + FOUNDATION_SIZE / 2;
    
    let worldX: number, worldY: number;
    switch (edge) {
        case 0: // North edge
            worldX = cellCenterX;
            worldY = cellTop;
            break;
        case 1: // East edge
            worldX = cellRight;
            worldY = cellCenterY;
            break;
        case 2: // South edge
            worldX = cellCenterX;
            worldY = cellBottom;
            break;
        case 3: // West edge
            worldX = cellLeft;
            worldY = cellCenterY;
            break;
        default:
            worldX = cellCenterX;
            worldY = cellCenterY;
    }

    // Check distance
    const dx = worldX - playerX;
    const dy = worldY - playerY;
    const distSq = dx * dx + dy * dy;
    if (distSq > BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED) {
        return false;
    }

    // Check that player is NOT standing on the fence position
    const FENCE_COLLISION_THICKNESS = 6;
    const PLAYER_RADIUS = 32;
    const halfEdge = FOUNDATION_SIZE / 2;
    const halfThickness = FENCE_COLLISION_THICKNESS / 2;
    
    let fenceMinX: number, fenceMaxX: number, fenceMinY: number, fenceMaxY: number;
    // Edge 0 (North) and 2 (South) are horizontal, Edge 1 (East) and 3 (West) are vertical
    if (edge === 0 || edge === 2) {
        // Horizontal fence
        fenceMinX = worldX - halfEdge - PLAYER_RADIUS;
        fenceMaxX = worldX + halfEdge + PLAYER_RADIUS;
        fenceMinY = worldY - halfThickness - PLAYER_RADIUS;
        fenceMaxY = worldY + halfThickness + PLAYER_RADIUS;
    } else {
        // Vertical fence
        fenceMinX = worldX - halfThickness - PLAYER_RADIUS;
        fenceMaxX = worldX + halfThickness + PLAYER_RADIUS;
        fenceMinY = worldY - halfEdge - PLAYER_RADIUS;
        fenceMaxY = worldY + halfEdge + PLAYER_RADIUS;
    }
    
    if (playerX >= fenceMinX && playerX <= fenceMaxX &&
        playerY >= fenceMinY && playerY <= fenceMaxY) {
        return false; // Player is standing on fence position
    }

    // Check if there's already a fence at this exact edge
    for (const fence of connection.db.fence.iter()) {
        if (fence.cellX === cellX && fence.cellY === cellY && fence.edge === edge && !fence.isDestroyed) {
            return false; // Fence already exists at this edge
        }
    }
    
    // Check adjacent cells for shared edges (same as walls)
    // North edge of (x, y) = South edge of (x, y-1)
    // East edge of (x, y) = West edge of (x+1, y)
    // South edge of (x, y) = North edge of (x, y+1)
    // West edge of (x, y) = East edge of (x-1, y)
    let adjacentCellX: number, adjacentCellY: number, oppositeEdge: number;
    switch (edge) {
        case 0: adjacentCellX = cellX; adjacentCellY = cellY - 1; oppositeEdge = 2; break;
        case 1: adjacentCellX = cellX + 1; adjacentCellY = cellY; oppositeEdge = 3; break;
        case 2: adjacentCellX = cellX; adjacentCellY = cellY + 1; oppositeEdge = 0; break;
        case 3: adjacentCellX = cellX - 1; adjacentCellY = cellY; oppositeEdge = 1; break;
        default: adjacentCellX = cellX; adjacentCellY = cellY; oppositeEdge = edge;
    }
    
    for (const fence of connection.db.fence.iter()) {
        if (fence.cellX === adjacentCellX && fence.cellY === adjacentCellY && fence.edge === oppositeEdge && !fence.isDestroyed) {
            return false; // Fence already exists on shared edge
        }
    }
    
    // Check if wall exists at this edge (cannot place fence where wall is)
    for (const wall of connection.db.wall_cell.iter()) {
        if (wall.cellX === cellX && wall.cellY === cellY && wall.edge === edge && !wall.isDestroyed) {
            return false; // Wall exists at this edge
        }
    }
    for (const wall of connection.db.wall_cell.iter()) {
        if (wall.cellX === adjacentCellX && wall.cellY === adjacentCellY && wall.edge === oppositeEdge && !wall.isDestroyed) {
            return false; // Wall exists on shared edge
        }
    }

    // Check resources if inventory items provided
    if (inventoryItems && itemDefinitions) {
        // Find "Wood" item definition
        let woodItemDef: any = null;
        for (const def of itemDefinitions.values()) {
            if (def.name === 'Wood') {
                woodItemDef = def;
                break;
            }
        }

        if (!woodItemDef) {
            return false; // Wood item definition not found
        }

        // Calculate total wood available
        let totalWood = 0;
        for (const item of inventoryItems.values()) {
            if (item.itemDefId === woodItemDef.id && item.quantity > 0) {
                totalWood += item.quantity;
            }
        }

        if (totalWood < REQUIRED_WOOD) {
            return false; // Not enough wood
        }
    }

    return true;
}

/**
 * Renders the placement preview item/structure following the mouse.
 */
export function renderPlacementPreview({
    ctx,
    placementInfo,
    buildingState,
    itemImagesRef,
    doodadImagesRef,
    shelterImageRef,
    worldMouseX,
    worldMouseY,
    isPlacementTooFar,
    placementError,
    onClearPlacementError,
    connection,
    worldScale,
    viewOffsetX,
    viewOffsetY,
    localPlayerX,
    localPlayerY,
    inventoryItems,
    itemDefinitions,
    foundationTileImagesRef,
}: RenderPlacementPreviewParams): string | null {
    // Handle building preview first
    if (buildingState?.isBuilding && worldMouseX !== null && worldMouseY !== null) {
        // Convert mouse position to foundation cell coordinates (96px grid)
        const { cellX, cellY } = worldPixelsToFoundationCell(worldMouseX, worldMouseY);
        
        if (buildingState.mode === BuildingMode.Foundation) {
            const isValid = isFoundationPlacementValid(
                connection,
                cellX,
                cellY,
                buildingState.foundationShape,
                localPlayerX,
                localPlayerY,
                inventoryItems,
                itemDefinitions
            );

            renderFoundationPreview({
                ctx,
                cellX: cellX,
                cellY: cellY,
                shape: buildingState.foundationShape,
                tier: buildingState.buildingTier,
                isValid,
                worldScale,
                viewOffsetX,
                viewOffsetY,
                foundationTileImagesRef,
            });
        } else if (buildingState.mode === BuildingMode.Wall) {
            // PERFORMANCE FIX: Use spatial index for O(1) foundation check
            const foundationKey = `${cellX},${cellY}`;
            const foundationsAtCell = foundationSpatialIndex.get(foundationKey);
            const hasFoundation = foundationsAtCell?.some(f => !f.isDestroyed) ?? false;

            // Only render wall preview if there's a foundation to snap to
            if (hasFoundation) {
                const isValid = isWallPlacementValid(
                    connection,
                    cellX,
                    cellY,
                    worldMouseX,
                    worldMouseY,
                    localPlayerX,
                    localPlayerY,
                    inventoryItems,
                    itemDefinitions
                );

                renderWallPreview({
                    ctx,
                    cellX: cellX,
                    cellY: cellY,
                    worldMouseX,
                    worldMouseY,
                    tier: buildingState.buildingTier,
                    isValid,
                    worldScale,
                    viewOffsetX,
                    viewOffsetY,
                    foundationTileImagesRef,
                    connection, // ADDED: Pass connection to check foundation shape
                });
            }
        } else if (buildingState.mode === BuildingMode.Fence) {
            // Fence placement - now uses 96px foundation cell grid (same as walls)
            const { cellX, cellY } = worldPixelsToFoundationCell(worldMouseX, worldMouseY);
            
            // Determine which edge based on mouse position relative to cell center (same as walls)
            const cellCenterX = cellX * FOUNDATION_TILE_SIZE + FOUNDATION_TILE_SIZE / 2;
            const cellCenterY = cellY * FOUNDATION_TILE_SIZE + FOUNDATION_TILE_SIZE / 2;
            const dx = worldMouseX - cellCenterX;
            const dy = worldMouseY - cellCenterY;
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);
            
            // Determine edge: N=0, E=1, S=2, W=3
            let edge: number;
            if (absDy > absDx) {
                edge = dy < 0 ? 0 : 2; // North or South
            } else {
                edge = dx < 0 ? 3 : 1; // West or East
            }
            
            const isValid = isFencePlacementValid(
                connection,
                cellX,
                cellY,
                edge,
                worldMouseX,
                worldMouseY,
                localPlayerX,
                localPlayerY,
                inventoryItems,
                itemDefinitions
            );

            renderFencePreview({
                ctx,
                cellX: cellX,
                cellY: cellY,
                worldMouseX,
                worldMouseY,
                edge,
                isValid,
                worldScale,
                viewOffsetX,
                viewOffsetY,
                foundationTileImagesRef,
                doodadImagesRef, // Pass for fence sprite images
            });
        }
        return null; // Building preview rendered, exit early
    }

    // Handle item placement preview (existing logic)
    if (!placementInfo || worldMouseX === null || worldMouseY === null) {
        return null; // Nothing to render
    }

    // Check if this is a seed placement
    // Dynamic seed detection using plant utils - no more hardcoding!
    const isSeedPlacement = isSeedItemValid(placementInfo.itemName);
    
    // Check if this is a door placement
    const isDoorPlacement = placementInfo.iconAssetName === 'wood_door.png' || placementInfo.iconAssetName === 'metal_door.png';
    
    // Calculate door edge early if it's a door placement (needed for image selection)
    // Uses same logic as main snapping to ensure preview sprite matches actual placement
    let doorEdgeForPreview: number = 2; // Default to South
    if (isDoorPlacement && connection) {
        const FOUNDATION_TILE_SIZE = 96;
        const mouseCellX = Math.floor(worldMouseX / FOUNDATION_TILE_SIZE);
        const mouseCellY = Math.floor(worldMouseY / FOUNDATION_TILE_SIZE);
        
        let nearestDistance = Infinity;
        let nearestCellY: number | null = null;
        
        // Ensure spatial index is populated
        let currentFoundationCount = 0;
        for (const _ of connection.db.foundation_cell.iter()) {
            currentFoundationCount++; 
            if (currentFoundationCount > lastFoundationCount + 10) break; 
        }
        if (currentFoundationCount !== lastFoundationCount || foundationIndexVersion === 0) {
            rebuildFoundationIndex(connection);
        }
        
        // Check 3x3 grid using spatial index
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const checkCellX = mouseCellX + dx;
                const checkCellY = mouseCellY + dy;
                const foundationsAtCell = foundationSpatialIndex.get(`${checkCellX},${checkCellY}`);
                
                if (foundationsAtCell) {
                    for (const foundation of foundationsAtCell) {
                        if (foundation.isDestroyed) continue;
                        
                        const foundationCenterX = checkCellX * FOUNDATION_TILE_SIZE + FOUNDATION_TILE_SIZE / 2;
                        const foundationCenterY = checkCellY * FOUNDATION_TILE_SIZE + FOUNDATION_TILE_SIZE / 2;
                        
                        const fdx = worldMouseX - foundationCenterX;
                        const fdy = worldMouseY - foundationCenterY;
                        const distance = Math.sqrt(fdx * fdx + fdy * fdy);
                        
                        if (distance < nearestDistance && distance < FOUNDATION_TILE_SIZE * 1.5) {
                            nearestDistance = distance;
                            nearestCellY = checkCellY;
                        }
                    }
                }
            }
        }
        
        // Fallback to direct iteration if spatial index is empty
        if (nearestCellY === null) {
            nearestDistance = Infinity;
            for (const foundation of connection.db.foundation_cell.iter()) {
                if (foundation.isDestroyed) continue;
                
                const foundationCenterX = foundation.cellX * FOUNDATION_TILE_SIZE + FOUNDATION_TILE_SIZE / 2;
                const foundationCenterY = foundation.cellY * FOUNDATION_TILE_SIZE + FOUNDATION_TILE_SIZE / 2;
                
                const fdx = worldMouseX - foundationCenterX;
                const fdy = worldMouseY - foundationCenterY;
                const distance = Math.sqrt(fdx * fdx + fdy * fdy);
                
                if (distance < nearestDistance && distance < FOUNDATION_TILE_SIZE * 1.5) {
                    nearestDistance = distance;
                    nearestCellY = foundation.cellY;
                }
            }
        }
        
        if (nearestCellY !== null) {
            const foundationCenterY = nearestCellY * FOUNDATION_TILE_SIZE + FOUNDATION_TILE_SIZE / 2;
            doorEdgeForPreview = worldMouseY < foundationCenterY ? 0 : 2; // 0 = North, 2 = South
        }
    }
    
    // Determine which image to use for the preview
    let previewImg: HTMLImageElement | undefined;
    
    if (isSeedPlacement) {
        // For seeds, use the planted_seed.png from doodads folder
        previewImg = doodadImagesRef.current?.get('planted_seed.png');
    } else if (placementInfo.iconAssetName === 'shelter.png' && shelterImageRef?.current) {
        // For shelters, use the shelter image from doodads folder
        previewImg = shelterImageRef.current;
    } else if (isDoorPlacement) {
        // For doors, use the doodads images (not item icons)
        // Determine which door sprite to use based on edge and type
        const isNorthEdge = doorEdgeForPreview === 0;
        
        if (placementInfo.iconAssetName === 'wood_door.png') {
            previewImg = doodadImagesRef.current?.get(isNorthEdge ? 'wood_door_north.png' : 'wood_door.png');
        } else if (placementInfo.iconAssetName === 'metal_door.png') {
            previewImg = doodadImagesRef.current?.get(isNorthEdge ? 'metal_door_north.png' : 'metal_door.png');
        }
    } else if (placementInfo.itemName === 'Compost' || placementInfo.iconAssetName === 'compost.png') {
        // For compost, use the compost.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('compost.png');
    } else if (placementInfo.itemName === 'Tanning Rack' || placementInfo.iconAssetName === 'tanning_rack.png') {
        previewImg = doodadImagesRef.current?.get('tanning_rack.png');
    } else if (placementInfo.iconAssetName === 'barbecue.png') {
        // For barbecue, use the barbecue.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('barbecue.png');
    } else if (placementInfo.iconAssetName === 'refrigerator.png') {
        // For refrigerator, use the refrigerator.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('refrigerator.png');
    } else if (placementInfo.iconAssetName === 'repair_bench.png') {
        // For repair bench, use the repair_bench.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('repair_bench.png');
    } else if (placementInfo.iconAssetName === 'cooking_station.png') {
        // For cooking station, use the cooking_station.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('cooking_station.png');
    } else if (placementInfo.iconAssetName === 'scarecrow.png') {
        // For scarecrow, use the scarecrow.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('scarecrow.png');
    } else if (placementInfo.iconAssetName === 'large_wood_box.png') {
        // For large wooden box, use the large_wood_box.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('large_wood_box.png');
    } else if (placementInfo.iconAssetName === 'ancestral_ward.png') {
        // For Ancestral Ward, use the "off" version from doodads folder for placement preview
        previewImg = doodadImagesRef.current?.get('ancestral_ward_off.png');
    } else if (placementInfo.iconAssetName === 'signal_disruptor.png') {
        // For Signal Disruptor, use the "off" version from doodads folder for placement preview
        previewImg = doodadImagesRef.current?.get('signal_disruptor_off.png');
    } else if (placementInfo.iconAssetName === 'memory_beacon.png') {
        // For Memory Beacon, use the single sprite from doodads folder for placement preview
        previewImg = doodadImagesRef.current?.get('memory_beacon.png');
    } else if (placementInfo.iconAssetName === 'turret_tallow.png') {
        // For Tallow Steam Turret, use the sprite from doodads folder for placement preview
        previewImg = doodadImagesRef.current?.get('turret_tallow.png');
    } else if (placementInfo.iconAssetName === 'beehive_wooden.png') {
        // For Wooden Beehive, use the beehive_wooden.png from doodads folder for placement preview
        previewImg = doodadImagesRef.current?.get('beehive_wooden.png');
    } else if (placementInfo.iconAssetName === 'reed_rain_collector.png') {
        // For Reed Rain Collector, use the doodad sprite for placement preview
        previewImg = doodadImagesRef.current?.get('reed_rain_collector.png');
    } else if (placementInfo.iconAssetName === 'furnace_simple.png') {
        // For Furnace, use the furnace_simple.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('furnace_simple.png');
    } else if (placementInfo.iconAssetName === 'large_furnace.png') {
        // For Large Furnace, use the large_furnace_off.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('large_furnace_off.png');
    } else if (placementInfo.iconAssetName === 'campfire.png') {
        // For Campfire, use the campfire_off.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('campfire_off.png');
    } else if (placementInfo.iconAssetName === 'lantern_off.png') {
        // For Lantern, use the lantern_off.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('lantern_off.png');
    } else if (placementInfo.iconAssetName === 'hearth.png') {
        // For Hearth, use the hearth.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('hearth.png');
    } else if (placementInfo.iconAssetName === 'sleeping_bag.png') {
        // For Sleeping Bag, use the sleeping_bag.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('sleeping_bag.png');
    } else if (
        placementInfo.iconAssetName === 'wolf_pelt.png' ||
        placementInfo.iconAssetName === 'fox_pelt.png' ||
        placementInfo.iconAssetName === 'polar_bear_pelt.png' ||
        placementInfo.iconAssetName === 'walrus_pelt.png'
    ) {
        // Pelt rugs render with their item sprite, sleeping-bag style footprint.
        previewImg = itemImagesRef.current?.get(placementInfo.iconAssetName);
    } else if (placementInfo.iconAssetName === 'stash.png') {
        // For Stash, use the stash.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('stash.png');
    } else if (placementInfo.iconAssetName === 'wooden_storage_box.png') {
        // For Wooden Storage Box, use the wooden_storage_box.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('wooden_storage_box.png');
    } else if (placementInfo.iconAssetName === 'fish_trap.png') {
        // For Fish Trap, use the fish_trap.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('fish_trap.png');
    } else {
        // For other items, use the item images
        previewImg = itemImagesRef.current?.get(placementInfo.iconAssetName);
    }

    // Determine width/height based on placement item (all previews centered on cursor)
    let drawWidth = CAMPFIRE_WIDTH_PREVIEW; // Default to campfire
    let drawHeight = CAMPFIRE_HEIGHT_PREVIEW;

    if (placementInfo.iconAssetName === 'furnace_simple.png') { // ADDED: Furnace placement dimensions
        drawWidth = FURNACE_WIDTH_PREVIEW; 
        drawHeight = FURNACE_HEIGHT_PREVIEW;
    } else if (placementInfo.iconAssetName === 'large_furnace.png') { // ADDED: Large Furnace placement dimensions
        drawWidth = LARGE_FURNACE_WIDTH; 
        drawHeight = LARGE_FURNACE_HEIGHT;
    } else if (placementInfo.iconAssetName === 'barbecue.png') { // ADDED: Barbecue placement dimensions
        drawWidth = BARBECUE_WIDTH_PREVIEW; 
        drawHeight = BARBECUE_HEIGHT_PREVIEW;
    } else if (placementInfo.iconAssetName === 'lantern_off.png') {
        drawWidth = LANTERN_WIDTH_PREVIEW; 
        drawHeight = LANTERN_HEIGHT_PREVIEW;
    } else if (placementInfo.iconAssetName === 'ancestral_ward.png') {
        // Ancestral Ward preview dimensions (Tier 1 ward - larger than lantern)
        drawWidth = ANCESTRAL_WARD_WIDTH;
        drawHeight = ANCESTRAL_WARD_HEIGHT;
    } else if (placementInfo.iconAssetName === 'signal_disruptor.png') {
        // Signal Disruptor preview dimensions (Tier 2 ward)
        drawWidth = SIGNAL_DISRUPTOR_WIDTH;
        drawHeight = SIGNAL_DISRUPTOR_HEIGHT;
    } else if (placementInfo.iconAssetName === 'memory_beacon.png') {
        // Memory Resonance Beacon preview dimensions (Tier 3 ward)
        drawWidth = MEMORY_BEACON_WIDTH;
        drawHeight = MEMORY_BEACON_HEIGHT;
    } else if (placementInfo.iconAssetName === 'turret_tallow.png') {
        // Tallow Steam Turret preview dimensions (same as wards - 256x256)
        drawWidth = TURRET_WIDTH_PREVIEW;
        drawHeight = TURRET_HEIGHT_PREVIEW;
    } else if (placementInfo.itemName === 'Compost' || placementInfo.iconAssetName === 'compost.png') {
        // Compost preview dimensions (matches actual rendering: 128px x 128px)
        drawWidth = COMPOST_WIDTH; // 128px
        drawHeight = COMPOST_HEIGHT; // 128px
    } else if (placementInfo.itemName === 'Tanning Rack' || placementInfo.iconAssetName === 'tanning_rack.png') {
        drawWidth = COMPOST_WIDTH;
        drawHeight = COMPOST_HEIGHT;
    } else if (placementInfo.iconAssetName === 'wooden_storage_box.png') {
        // Regular wooden storage box uses campfire dimensions for preview
        drawWidth = CAMPFIRE_WIDTH_PREVIEW; 
        drawHeight = CAMPFIRE_HEIGHT_PREVIEW;
    } else if (placementInfo.iconAssetName === 'refrigerator.png') {
        // Refrigerator preview dimensions (matches actual rendering - 96x96 squared)
        drawWidth = REFRIGERATOR_WIDTH; // 96px
        drawHeight = REFRIGERATOR_HEIGHT; // 96px
    } else if (placementInfo.iconAssetName === 'repair_bench.png') {
        // Repair Bench preview dimensions (matches actual rendering - 192x192)
        drawWidth = REPAIR_BENCH_WIDTH; // 192px
        drawHeight = REPAIR_BENCH_HEIGHT; // 192px
    } else if (placementInfo.iconAssetName === 'cooking_station.png') {
        // Cooking Station preview dimensions (matches actual rendering - 192x192)
        drawWidth = COOKING_STATION_WIDTH; // 192px
        drawHeight = COOKING_STATION_HEIGHT; // 192px
    } else if (placementInfo.iconAssetName === 'beehive_wooden.png') {
        // Wooden Beehive preview dimensions (matches actual rendering - 256x256)
        drawWidth = PLAYER_BEEHIVE_WIDTH; // 256px
        drawHeight = PLAYER_BEEHIVE_HEIGHT; // 256px
    } else if (placementInfo.iconAssetName === 'fish_trap.png') {
        // Fish Trap preview dimensions (matches actual rendering - 132x132)
        drawWidth = 132;
        drawHeight = 132;
    } else if (placementInfo.iconAssetName === 'scarecrow.png') {
        // Scarecrow preview dimensions (matches actual rendering - square image)
        drawWidth = SCARECROW_WIDTH;
        drawHeight = SCARECROW_HEIGHT;
    } else if (placementInfo.iconAssetName === 'large_wood_box.png') {
        // Large wooden box preview dimensions (matches actual rendering)
        drawWidth = LARGE_BOX_WIDTH; // 96px
        drawHeight = LARGE_BOX_HEIGHT; // 96px
    } else if (placementInfo.iconAssetName === 'sleeping_bag.png') {
        drawWidth = SLEEPING_BAG_WIDTH; 
        drawHeight = SLEEPING_BAG_HEIGHT;
    } else if (
        placementInfo.iconAssetName === 'wolf_pelt.png' ||
        placementInfo.iconAssetName === 'fox_pelt.png' ||
        placementInfo.iconAssetName === 'polar_bear_pelt.png' ||
        placementInfo.iconAssetName === 'walrus_pelt.png'
    ) {
        drawWidth = SLEEPING_BAG_WIDTH;
        drawHeight = SLEEPING_BAG_HEIGHT;
    } else if (placementInfo.iconAssetName === 'stash.png') {
        drawWidth = STASH_WIDTH;
        drawHeight = STASH_HEIGHT;
    } else if (placementInfo.iconAssetName === 'shelter.png') {
        drawWidth = SHELTER_RENDER_WIDTH; 
        drawHeight = SHELTER_RENDER_HEIGHT;
    } else if (placementInfo.iconAssetName === 'reed_rain_collector.png') {
        // Rain collector uses 256x256 sprite (matches beehive)
        drawWidth = 256;
        drawHeight = 256;
    } else if (placementInfo.iconAssetName === 'hearth.png') {
        // Matron's Chest preview dimensions (matches actual rendering: 125px, 30% larger than base 96px)
        drawWidth = HEARTH_WIDTH;  // 125px
        drawHeight = HEARTH_HEIGHT; // 125px
    } else if (placementInfo.iconAssetName === 'field_cauldron.png') {
        // Broth pot preview dimensions (similar to rain collector)
        drawWidth = 80;
        drawHeight = 80;
    } else if (placementInfo.iconAssetName === 'wood_door.png' || placementInfo.iconAssetName === 'metal_door.png') {
        // Door preview dimensions (matches FOUNDATION_TILE_SIZE)
        drawWidth = 96;
        drawHeight = 96;
    } else if (isSeedPlacement) {
        // Seeds should match the actual planted seed size (48x48)
        drawWidth = 48;  
        drawHeight = 48;
    } else if (placementInfo.iconAssetName === 'babushka_surprise.png' || placementInfo.iconAssetName === 'matriarch_wrath.png') {
        // Explosives preview - medium size for visibility
        drawWidth = 64;
        drawHeight = 64;
    }

    ctx.save();

    // Snap to placement grid for items that use it (preview matches server placement exactly)
    let snappedX = worldMouseX;
    let snappedY = worldMouseY;
    const placementConfig = shouldUseGridSnapping(placementInfo) ? getPlacementConfig(placementInfo) : null;
    if (placementConfig && placementInfo.iconAssetName !== 'field_cauldron.png' && !isDoorPlacement) {
      const snapped = snapToPlacementGrid(worldMouseX, worldMouseY, placementConfig);
      snappedX = snapped.x;
      snappedY = snapped.y;
    }

    // Special handling for broth pot - snap to nearest heat source (campfire or fumarole)
    let nearestHeatSource: any = null;
    let heatSourceType: 'campfire' | 'fumarole' | null = null;
    
    if (placementInfo.iconAssetName === 'field_cauldron.png' && connection) {
        let nearestDistance = Infinity;
        const HEAT_SOURCE_SNAP_DISTANCE = 200; // Increased for easier placement
        
        // Check campfires
        for (const campfire of connection.db.campfire.iter()) {
            const dx = worldMouseX - campfire.posX;
            const dy = worldMouseY - campfire.posY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < nearestDistance && distance < HEAT_SOURCE_SNAP_DISTANCE) {
                nearestDistance = distance;
                nearestHeatSource = campfire;
                heatSourceType = 'campfire';
            }
        }
        
        // Check fumaroles (always-on heat sources)
        for (const fumarole of connection.db.fumarole.iter()) {
            const dx = worldMouseX - fumarole.posX;
            const dy = worldMouseY - fumarole.posY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < nearestDistance && distance < HEAT_SOURCE_SNAP_DISTANCE) {
                nearestDistance = distance;
                nearestHeatSource = fumarole;
                heatSourceType = 'fumarole';
            }
        }
        
        if (nearestHeatSource) {
            // Snap to heat source position - match server placement exactly
            // Server places pot at: campfire.pos_y - 60.0, fumarole.pos_y - 20.0
            snappedX = nearestHeatSource.posX;
            if (heatSourceType === 'fumarole') {
                snappedY = nearestHeatSource.posY - 10.0; // Fumaroles: small offset above center
            } else {
                snappedY = nearestHeatSource.posY - 60.0; // Campfires: larger offset
            }
        }
    }
    
    // For backward compatibility, keep nearestCampfire reference
    const nearestCampfire = heatSourceType === 'campfire' ? nearestHeatSource : null;

    // Special handling for door placement - snap to nearest foundation edge (N/S only)
    // Ensures the door preview shows exactly where the door will be placed
    let nearestDoorCellX: number | null = null;
    let nearestDoorCellY: number | null = null;
    let doorEdge: number = 0; // 0 = North, 2 = South
    
    if (isDoorPlacement && connection) {
        const FOUNDATION_TILE_SIZE = 96;
        
        // Ensure spatial index is populated for door placement preview
        // Check if foundation spatial index needs rebuilding
        let currentFoundationCount = 0;
        for (const _ of connection.db.foundation_cell.iter()) { 
            currentFoundationCount++; 
            if (currentFoundationCount > lastFoundationCount + 10) break; 
        }
        if (currentFoundationCount !== lastFoundationCount || foundationIndexVersion === 0) {
            rebuildFoundationIndex(connection);
        }
        
        const mouseCellX = Math.floor(worldMouseX / FOUNDATION_TILE_SIZE);
        const mouseCellY = Math.floor(worldMouseY / FOUNDATION_TILE_SIZE);
        let nearestDistance = Infinity;
        
        // Check 3x3 grid around mouse position using spatial index
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const checkCellX = mouseCellX + dx;
                const checkCellY = mouseCellY + dy;
                const foundationsAtCell = foundationSpatialIndex.get(`${checkCellX},${checkCellY}`);
                
                if (foundationsAtCell?.some(f => !f.isDestroyed)) {
                    const foundationCenterX = checkCellX * FOUNDATION_TILE_SIZE + FOUNDATION_TILE_SIZE / 2;
                    const foundationCenterY = checkCellY * FOUNDATION_TILE_SIZE + FOUNDATION_TILE_SIZE / 2;
                    
                    const fdx = worldMouseX - foundationCenterX;
                    const fdy = worldMouseY - foundationCenterY;
                    const distance = Math.sqrt(fdx * fdx + fdy * fdy);
                    
                    if (distance < nearestDistance && distance < FOUNDATION_TILE_SIZE * 1.5) {
                        nearestDistance = distance;
                        nearestDoorCellX = checkCellX;
                        nearestDoorCellY = checkCellY;
                    }
                }
            }
        }
        
        // If spatial index didn't find anything, fall back to direct iteration
        // This handles cases where the index hasn't been built yet
        if (nearestDoorCellX === null) {
            nearestDistance = Infinity;
            for (const foundation of connection.db.foundation_cell.iter()) {
                if (foundation.isDestroyed) continue;
                
                const foundationCenterX = foundation.cellX * FOUNDATION_TILE_SIZE + FOUNDATION_TILE_SIZE / 2;
                const foundationCenterY = foundation.cellY * FOUNDATION_TILE_SIZE + FOUNDATION_TILE_SIZE / 2;
                
                const fdx = worldMouseX - foundationCenterX;
                const fdy = worldMouseY - foundationCenterY;
                const distance = Math.sqrt(fdx * fdx + fdy * fdy);
                
                if (distance < nearestDistance && distance < FOUNDATION_TILE_SIZE * 1.5) {
                    nearestDistance = distance;
                    nearestDoorCellX = foundation.cellX;
                    nearestDoorCellY = foundation.cellY;
                }
            }
        }
        
        if (nearestDoorCellX !== null && nearestDoorCellY !== null) {
            // Determine which edge based on cursor Y relative to foundation center
            const foundationCenterY = nearestDoorCellY * FOUNDATION_TILE_SIZE + FOUNDATION_TILE_SIZE / 2;
            doorEdge = worldMouseY < foundationCenterY ? 0 : 2; // 0 = North, 2 = South
            
            // Snap to edge position - door preview snaps to exact edge of foundation
            // This matches the server-side door placement position
            snappedX = nearestDoorCellX * FOUNDATION_TILE_SIZE + FOUNDATION_TILE_SIZE / 2;
            snappedY = doorEdge === 0 
                ? nearestDoorCellY * FOUNDATION_TILE_SIZE // North edge (top of foundation)
                : (nearestDoorCellY + 1) * FOUNDATION_TILE_SIZE; // South edge (bottom of foundation)
        }
    }

    // Check for water placement restriction
    const isOnWater = isWaterPlacementBlocked(connection, placementInfo, snappedX, snappedY);
    
    // Check for one-seed-per-tile restriction
    const isTileOccupiedBySeed = isSeedPlacementOnOccupiedTile(connection, placementInfo, snappedX, snappedY);
    
    // NOTE: Storage box collision check removed - server handles all collision validation
    
    // Check if shelter is being placed on a foundation (not allowed)
    // Shelter is 384x384px, which covers 4x4 foundation cells (96px each)
    // PERFORMANCE FIX: Use spatial index for O(1) lookups per cell
    const isOnFoundation = placementInfo.itemName === 'Shelter' && connection && 
        (() => {
            const FOUNDATION_TILE_SIZE = 96;
            const centerCellX = Math.floor(snappedX / FOUNDATION_TILE_SIZE);
            const centerCellY = Math.floor(snappedY / FOUNDATION_TILE_SIZE);
            
            // Check 5x5 grid around center (±2 cells in each direction)
            for (let offsetX = -2; offsetX <= 2; offsetX++) {
                for (let offsetY = -2; offsetY <= 2; offsetY++) {
                    const checkCellX = centerCellX + offsetX;
                    const checkCellY = centerCellY + offsetY;
                    
                    const foundationsAtCell = foundationSpatialIndex.get(`${checkCellX},${checkCellY}`);
                    if (foundationsAtCell?.some(f => !f.isDestroyed)) {
                        return true;
                    }
                }
            }
            return false;
        })();
    
    // Check if Matron's Chest is NOT on a foundation (required)
    // PERFORMANCE FIX: Use spatial index for O(1) lookup
    const isNotOnFoundation = placementInfo.itemName === "Matron's Chest" && connection && 
        (() => {
            const FOUNDATION_TILE_SIZE = 96;
            const centerCellX = Math.floor(snappedX / FOUNDATION_TILE_SIZE);
            const centerCellY = Math.floor(snappedY / FOUNDATION_TILE_SIZE);
            
            const foundationsAtCell = foundationSpatialIndex.get(`${centerCellX},${centerCellY}`);
            return !foundationsAtCell?.some(f => !f.isDestroyed); // True if no foundation = invalid placement
        })();
    
    // Check if placement position is on a wall
    const isOnWall = connection ? isPositionOnWall(connection, snappedX, snappedY) : false;
    
    // Check if placement position is in a monument zone (ALK stations, rune stones, hot springs, quarries, asphalt)
    const isInMonumentZone = connection ? isPositionInMonumentZone(connection, snappedX, snappedY) : false;
    
    // Check if broth pot is being placed without a nearby heat source or on one that already has a pot
    const isBrothPotInvalid = placementInfo.iconAssetName === 'field_cauldron.png' && (() => {
        if (!nearestHeatSource || !heatSourceType) {
            return true; // No heat source nearby
        }
        
        if (heatSourceType === 'campfire') {
            // Check if campfire already has a broth pot
            return nearestHeatSource.attachedBrothPotId !== null && nearestHeatSource.attachedBrothPotId !== undefined;
        } else if (heatSourceType === 'fumarole') {
            // Check if fumarole already has a broth pot
            const existingPotOnFumarole = Array.from(connection!.db.broth_pot.iter()).find(
                pot => pot.attachedToFumaroleId === nearestHeatSource.id && !pot.isDestroyed
            );
            return !!existingPotOnFumarole;
        }
        
        return false;
    })();
    
    // Check if door placement is invalid (no foundation, or edge already has wall/door)
    const isDoorInvalid = isDoorPlacement && (() => {
        if (nearestDoorCellX === null || nearestDoorCellY === null || !connection) {
            return true; // No foundation nearby
        }
        
        // Check for existing wall on this edge
        for (const wall of connection.db.wall_cell.iter()) {
            if (wall.cellX === nearestDoorCellX && 
                wall.cellY === nearestDoorCellY && 
                wall.edge === doorEdge && 
                !wall.isDestroyed) {
                return true; // Wall exists on this edge
            }
        }
        
        // Check for existing door on this edge
        for (const door of connection.db.door.iter()) {
            if (door.cellX === nearestDoorCellX && 
                door.cellY === nearestDoorCellY && 
                door.edge === doorEdge) {
                return true; // Door exists on this edge
            }
        }
        
        return false; // Valid placement
    })();
    
    // Apply visual effect - red tint with opacity for any invalid placement
    // For broth pot, only invalid if no campfire or campfire has pot - distance doesn't matter if snapping
    // For door, only invalid if no foundation or edge has existing wall/door
    let isInvalidPlacement: boolean;
    let isPositionValid: boolean; // Position-based validity (excludes placementError) - used to clear stale errors
    let placementWarning: string | null = null;
    if (placementInfo.iconAssetName === 'field_cauldron.png') {
        isInvalidPlacement = isBrothPotInvalid || isInMonumentZone; // Check both campfire validity and monument zone
        isPositionValid = !isInvalidPlacement;
    } else if (isDoorPlacement) {
        isInvalidPlacement = isDoorInvalid || isInMonumentZone; // Check both foundation edge validity and monument zone
        isPositionValid = !isInvalidPlacement;
    } else {
        const { overlaps: isOverlappingPlaceable } = checkPlacementOverlap(connection, placementInfo, snappedX, snappedY);
        isPositionValid = !(isPlacementTooFar || isOnWater || isTileOccupiedBySeed || isOnFoundation || isNotOnFoundation || isOnWall || isInMonumentZone || isOverlappingPlaceable);
        isInvalidPlacement = !isPositionValid || !!placementError;
        // Don't show "Blocked by existing structure" on hover - only on placement action (attemptPlacement)
        placementWarning = null;
        // NOTE: Removed hasStorageBoxCollision - let server handle collision validation consistently for all items (like furnaces)
    }
    
    // When position becomes valid, clear any stale placement error so preview turns blue again
    if (isPositionValid && placementError && onClearPlacementError) {
        onClearPlacementError();
    }

    if (isInvalidPlacement) {
        // Strong red tint for all invalid placements
        ctx.filter = 'sepia(100%) hue-rotate(320deg) saturate(400%) brightness(1.0) contrast(120%)';
        ctx.globalAlpha = 0.8;
    } else {
        // Blue tint for valid placement positions
        ctx.filter = 'sepia(100%) hue-rotate(200deg) saturate(300%) brightness(1.1) contrast(110%)';
        ctx.globalAlpha = 0.7;
    }

    // Calculate the draw position - use centralized config when available
    let adjustedX: number;
    let adjustedY: number;
    
    if (isDoorPlacement) {
        // Apply 44px vertical offset for doors (matches door rendering offset)
        adjustedX = snappedX - drawWidth / 2;
        adjustedY = snappedY - drawHeight / 2 - 44;
    } else if (placementInfo.iconAssetName === 'barbecue.png') {
        // Use centralized visual config for barbecue
        const config = ENTITY_VISUAL_CONFIG.barbecue;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        // Override draw dimensions from config
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.itemName === 'Compost' || placementInfo.iconAssetName === 'compost.png') {
        // Use centralized visual config for compost
        const config = ENTITY_VISUAL_CONFIG.compost;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        // Override draw dimensions from config
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.itemName === 'Tanning Rack' || placementInfo.iconAssetName === 'tanning_rack.png') {
        const config = ENTITY_VISUAL_CONFIG.tanning_rack;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'refrigerator.png') {
        // Use centralized visual config for refrigerator
        const config = ENTITY_VISUAL_CONFIG.refrigerator;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        // Override draw dimensions from config
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'repair_bench.png') {
        // Use centralized visual config for repair bench
        const config = ENTITY_VISUAL_CONFIG.repair_bench;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        // Override draw dimensions from config
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'cooking_station.png') {
        // Use centralized visual config for cooking station
        const config = ENTITY_VISUAL_CONFIG.cooking_station;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        // Override draw dimensions from config
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'scarecrow.png') {
        // Use centralized visual config for scarecrow
        const config = ENTITY_VISUAL_CONFIG.scarecrow;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        // Override draw dimensions from config
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'ancestral_ward.png') {
        // Use centralized visual config for Ancestral Ward
        const config = ENTITY_VISUAL_CONFIG.ancestral_ward;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'signal_disruptor.png') {
        // Use centralized visual config for Signal Disruptor
        const config = ENTITY_VISUAL_CONFIG.signal_disruptor;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'memory_beacon.png') {
        // Use centralized visual config for Memory Resonance Beacon
        const config = ENTITY_VISUAL_CONFIG.memory_beacon;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'turret_tallow.png') {
        // Use centralized visual config for Tallow Steam Turret
        const config = ENTITY_VISUAL_CONFIG.turret;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'reed_rain_collector.png') {
        // Use centralized visual config for Reed Rain Collector
        const config = ENTITY_VISUAL_CONFIG.rain_collector;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (
        placementInfo.iconAssetName === 'sleeping_bag.png' ||
        placementInfo.iconAssetName === 'wolf_pelt.png' ||
        placementInfo.iconAssetName === 'fox_pelt.png' ||
        placementInfo.iconAssetName === 'polar_bear_pelt.png' ||
        placementInfo.iconAssetName === 'walrus_pelt.png'
    ) {
        // Use centralized visual config for sleeping bag (bottom-anchored)
        const config = ENTITY_VISUAL_CONFIG.sleeping_bag;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'large_wood_box.png') {
        // Use centralized visual config for large wooden storage box (bottom-anchored)
        const config = ENTITY_VISUAL_CONFIG.large_wooden_storage_box;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'wooden_storage_box.png') {
        // Use centralized visual config for wooden storage box (bottom-anchored)
        const config = ENTITY_VISUAL_CONFIG.wooden_storage_box;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else {
        // Default: centered on cursor (consistent for all placeable items)
        adjustedX = snappedX - drawWidth / 2;
        adjustedY = snappedY - drawHeight / 2;
    }

    // Draw placement square beneath preview for grid-snapping items
    if (placementConfig) {
        const bounds = getPlacementSquareBounds(snappedX, snappedY, placementConfig);
        ctx.strokeStyle = isInvalidPlacement ? 'rgba(255, 0, 255, 0.5)' : 'rgba(0, 255, 255, 0.4)';
        ctx.lineWidth = 2;
        ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }

    // Draw the preview image or fallback
    if (previewImg && previewImg.complete && previewImg.naturalHeight !== 0) {
        ctx.drawImage(previewImg, adjustedX, adjustedY, drawWidth, drawHeight);
    } else {
        // Fallback rectangle if image not loaded yet
        ctx.fillStyle = isInvalidPlacement ? "rgba(255, 0, 0, 0.4)" : "rgba(255, 255, 255, 0.3)";
        ctx.fillRect(adjustedX, adjustedY, drawWidth, drawHeight);
    }

    ctx.restore(); // Restore original context state
    return placementWarning;
} 
