// PERFORMANCE FIX: Single unified animation loop with directly exported refs
// - ONE RAF loop updates all animation frames (not 3 separate loops)
// - Refs are exported directly so game loop can read .current without re-renders
// - Hooks just ensure the loop is started, they don't return values

import { useEffect } from 'react';

// === EXPORTED REFS - Read these directly in the game loop ===
// These are updated by a single RAF loop without triggering React re-renders
export const walkingAnimationFrameRef = { current: 0 };
export const sprintAnimationFrameRef = { current: 0 };
export const idleAnimationFrameRef = { current: 0 };

// Animation timing configuration
const WALKING_FRAME_DURATION = 150; // ms per frame
const SPRINT_FRAME_DURATION = 100;  // ms per frame (faster)
const IDLE_FRAME_DURATION = 500;    // ms per frame (slower)
const NUM_FRAMES = 4;

// Track timing for each animation type
let walkingLastUpdate = 0;
let sprintLastUpdate = 0;
let idleLastUpdate = 0;

// Singleton: is the unified loop running?
let unifiedLoopRunning = false;
let unifiedRafId: number | null = null;
let loopRefCount = 0; // Track how many components need the loop

// Single unified animation loop - updates all animation types
function unifiedAnimationLoop(time: number) {
  // Update walking animation
  if (time - walkingLastUpdate >= WALKING_FRAME_DURATION) {
    walkingAnimationFrameRef.current = (walkingAnimationFrameRef.current + 1) % NUM_FRAMES;
    walkingLastUpdate = time;
  }

  // Update sprint animation
  if (time - sprintLastUpdate >= SPRINT_FRAME_DURATION) {
    sprintAnimationFrameRef.current = (sprintAnimationFrameRef.current + 1) % NUM_FRAMES;
    sprintLastUpdate = time;
  }

  // Update idle animation
  if (time - idleLastUpdate >= IDLE_FRAME_DURATION) {
    idleAnimationFrameRef.current = (idleAnimationFrameRef.current + 1) % NUM_FRAMES;
    idleLastUpdate = time;
  }

  unifiedRafId = requestAnimationFrame(unifiedAnimationLoop);
}

function startUnifiedLoop() {
  if (unifiedLoopRunning) return;
  unifiedLoopRunning = true;
  
  // Initialize timing
  const now = performance.now();
  walkingLastUpdate = now;
  sprintLastUpdate = now;
  idleLastUpdate = now;
  
  unifiedRafId = requestAnimationFrame(unifiedAnimationLoop);
}

function stopUnifiedLoop() {
  if (unifiedRafId !== null) {
    cancelAnimationFrame(unifiedRafId);
    unifiedRafId = null;
  }
  unifiedLoopRunning = false;
}

export function retainAnimationCycleLoop(): void {
  loopRefCount++;
  startUnifiedLoop();
}

export function releaseAnimationCycleLoop(): void {
  loopRefCount--;
  if (loopRefCount <= 0) {
    stopUnifiedLoop();
    loopRefCount = 0;
  }
}

// Hook to ensure animation loop is running
// Returns the current frame value for backwards compatibility, but prefer reading ref directly
export function useWalkingAnimationCycle(): number {
  useEffect(() => {
    retainAnimationCycleLoop();
    return releaseAnimationCycleLoop;
  }, []);

  // Return current value for backwards compatibility
  // NOTE: This won't update during renders - read walkingAnimationFrameRef.current directly in game loop
  return walkingAnimationFrameRef.current;
}

// Sprint animation hook - same pattern
export function useSprintAnimationCycle(): number {
  useEffect(() => {
    retainAnimationCycleLoop();
    return releaseAnimationCycleLoop;
  }, []);

  return sprintAnimationFrameRef.current;
}

// Idle animation hook - same pattern
export function useIdleAnimationCycle(): number {
  useEffect(() => {
    retainAnimationCycleLoop();
    return releaseAnimationCycleLoop;
  }, []);

  return idleAnimationFrameRef.current;
}

// Legacy base hook (kept for compatibility but NOT recommended)
// Creates its own RAF loop - avoid using this, prefer the specialized hooks above
export function useAnimationCycle(frameDuration: number, numFrames: number): number {
  // This hook is deprecated - it creates separate RAF loops
  // For new code, use useWalkingAnimationCycle/useSprintAnimationCycle/useIdleAnimationCycle
  // and read directly from the exported refs
  
  useEffect(() => {
    retainAnimationCycleLoop();
    return releaseAnimationCycleLoop;
  }, []);

  // Return walking frame as default - legacy compatibility
  return walkingAnimationFrameRef.current;
}
