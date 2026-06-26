/**
 * alkStationRenderingUtils.ts
 * 
 * Rendering utility for ALK delivery substations
 * These are large industrial structures where players can deliver contracts
 */

import { AlkStation as SpacetimeDBAlkStation } from '../../generated/types';
import { drawDynamicGroundShadow } from './shadowUtils';
import { renderBuildingRestrictionOverlay, BuildingRestrictionZoneConfig } from './buildingRestrictionOverlayUtils';

// ALK Station visual constants - Large industrial structures (square sprite for proper proportions)
export const ALK_STATION_WIDTH = 480;  // Sprite width (square - matches height)
export const ALK_STATION_HEIGHT = 480; // Sprite height (tall industrial building)
export const ALK_STATION_Y_OFFSET = 0; // Offset from base position for rendering

// The actual building occupies roughly the bottom 80% of the sprite (rest is sky/empty)
// Image content analysis: building is roughly 80% of image height, starting from bottom
export const ALK_STATION_BUILDING_HEIGHT_RATIO = 0.80; // Building takes up bottom 80% of sprite
export const ALK_STATION_BUILDING_WIDTH_RATIO = 0.90; // Building width is about 90% of sprite width (centered)
export const ALK_STATION_BUILDING_HEIGHT = ALK_STATION_HEIGHT * ALK_STATION_BUILDING_HEIGHT_RATIO;
export const ALK_STATION_BUILDING_WIDTH = ALK_STATION_WIDTH * ALK_STATION_BUILDING_WIDTH_RATIO;

// Collision bounds - for the actual building part (bottom portion)
export const ALK_STATION_COLLISION_WIDTH = 240; // Collision width for walkable area around station
export const ALK_STATION_COLLISION_HEIGHT = 160; // Collision height (substations - bottom 1/3)
export const ALK_CENTRAL_COMPOUND_COLLISION_HEIGHT = 80; // Central compound collision height (half height from top - bottom 1/6)
export const ALK_STATION_COLLISION_RADIUS = 120; // Circular collision radius (reduced for easier navigation and Y-sorting)
export const PLAYER_ALK_STATION_INTERACTION_DISTANCE_SQUARED = 280 * 280; // 280px interaction radius (larger for big structure)

// Interaction outline bounds - for the actual building content (not the whole sprite)
export const ALK_STATION_OUTLINE_WIDTH = 480;  // Width of the interaction outline around building
export const ALK_STATION_OUTLINE_HEIGHT = 480; // Height of the interaction outline around building (square)
export const ALK_STATION_OUTLINE_Y_OFFSET = 240; // How far up from base to draw outline (centers on building)

// Preloaded image references - separate for central compound vs substations
let alkSubstationImage: HTMLImageElement | null = null;
let alkCentralCompoundImage: HTMLImageElement | null = null;
let isSubstationLoading = false;
let isCentralCompoundLoading = false;

/**
 * Preload the ALK substation image
 */
export function preloadAlkSubstationImage(): Promise<HTMLImageElement | null> {
    if (alkSubstationImage) return Promise.resolve(alkSubstationImage);
    if (isSubstationLoading) return Promise.resolve(null);
    
    isSubstationLoading = true;
    return new Promise((resolve) => {
        import('../../assets/doodads/alk_substation.png').then((module) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => {
                alkSubstationImage = img;
                isSubstationLoading = false;
                console.log('[ALK Station] Substation image loaded successfully');
                resolve(img);
            };
            img.onerror = () => {
                console.error('[ALK Station] Failed to load substation image');
                isSubstationLoading = false;
                resolve(null);
            };
            img.src = module.default;
        }).catch(() => {
            console.error('[ALK Station] Failed to import substation image');
            isSubstationLoading = false;
            resolve(null);
        });
    });
}

/**
 * Preload the ALK central compound image
 */
export function preloadAlkCentralCompoundImage(): Promise<HTMLImageElement | null> {
    if (alkCentralCompoundImage) return Promise.resolve(alkCentralCompoundImage);
    if (isCentralCompoundLoading) return Promise.resolve(null);
    
    isCentralCompoundLoading = true;
    return new Promise((resolve) => {
        import('../../assets/doodads/alk_central_compound.png').then((module) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => {
                alkCentralCompoundImage = img;
                isCentralCompoundLoading = false;
                console.log('[ALK Station] Central compound image loaded successfully');
                resolve(img);
            };
            img.onerror = () => {
                console.error('[ALK Station] Failed to load central compound image');
                isCentralCompoundLoading = false;
                resolve(null);
            };
            img.src = module.default;
        }).catch(() => {
            console.error('[ALK Station] Failed to import central compound image');
            isCentralCompoundLoading = false;
            resolve(null);
        });
    });
}

/**
 * Preload all ALK station images
 * All stations now use alk_substation.png, so only preload that
 */
export function preloadAlkStationImages(): Promise<void> {
    return preloadAlkSubstationImage().then(() => {});
}

