import { Player as SpacetimeDBPlayer, ItemDefinition as SpacetimeDBItemDefinition, ActiveEquipment as SpacetimeDBActiveEquipment, Lantern as SpacetimeDBLantern, Furnace as SpacetimeDBFurnace } from '../../generated';

// --- Campfire Light Constants (defined locally now) ---
export const CAMPFIRE_LIGHT_RADIUS_BASE = 150;
export const CAMPFIRE_FLICKER_AMOUNT = 5; // Max pixels radius will change by
export const CAMPFIRE_LIGHT_INNER_COLOR = 'rgba(255, 180, 80, 0.35)'; // Warmer orange/yellow, slightly more opaque
export const CAMPFIRE_LIGHT_OUTER_COLOR = 'rgba(255, 100, 0, 0.0)';  // Fade to transparent orange

// --- Torch Light Constants (more yellow-orange for pitch/tar burning) ---
export const TORCH_LIGHT_RADIUS_BASE = CAMPFIRE_LIGHT_RADIUS_BASE * 0.8;
export const TORCH_FLICKER_AMOUNT = CAMPFIRE_FLICKER_AMOUNT * 0.7;
export const TORCH_LIGHT_INNER_COLOR = 'rgba(255, 200, 100, 0.28)'; // Reduced intensity for pitch/tar
export const TORCH_LIGHT_OUTER_COLOR = 'rgba(255, 140, 60, 0.0)';  // Golden orange fade

// --- Lantern Light Constants (focused spot lighting, half the range) ---
export const LANTERN_LIGHT_RADIUS_BASE = CAMPFIRE_LIGHT_RADIUS_BASE * 0.6; // Reduced from 1.2 to 0.6 (half range)
export const LANTERN_FLICKER_AMOUNT = CAMPFIRE_FLICKER_AMOUNT * 0.3; // Much more stable than campfire/torch
export const LANTERN_LIGHT_INNER_COLOR = 'rgba(255, 220, 160, 0.32)'; // Reduced intensity for focused lighting
export const LANTERN_LIGHT_OUTER_COLOR = 'rgba(240, 180, 120, 0.0)'; // Golden amber fade

