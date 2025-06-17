import {
    Mushroom as SpacetimeDBMushroom,
    Campfire as SpacetimeDBCampfire,
    DroppedItem as SpacetimeDBDroppedItem,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    ItemDefinition as SpacetimeDBItemDefinition,
    Corn as SpacetimeDBCorn,
    Potato as SpacetimeDBPotato,
    Hemp as SpacetimeDBHemp,
    Reed as SpacetimeDBReed,
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
    REED_VISUAL_HEIGHT_FOR_INTERACTION,
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
    reeds: Map<string, SpacetimeDBReed>;
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
    closestInteractableReedId: bigint | null;
    closestInteractableCampfireId: number | null;
    closestInteractableDroppedItemId: bigint | null;
    closestInteractableBoxId: number | null;
    isClosestInteractableBoxEmpty: boolean;
    closestInteractableCorpseId: bigint | null;
    closestInteractableStashId: number | null;
    closestInteractableSleepingBagId: number | null;
    closestInteractableKnockedOutPlayerId: string | null;
}

const LABEL_FONT = '14px "Courier New", Consolas, Monaco, monospace'; // 🎯 CYBERPUNK: Match game's main font
const LABEL_FILL_STYLE = "#00ffff"; // 🎯 CYBERPUNK: Bright cyan text
const LABEL_STROKE_STYLE = "black";
const LABEL_LINE_WIDTH = 2;
const LABEL_TEXT_ALIGN = "center";

// 🎯 CYBERPUNK: SOVA Overlay styling constants
const SOVA_BACKGROUND_COLOR = "rgba(0, 0, 0, 0.85)"; // Semi-transparent black
const SOVA_BORDER_COLOR = "#00aaff"; // Bright blue border
const SOVA_GLOW_COLOR = "#00ddff"; // Cyan glow
const SOVA_BORDER_RADIUS = 8;
const SOVA_PADDING_X = 12;
const SOVA_PADDING_Y = 6;
const SOVA_BORDER_WIDTH = 2;

/**
 * 🎯 CYBERPUNK: Draws a SOVA-style overlay background behind interaction text
 * Provides the visual aesthetic of SOVA's augmented reality interface
 */
