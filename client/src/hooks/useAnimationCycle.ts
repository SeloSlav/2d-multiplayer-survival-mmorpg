// Replace the entire file content with optimized RAF-based animation

import { useState, useEffect, useRef, useCallback } from 'react';

// Base hook using RAF for all animations
export function useAnimationCycle(frameDuration: number, numFrames: number): number {
  const [animationFrame, setAnimationFrame] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);

  const animate = useCallback((time: number) => {
    if (lastFrameTimeRef.current === 0) {
      lastFrameTimeRef.current = time;
    }

    const deltaTime = time - lastFrameTimeRef.current;
    if (deltaTime >= frameDuration) {
      frameCountRef.current = (frameCountRef.current + 1) % numFrames;
      setAnimationFrame(frameCountRef.current);
      lastFrameTimeRef.current = time;
    }

    rafRef.current = requestAnimationFrame(animate);
  }, [frameDuration, numFrames]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [animate]);

  return animationFrame;
}

// Specific animation hooks with optimized frame rates
export function useWalkingAnimationCycle(): number {
  return useAnimationCycle(150, 4); // 150ms per frame, 4 frames
}

export function useSprintAnimationCycle(): number {
  return useAnimationCycle(100, 4); // 100ms per frame, 4 frames (faster)
}

export function useIdleAnimationCycle(): number {
  return useAnimationCycle(500, 4); // 500ms per frame, 4 frames (slower)
}