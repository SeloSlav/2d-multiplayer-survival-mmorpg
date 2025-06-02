import { useEffect, useRef, useState, useMemo } from 'react';
import {
    Player as SpacetimeDBPlayer,
    ActiveEquipment as SpacetimeDBActiveEquipment,
    ItemDefinition as SpacetimeDBItemDefinition,
} from '../generated';
import { Particle } from './useCampfireParticles'; // Reuse Particle type
import { JUMP_DURATION_MS, JUMP_HEIGHT_PX } from '../config/gameConfig';
import { gameConfig } from '../config/gameConfig'; // <<< ADDED for spriteWidth/Height

// --- Swing Constants (from equippedItemRenderingUtils.ts) ---
const SWING_DURATION_MS = 150;
const SWING_ANGLE_MAX_RAD = Math.PI / 2.5;

// --- Particle Constants for Torch (can be adjusted) ---
const TORCH_PARTICLE_LIFETIME_MIN = 80;  // Shorter for faster turnover
const TORCH_PARTICLE_LIFETIME_MAX = 200; // Shorter for faster turnover
const TORCH_PARTICLE_SPEED_Y_MIN = -0.5; // Much faster upward movement
const TORCH_PARTICLE_SPEED_Y_MAX = -1.2; // Much faster upward movement
const TORCH_PARTICLE_SPEED_X_SPREAD = 0.6; // More spread for liveliness
const TORCH_PARTICLE_SIZE_MIN = 2; 
const TORCH_PARTICLE_SIZE_MAX = 4; 
const TORCH_PARTICLE_COLORS = ["#FFD878", "#FFB04A", "#FF783C", "#FC9842"]; // Same colors as campfire
const TORCH_FIRE_PARTICLES_PER_FRAME = 1.2; // Reverted back to original value

// --- Smoke Particle Constants for Torch ---
const TORCH_SMOKE_PARTICLES_PER_FIRE_PARTICLE = 0.4; // More smoke
const TORCH_SMOKE_LIFETIME_MIN = 300; 
const TORCH_SMOKE_LIFETIME_MAX = 600; // Shorter for faster turnover
const TORCH_SMOKE_SPEED_Y_MIN = -0.2; // Faster smoke movement
const TORCH_SMOKE_SPEED_Y_MAX = -0.5; // Faster smoke movement
const TORCH_SMOKE_SPEED_X_SPREAD = 0.4; // More spread
const TORCH_SMOKE_SIZE_MIN = 4; 
const TORCH_SMOKE_SIZE_MAX = 7;
const TORCH_SMOKE_COLORS = ["#A0A0A0", "#B0B0B0", "#C0C0C0"]; // Slightly darker grays

// --- Wispy Smoke Behavior Constants ---
const TORCH_SMOKE_GROWTH_RATE = 0.025; // Faster growth
const TORCH_SMOKE_INITIAL_ALPHA = 0.5; // Higher initial alpha
const TORCH_SMOKE_TARGET_ALPHA = 0.05;
const TORCH_SMOKE_Y_ACCELERATION = -0.008; // More acceleration

// Original base offsets (now effectively 0,0 as per user changes)
const BASE_TORCH_FLAME_OFFSET_X = 0;
const BASE_TORCH_FLAME_OFFSET_Y = 0;

// Refined Directional Offsets based on user feedback
const OFFSET_X_LEFT = -25;
const OFFSET_Y_LEFT = -10;

const OFFSET_X_RIGHT = 15;  // Was 20, user wants it "translated left a bit"
const OFFSET_Y_RIGHT = -10;

const OFFSET_X_UP = 35;     // Making X for Up slightly different from Right, still offset right
const OFFSET_Y_UP = -15;    // User wants it "up just a little bit"

const OFFSET_X_DOWN = -30;  // From user's DIRECTIONAL_ADJUST_X_DOWN
const OFFSET_Y_DOWN = -10;    // User wants it "up just a little bit" from its previous Y of +10

interface UseTorchParticlesProps {
    players: Map<string, SpacetimeDBPlayer>;
    activeEquipments: Map<string, SpacetimeDBActiveEquipment>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    deltaTime: number; // Delta time in milliseconds
}

