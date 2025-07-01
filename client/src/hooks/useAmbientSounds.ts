import { useEffect, useRef, useCallback } from 'react';

interface AmbientSoundProps {
    masterVolume?: number;
    environmentalVolume?: number;
    timeOfDay?: 'day' | 'night' | 'dawn' | 'dusk'; // Future: time-based ambience
    weatherCondition?: 'clear' | 'cloudy' | 'storm' | 'fog'; // Future: weather-based ambience
    isPlayerNearOcean?: boolean; // Proximity to water
    playerActivity?: 'idle' | 'moving' | 'crafting' | 'combat'; // Activity-based ambience
}

// Ambient sound definitions for Aleutian island atmosphere
const AMBIENT_SOUND_DEFINITIONS = {
    // === CONTINUOUS/LOOPING AMBIENCE ===
    wind_light: { 
        type: 'continuous', 
        filename: 'ambient_wind_light.mp3', 
        baseVolume: 0.4, 
        isLooping: true,
        description: 'Gentle constant wind through grass and trees'
    },
    wind_moderate: { 
        type: 'continuous', 
        filename: 'ambient_wind_moderate.mp3', 
        baseVolume: 0.6, 
        isLooping: true,
        description: 'Moderate wind with occasional gusts'
    },
    wind_strong: { 
        type: 'continuous', 
        filename: 'ambient_wind_strong.mp3', 
        baseVolume: 0.8, 
        isLooping: true,
        description: 'Strong persistent wind for harsh weather'
    },
    ocean_distant: { 
        type: 'continuous', 
        filename: 'ambient_ocean_distant.mp3', 
        baseVolume: 0.3, 
        isLooping: true,
        description: 'Distant ocean waves and surf'
    },
    ocean_close: { 
        type: 'continuous', 
        filename: 'ambient_ocean_close.mp3', 
        baseVolume: 0.5, 
        isLooping: true,
        description: 'Closer ocean waves for coastal areas'
    },
    nature_general: { 
        type: 'continuous', 
        filename: 'ambient_nature_general.mp3', 
        baseVolume: 0.25, 
        isLooping: true,
        description: 'General nature ambience - insects, rustling'
    },
    
    // === RANDOM/PERIODIC AMBIENCE ===
    seagull_cry: { 
        type: 'random', 
        filename: 'ambient_seagull_cry.mp3', 
        baseVolume: 0.6,
        minInterval: 15000, // 15 seconds minimum
        maxInterval: 45000, // 45 seconds maximum
        variations: 3, // seagull_cry1.mp3, seagull_cry2.mp3, etc.
        description: 'Seagulls crying in the distance'
    },
    wolf_howl: { 
        type: 'random', 
        filename: 'ambient_wolf_howl.mp3', 
        baseVolume: 0.4,
        minInterval: 60000, // 1 minute minimum
        maxInterval: 180000, // 3 minutes maximum
        variations: 2,
        nightOnly: true, // Only play during night/dusk
        description: 'Distant wolf howls'
    },
    raven_caw: { 
        type: 'random', 
        filename: 'ambient_raven_caw.mp3', 
        baseVolume: 0.5,
        minInterval: 30000, // 30 seconds minimum
        maxInterval: 90000, // 1.5 minutes maximum
        variations: 3,
        description: 'Ravens and crows cawing'
    },
    wind_gust: { 
        type: 'random', 
        filename: 'ambient_wind_gust.mp3', 
        baseVolume: 0.7,
        minInterval: 20000, // 20 seconds minimum
        maxInterval: 60000, // 1 minute maximum
        variations: 2,
        description: 'Sudden wind gusts'
    },
    distant_thunder: { 
        type: 'random', 
        filename: 'ambient_distant_thunder.mp3', 
        baseVolume: 0.3,
        minInterval: 120000, // 2 minutes minimum
        maxInterval: 300000, // 5 minutes maximum
        variations: 3,
        description: 'Very distant thunder for atmosphere'
    },
    structure_creak: { 
        type: 'random', 
        filename: 'ambient_structure_creak.mp3', 
        baseVolume: 0.4,
        minInterval: 45000, // 45 seconds minimum
        maxInterval: 120000, // 2 minutes maximum
        variations: 2,
        description: 'Old structures creaking in the wind'
    },
    owl_hoot: { 
        type: 'random', 
        filename: 'ambient_owl_hoot.mp3', 
        baseVolume: 0.4,
        minInterval: 90000, // 1.5 minutes minimum
        maxInterval: 240000, // 4 minutes maximum
        variations: 2,
        nightOnly: true,
        description: 'Owls hooting at night'
    },
    grass_rustle: { 
        type: 'random', 
        filename: 'ambient_grass_rustle.mp3', 
        baseVolume: 0.3,
        minInterval: 25000, // 25 seconds minimum
        maxInterval: 70000, // 70 seconds maximum
        variations: 2,
        description: 'Grass and vegetation rustling'
    }
} as const;

