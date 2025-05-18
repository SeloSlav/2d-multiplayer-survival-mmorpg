import { useEffect, useRef, useState, useMemo } from 'react';
import {
    Campfire as SpacetimeDBCampfire,
    WorldState as SpacetimeDBWorldState,
    Player as SpacetimeDBPlayer,
    ActiveEquipment as SpacetimeDBActiveEquipment,
    ItemDefinition as SpacetimeDBItemDefinition,
} from '../generated';
import { CAMPFIRE_LIGHT_RADIUS_BASE, CAMPFIRE_HEIGHT, CAMPFIRE_FLICKER_AMOUNT } from '../config/gameConfig';

// Define TORCH_LIGHT_RADIUS_BASE locally
const TORCH_LIGHT_RADIUS_BASE = CAMPFIRE_LIGHT_RADIUS_BASE * 0.8; // Slightly smaller than campfire
const TORCH_FLICKER_AMOUNT = CAMPFIRE_FLICKER_AMOUNT * 0.7; // Added for torch flicker

// Define time constants based on server's logic (world_state.rs)
const DAY_DURATION_MINUTES = 45.0;  // 45 minutes
const NIGHT_DURATION_MINUTES = 15.0; // 15 minutes
const TOTAL_CYCLE_MINUTES = DAY_DURATION_MINUTES + NIGHT_DURATION_MINUTES; // Now 60 minutes

// Client-side interpretation for visual transitions
const SUNRISE_START_HOUR = 6;
const SUNSET_START_HOUR = 18;

// Define RGB colors for overlay tints - NEW KEYFRAME APPROACH
interface ColorAlphaKeyframe {
  progress: number;
  rgb: [number, number, number];
  alpha: number;
}

// Helper for daytime (effectively transparent)
const DAY_COLOR_CONFIG = { rgb: [0, 0, 0] as [number, number, number], alpha: 0.0 }; // Color doesn't matter when alpha is 0

const REGULAR_CYCLE_KEYFRAMES: ColorAlphaKeyframe[] = [
  // Midnight to Pre-Dawn
  { progress: 0.0,  rgb: [10, 15, 35],    alpha: 0.92 },   // Deepest Midnight (Dark Desaturated Indigo)
  { progress: 0.02, rgb: [15, 20, 45],    alpha: 0.90 },   // Late Midnight (Slightly less intense)

  // Dawn (Server: 0.0 - 0.04, Client visual stretch: 0.02 - 0.07)
  { progress: 0.035,rgb: [30, 25, 65],    alpha: 0.85 },   // Faint Blues/Purples emerge
  { progress: 0.05, rgb: [50, 40, 80],    alpha: 0.78 },   // Darker Purples becoming more visible
  { progress: 0.07, rgb: [90, 60, 100],   alpha: 0.65 },   // Purples lighten, hint of pink

  // Twilight Morning (Server: 0.04 - 0.08, Client visual stretch: 0.07 - 0.15)
  { progress: 0.09, rgb: [160, 80, 90],   alpha: 0.50 },   // Pinks and Muted Oranges appear
  { progress: 0.11, rgb: [220, 110, 70],  alpha: 0.35 },   // Oranges strengthen
  { progress: 0.13, rgb: [255, 140, 60],  alpha: 0.20 },   // Brighter Oranges, lower alpha
  { progress: 0.15, rgb: [255, 170, 80],  alpha: 0.10 },   // Sunrise Peak (Soft, bright orange, very low alpha)

  // Morning - Transition to Clear Day (Server: Morning 0.08+, Client visual stretch: 0.15 - 0.22)
  { progress: 0.18, rgb: [255, 190, 100], alpha: 0.05 },   // Lingering soft yellow/orange glow
  { progress: 0.22, ...DAY_COLOR_CONFIG },                // Morning fully clear
  
  // Adjusted Day/Noon/Afternoon to reflect the new morning pace:
  { progress: 0.50, ...DAY_COLOR_CONFIG }, // Noon clear 
  { progress: 0.60, ...DAY_COLOR_CONFIG }, // Afternoon clear, leading into dusk

  // Dusk (Server: 0.67 - 0.71, Client visual stretch: 0.60 - 0.72)
  { progress: 0.63, rgb: [255, 190, 110], alpha: 0.05 },   // Late Afternoon hint of warmth
  { progress: 0.66, rgb: [255, 160, 70],  alpha: 0.15 },   // Sunset approaching (Soft Oranges)
  { progress: 0.69, rgb: [240, 120, 50],  alpha: 0.30 },   // Golden Hour
  { progress: 0.72, rgb: [200, 80, 60],   alpha: 0.50 },   // Sunset Peak (Reds/Deep Oranges)

  // Twilight Evening (Server: 0.71 - 0.75, Client visual stretch: 0.72 - 0.81)
  { progress: 0.75, rgb: [150, 70, 100],  alpha: 0.65 },   // Civil Dusk (Purples/Pinks return)
  { progress: 0.78, rgb: [80, 50, 90],    alpha: 0.80 },   // Nautical Dusk (Deepening Blues/Purples)
  { progress: 0.81, rgb: [40, 30, 70],    alpha: 0.88 },   // Astronomical Dusk

  // Night to Midnight (Server: Night 0.75 - 0.90, Midnight 0.90 - 1.0, Client visual stretch: 0.81 - 1.0)
  { progress: 0.90, rgb: [20, 25, 55],    alpha: 0.90 },   // Early Night (Dark Blue/Indigo)
  { progress: 1.0,  rgb: [10, 15, 35],    alpha: 0.92 },   // Deepest Midnight (Loop to start)
];

