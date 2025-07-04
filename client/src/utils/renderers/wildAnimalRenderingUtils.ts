import { drawDynamicGroundShadow } from './shadowUtils';
import { imageManager } from './imageManager';
import * as SpacetimeDB from '../../generated';
import { 
  getAnimalCollisionBounds,
  ANIMAL_COLLISION_SIZES 
} from '../animalCollisionUtils';

// --- Constants for damage visual effects ---
const ANIMAL_SHAKE_DURATION_MS = 200; // How long the shake lasts
const ANIMAL_SHAKE_AMOUNT_PX = 4;     // Max pixels to offset (slightly more than players)
const ANIMAL_HIT_FLASH_DURATION_MS = 120; // Duration of the white flash on hit (slightly longer than players)

// --- Hit state tracking for animals (similar to player system) ---
interface AnimalHitState {
    lastProcessedHitTime: bigint;
    clientDetectionTime: number;
    effectStartTime: number;
}

const animalHitStates = new Map<string, AnimalHitState>();

// --- Movement interpolation for smoother animal movement ---
interface AnimalMovementState {
    lastServerX: number;
    lastServerY: number;
    targetX: number;
    targetY: number;
    lastUpdateTime: number;
    interpolatedX: number;
    interpolatedY: number;
}

const animalMovementStates = new Map<string, AnimalMovementState>();

// Interpolation settings - UPDATED for high-speed animals (750-800 px/s)
const ANIMAL_INTERPOLATION_SPEED = 0.35; // Faster interpolation for high-speed movement
const MAX_INTERPOLATION_DISTANCE = 200; // Higher threshold - animals can move 93px in 125ms at 750px/s

// --- Reusable Offscreen Canvas for Tinting ---
const offscreenCanvas = document.createElement('canvas');
const offscreenCtx = offscreenCanvas.getContext('2d');

// Re-export for convenience
export type WildAnimal = SpacetimeDB.WildAnimal;
export type AnimalSpecies = SpacetimeDB.AnimalSpecies;
export type AnimalState = SpacetimeDB.AnimalState;

interface WildAnimalRenderProps {
    ctx: CanvasRenderingContext2D;
    animal: WildAnimal;
    nowMs: number;
    cycleProgress: number;
    animationFrame?: number;
    localPlayerPosition?: { x: number; y: number } | null;
}

// Get the appropriate image filename for each species with variations
function getAnimalImageName(species: AnimalSpecies, animalId?: bigint): string {
    switch (species.tag) {
        case 'CinderFox':
            // Use animal ID to deterministically select variation (consistent alive/dead)
            if (animalId !== undefined) {
                const variation = Number(animalId) % 2; // 0 or 1
                return variation === 0 ? 'cinder_fox.png' : 'cinder_fox2.png';
            }
            return 'cinder_fox.png'; // Fallback if no ID provided
        case 'TundraWolf':
            // Use animal ID to deterministically select variation (consistent alive/dead)
            if (animalId !== undefined) {
                const variation = Number(animalId) % 2; // 0 or 1
                return variation === 0 ? 'tundra_wolf.png' : 'tundra_wolf2.png';
            }
            return 'tundra_wolf.png'; // Fallback if no ID provided
        case 'CableViper':
            return 'cable_viper.png';
        case 'ArcticWalrus':
            return 'walrus.png';
        default:
            return 'cinder_fox.png';
    }
}

// Get species-specific rendering properties
function getSpeciesRenderingProps(species: AnimalSpecies) {
    // All animals now use the same square dimensions for consistency
    const standardSize = 96; // Consistent square size for all animals
    const standardShadow = 32; // Consistent shadow radius
    
    return { 
        width: standardSize, 
        height: standardSize, 
        shadowRadius: standardShadow 
    };
}

