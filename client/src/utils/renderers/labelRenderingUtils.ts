import {
    Mushroom as SpacetimeDBMushroom,
    Campfire as SpacetimeDBCampfire,
    DroppedItem as SpacetimeDBDroppedItem,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    ItemDefinition as SpacetimeDBItemDefinition,
    Corn as SpacetimeDBCorn,
    Potato as SpacetimeDBPotato,
    Hemp as SpacetimeDBHemp,
    PlayerCorpse as SpacetimeDBPlayerCorpse,
    Stash as SpacetimeDBStash,
    SleepingBag as SpacetimeDBSleepingBag,
    Player as SpacetimeDBPlayer,
    Pumpkin as SpacetimeDBPumpkin
} from '../../generated';

// Import visual heights from useInteractionFinder.ts
import {
    MUSHROOM_VISUAL_HEIGHT_FOR_INTERACTION,
    CORN_VISUAL_HEIGHT_FOR_INTERACTION,
    POTATO_VISUAL_HEIGHT_FOR_INTERACTION,
    HEMP_VISUAL_HEIGHT_FOR_INTERACTION,
    PUMPKIN_VISUAL_HEIGHT_FOR_INTERACTION
} from '../../hooks/useInteractionFinder';

import { CAMPFIRE_HEIGHT, CAMPFIRE_RENDER_Y_OFFSET } from './campfireRenderingUtils';
import { BOX_HEIGHT } from './woodenStorageBoxRenderingUtils';

// Import resource configuration helper to get proper interaction labels
import { getResourceInteractionLabel } from './resourceConfigurations';

// Define Sleeping Bag dimensions locally for label positioning
const SLEEPING_BAG_HEIGHT = 64;

interface RenderLabelsParams {
    ctx: CanvasRenderingContext2D;
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
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
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
    closestInteractableKnockedOutPlayerId: string | null;
}

const LABEL_FONT = '14px "Press Start 2P", cursive';
const LABEL_FILL_STYLE = "white";
const LABEL_STROKE_STYLE = "black";
const LABEL_LINE_WIDTH = 2;
const LABEL_TEXT_ALIGN = "center";

/**
 * Renders interaction labels ("Press E...") for the closest interactable objects.
 */
