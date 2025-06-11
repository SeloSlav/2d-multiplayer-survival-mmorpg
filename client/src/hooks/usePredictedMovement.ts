import { useRef, useEffect, useCallback } from 'react';
import { Reducer, Player, DbConnection } from '../generated';
import { MovementInputState } from './useMovementInput';
import { gameConfig } from '../config/gameConfig';

const MOVEMENT_UPDATE_INTERVAL_MS = 50; // 20 times per second

// 🎯 ANTI-JITTER SYSTEM: Fine-tuned reconciliation
const RECONCILIATION_DEAD_ZONE = 16.0; // Increased from 8px - ignore differences smaller than 16px
const RECONCILIATION_INTERPOLATION_SPEED = 6.0; // Slower, smoother interpolation (was 8.0)
const RECONCILIATION_SNAP_THRESHOLD = 120.0; // Higher threshold before snapping (was 100.0)

// 🚧 COLLISION HANDLING: Simplified approach
const COLLISION_DETECTION_THRESHOLD = 80.0; // Higher threshold - only detect major collisions
const POST_COLLISION_GRACE_PERIOD_MS = 300; // Shorter grace period
const POST_COLLISION_DEAD_ZONE_MULTIPLIER = 2.0; // Less aggressive multiplier

// 🔍 DEBUG: Measure prediction accuracy
const ENABLE_PREDICTION_LOGGING = true;
const LOG_INTERVAL_MS = 2000; // Log every 2 seconds

interface PredictedMovementProps {
  connection: DbConnection | null;
  localPlayer: Player | undefined | null;
  inputState: MovementInputState;
}

