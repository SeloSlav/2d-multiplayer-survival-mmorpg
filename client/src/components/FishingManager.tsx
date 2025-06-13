import React, { useState, useCallback } from 'react';
import { Player, ItemDefinition, DbConnection } from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import FishingReticle from './FishingReticle';
import { FishingState, FISHING_CONSTANTS } from '../types/fishing';
import bobberImage from '../assets/doodads/primitive_reed_bobble.png';

interface FishingManagerProps {
  localPlayer: Player | null;
  playerIdentity: Identity | null;
  activeItemDef: ItemDefinition | null;
  gameCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  cameraOffsetX: number;
  cameraOffsetY: number;
  isWaterTile: (worldX: number, worldY: number) => boolean;
  connection: DbConnection | null;
}

const FishingManager: React.FC<FishingManagerProps> = ({
  localPlayer,
  playerIdentity,
  activeItemDef,
  gameCanvasRef,
  cameraOffsetX,
  cameraOffsetY,
  isWaterTile,
  connection,
}) => {
  const [fishingState, setFishingState] = useState<FishingState>({
    isActive: false,
    isCasting: false,
    isMinigameActive: false,
    castTarget: null,
    fishingRod: null,
  });
  const [castDistance, setCastDistance] = useState<number>(0); // Track cast distance for bite probability

  // Check if player has a valid fishing rod equipped
  const isValidFishingRod = useCallback(() => {
    return activeItemDef && FISHING_CONSTANTS.VALID_FISHING_RODS.some(rod => rod === activeItemDef.name);
  }, [activeItemDef]);

  // Handle casting the fishing line
  const handleCast = useCallback((worldX: number, worldY: number) => {
    if (!localPlayer || !playerIdentity || !isValidFishingRod()) {
      console.warn('[FishingManager] Invalid state for casting');
      return;
    }

    // Calculate cast distance for bite probability
    const distance = Math.sqrt(
      Math.pow(worldX - localPlayer.positionX, 2) + 
      Math.pow(worldY - localPlayer.positionY, 2)
    );
    setCastDistance(distance);

    console.log('[FishingManager] Casting at:', { worldX, worldY, distance: distance.toFixed(1) });
    
    // Set fishing state to active with cast target
    setFishingState({
      isActive: true,
      isCasting: false,
      isMinigameActive: false,
      castTarget: { x: worldX, y: worldY },
      fishingRod: activeItemDef?.name || null,
    });

    // Call the server reducer
    try {
      if (connection) {
        connection.reducers.castFishingLine(worldX, worldY);
      }
    } catch (error) {
      console.error('[FishingManager] Failed to cast fishing line:', error);
      // Reset state on error
      setFishingState({
        isActive: false,
        isCasting: false,
        isMinigameActive: false,
        castTarget: null,
        fishingRod: null,
      });
    }
  }, [localPlayer, playerIdentity, activeItemDef, isValidFishingRod, connection]);

  // Handle successful fishing
  const handleFishingSuccess = useCallback(async (loot: string[]) => {
    console.log('[FishingManager] ===== FISHING SUCCESS CALLED =====');
    console.log('[FishingManager] Loot:', loot);
    console.log('[FishingManager] Connection exists:', !!connection);
    console.log('[FishingManager] Player identity:', playerIdentity?.toHexString());
    
    try {
      if (connection) {
        console.log('[FishingManager] Calling server finishFishing(true, [])...');
        // Call server to finish fishing - server will generate and spawn loot
        await connection.reducers.finishFishing(true, loot);
        console.log('[FishingManager] Server confirmed fishing success');
      } else {
        console.error('[FishingManager] No connection available!');
      }
    } catch (error) {
      console.error('[FishingManager] Server rejected fishing success:', error);
      // If server rejects, reset state without showing success
      setFishingState({
        isActive: false,
        isCasting: false,
        isMinigameActive: false,
        castTarget: null,
        fishingRod: null,
      });
      return;
    }
    
    // Reset fishing state only if server confirmed success
    setFishingState({
      isActive: false,
      isCasting: false,
      isMinigameActive: false,
      castTarget: null,
      fishingRod: null,
    });
  }, [connection, playerIdentity]);

  // Handle fishing failure
  const handleFishingFailure = useCallback(() => {
    console.log('[FishingManager] Fishing failed');
    
    try {
      if (connection) {
        connection.reducers.finishFishing(false, []);
      }
    } catch (error) {
      console.error('[FishingManager] Failed to finish fishing:', error);
    }
    
    // Reset fishing state
    setFishingState({
      isActive: false,
      isCasting: false,
      isMinigameActive: false,
      castTarget: null,
      fishingRod: null,
    });
  }, [connection]);

  // Handle canceling fishing (ESC key)
  const handleCancel = useCallback(() => {
    console.log('[FishingManager] Fishing cancelled');
    
    try {
      if (connection) {
        connection.reducers.cancelFishing();
      }
    } catch (error) {
      console.error('[FishingManager] Failed to cancel fishing:', error);
    }
    
    // Reset fishing state
    setFishingState({
      isActive: false,
      isCasting: false,
      isMinigameActive: false,
      castTarget: null,
      fishingRod: null,
    });
  }, [connection]);

  // Check if fishing rod is unequipped during active fishing session
  React.useEffect(() => {
    if (fishingState.isActive && !isValidFishingRod()) {
      console.log('[FishingManager] Fishing rod unequipped during session - canceling fishing');
      handleCancel();
    }
  }, [fishingState.isActive, isValidFishingRod, handleCancel]);

  // Handle ESC key to cancel fishing
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape' && fishingState.isActive) {
        handleCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [fishingState.isActive, handleCancel]);

  // TODO: Add reducer callback to show success notification when server confirms
  // For now, items will just appear as dropped items at player's feet

  // Don't render anything if player doesn't have a fishing rod
  if (!isValidFishingRod()) {
    return null;
  }

  return (
    <>
      {/* Show fishing reticle when not actively fishing */}
      {!fishingState.isActive && (
        <FishingReticle
          localPlayer={localPlayer}
          playerIdentity={playerIdentity}
          activeItemDef={activeItemDef}
          gameCanvasRef={gameCanvasRef}
          cameraOffsetX={cameraOffsetX}
          cameraOffsetY={cameraOffsetY}
          onCast={handleCast}
          isWaterTile={isWaterTile}
        />
      )}
      
      {/* Show fishing system when actively fishing */}
      {fishingState.isActive && fishingState.castTarget && localPlayer && (
        <FishingSystem
          playerX={localPlayer.positionX}
          playerY={localPlayer.positionY}
          playerDirection={localPlayer.direction || 'down'}
          castTargetX={fishingState.castTarget.x}
          castTargetY={fishingState.castTarget.y}
          castDistance={castDistance}
          cameraOffsetX={cameraOffsetX}
          cameraOffsetY={cameraOffsetY}
          gameCanvasRef={gameCanvasRef}
          onSuccess={handleFishingSuccess}
          onFailure={handleFishingFailure}
          onCancel={handleCancel}
          isWaterTile={isWaterTile}
        />
      )}
    </>
  );
};

