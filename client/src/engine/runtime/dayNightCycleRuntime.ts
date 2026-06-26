import {
    DroppedItem as SpacetimeDBDroppedItem,
    Campfire as SpacetimeDBCampfire,
    Lantern as SpacetimeDBLantern,
    Furnace as SpacetimeDBFurnace,
    WorldState as SpacetimeDBWorldState,
    Player as SpacetimeDBPlayer,
    ActiveEquipment as SpacetimeDBActiveEquipment,
    ItemDefinition as SpacetimeDBItemDefinition,
    RuneStone as SpacetimeDBRuneStone, // ADDED: RuneStone
    FirePatch as SpacetimeDBFirePatch, // ADDED: FirePatch
    Fumarole as SpacetimeDBFumarole, // ADDED: Fumarole
    Barbecue as SpacetimeDBBarbecue, // ADDED: Barbecue
    RoadLamppost as SpacetimeDBRoadLamppost, // ADDED: Aleutian whale oil lampposts
    Barrel as SpacetimeDBBarrel, // ADDED: Barrels (buoys for night light cutouts)
} from '../../generated/types';
import { CAMPFIRE_LIGHT_RADIUS_BASE, CAMPFIRE_FLICKER_AMOUNT, LANTERN_LIGHT_RADIUS_BASE, LANTERN_FLICKER_AMOUNT, FURNACE_LIGHT_RADIUS_BASE, BARBECUE_LIGHT_RADIUS_BASE, SOVA_AURA_RADIUS_BASE, FLARE_LIGHT_RADIUS_BASE, sampleStableLightFlicker } from '../../utils/renderers/lightRenderingUtils';
import { ROAD_LAMP_LIGHT_RADIUS_BASE, ROAD_LAMP_LIGHT_Y_OFFSET } from '../../utils/renderers/roadLamppostRenderingUtils';
import { BUOY_HEIGHT } from '../../utils/renderers/barrelRenderingUtils';
import { BUOY_LIGHT_RADIUS_BASE } from '../../utils/renderers/lightRenderingUtils';
import {
    FULL_MOON_CYCLE_INTERVAL,
    isNightTime,
    NIGHT_LIGHTS_ON,
    LIGHT_FADE_FULL_AT,
    TWILIGHT_MORNING_FADE_START,
    TWILIGHT_MORNING_END,
    mapLegacyCycleProgress,
} from '../../config/dayNightConstants';
import { dayNightConfig } from '../../config/sharedGameConfig';
import { CAMPFIRE_HEIGHT } from '../../utils/renderers/campfireRenderingUtils';
import { getPlacedCampfireLightIntensity01 } from '../../utils/renderers/campfireGpuFireSmoothing';
import { LANTERN_HEIGHT, LANTERN_RENDER_Y_OFFSET, LANTERN_TYPE_LANTERN } from '../../utils/renderers/lanternRenderingUtils';
import { getFurnaceDimensions, FURNACE_TYPE_LARGE } from '../../utils/renderers/furnaceRenderingUtils';
import { FIRE_PATCH_VISUAL_RADIUS } from '../../utils/renderers/firePatchRenderingUtils';
import { BuildingCluster } from '../../utils/buildingVisibilityUtils';
import { FOUNDATION_TILE_SIZE } from '../../config/gameConfig';
import { getWorldCenter, isCompoundMonument } from '../../config/compoundBuildings';

export interface ColorPoint {
  r: number; g: number; b: number; a: number;
}

interface MonumentLightPart {
    monumentType?: { tag?: string };
    partType?: string;
    worldX: number;
    worldY: number;
}

interface RemotePlayerInterpolationRuntime {
    updateAndGetSmoothedPosition(player: SpacetimeDBPlayer, localPlayerId?: string): { x: number; y: number };
}

// ============================================================================
// AAA PIXEL ART DAY/NIGHT COLORS - Inspired by Sea of Stars
// ============================================================================
// Key principles:
// - Night is NEVER pure black - always rich deep blues with purple undertones
// - Dawn/Dusk have vibrant oranges, magentas, and teals
// - Full moon has ethereal silver-blue magical glow
// - Each time period has a distinct cinematic "mood"
// ============================================================================

// Default night: Rich deep blue transitions, but midnight is TRUE BLACK
// The contrast makes the blues feel richer
export const defaultPeakMidnightColor: ColorPoint = { r: 0, g: 0, b: 0, a: 1.0 };
export const defaultTransitionNightColor: ColorPoint = { r: 25, g: 35, b: 65, a: 0.78 };

// Full Moon night: Ethereal silver-blue magical glow
// Brighter, cooler, more mystical - like moonlight bathing the world
export const fullMoonPeakMidnightColor: ColorPoint = { r: 70, g: 90, b: 140, a: 0.42 };
export const fullMoonTransitionNightColor: ColorPoint = { r: 55, g: 80, b: 130, a: 0.52 };

// Base keyframes (legacy 0.76 day-end authoring → mapLegacyCycleProgress for shared gameConfig)
const baseKeyframesLegacy: Record<number, ColorPoint> = {
  0.00: { r: 140, g: 90, b: 130, a: 0.52 },
  0.08: { r: 255, g: 200, b: 120, a: 0.12 },
  0.15: { r: 0, g: 0, b: 0, a: 0.0 },
  0.50: { r: 0, g: 0, b: 0, a: 0.0 },
  0.72: { r: 255, g: 140, b: 70, a: 0.22 },
  0.80: { r: 45, g: 40, b: 110, a: 0.78 },
  0.92: { r: 12, g: 18, b: 50, a: 0.90 },
  0.945: { r: 0, g: 0, b: 0, a: 1.0 },
  0.97: { r: 25, g: 30, b: 70, a: 0.84 },
  1.00: { r: 140, g: 90, b: 130, a: 0.52 },
};
export const baseKeyframes: Record<number, ColorPoint> = Object.fromEntries(
  Object.entries(baseKeyframesLegacy).map(([k, v]) => [mapLegacyCycleProgress(Number(k)), v])
) as Record<number, ColorPoint>;
// --- END Day/Night Cycle Constants ---

// Define TORCH_LIGHT_RADIUS_BASE locally
const TORCH_LIGHT_RADIUS_BASE = CAMPFIRE_LIGHT_RADIUS_BASE * 0.8; // Slightly smaller than campfire
const TORCH_FLICKER_AMOUNT = CAMPFIRE_FLICKER_AMOUNT * 0.7; // Added for torch flicker

// Define HEADLAMP_LIGHT_RADIUS_BASE locally (twice as bright as torch, same fire-like style)
const HEADLAMP_LIGHT_RADIUS_BASE = TORCH_LIGHT_RADIUS_BASE * 2.0;
const HEADLAMP_FLICKER_AMOUNT = TORCH_FLICKER_AMOUNT * 1.2; // More flicker for fire-like effect

// Define RGB colors for overlay tints - 50-MINUTE CYCLE (40min day + 10min night)
// Night has 3 phases: Early tension (Dusk), Peak pressure (Night), Desperate hour (Midnight)
interface ColorAlphaKeyframe {
  progress: number;
  rgb: [number, number, number];
  alpha: number;
}

// Helper for daytime (effectively transparent)
const DAY_COLOR_CONFIG = { rgb: [0, 0, 0] as [number, number, number], alpha: 0.0 }; // Color doesn't matter when alpha is 0

const REGULAR_CYCLE_KEYFRAMES_LEGACY: ColorAlphaKeyframe[] = [
  // ============================================================================
  // SEA OF STARS INSPIRED - Rich, saturated, cinematic colors
  // Night is deep blue (never black!), dawn/dusk are vibrant gold/magenta/teal
  // ============================================================================
  
  // START at 0.0 matching END of Twilight Morning - lavender pre-dawn glow
  { progress: 0.0,  rgb: [140, 90, 130],   alpha: 0.52 },   // Soft lavender-pink pre-dawn
  
  // Dawn (Server: 0.0 - 0.05) - Golden hour magic with magenta undertones
  { progress: 0.015, rgb: [180, 100, 120], alpha: 0.42 },   // Rose-gold awakening
  { progress: 0.025, rgb: [220, 120, 90],  alpha: 0.35 },   // Warm coral sunrise
  { progress: 0.035, rgb: [255, 150, 60],  alpha: 0.28 },   // Rich golden orange
  { progress: 0.045, rgb: [255, 180, 80],  alpha: 0.18 },   // Bright sunrise gold

  // Morning - Transition to Clear Day (Server: 0.05 - 0.35)
  { progress: 0.06, rgb: [255, 200, 120],  alpha: 0.12 },   // Warm morning glow
  { progress: 0.08, rgb: [255, 220, 150],  alpha: 0.08 },   // Soft golden haze
  { progress: 0.10, rgb: [255, 235, 180],  alpha: 0.05 },   // Fading warmth
  { progress: 0.12, rgb: [255, 245, 210],  alpha: 0.02 },   // Almost clear
  { progress: 0.15, ...DAY_COLOR_CONFIG },                  // Morning fully clear
  
  // Day/Noon/Afternoon clear (bright, no overlay)
  { progress: 0.35, ...DAY_COLOR_CONFIG }, // Morning clear
  { progress: 0.55, ...DAY_COLOR_CONFIG }, // Noon clear 
  { progress: 0.68, ...DAY_COLOR_CONFIG }, // Late afternoon clear

  // Golden Hour / Pre-Dusk (Server: ~0.70 - 0.72) - Warm amber tones
  { progress: 0.70, rgb: [255, 210, 140],  alpha: 0.06 },   // First hints of golden hour
  { progress: 0.715, rgb: [255, 180, 100], alpha: 0.12 },   // Deepening gold

  // Dusk (Server: 0.72 - 0.76) - Dramatic orange to magenta to teal transition
  { progress: 0.72, rgb: [255, 140, 70],   alpha: 0.22 },   // Intense sunset orange
  { progress: 0.735, rgb: [240, 100, 90],  alpha: 0.32 },   // Coral-pink sunset
  { progress: 0.75, rgb: [200, 80, 120],   alpha: 0.42 },   // Magenta twilight
  { progress: 0.76, rgb: [160, 70, 140],   alpha: 0.52 },   // Deep purple-magenta

  // Twilight Evening (Server: 0.76 - 0.80) - Purple to deep blue transition
  { progress: 0.77, rgb: [120, 60, 150],   alpha: 0.60 },   // Rich violet
  { progress: 0.785, rgb: [80, 50, 140],   alpha: 0.68 },   // Deep indigo
  { progress: 0.80, rgb: [45, 40, 110],    alpha: 0.78 },   // Night indigo

  // Night (Server: 0.80 - 0.92) - Rich deep blue (Sea of Stars style - NEVER black)
  { progress: 0.83, rgb: [30, 35, 90],     alpha: 0.82 },   // Deep starlit blue
  { progress: 0.86, rgb: [20, 28, 75],     alpha: 0.86 },   // Darker blue
  { progress: 0.89, rgb: [15, 22, 60],     alpha: 0.88 },   // Deep night blue

  // Midnight (Server: 0.92 - 0.97) - True black at peak, blue transitions
  { progress: 0.92, rgb: [12, 18, 50],     alpha: 0.90 },   // Midnight blue start
  { progress: 0.945, rgb: [0, 0, 0],       alpha: 1.0 },    // TRUE BLACK at midnight peak
  { progress: 0.965, rgb: [15, 20, 55],    alpha: 0.88 },   // Midnight easing back to blue

  // Twilight Morning (Server: 0.97 - 1.0) - Deep blue to purple to lavender
  { progress: 0.97, rgb: [25, 30, 70],     alpha: 0.84 },   // Pre-dawn deep blue
  { progress: 0.98, rgb: [50, 45, 100],    alpha: 0.75 },   // Indigo awakening
  { progress: 0.99, rgb: [90, 65, 120],    alpha: 0.65 },   // Purple dawn hints
  { progress: 0.995, rgb: [120, 80, 125],  alpha: 0.58 },   // Lavender pre-dawn
  { progress: 1.0, rgb: [140, 90, 130],    alpha: 0.52 },   // Soft lavender (matches 0.0)
];

