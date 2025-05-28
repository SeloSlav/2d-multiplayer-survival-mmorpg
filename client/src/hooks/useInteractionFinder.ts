import { useMemo, useState, useEffect, useCallback } from 'react';
import {
    Player as SpacetimeDBPlayer,
    Mushroom as SpacetimeDBMushroom,
    Pumpkin as SpacetimeDBPumpkin,
    Potato as SpacetimeDBPotato,
    Campfire as SpacetimeDBCampfire,
    DroppedItem as SpacetimeDBDroppedItem,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    Corn as SpacetimeDBCorn,
    Hemp as SpacetimeDBHemp,
    PlayerCorpse as SpacetimeDBPlayerCorpse,
    Stash as SpacetimeDBStash,
    SleepingBag as SpacetimeDBSleepingBag,
    Shelter as SpacetimeDBShelter,
} from '../generated';
import {
    PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED,
    CAMPFIRE_HEIGHT,
    CAMPFIRE_RENDER_Y_OFFSET
} from '../utils/renderers/campfireRenderingUtils';

// Define the constant for food item interactions (larger radius for easier pickup)
const PLAYER_CORN_INTERACTION_DISTANCE_SQUARED = 80.0 * 80.0;
const PLAYER_POTATO_INTERACTION_DISTANCE_SQUARED = 80.0 * 80.0;
const PLAYER_PUMPKIN_INTERACTION_DISTANCE_SQUARED = 80.0 * 80.0;
const PLAYER_HEMP_INTERACTION_DISTANCE_SQUARED = 80.0 * 80.0;
const PLAYER_SLEEPING_BAG_INTERACTION_DISTANCE_SQUARED = PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED;
const PLAYER_KNOCKED_OUT_REVIVE_INTERACTION_DISTANCE_SQUARED = 128.0 * 128.0; // Doubled distance for easier revive access

// Define the hook's input props
interface UseInteractionFinderProps {
    localPlayer: SpacetimeDBPlayer | null | undefined;
    mushrooms: Map<string, SpacetimeDBMushroom>;
    corns: Map<string, SpacetimeDBCorn>;
    potatoes: Map<string, SpacetimeDBPotato>;
    pumpkins: Map<string, SpacetimeDBPumpkin>;
    hemps: Map<string, SpacetimeDBHemp>;
    campfires: Map<string, SpacetimeDBCampfire>;
    droppedItems: Map<string, SpacetimeDBDroppedItem>;
    woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>;
    playerCorpses: Map<string, SpacetimeDBPlayerCorpse>;
    stashes: Map<string, SpacetimeDBStash>;
    sleepingBags: Map<string, SpacetimeDBSleepingBag>;
    players: Map<string, SpacetimeDBPlayer>;
    shelters: Map<string, SpacetimeDBShelter>;
}

// Define the hook's return type
interface UseInteractionFinderResult {
    closestInteractableMushroomId: bigint | null;
    closestInteractableCornId: bigint | null;
    closestInteractablePotatoId: bigint | null;
    closestInteractablePumpkinId: bigint | null;
    closestInteractableHempId: bigint | null;
    closestInteractableCampfireId: number | null;
    closestInteractableDroppedItemId: bigint | null;
    closestInteractableBoxId: number | null;
    isClosestInteractableBoxEmpty: boolean;
    closestInteractableCorpseId: bigint | null;
    closestInteractableStashId: number | null;
    closestInteractableSleepingBagId: number | null;
    closestInteractableKnockedOutPlayerId: string | null; // Player identity hex string
}

// Constants for box slots (should match server if possible, or keep fixed)
const NUM_BOX_SLOTS = 18;

const INTERACTION_CHECK_INTERVAL = 100; // ms

