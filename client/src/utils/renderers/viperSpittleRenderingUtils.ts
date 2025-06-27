import { ViperSpittle as SpacetimeDBViperSpittle } from '../../generated';

// Viper spittle rendering constants
const SPITTLE_SCALE = 0.8; // Larger than arrows but smaller than thrown items
const SPITTLE_TRAIL_LENGTH = 8; // Number of trail particles
const SPITTLE_SPEED = 600.0; // Same as server-side

// Client-side animation tracking for viper spittle
const clientSpittleStartTimes = new Map<string, number>(); // spittleId -> client timestamp when spittle started
const lastKnownServerSpittleTimes = new Map<string, number>(); // spittleId -> last known server timestamp

interface RenderViperSpittleProps {
  ctx: CanvasRenderingContext2D;
  spittle: SpacetimeDBViperSpittle;
  currentTimeMs: number;
}

export const renderViperSpittle = ({
  ctx,
  spittle,
  currentTimeMs,
}: RenderViperSpittleProps) => {
  const spittleId = spittle.id.toString();
  const serverStartTimeMicros = Number(spittle.startTime.microsSinceUnixEpoch);
  const serverStartTimeMs = serverStartTimeMicros / 1000;
  
  // Check if this is a NEW spittle by comparing server timestamps
  const lastKnownServerTime = lastKnownServerSpittleTimes.get(spittleId) || 0;
  let elapsedTimeSeconds = 0;
  
  if (serverStartTimeMs !== lastKnownServerTime) {
    // NEW spittle detected! Always start immediately for smooth gameplay
    console.log(`🐍 NEW viper spittle ${spittleId.substring(0, 8)}: immediate render`);
    lastKnownServerSpittleTimes.set(spittleId, serverStartTimeMs);
    clientSpittleStartTimes.set(spittleId, currentTimeMs); // Use current client time
    elapsedTimeSeconds = 0; // Always start at 0 for immediate rendering
  } else {
    // Use client-tracked time for smooth position calculation
    const clientStartTime = clientSpittleStartTimes.get(spittleId);
    if (clientStartTime) {
      const elapsedClientMs = currentTimeMs - clientStartTime;
      elapsedTimeSeconds = elapsedClientMs / 1000;
    } else {
      // Fallback: Use current time as start time for missing client tracking
      console.log(`🐍 FALLBACK: Starting viper spittle ${spittleId.substring(0, 8)} immediately`);
      clientSpittleStartTimes.set(spittleId, currentTimeMs);
      elapsedTimeSeconds = 0; // Start immediately
    }
  }
  
  // Always render spittles (removed negative time check for immediate visibility)
  if (elapsedTimeSeconds < 0) {
    // Force to 0 for immediate visibility in production with network latency
    elapsedTimeSeconds = 0;
  }
  
  // Client-side safety checks to prevent spittles from lingering indefinitely
  const distanceTraveled = Math.sqrt(
    Math.pow(spittle.startPosX - (spittle.startPosX + spittle.velocityX * elapsedTimeSeconds), 2) +
    Math.pow(spittle.startPosY - (spittle.startPosY + spittle.velocityY * elapsedTimeSeconds), 2)
  );
  
  // Don't render if spittle has exceeded reasonable limits (client-side cleanup)
  if (elapsedTimeSeconds > 5 || distanceTraveled > spittle.maxRange) {
    console.log(`🐍 [CLIENT CLEANUP] Viper spittle ${spittleId.substring(0, 8)} exceeded limits - Time: ${elapsedTimeSeconds.toFixed(1)}s, Distance: ${distanceTraveled.toFixed(1)}`);
    // Clean up tracking for this spittle
    clientSpittleStartTimes.delete(spittleId);
    lastKnownServerSpittleTimes.delete(spittleId);
    return;
  }
  
  // Calculate current position (straight line, no gravity like server-side)
  const currentX = spittle.startPosX + (spittle.velocityX * elapsedTimeSeconds);
  const currentY = spittle.startPosY + (spittle.velocityY * elapsedTimeSeconds);

  // Calculate rotation based on velocity vector
  const angle = Math.atan2(spittle.velocityY, spittle.velocityX);

  // Render green spittle trail particles
  ctx.save();
  
  // Draw trail particles (moving backwards from current position)
  for (let i = 0; i < SPITTLE_TRAIL_LENGTH; i++) {
    const trailProgress = i / SPITTLE_TRAIL_LENGTH;
    const trailTime = elapsedTimeSeconds - (trailProgress * 0.1); // Trail spans 0.1 seconds
    
    if (trailTime < 0) continue; // Don't draw trail particles before spittle started
    
    const trailX = spittle.startPosX + (spittle.velocityX * trailTime);
    const trailY = spittle.startPosY + (spittle.velocityY * trailTime);
    
    // Green color with decreasing opacity for trail effect
    const alpha = (1 - trailProgress) * 0.8;
    const size = (1 - trailProgress) * 6 + 2; // Size decreases along trail
    
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgba(0, 255, 50, ${alpha})`; // Bright green
    
    ctx.beginPath();
    ctx.arc(trailX, trailY, size, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Draw main spittle projectile
  ctx.globalAlpha = 1.0;
  ctx.fillStyle = '#00FF32'; // Bright toxic green
  ctx.strokeStyle = '#00AA22'; // Darker green outline
  ctx.lineWidth = 1;
  
  // Draw elongated spittle shape
  ctx.save();
  ctx.translate(currentX, currentY);
  ctx.rotate(angle);
  
  // Draw elongated oval spittle projectile
  ctx.beginPath();
  ctx.ellipse(0, 0, 8, 3, 0, 0, Math.PI * 2); // 8px long, 3px wide
  ctx.fill();
  ctx.stroke();
  
  // Add a bright center highlight
  ctx.fillStyle = '#AAFFAA'; // Light green highlight
  ctx.beginPath();
  ctx.ellipse(0, 0, 4, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
  ctx.restore();
};

// Add cleanup function to prevent memory leaks
export const cleanupOldViperSpittleTracking = () => {
  const currentTime = performance.now();
  const MAX_SPITTLE_LIFETIME_MS = 8000; // 8 seconds max
  const toDelete = [];
  
  for (const [spittleId, startTime] of clientSpittleStartTimes.entries()) {
    if (currentTime - startTime > MAX_SPITTLE_LIFETIME_MS) {
      toDelete.push(spittleId);
    }
  }
  
  for (const spittleId of toDelete) {
    clientSpittleStartTimes.delete(spittleId);
    lastKnownServerSpittleTimes.delete(spittleId);
  }
  
  if (toDelete.length > 0) {
    console.log(`🐍 [CLIENT CLEANUP] Removed ${toDelete.length} old viper spittle tracking entries`);
  }
}; 