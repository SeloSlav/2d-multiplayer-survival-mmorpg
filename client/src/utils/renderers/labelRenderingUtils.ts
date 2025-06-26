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
    Pumpkin as SpacetimeDBPumpkin,
    RainCollector as SpacetimeDBRainCollector
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

// Define Rain Collector dimensions locally for label positioning
const RAIN_COLLECTOR_HEIGHT = 128; // Doubled from 64

// Define the single target type for labels
interface InteractableTarget {
    type: 'mushroom' | 'corn' | 'potato' | 'pumpkin' | 'hemp' | 'reed' | 'campfire' | 'lantern' | 'dropped_item' | 'box' | 'corpse' | 'stash' | 'sleeping_bag' | 'knocked_out_player' | 'water' | 'rain_collector';
    id: bigint | number | string;
    position: { x: number; y: number };
    distance: number;
    isEmpty?: boolean;
}

interface RenderLabelsParams {
    ctx: CanvasRenderingContext2D;
    mushrooms: Map<string, SpacetimeDBMushroom>;
    corns: Map<string, SpacetimeDBCorn>;
    potatoes: Map<string, SpacetimeDBPotato>;
    pumpkins: Map<string, SpacetimeDBPumpkin>;
    hemps: Map<string, SpacetimeDBHemp>;
    reeds: Map<string, SpacetimeDBReed>;
    campfires: Map<string, SpacetimeDBCampfire>;
    lanterns: Map<string, any>; // Add lanterns parameter
    droppedItems: Map<string, SpacetimeDBDroppedItem>;
    woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>;
    playerCorpses: Map<string, SpacetimeDBPlayerCorpse>;
    stashes: Map<string, SpacetimeDBStash>;
    sleepingBags: Map<string, SpacetimeDBSleepingBag>;
    rainCollectors: Map<string, SpacetimeDBRainCollector>;
    players: Map<string, SpacetimeDBPlayer>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    // NEW: Single unified target
    closestInteractableTarget: InteractableTarget | null;
    // Legacy params kept for backward compatibility but not used
    closestInteractableMushroomId?: bigint | null;
    closestInteractableCornId?: bigint | null;
    closestInteractablePotatoId?: bigint | null;
    closestInteractablePumpkinId?: bigint | null;
    closestInteractableHempId?: bigint | null;
    closestInteractableReedId?: bigint | null;
    closestInteractableCampfireId?: number | null;
    closestInteractableDroppedItemId?: bigint | null;
    closestInteractableBoxId?: number | null;
    isClosestInteractableBoxEmpty?: boolean;
    closestInteractableCorpseId?: bigint | null;
    closestInteractableStashId?: number | null;
    closestInteractableSleepingBagId?: number | null;
    closestInteractableKnockedOutPlayerId?: string | null;
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
    lanterns,
    droppedItems,
    woodenStorageBoxes,
    playerCorpses,
    stashes,
    sleepingBags,
    rainCollectors,
    players,
    itemDefinitions,
    closestInteractableTarget,
}: RenderLabelsParams): void {
    // Only render label if there's a single closest target
    if (!closestInteractableTarget) return;

    ctx.save(); // Save context state before changing styles

    ctx.font = LABEL_FONT;
    ctx.fillStyle = LABEL_FILL_STYLE;
    ctx.strokeStyle = LABEL_STROKE_STYLE;
    ctx.lineWidth = LABEL_LINE_WIDTH;
    ctx.textAlign = LABEL_TEXT_ALIGN;

    const text = "E";
    let textX: number;
    let textY: number;

    // Render label based on the single closest target type
    switch (closestInteractableTarget.type) {
        case 'mushroom': {
            const mushroom = mushrooms.get(closestInteractableTarget.id.toString());
            if (mushroom) {
                const visualCenterY = mushroom.posY - (MUSHROOM_VISUAL_HEIGHT_FOR_INTERACTION / 2);
                textX = mushroom.posX;
                textY = visualCenterY - 30;
                renderStyledInteractionLabel(ctx, text, textX, textY);
            }
            break;
        }
        case 'corn': {
            const corn = corns.get(closestInteractableTarget.id.toString());
            if (corn) {
                const visualCenterY = corn.posY - (CORN_VISUAL_HEIGHT_FOR_INTERACTION / 2);
                textX = corn.posX;
                textY = visualCenterY - 30;
                renderStyledInteractionLabel(ctx, text, textX, textY);
            }
            break;
        }
        case 'potato': {
            const potato = potatoes.get(closestInteractableTarget.id.toString());
            if (potato) {
                const visualCenterY = potato.posY - (POTATO_VISUAL_HEIGHT_FOR_INTERACTION / 2);
                textX = potato.posX;
                textY = visualCenterY - 30;
                renderStyledInteractionLabel(ctx, text, textX, textY);
            }
            break;
        }
        case 'pumpkin': {
            const pumpkin = pumpkins.get(closestInteractableTarget.id.toString());
            if (pumpkin) {
                const visualCenterY = pumpkin.posY - (PUMPKIN_VISUAL_HEIGHT_FOR_INTERACTION / 2);
                textX = pumpkin.posX;
                textY = visualCenterY - 30;
                renderStyledInteractionLabel(ctx, text, textX, textY);
            }
            break;
        }
        case 'hemp': {
            const hemp = hemps.get(closestInteractableTarget.id.toString());
            if (hemp) {
                const visualCenterY = hemp.posY - (HEMP_VISUAL_HEIGHT_FOR_INTERACTION / 2);
                textX = hemp.posX;
                textY = visualCenterY - 30;
                renderStyledInteractionLabel(ctx, text, textX, textY);
            }
            break;
        }
        case 'reed': {
            const reed = reeds.get(closestInteractableTarget.id.toString());
            if (reed) {
                const visualCenterY = reed.posY - (REED_VISUAL_HEIGHT_FOR_INTERACTION / 2);
                textX = reed.posX;
                textY = visualCenterY - 30;
                renderStyledInteractionLabel(ctx, text, textX, textY);
            }
            break;
        }
        case 'dropped_item': {
            const item = droppedItems.get(closestInteractableTarget.id.toString());
            if (item) {
                textX = item.posX;
                textY = item.posY - 25;
                renderStyledInteractionLabel(ctx, text, textX, textY);
            }
            break;
        }
        case 'campfire': {
            const fire = campfires.get(closestInteractableTarget.id.toString());
            if (fire) {
                const visualCenterX = fire.posX;
                const visualCenterY = fire.posY - (CAMPFIRE_HEIGHT / 2) - CAMPFIRE_RENDER_Y_OFFSET;
                textX = visualCenterX;
                textY = visualCenterY - 50;
                renderStyledInteractionLabel(ctx, text, textX, textY);
            }
            break;
        }
        case 'lantern': {
            const lantern = lanterns.get(closestInteractableTarget.id.toString());
            if (lantern) {
                textX = lantern.posX;
                textY = lantern.posY - 75; // Moved E text higher (up) by 10px for better alignment
                renderStyledInteractionLabel(ctx, text, textX, textY);
            }
            break;
        }
        case 'box': {
            const box = woodenStorageBoxes.get(closestInteractableTarget.id.toString());
            if (box) {
                const BOX_COLLISION_Y_OFFSET = 52.0;
                const visualCenterY = box.posY - BOX_COLLISION_Y_OFFSET;
                textX = box.posX;
                textY = visualCenterY - (BOX_HEIGHT / 2) - 0;
                renderStyledInteractionLabel(ctx, text, textX, textY);
            }
            break;
        }
        case 'corpse': {
            const corpse = playerCorpses.get(closestInteractableTarget.id.toString());
            if (corpse) {
                textX = corpse.posX;
                textY = corpse.posY - (48 / 2) - 10;
                renderStyledInteractionLabel(ctx, text, textX, textY);
            }
            break;
        }
        case 'stash': {
            const stash = stashes.get(closestInteractableTarget.id.toString());
            if (stash) {
                const STASH_HEIGHT = 40;
                textX = stash.posX;
                // Position label at the top of the visual center area (same as outline positioning)
                textY = stash.posY - (STASH_HEIGHT / 2) - 30; // Visual center minus half outline height minus label offset
                renderStyledInteractionLabel(ctx, text, textX, textY);
            }
            break;
        }
        case 'sleeping_bag': {
            const sleepingBag = sleepingBags.get(closestInteractableTarget.id.toString());
            if (sleepingBag) {
                textX = sleepingBag.posX;
                textY = sleepingBag.posY - (SLEEPING_BAG_HEIGHT / 2) - 50;
                renderStyledInteractionLabel(ctx, text, textX, textY);
            }
            break;
        }
        case 'knocked_out_player': {
            const knockedOutPlayer = players.get(closestInteractableTarget.id.toString());
            if (knockedOutPlayer && knockedOutPlayer.isKnockedOut && !knockedOutPlayer.isDead) {
                textX = knockedOutPlayer.positionX;
                textY = knockedOutPlayer.positionY - 30;
                renderStyledInteractionLabel(ctx, text, textX, textY);
            }
            break;
        }
        case 'water': {
            // Water interaction label handled elsewhere if needed
            break;
        }
        case 'rain_collector': {
            const rainCollector = rainCollectors.get(closestInteractableTarget.id.toString());
            if (rainCollector) {
                const visualCenterY = rainCollector.posY - (RAIN_COLLECTOR_HEIGHT / 2);
                textX = rainCollector.posX;
                textY = visualCenterY - 5;
                renderStyledInteractionLabel(ctx, text, textX, textY);
            }
            break;
        }
    }

    ctx.restore(); // Restore original context state
} 