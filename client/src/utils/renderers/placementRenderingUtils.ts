import { PlacementItemInfo } from '../../hooks/usePlacementManager';
// Import dimensions directly from their respective rendering utility files
import { CAMPFIRE_WIDTH_PREVIEW, CAMPFIRE_HEIGHT_PREVIEW } from './campfireRenderingUtils';
import { SLEEPING_BAG_WIDTH, SLEEPING_BAG_HEIGHT } from './sleepingBagRenderingUtils';
import { STASH_WIDTH, STASH_HEIGHT } from './stashRenderingUtils';
import { SHELTER_RENDER_WIDTH, SHELTER_RENDER_HEIGHT } from './shelterRenderingUtils';
import { TILE_SIZE } from '../../config/gameConfig';
import { DbConnection } from '../../generated';

// Import interaction distance constants
const PLAYER_BOX_INTERACTION_DISTANCE_SQUARED = 80.0 * 80.0; // From useInteractionFinder.ts
const SHELTER_PLACEMENT_MAX_DISTANCE = 256.0;

interface RenderPlacementPreviewParams {
    ctx: CanvasRenderingContext2D;
    placementInfo: PlacementItemInfo | null;
    itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
    shelterImageRef?: React.RefObject<HTMLImageElement | null>;
    worldMouseX: number | null;
    worldMouseY: number | null;
    isPlacementTooFar: boolean;
    placementError: string | null;
    connection: DbConnection | null; // Add connection parameter
}

/**
 * Converts world pixel coordinates to tile coordinates
 */
function worldPosToTileCoords(worldX: number, worldY: number): { tileX: number; tileY: number } {
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    return { tileX, tileY };
}

/**
 * Checks if a world position is on a water tile (Sea type).
 * Returns true if the position is on water and placement should be blocked.
 */
function isPositionOnWater(connection: DbConnection | null, worldX: number, worldY: number): boolean {
    if (!connection) {
        return false; // If no connection, allow placement (fallback)
    }

    const { tileX, tileY } = worldPosToTileCoords(worldX, worldY);
    
    // Check all world tiles to find the one at this position
    for (const tile of connection.db.worldTile.iter()) {
        if (tile.worldX === tileX && tile.worldY === tileY) {
            // Found the tile at this position, check if it's water
            return tile.tileType.tag === 'Sea';
        }
    }
    
    // No tile found at this position, assume it's safe to place (fallback)
    return false;
}

/**
 * Checks if placement should be blocked due to water tiles.
 * This applies to shelters, camp fires, stashes, wooden storage boxes, and sleeping bags.
 */
function isWaterPlacementBlocked(connection: DbConnection | null, placementInfo: PlacementItemInfo | null, worldX: number, worldY: number): boolean {
    if (!connection || !placementInfo) {
        return false;
    }

    // List of items that cannot be placed on water
    const waterBlockedItems = ['Camp Fire', 'Wooden Storage Box', 'Sleeping Bag', 'Stash', 'Shelter'];
    
    if (waterBlockedItems.includes(placementInfo.itemName)) {
        return isPositionOnWater(connection, worldX, worldY);
    }
    
    return false;
}

/**
 * Checks if placement is too far from the player.
 * Returns true if the placement position is beyond the allowed range.
 */
export function isPlacementTooFar(
    placementInfo: PlacementItemInfo | null, 
    playerX: number, 
    playerY: number, 
    worldX: number, 
    worldY: number
): boolean {
    if (!placementInfo) {
        return false;
    }

    const placeDistSq = (worldX - playerX) ** 2 + (worldY - playerY) ** 2;

    // Use appropriate placement range based on item type
    let clientPlacementRangeSq: number;
    if (placementInfo.iconAssetName === 'shelter.png') {
        // Shelter has a much larger placement range (256px vs 64px for other items)
        clientPlacementRangeSq = SHELTER_PLACEMENT_MAX_DISTANCE * SHELTER_PLACEMENT_MAX_DISTANCE;
    } else {
        // Use standard interaction distance for other items (campfires, boxes, etc.)
        clientPlacementRangeSq = PLAYER_BOX_INTERACTION_DISTANCE_SQUARED * 1.1;
    }

    return placeDistSq > clientPlacementRangeSq;
}

/**
 * All placement previews should be perfectly centered on the cursor.
 * Server-side positioning has been adjusted to compensate for renderer anchoring,
 * so placement previews no longer need visual offsets.
 */

/**
 * Renders the placement preview item/structure following the mouse.
 */
