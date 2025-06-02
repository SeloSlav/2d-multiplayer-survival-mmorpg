import { useEffect, useRef, useMemo } from 'react';
import {
    Player as SpacetimeDBPlayer,
    ActiveEquipment as SpacetimeDBActiveEquipment,
    ItemDefinition as SpacetimeDBItemDefinition,
    Projectile as SpacetimeDBProjectile,
} from '../generated';
import { Particle } from './useCampfireParticles'; // Reuse Particle type
import { JUMP_DURATION_MS, JUMP_HEIGHT_PX } from '../config/gameConfig';
import { gameConfig } from '../config/gameConfig';

// --- Fire Arrow Particle Constants (more visible than before) ---
const FIRE_ARROW_PARTICLE_LIFETIME_MIN = 80;  // Longer lifetime
const FIRE_ARROW_PARTICLE_LIFETIME_MAX = 180; // Longer lifetime
const FIRE_ARROW_PARTICLE_SPEED_Y_MIN = -0.4; // More upward movement
const FIRE_ARROW_PARTICLE_SPEED_Y_MAX = -1.0; // More upward movement
const FIRE_ARROW_PARTICLE_SPEED_X_SPREAD = 0.5; // More spread for visibility
const FIRE_ARROW_PARTICLE_SIZE_MIN = 2; // Larger particles
const FIRE_ARROW_PARTICLE_SIZE_MAX = 4; // Larger particles
const FIRE_ARROW_PARTICLE_COLORS = ["#FFE878", "#FFC04A", "#FF983C", "#FFA842"]; // Brighter colors
const FIRE_ARROW_PARTICLES_PER_FRAME = 1.2; // More particles

// --- Projectile Fire Arrow Constants (for in-flight arrows) ---
const PROJECTILE_FIRE_ARROW_PARTICLES_PER_FRAME = 2.0; // More particles for in-flight arrows
const PROJECTILE_FIRE_ARROW_PARTICLE_LIFETIME_MIN = 120; // Longer trails
const PROJECTILE_FIRE_ARROW_PARTICLE_LIFETIME_MAX = 250; // Longer trails

// --- Physics Constants (matching server) ---
const GRAVITY = 600.0; // Must match server GRAVITY constant

// --- Smoke Particle Constants for Fire Arrow ---
const FIRE_ARROW_SMOKE_PARTICLES_PER_FIRE_PARTICLE = 0.5; // More smoke
const FIRE_ARROW_SMOKE_LIFETIME_MIN = 250; 
const FIRE_ARROW_SMOKE_LIFETIME_MAX = 500; // Longer smoke lifetime
const FIRE_ARROW_SMOKE_SPEED_Y_MIN = -0.15; // More upward movement
const FIRE_ARROW_SMOKE_SPEED_Y_MAX = -0.4; // More upward movement
const FIRE_ARROW_SMOKE_SPEED_X_SPREAD = 0.4; // More spread
const FIRE_ARROW_SMOKE_SIZE_MIN = 3; // Larger smoke
const FIRE_ARROW_SMOKE_SIZE_MAX = 5; // Larger smoke
const FIRE_ARROW_SMOKE_COLORS = ["#B0B0B0", "#C0C0C0", "#D0D0D0"]; // Lighter grays

// --- Wispy Smoke Behavior Constants ---
const FIRE_ARROW_SMOKE_GROWTH_RATE = 0.03; // Faster growth
const FIRE_ARROW_SMOKE_INITIAL_ALPHA = 0.6; // Higher initial alpha
const FIRE_ARROW_SMOKE_TARGET_ALPHA = 0.05;
const FIRE_ARROW_SMOKE_Y_ACCELERATION = -0.008; // More acceleration

interface UseFireArrowParticlesProps {
    players: Map<string, SpacetimeDBPlayer>;
    activeEquipments: Map<string, SpacetimeDBActiveEquipment>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    projectiles: Map<string, SpacetimeDBProjectile>; // NEW: Add projectiles
    deltaTime: number; // Delta time in milliseconds
}

