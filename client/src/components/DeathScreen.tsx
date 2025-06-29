import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Player as SpacetimeDBPlayer, SleepingBag, Tree, Stone, Barrel, PlayerPin, Campfire, PlayerCorpse as SpacetimeDBPlayerCorpse, WorldState, DeathMarker as SpacetimeDBDeathMarker, MinimapCache } from '../generated'; // Corrected import
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
  barrels: Map<string, Barrel>;
  campfires: Map<string, Campfire>; // Use corrected type
  playerPin: PlayerPin | null;
  sleepingBagImage?: HTMLImageElement | null;
  // Add new props for death marker
  localPlayerDeathMarker?: SpacetimeDBDeathMarker | null;
  deathMarkerImage?: HTMLImageElement | null;
  worldState: WorldState | null; // <-- Fix type here
  minimapCache: MinimapCache | null; // Add minimapCache prop
  // Add new minimap icon image props
  pinMarkerImage?: HTMLImageElement | null;
  campfireWarmthImage?: HTMLImageElement | null;
  torchOnImage?: HTMLImageElement | null;
}

// Helper function to format death cause messages
const getDeathCauseMessage = (deathCause: string): string => {
  // Handle wild animal deaths
  if (deathCause === 'Cinder Fox') {
    return '🦊 Mauled by a Cinder Fox';
  } else if (deathCause === 'Tundra Wolf') {
    return '🐺 Killed by a Tundra Wolf';
  } else if (deathCause === 'Cable Viper') {
    return '🐍 Struck down by a Cable Viper';
  }
  
  // Handle other death causes
  switch (deathCause) {
    case 'Environment':
      return '💀 Died from environmental causes';
    case 'Suicide':
      return '⚰️ Took their own life';
    case 'Starvation':
      return '🍖 Starved to death';
    case 'Dehydration':
      return '💧 Died of thirst';
    case 'Exposure':
      return '🥶 Died from exposure';
    case 'Bleeding':
      return '🩸 Bled to death';
    case 'Knocked Out':
      return '💥 Died while unconscious';
    default:
      return `💀 Died from ${deathCause}`;
  }
};

const DeathScreen: React.FC<DeathScreenProps> = ({
  onRespawnRandomly,
  onRespawnAtBag,
  localPlayerIdentity,
  sleepingBags,
  players,
  trees,
  stones,
  barrels,
  campfires,
  playerPin,
  sleepingBagImage,
  // Destructure new props
  localPlayerDeathMarker,
  deathMarkerImage,
  worldState, // <-- Correct type
  minimapCache, // <-- Correct type
  // Destructure new minimap icon image props
  pinMarkerImage,
  campfireWarmthImage,
  torchOnImage,
}) => {
  // Add debug logging
  // console.log('[DeathScreen] Rendering with props:', {
  //   localPlayerIdentity,
  //   localPlayerDeathMarker: localPlayerDeathMarker ? 'present' : 'null',
  //   deathMarkerImage: deathMarkerImage ? 'loaded' : 'null',
  //   sleepingBagsSize: sleepingBags.size
  // });

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

  // --- Convert sleepingBags Map to use string keys for compatibility with drawMinimapOntoCanvas ---
  const sleepingBagsStringKeys = useMemo(() => {
    const converted: Map<string, SleepingBag> = new Map();
    sleepingBags.forEach((bag, id) => {
      converted.set(id.toString(), bag);
    });
    return converted;
  }, [sleepingBags]);

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

  // --- Find Nearest Sleeping Bag to Death Location ---
  const nearestBag = useMemo(() => {
    if (!localPlayerDeathMarker || ownedBags.size === 0) {
      return null;
    }

    let closest: SleepingBag | null = null;
    let minDistance = Infinity;

    ownedBags.forEach((bag) => {
      const dx = bag.posX - localPlayerDeathMarker.posX;
      const dy = bag.posY - localPlayerDeathMarker.posY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < minDistance) {
        minDistance = distance;
        closest = bag;
      }
    });

    return closest;
  }, [localPlayerDeathMarker, ownedBags]);
  const ownedSleepingBagIds = useMemo(() => new Set(ownedBags.keys()), [ownedBags]);

  // --- Block G key (minimap toggle) while death screen is open ---
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'G' || event.key === 'g') {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    // Add listener with capture to catch the event before other handlers
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, []);

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
      barrels,
      campfires,
      sleepingBags: sleepingBagsStringKeys, // Use converted map with string keys
      localPlayer: undefined, // Explicitly pass undefined for localPlayer
      localPlayerId: localPlayerIdentity ?? undefined,
      playerPin: null, // No player pin needed when dead/world centered
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      isMouseOverMinimap: false, // Not interactive hover state needed here
      zoomLevel: minimapZoom,
      viewCenterOffset,
      minimapCache, // Pass the minimap cache for terrain rendering
      // Pass death screen specific props
      isDeathScreen: true,
      ownedSleepingBagIds,
      sleepingBagImage,
      localPlayerDeathMarker,
      deathMarkerImage,
      worldState, // <-- Pass worldState for time of day
      // Pass new minimap icon images
      pinMarkerImage,
      campfireWarmthImage,
      torchOnImage,
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
    players, trees, stones, sleepingBagsStringKeys, ownedSleepingBagIds, hoveredBagId,
    canvasSize.width, canvasSize.height, localPlayer, localPlayerIdentity, minimapZoom, viewCenterOffset, sleepingBagImage,
    campfires,
    localPlayerDeathMarker,
    deathMarkerImage,
    worldState,
    minimapCache,
    // Add new image dependencies
    pinMarkerImage,
    campfireWarmthImage,
    torchOnImage,
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

  // Handler for nearest bag respawn
  const handleNearestBagRespawn = useCallback(() => {
    if (nearestBag) {
      onRespawnAtBag((nearestBag as SleepingBag).id);
    }
  }, [nearestBag, onRespawnAtBag]);

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
      
        
        {/* Death Cause Information */}
        {localPlayerDeathMarker && (
          <div style={styles.deathInfo}>
            {localPlayerDeathMarker.killedBy ? (
              <p style={styles.deathMessage}>
                Killed by {players.get(localPlayerDeathMarker.killedBy.toHexString())?.username || 'Unknown Player'}
              </p>
            ) : (
              <p style={styles.deathMessage}>
                {getDeathCauseMessage(localPlayerDeathMarker.deathCause)}
              </p>
            )}
          </div>
        )}
        
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

        {/* Respawn Buttons Container */}
        <div style={styles.buttonContainer}>
          {/* Random Respawn Button */} 
          <button
            onClick={onRespawnRandomly}
            style={styles.buttonEnabled} // Always enabled
          >
            Respawn Randomly
          </button>

          {/* Nearest Sleeping Bag Respawn Button */}
          {nearestBag ? (
            <button
              onClick={handleNearestBagRespawn}
              style={styles.buttonYellow}
            >
              Respawn at Nearest Sleeping Bag
            </button>
          ) : (
            <button
              disabled
              style={styles.buttonDisabled}
            >
              No Sleeping Bags Available
            </button>
          )}
        </div>
        
        {ownedBags.size === 0 && (
            <p style={styles.noBagsText}>No sleeping bags placed.</p>
        )}
      </div>
    </div>
  );
};

