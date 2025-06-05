import { useEffect, useRef, useCallback, useState } from 'react';
import { Campfire as SpacetimeDBCampfire } from '../generated';
import { CAMPFIRE_RENDER_Y_OFFSET, CAMPFIRE_HEIGHT } from '../utils/renderers/campfireRenderingUtils';

// --- Particle System Types and Constants ---
export interface Particle {
  id: string;
  type: 'fire' | 'smoke' | 'smoke_burst';
  x: number; // world X
  y: number; // world Y
  vx: number;
  vy: number;
  spawnTime: number;
  initialLifetime: number;
  lifetime: number; // remaining lifetime
  size: number;
  color?: string;
  alpha: number;
}

// Adjusted for 2D Pixel Art style & increased intensity for more dramatic effects
const PARTICLE_FIRE_LIFETIME_MIN = 80; // Shorter for faster turnover
const PARTICLE_FIRE_LIFETIME_MAX = 200; // Shorter for faster turnover
const PARTICLE_FIRE_SPEED_Y_MIN = -0.60; // Much faster upward movement
const PARTICLE_FIRE_SPEED_Y_MAX = -0.75; // Much faster upward movement
const PARTICLE_FIRE_SPEED_X_SPREAD = 0.8; // More spread for liveliness
const PARTICLE_FIRE_SIZE_MIN = 2; 
const PARTICLE_FIRE_SIZE_MAX = 4;
const PARTICLE_FIRE_COLORS = ["#FFD878", "#FFB04A", "#FF783C", "#FC9842"];
const FIRE_PARTICLES_PER_CAMPFIRE_FRAME = 0.8; // INCREASED EVEN MORE: Much higher emission rate for dense fire

const PARTICLE_SMOKE_LIFETIME_MIN = 800; // Slightly shorter
const PARTICLE_SMOKE_LIFETIME_MAX = 1800; // Shorter for faster turnover
const PARTICLE_SMOKE_SPEED_Y_MIN = -0.1; // Slightly faster upward movement
const PARTICLE_SMOKE_SPEED_Y_MAX = -0.3; // Slightly faster upward movement
const PARTICLE_SMOKE_SPEED_X_SPREAD = 0.4; // More horizontal spread for billowing smoke
const PARTICLE_SMOKE_SIZE_MIN = 3;
const PARTICLE_SMOKE_SIZE_MAX = 5; // Slightly larger
const PARTICLE_SMOKE_GROWTH_RATE = 0.03; // Faster growth
const SMOKE_PARTICLES_PER_CAMPFIRE_FRAME = 0.3; // INCREASED: Much higher emission rate for more dramatic smoke
const SMOKE_INITIAL_ALPHA = 0.6; // INCREASED: Higher initial alpha for more visible smoke
const SMOKE_TARGET_ALPHA = 0.05;
const SMOKE_LINGER_DURATION_MS = 4000; // INCREASED: Much longer linger time for more dramatic gray smoke when turned off

// ADDED: Smoke colors - gray variations for realistic smoke
const PARTICLE_SMOKE_COLORS = ["#666666", "#777777", "#888888", "#999999", "#555555"];

// --- ADDED: Smoke Burst Constants ---
const SMOKE_BURST_PARTICLE_COUNT = 35; // DRAMATICALLY INCREASED: Much more particles for dramatic black plume
const SMOKE_BURST_COLORS = ["#1a1a1a", "#2a2a2a", "#333333", "#000000"]; // CHANGED: Use black/dark colors for stepping on fire
const SMOKE_BURST_LIFETIME_MIN = 600; // INCREASED: Longer lasting dramatic effect
const SMOKE_BURST_LIFETIME_MAX = 1500; // INCREASED: Longer lasting dramatic effect
const SMOKE_BURST_SPEED_X_SPREAD = 0.5; // INCREASED: Much wider spread for dramatic plume
const SMOKE_BURST_SPEED_Y_MIN = -0.2; // INCREASED: Faster upward movement
const SMOKE_BURST_SPEED_Y_MAX = -0.5; // INCREASED: Much faster upward movement
const SMOKE_BURST_SIZE_MIN = 3; // INCREASED: Larger particles
const SMOKE_BURST_SIZE_MAX = 6; // INCREASED: Much larger particles
const SMOKE_BURST_INITIAL_ALPHA = 0.9; // INCREASED: Much more visible dramatic smoke
// --- END ADDED ---

