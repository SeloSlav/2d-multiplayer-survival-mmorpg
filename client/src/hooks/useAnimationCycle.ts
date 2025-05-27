import { useState, useEffect, useRef } from 'react';

// Custom Hook for general animations (items, effects, etc.)
// For player walking animation, use useWalkingAnimationCycle instead
export function useAnimationCycle(interval: number, numFrames: number): number {
  const [animationFrame, setAnimationFrame] = useState(0);
  const accumulatedTimeRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(performance.now());
  const animationIdRef = useRef<number>(0);

  useEffect(() => {
    // Use requestAnimationFrame for better performance and consistency
    const updateAnimation = () => {
      const now = performance.now();
      const deltaTime = now - lastUpdateRef.current;
      lastUpdateRef.current = now;
      
      accumulatedTimeRef.current += deltaTime;
      
      // Check if enough time has passed for the next frame
      if (accumulatedTimeRef.current >= interval) {
        setAnimationFrame(frame => (frame + 1) % numFrames);
        accumulatedTimeRef.current -= interval; // Keep remainder for smooth timing
      }
      
      animationIdRef.current = requestAnimationFrame(updateAnimation);
    };

    animationIdRef.current = requestAnimationFrame(updateAnimation);

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
    };
  }, [interval, numFrames]);

  return animationFrame;
}

// Custom Hook specifically for walking animation with proper frame sequence
// Creates smooth walking motion: 0 -> 1 -> 2 -> 1 -> repeat
// Frame 1 is the neutral/idle position, creating natural movement
export function useWalkingAnimationCycle(interval: number = 120): number {
  const [cycleIndex, setCycleIndex] = useState(0);
  const accumulatedTimeRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(performance.now());
  const animationIdRef = useRef<number>(0);

  // Walking cycle: 0 -> 1 -> 2 -> 1 (creates smooth back-and-forth motion)
  const walkingFrames = [0, 1, 2, 1];

  useEffect(() => {
    // Reset/initialize refs when interval changes or component mounts
    lastUpdateRef.current = performance.now();
    accumulatedTimeRef.current = 0;
    // setCycleIndex(0); // Optionally reset animation to start, or let it continue

    const updateWalkCycle = () => {
      const now = performance.now();
      const deltaTime = now - lastUpdateRef.current;
      lastUpdateRef.current = now;
      
      accumulatedTimeRef.current += deltaTime;
      
      // Check if at least one frame step is needed
      if (accumulatedTimeRef.current >= interval) {
        let newCalculatedIndex = cycleIndex; // Start with current state's index
        let timeToProcess = accumulatedTimeRef.current;
        
        // Process all full intervals that have passed
        while (timeToProcess >= interval) {
          newCalculatedIndex = (newCalculatedIndex + 1) % walkingFrames.length;
          timeToProcess -= interval;
        }
        accumulatedTimeRef.current = timeToProcess; // Store the remainder

        // Only update state if the calculated newIndex is different from the current cycleIndex
        // This prevents unnecessary state updates if the animation hasn't actually advanced a frame.
        if (newCalculatedIndex !== cycleIndex) {
          setCycleIndex(newCalculatedIndex);
        }
      }
      
      animationIdRef.current = requestAnimationFrame(updateWalkCycle);
    };

    animationIdRef.current = requestAnimationFrame(updateWalkCycle);

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
    };
    // cycleIndex is a dependency because it's read to determine newCalculatedIndex.
    // This ensures that if cycleIndex were to be changed from outside (which it isn't here),
    // the loop correctly uses the latest value.
  }, [interval, cycleIndex]);

  return walkingFrames[cycleIndex];
} 