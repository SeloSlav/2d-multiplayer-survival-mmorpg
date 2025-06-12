// Kikashi API Service for SOVA Voice Synthesis
// Documentation: https://www.kikashi.io/#documentation

import { openaiService, type SOVAPromptRequest } from './openaiService';

const SOVA_VOICE = 'robot2';

// Proxy server configuration
const PROXY_URL = import.meta.env.VITE_PROXY_URL || 'http://localhost:3001';
const TTS_ENDPOINT = `${PROXY_URL}/api/tts`;

export interface KikashiResponse {
  success: boolean;
  audioUrl?: string;
  error?: string;
}

export interface VoiceSynthesisRequest {
  text: string;
  voiceStyle?: string;
}

class KikashiService {
  constructor() {
    // No API key needed since we're using local proxy
  }

  /**
   * Convert text to speech using Kikashi API
   */
  async synthesizeVoice(request: VoiceSynthesisRequest): Promise<KikashiResponse> {
    try {
      const requestBody = {
        text: request.text,
        voiceStyle: request.voiceStyle || SOVA_VOICE,
      };
      
      console.log('[KikashiService] Making request to proxy:', TTS_ENDPOINT);
      console.log('[KikashiService] Request body:', requestBody);
      console.log('[KikashiService] Request text length:', request.text.length);
      
      const response = await fetch(TTS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      console.log('[KikashiService] Response status:', response.status);
      console.log('[KikashiService] Response headers:', response.headers);
      console.log('[KikashiService] Content-Type:', response.headers.get('content-type'));

      if (!response.ok) {
        let errorMessage = `API Error: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage += ` - ${errorData.message || response.statusText}`;
          console.log('[KikashiService] Error data:', errorData);
        } catch {
          errorMessage += ` - ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      // According to documentation, response is audio stream directly
      // Content-Type: audio/mpeg
      const audioBlob = await response.blob();
      console.log('[KikashiService] Audio blob size:', audioBlob.size, 'type:', audioBlob.type);
      
      // Check if we actually got audio data
      if (audioBlob.size === 0) {
        throw new Error('Received empty audio response');
      }
      
      // Check if the content type is actually audio
      const contentType = audioBlob.type || response.headers.get('content-type') || '';
      console.log('[KikashiService] Actual content type:', contentType);
      
      if (!contentType.includes('audio') && !contentType.includes('mpeg') && !contentType.includes('mp3')) {
        // Let's see what we actually got
        const text = await audioBlob.text();
        console.log('[KikashiService] Non-audio response received:', text.substring(0, 500));
        throw new Error(`Expected audio but got: ${contentType}. Response: ${text.substring(0, 100)}`);
      }
      
      const audioUrl = URL.createObjectURL(audioBlob);
      
      return {
        success: true,
        audioUrl: audioUrl,
      };
    } catch (error) {
      console.error('[KikashiService] Voice synthesis failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Generate SOVA voice response for chat message using AI
   */
  async generateSOVAVoiceResponse(messageText: string, gameContext?: SOVAPromptRequest['gameContext']): Promise<KikashiResponse> {
    try {
      // Generate AI response using OpenAI service
      const aiResponse = await openaiService.generateSOVAResponse({
        userMessage: messageText,
        gameContext: gameContext,
      });

      // Use AI response if successful, otherwise use fallback
      const sovaResponseText = aiResponse.response || this.formatSOVAResponse(messageText);
      
      console.log('[KikashiService] Using SOVA response:', sovaResponseText);
      
      return this.synthesizeVoice({
        text: sovaResponseText,
        voiceStyle: SOVA_VOICE,
      });
    } catch (error) {
      console.error('[KikashiService] AI response generation failed, using fallback:', error);
      
      // Fallback to simple response if AI fails
      const fallbackText = this.formatSOVAResponse(messageText);
      return this.synthesizeVoice({
        text: fallbackText,
        voiceStyle: SOVA_VOICE,
      });
    }
  }

  /**
   * Format user message into SOVA-style response
   */
  private formatSOVAResponse(userMessage: string): string {
    // SOVA simply repeats the user's message exactly
    return userMessage;
  }

  /**
   * Play audio from URL
   */
  async playAudio(audioUrl: string): Promise<boolean> {
    try {
      const audio = new Audio(audioUrl);
      
      return new Promise((resolve, reject) => {
        // Set a timeout for loading
        const timeout = setTimeout(() => {
          reject(new Error('Audio loading timeout (10 seconds)'));
        }, 10000);
        
        audio.oncanplaythrough = () => {
          clearTimeout(timeout);
          console.log('[KikashiService] Audio ready to play');
          audio.play()
            .then(() => {
              console.log('[KikashiService] Audio playback started');
              resolve(true);
            })
            .catch((playError) => {
              console.error('[KikashiService] Audio play error:', playError);
              reject(new Error(`Audio play failed: ${playError.message}`));
            });
        };
        
        audio.onerror = (e) => {
          clearTimeout(timeout);
          console.error('[KikashiService] Audio error event:', e);
          console.error('[KikashiService] Audio error details:', {
            error: audio.error,
            networkState: audio.networkState,
            readyState: audio.readyState,
            src: audio.src
          });
          
          let errorMessage = 'Failed to load audio';
          if (audio.error) {
            switch (audio.error.code) {
              case audio.error.MEDIA_ERR_ABORTED:
                errorMessage = 'Audio loading was aborted';
                break;
              case audio.error.MEDIA_ERR_NETWORK:
                errorMessage = 'Network error while loading audio';
                break;
              case audio.error.MEDIA_ERR_DECODE:
                errorMessage = 'Audio decoding error - invalid format';
                break;
              case audio.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                errorMessage = 'Audio format not supported';
                break;
              default:
                errorMessage = `Audio error code: ${audio.error.code}`;
            }
          }
          
          reject(new Error(errorMessage));
        };
        
        audio.onended = () => {
          console.log('[KikashiService] Audio playback ended');
          resolve(true);
        };
        
        // Start loading the audio
        console.log('[KikashiService] Starting audio load from:', audioUrl);
        audio.load();
      });
    } catch (error) {
      console.error('[KikashiService] Audio playback failed:', error);
      return false;
    }
  }

  /**
   * Generate and play SOVA voice response with AI
   */
  async generateAndPlaySOVAResponse(userMessage: string, gameContext?: SOVAPromptRequest['gameContext']): Promise<{ success: boolean; responseText?: string; error?: string }> {
    try {
      // First generate the AI response text
      const aiResponse = await openaiService.generateSOVAResponse({
        userMessage: userMessage,
        gameContext: gameContext,
      });

      // Use AI response if successful, otherwise use fallback
      const responseText = aiResponse.response || this.formatSOVAResponse(userMessage);
      
      // Generate voice response using the AI-generated text
      const voiceResult = await this.synthesizeVoice({
        text: responseText,
        voiceStyle: SOVA_VOICE,
      });
      
      if (!voiceResult.success || !voiceResult.audioUrl) {
        return {
          success: false,
          error: voiceResult.error || 'Failed to generate voice response',
          responseText: responseText, // Still return the text even if voice fails
        };
      }

      // Play the audio
      const playSuccess = await this.playAudio(voiceResult.audioUrl);
      
      if (!playSuccess) {
        return {
          success: false,
          error: 'Failed to play audio response',
          responseText: responseText, // Still return the text even if audio fails
        };
      }

      return {
        success: true,
        responseText: responseText,
      };
    } catch (error) {
      console.error('[KikashiService] Complete SOVA response failed:', error);
      
      // Provide fallback response even on complete failure
      const fallbackText = this.formatSOVAResponse(userMessage);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        responseText: fallbackText,
      };
    }
  }
}

// Export singleton instance
export const kikashiService = new KikashiService();
export default kikashiService; 