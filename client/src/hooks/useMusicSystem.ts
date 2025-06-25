import { useEffect, useRef, useCallback, useState } from 'react';

interface MusicSystemConfig {
    enabled: boolean;
    volume: number; // 0-1 scale (up to 100%)
    crossfadeDuration: number; // milliseconds
    shuffleMode: boolean;
    preloadAll: boolean;
}

interface MusicTrack {
    filename: string;
    displayName: string;
    duration?: number; // Will be set after loading
}

// All music tracks found in /public/music
const MUSIC_TRACKS: MusicTrack[] = [
    { filename: 'Aleut_Ashfall.mp3', displayName: 'Aleut Ashfall' },
    { filename: 'Aleut_Ashfall1.mp3', displayName: 'Aleut Ashfall (Variant)' },
    { filename: 'Babushka_Circuit.mp3', displayName: 'Babushka Circuit' },
    { filename: 'Babushka_Circuit1.mp3', displayName: 'Babushka Circuit (Variant)' },
    { filename: 'Deadwomans_Harbor.mp3', displayName: 'Deadwoman\'s Harbor' },
    { filename: 'Deadwomans_Harbor1.mp3', displayName: 'Deadwoman\'s Harbor (Variant)' },
    { filename: 'Inlet Fog.mp3', displayName: 'Inlet Fog' },
    { filename: 'Inlet_Fog1.mp3', displayName: 'Inlet Fog (Variant)' },
    { filename: 'Kindling_Ritual.mp3', displayName: 'Kindling Ritual' },
    { filename: 'Kindling_Ritual1.mp3', displayName: 'Kindling Ritual (Variant)' },
    { filename: 'Latchkey_Depths.mp3', displayName: 'Latchkey Depths' },
    { filename: 'Latchkey_Depths1.mp3', displayName: 'Latchkey Depths (Variant)' },
    { filename: 'Low_Tide_Cache.mp3', displayName: 'Low Tide Cache' },
    { filename: 'Saltwind.mp3', displayName: 'Saltwind' },
    { filename: 'Shiver_Doctrine.mp3', displayName: 'Shiver Doctrine' },
    { filename: 'Shiver_Doctrine1.mp3', displayName: 'Shiver Doctrine (Variant)' },
    { filename: 'Snowblind_Signal.mp3', displayName: 'Snowblind Signal' },
    { filename: 'Snowblind_Signal1.mp3', displayName: 'Snowblind Signal (Variant)' },
    { filename: 'Soupline_Dirge.mp3', displayName: 'Soupline Dirge' },
    { filename: 'Soupline_Dirge1.mp3', displayName: 'Soupline Dirge (Variant)' },
    { filename: 'Spoiled_Tallow.mp3', displayName: 'Spoiled Tallow' },
    { filename: 'Whalebone_Relay.mp3', displayName: 'Whalebone Relay' },
];

const DEFAULT_CONFIG: MusicSystemConfig = {
    enabled: true,
    volume: 0.5, // 50% volume for background music (0.5 out of 1.0 max)
    crossfadeDuration: 2000, // 2 second crossfade
    shuffleMode: true,
    preloadAll: true,
};

// Music system state
interface MusicSystemState {
    isPlaying: boolean;
    currentTrack: MusicTrack | null;
    currentTrackIndex: number;
    isLoading: boolean;
    preloadProgress: number; // 0-1
    error: string | null;
    playlist: number[]; // Shuffled track indices
    playlistPosition: number;
    volume: number; // Current volume (0-1)
}

// Audio cache for preloaded tracks
class MusicCache {
    private cache = new Map<string, HTMLAudioElement>();
    private loadingPromises = new Map<string, Promise<HTMLAudioElement>>();

    async get(filename: string): Promise<HTMLAudioElement> {
        // Check cache first
        const cached = this.cache.get(filename);
        if (cached) {
            return cached;
        }

        // Check if already loading
        const loadingPromise = this.loadingPromises.get(filename);
        if (loadingPromise) {
            return loadingPromise;
        }

        // Start loading
        const promise = this.loadTrack(filename);
        this.loadingPromises.set(filename, promise);

        try {
            const audio = await promise;
            this.cache.set(filename, audio);
            this.loadingPromises.delete(filename);
            return audio;
        } catch (error) {
            this.loadingPromises.delete(filename);
            throw error;
        }
    }

