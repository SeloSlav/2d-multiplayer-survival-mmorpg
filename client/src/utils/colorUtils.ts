import { ColorPoint, baseKeyframes, defaultPeakMidnightColor, defaultTransitionNightColor, fullMoonPeakMidnightColor, fullMoonTransitionNightColor } from '../hooks/useDayNightCycle';

// Re-export ColorPoint if needed elsewhere, otherwise keep it internal
export type { ColorPoint };

// Helper function for linear interpolation
function lerp(start: number, end: number, t: number): number {
  // Clamp t to [0, 1] to prevent extrapolation issues
  const clampedT = Math.max(0, Math.min(1, t));
  return start * (1 - clampedT) + end * clampedT;
}

/**
 * Generates the specific keyframes for the current cycle based on full moon status.
 * @param isEffectiveFullMoon - Whether the current or upcoming night cycle is a full moon.
 * @returns The keyframe object to use for interpolation.
 */
export function getDynamicKeyframes(isEffectiveFullMoon: boolean): Record<number, ColorPoint> {
    // Choose peak/transition colors based on the effective moon state
    const peakNight = isEffectiveFullMoon ? fullMoonPeakMidnightColor : defaultPeakMidnightColor;
    const transitionNight = isEffectiveFullMoon ? fullMoonTransitionNightColor : defaultTransitionNightColor;

    // Start with a copy of the base keyframes
    let adjustedKeyframes = { ...baseKeyframes };

    // Override pure night colors using selected colors
    adjustedKeyframes[0.00] = peakNight;
    adjustedKeyframes[0.20] = transitionNight;
    adjustedKeyframes[0.95] = transitionNight;
    adjustedKeyframes[1.00] = peakNight;

    // Adjust adjacent keyframes ONLY if the effective moon state is full moon for smoother transitions
    if (isEffectiveFullMoon) {
        // Blend Dawn towards the brighter transition night
        const dawn = baseKeyframes[0.35];
        adjustedKeyframes[0.35] = {
            r: Math.round(lerp(transitionNight.r, dawn.r, 0.7)), // Bias towards Dawn color
            g: Math.round(lerp(transitionNight.g, dawn.g, 0.7)),
            b: Math.round(lerp(transitionNight.b, dawn.b, 0.7)),
            a: lerp(transitionNight.a, dawn.a, 0.6)           // Bias towards Dawn opacity (less opaque)
        };

        // Blend late Dusk towards the brighter transition night
        const dusk = baseKeyframes[0.75];
        const fadingDusk = baseKeyframes[0.85];
         adjustedKeyframes[0.85] = {
            r: Math.round(lerp(dusk.r, transitionNight.r, 0.5)), // Mid-point blend for color
            g: Math.round(lerp(dusk.g, transitionNight.g, 0.5)),
            b: Math.round(lerp(dusk.b, transitionNight.b, 0.5)),
            // Interpolate alpha between original fading dusk and the transition night alpha
            a: lerp(fadingDusk.a, transitionNight.a, 0.5) // Blend alpha towards transitionNight alpha
         };
    }
     // If not full moon, the base keyframes for dawn/dusk are already set correctly.

    return adjustedKeyframes;
}


/**
 * Interpolates RGBA color between keyframes based on progress.
 * @param progress - The cycle progress (0.0 to 1.0).
 * @param currentKeyframes - The keyframe object to use.
 * @returns An RGBA color string.
 */
export function interpolateRgba(progress: number, currentKeyframes: Record<number, ColorPoint>): string {
  const sortedKeys = Object.keys(currentKeyframes).map(Number).sort((a, b) => a - b);

  let startKey = sortedKeys[0]; // Default to first key
  let endKey = sortedKeys[sortedKeys.length - 1]; // Default to last key

  // Find the two keyframes surrounding the progress
  for (let i = 0; i < sortedKeys.length - 1; i++) {
    if (progress >= sortedKeys[i] && progress <= sortedKeys[i + 1]) {
      startKey = sortedKeys[i];
      endKey = sortedKeys[i + 1];
      break;
    }
  }
   // Handle edge case where progress is exactly 1.0, use last two keys
   if (progress === 1.0 && sortedKeys.length > 1) {
        startKey = sortedKeys[sortedKeys.length - 2];
        endKey = sortedKeys[sortedKeys.length - 1];
   }


  const startTime = startKey;
  const endTime = endKey;
  const startColor = currentKeyframes[startKey];
  const endColor = currentKeyframes[endKey];

  // Calculate interpolation factor (t) between 0 and 1
  // Prevent division by zero if start and end times are the same
  const t = (endTime === startTime) ? 0 : (progress - startTime) / (endTime - startTime);

  // Interpolate each color component
  const r = Math.round(lerp(startColor.r, endColor.r, t));
  const g = Math.round(lerp(startColor.g, endColor.g, t));
  const b = Math.round(lerp(startColor.b, endColor.b, t));
  const a = lerp(startColor.a, endColor.a, t);

  // Ensure alpha is within valid range [0, 1]
  const clampedA = Math.max(0, Math.min(1, a));

  return `rgba(${r},${g},${b},${clampedA.toFixed(2)})`; // Return RGBA string without spaces
} 