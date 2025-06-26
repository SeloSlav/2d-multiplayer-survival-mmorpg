import { RainCollector } from '../../generated'; // Import generated type
import reedRainCollectorImage from '../../assets/doodads/reed_rain_collector.png'; // Import rain collector image
import { drawDynamicGroundShadow, calculateShakeOffsets } from './shadowUtils'; // Import shadow utils
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { imageManager } from './imageManager'; // Import image manager

// --- Constants ---
export const RAIN_COLLECTOR_WIDTH = 96; // Doubled from 48
export const RAIN_COLLECTOR_HEIGHT = 128; // Doubled from 64
export const PLAYER_RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED = 96.0 * 96.0; // Interaction distance
const SHAKE_DURATION_MS = 150;
const SHAKE_INTENSITY_PX = 6; // Moderate shake for rain collectors
const HEALTH_BAR_WIDTH = 50;
const HEALTH_BAR_HEIGHT = 6;
const HEALTH_BAR_Y_OFFSET = 8;
const HEALTH_BAR_VISIBLE_DURATION_MS = 3000;

// --- Client-side animation tracking for rain collector shakes ---
const clientRainCollectorShakeStartTimes = new Map<string, number>(); // rainCollectorId -> client timestamp when shake started
const lastKnownServerRainCollectorShakeTimes = new Map<string, number>();

const rainCollectorConfig: GroundEntityConfig<RainCollector> = {
    getImageSource: (entity) => {
        if (entity.isDestroyed) {
            return null;
        }
        return reedRainCollectorImage;
    },

    getTargetDimensions: (img, _entity) => ({
        width: RAIN_COLLECTOR_WIDTH,
        height: RAIN_COLLECTOR_HEIGHT,
    }),

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        drawX: entity.posX - drawWidth / 2,
        drawY: entity.posY - drawHeight / 2, // Center the rain collector
    }),

    getShadowParams: undefined,

    drawCustomGroundShadow: (ctx, entity, entityImage, entityPosX, entityPosY, imageDrawWidth, imageDrawHeight, cycleProgress) => {
        if (!entity.isDestroyed) {
            // Calculate shake offsets for shadow synchronization using helper function
            const { shakeOffsetX, shakeOffsetY } = calculateShakeOffsets(
                entity,
                entity.id.toString(),
                {
                    clientStartTimes: clientRainCollectorShakeStartTimes,
                    lastKnownServerTimes: lastKnownServerRainCollectorShakeTimes
                },
                SHAKE_DURATION_MS,
                SHAKE_INTENSITY_PX
            );

            drawDynamicGroundShadow({
                ctx,
                entityImage,
                entityCenterX: entityPosX,
                entityBaseY: entityPosY + imageDrawHeight / 2, // Base at bottom of sprite
                imageDrawWidth,
                imageDrawHeight,
                cycleProgress,
                baseShadowColor: '0,0,0',
                maxShadowAlpha: 0.4,
                shadowBlur: 1,
                maxStretchFactor: 1.2,
                minStretchFactor: 0.2,
                pivotYOffset: 20,
                // NEW: Pass shake offsets so shadow moves with the rain collector
                shakeOffsetX,
                shakeOffsetY
            });
        }
    },

    applyEffects: (ctx, entity, nowMs, baseDrawX, baseDrawY, cycleProgress) => {
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

        // Draw water level indicator on the rain collector
        const maxWater = 40; // Updated to match the new capacity
        const waterRatio = Math.min(entity.totalWaterCollected / maxWater, 1.0);
        const waterHeight = finalDrawHeight * waterRatio * 0.3; // Only use bottom 30% for water display

        if (waterRatio > 0.1) { // Only show if there's meaningful water
            ctx.save();
            ctx.fillStyle = '#4a90e2'; // Blue water color
            ctx.globalAlpha = 0.7;
            
            // Draw water level at bottom of rain collector
            const waterX = finalDrawX + finalDrawWidth * 0.2;
            const waterY = finalDrawY + finalDrawHeight - waterHeight - finalDrawHeight * 0.1;
            const waterWidth = finalDrawWidth * 0.6;
            
            ctx.fillRect(waterX, waterY, waterWidth, waterHeight);
            ctx.restore();
        }

        // Health bar logic (similar to other objects)
        const health = entity.health ?? 0;
        const maxHealth = entity.maxHealth ?? 1;

        if (health < maxHealth && entity.lastHitTime) {
            const lastHitTimeMs = Number(entity.lastHitTime.microsSinceUnixEpoch / 1000n);
            const elapsedSinceHit = nowMs - lastHitTimeMs;

            if (elapsedSinceHit < HEALTH_BAR_VISIBLE_DURATION_MS) {
                const healthPercentage = Math.max(0, health / maxHealth);
                const barOuterX = finalDrawX + (finalDrawWidth - HEALTH_BAR_WIDTH) / 2;
                const barOuterY = finalDrawY + finalDrawHeight + HEALTH_BAR_Y_OFFSET;

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

    fallbackColor: '#2c5aa0', // Blue fallback for rain collector
};

// Preload the rain collector image
imageManager.preloadImage(reedRainCollectorImage);

// --- Rendering Function ---
export function renderRainCollector(
    ctx: CanvasRenderingContext2D, 
    rainCollector: RainCollector, 
    nowMs: number, 
    cycleProgress: number
) {
    renderConfiguredGroundEntity({
        ctx,
        entity: rainCollector,
        config: rainCollectorConfig,
        nowMs,
        entityPosX: rainCollector.posX,
        entityPosY: rainCollector.posY,
        cycleProgress,
    });
} 