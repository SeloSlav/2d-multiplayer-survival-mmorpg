import { useState, useCallback, useRef, useEffect } from 'react';
import { DbConnection } from '../generated'; // Import connection type
import { ItemDefinition } from '../generated'; // Import ItemDefinition for type info

// Type for the information needed to start placement
export interface PlacementItemInfo {
  itemDefId: bigint;
  itemName: string;
  iconAssetName: string;
  instanceId: bigint;
}

// Type for the state managed by the hook
export interface PlacementState {
  isPlacing: boolean;
  placementInfo: PlacementItemInfo | null;
  placementError: string | null;
}

// Type for the functions returned by the hook
export interface PlacementActions {
  startPlacement: (itemInfo: PlacementItemInfo) => void;
  cancelPlacement: () => void;
  attemptPlacement: (worldX: number, worldY: number) => void;
}

export const usePlacementManager = (connection: DbConnection | null): [PlacementState, PlacementActions] => {
  const [placementInfo, setPlacementInfo] = useState<PlacementItemInfo | null>(null);
  const [placementError, setPlacementError] = useState<string | null>(null);

  const isPlacing = placementInfo !== null;

  // --- Start Placement --- 
  const startPlacement = useCallback((itemInfo: PlacementItemInfo) => {
    // console.log(`[PlacementManager] Starting placement for: ${itemInfo.itemName} (ID: ${itemInfo.itemDefId})`);
    setPlacementInfo(itemInfo);
    setPlacementError(null); // Clear errors on new placement start
  }, []);

  // --- Cancel Placement --- 
  const cancelPlacement = useCallback(() => {
    if (placementInfo) { // Only log if actually cancelling
      // console.log("[PlacementManager] Cancelling placement mode.");
      setPlacementInfo(null);
      setPlacementError(null);
    }
  }, [placementInfo]); // Depend on placementInfo to check if cancelling is needed

  // --- Attempt Placement --- 
  const attemptPlacement = useCallback((worldX: number, worldY: number) => {
    if (!connection || !placementInfo) {
      console.warn("[PlacementManager] Attempted placement with no connection or no item selected.");
      return;
    }

    // console.log(`[PlacementManager] Attempting to place ${placementInfo.itemName} at (${worldX}, ${worldY})`);
    setPlacementError(null); // Clear previous error

    try {
      // --- Reducer Mapping Logic --- 
      // This needs to be expanded as more placeable items are added
      switch (placementInfo.itemName) {
        case 'Camp Fire':
          // console.log(`[PlacementManager] Calling placeCampfire reducer with instance ID: ${placementInfo.instanceId}`);
          connection.reducers.placeCampfire(placementInfo.instanceId, worldX, worldY);
          // Note: We don't call cancelPlacement here. 
          // App.tsx's handleCampfireInsert callback will call it upon success.
          break;
        case 'Wooden Storage Box':
          // console.log(`[PlacementManager] Calling placeWoodenStorageBox reducer with instance ID: ${placementInfo.instanceId}`);
          connection.reducers.placeWoodenStorageBox(placementInfo.instanceId, worldX, worldY);
          // Assume App.tsx will have a handleWoodenStorageBoxInsert similar to campfire
          break;
        case 'Sleeping Bag':
          // console.log(`[PlacementManager] Calling placeSleepingBag reducer with instance ID: ${placementInfo.instanceId}`);
          connection.reducers.placeSleepingBag(placementInfo.instanceId, worldX, worldY);
          // Assume App.tsx needs a handleSleepingBagInsert callback to cancel placement on success
          break;
        case 'Stash':
          // console.log(`[PlacementManager] Calling placeStash reducer with instance ID: ${placementInfo.instanceId}`);
          connection.reducers.placeStash(placementInfo.instanceId, worldX, worldY);
          // Assume App.tsx will need a handleStashInsert callback to cancel placement on success
          break;
        case 'Shelter':
          // console.log(`[PlacementManager] Calling placeShelter reducer with instance ID: ${placementInfo.instanceId}`);
          connection.reducers.placeShelter(placementInfo.instanceId, worldX, worldY);
          // Assume App.tsx will need a handleShelterInsert callback (added in useSpacetimeTables)
          // which should call cancelPlacement on success.
          break;
        // case 'Storage Box':
        //   console.log(`[PlacementManager] Calling placeStorageBox reducer.`);
        //   connection.reducers.placeStorageBox(worldX, worldY);
        //   break;
        // case 'Furnace':
        //    console.log(`[PlacementManager] Calling placeFurnace reducer.`);
        //    connection.reducers.placeFurnace(worldX, worldY);
        //    break;
        default:
          console.error(`[PlacementManager] Unknown item type for placement: ${placementInfo.itemName}`);
          setPlacementError(`Cannot place item: Unknown type '${placementInfo.itemName}'.`);
          // Optionally call cancelPlacement here if placement is impossible?
          // cancelPlacement(); 
          break;
      }
    } catch (err: any) {
      console.error('[PlacementManager] Failed to call placement reducer (client-side error):', err);
      const errorMessage = err?.message || "Failed to place item. Check logs.";
      // Set error state managed by the hook
      setPlacementError(`Placement failed: ${errorMessage}`); 
      // Do NOT cancel placement on error, let user retry or cancel manually
    }
  }, [connection, placementInfo]); // Dependencies

  // Consolidate state and actions for return
  const placementState: PlacementState = { isPlacing, placementInfo, placementError };
  const placementActions: PlacementActions = { startPlacement, cancelPlacement, attemptPlacement };

  return [placementState, placementActions];
}; 