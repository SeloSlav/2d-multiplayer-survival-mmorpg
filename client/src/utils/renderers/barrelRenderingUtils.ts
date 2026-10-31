/**
 * barrelRenderingUtils - Barrel, sea flotsam, and buoy rendering.
 *
 * Renders barrel entities (road barrels, sea flotsam/cargo crates, buoys) with
 * variant-specific sprites, shadows, and optional water overlay for sea variants.
 * Supports client-side shake on hit for responsive feedback.
 *
 * Responsibilities:
 * 1. VARIANT RENDERING: Variants 0-2 (road), 3-5 (sea), 6 (buoy). Uses
 *    genericGroundRenderer for consistent shadow and positioning.
 *
 * 2. SEA EFFECTS: Sea variants (3-6) get water overlay, sway, and bob animation.
 *    Buoy (6) is indestructible and rendered larger.
 *
 * 3. SHAKE: triggerBarrelShakeOptimistic for immediate hit feedback. Syncs
 *    with server shake timestamps to avoid double-shake.
 *
 * 4. INTERACTION: PLAYER_BARREL_INTERACTION_DISTANCE_SQUARED for E-key targeting.
 */

import { Barrel } from '../../generated/types'; // Import generated type
import { combatCoverProfile } from '../../config/combatCover';
import barrelImage from '../../assets/doodads/barrel.png'; // Variant 0
import barrel2Image from '../../assets/doodads/barrel2.png'; // Variant 1 
import barrel3Image from '../../assets/doodads/barrel3.png'; // Variant 2
// Sea barrel variants (flotsam/cargo crates) - variants 3, 4, 5
// TODO: Add actual sea barrel images when available
// For now, using road barrel images as placeholders
import seaBarrelImage from '../../assets/doodads/barrel4.png'; // Variant 3 (placeholder)
import seaBarrel2Image from '../../assets/doodads/barrel5.png'; // Variant 4 (placeholder)
import seaBarrel3Image from '../../assets/doodads/barrel6.png'; // Variant 5 (placeholder)
import buoyImage from '../../assets/doodads/buoy.png'; // Variant 6 (indestructible buoy)
import { drawDynamicGroundShadow, calculateShakeOffsets } from './shadowUtils';
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer'; // Import generic renderer
import { imageManager } from './imageManager'; // Import image manager
import { renderCyberpunkAssetPlaceholder } from './cyberpunkAssetPlaceholder';
import { isNightTime } from '../../config/dayNightConstants';
import { worldPosToTileKey } from './placementRenderingUtils';

// --- Constants --- (Keep exportable if used elsewhere)
export const BARREL_WIDTH = 86; // Standard barrel size (increased from 72)
export const BARREL_HEIGHT = 86;
export const BARREL5_WIDTH = 172; // Variant 4 (barrel5.png) rendered at larger size
export const BARREL5_HEIGHT = 172;
export const BUOY_WIDTH = 192; // Variant 6 (buoy) - large navigational marker (~4x player height)
export const BUOY_HEIGHT = 192;
export const PLAYER_BARREL_INTERACTION_DISTANCE_SQUARED = 64.0 * 64.0; // Barrel interaction distance
const SHAKE_DURATION_MS = 150; 
const SHAKE_INTENSITY_PX = 4; // Subtle shake for barrels
// --- Barrel Variant Images Array ---
// Variants 0-2: Road barrels
// Variants 3-5: Sea barrels (flotsam/cargo crates)
// Variant 6: Buoy (indestructible, outer ocean)
const BARREL_VARIANT_IMAGES = [
    barrelImage,       // Variant 0 (road barrel)
    barrel2Image,      // Variant 1 (road barrel)
    barrel3Image,      // Variant 2 (road barrel)
    seaBarrelImage,    // Variant 3 (sea flotsam/cargo crate - placeholder)
    seaBarrel2Image,   // Variant 4 (sea flotsam/cargo crate - placeholder)
    seaBarrel3Image,   // Variant 5 (sea flotsam/cargo crate - placeholder)
    buoyImage,         // Variant 6 (indestructible buoy)
];

// Constants for sea barrel variants (water overlay, sway, bob)
const SEA_BARREL_VARIANT_START = 3;
const SEA_BARREL_VARIANT_END = 7; // Exclusive end (3, 4, 5, 6 - includes buoy)

// Road barrels on water: water line position offset (right = +X, down = +Y)
const ROAD_BARREL_WATER_LINE_X_OFFSET = 60;
const ROAD_BARREL_WATER_LINE_Y_OFFSET = 12;

// --- Client-side animation tracking for barrel shakes ---
const clientBarrelShakeStartTimes = new Map<string, number>(); // barrelId -> client timestamp when shake started
const lastKnownServerBarrelShakeTimes = new Map<string, number>();

/** Trigger barrel shake immediately (optimistic feedback) when player initiates a hit. */
export function triggerBarrelShakeOptimistic(barrelId: string): void {
  const now = Date.now();
  clientBarrelShakeStartTimes.set(barrelId, now);
}

