import React, { useState } from 'react';
import { WorldState, TimeOfDay } from '../generated';

// Style constants
const UI_BG_COLOR = 'linear-gradient(135deg, rgba(30, 15, 50, 0.9), rgba(20, 10, 40, 0.95))';
const UI_BORDER_COLOR = '#00aaff';
const UI_SHADOW = '0 0 20px rgba(0, 170, 255, 0.4), inset 0 0 10px rgba(0, 170, 255, 0.1)';
const UI_FONT_FAMILY = '"Press Start 2P", cursive';

// Colors for different times of day
const COLORS = {
  dawn: '#ff9e6d',
  morning: '#ffde59',
  noon: '#ffff99',
  afternoon: '#ffde59',
  dusk: '#ff7e45',
  night: '#3b4a78',
  midnight: '#1a1a40',
  fullMoon: '#e6e6fa',
  twilightMorning: '#c8a2c8', // Lilac/light purple for morning twilight
  twilightEvening: '#8a2be2'  // Blue-violet for evening twilight
};

interface DayNightCycleTrackerProps {
  worldState: WorldState | null;
}

const DayNightCycleTracker: React.FC<DayNightCycleTrackerProps> = ({ worldState }) => {
  const [isMinimized, setIsMinimized] = useState(false);

  if (!worldState) return null;

  // Helper function to get display name for time of day
  const getTimeOfDayDisplay = (timeOfDay: TimeOfDay) => {
    switch (timeOfDay.tag) {
      case 'Dawn': return 'Dawn';
      case 'TwilightMorning': return 'Twilight Morning';
      case 'Morning': return 'Morning';
      case 'Noon': return 'Noon';
      case 'Afternoon': return 'Afternoon';
      case 'Dusk': return 'Dusk';
      case 'TwilightEvening': return 'Twilight Evening';
      case 'Night': return 'Night';
      case 'Midnight': return 'Midnight';
      default: return 'Unknown';
    }
  };

  // Helper function to get weather display
  const getWeatherDisplay = (weather: any) => {
    switch (weather.tag) {
      case 'Clear': return 'Clear';
      case 'LightRain': return 'Light Rain';
      case 'ModerateRain': return 'Moderate Rain';
      case 'HeavyRain': return 'Heavy Rain';
      case 'HeavyStorm': return 'Heavy Storm';
      default: return 'Unknown';
    }
  };

  // Helper function to get emoji based on time of day
  const getTimeOfDayEmoji = (timeOfDay: TimeOfDay, isFullMoon: boolean) => {
    switch (timeOfDay.tag) {
      case 'Dawn': return '🌅';
      case 'TwilightMorning': return '🌄';
      case 'Morning': return '☀️';
      case 'Noon': return '🌞';
      case 'Afternoon': return '🌤️';
      case 'Dusk': return '🌇';
      case 'TwilightEvening': return '🌆';
      case 'Night': return isFullMoon ? '🌕' : '🌙';
      case 'Midnight': return isFullMoon ? '🌕' : '🌑';
      default: return '🌍';
    }
  };

  // Helper function to get background gradient based on time of day
  const getBackgroundGradient = () => {
    // Create a gradient representing the day/night cycle
    return `linear-gradient(to right, 
      ${COLORS.midnight}, 
      ${COLORS.dawn}, 
      ${COLORS.twilightMorning}, 
      ${COLORS.morning}, 
      ${COLORS.noon}, 
      ${COLORS.afternoon}, 
      ${COLORS.dusk}, 
      ${COLORS.twilightEvening}, 
      ${COLORS.night}, 
      ${COLORS.midnight})`;
  };

  // Calculate dial position based on cycle progress (0-1)
  const dialPosition = `${worldState.cycleProgress * 100}%`;

  // Toggle minimize/maximize
  const toggleMinimized = () => {
    setIsMinimized(!isMinimized);
  };

  // Minimized view - just the emoji
  if (isMinimized) {
    return (
      <div
        onClick={toggleMinimized}
        style={{
          position: 'fixed',
          top: '15px',
          right: '15px',
          background: UI_BG_COLOR,
          color: '#00ffff',
          padding: '8px',
          borderRadius: '50%',
          border: `2px solid ${UI_BORDER_COLOR}`,
          boxShadow: UI_SHADOW,
          zIndex: 50,
          cursor: 'pointer',
          width: '40px',
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          transition: 'all 0.3s ease',
        }}
      >
        {getTimeOfDayEmoji(worldState.timeOfDay, worldState.isFullMoon)}
      </div>
    );
  }

  // Expanded view - full component
  return (
    <div style={{
      position: 'fixed',
      top: '15px',
      right: '15px',
      background: UI_BG_COLOR,
      color: '#00ffff',
      padding: '12px 18px',
      borderRadius: '8px',
      border: `2px solid ${UI_BORDER_COLOR}`,
      fontFamily: UI_FONT_FAMILY,
      boxShadow: UI_SHADOW,
      zIndex: 50,
      width: '240px',
      fontSize: '12px',
      textShadow: '0 0 6px rgba(0, 255, 255, 0.6)',
    }}>
      {/* Day/Time Information */}
      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '14px' }}>
          <span>Day {worldState.cycleCount}</span>
          <span
            onClick={toggleMinimized}
            style={{
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              opacity: 0.8,
              fontSize: '16px',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; }}
          >
            {getTimeOfDayEmoji(worldState.timeOfDay, worldState.isFullMoon)}
          </span>
        </div>
        <div style={{ fontSize: '11px', opacity: 0.8 }}>
          <div>
            <span>{getTimeOfDayDisplay(worldState.timeOfDay)}</span>
            <span style={{ margin: '0 4px' }}>|</span>
            <span>{getWeatherDisplay(worldState.currentWeather)}</span>
          </div>
          {worldState.rainIntensity > 0 && (
            <div style={{ marginTop: '2px', paddingLeft: '8px' }}>
              <span>Intensity: {Math.round(worldState.rainIntensity * 100)}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        position: 'relative',
        height: '18px',
        background: 'linear-gradient(135deg, rgba(15, 15, 35, 0.8), rgba(10, 10, 25, 0.9))',
        borderRadius: '10px',
        overflow: 'hidden',
        border: '2px solid rgba(0, 170, 255, 0.4)',
        boxShadow: 'inset 0 0 10px rgba(0, 170, 255, 0.2)',
      }}>
        {/* Gradient background representing the day/night cycle */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: getBackgroundGradient(),
          opacity: '0.8',
        }}></div>
        
        {/* Position indicator/dial */}
        <div style={{
          position: 'absolute',
          top: '0',
          left: dialPosition,
          transform: 'translateX(-50%)',
          width: '4px',
          height: '100%',
          background: 'linear-gradient(to bottom, #00ffff, #ffffff)',
          boxShadow: '0 0 8px rgba(255, 255, 255, 0.9), 0 0 15px rgba(0, 255, 255, 0.7)',
          borderRadius: '2px',
        }}></div>
        
        {/* Scan line effect */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '1px',
          background: 'linear-gradient(90deg, transparent, #00ffff, transparent)',
          animation: 'cycleScan 4s linear infinite',
        }} />
      </div>
      
      <style>{`
        @keyframes cycleScan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};

export default DayNightCycleTracker; 