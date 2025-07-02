import { useEffect, useRef, useCallback } from 'react';
import * as SpacetimeDB from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';

interface SoundSystemProps {
    soundEvents: Map<string, SpacetimeDB.SoundEvent>;
    continuousSounds: Map<string, SpacetimeDB.ContinuousSound>;
    localPlayerPosition: { x: number; y: number } | null;
    localPlayerIdentity: Identity | null;
    masterVolume?: number; // 0-1 scale (up to 100%) for regular sounds
    environmentalVolume?: number; // 0-1 scale for environmental sounds (rain, wind, etc.)
}

// Sound strategy enum for different types of sounds
enum SoundStrategy {
    IMMEDIATE = 'immediate',           // Play instantly, no server sync (UI sounds)
    PREDICT_CONFIRM = 'predict_confirm', // Play immediately + server confirms for others
    SERVER_ONLY = 'server_only',       // Wait for server (important gameplay sounds)
}

// Sound type definitions with strategies
const SOUND_DEFINITIONS = {
    // Resource gathering - server only (only play when actually hitting targets)
    tree_chop: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.8, maxDistance: 1050 },
    tree_creaking: { strategy: SoundStrategy.SERVER_ONLY, volume: 3.0, maxDistance: 1050 }, // Much louder for dramatic effect
    tree_falling: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.5, maxDistance: 1050 },  // Loudest, longest range
    stone_hit: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.8, maxDistance: 1050 },
    stone_destroyed: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.3, maxDistance: 1050 }, // Loud stone destruction sound
    harvest_plant: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.5, maxDistance: 525 }, // Pleasant plant harvesting sound
    plant_seed: { strategy: SoundStrategy.SERVER_ONLY, volume: 5.4, maxDistance: 525 }, // Much louder planting seed sound (3x increase)
    item_pickup: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 525 }, // Item pickup sound
    drinking_water: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.2, maxDistance: 525 }, // Drinking water sound
    throwing_up: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.5, maxDistance: 600 }, // Throwing up sound (salt water, food poisoning)
    eating_food: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.5, maxDistance: 600 }, // Eating food sound
    filling_container: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 700 },
    // Continuous/looping sounds - server managed
    campfire_looping: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 525, isLooping: true },
    lantern_looping: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 525, isLooping: true },
    // Repair sounds - server only (triggered by repair actions)
    repair: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.2, maxDistance: 525 },
    repair_fail: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 525 },
    // Rain sounds - server only global continuous sounds during rain
    rain_heavy_storm: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.2, maxDistance: Infinity, isLooping: true, isEnvironmental: true },
    rain_normal: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.8, maxDistance: Infinity, isLooping: true, isEnvironmental: true },
    // Combat sounds - server only
    melee_hit_sharp: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.4, maxDistance: 700 }, // Sharp melee weapon hits
    spear_hit: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.3, maxDistance: 650 }, // Spear hits on players/corpses
    torch_hit: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.1, maxDistance: 600 }, // Torch hits on players/corpses
    torch_hit_lit: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.2, maxDistance: 650 }, // Lit torch hits (plays with torch_hit)
    light_torch: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 500 }, // Lighting a torch
    extinguish_torch: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.9, maxDistance: 450 }, // Extinguishing a torch
    melee_hit_blunt: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.2, maxDistance: 600 }, // Blunt weapon hits on players/corpses
    weapon_swing: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.8, maxDistance: 400 }, // All weapon swings
    arrow_hit: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.1, maxDistance: 550 }, // Arrow hits on players/corpses
    shoot_bow: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 800 }, // Hunting bow firing
    shoot_crossbow: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.1, maxDistance: 850 }, // Crossbow firing
    bandaging: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.8, maxDistance: 300 }, // Bandaging (5-second duration, non-looping)
    stop_bandaging: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.0, maxDistance: 300 }, // Stop bandaging sound
    barrel_hit: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 600 }, // Barrel hit sound
    barrel_destroyed: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.3, maxDistance: 700 }, // Barrel destroyed sound
    // Animal growl sounds - when animals detect and approach players
    growl_wolf: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.2, maxDistance: 800 }, // Wolf growl when starting to chase
    growl_fox: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 650 }, // Fox growl when starting to attack
    growl_snake: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.1, maxDistance: 700 }, // Snake/viper growl when approaching
    growl_walrus: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.3, maxDistance: 1000 }, // Walrus growl when disturbed or patrolling
    // Movement sounds - server only for proper synchronization
    walking: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.7, maxDistance: 400 }, // Player footsteps when moving
    swimming: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.8, maxDistance: 450 }, // Player swimming sounds in water
    // UI/Item interaction sounds - immediate (no server sync needed)
    crush_bones: { strategy: SoundStrategy.IMMEDIATE, volume: 1.2 }, // Local client sound
} as const;

type SoundType = keyof typeof SOUND_DEFINITIONS;

// Sound configuration
const SOUND_CONFIG = {
    MAX_SOUND_DISTANCE: 500,
    DISTANCE_FALLOFF_POWER: 1.5, // Less aggressive falloff
    MASTER_VOLUME: 1.0, // Full volume instead of 0.5
    SOUNDS_BASE_PATH: '/sounds/',
    // Performance settings
    AUDIO_CACHE_SIZE: 50,
    SPATIAL_UPDATE_INTERVAL: 16, // ~60fps
    // Audio variation settings for dynamic feel (more aggressive for variety)
    SPATIAL_PITCH_VARIATION: 0.3, // ±15% pitch variation (0.85 to 1.15)
    SPATIAL_VOLUME_VARIATION: 0.2, // ±10% volume variation (0.9 to 1.1)
    LOCAL_PITCH_VARIATION: 0.2, // ±10% pitch variation (0.9 to 1.1)
    LOCAL_VOLUME_VARIATION: 0.1, // ±5% volume variation (0.95 to 1.05)
} as const;

// Audio cache for managing loaded sounds
class AudioCache {
    private cache = new Map<string, HTMLAudioElement>();
    private accessOrder = new Map<string, number>();
    private accessCounter = 0;
    private readonly maxSize = 50;

    get(filename: string): HTMLAudioElement | null {
        const audio = this.cache.get(filename);
        if (audio) {
            this.accessOrder.set(filename, ++this.accessCounter);
            return audio;
        }
        return null;
    }

    set(filename: string, audio: HTMLAudioElement): void {
        // Remove oldest if at capacity
        if (this.cache.size >= this.maxSize) {
            let oldestFile = '';
            let oldestAccess = Infinity;
            for (const [file, access] of this.accessOrder) {
                if (access < oldestAccess) {
                    oldestAccess = access;
                    oldestFile = file;
                }
            }
            if (oldestFile) {
                this.cache.delete(oldestFile);
                this.accessOrder.delete(oldestFile);
            }
        }
        
        this.cache.set(filename, audio);
        this.accessOrder.set(filename, ++this.accessCounter);
    }

    has(filename: string): boolean {
        return this.cache.has(filename);
    }

