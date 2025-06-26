import React from 'react';
import './SOVALoadingBar.css';

interface SOVALoadingBarProps {
  isRecording: boolean;
  isTranscribing: boolean;
  isGeneratingResponse: boolean;
  isSynthesizingVoice: boolean;
  isPlayingAudio: boolean;
  currentPhase: string;
}

const SOVALoadingBar: React.FC<SOVALoadingBarProps> = ({
  isRecording,
  isTranscribing,
  isGeneratingResponse,
  isSynthesizingVoice,
  isPlayingAudio,
  currentPhase,
}) => {
  // Don't render if nothing is happening
  const isActive = isRecording || isTranscribing || isGeneratingResponse || isSynthesizingVoice || isPlayingAudio;
  if (!isActive) return null;

  // Calculate progress based on current phase
  const getProgress = () => {
    if (isRecording) return 20;
    if (isTranscribing) return 40;
    if (isGeneratingResponse) return 60;
    if (isSynthesizingVoice) return 80;
    if (isPlayingAudio) return 100;
    return 0;
  };

  const progress = getProgress();
  const isProcessing = !isRecording; // Show processing animation for everything except recording

  return (
    <div className="sova-loading-bar-container">
      {/* Main loading bar */}
      <div className="sova-loading-bar">
        {/* Background track */}
        <div className="sova-loading-track" />
        
        {/* Progress fill */}
        <div 
          className={`sova-loading-fill ${isProcessing ? 'processing' : 'recording'}`}
          style={{ width: `${progress}%` }}
        />
        
        {/* Animated scan line */}
        <div className={`sova-loading-scanner ${isProcessing ? 'active' : ''}`} />
        
        {/* Phase indicators */}
        <div className="sova-loading-phases">
          <div className={`sova-phase-dot ${progress >= 20 ? 'active' : ''}`} />
          <div className={`sova-phase-dot ${progress >= 40 ? 'active' : ''}`} />
          <div className={`sova-phase-dot ${progress >= 60 ? 'active' : ''}`} />
          <div className={`sova-phase-dot ${progress >= 80 ? 'active' : ''}`} />
          <div className={`sova-phase-dot ${progress >= 100 ? 'active' : ''}`} />
        </div>
      </div>
      
      {/* Status text */}
      <div className="sova-loading-status">
        <span className="sova-status-label">SOVA</span>
        <span className="sova-status-phase">{currentPhase}</span>
      </div>
      

    </div>
  );
};

export default SOVALoadingBar; 