import { Turret } from '../../generated/types';
import turretTallowImage from '../../assets/doodads/turret_tallow.png';
import alkTurretImage from '../../assets/doodads/alk_turret.png';
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer';
import { drawDynamicGroundShadow, calculateShakeOffsets } from './shadowUtils';
import { imageManager } from './imageManager';

// === TURRET TYPE CONSTANTS ===
// Must match server-side constants in turret.rs
export const TURRET_TYPE_TALLOW_STEAM = 0;

// --- Constants directly used by this module or exported ---
export const TURRET_WIDTH = 256;
export const TURRET_HEIGHT = 256;
export const TURRET_WIDTH_PREVIEW = 256;
export const TURRET_HEIGHT_PREVIEW = 256;

// Monument turrets render at 2x size
export const MONUMENT_TURRET_SCALE = 2.0;
export const MONUMENT_TURRET_WIDTH = TURRET_WIDTH * MONUMENT_TURRET_SCALE;
export const MONUMENT_TURRET_HEIGHT = TURRET_HEIGHT * MONUMENT_TURRET_SCALE;

// No Y offset needed - turret sprite is centered on posX/posY
export const TURRET_RENDER_Y_OFFSET = 0; // Sprite centered on entity position

// Turret interaction distance (player <-> turret) - larger for 256x256 sprite
export const PLAYER_TURRET_INTERACTION_DISTANCE_SQUARED = 200.0 * 200.0; // Larger range for big turret

// Turret height for interaction calculations
export const TURRET_HEIGHT_FOR_INTERACTION = 256;

// --- Other Local Constants ---
const SHAKE_DURATION_MS = 150;
const SHAKE_INTENSITY_PX = 6;

// --- Client-side animation tracking for turret shakes ---
const clientTurretShakeStartTimes = new Map<string, number>();
const lastKnownServerTurretShakeTimes = new Map<string, number>();

// --- Define Configuration ---
const turretConfig: GroundEntityConfig<Turret> = {
    getImageSource: (entity) => {
        if (entity.isDestroyed) {
            return null;
        }
        
        // Monument turrets use the ALK turret sprite
        if (entity.isMonument) {
            return alkTurretImage;
        }
        
        // Player-placed turrets
        switch (entity.turretType) {
            case TURRET_TYPE_TALLOW_STEAM:
            default:
                return turretTallowImage;
        }
    },

    getTargetDimensions: (_img, entity) => {
        // Monument turrets render at 2x size
        if (entity.isMonument) {
            return { width: MONUMENT_TURRET_WIDTH, height: MONUMENT_TURRET_HEIGHT };
        }
        return { width: TURRET_WIDTH, height: TURRET_HEIGHT };
    },

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        drawX: entity.posX - drawWidth / 2,
        drawY: entity.posY - drawHeight / 2, // Centered on entity position
    }),

    getShadowParams: undefined,

    drawCustomGroundShadow: (ctx, entity, entityImage, entityPosX, entityPosY, imageDrawWidth, imageDrawHeight, cycleProgress) => {
        if (!entity.isDestroyed) {
            const { shakeOffsetX, shakeOffsetY } = calculateShakeOffsets(
                entity,
                entity.id.toString(),
                {
                    clientStartTimes: clientTurretShakeStartTimes,
                    lastKnownServerTimes: lastKnownServerTurretShakeTimes
                },
                SHAKE_DURATION_MS,
                SHAKE_INTENSITY_PX
            );
            
            // Centered sprite - shadow at bottom half of sprite
            drawDynamicGroundShadow({
                ctx,
                entityImage,
                entityCenterX: entityPosX,
                entityBaseY: entityPosY + imageDrawHeight / 4, // Shadow at lower portion of centered sprite
                imageDrawWidth,
                imageDrawHeight,
                cycleProgress,
                baseShadowColor: '0,0,0',
                maxShadowAlpha: 0.35,
                shadowBlur: 3,
                maxStretchFactor: 1.1,
                minStretchFactor: 0.15,
                pivotYOffset: 0,
                shakeOffsetX,
                shakeOffsetY
            });
        }
    },

    // Health bar rendered separately via renderEntityHealthBar (after entity rendering)
    drawOverlay: undefined,
};

/**
 * Render a turret entity
 */