export const usePredictedMovement = ({ connection, localPlayer, inputState }: PredictedMovementProps) => {
  // Position tracking
  const renderPositionRef = useRef<{ x: number; y: number } | null>(null);
  const lastServerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const movementIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // 🔍 Prediction accuracy tracking
  const predictionErrorsRef = useRef<number[]>([]);
  const lastLogTimeRef = useRef<number>(0);

  // 🏃 Sprint state tracking
  const lastSprintStateRef = useRef<boolean>(false);
  const sprintTransitionTimeRef = useRef<number>(0);

  // 🚧 Collision detection tracking
  const lastCollisionTimeRef = useRef<number>(0);
  const lastPredictionErrorRef = useRef<number>(0);

  // Initialize render position from server position
  useEffect(() => {
    if (localPlayer && !renderPositionRef.current) {
      renderPositionRef.current = { x: localPlayer.positionX, y: localPlayer.positionY };
      lastServerPositionRef.current = { x: localPlayer.positionX, y: localPlayer.positionY };
      console.log('🎯 Initialized prediction system at:', localPlayer.positionX, localPlayer.positionY);
    }
  }, [localPlayer]);

  // Server reconciliation with anti-jitter logic
  useEffect(() => {
    if (!localPlayer || !renderPositionRef.current) return;

    const serverPos = { x: localPlayer.positionX, y: localPlayer.positionY };
    const renderPos = renderPositionRef.current;
    
    // Calculate pixel difference
    const deltaX = serverPos.x - renderPos.x;
    const deltaY = serverPos.y - renderPos.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // 🔍 Track prediction accuracy
    if (ENABLE_PREDICTION_LOGGING) {
      predictionErrorsRef.current.push(distance);
      
      const now = Date.now();
      if (now - lastLogTimeRef.current > LOG_INTERVAL_MS) {
        const errors = predictionErrorsRef.current;
        if (errors.length > 0) {
          const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
          const maxError = Math.max(...errors);
          console.log(`🔍 Prediction Analysis - Avg Error: ${avgError.toFixed(1)}px, Max Error: ${maxError.toFixed(1)}px, Samples: ${errors.length}`);
        }
        predictionErrorsRef.current = [];
        lastLogTimeRef.current = now;
      }
    }

    // 🎯 ANTI-JITTER: Dead zone - ignore tiny differences
    // 🏃 Use larger dead zone during sprint transitions to reduce jitter
    const timeSinceSprintTransition = Date.now() - sprintTransitionTimeRef.current;
    const isInSprintTransition = timeSinceSprintTransition < 200; // 200ms grace period
    
    // 🚧 Detect potential collision (simple approach)
    const isLikelyCollision = distance > COLLISION_DETECTION_THRESHOLD;
    const timeSinceCollision = Date.now() - lastCollisionTimeRef.current;
    const isInPostCollisionPeriod = timeSinceCollision < POST_COLLISION_GRACE_PERIOD_MS;
    
    if (isLikelyCollision) {
      lastCollisionTimeRef.current = Date.now();
      console.log(`🚧 Collision detected! Error: ${distance.toFixed(1)}px`);
    }
    
    // Calculate adaptive dead zone
    let currentDeadZone = RECONCILIATION_DEAD_ZONE;
    if (isInSprintTransition) currentDeadZone *= 3; // Sprint transition
    if (isInPostCollisionPeriod) currentDeadZone *= POST_COLLISION_DEAD_ZONE_MULTIPLIER; // Post-collision
    
    lastPredictionErrorRef.current = distance; // Track for next comparison
    
    if (distance <= currentDeadZone) {
      // Update last server position but don't move render position
      lastServerPositionRef.current = { ...serverPos };
      return;
    }

    // 🎯 ANTI-JITTER: Snap for very large differences, interpolate for others
    if (distance > RECONCILIATION_SNAP_THRESHOLD) {
      console.log(`⚡️ Snapping due to large error: ${distance.toFixed(1)}px`);
      renderPositionRef.current = { ...serverPos };
    } else {
      // Smooth interpolation towards server position
      const baseSpeed = isInPostCollisionPeriod ? RECONCILIATION_INTERPOLATION_SPEED * 0.7 : RECONCILIATION_INTERPOLATION_SPEED;
      const interpolationFactor = Math.min(1.0, baseSpeed * (MOVEMENT_UPDATE_INTERVAL_MS / 1000));
      renderPositionRef.current = {
        x: renderPos.x + deltaX * interpolationFactor,
        y: renderPos.y + deltaY * interpolationFactor,
      };
    }

    lastServerPositionRef.current = { ...serverPos };
  }, [localPlayer?.positionX, localPlayer?.positionY]);

  // Client-side movement prediction
  const updateMovement = useCallback(() => {
    if (!connection || !renderPositionRef.current || !localPlayer) return;

    const { direction, sprinting } = inputState;
    
    // 🏃 Send sprint state changes to server
    if (sprinting !== lastSprintStateRef.current) {
      connection.reducers.setSprinting(sprinting);
      lastSprintStateRef.current = sprinting;
      sprintTransitionTimeRef.current = Date.now(); // Mark transition time
    }
    
    // No movement - no prediction needed
    if (direction.x === 0 && direction.y === 0) return;

    // Use the normalized direction from the input state
    const deltaX = direction.x;
    const deltaY = direction.y;

    // Apply speed multipliers
    let speed = gameConfig.playerSpeed;
    if (sprinting) speed *= gameConfig.sprintMultiplier;

    // Calculate distance moved this frame
    const deltaTime = MOVEMENT_UPDATE_INTERVAL_MS / 1000; // Convert to seconds
    const moveDistance = speed * deltaTime;

    // Apply movement to render position
    const newX = renderPositionRef.current.x + deltaX * moveDistance;
    const newY = renderPositionRef.current.y + deltaY * moveDistance;

    // World boundary checks
    const clampedX = Math.max(0, Math.min(gameConfig.worldWidthPx - gameConfig.spriteWidth, newX));
    const clampedY = Math.max(0, Math.min(gameConfig.worldHeightPx - gameConfig.spriteHeight, newY));

    renderPositionRef.current = { x: clampedX, y: clampedY };

    // Send movement to server - using the correct reducer name
    connection.reducers.updatePlayerPosition(deltaX, deltaY);
  }, [connection, inputState, localPlayer]);

  // Movement update loop
  useEffect(() => {
    if (movementIntervalRef.current) {
      clearInterval(movementIntervalRef.current);
    }

    movementIntervalRef.current = setInterval(updateMovement, MOVEMENT_UPDATE_INTERVAL_MS);

    return () => {
      if (movementIntervalRef.current) {
        clearInterval(movementIntervalRef.current);
      }
    };
  }, [updateMovement]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (movementIntervalRef.current) {
        clearInterval(movementIntervalRef.current);
      }
    };
  }, []);

  return {
    predictedPosition: renderPositionRef.current,
  };
}; 