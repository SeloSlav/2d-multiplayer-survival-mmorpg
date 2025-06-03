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
    shelterImageRef?: React.RefObject<HTMLImageElement | null>;
    worldMouseX: number | null;
    worldMouseY: number | null;
    isPlacementTooFar: boolean;
    placementError: string | null;
}

/**
 * Visual offset constants to match server-side rendering offsets
 * These ensure the placement preview appears exactly where the item will be rendered
 */
const VISUAL_OFFSETS = {
    // From campfire.rs - VISUAL_CENTER_Y_OFFSET: f32 = 42.0
    // The visual campfire appears 42 pixels above its stored position
    CAMPFIRE_Y_OFFSET: -42,
    
    // Sleeping bags are typically rendered close to their base position
    SLEEPING_BAG_Y_OFFSET: -5,
    
    // Stashes are small and typically render close to their base position  
    STASH_Y_OFFSET: -8,
    
    // Wooden storage boxes similar to campfires
    WOODEN_BOX_Y_OFFSET: -20,
    
    // Shelters are large structures, typically anchored at bottom
    SHELTER_Y_OFFSET: -32,
};

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

    // Determine width/height and visual offset based on placement item
    let drawWidth = CAMPFIRE_WIDTH_PREVIEW; // Default to campfire
    let drawHeight = CAMPFIRE_HEIGHT_PREVIEW;
    let visualYOffset = VISUAL_OFFSETS.CAMPFIRE_Y_OFFSET; // Default to campfire offset

    if (placementInfo.iconAssetName === 'wooden_storage_box.png') {
        // Assuming box preview uses same dimensions as campfire for now
        // TODO: If wooden_storage_box has its own preview dimensions, import them
        drawWidth = CAMPFIRE_WIDTH_PREVIEW; 
        drawHeight = CAMPFIRE_HEIGHT_PREVIEW;
        visualYOffset = VISUAL_OFFSETS.WOODEN_BOX_Y_OFFSET;
    } else if (placementInfo.iconAssetName === 'sleeping_bag.png') {
        drawWidth = SLEEPING_BAG_WIDTH; 
        drawHeight = SLEEPING_BAG_HEIGHT;
        visualYOffset = VISUAL_OFFSETS.SLEEPING_BAG_Y_OFFSET;
    } else if (placementInfo.iconAssetName === 'stash.png') {
        drawWidth = STASH_WIDTH;
        drawHeight = STASH_HEIGHT;
        visualYOffset = VISUAL_OFFSETS.STASH_Y_OFFSET;
    } else if (placementInfo.iconAssetName === 'shelter.png') {
        drawWidth = SHELTER_RENDER_WIDTH; 
        drawHeight = SHELTER_RENDER_HEIGHT;
        visualYOffset = VISUAL_OFFSETS.SHELTER_Y_OFFSET;
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

    // Calculate the adjusted position accounting for visual offset
    const adjustedX = worldMouseX - drawWidth / 2;
    const adjustedY = worldMouseY - drawHeight / 2 + visualYOffset;

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
        const messageColor = isPlacementTooFar ? 'orange' : 'red'; // Orange for distance, red for other errors
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