export function renderTurret(
    ctx: CanvasRenderingContext2D,
    turret: Turret,
    cameraOffsetX: number,
    cameraOffsetY: number,
    cycleProgress: number,
    playerX?: number,
    playerY?: number,
    localPlayerPosition?: { x: number; y: number } | null
): void {
    const nowMs = performance.now();
    const entityPosX = turret.posX - cameraOffsetX;
    const entityPosY = turret.posY - cameraOffsetY;
    
    // ===== OCCLUSION TRANSPARENCY FOR ALL TURRETS =====
    // Turrets are large center-anchored objects (256x256 regular, 512x512 monument).
    // When the player walks behind them, they fade to allow visibility.
    // NOTE: Turret sprites are CENTER-anchored (posX/posY = center of sprite),
    // unlike furnaces/buildings which are bottom-anchored. This changes the math.
    const MIN_ALPHA = 0.35;
    const MAX_ALPHA = 1.0;
    let turretAlpha = MAX_ALPHA;
    
    if (localPlayerPosition) {
        const isMonument = turret.isMonument;
        const drawWidth = isMonument ? MONUMENT_TURRET_WIDTH : TURRET_WIDTH;
        const drawHeight = isMonument ? MONUMENT_TURRET_HEIGHT : TURRET_HEIGHT;
        
        // Turret structure fills most of the sprite - use generous overlap area
        const visualWidth = drawWidth * 0.85;    // Turret body is wide
        const visualHeight = drawHeight * 0.80;  // Most of the sprite is solid structure
        
        // Turret sprite is CENTER-anchored on posX/posY
        // The top of the visual area is above center, bottom is below
        const turretLeft = turret.posX - visualWidth / 2;
        const turretRight = turret.posX + visualWidth / 2;
        const turretTop = turret.posY - visualHeight / 2;
        const turretBottom = turret.posY + visualHeight / 2;
        
        // Player bounding box (approximate)
        const playerSize = 48;
        const pLeft = localPlayerPosition.x - playerSize / 2;
        const pRight = localPlayerPosition.x + playerSize / 2;
        const pTop = localPlayerPosition.y - playerSize;
        const pBottom = localPlayerPosition.y;
        
        // Check if player overlaps with turret visual area horizontally
        const overlapsH = pRight > turretLeft && pLeft < turretRight;
        // Check if player's body overlaps with the upper portion of the turret
        // (the part that occludes them when they're "behind" it)
        const overlapsV = pBottom > turretTop && pTop < turretBottom;
        
        // Y-sort point is posY + 40 for turrets. The turret renders in front of
        // the player when turret's Y-sort > player's Y. So occlusion happens when
        // the player is ABOVE (lower Y) than the turret's Y-sort point.
        // Use a small threshold so transparency kicks in as soon as the player
        // is anywhere behind the turret structure.
        const ySortOffset = 40; // Must match the Y-sort offset in EntityFilteringRuntime
        const turretSortY = turret.posY + ySortOffset;
        
        if (overlapsH && overlapsV && turretSortY > localPlayerPosition.y) {
            // How far behind the turret is the player? More depth = more transparent
            const depthDifference = turretSortY - localPlayerPosition.y;
            const maxDepthForFade = isMonument ? 200 : 120;
            
            if (depthDifference > 0 && depthDifference < maxDepthForFade) {
                // Smooth fade: closer to turret base = more opaque, further behind = more transparent
                const fadeFactor = depthDifference / maxDepthForFade;
                turretAlpha = MAX_ALPHA - (fadeFactor * (MAX_ALPHA - MIN_ALPHA));
                turretAlpha = Math.max(MIN_ALPHA, Math.min(MAX_ALPHA, turretAlpha));
            } else if (depthDifference >= maxDepthForFade) {
                turretAlpha = MIN_ALPHA;
            }
        }
    }
    
    // Apply transparency if needed
    const needsTransparency = turretAlpha < MAX_ALPHA;
    if (needsTransparency) {
        ctx.save();
        ctx.globalAlpha = turretAlpha;
    }
    
    renderConfiguredGroundEntity({
        ctx,
        entity: turret,
        config: turretConfig,
        nowMs,
        entityPosX,
        entityPosY,
        cycleProgress
    });
    
    // Restore context if transparency was applied
    if (needsTransparency) {
        ctx.restore();
    }
    
    // Health bar rendered via renderHealthBarOverlay (on top of world objects)
    // Monument turrets are indestructible - overlay skips them
}

/**
 * Get turret dimensions for a given turret type (optionally accounting for monument scale)
 */
export function getTurretDimensions(turretType: number, isMonument?: boolean): { width: number; height: number } {
    if (isMonument) {
        return { width: MONUMENT_TURRET_WIDTH, height: MONUMENT_TURRET_HEIGHT };
    }
    switch (turretType) {
        case TURRET_TYPE_TALLOW_STEAM:
        default:
            return { width: TURRET_WIDTH, height: TURRET_HEIGHT };
    }
}
