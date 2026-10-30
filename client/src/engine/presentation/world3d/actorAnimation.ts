/** Event times are milliseconds; pose phases are seconds or normalized 0..1. */
export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
export const smoothPhase = (value: number): number => { const t = clamp01(value); return t * t * (3 - 2 * t); };
export const timestampMs = (value?: { microsSinceUnixEpoch: bigint } | null): number => value ? Number(value.microsSinceUnixEpoch / 1000n) : 0;

export type InteractionKind = 'gather' | 'eat' | 'drink' | 'bandage' | 'fish-cast' | 'fish-idle' | 'fish-reel';
export interface InteractionPose { kind: InteractionKind; progress: number; weight: number }

/** A short attack has a fast kick and a slower, exact return to its aiming pose. */
export function recoilEnvelope(age: number): number {
  if (age < 0 || age >= .28 || !Number.isFinite(age)) return 0;
  return Math.sin(Math.min(1, age / .035) * Math.PI / 2) * (1 - smoothPhase((age - .035) / .245));
}

/** Release locally before the ammo row returns; the string briefly vibrates
 * around rest, then loading owns it again. */
export function bowDrawPhase(requested: number, shotAge: number): number {
  if (shotAge < 0 || shotAge >= .16 || !Number.isFinite(shotAge)) return clamp01(requested);
  return clamp01(1 - smoothPhase(shotAge / .055)
    + Math.sin(Math.max(0, shotAge - .055) * 130) * .04 * Math.exp(-shotAge * 20));
}

export function reloadPhase(startMs: bigint | number | undefined, durationSeconds: number, nowMs: number): number | undefined {
  const start = Number(startMs ?? 0), age = (nowMs - start) / 1000;
  if (!start || age < 0 || age >= durationSeconds) return undefined;
  return clamp01(age / Math.max(.1, durationSeconds));
}

/** Shared by reload hands and the detached/inserted magazine, with dwell phases. */
export function reloadHandPhase(progress: number): { lower: number; pocket: number; rack: number } {
  const p = clamp01(progress);
  return {
    lower: smoothPhase(p / .16) * (1 - smoothPhase((p - .83) / .17)),
    pocket: smoothPhase((p - .18) / .18) * (1 - smoothPhase((p - .52) / .2)),
    rack: smoothPhase((p - .72) / .08) * (1 - smoothPhase((p - .86) / .09)),
  };
}

export function interactionEnvelope(progress: number): number {
  return smoothPhase(progress / .18) * (1 - smoothPhase((progress - .78) / .22));
}

/** Same source timestamp gives the same windup, contact and recovery at any FPS. */
export function animalAttackPhase(age: number, duration: number): { prepare: number; strike: number; recover: number } {
  if (age < 0 || age >= duration) return { prepare: 0, strike: 0, recover: 0 };
  const p = age / duration;
  return {
    prepare: smoothPhase(p / .24) * (1 - smoothPhase((p - .26) / .12)),
    strike: smoothPhase((p - .24) / .18) * (1 - smoothPhase((p - .52) / .35)),
    recover: smoothPhase((p - .52) / .48),
  };
}

const predictedShots = new Map<string, { id: string; at: number }>();
export function recordPredictedRangedShot(player: string, id: string, at = Date.now()): void {
  predictedShots.delete(player); predictedShots.set(player, { id, at });
  while (predictedShots.size > 256) predictedShots.delete(predictedShots.keys().next().value!);
}

interface ShotState { weapon: string; server: number; prediction: string; predictedAt: number; firedAt: number }
/** Local shots react immediately. A later server confirmation does not repeat
 * the kick; fresh remote shots get a visible flash even after network delay. */
export class RangedAnimationTimeline {
  private readonly states = new Map<string, ShotState>();
  private lastTime = -Infinity;
  age(player: string, weapon: string, serverStamp: number, now: number): number {
    if (now < this.lastTime) this.states.clear();
    this.lastTime = now;
    let state = this.states.get(player);
    const predicted = predictedShots.get(player);
    if (!state || state.weapon !== weapon) {
      state = { weapon, server: 0, prediction: '', predictedAt: -Infinity, firedAt: -Infinity };
      this.states.set(player, state);
    }
    if (predicted && predicted.id !== state.prediction) {
      state.prediction = predicted.id;
      if (now >= predicted.at && now - predicted.at < 500) { state.firedAt = predicted.at; state.predictedAt = predicted.at; }
    }
    if (serverStamp > state.server && now >= serverStamp && now - serverStamp < 650 && now - state.predictedAt >= 650) {
      state.firedAt = now - Math.min(35, now - serverStamp);
    }
    if (now >= serverStamp) state.server = serverStamp;
    while (this.states.size > 512) this.states.delete(this.states.keys().next().value!);
    return (now - state.firedAt) / 1000;
  }
  clear(): void { this.states.clear(); this.lastTime = -Infinity; }
}
