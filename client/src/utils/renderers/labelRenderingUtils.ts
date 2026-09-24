import {
    HarvestableResource as SpacetimeDBHarvestableResource,
    Campfire as SpacetimeDBCampfire,
    DroppedItem as SpacetimeDBDroppedItem,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    ItemDefinition as SpacetimeDBItemDefinition,
    PlayerCorpse as SpacetimeDBPlayerCorpse,
    Stash as SpacetimeDBStash,
    SleepingBag as SpacetimeDBSleepingBag,
    Player as SpacetimeDBPlayer,
    RainCollector as SpacetimeDBRainCollector,
    HomesteadHearth as SpacetimeDBHomesteadHearth, // ADDED: Homestead Hearth
    BrothPot as SpacetimeDBBrothPot, // ADDED: BrothPot
    Door as SpacetimeDBDoor, // ADDED: Door
    AlkStation as SpacetimeDBAlkStation, // ADDED: ALK Station
    Barbecue as SpacetimeDBBarbecue // ADDED: Barbecue
} from '../../generated/types';

// Centralized visual config - single source of truth for all entity visual bounds
import { ENTITY_VISUAL_CONFIG, getLabelPosition } from '../entityVisualConfig';
import { isCompoundMonument } from '../../config/compoundBuildings';
import { DOOR_RENDER_HEIGHT } from './doorRenderingUtils';

// Define the single target type for labels
interface InteractableTarget {
    type: 'harvestable_resource' | 'campfire' | 'furnace' | 'barbecue' | 'fumarole' | 'lantern' | 'turret' | 'dropped_item' | 'box' | 'corpse' | 'stash' | 'sleeping_bag' | 'knocked_out_player' | 'water' | 'rain_collector' | 'homestead_hearth' | 'broth_pot' | 'door' | 'alk_station' | 'cairn' | 'milkable_animal';
    id: bigint | number | string;
    position: { x: number; y: number };
    distance: number;
    isEmpty?: boolean;
    data?: {
        campfireId?: number;
        brothPotId?: number;
        isBrothPotEmpty?: boolean;
        [key: string]: any;
    };
}

interface RenderLabelsParams {
    ctx: CanvasRenderingContext2D;
    harvestableResources: Map<string, any>; // Unified harvestable resources
    campfires: Map<string, SpacetimeDBCampfire>;
    furnaces: Map<string, any>; // ADDED: furnaces parameter
    barbecues?: Map<string, SpacetimeDBBarbecue>; // ADDED: barbecues parameter
    fumaroles: Map<string, any>; // ADDED: fumaroles parameter
    lanterns: Map<string, any>; // Add lanterns parameter
    turrets: Map<string, any>; // ADDED: Turrets parameter
    droppedItems: Map<string, SpacetimeDBDroppedItem>;
    woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>;
    playerCorpses: Map<string, SpacetimeDBPlayerCorpse>;
    stashes: Map<string, SpacetimeDBStash>;
    sleepingBags: Map<string, SpacetimeDBSleepingBag>;
    rainCollectors: Map<string, SpacetimeDBRainCollector>;
    brothPots: Map<string, any>;
    homesteadHearths: Map<string, SpacetimeDBHomesteadHearth>; // ADDED: Homestead Hearths
    doors: Map<string, SpacetimeDBDoor>; // ADDED: Doors
    alkStations: Map<string, SpacetimeDBAlkStation>; // ADDED: ALK Stations
    players: Map<string, SpacetimeDBPlayer>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    wildAnimals?: Map<string, any>; // ADDED: Wild animals for milking interaction
    // Single unified target - replaces individual harvestable resource IDs
    closestInteractableTarget: InteractableTarget | null;
    // Individual entity IDs for consistency and backward compatibility
    closestInteractableHarvestableResourceId?: bigint | null;
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

// Status tag styling constants
const STATUS_TAG_FONT = '10px "Courier New", Consolas, Monaco, monospace';
const STATUS_TAG_PADDING_X = 8;
const STATUS_TAG_PADDING_Y = 4;
const STATUS_TAG_BORDER_RADIUS = 4;
const STATUS_TAG_SPACING = 4; // Space between multiple tags

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
    // Measure text to get dimensions - ensure font is set
    if (!ctx.font) {
        ctx.font = LABEL_FONT; // Fallback if font not set
    }
    const textMetrics = ctx.measureText(text);
    const textWidth = textMetrics.width;
    const textHeight = 14; // Font size
    
