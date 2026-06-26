import { TimeOfDay, WeatherType, ActiveConsumableEffect, Season } from '../../generated/types'; // Import actual types
import { calculateChunkIndex } from '../../utils/chunkUtils'; // Import chunk calculation helper

/**
 * ⚠️ WARNING: This ambient sound system is NOW INTEGRATED into the game!
 * 
 * Features:
 * 1. Uses seamless looping with overlapping audio instances (like main sound system)
 * 2. Integrated into GameCanvasRuntimeHost with actual WorldState data
 * 3. Controlled by environmentalVolume in GameSettingsMenu
 * 4. Professional audio caching and performance optimization
 */

export interface AmbientSoundProps {
    masterVolume?: number;
    environmentalVolume?: number;
    timeOfDay?: TimeOfDay; // Use actual server TimeOfDay type
    weatherCondition?: WeatherType; // Use actual server WeatherType (deprecated - use chunkWeather instead)
    chunkWeather?: Map<string, any>; // Chunk-based weather data
    localPlayer?: any; // Player data for position
    activeConsumableEffects?: Map<string, ActiveConsumableEffect>; // For detecting Entrainment effect
    localPlayerId?: string; // For detecting Entrainment effect
    isUnderwater?: boolean; // Whether the player is snorkeling/underwater - affects audio filtering
    currentSeason?: Season; // Current game season - affects ambient sounds (no crickets in winter)
    isIndoors?: boolean; // Whether player is inside a building - muffles outdoor sounds
    distanceToShore?: number; // Distance in pixels to nearest shore/water - fades ocean sounds
    distanceToMapEdge?: number; // Distance in pixels to nearest map boundary - for deep ocean (open water, no waves)
    wildAnimals?: Map<string, any>; // Wild animals for bee buzzing proximity sound
}

// Ambient sound definitions for Aleutian island atmosphere
const AMBIENT_SOUND_DEFINITIONS = {
    // === CONTINUOUS/LOOPING AMBIENCE ===
    wind_light: { 
        type: 'continuous', 
        filename: 'ambient_wind_light.mp3', 
        baseVolume: 0.08, // Further reduced for subtle clear-day breeze
        isLooping: true,
        useSeamlessLooping: true,
        description: 'Gentle constant wind through grass and trees'
    },
    wind_moderate: { 
        type: 'continuous', 
        filename: 'ambient_wind_moderate.mp3', 
        baseVolume: 0.18, // Reduced for light rain ambience
        isLooping: true,
        useSeamlessLooping: true,
        description: 'Moderate wind with occasional gusts'
    },
    wind_strong: { 
        type: 'continuous', 
        filename: 'ambient_wind_strong.mp3', 
        baseVolume: 0.30, // Reduced for heavy storm ambience
        isLooping: true,
        useSeamlessLooping: true,
        description: 'Strong persistent wind for harsh weather'
    },
    ocean_ambience: { 
        type: 'continuous', 
        filename: 'ambient_ocean.mp3', 
        baseVolume: 0.25, // Loud when at shore, fades with distance
        isLooping: true,
        useSeamlessLooping: true,
        proximityBased: true, // Volume fades based on distance to shore
        maxProximityDistance: 800, // Pixels - beyond this, volume is 0
        minProximityDistance: 50, // Pixels - at this distance or closer, full volume
        description: 'Ocean waves and surf - louder near shore, fades inland'
    },
    deep_ocean_ambience: {
        type: 'continuous',
        filename: 'ambient_ocean2.mp3',
        baseVolume: 0.22, // Slightly quieter than shore waves - ambient open water
        isLooping: true,
        useSeamlessLooping: true,
        mapEdgeBased: true, // Volume fades based on distance to map boundary
        maxProximityDistance: 600, // Pixels - beyond this from edge, volume is 0
        minProximityDistance: 80, // Pixels - at edge or closer, full volume
        description: 'Deep ocean ambient - open water at map edge, no waves lapping'
    },
    nature_general: { 
        type: 'continuous', 
        filename: 'ambient_nature_general.mp3', 
        baseVolume: 0.08, // Reduced from 0.25 for very subtle ambience
        isLooping: true,
        useSeamlessLooping: true,
        description: 'General nature ambience - insects, rustling'
    },
    entrainment_ambient: {
        type: 'continuous',
        filename: 'sova_entrainment_ambient.mp3', // Note: stored in /sounds/ not /sounds/ambient/
        baseVolume: 0.3, // Distorted/glitchy background for Entrainment effect
        isLooping: true,
        useSeamlessLooping: true,
        description: 'Distorted ambient sound when player has Entrainment (max insanity)'
    },
    underwater_ambient: {
        type: 'continuous',
        filename: 'ambient_underwater.mp3',
        baseVolume: 0.4, // Nice and present for immersion
        isLooping: true,
        useSeamlessLooping: true,
        underwaterOnly: true, // Only plays when player is underwater
        description: 'Muffled underwater ambience with bubbles and deep water sounds'
    },
    night_crickets: {
        type: 'continuous',
        filename: 'ambient_night_crickets.mp3',
        baseVolume: 0.15, // Subtle nighttime ambience - not overpowering
        isLooping: true,
        useSeamlessLooping: true,
        nightOnly: true, // Only plays at night/midnight
        skipInWinter: true, // Crickets are dormant in winter - no sound
        description: 'Nighttime cricket and insect chorus'
    },
    dawn_chorus: {
        type: 'continuous',
        filename: 'ambient_dawn_chorus.mp3',
        baseVolume: 0.18, // Pleasant morning birds - not too loud
        isLooping: true,
        useSeamlessLooping: true,
        dawnOnly: true, // Only plays during dawn period
        description: 'Morning bird chorus at dawn - fades out when dawn ends'
    },
    bee_buzzing: {
        type: 'continuous',
        filename: 'bees_buzzing.mp3', // In /sounds/ not /sounds/ambient/
        baseVolume: 0.18, // Subtle ambient buzzing - similar to campfire crackling
        isLooping: true,
        useSeamlessLooping: true,
        beeProximityBased: true, // Special: volume based on distance to nearest bee
        maxProximityDistance: 350, // Can hear buzzing from 350px away
        minProximityDistance: 50, // Full volume within 50px of bee
        description: 'Bee buzzing - plays ONE loop for all nearby bees, louder when closer'
    },
    
    // === RANDOM/PERIODIC AMBIENCE ===
    seagull_cry: { 
        type: 'random', 
        filename: 'ambient_seagull_cry.mp3', 
        baseVolume: 0.15, // Slightly louder base since proximity will reduce it inland
        minInterval: 12000, // 12 seconds minimum (more frequent near shore)
        maxInterval: 40000, // 40 seconds maximum
        variations: 3, // seagull_cry1.mp3, seagull_cry2.mp3, etc.
        dayOnly: true, // Only play during day/dawn/dusk, not night
        proximityBased: true, // Volume based on distance to shore
        maxProximityDistance: 600, // Seagulls heard up to 600px from shore (closer than ocean)
        minProximityDistance: 50, // Full volume within 50px of shore
        description: 'Seagulls crying near the shore - louder at coast, silent inland'
    },
    wolf_howl: { 
        type: 'random', 
        filename: 'ambient_wolf_howl.mp3', 
        baseVolume: 0.09, // Halved from 0.18 for more distant feel
        minInterval: 60000, // 1 minute minimum
        maxInterval: 180000, // 3 minutes maximum
        variations: 3, // Fixed: 3 files available (wolf_howl.mp3, wolf_howl2.mp3, wolf_howl3.mp3)
        nightOnly: true, // Only play during night/dusk
        description: 'Distant wolf howls'
    },
    raven_caw: { 
        type: 'random', 
        filename: 'ambient_raven_caw.mp3', 
        baseVolume: 0.11, // Halved from 0.22 for more subtle ambient feel
        minInterval: 30000, // 30 seconds minimum
        maxInterval: 90000, // 1.5 minutes maximum
        variations: 3,
        dayOnly: true, // Only play during day/dawn/dusk, not night
        description: 'Ravens and crows cawing'
    },
    wind_gust: { 
        type: 'random', 
        filename: 'ambient_wind_gust.mp3', 
        baseVolume: 0.15, // Halved from 0.3 for gentler gusts
        minInterval: 20000, // 20 seconds minimum
        maxInterval: 60000, // 1 minute maximum
        variations: 2,
        description: 'Sudden wind gusts'
    },
    distant_thunder: { 
        type: 'random', 
        filename: 'ambient_distant_thunder.mp3', 
        baseVolume: 1.5, // Very loud and dramatic for heavy storm atmosphere (2x louder than before)
        minInterval: 8000, // 8 seconds minimum - frequent like wind gusts
        maxInterval: 25000, // 25 seconds maximum - constant storm activity
        variations: 3,
        stormOnly: true, // Only play during heavy storms
        description: 'Frequent thunder rumbles during heavy storms - like wind gusts but storm-specific'
    },
    structure_creak: { 
        type: 'random', 
        filename: 'ambient_structure_creak.mp3', 
        baseVolume: 0.1, // Halved from 0.2 for very subtle creaking
        minInterval: 45000, // 45 seconds minimum
        maxInterval: 120000, // 2 minutes maximum
        variations: 2,
        description: 'Old structures creaking in the wind'
    },
    owl_hoot: { 
        type: 'random', 
        filename: 'ambient_owl_hoot.mp3', 
        baseVolume: 0.09, // Halved from 0.18 for very distant night sounds
        minInterval: 90000, // 1.5 minutes minimum
        maxInterval: 240000, // 4 minutes maximum
        variations: 3, // Fixed: 3 files available (owl_hoot.mp3, owl_hoot2.mp3, owl_hoot3.mp3)
        nightOnly: true,
        description: 'Owls hooting at night'
    },
    grass_rustle: { 
        type: 'random', 
        filename: 'ambient_grass_rustle.mp3', 
        baseVolume: 0.06, // Halved from 0.12 for whisper-quiet rustling
        minInterval: 25000, // 25 seconds minimum
        maxInterval: 70000, // 70 seconds maximum
        variations: 2,
        description: 'Grass and vegetation rustling'
    },
    whale_song: { 
        type: 'random', 
        filename: 'ambient_whale_song.mp3', 
        baseVolume: 0.12, // Increased volume since they're more frequent now
        minInterval: 90000, // 1.5 minutes minimum - much more frequent!
        maxInterval: 180000, // 3 minutes maximum - regular whale activity
        variations: 3,
        description: 'Distant whale songs echoing across the Aleutian waters'
    }
} as const;

export type AmbientSoundType = keyof typeof AMBIENT_SOUND_DEFINITIONS;