function drawSOVAOverlayBackground(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number
): void {
    // Measure text to get dimensions
    const textMetrics = ctx.measureText(text);
    const textWidth = textMetrics.width;
    const textHeight = 14; // Font size
    
    // Calculate background dimensions
    const bgWidth = textWidth + (SOVA_PADDING_X * 2);
    const bgHeight = textHeight + (SOVA_PADDING_Y * 2);
    const bgX = x - bgWidth / 2;
    const bgY = y - bgHeight / 2 - textHeight / 4; // Adjust for text baseline
    
    ctx.save();
    
    // 1. Draw outer glow effect
    ctx.shadowColor = SOVA_GLOW_COLOR;
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Draw background with rounded corners
    ctx.fillStyle = SOVA_BACKGROUND_COLOR;
    ctx.beginPath();
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, SOVA_BORDER_RADIUS);
    ctx.fill();
    
    // Reset shadow for border
    ctx.shadowBlur = 0;
    
    // 2. Draw animated border with gradient
    const gradient = ctx.createLinearGradient(bgX, bgY, bgX + bgWidth, bgY + bgHeight);
    gradient.addColorStop(0, SOVA_BORDER_COLOR);
    gradient.addColorStop(0.5, SOVA_GLOW_COLOR);
    gradient.addColorStop(1, SOVA_BORDER_COLOR);
    
    ctx.strokeStyle = gradient;
    ctx.lineWidth = SOVA_BORDER_WIDTH;
    ctx.beginPath();
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, SOVA_BORDER_RADIUS);
    ctx.stroke();
    
    // 3. Draw subtle inner glow
    ctx.shadowColor = SOVA_GLOW_COLOR;
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = `rgba(0, 221, 255, 0.3)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bgX + 2, bgY + 2, bgWidth - 4, bgHeight - 4, SOVA_BORDER_RADIUS - 2);
    ctx.stroke();
    
    // 4. Add subtle scan line effect
    const time = Date.now() * 0.002; // Slow animation
    const scanY = bgY + (Math.sin(time) * 0.5 + 0.5) * bgHeight;
    
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(0, 255, 255, 0.4)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bgX + 4, scanY);
    ctx.lineTo(bgX + bgWidth - 4, scanY);
    ctx.stroke();
    
    ctx.restore();
}

/**
 * 🎯 CYBERPUNK: Renders styled interaction text with SOVA overlay background
 */
function renderStyledInteractionLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number
): void {
    // Draw SOVA background first
    drawSOVAOverlayBackground(ctx, text, x, y);
    
    // Draw text with enhanced styling
    ctx.save();
    
    // Text shadow for better visibility
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    
    // Draw text stroke (outline)
    ctx.strokeText(text, x, y);
    
    // Reset shadow for fill
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Draw text fill
    ctx.fillText(text, x, y);
    
    ctx.restore();
}

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
    reeds,
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
    closestInteractableReedId,
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
            const text = "E";
            const visualCenterY = mushroom.posY - (MUSHROOM_VISUAL_HEIGHT_FOR_INTERACTION / 2);
            const textX = mushroom.posX;
            const textY = visualCenterY - 30; // Offset above visual center
            renderStyledInteractionLabel(ctx, text, textX, textY);
        }
    }

    // Corn Label
    if (closestInteractableCornId !== null) {
        const corn = corns.get(closestInteractableCornId.toString());
        if (corn) {
            const text = "E";
            const visualCenterY = corn.posY - (CORN_VISUAL_HEIGHT_FOR_INTERACTION / 2);
            const textX = corn.posX;
            const textY = visualCenterY - 30; // Offset above visual center
            renderStyledInteractionLabel(ctx, text, textX, textY);
        }
    }

    // Potato Label
    if (closestInteractablePotatoId !== null) {
        const potato = potatoes.get(closestInteractablePotatoId.toString());
        if (potato) {
            const text = "E";
            const visualCenterY = potato.posY - (POTATO_VISUAL_HEIGHT_FOR_INTERACTION / 2);
            const textX = potato.posX;
            const textY = visualCenterY - 30; // Offset above visual center
            renderStyledInteractionLabel(ctx, text, textX, textY);
        }
    }

    // Pumpkin Label
    if (closestInteractablePumpkinId !== null) {
        const pumpkin = pumpkins.get(closestInteractablePumpkinId.toString());
        if (pumpkin) {
            const text = "E";
            const visualCenterY = pumpkin.posY - (PUMPKIN_VISUAL_HEIGHT_FOR_INTERACTION / 2);
            const textX = pumpkin.posX;
            const textY = visualCenterY - 30; // Offset above visual center
            renderStyledInteractionLabel(ctx, text, textX, textY);
        }
    }

    // Hemp Label
    if (closestInteractableHempId !== null) {
        const hemp = hemps.get(closestInteractableHempId.toString());
        if (hemp) {
            const text = "E";
            const visualCenterY = hemp.posY - (HEMP_VISUAL_HEIGHT_FOR_INTERACTION / 2);
            const textX = hemp.posX;
            const textY = visualCenterY - 30; // Offset above visual center
            renderStyledInteractionLabel(ctx, text, textX, textY);
        }
    }

    // Reed Label
    if (closestInteractableReedId !== null) {
        const reed = reeds.get(closestInteractableReedId.toString());
        if (reed) {
            const text = "E";
            const visualCenterY = reed.posY - (REED_VISUAL_HEIGHT_FOR_INTERACTION / 2);
            const textX = reed.posX;
            const textY = visualCenterY - 30; // Offset above visual center
            renderStyledInteractionLabel(ctx, text, textX, textY);
        }
    }

    // Dropped Item Label
    if (closestInteractableDroppedItemId !== null) {
        const item = droppedItems.get(closestInteractableDroppedItemId.toString());
        if (item) {
            const text = "E";
            const textX = item.posX;
            const textY = item.posY - 25; // Offset above item
            renderStyledInteractionLabel(ctx, text, textX, textY);
        }
    }

    // Campfire Label
    if (closestInteractableCampfireId !== null) {
        const fire = campfires.get(closestInteractableCampfireId.toString());
        if (fire) {
            const text = "E";
            const visualCenterX = fire.posX;
            const visualCenterY = fire.posY - (CAMPFIRE_HEIGHT / 2) - CAMPFIRE_RENDER_Y_OFFSET;
            
            const textX = visualCenterX;
            const textY = visualCenterY - 50; // Offset above the visual center
            renderStyledInteractionLabel(ctx, text, textX, textY);
        }
    }

    // Wooden Storage Box Label
    if (closestInteractableBoxId !== null) {
        const box = woodenStorageBoxes.get(closestInteractableBoxId.toString());
        if (box) {
            const text = "E";
            const textX = box.posX;
            // Account for the visual center offset that was applied during placement
            // The stored posY has BOX_COLLISION_Y_OFFSET (52.0) added to it
            const BOX_COLLISION_Y_OFFSET = 52.0;
            const visualCenterY = box.posY - BOX_COLLISION_Y_OFFSET;
            const textY = visualCenterY - (BOX_HEIGHT / 2) - 10; // Offset above visual center
            renderStyledInteractionLabel(ctx, text, textX, textY);
        }
    }

    // Player Corpse Label
    if (closestInteractableCorpseId !== null) {
        const corpse = playerCorpses.get(closestInteractableCorpseId.toString());
        if (corpse) {
            const text = "E";
            const textX = corpse.posX;
            // Offset based on corpse height (using placeholder size for now)
            const textY = corpse.posY - (48 / 2) - 10; 
            renderStyledInteractionLabel(ctx, text, textX, textY);
        }
    }

    // Stash Label
    if (closestInteractableStashId !== null) {
        const stash = stashes.get(closestInteractableStashId.toString());
        if (stash) {
            const text = "E";
            const textX = stash.posX;
            const textY = stash.posY - 30; // Offset above stash (adjust as needed)
            renderStyledInteractionLabel(ctx, text, textX, textY);
        }
    }


    // Knocked Out Player Label
    if (closestInteractableKnockedOutPlayerId !== null) {
        const knockedOutPlayer = players.get(closestInteractableKnockedOutPlayerId);
        if (knockedOutPlayer && knockedOutPlayer.isKnockedOut && !knockedOutPlayer.isDead) {
            const text = "E";
            const textX = knockedOutPlayer.positionX;
            const textY = knockedOutPlayer.positionY - 30; // Offset above player
            renderStyledInteractionLabel(ctx, text, textX, textY);
        }
    }

    ctx.restore(); // Restore original context state
} 