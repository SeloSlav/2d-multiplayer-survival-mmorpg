// Kokoro TTS Service for Voice Synthesis
// Alternative to ElevenLabs, using self-hosted Kokoro model

console.log('[KokoroService] 🚀 Loading Kokoro TTS service...');

// Configuration
const KOKORO_BASE_URL = import.meta.env.VITE_KOKORO_BASE_URL || 'http://localhost:8001';
const KOKORO_SYNTHESIZE_ENDPOINT = `${KOKORO_BASE_URL}/synthesize`;

export interface KokoroResponse {
  success: boolean;
  audioUrl?: string;
  error?: string;
  timing?: KokoroTiming;
}

export interface VoiceSynthesisRequest {
  text: string;
  voice?: string; // Kokoro voice ID (e.g., 'af_heart', 'af_bella')
  voiceStyle?: string; // For compatibility with ElevenLabs interface, maps to voice
}

export interface KokoroTiming {
  requestStartTime: number;
  apiResponseTime: number;
  audioProcessedTime: number;
  totalLatencyMs: number;
  apiLatencyMs: number;
  audioProcessingMs: number;
  textLength: number;
  audioSizeBytes: number;
  voice: string;
  timestamp: string;
  // Pipeline timing from other services
  whisperLatencyMs?: number;
  openaiLatencyMs?: number;
  totalPipelineMs?: number;
}

export interface KokoroPerformanceReport {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatencyMs: number;
  medianLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  averageTextLength: number;
  averageAudioSizeKB: number;
  averageThroughputCharsPerSecond: number;
  recentTimings: KokoroTiming[];
  generatedAt: string;
}

class KokoroService {
  private performanceData: KokoroTiming[] = [];
  private maxStoredTimings = 100;
  private streamAbort?: AbortController;
  private streamSession = 0;
  private stopCurrentChunk?: () => void;
  
  // Cold start tracking - true after first successful TTS request
  private isWarmedUp = false;
  private warmingUpAudioPath = '/sounds/sova_thinking.mp3';
  
  // Voice mapping: maps voiceStyle strings to Kokoro voice IDs
  private voiceMap: Record<string, string> = {
    'sova': 'af_heart',      // SOVA's tactical voice - use Heart voice
    'default': 'af_heart',
    'bella': 'af_bella',
    'sarah': 'af_sarah',
    'michael': 'am_michael',
    'adam': 'am_adam',
  };

  constructor() {
    console.log('[KokoroService] 🔧 Initializing service...');
    console.log('[KokoroService] ✅ Service initialized successfully');
  }

  stopStreamingPlayback(): void {
    this.streamSession++;
    this.streamAbort?.abort();
    this.stopCurrentChunk?.();
    this.streamAbort = undefined;
  }

  private playStreamChunk(wav: string, session: number, onFirstAudio: () => void): Promise<boolean> {
    if (session !== this.streamSession) return Promise.resolve(false);
    const binary = atob(wav);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const audio = new Audio(url);
    audio.volume = 0.8;
    return new Promise(resolve => {
      let settled = false;
      const finish = (played: boolean) => {
        if (settled) return;
        settled = true;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
        if (this.stopCurrentChunk === stop) this.stopCurrentChunk = undefined;
        resolve(played);
      };
      const stop = () => finish(false);
      this.stopCurrentChunk = stop;
      audio.onplay = onFirstAudio;
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      void audio.play().catch(() => finish(false));
    });
  }