// --- Define constants for particle emitter positions relative to visual campfire center ---
// These values are measured as offsets from the visual center, not the entity base position
// Positive Y values move up from the center, negative values move down from the center
const FIRE_EMISSION_CENTER_Y_OFFSET = CAMPFIRE_HEIGHT * -0.30; // LOWERED SLIGHTLY: A bit lower but still above center
const SMOKE_EMISSION_CENTER_Y_OFFSET = CAMPFIRE_HEIGHT * -0.00; // Moved higher up - 25% up from center of visual bounds

// ADDED: Multiple fire emission zones for dynamic fire effect
const FIRE_EMISSION_ZONES = [
    {
        name: 'top',
        yOffset: CAMPFIRE_HEIGHT * -0.35, // Top flames
        emissionRate: 0.4, // Higher emission for main flames
        spread: { x: 6, y: 3 }, // Tighter spread for tip flames
        speedMultiplier: 1.0 // Normal speed
    },
    {
        name: 'middle',
        yOffset: CAMPFIRE_HEIGHT * -0.15, // Middle flames
        emissionRate: 0.3, // Medium emission for middle
        spread: { x: 10, y: 5 }, // Wider spread for middle flames
        speedMultiplier: 0.8 // Slightly slower
    },
    {
        name: 'base',
        yOffset: CAMPFIRE_HEIGHT * 0.05, // Base flames
        emissionRate: 0.15, // Lower emission for base
        spread: { x: 12, y: 6 }, // Widest spread for base flames
        speedMultiplier: 0.6 // Slower for base flames
    }
];

interface UseCampfireParticlesProps {
    visibleCampfiresMap: Map<string, SpacetimeDBCampfire>;
    deltaTime: number; // Delta time in milliseconds
}

