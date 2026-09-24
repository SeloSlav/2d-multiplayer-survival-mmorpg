import React, { useEffect, useState, useCallback, useRef } from 'react';
import whisperService, { type WhisperResponse } from '../services/whisperService';
import { openaiService } from '../services/openaiService';
import { buildGameContext, type GameContextBuilderProps } from '../utils/gameContextBuilder';
import sovaIcon from '../assets/ui/sova.png';
import './VoiceInterface.css';
import { kokoroService } from '../services/kokoroService';
import { parseCraftIntent, resolveRecipeByName, getCraftFeedback } from '../utils/craftIntentParser';
import type { DbConnection } from '../generated';
import type { Recipe } from '../generated/types';
import type { Identity } from 'spacetimedb';
import { useAuth } from '../contexts/AuthContext';

// TTS Provider selection: 'kokoro' (default) | 'auto' (auto-detect)
const TTS_PROVIDER = import.meta.env.VITE_TTS_PROVIDER || 'kokoro';

/**
 * Determine which TTS provider to use based on configuration and availability
 * Currently only supports Kokoro (local TTS backend)
 */
async function shouldUseKokoro(): Promise<boolean> {
  // If explicitly set to kokoro, use it
  if (TTS_PROVIDER === 'kokoro') return true;
  
  // Auto-detect: Check if Kokoro service is available
  if (TTS_PROVIDER === 'auto') {
    try {
      const testResult = await kokoroService.testConnection();
      if (testResult.success) {
        console.log('[VoiceInterface] ✅ Kokoro service available, using Kokoro TTS');
        return true;
      }
    } catch (error) {
      console.error('[VoiceInterface] ❌ Kokoro service not available:', error);
    }
    
    // No fallback - Kokoro is required
    return false;
  }
  
  // Default to Kokoro
  return true;
}

interface VoiceInterfaceProps {
  isVisible: boolean;
  onTranscriptionComplete?: (text: string) => void;
  onError?: (error: string) => void;
  onAddSOVAMessage?: ((message: { id: string; text: string; isUser: boolean; timestamp: Date; flashTab?: boolean }) => void) | null;
  localPlayerIdentity?: string;
  // Game context for SOVA
  worldState?: any;
  localPlayer?: any;
  itemDefinitions?: Map<string, any>;
  activeEquipments?: Map<string, any>;
  inventoryItems?: Map<string, any>;
  recipes?: Map<string, Recipe>;
  playerIdentity?: Identity | null;
  connection?: DbConnection | null;
  // NEW: Callback to update loading states for external loading bar
  onLoadingStateChange?: (state: {
    isRecording: boolean;
    isTranscribing: boolean;
    isGeneratingResponse: boolean;
    isSynthesizingVoice: boolean;
    isPlayingAudio: boolean;
    transcribedText: string;
    currentPhase: string;
  }) => void;
}

interface VoiceState {
  isRecording: boolean;
  isTranscribing: boolean;
  isGeneratingResponse: boolean;
  isSynthesizingVoice: boolean;
  isPlayingAudio: boolean;
  transcribedText: string;
  error: string | null;
  recordingStartTime: number | null;
}

