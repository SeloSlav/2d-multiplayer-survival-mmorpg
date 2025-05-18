import React from 'react';
import { WorldState, TimeOfDay } from '../generated';

// Style constants
const UI_BG_COLOR = 'rgba(40, 40, 60, 0.85)';
const UI_BORDER_COLOR = '#a0a0c0';
const UI_SHADOW = '2px 2px 0px rgba(0,0,0,0.5)';
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
  if (!worldState) return null;

  // Helper function to get icon based on time of day
  const getTimeIcon = (timeOfDay: TimeOfDay) => {
    switch (timeOfDay.tag) {
      case 'Dawn': return '🌅';
      case 'TwilightMorning': return '✨'; // Sparkles for morning twilight
      case 'Morning': return '🌄';
      case 'Noon': return '☀️';
      case 'Afternoon': return '🌤️';
      case 'Dusk': return '🌇';
      case 'TwilightEvening': return '🔮'; // Crystal ball for evening twilight
      case 'Night': return worldState.isFullMoon ? '🌕' : '🌙';
      case 'Midnight': return worldState.isFullMoon ? '🌕' : '🌑';
      default: return '⏱️';
    }
  };

  // Helper function to get background gradient based on time of day
  const getBackgroundGradient = () => {
    const colorMap: Record<string, string> = {
      Dawn: COLORS.dawn,
      TwilightMorning: COLORS.twilightMorning,
      Morning: COLORS.morning,
      Noon: COLORS.noon,
      Afternoon: COLORS.afternoon,
      Dusk: COLORS.dusk,
      TwilightEvening: COLORS.twilightEvening,
      Night: worldState.isFullMoon ? COLORS.fullMoon : COLORS.night,
      Midnight: worldState.isFullMoon ? COLORS.fullMoon : COLORS.midnight
    };

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

  // Get label and icon for current time
  const timeIcon = getTimeIcon(worldState.timeOfDay);
  const timeLabel = worldState.timeOfDay.tag;
  
  // Determine if it's a full moon night
  const isFullMoonNight = worldState.isFullMoon && 
    (worldState.timeOfDay.tag === 'Night' || worldState.timeOfDay.tag === 'Midnight');

  return (
    <div style={{
      position: 'fixed',
      top: '15px',
      right: '15px',
      backgroundColor: UI_BG_COLOR,
      color: 'white',
      padding: '10px 15px',
      borderRadius: '4px',
      border: `1px solid ${UI_BORDER_COLOR}`,
      fontFamily: UI_FONT_FAMILY,
      boxShadow: UI_SHADOW,
      zIndex: 50,
      width: '220px',
      fontSize: '10px',
    }}>
      {/* Cycle counter - REMOVED */}
      {/* 
      <div style={{ marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
        <span>Cycle: {worldState.cycleCount}</span>
        <span>{isFullMoonNight ? '🌕 Full Moon' : ''}</span>
      </div>
      */}

      {/* Display Full Moon status if applicable, otherwise just a small margin or nothing - REMOVED */}
      {/* 
      {isFullMoonNight ? (
        <div style={{ marginBottom: '6px', textAlign: 'center' }}>
          <span>🌕 Full Moon</span>
        </div>
      ) : (
        <div style={{ marginBottom: '6px' }}></div> // Keeps spacing consistent if no full moon text
      )}
      */}

      {/* Time of day indicator - REMOVED */}
      {/*
      <div style={{ marginBottom: '6px' }}></div>
      */}
      
      {/* Progress bar */}
      <div style={{
        position: 'relative',
        height: '16px',
        backgroundColor: '#333',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid #555',
      }}>
        {/* Gradient background representing the day/night cycle */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: getBackgroundGradient(),
        }}></div>
        
        {/* Position indicator/dial */}
        <div style={{
          position: 'absolute',
          top: '0',
          left: dialPosition,
          transform: 'translateX(-50%)',
          width: '4px',
          height: '100%',
          backgroundColor: 'white',
          boxShadow: '0 0 3px 1px rgba(255,255,255,0.8)',
        }}></div>
      </div>
      
      {/* Simple time markers - REMOVED */}
      {/* 
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: '2px',
        fontSize: '8px',
        color: '#ccc',
      }}>
        <span>Midnight</span>
        <span>Noon</span>
        <span>Midnight</span>
      </div>
      */}
    </div>
  );
};

export default DayNightCycleTracker; 