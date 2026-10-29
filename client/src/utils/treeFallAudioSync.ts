export interface TreeFallPlayback { startedAt: number; playbackRate: number }

// A bounded, short-lived bridge from spatial audio to the world presentation.
// Positions are the authoritative tree/sound coordinates from the same reducer.
const recent = new Map<string, TreeFallPlayback>();
const key = (x:number,y:number) => `${x.toFixed(1)},${y.toFixed(1)}`;

export function recordTreeFallPlayback(x:number,y:number,playbackRate:number,startedAt=Date.now()):void {
  for(const [id,playback] of recent)if(startedAt-playback.startedAt>6000)recent.delete(id);
  const id=key(x,y);recent.delete(id);recent.set(id,{startedAt,playbackRate});
  while(recent.size>256)recent.delete(recent.keys().next().value!);
}

export function treeFallPlayback(x:number,y:number,fallStartedAt:number):TreeFallPlayback|undefined {
  const playback=recent.get(key(x,y));
  return playback && Math.abs(playback.startedAt-fallStartedAt)<=1000 ? playback : undefined;
}
