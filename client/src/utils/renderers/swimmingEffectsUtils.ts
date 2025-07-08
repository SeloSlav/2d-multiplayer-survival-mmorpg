import { Player as SpacetimeDBPlayer } from '../../generated';
import { gameConfig } from '../../config/gameConfig';

// Swimming effects configuration
const SWIMMING_EFFECTS_CONFIG = {
  WATER_LINE_OFFSET: 0.5, // Proper waist level (0.4 = 40% down from top)
  WAVE_AMPLITUDE: 1.0, // Subtle wave movement
  WAVE_FREQUENCY: 0.003, // Frequency of water line animation
  WAKE_INITIAL_RADIUS: 24, // Starting radius of wake semi-circles
  WAKE_MAX_RADIUS: 50, // Maximum radius for wake expansion
  WAKE_EXPANSION_SPEED: 0.02, // How fast wake semi-circles expand
  WAKE_LIFETIME: 1800, // How long each wake lasts (ms)
  WAKE_MOVEMENT_THRESHOLD: 5, // Minimum distance moved to create new wake
  UNDERWATER_TINT: 'rgba(12, 62, 79, 0.4)', // Underwater tinting
  SHIMMER_FREQUENCY: 0.005, // Frequency of shimmer effects
};

// Interface for tracking individual wake effects
interface WakeEffect {
  id: number;
  originX: number;
  originY: number;
  createdAt: number;
  directionAngle: number;
}

// Global wake tracking
let wakeEffects: WakeEffect[] = [];
let nextWakeId = 0;
let lastPlayerPosition: { x: number; y: number } | null = null;
let movementCounter = 0;
let nextWakeThreshold = 8; // When to create next wake (randomized)
const WAKE_SKIP_MOVEMENTS_BASE = 8; // Base movements to skip
const WAKE_SKIP_RANDOMNESS = 5; // Random additional movements (0-5)

/**
 * Generates next random wake threshold
 */
function generateNextWakeThreshold(): number {
  return WAKE_SKIP_MOVEMENTS_BASE + Math.floor(Math.random() * WAKE_SKIP_RANDOMNESS);
}

/**
 * Calculates the direction angle for wake effects based on player direction
 */
function getDirectionAngle(direction: string): number {
  switch (direction) {
    case 'up': return -Math.PI / 2;
    case 'up_right': return -Math.PI / 4;
    case 'right': return 0;
    case 'down_right': return Math.PI / 4;
    case 'down': return Math.PI / 2;
    case 'down_left': return (3 * Math.PI) / 4;
    case 'left': return Math.PI;
    case 'up_left': return (-3 * Math.PI) / 4;
    default: return Math.PI / 2; // Default to down
  }
}

/**
 * Draws the animated water line effect halfway down the player sprite
 */
function drawWaterLine(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  spriteWidth: number,
  spriteHeight: number,
  currentTimeMs: number
): void {
  // Position water line at waist level - from the TOP of the sprite, not center
  const spriteTopY = centerY - spriteHeight / 2;
  const waterLineY = spriteTopY + (spriteHeight * SWIMMING_EFFECTS_CONFIG.WATER_LINE_OFFSET);
  const time = currentTimeMs;
  
  // Create animated wave effect
  const baseWaveOffset = Math.sin(time * SWIMMING_EFFECTS_CONFIG.WAVE_FREQUENCY + centerX * 0.01) * SWIMMING_EFFECTS_CONFIG.WAVE_AMPLITUDE;
  const shimmerIntensity = (Math.sin(time * SWIMMING_EFFECTS_CONFIG.SHIMMER_FREQUENCY * 2) + 1) * 0.5;
  
  ctx.save();
  
  // Draw underwater tinting below the water line (from water line to bottom of sprite)
  const spriteBottomY = centerY + spriteHeight / 2;
  const underwaterHeight = spriteBottomY - waterLineY;
  
  const underwaterGradient = ctx.createLinearGradient(0, waterLineY, 0, spriteBottomY);
  underwaterGradient.addColorStop(0, 'rgba(12, 62, 79, 0.3)'); // Light tint at water line
  underwaterGradient.addColorStop(0.5, 'rgba(12, 62, 79, 0.6)'); // Stronger tint deeper
  underwaterGradient.addColorStop(1, 'rgba(12, 62, 79, 0.8)'); // Strongest tint at bottom
  
  ctx.fillStyle = underwaterGradient;
  ctx.fillRect(
    centerX - spriteWidth / 2, 
    waterLineY, 
    spriteWidth, 
    underwaterHeight
  );
  
  // Draw the animated water line
  ctx.strokeStyle = `rgba(100, 200, 255, ${0.6 + shimmerIntensity * 0.3})`;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  
  ctx.beginPath();
  
  // Draw curved water line half as wide, curving up at the ends
  const waterLineWidth = spriteWidth * 0.6; // Half the sprite width
  const leftX = centerX - waterLineWidth / 2;
  const rightX = centerX + waterLineWidth / 2;
  const centerWaterY = waterLineY + baseWaveOffset;
  
  // Create a curved line that curves upward at the ends
  const curveHeight = 3; // How much the ends curve upward
  const segments = 6;
  
  for (let i = 0; i <= segments; i++) {
    const progress = i / segments; // 0 to 1
    const x = leftX + (waterLineWidth * progress);
    
    // Create a parabolic curve that dips down in the middle and curves up at the ends
    // Using a quadratic function: y = ax² + bx + c where it curves up at ends
    const distanceFromCenter = Math.abs(progress - 0.5) * 2; // 0 at center, 1 at edges
    const curveOffset = distanceFromCenter * distanceFromCenter * curveHeight; // Quadratic curve
    
    const localWaveOffset = Math.sin(time * SWIMMING_EFFECTS_CONFIG.WAVE_FREQUENCY * 3 + i * 0.5) * 0.3;
    const y = centerWaterY - curveOffset + localWaveOffset; // Subtract to curve upward
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  
  ctx.stroke();
  
  // Add shimmer highlights on the water line
  if (shimmerIntensity > 0.7) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${(shimmerIntensity - 0.7) * 2})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  
  ctx.restore();
}

