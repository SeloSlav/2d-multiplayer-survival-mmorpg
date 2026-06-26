/**
 * interactionTargetRuntime - Finds the closest interactable entity for E-key and targeting.
 *
 * Scans all interactable entities (campfires, furnaces, doors, animals, cairns, etc.)
 * within range of the local player and returns the highest-priority target. Used by
 * GameCanvasRuntimeHost to highlight the interactable target and by useInputHandler for E-key.
 *
 * Responsibilities:
 * 1. DISTANCE SCANNING: Computes squared distance from player to each interactable.
 *    Uses entity-specific interaction distances (e.g., campfire vs furnace vs door).
 *
 * 2. PRIORITY SELECTION: When multiple targets overlap, selectHighestPriorityTarget
 *    chooses the most relevant (e.g., door over wall, campfire over furnace).
 *
 * 3. RETENTION: Retains the closest entity ID across frames to avoid flicker when
 *    crossing boundaries. Clears when player moves away.
 *
 * 4. TARGET TYPES: Supports InteractableTarget union (campfire, furnace, door,
 *    animal, cairn, etc.) with type-specific distance and validity checks.
 */

import { DbConnection } from '../../generated';
import {
    Player as SpacetimeDBPlayer,
    Campfire as SpacetimeDBCampfire,
    Furnace as SpacetimeDBFurnace, // ADDED: Furnace import
    Barbecue as SpacetimeDBBarbecue, // ADDED: Barbecue import
    Fumarole as SpacetimeDBFumarole, // ADDED: Fumarole import (volcanic heat source)
    Lantern as SpacetimeDBLantern,
    Turret as SpacetimeDBTurret, // ADDED: Turret import
    HomesteadHearth as SpacetimeDBHomesteadHearth, // ADDED: HomesteadHearth import
    DroppedItem as SpacetimeDBDroppedItem,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    HarvestableResource as SpacetimeDBHarvestableResource,
    PlayerCorpse as SpacetimeDBPlayerCorpse,
    Stash as SpacetimeDBStash,
    SleepingBag as SpacetimeDBSleepingBag,
    Shelter as SpacetimeDBShelter,
    RainCollector as SpacetimeDBRainCollector,
    BrothPot as SpacetimeDBBrothPot,
    Door as SpacetimeDBDoor, // ADDED: Door import
    AlkStation as SpacetimeDBAlkStation, // ADDED: ALK station import
    Cairn as SpacetimeDBCairn, // ADDED: Cairn import
    WildAnimal as SpacetimeDBWildAnimal, // ADDED: Wild animal import for milking
    CaribouBreedingData as SpacetimeDBCaribouBreedingData, // ADDED: Caribou breeding data for milking check
    WalrusBreedingData as SpacetimeDBWalrusBreedingData, // ADDED: Walrus breeding data for milking check
    WorldState as SpacetimeDBWorldState, // ADDED: World state for current game day
    InventoryItem as SpacetimeDBInventoryItem,
    ItemDefinition as SpacetimeDBItemDefinition,
    PlayerDrinkingCooldown as SpacetimeDBPlayerDrinkingCooldown,
} from '../../generated/types';
import { InteractableTarget, InteractionTargetType } from '../../types/interactions';
import { selectHighestPriorityTarget } from '../../types/interactions'; // ADDED: Import priority selection helper
import {
    PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED,
    CAMPFIRE_HEIGHT,
    CAMPFIRE_RENDER_Y_OFFSET
} from '../../utils/renderers/campfireRenderingUtils';
import {
    PLAYER_FURNACE_INTERACTION_DISTANCE_SQUARED,
    PLAYER_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED,
    PLAYER_MONUMENT_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED,
    FURNACE_HEIGHT,
    FURNACE_RENDER_Y_OFFSET,
    LARGE_FURNACE_HEIGHT,
    LARGE_FURNACE_RENDER_Y_OFFSET,
    MONUMENT_LARGE_FURNACE_HEIGHT,
    MONUMENT_LARGE_FURNACE_RENDER_Y_OFFSET,
    FURNACE_TYPE_LARGE
} from '../../utils/renderers/furnaceRenderingUtils'; // ADDED: Furnace rendering constants
import {
    PLAYER_BARBECUE_INTERACTION_DISTANCE_SQUARED,
    BARBECUE_HEIGHT,
    BARBECUE_RENDER_Y_OFFSET
} from '../../utils/renderers/barbecueRenderingUtils'; // ADDED: Barbecue rendering constants
import {
    PLAYER_FUMAROLE_INTERACTION_DISTANCE_SQUARED,
    FUMAROLE_WIDTH,
    FUMAROLE_HEIGHT
} from '../../utils/renderers/fumaroleRenderingUtils'; // ADDED: Fumarole interaction constants
import {
    PLAYER_LANTERN_INTERACTION_DISTANCE_SQUARED,
    LANTERN_HEIGHT,
    LANTERN_RENDER_Y_OFFSET
} from '../../utils/renderers/lanternRenderingUtils';
import {
    PLAYER_HEARTH_INTERACTION_DISTANCE_SQUARED,
    HEARTH_HEIGHT,
    HEARTH_RENDER_Y_OFFSET
} from '../../utils/renderers/hearthRenderingUtils'; // ADDED: Hearth interaction constants
import { PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED } from '../../utils/renderers/playerCorpseRenderingUtils';
import { PLAYER_TURRET_INTERACTION_DISTANCE_SQUARED } from '../../utils/renderers/turretRenderingUtils';
import { PLAYER_BOX_INTERACTION_DISTANCE_SQUARED, PLAYER_BEEHIVE_INTERACTION_DISTANCE_SQUARED, PLAYER_TALL_BOX_INTERACTION_DISTANCE_SQUARED, BOX_HEIGHT, getBoxDimensions, BOX_TYPE_SCARECROW, BOX_TYPE_COMPOST, BOX_TYPE_TANNING_RACK, BOX_TYPE_COOKING_STATION, BOX_TYPE_REPAIR_BENCH, BOX_TYPE_PLAYER_BEEHIVE, BOX_TYPE_WILD_BEEHIVE, BOX_TYPE_WOLF_PELT, BOX_TYPE_FOX_PELT, BOX_TYPE_POLAR_BEAR_PELT, BOX_TYPE_WALRUS_PELT, MONUMENT_COOKING_STATION_WIDTH, MONUMENT_COOKING_STATION_HEIGHT, MONUMENT_REPAIR_BENCH_WIDTH, MONUMENT_REPAIR_BENCH_HEIGHT, MONUMENT_COMPOST_WIDTH, MONUMENT_COMPOST_HEIGHT } from '../../utils/renderers/woodenStorageBoxRenderingUtils';
import { isCompoundMonument } from '../../config/compoundBuildings';
import { PLAYER_DOOR_INTERACTION_DISTANCE_SQUARED, DOOR_RENDER_Y_OFFSET } from '../../utils/renderers/doorRenderingUtils'; // ADDED: Door interaction distance and render offset
import { PLAYER_ALK_STATION_INTERACTION_DISTANCE_SQUARED, ALK_STATION_Y_OFFSET } from '../../utils/renderers/alkStationRenderingUtils'; // ADDED: ALK station interaction distance
import { getResourceConfig } from '../../utils/renderers/resourceConfigurations';
import { isWaterTileTag } from '../../utils/tileTypeGuards';
import type { ResourceType } from '../../types/resourceTypes';

