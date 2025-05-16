import React from 'react';

export interface StatusBarProps {
  label: string;
  icon: string; // Placeholder for icon, e.g., emoji or text
  value: number;
  maxValue: number;
  barColor: string;
  glow?: boolean; // If true, show glow/pulse effect
  hasActiveEffect?: boolean; // For healing/regen effects
  hasBleedEffect?: boolean; // For bleed effect
  pendingHealAmount?: number; // ADDED: Potential heal from effects like BandageBurst
}

const StatusBar: React.FC<StatusBarProps> = ({ 
  label, 
  icon, 
  value, 
  maxValue, 
  barColor, 
  glow, 
  hasActiveEffect, 
  hasBleedEffect, 
  pendingHealAmount = 0 // Default to 0 if not provided
}) => {
  const percentage = Math.max(0, Math.min(100, (value / maxValue) * 100));
  const pendingHealPercentage = Math.max(0, Math.min(100, ((value + pendingHealAmount) / maxValue) * 100));

  React.useEffect(() => {
    // Glow Pulse Keyframes
    if (glow && !document.getElementById('status-bar-glow-keyframes')) {
      const style = document.createElement('style');
      style.id = 'status-bar-glow-keyframes';
      style.innerHTML = `
        @keyframes statusBarGlowPulse {
          0% { box-shadow: 0 0 8px 2px rgba(255,255,255,0.25), 0 0 0 0 ${barColor}; transform: scale(1); }
          50% { box-shadow: 0 0 16px 6px ${barColor}, 0 0 0 0 ${barColor}; transform: scale(1.04); }
          100% { box-shadow: 0 0 8px 2px rgba(255,255,255,0.25), 0 0 0 0 ${barColor}; transform: scale(1); }
        }
      `;
      document.head.appendChild(style);
    }
    
    // Regen/Healing Animation Keyframes
    if (hasActiveEffect && !document.getElementById('status-bar-regen-keyframes')) {
        const style = document.createElement('style');
        style.id = 'status-bar-regen-keyframes';
        style.innerHTML = `
          @keyframes statusBarRegenAnimation {
            0% { background-position: 0 0; }
            100% { background-position: 20px 0; }
          }
        `;
        document.head.appendChild(style);
    }

    // Bleed Animation Keyframes
    if (hasBleedEffect && !document.getElementById('status-bar-bleed-keyframes')) {
        const style = document.createElement('style');
        style.id = 'status-bar-bleed-keyframes';
        style.innerHTML = `
          @keyframes statusBarBleedAnimation {
            0% { background-position: 0 0; }
            100% { background-position: -20px 0; } /* Moves left */
          }
        `;
        document.head.appendChild(style);
    }
  }, [glow, barColor, hasActiveEffect, hasBleedEffect]);

  const filledBarStyle: React.CSSProperties = {
    height: '100%',
    width: `${percentage}%`,
    backgroundColor: barColor,
    transition: 'box-shadow 0.2s, transform 0.2s, width 0.3s ease-in-out',
    boxShadow: glow ? `0 0 16px 6px ${barColor}` : undefined,
    animation: glow ? 'statusBarGlowPulse 1.2s infinite' : undefined,
    zIndex: 1,
    position: 'relative', 
    overflow: 'hidden', 
  };

  const pendingHealBarStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: `${percentage}%`, // Start drawing from the end of the current health
    height: '100%',
    width: `${Math.max(0, pendingHealPercentage - percentage)}%`, // Only draw the difference
    backgroundColor: 'rgba(255, 130, 130, 0.5)', // Lighter shade of red (or barColor with transparency)
    zIndex: 0, // Behind the main filled bar, but above the background
    transition: 'width 0.3s ease-in-out, left 0.3s ease-in-out',
  };

  let activeEffectOverlayStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    zIndex: 2, // Ensure overlay is on top of the base filled bar
  };

  if (hasActiveEffect) { // Healing effect - original red, moves right
    activeEffectOverlayStyle = {
      ...activeEffectOverlayStyle,
      backgroundImage: `repeating-linear-gradient(
        -45deg, 
        rgba(255, 100, 100, 0.7), /* Lighter semi-transparent red */
        rgba(255, 100, 100, 0.7) 10px,
        rgba(180, 50, 50, 0.7) 10px,  /* Darker semi-transparent red */
        rgba(180, 50, 50, 0.7) 20px
      )`,
      animation: 'statusBarRegenAnimation 0.8s linear infinite',
    };
  } else if (hasBleedEffect) { // Bleed effect - darker red, reflected, moves left
    activeEffectOverlayStyle = {
      ...activeEffectOverlayStyle,
      backgroundImage: `repeating-linear-gradient(
        45deg, /* Reflected angle */
        rgba(180, 0, 0, 0.7), /* Darker red */
        rgba(180, 0, 0, 0.7) 10px,
        rgba(130, 0, 0, 0.7) 10px, /* Even darker red */
        rgba(130, 0, 0, 0.7) 20px
      )`,
      animation: 'statusBarBleedAnimation 0.8s linear infinite',
    };
  }

  return (
    <div style={{ marginBottom: '4px', display: 'flex', alignItems: 'center' }}>
      <span style={{ marginRight: '5px', minWidth: '18px', textAlign: 'center', fontSize: '14px' }}>{icon}</span>
      <div style={{ flexGrow: 1 }}>
        <div style={{
          height: '8px',
          backgroundColor: '#555',
          borderRadius: '2px',
          overflow: 'hidden',
          border: '1px solid #333',
          position: 'relative', 
        }}>
          <div style={filledBarStyle}>
            {(hasActiveEffect || hasBleedEffect) && <div style={activeEffectOverlayStyle}></div>}
          </div>
          {label === "HP" && pendingHealAmount > 0 && (
            <div style={pendingHealBarStyle}></div>
          )}
        </div>
      </div>
      <span style={{ marginLeft: '5px', fontSize: '10px', minWidth: '30px', textAlign: 'right' }}>
        {value.toFixed(0)}
      </span>
    </div>
  );
};

export default StatusBar; 