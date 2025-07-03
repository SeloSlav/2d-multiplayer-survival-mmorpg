import React, { useState, useEffect, useRef } from 'react';
import './CyberpunkLoadingScreen.css';
import sovaImage from '../assets/ui/sova.png';

interface CyberpunkErrorBarProps {
    message: string;
}

export const CyberpunkErrorBar: React.FC<CyberpunkErrorBarProps> = ({ message }) => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Trigger the fade-in animation
        setIsVisible(true);
    }, []);

    // Transform generic error messages to lore-consistent ones
    const getLoreConsistentMessage = (originalMessage: string): string => {
        if (originalMessage.toLowerCase().includes('spacetimedb') || 
            originalMessage.toLowerCase().includes('server') || 
            originalMessage.includes('connection') ||
            originalMessage.toLowerCase().includes('responding')) {
            return "Unable to establish quantum tunnel to Babachain network. Arkyv node may be offline or experiencing consensus failures.";
        }
        if (originalMessage.toLowerCase().includes('auth')) {
            return "Neural identity verification failed. Authentication nexus unreachable.";
        }
        if (originalMessage.toLowerCase().includes('network') || originalMessage.toLowerCase().includes('internet')) {
            return "Zvezdanet mesh network connectivity lost. Check quantum relay status.";
        }
        // Default fallback for any other errors
        return originalMessage;
    };

    return (
        <div className={`cyberpunk-error-bar ${isVisible ? 'visible' : ''}`}>
            <div className="error-content">
                <div className="error-header">
                    <div className="error-icon">⚠</div>
                    <div className="error-title">BABACHAIN NETWORK ERROR</div>
                </div>
                <div className="error-text">
                    <div className="error-message">
                        {getLoreConsistentMessage(message)}
                    </div>
                </div>
            </div>
        </div>
    );
};

interface CyberpunkLoadingScreenProps {
    authLoading: boolean;
    spacetimeLoading?: boolean; // Add SpacetimeDB loading state
    onSequenceComplete?: () => void;
    musicPreloadProgress?: number; // 0-1 for music preload progress
    musicPreloadComplete?: boolean;
}

// Audio preloading and management
const preloadedAudioFiles: { [key: string]: HTMLAudioElement } = {};
const TOTAL_SOVA_SOUNDS = 21;
const AUDIO_ENABLED_KEY = 'sova_audio_enabled';

// Check if user previously enabled audio
const hasUserEnabledAudio = (): boolean => {
    try {
        return localStorage.getItem(AUDIO_ENABLED_KEY) === 'true';
    } catch (e) {
        console.warn('localStorage not available');
        return false;
    }
};

// Save user's audio preference
const saveAudioPreference = (enabled: boolean): void => {
    try {
        localStorage.setItem(AUDIO_ENABLED_KEY, enabled.toString());
        console.log(`Audio preference saved: ${enabled}`);
    } catch (e) {
        console.warn('Failed to save audio preference to localStorage');
    }
};

// Function to load audio from the correct path
const tryLoadAudio = async (filename: string): Promise<HTMLAudioElement | null> => {
    // SOVA sounds are in the public/sounds/ directory
    // Vite serves public directory files directly from the root
    const possiblePaths = [
        `/sounds/${filename}`,            // Primary path: public/sounds/
        `/public/sounds/${filename}`,     // Alternative public path
        `./sounds/${filename}`,           // Relative path fallback
    ];

    for (const path of possiblePaths) {
        try {
            const audio = new Audio(path);
            
            // Test if the audio can load with a shorter timeout
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timeout')), 3000);
                
                audio.addEventListener('canplaythrough', () => {
                    clearTimeout(timeout);
                    resolve(audio);
                }, { once: true });
                
                audio.addEventListener('error', (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`Load failed: ${e}`));
                }, { once: true });
                
                audio.preload = 'auto';
                audio.load();
            });
            
            console.log(`Successfully loaded ${filename} from path: ${path}`);
            return audio;
        } catch (e) {
            console.log(`Failed to load ${filename} from path: ${path}:`, e);
        }
    }
    
    console.error(`Could not load ${filename} from any path`);
    return null;
};

