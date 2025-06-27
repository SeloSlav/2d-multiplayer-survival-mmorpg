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

// Interpolation settings
const ANIMAL_INTERPOLATION_SPEED = 0.15; // How fast to interpolate (0.1 = slow, 0.5 = fast)
const MAX_INTERPOLATION_DISTANCE = 100; // Don't interpolate if animal teleported more than this

// --- Reusable Offscreen Canvas for Tinting ---
const offscreenCanvas = document.createElement('canvas');
const offscreenCtx = offscreenCanvas.getContext('2d');
if (!offscreenCtx) {
    console.error("Failed to get 2D context from offscreen canvas for wild animal rendering.");
}

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

// Get the appropriate image filename for each species
function getAnimalImageName(species: AnimalSpecies): string {
    switch (species.tag) {
        case 'CinderFox':
            return 'cinder_fox.png';
        case 'TundraWolf':
            return 'tundra_wolf.png';
        case 'CableViper':
            return 'cable_viper.png';
        default:
            console.warn(`Unknown animal species: ${(species as any).tag}, using cinder_fox as fallback`);
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
    // Skip rendering if animal is burrowed
    if (animal.state.tag === 'Burrowed') {
        return;
    }

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
        
        if (distanceMoved > 1.0) { // Only update if animal moved more than 1 pixel
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
        
        // Use simple interpolation for smooth movement
        if (localPlayerPosition) {
            // Simple interpolation without collision prediction
            const lerpX = movementState.interpolatedX + (movementState.targetX - movementState.interpolatedX) * ANIMAL_INTERPOLATION_SPEED;
            const lerpY = movementState.interpolatedY + (movementState.targetY - movementState.interpolatedY) * ANIMAL_INTERPOLATION_SPEED;
            
            movementState.interpolatedX = lerpX;
            movementState.interpolatedY = lerpY;
        } else {
            // Fallback to simple interpolation
            const lerpX = movementState.interpolatedX + (movementState.targetX - movementState.interpolatedX) * ANIMAL_INTERPOLATION_SPEED;
            const lerpY = movementState.interpolatedY + (movementState.targetY - movementState.interpolatedY) * ANIMAL_INTERPOLATION_SPEED;
            
            movementState.interpolatedX = lerpX;
            movementState.interpolatedY = lerpY;
        }
        
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
            console.log(`🎯 [COMBAT] Hit detected for wild animal ${animalId} at client time ${nowMs}`);
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
        
        // Debug log for troubleshooting
        if (effectiveHitElapsed < 50) { // Only log within first 50ms to avoid spam
            console.log(`🎯 [SHAKE] Wild animal ${animalId} shaking: elapsed=${effectiveHitElapsed.toFixed(1)}ms, isCurrentlyHit=${isCurrentlyHit}`);
        }
    }

    // --- Flash Logic ---
    const isFlashing = animal.health > 0 && effectiveHitElapsed < ANIMAL_HIT_FLASH_DURATION_MS;

    const imageName = getAnimalImageName(animal.species);
    const animalImage = imageManager.getImage(`/npcs/${imageName}`);
    
    // Debug logging for troubleshooting species rendering
    if (Math.random() < 0.01) { // Log 1% of renders to avoid spam
        console.log(`🦊 [ANIMAL RENDER] Rendering ${animal.species.tag} (ID: ${animalId}) with image: ${imageName}, loaded: ${animalImage?.complete}`);
    }
    
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

    // Apply alpha for hiding animals (vipers only, foxes no longer hide)
    const alpha = (animal.state.tag === 'Hiding') ? 0.6 : 1.0;
    
    ctx.save();
    ctx.globalAlpha = alpha;

    // Render shadow (if not hiding)
    if (animal.state.tag !== 'Hiding') {
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
    const imagesToLoad = ['cinder_fox.png', 'tundra_wolf.png', 'cable_viper.png'];
    
    imagesToLoad.forEach(imageName => {
        imageManager.preloadImage(`/npcs/${imageName}`);
    });
    
    console.log('Preloading wild animal images:', imagesToLoad.map(name => `/npcs/${name}`));
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