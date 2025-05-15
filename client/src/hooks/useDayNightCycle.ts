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
const DAY_DURATION_MINUTES = 270.0 / 60.0;  // 4.5 minutes
const NIGHT_DURATION_MINUTES = 90.0 / 60.0; // 1.5 minutes
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
    const MAX_NIGHT_OVERLAY_ALPHA = 0.90;

    // Day is 0.0 to 0.75, Night is 0.75 to 1.0
    // Dawn: 0.0 to 0.05
    // Morning: 0.05 to 0.30
    // Noon: 0.30 to 0.45
    // Afternoon: 0.45 to 0.70
    // Dusk: 0.70 to 0.75
    // Night: 0.75 to 0.90
    // Midnight: 0.90 to 1.0

    if (cycleProgress >= 0.05 && cycleProgress < 0.70) {
        // Morning, Noon, Afternoon (Full Day)
        return 0.0;
    } else if (cycleProgress >= 0.75 && cycleProgress < 1.0) {
        // Night, Midnight (Full Night)
        return MAX_NIGHT_OVERLAY_ALPHA;
    } else if (cycleProgress >= 0.0 && cycleProgress < 0.05) {
        // Dawn: Transition from Night to Day
        const dawnProgress = cycleProgress / 0.05;
        return MAX_NIGHT_OVERLAY_ALPHA * (1 - dawnProgress);
    } else if (cycleProgress >= 0.70 && cycleProgress < 0.75) {
        // Dusk: Transition from Day to Night
        const duskProgress = (cycleProgress - 0.70) / 0.05;
        return MAX_NIGHT_OVERLAY_ALPHA * duskProgress;
    }
    return 0.0; // Default to day
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