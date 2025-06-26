// Unified Interaction System Types and Utilities
// This file defines the single target approach for all interactions

import * as SpacetimeDB from '../generated';

// Comprehensive interaction target type that can represent any interactable entity
export interface InteractableTarget {
    // Core identification
    type: InteractionTargetType;
    id: bigint | number | string;
    position: { x: number; y: number };
    distance: number;
    
    // Additional data based on target type
    data?: {
        // For storage boxes
        isEmpty?: boolean;
        // For stashes  
        isHidden?: boolean;
        // For players
        isKnockedOut?: boolean;
        isDead?: boolean;
        // For campfires
        isBurning?: boolean;
        // For resources
        respawnAt?: number | null;
        // Generic additional properties
        [key: string]: any;
    };
}

// All possible interaction target types (matches useInteractionFinder types)
export type InteractionTargetType = 
    | 'mushroom' 
    | 'corn' 
    | 'potato' 
    | 'pumpkin' 
    | 'hemp' 
    | 'reed'
    | 'campfire' 
    | 'lantern'
    | 'dropped_item' 
    | 'box'  // wooden_storage_box
    | 'corpse'  // player_corpse
    | 'stash' 
    | 'sleeping_bag' 
    | 'knocked_out_player' 
    | 'water'
    | 'rain_collector';

// Interaction behaviors - determines how the interaction works
export enum InteractionBehavior {
    TAP = 'tap',           // Single E press - immediate action
    HOLD = 'hold',         // Hold E for duration - progress bar action  
    INTERFACE = 'interface' // Opens UI interface
}

// Interaction configuration for each target type
export interface InteractionConfig {
    behavior: InteractionBehavior;
    holdDurationMs?: number; // Only for HOLD behavior
    priority: number; // Higher number = higher priority when multiple targets overlap
    actionType: string; // For logging and debugging
}

// Configuration mapping for all interaction types
export const INTERACTION_CONFIGS: Record<InteractionTargetType, InteractionConfig> = {
    // Immediate harvest actions (TAP)
    mushroom: {
        behavior: InteractionBehavior.TAP,
        priority: 100,
        actionType: 'harvest_mushroom'
    },
    corn: {
        behavior: InteractionBehavior.TAP,
        priority: 100,
        actionType: 'harvest_corn'
    },
    potato: {
        behavior: InteractionBehavior.TAP,
        priority: 100,
        actionType: 'harvest_potato'
    },
    pumpkin: {
        behavior: InteractionBehavior.TAP,
        priority: 100,
        actionType: 'harvest_pumpkin'
    },
    hemp: {
        behavior: InteractionBehavior.TAP,
        priority: 100,
        actionType: 'harvest_hemp'
    },
    reed: {
        behavior: InteractionBehavior.TAP,
        priority: 100,
        actionType: 'harvest_reed'
    },
    dropped_item: {
        behavior: InteractionBehavior.TAP,
        priority: 90,
        actionType: 'pickup_item'
    },
    
    // Interface opening actions (INTERFACE) - tap to open UI
    campfire: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 80,
        actionType: 'open_campfire'
    },
    lantern: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 80,
        actionType: 'open_lantern'
    },
    box: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 70,
        actionType: 'open_storage_box'
    },
    stash: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 70,
        actionType: 'open_stash'
    },
    corpse: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 75,
        actionType: 'open_corpse'
    },
    sleeping_bag: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 60,
        actionType: 'open_sleeping_bag'
    },
    
    // Hold actions - require holding E key
    knocked_out_player: {
        behavior: InteractionBehavior.HOLD,
        holdDurationMs: 3000, // 3 seconds for reviving
        priority: 110, // Highest priority - helping players is important
        actionType: 'revive_player'
    },
    water: {
        behavior: InteractionBehavior.HOLD,
        holdDurationMs: 250, // 250ms for drinking water
        priority: 85,
        actionType: 'drink_water'
    },
    
    // Rain collector - interface for managing water containers
    rain_collector: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 70,
        actionType: 'open_rain_collector'
    }
};

// Helper function to get interaction configuration for a target
export function getInteractionConfig(targetType: InteractionTargetType): InteractionConfig {
    return INTERACTION_CONFIGS[targetType];
}

// Helper function to determine if an interaction is a tap action
export function isTapInteraction(target: InteractableTarget): boolean {
    const config = getInteractionConfig(target.type);
    return config.behavior === InteractionBehavior.TAP;
}

// Helper function to determine if an interaction is a hold action  
export function isHoldInteraction(target: InteractableTarget): boolean {
    const config = getInteractionConfig(target.type);
    return config.behavior === InteractionBehavior.HOLD;
}

// Helper function to determine if an interaction opens an interface
export function isInterfaceInteraction(target: InteractableTarget): boolean {
    const config = getInteractionConfig(target.type);
    return config.behavior === InteractionBehavior.INTERFACE;
}

