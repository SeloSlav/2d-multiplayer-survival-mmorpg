import { Furnace } from '../../generated/types'; // Import generated Furnace type
import furnaceImage from '../../assets/doodads/furnace_simple.png'; // Direct import OFF
import furnaceOnImage from '../../assets/doodads/furnace_simple_on.png'; // Direct import ON
import largeFurnaceImage from '../../assets/doodads/large_furnace_off.png'; // Direct import OFF
import largeFurnaceOnImage from '../../assets/doodads/large_furnace_on.png'; // Direct import ON
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { drawDynamicGroundShadow, calculateShakeOffsets } from './shadowUtils';
import { imageManager } from './imageManager'; // Import image manager
import { isCompoundMonument } from '../../config/compoundBuildings';

// --- Furnace Type Constants ---
export const FURNACE_TYPE_NORMAL = 0;
export const FURNACE_TYPE_LARGE = 1;

// --- Constants directly used by this module or exported ---
export const FURNACE_WIDTH = 96; // Standard furnace size
export const FURNACE_HEIGHT = 96; // Standard furnace size
export const FURNACE_WIDTH_PREVIEW = 96; // Standard furnace size
export const FURNACE_HEIGHT_PREVIEW = 96; // Standard furnace size
// Offset for rendering to align with server-side collision zones
export const FURNACE_RENDER_Y_OFFSET = 10; // Visual offset from entity's base Y

// Large furnace constants
export const LARGE_FURNACE_WIDTH = 256;
export const LARGE_FURNACE_HEIGHT = 256;
export const LARGE_FURNACE_RENDER_Y_OFFSET = 0; // Visual offset from entity's base Y

// Monument large furnace constants (matches warehouse size it replaced)
export const MONUMENT_LARGE_FURNACE_WIDTH = 480;
export const MONUMENT_LARGE_FURNACE_HEIGHT = 480;
export const MONUMENT_LARGE_FURNACE_RENDER_Y_OFFSET = -100;

// Furnace interaction distance (player <-> furnace) - must match server constants
export const PLAYER_FURNACE_INTERACTION_DISTANCE_SQUARED = 96.0 * 96.0; // Same as campfire
export const PLAYER_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED = 130.0 * 130.0; // Larger for big furnace
export const PLAYER_MONUMENT_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED = 250.0 * 250.0; // Matches the server for large compound buildings.

// Constants for server-side collision logic
export const SERVER_FURNACE_COLLISION_RADIUS = 20.0;
export const SERVER_FURNACE_COLLISION_CENTER_Y_OFFSET = 0.0;

// --- Other Local Constants ---
const SHAKE_DURATION_MS = 150; // How long the shake effect lasts
const SHAKE_INTENSITY_PX = 8; // Same as campfire

// --- Client-side animation tracking for furnace shakes ---
const clientFurnaceShakeStartTimes = new Map<string, number>(); // furnaceId -> client timestamp when shake started
const lastKnownServerFurnaceShakeTimes = new Map<string, number>();

