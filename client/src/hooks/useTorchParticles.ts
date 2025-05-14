import { useEffect, useRef, useState } from 'react';
import {
    Player as SpacetimeDBPlayer,
    ActiveEquipment as SpacetimeDBActiveEquipment,
    ItemDefinition as SpacetimeDBItemDefinition,
} from '../generated';
import { Particle } from './useCampfireParticles'; // Reuse Particle type
import { JUMP_DURATION_MS, JUMP_HEIGHT_PX } from '../config/gameConfig';

// --- Particle Constants for Torch (can be adjusted) ---
const TORCH_PARTICLE_LIFETIME_MIN = 100;  // Shorter lifetime for smaller flame, increased from 80
const TORCH_PARTICLE_LIFETIME_MAX = 250;
const TORCH_PARTICLE_SPEED_Y_MIN = -0.1;
const TORCH_PARTICLE_SPEED_Y_MAX = -0.3;
const TORCH_PARTICLE_SPEED_X_SPREAD = 0.15;
const TORCH_PARTICLE_SIZE_MIN = 2; // Increased from 1
const TORCH_PARTICLE_SIZE_MAX = 4; // Increased from 2
const TORCH_PARTICLE_COLORS = ["#FFD878", "#FFB04A", "#FF783C", "#FC9842"]; // Same colors as campfire
const TORCH_FIRE_PARTICLES_PER_FRAME = 0.7; // Increased from 0.4

// Original base offsets (now effectively 0,0 as per user changes)
const BASE_TORCH_FLAME_OFFSET_X = 0;
const BASE_TORCH_FLAME_OFFSET_Y = 0;

// Refined Directional Offsets based on user feedback
const OFFSET_X_LEFT = -20;
const OFFSET_Y_LEFT = -5;

const OFFSET_X_RIGHT = 10;  // Was 20, user wants it "translated left a bit"
const OFFSET_Y_RIGHT = -5;

const OFFSET_X_UP = 15;     // Making X for Up slightly different from Right, still offset right
const OFFSET_Y_UP = -15;    // User wants it "up just a little bit"

const OFFSET_X_DOWN = -25;  // From user's DIRECTIONAL_ADJUST_X_DOWN
const OFFSET_Y_DOWN = 10;    // User wants it "up just a little bit" from its previous Y of +10

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
    deltaTime,
}: UseTorchParticlesProps): Particle[] {
    const [particles, setParticles] = useState<Particle[]>([]);
    const emissionAccumulatorRef = useRef<Map<string, number>>(new Map());

    useEffect(() => {
        if (deltaTime <= 0) {
            // If no time passed, update existing particles but don't emit new ones (simplified from original)
            if (particles.length > 0) {
                 const now = Date.now();
                 setParticles(prevParticles => prevParticles.map(p => {
                    const age = now - p.spawnTime;
                    const lifetimeRemaining = p.initialLifetime - age;
                    return {
                        ...p,
                        x: p.x + p.vx * (deltaTime / 16.667), // Still use deltaTime for movement if it was > 0 before this check
                        y: p.y + p.vy * (deltaTime / 16.667),
                        lifetime: lifetimeRemaining,
                        alpha: Math.max(0, Math.min(1, lifetimeRemaining / p.initialLifetime)),
                    };
                }).filter(p => p.lifetime > 0 && p.alpha > 0.01));
            }
            return;
        }

        const now = Date.now();
        const newGeneratedParticlesThisFrame: Particle[] = [];

        players.forEach((player, playerId) => {
            if (!player || player.isDead) {
                emissionAccumulatorRef.current.set(playerId, 0); // Reset accumulator for dead/invalid players
                return;
            }

            const equipment = activeEquipments.get(playerId);
            const itemDefId = equipment?.equippedItemDefId;
            const itemDef = itemDefId ? itemDefinitions.get(itemDefId.toString()) : null;
            const isTorchCurrentlyActive = !!(itemDef && itemDef.name === "Torch");

            if (isTorchCurrentlyActive) {
                let acc = emissionAccumulatorRef.current.get(playerId) || 0;
                acc += TORCH_FIRE_PARTICLES_PER_FRAME * (deltaTime / 16.667);
                
                let dynamicOffsetX = BASE_TORCH_FLAME_OFFSET_X;
                let dynamicOffsetY = BASE_TORCH_FLAME_OFFSET_Y;

                // --- Calculate Jump Offset for THIS player ---
                let currentJumpOffsetY = 0;
                if (player.jumpStartTimeMs > 0) {
                    const elapsedJumpTime = now - Number(player.jumpStartTimeMs);
                    if (elapsedJumpTime >= 0 && elapsedJumpTime < JUMP_DURATION_MS) {
                        const t = elapsedJumpTime / JUMP_DURATION_MS;
                        currentJumpOffsetY = Math.sin(t * Math.PI) * JUMP_HEIGHT_PX;
                    }
                }
                // --- End Jump Offset Calculation ---

                switch (player.direction) {
                    case "left": 
                        dynamicOffsetX = OFFSET_X_LEFT;
                        dynamicOffsetY = OFFSET_Y_LEFT;
                        break;
                    case "right": 
                        dynamicOffsetX = OFFSET_X_RIGHT;
                        dynamicOffsetY = OFFSET_Y_RIGHT;
                        break;
                    case "up": 
                        dynamicOffsetX = OFFSET_X_UP;
                        dynamicOffsetY = OFFSET_Y_UP;
                        break;
                    case "down": 
                        dynamicOffsetX = OFFSET_X_DOWN;
                        dynamicOffsetY = OFFSET_Y_DOWN;
                        break;
                    default:
                        break;
                }

                let finalEmissionPointY = player.positionY + dynamicOffsetY;
                // Apply jump offset only for the local player
                finalEmissionPointY -= currentJumpOffsetY;

                const emissionPointX = player.positionX + dynamicOffsetX;
                const emissionPointY = finalEmissionPointY; // Use the potentially adjusted Y

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
                }
                emissionAccumulatorRef.current.set(playerId, acc);
            } else {
                emissionAccumulatorRef.current.set(playerId, 0); // Reset accumulator if torch is not active for this player
            }
        });

        // Update and filter all existing particles, then add newly generated ones
        setParticles(prevParticles => {
            const updatedAndActiveParticles = prevParticles.map(p => {
                const age = now - p.spawnTime;
                const lifetimeRemaining = p.initialLifetime - age;
                const normalizedDeltaTimeFactor = deltaTime / 16.667; // deltaTime is guaranteed > 0 here

                return {
                    ...p,
                    x: p.x + p.vx * normalizedDeltaTimeFactor,
                    y: p.y + p.vy * normalizedDeltaTimeFactor,
                    lifetime: lifetimeRemaining,
                    alpha: Math.max(0, Math.min(1, lifetimeRemaining / p.initialLifetime)),
                };
            }).filter(p => p.lifetime > 0 && p.alpha > 0.01);
            
            return [...updatedAndActiveParticles, ...newGeneratedParticlesThisFrame];
        });

    }, [players, activeEquipments, itemDefinitions, deltaTime]);

    return particles;
} 