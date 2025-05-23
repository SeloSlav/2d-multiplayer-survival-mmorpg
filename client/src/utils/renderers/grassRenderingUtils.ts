import {
    // Grass, // We will use InterpolatedGrassData
    GrassAppearanceType
} from '../../generated'; // Import generated Grass type and AppearanceType
import { drawDynamicGroundShadow } from './shadowUtils';
import { GroundEntityConfig, renderConfiguredGroundEntity } from './genericGroundRenderer';
import { imageManager } from './imageManager';
import { InterpolatedGrassData } from '../../hooks/useGrassInterpolation'; // Import InterpolatedGrassData

// Import grass assets directly using @ alias
import grass1TextureUrl from '../../assets/doodads/grass1.png';
import grass2TextureUrl from '../../assets/doodads/grass2.png';
import grass3TextureUrl from '../../assets/doodads/grass3.png';
import tallGrassATextureUrl from '../../assets/doodads/tall_grass_a.png';
import tallGrassBTextureUrl from '../../assets/doodads/tall_grass_a.png';
import bramblesATextureUrl from '../../assets/doodads/brambles_a.png';
import bramblesBTextureUrl from '../../assets/doodads/brambles_b.png';


// --- Constants for Grass Rendering ---
// const TARGET_GRASS_WIDTH_PX = 48; // Old constant, now part of grassSizeConfig
const SWAY_AMPLITUDE_DEG = 3; // Max sway in degrees (e.g., +/- 3 degrees from vertical)
const STATIC_ROTATION_DEG = 5; // Max static random rotation in degrees (+/-)
const SWAY_VARIATION_FACTOR = 0.5; // How much individual sway can vary
const Y_SORT_OFFSET_GRASS = 5; // Fine-tune Y-sorting position relative to base
const MAX_POSITION_OFFSET_PX = 4; // Max random pixel offset for X and Y
const SCALE_VARIATION_MIN = 0.95; // Min random scale factor
const SCALE_VARIATION_MAX = 1.05; // Max random scale factor
const DEFAULT_FALLBACK_SWAY_SPEED = 0.1; // Fallback if entity.swaySpeed is undefined

// NEW: Disturbance effect constants
const DISTURBANCE_DURATION_MS = 1500; // How long disturbance effect lasts (1.5 seconds)
const DISTURBANCE_SWAY_AMPLITUDE_DEG = 15; // Much stronger sway when disturbed
const DISTURBANCE_FADE_FACTOR = 0.8; // How quickly the disturbance fades over time

// OPTIMIZATION: Cache disturbance calculations to avoid recalculating every frame
const disturbanceCache = new Map<string, {
    lastCalculatedMs: number;
    result: { isDisturbed: boolean; disturbanceStrength: number; disturbanceDirectionX: number; disturbanceDirectionY: number; };
}>();
const DISTURBANCE_CACHE_DURATION_MS = 50; // Cache for 50ms (20fps cache rate)

// --- NEW: Define which grass types should sway ---
const SWAYING_GRASS_TYPES = new Set([
    GrassAppearanceType.PatchA.tag,
    GrassAppearanceType.PatchB.tag,
    GrassAppearanceType.PatchC.tag,
    GrassAppearanceType.TallGrassA.tag,
    GrassAppearanceType.TallGrassB.tag,
]);

// Helper function to check if a grass type should sway
function shouldGrassSway(appearanceType: GrassAppearanceType): boolean {
    return SWAYING_GRASS_TYPES.has(appearanceType.tag);
}

