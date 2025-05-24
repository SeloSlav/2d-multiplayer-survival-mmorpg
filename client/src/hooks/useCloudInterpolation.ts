import { useState, useEffect, useRef, useCallback } from 'react';
import { Cloud as SpacetimeDBCloud, CloudShapeType } from '../generated'; // Assuming generated types

const SERVER_UPDATE_INTERVAL_MS = 5000; // Cloud position updates from server every 5 seconds

interface CloudInterpolationState {
  id: string; // Keep id for keying
  // Raw server data (or latest processed server data)
  serverPosX: number;
  serverPosY: number;
  // Interpolation points
  lastKnownPosX: number;
  lastKnownPosY: number;
  targetPosX: number;
  targetPosY: number;
  // Animation timing
  lastServerUpdateTimeMs: number; // When the server data for targetPos was received/processed
  // Other rendering properties (pass through from server data)
  width: number;
  height: number;
  rotationDegrees: number;
  baseOpacity: number;
  blurStrength: number;
  shape: CloudShapeType;
}

// Output structure, including current render position
export interface InterpolatedCloudData extends CloudInterpolationState {
  currentRenderPosX: number;
  currentRenderPosY: number;
}

interface UseCloudInterpolationProps {
  serverClouds: Map<string, SpacetimeDBCloud>;
  deltaTime: number; // Milliseconds since last frame
}

const lerp = (start: number, end: number, t: number): number => {
  return start * (1 - t) + end * t;
};

export const useCloudInterpolation = ({
  serverClouds,
  deltaTime,
}: UseCloudInterpolationProps): Map<string, InterpolatedCloudData> => {
  const [interpolatedCloudStates, setInterpolatedCloudStates] = useState<Map<string, CloudInterpolationState>>(() => new Map());
  const [renderableClouds, setRenderableClouds] = useState<Map<string, InterpolatedCloudData>>(() => new Map());

  // Ref to store the previous serverClouds to detect actual data changes
  const prevServerCloudsRef = useRef<Map<string, SpacetimeDBCloud>>(new Map());

  // Effect to update interpolation targets when server data changes
  useEffect(() => {
    const newStates = new Map(interpolatedCloudStates);
    const now = performance.now();
    let changed = false;

    // Update existing or add new clouds
    serverClouds.forEach((serverCloud, id) => {
      const prevState = newStates.get(id);
      const prevServerCloud = prevServerCloudsRef.current.get(id);

      // Check if the server position for this cloud has actually changed
      // or if it's a new cloud.
      const serverPositionChanged = !prevServerCloud || 
                                    prevServerCloud.posX !== serverCloud.posX || 
                                    prevServerCloud.posY !== serverCloud.posY;

      if (!prevState || serverPositionChanged) { // New cloud or server sent an update
        changed = true;
        const currentRenderX = prevState?.targetPosX ?? serverCloud.posX;
        const currentRenderY = prevState?.targetPosY ?? serverCloud.posY;

        newStates.set(id, {
          id,
          serverPosX: serverCloud.posX,
          serverPosY: serverCloud.posY,
          lastKnownPosX: prevState && serverPositionChanged ? currentRenderX : serverCloud.posX,
          lastKnownPosY: prevState && serverPositionChanged ? currentRenderY : serverCloud.posY,
          targetPosX: serverCloud.posX,
          targetPosY: serverCloud.posY,
          lastServerUpdateTimeMs: now,
          // Pass through other rendering properties
          width: serverCloud.width,
          height: serverCloud.height,
          rotationDegrees: serverCloud.rotationDegrees,
          baseOpacity: serverCloud.baseOpacity,
          blurStrength: serverCloud.blurStrength,
          shape: serverCloud.shape,
        });
      } else if (prevState) {
        // If server position hasn't changed, ensure other visual props are up-to-date
        // (though clouds are unlikely to change these without moving)
        if (prevState.width !== serverCloud.width ||
            prevState.height !== serverCloud.height ||
            prevState.rotationDegrees !== serverCloud.rotationDegrees ||
            prevState.baseOpacity !== serverCloud.baseOpacity ||
            prevState.blurStrength !== serverCloud.blurStrength ||
            !Object.is(prevState.shape, serverCloud.shape) // For object comparison
        ) {
            changed = true;
            newStates.set(id, {
                ...prevState,
                width: serverCloud.width,
                height: serverCloud.height,
                rotationDegrees: serverCloud.rotationDegrees,
                baseOpacity: serverCloud.baseOpacity,
                blurStrength: serverCloud.blurStrength,
                shape: serverCloud.shape,
            });
        }
      }
    });

    // Remove clouds that are no longer in serverClouds
    interpolatedCloudStates.forEach((_, id) => {
      if (!serverClouds.has(id)) {
        changed = true;
        newStates.delete(id);
      }
    });

    if (changed) {
      setInterpolatedCloudStates(newStates);
    }
    // Update the ref for the next comparison
    prevServerCloudsRef.current = new Map(serverClouds.entries());

  }, [serverClouds]); // Only re-run when serverClouds prop itself changes identity

  // Effect to perform interpolation each frame using deltaTime
  useEffect(() => {
    if (deltaTime === 0) return; // No time has passed

    const newRenderables = new Map<string, InterpolatedCloudData>();
    const now = performance.now();

    interpolatedCloudStates.forEach((state, id) => {
      const timeSinceLastServerUpdate = now - state.lastServerUpdateTimeMs;
      // Ensure interpolationFactor does not exceed 1 if client frame rate is very low
      // or server update is very recent.
      const interpolationFactor = Math.min(1.0, timeSinceLastServerUpdate / SERVER_UPDATE_INTERVAL_MS);
      
      const currentRenderPosX = lerp(state.lastKnownPosX, state.targetPosX, interpolationFactor);
      const currentRenderPosY = lerp(state.lastKnownPosY, state.targetPosY, interpolationFactor);

      newRenderables.set(id, {
        ...state,
        currentRenderPosX,
        currentRenderPosY,
      });
    });
    setRenderableClouds(newRenderables);
  }, [interpolatedCloudStates, deltaTime]); // Re-run when states or deltaTime change

  return renderableClouds;
}; 