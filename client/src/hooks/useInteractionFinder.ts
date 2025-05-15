import { useMemo, useState, useEffect } from 'react';
import {
    Player as SpacetimeDBPlayer,
    Mushroom as SpacetimeDBMushroom,
    Pumpkin as SpacetimeDBPumpkin,
    Campfire as SpacetimeDBCampfire,
    DroppedItem as SpacetimeDBDroppedItem,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    Corn as SpacetimeDBCorn,
    Hemp as SpacetimeDBHemp,
    PlayerCorpse as SpacetimeDBPlayerCorpse,
    Stash as SpacetimeDBStash,
    SleepingBag as SpacetimeDBSleepingBag
} from '../generated';
import {
    PLAYER_MUSHROOM_INTERACTION_DISTANCE_SQUARED,
    PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED,
    PLAYER_DROPPED_ITEM_INTERACTION_DISTANCE_SQUARED,
    PLAYER_BOX_INTERACTION_DISTANCE_SQUARED,
    PLAYER_STASH_INTERACTION_DISTANCE_SQUARED,
    PLAYER_STASH_SURFACE_INTERACTION_DISTANCE_SQUARED
} from '../config/gameConfig';

// Define the constant for corn interaction (use same as mushroom for now)
const PLAYER_CORN_INTERACTION_DISTANCE_SQUARED = PLAYER_MUSHROOM_INTERACTION_DISTANCE_SQUARED;
const PLAYER_PUMPKIN_INTERACTION_DISTANCE_SQUARED = PLAYER_MUSHROOM_INTERACTION_DISTANCE_SQUARED;
const PLAYER_HEMP_INTERACTION_DISTANCE_SQUARED = PLAYER_MUSHROOM_INTERACTION_DISTANCE_SQUARED;
const PLAYER_SLEEPING_BAG_INTERACTION_DISTANCE_SQUARED = PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED;

// Define the hook's input props
interface UseInteractionFinderProps {
    localPlayer: SpacetimeDBPlayer | null | undefined;
    mushrooms: Map<string, SpacetimeDBMushroom>;
    corns: Map<string, SpacetimeDBCorn>;
    pumpkins: Map<string, SpacetimeDBPumpkin>;
    hemps: Map<string, SpacetimeDBHemp>;
    campfires: Map<string, SpacetimeDBCampfire>;
    droppedItems: Map<string, SpacetimeDBDroppedItem>;
    woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>;
    playerCorpses: Map<string, SpacetimeDBPlayerCorpse>;
    stashes: Map<string, SpacetimeDBStash>;
    sleepingBags: Map<string, SpacetimeDBSleepingBag>;
}

// Define the hook's return type
interface UseInteractionFinderResult {
    closestInteractableMushroomId: bigint | null;
    closestInteractableCornId: bigint | null;
    closestInteractablePumpkinId: bigint | null;
    closestInteractableHempId: bigint | null;
    closestInteractableCampfireId: number | null;
    closestInteractableDroppedItemId: bigint | null;
    closestInteractableBoxId: number | null;
    isClosestInteractableBoxEmpty: boolean;
    closestInteractableCorpseId: bigint | null;
    closestInteractableStashId: number | null;
    closestInteractableSleepingBagId: number | null;
}

// Constants for box slots (should match server if possible, or keep fixed)
const NUM_BOX_SLOTS = 18;

/**
 * Finds the closest interactable entity of each type within range of the local player.
 */