const REGULAR_CYCLE_KEYFRAMES: ColorAlphaKeyframe[] = REGULAR_CYCLE_KEYFRAMES_LEGACY.map((kf) => ({
  ...kf,
  progress: mapLegacyCycleProgress(kf.progress),
}));

const FULL_MOON_NIGHT_KEYFRAMES_LEGACY: ColorAlphaKeyframe[] = [
  // ============================================================================
  // FULL MOON - Ethereal silver-blue magical atmosphere
  // Brighter nights with mystical moonlit glow, cool blue-silver tones
  // Inspired by moonlit scenes in Sea of Stars and Ori
  // ============================================================================
  
  // START at 0.0 - Soft silver-lavender pre-dawn under moonlight
  { progress: 0.0,  rgb: [180, 170, 200], alpha: 0.22 },   // Silver-lavender pre-dawn

  // Dawn (Full Moon) - Softer, more ethereal sunrise with silver undertones
  { progress: 0.015, rgb: [200, 175, 190], alpha: 0.18 },   // Rose-silver awakening
  { progress: 0.025, rgb: [220, 185, 170], alpha: 0.14 },   // Soft peach-silver
  { progress: 0.035, rgb: [240, 200, 160], alpha: 0.10 },   // Gentle golden glow
  { progress: 0.045, rgb: [255, 215, 175], alpha: 0.06 },   // Soft sunrise

  // Morning - Transition to Clear Day
  { progress: 0.06, rgb: [255, 225, 190], alpha: 0.04 },   // Fading warmth
  { progress: 0.08, rgb: [255, 235, 210], alpha: 0.02 },   // Almost clear
  { progress: 0.12, ...DAY_COLOR_CONFIG },                  // Morning clear

  // Day/Afternoon (Same as regular - bright and clear)
  { progress: 0.35, ...DAY_COLOR_CONFIG },
  { progress: 0.55, ...DAY_COLOR_CONFIG },
  { progress: 0.68, ...DAY_COLOR_CONFIG },

  // Golden Hour / Pre-Dusk - Slightly muted compared to regular
  { progress: 0.70, rgb: [255, 220, 170], alpha: 0.05 },   // Soft golden hour
  { progress: 0.715, rgb: [250, 195, 150], alpha: 0.10 },  // Gentle gold

  // Dusk (Full Moon) - More subdued, transitioning to silver-blue faster
  { progress: 0.72, rgb: [240, 160, 130], alpha: 0.18 },   // Coral sunset
  { progress: 0.735, rgb: [210, 140, 150], alpha: 0.26 },  // Rose twilight
  { progress: 0.75, rgb: [180, 130, 170], alpha: 0.32 },   // Lavender-rose
  { progress: 0.76, rgb: [150, 130, 185], alpha: 0.36 },   // Silver-lavender

  // Twilight Evening (Full Moon) - Quick transition to magical blue
  { progress: 0.77, rgb: [130, 140, 190], alpha: 0.38 },   // Silver-blue emerging
  { progress: 0.785, rgb: [110, 145, 195], alpha: 0.40 },  // Cool moonlight blue
  { progress: 0.80, rgb: [95, 140, 200],  alpha: 0.42 },   // Ethereal blue

  // Night (Full Moon) - MAGICAL silver-blue moonlit atmosphere
  { progress: 0.83, rgb: [85, 130, 195],  alpha: 0.40 },   // Soft moonlight
  { progress: 0.86, rgb: [75, 115, 185],  alpha: 0.42 },   // Deep moonlight
  { progress: 0.89, rgb: [70, 105, 175],  alpha: 0.43 },   // Rich moonlit blue

  // Midnight (Full Moon) - Brightest silver-blue, mystical glow
  { progress: 0.92, rgb: [70, 95, 165],   alpha: 0.44 },   // Midnight moon start
  { progress: 0.945, rgb: [70, 90, 155],  alpha: 0.45 },   // Midnight moon peak (brightest)
  { progress: 0.965, rgb: [75, 100, 170], alpha: 0.44 },   // Midnight easing

  // Twilight Morning (Full Moon) - Silver-blue to lavender pre-dawn
  { progress: 0.97, rgb: [85, 110, 180],  alpha: 0.42 },   // Pre-dawn moonlight
  { progress: 0.98, rgb: [110, 130, 190], alpha: 0.36 },   // Fading moonlight
  { progress: 0.99, rgb: [145, 150, 195], alpha: 0.30 },   // Silver-lavender hints
  { progress: 0.995, rgb: [165, 160, 198], alpha: 0.26 }, // Soft lavender
  { progress: 1.0, rgb: [180, 170, 200],  alpha: 0.22 },   // Silver-lavender (matches 0.0)
];

const FULL_MOON_NIGHT_KEYFRAMES: ColorAlphaKeyframe[] = FULL_MOON_NIGHT_KEYFRAMES_LEGACY.map((kf) => ({
  ...kf,
  progress: mapLegacyCycleProgress(kf.progress),
}));

// --- Indoor Light Containment Utilities ---

/**
 * Convert world position to foundation cell coordinates
 */
function worldToFoundationCell(worldX: number, worldY: number): { cellX: number; cellY: number } {
    return {
        cellX: Math.floor(worldX / FOUNDATION_TILE_SIZE),
        cellY: Math.floor(worldY / FOUNDATION_TILE_SIZE),
    };
}

/**
 * Find which enclosed building cluster contains the given world position
 * Returns the cluster and its ID if found, null otherwise
 */
function findEnclosingCluster(
    worldX: number,
    worldY: number,
    buildingClusters: Map<string, BuildingCluster>
): { clusterId: string; cluster: BuildingCluster } | null {
    const { cellX, cellY } = worldToFoundationCell(worldX, worldY);
    const cellKey = `${cellX},${cellY}`;
    
    for (const [clusterId, cluster] of buildingClusters) {
        if (cluster.isEnclosed && cluster.cellCoords.has(cellKey)) {
            return { clusterId, cluster };
        }
    }
    return null;
}

/**
 * Create a Path2D clip path from a building cluster's foundation cells
 * This allows light cutouts to be contained within the building interior
 * 
 * IMPORTANT: North walls/doors render with a vertical offset ABOVE the foundation,
 * so we extend the clip area upward by one foundation tile size to include
 * the north wall rendering area.
 */
function createClusterClipPath(
    cluster: BuildingCluster,
    cameraOffsetX: number,
    cameraOffsetY: number
): Path2D {
    const path = new Path2D();
    
    // Add each foundation cell as a rectangle to the path
    // Also extend upward by one tile to cover north wall rendering area
    cluster.cellCoords.forEach((cellKey) => {
        const [cellXStr, cellYStr] = cellKey.split(',');
        const cellX = parseInt(cellXStr, 10);
        const cellY = parseInt(cellYStr, 10);
        
        // Convert cell coordinates to screen pixels
        const screenX = cellX * FOUNDATION_TILE_SIZE + cameraOffsetX;
        const screenY = cellY * FOUNDATION_TILE_SIZE + cameraOffsetY;
        
        // Add the foundation cell itself
        path.rect(screenX, screenY, FOUNDATION_TILE_SIZE, FOUNDATION_TILE_SIZE);
        
        // Add a rectangle ABOVE this cell to cover north wall/door rendering area
        // North walls render with vertical offset above the foundation
        path.rect(screenX, screenY - FOUNDATION_TILE_SIZE, FOUNDATION_TILE_SIZE, FOUNDATION_TILE_SIZE);
    });
    
    return path;
}

/**
 * Render a light cutout, optionally clipped to a building interior
 * This prevents light from spilling outside of enclosed structures
 */
function renderClippedLightCutout(
    ctx: CanvasRenderingContext2D,
    screenX: number,
    screenY: number,
    lightRadius: number,
    gradientStops: Array<{ stop: number; alpha: number }>,
    enclosingCluster: { clusterId: string; cluster: BuildingCluster } | null,
    cameraOffsetX: number,
    cameraOffsetY: number,
    alphaScale: number = 1,
): void {
    // Save context before potentially applying clip
    if (enclosingCluster) {
        ctx.save();
        const clipPath = createClusterClipPath(enclosingCluster.cluster, cameraOffsetX, cameraOffsetY);
        ctx.clip(clipPath);
    }
    
    // Create and apply the radial gradient for the light cutout
    const innerRadius = lightRadius * (gradientStops[0]?.stop || 0.08);
    const maskGradient = ctx.createRadialGradient(screenX, screenY, innerRadius, screenX, screenY, lightRadius);
    
    const s = Math.max(0, Math.min(1, alphaScale));
    for (const { stop, alpha } of gradientStops) {
        maskGradient.addColorStop(stop, `rgba(0,0,0,${alpha * s})`);
    }
    
    ctx.fillStyle = maskGradient;
    ctx.beginPath();
    ctx.arc(screenX, screenY, lightRadius, 0, Math.PI * 2);
    ctx.fill();
    
    // Restore context if we applied a clip
    if (enclosingCluster) {
        ctx.restore();
    }
}

// --- End Indoor Light Containment Utilities ---

function nearestColorAlphaKeyframe(keyframes: ColorAlphaKeyframe[], progress: number): ColorAlphaKeyframe {
    return keyframes.reduce((best, kf) =>
        Math.abs(kf.progress - progress) < Math.abs(best.progress - progress) ? kf : best
    );
}

