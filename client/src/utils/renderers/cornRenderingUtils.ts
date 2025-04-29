import { Corn } from '../../generated'; // Import generated Corn type
import cornImage from '../../assets/doodads/corn_stalk.png'; // Direct import
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

    getShadowParams: (entity, drawWidth, drawHeight) => {
        const shadowRadiusX = drawWidth * 0.3;
        const shadowRadiusY = shadowRadiusX * 0.4;
        const shadowOffsetY = -drawHeight * 0.05; // Push shadow up slightly
        return {
            offsetX: 0, // Centered horizontally on entity.posX
            offsetY: shadowOffsetY, // Offset vertically from entity.posY
            radiusX: shadowRadiusX,
            radiusY: shadowRadiusY,
        };
    },

    applyEffects: undefined, // No specific effects for corn currently

    fallbackColor: 'yellowgreen', // Fallback if image fails to load
};

// Preload using imported URL
imageManager.preloadImage(cornImage);

// Function to draw a single corn plant using the generic renderer
export function renderCorn(ctx: CanvasRenderingContext2D, corn: Corn, now_ms: number) {
  renderConfiguredGroundEntity({
    ctx,
    entity: corn,
    config: cornConfig,
    nowMs: now_ms, // Pass now_ms
    entityPosX: corn.posX,
    entityPosY: corn.posY,
  });
} 