// NEW: Helper function to calculate disturbance effect (OPTIMIZED)
function calculateDisturbanceEffect(grass: InterpolatedGrassData, nowMs: number): { 
    isDisturbed: boolean; 
    disturbanceStrength: number; 
    disturbanceDirectionX: number; 
    disturbanceDirectionY: number; 
} {
    // OPTIMIZATION: Use cache to avoid recalculating every frame
    const cacheKey = `${grass.id}_${grass.disturbedAt ? (grass.disturbedAt as any)?.microsSinceUnixEpoch || 0 : 0}`;
    const cached = disturbanceCache.get(cacheKey);
    
    if (cached && (nowMs - cached.lastCalculatedMs) < DISTURBANCE_CACHE_DURATION_MS) {
        return cached.result;
    }
    
    // Quick exit if no disturbance timestamp
    if (!grass.disturbedAt) {
        const result = { isDisturbed: false, disturbanceStrength: 0, disturbanceDirectionX: 0, disturbanceDirectionY: 0 };
        disturbanceCache.set(cacheKey, { lastCalculatedMs: nowMs, result });
        return result;
    }
    
    // Convert server timestamp to milliseconds (assuming disturbedAt has microsSinceUnixEpoch)
    const disturbedAtMs = (grass.disturbedAt as any)?.microsSinceUnixEpoch 
        ? Number((grass.disturbedAt as any).microsSinceUnixEpoch) / 1000 
        : 0;
    
    if (disturbedAtMs === 0) {
        const result = { isDisturbed: false, disturbanceStrength: 0, disturbanceDirectionX: 0, disturbanceDirectionY: 0 };
        disturbanceCache.set(cacheKey, { lastCalculatedMs: nowMs, result });
        return result;
    }
    
    const timeSinceDisturbanceMs = nowMs - disturbedAtMs;
    
    if (timeSinceDisturbanceMs > DISTURBANCE_DURATION_MS) {
        const result = { isDisturbed: false, disturbanceStrength: 0, disturbanceDirectionX: 0, disturbanceDirectionY: 0 };
        disturbanceCache.set(cacheKey, { lastCalculatedMs: nowMs, result });
        return result;
    }
    
    // Calculate fade-out strength (1.0 = full strength, 0.0 = no effect)
    const fadeProgress = timeSinceDisturbanceMs / DISTURBANCE_DURATION_MS;
    const disturbanceStrength = Math.pow(1.0 - fadeProgress, DISTURBANCE_FADE_FACTOR);
    
    const result = {
        isDisturbed: true,
        disturbanceStrength,
        disturbanceDirectionX: grass.disturbanceDirectionX,
        disturbanceDirectionY: grass.disturbanceDirectionY,
    };
    
    // Cache the result
    disturbanceCache.set(cacheKey, { lastCalculatedMs: nowMs, result });
    
    // OPTIMIZATION: Cleanup old cache entries periodically
    if (disturbanceCache.size > 500) { // Arbitrary limit
        const oldestAllowed = nowMs - (DISTURBANCE_CACHE_DURATION_MS * 2);
        for (const [key, entry] of disturbanceCache.entries()) {
            if (entry.lastCalculatedMs < oldestAllowed) {
                disturbanceCache.delete(key);
            }
        }
    }
    
    return result;
}

// Asset paths for different grass appearances and their animation frames
const grassAssetPaths: Record<string, string[]> = {
    [GrassAppearanceType.PatchA.tag]: [grass1TextureUrl],
    [GrassAppearanceType.PatchB.tag]: [grass2TextureUrl],
    [GrassAppearanceType.PatchC.tag]: [grass3TextureUrl],
    [GrassAppearanceType.TallGrassA.tag]: [tallGrassATextureUrl],
    [GrassAppearanceType.TallGrassB.tag]: [tallGrassBTextureUrl],
    [GrassAppearanceType.BramblesA.tag]: [bramblesATextureUrl],
    [GrassAppearanceType.BramblesB.tag]: [bramblesBTextureUrl],
};

// --- NEW: Configuration for target sizes (width only, height will be scaled) ---
interface GrassSizeConfig {
    targetWidth: number;
    // Add other type-specific rendering params here later if needed (e.g., custom sway)
}

const grassSizeConfig: Record<string, GrassSizeConfig> = {
    [GrassAppearanceType.PatchA.tag]: { targetWidth: 48 },
    [GrassAppearanceType.PatchB.tag]: { targetWidth: 48 },
    [GrassAppearanceType.PatchC.tag]: { targetWidth: 48 },
    [GrassAppearanceType.TallGrassA.tag]: { targetWidth: 72 }, // Approx 1.5x
    [GrassAppearanceType.TallGrassB.tag]: { targetWidth: 96 }, // Approx 2x
    [GrassAppearanceType.BramblesA.tag]: { targetWidth: 100 },
    [GrassAppearanceType.BramblesB.tag]: { targetWidth: 120 },
    // Default fallback if a new type is added to enum but not here (should be avoided)
    default: { targetWidth: 48 },
};

// Helper function to check if a grass type should have static rotation (exclude brambles)
function shouldHaveStaticRotation(appearanceType: GrassAppearanceType): boolean {
    return appearanceType.tag !== GrassAppearanceType.BramblesA.tag && 
           appearanceType.tag !== GrassAppearanceType.BramblesB.tag;
}

// Preload all grass images
Object.values(grassAssetPaths).flat().forEach(path => imageManager.preloadImage(path));