// Basic styling - UPDATED TO CYBERPUNK THEME
const styles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(15, 23, 35, 0.95)', // Dark cyberpunk background
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000, // Ensure it's above the canvas
    fontFamily: '"Courier New", monospace', // Cyberpunk monospace font
    color: '#ffffff',
    backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(0, 212, 255, 0.1) 0%, transparent 50%), radial-gradient(circle at 80% 50%, rgba(124, 58, 237, 0.1) 0%, transparent 50%)', // Subtle cyberpunk glow
  },
  container: {
    textAlign: 'center',
    padding: '40px',
    backgroundColor: 'rgba(30, 41, 59, 0.9)', // Dark slate with high opacity
    borderRadius: '8px',
    border: '2px solid #00d4ff', // Bright cyan border
    boxShadow: '0 0 20px rgba(0, 212, 255, 0.3), 0 0 40px rgba(124, 58, 237, 0.2)', // Cyan and purple glow
    backdropFilter: 'blur(10px)', // Glass morphism effect
  },
  title: {
    color: '#ff006e', // Neon pink
    fontSize: '2.5em',
    marginBottom: '20px',
    textShadow: '0 0 10px #ff006e, 2px 2px 4px #000000', // Neon glow + shadow
    fontWeight: 'bold',
    letterSpacing: '2px',
  },
  timerText: {
      fontSize: '1.2em',
      marginBottom: '30px',
      color: '#94a3b8', // Slate gray
      textShadow: '1px 1px 2px #000000',
  },
  buttonEnabled: {
    padding: '15px 30px',
    fontSize: '1.1em',
    fontFamily: '"Courier New", monospace',
    background: 'linear-gradient(135deg, #00d4ff 0%, #7c3aed 100%)', // Cyan to purple gradient
    color: '#ffffff',
    border: '2px solid #00d4ff',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    fontWeight: 'bold',
    boxShadow: '0 0 15px rgba(0, 212, 255, 0.4)',
  },
   buttonDisabled: {
    padding: '15px 30px',
    fontSize: '1.1em',
    fontFamily: '"Courier New", monospace',
    backgroundColor: 'rgba(71, 85, 105, 0.5)', // Dark slate
    color: '#64748b', // Muted slate
    border: '2px solid #475569',
    borderRadius: '6px',
    cursor: 'not-allowed',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    fontWeight: 'bold',
  },
  buttonContainer: {
    display: 'flex',
    gap: '15px',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  buttonYellow: {
    padding: '15px 30px',
    fontSize: '1.1em',
    fontFamily: '"Courier New", monospace',
    background: 'linear-gradient(135deg, #ffeb3b 0%, #ff9800 100%)', // Yellow to orange gradient
    color: '#000000', // Black text for better contrast on yellow
    border: '2px solid #ffeb3b',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    fontWeight: 'bold',
    boxShadow: '0 0 15px rgba(255, 235, 59, 0.4)',
    textShadow: '1px 1px 2px rgba(0, 0, 0, 0.3)',
  },
  // Enhanced minimap canvas styling
  minimapCanvas: {
      border: '2px solid #00d4ff', // Cyan border to match theme
      borderRadius: '4px',
      marginBottom: '25px', // More space before the button
      cursor: 'pointer', // Indicate it's clickable
      boxShadow: '0 0 15px rgba(0, 212, 255, 0.3)', // Subtle cyan glow
      backdropFilter: 'blur(5px)',
      display: 'block', // Ensure block display for margin centering
      marginLeft: 'auto', // Center horizontally
      marginRight: 'auto', // Center horizontally
  },
  noBagsText: {
    marginTop: '20px',
    fontSize: '0.9em',
    color: '#94a3b8', // Slate gray
    textShadow: '1px 1px 2px #000000',
    fontStyle: 'italic',
  },
  deathInfo: {
    marginBottom: '25px',
    padding: '15px',
    backgroundColor: 'rgba(239, 68, 68, 0.1)', // Subtle red background
    borderRadius: '6px',
    border: '1px solid #ef4444',
  },
  deathMessage: {
    fontSize: '1.2em',
    marginBottom: '10px',
    color: '#fecaca', // Light red
    textShadow: '1px 1px 2px #000000',
    fontWeight: 'bold',
  },
};

export default DeathScreen; 