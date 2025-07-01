import { Stone } from '../../generated'; // Import generated Stone type
import stoneImage from '../../assets/doodads/stone_c.png'; // Direct import
import { drawDynamicGroundShadow, calculateShakeOffsets } from './shadowUtils'; // Import shadow utils
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer';
import { imageManager } from './imageManager';

// Configuration constants
const TARGET_STONE_WIDTH_PX = 120; // Target width on screen
const SHAKE_DURATION_MS = 300;     // How long the shake effect lasts
const SHAKE_INTENSITY_PX = 6;    // Max pixel offset for shake

// --- Client-side animation tracking for stone shakes ---
const clientStoneShakeStartTimes = new Map<string, number>(); // stoneId -> client timestamp when shake started
const lastKnownServerStoneShakeTimes = new Map<string, number>(); // stoneId -> last known server timestamp

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
        // Calculate shake offsets for shadow synchronization using helper function
        const { shakeOffsetX, shakeOffsetY } = calculateShakeOffsets(
            entity,
            entity.id.toString(),
            {
                clientStartTimes: clientStoneShakeStartTimes,
                lastKnownServerTimes: lastKnownServerStoneShakeTimes
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
            maxStretchFactor: 1.5,
            minStretchFactor: 0.15,
            shadowBlur: 1,
            pivotYOffset: 10,
            // NEW: Pass shake offsets so shadow moves with the stone
            shakeOffsetX,
            shakeOffsetY
        });
    },

    applyEffects: (ctx, entity, nowMs, _baseDrawX, _baseDrawY, _cycleProgress) => { // cycleProgress not needed here
        let shakeOffsetX = 0;
        let shakeOffsetY = 0;

        if (entity.lastHitTime) { 
            const stoneId = entity.id.toString();
            const serverShakeTime = Number(entity.lastHitTime.microsSinceUnixEpoch / 1000n);
            
            // Check if this is a NEW shake by comparing server timestamps
            const lastKnownServerTime = lastKnownServerStoneShakeTimes.get(stoneId) || 0;
            
            if (serverShakeTime !== lastKnownServerTime) {
                // NEW shake detected! Record both server time and client time
                lastKnownServerStoneShakeTimes.set(stoneId, serverShakeTime);
                clientStoneShakeStartTimes.set(stoneId, nowMs);
            }
            
            // Calculate animation based on client time
            const clientStartTime = clientStoneShakeStartTimes.get(stoneId);
            if (clientStartTime) {
                const elapsedSinceShake = nowMs - clientStartTime;
                
                if (elapsedSinceShake >= 0 && elapsedSinceShake < SHAKE_DURATION_MS) {
                    const shakeFactor = 1.0 - (elapsedSinceShake / SHAKE_DURATION_MS); 
                    const currentShakeIntensity = SHAKE_INTENSITY_PX * shakeFactor;
                    shakeOffsetX = (Math.random() - 0.5) * 2 * currentShakeIntensity;
                    shakeOffsetY = (Math.random() - 0.5) * 2 * currentShakeIntensity;
                }
            }
        } else {
            // Clean up tracking when stone is not being hit
            const stoneId = entity.id.toString();
            clientStoneShakeStartTimes.delete(stoneId);
            lastKnownServerStoneShakeTimes.delete(stoneId);
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