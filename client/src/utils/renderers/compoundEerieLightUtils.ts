/**
 * compoundEerieLightUtils.ts
 * 
 * Eerie nanobot-style ambient light rendering for the central compound.
 * Replaces the old street lamp graphics with ghostly blue/purple glows
 * similar to the shipwreck Lagunov ghost lights, giving the compound
 * an otherworldly, technology-infused atmosphere at night.
 * 
 * These are purely visual overlays (no collision, no physical structure).
 * The day/night mask cutouts are handled separately in dayNightCycleRuntime.ts.
 */

import { getCompoundEerieLightsWithPositions, CompoundEerieLight } from '../../config/compoundBuildings';
import { isNightTime, NIGHT_LIGHTS_ON, LIGHT_FADE_FULL_AT, TWILIGHT_MORNING_FADE_START, TWILIGHT_MORNING_END } from '../../config/dayNightConstants';
import { ENABLE_CENTRAL_COMPOUND_EERIE_PARTICLES } from '../../config/visualFeatureFlags';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION - Eerie Nanobot Light Palette
// ═══════════════════════════════════════════════════════════════════════════

// Eerie nanobot colors - ghostly blue/purple matching Lagunov ghost palette
const EERIE_PRIMARY = { r: 80, g: 120, b: 200 };   // Deep ocean blue
const EERIE_ACCENT = { r: 140, g: 100, b: 220 };    // Mystical purple
const EERIE_DEEP = { r: 30, g: 50, b: 100 };        // Deep indigo (outer halo)
const EERIE_HIGHLIGHT = { r: 180, g: 200, b: 255 };  // Bright ethereal highlight

// Rising particle configuration. Keep this lightweight: all compound lights can be
// visible at once, so per-particle radial gradients are too expensive for the hot path.
const PARTICLE_COUNT = 1;
const PARTICLE_LIFETIME_SECONDS = 5.0;
const PARTICLE_SPAWN_RADIUS = 60;
const PARTICLE_MIN_SIZE = 2;
const PARTICLE_MAX_SIZE = 7;
const LIGHT_EFFECT_CULL_BUFFER = 260;

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════

function seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

function lerpColor(
    c1: { r: number; g: number; b: number },
    c2: { r: number; g: number; b: number },
    t: number
): { r: number; g: number; b: number } {
    return {
        r: Math.round(c1.r + (c2.r - c1.r) * t),
        g: Math.round(c1.g + (c2.g - c1.g) * t),
        b: Math.round(c1.b + (c2.b - c1.b) * t),
    };
}

