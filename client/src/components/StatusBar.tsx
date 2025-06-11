import React from 'react';

// Import status icons
import heartIcon from '../assets/ui/heart.png';
import staminaIcon from '../assets/ui/stamina.png';
import thirstIcon from '../assets/ui/thirst.png';
import hungerIcon from '../assets/ui/hunger.png';
import warmthIcon from '../assets/ui/warmth.png';

interface StatusBarProps {
  label: string;
  iconType?: 'heart' | 'stamina' | 'thirst' | 'hunger' | 'warmth';
  value: number;
  maxValue: number;
  barColor: string;
  pendingHealAmount?: number;
  glow?: boolean;
  hasActiveEffect?: boolean;
  hasBleedEffect?: boolean;
}

const StatusBar: React.FC<StatusBarProps> = ({ 
  label, 
  iconType,
  value, 
  maxValue, 
  barColor, 
  pendingHealAmount = 0,
  glow = false,
  hasActiveEffect = false,
  hasBleedEffect = false
}) => {
  const percentage = Math.max(0, Math.min(100, (value / maxValue) * 100));
  const pendingHealPercentage = Math.max(0, Math.min(100, ((value + pendingHealAmount) / maxValue) * 100));

  // Get the appropriate icon
  const getIcon = () => {
    switch (iconType) {
      case 'heart': return heartIcon;
      case 'stamina': return staminaIcon;
      case 'thirst': return thirstIcon;
      case 'hunger': return hungerIcon;
      case 'warmth': return warmthIcon;
      default: return null;
    }
  };

  // Get scan line color that matches the bar color theme
  const getScanLineColor = () => {
    // Match the scan line color to the bar color for themed effect
    return barColor;
  };

  const iconSrc = getIcon();
  const scanLineColor = getScanLineColor();

  React.useEffect(() => {
    // Glow Pulse Keyframes
    if (glow) {
      const sanitizedBarColorForId = barColor.replace(/[^a-zA-Z0-9]/g, '');
      const keyframeName = `statusBarGlowPulse_${sanitizedBarColorForId}`;
      const barColorWithAlpha = barColor.startsWith('#') ? `${barColor}AA` : barColor; // Add AA for ~66% alpha if hex

      if (!document.getElementById(keyframeName)) {
        const style = document.createElement('style');
        style.id = keyframeName;
        style.innerHTML = `
          @keyframes ${keyframeName} {
            0%   { box-shadow: 0 0 8px 2px ${barColorWithAlpha}, 0 0 0 0 ${barColorWithAlpha}; transform: scale(1); }
            50%  { box-shadow: 0 0 16px 6px ${barColor}, 0 0 0 0 ${barColor}; transform: scale(1.04); }
            100% { box-shadow: 0 0 8px 2px ${barColorWithAlpha}, 0 0 0 0 ${barColorWithAlpha}; transform: scale(1); }
          }
        `;
        document.head.appendChild(style);
      }
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
    animation: glow ? `statusBarGlowPulse_${barColor.replace(/[^a-zA-Z0-9]/g, '')} 1.2s infinite` : undefined,
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
    <div style={{
      display: 'flex',
      alignItems: 'center',
      marginBottom: '5px', // Reduced from 8px
      fontFamily: 'Courier New, Consolas, Monaco, monospace',
      fontSize: '10px',
      color: '#00ffff',
      textShadow: '0 0 4px rgba(0, 255, 255, 0.6)',
      height: '22px', // Reduced from 28px for more compact layout
    }}>
      {/* Icon */}
      {iconSrc && (
        <img 
          src={iconSrc} 
          alt={label}
          style={{
            width: '20px', // Increased from 18px for bigger icons
            height: '20px',
            marginRight: '8px', // Reduced spacing
            imageRendering: 'pixelated',
            // Removed glow effects as requested
          }}
        />
      )}
      
      {/* Bar Container */}
      <div style={{
        position: 'relative',
        flex: '1',
        height: '12px', // Reduced from 16px to be more compact
        backgroundColor: '#555',
        borderRadius: '2px', // Reduced radius
        overflow: 'hidden',
        border: '1px solid #333',
        marginRight: '8px', // Reduced spacing
      }}>
        <div style={filledBarStyle}>
          {(hasActiveEffect || hasBleedEffect) && <div style={activeEffectOverlayStyle}></div>}
        </div>
        {label === "HP" && pendingHealAmount > 0 && (
          <div style={pendingHealBarStyle}></div>
        )}

        {/* Cyberpunk scan line effect - now matches bar color theme */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '1px', // Reduced scan line thickness
          background: `linear-gradient(90deg, transparent, ${scanLineColor}, transparent)`,
          animation: 'statusScan 3s linear infinite',
          opacity: 0.8,
        }} />
      </div>

      {/* Value Text - Only show current value, larger font */}
      <span style={{
        color: glow || hasBleedEffect ? '#ff6666' : '#ffffff',
        fontSize: '12px', // Reduced from 14px to be more compact
        minWidth: '35px', // Reduced width
        textAlign: 'right',
        fontWeight: 'bold', // Make numbers bolder
        animation: glow || hasBleedEffect ? 'pulse 1.5s ease-in-out infinite alternate' : 'none',
        textShadow: glow || hasBleedEffect ? '0 0 8px rgba(255, 102, 102, 0.8)' : '0 0 4px rgba(255, 255, 255, 0.6)',
      }}>
        {Math.round(value)}
      </span>

      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          100% { opacity: 0.6; }
        }
        @keyframes statusScan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

export default StatusBar; 