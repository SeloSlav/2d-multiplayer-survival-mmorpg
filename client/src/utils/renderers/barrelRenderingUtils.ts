import { Barrel } from '../../generated'; // Import generated type
import barrelImage from '../../assets/doodads/barrel.png'; // Direct import
import { applyStandardDropShadow, drawDynamicGroundShadow, calculateShakeOffsets } from './shadowUtils'; // Added import
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { imageManager } from './imageManager'; // Import image manager

// --- Constants --- (Keep exportable if used elsewhere)
export const BARREL_WIDTH = 72; // Increased size for better visibility 
export const BARREL_HEIGHT = 72;
export const PLAYER_BARREL_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0; // Barrel interaction distance
const SHAKE_DURATION_MS = 150; 
const SHAKE_INTENSITY_PX = 8; // Moderate shake for barrels
const HEALTH_BAR_WIDTH = 40; // Smaller health bar for barrels
const HEALTH_BAR_HEIGHT = 5;
const HEALTH_BAR_Y_OFFSET = 6; // Adjust offset for barrel image centering
const HEALTH_BAR_VISIBLE_DURATION_MS = 3000; // Same as storage boxes

// --- Client-side animation tracking for barrel shakes ---
const clientBarrelShakeStartTimes = new Map<string, number>(); // barrelId -> client timestamp when shake started
const lastKnownServerBarrelShakeTimes = new Map<string, number>();

// --- Define Configuration --- 
const barrelConfig: GroundEntityConfig<Barrel> = {
    getImageSource: (entity) => {
        if (entity.respawnAt) {
            return null; // Don't render if respawning (destroyed)
        }
        return barrelImage;
    },

    getTargetDimensions: (img, _entity) => ({
        width: BARREL_WIDTH,
        height: BARREL_HEIGHT,
    }),

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        drawX: entity.posX - drawWidth / 2,
        drawY: entity.posY - drawHeight - 12, // Slight Y adjustment for centering
    }),

    getShadowParams: undefined,

    drawCustomGroundShadow: (ctx, entity, entityImage, entityPosX, entityPosY, imageDrawWidth, imageDrawHeight, cycleProgress) => {
        // Draw DYNAMIC ground shadow if not destroyed/respawning
        if (!entity.respawnAt) {
            // Calculate shake offsets for shadow synchronization using helper function
            const { shakeOffsetX, shakeOffsetY } = calculateShakeOffsets(
                entity,
                entity.id.toString(),
                {
                    clientStartTimes: clientBarrelShakeStartTimes,
                    lastKnownServerTimes: lastKnownServerBarrelShakeTimes
                },
                SHAKE_DURATION_MS,
                SHAKE_INTENSITY_PX
            );

            drawDynamicGroundShadow({
                ctx,
                entityImage,
                entityCenterX: entityPosX,
                entityBaseY: entityPosY,
                imageDrawWidth,
                imageDrawHeight,
                cycleProgress,
                maxStretchFactor: 1.1, 
                minStretchFactor: 0.15,  
                shadowBlur: 2,         
                pivotYOffset: 30, // Smaller than storage boxes
                // Pass shake offsets so shadow moves with the barrel
                shakeOffsetX,
                shakeOffsetY       
            });
        }
    },

    applyEffects: (ctx, entity, nowMs, baseDrawX, baseDrawY, cycleProgress) => {
        // Dynamic shadow is now handled in drawCustomGroundShadow
        // Handle shake effects

        let shakeOffsetX = 0;
        let shakeOffsetY = 0;

        if (entity.lastHitTime && !entity.respawnAt) {
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
        if (entity.respawnAt) {
            return; // Don't draw health bar if barrel is destroyed/respawning
        }

        const health = entity.health ?? 0;
        const maxHealth = 50.0; // BARREL_INITIAL_HEALTH from server

        if (health < maxHealth && entity.lastHitTime) {
            const lastHitTimeMs = Number(entity.lastHitTime.microsSinceUnixEpoch / 1000n);
            const elapsedSinceHit = nowMs - lastHitTimeMs;

            if (elapsedSinceHit < HEALTH_BAR_VISIBLE_DURATION_MS) {
                const healthPercentage = Math.max(0, health / maxHealth);
                const barOuterX = finalDrawX + (finalDrawWidth - HEALTH_BAR_WIDTH) / 2;
                const barOuterY = finalDrawY + finalDrawHeight + HEALTH_BAR_Y_OFFSET; // Position below barrel 

                const timeSinceLastHitRatio = elapsedSinceHit / HEALTH_BAR_VISIBLE_DURATION_MS;
                const opacity = Math.max(0, 1 - Math.pow(timeSinceLastHitRatio, 2));

                // Background
                ctx.fillStyle = `rgba(0, 0, 0, ${0.5 * opacity})`;
                ctx.fillRect(barOuterX, barOuterY, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);

                // Health bar
                const healthBarInnerWidth = HEALTH_BAR_WIDTH * healthPercentage;
                const r = Math.floor(255 * (1 - healthPercentage));
                const g = Math.floor(255 * healthPercentage);
                ctx.fillStyle = `rgba(${r}, ${g}, 0, ${opacity})`;
                ctx.fillRect(barOuterX, barOuterY, healthBarInnerWidth, HEALTH_BAR_HEIGHT);

                // Border
                ctx.strokeStyle = `rgba(0,0,0, ${0.7 * opacity})`;
                ctx.lineWidth = 1;
                ctx.strokeRect(barOuterX, barOuterY, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
            }
        }
    },

    fallbackColor: '#8B4513', // Saddle brown for wooden barrel
};

// Preload using imported URL
imageManager.preloadImage(barrelImage);

// --- Rendering Function (Refactored) ---
export function renderBarrel(
    ctx: CanvasRenderingContext2D, 
    barrel: Barrel, 
    nowMs: number, 
    cycleProgress: number
) {
    renderConfiguredGroundEntity({
        ctx,
        entity: barrel,
        config: barrelConfig,
        nowMs,
        entityPosX: barrel.posX,
        entityPosY: barrel.posY,
        cycleProgress,
    });
} 