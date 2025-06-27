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
    { filename: 'Babushka_Circuit.mp3', displayName: 'Babushka Circuit' },
    { filename: 'Deadwomans_Harbor.mp3', displayName: 'Deadwoman\'s Harbor' },
    { filename: 'Inlet Fog.mp3', displayName: 'Inlet Fog' },
    { filename: 'Derge_Soupline.mp3', displayName: 'Derge Soupline' },
    { filename: 'Kindling_Ritual.mp3', displayName: 'Kindling Ritual' },
    { filename: 'Latchkey_Depths.mp3', displayName: 'Latchkey Depths' },
    { filename: 'Low_Tide_Cache.mp3', displayName: 'Low Tide Cache' },
    { filename: 'Saltwind.mp3', displayName: 'Saltwind' },
    { filename: 'Snowblind_Signal.mp3', displayName: 'Snowblind Signal' },
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
    shuffleMode: boolean; // Track shuffle mode in state
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
        playlist: [],
        playlistPosition: 0,
        volume: finalConfig.volume,
        shuffleMode: finalConfig.shuffleMode,
    });

    const currentAudioRef = useRef<HTMLAudioElement | null>(null);
    const nextAudioRef = useRef<HTMLAudioElement | null>(null);
    const configRef = useRef(finalConfig);
    const stateRef = useRef(state);

    // Track cleanup ref to store event listeners for proper cleanup
    const currentEventListenersRef = useRef<Array<() => void>>([]);
    
    // Clean up previous event listeners
    const cleanupEventListeners = useCallback(() => {
        currentEventListenersRef.current.forEach(cleanup => cleanup());
        currentEventListenersRef.current = [];
    }, []);

    // Forward reference for nextTrack function
    const nextTrackRef = useRef<(() => Promise<void>) | null>(null);

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
    const playTrack = useCallback(async (trackIndex: number, crossfade = true): Promise<void> => {
        try {
            const track = MUSIC_TRACKS[trackIndex];
            if (!track) {
                throw new Error(`Invalid track index: ${trackIndex}`);
            }

            console.log(`🎵 Playing: ${track.displayName}`);

            // Clean up previous event listeners to prevent multiple tracks from auto-advancing
            cleanupEventListeners();

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
            const handleTrackEnded = () => {
                console.log('🎵 Track ended, checking if should auto-advance...');
                // Use stateRef to check current playing state
                if (stateRef.current.isPlaying) {
                    console.log('🎵 Auto-advancing to next track');
                    // Call nextTrack via ref to avoid circular dependency
                    if (nextTrackRef.current) {
                        nextTrackRef.current().catch((error: Error) => {
                            console.error('🎵 Error auto-advancing to next track:', error);
                            setState(prev => ({ 
                                ...prev, 
                                error: `Failed to advance to next track: ${error.message || 'Unknown error'}` 
                            }));
                        });
                    }
                } else {
                    console.log('🎵 Track ended but music system is not playing, skipping auto-advance');
                }
            };
            
            newAudio.addEventListener('ended', handleTrackEnded, { once: true });
            
            // Store cleanup function for this event listener
            const cleanup = () => newAudio.removeEventListener('ended', handleTrackEnded);
            currentEventListenersRef.current.push(cleanup);

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
                error: `Failed to play track: ${(error as Error).message || 'Unknown error'}` 
            }));
        }
    }, [cleanupEventListeners]);

    // Start music system
    const startMusic = useCallback(async () => {
        console.log('🎵 Starting music system...');
        
        // Use stateRef to get the most current state
        const currentState = stateRef.current;
        let currentPlaylist = currentState.playlist;
        let startPosition = currentState.playlistPosition;
        
        // If no playlist exists, create a new shuffled one
        if (currentPlaylist.length === 0) {
            console.log('🎵 No existing playlist, creating new shuffled playlist');
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
        console.log(`🎵 Starting with track: ${MUSIC_TRACKS[firstTrackIndex]?.displayName}`);
        await playTrack(firstTrackIndex, false); // No crossfade for first track
    }, [playTrack]); // Removed state dependencies to prevent stale closures

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
    const nextTrack = useCallback(async (): Promise<void> => {
        // Use stateRef.current to get the most up-to-date state
        const currentState = stateRef.current;
        
        if (!currentState.isPlaying) {
            console.log('🎵 nextTrack called but music is not playing');
            return;
        }

        console.log(`🎵 Moving to next track. Current position: ${currentState.playlistPosition}/${currentState.playlist.length}`);

        let nextPosition = currentState.playlistPosition + 1;
        let playlistToUse = currentState.playlist;
        
        // If we've reached the end of the playlist, shuffle a new one
        if (nextPosition >= currentState.playlist.length) {
            console.log('🎵 End of playlist reached, creating new shuffled playlist');
            const newPlaylist = createShuffledPlaylist(MUSIC_TRACKS.length);
            playlistToUse = newPlaylist;
            nextPosition = 0;
            
            setState(prev => ({ 
                ...prev, 
                playlist: newPlaylist, 
                playlistPosition: nextPosition 
            }));
        } else {
            setState(prev => ({ 
                ...prev, 
                playlistPosition: nextPosition 
            }));
        }

        const nextTrackIndex = playlistToUse[nextPosition];
        console.log(`🎵 Playing track ${nextPosition + 1}/${playlistToUse.length}: ${MUSIC_TRACKS[nextTrackIndex]?.displayName}`);
        
        await playTrack(nextTrackIndex);
    }, [playTrack]);

    // Set the nextTrack ref after the function is defined
    useEffect(() => {
        nextTrackRef.current = nextTrack;
    }, [nextTrack]);

    // Previous track
    const previousTrack = useCallback(async (): Promise<void> => {
        // Use stateRef.current to get the most up-to-date state  
        const currentState = stateRef.current;
        
        if (!currentState.isPlaying) return;

        let prevPosition = currentState.playlistPosition - 1;
        
        // If we're at the beginning, go to end of playlist
        if (prevPosition < 0) {
            prevPosition = currentState.playlist.length - 1;
        }

        setState(prev => ({ ...prev, playlistPosition: prevPosition }));
        const prevTrackIndex = currentState.playlist[prevPosition];
        await playTrack(prevTrackIndex);
    }, [playTrack]); // Removed state dependencies to prevent stale closures

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
        const currentState = stateRef.current;
        const currentConfig = configRef.current;
        const newShuffleMode = !currentState.shuffleMode; // Use state instead of config
        
        console.log(`🎵 Toggling shuffle mode: ${currentState.shuffleMode} → ${newShuffleMode}`);
        
        // Update config
        configRef.current = { ...currentConfig, shuffleMode: newShuffleMode };
        
        // Get current track index to preserve position
        const currentTrackIndex = currentState.currentTrackIndex;
        
        if (newShuffleMode) {
            // Create new shuffled playlist, but keep current track at the front if playing
            console.log('🎵 Creating shuffled playlist');
            let newPlaylist = createShuffledPlaylist(MUSIC_TRACKS.length);
            
            // If we're currently playing a track, move it to the front of the new playlist
            if (currentTrackIndex >= 0 && currentState.isPlaying) {
                newPlaylist = newPlaylist.filter(idx => idx !== currentTrackIndex);
                newPlaylist.unshift(currentTrackIndex);
                console.log(`🎵 Moved current track ${currentTrackIndex} to front of shuffled playlist`);
            }
            
            setState(prev => ({ 
                ...prev, 
                playlist: newPlaylist, 
                playlistPosition: currentState.isPlaying ? 0 : Math.floor(Math.random() * newPlaylist.length),
                shuffleMode: newShuffleMode 
            }));
        } else {
            // Create ordered playlist (0, 1, 2, 3...)
            console.log('🎵 Creating sequential playlist');
            const orderedPlaylist = Array.from({ length: MUSIC_TRACKS.length }, (_, i) => i);
            
            // Set position to current track index if playing, otherwise start at 0
            const newPosition = currentState.isPlaying && currentTrackIndex >= 0 ? currentTrackIndex : 0;
            
            setState(prev => ({ 
                ...prev, 
                playlist: orderedPlaylist, 
                playlistPosition: newPosition,
                shuffleMode: newShuffleMode 
            }));
        }
        
        console.log(`🎵 Shuffle mode is now: ${newShuffleMode ? 'ON' : 'OFF'}`);
    }, []); // Keep empty dependency array since we're using refs

    // Initialize music system
    useEffect(() => {
        if (finalConfig.enabled) {
            preloadAllTracks();
        }

        // Cleanup on unmount
        return () => {
            console.log('🎵 Music system cleanup');
            cleanupEventListeners(); // Clean up any active event listeners
            if (currentAudioRef.current) {
                currentAudioRef.current.pause();
            }
            if (nextAudioRef.current) {
                nextAudioRef.current.pause();
            }
            musicCache.clear();
        };
    }, [finalConfig.enabled, preloadAllTracks]);

    // Play specific track by index
    const playSpecificTrack = useCallback(async (trackIndex: number): Promise<void> => {
        if (trackIndex < 0 || trackIndex >= MUSIC_TRACKS.length) {
            console.error('🎵 Invalid track index:', trackIndex);
            return;
        }

        console.log(`🎵 Playing specific track: ${MUSIC_TRACKS[trackIndex]?.displayName}`);
        
        // Update playlist position to match the selected track
        const currentState = stateRef.current;
        let newPosition = currentState.playlist.indexOf(trackIndex);
        
        // If the track isn't in the current playlist, add it or create a new playlist
        if (newPosition === -1) {
            // Create a new playlist starting with the selected track
            const newPlaylist = [trackIndex, ...currentState.playlist.filter(idx => idx !== trackIndex)];
            newPosition = 0;
            setState(prev => ({ 
                ...prev, 
                playlist: newPlaylist, 
                playlistPosition: newPosition 
            }));
        } else {
            setState(prev => ({ 
                ...prev, 
                playlistPosition: newPosition 
            }));
        }

        // Play the track
        await playTrack(trackIndex);
    }, [playTrack]);

    // Public API
    return {
        // State
        isPlaying: state.isPlaying,
        currentTrack: state.currentTrack,
        isLoading: state.isLoading,
        preloadProgress: state.preloadProgress,
        error: state.error,
        volume: state.volume,
        shuffleMode: state.shuffleMode,
        
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
        
        // New function
        playSpecificTrack,
    };
}; 