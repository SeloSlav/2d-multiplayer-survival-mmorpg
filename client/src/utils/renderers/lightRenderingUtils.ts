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

// --- Campfire Light Rendering ---
interface RenderCampfireLightProps {
    ctx: CanvasRenderingContext2D;
    campfire: SpacetimeDBCampfire;
    cameraOffsetX: number;
    cameraOffsetY: number;
}

// Constants like CAMPFIRE_HEIGHT are expected to be imported or available in gameConfig
// For now, let's assume CAMPFIRE_FLICKER_AMOUNT, CAMPFIRE_LIGHT_RADIUS_BASE, 
// CAMPFIRE_LIGHT_INNER_COLOR, CAMPFIRE_LIGHT_OUTER_COLOR are correctly imported from gameConfig within this file.
// We might need to import CAMPFIRE_HEIGHT from gameConfig as well, or pass it if it varies.
// For simplicity, I'll assume gameConfig provides it or it's a fixed value known here.
// Let's re-import them here for clarity for this function, though they are already file-level imports.
import { CAMPFIRE_HEIGHT, CAMPFIRE_FLICKER_AMOUNT as CF_FLICKER_AMOUNT, CAMPFIRE_LIGHT_RADIUS_BASE as CF_RADIUS_BASE, CAMPFIRE_LIGHT_INNER_COLOR as CF_INNER_COLOR, CAMPFIRE_LIGHT_OUTER_COLOR as CF_OUTER_COLOR } from '../../config/gameConfig';
import { Campfire as SpacetimeDBCampfire } from '../../generated';

export const renderCampfireLight = ({
    ctx,
    campfire,
    cameraOffsetX,
    cameraOffsetY,
}: RenderCampfireLightProps) => {
    if (!campfire.isBurning) {
        return; // Not burning, no light
    }

    const lightScreenX = campfire.posX + cameraOffsetX;
    const visualCenterWorldY = campfire.posY - (CAMPFIRE_HEIGHT / 2);
    const gradientCenterWorldY = visualCenterWorldY - (CAMPFIRE_HEIGHT * 0.0);
    const newLightScreenY = gradientCenterWorldY + cameraOffsetY;

    const flicker = (Math.random() - 0.5) * 2 * CF_FLICKER_AMOUNT;
    const currentLightRadius = Math.max(0, CF_RADIUS_BASE + flicker) * 2.0;

    const lightGradient = ctx.createRadialGradient(
        lightScreenX, newLightScreenY, 0,             // Inner circle (center, radius)
        lightScreenX, newLightScreenY, currentLightRadius // Outer circle (center, radius)
    );
    lightGradient.addColorStop(0.30, CF_INNER_COLOR);
    lightGradient.addColorStop(1, CF_OUTER_COLOR);

    ctx.fillStyle = lightGradient;
    ctx.beginPath();
    ctx.arc(lightScreenX, newLightScreenY, currentLightRadius, 0, Math.PI * 2);
    ctx.fill();
}; 