import { Corn } from '../../generated'; // Import generated Corn type
import cornImage from '../../assets/doodads/corn_stalk.png'; // Direct import
import { drawDynamicGroundShadow } from './shadowUtils'; // Added import
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { imageManager } from './imageManager'; // Import image manager

// Define constants for corn rendering
const TARGET_CORN_WIDTH_PX = 64; // Target width on screen (adjust as needed)

// Define the configuration for rendering corn
const cornConfig: GroundEntityConfig<Corn> = {
    getImageSource: (_entity) => cornImage, // Use imported URL

    getTargetDimensions: (img, _entity) => {
        // Calculate scaling factor based on target width
        const scaleFactor = TARGET_CORN_WIDTH_PX / img.naturalWidth;
        return {
            width: TARGET_CORN_WIDTH_PX,
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
        drawDynamicGroundShadow({
            ctx,
            entityImage,
            entityCenterX: entityPosX,
            entityBaseY: entityPosY,
            imageDrawWidth,
            imageDrawHeight,
            cycleProgress,
            maxStretchFactor: 1.0, // Corn is taller
            minStretchFactor: 0.1,
            shadowBlur: 1,
            pivotYOffset: 10      // Shadow pivot a bit higher for taller plant
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
imageManager.preloadImage(cornImage);

// Function to draw a single corn plant using the generic renderer
export function renderCorn(
    ctx: CanvasRenderingContext2D, 
    corn: Corn, 
    now_ms: number, 
    cycleProgress: number,
    onlyDrawShadow?: boolean, // Added flag
    skipDrawingShadow?: boolean // Added flag
) {
  renderConfiguredGroundEntity({
    ctx,
    entity: corn,
    config: cornConfig,
    nowMs: now_ms, // Pass now_ms
    entityPosX: corn.posX,
    entityPosY: corn.posY,
    cycleProgress,
    onlyDrawShadow,    // Pass flag
    skipDrawingShadow  // Pass flag
  });
} 