export function useCampfireParticles({
    visibleCampfiresMap,
    deltaTime,
}: UseCampfireParticlesProps): Particle[] {
    // OPTIMIZED: Use ref instead of state to avoid re-renders every frame
    const particlesRef = useRef<Particle[]>([]);
    
    const fireEmissionAccumulatorRef = useRef<Map<string, number>>(new Map());
    const smokeEmissionAccumulatorRef = useRef<Map<string, number>>(new Map());
    const smokeBurstEmissionAccumulatorRef = useRef<Map<string, number>>(new Map()); // For continuous burst
    const prevBurningStatesRef = useRef<Map<string, boolean>>(new Map());
    const lingeringSmokeDataRef = useRef<Map<string, { lingerUntil: number }>>(new Map());
    const lastUpdateTimeRef = useRef<number>(performance.now());
    const animationFrameRef = useRef<number>(0);

    // Update particles using independent timing
    useEffect(() => {
        const updateParticles = () => {
            const now = performance.now();
            const deltaTime = now - lastUpdateTimeRef.current;
            lastUpdateTimeRef.current = now;
            
            if (deltaTime <= 0) {
                animationFrameRef.current = requestAnimationFrame(updateParticles);
                return;
            }

            const currentParticles = particlesRef.current;
            let liveParticleCount = 0;

            // Use actual deltaTime for frame-rate independent movement
            const deltaTimeFactor = deltaTime / 16.667; // Normalize to 60fps

            for (let i = 0; i < currentParticles.length; i++) {
                const p = currentParticles[i];
                const age = now - p.spawnTime;
                const lifetimeRemaining = p.initialLifetime - age;

                if (lifetimeRemaining <= 0) {
                    continue;
                }

                let newVx = p.vx;
                let newVy = p.vy;
                let newSize = p.size;
                let currentAlpha = p.alpha;

                if (p.type === 'smoke') {
                    newVy -= 0.003 * deltaTimeFactor;
                    newSize = Math.min(p.size + PARTICLE_SMOKE_GROWTH_RATE * deltaTimeFactor, PARTICLE_SMOKE_SIZE_MAX);
                    const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
                    currentAlpha = SMOKE_TARGET_ALPHA + (SMOKE_INITIAL_ALPHA - SMOKE_TARGET_ALPHA) * lifeRatio;
                } else if (p.type === 'fire') {
                     const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
                     currentAlpha = lifeRatio; 
                } else if (p.type === 'smoke_burst') {
                    newVy -= 0.0015 * deltaTimeFactor;
                    const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
                    currentAlpha = SMOKE_TARGET_ALPHA + ((SMOKE_INITIAL_ALPHA + 0.4) - SMOKE_TARGET_ALPHA) * lifeRatio;
                }

                p.x += newVx * deltaTimeFactor;
                p.y += newVy * deltaTimeFactor;
                p.lifetime = lifetimeRemaining;
                p.size = newSize;
                p.alpha = Math.max(0, Math.min(1, currentAlpha));

                if (p.alpha > 0.01) {
                    currentParticles[liveParticleCount++] = p;
                }
            }
            currentParticles.length = liveParticleCount;

            const newGeneratedParticles: Particle[] = [];
            const currentVisibleCampfireIds = new Set<string>();

            if (visibleCampfiresMap) {
                visibleCampfiresMap.forEach((campfire, campfireId) => {
                    currentVisibleCampfireIds.add(campfireId);
                    const wasBurning = prevBurningStatesRef.current.get(campfireId) || false;
                    const isCurrentlyBurning = campfire.isBurning;

                    let generateFireThisFrame = false;
                    let generateSmokeThisFrame = false;
                    let lingeringEntry = lingeringSmokeDataRef.current.get(campfireId);

                    if (isCurrentlyBurning) {
                        generateFireThisFrame = true;
                        generateSmokeThisFrame = true;
                        if (lingeringEntry) {
                            lingeringSmokeDataRef.current.delete(campfireId);
                            lingeringEntry = undefined; 
                        }
                    } else { // Not currently burning
                        if (wasBurning) { // Transitioned from on to off this frame
                            lingeringEntry = { lingerUntil: now + SMOKE_LINGER_DURATION_MS };
                            lingeringSmokeDataRef.current.set(campfireId, lingeringEntry);
                        }
                        if (lingeringEntry && now < lingeringEntry.lingerUntil) {
                            generateSmokeThisFrame = true; // Linger smoke
                        } else if (lingeringEntry && now >= lingeringEntry.lingerUntil) {
                            lingeringSmokeDataRef.current.delete(campfireId); // Lingering period over
                        }
                    }
                    prevBurningStatesRef.current.set(campfireId, isCurrentlyBurning);

                    // OPTIMIZATION: Calculate the visual center of the campfire for particle emission
                    const visualCenterX = campfire.posX;
                    const visualCenterY = campfire.posY - (CAMPFIRE_HEIGHT / 2) - CAMPFIRE_RENDER_Y_OFFSET;
                    
                    // Calculate emission points based on visual center
                    const fireEmissionX = visualCenterX;
                    const fireEmissionY = visualCenterY + FIRE_EMISSION_CENTER_Y_OFFSET;
                    
                    const smokeEmissionX = visualCenterX;
                    const smokeEmissionY = visualCenterY + SMOKE_EMISSION_CENTER_Y_OFFSET;

                    if (generateFireThisFrame) {
                        // MULTI-ZONE FIRE GENERATION: Generate fire particles from multiple emission zones
                        FIRE_EMISSION_ZONES.forEach((zone, zoneIndex) => {
                            let fireAcc = fireEmissionAccumulatorRef.current.get(`${campfireId}_${zone.name}`) || 0;
                            fireAcc += zone.emissionRate * deltaTimeFactor;
                            
                            while (fireAcc >= 1) {
                                fireAcc -= 1;
                                const lifetime = PARTICLE_FIRE_LIFETIME_MIN + Math.random() * (PARTICLE_FIRE_LIFETIME_MAX - PARTICLE_FIRE_LIFETIME_MIN);
                                
                                // Calculate emission position for this zone
                                const zoneEmissionX = visualCenterX;
                                const zoneEmissionY = visualCenterY + zone.yOffset;
                                
                                newGeneratedParticles.push({
                                    id: `fire_${zone.name}_${now}_${Math.random()}`, 
                                    type: 'fire',
                                    x: zoneEmissionX + (Math.random() - 0.5) * zone.spread.x,
                                    y: zoneEmissionY + (Math.random() - 0.5) * zone.spread.y,
                                    vx: (Math.random() - 0.5) * PARTICLE_FIRE_SPEED_X_SPREAD,
                                    vy: (PARTICLE_FIRE_SPEED_Y_MIN + Math.random() * (PARTICLE_FIRE_SPEED_Y_MAX - PARTICLE_FIRE_SPEED_Y_MIN)) * zone.speedMultiplier,
                                    spawnTime: now, 
                                    initialLifetime: lifetime, 
                                    lifetime,
                                    size: Math.floor(PARTICLE_FIRE_SIZE_MIN + Math.random() * (PARTICLE_FIRE_SIZE_MAX - PARTICLE_FIRE_SIZE_MIN)) + 1,
                                    color: PARTICLE_FIRE_COLORS[Math.floor(Math.random() * PARTICLE_FIRE_COLORS.length)],
                                    alpha: 1.0, 
                                });
                            }
                            fireEmissionAccumulatorRef.current.set(`${campfireId}_${zone.name}`, fireAcc);
                        });
                    } else {
                        // Reset all zone accumulators when not generating fire
                        FIRE_EMISSION_ZONES.forEach((zone) => {
                            fireEmissionAccumulatorRef.current.set(`${campfireId}_${zone.name}`, 0);
                        });
                    }

                    if (generateSmokeThisFrame) {
                        let smokeAcc = smokeEmissionAccumulatorRef.current.get(campfireId) || 0;
                        smokeAcc += SMOKE_PARTICLES_PER_CAMPFIRE_FRAME * deltaTimeFactor;
                        while (smokeAcc >= 1) {
                            smokeAcc -= 1;
                            const lifetime = PARTICLE_SMOKE_LIFETIME_MIN + Math.random() * (PARTICLE_SMOKE_LIFETIME_MAX - PARTICLE_SMOKE_LIFETIME_MIN);
                            newGeneratedParticles.push({
                                id: `smoke_${now}_${Math.random()}`, type: 'smoke',
                                x: smokeEmissionX + (Math.random() - 0.5) * 8, // INCREASED: Wider position spread for billowing smoke
                                y: smokeEmissionY + (Math.random() - 0.5) * 6, // INCREASED: More position spread
                                vx: (Math.random() - 0.5) * PARTICLE_SMOKE_SPEED_X_SPREAD,
                                vy: PARTICLE_SMOKE_SPEED_Y_MIN + Math.random() * (PARTICLE_SMOKE_SPEED_Y_MAX - PARTICLE_SMOKE_SPEED_Y_MIN),
                                spawnTime: now, initialLifetime: lifetime, lifetime,
                                size: Math.floor(PARTICLE_SMOKE_SIZE_MIN + Math.random() * (PARTICLE_SMOKE_SIZE_MAX - PARTICLE_SMOKE_SIZE_MIN)) + 1,
                                color: PARTICLE_SMOKE_COLORS[Math.floor(Math.random() * PARTICLE_SMOKE_COLORS.length)], // FIXED: Use gray smoke colors
                                alpha: SMOKE_INITIAL_ALPHA,
                            });
                        }
                        smokeEmissionAccumulatorRef.current.set(campfireId, smokeAcc);
                    } else {
                        smokeEmissionAccumulatorRef.current.set(campfireId, 0);
                    }

                    // --- Continuous Smoke Burst Logic (if player is in hot zone AND campfire is burning) ---
                    if (campfire.isPlayerInHotZone && isCurrentlyBurning) {
                        let burstAcc = smokeBurstEmissionAccumulatorRef.current.get(campfireId) || 0;
                        // DRAMATICALLY INCREASED: Much higher emission rate for dramatic black plume
                        burstAcc += 4.0 * deltaTimeFactor;
                        while (burstAcc >= 1) {
                            burstAcc -= 1;
                            const lifetime = SMOKE_BURST_LIFETIME_MIN + Math.random() * (SMOKE_BURST_LIFETIME_MAX - SMOKE_BURST_LIFETIME_MIN);
                            newGeneratedParticles.push({
                                id: `smokeburst_${campfireId}_${now}_${Math.random()}`,
                                type: 'smoke_burst',
                                x: visualCenterX + (Math.random() - 0.5) * 20, // INCREASED: Much wider spread for dramatic plume
                                y: visualCenterY + (Math.random() - 0.5) * 16, // INCREASED: Much wider spread
                                vx: (Math.random() - 0.5) * SMOKE_BURST_SPEED_X_SPREAD,
                                vy: SMOKE_BURST_SPEED_Y_MIN + Math.random() * (SMOKE_BURST_SPEED_Y_MAX - SMOKE_BURST_SPEED_Y_MIN),
                                spawnTime: now, initialLifetime: lifetime, lifetime,
                                size: SMOKE_BURST_SIZE_MIN + Math.floor(Math.random() * (SMOKE_BURST_SIZE_MAX - SMOKE_BURST_SIZE_MIN + 1)),
                                color: SMOKE_BURST_COLORS[Math.floor(Math.random() * SMOKE_BURST_COLORS.length)],
                                alpha: SMOKE_BURST_INITIAL_ALPHA,
                            });
                        }
                        smokeBurstEmissionAccumulatorRef.current.set(campfireId, burstAcc);
                    } else {
                        smokeBurstEmissionAccumulatorRef.current.set(campfireId, 0); // Reset if not in hot zone or campfire not burning
                    }
                });
            }

            // Cleanup refs for campfires no longer in visibleCampfiresMap
            prevBurningStatesRef.current.forEach((_, campfireId) => {
                if (!currentVisibleCampfireIds.has(campfireId)) {
                    prevBurningStatesRef.current.delete(campfireId);
                    // Clean up all fire zone accumulators for this campfire
                    FIRE_EMISSION_ZONES.forEach((zone) => {
                        fireEmissionAccumulatorRef.current.delete(`${campfireId}_${zone.name}`);
                    });
                    smokeEmissionAccumulatorRef.current.delete(campfireId);
                    smokeBurstEmissionAccumulatorRef.current.delete(campfireId); // Cleanup burst accumulator
                    lingeringSmokeDataRef.current.delete(campfireId);
                }
            });
            lingeringSmokeDataRef.current.forEach((_, campfireId) => {
                 if (!currentVisibleCampfireIds.has(campfireId)) {
                    lingeringSmokeDataRef.current.delete(campfireId);
                }
            });
            smokeBurstEmissionAccumulatorRef.current.forEach((_, campfireId) => { // Ensure burst accumulator is also cleaned up
                if (!currentVisibleCampfireIds.has(campfireId)) {
                    smokeBurstEmissionAccumulatorRef.current.delete(campfireId);
                }
            });

            if (newGeneratedParticles.length > 0) {
                particlesRef.current = currentParticles.concat(newGeneratedParticles);
            } else {
                particlesRef.current = currentParticles;
            }

            // Continue the animation loop
            animationFrameRef.current = requestAnimationFrame(updateParticles);
        };

        // Start the independent particle update loop
        lastUpdateTimeRef.current = performance.now();
        animationFrameRef.current = requestAnimationFrame(updateParticles);

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [visibleCampfiresMap]); // Only depend on visibleCampfiresMap, NOT deltaTime

    return particlesRef.current;
} 