import { useEffect, useRef, useState, useMemo } from 'react';
import {
    Campfire as SpacetimeDBCampfire,
    WorldState as SpacetimeDBWorldState,
    Player as SpacetimeDBPlayer,
    ActiveEquipment as SpacetimeDBActiveEquipment,
    ItemDefinition as SpacetimeDBItemDefinition,
} from '../generated';
import { CAMPFIRE_LIGHT_RADIUS_BASE } from '../config/gameConfig';

// Define TORCH_LIGHT_RADIUS_BASE locally
const TORCH_LIGHT_RADIUS_BASE = CAMPFIRE_LIGHT_RADIUS_BASE * 0.8; // Slightly smaller than campfire

// Define time constants based on server's logic (world_state.rs)
const DAY_DURATION_MINUTES = 900.0 / 60.0; // 1.5 minutes, corrected from 90.0
const NIGHT_DURATION_MINUTES = 900.0 / 60.0;  // 1.5 minutes, corrected from 90.0
const TOTAL_CYCLE_MINUTES = DAY_DURATION_MINUTES + NIGHT_DURATION_MINUTES;

// Client-side interpretation for visual transitions
const SUNRISE_START_HOUR = 6;
const SUNSET_START_HOUR = 18;

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

function getOverlayAlpha(
    _hours: number, // hours, minutes, isDay are less critical now with direct cycleProgress use
    _minutes: number,
    _isDay: boolean,
    _sunriseStartHour: number, // Kept for signature, but logic relies more on cycleProgress
    _sunsetStartHour: number,
    cycleProgress: number
): number {
    const nightAlpha = 0.90;
    const dayAlpha = 0.0;

    // Server TimeOfDay based on cycle_progress (from world_state.rs):
    // Midnight: p < 0.05
    // Night:    p < 0.20
    // Dawn:     p < 0.35
    // Morning:  p < 0.50
    // Noon:     p < 0.65
    // Afternoon:p < 0.80
    // Dusk:     p < 0.95
    // Night:    default

    // Let's map these server phases to alpha transitions more directly.
    if (cycleProgress < 0.05) return nightAlpha; // Midnight
    if (cycleProgress < 0.20) return nightAlpha; // Night
    if (cycleProgress < 0.35) { // Dawn: transition from nightAlpha to dayAlpha
        const phaseProgress = (cycleProgress - 0.20) / (0.35 - 0.20);
        return nightAlpha - (nightAlpha - dayAlpha) * phaseProgress;
    }
    if (cycleProgress < 0.50) return dayAlpha; // Morning
    if (cycleProgress < 0.65) return dayAlpha; // Noon
    if (cycleProgress < 0.80) return dayAlpha; // Afternoon
    if (cycleProgress < 0.95) { // Dusk: transition from dayAlpha to nightAlpha
        const phaseProgress = (cycleProgress - 0.80) / (0.95 - 0.80);
        return dayAlpha + (nightAlpha - dayAlpha) * phaseProgress;
    }
    return nightAlpha; // Default to Night (covers p >= 0.95)
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
        let calculatedOverlayAlpha;

        if (typeof currentCycleProgress === 'number') {
            // getGameTimeFromCycleProgress can still be called if its output is used elsewhere, but getOverlayAlpha now primarily uses cycleProgress
            const currentGameTime = getGameTimeFromCycleProgress(currentCycleProgress);
            calculatedOverlayAlpha = getOverlayAlpha(currentGameTime.hours, currentGameTime.minutes, currentGameTime.isDay, SUNRISE_START_HOUR, SUNSET_START_HOUR, currentCycleProgress);
        } else {
            calculatedOverlayAlpha = 0.0; // Default to full day (no overlay)
        }
        
        const baseOverlayColor = '0,0,0';
        const finalOverlayRgba = `rgba(${baseOverlayColor},${calculatedOverlayAlpha.toFixed(2)})`;
        setOverlayRgba(finalOverlayRgba);

        maskCtx.fillStyle = finalOverlayRgba;
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

        maskCtx.globalCompositeOperation = 'destination-out';

        campfires.forEach(campfire => {
            if (campfire.isBurning) {
                const screenX = campfire.posX + cameraOffsetX;
                const screenY = campfire.posY + cameraOffsetY;
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
                const lightRadius = TORCH_LIGHT_RADIUS_BASE;

                const maskGradient = maskCtx.createRadialGradient(lightScreenX, lightScreenY, lightRadius * 0.1, lightScreenX, lightScreenY, lightRadius);
                maskGradient.addColorStop(0, 'rgba(0,0,0,1)');
                maskGradient.addColorStop(1, 'rgba(0,0,0,0)');
                maskCtx.fillStyle = maskGradient;
                maskCtx.beginPath();
                maskCtx.arc(lightScreenX, lightScreenY, lightRadius, 0, Math.PI * 2);
                maskCtx.fill();
            }
        });
        
        maskCtx.globalCompositeOperation = 'source-over';

    }, [worldState, campfires, players, activeEquipments, itemDefinitions, cameraOffsetX, cameraOffsetY, canvasSize.width, canvasSize.height, torchLitStatesKey]);

    return { overlayRgba, maskCanvasRef };
} 