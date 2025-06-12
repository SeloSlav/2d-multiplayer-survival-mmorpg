import { useState, useEffect, useRef, useCallback } from 'react';
import { Player, DbConnection } from '../generated';
import { usePlayerActions } from '../contexts/PlayerActionsContext';

// Simple client-authoritative movement constants
const POSITION_UPDATE_INTERVAL_MS = 33; // 30fps as requested by manager (better for high ping)
const PLAYER_SPEED = 400; // pixels per second - balanced for 60s world traversal
const SPRINT_MULTIPLIER = 2.0; // 2x speed for sprinting (800 px/s)
const WATER_SPEED_PENALTY = 0.5; // Half speed in water (matches server WATER_SPEED_PENALTY)
const RUBBER_BAND_THRESHOLD = 100; // Reduced threshold for tighter sync
const SMOOTH_INTERPOLATION_SPEED = 0.2; // For smoother rubber banding

// Performance monitoring constants
const PERFORMANCE_LOG_INTERVAL = 10000; // Log every 10 seconds
const LAG_SPIKE_THRESHOLD = 20; // More than 20ms is a lag spike for simple operations

// Simple movement input state
interface MovementInputState {
  direction: { x: number; y: number };
  sprinting: boolean;
}

// Simple position sender props
interface SimpleMovementProps {
  connection: DbConnection | null;
  localPlayer: Player | undefined | null;
  inputState: MovementInputState;
  isUIFocused: boolean; // Added for key handling
}

// Performance monitoring for simple movement
class SimpleMovementMonitor {
  private updateTimings: number[] = [];
  private lastLogTime = 0;
  private lagSpikes = 0;
  private totalUpdates = 0;
  private sentUpdates = 0;
  private rejectedUpdates = 0;

  logUpdate(updateTime: number, wasSent: boolean, wasRejected = false) {
    this.totalUpdates++;
    if (wasSent) this.sentUpdates++;
    if (wasRejected) this.rejectedUpdates++;
    
    this.updateTimings.push(updateTime);
    
    if (updateTime > LAG_SPIKE_THRESHOLD) {
      this.lagSpikes++;
    }

    const now = Date.now();
    if (now - this.lastLogTime > PERFORMANCE_LOG_INTERVAL) {
      this.reportPerformance();
      this.reset();
      this.lastLogTime = now;
    }
  }

  private reportPerformance() {
    if (this.updateTimings.length === 0) return;

    const avg = this.updateTimings.reduce((a, b) => a + b, 0) / this.updateTimings.length;
    const max = Math.max(...this.updateTimings);
  }

  private reset() {
    this.updateTimings = [];
    this.lagSpikes = 0;
    this.totalUpdates = 0;
    this.sentUpdates = 0;
    this.rejectedUpdates = 0;
  }
}

const movementMonitor = new SimpleMovementMonitor();

