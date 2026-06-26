// Unified Interaction System Types and Utilities
// This file defines the single target approach for all interactions

import { HOLD_INTERACTION_DURATION_MS, REVIVE_HOLD_DURATION_MS } from '../config/gameConfig';

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
        // For resources - respawnAt is a Timestamp object with microsSinceUnixEpoch
        respawnAt?: { microsSinceUnixEpoch: bigint } | null;
        // Generic additional properties
        [key: string]: any;
    };
}

// All possible interaction target types (matches interactionTargetRuntime types)
export type InteractionTargetType = 
    | 'harvestable_resource'  // Unified for all plants (mushroom, corn, potato, pumpkin, hemp, reed)
    | 'campfire' 
    | 'furnace'  // ADDED: Furnace support (same behavior as campfire)
    | 'barbecue'  // ADDED: Barbecue support (same behavior as campfire)
    | 'fumarole'  // ADDED: Fumarole support (volcanic heat source with broth pot)
    | 'lantern'
    | 'turret'  // ADDED: Turret support
    | 'homestead_hearth'  // ADDED: HomesteadHearth support
    | 'dropped_item' 
    | 'box'  // wooden_storage_box
    | 'corpse'  // player_corpse
    | 'stash' 
    | 'sleeping_bag' 
    | 'knocked_out_player' 
    | 'water'
    | 'rain_collector'
    | 'broth_pot'
    | 'door'  // ADDED: Building doors
    | 'alk_station'  // ADDED: ALK delivery stations
    | 'cairn'  // ADDED: Cairn lore monuments
    | 'milkable_animal';  // ADDED: Milkable tamed animals (caribou, walrus)

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
    // Unified harvestable resource actions (TAP)
    harvestable_resource: {
        behavior: InteractionBehavior.TAP,
        priority: 100,
        actionType: 'harvest_resource'
    },
    dropped_item: {
        behavior: InteractionBehavior.TAP,
        priority: 95, // Above water (85) so items can be picked up while in water; below harvestable resources (100)
        actionType: 'pickup_item'
    },
    
    // Interface opening actions (INTERFACE) - tap to open UI
    campfire: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 80,
        actionType: 'open_campfire'
    },
    furnace: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 80,
        actionType: 'open_furnace'
    },
    barbecue: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 80,
        actionType: 'open_barbecue'
    },
    fumarole: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 80,
        actionType: 'open_fumarole'
    },
    lantern: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 80,
        actionType: 'open_lantern'
    },
    turret: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 80,
        actionType: 'open_turret'
    },
    homestead_hearth: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 80,
        actionType: 'open_hearth'
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
        priority: 90, // Increased from 75 to 90 to ensure corpses beat water (85)
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
        holdDurationMs: REVIVE_HOLD_DURATION_MS,
        priority: 110, // Highest priority - helping players is important
        actionType: 'revive_player'
    },
    water: {
        behavior: InteractionBehavior.HOLD,
        holdDurationMs: HOLD_INTERACTION_DURATION_MS,
        priority: 85, // Lower than corpses (90), dropped items (95), and harvestable resources (100)
        actionType: 'drink_water'
    },
    
    // Rain collector - interface for managing water containers
    rain_collector: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 70,
        actionType: 'open_rain_collector'
    },
    
    // Broth pot - interface for cooking and water management
    broth_pot: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 75,
        actionType: 'open_broth_pot'
    },
    
    // Door - tap to open/close, hold to pickup (owner only)
    door: {
        behavior: InteractionBehavior.TAP,
        priority: 85,
        actionType: 'interact_door'
    },
    
    // ALK Station - interface for contract delivery
    alk_station: {
        behavior: InteractionBehavior.INTERFACE,
        priority: 75,
        actionType: 'open_alk_station'
    },
    
    // Cairn - tap to interact and hear lore
    cairn: {
        behavior: InteractionBehavior.TAP,
        priority: 70,
        actionType: 'interact_cairn'
    },
    
    // Milkable animal - tap to milk tamed female caribou/walrus
    milkable_animal: {
        behavior: InteractionBehavior.TAP,
        priority: 88, // Higher than water (85) but below harvestable resources (100)
        actionType: 'milk_animal'
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
        case 'furnace':
            // Special furnace conditions for toggle burning via hold (same as campfire)
            return true; // Furnaces can be toggled via hold
        case 'homestead_hearth':
            // Special hearth conditions for grant building privilege via hold
            return true; // Hearths can grant building privilege via hold
        case 'broth_pot':
            // Special broth pot conditions (pickup if empty)
            return true; // Broth pots can be picked up via hold when empty
        case 'door':
            // Doors can be picked up via hold (owner only)
            return true;
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
        case 'furnace':
            // Furnaces always open interface via tap (secondary hold action handles toggle)
            return InteractionBehavior.INTERFACE;
        case 'homestead_hearth':
            // Hearths always open interface via tap (secondary hold action handles grant privilege)
            return InteractionBehavior.INTERFACE;
        case 'stash':
            // Stashes always open interface via tap (secondary hold action handles visibility toggle)  
            return InteractionBehavior.INTERFACE;
        case 'broth_pot':
            // Broth pots always open interface via tap (secondary hold action handles pickup when empty)
            return InteractionBehavior.INTERFACE;
        case 'door':
            // Doors use tap to toggle open/close (secondary hold action handles pickup)
            return InteractionBehavior.TAP;
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
        case 'furnace':
            return true; // Always has toggle burning action (same as campfire)
        case 'barbecue':
            return true; // Always has toggle burning action (same as campfire)
        case 'homestead_hearth':
            return true; // Always has grant building privilege action via hold
        case 'stash':
            return true; // Always has toggle visibility action
        case 'broth_pot':
            return true; // Always has pickup action when empty
        case 'door':
            return true; // Always has pickup action via hold (owner only)
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
        case 'furnace':
            return 500; // 0.5 seconds to toggle furnace (quick action, same as campfire)
        case 'barbecue':
            return 500; // 0.5 seconds to toggle barbecue (quick action, same as campfire)
        case 'homestead_hearth':
            return 1000; // 1 second to grant building privilege (significant action)
        case 'stash':
            return 250; // 0.25 seconds to toggle stash visibility (very quick)
        case 'broth_pot':
            return 1000; // 1 second to pick up broth pot (significant action)
        case 'door':
            return 1000; // 1 second to pick up door (significant action)
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
        case 'harvestable_resource':
            // respawnAt === 0n (UNIX_EPOCH) means NOT respawning (available)
            return !target.data?.respawnAt || target.data?.respawnAt?.microsSinceUnixEpoch === 0n;
        default:
            return true;
    }
}

// Debug/logging helper
export function formatTargetForLogging(target: InteractableTarget): string {
    return `${target.type}(${target.id}) at (${target.position.x.toFixed(1)}, ${target.position.y.toFixed(1)}) dist=${target.distance.toFixed(1)}`;
} 
