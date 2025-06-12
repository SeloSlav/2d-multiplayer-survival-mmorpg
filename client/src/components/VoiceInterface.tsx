import React, { useEffect, useState, useCallback, useRef } from 'react';
import whisperService, { type WhisperResponse } from '../services/whisperService';
import { openaiService } from '../services/openaiService';
import { kikashiService } from '../services/kikashiService';
import { buildGameContext, type GameContextBuilderProps } from '../utils/gameContextBuilder';
import sovaIcon from '../assets/ui/sova.png';
import './VoiceInterface.css';

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
}

interface VoiceState {
  isRecording: boolean;
  isProcessing: boolean;
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
}) => {
  const [voiceState, setVoiceState] = useState<VoiceState>({
    isRecording: false,
    isProcessing: false,
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

  // Start recording when interface becomes visible
  useEffect(() => {
    if (isVisible && !voiceState.isRecording && !recordingStartedRef.current) {
      startRecording();
    }
  }, [isVisible]);

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
      isProcessing: true,
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
        isProcessing: false,
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

        // Generate voice synthesis with timing data collection
        console.log('[VoiceInterface] 🎤 Generating voice synthesis...');
        const voiceResponse = await kikashiService.synthesizeVoice({
          text: aiResponse.response,
          voiceStyle: 'robot2'
        });

        // Update Kikashi service with complete pipeline timing
        if (transcriptionResult.timing && aiResponse.timing && voiceResponse.timing) {
          kikashiService.updatePipelineTiming(
            transcriptionResult.timing.totalLatencyMs,
            aiResponse.timing.totalLatencyMs
          );
          
          console.log('[VoiceInterface] 📊 Complete Pipeline Performance:', {
            whisperLatency: `${transcriptionResult.timing.totalLatencyMs.toFixed(2)}ms`,
            openaiLatency: `${aiResponse.timing.totalLatencyMs.toFixed(2)}ms`,
            proxyLatency: `${voiceResponse.timing.proxyLatencyMs.toFixed(2)}ms`,
            kikashiLatency: `${voiceResponse.timing.kikashiApiLatencyMs.toFixed(2)}ms`,
            totalPipeline: `${(transcriptionResult.timing.totalLatencyMs + aiResponse.timing.totalLatencyMs + voiceResponse.timing.totalLatencyMs).toFixed(2)}ms`
          });
        }

        if (voiceResponse.success && voiceResponse.audioUrl) {
          console.log('[VoiceInterface] ✅ Voice synthesis successful');

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
          await kikashiService.playAudio(voiceResponse.audioUrl);
          console.log('[VoiceInterface] ✅ Audio playback completed');
        } else {
          console.error('[VoiceInterface] ❌ Voice synthesis failed:', voiceResponse.error);
        }
      } else {
        console.error('[VoiceInterface] ❌ AI response generation failed:', aiResponse.error);
      }

    } catch (error) {
      console.error('[VoiceInterface] ❌ Error in voice processing pipeline:', error);
      const errorMessage = error instanceof Error ? error.message : 'Voice processing failed';
      setVoiceState(prev => ({
        ...prev,
        isProcessing: false,
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
          {voiceState.isProcessing ? (
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
          {voiceState.isProcessing ? (
            'PROCESSING...'
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

        {/* Transcribed Text Preview */}
        {voiceState.transcribedText && (
          <div className="voice-interface-transcription">
            "{voiceState.transcribedText}"
          </div>
        )}
      </div>
    </div>
  );
};

export default VoiceInterface; 