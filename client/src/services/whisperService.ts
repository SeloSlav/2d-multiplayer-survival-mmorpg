// OpenAI Whisper Service for Speech-to-Text
// Enhanced with audio processing, speed optimization, and accuracy optimizations

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || 'your-openai-api-key-here';
const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

// Audio optimization settings
const DEFAULT_SPEED_MULTIPLIER = 2.5; // 2.5x speed = 60% cost reduction and faster processing
const FALLBACK_SPEED_MULTIPLIER = 1.8; // Fallback if default fails
const MIN_AUDIO_DURATION_MS = 500; // Minimum duration to apply speed optimization

export interface WhisperResponse {
  success: boolean;
  text?: string;
  error?: string;
  timing?: {
    requestStartTime: number;
    responseReceivedTime: number;
    totalLatencyMs: number;
    audioSizeBytes: number;
    originalAudioDurationMs?: number;
    compressedAudioDurationMs?: number;
    speedMultiplier?: number;
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
   * Process audio blob for optimal Whisper compatibility with speed compression
   */
  private async processAudioForWhisper(blob: Blob): Promise<Blob> {
    try {
      console.log('[Whisper] 🚀 Starting speed-optimized audio processing...');
      
      // Check audio duration to determine if speed optimization is beneficial
      if (blob.size < 1000) { // Less than ~1KB
        console.warn('[Whisper] Very short audio recording - skipping speed optimization');
        return blob;
      }

      // Attempt to compress audio for cost and speed optimization
      const compressedBlob = await this.compressAudioSpeed(blob, DEFAULT_SPEED_MULTIPLIER);
      if (compressedBlob) {
        console.log(`[Whisper] ✅ Audio compressed at ${DEFAULT_SPEED_MULTIPLIER}x speed - Cost reduction: ${Math.round((1 - 1/DEFAULT_SPEED_MULTIPLIER) * 100)}%`);
        return compressedBlob;
      }

      console.log('[Whisper] Speed compression failed, returning original audio');
      return blob;
      
    } catch (error) {
      console.error('[Whisper] Audio processing failed:', error);
      return blob; // Return original if processing fails
    }
  }

  /**
   * Compress audio by speeding it up to reduce Whisper API costs and processing time
   */
  private async compressAudioSpeed(audioBlob: Blob, speedMultiplier: number): Promise<Blob | null> {
    try {
      console.log(`[Whisper] 🏃‍♂️ Compressing audio at ${speedMultiplier}x speed for cost optimization...`);
      
      // Create a new AudioContext for processing
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 22050 // Lower sample rate for Whisper (still good quality)
      });

      try {
        // Convert blob to ArrayBuffer
        const arrayBuffer = await audioBlob.arrayBuffer();
        
        // Decode audio data
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const originalDuration = audioBuffer.duration;
        
        console.log(`[Whisper] Original audio duration: ${originalDuration.toFixed(2)}s`);
        
        // Create new buffer with compressed duration
        const compressedDuration = originalDuration / speedMultiplier;
        const compressedSampleRate = audioContext.sampleRate;
        const compressedFrameCount = Math.ceil(compressedDuration * compressedSampleRate);
        
        const compressedBuffer = audioContext.createBuffer(
          1, // Mono
          compressedFrameCount,
          compressedSampleRate
        );

        // Get source channel data
        const sourceData = audioBuffer.getChannelData(0);
        const compressedData = compressedBuffer.getChannelData(0);

        // Speed up audio by sampling at intervals
        for (let i = 0; i < compressedFrameCount; i++) {
          const sourceIndex = Math.floor(i * speedMultiplier);
          if (sourceIndex < sourceData.length) {
            compressedData[i] = sourceData[sourceIndex];
          }
        }

        console.log(`[Whisper] Compressed audio duration: ${compressedDuration.toFixed(2)}s (${Math.round((1 - compressedDuration/originalDuration) * 100)}% reduction)`);

        // Convert back to blob
        const compressedBlob = await this.audioBufferToBlob(compressedBuffer, audioContext);
        
        await audioContext.close();
        return compressedBlob;

      } catch (error) {
        await audioContext.close();
        throw error;
      }

    } catch (error) {
      console.error(`[Whisper] Failed to compress audio at ${speedMultiplier}x:`, error);
      return null;
    }
  }

  /**
   * Convert AudioBuffer to WAV Blob
   */
  private async audioBufferToBlob(audioBuffer: AudioBuffer, audioContext: AudioContext): Promise<Blob> {
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const length = channelData.length;

    // Create WAV header
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);

    // Convert float samples to 16-bit PCM
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  /**
   * Transcribe audio blob using OpenAI Whisper with enhanced parameters and speed optimization tracking
   */
  async transcribeAudio(audioBlob: Blob, originalBlob?: Blob): Promise<WhisperResponse> {
    const timing = {
      requestStartTime: performance.now(),
      responseReceivedTime: 0,
      totalLatencyMs: 0,
      audioSizeBytes: audioBlob.size,
      originalAudioDurationMs: undefined as number | undefined,
      compressedAudioDurationMs: undefined as number | undefined,
      speedMultiplier: undefined as number | undefined,
      textLength: 0,
      timestamp: new Date().toISOString(),
    };

    // Calculate speed compression metrics if applicable
    if (originalBlob && originalBlob.size !== audioBlob.size) {
      timing.speedMultiplier = DEFAULT_SPEED_MULTIPLIER;
      // Estimate duration reduction (rough approximation)
      timing.originalAudioDurationMs = Math.max(1000, originalBlob.size / 10); // Rough estimate
      timing.compressedAudioDurationMs = timing.originalAudioDurationMs / DEFAULT_SPEED_MULTIPLIER;
    }

    const costReduction = timing.speedMultiplier ? Math.round((1 - 1/timing.speedMultiplier) * 100) : 0;
    
    console.log(`[Whisper] 🎙️ Starting enhanced transcription${timing.speedMultiplier ? ` with ${timing.speedMultiplier}x speed compression (${costReduction}% cost reduction)` : ''} - Audio: ${(audioBlob.size / 1024).toFixed(2)} KB`);

    try {
      // Create form data with enhanced parameters
      const formData = new FormData();
      
      // Use .wav extension for better Whisper compatibility
      formData.append('file', audioBlob, 'audio.wav');
      formData.append('model', 'whisper-1');
      formData.append('language', 'en'); // Force English for better accuracy
      formData.append('response_format', 'verbose_json'); // Get more detailed response
      formData.append('temperature', '0'); // Lower temperature for more consistent results
      
      // Add prompt for speed-compressed audio to help Whisper understand it's sped up
      if (timing.speedMultiplier) {
        formData.append('prompt', 'This is clear English speech that may be spoken quickly. Please transcribe accurately.');
      }

      const response = await fetch(WHISPER_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: formData,
      });

      timing.responseReceivedTime = performance.now();
      timing.totalLatencyMs = timing.responseReceivedTime - timing.requestStartTime;

      console.log(`[Whisper] ⚡ Enhanced Whisper response received in ${timing.totalLatencyMs.toFixed(2)}ms${timing.speedMultiplier ? ` (${costReduction}% cost savings)` : ''}`);

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
        const avgConfidence = data.segments.reduce((sum: number, seg: any) => sum + (seg.avg_logprob || 0), 0) / data.segments.length;
        console.log(`[Whisper] Average confidence: ${avgConfidence.toFixed(3)}`);
        
        // Log first few segments for debugging
        data.segments.slice(0, 3).forEach((segment: any, index: number) => {
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
        speedMultiplier: timing.speedMultiplier ? `${timing.speedMultiplier}x` : 'none',
        costReduction: timing.speedMultiplier ? `${costReduction}%` : '0%',
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
      
      // If this was a speed-compressed attempt, try fallback speed or original
      if (timing.speedMultiplier && timing.speedMultiplier > 1.5) {
        console.log('[Whisper] 🔄 Speed compression failed, attempting fallback...');
        // This will be handled by the calling code with fallback logic
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown transcription error',
        timing,
      };
    }
  }

  /**
   * Complete voice-to-text workflow: record and transcribe with speed optimization and fallback
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

      // Store original blob for fallback
      const originalBlob = audioBlob;

      // First attempt: Try with speed compression
      console.log('[Whisper] 🚀 Attempting speed-optimized transcription...');
      let result = await this.transcribeAudio(audioBlob, originalBlob);

      // If speed compression failed and we used compression, try fallback speed
      if (!result.success && result.timing?.speedMultiplier === DEFAULT_SPEED_MULTIPLIER) {
        console.log(`[Whisper] 🔄 Primary speed compression (${DEFAULT_SPEED_MULTIPLIER}x) failed, trying fallback speed (${FALLBACK_SPEED_MULTIPLIER}x)...`);
        
        try {
          const fallbackBlob = await this.compressAudioSpeed(originalBlob, FALLBACK_SPEED_MULTIPLIER);
          if (fallbackBlob) {
            result = await this.transcribeAudio(fallbackBlob, originalBlob);
            if (result.success && result.timing) {
              result.timing.speedMultiplier = FALLBACK_SPEED_MULTIPLIER;
            }
          }
        } catch (error) {
          console.error('[Whisper] Fallback speed compression failed:', error);
        }
      }

      // If both compressed attempts failed, try original audio
      if (!result.success) {
        console.log('[Whisper] 🔄 Speed compression attempts failed, trying original audio...');
        result = await this.transcribeAudio(originalBlob);
        if (result.timing) {
          result.timing.speedMultiplier = 1.0; // No compression
        }
      }

      return result;

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