// Main wild animal rendering function
export function renderWildAnimal({
    ctx,
    animal,
    nowMs,
    cycleProgress,
    animationFrame = 0,
    localPlayerPosition
}: WildAnimalRenderProps) {
    // REMOVED: No more burrowing state checks - all animals should always be visible

    const animalId = animal.id.toString();
    
    // --- Movement interpolation with collision prediction ---
    let renderPosX = animal.posX;
    let renderPosY = animal.posY;
    
    let movementState = animalMovementStates.get(animalId);
    if (!movementState) {
        // Initialize movement state
        movementState = {
            lastServerX: animal.posX,
            lastServerY: animal.posY,
            targetX: animal.posX,
            targetY: animal.posY,
            lastUpdateTime: nowMs,
            interpolatedX: animal.posX,
            interpolatedY: animal.posY,
        };
        animalMovementStates.set(animalId, movementState);
    } else {
        // Check if server position changed significantly
        const dx = animal.posX - movementState.lastServerX;
        const dy = animal.posY - movementState.lastServerY;
        const distanceMoved = Math.sqrt(dx * dx + dy * dy);
        
        if (distanceMoved > 2.0) { // Only update if animal moved more than 2 pixels (reduced sensitivity for high-speed animals)
            // Check for teleportation (too far to interpolate)
            if (distanceMoved > MAX_INTERPOLATION_DISTANCE) {
                // Teleportation detected - snap to new position
                movementState.interpolatedX = animal.posX;
                movementState.interpolatedY = animal.posY;
            } else {
                // Normal movement - update target
                movementState.targetX = animal.posX;
                movementState.targetY = animal.posY;
            }
            movementState.lastServerX = animal.posX;
            movementState.lastServerY = animal.posY;
            movementState.lastUpdateTime = nowMs;
        }
        
        // Dynamic interpolation speed based on movement distance (auto-scales to any speed)
        const distanceToTarget = Math.sqrt(
            (movementState.targetX - movementState.interpolatedX) ** 2 + 
            (movementState.targetY - movementState.interpolatedY) ** 2
        );
        
        // Auto-adaptive speed based on how far behind we are (works for any animal speed)
        let adaptiveSpeed = ANIMAL_INTERPOLATION_SPEED;
        if (distanceToTarget > 40) { // Large gap = much faster catchup
            adaptiveSpeed = 0.6;
        } else if (distanceToTarget > 15) { // Medium gap = faster catchup  
            adaptiveSpeed = 0.45;
        }
        
        // Use adaptive interpolation for smooth movement
        const lerpX = movementState.interpolatedX + (movementState.targetX - movementState.interpolatedX) * adaptiveSpeed;
        const lerpY = movementState.interpolatedY + (movementState.targetY - movementState.interpolatedY) * adaptiveSpeed;
        
        movementState.interpolatedX = lerpX;
        movementState.interpolatedY = lerpY;
        
        // Use interpolated position for rendering
        renderPosX = movementState.interpolatedX;
        renderPosY = movementState.interpolatedY;
    }
    
    // --- Hit detection and effect timing (similar to player system) ---
    const serverLastHitTimePropMicros = animal.lastHitTime?.microsSinceUnixEpoch ?? 0n;
    let hitState = animalHitStates.get(animalId);
    let isCurrentlyHit = false;
    let hitEffectElapsed = 0;
    
    if (serverLastHitTimePropMicros > 0n) {
        if (!hitState || serverLastHitTimePropMicros > hitState.lastProcessedHitTime) {
            // NEW HIT DETECTED! Set up effect timing based on client time
            hitState = {
                lastProcessedHitTime: serverLastHitTimePropMicros,
                clientDetectionTime: nowMs,
                effectStartTime: nowMs
            };
            animalHitStates.set(animalId, hitState);
        }
        
        // Calculate effect timing based on when WE detected the hit
        if (hitState) {
            hitEffectElapsed = nowMs - hitState.effectStartTime;
            isCurrentlyHit = hitEffectElapsed < ANIMAL_SHAKE_DURATION_MS;
        }
    } else {
        // No hit time from server - clear hit state
        if (hitState) {
            animalHitStates.delete(animalId);
        }
    }

    // Legacy calculation for fallback
    const serverLastHitTimeMs = serverLastHitTimePropMicros > 0n ? Number(serverLastHitTimePropMicros / 1000n) : 0;
    const elapsedSinceServerHitMs = serverLastHitTimeMs > 0 ? (nowMs - serverLastHitTimeMs) : Infinity;
    
    // Use new hit detection if available, otherwise fall back to old system
    const effectiveHitElapsed = isCurrentlyHit ? hitEffectElapsed : elapsedSinceServerHitMs;
    const shouldShowCombatEffects = isCurrentlyHit || elapsedSinceServerHitMs < ANIMAL_SHAKE_DURATION_MS;

    // --- Shake Logic ---
    let shakeX = 0;
    let shakeY = 0;
    if (animal.health > 0 && effectiveHitElapsed < ANIMAL_SHAKE_DURATION_MS) {
        shakeX = (Math.random() - 0.5) * 2 * ANIMAL_SHAKE_AMOUNT_PX;
        shakeY = (Math.random() - 0.5) * 2 * ANIMAL_SHAKE_AMOUNT_PX;
    }

    // --- Flash Logic ---
    const isFlashing = animal.health > 0 && effectiveHitElapsed < ANIMAL_HIT_FLASH_DURATION_MS;

    const imageName = getAnimalImageName(animal.species, animal.id);
    const animalImage = imageManager.getImage(`/npcs/${imageName}`);
    
    // Get fallback color for each species
    const getFallbackColor = (species: AnimalSpecies): string => {
        switch (species.tag) {
            case 'CinderFox': return '#FF6B35'; // Orange
            case 'TundraWolf': return '#4A90E2'; // Blue  
            case 'CableViper': return '#7ED321'; // Green
            default: return '#9013FE'; // Purple
        }
    };
    
    const useImageFallback = !animalImage || !animalImage.complete;

    const props = getSpeciesRenderingProps(animal.species);
    const renderX = renderPosX - props.width / 2 + shakeX; // Apply shake to X (using interpolated position)
    const renderY = renderPosY - props.height / 2 + shakeY; // Apply shake to Y (using interpolated position)

    // No animals hide anymore - always fully visible
    const alpha = 1.0;
    
    ctx.save();
    ctx.globalAlpha = alpha;
    
    // Apply horizontal flipping based on facing direction
    const shouldFlip = animal.facingDirection === "right";
    if (shouldFlip) {
        ctx.scale(-1, 1); // Flip horizontally
        ctx.translate(-renderPosX * 2, 0); // Adjust position after flipping
    }

    // Render shadow (always render shadows - no animals hide)
    {
        ctx.save();
        if (useImageFallback) {
            // For fallback circles, create a simple shadow ellipse
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.beginPath();
            ctx.ellipse(renderPosX, renderPosY + 20, props.width / 3, 8, 0, 0, Math.PI * 2);
            ctx.fill();
        } else if (animalImage) {
            // Use dynamic ground shadow for proper images
            drawDynamicGroundShadow({
                ctx,
                entityImage: animalImage,
                entityCenterX: renderPosX,
                entityBaseY: renderPosY + props.height / 2, // Bottom of the animal
                imageDrawWidth: props.width,
                imageDrawHeight: props.height,
                cycleProgress: cycleProgress,
                shakeOffsetX: shakeX,
                shakeOffsetY: shakeY,
            });
        }
        ctx.restore();
    }

    if (useImageFallback) {
        // Draw fallback colored circle with shake applied
        const centerX = renderPosX + shakeX; // Use interpolated position
        const centerY = renderPosY + shakeY; // Use interpolated position
        const radius = Math.min(props.width, props.height) / 3;
        
        // Apply white flash to fallback color
        let fillColor = getFallbackColor(animal.species);
        if (isFlashing) {
            fillColor = '#FFFFFF'; // Flash white
        }
        
        ctx.fillStyle = fillColor;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        
        // Add a simple indicator for the species (letter)
        ctx.fillStyle = isFlashing ? '#000000' : '#FFFFFF'; // Invert letter color when flashing
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const letter = animal.species.tag.charAt(0); // C, T, or C
        ctx.fillText(letter, centerX, centerY);
    } else {
        // --- Prepare sprite on offscreen canvas (for white flash tinting) ---
        if (offscreenCtx && animalImage) {
            offscreenCanvas.width = animalImage.width;
            offscreenCanvas.height = animalImage.height;
            offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
            
            // Draw the original image to the offscreen canvas
            offscreenCtx.drawImage(animalImage, 0, 0);

            // Apply white flash if needed
            if (isFlashing) {
                offscreenCtx.globalCompositeOperation = 'source-in';
                offscreenCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
                offscreenCtx.globalCompositeOperation = 'source-over';
            }

            // Draw the (possibly tinted) offscreen canvas to the main canvas
            ctx.drawImage(
                offscreenCanvas,
                renderX,
                renderY,
                props.width,
                props.height
            );
        } else {
            // Fallback: draw image directly without flash effect
            ctx.drawImage(
                animalImage!,
                renderX,
                renderY,
                props.width,
                props.height
            );
        }
    }

    ctx.restore();
}

