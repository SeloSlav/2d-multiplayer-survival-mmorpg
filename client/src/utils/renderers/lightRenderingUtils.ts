import { Player as SpacetimeDBPlayer, ItemDefinition as SpacetimeDBItemDefinition, ActiveEquipment as SpacetimeDBActiveEquipment } from '../../generated';
import {
    CAMPFIRE_LIGHT_RADIUS_BASE,
    CAMPFIRE_FLICKER_AMOUNT,
    CAMPFIRE_LIGHT_INNER_COLOR,
    CAMPFIRE_LIGHT_OUTER_COLOR,
} from '../../config/gameConfig';

// --- Torch Light Constants ---
export const TORCH_LIGHT_RADIUS_BASE = CAMPFIRE_LIGHT_RADIUS_BASE * 0.8;
export const TORCH_FLICKER_AMOUNT = CAMPFIRE_FLICKER_AMOUNT * 0.7;
export const TORCH_LIGHT_INNER_COLOR = CAMPFIRE_LIGHT_INNER_COLOR;
export const TORCH_LIGHT_OUTER_COLOR = CAMPFIRE_LIGHT_OUTER_COLOR;

interface RenderPlayerTorchLightProps {
    ctx: CanvasRenderingContext2D;
    player: SpacetimeDBPlayer;
    activeEquipments: Map<string, SpacetimeDBActiveEquipment>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    cameraOffsetX: number;
    cameraOffsetY: number;
}

export const renderPlayerTorchLight = ({
    ctx,
    player,
    activeEquipments,
    itemDefinitions,
    cameraOffsetX,
    cameraOffsetY,
}: RenderPlayerTorchLightProps) => {
    if (!player.isTorchLit || !player.identity) {
        return; // Not lit or no identity, nothing to render
    }

    const playerIdentityStr = player.identity.toHexString();
    const equipment = activeEquipments.get(playerIdentityStr);

    if (equipment && equipment.equippedItemDefId) {
        const itemDef = itemDefinitions.get(equipment.equippedItemDefId.toString());
        if (itemDef && itemDef.name === "Torch") {
            const lightParams = {
                centerX: player.positionX,
                centerY: player.positionY,
                radius: TORCH_LIGHT_RADIUS_BASE,
                innerColor: TORCH_LIGHT_INNER_COLOR,
                outerColor: TORCH_LIGHT_OUTER_COLOR,
                flickerAmount: TORCH_FLICKER_AMOUNT,
            };

            const lightScreenX = lightParams.centerX + cameraOffsetX;
            const lightScreenY = lightParams.centerY + cameraOffsetY;
            const flicker = (Math.random() - 0.5) * 2 * lightParams.flickerAmount;
            const currentLightRadius = Math.max(0, lightParams.radius + flicker);

            const lightGradient = ctx.createRadialGradient(
                lightScreenX, lightScreenY, 0, 
                lightScreenX, lightScreenY, currentLightRadius
            );
            lightGradient.addColorStop(0, lightParams.innerColor);
            lightGradient.addColorStop(1, lightParams.outerColor);
            
            ctx.fillStyle = lightGradient;
            ctx.beginPath();
            ctx.arc(lightScreenX, lightScreenY, currentLightRadius, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}; 