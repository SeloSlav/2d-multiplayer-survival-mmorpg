import { useEffect, useRef, useState, useMemo } from 'react';
import {
    Campfire as SpacetimeDBCampfire,
    Lantern as SpacetimeDBLantern,
    WorldState as SpacetimeDBWorldState,
    Player as SpacetimeDBPlayer,
    ActiveEquipment as SpacetimeDBActiveEquipment,
    ItemDefinition as SpacetimeDBItemDefinition,
} from '../generated';
import { CAMPFIRE_LIGHT_RADIUS_BASE, CAMPFIRE_FLICKER_AMOUNT, LANTERN_LIGHT_RADIUS_BASE, LANTERN_FLICKER_AMOUNT } from '../utils/renderers/lightRenderingUtils';
import { CAMPFIRE_HEIGHT } from '../utils/renderers/campfireRenderingUtils';
import { LANTERN_HEIGHT } from '../utils/renderers/lanternRenderingUtils';

export interface ColorPoint {
  r: number; g: number; b: number; a: number;
}

// Default night: Dark, desaturated blue/grey
export const defaultPeakMidnightColor: ColorPoint = { r: 0, g: 0, b: 0, a: 1.0 };
export const defaultTransitionNightColor: ColorPoint = { r: 40, g: 50, b: 70, a: 0.75 };

// Full Moon night: Brighter, cooler grey/blue, less saturated
export const fullMoonPeakMidnightColor: ColorPoint =    { r: 90, g: 110, b: 130, a: 0.48 };
export const fullMoonTransitionNightColor: ColorPoint = { r: 75, g: 100, b: 125, a: 0.58 };

// Base keyframes
export const baseKeyframes: Record<number, ColorPoint> = {
  0.00: defaultPeakMidnightColor,
  0.20: defaultTransitionNightColor,
  0.35: { r: 255, g: 180, b: 120, a: 0.25 },
  0.50: { r: 0, g: 0, b: 0, a: 0.0 },
  0.65: { r: 255, g: 210, b: 150, a: 0.15 },
  0.75: { r: 255, g: 150, b: 100, a: 0.35 },
  0.85: { r: 80, g: 70, b: 90, a: 0.60 },
  0.95: defaultTransitionNightColor,
  1.00: defaultPeakMidnightColor,
};
// --- END ADDED Day/Night Cycle Constants ---

// Define TORCH_LIGHT_RADIUS_BASE locally
const TORCH_LIGHT_RADIUS_BASE = CAMPFIRE_LIGHT_RADIUS_BASE * 0.8; // Slightly smaller than campfire
const TORCH_FLICKER_AMOUNT = CAMPFIRE_FLICKER_AMOUNT * 0.7; // Added for torch flicker

// Define RGB colors for overlay tints - UPDATED FOR 75-MINUTE CYCLE (60min day + 15min night)
interface ColorAlphaKeyframe {
  progress: number;
  rgb: [number, number, number];
  alpha: number;
}

// Helper for daytime (effectively transparent)
const DAY_COLOR_CONFIG = { rgb: [0, 0, 0] as [number, number, number], alpha: 0.0 }; // Color doesn't matter when alpha is 0

