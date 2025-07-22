import { useState, useEffect, useRef, useCallback } from 'react';
import { Player, DbConnection, ActiveConsumableEffect, EffectType } from '../generated';
import { usePlayerActions } from '../contexts/PlayerActionsContext';
import { resolveClientCollision, GameEntities } from '../utils/clientCollision';

// Simple client-authoritative movement constants
const POSITION_UPDATE_INTERVAL_MS = 25; // 40fps for better prediction accuracy with high latency
const PLAYER_SPEED = 400; // pixels per second - balanced for 60s world traversal
const SPRINT_MULTIPLIER = 2.0; // 2x speed for sprinting (800 px/s)
const DODGE_ROLL_SPEED_MULTIPLIER = 3.0; // 3x speed during dodge roll (1200 px/s for 450px in ~375ms)
const WATER_SPEED_PENALTY = 0.5; // Half speed in water (matches server WATER_SPEED_PENALTY)
const EXHAUSTED_SPEED_PENALTY = 0.75; // 25% speed reduction when exhausted (matches server EXHAUSTED_SPEED_PENALTY)
// REMOVED: Rubber banding constants - proper prediction shouldn't need them

// Helper function to check if a player has the exhausted effect
const hasExhaustedEffect = (connection: DbConnection | null, playerId: string): boolean => {
  if (!connection) return false;
  
  for (const effect of connection.db.activeConsumableEffect.iter()) {
    if (effect.playerId.toHexString() === playerId && effect.effectType.tag === 'Exhausted') {
      return true;
    }
  }
  return false;
};

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
  entities: GameEntities;
  playerDodgeRollStates?: Map<string, any>; // Add dodge roll states
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

// REMOVED: Rubber band logging - proper prediction shouldn't need it