// --- Define Configuration --- 
const barrelConfig: GroundEntityConfig<Barrel> = {
    getImageSource: (entity) => {
        // Don't render if respawning (respawnAt > 0 means barrel is destroyed)
        if (entity.respawnAt && entity.respawnAt.microsSinceUnixEpoch !== 0n) {
            return null;
        }
        
        // Select barrel variant based on entity.variant field
        // Variants 0-2: Road barrels, Variants 3-5: Sea barrels (flotsam/cargo crates)
        const variantIndex = (entity.variant ?? 0);
        if (variantIndex < BARREL_VARIANT_IMAGES.length) {
            return BARREL_VARIANT_IMAGES[variantIndex];
        }
        // Fallback to variant 0 if invalid variant
        return BARREL_VARIANT_IMAGES[0];
    },

    getTargetDimensions: (img, entity) => {
        const variantIndex = Number(entity.variant ?? 0);
        if (variantIndex === 4) {
            return { width: BARREL5_WIDTH, height: BARREL5_HEIGHT };
        }
        if (variantIndex === 6) {
            return { width: BUOY_WIDTH, height: BUOY_HEIGHT };
        }
        return {
            width: BARREL_WIDTH,
            height: BARREL_HEIGHT,
        };
    },

    calculateDrawPosition: (entity, drawWidth, drawHeight) => {
        const variantIndex = Number(entity.variant ?? 0);
        const yOffset = variantIndex === 4 ? 24 : variantIndex === 6 ? 28 : 12; // Buoy (6) 192px, large barrel (4)
        return {
            drawX: entity.posX - drawWidth / 2,
            drawY: entity.posY - drawHeight - yOffset, // Slight Y adjustment for centering
        };
    },

    getShadowParams: undefined,

    drawCustomGroundShadow: (ctx, entity, entityImage, entityPosX, entityPosY, imageDrawWidth, imageDrawHeight, cycleProgress) => {
        // Draw NORMAL dynamic ground shadow for barrels on land (road barrels + sea barrels on beach)
        // Sea barrels on water use special shadow in renderSeaBarrelWithWaterEffects
        if (!entity.respawnAt || entity.respawnAt.microsSinceUnixEpoch === 0n) {
            const { shakeOffsetX, shakeOffsetY } = calculateShakeOffsets(
                entity,
                entity.id.toString(),
                {
                    clientStartTimes: clientBarrelShakeStartTimes,
                    lastKnownServerTimes: lastKnownServerBarrelShakeTimes
                },
                SHAKE_DURATION_MS,
                SHAKE_INTENSITY_PX,
                undefined,
                { suppressRestartIfRecentClientShake: true }
            );

            const variantIndex = Number(entity.variant ?? 0);
            const pivotYOffsetBase = variantIndex === 4 ? 50 : variantIndex === 6 ? 55 : 35;
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
                pivotYOffset: pivotYOffsetBase + noonExtraOffset,
                shakeOffsetX,
                shakeOffsetY,
            });
        }
    },

    applyEffects: (ctx, entity, nowMs, baseDrawX, baseDrawY, cycleProgress) => {
        // Dynamic shadow is now handled in drawCustomGroundShadow
        // Use calculateShakeOffsets so shake starts from client detection time (not server time)
        // This ensures full shake on each hit regardless of network latency
        if (!entity.respawnAt || entity.respawnAt.microsSinceUnixEpoch === 0n) {
            const { shakeOffsetX, shakeOffsetY } = calculateShakeOffsets(
                entity,
                entity.id.toString(),
                {
                    clientStartTimes: clientBarrelShakeStartTimes,
                    lastKnownServerTimes: lastKnownServerBarrelShakeTimes
                },
                SHAKE_DURATION_MS,
                SHAKE_INTENSITY_PX,
                undefined,
                { suppressRestartIfRecentClientShake: true }
            );
            return { offsetX: shakeOffsetX, offsetY: shakeOffsetY };
        }
        return { offsetX: 0, offsetY: 0 };
    },

    drawOverlay: undefined,

    fallbackColor: '#8B4513', // Saddle brown for wooden barrel
};

// Preload all barrel variant images
BARREL_VARIANT_IMAGES.forEach(barrelImg => {
    imageManager.preloadImage(barrelImg);
});

// ============================================================================
// BARREL DESTRUCTION EFFECTS - Sprite chunks with radial explosion
// ============================================================================
// Recursively slices the barrel sprite across its mid-section (2D equivalent of
// 3D mesh slicing). Chunks get rigid-body-like physics and explode radially.

interface BarrelDestructionChunk {
    /** Source rect in barrel image (natural coords) */
    srcX: number;
    srcY: number;
    srcW: number;
    srcH: number;
    /** Draw size (matches source for 1:1 pixel art) */
    drawW: number;
    drawH: number;
    /** World position (center of chunk) */
    x: number;
    y: number;
    vx: number;
    vy: number;
    rotation: number;
    rotationSpeed: number;
    gravity: number;
}

interface BarrelDestructionEffect {
    barrelId: string;
    startTime: number;
    centerX: number;
    centerY: number;
    duration: number;
    chunks: BarrelDestructionChunk[];
    image: HTMLImageElement;
    variantIndex: number;
}

const activeBarrelDestructions = new Map<string, BarrelDestructionEffect>();
const previousBarrelHealthStates = new Map<string, boolean>();

const BARREL_DESTRUCTION_DURATION_MS = 1000;
const BARREL_CHUNK_SLICE_LEVELS = 2; // 2 levels = 4 chunks (2x2), 3 levels = 8 chunks

/**
 * Recursively slice a rect into chunks across mid-sections.
 * Alternates horizontal/vertical cuts for organic breakup.
 */
function sliceRectIntoChunks(
    x: number, y: number, w: number, h: number,
    level: number,
    maxLevel: number,
    out: Array<{ srcX: number; srcY: number; srcW: number; srcH: number }>
): void {
    if (level >= maxLevel || w < 8 || h < 8) {
        out.push({ srcX: x, srcY: y, srcW: w, srcH: h });
        return;
    }
    if (level % 2 === 0) {
        // Horizontal cut
        const mid = Math.floor(h / 2);
        sliceRectIntoChunks(x, y, w, mid, level + 1, maxLevel, out);
        sliceRectIntoChunks(x, y + mid, w, h - mid, level + 1, maxLevel, out);
    } else {
        // Vertical cut
        const mid = Math.floor(w / 2);
        sliceRectIntoChunks(x, y, mid, h, level + 1, maxLevel, out);
        sliceRectIntoChunks(x + mid, y, w - mid, h, level + 1, maxLevel, out);
    }
}

/**
 * Generate barrel chunks from sprite, with radial explosion velocities.
 */
