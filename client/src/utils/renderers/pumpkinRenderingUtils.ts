import { Pumpkin } from '../../generated'; // Import generated Pumpkin type
import pumpkinImage from '../../assets/doodads/pumpkin.png'; // Direct import
import { drawDynamicGroundShadow } from './shadowUtils'; // Added import
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { imageManager } from './imageManager'; // Import image manager

// Define constants for pumpkin rendering
const TARGET_PUMPKIN_WIDTH_PX = 64; // Target width on screen (adjust as needed)

// Define the configuration for rendering pumpkin
const pumpkinConfig: GroundEntityConfig<Pumpkin> = {
    getImageSource: (_entity) => pumpkinImage, // Use imported URL

    getTargetDimensions: (img, _entity) => {
        // Calculate scaling factor based on target width
        const scaleFactor = TARGET_PUMPKIN_WIDTH_PX / img.naturalWidth;
        return {
            width: TARGET_PUMPKIN_WIDTH_PX,
            height: img.naturalHeight * scaleFactor,
        };
    },

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        // Top-left pumpkiner for image drawing, originating from entity's base Y
        drawX: entity.posX - drawWidth / 2, 
        drawY: entity.posY - drawHeight, 
    }),

    getShadowParams: undefined, // Remove old shadow

    drawCustomGroundShadow: (ctx, entity, entityImage, entityPosX, entityPosY, imageDrawWidth, imageDrawHeight, cycleProgress) => {
        drawDynamicGroundShadow({
            ctx,
            entityImage,
            entityCenterX: entityPosX,
            entityBaseY: entityPosY,
            imageDrawWidth,
            imageDrawHeight,
            cycleProgress,
            maxStretchFactor: 1.0, // Pumpkins are low and wide
            minStretchFactor: 0.1, // Wider at noon
            shadowBlur: 3,
            pivotYOffset: 10       // Close to ground
        });
    },

    applyEffects: (ctx, entity, nowMs, baseDrawX, baseDrawY, cycleProgress) => {
        return {
            offsetX: 0,
            offsetY: 0,
        };
    },

    fallbackColor: 'yellowgreen', // Fallback if image fails to load
};

// Preload using imported URL
imageManager.preloadImage(pumpkinImage);

// Function to draw a single pumpkin plant using the generic renderer
export function renderPumpkin(
    ctx: CanvasRenderingContext2D, 
    pumpkin: Pumpkin, 
    now_ms: number, 
    cycleProgress: number,
    onlyDrawShadow?: boolean, // Added flag
    skipDrawingShadow?: boolean // Added flag
) {
  renderConfiguredGroundEntity({
    ctx,
    entity: pumpkin,
    config: pumpkinConfig,
    nowMs: now_ms, // Pass now_ms
    entityPosX: pumpkin.posX,
    entityPosY: pumpkin.posY,
    cycleProgress,
    onlyDrawShadow,    // Pass flag
    skipDrawingShadow  // Pass flag
  });
} 