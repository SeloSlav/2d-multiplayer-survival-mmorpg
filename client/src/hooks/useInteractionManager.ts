import { useState, useCallback, useMemo } from 'react';
import { InteractionConfig, InteractableTarget, INTERACTION_CONFIGS, hasSecondaryHoldAction, getSecondaryHoldDuration } from '../types/interactions';
import { DbConnection, InventoryItem, Campfire, Lantern } from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';

// Define the shape of the interaction target
export type InteractionTarget = { type: string; id: number | bigint } | null;

// Define the return type of the hook
interface InteractionManager {
    interactingWith: InteractionTarget;
    handleSetInteractingWith: (target: InteractionTarget) => void;
    // clearInteractionTarget: () => void; // Combine into handleSetInteractingWith(null)
}

interface UseInteractionManagerProps {
    connection: DbConnection | null;
    target: InteractableTarget | null;
    inventoryItems: Map<string, InventoryItem>;
    campfires: Map<string, Campfire>;
    lanterns: Map<string, Lantern>;
}

interface InteractionManagerResult {
    config: InteractionConfig | null;
    hasSecondaryAction: boolean;
    secondaryHoldDuration: number;
    handleTapAction: () => void;
    handleHoldAction: () => void;
    handleSecondaryHoldAction?: () => void;
}

export const useInteractionManager = (): InteractionManager => {
    const [interactingWith, setInteractingWith] = useState<InteractionTarget>(null);

    // Combine setting and clearing into one handler
    const handleSetInteractingWith = useCallback((target: InteractionTarget) => {
        console.log("[useInteractionManager] Setting interaction target:", target);
        setInteractingWith(target);
    }, []);

    // Optional: Clear function if needed separately, but handleSetInteractingWith(null) works
    // const clearInteractionTarget = useCallback(() => {
    //     console.log("[useInteractionManager] Clearing interaction target.");
    //     setInteractingWith(null);
    // }, []);

    return {
        interactingWith,
        handleSetInteractingWith,
        // clearInteractionTarget,
    };
};

export function useTargetInteractionManager({
    connection,
    target,
    inventoryItems,
    campfires,
    lanterns
}: UseInteractionManagerProps): InteractionManagerResult {

    // Get configuration for the current target
    const config = useMemo(() => {
        return target ? INTERACTION_CONFIGS[target.type] : null;
    }, [target]);

    // Check if target has secondary hold action
    const hasSecondaryAction = useMemo(() => {
        return target ? hasSecondaryHoldAction(target) : false;
    }, [target]);

    // Get secondary hold duration
    const secondaryHoldDuration = useMemo(() => {
        return target ? getSecondaryHoldDuration(target) : 250;
    }, [target]);

    // Handle tap actions (E key tap)
    const handleTapAction = useCallback(() => {
        if (!connection || !target || !config) return;

        switch (target.type) {
            case 'mushroom':
                connection.reducers.interactWithMushroom(BigInt(target.id as bigint));
                break;
            case 'corn':
                connection.reducers.interactWithCorn(BigInt(target.id as bigint));
                break;
            case 'potato':
                connection.reducers.interactWithPotato(BigInt(target.id as bigint));
                break;
            case 'pumpkin':
                connection.reducers.interactWithPumpkin(BigInt(target.id as bigint));
                break;
            case 'hemp':
                connection.reducers.interactWithHemp(BigInt(target.id as bigint));
                break;
            case 'reed':
                connection.reducers.interactWithReed(BigInt(target.id as bigint));
                break;
            case 'dropped_item':
                connection.reducers.pickupDroppedItem(BigInt(target.id as bigint));
                break;
            case 'campfire':
                // Open campfire interface - could trigger UI modal opening
                console.log(`[InteractionManager] Opening campfire interface for ID: ${target.id}`);
                // In a real implementation, this might dispatch an action to open UI
                break;
            case 'lantern':
                // Open lantern interface - could trigger UI modal opening
                console.log(`[InteractionManager] Opening lantern interface for ID: ${target.id}`);
                // In a real implementation, this might dispatch an action to open UI
                break;
            case 'box':
                console.log(`[InteractionManager] Opening storage box interface for ID: ${target.id}`);
                break;
            case 'stash':
                console.log(`[InteractionManager] Opening stash interface for ID: ${target.id}`);
                break;
            case 'corpse':
                console.log(`[InteractionManager] Opening corpse interface for ID: ${target.id}`);
                break;
            case 'sleeping_bag':
                console.log(`[InteractionManager] Opening sleeping bag interface for ID: ${target.id}`);
                break;
            case 'knocked_out_player':
                // This should be handled by hold action, not tap
                console.log(`[InteractionManager] Knocked out player requires hold action, not tap`);
                break;
            case 'water':
                // This should be handled by hold action, not tap
                console.log(`[InteractionManager] Water drinking requires hold action, not tap`);
                break;
            default:
                console.warn(`[InteractionManager] Unhandled tap action for target type: ${target.type}`);
        }
    }, [connection, target, config]);

    // Handle hold actions (E key hold)
    const handleHoldAction = useCallback(() => {
        if (!connection || !target || !config) return;

        switch (target.type) {
            case 'knocked_out_player':
                connection.reducers.reviveKnockedOutPlayer(Identity.fromString(String(target.id)));
                break;
            case 'water':
                connection.reducers.drinkWater();
                break;
            default:
                console.warn(`[InteractionManager] Unhandled hold action for target type: ${target.type}`);
        }
    }, [connection, target, config]);

    // Handle secondary hold actions (for dual-behavior targets)
    const handleSecondaryHoldAction = useCallback(() => {
        if (!connection || !target) return;

        switch (target.type) {
            case 'box':
                // Pickup empty box
                if (target.data?.isEmpty) {
                    connection.reducers.pickupStorageBox(Number(target.id));
                }
                break;
            case 'campfire':
                // Toggle burning state
                const campfire = campfires?.get(String(target.id));
                if (campfire) {
                    connection.reducers.toggleCampfireBurning(Number(target.id));
                }
                break;
            case 'lantern':
                // Toggle burning state
                const lantern = lanterns?.get(String(target.id));
                if (lantern) {
                    if (lantern.isBurning) {
                        connection.reducers.extinguishLantern(Number(target.id));
                    } else {
                        connection.reducers.lightLantern(Number(target.id));
                    }
                }
                break;
            case 'stash':
                // Toggle visibility
                connection.reducers.toggleStashVisibility(Number(target.id));
                break;
            default:
                console.warn(`[InteractionManager] Unhandled secondary hold action for target type: ${target.type}`);
        }
    }, [connection, target, campfires, lanterns]);

    return {
        config,
        hasSecondaryAction,
        secondaryHoldDuration,
        handleTapAction,
        handleHoldAction,
        handleSecondaryHoldAction: hasSecondaryAction ? handleSecondaryHoldAction : undefined
    };
} 