const REGULAR_CYCLE_KEYFRAMES: ColorAlphaKeyframe[] = [
  // Midnight to Pre-Dawn (75-minute cycle: 60min day + 15min night)
  { progress: 0.0,  rgb: [defaultPeakMidnightColor.r, defaultPeakMidnightColor.g, defaultPeakMidnightColor.b],    alpha: defaultPeakMidnightColor.a },   // Deepest Midnight
  { progress: 0.02, rgb: [defaultPeakMidnightColor.r, defaultPeakMidnightColor.g, defaultPeakMidnightColor.b],    alpha: defaultPeakMidnightColor.a },   // Late Midnight

  // Dawn (Server: 0.0 - 0.05, gradual transitions)
  { progress: 0.025, rgb: [30, 25, 65],    alpha: 0.85 },   // Faint Blues/Purples emerge
  { progress: 0.035, rgb: [50, 40, 80],    alpha: 0.78 },   // Darker Purples becoming more visible
  { progress: 0.045, rgb: [90, 60, 100],   alpha: 0.65 },   // Purples lighten, hint of pink

  // Twilight Morning (Server: 0.05 - 0.12, LONGER gradual transitions)
  { progress: 0.06, rgb: [120, 70, 90],   alpha: 0.55 },   // Early morning purples
  { progress: 0.08, rgb: [160, 80, 90],   alpha: 0.50 },   // Pinks and Muted Oranges appear
  { progress: 0.10, rgb: [220, 110, 70],  alpha: 0.35 },   // Oranges strengthen
  { progress: 0.115, rgb: [255, 140, 60],  alpha: 0.20 },   // Brighter Oranges, lower alpha

  // Morning - Transition to Clear Day (Server: 0.12 - 0.35)
  { progress: 0.125, rgb: [255, 170, 80],  alpha: 0.10 },   // Sunrise Peak
  { progress: 0.15, rgb: [255, 190, 100], alpha: 0.05 },   // Lingering soft yellow/orange glow
  { progress: 0.18, ...DAY_COLOR_CONFIG },                // Morning fully clear
  
  // Day/Noon/Afternoon clear (80% of cycle = 0.18 to 0.72)
  { progress: 0.35, ...DAY_COLOR_CONFIG }, // Morning clear
  { progress: 0.55, ...DAY_COLOR_CONFIG }, // Noon clear 
  { progress: 0.70, ...DAY_COLOR_CONFIG }, // Afternoon clear

  // Dusk (Server: 0.72 - 0.76, gradual transitions)
  { progress: 0.72, rgb: [255, 190, 110], alpha: 0.05 },   // Late Afternoon hint of warmth
  { progress: 0.735, rgb: [255, 160, 70],  alpha: 0.15 },   // Sunset approaching
  { progress: 0.75, rgb: [240, 120, 50],  alpha: 0.30 },   // Golden Hour
  { progress: 0.76, rgb: [200, 80, 60],   alpha: 0.50 },   // Sunset Peak

  // Twilight Evening (Server: 0.76 - 0.80, LONGER gradual transitions)
  { progress: 0.77, rgb: [150, 70, 100],  alpha: 0.65 },   // Civil Dusk
  { progress: 0.785, rgb: [80, 50, 90],    alpha: 0.80 },   // Nautical Dusk
  { progress: 0.80, rgb: [5, 5, 10],      alpha: 0.96 },   // Astronomical Dusk

  // Night to Midnight (Server: 0.80 - 1.0, 20% of cycle)
  { progress: 0.92, rgb: [defaultPeakMidnightColor.r, defaultPeakMidnightColor.g, defaultPeakMidnightColor.b],    alpha: defaultPeakMidnightColor.a },   // Early Night
  { progress: 1.0,  rgb: [defaultPeakMidnightColor.r, defaultPeakMidnightColor.g, defaultPeakMidnightColor.b],    alpha: defaultPeakMidnightColor.a },   // Deepest Midnight
];

