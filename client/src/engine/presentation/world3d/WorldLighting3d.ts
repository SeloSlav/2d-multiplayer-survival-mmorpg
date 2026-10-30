import { Color, Vector3 } from 'three/webgpu';
import { FULL_MOON_CYCLE_INTERVAL, mapLegacyCycleProgress } from '../../../config/dayNightConstants';

interface Keyframe { at:number; direct:number; sky:number; ground:number; directPower:number; skyPower:number; daylight:number }
const key = (at:number,direct:number,sky:number,ground:number,directPower:number,skyPower:number,daylight:number):Keyframe =>
  ({at:mapLegacyCycleProgress(at),direct,sky,ground,directPower,skyPower,daylight});
// Artist-controlled light, not a screen tint: local fire and emissive surfaces
// retain their own colors. Phase anchors follow the original 2D cycle.
const REGULAR:Keyframe[] = [
  key(0,0xd18bab,0x7e759f,0x57516c,.50,.58,.08),
  key(.025,0xff9860,0xd39ba8,0x796275,1.30,.95,.40),
  key(.045,0xffb567,0xe7c3aa,0x8c796c,2.05,1.40,.72),
  key(.10,0xffe0ac,0xc9d8d1,0x747864,2.65,1.90,.95),
  key(.15,0xffedcf,0xc4d6d5,0x707765,2.80,2.05,1),
  key(.55,0xffedcf,0xc4d6d5,0x707765,2.80,2.05,1),
  key(.68,0xffdeb1,0xc8d0c6,0x777263,2.65,1.90,.95),
  key(.72,0xff914a,0xe9aa88,0x8b6e67,2.05,1.42,.68),
  key(.75,0xf88da0,0xd29cbf,0x957a9f,1.35,1.12,.38),
  key(.77,0xd3a0e0,0xb09dce,0x867aa6,.95,1.05,.18),
  key(.80,0xa4b9ee,0x8a9fc8,0x65759c,.65,.80,.05),
  key(.90,0xabc3ef,0x7d96c4,0x52668c,.62,.72,0),
  key(.945,0xa4bce9,0x718bb9,0x495d80,.53,.63,0),
  key(.97,0xa4b9e1,0x8295bf,0x596987,.56,.70,.02),
  key(.99,0xbda4d3,0x9290ba,0x68647f,.53,.70,.05),
  key(1,0xd18bab,0x7e759f,0x57516c,.50,.58,.08),
];
const MOON:Keyframe[] = [
  key(0,0xc3b5dc,0x9cadd5,0x697a9e,.67,.86,.08),
  key(.025,0xffba9b,0xd8bdc8,0x908693,1.30,1.05,.40),
  key(.10,0xffe0ac,0xc9d8d1,0x747864,2.65,1.90,.95),
  key(.15,0xffedcf,0xc4d6d5,0x707765,2.80,2.05,1),
  key(.55,0xffedcf,0xc4d6d5,0x707765,2.80,2.05,1),
  key(.68,0xffdeb1,0xc8d0c6,0x777263,2.65,1.90,.95),
  key(.72,0xffa075,0xe8b8aa,0x97877f,2.05,1.46,.68),
  key(.75,0xdca0ba,0xaca1c4,0x757291,1.15,1.00,.38),
  key(.77,0xb4b8e2,0x829ac6,0x596d91,.78,.88,.18),
  key(.80,0xb7d5ff,0xa1bce0,0x7b8eac,.95,1.10,.05),
  key(.90,0xb7d6ff,0x96b5dd,0x7189aa,.92,1.02,0),
  key(.945,0xb0cef7,0x90abd4,0x6b80a2,.85,.94,0),
  key(.97,0xb8cdee,0x9cadcc,0x7a87a1,.89,.98,.02),
  key(1,0xc3b5dc,0x9cadd5,0x697a9e,.67,.86,.08),
];
export interface WorldLightState { direct:Color; sky:Color; ground:Color; directPower:number; skyPower:number; daylight:number; direction:Vector3 }
function sample(keys:Keyframe[],cycle:number):WorldLightState {
  let left=keys[0],right=keys[keys.length-1];
  for(let i=0;i<keys.length-1;i++)if(cycle>=keys[i].at&&cycle<=keys[i+1].at){left=keys[i];right=keys[i+1];break;}
  const t=right.at===left.at?0:(cycle-left.at)/(right.at-left.at), s=t*t*(3-2*t);
  const blend=(a:number,b:number)=>a+(b-a)*s;
  return {direct:new Color(left.direct).lerp(new Color(right.direct),s),sky:new Color(left.sky).lerp(new Color(right.sky),s),ground:new Color(left.ground).lerp(new Color(right.ground),s),
    directPower:blend(left.directPower,right.directPower),skyPower:blend(left.skyPower,right.skyPower),daylight:blend(left.daylight,right.daylight),direction:new Vector3()};
}
/** Continuous phase and full-moon interpolation, including the cycle boundary. */
export function worldLightAt(progress:number,fullMoon=false,cycleCount?:number):WorldLightState {
  const cycle=((Number.isFinite(progress)?progress:.45)%1+1)%1;
  const state=sample(fullMoon?MOON:REGULAR,cycle);
  if(cycleCount!==undefined && cycle<mapLegacyCycleProgress(.1)) {
    const wasFullMoon=cycleCount>0 && (cycleCount-1)%FULL_MOON_CYCLE_INTERVAL===0;
    if(wasFullMoon!==fullMoon){
      const previous=sample(wasFullMoon?MOON:REGULAR,cycle),t=cycle/mapLegacyCycleProgress(.1),s=t*t*(3-2*t);
      state.direct.copy(previous.direct.lerp(state.direct,s));state.sky.copy(previous.sky.lerp(state.sky,s));state.ground.copy(previous.ground.lerp(state.ground,s));
      state.directPower=previous.directPower+(state.directPower-previous.directPower)*s;state.skyPower=previous.skyPower+(state.skyPower-previous.skyPower)*s;
    }
  }
  const dusk=mapLegacyCycleProgress(.76),phase=cycle<dusk?cycle/dusk*Math.PI:Math.PI+(cycle-dusk)/(1-dusk)*Math.PI;
  state.direction.set(-Math.cos(phase)*.8,.28+Math.abs(Math.sin(phase))*.85,-.45).normalize();
  return state;
}
