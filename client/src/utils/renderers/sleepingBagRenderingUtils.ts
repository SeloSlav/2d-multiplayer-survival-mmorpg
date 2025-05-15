import { SleepingBag } from '../../generated'; // Import generated SleepingBag type
import sleepingBagImageSrc from '../../assets/doodads/sleeping_bag.png'; // Assuming this is the correct path
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer';
import { applyStandardDropShadow } from './shadowUtils';
import { imageManager } from './imageManager';

// --- Constants ---
export const SLEEPING_BAG_WIDTH = 64; // Adjust as needed
export const SLEEPING_BAG_HEIGHT = 32; // Adjust as needed
const SHAKE_DURATION_MS = 150;
const SHAKE_INTENSITY_PX = 6;
const HEALTH_BAR_WIDTH = 50;
const HEALTH_BAR_HEIGHT = 5;
const HEALTH_BAR_Y_OFFSET = 5;
const HEALTH_BAR_VISIBLE_DURATION_MS = 3000; // Health bar stays visible for 3 seconds after last hit

const sleepingBagConfig: GroundEntityConfig<SleepingBag> = {
    getImageSource: (entity) => {
        if (entity.isDestroyed) {
            return null;
        }
        return sleepingBagImageSrc;
    },

    getTargetDimensions: (_img, _entity) => ({
        width: SLEEPING_BAG_WIDTH,
        height: SLEEPING_BAG_HEIGHT,
    }),

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        drawX: entity.posX - drawWidth / 2,
        drawY: entity.posY - drawHeight, // Anchor to bottom center
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
        return { offsetX: shakeOffsetX, offsetY: shakeOffsetY };
    },

    drawOverlay: (ctx, entity, finalDrawX, finalDrawY, finalDrawWidth, finalDrawHeight, nowMs) => {
        if (entity.isDestroyed) {
            return;
        }

        const health = entity.health ?? 0;
        const maxHealth = entity.maxHealth ?? 1;

        if (health < maxHealth && entity.lastHitTime) {
            const lastHitTimeMs = Number(entity.lastHitTime.microsSinceUnixEpoch / 1000n);
            const elapsedSinceHit = nowMs - lastHitTimeMs;

            if (elapsedSinceHit < HEALTH_BAR_VISIBLE_DURATION_MS) {
                const healthPercentage = Math.max(0, health / maxHealth);
                const barOuterX = finalDrawX + (finalDrawWidth - HEALTH_BAR_WIDTH) / 2;
                const barOuterY = finalDrawY - HEALTH_BAR_Y_OFFSET - HEALTH_BAR_HEIGHT;

                const timeSinceLastHitRatio = elapsedSinceHit / HEALTH_BAR_VISIBLE_DURATION_MS;
                const opacity = Math.max(0, 1 - Math.pow(timeSinceLastHitRatio, 2));

                ctx.fillStyle = `rgba(0, 0, 0, ${0.5 * opacity})`;
                ctx.fillRect(barOuterX, barOuterY, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);

                const healthBarInnerWidth = HEALTH_BAR_WIDTH * healthPercentage;
                const r = Math.floor(255 * (1 - healthPercentage));
                const g = Math.floor(255 * healthPercentage);
                ctx.fillStyle = `rgba(${r}, ${g}, 0, ${opacity})`;
                ctx.fillRect(barOuterX, barOuterY, healthBarInnerWidth, HEALTH_BAR_HEIGHT);

                ctx.strokeStyle = `rgba(0, 0, 0, ${0.7 * opacity})`;
                ctx.lineWidth = 1;
                ctx.strokeRect(barOuterX, barOuterY, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
            }
        }
    },
    fallbackColor: '#8B4513', // SaddleBrown for sleeping bag
};

imageManager.preloadImage(sleepingBagImageSrc);

export function renderSleepingBag(ctx: CanvasRenderingContext2D, bag: SleepingBag, nowMs: number, cycleProgress: number) {
    renderConfiguredGroundEntity({
        ctx,
        entity: bag,
        config: sleepingBagConfig,
        nowMs,
        entityPosX: bag.posX,
        entityPosY: bag.posY,
        cycleProgress,
    });
} 