type AmbientSoundType = keyof typeof AMBIENT_SOUND_DEFINITIONS;

// Ambient sound configuration
const AMBIENT_CONFIG = {
    SOUNDS_BASE_PATH: '/sounds/ambient/',
    PITCH_VARIATION: 0.15, // ±7.5% pitch variation for natural feel
    VOLUME_VARIATION: 0.1, // ±5% volume variation
    FADE_DURATION: 2000, // 2 second fade in/out for continuous sounds
    MAX_CONCURRENT_RANDOM: 3, // Maximum random sounds playing at once
} as const;

// Audio cache for ambient sounds
class AmbientAudioCache {
    private cache = new Map<string, HTMLAudioElement>();

    async get(filename: string): Promise<HTMLAudioElement> {
        if (this.cache.has(filename)) {
            const audio = this.cache.get(filename)!;
            return audio.cloneNode() as HTMLAudioElement;
        }

        try {
            const audio = new Audio(`${AMBIENT_CONFIG.SOUNDS_BASE_PATH}${filename}`);
            audio.preload = 'auto';
            await new Promise((resolve, reject) => {
                audio.addEventListener('canplaythrough', resolve, { once: true });
                audio.addEventListener('error', reject, { once: true });
            });
            this.cache.set(filename, audio);
            return audio.cloneNode() as HTMLAudioElement;
        } catch (error) {
            console.warn(`🌊 Failed to load ambient sound: ${filename}`, error);
            // Return silent fallback
            return new Audio();
        }
    }

    clear(): void {
        this.cache.clear();
    }
}

// Global instances
const ambientAudioCache = new AmbientAudioCache();
const activeContinuousSounds = new Map<AmbientSoundType, HTMLAudioElement>();
const activeRandomSounds = new Set<HTMLAudioElement>();
const randomSoundTimers = new Map<AmbientSoundType, number>();

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

