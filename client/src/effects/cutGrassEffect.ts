import type { DbConnection } from '../generated';
import type { GrassState, GrassAppearanceType } from '../generated/types';

// ============================================================================
// AAA PIXEL ART CUT GRASS ANIMATION EFFECT
// ============================================================================
// Creates animated grass blade particles that fly outward when grass is cut
// Features: Physics-based movement, rotation, color variation, procedural rendering
//
// NOTE: With table normalization (Grass + GrassState split), we listen to 
// GrassState.onDelete since that's what gets removed when grass is destroyed
// (the static Grass table is never deleted, only GrassState)
// ============================================================================

const PARTICLE_LIFETIME_MS = 800; // 0.8 seconds for longer, more visible animation
const NUM_PARTICLES_PER_GRASS = 8; // More particles for dramatic effect
const INITIAL_SPEED_MIN = 60; // Min initial speed in pixels per second
const INITIAL_SPEED_MAX = 140; // Max initial speed in pixels per second
const GRAVITY = 180; // Downward acceleration in pixels per second squared
const MAX_ROTATION_SPEED_DEG = 360; // Max rotation speed in degrees per second
const UPWARD_BIAS = -80; // Initial upward velocity bias

// Pixel art grass blade colors (multiple shades for variety) - green for regular grass
const GRASS_BLADE_COLORS = [
    '#2D5A27', // Dark forest green
    '#3B7A33', // Medium green
    '#4A9B3F', // Vibrant green
    '#5CB349', // Light green
    '#6BC955', // Bright lime green
    '#367336', // Muted green
    '#28461E', // Very dark green
];

// Yellow/beige colors for alpine grass 2 and 4 (matches yellow alpine grass sprites)
const ALPINE_GRASS_BLADE_COLORS = [
    '#D4AF6A', // Light golden beige
    '#E5C896', // Pale yellow-beige
    '#C9A86A', // Medium golden beige
    '#F5E6D3', // Very light cream
    '#B8956A', // Darker golden beige
    '#E8D4A8', // Warm beige
    '#D9C19A', // Muted yellow-beige
];

// White/cream colors for alpine grass 1 and 3 (matches white alpine grass sprites)
const WHITE_ALPINE_GRASS_BLADE_COLORS = [
    '#FFFFFF', // Pure white
    '#F8F8F8', // Off-white
    '#F0F0F0', // Light gray-white
    '#E8E8E8', // Slightly darker white
    '#FAFAFA', // Very light cream
    '#F5F5F5', // Light white-gray
    '#EFEFEF', // Soft white
];

// Red colors for tundra grass (matches red tundra grass sprites)
const TUNDRA_GRASS_BLADE_COLORS = [
    '#8B0000', // Dark red
    '#A52A2A', // Brown-red
    '#B22222', // Fire brick red
    '#C04000', // Dark orange-red
    '#DC143C', // Crimson
    '#CD5C5C', // Indian red
    '#E9967A', // Dark salmon
];

// Particle blade shapes (pixel widths for variety)
const BLADE_SHAPES = [
    { width: 2, height: 10 }, // Thin tall
    { width: 3, height: 12 }, // Medium
    { width: 2, height: 8 },  // Short thin
    { width: 4, height: 14 }, // Wide tall
    { width: 3, height: 7 },  // Short medium
    { width: 2, height: 6 },  // Tiny
];

interface CutGrassParticle {
    id: string;
    x: number;
    y: number;
    velocityX: number;
    velocityY: number;
    rotation: number;
    rotationSpeed: number;
    opacity: number;
    scale: number;
    startTime: number;
    color: string;
    bladeWidth: number;
    bladeHeight: number;
    curved: boolean; // Whether to draw curved blade
    curveDirection: number; // -1 or 1 for curve direction
}

const activeParticles: CutGrassParticle[] = [];

// Function to be called when a GrassState entity is deleted (grass destroyed)
// With table split, GrassState is deleted when grass health becomes 0
export function handleGrassStateDestroyed(connection: DbConnection, grassState: GrassState) {
    // Look up the static Grass table to get the position and appearance type
    if (!connection.db?.grass) {
        // console.warn("[CutGrassEffect] Cannot spawn particles - grass table not available");
        return;
    }
        
    // Find the static grass data by ID (Grass.id matches GrassState.grassId)
    const grass = connection.db.grass.id.find(grassState.grassId);
    if (grass) {
        spawnCutGrassParticles(grass.posX, grass.posY, grassState.grassId, grass.appearanceType);
    } else {
        // Fallback: if we can't find the grass (rare edge case), skip the effect
        // console.warn(`[CutGrassEffect] Could not find grass position for grassId ${grassState.grassId}`);
    }
}

