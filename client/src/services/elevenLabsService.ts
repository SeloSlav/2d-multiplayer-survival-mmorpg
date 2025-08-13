// ElevenLabs API Service for Voice Synthesis (SAFE MODE)
import { openaiService, type SOVAPromptRequest } from './openaiService';

console.log('[ElevenLabsService] 🚀 Loading ElevenLabs service...');

// Simple, safe configuration
const ELEVENLABS_VOICE_ID = 'UivHUCWpHRyCj1nnWAhu';
const ELEVENLABS_MODEL = 'eleven_turbo_v2_5'; // Faster model for testing

let ELEVENLABS_API_KEY = 'not-loaded';
let ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
let TTS_ENDPOINT = '';

// Safely load configuration
try {
  if (import.meta && import.meta.env) {
    ELEVENLABS_API_KEY = import.meta.env.ELEVENLABS_API_KEY || 'not-configured';
    console.log('[ElevenLabsService] ✅ API key status:', ELEVENLABS_API_KEY ? 'loaded' : 'missing');
  }
  TTS_ENDPOINT = `${ELEVENLABS_BASE_URL}/text-to-speech/${ELEVENLABS_VOICE_ID}`;
} catch (error) {
  console.error('[ElevenLabsService] Configuration error:', error);
}

export interface ElevenLabsResponse {
  success: boolean;
  audioUrl?: string;
  error?: string;
  timing?: ElevenLabsTiming;
}

export interface VoiceSynthesisRequest {
  text: string;
  voiceStyle?: string; // Kept for compatibility, but mapped to ElevenLabs settings
}

export interface ElevenLabsTiming {
  requestStartTime: number;
  apiResponseTime: number;
  elevenLabsResponseTime: number;
  audioProcessedTime: number;
  totalLatencyMs: number;
  apiLatencyMs: number;
  elevenLabsApiLatencyMs: number;
  audioProcessingMs: number;
  textLength: number;
  audioSizeBytes: number;
  voiceStyle: string;
  timestamp: string;
  // Pipeline timing from other services
  whisperLatencyMs?: number;
  openaiLatencyMs?: number;
  totalPipelineMs?: number;
}

export interface ElevenLabsPerformanceReport {
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
  recentTimings: ElevenLabsTiming[];
  generatedAt: string;
}

class ElevenLabsService {
  private performanceData: ElevenLabsTiming[] = [];
  private maxStoredTimings = 100; // Keep last 100 requests for analysis
  private apiKey: string;

  constructor() {
    try {
      console.log('[ElevenLabsService] 🔧 Initializing service...');
      this.apiKey = ELEVENLABS_API_KEY;
      console.log('[ElevenLabsService] 🔧 API key loaded:', this.apiKey ? 'YES' : 'NO');
      console.log('[ElevenLabsService] ✅ Service initialized successfully');
    } catch (error) {
      console.error('[ElevenLabsService] ❌ Failed to initialize service:', error);
      this.apiKey = 'initialization-failed';
    }
  }