// Preload all audio files
const preloadAudio = async () => {
    console.log('Preloading SOVA audio files...');
    
    // Preload numbered SOVA sounds (1-21)
    const loadPromises = [];
    for (let i = 1; i <= TOTAL_SOVA_SOUNDS; i++) {
        loadPromises.push(
            tryLoadAudio(`${i}.mp3`).then(audio => {
                if (audio) {
                    audio.volume = 0.85;
                    preloadedAudioFiles[i.toString()] = audio;
                    console.log(`✅ Successfully preloaded sound ${i}.mp3 (readyState: ${audio.readyState})`);
                } else {
                    console.warn(`❌ Failed to preload sound ${i}.mp3 - no audio returned`);
                }
            }).catch(e => {
                console.error(`❌ Failed to preload sound ${i}.mp3:`, e);
            })
        );
    }
    
    // Wait for all audio files to load (or fail)
    await Promise.allSettled(loadPromises);
    
    // Count successfully loaded sounds
    const loadedSounds = [];
    for (let i = 1; i <= TOTAL_SOVA_SOUNDS; i++) {
        if (preloadedAudioFiles[i.toString()]) {
            loadedSounds.push(i);
        }
    }
    
    console.log(`🔊 Audio preloading complete: ${loadedSounds.length}/${TOTAL_SOVA_SOUNDS} SOVA sounds loaded`);
    console.log(`✅ Loaded sounds: [${loadedSounds.join(', ')}]`);
    
    if (loadedSounds.length === 0) {
        console.error('⚠️ NO SOVA SOUNDS LOADED! Check audio file paths and network connectivity.');
    }
};

