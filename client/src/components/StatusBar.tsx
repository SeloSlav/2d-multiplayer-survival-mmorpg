import React from 'react';

interface StatusBarProps {
  label: string;
  icon?: string;
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
  icon = '', 
  value, 
  maxValue, 
  barColor, 
  pendingHealAmount = 0,
  glow = false,
  hasActiveEffect = false,
  hasBleedEffect = false
}) => {
  const percentage = Math.max(0, Math.min(100, (value / maxValue) * 100));
  const totalWithPending = Math.min(maxValue, value + pendingHealAmount);
  const totalPercentage = Math.max(0, Math.min(100, (totalWithPending / maxValue) * 100));

  return (
    <div style={{
      marginBottom: '8px',
      fontFamily: '"Press Start 2P", cursive',
      fontSize: '9px',
      color: '#00ffff',
      textShadow: '0 0 4px rgba(0, 255, 255, 0.6)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '4px',
      }}>
        <span style={{
          color: '#00aaff',
          textShadow: '0 0 6px rgba(0, 170, 255, 0.8)',
        }}>
          {icon} {label}
        </span>
        <span style={{
          color: glow || hasBleedEffect ? '#ff6666' : '#ffffff',
          fontSize: '8px',
          animation: glow || hasBleedEffect ? 'pulse 1.5s ease-in-out infinite alternate' : 'none',
          textShadow: glow || hasBleedEffect ? '0 0 8px rgba(255, 102, 102, 0.8)' : '0 0 4px rgba(255, 255, 255, 0.6)',
        }}>
          {Math.round(value)}/{maxValue}
        </span>
      </div>
      
      <div style={{
        position: 'relative',
        width: '100%',
        height: '12px',
        background: 'linear-gradient(135deg, rgba(15, 15, 35, 0.8), rgba(10, 10, 25, 0.9))',
        borderRadius: '6px',
        border: '1px solid rgba(0, 170, 255, 0.4)',
        boxShadow: 'inset 0 0 8px rgba(0, 170, 255, 0.2)',
        overflow: 'hidden',
      }}>
        {/* Pending heal amount bar (ghost bar) */}
        {pendingHealAmount > 0 && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${totalPercentage}%`,
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.3), rgba(200, 200, 200, 0.3))',
            borderRadius: '5px',
            opacity: 0.6,
            boxShadow: '0 0 8px rgba(255, 255, 255, 0.4)',
          }}
        />)}
        
        {/* Main status bar */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: '100%',
          width: `${percentage}%`,
          background: hasBleedEffect 
            ? 'linear-gradient(135deg, #cc2222, #ff4444)'
            : hasActiveEffect 
              ? 'linear-gradient(135deg, #44ff44, #66ff66)'
              : `linear-gradient(135deg, ${barColor}, ${barColor}dd)`,
          borderRadius: '5px',
          transition: 'width 0.3s ease, background 0.3s ease',
          boxShadow: hasBleedEffect 
            ? '0 0 12px rgba(255, 68, 68, 0.6), inset 0 0 6px rgba(255, 68, 68, 0.3)'
            : hasActiveEffect 
              ? '0 0 12px rgba(68, 255, 68, 0.6), inset 0 0 6px rgba(68, 255, 68, 0.3)'
              : `0 0 10px ${barColor}66, inset 0 0 5px ${barColor}44`,
        }} />

        {/* Scan line effect */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '1px',
          background: 'linear-gradient(90deg, transparent, #00ffff, transparent)',
          animation: 'statusScan 3s linear infinite',
        }} />
      </div>

      <style>{`
        @keyframes statusScan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes pulse {
          0% { opacity: 1; }
          100% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
};

export default StatusBar; 