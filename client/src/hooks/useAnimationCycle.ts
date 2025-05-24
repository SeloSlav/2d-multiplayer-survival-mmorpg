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
    // Use requestAnimationFrame for better performance and consistency
    const updateWalkCycle = () => {
      const now = performance.now();
      const deltaTime = now - lastUpdateRef.current;
      lastUpdateRef.current = now;
      
      accumulatedTimeRef.current += deltaTime;
      
      // Check if enough time has passed for the next frame
      if (accumulatedTimeRef.current >= interval) {
        setCycleIndex(index => (index + 1) % walkingFrames.length);
        accumulatedTimeRef.current -= interval; // Keep remainder for smooth timing
      }
      
      animationIdRef.current = requestAnimationFrame(updateWalkCycle);
    };

    animationIdRef.current = requestAnimationFrame(updateWalkCycle);

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
    };
  }, [interval]);

  return walkingFrames[cycleIndex];
} 