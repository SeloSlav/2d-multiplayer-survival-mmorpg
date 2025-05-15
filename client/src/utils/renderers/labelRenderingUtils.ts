import {
    Mushroom as SpacetimeDBMushroom,
    Campfire as SpacetimeDBCampfire,
    DroppedItem as SpacetimeDBDroppedItem,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    ItemDefinition as SpacetimeDBItemDefinition,
    Corn as SpacetimeDBCorn,
    Hemp as SpacetimeDBHemp,
    PlayerCorpse as SpacetimeDBPlayerCorpse,
    Stash as SpacetimeDBStash,
    SleepingBag as SpacetimeDBSleepingBag,
    Player as SpacetimeDBPlayer,
    Pumpkin as SpacetimeDBPumpkin
} from '../../generated';
import { CAMPFIRE_HEIGHT, BOX_HEIGHT, SLEEPING_BAG_HEIGHT } from '../../config/gameConfig';

interface RenderLabelsParams {
    ctx: CanvasRenderingContext2D;
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
    players: Map<string, SpacetimeDBPlayer>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
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
    closestInteractableHempId,
    closestInteractableCampfireId,
    closestInteractablePumpkinId,
    closestInteractableDroppedItemId,
    closestInteractableBoxId,
    isClosestInteractableBoxEmpty,
    closestInteractableCorpseId,
    closestInteractableStashId,
    closestInteractableSleepingBagId,
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
            const text = "Press E to Collect";
            const textX = mushroom.posX;
            const textY = mushroom.posY - 60; // Offset above mushroom
            ctx.strokeText(text, textX, textY);
            ctx.fillText(text, textX, textY);
        }
    }

    // Corn Label
    if (closestInteractableCornId !== null) {
        const corn = corns.get(closestInteractableCornId.toString());
        if (corn) {
            const text = "Press E to Harvest";
            const textX = corn.posX;
            const textY = corn.posY - 70; // Slightly higher offset for corn
            ctx.strokeText(text, textX, textY);
            ctx.fillText(text, textX, textY);
        }
    }

    // Pumpkin Label
    if (closestInteractablePumpkinId !== null) {
        const pumpkin = pumpkins.get(closestInteractablePumpkinId.toString());
        if (pumpkin) {
            const text = "Press E to Harvest";
            const textX = pumpkin.posX;
            const textY = pumpkin.posY - 70;
            ctx.strokeText(text, textX, textY);
            ctx.fillText(text, textX, textY);
        }
    }

    // Hemp Label
    if (closestInteractableHempId !== null) {
        const hemp = hemps.get(closestInteractableHempId.toString());
        if (hemp) {
            const text = "Press E to Harvest";
            const textX = hemp.posX;
            const textY = hemp.posY - 70;
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
            const textX = fire.posX;
            const textY = fire.posY - (CAMPFIRE_HEIGHT / 2) - 10; // Offset above campfire sprite
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
            const text = `Press E to loot ${corpse.username}'s backpack`;
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

    ctx.restore(); // Restore original context state
} 