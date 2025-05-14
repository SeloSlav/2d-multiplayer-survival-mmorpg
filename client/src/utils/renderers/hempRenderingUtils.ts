import { Hemp } from '../../generated'; // Import generated Hemp type
import hempImage from '../../assets/doodads/hemp.png'; // Direct import
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

    getShadowParams: (entity, drawWidth, drawHeight) => {
        const shadowRadiusX = drawWidth * 0.3;
        const shadowRadiusY = shadowRadiusX * 0.4;
        const shadowOffsetY = -drawHeight * 0.1; // Adjust shadow position as needed
        return {
            offsetX: 0, // Centered horizontally on entity.posX
            offsetY: shadowOffsetY, // Offset vertically from entity.posY
            radiusX: shadowRadiusX,
            radiusY: shadowRadiusY,
        };
    },

    applyEffects: undefined, // No specific effects for hemp currently

    fallbackColor: 'seagreen', // Fallback if image fails to load
};

// Preload using imported URL
imageManager.preloadImage(hempImage);

// Function to draw a single hemp plant using the generic renderer
export function renderHemp(ctx: CanvasRenderingContext2D, hemp: Hemp, now_ms: number) {
  renderConfiguredGroundEntity({
    ctx,
    entity: hemp,
    config: hempConfig,
    nowMs: now_ms, 
    entityPosX: hemp.posX,
    entityPosY: hemp.posY,
  });
} 