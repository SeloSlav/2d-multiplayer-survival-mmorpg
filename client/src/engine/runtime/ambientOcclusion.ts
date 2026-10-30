export const AMBIENT_OCCLUSION={
  UNDERWATER_VOLUME_MULTIPLIER:.15,UNDERWATER_LOWPASS_FREQUENCY:400,UNDERWATER_TRANSITION_DURATION:300,
  INDOOR_VOLUME_MULTIPLIER:.18,INDOOR_LOWPASS_FREQUENCY:800,INDOOR_TRANSITION_DURATION:1000,
} as const;

export function ambientOcclusionTarget(underwater:boolean,indoors:boolean,underwaterOnly=false,entrainment=false):{gain:number;frequency:number;seconds:number}{
  if(underwater&&!underwaterOnly)return{gain:AMBIENT_OCCLUSION.UNDERWATER_VOLUME_MULTIPLIER,frequency:400,seconds:.3};
  if(indoors&&!underwaterOnly&&!entrainment)return{gain:AMBIENT_OCCLUSION.INDOOR_VOLUME_MULTIPLIER,frequency:800,seconds:1};
  return{gain:1,frequency:22050,seconds:1};
}

/** Retarget an in-progress fade from its current value, without a volume jump. */
export function fadeAudioParam(param:AudioParam,value:number,now:number,seconds:number):void {
  const current=param.value;
  if(typeof param.cancelAndHoldAtTime==='function')param.cancelAndHoldAtTime(now);
  else param.cancelScheduledValues(now);
  param.setValueAtTime(current,now);
  param.linearRampToValueAtTime(value,now+seconds);
}