export function renderPlacementPreview({
    ctx,
    placementInfo,
    itemImagesRef,
    shelterImageRef,
    worldMouseX,
    worldMouseY,
    isPlacementTooFar,
    placementError,
    connection,
}: RenderPlacementPreviewParams): void {
    if (!placementInfo || worldMouseX === null || worldMouseY === null) {
        return; // Nothing to render
    }

    // For shelters, use the shelter image from doodads folder, otherwise use items folder
    let previewImg: HTMLImageElement | undefined;
    if (placementInfo.iconAssetName === 'shelter.png' && shelterImageRef?.current) {
        previewImg = shelterImageRef.current;
    } else {
        previewImg = itemImagesRef.current?.get(placementInfo.iconAssetName);
    }

    // Determine width/height based on placement item (all previews centered on cursor)
    let drawWidth = CAMPFIRE_WIDTH_PREVIEW; // Default to campfire
    let drawHeight = CAMPFIRE_HEIGHT_PREVIEW;

    if (placementInfo.iconAssetName === 'wooden_storage_box.png') {
        // Assuming box preview uses same dimensions as campfire for now
        // TODO: If wooden_storage_box has its own preview dimensions, import them
        drawWidth = CAMPFIRE_WIDTH_PREVIEW; 
        drawHeight = CAMPFIRE_HEIGHT_PREVIEW;
    } else if (placementInfo.iconAssetName === 'sleeping_bag.png') {
        drawWidth = SLEEPING_BAG_WIDTH; 
        drawHeight = SLEEPING_BAG_HEIGHT;
    } else if (placementInfo.iconAssetName === 'stash.png') {
        drawWidth = STASH_WIDTH;
        drawHeight = STASH_HEIGHT;
    } else if (placementInfo.iconAssetName === 'shelter.png') {
        drawWidth = SHELTER_RENDER_WIDTH; 
        drawHeight = SHELTER_RENDER_HEIGHT;
    }

    ctx.save();

    let finalPlacementMessage = placementError; // Start with error from hook

    // Check for water placement restriction
    const isOnWater = isWaterPlacementBlocked(connection, placementInfo, worldMouseX, worldMouseY);
    
    // Apply visual effect if too far, on water, or invalid placement
    if (isPlacementTooFar) {
        ctx.filter = 'grayscale(80%) brightness(1.2) contrast(0.8) opacity(50%)';
        finalPlacementMessage = "Too far away"; // Override specific message
    } else if (isOnWater) {
        ctx.filter = 'sepia(60%) hue-rotate(200deg) brightness(0.7) opacity(60%)'; // Blue-tinted filter for water
        finalPlacementMessage = "Cannot place on water"; // Override with water message
    } else if (placementError) { // If not too far and not on water, but hook reported another error
        ctx.filter = 'sepia(60%) brightness(0.9) opacity(60%)'; // Different filter for invalid
    } else {
        // Valid placement position
        ctx.globalAlpha = 0.7; // Standard transparency
    }

    // Calculate the centered position (perfectly centered on cursor)
    const adjustedX = worldMouseX - drawWidth / 2;
    const adjustedY = worldMouseY - drawHeight / 2;

    // Draw the preview image or fallback
    if (previewImg && previewImg.complete && previewImg.naturalHeight !== 0) {
        ctx.drawImage(previewImg, adjustedX, adjustedY, drawWidth, drawHeight);
    } else {
        // Fallback rectangle if image not loaded yet
        // Ensure alpha/filter is applied to fallback too
        ctx.fillStyle = ctx.filter !== 'none' ? "rgba(255, 0, 0, 0.4)" : "rgba(255, 255, 255, 0.3)"; // Reddish tint if filtered
        ctx.fillRect(adjustedX, adjustedY, drawWidth, drawHeight);
    }

    // Draw the placement message (if any)
    if (finalPlacementMessage) {
        let messageColor = 'red'; // Default to red for errors
        if (isPlacementTooFar) {
            messageColor = 'orange'; // Orange for distance
        } else if (isOnWater) {
            messageColor = '#4A90E2'; // Blue for water restriction
        }
        
        // Reset temporary effects before drawing text
        ctx.filter = 'none'; 
        ctx.globalAlpha = 1.0;

        ctx.fillStyle = messageColor;
        ctx.font = '12px "Press Start 2P", cursive';
        ctx.textAlign = 'center';
        // Position text above the adjusted preview position
        ctx.fillText(finalPlacementMessage, worldMouseX, adjustedY - 5);
    }

    ctx.restore(); // Restore original context state
} 