// Configuration for rendering grass using the generic renderer
const grassConfig: GroundEntityConfig<InterpolatedGrassData> = {
    getImageSource: (entity: InterpolatedGrassData) => {
        const appearance = entity.appearanceType;
        const paths = grassAssetPaths[appearance.tag];
        if (!paths || paths.length === 0) {
            console.warn(`[grassRenderingUtils] No asset path found for grass type: ${appearance.tag}`);
            return null; // Or a fallback image path
        }
        const swaySeed = entity.swayOffsetSeed;
        // Basic animation frame selection (can be expanded)
        const frameIndex = Math.floor((Date.now() / 200) + swaySeed) % paths.length;
        return paths[frameIndex];
    },

    getTargetDimensions: (img, entity: InterpolatedGrassData) => {
        const appearanceTag = entity.appearanceType.tag;
        const sizeConf = grassSizeConfig[appearanceTag] || grassSizeConfig.default;
        const targetWidth = sizeConf.targetWidth;

        const scaleFactor = targetWidth / img.naturalWidth;
        return {
            width: targetWidth,
            height: img.naturalHeight * scaleFactor,
        };
    },

    calculateDrawPosition: (entity: InterpolatedGrassData, drawWidth, drawHeight) => {
        // Use swayOffsetSeed for deterministic randomness
        const seed = entity.swayOffsetSeed;
        // Generate offsets between -MAX_POSITION_OFFSET_PX and +MAX_POSITION_OFFSET_PX
        const randomOffsetX = ((seed % (MAX_POSITION_OFFSET_PX * 2 + 1)) - MAX_POSITION_OFFSET_PX);
        const randomOffsetY = (((seed >> 8) % (MAX_POSITION_OFFSET_PX * 2 + 1)) - MAX_POSITION_OFFSET_PX);

        return {
            drawX: entity.serverPosX - drawWidth / 2 + randomOffsetX,
            drawY: entity.serverPosY - drawHeight + Y_SORT_OFFSET_GRASS + randomOffsetY,
        };
    },

    getShadowParams: undefined, 

    drawCustomGroundShadow: (ctx, entity: InterpolatedGrassData, entityImage, entityPosX, entityBaseY, imageDrawWidth, imageDrawHeight, cycleProgress) => {
        // No-op to prevent any shadow drawing from this path
    },

    applyEffects: (ctx: CanvasRenderingContext2D, entity: InterpolatedGrassData, nowMs: number, baseDrawX: number, baseDrawY: number, cycleProgress: number, targetImgWidth: number, targetImgHeight: number) => {
        const swaySeed = entity.swayOffsetSeed;
        const individualSwayOffset = (swaySeed % 1000) / 1000.0; // Normalize seed to 0-1

        // --- Rotational Sway (only for certain grass types) --- 
        let currentSwayAngleDeg = 0;
        if (shouldGrassSway(entity.appearanceType)) {
            const effectiveSwaySpeed = typeof entity.swaySpeed === 'number' ? entity.swaySpeed : DEFAULT_FALLBACK_SWAY_SPEED;
            const swayCycle = (nowMs / 1000) * effectiveSwaySpeed * Math.PI * 2 + individualSwayOffset * Math.PI * 2 * SWAY_VARIATION_FACTOR;
            // Calculate sway angle in degrees, then convert to radians
            currentSwayAngleDeg = Math.sin(swayCycle) * SWAY_AMPLITUDE_DEG * (1 + (individualSwayOffset - 0.5) * SWAY_VARIATION_FACTOR);
        }
        
        // --- Static Random Rotation (applied to all grass types) --- 
        const rotationSeedPart = (swaySeed >> 16) % 360; 
        let staticRandomRotationDeg = 0;
        // OPTIMIZATION: Skip rotation for distant grass if using reduced detail
        if (shouldHaveStaticRotation(entity.appearanceType)) {
            staticRandomRotationDeg = ((rotationSeedPart / 359.0) * (STATIC_ROTATION_DEG * 2)) - STATIC_ROTATION_DEG;
        }

        // Combine static rotation with dynamic sway rotation
        const totalRotationDeg = staticRandomRotationDeg + currentSwayAngleDeg;
        const finalRotationRad = totalRotationDeg * (Math.PI / 180); // Convert to radians for canvas

        // --- Static Random Scale (applied to all grass types) --- 
        const scaleSeedPart = (swaySeed >> 24) % 1000; 
        // OPTIMIZATION: Use simpler scale calculation for distant grass
        const randomScale = SCALE_VARIATION_MIN + (scaleSeedPart / 999.0) * (SCALE_VARIATION_MAX - SCALE_VARIATION_MIN);

        // --- Calculate Pivot Offset for Bottom-Center Anchoring ---
        // The generic renderer rotates around (finalDrawX + width/2, finalDrawY + height/2)
        // We want to rotate around (finalDrawX + width/2, finalDrawY + height) - the bottom center
        // 
        // When rotating around a different point, we need to adjust the drawing position
        // to compensate for the rotation displacement.
        //
        // For rotation around bottom center instead of image center:
        // - Horizontal offset: The rotation around bottom center vs center will cause horizontal displacement
        // - Vertical offset: The rotation will cause the image to shift vertically
        
        let offsetX = 0;
        let offsetY = 0;
        
        if (finalRotationRad !== 0) {
            // Calculate the displacement needed to make rotation appear to happen around bottom-center
            // instead of the image center
            const centerToBottomDistanceY = targetImgHeight / 2;
            
            // When we rotate around the bottom instead of center, the center point moves
            // Calculate how much the center moves due to rotation around bottom
            const rotatedCenterOffsetX = centerToBottomDistanceY * Math.sin(finalRotationRad);
            const rotatedCenterOffsetY = centerToBottomDistanceY * (1 - Math.cos(finalRotationRad));
            
            // Adjust the drawing position to compensate
            offsetX = -rotatedCenterOffsetX;
            offsetY = -rotatedCenterOffsetY;
        }

        return {
            offsetX,
            offsetY,
            rotation: finalRotationRad,
            scale: randomScale,
        };
    },

    fallbackColor: 'rgba(34, 139, 34, 0.7)', 
};

