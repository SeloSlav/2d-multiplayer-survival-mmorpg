import config from '../../../shared/config/combatCover.json';

export const COMBAT_COVER = config;
export type CombatCoverProfile = typeof config.profiles['7'];
export function combatCoverProfile(variant: number): CombatCoverProfile | undefined {
  return (config.profiles as Record<string, CombatCoverProfile>)[variant];
}

export function coverTargetPoint(variant: number, x: number, y: number, fromX: number, fromY: number) {
  const cover = combatCoverProfile(variant);
  return cover ? { x: Math.max(x-cover.width/2,Math.min(x+cover.width/2,fromX)),
    y: Math.max(y-cover.depth/2,Math.min(y+cover.depth/2,fromY)) } : {x,y};
}