const FULL_MOON_NIGHT_KEYFRAMES: ColorAlphaKeyframe[] = [
  // Midnight to Pre-Dawn (Full Moon, 75-minute cycle: 60min day + 15min night)
  { progress: 0.0,  rgb: [130, 150, 190], alpha: 0.40 },   // Lighter Midnight
  { progress: 0.02, rgb: [135, 155, 195], alpha: 0.38 },   // Late Midnight

  // Dawn (Full Moon, gradual transitions)
  { progress: 0.025, rgb: [150, 160, 190], alpha: 0.32 },   // Faint warmer blues emerge
  { progress: 0.035, rgb: [170, 165, 180], alpha: 0.25 },   // Purplish silver
  { progress: 0.045, rgb: [190, 170, 170], alpha: 0.18 },   // More silver, hint of warmth

  // Twilight Morning (Full Moon, LONGER gradual transitions)
  { progress: 0.06, rgb: [200, 175, 165], alpha: 0.15 },   // Early morning silver-pink
  { progress: 0.08, rgb: [210, 180, 160], alpha: 0.12 },   // Pale Pinks/Muted Oranges appear
  { progress: 0.10, rgb: [230, 190, 150], alpha: 0.08 },   // Soft Oranges strengthen
  { progress: 0.115, rgb: [250, 200, 140], alpha: 0.04 },   // Brighter Pale Oranges

  // Morning - Transition to Clear Day (Full Moon)
  { progress: 0.125, rgb: [255, 215, 150], alpha: 0.02 },   // Sunrise Peak
  { progress: 0.15, rgb: [255, 225, 170], alpha: 0.01 },   // Lingering soft glow
  { progress: 0.18, ...DAY_COLOR_CONFIG },                // Morning fully clear

  // Day/Afternoon (Same as regular, 80% of cycle)
  { progress: 0.35, ...DAY_COLOR_CONFIG },
  { progress: 0.55, ...DAY_COLOR_CONFIG },
  { progress: 0.70, ...DAY_COLOR_CONFIG },

  // Dusk (Full Moon, gradual transitions)
  { progress: 0.72, rgb: [255, 215, 160], alpha: 0.01 },   // Late Afternoon hint of warmth
  { progress: 0.735, rgb: [250, 190, 130], alpha: 0.06 },   // Sunset approaching
  { progress: 0.75, rgb: [230, 160, 110], alpha: 0.12 },   // Muted Golden Hour
  { progress: 0.76, rgb: [200, 140, 120], alpha: 0.20 },   // Sunset Peak

  // Twilight Evening (Full Moon, LONGER gradual transitions)
  { progress: 0.77, rgb: [170, 150, 180], alpha: 0.28 },   // Civil Dusk
  { progress: 0.785, rgb: [150, 150, 190], alpha: 0.35 },   // Nautical Dusk
  { progress: 0.80, rgb: [140, 150, 190], alpha: 0.38 },   // Astronomical Dusk

  // Night to Midnight (Full Moon, 20% of cycle)
  { progress: 0.92, rgb: [135, 155, 195], alpha: 0.39 },   // Early Night
  { progress: 1.0,  rgb: [130, 150, 190], alpha: 0.40 },   // Lighter Midnight
];

// Server's full moon cycle interval
const SERVER_FULL_MOON_INTERVAL = 3;

