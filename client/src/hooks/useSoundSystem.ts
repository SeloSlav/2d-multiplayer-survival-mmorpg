import { useEffect, useRef, useCallback } from 'react';
import * as SpacetimeDB from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';

interface SoundSystemProps {
    soundEvents: Map<string, SpacetimeDB.SoundEvent>;
    localPlayerPosition: { x: number; y: number } | null;
    localPlayerIdentity: Identity | null;
    masterVolume?: number; // 0-1 scale
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
    tree_chop: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.8, maxDistance: 400 },
    tree_creaking: { strategy: SoundStrategy.SERVER_ONLY, volume: 3.0, maxDistance: 700 }, // Much louder for dramatic effect
    tree_falling: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.5, maxDistance: 900 },  // Loudest, longest range
    stone_hit: { strategy: SoundStrategy.SERVER_ONLY, volume: 0.8, maxDistance: 400 },
    stone_destroyed: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.3, maxDistance: 800 }, // Loud stone destruction sound
    harvest_plant: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.5, maxDistance: 350 }, // Pleasant plant harvesting sound
    plant_seed: { strategy: SoundStrategy.SERVER_ONLY, volume: 5.4, maxDistance: 300 }, // Much louder planting seed sound (3x increase)
    item_pickup: { strategy: SoundStrategy.SERVER_ONLY, volume: 1.0, maxDistance: 400 }, // Item pickup sound
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
    // Audio variation settings for dynamic feel
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
        
        console.log(`🔊 Loud sound via Web Audio: ${filename} (vol: ${volume.toFixed(2)}, pitch: ${pitchVariation.toFixed(2)})`);
        
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

// Preload common sounds
const PRELOAD_SOUNDS = [
    'tree_chop.ogg', 'tree_chop1.ogg', 'tree_chop2.ogg',  // 3 tree chop variations
    'tree_creaking.ogg',                                   // 1 tree creaking variation
    'tree_falling.ogg',                                    // 1 tree falling variation
    'stone_hit.ogg', 'stone_hit1.ogg', 'stone_hit2.ogg',   // 3 stone hit variations
    'stone_destroyed.ogg',                                 // 1 stone destroyed variation
    'harvest_plant.ogg',                                   // 1 plant harvest variation
    'plant_seed.ogg',                                      // 1 plant seed variation
    'item_pickup.ogg',                                              // 1 item pickup variation
];

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
            console.log(`🔊 Audio loaded: ${filename}`);
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
    
    console.log(`🔊 Requesting audio file: ${filename}`);
    
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
            console.log(`🔊 Added sound to active set. Count: ${activeSounds.size}`);
            
            // Cleanup when finished
            const cleanup = () => {
                activeSounds.delete(audioClone);
                console.log(`🔊 Removed sound from active set. Count: ${activeSounds.size}`);
                audioClone.removeEventListener('ended', cleanup);
                audioClone.removeEventListener('error', cleanup);
            };
            
            audioClone.addEventListener('ended', cleanup, { once: true });
            audioClone.addEventListener('error', cleanup, { once: true });
            
            await audioClone.play();
            console.log(`🔊 Playing: ${filename} (dist: ${distance.toFixed(1)}, vol: ${finalVolume.toFixed(2)}, pitch: ${pitchVariation.toFixed(2)})`);
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
        let filename = `${soundType}.ogg`;
        if (variation !== undefined) {
            filename = variation === 0 ? `${soundType}.ogg` : `${soundType}${variation}.ogg`;
        } else {
            // Random variation for variety - different counts per sound type
            let variationCount = 4; // Default for most sounds
            if (soundType === 'tree_chop') {
                variationCount = 3; // tree_chop.ogg, tree_chop1.ogg, tree_chop2.ogg
            } else if (soundType === 'tree_creaking' || soundType === 'tree_falling' || soundType === 'stone_destroyed') {
                variationCount = 1; // Single variation sounds
            } else if (soundType === 'stone_hit') {
                variationCount = 3; // stone_hit.ogg, stone_hit1.ogg, stone_hit2.ogg
            } else if (soundType === 'harvest_plant') {
                variationCount = 1; // harvest_plant.ogg
            } else if (soundType === 'plant_seed') {
                variationCount = 1; // plant_seed.ogg
            } else if (soundType === 'item_pickup') {
                variationCount = 1; // item_pickup.ogg
            }
            
            const randomVariation = Math.floor(Math.random() * variationCount);
            if (randomVariation === 0) {
                filename = `${soundType}.ogg`;
            } else {
                filename = `${soundType}${randomVariation}.ogg`;
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
            console.log(`🔊 Added local sound to active set. Count: ${activeSounds.size}`);
            const cleanup = () => {
                activeSounds.delete(audioClone);
                console.log(`🔊 Removed local sound from active set. Count: ${activeSounds.size}`);
                audioClone.removeEventListener('ended', cleanup);
                audioClone.removeEventListener('error', cleanup);
            };
            
            audioClone.addEventListener('ended', cleanup, { once: true });
            audioClone.addEventListener('error', cleanup, { once: true });
            
            await audioClone.play();
            console.log(`🔊 Local sound: ${filename} (vol: ${finalVolume.toFixed(2)}, pitch: ${pitchVariation.toFixed(2)})`);
        }
        
    } catch (error) {
        console.warn(`🔊 Local sound error for ${soundType}:`, error);
    }
};