/**
 * Get the appropriate ALK station image based on station ID
 * All stations (including Central Compound) now use alk_substation.png
 */
export function getAlkStationImage(stationId: number): HTMLImageElement | null {
    // All stations use the same substation sprite
    return alkSubstationImage;
}

/**
 * Get the building restriction zone configuration for an ALK station
 * Returns the zone config that can be used with renderBuildingRestrictionOverlay
 */
function getAlkStationRestrictionZone(station: SpacetimeDBAlkStation): BuildingRestrictionZoneConfig {
    const isCentralCompound = station.stationId === 0;
    
    // Safe zone radius multipliers (must match server-side values)
    const SAFE_ZONE_MULTIPLIER_CENTRAL = 8.75; // Central compound: 8.75x interaction_radius (25% larger asphalt)
    const SAFE_ZONE_MULTIPLIER_SUBSTATION = 3.0; // Substations: 3x interaction_radius
    
    const multiplier = isCentralCompound ? SAFE_ZONE_MULTIPLIER_CENTRAL : SAFE_ZONE_MULTIPLIER_SUBSTATION;
    const safeZoneRadius = station.interactionRadius * multiplier;
    
    return {
        centerX: station.worldPosX,
        centerY: station.worldPosY,
        radius: safeZoneRadius,
    };
}

/**
 * Render an ALK delivery station
 */
export function renderAlkStation(
    ctx: CanvasRenderingContext2D,
    station: SpacetimeDBAlkStation,
    cycleProgress: number,
    isHighlighted: boolean = false,
    doodadImagesRef?: React.RefObject<Map<string, HTMLImageElement>>,
    localPlayerPosition?: { x: number; y: number } | null,
    showSafeZone: boolean = false
): void {
    if (!station.isActive) return;
    
    // Station ID 0 = Central Compound, all others = Substations
    // Central Compound now uses alk_substation.png sprite
    const isCentralCompound = station.stationId === 0;
    const imageFileName = 'alk_substation.png';
    
    // Try to get image from doodadImagesRef first, then fallback to module-level preloaded images
    let img: HTMLImageElement | null | undefined = doodadImagesRef?.current?.get(imageFileName);
    if (!img) {
        // All stations (including Central Compound) now use alk_substation.png
        img = alkSubstationImage;
    }
    
    if (!img) {
        // Trigger preload for substation image and render placeholder
        preloadAlkSubstationImage();
        renderPlaceholder(ctx, station, isHighlighted, isCentralCompound);
        return;
    }
    
    const drawX = station.worldPosX - ALK_STATION_WIDTH / 2;
    const drawY = station.worldPosY - ALK_STATION_HEIGHT + ALK_STATION_Y_OFFSET;
    
    ctx.save();
    
    // ===== TRANSPARENCY WHEN PLAYER IS BEHIND =====
    // Similar to tree transparency - fade the station when player walks behind it
    // This ensures players are visible when behind large structures
    let shouldApplyTransparency = false;
    let transparencyAlpha = 1.0;
    
    if (localPlayerPosition) {
        // Calculate bounding boxes for overlap detection
        // Use TIGHTER bounds than full sprite - only trigger transparency when player is actually
        // inside the building graphic, not just at the edges
        const horizontalPadding = 80; // Shrink from each side - player must be well inside
        const topPadding = 150; // Shrink from top - player must be further into building
        
        const stationLeft = station.worldPosX - ALK_STATION_WIDTH / 2 + horizontalPadding;
        const stationRight = station.worldPosX + ALK_STATION_WIDTH / 2 - horizontalPadding;
        const stationTop = station.worldPosY - ALK_STATION_HEIGHT + ALK_STATION_Y_OFFSET + topPadding;
        const stationBottom = station.worldPosY;
        
        // Player bounding box (approximate)
        const playerSize = 48;
        const playerLeft = localPlayerPosition.x - playerSize / 2;
        const playerRight = localPlayerPosition.x + playerSize / 2;
        const playerTop = localPlayerPosition.y - playerSize;
        const playerBottom = localPlayerPosition.y;
        
        // Check for visual overlap - tighter bounds mean player must be more inside
        const overlapsHorizontally = playerRight > stationLeft && playerLeft < stationRight;
        const overlapsVertically = playerBottom > stationTop && playerTop < stationBottom;
        
        // Station should be transparent if:
        // 1. Player overlaps with station visually
        // 2. Station renders AFTER player (player.y < station.worldPosY means player is behind)
        // This matches the explicit comparison in EntityFilteringRuntime.
        const playerIsBehindStation = localPlayerPosition.y < station.worldPosY;
        
        if (overlapsHorizontally && overlapsVertically && playerIsBehindStation) {
            // Calculate how much the player is behind the station (for smooth fade)
            const depthDifference = station.worldPosY - localPlayerPosition.y;
            const maxDepthForFade = 200; // Max distance for fade effect (larger for big structure)
            
            if (depthDifference > 0 && depthDifference < maxDepthForFade) {
                // Smooth fade based on depth - more behind = more transparent
                const fadeProgress = Math.min(1.0, depthDifference / maxDepthForFade);
                transparencyAlpha = 1.0 - (fadeProgress * 0.6); // Max 60% transparency
                shouldApplyTransparency = true;
            } else if (depthDifference >= maxDepthForFade) {
                transparencyAlpha = 0.4; // Minimum opacity
                shouldApplyTransparency = true;
            }
        }
    }
    
    // Apply transparency if needed
    if (shouldApplyTransparency) {
        ctx.globalAlpha = transparencyAlpha;
    }
    
    // Draw real dynamic ground shadow using the same system as trees, stones, etc.
    drawDynamicGroundShadow({
        ctx,
        entityImage: img,
        entityCenterX: station.worldPosX,
        entityBaseY: station.worldPosY,
        imageDrawWidth: ALK_STATION_WIDTH,
        imageDrawHeight: ALK_STATION_HEIGHT,
        cycleProgress,
        maxShadowAlpha: 0.55, // Slightly darker for large industrial structure
        maxStretchFactor: 2.0, // Reasonable shadow stretch
        minStretchFactor: 0.2, // Minimum shadow at noon
        shadowBlur: 3, // Blurry shadow like other buildings
        pivotYOffset: 100, // Offset shadow pivot point up to account for building base
    });
    
    // Draw the station sprite
    ctx.drawImage(
        img,
        drawX,
        drawY,
        ALK_STATION_WIDTH,
        ALK_STATION_HEIGHT
    );
    
    // Draw safe zone overlay if Blueprint is equipped
    if (showSafeZone) {
        const zoneConfig = getAlkStationRestrictionZone(station);
        renderBuildingRestrictionOverlay(ctx, zoneConfig);
    }
    
    // NO label drawn - the "E" interaction label from the unified system is sufficient
    // Station name is shown in the delivery panel when interacting
    
    ctx.restore();
}


