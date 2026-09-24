// SOVA speech-to-text. Local mode uses faster-whisper; cloud mode uses OpenAI.
// VITE_STT_PROVIDER=openai opts into the hosted transcription procedure.
// The default transcribes through the local faster-whisper backend.
import type { DbConnection } from '../generated';
const LOCAL_STT = import.meta.env.VITE_STT_PROVIDER !== 'openai';
const VOICE_BACKEND_URL = import.meta.env.VITE_KOKORO_BASE_URL || 'http://localhost:8001';

export interface WhisperTiming {
  requestStartTime: number;
  responseReceivedTime: number;
  totalLatencyMs: number;
  audioSizeBytes: number;
  textLength: number;
  timestamp: string;
  success: boolean;
}

export interface WhisperPerformanceReport {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatencyMs: number;
  medianLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  averageAudioSizeKB: number;
  averageTextLength: number;
  averageThroughputCharsPerSecond: number;
  recentTimings: WhisperTiming[];
  generatedAt: string;
}

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
  private analyser: AnalyserNode | null = null;
  private audioLevelInterval: NodeJS.Timeout | null = null;
  private performanceData: WhisperTiming[] = [];
  private maxStoredTimings = 100; // Keep last 100 requests for analysis
  private connection: DbConnection | null = null;

  setConnection(connection: DbConnection | null) {
    this.connection = connection;
  }

  /**
   * Start recording audio from microphone with enhanced settings
   */
  async startRecording(): Promise<boolean> {
    try {
      console.log('[Whisper] Starting voice recording...');
      
      // Check if microphone access is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('[Whisper] getUserMedia not supported in this browser');
        throw new Error('Microphone access not supported. Please use a modern browser (Chrome, Firefox, Edge).');
      }

      // Request microphone access with optimal settings for speech recognition
      console.log('[Whisper] Requesting microphone access...');
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            // Reduced processing for better speech capture
            echoCancellation: false, // Disable - can filter out speech
            noiseSuppression: false, // Disable - can filter out speech
            autoGainControl: true, // Keep - helps normalize volume
            sampleRate: 48000, // Higher sample rate for better quality
            channelCount: 1, // Mono for better speech recognition
            sampleSize: 16, // 16-bit audio
          } 
        });
        console.log('[Whisper] ✅ Microphone access granted');
      } catch (mediaError: any) {
        console.error('[Whisper] ❌ Microphone access denied or failed:', mediaError);
        
        // Provide helpful error messages
        if (mediaError.name === 'NotAllowedError' || mediaError.name === 'PermissionDeniedError') {
          throw new Error('Microphone permission denied. Please allow microphone access in your browser settings and try again.');
        } else if (mediaError.name === 'NotFoundError' || mediaError.name === 'DevicesNotFoundError') {
          throw new Error('No microphone found. Please connect a microphone and try again.');
        } else if (mediaError.name === 'NotReadableError' || mediaError.name === 'TrackStartError') {
          throw new Error('Microphone is already in use by another application. Please close other apps using the microphone.');
        } else {
          throw new Error(`Microphone access failed: ${mediaError.message || 'Unknown error'}`);
        }
      }

      // Set up audio processing pipeline for monitoring only
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 48000 // Match the sample rate
      });
      
      const source = this.audioContext.createMediaStreamSource(this.stream);
      
      // Add analyzer for audio level monitoring
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      
      // Connect for monitoring only - don't modify the recording stream
      source.connect(this.analyser);
      
      // Create MediaRecorder with optimal settings
      const mimeType = this.getBestMimeType();
      console.log('[Whisper] Using MIME type:', mimeType);
      
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        audioBitsPerSecond: 256000, // Higher quality for better transcription (was 128000)
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
      console.log('[Whisper] ✅ Recording started successfully');
      
      // Verify recording is actually active
      if (this.mediaRecorder.state !== 'recording') {
        console.warn('[Whisper] ⚠️ MediaRecorder state is not "recording":', this.mediaRecorder.state);
      }
      
      // Log audio track info for debugging
      const audioTracks = this.stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const settings = audioTracks[0].getSettings();
        console.log('[Whisper] Audio track info:', {
          label: audioTracks[0].label,
          enabled: audioTracks[0].enabled,
          muted: audioTracks[0].muted,
          readyState: audioTracks[0].readyState,
          sampleRate: settings.sampleRate,
          channelCount: settings.channelCount,
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl
        });
        
        // Monitor audio levels to ensure we're actually capturing sound
        const checkAudioLevel = () => {
          if (this.analyser) {
            const level = this.getAudioLevel();
            if (level > 0.01) { // Only log if there's actual audio
              console.log(`[Whisper] 🔊 Audio level: ${(level * 100).toFixed(1)}%`);
            }
          }
        };
        
        // Check audio levels periodically
        this.audioLevelInterval = setInterval(checkAudioLevel, 500); // Check every 500ms
      } else {
        console.warn('[Whisper] ⚠️ No audio tracks found in stream');
      }
      
      return true;

    } catch (error) {
      console.error('[Whisper] ❌ Failed to start recording:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Whisper] Error details:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });
      this.cleanup();
      // Re-throw with better error message
      throw error;
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
   * Stop recording and return the audio blob
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
          // Create blob with original quality - no compression
          const audioBlob = new Blob(this.audioChunks, { 
            type: this.mediaRecorder?.mimeType || 'audio/webm' 
          });
          console.log('[Whisper] Audio blob created, size:', audioBlob.size, 'bytes');
          
          // Validate audio blob size - warn if suspiciously small
          if (audioBlob.size < 1000) { // Less than 1KB is suspicious
            console.warn('[Whisper] ⚠️ Audio blob is very small - may not contain valid audio:', audioBlob.size, 'bytes');
          }
          
          this.cleanup();
          resolve(audioBlob);
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
   * Transcribe audio with local faster-whisper or optional hosted OpenAI
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

    console.log(`[Whisper] 🎙️ Starting transcription - Audio: ${(audioBlob.size / 1024).toFixed(2)} KB, Type: ${audioBlob.type}`);
    
    // Log audio duration estimate (rough calculation based on typical bitrate)
    // WebM Opus at 256kbps: ~32KB per second
    const estimatedDurationSeconds = audioBlob.size / 32000; // Rough estimate
    console.log(`[Whisper] Estimated audio duration: ~${estimatedDurationSeconds.toFixed(1)} seconds`);

    try {
      if (LOCAL_STT) {
        const form = new FormData();
        form.append('audio', audioBlob, `speech.${this.getFileExtension(audioBlob.type)}`);
        const response = await fetch(`${VOICE_BACKEND_URL}/transcribe`, {
          method: 'POST',
          body: form,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || `Local transcription failed (${response.status})`);
        const text = String(result.text || '').trim();
        if (!text) throw new Error('No speech detected');
        timing.responseReceivedTime = performance.now();
        timing.totalLatencyMs = timing.responseReceivedTime - timing.requestStartTime;
        timing.textLength = text.length;
        this.recordTiming({ ...timing, success: true }, true);
        return { success: true, text, timing };
      }

      // Use original filename based on blob type
      const extension = this.getFileExtension(audioBlob.type);

      // Proxy expects JSON with base64 audio
      const reader = new FileReader();
      const audioBase64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1]; // Remove data:audio/webm;base64, prefix
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(audioBlob);
      });

      const procedures = (this.connection as any)?.procedures;
      const transcribeAccessor = procedures?.transcribeSpeech ?? procedures?.transcribe_speech;
      if (!transcribeAccessor) {
        throw new Error('transcribe_speech procedure is unavailable on this connection.');
      }

      const mimeType = audioBlob.type.split(';')[0] || `audio/${extension}`;

      console.log(`[Whisper] 📤 Sending to transcribe_speech procedure:`, {
        audioSize: `${(audioBlob.size / 1024).toFixed(2)} KB`,
        base64Length: audioBase64.length,
        contentType: mimeType,
      });

      const procResult = await transcribeAccessor({
        audioBase64,
        mimeType,
      });

      timing.responseReceivedTime = performance.now();
      timing.totalLatencyMs = timing.responseReceivedTime - timing.requestStartTime;

      console.log(`[Whisper] ⚡ Procedure response received in ${timing.totalLatencyMs.toFixed(2)}ms`);

      let transcribedText: string | undefined;
      if (typeof procResult === 'string') {
        transcribedText = procResult.trim();
      } else if (procResult && typeof procResult === 'object') {
        const resultObj = procResult as any;
        if (resultObj.tag === 'ok' || resultObj.tag === 'Ok') {
          transcribedText = String(resultObj.value ?? '').trim();
        } else if (resultObj.tag === 'err' || resultObj.tag === 'Err') {
          throw new Error(String(resultObj.value ?? 'transcribe_speech failed'));
        } else if (typeof resultObj.ok === 'string') {
          transcribedText = resultObj.ok.trim();
        } else if (resultObj.err) {
          throw new Error(String(resultObj.err));
        }
      }

      if (!transcribedText) {
        throw new Error('No text transcribed from audio');
      }

      timing.textLength = transcribedText.length;

      console.log(`[Whisper] 📝 Transcription successful: "${transcribedText}" (${timing.textLength} chars)`);
      console.log(`[Whisper] 📊 Whisper Performance:`, {
        latency: `${timing.totalLatencyMs.toFixed(2)}ms`,
        audioSize: `${(timing.audioSizeBytes / 1024).toFixed(2)}KB`,
        textLength: `${timing.textLength} chars`,
        throughput: `${(timing.textLength / (timing.totalLatencyMs / 1000)).toFixed(2)} chars/sec`,
        confidence: 'N/A',
      });

      // Record successful timing
      this.recordTiming({
        ...timing,
        success: true,
      }, true);

      return {
        success: true,
        text: transcribedText,
        timing,
      };
    } catch (error) {
      timing.responseReceivedTime = timing.responseReceivedTime || performance.now();
      timing.totalLatencyMs = timing.responseReceivedTime - timing.requestStartTime;

      console.error('[Whisper] Transcription failed:', error);
      
      // Record failed timing
      this.recordTiming({
        ...timing,
        success: false,
      }, false);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown transcription error',
        timing,
      };
    }
  }

  /**
   * Record timing data for performance analysis
   */
  private recordTiming(timing: WhisperTiming, success: boolean = true) {
    this.performanceData.push(timing);

    if (this.performanceData.length > this.maxStoredTimings) {
      this.performanceData = this.performanceData.slice(-this.maxStoredTimings);
    }

    console.log(`[Whisper] 📈 REQUEST SUMMARY:`, {
      success,
      audioSize: `${(timing.audioSizeBytes / 1024).toFixed(2)}KB`,
      textLength: `${timing.textLength} chars`,
      latency: `${timing.totalLatencyMs.toFixed(2)}ms`,
      throughput: `${(timing.textLength / (timing.totalLatencyMs / 1000)).toFixed(2)} chars/sec`
    });
  }

  /**
   * Generate performance report
   */
  generatePerformanceReport(): WhisperPerformanceReport {
    if (this.performanceData.length === 0) {
      return {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageLatencyMs: 0,
        medianLatencyMs: 0,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        averageAudioSizeKB: 0,
        averageTextLength: 0,
        averageThroughputCharsPerSecond: 0,
        recentTimings: [],
        generatedAt: new Date().toISOString(),
      };
    }

    const latencies = this.performanceData.map(t => t.totalLatencyMs);
    const successful = this.performanceData.filter(t => t.success);

    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    const medianIndex = Math.floor(sortedLatencies.length / 2);
    const median = sortedLatencies.length % 2 === 0
      ? (sortedLatencies[medianIndex - 1] + sortedLatencies[medianIndex]) / 2
      : sortedLatencies[medianIndex];

    return {
      totalRequests: this.performanceData.length,
      successfulRequests: successful.length,
      failedRequests: this.performanceData.length - successful.length,
      averageLatencyMs: latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length,
      medianLatencyMs: median,
      minLatencyMs: Math.min(...latencies),
      maxLatencyMs: Math.max(...latencies),
      averageAudioSizeKB: this.performanceData.reduce((sum, t) => sum + (t.audioSizeBytes / 1024), 0) / this.performanceData.length,
      averageTextLength: this.performanceData.reduce((sum, t) => sum + t.textLength, 0) / this.performanceData.length,
      averageThroughputCharsPerSecond: successful.reduce((sum, t) => sum + (t.textLength / (t.totalLatencyMs / 1000)), 0) / (successful.length || 1),
      recentTimings: this.performanceData.slice(-20),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Clear performance data
   */
  clearPerformanceData() {
    this.performanceData = [];
    console.log('[Whisper] Performance data cleared');
  }

  /**
   * Get appropriate file extension for the blob type
   */
  private getFileExtension(mimeType: string): string {
    // Normalize MIME type (remove codecs part if present)
    const normalizedType = mimeType.split(';')[0].toLowerCase();
    
    if (normalizedType.includes('webm')) return 'webm';
    if (normalizedType.includes('ogg')) return 'ogg';
    if (normalizedType.includes('mp4') || normalizedType.includes('m4a')) return 'mp4';
    if (normalizedType.includes('wav')) return 'wav';
    if (normalizedType.includes('flac')) return 'flac';
    
    // Default to webm (most browsers support this)
    console.warn(`[Whisper] Unknown MIME type: ${mimeType}, defaulting to webm`);
    return 'webm';
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

      // Transcribe with original audio quality
      console.log('[Whisper] 🚀 Starting transcription with original audio quality...');
      const result = await this.transcribeAudio(audioBlob);

      return result;

    } catch (error) {
      console.error('[Whisper] Record and transcribe failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if transcription is configured. The local backend is checked on request.
   */
  isConfigured(): boolean {
    if (LOCAL_STT) return true;
    return !!((this.connection as any)?.procedures?.transcribeSpeech || (this.connection as any)?.procedures?.transcribe_speech);
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
    // Stop audio level monitoring
    if (this.audioLevelInterval) {
      clearInterval(this.audioLevelInterval);
      this.audioLevelInterval = null;
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
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