/**
 * Creates a new wake effect when player moves
 */
function createWakeEffect(centerX: number, centerY: number, directionAngle: number, currentTimeMs: number): void {
  wakeEffects.push({
    id: nextWakeId++,
    originX: centerX,
    originY: centerY,
    createdAt: currentTimeMs,
    directionAngle: directionAngle
  });
}

/**
 * Manages wake creation based on player movement
 */
function manageWakeCreation(
  centerX: number,
  centerY: number,
  player: SpacetimeDBPlayer,
  currentTimeMs: number,
  isMoving: boolean
): void {
  const currentPos = { x: centerX, y: centerY };
  
  // Check if player has moved enough to create a new wake
  if (isMoving && lastPlayerPosition) {
    const distance = Math.sqrt(
      Math.pow(currentPos.x - lastPlayerPosition.x, 2) + 
      Math.pow(currentPos.y - lastPlayerPosition.y, 2)
    );
    
    if (distance >= SWIMMING_EFFECTS_CONFIG.WAKE_MOVEMENT_THRESHOLD) {
      movementCounter++;
      
      // Only create wake when we reach the randomized threshold
      if (movementCounter >= nextWakeThreshold) {
        const directionAngle = getDirectionAngle(player.direction);
        createWakeEffect(currentPos.x, currentPos.y, directionAngle, currentTimeMs);
        movementCounter = 0; // Reset counter
        nextWakeThreshold = generateNextWakeThreshold(); // Set next random threshold
      }
      
      lastPlayerPosition = currentPos;
    }
  } else if (isMoving && !lastPlayerPosition) {
    // First movement - always create initial wake
    const directionAngle = getDirectionAngle(player.direction);
    createWakeEffect(currentPos.x, currentPos.y, directionAngle, currentTimeMs);
    lastPlayerPosition = currentPos;
    movementCounter = 0;
    nextWakeThreshold = generateNextWakeThreshold();
  } else if (!isMoving) {
    // Update position even when not moving for next movement detection
    lastPlayerPosition = currentPos;
    // Reset counter when not moving so next movement starts fresh
    movementCounter = 0;
  }
}

/**
 * Draws expanding semi-circular wake effects with irregular edges
 */
