import React from 'react';
import { PlantedSeed, Cloud, WorldState, WaterPatch, Campfire, Lantern, Furnace } from '../generated';
import styles from './PlantedSeedTooltip.module.css';

interface PlantedSeedTooltipProps {
  seed: PlantedSeed;
  visible: boolean;
  position: { x: number; y: number };
  currentTime: number; // Current timestamp in milliseconds
  // Environmental data for growth modifiers
  clouds: Map<string, Cloud>;
  worldState: WorldState | null;
  waterPatches: Map<string, WaterPatch>;
  campfires: Map<string, Campfire>;
  lanterns: Map<string, Lantern>;
  furnaces: Map<string, Furnace>;
}

const PlantedSeedTooltip: React.FC<PlantedSeedTooltipProps> = ({ 
  seed, 
  visible, 
  position, 
  currentTime,
  clouds,
  worldState,
  waterPatches,
  campfires,
  lanterns,
  furnaces
}) => {
  if (!visible || !seed) {
    return null;
  }

  // Calculate growth percentage
  const growthPercent = Math.round(seed.growthProgress * 100);
  
  // Calculate time until maturity
  const timeUntilMatureMs = seed.willMatureAt.toDate().getTime() - currentTime;
  const isFullyGrown = seed.growthProgress >= 1.0;
  
  // Calculate time already spent growing
  const timeSpentGrowingMs = currentTime - seed.plantedAt.toDate().getTime();
  
  // Format time duration
  const formatTimeDuration = (ms: number): string => {
    const seconds = Math.floor(Math.abs(ms) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    } else if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    } else if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${seconds}s`;
    }
  };
  
  // --- Environmental Condition Checks ---
  
  // Check if seed is covered by clouds
  const calculateCloudCoverage = (): number => {
    let cloudCoverage = 0;
    
    clouds.forEach(cloud => {
      const dx = seed.posX - cloud.posX;
      const dy = seed.posY - cloud.posY;
      
      const halfWidth = cloud.width / 2;
      const halfHeight = cloud.height / 2;
      
      if (halfWidth > 0 && halfHeight > 0) {
        const normalizedX = dx / halfWidth;
        const normalizedY = dy / halfHeight;
        const distanceSquared = normalizedX * normalizedX + normalizedY * normalizedY;
        
        if (distanceSquared <= 1.0) {
          const coverageIntensity = Math.max(0, 1.0 - Math.sqrt(distanceSquared));
          const effectiveCoverage = coverageIntensity * cloud.currentOpacity;
          cloudCoverage = Math.min(1.0, cloudCoverage + effectiveCoverage);
        }
      }
    });
    
    return cloudCoverage;
  };
  
  // Check if seed is near water
  const isNearWater = (): boolean => {
    const waterCheckRadius = 50; // pixels
    
    for (const waterPatch of waterPatches.values()) {
      const dx = seed.posX - waterPatch.posX;
      const dy = seed.posY - waterPatch.posY;
      const distanceSq = dx * dx + dy * dy;
      
      if (distanceSq <= waterCheckRadius * waterCheckRadius) {
        return true;
      }
    }
    
    return false;
  };
  
  // Check nearby light sources
  const calculateLightEffects = (): { nearCampfire: boolean; nearLantern: boolean; nearFurnace: boolean } => {
    let nearCampfire = false;
    let nearLantern = false;
    let nearFurnace = false;
    
    // Check campfires (negative effect)
    campfires.forEach(campfire => {
      if (campfire.isBurning && !campfire.isDestroyed) {
        const dx = seed.posX - campfire.posX;
        const dy = seed.posY - campfire.posY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < 120) {
          nearCampfire = true;
        }
      }
    });
    
    // Check lanterns (positive effect)
    lanterns.forEach(lantern => {
      if (lantern.isBurning && !lantern.isDestroyed) {
        const dx = seed.posX - lantern.posX;
        const dy = seed.posY - lantern.posY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < 100) {
          nearLantern = true;
        }
      }
    });
    
    // Check furnaces (moderate positive effect at night)
    furnaces.forEach(furnace => {
      if (furnace.isBurning && !furnace.isDestroyed) {
        const dx = seed.posX - furnace.posX;
        const dy = seed.posY - furnace.posY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < 120) {
          nearFurnace = true;
        }
      }
    });
    
    return { nearCampfire, nearLantern, nearFurnace };
  };
  
  const cloudCoverage = calculateCloudCoverage();
  const nearWater = isNearWater();
  const lightEffects = calculateLightEffects();
  const currentWeather = worldState?.currentWeather.tag || 'Clear';
  const currentTimeOfDay = worldState?.timeOfDay.tag || 'Noon';
  
  // Get plant type name (format the tag nicely)
  const plantTypeName = seed.plantType.tag
    .split(/(?=[A-Z])/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  
  // Determine growth stage for visual indicator (must match CSS class names)
  const getGrowthStage = () => {
    if (growthPercent >= 100) return 'mature';
    if (growthPercent >= 75) return 'almostMature'; // Changed to camelCase to match CSS
    if (growthPercent >= 50) return 'growing';
    if (growthPercent >= 25) return 'sprouting';
    return 'planted';
  };
  
  const growthStage = getGrowthStage();
  
  // Position tooltip slightly offset from cursor
  const tooltipStyle = {
    left: `${position.x + 15}px`,
    top: `${position.y + 15}px`,
  };

  return (
    <div className={styles.tooltipContainer} style={tooltipStyle}>
      {/* Header with plant type */}
      <div className={`${styles.header} ${styles[growthStage]}`}>
        <span className={styles.plantIcon}>🌱</span>
        <span className={styles.plantName}>{plantTypeName}</span>
      </div>
      
      {/* Growth progress bar */}
      <div className={styles.progressSection}>
        <div className={styles.progressLabel}>
          <span>Growth Progress</span>
          <span className={styles.progressPercent}>{growthPercent}%</span>
        </div>
        <div className={styles.progressBarContainer}>
          <div 
            className={`${styles.progressBarFill} ${styles[growthStage]}`}
            style={{ width: `${growthPercent}%` }}
          />
        </div>
      </div>
      
      {/* Info rows */}
      <div className={styles.infoSection}>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Seed Type:</span>
          <span className={styles.infoValue}>{seed.seedType}</span>
        </div>
        
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Time Growing:</span>
          <span className={styles.infoValue}>
            {formatTimeDuration(timeSpentGrowingMs)}
          </span>
        </div>
        
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>
            {isFullyGrown ? 'Status:' : 'Time Until Mature:'}
          </span>
          <span className={`${styles.infoValue} ${styles[growthStage]}`}>
            {isFullyGrown ? '✓ Ready to Harvest!' : formatTimeDuration(timeUntilMatureMs)}
          </span>
        </div>
      </div>
      
      {/* Growth Conditions Section */}
      {!isFullyGrown && (
        <div className={styles.conditionsSection}>
          <div className={styles.conditionsHeader}>Growth Conditions</div>
          
          {/* Time of Day */}
          <div className={styles.conditionRow}>
            <span className={styles.conditionLabel}>Time of Day:</span>
            <span className={`${styles.conditionValue} ${currentTimeOfDay === 'Night' || currentTimeOfDay === 'Midnight' ? styles.negative : styles.neutral}`}>
              {currentTimeOfDay}
              {(currentTimeOfDay === 'Night' || currentTimeOfDay === 'Midnight') && ' ⛔'}
              {currentTimeOfDay === 'Noon' && ' ☀️'}
            </span>
          </div>
          
          {/* Weather */}
          <div className={styles.conditionRow}>
            <span className={styles.conditionLabel}>Weather:</span>
            <span className={`${styles.conditionValue} ${
              currentWeather === 'LightRain' || currentWeather === 'ModerateRain' ? styles.positive : 
              currentWeather === 'HeavyStorm' ? styles.negative : 
              styles.neutral
            }`}>
              {currentWeather === 'LightRain' && '🌧️ Light Rain +30%'}
              {currentWeather === 'ModerateRain' && '🌧️ Moderate Rain +60%'}
              {currentWeather === 'HeavyRain' && '⛈️ Heavy Rain +40%'}
              {currentWeather === 'HeavyStorm' && '⛈️ Storm -20%'}
              {currentWeather === 'Clear' && '☀️ Clear'}
            </span>
          </div>
          
          {/* Cloud Coverage */}
          {cloudCoverage > 0.1 && (
            <div className={styles.conditionRow}>
              <span className={styles.conditionLabel}>Cloud Cover:</span>
              <span className={`${styles.conditionValue} ${styles.negative}`}>
                ☁️ {Math.round(cloudCoverage * 100)}% (−{Math.round(cloudCoverage * 60)}%)
              </span>
            </div>
          )}
          
          {/* Water Proximity */}
          {nearWater && (
            <div className={styles.conditionRow}>
              <span className={styles.conditionLabel}>Near Water:</span>
              <span className={`${styles.conditionValue} ${styles.positive}`}>
                💧 Yes +15%
              </span>
            </div>
          )}
          
          {/* Light Sources */}
          {lightEffects.nearLantern && (
            <div className={styles.conditionRow}>
              <span className={styles.conditionLabel}>Near Lantern:</span>
              <span className={`${styles.conditionValue} ${styles.positive}`}>
                🏮 Yes +80%
              </span>
            </div>
          )}
          
          {lightEffects.nearFurnace && (
            <div className={styles.conditionRow}>
              <span className={styles.conditionLabel}>Near Furnace:</span>
              <span className={`${styles.conditionValue} ${styles.positive}`}>
                🔥 Yes +60%
              </span>
            </div>
          )}
          
          {lightEffects.nearCampfire && (
            <div className={styles.conditionRow}>
              <span className={styles.conditionLabel}>Near Campfire:</span>
              <span className={`${styles.conditionValue} ${styles.negative}`}>
                🔥 Too close! −40%
              </span>
            </div>
          )}
          
          {/* Base Growth Time Note */}
          <div className={styles.baseTimeNote}>
            * Times shown are estimates that adjust based on conditions
          </div>
        </div>
      )}
    </div>
  );
};

export default PlantedSeedTooltip;

