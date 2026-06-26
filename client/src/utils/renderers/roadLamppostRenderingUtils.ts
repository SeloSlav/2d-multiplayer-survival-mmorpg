/**
 * Road Lamppost Rendering - Aleutian whale oil lampposts along dirt roads
 * Renders the carved wooden lamppost sprite with dynamic ground shadow.
 * Light emission at night is handled in lightRenderingUtils and DayNightCycleRuntime.
 * Uses genericGroundRenderer pattern (like cairn, basalt column) for reliable loading and shadows.
 */

import { RoadLamppost } from '../../generated/types';
import roadLampImage from '../../assets/doodads/road_lamp.png';
import roadLampOffImage from '../../assets/doodads/road_lamp_off.png';
import { drawDynamicGroundShadow } from './shadowUtils';
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer';
import { imageManager } from './imageManager';
import { isNightTime } from '../../config/dayNightConstants';

export const ROAD_LAMP_WIDTH = 128;
export const ROAD_LAMP_HEIGHT = 192;
export const ROAD_LAMP_Y_OFFSET = 24; // Anchor at base, sprite extends up
export const ROAD_LAMP_LIGHT_Y_OFFSET = -80; // Light center is above the lantern (in sprite)
export const ROAD_LAMP_LIGHT_RADIUS_BASE = 90; // Same as lantern - whale oil glow (CAMPFIRE * 0.6)

// Store cycleProgress for getImageSource (called from config)
let currentCycleProgress = 0;

const roadLamppostConfig: GroundEntityConfig<RoadLamppost> = {
    getImageSource: (entity) => {
        return isNightTime(currentCycleProgress) ? roadLampImage : roadLampOffImage;
    },

    getTargetDimensions: (_img, _entity) => ({
        width: ROAD_LAMP_WIDTH,
        height: ROAD_LAMP_HEIGHT,
    }),

    calculateDrawPosition: (entity, drawWidth, drawHeight) => ({
        drawX: entity.posX - drawWidth / 2,
        // Sprite base at posY; extends upward (anchor at base, sprite extends up)
        drawY: entity.posY - drawHeight - ROAD_LAMP_Y_OFFSET,
    }),

    getShadowParams: undefined,

    drawCustomGroundShadow: (ctx, entity, entityImage, entityPosX, entityPosY, imageDrawWidth, imageDrawHeight, cycleProgress) => {
        drawDynamicGroundShadow({
            ctx,
            entityImage,
            entityCenterX: entityPosX,
            entityBaseY: entityPosY,
            imageDrawWidth,
            imageDrawHeight,
            cycleProgress,
            maxShadowAlpha: 0.3,
            maxStretchFactor: 1.8,
            minStretchFactor: 0.2,
            pivotYOffset: ROAD_LAMP_Y_OFFSET, // Align shadow with lamp base (sprite bottom at posY - 24)
        });
    },

    applyEffects: undefined,
    drawOverlay: undefined,
    fallbackColor: '#5C4033', // Dark brown fallback
};

/**
 * Render a single Aleutian whale oil road lamppost
 * Uses genericGroundRenderer for reliable image loading and dynamic ground shadow.
 * Occlusion transparency when player is behind (same as trees, basalt columns).
 */
export function renderRoadLamppost(
    ctx: CanvasRenderingContext2D,
    lamppost: RoadLamppost,
    _cameraOffsetX: number, // Unused - canvas already translated (same as cairn)
    _cameraOffsetY: number, // Unused - canvas already translated
    nowMs: number = Date.now(),
    cycleProgress: number = 0,
    localPlayerPosition?: { x: number; y: number } | null
): void {
    currentCycleProgress = cycleProgress;

    // Occlusion transparency when player is behind lamppost (same pattern as trees/basalt)
    const MIN_ALPHA = 0.3;
    const MAX_ALPHA = 1.0;
    let lamppostAlpha = MAX_ALPHA;

    if (localPlayerPosition) {
        // Narrow pole - use ~35% of sprite width for occlusion (actual pole, not lantern edges)
        const occlusionWidth = ROAD_LAMP_WIDTH * 0.35; // ~45px
        const occlusionHeight = ROAD_LAMP_HEIGHT + ROAD_LAMP_Y_OFFSET; // Full sprite height

        const lamppostLeft = lamppost.posX - occlusionWidth / 2;
        const lamppostRight = lamppost.posX + occlusionWidth / 2;
        const lamppostTop = lamppost.posY - occlusionHeight;
        const lamppostBottom = lamppost.posY;

        const playerSize = 48;
        const playerLeft = localPlayerPosition.x - playerSize / 2;
        const playerRight = localPlayerPosition.x + playerSize / 2;
        const playerTop = localPlayerPosition.y - playerSize;
        const playerBottom = localPlayerPosition.y;

        const overlapsHorizontally = playerRight > lamppostLeft && playerLeft < lamppostRight;
        const overlapsVertically = playerBottom > lamppostTop && playerTop < lamppostBottom;

        if (overlapsHorizontally && overlapsVertically && lamppost.posY > localPlayerPosition.y) {
            const depthDifference = lamppost.posY - localPlayerPosition.y;
            const maxDepthForFade = 80;

            if (depthDifference > 0 && depthDifference < maxDepthForFade) {
                const fadeFactor = 1 - (depthDifference / maxDepthForFade);
                lamppostAlpha = MAX_ALPHA - (fadeFactor * (MAX_ALPHA - MIN_ALPHA));
                lamppostAlpha = Math.max(MIN_ALPHA, Math.min(MAX_ALPHA, lamppostAlpha));
            } else if (depthDifference >= maxDepthForFade) {
                lamppostAlpha = MIN_ALPHA;
            }
        }
    }

    const needsTransparency = lamppostAlpha < MAX_ALPHA;
    if (needsTransparency) {
        ctx.save();
        ctx.globalAlpha = lamppostAlpha;
    }

    renderConfiguredGroundEntity({
        ctx,
        entity: lamppost,
        config: roadLamppostConfig,
        nowMs,
        entityPosX: lamppost.posX,
        entityPosY: lamppost.posY,
        cycleProgress,
    });

    if (needsTransparency) {
        ctx.restore();
    }
}

/**
 * Preload road lamppost images (day and night variants)
 */
export function preloadRoadLamppostImages(): void {
    imageManager.preloadImage(roadLampImage);
    imageManager.preloadImage(roadLampOffImage);
}
