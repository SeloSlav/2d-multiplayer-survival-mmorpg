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
// Creates smooth walking motion using 6 frames: 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> repeat
// Frame 1 is typically the neutral/idle position, creating natural movement
export function useWalkingAnimationCycle(interval: number = 120): number {
  return useAnimationCycle(interval, 6); // 6 frames for walking animation (4x6 sprite sheet)
}

// Custom Hook specifically for sprinting animation with proper frame sequence
// Creates smooth sprinting motion using 8 frames: 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> repeat
// Faster, more dynamic animation for sprinting
export function useSprintAnimationCycle(interval: number = 100): number {
  return useAnimationCycle(interval, 8); // 8 frames for sprinting animation (4x8 sprite sheet)
}

// Custom Hook specifically for idle animation with proper frame sequence
// Creates smooth idle motion using 16 frames: 0 -> 1 -> 2 -> ... -> 15 -> repeat
// Slower, more relaxed animation for idle state
export function useIdleAnimationCycle(interval: number = 250): number {
  return useAnimationCycle(interval, 16); // 16 frames for idle animation (4x4 sprite sheet)
}

// Simple breathing animation cycle for idle state
export function useBreathingAnimationCycle(interval: number = 800): number {
  return useAnimationCycle(interval, 2); // 2 frames for breathing
}

// Simplified item use animation cycle
export function useItemUseAnimationCycle(interval: number = 200): number {
  return useAnimationCycle(interval, 3); // 3 frames for item use
} 