import { useRef, useCallback } from 'react';
import { Player } from '../generated';

const INTERPOLATION_SPEED = 8.0; // Tuned to match local player smoothness

interface RemotePlayerState {
  lastServerPosition: { x: number; y: number };
  currentDisplayPosition: { x: number; y: number };
  targetPosition: { x: number; y: number };
  lastUpdateTime: number;
}

export const useRemotePlayerInterpolation = () => {
  const remotePlayerStates = useRef<Map<string, RemotePlayerState>>(new Map());
  const lastFrameTime = useRef<number>(performance.now());

  const updateAndGetSmoothedPosition = useCallback((player: Player, localPlayerId?: string): { x: number; y: number } => {
    const playerId = player.identity.toHexString();
    
    // Don't interpolate the local player - they use the prediction system
    if (localPlayerId && playerId === localPlayerId) {
      return { x: player.positionX, y: player.positionY };
    }

    const currentTime = performance.now();
    const deltaTime = (currentTime - lastFrameTime.current) / 1000; // Convert to seconds
    lastFrameTime.current = currentTime;

    const serverPosition = { x: player.positionX, y: player.positionY };
    let state = remotePlayerStates.current.get(playerId);

    if (!state) {
      // First time seeing this player - initialize at their server position
      state = {
        lastServerPosition: serverPosition,
        currentDisplayPosition: serverPosition,
        targetPosition: serverPosition,
        lastUpdateTime: currentTime,
      };
      remotePlayerStates.current.set(playerId, state);
      return serverPosition;
    }

    // Check if server position changed (new update received)
    const positionChanged = 
      Math.abs(serverPosition.x - state.lastServerPosition.x) > 0.01 ||
      Math.abs(serverPosition.y - state.lastServerPosition.y) > 0.01;

    if (positionChanged) {
      // New server update received - start interpolating to new position
      state.lastServerPosition = serverPosition;
      state.targetPosition = serverPosition;
      state.lastUpdateTime = currentTime;
    }

    // Smoothly interpolate towards target position using exponential decay
    const interpolationFactor = 1 - Math.exp(-INTERPOLATION_SPEED * deltaTime);
    
    state.currentDisplayPosition.x += 
      (state.targetPosition.x - state.currentDisplayPosition.x) * interpolationFactor;
    state.currentDisplayPosition.y += 
      (state.targetPosition.y - state.currentDisplayPosition.y) * interpolationFactor;

    // Round to integers for pixel-perfect rendering (matches local player)
    return {
      x: Math.round(state.currentDisplayPosition.x),
      y: Math.round(state.currentDisplayPosition.y)
    };
  }, []);

  const cleanupPlayer = useCallback((playerId: string) => {
    remotePlayerStates.current.delete(playerId);
  }, []);

  return {
    updateAndGetSmoothedPosition,
    cleanupPlayer
  };
}; 