import { useState, useEffect, useRef } from 'react';
import { Grass as SpacetimeDBGrass, GrassAppearanceType } from '../generated'; // Assuming generated types
import { Timestamp as SpacetimeDBTimestamp } from '@clockworklabs/spacetimedb-sdk'; // For Timestamp type

// Define a server update interval, though grass position is static,
// this can be relevant if other properties change frequently or for consistency.
// For grass, this might represent how long we consider its state "fresh"
// or how often we expect non-positional updates.
// Given grass is mostly static, this value is less critical than for clouds.
const GRASS_DATA_REFRESH_INTERVAL_MS = 5000; // Arbitrary, adjust if needed

interface GrassInterpolationState {
  id: string; // Keep id as string (from map key)
  originalId: bigint; // Store original u64 ID from SpacetimeDBGrass if needed

  // Server data - base position
  serverPosX: number;
  serverPosY: number;

  // For BaseEntity compatibility
  posX: number;
  posY: number;

  // For grass, these are effectively the same as serverPos, as position is static
  lastKnownPosX: number;
  lastKnownPosY: number;
  targetPosX: number;
  targetPosY: number;

  // Animation timing (when this state was last updated from server data)
  lastServerUpdateTimeMs: number;

  // Pass-through properties from SpacetimeDBGrass
  health: number;
  appearanceType: GrassAppearanceType;
  chunkIndex: number;
  swayOffsetSeed: number;
  swaySpeed: number;
  lastHitTime: SpacetimeDBTimestamp | null;
  respawnAt: SpacetimeDBTimestamp | null;
  
  // NEW: Disturbance tracking fields
  disturbedAt: SpacetimeDBTimestamp | null;
  disturbanceDirectionX: number;
  disturbanceDirectionY: number;
}

// Output structure, including current render position (which is server position for grass)
export interface InterpolatedGrassData extends GrassInterpolationState {
  currentRenderPosX: number;
  currentRenderPosY: number;
  // posX and posY will be inherited from GrassInterpolationState
}

interface UseGrassInterpolationProps {
  serverGrass: Map<string, SpacetimeDBGrass>; // Key is string representation of u64 ID
  deltaTime: number; // Milliseconds since last frame (currently unused for grass pos)
}

export const useGrassInterpolation = ({
  serverGrass,
  deltaTime, // deltaTime is currently unused as grass position is static.
}: UseGrassInterpolationProps): Map<string, InterpolatedGrassData> => {
  const [interpolatedGrassStates, setInterpolatedGrassStates] = useState<Map<string, GrassInterpolationState>>(() => new Map());
  const [renderableGrass, setRenderableGrass] = useState<Map<string, InterpolatedGrassData>>(() => new Map());

  const prevServerGrassRef = useRef<Map<string, SpacetimeDBGrass>>(new Map());

  // Effect to update interpolation states when server data changes
  useEffect(() => {
    const newStates = new Map(interpolatedGrassStates);
    const now = performance.now();
    let changed = false;

    // Update existing or add new grass entities
    serverGrass.forEach((currentServerGrass, id) => {
      const prevState = newStates.get(id);
      const prevServerGrassInstance = prevServerGrassRef.current.get(id);

      // Check if any relevant property of the grass has changed or if it's a new grass entity.
      // For grass, posX/posY are static. We care about existence, health, appearance, etc.
      const grassDataChanged = !prevServerGrassInstance ||
                                prevServerGrassInstance.health !== currentServerGrass.health ||
                                prevServerGrassInstance.appearanceType !== currentServerGrass.appearanceType ||
                                prevServerGrassInstance.chunkIndex !== currentServerGrass.chunkIndex ||
                                prevServerGrassInstance.swayOffsetSeed !== currentServerGrass.swayOffsetSeed ||
                                prevServerGrassInstance.swaySpeed !== currentServerGrass.swaySpeed ||
                                !Object.is(prevServerGrassInstance.lastHitTime, currentServerGrass.lastHitTime) ||
                                !Object.is(prevServerGrassInstance.respawnAt, currentServerGrass.respawnAt) ||
                                !Object.is((prevServerGrassInstance as any).disturbedAt, (currentServerGrass as any).disturbedAt) ||
                                (prevServerGrassInstance as any).disturbanceDirectionX !== (currentServerGrass as any).disturbanceDirectionX ||
                                (prevServerGrassInstance as any).disturbanceDirectionY !== (currentServerGrass as any).disturbanceDirectionY;


      if (!prevState || grassDataChanged) { // New grass or its data has been updated
        changed = true;
        
        newStates.set(id, {
          id,
          originalId: currentServerGrass.id, // Store original u64 id
          serverPosX: currentServerGrass.posX,
          serverPosY: currentServerGrass.posY,
          posX: currentServerGrass.posX, // For BaseEntity compatibility
          posY: currentServerGrass.posY, // For BaseEntity compatibility
          // For static grass, lastKnown and target are the same as server position
          lastKnownPosX: currentServerGrass.posX,
          lastKnownPosY: currentServerGrass.posY,
          targetPosX: currentServerGrass.posX,
          targetPosY: currentServerGrass.posY,
          lastServerUpdateTimeMs: now,
          // Pass through other rendering properties
          health: currentServerGrass.health,
          appearanceType: currentServerGrass.appearanceType,
          chunkIndex: currentServerGrass.chunkIndex,
          swayOffsetSeed: currentServerGrass.swayOffsetSeed,
          swaySpeed: currentServerGrass.swaySpeed,
          lastHitTime: currentServerGrass.lastHitTime ?? null,
          respawnAt: currentServerGrass.respawnAt ?? null,
          disturbedAt: (currentServerGrass as any).disturbedAt ?? null,
          disturbanceDirectionX: (currentServerGrass as any).disturbanceDirectionX ?? 0,
          disturbanceDirectionY: (currentServerGrass as any).disturbanceDirectionY ?? 0,
        });
      }
    });

    // Remove grass entities that are no longer in serverGrass
    interpolatedGrassStates.forEach((_, id) => {
      if (!serverGrass.has(id)) {
        changed = true;
        newStates.delete(id);
      }
    });

    if (changed) {
      setInterpolatedGrassStates(newStates);
    }
    // Update the ref for the next comparison
    prevServerGrassRef.current = new Map(Array.from(serverGrass.entries()).map(([id, grass]) => [id, { ...grass }]));

  }, [serverGrass]); // Only re-run when serverGrass prop itself changes identity

  // Effect to prepare renderable grass data from interpolated states
  // For grass, this is straightforward as currentRenderPos is targetPos.
  useEffect(() => {
    // deltaTime is not used here for grass as its base position is static.
    // The "sway" animation is handled during the rendering phase using swayOffsetSeed and time.
    const newRenderables = new Map<string, InterpolatedGrassData>();

    interpolatedGrassStates.forEach((state, id) => {
      newRenderables.set(id, {
        ...state,
        currentRenderPosX: state.targetPosX, // Static position
        currentRenderPosY: state.targetPosY, // Static position
      });
    });
    setRenderableGrass(newRenderables);
  }, [interpolatedGrassStates]); // Re-run when interpolatedGrassStates change

  return renderableGrass;
}; 