// Main ambient sound system
export const useAmbientSounds = ({
    masterVolume = 1.0,
    environmentalVolume = 0.7,
    timeOfDay = 'day',
    weatherCondition = 'clear',
    isPlayerNearOcean = false,
    playerActivity = 'idle'
}: AmbientSoundProps = {}) => {
    const isInitializedRef = useRef(false);
    const lastWeatherRef = useRef(weatherCondition);
    const lastProximityRef = useRef(isPlayerNearOcean);

    // Calculate which continuous sounds should be playing
    const getActiveContinuousSounds = useCallback((): AmbientSoundType[] => {
        const sounds: AmbientSoundType[] = [];
        
        // Always have some wind
        if (weatherCondition === 'storm') {
            sounds.push('wind_strong');
        } else if (weatherCondition === 'cloudy' || weatherCondition === 'fog') {
            sounds.push('wind_moderate');
        } else {
            sounds.push('wind_light');
        }
        
        // Ocean sounds based on proximity
        if (isPlayerNearOcean) {
            sounds.push('ocean_close');
        } else {
            sounds.push('ocean_distant');
        }
        
        // General nature ambience (always present but quiet)
        sounds.push('nature_general');
        
        return sounds;
    }, [weatherCondition, isPlayerNearOcean]);

    // Start a continuous ambient sound
    const startContinuousSound = useCallback(async (soundType: AmbientSoundType) => {
        try {
            const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
            if (definition.type !== 'continuous') return;

            const audio = await ambientAudioCache.get(definition.filename);
            audio.loop = true;
            
            const finalVolume = definition.baseVolume * environmentalVolume;
            applyAudioVariation(audio, finalVolume, masterVolume);
            
            activeContinuousSounds.set(soundType, audio);
            
            await audio.play();
            fadeInAudio(audio, finalVolume * masterVolume);
            
            console.log(`🌊 Started ambient sound: ${soundType} (${definition.description})`);
        } catch (error) {
            console.warn(`🌊 Failed to start continuous sound: ${soundType}`, error);
        }
    }, [masterVolume, environmentalVolume]);

    // Stop a continuous ambient sound
    const stopContinuousSound = useCallback(async (soundType: AmbientSoundType) => {
        const audio = activeContinuousSounds.get(soundType);
        if (audio) {
            await fadeOutAudio(audio);
            activeContinuousSounds.delete(soundType);
            console.log(`🌊 Stopped ambient sound: ${soundType}`);
        }
    }, []);

    // Schedule a random ambient sound
    const scheduleRandomSound = useCallback((soundType: AmbientSoundType) => {
        const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
        if (definition.type !== 'random') return;

        // Check time of day restrictions
        if ('nightOnly' in definition && definition.nightOnly && (timeOfDay === 'day')) {
            return;
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

                const audio = await ambientAudioCache.get(filename);
                const finalVolume = definition.baseVolume * environmentalVolume;
                applyAudioVariation(audio, finalVolume, masterVolume);

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
                console.log(`🌊 Played random ambient: ${soundType} (${definition.description})`);
            } catch (error) {
                console.warn(`🌊 Failed to play random sound: ${soundType}`, error);
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

    // Initialize ambient sound system
    useEffect(() => {
        if (isInitializedRef.current) return;
        isInitializedRef.current = true;

        console.log('🌊 Initializing Aleutian Island ambient sound system...');

        // Start all random sound schedules
        Object.keys(AMBIENT_SOUND_DEFINITIONS).forEach(soundType => {
            const definition = AMBIENT_SOUND_DEFINITIONS[soundType as AmbientSoundType];
            if (definition.type === 'random') {
                scheduleRandomSound(soundType as AmbientSoundType);
            }
        });

        return () => {
            // Cleanup on unmount
            randomSoundTimers.forEach(timer => window.clearTimeout(timer));
            randomSoundTimers.clear();
            
            activeContinuousSounds.forEach(audio => {
                audio.pause();
                audio.currentTime = 0;
            });
            activeContinuousSounds.clear();
            
            activeRandomSounds.forEach(audio => {
                audio.pause();
                audio.currentTime = 0;
            });
            activeRandomSounds.clear();
        };
    }, [scheduleRandomSound]);

    // Manage continuous sounds based on environment
    useEffect(() => {
        const targetSounds = getActiveContinuousSounds();
        const currentSounds = Array.from(activeContinuousSounds.keys());

        // Stop sounds that should no longer be playing
        currentSounds.forEach(soundType => {
            if (!targetSounds.includes(soundType)) {
                stopContinuousSound(soundType);
            }
        });

        // Start sounds that should be playing
        targetSounds.forEach(soundType => {
            if (!activeContinuousSounds.has(soundType)) {
                startContinuousSound(soundType);
            }
        });

        // Update references
        lastWeatherRef.current = weatherCondition;
        lastProximityRef.current = isPlayerNearOcean;

    }, [weatherCondition, isPlayerNearOcean, getActiveContinuousSounds, startContinuousSound, stopContinuousSound]);

    // Update volumes when master/environmental volume changes
    useEffect(() => {
        activeContinuousSounds.forEach((audio, soundType) => {
            const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
            const targetVolume = definition.baseVolume * environmentalVolume * masterVolume;
            audio.volume = targetVolume;
        });
    }, [masterVolume, environmentalVolume]);

    // Public API
    const playManualAmbientSound = useCallback((soundType: AmbientSoundType) => {
        const definition = AMBIENT_SOUND_DEFINITIONS[soundType];
        if (definition.type === 'random') {
            scheduleRandomSound(soundType);
        }
    }, [scheduleRandomSound]);

    const stopAllAmbientSounds = useCallback(() => {
        // Stop all continuous sounds
        Array.from(activeContinuousSounds.keys()).forEach(soundType => {
            stopContinuousSound(soundType);
        });

        // Clear all random sound timers
        randomSoundTimers.forEach(timer => window.clearTimeout(timer));
        randomSoundTimers.clear();

        // Stop all random sounds
        activeRandomSounds.forEach(audio => {
            audio.pause();
            audio.currentTime = 0;
        });
        activeRandomSounds.clear();
    }, [stopContinuousSound]);

    return {
        playManualAmbientSound,
        stopAllAmbientSounds,
        activeContinuousSoundsCount: activeContinuousSounds.size,
        activeRandomSoundsCount: activeRandomSounds.size,
        ambientSoundDefinitions: AMBIENT_SOUND_DEFINITIONS,
    };
}; 