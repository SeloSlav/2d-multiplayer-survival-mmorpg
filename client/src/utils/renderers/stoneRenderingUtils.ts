import { Stone } from '../../generated'; // Import generated Stone type
import stoneImage from '../../assets/doodads/stone.png'; // Direct import
import { drawDynamicGroundShadow } from './shadowUtils'; // Import new ground shadow util
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer';
import { imageManager } from './imageManager';

// Configuration constants
const TARGET_STONE_WIDTH_PX = 120; // Target width on screen
const SHAKE_DURATION_MS = 150;     // How long the shake effect lasts
const SHAKE_INTENSITY_PX = 10;    // Max pixel offset for shake

// Define the configuration for rendering stones
const stoneConfig: GroundEntityConfig<Stone> = {
    // shouldRender: (entity) => entity.health > 0, // Removed: Filtering should happen before calling renderStone

    getImageSource: (_entity) => stoneImage, // Use imported URL

    getTargetDimensions: (img, _entity) => {
        // Calculate scaling factor based on target width
        const scaleFactor = TARGET_STONE_WIDTH_PX / img.naturalWidth;
        return {
            width: TARGET_STONE_WIDTH_PX, // Set width to target
            height: img.naturalHeight * scaleFactor, // Scale height proportionally
        };
    },

    calculateDrawPosition: (entity, _drawWidth, drawHeight) => ({
        // Top-left corner for image drawing, originating from entity's base Y
        drawX: entity.posX - TARGET_STONE_WIDTH_PX / 2, 
        drawY: entity.posY - drawHeight, 
    }),

    getShadowParams: undefined, // No longer using this for stones

    drawCustomGroundShadow: (ctx, entity, entityImage, entityPosX, entityPosY, imageDrawWidth, imageDrawHeight, cycleProgress) => {
        drawDynamicGroundShadow({
            ctx,
            entityImage,
            entityCenterX: entityPosX,
            entityBaseY: entityPosY,
            imageDrawWidth,
            imageDrawHeight,
            cycleProgress,
            maxStretchFactor: 1.2, // Specific to stones
            minStretchFactor: 0.1,  // Specific to stones
            shadowBlur: 2,
            pivotYOffset: 25 // Added pivot offset for stones
        });
    },

    applyEffects: (ctx, entity, nowMs, _baseDrawX, _baseDrawY, _cycleProgress) => { // cycleProgress not needed here
        let shakeOffsetX = 0;
        let shakeOffsetY = 0;

        if (entity.lastHitTime) { 
            const lastHitTimeMs = Number(entity.lastHitTime.microsSinceUnixEpoch / 1000n);
            const elapsedSinceHit = nowMs - lastHitTimeMs;

            if (elapsedSinceHit >= 0 && elapsedSinceHit < SHAKE_DURATION_MS) {
                const shakeFactor = 1.0 - (elapsedSinceHit / SHAKE_DURATION_MS); 
                const currentShakeIntensity = SHAKE_INTENSITY_PX * shakeFactor;
                shakeOffsetX = (Math.random() - 0.5) * 2 * currentShakeIntensity;
                shakeOffsetY = (Math.random() - 0.5) * 2 * currentShakeIntensity;
            }
        }
        
        // Return the calculated offsets to be applied to the draw position
        return { offsetX: shakeOffsetX, offsetY: shakeOffsetY };
    },

    fallbackColor: 'gray', // Fallback if image fails to load
};

// Preload using imported URL
imageManager.preloadImage(stoneImage);

/**
 * Renders a single stone entity onto the canvas using the generic renderer.
 */
export function renderStone(
    ctx: CanvasRenderingContext2D, 
    stone: Stone, 
    nowMs: number, 
    cycleProgress: number,
    onlyDrawShadow?: boolean,    // New flag
    skipDrawingShadow?: boolean // New flag
) {
    renderConfiguredGroundEntity({
        ctx,
        entity: stone,
        config: stoneConfig,
        nowMs,
        entityPosX: stone.posX,
        entityPosY: stone.posY,
        cycleProgress,
        onlyDrawShadow,     // Pass flag
        skipDrawingShadow   // Pass flag
    });
} 