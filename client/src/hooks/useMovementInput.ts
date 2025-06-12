import { useState, useEffect, useRef, useCallback } from 'react';
import { Player } from '../generated';
import { usePlayerActions } from '../contexts/PlayerActionsContext';

// Performance monitoring constants
const INPUT_LAG_THRESHOLD = 10; // More than 10ms for input processing is concerning
const INPUT_LOG_INTERVAL = 10000; // Log every 10 seconds

// Performance monitoring for input system
class InputPerformanceMonitor {
  private inputTimings: number[] = [];
  private lastLogTime = 0;
  private lagSpikes = 0;
  private totalInputs = 0;
  private skippedInputs = 0;

  logInputTime(inputTime: number, inputType: string) {
    this.totalInputs++;
    this.inputTimings.push(inputTime);
    
    if (inputTime > INPUT_LAG_THRESHOLD) {
      this.lagSpikes++;
      console.warn(`🐌 [MovementInput] INPUT LAG SPIKE: ${inputType} took ${inputTime.toFixed(2)}ms (threshold: ${INPUT_LAG_THRESHOLD}ms)`);
    }

    const now = Date.now();
    if (now - this.lastLogTime > INPUT_LOG_INTERVAL) {
      this.reportPerformance();
      this.reset();
      this.lastLogTime = now;
    }
  }

  logSkippedInput(reason: string) {
    this.skippedInputs++;
    console.log(`⏭️ [MovementInput] Input skipped: ${reason}`);
  }

  private reportPerformance() {
    if (this.inputTimings.length === 0) return;

    const avg = this.inputTimings.reduce((a, b) => a + b, 0) / this.inputTimings.length;
    const max = Math.max(...this.inputTimings);

  //   console.log(`📊 [MovementInput] Performance Report:
  //     Average Input Time: ${avg.toFixed(2)}ms
  //     Max Input Time: ${max.toFixed(2)}ms
  //     Input Lag Spikes: ${this.lagSpikes}/${this.totalInputs} (${((this.lagSpikes/this.totalInputs)*100).toFixed(1)}%)
  //     Skipped Inputs: ${this.skippedInputs}
  //     Total Inputs: ${this.totalInputs}`);
  }

  private reset() {
    this.inputTimings = [];
    this.lagSpikes = 0;
    this.totalInputs = 0;
    this.skippedInputs = 0;
  }
}

const inputMonitor = new InputPerformanceMonitor();

// Convert player direction string to normalized movement vector - RESTORED from old file
// getDirectionVector removed - no longer needed without auto-walk

// Movement input state - keeping the existing interface
export interface MovementInputState {
  direction: { x: number; y: number };
  sprinting: boolean;
}

// Props interface - removed auto-walk but kept auto-attack
interface MovementInputProps {
  isUIFocused: boolean;
  localPlayer?: Player | null;
  onToggleAutoAttack?: () => void;
}