// Enhanced fishing system with bobber, timer, and reeling mechanics
interface FishingSystemProps {
  playerX: number;
  playerY: number;
  playerDirection: string; // Add player direction for rod alignment
  castTargetX: number;
  castTargetY: number;
  castDistance: number; // Distance from player to cast target
  cameraOffsetX: number;
  cameraOffsetY: number;
  gameCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onSuccess: (loot: string[]) => void;
  onFailure: () => void;
  onCancel: () => void;
  isWaterTile: (worldX: number, worldY: number) => boolean;
}

interface BobberState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  isMoving: boolean;
  // Fish fighting mechanics
  fishDirection: number; // -1 (left) or 1 (right) for zig-zag movement
  lastDirectionChange: number; // timestamp of last direction change
  driftAccumulator: number; // accumulated drift movement
  // Smooth swimming targets
  zigZagTargetX: number; // Target X position for current zig-zag movement
  zigZagTargetY: number; // Target Y position for current zig-zag movement
  hasReachedTarget: boolean; // Whether fish has reached its current target
}

const FishingSystem: React.FC<FishingSystemProps> = ({
  playerX,
  playerY,
  playerDirection,
  castTargetX,
  castTargetY,
  castDistance,
  cameraOffsetX,
  cameraOffsetY,
  gameCanvasRef,
  onSuccess,
  onFailure,
  onCancel,
  isWaterTile,
}) => {
  const [phase, setPhase] = useState<'waiting' | 'caught' | 'reeling'>('waiting');
  const [timer, setTimer] = useState(100); // 100% -> 0%
  const [bobber, setBobber] = useState<BobberState>({
    x: castTargetX,
    y: castTargetY,
    targetX: castTargetX,
    targetY: castTargetY,
    isMoving: false,
    fishDirection: 0,
    lastDirectionChange: 0,
    driftAccumulator: 0,
    zigZagTargetX: castTargetX,
    zigZagTargetY: castTargetY,
    hasReachedTarget: true,
  });
  const [reelProgress, setReelProgress] = useState(0); // 0% -> 100% (distance to shore)
  const [showResult, setShowResult] = useState<{ type: 'success' | 'failure', message: string, loot?: string[] } | null>(null);

  const WAIT_DURATION = 8000; // 8 seconds to wait for bite
  const BOBBER_MOVE_RADIUS = 80; // How far bobber can move from cast point
  const REEL_DISTANCE_PER_CLICK = 30; // How much closer bobber gets per right-click (doubled for easier fishing)

  // Fish fighting mechanics constants
  const FISH_ZIG_ZAG_SPEED = 120; // pixels per second - much more dramatic movement
  const FISH_DIRECTION_CHANGE_INTERVAL = 3500; // milliseconds between direction changes - much longer commits
  const FISH_DRIFT_SPEED = 15; // pixels per second away from player - reduced for catchability
  const LINE_BREAK_THRESHOLD = 0.95; // Break line at 95% stress instead of 100%
  const FISH_BURST_CHANCE = 0.01; // 1% chance per frame for sudden burst movement (very rare)
  const FISH_BURST_DISTANCE = 60; // Distance for burst movements
  const FISH_SWIM_SPEED = 70; // pixels per second - slower to give player more time to react
  const ZIG_ZAG_DISTANCE = 280; // How far fish moves perpendicular for zig-zag - dramatic but manageable

  // Calculate distance-based bite probability multiplier
  const getDistanceBasedBiteMultiplier = (distance: number): number => {
    // Normalize distance to 0-1 range (0 = shore, 1 = max range)
    const normalizedDistance = Math.min(distance / FISHING_CONSTANTS.RANGE, 1);
    
    // Create a curve where:
    // - Distance 0 (shore): 0.2x bite chance (very low)
    // - Distance 300 (half range): 1.0x bite chance (normal)
    // - Distance 600 (max range): 2.5x bite chance (high reward for risk)
    
    // Quadratic curve for smooth progression
    const baseMultiplier = 0.2; // Minimum at shore
    const maxMultiplier = 2.5;   // Maximum at deep water
    const curveExponent = 1.8;   // Curve steepness (higher = more dramatic)
    
    const multiplier = baseMultiplier + (maxMultiplier - baseMultiplier) * Math.pow(normalizedDistance, curveExponent);
    
    console.log(`[FishingSystem] Distance: ${distance.toFixed(1)}, Normalized: ${normalizedDistance.toFixed(2)}, Bite multiplier: ${multiplier.toFixed(2)}x`);
    return multiplier;
  };

  const distanceBiteMultiplier = getDistanceBasedBiteMultiplier(castDistance);

  // Check if player moved too far from bobber and break line
  React.useEffect(() => {
    const distance = Math.sqrt(
      Math.pow(playerX - bobber.x, 2) + Math.pow(playerY - bobber.y, 2)
    );
    
    if (distance > FISHING_CONSTANTS.BREAK_DISTANCE) {
      console.log('[FishingSystem] Line broke! Player moved too far from bobber:', distance);
      setShowResult({ type: 'failure', message: 'Line broke! You moved too far away.' });
      setTimeout(() => onCancel(), 2000);
    }
  }, [playerX, playerY, bobber.x, bobber.y, onCancel]);

  // Handle bite timer and phase transitions
  React.useEffect(() => {
    if (phase !== 'waiting') return;

    // Random bite chance - fish can bite at any time during waiting period
    // Higher chance as time progresses (more likely to bite later)
    const biteCheckInterval = setInterval(() => {
      const elapsed = Date.now() - timerStartRef.current;
      const timeProgress = elapsed / FISHING_CONSTANTS.BITE_TIMER_DURATION; // 0 to 1
      
      // Base 1% chance per check, increasing to 5% chance as time progresses
      const baseBiteChance = 0.01;
      const progressMultiplier = 1 + timeProgress * 4; // 1x to 5x multiplier
      
      // Apply distance-based multiplier (deeper water = better fishing)
      const finalBiteChance = baseBiteChance * progressMultiplier * distanceBiteMultiplier;
      
      if (Math.random() < finalBiteChance) {
        console.log('[FishingSystem] Fish took the bait! Distance multiplier:', distanceBiteMultiplier.toFixed(2) + 'x', 
                   'Final chance:', (finalBiteChance * 100).toFixed(2) + '%', 'Time progress:', (timeProgress * 100).toFixed(1) + '%');
        setPhase('caught');
        
        // Initialize fish fighting mechanics
        setBobber(prev => ({
          ...prev,
          isMoving: true,
          fishDirection: Math.random() > 0.5 ? 1 : -1,
          lastDirectionChange: Date.now(),
          driftAccumulator: 0,
          zigZagTargetX: prev.x,
          zigZagTargetY: prev.y,
          hasReachedTarget: true, // Start by needing a new target
        }));
        
        setTimer(0);
        clearInterval(biteCheckInterval);
      }
    }, 200); // Check every 200ms

    // Automatic failure if timer fully expires
    const failureTimer = setTimeout(() => {
      console.log('[FishingSystem] Bite timer expired - no fish bit the bait');
      setShowResult({ type: 'failure', message: 'No fish bit the bait. Try again!' });
      setTimeout(() => onFailure(), 2000);
      clearInterval(biteCheckInterval);
    }, FISHING_CONSTANTS.BITE_TIMER_DURATION);

    // Update timer display countdown
    const timerInterval = setInterval(() => {
      setTimer(prev => {
        const elapsed = Date.now() - timerStartRef.current;
        const remaining = Math.max(0, FISHING_CONSTANTS.BITE_TIMER_DURATION - elapsed);
        return (remaining / FISHING_CONSTANTS.BITE_TIMER_DURATION) * 100;
      });
    }, 100);

    return () => {
      clearTimeout(failureTimer);
      clearInterval(biteCheckInterval);
      clearInterval(timerInterval);
    };
  }, [phase, onFailure]);

  // Track timer start for countdown
  const timerStartRef = React.useRef(Date.now());
  React.useEffect(() => {
    if (phase === 'waiting') {
      timerStartRef.current = Date.now();
    }
  }, [phase]);

  // Handle bobber movement during fight
  React.useEffect(() => {
    if (phase !== 'caught') return;

    const moveInterval = setInterval(() => {
      setBobber(prev => {
        const now = Date.now();
        let newBobber = { ...prev };
        
        // Calculate current distance and direction to player
        const dx = playerX - prev.x;
        const dy = playerY - prev.y;
        const distanceToPlayer = Math.sqrt(dx * dx + dy * dy);
        
        // Check if line should break from stress
        const stressRatio = distanceToPlayer / FISHING_CONSTANTS.BREAK_DISTANCE;
        if (stressRatio >= LINE_BREAK_THRESHOLD) {
          console.log('[FishingSystem] Line broke from stress! Distance:', distanceToPlayer.toFixed(1));
          onFailure();
          return prev;
        }
        
        // Initialize fish direction and timing if needed
        if (prev.lastDirectionChange === 0) {
          newBobber.fishDirection = Math.random() > 0.5 ? 1 : -1;
          newBobber.lastDirectionChange = now;
          newBobber.hasReachedTarget = true; // Start by needing a new target
        }
        
        // Calculate distance to current zig-zag target
        const targetDx = prev.zigZagTargetX - prev.x;
        const targetDy = prev.zigZagTargetY - prev.y;
        const distanceToTarget = Math.sqrt(targetDx * targetDx + targetDy * targetDy);
        
        // Check if fish has reached its current target or needs a new direction
        // Prioritize completing the current sweep over timing
        const hasTimedOut = (now - prev.lastDirectionChange >= FISH_DIRECTION_CHANGE_INTERVAL);
        const hasCompletedSweep = prev.hasReachedTarget || distanceToTarget < 25;
        
        if (hasCompletedSweep || (hasTimedOut && distanceToTarget < 100)) {
          // Pick new zig-zag target perpendicular to player-bobber line
          if (distanceToPlayer > 0) {
            // Calculate perpendicular vector
            const perpX = -dy / distanceToPlayer;
            const perpY = dx / distanceToPlayer;
            
            // Flip direction for zig-zag
            newBobber.fishDirection *= -1;
            newBobber.lastDirectionChange = now;
            
            // Set new target position - dramatic long sweeps
            newBobber.zigZagTargetX = prev.x + perpX * ZIG_ZAG_DISTANCE * newBobber.fishDirection;
            newBobber.zigZagTargetY = prev.y + perpY * ZIG_ZAG_DISTANCE * newBobber.fishDirection;
            newBobber.hasReachedTarget = false;
            
            console.log('[FishingSystem] Fish committed to new dramatic sweep, distance:', ZIG_ZAG_DISTANCE, 
                       'target:', newBobber.zigZagTargetX.toFixed(1), newBobber.zigZagTargetY.toFixed(1));
          }
        }
        
        const deltaTime = 16 / 1000; // 60fps = 16ms
        
        // Smooth swimming toward zig-zag target
        if (!newBobber.hasReachedTarget && distanceToPlayer > 0) {
          const targetDx = newBobber.zigZagTargetX - prev.x;
          const targetDy = newBobber.zigZagTargetY - prev.y;
          const distanceToTarget = Math.sqrt(targetDx * targetDx + targetDy * targetDy);
          
          if (distanceToTarget > 20) { // Fish must complete most of the dramatic sweep
            // Swim toward target smoothly and determinedly
            const swimDistance = FISH_SWIM_SPEED * deltaTime;
            const moveX = (targetDx / distanceToTarget) * swimDistance;
            const moveY = (targetDy / distanceToTarget) * swimDistance;
            
            newBobber.x += moveX;
            newBobber.y += moveY;
          } else {
            // Completed dramatic sweep - fish has made its run
            newBobber.hasReachedTarget = true;
            console.log('[FishingSystem] Fish completed dramatic sweep - ready for about-face');
          }
        }
        
        // Apply drift away from player (fish trying to escape)
        if (distanceToPlayer > 0) {
          // Increase drift speed as stress increases (fish panics more)
          const stressMultiplier = 1 + (stressRatio * 2); // 1x to 3x drift speed
          const driftDistance = FISH_DRIFT_SPEED * deltaTime * stressMultiplier;
          const driftX = -dx / distanceToPlayer; // Away from player X
          const driftY = -dy / distanceToPlayer; // Away from player Y
          
          newBobber.x += driftX * driftDistance;
          newBobber.y += driftY * driftDistance;
          
          // Also drift the target so the fish doesn't immediately swim back
          newBobber.zigZagTargetX += driftX * driftDistance;
          newBobber.zigZagTargetY += driftY * driftDistance;
        }
        
        // Random burst movements for extra drama
        if (Math.random() < FISH_BURST_CHANCE) {
          const burstAngle = Math.random() * Math.PI * 2; // Random direction
          const burstX = Math.cos(burstAngle) * FISH_BURST_DISTANCE;
          const burstY = Math.sin(burstAngle) * FISH_BURST_DISTANCE;
          
          // Burst changes the target position, fish will swim there
          newBobber.zigZagTargetX = prev.x + burstX;
          newBobber.zigZagTargetY = prev.y + burstY;
          newBobber.hasReachedTarget = false;
          console.log('[FishingSystem] Fish made a burst movement to:', 
                     newBobber.zigZagTargetX.toFixed(1), newBobber.zigZagTargetY.toFixed(1));
        }
        
        // Ensure bobber stays in water (basic bounds check)
        if (!isWaterTile(newBobber.x, newBobber.y)) {
          // If fish would move to land, just skip this movement
          return prev;
        }
        
        return newBobber;
      });
    }, 16); // 60fps

    return () => clearInterval(moveInterval);
  }, [phase, playerX, playerY, isWaterTile, onFailure]);

  // Handle right-click for reeling
  React.useEffect(() => {
    if (phase !== 'caught') return;

    const handleRightClick = (event: MouseEvent) => {
      if (event.button === 2) {
        event.preventDefault();
        event.stopPropagation();
        
        // Move bobber closer to player
        setBobber(prev => {
          const dx = playerX - prev.x;
          const dy = playerY - prev.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance > REEL_DISTANCE_PER_CLICK) {
            const moveX = (dx / distance) * REEL_DISTANCE_PER_CLICK;
            const moveY = (dy / distance) * REEL_DISTANCE_PER_CLICK;
            
            const newX = prev.x + moveX;
            const newY = prev.y + moveY;
            
            // Check multiple points along the reeling path for land intersection
            let foundLand = false;
            const numChecks = 5; // Check 5 points along the path
            for (let i = 0; i <= numChecks; i++) {
              const checkRatio = i / numChecks;
              const checkX = prev.x + (moveX * checkRatio);
              const checkY = prev.y + (moveY * checkRatio);
              
              if (!isWaterTile(checkX, checkY)) {
                foundLand = true;
                break;
              }
            }
            
            // Also check if bobber has been reeled close enough to shore
            // Success condition: either hit land OR reeled close enough that we're near shore
            const totalCastDistance = Math.sqrt(
              Math.pow(castTargetX - playerX, 2) + Math.pow(castTargetY - playerY, 2)
            );
            const currentDistanceFromPlayer = distance;
            const reelProgress = 1 - (currentDistanceFromPlayer / totalCastDistance);
            
            // If we've reeled in at least 80% of the way, or if we hit land, trigger success
            if (foundLand || reelProgress >= 0.8) {
              console.log('[FishingSystem] Fishing success! Found land:', foundLand, 'Reel progress:', (reelProgress * 100).toFixed(1) + '%');
              console.log('[FishingSystem] Bobber position:', newX.toFixed(1), newY.toFixed(1));
              console.log('[FishingSystem] Player position:', playerX.toFixed(1), playerY.toFixed(1));
              console.log('[FishingSystem] Distance from player:', currentDistanceFromPlayer.toFixed(1));
              onSuccess([]);
              return prev; // Don't move bobber further
            }
            
            return {
              ...prev,
              x: newX,
              y: newY,
            };
          } else {
            // Bobber is very close to player - always success at this point
            console.log('[FishingSystem] Bobber reached player position - success!');
            console.log('[FishingSystem] Final distance:', distance.toFixed(1));
            onSuccess([]);
            return prev;
          }
        });

        // Update reel progress
        setReelProgress(prev => {
          const totalDistance = Math.sqrt(
            Math.pow(castTargetX - playerX, 2) + Math.pow(castTargetY - playerY, 2)
          );
          const currentDistance = Math.sqrt(
            Math.pow(bobber.x - playerX, 2) + Math.pow(bobber.y - playerY, 2)
          );
          const progress = Math.max(0, Math.min(100, ((totalDistance - currentDistance) / totalDistance) * 100));
          return progress;
        });
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    window.addEventListener('mousedown', handleRightClick, true);
    window.addEventListener('contextmenu', handleContextMenu);
    
    return () => {
      window.removeEventListener('mousedown', handleRightClick, true);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [phase, playerX, playerY, bobber.x, bobber.y, castTargetX, castTargetY, onSuccess]);

  // Calculate screen positions
  const canvas = gameCanvasRef.current;
  if (!canvas) return null;

  const canvasRect = canvas.getBoundingClientRect();
  
  // Get player direction from the fishing manager props to access localPlayer
  // We'll need to pass localPlayer to FishingSystem to get direction
  const FishingManagerComponent = (props: any) => props.children; // Temporary approach - we need player direction
  
  // Rod offset adjustments to align with fishing rod visually
  const ROD_OFFSET_X = 24; // Base offset to the right
  const ROD_OFFSET_Y = -18; // Offset up to align with rod tip
  
  // Calculate rod tip position based on player direction (from localPlayer prop that we need to add)
  // For now, assume default direction - we'll need to pass player direction through props
  let rodOffsetX = ROD_OFFSET_X;
  let rodOffsetY = ROD_OFFSET_Y;
  
  // Apply direction-based offset mirroring
  switch (playerDirection) {
    case 'left':
      rodOffsetX = -ROD_OFFSET_X; // Mirror horizontally when facing left
      break;
    case 'up':
      rodOffsetX = -ROD_OFFSET_X + 64; // Additional offset to the left when facing up
      rodOffsetY = -ROD_OFFSET_Y - 40; // Additional offset upward when facing up
      break;
    case 'down':
      rodOffsetX = -ROD_OFFSET_X - 18; // Additional offset to the left when facing up
      rodOffsetY = ROD_OFFSET_Y - 2; // Additional offset downward when facing down
      break;
    case 'right':
    default:
      // Use default offsets for right direction
      break;
  }
  
  const playerScreenX = playerX + cameraOffsetX + canvasRect.left + rodOffsetX;
  const playerScreenY = playerY + cameraOffsetY + canvasRect.top + rodOffsetY;
  const bobberScreenX = bobber.x + cameraOffsetX + canvasRect.left;
  const bobberScreenY = bobber.y + cameraOffsetY + canvasRect.top;

  // Calculate line stress based on current bobber position, not original cast target
  const currentDistance = Math.sqrt(
    Math.pow(playerX - bobber.x, 2) + Math.pow(playerY - bobber.y, 2)
  );
  const stressRatio = currentDistance / FISHING_CONSTANTS.BREAK_DISTANCE;
  
  // Keep fishing line always white as requested
  const lineColor = 'rgba(255, 255, 255, 0.9)';

  // Calculate arc for fishing line when fish is pulling
  const calculateArcPath = () => {
    const dx = bobberScreenX - playerScreenX;
    const dy = bobberScreenY - playerScreenY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Line gets straighter as stress increases (more taut under tension)
    // Base arc when caught, but reduces dramatically as stress increases
    let arcIntensity = phase === 'caught' ? 0.4 : 0.1;
    if (phase === 'caught') {
      // Reduce arc intensity as stress increases (0.4 at 0% stress → 0.05 at 100% stress)
      arcIntensity = 0.4 * (1 - stressRatio * 0.9); // Line gets very straight under high stress
    }
    
    const midX = playerScreenX + dx * 0.5;
    const midY = playerScreenY + dy * 0.5;
    
    // Add perpendicular offset for arc
    const perpX = -dy / distance;
    const perpY = dx / distance;
    let arcOffset = distance * arcIntensity;
    
    // Add line vibration when stress is high
    if (phase === 'caught' && stressRatio > 0.7) {
      const vibrationIntensity = (stressRatio - 0.7) * 15; // Stronger vibration at higher stress
      const vibrationX = (Math.random() - 0.5) * vibrationIntensity;
      const vibrationY = (Math.random() - 0.5) * vibrationIntensity;
      arcOffset += Math.sqrt(vibrationX * vibrationX + vibrationY * vibrationY);
    }
    
    const controlX = midX + perpX * arcOffset;
    const controlY = midY + perpY * arcOffset;
    
    return `M ${playerScreenX} ${playerScreenY} Q ${controlX} ${controlY} ${bobberScreenX} ${bobberScreenY}`;
  };

  return (
    <>
      {/* Fishing line with arc */}
      <svg
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          pointerEvents: 'none',
          zIndex: 9000,
        }}
      >
        <path
          d={calculateArcPath()}
          stroke={lineColor}
          strokeWidth={stressRatio > 0.7 ? "3" : "2"}
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      
      {/* Bobber */}
      <img
        src={bobberImage}
        alt="Fishing Bobber"
        style={{
          position: 'fixed',
          left: bobberScreenX - 12,
          top: bobberScreenY - 12,
          width: '24px',
          height: '24px',
          pointerEvents: 'none',
          zIndex: 9500,
          transform: phase === 'caught' ? 
            `scale(${1.2 + stressRatio * 0.3}) rotate(${15 + stressRatio * 30}deg)` : 
            'scale(1)',
          transition: phase === 'caught' ? 'transform 0.05s ease-out' : 'transform 0.2s ease-out',
          filter: phase === 'caught' ? 
            `drop-shadow(0 0 ${12 + stressRatio * 8}px rgba(255, 100, 100, ${0.8 + stressRatio * 0.2})) drop-shadow(0 0 6px rgba(100, 200, 255, 0.6))` : 
            'drop-shadow(0 0 8px rgba(100, 200, 255, 0.8))',
          animation: phase === 'caught' && stressRatio > 0.6 ? 
            `shake ${0.2 - stressRatio * 0.1}s infinite` : 'none', // Faster shaking at higher stress
        }}
      />
      
      {/* Result notification */}
      {showResult && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: showResult.type === 'success' ? 'rgba(0, 100, 0, 0.9)' : 'rgba(100, 0, 0, 0.9)',
            color: 'white',
            padding: '20px 30px',
            borderRadius: '12px',
            fontSize: '18px',
            fontWeight: 'bold',
            zIndex: 15000,
            textAlign: 'center',
            border: `3px solid ${showResult.type === 'success' ? '#64ff64' : '#ff6464'}`,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
            animation: 'fadeInScale 0.3s ease-out',
          }}
        >
          <div style={{ marginBottom: '10px', fontSize: '24px' }}>
            {showResult.type === 'success' ? '🎣 Success!' : '😞 Nothing Caught'}
          </div>
          <div>
            {showResult.message}
          </div>
        </div>
      )}
      
      {/* Fishing UI */}
      <div
        style={{
          position: 'fixed',
          top: '130px',
          right: '15px',
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          color: '#64c8ff',
          padding: '12px 16px',
          borderRadius: '8px',
          fontSize: '13px',
          zIndex: 10000,
          border: '2px solid #64c8ff',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          backdropFilter: 'blur(4px)',
          minWidth: '180px',
        }}
      >
        <div style={{ marginBottom: '8px', fontWeight: 'bold', fontSize: '14px' }}>
          🎣 {phase === 'waiting' ? 'Waiting for bite...' : 'Fish on the line!'}
        </div>
        
        {phase === 'waiting' && (
          <>
            {/* Fishing depth and bite chance indicator */}
            <div style={{ marginBottom: '8px', fontSize: '12px' }}>
              <div style={{ color: '#64c8ff', marginBottom: '4px' }}>
                📏 Cast Distance: <span style={{ fontWeight: 'bold' }}>{castDistance.toFixed(0)}px</span>
                <span style={{ 
                  marginLeft: '8px',
                  color: distanceBiteMultiplier > 1.5 ? '#44ff44' : distanceBiteMultiplier > 1.0 ? '#ffaa44' : '#ff6464',
                  fontWeight: 'bold'
                }}>
                  ({distanceBiteMultiplier.toFixed(1)}x bite chance)
                </span>
              </div>
              <div style={{ fontSize: '10px', opacity: 0.8, fontStyle: 'italic' }}>
                {distanceBiteMultiplier < 0.5 ? '🏖️ Too shallow - fish are rare' :
                 distanceBiteMultiplier < 1.0 ? '🌊 Shallow water - some fish' :
                 distanceBiteMultiplier < 1.8 ? '🌊 Good depth - plenty of fish' :
                 '🐟 Deep water - fish paradise!'}
              </div>
            </div>
            
            {/* Timer bar */}
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '11px', marginBottom: '4px' }}>Bite Timer</div>
              <div
                style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${timer}%`,
                    height: '100%',
                    backgroundColor: timer > 30 ? '#64c8ff' : '#ff6464',
                    transition: 'width 0.1s ease-out',
                  }}
                />
              </div>
            </div>
          </>
        )}
        
        {phase === 'caught' && (
          <>
            <div style={{ marginBottom: '6px', color: stressRatio > 0.8 ? '#ff6464' : '#64c8ff' }}>
              {stressRatio > 0.9 ? '💀 LINE BREAKING!' : 
               stressRatio > 0.8 ? '🚨 Fish making desperate runs!' : 
               stressRatio > 0.6 ? '⚡ Fish fighting with long sweeps!' :
               '🎣 Fish swimming - reel it in!'}
            </div>
            
            {/* Line stress indicator with warning colors */}
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '11px', marginBottom: '4px' }}>
                Line Stress: <span style={{ 
                  color: stressRatio > 0.8 ? '#ff4444' : stressRatio > 0.6 ? '#ffaa44' : '#44ff44',
                  fontWeight: 'bold'
                }}>
                  {(stressRatio * 100).toFixed(0)}%
                </span>
                {stressRatio > LINE_BREAK_THRESHOLD && ' - BREAKING!'}
              </div>
              <div
                style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  border: stressRatio > 0.8 ? '1px solid #ff4444' : 'none',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, stressRatio * 100)}%`,
                    height: '100%',
                    backgroundColor: stressRatio > 0.8 ? '#ff4444' : stressRatio > 0.6 ? '#ffaa44' : '#44ff44',
                    transition: 'width 0.1s ease-out, background-color 0.2s ease-out',
                    animation: stressRatio > 0.8 ? 'pulse 0.5s infinite' : 'none',
                  }}
                />
              </div>
            </div>
            
            {/* Reel progress bar */}
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '11px', marginBottom: '4px' }}>Progress to Shore</div>
              <div
                style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${reelProgress}%`,
                    height: '100%',
                    backgroundColor: '#64ff64',
                    transition: 'width 0.2s ease-out',
                  }}
                />
              </div>
            </div>
          </>
        )}
        
        <div style={{ fontSize: '11px', opacity: 0.8, fontStyle: 'italic' }}>ESC to cancel</div>
      </div>

      {/* Add CSS animation for result popup */}
      <style>{`
        @keyframes fadeInScale {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.8);
          }
          100% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }
      `}</style>

      {/* Add CSS keyframes for more intense shake animation */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translate(0, 0) scale(${1.2 + stressRatio * 0.3}) rotate(${15 + stressRatio * 30}deg); }
          25% { transform: translate(-4px, -4px) scale(${1.2 + stressRatio * 0.3}) rotate(${10 + stressRatio * 25}deg); }
          50% { transform: translate(4px, -4px) scale(${1.2 + stressRatio * 0.3}) rotate(${20 + stressRatio * 35}deg); }
          75% { transform: translate(-4px, 4px) scale(${1.2 + stressRatio * 0.3}) rotate(${10 + stressRatio * 25}deg); }
        }
      `}</style>

      {/* Add pulse animation for stress indicator */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </>
  );
};

export default FishingManager; 