function generateBarrelDestructionChunks(
    centerX: number,
    centerY: number,
    drawWidth: number,
    drawHeight: number,
    imgNaturalWidth: number,
    imgNaturalHeight: number
): BarrelDestructionChunk[] {
    const srcRects: Array<{ srcX: number; srcY: number; srcW: number; srcH: number }> = [];
    sliceRectIntoChunks(0, 0, drawWidth, drawHeight, 0, BARREL_CHUNK_SLICE_LEVELS, srcRects);

    const scaleX = imgNaturalWidth / drawWidth;
    const scaleY = imgNaturalHeight / drawHeight;
    const chunks: BarrelDestructionChunk[] = [];
    const baseSpeed = 4 + Math.random() * 4;
    const spriteTopY = centerY - drawHeight / 2;

    for (const rect of srcRects) {
        const chunkCenterX = centerX - drawWidth / 2 + rect.srcX + rect.srcW / 2;
        const chunkCenterY = spriteTopY + rect.srcY + rect.srcH / 2;
        const dx = chunkCenterX - centerX;
        const dy = chunkCenterY - centerY;
        const angle = Math.atan2(dy, dx);
        const speedVariation = 0.7 + Math.random() * 0.6;
        const speed = baseSpeed * speedVariation;

        chunks.push({
            srcX: rect.srcX * scaleX,
            srcY: rect.srcY * scaleY,
            srcW: rect.srcW * scaleX,
            srcH: rect.srcH * scaleY,
            drawW: rect.srcW,
            drawH: rect.srcH,
            x: chunkCenterX,
            y: chunkCenterY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 2 - Math.random() * 3,
            rotation: (Math.random() - 0.5) * 0.5,
            rotationSpeed: (Math.random() - 0.5) * 0.15,
            gravity: 0.22,
        });
    }
    return chunks;
}

export function hasActiveBarrelDestruction(barrelId: string): boolean {
    return activeBarrelDestructions.has(barrelId);
}

/**
 * Detect barrel destruction transition and trigger effect.
 * Call from entity filtering when iterating barrels.
 */
export function checkBarrelDestructionVisibility(barrel: Barrel): boolean {
    const variantIndex = Number(barrel.variant ?? 0);
    if (combatCoverProfile(variantIndex)) return false;
    if (variantIndex === 6) return false; // Buoy is indestructible

    const barrelId = barrel.id.toString();
    const isDestroyed = barrel.respawnAt && barrel.respawnAt.microsSinceUnixEpoch !== 0n;
    const wasHealthy = previousBarrelHealthStates.get(barrelId);

    if (activeBarrelDestructions.has(barrelId)) return true;

    if (wasHealthy === true && isDestroyed) {
        triggerBarrelDestructionEffect(barrel);
        return true;
    }

    previousBarrelHealthStates.set(barrelId, !isDestroyed);
    return false;
}

/**
 * Trigger barrel destruction effect.
 */
export function triggerBarrelDestructionEffect(barrel: Barrel): void {
    if (combatCoverProfile(Number(barrel.variant ?? 0))) return;
    const barrelId = barrel.id.toString();
    if (activeBarrelDestructions.has(barrelId)) return;

    const variantIndex = Number(barrel.variant ?? 0);
    const imageSource = BARREL_VARIANT_IMAGES[variantIndex] || BARREL_VARIANT_IMAGES[0];
    const img = imageManager.getImage(imageSource);
    if (!img || !img.complete || img.naturalWidth === 0) return;

    const drawWidth = variantIndex === 4 ? BARREL5_WIDTH : variantIndex === 6 ? BUOY_WIDTH : BARREL_WIDTH;
    const drawHeight = variantIndex === 4 ? BARREL5_HEIGHT : variantIndex === 6 ? BUOY_HEIGHT : BARREL_HEIGHT;
    const yOffset = variantIndex === 4 ? 24 : variantIndex === 6 ? 28 : 12;
    const centerX = barrel.posX;
    const centerY = barrel.posY - drawHeight / 2 - yOffset;

    const effect: BarrelDestructionEffect = {
        barrelId,
        startTime: Date.now(),
        centerX,
        centerY,
        duration: BARREL_DESTRUCTION_DURATION_MS,
        chunks: generateBarrelDestructionChunks(centerX, centerY, drawWidth, drawHeight, img.naturalWidth, img.naturalHeight),
        image: img,
        variantIndex,
    };

    activeBarrelDestructions.set(barrelId, effect);
}

const barrelDestructionEffectsToRemove: string[] = [];
const TWO_PI = Math.PI * 2;

/**
 * Render barrel destruction effects.
 */
export function renderBarrelDestructionEffects(ctx: CanvasRenderingContext2D, nowMs: number): void {
    if (activeBarrelDestructions.size === 0) return;

    barrelDestructionEffectsToRemove.length = 0;

    activeBarrelDestructions.forEach((effect, barrelId) => {
        const elapsed = nowMs - effect.startTime;
        const progress = elapsed / effect.duration;

        if (progress >= 1) {
            barrelDestructionEffectsToRemove.push(barrelId);
            return;
        }

        const fadeStart = 0.5;
        const fadeMultiplier = progress > fadeStart ? 1 - (progress - fadeStart) / (1 - fadeStart) : 1;

        for (const chunk of effect.chunks) {
            chunk.vy += chunk.gravity;
            chunk.x += chunk.vx;
            chunk.y += chunk.vy;
            chunk.rotation += chunk.rotationSpeed;
            chunk.vx *= 0.98;

            const alpha = fadeMultiplier;
            if (alpha < 0.02) continue;

            ctx.save();
            ctx.translate(chunk.x, chunk.y);
            ctx.rotate(chunk.rotation);
            ctx.globalAlpha = alpha;
            ctx.drawImage(
                effect.image,
                chunk.srcX, chunk.srcY, chunk.srcW, chunk.srcH,
                -chunk.drawW / 2, -chunk.drawH / 2, chunk.drawW, chunk.drawH
            );
            ctx.restore();
        }
    });

    for (let i = 0; i < barrelDestructionEffectsToRemove.length; i++) {
        activeBarrelDestructions.delete(barrelDestructionEffectsToRemove[i]);
        previousBarrelHealthStates.delete(barrelDestructionEffectsToRemove[i]);
    }
}