// Helper function to get hold duration for hold interactions
export function getHoldDuration(target: InteractableTarget): number {
    const config = getInteractionConfig(target.type);
    return config.holdDurationMs || 250; // Default 250ms if not specified
}

// Helper function to get priority for target prioritization
export function getInteractionPriority(target: InteractableTarget): number {
    const config = getInteractionConfig(target.type);
    return config.priority;
}

// Helper function to get action type for logging
export function getActionType(target: InteractableTarget): string {
    const config = getInteractionConfig(target.type);
    return config.actionType;
}

// Helper function to determine if a target requires special conditions
export function hasSpecialConditions(target: InteractableTarget): boolean {
    switch (target.type) {
        case 'box':
            // Special hold action only if box is empty (for pickup)
            return target.data?.isEmpty === true;
        case 'lantern':
            // Lanterns always have special conditions (pickup if empty, toggle if has fuel)
            return true;
        case 'stash':
            // Special stash conditions based on visibility
            return true; // Stashes always have special visibility toggle via hold
        case 'campfire':
            // Special campfire conditions for toggle burning via hold
            return true; // Campfires can be toggled via hold
        default:
            return false;
    }
}

// Helper function to get the actual interaction behavior considering special conditions
export function getEffectiveInteractionBehavior(target: InteractableTarget): InteractionBehavior {
    // Handle special cases that override default behavior
    switch (target.type) {
        case 'box':
            // Empty boxes can be picked up via hold, non-empty boxes open interface via tap
            return target.data?.isEmpty ? InteractionBehavior.HOLD : InteractionBehavior.INTERFACE;
        case 'lantern':
            // Lanterns always open interface via tap (secondary hold action handles pickup/toggle)
            return InteractionBehavior.INTERFACE;
        case 'campfire':
            // Campfires always open interface via tap (secondary hold action handles toggle)
            return InteractionBehavior.INTERFACE;
        case 'stash':
            // Stashes always open interface via tap (secondary hold action handles visibility toggle)  
            return InteractionBehavior.INTERFACE;
        default:
            // Use default behavior from INTERACTION_CONFIGS
            const config = INTERACTION_CONFIGS[target.type];
            return config?.behavior || InteractionBehavior.TAP;
    }
}

// Helper function to determine if a target has a secondary hold action
export function hasSecondaryHoldAction(target: InteractableTarget): boolean {
    switch (target.type) {
        case 'box':
            return target.data?.isEmpty === true;
        case 'lantern':
            return true; // Always has secondary hold action (pickup if empty, toggle if has fuel)
        case 'campfire':
            return true; // Always has toggle burning action
        case 'stash':
            return true; // Always has toggle visibility action
        default:
            return false;
    }
}

// Helper function to get secondary hold duration for dual-behavior targets
export function getSecondaryHoldDuration(target: InteractableTarget): number {
    switch (target.type) {
        case 'box':
            return 1000; // 1 second to pick up empty box (significant action)
        case 'lantern':
            return 500; // 0.5 seconds to toggle/pickup lantern (quick action)
        case 'campfire':
            return 500; // 0.5 seconds to toggle campfire (quick action)
        case 'stash':
            return 250; // 0.25 seconds to toggle stash visibility (very quick)
        default:
            return 1000; // Default 1 second
    }
}

// Helper function for prioritizing targets when multiple are in range
export function selectHighestPriorityTarget(targets: InteractableTarget[]): InteractableTarget | null {
    if (targets.length === 0) return null;
    if (targets.length === 1) return targets[0];
    
    // Sort by priority (highest first), then by distance (closest first)
    return targets.sort((a, b) => {
        const priorityDiff = getInteractionPriority(b) - getInteractionPriority(a);
        if (priorityDiff !== 0) return priorityDiff;
        return a.distance - b.distance; // Closer is better if same priority
    })[0];
}

// Helper function to create a standardized interaction target
export function createInteractionTarget(
    type: InteractionTargetType,
    id: bigint | number | string,
    position: { x: number; y: number },
    distance: number,
    data?: InteractableTarget['data']
): InteractableTarget {
    return {
        type,
        id,
        position,
        distance,
        data: data || {}
    };
}

// Helper function to validate if a target is still valid for interaction
export function isTargetValid(target: InteractableTarget): boolean {
    // Basic validation - target must have required fields
    if (!target.type || target.id === null || target.id === undefined) {
        return false;
    }
    
    // Type-specific validation
    switch (target.type) {
        case 'knocked_out_player':
            return target.data?.isKnockedOut === true && target.data?.isDead !== true;
        case 'mushroom':
        case 'corn':
        case 'potato':
        case 'pumpkin':
        case 'hemp':
        case 'reed':
            return target.data?.respawnAt === null || target.data?.respawnAt === undefined;
        default:
            return true;
    }
}

// Debug/logging helper
export function formatTargetForLogging(target: InteractableTarget): string {
    return `${target.type}(${target.id}) at (${target.position.x.toFixed(1)}, ${target.position.y.toFixed(1)}) dist=${target.distance.toFixed(1)}`;
} 