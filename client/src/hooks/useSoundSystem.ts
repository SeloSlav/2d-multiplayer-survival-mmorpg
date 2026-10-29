import { useEffect, useRef, useCallback } from 'react';
import type { SoundEvent, ContinuousSound, ChunkWeather, Season } from '../generated/types';
import { Identity } from 'spacetimedb';
import { calculateChunkIndex } from '../utils/chunkUtils';
import { isAnySovaAudioPlaying } from './useSovaSoundBox';
import { recordTreeFallPlayback } from '../utils/treeFallAudioSync';

interface SoundSystemProps {
    soundEvents: Map<string, SoundEvent>;
    continuousSounds: Map<string, ContinuousSound>;
    localPlayerPosition: { x: number; y: number } | null;
    localPlayerIdentity: Identity | null;
    masterVolume?: number; // 0-1 scale (up to 100%) for regular sounds
    environmentalVolume?: number; // 0-1 scale for environmental sounds (rain, wind, etc.)
    chunkWeather?: Map<string, ChunkWeather>; // Chunk-based weather for filtering rain sounds
    currentSeason?: Season | null; // Current season - used to mute rain sounds in winter (snow doesn't make rain sounds)
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
    bees_buzzing: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.25, maxDistance: 525, isLooping: true }, // Subtle ambient buzz (wild + wooden beehives)
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
    item_thrown: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.9, maxDistance: 500 }, // Item/weapon thrown sound
    break_item: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.95, maxDistance: 500 }, // Arrows/projectiles breaking on impact
    arrow_hit: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.1, maxDistance: 550 }, // Arrow hits on players/corpses
    shoot_bow: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 800 }, // Hunting bow firing
    shoot_crossbow: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.1, maxDistance: 850 }, // Crossbow firing
    shoot_pistol: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.2, maxDistance: 3000 }, // Pistol firing
    reload_bow: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.8, maxDistance: 400 }, // Bow nocking arrow
    reload_crossbow: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.9, maxDistance: 450 }, // Crossbow loading bolt
    reload_pistol: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.85, maxDistance: 400 }, // Pistol magazine loading
    bandaging: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.8, maxDistance: 300 }, // Bandaging (5-second duration, non-looping)
    stop_bandaging: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.0, maxDistance: 300 }, // Stop bandaging sound
    barrel_hit: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 600 }, // Barrel hit sound
    barrel_destroyed: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.3, maxDistance: 700 }, // Barrel destroyed sound
    hit_trash: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 600 }, // Trash hit sound (barrel5.png variant 4)
    hit_wood: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 600 }, // Wood hit sound (barrel4.png variant 3, wooden storage boxes)
    player_burnt: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Player burn effect applied (client-side immediate feedback)
    // Animal growl sounds - when animals detect and approach players
    growl_wolf: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.2, maxDistance: 800 }, // Wolf growl when starting to chase
    growl_fox: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 650 }, // Fox growl when starting to attack
    growl_snake: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.1, maxDistance: 700 }, // Snake/viper growl when approaching
    growl_walrus: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.3, maxDistance: 1000 }, // Walrus growl when disturbed or patrolling
    growl_crow: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 500 }, // Crow caw when detecting players
    growl_tern: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 500 }, // Tern screech when detecting players
    animal_burrow: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.8, maxDistance: 300 }, // Digging sound when animals (e.g., voles) burrow underground
    // Movement sounds - server only for proper synchronization
    walking: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.7, maxDistance: 400 }, // Player footsteps when moving
    swimming: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.8, maxDistance: 450 }, // Player swimming sounds in water
    // UI/Item interaction sounds - immediate (no server sync needed)
    crush_bones: { strategy: SoundStrategy.IMMEDIATE, volume: 1.2 }, // Local client sound
    mash_berries: { strategy: SoundStrategy.IMMEDIATE, volume: 1.2 }, // Mashing berries into Berry Mash
    pulverize_flour: { strategy: SoundStrategy.IMMEDIATE, volume: 1.2 }, // Grinding items into flour
    extract_queen_bee: { strategy: SoundStrategy.IMMEDIATE, volume: 1.2 }, // Extracting queen bee from honeycomb
    unravel_rope: { strategy: SoundStrategy.IMMEDIATE, volume: 1.2 }, // Unraveling rope into plant fiber
    gut_fish: { strategy: SoundStrategy.IMMEDIATE, volume: 1.2 }, // Gutting raw fish for Animal Fat (uses melee slash sound)
    // SOVA tutorial sounds - special handling (triggers chat message as well as audio)
    sova_memory_shard_tutorial: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 10000 }, // SOVA explains memory shards on first pickup
    sova_memory_shard_200_tutorial: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 10000 }, // SOVA warns about 200 shards, mind instability, Memory Grid
    till_dirt: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 200 }, // Tilling soil with Stone Tiller
    error_tilling_failed: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 50 }, // SOVA: "This ground cannot be tilled"
    error_tilling_dirt: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 50 }, // SOVA: "This soil has already been prepared"
    // Building sounds - server only (all players hear)
    foundation_wood_constructed: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 700 }, // Foundation placement sound
    foundation_wood_upgraded: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 700 }, // Foundation upgraded to wood sound
    foundation_stone_upgraded: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 700 }, // Foundation upgraded to stone sound
    foundation_metal_upgraded: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 700 }, // Foundation upgraded to metal sound
    twig_foundation_destroyed: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 700 }, // Twig foundation destroyed sound
    // Building sounds - immediate (local feedback)
    construction_placement_error: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Foundation placement error sound
    error_resources: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Resource error sound (client-side immediate for instant feedback)
    error_arrows: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Arrow error sound (client-side immediate for instant feedback when firing without arrows)
    error_building_privilege: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Building privilege error sound (client-side immediate for instant feedback when trying to upgrade without privilege)
    error_tier_upgrade: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Tier upgrade error sound (client-side immediate for instant feedback when trying to upgrade to same or lower tier)
    error_planting: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Planting error sound (client-side immediate for instant feedback when planting in invalid location)
    error_planting_monument: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Planting in monument zone error (client-side immediate for instant feedback when trying to plant seeds in protected monument areas)
    error_seed_occupied: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Seed occupied error - tile already has a seed (one seed per tile rule)
    error_chest_placement: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Chest placement error sound (client-side immediate for instant feedback when Matron's Chest placement fails)
    error_foundation_monument: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Foundation monument error sound (client-side immediate for instant feedback when trying to place foundation in rune stone light area)
    error_jar_placement: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Jar placement error sound (client-side immediate for instant feedback when trying to place soup back into broth pot output slot)
    error_broth_not_compatible: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Broth not compatible error sound (when trying to place incompatible item in broth pot)
    error_field_cauldron_placement: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Field cauldron placement error sound (client-side immediate for instant feedback when trying to place cauldron without nearby campfire)
    error_seaweed_above_water: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Error when trying to harvest seaweed while above water (not snorkeling) - client-side immediate
    stun: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.3, maxDistance: 800 }, // Stun effect applied (from blunt weapons)
    done_burning: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.2, maxDistance: 700 }, // Food became burnt sound (campfire/barbecue)
    barbecue_on: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 600 }, // Barbecue turning on sound
    barbecue_off: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 600 }, // Barbecue turning off sound
    error_placement_failed: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Placeable placement error sound (client-side immediate for instant feedback when trying to place campfire/furnace/etc on water or invalid location)
    unlock_sound: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Memory grid skill/faction unlock sound (client-side immediate for instant feedback)
    cairn_unlock: { strategy: SoundStrategy.IMMEDIATE, volume: 1.0 }, // Cairn unlock sound (client-side immediate for instant feedback when player first unlocks a cairn)
    crow_stealing: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.2, maxDistance: 700 }, // Crow stealing sound when successfully stealing from player
    // Thunder sound - global weather effect
    thunder: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.5, maxDistance: Infinity, isEnvironmental: true }, // Thunder sound (4 variations)
} as const;

type SoundType = keyof typeof SOUND_DEFINITIONS;

/** Server echoes skipped for the instigator — same clips are played immediately in useInputHandler with swing/harvest. */
const LOCAL_PREDICT_SPATIAL_SKIP_SOUNDS = new Set<SoundType>([
    'weapon_swing',
    'tree_chop',
    'stone_hit',
    'barrel_hit',
    'hit_wood',
    'hit_trash',
]);

/** PascalCase→snake via `_` before each cap breaks interior words: ErrorSeeweedAboveWater → error_seeweed_above_water. */
function normalizeSoundTypeKeyFromEnumTag(s: string): SoundType {
    if (s === 'error_seeweed_above_water') return 'error_seaweed_above_water';
    return s as SoundType;
}

// Sounds that should not have pitch variation (always play at original pitch)
const NO_PITCH_VARIATION_SOUNDS: Set<SoundType> = new Set([
    'error_resources',
    'error_arrows',
    'error_building_privilege',
    'error_tier_upgrade',
    'error_planting',
    'error_planting_monument',
    'error_seed_occupied',
    'error_field_cauldron_placement',
    'error_chest_placement',
    'error_foundation_monument',
    'error_jar_placement',
    'error_broth_not_compatible',
    'error_placement_failed',
    'error_seaweed_above_water',
] as SoundType[]);

