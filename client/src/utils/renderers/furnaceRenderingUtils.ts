import { Furnace } from '../../generated'; // Import generated Furnace type
import furnaceImage from '../../assets/doodads/furnace_simple.png'; // Direct import - USING ACTUAL IMAGE NOW
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { drawDynamicGroundShadow, applyStandardDropShadow, calculateShakeOffsets } from './shadowUtils';
import { imageManager } from './imageManager'; // Import image manager
import { Furnace as SpacetimeDBFurnace } from '../../generated';

// --- Constants directly used by this module or exported ---
export const FURNACE_WIDTH = 96; // Standard furnace size
export const FURNACE_HEIGHT = 96; // Standard furnace size
export const FURNACE_WIDTH_PREVIEW = 96; // Standard furnace size
export const FURNACE_HEIGHT_PREVIEW = 96; // Standard furnace size
// Offset for rendering to align with server-side collision zones
export const FURNACE_RENDER_Y_OFFSET = 10; // Visual offset from entity's base Y

// Furnace interaction distance (player <-> furnace)
export const PLAYER_FURNACE_INTERACTION_DISTANCE_SQUARED = 96.0 * 96.0; // Same as campfire

// Constants for server-side collision logic
export const SERVER_FURNACE_COLLISION_RADIUS = 20.0;
export const SERVER_FURNACE_COLLISION_CENTER_Y_OFFSET = 0.0;

// --- Other Local Constants ---
const SHAKE_DURATION_MS = 150; // How long the shake effect lasts
const SHAKE_INTENSITY_PX = 8; // Same as campfire
const HEALTH_BAR_WIDTH = 50;
const HEALTH_BAR_HEIGHT = 6;
const HEALTH_BAR_Y_OFFSET = 10; // Offset above the furnace image
const HEALTH_BAR_VISIBLE_DURATION_MS = 3000; // Added for fade effect

// --- Client-side animation tracking for furnace shakes ---
const clientFurnaceShakeStartTimes = new Map<string, number>(); // furnaceId -> client timestamp when shake started
const lastKnownServerFurnaceShakeTimes = new Map<string, number>();

// --- Define Configuration ---
const furnaceConfig: GroundEntityConfig<Furnace> = {
    // Use actual furnace image like wooden storage box pattern
    getImageSource: (entity) => {
        if (entity.isDestroyed) {
            return null; // Don't render if destroyed
        }
        return furnaceImage; // Use actual furnace image (same image for burning/not burning - visual state can be shown via effects)
    },

    getTargetDimensions: (_img, _entity) => ({
        width: FURNACE_WIDTH,
        height: FURNACE_HEIGHT,
    }),

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        // Top-left corner for image drawing, originating from entity's base Y
        // Apply Y offset to better align with collision area
        drawX: entity.posX - drawWidth / 2,
        drawY: entity.posY - drawHeight - FURNACE_RENDER_Y_OFFSET,
    }),

    getShadowParams: undefined,

    drawCustomGroundShadow: (ctx, entity, entityImage, entityPosX, entityPosY, imageDrawWidth, imageDrawHeight, cycleProgress) => {
        // Draw DYNAMIC ground shadow for both burning and unlit furnaces (if not destroyed)
        if (!entity.isDestroyed) {
            // Calculate shake offsets for shadow synchronization using helper function
            const { shakeOffsetX, shakeOffsetY } = calculateShakeOffsets(
                entity,
                entity.id.toString(),
                {
                    clientStartTimes: clientFurnaceShakeStartTimes,
                    lastKnownServerTimes: lastKnownServerFurnaceShakeTimes
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
                maxStretchFactor: 1.1, // Slightly less dynamic than campfire 
                minStretchFactor: 0.2,  // Heavier/more stable than campfire
                shadowBlur: 3,         // Slightly more blur for bigger object
                pivotYOffset: 30,      // Furnace is heavier, shadow anchor lower
                // Pass shake offsets so shadow moves with the furnace
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

        return {
            offsetX: shakeOffsetX,
            offsetY: shakeOffsetY,
        };
    },

    drawOverlay: (ctx, entity, finalDrawX, finalDrawY, finalDrawWidth, finalDrawHeight, nowMs, baseDrawX, baseDrawY) => {
        // If destroyed, do nothing in overlay
        if (entity.isDestroyed) {
            return;
        }

        // Only draw health bar - NO PLACEHOLDER GRAPHICS, JUST USE THE IMAGE
        const health = entity.health ?? 0;
        const maxHealth = entity.maxHealth ?? 1;

        if (health < maxHealth && entity.lastHitTime) {
            const lastHitTimeMs = Number(entity.lastHitTime.microsSinceUnixEpoch / 1000n);
            const elapsedSinceHit = nowMs - lastHitTimeMs;

            if (elapsedSinceHit < HEALTH_BAR_VISIBLE_DURATION_MS) {
                const healthPercentage = Math.max(0, health / maxHealth);
                const barOuterX = finalDrawX + (finalDrawWidth - HEALTH_BAR_WIDTH) / 2;
                const barOuterY = finalDrawY + finalDrawHeight + HEALTH_BAR_Y_OFFSET;

                // Fade effect for the health bar
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

    fallbackColor: '#8B4513', // Sienna brown fallback (like wooden storage box)
};

// Preload furnace image
imageManager.preloadImage(furnaceImage);

// --- Rendering Function ---
export function renderFurnace(
    ctx: CanvasRenderingContext2D, 
    furnace: Furnace, 
    nowMs: number, 
    cycleProgress: number,
    onlyDrawShadow?: boolean,
    skipDrawingShadow?: boolean
) { 
    renderConfiguredGroundEntity({
        ctx,
        entity: furnace,
        config: furnaceConfig,
        nowMs,
        entityPosX: furnace.posX,
        entityPosY: furnace.posY,
        cycleProgress,
        onlyDrawShadow,
        skipDrawingShadow
    });
} 

 