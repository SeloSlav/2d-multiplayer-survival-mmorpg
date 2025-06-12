import { useState, useEffect, useRef, useCallback } from 'react';
import { Player, DbConnection } from '../generated';
import { usePlayerActions } from '../contexts/PlayerActionsContext';

// Simple client-authoritative movement constants
const POSITION_UPDATE_INTERVAL_MS = 33; // ~30fps position updates
const PLAYER_SPEED = 1200; // pixels per second - match server constant
const SPRINT_MULTIPLIER = 1.5;
const RUBBER_BAND_THRESHOLD = 100; // If server position differs by more than this, rubber band

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
      console.warn(`🐌 [SimpleMovement] UPDATE LAG SPIKE: ${updateTime.toFixed(2)}ms (threshold: ${LAG_SPIKE_THRESHOLD}ms)`);
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

//     console.log(`📊 [SimpleMovement] Performance Report:
//       Average Update Time: ${avg.toFixed(2)}ms
//       Max Update Time: ${max.toFixed(2)}ms
//       Update Rate: ${(this.sentUpdates / (PERFORMANCE_LOG_INTERVAL / 1000)).toFixed(1)} updates/sec
//       Lag Spikes: ${this.lagSpikes}/${this.totalUpdates} (${((this.lagSpikes/this.totalUpdates)*100).toFixed(1)}%)
//       Sent Updates: ${this.sentUpdates}
//       Rejected Updates: ${this.rejectedUpdates}
//       Total Updates: ${this.totalUpdates}`);
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