    private async loadTrack(filename: string): Promise<HTMLAudioElement> {
        return new Promise((resolve, reject) => {
            const audio = new Audio(`/music/${filename}`);
            audio.preload = 'auto';
            audio.loop = false; // We'll handle looping manually
            
            const loadTimeout = setTimeout(() => {
                reject(new Error(`Music load timeout: ${filename}`));
            }, 10000); // 10 second timeout for large files

            audio.addEventListener('loadeddata', () => {
                clearTimeout(loadTimeout);
                resolve(audio);
            }, { once: true });

            audio.addEventListener('error', (e) => {
                clearTimeout(loadTimeout);
                console.error(`🎵 Music load error: ${filename}`, e);
                reject(new Error(`Failed to load music: ${filename}`));
            }, { once: true });

            // Start loading
            audio.load();
        });
    }

    has(filename: string): boolean {
        return this.cache.has(filename);
    }

    clear(): void {
        // Stop all cached audio
        this.cache.forEach(audio => {
            audio.pause();
            audio.currentTime = 0;
        });
        this.cache.clear();
        this.loadingPromises.clear();
    }

    size(): number {
        return this.cache.size;
    }
}

// Global music cache
const musicCache = new MusicCache();

// Utility functions
const createShuffledPlaylist = (trackCount: number): number[] => {
    const playlist = Array.from({ length: trackCount }, (_, i) => i);
    // Fisher-Yates shuffle
    for (let i = playlist.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playlist[i], playlist[j]] = [playlist[j], playlist[i]];
    }
    return playlist;
};

const fadeAudio = async (audio: HTMLAudioElement, fromVolume: number, toVolume: number, duration: number): Promise<void> => {
    return new Promise((resolve) => {
        const steps = 60; // 60 steps for smooth fade
        const stepDuration = duration / steps;
        const volumeStep = (toVolume - fromVolume) / steps;
        let currentStep = 0;

        const fade = () => {
            if (currentStep >= steps) {
                audio.volume = toVolume;
                resolve();
                return;
            }

            audio.volume = fromVolume + (volumeStep * currentStep);
            currentStep++;
            setTimeout(fade, stepDuration);
        };

        fade();
    });
};