// --- Furnace Light Constants (industrial metal smelting - bright white-hot to orange gradient) ---
export const FURNACE_LIGHT_RADIUS_BASE = CAMPFIRE_LIGHT_RADIUS_BASE * 0.5; // Focused lighting, doesn't cast far
export const FURNACE_FLICKER_AMOUNT = CAMPFIRE_FLICKER_AMOUNT * 0.6; // More stable than campfire, industrial
export const FURNACE_LIGHT_INNER_COLOR = 'rgba(255, 240, 200, 0.4)'; // Bright white-hot center
export const FURNACE_LIGHT_OUTER_COLOR = 'rgba(255, 120, 40, 0.0)'; // Bright orange fade

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

            // Layer 1: Large ambient glow (pitch/tar burning - golden yellow-orange)
            const ambientRadius = Math.max(0, TORCH_LIGHT_RADIUS_BASE * 2.8 + baseFlicker * 0.4);
            const ambientGradient = ctx.createRadialGradient(
                rustixLightX, rustixLightY, 0,
                rustixLightX, rustixLightY, ambientRadius
            );
            ambientGradient.addColorStop(0, 'rgba(240, 160, 80, 0.04)'); // More natural pitch/tar golden
            ambientGradient.addColorStop(0.3, 'rgba(220, 130, 60, 0.025)'); // Warmer natural orange
            ambientGradient.addColorStop(1, 'rgba(200, 100, 40, 0)'); // Natural golden fade
            
            ctx.fillStyle = ambientGradient;
            ctx.beginPath();
            ctx.arc(rustixLightX, rustixLightY, ambientRadius, 0, Math.PI * 2);
            ctx.fill();

            // Layer 2: Main illumination (pitch/tar characteristic glow)
            const mainRadius = Math.max(0, TORCH_LIGHT_RADIUS_BASE * 1.8 + baseFlicker * 0.8);
            const mainGradient = ctx.createRadialGradient(
                rustixLightX, rustixLightY, 0,
                rustixLightX, rustixLightY, mainRadius
            );
            mainGradient.addColorStop(0, 'rgba(240, 200, 120, 0.16)'); // Natural pitch/tar golden
            mainGradient.addColorStop(0.2, 'rgba(230, 170, 90, 0.13)'); // Rich natural amber
            mainGradient.addColorStop(0.5, 'rgba(220, 140, 70, 0.08)'); // Warm natural orange
            mainGradient.addColorStop(0.8, 'rgba(210, 120, 50, 0.04)'); // Natural golden orange
            mainGradient.addColorStop(1, 'rgba(190, 100, 40, 0)'); // Natural golden fade
            
            ctx.fillStyle = mainGradient;
            ctx.beginPath();
            ctx.arc(rustixLightX, rustixLightY, mainRadius, 0, Math.PI * 2);
            ctx.fill();

            // Layer 3: Core bright light (pitch/tar flame center)
            const coreRadius = Math.max(0, TORCH_LIGHT_RADIUS_BASE * 0.5 + baseFlicker * 1.2);
            const coreGradient = ctx.createRadialGradient(
                rustixLightX, rustixLightY, 0,
                rustixLightX, rustixLightY, coreRadius
            );
            coreGradient.addColorStop(0, 'rgba(245, 220, 160, 0.24)'); // Natural pitch/tar flame center
            coreGradient.addColorStop(0.4, 'rgba(235, 190, 110, 0.16)'); // Natural golden yellow
            coreGradient.addColorStop(1, 'rgba(220, 150, 80, 0)'); // Natural golden fade
            
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

    // CAMPFIRE LIGHTING SYSTEM - Balanced scale for natural rustic feel
    const CAMPFIRE_SCALE = 1.5; // Reduced from 2.0 to 1.5 for more natural lighting

    // Layer 1: Large ambient glow (wood-burning campfire - deep oranges and reds)
    const ambientRadius = Math.max(0, CAMPFIRE_LIGHT_RADIUS_BASE * 3.9 * CAMPFIRE_SCALE + baseFlicker * 0.3);
    const ambientGradient = ctx.createRadialGradient(
        rusticCampfireX, rusticCampfireY, 0,
        rusticCampfireX, rusticCampfireY, ambientRadius
    );
    ambientGradient.addColorStop(0, 'rgba(220, 70, 20, 0.04)'); // Natural campfire orange-red
    ambientGradient.addColorStop(0.25, 'rgba(180, 55, 15, 0.025)'); // Natural ember red
    ambientGradient.addColorStop(0.7, 'rgba(140, 35, 12, 0.012)'); // Natural wood-burning red
    ambientGradient.addColorStop(1, 'rgba(100, 20, 8, 0)'); // Natural ember fade
    
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
    mainGradient.addColorStop(0, 'rgba(230, 120, 50, 0.18)'); // Natural campfire orange center
    mainGradient.addColorStop(0.15, 'rgba(210, 90, 25, 0.15)'); // Natural rich orange
    mainGradient.addColorStop(0.4, 'rgba(190, 60, 18, 0.10)'); // Natural orange-red
    mainGradient.addColorStop(0.7, 'rgba(160, 45, 12, 0.05)'); // Natural ember red
    mainGradient.addColorStop(0.9, 'rgba(120, 30, 8, 0.015)'); // Natural wood burning
    mainGradient.addColorStop(1, 'rgba(90, 20, 6, 0)'); // Natural rustic fade
    
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
    coreGradient.addColorStop(0, 'rgba(240, 160, 90, 0.26)'); // Natural campfire center
    coreGradient.addColorStop(0.3, 'rgba(220, 110, 35, 0.18)'); // Natural rich orange
    coreGradient.addColorStop(0.7, 'rgba(190, 70, 22, 0.10)'); // Natural orange-red glow
    coreGradient.addColorStop(1, 'rgba(160, 50, 18, 0)'); // Natural rustic fade
    
    ctx.fillStyle = coreGradient;
    ctx.beginPath();
    ctx.arc(lightScreenX, lightScreenY, coreRadius, 0, Math.PI * 2);
    ctx.fill();
};

// Import the LANTERN_RENDER_Y_OFFSET and LANTERN_HEIGHT for proper alignment
import { LANTERN_RENDER_Y_OFFSET, LANTERN_HEIGHT } from '../renderers/lanternRenderingUtils';

// Import the FURNACE_RENDER_Y_OFFSET and FURNACE_HEIGHT for proper alignment
import { FURNACE_RENDER_Y_OFFSET, FURNACE_HEIGHT } from '../renderers/furnaceRenderingUtils';

// --- Lantern Light Rendering ---
interface RenderLanternLightProps {
    ctx: CanvasRenderingContext2D;
    lantern: SpacetimeDBLantern;
    cameraOffsetX: number;
    cameraOffsetY: number;
}

