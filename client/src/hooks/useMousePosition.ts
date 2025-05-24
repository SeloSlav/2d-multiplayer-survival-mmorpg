import { useState, useEffect, useRef, RefObject } from 'react';

interface MousePosition {
  x: number | null;
  y: number | null;
}

interface UseMousePositionProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cameraOffsetX: number;
  cameraOffsetY: number;
  canvasSize: { width: number; height: number }; // Needed for scaling calculation
}

interface UseMousePositionResult {
  screenMousePos: MousePosition;
  worldMousePos: MousePosition;
  canvasMousePos: MousePosition;
}

/**
 * Tracks mouse position relative to the canvas and the game world.
 * OPTIMIZED: Uses refs instead of state to avoid re-renders on every mouse move.
 */
export function useMousePosition({
  canvasRef,
  cameraOffsetX,
  cameraOffsetY,
  canvasSize,
}: UseMousePositionProps): UseMousePositionResult {
  // Use refs for actual position tracking to avoid re-renders
  const screenMousePosRef = useRef<MousePosition>({ x: null, y: null });
  const worldMousePosRef = useRef<MousePosition>({ x: null, y: null });
  const canvasMousePosRef = useRef<MousePosition>({ x: null, y: null });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      // Calculate scale based on current canvas size and rect size
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      // Calculate screen coordinates
      const currentScreenX = (event.clientX - rect.left) * scaleX;
      const currentScreenY = (event.clientY - rect.top) * scaleY;
      screenMousePosRef.current = { x: currentScreenX, y: currentScreenY };

      // Calculate world coordinates using camera offset
      const currentWorldX = currentScreenX - cameraOffsetX;
      const currentWorldY = currentScreenY - cameraOffsetY;
      worldMousePosRef.current = { x: currentWorldX, y: currentWorldY };

      // Calculate canvas coordinates
      const canvasX = currentScreenX - rect.left;
      const canvasY = currentScreenY - rect.top;
      canvasMousePosRef.current = { x: canvasX, y: canvasY };
    };

    const handleMouseLeave = () => {
      screenMousePosRef.current = { x: null, y: null };
      worldMousePosRef.current = { x: null, y: null };
      canvasMousePosRef.current = { x: null, y: null };
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    // Cleanup listeners
    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  // Re-run effect if canvasRef, offsets, or canvasSize changes
  }, [canvasRef, cameraOffsetX, cameraOffsetY, canvasSize]);

  return {
    screenMousePos: screenMousePosRef.current,
    worldMousePos: worldMousePosRef.current,
    canvasMousePos: canvasMousePosRef.current,
  };
} 