import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Player, ItemDefinition } from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import { FISHING_CONSTANTS } from '../types/fishing';

interface FishingReticleProps {
  localPlayer: Player | null;
  playerIdentity: Identity | null;
  activeItemDef: ItemDefinition | null;
  gameCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  cameraOffsetX: number;
  cameraOffsetY: number;
  onCast: (worldX: number, worldY: number) => void;
  isWaterTile: (worldX: number, worldY: number) => boolean;
}

const FishingReticle: React.FC<FishingReticleProps> = ({
  localPlayer,
  playerIdentity,
  activeItemDef,
  gameCanvasRef,
  cameraOffsetX,
  cameraOffsetY,
  onCast,
  isWaterTile,
}) => {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isValidTarget, setIsValidTarget] = useState(false);
  const reticleRef = useRef<HTMLDivElement>(null);
  const canvasRectRef = useRef<DOMRect | null>(null);
  const lastUpdateRef = useRef<number>(0);

  // Check if player has a valid fishing rod
  const hasValidRod = activeItemDef && FISHING_CONSTANTS.VALID_FISHING_RODS.some(rod => rod === activeItemDef.name);

  // Cache canvas rect and update it less frequently
  const updateCanvasRect = useCallback(() => {
    if (gameCanvasRef.current) {
      canvasRectRef.current = gameCanvasRef.current.getBoundingClientRect();
    }
  }, [gameCanvasRef]);

  // Update canvas rect on mount and when camera changes
  useEffect(() => {
    updateCanvasRect();
    // Also update on window resize
    window.addEventListener('resize', updateCanvasRect);
    return () => window.removeEventListener('resize', updateCanvasRect);
  }, [updateCanvasRect, cameraOffsetX, cameraOffsetY]);

  // Memoize fishing range squared to avoid Math.sqrt in distance checks
  const fishingRangeSquared = useMemo(() => FISHING_CONSTANTS.RANGE * FISHING_CONSTANTS.RANGE, []);

  // Throttled validation function
  const validateTarget = useCallback((worldX: number, worldY: number, playerWorldX: number, playerWorldY: number) => {
    // Use squared distance to avoid Math.sqrt
    const distanceSquared = (worldX - playerWorldX) ** 2 + (worldY - playerWorldY) ** 2;
    const inRange = distanceSquared <= fishingRangeSquared;
    
    // Early return if not in range - avoid expensive water tile check
    if (!inRange) return false;
    
    // Only check water tile if in range
    return isWaterTile(worldX, worldY);
  }, [isWaterTile, fishingRangeSquared]);

  useEffect(() => {
    if (!hasValidRod || !localPlayer || !gameCanvasRef.current) return;

    updateCanvasRect(); // Ensure we have fresh canvas rect

    const handleMouseMove = (event: MouseEvent) => {
      // Throttle updates to ~60fps max
      const now = performance.now();
      if (now - lastUpdateRef.current < 16) return; // ~60fps throttling
      lastUpdateRef.current = now;

      if (!canvasRectRef.current) return;

      // Calculate mouse position relative to canvas using cached rect
      const mouseX = event.clientX - canvasRectRef.current.left;
      const mouseY = event.clientY - canvasRectRef.current.top;
      
      // Convert to world coordinates
      const worldX = mouseX - cameraOffsetX;
      const worldY = mouseY - cameraOffsetY;
      
      const playerWorldX = localPlayer.positionX;
      const playerWorldY = localPlayer.positionY;
      
      const valid = validateTarget(worldX, worldY, playerWorldX, playerWorldY);
      
      setMousePos({ x: event.clientX, y: event.clientY });
      setIsValidTarget(valid);
    };

    const handleLeftClick = (event: MouseEvent) => {
      // Only handle left clicks (button 0)
      if (event.button !== 0) return;
      
      if (!isValidTarget || !canvasRectRef.current) {
        console.log('[FishingReticle] Invalid target, not casting');
        return;
      }

      // Calculate world coordinates using cached rect
      const mouseX = event.clientX - canvasRectRef.current.left;
      const mouseY = event.clientY - canvasRectRef.current.top;
      const worldX = mouseX - cameraOffsetX;
      const worldY = mouseY - cameraOffsetY;
      
      console.log('[FishingReticle] Casting at:', { worldX, worldY });
      
      // Prevent default and stop propagation
      event.preventDefault();
      event.stopPropagation();
      
      onCast(worldX, worldY);
    };

    // Add event listeners
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleLeftClick, true);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleLeftClick, true);
    };
  }, [hasValidRod, localPlayer, gameCanvasRef, cameraOffsetX, cameraOffsetY, isValidTarget, onCast, validateTarget, updateCanvasRect]);

  // Don't render if no valid fishing rod
  if (!hasValidRod) {
    return null;
  }

  return (
    <>
      {/* Fishing reticle */}
      <div
        ref={reticleRef}
        style={{
          position: 'fixed',
          left: mousePos.x - 20,
          top: mousePos.y - 20,
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          border: `3px solid ${isValidTarget ? '#64c8ff' : '#ff6464'}`,
          backgroundColor: `${isValidTarget ? 'rgba(100, 200, 255, 0.2)' : 'rgba(255, 100, 100, 0.2)'}`,
          pointerEvents: 'none',
          zIndex: 10000,
          transition: 'all 0.1s ease-out',
          boxShadow: `0 0 10px ${isValidTarget ? '#64c8ff' : '#ff6464'}`,
        }}
      >
        {/* Center dot */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '4px',
            height: '4px',
            backgroundColor: isValidTarget ? '#64c8ff' : '#ff6464',
            borderRadius: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        />
        
        {/* Crosshair lines */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '2px',
            right: '2px',
            height: '1px',
            backgroundColor: isValidTarget ? '#64c8ff' : '#ff6464',
            transform: 'translateY(-50%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '2px',
            bottom: '2px',
            width: '1px',
            backgroundColor: isValidTarget ? '#64c8ff' : '#ff6464',
            transform: 'translateX(-50%)',
          }}
        />
      </div>
      
      {/* Fishing instructions */}
      <div
        style={{
          position: 'fixed',
          top: '130px',
          right: '15px',
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          color: '#64c8ff',
          padding: '12px 16px',
          borderRadius: '8px',
          fontSize: '13px',
          zIndex: 9999,
          border: '2px solid #64c8ff',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          backdropFilter: 'blur(4px)',
          minWidth: '180px',
        }}
      >
        <div style={{ marginBottom: '6px', fontWeight: 'bold', fontSize: '14px' }}>🎣 Fishing Mode</div>
        <div style={{ marginBottom: '4px' }}>Left-click on water to cast</div>
        <div style={{ fontSize: '11px', opacity: 0.8, fontStyle: 'italic' }}>
          {isValidTarget ? '✓ Valid target' : '⚠ Move to water within range'}
        </div>
      </div>
    </>
  );
};

export default FishingReticle;