// Ambient sound configuration
const AMBIENT_CONFIG = {
    SOUNDS_BASE_PATH: '/sounds/ambient/',
    PITCH_VARIATION: 0.15, // ±7.5% pitch variation for natural feel
    VOLUME_VARIATION: 0.1, // ±5% volume variation
    FADE_DURATION: 1500, // 1.5 second fade in/out for continuous sounds (reduced for faster transitions)
    MAX_CONCURRENT_RANDOM: 3, // Maximum random sounds playing at once
    OVERLAP_PERCENTAGE: 0.15, // 15% overlap for more reliable seamless looping (increased from 10%)
    // Underwater audio effect configuration
    UNDERWATER_VOLUME_MULTIPLIER: 0.15, // Surface sounds reduced to 15% when underwater
    UNDERWATER_LOWPASS_FREQUENCY: 400, // Hz - cuts high frequencies (water muffles sound)
    UNDERWATER_TRANSITION_DURATION: 300, // ms - fast transition when entering/exiting water
    // Indoor audio effect configuration (muffled outdoor sounds when inside buildings)
    INDOOR_VOLUME_MULTIPLIER: 0.35, // Outdoor sounds reduced to 35% when indoors (less extreme than underwater)
    INDOOR_LOWPASS_FREQUENCY: 800, // Hz - mild muffling (walls block high frequencies)
    INDOOR_TRANSITION_DURATION: 400, // ms - smooth transition when entering/exiting buildings
} as const;

// 🎵 SEAMLESS LOOPING SYSTEM - Based on useSoundSystem.ts logic
interface SeamlessLoopingSound {
    primary: HTMLAudioElement;
    secondary: HTMLAudioElement;
    isPrimaryActive: boolean;
    nextSwapTime: number;
    volume: number;
    pitchVariation: number;
}

// Audio cache for ambient sounds (based on useSoundSystem.ts)
class AmbientAudioCache {
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

    async loadAudio(filename: string): Promise<HTMLAudioElement> {
        // Check cache first
        let audio = this.get(filename);
        if (audio) {
            // Verify cached audio is still valid (has valid duration)
            if (audio.duration && audio.duration > 0 && !isNaN(audio.duration) && isFinite(audio.duration)) {
                // Create a new Audio element instead of cloning to ensure metadata loads properly
                // Cloned elements don't automatically have metadata loaded
                // Special handling for files stored in /sounds/ not /sounds/ambient/
                const isRootSoundsFile = filename.startsWith('sova_') || filename === 'bees_buzzing.mp3';
                const fullPath = isRootSoundsFile 
                    ? `/sounds/${filename}` 
                    : AMBIENT_CONFIG.SOUNDS_BASE_PATH + filename;
                const newAudio = new Audio(fullPath);
                newAudio.preload = 'metadata';
                newAudio.crossOrigin = 'anonymous';
                
                // Wait for metadata to load on the new element with a reasonable timeout
                await new Promise<void>((resolve, reject) => {
                    const loadTimeout = setTimeout(() => {
                        // If metadata doesn't load quickly, check if we can use the cached duration
                        // Sometimes browser cache means metadata loads instantly, sometimes it needs a moment
                        if (newAudio.readyState >= 1 && newAudio.duration && newAudio.duration > 0 && !isNaN(newAudio.duration) && isFinite(newAudio.duration)) {
                            resolve();
                        } else {
                            // Try one more time with a small delay
                            setTimeout(() => {
                                if (newAudio.duration && newAudio.duration > 0 && !isNaN(newAudio.duration) && isFinite(newAudio.duration)) {
                                    resolve();
                                } else {
                                    reject(new Error(`Metadata load timeout for cached ${filename} (readyState: ${newAudio.readyState}, duration: ${newAudio.duration})`));
                                }
                            }, 200);
                        }
                    }, 1500); // 1.5 second timeout for cached files
                    
                    const onLoadedMetadata = () => {
                        clearTimeout(loadTimeout);
                        if (newAudio.duration && newAudio.duration > 0 && !isNaN(newAudio.duration) && isFinite(newAudio.duration)) {
                            resolve();
                        } else {
                            // Even after loadedmetadata event, duration might not be set immediately
                            // Wait a tiny bit and check again
                            setTimeout(() => {
                                if (newAudio.duration && newAudio.duration > 0 && !isNaN(newAudio.duration) && isFinite(newAudio.duration)) {
                                    resolve();
                                } else {
                                    reject(new Error(`Invalid duration after loadedmetadata for cached ${filename} (duration: ${newAudio.duration})`));
                                }
                            }, 50);
                        }
                    };
                    
                    if (newAudio.readyState >= 1) {
                        // Metadata might already be loaded
                        if (newAudio.duration && newAudio.duration > 0 && !isNaN(newAudio.duration) && isFinite(newAudio.duration)) {
                            clearTimeout(loadTimeout);
                            resolve();
                        } else {
                            // Wait for the event
                            newAudio.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
                            newAudio.load();
                        }
                    } else {
                        newAudio.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
                        newAudio.addEventListener('error', () => {
                            clearTimeout(loadTimeout);
                            reject(new Error(`Error loading metadata for cached ${filename}`));
                        }, { once: true });
                        newAudio.load();
                    }
                });
                
                // Final verification before returning
                if (!newAudio.duration || isNaN(newAudio.duration) || !isFinite(newAudio.duration) || newAudio.duration <= 0) {
                    throw new Error(`Invalid duration for cached ${filename} after metadata load (duration: ${newAudio.duration})`);
                }
                
                // console.log(`🌊 [CACHE HIT] ${filename} from cache (duration: ${newAudio.duration})`);
                return newAudio;
            } else {
                // Cached audio is invalid, remove it and reload
                console.warn(`🌊 [CACHE INVALID] Removing invalid cached audio: ${filename}`);
                this.cache.delete(filename);
                this.accessOrder.delete(filename);
            }
        }
        
        try {
            // Load and cache
            // Special handling for files stored in /sounds/ not /sounds/ambient/
            // - sova_* files (entrainment ambient)
            // - bees_buzzing.mp3 (bee proximity sound)
            const isRootSoundsFile = filename.startsWith('sova_') || filename === 'bees_buzzing.mp3';
            const fullPath = isRootSoundsFile 
                ? `/sounds/${filename}` 
                : AMBIENT_CONFIG.SOUNDS_BASE_PATH + filename;
            // console.log(`🌊 [LOADING] Attempting to load: ${fullPath}`);
            
            audio = new Audio(fullPath);
            audio.preload = 'metadata'; // Changed from 'auto' to 'metadata' for faster loading
            audio.crossOrigin = 'anonymous';
            
            await new Promise((resolve, reject) => {
                const loadTimeout = setTimeout(() => {
                    console.warn(`🌊 [TIMEOUT] Loading timeout for ${filename} after 10 seconds`);
                    reject(new Error(`Audio load timeout: ${filename}`));
                }, 10000); // Increased timeout to 10 seconds
                
                // Wait for loadedmetadata instead of canplaythrough for faster response
                audio!.addEventListener('loadedmetadata', () => {
                    clearTimeout(loadTimeout);
                    
                    // Verify the audio actually loaded successfully
                    if (audio!.networkState === 2) { // NETWORK_ERROR
                        reject(new Error(`Network error loading ${filename} (networkState: ${audio!.networkState})`));
                        return;
                    }
                    
                    if (!audio!.duration || isNaN(audio!.duration) || !isFinite(audio!.duration)) {
                        reject(new Error(`Invalid duration for ${filename}: ${audio!.duration}`));
                        return;
                    }
                    
                    // console.log(`🌊 [METADATA LOADED] ${filename} - duration: ${audio!.duration}s`);
                    resolve(null);
                }, { once: true });
                
                audio!.addEventListener('error', (e) => {
                    clearTimeout(loadTimeout);
                    const errorMsg = `Failed to load audio: ${filename} (networkState: ${audio!.networkState}, readyState: ${audio!.readyState})`;
                    console.error(`🌊 [LOAD ERROR] ${errorMsg}:`, e);
                    reject(new Error(errorMsg));
                }, { once: true });
                
                // Also listen for canplaythrough as backup
                audio!.addEventListener('canplaythrough', () => {
                    clearTimeout(loadTimeout);
                    
                    // Verify the audio actually loaded successfully
                    if (audio!.networkState === 2) { // NETWORK_ERROR
                        reject(new Error(`Network error loading ${filename} (networkState: ${audio!.networkState})`));
                        return;
                    }
                    
                    if (!audio!.duration || isNaN(audio!.duration) || !isFinite(audio!.duration)) {
                        reject(new Error(`Invalid duration for ${filename}: ${audio!.duration}`));
                        return;
                    }
                    
                    // console.log(`🌊 [CAN PLAY] ${filename} ready to play`);
                    resolve(null);
                }, { once: true });
                
                audio!.load();
            });
            
            // Double-check before caching
            if (audio.networkState === 2 || !audio.duration || isNaN(audio.duration) || !isFinite(audio.duration)) {
                throw new Error(`Audio validation failed for ${filename} (networkState: ${audio.networkState}, duration: ${audio.duration})`);
            }
            
            this.set(filename, audio);
            
            // Create a new Audio element instead of cloning to ensure metadata loads properly
            // Even though we just loaded it, cloned elements don't automatically have metadata
            const newAudio = new Audio(fullPath);
            newAudio.preload = 'metadata';
            newAudio.crossOrigin = 'anonymous';
            
            // Wait briefly for metadata to load (should be fast since file is already cached by browser)
            await new Promise<void>((resolve, reject) => {
                const loadTimeout = setTimeout(() => {
                    // If metadata doesn't load quickly, check readyState
                    if (newAudio.readyState >= 1 && newAudio.duration && newAudio.duration > 0 && !isNaN(newAudio.duration) && isFinite(newAudio.duration)) {
                        resolve();
                    } else {
                        reject(new Error(`Metadata load timeout for newly loaded ${filename}`));
                    }
                }, 1000);
                
                const onLoadedMetadata = () => {
                    clearTimeout(loadTimeout);
                    if (newAudio.duration && newAudio.duration > 0 && !isNaN(newAudio.duration) && isFinite(newAudio.duration)) {
                        resolve();
                    } else {
                        // Wait a tiny bit more
                        setTimeout(() => {
                            if (newAudio.duration && newAudio.duration > 0 && !isNaN(newAudio.duration) && isFinite(newAudio.duration)) {
                                resolve();
                            } else {
                                reject(new Error(`Invalid duration after loadedmetadata for newly loaded ${filename}`));
                            }
                        }, 50);
                    }
                };
                
                if (newAudio.readyState >= 1) {
                    if (newAudio.duration && newAudio.duration > 0 && !isNaN(newAudio.duration) && isFinite(newAudio.duration)) {
                        clearTimeout(loadTimeout);
                        resolve();
                    } else {
                        newAudio.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
                        newAudio.load();
                    }
                } else {
                    newAudio.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
                    newAudio.addEventListener('error', () => {
                        clearTimeout(loadTimeout);
                        reject(new Error(`Error loading metadata for newly loaded ${filename}`));
                    }, { once: true });
                    newAudio.load();
                }
            });
            
            // Final verification
            if (!newAudio.duration || isNaN(newAudio.duration) || !isFinite(newAudio.duration) || newAudio.duration <= 0) {
                throw new Error(`Invalid duration for newly loaded ${filename} after metadata load (duration: ${newAudio.duration})`);
            }
            
            // console.log(`🌊 [CACHED] ${filename} stored in cache and new element created`);
            return newAudio;
        } catch (error) {
            console.warn(`🌊 [LOAD FAILED] Failed to load ${filename}, NOT caching fallback:`, error);
            // Don't cache failed loads - throw error so caller can handle it
            throw error;
        }
    }

