import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
    Player as SpacetimeDBPlayer,
    Campfire as SpacetimeDBCampfire,
    Furnace as SpacetimeDBFurnace, // ADDED: Furnace import
    Lantern as SpacetimeDBLantern,
    DroppedItem as SpacetimeDBDroppedItem,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    HarvestableResource as SpacetimeDBHarvestableResource,
    PlayerCorpse as SpacetimeDBPlayerCorpse,
    Stash as SpacetimeDBStash,
    SleepingBag as SpacetimeDBSleepingBag,
    Shelter as SpacetimeDBShelter,
    RainCollector as SpacetimeDBRainCollector,
    DbConnection,
    InventoryItem as SpacetimeDBInventoryItem,
    ItemDefinition as SpacetimeDBItemDefinition,
    PlayerDrinkingCooldown as SpacetimeDBPlayerDrinkingCooldown,
} from '../generated';
import { InteractableTarget } from '../types/interactions';
import { selectHighestPriorityTarget } from '../types/interactions'; // ADDED: Import priority selection helper
import {
    PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED,
    CAMPFIRE_HEIGHT,
    CAMPFIRE_RENDER_Y_OFFSET
} from '../utils/renderers/campfireRenderingUtils';
import {
    PLAYER_FURNACE_INTERACTION_DISTANCE_SQUARED,
    FURNACE_HEIGHT,
    FURNACE_RENDER_Y_OFFSET
} from '../utils/renderers/furnaceRenderingUtils'; // ADDED: Furnace rendering constants
import {
    PLAYER_LANTERN_INTERACTION_DISTANCE_SQUARED,
    LANTERN_HEIGHT,
    LANTERN_RENDER_Y_OFFSET
} from '../utils/renderers/lanternRenderingUtils';
import { PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED } from '../utils/renderers/playerCorpseRenderingUtils';
import { PLAYER_BOX_INTERACTION_DISTANCE_SQUARED, BOX_HEIGHT } from '../utils/renderers/woodenStorageBoxRenderingUtils';
import { getResourceConfig } from '../utils/renderers/resourceConfigurations';
import type { ResourceType } from '../types/resourceTypes';

// Generic harvestable resource interaction distance
const PLAYER_HARVESTABLE_RESOURCE_INTERACTION_DISTANCE_SQUARED = 120.0 * 120.0;
const PLAYER_SLEEPING_BAG_INTERACTION_DISTANCE_SQUARED = PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED;
const PLAYER_KNOCKED_OUT_REVIVE_INTERACTION_DISTANCE_SQUARED = 128.0 * 128.0; // Doubled distance for easier revive access

// NEW: Water drinking interaction distance - close proximity required
const PLAYER_WATER_DRINKING_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0; // Same as server-side distance



// NEW: Tile size constant for water detection
const TILE_SIZE = 48;

// Define the hook's input props
interface UseInteractionFinderProps {
    localPlayer: SpacetimeDBPlayer | null | undefined;
    harvestableResources: Map<string, SpacetimeDBHarvestableResource>;
    campfires: Map<string, SpacetimeDBCampfire>;
    furnaces: Map<string, SpacetimeDBFurnace>; // ADDED: Furnace support
    lanterns: Map<string, SpacetimeDBLantern>;
    droppedItems: Map<string, SpacetimeDBDroppedItem>;
    woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>;
    playerCorpses: Map<string, SpacetimeDBPlayerCorpse>;
    stashes: Map<string, SpacetimeDBStash>;
    rainCollectors: Map<string, SpacetimeDBRainCollector>;
    sleepingBags: Map<string, SpacetimeDBSleepingBag>;
    players: Map<string, SpacetimeDBPlayer>;
    shelters: Map<string, SpacetimeDBShelter>;

    inventoryItems: Map<string, SpacetimeDBInventoryItem>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    connection: DbConnection | null; // NEW: Connection for water tile access
    playerDrinkingCooldowns: Map<string, SpacetimeDBPlayerDrinkingCooldown>; // NEW: Player drinking cooldowns
    worldTiles?: Map<string, any>; // NEW: World tiles for water detection
}

// Define the hook's return type

interface UseInteractionFinderResult {
    // Single closest target across all types
    closestInteractableTarget: InteractableTarget | null;
    
    // Generic harvestable resource ID (replaces all individual resource types)
    closestInteractableHarvestableResourceId: bigint | null;
    closestInteractableCampfireId: number | null;
    closestInteractableFurnaceId: number | null; // ADDED: Furnace support
    closestInteractableLanternId: number | null;
    closestInteractableDroppedItemId: bigint | null;
    closestInteractableBoxId: number | null;
    isClosestInteractableBoxEmpty: boolean;
    closestInteractableCorpseId: bigint | null;
    closestInteractableStashId: number | null;
    closestInteractableRainCollectorId: number | null;
    closestInteractableSleepingBagId: number | null;
    closestInteractableKnockedOutPlayerId: string | null;
    closestInteractableWaterPosition: { x: number; y: number } | null;
}