// Preload wild animal images using imageManager
export function preloadWildAnimalImages(): void {
    const imagesToLoad = [
        'cinder_fox.png', 
        'cinder_fox2.png',  // Add the new cinder fox variation
        'tundra_wolf.png', 
        'tundra_wolf2.png',  // Add the new variation
        'cable_viper.png',
        'walrus.png'  // Add the missing walrus image
    ];
    
    imagesToLoad.forEach(imageName => {
        imageManager.preloadImage(`/npcs/${imageName}`);
    });
}

// Helper function to check if coordinates are within animal bounds
export function isPointInAnimal(
    x: number,
    y: number,
    animal: WildAnimal
): boolean {
    // Use the collision bounds system for consistent sizing
    const bounds = getAnimalCollisionBounds(animal);
    
    return x >= bounds.x && x <= bounds.x + bounds.width && 
           y >= bounds.y && y <= bounds.y + bounds.height;
}

// --- THOUGHT BUBBLE RENDERING ---

interface ThoughtBubbleProps {
    ctx: CanvasRenderingContext2D;
    animal: WildAnimal;
    nowMs: number;
    emoji: string;
    duration: number;
    startTime: number;
}

/**
 * Renders a thought bubble with an emoji above a tamed animal
 */
export function renderAnimalThoughtBubble({
    ctx,
    animal,
    nowMs,
    emoji,
    duration,
    startTime,
}: ThoughtBubbleProps) {
    const elapsed = nowMs - startTime;
    
    // Don't render if effect has expired
    if (elapsed >= duration) {
        return;
    }
    
    // Calculate bubble position above the animal
    const bubbleX = animal.posX;
    const bubbleY = animal.posY - 80; // Position above the animal
    
    // Calculate fade effect for the last 500ms
    const fadeStartTime = duration - 500;
    let alpha = 1.0;
    if (elapsed > fadeStartTime) {
        alpha = 1.0 - ((elapsed - fadeStartTime) / 500);
    }
    
    // Add slight bob animation
    const bobOffset = Math.sin((elapsed * 0.008)) * 3; // Gentle bobbing motion
    const finalY = bubbleY + bobOffset;
    
    ctx.save();
    ctx.globalAlpha = alpha;
    
    // Draw thought bubble background
    const bubbleRadius = 25;
    const tailHeight = 8;
    
    // Bubble gradient
    const gradient = ctx.createRadialGradient(bubbleX, finalY, 0, bubbleX, finalY, bubbleRadius);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    gradient.addColorStop(1, 'rgba(240, 240, 240, 0.85)');
    
    // Main bubble circle
    ctx.fillStyle = gradient;
    ctx.strokeStyle = 'rgba(100, 100, 100, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bubbleX, finalY, bubbleRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // Thought bubble tail (small circles)
    const tailPositions = [
        { x: bubbleX - 10, y: finalY + bubbleRadius + 5, radius: 4 },
        { x: bubbleX - 18, y: finalY + bubbleRadius + 12, radius: 3 },
        { x: bubbleX - 24, y: finalY + bubbleRadius + 18, radius: 2 },
    ];
    
    tailPositions.forEach(pos => {
        ctx.fillStyle = gradient;
        ctx.strokeStyle = 'rgba(100, 100, 100, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, pos.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });
    
    // Draw emoji
    ctx.fillStyle = 'black';
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, bubbleX, finalY);
    
    ctx.restore();
}

/**
 * Renders taming-related thought bubbles for wild animals
 */
export function renderTamingThoughtBubbles({
    ctx,
    animal,
    nowMs,
}: {
    ctx: CanvasRenderingContext2D;
    animal: WildAnimal;
    nowMs: number;
}) {
    // Check for heart effect (when animal is tamed)
    if (animal.heartEffectUntil) {
        const heartEffectEndTime = Number(animal.heartEffectUntil.microsSinceUnixEpoch) / 1000; // Convert to milliseconds
        const heartEffectStartTime = heartEffectEndTime - 3000; // 3 second duration
        
        if (nowMs >= heartEffectStartTime && nowMs <= heartEffectEndTime) {
            renderAnimalThoughtBubble({
                ctx,
                animal,
                nowMs,
                emoji: '💖',
                duration: 3000,
                startTime: heartEffectStartTime,
            });
        }
    }
    
    // Check for crying effect (when tamed animal is hit by owner)
    if (animal.cryingEffectUntil) {
        const cryingEffectEndTime = Number(animal.cryingEffectUntil.microsSinceUnixEpoch) / 1000; // Convert to milliseconds
        const cryingEffectStartTime = cryingEffectEndTime - 3000; // 3 second duration
        
        if (nowMs >= cryingEffectStartTime && nowMs <= cryingEffectEndTime) {
            renderAnimalThoughtBubble({
                ctx,
                animal,
                nowMs,
                emoji: '😢',
                duration: 3000,
                startTime: cryingEffectStartTime,
            });
        }
    }
    
    // Additional thought bubbles can be added here for other emotions/states
}