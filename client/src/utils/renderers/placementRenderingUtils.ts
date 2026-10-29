import type { PlacementItemInfo } from '../../hooks/usePlacementManager';
import type { BuildingPlacementState } from '../../engine/runtime/buildingPlacementRuntime';
// Import dimensions directly from their respective rendering utility files
import { CAMPFIRE_WIDTH_PREVIEW, CAMPFIRE_HEIGHT_PREVIEW } from './campfireRenderingUtils';
import { FURNACE_WIDTH_PREVIEW, FURNACE_HEIGHT_PREVIEW, LARGE_FURNACE_WIDTH, LARGE_FURNACE_HEIGHT } from './furnaceRenderingUtils'; // ADDED: Furnace dimensions
import { BARBECUE_WIDTH_PREVIEW, BARBECUE_HEIGHT_PREVIEW } from './barbecueRenderingUtils'; // ADDED: Barbecue dimensions
import { ENTITY_VISUAL_CONFIG, getPlacementPreviewPosition } from '../entityVisualConfig'; // Centralized visual config
import { 
    LANTERN_WIDTH_PREVIEW, LANTERN_HEIGHT_PREVIEW,
    ANCESTRAL_WARD_WIDTH, ANCESTRAL_WARD_HEIGHT,
    SIGNAL_DISRUPTOR_WIDTH, SIGNAL_DISRUPTOR_HEIGHT,
    MEMORY_BEACON_WIDTH, MEMORY_BEACON_HEIGHT
} from './lanternRenderingUtils';
import { TURRET_WIDTH_PREVIEW, TURRET_HEIGHT_PREVIEW } from './turretRenderingUtils';
import { SLEEPING_BAG_WIDTH, SLEEPING_BAG_HEIGHT } from './sleepingBagRenderingUtils';
import { STASH_WIDTH, STASH_HEIGHT } from './stashRenderingUtils';
import { SHELTER_RENDER_WIDTH, SHELTER_RENDER_HEIGHT } from './shelterRenderingUtils';
import { HEARTH_WIDTH, HEARTH_HEIGHT } from './hearthRenderingUtils'; // ADDED: Hearth dimensions
import { COMPOST_WIDTH, COMPOST_HEIGHT, REFRIGERATOR_WIDTH, REFRIGERATOR_HEIGHT, LARGE_BOX_WIDTH, LARGE_BOX_HEIGHT, REPAIR_BENCH_WIDTH, REPAIR_BENCH_HEIGHT, COOKING_STATION_WIDTH, COOKING_STATION_HEIGHT, PLAYER_BEEHIVE_WIDTH, PLAYER_BEEHIVE_HEIGHT, SCARECROW_WIDTH, SCARECROW_HEIGHT } from './woodenStorageBoxRenderingUtils'; // ADDED: Compost, Refrigerator, Large Box, Repair Bench, Cooking Station, Scarecrow, and Beehive dimensions
import { getPlacementSquareBounds } from '../../config/placeablePlacementConfig';
import type { DbConnection } from '../../generated';
import { renderFoundationPreview, renderWallPreview, renderFencePreview } from './foundationRenderingUtils';
import { renderSideDoorProfile } from './doorRenderingUtils';

import { evaluatePlacementPreview } from '../../engine/placement/placementValidation';
import type { PlacementEvaluationInput } from '../../engine/placement/placementValidation';
export { worldPosToTileCoords, worldPosToTileKey, getTileTypeFromChunkData, invalidateChunkCache, checkPlacementOverlap, isPlacementTooFar } from '../../engine/placement/placementValidation';

interface RenderPlacementPreviewParams {
    ctx: CanvasRenderingContext2D;
    placementInfo: PlacementItemInfo | null;
    buildingState: BuildingPlacementState | null; // NEW: Building placement state
    itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
    doodadImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
    shelterImageRef?: React.RefObject<HTMLImageElement | null>;
    worldMouseX: number | null;
    worldMouseY: number | null;
    isPlacementTooFar: boolean;
    placementError: string | null;
    onClearPlacementError?: () => void; // Called when cursor moves to valid position so preview can turn blue again
    connection: DbConnection | null;
    worldScale: number; // NEW: World scale for building previews
    viewOffsetX: number; // NEW: View offset for building previews
    viewOffsetY: number; // NEW: View offset for building previews
    localPlayerX: number; // NEW: Player position for validation
    localPlayerY: number; // NEW: Player position for validation
    inventoryItems?: PlacementEvaluationInput['inventoryItems'];
    itemDefinitions?: PlacementEvaluationInput['itemDefinitions'];
    foundationTileImagesRef?: React.RefObject<Map<string, HTMLImageElement>>; // ADDED: Foundation tile images
}

