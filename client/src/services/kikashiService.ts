// Kikashi API Service for SOVA Voice Synthesis
// Documentation: https://www.kikashi.io/#documentation

import { openaiService, type SOVAPromptRequest } from './openaiService';

const SOVA_VOICE = 'robot2';

// Proxy server configuration
const PROXY_URL = import.meta.env.VITE_PROXY_URL || 'https://profound-bravery-production-9042.up.railway.app';
const TTS_ENDPOINT = `${PROXY_URL}/api/tts`;

export interface KikashiResponse {
  success: boolean;
  audioUrl?: string;
  error?: string;
  timing?: KikashiTiming;
}

export interface VoiceSynthesisRequest {
  text: string;
  voiceStyle?: string;
}

export interface KikashiTiming {
  requestStartTime: number;
  proxyResponseTime: number;
  kikashiResponseTime: number;
  audioProcessedTime: number;
  totalLatencyMs: number;
  proxyLatencyMs: number;
  kikashiApiLatencyMs: number;
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

export interface KikashiPerformanceReport {
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
  recentTimings: KikashiTiming[];
  generatedAt: string;
}

class KikashiService {
  private performanceData: KikashiTiming[] = [];
  private maxStoredTimings = 100; // Keep last 100 requests for analysis

  constructor() {
    // No API key needed since we're using local proxy
  }

