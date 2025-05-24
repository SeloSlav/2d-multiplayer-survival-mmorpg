import { imageManager } from '../utils/renderers/imageManager';
import { Grass, DbConnection } from '../generated'; // Corrected path
import cutGrassTextureUrl from '../assets/doodads/grass_cut.png'; // Corrected relative path

const PARTICLE_LIFETIME_MS = 500; // 0.5 seconds
const NUM_PARTICLES_PER_GRASS = 4;
const BASE_OFFSET_DISTANCE = 15; // Base distance particles fly out diagonally
const MAX_INITIAL_SPEED = 30; // Max initial speed in pixels per second
const MAX_ROTATION_SPEED_DEG = 90; // Max rotation speed in degrees per second
const FADE_OUT_DELAY_FACTOR = 0.0; // Start fading immediately
const MAX_PARTICLE_DIMENSION_PX = 48; // New constant for max particle size

interface CutGrassParticle {
    id: string;
    texture: HTMLImageElement | null;
    startX: number;
    startY: number;
    offsetX: number; // Initial diagonal offset X
    offsetY: number; // Initial diagonal offset Y
    velocityX: number;
    velocityY: number;
    rotation: number; // Initial rotation in radians
    rotationSpeed: number; // Radians per second
    opacity: number;
    scale: number;
    startTime: number;
    spawnTime: number; // To handle delayed fade-in if needed, currently not used but good to have
}

const activeParticles: CutGrassParticle[] = [];

// Preload the particle texture
imageManager.preloadImage(cutGrassTextureUrl);

let dbConn: DbConnection | null = null;

// Function to be called when a grass entity is deleted
function handleGrassDestroyed(context: any, grass: Grass) {
    // console.log(`Grass ${grass.id} destroyed at ${grass.posX}, ${grass.posY}. Spawning particles.`);
    spawnCutGrassParticles(grass.posX, grass.posY, grass.id);
}


export function initCutGrassEffectSystem(connection: DbConnection) {
    dbConn = connection;
    // Subscribe to grass deletion events
    // Note: Ensure the Grass table and its fields (id, pos_x, pos_y) are actually published
    // and subscribed to by the client for this to work.
    if (dbConn.db && dbConn.db.grass) {
        dbConn.db.grass.onDelete(handleGrassDestroyed);
        // console.log("[CutGrassEffect] Subscribed to grass.onDelete");
    } else {
        console.warn("[CutGrassEffect] Grass table not available on DB connection at init time. Retrying subscription shortly...");
        // Retry subscription shortly, in case db is not fully initialized yet
        setTimeout(() => {
            if (dbConn && dbConn.db && dbConn.db.grass) {
                dbConn.db.grass.onDelete(handleGrassDestroyed);
                // console.log("[CutGrassEffect] Successfully subscribed to grass.onDelete after retry.");
            } else {
                console.error("[CutGrassEffect] Failed to subscribe to grass.onDelete even after retry. Cut grass effect will not work.");
            }
        }, 2000);
    }
}

export function spawnCutGrassParticles(centerX: number, centerY: number, grassId: number | bigint) {
    const texture = imageManager.getImage(cutGrassTextureUrl);
    if (!texture) {
        console.warn('[CutGrassEffect] Cut grass texture not loaded yet.');
        return;
    }

    const now = Date.now();

    for (let i = 0; i < NUM_PARTICLES_PER_GRASS; i++) {
        const angle = (Math.PI / 4) + (i * Math.PI / 2); // 45, 135, 225, 315 degrees

        const particle: CutGrassParticle = {
            id: `cut_grass_${grassId}_${i}_${now}`,
            texture,
            startX: centerX,
            startY: centerY,
            offsetX: Math.cos(angle) * BASE_OFFSET_DISTANCE * (0.8 + Math.random() * 0.4),
            offsetY: Math.sin(angle) * BASE_OFFSET_DISTANCE * (0.8 + Math.random() * 0.4),
            velocityX: (Math.random() - 0.5) * 2 * MAX_INITIAL_SPEED, // -MAX to +MAX
            velocityY: (Math.random() - 0.5) * 2 * MAX_INITIAL_SPEED - (MAX_INITIAL_SPEED * 0.5), // Bias upwards slightly
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 2 * (MAX_ROTATION_SPEED_DEG * Math.PI / 180),
            opacity: 1.0,
            scale: 0.8 + Math.random() * 0.4, // Random initial scale 0.8 to 1.2
            startTime: now,
            spawnTime: now,
        };
        activeParticles.push(particle);
    }
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

        // Opacity: Fade out
        const fadeDelayProgress = FADE_OUT_DELAY_FACTOR;
        if (lifeProgress > fadeDelayProgress) {
            particle.opacity = 1.0 - ((lifeProgress - fadeDelayProgress) / (1.0 - fadeDelayProgress));
        } else {
            particle.opacity = 1.0;
        }
        particle.opacity = Math.max(0, particle.opacity);


        // Position: Linear movement based on velocity
        const currentX = particle.startX + particle.offsetX + (particle.velocityX * (elapsedTime / 1000));
        const currentY = particle.startY + particle.offsetY + (particle.velocityY * (elapsedTime / 1000));

        // Rotation
        const currentRotation = particle.rotation + (particle.rotationSpeed * (elapsedTime / 1000));
        
        // Scale: Optional - shrink over time
        // particle.scale = (1.0 - lifeProgress) * initialScale; 

        if (particle.opacity > 0 && particle.texture && particle.texture.naturalWidth > 0 && particle.texture.naturalHeight > 0) {
            ctx.globalAlpha = particle.opacity;
            
            let drawWidth = particle.texture.naturalWidth * particle.scale;
            let drawHeight = particle.texture.naturalHeight * particle.scale;
            const aspectRatio = particle.texture.naturalWidth / particle.texture.naturalHeight;

            // Scale down if too large, maintaining aspect ratio
            if (drawWidth > MAX_PARTICLE_DIMENSION_PX) {
                drawWidth = MAX_PARTICLE_DIMENSION_PX;
                drawHeight = drawWidth / aspectRatio;
            }
            if (drawHeight > MAX_PARTICLE_DIMENSION_PX) {
                drawHeight = MAX_PARTICLE_DIMENSION_PX;
                drawWidth = drawHeight * aspectRatio;
            }
            // Second pass to ensure the other dimension is also capped after primary scaling
            if (drawWidth > MAX_PARTICLE_DIMENSION_PX && aspectRatio !== 0) { 
                drawWidth = MAX_PARTICLE_DIMENSION_PX;
                drawHeight = drawWidth / aspectRatio;
            }

            ctx.translate(currentX, currentY);
            ctx.rotate(currentRotation);
            ctx.drawImage(particle.texture, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
            ctx.rotate(-currentRotation); // Rotate back
            ctx.translate(-currentX, -currentY); // Translate back
        }
    }
    ctx.globalAlpha = 1.0; // Reset global alpha
    ctx.restore();
}

// Cleanup function (optional, if you need to unregister listeners later)
export function cleanupCutGrassEffectSystem() {
    if (dbConn && dbConn.db && dbConn.db.grass) {
        // SpacetimeDB SDK might not have a direct removeOnDelete,
        // so this might involve more complex listener management if needed.
        // For now, we assume the system lives as long as the client.
        // console.log("[CutGrassEffect] System cleanup (if implemented by SDK).");
    }
    activeParticles.length = 0; // Clear any remaining particles
    dbConn = null;
} 