/** Shared with the 2D grass renderer so both views react to the same weather. */
export const GRASS_SWAY_BY_WEATHER: Readonly<Record<string, number>> = {
  Clear: .15, LightRain: .45, ModerateRain: .75, HeavyRain: 1, HeavyStorm: 1.35,
};
export const BEACH_GRASS_SPEED_BY_WEATHER: Readonly<Record<string, number>> = {
  Clear: .85, LightRain: 1.05, ModerateRain: 1.3, HeavyRain: 1.65, HeavyStorm: 2.35,
};
export const DEFAULT_GRASS_SWAY = .15;
export const DEFAULT_BEACH_GRASS_SPEED = .85;
