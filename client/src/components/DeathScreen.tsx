import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Player as SpacetimeDBPlayer, SleepingBag, Tree, Stone, PlayerPin, Campfire, PlayerCorpse as SpacetimeDBPlayerCorpse, WorldState, DeathMarker as SpacetimeDBDeathMarker } from '../generated'; // Corrected import
import { drawMinimapOntoCanvas, MINIMAP_DIMENSIONS, worldToMinimapCoords, calculateMinimapViewport } from './Minimap'; // Import Minimap drawing and helpers
import { gameConfig } from '../config/gameConfig'; // Import gameConfig

interface DeathScreenProps {
  // Remove old props
  // respawnAt: number;
  // onRespawn: () => void;

  // Add new props
  onRespawnRandomly: () => void;
  onRespawnAtBag: (bagId: number) => void;
  localPlayerIdentity: string | null;
  sleepingBags: Map<number, SleepingBag>;
  players: Map<string, SpacetimeDBPlayer>;
  trees: Map<string, Tree>;
  stones: Map<string, Stone>;
  campfires: Map<string, Campfire>; // Use corrected type
  playerPin: PlayerPin | null;
  sleepingBagImage?: HTMLImageElement | null;
  // Add new props for death marker
  localPlayerDeathMarker?: SpacetimeDBDeathMarker | null;
  deathMarkerImage?: HTMLImageElement | null;
  worldState: WorldState | null; // <-- Fix type here
}

const DeathScreen: React.FC<DeathScreenProps> = ({
  onRespawnRandomly,
  onRespawnAtBag,
  localPlayerIdentity,
  sleepingBags,
  players,
  trees,
  stones,
  campfires,
  playerPin,
  sleepingBagImage,
  // Destructure new props
  localPlayerDeathMarker,
  deathMarkerImage,
  worldState, // <-- Correct type
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: MINIMAP_DIMENSIONS.width, height: MINIMAP_DIMENSIONS.height });
  const [hoveredBagId, setHoveredBagId] = useState<number | null>(null);

  // --- Minimap State (Simplified for static view) ---
  // Fixed zoom level for death screen minimap
  const minimapZoom = 1;
  // No panning on death screen
  const viewCenterOffset = { x: 0, y: 0 };
  // Player data is not strictly needed if we center the world
  const localPlayer = localPlayerIdentity ? players.get(localPlayerIdentity) : undefined;

  // --- Calculate Owned Sleeping Bags --- 
  const ownedBags = useMemo(() => {
    const owned: Map<number, SleepingBag> = new Map();
    if (!localPlayerIdentity) {
        // console.log("[DeathScreen] No localPlayerIdentity, cannot find owned bags.");
        return owned;
    }
    // console.log("[DeathScreen] Calculating owned bags. Identity:", localPlayerIdentity, "Received bags map:", sleepingBags);
    sleepingBags.forEach((bag) => {
      // Compare string representations of identities
      // console.log(`[DeathScreen] Checking bag ID ${bag.id}, placedBy: ${bag.placedBy.toHexString()}`);
      if (bag.placedBy.toHexString() === localPlayerIdentity) {
        // console.log(`[DeathScreen] -- Found owned bag: ${bag.id}`);
        owned.set(bag.id, bag);
      }
    });
    // console.log("[DeathScreen] Final ownedBags map size:", owned.size);
    return owned;
  }, [sleepingBags, localPlayerIdentity]);
  const ownedSleepingBagIds = useMemo(() => new Set(ownedBags.keys()), [ownedBags]);

  // --- Draw Minimap Effect ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use helper to get viewport calculations
    const worldPixelWidth = gameConfig.worldWidth * gameConfig.tileSize;
    const worldPixelHeight = gameConfig.worldHeight * gameConfig.tileSize;
    const { currentScale, drawOffsetX, drawOffsetY } = calculateMinimapViewport(
        canvasSize.width, canvasSize.height,
        worldPixelWidth, worldPixelHeight,
        minimapZoom, // Use fixed zoom
        undefined, // Center world view, not player
        viewCenterOffset
    );

    // Draw the minimap using the imported function
    drawMinimapOntoCanvas({
      ctx,
      players, // Pass all players for context if needed
      trees,
      stones,
      campfires,
      sleepingBags,
      localPlayer: undefined, // Explicitly pass undefined for localPlayer
      localPlayerId: localPlayerIdentity ?? undefined,
      playerPin: null, // No player pin needed when dead/world centered
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      isMouseOverMinimap: false, // Not interactive hover state needed here
      zoomLevel: minimapZoom,
      viewCenterOffset,
      // Pass death screen specific props
      isDeathScreen: true,
      ownedSleepingBagIds,
      sleepingBagImage,
      localPlayerDeathMarker,
      deathMarkerImage,
      worldState, // <-- Pass worldState for time of day
    });

    // Draw hover effect (simple circle) - This is illustrative
    if (hoveredBagId) {
        const bag = ownedBags.get(hoveredBagId);
        if (bag) {
            const coords = worldToMinimapCoords(
                bag.posX, bag.posY,
                0, 0, canvasSize.width, canvasSize.height, // Minimap relative coords
                drawOffsetX, drawOffsetY, currentScale
            );
            if (coords) {
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(coords.x, coords.y, 8, 0, Math.PI * 2); // Draw circle around
                ctx.stroke();
            }
        }
    }

  }, [
    players, trees, stones, sleepingBags, ownedSleepingBagIds, hoveredBagId,
    canvasSize.width, canvasSize.height, localPlayer, localPlayerIdentity, minimapZoom, viewCenterOffset, sleepingBagImage,
    campfires,
    localPlayerDeathMarker,
    deathMarkerImage,
    worldState,
  ]);

  // --- Click Handler for Minimap Canvas ---
  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    // Use helper to get viewport calculations
    const worldPixelWidth = gameConfig.worldWidth * gameConfig.tileSize;
    const worldPixelHeight = gameConfig.worldHeight * gameConfig.tileSize;
    const { currentScale, drawOffsetX, drawOffsetY } = calculateMinimapViewport(
        canvasSize.width, canvasSize.height,
        worldPixelWidth, worldPixelHeight,
        minimapZoom, undefined, viewCenterOffset
    );

    let clickedBagId: number | null = null;
    let minDistanceSq = Infinity;
    const CLICK_RADIUS_SQ = 15 * 15; // Generous click radius

    ownedBags.forEach((bag) => {
      const screenCoords = worldToMinimapCoords(
          bag.posX, bag.posY,
          0, 0, canvasSize.width, canvasSize.height, // Minimap relative coords
          drawOffsetX, drawOffsetY, currentScale
      );
      if (screenCoords) {
        const dx = clickX - screenCoords.x;
        const dy = clickY - screenCoords.y;
        const distanceSq = dx * dx + dy * dy;

        if (distanceSq < CLICK_RADIUS_SQ && distanceSq < minDistanceSq) {
          minDistanceSq = distanceSq;
          clickedBagId = bag.id;
        }
      }
    });

    if (clickedBagId !== null) {
      // console.log("Clicked on owned sleeping bag:", clickedBagId);
      onRespawnAtBag(clickedBagId);
    }
  }, [ownedBags, onRespawnAtBag, canvasSize, minimapZoom, viewCenterOffset]);

  // --- Hover Handler for Minimap Canvas (Optional) ---
   const handleCanvasMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const worldPixelWidth = gameConfig.worldWidth * gameConfig.tileSize;
    const worldPixelHeight = gameConfig.worldHeight * gameConfig.tileSize;
    const { currentScale, drawOffsetX, drawOffsetY } = calculateMinimapViewport(
        canvasSize.width, canvasSize.height,
        worldPixelWidth, worldPixelHeight,
        minimapZoom, undefined, viewCenterOffset
    );

    let closestBagId: number | null = null;
    let minDistanceSq = Infinity;
    const HOVER_RADIUS_SQ = 10 * 10;

    ownedBags.forEach((bag) => {
      const screenCoords = worldToMinimapCoords(
          bag.posX, bag.posY,
          0, 0, canvasSize.width, canvasSize.height,
          drawOffsetX, drawOffsetY, currentScale
      );
      if (screenCoords) {
        const dx = mouseX - screenCoords.x;
        const dy = mouseY - screenCoords.y;
        const distanceSq = dx * dx + dy * dy;

        if (distanceSq < HOVER_RADIUS_SQ && distanceSq < minDistanceSq) {
          minDistanceSq = distanceSq;
          closestBagId = bag.id;
        }
      }
    });

    setHoveredBagId(closestBagId);

  }, [ownedBags, canvasSize, minimapZoom, viewCenterOffset]);

  const handleCanvasMouseLeave = useCallback(() => {
     setHoveredBagId(null);
  }, []);

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        <h1 style={styles.title}>Select Respawn Point</h1>
        
        {/* Minimap Canvas */} 
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          style={styles.minimapCanvas} // Add specific style
          onClick={handleCanvasClick} // Add click handler
          onMouseMove={handleCanvasMouseMove} // Add mouse move for hover
          onMouseLeave={handleCanvasMouseLeave} // Clear hover on leave
        />

        {/* Random Respawn Button */} 
        <button
          onClick={onRespawnRandomly}
          style={styles.buttonEnabled} // Always enabled
        >
          Respawn Randomly
        </button>
        
        {ownedBags.size === 0 && (
            <p style={styles.noBagsText}>No sleeping bags placed.</p>
        )}
      </div>
    </div>
  );
};

