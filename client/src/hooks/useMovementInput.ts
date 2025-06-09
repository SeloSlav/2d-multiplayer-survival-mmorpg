import { useState, useEffect, useCallback, useRef } from 'react';
import { Player } from '../generated';

// Convert player direction string to normalized movement vector
const getDirectionVector = (direction: string): { dx: number; dy: number } => {
  switch (direction) {
    case 'up': return { dx: 0, dy: -1 };
    case 'down': return { dx: 0, dy: 1 };
    case 'left': return { dx: -1, dy: 0 };
    case 'right': return { dx: 1, dy: 0 };
    default: return { dx: 0, dy: 0 };
  }
};

export interface MovementInputState {
  direction: { x: number; y: number };
  sprinting: boolean;
}

interface MovementInputProps {
  isUIFocused: boolean;
  isAutoWalking: boolean;
  onCancelAutoWalk: () => void;
  localPlayer: Player | undefined | null;
}

export const useMovementInput = ({ isUIFocused, isAutoWalking, onCancelAutoWalk, localPlayer }: MovementInputProps) => {
  const [inputState, setInputState] = useState<MovementInputState>({
    direction: { x: 0, y: 0 },
    sprinting: false,
  });

  const keysDown = useRef<Set<string>>(new Set());
  const autoWalkDirection = useRef<{ dx: number, dy: number }>({ dx: 0, dy: 0 });
  const lastComputedStateRef = useRef<MovementInputState>({ direction: { x: 0, y: 0 }, sprinting: false });

  // When auto-walk starts, capture the player's facing direction.
  useEffect(() => {
    if (isAutoWalking && localPlayer) {
      autoWalkDirection.current = getDirectionVector(localPlayer.direction);
    }
  }, [isAutoWalking, localPlayer]);

  const processMovement = useCallback(() => {
    let x = 0;
    let y = 0;
    const sprinting = keysDown.current.has('shift');

    if (isAutoWalking) {
      const isChangingDirection = keysDown.current.has('w') || keysDown.current.has('s') || keysDown.current.has('a') || keysDown.current.has('d');
      
      if (isChangingDirection) {
        // If WASD is pressed, calculate a new direction and UPDATE the persistent auto-walk direction.
        let newDx = 0;
        let newDy = 0;
        if (keysDown.current.has('w')) newDy -= 1;
        if (keysDown.current.has('s')) newDy += 1;
        if (keysDown.current.has('a')) newDx -= 1;
        if (keysDown.current.has('d')) newDx += 1;
        
        autoWalkDirection.current = { dx: newDx, dy: newDy };
      }
      
      // Always use the (potentially updated) auto-walk direction for movement.
      x = autoWalkDirection.current.dx;
      y = autoWalkDirection.current.dy;
    
    } else {
      // Manual movement
      if (keysDown.current.has('w')) y -= 1;
      if (keysDown.current.has('s')) y += 1;
      if (keysDown.current.has('a')) x -= 1;
      if (keysDown.current.has('d')) x += 1;
    }

    // Normalize the vector for consistent speed
    if (x !== 0 || y !== 0) {
      const magnitude = Math.sqrt(x * x + y * y);
      if (magnitude > 0) {
        x /= magnitude;
        y /= magnitude;
      }
    }

    // Only update state if the input actually changed
    const newState = { direction: { x, y }, sprinting };
    const lastState = lastComputedStateRef.current;
    
    if (newState.direction.x !== lastState.direction.x || 
        newState.direction.y !== lastState.direction.y || 
        newState.sprinting !== lastState.sprinting) {
      lastComputedStateRef.current = newState;
      setInputState(newState);
    }
  }, [isAutoWalking]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isUIFocused) return;
      
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'shift'].includes(key)) {
        keysDown.current.add(key);
        processMovement(); // Update immediately when keys change
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'shift'].includes(key)) {
        keysDown.current.delete(key);
        processMovement(); // Update immediately when keys change
      }
    };

    const blurHandler = () => {
      keysDown.current.clear();
      processMovement(); // Update when window loses focus
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', blurHandler);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', blurHandler);
    };
  }, [isUIFocused, processMovement]);

  return { inputState, processMovement };
}; 