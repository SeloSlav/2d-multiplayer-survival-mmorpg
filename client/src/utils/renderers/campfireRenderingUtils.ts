import { Campfire } from '../../generated'; // Import generated Campfire type
import campfireImage from '../../assets/doodads/campfire.png'; // Direct import ON
import campfireOffImage from '../../assets/doodads/campfire_off.png'; // Direct import OFF
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { applyStandardDropShadow } from './shadowUtils'; // Import new shadow util
import { imageManager } from './imageManager'; // Import image manager

// --- Constants ---
export const CAMPFIRE_WIDTH = 64;
export const CAMPFIRE_HEIGHT = 64;
const SHAKE_DURATION_MS = 150; // How long the shake effect lasts
const SHAKE_INTENSITY_PX = 8; // Slightly less intense shake for campfires
const HEALTH_BAR_WIDTH = 50;
const HEALTH_BAR_HEIGHT = 6;
const HEALTH_BAR_Y_OFFSET = 10; // Offset above the campfire image
const HEALTH_BAR_VISIBLE_DURATION_MS = 3000; // Added for fade effect

// --- Define Configuration ---
const campfireConfig: GroundEntityConfig<Campfire> = {
    // Return imported URL based on state
    getImageSource: (entity) => {
        if (entity.isDestroyed) {
            return null; // Don't render if destroyed (placeholder for shatter)
        }
        return entity.isBurning ? campfireImage : campfireOffImage;
    },

    getTargetDimensions: (_img, _entity) => ({
        width: CAMPFIRE_WIDTH,
        height: CAMPFIRE_HEIGHT,
    }),

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        // Top-left corner for image drawing, originating from entity's base Y
        drawX: entity.posX - drawWidth / 2,
        drawY: entity.posY - drawHeight,
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
                shakeOffsetY = (Math.random() - 0.5) * 2 * currentShakeIntensity; // Allow vertical shake too
            }
        }

        return {
            offsetX: shakeOffsetX,
            offsetY: shakeOffsetY,
        };
    },

    drawOverlay: (ctx, entity, finalDrawX, finalDrawY, finalDrawWidth, finalDrawHeight, nowMs, baseDrawX, baseDrawY) => {
        // If destroyed, do nothing in overlay (main image will also not be drawn)
        if (entity.isDestroyed) {
            return;
        }

        const health = entity.health ?? 0;
        const maxHealth = entity.maxHealth ?? 1;

        // Health bar logic: only if not destroyed, health < maxHealth, and recently hit
        if (health < maxHealth && entity.lastHitTime) {
            const lastHitTimeMs = Number(entity.lastHitTime.microsSinceUnixEpoch / 1000n);
            const elapsedSinceHit = nowMs - lastHitTimeMs;

            if (elapsedSinceHit < HEALTH_BAR_VISIBLE_DURATION_MS) {
                const healthPercentage = Math.max(0, health / maxHealth);
                const barOuterX = finalDrawX + (finalDrawWidth - HEALTH_BAR_WIDTH) / 2;
                const barOuterY = finalDrawY - HEALTH_BAR_Y_OFFSET - HEALTH_BAR_HEIGHT;

                // Fade effect for the health bar
                const timeSinceLastHitRatio = elapsedSinceHit / HEALTH_BAR_VISIBLE_DURATION_MS;
                const opacity = Math.max(0, 1 - Math.pow(timeSinceLastHitRatio, 2)); // Fade out faster at the end

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

    fallbackColor: '#663300', // Dark brown fallback
};

// Preload both imported URLs
imageManager.preloadImage(campfireImage);
imageManager.preloadImage(campfireOffImage);

// --- Rendering Function (Refactored) ---
export function renderCampfire(ctx: CanvasRenderingContext2D, campfire: Campfire, nowMs: number, cycleProgress: number) { 
    renderConfiguredGroundEntity({
        ctx,
        entity: campfire,
        config: campfireConfig,
        nowMs, // Pass timestamp (might be needed for future effects)
        entityPosX: campfire.posX,
        entityPosY: campfire.posY,
        cycleProgress, // Pass actual cycleProgress
    });
} 