const CyberpunkLoadingScreen: React.FC<CyberpunkLoadingScreenProps> = ({ authLoading, spacetimeLoading = false, onSequenceComplete, musicPreloadProgress = 0, musicPreloadComplete = false }) => {

    const [visibleLogs, setVisibleLogs] = useState<string[]>([]);
    const [currentLogIndex, setCurrentLogIndex] = useState(0);
    const [isSequenceComplete, setIsSequenceComplete] = useState(false);
    
    // Audio state
    const [audioContextUnlocked, setAudioContextUnlocked] = useState(false);
    const [isSovaSpeaking, setIsSovaSpeaking] = useState(false);
    const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null); // Track current playing audio
    const [audioPreloaded, setAudioPreloaded] = useState(false);
    const [showAudioPrompt, setShowAudioPrompt] = useState(false);
    const [isHoveringOverSova, setIsHoveringOverSova] = useState(false); // Track hover state
    const [tooltipText, setTooltipText] = useState<string>(''); // Custom tooltip
    const [showTooltip, setShowTooltip] = useState(false);
    const hasPlayedReconnect = useRef(false);
    const audioPreloadStarted = useRef(false);
    const consoleLogsRef = useRef<HTMLDivElement>(null);

    const logs = React.useMemo(() => {
        const baseLogs = authLoading ? [
            "└─ Initializing quantum encryption protocols...",
            "└─ Verifying neural identity matrix...",
            "└─ Establishing secure link to authentication nexus...",
            "└─ Authenticating biometric signature...",
            "└─ [AUTH] Identity verified. Welcome, Survivor.",
        ] : spacetimeLoading ? [
            "└─ [AUTH] Identity verification complete.",
            "└─ Scanning for Arkyv node broadcasts...",
            "└─ [NETWORK] Detecting Zvezdanet backbone signals...",
            "└─ Establishing quantum tunnel to Babachain...",
            "└─ [CRYPTO] Synchronizing blockchain ledger...",
            "└─ Handshaking with distributed survivor network...",
            "└─ [MESH] P2P connection protocols active...",
            "└─ [READY] Babachain connection established. Initializing world access...",
        ] : [
            "└─ Loading encrypted world state from distributed cache...",
            "└─ [WORLD] Verifying territorial claims and resource deposits...",
            "└─ Initializing real-time consensus mechanisms...",
        ];

        // Add music preload status for non-auth loading
        if (!authLoading) {
            if (musicPreloadProgress > 0 && musicPreloadProgress < 1) {
                const percentage = Math.round(musicPreloadProgress * 100);
                baseLogs.push(`└─ [AUDIO] Preloading ambient soundtrack... ${percentage}%`);
            } else if (musicPreloadComplete) {
                baseLogs.push("└─ [AUDIO] Ambient soundtrack loaded. Environment ready.");
            }
            
            baseLogs.push("└─ [READY] Connection to Babachain established. Entering world...");
        }

        return baseLogs;
    }, [authLoading, spacetimeLoading, musicPreloadProgress, musicPreloadComplete]);

    // Auto-scroll to bottom function
    const scrollToBottom = () => {
        if (consoleLogsRef.current) {
            consoleLogsRef.current.scrollTop = consoleLogsRef.current.scrollHeight;
        }
    };

    // Initialize audio preloading
    useEffect(() => {
        if (!audioPreloadStarted.current) {
            audioPreloadStarted.current = true;
            preloadAudio().finally(() => {
                setAudioPreloaded(true);
                console.log('Audio preloading completed');
            });
        }
    }, []);

    // Function to unlock audio context and play random SOVA sound
    const attemptToPlayRandomSovaSound = async () => {
        // Don't auto-play if we've already played something or if audio isn't ready
        if (hasPlayedReconnect.current || !audioPreloaded) {
            console.log('Skipping auto-play: already played or audio not ready');
            return;
        }

        // Find all available SOVA sounds that are actually loaded
        const availableSounds: string[] = [];
        for (let i = 1; i <= TOTAL_SOVA_SOUNDS; i++) {
            const soundKey = i.toString(); // Use numeric string keys like "1", "2", etc.
            const audio = preloadedAudioFiles[soundKey];
            if (audio && audio.readyState >= 2) { // HAVE_CURRENT_DATA or better
                availableSounds.push(soundKey);
            }
        }

        if (availableSounds.length === 0) {
            console.log('No SOVA sounds loaded and ready, skipping auto-play');
            return;
        }

        // Pick a random sound from available ones
        const randomIndex = Math.floor(Math.random() * availableSounds.length);
        const randomSoundKey = availableSounds[randomIndex];
        const randomAudio = preloadedAudioFiles[randomSoundKey];
        const randomSoundNumber = randomSoundKey; // Already a number string

        if (!randomAudio) {
            console.log('Selected audio not found, skipping auto-play');
            return;
        }

        try {
            // Try to play the random SOVA sound
            setIsSovaSpeaking(true);
            setCurrentAudio(randomAudio); // Track the current audio
            await randomAudio.play();
            console.log(`Successfully auto-played SOVA sound ${randomSoundNumber}.mp3`);
            setAudioContextUnlocked(true);
            hasPlayedReconnect.current = true;
            
            // Save that audio is working for this user
            saveAudioPreference(true);
            
            // Set up event listener for when audio ends
            const handleAutoAudioEnd = () => {
                setIsSovaSpeaking(false);
                setCurrentAudio(null);
                randomAudio.removeEventListener('ended', handleAutoAudioEnd);
            };
            randomAudio.addEventListener('ended', handleAutoAudioEnd, { once: true });
            
        } catch (error) {
            console.log('Auto-play failed (likely due to browser autoplay policy):', error);
            setIsSovaSpeaking(false);
            setCurrentAudio(null);
            
            // Show the audio prompt to let user enable audio
            setShowAudioPrompt(true);
            saveAudioPreference(false);
        }
    };

    // Handle Sova avatar click to play random sounds
    const handleSovaClick = async () => {
        // If showing audio prompt, clicking SOVA should enable audio AND play a sound
        if (showAudioPrompt) {
            setShowAudioPrompt(false);
            // Don't return early - continue to play a sound after dismissing the prompt
            console.log('SOVA: Audio prompt dismissed, now playing sound...');
        }

        // If audio is currently playing, stop it
        if (isSovaSpeaking && currentAudio) {
            console.log('Stopping current SOVA audio...');
            
            // Stop the currently tracked audio
            currentAudio.pause();
            currentAudio.currentTime = 0;
            
            setIsSovaSpeaking(false);
            setCurrentAudio(null);
            console.log('SOVA audio stopped');
            return;
        }

        // Don't allow starting new audio if something is still playing
        if (isSovaSpeaking) {
            console.log('SOVA is still speaking, please wait...');
            return;
        }
        
        // Get available sounds (any loaded sound)
        const availableSounds = [];
        console.log('SOVA: Checking available sounds...');
        for (let i = 1; i <= TOTAL_SOVA_SOUNDS; i++) {
            const audio = preloadedAudioFiles[i.toString()];
            if (audio) {
                console.log(`SOVA: Sound ${i} exists, readyState: ${audio.readyState}`);
                // Check if audio is ready to play (readyState >= 2 means HAVE_CURRENT_DATA or better)
                if (audio.readyState >= 2) {
                    availableSounds.push(i.toString());
                } else {
                    console.log(`SOVA: Sound ${i} not ready (readyState: ${audio.readyState})`);
                }
            } else {
                console.log(`SOVA: Sound ${i} missing from preloadedAudioFiles`);
            }
        }

        console.log(`SOVA: Found ${availableSounds.length} available sounds:`, availableSounds);

        if (availableSounds.length === 0) {
            console.log('SOVA: No sounds ready to play. Trying to load one on-demand...');
            
            // Try to find any audio that exists but isn't ready yet
            const loadingSounds = [];
            for (let i = 1; i <= TOTAL_SOVA_SOUNDS; i++) {
                const audio = preloadedAudioFiles[i.toString()];
                if (audio && audio.readyState < 2) {
                    loadingSounds.push(i.toString());
                }
            }
            
            if (loadingSounds.length > 0) {
                console.log(`SOVA: ${loadingSounds.length} sounds are loading, will try first one:`, loadingSounds[0]);
                // Use the first loading sound anyway
                availableSounds.push(loadingSounds[0]);
            } else {
                // Try to load a sound on-demand
                console.log('SOVA: No preloaded sounds found. Attempting on-demand load...');
                try {
                    const randomSoundNumber = Math.floor(Math.random() * TOTAL_SOVA_SOUNDS) + 1;
                    const onDemandAudio = await tryLoadAudio(`${randomSoundNumber}.mp3`);
                    if (onDemandAudio) {
                        onDemandAudio.volume = 0.85;
                        preloadedAudioFiles[randomSoundNumber.toString()] = onDemandAudio;
                        availableSounds.push(randomSoundNumber.toString());
                        console.log(`✅ Successfully loaded sound ${randomSoundNumber}.mp3 on-demand`);
                    } else {
                        console.log('❌ On-demand audio loading failed');
                        return;
                    }
                } catch (error) {
                    console.error('❌ On-demand audio loading error:', error);
                    return;
                }
            }
        }

        // Pick a random available sound
        const randomIndex = Math.floor(Math.random() * availableSounds.length);
        const soundToPlay = availableSounds[randomIndex];
        const audioElement = preloadedAudioFiles[soundToPlay];

        console.log(`Playing SOVA sound ${soundToPlay}.mp3`);
        setIsSovaSpeaking(true);
        setCurrentAudio(audioElement); // Track the current audio

        // Add event listeners for when audio ends
        const handleAudioEnd = () => {
            setIsSovaSpeaking(false);
            setCurrentAudio(null); // Clear current audio reference
            audioElement.removeEventListener('ended', handleAudioEnd);
            audioElement.removeEventListener('pause', handleAudioEnd);
        };

        audioElement.addEventListener('ended', handleAudioEnd);
        audioElement.addEventListener('pause', handleAudioEnd);

        try {
            audioElement.currentTime = 0; // Reset to beginning
            await audioElement.play();
            
            // Unlock audio context if it wasn't already
            if (!audioContextUnlocked) {
                setAudioContextUnlocked(true);
            }
        } catch (error) {
            console.error(`Failed to play SOVA sound ${soundToPlay}:`, error);
            setIsSovaSpeaking(false);
            setCurrentAudio(null); // Clear current audio reference on error
        }
    };

    // Try to play random SOVA sound when component mounts and audio is preloaded
    useEffect(() => {
        // Only attempt auto-play if audio is preloaded and we haven't tried yet
        if (audioPreloaded && !hasPlayedReconnect.current) {
            console.log('Audio preloaded, attempting auto-play...');
            // Small delay to ensure everything is ready
            const timer = setTimeout(attemptToPlayRandomSovaSound, 200);
            return () => clearTimeout(timer);
        }
    }, [audioPreloaded]); // Depend on audioPreloaded instead of component mount

    useEffect(() => {
        if (currentLogIndex < logs.length) {
            console.log(`[CyberpunkLoadingScreen] Showing log ${currentLogIndex + 1}/${logs.length}: ${logs[currentLogIndex]}`);
            const timer = setTimeout(() => {
                setVisibleLogs(prev => [...prev, logs[currentLogIndex]]);
                setCurrentLogIndex(prev => prev + 1);
                // Scroll to bottom after adding new log
                setTimeout(scrollToBottom, 100);
            }, 300 + Math.random() * 200); // Faster timing: 300-500ms instead of 800-1200ms

            return () => clearTimeout(timer);
        } else if (currentLogIndex >= logs.length && !isSequenceComplete) {
            // Sequence is complete, add a small delay then show click to continue
            console.log(`[CyberpunkLoadingScreen] All logs complete, setting sequence complete`);
            const timer = setTimeout(() => {
                setIsSequenceComplete(true);
                // Scroll to bottom to show the continue button
                setTimeout(scrollToBottom, 200);
            }, 500); // Shorter delay

            return () => clearTimeout(timer);
        }
    }, [currentLogIndex, logs, isSequenceComplete]);

    // Handle click to continue - always allow continuation regardless of player state
    const handleContinueClick = () => {
        console.log(`[CyberpunkLoadingScreen] User clicked continue, calling onSequenceComplete (player state: any)`);
        onSequenceComplete?.();
    };
    
    // Fallback: If sequence gets stuck, auto-complete after a timeout
    useEffect(() => {
        if (currentLogIndex >= logs.length && !isSequenceComplete) {
            const fallbackTimer = setTimeout(() => {
                console.log('[CyberpunkLoadingScreen] Fallback: Force completing sequence');
                setIsSequenceComplete(true);
            }, 2000); // 2 second fallback
            
            return () => clearTimeout(fallbackTimer);
        }
    }, [currentLogIndex, logs.length, isSequenceComplete]);

    // Reset when authLoading changes, but only if we haven't started the sequence at all
    // Once started, let the sequence complete regardless of player state (including death)
    useEffect(() => {
        // Only reset if absolutely nothing has started yet
        if (currentLogIndex === 0 && visibleLogs.length === 0 && !isSequenceComplete) {
            console.log('[CyberpunkLoadingScreen] Resetting loading sequence due to authLoading change');
            setVisibleLogs([]);
            setCurrentLogIndex(0);
            setIsSequenceComplete(false);
        } else if (visibleLogs.length > 0 || currentLogIndex > 0) {
            // Sequence has started - don't reset, let it complete regardless of auth changes
            console.log('[CyberpunkLoadingScreen] Sequence in progress, ignoring authLoading changes');
        }
    }, [authLoading, currentLogIndex, visibleLogs.length, isSequenceComplete]);

    // Handle manual audio enable button click
    const handleEnableAudioClick = async () => {
        setShowAudioPrompt(false);
        
        try {
            // Find the first available sound to play
            let firstAvailableSound = null;
            for (let i = 1; i <= TOTAL_SOVA_SOUNDS; i++) {
                const soundKey = i.toString();
                const audio = preloadedAudioFiles[soundKey];
                if (audio && audio.readyState >= 2) {
                    firstAvailableSound = soundKey;
                    break;
                }
            }
            
            if (!firstAvailableSound) {
                console.log('No SOVA sounds available after enabling audio');
                return;
            }
            
            const audio = preloadedAudioFiles[firstAvailableSound];
            audio.currentTime = 0;
            setIsSovaSpeaking(true);
            setCurrentAudio(audio); // Track the current audio
            await audio.play();
            console.log(`Audio enabled and SOVA sound ${firstAvailableSound}.mp3 played after user interaction`);
            setAudioContextUnlocked(true);
            hasPlayedReconnect.current = true;
            
            // Save that the user has enabled audio
            saveAudioPreference(true);
            
            // Set up event listener for when audio ends
            const handleAudioEnd = () => {
                setIsSovaSpeaking(false);
                setCurrentAudio(null);
                audio.removeEventListener('ended', handleAudioEnd);
            };
            audio.addEventListener('ended', handleAudioEnd, { once: true });
            
        } catch (error) {
            console.error('Failed to enable audio and play SOVA sound:', error);
            setIsSovaSpeaking(false);
            setCurrentAudio(null);
            // Still hide the prompt even if audio fails
        }
    };

    return (
        <div className="cyberpunk-loading">
            <div className="grid-background"></div>
            
            <div className="console-container">
                {/* Custom Cyberpunk Tooltip */}
                {showTooltip && tooltipText && (
                    <div className="cyberpunk-tooltip">
                        <div className="cyberpunk-tooltip-content">
                            <span className="cyberpunk-tooltip-text">{tooltipText}</span>
                            <div className="cyberpunk-tooltip-glow"></div>
                        </div>
                    </div>
                )}
                
                <img 
                    src={sovaImage} 
                    alt="Sova Avatar" 
                    className={`sova-avatar ${
                        isSovaSpeaking ? 'speaking' : ''
                    } ${
                        showAudioPrompt ? 'needs-interaction' : ''
                    } ${
                        isSovaSpeaking && isHoveringOverSova ? 'red-glow' : ''
                    }`}
                    onClick={handleSovaClick}
                    style={{ 
                        cursor: 'pointer',
                        transition: 'filter 0.2s ease',
                        opacity: isSovaSpeaking ? 1 : 0.9
                    }}
                    onMouseEnter={() => {
                        console.log(`SOVA: Mouse entered - isSovaSpeaking=${isSovaSpeaking}, setting hover=true`);
                        setIsHoveringOverSova(true);
                        const tooltip = isSovaSpeaking 
                            ? "TERMINATE SOVA AUDIO STREAM" 
                            : showAudioPrompt
                            ? "ENABLE SOVA AUDIO INTERFACE"
                            : "ACTIVATE SOVA COMMUNICATION";
                        setTooltipText(tooltip);
                        setShowTooltip(true);
                    }}
                    onMouseLeave={() => {
                        console.log(`SOVA: Mouse left - isSovaSpeaking=${isSovaSpeaking}, setting hover=false`);
                        setIsHoveringOverSova(false);
                        setShowTooltip(false);
                    }}
                />
                
                {showAudioPrompt && (
                    <div className={`audio-prompt ${hasUserEnabledAudio() ? 'returning-user' : 'new-user'}`}>
                        <div className="audio-prompt-content">
                            {hasUserEnabledAudio() ? (
                                // Streamlined prompt for returning users
                                <>
                                    <div className="audio-icon">🔊</div>
                                    <div className="audio-prompt-text">
                                        <div className="audio-prompt-title">RESUME SOVA AUDIO</div>
                                        <div className="audio-prompt-subtitle">Tap SOVA or click anywhere</div>
                                    </div>
                                </>
                            ) : (
                                // Full prompt for new users
                                <>
                                    <div className="audio-icon">🔊</div>
                                    <div className="audio-prompt-text">
                                        <div className="audio-prompt-title">AUDIO AVAILABLE</div>
                                        <div className="audio-prompt-subtitle">Click anywhere to enable SOVA audio</div>
                                    </div>
                                    <button className="enable-audio-button" onClick={handleEnableAudioClick}>
                                        ENABLE AUDIO
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                )}
                
                <div className="console-header">
                    <div className="console-title">
                        {authLoading ? 'NEURAL IDENTITY VERIFICATION' : 'SENTIENT OCULAR VIRTUAL ASSISTANT'}
                    </div>
                    <div className="console-subtitle">
                        {authLoading ? 'Rozhkov Neuroscience Authentication Protocol v2.47' : 'Arkyv Node • Zvezdanet Mesh Network • Quantum Consensus'}
                    </div>
                </div>

                <div className="console-logs" ref={consoleLogsRef}>
                    {visibleLogs.map((log, index) => (
                        <div key={index} className={`log-line ${index === visibleLogs.length - 1 ? 'typing' : ''}`}>
                            <span className="log-prefix">[{String(index + 1).padStart(2, '0')}]</span>
                            <span className="log-text">{log}</span>
                        </div>
                    ))}
                    {currentLogIndex < logs.length && (
                        <div className="cursor-line">
                            <span className="log-prefix">[{String(currentLogIndex + 1).padStart(2, '0')}]</span>
                            <span className="cursor">█</span>
                        </div>
                    )}
                    {isSequenceComplete && (
                        <div className="continue-prompt">
                            <div className="log-line">
                                <span className="log-prefix">[{'>>'}]</span>
                                <span className="log-text">System ready. Neural link established.</span>
                            </div>
                            <button 
                                className="continue-button"
                                onClick={handleContinueClick}
                            >
                                <span className="continue-text">ENTER BABACHAIN NETWORK</span>
                                <span className="continue-subtitle">Click to access reality</span>
                            </button>
                        </div>
                    )}
                </div>

                <div className="console-footer">
                    <div className="status-indicators">
                        <div className="status-item">
                            <span className="status-dot active"></span>
                            <span>NEURAL LINK</span>
                        </div>
                        <div className="status-item">
                            <span className="status-dot active"></span>
                            <span>QUANTUM TUNNEL</span>
                        </div>
                        <div className="status-item">
                            <span className="status-dot active"></span>
                            <span>MESH PROTOCOL</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CyberpunkLoadingScreen; 