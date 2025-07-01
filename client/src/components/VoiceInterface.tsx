import React, { useEffect, useState, useCallback, useRef } from 'react';
import whisperService, { type WhisperResponse } from '../services/whisperService';
import { openaiService } from '../services/openaiService';
import { buildGameContext, type GameContextBuilderProps } from '../utils/gameContextBuilder';
import sovaIcon from '../assets/ui/sova.png';
import './VoiceInterface.css';
import { elevenLabsService } from '../services/elevenLabsService';

interface VoiceInterfaceProps {
  isVisible: boolean;
  onTranscriptionComplete?: (text: string) => void;
  onError?: (error: string) => void;
  onAddSOVAMessage?: ((message: { id: string; text: string; isUser: boolean; timestamp: Date }) => void) | null;
  localPlayerIdentity?: string;
  // Game context for SOVA
  worldState?: any;
  localPlayer?: any;
  itemDefinitions?: Map<string, any>;
  activeEquipments?: Map<string, any>;
  inventoryItems?: Map<string, any>;
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
  onLoadingStateChange,
}) => {
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

  // Debug: Log when onAddSOVAMessage prop changes
  useEffect(() => {
    console.log('[VoiceInterface] onAddSOVAMessage prop changed:', {
      available: !!onAddSOVAMessage,
      type: typeof onAddSOVAMessage,
      isFunction: typeof onAddSOVAMessage === 'function'
    });
  }, [onAddSOVAMessage]);

  // NEW: Clear previous state when interface becomes visible (V key pressed)
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
      if (!voiceState.isRecording && !recordingStartedRef.current) {
        startRecording();
      }
    }
  }, [isVisible]);

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

  // Start voice recording
  const startRecording = useCallback(async () => {
    if (recordingStartedRef.current || processingRef.current) return;

    console.log('[VoiceInterface] Starting recording...');
    recordingStartedRef.current = true;

    // Check if services are available
    if (!whisperService.isSupported()) {
      const error = 'Voice recording not supported in this browser';
      setVoiceState(prev => ({ ...prev, error }));
      onError?.(error);
      return;
    }

    if (!whisperService.isConfigured()) {
      const error = 'OpenAI API key not configured for voice transcription';
      setVoiceState(prev => ({ ...prev, error }));
      onError?.(error);
      return;
    }

    try {
      const success = await whisperService.startRecording();
      if (success) {
        setVoiceState(prev => ({
          ...prev,
          isRecording: true,
          error: null,
          recordingStartTime: Date.now(),
        }));
      } else {
        throw new Error('Failed to start recording');
      }
    } catch (error) {
      console.error('[VoiceInterface] Recording start failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to start recording';
      setVoiceState(prev => ({ ...prev, error: errorMessage }));
      onError?.(errorMessage);
      recordingStartedRef.current = false;
    }
  }, [onError]);

  // Stop recording and process
  const stopRecordingAndProcess = useCallback(async () => {
    if (!recordingStartedRef.current || processingRef.current) return;

    console.log('[VoiceInterface] Stopping recording and processing...');
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
      
      const aiResponse = await openaiService.generateSOVAResponse({
        userMessage: transcribedText,
        gameContext,
      });

      if (aiResponse.success && aiResponse.response) {
        console.log('[VoiceInterface] ✅ AI response generated successfully');

        setVoiceState(prev => ({
          ...prev,
          isGeneratingResponse: false,
          isSynthesizingVoice: true,
        }));

        // Generate voice synthesis with timing data collection
        console.log('[VoiceInterface] 🎤 Generating voice synthesis...');
        const voiceResponse = await elevenLabsService.synthesizeVoice({
          text: aiResponse.response,
          voiceStyle: 'sova'
        });

        // Update ElevenLabs service with complete pipeline timing
        if (transcriptionResult.timing && aiResponse.timing && voiceResponse.timing) {
          elevenLabsService.updatePipelineTiming(
            transcriptionResult.timing.totalLatencyMs,
            aiResponse.timing.totalLatencyMs
          );
          
          console.log('[VoiceInterface] 📊 Complete Pipeline Performance:', {
            whisperLatency: `${transcriptionResult.timing.totalLatencyMs.toFixed(2)}ms`,
            openaiLatency: `${aiResponse.timing.totalLatencyMs.toFixed(2)}ms`,
            apiLatency: `${voiceResponse.timing.apiLatencyMs.toFixed(2)}ms`,
            elevenLabsLatency: `${voiceResponse.timing.elevenLabsApiLatencyMs.toFixed(2)}ms`,
            totalPipeline: `${(transcriptionResult.timing.totalLatencyMs + aiResponse.timing.totalLatencyMs + voiceResponse.timing.totalLatencyMs).toFixed(2)}ms`
          });
        }

        if (voiceResponse.success && voiceResponse.audioUrl) {
          console.log('[VoiceInterface] ✅ Voice synthesis successful');

          setVoiceState(prev => ({
            ...prev,
            isSynthesizingVoice: false,
            isPlayingAudio: true,
          }));

          // Add SOVA response to chat
          if (onAddSOVAMessage) {
            const botResponse = {
              id: `sova-voice-${Date.now()}`,
              text: aiResponse.response,
              isUser: false,
              timestamp: new Date()
            };
            
            try {
              onAddSOVAMessage(botResponse);
              console.log('[VoiceInterface] Successfully added SOVA response to chat:', aiResponse.response);
            } catch (error) {
              console.error('[VoiceInterface] Error adding SOVA response:', error);
            }
          } else {
            console.warn('[VoiceInterface] Cannot add SOVA response - onAddSOVAMessage not available');
          }

          // Play audio response
          console.log('[VoiceInterface] 🔊 Playing audio response...');
          await elevenLabsService.playAudio(voiceResponse.audioUrl);
          console.log('[VoiceInterface] ✅ Audio playback completed');
          
          setVoiceState(prev => ({
            ...prev,
            isPlayingAudio: false,
          }));
        } else {
          console.error('[VoiceInterface] ❌ Voice synthesis failed:', voiceResponse.error);
          setVoiceState(prev => ({
            ...prev,
            isSynthesizingVoice: false,
          }));
        }
      } else {
        console.error('[VoiceInterface] ❌ AI response generation failed:', aiResponse.error);
        setVoiceState(prev => ({
          ...prev,
          isGeneratingResponse: false,
        }));
      }

    } catch (error) {
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
      processingRef.current = false;
    }
  }, [onTranscriptionComplete, onError, onAddSOVAMessage, localPlayerIdentity, worldState, localPlayer, itemDefinitions, activeEquipments, inventoryItems]);

  // Handle interface hiding (stop recording)
  useEffect(() => {
    if (!isVisible && voiceState.isRecording) {
      stopRecordingAndProcess();
    }
  }, [isVisible, voiceState.isRecording, stopRecordingAndProcess]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
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
            <div className="voice-interface-processing">⚡</div>
          ) : voiceState.error ? (
            <div className="voice-interface-error">❌</div>
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
            'PROCESSING SPEECH...'
          ) : voiceState.isGeneratingResponse ? (
            'GENERATING RESPONSE...'
          ) : voiceState.isSynthesizingVoice ? (
            'CREATING VOICE...'
          ) : voiceState.isPlayingAudio ? (
            'PLAYING RESPONSE...'
          ) : voiceState.isRecording ? (
            `LISTENING... ${recordingDuration}s`
          ) : voiceState.error ? (
            'ERROR'
          ) : (
            'VOICE READY'
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