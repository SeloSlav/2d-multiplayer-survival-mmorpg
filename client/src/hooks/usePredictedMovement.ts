import { useRef, useEffect, useCallback } from 'react';
import { Reducer, Player, DbConnection } from '../generated';
import { MovementInputState } from './useMovementInput';

const MOVEMENT_UPDATE_INTERVAL_MS = 50; // 20 times per server

// NUCLEAR OPTION: Zero-lag movement
const ZERO_LAG_MODE = true; // True = instant snap, False = smooth interpolation
const ULTRA_FAST_INTERPOLATION = 200.0; // For smooth mode (10x faster than before)

interface PredictedMovementProps {
  connection: DbConnection | null;
  localPlayer: Player | undefined | null;
  inputState: MovementInputState;
}

export const usePredictedMovement = ({ connection, localPlayer, inputState }: PredictedMovementProps) => {
  // Position tracking
  const renderPositionRef = useRef({ x: 0, y: 0 }); // Visual position
  const targetPositionRef = useRef({ x: 0, y: 0 }); // Server position
  
  const lastUpdateTimeRef = useRef(performance.now());
  const lastMovementUpdateTimeRef = useRef(performance.now());
  const lastSprintStateRef = useRef<boolean>(false);
  const animationFrameIdRef = useRef<number | null>(null);
  
  // Minimal tracking
  const frameCountRef = useRef(0);
  const lastDiagnosticLogRef = useRef(performance.now());
  
  // Stable refs
  const connectionRef = useRef(connection);
  const inputStateRef = useRef(inputState);
  const localPlayerRef = useRef(localPlayer);

  // Update refs when dependencies change
  useEffect(() => {
    connectionRef.current = connection;
    inputStateRef.current = inputState;
    localPlayerRef.current = localPlayer;
  }, [connection, inputState, localPlayer]);

  // Initialize positions when player loads
  useEffect(() => {
    if (localPlayer && localPlayer.identity) {
      const currentPos = { x: localPlayer.positionX, y: localPlayer.positionY };
      
      // Only reset on significant position changes (teleport/respawn)
      const isSignificantChange = !targetPositionRef.current || 
                                 Math.abs(targetPositionRef.current.x - currentPos.x) > 500 ||
                                 Math.abs(targetPositionRef.current.y - currentPos.y) > 500;
      
      if (isSignificantChange) {
        targetPositionRef.current = currentPos;
        renderPositionRef.current = currentPos; // Instant sync
        lastUpdateTimeRef.current = performance.now();
        
        console.log('[ZERO LAG] Player position initialized - INSTANT SYNC');
      }
    }
  }, [localPlayer?.identity?.toHexString()]);

  // ZERO-LAG UPDATE FUNCTION
  const update = useCallback(() => {
    const localPlayer = localPlayerRef.current;
    const inputState = inputStateRef.current;
    const connection = connectionRef.current;
    
    if (!localPlayer) return;

    const now = performance.now();
    const deltaMs = now - lastUpdateTimeRef.current;
    const deltaSeconds = Math.min(deltaMs / 1000, 0.033); // Cap at 33ms
    lastUpdateTimeRef.current = now;

    const { direction, sprinting } = inputState;

    // 1. Send input to server
    if (connection?.reducers) {
      if (now - lastMovementUpdateTimeRef.current > MOVEMENT_UPDATE_INTERVAL_MS) {
        if (direction.x !== 0 || direction.y !== 0) {
          setTimeout(() => {
            connection.reducers.updatePlayerPosition(direction.x, direction.y);
          }, 0);
        }
        lastMovementUpdateTimeRef.current = now;
      }

      // Sprint state
      if (sprinting !== lastSprintStateRef.current) {
        setTimeout(() => {
          connection.reducers.setSprinting(sprinting);
        }, 0);
        lastSprintStateRef.current = sprinting;
      }
    }

    // 2. ZERO-LAG MOVEMENT SYSTEM
    const renderPos = renderPositionRef.current;
    const targetPos = targetPositionRef.current;
    
    if (ZERO_LAG_MODE) {
      // NUCLEAR OPTION: Instant snap to server position
      renderPos.x = targetPos.x;
      renderPos.y = targetPos.y;
    } else {
      // ULTRA-FAST INTERPOLATION as fallback
      const dx = targetPos.x - renderPos.x;
      const dy = targetPos.y - renderPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > 0.1) {
        const factor = 1 - Math.exp(-ULTRA_FAST_INTERPOLATION * deltaSeconds);
        renderPos.x += dx * factor;
        renderPos.y += dy * factor;
      } else {
        renderPos.x = targetPos.x;
        renderPos.y = targetPos.y;
      }
    }

    // Pixel-perfect rendering
    renderPos.x = Math.round(renderPos.x);
    renderPos.y = Math.round(renderPos.y);

    // Minimal diagnostic logging
    frameCountRef.current++;
    if (frameCountRef.current % 300 === 0) { // Every 5 seconds at 60fps
      const now = performance.now();
      if (now - lastDiagnosticLogRef.current > 6000) { // Every 6 seconds
        lastDiagnosticLogRef.current = now;
        
        const lagDistance = Math.sqrt(
          Math.pow(renderPos.x - targetPos.x, 2) + 
          Math.pow(renderPos.y - targetPos.y, 2)
        );
        
        console.log(`[ZERO LAG] Status: ${ZERO_LAG_MODE ? 'INSTANT SNAP' : 'ULTRA FAST'} | Lag: ${lagDistance.toFixed(1)}px`);
      }
    }

  }, []);

  // Start animation loop
  useEffect(() => {
    const animate = () => {
      update();
      animationFrameIdRef.current = requestAnimationFrame(animate);
    };
    
    if (localPlayer) {
      animationFrameIdRef.current = requestAnimationFrame(animate);
    }
    
    return () => {
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
    };
  }, [localPlayer, update]);

  // Server position updates - INSTANT SYNC
  useEffect(() => {
    if (localPlayer) {
      const serverPos = { x: localPlayer.positionX, y: localPlayer.positionY };
      
      // Update target position immediately
      targetPositionRef.current = serverPos;
      
      // In ZERO_LAG_MODE, also update render position immediately
      if (ZERO_LAG_MODE) {
        renderPositionRef.current = { ...serverPos };
      }
    }
  }, [localPlayer?.positionX, localPlayer?.positionY]);

  return {
    predictedPosition: renderPositionRef.current, // ZERO-LAG position
  };
}; 