export const renderLanternLight = ({
    ctx,
    lantern,
    cameraOffsetX,
    cameraOffsetY,
}: RenderLanternLightProps) => {
    if (!lantern.isBurning) {
        return; // Not burning, no light
    }

    const visualCenterX = lantern.posX;
    const visualCenterY = lantern.posY - (LANTERN_HEIGHT / 2) - LANTERN_RENDER_Y_OFFSET;
    
    const lightScreenX = visualCenterX + cameraOffsetX;
    const lightScreenY = visualCenterY + cameraOffsetY;
    const baseFlicker = (Math.random() - 0.5) * 2 * LANTERN_FLICKER_AMOUNT;

    // Add subtle asymmetry for lantern flame effect (much less than campfire)
    const lanternAsymmetryX = (Math.random() - 0.5) * baseFlicker * 0.2;
    const lanternAsymmetryY = (Math.random() - 0.5) * baseFlicker * 0.1;
    const steadyLanternX = lightScreenX + lanternAsymmetryX;
    const steadyLanternY = lightScreenY + lanternAsymmetryY;

    // FOCUSED LANTERN LIGHTING SYSTEM - spot lighting, natural intensity
    const LANTERN_SCALE = 1.0; // Focused spot lighting, smaller coverage than campfire

    // Layer 1: Large ambient glow (tallow through glass - warm amber, extended reach)
    const ambientRadius = Math.max(0, LANTERN_LIGHT_RADIUS_BASE * 3.5 * LANTERN_SCALE + baseFlicker * 0.1);
    const ambientGradient = ctx.createRadialGradient(
        steadyLanternX, steadyLanternY, 0,
        steadyLanternX, steadyLanternY, ambientRadius
    );
    ambientGradient.addColorStop(0, 'rgba(230, 200, 150, 0.05)'); // Natural tallow amber center
    ambientGradient.addColorStop(0.15, 'rgba(220, 180, 130, 0.04)'); // Natural amber glow
    ambientGradient.addColorStop(0.35, 'rgba(210, 160, 110, 0.035)'); // Natural amber transition
    ambientGradient.addColorStop(0.55, 'rgba(200, 140, 90, 0.03)'); // Natural deep amber
    ambientGradient.addColorStop(0.75, 'rgba(190, 125, 75, 0.02)'); // Natural amber orange
    ambientGradient.addColorStop(0.9, 'rgba(180, 110, 65, 0.015)'); // Natural soft amber
    ambientGradient.addColorStop(1, 'rgba(170, 95, 55, 0)'); // Natural amber fade
    
    ctx.fillStyle = ambientGradient;
    ctx.beginPath();
    ctx.arc(steadyLanternX, steadyLanternY, ambientRadius, 0, Math.PI * 2);
    ctx.fill();

    // Layer 2: Main illumination (tallow flame through glass with smooth transitions)
    const mainRadius = Math.max(0, LANTERN_LIGHT_RADIUS_BASE * 2.2 * LANTERN_SCALE + baseFlicker * 0.3);
    const mainGradient = ctx.createRadialGradient(
        steadyLanternX, steadyLanternY, 0,
        steadyLanternX, steadyLanternY, mainRadius
    );
    mainGradient.addColorStop(0, 'rgba(235, 215, 170, 0.16)'); // Natural tallow center (glass filtered)
    mainGradient.addColorStop(0.12, 'rgba(225, 205, 150, 0.14)'); // Natural amber bright center
    mainGradient.addColorStop(0.25, 'rgba(220, 190, 135, 0.12)'); // Natural rich amber
    mainGradient.addColorStop(0.4, 'rgba(210, 175, 120, 0.11)'); // Natural amber transition
    mainGradient.addColorStop(0.6, 'rgba(200, 160, 105, 0.09)'); // Natural deep amber
    mainGradient.addColorStop(0.8, 'rgba(190, 145, 90, 0.06)'); // Natural amber orange
    mainGradient.addColorStop(0.95, 'rgba(180, 130, 80, 0.03)'); // Natural soft amber
    mainGradient.addColorStop(1, 'rgba(170, 115, 70, 0)'); // Natural amber fade
    
    ctx.fillStyle = mainGradient;
    ctx.beginPath();
    ctx.arc(steadyLanternX, steadyLanternY, mainRadius, 0, Math.PI * 2);
    ctx.fill();

    // Layer 3: Core bright light (tallow flame center through glass with reduced glare) 
    const coreRadius = Math.max(0, LANTERN_LIGHT_RADIUS_BASE * 0.9 * LANTERN_SCALE + baseFlicker * 0.8);
    const coreGradient = ctx.createRadialGradient(
        steadyLanternX, steadyLanternY, 0,
        steadyLanternX, steadyLanternY, coreRadius
    );
    coreGradient.addColorStop(0, 'rgba(240, 220, 180, 0.20)'); // Natural tallow core (glass diffused)
    coreGradient.addColorStop(0.15, 'rgba(230, 210, 160, 0.18)'); // Natural amber bright core
    coreGradient.addColorStop(0.3, 'rgba(225, 200, 145, 0.16)'); // Natural rich amber
    coreGradient.addColorStop(0.5, 'rgba(215, 185, 130, 0.14)'); // Natural deep amber
    coreGradient.addColorStop(0.7, 'rgba(205, 170, 115, 0.11)'); // Natural amber transition
    coreGradient.addColorStop(0.85, 'rgba(195, 155, 100, 0.07)'); // Natural warm amber
    coreGradient.addColorStop(1, 'rgba(185, 140, 85, 0)'); // Natural amber fade
    
    ctx.fillStyle = coreGradient;
    ctx.beginPath();
    ctx.arc(lightScreenX, lightScreenY, coreRadius, 0, Math.PI * 2);
    ctx.fill();
};