// Generic harvestable resource interaction distance (balanced: 50% increase from original 80px)
const PLAYER_HARVESTABLE_RESOURCE_INTERACTION_DISTANCE_SQUARED = 120.0 * 120.0;
const PLAYER_SLEEPING_BAG_INTERACTION_DISTANCE_SQUARED = PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED;
const PLAYER_KNOCKED_OUT_REVIVE_INTERACTION_DISTANCE_SQUARED = 128.0 * 128.0; // Doubled distance for easier revive access

// NEW: Water drinking interaction distance - close proximity required
const PLAYER_WATER_DRINKING_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0; // Same as server-side distance



// NEW: Tile size constant for water detection
const TILE_SIZE = 48;

// Define the hook's input props
export interface InteractionTargetRuntimeOptions {
    localPlayer: SpacetimeDBPlayer | null | undefined;
    playerPositionOverride?: { x: number; y: number } | null;
    getCurrentPlayerPosition?: () => { x: number; y: number } | null;
    harvestableResources: Map<string, SpacetimeDBHarvestableResource>;
    campfires: Map<string, SpacetimeDBCampfire>;
    furnaces: Map<string, SpacetimeDBFurnace>; // ADDED: Furnace support
    barbecues: Map<string, SpacetimeDBBarbecue>; // ADDED: Barbecue support
    fumaroles: Map<string, SpacetimeDBFumarole>; // ADDED: Fumarole support (volcanic heat source)
    lanterns: Map<string, SpacetimeDBLantern>;
    turrets: Map<string, SpacetimeDBTurret>; // ADDED: Turrets support
    homesteadHearths: Map<string, SpacetimeDBHomesteadHearth>; // ADDED: HomesteadHearths support
    droppedItems: Map<string, SpacetimeDBDroppedItem>;
    woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>;
    playerCorpses: Map<string, SpacetimeDBPlayerCorpse>;
    stashes: Map<string, SpacetimeDBStash>;
    rainCollectors: Map<string, SpacetimeDBRainCollector>;
    brothPots: Map<string, SpacetimeDBBrothPot>;
    doors: Map<string, SpacetimeDBDoor>; // ADDED: Door support
    alkStations: Map<string, SpacetimeDBAlkStation>; // ADDED: ALK station support
    cairns: Map<string, SpacetimeDBCairn>; // ADDED: Cairn support
    sleepingBags: Map<string, SpacetimeDBSleepingBag>;
    players: Map<string, SpacetimeDBPlayer>;
    shelters: Map<string, SpacetimeDBShelter>;
    inventoryItems: Map<string, SpacetimeDBInventoryItem>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    connection: DbConnection | null; // NEW: Connection for water tile access
    playerDrinkingCooldowns: Map<string, SpacetimeDBPlayerDrinkingCooldown>; // NEW: Player drinking cooldowns
    worldTiles?: Map<string, any>; // NEW: World tiles for water detection
    // ADDED: Milkable animal support
    wildAnimals?: Map<string, SpacetimeDBWildAnimal>;
    caribouBreedingData?: Map<string, SpacetimeDBCaribouBreedingData>;
    walrusBreedingData?: Map<string, SpacetimeDBWalrusBreedingData>;
    worldState?: SpacetimeDBWorldState | null;
}

// Define the hook's return type

export interface InteractionTargetRuntimeResult {
    // Single closest target across all types
    closestInteractableTarget: InteractableTarget | null;
    
    // Generic harvestable resource ID (replaces all individual resource types)
    closestInteractableHarvestableResourceId: bigint | null;
    closestInteractableCampfireId: number | null;
    closestInteractableFurnaceId: number | null; // ADDED: Furnace support
    closestInteractableBarbecueId: number | null; // ADDED: Barbecue support
    closestInteractableFumaroleId: number | null; // ADDED: Fumarole support (volcanic heat source)
    closestInteractableLanternId: number | null;
    closestInteractableTurretId: number | null; // ADDED: Turret support
    closestInteractableHearthId: number | null; // ADDED: HomesteadHearth support
    closestInteractableDroppedItemId: bigint | null;
    closestInteractableBoxId: number | null;
    isClosestInteractableBoxEmpty: boolean;
    closestInteractableCorpseId: bigint | null;
    closestInteractableStashId: number | null;
    closestInteractableRainCollectorId: number | null;
    closestInteractableBrothPotId: number | null;
    closestInteractableSleepingBagId: number | null;
    closestInteractableKnockedOutPlayerId: string | null;
    closestInteractableWaterPosition: { x: number; y: number } | null;
    closestInteractableDoorId: bigint | null; // ADDED: Door support
    closestInteractableAlkStationId: number | null; // ADDED: ALK station support
    closestInteractableCairnId: bigint | null; // ADDED: Cairn support
    closestInteractableMilkableAnimalId: bigint | null; // ADDED: Milkable animal support
}

// Constants for box slots (should match server)
const NUM_BOX_SLOTS = 18;
const NUM_LARGE_BOX_SLOTS = 48;
const BOX_TYPE_LARGE = 1;

// --- Locally Defined Interaction Distance Constants (formerly in gameConfig.ts) ---
// PLAYER_BOX_INTERACTION_DISTANCE_SQUARED is now imported from woodenStorageBoxRenderingUtils
export const PLAYER_DROPPED_ITEM_INTERACTION_DISTANCE_SQUARED = 120.0 * 120.0; // Balanced: 87% increase from original 64px, consistent with harvestable resources
// PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED is now imported from playerCorpseRenderingUtils
export const PLAYER_STASH_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0;
export const PLAYER_CAIRN_INTERACTION_DISTANCE_SQUARED = 200.0 * 200.0; // Cairn interaction distance (increased for larger visual)
export const PLAYER_STASH_SURFACE_INTERACTION_DISTANCE_SQUARED = 32.0 * 32.0;
export const PLAYER_RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED = 140.0 * 140.0; // Larger range for big 256x256 sprite
export const PLAYER_MONUMENT_RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED = 250.0 * 250.0; // Monument rain collector (480px, matches server)
export const PLAYER_MONUMENT_BOX_INTERACTION_DISTANCE_SQUARED = 250.0 * 250.0; // Monument cooking station/repair bench (384px building)

// --- Shelter Access Control Constants ---
const SHELTER_COLLISION_WIDTH = 300.0;
const SHELTER_COLLISION_HEIGHT = 125.0;
const SHELTER_AABB_HALF_WIDTH = SHELTER_COLLISION_WIDTH / 2.0;
const SHELTER_AABB_HALF_HEIGHT = SHELTER_COLLISION_HEIGHT / 2.0;
const SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y = 200.0;

// --- Shelter Access Control Helper Functions ---

/**
 * Checks if a player is inside a shelter's AABB
 */
