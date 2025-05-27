import { PlacementItemInfo } from '../../hooks/usePlacementManager';
// Import dimensions directly from their respective rendering utility files
import { CAMPFIRE_WIDTH_PREVIEW, CAMPFIRE_HEIGHT_PREVIEW } from './campfireRenderingUtils';
import { SLEEPING_BAG_WIDTH, SLEEPING_BAG_HEIGHT } from './sleepingBagRenderingUtils';
import { STASH_WIDTH, STASH_HEIGHT } from './stashRenderingUtils';
import { SHELTER_RENDER_WIDTH, SHELTER_RENDER_HEIGHT } from './shelterRenderingUtils';

interface RenderPlacementPreviewParams {
    ctx: CanvasRenderingContext2D;
    placementInfo: PlacementItemInfo | null;
    itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
    worldMouseX: number | null;
    worldMouseY: number | null;
    isPlacementTooFar: boolean;
    placementError: string | null;
}

/**
 * Renders the placement preview item/structure following the mouse.
 */
export function renderPlacementPreview({
    ctx,
    placementInfo,
    itemImagesRef,
    worldMouseX,
    worldMouseY,
    isPlacementTooFar,
    placementError,
}: RenderPlacementPreviewParams): void {
    if (!placementInfo || worldMouseX === null || worldMouseY === null) {
        return; // Nothing to render
    }

    const previewImg = itemImagesRef.current?.get(placementInfo.iconAssetName);

    // Determine width/height based on placement item
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

    // Apply visual effect if too far or invalid placement
    if (isPlacementTooFar) {
        ctx.filter = 'grayscale(80%) brightness(1.2) contrast(0.8) opacity(50%)';
        finalPlacementMessage = "Too far away"; // Override specific message
    } else if (placementError) { // If not too far, but hook reported another error
        ctx.filter = 'sepia(60%) brightness(0.9) opacity(60%)'; // Different filter for invalid
    } else {
        // Valid placement position
        ctx.globalAlpha = 0.7; // Standard transparency
    }

    // Draw the preview image or fallback
    if (previewImg && previewImg.complete && previewImg.naturalHeight !== 0) {
        ctx.drawImage(previewImg, worldMouseX - drawWidth / 2, worldMouseY - drawHeight / 2, drawWidth, drawHeight);
    } else {
        // Fallback rectangle if image not loaded yet
        // Ensure alpha/filter is applied to fallback too
        ctx.fillStyle = ctx.filter !== 'none' ? "rgba(255, 0, 0, 0.4)" : "rgba(255, 255, 255, 0.3)"; // Reddish tint if filtered
        ctx.fillRect(worldMouseX - drawWidth / 2, worldMouseY - drawHeight / 2, drawWidth, drawHeight);
    }

    // Draw the placement message (if any)
    if (finalPlacementMessage) {
        const messageColor = isPlacementTooFar ? 'orange' : 'red'; // Orange for distance, red for other errors
        // Reset temporary effects before drawing text
        ctx.filter = 'none'; 
        ctx.globalAlpha = 1.0;

        ctx.fillStyle = messageColor;
        ctx.font = '12px "Press Start 2P", cursive';
        ctx.textAlign = 'center';
        ctx.fillText(finalPlacementMessage, worldMouseX, worldMouseY - drawHeight / 2 - 5); // Position above preview
    }

    ctx.restore(); // Restore original context state
} 