// OpenAI Whisper Service for Speech-to-Text
// Enhanced with audio processing and accuracy optimizations

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || 'your-openai-api-key-here';
const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

export interface WhisperResponse {
  success: boolean;
  text?: string;
  error?: string;
  timing?: {
    requestStartTime: number;
    responseReceivedTime: number;
    totalLatencyMs: number;
    audioSizeBytes: number;
    textLength: number;
    timestamp: string;
  };
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
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;

  /**
   * Start recording audio from microphone with enhanced settings
   */
  async startRecording(): Promise<boolean> {
    try {
      console.log('[Whisper] Starting enhanced voice recording...');
      
      // Request microphone access with optimal settings for speech recognition
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100, // Higher quality, we'll downsample for Whisper
          channelCount: 1, // Mono for better speech recognition
          sampleSize: 16, // 16-bit audio
        } 
      });

      // Set up audio processing pipeline
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 44100
      });
      
      const source = this.audioContext.createMediaStreamSource(this.stream);
      
      // Add gain control for volume normalization
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 1.5; // Boost quiet speech
      
      // Add analyzer for audio level monitoring
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      
      // Connect the audio processing chain
      source.connect(this.gainNode);
      this.gainNode.connect(this.analyser);
      
      // Create MediaRecorder with optimal settings
      const mimeType = this.getBestMimeType();
      console.log('[Whisper] Using MIME type:', mimeType);
      
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        audioBitsPerSecond: 128000, // Higher quality for better transcription
      });

      this.audioChunks = [];

      // Handle data available
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      // Start recording with time slices for better data handling
      this.mediaRecorder.start(100); // 100ms time slices
      console.log('[Whisper] Enhanced recording started successfully');
      return true;

    } catch (error) {
      console.error('[Whisper] Failed to start recording:', error);
      this.cleanup();
      return false;
    }
  }

  /**
   * Get the best available MIME type for recording
   */
  private getBestMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/webm',
      'audio/ogg',
      'audio/wav'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log('[Whisper] Selected MIME type:', type);
        return type;
      }
    }
    
    console.warn('[Whisper] No optimal MIME type found, using default');
    return '';
  }

  /**
   * Monitor audio levels to ensure good recording quality
   */
  private getAudioLevel(): number {
    if (!this.analyser) return 0;
    
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);
    
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    
    return sum / dataArray.length / 255; // Normalize to 0-1
  }

  /**
   * Stop recording and return the processed audio blob
   */
  async stopRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        console.warn('[Whisper] No active recording to stop');
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = async () => {
        console.log('[Whisper] Recording stopped, processing audio...');
        
        if (this.audioChunks.length === 0) {
          console.warn('[Whisper] No audio data recorded');
          resolve(null);
          return;
        }

        try {
          // Create initial blob
          const rawBlob = new Blob(this.audioChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
          console.log('[Whisper] Raw audio blob created, size:', rawBlob.size, 'bytes');
          
          // Process audio for better Whisper compatibility
          const processedBlob = await this.processAudioForWhisper(rawBlob);
          console.log('[Whisper] Processed audio blob, size:', processedBlob.size, 'bytes');
          
          this.cleanup();
          resolve(processedBlob);
        } catch (error) {
          console.error('[Whisper] Error processing audio:', error);
          this.cleanup();
          resolve(null);
        }
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Process audio blob for optimal Whisper compatibility
   */
  private async processAudioForWhisper(blob: Blob): Promise<Blob> {
    try {
      // For now, return the blob as-is but with enhanced metadata
      // In the future, we could add audio format conversion here
      
      // Check audio duration to ensure it's adequate
      const arrayBuffer = await blob.arrayBuffer();
      console.log('[Whisper] Audio processing - buffer size:', arrayBuffer.byteLength);
      
      // For very short recordings, warn about potential accuracy issues
      if (blob.size < 1000) { // Less than ~1KB
        console.warn('[Whisper] Very short audio recording - may affect accuracy');
      }
      
      return blob;
    } catch (error) {
      console.error('[Whisper] Audio processing failed:', error);
      return blob; // Return original if processing fails
    }
  }

  /**
   * Transcribe audio blob using OpenAI Whisper with enhanced parameters
   */
  async transcribeAudio(audioBlob: Blob): Promise<WhisperResponse> {
    const timing = {
      requestStartTime: performance.now(),
      responseReceivedTime: 0,
      totalLatencyMs: 0,
      audioSizeBytes: audioBlob.size,
      textLength: 0,
      timestamp: new Date().toISOString(),
    };

    console.log(`[Whisper] 🎙️ Starting enhanced transcription - Audio: ${(audioBlob.size / 1024).toFixed(2)} KB`);

    try {
      // Create form data with enhanced parameters
      const formData = new FormData();
      
      // Use .wav extension for better Whisper compatibility
      formData.append('file', audioBlob, 'audio.wav');
      formData.append('model', 'whisper-1');
      formData.append('language', 'en'); // Force English for better accuracy
      formData.append('response_format', 'verbose_json'); // Get more detailed response
      formData.append('temperature', '0'); // Lower temperature for more consistent results
      
      // No prompt - let Whisper transcribe exactly what was said

      const response = await fetch(WHISPER_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: formData,
      });

      timing.responseReceivedTime = performance.now();
      timing.totalLatencyMs = timing.responseReceivedTime - timing.requestStartTime;

      console.log(`[Whisper] ⚡ Enhanced Whisper response received in ${timing.totalLatencyMs.toFixed(2)}ms`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[Whisper] API error:', errorData);
        throw new Error(`Whisper API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      
      // Handle verbose_json response format
      const transcribedText = data.text?.trim();
      
      // Log additional metadata if available
      if (data.segments) {
        console.log('[Whisper] Transcription segments:', data.segments.length);
        data.segments.forEach((segment: any, index: number) => {
          console.log(`[Whisper] Segment ${index + 1}: "${segment.text}" (confidence: ${segment.avg_logprob?.toFixed(3) || 'N/A'})`);
        });
      }

      if (!transcribedText) {
        throw new Error('No text transcribed from audio');
      }

      timing.textLength = transcribedText.length;

      console.log(`[Whisper] 📝 Enhanced transcription successful: "${transcribedText}" (${timing.textLength} chars)`);
      console.log(`[Whisper] 📊 Enhanced Whisper Performance:`, {
        latency: `${timing.totalLatencyMs.toFixed(2)}ms`,
        audioSize: `${(timing.audioSizeBytes / 1024).toFixed(2)}KB`,
        textLength: `${timing.textLength} chars`,
        throughput: `${(timing.textLength / (timing.totalLatencyMs / 1000)).toFixed(2)} chars/sec`,
        confidence: data.segments ? `${(data.segments.reduce((sum: number, seg: any) => sum + (seg.avg_logprob || 0), 0) / data.segments.length).toFixed(3)}` : 'N/A'
      });

      return {
        success: true,
        text: transcribedText,
        timing,
      };

    } catch (error) {
      timing.responseReceivedTime = timing.responseReceivedTime || performance.now();
      timing.totalLatencyMs = timing.responseReceivedTime - timing.requestStartTime;

      console.error('[Whisper] Enhanced transcription failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown transcription error',
        timing,
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
      console.error('[Whisper] Enhanced record and transcribe failed:', error);
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
      typeof MediaRecorder !== 'undefined' &&
      (typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined')
    );
  }

  /**
   * Get current recording state
   */
  getRecordingState(): 'inactive' | 'recording' | 'paused' {
    return this.mediaRecorder?.state || 'inactive';
  }

  /**
   * Get current audio level (0-1) for UI feedback
   */
  getCurrentAudioLevel(): number {
    return this.getAudioLevel();
  }

  /**
   * Clean up resources
   */
  private cleanup() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.gainNode = null;
    this.analyser = null;
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