function isPlayerInsideShelter(playerX: number, playerY: number, shelter: SpacetimeDBShelter): boolean {
    const shelterAabbCenterX = shelter.posX;
    const shelterAabbCenterY = shelter.posY - SHELTER_AABB_CENTER_Y_OFFSET_FROM_POS_Y;
    const aabbLeft = shelterAabbCenterX - SHELTER_AABB_HALF_WIDTH;
    const aabbRight = shelterAabbCenterX + SHELTER_AABB_HALF_WIDTH;
    const aabbTop = shelterAabbCenterY - SHELTER_AABB_HALF_HEIGHT;
    const aabbBottom = shelterAabbCenterY + SHELTER_AABB_HALF_HEIGHT;
    
    return playerX >= aabbLeft && playerX <= aabbRight && playerY >= aabbTop && playerY <= aabbBottom;
}

/**
 * Checks if a player can interact with an object at a given position
 * Returns true if:
 * - The object is not inside any shelter, OR
 * - The player is the owner of the shelter containing the object and is also inside that shelter
 */
function canPlayerInteractWithObjectInShelter(
    playerX: number,
    playerY: number,
    playerId: string,
    objectX: number,
    objectY: number,
    shelters: Map<string, SpacetimeDBShelter>
): boolean {
    for (const shelter of shelters.values()) {
        if (shelter.isDestroyed) continue;
        
        // Check if the object is inside this shelter
        if (isPlayerInsideShelter(objectX, objectY, shelter)) {
            // Object is inside this shelter
            // Only allow interaction if player is the owner and is also inside the shelter
            const isOwner = shelter.placedBy.toHexString() === playerId;
            const isPlayerInside = isPlayerInsideShelter(playerX, playerY, shelter);
            
            return isOwner && isPlayerInside;
        }
    }
    
    // Object is not inside any shelter, interaction is allowed
    return true;
}

/**
 * Finds the closest interactable entity of each type within range of the local player.
 */
export const EMPTY_INTERACTION_TARGET_RUNTIME_RESULT: InteractionTargetRuntimeResult = {
    closestInteractableTarget: null,
    closestInteractableHarvestableResourceId: null,
    closestInteractableCampfireId: null,
    closestInteractableFurnaceId: null,
    closestInteractableBarbecueId: null,
    closestInteractableFumaroleId: null,
    closestInteractableLanternId: null,
    closestInteractableTurretId: null,
    closestInteractableHearthId: null,
    closestInteractableDroppedItemId: null,
    closestInteractableBoxId: null,
    isClosestInteractableBoxEmpty: false,
    closestInteractableCorpseId: null,
    closestInteractableStashId: null,
    closestInteractableRainCollectorId: null,
    closestInteractableBrothPotId: null,
    closestInteractableSleepingBagId: null,
    closestInteractableKnockedOutPlayerId: null,
    closestInteractableWaterPosition: null,
    closestInteractableDoorId: null,
    closestInteractableAlkStationId: null,
    closestInteractableCairnId: null,
    closestInteractableMilkableAnimalId: null,
};

