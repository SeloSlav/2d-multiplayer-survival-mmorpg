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
    onSequenceComplete?: () => void;
}

// Audio preloading and management
const preloadedAudioFiles: { [key: string]: HTMLAudioElement } = {};
const TOTAL_SOVA_SOUNDS = 20;
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

// Function to try different audio paths
const tryLoadAudio = async (filename: string): Promise<HTMLAudioElement | null> => {
    const possiblePaths = [
        `/assets/sounds/${filename}`,
        `/src/assets/sounds/${filename}`,
        `./src/assets/sounds/${filename}`,
        `/client/src/assets/sounds/${filename}`,
        `./assets/sounds/${filename}`,
        `/sounds/${filename}`,
        `./${filename}`,
    ];

    for (const path of possiblePaths) {
        try {
            const audio = new Audio(path);
            
            // Test if the audio can load
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timeout')), 2000);
                
                audio.addEventListener('canplaythrough', () => {
                    clearTimeout(timeout);
                    resolve(audio);
                }, { once: true });
                
                audio.addEventListener('error', () => {
                    clearTimeout(timeout);
                    reject(new Error('Load failed'));
                }, { once: true });
                
                audio.preload = 'auto';
                audio.load();
            });
            
            console.log(`Successfully loaded ${filename} from path: ${path}`);
            return audio;
        } catch (e) {
            console.log(`Failed to load ${filename} from path: ${path}`);
        }
    }
    
    console.error(`Could not load ${filename} from any path`);
    return null;
};

// Preload all audio files
const preloadAudio = async () => {
    console.log('Preloading SOVA audio files...');
    
    // Preload numbered SOVA sounds (1-20)
    const loadPromises = [];
    for (let i = 1; i <= TOTAL_SOVA_SOUNDS; i++) {
        loadPromises.push(
            tryLoadAudio(`${i}.mp3`).then(audio => {
                if (audio) {
                    audio.volume = 0.85;
                    preloadedAudioFiles[i.toString()] = audio;
                    console.log(`Successfully preloaded ${i}.mp3`);
                }
            }).catch(e => {
                console.error(`Failed to preload ${i}.mp3:`, e);
            })
        );
    }
    
    // Wait for all audio files to load (or fail)
    await Promise.allSettled(loadPromises);
    
    const loadedCount = Object.keys(preloadedAudioFiles).length - (preloadedAudioFiles['reconnect'] ? 1 : 0);
    console.log(`Preloaded ${loadedCount}/${TOTAL_SOVA_SOUNDS} SOVA sounds + ${preloadedAudioFiles['reconnect'] ? 'reconnect' : 'no reconnect'}`);
};