// Track active error sounds to prevent multiple from playing simultaneously
const activeErrorSounds = new Set<HTMLAudioElement>();

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

const isTransientPlaybackAbort = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') return false;
    const maybeError = error as { name?: string; message?: string };
    const name = maybeError.name ?? '';
    const message = (maybeError.message ?? '').toLowerCase();
    return name === 'AbortError' ||
        message.includes('play() request was interrupted') ||
        message.includes('paused to save power');
};

// Audio cache for managing loaded sounds
class AudioCache {
    private cache = new Map<string, HTMLAudioElement>();
    private accessOrder = new Map<string, number>();
    private accessCounter = 0;
    private readonly maxSize = 50;
    // Track failed loads with retry count (allow retries, only permanently fail after 5 attempts)
    private failedLoads = new Map<string, number>();

    get(filename: string): HTMLAudioElement | null {
        // Don't even try if we know it permanently failed (5+ attempts)
        const failCount = this.failedLoads.get(filename) || 0;
        if (failCount >= 5) {
            return null;
        }
        
        const audio = this.cache.get(filename);
        if (audio) {
            this.accessOrder.set(filename, ++this.accessCounter);
            return audio;
        }
        return null;
    }

    set(filename: string, audio: HTMLAudioElement): void {
        // Remove from failed loads if successfully loaded
        this.failedLoads.delete(filename);
        
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
    
    markFailed(filename: string): void {
        // Track failure count instead of permanent failure
        const currentCount = this.failedLoads.get(filename) || 0;
        this.failedLoads.set(filename, currentCount + 1);
    }
    
    isFailed(filename: string): boolean {
        // Only consider permanently failed after 5 attempts
        const failCount = this.failedLoads.get(filename) || 0;
        return failCount >= 5;
    }
    
    clearFailure(filename: string): void {
        this.failedLoads.delete(filename);
    }

    clear(): void {
        this.cache.clear();
        this.accessOrder.clear();
        this.accessCounter = 0;
        this.failedLoads.clear();
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
    pitchVariation: number = 1.0,
    onStarted?: () => void
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
        onStarted?.();
        
    } catch (error) {
        console.warn(`🔊 Web Audio error for ${filename}:`, error);
        // Fallback to regular audio with clamped volume
        const audio = await getAudio(filename);
        if (!audio) {
            return; // Failed to load, skip playback
        }
        
        const audioClone = audio.cloneNode() as HTMLAudioElement;
        audioClone.volume = Math.min(1.0, volume); // Clamp for fallback
        audioClone.playbackRate = pitchVariation;
        audioClone.currentTime = 0;
        // Handle browser autoplay policies
        try {
            const playPromise = audioClone.play();
            if (playPromise !== undefined) {
                await playPromise;
            }
            onStarted?.();
        } catch (playError: any) {
            // Browser blocked autoplay - silent failure is expected
            if (playError.name !== 'NotAllowedError' && playError.name !== 'NotSupportedError') {
                console.warn(`🔊 Web Audio fallback playback error:`, playError);
            }
        }
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
    'bees_buzzing.mp3',                                    // 1 beehive buzzing variation
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
    'mash_berries.mp3',                                     // 1 mash berries variation
    'pulverize_flour.mp3',                                  // 1 pulverize flour variation
    'extract_queen_bee.mp3',                                // 1 extract queen bee variation
    'unravel_rope.mp3',                                     // 1 unravel rope variation
    'melee_hit_blunt.mp3',                                  // 1 melee hit blunt variation
    'weapon_swing.mp3',                                     // 1 weapon swing variation
    'item_thrown.mp3',                                      // 1 item thrown variation
    'break_item.mp3',                                       // 1 projectile/item break variation
    'arrow_hit.mp3',                                        // 1 arrow hit variation
    'shoot_bow.mp3',                                        // 1 shoot bow variation
    'shoot_crossbow.mp3',                                   // 1 shoot crossbow variation
    'shoot_pistol.mp3',                                     // 1 shoot pistol variation
    'reload_bow.mp3',                                       // 1 reload bow variation
    'reload_crossbow.mp3',                                  // 1 reload crossbow variation
    'reload_pistol.mp3',                                    // 1 reload pistol variation
    'bandaging.mp3',                                        // 1 bandaging variation
    'barrel_hit.mp3',                                       // 1 barrel hit variation
    'barrel_destroyed.mp3',                                 // 1 barrel destroyed variation
    'hit_wood.mp3',
    'hit_trash.mp3',
    'growl_wolf.mp3',                                       // 1 wolf growl variation
    'growl_fox.mp3',                                        // 1 fox growl variation
    'growl_snake.mp3',                                      // 1 snake growl variation
    'growl_walrus.mp3',                                     // 3 walrus growl variations
    'growl_walrus1.mp3',
    'growl_walrus2.mp3',
    'growl_crow.mp3',                                       // 4 crow caw variations
    'growl_crow1.mp3',
    'growl_crow2.mp3',
    'growl_crow3.mp3',
    'growl_tern.mp3',                                       // 4 tern screech variations
    'growl_tern1.mp3',
    'growl_tern2.mp3',
    'growl_tern3.mp3',
    'walking.mp3',                                          // 4 walking/footstep variations
    'walking1.mp3',
    'walking2.mp3',
    'walking3.mp3',
    'swimming.mp3',                                         // 4 swimming sound variations
    'swimming1.mp3',
    'swimming2.mp3',
    'swimming3.mp3',
    'foundation_wood_constructed.mp3',                      // 1 foundation wood constructed variation
    'foundation_wood_upgraded.mp3',                         // 1 foundation wood upgraded variation
    'foundation_stone_upgraded.mp3',                        // 1 foundation stone upgraded variation
    'foundation_metal_upgraded.mp3',                        // 1 foundation metal upgraded variation
    'twig_foundation_destroyed.mp3',                        // 1 twig foundation destroyed variation
    'error_arrows.mp3',                                      // 1 error arrows variation
    'error_resources.mp3',                                   // 1 error resources variation
    'error_building_privilege.mp3',                         // 1 error building privilege variation
    'error_tier_upgrade.mp3',                               // 1 error tier upgrade variation
    'error_planting.mp3',                                    // 1 error planting variation
    'error_planting_monument.mp3',                           // 1 error planting monument variation (no pitch variation)
    'error_seed_occupied.mp3',                               // 1 error seed occupied variation (no pitch variation)
    'error_field_cauldron_placement.mp3',                   // 1 error field cauldron placement variation
    'construction_placement_error.mp3',                     // 1 construction placement error variation
    'player_burnt.mp3',                                      // 1 player burnt variation
    'done_burning.mp3',                                      // 1 done burning variation (food became burnt)
    'crow_stealing.mp3',                                     // 1 crow stealing variation (when crow steals from player)
    'cairn_unlock.mp3',                                      // 1 cairn unlock variation (when discovering new cairn)
    'error_seaweed_above_water.mp3',                         // 1 seaweed harvest error variation (when above water)
    'sova_error_mobile_capability.mp3',                     // 1 SOVA mobile capability error (no pitch variation - voice line)
    'sova_tutorial_memory_shard.mp3',                       // SOVA memory shard tutorial (first pickup)
    'sova_tutorial_memory_shard_200.mp3',                  // SOVA 200 shards warning (mind instability, Memory Grid)
    'sova_mission_complete.mp3',                            // SOVA quest complete voice
    'stun.mp3',                                               // 1 stun effect variation (when stunned by blunt weapon)
    'thunder.mp3',                                             // 4 thunder variations
    'thunder1.mp3',
    'thunder2.mp3',
    'thunder3.mp3',
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
const getAudio = async (filename: string): Promise<HTMLAudioElement | null> => {
    // Check cache first
    let audio = audioCache.get(filename);
    if (audio) {
        return audio;
    }
    
    // If we've already failed to load this file, don't try again
    if (audioCache.isFailed(filename)) {
        return null;
    }
    
    try {
        // Load and cache
        audio = await loadAudio(filename);
        audioCache.set(filename, audio);
        return audio;
    } catch (error) {
        // Mark as failed to prevent repeated attempts
        audioCache.markFailed(filename);
        // Only log once per file to reduce spam
        console.warn(`🔊 Failed to load ${filename}, will skip future attempts`);
        return null;
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

// Calculate volume for looping/continuous sounds with smoother falloff
// Uses a combination of exponential decay and cosine smoothing for gradual fade-out
const calculateSmoothSpatialVolume = (
    distance: number, 
    baseVolume: number, 
    maxDistance: number
): number => {
    if (distance <= 0) return baseVolume * SOUND_CONFIG.MASTER_VOLUME;
    
    // Extend the effective range for smoother falloff
    const extendedMaxDistance = maxDistance * 1.3; // 30% extra fade zone
    if (distance >= extendedMaxDistance) return 0;
    
    const distanceRatio = distance / maxDistance;
    
    // Use a smoother curve that:
    // 1. Maintains good volume close to the source
    // 2. Has a gradual, natural-sounding falloff
    // 3. Smoothly fades to silence without abrupt cutoff
    
    if (distanceRatio <= 0.3) {
        // Close range: nearly full volume with slight falloff
        // Exponential keeps it loud near the source
        return baseVolume * Math.exp(-distanceRatio * 0.5) * SOUND_CONFIG.MASTER_VOLUME;
    } else if (distanceRatio <= 1.0) {
        // Mid range: gradual exponential decay
        // Volume at 0.3 ratio (for continuity): Math.exp(-0.3 * 0.5) ≈ 0.86
        const startVolume = Math.exp(-0.3 * 0.5);
        const midRatio = (distanceRatio - 0.3) / 0.7; // 0 to 1 over this range
        // Smooth exponential decay from startVolume to ~0.15
        const midVolume = startVolume * Math.exp(-midRatio * 1.8);
        return baseVolume * midVolume * SOUND_CONFIG.MASTER_VOLUME;
    } else {
        // Extended fade zone (1.0 to 1.3 ratio): smooth cosine fade to zero
        // Volume at ratio 1.0: startVolume * Math.exp(-1.8) ≈ 0.86 * 0.165 ≈ 0.14
        const fadeStartVolume = Math.exp(-0.3 * 0.5) * Math.exp(-1.8);
        const fadeRatio = (distanceRatio - 1.0) / 0.3; // 0 to 1 over the extended zone
        // Cosine fade: smooth transition from fadeStartVolume to 0
        const fadeMultiplier = (1 + Math.cos(fadeRatio * Math.PI)) / 2;
        return baseVolume * fadeStartVolume * fadeMultiplier * SOUND_CONFIG.MASTER_VOLUME;
    }
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
    masterVolume: number = 1,
    pitchMultiplier: number = 1.0 // Pitch multiplier from server (default 1.0 for backward compatibility)
): Promise<void> => {
    try {
        // Skip SOVA error sounds when tutorials/rune stones/narrative are playing
        const isSovaErrorFile = /^(error_|sova_error|construction_placement_error)/.test(filename.replace(/\.mp3$/, ''));
        if (isSovaErrorFile && isAnySovaAudioPlaying()) {
            return;
        }
        
        const distance = calculateDistance(soundX, soundY, listenerX, listenerY);
        const volume = calculateSpatialVolume(distance, baseVolume, maxDistance) * masterVolume;
        if (volume <= 0.01) return; // Skip very quiet sounds
        
        // Apply server-provided pitch multiplier, then add random pitch variation
        // Random variation is reduced when pitch multiplier is provided (for animal species-specific sounds)
        const basePitch = pitchMultiplier;
        const randomVariation = pitchMultiplier !== 1.0 
            ? 0.05 // Smaller variation (±5%) when pitch multiplier is set (for animal sounds)
            : SOUND_CONFIG.SPATIAL_PITCH_VARIATION; // Full variation for player sounds
        const pitchVariation = basePitch * (0.95 + Math.random() * randomVariation);
        
        // Add slight random volume variation (±10% for subtle variety)
        const volumeVariation = 0.9 + Math.random() * SOUND_CONFIG.SPATIAL_VOLUME_VARIATION;
        const finalVolume = volume * volumeVariation;
        const onStarted = filename === 'tree_falling.mp3'
            ? () => recordTreeFallPlayback(soundX, soundY, pitchVariation)
            : undefined;
        
        // Use Web Audio API for loud sounds (> 1.0), HTML Audio for normal sounds
        if (finalVolume > 1.0) {
            await playLoudSound(filename, finalVolume, pitchVariation, onStarted);
        } else {
            // Use regular HTML Audio for normal volumes
            const audio = await getAudio(filename);
            if (!audio) {
                return; // Failed to load, skip playback
            }
            
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
            
            // Handle browser autoplay policies - play() can fail silently
            try {
                const playPromise = audioClone.play();
                if (playPromise !== undefined) {
                    await playPromise;
                }
                onStarted?.();
            } catch (playError: any) {
                // Browser blocked autoplay - this is normal and expected
                // Don't log as error, just cleanup silently
                cleanup();
                // Only log if it's not an autoplay policy error
                if (playError.name !== 'NotAllowedError' && playError.name !== 'NotSupportedError') {
                    console.warn(`🔊 Spatial playback error for ${filename}:`, playError);
                }
            }
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
        
        // Skip SOVA error sounds when tutorials/rune stones/narrative are playing - show red box only
        const isSovaErrorSound = NO_PITCH_VARIATION_SOUNDS.has(soundType) || soundType === 'construction_placement_error';
        if (isSovaErrorSound && isAnySovaAudioPlaying()) {
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
            } else if (soundType === 'player_burnt') {
                variationCount = 1; // player_burnt.mp3 - only one variation
            } else if (soundType === 'drinking_water') {
                variationCount = 1; // drinking_water.mp3
            } else if (soundType === 'lantern_looping') {
                variationCount = 1; // lantern_looping.mp3
            } else if (soundType === 'bees_buzzing') {
                variationCount = 1; // bees_buzzing.mp3
            } else if (soundType === 'repair') {
                variationCount = 1; // repair.mp3
            } else if (soundType === 'repair_fail') {
                variationCount = 1; // repair_fail.mp3
            } else if (soundType === 'error_resources') {
                variationCount = 3; // error_resources.mp3, error_resources2.mp3, error_resources3.mp3
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
            } else if (soundType === 'unlock_sound') {
                variationCount = 1; // unlock_sound.mp3 - only one variation
            } else if (soundType === 'light_torch') {
                variationCount = 1; // light_torch.mp3
            } else if (soundType === 'extinguish_torch') {
                variationCount = 1; // extinguish_torch.mp3
            } else if (soundType === 'melee_hit_blunt') {
                variationCount = 1; // melee_hit_blunt.mp3
            } else if (soundType === 'weapon_swing') {
                variationCount = 1; // weapon_swing.mp3
            } else if (soundType === 'item_thrown') {
                variationCount = 1; // item_thrown.mp3
            } else if (soundType === 'crush_bones') {
                variationCount = 1; // crush_bones.mp3
            } else if (soundType === 'mash_berries') {
                variationCount = 1; // mash_berries.mp3
            } else if (soundType === 'pulverize_flour') {
                variationCount = 1; // pulverize_flour.mp3
            } else if (soundType === 'extract_queen_bee') {
                variationCount = 1; // extract_queen_bee.mp3
            } else if (soundType === 'unravel_rope') {
                variationCount = 1; // unravel_rope.mp3
            } else if (soundType === 'gut_fish') {
                variationCount = 1; // Uses melee_hit_sharp.mp3 (cutting/slashing sound)
            } else if (soundType === 'construction_placement_error') {
                variationCount = 1; // construction_placement_error.mp3
            } else if (soundType === 'error_arrows') {
                variationCount = 1; // error_arrows.mp3
            } else if (soundType === 'error_building_privilege') {
                variationCount = 1; // error_building_privilege.mp3
            } else if (soundType === 'error_tier_upgrade') {
                variationCount = 1; // error_tier_upgrade.mp3
            } else if (soundType === 'error_planting') {
                variationCount = 1; // error_planting.mp3
            } else if (soundType === 'error_planting_monument') {
                variationCount = 1; // error_planting_monument.mp3
            } else if (soundType === 'error_seed_occupied') {
                variationCount = 1; // error_seed_occupied.mp3
            } else if (soundType === 'error_field_cauldron_placement') {
                variationCount = 1; // error_field_cauldron_placement.mp3
            } else if (soundType === 'error_chest_placement') {
                variationCount = 1; // error_chest_placement.mp3
            } else if (soundType === 'error_foundation_monument') {
                variationCount = 1; // error_foundation_monument.mp3
            } else if (soundType === 'error_jar_placement') {
                variationCount = 1; // error_jar_placement.mp3
            } else if (soundType === 'error_broth_not_compatible') {
                variationCount = 1; // error_broth_not_compatible.mp3
            } else if (soundType === 'error_placement_failed') {
                variationCount = 1; // error_placement_failed.mp3
            } else if (soundType === 'done_burning') {
                variationCount = 1; // done_burning.mp3 (food became burnt)
            } else if (soundType === 'arrow_hit') {
                variationCount = 1; // arrow_hit.mp3
            } else if (soundType === 'shoot_bow') {
                variationCount = 1; // shoot_bow.mp3
            } else if (soundType === 'shoot_crossbow') {
                variationCount = 1; // shoot_crossbow.mp3
            } else if (soundType === 'shoot_pistol') {
                variationCount = 1; // shoot_pistol.mp3
            } else if (soundType === 'reload_bow') {
                variationCount = 1; // reload_bow.mp3
            } else if (soundType === 'reload_crossbow') {
                variationCount = 1; // reload_crossbow.mp3
            } else if (soundType === 'reload_pistol') {
                variationCount = 1; // reload_pistol.mp3
            } else if (soundType === 'bandaging') {
                variationCount = 1; // bandaging.mp3
            } else if (soundType === 'stop_bandaging') {
                variationCount = 1; // stop_bandaging.mp3
            } else if (soundType === 'barrel_hit') {
                variationCount = 1; // barrel_hit.mp3
            } else if (soundType === 'barrel_destroyed') {
                variationCount = 1; // barrel_destroyed.mp3
            } else if (soundType === 'hit_trash') {
                variationCount = 1; // hit_trash.mp3
            } else if (soundType === 'hit_wood') {
                variationCount = 1; // hit_wood.mp3
            } else if (soundType === 'growl_wolf') {
                variationCount = 1; // growl_wolf.mp3
            } else if (soundType === 'growl_fox') {
                variationCount = 1; // growl_fox.mp3
            } else if (soundType === 'growl_snake') {
                variationCount = 1; // growl_snake.mp3
            } else if (soundType === 'growl_walrus') {
                variationCount = 3; // growl_walrus.mp3, growl_walrus1.mp3, growl_walrus2.mp3
            } else if (soundType === 'growl_crow') {
                variationCount = 4; // growl_crow.mp3, growl_crow1.mp3, growl_crow2.mp3, growl_crow3.mp3
            } else if (soundType === 'growl_tern') {
                variationCount = 4; // growl_tern.mp3, growl_tern1.mp3, growl_tern2.mp3, growl_tern3.mp3
            } else if (soundType === 'animal_burrow') {
                variationCount = 1; // animal_burrow.mp3
            } else if (soundType === 'walking') {
                variationCount = 4; // walking.mp3, walking1.mp3, walking2.mp3, walking3.mp3
            } else if (soundType === 'swimming') {
                variationCount = 4; // swimming.mp3, swimming1.mp3, swimming2.mp3, swimming3.mp3
            } else if (soundType === 'foundation_wood_constructed') {
                variationCount = 1; // foundation_wood_constructed.mp3
            } else if (soundType === 'foundation_wood_upgraded') {
                variationCount = 1; // foundation_wood_upgraded.mp3
            } else if (soundType === 'foundation_stone_upgraded') {
                variationCount = 1; // foundation_stone_upgraded.mp3
            } else if (soundType === 'foundation_metal_upgraded') {
                variationCount = 1; // foundation_metal_upgraded.mp3
            } else if (soundType === 'twig_foundation_destroyed') {
                variationCount = 1; // twig_foundation_destroyed.mp3
            } else if (soundType === 'crow_stealing') {
                variationCount = 1; // crow_stealing.mp3
            } else if (soundType === 'cairn_unlock') {
                variationCount = 1; // cairn_unlock.mp3
            } else if (soundType === 'error_seaweed_above_water') {
                variationCount = 1; // error_seaweed_above_water.mp3
            } else if (soundType === 'stun') {
                variationCount = 1; // stun.mp3
            } else if (soundType === 'thunder') {
                variationCount = 4; // thunder.mp3, thunder1.mp3, thunder2.mp3, thunder3.mp3
            }
            
            const randomVariation = Math.floor(Math.random() * variationCount);
            if (randomVariation === 0) {
                filename = `${soundType}.mp3`;
            } else {
                filename = `${soundType}${randomVariation}.mp3`;
            }
        }

        // Alias: gut_fish reuses melee slash sound (cutting fish open)
        if (soundType === 'gut_fish') {
            filename = 'melee_hit_sharp.mp3';
        }
        
        // Check if this is an error sound (no pitch variation sounds) - prevent multiple from playing at once
        const isErrorSound = NO_PITCH_VARIATION_SOUNDS.has(soundType);
        if (isErrorSound) {
            // If an error sound is already playing, skip this one (don't interrupt)
            if (activeErrorSounds.size > 0) {
                // Clean up any ended sounds from the set first
                const soundsToRemove: HTMLAudioElement[] = [];
                activeErrorSounds.forEach(audio => {
                    if (audio.ended || audio.paused) {
                        soundsToRemove.push(audio);
                    }
                });
                soundsToRemove.forEach(audio => activeErrorSounds.delete(audio));
                
                // Check if any are actually still playing (not ended or paused)
                let hasActiveSound = false;
                activeErrorSounds.forEach(audio => {
                    if (!audio.paused && !audio.ended) {
                        hasActiveSound = true;
                    }
                });
                
                // If there are still active sounds playing, skip this new one
                if (hasActiveSound) {
                    return; // Don't play - another error sound is already playing
                }
            }
        }
        
        // Add random pitch variation (0.9 to 1.1 range for subtle local variation)
        // Skip pitch variation for sounds in the no-pitch-variation list
        const pitchVariation = NO_PITCH_VARIATION_SOUNDS.has(soundType) 
            ? 1.0  // No pitch variation - play at original pitch
            : 0.9 + Math.random() * SOUND_CONFIG.LOCAL_PITCH_VARIATION;
        
        // Add slight random volume variation (±5% for subtle variety)
        const volumeVariation = 0.95 + Math.random() * SOUND_CONFIG.LOCAL_VOLUME_VARIATION;
        const finalVolume = definition.volume * volume * SOUND_CONFIG.MASTER_VOLUME * volumeVariation;
        
        // Use Web Audio API for loud sounds (> 1.0), HTML Audio for normal sounds
        if (finalVolume > 1.0) {
            await playLoudSound(filename, finalVolume, pitchVariation);
        } else {
            // Use regular HTML Audio for normal volumes
            const audio = await getAudio(filename);
            if (!audio) {
                return; // Failed to load, skip playback
            }
            
            const audioClone = audio.cloneNode() as HTMLAudioElement;
            
            audioClone.playbackRate = pitchVariation;
            audioClone.volume = Math.max(0, finalVolume); // Only prevent negative
            audioClone.currentTime = 0;
            
            // Track and cleanup
            activeSounds.add(audioClone);
            
            // Track error sounds separately to prevent multiple from playing
            if (isErrorSound) {
                activeErrorSounds.add(audioClone);
            }
            
            const cleanup = () => {
                activeSounds.delete(audioClone);
                if (isErrorSound) {
                    activeErrorSounds.delete(audioClone);
                }
                audioClone.removeEventListener('ended', cleanup);
                audioClone.removeEventListener('error', cleanup);
            };
            
            audioClone.addEventListener('ended', cleanup, { once: true });
            audioClone.addEventListener('error', cleanup, { once: true });
            
            // Handle browser autoplay policies - play() can fail silently
            try {
                const playPromise = audioClone.play();
                if (playPromise !== undefined) {
                    await playPromise;
                }
            } catch (playError: any) {
                // Browser blocked autoplay - this is normal and expected
                // Don't log as error, just cleanup silently
                cleanup();
                // Only log if it's not an autoplay policy error
                if (playError.name !== 'NotAllowedError' && playError.name !== 'NotSupportedError') {
                    console.warn(`🔊 Playback error for ${soundType}:`, playError);
                }
            }
        }
        
    } catch (error) {
        console.warn(`🔊 Local sound error for ${soundType}:`, error);
    }
};

// Public API for playing sounds immediately (for local actions)
export const playImmediateSound = (soundType: SoundType, volume: number = 1): void => {
    playLocalSound(soundType, volume).catch(console.warn);
};

const SEAWEED_ABOVE_WATER_ERROR_DEBOUNCE_MS = 350;
let lastSeaweedAboveWaterErrorPlayAt = 0;

/**
 * Underwater harvest blocked (not snorkeling). Debounced.
 * Uses HTMLAudioElement directly so we bypass playLocalSound's isAnySovaAudioPlaying() gate
 * (SDK 2.x also does not expose reducer on* callbacks on connection.reducers — feedback must be client-driven).
 */
export function playSeaweedAboveWaterErrorFeedback(): void {
    const now = Date.now();
    if (now - lastSeaweedAboveWaterErrorPlayAt < SEAWEED_ABOVE_WATER_ERROR_DEBOUNCE_MS) return;
    lastSeaweedAboveWaterErrorPlayAt = now;
    const url = `${SOUND_CONFIG.SOUNDS_BASE_PATH}error_seaweed_above_water.mp3`;
    try {
        const audio = new Audio(url);
        audio.volume = 0.95;
        void audio.play().catch(() => {
            playImmediateSound('error_seaweed_above_water', 1.0);
        });
    } catch {
        playImmediateSound('error_seaweed_above_water', 1.0);
    }
}

/** If this resource is SeaweedBed and the player is not snorkeling, play the error clip (matches server rule). */
export function previewSeaweedHarvestBlockedIfNeeded(
    connection: {
        db?: { harvestable_resource?: { iter(): Iterable<{ id: bigint; plantType: unknown }> } };
    } | null | undefined,
    resourceId: bigint,
    isSnorkeling: boolean | null | undefined
): void {
    if (isSnorkeling === true) return;
    const tbl = connection?.db?.harvestable_resource;
    if (!tbl) return;
    try {
        for (const row of tbl.iter()) {
            if (row.id !== resourceId) continue;
            const pt = row.plantType;
            const tag =
                pt && typeof pt === 'object' && pt !== null && 'tag' in pt
                    ? String((pt as { tag: string }).tag)
                    : '';
            if (tag === 'SeaweedBed') {
                playSeaweedAboveWaterErrorFeedback();
            }
            return;
        }
    } catch {
        /* ignore */
    }
}

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

// Track sounds that are currently fading out to prevent double-cleanup
const fadingOutSounds = new Set<string>();

// Track viewport-capped sounds that are in the process of fading down (not full cleanup, just volume reduction)
// Maps objectId to { intervalId, targetVolume } - allows cancellation if volume rises again
const viewportCapFadingDown = new Map<string, { intervalId: ReturnType<typeof setInterval>, startTime: number }>();

// Fade-out durations for smooth audio transitions (ms)
const LOOPING_SOUND_FADE_OUT_DURATION = 800; // 800ms default fade-out
const AMBIENT_SOUND_FADE_OUT_DURATION = 2000; // 2 seconds for ambient sounds (campfire, lantern)
const BEE_DISPERSAL_FADE_OUT_DURATION = 4000; // 4 seconds for bees dispersing naturally
const VIEWPORT_CAP_FADE_DOWN_DURATION = 1500; // 1.5 seconds for viewport-capped sounds fading when walking away

// Ambient sounds that need longer fade-out for natural feel
const AMBIENT_LOOPING_SOUNDS: Set<string> = new Set([
    'campfire_looping.mp3',
    'lantern_looping.mp3',
]);

// Bee sounds need extra-long fade-out to simulate bees dispersing
const BEE_SOUNDS: Set<string> = new Set([
    'bees_buzzing.mp3',
]);

// Helper function to fade out and cleanup an audio element
// Uses a smooth exponential curve for natural-sounding fade-out
const fadeOutAndCleanupAudio = (audio: HTMLAudioElement, objectId: string, onComplete: () => void) => {
    // Determine fade duration based on sound type
    const strippedId = objectId.replace('viewport_cap_', '');
    const isBeeSound = BEE_SOUNDS.has(strippedId);
    const isAmbientSound = AMBIENT_LOOPING_SOUNDS.has(strippedId);
    
    // Bees get extra-long fade (dispersing), ambient gets medium fade, others get short fade
    const fadeOutTime = isBeeSound 
        ? BEE_DISPERSAL_FADE_OUT_DURATION 
        : (isAmbientSound ? AMBIENT_SOUND_FADE_OUT_DURATION : LOOPING_SOUND_FADE_OUT_DURATION);
    const fadeSteps = isBeeSound ? 120 : (isAmbientSound ? 60 : 30); // More steps for smoother bee fade
    const fadeInterval = fadeOutTime / fadeSteps;
    const initialVolume = audio.volume;
    
    console.log(`🐝 FADE-OUT: ${objectId} (bee: ${isBeeSound}, ambient: ${isAmbientSound}, duration: ${fadeOutTime}ms, volume: ${initialVolume.toFixed(3)}, paused: ${audio.paused})`);
    
    // If volume is already 0, just cleanup immediately (but still try to cleanup audio that's just paused)
    if (initialVolume <= 0) {
        console.log(`🐝 Audio already silent for ${objectId}, cleaning up immediately`);
        try {
            audio.pause();
            audio.src = '';
            audio.load();
        } catch (e) {
            // Cleanup errors are expected
        }
        onComplete();
        return;
    }
    
    // If audio is paused, try to resume it briefly for the fade-out effect to be heard
    if (audio.paused) {
        try {
            audio.play().catch(() => {}); // Try to resume for fade, ignore errors
        } catch (e) {
            // Ignore play errors
        }
    }
    
    // Mark as being cleaned up to prevent error handling
    (audio as any)._isBeingCleaned = true;
    
    let fadeStep = 0;
    const fadeOutInterval = setInterval(() => {
        fadeStep++;
        // Use exponential curve for more natural fade-out (sounds fade quickly at first, then slow down)
        // This mimics how we perceive sound volume changes
        const progress = fadeStep / fadeSteps;
        const exponentialFactor = 1 - Math.pow(1 - progress, 2); // Quadratic ease-out
        const newVolume = initialVolume * (1 - exponentialFactor);
        try {
            audio.volume = Math.max(0, newVolume);
        } catch (e) {
            // Volume setting failed, just continue
        }
        
        if (fadeStep >= fadeSteps) {
            clearInterval(fadeOutInterval);
            console.log(`🐝 FADE COMPLETE: ${objectId} - fade finished after ${fadeOutTime}ms`);
            try {
                audio.pause();
                audio.currentTime = 0;
                audio.src = '';
                audio.load();
            } catch (e) {
                // Cleanup errors are expected
            }
            onComplete();
        }
    }, fadeInterval);
};

// Enhanced cleanup function for looping sounds with smooth fade-out
const cleanupLoopingSound = (objectId: string, reason: string = "cleanup") => {
    // Skip if already fading out
    if (fadingOutSounds.has(objectId)) {
        // console.log(`🐝 CLEANUP: ${objectId} - already fading, skipping (reason: ${reason})`);
        return;
    }
    
    // Cancel any in-progress fade-down interval before starting full cleanup
    const fadeDownInfo = viewportCapFadingDown.get(objectId);
    if (fadeDownInfo) {
        clearInterval(fadeDownInfo.intervalId);
        viewportCapFadingDown.delete(objectId);
    }
    
    // console.log(`🐝 CLEANUP: ${objectId} - starting cleanup (reason: ${reason})`);
    
    // Clean up traditional looping sound
    const audio = activeLoopingSounds.get(objectId);
    if (audio) {
        // Remove from active sounds immediately to prevent re-processing
        activeLoopingSounds.delete(objectId);
        fadingOutSounds.add(objectId);
        
        try {
            // Remove event listeners FIRST to prevent error events during cleanup
            audio.removeEventListener('ended', () => {});
            audio.removeEventListener('error', () => {});
            
            // Fade out smoothly, then cleanup
            fadeOutAndCleanupAudio(audio, objectId, () => {
                fadingOutSounds.delete(objectId);
                // console.log(`🔊 Cleaned up looping sound for object ${objectId} (${reason})`);
            });
        } catch (e) {
            // Only log unexpected errors, not cleanup-related ones
            if (e instanceof Error && !e.message.includes('load') && !e.message.includes('src')) {
                console.warn(`🔊 Unexpected error during audio cleanup for ${objectId}:`, e);
            }
            fadingOutSounds.delete(objectId);
        }
    }
    
    // Clean up seamless looping sound
    const seamlessSound = activeSeamlessLoopingSounds.get(objectId);
    if (seamlessSound) {
        // Remove from active sounds immediately to prevent re-processing
        activeSeamlessLoopingSounds.delete(objectId);
        
        // Add to fading set if not already (might be set from traditional cleanup above)
        if (!fadingOutSounds.has(objectId)) {
            fadingOutSounds.add(objectId);
        }
        
        try {
            // Fade out both primary and secondary audio instances
            let cleanedCount = 0;
            const totalToClean = 2;
            
            [seamlessSound.primary, seamlessSound.secondary].forEach(audioInstance => {
                fadeOutAndCleanupAudio(audioInstance, objectId, () => {
                    cleanedCount++;
                    if (cleanedCount >= totalToClean) {
                        fadingOutSounds.delete(objectId);
                        // console.log(`🔊 Cleaned up seamless looping sound for object ${objectId} (${reason})`);
                    }
                });
            });
        } catch (e) {
            if (e instanceof Error && !e.message.includes('load') && !e.message.includes('src')) {
                console.warn(`🔊 Unexpected error during seamless audio cleanup for ${objectId}:`, e);
            }
            fadingOutSounds.delete(objectId);
        }
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
        
        if (!audio1 || !audio2) {
            console.warn(`🎵 Failed to load audio for seamless looping: ${filename}`);
            return false;
        }
        
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
        try {
            const playPromise = primary.play();
            if (playPromise !== undefined) {
                await playPromise;
            }
        } catch (playError: any) {
            // Browser blocked autoplay - handle gracefully
            if (playError.name !== 'NotAllowedError' && playError.name !== 'NotSupportedError' && !isTransientPlaybackAbort(playError)) {
                console.warn(`🎵 Failed to start seamless sound for object ${objectId}:`, playError);
            }
            throw playError; // Re-throw to be caught by outer try-catch
        }
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
                // Handle browser autoplay policies
                nextAudio.play()
                    .then(() => {
                        // Schedule the fade-out of the current audio and swap ONLY after next audio starts.
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
                    })
                    .catch((playError: any) => {
                        if (playError.name !== 'NotAllowedError' && playError.name !== 'NotSupportedError' && !isTransientPlaybackAbort(playError)) {
                            console.warn(`🎵 Failed to play next seamless audio for object ${objectId}:`, playError);
                        }
                        // Keep current audio active and retry soon.
                        seamlessSound.nextSwapTime = Date.now() + 1200;
                    });
                
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
        'bees_buzzing.mp3', // Beehive buzzing needs seamless crossfade
        'rain_normal.mp3',
        'rain_heavy_storm.mp3',
        'soup_boiling.mp3' // Soup boiling needs seamless crossfade to prevent gaps
    ];
    return seamlessFilenames.includes(filename);
};

// 🎯 VIEWPORT CAP: Certain looping sounds should only have ONE instance playing in the entire viewport
// regardless of how many objects are making that sound. This prevents audio overload.
// The single instance uses the closest object for volume calculation.
const VIEWPORT_CAPPED_SOUNDS: Set<string> = new Set([
    'bees_buzzing.mp3',      // Beehive buzzing - one instance for all beehives in viewport
    'campfire_looping.mp3',  // Campfire crackling - one instance for all campfires in viewport
    'lantern_looping.mp3',   // Lantern flickering - one instance for all lanterns in viewport
]);

// Track which viewport-capped sounds are currently playing (by filename)
const activeViewportCappedSounds = new Map<string, {
    objectId: string;
    audioInstance: HTMLAudioElement | null;
    seamlessSound: boolean;
}>();

/** Duplicate weapon_swing rows or processed-set trimming can replay the same whoosh; cap per player. */
const WEAPON_SWING_SPATIAL_DEBOUNCE_MS = 85;
const lastWeaponSwingSpatialPlayAtMs = new Map<string, number>();

// Main sound system hook
const SOVA_SOUND_PATTERN = /sova|error_tilling|error_mobile|error_memory|tutorial_memory/;

export const useSoundSystem = ({ 
    soundEvents,
    continuousSounds,
    localPlayerPosition, 
    localPlayerIdentity,
    masterVolume = 0.8,
    environmentalVolume = 0.7,
    chunkWeather,
    currentSeason
}: SoundSystemProps) => {
    const processedSoundEventsRef = useRef<Set<string>>(new Set());
    const isInitializedRef = useRef(false);
    const lastSoundProcessTimeRef = useRef<number>(0);
    const SOUND_PROCESSING_DEBOUNCE_MS = 500; // Minimum 500ms between sound processing
    const PROCESSED_EVENTS_MAX_SIZE = 2000; // Cap to prevent unbounded memory growth
    const pendingSoundCreationRef = useRef<Set<string>>(new Set()); // Track sounds being created
    
    // Helper function to check if player's current chunk has rain
    const isPlayerInRainyChunk = useCallback((): boolean => {
        if (!localPlayerPosition || !chunkWeather) return false;
        
        const chunkIndex = calculateChunkIndex(localPlayerPosition.x, localPlayerPosition.y);
        const chunkWeatherData = chunkWeather.get(chunkIndex.toString());
        
        if (!chunkWeatherData) return false;
        
        const weatherTag = chunkWeatherData.currentWeather?.tag;
        return weatherTag === 'LightRain' || weatherTag === 'ModerateRain' || 
               weatherTag === 'HeavyRain' || weatherTag === 'HeavyStorm';
    }, [localPlayerPosition, chunkWeather]);
    
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
    
    // Track previous soundEvents to only process NEW events
    const previousSoundEventsRef = useRef<Map<string, any>>(new Map());
    const PREVIOUS_EVENTS_MAX_SIZE = 2000; // Cap to prevent unbounded memory growth
    
    // Process server sound events (for other players' actions)
    useEffect(() => {
        if (!localPlayerPosition || !localPlayerIdentity || !soundEvents) return;
        
        // Only process NEW events that weren't in the previous map
        const previousEvents = previousSoundEventsRef.current;
        const newEvents: Array<[string, any]> = [];
        
        soundEvents.forEach((soundEvent, eventId) => {
            // Skip if already processed OR if it was in the previous map (already handled)
            if (processedSoundEventsRef.current.has(eventId) || previousEvents.has(eventId)) {
                return;
            }
            newEvents.push([eventId, soundEvent]);
        });
        
        // Process only NEW events
        newEvents.forEach(([eventId, soundEvent]) => {
            // Mark as processed immediately (before async operations)
            processedSoundEventsRef.current.add(eventId);
            
            // Skip our own sounds if they use PREDICT_CONFIRM strategy
            // Extract sound type from filename (fallback) or use soundType field if available
            let soundType: SoundType;
            if (soundEvent.soundType && typeof soundEvent.soundType === 'object' && 'tag' in soundEvent.soundType) {
                // Convert enum tag to filename format (e.g., "ErrorResources" -> "error_resources")
                const tag = (soundEvent.soundType as any).tag;
                soundType = tag.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '') as SoundType;
            } else {
                // Fallback: extract from filename
                const fromFilename = soundEvent.filename.replace(/\d*\.mp3$/, '');
                // Aliases: server filenames -> client sound types
                if (fromFilename === 'sova_tutorial_memory_shard') soundType = 'sova_memory_shard_tutorial' as SoundType;
                else if (fromFilename === 'sova_tutorial_memory_shard_200') soundType = 'sova_memory_shard_200_tutorial' as SoundType;
                else soundType = fromFilename as SoundType;
            }
            soundType = normalizeSoundTypeKeyFromEnumTag(soundType as string);
            const definition = SOUND_DEFINITIONS[soundType];

            const triggerHexLower = soundEvent.triggeredBy?.toHexString?.()?.toLowerCase?.();
            const localHexLower = localPlayerIdentity?.toHexString?.()?.toLowerCase?.();
            if (
                LOCAL_PREDICT_SPATIAL_SKIP_SOUNDS.has(soundType) &&
                triggerHexLower &&
                localHexLower &&
                triggerHexLower === localHexLower
            ) {
                return;
            }
            if (soundType === 'weapon_swing' && triggerHexLower) {
                const pr = performance.now();
                const prev = lastWeaponSwingSpatialPlayAtMs.get(triggerHexLower) ?? 0;
                if (pr - prev < WEAPON_SWING_SPATIAL_DEBOUNCE_MS) {
                    return;
                }
                lastWeaponSwingSpatialPlayAtMs.set(triggerHexLower, pr);
            }
            
            // Debug logging for error_resources sounds
            if (soundType === 'error_resources' || (soundEvent.soundType && typeof soundEvent.soundType === 'object' && (soundEvent.soundType as any).tag === 'ErrorResources')) {
                console.log('[SoundSystem] Processing error_resources sound:', { 
                    filename: soundEvent.filename, 
                    soundType: soundEvent.soundType,
                    extractedType: soundType,
                    definition: definition,
                    posX: soundEvent.posX,
                    posY: soundEvent.posY
                });
            }
            
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
            
            // Special handling for SOVA memory shard tutorial - emit event for useSovaTutorials to handle
            // useSovaTutorials will play the audio with the SovaSoundBox waveform visualization
            if (soundType === 'sova_memory_shard_tutorial') {
                // Only trigger for the local player who picked up the shard
                if (localPlayerIdentity && soundEvent.triggeredBy.toHexString() === localPlayerIdentity.toHexString()) {
                    console.log(`🔮 [SOVA Tutorial] Memory shard tutorial triggered for local player`);
                    
                    // CRITICAL: Defer dispatch so useSovaTutorials' listener is guaranteed to be attached.
                    // React effects run in declaration order; without deferral, we may fire before the listener exists.
                    queueMicrotask(() => {
                        window.dispatchEvent(new CustomEvent('sova-memory-shard-tutorial'));
                    });
                }
                // Don't play through sound system - useSovaTutorials handles this with SovaSoundBox
                return;
            }

            // Special handling for SOVA 200 memory shards tutorial - emit event for useSovaTutorials
            if (soundType === 'sova_memory_shard_200_tutorial') {
                if (localPlayerIdentity && soundEvent.triggeredBy.toHexString() === localPlayerIdentity.toHexString()) {
                    console.log(`🔮 [SOVA Tutorial] 200 memory shards tutorial triggered for local player`);
                    queueMicrotask(() => {
                        window.dispatchEvent(new CustomEvent('sova-memory-shard-200-tutorial'));
                    });
                }
                return;
            }

            // Seaweed-above-water: IMMEDIATE in SOUND_DEFINITIONS; skip spatial (SOVA gate + falloff).
            // Also handled from reducer for reliability; debounced helper avoids double play.
            const isSeaweedAboveWaterError =
                soundType === 'error_seaweed_above_water' ||
                soundEvent.filename.replace(/\d*\.mp3$/i, '') === 'error_seaweed_above_water';
            if (isSeaweedAboveWaterError) {
                const th = soundEvent.triggeredBy?.toHexString?.()?.toLowerCase?.();
                const lh = localPlayerIdentity?.toHexString?.()?.toLowerCase?.();
                if (th && lh && th === lh) {
                    playSeaweedAboveWaterErrorFeedback();
                }
                return;
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
                        if (!audio) {
                            return; // Failed to load, skip playback
                        }
                        
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
                            
                            // Handle browser autoplay policies
                            try {
                                const playPromise = audioClone.play();
                                if (playPromise !== undefined) {
                                    await playPromise;
                                }
                                console.log(`🔊 Started bandaging sound for player ${playerKey} (non-looping, will end naturally)`);
                            } catch (playError: any) {
                                // Browser blocked autoplay - cleanup silently
                                cleanup();
                                if (playError.name !== 'NotAllowedError' && playError.name !== 'NotSupportedError') {
                                    console.warn(`🔊 Failed to play bandaging sound for player ${playerKey}:`, playError);
                                }
                            }
                        }
                    } catch (error) {
                        console.warn(`🔊 Failed to play bandaging sound for player ${playerKey}:`, error);
                    }
                };
                
                playBandagingSound();
                return; // Don't use the regular spatial audio for bandaging
            }
            
            // All remaining sounds are SERVER_ONLY, so play all server sounds
            // Server handles rate limiting for growl sounds via cooldown logic
            
            // Play spatial sound for other players or server-only sounds
            // Use pitch multiplier from server (defaults to 1.0 if not present for backward compatibility)
            const pitchMultiplier = (soundEvent as any).pitchMultiplier ?? 1.0;
            playSpatialAudio(
                soundEvent.filename,
                soundEvent.posX,
                soundEvent.posY,
                localPlayerPosition.x,
                localPlayerPosition.y,
                soundEvent.volume,
                soundEvent.maxDistance,
                masterVolume,
                pitchMultiplier
            ).catch(err => {
                console.warn(`🔊 Failed to play server sound: ${soundEvent.filename}`, err);
            });
        });
        
        // Update previous events ref AFTER processing (so we don't lose events if processing fails)
        // Cap size to prevent unbounded memory growth
        if (soundEvents.size > PREVIOUS_EVENTS_MAX_SIZE) {
            const entries = Array.from(soundEvents.entries());
            previousSoundEventsRef.current = new Map(entries.slice(-PREVIOUS_EVENTS_MAX_SIZE));
        } else {
            previousSoundEventsRef.current = new Map(soundEvents);
        }
        
        // Drop processed IDs for rows removed from the table; then cap size. Trimming arbitrary IDs while
        // rows still exist caused the same event to be treated as "new" and play again (double whoosh).
        for (const id of Array.from(processedSoundEventsRef.current)) {
            if (!soundEvents.has(id)) {
                processedSoundEventsRef.current.delete(id);
            }
        }
        if (processedSoundEventsRef.current.size > PROCESSED_EVENTS_MAX_SIZE) {
            const eventsArray = Array.from(processedSoundEventsRef.current);
            const drop = eventsArray.length - PROCESSED_EVENTS_MAX_SIZE;
            for (let i = 0; i < drop; i++) {
                processedSoundEventsRef.current.delete(eventsArray[i]);
            }
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
        
        // 🎯 VIEWPORT CAP: Group viewport-capped sounds and find closest for each type
        const viewportCappedGroups = new Map<string, { 
            closestObjectId: string;
            closestDistance: number;
            closestSound: ContinuousSound;
            allObjectIds: Set<string>;
        }>();

        // First pass: Handle inactive sounds, build active sounds set, and group viewport-capped sounds
        continuousSounds.forEach((continuousSound, soundId) => {
            const objectId = continuousSound.objectId.toString();
            
            // console.log(`🔊 Processing sound for object ${objectId}: isActive=${continuousSound.isActive}, filename=${continuousSound.filename}, pos=(${continuousSound.posX}, ${continuousSound.posY}), volume=${continuousSound.volume}, maxDistance=${continuousSound.maxDistance}`);
            
            if (continuousSound.isActive) {
                // Check if this is a viewport-capped sound
                if (VIEWPORT_CAPPED_SOUNDS.has(continuousSound.filename)) {
                    // Group by filename for viewport-capped sounds
                    const filename = continuousSound.filename;
                    const distance = calculateDistance(
                        continuousSound.posX,
                        continuousSound.posY,
                        localPlayerPosition.x,
                        localPlayerPosition.y
                    );
                    
                    if (!viewportCappedGroups.has(filename)) {
                        viewportCappedGroups.set(filename, {
                            closestObjectId: objectId,
                            closestDistance: distance,
                            closestSound: continuousSound,
                            allObjectIds: new Set([objectId]),
                        });
                    } else {
                        const group = viewportCappedGroups.get(filename)!;
                        group.allObjectIds.add(objectId);
                        // Track the closest object for volume calculation
                        if (distance < group.closestDistance) {
                            group.closestObjectId = objectId;
                            group.closestDistance = distance;
                            group.closestSound = continuousSound;
                        }
                    }
                    // Don't add individual object IDs to currentActiveSounds for viewport-capped sounds
                    // We'll add a synthetic "master" ID later
                } else {
                    currentActiveSounds.add(objectId);
                }
            } else {
                // Handle inactive sounds - stop them immediately with proper cleanup
                // For viewport-capped sounds, we need special handling
                if (VIEWPORT_CAPPED_SOUNDS.has(continuousSound.filename)) {
                    // Don't cleanup individual object IDs for viewport-capped sounds
                    // They share a master sound instance
                } else {
                    cleanupLoopingSound(objectId, "marked inactive");
                }
            }
        });
        
        // 🎯 Process viewport-capped sound groups - only ONE sound instance per type
        viewportCappedGroups.forEach((group, filename) => {
            // Use a synthetic "master" ID for this sound type (based on filename)
            const masterObjectId = `viewport_cap_${filename}`;
            currentActiveSounds.add(masterObjectId);
            
            // Track which viewport-capped sounds are currently active
            const existingCap = activeViewportCappedSounds.get(filename);
            if (!existingCap) {
                activeViewportCappedSounds.set(filename, {
                    objectId: masterObjectId,
                    audioInstance: null,
                    seamlessSound: shouldUseSeamlessLooping(filename),
                });
            }
        });
        
        // Clean up viewport-capped sounds that no longer have any active objects
        activeViewportCappedSounds.forEach((cap, filename) => {
            if (!viewportCappedGroups.has(filename)) {
                // No more active objects for this sound type - clean up with fade
                console.log(`🐝 VIEWPORT-CAP CLEANUP: ${filename} - no active objects, triggering fade-out`);
                cleanupLoopingSound(cap.objectId, "no active viewport-capped objects");
                activeViewportCappedSounds.delete(filename);
            }
        });

        // 🎯 Second pass: Process viewport-capped sound groups FIRST (before individual sounds)
        viewportCappedGroups.forEach((group, filename) => {
            const masterObjectId = `viewport_cap_${filename}`;
            const closestSound = group.closestSound;
            
            // Check if we're already playing this viewport-capped sound OR if it's being created
            const existingSound = activeLoopingSounds.get(masterObjectId);
            const existingSeamlessSound = activeSeamlessLoopingSounds.get(masterObjectId);
            const isBeingCreated = pendingSoundCreationRef.current.has(masterObjectId);
            
            if (isBeingCreated) {
                return;
            }
            
            // Calculate volume based on closest object
            // Use smooth falloff for looping sounds to avoid abrupt cutoff
            const distance = group.closestDistance;
            const volume = calculateSmoothSpatialVolume(
                distance,
                closestSound.volume,
                closestSound.maxDistance
            ) * masterVolume;
            
            if (existingSeamlessSound) {
                // Update existing seamless sound volume with smooth fade handling
                const isFadingDown = viewportCapFadingDown.has(masterObjectId);
                
                if (volume <= 0.01) {
                    // Start fade-down if not already fading
                    if (!isFadingDown && !fadingOutSounds.has(masterObjectId)) {
                        const activeAudio = existingSeamlessSound.isPrimaryActive ? 
                                           existingSeamlessSound.primary : existingSeamlessSound.secondary;
                        const initialVolume = activeAudio.volume;
                        
                        if (initialVolume > 0.01) {
                            // Start gradual fade-down
                            const fadeSteps = 45; // Smooth fade
                            const fadeInterval = VIEWPORT_CAP_FADE_DOWN_DURATION / fadeSteps;
                            let fadeStep = 0;
                            
                            const intervalId = setInterval(() => {
                                fadeStep++;
                                const progress = fadeStep / fadeSteps;
                                const exponentialFactor = 1 - Math.pow(1 - progress, 2);
                                const newVolume = initialVolume * (1 - exponentialFactor);
                                
                                try {
                                    existingSeamlessSound.primary.volume = Math.max(0, newVolume);
                                    existingSeamlessSound.secondary.volume = Math.max(0, newVolume);
                                    existingSeamlessSound.volume = newVolume;
                                } catch (e) { /* ignore */ }
                                
                                if (fadeStep >= fadeSteps) {
                                    clearInterval(intervalId);
                                    viewportCapFadingDown.delete(masterObjectId);
                                    // Don't pause - just leave at 0 volume, allows smooth resume
                                }
                            }, fadeInterval);
                            
                            viewportCapFadingDown.set(masterObjectId, { intervalId, startTime: Date.now() });
                        }
                    }
                } else {
                    // Volume is audible - cancel any fade-down in progress
                    if (isFadingDown) {
                        const fadeInfo = viewportCapFadingDown.get(masterObjectId);
                        if (fadeInfo) {
                            clearInterval(fadeInfo.intervalId);
                            viewportCapFadingDown.delete(masterObjectId);
                        }
                    }
                    
                    // Update volume directly
                    existingSeamlessSound.volume = volume;
                    existingSeamlessSound.primary.volume = Math.min(1.0, volume);
                    existingSeamlessSound.secondary.volume = Math.min(1.0, volume);
                    
                    // Resume if paused (only if not fading out for cleanup)
                    if (!fadingOutSounds.has(masterObjectId)) {
                        const activeAudio = existingSeamlessSound.isPrimaryActive ? 
                                           existingSeamlessSound.primary : existingSeamlessSound.secondary;
                        if (activeAudio.paused) {
                            activeAudio.play().catch(err => {
                                if (!isTransientPlaybackAbort(err)) {
                                    console.warn(`🎯 Failed to resume viewport-capped seamless sound ${filename}:`, err);
                                }
                            });
                        }
                    }
                }
                return;
            }
            
            if (existingSound) {
                // Update existing traditional looping sound volume with smooth fade handling
                const isFadingDown = viewportCapFadingDown.has(masterObjectId);
                
                if (volume <= 0.01) {
                    // Start fade-down if not already fading
                    if (!isFadingDown && !fadingOutSounds.has(masterObjectId)) {
                        const initialVolume = existingSound.volume;
                        
                        if (initialVolume > 0.01) {
                            const fadeSteps = 45;
                            const fadeInterval = VIEWPORT_CAP_FADE_DOWN_DURATION / fadeSteps;
                            let fadeStep = 0;
                            
                            const intervalId = setInterval(() => {
                                fadeStep++;
                                const progress = fadeStep / fadeSteps;
                                const exponentialFactor = 1 - Math.pow(1 - progress, 2);
                                const newVolume = initialVolume * (1 - exponentialFactor);
                                
                                try {
                                    existingSound.volume = Math.max(0, newVolume);
                                } catch (e) { /* ignore */ }
                                
                                if (fadeStep >= fadeSteps) {
                                    clearInterval(intervalId);
                                    viewportCapFadingDown.delete(masterObjectId);
                                }
                            }, fadeInterval);
                            
                            viewportCapFadingDown.set(masterObjectId, { intervalId, startTime: Date.now() });
                        }
                    }
                } else {
                    // Volume is audible - cancel any fade-down in progress
                    if (isFadingDown) {
                        const fadeInfo = viewportCapFadingDown.get(masterObjectId);
                        if (fadeInfo) {
                            clearInterval(fadeInfo.intervalId);
                            viewportCapFadingDown.delete(masterObjectId);
                        }
                    }
                    
                    existingSound.volume = Math.min(1.0, volume);
                    
                    if (!fadingOutSounds.has(masterObjectId) && existingSound.paused) {
                        existingSound.play().catch(err => {
                            if (!isTransientPlaybackAbort(err)) {
                                console.warn(`🎯 Failed to resume viewport-capped sound ${filename}:`, err);
                            }
                        });
                    }
                }
                return;
            }
            
            // Need to start a new viewport-capped sound
            if (volume <= 0.01) return; // Too far from all objects
            
            pendingSoundCreationRef.current.add(masterObjectId);
            
            const startViewportCappedSound = async () => {
                try {
                    if (activeLoopingSounds.has(masterObjectId) || activeSeamlessLoopingSounds.has(masterObjectId)) {
                        pendingSoundCreationRef.current.delete(masterObjectId);
                        return;
                    }
                    
                    const useSeamless = shouldUseSeamlessLooping(filename);
                    
                    if (useSeamless) {
                        const pitchVariation = 0.95 + Math.random() * 0.1;
                        const success = await createSeamlessLoopingSound(masterObjectId, filename, volume, pitchVariation);
                        if (success) {
                            console.log(`🎯 Started viewport-capped seamless sound: ${filename} (${group.allObjectIds.size} objects in range)`);
                        }
                    } else {
                        const audio = await getAudio(filename);
                        if (!audio) {
                            pendingSoundCreationRef.current.delete(masterObjectId);
                            return;
                        }
                        
                        const audioClone = audio.cloneNode() as HTMLAudioElement;
                        audioClone.loop = true;
                        audioClone.volume = Math.min(1.0, Math.max(0.0, volume));
                        audioClone.currentTime = 0;
                        audioClone.playbackRate = 0.9 + Math.random() * 0.2;
                        
                        activeLoopingSounds.set(masterObjectId, audioClone);
                        
                        try {
                            await audioClone.play();
                            console.log(`🎯 Started viewport-capped sound: ${filename} (${group.allObjectIds.size} objects in range)`);
                        } catch (playError: any) {
                            activeLoopingSounds.delete(masterObjectId);
                            if (playError.name !== 'NotAllowedError' && playError.name !== 'NotSupportedError' && !isTransientPlaybackAbort(playError)) {
                                console.warn(`🎯 Failed to start viewport-capped sound ${filename}:`, playError);
                            }
                        }
                    }
                    
                    pendingSoundCreationRef.current.delete(masterObjectId);
                } catch (error) {
                    console.warn(`🎯 Failed to start viewport-capped sound ${filename}:`, error);
                    pendingSoundCreationRef.current.delete(masterObjectId);
                }
            };
            
            startViewportCappedSound();
        });

        // Third pass: Process regular active sounds (skip viewport-capped sounds)
        continuousSounds.forEach((continuousSound, soundId) => {
            const objectId = continuousSound.objectId.toString();
            
            // Skip inactive sounds - already handled above
            if (!continuousSound.isActive) {
                return;
            }
            
            // 🎯 Skip viewport-capped sounds - they're handled in the viewport-capped pass above
            if (VIEWPORT_CAPPED_SOUNDS.has(continuousSound.filename)) {
                return;
            }
            
            // 🌧️ RAIN SOUND FILTERING: Skip rain sounds in winter (snow is silent) or if player is NOT in a rainy chunk
            const isRainSound = continuousSound.filename.includes('rain');
            if (isRainSound) {
                // ❄️ In winter, precipitation is snow which doesn't make rain sounds
                const isWinter = currentSeason?.tag === 'Winter';
                if (isWinter) {
                    // Winter - stop any existing rain sound (snow is silent)
                    cleanupLoopingSound(objectId, "winter - snow is silent");
                    return;
                }
                
                const playerInRain = isPlayerInRainyChunk();
                if (!playerInRain) {
                    // Player is in a clear zone - stop any existing rain sound and skip processing
                    cleanupLoopingSound(objectId, "player not in rainy chunk");
                    return;
                }
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
                // Use smooth falloff for gradual fade-out
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
        
                const volume = calculateSmoothSpatialVolume(
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
                            if (!isTransientPlaybackAbort(err)) {
                                console.warn(`🎵 Failed to resume seamless sound for object ${objectId}:`, err);
                            }
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
                            if (!isTransientPlaybackAbort(err)) {
                                console.warn(`🔊 Failed to resume global sound for object ${objectId}:`, err);
                            }
                        });
                        // console.log(`🔊 Resumed global ${isEnvironmental ? 'environmental' : 'regular'} sound for object ${objectId} (maxDistance: ${continuousSound.maxDistance})`);
                    }
                    return; // Done processing this global sound
                }
                
                // Update volume based on distance for existing sound
                // Use smooth falloff for gradual fade-out
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
                
                const volume = calculateSmoothSpatialVolume(
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
                            if (!isTransientPlaybackAbort(err)) {
                                console.warn(`🔊 Failed to resume looping sound for object ${objectId}:`, err);
                            }
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
                        
                        // Use smooth falloff for gradual fade-out on looping sounds
                        volume = calculateSmoothSpatialVolume(
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
                        if (!audio) {
                            // Failed to load, skip this sound
                            pendingSoundCreationRef.current.delete(objectId);
                            return;
                        }
                        
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
                        
                        // Start playing - handle browser autoplay policies
                        try {
                            const playPromise = audioClone.play();
                            if (playPromise !== undefined) {
                                await playPromise;
                            }
                            const soundTypeEmoji = continuousSound.filename.includes('campfire') ? '🔥' : 
                                                  continuousSound.filename.includes('lantern') ? '🏮' : '🔊';
                            console.log(`${soundTypeEmoji} Successfully started traditional looping sound: ${continuousSound.filename} for object ${objectId} at volume ${volume.toFixed(3)}`);
                        } catch (playError: any) {
                            // Browser blocked autoplay - cleanup and remove from map
                            activeLoopingSounds.delete(objectId);
                            if (playError.name !== 'NotAllowedError' && playError.name !== 'NotSupportedError' && !isTransientPlaybackAbort(playError)) {
                                console.warn(`🔊 Failed to start looping sound for object ${objectId}:`, playError);
                            }
                        }
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

        // Fourth pass: Stop sounds for objects that are no longer active
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

    }, [continuousSounds, localPlayerPosition, localPlayerIdentity, masterVolume, environmentalVolume, isPlayerInRainyChunk, chunkWeather, currentSeason]);
    
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
