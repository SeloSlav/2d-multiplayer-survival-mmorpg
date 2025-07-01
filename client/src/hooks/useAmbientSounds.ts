import { useEffect, useRef, useCallback } from 'react';
import { TimeOfDay, WeatherType } from '../generated'; // Import actual types

/**
 * ⚠️ WARNING: This ambient sound system is NOW INTEGRATED into the game!
 * 
 * Features:
 * 1. Uses seamless looping with overlapping audio instances (like main sound system)
 * 2. Integrated into GameCanvas with actual WorldState data
 * 3. Controlled by environmentalVolume in GameSettingsMenu
 * 4. Professional audio caching and performance optimization
 */

interface AmbientSoundProps {
    masterVolume?: number;
    environmentalVolume?: number;
    timeOfDay?: TimeOfDay; // Use actual server TimeOfDay type
    weatherCondition?: WeatherType; // Use actual server WeatherType
}

// Ambient sound definitions for Aleutian island atmosphere
const AMBIENT_SOUND_DEFINITIONS = {
    // === CONTINUOUS/LOOPING AMBIENCE ===
    wind_light: { 
        type: 'continuous', 
        filename: 'ambient_wind_light.mp3', 
        baseVolume: 0.15, // Reduced from 0.4 for ambient feel
        isLooping: true,
        useSeamlessLooping: true,
        description: 'Gentle constant wind through grass and trees'
    },
    wind_moderate: { 
        type: 'continuous', 
        filename: 'ambient_wind_moderate.mp3', 
        baseVolume: 0.25, // Reduced from 0.6 for ambient feel
        isLooping: true,
        useSeamlessLooping: true,
        description: 'Moderate wind with occasional gusts'
    },
    wind_strong: { 
        type: 'continuous', 
        filename: 'ambient_wind_strong.mp3', 
        baseVolume: 0.35, // Reduced from 0.8 for ambient feel
        isLooping: true,
        useSeamlessLooping: true,
        description: 'Strong persistent wind for harsh weather'
    },
    ocean_ambience: { 
        type: 'continuous', 
        filename: 'ambient_ocean.mp3', 
        baseVolume: 0.04, // Reduced from 0.3 for subtle background
        isLooping: true,
        useSeamlessLooping: true,
        description: 'General ocean waves and surf for island atmosphere'
    },
    nature_general: { 
        type: 'continuous', 
        filename: 'ambient_nature_general.mp3', 
        baseVolume: 0.08, // Reduced from 0.25 for very subtle ambience
        isLooping: true,
        useSeamlessLooping: true,
        description: 'General nature ambience - insects, rustling'
    },
    
    // === RANDOM/PERIODIC AMBIENCE ===
    seagull_cry: { 
        type: 'random', 
        filename: 'ambient_seagull_cry.mp3', 
        baseVolume: 0.125, // Halved from 0.25 for more subtle ambient feel
        minInterval: 15000, // 15 seconds minimum
        maxInterval: 45000, // 45 seconds maximum
        variations: 3, // seagull_cry1.mp3, seagull_cry2.mp3, etc.
        description: 'Seagulls crying in the distance'
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
        baseVolume: 0.075, // Halved from 0.15 for very distant atmospheric feel
        minInterval: 120000, // 2 minutes minimum
        maxInterval: 300000, // 5 minutes maximum
        variations: 3,
        description: 'Very distant thunder for atmosphere'
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
        baseVolume: 0.08, // Slightly louder since it's rare and atmospheric
        minInterval: 480000, // 8 minutes minimum - rare and special
        maxInterval: 900000, // 15 minutes maximum - creates anticipation
        variations: 3,
        description: 'Distant whale songs echoing across the Aleutian waters'
    }
} as const;

type AmbientSoundType = keyof typeof AMBIENT_SOUND_DEFINITIONS;