const VoiceInterface: React.FC<VoiceInterfaceProps> = ({
  isVisible,
  onTranscriptionComplete,
  onError,
  onAddSOVAMessage,
  localPlayerIdentity,
  worldState,
  localPlayer,
  itemDefinitions,
  activeEquipments,
  inventoryItems,
  recipes,
  playerIdentity,
  connection,
  onLoadingStateChange,
}) => {
  const { spacetimeToken } = useAuth();
  const [voiceState, setVoiceState] = useState<VoiceState>({
    isRecording: false,
    isTranscribing: false,
    isGeneratingResponse: false,
    isSynthesizingVoice: false,
    isPlayingAudio: false,
    transcribedText: '',
    error: null,
    recordingStartTime: null,
  });

  const recordingStartedRef = useRef(false);
  const processingRef = useRef(false);
  const speakingRef = useRef(false);
  const voiceTurnRef = useRef(0);

  // Keep Whisper bound to current DB connection for procedure calls.
  useEffect(() => {
    whisperService.setConnection(connection ?? null);
  }, [connection]);

  // Start voice recording
  const startRecording = useCallback(async () => {
    console.log('[VoiceInterface] startRecording() called', {
      recordingStarted: recordingStartedRef.current,
      processing: processingRef.current
    });
    
    if (processingRef.current && speakingRef.current) {
      voiceTurnRef.current++;
      kokoroService.stopStreamingPlayback();
      processingRef.current = false;
      speakingRef.current = false;
      setVoiceState(prev => ({ ...prev, isSynthesizingVoice: false, isPlayingAudio: false }));
    }
    if (recordingStartedRef.current || processingRef.current) {
      console.log('[VoiceInterface] ⚠️ Skipping startRecording - already in progress');
      return;
    }

    console.log('[VoiceInterface] Starting recording...');
    recordingStartedRef.current = true;

    // Check if services are available
    const isSupported = whisperService.isSupported();
    console.log('[VoiceInterface] Browser support check:', isSupported);
    
    if (!isSupported) {
      const error = 'Voice recording not supported in this browser';
      console.error('[VoiceInterface] ❌', error);
      setVoiceState(prev => ({ ...prev, error }));
      onError?.(error);
      recordingStartedRef.current = false;
      return;
    }

    const isConfigured = whisperService.isConfigured();
    console.log('[VoiceInterface] API key configured:', isConfigured);
    
    if (!isConfigured) {
      const error = 'Voice transcription is not configured';
      console.error('[VoiceInterface] ❌', error);
      setVoiceState(prev => ({ ...prev, error }));
      onError?.(error);
      recordingStartedRef.current = false;
      return;
    }

    try {
      console.log('[VoiceInterface] Calling whisperService.startRecording()...');
      const success = await whisperService.startRecording();
      console.log('[VoiceInterface] whisperService.startRecording() returned:', success);
      
      if (success) {
        console.log('[VoiceInterface] ✅ Recording started successfully');
        setVoiceState(prev => ({
          ...prev,
          isRecording: true,
          error: null,
          recordingStartTime: Date.now(),
        }));
      } else {
        throw new Error('Failed to start recording - no error thrown but startRecording returned false');
      }
    } catch (error) {
      console.error('[VoiceInterface] ❌ Recording start failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to start recording';
      
      // Provide more helpful error messages
      let userFriendlyError = errorMessage;
      if (errorMessage.includes('permission denied') || errorMessage.includes('PermissionDenied')) {
        userFriendlyError = 'Microphone permission denied. Click the lock icon in your browser address bar and allow microphone access.';
      } else if (errorMessage.includes('NotFound') || errorMessage.includes('microphone found')) {
        userFriendlyError = 'No microphone detected. Please connect a microphone and refresh the page.';
      } else if (errorMessage.includes('NotReadable') || errorMessage.includes('already in use')) {
        userFriendlyError = 'Microphone is in use by another app. Close other apps using the microphone and try again.';
      }
      
      setVoiceState(prev => ({ 
        ...prev, 
        error: userFriendlyError,
        isRecording: false
      }));
      onError?.(userFriendlyError);
      recordingStartedRef.current = false;
    }
  }, [onError]);

  // Stop recording and process
  const stopRecordingAndProcess = useCallback(async () => {
    if (!recordingStartedRef.current || processingRef.current) return;

    console.log('[VoiceInterface] Stopping recording and processing...');
    const turn = ++voiceTurnRef.current;
    processingRef.current = true;
    recordingStartedRef.current = false;

    setVoiceState(prev => ({
      ...prev,
      isRecording: false,
      isTranscribing: true,
    }));

    try {
      // Transcribe the audio
      const transcriptionResult: WhisperResponse = await whisperService.recordAndTranscribe();
      if (turn !== voiceTurnRef.current) return;

      if (!transcriptionResult.success || !transcriptionResult.text) {
        throw new Error(transcriptionResult.error || 'No speech detected');
      }

      const transcribedText = transcriptionResult.text;
      console.log('[VoiceInterface] ✅ Transcription successful:', transcribedText);

      setVoiceState(prev => ({
        ...prev,
        transcribedText,
        isTranscribing: false,
        isGeneratingResponse: true,
      }));

      // Notify parent component
      onTranscriptionComplete?.(transcribedText);

      // Add user voice message to SOVA chat immediately
      if (onAddSOVAMessage && transcribedText.trim()) {
        console.log('[VoiceInterface] onAddSOVAMessage function available:', typeof onAddSOVAMessage);
        const userMessage = {
          id: `user-voice-${Date.now()}`,
          text: transcribedText,
          isUser: true,
          timestamp: new Date()
        };
        
        try {
          onAddSOVAMessage(userMessage);
          console.log('[VoiceInterface] Successfully added user voice message to SOVA chat:', transcribedText);
        } catch (error) {
          console.error('[VoiceInterface] Error adding user voice message:', error);
        }
      } else {
        console.warn('[VoiceInterface] Cannot add user message - onAddSOVAMessage not available or empty text');
      }

      // Phase 5: Craft intent - intercept before LLM
      const craftIntent = parseCraftIntent(transcribedText);
      if (craftIntent && recipes && itemDefinitions && inventoryItems) {
        const recipe = resolveRecipeByName(craftIntent.recipeName, recipes, itemDefinitions);
        if (recipe) {
          const feedback = getCraftFeedback(
            recipe,
            craftIntent.quantity,
            inventoryItems,
            itemDefinitions,
            playerIdentity ?? null
          );

          const reducers = (connection as any)?.reducers;
          if (feedback.success && reducers?.startCraftingMultiple) {
            try {
              reducers.startCraftingMultiple({ recipeId: recipe.recipeId, quantityToCraft: craftIntent.quantity });
            } catch (err) {
              console.error('[VoiceInterface] Craft reducer error:', err);
              feedback.message = `Crafting failed: ${(err as Error).message}`;
            }
          }

          const botResponse = {
            id: `sova-voice-${Date.now()}`,
            text: feedback.message,
            isUser: false,
            timestamp: new Date()
          };
          if (onAddSOVAMessage) {
            onAddSOVAMessage(botResponse);
          }
          setVoiceState(prev => ({
            ...prev,
            isGeneratingResponse: false,
          }));
          processingRef.current = false;
          return;
        } else {
          const unknownResponse = {
            id: `sova-voice-${Date.now()}`,
            text: `I don't know how to craft "${craftIntent.recipeName}". Try a different item name or check the crafting menu.`,
            isUser: false,
            timestamp: new Date()
          };
          if (onAddSOVAMessage) {
            onAddSOVAMessage(unknownResponse);
          }
          setVoiceState(prev => ({
            ...prev,
            isGeneratingResponse: false,
          }));
          processingRef.current = false;
          return;
        }
      }

      // Generate AI response with comprehensive timing tracking
      console.log('[VoiceInterface] 🤖 Generating AI response...');
      
      // Debug: Log what props we're passing to buildGameContext
      console.log('🚨🚨🚨 [VoiceInterface] PROPS BEING PASSED TO buildGameContext 🚨🚨🚨');
      console.log('[VoiceInterface] Game context props:', {
        hasWorldState: !!worldState,
        hasLocalPlayer: !!localPlayer,
        hasItemDefinitions: !!itemDefinitions,
        itemDefinitionsSize: itemDefinitions?.size || 0,
        hasActiveEquipments: !!activeEquipments,
        activeEquipmentsSize: activeEquipments?.size || 0,
        hasInventoryItems: !!inventoryItems,
        inventoryItemsSize: inventoryItems?.size || 0,
        localPlayerIdentity,
      });
      
      // Debug: Sample some inventory items if they exist
      if (inventoryItems && inventoryItems.size > 0) {
        console.log('📦📦📦 [VoiceInterface] SAMPLE INVENTORY ITEMS:');
        let count = 0;
        inventoryItems.forEach((item, key) => {
          if (count < 3) {
            console.log(`[VoiceInterface] Item ${count + 1}:`, {
              key,
              ownerId: item.ownerId?.toHexString ? item.ownerId.toHexString() : item.ownerId,
              itemDefId: item.itemDefId,
              quantity: item.quantity,
              location: item.location,
            });
            count++;
          }
        });
      } else {
        console.log('❌ [VoiceInterface] NO INVENTORY ITEMS AVAILABLE');
      }
      
      const gameContext = buildGameContext({
        worldState,
        localPlayer,
        itemDefinitions,
        activeEquipments,
        inventoryItems,
        localPlayerIdentity,
      });

      if (openaiService.getProvider() === 'openai') {
        if (!spacetimeToken) throw new Error('Sign in to use SOVA voice.');
        const responseId = `sova-voice-${Date.now()}`;
        const responseTime = new Date();
        let lastChatUpdate = 0;
        const prompt = openaiService.buildSOVAMessages({ userMessage: transcribedText, gameContext });
        speakingRef.current = true;
        const streamed = await kokoroService.streamSOVAResponse(
          prompt,
          spacetimeToken,
          text => {
            if (turn !== voiceTurnRef.current) return;
            const now = performance.now();
            if (now - lastChatUpdate < 80) return;
            lastChatUpdate = now;
            onAddSOVAMessage?.({ id: responseId, text, isUser: false, timestamp: responseTime });
          },
          () => {
            if (turn === voiceTurnRef.current) {
              setVoiceState(prev => ({ ...prev, isGeneratingResponse: false, isSynthesizingVoice: false, isPlayingAudio: true }));
            }
          },
        );
        if (turn !== voiceTurnRef.current || streamed.interrupted) return;
        speakingRef.current = false;
        if (streamed.text) {
          onAddSOVAMessage?.({ id: responseId, text: streamed.text, isUser: false, timestamp: responseTime });
          if (streamed.success) openaiService.rememberSOVAResponse(transcribedText, streamed.text);
        }
        console.info('[VoiceInterface] Streamed voice pipeline', {
          sttMs: transcriptionResult.timing?.totalLatencyMs,
          firstAudioMs: streamed.firstAudioMs,
          textDoneMs: streamed.textDoneMs,
          audioChunks: streamed.chunks,
        });
        setVoiceState(prev => ({ ...prev, isGeneratingResponse: false, isSynthesizingVoice: false, isPlayingAudio: false }));
        if (!streamed.success) onError?.(`SOVA voice unavailable: ${streamed.error || 'Kokoro failed'}`);
        return;
      }
      
      const aiResponse = await openaiService.generateSOVAResponse({
        userMessage: transcribedText,
        gameContext,
        connection,
      });
      if (turn !== voiceTurnRef.current) return;

      if (aiResponse.success && aiResponse.response) {
        console.log('[VoiceInterface] ✅ AI response generated successfully');

        // Preserve the answer in chat even if Kokoro cannot synthesize it.
        try {
          onAddSOVAMessage?.({
            id: `sova-voice-${Date.now()}`,
            text: aiResponse.response,
            isUser: false,
            timestamp: new Date(),
          });
        } catch (error) {
          console.error('[VoiceInterface] Failed to add SOVA reply to chat:', error);
        }

        setVoiceState(prev => ({
          ...prev,
          isGeneratingResponse: false,
          isSynthesizingVoice: true,
        }));

        // Generate voice synthesis with timing data collection
        console.log('[VoiceInterface] 🎤 Generating voice synthesis...');
        
        // Use Kokoro TTS provider
        speakingRef.current = true;
        const useKokoro = await shouldUseKokoro();
        if (turn !== voiceTurnRef.current) return;
        if (!useKokoro) {
          throw new Error('Kokoro TTS service is not available. Please ensure the Kokoro backend is running.');
        }
        
        const ttsService = kokoroService;
        const serviceName = 'Kokoro';
        
        console.log(`[VoiceInterface] Using ${serviceName} TTS provider`);
        
        const voiceResponse = await ttsService.synthesizeAndPlayStream({
          text: aiResponse.response,
          voiceStyle: 'sova'
        }, () => {
          if (turn === voiceTurnRef.current) {
            setVoiceState(prev => ({ ...prev, isSynthesizingVoice: false, isPlayingAudio: true }));
          }
        });
        if (turn !== voiceTurnRef.current || voiceResponse.interrupted) return;
        speakingRef.current = false;
        console.info('[VoiceInterface] Voice pipeline', {
          sttMs: transcriptionResult.timing?.totalLatencyMs,
          llmMs: aiResponse.timing?.totalLatencyMs,
          firstAudioMs: voiceResponse.firstAudioMs,
          audioChunks: voiceResponse.chunks,
        });
        if (!voiceResponse.success) {
          console.error('[VoiceInterface] ❌ Voice synthesis failed:', voiceResponse.error);
          onError?.(`SOVA voice unavailable: ${voiceResponse.error || 'Kokoro failed'}`);
        }
        setVoiceState(prev => ({ ...prev, isSynthesizingVoice: false, isPlayingAudio: false }));
      } else {
        console.error('[VoiceInterface] ❌ AI response generation failed:', aiResponse.error);
        onError?.(`SOVA response unavailable: ${aiResponse.error || 'AI provider failed'}`);
        setVoiceState(prev => ({
          ...prev,
          isGeneratingResponse: false,
        }));
      }

    } catch (error) {
      if (turn !== voiceTurnRef.current) return;
      console.error('[VoiceInterface] ❌ Error in voice processing pipeline:', error);
      const errorMessage = error instanceof Error ? error.message : 'Voice processing failed';
      setVoiceState(prev => ({
        ...prev,
        isTranscribing: false,
        isGeneratingResponse: false,
        isSynthesizingVoice: false,
        isPlayingAudio: false,
        error: errorMessage,
      }));
      onError?.(errorMessage);
    } finally {
      if (turn === voiceTurnRef.current) {
        processingRef.current = false;
        speakingRef.current = false;
      }
    }
  }, [onTranscriptionComplete, onError, onAddSOVAMessage, localPlayerIdentity, worldState, localPlayer, itemDefinitions, activeEquipments, inventoryItems, recipes, playerIdentity, connection, spacetimeToken]);

  // NEW: Clear previous state when interface becomes visible (V key pressed) and start recording
  useEffect(() => {
    if (isVisible) {
      console.log('[VoiceInterface] Interface opened - clearing previous state');
      setVoiceState(prev => ({
        ...prev,
        transcribedText: '', // Clear previous transcription
        error: null, // Clear previous errors
        isTranscribing: false,
        isGeneratingResponse: false,
        isSynthesizingVoice: false,
        isPlayingAudio: false,
      }));
      
      // Start recording if not already started
      // Use a small delay to ensure state is cleared first
      const timer = setTimeout(() => {
        if (!recordingStartedRef.current) {
          console.log('[VoiceInterface] Calling startRecording()...');
          startRecording();
        } else {
          console.log('[VoiceInterface] Skipping startRecording - already in progress', {
            recordingStarted: recordingStartedRef.current,
            processing: processingRef.current
          });
        }
      }, 50); // Small delay to ensure state update completes
      
      return () => clearTimeout(timer);
    } else {
      // When interface closes, stop recording if it's active
      if (recordingStartedRef.current) {
        console.log('[VoiceInterface] Interface closed - stopping recording');
        stopRecordingAndProcess();
      }
    }
  }, [isVisible, startRecording, stopRecordingAndProcess]);

  // NEW: Notify parent component of loading state changes
  useEffect(() => {
    if (onLoadingStateChange) {
      const currentPhase = voiceState.isRecording ? 'Listening...' :
                          voiceState.isTranscribing ? 'Processing speech...' :
                          voiceState.isGeneratingResponse ? 'Generating response...' :
                          voiceState.isSynthesizingVoice ? 'Creating voice...' :
                          voiceState.isPlayingAudio ? 'Playing response...' :
                          'Ready';
      
      onLoadingStateChange({
        isRecording: voiceState.isRecording,
        isTranscribing: voiceState.isTranscribing,
        isGeneratingResponse: voiceState.isGeneratingResponse,
        isSynthesizingVoice: voiceState.isSynthesizingVoice,
        isPlayingAudio: voiceState.isPlayingAudio,
        transcribedText: voiceState.transcribedText,
        currentPhase,
      });
    }
  }, [voiceState, onLoadingStateChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      kokoroService.stopStreamingPlayback();
      whisperService.destroy();
    };
  }, []);

  // Calculate recording duration
  const recordingDuration = voiceState.recordingStartTime 
    ? Math.floor((Date.now() - voiceState.recordingStartTime) / 1000)
    : 0;

  // Determine if any processing is happening
  const isProcessing = voiceState.isTranscribing || voiceState.isGeneratingResponse || voiceState.isSynthesizingVoice || voiceState.isPlayingAudio;

  if (!isVisible) return null;

  return (
    <div className="voice-interface-container">
      {/* Cyberpunk Voice Interface */}
      <div className="voice-interface-rings">
        {/* Outer Ring - Pulsing */}
        <div className={`voice-interface-outer-ring ${voiceState.isRecording ? 'recording' : ''}`} />

        {/* Middle Ring - Rotating */}
        <div className={`voice-interface-middle-ring ${voiceState.isRecording ? 'recording' : ''}`} />

        {/* Inner Ring - Counter-rotating */}
        <div className={`voice-interface-inner-ring ${voiceState.isRecording ? 'recording' : ''}`} />

        {/* Center Circle */}
        <div className={`voice-interface-center ${voiceState.isRecording ? 'recording' : 'idle'}`}>
          {isProcessing ? (
            <div className="voice-interface-processing">◉</div>
          ) : voiceState.error ? (
            <div className="voice-interface-error">⚠</div>
          ) : (
            <img 
              src={sovaIcon} 
              alt="SOVA" 
              className={`voice-interface-sova-icon ${voiceState.isRecording ? 'recording' : ''}`}
            />
          )}
        </div>

        {/* SOVA Label */}
        <div className="voice-interface-label">
          SOVA
        </div>

        {/* Status Text */}
        <div className="voice-interface-status">
          {voiceState.isTranscribing ? (
            '◈ PROCESSING SPEECH ◈'
          ) : voiceState.isGeneratingResponse ? (
            '◈ GENERATING RESPONSE ◈'
          ) : voiceState.isSynthesizingVoice ? (
            '◈ SYNTHESIZING VOICE ◈'
          ) : voiceState.isPlayingAudio ? (
            '◈ TRANSMITTING ◈'
          ) : voiceState.isRecording ? (
            `◈ LISTENING... ${recordingDuration}s ◈`
          ) : voiceState.error ? (
            '⚠ SYSTEM ERROR ⚠'
          ) : (
            'HOLD [V] TO TRANSMIT'
          )}
        </div>

        {/* Error Message */}
        {voiceState.error && (
          <div className="voice-interface-error-message">
            {voiceState.error}
          </div>
        )}

        {/* NEW: Real-time Transcribed Text Preview - Show while recording or just after */}
        {voiceState.transcribedText && (voiceState.isRecording || isProcessing) && (
          <div className="voice-interface-transcription">
            "{voiceState.transcribedText}"
          </div>
        )}
      </div>
    </div>
  );
};

export default VoiceInterface;
