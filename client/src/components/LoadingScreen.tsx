import React, { useState, useEffect, useRef } from 'react';
import './LoadingScreen.css';

// Preload all possible audio files in advance
const preloadedAudioFiles = {};
const TOTAL_VOICE_FILES = 20; // Assuming we have 10 possible voice files
let audioLoadingProgress = 0;

// Immediately start preloading all audio files when this module loads
for (let i = 1; i <= TOTAL_VOICE_FILES; i++) {
  const audioPath = `/sounds/sova/${i}.mp3`;
  
  // Create an audio element for preloading
  const audioElement = new Audio();
  audioElement.preload = 'auto';
  audioElement.volume = 0.85; // Set a slightly lower volume by default
  
  // Use the fetch API for faster resource loading with high priority
  const fetchOptions = {
    priority: 'high',
    importance: 'high',
    credentials: 'same-origin'
  };
  
  try {
    // Create a link preload hint for the browser
    const linkPreload = document.createElement('link');
    linkPreload.rel = 'preload';
    linkPreload.as = 'fetch';
    linkPreload.href = audioPath;
    linkPreload.crossOrigin = 'same-origin'; // Match the credentials mode of the fetch request
    document.head.appendChild(linkPreload);
    
    // Now fetch with high priority
    fetch(audioPath, fetchOptions)
      .then(response => response.blob())
      .then(blob => {
        // Create a faster-to-decode audio source
        const objectURL = URL.createObjectURL(blob);
        audioElement.src = objectURL;
        preloadedAudioFiles[i] = { element: audioElement, objectURL };
        
        // Update loading progress
        audioLoadingProgress += (1 / TOTAL_VOICE_FILES) * 100;
        console.log(`Preloaded SOVA voice ${i} (${Math.round(audioLoadingProgress)}% complete)`);
        
        // Force a load event
        audioElement.load();
      })
      .catch(err => {
        console.error(`Failed to preload SOVA voice ${i}:`, err);
        // Still count as progress even if failed
        audioLoadingProgress += (1 / TOTAL_VOICE_FILES) * 100;
      });
  } catch (e) {
    // Fallback if any advanced features aren't supported
    console.warn(`Using fallback loading for voice ${i}:`, e);
    audioElement.src = audioPath;
    audioElement.load();
    
    // Count as loaded anyway to avoid blocking
    setTimeout(() => {
      preloadedAudioFiles[i] = { element: audioElement };
      audioLoadingProgress += (1 / TOTAL_VOICE_FILES) * 100;
    }, 500);
  }
}

// --- Preload the specific error sound --- 
const errorAudioPath = '/sounds/sova/error.mp3';
try {
  const errorAudioElement = new Audio();
  errorAudioElement.preload = 'auto';
  errorAudioElement.volume = 0.9; // Slightly louder for errors?

  const fetchOptions = {
    priority: 'high',
    importance: 'high',
    credentials: 'same-origin'
  };

  const linkPreloadError = document.createElement('link');
  linkPreloadError.rel = 'preload';
  linkPreloadError.as = 'fetch';
  linkPreloadError.href = errorAudioPath;
  linkPreloadError.crossOrigin = 'same-origin'; 
  document.head.appendChild(linkPreloadError);

  fetch(errorAudioPath, fetchOptions)
    .then(response => response.blob())
    .then(blob => {
      const objectURL = URL.createObjectURL(blob);
      errorAudioElement.src = objectURL;
      preloadedAudioFiles['error'] = { element: errorAudioElement, objectURL };
      console.log(`Preloaded SOVA error sound`);
      errorAudioElement.load();
    })
    .catch(err => {
      console.error(`Failed to preload SOVA error sound:`, err);
    });
} catch (e) {
  console.warn(`Using fallback loading for error sound:`, e);
  const fallbackErrorAudio = new Audio(errorAudioPath);
  fallbackErrorAudio.load();
  preloadedAudioFiles['error'] = { element: fallbackErrorAudio };
}
// --- End error sound preload --- 