// Constants for box slots (should match server if possible, or keep fixed)
const NUM_BOX_SLOTS = 18;

const INTERACTION_CHECK_INTERVAL = 100; // ms

// --- Locally Defined Interaction Distance Constants (formerly in gameConfig.ts) ---
// PLAYER_BOX_INTERACTION_DISTANCE_SQUARED is now imported from woodenStorageBoxRenderingUtils
export const PLAYER_DROPPED_ITEM_INTERACTION_DISTANCE_SQUARED = 100.0 * 100.0;
// PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED is now imported from playerCorpseRenderingUtils
export const PLAYER_STASH_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0;
export const PLAYER_STASH_SURFACE_INTERACTION_DISTANCE_SQUARED = 32.0 * 32.0;
export const PLAYER_RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED = 96.0 * 96.0;

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
export function useInteractionFinder({
    localPlayer,
    campfires,
    furnaces, // ADDED: Furnace prop destructuring
    lanterns,
    droppedItems,
    woodenStorageBoxes,
    playerCorpses,
    stashes,
    rainCollectors,
    sleepingBags,
    players,
    shelters,
    harvestableResources,
    inventoryItems,
    itemDefinitions,
    connection,
    playerDrinkingCooldowns,
    worldTiles,
}: UseInteractionFinderProps): UseInteractionFinderResult {

    // State for closest interactable IDs
    const [closestInteractableHarvestableResourceId, setClosestInteractableHarvestableResourceId] = useState<bigint | null>(null);
    const [closestInteractableCampfireId, setClosestInteractableCampfireId] = useState<number | null>(null);
    const [closestInteractableFurnaceId, setClosestInteractableFurnaceId] = useState<number | null>(null); // ADDED: Furnace state
    const [closestInteractableLanternId, setClosestInteractableLanternId] = useState<number | null>(null);
    const [closestInteractableDroppedItemId, setClosestInteractableDroppedItemId] = useState<bigint | null>(null);
    const [closestInteractableBoxId, setClosestInteractableBoxId] = useState<number | null>(null);
    const [isClosestInteractableBoxEmpty, setIsClosestInteractableBoxEmpty] = useState<boolean>(false);
    const [closestInteractableCorpseId, setClosestInteractableCorpseId] = useState<bigint | null>(null);
    const [closestInteractableStashId, setClosestInteractableStashId] = useState<number | null>(null);
    const [closestInteractableRainCollectorId, setClosestInteractableRainCollectorId] = useState<number | null>(null);
    const [closestInteractableSleepingBagId, setClosestInteractableSleepingBagId] = useState<number | null>(null);
    const [closestInteractableKnockedOutPlayerId, setClosestInteractableKnockedOutPlayerId] = useState<string | null>(null);
    const [closestInteractableWaterPosition, setClosestInteractableWaterPosition] = useState<{ x: number; y: number } | null>(null);

    const resultRef = useRef<UseInteractionFinderResult>({
        closestInteractableTarget: null,
        closestInteractableHarvestableResourceId: null,
        closestInteractableCampfireId: null,
        closestInteractableFurnaceId: null,
        closestInteractableLanternId: null,
        closestInteractableDroppedItemId: null,
        closestInteractableBoxId: null,
        isClosestInteractableBoxEmpty: false,
        closestInteractableCorpseId: null,
        closestInteractableStashId: null,
        closestInteractableRainCollectorId: null,
        closestInteractableSleepingBagId: null,
        closestInteractableKnockedOutPlayerId: null,
        closestInteractableWaterPosition: null,
    });

    const updateInteractionResult = useCallback(() => {
        // Single closest target across all types
        let closestTarget: InteractableTarget | null = null;
        let closestTargetDistSq = Infinity;

        // Generic harvestable resource tracking
        let closestHarvestableResourceId: bigint | null = null;
        let closestHarvestableResourceDistSq = PLAYER_HARVESTABLE_RESOURCE_INTERACTION_DISTANCE_SQUARED;

        let closestCampfireId: number | null = null;
        let closestCampfireDistSq = PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED;

        let closestFurnaceId: number | null = null; // ADDED: Furnace tracking variables
        let closestFurnaceDistSq = PLAYER_FURNACE_INTERACTION_DISTANCE_SQUARED;

        let closestLanternId: number | null = null;
        let closestLanternDistSq = PLAYER_LANTERN_INTERACTION_DISTANCE_SQUARED;

        let closestDroppedItemId: bigint | null = null;
        let closestDroppedItemDistSq = PLAYER_DROPPED_ITEM_INTERACTION_DISTANCE_SQUARED;

        let closestBoxId: number | null = null;
        let closestBoxDistSq = PLAYER_BOX_INTERACTION_DISTANCE_SQUARED;
        let isClosestBoxEmpty = false;

        let closestCorpse: bigint | null = null;
        let closestCorpseDistSq = PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED;

        let closestStashId: number | null = null;

        let closestRainCollectorId: number | null = null;
        let closestRainCollectorDistSq = PLAYER_RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED;

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
            const playerX = localPlayer.positionX;
            const playerY = localPlayer.positionY;

            // Find closest harvestable resource (generic unified system)
            if (harvestableResources) {
                harvestableResources.forEach((resource) => {
                    if (resource.respawnAt !== null && resource.respawnAt !== undefined) return;
                    
                    // Get resource type and configuration
                    const plantType = resource.plantType?.tag as ResourceType;
                    if (!plantType) return;
                    
                    try {
                        const config = getResourceConfig(plantType);
                        
                        // Use target width as a proxy for visual height (can be refined later)
                        const visualHeight = config.targetWidth;
                        const visualCenterY = resource.posY - (visualHeight / 2);
                        
                        // Calculate distance to resource
                        const dx = playerX - resource.posX;
                        const dy = playerY - visualCenterY;
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
                    // Use asymmetric interaction points for better approach from below while keeping top unchanged
                    let interactionCenterY;
                    if (playerY > furnace.posY) {
                        // Player is below furnace - use lower interaction point for easier approach
                        interactionCenterY = furnace.posY + 10; // Below the furnace base
                    } else {
                        // Player is above/level with furnace - use normal center point to keep existing behavior
                        interactionCenterY = furnace.posY - (FURNACE_HEIGHT / 2) - FURNACE_RENDER_Y_OFFSET;
                    }
                    
                    const dx = playerX - furnace.posX;
                    const dy = playerY - interactionCenterY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestFurnaceDistSq) {
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
                    // Use the visual center of the box (middle of the visible sprite)
                    // Rendering: drawY = entity.posY - drawHeight - 20, so visual center is halfway down
                    const visualCenterY = box.posY - (BOX_HEIGHT / 2) - 20;
                    
                    const dx = playerX - box.posX;
                    const dy = playerY - visualCenterY; // Use visual center for interaction distance
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestBoxDistSq) {
                        // Check shelter access control (use original stored position for shelter checks)
                        if (canPlayerInteractWithObjectInShelter(
                            playerX, playerY, localPlayer.identity.toHexString(),
                            box.posX, box.posY, shelters
                        )) {
                            closestBoxDistSq = distSq;
                            closestBoxId = box.id;
                            // Check if this closest box is empty
                            let isEmpty = true;
                            for (let i = 0; i < NUM_BOX_SLOTS; i++) {
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
                    
                    const dx = playerX - rainCollector.posX;
                    const dy = playerY - rainCollector.posY;
                    const distSq = dx * dx + dy * dy;
                    const distance = Math.sqrt(distSq);
                    
                    // DEBUG: Log distance check
                    // console.log(`[InteractionFinder] Rain collector ${rainCollector.id} distance: ${distance.toFixed(1)}px (threshold: ${Math.sqrt(PLAYER_RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED).toFixed(1)}px)`);
                    
                    if (distSq < closestRainCollectorDistSq) {
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

            // Find closest knocked out player (excluding local player)
            if (players) {
                players.forEach((player) => {
                    // Skip if it's the local player or player is not knocked out or is dead
                    if (localPlayer && player.identity.isEqual(localPlayer.identity)) {
                        return; // Skip local player
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
            if (connection) {
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
                                    if (tile && tile.tileType.tag === 'Sea') {
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
            if (closestLanternId) {
                const lantern = lanterns?.get(String(closestLanternId));
                let isEmpty = true;
                if (lantern) {
                    // Check if lantern has valid fuel items (match server-side logic)
                    if (lantern.fuelInstanceId0 !== undefined && lantern.fuelInstanceId0 > 0n) {
                        // Check if the actual item exists and is valid tallow
                        const fuelItem = inventoryItems?.get(String(lantern.fuelInstanceId0));
                        if (fuelItem) {
                            const itemDef = itemDefinitions?.get(String(fuelItem.itemDefId));
                            if (itemDef && itemDef.name === "Tallow" && fuelItem.quantity > 0) {
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
                candidates.push({
                    type: 'rain_collector',
                    id: closestRainCollectorId,
                    position: { x: 0, y: 0 },
                    distance: Math.sqrt(closestRainCollectorDistSq)
                });
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

            // Find the single closest target
            if (candidates.length > 0) {
                closestTarget = selectHighestPriorityTarget(candidates);
            }
        }

        const calculatedResult: UseInteractionFinderResult = {
            closestInteractableTarget: closestTarget,
            closestInteractableHarvestableResourceId: closestHarvestableResourceId,
            closestInteractableCampfireId: closestCampfireId,
            closestInteractableFurnaceId: closestFurnaceId, // ADDED: Furnace return
            closestInteractableLanternId: closestLanternId,
            closestInteractableDroppedItemId: closestDroppedItemId,
            closestInteractableBoxId: closestBoxId,
            isClosestInteractableBoxEmpty: isClosestBoxEmpty,
            closestInteractableCorpseId: closestCorpse,
            closestInteractableStashId: closestStashId,
            closestInteractableRainCollectorId: closestRainCollectorId,
            closestInteractableSleepingBagId: closestSleepingBagId,
            closestInteractableKnockedOutPlayerId: closestKnockedOutPlayerId,
            closestInteractableWaterPosition: closestWaterPosition,
        };

        resultRef.current = calculatedResult;

        // Update states if changed
        if (calculatedResult.closestInteractableHarvestableResourceId !== closestInteractableHarvestableResourceId) {
            setClosestInteractableHarvestableResourceId(calculatedResult.closestInteractableHarvestableResourceId);
        }
        if (calculatedResult.closestInteractableCampfireId !== closestInteractableCampfireId) {
            setClosestInteractableCampfireId(calculatedResult.closestInteractableCampfireId);
        }
        if (calculatedResult.closestInteractableFurnaceId !== closestInteractableFurnaceId) { // ADDED: Furnace useEffect
            setClosestInteractableFurnaceId(calculatedResult.closestInteractableFurnaceId);
        }
        if (calculatedResult.closestInteractableLanternId !== closestInteractableLanternId) {
            setClosestInteractableLanternId(calculatedResult.closestInteractableLanternId);
        }
        if (calculatedResult.closestInteractableDroppedItemId !== closestInteractableDroppedItemId) {
            setClosestInteractableDroppedItemId(calculatedResult.closestInteractableDroppedItemId);
        }
        if (calculatedResult.closestInteractableBoxId !== closestInteractableBoxId) {
            setClosestInteractableBoxId(calculatedResult.closestInteractableBoxId);
        }
        if (calculatedResult.isClosestInteractableBoxEmpty !== isClosestInteractableBoxEmpty) {
            setIsClosestInteractableBoxEmpty(calculatedResult.isClosestInteractableBoxEmpty);
        }
        // Update corpse state based on memoized result
        if (calculatedResult.closestInteractableCorpseId !== closestInteractableCorpseId) {
            setClosestInteractableCorpseId(calculatedResult.closestInteractableCorpseId);
        }
        if (calculatedResult.closestInteractableStashId !== closestInteractableStashId) {
            setClosestInteractableStashId(calculatedResult.closestInteractableStashId);
        }
        if (calculatedResult.closestInteractableRainCollectorId !== closestInteractableRainCollectorId) {
            setClosestInteractableRainCollectorId(calculatedResult.closestInteractableRainCollectorId);
        }
        if (calculatedResult.closestInteractableSleepingBagId !== closestInteractableSleepingBagId) {
            setClosestInteractableSleepingBagId(calculatedResult.closestInteractableSleepingBagId);
        }
        if (calculatedResult.closestInteractableKnockedOutPlayerId !== closestInteractableKnockedOutPlayerId) {
            setClosestInteractableKnockedOutPlayerId(calculatedResult.closestInteractableKnockedOutPlayerId);
        }
        if (calculatedResult.closestInteractableWaterPosition !== closestInteractableWaterPosition) {
            setClosestInteractableWaterPosition(calculatedResult.closestInteractableWaterPosition);
        }
    }, [localPlayer, harvestableResources, campfires, furnaces, lanterns, droppedItems, woodenStorageBoxes, playerCorpses, stashes, rainCollectors, sleepingBags, players, shelters, inventoryItems, itemDefinitions, connection, playerDrinkingCooldowns]);

    useEffect(() => {
        const interval = setInterval(() => {
            updateInteractionResult();
        }, INTERACTION_CHECK_INTERVAL);
        return () => clearInterval(interval);
    }, [updateInteractionResult]);

    return {
        closestInteractableTarget: resultRef.current.closestInteractableTarget,
        closestInteractableHarvestableResourceId,
        closestInteractableCampfireId,
        closestInteractableFurnaceId, // ADDED: Furnace final return
        closestInteractableLanternId,
        closestInteractableDroppedItemId,
        closestInteractableBoxId,
        isClosestInteractableBoxEmpty,
        closestInteractableCorpseId,
        closestInteractableStashId,
        closestInteractableRainCollectorId,
        closestInteractableSleepingBagId,
        closestInteractableKnockedOutPlayerId,
        closestInteractableWaterPosition,
    };
}

export default useInteractionFinder; 