// Function to render a single grass entity using the generic renderer
export function renderGrass(
    ctx: CanvasRenderingContext2D,
    grass: InterpolatedGrassData,
    nowMs: number,
    cycleProgress: number,
    onlyDrawShadow?: boolean,
    skipDrawingShadow?: boolean,
    cameraX?: number,  // NEW: Add camera position for culling
    cameraY?: number   // NEW: Add camera position for culling
) {
    if (grass.health <= 0) return; 

    // NEW: Distance-based culling for performance
    const MAX_GRASS_RENDER_DISTANCE = 600; // Reduced from 800 to 600 pixels for better performance
    if (cameraX !== undefined && cameraY !== undefined) {
        const dx = grass.posX - cameraX;
        const dy = grass.posY - cameraY;
        const distanceSq = dx * dx + dy * dy; // Avoid sqrt for performance
        
        if (distanceSq > MAX_GRASS_RENDER_DISTANCE * MAX_GRASS_RENDER_DISTANCE) {
            return; // Skip rendering this grass - too far away
        }
        
        // OPTIMIZATION: Reduced detail for distant grass (skip complex effects)
        const REDUCED_DETAIL_DISTANCE_SQ = 400 * 400; // 400 pixels
        if (distanceSq > REDUCED_DETAIL_DISTANCE_SQ) {
            // For distant grass, use simpler rendering without disturbance effects
            // This will be handled in the rendering logic below
        }
    }

    // Get image source
    const appearance = grass.appearanceType;
    const paths = grassAssetPaths[appearance.tag];
    if (!paths || paths.length === 0) {
        console.warn(`[grassRenderingUtils] No asset path found for grass type: ${appearance.tag}`);
        return;
    }
    
    const swaySeed = grass.swayOffsetSeed;
    const frameIndex = Math.floor((Date.now() / 200) + swaySeed) % paths.length;
    const imgSrc = paths[frameIndex];
    const img = imageManager.getImage(imgSrc);
    
    if (!img || !img.complete || img.naturalHeight === 0) {
        // Fallback rendering
        ctx.fillStyle = 'rgba(34, 139, 34, 0.7)';
        ctx.fillRect(grass.serverPosX - 16, grass.serverPosY - 32, 32, 32);
        return;
    }

    // Calculate target dimensions
    const appearanceTag = grass.appearanceType.tag;
    const sizeConf = grassSizeConfig[appearanceTag] || grassSizeConfig.default;
    const targetWidth = sizeConf.targetWidth;
    const scaleFactor = targetWidth / img.naturalWidth;
    const targetHeight = img.naturalHeight * scaleFactor;

    // Calculate base draw position (top-left corner of image)
    const randomOffsetX = ((swaySeed % (MAX_POSITION_OFFSET_PX * 2 + 1)) - MAX_POSITION_OFFSET_PX);
    const randomOffsetY = (((swaySeed >> 8) % (MAX_POSITION_OFFSET_PX * 2 + 1)) - MAX_POSITION_OFFSET_PX);
    const baseDrawX = grass.serverPosX - targetWidth / 2 + randomOffsetX;
    const baseDrawY = grass.serverPosY - targetHeight + Y_SORT_OFFSET_GRASS + randomOffsetY;

    if (onlyDrawShadow) {
        return; // No shadow for grass currently
    }

    // Calculate rotation and scale effects
    const individualSwayOffset = (swaySeed % 1000) / 1000.0;
    
    // OPTIMIZATION: Check if we should use reduced detail for distant grass
    let useReducedDetail = false;
    if (cameraX !== undefined && cameraY !== undefined) {
        const dx = grass.posX - cameraX;
        const dy = grass.posY - cameraY;
        const distanceSq = dx * dx + dy * dy;
        const REDUCED_DETAIL_DISTANCE_SQ = 400 * 400; // 400 pixels
        useReducedDetail = distanceSq > REDUCED_DETAIL_DISTANCE_SQ;
    }
    
    // OPTIMIZATION: Only check disturbance for grass types that can sway and if not using reduced detail
    const canSway = shouldGrassSway(grass.appearanceType);
    const disturbanceEffect = (canSway && !useReducedDetail) ? calculateDisturbanceEffect(grass, nowMs) : { isDisturbed: false, disturbanceStrength: 0, disturbanceDirectionX: 0, disturbanceDirectionY: 0 };
    
    // Rotational Sway (only for certain grass types)
    let currentSwayAngleDeg = 0;
    if (canSway) {
        if (disturbanceEffect.isDisturbed) {
            // Apply disturbance sway - much stronger and in the disturbance direction
            const effectiveSwaySpeed = typeof grass.swaySpeed === 'number' ? grass.swaySpeed : DEFAULT_FALLBACK_SWAY_SPEED;
            const disturbanceCycle = (nowMs / 1000) * effectiveSwaySpeed * Math.PI * 6; // Faster oscillation for disturbance
            
            // Calculate disturbance angle based on the disturbance direction
            const disturbanceAngle = Math.atan2(disturbanceEffect.disturbanceDirectionY, disturbanceEffect.disturbanceDirectionX) * (180 / Math.PI);
            
            // Create a strong sway in the disturbance direction with oscillation
            const oscillation = Math.sin(disturbanceCycle) * 0.5 + 0.5; // 0 to 1
            currentSwayAngleDeg = disturbanceAngle * (DISTURBANCE_SWAY_AMPLITUDE_DEG / 90) * disturbanceEffect.disturbanceStrength * oscillation;
        } else {
            // Normal sway
            const effectiveSwaySpeed = typeof grass.swaySpeed === 'number' ? grass.swaySpeed : DEFAULT_FALLBACK_SWAY_SPEED;
            const swayCycle = (nowMs / 1000) * effectiveSwaySpeed * Math.PI * 2 + individualSwayOffset * Math.PI * 2 * SWAY_VARIATION_FACTOR;
            currentSwayAngleDeg = Math.sin(swayCycle) * SWAY_AMPLITUDE_DEG * (1 + (individualSwayOffset - 0.5) * SWAY_VARIATION_FACTOR);
        }
    }
    
    // Static Random Rotation
    const rotationSeedPart = (swaySeed >> 16) % 360; 
    let staticRandomRotationDeg = 0;
    // OPTIMIZATION: Skip rotation for distant grass if using reduced detail
    if (shouldHaveStaticRotation(grass.appearanceType)) {
        staticRandomRotationDeg = ((rotationSeedPart / 359.0) * (STATIC_ROTATION_DEG * 2)) - STATIC_ROTATION_DEG;
    }
    
    // Combine rotations
    const totalRotationDeg = staticRandomRotationDeg + currentSwayAngleDeg;
    const finalRotationRad = totalRotationDeg * (Math.PI / 180);
    
    // Static Random Scale
    const scaleSeedPart = (swaySeed >> 24) % 1000; 
    // OPTIMIZATION: Use simpler scale calculation for distant grass
    const randomScale = SCALE_VARIATION_MIN + (scaleSeedPart / 999.0) * (SCALE_VARIATION_MAX - SCALE_VARIATION_MIN);

    ctx.save();

    // Define the bottom-center anchor point (this point should NOT move)
    const anchorX = grass.serverPosX + randomOffsetX;
    const anchorY = grass.serverPosY + randomOffsetY + Y_SORT_OFFSET_GRASS;

    // Translate to anchor point
    ctx.translate(anchorX, anchorY);
    
    // Apply rotation around the anchor (bottom-center)
    if (finalRotationRad !== 0) {
        ctx.rotate(finalRotationRad);
    }
    
    // Apply scale
    if (randomScale !== 1) {
        ctx.scale(randomScale, randomScale);
    }

    // Draw image with bottom-center at origin (0, 0)
    // So top-left corner is at (-targetWidth/2, -targetHeight)
    ctx.drawImage(
        img,
        -targetWidth / 2,
        -targetHeight,
        targetWidth,
        targetHeight
    );

    ctx.restore();
}
