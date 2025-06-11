import { useRef, useEffect, useCallback } from 'react';
import { Reducer, Player, DbConnection } from '../generated';
import { MovementInputState } from './useMovementInput';
import { gameConfig } from '../config/gameConfig';

const MOVEMENT_UPDATE_INTERVAL_MS = 50; // 20 times per second

// Client-side prediction is now the default.
// The old "ZERO_LAG_MODE" was actually just server reconciliation without prediction.
const RECONCILIATION_INTERPOLATION_SPEED = 20.0; // How quickly to interpolate to the server's position. Higher is faster.
const RECONCILIATION_SNAP_THRESHOLD = 150.0; // If prediction is off by more than this many pixels, snap instantly.

interface PredictedMovementProps {
  connection: DbConnection | null;
  localPlayer: Player | undefined | null;
  inputState: MovementInputState;
}

export const usePredictedMovement = ({ connection, localPlayer, inputState }: PredictedMovementProps) => {
  // Position tracking
  const renderPositionRef = useRef({ x: 0, y: 0 }); // Visual position (what the player sees)
  const serverPositionRef = useRef({ x: 0, y: 0 }); // Authoritative server position
  
  const lastUpdateTimeRef = useRef(performance.now());
  const lastMovementUpdateTimeRef = useRef(performance.now());
  const lastSprintStateRef = useRef<boolean>(false);
  const animationFrameIdRef = useRef<number | null>(null);
  
  // Stable refs for use in the animation loop
  const connectionRef = useRef(connection);
  const inputStateRef = useRef(inputState);
  const localPlayerRef = useRef(localPlayer);

  // Update refs when dependencies change
  useEffect(() => {
    connectionRef.current = connection;
    inputStateRef.current = inputState;
    localPlayerRef.current = localPlayer;
  }, [connection, inputState, localPlayer]);

  // Initialize positions when player loads or respawns
  useEffect(() => {
    if (localPlayer) {
      const serverPos = { x: localPlayer.positionX, y: localPlayer.positionY };
      // On first load or major change (like respawn), snap both render and server positions
      const isSignificantChange = !serverPositionRef.current.x || 
                                 Math.abs(serverPositionRef.current.x - serverPos.x) > 500 ||
                                 Math.abs(serverPositionRef.current.y - serverPos.y) > 500;
      
      if (isSignificantChange) {
        console.log(`[Prediction] Player position initialized/reset to (${serverPos.x}, ${serverPos.y})`);
        serverPositionRef.current = serverPos;
        renderPositionRef.current = serverPos;
        lastUpdateTimeRef.current = performance.now();
      } else {
        // For normal updates, just update the server position target
        serverPositionRef.current = serverPos;
      }
    }
  }, [localPlayer?.positionX, localPlayer?.positionY, localPlayer?.identity.toHexString()]);

  // The main prediction and reconciliation loop
  const update = useCallback(() => {
    const localPlayer = localPlayerRef.current;
    const inputState = inputStateRef.current;
    const connection = connectionRef.current;
    
    if (!localPlayer || !connection?.reducers) {
      animationFrameIdRef.current = requestAnimationFrame(update);
      return;
    }

    const now = performance.now();
    const deltaSeconds = Math.min((now - lastUpdateTimeRef.current) / 1000, 0.05); // Cap delta time
    lastUpdateTimeRef.current = now;

    const { direction, sprinting } = inputState;

    // --- 1. Client-Side Prediction ---
    // Immediately move the player on the client based on input.
    if (direction.x !== 0 || direction.y !== 0) {
      let speed = gameConfig.playerSpeed;
      if (sprinting) speed *= gameConfig.sprintMultiplier;
      if (localPlayer.isCrouching) speed *= gameConfig.crouchMultiplier;
      // Note: We don't predict water/stat penalties client-side to keep it simple.
      // The server will correct for these.

      const moveMagnitude = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
      const normalizedMoveX = direction.x / moveMagnitude;
      const normalizedMoveY = direction.y / moveMagnitude;

      const displacementX = normalizedMoveX * speed * deltaSeconds;
      const displacementY = normalizedMoveY * speed * deltaSeconds;

      renderPositionRef.current.x += displacementX;
      renderPositionRef.current.y += displacementY;

      // Clamp to world bounds to prevent predicting movement off the map
      renderPositionRef.current.x = Math.max(0, Math.min(gameConfig.worldWidthPx, renderPositionRef.current.x));
      renderPositionRef.current.y = Math.max(0, Math.min(gameConfig.worldHeightPx, renderPositionRef.current.y));
    }

    // --- 2. Server Reconciliation ---
    // Gently pull the rendered position towards the authoritative server position.
    const renderPos = renderPositionRef.current;
    const serverPos = serverPositionRef.current;
    
    const dx = serverPos.x - renderPos.x;
    const dy = serverPos.y - renderPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > RECONCILIATION_SNAP_THRESHOLD) {
      // If the difference is huge (e.g., collision, teleport), just snap.
      renderPos.x = serverPos.x;
      renderPos.y = serverPos.y;
    } else if (distance > 0.1) {
      // Otherwise, smoothly interpolate towards the server's position.
      // This corrects for prediction errors gracefully.
      const factor = 1 - Math.exp(-RECONCILIATION_INTERPOLATION_SPEED * deltaSeconds);
      renderPos.x += dx * factor;
      renderPos.y += dy * factor;
    }

    // --- 3. Send Input to Server ---
    // This happens independently of prediction.
    if (now - lastMovementUpdateTimeRef.current > MOVEMENT_UPDATE_INTERVAL_MS) {
      if (direction.x !== 0 || direction.y !== 0) {
        // Use a non-blocking timeout to send the reducer call
        setTimeout(() => connection.reducers.updatePlayerPosition(direction.x, direction.y), 0);
      }
      lastMovementUpdateTimeRef.current = now;
    }

    // Send sprint state changes
    if (sprinting !== lastSprintStateRef.current) {
      setTimeout(() => connection.reducers.setSprinting(sprinting), 0);
      lastSprintStateRef.current = sprinting;
    }
    
    animationFrameIdRef.current = requestAnimationFrame(update);
  }, []);

  // Start/stop the animation loop
  useEffect(() => {
    const animate = () => {
      update();
    };
    
    animationFrameIdRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [update]);

  return {
    predictedPosition: renderPositionRef.current,
  };
}; 