// Simple client-authoritative movement hook with server validation + RESTORED auto-walk and key bindings
export const usePredictedMovement = ({ connection, localPlayer, inputState, isUIFocused }: SimpleMovementProps) => {
  const [clientPosition, setClientPosition] = useState<{ x: number; y: number } | null>(null);
  const [lastServerPosition, setLastServerPosition] = useState<{ x: number; y: number } | null>(null);
  const lastSentTime = useRef<number>(0);
  const isMoving = useRef(false);

  // Track when we last sent a position update
  const lastUpdateTime = useRef<number>(0);
  const pendingPosition = useRef<{ x: number; y: number } | null>(null);

  // ADDED: Get auto-walk and auto-attack functionality from context
  const { 
    isAutoWalking, 
    toggleAutoWalk, 
    stopAutoWalk,
    isAutoAttacking,
    toggleAutoAttack,
    jump
  } = usePlayerActions();

  // ADDED: Facing direction tracking
  const lastFacingDirection = useRef<string>('down');

  // Key handling is now done by useMovementInput hook to avoid conflicts
  // This hook only handles movement prediction and position updates

  // Initialize position from server
  useEffect(() => {
    if (localPlayer && !clientPosition) {
      const serverPos = { x: localPlayer.positionX, y: localPlayer.positionY };
      setClientPosition(serverPos);
      setLastServerPosition(serverPos);
      pendingPosition.current = serverPos;
      // ADDED: Initialize facing direction
      lastFacingDirection.current = localPlayer.direction || 'down';
      console.log(`🎯 [SimpleMovement] Initialized position: (${serverPos.x.toFixed(1)}, ${serverPos.y.toFixed(1)}) facing: ${lastFacingDirection.current}`);
    }
  }, [localPlayer?.identity, clientPosition]);

  // Listen for server position updates and handle rubber-banding
  useEffect(() => {
    if (!localPlayer || !clientPosition || !lastServerPosition) return;

    const serverPos = { x: localPlayer.positionX, y: localPlayer.positionY };
    
    // Check if server position changed significantly from what we expect
    const distance = Math.sqrt(
      Math.pow(serverPos.x - clientPosition.x, 2) + 
      Math.pow(serverPos.y - clientPosition.y, 2)
    );

    // If server position differs too much, rubber band back to server
    if (distance > RUBBER_BAND_THRESHOLD) {
      console.warn(`🔄 [SimpleMovement] RUBBER BANDING: Server pos (${serverPos.x.toFixed(1)}, ${serverPos.y.toFixed(1)}) differs from client pos (${clientPosition.x.toFixed(1)}, ${clientPosition.y.toFixed(1)}) by ${distance.toFixed(1)}px`);
      setClientPosition(serverPos);
      pendingPosition.current = serverPos;
      movementMonitor.logUpdate(0, false, true);
    }

    // ADDED: Track server facing direction updates
    if (localPlayer.direction && localPlayer.direction !== lastFacingDirection.current) {
      lastFacingDirection.current = localPlayer.direction;
      console.log(`🧭 [SimpleMovement] Server updated facing direction: ${localPlayer.direction}`);
    }

    setLastServerPosition(serverPos);
  }, [localPlayer?.positionX, localPlayer?.positionY, localPlayer?.direction, clientPosition, lastServerPosition]);

  // Simple position update function
  const updatePosition = useCallback(() => {
    const updateStartTime = performance.now();
    
    try {
      if (!connection || !localPlayer || !clientPosition) {
        movementMonitor.logUpdate(performance.now() - updateStartTime, false);
        return;
      }

      const now = performance.now();
      const deltaTime = (now - lastUpdateTime.current) / 1000; // Convert to seconds
      lastUpdateTime.current = now;

      // Skip large deltas (e.g., tab switching)
      if (deltaTime > 0.1) {
        console.warn(`🐌 [SimpleMovement] Large delta time detected: ${deltaTime.toFixed(3)}s - skipping update`);
        movementMonitor.logUpdate(performance.now() - updateStartTime, false);
        return;
      }

      const { direction, sprinting } = inputState;
      isMoving.current = direction.x !== 0 || direction.y !== 0;

      // ADDED: Cancel auto-walk if manual movement detected
      if (isMoving.current && isAutoWalking && !isUIFocused) {
        console.log(`🛑 [SimpleMovement] Manual movement detected, canceling auto-walk`);
        stopAutoWalk();
      }

      // Calculate new position
      let newPos = { ...clientPosition };
      
      if (isMoving.current) {
        const speed = PLAYER_SPEED * (sprinting ? SPRINT_MULTIPLIER : 1);
        const moveDistance = speed * deltaTime;
        
        newPos.x += direction.x * moveDistance;
        newPos.y += direction.y * moveDistance;
        
        // Simple world bounds clamping
        const WORLD_WIDTH = 24000; // 500 tiles * 48px
        const WORLD_HEIGHT = 24000;
        const PLAYER_RADIUS = 32;
        
        newPos.x = Math.max(PLAYER_RADIUS, Math.min(WORLD_WIDTH - PLAYER_RADIUS, newPos.x));
        newPos.y = Math.max(PLAYER_RADIUS, Math.min(WORLD_HEIGHT - PLAYER_RADIUS, newPos.y));
        
        // ADDED: Update facing direction based on movement
        let newFacingDirection = lastFacingDirection.current; // Keep current direction if not moving
        
        if (Math.abs(direction.x) > 0.1 || Math.abs(direction.y) > 0.1) {
          // Determine primary direction based on larger movement component
          if (Math.abs(direction.x) > Math.abs(direction.y)) {
            newFacingDirection = direction.x > 0 ? 'right' : 'left';
          } else {
            newFacingDirection = direction.y > 0 ? 'down' : 'up';
          }
          
          // Only log if direction actually changed
          if (newFacingDirection !== lastFacingDirection.current) {
            console.log(`🧭 [SimpleMovement] Facing direction: ${lastFacingDirection.current} → ${newFacingDirection}`);
            lastFacingDirection.current = newFacingDirection;
          }
        }
        
        // Update client position immediately for responsiveness
        setClientPosition(newPos);
        pendingPosition.current = newPos;
      }

      // Send position update to server at 30fps intervals
      const shouldSendUpdate = now - lastSentTime.current >= POSITION_UPDATE_INTERVAL_MS;
      
      if (shouldSendUpdate && pendingPosition.current) {
                 const clientTimestamp = BigInt(Date.now());
         
                 try {
          // Use the new simple position update reducer
          if (!connection.reducers.updatePlayerPositionSimple) {
            console.error(`❌ [SimpleMovement] updatePlayerPositionSimple reducer not available!`);
            movementMonitor.logUpdate(performance.now() - updateStartTime, false);
            return;
          }
          
          // Use the simple position update reducer with correct parameters
          connection.reducers.updatePlayerPositionSimple(
            pendingPosition.current.x,
            pendingPosition.current.y,
            clientTimestamp, // Keep as BigInt for timestamp
            sprinting && isMoving.current,
            lastFacingDirection.current // Send current facing direction
          );
          
          lastSentTime.current = now;
          console.log(`📡 [SimpleMovement] Sent position update: (${pendingPosition.current.x.toFixed(1)}, ${pendingPosition.current.y.toFixed(1)}) facing: ${lastFacingDirection.current} sprinting: ${sprinting && isMoving.current}`);
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
  }, [connection, localPlayer, clientPosition, inputState, isAutoWalking, stopAutoWalk, isUIFocused]);

  // Run position updates at 60fps for smooth movement
  useEffect(() => {
    let animationId: number;
    
    const loop = () => {
      updatePosition();
      animationId = requestAnimationFrame(loop);
    };
    
    lastUpdateTime.current = performance.now();
    animationId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [updatePosition]);

  // ENHANCED: Return the client position + auto-walk/auto-attack state for rendering
  return { 
    predictedPosition: clientPosition,
    isRubberBanding: false, // Could implement this later if needed
    isAutoWalking,
    isAutoAttacking,
    facingDirection: lastFacingDirection.current
  };
}; 