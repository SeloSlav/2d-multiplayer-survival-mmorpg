import { WoodenStorageBox } from '../../generated'; // Import generated type
import boxImage from '../../assets/doodads/wooden_storage_box.png'; // Direct import
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { imageManager } from './imageManager'; // Import image manager

// --- Constants --- (Keep exportable if used elsewhere)
export const BOX_WIDTH = 64; 
export const BOX_HEIGHT = 64;

// --- Image Preloading (Remove old logic) ---
// REMOVE: let boxImage: HTMLImageElement | null = null;
// REMOVE: let isBoxImageLoaded = false;
// REMOVE: export function preloadWoodenStorageBoxImage() { ... };

// --- Define Configuration --- 
const boxConfig: GroundEntityConfig<WoodenStorageBox> = {
    getImageSource: (_entity) => boxImage, // Use imported URL

    getTargetDimensions: (_img, _entity) => ({
        width: BOX_WIDTH,
        height: BOX_HEIGHT,
    }),

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        // Center the image on the entity's position
        drawX: entity.posX - drawWidth / 2,
        drawY: entity.posY - drawHeight / 2, // Center vertically as well
    }),

    getShadowParams: (entity, drawWidth, drawHeight) => {
        const shadowRadiusX = drawWidth * 0.45;
        const shadowRadiusY = shadowRadiusX * 0.45;
        const shadowOffsetY = drawHeight * 0.25; // Place shadow below the centered box
        return {
            offsetX: 0, // Centered horizontally
            offsetY: shadowOffsetY, 
            radiusX: shadowRadiusX,
            radiusY: shadowRadiusY,
        };
    },

    applyEffects: undefined, // No specific effects

    fallbackColor: '#8B4513', // SaddleBrown
};

// Preload using imported URL
imageManager.preloadImage(boxImage);

// --- Rendering Function (Refactored) ---
export function renderWoodenStorageBox(ctx: CanvasRenderingContext2D, box: WoodenStorageBox, nowMs: number) {
    renderConfiguredGroundEntity({
        ctx,
        entity: box,
        config: boxConfig,
        nowMs, // Pass timestamp
        entityPosX: box.posX,
        entityPosY: box.posY,
    });
} 