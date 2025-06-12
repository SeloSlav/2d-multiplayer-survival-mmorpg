import { useState, useEffect, useRef } from 'react';

// Custom Hook for general animations (items, effects, etc.)
// For player walking animation, use useWalkingAnimationCycle instead
export function useAnimationCycle(interval: number, numFrames: number): number {
  const [animationFrame, setAnimationFrame] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // Simple interval-based animation
    intervalRef.current = setInterval(() => {
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
  return useAnimationCycle(interval, 4); // 4 frames for walking animation
}

// Simple breathing animation cycle for idle state
export function useBreathingAnimationCycle(interval: number = 800): number {
  return useAnimationCycle(interval, 2); // 2 frames for breathing
}

// Simplified item use animation cycle
export function useItemUseAnimationCycle(interval: number = 200): number {
  return useAnimationCycle(interval, 3); // 3 frames for item use
} 