/**
 * Renders the placement preview item/structure following the mouse.
 */
export function renderPlacementPreview({
    ctx,
    placementInfo,
    buildingState,
    itemImagesRef,
    doodadImagesRef,
    shelterImageRef,
    worldMouseX,
    worldMouseY,
    isPlacementTooFar,
    placementError,
    onClearPlacementError,
    connection,
    worldScale,
    viewOffsetX,
    viewOffsetY,
    localPlayerX,
    localPlayerY,
    inventoryItems,
    itemDefinitions,
    foundationTileImagesRef,
}: RenderPlacementPreviewParams): string | null {
    const plan = evaluatePlacementPreview({ placementInfo, buildingState, worldMouseX, worldMouseY,
        isPlacementTooFar, placementError, connection, localPlayerX, localPlayerY, inventoryItems, itemDefinitions });
    if (!plan) return null;
    if (plan.clearError) onClearPlacementError?.();
    if (plan.kind !== 'item') {
        const common = { ctx, cellX: plan.cellX, cellY: plan.cellY, tier: plan.tier, isValid: plan.valid,
            worldScale, viewOffsetX, viewOffsetY, foundationTileImagesRef };
        if (plan.kind === 'foundation') renderFoundationPreview({ ...common, shape: plan.shape });
        else if (plan.kind === 'wall') renderWallPreview({ ...common, worldMouseX: worldMouseX!, worldMouseY: worldMouseY!, connection });
        else renderFencePreview({ ...common, edge: plan.edge, worldMouseX: worldMouseX!, worldMouseY: worldMouseY!, doodadImagesRef });
        return plan.warning;
    }
    if (!placementInfo) return null;
    const isSeedPlacement = plan.isSeedPlacement;
    const isDoorPlacement = placementInfo.iconAssetName === 'wood_door.png' || placementInfo.iconAssetName === 'metal_door.png';
    const doorEdgeForPreview = plan.edge;

    // Determine which image to use for the preview
    let previewImg: HTMLImageElement | undefined;
    
    if (isSeedPlacement) {
        // For seeds, use the planted_seed.png from doodads folder
        previewImg = doodadImagesRef.current?.get('planted_seed.png');
    } else if (placementInfo.iconAssetName === 'shelter.png' && shelterImageRef?.current) {
        // For shelters, use the shelter image from doodads folder
        previewImg = shelterImageRef.current;
    } else if (isDoorPlacement) {
        // For doors, use the doodads images (not item icons)
        // Determine which door sprite to use based on edge and type
        const isNorthEdge = doorEdgeForPreview === 0;
        
        if (placementInfo.iconAssetName === 'wood_door.png') {
            previewImg = doodadImagesRef.current?.get(isNorthEdge ? 'wood_door_north.png' : 'wood_door.png');
        } else if (placementInfo.iconAssetName === 'metal_door.png') {
            previewImg = doodadImagesRef.current?.get(isNorthEdge ? 'metal_door_north.png' : 'metal_door.png');
        }
    } else if (placementInfo.itemName === 'Compost' || placementInfo.iconAssetName === 'compost.png') {
        // For compost, use the compost.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('compost.png');
    } else if (placementInfo.itemName === 'Tanning Rack' || placementInfo.iconAssetName === 'tanning_rack.png') {
        previewImg = doodadImagesRef.current?.get('tanning_rack.png');
    } else if (placementInfo.iconAssetName === 'barbecue.png') {
        // For barbecue, use the barbecue.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('barbecue.png');
    } else if (placementInfo.iconAssetName === 'refrigerator.png') {
        // For refrigerator, use the refrigerator.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('refrigerator.png');
    } else if (placementInfo.iconAssetName === 'repair_bench.png') {
        // For repair bench, use the repair_bench.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('repair_bench.png');
    } else if (placementInfo.iconAssetName === 'cooking_station.png') {
        // For cooking station, use the cooking_station.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('cooking_station.png');
    } else if (placementInfo.iconAssetName === 'scarecrow.png') {
        // For scarecrow, use the scarecrow.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('scarecrow.png');
    } else if (placementInfo.iconAssetName === 'large_wood_box.png') {
        // For large wooden box, use the large_wood_box.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('large_wood_box.png');
    } else if (placementInfo.iconAssetName === 'ancestral_ward.png') {
        // For Ancestral Ward, use the "off" version from doodads folder for placement preview
        previewImg = doodadImagesRef.current?.get('ancestral_ward_off.png');
    } else if (placementInfo.iconAssetName === 'signal_disruptor.png') {
        // For Signal Disruptor, use the "off" version from doodads folder for placement preview
        previewImg = doodadImagesRef.current?.get('signal_disruptor_off.png');
    } else if (placementInfo.iconAssetName === 'memory_beacon.png') {
        // For Memory Beacon, use the single sprite from doodads folder for placement preview
        previewImg = doodadImagesRef.current?.get('memory_beacon.png');
    } else if (placementInfo.iconAssetName === 'turret_tallow.png') {
        // For Tallow Steam Turret, use the sprite from doodads folder for placement preview
        previewImg = doodadImagesRef.current?.get('turret_tallow.png');
    } else if (placementInfo.iconAssetName === 'beehive_wooden.png') {
        // For Wooden Beehive, use the beehive_wooden.png from doodads folder for placement preview
        previewImg = doodadImagesRef.current?.get('beehive_wooden.png');
    } else if (placementInfo.iconAssetName === 'reed_rain_collector.png') {
        // For Reed Rain Collector, use the doodad sprite for placement preview
        previewImg = doodadImagesRef.current?.get('reed_rain_collector.png');
    } else if (placementInfo.iconAssetName === 'furnace_simple.png') {
        // For Furnace, use the furnace_simple.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('furnace_simple.png');
    } else if (placementInfo.iconAssetName === 'large_furnace.png') {
        // For Large Furnace, use the large_furnace_off.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('large_furnace_off.png');
    } else if (placementInfo.iconAssetName === 'campfire.png') {
        // For Campfire, use the campfire_off.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('campfire_off.png');
    } else if (placementInfo.iconAssetName === 'lantern_off.png') {
        // For Lantern, use the lantern_off.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('lantern_off.png');
    } else if (placementInfo.iconAssetName === 'hearth.png') {
        // For Hearth, use the hearth.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('hearth.png');
    } else if (placementInfo.iconAssetName === 'sleeping_bag.png') {
        // For Sleeping Bag, use the sleeping_bag.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('sleeping_bag.png');
    } else if (
        placementInfo.iconAssetName === 'wolf_pelt.png' ||
        placementInfo.iconAssetName === 'fox_pelt.png' ||
        placementInfo.iconAssetName === 'polar_bear_pelt.png' ||
        placementInfo.iconAssetName === 'walrus_pelt.png'
    ) {
        // Pelt rugs render with their item sprite, sleeping-bag style footprint.
        previewImg = itemImagesRef.current?.get(placementInfo.iconAssetName);
    } else if (placementInfo.iconAssetName === 'stash.png') {
        // For Stash, use the stash.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('stash.png');
    } else if (placementInfo.iconAssetName === 'wooden_storage_box.png') {
        // For Wooden Storage Box, use the wooden_storage_box.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('wooden_storage_box.png');
    } else if (placementInfo.iconAssetName === 'fish_trap.png') {
        // For Fish Trap, use the fish_trap.png from doodads folder (matches actual placement rendering)
        previewImg = doodadImagesRef.current?.get('fish_trap.png');
    } else {
        // For other items, use the item images
        previewImg = itemImagesRef.current?.get(placementInfo.iconAssetName);
    }

    // Determine width/height based on placement item (all previews centered on cursor)
    let drawWidth = CAMPFIRE_WIDTH_PREVIEW; // Default to campfire
    let drawHeight = CAMPFIRE_HEIGHT_PREVIEW;

    if (placementInfo.iconAssetName === 'furnace_simple.png') { // ADDED: Furnace placement dimensions
        drawWidth = FURNACE_WIDTH_PREVIEW; 
        drawHeight = FURNACE_HEIGHT_PREVIEW;
    } else if (placementInfo.iconAssetName === 'large_furnace.png') { // ADDED: Large Furnace placement dimensions
        drawWidth = LARGE_FURNACE_WIDTH; 
        drawHeight = LARGE_FURNACE_HEIGHT;
    } else if (placementInfo.iconAssetName === 'barbecue.png') { // ADDED: Barbecue placement dimensions
        drawWidth = BARBECUE_WIDTH_PREVIEW; 
        drawHeight = BARBECUE_HEIGHT_PREVIEW;
    } else if (placementInfo.iconAssetName === 'lantern_off.png') {
        drawWidth = LANTERN_WIDTH_PREVIEW; 
        drawHeight = LANTERN_HEIGHT_PREVIEW;
    } else if (placementInfo.iconAssetName === 'ancestral_ward.png') {
        // Ancestral Ward preview dimensions (Tier 1 ward - larger than lantern)
        drawWidth = ANCESTRAL_WARD_WIDTH;
        drawHeight = ANCESTRAL_WARD_HEIGHT;
    } else if (placementInfo.iconAssetName === 'signal_disruptor.png') {
        // Signal Disruptor preview dimensions (Tier 2 ward)
        drawWidth = SIGNAL_DISRUPTOR_WIDTH;
        drawHeight = SIGNAL_DISRUPTOR_HEIGHT;
    } else if (placementInfo.iconAssetName === 'memory_beacon.png') {
        // Memory Resonance Beacon preview dimensions (Tier 3 ward)
        drawWidth = MEMORY_BEACON_WIDTH;
        drawHeight = MEMORY_BEACON_HEIGHT;
    } else if (placementInfo.iconAssetName === 'turret_tallow.png') {
        // Tallow Steam Turret preview dimensions (same as wards - 256x256)
        drawWidth = TURRET_WIDTH_PREVIEW;
        drawHeight = TURRET_HEIGHT_PREVIEW;
    } else if (placementInfo.itemName === 'Compost' || placementInfo.iconAssetName === 'compost.png') {
        // Compost preview dimensions (matches actual rendering: 128px x 128px)
        drawWidth = COMPOST_WIDTH; // 128px
        drawHeight = COMPOST_HEIGHT; // 128px
    } else if (placementInfo.itemName === 'Tanning Rack' || placementInfo.iconAssetName === 'tanning_rack.png') {
        drawWidth = COMPOST_WIDTH;
        drawHeight = COMPOST_HEIGHT;
    } else if (placementInfo.iconAssetName === 'wooden_storage_box.png') {
        // Regular wooden storage box uses campfire dimensions for preview
        drawWidth = CAMPFIRE_WIDTH_PREVIEW; 
        drawHeight = CAMPFIRE_HEIGHT_PREVIEW;
    } else if (placementInfo.iconAssetName === 'refrigerator.png') {
        // Refrigerator preview dimensions (matches actual rendering - 96x96 squared)
        drawWidth = REFRIGERATOR_WIDTH; // 96px
        drawHeight = REFRIGERATOR_HEIGHT; // 96px
    } else if (placementInfo.iconAssetName === 'repair_bench.png') {
        // Repair Bench preview dimensions (matches actual rendering - 192x192)
        drawWidth = REPAIR_BENCH_WIDTH; // 192px
        drawHeight = REPAIR_BENCH_HEIGHT; // 192px
    } else if (placementInfo.iconAssetName === 'cooking_station.png') {
        // Cooking Station preview dimensions (matches actual rendering - 192x192)
        drawWidth = COOKING_STATION_WIDTH; // 192px
        drawHeight = COOKING_STATION_HEIGHT; // 192px
    } else if (placementInfo.iconAssetName === 'beehive_wooden.png') {
        // Wooden Beehive preview dimensions (matches actual rendering - 256x256)
        drawWidth = PLAYER_BEEHIVE_WIDTH; // 256px
        drawHeight = PLAYER_BEEHIVE_HEIGHT; // 256px
    } else if (placementInfo.iconAssetName === 'fish_trap.png') {
        // Fish Trap preview dimensions (matches actual rendering - 132x132)
        drawWidth = 132;
        drawHeight = 132;
    } else if (placementInfo.iconAssetName === 'scarecrow.png') {
        // Scarecrow preview dimensions (matches actual rendering - square image)
        drawWidth = SCARECROW_WIDTH;
        drawHeight = SCARECROW_HEIGHT;
    } else if (placementInfo.iconAssetName === 'large_wood_box.png') {
        // Large wooden box preview dimensions (matches actual rendering)
        drawWidth = LARGE_BOX_WIDTH; // 96px
        drawHeight = LARGE_BOX_HEIGHT; // 96px
    } else if (placementInfo.iconAssetName === 'sleeping_bag.png') {
        drawWidth = SLEEPING_BAG_WIDTH; 
        drawHeight = SLEEPING_BAG_HEIGHT;
    } else if (
        placementInfo.iconAssetName === 'wolf_pelt.png' ||
        placementInfo.iconAssetName === 'fox_pelt.png' ||
        placementInfo.iconAssetName === 'polar_bear_pelt.png' ||
        placementInfo.iconAssetName === 'walrus_pelt.png'
    ) {
        drawWidth = SLEEPING_BAG_WIDTH;
        drawHeight = SLEEPING_BAG_HEIGHT;
    } else if (placementInfo.iconAssetName === 'stash.png') {
        drawWidth = STASH_WIDTH;
        drawHeight = STASH_HEIGHT;
    } else if (placementInfo.iconAssetName === 'shelter.png') {
        drawWidth = SHELTER_RENDER_WIDTH; 
        drawHeight = SHELTER_RENDER_HEIGHT;
    } else if (placementInfo.iconAssetName === 'reed_rain_collector.png') {
        // Rain collector uses 256x256 sprite (matches beehive)
        drawWidth = 256;
        drawHeight = 256;
    } else if (placementInfo.iconAssetName === 'hearth.png') {
        // Matron's Chest preview dimensions (matches actual rendering: 125px, 30% larger than base 96px)
        drawWidth = HEARTH_WIDTH;  // 125px
        drawHeight = HEARTH_HEIGHT; // 125px
    } else if (placementInfo.iconAssetName === 'field_cauldron.png') {
        // Broth pot preview dimensions (similar to rain collector)
        drawWidth = 80;
        drawHeight = 80;
    } else if (placementInfo.iconAssetName === 'wood_door.png' || placementInfo.iconAssetName === 'metal_door.png') {
        // Door preview dimensions (matches FOUNDATION_TILE_SIZE)
        drawWidth = 96;
        drawHeight = 96;
    } else if (isSeedPlacement) {
        // Seeds should match the actual planted seed size (48x48)
        drawWidth = 48;  
        drawHeight = 48;
    } else if (placementInfo.iconAssetName === 'babushka_surprise.png' || placementInfo.iconAssetName === 'matriarch_wrath.png') {
        // Explosives preview - medium size for visibility
        drawWidth = 64;
        drawHeight = 64;
    }

    ctx.save();

    const { x: snappedX, y: snappedY, edge: doorEdge, grid: placementConfig, warning: placementWarning } = plan;
    const isInvalidPlacement = !plan.valid;

    if (isInvalidPlacement) {
        // Strong red tint for all invalid placements
        ctx.filter = 'sepia(100%) hue-rotate(320deg) saturate(400%) brightness(1.0) contrast(120%)';
        ctx.globalAlpha = 0.8;
    } else {
        // Blue tint for valid placement positions
        ctx.filter = 'sepia(100%) hue-rotate(200deg) saturate(300%) brightness(1.1) contrast(110%)';
        ctx.globalAlpha = 0.7;
    }

    // Calculate the draw position - use centralized config when available
    let adjustedX: number;
    let adjustedY: number;
    
    if (isDoorPlacement) {
        const sideDoor = doorEdge === 1 || doorEdge === 3;
        adjustedX = snappedX - (sideDoor ? 24 : drawWidth) / 2;
        adjustedY = snappedY - drawHeight / 2 - (sideDoor ? 0 : 44);
    } else if (placementInfo.iconAssetName === 'barbecue.png') {
        // Use centralized visual config for barbecue
        const config = ENTITY_VISUAL_CONFIG.barbecue;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        // Override draw dimensions from config
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.itemName === 'Compost' || placementInfo.iconAssetName === 'compost.png') {
        // Use centralized visual config for compost
        const config = ENTITY_VISUAL_CONFIG.compost;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        // Override draw dimensions from config
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.itemName === 'Tanning Rack' || placementInfo.iconAssetName === 'tanning_rack.png') {
        const config = ENTITY_VISUAL_CONFIG.tanning_rack;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'refrigerator.png') {
        // Use centralized visual config for refrigerator
        const config = ENTITY_VISUAL_CONFIG.refrigerator;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        // Override draw dimensions from config
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'repair_bench.png') {
        // Use centralized visual config for repair bench
        const config = ENTITY_VISUAL_CONFIG.repair_bench;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        // Override draw dimensions from config
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'cooking_station.png') {
        // Use centralized visual config for cooking station
        const config = ENTITY_VISUAL_CONFIG.cooking_station;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        // Override draw dimensions from config
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'scarecrow.png') {
        // Use centralized visual config for scarecrow
        const config = ENTITY_VISUAL_CONFIG.scarecrow;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        // Override draw dimensions from config
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'ancestral_ward.png') {
        // Use centralized visual config for Ancestral Ward
        const config = ENTITY_VISUAL_CONFIG.ancestral_ward;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'signal_disruptor.png') {
        // Use centralized visual config for Signal Disruptor
        const config = ENTITY_VISUAL_CONFIG.signal_disruptor;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'memory_beacon.png') {
        // Use centralized visual config for Memory Resonance Beacon
        const config = ENTITY_VISUAL_CONFIG.memory_beacon;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'turret_tallow.png') {
        // Use centralized visual config for Tallow Steam Turret
        const config = ENTITY_VISUAL_CONFIG.turret;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'reed_rain_collector.png') {
        // Use centralized visual config for Reed Rain Collector
        const config = ENTITY_VISUAL_CONFIG.rain_collector;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (
        placementInfo.iconAssetName === 'sleeping_bag.png' ||
        placementInfo.iconAssetName === 'wolf_pelt.png' ||
        placementInfo.iconAssetName === 'fox_pelt.png' ||
        placementInfo.iconAssetName === 'polar_bear_pelt.png' ||
        placementInfo.iconAssetName === 'walrus_pelt.png'
    ) {
        // Use centralized visual config for sleeping bag (bottom-anchored)
        const config = ENTITY_VISUAL_CONFIG.sleeping_bag;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'large_wood_box.png') {
        // Use centralized visual config for large wooden storage box (bottom-anchored)
        const config = ENTITY_VISUAL_CONFIG.large_wooden_storage_box;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else if (placementInfo.iconAssetName === 'wooden_storage_box.png') {
        // Use centralized visual config for wooden storage box (bottom-anchored)
        const config = ENTITY_VISUAL_CONFIG.wooden_storage_box;
        const preview = getPlacementPreviewPosition(snappedX, snappedY, config);
        adjustedX = preview.x;
        adjustedY = preview.y;
        drawWidth = preview.width;
        drawHeight = preview.height;
    } else {
        // Default: centered on cursor (consistent for all placeable items)
        adjustedX = snappedX - drawWidth / 2;
        adjustedY = snappedY - drawHeight / 2;
    }

    // Draw placement square beneath preview for grid-snapping items
    if (placementConfig) {
        const bounds = getPlacementSquareBounds(snappedX, snappedY, placementConfig);
        ctx.strokeStyle = isInvalidPlacement ? 'rgba(255, 0, 255, 0.5)' : 'rgba(0, 255, 255, 0.4)';
        ctx.lineWidth = 2;
        ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }

    // Draw the preview image or fallback
    if (isDoorPlacement && (doorEdge === 1 || doorEdge === 3)) {
        renderSideDoorProfile(ctx, doorEdge, placementInfo.itemName === 'Metal Door' ? 1 : 0, snappedX, snappedY);
    } else if (previewImg && previewImg.complete && previewImg.naturalHeight !== 0) {
        ctx.drawImage(previewImg, adjustedX, adjustedY, drawWidth, drawHeight);
    } else {
        // Fallback rectangle if image not loaded yet
        ctx.fillStyle = isInvalidPlacement ? "rgba(255, 0, 0, 0.4)" : "rgba(255, 255, 255, 0.3)";
        ctx.fillRect(adjustedX, adjustedY, drawWidth, drawHeight);
    }

    ctx.restore(); // Restore original context state
    return placementWarning;
} 
