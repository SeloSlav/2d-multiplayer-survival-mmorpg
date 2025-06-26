/******************************************************************************
 *                                                                            *
 * Water Patch Rendering Utils - Renders water patches on the ground that    *
 * boost plant growth. Shows as transparent black patches that fade over     *
 * time as the water evaporates.                                             *
 *                                                                            *
 ******************************************************************************/

import { WaterPatch } from '../../generated';

// --- Constants ---

export const WATER_PATCH_VISUAL_RADIUS = 35; // Visual radius in pixels (increased for better visibility)
export const WATER_PATCH_MAX_OPACITY = 0.8; // Maximum opacity (80% transparency - much more visible)
export const WATER_PATCH_MIN_OPACITY = 0.2; // Minimum opacity before it becomes invisible

// --- Water Patch Rendering ---

/**
 * Renders a single water patch as simple black transparent soaked ground
 */
export function renderWaterPatch(
    ctx: CanvasRenderingContext2D,
    waterPatch: WaterPatch,
    cameraX: number,
    cameraY: number
): void {
    // Since the context is already translated by cameraOffset, we render directly in world coordinates
    const screenX = waterPatch.posX;
    const screenY = waterPatch.posY;

    // Calculate opacity based on the patch's current opacity (which fades over time)
    // Use higher transparency for realistic soaked ground effect
    const opacity = Math.max(waterPatch.currentOpacity * 0.4, 0.1); // Max 40% opacity

    // Save the current context state
    ctx.save();

    // Simple black circle with gradient for smooth edges
    const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, WATER_PATCH_VISUAL_RADIUS);
    gradient.addColorStop(0, `rgba(0, 0, 0, ${opacity})`); // Black center
    gradient.addColorStop(0.7, `rgba(0, 0, 0, ${opacity * 0.8})`); // Slightly lighter edge
    gradient.addColorStop(1, `rgba(0, 0, 0, 0)`); // Fade to transparent

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(screenX, screenY, WATER_PATCH_VISUAL_RADIUS, 0, 2 * Math.PI);
    ctx.fill();

    // Restore the context state
    ctx.restore();
}

/**
 * Renders all water patches in the current view
 */
export function renderWaterPatches(
    ctx: CanvasRenderingContext2D,
    waterPatches: Map<string, WaterPatch>,
    cameraX: number,
    cameraY: number,
    viewWidth: number,
    viewHeight: number
): void {
    // Debug logging to check if water patches exist
    if (waterPatches.size > 0) {
        console.log(`[WaterPatch] Rendering ${waterPatches.size} water patches`);
        const firstPatch = Array.from(waterPatches.values())[0];
        console.log(`[WaterPatch] First patch: pos(${firstPatch.posX}, ${firstPatch.posY}), opacity: ${firstPatch.currentOpacity}`);
    }

    // Calculate view bounds with some padding for smooth transitions
    const padding = WATER_PATCH_VISUAL_RADIUS * 2;
    const minX = cameraX - padding;
    const maxX = cameraX + viewWidth + padding;
    const minY = cameraY - padding;
    const maxY = cameraY + viewHeight + padding;

    let renderedCount = 0;
    // Render only water patches within the view
    for (const waterPatch of waterPatches.values()) {
        // Skip patches that are outside the view
        if (waterPatch.posX < minX || waterPatch.posX > maxX || 
            waterPatch.posY < minY || waterPatch.posY > maxY) {
            continue;
        }

        // Skip patches that are too faded to be visible
        if (waterPatch.currentOpacity < 0.05) {
            continue;
        }

        renderWaterPatch(ctx, waterPatch, cameraX, cameraY);
        renderedCount++;
    }
    
    if (renderedCount > 0) {
        console.log(`[WaterPatch] Actually rendered ${renderedCount} patches`);
    }
}

/**
 * Check if a water patch is visible on screen
 */
export function isWaterPatchVisible(
    waterPatch: WaterPatch,
    cameraX: number,
    cameraY: number,
    viewWidth: number,
    viewHeight: number
): boolean {
    const padding = WATER_PATCH_VISUAL_RADIUS;
    return waterPatch.posX >= cameraX - padding &&
           waterPatch.posX <= cameraX + viewWidth + padding &&
           waterPatch.posY >= cameraY - padding &&
           waterPatch.posY <= cameraY + viewHeight + padding &&
           waterPatch.currentOpacity > 0.05;
}

/**
 * Get water patches sorted by distance from camera center (for depth sorting if needed)
 */
export function getWaterPatchesSortedByDistance(
    waterPatches: Map<string, WaterPatch>,
    cameraX: number,
    cameraY: number,
    viewWidth: number,
    viewHeight: number
): WaterPatch[] {
    const centerX = cameraX + viewWidth / 2;
    const centerY = cameraY + viewHeight / 2;

    return Array.from(waterPatches.values())
        .filter(patch => isWaterPatchVisible(patch, cameraX, cameraY, viewWidth, viewHeight))
        .sort((a, b) => {
            const distA = Math.sqrt((a.posX - centerX) ** 2 + (a.posY - centerY) ** 2);
            const distB = Math.sqrt((b.posX - centerX) ** 2 + (b.posY - centerY) ** 2);
            return distA - distB;
        });
} 