function calculateOverlayRgbaString(
    cycleProgress: number,
    worldState: SpacetimeDBWorldState | null // Pass the whole worldState or null
): string { 
    const isCurrentlyFullMoon = worldState?.isFullMoon ?? false;
    const currentCycleCount = worldState?.cycleCount ?? 0;

    const GRACE_PERIOD_END_PROGRESS = dayNightConfig.dawnEndProgress;
    const REGULAR_DAWN_PEAK_PROGRESS = mapLegacyCycleProgress(0.125);

    // --- Special Transition 1: Full Moon cycle STARTS, but PREVIOUS was Regular (or first cycle) ---
    const prevCycleWasRegularOrDefault = currentCycleCount === 0 || ((currentCycleCount - 1) % FULL_MOON_CYCLE_INTERVAL !== 0);
    if (isCurrentlyFullMoon && cycleProgress < GRACE_PERIOD_END_PROGRESS && prevCycleWasRegularOrDefault) {
        const fromKf = REGULAR_CYCLE_KEYFRAMES[0]; // Regular dark midnight
        const toKf = FULL_MOON_NIGHT_KEYFRAMES[0];   // Target: Full moon bright midnight
        let t = 0;
        if (GRACE_PERIOD_END_PROGRESS > 0.0001) {
            t = cycleProgress / GRACE_PERIOD_END_PROGRESS;
        }
        t = Math.max(0, Math.min(t, 1));

        const r = Math.round(fromKf.rgb[0] * (1 - t) + toKf.rgb[0] * t);
        const g = Math.round(fromKf.rgb[1] * (1 - t) + toKf.rgb[1] * t);
        const b = Math.round(fromKf.rgb[2] * (1 - t) + toKf.rgb[2] * t);
        const alpha = fromKf.alpha * (1 - t) + toKf.alpha * t;
        return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
    }

    // --- Special Transition 2: Regular cycle STARTS, but PREVIOUS was Full Moon ---
    const prevCycleWasFullMoon = currentCycleCount > 0 && ((currentCycleCount - 1) % FULL_MOON_CYCLE_INTERVAL === 0);
    if (!isCurrentlyFullMoon && cycleProgress < REGULAR_DAWN_PEAK_PROGRESS && prevCycleWasFullMoon) {
        const fromKf = FULL_MOON_NIGHT_KEYFRAMES[FULL_MOON_NIGHT_KEYFRAMES.length - 1]; 
        const toKf = nearestColorAlphaKeyframe(REGULAR_CYCLE_KEYFRAMES, REGULAR_DAWN_PEAK_PROGRESS); 
        let t = 0;
        if (REGULAR_DAWN_PEAK_PROGRESS > 0) { 
            t = cycleProgress / REGULAR_DAWN_PEAK_PROGRESS;
        }
        t = Math.max(0, Math.min(t, 1));
        const r = Math.round(fromKf.rgb[0] * (1 - t) + toKf.rgb[0] * t);
        const g = Math.round(fromKf.rgb[1] * (1 - t) + toKf.rgb[1] * t);
        const b = Math.round(fromKf.rgb[2] * (1 - t) + toKf.rgb[2] * t);
        const alpha = fromKf.alpha * (1 - t) + toKf.alpha * t;
        return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
    }

    // --- Default Interpolation (covers all other cases) ---
    const keyframesToUse = isCurrentlyFullMoon ? FULL_MOON_NIGHT_KEYFRAMES : REGULAR_CYCLE_KEYFRAMES;
    
    const twilightMorningStart = dayNightConfig.twilightMorningStartProgress;
    // Twilight morning through cycle wrap: interpolate from last keyframe toward first dawn keyframe
    if (cycleProgress >= twilightMorningStart) {
        const lastKf = keyframesToUse[keyframesToUse.length - 1];
        const firstDawnKf =
            keyframesToUse.find((kf) => kf.progress <= GRACE_PERIOD_END_PROGRESS) || keyframesToUse[0];

        const normalizedProgress = (cycleProgress - twilightMorningStart) / (1.0 - twilightMorningStart);
        const t = Math.max(0, Math.min(normalizedProgress, 1));
        
        const r = Math.round(lastKf.rgb[0] * (1 - t) + firstDawnKf.rgb[0] * t);
        const g = Math.round(lastKf.rgb[1] * (1 - t) + firstDawnKf.rgb[1] * t);
        const b = Math.round(lastKf.rgb[2] * (1 - t) + firstDawnKf.rgb[2] * t);
        const alpha = lastKf.alpha * (1 - t) + firstDawnKf.alpha * t;
        
        return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
    }
    
    // Standard keyframe lookup and interpolation
    let prevKf = keyframesToUse[0];
    let nextKf = keyframesToUse[keyframesToUse.length - 1];

    if (cycleProgress <= keyframesToUse[0].progress) {
        prevKf = keyframesToUse[0];
        nextKf = keyframesToUse[0];
    } else {
        for (let i = 0; i < keyframesToUse.length - 1; i++) {
            if (cycleProgress >= keyframesToUse[i].progress && cycleProgress < keyframesToUse[i + 1].progress) {
                prevKf = keyframesToUse[i];
                nextKf = keyframesToUse[i + 1];
                break;
            }
        }
    }

    let t = 0; // Interpolation factor
    if (nextKf.progress > prevKf.progress) {
        t = (cycleProgress - prevKf.progress) / (nextKf.progress - prevKf.progress);
    }
    t = Math.max(0, Math.min(t, 1)); // Clamp t

    const r = Math.round(prevKf.rgb[0] * (1 - t) + nextKf.rgb[0] * t);
    const g = Math.round(prevKf.rgb[1] * (1 - t) + nextKf.rgb[1] * t);
    const b = Math.round(prevKf.rgb[2] * (1 - t) + nextKf.rgb[2] * t);
    const alpha = prevKf.alpha * (1 - t) + nextKf.alpha * t;

    // Debug logging for Dusk overlay (0.72 - 0.76)
    // if (cycleProgress >= 0.72 && cycleProgress <= 0.76) {
    //     console.log(`[DayNightCycle] DUSK DEBUG - Progress: ${cycleProgress.toFixed(3)}, Prev: ${prevKf.progress} (alpha: ${prevKf.alpha}), Next: ${nextKf.progress} (alpha: ${nextKf.alpha}), T: ${t.toFixed(3)}, Final Alpha: ${alpha.toFixed(2)}, RGB: [${r},${g},${b}]`);
    // }

    return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
}

export interface DayNightCycleRuntimeOptions {
    worldState: SpacetimeDBWorldState | null;
    droppedItems: Map<string, SpacetimeDBDroppedItem>;
    campfires: Map<string, SpacetimeDBCampfire>;
    lanterns: Map<string, SpacetimeDBLantern>;
    furnaces: Map<string, SpacetimeDBFurnace>;
    barbecues: Map<string, SpacetimeDBBarbecue>; // ADDED: Barbecues for night light cutouts
    roadLampposts: Map<string, SpacetimeDBRoadLamppost>; // ADDED: Aleutian whale oil lampposts along roads
    barrels: Map<string, SpacetimeDBBarrel>; // ADDED: Barrels (buoys for night light cutouts)
    runeStones: Map<string, SpacetimeDBRuneStone>; // ADDED: RuneStones for night light cutouts
    firePatches: Map<string, SpacetimeDBFirePatch>; // ADDED: Fire patches for night light cutouts
    fumaroles: Map<string, SpacetimeDBFumarole>; // ADDED: Fumaroles for heat glow at night
    monumentParts: Map<string, MonumentLightPart>; // ADDED: Unified monument parts (will filter for fishing village)
    players: Map<string, SpacetimeDBPlayer>;
    activeEquipments: Map<string, SpacetimeDBActiveEquipment>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    cameraOffsetX: number;
    cameraOffsetY: number;
    canvasSize: { width: number; height: number };
    // Add interpolated positions for smooth torch light cutouts
    localPlayerId?: string;
    predictedPosition: { x: number; y: number } | null;
    remotePlayerInterpolation?: RemotePlayerInterpolationRuntime;
    // Indoor light containment - prevents light from spilling outside enclosed buildings
    buildingClusters?: Map<string, BuildingCluster>;
    // Mouse position for local player's flashlight aiming (smooth 360° tracking)
    worldMouseX?: number | null;
    worldMouseY?: number | null;
}

interface DayNightMaskCanvasRef {
    current: HTMLCanvasElement | null;
}

export interface DayNightCycleRuntimeSnapshot {
    overlayRgba: string;
    maskCanvasRef: DayNightMaskCanvasRef;
    redrawMask: (frameOverrides?: DayNightMaskFrameOverrides) => void;
}

export interface DayNightMaskFrameOverrides {
    cameraOffsetX?: number;
    cameraOffsetY?: number;
    predictedPosition?: { x: number; y: number } | null;
    worldMouseX?: number | null;
    worldMouseY?: number | null;
}

export class DayNightCycleRuntime {
    private readonly maskCanvasRef: DayNightMaskCanvasRef = { current: null };
    private options: DayNightCycleRuntimeOptions | null = null;
    private overlayRgba = 'transparent';
    private prevOverlay = 'transparent';

    update(options: DayNightCycleRuntimeOptions): DayNightCycleRuntimeSnapshot {
        this.options = options;
        this.redrawMask();
        return this.getSnapshot();
    }

    getSnapshot(): DayNightCycleRuntimeSnapshot {
        return {
            overlayRgba: this.overlayRgba,
            maskCanvasRef: this.maskCanvasRef,
            redrawMask: this.redrawMask,
        };
    }

    stop(): void {
        this.options = null;
        this.maskCanvasRef.current = null;
        this.overlayRgba = 'transparent';
        this.prevOverlay = 'transparent';
    }