const FULL_MOON_NIGHT_KEYFRAMES: ColorAlphaKeyframe[] = [
  // Midnight to Pre-Dawn (Full Moon)
  { progress: 0.0,  rgb: [130, 150, 190], alpha: 0.40 },   // Lighter Midnight
  { progress: 0.02, rgb: [135, 155, 195], alpha: 0.38 },   // Late Midnight (Slightly less intense blue)

  // Dawn (Full Moon) (Server: 0.0 - 0.04, Client visual stretch: 0.02 - 0.07)
  { progress: 0.035,rgb: [150, 160, 190], alpha: 0.32 },   // Faint warmer blues emerge
  { progress: 0.05, rgb: [170, 165, 180], alpha: 0.25 },   // Purplish silver
  { progress: 0.07, rgb: [190, 170, 170], alpha: 0.18 },   // More silver, hint of warmth

  // Twilight Morning (Full Moon) (Server: 0.04 - 0.08, Client visual stretch: 0.07 - 0.15)
  { progress: 0.09, rgb: [210, 180, 160], alpha: 0.12 },   // Pale Pinks/Muted Oranges appear
  { progress: 0.11, rgb: [230, 190, 150], alpha: 0.08 },   // Soft Oranges strengthen
  { progress: 0.13, rgb: [250, 200, 140], alpha: 0.04 },   // Brighter Pale Oranges, lower alpha
  { progress: 0.15, rgb: [255, 215, 150], alpha: 0.02 },   // Sunrise Peak (Soft, bright pale orange, very low alpha)

  // Morning - Transition to Clear Day (Full Moon) (Server: Morning 0.08+, Client visual stretch: 0.15 - 0.22)
  { progress: 0.18, rgb: [255, 225, 170], alpha: 0.01 },   // Lingering soft yellow/orange glow
  { progress: 0.22, ...DAY_COLOR_CONFIG },                // Morning fully clear

  // --- Day/Afternoon (Same as regular) ---
  { progress: 0.50, ...DAY_COLOR_CONFIG },
  { progress: 0.60, ...DAY_COLOR_CONFIG },

  // --- Dusk (Full Moon) (Server: 0.67 - 0.71, Client visual stretch: 0.60 - 0.72) ---
  { progress: 0.63, rgb: [255, 215, 160], alpha: 0.01 },   // Late Afternoon hint of warmth (pale)
  { progress: 0.66, rgb: [250, 190, 130], alpha: 0.06 },   // Sunset approaching (Soft Pale Oranges)
  { progress: 0.69, rgb: [230, 160, 110], alpha: 0.12 },   // Muted Golden Hour
  { progress: 0.72, rgb: [200, 140, 120], alpha: 0.20 },   // Sunset Peak (Muted Reds/Oranges)

  // --- Twilight Evening (Full Moon) (Server: 0.71 - 0.75, Client visual stretch: 0.72 - 0.81) ---
  { progress: 0.75, rgb: [170, 150, 180], alpha: 0.28 },   // Civil Dusk (Pale Purples/Pinks return)
  { progress: 0.78, rgb: [150, 150, 190], alpha: 0.35 },   // Nautical Dusk (Cooling Silvery Blues/Purples)
  { progress: 0.81, rgb: [140, 150, 190], alpha: 0.38 },   // Astronomical Dusk (Clearer Moonlight)

  // --- Night to Midnight (Full Moon) (Server: Night 0.75 - 0.90, Midnight 0.90 - 1.0, Client visual stretch: 0.81 - 1.0) ---
  { progress: 0.90, rgb: [135, 155, 195], alpha: 0.39 },   // Early Night (Silvery Blue)
  { progress: 1.0,  rgb: [130, 150, 190], alpha: 0.40 },   // Lighter Midnight (Loop to start)
];