// Basic styling - can be moved to CSS/modules later
const styles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(255, 0, 0, 0.8)', // <<< TEMPORARY: Bright red background for debugging
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000, // Ensure it's above the canvas
    fontFamily: '"Press Start 2P", cursive', // Match game font
    color: 'white',
  },
  container: {
    textAlign: 'center',
    padding: '40px',
    backgroundColor: 'rgba(50, 50, 50, 0.8)',
    borderRadius: '10px',
  },
  title: {
    color: '#DC143C', // Crimson Red
    fontSize: '2.5em',
    marginBottom: '20px',
    textShadow: '2px 2px 4px #000000',
  },
  timerText: {
      fontSize: '1.2em',
      marginBottom: '30px',
  },
  buttonEnabled: {
    padding: '15px 30px',
    fontSize: '1.2em',
    fontFamily: '"Press Start 2P", cursive',
    backgroundColor: '#4CAF50', // Green
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    transition: 'background-color 0.3s',
  },
   buttonDisabled: {
    padding: '15px 30px',
    fontSize: '1.2em',
    fontFamily: '"Press Start 2P", cursive',
    backgroundColor: '#777', // Grey
    color: '#ccc',
    border: 'none',
    borderRadius: '5px',
    cursor: 'not-allowed',
  },
  // Add style for the minimap canvas itself
  minimapCanvas: {
      border: '1px solid #a0a0c0', // Border like the original minimap
      marginBottom: '20px', // Space before the button
      cursor: 'pointer', // Indicate it's clickable
  },
  noBagsText: {
    marginTop: '15px',
    fontSize: '0.9em',
    color: '#cccccc',
  },
};

export default DeathScreen; 