export function calculateInteractionTargetRuntimeResult({
    localPlayer,
    playerPositionOverride,
    getCurrentPlayerPosition,
    campfires,
    furnaces, // ADDED: Furnace prop destructuring
    barbecues, // ADDED: Barbecue prop destructuring
    fumaroles, // ADDED: Fumarole prop destructuring (volcanic heat source)
    lanterns,
    turrets, // ADDED: Turrets prop destructuring
    homesteadHearths, // ADDED: HomesteadHearths prop destructuring
    droppedItems,
    woodenStorageBoxes,
    playerCorpses,
    stashes,
    rainCollectors,
    brothPots,
    doors, // ADDED: Door support
    alkStations, // ADDED: ALK station support
    cairns, // ADDED: Cairn support
    sleepingBags,
    players,
    shelters,
    harvestableResources,
    inventoryItems,
    itemDefinitions,
    connection,
    playerDrinkingCooldowns,
    worldTiles,
    // ADDED: Milkable animal support
    wildAnimals,
    caribouBreedingData,
    walrusBreedingData,
    worldState,
}: InteractionTargetRuntimeOptions): InteractionTargetRuntimeResult {
        // Single closest target across all types
        let closestTarget: InteractableTarget | null = null;
        let closestTargetDistSq = Infinity;

        // Generic harvestable resource tracking
        let closestHarvestableResourceId: bigint | null = null;
        let closestHarvestableResourceDistSq = PLAYER_HARVESTABLE_RESOURCE_INTERACTION_DISTANCE_SQUARED;

        let closestCampfireId: number | null = null;
        let closestCampfireDistSq = PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED;

        let closestFurnaceId: number | null = null; // ADDED: Furnace tracking variables
        let closestFurnaceDistSq = PLAYER_MONUMENT_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED; // Use largest threshold for global tracking

        let closestBarbecueId: number | null = null; // ADDED: Barbecue tracking variables
        let closestBarbecueDistSq = PLAYER_BARBECUE_INTERACTION_DISTANCE_SQUARED;

        let closestFumaroleId: number | null = null; // ADDED: Fumarole tracking variables
        let closestFumaroleDistSq = PLAYER_FUMAROLE_INTERACTION_DISTANCE_SQUARED;

        let closestLanternId: number | null = null;
        let closestLanternDistSq = PLAYER_LANTERN_INTERACTION_DISTANCE_SQUARED;

        let closestTurretId: number | null = null; // ADDED: Turret tracking
        let closestTurretDistSq = PLAYER_TURRET_INTERACTION_DISTANCE_SQUARED; // Larger distance for big turret

        let closestHearthId: number | null = null; // ADDED: HomesteadHearth tracking
        let closestHearthDistSq = PLAYER_HEARTH_INTERACTION_DISTANCE_SQUARED;

        let closestDroppedItemId: bigint | null = null;
        let closestDroppedItemDistSq = PLAYER_DROPPED_ITEM_INTERACTION_DISTANCE_SQUARED;

        let closestBoxId: number | null = null;
        // Start with the larger monument distance so monument buildings can be found
        let closestBoxDistSq = PLAYER_MONUMENT_BOX_INTERACTION_DISTANCE_SQUARED;
        let isClosestBoxEmpty = false;

        let closestCorpse: bigint | null = null;
        let closestCorpseDistSq = PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED;

        let closestStashId: number | null = null;

        let closestRainCollectorId: number | null = null;
        let closestRainCollectorDistSq = PLAYER_MONUMENT_RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED;

        let closestBrothPotId: number | null = null;
        let closestBrothPotDistSq = PLAYER_RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED; // Use same distance as rain collectors

        let closestDoorId: bigint | null = null;
        let closestDoorDistSq = PLAYER_DOOR_INTERACTION_DISTANCE_SQUARED; // Increased interaction distance for doors

        let closestAlkStationId: number | null = null;
        let closestAlkStationDistSq = PLAYER_ALK_STATION_INTERACTION_DISTANCE_SQUARED; // ALK delivery station interaction distance

        let closestCairnId: bigint | null = null;
        let closestCairnDistSq = PLAYER_CAIRN_INTERACTION_DISTANCE_SQUARED; // Cairn interaction distance

        let closestMilkableAnimalId: bigint | null = null; // ADDED: Milkable animal tracking
        let closestMilkableAnimalDistSq = 100.0 * 100.0; // 100px interaction distance for milking

        let closestSleepingBagId: number | null = null;
        let closestSleepingBagDistSq = PLAYER_SLEEPING_BAG_INTERACTION_DISTANCE_SQUARED;

        let closestKnockedOutPlayerId: string | null = null;
        let closestKnockedOutPlayerDistSq = PLAYER_KNOCKED_OUT_REVIVE_INTERACTION_DISTANCE_SQUARED;

        let closestWaterPosition: { x: number; y: number } | null = null;
        let closestWaterDistSq = PLAYER_WATER_DRINKING_INTERACTION_DISTANCE_SQUARED;

        // Helper function to update closest target if this one is closer
        const updateClosestTarget = (candidate: InteractableTarget) => {
            const candidateDistSq = candidate.distance * candidate.distance;
            if (candidateDistSq < closestTargetDistSq) {
                closestTargetDistSq = candidateDistSq;
                closestTarget = candidate;
            }
        };

        if (localPlayer) {
            const currentPlayerPosition = getCurrentPlayerPosition?.() ?? playerPositionOverride;
            const playerX = currentPlayerPosition?.x ?? localPlayer.positionX;
            const playerY = currentPlayerPosition?.y ?? localPlayer.positionY;

            // Find closest harvestable resource (generic unified system)
            if (harvestableResources) {
                harvestableResources.forEach((resource) => {
                    // Check if resource is respawning (not available)
                    if (resource.respawnAt && resource.respawnAt.microsSinceUnixEpoch !== 0n) return;
                    
                    // Get resource type and configuration
                    const plantType = resource.plantType?.tag as ResourceType;
                    if (!plantType) return;
                    
                    try {
                        // Validate plant type exists in resource config map.
                        getResourceConfig(plantType);
                        
                        // Keep client interaction range checks aligned with server reducer checks.
                        // Server validates against resource.posX/resource.posY directly.
                        const dx = playerX - resource.posX;
                        const dy = playerY - resource.posY;
                        const distSq = dx * dx + dy * dy;
                        
                        // Check if this is the closest harvestable resource
                        if (distSq < closestHarvestableResourceDistSq) {
                            closestHarvestableResourceDistSq = distSq;
                            closestHarvestableResourceId = resource.id;
                        }
                    } catch (error) {
                        // Unknown plant type, skip
                        return;
                    }
                });
            }

            // Find closest campfire
            if (campfires) {
                campfires.forEach((campfire) => {
                    const visualCenterY = campfire.posY - (CAMPFIRE_HEIGHT / 2) - CAMPFIRE_RENDER_Y_OFFSET;
                    
                    const dx = playerX - campfire.posX;
                    const dy = playerY - visualCenterY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestCampfireDistSq) {
                        // Check shelter access control
                        if (canPlayerInteractWithObjectInShelter(
                            playerX, playerY, localPlayer.identity.toHexString(),
                            campfire.posX, campfire.posY, shelters
                        )) {
                            closestCampfireDistSq = distSq;
                            closestCampfireId = campfire.id;
                        }
                    }
                });
            }

            // Find closest furnace - ADDED: Centered on actual furnace body for seamless interaction
            if (furnaces) {
                furnaces.forEach((furnace) => {
                    // Use furnace type to determine dimensions and interaction distance
                    const isLargeFurnace = furnace.furnaceType === FURNACE_TYPE_LARGE;
                    // Monument large furnaces in compound are 480px tall (warehouse size), regular large furnaces are 256px
                    const isCompoundFurnace = isCompoundMonument(furnace.isMonument, furnace.posX, furnace.posY);
                    const furnaceHeight = isLargeFurnace 
                        ? (isCompoundFurnace ? MONUMENT_LARGE_FURNACE_HEIGHT : LARGE_FURNACE_HEIGHT)
                        : FURNACE_HEIGHT;
                    const furnaceYOffset = isLargeFurnace 
                        ? (isCompoundFurnace ? MONUMENT_LARGE_FURNACE_RENDER_Y_OFFSET : LARGE_FURNACE_RENDER_Y_OFFSET)
                        : FURNACE_RENDER_Y_OFFSET;
                    const maxDistSq = isLargeFurnace 
                        ? (isCompoundFurnace ? PLAYER_MONUMENT_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED : PLAYER_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED) 
                        : PLAYER_FURNACE_INTERACTION_DISTANCE_SQUARED;
                    
                    // Use asymmetric interaction points for better approach from below while keeping top unchanged
                    let interactionCenterY;
                    if (playerY > furnace.posY) {
                        // Player is below furnace - use lower interaction point for easier approach
                        const belowOffset = isLargeFurnace ? (isCompoundFurnace ? 80 : 40) : 10;
                        interactionCenterY = furnace.posY + belowOffset;
                    } else {
                        // Player is above/level with furnace - use normal center point to keep existing behavior
                        interactionCenterY = furnace.posY - (furnaceHeight / 2) - furnaceYOffset;
                    }
                    
                    const dx = playerX - furnace.posX;
                    const dy = playerY - interactionCenterY;
                    const distSq = dx * dx + dy * dy;
                    // Use furnace-specific max distance, but track globally for "closest"
                    if (distSq < maxDistSq && distSq < closestFurnaceDistSq) {
                        // Check shelter access control
                        if (canPlayerInteractWithObjectInShelter(
                            playerX, playerY, localPlayer.identity.toHexString(),
                            furnace.posX, furnace.posY, shelters
                        )) {
                            closestFurnaceDistSq = distSq;
                            closestFurnaceId = furnace.id;
                        }
                    }
                });
            }

            // Find closest barbecue - ADDED: Same pattern as campfire
            if (barbecues) {
                barbecues.forEach((barbecue) => {
                    if (barbecue.isDestroyed) return;
                    // Sprite is CENTERED on posY, so interaction center = posY
                    const visualCenterY = barbecue.posY;
                    
                    const dx = playerX - barbecue.posX;
                    const dy = playerY - visualCenterY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestBarbecueDistSq) {
                        // Check shelter access control
                        if (canPlayerInteractWithObjectInShelter(
                            playerX, playerY, localPlayer.identity.toHexString(),
                            barbecue.posX, barbecue.posY, shelters
                        )) {
                            closestBarbecueDistSq = distSq;
                            closestBarbecueId = barbecue.id;
                        }
                    }
                });
            }

            // Find closest fumarole - ADDED: Volcanic heat source (always-on, opens broth pot UI if present)
            if (fumaroles) {
                fumaroles.forEach((fumarole) => {
                    // Fumaroles are ground-level entities, use their position directly
                    const dx = playerX - fumarole.posX;
                    const dy = playerY - fumarole.posY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestFumaroleDistSq) {
                        closestFumaroleDistSq = distSq;
                        closestFumaroleId = fumarole.id;
                    }
                });
            }

            // Find closest lantern
            if (lanterns) {
                lanterns.forEach((lantern) => {
                    const visualCenterY = lantern.posY - (LANTERN_HEIGHT / 2) - LANTERN_RENDER_Y_OFFSET;
                    
                    const dx = playerX - lantern.posX;
                    const dy = playerY - visualCenterY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestLanternDistSq) {
                        // Check shelter access control
                        if (canPlayerInteractWithObjectInShelter(
                            playerX, playerY, localPlayer.identity.toHexString(),
                            lantern.posX, lantern.posY, shelters
                        )) {
                            closestLanternDistSq = distSq;
                            closestLanternId = lantern.id;
                        }
                    }
                });
            }

            // Find closest turret (skip monument turrets - they cannot be interacted with)
            if (turrets) {
                turrets.forEach((turret: SpacetimeDBTurret) => {
                    if (turret.isDestroyed) return;
                    if (turret.isMonument) return; // Monument turrets cannot be interacted with
                    
                    // Turret sprite is centered on posX/posY - use posY directly
                    const dx = playerX - turret.posX;
                    const dy = playerY - turret.posY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestTurretDistSq) {
                        // Check shelter access control
                        if (canPlayerInteractWithObjectInShelter(
                            playerX, playerY, localPlayer.identity.toHexString(),
                            turret.posX, turret.posY, shelters
                        )) {
                            closestTurretDistSq = distSq;
                            closestTurretId = turret.id;
                        }
                    }
                });
            }

            // Find closest homestead hearth
            if (homesteadHearths) {
                homesteadHearths.forEach((hearth) => {
                    if (hearth.isDestroyed) return;
                    
                    const visualCenterY = hearth.posY - (HEARTH_HEIGHT / 2) - HEARTH_RENDER_Y_OFFSET;
                    
                    const dx = playerX - hearth.posX;
                    const dy = playerY - visualCenterY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestHearthDistSq) {
                        // Check shelter access control
                        if (canPlayerInteractWithObjectInShelter(
                            playerX, playerY, localPlayer.identity.toHexString(),
                            hearth.posX, hearth.posY, shelters
                        )) {
                            closestHearthDistSq = distSq;
                            closestHearthId = hearth.id;
                        }
                    }
                });
            }

            // Find closest dropped item
            if (droppedItems) {
                droppedItems.forEach((item) => {
                    const dx = playerX - item.posX;
                    const dy = playerY - item.posY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestDroppedItemDistSq) {
                        closestDroppedItemDistSq = distSq;
                        closestDroppedItemId = item.id;
                    }
                });
            }

            // Find closest wooden storage box and check emptiness
            if (woodenStorageBoxes) {
                woodenStorageBoxes.forEach((box) => {
                    // Decorative-only box types - no interaction, no blue box, no E label
                    if (
                        box.boxType === BOX_TYPE_SCARECROW ||
                        box.boxType === BOX_TYPE_WOLF_PELT ||
                        box.boxType === BOX_TYPE_FOX_PELT ||
                        box.boxType === BOX_TYPE_POLAR_BEAR_PELT ||
                        box.boxType === BOX_TYPE_WALRUS_PELT
                    ) {
                        return;
                    }
                    
                    // Compound monument cooking stations / repair benches / compost use monument building interaction
                    const isCompoundBldg = isCompoundMonument(box.isMonument, box.posX, box.posY);
                    const isMonumentBuilding = isCompoundBldg && (box.boxType === BOX_TYPE_COOKING_STATION || box.boxType === BOX_TYPE_REPAIR_BENCH || box.boxType === BOX_TYPE_COMPOST);
                    
                    let visualCenterY: number;
                    let maxDistSq: number;
                    
                    if (isMonumentBuilding) {
                        // Monument buildings: 384px sprite with 96px anchor offset
                        const h = box.boxType === BOX_TYPE_COOKING_STATION ? MONUMENT_COOKING_STATION_HEIGHT : box.boxType === BOX_TYPE_COMPOST ? MONUMENT_COMPOST_HEIGHT : MONUMENT_REPAIR_BENCH_HEIGHT;
                        const anchorOffset = 96;
                        // Visual center: drawY = posY - h + anchorOffset, center = drawY + h/2
                        visualCenterY = box.posY - h + anchorOffset + h / 2;
                        maxDistSq = PLAYER_MONUMENT_BOX_INTERACTION_DISTANCE_SQUARED;
                    } else {
                        // Regular boxes: drawY = posY - height - 20
                        const dims = getBoxDimensions(box.boxType);
                        visualCenterY = box.posY - (dims.height / 2) - 20;
                        const isTallBox = box.boxType === BOX_TYPE_REPAIR_BENCH || box.boxType === BOX_TYPE_COOKING_STATION || box.boxType === BOX_TYPE_COMPOST || box.boxType === BOX_TYPE_TANNING_RACK;
                        maxDistSq = (box.boxType === BOX_TYPE_PLAYER_BEEHIVE || box.boxType === BOX_TYPE_WILD_BEEHIVE)
                            ? PLAYER_BEEHIVE_INTERACTION_DISTANCE_SQUARED
                            : isTallBox
                                ? PLAYER_TALL_BOX_INTERACTION_DISTANCE_SQUARED
                                : PLAYER_BOX_INTERACTION_DISTANCE_SQUARED;
                    }
                    
                    const dx = playerX - box.posX;
                    const dy = playerY - visualCenterY; // Use visual center for interaction distance
                    const distSq = dx * dx + dy * dy;
                    if (distSq < maxDistSq && distSq < closestBoxDistSq) {
                        // Check shelter access control (use original stored position for shelter checks)
                        if (canPlayerInteractWithObjectInShelter(
                            playerX, playerY, localPlayer.identity.toHexString(),
                            box.posX, box.posY, shelters
                        )) {
                            closestBoxDistSq = distSq;
                            closestBoxId = box.id;
                            // Check if this closest box is empty (slot count depends on boxType)
                            let isEmpty = true;
                            const slotCount = box.boxType === BOX_TYPE_LARGE ? NUM_LARGE_BOX_SLOTS : NUM_BOX_SLOTS;
                            for (let i = 0; i < slotCount; i++) {
                                const slotKey = `slotInstanceId${i}` as keyof SpacetimeDBWoodenStorageBox;
                                if (box[slotKey] !== null && box[slotKey] !== undefined) {
                                    isEmpty = false;
                                    break;
                                }
                            }
                            isClosestBoxEmpty = isEmpty;
                        }
                    }
                });
            }

            // Find closest player corpse
            if (playerCorpses) {
                playerCorpses.forEach((corpse) => {
                    const dx = playerX - corpse.posX;
                    const dy = playerY - corpse.posY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestCorpseDistSq) {
                        // Check shelter access control
                        if (canPlayerInteractWithObjectInShelter(
                            playerX, playerY, localPlayer.identity.toHexString(),
                            corpse.posX, corpse.posY, shelters
                        )) {
                            closestCorpseDistSq = distSq;
                            closestCorpse = corpse.id as unknown as bigint;
                        }
                    }
                });
            }

            // Find closest stash
            if (stashes) {
                let currentMinDistSq = Infinity;

                stashes.forEach((stash) => {
                    const dx = playerX - stash.posX;
                    const dy = playerY - stash.posY;
                    const distSq = dx * dx + dy * dy;

                    // Determine the correct interaction radius based on stash visibility
                    const interactionThresholdSq = stash.isHidden
                        ? 24.0 * 24.0
                        : 48.0 * 48.0;

                    // Check if the stash is within its applicable interaction radius
                    if (distSq < interactionThresholdSq) {
                        // Check shelter access control
                        if (canPlayerInteractWithObjectInShelter(
                            playerX, playerY, localPlayer.identity.toHexString(),
                            stash.posX, stash.posY, shelters
                        )) {
                            // If it's within the radius, check if it's closer than any previous candidate
                            if (distSq < currentMinDistSq) {
                                currentMinDistSq = distSq;
                                closestStashId = stash.id; // Set the main closestStashId directly here
                            }
                        }
                    }
                });
                // closestStashId is now correctly set to the ID of the stash that is
                // within its specific interaction range AND is the closest among such stashes.
            }

            // Find closest rain collector
            if (rainCollectors) {
                // DEBUG: Log rain collector search
                // if (rainCollectors.size > 0) {
                //     console.log('[InteractionFinder] Searching rain collectors:', {
                //         playerPos: { x: playerX, y: playerY },
                //         rainCollectorCount: rainCollectors.size,
                //         rainCollectorPositions: Array.from(rainCollectors.values()).map(rc => ({ id: rc.id, pos: { x: rc.posX, y: rc.posY }, destroyed: rc.isDestroyed }))
                //     });
                // }
                
                rainCollectors.forEach((rainCollector) => {
                    if (rainCollector.isDestroyed) return;
                    
                    // Use appropriate distance threshold based on compound monument status
                    const maxDistSq = isCompoundMonument(rainCollector.isMonument, rainCollector.posX, rainCollector.posY)
                        ? PLAYER_MONUMENT_RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED
                        : PLAYER_RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED;
                    
                    const dx = playerX - rainCollector.posX;
                    const dy = playerY - rainCollector.posY;
                    const distSq = dx * dx + dy * dy;
                    
                    if (distSq < maxDistSq && distSq < closestRainCollectorDistSq) {
                        // Check shelter access control
                        if (canPlayerInteractWithObjectInShelter(
                            playerX, playerY, localPlayer.identity.toHexString(),
                            rainCollector.posX, rainCollector.posY, shelters
                        )) {
                            // console.log(`[InteractionFinder] Rain collector ${rainCollector.id} is now closest interactable`);
                            closestRainCollectorDistSq = distSq;
                            closestRainCollectorId = rainCollector.id;
                        } else {
                            // console.log(`[InteractionFinder] Rain collector ${rainCollector.id} blocked by shelter access control`);
                        }
                    }
                });
            }

            // Find closest broth pot
            if (brothPots) {
                brothPots.forEach((brothPot) => {
                    if (brothPot.isDestroyed) return;
                    
                    const dx = playerX - brothPot.posX;
                    const dy = playerY - brothPot.posY;
                    const distSq = dx * dx + dy * dy;
                    
                    if (distSq < closestBrothPotDistSq) {
                        // Check shelter access control
                        if (canPlayerInteractWithObjectInShelter(
                            playerX, playerY, localPlayer.identity.toHexString(),
                            brothPot.posX, brothPot.posY, shelters
                        )) {
                            closestBrothPotDistSq = distSq;
                            closestBrothPotId = brothPot.id;
                        }
                    }
                });
            }

            // Find closest door
            if (doors) {
                doors.forEach((door) => {
                    // Doors are rendered 44px higher than their actual position
                    // Use the visual position for interaction checks
                    const visualDoorY = door.posY - DOOR_RENDER_Y_OFFSET;
                    const dx = playerX - door.posX;
                    const dy = playerY - visualDoorY; // Use visual Y position
                    const distSq = dx * dx + dy * dy;
                    
                    if (distSq < closestDoorDistSq) {
                        // Check shelter access control (use actual position for shelter check)
                        if (canPlayerInteractWithObjectInShelter(
                            playerX, playerY, localPlayer.identity.toHexString(),
                            door.posX, door.posY, shelters
                        )) {
                            closestDoorDistSq = distSq;
                            closestDoorId = door.id;
                        }
                    }
                });
            }

            // Find closest ALK delivery station
            if (alkStations) {
                alkStations.forEach((station) => {
                    if (!station.isActive) return; // Skip inactive stations
                    
                    // ALK stations use worldPosX/worldPosY as their base position
                    // For interaction, we use the base position (where players approach from)
                    const dx = playerX - station.worldPosX;
                    const dy = playerY - station.worldPosY;
                    const distSq = dx * dx + dy * dy;
                    
                    if (distSq < closestAlkStationDistSq) {
                        closestAlkStationDistSq = distSq;
                        closestAlkStationId = station.stationId;
                    }
                });
            }

            // Find closest cairn
            if (cairns) {
                cairns.forEach((cairn) => {
                    const dx = playerX - cairn.posX;
                    const dy = playerY - cairn.posY;
                    const distSq = dx * dx + dy * dy;
                    
                    if (distSq < closestCairnDistSq) {
                        closestCairnDistSq = distSq;
                        closestCairnId = cairn.id;
                    }
                });
            }

            // ADDED: Find closest milkable animal (tamed female adult caribou/walrus)
            if (wildAnimals && localPlayer) {
                const currentDay = worldState?.cycleCount ?? 0;
                
                wildAnimals.forEach((animal) => {
                    // Skip dead animals
                    if (animal.health <= 0) return;
                    
                    // Must be tamed by the local player
                    if (!animal.tamedBy || !localPlayer.identity || !animal.tamedBy.isEqual(localPlayer.identity)) return;
                    
                    // Check if it's a milkable species (Caribou or ArcticWalrus)
                    const speciesTag = animal.species?.tag;
                    if (speciesTag !== 'Caribou' && speciesTag !== 'ArcticWalrus') return;
                    
                    // Get breeding data and check milkability
                    let isMilkable = false;
                    
                    if (speciesTag === 'Caribou' && caribouBreedingData) {
                        const breedingData = caribouBreedingData.get(animal.id.toString());
                        if (breedingData) {
                            // Must be female adult
                            if (breedingData.sex?.tag === 'Female' && breedingData.ageStage?.tag === 'Adult') {
                                // Check if not milked today (use any cast for lastMilkedDay until bindings regenerated)
                                const lastMilkedDay = (breedingData as any).lastMilkedDay;
                                isMilkable = lastMilkedDay === null || lastMilkedDay === undefined || lastMilkedDay < currentDay;
                            }
                        }
                    } else if (speciesTag === 'ArcticWalrus' && walrusBreedingData) {
                        const breedingData = walrusBreedingData.get(animal.id.toString());
                        if (breedingData) {
                            // Must be female adult
                            if (breedingData.sex?.tag === 'Female' && breedingData.ageStage?.tag === 'Adult') {
                                // Check if not milked today (use any cast for lastMilkedDay until bindings regenerated)
                                const lastMilkedDay = (breedingData as any).lastMilkedDay;
                                isMilkable = lastMilkedDay === null || lastMilkedDay === undefined || lastMilkedDay < currentDay;
                            }
                        }
                    }
                    
                    if (!isMilkable) return;
                    
                    // Calculate distance
                    const dx = playerX - animal.posX;
                    const dy = playerY - animal.posY;
                    const distSq = dx * dx + dy * dy;
                    
                    if (distSq < closestMilkableAnimalDistSq) {
                        closestMilkableAnimalDistSq = distSq;
                        closestMilkableAnimalId = animal.id;
                    }
                });
            }

            // Find closest knocked out player (excluding local player)
            if (players) {
                players.forEach((player) => {
                    // Skip if it's the local player or player is not knocked out or is dead or offline
                    if (localPlayer && player.identity && localPlayer.identity && player.identity.isEqual(localPlayer.identity)) {
                        return; // Skip local player
                    }
                    if (!player.isOnline) {
                        return; // Skip offline players - they're represented by corpses
                    }
                    if (!player.isKnockedOut || player.isDead) {
                        return; // Skip if not knocked out or is dead
                    }
                    
                    const dx = playerX - player.positionX;
                    const dy = playerY - player.positionY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestKnockedOutPlayerDistSq) {
                        closestKnockedOutPlayerDistSq = distSq;
                        closestKnockedOutPlayerId = player.identity.toHexString();
                    }
                });
            }

            // Find closest water position
            // IMPORTANT: Don't allow drinking while snorkeling (underwater) - prevents race condition with fumarole interaction
            if (connection && !localPlayer.isSnorkeling) {
                // Check if player has drinking cooldown first
                const playerIdHex = localPlayer.identity.toHexString();
                const drinkingCooldown = playerDrinkingCooldowns?.get(playerIdHex);
                
                let isOnCooldown = false;
                if (drinkingCooldown) {
                    const currentTime = Date.now() * 1000; // Convert to microseconds
                    const timeSinceLastDrink = currentTime - Number(drinkingCooldown.lastDrinkTime.__timestamp_micros_since_unix_epoch__);
                    const cooldownMicros = 1000 * 1000; // 1 second in microseconds
                    isOnCooldown = timeSinceLastDrink < cooldownMicros;
                }
                
                // Only check for water tiles if not on cooldown
                if (!isOnCooldown) {
                    // Check for water tiles in a small radius around the player
                    const checkRadiusTiles = 2; // Check 2 tiles around player (matches server-side logic)
                    const playerTileX = Math.floor(playerX / TILE_SIZE);
                    const playerTileY = Math.floor(playerY / TILE_SIZE);
                    
                    for (let dy = -checkRadiusTiles; dy <= checkRadiusTiles; dy++) {
                        for (let dx = -checkRadiusTiles; dx <= checkRadiusTiles; dx++) {
                            const checkTileX = playerTileX + dx;
                            const checkTileY = playerTileY + dy;
                            
                            // Calculate tile center position
                            const tileCenterX = (checkTileX + 0.5) * TILE_SIZE;
                            const tileCenterY = (checkTileY + 0.5) * TILE_SIZE;
                            
                            // Calculate distance from player to tile center
                            const distanceToTileSq = (playerX - tileCenterX) * (playerX - tileCenterX) + 
                                                   (playerY - tileCenterY) * (playerY - tileCenterY);
                            
                            // Only check tiles within drinking distance
                            if (distanceToTileSq <= closestWaterDistSq) {
                                // Check if this tile is water using the new world tiles system
                                if (worldTiles) {
                                    const tileKey = `${checkTileX}_${checkTileY}`;
                                    const tile = worldTiles.get(tileKey);
                                    if (tile && isWaterTileTag(tile.tileType.tag)) {
                                        // This is a water tile and it's closer than our current closest
                                        closestWaterDistSq = distanceToTileSq;
                                        closestWaterPosition = { x: tileCenterX, y: tileCenterY };
                                    }
                                }
                            }
                        }
                        
                        // Early exit if we found very close water
                        if (closestWaterPosition && closestWaterDistSq < (32.0 * 32.0)) {
                            break;
                        }
                    }
                }
            }

            // After all searches, determine the single closest target across all types
            const candidates: InteractableTarget[] = [];

            // Add closest harvestable resource to candidates if one was found
            if (closestHarvestableResourceId) {
                const harvestableResource = harvestableResources?.get(String(closestHarvestableResourceId));
                if (harvestableResource) {
                    candidates.push({
                        type: 'harvestable_resource',
                        id: closestHarvestableResourceId,
                        position: { x: harvestableResource.posX, y: harvestableResource.posY },
                        distance: Math.sqrt(closestHarvestableResourceDistSq)
                    });
                }
            }
            if (closestCampfireId) {
                candidates.push({
                    type: 'campfire',
                    id: closestCampfireId,
                    position: { x: 0, y: 0 },
                    distance: Math.sqrt(closestCampfireDistSq)
                });
            }
            if (closestFurnaceId) { // ADDED: Furnace candidate
                candidates.push({
                    type: 'furnace',
                    id: closestFurnaceId,
                    position: { x: 0, y: 0 },
                    distance: Math.sqrt(closestFurnaceDistSq)
                });
            }
            if (closestBarbecueId) { // ADDED: Barbecue candidate
                candidates.push({
                    type: 'barbecue',
                    id: closestBarbecueId,
                    position: { x: 0, y: 0 },
                    distance: Math.sqrt(closestBarbecueDistSq)
                });
            }
            if (closestFumaroleId) { // ADDED: Fumarole candidate (volcanic heat source)
                const fumarole = fumaroles?.get(String(closestFumaroleId));
                if (fumarole) {
                    candidates.push({
                        type: 'fumarole',
                        id: closestFumaroleId,
                        position: { x: fumarole.posX, y: fumarole.posY },
                        distance: Math.sqrt(closestFumaroleDistSq)
                    });
                }
            }
            if (closestTurretId !== null) {
                const turret = turrets?.get(String(closestTurretId));
                if (turret) {
                    candidates.push({
                        type: 'turret' as InteractionTargetType,
                        id: closestTurretId,
                        position: { x: turret.posX, y: turret.posY },
                        distance: Math.sqrt(closestTurretDistSq)
                    });
                }
            }
            if (closestLanternId) {
                const lantern = lanterns?.get(String(closestLanternId));
                let isEmpty = true;
                if (lantern) {
                    // Determine the required fuel type based on lantern type
                    // lanternType: 0 = Lantern, 1 = Ancestral Ward (Tallow)
                    // lanternType: 2 = Signal Disruptor, 3 = Memory Beacon (Scrap Batteries)
                    const requiredFuel = (lantern.lanternType === 2 || lantern.lanternType === 3) 
                        ? "Scrap Batteries" 
                        : "Tallow";
                    
                    // Check if lantern has valid fuel items (match server-side logic)
                    if (lantern.fuelInstanceId0 !== undefined && lantern.fuelInstanceId0 > 0n) {
                        // Check if the actual item exists and is the correct fuel type
                        const fuelItem = inventoryItems?.get(String(lantern.fuelInstanceId0));
                        if (fuelItem) {
                            const itemDef = itemDefinitions?.get(String(fuelItem.itemDefId));
                            if (itemDef && itemDef.name === requiredFuel && fuelItem.quantity > 0) {
                                isEmpty = false;
                            }
                        }
                    }
                }
                candidates.push({
                    type: 'lantern',
                    id: closestLanternId,
                    position: { x: 0, y: 0 },
                    distance: Math.sqrt(closestLanternDistSq),
                    data: {
                        isEmpty: isEmpty
                    }
                });
            }
            if (closestHearthId) { // ADDED: HomesteadHearth candidate
                candidates.push({
                    type: 'homestead_hearth',
                    id: closestHearthId,
                    position: { x: 0, y: 0 },
                    distance: Math.sqrt(closestHearthDistSq)
                });
            }
            if (closestDroppedItemId) {
                candidates.push({
                    type: 'dropped_item',
                    id: closestDroppedItemId,
                    position: { x: 0, y: 0 },
                    distance: Math.sqrt(closestDroppedItemDistSq)
                });
            }
            if (closestBoxId) {
                candidates.push({
                    type: 'box',
                    id: closestBoxId,
                    position: { x: 0, y: 0 },
                    distance: Math.sqrt(closestBoxDistSq),
                    data: {
                        isEmpty: isClosestBoxEmpty
                    }
                });
            }
            if (closestCorpse) {
                candidates.push({
                    type: 'corpse',
                    id: closestCorpse,
                    position: { x: 0, y: 0 },
                    distance: Math.sqrt(closestCorpseDistSq)
                });
            }
            if (closestStashId !== null && typeof closestStashId === 'number') {
                const stash = stashes?.get(String(closestStashId));
                if (stash && localPlayer) {
                    // Calculate distance for the closest stash
                    const dx = localPlayer.positionX - stash.posX;
                    const dy = localPlayer.positionY - stash.posY;
                    const stashDistSq = dx * dx + dy * dy;
                    candidates.push({
                        type: 'stash',
                        id: closestStashId,
                        position: { x: stash.posX, y: stash.posY },
                        distance: Math.sqrt(stashDistSq)
                    });
                }
            }
            if (closestRainCollectorId) {
                const rainCollector = rainCollectors?.get(String(closestRainCollectorId));
                if (rainCollector) {
                    candidates.push({
                        type: 'rain_collector',
                        id: closestRainCollectorId,
                        position: { x: rainCollector.posX, y: rainCollector.posY },
                        distance: Math.sqrt(closestRainCollectorDistSq)
                    });
                }
            }
            if (closestSleepingBagId) {
                candidates.push({
                    type: 'sleeping_bag',
                    id: closestSleepingBagId,
                    position: { x: 0, y: 0 },
                    distance: Math.sqrt(closestSleepingBagDistSq)
                });
            }
            if (closestKnockedOutPlayerId) {
                candidates.push({
                    type: 'knocked_out_player',
                    id: closestKnockedOutPlayerId,
                    position: { x: 0, y: 0 },
                    distance: Math.sqrt(closestKnockedOutPlayerDistSq)
                });
            }
            if (closestWaterPosition) {
                candidates.push({
                    type: 'water',
                    id: 'water', // Water doesn't have a real ID
                    position: closestWaterPosition,
                    distance: Math.sqrt(closestWaterDistSq)
                });
            }
            if (closestDoorId) {
                const door = doors?.get(String(closestDoorId));
                if (door) {
                    candidates.push({
                        type: 'door',
                        id: closestDoorId,
                        position: { x: door.posX, y: door.posY },
                        distance: Math.sqrt(closestDoorDistSq)
                    });
                }
            }
            if (closestAlkStationId !== null) { // CRITICAL: Check for null explicitly since station ID 0 is valid (central compound)
                const station = alkStations?.get(String(closestAlkStationId));
                if (station) {
                    candidates.push({
                        type: 'alk_station',
                        id: closestAlkStationId,
                        position: { x: station.worldPosX, y: station.worldPosY },
                        distance: Math.sqrt(closestAlkStationDistSq)
                    });
                }
            }
            if (closestCairnId !== null) {
                const cairn = cairns?.get(String(closestCairnId));
                if (cairn) {
                    candidates.push({
                        type: 'cairn',
                        id: closestCairnId,
                        position: { x: cairn.posX, y: cairn.posY },
                        distance: Math.sqrt(closestCairnDistSq)
                    });
                }
            }
            // ADDED: Add milkable animal to candidates
            if (closestMilkableAnimalId !== null) {
                const animal = wildAnimals?.get(String(closestMilkableAnimalId));
                if (animal) {
                    candidates.push({
                        type: 'milkable_animal',
                        id: closestMilkableAnimalId,
                        position: { x: animal.posX, y: animal.posY },
                        distance: Math.sqrt(closestMilkableAnimalDistSq)
                    });
                }
            }
            // Broth pot removed from candidates - it now works through campfire interaction

            // Find the closest target using priority selection
            if (candidates.length > 0) {
                closestTarget = selectHighestPriorityTarget(candidates);
            }
        }

        const calculatedResult: InteractionTargetRuntimeResult = {
            closestInteractableTarget: closestTarget,
            closestInteractableHarvestableResourceId: closestHarvestableResourceId,
            closestInteractableCampfireId: closestCampfireId,
            closestInteractableFurnaceId: closestFurnaceId, // ADDED: Furnace return
            closestInteractableBarbecueId: closestBarbecueId, // ADDED: Barbecue return
            closestInteractableFumaroleId: closestFumaroleId, // ADDED: Fumarole return
            closestInteractableLanternId: closestLanternId,
            closestInteractableTurretId: closestTurretId, // ADDED: Turret return
            closestInteractableHearthId: closestHearthId, // ADDED: HomesteadHearth return
            closestInteractableDroppedItemId: closestDroppedItemId,
            closestInteractableBoxId: closestBoxId,
            isClosestInteractableBoxEmpty: isClosestBoxEmpty,
            closestInteractableCorpseId: closestCorpse,
            closestInteractableStashId: closestStashId,
            closestInteractableRainCollectorId: closestRainCollectorId,
            closestInteractableBrothPotId: closestBrothPotId,
            closestInteractableSleepingBagId: closestSleepingBagId,
            closestInteractableKnockedOutPlayerId: closestKnockedOutPlayerId,
            closestInteractableWaterPosition: closestWaterPosition,
            closestInteractableDoorId: closestDoorId, // ADDED: Door support
            closestInteractableAlkStationId: closestAlkStationId, // ADDED: ALK station support
            closestInteractableCairnId: closestCairnId, // ADDED: Cairn support
            closestInteractableMilkableAnimalId: closestMilkableAnimalId, // ADDED: Milkable animal support
        };

        return calculatedResult;
}