// Check if appearance type is alpine grass 2 or 4 (yellow grass)
function isYellowAlpineGrass(appearanceType: GrassAppearanceType): boolean {
    const tag = appearanceType.tag;
    return tag === 'AlpinePatchB' || // alpine2
           tag === 'AlpinePatchD';    // alpine4
}

// Check if appearance type is alpine grass 1 or 3 (white grass)
function isWhiteAlpineGrass(appearanceType: GrassAppearanceType): boolean {
    const tag = appearanceType.tag;
    return tag === 'AlpinePatchA' || // alpine1
           tag === 'AlpinePatchC';    // alpine3
}

// Check if appearance type is tundra grass (red grass)
function isTundraGrass(appearanceType: GrassAppearanceType): boolean {
    const tag = appearanceType.tag;
    return tag === 'TundraPatchA' ||
           tag === 'TundraPatchB' ||
           tag === 'TundraPatchC' ||
           tag === 'TundraPatchD' ||
           tag === 'TallGrassTundraA' ||
           tag === 'TallGrassTundraB';
}

export function spawnCutGrassParticles(
    centerX: number, 
    centerY: number, 
    grassId: number | bigint, 
    appearanceType?: GrassAppearanceType
) {
    const now = Date.now();
    // The 3D renderer does not draw this 2D pool, so discard expired entries
    // on the next cut as well as during 2D rendering.
    for (let i = activeParticles.length - 1; i >= 0; i--) {
        if (now - activeParticles[i].startTime >= PARTICLE_LIFETIME_MS) activeParticles.splice(i, 1);
    }
    
    // Determine color palette based on grass type
    // AlpinePatchB (alpine2) and AlpinePatchD (alpine4) use yellow colors
    // AlpinePatchA (alpine1) and AlpinePatchC (alpine3) use white colors
    // All tundra grass types use red colors
    // All other grass types use green colors
    let colorPalette = GRASS_BLADE_COLORS; // Default to green
    if (appearanceType) {
        if (isYellowAlpineGrass(appearanceType)) {
            colorPalette = ALPINE_GRASS_BLADE_COLORS;
        } else if (isWhiteAlpineGrass(appearanceType)) {
            colorPalette = WHITE_ALPINE_GRASS_BLADE_COLORS;
        } else if (isTundraGrass(appearanceType)) {
            colorPalette = TUNDRA_GRASS_BLADE_COLORS;
        }
    }

    for (let i = 0; i < NUM_PARTICLES_PER_GRASS; i++) {
        // Create particles in a circular spread pattern with randomization
        const angle = (i / NUM_PARTICLES_PER_GRASS) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
        const speed = INITIAL_SPEED_MIN + Math.random() * (INITIAL_SPEED_MAX - INITIAL_SPEED_MIN);
        
        // Random blade shape
        const bladeShape = BLADE_SHAPES[Math.floor(Math.random() * BLADE_SHAPES.length)];
        
        // Random color from appropriate palette
        const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];

        const particle: CutGrassParticle = {
            id: `cut_grass_${grassId}_${i}_${now}`,
            x: centerX + (Math.random() - 0.5) * 8, // Small random offset from center
            y: centerY + (Math.random() - 0.5) * 8,
            velocityX: Math.cos(angle) * speed * (0.6 + Math.random() * 0.4),
            velocityY: Math.sin(angle) * speed + UPWARD_BIAS * (0.8 + Math.random() * 0.4),
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 2 * (MAX_ROTATION_SPEED_DEG * Math.PI / 180),
            opacity: 1.0,
            scale: 0.7 + Math.random() * 0.6, // Random scale 0.7 to 1.3
            startTime: now,
            color,
            bladeWidth: bladeShape.width,
            bladeHeight: bladeShape.height,
            curved: Math.random() > 0.5, // 50% chance of curved blade
            curveDirection: Math.random() > 0.5 ? 1 : -1,
        };
        activeParticles.push(particle);
    }
}

/**
 * Draws a single pixel-art grass blade
 */