function drawExpandingWakes(
  ctx: CanvasRenderingContext2D,
  currentTimeMs: number
): void {
  ctx.save();
  
  // Clean up expired wakes and draw active ones
  wakeEffects = wakeEffects.filter(wake => {
    const age = currentTimeMs - wake.createdAt;
    const ageProgress = age / SWIMMING_EFFECTS_CONFIG.WAKE_LIFETIME;
    
    // Remove expired wakes
    if (ageProgress >= 1) return false;
    
    // Calculate current radius based on age
    const baseRadius = SWIMMING_EFFECTS_CONFIG.WAKE_INITIAL_RADIUS + 
      (SWIMMING_EFFECTS_CONFIG.WAKE_MAX_RADIUS - SWIMMING_EFFECTS_CONFIG.WAKE_INITIAL_RADIUS) * ageProgress;
    
    // Fade out as wake expands
    const alpha = (1 - ageProgress) * 0.5;
    
    // Draw semi-circle wake with opening facing the player (toward direction of movement)
    ctx.strokeStyle = `rgba(150, 220, 255, ${alpha})`;
    ctx.lineWidth = 2 * (1 - ageProgress * 0.5); // Line gets thinner as it expands
    ctx.lineCap = 'round';
    
    ctx.beginPath();
    
    // Draw irregular semi-circle arc instead of perfect arc  
    // The opening faces AWAY from the direction the player was moving (behind the player)
    const flippedDirection = wake.directionAngle + Math.PI; // Flip 180 degrees
    const startAngle = flippedDirection - Math.PI / 2;
    const endAngle = flippedDirection + Math.PI / 2;
    const segments = 24; // Number of segments for the arc
    
    // Calculate distortion intensity (stronger toward end of lifetime)
    const distortionIntensity = ageProgress > 0.6 ? (ageProgress - 0.6) / 0.4 : 0;
    const maxDistortion = baseRadius * 0.15; // Max 15% radius variation
    
    for (let i = 0; i <= segments; i++) {
      const segmentProgress = i / segments;
      const currentAngle = startAngle + (endAngle - startAngle) * segmentProgress;
      
      // Add irregular distortion to radius
      let currentRadius = baseRadius;
      if (distortionIntensity > 0) {
        // Use multiple sine waves for irregular effect
        const distortion1 = Math.sin(currentAngle * 8 + currentTimeMs * 0.003 + wake.id) * maxDistortion * distortionIntensity;
        const distortion2 = Math.sin(currentAngle * 12 + currentTimeMs * 0.002 + wake.id * 1.3) * maxDistortion * 0.6 * distortionIntensity;
        const distortion3 = Math.sin(currentAngle * 16 + currentTimeMs * 0.004 + wake.id * 0.7) * maxDistortion * 0.3 * distortionIntensity;
        currentRadius += distortion1 + distortion2 + distortion3;
      }
      
      const x = wake.originX + Math.cos(currentAngle) * currentRadius;
      const y = wake.originY + Math.sin(currentAngle) * currentRadius;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    
    ctx.stroke();
    
    return true; // Keep this wake
  });
  
  ctx.restore();
}





/**
 * Draws swimming effects that should appear UNDER the player sprite (but above water surface)
 */
export function drawSwimmingEffectsUnder(
  ctx: CanvasRenderingContext2D,
  player: SpacetimeDBPlayer,
  currentTimeMs: number,
  isMoving: boolean,
  spriteDrawX: number,
  spriteDrawY: number,
  spriteWidth: number = gameConfig.spriteWidth * 2,
  spriteHeight: number = gameConfig.spriteHeight * 2,
  cycleProgress?: number
): void {
  const centerX = spriteDrawX + spriteWidth / 2;
  const centerY = spriteDrawY + spriteHeight / 2;
  
  // Manage wake creation based on player movement
  manageWakeCreation(centerX, centerY, player, currentTimeMs, isMoving);
  
  // Draw all active expanding wake semi-circles (above water surface)
  drawExpandingWakes(ctx, currentTimeMs);
}

/**
 * Draws swimming effects that should appear OVER the player sprite
 */
export function drawSwimmingEffectsOver(
  ctx: CanvasRenderingContext2D,
  player: SpacetimeDBPlayer,
  currentTimeMs: number,
  spriteDrawX: number,
  spriteDrawY: number,
  spriteWidth: number = gameConfig.spriteWidth * 2,
  spriteHeight: number = gameConfig.spriteHeight * 2
): void {
  const centerX = spriteDrawX + spriteWidth / 2;
  const centerY = spriteDrawY + spriteHeight / 2;
  
  // Draw water line effect over the sprite
  drawWaterLine(ctx, centerX, centerY, spriteWidth, spriteHeight, currentTimeMs);
}

/**
 * Main function to draw all swimming effects for a player (for backwards compatibility)
 */
export function drawSwimmingEffects(
  ctx: CanvasRenderingContext2D,
  player: SpacetimeDBPlayer,
  currentTimeMs: number,
  isMoving: boolean,
  currentAnimationFrame: number,
  spriteDrawX: number,
  spriteDrawY: number,
  spriteWidth: number = gameConfig.spriteWidth * 2,
  spriteHeight: number = gameConfig.spriteHeight * 2,
  cycleProgress?: number
): void {
  drawSwimmingEffectsUnder(ctx, player, currentTimeMs, isMoving, spriteDrawX, spriteDrawY, spriteWidth, spriteHeight, cycleProgress);
  drawSwimmingEffectsOver(ctx, player, currentTimeMs, spriteDrawX, spriteDrawY, spriteWidth, spriteHeight);
} 