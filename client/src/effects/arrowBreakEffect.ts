interface ArrowBreakParticle {
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
    lifetime: number;
}

const PARTICLE_LIFETIME_MS = 500; // 0.5 seconds
const NUM_PARTICLES_PER_BREAK = 3; // Number of stick particles
const INITIAL_SPEED_MIN = 40; // Min initial speed in pixels per second
const INITIAL_SPEED_MAX = 120; // Max initial speed in pixels per second
const GRAVITY = 80; // Downward acceleration in pixels per second squared
const MAX_ROTATION_SPEED_DEG = 180; // Max rotation speed in degrees per second
const PARTICLE_WIDTH = 8; // Width of stick particles
const PARTICLE_HEIGHT = 2; // Height of stick particles
const PARTICLE_COLORS = [
    '#CD853F', // Peru (lighter brown)
    '#DEB887', // Burlywood (lightest)
    '#D2B48C', // Tan (light brown)
];

const activeParticles: ArrowBreakParticle[] = [];

export function spawnArrowBreakParticles(centerX: number, centerY: number) {
    const now = Date.now();
    console.log(`[ArrowBreak] Spawning ${NUM_PARTICLES_PER_BREAK} particles at (${centerX}, ${centerY})`);

    for (let i = 0; i < NUM_PARTICLES_PER_BREAK; i++) {
        // Create particles in a circular spread pattern
        const angle = (i / NUM_PARTICLES_PER_BREAK) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
        const speed = INITIAL_SPEED_MIN + Math.random() * (INITIAL_SPEED_MAX - INITIAL_SPEED_MIN);
        
        const particle: ArrowBreakParticle = {
            id: `arrow_break_${i}_${now}`,
            x: centerX + (Math.random() - 0.5) * 4, // Small random offset from center
            y: centerY + (Math.random() - 0.5) * 4,
            velocityX: Math.cos(angle) * speed,
            velocityY: Math.sin(angle) * speed - 20, // Slight upward bias
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 2 * (MAX_ROTATION_SPEED_DEG * Math.PI / 180),
            opacity: 1.0,
            scale: 0.8 + Math.random() * 0.4, // Random scale 0.8 to 1.2
            startTime: now,
            lifetime: PARTICLE_LIFETIME_MS,
        };
        activeParticles.push(particle);
    }
}

export function renderArrowBreakEffects(ctx: CanvasRenderingContext2D, nowMs: number) {
    if (activeParticles.length === 0) return;

    // Debug log occasionally
    if (Math.random() < 0.1) {
        console.log(`[ArrowBreak] Rendering ${activeParticles.length} particles`);
    }

    ctx.save();

    for (let i = activeParticles.length - 1; i >= 0; i--) {
        const particle = activeParticles[i];
        const elapsedTime = nowMs - particle.startTime;

        if (elapsedTime >= particle.lifetime) {
            activeParticles.splice(i, 1);
            continue;
        }

        const lifeProgress = elapsedTime / particle.lifetime;
        const deltaTimeSeconds = 16.667 / 1000; // Fixed delta time for 60fps

        // Update physics - apply gravity to velocity, then update position
        particle.velocityY += GRAVITY * deltaTimeSeconds; // Apply gravity to velocity
        particle.x += particle.velocityX * deltaTimeSeconds; // Update position
        particle.y += particle.velocityY * deltaTimeSeconds; // Update position
        
        // Update rotation
        particle.rotation += particle.rotationSpeed * deltaTimeSeconds;
        
        // Fade out over time
        particle.opacity = 1.0 - lifeProgress;

        // Render the stick particle
        if (particle.opacity > 0) {
            ctx.globalAlpha = particle.opacity;
            
            // Choose color based on particle ID for consistency
            const colorIndex = Math.abs(particle.id.charCodeAt(particle.id.length - 1)) % PARTICLE_COLORS.length;
            ctx.fillStyle = PARTICLE_COLORS[colorIndex];
            
            ctx.save();
            ctx.translate(particle.x, particle.y);
            ctx.rotate(particle.rotation);
            ctx.scale(particle.scale, particle.scale);
            
            // Draw a simple rectangle representing a stick fragment
            const halfWidth = PARTICLE_WIDTH / 2;
            const halfHeight = PARTICLE_HEIGHT / 2;
            ctx.fillRect(-halfWidth, -halfHeight, PARTICLE_WIDTH, PARTICLE_HEIGHT);
            
            ctx.restore();
        }
    }

    ctx.globalAlpha = 1.0; // Reset global alpha
    ctx.restore();
}

// Cleanup function
export function cleanupArrowBreakEffectSystem() {
    activeParticles.length = 0; // Clear all particles
} 