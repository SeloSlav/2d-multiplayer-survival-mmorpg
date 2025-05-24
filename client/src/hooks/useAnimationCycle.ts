import { useState, useEffect, useRef } from 'react';

// Custom Hook for general animations (items, effects, etc.)
// For player walking animation, use useWalkingAnimationCycle instead
export function useAnimationCycle(interval: number, numFrames: number): number {
  const [animationFrame, setAnimationFrame] = useState(0);
  const animationFrameRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(performance.now());

  useEffect(() => {
    // Use requestAnimationFrame for smoother performance
    const updateAnimation = () => {
      const now = performance.now();
      if (now - lastUpdateRef.current >= interval) {
        setAnimationFrame(frame => (frame + 1) % numFrames);
        lastUpdateRef.current = now;
      }
      
      // Continue animation loop
      animationFrameRef.current = requestAnimationFrame(updateAnimation);
    };

    // Start the animation loop
    animationFrameRef.current = requestAnimationFrame(updateAnimation);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
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
  const animationFrameRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(performance.now());

  // Walking cycle: 0 -> 1 -> 2 -> 1 (creates smooth back-and-forth motion)
  const walkingFrames = [0, 1, 2, 1];

  useEffect(() => {
    // Use requestAnimationFrame for optimal performance
    const updateWalkCycle = () => {
      const now = performance.now();
      if (now - lastUpdateRef.current >= interval) {
        setCycleIndex(index => (index + 1) % walkingFrames.length);
        lastUpdateRef.current = now;
      }
      
      // Continue animation loop
      animationFrameRef.current = requestAnimationFrame(updateWalkCycle);
    };

    // Start the animation loop
    animationFrameRef.current = requestAnimationFrame(updateWalkCycle);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [interval]);

  return walkingFrames[cycleIndex];
} 