// Ambient sound configuration
const AMBIENT_CONFIG = {
    SOUNDS_BASE_PATH: '/sounds/ambient/',
    PITCH_VARIATION: 0.15, // ±7.5% pitch variation for natural feel
    VOLUME_VARIATION: 0.1, // ±5% volume variation
    FADE_DURATION: 3000, // 3 second fade in/out for continuous sounds (increased for reliability)
    MAX_CONCURRENT_RANDOM: 3, // Maximum random sounds playing at once
    OVERLAP_PERCENTAGE: 0.15, // 15% overlap for more reliable seamless looping (increased from 10%)
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
            const cloned = audio.cloneNode() as HTMLAudioElement;
            console.log(`🌊 [CACHE HIT] ${filename} from cache (duration: ${audio.duration})`);
            return cloned;
        }
        
        try {
            // Load and cache
            const fullPath = AMBIENT_CONFIG.SOUNDS_BASE_PATH + filename;
            console.log(`🌊 [LOADING] Attempting to load: ${fullPath}`);
            
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
                    console.log(`🌊 [METADATA LOADED] ${filename} - duration: ${audio!.duration}s`);
                    resolve(null);
                }, { once: true });
                
                audio!.addEventListener('error', (e) => {
                    clearTimeout(loadTimeout);
                    console.error(`🌊 [LOAD ERROR] Failed to load ${filename}:`, e);
                    reject(new Error(`Failed to load audio: ${filename} - ${e}`));
                }, { once: true });
                
                // Also listen for canplaythrough as backup
                audio!.addEventListener('canplaythrough', () => {
                    clearTimeout(loadTimeout);
                    console.log(`🌊 [CAN PLAY] ${filename} ready to play`);
                    resolve(null);
                }, { once: true });
                
                audio!.load();
            });
            
            this.set(filename, audio);
            const cloned = audio.cloneNode() as HTMLAudioElement;
            console.log(`🌊 [CACHED] ${filename} stored in cache and cloned`);
            return cloned;
        } catch (error) {
            console.warn(`🌊 [FALLBACK] Failed to load ${filename}, using silent fallback:`, error);
            // Return silent fallback
            const silentAudio = new Audio();
            this.set(filename, silentAudio);
            return silentAudio;
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

// Global update loop safety net - ensures update loop never permanently dies
let globalUpdateIntervalId: number | undefined;
let lastUpdateLoopActivity = 0;

const ensureUpdateLoopIsRunning = () => {
    // Clear any existing global interval
    if (globalUpdateIntervalId) {
        window.clearInterval(globalUpdateIntervalId);
    }
    
    // Start new global interval as backup
    globalUpdateIntervalId = window.setInterval(() => {
        const now = Date.now();
        const timeSinceLastUpdate = now - lastUpdateLoopActivity;
        
        // If the main update loop hasn't run in over 5 seconds, and we have seamless sounds, restart it
        if (timeSinceLastUpdate > 5000 && activeSeamlessLoopingSounds.size > 0) {
            console.warn(`🌊 ⚠️ SAFETY NET: Main update loop inactive for ${(timeSinceLastUpdate/1000).toFixed(1)}s with ${activeSeamlessLoopingSounds.size} sounds. Restarting...`);
            updateSeamlessLoopingSounds(); // Call manually
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
    const volumeStep = targetVolume / steps;
    
    let currentStep = 0;
    const fadeInterval = setInterval(() => {
        currentStep++;
        audio.volume = Math.min(targetVolume, volumeStep * currentStep);
        
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
        console.log(`🌊 Creating seamless ambient sound: ${soundType} (${filename})`);
        
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
        console.log(`🌊 Audio duration confirmed: ${duration}s for ${filename}`);
        
        if (duration <= 0) {
            console.error(`🌊 Invalid audio duration ${duration}s for ${filename}, aborting seamless loop`);
            return false;
        }
        
        // Configure both instances
        [audio1, audio2].forEach(audio => {
            audio.loop = false; // We'll handle looping manually
            audio.volume = 0; // Start at 0 for fade-in
            audio.playbackRate = pitchVariation;
        });
        
        const overlapTime = Math.min(2, duration * AMBIENT_CONFIG.OVERLAP_PERCENTAGE); // 15% overlap, max 2 seconds
        const nextSwapTime = Date.now() + (duration - overlapTime) * 1000;
        
        console.log(`🌊 Seamless loop timing: duration=${duration}s, overlap=${overlapTime}s, first swap in ${((nextSwapTime - Date.now()) / 1000).toFixed(1)}s`);
        
        // Store the seamless sound configuration
        activeSeamlessLoopingSounds.set(soundType, {
            primary: audio1,
            secondary: audio2,
            isPrimaryActive: true,
            nextSwapTime,
            volume,
            pitchVariation
        });
        
        console.log(`🌊 Added ${soundType} to activeSeamlessLoopingSounds map. Map size: ${activeSeamlessLoopingSounds.size}`);
        console.log(`🌊 Current seamless sounds: [${Array.from(activeSeamlessLoopingSounds.keys()).join(', ')}]`);
        
        // Start with primary audio and fade in smoothly
        try {
            await audio1.play();
            fadeInAudio(audio1, volume, AMBIENT_CONFIG.FADE_DURATION); // Smooth 3-second fade-in
            console.log(`🌊 ✅ Successfully started seamless ambient sound: ${soundType} (duration: ${duration}s, next swap in: ${((nextSwapTime - Date.now()) / 1000).toFixed(1)}s)`);
        } catch (playError) {
            console.warn(`🌊 Failed to play initial audio for ${soundType}, trying again:`, playError);
            // Retry once
            setTimeout(async () => {
                try {
                    audio1.currentTime = 0;
                    await audio1.play();
                    fadeInAudio(audio1, volume, AMBIENT_CONFIG.FADE_DURATION);
                    console.log(`🌊 ✅ Retry successful for ${soundType}`);
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

// Enhanced cleanup function for seamless sounds
const cleanupSeamlessSound = async (soundType: AmbientSoundType, reason: string = "cleanup") => {
    const seamlessSound = activeSeamlessLoopingSounds.get(soundType);
    loadingSeamlessSounds.delete(soundType); // Clear loading state
    
    if (seamlessSound) {
        console.log(`🌊 Cleaning up seamless ambient sound for ${soundType} (${reason})`);
        
        // Mark both audio instances as being cleaned to prevent interference
        (seamlessSound.primary as any)._isBeingCleaned = true;
        (seamlessSound.secondary as any)._isBeingCleaned = true;
        
        try {
            // Stop both audio instances immediately without fade for cleanup
            [seamlessSound.primary, seamlessSound.secondary].forEach(audio => {
                try {
                    audio.pause();
                    audio.currentTime = 0;
                    audio.src = '';
                    audio.load();
                } catch (e) {
                    // Ignore cleanup errors
                }
            });
            
        } catch (e) {
            if (e instanceof Error && !e.message.includes('load') && !e.message.includes('src')) {
                console.warn(`🌊 Unexpected error during seamless ambient audio cleanup for ${soundType}:`, e);
            }
        }
        activeSeamlessLoopingSounds.delete(soundType);
        console.log(`🌊 ✅ Cleaned up seamless ambient sound for ${soundType} (${reason}). Map size now: ${activeSeamlessLoopingSounds.size}`);
        console.log(`🌊 Remaining seamless sounds: [${Array.from(activeSeamlessLoopingSounds.keys()).join(', ') || 'none'}]`);
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
        console.log(`🌊 [${new Date().toLocaleTimeString()}] 🔄 Update loop #${updateLoopCallCount}: Monitoring ${activeCount} seamless sounds`);
        
        if (activeCount > 0) {
            activeSeamlessLoopingSounds.forEach((seamlessSound, soundType) => {
                const timeUntilSwap = (seamlessSound.nextSwapTime - now) / 1000;
                const activeAudio = seamlessSound.isPrimaryActive ? seamlessSound.primary : seamlessSound.secondary;
                const isPlaying = !activeAudio.paused && !activeAudio.ended;
                console.log(`   - ${soundType}: swap in ${timeUntilSwap.toFixed(1)}s (${seamlessSound.isPrimaryActive ? 'primary' : 'secondary'} active, playing: ${isPlaying})`);
            });
        } else {
            console.log(`   - ❌ No seamless sounds found in map! This means sounds will stop after first loop.`);
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
            
            console.log(`🌊 Starting seamless swap for ${soundType} at ${now} (scheduled: ${nextSwapTime})`);
            
            try {
                // Check if current audio is still playing - if not, restart it
                if (currentAudio.paused || currentAudio.ended) {
                    console.warn(`🌊 Current audio stopped unexpectedly for ${soundType}, restarting...`);
                    currentAudio.currentTime = 0;
                    currentAudio.volume = volume;
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
                    console.log(`🌊 Next audio started for ${soundType}, beginning crossfade`);
                    
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
                            currentAudio.volume = Math.max(0, volume * (1 - progress));
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
                                
                                console.log(`🌊 ✅ Seamless swap completed for ${soundType}: ${isPrimaryActive ? 'primary→secondary' : 'secondary→primary'}, next swap in ${((seamlessSound.nextSwapTime - Date.now()) / 1000).toFixed(1)}s`);
                            }
                        }
                    }, stepTime);
                    
                }).catch(error => {
                    console.warn(`🌊 Failed to start next audio for ${soundType}:`, error);
                    // Fallback: keep current audio playing and reschedule
                    const duration = currentAudio.duration || 10;
                    const overlapTime = Math.min(2, duration * AMBIENT_CONFIG.OVERLAP_PERCENTAGE);
                    seamlessSound.nextSwapTime = now + (duration - overlapTime) * 1000;
                    console.log(`🌊 Rescheduled ${soundType} swap in ${((seamlessSound.nextSwapTime - now) / 1000).toFixed(1)}s due to play error`);
                });
                
            } catch (error) {
                console.warn(`🌊 Error during seamless ambient swap for ${soundType}:`, error);
                // Fallback recovery: restart the current audio
                try {
                    const currentAudio = isPrimaryActive ? primary : secondary;
                    currentAudio.currentTime = 0;
                    currentAudio.volume = volume;
                    currentAudio.play().catch(e => console.warn(`🌊 Recovery play failed: ${e}`));
                    
                    // Reschedule further out
                    const duration = currentAudio.duration || 10;
                    seamlessSound.nextSwapTime = now + duration * 1000;
                    console.log(`🌊 Recovery: rescheduled ${soundType} in ${duration}s`);
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
                    activeAudio.volume = volume;
                    activeAudio.play().then(() => {
                        console.log(`🌊 ✅ Health check restart successful for ${soundType}`);
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
                            backupAudio.volume = volume;
                            backupAudio.play().then(() => {
                                seamlessSound.isPrimaryActive = !isPrimaryActive;
                                console.log(`🌊 ✅ Health check switched to backup audio for ${soundType}`);
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
        
        // Store in a simple map for simple looping sounds
        (window as any).simpleLoopingSounds = (window as any).simpleLoopingSounds || new Map();
        (window as any).simpleLoopingSounds.set(soundType, audio);
        
        // Start playing and fade in
        await audio.play();
        fadeInAudio(audio, volume, AMBIENT_CONFIG.FADE_DURATION);
        
        console.log(`🌊 ✅ Started simple loop fallback for ${soundType}`);
        return true;
    } catch (error) {
        console.warn(`🌊 ❌ Simple loop fallback failed for ${soundType}:`, error);
        return false;
    }
};

// Main ambient sound system hook
export const useAmbientSounds = ({
    masterVolume = 1.0,
    environmentalVolume = 0.7,
    timeOfDay, // No default - will be passed from actual game data
    weatherCondition, // No default - will be passed from actual game data
}: AmbientSoundProps = {}) => {
    const isInitializedRef = useRef(false);
    const lastWeatherRef = useRef(weatherCondition);
    const updateIntervalRef = useRef<number | undefined>(undefined);

    // Calculate which continuous sounds should be playing
    const getActiveContinuousSounds = useCallback((): AmbientSoundType[] => {
        const sounds: AmbientSoundType[] = [];
        
        // Always have some wind based on weather
        if (weatherCondition?.tag === 'HeavyRain' || weatherCondition?.tag === 'HeavyStorm') {
            sounds.push('wind_strong'); // Heavy weather = strong wind
        } else if (weatherCondition?.tag === 'LightRain' || weatherCondition?.tag === 'ModerateRain') {
            sounds.push('wind_moderate'); // Light/moderate rain = moderate wind
        } else {
            sounds.push('wind_light'); // Clear weather = light wind
        }
        
        // Ocean sounds (always present for island atmosphere)
        sounds.push('ocean_ambience');
        
        // General nature ambience (always present but quiet)
        sounds.push('nature_general');
        
        return sounds;
    }, [weatherCondition]);

    // Start a seamless continuous ambient sound
    const startContinuousSound = useCallback(async (soundType: AmbientSoundType) => {
        try {
            const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
            if (definition.type !== 'continuous') return;

            // Check if already playing or loading
            if (activeSeamlessLoopingSounds.has(soundType) || loadingSeamlessSounds.has(soundType)) {
                console.log(`🌊 ${soundType} already playing or loading, skipping start`);
                return;
            }

            console.log(`🌊 Starting continuous ambient sound: ${soundType}`);
            loadingSeamlessSounds.add(soundType);

            const finalVolume = definition.baseVolume * environmentalVolume;
            const pitchVariation = 0.95 + Math.random() * 0.1; // Tighter pitch range for seamless sounds
            
            if (definition.useSeamlessLooping) {
                const success = await createSeamlessLoopingSound(soundType, definition.filename, finalVolume, pitchVariation);
                if (success) {
                    console.log(`🌊 ✅ Started seamless ambient sound: ${soundType} (${definition.description})`);
                } else {
                    console.warn(`🌊 ❌ Seamless looping failed for ${soundType}, using simple loop fallback`);
                    // Fallback to simple looping
                    await startSimpleLoopingSound(soundType, definition.filename, finalVolume, pitchVariation);
                }
            }
            
        } catch (error) {
            console.warn(`🌊 ❌ Failed to start continuous ambient sound: ${soundType}`, error);
        } finally {
            loadingSeamlessSounds.delete(soundType);
        }
    }, [environmentalVolume]);

    // Stop a continuous ambient sound
    const stopContinuousSound = useCallback(async (soundType: AmbientSoundType) => {
        if (activeSeamlessLoopingSounds.has(soundType)) {
            await cleanupSeamlessSound(soundType, "manually stopped");
        }
    }, []);

    // Schedule a random ambient sound
    const scheduleRandomSound = useCallback((soundType: AmbientSoundType) => {
        const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
        if (definition.type !== 'random') return;

        // Check time of day restrictions (fix nightOnly check)
        if ('nightOnly' in definition && definition.nightOnly) {
            // Only play night sounds during actual night times
            if (!timeOfDay || (timeOfDay.tag !== 'Night' && timeOfDay.tag !== 'Midnight')) {
                return;
            }
        }

        const playRandomSound = async () => {
            try {
                // Limit concurrent random sounds
                if (activeRandomSounds.size >= AMBIENT_CONFIG.MAX_CONCURRENT_RANDOM) {
                    return;
                }

                // Choose random variation
                const variation = definition.variations ? Math.floor(Math.random() * definition.variations) : 0;
                const filename = variation === 0 ? definition.filename : 
                                definition.filename.replace('.mp3', `${variation + 1}.mp3`);

                // Enhanced logging to verify variant selection
                console.log(`🌊 [VARIANT CHECK] ${soundType}:`);
                console.log(`   - Total variants: ${definition.variations || 1}`);
                console.log(`   - Selected variation index: ${variation}`);
                console.log(`   - Base filename: ${definition.filename}`);
                console.log(`   - Final filename: ${filename}`);
                console.log(`   - Expected variants: ${Array.from({length: definition.variations || 1}, (_, i) => 
                    i === 0 ? definition.filename : definition.filename.replace('.mp3', `${i + 1}.mp3`)
                ).join(', ')}`);

                const audio = await ambientAudioCache.loadAudio(filename);
                const finalVolume = definition.baseVolume * environmentalVolume;
                
                // Wait a moment for audio metadata to load before checking duration
                await new Promise(resolve => setTimeout(resolve, 200));
                
                // Verify the audio actually loaded (duration > 0 means it exists)
                if (audio.duration === 0 || isNaN(audio.duration) || !isFinite(audio.duration)) {
                    console.warn(`🌊 ⚠️ [VARIANT ERROR] Failed to load variant: ${filename}`);
                    console.warn(`   - Full path attempted: ${AMBIENT_CONFIG.SOUNDS_BASE_PATH}${filename}`);
                    console.warn(`   - Audio duration: ${audio.duration}`);
                    console.warn(`   - Audio readyState: ${audio.readyState}`);
                    console.warn(`   - Audio networkState: ${audio.networkState}`);
                    
                    // Try to trigger loading
                    audio.load();
                    return; // Skip playing this variant
                } else {
                    console.log(`🌊 ✅ [VARIANT SUCCESS] Successfully loaded: ${filename} (${audio.duration.toFixed(2)}s)`);
                }
                
                // Start at 0 volume for fade-in
                audio.volume = 0;
                audio.playbackRate = 1 + (Math.random() - 0.5) * AMBIENT_CONFIG.PITCH_VARIATION;

                activeRandomSounds.add(audio);

                // Cleanup when finished
                const cleanup = () => {
                    activeRandomSounds.delete(audio);
                    audio.removeEventListener('ended', cleanup);
                    audio.removeEventListener('error', cleanup);
                };

                audio.addEventListener('ended', cleanup, { once: true });
                audio.addEventListener('error', cleanup, { once: true });

                await audio.play();
                
                // Smooth fade-in for ambient random sounds (shorter duration than continuous)
                fadeInAudio(audio, finalVolume * masterVolume, 800); // 800ms fade-in for random sounds
                
                console.log(`🌊 Played random ambient: ${soundType} (${definition.description}) with fade-in`);
            } catch (error) {
                console.warn(`🌊 Failed to play random ambient sound: ${soundType}`, error);
            }
        };

        // Schedule next occurrence
        const scheduleNext = () => {
            const interval = definition.minInterval + 
                            Math.random() * (definition.maxInterval - definition.minInterval);
            
            const timer = window.setTimeout(() => {
                playRandomSound();
                scheduleNext(); // Reschedule
            }, interval);
            
            randomSoundTimers.set(soundType, timer);
        };

        scheduleNext();
    }, [masterVolume, environmentalVolume, timeOfDay]);

    // Initialize ambient sound system - ALWAYS ensure update loop is running
    useEffect(() => {
        console.log('🌊 Initializing/Reinitializing Aleutian Island ambient sound system...');

        // Clear any existing interval first (in case of hot reload)
        if (updateIntervalRef.current) {
            console.log(`🌊 Clearing existing update interval ${updateIntervalRef.current}`);
            window.clearInterval(updateIntervalRef.current);
            updateIntervalRef.current = undefined;
        }

        // Only set up random sounds once globally to avoid duplicates
        if (!isInitializedRef.current) {
            isInitializedRef.current = true;
            console.log('🌊 Setting up random sound schedules (first time only)...');
            
            // Start all random sound schedules
            Object.keys(AMBIENT_SOUND_DEFINITIONS).forEach(soundType => {
                const definition = AMBIENT_SOUND_DEFINITIONS[soundType as AmbientSoundType];
                if (definition.type === 'random') {
                    scheduleRandomSound(soundType as AmbientSoundType);
                }
            });
        }

        // ALWAYS start/restart the seamless sound update loop (critical for hot reload)
        const startUpdateLoop = () => {
            updateIntervalRef.current = window.setInterval(() => {
                updateSeamlessLoopingSounds();
            }, 50); // Update every 50ms
            
            console.log(`🌊 ✅ Started seamless sound update loop with interval ID: ${updateIntervalRef.current}`);
            
            // Immediate verification that the interval is working
            setTimeout(() => {
                const isStillActive = updateIntervalRef.current !== undefined;
                const mapSize = activeSeamlessLoopingSounds.size;
                console.log(`🌊 [VERIFICATION] Update loop active: ${isStillActive}, seamless sounds: ${mapSize}, interval ID: ${updateIntervalRef.current}`);
                
                if (mapSize > 0 && !isStillActive) {
                    console.error('🌊 ❌ CRITICAL: Have seamless sounds but no update loop! This will cause sounds to stop after first loop.');
                }
            }, 2000); // Check after 2 seconds
        };

        startUpdateLoop();
        
        // Activate global safety net to prevent update loop from ever dying permanently
        ensureUpdateLoopIsRunning();
        console.log(`🌊 🛡️ Global safety net activated to monitor update loop health`);

        return () => {
            // Cleanup on unmount/hot reload
            if (updateIntervalRef.current) {
                console.log(`🌊 Cleaning up update interval ${updateIntervalRef.current} on unmount/hot reload`);
                window.clearInterval(updateIntervalRef.current);
                updateIntervalRef.current = undefined;
            }
            
            // Clean up global safety net
            if (globalUpdateIntervalId) {
                console.log(`🌊 Cleaning up global safety net interval ${globalUpdateIntervalId}`);
                window.clearInterval(globalUpdateIntervalId);
                globalUpdateIntervalId = undefined;
            }
            
            // Only clean up random sounds on actual unmount, not hot reload
            if (isInitializedRef.current) {
                randomSoundTimers.forEach(timer => window.clearTimeout(timer));
                randomSoundTimers.clear();
            }
            
            // Fire-and-forget cleanup of seamless sounds on unmount
            activeSeamlessLoopingSounds.forEach((_, soundType) => {
                cleanupSeamlessSound(soundType, "component unmount").catch((err: Error) => 
                    console.warn(`🌊 Error during cleanup on unmount: ${err}`)
                );
            });
            
            // Cleanup simple looping sounds
            const simpleLoopingSounds = (window as any).simpleLoopingSounds;
            if (simpleLoopingSounds) {
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
            
            console.log(`🌊 Ambient sound system cleanup completed`);
        };
    }, []); // No dependencies - always restart the update loop

    // Manage continuous sounds based on environment
    useEffect(() => {
        const updateContinuousSounds = async () => {
            const targetSounds = getActiveContinuousSounds();
            const currentSounds = Array.from(activeSeamlessLoopingSounds.keys());

            // Stop sounds that should no longer be playing (with fade-out)
            const stopPromises = currentSounds
                .filter(soundType => !targetSounds.includes(soundType))
                .map(soundType => stopContinuousSound(soundType));
            
            await Promise.all(stopPromises);

            // Start sounds that should be playing (with fade-in)
            const startPromises = targetSounds
                .filter(soundType => !activeSeamlessLoopingSounds.has(soundType))
                .map(soundType => startContinuousSound(soundType));
            
            await Promise.all(startPromises);

            // Update references
            lastWeatherRef.current = weatherCondition;
        };

        // Call the async function
        updateContinuousSounds().catch(error => {
            console.warn("🌊 Error updating continuous ambient sounds:", error);
        });

    }, [weatherCondition, getActiveContinuousSounds, startContinuousSound, stopContinuousSound]);

    // Add periodic health check for continuous sounds
    useEffect(() => {
        const healthCheckInterval = setInterval(() => {
            const targetSounds = getActiveContinuousSounds();
            
            targetSounds.forEach(soundType => {
                const seamlessSound = activeSeamlessLoopingSounds.get(soundType);
                const simpleSound = (window as any).simpleLoopingSounds?.get(soundType);
                
                if (!seamlessSound && !simpleSound) {
                    // Sound should be playing but isn't - restart it
                    console.warn(`🌊 Health check: ${soundType} should be playing but isn't found, restarting...`);
                    startContinuousSound(soundType).catch(error => {
                        console.warn(`🌊 Health check restart failed for ${soundType}:`, error);
                    });
                } else if (simpleSound && (simpleSound.paused || simpleSound.ended)) {
                    // Simple loop stopped, restart it
                    console.warn(`🌊 Health check: Simple loop ${soundType} stopped, restarting...`);
                    simpleSound.currentTime = 0;
                    simpleSound.play().catch((error: Error) => {
                        console.warn(`🌊 Simple loop restart failed for ${soundType}:`, error);
                    });
                }
            });
        }, 5000); // Check every 5 seconds

        return () => clearInterval(healthCheckInterval);
    }, [getActiveContinuousSounds, startContinuousSound]);

    // Update volumes when master/environmental volume changes
    useEffect(() => {
        activeSeamlessLoopingSounds.forEach((seamlessSound, soundType) => {
            const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
            const targetVolume = definition.baseVolume * environmentalVolume * masterVolume;
            
            // Update volume for both audio instances
            seamlessSound.primary.volume = Math.min(1.0, targetVolume);
            seamlessSound.secondary.volume = Math.min(1.0, targetVolume);
            seamlessSound.volume = targetVolume;
        });
    }, [masterVolume, environmentalVolume]);

    // Public API
    const playManualAmbientSound = useCallback((soundType: AmbientSoundType) => {
        const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
        if (definition.type === 'random') {
            scheduleRandomSound(soundType);
        }
    }, [scheduleRandomSound]);

    // Debug function to test all ambient sound variants
    const testAllVariants = useCallback(async () => {
        console.log('🌊 🧪 [VARIANT TEST] Testing all ambient sound variants...');
        
        // First, test direct file access
        console.log('\n🌊 [DIRECT ACCESS TEST] Testing file accessibility...');
        const testFilenames = ['ambient_seagull_cry.mp3', 'ambient_seagull_cry2.mp3', 'ambient_wolf_howl.mp3'];
        
        for (const testFile of testFilenames) {
            try {
                const response = await fetch(`/sounds/ambient/${testFile}`);
                if (response.ok) {
                    console.log(`   ✅ Direct fetch: ${testFile} (${response.status})`);
                } else {
                    console.error(`   ❌ Direct fetch: ${testFile} (${response.status})`);
                }
            } catch (error) {
                console.error(`   ❌ Direct fetch error: ${testFile}`, error);
            }
        }
        
        console.log('\n🌊 [AUDIO ELEMENT TEST] Testing via audio elements...');
        for (const [soundType, definition] of Object.entries(AMBIENT_SOUND_DEFINITIONS)) {
            if (definition.type !== 'random') continue;
            
            console.log(`\n🌊 Testing ${soundType} (${definition.variations || 1} variants):`);
            
            for (let i = 0; i < (definition.variations || 1); i++) {
                const filename = i === 0 ? definition.filename : 
                               definition.filename.replace('.mp3', `${i + 1}.mp3`);
                
                try {
                    const audio = await ambientAudioCache.loadAudio(filename);
                    
                    // Wait longer for metadata to load
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    if (audio.duration && audio.duration > 0 && !isNaN(audio.duration) && isFinite(audio.duration)) {
                        console.log(`   ✅ Variant ${i + 1}: ${filename} (${audio.duration.toFixed(2)}s)`);
                    } else {
                        console.error(`   ❌ Variant ${i + 1}: ${filename} - Invalid duration: ${audio.duration} (readyState: ${audio.readyState})`);
                    }
                } catch (error) {
                    console.error(`   ❌ Variant ${i + 1}: ${filename} - Load error:`, error);
                }
            }
        }
        
        console.log('\n🌊 🧪 [VARIANT TEST] Complete! Check above for any missing variants.');
    }, []);

    const stopAllAmbientSounds = useCallback(async () => {
        // Stop all seamless sounds with fade-out
        const cleanupPromises = Array.from(activeSeamlessLoopingSounds.keys()).map(soundType => 
            cleanupSeamlessSound(soundType, "stop all requested")
        );
        await Promise.all(cleanupPromises);

        // Stop all simple looping sounds
        const simpleLoopingSounds = (window as any).simpleLoopingSounds;
        if (simpleLoopingSounds) {
            simpleLoopingSounds.forEach((audio: HTMLAudioElement) => {
                audio.pause();
                audio.currentTime = 0;
            });
            simpleLoopingSounds.clear();
        }

        // Clear all random sound timers
        randomSoundTimers.forEach(timer => window.clearTimeout(timer));
        randomSoundTimers.clear();

        // Stop all random sounds (these can stop immediately since they're short)
        activeRandomSounds.forEach(audio => {
            audio.pause();
            audio.currentTime = 0;
        });
        activeRandomSounds.clear();
    }, []);

    return {
        playManualAmbientSound,
        stopAllAmbientSounds,
        testAllVariants, // Expose for debugging
        activeContinuousSoundsCount: activeSeamlessLoopingSounds.size,
        activeRandomSoundsCount: activeRandomSounds.size,
        ambientSoundDefinitions: AMBIENT_SOUND_DEFINITIONS,
    };
}; 