// Simple client-authoritative movement hook with optimized rendering
export const usePredictedMovement = ({ connection, localPlayer, inputState, isUIFocused, entities, playerDodgeRollStates }: SimpleMovementProps) => {
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

  // Get player actions from context
  const { 
    isAutoWalking, 
    toggleAutoWalk, 
    stopAutoWalk,
    isAutoAttacking,
    toggleAutoAttack,
    jump
  } = usePlayerActions();

  // Add sequence tracking
  const clientSequenceRef = useRef(0n);
  const lastAckedSequenceRef = useRef(0n);

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

  // Listen for server position updates - PROPER CLIENT-SIDE PREDICTION
  useEffect(() => {
    if (!localPlayer || !clientPositionRef.current || !serverPositionRef.current) return;

    const receivedSequence = localPlayer.clientMovementSequence ?? 0n;
    
    if (receivedSequence > lastAckedSequenceRef.current) {
      lastAckedSequenceRef.current = receivedSequence;
      const newServerPos = { x: localPlayer.positionX, y: localPlayer.positionY };
      
      // PROPER PREDICTION: Server update is an acknowledgment, not a correction
      // Only update our server reference for future comparisons
      serverPositionRef.current = newServerPos;
      
      // CLIENT STAYS AUTHORITATIVE: No position correction unless there's actual desync
      // The client prediction continues uninterrupted
      
    }
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

      let { direction, sprinting } = inputState;
      
      // Check for active dodge roll and override direction for consistent distance
      const playerId = localPlayer.identity.toHexString();
      const dodgeRollState = playerDodgeRollStates?.get(playerId);
      const isDodgeRolling = dodgeRollState && 
        (Date.now() - Number(dodgeRollState.startTimeMs)) < 500; // 500ms dodge roll duration
      
      if (isDodgeRolling && dodgeRollState) {
        // Use server-calculated dodge roll direction instead of current input
        const dodgeRollDx = dodgeRollState.targetX - dodgeRollState.startX;
        const dodgeRollDy = dodgeRollState.targetY - dodgeRollState.startY;
        const dodgeRollMagnitude = Math.sqrt(dodgeRollDx * dodgeRollDx + dodgeRollDy * dodgeRollDy);
        
        console.log(`[DODGE DEBUG] Input direction: (${direction.x.toFixed(3)}, ${direction.y.toFixed(3)})`);
        console.log(`[DODGE DEBUG] Server dodge vector: (${dodgeRollDx.toFixed(1)}, ${dodgeRollDy.toFixed(1)}), magnitude: ${dodgeRollMagnitude.toFixed(1)}`);
        
        if (dodgeRollMagnitude > 0) {
          // Override input direction with server's dodge roll direction
          direction = { 
            x: dodgeRollDx / dodgeRollMagnitude, 
            y: dodgeRollDy / dodgeRollMagnitude 
          };
          console.log(`[DODGE DEBUG] Using server direction: (${direction.x.toFixed(3)}, ${direction.y.toFixed(3)})`);
        }
      }
      
      isMoving.current = Math.abs(direction.x) > 0.01 || Math.abs(direction.y) > 0.01;

      // Cancel auto-walk if manual movement detected
      if (isMoving.current && isAutoWalking && !isUIFocused) {
        stopAutoWalk();
      }

      // For knocked out players, also check for facing direction updates even with minimal movement
      const hasDirectionalInput = Math.abs(direction.x) > 0.01 || Math.abs(direction.y) > 0.01;
      
              // Calculate new position with more stable movement
        if (isMoving.current) {
        // Calculate speed multipliers (must match server logic)
        let speedMultiplier = 1.0;
        
        // Apply knocked out movement restriction (must match server)
        if (localPlayer.isKnockedOut) {
          speedMultiplier *= 0.05; // Extremely slow crawling movement (5% of normal speed)
        } else {
          if (isDodgeRolling) {
            speedMultiplier *= DODGE_ROLL_SPEED_MULTIPLIER; // 3x speed for dodge roll
            console.log(`[MOVEMENT] Dodge roll speed boost active: ${speedMultiplier}x`);
          } else if (sprinting) {
            speedMultiplier *= SPRINT_MULTIPLIER; // 2x speed for sprinting
          }
        }
        
        // Apply crouch speed reduction (must match server)
        if (localPlayer.isCrouching) {
          speedMultiplier *= 0.5; // Half speed when crouching
        }
        
        // Apply exhausted effect speed penalty (must match server)
        if (hasExhaustedEffect(connection, localPlayer.identity.toHexString())) {
          speedMultiplier *= EXHAUSTED_SPEED_PENALTY; // 25% speed reduction when exhausted
        }
        
        // Apply water speed penalty (must match server) - but not while jumping
        const isJumping = localPlayer.jumpStartTimeMs > 0 && 
          (Date.now() - Number(localPlayer.jumpStartTimeMs)) < 500; // 500ms jump duration
        if (localPlayer.isOnWater && !isJumping) {
          speedMultiplier *= WATER_SPEED_PENALTY;
        }
        
        const speed = PLAYER_SPEED * speedMultiplier;
        const moveDistance = speed * deltaTime;
        
        const targetPos = {
          x: clientPositionRef.current.x + direction.x * moveDistance,
          y: clientPositionRef.current.y + direction.y * moveDistance
        };
        
        // Apply client-side collision detection with smooth sliding
        const collisionResult = resolveClientCollision(
          clientPositionRef.current.x,
          clientPositionRef.current.y,
          targetPos.x,
          targetPos.y,
          localPlayer.identity.toHexString(),
          entities
        );
        
        // Update facing direction based on movement
        // For knocked out players, use a lower threshold since they move much slower
        const movementThreshold = localPlayer.isKnockedOut ? 0.01 : 0.1;
        if (Math.abs(direction.x) > movementThreshold || Math.abs(direction.y) > movementThreshold) {
          // Prioritize horizontal movement (left/right) over vertical movement (up/down)
          // This ensures that diagonal movement shows as left/right instead of up/down
          const newFacingDirection = Math.abs(direction.x) > movementThreshold
            ? (direction.x > 0 ? 'right' : 'left')
            : (direction.y > 0 ? 'down' : 'up');
          
          lastFacingDirection.current = newFacingDirection;
        }
        
        // Use collision-resolved position
        clientPositionRef.current = { x: collisionResult.x, y: collisionResult.y };
        pendingPosition.current = { x: collisionResult.x, y: collisionResult.y };
        
        // Only force re-render every few frames to reduce React overhead
        const frameMod = Math.floor(now / 16) % 4; // Changed from % 2
        if (frameMod === 0) {
          forceUpdate({});
        }
      } else if (localPlayer.isKnockedOut && hasDirectionalInput) {
        // Special case: knocked out players can still update facing direction without significant movement
        // Prioritize horizontal movement (left/right) over vertical movement (up/down)
        const movementThreshold = 0.01; // Lower threshold for knocked out players
        const newFacingDirection = Math.abs(direction.x) > movementThreshold
          ? (direction.x > 0 ? 'right' : 'left')
          : (direction.y > 0 ? 'down' : 'up');
        
        // Only update if facing direction actually changed
        if (newFacingDirection !== lastFacingDirection.current) {
          lastFacingDirection.current = newFacingDirection;
          
          // Force immediate position update for knocked out players when facing direction changes
          const clientTimestamp = BigInt(Date.now());
          try {
            if (connection.reducers.updatePlayerPositionSimple && pendingPosition.current) {
              clientSequenceRef.current += 1n;
              console.log(`[KnockedOut] Facing direction updated to: ${newFacingDirection}`);
              connection.reducers.updatePlayerPositionSimple(
                pendingPosition.current.x,
                pendingPosition.current.y,
                clientTimestamp,
                false, // Never sprinting when knocked out
                lastFacingDirection.current,
                clientSequenceRef.current
              );
              lastSentTime.current = now;
            }
          } catch (error) {
            console.error(`❌ [KnockedOut] Failed to send facing direction update:`, error);
          }
        }
      }
      
      // GUARD: Don't update facing direction when completely idle to prevent cycling
      // Only allow direction updates when there's actual movement input above the threshold
      // This prevents floating-point noise from causing direction cycling when idle

      // Send position update to server at controlled intervals
      const shouldSendUpdate = now - lastSentTime.current >= POSITION_UPDATE_INTERVAL_MS;
      
      if (shouldSendUpdate && pendingPosition.current) {
        const clientTimestamp = BigInt(Date.now());
         
        try {
          if (!connection.reducers.updatePlayerPositionSimple) {
            movementMonitor.logUpdate(performance.now() - updateStartTime, false);
            return;
          }
          
          clientSequenceRef.current += 1n;
          // console.log(`[PREDICT] Sending update with sequence: ${clientSequenceRef.current}`);
          connection.reducers.updatePlayerPositionSimple(
            pendingPosition.current.x,
            pendingPosition.current.y,
            clientTimestamp,
            sprinting && isMoving.current && !localPlayer.isKnockedOut, // Can't sprint when knocked out
            lastFacingDirection.current,
            clientSequenceRef.current
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
  }, [connection, localPlayer, inputState, isAutoWalking, stopAutoWalk, isUIFocused]);

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
    isAutoWalking,
    isAutoAttacking,
    facingDirection: lastFacingDirection.current
  };
}; 