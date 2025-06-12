// OpenAI Whisper Service for Speech-to-Text
// Handles voice recording and transcription for SOVA voice interface

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || 'your-openai-api-key-here';
const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

export interface WhisperResponse {
  success: boolean;
  text?: string;
  error?: string;
}

export interface VoiceRecordingState {
  isRecording: boolean;
  isProcessing: boolean;
  error?: string;
}

class WhisperService {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;

  /**
   * Start recording audio from microphone
   */
  async startRecording(): Promise<boolean> {
    try {
      console.log('[Whisper] Starting voice recording...');
      
      // Request microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000, // Optimal for Whisper
        } 
      });

      // Create MediaRecorder
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: 'audio/webm;codecs=opus' // Good compression and quality
      });

      this.audioChunks = [];

      // Handle data available
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      // Start recording
      this.mediaRecorder.start();
      console.log('[Whisper] Recording started successfully');
      return true;

    } catch (error) {
      console.error('[Whisper] Failed to start recording:', error);
      this.cleanup();
      return false;
    }
  }

  /**
   * Stop recording and return the audio blob
   */
  async stopRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        console.warn('[Whisper] No active recording to stop');
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = () => {
        console.log('[Whisper] Recording stopped, creating audio blob...');
        
        if (this.audioChunks.length === 0) {
          console.warn('[Whisper] No audio data recorded');
          resolve(null);
          return;
        }

        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        console.log('[Whisper] Audio blob created, size:', audioBlob.size, 'bytes');
        
        this.cleanup();
        resolve(audioBlob);
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Transcribe audio blob using OpenAI Whisper
   */
  async transcribeAudio(audioBlob: Blob): Promise<WhisperResponse> {
    try {
      console.log('[Whisper] Starting transcription...');

      // Create form data for the API request
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('model', 'whisper-1');
      formData.append('language', 'en'); // Force English for better accuracy
      formData.append('response_format', 'json');

      const response = await fetch(WHISPER_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[Whisper] API error:', errorData);
        throw new Error(`Whisper API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      const transcribedText = data.text?.trim();

      if (!transcribedText) {
        throw new Error('No text transcribed from audio');
      }

      console.log('[Whisper] Transcription successful:', transcribedText);

      return {
        success: true,
        text: transcribedText,
      };

    } catch (error) {
      console.error('[Whisper] Transcription failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown transcription error',
      };
    }
  }

  /**
   * Complete voice-to-text workflow: record and transcribe
   */
  async recordAndTranscribe(): Promise<WhisperResponse> {
    try {
      const audioBlob = await this.stopRecording();
      
      if (!audioBlob) {
        return {
          success: false,
          error: 'No audio recorded',
        };
      }

      return await this.transcribeAudio(audioBlob);

    } catch (error) {
      console.error('[Whisper] Record and transcribe failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if service is configured with API key
   */
  isConfigured(): boolean {
    return OPENAI_API_KEY !== 'your-openai-api-key-here' && OPENAI_API_KEY.length > 0;
  }

  /**
   * Check if browser supports required APIs
   */
  isSupported(): boolean {
    return !!(
      typeof navigator !== 'undefined' && 
      navigator.mediaDevices && 
      typeof navigator.mediaDevices.getUserMedia === 'function' && 
      typeof MediaRecorder !== 'undefined'
    );
  }

  /**
   * Get current recording state
   */
  getRecordingState(): 'inactive' | 'recording' | 'paused' {
    return this.mediaRecorder?.state || 'inactive';
  }

  /**
   * Clean up resources
   */
  private cleanup() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
  }

  /**
   * Force cleanup (call on component unmount)
   */
  destroy() {
    this.cleanup();
  }
}

// Export singleton instance
export const whisperService = new WhisperService();
export default whisperService; 