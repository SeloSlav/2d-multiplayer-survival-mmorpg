import React, { useState } from 'react';

interface StatusEffect {
  id: string;
  name: string;
  emoji: string;
  duration?: number;
  type: 'positive' | 'negative' | 'neutral';
  description?: string;
}

interface StatusEffectsPanelProps {
  effects: StatusEffect[];
}

const StatusEffectsPanel: React.FC<StatusEffectsPanelProps> = ({ effects }) => {
  const [hoveredEffect, setHoveredEffect] = useState<string | null>(null);

  if (effects.length === 0) return null;

  const getEffectColor = (type: string) => {
    switch (type) {
      case 'positive': return '#00ff88';
      case 'negative': return '#ff4444';
      default: return '#ffaa00';
    }
  };

  const getEffectGlow = (type: string) => {
    switch (type) {
      case 'positive': return '0 0 8px rgba(0, 255, 136, 0.6)';
      case 'negative': return '0 0 8px rgba(255, 68, 68, 0.6)';
      default: return '0 0 8px rgba(255, 170, 0, 0.6)';
    }
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: '140px', // Position above status bars
      right: '15px',
      fontFamily: 'Courier New, Consolas, Monaco, monospace',
      fontSize: '11px',
      color: '#ffffff',
      textShadow: '1px 1px 2px rgba(0, 0, 0, 0.8)',
      backgroundColor: 'rgba(139, 69, 69, 0.9)', // Matte red background
      padding: '8px 12px',
      borderRadius: '6px',
      border: '2px solid rgba(180, 50, 50, 0.8)',
      backdropFilter: 'blur(3px)',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
      zIndex: 55, // Above status bars (50) but below other UI
    }}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap'
      }}>
        {effects.map((effect, index) => (
          <div
            key={effect.id}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer'
            }}
            onMouseEnter={() => setHoveredEffect(effect.id)}
            onMouseLeave={() => setHoveredEffect(null)}
          >
            {/* Cyberpunk Tooltip */}
            {hoveredEffect === effect.id && (
              <div style={{
                position: 'absolute',
                right: '100%',
                top: '50%',
                transform: 'translateY(-50%)',
                marginRight: '12px',
                background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.98), rgba(20, 10, 40, 0.98))',
                border: `2px solid ${getEffectColor(effect.type)}`,
                borderRadius: '8px',
                padding: '12px 16px',
                minWidth: '200px',
                maxWidth: '300px',
                boxShadow: `0 0 25px ${getEffectColor(effect.type)}40, inset 0 0 15px ${getEffectColor(effect.type)}20`,
                backdropFilter: 'blur(10px)',
                zIndex: 100,
                fontFamily: 'Courier New, Consolas, Monaco, monospace',
                animation: 'tooltipFadeIn 0.2s ease-out',
                whiteSpace: 'normal',
                wordWrap: 'break-word'
              }}>
                {/* Tooltip Header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '8px'
                }}>
                  <span style={{ 
                    fontSize: '18px',
                    filter: `drop-shadow(0 0 4px ${getEffectColor(effect.type)})`
                  }}>
                    {effect.emoji}
                  </span>
                  <span style={{
                    color: getEffectColor(effect.type),
                    fontSize: '14px',
                    fontWeight: 'bold',
                    textShadow: `0 0 8px ${getEffectColor(effect.type)}80`,
                    letterSpacing: '1px'
                  }}>
                    {effect.name.toUpperCase()}
                  </span>
                </div>
                
                {/* Tooltip Description */}
                <div style={{
                  color: '#e0e0e0',
                  fontSize: '11px',
                  lineHeight: '1.4',
                  marginBottom: '8px',
                  opacity: 0.9
                }}>
                  {effect.description}
                </div>
                
                {/* Duration Info */}
                {effect.duration !== undefined && effect.duration > 0 && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '10px',
                    color: '#00ddff',
                    textShadow: '0 0 4px rgba(0, 221, 255, 0.6)'
                  }}>
                    <span>⏱</span>
                    <span>
                      {effect.id === 'wet' 
                        ? (() => {
                            const percentage = (effect.duration / 60) * 100;
                            // If very close to 100% (within 1%), just show 100%
                            const displayPercentage = percentage >= 99 ? 100 : Math.round(percentage);
                            return `${displayPercentage}% wetness remaining`;
                          })()
                        : `${Math.ceil(effect.duration)}s remaining`
                      }
                    </span>
                  </div>
                )}
                
                {/* Tooltip Arrow */}
                <div style={{
                  position: 'absolute',
                  left: '100%',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 0,
                  height: 0,
                  borderTop: '8px solid transparent',
                  borderBottom: '8px solid transparent',
                  borderLeft: `8px solid ${getEffectColor(effect.type)}`
                }} />
              </div>
            )}
            
            {/* Effect Icon */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '24px',
              height: '24px',
              fontSize: '16px',
              border: `2px solid ${getEffectColor(effect.type)}`,
              borderRadius: '6px',
              backgroundColor: 'rgba(0, 0, 0, 0.4)',
              boxShadow: getEffectGlow(effect.type),
              transition: 'all 0.2s ease',
              transform: hoveredEffect === effect.id ? 'scale(1.1)' : 'scale(1)'
            }}>
              {effect.emoji}
            </div>
            
            {/* Duration Text */}
            {effect.duration !== undefined && effect.duration > 0 && (
              <span style={{ 
                fontSize: '10px',
                color: '#ffffff',
                fontWeight: 'bold',
                textShadow: '1px 1px 2px rgba(0, 0, 0, 0.8)',
                minWidth: '25px'
              }}>
                {effect.id === 'wet' 
                  ? (() => {
                      const percentage = (effect.duration / 60) * 100;
                      // If very close to 100% (within 1%), just show 100%
                      return percentage >= 99 ? '100%' : `${Math.round(percentage)}%`;
                    })()
                  : `${Math.ceil(effect.duration)}s`
                }
              </span>
            )}
          </div>
        ))}
      </div>
      
      {/* CSS Animation */}
      <style>{`
        @keyframes tooltipFadeIn {
          0% { 
            opacity: 0; 
            transform: translateY(-50%) translateX(10px); 
          }
          100% { 
            opacity: 1; 
            transform: translateY(-50%) translateX(0); 
          }
        }
      `}</style>
    </div>
  );
};

export default StatusEffectsPanel; 