// Simplified movement input hook without auto-walk
export const useMovementInput = ({ 
  isUIFocused, 
  localPlayer,
  onToggleAutoAttack
}: MovementInputProps) => {
  const [inputState, setInputState] = useState<MovementInputState>({
    direction: { x: 0, y: 0 },
    sprinting: false
  });

  // Performance monitoring references
  const keysPressed = useRef(new Set<string>());
  const lastInputTime = useRef(0);
  const isProcessingInput = useRef(false);
  const lastComputedStateRef = useRef<MovementInputState>({ direction: { x: 0, y: 0 }, sprinting: false });

  // Get player actions for jump, dodge roll, etc.
  const { jump } = usePlayerActions();

  // Enhanced key processing with restored auto-walking logic + performance monitoring
  const processKeys = useCallback(() => {
    const processStartTime = performance.now();
    
    try {
      // Skip if already processing to prevent stacking
      if (isProcessingInput.current) {
        inputMonitor.logSkippedInput('Already processing input');
        return;
      }
      isProcessingInput.current = true;

      // Skip processing if UI is focused
      if (isUIFocused) {
        inputMonitor.logSkippedInput('UI focused');
        return;
      }

      let x = 0, y = 0;
      const sprinting = keysPressed.current.has('ShiftLeft') || keysPressed.current.has('ShiftRight');

      // Simple manual movement
      if (keysPressed.current.has('KeyW') || keysPressed.current.has('ArrowUp')) y -= 1;
      if (keysPressed.current.has('KeyS') || keysPressed.current.has('ArrowDown')) y += 1;
      if (keysPressed.current.has('KeyA') || keysPressed.current.has('ArrowLeft')) x -= 1;
      if (keysPressed.current.has('KeyD') || keysPressed.current.has('ArrowRight')) x += 1;

      // Normalize diagonal movement - keeping the new method
      if (x !== 0 && y !== 0) {
        const magnitude = Math.sqrt(x * x + y * y);
        x /= magnitude;
        y /= magnitude;
      }

      // RESTORED: Only update state if values changed + performance check
      const newState = { direction: { x, y }, sprinting };
      const lastState = lastComputedStateRef.current;
      
      // More robust state change detection with tolerance for floating point precision
      const hasStateChanged = Math.abs(newState.direction.x - lastState.direction.x) > 0.001 || 
                             Math.abs(newState.direction.y - lastState.direction.y) > 0.001 || 
                             newState.sprinting !== lastState.sprinting;
      
      if (hasStateChanged) {
        lastComputedStateRef.current = newState;
        setInputState(newState);
        
        // DEBUG: Log significant movement changes
        if (Math.abs(newState.direction.x) < 0.001 && Math.abs(newState.direction.y) < 0.001 && 
            (Math.abs(lastState.direction.x) > 0.001 || Math.abs(lastState.direction.y) > 0.001)) {
          console.log(`🛑 [MovementInput] Movement stopped - direction: (${x.toFixed(3)}, ${y.toFixed(3)})`);
        }
      } else {
        inputMonitor.logSkippedInput('No state change');
      }

    } catch (error) {
      console.error(`❌ [MovementInput] Error in processKeys:`, error);
    } finally {
      isProcessingInput.current = false;
      const processTime = performance.now() - processStartTime;
      inputMonitor.logInputTime(processTime, 'processKeys');
    }
  }, [isUIFocused]);

  // Throttled key processing - keeping the new performance optimization
  const throttledProcessKeys = useCallback(() => {
    const now = performance.now();
    if (now - lastInputTime.current < 16) { // ~60fps throttle
      inputMonitor.logSkippedInput('Throttled input');
      return;
    }
    lastInputTime.current = now;
    processKeys();
  }, [processKeys]);

  // Enhanced key handlers with RESTORED action key bindings + performance monitoring
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const keyStartTime = performance.now();
    
    try {
      if (isUIFocused) {
        inputMonitor.logSkippedInput('KeyDown - UI focused');
        return;
      }

      const key = event.code;
      
      // RESTORED: Handle action keys (Space, Q, Z)
      if (key === 'Space') {
        event.preventDefault();
        
        // Space: Jump (standing still) / Dodge roll (with movement)
        const isMoving = keysPressed.current.has('KeyW') || keysPressed.current.has('KeyS') || 
                        keysPressed.current.has('KeyA') || keysPressed.current.has('KeyD');
        
        if (isMoving) {
          // Calculate dodge direction
          let dodgeX = 0, dodgeY = 0;
          if (keysPressed.current.has('KeyW')) dodgeY -= 1;
          if (keysPressed.current.has('KeyS')) dodgeY += 1;
          if (keysPressed.current.has('KeyA')) dodgeX -= 1;
          if (keysPressed.current.has('KeyD')) dodgeX += 1;
          
          // Normalize dodge direction
          if (dodgeX !== 0 || dodgeY !== 0) {
            const magnitude = Math.sqrt(dodgeX * dodgeX + dodgeY * dodgeY);
            dodgeX /= magnitude;
            dodgeY /= magnitude;
          }
          
          console.log(`🤸 [MovementInput] Dodge roll triggered: (${dodgeX.toFixed(2)}, ${dodgeY.toFixed(2)})`);
          // TODO: Call dodge roll reducer when we find it
        } else {
          console.log(`🦘 [MovementInput] Jump triggered`);
          jump();
        }
        return;
      }
      
      // Q and Z keys removed (were for auto-walk and auto-attack)

      if (key === 'KeyZ') {
        event.preventDefault();
        console.log(`⚔️ [MovementInput] Auto-attack toggle triggered`);
        onToggleAutoAttack?.();
        return;
      }

      // Handle movement keys
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(key)) {
        if (!keysPressed.current.has(key)) {
          keysPressed.current.add(key);
          throttledProcessKeys();
        }
      }
    } catch (error) {
      console.error(`❌ [MovementInput] Error in handleKeyDown:`, error);
    } finally {
      const keyTime = performance.now() - keyStartTime;
      inputMonitor.logInputTime(keyTime, `KeyDown-${event.code}`);
    }
  }, [isUIFocused, throttledProcessKeys, jump, onToggleAutoAttack]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    const keyStartTime = performance.now();
    
    try {
      const key = event.code;
      if (keysPressed.current.has(key)) {
        keysPressed.current.delete(key);
        // FIXED: Process key releases immediately without throttling to prevent movement lag
        processKeys();
      }
    } catch (error) {
      console.error(`❌ [MovementInput] Error in handleKeyUp:`, error);
    } finally {
      const keyTime = performance.now() - keyStartTime;
      inputMonitor.logInputTime(keyTime, `KeyUp-${event.code}`);
    }
  }, [processKeys]);

  // Event listener setup - keeping the new performance monitoring
  useEffect(() => {
    const setupStartTime = performance.now();
    
    try {
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('keyup', handleKeyUp);

      const setupTime = performance.now() - setupStartTime;
      if (setupTime > 5) {
        console.warn(`🐌 [MovementInput] Slow event listener setup: ${setupTime.toFixed(2)}ms`);
      }

      return () => {
        const cleanupStartTime = performance.now();
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('keyup', handleKeyUp);
        const cleanupTime = performance.now() - cleanupStartTime;
        
        if (cleanupTime > 5) {
          console.warn(`🐌 [MovementInput] Slow event listener cleanup: ${cleanupTime.toFixed(2)}ms`);
        }
      };
    } catch (error) {
      console.error(`❌ [MovementInput] Error in event listener setup:`, error);
    }
  }, [handleKeyDown, handleKeyUp]);

  // Clear input when UI becomes focused
  useEffect(() => {
    if (isUIFocused) {
      const clearStartTime = performance.now();
      
      keysPressed.current.clear();
      setInputState({
        direction: { x: 0, y: 0 },
        sprinting: false
      });
      
      const clearTime = performance.now() - clearStartTime;
      if (clearTime > 5) {
        console.warn(`🐌 [MovementInput] Slow input clear: ${clearTime.toFixed(2)}ms`);
      }
    }
  }, [isUIFocused]);

  // RESTORED: Return both inputState and processMovement for compatibility
  return { inputState, processMovement: processKeys };
}; 