// --- Locally Defined Interaction Distance Constants (formerly in gameConfig.ts) ---
export const PLAYER_MUSHROOM_INTERACTION_DISTANCE_SQUARED = 80.0 * 80.0;
export const PLAYER_BOX_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0;
export const PLAYER_DROPPED_ITEM_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0;
export const PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0;
export const PLAYER_STASH_INTERACTION_DISTANCE_SQUARED = 48.0 * 48.0;
export const PLAYER_STASH_SURFACE_INTERACTION_DISTANCE_SQUARED = 24.0 * 24.0;

// --- Locally Defined Visual Heights for Interaction (formerly in gameConfig.ts) ---
export const MUSHROOM_VISUAL_HEIGHT_FOR_INTERACTION = 64;
export const CORN_VISUAL_HEIGHT_FOR_INTERACTION = 96;
export const POTATO_VISUAL_HEIGHT_FOR_INTERACTION = 32;
export const HEMP_VISUAL_HEIGHT_FOR_INTERACTION = 88;
export const PUMPKIN_VISUAL_HEIGHT_FOR_INTERACTION = 64;

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
    mushrooms,
    corns,
    potatoes,
    pumpkins,
    hemps,
    campfires,
    droppedItems,
    woodenStorageBoxes,
    playerCorpses,
    stashes,
    sleepingBags,
    players,
    shelters,
}: UseInteractionFinderProps): UseInteractionFinderResult {

    // State for closest interactable IDs
    const [closestInteractableMushroomId, setClosestInteractableMushroomId] = useState<bigint | null>(null);
    const [closestInteractableCornId, setClosestInteractableCornId] = useState<bigint | null>(null);
    const [closestInteractablePotatoId, setClosestInteractablePotatoId] = useState<bigint | null>(null);
    const [closestInteractablePumpkinId, setClosestInteractablePumpkinId] = useState<bigint | null>(null);
    const [closestInteractableHempId, setClosestInteractableHempId] = useState<bigint | null>(null);
    const [closestInteractableCampfireId, setClosestInteractableCampfireId] = useState<number | null>(null);
    const [closestInteractableDroppedItemId, setClosestInteractableDroppedItemId] = useState<bigint | null>(null);
    const [closestInteractableBoxId, setClosestInteractableBoxId] = useState<number | null>(null);
    const [isClosestInteractableBoxEmpty, setIsClosestInteractableBoxEmpty] = useState<boolean>(false);
    const [closestInteractableCorpseId, setClosestInteractableCorpseId] = useState<bigint | null>(null);
    const [closestInteractableStashId, setClosestInteractableStashId] = useState<number | null>(null);
    const [closestInteractableSleepingBagId, setClosestInteractableSleepingBagId] = useState<number | null>(null);
    const [closestInteractableKnockedOutPlayerId, setClosestInteractableKnockedOutPlayerId] = useState<string | null>(null);

    // Calculate closest interactables using useMemo for efficiency
    const interactionResult = useMemo<UseInteractionFinderResult>(() => {
        let closestMushroomId: bigint | null = null;
        let closestMushroomDistSq = 64.0 * 64.0;

        let closestCornId: bigint | null = null;
        let closestCornDistSq = PLAYER_CORN_INTERACTION_DISTANCE_SQUARED;

        let closestPotatoId: bigint | null = null;
        let closestPotatoDistSq = PLAYER_POTATO_INTERACTION_DISTANCE_SQUARED;

        let closestPumpkinId: bigint | null = null;
        let closestPumpkinDistSq = PLAYER_PUMPKIN_INTERACTION_DISTANCE_SQUARED;

        let closestHempId: bigint | null = null;
        let closestHempDistSq = PLAYER_HEMP_INTERACTION_DISTANCE_SQUARED;

        let closestCampfireId: number | null = null;
        let closestCampfireDistSq = PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED;

        let closestDroppedItemId: bigint | null = null;
        let closestDroppedItemDistSq = 64.0 * 64.0;

        let closestBoxId: number | null = null;
        let closestBoxDistSq = 64.0 * 64.0;
        let isClosestBoxEmpty = false;

        let closestCorpse: bigint | null = null;
        let closestCorpseDistSq = 64.0 * 64.0;

        let closestStashId: number | null = null;

        let closestSleepingBagId: number | null = null;
        let closestSleepingBagDistSq = PLAYER_SLEEPING_BAG_INTERACTION_DISTANCE_SQUARED;

        let closestKnockedOutPlayerId: string | null = null;
        let closestKnockedOutPlayerDistSq = PLAYER_KNOCKED_OUT_REVIVE_INTERACTION_DISTANCE_SQUARED;

        if (localPlayer) {
            const playerX = localPlayer.positionX;
            const playerY = localPlayer.positionY;

            // Find closest mushroom
            if (mushrooms) {
                mushrooms.forEach((mushroom) => {
                    if (mushroom.respawnAt !== null && mushroom.respawnAt !== undefined) return;
                    const visualCenterY = mushroom.posY - (64 / 2);
                    const dx = playerX - mushroom.posX;
                    const dy = playerY - visualCenterY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestMushroomDistSq) {
                        closestMushroomDistSq = distSq;
                        closestMushroomId = mushroom.id;
                    }
                });
            }

            // Find closest corn
            if (corns) {
                corns.forEach((corn) => {
                    if (corn.respawnAt !== null && corn.respawnAt !== undefined) return;
                    const visualCenterY = corn.posY - (96 / 2);
                    const dx = playerX - corn.posX;
                    const dy = playerY - visualCenterY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestCornDistSq) {
                        closestCornDistSq = distSq;
                        closestCornId = corn.id;
                    }
                });
            }

            // Find closest potato
            if (potatoes) {
                potatoes.forEach((potato) => {
                    const visualCenterY = potato.posY - (32 / 2);
                    const dx = playerX - potato.posX;
                    const dy = playerY - visualCenterY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestPotatoDistSq) {
                        closestPotatoDistSq = distSq;
                        closestPotatoId = potato.id;
                    }
                });
            }

            // Find closest pumpkin
            if (pumpkins) {
                pumpkins.forEach((pumpkin) => {
                    const visualCenterY = pumpkin.posY - (64 / 2);
                    const dx = playerX - pumpkin.posX;
                    const dy = playerY - visualCenterY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestPumpkinDistSq) {
                        closestPumpkinDistSq = distSq;
                        closestPumpkinId = pumpkin.id;
                    }
                });
            }

            // Find closest hemp
            if (hemps) {
                hemps.forEach((hemp) => {
                    if (hemp.respawnAt !== null && hemp.respawnAt !== undefined) return;
                    const visualCenterY = hemp.posY - (88 / 2);
                    const dx = playerX - hemp.posX;
                    const dy = playerY - visualCenterY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestHempDistSq) {
                        closestHempDistSq = distSq;
                        closestHempId = hemp.id;
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
                    const dx = playerX - box.posX;
                    const dy = playerY - box.posY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestBoxDistSq) {
                        // Check shelter access control
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

            // Find closest sleeping bag
            if (sleepingBags) {
                sleepingBags.forEach((bag) => {
                    const dx = playerX - bag.posX;
                    const dy = playerY - bag.posY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestSleepingBagDistSq) {
                        // Check shelter access control
                        if (canPlayerInteractWithObjectInShelter(
                            playerX, playerY, localPlayer.identity.toHexString(),
                            bag.posX, bag.posY, shelters
                        )) {
                            closestSleepingBagDistSq = distSq;
                            closestSleepingBagId = bag.id;
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
        }

        return {
            closestInteractableMushroomId: closestMushroomId,
            closestInteractableCornId: closestCornId,
            closestInteractablePotatoId: closestPotatoId,
            closestInteractablePumpkinId: closestPumpkinId,
            closestInteractableHempId: closestHempId,
            closestInteractableCampfireId: closestCampfireId,
            closestInteractableDroppedItemId: closestDroppedItemId,
            closestInteractableBoxId: closestBoxId,
            isClosestInteractableBoxEmpty: isClosestBoxEmpty,
            closestInteractableCorpseId: closestCorpse,
            closestInteractableStashId: closestStashId,
            closestInteractableSleepingBagId: closestSleepingBagId,
            closestInteractableKnockedOutPlayerId: closestKnockedOutPlayerId,
        };
    // Recalculate when player position or interactable maps change
    }, [localPlayer, mushrooms, corns, potatoes, pumpkins, hemps, campfires, droppedItems, woodenStorageBoxes, playerCorpses, stashes, sleepingBags, players, shelters]);

    // Effect to update state based on memoized results
    useEffect(() => {
        // Update state only if changed, comparing to current state
        if (interactionResult.closestInteractableMushroomId !== closestInteractableMushroomId) {
            setClosestInteractableMushroomId(interactionResult.closestInteractableMushroomId);
        }
        if (interactionResult.closestInteractableCornId !== closestInteractableCornId) {
            setClosestInteractableCornId(interactionResult.closestInteractableCornId);
        }
        if (interactionResult.closestInteractablePotatoId !== closestInteractablePotatoId) {
            setClosestInteractablePotatoId(interactionResult.closestInteractablePotatoId);
        }
        if (interactionResult.closestInteractablePumpkinId !== closestInteractablePumpkinId) {
            setClosestInteractablePumpkinId(interactionResult.closestInteractablePumpkinId);
        }
        if (interactionResult.closestInteractableHempId !== closestInteractableHempId) {
            setClosestInteractableHempId(interactionResult.closestInteractableHempId);
        }
        if (interactionResult.closestInteractableCampfireId !== closestInteractableCampfireId) {
            setClosestInteractableCampfireId(interactionResult.closestInteractableCampfireId);
        }
        if (interactionResult.closestInteractableDroppedItemId !== closestInteractableDroppedItemId) {
            setClosestInteractableDroppedItemId(interactionResult.closestInteractableDroppedItemId);
        }
        if (interactionResult.closestInteractableBoxId !== closestInteractableBoxId) {
            setClosestInteractableBoxId(interactionResult.closestInteractableBoxId);
        }
        if (interactionResult.isClosestInteractableBoxEmpty !== isClosestInteractableBoxEmpty) {
            setIsClosestInteractableBoxEmpty(interactionResult.isClosestInteractableBoxEmpty);
        }
        // Update corpse state based on memoized result
        if (interactionResult.closestInteractableCorpseId !== closestInteractableCorpseId) {
            setClosestInteractableCorpseId(interactionResult.closestInteractableCorpseId);
        }
        if (interactionResult.closestInteractableStashId !== closestInteractableStashId) {
            setClosestInteractableStashId(interactionResult.closestInteractableStashId);
        }
        if (interactionResult.closestInteractableSleepingBagId !== closestInteractableSleepingBagId) {
            setClosestInteractableSleepingBagId(interactionResult.closestInteractableSleepingBagId);
        }
        if (interactionResult.closestInteractableKnockedOutPlayerId !== closestInteractableKnockedOutPlayerId) {
            setClosestInteractableKnockedOutPlayerId(interactionResult.closestInteractableKnockedOutPlayerId);
        }
    // Depend on the memoized result object
    }, [interactionResult]);

    return {
        closestInteractableMushroomId,
        closestInteractableCornId,
        closestInteractablePotatoId,
        closestInteractablePumpkinId,
        closestInteractableHempId,
        closestInteractableCampfireId,
        closestInteractableDroppedItemId,
        closestInteractableBoxId,
        isClosestInteractableBoxEmpty,
        closestInteractableCorpseId,
        closestInteractableStashId,
        closestInteractableSleepingBagId,
        closestInteractableKnockedOutPlayerId,
    };
}

export default useInteractionFinder; 