export function useTorchParticles({
    players,
    activeEquipments,
    itemDefinitions,
    deltaTime, // Keep parameter for compatibility but won't use it
}: UseTorchParticlesProps): Particle[] {
    const particlesRef = useRef<Particle[]>([]);
    const emissionAccumulatorRef = useRef<Map<string, number>>(new Map());
    const lastUpdateTimeRef = useRef<number>(performance.now());
    const animationFrameRef = useRef<number>(0);

    // --- Create a derived state string that changes when any torch's lit status changes ---
    const torchLitStatesKey = useMemo(() => {
        let key = "";
        players.forEach((player, playerId) => {
            const equipment = activeEquipments.get(playerId);
            if (equipment && equipment.equippedItemDefId) {
                const itemDef = itemDefinitions.get(equipment.equippedItemDefId.toString());
                if (itemDef && itemDef.name === "Torch") {
                    key += `${playerId}:${player.isTorchLit};`;
                }
            }
        });
        return key;
    }, [players, activeEquipments, itemDefinitions]);
    // --- End derived state ---

    useEffect(() => {
        const updateParticles = () => {
            const now = performance.now();
            const deltaTime = now - lastUpdateTimeRef.current;
            lastUpdateTimeRef.current = now;
            
            if (deltaTime <= 0) {
                animationFrameRef.current = requestAnimationFrame(updateParticles);
                return;
            }

            const newGeneratedParticlesThisFrame: Particle[] = [];

            players.forEach((player, playerId) => {
                if (!player || player.isDead) {
                    emissionAccumulatorRef.current.set(playerId, 0); // Reset accumulator for dead/invalid players
                    return;
                }

                const equipment = activeEquipments.get(playerId);
                const itemDefId = equipment?.equippedItemDefId;
                const itemDef = itemDefId ? itemDefinitions.get(itemDefId.toString()) : null;
                
                const isTorchCurrentlyActiveAndLit = !!(itemDef && itemDef.name === "Torch" && player.isTorchLit);

                if (isTorchCurrentlyActiveAndLit) {
                    // Use actual deltaTime for frame-rate independent movement
                    const deltaTimeFactor = deltaTime / 16.667; // Normalize to 60fps
                    
                    let acc = emissionAccumulatorRef.current.get(playerId) || 0;
                    acc += TORCH_FIRE_PARTICLES_PER_FRAME * deltaTimeFactor;
                    
                    let currentJumpOffsetY = 0;
                    if (player.jumpStartTimeMs > 0) {
                        const elapsedJumpTime = now - Number(player.jumpStartTimeMs);
                        if (elapsedJumpTime >= 0 && elapsedJumpTime < JUMP_DURATION_MS) {
                            const t = elapsedJumpTime / JUMP_DURATION_MS;
                            currentJumpOffsetY = Math.sin(t * Math.PI) * JUMP_HEIGHT_PX;
                        }
                    }

                    // --- Base non-swinging flame offset from player center ---
                    let baseFlameOffsetX = BASE_TORCH_FLAME_OFFSET_X;
                    let baseFlameOffsetY = BASE_TORCH_FLAME_OFFSET_Y;

                    switch (player.direction) {
                        case "left": 
                            baseFlameOffsetX = OFFSET_X_LEFT;
                            baseFlameOffsetY = OFFSET_Y_LEFT;
                            break;
                        case "right": 
                            baseFlameOffsetX = OFFSET_X_RIGHT;
                            baseFlameOffsetY = OFFSET_Y_RIGHT;
                            break;
                        case "up": 
                            baseFlameOffsetX = OFFSET_X_UP;
                            baseFlameOffsetY = OFFSET_Y_UP;
                            break;
                        case "down": 
                            baseFlameOffsetX = OFFSET_X_DOWN;
                            baseFlameOffsetY = OFFSET_Y_DOWN;
                            break;
                        default:
                            break;
                    }

                    // --- Calculate Hand Pivot (relative to player center) ---
                    const handOffsetXConfig = gameConfig.spriteWidth * 0.2;
                    const handOffsetYConfig = gameConfig.spriteHeight * 0.05;
                    let handPivotRelativeX = 0;
                    let handPivotRelativeY = 0;

                    switch (player.direction) {
                        case 'up': 
                            handPivotRelativeX = -handOffsetXConfig * -1.5;
                            handPivotRelativeY = -handOffsetYConfig * 2.0; 
                            break;
                        case 'down': 
                            handPivotRelativeX = handOffsetXConfig * -2.5;
                            handPivotRelativeY = handOffsetYConfig * 1.5; 
                            break;
                        case 'left': 
                            handPivotRelativeX = -handOffsetXConfig * 2.0; 
                            handPivotRelativeY = handOffsetYConfig;
                            break;
                        case 'right': 
                            handPivotRelativeX = handOffsetXConfig * 0.5; 
                            handPivotRelativeY = handOffsetYConfig;
                            break;
                    }

                    // --- Calculate Swing Rotation ---
                    let swingRotationRad = 0;
                    const swingStartTime = Number(equipment?.swingStartTimeMs || 0);
                    if (swingStartTime > 0) {
                        const elapsedSwingTime = now - swingStartTime;
                        if (elapsedSwingTime >= 0 && elapsedSwingTime < SWING_DURATION_MS) {
                            const swingProgress = elapsedSwingTime / SWING_DURATION_MS;
                            const baseAngle = Math.sin(swingProgress * Math.PI) * SWING_ANGLE_MAX_RAD;
                            if (player.direction === 'right' || player.direction === 'up') {
                                swingRotationRad = baseAngle;
                            } else {
                                swingRotationRad = -baseAngle;
                            }
                        }
                    }

                    // --- Determine Final Emission Point ---
                    const playerWorldX = player.positionX;
                    const playerWorldY = player.positionY - currentJumpOffsetY;

                    const worldHandPivotX = playerWorldX + handPivotRelativeX;
                    const worldHandPivotY = playerWorldY + handPivotRelativeY;

                    const initialFlameWorldX = playerWorldX + baseFlameOffsetX;
                    const initialFlameWorldY = playerWorldY + baseFlameOffsetY;

                    const vecToFlameX = initialFlameWorldX - worldHandPivotX;
                    const vecToFlameY = initialFlameWorldY - worldHandPivotY;

                    const cosAngle = Math.cos(swingRotationRad);
                    const sinAngle = Math.sin(swingRotationRad);

                    const rotatedVecToFlameX = vecToFlameX * cosAngle - vecToFlameY * sinAngle;
                    const rotatedVecToFlameY = vecToFlameX * sinAngle + vecToFlameY * cosAngle;

                    const finalEmissionPointX = worldHandPivotX + rotatedVecToFlameX;
                    const finalEmissionPointY = worldHandPivotY + rotatedVecToFlameY;

                    const emissionPointX = finalEmissionPointX;
                    const emissionPointY = finalEmissionPointY;

                    while (acc >= 1) {
                        acc -= 1;
                        const lifetime = TORCH_PARTICLE_LIFETIME_MIN + Math.random() * (TORCH_PARTICLE_LIFETIME_MAX - TORCH_PARTICLE_LIFETIME_MIN);
                        newGeneratedParticlesThisFrame.push({
                            id: `torch_fire_${playerId}_${now}_${Math.random()}`,
                            type: 'fire',
                            x: emissionPointX + (Math.random() - 0.5) * 3, 
                            y: emissionPointY + (Math.random() - 0.5) * 3,
                            vx: (Math.random() - 0.5) * TORCH_PARTICLE_SPEED_X_SPREAD,
                            vy: TORCH_PARTICLE_SPEED_Y_MIN + Math.random() * (TORCH_PARTICLE_SPEED_Y_MAX - TORCH_PARTICLE_SPEED_Y_MIN),
                            spawnTime: now,
                            initialLifetime: lifetime,
                            lifetime,
                            size: Math.floor(TORCH_PARTICLE_SIZE_MIN + Math.random() * (TORCH_PARTICLE_SIZE_MAX - TORCH_PARTICLE_SIZE_MIN)) + 1,
                            color: TORCH_PARTICLE_COLORS[Math.floor(Math.random() * TORCH_PARTICLE_COLORS.length)],
                            alpha: 1.0,
                        });

                        // Add smoke particles based on fire particle emission
                        if (Math.random() < TORCH_SMOKE_PARTICLES_PER_FIRE_PARTICLE) {
                            const smokeLifetime = TORCH_SMOKE_LIFETIME_MIN + Math.random() * (TORCH_SMOKE_LIFETIME_MAX - TORCH_SMOKE_LIFETIME_MIN);
                            newGeneratedParticlesThisFrame.push({
                                id: `torch_smoke_${playerId}_${now}_${Math.random()}`,
                                type: 'smoke', // Differentiate particle type
                                x: emissionPointX + (Math.random() - 0.5) * 4, // Slightly wider spread for smoke base
                                y: emissionPointY - 3 + (Math.random() - 0.5) * 3, // Start smoke slightly above fire
                                vx: (Math.random() - 0.5) * TORCH_SMOKE_SPEED_X_SPREAD,
                                vy: TORCH_SMOKE_SPEED_Y_MIN + Math.random() * (TORCH_SMOKE_SPEED_Y_MAX - TORCH_SMOKE_SPEED_Y_MIN),
                                spawnTime: now,
                                initialLifetime: smokeLifetime,
                                lifetime: smokeLifetime,
                                size: Math.floor(TORCH_SMOKE_SIZE_MIN + Math.random() * (TORCH_SMOKE_SIZE_MAX - TORCH_SMOKE_SIZE_MIN)) + 1,
                                color: TORCH_SMOKE_COLORS[Math.floor(Math.random() * TORCH_SMOKE_COLORS.length)],
                                alpha: TORCH_SMOKE_INITIAL_ALPHA, // Use initial alpha for smoke
                            });
                        }
                    }
                    emissionAccumulatorRef.current.set(playerId, acc);
                } else {
                    emissionAccumulatorRef.current.set(playerId, 0); // Reset accumulator if torch is not active for this player
                }
            });

            // Update and filter all existing particles, then add newly generated ones
            const currentParticles = particlesRef.current;
            let liveParticleCount = 0;

            // Use actual deltaTime for frame-rate independent movement
            const normalizedDeltaTimeFactor = deltaTime / 16.667;

            for (let i = 0; i < currentParticles.length; i++) {
                const p = currentParticles[i];
                const age = now - p.spawnTime;
                const lifetimeRemaining = p.initialLifetime - age;

                if (lifetimeRemaining <= 0) {
                    // Mark for removal (or skip)
                    continue;
                }

                let newVx = p.vx;
                let newVy = p.vy;
                let newSize = p.size;
                let currentAlpha = p.alpha;

                if (p.type === 'smoke') {
                    newVy += TORCH_SMOKE_Y_ACCELERATION * normalizedDeltaTimeFactor;
                    newSize = Math.min(p.size + TORCH_SMOKE_GROWTH_RATE * normalizedDeltaTimeFactor, TORCH_SMOKE_SIZE_MAX);
                    const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
                    currentAlpha = TORCH_SMOKE_TARGET_ALPHA + (TORCH_SMOKE_INITIAL_ALPHA - TORCH_SMOKE_TARGET_ALPHA) * lifeRatio;
                } else if (p.type === 'fire') {
                    // Standard linear fade for fire for now
                    currentAlpha = Math.max(0, Math.min(1, lifetimeRemaining / p.initialLifetime));
                }

                p.x += newVx * normalizedDeltaTimeFactor;
                p.y += newVy * normalizedDeltaTimeFactor;
                p.lifetime = lifetimeRemaining;
                p.size = newSize;
                p.alpha = Math.max(0, Math.min(1, currentAlpha));

                if (p.alpha > 0.01) {
                    currentParticles[liveParticleCount++] = p; // Keep live particle
                }
            }
            // Trim the array to only live particles
            currentParticles.length = liveParticleCount;
            
            // Add newly generated particles
            if (newGeneratedParticlesThisFrame.length > 0) {
                particlesRef.current = currentParticles.concat(newGeneratedParticlesThisFrame);
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
    }, [players, activeEquipments, itemDefinitions, torchLitStatesKey]); // Removed deltaTime from dependencies

    return particlesRef.current;
} 