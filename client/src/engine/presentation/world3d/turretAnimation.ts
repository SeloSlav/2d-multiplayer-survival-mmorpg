/** Aim along the world ground plane; idle turrets slowly scan their surroundings. */
export function turretDesiredYaw(origin: {x:number;y:number}, target: {x:number;y:number} | null, time: number, seed: number): number {
  if (target && Math.hypot(target.x-origin.x, target.y-origin.y) > 0.01) return Math.atan2(target.x-origin.x, target.y-origin.y);
  return (seed % 360) * Math.PI / 180 + Math.sin(time * .28 + seed % 31) * .65;
}

export function advanceTurretYaw(current: number, desired: number, dt: number): number {
  const difference = Math.atan2(Math.sin(desired-current), Math.cos(desired-current));
  return current + difference * (1 - Math.exp(-Math.max(0, dt) * 6));
}

export function turretRecoil(nowMs: number, lastFireMs: number): number {
  const age = nowMs - lastFireMs;
  return lastFireMs > 0 && age >= 0 && age < 350 ? .18 * Math.exp(-age / 85) : 0;
}