export function renderInteractionLabels({
    ctx,
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
    itemDefinitions,
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
}: RenderLabelsParams): void {
    ctx.save(); // Save context state before changing styles

    ctx.font = LABEL_FONT;
    ctx.fillStyle = LABEL_FILL_STYLE;
    ctx.strokeStyle = LABEL_STROKE_STYLE;
    ctx.lineWidth = LABEL_LINE_WIDTH;
    ctx.textAlign = LABEL_TEXT_ALIGN;

    // Mushroom Label
    if (closestInteractableMushroomId !== null) {
        const mushroom = mushrooms.get(closestInteractableMushroomId.toString());
        if (mushroom) {
            const text = getResourceInteractionLabel('mushroom');
            const visualCenterY = mushroom.posY - (MUSHROOM_VISUAL_HEIGHT_FOR_INTERACTION / 2);
            const textX = mushroom.posX;
            const textY = visualCenterY - 30; // Offset above visual center
            ctx.strokeText(text, textX, textY);
            ctx.fillText(text, textX, textY);
        }
    }

    // Corn Label
    if (closestInteractableCornId !== null) {
        const corn = corns.get(closestInteractableCornId.toString());
        if (corn) {
            const text = getResourceInteractionLabel('corn');
            const visualCenterY = corn.posY - (CORN_VISUAL_HEIGHT_FOR_INTERACTION / 2);
            const textX = corn.posX;
            const textY = visualCenterY - 30; // Offset above visual center
            ctx.strokeText(text, textX, textY);
            ctx.fillText(text, textX, textY);
        }
    }

    // Potato Label
    if (closestInteractablePotatoId !== null) {
        const potato = potatoes.get(closestInteractablePotatoId.toString());
        if (potato) {
            const text = getResourceInteractionLabel('potato');
            const visualCenterY = potato.posY - (POTATO_VISUAL_HEIGHT_FOR_INTERACTION / 2);
            const textX = potato.posX;
            const textY = visualCenterY - 30; // Offset above visual center
            ctx.strokeText(text, textX, textY);
            ctx.fillText(text, textX, textY);
        }
    }

    // Pumpkin Label
    if (closestInteractablePumpkinId !== null) {
        const pumpkin = pumpkins.get(closestInteractablePumpkinId.toString());
        if (pumpkin) {
            const text = getResourceInteractionLabel('pumpkin');
            const visualCenterY = pumpkin.posY - (PUMPKIN_VISUAL_HEIGHT_FOR_INTERACTION / 2);
            const textX = pumpkin.posX;
            const textY = visualCenterY - 30; // Offset above visual center
            ctx.strokeText(text, textX, textY);
            ctx.fillText(text, textX, textY);
        }
    }

    // Hemp Label
    if (closestInteractableHempId !== null) {
        const hemp = hemps.get(closestInteractableHempId.toString());
        if (hemp) {
            const text = getResourceInteractionLabel('hemp');
            const visualCenterY = hemp.posY - (HEMP_VISUAL_HEIGHT_FOR_INTERACTION / 2);
            const textX = hemp.posX;
            const textY = visualCenterY - 30; // Offset above visual center
            ctx.strokeText(text, textX, textY);
            ctx.fillText(text, textX, textY);
        }
    }

    // Dropped Item Label
    if (closestInteractableDroppedItemId !== null) {
        const item = droppedItems.get(closestInteractableDroppedItemId.toString());
        if (item) {
            const itemDef = itemDefinitions.get(item.itemDefId.toString());
            const itemName = itemDef ? itemDef.name : 'Item';
            const text = `Press E to pick up ${itemName} (x${item.quantity})`;
            const textX = item.posX;
            const textY = item.posY - 25; // Offset above item
            ctx.strokeText(text, textX, textY);
            ctx.fillText(text, textX, textY);
        }
    }

    // Campfire Label
    if (closestInteractableCampfireId !== null) {
        const fire = campfires.get(closestInteractableCampfireId.toString());
        if (fire) {
            const text = "Press E to Open";
            const visualCenterX = fire.posX;
            const visualCenterY = fire.posY - (CAMPFIRE_HEIGHT / 2) - CAMPFIRE_RENDER_Y_OFFSET;
            
            const textX = visualCenterX;
            const textY = visualCenterY - 50; // Offset above the visual center
            ctx.strokeText(text, textX, textY);
            ctx.fillText(text, textX, textY);
        }
    }

    // Wooden Storage Box Label
    if (closestInteractableBoxId !== null) {
        const box = woodenStorageBoxes.get(closestInteractableBoxId.toString());
        if (box) {
            const text = isClosestInteractableBoxEmpty ? "Hold E to Pick Up" : "Press E to Open";
            const textX = box.posX;
            const textY = box.posY - (BOX_HEIGHT / 2) - 10; // Offset above box sprite
            ctx.strokeText(text, textX, textY);
            ctx.fillText(text, textX, textY);
        }
    }

    // Player Corpse Label
    if (closestInteractableCorpseId !== null) {
        const corpse = playerCorpses.get(closestInteractableCorpseId.toString());
        if (corpse) {
            const text = `Press E to loot ${corpse.username}'s body`;
            const textX = corpse.posX;
            // Offset based on corpse height (using placeholder size for now)
            const textY = corpse.posY - (48 / 2) - 10; 
            ctx.strokeText(text, textX, textY);
            ctx.fillText(text, textX, textY);
        }
    }

    // Stash Label
    if (closestInteractableStashId !== null) {
        const stash = stashes.get(closestInteractableStashId.toString());
        if (stash) {
            const text = stash.isHidden ? "Hold E to Surface" : "Press E to Open / Hold to Hide";
            const textX = stash.posX;
            const textY = stash.posY - 30; // Offset above stash (adjust as needed)
            ctx.strokeText(text, textX, textY);
            ctx.fillText(text, textX, textY);
        }
    }

    // Sleeping Bag Label
    if (closestInteractableSleepingBagId !== null) {
        const sleepingBag = sleepingBags.get(closestInteractableSleepingBagId.toString());
        if (sleepingBag) {
            const ownerPlayer = players.get(sleepingBag.placedBy.toHexString());
            const ownerName = ownerPlayer ? ownerPlayer.username : "Someone";
            const text = `${ownerName}'s Sleeping Bag`;
            const textX = sleepingBag.posX;
            // Adjust Y offset as needed, similar to campfire or box
            const textY = sleepingBag.posY - (SLEEPING_BAG_HEIGHT / 2) - 50;
            ctx.strokeText(text, textX, textY);
            ctx.fillText(text, textX, textY);
        }
    }

    // Knocked Out Player Label
    if (closestInteractableKnockedOutPlayerId !== null) {
        const knockedOutPlayer = players.get(closestInteractableKnockedOutPlayerId);
        if (knockedOutPlayer && knockedOutPlayer.isKnockedOut && !knockedOutPlayer.isDead) {
            const text = `Hold E to revive ${knockedOutPlayer.username}`;
            const textX = knockedOutPlayer.positionX;
            const textY = knockedOutPlayer.positionY - 30; // Offset above player
            ctx.strokeText(text, textX, textY);
            ctx.fillText(text, textX, textY);
        }
    }

    ctx.restore(); // Restore original context state
} 