  /**
   * Convert text to speech using ElevenLabs API with comprehensive timing
   */
  async synthesizeVoice(request: VoiceSynthesisRequest): Promise<ElevenLabsResponse> {
    console.log('[ElevenLabsService] 🎤 ENTERING synthesizeVoice method');
    
    let timing: Partial<ElevenLabsTiming>;
    
    try {
      timing = {
        requestStartTime: performance.now(),
        textLength: request.text?.length || 0,
        voiceStyle: request.voiceStyle || 'default',
        timestamp: new Date().toISOString(),
      };
      console.log('[ElevenLabsService] 🎤 Timing object created successfully');
    } catch (error) {
      console.error('[ElevenLabsService] ❌ Failed to create timing object:', error);
      return {
        success: false,
        error: 'Failed to initialize timing',
      };
    }

    console.log(`[ElevenLabsService] 🎤 Starting TTS request - Text: "${request.text?.substring(0, 50) || 'undefined'}${(request.text?.length || 0) > 50 ? '...' : ''}" (${request.text?.length || 0} chars)`);

    // Validate request object
    if (!request) {
      console.error('[ElevenLabsService] ❌ Request object is null/undefined');
      return { success: false, error: 'Request object is required' };
    }

    // Validate API key
    try {
      console.log('[ElevenLabsService] 🔑 Checking API configuration...');
      if (!this.isConfigured()) {
        console.error('[ElevenLabsService] ❌ API not configured');
        return { success: false, error: 'ElevenLabs API key not configured. Please set ELEVENLABS_API_KEY environment variable.' };
      }
      console.log('[ElevenLabsService] ✅ API configuration OK');
    } catch (error) {
      console.error('[ElevenLabsService] ❌ API configuration check failed:', error);
      return { success: false, error: 'API configuration check failed' };
    }

    // Validate input
    if (!request.text || request.text.trim().length === 0) {
      console.error('[ElevenLabsService] ❌ Empty text provided');
      return { success: false, error: 'Text cannot be empty' };
    }

    if (request.text.length > 5000) {
      console.error('[ElevenLabsService] ❌ Text too long:', request.text.length);
      return { success: false, error: 'Text too long (max 5000 characters)' };
    }

    try {
      console.log('[ElevenLabsService] 🔧 Preparing request...');
      
      // Map voice style to ElevenLabs voice settings
      let voiceSettings;
      try {
        voiceSettings = this.getVoiceSettings(request.voiceStyle);
        console.log('[ElevenLabsService] ✅ Voice settings prepared');
      } catch (error) {
        console.error('[ElevenLabsService] ❌ Failed to get voice settings:', error);
        return { success: false, error: 'Failed to prepare voice settings' };
      }
      
      let requestBody;
      try {
        requestBody = {
          text: request.text,
          model_id: ELEVENLABS_MODEL,
          voice_settings: voiceSettings,
          output_format: "mp3_44100_128"
        };
        console.log('[ElevenLabsService] ✅ Request body prepared');
      } catch (error) {
        console.error('[ElevenLabsService] ❌ Failed to create request body:', error);
        return { success: false, error: 'Failed to prepare request body' };
      }
      
      // 🚨 ENHANCED DIAGNOSTIC TIMING - Pre-fetch
      const preFetchTime = performance.now();
      console.log('[ElevenLabsService] 🌐 Making request to ElevenLabs API:', TTS_ENDPOINT);
      console.log('[ElevenLabsService] 📊 Setup time:', (preFetchTime - timing.requestStartTime!).toFixed(2) + 'ms');
      
      let response;
      try {
        response = await fetch(TTS_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.apiKey,
          },
          body: JSON.stringify(requestBody),
        });
        console.log('[ElevenLabsService] ✅ Fetch request completed');
      } catch (error) {
        console.error('[ElevenLabsService] ❌ Fetch request failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown network error';
        return { success: false, error: `Network request failed: ${errorMessage}` };
      }

      timing.apiResponseTime = performance.now();
      timing.apiLatencyMs = timing.apiResponseTime - timing.requestStartTime!;

      // 🚨 CRITICAL DIAGNOSTIC: This is the pure ElevenLabs API time
      console.log(`[ElevenLabsService] ⚡ API response received in ${timing.apiLatencyMs.toFixed(2)}ms`);
      console.log(`[ElevenLabsService] 🚨 PURE ELEVENLABS TIME: ${timing.apiLatencyMs.toFixed(2)}ms (this is what ElevenLabs took)`);
      console.log('[ElevenLabsService] Response status:', response.status);

      if (!response.ok) {
        let errorMessage = `ElevenLabs API Error: ${response.status} ${response.statusText}`;
        try {
          const errorText = await response.text();
          console.log('[ElevenLabsService] Raw error response:', errorText);
          
          try {
            const errorData = JSON.parse(errorText);
            errorMessage += ` - ${errorData.detail?.message || errorData.message || errorText}`;
          } catch {
            errorMessage += ` - ${errorText}`;
          }
        } catch (e) {
          console.error('[ElevenLabsService] Failed to read error response:', e);
          errorMessage += ` - Failed to read error details`;
        }
        throw new Error(errorMessage);
      }

      // 🚨 ENHANCED DIAGNOSTIC TIMING - Pre-blob processing
      const preBlobTime = performance.now();
      console.log('[ElevenLabsService] 📊 Response header processing time:', (preBlobTime - timing.apiResponseTime!).toFixed(2) + 'ms');

      // Process audio response
      let audioBlob: Blob;
      try {
        audioBlob = await response.blob();
      } catch (e) {
        console.error('[ElevenLabsService] Failed to read audio blob:', e);
        throw new Error('Failed to process audio response');
      }

      timing.elevenLabsResponseTime = performance.now();
      timing.audioProcessedTime = performance.now();
      timing.elevenLabsApiLatencyMs = timing.elevenLabsResponseTime - timing.apiResponseTime!;
      timing.audioProcessingMs = timing.audioProcessedTime - timing.elevenLabsResponseTime!;
      timing.totalLatencyMs = timing.audioProcessedTime - timing.requestStartTime!;
      timing.audioSizeBytes = audioBlob.size;

      // 🚨 DETAILED BREAKDOWN FOR DEBUGGING
      console.log(`[ElevenLabsService] 🎵 Audio processed in ${timing.audioProcessingMs.toFixed(2)}ms`);
      console.log(`[ElevenLabsService] 📊 Total latency: ${timing.totalLatencyMs.toFixed(2)}ms`);
      console.log(`[ElevenLabsService] 🌐 API latency: ${timing.apiLatencyMs.toFixed(2)}ms`);
      console.log(`[ElevenLabsService] 🎤 ElevenLabs API latency: ${timing.elevenLabsApiLatencyMs.toFixed(2)}ms`);
      console.log(`[ElevenLabsService] 📁 Audio size: ${(timing.audioSizeBytes / 1024).toFixed(2)} KB`);
      console.log(`[ElevenLabsService] 🚀 Throughput: ${(timing.textLength! / (timing.totalLatencyMs / 1000)).toFixed(2)} chars/sec`);
      
      // 🚨 FINAL DIAGNOSTIC SUMMARY
      console.log('[ElevenLabsService] 🔍 LATENCY BREAKDOWN:');
      console.log(`  • Setup: ${(preFetchTime - timing.requestStartTime!).toFixed(2)}ms`);
      console.log(`  • Network + ElevenLabs processing: ${timing.apiLatencyMs.toFixed(2)}ms ⭐ KEY METRIC`);
      console.log(`  • Blob reading: ${timing.elevenLabsApiLatencyMs.toFixed(2)}ms`);
      console.log(`  • URL creation: ${timing.audioProcessingMs.toFixed(2)}ms`);
      console.log(`  • Total: ${timing.totalLatencyMs.toFixed(2)}ms`);
      
      // Check if we actually got audio data
      if (audioBlob.size === 0) {
        throw new Error('Received empty audio response');
      }

      // Get content type for validation
      const contentType = audioBlob.type || response.headers.get('content-type') || '';
      console.log('[ElevenLabsService] Response content type:', contentType);
      
      // Create audio URL
      let audioUrl: string;
      try {
        audioUrl = URL.createObjectURL(audioBlob);
        console.log('[ElevenLabsService] Audio URL created successfully');
      } catch (e) {
        console.error('[ElevenLabsService] Failed to create audio URL:', e);
        throw new Error('Failed to create audio URL');
      }

      // Store performance data
      this.recordTiming(timing as ElevenLabsTiming);
      
      return {
        success: true,
        audioUrl: audioUrl,
        timing: timing as ElevenLabsTiming,
      };
    } catch (error) {
      // Record failed timing
      const failedTiming = {
        ...timing,
        apiResponseTime: timing.apiResponseTime || performance.now(),
        elevenLabsResponseTime: timing.elevenLabsResponseTime || performance.now(),
        audioProcessedTime: performance.now(),
        totalLatencyMs: performance.now() - timing.requestStartTime!,
        apiLatencyMs: (timing.apiResponseTime || performance.now()) - timing.requestStartTime!,
        elevenLabsApiLatencyMs: 0,
        audioProcessingMs: 0,
        audioSizeBytes: 0,
      } as ElevenLabsTiming;

      this.recordTiming(failedTiming, false);

      console.error('[ElevenLabsService] Voice synthesis failed:', error);
      console.error('[ElevenLabsService] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('[ElevenLabsService] Final error message:', errorMessage);
      
      return {
        success: false,
        error: errorMessage,
        timing: failedTiming,
      };
    }
  }

