import { useRef, useEffect, useCallback } from 'react';
import { Reducer, Player, DbConnection } from '../generated';
import { MovementInputState } from './useMovementInput';
import { gameConfig } from '../config/gameConfig';

const MOVEMENT_UPDATE_INTERVAL_MS = 50; // 20 times per second

// 🎯 ANTI-JITTER SYSTEM: Fine-tuned reconciliation
const RECONCILIATION_DEAD_ZONE = 8.0; // Ignore differences smaller than 8 pixels (prevents micro-jittering)
const RECONCILIATION_INTERPOLATION_SPEED = 8.0; // Slower, smoother interpolation (was 20.0)
const RECONCILIATION_SNAP_THRESHOLD = 100.0; // Snap if off by more than 100px (was 150.0)

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
    if (distance <= RECONCILIATION_DEAD_ZONE) {
      // Update last server position but don't move render position
      lastServerPositionRef.current = { ...serverPos };
      return;
    }

    // 🎯 ANTI-JITTER: Snap for large differences, interpolate for medium ones
    if (distance > RECONCILIATION_SNAP_THRESHOLD) {
      console.log(`⚡️ Snapping due to large error: ${distance.toFixed(1)}px`);
      renderPositionRef.current = { ...serverPos };
    } else {
      // Smooth interpolation towards server position
      const interpolationFactor = Math.min(1.0, RECONCILIATION_INTERPOLATION_SPEED * (MOVEMENT_UPDATE_INTERVAL_MS / 1000));
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