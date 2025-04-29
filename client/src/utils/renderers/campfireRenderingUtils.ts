import { Campfire } from '../../generated'; // Import generated Campfire type
import campfireImage from '../../assets/doodads/campfire.png'; // Direct import ON
import campfireOffImage from '../../assets/doodads/campfire_off.png'; // Direct import OFF
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { imageManager } from './imageManager'; // Import image manager

// --- Constants ---
export const CAMPFIRE_WIDTH = 64;
export const CAMPFIRE_HEIGHT = 64;

// --- Define Configuration --- 
const campfireConfig: GroundEntityConfig<Campfire> = {
    // Return imported URL based on state
    getImageSource: (entity) => entity.isBurning ? campfireImage : campfireOffImage,

    getTargetDimensions: (_img, _entity) => ({
        width: CAMPFIRE_WIDTH,
        height: CAMPFIRE_HEIGHT,
    }),

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        // Top-left corner for image drawing, originating from entity's base Y
        drawX: entity.posX - drawWidth / 2, 
        drawY: entity.posY - drawHeight, 
    }),

    getShadowParams: (entity, drawWidth, drawHeight) => {
        const shadowRadiusX = drawWidth * 0.4;
        const shadowRadiusY = shadowRadiusX * 0.5;
        const shadowOffsetY = -drawHeight * 0.25; // Push shadow up slightly
        return {
            offsetX: 0, // Centered horizontally on entity.posX
            offsetY: shadowOffsetY, // Offset vertically from entity.posY
            radiusX: shadowRadiusX,
            radiusY: shadowRadiusY,
        };
    },

    applyEffects: undefined, // No specific effects currently

    fallbackColor: '#663300', // Dark brown fallback
};

// Preload both imported URLs
imageManager.preloadImage(campfireImage);
imageManager.preloadImage(campfireOffImage);

// --- Rendering Function (Refactored) ---
export function renderCampfire(ctx: CanvasRenderingContext2D, campfire: Campfire, nowMs: number) { 
    renderConfiguredGroundEntity({
        ctx,
        entity: campfire,
        config: campfireConfig,
        nowMs, // Pass timestamp (might be needed for future effects)
        entityPosX: campfire.posX,
        entityPosY: campfire.posY,
    });
} 