    // Calculate background dimensions
    const bgWidth = textWidth + (SOVA_PADDING_X * 2);
    const bgHeight = textHeight + (SOVA_PADDING_Y * 2);
    const bgX = x - bgWidth / 2;
    const bgY = y - bgHeight / 2 - textHeight / 4 - 3; // Adjust for text baseline, moved up 3px
    
    ctx.save();
    
    // Ensure we start with clean state
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1.0;
    
    // 1. Draw outer glow effect
    ctx.shadowColor = SOVA_GLOW_COLOR;
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Draw background with rounded corners - use roundRect if available, otherwise fallback
    ctx.fillStyle = SOVA_BACKGROUND_COLOR;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(bgX, bgY, bgWidth, bgHeight, SOVA_BORDER_RADIUS);
    } else {
        // Fallback for browsers without roundRect support
        const r = SOVA_BORDER_RADIUS;
        ctx.moveTo(bgX + r, bgY);
        ctx.lineTo(bgX + bgWidth - r, bgY);
        ctx.quadraticCurveTo(bgX + bgWidth, bgY, bgX + bgWidth, bgY + r);
        ctx.lineTo(bgX + bgWidth, bgY + bgHeight - r);
        ctx.quadraticCurveTo(bgX + bgWidth, bgY + bgHeight, bgX + bgWidth - r, bgY + bgHeight);
        ctx.lineTo(bgX + r, bgY + bgHeight);
        ctx.quadraticCurveTo(bgX, bgY + bgHeight, bgX, bgY + bgHeight - r);
        ctx.lineTo(bgX, bgY + r);
        ctx.quadraticCurveTo(bgX, bgY, bgX + r, bgY);
        ctx.closePath();
    }
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
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(bgX, bgY, bgWidth, bgHeight, SOVA_BORDER_RADIUS);
    } else {
        // Fallback for browsers without roundRect support
        const r = SOVA_BORDER_RADIUS;
        ctx.moveTo(bgX + r, bgY);
        ctx.lineTo(bgX + bgWidth - r, bgY);
        ctx.quadraticCurveTo(bgX + bgWidth, bgY, bgX + bgWidth, bgY + r);
        ctx.lineTo(bgX + bgWidth, bgY + bgHeight - r);
        ctx.quadraticCurveTo(bgX + bgWidth, bgY + bgHeight, bgX + bgWidth - r, bgY + bgHeight);
        ctx.lineTo(bgX + r, bgY + bgHeight);
        ctx.quadraticCurveTo(bgX, bgY + bgHeight, bgX, bgY + bgHeight - r);
        ctx.lineTo(bgX, bgY + r);
        ctx.quadraticCurveTo(bgX, bgY, bgX + r, bgY);
        ctx.closePath();
    }
    ctx.stroke();
    
    // 3. Draw subtle inner glow
    ctx.shadowColor = SOVA_GLOW_COLOR;
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = `rgba(0, 221, 255, 0.3)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(bgX + 2, bgY + 2, bgWidth - 4, bgHeight - 4, SOVA_BORDER_RADIUS - 2);
    } else {
        // Fallback for browsers without roundRect support
        const r = Math.max(0, SOVA_BORDER_RADIUS - 2);
        ctx.moveTo(bgX + 2 + r, bgY + 2);
        ctx.lineTo(bgX + bgWidth - 2 - r, bgY + 2);
        ctx.quadraticCurveTo(bgX + bgWidth - 2, bgY + 2, bgX + bgWidth - 2, bgY + 2 + r);
        ctx.lineTo(bgX + bgWidth - 2, bgY + bgHeight - 2 - r);
        ctx.quadraticCurveTo(bgX + bgWidth - 2, bgY + bgHeight - 2, bgX + bgWidth - 2 - r, bgY + bgHeight - 2);
        ctx.lineTo(bgX + 2 + r, bgY + bgHeight - 2);
        ctx.quadraticCurveTo(bgX + 2, bgY + bgHeight - 2, bgX + 2, bgY + bgHeight - 2 - r);
        ctx.lineTo(bgX + 2, bgY + 2 + r);
        ctx.quadraticCurveTo(bgX + 2, bgY + 2, bgX + 2 + r, bgY + 2);
        ctx.closePath();
    }
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
    campfires,
    furnaces, // ADDED: furnaces parameter
    barbecues, // ADDED: barbecues parameter
    fumaroles, // ADDED: fumaroles parameter
    lanterns,
    turrets, // ADDED: Turrets parameter
    droppedItems,
    woodenStorageBoxes,
    playerCorpses,
    stashes,
    sleepingBags,
    rainCollectors,
    homesteadHearths, // ADDED: Homestead Hearths
    brothPots, // ADDED: Broth pots
    doors, // ADDED: Doors
    alkStations, // ADDED: ALK Stations
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
    // All positions now come from ENTITY_VISUAL_CONFIG for consistency with blue box
    switch (closestInteractableTarget.type) {
        case 'harvestable_resource': {
            const config = ENTITY_VISUAL_CONFIG.harvestable_resource;
            const labelPos = getLabelPosition(
                closestInteractableTarget.position.x,
                closestInteractableTarget.position.y,
                config
            );
            renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            break;
        }
        case 'dropped_item': {
            const item = droppedItems.get(closestInteractableTarget.id.toString());
            if (item) {
                const config = ENTITY_VISUAL_CONFIG.dropped_item;
                const labelPos = getLabelPosition(item.posX, item.posY, config);
                renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            }
            break;
        }
        case 'campfire': {
            const fire = campfires.get(closestInteractableTarget.id.toString());
            if (fire) {
                const config = ENTITY_VISUAL_CONFIG.campfire;
                const labelPos = getLabelPosition(fire.posX, fire.posY, config);
                renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            }
            break;
        }
        case 'furnace': {
            const furnace = furnaces.get(closestInteractableTarget.id.toString());
            if (furnace) {
                // Select config based on furnace type and monument status
                let config;
                if (furnace.furnaceType === 1 && isCompoundMonument(furnace.isMonument, furnace.posX, furnace.posY)) {
                    config = ENTITY_VISUAL_CONFIG.monument_large_furnace;
                } else if (furnace.furnaceType === 1) {
                    config = ENTITY_VISUAL_CONFIG.large_furnace;
                } else {
                    config = ENTITY_VISUAL_CONFIG.furnace;
                }
                const labelPos = getLabelPosition(furnace.posX, furnace.posY, config);
                renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            }
            break;
        }
        case 'barbecue': {
            const barbecue = barbecues?.get(closestInteractableTarget.id.toString());
            if (barbecue) {
                const config = ENTITY_VISUAL_CONFIG.barbecue;
                const labelPos = getLabelPosition(barbecue.posX, barbecue.posY, config);
                renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            }
            break;
        }
        case 'lantern': {
            const lantern = lanterns.get(closestInteractableTarget.id.toString());
            if (lantern) {
                // Use appropriate config based on lantern type (wards have different dimensions)
                let config;
                if (lantern.lanternType === 1) { // LANTERN_TYPE_ANCESTRAL_WARD
                    config = ENTITY_VISUAL_CONFIG.ancestral_ward;
                } else if (lantern.lanternType === 2) { // LANTERN_TYPE_SIGNAL_DISRUPTOR
                    config = ENTITY_VISUAL_CONFIG.signal_disruptor;
                } else if (lantern.lanternType === 3) { // LANTERN_TYPE_MEMORY_BEACON
                    config = ENTITY_VISUAL_CONFIG.memory_beacon;
                } else {
                    config = ENTITY_VISUAL_CONFIG.lantern;
                }
                const labelPos = getLabelPosition(lantern.posX, lantern.posY, config);
                renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            }
            break;
        }
        case 'turret': {
            const turret = turrets.get(closestInteractableTarget.id.toString());
            if (turret) {
                const config = ENTITY_VISUAL_CONFIG.turret;
                const labelPos = getLabelPosition(turret.posX, turret.posY, config);
                renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            }
            break;
        }
        case 'box': {
            const box = woodenStorageBoxes.get(closestInteractableTarget.id.toString());
            if (box) {
                // Use appropriate config for each box type
                let config;
                const isCompound = isCompoundMonument(box.isMonument, box.posX, box.posY);
                if (box.boxType === 3) { // BOX_TYPE_COMPOST
                    config = isCompound ? ENTITY_VISUAL_CONFIG.monument_compost : ENTITY_VISUAL_CONFIG.compost;
                } else if (box.boxType === 18) { // BOX_TYPE_TANNING_RACK (tall frame — same label anchor as compost)
                    config = ENTITY_VISUAL_CONFIG.compost;
                } else if (box.boxType === 2) { // BOX_TYPE_REFRIGERATOR
                    config = ENTITY_VISUAL_CONFIG.refrigerator;
                } else if (box.boxType === 5) { // BOX_TYPE_REPAIR_BENCH
                    config = isCompound ? ENTITY_VISUAL_CONFIG.monument_repair_bench : ENTITY_VISUAL_CONFIG.repair_bench;
                } else if (box.boxType === 6) { // BOX_TYPE_COOKING_STATION
                    config = isCompound ? ENTITY_VISUAL_CONFIG.monument_cooking_station : ENTITY_VISUAL_CONFIG.cooking_station;
                } else if (box.boxType === 7) { // BOX_TYPE_SCARECROW
                    config = ENTITY_VISUAL_CONFIG.scarecrow;
                } else if (box.boxType === 8) { // BOX_TYPE_MILITARY_RATION
                    config = ENTITY_VISUAL_CONFIG.military_ration;
                } else if (box.boxType === 13) { // BOX_TYPE_MILITARY_CRATE
                    config = ENTITY_VISUAL_CONFIG.military_crate;
                } else if (box.boxType === 9) { // BOX_TYPE_MINE_CART
                    config = ENTITY_VISUAL_CONFIG.mine_cart;
                } else if (box.boxType === 10) { // BOX_TYPE_FISH_TRAP
                    config = ENTITY_VISUAL_CONFIG.fish_trap;
                } else if (box.boxType === 11) { // BOX_TYPE_WILD_BEEHIVE
                    config = ENTITY_VISUAL_CONFIG.wild_beehive;
                } else if (box.boxType === 14 || box.boxType === 15 || box.boxType === 16 || box.boxType === 17) { // Pelt rugs (decorative only)
                    // Never show interaction labels for pelts.
                    return;
                } else {
                    config = ENTITY_VISUAL_CONFIG.wooden_storage_box;
                }
                const labelPos = getLabelPosition(box.posX, box.posY, config);
                // Show different label text for backpacks and scarecrows (no interaction)
                const labelText = box.boxType === 4 ? 'E' : (box.boxType === 7 ? '' : text);
                renderStyledInteractionLabel(ctx, labelText, labelPos.x, labelPos.y);
            }
            break;
        }
        case 'corpse': {
            const corpse = playerCorpses.get(closestInteractableTarget.id.toString());
            if (corpse) {
                const config = ENTITY_VISUAL_CONFIG.player_corpse;
                const labelPos = getLabelPosition(corpse.posX, corpse.posY, config);
                renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            }
            break;
        }
        case 'stash': {
            const stash = stashes.get(closestInteractableTarget.id.toString());
            if (stash) {
                const config = ENTITY_VISUAL_CONFIG.stash;
                const labelPos = getLabelPosition(stash.posX, stash.posY, config);
                renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            }
            break;
        }
        case 'sleeping_bag': {
            const sleepingBag = sleepingBags.get(closestInteractableTarget.id.toString());
            if (sleepingBag) {
                const config = ENTITY_VISUAL_CONFIG.sleeping_bag;
                const labelPos = getLabelPosition(sleepingBag.posX, sleepingBag.posY, config);
                renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            }
            break;
        }
        case 'knocked_out_player': {
            const knockedOutPlayer = players.get(closestInteractableTarget.id.toString());
            if (knockedOutPlayer && knockedOutPlayer.isKnockedOut && !knockedOutPlayer.isDead) {
                const config = ENTITY_VISUAL_CONFIG.knocked_out_player;
                const labelPos = getLabelPosition(knockedOutPlayer.positionX, knockedOutPlayer.positionY, config);
                renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
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
                // Select config based on monument status
                const config = isCompoundMonument(rainCollector.isMonument, rainCollector.posX, rainCollector.posY)
                    ? ENTITY_VISUAL_CONFIG.monument_rain_collector
                    : ENTITY_VISUAL_CONFIG.rain_collector;
                const labelPos = getLabelPosition(rainCollector.posX, rainCollector.posY, config);
                renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            }
            break;
        }
        case 'homestead_hearth': {
            const hearth = homesteadHearths.get(closestInteractableTarget.id.toString());
            if (hearth) {
                const config = ENTITY_VISUAL_CONFIG.homestead_hearth;
                const labelPos = getLabelPosition(hearth.posX, hearth.posY, config);
                renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            }
            break;
        }
        case 'fumarole': {
            const fumarole = fumaroles.get(closestInteractableTarget.id.toString());
            if (fumarole) {
                const config = ENTITY_VISUAL_CONFIG.fumarole;
                const labelPos = getLabelPosition(fumarole.posX, fumarole.posY, config);
                renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            }
            break;
        }
        case 'broth_pot': {
            const brothPot = brothPots.get(closestInteractableTarget.id.toString());
            if (brothPot) {
                const config = ENTITY_VISUAL_CONFIG.broth_pot;
                const labelPos = getLabelPosition(brothPot.posX, brothPot.posY, config);
                renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            }
            break;
        }
        case 'door': {
            const door = doors.get(closestInteractableTarget.id.toString());
            if (door && !door.isDestroyed) {
                const isSideDoor = door.edge === 1 || door.edge === 3;
                const labelPos = isSideDoor
                    ? { x: door.posX, y: door.posY - DOOR_RENDER_HEIGHT / 2 - 17 }
                    : getLabelPosition(door.posX, door.posY, ENTITY_VISUAL_CONFIG.door);
                renderStyledInteractionLabel(ctx, door.isOpen ? 'E - Close Door' : 'E - Open Door', labelPos.x, labelPos.y);
            }
            break;
        }
        case 'alk_station': {
            const station = alkStations.get(closestInteractableTarget.id.toString());
            if (station) {
                const config = ENTITY_VISUAL_CONFIG.alk_station;
                const labelPos = getLabelPosition(station.worldPosX, station.worldPosY, config);
                renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            }
            break;
        }
        case 'cairn': {
            const config = ENTITY_VISUAL_CONFIG.cairn;
            const labelPos = getLabelPosition(
                closestInteractableTarget.position.x,
                closestInteractableTarget.position.y,
                config
            );
            renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            break;
        }
        case 'milkable_animal': {
            // Render E label for milkable tamed animals
            const config = ENTITY_VISUAL_CONFIG.milkable_animal;
            const labelPos = getLabelPosition(
                closestInteractableTarget.position.x,
                closestInteractableTarget.position.y,
                config
            );
            renderStyledInteractionLabel(ctx, text, labelPos.x, labelPos.y);
            break;
        }
    }

    ctx.restore(); // Restore original context state
}

/**
 * Interface for local player status tags rendering params
 */
interface RenderLocalPlayerStatusTagsParams {
    ctx: CanvasRenderingContext2D;
    playerX: number;      // Player's world X position (screen coordinates)
    playerY: number;      // Player's world Y position (screen coordinates)
    isAutoAttacking: boolean;
    isAutoWalking: boolean;
}

/**
 * Draws a single status tag with cyberpunk styling
 */
function drawStatusTag(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    bgColor: string,
    borderColor: string,
    textColor: string,
    glowColor: string
): { width: number; height: number } {
    ctx.save();
    
    // Measure text to get dimensions
    ctx.font = STATUS_TAG_FONT;
    const textMetrics = ctx.measureText(text);
    const textWidth = textMetrics.width;
    const textHeight = 10; // Font size
    
    // Calculate tag dimensions
    const tagWidth = textWidth + (STATUS_TAG_PADDING_X * 2);
    const tagHeight = textHeight + (STATUS_TAG_PADDING_Y * 2);
    const tagX = x - tagWidth / 2;
    const tagY = y;
    
    // Draw outer glow effect
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Draw background with rounded corners
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(tagX, tagY, tagWidth, tagHeight, STATUS_TAG_BORDER_RADIUS);
    } else {
        // Fallback for browsers without roundRect support
        const r = STATUS_TAG_BORDER_RADIUS;
        ctx.moveTo(tagX + r, tagY);
        ctx.lineTo(tagX + tagWidth - r, tagY);
        ctx.quadraticCurveTo(tagX + tagWidth, tagY, tagX + tagWidth, tagY + r);
        ctx.lineTo(tagX + tagWidth, tagY + tagHeight - r);
        ctx.quadraticCurveTo(tagX + tagWidth, tagY + tagHeight, tagX + tagWidth - r, tagY + tagHeight);
        ctx.lineTo(tagX + r, tagY + tagHeight);
        ctx.quadraticCurveTo(tagX, tagY + tagHeight, tagX, tagY + tagHeight - r);
        ctx.lineTo(tagX, tagY + r);
        ctx.quadraticCurveTo(tagX, tagY, tagX + r, tagY);
        ctx.closePath();
    }
    ctx.fill();
    
    // Reset shadow for border
    ctx.shadowBlur = 0;
    
    // Draw border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(tagX, tagY, tagWidth, tagHeight, STATUS_TAG_BORDER_RADIUS);
    } else {
        const r = STATUS_TAG_BORDER_RADIUS;
        ctx.moveTo(tagX + r, tagY);
        ctx.lineTo(tagX + tagWidth - r, tagY);
        ctx.quadraticCurveTo(tagX + tagWidth, tagY, tagX + tagWidth, tagY + r);
        ctx.lineTo(tagX + tagWidth, tagY + tagHeight - r);
        ctx.quadraticCurveTo(tagX + tagWidth, tagY + tagHeight, tagX + tagWidth - r, tagY + tagHeight);
        ctx.lineTo(tagX + r, tagY + tagHeight);
        ctx.quadraticCurveTo(tagX, tagY + tagHeight, tagX, tagY + tagHeight - r);
        ctx.lineTo(tagX, tagY + r);
        ctx.quadraticCurveTo(tagX, tagY, tagX + r, tagY);
        ctx.closePath();
    }
    ctx.stroke();
    
    // Draw text
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, tagY + tagHeight / 2);
    
    ctx.restore();
    
    return { width: tagWidth, height: tagHeight };
}

/**
 * Renders local player status tags below the player sprite.
 * Shows "AUTO ATTACK (Z)" and/or "AUTO WALK (Q)" when active.
 * These tags are LOCAL ONLY - not visible to other players.
 */
export function renderLocalPlayerStatusTags({
    ctx,
    playerX,
    playerY,
    isAutoAttacking,
    isAutoWalking,
}: RenderLocalPlayerStatusTagsParams): void {
    // Skip if no active statuses
    if (!isAutoAttacking && !isAutoWalking) return;
    
    ctx.save();
    
    // Position tags below the player sprite
    // Player sprite is approximately 64px tall (32px * 2 scale), so position below feet
    const baseY = playerY + 40; // Below player sprite
    
    // Collect active tags
    const tags: Array<{
        text: string;
        bgColor: string;
        borderColor: string;
        textColor: string;
        glowColor: string;
    }> = [];
    
    if (isAutoAttacking) {
        tags.push({
            text: 'AUTO ATTACK (Z)',
            bgColor: 'rgba(139, 0, 0, 0.85)',      // Dark red background
            borderColor: '#ff4444',                 // Bright red border
            textColor: '#ffaaaa',                   // Light red text
            glowColor: 'rgba(255, 68, 68, 0.6)',   // Red glow
        });
    }
    
    if (isAutoWalking) {
        tags.push({
            text: 'AUTO WALK (Q)',
            bgColor: 'rgba(0, 60, 100, 0.85)',     // Dark blue background
            borderColor: '#00aaff',                 // Bright cyan border
            textColor: '#aaddff',                   // Light cyan text
            glowColor: 'rgba(0, 170, 255, 0.6)',   // Cyan glow
        });
    }
    
    // Calculate total height needed for all tags
    let currentY = baseY;
    
    // Render each tag
    for (const tag of tags) {
        const { height } = drawStatusTag(
            ctx,
            tag.text,
            playerX,
            currentY,
            tag.bgColor,
            tag.borderColor,
            tag.textColor,
            tag.glowColor
        );
        currentY += height + STATUS_TAG_SPACING;
    }
    
    ctx.restore();
}