function drawGrassBlade(
    ctx: CanvasRenderingContext2D, 
    bladeWidth: number, 
    bladeHeight: number, 
    color: string,
    curved: boolean,
    curveDirection: number,
    scale: number
) {
    const scaledWidth = bladeWidth * scale;
    const scaledHeight = bladeHeight * scale;
    
    ctx.fillStyle = color;
    
    if (curved) {
        // Draw curved blade (like a grass blade bending)
        ctx.beginPath();
        const curveAmount = scaledWidth * 0.8 * curveDirection;
        
        // Start at base
        ctx.moveTo(-scaledWidth / 2, scaledHeight / 2);
        
        // Right side going up (with curve)
        ctx.lineTo(scaledWidth / 2, scaledHeight / 2);
        ctx.quadraticCurveTo(
            scaledWidth / 2 + curveAmount, 
            0,
            curveAmount / 2, 
            -scaledHeight / 2
        );
        
        // Top point (narrower)
        ctx.lineTo(curveAmount / 2 - scaledWidth * 0.3, -scaledHeight / 2);
        
        // Left side going down
        ctx.quadraticCurveTo(
            -scaledWidth / 2 + curveAmount * 0.5, 
            0,
            -scaledWidth / 2, 
            scaledHeight / 2
        );
        
        ctx.closePath();
        ctx.fill();
        
        // Add pixel-art style highlight
        ctx.fillStyle = lightenColor(color, 30);
        ctx.fillRect(-scaledWidth / 4, -scaledHeight / 4, Math.max(1, scaledWidth / 2), Math.max(1, scaledHeight / 3));
    } else {
        // Draw straight tapered blade (pixel art style)
        ctx.beginPath();
        
        // Base (wider)
        ctx.moveTo(-scaledWidth / 2, scaledHeight / 2);
        ctx.lineTo(scaledWidth / 2, scaledHeight / 2);
        
        // Taper to top (pointed)
        ctx.lineTo(scaledWidth * 0.2, -scaledHeight / 2);
        ctx.lineTo(-scaledWidth * 0.2, -scaledHeight / 2);
        
        ctx.closePath();
        ctx.fill();
        
        // Add pixel-art style highlight stripe
        ctx.fillStyle = lightenColor(color, 40);
        ctx.fillRect(-Math.max(1, scaledWidth / 6), -scaledHeight / 3, Math.max(1, scaledWidth / 3), scaledHeight * 0.6);
    }
}

/**
 * Lighten a hex color by a percentage
 */
function lightenColor(hex: string, percent: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, (num >> 16) + (255 * percent / 100));
    const g = Math.min(255, ((num >> 8) & 0x00FF) + (255 * percent / 100));
    const b = Math.min(255, (num & 0x0000FF) + (255 * percent / 100));
    return '#' + (0x1000000 + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1);
}

export function renderCutGrassEffects(ctx: CanvasRenderingContext2D, nowMs: number) {
    if (activeParticles.length === 0) return;

    ctx.save();

    for (let i = activeParticles.length - 1; i >= 0; i--) {
        const particle = activeParticles[i];
        const elapsedTime = nowMs - particle.startTime;

        if (elapsedTime >= PARTICLE_LIFETIME_MS) {
            activeParticles.splice(i, 1);
            continue;
        }

        const lifeProgress = elapsedTime / PARTICLE_LIFETIME_MS;
        const deltaTimeSeconds = elapsedTime / 1000;

        // Calculate position with physics
        // x = x0 + v0*t
        const currentX = particle.x + particle.velocityX * deltaTimeSeconds;
        // y = y0 + v0*t + 0.5*g*t^2 (gravity applied)
        const currentY = particle.y + particle.velocityY * deltaTimeSeconds + 0.5 * GRAVITY * deltaTimeSeconds * deltaTimeSeconds;

        // Calculate current rotation
        const currentRotation = particle.rotation + (particle.rotationSpeed * deltaTimeSeconds);
        
        // Fade out with easing (slower fade at start, faster at end)
        const fadeEase = Math.pow(1.0 - lifeProgress, 0.7);
        particle.opacity = fadeEase;

        // Scale decreases slightly over time (shrinking effect)
        const currentScale = particle.scale * (1.0 - lifeProgress * 0.3);

        // Render the grass blade particle
        if (particle.opacity > 0.01) {
            ctx.globalAlpha = particle.opacity;
            
            ctx.save();
            ctx.translate(currentX, currentY);
            ctx.rotate(currentRotation);
            
            // Draw the pixel-art grass blade
            drawGrassBlade(
                ctx,
                particle.bladeWidth,
                particle.bladeHeight,
                particle.color,
                particle.curved,
                particle.curveDirection,
                currentScale
            );
            
            ctx.restore();
        }
    }

    ctx.globalAlpha = 1.0;
    ctx.restore();
}

// Cleanup function
export function cleanupCutGrassEffectSystem() {
    activeParticles.length = 0;
} 
