// Whisper Speech Recognition Optimization Utilities
// Advanced tips and configurations for better accuracy

export interface WhisperOptimizationSettings {
  // Audio Quality Settings
  enableAudioProcessing: boolean;
  boostQuietSpeech: boolean;
  normalizeVolume: boolean;
  
  // Recording Settings
  minRecordingDuration: number; // milliseconds
  maxRecordingDuration: number; // milliseconds
  
  // Whisper API Settings
  useVerboseResponse: boolean;
  useContextPrompt: boolean;
  customPrompt?: string;
  lowTemperature: boolean;
}

export const DEFAULT_OPTIMIZATION_SETTINGS: WhisperOptimizationSettings = {
  enableAudioProcessing: true,
  boostQuietSpeech: true,
  normalizeVolume: true,
  minRecordingDuration: 1000, // 1 second minimum
  maxRecordingDuration: 30000, // 30 seconds maximum
  useVerboseResponse: true,
  useContextPrompt: true,
  lowTemperature: true,
};

export const WHISPER_ACCURACY_TIPS = {
  // Environmental Tips
  environment: [
    "🔇 Record in a quiet environment without background noise",
    "🎧 Use a good quality microphone or headset if available",
    "🚪 Close windows and doors to reduce ambient noise",
    "📱 Turn off notifications during recording",
    "🌬️ Avoid air conditioning/fan noise in the background",
  ],
  
  // Speaking Tips
  speaking: [
    "🗣️ Speak clearly and at a moderate pace",
    "📏 Maintain consistent distance from microphone (6-12 inches)",
    "🔊 Use normal speaking volume - not too quiet, not too loud",
    "⏱️ Pause briefly between sentences",
    "🗣️ Avoid filler words like 'um', 'uh', 'like'",
    "🎯 Be specific and direct with your requests",
  ],
  
  // Technical Tips
  technical: [
    "⏰ Record for at least 2-3 seconds for better context",
    "🔄 Try recording again if the first attempt was unclear",
    "📊 Check your microphone levels before recording",
    "🌐 Ensure stable internet connection",
    "🔋 Use a device with good performance (not overloaded)",
  ],
  
  // Content Tips
  content: [
    "🎯 Use complete sentences instead of single words",
    "📝 State your request clearly: 'Tell me about the weather' instead of 'weather'",
    "🔄 Rephrase if the transcription seems wrong",
    "🎮 Use game-specific terms the AI might recognize",
    "❓ Ask questions in a natural, conversational way",
  ],
};

export const COMMON_TRANSCRIPTION_FIXES = {
  // Common misinterpretations and their fixes
  patterns: [
    {
      problem: "Short recordings get misinterpreted",
      solution: "Record for at least 2-3 seconds, use complete sentences",
      example: "Instead of 'weather' → 'Can you tell me about the weather?'"
    },
    {
      problem: "Background noise causes errors",
      solution: "Find a quieter environment or use push-to-talk more carefully",
      example: "Turn off fans, close doors, mute other apps"
    },
    {
      problem: "Speaking too fast or slurring words",
      solution: "Speak more slowly and enunciate clearly",
      example: "Pace yourself like you're talking to someone learning English"
    },
    {
      problem: "Microphone levels too low/high",
      solution: "Check your system audio settings",
      example: "Adjust microphone boost in Windows/Mac audio settings"
    },
    {
      problem: "Words get completely wrong interpretation",
      solution: "Use context and complete phrases",
      example: "'Tell me about the current weather conditions' vs 'weather'"
    },
  ]
};

export function getOptimizedPromptForContext(context: 'weather' | 'game' | 'general'): string {
  const prompts = {
    weather: "The following is a clear request about weather conditions, temperature, or climate information. The speaker is asking for current weather updates.",
    game: "The following is a clear request about game status, inventory, player actions, or game mechanics. The speaker is giving commands or asking questions about the game.",
    general: "The following is a clear speech with a specific question or request. The speaker is asking for information or giving a command.",
  };
  
  return prompts[context] || prompts.general;
}

export function validateRecordingQuality(audioBlob: Blob, settings: WhisperOptimizationSettings): {
  isValid: boolean;
  warnings: string[];
  suggestions: string[];
} {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  
  // Check audio size (rough duration estimation)
  const estimatedDurationMs = (audioBlob.size / 1024) * 100; // Very rough estimation
  
  if (estimatedDurationMs < settings.minRecordingDuration) {
    warnings.push(`Recording seems too short (${estimatedDurationMs.toFixed(0)}ms). Minimum recommended: ${settings.minRecordingDuration}ms`);
    suggestions.push("Try recording for a longer duration with complete sentences");
  }
  
  if (estimatedDurationMs > settings.maxRecordingDuration) {
    warnings.push(`Recording seems too long (${estimatedDurationMs.toFixed(0)}ms). Maximum recommended: ${settings.maxRecordingDuration}ms`);
    suggestions.push("Try shorter, more focused requests");
  }
  
  if (audioBlob.size < 1000) {
    warnings.push("Audio file is very small - may indicate poor recording quality");
    suggestions.push("Check microphone permissions and speak louder");
  }
  
  return {
    isValid: warnings.length === 0,
    warnings,
    suggestions,
  };
}

export function logRecordingQualityTips() {
  console.group("🎙️ Whisper Recording Quality Tips");
  
  console.group("🌍 Environment");
  WHISPER_ACCURACY_TIPS.environment.forEach(tip => console.log(tip));
  console.groupEnd();
  
  console.group("🗣️ Speaking");
  WHISPER_ACCURACY_TIPS.speaking.forEach(tip => console.log(tip));
  console.groupEnd();
  
  console.group("⚙️ Technical");
  WHISPER_ACCURACY_TIPS.technical.forEach(tip => console.log(tip));
  console.groupEnd();
  
  console.group("💬 Content");
  WHISPER_ACCURACY_TIPS.content.forEach(tip => console.log(tip));
  console.groupEnd();
  
  console.groupEnd();
} 