import { Player as SpacetimeDBPlayer, ItemDefinition as SpacetimeDBItemDefinition, ActiveEquipment as SpacetimeDBActiveEquipment, Lantern as SpacetimeDBLantern } from '../../generated';

// --- Campfire Light Constants (defined locally now) ---
export const CAMPFIRE_LIGHT_RADIUS_BASE = 150;
export const CAMPFIRE_FLICKER_AMOUNT = 5; // Max pixels radius will change by
export const CAMPFIRE_LIGHT_INNER_COLOR = 'rgba(255, 180, 80, 0.35)'; // Warmer orange/yellow, slightly more opaque
export const CAMPFIRE_LIGHT_OUTER_COLOR = 'rgba(255, 100, 0, 0.0)';  // Fade to transparent orange

// --- Torch Light Constants (more yellow-orange for pitch/tar burning) ---
export const TORCH_LIGHT_RADIUS_BASE = CAMPFIRE_LIGHT_RADIUS_BASE * 0.8;
export const TORCH_FLICKER_AMOUNT = CAMPFIRE_FLICKER_AMOUNT * 0.7;
export const TORCH_LIGHT_INNER_COLOR = 'rgba(255, 200, 100, 0.32)'; // More yellow-orange for pitch/tar
export const TORCH_LIGHT_OUTER_COLOR = 'rgba(255, 140, 60, 0.0)';  // Golden orange fade

// --- Lantern Light Constants (warm amber/golden for tallow through glass) ---
export const LANTERN_LIGHT_RADIUS_BASE = CAMPFIRE_LIGHT_RADIUS_BASE * 1.2; // 20% larger radius than campfire
export const LANTERN_FLICKER_AMOUNT = CAMPFIRE_FLICKER_AMOUNT * 0.3; // Much more stable than campfire/torch
export const LANTERN_LIGHT_INNER_COLOR = 'rgba(255, 220, 160, 0.38)'; // Warm amber/golden for tallow
export const LANTERN_LIGHT_OUTER_COLOR = 'rgba(240, 180, 120, 0.0)'; // Golden amber fade

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
            ambientGradient.addColorStop(0, 'rgba(255, 180, 90, 0.05)'); // Pitch/tar golden yellow
            ambientGradient.addColorStop(0.3, 'rgba(250, 150, 70, 0.03)'); // Warm golden orange
            ambientGradient.addColorStop(1, 'rgba(240, 120, 50, 0)'); // Golden orange fade
            
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
            mainGradient.addColorStop(0, 'rgba(255, 220, 130, 0.20)'); // Bright pitch/tar golden yellow
            mainGradient.addColorStop(0.2, 'rgba(255, 190, 100, 0.16)'); // Rich golden amber
            mainGradient.addColorStop(0.5, 'rgba(250, 160, 80, 0.10)'); // Warm golden orange
            mainGradient.addColorStop(0.8, 'rgba(240, 130, 60, 0.05)'); // Golden orange
            mainGradient.addColorStop(1, 'rgba(220, 110, 45, 0)'); // Deep golden fade
            
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
            coreGradient.addColorStop(0, 'rgba(255, 245, 180, 0.30)'); // Bright pitch/tar flame center
            coreGradient.addColorStop(0.4, 'rgba(255, 210, 120, 0.20)'); // Rich golden yellow
            coreGradient.addColorStop(1, 'rgba(250, 170, 90, 0)'); // Warm golden fade
            
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

// Import the LANTERN_RENDER_Y_OFFSET and LANTERN_HEIGHT for proper alignment
import { LANTERN_RENDER_Y_OFFSET, LANTERN_HEIGHT } from '../renderers/lanternRenderingUtils';

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

    // ENHANCED LANTERN LIGHTING SYSTEM - smooth gradients, reduced glare
    const LANTERN_SCALE = 1.5; // 50% larger coverage than campfire for practical lighting

    // Layer 1: Large ambient glow (tallow through glass - warm amber, extended reach)
    const ambientRadius = Math.max(0, LANTERN_LIGHT_RADIUS_BASE * 3.5 * LANTERN_SCALE + baseFlicker * 0.1);
    const ambientGradient = ctx.createRadialGradient(
        steadyLanternX, steadyLanternY, 0,
        steadyLanternX, steadyLanternY, ambientRadius
    );
    ambientGradient.addColorStop(0, 'rgba(255, 220, 160, 0.07)'); // Warm tallow amber center
    ambientGradient.addColorStop(0.15, 'rgba(250, 200, 140, 0.06)'); // Rich amber glow
    ambientGradient.addColorStop(0.35, 'rgba(245, 180, 120, 0.05)'); // Golden amber transition
    ambientGradient.addColorStop(0.55, 'rgba(240, 160, 100, 0.04)'); // Deep amber
    ambientGradient.addColorStop(0.75, 'rgba(230, 140, 85, 0.03)'); // Warm amber orange
    ambientGradient.addColorStop(0.9, 'rgba(220, 125, 75, 0.02)'); // Soft amber
    ambientGradient.addColorStop(1, 'rgba(210, 110, 65, 0)'); // Gentle amber fade
    
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
    mainGradient.addColorStop(0, 'rgba(255, 235, 180, 0.20)'); // Warm tallow center (glass filtered)
    mainGradient.addColorStop(0.12, 'rgba(255, 225, 160, 0.18)'); // Soft amber bright center
    mainGradient.addColorStop(0.25, 'rgba(250, 210, 145, 0.16)'); // Rich amber
    mainGradient.addColorStop(0.4, 'rgba(245, 195, 130, 0.14)'); // Golden amber transition
    mainGradient.addColorStop(0.6, 'rgba(240, 180, 115, 0.11)'); // Deep golden amber
    mainGradient.addColorStop(0.8, 'rgba(235, 165, 100, 0.08)'); // Warm amber orange
    mainGradient.addColorStop(0.95, 'rgba(225, 150, 90, 0.04)'); // Soft amber
    mainGradient.addColorStop(1, 'rgba(215, 135, 80, 0)'); // Smooth amber fade
    
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
    coreGradient.addColorStop(0, 'rgba(255, 240, 190, 0.24)'); // Warm tallow core (glass diffused)
    coreGradient.addColorStop(0.15, 'rgba(255, 230, 170, 0.22)'); // Gentle amber bright core
    coreGradient.addColorStop(0.3, 'rgba(250, 220, 155, 0.20)'); // Rich amber
    coreGradient.addColorStop(0.5, 'rgba(245, 205, 140, 0.17)'); // Deep amber
    coreGradient.addColorStop(0.7, 'rgba(240, 190, 125, 0.13)'); // Golden amber transition
    coreGradient.addColorStop(0.85, 'rgba(235, 175, 110, 0.09)'); // Warm amber
    coreGradient.addColorStop(1, 'rgba(230, 160, 95, 0)'); // Smooth amber fade
    
    ctx.fillStyle = coreGradient;
    ctx.beginPath();
    ctx.arc(lightScreenX, lightScreenY, coreRadius, 0, Math.PI * 2);
    ctx.fill();
};