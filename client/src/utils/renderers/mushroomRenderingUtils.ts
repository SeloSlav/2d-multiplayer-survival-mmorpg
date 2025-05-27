// client/src/utils/mushroomRenderingUtils.ts
import { Mushroom } from '../../generated'; // Import generated Mushroom type
import { drawDynamicGroundShadow } from './shadowUtils'; // Added back
// import { applyStandardDropShadow } from './shadowUtils'; // Removed
import mushroomImage from '../../assets/doodads/mushroom.png'; // Direct import
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { imageManager } from './imageManager'; // Import image manager

// Define constants for mushroom rendering
const TARGET_MUSHROOM_WIDTH_PX = 64; // Target width on screen

// Define the configuration for rendering mushrooms
const mushroomConfig: GroundEntityConfig<Mushroom> = {
    getImageSource: (_entity) => mushroomImage, // Use imported URL

    getTargetDimensions: (img, _entity) => {
        // Calculate scaling factor based on target width
        const scaleFactor = TARGET_MUSHROOM_WIDTH_PX / img.naturalWidth;
        return {
            width: TARGET_MUSHROOM_WIDTH_PX,
            height: img.naturalHeight * scaleFactor,
        };
    },

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        // Top-left corner for image drawing, originating from entity's base Y
        drawX: entity.posX - drawWidth / 2, 
        drawY: entity.posY - drawHeight, 
    }),

    getShadowParams: undefined, // Remove old shadow

    drawCustomGroundShadow: (ctx, entity, entityImage, entityPosX, entityPosY, imageDrawWidth, imageDrawHeight, cycleProgress) => {
        // Re-added dynamic shadow for mushrooms
        drawDynamicGroundShadow({
            ctx,
            entityImage,
            entityCenterX: entityPosX,
            entityBaseY: entityPosY,
            imageDrawWidth,
            imageDrawHeight,
            cycleProgress,
            maxStretchFactor: 1.0, 
            minStretchFactor: 0.1,
            shadowBlur: 3,
            pivotYOffset: 10 // Using the value from user's previous edit
        });
    },

    applyEffects: (ctx, entity, nowMs, baseDrawX, baseDrawY, cycleProgress) => {
        // applyStandardDropShadow(ctx, { cycleProgress, blur: 2, offsetY: 1 }); // Removed standard shadow
        return {
            offsetX: 0,
            offsetY: 0,
        };
    },

    fallbackColor: 'red', // Fallback if image fails to load
};

// Preload using imported URL
imageManager.preloadImage(mushroomImage);

// Function to draw a single mushroom using the generic renderer
export function renderMushroom(
    ctx: CanvasRenderingContext2D, 
    mushroom: Mushroom, 
    now_ms: number, 
    cycleProgress: number,
    onlyDrawShadow?: boolean, // Added back
    skipDrawingShadow?: boolean // Added back
) {
  renderConfiguredGroundEntity({
    ctx,
    entity: mushroom,
    config: mushroomConfig,
    nowMs: now_ms, // Pass now_ms
    entityPosX: mushroom.posX,
    entityPosY: mushroom.posY,
    cycleProgress,
    onlyDrawShadow, 
    skipDrawingShadow  
  });
} 