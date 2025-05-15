import { WoodenStorageBox } from '../../generated'; // Import generated type
import boxImage from '../../assets/doodads/wooden_storage_box.png'; // Direct import
import { applyStandardDropShadow } from './shadowUtils'; // Import new shadow util
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { imageManager } from './imageManager'; // Import image manager

// --- Constants --- (Keep exportable if used elsewhere)
export const BOX_WIDTH = 64; 
export const BOX_HEIGHT = 64;
const SHAKE_DURATION_MS = 150; 
const SHAKE_INTENSITY_PX = 10; // Make boxes shake a bit more
const HEALTH_BAR_WIDTH = 50;
const HEALTH_BAR_HEIGHT = 6;
const HEALTH_BAR_Y_OFFSET = 8; // Adjust offset for box image centering
const SHARD_COUNT = 7; // More shards for a bigger box
const SHARD_SIZE = 18;
const SHARD_SPREAD_RADIUS = 50;

// --- Define Configuration --- 
const boxConfig: GroundEntityConfig<WoodenStorageBox> = {
    getImageSource: (entity) => {
        if (entity.isDestroyed) {
            return null; // Don't render if destroyed (handled by drawOverlay)
        }
        return boxImage;
    },

    getTargetDimensions: (img, _entity) => ({
        width: BOX_WIDTH,
        height: BOX_HEIGHT,
    }),

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        drawX: entity.posX - drawWidth / 2,
        drawY: entity.posY - drawHeight / 2 - 10, // Slight Y adjustment for centering
    }),

    getShadowParams: undefined,

    applyEffects: (ctx, entity, nowMs, baseDrawX, baseDrawY, cycleProgress) => {
        applyStandardDropShadow(ctx, { cycleProgress });

        let shakeOffsetX = 0;
        let shakeOffsetY = 0;

        if (entity.lastHitTime && !entity.isDestroyed) {
            const lastHitTimeMs = Number(entity.lastHitTime.microsSinceUnixEpoch / 1000n);
            const elapsedSinceHit = nowMs - lastHitTimeMs;

            if (elapsedSinceHit >= 0 && elapsedSinceHit < SHAKE_DURATION_MS) {
                const shakeFactor = 1.0 - (elapsedSinceHit / SHAKE_DURATION_MS);
                const currentShakeIntensity = SHAKE_INTENSITY_PX * shakeFactor;
                shakeOffsetX = (Math.random() - 0.5) * 2 * currentShakeIntensity;
                shakeOffsetY = (Math.random() - 0.5) * 2 * currentShakeIntensity;
            }
        }
        return {
            offsetX: shakeOffsetX,
            offsetY: shakeOffsetY,
        };
    },

    drawOverlay: (ctx, entity, finalDrawX, finalDrawY, finalDrawWidth, finalDrawHeight, nowMs, baseDrawX, baseDrawY) => {
        if (entity.isDestroyed) {
            return;
        }

        if (entity.health >= entity.maxHealth) {
            return; 
        }

        const healthPercentage = entity.health / entity.maxHealth;
        const barOuterX = finalDrawX + (finalDrawWidth - HEALTH_BAR_WIDTH) / 2;
        const barOuterY = finalDrawY - HEALTH_BAR_Y_OFFSET - HEALTH_BAR_HEIGHT; 

        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(barOuterX, barOuterY, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);

        const healthBarInnerWidth = HEALTH_BAR_WIDTH * healthPercentage;
        ctx.fillStyle = healthPercentage > 0.6 ? 'green' : healthPercentage > 0.3 ? 'orange' : 'red';
        ctx.fillRect(barOuterX, barOuterY, healthBarInnerWidth, HEALTH_BAR_HEIGHT);

        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(barOuterX, barOuterY, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
    },

    fallbackColor: '#A0522D', // Sienna for wooden box
};

// Preload using imported URL
imageManager.preloadImage(boxImage);

// --- Rendering Function (Refactored) ---
export function renderWoodenStorageBox(ctx: CanvasRenderingContext2D, box: WoodenStorageBox, nowMs: number, cycleProgress: number) {
    renderConfiguredGroundEntity({
        ctx,
        entity: box,
        config: boxConfig,
        nowMs,
        entityPosX: box.posX,
        entityPosY: box.posY,
        cycleProgress,
    });
} 