// --- Define Configuration for Normal Furnace ---
const furnaceConfig: GroundEntityConfig<Furnace> = {
    // Return imported URL based on burning state
    getImageSource: (entity) => {
        if (entity.isDestroyed) {
            return null; // Don't render if destroyed
        }
        return entity.isBurning ? furnaceOnImage : furnaceImage;
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
                maxStretchFactor: 1.1, // Slightly less dynamic than campfire 
                minStretchFactor: 0.2,  // Heavier/more stable than campfire
                shadowBlur: 3,         // Slightly more blur for bigger object
                pivotYOffset: 30 + noonExtraOffset,      // Furnace is heavier, shadow anchor lower
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

    // Health bar rendered separately via renderEntityHealthBar
    drawOverlay: undefined,

    fallbackColor: '#8B4513', // Sienna brown fallback
};

// --- Define Configuration for Large Furnace ---
const largeFurnaceConfig: GroundEntityConfig<Furnace> = {
    // Return imported URL based on burning state
    getImageSource: (entity) => {
        if (entity.isDestroyed) {
            return null; // Don't render if destroyed
        }
        return entity.isBurning ? largeFurnaceOnImage : largeFurnaceImage;
    },

    getTargetDimensions: (_img, entity) => {
        // Compound monument large furnaces render at warehouse size (480x480)
        if (isCompoundMonument(entity.isMonument, entity.posX, entity.posY)) {
            return {
                width: MONUMENT_LARGE_FURNACE_WIDTH,
                height: MONUMENT_LARGE_FURNACE_HEIGHT,
            };
        }
        return {
            width: LARGE_FURNACE_WIDTH,
            height: LARGE_FURNACE_HEIGHT,
        };
    },

    calculateDrawPosition: (entity, drawWidth, drawHeight) => {
        // Use compound monument Y offset if this is a compound monument furnace
        const yOffset = isCompoundMonument(entity.isMonument, entity.posX, entity.posY) ? MONUMENT_LARGE_FURNACE_RENDER_Y_OFFSET : LARGE_FURNACE_RENDER_Y_OFFSET;
        return {
            // Top-left corner for image drawing, originating from entity's base Y
            // Apply Y offset to better align with collision area
            drawX: entity.posX - drawWidth / 2,
            drawY: entity.posY - drawHeight - yOffset,
        };
    },

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

            // Compound monument furnaces are larger (480px) so need larger shadow pivot offset
            const isCompound = isCompoundMonument(entity.isMonument, entity.posX, entity.posY);
            const shadowPivotOffset = isCompound ? 50 : 80; // Monument image was lowered, shadow pivot adjusted to match
            
            // NOON FIX: Only apply noon shadow push for non-compound-monument furnaces.
            // Compound monument furnaces are wide ground-level structures where the noon push
            // causes the shadow to detach upward unnaturally.
            let noonExtraOffset = 0;
            if (!isCompound && cycleProgress >= 0.35 && cycleProgress < 0.55) {
                const noonT = (cycleProgress - 0.35) / 0.20;
                const noonFactor = 1.0 - Math.abs(noonT - 0.5) * 2.0;
                noonExtraOffset = noonFactor * imageDrawHeight * 0.3;
            }

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
                shadowBlur: 3,         // Standardized to match other large objects
                pivotYOffset: shadowPivotOffset + noonExtraOffset,
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

    // Health bar rendered separately via renderEntityHealthBar
    drawOverlay: undefined,

    fallbackColor: '#8B4513', // Sienna brown fallback
};

// Preload all furnace images
imageManager.preloadImage(furnaceImage);
imageManager.preloadImage(furnaceOnImage);
imageManager.preloadImage(largeFurnaceImage);
imageManager.preloadImage(largeFurnaceOnImage);

// --- Helper function to get furnace dimensions based on type ---
// isCompoundMonumentFlag: true only for compound monument furnaces (ALK-specific large rendering)
export function getFurnaceDimensions(furnaceType: number, isCompoundMonumentFlag?: boolean): { width: number; height: number; yOffset: number } {
    if (furnaceType === FURNACE_TYPE_LARGE) {
        // Compound monument large furnaces render at warehouse size (480x480)
        if (isCompoundMonumentFlag) {
            return {
                width: MONUMENT_LARGE_FURNACE_WIDTH,
                height: MONUMENT_LARGE_FURNACE_HEIGHT,
                yOffset: MONUMENT_LARGE_FURNACE_RENDER_Y_OFFSET,
            };
        }
        return {
            width: LARGE_FURNACE_WIDTH,
            height: LARGE_FURNACE_HEIGHT,
            yOffset: LARGE_FURNACE_RENDER_Y_OFFSET,
        };
    }
    return {
        width: FURNACE_WIDTH,
        height: FURNACE_HEIGHT,
        yOffset: FURNACE_RENDER_Y_OFFSET,
    };
}

// --- Rendering Function ---
export function renderFurnace(
    ctx: CanvasRenderingContext2D, 
    furnace: Furnace, 
    nowMs: number, 
    cycleProgress: number,
    onlyDrawShadow?: boolean,
    skipDrawingShadow?: boolean,
    playerX?: number,
    playerY?: number,
    localPlayerPosition?: { x: number; y: number } | null // Player position for transparency logic
) {
    // Select config based on furnace type
    const config = furnace.furnaceType === FURNACE_TYPE_LARGE ? largeFurnaceConfig : furnaceConfig;
    const dimensions = getFurnaceDimensions(furnace.furnaceType, isCompoundMonument(furnace.isMonument, furnace.posX, furnace.posY));
    
    // ===== OCCLUSION TRANSPARENCY FOR LARGE FURNACES =====
    // Large furnaces can occlude the player - apply transparency when player is behind
    // Monument furnaces are 480px tall, regular large furnaces are 256px tall
    // Same pattern as signal disruptor / ward transparency in lanternRenderingUtils.ts
    const isLargeFurnace = furnace.furnaceType === FURNACE_TYPE_LARGE;
    const MIN_ALPHA = 0.35;
    const MAX_ALPHA = 1.0;
    let furnaceAlpha = MAX_ALPHA;
    
    if (isLargeFurnace && localPlayerPosition && !onlyDrawShadow) {
        // Use portion of sprite for actual building bounds
        const visualWidth = dimensions.width * 0.5;   // ~50% of sprite width is building
        const visualHeight = dimensions.height * 0.7;  // ~70% of sprite height is building
        
        // Dynamic threshold based on height
        const BASE_TRANSPARENCY_THRESHOLD_PERCENT = 0.25;
        const dynamicThreshold = visualHeight * BASE_TRANSPARENCY_THRESHOLD_PERCENT;
        
        // Furnace is drawn with bottom-center at posX, posY (with Y offset)
        const furnaceLeft = furnace.posX - visualWidth / 2;
        const furnaceRight = furnace.posX + visualWidth / 2;
        const furnaceTop = furnace.posY - visualHeight - dimensions.yOffset;
        const furnaceBottom = furnace.posY - dynamicThreshold - dimensions.yOffset;
        
        // Player bounding box (approximate)
        const playerSize = 48;
        const pLeft = localPlayerPosition.x - playerSize / 2;
        const pRight = localPlayerPosition.x + playerSize / 2;
        const pTop = localPlayerPosition.y - playerSize;
        const pBottom = localPlayerPosition.y;
        
        // Check if player overlaps with furnace visual area
        const overlapsH = pRight > furnaceLeft && pLeft < furnaceRight;
        const overlapsV = pBottom > furnaceTop && pTop < furnaceBottom;
        
        // Furnace should be transparent if it overlaps player and renders after player (Y-sort)
        if (overlapsH && overlapsV && furnace.posY > localPlayerPosition.y + dynamicThreshold) {
            const depthDifference = furnace.posY - localPlayerPosition.y;
            const maxDepthForFade = 100;
            
            if (depthDifference > 0 && depthDifference < maxDepthForFade) {
                const fadeFactor = 1 - (depthDifference / maxDepthForFade);
                furnaceAlpha = MAX_ALPHA - (fadeFactor * (MAX_ALPHA - MIN_ALPHA));
                furnaceAlpha = Math.max(MIN_ALPHA, Math.min(MAX_ALPHA, furnaceAlpha));
            } else if (depthDifference >= maxDepthForFade) {
                furnaceAlpha = MIN_ALPHA;
            }
        }
    }
    
    // Apply transparency if needed
    const needsTransparency = furnaceAlpha < MAX_ALPHA;
    if (needsTransparency) {
        ctx.save();
        ctx.globalAlpha = furnaceAlpha;
    }
    
    renderConfiguredGroundEntity({
        ctx,
        entity: furnace,
        config,
        nowMs,
        entityPosX: furnace.posX,
        entityPosY: furnace.posY,
        cycleProgress,
        onlyDrawShadow,
        skipDrawingShadow
    });
    
    // Restore context if transparency was applied
    if (needsTransparency) {
        ctx.restore();
    }
    
    // Health bar rendered via renderHealthBarOverlay (on top of world objects)
} 

 
