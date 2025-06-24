/**
 * Sound Trigger Utilities
 * 
 * Provides simple one-line functions to trigger immediate local sounds
 * for responsive player feedback in the hybrid sound system.
 * 
 * Note: Most sounds are now server-authoritative and handled automatically
 * by the sound system when server sound events are received.
 */

import { playImmediateSound } from '../hooks/useSoundSystem';

// === RESOURCE GATHERING SOUNDS ===
// Note: These are primarily server-authoritative now, but kept for potential local prediction

export const playTreeChopSound = (volume: number = 1): void => {
    playImmediateSound('tree_chop', volume);
};

export const playStoneHitSound = (volume: number = 1): void => {
    playImmediateSound('stone_hit', volume);
};

// === ITEM PICKUP SOUND ===
// This is used by the server when items are picked up

export const playItemPickupSound = (volume: number = 1): void => {
    playImmediateSound('item_pickup', volume);
};

// === EXPORT ALL FOR CONVENIENCE ===
export const SoundTriggers = {
    // Resource gathering
    treeChop: playTreeChopSound,
    stoneHit: playStoneHitSound,
    
    // Item pickup
    itemPickup: playItemPickupSound,
} as const; 