export function useInteractionFinder({
    localPlayer,
    mushrooms,
    corns,
    pumpkins,
    hemps,
    campfires,
    droppedItems,
    woodenStorageBoxes,
    playerCorpses,
    stashes,
    sleepingBags,
}: UseInteractionFinderProps): UseInteractionFinderResult {

    // State for closest interactable IDs
    const [closestInteractableMushroomId, setClosestInteractableMushroomId] = useState<bigint | null>(null);
    const [closestInteractableCornId, setClosestInteractableCornId] = useState<bigint | null>(null);
    const [closestInteractablePumpkinId, setClosestInteractablePumpkinId] = useState<bigint | null>(null);
    const [closestInteractableHempId, setClosestInteractableHempId] = useState<bigint | null>(null);
    const [closestInteractableCampfireId, setClosestInteractableCampfireId] = useState<number | null>(null);
    const [closestInteractableDroppedItemId, setClosestInteractableDroppedItemId] = useState<bigint | null>(null);
    const [closestInteractableBoxId, setClosestInteractableBoxId] = useState<number | null>(null);
    const [isClosestInteractableBoxEmpty, setIsClosestInteractableBoxEmpty] = useState<boolean>(false);
    const [closestInteractableCorpseId, setClosestInteractableCorpseId] = useState<bigint | null>(null);
    const [closestInteractableStashId, setClosestInteractableStashId] = useState<number | null>(null);
    const [closestInteractableSleepingBagId, setClosestInteractableSleepingBagId] = useState<number | null>(null);

    // Calculate closest interactables using useMemo for efficiency
    const interactionResult = useMemo<UseInteractionFinderResult>(() => {
        let closestMushroomId: bigint | null = null;
        let closestMushroomDistSq = PLAYER_MUSHROOM_INTERACTION_DISTANCE_SQUARED;

        let closestCornId: bigint | null = null;
        let closestCornDistSq = PLAYER_CORN_INTERACTION_DISTANCE_SQUARED;

        let closestPumpkinId: bigint | null = null;
        let closestPumpkinDistSq = PLAYER_PUMPKIN_INTERACTION_DISTANCE_SQUARED;

        let closestHempId: bigint | null = null;
        let closestHempDistSq = PLAYER_HEMP_INTERACTION_DISTANCE_SQUARED;

        let closestCampfireId: number | null = null;
        let closestCampfireDistSq = PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED;

        let closestDroppedItemId: bigint | null = null;
        let closestDroppedItemDistSq = PLAYER_DROPPED_ITEM_INTERACTION_DISTANCE_SQUARED;

        let closestBoxId: number | null = null;
        let closestBoxDistSq = PLAYER_BOX_INTERACTION_DISTANCE_SQUARED;
        let isClosestBoxEmpty = false;

        let closestCorpse: bigint | null = null;
        let closestCorpseDistSq = PLAYER_DROPPED_ITEM_INTERACTION_DISTANCE_SQUARED;

        let closestStashId: number | null = null;

        let closestSleepingBagId: number | null = null;
        let closestSleepingBagDistSq = PLAYER_SLEEPING_BAG_INTERACTION_DISTANCE_SQUARED;

        if (localPlayer) {
            const playerX = localPlayer.positionX;
            const playerY = localPlayer.positionY;

            // Find closest mushroom
            mushrooms.forEach((mushroom) => {
                if (mushroom.respawnAt !== null && mushroom.respawnAt !== undefined) return;
                const dx = playerX - mushroom.posX;
                const dy = playerY - mushroom.posY;
                const distSq = dx * dx + dy * dy;
                if (distSq < closestMushroomDistSq) {
                    closestMushroomDistSq = distSq;
                    closestMushroomId = mushroom.id;
                }
            });

            // Find closest corn
            corns.forEach((corn) => {
                if (corn.respawnAt !== null && corn.respawnAt !== undefined) return;
                const dx = playerX - corn.posX;
                const dy = playerY - corn.posY;
                const distSq = dx * dx + dy * dy;
                if (distSq < closestCornDistSq) {
                    closestCornDistSq = distSq;
                    closestCornId = corn.id;
                }
            });

            // Find closest pumpkin
            pumpkins.forEach((pumpkin) => {
                const dx = playerX - pumpkin.posX;
                const dy = playerY - pumpkin.posY;
                const distSq = dx * dx + dy * dy;
                if (distSq < closestPumpkinDistSq) {
                    closestPumpkinDistSq = distSq;
                    closestPumpkinId = pumpkin.id;
                }
            });

            // Find closest hemp
            if (hemps) {
                hemps.forEach((hemp) => {
                    if (hemp.respawnAt !== null && hemp.respawnAt !== undefined) return;
                    const dx = playerX - hemp.posX;
                    const dy = playerY - hemp.posY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestHempDistSq) {
                        closestHempDistSq = distSq;
                        closestHempId = hemp.id;
                    }
                });
            }

            // Find closest campfire
            campfires.forEach((campfire) => {
                const dx = playerX - campfire.posX;
                const dy = playerY - campfire.posY;
                const distSq = dx * dx + dy * dy;
                if (distSq < closestCampfireDistSq) {
                    closestCampfireDistSq = distSq;
                    closestCampfireId = campfire.id;
                }
            });

            // Find closest dropped item
            droppedItems.forEach((item) => {
                const dx = playerX - item.posX;
                const dy = playerY - item.posY;
                const distSq = dx * dx + dy * dy;
                if (distSq < closestDroppedItemDistSq) {
                    closestDroppedItemDistSq = distSq;
                    closestDroppedItemId = item.id;
                }
            });

            // Find closest wooden storage box and check emptiness
            woodenStorageBoxes.forEach((box) => {
                const dx = playerX - box.posX;
                const dy = playerY - box.posY;
                const distSq = dx * dx + dy * dy;
                if (distSq < closestBoxDistSq) {
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
            });

            // Find closest player corpse
            if (playerCorpses) {
                playerCorpses.forEach((corpse) => {
                    const dx = playerX - corpse.posX;
                    const dy = playerY - corpse.posY;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < closestCorpseDistSq) {
                        closestCorpseDistSq = distSq;
                        closestCorpse = corpse.id as unknown as bigint;
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
                        ? PLAYER_STASH_SURFACE_INTERACTION_DISTANCE_SQUARED
                        : PLAYER_STASH_INTERACTION_DISTANCE_SQUARED;

                    // Check if the stash is within its applicable interaction radius
                    if (distSq < interactionThresholdSq) {
                        // If it's within the radius, check if it's closer than any previous candidate
                        if (distSq < currentMinDistSq) {
                            currentMinDistSq = distSq;
                            closestStashId = stash.id; // Set the main closestStashId directly here
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
                        closestSleepingBagDistSq = distSq;
                        closestSleepingBagId = bag.id;
                    }
                });
            }
        }

        return {
            closestInteractableMushroomId: closestMushroomId,
            closestInteractableCornId: closestCornId,
            closestInteractablePumpkinId: closestPumpkinId,
            closestInteractableHempId: closestHempId,
            closestInteractableCampfireId: closestCampfireId,
            closestInteractableDroppedItemId: closestDroppedItemId,
            closestInteractableBoxId: closestBoxId,
            isClosestInteractableBoxEmpty: isClosestBoxEmpty,
            closestInteractableCorpseId: closestCorpse,
            closestInteractableStashId: closestStashId,
            closestInteractableSleepingBagId: closestSleepingBagId,
        };
    // Recalculate when player position or interactable maps change
    }, [localPlayer, mushrooms, corns, pumpkins, hemps, campfires, droppedItems, woodenStorageBoxes, playerCorpses, stashes, sleepingBags]);

    // Effect to update state based on memoized results
    useEffect(() => {
        // Update state only if changed, comparing to current state
        if (interactionResult.closestInteractableMushroomId !== closestInteractableMushroomId) {
            setClosestInteractableMushroomId(interactionResult.closestInteractableMushroomId);
        }
        if (interactionResult.closestInteractableCornId !== closestInteractableCornId) {
            setClosestInteractableCornId(interactionResult.closestInteractableCornId);
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
    // Depend on the memoized result object
    }, [interactionResult]);

    return {
        closestInteractableMushroomId,
        closestInteractableCornId,
        closestInteractablePumpkinId,
        closestInteractableHempId,
        closestInteractableCampfireId,
        closestInteractableDroppedItemId,
        closestInteractableBoxId,
        isClosestInteractableBoxEmpty,
        closestInteractableCorpseId,
        closestInteractableStashId,
        closestInteractableSleepingBagId,
    };
} 