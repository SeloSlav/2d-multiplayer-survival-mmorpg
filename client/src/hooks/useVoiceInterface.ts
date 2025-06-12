import { useState, useEffect, useCallback, useRef } from 'react';

interface UseVoiceInterfaceProps {
  isEnabled?: boolean;
  isChatting?: boolean;
  isGameMenuOpen?: boolean;
  isInventoryOpen?: boolean;
}

interface VoiceInterfaceState {
  isVisible: boolean;
  isRecording: boolean;
  error: string | null;
}

export const useVoiceInterface = ({
  isEnabled = true,
  isChatting = false,
  isGameMenuOpen = false,
  isInventoryOpen = false,
}: UseVoiceInterfaceProps = {}) => {
  const [voiceState, setVoiceState] = useState<VoiceInterfaceState>({
    isVisible: false,
    isRecording: false,
    error: null,
  });

  const isVKeyPressedRef = useRef(false);
  const keyDownTimeRef = useRef<number | null>(null);

  // Check if voice interface should be blocked
  const isBlocked = isChatting || isGameMenuOpen || isInventoryOpen || !isEnabled;

  // Handle V key press and release
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Block if any UI is open or if already pressed
    if (isBlocked || isVKeyPressedRef.current) return;

    if (event.key.toLowerCase() === 'v' && !event.repeat) {
      console.log('[VoiceInterface] V key pressed - starting voice interface');
      isVKeyPressedRef.current = true;
      keyDownTimeRef.current = Date.now();
      
      setVoiceState(prev => ({
        ...prev,
        isVisible: true,
        error: null,
      }));
    }
  }, [isBlocked]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (event.key.toLowerCase() === 'v' && isVKeyPressedRef.current) {
      console.log('[VoiceInterface] V key released - stopping voice interface');
      isVKeyPressedRef.current = false;
      
      // Calculate how long the key was held
      const holdDuration = keyDownTimeRef.current 
        ? Date.now() - keyDownTimeRef.current 
        : 0;
      
      console.log('[VoiceInterface] V key held for:', holdDuration, 'ms');
      
      setVoiceState(prev => ({
        ...prev,
        isVisible: false,
        isRecording: false,
      }));
      
      keyDownTimeRef.current = null;
    }
  }, []);

  // Set up keyboard event listeners
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  // Handle transcription completion
  const handleTranscriptionComplete = useCallback((text: string) => {
    console.log('[VoiceInterface] Transcription completed:', text);
    setVoiceState(prev => ({
      ...prev,
      isVisible: false,
      isRecording: false,
    }));
  }, []);

  // Handle errors
  const handleError = useCallback((error: string) => {
    console.error('[VoiceInterface] Error:', error);
    setVoiceState(prev => ({
      ...prev,
      error,
      isVisible: false,
      isRecording: false,
    }));
    
    // Clear error after a few seconds
    setTimeout(() => {
      setVoiceState(prev => ({
        ...prev,
        error: null,
      }));
    }, 3000);
  }, []);

  // Force close interface (for cleanup)
  const forceClose = useCallback(() => {
    isVKeyPressedRef.current = false;
    keyDownTimeRef.current = null;
    setVoiceState({
      isVisible: false,
      isRecording: false,
      error: null,
    });
  }, []);

  return {
    voiceState,
    handleTranscriptionComplete,
    handleError,
    forceClose,
    isVKeyPressed: isVKeyPressedRef.current,
  };
};

export default useVoiceInterface; 