const CyberpunkLoadingScreen: React.FC<CyberpunkLoadingScreenProps> = ({ authLoading, onSequenceComplete }) => {
    const [visibleLogs, setVisibleLogs] = useState<string[]>([]);
    const [currentLogIndex, setCurrentLogIndex] = useState(0);
    const [isSequenceComplete, setIsSequenceComplete] = useState(false);
    
    // Audio state
    const [audioContextUnlocked, setAudioContextUnlocked] = useState(false);
    const [playedSounds, setPlayedSounds] = useState<Set<string>>(new Set());
    const [isSovaSpeaking, setIsSovaSpeaking] = useState(false);
    const [audioPreloaded, setAudioPreloaded] = useState(false);
    const [showAudioPrompt, setShowAudioPrompt] = useState(false);
    const hasPlayedReconnect = useRef(false);
    const audioPreloadStarted = useRef(false);
    const consoleLogsRef = useRef<HTMLDivElement>(null);

    const logs = authLoading ? [
        "└─ Initializing quantum encryption protocols...",
        "└─ Verifying neural identity matrix...",
        "└─ Establishing secure link to authentication nexus...",
        "└─ Authenticating biometric signature...",
        "└─ [AUTH] Identity verified. Welcome, Survivor.",
    ] : [
        "└─ Scanning for Arkyv node broadcasts...",
        "└─ [NETWORK] Detecting Zvezdanet backbone signals...",
        "└─ Establishing quantum tunnel to Babachain...",
        "└─ [CRYPTO] Synchronizing blockchain ledger...",
        "└─ Handshaking with distributed survivor network...",
        "└─ [MESH] P2P connection protocols active...",
        "└─ Loading encrypted world state from distributed cache...",
        "└─ [WORLD] Verifying territorial claims and resource deposits...",
        "└─ Initializing real-time consensus mechanisms...",
        "└─ [READY] Connection to Babachain established. Entering world...",
    ];

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
        if (hasPlayedReconnect.current) return;
        
        const userPreviouslyEnabledAudio = hasUserEnabledAudio();
        console.log(`User previously enabled audio: ${userPreviouslyEnabledAudio}`);
        
        // Get all available sounds that are actually loaded
        const loadedSounds: string[] = [];
        for (let i = 1; i <= TOTAL_SOVA_SOUNDS; i++) {
            if (preloadedAudioFiles[i.toString()]) {
                loadedSounds.push(i.toString());
            }
        }
        
        if (loadedSounds.length === 0) {
            console.warn('No SOVA sounds loaded, skipping auto-play');
            hasPlayedReconnect.current = true; // Mark as attempted so we don't try again
            return;
        }
        
        // If user previously enabled audio, try harder to play automatically
        const maxAttempts = userPreviouslyEnabledAudio ? 
            Math.min(5, loadedSounds.length) : // Try more attempts for returning users
            Math.min(3, loadedSounds.length);   // Regular attempts for new users
        
        // Try up to maxAttempts different random sounds if one fails
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            attempts++;
            
            // Pick a random sound from loaded sounds
            const randomIndex = Math.floor(Math.random() * loadedSounds.length);
            const randomSoundNumber = loadedSounds[randomIndex];
            const randomAudio = preloadedAudioFiles[randomSoundNumber];
            
            console.log(`Attempt ${attempts}: Trying to auto-play SOVA sound ${randomSoundNumber}.mp3`);
            
            try {
                // Try to play the random SOVA sound
                setIsSovaSpeaking(true);
                await randomAudio.play();
                console.log(`Successfully auto-played SOVA sound ${randomSoundNumber}.mp3`);
                setAudioContextUnlocked(true);
                hasPlayedReconnect.current = true;
                
                // Save that audio is working for this user
                saveAudioPreference(true);
                
                // Mark this sound as played
                setPlayedSounds(prev => new Set([...prev, randomSoundNumber]));
                
                // Set up event listener for when audio ends
                const handleAutoAudioEnd = () => {
                    setIsSovaSpeaking(false);
                    randomAudio.removeEventListener('ended', handleAutoAudioEnd);
                    randomAudio.removeEventListener('pause', handleAutoAudioEnd);
                };
                
                randomAudio.addEventListener('ended', handleAutoAudioEnd);
                randomAudio.addEventListener('pause', handleAutoAudioEnd);
                
                return; // Success! Exit the function
                
            } catch (error) {
                console.warn(`Failed to auto-play SOVA sound ${randomSoundNumber}.mp3:`, error);
                setIsSovaSpeaking(false);
                
                // Remove this sound from the loaded sounds array and try another
                loadedSounds.splice(randomIndex, 1);
                
                if (loadedSounds.length === 0) {
                    console.warn('No more sounds to try');
                    break;
                }
            }
        }
        
        // If we get here, autoplay failed but we should still set up the fallback
        console.log('Auto-play failed for all attempts, setting up user interaction fallback');
        hasPlayedReconnect.current = true; // Mark as attempted
        setShowAudioPrompt(true); // Show the audio prompt to user
        
        // Set up a one-time click listener on the document to unlock audio
        const unlockAudio = async () => {
            if (loadedSounds.length === 0) return;
            
            try {
                // Create a silent audio context unlock
                const silentAudio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DwvGINBjiS2+/MdSUFLITP8dlHNwgZarvs4Z9OEQxPpeTuOGIQHwA');
                await silentAudio.play();
                silentAudio.pause();
                
                // Try to play any available sound
                const firstAvailableSound = loadedSounds[0];
                const audio = preloadedAudioFiles[firstAvailableSound];
                
                audio.currentTime = 0;
                setIsSovaSpeaking(true);
                await audio.play();
                console.log(`Audio unlocked and SOVA sound ${firstAvailableSound}.mp3 played after user interaction`);
                setAudioContextUnlocked(true);
                setShowAudioPrompt(false); // Hide the prompt once audio works
                
                // Save that the user has enabled audio
                saveAudioPreference(true);
                
                // Mark this sound as played
                setPlayedSounds(prev => new Set([...prev, firstAvailableSound]));
                
                // Set up event listener for when audio ends
                const handleAutoAudioEnd = () => {
                    setIsSovaSpeaking(false);
                    audio.removeEventListener('ended', handleAutoAudioEnd);
                    audio.removeEventListener('pause', handleAutoAudioEnd);
                };
                
                audio.addEventListener('ended', handleAutoAudioEnd);
                audio.addEventListener('pause', handleAutoAudioEnd);
                
            } catch (e) {
                console.error('Failed to unlock audio even after user interaction:', e);
                setIsSovaSpeaking(false);
                setShowAudioPrompt(false); // Hide prompt even if audio fails
            }
            
            // Remove the listener
            document.removeEventListener('click', unlockAudio);
            document.removeEventListener('keydown', unlockAudio);
            document.removeEventListener('touchstart', unlockAudio);
        };

        // Add listeners for user interaction
        document.addEventListener('click', unlockAudio, { once: true });
        document.addEventListener('keydown', unlockAudio, { once: true });
        document.addEventListener('touchstart', unlockAudio, { once: true });
    };

    // Handle Sova avatar click to play random sounds
    const handleSovaClick = async () => {
        // If showing audio prompt, clicking SOVA should enable audio
        if (showAudioPrompt) {
            setShowAudioPrompt(false);
            // Trigger audio unlock
            document.dispatchEvent(new Event('click'));
            return;
        }

        // Don't allow clicking if audio is currently playing
        if (isSovaSpeaking) {
            console.log('SOVA is currently speaking, please wait...');
            return;
        }
        
        // Get available sounds (not yet played)
        const availableSounds = [];
        for (let i = 1; i <= TOTAL_SOVA_SOUNDS; i++) {
            if (!playedSounds.has(i.toString()) && preloadedAudioFiles[i.toString()]) {
                availableSounds.push(i.toString());
            }
        }

        if (availableSounds.length === 0) {
            console.log('All SOVA sounds have been played');
            return;
        }

        // Pick a random available sound
        const randomIndex = Math.floor(Math.random() * availableSounds.length);
        const soundToPlay = availableSounds[randomIndex];
        const audioElement = preloadedAudioFiles[soundToPlay];

        console.log(`Playing SOVA sound ${soundToPlay}.mp3`);
        setIsSovaSpeaking(true);

        // Add event listeners for when audio ends
        const handleAudioEnd = () => {
            setIsSovaSpeaking(false);
            audioElement.removeEventListener('ended', handleAudioEnd);
            audioElement.removeEventListener('pause', handleAudioEnd);
        };

        audioElement.addEventListener('ended', handleAudioEnd);
        audioElement.addEventListener('pause', handleAudioEnd);

        try {
            audioElement.currentTime = 0; // Reset to beginning
            await audioElement.play();
            
            // Mark this sound as played
            setPlayedSounds(prev => new Set([...prev, soundToPlay]));
            
            // Unlock audio context if it wasn't already
            if (!audioContextUnlocked) {
                setAudioContextUnlocked(true);
            }
        } catch (error) {
            console.error(`Failed to play SOVA sound ${soundToPlay}:`, error);
            setIsSovaSpeaking(false);
        }
    };

    // Try to play random SOVA sound when component mounts
    useEffect(() => {
        // Small delay to ensure audio files are loaded
        const timer = setTimeout(attemptToPlayRandomSovaSound, 500);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (currentLogIndex < logs.length) {
            const timer = setTimeout(() => {
                setVisibleLogs(prev => [...prev, logs[currentLogIndex]]);
                setCurrentLogIndex(prev => prev + 1);
                // Scroll to bottom after adding new log
                setTimeout(scrollToBottom, 100);
            }, 300 + Math.random() * 200); // Faster timing: 300-500ms instead of 800-1200ms

            return () => clearTimeout(timer);
        } else if (currentLogIndex >= logs.length && !isSequenceComplete) {
            // Sequence is complete, add a small delay then show click to continue
            const timer = setTimeout(() => {
                setIsSequenceComplete(true);
                // Scroll to bottom to show the continue button
                setTimeout(scrollToBottom, 200);
            }, 500); // Shorter delay

            return () => clearTimeout(timer);
        }
    }, [currentLogIndex, logs, isSequenceComplete]);

    // Handle click to continue
    const handleContinueClick = () => {
        if (isSequenceComplete) {
            onSequenceComplete?.();
        }
    };

    // Reset when authLoading changes
    useEffect(() => {
        setVisibleLogs([]);
        setCurrentLogIndex(0);
        setIsSequenceComplete(false);
    }, [authLoading]);

    // Handle manual audio enable button click
    const handleEnableAudioClick = () => {
        setShowAudioPrompt(false);
        // Trigger a document click to unlock audio
        document.dispatchEvent(new Event('click'));
    };

    return (
        <div className="cyberpunk-loading">
            <div className="grid-background"></div>
            
            <div className="console-container">
                <img 
                    src={sovaImage} 
                    alt="Sova Avatar" 
                    className={`sova-avatar ${isSovaSpeaking ? 'speaking' : ''} ${showAudioPrompt ? 'needs-interaction' : ''}`}
                    onClick={handleSovaClick}
                    style={{ 
                        cursor: isSovaSpeaking ? 'not-allowed' : 'pointer',
                        filter: isSovaSpeaking 
                            ? 'drop-shadow(0 0 30px rgba(0, 255, 255, 1)) brightness(1.2)' 
                            : undefined,
                        transition: 'filter 0.3s ease',
                        opacity: isSovaSpeaking ? 1 : 0.9
                    }}
                    title={isSovaSpeaking 
                        ? "SOVA is speaking... please wait" 
                        : showAudioPrompt
                        ? "Click to enable SOVA audio!"
                        : `Click to hear SOVA speak (${TOTAL_SOVA_SOUNDS - playedSounds.size} sounds remaining)`
                    }
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