// --- Preload the specific reconnect sound --- 
const reconnectAudioPath = '/sounds/sova/reconnect.mp3';
try {
  const reconnectAudioElement = new Audio();
  reconnectAudioElement.preload = 'auto';
  reconnectAudioElement.volume = 0.85;

  const fetchOptions = {
    priority: 'high',
    importance: 'high',
    credentials: 'same-origin'
  };

  const linkPreloadReconnect = document.createElement('link');
  linkPreloadReconnect.rel = 'preload';
  linkPreloadReconnect.as = 'fetch';
  linkPreloadReconnect.href = reconnectAudioPath;
  linkPreloadReconnect.crossOrigin = 'same-origin'; 
  document.head.appendChild(linkPreloadReconnect);

  fetch(reconnectAudioPath, fetchOptions)
    .then(response => response.blob())
    .then(blob => {
      const objectURL = URL.createObjectURL(blob);
      reconnectAudioElement.src = objectURL;
      preloadedAudioFiles['reconnect'] = { element: reconnectAudioElement, objectURL };
      console.log(`Preloaded SOVA reconnect sound`);
      reconnectAudioElement.load();
    })
    .catch(err => {
      console.error(`Failed to preload SOVA reconnect sound:`, err);
    });
} catch (e) {
  console.warn(`Using fallback loading for reconnect sound:`, e);
  const fallbackReconnectAudio = new Audio(reconnectAudioPath);
  fallbackReconnectAudio.load();
  preloadedAudioFiles['reconnect'] = { element: fallbackReconnectAudio };
}
// --- End reconnect sound preload --- 

// Cache a tiny silent audio file to help with autoplay restrictions
const silentAudio = new Audio('data:audio/mp3;base64,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');
silentAudio.preload = 'auto';
silentAudio.load();