export function cleanupBarrelDestructionEffect(barrelId: string): void {
    activeBarrelDestructions.delete(barrelId);
    previousBarrelHealthStates.delete(barrelId);
}

// === SEA BARREL WATER EFFECTS CONFIGURATION ===
// Exported for use by dropped items and other entities that float on water
export const SEA_BARREL_WATER_CONFIG = {
    // Water line position (fraction of sprite height from top)
    WATER_LINE_OFFSET: 0.55, // 55% down from top = barrel sits about halfway in water
    // Wave animation for water line
    WAVE_AMPLITUDE: 1.5, // Gentle wave movement
    WAVE_FREQUENCY: 0.003, // Slow wave frequency
    WAVE_SECONDARY_AMPLITUDE: 0.8,
    WAVE_SECONDARY_FREQUENCY: 0.005,
    // Swaying animation
    SWAY_AMPLITUDE: 0.015, // Very gentle rotation (radians) - about 0.86 degrees
    SWAY_FREQUENCY: 0.0008, // Slow, peaceful swaying
    SWAY_SECONDARY_FREQUENCY: 0.0012, // Secondary sway for organic feel
    // Bobbing animation (vertical)
    BOB_AMPLITUDE: 1.5, // Slight vertical bob in pixels
    BOB_FREQUENCY: 0.0015, // Slow bob
    // Underwater tint
    UNDERWATER_TINT_COLOR: { r: 12, g: 62, b: 79 },
    UNDERWATER_TINT_INTENSITY: 0.35,
};

/**
 * Checks if a barrel variant is a sea barrel
 */
function isSeaBarrelVariant(variantIndex: number): boolean {
    return variantIndex >= SEA_BARREL_VARIANT_START && variantIndex < SEA_BARREL_VARIANT_END;
}

// Cached offscreen canvas for barrel tinting (reused to avoid allocations)
let barrelOffscreenCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let barrelOffscreenCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function getBarrelOffscreenCanvas(width: number, height: number): { canvas: OffscreenCanvas | HTMLCanvasElement, ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
    if (!barrelOffscreenCanvas || barrelOffscreenCanvas.width < width || barrelOffscreenCanvas.height < height) {
        // Release GPU memory from old canvas before creating new one
        if (barrelOffscreenCanvas) { barrelOffscreenCanvas.width = 0; barrelOffscreenCanvas.height = 0; }
        try {
            barrelOffscreenCanvas = new OffscreenCanvas(width, height);
        } catch {
            barrelOffscreenCanvas = document.createElement('canvas');
            barrelOffscreenCanvas.width = width;
            barrelOffscreenCanvas.height = height;
        }
        barrelOffscreenCtx = barrelOffscreenCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    }
    return { canvas: barrelOffscreenCanvas, ctx: barrelOffscreenCtx! };
}

/**
 * Renders ONLY the water shadow for a barrel on water (sea barrels or road barrels near coast).
 * Called in an early pass so swimming player bottom halves render ON TOP of it.
 * Skips when shadow is CAST on sea transition tiles (Beach/Sea, Beach/HotSpringWater, Asphalt/Sea) - same as player swimming shadow.
 */
export function renderSeaBarrelWaterShadowOnly(
    ctx: CanvasRenderingContext2D,
    barrel: Barrel,
    nowMs: number,
    cycleProgress: number,
    isOnSeaTile?: (worldX: number, worldY: number) => boolean,
    seaTransitionTileLookup?: Map<string, boolean>
): void {
    if (barrel.respawnAt && barrel.respawnAt.microsSinceUnixEpoch !== 0n) return;
    if (hasActiveBarrelDestruction(barrel.id.toString())) return;
    const variantIndex = Number(barrel.variant ?? 0);
    // Only draw water shadow when barrel is actually on a sea tile (sea barrels on beach use normal ground shadow)
    if (!isOnSeaTile || !isOnSeaTile(barrel.posX, barrel.posY)) return;
    // Skip when barrel itself is on a transition tile (straddling water/beach boundary)
    if (seaTransitionTileLookup?.get(worldPosToTileKey(barrel.posX, barrel.posY))) return;

    const imageSource = BARREL_VARIANT_IMAGES[variantIndex] || BARREL_VARIANT_IMAGES[0];
    const img = imageManager.getImage(imageSource);
    if (!img || !img.complete || img.naturalWidth === 0) return;

    const drawWidth = variantIndex === 4 ? BARREL5_WIDTH : variantIndex === 6 ? BUOY_WIDTH : BARREL_WIDTH;
    const drawHeight = variantIndex === 4 ? BARREL5_HEIGHT : variantIndex === 6 ? BUOY_HEIGHT : BARREL_HEIGHT;
    const yOffset = variantIndex === 4 ? 24 : variantIndex === 6 ? 28 : 12;
    const isRoadBarrelOnWater = variantIndex < SEA_BARREL_VARIANT_START;
    const bobOffset = Math.sin(nowMs * SEA_BARREL_WATER_CONFIG.BOB_FREQUENCY + barrel.posX * 0.02)
        * SEA_BARREL_WATER_CONFIG.BOB_AMPLITUDE;
    const baseX = barrel.posX;
    const baseY = barrel.posY + bobOffset;
    const centerY = barrel.posY - drawHeight / 2 - yOffset;
    const shadowOffsetX = drawWidth * 0.28;
    const shadowOffsetY = drawHeight * 0.9;
    const shadowX = baseX + shadowOffsetX;
    const shadowY = centerY + shadowOffsetY;

    // Skip when shadow overlaps transition tiles - shadow extends across multiple tiles, sample key points
    if (seaTransitionTileLookup && seaTransitionTileLookup.size > 0) {
        const shadowExtentX = drawWidth * 0.5; // Shadow extends ~half width from center
        const shadowExtentY = drawHeight * 0.5;
        const samplePoints = [
            [shadowX, shadowY],
            [shadowX + shadowExtentX, shadowY],
            [shadowX, shadowY + shadowExtentY],
            [shadowX + shadowExtentX, shadowY + shadowExtentY],
        ];
        for (const [px, py] of samplePoints) {
            if (seaTransitionTileLookup.get(worldPosToTileKey(px, py))) return;
        }
    }

    const { shakeOffsetX, shakeOffsetY } = calculateShakeOffsets(
        barrel, barrel.id.toString(),
        { clientStartTimes: clientBarrelShakeStartTimes, lastKnownServerTimes: lastKnownServerBarrelShakeTimes },
        SHAKE_DURATION_MS, SHAKE_INTENSITY_PX, undefined,
        { suppressRestartIfRecentClientShake: true }
    );

    ctx.save();
    ctx.translate(shadowX, shadowY);
    ctx.scale(0.85, 0.75);
    ctx.rotate(Math.PI / 6 + (isRoadBarrelOnWater ? Math.PI / 2 : 0));
    ctx.translate(-shadowX, -shadowY);
    drawDynamicGroundShadow({
        ctx, entityImage: img, entityCenterX: shadowX, entityBaseY: shadowY,
        imageDrawWidth: drawWidth, imageDrawHeight: drawHeight,
        cycleProgress: 0.5, baseShadowColor: '6, 30, 38', maxShadowAlpha: 0.75,
        maxStretchFactor: 1.0, minStretchFactor: 0.9, shadowBlur: 2, pivotYOffset: 0,
        shakeOffsetX, shakeOffsetY,
    });
    ctx.restore();
}

