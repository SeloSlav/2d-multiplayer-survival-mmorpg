import { LIGHT_FADE_FULL_AT, NIGHT_LIGHTS_OFF, NIGHT_LIGHTS_ON, TWILIGHT_MORNING_FADE_START } from '../../../config/dayNightConstants';

// The 2D monument uses a 300px sprite, whose painted stone occupies about half
// its width. At 48px/tile this restores its roughly 150px monumental silhouette.
export const RUNE_STONE_SCALE = 2;
export const RUNE_LIGHT_RADIUS = 440 / 48;
export const RUNE_POOL_DIAMETER = 360 / 48;
export const RUNE_PALETTES = {
  Green: { glow: 0x50dc64, accent: 0xb4ffb4 },
  Red: { glow: 0xf0503c, accent: 0xffc878 },
  Blue: { glow: 0x64a0ff, accent: 0xc8dcff },
} as const;
export type RuneType = keyof typeof RUNE_PALETTES;
export function runeType(type: string): RuneType { return type === 'Red' || type === 'Green' ? type : 'Blue'; }

/** Shared dusk/dawn thresholds, with a continuous fade through the cycle wrap. */
export function runeNightStrength(progress: number): number {
  const cycle = progress - Math.floor(progress);
  if (cycle >= NIGHT_LIGHTS_ON && cycle < LIGHT_FADE_FULL_AT)
    return Math.pow((cycle - NIGHT_LIGHTS_ON) / (LIGHT_FADE_FULL_AT - NIGHT_LIGHTS_ON), .7);
  if (cycle >= LIGHT_FADE_FULL_AT && cycle < TWILIGHT_MORNING_FADE_START) return 1;
  if (cycle >= TWILIGHT_MORNING_FADE_START || cycle < NIGHT_LIGHTS_OFF) {
    const sinceDawn = cycle >= TWILIGHT_MORNING_FADE_START ? cycle - TWILIGHT_MORNING_FADE_START : 1 - TWILIGHT_MORNING_FADE_START + cycle;
    return Math.pow(Math.max(0, 1 - sinceDawn / (1 - TWILIGHT_MORNING_FADE_START + NIGHT_LIGHTS_OFF)), .7);
  }
  return 0;
}
