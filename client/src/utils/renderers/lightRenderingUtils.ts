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
            
            const lightScreenX = lightCenterX + cameraOffsetX;
            const lightScreenY = lightCenterY + cameraOffsetY;
            const baseFlicker = (Math.random() - 0.5) * 2 * TORCH_FLICKER_AMOUNT;

            // Add subtle asymmetry for more rustic feel
            const asymmetryX = (Math.random() - 0.5) * baseFlicker * 0.3;
            const asymmetryY = (Math.random() - 0.5) * baseFlicker * 0.2;
            const rustixLightX = lightScreenX + asymmetryX;
            const rustixLightY = lightScreenY + asymmetryY;

            // Layer 1: Large ambient glow (torch fuel - more yellow-orange than campfire)
            const ambientRadius = Math.max(0, TORCH_LIGHT_RADIUS_BASE * 2.8 + baseFlicker * 0.4);
            const ambientGradient = ctx.createRadialGradient(
                rustixLightX, rustixLightY, 0,
                rustixLightX, rustixLightY, ambientRadius
            );
            ambientGradient.addColorStop(0, 'rgba(255, 140, 60, 0.04)'); // Torch fuel yellow-orange
            ambientGradient.addColorStop(0.3, 'rgba(245, 100, 40, 0.02)'); // Warm orange
            ambientGradient.addColorStop(1, 'rgba(220, 80, 30, 0)'); // Orange-red fade
            
            ctx.fillStyle = ambientGradient;
            ctx.beginPath();
            ctx.arc(rustixLightX, rustixLightY, ambientRadius, 0, Math.PI * 2);
            ctx.fill();

            // Layer 2: Main illumination (torch characteristic glow)
            const mainRadius = Math.max(0, TORCH_LIGHT_RADIUS_BASE * 1.8 + baseFlicker * 0.8);
            const mainGradient = ctx.createRadialGradient(
                rustixLightX, rustixLightY, 0,
                rustixLightX, rustixLightY, mainRadius
            );
            mainGradient.addColorStop(0, 'rgba(255, 200, 110, 0.18)'); // Bright torch yellow-orange
            mainGradient.addColorStop(0.2, 'rgba(255, 160, 80, 0.14)'); // Golden amber
            mainGradient.addColorStop(0.5, 'rgba(245, 120, 50, 0.08)'); // Warm orange
            mainGradient.addColorStop(0.8, 'rgba(220, 90, 35, 0.04)'); // Orange-red
            mainGradient.addColorStop(1, 'rgba(180, 70, 25, 0)'); // Deep orange fade
            
            ctx.fillStyle = mainGradient;
            ctx.beginPath();
            ctx.arc(rustixLightX, rustixLightY, mainRadius, 0, Math.PI * 2);
            ctx.fill();

            // Layer 3: Core bright light (torch flame center)
            const coreRadius = Math.max(0, TORCH_LIGHT_RADIUS_BASE * 0.5 + baseFlicker * 1.2);
            const coreGradient = ctx.createRadialGradient(
                rustixLightX, rustixLightY, 0,
                rustixLightX, rustixLightY, coreRadius
            );
            coreGradient.addColorStop(0, 'rgba(255, 240, 160, 0.28)'); // Bright torch flame center
            coreGradient.addColorStop(0.4, 'rgba(255, 180, 90, 0.18)'); // Golden yellow
            coreGradient.addColorStop(1, 'rgba(245, 140, 70, 0)'); // Warm orange fade
            
            ctx.fillStyle = coreGradient;
            ctx.beginPath();
            ctx.arc(lightScreenX, lightScreenY, coreRadius, 0, Math.PI * 2);
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
    const baseFlicker = (Math.random() - 0.5) * 2 * CAMPFIRE_FLICKER_AMOUNT;

    // Add more pronounced asymmetry for crackling campfire effect
    const campfireAsymmetryX = (Math.random() - 0.5) * baseFlicker * 0.6;
    const campfireAsymmetryY = (Math.random() - 0.5) * baseFlicker * 0.4;
    const rusticCampfireX = lightScreenX + campfireAsymmetryX;
    const rusticCampfireY = lightScreenY + campfireAsymmetryY;

    // DOUBLE THE ENTIRE LIGHTING SYSTEM - Scale everything by 2x while keeping proportions
    const CAMPFIRE_SCALE = 2.0; // Double the total coverage area for natural rustic feel

    // Layer 1: Large ambient glow (wood-burning campfire - deep oranges and reds)
    const ambientRadius = Math.max(0, CAMPFIRE_LIGHT_RADIUS_BASE * 3.9 * CAMPFIRE_SCALE + baseFlicker * 0.3);
    const ambientGradient = ctx.createRadialGradient(
        rusticCampfireX, rusticCampfireY, 0,
        rusticCampfireX, rusticCampfireY, ambientRadius
    );
    ambientGradient.addColorStop(0, 'rgba(255, 80, 20, 0.05)'); // Deep campfire orange-red
    ambientGradient.addColorStop(0.25, 'rgba(200, 60, 15, 0.03)'); // Rich ember red
    ambientGradient.addColorStop(0.7, 'rgba(160, 40, 12, 0.015)'); // Deep wood-burning red
    ambientGradient.addColorStop(1, 'rgba(120, 25, 8, 0)'); // Dark ember fade
    
    ctx.fillStyle = ambientGradient;
    ctx.beginPath();
    ctx.arc(rusticCampfireX, rusticCampfireY, ambientRadius, 0, Math.PI * 2);
    ctx.fill();

    // Layer 2: Main illumination (authentic wood fire colors)
    const mainRadius = Math.max(0, CAMPFIRE_LIGHT_RADIUS_BASE * 2.6 * CAMPFIRE_SCALE + baseFlicker * 1.0);
    const mainGradient = ctx.createRadialGradient(
        rusticCampfireX, rusticCampfireY, 0,
        rusticCampfireX, rusticCampfireY, mainRadius
    );
    mainGradient.addColorStop(0, 'rgba(255, 140, 60, 0.22)'); // Warm campfire orange center
    mainGradient.addColorStop(0.15, 'rgba(240, 100, 30, 0.18)'); // Rich orange
    mainGradient.addColorStop(0.4, 'rgba(220, 70, 20, 0.12)'); // Deep orange-red
    mainGradient.addColorStop(0.7, 'rgba(180, 50, 15, 0.06)'); // Ember red
    mainGradient.addColorStop(0.9, 'rgba(140, 35, 10, 0.02)'); // Deep wood burning
    mainGradient.addColorStop(1, 'rgba(100, 25, 8, 0)'); // Dark rustic fade
    
    ctx.fillStyle = mainGradient;
    ctx.beginPath();
    ctx.arc(rusticCampfireX, rusticCampfireY, mainRadius, 0, Math.PI * 2);
    ctx.fill();

    // Layer 3: Core bright light (intense campfire flame center) 
    const coreRadius = Math.max(0, CAMPFIRE_LIGHT_RADIUS_BASE * 0.65 * CAMPFIRE_SCALE + baseFlicker * 1.5);
    const coreGradient = ctx.createRadialGradient(
        rusticCampfireX, rusticCampfireY, 0,
        rusticCampfireX, rusticCampfireY, coreRadius
    );
    coreGradient.addColorStop(0, 'rgba(255, 180, 100, 0.32)'); // Bright campfire center
    coreGradient.addColorStop(0.3, 'rgba(255, 120, 40, 0.22)'); // Rich orange
    coreGradient.addColorStop(0.7, 'rgba(220, 80, 25, 0.12)'); // Deep orange-red glow
    coreGradient.addColorStop(1, 'rgba(180, 60, 20, 0)'); // Rustic red fade
    
    ctx.fillStyle = coreGradient;
    ctx.beginPath();
    ctx.arc(lightScreenX, lightScreenY, coreRadius, 0, Math.PI * 2);
    ctx.fill();
};