  /** Play Kokoro chunks and optionally collect OpenAI text from the same stream. */
  private async playNdjsonStream(
    path: string,
    body: object,
    onFirstAudio: () => void,
    onText?: (text: string) => void,
    authToken?: string,
  ): Promise<{ success: boolean; interrupted?: boolean; firstAudioMs?: number; textDoneMs?: number; chunks: number; text: string; error?: string }> {
    this.stopStreamingPlayback();
    const session = this.streamSession;
    const controller = new AbortController();
    this.streamAbort = controller;
    const started = performance.now();
    let firstAudioMs: number | undefined;
    let chunks = 0;
    let text = '';
    let textDoneMs: number | undefined;
    let streamError: string | undefined;
    let playback = Promise.resolve(true);
    let finished = false;
    try {
      const response = await fetch(`${KOKORO_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(detail?.detail || `SOVA stream failed: HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as { type: string; wav?: string; message?: string; chunks?: number; delta?: string };
        if (event.type === 'error') {
          streamError = event.message || 'SOVA stream failed';
          return;
        }
        if (event.type === 'text' && event.delta) {
          text += event.delta;
          onText?.(text);
        }
        if (event.type === 'text_done') textDoneMs = performance.now() - started;
        if (event.type === 'done') {
          finished = true;
          if (event.chunks === 0 && !streamError) throw new Error('Kokoro generated no audio');
        }
        if (event.type === 'audio' && event.wav) {
          chunks++;
          const wav = event.wav;
          playback = playback.then(played => {
            if (!played || session !== this.streamSession) return false;
            return this.playStreamChunk(wav, session, () => {
              if (firstAudioMs === undefined) {
                firstAudioMs = performance.now() - started;
                onFirstAudio();
              }
            });
          });
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          handleLine(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
        }
      }
      pending += decoder.decode();
      if (pending.trim()) handleLine(pending);
      if (!finished) throw new Error('SOVA stream ended early');
      const played = await playback;
      if (session !== this.streamSession) return { success: false, interrupted: true, chunks, text };
      this.isWarmedUp = true;
      console.info('[KokoroService] Streaming playback', { firstAudioMs, textDoneMs, chunks });
      return { success: played && chunks > 0 && !streamError, firstAudioMs, textDoneMs, chunks, text, error: streamError };
    } catch (error) {
      if (controller.signal.aborted || session !== this.streamSession) {
        return { success: false, interrupted: true, chunks, text };
      }
      this.stopCurrentChunk?.();
      return { success: false, chunks, text, error: error instanceof Error ? error.message : 'Voice stream failed' };
    } finally {
      if (this.streamAbort === controller) this.streamAbort = undefined;
    }
  }

  async synthesizeAndPlayStream(request: VoiceSynthesisRequest, onFirstAudio: () => void) {
    return this.playNdjsonStream('/synthesize-stream',
      { text: request.text, voice: this.getVoiceId(request.voice || request.voiceStyle) }, onFirstAudio);
  }

  async streamSOVAResponse(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    authToken: string,
    onText: (text: string) => void,
    onFirstAudio: () => void,
  ) {
    return this.playNdjsonStream('/respond-stream', { messages, voice: this.getVoiceId('sova') },
      onFirstAudio, onText, authToken);
  }

  /**
   * Check if this is the first TTS request (cold start)
   * Returns true if the service hasn't completed a successful request yet
   */
  isCold(): boolean {
    return !this.isWarmedUp;
  }

  /**
   * Get the path to the warmup/thinking audio file
   * Play this while TTS is processing on cold starts
   */
  getWarmupAudioPath(): string {
    return this.warmingUpAudioPath;
  }

  /**
   * Play the warmup audio and return a promise that resolves when done
   */
  async playWarmupAudio(): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(this.warmingUpAudioPath);
      audio.onended = () => resolve();
      audio.onerror = (e) => {
        console.error('[KokoroService] ❌ Failed to play warmup audio:', e);
        resolve(); // Don't reject - we still want TTS to proceed
      };
      audio.play().catch((e) => {
        console.error('[KokoroService] ❌ Failed to start warmup audio:', e);
        resolve();
      });
    });
  }

  /**
   * Convert text to speech using Kokoro TTS API
   */
  async synthesizeVoice(request: VoiceSynthesisRequest): Promise<KokoroResponse> {
    console.log('[KokoroService] 🎤 Starting TTS synthesis...');
    
    let timing: Partial<KokoroTiming>;
    
    try {
      timing = {
        requestStartTime: performance.now(),
        textLength: request.text?.length || 0,
        voice: this.getVoiceId(request.voiceStyle || request.voice || 'default'),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[KokoroService] ❌ Failed to create timing object:', error);
      return {
        success: false,
        error: 'Failed to initialize timing',
      };
    }

    console.log(`[KokoroService] 🎤 Starting TTS request - Text: "${request.text?.substring(0, 50) || 'undefined'}${(request.text?.length || 0) > 50 ? '...' : ''}" (${request.text?.length || 0} chars)`);

    // Validate request
    if (!request) {
      console.error('[KokoroService] ❌ Request object is null/undefined');
      return { success: false, error: 'Request object is required' };
    }

    // Validate input
    if (!request.text || request.text.trim().length === 0) {
      console.error('[KokoroService] ❌ Empty text provided');
      return { success: false, error: 'Text cannot be empty' };
    }

    if (request.text.length > 5000) {
      console.error('[KokoroService] ❌ Text too long:', request.text.length);
      return { success: false, error: 'Text too long (max 5000 characters)' };
    }

    try {
      const voiceId = this.getVoiceId(request.voiceStyle || request.voice || 'default');
      console.log(`[KokoroService] 🔧 Using voice: ${voiceId}`);

      const requestBody = {
        text: request.text,
        voice: voiceId,
        lang_code: 'a', // English
      };

      const preFetchTime = performance.now();
      console.log('[KokoroService] 🌐 Making request to Kokoro API:', KOKORO_SYNTHESIZE_ENDPOINT);
      console.log('[KokoroService] 📊 Setup time:', (preFetchTime - timing.requestStartTime!).toFixed(2) + 'ms');

      let response: Response;
      try {
        // Create abort controller for timeout (90 seconds for TTS which can be slow)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000);
        
        response = await fetch(KOKORO_SYNTHESIZE_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        console.log('[KokoroService] ✅ Fetch request completed');
      } catch (error) {
        console.error('[KokoroService] ❌ Fetch request failed:', error);
        if (error instanceof Error && error.name === 'AbortError') {
          return { success: false, error: 'Request timed out - TTS server may be busy' };
        }
        const errorMessage = error instanceof Error ? error.message : 'Unknown network error';
        return { success: false, error: `Network request failed: ${errorMessage}` };
      }

      timing.apiResponseTime = performance.now();
      timing.apiLatencyMs = timing.apiResponseTime - timing.requestStartTime!;

      console.log(`[KokoroService] ⚡ API response received in ${timing.apiLatencyMs.toFixed(2)}ms`);
      console.log('[KokoroService] Response status:', response.status);

      if (!response.ok) {
        let errorMessage = `Kokoro API Error: ${response.status} ${response.statusText}`;
        try {
          const errorText = await response.text();
          console.log('[KokoroService] Raw error response:', errorText);
          
          try {
            const errorData = JSON.parse(errorText);
            errorMessage += ` - ${errorData.detail || errorData.message || errorText}`;
          } catch {
            errorMessage += ` - ${errorText}`;
          }
        } catch (e) {
          console.error('[KokoroService] Failed to read error response:', e);
          errorMessage += ` - Failed to read error details`;
        }
        throw new Error(errorMessage);
      }

      const preBlobTime = performance.now();
      console.log('[KokoroService] 📊 Response header processing time:', (preBlobTime - timing.apiResponseTime!).toFixed(2) + 'ms');

      // Process audio response (WAV format)
      let audioBlob: Blob;
      try {
        audioBlob = await response.blob();
      } catch (e) {
        console.error('[KokoroService] Failed to read audio blob:', e);
        throw new Error('Failed to process audio response');
      }

      timing.audioProcessedTime = performance.now();
      timing.audioProcessingMs = timing.audioProcessedTime - timing.apiResponseTime!;
      timing.totalLatencyMs = timing.audioProcessedTime - timing.requestStartTime!;
      timing.audioSizeBytes = audioBlob.size;

      console.log(`[KokoroService] 🎵 Audio processed in ${timing.audioProcessingMs.toFixed(2)}ms`);
      console.log(`[KokoroService] 📊 Total latency: ${timing.totalLatencyMs.toFixed(2)}ms`);
      console.log(`[KokoroService] 🌐 API latency: ${timing.apiLatencyMs.toFixed(2)}ms`);
      console.log(`[KokoroService] 📁 Audio size: ${(timing.audioSizeBytes / 1024).toFixed(2)} KB`);
      console.log(`[KokoroService] 🚀 Throughput: ${(timing.textLength! / (timing.totalLatencyMs / 1000)).toFixed(2)} chars/sec`);

      if (audioBlob.size === 0) {
        throw new Error('Received empty audio response');
      }

      const contentType = audioBlob.type || response.headers.get('content-type') || 'audio/wav';
      console.log('[KokoroService] Response content type:', contentType);

      // Create audio URL
      let audioUrl: string;
      try {
        audioUrl = URL.createObjectURL(audioBlob);
        console.log('[KokoroService] Audio URL created successfully');
      } catch (e) {
        console.error('[KokoroService] Failed to create audio URL:', e);
        throw new Error('Failed to create audio URL');
      }

      // Store performance data
      this.recordTiming(timing as KokoroTiming);

      // Mark service as warmed up after first successful request
      if (!this.isWarmedUp) {
        this.isWarmedUp = true;
        console.log('[KokoroService] 🔥 Service is now warmed up!');
      }

      return {
        success: true,
        audioUrl: audioUrl,
        timing: timing as KokoroTiming,
      };
    } catch (error) {
      const failedTiming = {
        ...timing,
        apiResponseTime: timing.apiResponseTime || performance.now(),
        audioProcessedTime: performance.now(),
        totalLatencyMs: performance.now() - timing.requestStartTime!,
        apiLatencyMs: (timing.apiResponseTime || performance.now()) - timing.requestStartTime!,
        audioProcessingMs: 0,
        audioSizeBytes: 0,
      } as KokoroTiming;

      this.recordTiming(failedTiming, false);

      console.error('[KokoroService] Voice synthesis failed:', error);
      console.error('[KokoroService] Error stack:', error instanceof Error ? error.stack : 'No stack trace');

      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('[KokoroService] Final error message:', errorMessage);

      return {
        success: false,
        error: errorMessage,
        timing: failedTiming,
      };
    }
  }

  /**
   * Map voice style to Kokoro voice ID
   */
  private getVoiceId(voiceStyleOrId?: string): string {
    if (!voiceStyleOrId) return 'af_heart';
    
    // If it's already a valid Kokoro voice ID (starts with 'af_' or 'am_'), return as-is
    if (voiceStyleOrId.startsWith('af_') || voiceStyleOrId.startsWith('am_')) {
      return voiceStyleOrId;
    }
    
    // Otherwise, map from voice style
    return this.voiceMap[voiceStyleOrId.toLowerCase()] || 'af_heart';
  }

  /**
   * Record timing data for performance analysis
   */
  private recordTiming(timing: KokoroTiming, success: boolean = true) {
    this.performanceData.push(timing);

    if (this.performanceData.length > this.maxStoredTimings) {
      this.performanceData = this.performanceData.slice(-this.maxStoredTimings);
    }

    console.log(`[KokoroService] 📈 REQUEST SUMMARY:`, {
      success,
      text: `"${timing.textLength} chars"`,
      latency: `${timing.totalLatencyMs.toFixed(2)}ms`,
      network: `${timing.apiLatencyMs.toFixed(2)}ms`,
      processing: `${timing.audioProcessingMs.toFixed(2)}ms`,
      audioSize: `${(timing.audioSizeBytes / 1024).toFixed(2)}KB`,
      throughput: `${(timing.textLength / (timing.totalLatencyMs / 1000)).toFixed(2)} chars/sec`
    });
  }

  /**
   * Generate performance report
   */
  generatePerformanceReport(): KokoroPerformanceReport {
    if (this.performanceData.length === 0) {
      return {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageLatencyMs: 0,
        medianLatencyMs: 0,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        averageTextLength: 0,
        averageAudioSizeKB: 0,
        averageThroughputCharsPerSecond: 0,
        recentTimings: [],
        generatedAt: new Date().toISOString(),
      };
    }

    const latencies = this.performanceData.map(t => t.totalLatencyMs);
    const successful = this.performanceData.filter(t => t.audioSizeBytes > 0);

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
      averageTextLength: this.performanceData.reduce((sum, t) => sum + t.textLength, 0) / this.performanceData.length,
      averageAudioSizeKB: successful.reduce((sum, t) => sum + (t.audioSizeBytes / 1024), 0) / (successful.length || 1),
      averageThroughputCharsPerSecond: successful.reduce((sum, t) => sum + (t.textLength / (t.totalLatencyMs / 1000)), 0) / (successful.length || 1),
      recentTimings: this.performanceData.slice(-20),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Play audio from URL with error handling
   */
  async playAudio(audioUrl: string): Promise<boolean> {
    return new Promise((resolve) => {
      console.log('[KokoroService] 🔊 Playing audio...');

      const audio = new Audio(audioUrl);
      let hasPlayed = false;

      audio.onloadstart = () => {
        console.log('[KokoroService] Audio loading started...');
      };

      audio.oncanplay = () => {
        console.log('[KokoroService] Audio can start playing');
      };

      audio.onplay = () => {
        console.log('[KokoroService] Audio playback started');
        hasPlayed = true;
      };

      audio.onended = () => {
        console.log('[KokoroService] ✅ Audio playback completed successfully');
        URL.revokeObjectURL(audioUrl);
        resolve(true);
      };

      audio.onerror = (error) => {
        console.error('[KokoroService] ❌ Audio playback failed:', error);
        console.error('[KokoroService] Audio error details:', {
          error: audio.error,
          networkState: audio.networkState,
          readyState: audio.readyState,
          audioUrl: audioUrl.substring(0, 100) + '...'
        });

        URL.revokeObjectURL(audioUrl);
        resolve(false);
      };

      audio.onabort = () => {
        console.warn('[KokoroService] Audio playback was aborted');
        URL.revokeObjectURL(audioUrl);
        resolve(hasPlayed);
      };

      audio.volume = 0.8;

      audio.play().catch(error => {
        console.error('[KokoroService] ❌ Failed to start audio playback:', error);
        URL.revokeObjectURL(audioUrl);
        resolve(false);
      });

      setTimeout(() => {
        if (!hasPlayed) {
          console.warn('[KokoroService] ⚠️ Audio playback timeout - assuming failure');
          URL.revokeObjectURL(audioUrl);
          resolve(false);
        }
      }, 30000);
    });
  }

  /**
   * Update pipeline timing with data from other services
   */
  updatePipelineTiming(whisperLatencyMs: number, openaiLatencyMs: number) {
    if (this.performanceData.length > 0) {
      const latestTiming = this.performanceData[this.performanceData.length - 1];
      latestTiming.whisperLatencyMs = whisperLatencyMs;
      latestTiming.openaiLatencyMs = openaiLatencyMs;
      latestTiming.totalPipelineMs = whisperLatencyMs + openaiLatencyMs + latestTiming.totalLatencyMs;

      console.log('[KokoroService] 🔗 Updated pipeline timing:', {
        whisper: `${whisperLatencyMs.toFixed(2)}ms`,
        openai: `${openaiLatencyMs.toFixed(2)}ms`,
        kokoro: `${latestTiming.totalLatencyMs.toFixed(2)}ms`,
        totalPipeline: `${latestTiming.totalPipelineMs.toFixed(2)}ms`
      });
    }
  }

  /**
   * Check if service is properly configured
   */
  isConfigured(): boolean {
    // Service is configured if base URL is set (defaults to localhost:8001)
    return true; // Always available if backend is running
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    console.log('[KokoroService] 🧪 Testing API connection...');

    try {
      const response = await fetch(`${KOKORO_BASE_URL}/health`);
      if (response.ok) {
        const data = await response.json();
        console.log('[KokoroService] ✅ API connection test successful:', data);
        return data.pipeline_ready
          ? { success: true }
          : { success: false, error: 'Kokoro model has not loaded' };
      } else {
        return { success: false, error: `Health check failed: ${response.status}` };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection test failed';
      console.error('[KokoroService] ❌ API connection test failed:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get available voices
   */
  async getVoices(): Promise<{ voices: Array<{ id: string; name: string; description: string }> }> {
    try {
      const response = await fetch(`${KOKORO_BASE_URL}/voices`);
      if (response.ok) {
        return await response.json();
      }
      return { voices: [] };
    } catch (error) {
      console.error('[KokoroService] Failed to fetch voices:', error);
      return { voices: [] };
    }
  }

  /**
   * Clear all performance data
   */
  clearPerformanceData() {
    this.performanceData = [];
    console.log('[KokoroService] Performance data cleared');
  }

  /**
   * Warm up the TTS service by pinging health endpoint
   * Call this early to wake up the Railway service from sleep
   */
  warmup(): void {
    // Fire and forget - don't await
    fetch(`${KOKORO_BASE_URL}/health`, { method: 'GET' })
      .then(() => console.log('[KokoroService] 🔥 Warmup ping sent'))
      .catch(() => {}); // Silently ignore errors
  }
}

// Export singleton instance
const kokoroService = new KokoroService();

// Auto-warmup on import (helps wake Railway from sleep early)
if (typeof window !== 'undefined') {
  // Delay warmup slightly to not block initial page load
  setTimeout(() => kokoroService.warmup(), 2000);
}

export { kokoroService };
export default kokoroService;