  /**
   * Convert text to speech using Kikashi API with comprehensive timing
   */
  async synthesizeVoice(request: VoiceSynthesisRequest): Promise<KikashiResponse> {
    const timing: Partial<KikashiTiming> = {
      requestStartTime: performance.now(),
      textLength: request.text.length,
      voiceStyle: request.voiceStyle || SOVA_VOICE,
      timestamp: new Date().toISOString(),
    };

    console.log(`[KikashiService] 🎤 Starting TTS request - Text: "${request.text.substring(0, 50)}${request.text.length > 50 ? '...' : ''}" (${request.text.length} chars)`);

    try {
      const requestBody = {
        text: request.text,
        voiceStyle: request.voiceStyle || SOVA_VOICE,
      };
      
      console.log('[KikashiService] Making request to proxy:', TTS_ENDPOINT);
      
      const response = await fetch(TTS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      timing.proxyResponseTime = performance.now();
      timing.proxyLatencyMs = timing.proxyResponseTime - timing.requestStartTime!;

      console.log(`[KikashiService] ⚡ Proxy response received in ${timing.proxyLatencyMs.toFixed(2)}ms`);
      console.log('[KikashiService] Response status:', response.status);

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

      // Process audio response
      const audioBlob = await response.blob();
      timing.kikashiResponseTime = performance.now();
      timing.audioProcessedTime = performance.now();
      timing.kikashiApiLatencyMs = timing.kikashiResponseTime - timing.proxyResponseTime!;
      timing.audioProcessingMs = timing.audioProcessedTime - timing.kikashiResponseTime!;
      timing.totalLatencyMs = timing.audioProcessedTime - timing.requestStartTime!;
      timing.audioSizeBytes = audioBlob.size;

      console.log(`[KikashiService] 🎵 Audio processed in ${timing.audioProcessingMs.toFixed(2)}ms`);
      console.log(`[KikashiService] 📊 Total latency: ${timing.totalLatencyMs.toFixed(2)}ms`);
      console.log(`[KikashiService] 🌐 Proxy latency: ${timing.proxyLatencyMs.toFixed(2)}ms`);
      console.log(`[KikashiService] 🎤 Kikashi API latency: ${timing.kikashiApiLatencyMs.toFixed(2)}ms`);
      console.log(`[KikashiService] 📁 Audio size: ${(timing.audioSizeBytes / 1024).toFixed(2)} KB`);
      console.log(`[KikashiService] 🚀 Throughput: ${(timing.textLength! / (timing.totalLatencyMs / 1000)).toFixed(2)} chars/sec`);
      
      // Check if we actually got audio data
      if (audioBlob.size === 0) {
        throw new Error('Received empty audio response');
      }
      
      // Check if the content type is actually audio
      const contentType = audioBlob.type || response.headers.get('content-type') || '';
      
      if (!contentType.includes('audio') && !contentType.includes('mpeg') && !contentType.includes('mp3')) {
        // Let's see what we actually got
        const text = await audioBlob.text();
        console.log('[KikashiService] Non-audio response received:', text.substring(0, 500));
        throw new Error(`Expected audio but got: ${contentType}. Response: ${text.substring(0, 100)}`);
      }
      
      const audioUrl = URL.createObjectURL(audioBlob);

      // Store performance data
      this.recordTiming(timing as KikashiTiming);
      
      return {
        success: true,
        audioUrl: audioUrl,
        timing: timing as KikashiTiming,
      };
    } catch (error) {
      // Record failed timing
      const failedTiming = {
        ...timing,
        proxyResponseTime: timing.proxyResponseTime || performance.now(),
        kikashiResponseTime: timing.kikashiResponseTime || performance.now(),
        audioProcessedTime: performance.now(),
        totalLatencyMs: performance.now() - timing.requestStartTime!,
        proxyLatencyMs: (timing.proxyResponseTime || performance.now()) - timing.requestStartTime!,
        kikashiApiLatencyMs: 0,
        audioProcessingMs: 0,
        audioSizeBytes: 0,
      } as KikashiTiming;

      this.recordTiming(failedTiming, false);

      console.error('[KikashiService] Voice synthesis failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        timing: failedTiming,
      };
    }
  }

  /**
   * Record timing data for performance analysis
   */
  private recordTiming(timing: KikashiTiming, success: boolean = true) {
    this.performanceData.push(timing);
    
    // Keep only the most recent timings
    if (this.performanceData.length > this.maxStoredTimings) {
      this.performanceData = this.performanceData.slice(-this.maxStoredTimings);
    }

    // Log summary for each request
    console.log(`[KikashiService] 📈 REQUEST SUMMARY:`, {
      success,
      text: `"${timing.textLength} chars"`,
      latency: `${timing.totalLatencyMs.toFixed(2)}ms`,
      network: `${timing.proxyLatencyMs.toFixed(2)}ms`,
      processing: `${timing.audioProcessingMs.toFixed(2)}ms`,
      audioSize: `${(timing.audioSizeBytes / 1024).toFixed(2)}KB`,
      throughput: `${(timing.textLength / (timing.totalLatencyMs / 1000)).toFixed(2)} chars/sec`
    });
  }

  /**
   * Generate comprehensive performance report for Kikashi API
   */
  generatePerformanceReport(): KikashiPerformanceReport {
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

    const successfulRequests = this.performanceData.filter(t => t.audioSizeBytes > 0);
    const failedRequests = this.performanceData.filter(t => t.audioSizeBytes === 0);
    
    const latencies = this.performanceData.map(t => t.totalLatencyMs);
    const textLengths = this.performanceData.map(t => t.textLength);
    const audioSizes = successfulRequests.map(t => t.audioSizeBytes);
    const throughputs = successfulRequests.map(t => t.textLength / (t.totalLatencyMs / 1000));

    // Calculate statistics
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    const medianLatency = sortedLatencies[Math.floor(sortedLatencies.length / 2)];
    const minLatency = Math.min(...latencies);
    const maxLatency = Math.max(...latencies);

    const avgTextLength = textLengths.reduce((a, b) => a + b, 0) / textLengths.length;
    const avgAudioSize = audioSizes.length > 0 ? audioSizes.reduce((a, b) => a + b, 0) / audioSizes.length : 0;
    const avgThroughput = throughputs.length > 0 ? throughputs.reduce((a, b) => a + b, 0) / throughputs.length : 0;

    return {
      totalRequests: this.performanceData.length,
      successfulRequests: successfulRequests.length,
      failedRequests: failedRequests.length,
      averageLatencyMs: avgLatency,
      medianLatencyMs: medianLatency,
      minLatencyMs: minLatency,
      maxLatencyMs: maxLatency,
      averageTextLength: avgTextLength,
      averageAudioSizeKB: avgAudioSize / 1024,
      averageThroughputCharsPerSecond: avgThroughput,
      recentTimings: this.performanceData.slice(-10), // Last 10 requests
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Generate a formatted report string for sharing
   */
  generateFormattedReport(): string {
    const report = this.generatePerformanceReport();
    const recentTimings = this.performanceData.slice(-10); // Last 10 requests for pipeline analysis
    
    // Calculate pipeline averages from recent requests
    const pipelineData = recentTimings.filter(t => t.whisperLatencyMs && t.openaiLatencyMs);
    const avgWhisper = pipelineData.length > 0 ? pipelineData.reduce((sum, t) => sum + (t.whisperLatencyMs || 0), 0) / pipelineData.length : 0;
    const avgOpenAI = pipelineData.length > 0 ? pipelineData.reduce((sum, t) => sum + (t.openaiLatencyMs || 0), 0) / pipelineData.length : 0;
    const avgProxy = this.performanceData.length > 0 ? this.performanceData.reduce((sum, t) => sum + t.proxyLatencyMs, 0) / this.performanceData.length : 0;
    const avgKikashi = this.performanceData.length > 0 ? this.performanceData.reduce((sum, t) => sum + t.kikashiApiLatencyMs, 0) / this.performanceData.length : 0;
    const avgTotalPipeline = pipelineData.length > 0 ? pipelineData.reduce((sum, t) => sum + (t.totalPipelineMs || 0), 0) / pipelineData.length : 0;
    
    return `
🎤 COMPLETE VOICE PIPELINE PERFORMANCE REPORT
Generated: ${new Date(report.generatedAt).toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 OVERVIEW
├─ Total TTS Requests: ${report.totalRequests}
├─ Successful: ${report.successfulRequests} (${((report.successfulRequests / report.totalRequests) * 100).toFixed(1)}%)
├─ Failed: ${report.failedRequests} (${((report.failedRequests / report.totalRequests) * 100).toFixed(1)}%)
└─ Success Rate: ${((report.successfulRequests / report.totalRequests) * 100).toFixed(1)}%

🔄 COMPLETE PIPELINE BREAKDOWN (Average Latencies)
┌─ 🎙️  Whisper (OpenAI Speech-to-Text): ${avgWhisper.toFixed(1)}ms
├─ 🤖 OpenAI GPT (AI Response Generation): ${avgOpenAI.toFixed(1)}ms  
├─ 🌐 Proxy Server (Local Network): ${avgProxy.toFixed(1)}ms
├─ 🎤 Kikashi TTS API (Text-to-Speech): ${avgKikashi.toFixed(1)}ms
└─ 📊 Total Voice Pipeline: ${avgTotalPipeline.toFixed(1)}ms

⚡ KIKASHI API ISOLATED PERFORMANCE
├─ Average Latency: ${report.averageLatencyMs.toFixed(2)}ms
├─ Minimum Latency: ${report.minLatencyMs.toFixed(2)}ms
├─ Maximum Latency: ${report.maxLatencyMs.toFixed(2)}ms
├─ 95th Percentile: ${report.recentTimings[Math.floor(report.recentTimings.length * 0.95)].totalLatencyMs.toFixed(2)}ms
└─ Standard Deviation: ${Math.sqrt(report.recentTimings.reduce((sum, t) => Math.pow(t.totalLatencyMs - report.averageLatencyMs, 2), 0) / report.recentTimings.length).toFixed(2)}ms

🌐 NETWORK BREAKDOWN (Kikashi TTS Only)
├─ Proxy Communication: ${avgProxy.toFixed(2)}ms (${((avgProxy / avgTotalPipeline) * 100).toFixed(1)}%)
├─ Kikashi API Processing: ${avgKikashi.toFixed(2)}ms (${((avgKikashi / avgTotalPipeline) * 100).toFixed(1)}%)
└─ Audio Processing: ${report.recentTimings[0].audioProcessingMs.toFixed(2)}ms

📈 THROUGHPUT ANALYSIS
├─ Average Characters/Second: ${report.averageThroughputCharsPerSecond.toFixed(2)}
├─ Peak Characters/Second: ${report.recentTimings.reduce((max, t) => Math.max(max, t.textLength / (t.totalLatencyMs / 1000)), 0).toFixed(2)}
├─ Average Text Length: ${report.averageTextLength.toFixed(1)} chars
└─ Average Audio Size: ${(report.averageAudioSizeKB * 1024).toFixed(2)} KB

📋 RECENT PERFORMANCE (Last 10 Requests)
${recentTimings.map((timing, i) => `${String(i + 1).padStart(2)}) ${timing.timestamp.substring(11, 19)} | Total: ${timing.totalLatencyMs.toFixed(0)}ms | Kikashi: ${timing.kikashiApiLatencyMs.toFixed(0)}ms | Proxy: ${timing.proxyLatencyMs.toFixed(0)}ms`).join('\n')}

🔧 TECHNICAL DETAILS  
├─ Implementation: Kikashi API via Proxy Server
├─ Voice Model: ${SOVA_VOICE}
├─ Audio Format: MP3 (Blob)
├─ Client: Browser-based Web Application
└─ Measurement: performance.now() (high-resolution)

📝 ANALYSIS NOTES
├─ Kikashi API accounts for ${((avgKikashi / avgTotalPipeline) * 100).toFixed(1)}% of total pipeline latency
├─ OpenAI services (Whisper + GPT) account for ${(((avgWhisper + avgOpenAI) / avgTotalPipeline) * 100).toFixed(1)}% of total pipeline
├─ Proxy server adds minimal overhead (${((avgProxy / avgTotalPipeline) * 100).toFixed(1)}% of total pipeline)
└─ This data isolates Kikashi API performance from other service dependencies

Generated by: Vibe Survival Game Voice Interface
SDK Version: Custom Implementation
Report ID: ${Date.now().toString(36)}
`;
  }

  /**
   * Log current performance report to console
   */
  logPerformanceReport() {
    console.log(this.generateFormattedReport());
  }

  /**
   * Get raw performance data for external analysis
   */
  getRawPerformanceData(): KikashiTiming[] {
    return [...this.performanceData];
  }

  /**
   * Clear performance data
   */
  clearPerformanceData() {
    this.performanceData = [];
    console.log('[KikashiService] Performance data cleared');
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

  /**
   * Update the most recent timing record with pipeline data from other services
   */
  updatePipelineTiming(whisperLatencyMs: number, openaiLatencyMs: number) {
    if (this.performanceData.length > 0) {
      const lastTiming = this.performanceData[this.performanceData.length - 1];
      lastTiming.whisperLatencyMs = whisperLatencyMs;
      lastTiming.openaiLatencyMs = openaiLatencyMs;
      lastTiming.totalPipelineMs = whisperLatencyMs + openaiLatencyMs + lastTiming.totalLatencyMs;
      
      console.log(`[KikashiService] 📊 Pipeline timing updated:`, {
        whisper: `${whisperLatencyMs.toFixed(2)}ms`,
        openai: `${openaiLatencyMs.toFixed(2)}ms`,
        kikashi: `${lastTiming.totalLatencyMs.toFixed(2)}ms`,
        totalPipeline: `${lastTiming.totalPipelineMs.toFixed(2)}ms`
      });
    }
  }
}

// Export singleton instance
export const kikashiService = new KikashiService();
export default kikashiService; 