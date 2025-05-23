import { useState, useEffect, useRef } from 'react';

// Custom Hook for general animations (items, effects, etc.)
// For player walking animation, use useWalkingAnimationCycle instead
export function useAnimationCycle(interval: number, numFrames: number): number {
  const [animationFrame, setAnimationFrame] = useState(0);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    intervalRef.current = window.setInterval(() => {
      setAnimationFrame(frame => (frame + 1) % numFrames);
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
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
  const intervalRef = useRef<number | null>(null);

  // Walking cycle: 0 -> 1 -> 2 -> 1 (creates smooth back-and-forth motion)
  const walkingFrames = [0, 1, 2, 1];

  useEffect(() => {
    intervalRef.current = window.setInterval(() => {
      setCycleIndex(index => (index + 1) % walkingFrames.length);
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [interval]);

  return walkingFrames[cycleIndex];
} 