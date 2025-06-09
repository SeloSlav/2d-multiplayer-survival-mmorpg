import { Player as SpacetimeDBPlayer, ItemDefinition as SpacetimeDBItemDefinition, ActiveEquipment as SpacetimeDBActiveEquipment } from '../../generated';

// --- Campfire Light Constants (defined locally now) ---
export const CAMPFIRE_LIGHT_RADIUS_BASE = 150;
export const CAMPFIRE_FLICKER_AMOUNT = 5; // Max pixels radius will change by
export const CAMPFIRE_LIGHT_INNER_COLOR = 'rgba(255, 180, 80, 0.35)'; // Warmer orange/yellow, slightly more opaque
export const CAMPFIRE_LIGHT_OUTER_COLOR = 'rgba(255, 100, 0, 0.0)';  // Fade to transparent orange

// --- Torch Light Constants (derived from new local Campfire constants) ---
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
    renderPositionX?: number;
    renderPositionY?: number;
}

export const renderPlayerTorchLight = ({
    ctx,
    player,
    activeEquipments,
    itemDefinitions,
    cameraOffsetX,
    cameraOffsetY,
    renderPositionX,
    renderPositionY,
}: RenderPlayerTorchLightProps) => {
    if (!player.isTorchLit || !player.identity) {
        return; // Not lit or no identity, nothing to render
    }

    const playerIdentityStr = player.identity.toHexString();
    const equipment = activeEquipments.get(playerIdentityStr);

    if (equipment && equipment.equippedItemDefId) {
        const itemDef = itemDefinitions.get(equipment.equippedItemDefId.toString());
        if (itemDef && itemDef.name === "Torch") {
            const lightCenterX = renderPositionX ?? player.positionX;
            const lightCenterY = renderPositionY ?? player.positionY;
            
            const lightParams = {
                centerX: lightCenterX,
                centerY: lightCenterY,
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

import { Campfire as SpacetimeDBCampfire } from '../../generated';

// Import the CAMPFIRE_RENDER_Y_OFFSET and CAMPFIRE_HEIGHT for proper alignment
import { CAMPFIRE_RENDER_Y_OFFSET, CAMPFIRE_HEIGHT } from '../renderers/campfireRenderingUtils';

export const renderCampfireLight = ({
    ctx,
    campfire,
    cameraOffsetX,
    cameraOffsetY,
}: RenderCampfireLightProps) => {
    if (!campfire.isBurning) {
        return; // Not burning, no light
    }

    const visualCenterX = campfire.posX;
    const visualCenterY = campfire.posY - (CAMPFIRE_HEIGHT / 2) - CAMPFIRE_RENDER_Y_OFFSET;
    
    const lightScreenX = visualCenterX + cameraOffsetX;
    const lightScreenY = visualCenterY + cameraOffsetY;

    // Use locally defined constants directly
    const flicker = (Math.random() - 0.5) * 2 * CAMPFIRE_FLICKER_AMOUNT;
    const currentLightRadius = Math.max(0, CAMPFIRE_LIGHT_RADIUS_BASE + flicker) * 2.0;

    const lightGradient = ctx.createRadialGradient(
        lightScreenX, lightScreenY, 0,
        lightScreenX, lightScreenY, currentLightRadius
    );
    // Use locally defined constants directly
    lightGradient.addColorStop(0.30, CAMPFIRE_LIGHT_INNER_COLOR);
    lightGradient.addColorStop(1, CAMPFIRE_LIGHT_OUTER_COLOR);

    ctx.fillStyle = lightGradient;
    ctx.beginPath();
    ctx.arc(lightScreenX, lightScreenY, currentLightRadius, 0, Math.PI * 2);
    ctx.fill();
};