// This component reacts to loading state changes and updates the terminal immediately
// And signals back to the parent when it's ready to hide
const LoadingScreen = ({ 
  connectionStatus,
  isTerrainLoaded,
  isPlayerInitialized,
  isInventoryLoaded,
  readyToHide = () => {} // Callback to signal when all messages are shown and timer elapsed
}) => {
  const [messages, setMessages] = useState([
    { type: 'message', content: 'NEUROVEIL™ OCULAR IMPLANT v3.7.9' },
    { type: 'message', content: '(SOVA) Sentient Ocular Virtual Assistant' },
    { type: 'message', content: '-------------------------------------' },
  ]);
  
  // Audio player reference and state - initialize as ready for immediate clickability
  const audioRef = useRef(null);
  const [audioReady, setAudioReady] = useState(true); // Start with true for immediate interaction
  // Track if SOVA is currently speaking
  const [isSovaSpeaking, setIsSovaSpeaking] = useState(false);
  
  // Track which commands have been shown to avoid duplicates
  const [shownCommands, setShownCommands] = useState({
    connection: false,
    player: false,
    terrain: false,
    inventory: false,
    game: false
  });
  
  // Delay command typing flag - allows immediate SOVA interaction
  const [canStartTyping, setCanStartTyping] = useState(false);
  
  // Current typing command (if any)
  const [currentTyping, setCurrentTyping] = useState(null);
  
  // Reference to track if we've signaled readiness
  const hasSignaledReadyRef = useRef(false);
  
  // Determine if the terrain error is currently active
  const isTerrainErrorActive = !isTerrainLoaded && canStartTyping;
  
  // Ref to track the previous error state
  const prevIsTerrainErrorActive = useRef(isTerrainErrorActive);
  
  // Initialize audio immediately but independently from everything else
  useEffect(() => {
    console.log('Initializing SOVA audio...');
    
    // Try to unlock audio context early with the silent audio
    const attemptToUnlockAudio = () => {
      // Try to play silent audio to unlock audio context
      if (silentAudio) {
        silentAudio.play()
          .then(() => {
            console.log('Successfully unlocked audio context');
            silentAudio.pause();
            silentAudio.currentTime = 0;
          })
          .catch(e => {
            console.log('Audio context still locked, waiting for user interaction', e);
          });
      }
    };
    
    // Try to unlock audio immediately and every second
    attemptToUnlockAudio();
    const unlockInterval = setInterval(attemptToUnlockAudio, 1000);
    
    // Generate a random number between 1 and 10
    const randomVoiceNumber = Math.floor(Math.random() * TOTAL_VOICE_FILES) + 1;
    
    // Create event handler functions
    const handlePlay = () => setIsSovaSpeaking(true);
    const handlePause = () => setIsSovaSpeaking(false);
    const handleEnded = () => setIsSovaSpeaking(false);
    
    // Check if we already have this audio preloaded
    if (preloadedAudioFiles[randomVoiceNumber]) {
      console.log(`Using preloaded SOVA voice ${randomVoiceNumber}`);
      const preloadedAudio = preloadedAudioFiles[randomVoiceNumber].element;
      
      // Add event listeners for audio state
      preloadedAudio.addEventListener('play', handlePlay);
      preloadedAudio.addEventListener('pause', handlePause);
      preloadedAudio.addEventListener('ended', handleEnded);
      
      // Set the audio reference
      audioRef.current = preloadedAudio;
    } else {
      // Fallback to traditional loading if preloading failed
      const audioPath = `/sounds/sova/${randomVoiceNumber}.mp3`;
      console.log(`Fallback loading for SOVA voice ${randomVoiceNumber}`);
      
      // Create audio element with priority loading
      const audio = new Audio(audioPath);
      audio.volume = 0.85;
      audio.preload = 'auto'; // Force preloading
      
      // Add event listeners for audio state
      audio.addEventListener('play', handlePlay);
      audio.addEventListener('pause', handlePause);
      audio.addEventListener('ended', handleEnded);
      
      // Set the audio reference and force loading
      audioRef.current = audio;
      audio.load();
    }
    
    return () => {
      // Cleanup function
      clearInterval(unlockInterval);
      if (audioRef.current) {
        audioRef.current.removeEventListener('play', handlePlay);
        audioRef.current.removeEventListener('pause', handlePause);
        audioRef.current.removeEventListener('ended', handleEnded);
      }
    };
  }, []);
  
  // --- Play error/reconnect sounds based on terrain error state changes --- 
  useEffect(() => {
    // Check if the error state *just* became active
    if (isTerrainErrorActive && !prevIsTerrainErrorActive.current) {
      // Stop current SOVA voice if playing
      if (audioRef.current && !audioRef.current.paused) {
        console.log('[LoadingScreen] Stopping current SOVA voice due to terrain error.');
        audioRef.current.pause();
        audioRef.current.currentTime = 0; // Reset position
      }

      // Play the preloaded error sound
      const errorAudio = preloadedAudioFiles['error']?.element;
      if (errorAudio && errorAudio.readyState >= 2) { // Check if ready
        console.log('[LoadingScreen] Playing SOVA error sound.');
        errorAudio.currentTime = 0;
        errorAudio.play().catch(err => {
          console.error('Failed to play SOVA error sound:', err);
        });
      }
    } 
    // Check if the error state *just* became inactive (recovered)
    else if (!isTerrainErrorActive && prevIsTerrainErrorActive.current) {
      console.log('[LoadingScreen] Terrain loaded after error, playing reconnect sound.');
      
      // Stop the error sound if it's playing
      const errorAudio = preloadedAudioFiles['error']?.element;
      if (errorAudio && !errorAudio.paused) {
        errorAudio.pause();
        errorAudio.currentTime = 0;
      }

      // Play the reconnect sound
      const reconnectAudio = preloadedAudioFiles['reconnect']?.element;
      if (reconnectAudio && reconnectAudio.readyState >= 2) {
        reconnectAudio.currentTime = 0;
        reconnectAudio.play().catch(err => {
          console.error('Failed to play SOVA reconnect sound:', err);
        });
      }
    }

    // Update the previous state ref *after* checking the transition
    prevIsTerrainErrorActive.current = isTerrainErrorActive;

  }, [isTerrainErrorActive]); // Re-run when error state changes
  // --- End error/reconnect sound effect --- 

  // Separate effect to allow a delay before starting command typing
  useEffect(() => {
    // Give a small delay before starting command typing to allow user to click SOVA first
    const timer = setTimeout(() => {
      setCanStartTyping(true);
    }, 1000); // 1-second delay before commands start typing
    
    return () => clearTimeout(timer);
  }, []);

  // Process connection status change - only starts after canStartTyping is true
  useEffect(() => {
    if (connectionStatus && !shownCommands.connection && canStartTyping) {
      // Use a separate thread of execution
      setTimeout(() => {
        // Calculate a better timing based on length
        const commandText = './neural_sync.exe --establish-brainwave-connection';
        const typingDuration = Math.min(1500, commandText.length * 25); // Cap at 1500ms
        
        // Add the connection command with typing animation
        setCurrentTyping({ 
          type: 'command', 
          key: 'connection', 
          content: commandText
        });
        
        // After typing animation, add command to messages
        const timer = setTimeout(() => {
          setCurrentTyping(null);
          setMessages(prev => [
            ...prev,
            { type: 'command', content: commandText },
            { type: 'message', content: 'Brainwave synchronization established. Bioelectric interface online.' }
          ]);
          setShownCommands(prev => ({ ...prev, connection: true }));
        }, typingDuration);
      }, 0);
    }
  }, [connectionStatus, shownCommands.connection, canStartTyping]);
  
  // Process player initialization
  useEffect(() => {
    if (isPlayerInitialized && !shownCommands.player && shownCommands.connection && canStartTyping) {
      // Use a separate thread of execution
      setTimeout(() => {
        const commandText = './calibrate_consciousness.exe --load-user-profile';
        const typingDuration = Math.min(1500, commandText.length * 25);
        
        setCurrentTyping({ 
          type: 'command', 
          key: 'player', 
          content: commandText 
        });
        
        const timer = setTimeout(() => {
          setCurrentTyping(null);
          setMessages(prev => [
            ...prev,
            { type: 'command', content: commandText },
            { type: 'message', content: 'User identity verified. Consciousness patterns aligned.' }
          ]);
          setShownCommands(prev => ({ ...prev, player: true }));
        }, typingDuration);
      }, 0);
    }
  }, [isPlayerInitialized, shownCommands.player, shownCommands.connection, canStartTyping]);
  
  // Process terrain loading
  useEffect(() => {
    if (isTerrainLoaded && !shownCommands.terrain && shownCommands.player && canStartTyping) {
      // Use a separate thread of execution
      setTimeout(() => {
        const commandText = './load_perception_matrix.exe --high-resolution';
        const typingDuration = Math.min(1500, commandText.length * 25);
        
        setCurrentTyping({ 
          type: 'command', 
          key: 'terrain', 
          content: commandText 
        });
        
        const timer = setTimeout(() => {
          setCurrentTyping(null);
          setMessages(prev => [
            ...prev,
            { type: 'command', content: commandText },
            { type: 'message', content: 'Perception matrix loaded. Visual cortex integration complete.' }
          ]);
          setShownCommands(prev => ({ ...prev, terrain: true }));
        }, typingDuration);
      }, 0);
    }
  }, [isTerrainLoaded, shownCommands.terrain, shownCommands.player, canStartTyping]);
  
  // Process inventory loading
  useEffect(() => {
    if (isInventoryLoaded && !shownCommands.inventory && shownCommands.terrain && canStartTyping) {
      // Use a separate thread of execution
      setTimeout(() => {
        const commandText = './memory_imprint.exe --restore-last-session';
        const typingDuration = Math.min(1500, commandText.length * 25);
        
        setCurrentTyping({ 
          type: 'command', 
          key: 'inventory', 
          content: commandText 
        });
        
        const timer = setTimeout(() => {
          setCurrentTyping(null);
          setMessages(prev => [
            ...prev,
            { type: 'command', content: commandText },
            { type: 'message', content: 'Memory imprints restored. Neural inventory accessible.' }
          ]);
          setShownCommands(prev => ({ ...prev, inventory: true }));
        }, typingDuration);
      }, 0);
    }
  }, [isInventoryLoaded, shownCommands.inventory, shownCommands.terrain, canStartTyping]);
  
  // Process game start (after everything is loaded)
  useEffect(() => {
    if (connectionStatus && isPlayerInitialized && isTerrainLoaded && isInventoryLoaded && 
        !shownCommands.game && shownCommands.inventory && canStartTyping) {
      // Use a separate thread of execution
      setTimeout(() => {
        const commandText = './activate_sova.exe --full-consciousness';
        const typingDuration = Math.min(1500, commandText.length * 25);
        
        setCurrentTyping({ 
          type: 'command', 
          key: 'game', 
          content: commandText 
        });
        
        const timer = setTimeout(() => {
          setCurrentTyping(null);
          setMessages(prev => [
            ...prev,
            { type: 'command', content: commandText },
            { type: 'message', content: 'SOVA awakened. Welcome to your Neuroveil reality interface...' }
          ]);
          setShownCommands(prev => ({ ...prev, game: true }));
        }, typingDuration);
      }, 0);
    }
  }, [connectionStatus, isPlayerInitialized, isTerrainLoaded, isInventoryLoaded, 
      shownCommands.game, shownCommands.inventory, canStartTyping]);
  
  // When all messages are shown and game is ready, signal to parent after a delay
  useEffect(() => {
    // Check if all messages shown, game is ready, and we haven't signaled yet
    const allStepsComplete = shownCommands.game && 
        connectionStatus && 
        isPlayerInitialized && 
        isTerrainLoaded && 
                            isInventoryLoaded; // Consider removing inventory check if not essential
      
    if (allStepsComplete && !hasSignaledReadyRef.current) {
      console.log('[LoadingScreen] All loading steps completed, signaling ready to hide in 3 seconds...');
      hasSignaledReadyRef.current = true; // Set ref immediately to prevent multiple timers
      
      const timer = setTimeout(() => {
        console.log('[LoadingScreen] Signaling readyToHide(true)');
        readyToHide(true);
      }, 3000); // 3-second delay
      
      // Cleanup function for this specific timer
      return () => {
        console.log('[LoadingScreen] Cleanup: Clearing readyToHide timer');
        clearTimeout(timer);
      };
    }
  }, [
    shownCommands.game, 
    connectionStatus, 
    isPlayerInitialized, 
    isTerrainLoaded, 
    isInventoryLoaded, // Remove if check is removed above
    readyToHide // Include readyToHide in dependencies
  ]);
  
  // Scroll to bottom when messages change
  useEffect(() => {
    const terminalContent = document.querySelector('.terminal-content');
    if (terminalContent) {
      terminalContent.scrollTop = terminalContent.scrollHeight;
    }
  }, [messages, currentTyping]);
  
  return (
    <div className="loading-screen">
      <div className="loading-content">
        <div className={`sova-image ${isSovaSpeaking ? 'speaking' : audioReady ? 'ready' : 'loading'} ${isTerrainErrorActive ? 'terrain-error-active' : ''}`}>
          <img 
            src="/images/sova.png"
            alt="SOVA AI Assistant"
            title={isTerrainErrorActive ? "SOVA Interface Unavailable - Critical Error" : "Click to hear SOVA speak"}
            style={isSovaSpeaking || isTerrainErrorActive ? { pointerEvents: 'none' } : {}} // Disable pointer events if speaking OR terrain error
            onClick={() => {
              // Only handle click if SOVA is not speaking AND terrain error is NOT active
              if (!isSovaSpeaking && !isTerrainErrorActive) {
                // Always provide immediate visual feedback
                setIsSovaSpeaking(true);
                
                // Attempt to play audio immediately
                if (audioRef.current) {
                  console.log('Attempting to play SOVA audio on user click');
                  
                  // If the audio is already loaded and ready to play, just reset and play it
                  if (audioRef.current.readyState >= 2) { // HAVE_CURRENT_DATA or better
                    audioRef.current.currentTime = 0; // Ensure we start from beginning
                    
                    // Play with high priority
                    const playPromise = audioRef.current.play();
                    if (playPromise !== undefined) {
                      playPromise.then(() => {
                        console.log('SOVA audio playback started successfully');
                      }).catch(err => {
                        console.error('SOVA audio playback failed:', err);
                        // If audio fails, still show visual feedback briefly
                        setTimeout(() => setIsSovaSpeaking(false), 2000);
                      });
                    }
                  } else {
                    // Try to find any preloaded audio that's ready
                    const availableAudios = Object.values(preloadedAudioFiles)
                      .filter(audio => audio.element.readyState >= 2);
                    
                    if (availableAudios.length > 0) {
                      // Use a random preloaded audio file that's ready
                      const randomIndex = Math.floor(Math.random() * availableAudios.length);
                      const readyAudio = availableAudios[randomIndex].element;
                      
                      // Update audio reference and wire up events
                      const handlePlay = () => setIsSovaSpeaking(true);
                      const handlePause = () => setIsSovaSpeaking(false);
                      const handleEnded = () => setIsSovaSpeaking(false);
                      
                      readyAudio.addEventListener('play', handlePlay);
                      readyAudio.addEventListener('pause', handlePause);
                      readyAudio.addEventListener('ended', handleEnded);
                      
                      // Clean up old audio if it exists
                      if (audioRef.current) {
                        audioRef.current.removeEventListener('play', handlePlay);
                        audioRef.current.removeEventListener('pause', handlePause);
                        audioRef.current.removeEventListener('ended', handleEnded);
                      }
                      
                      // Set new audio and play
                      audioRef.current = readyAudio;
                      readyAudio.currentTime = 0;
                      readyAudio.play().then(() => {
                        console.log('Alternative SOVA audio playback started successfully');
                      }).catch(err => {
                        console.error('Alternative SOVA audio playback failed:', err);
                        setTimeout(() => setIsSovaSpeaking(false), 2000);
                      });
                    } else {
                      console.warn('No preloaded audio files are ready, trying current audio');
                      // Try the current audio as a fallback
                      audioRef.current.currentTime = 0;
                      audioRef.current.play().catch(err => {
                        console.error('Fallback SOVA audio playback failed:', err);
                        setTimeout(() => setIsSovaSpeaking(false), 2000);
                      });
                    }
                  }
                } else {
                  console.warn('Audio not initialized yet');
                  // Show visual feedback briefly if no audio
                  setTimeout(() => setIsSovaSpeaking(false), 2000);
                }
              }
            }}
          />
        </div>

        <div className="terminal-header">
          NEUROVEIL™ OCULAR INTERFACE SYSTEM
        </div>
        <div className="terminal-content">
          {/* Render all messages */}
          {messages.map((message, index) => (
            <div key={index} className="terminal-line">
              {message.type === 'command' ? (
                <>
                  <span className="terminal-prompt">{'>'}</span>
                  <span className="terminal-command">{message.content}</span>
                </>
              ) : message.type === 'error' ? (
                <span className="terminal-error">{message.content}</span>
              ) : (
                <span className="terminal-message">{message.content}</span>
              )}
            </div>
          ))}
          
          {/* Conditionally render terrain error messages */}
          {isTerrainErrorActive && (
            <>
              <div className="terminal-line">
                <span className="terminal-error">CRITICAL ERROR: PERCEPTION MATRIX FAILED</span>
              </div>
              <div className="terminal-line">
                <span className="terminal-error">Unable to load local reality grid from perception matrix server.</span>
              </div>
              <div className="terminal-line">
                <span className="terminal-error">Visual cortex link unstable. Retrying synchronization...</span>
              </div>
            </>
          )}
          
          {/* Render currently typing command */}
          {currentTyping && (
            <div className="terminal-line">
              <span className="terminal-prompt">{'>'}</span>
              <span 
                className="terminal-command typing-animation" 
                style={{ '--char-count': currentTyping.content.length }}
              >
                {currentTyping.content}
              </span>
              <span className="terminal-cursor"></span>
            </div>
          )}
          
          {/* Show blinking cursor at the end */}
          {shownCommands.game && (
            <div className="terminal-cursor-standalone"></div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoadingScreen;