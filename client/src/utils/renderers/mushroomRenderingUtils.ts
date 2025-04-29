// client/src/utils/mushroomRenderingUtils.ts
import { Mushroom } from '../../generated'; // Import generated Mushroom type
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

    getShadowParams: (entity, drawWidth, drawHeight) => {
        const shadowRadiusX = drawWidth * 0.3;
        const shadowRadiusY = shadowRadiusX * 0.4;
        const shadowOffsetY = -drawHeight * 0.3; // Push shadow up slightly
        return {
            offsetX: 0, // Centered horizontally on entity.posX
            offsetY: shadowOffsetY, // Offset vertically from entity.posY
            radiusX: shadowRadiusX,
            radiusY: shadowRadiusY,
        };
    },

    applyEffects: undefined, // No specific effects for mushrooms currently

    fallbackColor: 'red', // Fallback if image fails to load
};

// Preload using imported URL
imageManager.preloadImage(mushroomImage);

// Function to draw a single mushroom using the generic renderer
export function renderMushroom(ctx: CanvasRenderingContext2D, mushroom: Mushroom, now_ms: number) {
  renderConfiguredGroundEntity({
    ctx,
    entity: mushroom,
    config: mushroomConfig,
    nowMs: now_ms, // Pass now_ms
    entityPosX: mushroom.posX,
    entityPosY: mushroom.posY,
  });
} 