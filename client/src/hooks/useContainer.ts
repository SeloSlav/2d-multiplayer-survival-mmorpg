/**
 * useContainer Hook
 * 
 * Simple hook that eliminates the massive duplication in ExternalContainerUI.tsx
 * Handles data extraction, callbacks, and common logic for all container types.
 */

import { useMemo, useCallback } from 'react';
import { 
    ContainerType, 
    ContainerEntity,
    extractContainerItems,
    createContainerCallbacks,
    createSlotInfo,
    getContainerEntity,
    getContainerConfig,
    getContainerDisplayName
} from '../utils/containerUtils';
import { 
    InventoryItem, 
    ItemDefinition,
    Campfire, Furnace, Lantern, WoodenStorageBox, PlayerCorpse, Stash, RainCollector
} from '../generated';
import { PopulatedItem } from '../components/InventoryUI';
import { InteractionTarget } from '../hooks/useInteractionManager';

interface UseContainerProps {
    interactionTarget: InteractionTarget | null;
    inventoryItems: Map<string, InventoryItem>;
    itemDefinitions: Map<string, ItemDefinition>;
    
    // Container data maps
    campfires: Map<string, Campfire>;
    furnaces: Map<string, Furnace>;
    lanterns: Map<string, Lantern>;
    woodenStorageBoxes: Map<string, WoodenStorageBox>;
    playerCorpses: Map<string, PlayerCorpse>;
    stashes: Map<string, Stash>;
    rainCollectors: Map<string, RainCollector>;
    
    // Current storage box for special case
    currentStorageBox?: WoodenStorageBox | null;
    
    connection: any;
    lastDragCompleteTime: React.MutableRefObject<number>;
}

interface UseContainerResult {
    // Container info
    containerType: ContainerType | null;
    containerId: number | bigint | null;
    containerEntity: ContainerEntity | null;
    containerTitle: string;
    
    // Items and configuration
    items: (PopulatedItem | null)[];
    config: ReturnType<typeof getContainerConfig> | null;
    
    // Interaction handlers
    contextMenuHandler: (event: React.MouseEvent, itemInfo: PopulatedItem, slotIndex: number) => void;
    toggleHandler: () => void;
    autoRemoveFuelHandler: (event: React.MouseEvent, slotIndex: number) => void;
    
    // Slot utilities
    createSlotInfo: (index: number) => any;
    getSlotKey: (index: number) => string;
    
    // State helpers
    isEmpty: boolean;
    isActive: boolean; // For burning/lit state
}

export function useContainer(props: UseContainerProps): UseContainerResult {
    const {
        interactionTarget,
        inventoryItems,
        itemDefinitions,
        campfires,
        furnaces,
        lanterns,
        woodenStorageBoxes,
        playerCorpses,
        stashes,
        rainCollectors,
        currentStorageBox,
        connection,
        lastDragCompleteTime
    } = props;
    
    // Determine container type and ID from interaction target
    const { containerType, containerId } = useMemo(() => {
        if (!interactionTarget) return { containerType: null, containerId: null };
        
        const typeMap: Record<string, ContainerType> = {
            'campfire': 'campfire',
            'furnace': 'furnace',
            'lantern': 'lantern',
            'wooden_storage_box': 'wooden_storage_box',
            'player_corpse': 'player_corpse',
            'stash': 'stash',
            'rain_collector': 'rain_collector'
        };
        
        const containerType = typeMap[interactionTarget.type];
        if (!containerType) return { containerType: null, containerId: null };
        
        let containerId: number | bigint | null = null;
        if (containerType === 'player_corpse') {
            containerId = BigInt(interactionTarget.id);
        } else {
            containerId = Number(interactionTarget.id);
        }
        
        return { containerType, containerId };
    }, [interactionTarget]);
    
    // Get container entity
    const containerEntity = useMemo(() => {
        if (!containerType || containerId === null) return null;
        
        // Special case for wooden storage box - use currentStorageBox prop
        if (containerType === 'wooden_storage_box' && currentStorageBox) {
            return currentStorageBox;
        }
        
        return getContainerEntity(containerType, containerId, {
            campfires,
            furnaces,
            lanterns,
            woodenStorageBoxes,
            playerCorpses,
            stashes,
            rainCollectors
        });
    }, [containerType, containerId, campfires, furnaces, lanterns, woodenStorageBoxes, playerCorpses, stashes, rainCollectors, currentStorageBox]);
    
    // Get container configuration
    const config = useMemo(() => {
        return containerType ? getContainerConfig(containerType) : null;
    }, [containerType]);
    
    // Extract items using pattern-based utility
    const items = useMemo(() => {
        if (!containerType || !containerEntity) return [];
        
        return extractContainerItems(
            containerType,
            containerEntity,
            inventoryItems,
            itemDefinitions
        );
    }, [containerType, containerEntity, inventoryItems, itemDefinitions]);
    
    // Generate callbacks using utility
    const callbacks = useMemo(() => {
        if (!containerType || containerId === null) {
            const noop = () => {};
            return {
                contextMenuHandler: noop as any,
                toggleHandler: noop,
                autoRemoveFuelHandler: noop as any
            };
        }
        
        return createContainerCallbacks(
            containerType,
            containerId,
            connection,
            lastDragCompleteTime
        );
    }, [containerType, containerId, connection, lastDragCompleteTime]);
    
    // Create slot utilities
    const slotUtilities = useMemo(() => {
        const createSlotInfoFn = (index: number) => {
            if (!containerType || containerId === null) return null;
            return createSlotInfo(containerType, index, containerId);
        };
        
        const getSlotKey = (index: number) => {
            return `${containerType || 'unknown'}-${containerId?.toString() || 'unknown'}-${index}`;
        };
        
        return { createSlotInfo: createSlotInfoFn, getSlotKey };
    }, [containerType, containerId]);
    
    // Container title
    const containerTitle = useMemo(() => {
        if (!containerType) return 'External Container';
        
        // Handle special cases
        if (containerType === 'player_corpse' && containerEntity) {
            const corpse = containerEntity as PlayerCorpse;
            return corpse.username ? `${corpse.username}'s Backpack` : 'Player Corpse';
        }
        
        if (containerType === 'stash' && containerEntity) {
            const stash = containerEntity as Stash;
            return stash.isHidden ? 'HIDDEN STASH (NEARBY)' : 'STASH';
        }
        
        return getContainerDisplayName(containerType);
    }, [containerType, containerEntity]);
    
    // State helpers
    const isEmpty = useMemo(() => {
        return items.every(item => item === null);
    }, [items]);
    
    const isActive = useMemo(() => {
        if (!containerEntity) return false;
        
        // Check if container is burning/lit
        const burningContainers = ['campfire', 'furnace', 'lantern'];
        if (burningContainers.includes(containerType || '')) {
            return (containerEntity as any).isBurning || false;
        }
        
        return false;
    }, [containerEntity, containerType]);
    
    return {
        containerType,
        containerId,
        containerEntity,
        containerTitle,
        items,
        config,
        contextMenuHandler: callbacks.contextMenuHandler,
        toggleHandler: callbacks.toggleHandler,
        autoRemoveFuelHandler: callbacks.autoRemoveFuelHandler,
        createSlotInfo: slotUtilities.createSlotInfo,
        getSlotKey: slotUtilities.getSlotKey,
        isEmpty,
        isActive
    };
} 