    private readonly redrawMask = (frameOverrides: DayNightMaskFrameOverrides = {}) => {
        const options = this.options;
        if (!options) {
            this.overlayRgba = 'transparent';
            return;
        }

        const {
            worldState,
            droppedItems,
            campfires,
            lanterns,
            furnaces,
            barbecues,
            roadLampposts,
            barrels,
            runeStones,
            firePatches,
            fumaroles,
            monumentParts,
            players,
            activeEquipments,
            itemDefinitions,
            cameraOffsetX: initialCameraOffsetX,
            cameraOffsetY: initialCameraOffsetY,
            canvasSize,
            localPlayerId,
            predictedPosition: initialPredictedPosition,
            remotePlayerInterpolation,
            buildingClusters,
            worldMouseX: initialWorldMouseX,
            worldMouseY: initialWorldMouseY,
        } = options;
        const cameraOffsetX = frameOverrides.cameraOffsetX ?? initialCameraOffsetX;
        const cameraOffsetY = frameOverrides.cameraOffsetY ?? initialCameraOffsetY;
        const predictedPosition = frameOverrides.predictedPosition ?? initialPredictedPosition;
        const worldMouseX = frameOverrides.worldMouseX ?? initialWorldMouseX;
        const worldMouseY = frameOverrides.worldMouseY ?? initialWorldMouseY;

        if (!this.maskCanvasRef.current) {
            this.maskCanvasRef.current = document.createElement('canvas');
        }
        const maskCanvas = this.maskCanvasRef.current;
        const maskCtx = maskCanvas.getContext('2d');

        if (!maskCtx || canvasSize.width === 0 || canvasSize.height === 0) {
            this.overlayRgba = 'transparent';
            return;
        }

        // Avoid resizing the offscreen canvas every frame. Width/height assignment
        // reallocates the backing store and causes visible hitches once mask redraws
        // moved onto the render loop.
        if (maskCanvas.width !== canvasSize.width) {
            maskCanvas.width = canvasSize.width;
        }
        if (maskCanvas.height !== canvasSize.height) {
            maskCanvas.height = canvasSize.height;
        }

        maskCtx.setTransform(1, 0, 0, 1, 0, 0);
        maskCtx.globalCompositeOperation = 'source-over';
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

        const currentCycleProgress = worldState?.cycleProgress;
        let calculatedOverlayString; 

        if (typeof currentCycleProgress === 'number') {
            calculatedOverlayString = calculateOverlayRgbaString(
                currentCycleProgress,
                worldState // Pass the whole worldState object
            );
        } else {
            calculatedOverlayString = 'rgba(0,0,0,0)'; // Default to fully transparent day
            console.warn('[DayNightCycle] No cycleProgress available, using transparent overlay');
        }
        
        // OPTIMIZED: Only update state if the overlay value actually changed
        if (calculatedOverlayString !== this.prevOverlay) {
            this.prevOverlay = calculatedOverlayString;
            this.overlayRgba = calculatedOverlayString;
        } 

        maskCtx.fillStyle = calculatedOverlayString; 
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
        maskCtx.globalCompositeOperation = 'destination-out';

        // Render flare light cutouts (ground flares - timer is ground-only)
        const flareDef = Array.from(itemDefinitions.values()).find(d => d.name === 'Flare');
        const nowSecs = Date.now() / 1000;
        if (flareDef) {
            const flareDefId = flareDef.id;
            droppedItems.forEach(flareItem => {
                if (flareItem.itemDefId !== flareDefId) return;
                const data = flareItem.itemData;
                if (!data) return;
                try {
                    const parsed = JSON.parse(data) as { flare_expires_at?: number };
                    if (parsed.flare_expires_at == null || parsed.flare_expires_at <= nowSecs) return;
                } catch {
                    return;
                }
                const screenX = flareItem.posX + cameraOffsetX;
                const screenY = flareItem.posY + cameraOffsetY;
                const enclosingCluster = buildingClusters
                    ? findEnclosingCluster(flareItem.posX, flareItem.posY, buildingClusters)
                    : null;
                renderClippedLightCutout(
                    maskCtx,
                    screenX,
                    screenY,
                    FLARE_LIGHT_RADIUS_BASE,
                    [
                        { stop: 0.08, alpha: 1 },
                        { stop: 0.4, alpha: 0.7 },
                        { stop: 0.8, alpha: 0.3 },
                        { stop: 1, alpha: 0 },
                    ],
                    enclosingCluster,
                    cameraOffsetX,
                    cameraOffsetY
                );
            });
        }

        // Render campfire light cutouts (alpha follows GPU fire ramp when WebGL2 overlay is active)
        campfires.forEach(campfire => {
            const cutoutAlpha = getPlacedCampfireLightIntensity01(
                campfire.isBurning,
                String(campfire.id),
            );
            if (cutoutAlpha <= 0) return;
            // Adjust Y position for the light source to be centered on the flame
            const visualCenterWorldY = campfire.posY - (CAMPFIRE_HEIGHT / 2);
            const adjustedGradientCenterWorldY = visualCenterWorldY - (CAMPFIRE_HEIGHT * 0); // Changed from 0.6 to 0.4

            const screenX = campfire.posX + cameraOffsetX;
            const screenY = adjustedGradientCenterWorldY + cameraOffsetY; // Use adjusted Y

            // Check if campfire is inside an enclosed building
            const enclosingCluster = buildingClusters
                ? findEnclosingCluster(campfire.posX, campfire.posY, buildingClusters)
                : null;

            // SUBSTANTIAL CAMPFIRE CUTOUT - 2x larger inner bright area with natural gradient
            const lightRadius = CAMPFIRE_LIGHT_RADIUS_BASE * 2.0; // Double the cutout size

            renderClippedLightCutout(
                maskCtx,
                screenX,
                screenY,
                lightRadius,
                [
                    { stop: 0.08, alpha: 1 },    // Full cutout at center
                    { stop: 0.4, alpha: 0.7 },   // Natural transition zone
                    { stop: 0.8, alpha: 0.3 },   // Gentle fade
                    { stop: 1, alpha: 0 },       // Complete fade to darkness
                ],
                enclosingCluster,
                cameraOffsetX,
                cameraOffsetY,
                cutoutAlpha,
            );
        });

        // Render village campfire light cutouts (fishing + hunting villages)
        const VILLAGE_CAMPFIRE_Y_OFFSET = -150; // Dropped 100px lower for better alignment
        monumentParts.forEach(part => {
            const isVillageCampfire =
                (part.monumentType?.tag === 'FishingVillage' || part.monumentType?.tag === 'HuntingVillage') &&
                part.partType === 'campfire';
            if (isVillageCampfire) {
                const screenX = part.worldX + cameraOffsetX;
                const screenY = part.worldY + cameraOffsetY + VILLAGE_CAMPFIRE_Y_OFFSET; // Apply offset
                
                // LARGE VILLAGE CAMPFIRE - bigger and warmer than regular campfires
                // Creates a cozy, safe atmosphere in the village
                const VILLAGE_CAMPFIRE_RADIUS = CAMPFIRE_LIGHT_RADIUS_BASE * 3.0; // Communal fire light
                const flicker = sampleStableLightFlicker(part.worldX, part.worldY + VILLAGE_CAMPFIRE_Y_OFFSET, CAMPFIRE_FLICKER_AMOUNT * 0.8, 0, 0, 0.9);
                const lightRadius = Math.max(0, VILLAGE_CAMPFIRE_RADIUS + flicker.baseFlicker);
                
                // No building clusters for outdoor village campfire
                renderClippedLightCutout(
                    maskCtx,
                    screenX,
                    screenY,
                    lightRadius,
                    [
                        { stop: 0.05, alpha: 1 },    // Full cutout at center - cozy warm core
                        { stop: 0.25, alpha: 0.85 }, // Strong cutout - safe zone area
                        { stop: 0.5, alpha: 0.6 },   // Gentle transition
                        { stop: 0.75, alpha: 0.3 },  // Fading edge
                        { stop: 1, alpha: 0 },       // Complete fade to darkness
                    ],
                    null, // No building cluster (outdoor)
                    cameraOffsetX,
                    cameraOffsetY
                );
            }
        });

        // Render lantern light cutouts
        lanterns.forEach(lantern => {
            if (lantern.isBurning && !lantern.isDestroyed) {
                // For wards, center light on the visual center of the structure (higher up than collision)
                // Wards are tall 256x256 sprites, so we offset significantly from posY
                // For regular lanterns, use the standard visual center calculation
                const isWard = lantern.lanternType !== LANTERN_TYPE_LANTERN;
                // AAA Pixel Art: Ward light should emanate from the mystical center of the structure
                // This is higher than the collision circle - approximately 60% up the sprite
                const WARD_VISUAL_LIGHT_Y_OFFSET = 140; // Higher up for visual centering on ward structure
                
                const visualCenterWorldY = isWard 
                    ? lantern.posY - WARD_VISUAL_LIGHT_Y_OFFSET  // Center on visual mystical heart
                    : lantern.posY - (LANTERN_HEIGHT / 2) - LANTERN_RENDER_Y_OFFSET; // Standard lantern center (includes render offset)
                
                const screenX = lantern.posX + cameraOffsetX;
                const screenY = visualCenterWorldY + cameraOffsetY;
                
                // Check if lantern is inside an enclosed building
                const enclosingCluster = buildingClusters 
                    ? findEnclosingCluster(lantern.posX, lantern.posY, buildingClusters)
                    : null;
                
                if (isWard) {
                    // === AAA PIXEL ART WARD CUTOUTS ===
                    // Multi-layered ethereal glow with soft, mystical transitions
                    // Inspired by Sea of Stars magical light sources
                    
                    // Wards have larger, more dramatic cutouts with ethereal quality
                    const WARD_CUTOUT_RADIUS = 280; // Larger base radius for ward mystical aura
                    const flicker = sampleStableLightFlicker(lantern.posX, visualCenterWorldY, LANTERN_FLICKER_AMOUNT * 0.5, 0, 0, 0.85);
                    const lightRadius = Math.max(0, WARD_CUTOUT_RADIUS + flicker.baseFlicker);
                    
                    // Apply clip if inside a building
                    if (enclosingCluster) {
                        maskCtx.save();
                        const clipPath = createClusterClipPath(enclosingCluster.cluster, cameraOffsetX, cameraOffsetY);
                        maskCtx.clip(clipPath);
                    }
                    
                    // LAYER 1: Large soft outer cutout - creates ethereal visibility bubble
                    const outerRadius = lightRadius * 1.3;
                    const outerGradient = maskCtx.createRadialGradient(
                        screenX, screenY, lightRadius * 0.1,
                        screenX, screenY, outerRadius
                    );
                    outerGradient.addColorStop(0, 'rgba(0,0,0,0.6)');    // Soft cutout center
                    outerGradient.addColorStop(0.3, 'rgba(0,0,0,0.4)');  // Gentle transition
                    outerGradient.addColorStop(0.6, 'rgba(0,0,0,0.2)');  // Soft fade
                    outerGradient.addColorStop(0.85, 'rgba(0,0,0,0.08)'); // Very soft edge
                    outerGradient.addColorStop(1, 'rgba(0,0,0,0)');      // Fade to darkness
                    
                    maskCtx.fillStyle = outerGradient;
                    maskCtx.beginPath();
                    maskCtx.arc(screenX, screenY, outerRadius, 0, Math.PI * 2);
                    maskCtx.fill();
                    
                    // LAYER 2: Main cutout - strong visibility zone
                    const mainGradient = maskCtx.createRadialGradient(
                        screenX, screenY, lightRadius * 0.05,
                        screenX, screenY, lightRadius
                    );
                    mainGradient.addColorStop(0, 'rgba(0,0,0,1)');       // Full cutout at center
                    mainGradient.addColorStop(0.15, 'rgba(0,0,0,0.95)'); // Near-full cutout
                    mainGradient.addColorStop(0.35, 'rgba(0,0,0,0.8)');  // Strong cutout zone
                    mainGradient.addColorStop(0.55, 'rgba(0,0,0,0.55)'); // Mid transition
                    mainGradient.addColorStop(0.75, 'rgba(0,0,0,0.3)');  // Soft fade
                    mainGradient.addColorStop(0.9, 'rgba(0,0,0,0.1)');   // Very soft
                    mainGradient.addColorStop(1, 'rgba(0,0,0,0)');       // Complete fade
                    
                    maskCtx.fillStyle = mainGradient;
                    maskCtx.beginPath();
                    maskCtx.arc(screenX, screenY, lightRadius, 0, Math.PI * 2);
                    maskCtx.fill();
                    
                    // LAYER 3: Bright core - intense mystical center
                    const coreRadius = lightRadius * 0.4;
                    const coreGradient = maskCtx.createRadialGradient(
                        screenX, screenY, 0,
                        screenX, screenY, coreRadius
                    );
                    coreGradient.addColorStop(0, 'rgba(0,0,0,1)');      // Intense core
                    coreGradient.addColorStop(0.4, 'rgba(0,0,0,0.9)');  // Strong
                    coreGradient.addColorStop(0.7, 'rgba(0,0,0,0.5)');  // Fade
                    coreGradient.addColorStop(1, 'rgba(0,0,0,0)');      // Soft edge
                    
                    maskCtx.fillStyle = coreGradient;
                    maskCtx.beginPath();
                    maskCtx.arc(screenX, screenY, coreRadius, 0, Math.PI * 2);
                    maskCtx.fill();
                    
                    // Restore context if we applied a clip
                    if (enclosingCluster) {
                        maskCtx.restore();
                    }
                } else {
                    // Regular lantern - standard cutout
                    const flicker = sampleStableLightFlicker(lantern.posX, visualCenterWorldY, LANTERN_FLICKER_AMOUNT, 0, 0, 0.85);
                    const lightRadius = Math.max(0, (LANTERN_LIGHT_RADIUS_BASE * 1.8) + flicker.baseFlicker);
                    
                    renderClippedLightCutout(
                        maskCtx,
                        screenX,
                        screenY,
                        lightRadius,
                        [
                            { stop: 0.05, alpha: 1 },    // Full cutout at center
                            { stop: 0.3, alpha: 0.85 },  // Strong cutout zone
                            { stop: 0.6, alpha: 0.5 },   // Gradual transition
                            { stop: 0.85, alpha: 0.2 },  // Gentle fade
                            { stop: 1, alpha: 0 },       // Complete fade to darkness
                        ],
                        enclosingCluster,
                        cameraOffsetX,
                        cameraOffsetY
                    );
                }
            }
        });

        // Render furnace light cutouts with red gradient fill
        furnaces.forEach(furnace => {
            if (furnace.isBurning) {
                // Get correct dimensions based on furnace type and compound monument status
                const dims = getFurnaceDimensions(furnace.furnaceType, isCompoundMonument(furnace.isMonument, furnace.posX, furnace.posY));
                
                // Adjust Y position for the light source to be centered on the furnace
                const visualCenterWorldY = furnace.posY - (dims.height / 2) - dims.yOffset;
                
                const screenX = furnace.posX + cameraOffsetX;
                const screenY = visualCenterWorldY + cameraOffsetY;
                
                // Check if furnace is inside an enclosed building
                const enclosingCluster = buildingClusters 
                    ? findEnclosingCluster(furnace.posX, furnace.posY, buildingClusters)
                    : null;
                
                // Compound monument large furnaces get a bigger light cutout to match their size
                const isLargeFurnace = furnace.furnaceType === FURNACE_TYPE_LARGE;
                const isCompoundFurnace = isCompoundMonument(furnace.isMonument, furnace.posX, furnace.posY);
                const lightRadiusMultiplier = isLargeFurnace ? (isCompoundFurnace ? 4.0 : 3.0) : 2.0;
                const lightRadius = FURNACE_LIGHT_RADIUS_BASE * lightRadiusMultiplier;
                
                // Apply clip if inside a building (clip affects both cutout and red fill)
                if (enclosingCluster) {
                    maskCtx.save();
                    const clipPath = createClusterClipPath(enclosingCluster.cluster, cameraOffsetX, cameraOffsetY);
                    maskCtx.clip(clipPath);
                }
                
                // FIRST: Create the transparent cutout hole
                const maskGradient = maskCtx.createRadialGradient(screenX, screenY, lightRadius * 0.08, screenX, screenY, lightRadius);
                maskGradient.addColorStop(0, 'rgba(0,0,0,1)'); // Full cutout at center
                maskGradient.addColorStop(0.4, 'rgba(0,0,0,0.7)'); // Natural transition zone
                maskGradient.addColorStop(0.8, 'rgba(0,0,0,0.3)'); // Gentle fade
                maskGradient.addColorStop(1, 'rgba(0,0,0,0)'); // Complete fade to darkness
                maskCtx.fillStyle = maskGradient;
                maskCtx.beginPath();
                maskCtx.arc(screenX, screenY, lightRadius, 0, Math.PI * 2);
                maskCtx.fill();

                // SECOND: Fill the cutout with dark red gradient (switch composite mode back)
                maskCtx.globalCompositeOperation = 'source-over';
                const redFillRadius = lightRadius; // Same size as cutout to fill completely
                const redGradient = maskCtx.createRadialGradient(screenX, screenY, 0, screenX, screenY, redFillRadius);
                redGradient.addColorStop(0, 'rgba(140, 30, 18, 0.8)'); // Intense dark red center - eerie glow
                redGradient.addColorStop(0.15, 'rgba(120, 25, 15, 0.7)'); // Strong industrial red
                redGradient.addColorStop(0.35, 'rgba(100, 20, 12, 0.6)'); // Deep forge red
                redGradient.addColorStop(0.55, 'rgba(80, 15, 10, 0.5)'); // Darker red midpoint
                redGradient.addColorStop(0.75, 'rgba(60, 12, 8, 0.4)'); // Very dark red
                redGradient.addColorStop(0.9, 'rgba(40, 8, 5, 0.2)'); // Eerie dark edge
                redGradient.addColorStop(1, 'rgba(30, 6, 4, 0)'); // Natural fade to transparent
                maskCtx.fillStyle = redGradient;
                maskCtx.beginPath();
                maskCtx.arc(screenX, screenY, redFillRadius, 0, Math.PI * 2);
                maskCtx.fill();
                
                // Restore context if we applied a clip
                if (enclosingCluster) {
                    maskCtx.restore();
                }
                
                // Switch back to cutout mode for other lights
                maskCtx.globalCompositeOperation = 'destination-out';
            }
        });

        // Render barbecue light cutouts - smaller, subtle red/orange glow (cooking coals)
        barbecues.forEach(barbecue => {
            if (barbecue.isBurning) {
                // Sprite is CENTERED on posY, so visual center = posY
                const visualCenterWorldY = barbecue.posY;
                const adjustedGradientCenterWorldY = visualCenterWorldY;
                
                const screenX = barbecue.posX + cameraOffsetX;
                const screenY = adjustedGradientCenterWorldY + cameraOffsetY;
                
                // Check if barbecue is inside an enclosed building
                const enclosingCluster = buildingClusters 
                    ? findEnclosingCluster(barbecue.posX, barbecue.posY, buildingClusters)
                    : null;
                
                // SMALL BARBECUE CUTOUT - Much smaller than campfire, subtle glow from coals
                const lightRadius = BARBECUE_LIGHT_RADIUS_BASE * 1.0; // Smaller radius for realistic cooking glow
                
                // Apply clip if inside a building (clip affects both cutout and red fill)
                if (enclosingCluster) {
                    maskCtx.save();
                    const clipPath = createClusterClipPath(enclosingCluster.cluster, cameraOffsetX, cameraOffsetY);
                    maskCtx.clip(clipPath);
                }
                
                // FIRST: Create a small transparent cutout hole (much smaller than campfire)
                const maskGradient = maskCtx.createRadialGradient(screenX, screenY, lightRadius * 0.05, screenX, screenY, lightRadius);
                maskGradient.addColorStop(0, 'rgba(0,0,0,0.5)'); // Partial cutout at center (not full)
                maskGradient.addColorStop(0.3, 'rgba(0,0,0,0.3)'); // Gentle transition
                maskGradient.addColorStop(0.6, 'rgba(0,0,0,0.15)'); // Subtle fade
                maskGradient.addColorStop(1, 'rgba(0,0,0,0)'); // Complete fade to darkness
                maskCtx.fillStyle = maskGradient;
                maskCtx.beginPath();
                maskCtx.arc(screenX, screenY, lightRadius, 0, Math.PI * 2);
                maskCtx.fill();

                // SECOND: Fill the cutout with warm red-orange coal glow (switch composite mode back)
                maskCtx.globalCompositeOperation = 'source-over';
                const glowFillRadius = lightRadius * 0.9; // Slightly smaller than cutout
                const glowGradient = maskCtx.createRadialGradient(screenX, screenY, 0, screenX, screenY, glowFillRadius);
                glowGradient.addColorStop(0, 'rgba(200, 60, 30, 0.35)'); // Warm red-orange center - hot coals
                glowGradient.addColorStop(0.2, 'rgba(180, 50, 25, 0.28)'); // Deep ember red
                glowGradient.addColorStop(0.4, 'rgba(150, 40, 20, 0.20)'); // Darker coal red
                glowGradient.addColorStop(0.6, 'rgba(120, 30, 15, 0.12)'); // Very subtle red
                glowGradient.addColorStop(0.8, 'rgba(90, 20, 10, 0.06)'); // Faint edge glow
                glowGradient.addColorStop(1, 'rgba(60, 15, 8, 0)'); // Natural fade to transparent
                maskCtx.fillStyle = glowGradient;
                maskCtx.beginPath();
                maskCtx.arc(screenX, screenY, glowFillRadius, 0, Math.PI * 2);
                maskCtx.fill();
                
                // Restore context if we applied a clip
                if (enclosingCluster) {
                    maskCtx.restore();
                }
                
                // Switch back to cutout mode for other lights
                maskCtx.globalCompositeOperation = 'destination-out';
            }
        });

        // Render road lamppost light cutouts (Aleutian whale oil - always on at night)
        roadLampposts.forEach(lamppost => {
            // Light center is above the lantern (same as renderRoadLamppostLight)
            const lightCenterWorldY = lamppost.posY + ROAD_LAMP_LIGHT_Y_OFFSET;
            const screenX = lamppost.posX + cameraOffsetX;
            const screenY = lightCenterWorldY + cameraOffsetY;
            const lightRadius = ROAD_LAMP_LIGHT_RADIUS_BASE * 2.0; // Double for cutout visibility
            const maskGradient = maskCtx.createRadialGradient(screenX, screenY, lightRadius * 0.05, screenX, screenY, lightRadius);
            maskGradient.addColorStop(0, 'rgba(0,0,0,1)'); // Full cutout at center
            maskGradient.addColorStop(0.2, 'rgba(0,0,0,0.9)'); // Strong cutout zone
            maskGradient.addColorStop(0.5, 'rgba(0,0,0,0.6)'); // Warm whale oil fade
            maskGradient.addColorStop(0.8, 'rgba(0,0,0,0.2)'); // Soft edge
            maskGradient.addColorStop(1, 'rgba(0,0,0,0)'); // Fade to darkness
            maskCtx.fillStyle = maskGradient;
            maskCtx.beginPath();
            maskCtx.arc(screenX, screenY, lightRadius, 0, Math.PI * 2);
            maskCtx.fill();
        });

        // Render buoy light cutouts (variant 6 - red LED navigational markers, same "lights on" as road lamps)
        const cp = currentCycleProgress;
        if (typeof cp === 'number' && isNightTime(cp)) {
            const BUOY_VARIANT = 6;
            const BUOY_Y_OFFSET = 28;
            const BUOY_LIGHT_Y_OFFSET = -(BUOY_HEIGHT + BUOY_Y_OFFSET) + BUOY_HEIGHT * 0.12 + 20; // LED position, dropped 20px
            barrels.forEach(barrel => {
                if ((barrel.variant ?? 0) !== BUOY_VARIANT) return;
                if (barrel.respawnAt && barrel.respawnAt.microsSinceUnixEpoch !== 0n) return;
                const lightCenterWorldY = barrel.posY + BUOY_LIGHT_Y_OFFSET;
                const screenX = barrel.posX + cameraOffsetX;
                const screenY = lightCenterWorldY + cameraOffsetY;
                const lightRadius = BUOY_LIGHT_RADIUS_BASE * 2.0; // Double for cutout visibility
                const maskGradient = maskCtx.createRadialGradient(screenX, screenY, lightRadius * 0.05, screenX, screenY, lightRadius);
                maskGradient.addColorStop(0, 'rgba(0,0,0,1)'); // Full cutout at center
                maskGradient.addColorStop(0.2, 'rgba(0,0,0,0.9)'); // Strong cutout zone
                maskGradient.addColorStop(0.5, 'rgba(0,0,0,0.6)'); // Red LED fade
                maskGradient.addColorStop(0.8, 'rgba(0,0,0,0.2)'); // Soft edge
                maskGradient.addColorStop(1, 'rgba(0,0,0,0)'); // Fade to darkness
                maskCtx.fillStyle = maskGradient;
                maskCtx.beginPath();
                maskCtx.arc(screenX, screenY, lightRadius, 0, Math.PI * 2);
                maskCtx.fill();
            });
        }

        // Render torch light cutouts
        players.forEach((player, playerId) => {
            if (!player || player.isDead) return;

            const equipment = activeEquipments.get(playerId);
            if (!equipment || !equipment.equippedItemDefId) {
                return;
            }
            const itemDef = itemDefinitions.get(equipment.equippedItemDefId.toString());
            if (!itemDef || itemDef.name !== "Torch") {
                return;
            }

            if (itemDef && itemDef.name === "Torch" && player.isTorchLit) {
                // Use the same interpolated position logic as torch light rendering for smooth cutouts
                let renderPositionX = player.positionX;
                let renderPositionY = player.positionY;
                
                if (playerId === localPlayerId && predictedPosition) {
                    // For local player, use predicted position
                    renderPositionX = predictedPosition.x;
                    renderPositionY = predictedPosition.y;
                } else if (playerId !== localPlayerId && remotePlayerInterpolation) {
                    // For remote players, use interpolated position
                    const interpolatedPos = remotePlayerInterpolation.updateAndGetSmoothedPosition(player, localPlayerId);
                    if (interpolatedPos) {
                        renderPositionX = interpolatedPos.x;
                        renderPositionY = interpolatedPos.y;
                    }
                }
                
                // Check if player with torch is inside an enclosed building
                const enclosingCluster = buildingClusters 
                    ? findEnclosingCluster(renderPositionX, renderPositionY, buildingClusters)
                    : null;
                
                const lightScreenX = renderPositionX + cameraOffsetX;
                const lightScreenY = renderPositionY + cameraOffsetY;

                // TORCH CUTOUT - 1.25x larger inner bright area with natural rustic gradient
                const flicker = sampleStableLightFlicker(renderPositionX, renderPositionY, TORCH_FLICKER_AMOUNT, 0, 0, 1.05);
                const currentLightRadius = Math.max(0, (TORCH_LIGHT_RADIUS_BASE * 1.25) + flicker.baseFlicker);

                // Use clipped rendering if inside a building
                renderClippedLightCutout(
                    maskCtx,
                    lightScreenX,
                    lightScreenY,
                    currentLightRadius,
                    [
                        { stop: 0.12, alpha: 1 },    // Full cutout at center
                        { stop: 0.35, alpha: 0.8 },  // Natural transition zone
                        { stop: 0.75, alpha: 0.4 },  // Gentle fade
                        { stop: 1, alpha: 0 },       // Complete fade to darkness
                    ],
                    enclosingCluster,
                    cameraOffsetX,
                    cameraOffsetY
                );
            }
        });

        // Render headlamp light cutouts (head armor - tallow burning lamp)
        players.forEach((player, playerId) => {
            if (!player || player.isDead || !player.isHeadlampLit) return;

            // Use the same interpolated position logic as other lights for smooth cutouts
            let renderPositionX = player.positionX;
            let renderPositionY = player.positionY;
            
            if (playerId === localPlayerId && predictedPosition) {
                // For local player, use predicted position
                renderPositionX = predictedPosition.x;
                renderPositionY = predictedPosition.y;
            } else if (playerId !== localPlayerId && remotePlayerInterpolation) {
                // For remote players, use interpolated position
                const interpolatedPos = remotePlayerInterpolation.updateAndGetSmoothedPosition(player, localPlayerId);
                if (interpolatedPos) {
                    renderPositionX = interpolatedPos.x;
                    renderPositionY = interpolatedPos.y;
                }
            }
            
            // Check if player with headlamp is inside an enclosed building
            const enclosingCluster = buildingClusters 
                ? findEnclosingCluster(renderPositionX, renderPositionY, buildingClusters)
                : null;
            
            const lightScreenX = renderPositionX + cameraOffsetX;
            const lightScreenY = renderPositionY + cameraOffsetY;

            // Headlamp cutout - same style as torch, scaled up (2x torch radius)
            const flicker = sampleStableLightFlicker(renderPositionX, renderPositionY, HEADLAMP_FLICKER_AMOUNT, 0, 0, 1.05);
            const currentLightRadius = Math.max(0, (HEADLAMP_LIGHT_RADIUS_BASE * 1.25) + flicker.baseFlicker);

            // Use clipped rendering if inside a building
            renderClippedLightCutout(
                maskCtx,
                lightScreenX,
                lightScreenY,
                currentLightRadius,
                [
                    { stop: 0.12, alpha: 1 },    // Full cutout at center
                    { stop: 0.35, alpha: 0.8 },  // Natural transition zone
                    { stop: 0.75, alpha: 0.4 },  // Gentle fade
                    { stop: 1, alpha: 0 },       // Complete fade to darkness
                ],
                enclosingCluster,
                cameraOffsetX,
                cameraOffsetY
            );
        });

        // Render flashlight beam cutouts (AAA pixel art style - narrow, long beam)
        players.forEach((player, playerId) => {
            if (!player || player.isDead || !player.isFlashlightOn) return;

            // Player has flashlight on - render the beam cutout
            // Use the same interpolated position logic as torch light rendering for smooth cutouts
            let renderPositionX = player.positionX;
            let renderPositionY = player.positionY;
            
            if (playerId === localPlayerId && predictedPosition) {
                // For local player, use predicted position
                renderPositionX = predictedPosition.x;
                renderPositionY = predictedPosition.y;
            } else if (playerId !== localPlayerId && remotePlayerInterpolation) {
                // For remote players, use interpolated position
                const interpolatedPos = remotePlayerInterpolation.updateAndGetSmoothedPosition(player, localPlayerId);
                if (interpolatedPos) {
                    renderPositionX = interpolatedPos.x;
                    renderPositionY = interpolatedPos.y;
                }
            }
            
            // Check if player with flashlight is inside an enclosed building
            const enclosingCluster = buildingClusters 
                ? findEnclosingCluster(renderPositionX, renderPositionY, buildingClusters)
                : null;

            // FLASHLIGHT BEAM - Narrow, long cone cutout (matches lightRenderingUtils constants)
            const FLASHLIGHT_BEAM_LENGTH = 650; // Very long reach for exploration
            const FLASHLIGHT_BEAM_ANGLE = Math.PI / 7; // ~25 degrees - narrow focused beam
            const FLASHLIGHT_START_OFFSET = 18; // Start beam slightly ahead of player
            
            // Determine beam direction - use mouse target for local player, synced angle for remote players
            let beamAngle = 0;
            const isLocalPlayerFlashlight = playerId === localPlayerId;
            
            if (isLocalPlayerFlashlight && 
                worldMouseX !== undefined && worldMouseX !== null && 
                worldMouseY !== undefined && worldMouseY !== null) {
                // Calculate angle from player to mouse for smooth 360° aiming (local player)
                const dx = worldMouseX - renderPositionX;
                const dy = worldMouseY - renderPositionY;
                beamAngle = Math.atan2(dy, dx);
            } else {
                // Use synced flashlight aim angle for remote players
                beamAngle = player.flashlightAimAngle ?? 0;
            }

            // Offset the beam start position slightly ahead of the player
            const offsetX = Math.cos(beamAngle) * FLASHLIGHT_START_OFFSET;
            const offsetY = Math.sin(beamAngle) * FLASHLIGHT_START_OFFSET;
            
            const lightScreenX = renderPositionX + cameraOffsetX + offsetX;
            const lightScreenY = renderPositionY + cameraOffsetY + offsetY;

            // Calculate cone vertices - narrow, long beam
            const startX = lightScreenX;
            const startY = lightScreenY;
            const endX = startX + Math.cos(beamAngle) * FLASHLIGHT_BEAM_LENGTH;
            const endY = startY + Math.sin(beamAngle) * FLASHLIGHT_BEAM_LENGTH;
            
            // Calculate cone width at the end (half-width) - narrow cone
            const halfWidth = FLASHLIGHT_BEAM_LENGTH * Math.tan(FLASHLIGHT_BEAM_ANGLE / 2);
            
            // Perpendicular vector for cone width
            const perpX = -Math.sin(beamAngle) * halfWidth;
            const perpY = Math.cos(beamAngle) * halfWidth;
            
            const leftX = endX + perpX;
            const leftY = endY + perpY;
            const rightX = endX - perpX;
            const rightY = endY - perpY;

            // Apply clipping if inside a building (same pattern as torch/campfire)
            if (enclosingCluster) {
                maskCtx.save();
                const clipPath = createClusterClipPath(enclosingCluster.cluster, cameraOffsetX, cameraOffsetY);
                maskCtx.clip(clipPath);
            }

            // === LAYER 1: Wide outer glow cutout (soft ambient light) ===
            const outerGlowLength = FLASHLIGHT_BEAM_LENGTH * 1.15;
            const outerGlowWidth = halfWidth * 1.5;
            const outerEndX = startX + Math.cos(beamAngle) * outerGlowLength;
            const outerEndY = startY + Math.sin(beamAngle) * outerGlowLength;
            const outerLeftX = outerEndX + (-Math.sin(beamAngle) * outerGlowWidth);
            const outerLeftY = outerEndY + (Math.cos(beamAngle) * outerGlowWidth);
            const outerRightX = outerEndX - (-Math.sin(beamAngle) * outerGlowWidth);
            const outerRightY = outerEndY - (Math.cos(beamAngle) * outerGlowWidth);

            const outerGradient = maskCtx.createLinearGradient(startX, startY, outerEndX, outerEndY);
            outerGradient.addColorStop(0, 'rgba(0,0,0,0.5)');
            outerGradient.addColorStop(0.4, 'rgba(0,0,0,0.3)');
            outerGradient.addColorStop(0.7, 'rgba(0,0,0,0.12)');
            outerGradient.addColorStop(1, 'rgba(0,0,0,0)');

            maskCtx.fillStyle = outerGradient;
            maskCtx.beginPath();
            maskCtx.moveTo(startX, startY);
            maskCtx.lineTo(outerLeftX, outerLeftY);
            maskCtx.lineTo(outerRightX, outerRightY);
            maskCtx.closePath();
            maskCtx.fill();

            // === LAYER 2: Main beam cutout ===
            const mainGradient = maskCtx.createLinearGradient(startX, startY, endX, endY);
            mainGradient.addColorStop(0, 'rgba(0,0,0,1)'); // Full cutout at start
            mainGradient.addColorStop(0.2, 'rgba(0,0,0,0.95)');
            mainGradient.addColorStop(0.45, 'rgba(0,0,0,0.75)');
            mainGradient.addColorStop(0.65, 'rgba(0,0,0,0.45)');
            mainGradient.addColorStop(0.85, 'rgba(0,0,0,0.15)');
            mainGradient.addColorStop(1, 'rgba(0,0,0,0)');

            maskCtx.fillStyle = mainGradient;
            maskCtx.beginPath();
            maskCtx.moveTo(startX, startY);
            maskCtx.lineTo(leftX, leftY);
            maskCtx.lineTo(rightX, rightY);
            maskCtx.closePath();
            maskCtx.fill();

            // === LAYER 3: Hot core beam cutout (brightest center) ===
            const coreLength = FLASHLIGHT_BEAM_LENGTH * 0.7;
            const coreWidth = halfWidth * 0.4;
            const coreEndX = startX + Math.cos(beamAngle) * coreLength;
            const coreEndY = startY + Math.sin(beamAngle) * coreLength;
            const coreLeftX = coreEndX + (-Math.sin(beamAngle) * coreWidth);
            const coreLeftY = coreEndY + (Math.cos(beamAngle) * coreWidth);
            const coreRightX = coreEndX - (-Math.sin(beamAngle) * coreWidth);
            const coreRightY = coreEndY - (Math.cos(beamAngle) * coreWidth);

            const coreGradient = maskCtx.createLinearGradient(startX, startY, coreEndX, coreEndY);
            coreGradient.addColorStop(0, 'rgba(0,0,0,1)'); // Full cutout
            coreGradient.addColorStop(0.35, 'rgba(0,0,0,0.95)');
            coreGradient.addColorStop(0.7, 'rgba(0,0,0,0.6)');
            coreGradient.addColorStop(1, 'rgba(0,0,0,0)');

            maskCtx.fillStyle = coreGradient;
            maskCtx.beginPath();
            maskCtx.moveTo(startX, startY);
            maskCtx.lineTo(coreLeftX, coreLeftY);
            maskCtx.lineTo(coreRightX, coreRightY);
            maskCtx.closePath();
            maskCtx.fill();

            // === LAYER 4: Bright hotspot at source ===
            const hotspotRadius = 20;
            const hotspotGradient = maskCtx.createRadialGradient(
                startX, startY, 0,
                startX, startY, hotspotRadius
            );
            hotspotGradient.addColorStop(0, 'rgba(0,0,0,1)');
            hotspotGradient.addColorStop(0.5, 'rgba(0,0,0,0.7)');
            hotspotGradient.addColorStop(1, 'rgba(0,0,0,0)');

            maskCtx.fillStyle = hotspotGradient;
            maskCtx.beginPath();
            maskCtx.arc(startX, startY, hotspotRadius, 0, Math.PI * 2);
            maskCtx.fill();

            // Restore context if we applied a clip
            if (enclosingCluster) {
                maskCtx.restore();
            }
        });

        // ============================================================================
        // SOVA AURA - Local player night-vision aid (client-side only)
        // ============================================================================
        // Renders a subtle cutout around the LOCAL player ONLY during nighttime.
        // This helps the player see in the dark without competing with actual light sources.
        // It is purely visual - no gameplay effects, not visible to remote players, not on minimap.
        // ============================================================================
        if (typeof currentCycleProgress === 'number' && localPlayerId && predictedPosition) {
            if (isNightTime(currentCycleProgress)) {
                const lightScreenX = predictedPosition.x + cameraOffsetX;
                const lightScreenY = predictedPosition.y + cameraOffsetY;
                
                // SOVA Aura cutout - subtle visibility bubble, weaker than torch
                // Uses very soft alpha values to avoid competing with actual light sources
                const auraRadius = SOVA_AURA_RADIUS_BASE;
                
                const maskGradient = maskCtx.createRadialGradient(
                    lightScreenX, lightScreenY, auraRadius * 0.05, // Inner radius (5% of total)
                    lightScreenX, lightScreenY, auraRadius // Outer radius
                );
                
                // Very soft cutout - much weaker than torch (which uses 1.0, 0.8, 0.4, 0)
                // This creates a subtle visibility improvement without overpowering the night
                maskGradient.addColorStop(0, 'rgba(0,0,0,0.35)'); // Subtle visibility at center (torch is 1.0)
                maskGradient.addColorStop(0.3, 'rgba(0,0,0,0.25)'); // Soft transition
                maskGradient.addColorStop(0.6, 'rgba(0,0,0,0.12)'); // Gentle fade
                maskGradient.addColorStop(0.85, 'rgba(0,0,0,0.04)'); // Very soft edge
                maskGradient.addColorStop(1, 'rgba(0,0,0,0)'); // Complete fade to darkness
                
                maskCtx.fillStyle = maskGradient;
                maskCtx.beginPath();
                maskCtx.arc(lightScreenX, lightScreenY, auraRadius, 0, Math.PI * 2);
                maskCtx.fill();
            }
        }
        // === END SOVA AURA ===

        // ═══════════════════════════════════════════════════════════════
        // COMPOUND-WIDE EERIE LIGHT - Large circular cutout covering entire asphalt area
        // Gives the whole compound a dim, otherworldly illumination at night
        // ═══════════════════════════════════════════════════════════════
        const compoundCenter = getWorldCenter();
        const compoundScreenX = compoundCenter.x + cameraOffsetX;
        const compoundScreenY = compoundCenter.y + cameraOffsetY;
        // Asphalt area is ±768px from center. Use ~900px radius for soft edge beyond asphalt.
        const compoundLightRadius = 900;
        const compoundLightVisible =
            compoundScreenX + compoundLightRadius >= 0 &&
            compoundScreenX - compoundLightRadius <= canvasSize.width &&
            compoundScreenY + compoundLightRadius >= 0 &&
            compoundScreenY - compoundLightRadius <= canvasSize.height;

        if (compoundLightVisible) {
            // Large dim cutout - not fully bright, just lifts the darkness enough to see
            const compoundCutout = maskCtx.createRadialGradient(
                compoundScreenX, compoundScreenY, compoundLightRadius * 0.15,
                compoundScreenX, compoundScreenY, compoundLightRadius
            );
            compoundCutout.addColorStop(0, 'rgba(0,0,0,0.55)');    // Moderate cutout at center
            compoundCutout.addColorStop(0.3, 'rgba(0,0,0,0.45)');  // Gradual falloff
            compoundCutout.addColorStop(0.6, 'rgba(0,0,0,0.30)');  // Mid fade
            compoundCutout.addColorStop(0.8, 'rgba(0,0,0,0.12)');  // Soft edge
            compoundCutout.addColorStop(0.92, 'rgba(0,0,0,0.04)'); // Very soft edge
            compoundCutout.addColorStop(1, 'rgba(0,0,0,0)');       // Complete fade
            
            maskCtx.fillStyle = compoundCutout;
            maskCtx.beginPath();
            maskCtx.arc(compoundScreenX, compoundScreenY, compoundLightRadius, 0, Math.PI * 2);
            maskCtx.fill();
            
            // Add eerie blue/purple tint over the entire compound
            maskCtx.globalCompositeOperation = 'source-over';
            const compoundGlowRadius = compoundLightRadius * 0.85;
            const compoundGlow = maskCtx.createRadialGradient(
                compoundScreenX, compoundScreenY, 0,
                compoundScreenX, compoundScreenY, compoundGlowRadius
            );
            compoundGlow.addColorStop(0, 'rgba(60, 90, 180, 0.10)');    // Subtle blue center
            compoundGlow.addColorStop(0.3, 'rgba(80, 100, 200, 0.08)'); // Blue mid
            compoundGlow.addColorStop(0.5, 'rgba(100, 90, 210, 0.06)'); // Blue-purple blend
            compoundGlow.addColorStop(0.7, 'rgba(120, 85, 200, 0.03)'); // Fading purple
            compoundGlow.addColorStop(1, 'rgba(30, 50, 100, 0)');       // Fade to transparent
            
            maskCtx.fillStyle = compoundGlow;
            maskCtx.beginPath();
            maskCtx.arc(compoundScreenX, compoundScreenY, compoundGlowRadius, 0, Math.PI * 2);
            maskCtx.fill();
            maskCtx.globalCompositeOperation = 'destination-out';
        }

        // Individual compound hotspots are rendered in the late world pass. Keeping
        // them out of the fullscreen night mask avoids 32 extra gradients per frame
        // when the central compound is visible.

        // Render fire patch light cutouts (smaller than campfires, same size as the patch)
        firePatches.forEach(firePatch => {
            // Fire patches are always burning (no isBurning check needed)
            // Skip if intensity is too low
            if (firePatch.currentIntensity < 0.1) return;
            
            const screenX = firePatch.posX + cameraOffsetX;
            const screenY = firePatch.posY + cameraOffsetY;
            
            // Fire patch cutout - smaller than campfire, matches the visual radius
            // Use the same radius as the visual fire patch (FIRE_PATCH_VISUAL_RADIUS = 40)
            const lightRadius = FIRE_PATCH_VISUAL_RADIUS * 1.5; // Slightly larger cutout for better visibility
            const maskGradient = maskCtx.createRadialGradient(screenX, screenY, lightRadius * 0.08, screenX, screenY, lightRadius);
            maskGradient.addColorStop(0, 'rgba(0,0,0,1)'); // Full cutout at center
            maskGradient.addColorStop(0.4, 'rgba(0,0,0,0.7)'); // Natural transition zone
            maskGradient.addColorStop(0.8, 'rgba(0,0,0,0.3)'); // Gentle fade
            maskGradient.addColorStop(1, 'rgba(0,0,0,0)'); // Complete fade to darkness
            maskCtx.fillStyle = maskGradient;
            maskCtx.beginPath();
            maskCtx.arc(screenX, screenY, lightRadius, 0, Math.PI * 2);
            maskCtx.fill();
        });

        // Render fumarole light cutouts - geothermal vents emit heat/light visible at night
        // Fumaroles are always active (no isBurning check needed)
        fumaroles.forEach(fumarole => {
            const screenX = fumarole.posX + cameraOffsetX;
            const screenY = fumarole.posY + cameraOffsetY;
            
            // Fumarole cutout radius - large heat area (600px warmth radius on server)
            const FUMAROLE_CUTOUT_RADIUS = 300; // Visual cutout is half the warmth radius for better aesthetics
            const lightRadius = FUMAROLE_CUTOUT_RADIUS;
            
            // FIRST: Create the transparent cutout hole for visibility
            const maskGradient = maskCtx.createRadialGradient(
                screenX, screenY, lightRadius * 0.05, // Inner radius (5% of total)
                screenX, screenY, lightRadius // Outer radius
            );
            
            // Strong cutout with smooth fade - creates visible area around fumarole
            maskGradient.addColorStop(0, 'rgba(0,0,0,1)'); // Full cutout at center
            maskGradient.addColorStop(0.25, 'rgba(0,0,0,0.85)'); // Strong cutout zone
            maskGradient.addColorStop(0.5, 'rgba(0,0,0,0.6)'); // Gradual transition
            maskGradient.addColorStop(0.75, 'rgba(0,0,0,0.3)'); // Gentle fade
            maskGradient.addColorStop(1, 'rgba(0,0,0,0)'); // Complete fade to darkness
            
            maskCtx.fillStyle = maskGradient;
            maskCtx.beginPath();
            maskCtx.arc(screenX, screenY, lightRadius, 0, Math.PI * 2);
            maskCtx.fill();

            // SECOND: Fill the cutout with warm orange/red geothermal glow (switch composite mode back)
            maskCtx.globalCompositeOperation = 'source-over';
            
            // Add subtle heat shimmer effect using time-based intensity
            const heatPulse = (Date.now() / 2000) % (Math.PI * 2); // 2 second cycle
            const heatIntensity = 1.0 + Math.sin(heatPulse) * 0.1; // ±10% pulse
            
            // Warm orange-red geothermal glow gradient
            const heatFillRadius = lightRadius; // Same size as cutout to fill completely
            const heatGradient = maskCtx.createRadialGradient(screenX, screenY, 0, screenX, screenY, heatFillRadius);
            heatGradient.addColorStop(0, `rgba(255, 120, 40, ${0.35 * heatIntensity})`); // Bright orange center - intense heat
            heatGradient.addColorStop(0.15, `rgba(240, 90, 30, ${0.30 * heatIntensity})`); // Hot orange
            heatGradient.addColorStop(0.35, `rgba(200, 70, 25, ${0.22 * heatIntensity})`); // Deep orange-red
            heatGradient.addColorStop(0.55, `rgba(160, 50, 20, ${0.15 * heatIntensity})`); // Dark red-orange
            heatGradient.addColorStop(0.75, `rgba(120, 40, 15, ${0.08 * heatIntensity})`); // Very dark red
            heatGradient.addColorStop(0.9, `rgba(80, 30, 10, ${0.03 * heatIntensity})`); // Faint edge glow
            heatGradient.addColorStop(1, 'rgba(60, 20, 8, 0)'); // Natural fade to transparent
            
            maskCtx.fillStyle = heatGradient;
            maskCtx.beginPath();
            maskCtx.arc(screenX, screenY, heatFillRadius, 0, Math.PI * 2);
            maskCtx.fill();
            
            // Switch back to cutout mode for other lights
            maskCtx.globalCompositeOperation = 'destination-out';
        });

        // Render rune stone light cutouts with colored atmospheric glows (shared day/night constants)
        if (typeof currentCycleProgress === 'number') {
            if (isNightTime(currentCycleProgress)) {
                runeStones.forEach(runeStone => {
                    // Center on the rune stone light center (offset upward to match visual mass)
                    // LIGHT_CENTER_Y_OFFSET = 140 (doubled from 70) - matches runeStoneRenderingUtils.ts
                    const LIGHT_CENTER_Y_OFFSET = 140;
                    const screenX = runeStone.posX + cameraOffsetX;
                    const screenY = runeStone.posY + cameraOffsetY - LIGHT_CENTER_Y_OFFSET;
                    
                    // Larger cutout radius to match doubled rune stone size (was 600, now 880 to match NIGHT_LIGHT_RADIUS * 2)
                    const RUNE_STONE_CUTOUT_RADIUS = 880;
                    const lightRadius = RUNE_STONE_CUTOUT_RADIUS;
                    
                    // FIRST: Create the transparent cutout hole
                    const maskGradient = maskCtx.createRadialGradient(
                        screenX, screenY, lightRadius * 0.05, // Inner radius (5% of total)
                        screenX, screenY, lightRadius // Outer radius
                    );
                    
                    // Strong cutout with smooth fade - creates visible light area
                    maskGradient.addColorStop(0, 'rgba(0,0,0,1)'); // Full cutout at center
                    maskGradient.addColorStop(0.2, 'rgba(0,0,0,0.9)'); // Strong cutout zone
                    maskGradient.addColorStop(0.4, 'rgba(0,0,0,0.7)'); // Gradual transition
                    maskGradient.addColorStop(0.6, 'rgba(0,0,0,0.5)'); // Mid fade
                    maskGradient.addColorStop(0.8, 'rgba(0,0,0,0.25)'); // Gentle fade
                    maskGradient.addColorStop(1, 'rgba(0,0,0,0)'); // Complete fade to darkness
                    
                    maskCtx.fillStyle = maskGradient;
                    maskCtx.beginPath();
                    maskCtx.arc(screenX, screenY, lightRadius, 0, Math.PI * 2);
                    maskCtx.fill();

                    // SECOND: Fill the entire cutout area with diffuse atmospheric color glow (AAA Sea of Stars quality)
                    // Multi-layered approach: entire area bathed in magical light, not just a ring
                    maskCtx.globalCompositeOperation = 'source-over';
                    
                    // Determine rune stone color and calculate time-based intensity
                    const runeType = runeStone.runeType?.tag || 'Blue';
                    
                    // Calculate intensity based on time of night (subtle pulsing effect)
                    let timeIntensity = 1.0;
                    if (currentCycleProgress < LIGHT_FADE_FULL_AT) {
                        timeIntensity = (currentCycleProgress - NIGHT_LIGHTS_ON) / (LIGHT_FADE_FULL_AT - NIGHT_LIGHTS_ON);
                    } else if (currentCycleProgress >= TWILIGHT_MORNING_FADE_START) {
                        timeIntensity = (TWILIGHT_MORNING_END - currentCycleProgress) / (TWILIGHT_MORNING_END - TWILIGHT_MORNING_FADE_START);
                    }
                    // Add subtle breathing/pulsing effect (very gentle, mystical)
                    const breathingPhase = (Date.now() / 3000) % (Math.PI * 2); // 3 second cycle
                    const breathingIntensity = 1.0 + Math.sin(breathingPhase) * 0.08; // ±8% gentle pulse
                    const finalIntensity = timeIntensity * breathingIntensity;
                    
                    // LAYER 1: Ambient atmospheric glow - fills entire cutout area with soft color tint
                    // Gradient radius matches cutout radius exactly - fills the entire 600px cutout area
                    const ambientRadius = lightRadius; // Same as cutout radius - fills entire cutout area
                    let ambientGradient: CanvasGradient;
                    
                    if (runeType === 'Green') {
                        // Emerald - Mystical agrarian magic: fills entire cutout with strong color
                        ambientGradient = maskCtx.createRadialGradient(screenX, screenY, 0, screenX, screenY, ambientRadius);
                        ambientGradient.addColorStop(0, `rgba(40, 140, 50, ${0.25 * finalIntensity})`); // Bright emerald center
                        ambientGradient.addColorStop(0.2, `rgba(38, 135, 48, ${0.24 * finalIntensity})`); // Strong emerald
                        ambientGradient.addColorStop(0.5, `rgba(35, 120, 45, ${0.23 * finalIntensity})`); // Rich emerald - maintains strength
                        ambientGradient.addColorStop(0.8, `rgba(33, 115, 43, ${0.22 * finalIntensity})`); // Still strong emerald
                        ambientGradient.addColorStop(0.95, `rgba(30, 105, 40, ${0.18 * finalIntensity})`); // Slight fade near edge
                        ambientGradient.addColorStop(1, 'rgba(25, 90, 35, 0)'); // Only fade at very edge
                    } else if (runeType === 'Red') {
                        // Crimson - Forge fire magic: fills entire cutout with strong color
                        ambientGradient = maskCtx.createRadialGradient(screenX, screenY, 0, screenX, screenY, ambientRadius);
                        ambientGradient.addColorStop(0, `rgba(200, 50, 50, ${0.28 * finalIntensity})`); // Bright crimson center
                        ambientGradient.addColorStop(0.2, `rgba(195, 48, 48, ${0.27 * finalIntensity})`); // Strong crimson
                        ambientGradient.addColorStop(0.5, `rgba(180, 45, 45, ${0.26 * finalIntensity})`); // Rich crimson - maintains strength
                        ambientGradient.addColorStop(0.8, `rgba(175, 43, 43, ${0.25 * finalIntensity})`); // Still strong crimson
                        ambientGradient.addColorStop(0.95, `rgba(165, 40, 40, ${0.20 * finalIntensity})`); // Slight fade near edge
                        ambientGradient.addColorStop(1, 'rgba(150, 35, 35, 0)'); // Only fade at very edge
                    } else {
                        // Azure - Memory shard magic: fills entire cutout with strong color
                        ambientGradient = maskCtx.createRadialGradient(screenX, screenY, 0, screenX, screenY, ambientRadius);
                        ambientGradient.addColorStop(0, `rgba(60, 140, 220, ${0.26 * finalIntensity})`); // Bright azure center
                        ambientGradient.addColorStop(0.2, `rgba(58, 135, 215, ${0.25 * finalIntensity})`); // Strong azure
                        ambientGradient.addColorStop(0.5, `rgba(55, 120, 200, ${0.24 * finalIntensity})`); // Rich azure - maintains strength
                        ambientGradient.addColorStop(0.8, `rgba(53, 115, 195, ${0.23 * finalIntensity})`); // Still strong azure
                        ambientGradient.addColorStop(0.95, `rgba(50, 105, 185, ${0.19 * finalIntensity})`); // Slight fade near edge
                        ambientGradient.addColorStop(1, 'rgba(45, 90, 170, 0)'); // Only fade at very edge
                    }
                    
                    maskCtx.fillStyle = ambientGradient;
                    maskCtx.beginPath();
                    maskCtx.arc(screenX, screenY, ambientRadius, 0, Math.PI * 2);
                    maskCtx.fill();
                    
                    // Switch back to cutout mode for other lights
                    maskCtx.globalCompositeOperation = 'destination-out';
                });
            }
        }
        
        maskCtx.globalCompositeOperation = 'source-over';
    };
}
