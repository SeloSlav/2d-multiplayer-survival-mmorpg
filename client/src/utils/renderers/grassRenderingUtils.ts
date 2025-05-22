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
import bushRoundedTextureUrl from '../../assets/doodads/bush_rounded.png';
import bushSpikyTextureUrl from '../../assets/doodads/bush_spiky.png';
import bushFloweringTextureUrl from '../../assets/doodads/bush_flowering.png';
import bramblesATextureUrl from '../../assets/doodads/brambles_a.png';
import bramblesBTextureUrl from '../../assets/doodads/brambles_a.png';


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

// Asset paths for different grass appearances and their animation frames
const grassAssetPaths: Record<string, string[]> = {
    [GrassAppearanceType.PatchA.tag]: [grass1TextureUrl],
    [GrassAppearanceType.PatchB.tag]: [grass2TextureUrl],
    [GrassAppearanceType.PatchC.tag]: [grass3TextureUrl],
    [GrassAppearanceType.TallGrassA.tag]: [tallGrassATextureUrl],
    [GrassAppearanceType.TallGrassB.tag]: [tallGrassBTextureUrl],
    [GrassAppearanceType.BushRounded.tag]: [bushRoundedTextureUrl],
    [GrassAppearanceType.BushSpiky.tag]: [bushSpikyTextureUrl],
    [GrassAppearanceType.BushFlowering.tag]: [bushFloweringTextureUrl],
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
    [GrassAppearanceType.BushRounded.tag]: { targetWidth: 80 },
    [GrassAppearanceType.BushSpiky.tag]: { targetWidth: 70 },
    [GrassAppearanceType.BushFlowering.tag]: { targetWidth: 75 },
    [GrassAppearanceType.BramblesA.tag]: { targetWidth: 100 },
    [GrassAppearanceType.BramblesB.tag]: { targetWidth: 120 },
    // Default fallback if a new type is added to enum but not here (should be avoided)
    default: { targetWidth: 48 },
};


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

        // --- Rotational Sway --- 
        const effectiveSwaySpeed = typeof entity.swaySpeed === 'number' ? entity.swaySpeed : DEFAULT_FALLBACK_SWAY_SPEED;
        const swayCycle = (nowMs / 1000) * effectiveSwaySpeed * Math.PI * 2 + individualSwayOffset * Math.PI * 2 * SWAY_VARIATION_FACTOR;
        // Calculate sway angle in degrees, then convert to radians
        const currentSwayAngleDeg = Math.sin(swayCycle) * SWAY_AMPLITUDE_DEG * (1 + (individualSwayOffset - 0.5) * SWAY_VARIATION_FACTOR);
        
        // --- Static Random Rotation --- (previously part of sway calculation)
        const rotationSeedPart = (swaySeed >> 16) % 360; 
        const staticRandomRotationDeg = ((rotationSeedPart / 359.0) * (STATIC_ROTATION_DEG * 2)) - STATIC_ROTATION_DEG;

        // Combine static rotation with dynamic sway rotation
        const totalRotationDeg = staticRandomRotationDeg + currentSwayAngleDeg;
        const finalRotationRad = totalRotationDeg * (Math.PI / 180); // Convert to radians for canvas

        // --- Static Random Scale --- (preserved)
        const scaleSeedPart = (swaySeed >> 24) % 1000; 
        const randomScale = SCALE_VARIATION_MIN + (scaleSeedPart / 999.0) * (SCALE_VARIATION_MAX - SCALE_VARIATION_MIN);

        // --- Pivot Offset for Base Anchoring --- 
        // The generic renderer will pivot around (finalDrawX + width/2, finalDrawY + height/2).
        // We want the pivot to be at the base of the grass.
        // `baseDrawX` and `baseDrawY` are the top-left corner *before* any effects.
        // `calculateDrawPosition` already centers the image around entity.serverPosX and adjusts for Y-sort.
        // The `offsetX` and `offsetY` returned here will be added to `baseDrawX` and `baseDrawY`.
        // So, to make the pivot at the bottom-center of the *original* base position:
        // - offsetX: should be 0, as `calculateDrawPosition` handles horizontal centering.
        // - offsetY: should effectively shift the pivot point from the center of the image to its base.
        //   The generic renderer uses (finalDrawY + targetImgHeight / 2) as its Y pivot.
        //   We want this to be baseDrawY + targetImgHeight (bottom of image).
        //   So, offsetY needs to be targetImgHeight / 2.

        return {
            offsetX: 0, // No translational sway for X
            offsetY: targetImgHeight / 2, // Shift pivot to the base of the image
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
    skipDrawingShadow?: boolean
) {
    if (grass.health <= 0) return; 

    renderConfiguredGroundEntity<InterpolatedGrassData>({
        ctx,
        entity: grass,
        config: grassConfig,
        nowMs,
        entityPosX: grass.serverPosX,
        entityPosY: grass.serverPosY,
        cycleProgress,
        onlyDrawShadow,
        skipDrawingShadow,
    });
}
