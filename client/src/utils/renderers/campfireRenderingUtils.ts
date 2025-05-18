import { Campfire } from '../../generated'; // Import generated Campfire type
import campfireImage from '../../assets/doodads/campfire.png'; // Direct import ON
import campfireOffImage from '../../assets/doodads/campfire_off.png'; // Direct import OFF
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { drawDynamicGroundShadow, applyStandardDropShadow } from './shadowUtils'; // Added applyStandardDropShadow back
import { imageManager } from './imageManager'; // Import image manager
import { Campfire as SpacetimeDBCampfire, Player as SpacetimeDBPlayer } from '../../generated';

// --- Constants directly used by this module or exported ---
export const CAMPFIRE_WIDTH = 64;
export const CAMPFIRE_HEIGHT = 64;
export const CAMPFIRE_WIDTH_PREVIEW = 64; // Added for preview components
export const CAMPFIRE_HEIGHT_PREVIEW = 64; // Added for preview components
// Offset for rendering to align with server-side collision/damage zones
// Keep the original render offset as server code has been updated to match visual
export const CAMPFIRE_RENDER_Y_OFFSET = 10; // Visual offset from entity's base Y

// Campfire interaction distance (player <-> campfire)
export const PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED = 96.0 * 96.0; // New radius: 96px

// Constants for server-side damage logic
export const SERVER_CAMPFIRE_DAMAGE_RADIUS = 25.0;
export const SERVER_CAMPFIRE_DAMAGE_CENTER_Y_OFFSET = 0.0;

// Particle emission points relative to the campfire's visual center (posY - (HEIGHT/2) - RENDER_Y_OFFSET)
// These describe where particles START. Positive Y is UP from visual center.
const FIRE_EMISSION_VISUAL_CENTER_Y_OFFSET = CAMPFIRE_HEIGHT * 0.35; 
const SMOKE_EMISSION_VISUAL_CENTER_Y_OFFSET = CAMPFIRE_HEIGHT * 0.4;

// --- Other Local Constants (not directly tied to gameConfig for debug rendering) ---
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
        // Apply Y offset to better align with collision area
        drawX: entity.posX - drawWidth / 2,
        drawY: entity.posY - drawHeight - CAMPFIRE_RENDER_Y_OFFSET,
    }),

    getShadowParams: undefined,

    drawCustomGroundShadow: (ctx, entity, entityImage, entityPosX, entityPosY, imageDrawWidth, imageDrawHeight, cycleProgress) => {
        // Only draw DYNAMIC ground shadow if burning and not destroyed
        if (entity.isBurning && !entity.isDestroyed) {
            drawDynamicGroundShadow({
                ctx,
                entityImage,
                entityCenterX: entityPosX,
                entityBaseY: entityPosY,
                imageDrawWidth,
                imageDrawHeight,
                cycleProgress,
                maxStretchFactor: 1.2, 
                minStretchFactor: 0.1,  
                shadowBlur: 2,         
                pivotYOffset: 35       
            });
        } 
        // The simple ellipse for the "off" state was removed from here.
        // It will now be handled by applyStandardDropShadow in applyEffects.
    },

    applyEffects: (ctx, entity, nowMs, baseDrawX, baseDrawY, cycleProgress) => {
        if (!entity.isDestroyed) {
            if (entity.isBurning) {
                // Potentially other effects for burning state later
            } else {
                // Apply standard drop shadow if OFF and not destroyed
                applyStandardDropShadow(ctx, { cycleProgress, blur: 2, offsetY: 1, color: '0,0,0' });
            }
        }

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
export function renderCampfire(
    ctx: CanvasRenderingContext2D, 
    campfire: Campfire, 
    nowMs: number, 
    cycleProgress: number,
    onlyDrawShadow?: boolean,
    skipDrawingShadow?: boolean
) { 
    renderConfiguredGroundEntity({
        ctx,
        entity: campfire,
        config: campfireConfig,
        nowMs, // Pass timestamp (might be needed for future effects)
        entityPosX: campfire.posX,
        entityPosY: campfire.posY,
        cycleProgress, // Pass actual cycleProgress
        onlyDrawShadow,    // Pass flag
        skipDrawingShadow  // Pass flag
    });
} 