/**
 * Renders a sea barrel with water effects (water line, underwater tinting, swaying)
 * Uses offscreen canvas and proper compositing to respect PNG transparency
 * @param skipWaterShadow - When true, skip drawing the water shadow (already drawn in early pass for swimming player overlap)
 */
function renderSeaBarrelWithWaterEffects(
    ctx: CanvasRenderingContext2D,
    barrel: Barrel,
    nowMs: number,
    cycleProgress: number,
    skipWaterShadow?: boolean
): void {
    // Don't render if barrel is respawning (destroyed)
    if (barrel.respawnAt && barrel.respawnAt.microsSinceUnixEpoch !== 0n) return;
    
    const variantIndex = Number(barrel.variant ?? 0);
    const imageSource = BARREL_VARIANT_IMAGES[variantIndex] || BARREL_VARIANT_IMAGES[0];
    const img = imageManager.getImage(imageSource);
    
    if (!img || !img.complete || img.naturalWidth === 0) {
        const drawWidth = variantIndex === 4 ? BARREL5_WIDTH : variantIndex === 6 ? BUOY_WIDTH : BARREL_WIDTH;
        const drawHeight = variantIndex === 4 ? BARREL5_HEIGHT : variantIndex === 6 ? BUOY_HEIGHT : BARREL_HEIGHT;
        const yOffset = variantIndex === 4 ? 24 : variantIndex === 6 ? 28 : 12;
        renderCyberpunkAssetPlaceholder(ctx, {
            x: barrel.posX,
            y: barrel.posY - drawHeight / 2 - yOffset,
            width: drawWidth,
            height: drawHeight,
            nowMs,
            shape: variantIndex === 6 ? 'circle' : 'rect',
            label: variantIndex === 6 ? 'NAV' : 'CR8',
            alpha: 0.9,
        });
        return;
    }
    
    // Get dimensions - variant 4 (large barrel) 172x172, variant 6 (buoy) 144x144
    const drawWidth = variantIndex === 4 ? BARREL5_WIDTH : variantIndex === 6 ? BUOY_WIDTH : BARREL_WIDTH;
    const drawHeight = variantIndex === 4 ? BARREL5_HEIGHT : variantIndex === 6 ? BUOY_HEIGHT : BARREL_HEIGHT;
    const yOffset = variantIndex === 4 ? 24 : variantIndex === 6 ? 28 : 12;
    const isRoadBarrelOnWater = variantIndex < SEA_BARREL_VARIANT_START;
    
    // Calculate sway animation (gentle rotation)
    const swayPrimary = Math.sin(nowMs * SEA_BARREL_WATER_CONFIG.SWAY_FREQUENCY + barrel.posX * 0.01) 
        * SEA_BARREL_WATER_CONFIG.SWAY_AMPLITUDE;
    const swaySecondary = Math.sin(nowMs * SEA_BARREL_WATER_CONFIG.SWAY_SECONDARY_FREQUENCY + barrel.posY * 0.01 + Math.PI * 0.5) 
        * SEA_BARREL_WATER_CONFIG.SWAY_AMPLITUDE * 0.5;
    const totalSway = swayPrimary + swaySecondary;
    
    // Calculate bob animation (vertical movement)
    const bobOffset = Math.sin(nowMs * SEA_BARREL_WATER_CONFIG.BOB_FREQUENCY + barrel.posX * 0.02) 
        * SEA_BARREL_WATER_CONFIG.BOB_AMPLITUDE;
    
    // Base position
    const baseX = barrel.posX;
    const baseY = barrel.posY + bobOffset;
    const drawX = baseX - drawWidth / 2;
    const drawY = baseY - drawHeight - yOffset;
    
    // --- Draw dynamic ground shadow (on water surface) - skipped when drawn in early pass for swimming player overlap ---
    if (!skipWaterShadow) {
        const { shakeOffsetX, shakeOffsetY } = calculateShakeOffsets(
            barrel,
            barrel.id.toString(),
            {
                clientStartTimes: clientBarrelShakeStartTimes,
                lastKnownServerTimes: lastKnownServerBarrelShakeTimes
            },
            SHAKE_DURATION_MS,
            SHAKE_INTENSITY_PX,
            undefined,
            { suppressRestartIfRecentClientShake: true }
        );
        const centerY = barrel.posY - drawHeight / 2 - yOffset;
        const shadowOffsetX = drawWidth * 0.28;
        const shadowOffsetY = drawHeight * 0.9;
        const shadowX = baseX + shadowOffsetX;
        const shadowY = centerY + shadowOffsetY;

        ctx.save();
        ctx.translate(shadowX, shadowY);
        ctx.scale(0.85, 0.75);
        ctx.rotate(Math.PI / 6 + (isRoadBarrelOnWater ? Math.PI / 2 : 0));
        ctx.translate(-shadowX, -shadowY);

        drawDynamicGroundShadow({
            ctx,
            entityImage: img,
            entityCenterX: shadowX,
            entityBaseY: shadowY,
            imageDrawWidth: drawWidth,
            imageDrawHeight: drawHeight,
            cycleProgress: 0.5, // Fixed noon like swimming (underwater shadow)
            baseShadowColor: '6, 30, 38',
            maxShadowAlpha: 0.75,
            maxStretchFactor: 1.0,
            minStretchFactor: 0.9,
            shadowBlur: 2,
            pivotYOffset: 0,
            shakeOffsetX,
            shakeOffsetY,
        });
        ctx.restore();
    }
    
    // Calculate water line position (in local sprite coordinates)
    // Buoy (variant 6) sits lower in water - use higher offset to lower the waterline
    // Road barrels on water are rotated 90° - water line must be at barrel center height (baseY) not upright sprite coords
    const waterLineOffset = variantIndex === 6 ? 0.65 : SEA_BARREL_WATER_CONFIG.WATER_LINE_OFFSET;
    const waterLineLocalY = drawHeight * waterLineOffset;
    const waterLineXOffset = isRoadBarrelOnWater ? ROAD_BARREL_WATER_LINE_X_OFFSET : 0;
    const waterLineWorldY = isRoadBarrelOnWater
        ? baseY - 20 + ROAD_BARREL_WATER_LINE_Y_OFFSET  // Rotated barrel: center at baseY; offset shifts line down
        : drawY + waterLineLocalY;
    
    // Wave calculation helper
    const getWaveOffset = (x: number) => {
        return Math.sin(nowMs * SEA_BARREL_WATER_CONFIG.WAVE_FREQUENCY + x * 0.02) 
            * SEA_BARREL_WATER_CONFIG.WAVE_AMPLITUDE
            + Math.sin(nowMs * SEA_BARREL_WATER_CONFIG.WAVE_SECONDARY_FREQUENCY + x * 0.03 + Math.PI * 0.3) 
            * SEA_BARREL_WATER_CONFIG.WAVE_SECONDARY_AMPLITUDE;
    };
    
    // --- Create tinted underwater version on offscreen canvas ---
    const { canvas: offscreen, ctx: offCtx } = getBarrelOffscreenCanvas(drawWidth + 4, drawHeight + 4);
    offCtx.clearRect(0, 0, offscreen.width, offscreen.height);
    
    // Draw barrel to offscreen
    offCtx.drawImage(img, 2, 2, drawWidth, drawHeight);
    
    // Apply tint using source-atop (only affects existing non-transparent pixels)
    offCtx.globalCompositeOperation = 'source-atop';
    const { r, g, b } = SEA_BARREL_WATER_CONFIG.UNDERWATER_TINT_COLOR;
    const tintIntensity = SEA_BARREL_WATER_CONFIG.UNDERWATER_TINT_INTENSITY;
    // Create a color that when multiplied gives the teal tint effect
    offCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${tintIntensity})`;
    offCtx.fillRect(0, 0, offscreen.width, offscreen.height);
    
    // Darken slightly
    offCtx.fillStyle = `rgba(0, 20, 40, 0.2)`;
    offCtx.fillRect(0, 0, offscreen.width, offscreen.height);
    
    offCtx.globalCompositeOperation = 'source-over';
    
    const pivotX = baseX;
    const pivotY = baseY;
    const waveSegments = 16;
    // Rotated barrel extends beyond upright bounds - use generous extent so clip covers barrel in any orientation
    const clipPad = Math.max(drawWidth, drawHeight) + 20;
    const clipLeft = baseX - clipPad;
    const clipRight = baseX + clipPad;
    const clipSegmentWidth = (clipRight - clipLeft) / waveSegments;
    // Keep the clip seam and visible water line perfectly aligned for rotated road barrels.
    const clipWaveLeft = clipLeft + waterLineXOffset;
    const clipWaveRight = clipRight + waterLineXOffset;
    
    // Clip in world space first (before rotation) so water line stays horizontal
    // --- Draw underwater portion (tinted) ---
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(clipWaveLeft, baseY + 50);
    ctx.lineTo(clipWaveLeft, waterLineWorldY);
    for (let i = 0; i <= waveSegments; i++) {
        const segX = clipWaveLeft + i * clipSegmentWidth;
        ctx.lineTo(segX, waterLineWorldY + getWaveOffset(segX));
    }
    ctx.lineTo(clipWaveRight, baseY + 50);
    ctx.closePath();
    ctx.clip();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(totalSway + (isRoadBarrelOnWater ? Math.PI / 2 : 0));
    ctx.translate(-pivotX, -pivotY);
    ctx.drawImage(offscreen, drawX - 2, drawY - 2);
    ctx.restore();
    
    // --- Draw above-water portion (normal) ---
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(clipWaveLeft, drawY - 5);
    ctx.lineTo(clipWaveRight, drawY - 5);
    ctx.lineTo(clipWaveRight, waterLineWorldY);
    for (let i = waveSegments; i >= 0; i--) {
        const segX = clipWaveLeft + i * clipSegmentWidth;
        ctx.lineTo(segX, waterLineWorldY + getWaveOffset(segX));
    }
    ctx.closePath();
    ctx.clip();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(totalSway + (isRoadBarrelOnWater ? Math.PI / 2 : 0));
    ctx.translate(-pivotX, -pivotY);
    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();
    
    // --- Draw water line (outside rotation so it stays horizontal) ---
    ctx.strokeStyle = 'rgba(150, 180, 200, 0.5)';
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    
    ctx.beginPath();
    const lineStartX = drawX + drawWidth * 0.2 + waterLineXOffset;
    const lineEndX = drawX + drawWidth * 0.8 + waterLineXOffset;
    const lineSegments = 8;
    const lineSegmentWidth = (lineEndX - lineStartX) / lineSegments;
    
    for (let i = 0; i <= lineSegments; i++) {
        const segX = lineStartX + i * lineSegmentWidth;
        const waveOffset = getWaveOffset(segX);
        
        if (i === 0) {
            ctx.moveTo(segX, waterLineWorldY + waveOffset);
        } else {
            ctx.lineTo(segX, waterLineWorldY + waveOffset);
        }
    }
    ctx.stroke();
    
    ctx.save(); // Re-apply rotation for buoy LED (if needed)
    ctx.translate(pivotX, pivotY);
    ctx.rotate(totalSway + (isRoadBarrelOnWater ? Math.PI / 2 : 0));
    ctx.translate(-pivotX, -pivotY);
    
    // --- Buoy (variant 6) night-only red LED at top (same "lights on" as road lamps) ---
    if (variantIndex === 6 && isNightTime(cycleProgress)) {
        const ledX = drawX + drawWidth / 2;
        const ledY = drawY + drawHeight * 0.12 + 20; // Near top of buoy, dropped 20px to align with pic
        const ledRadius = 5;
        // Outer glow (subtle)
        const glowGradient = ctx.createRadialGradient(ledX, ledY, 0, ledX, ledY, ledRadius * 3);
        glowGradient.addColorStop(0, 'rgba(255, 60, 60, 0.65)');
        glowGradient.addColorStop(0.5, 'rgba(220, 40, 40, 0.3)');
        glowGradient.addColorStop(1, 'rgba(180, 20, 20, 0)');
        ctx.fillStyle = glowGradient;
        ctx.beginPath();
        ctx.arc(ledX, ledY, ledRadius * 3, 0, Math.PI * 2);
        ctx.fill();
        // Bright LED center
        ctx.fillStyle = '#ff4040';
        ctx.beginPath();
        ctx.arc(ledX, ledY, ledRadius, 0, Math.PI * 2);
        ctx.fill();
    }
    
    ctx.restore(); // Restore from rotation transform
}

// --- Rendering Function (Refactored) ---
/**
 * Renders a barrel with appropriate effects based on variant and location.
 * @param ctx - Canvas rendering context
 * @param barrel - The barrel entity to render
 * @param nowMs - Current time in milliseconds
 * @param cycleProgress - Day/night cycle progress (0-1)
 * @param isOnSeaTile - Optional callback to check if barrel position is on a sea tile.
 *                      If not provided, defaults to assuming sea variants are on sea tiles.
 * @param playerX - Player X position for health bar positioning (opposite side from player)
 * @param playerY - Player Y position for health bar positioning
 */
export function renderBarrel(
    ctx: CanvasRenderingContext2D, 
    barrel: Barrel, 
    nowMs: number, 
    cycleProgress: number,
    isOnSeaTile?: (worldX: number, worldY: number) => boolean,
    playerX?: number,
    playerY?: number,
    skipWaterShadow?: boolean
) {
    // Destroyed barrels disappear immediately; only the destruction effect (chunks) is shown.
    // Check both respawnAt and active destruction - the effect is triggered synchronously in the
    // subscription handler, but React state (barrels) updates async, so we may still have stale
    // barrel data for a frame. If chunks are flying, hide the sprite.
    const barrelId = barrel.id.toString();
    if (barrel.respawnAt && barrel.respawnAt.microsSinceUnixEpoch !== 0n) return;
    if (hasActiveBarrelDestruction(barrelId)) return;

    const variantIndex = Number(barrel.variant ?? 0);
    const cover = combatCoverProfile(variantIndex);
    if (cover) {
        // Explicit legacy rendering also uses the authoritative ground footprint.
        if (barrel.health <= 0) return;
        const w=cover.width,h=cover.height,d=cover.depth;
        ctx.save();ctx.translate(barrel.posX,barrel.posY);
        ctx.fillStyle='rgba(0,0,0,.22)';ctx.beginPath();ctx.ellipse(0,0,w/2,d/2,0,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=`#${cover.color.toString(16).padStart(6,'0')}`;
        if(cover.material==='wood') {
            ctx.fillRect(-w/2,-h,w,h);ctx.strokeStyle='#40392d';ctx.lineWidth=3;
            for(let i=1;i<5;i++){ctx.beginPath();ctx.moveTo(-w/2+4,-h+i*h/5);ctx.lineTo(w/2-4,-h+i*h/5);ctx.stroke();}
            ctx.fillStyle='#bea47e';ctx.beginPath();ctx.ellipse(-w/2+6,-h/2,6,h/2,0,0,Math.PI*2);ctx.fill();
        } else {
            for(let i=0;i<5;i++) {const x=-w/2+i*w/5;
                ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x-4,-h*.55);ctx.lineTo(x+8,-h*(.8+(i%2)*.15));
                ctx.lineTo(x+w/5,-h*.9);ctx.lineTo(x+w/5+5,-h*.3);ctx.lineTo(x+w/5,0);ctx.closePath();ctx.fill();
                ctx.strokeStyle='#44494c';ctx.lineWidth=2;ctx.stroke();}
        }
        ctx.restore();return;
    }
    
    // Apply water effects when barrel is on a sea tile (any variant - road barrels near coast can end up on water)
    // If isOnSeaTile callback is provided, use it to verify the barrel is on water
    // If not provided, fall back to variant-only check for backwards compatibility
    const isSeaVariant = isSeaBarrelVariant(variantIndex);
    const actuallyOnSea = isOnSeaTile ? isOnSeaTile(barrel.posX, barrel.posY) : isSeaVariant;
    
    if (actuallyOnSea && (!barrel.respawnAt || barrel.respawnAt.microsSinceUnixEpoch === 0n)) {
        // Sea barrel rendering - skip water shadow when drawn in early pass (swimming player overlap)
        renderSeaBarrelWithWaterEffects(ctx, barrel, nowMs, cycleProgress, skipWaterShadow);
        return;
    }
    
    // Normal barrel rendering for road barrels OR sea barrels that washed up on land
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