// Public API for playing sounds immediately (for local actions)
export const playImmediateSound = (soundType: SoundType, volume: number = 1): void => {
    playLocalSound(soundType, volume).catch(console.warn);
};

// Main sound system hook
export const useSoundSystem = ({ 
    soundEvents, 
    localPlayerPosition, 
    localPlayerIdentity,
    masterVolume = 1 
}: SoundSystemProps) => {
    const processedSoundEventsRef = useRef<Set<string>>(new Set());
    const isInitializedRef = useRef(false);
    
    // Preload sounds on first mount
    useEffect(() => {
        if (isInitializedRef.current) return;
        isInitializedRef.current = true;
        
        const preloadAll = async () => {
            console.log('🔊 Preloading common sounds...');
            const promises = PRELOAD_SOUNDS.map(filename => 
                loadAudio(filename).catch(err => console.warn(`Preload failed: ${filename}`, err))
            );
            await Promise.allSettled(promises);
            console.log('🔊 Sound system initialized');
        };
        
        preloadAll();
    }, []);
    
    // Process server sound events (for other players' actions)
    useEffect(() => {
        if (!localPlayerPosition || !localPlayerIdentity) return;
        
        soundEvents.forEach((soundEvent, eventId) => {
            // Skip if already processed
            if (processedSoundEventsRef.current.has(eventId)) return;
            
            // Mark as processed
            processedSoundEventsRef.current.add(eventId);
            
            // Skip our own sounds if they use PREDICT_CONFIRM strategy
            const soundType = soundEvent.filename.replace(/\d*\.mp3$/, '') as SoundType;
            const definition = SOUND_DEFINITIONS[soundType];
            
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
            
            console.log(`🔊 Server sound: ${soundEvent.filename} from ${soundEvent.triggeredBy.toHexString().slice(0, 8)}`);
        });
        
        // Cleanup old processed events
        if (processedSoundEventsRef.current.size > 100) {
            const eventsArray = Array.from(processedSoundEventsRef.current);
            processedSoundEventsRef.current = new Set(eventsArray.slice(-50));
        }
        
    }, [soundEvents, localPlayerPosition, localPlayerIdentity, masterVolume]);
    
    // Cleanup on unmount
    useEffect(() => {
        return () => {
            processedSoundEventsRef.current.clear();
            activeSounds.forEach(audio => {
                audio.pause();
                audio.currentTime = 0;
            });
            activeSounds.clear();
        };
    }, []);
    
    // Public API
    const playSound = useCallback((soundType: SoundType, volume: number = 1) => {
        playLocalSound(soundType, volume);
    }, []);
    
    return {
        playSound,
        isAudioSupported: typeof Audio !== 'undefined',
        cachedSoundsCount: audioCache['cache'].size,
        activeSoundsCount: activeSounds.size,
        soundDefinitions: SOUND_DEFINITIONS,
    };
}; 