function isLightVisibleOnScreen(
    worldX: number,
    worldY: number,
    radius: number,
    viewMinX: number,
    viewMaxX: number,
    viewMinY: number,
    viewMaxY: number
): boolean {
    return worldX + radius >= viewMinX &&
        worldX - radius <= viewMaxX &&
        worldY + radius >= viewMinY &&
        worldY - radius <= viewMaxY;
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Render a single compound eerie light with full shipwreck-style effects:
 * - Outer ethereal halo with drift
 * - Main ambient blue/purple glow
 * - Inner core radiance
 * - Ground light pool (elliptical)
 * - Rising ghostly particles
 */
function renderCompoundEerieLight(
    ctx: CanvasRenderingContext2D,
    light: CompoundEerieLight & { worldX: number; worldY: number },
    cycleProgress: number,
    cameraOffsetX: number,
    cameraOffsetY: number,
    nowMs: number
): void {
    if (!isNightTime(cycleProgress)) return;

    let timeIntensity = light.intensity;
    if (cycleProgress < LIGHT_FADE_FULL_AT) {
        const fadeProgress = (cycleProgress - NIGHT_LIGHTS_ON) / (LIGHT_FADE_FULL_AT - NIGHT_LIGHTS_ON);
        timeIntensity = light.intensity * Math.pow(Math.max(0, fadeProgress), 0.7);
    } else if (cycleProgress >= TWILIGHT_MORNING_FADE_START) {
        const fadeProgress = (TWILIGHT_MORNING_END - cycleProgress) / (TWILIGHT_MORNING_END - TWILIGHT_MORNING_FADE_START);
        timeIntensity = light.intensity * Math.pow(Math.max(0, fadeProgress), 0.7);
    }

    const currentTimeSeconds = nowMs / 1000;
    const finalIntensity = timeIntensity * (1.0 + Math.sin(currentTimeSeconds * 0.45) * 0.08);
    if (finalIntensity <= 0.01) return;

    const screenX = light.worldX + cameraOffsetX;
    const screenY = light.worldY + cameraOffsetY;
    const ambientRadius = light.radius;
    const ghostlyPulse = 1.0 + Math.sin(currentTimeSeconds * 1.5) * 0.06;
    const ambientGradient = ctx.createRadialGradient(
        screenX, screenY, 0,
        screenX, screenY, ambientRadius
    );
    ambientGradient.addColorStop(0, `rgba(${EERIE_HIGHLIGHT.r}, ${EERIE_HIGHLIGHT.g}, ${EERIE_HIGHLIGHT.b}, ${0.16 * finalIntensity * ghostlyPulse})`);
    ambientGradient.addColorStop(0.35, `rgba(${EERIE_PRIMARY.r}, ${EERIE_PRIMARY.g}, ${EERIE_PRIMARY.b}, ${0.12 * finalIntensity})`);
    ambientGradient.addColorStop(0.7, `rgba(${EERIE_ACCENT.r}, ${EERIE_ACCENT.g}, ${EERIE_ACCENT.b}, ${0.06 * finalIntensity})`);
    ambientGradient.addColorStop(1, `rgba(${EERIE_DEEP.r}, ${EERIE_DEEP.g}, ${EERIE_DEEP.b}, 0)`);

    ctx.fillStyle = ambientGradient;
    ctx.beginPath();
    ctx.arc(screenX, screenY, ambientRadius, 0, Math.PI * 2);
    ctx.fill();

    if (ENABLE_CENTRAL_COMPOUND_EERIE_PARTICLES) {
        renderEerieParticles(ctx, light, screenX, screenY, nowMs, finalIntensity);
    }
}

/**
 * Render deterministic rising particles for an eerie compound light.
 */
function renderEerieParticles(
    ctx: CanvasRenderingContext2D,
    light: CompoundEerieLight,
    screenX: number,
    screenY: number,
    nowMs: number,
    finalIntensity: number
): void {
    const currentTimeSeconds = nowMs / 1000;
    // Use light ID hash as seed base for determinism
    let seedBase = 0;
    for (let i = 0; i < light.id.length; i++) {
        seedBase = seedBase * 31 + light.id.charCodeAt(i);
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        let seed = seedBase + i * 1000;

        const angle = seededRandom(seed++) * Math.PI * 2;
        const distance = seededRandom(seed++) * PARTICLE_SPAWN_RADIUS;
        const spawnOffsetX = Math.cos(angle) * distance;
        const spawnOffsetY = Math.sin(angle) * distance * 0.5;
        const spawnTimeOffset = seededRandom(seed++) * PARTICLE_LIFETIME_SECONDS;
        const driftPhase = seededRandom(seed++) * Math.PI * 2;
        const size = PARTICLE_MIN_SIZE + seededRandom(seed++) * (PARTICLE_MAX_SIZE - PARTICLE_MIN_SIZE);
        const colorVariant = seededRandom(seed++);

        // Calculate particle lifecycle position
        const particleTime = (currentTimeSeconds + spawnTimeOffset) % PARTICLE_LIFETIME_SECONDS;
        const lifeProgress = particleTime / PARTICLE_LIFETIME_SECONDS;

        // Rise upward
        const riseY = -lifeProgress * 60; // Rise 60px over lifetime
        // Horizontal drift
        const driftX = Math.sin(driftPhase + currentTimeSeconds * 0.5) * 12;

        // Alpha: fade in, hold, fade out
        let alpha: number;
        if (lifeProgress < 0.15) {
            alpha = lifeProgress / 0.15; // Fade in
        } else if (lifeProgress > 0.75) {
            alpha = (1.0 - lifeProgress) / 0.25; // Fade out
        } else {
            alpha = 1.0;
        }
        alpha *= finalIntensity * 0.7;
        if (alpha <= 0.01) continue;

        const px = screenX + spawnOffsetX + driftX;
        const py = screenY + spawnOffsetY + riseY;

        // Interpolate color between primary and accent
        const color = lerpColor(EERIE_PRIMARY, EERIE_ACCENT, colorVariant);

        // Cheap particle glow: solid translucent circles avoid dozens of radial gradients
        // when the whole compound is visible.
        const glowRadius = size * 2.6;
        ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha * 0.12})`;
        ctx.beginPath();
        ctx.arc(px, py, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        // Core particle
        ctx.fillStyle = `rgba(${EERIE_HIGHLIGHT.r}, ${EERIE_HIGHLIGHT.g}, ${EERIE_HIGHLIGHT.b}, ${alpha * 0.55})`;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Render all compound eerie lights. Call from GameCanvas during night rendering pass.
 */
export function renderCompoundEerieLights(
    ctx: CanvasRenderingContext2D,
    cycleProgress: number,
    cameraOffsetX: number,
    cameraOffsetY: number,
    viewMinX: number,
    viewMaxX: number,
    viewMinY: number,
    viewMaxY: number,
    nowMs: number
): void {
    if (!isNightTime(cycleProgress)) return;

    for (const light of getCompoundEerieLightsWithPositions()) {
        if (!isLightVisibleOnScreen(
            light.worldX,
            light.worldY,
            light.radius + LIGHT_EFFECT_CULL_BUFFER,
            viewMinX,
            viewMaxX,
            viewMinY,
            viewMaxY
        )) {
            continue;
        }

        renderCompoundEerieLight(ctx, light, cycleProgress, cameraOffsetX, cameraOffsetY, nowMs);
    }
}