    clear(): void {
        this.cache.clear();
        this.accessOrder.clear();
        this.accessCounter = 0;
    }
}

// Global instances
const ambientAudioCache = new AmbientAudioCache();
const activeSeamlessLoopingSounds = new Map<AmbientSoundType, SeamlessLoopingSound>();
const activeRandomSounds = new Set<HTMLAudioElement>();
const randomSoundTimers = new Map<AmbientSoundType, number>();
const loadingSeamlessSounds = new Set<AmbientSoundType>(); // Track sounds currently being loaded/started

// 🌊 UNDERWATER AUDIO FILTER SYSTEM - Uses Web Audio API for realistic muffling
interface UnderwaterAudioNode {
    source: MediaElementAudioSourceNode;
    filter: BiquadFilterNode;
    gainNode: GainNode;
}

let audioContext: AudioContext | null = null;
const underwaterAudioNodes = new Map<HTMLAudioElement, UnderwaterAudioNode>();
let isCurrentlyUnderwater = false;
let isCurrentlyIndoors = false; // Track indoor state for muffling outdoor sounds

/**
 * Initialize or get the shared AudioContext
 */
const getAudioContext = (): AudioContext => {
    if (!audioContext || audioContext.state === 'closed') {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContext;
};

/**
 * Connect an audio element to the underwater filter system
 * This allows us to apply lowpass filtering when underwater
 */
const connectToUnderwaterFilter = (audio: HTMLAudioElement): UnderwaterAudioNode | null => {
    try {
        // Check if already connected
        if (underwaterAudioNodes.has(audio)) {
            return underwaterAudioNodes.get(audio)!;
        }

        const ctx = getAudioContext();
        
        // Create source from audio element
        const source = ctx.createMediaElementSource(audio);
        
        // Create lowpass filter for underwater muffling
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 22050; // Start with full frequency range (no filtering)
        filter.Q.value = 0.7; // Gentle rolloff
        
        // Create gain node for volume control
        const gainNode = ctx.createGain();
        gainNode.gain.value = 1.0; // Start at full volume
        
        // Connect: source -> filter -> gain -> destination
        source.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        const node: UnderwaterAudioNode = { source, filter, gainNode };
        underwaterAudioNodes.set(audio, node);
        
        return node;
    } catch (error) {
        // If Web Audio API fails, audio will play normally without filtering
        console.warn('🌊 [UNDERWATER] Failed to connect audio to filter system:', error);
        return null;
    }
};

/**
 * Apply underwater audio effect to a specific audio element
 */
const applyUnderwaterEffect = (audio: HTMLAudioElement, shouldBeUnderwater: boolean) => {
    const node = underwaterAudioNodes.get(audio);
    if (!node) return;

    const ctx = getAudioContext();
    const currentTime = ctx.currentTime;
    const transitionDuration = AMBIENT_CONFIG.UNDERWATER_TRANSITION_DURATION / 1000; // Convert to seconds

    if (shouldBeUnderwater) {
        // Apply lowpass filter and reduce volume
        node.filter.frequency.cancelScheduledValues(currentTime);
        node.filter.frequency.setValueAtTime(node.filter.frequency.value, currentTime);
        node.filter.frequency.linearRampToValueAtTime(
            AMBIENT_CONFIG.UNDERWATER_LOWPASS_FREQUENCY, 
            currentTime + transitionDuration
        );

        node.gainNode.gain.cancelScheduledValues(currentTime);
        node.gainNode.gain.setValueAtTime(node.gainNode.gain.value, currentTime);
        node.gainNode.gain.linearRampToValueAtTime(
            AMBIENT_CONFIG.UNDERWATER_VOLUME_MULTIPLIER, 
            currentTime + transitionDuration
        );
    } else {
        // Remove filter and restore volume
        node.filter.frequency.cancelScheduledValues(currentTime);
        node.filter.frequency.setValueAtTime(node.filter.frequency.value, currentTime);
        node.filter.frequency.linearRampToValueAtTime(22050, currentTime + transitionDuration); // Full range

        node.gainNode.gain.cancelScheduledValues(currentTime);
        node.gainNode.gain.setValueAtTime(node.gainNode.gain.value, currentTime);
        node.gainNode.gain.linearRampToValueAtTime(1.0, currentTime + transitionDuration);
    }
};

/**
 * Check if a sound type should be muffled underwater
 */
const shouldMuffleUnderwater = (soundType: AmbientSoundType): boolean => {
    const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
    return !('underwaterOnly' in definition && definition.underwaterOnly);
};

/**
 * Connect audio to underwater filter and apply current underwater state if needed
 * @returns true if successfully connected
 */
const setupUnderwaterFilter = (audio: HTMLAudioElement, soundType: AmbientSoundType): boolean => {
    const node = connectToUnderwaterFilter(audio);
    if (node && isCurrentlyUnderwater && shouldMuffleUnderwater(soundType)) {
        applyUnderwaterEffect(audio, true);
    }
    return node !== null;
};

/**
 * Apply underwater effect to ALL currently playing sounds
 */
const setGlobalUnderwaterState = (isUnderwater: boolean) => {
    if (isCurrentlyUnderwater === isUnderwater) return; // No change
    
    isCurrentlyUnderwater = isUnderwater;
    console.log(`🌊 [UNDERWATER] ${isUnderwater ? 'Diving underwater - applying muffled audio' : 'Surfacing - restoring normal audio'}`);

    // Apply to all seamless looping sounds (except underwater-specific sounds)
    activeSeamlessLoopingSounds.forEach((seamlessSound, soundType) => {
        if (!shouldMuffleUnderwater(soundType)) return;
        applyUnderwaterEffect(seamlessSound.primary, isUnderwater);
        applyUnderwaterEffect(seamlessSound.secondary, isUnderwater);
    });

    // Apply to all simple looping sounds
    const simpleLoopingSounds = (window as any).simpleLoopingSounds;
    if (simpleLoopingSounds instanceof Map) {
        simpleLoopingSounds.forEach((audio: HTMLAudioElement, soundType: AmbientSoundType) => {
            if (!shouldMuffleUnderwater(soundType)) return;
            applyUnderwaterEffect(audio, isUnderwater);
        });
    }

    // Apply to any currently playing random sounds (all random sounds get muffled)
    activeRandomSounds.forEach((audio) => {
        applyUnderwaterEffect(audio, isUnderwater);
    });
};

/**
 * Apply indoor muffling effect to a specific audio element
 * Indoor muffling is less extreme than underwater - walls muffle but don't fully block sound
 */
const applyIndoorEffect = (audio: HTMLAudioElement, shouldBeIndoors: boolean) => {
    const node = underwaterAudioNodes.get(audio); // Reuse same audio node structure
    if (!node) return;

    const ctx = getAudioContext();
    const currentTime = ctx.currentTime;
    const transitionDuration = AMBIENT_CONFIG.INDOOR_TRANSITION_DURATION / 1000;

    if (shouldBeIndoors) {
        // Apply mild lowpass filter and reduce volume (less extreme than underwater)
        node.filter.frequency.cancelScheduledValues(currentTime);
        node.filter.frequency.setValueAtTime(node.filter.frequency.value, currentTime);
        node.filter.frequency.linearRampToValueAtTime(
            AMBIENT_CONFIG.INDOOR_LOWPASS_FREQUENCY, 
            currentTime + transitionDuration
        );

        node.gainNode.gain.cancelScheduledValues(currentTime);
        node.gainNode.gain.setValueAtTime(node.gainNode.gain.value, currentTime);
        node.gainNode.gain.linearRampToValueAtTime(
            AMBIENT_CONFIG.INDOOR_VOLUME_MULTIPLIER, 
            currentTime + transitionDuration
        );
    } else {
        // Remove filter and restore volume
        node.filter.frequency.cancelScheduledValues(currentTime);
        node.filter.frequency.setValueAtTime(node.filter.frequency.value, currentTime);
        node.filter.frequency.linearRampToValueAtTime(22050, currentTime + transitionDuration);

        node.gainNode.gain.cancelScheduledValues(currentTime);
        node.gainNode.gain.setValueAtTime(node.gainNode.gain.value, currentTime);
        node.gainNode.gain.linearRampToValueAtTime(1.0, currentTime + transitionDuration);
    }
};

/**
 * Check if a sound type should be muffled indoors
 * Underwater and entrainment sounds don't get indoor muffling
 */
const shouldMuffleIndoors = (soundType: AmbientSoundType): boolean => {
    const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
    // Don't muffle underwater-specific or entrainment sounds
    if ('underwaterOnly' in definition && definition.underwaterOnly) return false;
    if (soundType === 'entrainment_ambient') return false;
    return true;
};

/**
 * Apply indoor muffling to ALL currently playing outdoor sounds
 */
const setGlobalIndoorState = (indoors: boolean) => {
    if (isCurrentlyIndoors === indoors) return; // No change
    
    isCurrentlyIndoors = indoors;
    console.log(`🏠 [INDOOR] ${indoors ? 'Entering building - muffling outdoor sounds' : 'Exiting building - restoring outdoor sounds'}`);

    // Apply to all seamless looping sounds (except underwater-specific and entrainment)
    activeSeamlessLoopingSounds.forEach((seamlessSound, soundType) => {
        if (!shouldMuffleIndoors(soundType)) return;
        // Only apply indoor effect if not already underwater (underwater takes precedence)
        if (!isCurrentlyUnderwater) {
            applyIndoorEffect(seamlessSound.primary, indoors);
            applyIndoorEffect(seamlessSound.secondary, indoors);
        }
    });

    // Apply to all simple looping sounds
    const simpleLoopingSounds = (window as any).simpleLoopingSounds;
    if (simpleLoopingSounds instanceof Map) {
        simpleLoopingSounds.forEach((audio: HTMLAudioElement, soundType: AmbientSoundType) => {
            if (!shouldMuffleIndoors(soundType)) return;
            if (!isCurrentlyUnderwater) {
                applyIndoorEffect(audio, indoors);
            }
        });
    }

    // Apply to any currently playing random sounds
    activeRandomSounds.forEach((audio) => {
        if (!isCurrentlyUnderwater) {
            applyIndoorEffect(audio, indoors);
        }
    });
};

// Global update loop safety net - ensures update loop never permanently dies
let globalUpdateIntervalId: number | undefined;
let lastUpdateLoopActivity = 0;
let updateLoopRestartCallback: (() => void) | null = null;

const ensureUpdateLoopIsRunning = () => {
    // Clear any existing global interval
    if (globalUpdateIntervalId) {
        window.clearInterval(globalUpdateIntervalId);
    }
    
    // Start new global interval as backup
    globalUpdateIntervalId = window.setInterval(() => {
        const now = Date.now();
        const timeSinceLastUpdate = now - lastUpdateLoopActivity;
        
        // If the main update loop hasn't run in over 5 seconds, and we have seamless sounds, try to restart it
        if (timeSinceLastUpdate > 5000 && activeSeamlessLoopingSounds.size > 0) {
            console.warn(`🌊 ⚠️ SAFETY NET: Main update loop inactive for ${(timeSinceLastUpdate/1000).toFixed(1)}s with ${activeSeamlessLoopingSounds.size} sounds. Attempting restart...`);
            // Try to restart via callback if available
            if (updateLoopRestartCallback) {
                updateLoopRestartCallback();
            } else {
                // Fallback: manually call update function
                updateSeamlessLoopingSounds();
            }
        }
    }, 1000); // Check every second
};

// Utility functions
const applyAudioVariation = (audio: HTMLAudioElement, baseVolume: number, masterVolume: number) => {
    const pitchVariation = 1 + (Math.random() - 0.5) * AMBIENT_CONFIG.PITCH_VARIATION;
    const volumeVariation = 1 + (Math.random() - 0.5) * AMBIENT_CONFIG.VOLUME_VARIATION;
    
    audio.playbackRate = pitchVariation;
    audio.volume = Math.min(1.0, baseVolume * volumeVariation * masterVolume);
};

const fadeInAudio = (audio: HTMLAudioElement, targetVolume: number, duration: number = AMBIENT_CONFIG.FADE_DURATION) => {
    audio.volume = 0;
    const steps = 20;
    const stepTime = duration / steps;
    // Clamp targetVolume to valid range [0, 1]
    const clampedTargetVolume = Math.max(0, Math.min(1.0, targetVolume));
    const volumeStep = clampedTargetVolume / steps;
    
    let currentStep = 0;
    const fadeInterval = setInterval(() => {
        currentStep++;
        // Clamp volume to [0, 1] to prevent IndexSizeError
        audio.volume = Math.max(0, Math.min(1.0, volumeStep * currentStep));
        
        if (currentStep >= steps) {
            clearInterval(fadeInterval);
        }
    }, stepTime);
};

const fadeOutAudio = (audio: HTMLAudioElement, duration: number = AMBIENT_CONFIG.FADE_DURATION): Promise<void> => {
    return new Promise((resolve) => {
        const initialVolume = audio.volume;
        const steps = 20;
        const stepTime = duration / steps;
        const volumeStep = initialVolume / steps;
        
        let currentStep = 0;
        const fadeInterval = setInterval(() => {
            currentStep++;
            audio.volume = Math.max(0, initialVolume - (volumeStep * currentStep));
            
            if (currentStep >= steps || audio.volume <= 0) {
                clearInterval(fadeInterval);
                audio.pause();
                audio.currentTime = 0;
                resolve();
            }
        }, stepTime);
    });
};

// 🎵 Create seamless looping audio system (based on useSoundSystem.ts)
const createSeamlessLoopingSound = async (
    soundType: AmbientSoundType, 
    filename: string, 
    volume: number,
    pitchVariation: number
): Promise<boolean> => {
    try {
        // console.log(`🌊 Creating seamless ambient sound: ${soundType} (${filename})`);
        
        const audio1 = await ambientAudioCache.loadAudio(filename);
        const audio2 = await ambientAudioCache.loadAudio(filename);
        
        // Wait for both audio files to be fully loaded with proper duration
        const waitForDuration = (audio: HTMLAudioElement): Promise<number> => {
            return new Promise((resolve, reject) => {
                let attempts = 0;
                const maxAttempts = 50; // 5 seconds max wait
                
                const checkDuration = () => {
                    attempts++;
                    if (audio.duration && audio.duration > 0 && !isNaN(audio.duration)) {
                        resolve(audio.duration);
                    } else if (attempts >= maxAttempts) {
                        console.warn(`🌊 Duration detection timeout for ${filename}, using fallback`);
                        resolve(20); // Reasonable fallback for ambient sounds
                    } else {
                        // Keep checking every 100ms
                        setTimeout(checkDuration, 100);
                    }
                };
                checkDuration();
            });
        };

        // Wait for both audio files to have valid duration
        const [duration1, duration2] = await Promise.all([
            waitForDuration(audio1),
            waitForDuration(audio2)
        ]);
        
        const duration = Math.max(duration1, duration2); // Use the longer duration just in case
        // console.log(`🌊 Audio duration confirmed: ${duration}s for ${filename}`);
        
        if (duration <= 0) {
            console.error(`🌊 Invalid audio duration ${duration}s for ${filename}, aborting seamless loop`);
            return false;
        }
        
        // Configure both instances
        [audio1, audio2].forEach(audio => {
            audio.loop = false; // We'll handle looping manually
            audio.volume = 0; // Start at 0 for fade-in
            audio.playbackRate = pitchVariation;
            // 🌊 Connect to underwater filter system (applies current state if underwater)
            setupUnderwaterFilter(audio, soundType);
        });
        
        const overlapTime = Math.min(2, duration * AMBIENT_CONFIG.OVERLAP_PERCENTAGE); // 15% overlap, max 2 seconds
        const nextSwapTime = Date.now() + (duration - overlapTime) * 1000;
        
        // console.log(`🌊 Seamless loop timing: duration=${duration}s, overlap=${overlapTime}s, first swap in ${((nextSwapTime - Date.now()) / 1000).toFixed(1)}s`);
        
        // Store the seamless sound configuration
        activeSeamlessLoopingSounds.set(soundType, {
            primary: audio1,
            secondary: audio2,
            isPrimaryActive: true,
            nextSwapTime,
            volume,
            pitchVariation
        });
        
        // console.log(`🌊 Added ${soundType} to activeSeamlessLoopingSounds map. Map size: ${activeSeamlessLoopingSounds.size}`);
        // console.log(`🌊 Current seamless sounds: [${Array.from(activeSeamlessLoopingSounds.keys()).join(', ')}]`);
        
        // Start with primary audio and fade in smoothly
        try {
            await audio1.play();
            fadeInAudio(audio1, volume, AMBIENT_CONFIG.FADE_DURATION); // Smooth 3-second fade-in
            // console.log(`🌊 ✅ Successfully started seamless ambient sound: ${soundType} (duration: ${duration}s, next swap in: ${((nextSwapTime - Date.now()) / 1000).toFixed(1)}s)`);
        } catch (playError) {
            console.warn(`🌊 Failed to play initial audio for ${soundType}, trying again:`, playError);
            // Retry once
            setTimeout(async () => {
                try {
                    audio1.currentTime = 0;
                    await audio1.play();
                    fadeInAudio(audio1, volume, AMBIENT_CONFIG.FADE_DURATION);
                    // console.log(`🌊 ✅ Retry successful for ${soundType}`);
                } catch (retryError) {
                    console.error(`🌊 ❌ Retry failed for ${soundType}:`, retryError);
                    cleanupSeamlessSound(soundType, "initial play retry failed");
                }
            }, 1000);
        }
        
        // Set up error handlers
        [audio1, audio2].forEach((audio, index) => {
            const handleError = (e: Event) => {
                if (!(audio as any)._isBeingCleaned) {
                    console.warn(`🌊 ❌ Seamless ambient audio error for ${soundType} (${index === 0 ? 'primary' : 'secondary'}):`, e);
                    // Fire-and-forget cleanup on error (don't wait for fade-out)
                    cleanupSeamlessSound(soundType, "seamless audio error").catch(err => 
                        console.warn(`🌊 Error during cleanup after audio error: ${err}`)
                    );
                }
            };
            audio.addEventListener('error', handleError, { once: true });
        });
        
        return true;
    } catch (error) {
        console.warn(`🌊 ❌ Failed to create seamless ambient sound for ${soundType}: ${filename}`, error);
        return false;
    }
};

// Track sounds that are currently fading out to prevent double-cleanup
const fadingOutAmbientSounds = new Set<AmbientSoundType>();

// Fade-out duration for smooth audio transitions (ms) - slightly longer for ambient sounds
const AMBIENT_SOUND_FADE_OUT_DURATION = 800; // 800ms smooth fade-out for ambient sounds

// Helper function to fade out and cleanup an ambient audio element
const fadeOutAndCleanupAmbientAudio = (audio: HTMLAudioElement, soundType: AmbientSoundType): Promise<void> => {
    return new Promise((resolve) => {
        const fadeOutTime = AMBIENT_SOUND_FADE_OUT_DURATION;
        const fadeSteps = 32; // Extra smooth steps for ambient
        const fadeInterval = fadeOutTime / fadeSteps;
        const initialVolume = audio.volume;
        
        // Mark as being cleaned up to prevent error handling
        (audio as any)._isBeingCleaned = true;
        
        let fadeStep = 0;
        const fadeOutIntervalId = setInterval(() => {
            fadeStep++;
            const newVolume = initialVolume * (1 - fadeStep / fadeSteps);
            try {
                audio.volume = Math.max(0, newVolume);
            } catch (e) {
                // Volume setting failed, just continue
            }
            
            if (fadeStep >= fadeSteps) {
                clearInterval(fadeOutIntervalId);
                try {
                    audio.pause();
                    audio.currentTime = 0;
                    audio.src = '';
                    audio.load();
                } catch (e) {
                    // Cleanup errors are expected
                }
                resolve();
            }
        }, fadeInterval);
    });
};

// Enhanced cleanup function for seamless sounds with smooth fade-out
const cleanupSeamlessSound = async (soundType: AmbientSoundType, reason: string = "cleanup") => {
    // Skip if already fading out
    if (fadingOutAmbientSounds.has(soundType)) {
        return;
    }
    
    const seamlessSound = activeSeamlessLoopingSounds.get(soundType);
    loadingSeamlessSounds.delete(soundType); // Clear loading state
    
    if (seamlessSound) {
        // Remove from active sounds immediately to prevent re-processing
        activeSeamlessLoopingSounds.delete(soundType);
        fadingOutAmbientSounds.add(soundType);
        
        // console.log(`🌊 Cleaning up seamless ambient sound for ${soundType} (${reason})`);
        
        // Mark both audio instances as being cleaned to prevent interference
        (seamlessSound.primary as any)._isBeingCleaned = true;
        (seamlessSound.secondary as any)._isBeingCleaned = true;
        
        try {
            // Fade out both audio instances smoothly in parallel
            await Promise.all([
                fadeOutAndCleanupAmbientAudio(seamlessSound.primary, soundType),
                fadeOutAndCleanupAmbientAudio(seamlessSound.secondary, soundType)
            ]);
            
        } catch (e) {
            if (e instanceof Error && !e.message.includes('load') && !e.message.includes('src')) {
                console.warn(`🌊 Unexpected error during seamless ambient audio cleanup for ${soundType}:`, e);
            }
        }
        
        fadingOutAmbientSounds.delete(soundType);
        // console.log(`🌊 ✅ Cleaned up seamless ambient sound for ${soundType} (${reason}). Map size now: ${activeSeamlessLoopingSounds.size}`);
    }
};

// 🎵 Update seamless looping sounds (handle overlapping) - based on useSoundSystem.ts
let updateLoopCallCount = 0; // Debug counter
let lastDebugTime = 0; // Track last debug message time
const updateSeamlessLoopingSounds = () => {
    const now = Date.now();
    updateLoopCallCount++;
    lastUpdateLoopActivity = now; // Track activity for safety net
    
    // Show monitoring status every 5 seconds (more frequent than before)
    if (now - lastDebugTime >= 5000) {
        lastDebugTime = now;
        const activeCount = activeSeamlessLoopingSounds.size;
        // console.log(`🌊 [${new Date().toLocaleTimeString()}] 🔄 Update loop #${updateLoopCallCount}: Monitoring ${activeCount} seamless sounds`);
        
        if (activeCount > 0) {
            activeSeamlessLoopingSounds.forEach((seamlessSound, soundType) => {
                const timeUntilSwap = (seamlessSound.nextSwapTime - now) / 1000;
                const activeAudio = seamlessSound.isPrimaryActive ? seamlessSound.primary : seamlessSound.secondary;
                const isPlaying = !activeAudio.paused && !activeAudio.ended;
                // console.log(`   - ${soundType}: swap in ${timeUntilSwap.toFixed(1)}s (${seamlessSound.isPrimaryActive ? 'primary' : 'secondary'} active, playing: ${isPlaying})`);
            });
        } else {
            // console.log(`   - ❌ No seamless sounds found in map! This means sounds will stop after first loop.`);
        }
    }
    
    // Critical error detection: if we have 0 seamless sounds but should have some
    if (activeSeamlessLoopingSounds.size === 0 && updateLoopCallCount > 100) {
        // Only log this error occasionally to avoid spam
        if (updateLoopCallCount % 2000 === 0) { // Every ~100 seconds
            console.error(`🌊 ❌ CRITICAL: Update loop running but no seamless sounds in map! Continuous sounds will not loop properly.`);
        }
    }
    
    activeSeamlessLoopingSounds.forEach((seamlessSound, soundType) => {
        const { primary, secondary, isPrimaryActive, nextSwapTime, volume, pitchVariation } = seamlessSound;
        
        // Check if it's time to start the overlap
        if (now >= nextSwapTime) {
            const currentAudio = isPrimaryActive ? primary : secondary;
            const nextAudio = isPrimaryActive ? secondary : primary;
            
            // console.log(`🌊 Starting seamless swap for ${soundType} at ${now} (scheduled: ${nextSwapTime})`);
            
            try {
                // Check if current audio is still playing - if not, restart it
                if (currentAudio.paused || currentAudio.ended) {
                    // console.warn(`🌊 Current audio stopped unexpectedly for ${soundType}, restarting...`);
                    currentAudio.currentTime = 0;
                    currentAudio.volume = Math.max(0, Math.min(1.0, volume));
                    currentAudio.play().catch(e => console.warn(`🌊 Failed to restart current audio: ${e}`));
                    
                    // Reschedule next swap
                    const duration = currentAudio.duration || 10;
                    const overlapTime = Math.min(2, duration * AMBIENT_CONFIG.OVERLAP_PERCENTAGE);
                    seamlessSound.nextSwapTime = now + (duration - overlapTime) * 1000;
                    return;
                }

                // Prepare next audio WITHOUT starting it yet
                const volumeVariation = 0.95 + Math.random() * 0.1;
                const newPitchVariation = pitchVariation * (0.98 + Math.random() * 0.04);
        
                nextAudio.volume = 0; // Start silent
                nextAudio.playbackRate = newPitchVariation;
                nextAudio.currentTime = 0;
                
                // Start next audio and handle the crossfade
                nextAudio.play().then(() => {
                    // console.log(`🌊 Next audio started for ${soundType}, beginning crossfade`);
                    
                    // Gradually fade in next audio and fade out current
                    const crossfadeDuration = 1000; // 1 second crossfade
                    const steps = 20;
                    const stepTime = crossfadeDuration / steps;
                    const targetVolume = Math.min(1.0, volume * volumeVariation);
                    
                    let step = 0;
                    const crossfadeInterval = setInterval(() => {
                        step++;
                        const progress = step / steps;
                        
                        // Don't touch audio that's being cleaned up
                        if (!(currentAudio as any)._isBeingCleaned && !(nextAudio as any)._isBeingCleaned) {
                            // Fade in next audio
                            nextAudio.volume = Math.min(targetVolume, targetVolume * progress);
                            // Fade out current audio
                            const clampedVolume = Math.max(0, Math.min(1.0, volume));
                            currentAudio.volume = Math.max(0, clampedVolume * (1 - progress));
                        }
                        
                        if (step >= steps) {
                            clearInterval(crossfadeInterval);
                            
                            // Only complete swap if not being cleaned up
                            if (!(currentAudio as any)._isBeingCleaned && !(nextAudio as any)._isBeingCleaned) {
                                // Stop current audio
                                currentAudio.pause();
                                currentAudio.currentTime = 0;
                                
                                // Swap active audio
                                seamlessSound.isPrimaryActive = !isPrimaryActive;
                                seamlessSound.volume = targetVolume;
                                
                                // Schedule next swap
                                const duration = nextAudio.duration || 10;
                                const overlapTime = Math.min(2, duration * AMBIENT_CONFIG.OVERLAP_PERCENTAGE);
                                seamlessSound.nextSwapTime = now + (duration - overlapTime) * 1000;
                                
                                // console.log(`🌊 ✅ Seamless swap completed for ${soundType}: ${isPrimaryActive ? 'primary→secondary' : 'secondary→primary'}, next swap in ${((seamlessSound.nextSwapTime - Date.now()) / 1000).toFixed(1)}s`);
                            }
                        }
                    }, stepTime);
                    
                }).catch(error => {
                    console.warn(`🌊 Failed to start next audio for ${soundType}:`, error);
                    // Fallback: keep current audio playing and reschedule
                    const duration = currentAudio.duration || 10;
                    const overlapTime = Math.min(2, duration * AMBIENT_CONFIG.OVERLAP_PERCENTAGE);
                    seamlessSound.nextSwapTime = now + (duration - overlapTime) * 1000;
                    // console.log(`🌊 Rescheduled ${soundType} swap in ${((seamlessSound.nextSwapTime - now) / 1000).toFixed(1)}s due to play error`);
                });
                
            } catch (error) {
                console.warn(`🌊 Error during seamless ambient swap for ${soundType}:`, error);
                // Fallback recovery: restart the current audio
                try {
                    const currentAudio = isPrimaryActive ? primary : secondary;
                    currentAudio.currentTime = 0;
                    currentAudio.volume = Math.max(0, Math.min(1.0, volume));
                    currentAudio.play().catch(e => console.warn(`🌊 Recovery play failed: ${e}`));
                    
                    // Reschedule further out
                    const duration = currentAudio.duration || 10;
                    seamlessSound.nextSwapTime = now + duration * 1000;
                    // console.log(`🌊 Recovery: rescheduled ${soundType} in ${duration}s`);
                } catch (recoveryError) {
                    console.error(`🌊 Failed to recover ambient sound ${soundType}:`, recoveryError);
                    // Last resort: cleanup and restart via health check
                    cleanupSeamlessSound(soundType, "recovery failed").catch(err => 
                        console.warn(`🌊 Error during recovery cleanup: ${err}`)
                    );
                }
            }
        }
        
        // Health check: ensure the active audio is still playing
        const activeAudio = isPrimaryActive ? primary : secondary;
        if (activeAudio.paused || activeAudio.ended) {
            console.warn(`🌊 Health check: Active audio stopped unexpectedly for ${soundType}, restarting...`);
            try {
                // Don't restart if being cleaned up
                if (!(activeAudio as any)._isBeingCleaned) {
                    activeAudio.currentTime = 0;
                    activeAudio.volume = Math.max(0, Math.min(1.0, volume));
                    activeAudio.play().then(() => {
                        // console.log(`🌊 ✅ Health check restart successful for ${soundType}`);
                        // Reschedule next swap
                        const duration = activeAudio.duration || 10;
                        const overlapTime = Math.min(2, duration * AMBIENT_CONFIG.OVERLAP_PERCENTAGE);
                        seamlessSound.nextSwapTime = Date.now() + (duration - overlapTime) * 1000;
                    }).catch(e => {
                        console.warn(`🌊 Health check restart failed for ${soundType}: ${e}`);
                        // Try the other audio instance
                        const backupAudio = isPrimaryActive ? secondary : primary;
                        if (!(backupAudio as any)._isBeingCleaned) {
                            backupAudio.currentTime = 0;
                            backupAudio.volume = Math.max(0, Math.min(1.0, volume));
                            backupAudio.play().then(() => {
                                seamlessSound.isPrimaryActive = !isPrimaryActive;
                                // console.log(`🌊 ✅ Health check switched to backup audio for ${soundType}`);
                            }).catch(e2 => console.warn(`🌊 Backup audio failed: ${e2}`));
                        }
                    });
                }
            } catch (healthError) {
                console.warn(`🌊 Health check failed for ${soundType}:`, healthError);
            }
        }
    });
};

// Simple fallback looping system
const startSimpleLoopingSound = async (
    soundType: AmbientSoundType,
    filename: string,
    volume: number,
    pitchVariation: number
): Promise<boolean> => {
    try {
        const audio = await ambientAudioCache.loadAudio(filename);
        
        // Configure for simple looping
        audio.loop = true; // Use built-in browser looping
        audio.volume = 0; // Start silent for fade-in
        audio.playbackRate = pitchVariation;
        // 🌊 Connect to underwater filter system (applies current state if underwater)
        setupUnderwaterFilter(audio, soundType);

        // Store in a simple map for simple looping sounds
        (window as any).simpleLoopingSounds = (window as any).simpleLoopingSounds || new Map();
        (window as any).simpleLoopingSounds.set(soundType, audio);
        
        // Start playing and fade in
        await audio.play();
        fadeInAudio(audio, volume, AMBIENT_CONFIG.FADE_DURATION);
        
        // console.log(`🌊 ✅ Started simple loop fallback for ${soundType}`);
        return true;
    } catch (error) {
        console.warn(`🌊 ❌ Simple loop fallback failed for ${soundType}:`, error);
        return false;
    }
};

export class AmbientSoundRuntime {
    private options: AmbientSoundProps = {};
    private isStarted = false;
    private isInitialized = false;
    private updateIntervalId: number | undefined;
    private healthCheckIntervalId: number | undefined;
    private lastWeather: AmbientSoundProps['weatherCondition'];
    private lastUnderwaterState = false;
    private lastIndoorState = false;
    private lastDistanceToShore = 0;
    private lastDistanceToMapEdge = Infinity;
    private lastDistanceToBee = Infinity;
    private continuousSoundsKey = '';
    private volumeKey = '';
    private proximityKey = '';
    private beeKey = '';
    private continuousUpdateInFlight = false;

    update(options: AmbientSoundProps = {}): void {
        this.options = options;
        this.lastDistanceToMapEdge = options.distanceToMapEdge ?? Infinity;

        if (!this.isStarted) {
            this.start();
        }

        this.syncContinuousSounds();
        this.updateVolumesIfNeeded();
        this.updateUnderwaterState();
        this.updateIndoorState();
        this.updateProximityVolumesIfNeeded();
        this.updateBeeVolumeIfNeeded();
    }

    stop(): void {
        if (this.updateIntervalId) {
            window.clearInterval(this.updateIntervalId);
            this.updateIntervalId = undefined;
        }

        if (this.healthCheckIntervalId) {
            window.clearInterval(this.healthCheckIntervalId);
            this.healthCheckIntervalId = undefined;
        }

        updateLoopRestartCallback = null;

        if (globalUpdateIntervalId) {
            window.clearInterval(globalUpdateIntervalId);
            globalUpdateIntervalId = undefined;
        }

        randomSoundTimers.forEach(timer => window.clearTimeout(timer));
        randomSoundTimers.clear();

        activeSeamlessLoopingSounds.forEach((_, soundType) => {
            cleanupSeamlessSound(soundType, "runtime stop").catch((err: Error) =>
                console.warn(`Ambient sound cleanup error during runtime stop: ${err}`)
            );
        });

        const simpleLoopingSounds = (window as any).simpleLoopingSounds;
        if (simpleLoopingSounds instanceof Map) {
            simpleLoopingSounds.forEach((audio: HTMLAudioElement) => {
                audio.pause();
                audio.currentTime = 0;
            });
            simpleLoopingSounds.clear();
        }

        activeRandomSounds.forEach(audio => {
            audio.pause();
            audio.currentTime = 0;
        });
        activeRandomSounds.clear();

        delete (window as any).testAmbientVariants;

        this.isStarted = false;
        this.isInitialized = false;
        this.continuousSoundsKey = '';
        this.volumeKey = '';
        this.proximityKey = '';
        this.beeKey = '';
    }

    playManualAmbientSound = (soundType: AmbientSoundType): void => {
        const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
        if (definition.type === 'random') {
            this.scheduleRandomSound(soundType);
        }
    };

    stopAllAmbientSounds = async (): Promise<void> => {
        const cleanupPromises = Array.from(activeSeamlessLoopingSounds.keys()).map(soundType =>
            cleanupSeamlessSound(soundType, "stop all requested")
        );
        await Promise.all(cleanupPromises);

        const simpleLoopingSounds = (window as any).simpleLoopingSounds;
        if (simpleLoopingSounds instanceof Map) {
            simpleLoopingSounds.forEach((audio: HTMLAudioElement) => {
                audio.pause();
                audio.currentTime = 0;
            });
            simpleLoopingSounds.clear();
        }

        randomSoundTimers.forEach(timer => window.clearTimeout(timer));
        randomSoundTimers.clear();

        activeRandomSounds.forEach(audio => {
            audio.pause();
            audio.currentTime = 0;
        });
        activeRandomSounds.clear();
    };

    testAllVariants = async (): Promise<void> => {
        const testFilenames = ['ambient_seagull_cry.mp3', 'ambient_seagull_cry2.mp3', 'ambient_wolf_howl.mp3'];

        for (const testFile of testFilenames) {
            try {
                const response = await fetch(`/sounds/ambient/${testFile}`);
                if (response.ok) {
                    console.log(`   Direct fetch OK: ${testFile} (${response.status})`);
                } else {
                    console.error(`   Direct fetch failed: ${testFile} (${response.status})`);
                }
            } catch (error) {
                console.error(`   Direct fetch error: ${testFile}`, error);
            }
        }

        for (const [soundType, definition] of Object.entries(AMBIENT_SOUND_DEFINITIONS)) {
            if (definition.type !== 'random') continue;

            for (let i = 0; i < (definition.variations || 1); i++) {
                const filename = i === 0 ? definition.filename :
                               definition.filename.replace('.mp3', `${i + 1}.mp3`);

                try {
                    const audio = await ambientAudioCache.loadAudio(filename);
                    await new Promise(resolve => setTimeout(resolve, 500));

                    if (audio.duration && audio.duration > 0 && !isNaN(audio.duration) && isFinite(audio.duration)) {
                        console.log(`   Variant OK ${soundType} ${i + 1}: ${filename} (${audio.duration.toFixed(2)}s)`);
                    } else {
                        console.error(`   Variant invalid ${soundType} ${i + 1}: ${filename} duration=${audio.duration}`);
                    }
                } catch (error) {
                    console.error(`   Variant load error ${soundType} ${i + 1}: ${filename}`, error);
                }
            }
        }
    };

    private start(): void {
        this.isStarted = true;

        if (!this.isInitialized) {
            this.isInitialized = true;
            Object.keys(AMBIENT_SOUND_DEFINITIONS).forEach(soundType => {
                const definition = AMBIENT_SOUND_DEFINITIONS[soundType as AmbientSoundType];
                if (definition.type === 'random') {
                    this.scheduleRandomSound(soundType as AmbientSoundType);
                }
            });
        }

        updateLoopRestartCallback = this.startUpdateLoop;
        this.startUpdateLoop();
        ensureUpdateLoopIsRunning();

        if (!this.healthCheckIntervalId) {
            this.healthCheckIntervalId = window.setInterval(this.runHealthCheck, 5000);
        }

        (window as any).testAmbientVariants = this.testAllVariants;
    }

    private readonly startUpdateLoop = (): void => {
        if (this.updateIntervalId) {
            window.clearInterval(this.updateIntervalId);
        }

        this.updateIntervalId = window.setInterval(() => {
            updateSeamlessLoopingSounds();
        }, 50);

        setTimeout(() => {
            const isStillActive = this.updateIntervalId !== undefined;
            const mapSize = activeSeamlessLoopingSounds.size;
            if (mapSize > 0 && !isStillActive) {
                this.startUpdateLoop();
            }
        }, 2000);
    };

    private get effectiveEnvironmentalVolume(): number {
        return this.options.environmentalVolume !== undefined ? this.options.environmentalVolume : 0.7;
    }

    private get masterVolume(): number {
        return this.options.masterVolume ?? 1.0;
    }

    private get distanceToShore(): number {
        return this.options.distanceToShore ?? 0;
    }

    private get distanceToMapEdge(): number {
        return this.options.distanceToMapEdge ?? Infinity;
    }

    private getDistanceToNearestBee(): number {
        const { localPlayer, wildAnimals } = this.options;
        if (!localPlayer || !wildAnimals || wildAnimals.size === 0) {
            return Infinity;
        }

        const playerX = localPlayer.positionX ?? localPlayer.position_x ?? 0;
        const playerY = localPlayer.positionY ?? localPlayer.position_y ?? 0;
        let nearestDistance = Infinity;

        wildAnimals.forEach((animal) => {
            if (animal.species?.tag !== 'Bee') return;

            const dx = (animal.posX ?? animal.pos_x ?? 0) - playerX;
            const dy = (animal.posY ?? animal.pos_y ?? 0) - playerY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < nearestDistance) {
                nearestDistance = distance;
            }
        });

        return nearestDistance;
    }

    private getCurrentWindIntensity(): 'light' | 'moderate' | 'strong' {
        const { chunkWeather, localPlayer, weatherCondition } = this.options;
        if (!chunkWeather || !localPlayer) {
            console.log('[AmbientSounds] No chunk data, using global weather fallback:', weatherCondition?.tag);
            if (weatherCondition?.tag === 'HeavyRain' || weatherCondition?.tag === 'HeavyStorm') {
                return 'strong';
            }
            if (weatherCondition?.tag === 'LightRain' || weatherCondition?.tag === 'ModerateRain') {
                return 'moderate';
            }
            return 'light';
        }

        const playerChunkIndex = calculateChunkIndex(localPlayer.positionX, localPlayer.positionY);
        const playerChunkData = chunkWeather.get(playerChunkIndex.toString());
        const playerWeatherTag = playerChunkData?.currentWeather?.tag || 'Clear';

        if (playerWeatherTag === 'HeavyStorm' || playerWeatherTag === 'HeavyRain') {
            return 'strong';
        }
        if (playerWeatherTag === 'ModerateRain' || playerWeatherTag === 'LightRain') {
            return 'moderate';
        }
        return 'light';
    }

    private hasEntrainmentEffect(): boolean {
        const { activeConsumableEffects, localPlayerId } = this.options;
        if (!activeConsumableEffects || !localPlayerId) return false;

        return Array.from(activeConsumableEffects.values()).some(
            (effect: ActiveConsumableEffect) => effect.playerId.toHexString() === localPlayerId &&
                      effect.effectType.tag === 'Entrainment'
        );
    }

    private getActiveContinuousSounds(): AmbientSoundType[] {
        const { isUnderwater = false, timeOfDay, currentSeason } = this.options;
        const sounds: AmbientSoundType[] = [];

        if (this.hasEntrainmentEffect()) {
            sounds.push('entrainment_ambient');
            return sounds;
        }

        if (isUnderwater) {
            sounds.push('underwater_ambient');
        }

        const windIntensity = this.getCurrentWindIntensity();
        if (windIntensity === 'strong') {
            sounds.push('wind_strong');
        } else if (windIntensity === 'moderate') {
            sounds.push('wind_moderate');
        } else {
            sounds.push('wind_light');
        }

        const oceanDef = AMBIENT_SOUND_DEFINITIONS.ocean_ambience;
        const oceanMaxDist = 'maxProximityDistance' in oceanDef ? oceanDef.maxProximityDistance : 800;
        const deepOceanDef = AMBIENT_SOUND_DEFINITIONS.deep_ocean_ambience;
        const deepOceanMaxDist = 'maxProximityDistance' in deepOceanDef ? deepOceanDef.maxProximityDistance : 600;
        const inDeepOcean = this.distanceToMapEdge < deepOceanMaxDist;
        if (inDeepOcean) {
            sounds.push('deep_ocean_ambience');
        } else if (this.distanceToShore < oceanMaxDist) {
            sounds.push('ocean_ambience');
        }

        const isNightTime = timeOfDay?.tag === 'Night' || timeOfDay?.tag === 'Midnight';
        const isWinter = currentSeason?.tag === 'Winter';
        if (isNightTime && !isWinter && !inDeepOcean) {
            sounds.push('night_crickets');
        }

        if (timeOfDay?.tag === 'Dawn' && !inDeepOcean) {
            sounds.push('dawn_chorus');
        }

        if (!inDeepOcean) {
            sounds.push('nature_general');
        }

        const distanceToBee = this.getDistanceToNearestBee();
        const beeDef = AMBIENT_SOUND_DEFINITIONS.bee_buzzing;
        const beeMaxDist = 'maxProximityDistance' in beeDef ? beeDef.maxProximityDistance : 350;
        if (distanceToBee < beeMaxDist && !isUnderwater && !inDeepOcean) {
            sounds.push('bee_buzzing');
        }

        return sounds;
    }

    private getProximityVolumeModifier(soundType: AmbientSoundType): number {
        const definition = AMBIENT_SOUND_DEFINITIONS[soundType];

        if ('beeProximityBased' in definition && (definition as any).beeProximityBased) {
            const distanceToBee = this.getDistanceToNearestBee();
            const maxDist = 'maxProximityDistance' in definition ? (definition as any).maxProximityDistance : 350;
            const minDist = 'minProximityDistance' in definition ? (definition as any).minProximityDistance : 50;

            if (distanceToBee <= minDist) return 1.0;
            if (distanceToBee >= maxDist) return 0.0;

            return 1.0 - ((distanceToBee - minDist) / (maxDist - minDist));
        }

        if ('mapEdgeBased' in definition && (definition as any).mapEdgeBased) {
            const maxDist = 'maxProximityDistance' in definition ? (definition as any).maxProximityDistance : 600;
            const minDist = 'minProximityDistance' in definition ? (definition as any).minProximityDistance : 80;
            if (this.distanceToMapEdge <= minDist) return 1.0;
            if (this.distanceToMapEdge >= maxDist) return 0.0;
            return 1.0 - ((this.distanceToMapEdge - minDist) / (maxDist - minDist));
        }

        if (!('proximityBased' in definition) || !definition.proximityBased) {
            return 1.0;
        }

        const maxDist = 'maxProximityDistance' in definition ? definition.maxProximityDistance : 800;
        const minDist = 'minProximityDistance' in definition ? definition.minProximityDistance : 50;
        if (this.distanceToShore <= minDist) return 1.0;
        if (this.distanceToShore >= maxDist) return 0.0;

        return 1.0 - ((this.distanceToShore - minDist) / (maxDist - minDist));
    }

    private async startContinuousSound(soundType: AmbientSoundType): Promise<void> {
        try {
            const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
            if (definition.type !== 'continuous') return;

            if (activeSeamlessLoopingSounds.has(soundType) || loadingSeamlessSounds.has(soundType)) {
                return;
            }

            loadingSeamlessSounds.add(soundType);
            const proximityModifier = this.getProximityVolumeModifier(soundType);
            const finalVolume = definition.baseVolume * this.effectiveEnvironmentalVolume * proximityModifier;
            const pitchVariation = 0.95 + Math.random() * 0.1;

            if (definition.useSeamlessLooping) {
                const success = await createSeamlessLoopingSound(soundType, definition.filename, finalVolume, pitchVariation);
                if (!success) {
                    console.warn(`Seamless looping failed for ${soundType}, using simple loop fallback`);
                    await startSimpleLoopingSound(soundType, definition.filename, finalVolume, pitchVariation);
                }
            }
        } catch (error) {
            console.warn(`Failed to start continuous ambient sound: ${soundType}`, error);
        } finally {
            loadingSeamlessSounds.delete(soundType);
        }
    }

    private async stopContinuousSound(soundType: AmbientSoundType): Promise<void> {
        if (activeSeamlessLoopingSounds.has(soundType)) {
            await cleanupSeamlessSound(soundType, "manually stopped");
        }
    }

    private scheduleRandomSound(soundType: AmbientSoundType): void {
        const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
        if (definition.type !== 'random') return;

        const scheduleNext = () => {
            const interval = definition.minInterval +
                            Math.random() * (definition.maxInterval - definition.minInterval);

            const timer = window.setTimeout(() => {
                this.playRandomSound(soundType);
                scheduleNext();
            }, interval);

            randomSoundTimers.set(soundType, timer);
        };

        scheduleNext();
    }

    private async playRandomSound(soundType: AmbientSoundType): Promise<void> {
        const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
        if (definition.type !== 'random') return;

        const { timeOfDay, chunkWeather, localPlayer } = this.options;

        if ('nightOnly' in definition && definition.nightOnly) {
            if (!timeOfDay || (timeOfDay.tag !== 'Night' && timeOfDay.tag !== 'Midnight')) {
                return;
            }
        }

        if ('dayOnly' in definition && definition.dayOnly) {
            if (!timeOfDay || (timeOfDay.tag === 'Night' || timeOfDay.tag === 'Midnight')) {
                return;
            }
        }

        if ('stormOnly' in definition && definition.stormOnly) {
            if (!chunkWeather || !localPlayer) {
                return;
            }

            const playerChunkIndex = calculateChunkIndex(localPlayer.positionX, localPlayer.positionY);
            const playerChunkData = chunkWeather.get(playerChunkIndex.toString());
            const playerWeatherTag = playerChunkData?.currentWeather?.tag || 'Clear';
            if (playerWeatherTag !== 'HeavyStorm' && playerWeatherTag !== 'HeavyRain') {
                return;
            }
        }

        try {
            if (activeRandomSounds.size >= AMBIENT_CONFIG.MAX_CONCURRENT_RANDOM) {
                return;
            }

            const deepOceanMaxDist = AMBIENT_SOUND_DEFINITIONS.deep_ocean_ambience.maxProximityDistance ?? 600;
            const inDeepOcean = this.lastDistanceToMapEdge < deepOceanMaxDist;
            const deepOceanExcludedSounds: AmbientSoundType[] = [
                'raven_caw',
                'owl_hoot',
                'wolf_howl',
                'structure_creak',
                'grass_rustle',
                'seagull_cry',
            ];
            if (inDeepOcean && (deepOceanExcludedSounds as string[]).includes(soundType)) {
                return;
            }

            if ('proximityBased' in definition && definition.proximityBased) {
                const maxDist = definition.maxProximityDistance || 800;
                if (this.distanceToShore > maxDist) {
                    return;
                }
            }

            const variation = definition.variations ? Math.floor(Math.random() * definition.variations) : 0;
            const filename = variation === 0 ? definition.filename :
                            definition.filename.replace('.mp3', `${variation + 1}.mp3`);

            let audio: HTMLAudioElement;
            try {
                audio = await ambientAudioCache.loadAudio(filename);
                if (!audio.duration || isNaN(audio.duration) || !isFinite(audio.duration) || audio.duration <= 0) {
                    console.warn(`Invalid audio duration for variant: ${filename} (duration: ${audio.duration})`);
                    return;
                }
            } catch (error) {
                console.warn(`Failed to load ambient variant: ${filename}`, error);
                return;
            }

            let proximityModifier = 1.0;
            if ('proximityBased' in definition && definition.proximityBased) {
                const maxDist = definition.maxProximityDistance || 800;
                const minDist = definition.minProximityDistance || 50;
                if (this.distanceToShore <= minDist) {
                    proximityModifier = 1.0;
                } else {
                    proximityModifier = Math.max(0, 1 - (this.distanceToShore - minDist) / (maxDist - minDist));
                }
            }

            const finalVolume = definition.baseVolume * this.effectiveEnvironmentalVolume * proximityModifier;

            audio.volume = 0;
            audio.playbackRate = 1 + (Math.random() - 0.5) * AMBIENT_CONFIG.PITCH_VARIATION;
            connectToUnderwaterFilter(audio);
            if (isCurrentlyUnderwater) {
                applyUnderwaterEffect(audio, true);
            }

            activeRandomSounds.add(audio);

            const cleanup = () => {
                activeRandomSounds.delete(audio);
                audio.removeEventListener('ended', cleanup);
                audio.removeEventListener('error', cleanup);
            };

            audio.addEventListener('ended', cleanup, { once: true });
            audio.addEventListener('error', cleanup, { once: true });

            await audio.play();
            fadeInAudio(audio, finalVolume * this.masterVolume, 800);
        } catch (error) {
            console.warn(`Failed to play random ambient sound: ${soundType}`, error);
        }
    }

    private async fadeOutAndStopSound(soundType: AmbientSoundType, fadeMs = 2000): Promise<void> {
        const seamlessSound = activeSeamlessLoopingSounds.get(soundType);
        if (!seamlessSound) return;

        const { primary, secondary } = seamlessSound;
        const activeAudio = seamlessSound.isPrimaryActive ? primary : secondary;
        const initialVolume = activeAudio.volume;
        const steps = 40;
        const stepMs = fadeMs / steps;

        for (let i = 1; i <= steps; i++) {
            await new Promise(resolve => setTimeout(resolve, stepMs));
            const newVolume = initialVolume * (1 - i / steps);
            primary.volume = Math.max(0, newVolume);
            secondary.volume = Math.max(0, newVolume);
        }

        await this.stopContinuousSound(soundType);
    }

    private syncContinuousSounds(): void {
        const targetSounds = this.getActiveContinuousSounds();
        const nextKey = targetSounds.join('|');
        if (nextKey === this.continuousSoundsKey) {
            return;
        }

        this.continuousSoundsKey = nextKey;
        if (this.continuousUpdateInFlight) {
            return;
        }

        this.continuousUpdateInFlight = true;
        this.updateContinuousSounds(targetSounds)
            .catch(error => {
                console.warn("Error updating continuous ambient sounds:", error);
            })
            .finally(() => {
                this.continuousUpdateInFlight = false;
            });
    }

    private async updateContinuousSounds(targetSounds: AmbientSoundType[]): Promise<void> {
        const currentSounds = Array.from(activeSeamlessLoopingSounds.keys());
        const soundsToStop = currentSounds.filter(soundType => !targetSounds.includes(soundType));
        const soundsToStart = targetSounds.filter(soundType => !activeSeamlessLoopingSounds.has(soundType));

        const isWindTransition = soundsToStop.some(s => s.startsWith('wind_')) &&
                                soundsToStart.some(s => s.startsWith('wind_'));
        const timeOfDaySounds = ['dawn_chorus', 'night_crickets'];
        const timeOfDaySoundsToStop = soundsToStop.filter(s => timeOfDaySounds.includes(s));
        const otherSoundsToStop = soundsToStop.filter(s => !timeOfDaySounds.includes(s) &&
                                                            !(isWindTransition && s.startsWith('wind_')));

        if (isWindTransition) {
            await Promise.all(soundsToStart.map(soundType => this.startContinuousSound(soundType)));
            setTimeout(() => {
                soundsToStop.forEach(soundType => {
                    if (soundType.startsWith('wind_')) {
                        this.stopContinuousSound(soundType);
                    }
                });
            }, 1000);
        } else {
            await Promise.all(otherSoundsToStop.map(soundType => this.stopContinuousSound(soundType)));
            await Promise.all(soundsToStart.map(soundType => this.startContinuousSound(soundType)));
        }

        timeOfDaySoundsToStop.forEach(soundType => {
            this.fadeOutAndStopSound(soundType, 3000);
        });

        this.lastWeather = this.options.weatherCondition;
    }

    private readonly runHealthCheck = (): void => {
        const targetSounds = this.getActiveContinuousSounds();

        targetSounds.forEach(soundType => {
            const seamlessSound = activeSeamlessLoopingSounds.get(soundType);
            const simpleSound = (window as any).simpleLoopingSounds?.get(soundType);

            if (!seamlessSound && !simpleSound) {
                console.warn(`Ambient health check: ${soundType} should be playing but isn't found, restarting...`);
                this.startContinuousSound(soundType).catch(error => {
                    console.warn(`Ambient health check restart failed for ${soundType}:`, error);
                });
            } else if (simpleSound && (simpleSound.paused || simpleSound.ended)) {
                console.warn(`Ambient health check: simple loop ${soundType} stopped, restarting...`);
                simpleSound.currentTime = 0;
                simpleSound.play().catch((error: Error) => {
                    console.warn(`Simple loop restart failed for ${soundType}:`, error);
                });
            }
        });
    };

    private updateVolumesIfNeeded(): void {
        const nextVolumeKey = `${this.masterVolume}|${this.effectiveEnvironmentalVolume}`;
        if (nextVolumeKey === this.volumeKey) {
            return;
        }
        this.volumeKey = nextVolumeKey;

        if (this.effectiveEnvironmentalVolume === 0) {
            activeSeamlessLoopingSounds.forEach((seamlessSound) => {
                seamlessSound.primary.volume = 0;
                seamlessSound.secondary.volume = 0;
                seamlessSound.volume = 0;
            });
            activeRandomSounds.forEach((audio) => {
                audio.volume = 0;
            });
            const simpleLoopingSounds = (window as any).simpleLoopingSounds;
            if (simpleLoopingSounds instanceof Map) {
                simpleLoopingSounds.forEach((audio: HTMLAudioElement) => {
                    audio.volume = 0;
                });
            }
            return;
        }

        activeSeamlessLoopingSounds.forEach((seamlessSound, soundType) => {
            const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
            const targetVolume = definition.baseVolume * this.effectiveEnvironmentalVolume * this.masterVolume;
            const clampedVolume = Math.max(0, Math.min(1.0, targetVolume));
            seamlessSound.primary.volume = clampedVolume;
            seamlessSound.secondary.volume = clampedVolume;
            seamlessSound.volume = clampedVolume;
        });

        activeRandomSounds.forEach((audio) => {
            let soundType: AmbientSoundType | null = null;
            for (const [type, definition] of Object.entries(AMBIENT_SOUND_DEFINITIONS)) {
                if (definition.type === 'random' && audio.src.includes(definition.filename.replace('.mp3', ''))) {
                    soundType = type as AmbientSoundType;
                    break;
                }
            }

            if (soundType) {
                const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
                const targetVolume = definition.baseVolume * this.effectiveEnvironmentalVolume * this.masterVolume;
                audio.volume = Math.max(0, Math.min(1.0, targetVolume));
            }
        });

        const simpleLoopingSounds = (window as any).simpleLoopingSounds;
        if (simpleLoopingSounds instanceof Map) {
            simpleLoopingSounds.forEach((audio: HTMLAudioElement, soundType: AmbientSoundType) => {
                const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
                const targetVolume = definition.baseVolume * this.effectiveEnvironmentalVolume * this.masterVolume;
                audio.volume = Math.max(0, Math.min(1.0, targetVolume));
            });
        }
    }

    private updateUnderwaterState(): void {
        const isUnderwater = this.options.isUnderwater ?? false;
        if (this.lastUnderwaterState !== isUnderwater) {
            this.lastUnderwaterState = isUnderwater;
            setGlobalUnderwaterState(isUnderwater);
        }
    }

    private updateIndoorState(): void {
        const isIndoors = this.options.isIndoors ?? false;
        const isUnderwater = this.options.isUnderwater ?? false;
        if (this.lastIndoorState !== isIndoors) {
            this.lastIndoorState = isIndoors;
            if (!isUnderwater) {
                setGlobalIndoorState(isIndoors);
            }
        }
    }

    private updateProximityVolumesIfNeeded(): void {
        const nextProximityKey = `${this.distanceToShore}|${this.distanceToMapEdge}|${this.effectiveEnvironmentalVolume}|${this.masterVolume}`;
        const shoreChanged = this.lastDistanceToShore !== this.distanceToShore;
        const edgeChanged = this.lastDistanceToMapEdge !== this.distanceToMapEdge;
        if (!shoreChanged && !edgeChanged && nextProximityKey === this.proximityKey) {
            return;
        }

        this.proximityKey = nextProximityKey;
        this.lastDistanceToShore = this.distanceToShore;
        this.lastDistanceToMapEdge = this.distanceToMapEdge;

        const seamlessOcean = activeSeamlessLoopingSounds.get('ocean_ambience');
        if (seamlessOcean) {
            const definition = AMBIENT_SOUND_DEFINITIONS.ocean_ambience;
            const proximityModifier = this.getProximityVolumeModifier('ocean_ambience');
            const targetVolume = definition.baseVolume * this.effectiveEnvironmentalVolume * this.masterVolume * proximityModifier;
            const clampedVolume = Math.max(0, Math.min(1.0, targetVolume));
            seamlessOcean.primary.volume = clampedVolume;
            seamlessOcean.secondary.volume = clampedVolume;
            seamlessOcean.volume = clampedVolume;
        }

        const seamlessDeepOcean = activeSeamlessLoopingSounds.get('deep_ocean_ambience');
        if (seamlessDeepOcean) {
            const definition = AMBIENT_SOUND_DEFINITIONS.deep_ocean_ambience;
            const proximityModifier = this.getProximityVolumeModifier('deep_ocean_ambience');
            const targetVolume = definition.baseVolume * this.effectiveEnvironmentalVolume * this.masterVolume * proximityModifier;
            const clampedVolume = Math.max(0, Math.min(1.0, targetVolume));
            seamlessDeepOcean.primary.volume = clampedVolume;
            seamlessDeepOcean.secondary.volume = clampedVolume;
            seamlessDeepOcean.volume = clampedVolume;
        }

        const simpleLoopingSounds = (window as any).simpleLoopingSounds;
        if (simpleLoopingSounds instanceof Map) {
            const simpleOcean = simpleLoopingSounds.get('ocean_ambience');
            if (simpleOcean) {
                const definition = AMBIENT_SOUND_DEFINITIONS.ocean_ambience;
                const proximityModifier = this.getProximityVolumeModifier('ocean_ambience');
                const targetVolume = definition.baseVolume * this.effectiveEnvironmentalVolume * this.masterVolume * proximityModifier;
                simpleOcean.volume = Math.max(0, Math.min(1.0, targetVolume));
            }
            const simpleDeepOcean = simpleLoopingSounds.get('deep_ocean_ambience');
            if (simpleDeepOcean) {
                const definition = AMBIENT_SOUND_DEFINITIONS.deep_ocean_ambience;
                const proximityModifier = this.getProximityVolumeModifier('deep_ocean_ambience');
                const targetVolume = definition.baseVolume * this.effectiveEnvironmentalVolume * this.masterVolume * proximityModifier;
                simpleDeepOcean.volume = Math.max(0, Math.min(1.0, targetVolume));
            }
        }
    }

    private updateBeeVolumeIfNeeded(): void {
        const distanceToBee = this.getDistanceToNearestBee();
        const nextBeeKey = `${distanceToBee}|${this.effectiveEnvironmentalVolume}|${this.masterVolume}`;
        if (this.lastDistanceToBee === distanceToBee && this.beeKey === nextBeeKey) {
            return;
        }

        this.lastDistanceToBee = distanceToBee;
        this.beeKey = nextBeeKey;

        const beeDef = AMBIENT_SOUND_DEFINITIONS.bee_buzzing;
        const maxDist = 'maxProximityDistance' in beeDef ? (beeDef as any).maxProximityDistance : 350;

        const seamlessSound = activeSeamlessLoopingSounds.get('bee_buzzing');
        if (seamlessSound) {
            if (distanceToBee >= maxDist) {
                seamlessSound.primary.volume = 0;
                seamlessSound.secondary.volume = 0;
                seamlessSound.volume = 0;
            } else {
                const proximityModifier = this.getProximityVolumeModifier('bee_buzzing');
                const targetVolume = beeDef.baseVolume * this.effectiveEnvironmentalVolume * this.masterVolume * proximityModifier;
                const clampedVolume = Math.max(0, Math.min(1.0, targetVolume));
                seamlessSound.primary.volume = clampedVolume;
                seamlessSound.secondary.volume = clampedVolume;
                seamlessSound.volume = clampedVolume;
            }
        }

        const simpleLoopingSounds = (window as any).simpleLoopingSounds;
        if (simpleLoopingSounds instanceof Map) {
            const simpleBee = simpleLoopingSounds.get('bee_buzzing');
            if (simpleBee) {
                if (distanceToBee >= maxDist) {
                    simpleBee.volume = 0;
                } else {
                    const proximityModifier = this.getProximityVolumeModifier('bee_buzzing');
                    const targetVolume = beeDef.baseVolume * this.effectiveEnvironmentalVolume * this.masterVolume * proximityModifier;
                    simpleBee.volume = Math.max(0, Math.min(1.0, targetVolume));
                }
            }
        }
    }
}
