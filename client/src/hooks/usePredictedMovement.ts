import { useRef, useEffect, useCallback } from 'react';
import { Reducer, Player, DbConnection } from '../generated';
import { MovementInputState } from './useMovementInput';

const MOVEMENT_UPDATE_INTERVAL_MS = 50; // 20 times per second
const PLAYER_SPEED = 250; // pixels per second
const SPRINT_MULTIPLIER = 1.75;
const INTERPOLATION_SPEED = 8.0; // Tuned for smooth, seamless movement

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
  const lastSprintStateRef = useRef<boolean>(false); // Track last sent sprint state
  const frameCountRef = useRef(0);
  const animationFrameIdRef = useRef<number | null>(null);
  
  // NEW: Track movement startup to avoid reconciliation lag on first movement
  const firstMovementSentRef = useRef<number | null>(null); // Timestamp of first movement sent
  const MOVEMENT_STARTUP_GRACE_PERIOD_MS = 300; // Avoid reconciliation for 300ms after first movement
  
  // Stable refs to avoid recreating the update function
  const connectionRef = useRef(connection);
  const inputStateRef = useRef(inputState);
  const localPlayerRef = useRef(localPlayer);
  
  // Cache for expensive calculations to reduce per-frame work
  const mathCacheRef = useRef({
    lastDelta: 0,
    cachedInterpolationFactor: 0,
    lastLogTime: 0, // Throttle render jump logging
    lastFrameDropLogTime: 0, // Throttle frame drop logging
    lastMemoryCheck: 0,
    frameCount: 0,
  });

  // Update refs when dependencies change
  useEffect(() => {
    connectionRef.current = connection;
    inputStateRef.current = inputState;
    localPlayerRef.current = localPlayer;
  }, [connection, inputState, localPlayer]);

  // Initialize predicted position when the player loads
  useEffect(() => {
    if (localPlayer) {
      predictedPositionRef.current = { x: localPlayer.positionX, y: localPlayer.positionY };
      renderPositionRef.current = { x: localPlayer.positionX, y: localPlayer.positionY };
      lastUpdateTimeRef.current = performance.now();
      
      // NEW: Reset movement startup tracking when player changes (respawn, reconnect, etc.)
      firstMovementSentRef.current = null;
      console.log('[MOVEMENT STARTUP] Player loaded, resetting movement tracking');
    }
  }, [localPlayer]);

  // Stable update function that doesn't recreate on every prop change
  const update = useCallback(() => {
    const localPlayer = localPlayerRef.current;
    const inputState = inputStateRef.current;
    const connection = connectionRef.current;
    
    if (!localPlayer) return;

    const now = performance.now();
    const deltaMs = now - lastUpdateTimeRef.current;
    const deltaSeconds = deltaMs / 1000;
    lastUpdateTimeRef.current = now;

    // Only log significant frame drops that could cause stuttering with detailed timing
    if (deltaMs > 30) { // Worse than 33fps
      console.log(`[FRAME DROP] Long frame: ${deltaMs.toFixed(1)}ms (${(1000/deltaMs).toFixed(1)} FPS)`);
    }

    // Profile different sections of the update function
    let sectionStart = performance.now();

    const { direction, sprinting } = inputState;

    // 1. Simple sprint prediction - just match server's actual sprint multiplier
    // If player has very low stamina, don't apply sprint multiplier even if client thinks it's sprinting
    const playerStamina = localPlayer.stamina || 0;
    const effectiveSprinting = sprinting && playerStamina > 0; // Simple: only sprint if we have stamina

    // 1. Update the raw predicted position based on input
    if (direction.x !== 0 || direction.y !== 0) {
        const currentSpeed = PLAYER_SPEED * (effectiveSprinting ? SPRINT_MULTIPLIER : 1);
        predictedPositionRef.current.x += direction.x * currentSpeed * deltaSeconds;
        predictedPositionRef.current.y += direction.y * currentSpeed * deltaSeconds;
    }
    
    const movementTime = performance.now() - sectionStart;
    if (movementTime > 1) console.log(`[PERF] Movement calculation: ${movementTime.toFixed(2)}ms`);
    sectionStart = performance.now();

    // 2. Smoothly interpolate the render position towards the predicted position using frame-rate independent exponential decay
    const oldRenderPos = { x: renderPositionRef.current.x, y: renderPositionRef.current.y };
    
    // Optimize: clamp deltaSeconds to avoid extreme values that cause performance issues
    const clampedDelta = Math.min(deltaSeconds, 0.1); // Max 100ms delta
    
    // Cache expensive Math.exp calculation if delta hasn't changed much
    const mathCache = mathCacheRef.current;
    let interpolationFactor;
    if (Math.abs(clampedDelta - mathCache.lastDelta) < 0.001) {
      // Reuse cached value if delta is very similar (within 1ms)
      interpolationFactor = mathCache.cachedInterpolationFactor;
    } else {
      // Calculate new value and cache it
      interpolationFactor = 1 - Math.exp(-INTERPOLATION_SPEED * clampedDelta);
      mathCache.lastDelta = clampedDelta;
      mathCache.cachedInterpolationFactor = interpolationFactor;
    }
    
    const renderPos = renderPositionRef.current;
    const predictedPos = predictedPositionRef.current;
    
    renderPos.x += (predictedPos.x - renderPos.x) * interpolationFactor;
    renderPos.y += (predictedPos.y - renderPos.y) * interpolationFactor;

        // 3. Round to integers for pixel-perfect rendering (eliminates subpixel blur)
    renderPos.x = Math.round(renderPos.x);
    renderPos.y = Math.round(renderPos.y);
    
    const interpolationTime = performance.now() - sectionStart;
    if (interpolationTime > 1) console.log(`[PERF] Interpolation: ${interpolationTime.toFixed(2)}ms`);
    sectionStart = performance.now();
    
    // 4. Check for sudden render position changes that might cause stuttering (throttled)
    const dx = renderPos.x - oldRenderPos.x;
    const dy = renderPos.y - oldRenderPos.y;
    const renderDeltaSq = dx * dx + dy * dy; // Avoid sqrt unless needed
    if (renderDeltaSq > 25 && (now - mathCache.lastLogTime) > 500) { // Only log significant jumps every 500ms
       const renderDelta = Math.sqrt(renderDeltaSq);
       console.log(`[RENDER JUMP] Render position moved ${renderDelta.toFixed(2)}px in ${(clampedDelta * 1000).toFixed(1)}ms`);
       mathCache.lastLogTime = now;
     }

    const renderCheckTime = performance.now() - sectionStart;
    if (renderCheckTime > 1) console.log(`[PERF] Render check: ${renderCheckTime.toFixed(2)}ms`);
    sectionStart = performance.now();

    // 4. Send updates to the server at a fixed interval (async to avoid blocking)
    if (now - lastServerUpdateTimeRef.current > MOVEMENT_UPDATE_INTERVAL_MS) {
      if ((direction.x !== 0 || direction.y !== 0) && connection?.reducers) {
        // NEW: Mark first movement timestamp for reconciliation grace period
        if (firstMovementSentRef.current === null) {
          firstMovementSentRef.current = now;
          console.log('[MOVEMENT STARTUP] First movement sent, starting grace period');
        }
        
        // Use setTimeout to make this async and not block the frame
        setTimeout(() => {
          connection.reducers.updatePlayerPosition(direction.x, direction.y);
        }, 0);
      }
      lastServerUpdateTimeRef.current = now;
    }

    // 5. Send sprinting state changes immediately when they occur (async)
    if (connection?.reducers && effectiveSprinting !== lastSprintStateRef.current) {
      // Use setTimeout to make this async and not block the frame
      setTimeout(() => {
        connection.reducers.setSprinting(effectiveSprinting);
      }, 0);
      lastSprintStateRef.current = effectiveSprinting;
    }
    
    const networkTime = performance.now() - sectionStart;
    if (networkTime > 1) console.log(`[PERF] Network calls: ${networkTime.toFixed(2)}ms`);

    // Final performance check
    const totalTime = performance.now() - now;
    if (totalTime > 5) {
      console.log(`[PERF] TOTAL UPDATE TIME: ${totalTime.toFixed(2)}ms (Movement: ${movementTime.toFixed(2)}ms, Interpolation: ${interpolationTime.toFixed(2)}ms, Render: ${renderCheckTime.toFixed(2)}ms, Network: ${networkTime.toFixed(2)}ms)`);
    }

    // Periodic memory usage check
    const cache = mathCacheRef.current;
    cache.frameCount++;
    if (cache.frameCount % 300 === 0 && 'memory' in performance) { // Every 5 seconds at 60fps
      const memInfo = (performance as any).memory;
      console.log(`[MEMORY] Used: ${(memInfo.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB, Total: ${(memInfo.totalJSHeapSize / 1024 / 1024).toFixed(1)}MB, Limit: ${(memInfo.jsHeapSizeLimit / 1024 / 1024).toFixed(1)}MB`);
    }

  }, []); // Empty deps - uses refs for stable function

  // Start the animation loop - only restart when player loads/unloads
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
  }, [localPlayer, update]); // update is now stable due to empty deps

  // Server Reconciliation (gentle version)
  // This effect runs when the authoritative server state for the player changes.
  useEffect(() => {
    if (localPlayer) {
      const serverPos = { x: localPlayer.positionX, y: localPlayer.positionY };
      const predictedPos = predictedPositionRef.current;
      const renderPos = renderPositionRef.current;

      // Calculate discrepancy
      const dx = Math.abs(serverPos.x - predictedPos.x);
      const dy = Math.abs(serverPos.y - predictedPos.y);
      const discrepancy = Math.sqrt(dx * dx + dy * dy);
      
      // NEW: Check if we're in movement startup grace period
      const now = performance.now();
      const isInGracePeriod = firstMovementSentRef.current !== null && 
                              (now - firstMovementSentRef.current) < MOVEMENT_STARTUP_GRACE_PERIOD_MS;
      
      // Simple check: skip small corrections if sprint state just changed (reduces camera snapping)
      const sprintJustChanged = localPlayer.isSprinting !== lastSprintStateRef.current;
      
      if (isInGracePeriod && discrepancy > 10 && discrepancy < 80) {
        // During grace period, skip gentle corrections to prevent startup lag
        console.log(`[MOVEMENT STARTUP] Skipping reconciliation during grace period (${discrepancy.toFixed(2)}px discrepancy)`);
        return;
      }
      
      if (sprintJustChanged && discrepancy > 10 && discrepancy < 50) {
        // Skip small corrections during sprint transitions to reduce camera snapping
        return;
      }
      
      // Only log reconciliation issues, not perfect matches
      if (discrepancy > 80) {
        // Large discrepancy - immediate snap (teleport, respawn, etc.)
        console.log(`[RECONCILIATION] LARGE SNAP: ${discrepancy.toFixed(2)}px discrepancy`);
        predictedPositionRef.current = serverPos;
        renderPositionRef.current = serverPos;
      } else if (discrepancy > 10) {
        // Small discrepancy - gentle correction by nudging the predicted position
        // towards the server position (this gets smoothed by the interpolation)
        const correctionFactor = 0.3; // Gentle correction
        console.log(`[RECONCILIATION] GENTLE CORRECTION: ${discrepancy.toFixed(2)}px discrepancy, nudging by ${(correctionFactor * 100)}%`);
        predictedPositionRef.current.x += (serverPos.x - predictedPos.x) * correctionFactor;
        predictedPositionRef.current.y += (serverPos.y - predictedPos.y) * correctionFactor;
      }
    }
  }, [localPlayer?.positionX, localPlayer?.positionY]);


  return {
    predictedPosition: renderPositionRef.current, // Return the smooth position for rendering
    // Remove updatePredictedMovement since it's now handled internally
  };
}; 