export const useMusicSystem = (config: Partial<MusicSystemConfig> = {}) => {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    
    const [state, setState] = useState<MusicSystemState>({
        isPlaying: false,
        currentTrack: null,
        currentTrackIndex: -1,
        isLoading: false,
        preloadProgress: 0,
        error: null,
        playlist: createShuffledPlaylist(MUSIC_TRACKS.length),
        playlistPosition: 0,
        volume: finalConfig.volume,
    });

    const currentAudioRef = useRef<HTMLAudioElement | null>(null);
    const nextAudioRef = useRef<HTMLAudioElement | null>(null);
    const configRef = useRef(finalConfig);
    const stateRef = useRef(state);

    // Update refs when state changes
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    useEffect(() => {
        configRef.current = finalConfig;
    }, [finalConfig]);

    // Preload all music tracks
    const preloadAllTracks = useCallback(async () => {
        if (!finalConfig.preloadAll) return;

        console.log('🎵 Starting music preload...');
        setState(prev => ({ ...prev, isLoading: true, preloadProgress: 0 }));

        let loadedCount = 0;
        const totalTracks = MUSIC_TRACKS.length;

        const loadPromises = MUSIC_TRACKS.map(async (track, index) => {
            try {
                await musicCache.get(track.filename);
                loadedCount++;
                const progress = loadedCount / totalTracks;
                setState(prev => ({ ...prev, preloadProgress: progress }));
                console.log(`🎵 Preloaded: ${track.displayName} (${loadedCount}/${totalTracks})`);
            } catch (error) {
                console.warn(`🎵 Failed to preload: ${track.displayName}`, error);
                loadedCount++; // Still count as "processed"
                setState(prev => ({ ...prev, preloadProgress: loadedCount / totalTracks }));
            }
        });

        await Promise.allSettled(loadPromises);
        
        setState(prev => ({ 
            ...prev, 
            isLoading: false, 
            preloadProgress: 1,
            error: loadedCount === 0 ? 'Failed to load any music tracks' : null
        }));

        console.log(`🎵 Music preload complete! Loaded ${loadedCount}/${totalTracks} tracks`);
    }, [finalConfig.preloadAll]);

    // Play a specific track
    const playTrack = useCallback(async (trackIndex: number, crossfade = true) => {
        try {
            const track = MUSIC_TRACKS[trackIndex];
            if (!track) {
                throw new Error(`Invalid track index: ${trackIndex}`);
            }

            console.log(`🎵 Playing: ${track.displayName}`);

            // Get the audio element
            const audio = await musicCache.get(track.filename);
            const newAudio = audio.cloneNode() as HTMLAudioElement;
            newAudio.volume = 0; // Start silent for crossfade
            newAudio.currentTime = 0;

            // Set up next track preparation
            nextAudioRef.current = newAudio;

            // Crossfade if there's currently playing audio
            if (currentAudioRef.current && crossfade && configRef.current.crossfadeDuration > 0) {
                const fadeOutPromise = fadeAudio(
                    currentAudioRef.current, 
                    currentAudioRef.current.volume, 
                    0, 
                    configRef.current.crossfadeDuration
                );
                
                const fadeInPromise = fadeAudio(
                    newAudio, 
                    0, 
                    configRef.current.volume, 
                    configRef.current.crossfadeDuration
                );

                // Start new track
                await newAudio.play();
                
                // Run crossfade
                await Promise.all([fadeOutPromise, fadeInPromise]);
                
                // Stop old track
                currentAudioRef.current.pause();
                currentAudioRef.current.currentTime = 0;
            } else {
                // No crossfade, just start new track
                newAudio.volume = configRef.current.volume;
                await newAudio.play();
            }

            // Set up track end listener for automatic next track
            newAudio.addEventListener('ended', () => {
                if (stateRef.current.isPlaying) {
                    // Use setTimeout to ensure nextTrack is defined when called
                    setTimeout(() => nextTrack(), 0);
                }
            });

            // Update current audio reference
            currentAudioRef.current = newAudio;
            nextAudioRef.current = null;

            // Update state
            setState(prev => ({
                ...prev,
                currentTrack: track,
                currentTrackIndex: trackIndex,
                isPlaying: true,
                error: null,
            }));

        } catch (error) {
            console.error('🎵 Error playing track:', error);
            setState(prev => ({ 
                ...prev, 
                error: `Failed to play track: ${error instanceof Error ? error.message : 'Unknown error'}` 
            }));
        }
    }, []);

    // Start music system
    const startMusic = useCallback(async () => {
        console.log('🎵 Starting music system...');
        
        let currentPlaylist = state.playlist;
        let startPosition = state.playlistPosition;
        
        // If no playlist exists, create a new shuffled one
        if (currentPlaylist.length === 0) {
            currentPlaylist = createShuffledPlaylist(MUSIC_TRACKS.length);
            setState(prev => ({ ...prev, playlist: currentPlaylist }));
        }
        
        // If we're at the beginning (position 0), randomize the starting position
        // This ensures each game session starts with a different song
        if (startPosition === 0) {
            startPosition = Math.floor(Math.random() * currentPlaylist.length);
            setState(prev => ({ ...prev, playlistPosition: startPosition }));
            console.log(`🎵 Randomized starting position: ${startPosition + 1}/${currentPlaylist.length}`);
        }

        const firstTrackIndex = currentPlaylist[startPosition];
        await playTrack(firstTrackIndex, false); // No crossfade for first track
    }, [state.playlist, state.playlistPosition, playTrack]);

    // Stop music
    const stopMusic = useCallback(() => {
        console.log('🎵 Stopping music...');
        
        if (currentAudioRef.current) {
            currentAudioRef.current.pause();
            currentAudioRef.current.currentTime = 0;
        }
        
        if (nextAudioRef.current) {
            nextAudioRef.current.pause();
            nextAudioRef.current.currentTime = 0;
        }

        setState(prev => ({
            ...prev,
            isPlaying: false,
            currentTrack: null,
            currentTrackIndex: -1,
        }));
    }, []);

    // Next track
    const nextTrack = useCallback(async () => {
        if (!state.isPlaying) return;

        let nextPosition = state.playlistPosition + 1;
        
        // If we've reached the end of the playlist, shuffle a new one
        if (nextPosition >= state.playlist.length) {
            const newPlaylist = createShuffledPlaylist(MUSIC_TRACKS.length);
            setState(prev => ({ ...prev, playlist: newPlaylist, playlistPosition: 0 }));
            nextPosition = 0;
        } else {
            setState(prev => ({ ...prev, playlistPosition: nextPosition }));
        }

        const nextTrackIndex = state.playlist[nextPosition];
        await playTrack(nextTrackIndex);
    }, [state.isPlaying, state.playlistPosition, state.playlist, playTrack]);

    // Previous track
    const previousTrack = useCallback(async () => {
        if (!state.isPlaying) return;

        let prevPosition = state.playlistPosition - 1;
        
        // If we're at the beginning, go to end of playlist
        if (prevPosition < 0) {
            prevPosition = state.playlist.length - 1;
        }

        setState(prev => ({ ...prev, playlistPosition: prevPosition }));
        const prevTrackIndex = state.playlist[prevPosition];
        await playTrack(prevTrackIndex);
    }, [state.isPlaying, state.playlistPosition, state.playlist, playTrack]);

    // Set volume
    const setVolume = useCallback((volume: number) => {
        const clampedVolume = Math.max(0, Math.min(1, volume)); // 0-100% range
        console.log('🎵 Setting music volume to:', clampedVolume);
        
        if (currentAudioRef.current) {
            currentAudioRef.current.volume = clampedVolume;
        }

        // Update config
        configRef.current = { ...configRef.current, volume: clampedVolume };
        
        // Update state to reflect new volume
        setState(prev => ({ ...prev, volume: clampedVolume }));
    }, []);

    // Toggle shuffle mode
    const toggleShuffle = useCallback(() => {
        const newShuffleMode = !configRef.current.shuffleMode;
        configRef.current = { ...configRef.current, shuffleMode: newShuffleMode };
        
        if (newShuffleMode) {
            // Create new shuffled playlist
            const newPlaylist = createShuffledPlaylist(MUSIC_TRACKS.length);
            setState(prev => ({ ...prev, playlist: newPlaylist, playlistPosition: 0 }));
        } else {
            // Create ordered playlist
            const orderedPlaylist = Array.from({ length: MUSIC_TRACKS.length }, (_, i) => i);
            setState(prev => ({ ...prev, playlist: orderedPlaylist, playlistPosition: 0 }));
        }
    }, []);

    // Initialize music system
    useEffect(() => {
        if (finalConfig.enabled) {
            preloadAllTracks();
        }

        // Cleanup on unmount
        return () => {
            if (currentAudioRef.current) {
                currentAudioRef.current.pause();
            }
            if (nextAudioRef.current) {
                nextAudioRef.current.pause();
            }
            musicCache.clear();
        };
    }, [finalConfig.enabled, preloadAllTracks]);

    // Public API
    return {
        // State
        isPlaying: state.isPlaying,
        currentTrack: state.currentTrack,
        isLoading: state.isLoading,
        preloadProgress: state.preloadProgress,
        error: state.error,
        volume: state.volume,
        shuffleMode: finalConfig.shuffleMode,
        
        // Controls
        start: startMusic,
        stop: stopMusic,
        next: nextTrack,
        previous: previousTrack,
        setVolume,
        toggleShuffle,
        
        // Info
        tracklist: MUSIC_TRACKS,
        currentPosition: state.playlistPosition + 1,
        totalTracks: MUSIC_TRACKS.length,
    };
}; 