/**
 * Render a placeholder while image is loading
 * Only draws a placeholder for the building portion (bottom 60% of sprite area)
 */
function renderPlaceholder(
    ctx: CanvasRenderingContext2D,
    station: SpacetimeDBAlkStation,
    isHighlighted: boolean,
    isCentralCompound: boolean = false
): void {
    // Draw placeholder only for the building portion (not the full sprite area)
    const buildingWidth = ALK_STATION_BUILDING_WIDTH;
    const buildingHeight = ALK_STATION_BUILDING_HEIGHT;
    const drawX = station.worldPosX - buildingWidth / 2;
    const drawY = station.worldPosY - buildingHeight + ALK_STATION_Y_OFFSET * ALK_STATION_BUILDING_HEIGHT_RATIO;
    
    ctx.save();
    
    // Draw placeholder box - uses blue/cyan theme to match other interactables
    ctx.fillStyle = isHighlighted ? 'rgba(0, 212, 255, 0.3)' : 'rgba(100, 100, 100, 0.5)';
    ctx.strokeStyle = isHighlighted ? '#00d4ff' : '#666';
    ctx.lineWidth = 3;
    
    ctx.fillRect(drawX, drawY, buildingWidth, buildingHeight);
    ctx.strokeRect(drawX, drawY, buildingWidth, buildingHeight);
    
    // Draw loading text
    ctx.fillStyle = '#fff';
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const stationType = isCentralCompound ? 'Central Compound' : 'Substation';
    ctx.fillText(`Loading ALK ${stationType}...`, station.worldPosX, station.worldPosY - buildingHeight / 2);
    
    ctx.restore();
}

/**
 * Get Y-sort position for an ALK station (foot/base position)
 */
export function getAlkStationYSortPosition(station: SpacetimeDBAlkStation): number {
    return station.worldPosY;
}

/**
 * Check if a point is within the ALK station collision bounds
 * Uses circular collision for easier navigation around the structure
 * Collision center is offset UP from worldPosY to match the building's visual center
 */
export function isPointInAlkStationBounds(
    pointX: number,
    pointY: number,
    station: SpacetimeDBAlkStation
): boolean {
    // Collision center is 170px UP from worldPosY (matches clientCollision.ts offset)
    const collisionCenterY = station.worldPosY - 170;
    const dx = pointX - station.worldPosX;
    const dy = pointY - collisionCenterY;
    const distSq = dx * dx + dy * dy;
    return distSq <= ALK_STATION_COLLISION_RADIUS * ALK_STATION_COLLISION_RADIUS;
}

/**
 * Get the interaction outline bounds for the ALK station
 * Returns { x, y, width, height } for the outline around the actual building content
 */
export function getAlkStationOutlineBounds(station: SpacetimeDBAlkStation): {
    x: number;
    y: number;
    width: number;
    height: number;
} {
    return {
        x: station.worldPosX,
        y: station.worldPosY - ALK_STATION_OUTLINE_Y_OFFSET,
        width: ALK_STATION_OUTLINE_WIDTH,
        height: ALK_STATION_OUTLINE_HEIGHT
    };
}

