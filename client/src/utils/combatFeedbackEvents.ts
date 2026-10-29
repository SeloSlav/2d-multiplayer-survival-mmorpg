export type CombatFeedbackKind = 'players'|'wildAnimals'|'animalCorpses'|'playerCorpses'|'trees'|'stones'|'barrels'|'livingCorals';
export interface PredictedCombatHit { sequence:number; at:number }
const recent=new Map<string,PredictedCombatHit>();
let sequence=0,lastImpactAt=0;
const key=(kind:CombatFeedbackKind,id:string)=>`${kind}:${id}`;

/** The existing melee prediction already chooses a single closest target. */
export function recordPredictedCombatHit(kind:CombatFeedbackKind,id:string,now=Date.now()):void {
  const k=key(kind,id);recent.delete(k);recent.set(k,{sequence:++sequence,at:now});lastImpactAt=now;
  while(recent.size>256)recent.delete(recent.keys().next().value!);
}
export function predictedCombatHit(kind:CombatFeedbackKind,id:string):PredictedCombatHit|undefined {return recent.get(key(kind,id));}

/** Small, bounded world-camera impulse for a locally predicted impact. */
export function predictedImpactCameraShake(now=Date.now()):{x:number;y:number} {
  const age=now-lastImpactAt;if(!lastImpactAt||age<0||age>=150)return {x:0,y:0};
  const envelope=(1-age/150)**2;
  return {x:Math.sin(age*.13)*3*envelope,y:Math.cos(age*.11)*2*envelope};
}
