import { useEffect, useRef } from 'react';
import {
    HarvestableResource as SpacetimeDBHarvestableResource,
} from '../generated';
import { Particle } from './useCampfireParticles'; // Reuse Particle type

// --- Sparkle Particle Constants ---
const SPARKLE_PARTICLE_LIFETIME_MIN = 800;  // Longer lifetime for graceful rise
const SPARKLE_PARTICLE_LIFETIME_MAX = 1200; // Longer lifetime for graceful rise
const SPARKLE_PARTICLE_SPEED_Y_MIN = -0.3;  // Gentle upward movement
const SPARKLE_PARTICLE_SPEED_Y_MAX = -0.6;  // Gentle upward movement
const SPARKLE_PARTICLE_SPEED_X_SPREAD = 0.2; // Minimal horizontal drift
const SPARKLE_PARTICLE_SIZE_MIN = 1; 
const SPARKLE_PARTICLE_SIZE_MAX = 3; 
const SPARKLE_PARTICLE_COLORS = ["#FFD700", "#FFEB3B", "#FFF59D", "#FFFFFF", "#E1F5FE"]; // Gold, yellow, light yellow, white, light cyan
const SPARKLES_PER_RESOURCE_FRAME = 0.15; // Lower emission rate for subtle effect

// Import resource configuration system to get heights dynamically
import { getResourceConfig } from '../utils/renderers/resourceConfigurations';
import { getResourceType } from '../types/resourceTypes';

interface UseResourceSparkleParticlesProps {
    harvestableResources: Map<string, SpacetimeDBHarvestableResource>;
}

export function useResourceSparkleParticles({
    harvestableResources,
}: UseResourceSparkleParticlesProps): Particle[] {
    const particlesRef = useRef<Particle[]>([]);
    const emissionAccumulatorRef = useRef<Map<string, number>>(new Map());
    const lastUpdateTimeRef = useRef<number>(performance.now());
    const animationFrameRef = useRef<number>(0);

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

            // Update existing particles
            for (let i = 0; i < currentParticles.length; i++) {
                const p = currentParticles[i];
                const age = now - p.spawnTime;
                const lifetimeRemaining = p.initialLifetime - age;

                if (lifetimeRemaining <= 0) {
                    continue;
                }

                // Sparkle particles fade out as they rise and add slight shimmer
                const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
                const shimmer = 0.8 + 0.2 * Math.sin((now - p.spawnTime) * 0.01); // Gentle shimmer effect
                const currentAlpha = lifeRatio * shimmer;

                // Gentle upward movement with slight deceleration
                const ageRatio = (p.initialLifetime - lifetimeRemaining) / p.initialLifetime;
                const decelerationFactor = 1.0 - (ageRatio * 0.3); // Slow down over time

                p.x += p.vx * deltaTimeFactor * decelerationFactor;
                p.y += p.vy * deltaTimeFactor * decelerationFactor;
                p.lifetime = lifetimeRemaining;
                p.alpha = Math.max(0, Math.min(1, currentAlpha));

                if (p.alpha > 0.01) {
                    currentParticles[liveParticleCount++] = p;
                }
            }
            currentParticles.length = liveParticleCount;

            const newGeneratedParticles: Particle[] = [];

            // Generate sparkles for unified harvestable resources
            if (harvestableResources) {
                harvestableResources.forEach((resource, resourceId) => {
                    // Only generate sparkles for harvestable resources (not respawning)
                    if (resource.respawnAt !== null && resource.respawnAt !== undefined) {
                        // Reset accumulator for respawning resources
                        emissionAccumulatorRef.current.set(`harvestable_${resourceId}`, 0);
                        return;
                    }

                    // Get resource configuration dynamically
                    try {
                        const resourceType = getResourceType(resource);
                        const config = getResourceConfig(resourceType);
                        
                        let acc = emissionAccumulatorRef.current.get(`harvestable_${resourceId}`) || 0;
                        acc += SPARKLES_PER_RESOURCE_FRAME * deltaTimeFactor;

                        while (acc >= 1) {
                            acc -= 1;
                            const lifetime = SPARKLE_PARTICLE_LIFETIME_MIN + Math.random() * (SPARKLE_PARTICLE_LIFETIME_MAX - SPARKLE_PARTICLE_LIFETIME_MIN);
                            
                            // Use targetWidth as a proxy for resource height (can be refined later)
                            const resourceHeight = config.targetWidth;
                            const visualAdjustment = resourceHeight / 2;
                            
                            // Start sparkles from the base/bottom area of the resource
                            const sparkleStartX = resource.posX + (Math.random() - 0.5) * (resourceHeight * 0.6); // Width spread
                            const sparkleStartY = resource.posY - (visualAdjustment * 0.3) + (Math.random() - 0.5) * 8; // Near bottom with slight variation

                        newGeneratedParticles.push({
                            id: `sparkle_harvestable_${resourceId}_${now}_${Math.random()}`,
                            type: 'fire', // Reuse fire type for rendering
                            x: sparkleStartX,
                            y: sparkleStartY,
                            vx: (Math.random() - 0.5) * SPARKLE_PARTICLE_SPEED_X_SPREAD,
                            vy: SPARKLE_PARTICLE_SPEED_Y_MIN + Math.random() * (SPARKLE_PARTICLE_SPEED_Y_MAX - SPARKLE_PARTICLE_SPEED_Y_MIN),
                            spawnTime: now,
                            initialLifetime: lifetime,
                            lifetime,
                            size: Math.floor(SPARKLE_PARTICLE_SIZE_MIN + Math.random() * (SPARKLE_PARTICLE_SIZE_MAX - SPARKLE_PARTICLE_SIZE_MIN)) + 1,
                            color: SPARKLE_PARTICLE_COLORS[Math.floor(Math.random() * SPARKLE_PARTICLE_COLORS.length)],
                            alpha: 1.0,
                        });
                        }
                        emissionAccumulatorRef.current.set(`harvestable_${resourceId}`, acc);
                    } catch (error) {
                        // Skip resources with unknown types
                        return;
                    }
                });
            }

            // Add newly generated particles
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
    }, [harvestableResources]);

    return particlesRef.current;
} 