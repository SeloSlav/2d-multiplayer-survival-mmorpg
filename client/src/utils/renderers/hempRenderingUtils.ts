import { Hemp } from '../../generated'; // Import generated Hemp type
import hempImage from '../../assets/doodads/hemp.png'; // Direct import
import { applyStandardDropShadow } from './shadowUtils'; // Import new shadow util
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { imageManager } from './imageManager'; // Import image manager

// Define constants for hemp rendering
const TARGET_HEMP_WIDTH_PX = 64; // Target width on screen (adjust as needed)

// Define the configuration for rendering hemp
const hempConfig: GroundEntityConfig<Hemp> = {
    getImageSource: (_entity) => hempImage, // Use imported URL

    getTargetDimensions: (img, _entity) => {
        // Calculate scaling factor based on target width
        const scaleFactor = TARGET_HEMP_WIDTH_PX / img.naturalWidth;
        return {
            width: TARGET_HEMP_WIDTH_PX,
            height: img.naturalHeight * scaleFactor,
        };
    },

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        // Top-left corner for image drawing, originating from entity's base Y
        drawX: entity.posX - drawWidth / 2, 
        drawY: entity.posY - drawHeight, 
    }),

    getShadowParams: undefined, // Remove old shadow

    applyEffects: (ctx, entity, nowMs, baseDrawX, baseDrawY, cycleProgress) => {
        applyStandardDropShadow(ctx, { cycleProgress });
        return {
            offsetX: 0,
            offsetY: 0,
        };
    },

    fallbackColor: 'seagreen', // Fallback if image fails to load
};

// Preload using imported URL
imageManager.preloadImage(hempImage);

// Function to draw a single hemp plant using the generic renderer
export function renderHemp(ctx: CanvasRenderingContext2D, hemp: Hemp, now_ms: number, cycleProgress: number) {
  renderConfiguredGroundEntity({
    ctx,
    entity: hemp,
    config: hempConfig,
    nowMs: now_ms, 
    entityPosX: hemp.posX,
    entityPosY: hemp.posY,
    cycleProgress,
  });
} 