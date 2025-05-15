// import { TILE_SIZE } from '../../config/gameConfig'; // Not exported, remove
// import { ItemImagesRef } from '../../hooks/useAssetLoader'; // Not an exported member, remove
import { Stash } from '../../generated';
// Assuming itemImagesStore is not the correct way, reverting to itemImagesRef prop
// import { itemImagesStore } from '../../hooks/useAssetLoader'; 
import stashImageSrc from '../../assets/doodads/stash.png'; // Assuming this is the correct path
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer';
import { applyStandardDropShadow } from './shadowUtils';
import { imageManager } from './imageManager';

// --- Constants ---
export const STASH_WIDTH = 48; // Adjust as needed
export const STASH_HEIGHT = 48; // Adjust as needed
const SHAKE_DURATION_MS = 150;
const SHAKE_INTENSITY_PX = 7;
const HEALTH_BAR_WIDTH = 40;
const HEALTH_BAR_HEIGHT = 5;
const HEALTH_BAR_Y_OFFSET = 6;
const HEALTH_BAR_VISIBLE_DURATION_MS = 3000; // Health bar stays visible for 3 seconds after last hit

const stashConfig: GroundEntityConfig<Stash> = {
    getImageSource: (entity) => {
        if (entity.isDestroyed || entity.isHidden) {
            return null;
        }
        return stashImageSrc;
    },

    getTargetDimensions: (img, _entity) => {
        const aspectRatio = img.naturalWidth / img.naturalHeight;
        const targetHeight = STASH_HEIGHT; // Use the defined height
        const targetWidth = targetHeight * aspectRatio;
        return { width: targetWidth, height: targetHeight };
    },

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        drawX: entity.posX - drawWidth / 2,
        drawY: entity.posY - drawHeight, // Anchor to bottom center (like campfire)
    }),

    getShadowParams: undefined, // No special shadow for stash, can use default from applyEffects

    applyEffects: (ctx, entity, nowMs, baseDrawX, baseDrawY, cycleProgress) => {
        // Only apply shadow if not hidden and not destroyed
        if (!entity.isHidden && !entity.isDestroyed) {
            applyStandardDropShadow(ctx, { cycleProgress, blur: 2, offsetY: 1 }); 
        }

        let shakeOffsetX = 0;
        let shakeOffsetY = 0;

        if (entity.lastHitTime && !entity.isDestroyed && !entity.isHidden) {
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
        if (entity.isDestroyed || entity.isHidden) {
            return;
        }

        const health = entity.health ?? 0;
        const maxHealth = entity.maxHealth ?? 1; // Avoid division by zero if undefined

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
                const g = Math.floor(255 * healthPercentage);
                const r = Math.floor(255 * (1 - healthPercentage));
                ctx.fillStyle = `rgba(${r}, ${g}, 0, ${opacity})`;
                ctx.fillRect(barOuterX, barOuterY, healthBarInnerWidth, HEALTH_BAR_HEIGHT);

                ctx.strokeStyle = `rgba(0, 0, 0, ${0.7 * opacity})`;
                ctx.lineWidth = 1;
                ctx.strokeRect(barOuterX, barOuterY, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
            }
        }
    },
    fallbackColor: '#5C4033', // Darker brown for stash
};

imageManager.preloadImage(stashImageSrc);

export function renderStash(
    ctx: CanvasRenderingContext2D, 
    stash: Stash, 
    nowMs: number, 
    cycleProgress: number
) {
    renderConfiguredGroundEntity({
        ctx,
        entity: stash,
        config: stashConfig,
        nowMs,
        entityPosX: stash.posX,
        entityPosY: stash.posY,
        cycleProgress,
    });
} 