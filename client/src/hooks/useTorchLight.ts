import { useMemo } from 'react';
import {
    Player as SpacetimeDBPlayer,
    ActiveEquipment as SpacetimeDBActiveEquipment,
    ItemDefinition as SpacetimeDBItemDefinition,
} from '../generated';
import {
    CAMPFIRE_LIGHT_RADIUS_BASE, // We can reuse or define new constants for torch
    CAMPFIRE_FLICKER_AMOUNT,
    CAMPFIRE_LIGHT_INNER_COLOR,
    CAMPFIRE_LIGHT_OUTER_COLOR,
} from '../config/gameConfig';

// Define specific torch light properties, or reuse campfire ones
const TORCH_LIGHT_RADIUS_BASE = CAMPFIRE_LIGHT_RADIUS_BASE * 0.8; // Slightly smaller than campfire
const TORCH_FLICKER_AMOUNT = CAMPFIRE_FLICKER_AMOUNT * 0.7;
const TORCH_LIGHT_INNER_COLOR = CAMPFIRE_LIGHT_INNER_COLOR;
const TORCH_LIGHT_OUTER_COLOR = CAMPFIRE_LIGHT_OUTER_COLOR;

interface UseTorchLightProps {
    localPlayer: SpacetimeDBPlayer | undefined;
    activeEquipments: Map<string, SpacetimeDBActiveEquipment>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    localPlayerId: string | undefined;
    renderPositionX?: number;
    renderPositionY?: number;
}

export interface TorchLightParams {
    centerX: number; // World X position for the light
    centerY: number; // World Y position for the light
    radius: number;
    innerColor: string;
    outerColor: string;
    flickerAmount: number;
}

export function useTorchLight({
    localPlayer,
    activeEquipments,
    itemDefinitions,
    localPlayerId,
    renderPositionX,
    renderPositionY,
}: UseTorchLightProps): TorchLightParams | null {
    return useMemo(() => {
        if (!localPlayer || !localPlayerId || !localPlayer.isTorchLit) {
            return null;
        }

        const equipment = activeEquipments.get(localPlayerId);
        if (!equipment || !equipment.equippedItemDefId) {
            return null;
        }

        const itemDef = itemDefinitions.get(equipment.equippedItemDefId.toString());
        if (!itemDef || itemDef.name !== "Torch") {
            return null;
        }

        // Use provided render position if available, otherwise fall back to player position
        const lightCenterX = renderPositionX ?? localPlayer.positionX;
        const lightCenterY = renderPositionY ?? localPlayer.positionY;

        // If we reach here, the player has a Torch equipped
        return {
            centerX: lightCenterX,
            centerY: lightCenterY,
            radius: TORCH_LIGHT_RADIUS_BASE,
            innerColor: TORCH_LIGHT_INNER_COLOR,
            outerColor: TORCH_LIGHT_OUTER_COLOR,
            flickerAmount: TORCH_FLICKER_AMOUNT,
        };

    }, [localPlayer, activeEquipments, itemDefinitions, localPlayerId, renderPositionX, renderPositionY]);
} 