// === UNDERWATER SNORKELING MODE ===
// Constants for underwater silhouette rendering
// Must match values in clientCollision.ts for accurate collision representation
const UNDERWATER_BARREL_CONFIG = {
    // Base radius matches COLLISION_RADII.BARREL in clientCollision.ts
    BASE_RADIUS: 25,
    // Y offset matches COLLISION_OFFSETS.BARREL.y in clientCollision.ts
    Y_OFFSET: 48,
    // Feather amount (soft edge gradient)
    FEATHER_RATIO: 0.4, // 40% of radius is feathered
    // Colors for underwater effect
    INNER_COLOR: 'rgba(10, 50, 70, 0.85)', // Dark teal center
    OUTER_COLOR: 'rgba(10, 50, 70, 0)', // Transparent edge
};

/**
 * Renders a barrel as an underwater silhouette (feathered dark blue circle)
 * Used when player is snorkeling - shows where obstacles are from underwater perspective
 * Only renders for sea barrel variants (3, 4, 5)
 * Includes sway and bob animation to match the barrel's above-water movement
 */
export function renderBarrelUnderwaterSilhouette(
    ctx: CanvasRenderingContext2D,
    barrel: Barrel,
    cycleProgress: number = 0.5,
    nowMs: number = Date.now()
): void {
    if (hasActiveBarrelDestruction(barrel.id.toString())) return;
    const variantIndex = Number(barrel.variant ?? 0);
    
    // Only render silhouette for sea barrels (variants 3, 4, 5)
    if (variantIndex < SEA_BARREL_VARIANT_START || variantIndex >= SEA_BARREL_VARIANT_END) {
        return;
    }
    
    // Variant 4 (barrel5.png) 2x, variant 6 (buoy) 144/86 ≈ 1.67
    const scaleFactor = variantIndex === 4 ? 2 : variantIndex === 6 ? BUOY_WIDTH / BARREL_WIDTH : 1;
    
    // Calculate radius to match actual collision system
    const radius = UNDERWATER_BARREL_CONFIG.BASE_RADIUS * scaleFactor;
    const featherRadius = radius * (1 + UNDERWATER_BARREL_CONFIG.FEATHER_RATIO);
    
    // Calculate sway animation (same as barrel rendering)
    const swayPrimary = Math.sin(nowMs * SEA_BARREL_WATER_CONFIG.SWAY_FREQUENCY + barrel.posX * 0.01) 
        * SEA_BARREL_WATER_CONFIG.SWAY_AMPLITUDE;
    const swaySecondary = Math.sin(nowMs * SEA_BARREL_WATER_CONFIG.SWAY_SECONDARY_FREQUENCY + barrel.posY * 0.01 + Math.PI * 0.5) 
        * SEA_BARREL_WATER_CONFIG.SWAY_AMPLITUDE * 0.5;
    const totalSway = swayPrimary + swaySecondary;
    
    // Calculate bob animation (same as barrel rendering)
    const bobOffset = Math.sin(nowMs * SEA_BARREL_WATER_CONFIG.BOB_FREQUENCY + barrel.posX * 0.02) 
        * SEA_BARREL_WATER_CONFIG.BOB_AMPLITUDE;
    
    // Base position with bob
    const baseX = barrel.posX;
    const baseY = barrel.posY + bobOffset;
    
    // Apply sway rotation offset to the silhouette position
    // The sway rotates around the barrel base, so the collision center moves in an arc
    const collisionYOffset = UNDERWATER_BARREL_CONFIG.Y_OFFSET * scaleFactor;
    // Calculate horizontal displacement from sway (simplified arc motion)
    const swayDisplacementX = Math.sin(totalSway) * collisionYOffset;
    const swayDisplacementY = (1 - Math.cos(totalSway)) * collisionYOffset * 0.1; // Small vertical component
    
    const x = baseX + swayDisplacementX;
    const y = baseY - collisionYOffset + swayDisplacementY;
    
    ctx.save();
    
    // Create radial gradient for feathered effect
    const gradient = ctx.createRadialGradient(x, y, radius * 0.3, x, y, featherRadius);
    
    // Adjust darkness slightly based on time of day
    const nightFactor = Math.abs(cycleProgress - 0.5) * 2; // 0 at noon, 1 at midnight
    const baseAlpha = 0.75 + nightFactor * 0.15; // Darker at night
    
    // Inner solid color
    const innerColor = UNDERWATER_BARREL_CONFIG.INNER_COLOR.replace('0.85', baseAlpha.toFixed(2));
    gradient.addColorStop(0, innerColor);
    gradient.addColorStop(0.6, innerColor);
    // Feathered edge
    gradient.addColorStop(1, UNDERWATER_BARREL_CONFIG.OUTER_COLOR);
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, featherRadius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
}
