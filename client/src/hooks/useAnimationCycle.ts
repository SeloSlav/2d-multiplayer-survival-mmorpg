import { useState, useEffect, useRef } from 'react';

// Custom Hook for general animations (items, effects, etc.)
// For player walking animation, use useWalkingAnimationCycle instead
export function useAnimationCycle(interval: number, numFrames: number): number {
  const [animationFrame, setAnimationFrame] = useState(0);
  const intervalRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(Date.now());

  useEffect(() => {
    // Use a more efficient update mechanism
    const updateAnimation = () => {
      const now = Date.now();
      if (now - lastUpdateRef.current >= interval) {
        setAnimationFrame(frame => (frame + 1) % numFrames);
        lastUpdateRef.current = now;
      }
    };

    intervalRef.current = window.setInterval(updateAnimation, Math.min(interval, 16)); // Max 60fps updates

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
  const lastUpdateRef = useRef<number>(Date.now());

  // Walking cycle: 0 -> 1 -> 2 -> 1 (creates smooth back-and-forth motion)
  const walkingFrames = [0, 1, 2, 1];

  useEffect(() => {
    // Use a more efficient update mechanism with frame limiting
    const updateWalkCycle = () => {
      const now = Date.now();
      if (now - lastUpdateRef.current >= interval) {
        setCycleIndex(index => (index + 1) % walkingFrames.length);
        lastUpdateRef.current = now;
      }
    };

    intervalRef.current = window.setInterval(updateWalkCycle, Math.min(interval, 16)); // Max 60fps updates

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [interval]);

  return walkingFrames[cycleIndex];
} 