// Simple client-authoritative movement hook with optimized rendering
export const usePredictedMovement = ({ connection, localPlayer, inputState, isUIFocused }: SimpleMovementProps) => {
  // Use refs instead of state to avoid re-renders during movement
  const clientPositionRef = useRef<{ x: number; y: number } | null>(null);
  const serverPositionRef = useRef<{ x: number; y: number } | null>(null);
  const lastSentTime = useRef<number>(0);
  const isMoving = useRef(false);
  const lastUpdateTime = useRef<number>(0);
  const pendingPosition = useRef<{ x: number; y: number } | null>(null);
  const lastFacingDirection = useRef<string>('down');
  
  // Only use state for values that need to trigger re-renders
  const [, forceUpdate] = useState({}); // For manual re-renders when needed
  const [isRubberBanding, setIsRubberBanding] = useState(false);

  // Get player actions from context
  const { 
    isAutoWalking, 
    toggleAutoWalk, 
    stopAutoWalk,
    isAutoAttacking,
    toggleAutoAttack,
    jump
  } = usePlayerActions();

  // Initialize position from server
  useEffect(() => {
    if (localPlayer && !clientPositionRef.current) {
      const serverPos = { x: localPlayer.positionX, y: localPlayer.positionY };
      clientPositionRef.current = serverPos;
      serverPositionRef.current = serverPos;
      pendingPosition.current = serverPos;
      lastFacingDirection.current = localPlayer.direction || 'down';
      
      // Force a re-render to update components that depend on position
      forceUpdate({});
    }
  }, [localPlayer?.identity]);

  // Listen for server position updates with smooth interpolation
  useEffect(() => {
    if (!localPlayer || !clientPositionRef.current || !serverPositionRef.current) return;

    const newServerPos = { x: localPlayer.positionX, y: localPlayer.positionY };
    
    // Check if server position changed significantly
    const distance = Math.sqrt(
      Math.pow(newServerPos.x - clientPositionRef.current.x, 2) + 
      Math.pow(newServerPos.y - clientPositionRef.current.y, 2)
    );

    // Handle rubber banding with smooth interpolation
    if (distance > RUBBER_BAND_THRESHOLD) {
      console.warn(`🔄 [SimpleMovement] RUBBER BANDING: Distance ${distance.toFixed(1)}px`);
      setIsRubberBanding(true);
      
      // Smooth interpolation instead of instant snap
      const startPos = { ...clientPositionRef.current };
      const targetPos = newServerPos;
      let progress = 0;
      
      const interpolate = () => {
        progress += SMOOTH_INTERPOLATION_SPEED;
        if (progress >= 1) {
          clientPositionRef.current = targetPos;
          pendingPosition.current = targetPos;
          setIsRubberBanding(false);
          forceUpdate({});
          return;
        }
        
        // Smooth interpolation using easing
        const easedProgress = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        clientPositionRef.current = {
          x: startPos.x + (targetPos.x - startPos.x) * easedProgress,
          y: startPos.y + (targetPos.y - startPos.y) * easedProgress
        };
        
        forceUpdate({});
        requestAnimationFrame(interpolate);
      };
      
      requestAnimationFrame(interpolate);
      movementMonitor.logUpdate(0, false, true);
    }

    // Track server facing direction updates
    if (localPlayer.direction && localPlayer.direction !== lastFacingDirection.current) {
      lastFacingDirection.current = localPlayer.direction;
    }

    serverPositionRef.current = newServerPos;
  }, [localPlayer?.positionX, localPlayer?.positionY, localPlayer?.direction]);

  // Optimized position update function
  const updatePosition = useCallback(() => {
    const updateStartTime = performance.now();
    
    try {
      if (!connection || !localPlayer || !clientPositionRef.current) {
        movementMonitor.logUpdate(performance.now() - updateStartTime, false);
        return;
      }

      const now = performance.now();
      const deltaTime = Math.min((now - lastUpdateTime.current) / 1000, 0.1); // Cap delta time
      lastUpdateTime.current = now;

      const { direction, sprinting } = inputState;
      isMoving.current = Math.abs(direction.x) > 0.01 || Math.abs(direction.y) > 0.01;

      // Cancel auto-walk if manual movement detected
      if (isMoving.current && isAutoWalking && !isUIFocused) {
        stopAutoWalk();
      }

      // Calculate new position with more stable movement
      if (isMoving.current && !isRubberBanding) {
        // Calculate speed multipliers (must match server logic)
        let speedMultiplier = 1.0;
        
        // Apply sprint multiplier
        if (sprinting) {
          speedMultiplier *= SPRINT_MULTIPLIER;
        }
        
        // Apply crouch speed reduction (must match server)
        if (localPlayer.isCrouching) {
          speedMultiplier *= 0.5; // Half speed when crouching
        }
        
        // Apply water speed penalty (must match server) - but not while jumping
        const isJumping = localPlayer.jumpStartTimeMs > 0 && 
          (Date.now() - Number(localPlayer.jumpStartTimeMs)) < 500; // 500ms jump duration
        if (localPlayer.isOnWater && !isJumping) {
          speedMultiplier *= WATER_SPEED_PENALTY;
        }
        
        const speed = PLAYER_SPEED * speedMultiplier;
        const moveDistance = speed * deltaTime;
        
        const newPos = {
          x: clientPositionRef.current.x + direction.x * moveDistance,
          y: clientPositionRef.current.y + direction.y * moveDistance
        };
        
        // World bounds clamping
        const WORLD_WIDTH = 24000;
        const WORLD_HEIGHT = 24000;
        const PLAYER_RADIUS = 32;
        
        newPos.x = Math.max(PLAYER_RADIUS, Math.min(WORLD_WIDTH - PLAYER_RADIUS, newPos.x));
        newPos.y = Math.max(PLAYER_RADIUS, Math.min(WORLD_HEIGHT - PLAYER_RADIUS, newPos.y));
        
        // Update facing direction based on movement
        if (Math.abs(direction.x) > 0.1 || Math.abs(direction.y) > 0.1) {
          const newFacingDirection = Math.abs(direction.x) > Math.abs(direction.y) 
            ? (direction.x > 0 ? 'right' : 'left')
            : (direction.y > 0 ? 'down' : 'up');
          
          lastFacingDirection.current = newFacingDirection;
        }
        
        // Update client position immediately for responsiveness
        clientPositionRef.current = newPos;
        pendingPosition.current = newPos;
        
        // Only force re-render every few frames to reduce React overhead
        if (Math.floor(now / 16) % 2 === 0) { // ~30fps re-renders
          forceUpdate({});
        }
      }

      // Send position update to server at controlled intervals
      const shouldSendUpdate = now - lastSentTime.current >= POSITION_UPDATE_INTERVAL_MS;
      
      if (shouldSendUpdate && pendingPosition.current) {
        const clientTimestamp = BigInt(Date.now());
         
        try {
          if (!connection.reducers.updatePlayerPositionSimple) {
            movementMonitor.logUpdate(performance.now() - updateStartTime, false);
            return;
          }
          
          connection.reducers.updatePlayerPositionSimple(
            pendingPosition.current.x,
            pendingPosition.current.y,
            clientTimestamp,
            sprinting && isMoving.current,
            lastFacingDirection.current
          );
          
          lastSentTime.current = now;
          movementMonitor.logUpdate(performance.now() - updateStartTime, true);
        } catch (error) {
          console.error(`❌ [SimpleMovement] Failed to send position update:`, error);
          movementMonitor.logUpdate(performance.now() - updateStartTime, false);
        }
      } else {
        movementMonitor.logUpdate(performance.now() - updateStartTime, false);
      }

    } catch (error) {
      console.error(`❌ [SimpleMovement] Error in updatePosition:`, error);
      movementMonitor.logUpdate(performance.now() - updateStartTime, false);
    }
  }, [connection, localPlayer, inputState, isAutoWalking, stopAutoWalk, isUIFocused, isRubberBanding]);

  // Run position updates with optimized timing
  useEffect(() => {
    let animationId: number;
    let lastFrameTime = 0;
    
    const loop = (currentTime: number) => {
      // Throttle to ~60fps to prevent excessive updates
      if (currentTime - lastFrameTime >= 16) {
        updatePosition();
        lastFrameTime = currentTime;
      }
      animationId = requestAnimationFrame(loop);
    };
    
    lastUpdateTime.current = performance.now();
    animationId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [updatePosition]);

  // Return the current position and state
  return { 
    predictedPosition: clientPositionRef.current,
    isRubberBanding,
    isAutoWalking,
    isAutoAttacking,
    facingDirection: lastFacingDirection.current
  };
}; 