function calculateOverlayRgbaString(
    cycleProgress: number,
    worldState: SpacetimeDBWorldState | null // Pass the whole worldState or null
): string { 
    const isCurrentlyFullMoon = worldState?.isFullMoon ?? false;
    const currentCycleCount = worldState?.cycleCount ?? 0;

    const GRACE_PERIOD_END_PROGRESS = 0.05; // Dawn period ends at 0.05 in new 75-minute cycle
    const REGULAR_DAWN_PEAK_PROGRESS = REGULAR_CYCLE_KEYFRAMES.find(kf => kf.progress === 0.125)?.progress ?? 0.125; // Updated to match new sunrise peak

    // --- Special Transition 1: Full Moon cycle STARTS, but PREVIOUS was Regular (or first cycle) ---
    const prevCycleWasRegularOrDefault = currentCycleCount === 0 || ((currentCycleCount - 1) % SERVER_FULL_MOON_INTERVAL !== 0);
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
    const prevCycleWasFullMoon = currentCycleCount > 0 && ((currentCycleCount - 1) % SERVER_FULL_MOON_INTERVAL === 0);
    if (!isCurrentlyFullMoon && cycleProgress < REGULAR_DAWN_PEAK_PROGRESS && prevCycleWasFullMoon) {
        const fromKf = FULL_MOON_NIGHT_KEYFRAMES[FULL_MOON_NIGHT_KEYFRAMES.length - 1]; 
        const toKf = REGULAR_CYCLE_KEYFRAMES.find(kf => kf.progress === REGULAR_DAWN_PEAK_PROGRESS) ?? REGULAR_CYCLE_KEYFRAMES[1]; 
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
    
    // Standard keyframe lookup and interpolation
    let prevKf = keyframesToUse[0];
    let nextKf = keyframesToUse[keyframesToUse.length - 1];

    if (cycleProgress <= keyframesToUse[0].progress) {
        prevKf = keyframesToUse[0];
        nextKf = keyframesToUse[0];
    } else if (cycleProgress >= keyframesToUse[keyframesToUse.length - 1].progress) {
        prevKf = keyframesToUse[keyframesToUse.length - 1];
        nextKf = keyframesToUse[keyframesToUse.length - 1];
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

    return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
}

interface UseDayNightCycleProps {
    worldState: SpacetimeDBWorldState | null;
    campfires: Map<string, SpacetimeDBCampfire>;
    lanterns: Map<string, SpacetimeDBLantern>;
    players: Map<string, SpacetimeDBPlayer>;
    activeEquipments: Map<string, SpacetimeDBActiveEquipment>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    cameraOffsetX: number;
    cameraOffsetY: number;
    canvasSize: { width: number; height: number };
    // Add interpolated positions for smooth torch light cutouts
    localPlayerId?: string;
    predictedPosition: { x: number; y: number } | null;
    remotePlayerInterpolation?: any; // Type matches GameCanvas
}

interface UseDayNightCycleResult {
    overlayRgba: string;
    maskCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export function useDayNightCycle({
    worldState,
    campfires,
    lanterns,
    players,
    activeEquipments,
    itemDefinitions,
    cameraOffsetX,
    cameraOffsetY,
    canvasSize,
    localPlayerId,
    predictedPosition,
    remotePlayerInterpolation,
}: UseDayNightCycleProps): UseDayNightCycleResult {
    const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const [overlayRgba, setOverlayRgba] = useState<string>('transparent');
    // OPTIMIZED: Track previous overlay value to avoid unnecessary re-renders
    const prevOverlayRef = useRef<string>('transparent');

    // --- Create a derived state string that changes when any torch's lit status changes ---
    const torchLitStatesKey = useMemo(() => {
        let key = "torch_light_states:";
        players.forEach((player, playerId) => {
            const equipment = activeEquipments.get(playerId);
            if (equipment && equipment.equippedItemDefId) {
                const itemDef = itemDefinitions.get(equipment.equippedItemDefId.toString());
                if (itemDef && itemDef.name === "Torch") {
                    key += `${playerId}:${player.isTorchLit};`;
                }
            }
        });
        return key;
    }, [players, activeEquipments, itemDefinitions]);
    // --- End derived state ---

    // --- Create a derived state string that changes when any lantern's burning status changes ---
    const lanternBurningStatesKey = useMemo(() => {
        let key = "lantern_burning_states:";
        lanterns.forEach((lantern, lanternId) => {
            key += `${lanternId}:${lantern.isBurning};`;
        });
        return key;
    }, [lanterns]);
    // --- End lantern derived state ---

    useEffect(() => {
        if (!maskCanvasRef.current) {
            maskCanvasRef.current = document.createElement('canvas');
        }
        const maskCanvas = maskCanvasRef.current;
        const maskCtx = maskCanvas.getContext('2d');

        if (!maskCtx || canvasSize.width === 0 || canvasSize.height === 0) {
            setOverlayRgba('transparent');
            return;
        }

        maskCanvas.width = canvasSize.width;
        maskCanvas.height = canvasSize.height;

        const currentCycleProgress = worldState?.cycleProgress;
        let calculatedOverlayString; 

        if (typeof currentCycleProgress === 'number') {
            calculatedOverlayString = calculateOverlayRgbaString(
                currentCycleProgress,
                worldState // Pass the whole worldState object
            );
        } else {
            calculatedOverlayString = 'rgba(0,0,0,0)'; // Default to fully transparent day
        }
        
        // OPTIMIZED: Only update state if the overlay value actually changed
        if (calculatedOverlayString !== prevOverlayRef.current) {
            prevOverlayRef.current = calculatedOverlayString;
            setOverlayRgba(calculatedOverlayString);
        } 

        maskCtx.fillStyle = calculatedOverlayString; 
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

        maskCtx.globalCompositeOperation = 'destination-out';

        // Render campfire light cutouts
        campfires.forEach(campfire => {
            if (campfire.isBurning) {
                // Adjust Y position for the light source to be centered on the flame
                const visualCenterWorldY = campfire.posY - (CAMPFIRE_HEIGHT / 2);
                const adjustedGradientCenterWorldY = visualCenterWorldY - (CAMPFIRE_HEIGHT * 0); // Changed from 0.6 to 0.4
                
                const screenX = campfire.posX + cameraOffsetX;
                const screenY = adjustedGradientCenterWorldY + cameraOffsetY; // Use adjusted Y
                
                // SUBSTANTIAL CAMPFIRE CUTOUT - 2x larger inner bright area with natural gradient
                const lightRadius = CAMPFIRE_LIGHT_RADIUS_BASE * 2.0; // Double the cutout size
                const maskGradient = maskCtx.createRadialGradient(screenX, screenY, lightRadius * 0.08, screenX, screenY, lightRadius);
                maskGradient.addColorStop(0, 'rgba(0,0,0,1)'); // Full cutout at center
                maskGradient.addColorStop(0.4, 'rgba(0,0,0,0.7)'); // Natural transition zone
                maskGradient.addColorStop(0.8, 'rgba(0,0,0,0.3)'); // Gentle fade
                maskGradient.addColorStop(1, 'rgba(0,0,0,0)'); // Complete fade to darkness
                maskCtx.fillStyle = maskGradient;
                maskCtx.beginPath();
                maskCtx.arc(screenX, screenY, lightRadius, 0, Math.PI * 2);
                maskCtx.fill();
            }
        });

        // Render lantern light cutouts
        lanterns.forEach(lantern => {
            if (lantern.isBurning && !lantern.isDestroyed) {
                // Adjust Y position for the light source to be centered on the lantern flame
                const visualCenterWorldY = lantern.posY - (LANTERN_HEIGHT / 2);
                const adjustedGradientCenterWorldY = visualCenterWorldY; // Lanterns don't need extra offset like campfires
                
                const screenX = lantern.posX + cameraOffsetX;
                const screenY = adjustedGradientCenterWorldY + cameraOffsetY;
                
                // LANTERN CUTOUT - Larger and more stable than torch, but more contained than campfire
                const flicker = (Math.random() - 0.5) * 2 * LANTERN_FLICKER_AMOUNT;
                const lightRadius = Math.max(0, (LANTERN_LIGHT_RADIUS_BASE * 1.8) + flicker); // 1.8x radius for good coverage
                const maskGradient = maskCtx.createRadialGradient(screenX, screenY, lightRadius * 0.05, screenX, screenY, lightRadius);
                maskGradient.addColorStop(0, 'rgba(0,0,0,1)'); // Full cutout at center
                maskGradient.addColorStop(0.3, 'rgba(0,0,0,0.85)'); // Strong cutout zone
                maskGradient.addColorStop(0.6, 'rgba(0,0,0,0.5)'); // Gradual transition
                maskGradient.addColorStop(0.85, 'rgba(0,0,0,0.2)'); // Gentle fade
                maskGradient.addColorStop(1, 'rgba(0,0,0,0)'); // Complete fade to darkness
                maskCtx.fillStyle = maskGradient;
                maskCtx.beginPath();
                maskCtx.arc(screenX, screenY, lightRadius, 0, Math.PI * 2);
                maskCtx.fill();
            }
        });

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
                
                const lightScreenX = renderPositionX + cameraOffsetX;
                const lightScreenY = renderPositionY + cameraOffsetY;

                // TORCH CUTOUT - 1.25x larger inner bright area with natural rustic gradient
                const flicker = (Math.random() - 0.5) * 2 * TORCH_FLICKER_AMOUNT;
                const currentLightRadius = Math.max(0, (TORCH_LIGHT_RADIUS_BASE * 1.25) + flicker);

                const maskGradient = maskCtx.createRadialGradient(lightScreenX, lightScreenY, currentLightRadius * 0.12, lightScreenX, lightScreenY, currentLightRadius);
                maskGradient.addColorStop(0, 'rgba(0,0,0,1)'); // Full cutout at center
                maskGradient.addColorStop(0.35, 'rgba(0,0,0,0.8)'); // Natural transition zone
                maskGradient.addColorStop(0.75, 'rgba(0,0,0,0.4)'); // Gentle fade
                maskGradient.addColorStop(1, 'rgba(0,0,0,0)'); // Complete fade to darkness
                maskCtx.fillStyle = maskGradient;
                maskCtx.beginPath();
                maskCtx.arc(lightScreenX, lightScreenY, currentLightRadius, 0, Math.PI * 2);
                maskCtx.fill();
            }
        });
        
        maskCtx.globalCompositeOperation = 'source-over';

    }, [worldState, campfires, lanterns, players, activeEquipments, itemDefinitions, cameraOffsetX, cameraOffsetY, canvasSize.width, canvasSize.height, torchLitStatesKey, lanternBurningStatesKey, localPlayerId, predictedPosition, remotePlayerInterpolation]);

    return { overlayRgba, maskCanvasRef };
} 