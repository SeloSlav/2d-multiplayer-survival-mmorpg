import { useEffect, useRef, useCallback, useState } from 'react';
import { Campfire as SpacetimeDBCampfire } from '../generated';
import { CAMPFIRE_HEIGHT } from '../config/gameConfig';

// --- Particle System Types and Constants ---
export interface Particle {
  id: string;
  type: 'fire' | 'smoke';
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

// Adjusted for 2D Pixel Art style & less intensity
const PARTICLE_FIRE_LIFETIME_MIN = 100;
const PARTICLE_FIRE_LIFETIME_MAX = 300;
const PARTICLE_FIRE_SPEED_Y_MIN = -0.15;
const PARTICLE_FIRE_SPEED_Y_MAX = -0.45;
const PARTICLE_FIRE_SPEED_X_SPREAD = 0.2; 
const PARTICLE_FIRE_SIZE_MIN = 2; 
const PARTICLE_FIRE_SIZE_MAX = 3;
const PARTICLE_FIRE_COLORS = ["#FFD878", "#FFB04A", "#FF783C", "#FC9842"]; 
const FIRE_PARTICLES_PER_CAMPFIRE_FRAME = 0.6; 

const PARTICLE_SMOKE_LIFETIME_MIN = 1000;
const PARTICLE_SMOKE_LIFETIME_MAX = 2500;
const PARTICLE_SMOKE_SPEED_Y_MIN = -0.15; 
const PARTICLE_SMOKE_SPEED_Y_MAX = -0.4;
const PARTICLE_SMOKE_SPEED_X_SPREAD = 0.3;
const PARTICLE_SMOKE_SIZE_MIN = 3;
const PARTICLE_SMOKE_SIZE_MAX = 5; 
const PARTICLE_SMOKE_GROWTH_RATE = 0.02;
const SMOKE_PARTICLES_PER_CAMPFIRE_FRAME = 0.3; 
const SMOKE_INITIAL_ALPHA = 0.4;
const SMOKE_TARGET_ALPHA = 0.05; 
const SMOKE_LINGER_DURATION_MS = 2500; // How long smoke continues after fire is out

interface UseCampfireParticlesProps {
    visibleCampfiresMap: Map<string, SpacetimeDBCampfire>;
    deltaTime: number; // Delta time in milliseconds
}

export function useCampfireParticles({
    visibleCampfiresMap,
    deltaTime,
}: UseCampfireParticlesProps): Particle[] {
    const [particles, setParticles] = useState<Particle[]>([]);
    
    const fireEmissionAccumulatorRef = useRef<Map<string, number>>(new Map());
    const smokeEmissionAccumulatorRef = useRef<Map<string, number>>(new Map());
    const prevBurningStatesRef = useRef<Map<string, boolean>>(new Map());
    const lingeringSmokeDataRef = useRef<Map<string, { lingerUntil: number }>>(new Map());

    useEffect(() => {
        if (deltaTime <= 0) return; // Don't update if deltaTime is not positive

        const now = performance.now();
        setParticles(prevParticles => {
            const updatedAndActiveParticles = prevParticles.map(p => {
                const age = now - p.spawnTime;
                const lifetimeRemaining = p.initialLifetime - age;
                const normalizedDeltaTimeFactor = deltaTime / 16.667; 

                let newVx = p.vx;
                let newVy = p.vy;
                let newSize = p.size;
                let currentAlpha = p.alpha;

                if (p.type === 'smoke') {
                    newVy -= 0.003 * normalizedDeltaTimeFactor; 
                    newSize = Math.min(p.size + PARTICLE_SMOKE_GROWTH_RATE * normalizedDeltaTimeFactor, PARTICLE_SMOKE_SIZE_MAX);
                    const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
                    currentAlpha = SMOKE_TARGET_ALPHA + (SMOKE_INITIAL_ALPHA - SMOKE_TARGET_ALPHA) * lifeRatio;
                } else if (p.type === 'fire') {
                     const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
                     currentAlpha = lifeRatio; 
                }

                return {
                    ...p,
                    x: p.x + newVx * normalizedDeltaTimeFactor,
                    y: p.y + newVy * normalizedDeltaTimeFactor,
                    lifetime: lifetimeRemaining,
                    size: newSize,
                    alpha: Math.max(0, Math.min(1, currentAlpha)), 
                };
            }).filter(p => p.lifetime > 0 && p.alpha > 0.01); 

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

                    const emissionPointX = campfire.posX;
                    // Use user's preferred fire Y-offset from their local changes
                    const fireVisualCenterY = campfire.posY - CAMPFIRE_HEIGHT * 0.85; 
                    const smokeVisualCenterY = campfire.posY - CAMPFIRE_HEIGHT * 0.40; 

                    if (generateFireThisFrame) {
                        let fireAcc = fireEmissionAccumulatorRef.current.get(campfireId) || 0;
                        fireAcc += FIRE_PARTICLES_PER_CAMPFIRE_FRAME * (deltaTime / 16.667); 
                        while (fireAcc >= 1) {
                            fireAcc -= 1;
                            const lifetime = PARTICLE_FIRE_LIFETIME_MIN + Math.random() * (PARTICLE_FIRE_LIFETIME_MAX - PARTICLE_FIRE_LIFETIME_MIN);
                            newGeneratedParticles.push({
                                id: `fire_${now}_${Math.random()}`, type: 'fire',
                                x: emissionPointX + (Math.random() - 0.5) * 5, 
                                y: fireVisualCenterY + (Math.random() - 0.5) * 5, 
                                vx: (Math.random() - 0.5) * PARTICLE_FIRE_SPEED_X_SPREAD,
                                vy: PARTICLE_FIRE_SPEED_Y_MIN + Math.random() * (PARTICLE_FIRE_SPEED_Y_MAX - PARTICLE_FIRE_SPEED_Y_MIN),
                                spawnTime: now, initialLifetime: lifetime, lifetime,
                                size: Math.floor(PARTICLE_FIRE_SIZE_MIN + Math.random() * (PARTICLE_FIRE_SIZE_MAX - PARTICLE_FIRE_SIZE_MIN)) + 1,
                                color: PARTICLE_FIRE_COLORS[Math.floor(Math.random() * PARTICLE_FIRE_COLORS.length)],
                                alpha: 1.0, 
                            });
                        }
                        fireEmissionAccumulatorRef.current.set(campfireId, fireAcc);
                    } else {
                        fireEmissionAccumulatorRef.current.set(campfireId, 0);
                    }

                    if (generateSmokeThisFrame) {
                        let smokeAcc = smokeEmissionAccumulatorRef.current.get(campfireId) || 0;
                        smokeAcc += SMOKE_PARTICLES_PER_CAMPFIRE_FRAME * (deltaTime / 16.667); 
                        while (smokeAcc >= 1) {
                            smokeAcc -= 1;
                            const lifetime = PARTICLE_SMOKE_LIFETIME_MIN + Math.random() * (PARTICLE_SMOKE_LIFETIME_MAX - PARTICLE_SMOKE_LIFETIME_MIN);
                            newGeneratedParticles.push({
                                id: `smoke_${now}_${Math.random()}`, type: 'smoke',
                                x: emissionPointX + (Math.random() - 0.5) * 8, 
                                y: smokeVisualCenterY + (Math.random() - 0.5) * 8,
                                vx: (Math.random() - 0.5) * PARTICLE_SMOKE_SPEED_X_SPREAD,
                                vy: PARTICLE_SMOKE_SPEED_Y_MIN + Math.random() * (PARTICLE_SMOKE_SPEED_Y_MAX - PARTICLE_SMOKE_SPEED_Y_MIN),
                                spawnTime: now, initialLifetime: lifetime, lifetime,
                                size: Math.floor(PARTICLE_SMOKE_SIZE_MIN + Math.random() * (PARTICLE_SMOKE_SIZE_MAX - PARTICLE_SMOKE_SIZE_MIN)) + 1,
                                alpha: SMOKE_INITIAL_ALPHA,
                            });
                        }
                        smokeEmissionAccumulatorRef.current.set(campfireId, smokeAcc);
                    } else {
                        smokeEmissionAccumulatorRef.current.set(campfireId, 0);
                    }
                });
            }

            // Cleanup refs for campfires no longer in visibleCampfiresMap
            prevBurningStatesRef.current.forEach((_, campfireId) => {
                if (!currentVisibleCampfireIds.has(campfireId)) {
                    prevBurningStatesRef.current.delete(campfireId);
                    fireEmissionAccumulatorRef.current.delete(campfireId);
                    smokeEmissionAccumulatorRef.current.delete(campfireId);
                    lingeringSmokeDataRef.current.delete(campfireId);
                }
            });
            lingeringSmokeDataRef.current.forEach((_, campfireId) => {
                 if (!currentVisibleCampfireIds.has(campfireId)) {
                    lingeringSmokeDataRef.current.delete(campfireId);
                }
            });

            return [...updatedAndActiveParticles, ...newGeneratedParticles];
        });
    }, [visibleCampfiresMap, deltaTime]); // Effect depends on these props

    return particles;
} 