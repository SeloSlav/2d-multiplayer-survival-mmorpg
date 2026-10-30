export interface WorldExplosion { sequence: number; id: string; x: number; y: number; radius: number; heavy: boolean; at: number }
const explosions: WorldExplosion[] = [];
let sequence = 0;
export interface WorldItemBreak { sequence: number; id: string; x: number; y: number; at: number }
const itemBreaks: WorldItemBreak[] = [];
let itemBreakSequence = 0;

export function recordWorldItemBreak(id: string, x: number, y: number, at = Date.now()): void {
  if (itemBreaks.some(event => event.id === id)) return;
  itemBreaks.push({ sequence: ++itemBreakSequence, id, x, y, at });
  while (itemBreaks.length > 64) itemBreaks.shift();
}

export function worldItemBreaksAfter(cursor: number, now: number): WorldItemBreak[] {
  return itemBreaks.filter(event => event.sequence > cursor && now >= event.at && now - event.at < 780);
}

export function isLiveDetonation(context: unknown, explosive: { isDud: boolean; detonatesAt?: { microsSinceUnixEpoch: bigint } | null }, now = Date.now()): boolean {
  const event = (context as { event?: { tag?: string; type?: string } } | null)?.event;
  const type = event?.tag ?? event?.type;
  const due = explosive.detonatesAt ? Number(explosive.detonatesAt.microsSinceUnixEpoch / 1000n) : Infinity;
  return !explosive.isDud && type !== 'UnsubscribeApplied' && type !== 'SubscribeApplied' && due <= now + 250 && now - due < 3000;
}

/** Successful server detonation deletes feed both renderers. Stream eviction,
 * subscribe snapshots and duds never become visual explosions. */
export function recordWorldExplosion(id: string, x: number, y: number, radius: number, heavy: boolean, at = Date.now()): void {
  if (explosions.some(event => event.id === id && Math.abs(at - event.at) < 3000)) return;
  explosions.push({ sequence: ++sequence, id, x, y, radius, heavy, at });
  while (explosions.length > 32) explosions.shift();
}

export function worldExplosionsAfter(cursor: number, now: number): WorldExplosion[] {
  return explosions.filter(event => event.sequence > cursor && now >= event.at && now - event.at < 2600);
}