  /**
   * Get voice settings optimized for the specified ElevenLabs voice
   */
  private getVoiceSettings(voiceStyle?: string) {
    // Voice settings optimized for voice ID "UivHUCWpHRyCj1nnWAhu"
    // These settings work well for SOVA's tactical AI personality
    return {
      stability: 0.71,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
    };
  }

  /**
   * Record timing data for performance analysis
   */
  private recordTiming(timing: ElevenLabsTiming, success: boolean = true) {
    this.performanceData.push(timing);
    
    // Keep only the most recent timings
    if (this.performanceData.length > this.maxStoredTimings) {
      this.performanceData = this.performanceData.slice(-this.maxStoredTimings);
    }

    // Log summary for each request
    console.log(`[ElevenLabsService] 📈 REQUEST SUMMARY:`, {
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
  generatePerformanceReport(): ElevenLabsPerformanceReport {
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
      recentTimings: this.performanceData.slice(-20), // Last 20 requests
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Generate formatted performance report
   */
  generateFormattedReport(): string {
    const report = this.generatePerformanceReport();
    
    if (report.totalRequests === 0) {
      return `
🎤 ELEVENLABS PERFORMANCE REPORT
Generated: ${new Date().toLocaleString()}

No data available - no requests have been made yet.
      `.trim();
    }

    const successRate = ((report.successfulRequests / report.totalRequests) * 100).toFixed(1);
    
    return `
🎤 ELEVENLABS PERFORMANCE REPORT
Generated: ${new Date(report.generatedAt).toLocaleString()}

📊 REQUEST STATISTICS:
• Total Requests: ${report.totalRequests}
• Successful: ${report.successfulRequests} (${successRate}%)
• Failed: ${report.failedRequests}

⚡ LATENCY METRICS:
• Average Latency: ${report.averageLatencyMs.toFixed(2)}ms
• Median Latency: ${report.medianLatencyMs.toFixed(2)}ms
• Min Latency: ${report.minLatencyMs.toFixed(2)}ms
• Max Latency: ${report.maxLatencyMs.toFixed(2)}ms

📝 CONTENT METRICS:
• Average Text Length: ${report.averageTextLength.toFixed(0)} characters
• Average Audio Size: ${report.averageAudioSizeKB.toFixed(2)} KB
• Average Throughput: ${report.averageThroughputCharsPerSecond.toFixed(2)} chars/second

🎯 RECENT PERFORMANCE (Last 5 requests):
${report.recentTimings.slice(-5).map((timing, index) => 
  `${index + 1}. ${timing.totalLatencyMs.toFixed(2)}ms | ${timing.textLength} chars | ${(timing.audioSizeBytes / 1024).toFixed(2)}KB`
).join('\n')}
    `.trim();
  }

  /**
   * Log performance report to console
   */
  logPerformanceReport() {
    console.log(this.generateFormattedReport());
  }

  /**
   * Get raw performance data
   */
  getRawPerformanceData(): ElevenLabsTiming[] {
    return [...this.performanceData];
  }

  /**
   * Clear performance data
   */
  clearPerformanceData() {
    this.performanceData = [];
    console.log('[ElevenLabsService] Performance data cleared');
  }

  /**
   * Generate SOVA voice response using OpenAI + ElevenLabs
   */
  async generateSOVAVoiceResponse(messageText: string, gameContext?: SOVAPromptRequest['gameContext']): Promise<ElevenLabsResponse> {
    console.log('[ElevenLabsService] 🤖 Generating SOVA response with voice synthesis...');
    
    try {
      // Step 1: Generate AI response text
      const aiResponse = await openaiService.generateSOVAResponse({
        userMessage: messageText,
        gameContext,
      });

      if (!aiResponse.success || !aiResponse.response) {
        throw new Error(aiResponse.error || 'Failed to generate AI response');
      }

      // Step 2: Convert AI response to speech
      const responseText = this.formatSOVAResponse(aiResponse.response);
      return await this.synthesizeVoice({
        text: responseText,
        voiceStyle: 'sova', // SOVA's tactical voice using ElevenLabs voice ID
      });

    } catch (error) {
      console.error('[ElevenLabsService] Failed to generate SOVA voice response:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Format SOVA's response for better speech synthesis
   */
  private formatSOVAResponse(userMessage: string): string {
    // Add subtle pauses and emphasis for more natural speech
    return userMessage
      .replace(/\. /g, '. ')
      .replace(/! /g, '! ')
      .replace(/\? /g, '? ');
  }

  /**
   * Play audio from URL with error handling
   */
  async playAudio(audioUrl: string): Promise<boolean> {
    return new Promise((resolve) => {
      console.log('[ElevenLabsService] 🔊 Playing audio...');
      
      const audio = new Audio(audioUrl);
      let hasPlayed = false;
      
      // Set up audio event handlers
      audio.onloadstart = () => {
        console.log('[ElevenLabsService] Audio loading started...');
      };
      
      audio.oncanplay = () => {
        console.log('[ElevenLabsService] Audio can start playing');
      };
      
      audio.onplay = () => {
        console.log('[ElevenLabsService] Audio playback started');
        hasPlayed = true;
      };
      
      audio.onended = () => {
        console.log('[ElevenLabsService] ✅ Audio playback completed successfully');
        // Clean up the blob URL to free memory
        URL.revokeObjectURL(audioUrl);
        resolve(true);
      };
      
      audio.onerror = (error) => {
        console.error('[ElevenLabsService] ❌ Audio playback failed:', error);
        console.error('[ElevenLabsService] Audio error details:', {
          error: audio.error,
          networkState: audio.networkState,
          readyState: audio.readyState,
          audioUrl: audioUrl.substring(0, 100) + '...'
        });
        
        // Clean up the blob URL
        URL.revokeObjectURL(audioUrl);
        resolve(false);
      };
      
      audio.onabort = () => {
        console.warn('[ElevenLabsService] Audio playback was aborted');
        URL.revokeObjectURL(audioUrl);
        resolve(hasPlayed); // Consider it successful if it at least started playing
      };
      
      // Set volume and attempt to play
      audio.volume = 0.8; // Slightly lower volume for better experience
      
      // Try to play the audio
      audio.play().catch(error => {
        console.error('[ElevenLabsService] ❌ Failed to start audio playback:', error);
        URL.revokeObjectURL(audioUrl);
        resolve(false);
      });
      
      // Fallback timeout in case audio events don't fire properly
      setTimeout(() => {
        if (!hasPlayed) {
          console.warn('[ElevenLabsService] ⚠️ Audio playback timeout - assuming failure');
          URL.revokeObjectURL(audioUrl);
          resolve(false);
        }
      }, 30000); // 30 second timeout
    });
  }

  /**
   * Generate and play SOVA response (full pipeline)
   */
  async generateAndPlaySOVAResponse(userMessage: string, gameContext?: SOVAPromptRequest['gameContext']): Promise<{ success: boolean; responseText?: string; error?: string }> {
    console.log('[ElevenLabsService] 🎤 Starting full SOVA response pipeline...');
    
    try {
      // Generate voice response
      const voiceResponse = await this.generateSOVAVoiceResponse(userMessage, gameContext);
      
      if (!voiceResponse.success || !voiceResponse.audioUrl) {
        return {
          success: false,
          error: voiceResponse.error || 'Failed to generate voice response',
        };
      }
      
      // Play the audio
      const playbackSuccess = await this.playAudio(voiceResponse.audioUrl);
      
      return {
        success: playbackSuccess,
        responseText: userMessage, // We don't have the AI response text here, but keeping interface compatible
        error: playbackSuccess ? undefined : 'Audio playback failed',
      };
      
    } catch (error) {
      console.error('[ElevenLabsService] ❌ Full SOVA pipeline failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error in SOVA pipeline',
      };
    }
  }

  /**
   * Update pipeline timing with data from other services
   */
  updatePipelineTiming(whisperLatencyMs: number, openaiLatencyMs: number) {
    // Find the most recent timing record and update it
    if (this.performanceData.length > 0) {
      const latestTiming = this.performanceData[this.performanceData.length - 1];
      latestTiming.whisperLatencyMs = whisperLatencyMs;
      latestTiming.openaiLatencyMs = openaiLatencyMs;
      latestTiming.totalPipelineMs = whisperLatencyMs + openaiLatencyMs + latestTiming.totalLatencyMs;
      
      console.log('[ElevenLabsService] 🔗 Updated pipeline timing:', {
        whisper: `${whisperLatencyMs.toFixed(2)}ms`,
        openai: `${openaiLatencyMs.toFixed(2)}ms`,
        elevenlabs: `${latestTiming.totalLatencyMs.toFixed(2)}ms`,
        totalPipeline: `${latestTiming.totalPipelineMs.toFixed(2)}ms`
      });
    }
  }

  /**
   * Check if service is properly configured
   */
  isConfigured(): boolean {
    const configured = !!(this.apiKey && this.apiKey !== 'your-elevenlabs-api-key-here');
    if (!configured) {
      console.warn('[ElevenLabsService] ⚠️ Service not configured - missing ELEVENLABS_API_KEY');
    }
    return configured;
  }

  /**
   * Test API connection with a simple request
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    console.log('[ElevenLabsService] 🧪 Testing API connection...');
    
    try {
      const result = await this.synthesizeVoice({
        text: 'Test',
        voiceStyle: 'test'
      });
      
      if (result.success) {
        console.log('[ElevenLabsService] ✅ API connection test successful');
        // Clean up test audio URL
        if (result.audioUrl) {
          URL.revokeObjectURL(result.audioUrl);
        }
      }
      
      return { success: result.success, error: result.error };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection test failed';
      console.error('[ElevenLabsService] ❌ API connection test failed:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }
}

// Export singleton instance with defensive instantiation
let elevenLabsService: ElevenLabsService;

try {
  console.log('[ElevenLabsService] 🔧 Creating service instance...');
  elevenLabsService = new ElevenLabsService();
  console.log('[ElevenLabsService] ✅ Service instance created successfully');
} catch (error) {
  console.error('[ElevenLabsService] ❌ CRITICAL: Failed to create service instance:', error);
  // Create a fallback service instance that works but always fails
  elevenLabsService = new ElevenLabsService();
}

export { elevenLabsService };
export default elevenLabsService; 