    clear(): void {
        this.cache.clear();
        this.accessOrder.clear();
        this.accessCounter = 0;
    }
}

// Web Audio API context for loud sounds (volumes > 1.0)
let audioContext: AudioContext | null = null;
const initAudioContext = () => {
    if (!audioContext) {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContext;
};

// Play sound using Web Audio API for volumes > 1.0
const playLoudSound = async (
    filename: string,
    volume: number,
    pitchVariation: number = 1.0
): Promise<void> => {
    try {
        const ctx = initAudioContext();
        
        // Load audio buffer
        const response = await fetch(`/sounds/${filename}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        
        // Create audio nodes
        const source = ctx.createBufferSource();
        const gainNode = ctx.createGain();
        
        // Configure nodes
        source.buffer = audioBuffer;
        source.playbackRate.value = pitchVariation;
        gainNode.gain.value = volume; // Can be > 1.0 with Web Audio API!
        
        // Connect nodes: source -> gain -> destination
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        // Play
        source.start(0);
        
    } catch (error) {
        console.warn(`🔊 Web Audio error for ${filename}:`, error);
        // Fallback to regular audio with clamped volume
        const audio = await getAudio(filename);
        const audioClone = audio.cloneNode() as HTMLAudioElement;
        audioClone.volume = Math.min(1.0, volume); // Clamp for fallback
        audioClone.playbackRate = pitchVariation;
        audioClone.currentTime = 0;
        await audioClone.play();
    }
};

// Global audio cache instance
const audioCache = new AudioCache();

// Active sound tracking for performance
const activeSounds = new Set<HTMLAudioElement>();

// Track active bandaging sounds per player to allow stopping them
const activeBandagingSounds = new Map<string, HTMLAudioElement>();

// Preload common sounds
const PRELOAD_SOUNDS = [
    'tree_chop.mp3',  // 3 tree chop variations
    'tree_creaking.mp3',                                   // 1 tree creaking variation
    'tree_falling.mp3',                                    // 1 tree falling variation
    'stone_hit.mp3',   // 3 stone hit variations
    'stone_destroyed.mp3',                                 // 1 stone destroyed variation
    'harvest_plant.mp3',                                   // 1 plant harvest variation
    'plant_seed.mp3',                                      // 1 seed planting variation
    'item_pickup.mp3',                                     // 1 item pickup variation
    'drinking_water.mp3',                                  // 1 drinking water variation
    'throwing_up.mp3',                                     // 1 throwing up variation (salt water, food poisoning)
    'eating_food.mp3',                                     // 1 eating food variation
    'filling_container.mp3',                               // 1 filling container variation
    'campfire_looping.mp3',                                // 1 campfire looping variation
    'lantern_looping.mp3',                                 // 1 lantern looping variation
    'repair.mp3',                                          // 1 repair variation
    'repair_fail.mp3',                                     // 1 repair fail variation
    'rain_normal.mp3',                                     // 1 normal rain variation
    'melee_hit_sharp.mp3',                                  // 1 melee hit sharp variation
    'spear_hit.mp3',                                        // 1 spear hit variation
    'torch_hit.mp3',                                        // 1 torch hit variation
    'torch_hit_lit.mp3',                                    // 1 torch hit lit variation
    'light_torch.mp3',                                      // 1 light torch variation
    'extinguish_torch.mp3',                                 // 1 extinguish torch variation
    'crush_bones.mp3',                                      // 1 crush bones variation
    'melee_hit_blunt.mp3',                                  // 1 melee hit blunt variation
    'weapon_swing.mp3',                                     // 1 weapon swing variation
    'arrow_hit.mp3',                                        // 1 arrow hit variation
    'shoot_bow.mp3',                                        // 1 shoot bow variation
    'shoot_crossbow.mp3',                                    // 1 shoot crossbow variation
    'bandaging.mp3',                                        // 1 bandaging variation
    'barrel_hit.mp3',                                       // 1 barrel hit variation
    'barrel_destroyed.mp3',                                 // 1 barrel destroyed variation
    'growl_wolf.mp3',                                       // 1 wolf growl variation
    'growl_fox.mp3',                                        // 1 fox growl variation
    'growl_snake.mp3',                                      // 1 snake growl variation
    'growl_walrus.mp3',                                     // 3 walrus growl variations
    'growl_walrus2.mp3',
    'growl_walrus3.mp3',
    'walking.mp3',                                          // 2 walking/footstep variations
    'walking1.mp3',
    'swimming.mp3',                                         // 3 swimming sound variations
    'swimming1.mp3',
    'swimming2.mp3',
] as const;

// Enhanced audio loading with error handling and performance monitoring
const loadAudio = async (filename: string): Promise<HTMLAudioElement> => {
    return new Promise((resolve, reject) => {
        const fullPath = SOUND_CONFIG.SOUNDS_BASE_PATH + filename;
        const audio = new Audio(fullPath);
        
        // Performance: Set optimal loading attributes
        audio.preload = 'auto';
        audio.crossOrigin = 'anonymous';
        
        const loadTimeout = setTimeout(() => {
            reject(new Error(`Audio load timeout: ${filename}`));
        }, 5000);
        
        audio.addEventListener('canplaythrough', () => {
            clearTimeout(loadTimeout);
            resolve(audio);
        }, { once: true });
        
        audio.addEventListener('error', (e) => {
            clearTimeout(loadTimeout);
            console.error(`🔊 Audio load error: ${filename}`, e);
            reject(new Error(`Failed to load audio: ${filename}`));
        }, { once: true });
        
        // Start loading
        audio.load();
    });
};

// Get or create audio with caching and error handling
const getAudio = async (filename: string): Promise<HTMLAudioElement> => {
    // Check cache first
    let audio = audioCache.get(filename);
    if (audio) {
        return audio;
    }
    
    try {
        // Load and cache
        audio = await loadAudio(filename);
        audioCache.set(filename, audio);
        return audio;
    } catch (error) {
        console.warn(`🔊 Failed to load ${filename}, using silent fallback`);
        // Return silent fallback
        const silentAudio = new Audio();
        audioCache.set(filename, silentAudio);
        return silentAudio;
    }
};

// Calculate distance between two points
const calculateDistance = (x1: number, y1: number, x2: number, y2: number): number => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
};

// Calculate volume based on distance with optimized falloff
const calculateSpatialVolume = (
    distance: number, 
    baseVolume: number, 
    maxDistance: number
): number => {
    if (distance >= maxDistance) return 0;
    
    const distanceRatio = distance / maxDistance;
    const volumeMultiplier = Math.pow(1 - distanceRatio, SOUND_CONFIG.DISTANCE_FALLOFF_POWER);
    
    return baseVolume * volumeMultiplier * SOUND_CONFIG.MASTER_VOLUME;
};

// Enhanced spatial audio with performance optimizations and random pitch/volume variations
const playSpatialAudio = async (
    filename: string,
    soundX: number,
    soundY: number,
    listenerX: number,
    listenerY: number,
    baseVolume: number,
    maxDistance: number,
    masterVolume: number = 1
): Promise<void> => {
    try {
        const distance = calculateDistance(soundX, soundY, listenerX, listenerY);
        const volume = calculateSpatialVolume(distance, baseVolume, maxDistance) * masterVolume;
        if (volume <= 0.01) return; // Skip very quiet sounds
        
        // Add random pitch variation (0.85 to 1.15 range for dramatic spatial variation)
        const pitchVariation = 0.85 + Math.random() * SOUND_CONFIG.SPATIAL_PITCH_VARIATION;
        
        // Add slight random volume variation (±10% for subtle variety)
        const volumeVariation = 0.9 + Math.random() * SOUND_CONFIG.SPATIAL_VOLUME_VARIATION;
        const finalVolume = volume * volumeVariation;
        
        // Use Web Audio API for loud sounds (> 1.0), HTML Audio for normal sounds
        if (finalVolume > 1.0) {
            await playLoudSound(filename, finalVolume, pitchVariation);
        } else {
            // Use regular HTML Audio for normal volumes
            const audio = await getAudio(filename);
            const audioClone = audio.cloneNode() as HTMLAudioElement;
            
            audioClone.playbackRate = pitchVariation;
            audioClone.volume = Math.max(0, finalVolume); // Only prevent negative
            audioClone.currentTime = 0;
            
            // Track active sound
            activeSounds.add(audioClone);
            
            // Cleanup when finished
            const cleanup = () => {
                activeSounds.delete(audioClone);
                audioClone.removeEventListener('ended', cleanup);
                audioClone.removeEventListener('error', cleanup);
            };
            
            audioClone.addEventListener('ended', cleanup, { once: true });
            audioClone.addEventListener('error', cleanup, { once: true });
            
            await audioClone.play();
        }
        
    } catch (error) {
        console.warn(`🔊 Spatial audio error for ${filename}:`, error);
    }
};

// Immediate local sound for instant feedback
const playLocalSound = async (
    soundType: SoundType,
    volume: number = 1,
    variation?: number
): Promise<void> => {
    try {
        const definition = SOUND_DEFINITIONS[soundType];
        if (!definition) {
            console.warn(`🔊 Unknown sound type: ${soundType}`);
            return;
        }
        
        // Generate filename with variation
        let filename = `${soundType}.mp3`;
        if (variation !== undefined) {
            filename = variation === 0 ? `${soundType}.mp3` : `${soundType}${variation}.mp3`;
        } else {
            // Random variation for variety - different counts per sound type
            let variationCount = 4; // Default for most sounds
            if (soundType === 'tree_chop') {
                variationCount = 1; // tree_chop.mp3
            } else if (soundType === 'tree_creaking' || soundType === 'tree_falling' || soundType === 'stone_destroyed') {
                variationCount = 1; // Single variation sounds
            } else if (soundType === 'stone_hit') {
                variationCount = 1; // stone_hit.mp3
            } else if (soundType === 'harvest_plant') {
                variationCount = 1; // harvest_plant.mp3
            } else if (soundType === 'plant_seed') {
                variationCount = 1; // plant_seed.mp3
            } else if (soundType === 'item_pickup') {
                variationCount = 1; // item_pickup.mp3
            } else if (soundType === 'drinking_water') {
                variationCount = 1; // drinking_water.mp3
            } else if (soundType === 'lantern_looping') {
                variationCount = 1; // lantern_looping.mp3
            } else if (soundType === 'repair') {
                variationCount = 1; // repair.mp3
            } else if (soundType === 'repair_fail') {
                variationCount = 1; // repair_fail.mp3
            } else if (soundType === 'throwing_up') {
                variationCount = 1; // throwing_up.mp3
            } else if (soundType === 'eating_food') {
                variationCount = 1; // eating_food.mp3
            } else if (soundType === 'filling_container') {
                variationCount = 1; // filling_container.mp3
            } else if (soundType === 'rain_heavy_storm') {
                variationCount = 1; // rain_heavy_storm.mp3
            } else if (soundType === 'rain_normal') {
                variationCount = 1; // rain_normal.mp3
            } else if (soundType === 'melee_hit_sharp') {
                variationCount = 1; // melee_hit_sharp.mp3
            } else if (soundType === 'spear_hit') {
                variationCount = 1; // spear_hit.mp3
            } else if (soundType === 'torch_hit') {
                variationCount = 1; // torch_hit.mp3
            } else if (soundType === 'torch_hit_lit') {
                variationCount = 1; // torch_hit_lit.mp3
            } else if (soundType === 'light_torch') {
                variationCount = 1; // light_torch.mp3
            } else if (soundType === 'extinguish_torch') {
                variationCount = 1; // extinguish_torch.mp3
            } else if (soundType === 'melee_hit_blunt') {
                variationCount = 1; // melee_hit_blunt.mp3
            } else if (soundType === 'weapon_swing') {
                variationCount = 1; // weapon_swing.mp3
            } else if (soundType === 'crush_bones') {
                variationCount = 1; // crush_bones.mp3
            } else if (soundType === 'arrow_hit') {
                variationCount = 1; // arrow_hit.mp3
            } else if (soundType === 'shoot_bow') {
                variationCount = 1; // shoot_bow.mp3
            } else if (soundType === 'shoot_crossbow') {
                variationCount = 1; // shoot_crossbow.mp3
            } else if (soundType === 'bandaging') {
                variationCount = 1; // bandaging.mp3
            } else if (soundType === 'stop_bandaging') {
                variationCount = 1; // stop_bandaging.mp3
            } else if (soundType === 'barrel_hit') {
                variationCount = 1; // barrel_hit.mp3
            } else if (soundType === 'barrel_destroyed') {
                variationCount = 1; // barrel_destroyed.mp3
            } else if (soundType === 'growl_wolf') {
                variationCount = 1; // growl_wolf.mp3
            } else if (soundType === 'growl_fox') {
                variationCount = 1; // growl_fox.mp3
            } else if (soundType === 'growl_snake') {
                variationCount = 1; // growl_snake.mp3
            } else if (soundType === 'growl_walrus') {
                variationCount = 3; // growl_walrus.mp3, growl_walrus2.mp3, growl_walrus3.mp3
            } else if (soundType === 'walking') {
                variationCount = 2; // walking.mp3, walking1.mp3, walking2.mp3
            } else if (soundType === 'swimming') {
                variationCount = 3; // swimming.mp3, swimming1.mp3, swimming2.mp3
            }
            
            const randomVariation = Math.floor(Math.random() * variationCount);
            if (randomVariation === 0) {
                filename = `${soundType}.mp3`;
            } else {
                filename = `${soundType}${randomVariation}.mp3`;
            }
        }
        
        // Add random pitch variation (0.9 to 1.1 range for subtle local variation)
        const pitchVariation = 0.9 + Math.random() * SOUND_CONFIG.LOCAL_PITCH_VARIATION;
        
        // Add slight random volume variation (±5% for subtle variety)
        const volumeVariation = 0.95 + Math.random() * SOUND_CONFIG.LOCAL_VOLUME_VARIATION;
        const finalVolume = definition.volume * volume * SOUND_CONFIG.MASTER_VOLUME * volumeVariation;
        
        // Use Web Audio API for loud sounds (> 1.0), HTML Audio for normal sounds
        if (finalVolume > 1.0) {
            await playLoudSound(filename, finalVolume, pitchVariation);
        } else {
            // Use regular HTML Audio for normal volumes
            const audio = await getAudio(filename);
            const audioClone = audio.cloneNode() as HTMLAudioElement;
            
            audioClone.playbackRate = pitchVariation;
            audioClone.volume = Math.max(0, finalVolume); // Only prevent negative
            audioClone.currentTime = 0;
            
            // Track and cleanup
            activeSounds.add(audioClone);
            const cleanup = () => {
                activeSounds.delete(audioClone);
                audioClone.removeEventListener('ended', cleanup);
                audioClone.removeEventListener('error', cleanup);
            };
            
            audioClone.addEventListener('ended', cleanup, { once: true });
            audioClone.addEventListener('error', cleanup, { once: true });
            
            await audioClone.play();
        }
        
    } catch (error) {
        console.warn(`🔊 Local sound error for ${soundType}:`, error);
    }
};

// Public API for playing sounds immediately (for local actions)
export const playImmediateSound = (soundType: SoundType, volume: number = 1): void => {
    playLocalSound(soundType, volume).catch(console.warn);
};

// Active looping sounds management with enhanced tracking
const activeLoopingSounds = new Map<string, HTMLAudioElement>();
const soundCleanupTimeouts = new Map<string, number>();

// 🎵 SEAMLESS LOOPING SYSTEM - Overlapping Audio Instances
const activeSeamlessLoopingSounds = new Map<string, {
    primary: HTMLAudioElement;
    secondary: HTMLAudioElement;
    isPrimaryActive: boolean;
    nextSwapTime: number;
    volume: number;
    pitchVariation: number;
}>();

// Enhanced cleanup function for looping sounds
const cleanupLoopingSound = (objectId: string, reason: string = "cleanup") => {
    // Clean up traditional looping sound
    const audio = activeLoopingSounds.get(objectId);
    if (audio) {
        try {
            // Remove event listeners FIRST to prevent error events during cleanup
            audio.removeEventListener('ended', () => {});
            audio.removeEventListener('error', () => {});
            
            // Mark audio as being cleaned up to prevent error handling
            (audio as any)._isBeingCleaned = true;
            
            audio.pause();
            audio.currentTime = 0;
            // Clear the src to fully release the audio resource
            audio.src = '';
            audio.load(); // Force cleanup
        } catch (e) {
            // Only log unexpected errors, not cleanup-related ones
            if (e instanceof Error && !e.message.includes('load') && !e.message.includes('src')) {
                console.warn(`🔊 Unexpected error during audio cleanup for ${objectId}:`, e);
            }
        }
        activeLoopingSounds.delete(objectId);
        // console.log(`🔊 Cleaned up looping sound for object ${objectId} (${reason})`);
    }
    
    // Clean up seamless looping sound
    const seamlessSound = activeSeamlessLoopingSounds.get(objectId);
    if (seamlessSound) {
        try {
            // Clean up both primary and secondary audio instances
            [seamlessSound.primary, seamlessSound.secondary].forEach(audio => {
                (audio as any)._isBeingCleaned = true;
                audio.pause();
                audio.currentTime = 0;
                audio.src = '';
                audio.load();
            });
        } catch (e) {
            if (e instanceof Error && !e.message.includes('load') && !e.message.includes('src')) {
                console.warn(`🔊 Unexpected error during seamless audio cleanup for ${objectId}:`, e);
            }
        }
        activeSeamlessLoopingSounds.delete(objectId);
        // console.log(`🔊 Cleaned up seamless looping sound for object ${objectId} (${reason})`);
    }
    
    // Clear any pending cleanup timeout
    const timeout = soundCleanupTimeouts.get(objectId);
    if (timeout) {
        window.clearTimeout(timeout);
        soundCleanupTimeouts.delete(objectId);
    }
};

// 🎵 Create seamless looping audio system
const createSeamlessLoopingSound = async (
    objectId: string, 
    filename: string, 
    volume: number,
    pitchVariation: number
): Promise<boolean> => {
    try {
        const audio1 = await getAudio(filename);
        const audio2 = await getAudio(filename);
        
        const primary = audio1.cloneNode() as HTMLAudioElement;
        const secondary = audio2.cloneNode() as HTMLAudioElement;
        
        // Configure both instances
        [primary, secondary].forEach(audio => {
            audio.loop = false; // We'll handle looping manually
            audio.volume = Math.min(1.0, Math.max(0.0, volume));
            audio.playbackRate = pitchVariation;
        });
        
        // Get audio duration for overlap timing
        const duration = primary.duration || 10; // fallback to 10 seconds
        const overlapTime = Math.min(1, duration * 0.1); // 10% overlap, max 1 second
        const nextSwapTime = Date.now() + (duration - overlapTime) * 1000;
        
        // Store the seamless sound configuration
        activeSeamlessLoopingSounds.set(objectId, {
            primary,
            secondary,
            isPrimaryActive: true,
            nextSwapTime,
            volume,
            pitchVariation
        });
        
        // Start with primary audio
        await primary.play();
        // console.log(`🎵 Started seamless looping sound: ${filename} for object ${objectId} (duration: ${duration}s, overlap: ${overlapTime}s)`);
        
        // Set up error handlers
        [primary, secondary].forEach((audio, index) => {
            const handleError = (e: Event) => {
                if (!(audio as any)._isBeingCleaned) {
                    console.warn(`🔊 Seamless audio error for object ${objectId} (${index === 0 ? 'primary' : 'secondary'}):`, e);
                    cleanupLoopingSound(objectId, "seamless audio error");
                }
            };
            audio.addEventListener('error', handleError, { once: true });
        });
        
        return true;
    } catch (error) {
        console.warn(`🎵 Failed to create seamless looping sound for object ${objectId}: ${filename}`, error);
        return false;
    }
};

// 🎵 Update seamless looping sounds (handle overlapping)
const updateSeamlessLoopingSounds = (masterVolume: number, environmentalVolume: number) => {
    const now = Date.now();
    
    activeSeamlessLoopingSounds.forEach((seamlessSound, objectId) => {
        const { primary, secondary, isPrimaryActive, nextSwapTime, volume, pitchVariation } = seamlessSound;
        
        // Check if it's time to start the overlap
        if (now >= nextSwapTime) {
            const currentAudio = isPrimaryActive ? primary : secondary;
            const nextAudio = isPrimaryActive ? secondary : primary;
            
            try {
                                        // Start the next audio with slight volume and pitch variation for naturalness
                        const volumeVariation = 0.95 + Math.random() * 0.1; // 0.95 to 1.05 (±5%)
                        const newPitchVariation = pitchVariation * (0.98 + Math.random() * 0.04); // Slight pitch variation (±2%)
                
                nextAudio.volume = Math.min(1.0, volume * volumeVariation);
                nextAudio.playbackRate = newPitchVariation;
                nextAudio.currentTime = 0;
                nextAudio.play();
                
                // Schedule the fade-out of the current audio and swap
                const fadeOutTime = 500; // 500ms fade out
                const fadeSteps = 20;
                const fadeInterval = fadeOutTime / fadeSteps;
                const initialVolume = currentAudio.volume;
                
                let fadeStep = 0;
                const fadeOut = setInterval(() => {
                    fadeStep++;
                    const newVolume = initialVolume * (1 - fadeStep / fadeSteps);
                    currentAudio.volume = Math.max(0, newVolume);
                    
                    if (fadeStep >= fadeSteps) {
                        clearInterval(fadeOut);
                        currentAudio.pause();
                        currentAudio.currentTime = 0;
                        
                        // Swap active audio
                        seamlessSound.isPrimaryActive = !isPrimaryActive;
                        
                        // Schedule next swap
                        const duration = nextAudio.duration || 10;
                        const overlapTime = Math.min(1, duration * 0.1);
                        seamlessSound.nextSwapTime = now + (duration - overlapTime) * 1000;
                    }
                }, fadeInterval);
                
                // console.log(`🎵 Seamless swap for object ${objectId}: ${isPrimaryActive ? 'primary→secondary' : 'secondary→primary'}`);
                
            } catch (error) {
                console.warn(`🎵 Error during seamless swap for object ${objectId}:`, error);
                cleanupLoopingSound(objectId, "seamless swap error");
            }
        }
    });
};

// 🎵 Determine which sounds should use seamless looping
const shouldUseSeamlessLooping = (filename: string): boolean => {
    const seamlessFilenames = [
        'campfire_looping.mp3',
        'lantern_looping.mp3',
        'rain_normal.mp3',
        'rain_heavy_storm.mp3'
    ];
    return seamlessFilenames.includes(filename);
};

// Main sound system hook
export const useSoundSystem = ({ 
    soundEvents,
    continuousSounds,
    localPlayerPosition, 
    localPlayerIdentity,
    masterVolume = 0.8,
    environmentalVolume = 0.7
}: SoundSystemProps) => {
    const processedSoundEventsRef = useRef<Set<string>>(new Set());
    const isInitializedRef = useRef(false);
    const lastSoundProcessTimeRef = useRef<number>(0);
    const SOUND_PROCESSING_DEBOUNCE_MS = 500; // Minimum 500ms between sound processing
    const pendingSoundCreationRef = useRef<Set<string>>(new Set()); // Track sounds being created
    
    // Preload sounds on first mount
    useEffect(() => {
        if (isInitializedRef.current) return;
        isInitializedRef.current = true;
        
        const preloadAll = async () => {
            const promises = PRELOAD_SOUNDS.map(filename => 
                loadAudio(filename).catch(err => console.warn(`Preload failed: ${filename}`, err))
            );
            await Promise.allSettled(promises);
        };
        
        preloadAll();
    }, []);
    
    // Process server sound events (for other players' actions)
    useEffect(() => {
        if (!localPlayerPosition || !localPlayerIdentity || !soundEvents) return;
        
        soundEvents.forEach((soundEvent, eventId) => {
            // Skip if already processed
            if (processedSoundEventsRef.current.has(eventId)) return;
            
            // Mark as processed
            processedSoundEventsRef.current.add(eventId);
            
            // Skip our own sounds if they use PREDICT_CONFIRM strategy
            const soundType = soundEvent.filename.replace(/\d*\.mp3$/, '') as SoundType;
            const definition = SOUND_DEFINITIONS[soundType];
            
            // Special handling for stop_bandaging
            if (soundType === 'stop_bandaging') {
                const playerKey = soundEvent.triggeredBy.toString();
                const activeBandagingSound = activeBandagingSounds.get(playerKey);
                if (activeBandagingSound) {
                    activeBandagingSound.pause();
                    activeBandagingSound.currentTime = 0;
                    activeBandagingSounds.delete(playerKey);
                    console.log(`🔊 Stopped bandaging sound for player ${playerKey}`);
                }
                return; // Don't play the stop_bandaging sound itself
            }
            
            // Special handling for bandaging sounds - track them so they can be stopped
            if (soundType === 'bandaging') {
                const playerKey = soundEvent.triggeredBy.toString();
                
                // Stop any existing bandaging sound for this player first
                const existingBandagingSound = activeBandagingSounds.get(playerKey);
                if (existingBandagingSound) {
                    existingBandagingSound.pause();
                    existingBandagingSound.currentTime = 0;
                    activeBandagingSounds.delete(playerKey);
                }
                
                // Play the new bandaging sound and track it
                const playBandagingSound = async () => {
                    try {
                        const audio = await getAudio(soundEvent.filename);
                        const audioClone = audio.cloneNode() as HTMLAudioElement;
                        
                        const distance = calculateDistance(
                            soundEvent.posX,
                            soundEvent.posY,
                            localPlayerPosition.x,
                            localPlayerPosition.y
                        );
                        
                        const volume = calculateSpatialVolume(
                            distance,
                            soundEvent.volume,
                            soundEvent.maxDistance
                        ) * masterVolume;
                        
                        if (volume > 0.01) {
                            audioClone.volume = Math.min(1.0, volume);
                            audioClone.loop = false; // Bandaging sound should NOT loop - it should play once for the 5-second duration
                            audioClone.currentTime = 0;
                            
                            // Track this sound so it can be stopped if interrupted
                            activeBandagingSounds.set(playerKey, audioClone);
                            
                            // Cleanup when sound ends naturally
                            const cleanup = () => {
                                activeBandagingSounds.delete(playerKey);
                                audioClone.removeEventListener('ended', cleanup);
                                audioClone.removeEventListener('error', cleanup);
                            };
                            
                            audioClone.addEventListener('ended', cleanup, { once: true });
                            audioClone.addEventListener('error', cleanup, { once: true });
                            
                            await audioClone.play();
                            console.log(`🔊 Started bandaging sound for player ${playerKey} (non-looping, will end naturally)`);
                        }
                    } catch (error) {
                        console.warn(`🔊 Failed to play bandaging sound for player ${playerKey}:`, error);
                    }
                };
                
                playBandagingSound();
                return; // Don't use the regular spatial audio for bandaging
            }
            
            // All remaining sounds are SERVER_ONLY, so play all server sounds
            
            // Play spatial sound for other players or server-only sounds
            playSpatialAudio(
                soundEvent.filename,
                soundEvent.posX,
                soundEvent.posY,
                localPlayerPosition.x,
                localPlayerPosition.y,
                soundEvent.volume,
                soundEvent.maxDistance,
                masterVolume
            ).catch(err => {
                console.warn(`🔊 Failed to play server sound: ${soundEvent.filename}`, err);
            });
        });
        
        // Cleanup old processed events
        if (processedSoundEventsRef.current.size > 100) {
            const eventsArray = Array.from(processedSoundEventsRef.current);
            processedSoundEventsRef.current = new Set(eventsArray.slice(-50));
        }
        
    }, [soundEvents, localPlayerPosition, localPlayerIdentity, masterVolume]);

    // Process continuous/looping sounds
    useEffect(() => {
        if (!localPlayerPosition || !localPlayerIdentity || !continuousSounds) return;

        // CRITICAL FIX: Prevent processing during rapid loading sequence updates
        // Only process if we have a valid, stable player position
        if (!localPlayerPosition.x || !localPlayerPosition.y || 
            !isFinite(localPlayerPosition.x) || !isFinite(localPlayerPosition.y)) {
            // console.log(`🔊 Skipping sound processing - invalid player position: (${localPlayerPosition.x}, ${localPlayerPosition.y})`);
            return;
        }

        // DEBOUNCE: Prevent rapid-fire sound processing during loading
        const now = Date.now();
        if (now - lastSoundProcessTimeRef.current < SOUND_PROCESSING_DEBOUNCE_MS) {
            // console.log(`🔊 Debouncing sound processing (${now - lastSoundProcessTimeRef.current}ms since last)`);
            return;
        }
        lastSoundProcessTimeRef.current = now;

        // console.log(`🔊 Processing ${continuousSounds.size} continuous sounds... Player at (${localPlayerPosition.x.toFixed(1)}, ${localPlayerPosition.y.toFixed(1)})`);
        const currentActiveSounds = new Set<string>();

        // First pass: Handle inactive sounds and build active sounds set
        continuousSounds.forEach((continuousSound, soundId) => {
            const objectId = continuousSound.objectId.toString();
            
            // console.log(`🔊 Processing sound for object ${objectId}: isActive=${continuousSound.isActive}, filename=${continuousSound.filename}, pos=(${continuousSound.posX}, ${continuousSound.posY}), volume=${continuousSound.volume}, maxDistance=${continuousSound.maxDistance}`);
            
            if (continuousSound.isActive) {
                currentActiveSounds.add(objectId);
            } else {
                // Handle inactive sounds - stop them immediately with proper cleanup
                cleanupLoopingSound(objectId, "marked inactive");
            }
        });

        // Second pass: Process active sounds
        continuousSounds.forEach((continuousSound, soundId) => {
            const objectId = continuousSound.objectId.toString();
            
            // Skip inactive sounds - already handled above
            if (!continuousSound.isActive) {
                return;
            }

            // Check if we're already playing this sound OR if it's being created
            const existingSound = activeLoopingSounds.get(objectId);
            const existingSeamlessSound = activeSeamlessLoopingSounds.get(objectId);
            const isBeingCreated = pendingSoundCreationRef.current.has(objectId);
            
            if (isBeingCreated) {
                // console.log(`🔊 Sound ${objectId} is already being created, skipping`);
                return;
            }
            
            if (existingSeamlessSound) {
                // Update seamless sound volume and position
                // console.log(`🎵 Updating existing seamless sound for object ${objectId}`);
                
                // Special handling for global sounds (infinite distance)
                if (continuousSound.maxDistance === Infinity || !isFinite(continuousSound.maxDistance) || continuousSound.maxDistance >= 1e30) {
                    const isEnvironmental = continuousSound.filename.includes('rain') || 
                                           continuousSound.filename.includes('wind') || 
                                           continuousSound.filename.includes('storm');
                    
                    const volumeMultiplier = isEnvironmental ? environmentalVolume : masterVolume;
                    const globalVolume = continuousSound.volume * volumeMultiplier;
                    
                    // Update volume for both audio instances
                    existingSeamlessSound.primary.volume = Math.min(1.0, globalVolume);
                    existingSeamlessSound.secondary.volume = Math.min(1.0, globalVolume);
                    existingSeamlessSound.volume = globalVolume;
                    
                    return; // Done processing this global seamless sound
                }
                
                // Update volume based on distance for existing seamless sound
                const distance = calculateDistance(
                    continuousSound.posX,
                    continuousSound.posY,
                    localPlayerPosition.x,
                    localPlayerPosition.y
                );
                
                if (!isFinite(distance) || distance > 10000) {
                    console.warn(`🔊 Invalid distance ${distance} for seamless object ${objectId} - stopping sound`);
                    cleanupLoopingSound(objectId, "invalid distance");
                    return;
                }
        
                const volume = calculateSpatialVolume(
                    distance,
                    continuousSound.volume,
                    continuousSound.maxDistance
                ) * masterVolume;

                existingSeamlessSound.volume = volume;
                
                if (volume <= 0.01) {
                    // Too far away, pause both sounds
                    if (!existingSeamlessSound.primary.paused) {
                        existingSeamlessSound.primary.pause();
                    }
                    if (!existingSeamlessSound.secondary.paused) {
                        existingSeamlessSound.secondary.pause();
                    }
                } else {
                    // Update volume and ensure the active sound is playing
                    const activeAudio = existingSeamlessSound.isPrimaryActive ? 
                                       existingSeamlessSound.primary : existingSeamlessSound.secondary;
                    
                    existingSeamlessSound.primary.volume = Math.min(1.0, volume);
                    existingSeamlessSound.secondary.volume = Math.min(1.0, volume);
                    
                    if (activeAudio.paused) {
                        activeAudio.play().catch(err => {
                            console.warn(`🎵 Failed to resume seamless sound for object ${objectId}:`, err);
                        });
                    }
                }
                return; // Done processing this seamless sound
            }
            
            if (existingSound) {
                // console.log(`🔊 Updating existing sound for object ${objectId}`);
                
                // Special handling for global sounds (infinite distance)
                if (continuousSound.maxDistance === Infinity || !isFinite(continuousSound.maxDistance) || continuousSound.maxDistance >= 1e30) {
                    // Determine if this is an environmental sound by checking the filename
                    const isEnvironmental = continuousSound.filename.includes('rain') || 
                                           continuousSound.filename.includes('wind') || 
                                           continuousSound.filename.includes('storm');
                    
                    // Use environmental volume for environmental sounds, master volume for others
                    const volumeMultiplier = isEnvironmental ? environmentalVolume : masterVolume;
                    const globalVolume = continuousSound.volume * volumeMultiplier;
                    existingSound.volume = Math.min(1.0, globalVolume);
                    
                    // Ensure global sound is always playing (never paused)
                    if (existingSound.paused) {
                        existingSound.play().catch(err => {
                            console.warn(`🔊 Failed to resume global sound for object ${objectId}:`, err);
                        });
                        // console.log(`🔊 Resumed global ${isEnvironmental ? 'environmental' : 'regular'} sound for object ${objectId} (maxDistance: ${continuousSound.maxDistance})`);
                    }
                    return; // Done processing this global sound
                }
                
                // Update volume based on distance for existing sound
                const distance = calculateDistance(
                    continuousSound.posX,
                    continuousSound.posY,
                    localPlayerPosition.x,
                    localPlayerPosition.y
                );
                
                // Validate distance
                if (!isFinite(distance) || distance > 10000) {
                    console.warn(`🔊 Invalid distance ${distance} for object ${objectId} - stopping sound`);
                    cleanupLoopingSound(objectId, "invalid distance");
                    return;
                }
                
                const volume = calculateSpatialVolume(
                    distance,
                    continuousSound.volume,
                    continuousSound.maxDistance
                ) * masterVolume;

                if (volume <= 0.01) {
                    // Too far away, pause the sound but keep it in the map
                    if (!existingSound.paused) {
                        existingSound.pause();
                        // console.log(`🔊 Paused looping sound for object ${objectId} (too far away)`);
                    }
                } else {
                    // Update volume and ensure it's playing
                    existingSound.volume = Math.min(1.0, volume);
                    if (existingSound.paused) {
                        existingSound.play().catch(err => {
                            console.warn(`🔊 Failed to resume looping sound for object ${objectId}:`, err);
                        });
                        // console.log(`🔊 Resumed looping sound for object ${objectId} (back in range)`);
                    }
                }
                return; // Done processing this active sound
            }

            // Start a new looping sound for this active object
            // console.log(`🔊 Starting new looping sound for object ${objectId}: ${continuousSound.filename}`);
            
            // Mark this sound as being created to prevent duplicates
            pendingSoundCreationRef.current.add(objectId);
            
            const startLoopingSound = async () => {
                try {
                    // CRITICAL: Double-check we don't already have this sound (race condition protection)
                    if (activeLoopingSounds.has(objectId)) {
                        console.warn(`🔊 Race condition detected - sound ${objectId} already exists, skipping duplicate creation`);
                        pendingSoundCreationRef.current.delete(objectId);
                        return;
                    }
                    
                    let volume: number;
                    
                    // Special handling for global sounds (infinite distance)
                    if (continuousSound.maxDistance === Infinity || !isFinite(continuousSound.maxDistance) || continuousSound.maxDistance >= 1e30) {
                        // Determine if this is an environmental sound by checking the filename
                        const isEnvironmental = continuousSound.filename.includes('rain') || 
                                               continuousSound.filename.includes('wind') || 
                                               continuousSound.filename.includes('storm');
                        
                        // Use environmental volume for environmental sounds, master volume for others
                        const volumeMultiplier = isEnvironmental ? environmentalVolume : masterVolume;
                        volume = continuousSound.volume * volumeMultiplier;
                        
                        // console.log(`🔊 Starting global ${isEnvironmental ? 'environmental' : 'regular'} sound for object ${objectId} with volume ${volume.toFixed(3)} (maxDistance: ${continuousSound.maxDistance})`);
                    } else {
                        // Validate sound position - prevent "sounds everywhere" bug
                        if (!isFinite(continuousSound.posX) || !isFinite(continuousSound.posY)) {
                            console.warn(`🔊 Invalid sound position for object ${objectId}: (${continuousSound.posX}, ${continuousSound.posY}) - skipping`);
                            pendingSoundCreationRef.current.delete(objectId);
                            return;
                        }
                        
                        const distance = calculateDistance(
                            continuousSound.posX,
                            continuousSound.posY,
                            localPlayerPosition.x,
                            localPlayerPosition.y
                        );
                        
                        // Additional validation - prevent extremely large distances that could cause audio issues
                        if (!isFinite(distance) || distance > 10000) {
                            console.warn(`🔊 Invalid distance ${distance} for object ${objectId} - skipping sound`);
                            pendingSoundCreationRef.current.delete(objectId);
                            return;
                        }
                        
                        volume = calculateSpatialVolume(
                            distance,
                            continuousSound.volume,
                            continuousSound.maxDistance
                        ) * masterVolume;

                        if (volume <= 0.01) {
                            // console.log(`🔊 Skipping looping sound for object ${objectId} (too far away on start, distance: ${distance.toFixed(1)}, volume: ${volume.toFixed(3)})`);
                            pendingSoundCreationRef.current.delete(objectId);
                            return; // Too far away
                        }
                        
                        // console.log(`🔊 Starting spatial sound for object ${objectId} at distance ${distance.toFixed(1)} with volume ${volume.toFixed(3)}`);
                    }
                    
                    // CRITICAL: Additional validation to prevent "sounds everywhere" bug
                    if (!isFinite(volume) || volume < 0) {
                        console.warn(`🔊 Invalid volume calculated for object ${objectId}: ${volume} - skipping sound`);
                        pendingSoundCreationRef.current.delete(objectId);
                        return;
                    }

                    // 🎵 Choose between seamless looping and traditional looping
                    let useSeamlessLooping = shouldUseSeamlessLooping(continuousSound.filename);
                    let audioClone: HTMLAudioElement | null = null;
                    
                    if (useSeamlessLooping) {
                        // Use seamless looping system for smooth continuous sounds
                        const pitchVariation = 0.95 + Math.random() * 0.1; // Tighter pitch range for seamless sounds
                        const success = await createSeamlessLoopingSound(objectId, continuousSound.filename, volume, pitchVariation);
                        
                        if (success) {
                            const soundTypeEmoji = continuousSound.filename.includes('campfire') ? '🔥' : 
                                                  continuousSound.filename.includes('lantern') ? '🏮' : '🎵';
                            console.log(`${soundTypeEmoji} Successfully started seamless looping sound: ${continuousSound.filename} for object ${objectId} at volume ${volume.toFixed(3)}`);
                        } else {
                            console.warn(`🎵 Failed to start seamless looping, falling back to traditional loop for ${objectId}`);
                            // Fall back to traditional looping
                            useSeamlessLooping = false;
                        }
                    }
                    
                    if (!useSeamlessLooping) {
                        // Use traditional looping for other sounds
                        const audio = await getAudio(continuousSound.filename);
                        audioClone = audio.cloneNode() as HTMLAudioElement;
                        
                        // Configure for looping
                        audioClone.loop = true;
                        audioClone.volume = Math.min(1.0, Math.max(0.0, volume)); // Use the properly clamped volume
                        audioClone.currentTime = 0;
                        
                        // Add random pitch variation for variety
                        const pitchVariation = 0.9 + Math.random() * 0.2; // 0.9 to 1.1 (±10%)
                        audioClone.playbackRate = pitchVariation;
                        
                        // Store the active sound BEFORE playing to prevent race conditions
                        activeLoopingSounds.set(objectId, audioClone);
                        
                        // Start playing
                        await audioClone.play();
                        const soundTypeEmoji = continuousSound.filename.includes('campfire') ? '🔥' : 
                                              continuousSound.filename.includes('lantern') ? '🏮' : '🔊';
                        console.log(`${soundTypeEmoji} Successfully started traditional looping sound: ${continuousSound.filename} for object ${objectId} at volume ${volume.toFixed(3)}`);
                    }
                    
                    // Clear pending creation flag (for both types)
                    pendingSoundCreationRef.current.delete(objectId);
                    
                    // Enhanced cleanup event handlers for traditional looping only
                    if (audioClone) {
                        const handleAudioEnd = () => {
                            // console.log(`🔊 Looping sound ended unexpectedly for object ${objectId}`);
                            cleanupLoopingSound(objectId, "audio ended unexpectedly");
                        };
                        
                        const handleAudioError = (e: Event) => {
                            // Check if this audio is being cleaned up - if so, ignore the error
                            if ((audioClone as any)._isBeingCleaned) {
                                return; // Ignore cleanup-related errors
                            }
                            
                            // Only log genuine audio errors, not cleanup-related ones
                            console.warn(`🔊 Audio error for object ${objectId} (genuine error):`, e);
                            cleanupLoopingSound(objectId, "audio error");
                        };
                        
                        audioClone.addEventListener('ended', handleAudioEnd, { once: true });
                        audioClone.addEventListener('error', handleAudioError, { once: true });
                    }
                    
                    // Set up a safety timeout to prevent eternal sounds (cleanup after 30 seconds of no updates)
                    const safetyTimeout = window.setTimeout(() => {
                        if (activeLoopingSounds.has(objectId)) {
                            console.warn(`🔊 Safety timeout triggered for sound ${objectId} - cleaning up potential leak`);
                            cleanupLoopingSound(objectId, "safety timeout");
                        }
                    }, 30000); // 30 seconds
                    
                    soundCleanupTimeouts.set(objectId, safetyTimeout);
                    
                } catch (error) {
                    console.warn(`🔊 Failed to start looping sound for object ${objectId}: ${continuousSound.filename}`, error);
                    pendingSoundCreationRef.current.delete(objectId);
                }
            };

            startLoopingSound();
        });

        // Third pass: Stop sounds for objects that are no longer active
        for (const [objectId] of activeLoopingSounds.entries()) {
            if (!currentActiveSounds.has(objectId)) {
                cleanupLoopingSound(objectId, "removed/inactive object");
            }
        }
        
        // Stop seamless sounds for objects that are no longer active
        for (const [objectId] of activeSeamlessLoopingSounds.entries()) {
            if (!currentActiveSounds.has(objectId)) {
                cleanupLoopingSound(objectId, "removed/inactive seamless object");
            }
        }

        // 🎵 Update seamless looping sounds (handle overlapping and volume changes)
        updateSeamlessLoopingSounds(masterVolume, environmentalVolume);

        // console.log(`🔊 Active looping sounds: ${activeLoopingSounds.size}, Active seamless sounds: ${activeSeamlessLoopingSounds.size}, Current active objects: ${currentActiveSounds.size}`);

    }, [continuousSounds, localPlayerPosition, localPlayerIdentity, masterVolume, environmentalVolume]);
    
    // Periodic cleanup to prevent sound leaks
    useEffect(() => {
        const periodicCleanup = window.setInterval(() => {
            // Check for orphaned sounds (sounds playing but not in current continuous sounds)
            if (continuousSounds && activeLoopingSounds.size > 0) {
                const currentObjectIds = new Set<string>();
                continuousSounds.forEach(sound => {
                    if (sound.isActive) {
                        currentObjectIds.add(sound.objectId.toString());
                    }
                });
                
                // Clean up any sounds that are no longer in the server state
                for (const [objectId] of activeLoopingSounds.entries()) {
                    if (!currentObjectIds.has(objectId)) {
                        console.warn(`🔊 Periodic cleanup found orphaned sound for object ${objectId}`);
                        cleanupLoopingSound(objectId, "periodic cleanup - orphaned");
                    }
                }
            }
        }, 10000); // Check every 10 seconds
        
        return () => {
            window.clearInterval(periodicCleanup);
        };
    }, [continuousSounds]);
    
    // Aggressive cleanup when player identity changes (login/logout)
    useEffect(() => {
        // When player identity changes, clean up ALL sounds to prevent orphaned sounds
        // console.log(`🔊 Player identity changed, cleaning up all existing sounds`);
        
        // Stop all looping sounds
        for (const [objectId] of activeLoopingSounds.entries()) {
            cleanupLoopingSound(objectId, "player identity changed");
        }
        
        // Clear all timeouts
        soundCleanupTimeouts.forEach(timeout => {
            window.clearTimeout(timeout);
        });
        soundCleanupTimeouts.clear();
        
        // Clear pending sound creation tracking
        pendingSoundCreationRef.current.clear();
        
    }, [localPlayerIdentity]); // Trigger when player identity changes
    
    // Cleanup on unmount
    useEffect(() => {
        return () => {
            processedSoundEventsRef.current.clear();
            activeSounds.forEach(audio => {
                audio.pause();
                audio.currentTime = 0;
            });
            activeSounds.clear();
            
            // Stop all looping sounds with proper cleanup
            for (const [objectId] of activeLoopingSounds.entries()) {
                cleanupLoopingSound(objectId, "component unmount");
            }
            
            // Clear any remaining timeouts
            soundCleanupTimeouts.forEach(timeout => {
                window.clearTimeout(timeout);
            });
            soundCleanupTimeouts.clear();
        };
    }, []);
    
    // Public API
    const playSound = useCallback((soundType: SoundType, volume: number = 1) => {
        playLocalSound(soundType, volume);
    }, []);
    
    // Debug function to inspect continuous sounds
    const debugContinuousSounds = useCallback(() => {
        // console.log(`🔊 DEBUG: Current continuous sounds in database:`);
        if (continuousSounds) {
            continuousSounds.forEach((sound, id) => {
                // console.log(`  - ID: ${id}, ObjectID: ${sound.objectId}, Active: ${sound.isActive}, Type: ${sound.soundType}, Filename: ${sound.filename}, Pos: (${sound.posX}, ${sound.posY}), Volume: ${sound.volume}, MaxDist: ${sound.maxDistance}`);
            });
        }
        // console.log(`🔊 DEBUG: Current active looping sounds on client:`);
        activeLoopingSounds.forEach((audio, objectId) => {
            // console.log(`  - ObjectID: ${objectId}, Paused: ${audio.paused}, Volume: ${audio.volume}, CurrentTime: ${audio.currentTime}`);
        });
    }, [continuousSounds]);
    
    // Expose debug function to window for easy access
    useEffect(() => {
        (window as any).debugContinuousSounds = debugContinuousSounds;
        return () => {
            delete (window as any).debugContinuousSounds;
        };
    }, [debugContinuousSounds]);
    
    return {
        playSound,
        masterVolume,
        isAudioSupported: typeof Audio !== 'undefined',
        cachedSoundsCount: audioCache['cache'].size,
        activeSoundsCount: activeSounds.size,
        activeLoopingSoundsCount: activeLoopingSounds.size,
        activeSeamlessLoopingSoundsCount: activeSeamlessLoopingSounds.size,
        soundDefinitions: SOUND_DEFINITIONS,
        debugContinuousSounds, // Expose for debugging
    };
}; 