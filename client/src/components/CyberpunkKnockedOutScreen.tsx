import React, { useEffect, useState } from 'react';
import { KnockedOutStatus } from '../generated';
import sovaIcon from '../assets/ui/sova.png';
import './CyberpunkKnockedOutScreen.css';

interface CyberpunkKnockedOutScreenProps {
  knockedOutStatus: KnockedOutStatus | null;
}

const CyberpunkKnockedOutScreen: React.FC<CyberpunkKnockedOutScreenProps> = ({
  knockedOutStatus
}) => {
  const [animationPhase, setAnimationPhase] = useState(0);
  const [glitchText, setGlitchText] = useState('NEURAL LINK COMPROMISED');

  // Cycle through different status messages with glitch effect
  useEffect(() => {
    const messages = [
      'NEURAL LINK COMPROMISED',
      'CONSCIOUSNESS FADING',
      'SOVA ATTEMPTING RECOVERY',
      'BIOMETRIC ANALYSIS ACTIVE',
      'SURVIVAL PROTOCOLS ENGAGED'
    ];

    const interval = setInterval(() => {
      setAnimationPhase(prev => (prev + 1) % messages.length);
      setGlitchText(messages[animationPhase]);
    }, 2000);

    return () => clearInterval(interval);
  }, [animationPhase]);

  if (!knockedOutStatus) {
    return (
      <div className="cyberpunk-knocked-out-screen">
        <div className="neural-grid-background"></div>
        <div className="status-container">
          <div className="sova-avatar-container">
            <img src={sovaIcon} alt="SOVA" className="sova-avatar pulsing" />
            <div className="avatar-glow"></div>
          </div>
          <div className="status-header">
            <div className="glitch-text">{glitchText}</div>
            <div className="status-subtitle">Analyzing biometric data...</div>
          </div>
        </div>
      </div>
    );
  }

  const recoveryChance = knockedOutStatus.currentRecoveryChancePercent;
  const deathChance = knockedOutStatus.currentDeathChancePercent;
  const safeTime = knockedOutStatus.timeUntilDeathRiskStartsSecs;
  const survivalFactor = knockedOutStatus.statMultiplier;

  // Calculate overall survival probability for visual effects
  const survivalProbability = Math.max(0, Math.min(100, recoveryChance + (100 - deathChance)));
  const criticalState = deathChance > 50;
  const warningState = deathChance > 25 && deathChance <= 50;

  return (
    <div className={`cyberpunk-knocked-out-screen ${criticalState ? 'critical' : warningState ? 'warning' : 'stable'}`}>
      {/* Independent SOVA Icon at top center */}
      <div className="independent-sova-container">
        <img 
          src={sovaIcon} 
          alt="SOVA" 
          className={`independent-sova ${criticalState ? 'critical-pulse' : 'analyzing'}`} 
        />
      </div>

      {/* Animated grid background */}
      <div className="neural-grid-background"></div>
      
      {/* Scan lines effect */}
      <div className="scan-lines"></div>
      
      {/* Main status container */}
      <div className="status-container">
        {/* SOVA Avatar */}
        <div className="sova-avatar-container">
          <img 
            src={sovaIcon} 
            alt="SOVA" 
            className={`sova-avatar ${criticalState ? 'critical-pulse' : 'analyzing'}`} 
          />
          <div className="avatar-glow"></div>
          <div className="neural-connection-lines"></div>
        </div>

        {/* Status Header */}
        <div className="status-header">
          <div className="glitch-text">{glitchText}</div>
          <div className="status-subtitle">
            {criticalState ? 'CRITICAL CONDITION DETECTED' : 
             warningState ? 'UNSTABLE NEURAL PATTERNS' : 
             'MONITORING VITAL SIGNS'}
          </div>
        </div>

        {/* Biometric Display */}
        <div className="biometric-display">
          {/* Recovery Probability */}
          <div className="metric-row">
            <div className="metric-label">
              <span className="metric-icon">🧬</span>
              RECOVERY PROBABILITY
            </div>
            <div className="metric-value recovery">
              <div className="progress-bar">
                <div 
                  className="progress-fill recovery-fill" 
                  style={{ width: `${recoveryChance}%` }}
                ></div>
              </div>
              <span className="percentage">{recoveryChance.toFixed(1)}%</span>
            </div>
          </div>

          {/* Death Risk */}
          <div className="metric-row">
            <div className="metric-label">
              <span className="metric-icon">⚠️</span>
              NEURAL DECAY RISK
            </div>
            <div className="metric-value death-risk">
              <div className="progress-bar">
                <div 
                  className="progress-fill death-fill" 
                  style={{ width: `${deathChance}%` }}
                ></div>
              </div>
              <span className="percentage">{deathChance.toFixed(1)}%</span>
            </div>
          </div>

          {/* Safe Time (if applicable) */}
          {safeTime > 0 && (
            <div className="metric-row">
              <div className="metric-label">
                <span className="metric-icon">⏱️</span>
                STABILIZATION WINDOW
              </div>
              <div className="metric-value safe-time">
                <span className="time-value">{Math.ceil(safeTime)}s</span>
              </div>
            </div>
          )}

          {/* Survival Factor */}
          <div className="metric-row">
            <div className="metric-label">
              <span className="metric-icon">🛡️</span>
              BIOMETRIC ENHANCEMENT
            </div>
            <div className="metric-value survival-factor">
              <span className="multiplier">{survivalFactor.toFixed(2)}x</span>
              <div className="factor-breakdown">
                (Nutrition • Hydration • Stamina • Thermal • Armor)
              </div>
            </div>
          </div>
        </div>

        {/* Status Messages */}
        <div className="status-messages">
          <div className="message-line primary">
            <span className="message-icon">🔗</span>
            NEURAL LINK PARTNER CAN INITIATE REVIVAL PROTOCOL
          </div>
          <div className="message-line secondary">
            <span className="message-icon">📊</span>
            ENHANCED BIOMETRICS IMPROVE SURVIVAL PROBABILITY
          </div>
          {criticalState && (
            <div className="message-line critical">
              <span className="message-icon">🚨</span>
              WARNING: NEURAL PATTERN DEGRADATION ACCELERATING
            </div>
          )}
        </div>

        {/* Data Stream Effect */}
        <div className="data-stream">
          <div className="stream-line">01001000 01100101 01100001 01101100 01110100 01101000</div>
          <div className="stream-line">01010011 01001111 01010110 01000001 01011111 01010010 01100101 01100011</div>
          <div className="stream-line">01001110 01100101 01110101 01110010 01100001 01101100 01001100 01101001</div>
        </div>
      </div>

      {/* Corner UI Elements */}
      <div className="corner-ui top-left">
        <div className="ui-line"></div>
        <div className="ui-text">SOVA.SYS</div>
      </div>
      <div className="corner-ui top-right">
        <div className="ui-text">NEURAL.LINK</div>
        <div className="ui-line"></div>
      </div>
      <div className="corner-ui bottom-left">
        <div className="ui-line"></div>
        <div className="ui-text">BIOMETRIC.MON</div>
      </div>
      <div className="corner-ui bottom-right">
        <div className="ui-text">RECOVERY.PROTO</div>
        <div className="ui-line"></div>
      </div>
    </div>
  );
};

export default CyberpunkKnockedOutScreen; 