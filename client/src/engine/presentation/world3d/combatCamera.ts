import { predictedImpactCameraShake } from '../../../utils/combatFeedbackEvents';

/** The shake is presentation-only: world input, collision and the logical
 * camera offset keep their original values. UI markers use this same offset. */
export function combatCameraOffset(base:{x:number;y:number},damageX:number,damageY:number,now=Date.now()):{x:number;y:number} {
  const impact=predictedImpactCameraShake(now);
  return {x:base.x+(Number.isFinite(damageX)?damageX:0)+impact.x,y:base.y+(Number.isFinite(damageY)?damageY:0)+impact.y};
}
