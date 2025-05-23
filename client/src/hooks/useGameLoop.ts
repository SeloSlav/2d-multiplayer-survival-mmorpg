import { useEffect, useRef, useCallback } from 'react';

interface GameLoopOptions {
  targetFPS?: number;
  maxFrameTime?: number;
  enableProfiling?: boolean;
}

export interface FrameInfo {
  deltaTime: number;
  frameCount: number;
  fps: number;
}

/**
 * Manages a requestAnimationFrame loop with performance monitoring.
 * @param callback - The function to call on each animation frame. Receives (frameInfo) => void
 * @param options - Configuration options for the game loop.
 */
export function useGameLoop(
  callback: (frameInfo: FrameInfo) => void,
  options: GameLoopOptions = {}
): void {
  const {
    targetFPS = 60,
    maxFrameTime = 16.67, // ~60fps target
    enableProfiling = process.env.NODE_ENV === 'development'
  } = options;

  const requestIdRef = useRef<number>(0);
  const savedCallback = useRef(callback);
  const lastTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const fpsCounterRef = useRef({ frames: 0, lastSecond: 0 });
  const currentFpsRef = useRef<number>(60);
  
  const performanceMetricsRef = useRef({
    slowFrames: 0,
    totalFrames: 0,
    maxFrameTime: 0,
    recentFrameTimes: [] as number[]
  });

  // Update the saved callback function if it changes
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // Performance monitoring
  const updateMetrics = useCallback((frameTime: number) => {
    const metrics = performanceMetricsRef.current;
    metrics.totalFrames++;
    
    if (frameTime > maxFrameTime) {
      metrics.slowFrames++;
    }
    
    metrics.maxFrameTime = Math.max(metrics.maxFrameTime, frameTime);
    
    // Keep last 60 frame times for analysis
    metrics.recentFrameTimes.push(frameTime);
    if (metrics.recentFrameTimes.length > 60) {
      metrics.recentFrameTimes.shift();
    }
  }, [maxFrameTime]);

  const logSlowFrame = useCallback((frameTime: number, frameCount: number) => {
    if (enableProfiling) {
      const metrics = performanceMetricsRef.current;
      const avgRecent = metrics.recentFrameTimes.length > 0 
        ? metrics.recentFrameTimes.reduce((a, b) => a + b, 0) / metrics.recentFrameTimes.length 
        : 0;

      console.warn(
        `🐌 [useGameLoop] SLOW FRAME DETECTED!\n` +
        `  Frame #${frameCount}: ${frameTime.toFixed(2)}ms (${(frameTime / maxFrameTime * 100).toFixed(0)}% over budget)\n` +
        `  Target: ${maxFrameTime.toFixed(2)}ms | Recent avg: ${avgRecent.toFixed(2)}ms\n` +
        `  Slow frames: ${metrics.slowFrames}/${metrics.totalFrames} (${(metrics.slowFrames / metrics.totalFrames * 100).toFixed(1)}%)\n` +
        `  💡 Check your callback for expensive operations!`
      );
    }
  }, [maxFrameTime, enableProfiling]);

  // Effect to manage the animation frame loop
  useEffect(() => {
    let startTime = performance.now();
    lastTimeRef.current = startTime;
    frameCountRef.current = 0;
    fpsCounterRef.current = { frames: 0, lastSecond: Math.floor(startTime / 1000) };

    const loop = (currentTime: number) => {
      const frameStartTime = performance.now();
      const deltaTime = currentTime - lastTimeRef.current;
      lastTimeRef.current = currentTime;
      frameCountRef.current++;

      // Calculate FPS
      const currentSecond = Math.floor(currentTime / 1000);
      if (currentSecond !== fpsCounterRef.current.lastSecond) {
        currentFpsRef.current = fpsCounterRef.current.frames;
        fpsCounterRef.current = { frames: 0, lastSecond: currentSecond };
      }
      fpsCounterRef.current.frames++;

      // Prepare frame info
      const frameInfo: FrameInfo = {
        deltaTime,
        frameCount: frameCountRef.current,
        fps: currentFpsRef.current
      };

      try {
        // Call the user's callback
        savedCallback.current(frameInfo);
      } catch (error) {
        console.error('[useGameLoop] Error in callback:', error);
      }

      const frameEndTime = performance.now();
      const frameTime = frameEndTime - frameStartTime;

      // Update performance metrics
      updateMetrics(frameTime);

      // Warn about slow frames
      if (frameTime > maxFrameTime) {
        logSlowFrame(frameTime, frameCountRef.current);
      }

      // Periodic performance summary
      if (enableProfiling && frameCountRef.current % 600 === 0) { // Every ~10 seconds at 60fps
        const metrics = performanceMetricsRef.current;
        const avgRecent = metrics.recentFrameTimes.length > 0 
          ? metrics.recentFrameTimes.reduce((a, b) => a + b, 0) / metrics.recentFrameTimes.length 
          : 0;
        
        console.log(
          `📊 [useGameLoop] Performance Summary (${frameCountRef.current} frames):\n` +
          `  FPS: ${currentFpsRef.current} | Avg frame time: ${avgRecent.toFixed(2)}ms\n` +
          `  Slow frames: ${metrics.slowFrames} (${(metrics.slowFrames / metrics.totalFrames * 100).toFixed(1)}%)\n` +
          `  Max frame time: ${metrics.maxFrameTime.toFixed(2)}ms`
        );
      }

      // Request the next frame
      requestIdRef.current = requestAnimationFrame(loop);
    };

    // Start the loop
    if (enableProfiling) {
      console.log(`🎮 [useGameLoop] Starting game loop. Target: ${targetFPS}fps (${maxFrameTime.toFixed(2)}ms budget per frame)`);
    }
    requestIdRef.current = requestAnimationFrame(loop);

    // Cleanup function
    return () => {
      if (enableProfiling) {
        const metrics = performanceMetricsRef.current;
        console.log(
          `🛑 [useGameLoop] Stopping game loop.\n` +
          `  Total frames: ${metrics.totalFrames}\n` +
          `  Slow frames: ${metrics.slowFrames} (${metrics.totalFrames > 0 ? (metrics.slowFrames / metrics.totalFrames * 100).toFixed(1) : 0}%)\n` +
          `  Max frame time: ${metrics.maxFrameTime.toFixed(2)}ms`
        );
      }
      cancelAnimationFrame(requestIdRef.current);
    };
  }, [targetFPS, maxFrameTime, enableProfiling, logSlowFrame, updateMetrics]);
} 