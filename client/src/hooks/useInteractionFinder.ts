import { useMemo } from 'react';
import {
    Player as SpacetimeDBPlayer,
    Mushroom as SpacetimeDBMushroom,
    Campfire as SpacetimeDBCampfire,
    DroppedItem as SpacetimeDBDroppedItem,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    Corn as SpacetimeDBCorn
} from '../generated';
import {
    PLAYER_MUSHROOM_INTERACTION_DISTANCE_SQUARED,
    PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED,
    PLAYER_DROPPED_ITEM_INTERACTION_DISTANCE_SQUARED,
    PLAYER_BOX_INTERACTION_DISTANCE_SQUARED
} from '../config/gameConfig';

// Define the constant for corn interaction (use same as mushroom for now)
const PLAYER_CORN_INTERACTION_DISTANCE_SQUARED = PLAYER_MUSHROOM_INTERACTION_DISTANCE_SQUARED;

// Define the hook's input props
interface UseInteractionFinderProps {
    localPlayer: SpacetimeDBPlayer | null | undefined;
    mushrooms: Map<string, SpacetimeDBMushroom>;
    corns: Map<string, SpacetimeDBCorn>;
    campfires: Map<string, SpacetimeDBCampfire>;
    droppedItems: Map<string, SpacetimeDBDroppedItem>;
    woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>;
}

// Define the hook's return type
interface UseInteractionFinderResult {
    closestInteractableMushroomId: bigint | null;
    closestInteractableCornId: bigint | null;
    closestInteractableCampfireId: number | null;
    closestInteractableDroppedItemId: bigint | null;
    closestInteractableBoxId: number | null;
    isClosestInteractableBoxEmpty: boolean;
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
    campfires,
    droppedItems,
    woodenStorageBoxes,
}: UseInteractionFinderProps): UseInteractionFinderResult {

    // Calculate closest interactables using useMemo for efficiency
    const interactionResult = useMemo<UseInteractionFinderResult>(() => {
        let closestMushroomId: bigint | null = null;
        let closestMushroomDistSq = PLAYER_MUSHROOM_INTERACTION_DISTANCE_SQUARED;

        let closestCornId: bigint | null = null;
        let closestCornDistSq = PLAYER_CORN_INTERACTION_DISTANCE_SQUARED;

        let closestCampfireId: number | null = null;
        let closestCampfireDistSq = PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED;

        let closestDroppedItemId: bigint | null = null;
        let closestDroppedItemDistSq = PLAYER_DROPPED_ITEM_INTERACTION_DISTANCE_SQUARED;

        let closestBoxId: number | null = null;
        let closestBoxDistSq = PLAYER_BOX_INTERACTION_DISTANCE_SQUARED;
        let isClosestBoxEmpty = false;

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
        }

        return {
            closestInteractableMushroomId: closestMushroomId,
            closestInteractableCornId: closestCornId,
            closestInteractableCampfireId: closestCampfireId,
            closestInteractableDroppedItemId: closestDroppedItemId,
            closestInteractableBoxId: closestBoxId,
            isClosestInteractableBoxEmpty: isClosestBoxEmpty,
        };
    // Recalculate when player position or interactable maps change
    }, [localPlayer, mushrooms, corns, campfires, droppedItems, woodenStorageBoxes]);

    return interactionResult;
} 