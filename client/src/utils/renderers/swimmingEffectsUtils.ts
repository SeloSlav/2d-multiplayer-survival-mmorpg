import { Player as SpacetimeDBPlayer } from '../../generated';
import { gameConfig } from '../../config/gameConfig';

// Swimming effects configuration
const SWIMMING_EFFECTS_CONFIG = {
  WATER_LINE_OFFSET: 0.5, // Proper waist level (0.4 = 40% down from top)
  WAVE_AMPLITUDE: 2.5, // More dramatic wave movement
  WAVE_FREQUENCY: 0.004, // Frequency of water line animation
  WAVE_SECONDARY_AMPLITUDE: 1.5, // Secondary wave for complex deformation
  WAVE_SECONDARY_FREQUENCY: 0.007, // Secondary wave frequency
  WAVE_TERTIARY_AMPLITUDE: 0.8, // Tertiary wave for micro-ripples
  WAVE_TERTIARY_FREQUENCY: 0.012, // Tertiary wave frequency
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
 * Draws the animated water line effect halfway down the player sprite with complex wave deformation
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
  
  // Create complex animated wave effect with multiple wave layers
  const primaryWave = Math.sin(time * SWIMMING_EFFECTS_CONFIG.WAVE_FREQUENCY + centerX * 0.01) * SWIMMING_EFFECTS_CONFIG.WAVE_AMPLITUDE;
  const secondaryWave = Math.sin(time * SWIMMING_EFFECTS_CONFIG.WAVE_SECONDARY_FREQUENCY + centerX * 0.02 + Math.PI * 0.3) * SWIMMING_EFFECTS_CONFIG.WAVE_SECONDARY_AMPLITUDE;
  const tertiaryWave = Math.sin(time * SWIMMING_EFFECTS_CONFIG.WAVE_TERTIARY_FREQUENCY + centerX * 0.03 + Math.PI * 0.7) * SWIMMING_EFFECTS_CONFIG.WAVE_TERTIARY_AMPLITUDE;
  const shimmerIntensity = (Math.sin(time * SWIMMING_EFFECTS_CONFIG.SHIMMER_FREQUENCY * 2) + 1) * 0.5;
  
  ctx.save();
  
  // Draw the animated water line with complex deformation
  ctx.strokeStyle = `rgba(120, 220, 255, ${0.7 + shimmerIntensity * 0.3})`;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  
  ctx.beginPath();
  
  // Draw curved water line with complex wave deformation
  const waterLineWidth = spriteWidth * 0.6; // Half the sprite width
  const leftX = centerX - waterLineWidth / 2;
  const rightX = centerX + waterLineWidth / 2;
  const segments = 12; // More segments for smoother deformation
  
  for (let i = 0; i <= segments; i++) {
    const progress = i / segments; // 0 to 1
    const x = leftX + (waterLineWidth * progress);
    
    // Create a parabolic curve that dips down in the middle and curves up at the ends
    const distanceFromCenter = Math.abs(progress - 0.5) * 2; // 0 at center, 1 at edges
    const curveOffset = distanceFromCenter * distanceFromCenter * 3; // Quadratic curve
    
    // Complex wave deformation with multiple overlapping waves
    const segmentWaveOffset = progress * 2 * Math.PI; // Create wave variation across the line
    const localPrimaryWave = Math.sin(time * SWIMMING_EFFECTS_CONFIG.WAVE_FREQUENCY * 2 + segmentWaveOffset) * (SWIMMING_EFFECTS_CONFIG.WAVE_AMPLITUDE * 0.3);
    const localSecondaryWave = Math.sin(time * SWIMMING_EFFECTS_CONFIG.WAVE_SECONDARY_FREQUENCY + segmentWaveOffset * 1.7 + Math.PI * 0.4) * (SWIMMING_EFFECTS_CONFIG.WAVE_SECONDARY_AMPLITUDE * 0.4);
    const localTertiaryWave = Math.sin(time * SWIMMING_EFFECTS_CONFIG.WAVE_TERTIARY_FREQUENCY + segmentWaveOffset * 2.3 + Math.PI * 0.8) * (SWIMMING_EFFECTS_CONFIG.WAVE_TERTIARY_AMPLITUDE * 0.6);
    
    // Combine all wave effects
    const totalWaveOffset = primaryWave * 0.4 + secondaryWave * 0.3 + tertiaryWave * 0.3 + 
                          localPrimaryWave + localSecondaryWave + localTertiaryWave;
    
    const y = waterLineY - curveOffset + totalWaveOffset; // Subtract to curve upward
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  
  ctx.stroke();
  
  // Add shimmer highlights on the water line with wave deformation
  if (shimmerIntensity > 0.6) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${(shimmerIntensity - 0.6) * 2.5})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // Add additional shimmer points
    for (let i = 0; i < 3; i++) {
      const shimmerX = leftX + (waterLineWidth * (0.2 + i * 0.3));
      const shimmerProgress = (0.2 + i * 0.3);
      const distanceFromCenter = Math.abs(shimmerProgress - 0.5) * 2;
      const curveOffset = distanceFromCenter * distanceFromCenter * 3;
      const segmentWaveOffset = shimmerProgress * 2 * Math.PI;
      const localWave = Math.sin(time * SWIMMING_EFFECTS_CONFIG.WAVE_FREQUENCY * 2 + segmentWaveOffset) * (SWIMMING_EFFECTS_CONFIG.WAVE_AMPLITUDE * 0.3);
      const shimmerY = waterLineY - curveOffset + primaryWave * 0.4 + localWave;
      
      ctx.fillStyle = `rgba(255, 255, 255, ${shimmerIntensity * 0.8})`;
      ctx.beginPath();
      ctx.arc(shimmerX, shimmerY, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  ctx.restore();
}

/**
 * Simply darkens the bottom half of the sprite below the water line with deformed water line border
 */
function darkenSpriteBottomHalf(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  spriteWidth: number,
  spriteHeight: number,
  currentTimeMs: number
): void {
  // Position water line at waist level
  const spriteTopY = centerY - spriteHeight / 2;
  const waterLineY = spriteTopY + (spriteHeight * SWIMMING_EFFECTS_CONFIG.WATER_LINE_OFFSET);
  const spriteBottomY = centerY + spriteHeight / 2;
  const time = currentTimeMs;
  
  // NOTE: The underwater darkening should be handled in the main sprite rendering
  // by passing swimming state to the sprite renderer and applying color filters there
  // This way it follows the exact sprite shape, not a rectangle
  
  // Now draw the deformed water line border on top, only on existing sprite pixels
  ctx.save();
  
  // Use source-atop so the line only appears on existing sprite pixels
  ctx.globalCompositeOperation = 'source-atop';
  
  // Create complex animated wave effect (same as original water line)
  const primaryWave = Math.sin(time * SWIMMING_EFFECTS_CONFIG.WAVE_FREQUENCY + centerX * 0.01) * SWIMMING_EFFECTS_CONFIG.WAVE_AMPLITUDE;
  const secondaryWave = Math.sin(time * SWIMMING_EFFECTS_CONFIG.WAVE_SECONDARY_FREQUENCY + centerX * 0.02 + Math.PI * 0.3) * SWIMMING_EFFECTS_CONFIG.WAVE_SECONDARY_AMPLITUDE;
  const tertiaryWave = Math.sin(time * SWIMMING_EFFECTS_CONFIG.WAVE_TERTIARY_FREQUENCY + centerX * 0.03 + Math.PI * 0.7) * SWIMMING_EFFECTS_CONFIG.WAVE_TERTIARY_AMPLITUDE;
  const shimmerIntensity = (Math.sin(time * SWIMMING_EFFECTS_CONFIG.SHIMMER_FREQUENCY * 2) + 1) * 0.5;
  
  // Draw the deformed water line only on sprite pixels
  ctx.strokeStyle = `rgba(120, 220, 255, ${0.8 + shimmerIntensity * 0.2})`;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  
  ctx.beginPath();
  
  // Draw curved water line with complex wave deformation (half sprite width)
  const waterLineWidth = spriteWidth * 0.5;
  const leftX = centerX - waterLineWidth / 2;
  const segments = 16; // More segments for smoother deformation
  
  for (let i = 0; i <= segments; i++) {
    const progress = i / segments; // 0 to 1
    const x = leftX + (waterLineWidth * progress);
    
    // Create a subtle curve that dips down in the middle and curves up at the ends
    const distanceFromCenter = Math.abs(progress - 0.5) * 2; // 0 at center, 1 at edges
    const curveOffset = distanceFromCenter * distanceFromCenter * 2; // Subtle curve
    
    // Complex wave deformation with multiple overlapping waves
    const segmentWaveOffset = progress * 2 * Math.PI;
    const localPrimaryWave = Math.sin(time * SWIMMING_EFFECTS_CONFIG.WAVE_FREQUENCY * 2 + segmentWaveOffset) * (SWIMMING_EFFECTS_CONFIG.WAVE_AMPLITUDE * 0.3);
    const localSecondaryWave = Math.sin(time * SWIMMING_EFFECTS_CONFIG.WAVE_SECONDARY_FREQUENCY + segmentWaveOffset * 1.7 + Math.PI * 0.4) * (SWIMMING_EFFECTS_CONFIG.WAVE_SECONDARY_AMPLITUDE * 0.4);
    const localTertiaryWave = Math.sin(time * SWIMMING_EFFECTS_CONFIG.WAVE_TERTIARY_FREQUENCY + segmentWaveOffset * 2.3 + Math.PI * 0.8) * (SWIMMING_EFFECTS_CONFIG.WAVE_TERTIARY_AMPLITUDE * 0.6);
    
    // Combine all wave effects
    const totalWaveOffset = primaryWave * 0.4 + secondaryWave * 0.3 + tertiaryWave * 0.3 + 
                          localPrimaryWave + localSecondaryWave + localTertiaryWave;
    
    const y = waterLineY - curveOffset + totalWaveOffset;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  
  ctx.stroke();
  
  // Add shimmer highlights
  if (shimmerIntensity > 0.6) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${(shimmerIntensity - 0.6) * 2.5})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  
  ctx.restore();
}

/**
 * Draws underwater shadows above the transparency layer
 */
function drawUnderwaterShadow(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  spriteWidth: number,
  spriteHeight: number,
  currentTimeMs: number
): void {
  const spriteTopY = centerY - spriteHeight / 2;
  const waterLineY = spriteTopY + (spriteHeight * SWIMMING_EFFECTS_CONFIG.WATER_LINE_OFFSET);
  const spriteBottomY = centerY + spriteHeight / 2;
  
  ctx.save();
  
  // Create shadow that appears just above the underwater transparency
  const shadowOffsetX = 15;
  const shadowOffsetY = 25;
  const shadowScale = 0.7;
  const shadowAlpha = 0.4;
  
  // Only draw shadow below the water line
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
  
  // Create an elliptical shadow
  ctx.beginPath();
  ctx.ellipse(
    centerX + shadowOffsetX,
    Math.max(waterLineY + 10, centerY + shadowOffsetY), // Ensure shadow is below water line
    (spriteWidth * shadowScale) / 2,
    (spriteHeight * shadowScale * 0.3) / 2, // Flatter shadow
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();
  
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
  
  // REMOVED: Underwater shadow - no longer needed
  // drawUnderwaterShadow(ctx, centerX, centerY, spriteWidth, spriteHeight, currentTimeMs);
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
  
  // Simply darken the bottom half of the sprite with deformed water line border
  darkenSpriteBottomHalf(ctx, centerX, centerY, spriteWidth, spriteHeight, currentTimeMs);
  
  // DISABLED: Draw water line effect over everything - now handled in darkening function
  // drawWaterLine(ctx, centerX, centerY, spriteWidth, spriteHeight, currentTimeMs);
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