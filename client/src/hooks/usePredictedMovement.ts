import { useRef, useEffect, useCallback } from 'react';
import { Reducer, Player, DbConnection } from '../generated';
import { MovementInputState } from './useMovementInput';

const MOVEMENT_UPDATE_INTERVAL_MS = 50; // 20 times per second
const PLAYER_SPEED = 250; // pixels per second
const SPRINT_MULTIPLIER = 1.75;
const INTERPOLATION_SPEED = 15.0; // Higher = more responsive, lower = smoother

interface PredictedMovementProps {
  connection: DbConnection | null;
  localPlayer: Player | undefined | null;
  inputState: MovementInputState;
}

export const usePredictedMovement = ({ connection, localPlayer, inputState }: PredictedMovementProps) => {
  const predictedPositionRef = useRef({ x: 0, y: 0 });
  const renderPositionRef = useRef({ x: 0, y: 0 }); // New ref for smooth rendering
  const lastUpdateTimeRef = useRef(performance.now());
  const lastServerUpdateTimeRef = useRef(performance.now());

  // Initialize predicted position with the server position when the player loads.
  useEffect(() => {
    if (localPlayer) {
      predictedPositionRef.current = { x: localPlayer.positionX, y: localPlayer.positionY };
      renderPositionRef.current = { x: localPlayer.positionX, y: localPlayer.positionY }; // Initialize render position
      lastUpdateTimeRef.current = performance.now();
    }
  }, [localPlayer]);

  // The main prediction loop, called every frame.
  const update = useCallback(() => {
    if (!localPlayer) return;

    const now = performance.now();
    const deltaSeconds = (now - lastUpdateTimeRef.current) / 1000;
    lastUpdateTimeRef.current = now;

    const { direction, sprinting } = inputState;

    // 1. Update the raw predicted position based on input
    if (direction.x !== 0 || direction.y !== 0) {
        const currentSpeed = PLAYER_SPEED * (sprinting ? SPRINT_MULTIPLIER : 1);
        predictedPositionRef.current.x += direction.x * currentSpeed * deltaSeconds;
        predictedPositionRef.current.y += direction.y * currentSpeed * deltaSeconds;
    }

    // 2. Smoothly interpolate the render position towards the predicted position using frame-rate independent exponential decay
    const interpolationFactor = 1 - Math.exp(-INTERPOLATION_SPEED * deltaSeconds);
    renderPositionRef.current.x += (predictedPositionRef.current.x - renderPositionRef.current.x) * interpolationFactor;
    renderPositionRef.current.y += (predictedPositionRef.current.y - renderPositionRef.current.y) * interpolationFactor;

    // 3. Send updates to the server at a fixed interval.
    if (now - lastServerUpdateTimeRef.current > MOVEMENT_UPDATE_INTERVAL_MS) {
      if ((direction.x !== 0 || direction.y !== 0) && connection?.reducers) {
        connection.reducers.updatePlayerPosition(direction.x, direction.y);
      }
      lastServerUpdateTimeRef.current = now;
    }

  }, [localPlayer, inputState, connection]);

  // Server Reconciliation (simple version)
  // This effect runs when the authoritative server state for the player changes.
  useEffect(() => {
    if (localPlayer) {
      const serverPos = { x: localPlayer.positionX, y: localPlayer.positionY };
      const predictedPos = predictedPositionRef.current;

      // For now, we will just log the difference. A more advanced implementation
      // would smoothly interpolate or replay inputs.
      const dx = Math.abs(serverPos.x - predictedPos.x);
      const dy = Math.abs(serverPos.y - predictedPos.y);
      if(dx > 50 || dy > 50) { // If the discrepancy is large, log it.
        // console.warn(`Reconciliation needed. Server: (${serverPos.x}, ${serverPos.y}), Client: (${predictedPos.x}, ${predictedPos.y})`);
        // On large discrepancy, snap both predicted and render positions to the authoritative server state.
        predictedPositionRef.current = serverPos;
        renderPositionRef.current = serverPos;
      }
    }
  }, [localPlayer?.positionX, localPlayer?.positionY]);


  return {
    predictedPosition: renderPositionRef.current, // Return the smooth position for rendering
    updatePredictedMovement: update,
  };
}; 