export function useFireArrowParticles({
    players,
    activeEquipments,
    itemDefinitions,
    projectiles,
    deltaTime, // Keep parameter for compatibility but won't use it
}: UseFireArrowParticlesProps): Particle[] {
    const particlesRef = useRef<Particle[]>([]);
    const emissionAccumulatorRef = useRef<Map<string, number>>(new Map());
    const projectileEmissionAccumulatorRef = useRef<Map<string, number>>(new Map()); // NEW: For projectiles
    const lastUpdateTimeRef = useRef<number>(performance.now());
    const animationFrameRef = useRef<number>(0);

    // --- Create a derived state string that changes when any fire arrow's loaded status changes ---
    const fireArrowStatesKey = useMemo(() => {
        let key = "";
        players.forEach((player, playerId) => {
            const equipment = activeEquipments.get(playerId);
            if (equipment && equipment.equippedItemDefId && equipment.isReadyToFire && equipment.loadedAmmoDefId) {
                const weaponDef = itemDefinitions.get(equipment.equippedItemDefId.toString());
                const ammoDef = itemDefinitions.get(equipment.loadedAmmoDefId.toString());
                if (weaponDef && ammoDef && 
                    (weaponDef.name === "Hunting Bow" || weaponDef.name === "Crossbow") &&
                    ammoDef.name === "Fire Arrow") {
                    key += `${playerId}:${equipment.loadedAmmoDefId};`;
                }
            }
        });
        
        // NEW: Add projectile fire arrows to the state key
        projectiles.forEach((projectile, projectileId) => {
            const ammoDef = itemDefinitions.get(projectile.ammoDefId.toString());
            if (ammoDef && ammoDef.name === "Fire Arrow") {
                key += `proj:${projectileId};`;
            }
        });
        
        return key;
    }, [players, activeEquipments, itemDefinitions, projectiles]); // Added projectiles to dependencies
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
                    emissionAccumulatorRef.current.set(playerId, 0);
                    return;
                }

                const equipment = activeEquipments.get(playerId);
                if (!equipment || !equipment.equippedItemDefId || !equipment.isReadyToFire || !equipment.loadedAmmoDefId) {
                    emissionAccumulatorRef.current.set(playerId, 0);
                    return;
                }

                const weaponDef = itemDefinitions.get(equipment.equippedItemDefId.toString());
                const ammoDef = itemDefinitions.get(equipment.loadedAmmoDefId.toString());
                
                const isFireArrowLoaded = !!(weaponDef && ammoDef && 
                    (weaponDef.name === "Hunting Bow" || weaponDef.name === "Crossbow") &&
                    ammoDef.name === "Fire Arrow");

                if (isFireArrowLoaded) {
                    // Use actual deltaTime for frame-rate independent movement
                    const deltaTimeFactor = deltaTime / 16.667; // Normalize to 60fps
                    
                    let acc = emissionAccumulatorRef.current.get(playerId) || 0;
                    acc += FIRE_ARROW_PARTICLES_PER_FRAME * deltaTimeFactor;
                    
                    let currentJumpOffsetY = 0;
                    if (player.jumpStartTimeMs > 0) {
                        const elapsedJumpTime = now - Number(player.jumpStartTimeMs);
                        if (elapsedJumpTime >= 0 && elapsedJumpTime < JUMP_DURATION_MS) {
                            const t = elapsedJumpTime / JUMP_DURATION_MS;
                            currentJumpOffsetY = Math.sin(t * Math.PI) * JUMP_HEIGHT_PX;
                        }
                    }

                    // Calculate arrow tip position based on weapon type and player direction
                    const playerWorldX = player.positionX;
                    const playerWorldY = player.positionY - currentJumpOffsetY;

                    let arrowTipX = playerWorldX;
                    let arrowTipY = playerWorldY;

                    if (weaponDef.name === "Hunting Bow") {
                        // Calculate bow position and arrow tip offset
                        switch (player.direction) {
                            case 'up':
                                arrowTipX = playerWorldX + gameConfig.spriteWidth * 0.25 + 25; // Crossbow offset + bolt tip
                                arrowTipY = playerWorldY - gameConfig.spriteHeight * 0.05 - 25; // Bolt tip extends up
                                break;
                            case 'down':
                                arrowTipX = playerWorldX + gameConfig.spriteWidth * -0.25 - 25; // Crossbow offset + bolt tip
                                arrowTipY = playerWorldY + gameConfig.spriteHeight * 0.25 + 25; // Bolt tip extends down
                                break;
                            case 'left':
                                arrowTipX = playerWorldX - gameConfig.spriteWidth * 0.25 - 25; // Bolt tip extends left
                                arrowTipY = playerWorldY + 15;
                                break;
                            case 'right':
                                arrowTipX = playerWorldX - gameConfig.spriteWidth * -0.25 - 5; // Bolt tip extends right
                                arrowTipY = playerWorldY + 20.0;
                                break;
                        }
                    } else if (weaponDef.name === "Crossbow") {
                        // Calculate crossbow position and bolt tip offset
                        switch (player.direction) {
                            case 'up':
                                arrowTipX = playerWorldX + gameConfig.spriteWidth * 0.25 + 25; // Crossbow offset + bolt tip
                                arrowTipY = playerWorldY - gameConfig.spriteHeight * 0.05 - 25; // Bolt tip extends up
                                break;
                            case 'down':
                                arrowTipX = playerWorldX + gameConfig.spriteWidth * -0.25 - 25; // Crossbow offset + bolt tip
                                arrowTipY = playerWorldY + gameConfig.spriteHeight * 0.25 + 25; // Bolt tip extends down
                                break;
                            case 'left':
                                arrowTipX = playerWorldX - gameConfig.spriteWidth * 0.25 - 25; // Bolt tip extends left
                                arrowTipY = playerWorldY + 15;
                                break;
                            case 'right':
                                arrowTipX = playerWorldX - gameConfig.spriteWidth * -0.25 - 5; // Bolt tip extends right
                                arrowTipY = playerWorldY + 20.0;
                                break;
                        }
                    }

                    while (acc >= 1) {
                        acc -= 1;
                        const lifetime = FIRE_ARROW_PARTICLE_LIFETIME_MIN + Math.random() * (FIRE_ARROW_PARTICLE_LIFETIME_MAX - FIRE_ARROW_PARTICLE_LIFETIME_MIN);
                        newGeneratedParticlesThisFrame.push({
                            id: `fire_arrow_${playerId}_${now}_${Math.random()}`,
                            type: 'fire',
                            x: arrowTipX + (Math.random() - 0.5) * 2, // Small spread around arrow tip
                            y: arrowTipY + (Math.random() - 0.5) * 2,
                            vx: (Math.random() - 0.5) * FIRE_ARROW_PARTICLE_SPEED_X_SPREAD,
                            vy: FIRE_ARROW_PARTICLE_SPEED_Y_MIN + Math.random() * (FIRE_ARROW_PARTICLE_SPEED_Y_MAX - FIRE_ARROW_PARTICLE_SPEED_Y_MIN),
                            spawnTime: now,
                            initialLifetime: lifetime,
                            lifetime,
                            size: Math.floor(FIRE_ARROW_PARTICLE_SIZE_MIN + Math.random() * (FIRE_ARROW_PARTICLE_SIZE_MAX - FIRE_ARROW_PARTICLE_SIZE_MIN)) + 1,
                            color: FIRE_ARROW_PARTICLE_COLORS[Math.floor(Math.random() * FIRE_ARROW_PARTICLE_COLORS.length)],
                            alpha: 1.0,
                        });

                        // Add smoke particles based on fire particle emission
                        if (Math.random() < FIRE_ARROW_SMOKE_PARTICLES_PER_FIRE_PARTICLE) {
                            const smokeLifetime = FIRE_ARROW_SMOKE_LIFETIME_MIN + Math.random() * (FIRE_ARROW_SMOKE_LIFETIME_MAX - FIRE_ARROW_SMOKE_LIFETIME_MIN);
                            newGeneratedParticlesThisFrame.push({
                                id: `fire_arrow_smoke_${playerId}_${now}_${Math.random()}`,
                                type: 'smoke',
                                x: arrowTipX + (Math.random() - 0.5) * 3, // Slightly wider spread for smoke
                                y: arrowTipY - 2 + (Math.random() - 0.5) * 2, // Start smoke slightly above arrow tip
                                vx: (Math.random() - 0.5) * FIRE_ARROW_SMOKE_SPEED_X_SPREAD,
                                vy: FIRE_ARROW_SMOKE_SPEED_Y_MIN + Math.random() * (FIRE_ARROW_SMOKE_SPEED_Y_MAX - FIRE_ARROW_SMOKE_SPEED_Y_MIN),
                                spawnTime: now,
                                initialLifetime: smokeLifetime,
                                lifetime: smokeLifetime,
                                size: Math.floor(FIRE_ARROW_SMOKE_SIZE_MIN + Math.random() * (FIRE_ARROW_SMOKE_SIZE_MAX - FIRE_ARROW_SMOKE_SIZE_MIN)) + 1,
                                color: FIRE_ARROW_SMOKE_COLORS[Math.floor(Math.random() * FIRE_ARROW_SMOKE_COLORS.length)],
                                alpha: FIRE_ARROW_SMOKE_INITIAL_ALPHA,
                            });
                        }
                    }
                    emissionAccumulatorRef.current.set(playerId, acc);
                } else {
                    emissionAccumulatorRef.current.set(playerId, 0);
                }
            });

            // NEW: Generate particles for in-flight fire arrow projectiles
            projectiles.forEach((projectile, projectileId) => {
                const ammoDef = itemDefinitions.get(projectile.ammoDefId.toString());
                
                if (!ammoDef || ammoDef.name !== "Fire Arrow") {
                    projectileEmissionAccumulatorRef.current.set(projectileId, 0);
                    return;
                }

                console.log('[useFireArrowParticles] Found fire arrow projectile:', projectileId);

                // Calculate projectile's current position using server physics
                const startTimeMs = Number(projectile.startTime.microsSinceUnixEpoch / 1000n);
                const currentTime = Date.now(); // Use Date.now() for Unix timestamp comparison
                const elapsedTime = (currentTime - startTimeMs) / 1000; // Convert to seconds
                
                if (elapsedTime < 0) {
                    projectileEmissionAccumulatorRef.current.set(projectileId, 0);
                    return; // Projectile hasn't started yet
                }

                // Get weapon definition to determine gravity effect (matching server logic)
                const weaponDef = itemDefinitions.get(projectile.itemDefId.toString());
                let gravityMultiplier = 1.0; // Default for bows
                if (weaponDef && weaponDef.name === "Crossbow") {
                    gravityMultiplier = 0.1; // Crossbow projectiles have 10% gravity effect
                }

                // Check if this is a thrown item (ammo_def_id == item_def_id) - no gravity for thrown items
                const isThrownItem = projectile.ammoDefId === projectile.itemDefId;
                const finalGravityMultiplier = isThrownItem ? 0.0 : gravityMultiplier;

                // Calculate current position (matching server physics)
                const currentX = projectile.startPosX + projectile.velocityX * elapsedTime;
                const currentY = projectile.startPosY + projectile.velocityY * elapsedTime + 0.5 * GRAVITY * finalGravityMultiplier * Math.pow(elapsedTime, 2);

                // Use actual deltaTime for frame-rate independent movement
                const deltaTimeFactor = deltaTime / 16.667; // Normalize to 60fps
                
                let projAcc = projectileEmissionAccumulatorRef.current.get(projectileId) || 0;
                projAcc += PROJECTILE_FIRE_ARROW_PARTICLES_PER_FRAME * deltaTimeFactor;

                while (projAcc >= 1) {
                    projAcc -= 1;
                    console.log('[useFireArrowParticles] Generating projectile fire particle at:', currentX, currentY);
                    const lifetime = PROJECTILE_FIRE_ARROW_PARTICLE_LIFETIME_MIN + Math.random() * (PROJECTILE_FIRE_ARROW_PARTICLE_LIFETIME_MAX - PROJECTILE_FIRE_ARROW_PARTICLE_LIFETIME_MIN);
                    newGeneratedParticlesThisFrame.push({
                        id: `projectile_fire_arrow_${projectileId}_${currentTime}_${Math.random()}`,
                        type: 'fire',
                        x: currentX + (Math.random() - 0.5) * 3, // Small spread around projectile
                        y: currentY + (Math.random() - 0.5) * 3,
                        vx: (Math.random() - 0.5) * FIRE_ARROW_PARTICLE_SPEED_X_SPREAD,
                        vy: FIRE_ARROW_PARTICLE_SPEED_Y_MIN + Math.random() * (FIRE_ARROW_PARTICLE_SPEED_Y_MAX - FIRE_ARROW_PARTICLE_SPEED_Y_MIN),
                        spawnTime: now,
                        initialLifetime: lifetime,
                        lifetime,
                        size: Math.floor(FIRE_ARROW_PARTICLE_SIZE_MIN + Math.random() * (FIRE_ARROW_PARTICLE_SIZE_MAX - FIRE_ARROW_PARTICLE_SIZE_MIN)) + 1,
                        color: FIRE_ARROW_PARTICLE_COLORS[Math.floor(Math.random() * FIRE_ARROW_PARTICLE_COLORS.length)],
                        alpha: 1.0,
                    });

                    // Add smoke particles for projectile trail
                    if (Math.random() < FIRE_ARROW_SMOKE_PARTICLES_PER_FIRE_PARTICLE) {
                        const smokeLifetime = FIRE_ARROW_SMOKE_LIFETIME_MIN + Math.random() * (FIRE_ARROW_SMOKE_LIFETIME_MAX - FIRE_ARROW_SMOKE_LIFETIME_MIN);
                        newGeneratedParticlesThisFrame.push({
                            id: `projectile_fire_arrow_smoke_${projectileId}_${currentTime}_${Math.random()}`,
                            type: 'smoke',
                            x: currentX + (Math.random() - 0.5) * 4, // Slightly wider spread for smoke trail
                            y: currentY - 2 + (Math.random() - 0.5) * 3, // Start smoke slightly behind projectile
                            vx: (Math.random() - 0.5) * FIRE_ARROW_SMOKE_SPEED_X_SPREAD,
                            vy: FIRE_ARROW_SMOKE_SPEED_Y_MIN + Math.random() * (FIRE_ARROW_SMOKE_SPEED_Y_MAX - FIRE_ARROW_SMOKE_SPEED_Y_MIN),
                            spawnTime: now,
                            initialLifetime: smokeLifetime,
                            lifetime: smokeLifetime,
                            size: Math.floor(FIRE_ARROW_SMOKE_SIZE_MIN + Math.random() * (FIRE_ARROW_SMOKE_SIZE_MAX - FIRE_ARROW_SMOKE_SIZE_MIN)) + 1,
                            color: FIRE_ARROW_SMOKE_COLORS[Math.floor(Math.random() * FIRE_ARROW_SMOKE_COLORS.length)],
                            alpha: FIRE_ARROW_SMOKE_INITIAL_ALPHA,
                        });
                    }
                }
                projectileEmissionAccumulatorRef.current.set(projectileId, projAcc);
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
                    continue;
                }

                let newVx = p.vx;
                let newVy = p.vy;
                let newSize = p.size;
                let currentAlpha = p.alpha;

                if (p.type === 'smoke') {
                    newVy += FIRE_ARROW_SMOKE_Y_ACCELERATION * normalizedDeltaTimeFactor;
                    newSize = Math.min(p.size + FIRE_ARROW_SMOKE_GROWTH_RATE * normalizedDeltaTimeFactor, FIRE_ARROW_SMOKE_SIZE_MAX);
                    const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
                    currentAlpha = FIRE_ARROW_SMOKE_TARGET_ALPHA + (FIRE_ARROW_SMOKE_INITIAL_ALPHA - FIRE_ARROW_SMOKE_TARGET_ALPHA) * lifeRatio;
                } else if (p.type === 'fire') {
                    // Standard linear fade for fire
                    currentAlpha = Math.max(0, Math.min(1, lifetimeRemaining / p.initialLifetime));
                }

                p.x += newVx * normalizedDeltaTimeFactor;
                p.y += newVy * normalizedDeltaTimeFactor;
                p.lifetime = lifetimeRemaining;
                p.size = newSize;
                p.alpha = Math.max(0, Math.min(1, currentAlpha));

                if (p.alpha > 0.01) {
                    currentParticles[liveParticleCount++] = p;
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
    }, [players, activeEquipments, itemDefinitions, projectiles, fireArrowStatesKey]); // Added projectiles to dependencies

    return particlesRef.current;
} 