// --- Furnace Light Rendering ---
interface RenderFurnaceLightProps {
    ctx: CanvasRenderingContext2D;
    furnace: SpacetimeDBFurnace;
    cameraOffsetX: number;
    cameraOffsetY: number;
}

export const renderFurnaceLight = ({
    ctx,
    furnace,
    cameraOffsetX,
    cameraOffsetY,
}: RenderFurnaceLightProps) => {
    if (!furnace.isBurning) {
        return; // Not burning, no light
    }

    const visualCenterX = furnace.posX;
    const visualCenterY = furnace.posY - (FURNACE_HEIGHT / 2) - FURNACE_RENDER_Y_OFFSET;
    
    const lightScreenX = visualCenterX + cameraOffsetX;
    const lightScreenY = visualCenterY + cameraOffsetY;
    const baseFlicker = (Math.random() - 0.5) * 2 * FURNACE_FLICKER_AMOUNT;

    // Add industrial asymmetry for furnace forge effect
    const furnaceAsymmetryX = (Math.random() - 0.5) * baseFlicker * 0.4;
    const furnaceAsymmetryY = (Math.random() - 0.5) * baseFlicker * 0.3;
    const industrialFurnaceX = lightScreenX + furnaceAsymmetryX;
    const industrialFurnaceY = lightScreenY + furnaceAsymmetryY;

    // INDUSTRIAL FURNACE LIGHTING SYSTEM - realistic high-temperature metal smelting
    const FURNACE_SCALE = 1.0; // Focused lighting that doesn't cast far

    // Layer 1: Large ambient glow (hot furnace - bright orange ambient heat)
    const ambientRadius = Math.max(0, FURNACE_LIGHT_RADIUS_BASE * 3.5 * FURNACE_SCALE + baseFlicker * 0.3);
    const ambientGradient = ctx.createRadialGradient(
        industrialFurnaceX, industrialFurnaceY, 0,
        industrialFurnaceX, industrialFurnaceY, ambientRadius
    );
    ambientGradient.addColorStop(0, 'rgba(255, 180, 100, 0.06)'); // Bright orange ambient heat
    ambientGradient.addColorStop(0.2, 'rgba(255, 160, 80, 0.05)'); // Warm orange glow
    ambientGradient.addColorStop(0.4, 'rgba(255, 140, 60, 0.04)'); // Deep orange
    ambientGradient.addColorStop(0.6, 'rgba(255, 120, 50, 0.03)'); // Rich orange
    ambientGradient.addColorStop(0.8, 'rgba(255, 100, 40, 0.02)'); // Bright orange fade
    ambientGradient.addColorStop(1, 'rgba(255, 80, 30, 0)'); // Orange fade to transparent
    
    ctx.fillStyle = ambientGradient;
    ctx.beginPath();
    ctx.arc(industrialFurnaceX, industrialFurnaceY, ambientRadius, 0, Math.PI * 2);
    ctx.fill();

    // Layer 2: Main illumination (bright yellow-orange furnace heat)
    const mainRadius = Math.max(0, FURNACE_LIGHT_RADIUS_BASE * 2.4 * FURNACE_SCALE + baseFlicker * 0.8);
    const mainGradient = ctx.createRadialGradient(
        industrialFurnaceX, industrialFurnaceY, 0,
        industrialFurnaceX, industrialFurnaceY, mainRadius
    );
    mainGradient.addColorStop(0, 'rgba(255, 220, 140, 0.15)'); // Bright yellow-orange center
    mainGradient.addColorStop(0.15, 'rgba(255, 200, 120, 0.13)'); // Warm yellow-orange
    mainGradient.addColorStop(0.3, 'rgba(255, 180, 100, 0.12)'); // Rich orange-yellow
    mainGradient.addColorStop(0.5, 'rgba(255, 160, 80, 0.10)'); // Deep orange
    mainGradient.addColorStop(0.7, 'rgba(255, 140, 70, 0.08)'); // Orange heat
    mainGradient.addColorStop(0.85, 'rgba(255, 120, 60, 0.06)'); // Warm orange
    mainGradient.addColorStop(1, 'rgba(255, 100, 50, 0)'); // Orange fade
    
    ctx.fillStyle = mainGradient;
    ctx.beginPath();
    ctx.arc(industrialFurnaceX, industrialFurnaceY, mainRadius, 0, Math.PI * 2);
    ctx.fill();


};