/**
 * campfireRenderingUtils - Campfire sprite rendering and interaction constants.
 *
 * Renders campfire entities (on/off states) with shadow and shake. Exports
 * CAMPFIRE_WIDTH, CAMPFIRE_HEIGHT, CAMPFIRE_RENDER_Y_OFFSET and
 * PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED for interactionTargetRuntime.
 *
 * Responsibilities:
 * 1. SPRITE RENDERING: renderCampfire uses genericGroundRenderer. isDestroyed
 *    hides the sprite. Lit + WebGL2 GPU fire uses campfire_off.png (shader draws flame);
 *    lit without WebGL keeps campfire.png as fallback.
 *
 * 2. SHAKE: Client-side shake on hit. SHAKE_DURATION_MS, SHAKE_INTENSITY_PX.
 *
 * 3. INTERACTION: PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED (96px) for
 *    E-key targeting. SERVER_CAMPFIRE_DAMAGE_RADIUS for server logic.
 *
 * 4. GPU FIRE OVERLAY: getPlacedCampfireFireAnchorWorld / monument anchor helpers
 *    for campfireFireOverlayUtils (WebGL2). Steady fire/smoke are not particles.
 */

import { Campfire } from '../../generated/types'; // Import generated Campfire type
import campfireImage from '../../assets/doodads/campfire.png'; // Direct import ON
import campfireOffImage from '../../assets/doodads/campfire_off.png'; // Direct import OFF
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { drawDynamicGroundShadow, calculateShakeOffsets } from './shadowUtils';
import { imageManager } from './imageManager'; // Import image manager
import {
  touchCampfireFireWebGLInit,
  isCampfireFireWebGLOverlayAvailable,
} from './campfireFireOverlayUtils';
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

/** Gray smoke after extinguish; matches former particle linger duration. */
export const CAMPFIRE_SMOKE_LINGER_MS = 4000;

/** GPU procedural fire intensity ramps (seconds-scale; pairs with plume buildup). */
export const CAMPFIRE_GPU_FIRE_RAMP_UP_MS = 4200;
export const CAMPFIRE_GPU_FIRE_RAMP_DOWN_MS = 4800;

/** Canvas light / night mask ramp up — slower than fire so glow follows visible flame. Capped by fire01 each frame. */
export const CAMPFIRE_LIGHT_RAMP_UP_MS = 9800;

/** Monument "fv_campfire" world Y offset (fishing / hunting village). */
export const STATIC_MONUMENT_CAMPFIRE_Y_OFFSET = -135;
const STATIC_MONUMENT_CAMPFIRE_FIRE_ANCHOR_DROP_PX = 24;

/** Fire column anchor in world pixels for placed campfires (entity base at posY). Smaller Y = higher on screen. */
export function getPlacedCampfireFireAnchorWorld(posX: number, posY: number): { x: number; y: number } {
  const visualCenterY = posY - CAMPFIRE_HEIGHT / 2 - CAMPFIRE_RENDER_Y_OFFSET;
  return { x: posX, y: visualCenterY + CAMPFIRE_HEIGHT * 0.12 - 8 };
}

/** Fire anchor for static monument campfires (image centered at world pos). */
export function getStaticMonumentCampfireFireAnchorWorld(posX: number, posY: number): { x: number; y: number } {
  const visualCenterY = posY + STATIC_MONUMENT_CAMPFIRE_Y_OFFSET;
  return { x: posX, y: visualCenterY + CAMPFIRE_HEIGHT * 0.08 - 8 + STATIC_MONUMENT_CAMPFIRE_FIRE_ANCHOR_DROP_PX };
}

// --- Other Local Constants ---
const SHAKE_DURATION_MS = 150; // How long the shake effect lasts
const SHAKE_INTENSITY_PX = 8; // Slightly less intense shake for campfires

// --- Client-side animation tracking for campfire shakes ---
const clientCampfireShakeStartTimes = new Map<string, number>(); // campfireId -> client timestamp when shake started
const lastKnownServerCampfireShakeTimes = new Map<string, number>();

// --- Define Configuration ---
const campfireConfig: GroundEntityConfig<Campfire> = {
    // Return imported URL based on state
    getImageSource: (entity) => {
        if (entity.isDestroyed) {
            return null; // Don't render if destroyed (placeholder for shatter)
        }
        if (!entity.isBurning) {
            return campfireOffImage;
        }
        touchCampfireFireWebGLInit();
        return isCampfireFireWebGLOverlayAvailable() ? campfireOffImage : campfireImage;
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
        // Draw DYNAMIC ground shadow for both burning and unlit campfires (if not destroyed)
        if (!entity.isDestroyed) {
            // Calculate shake offsets for shadow synchronization using helper function
            const { shakeOffsetX, shakeOffsetY } = calculateShakeOffsets(
                entity,
                entity.id.toString(),
                {
                    clientStartTimes: clientCampfireShakeStartTimes,
                    lastKnownServerTimes: lastKnownServerCampfireShakeTimes
                },
                SHAKE_DURATION_MS,
                SHAKE_INTENSITY_PX
            );

            // NOON FIX: At noon, shadows appear too far below (detached from entity)
            let noonExtraOffset = 0;
            if (cycleProgress >= 0.35 && cycleProgress < 0.55) {
                const noonT = (cycleProgress - 0.35) / 0.20;
                const noonFactor = 1.0 - Math.abs(noonT - 0.5) * 2.0;
                noonExtraOffset = noonFactor * imageDrawHeight * 0.25;
            }

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
                pivotYOffset: 25 + noonExtraOffset,
                // NEW: Pass shake offsets so shadow moves with the campfire
                shakeOffsetX,
                shakeOffsetY      
            });
        }
    },

    applyEffects: (ctx, entity, nowMs, baseDrawX, baseDrawY, cycleProgress) => {
        // Dynamic shadow is now handled in drawCustomGroundShadow for all states
        // No additional shadow effects needed here

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

    // Health bar rendered separately via renderEntityHealthBar
    drawOverlay: undefined,

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
    skipDrawingShadow?: boolean,
    playerX?: number,
    playerY?: number
) { 
    renderConfiguredGroundEntity({
        ctx,
        entity: campfire,
        config: campfireConfig,
        nowMs,
        entityPosX: campfire.posX,
        entityPosY: campfire.posY,
        cycleProgress,
        onlyDrawShadow,
        skipDrawingShadow
    });
    
    // Health bar rendered via renderHealthBarOverlay (on top of world objects)
} 