// Converts cycle_progress (0.0-1.0) to game hours and isDay status
function getGameTimeFromCycleProgress(cycleProgress: number): { hours: number; minutes: number; isDay: boolean; cycleProgress: number } {
    const totalMinutesInCycle = TOTAL_CYCLE_MINUTES;
    const currentMinuteInCycle = cycleProgress * totalMinutesInCycle;

    let hours: number;
    let minutes: number = Math.floor(currentMinuteInCycle % 60);
    let isDay: boolean;

    const dayHourSpan = SUNSET_START_HOUR - SUNRISE_START_HOUR; // e.g., 12 hours
    const nightHourSpan = 24 - dayHourSpan; // e.g., 12 hours

    if (currentMinuteInCycle < DAY_DURATION_MINUTES) {
        isDay = true;
        const progressThroughDay = currentMinuteInCycle / DAY_DURATION_MINUTES;
        hours = SUNRISE_START_HOUR + Math.floor(progressThroughDay * dayHourSpan);
        minutes = Math.floor((progressThroughDay * dayHourSpan * 60) % 60);
    } else {
        isDay = false;
        const progressThroughNight = (currentMinuteInCycle - DAY_DURATION_MINUTES) / NIGHT_DURATION_MINUTES;
        hours = (SUNSET_START_HOUR + Math.floor(progressThroughNight * nightHourSpan)) % 24;
        minutes = Math.floor((progressThroughNight * nightHourSpan * 60) % 60);
    }

    return { hours, minutes, isDay, cycleProgress };
}

// Server's full moon cycle interval
const SERVER_FULL_MOON_INTERVAL = 3;

function calculateOverlayRgbaString(
    cycleProgress: number,
    worldState: SpacetimeDBWorldState | null // Pass the whole worldState or null
): string { 
    const isCurrentlyFullMoon = worldState?.isFullMoon ?? false;
    const currentCycleCount = worldState?.cycleCount ?? 0;

    const GRACE_PERIOD_END_PROGRESS = 0.03; // For full moon starting after regular night
    const REGULAR_DAWN_PEAK_PROGRESS = REGULAR_CYCLE_KEYFRAMES.find(kf => kf.progress === 0.15)?.progress ?? 0.15;

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
    players: Map<string, SpacetimeDBPlayer>;
    activeEquipments: Map<string, SpacetimeDBActiveEquipment>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    cameraOffsetX: number;
    cameraOffsetY: number;
    canvasSize: { width: number; height: number };
}

interface UseDayNightCycleResult {
    overlayRgba: string;
    maskCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export function useDayNightCycle({
    worldState,
    campfires,
    players,
    activeEquipments,
    itemDefinitions,
    cameraOffsetX,
    cameraOffsetY,
    canvasSize,
}: UseDayNightCycleProps): UseDayNightCycleResult {
    const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const [overlayRgba, setOverlayRgba] = useState<string>('transparent');

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
        
        setOverlayRgba(calculatedOverlayString); 

        maskCtx.fillStyle = calculatedOverlayString; 
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

        maskCtx.globalCompositeOperation = 'destination-out';

        campfires.forEach(campfire => {
            if (campfire.isBurning) {
                // Adjust Y position for the light source to be centered on the flame
                const visualCenterWorldY = campfire.posY - (CAMPFIRE_HEIGHT / 2);
                const adjustedGradientCenterWorldY = visualCenterWorldY - (CAMPFIRE_HEIGHT * 0); // Changed from 0.6 to 0.4
                
                const screenX = campfire.posX + cameraOffsetX;
                const screenY = adjustedGradientCenterWorldY + cameraOffsetY; // Use adjusted Y
                
                const lightRadius = CAMPFIRE_LIGHT_RADIUS_BASE;
                const maskGradient = maskCtx.createRadialGradient(screenX, screenY, lightRadius * 0.1, screenX, screenY, lightRadius);
                maskGradient.addColorStop(0, 'rgba(0,0,0,1)');
                maskGradient.addColorStop(1, 'rgba(0,0,0,0)');
                maskCtx.fillStyle = maskGradient;
                maskCtx.beginPath();
                maskCtx.arc(screenX, screenY, lightRadius, 0, Math.PI * 2);
                maskCtx.fill();
            }
        });

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
                const lightScreenX = player.positionX + cameraOffsetX;
                const lightScreenY = player.positionY + cameraOffsetY;
                // const lightRadius = TORCH_LIGHT_RADIUS_BASE; // Old line

                const flicker = (Math.random() - 0.5) * 2 * TORCH_FLICKER_AMOUNT;
                const currentLightRadius = Math.max(0, TORCH_LIGHT_RADIUS_BASE + flicker);

                const maskGradient = maskCtx.createRadialGradient(lightScreenX, lightScreenY, currentLightRadius * 0.1, lightScreenX, lightScreenY, currentLightRadius);
                maskGradient.addColorStop(0, 'rgba(0,0,0,1)');
                maskGradient.addColorStop(1, 'rgba(0,0,0,0)');
                maskCtx.fillStyle = maskGradient;
                maskCtx.beginPath();
                maskCtx.arc(lightScreenX, lightScreenY, currentLightRadius, 0, Math.PI * 2);
                maskCtx.fill();
            }
        });
        
        maskCtx.globalCompositeOperation = 'source-over';

    }, [worldState, campfires, players, activeEquipments, itemDefinitions, cameraOffsetX, cameraOffsetY, canvasSize.width, canvasSize.height, torchLitStatesKey]);

    return { overlayRgba, maskCanvasRef };
} 