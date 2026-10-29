import { GROUND_Y_SCALE, WORLD_3D } from './visualContract';

/** Carry is a pitch in the survivor's forward/up plane, never a sideways roll.
 * Counter the world's ground-depth stretch so turning cannot flatten it.
 * The side view projects to a 45° rise, matching the user's drawn guide. */
export function restingWeaponPitch(yaw: number): number {
  const depthStretch = Math.hypot(Math.sin(yaw), Math.cos(yaw) * GROUND_Y_SCALE);
  return Math.atan(Math.cos(WORLD_3D.elevationRadians) / depthStretch);
}
