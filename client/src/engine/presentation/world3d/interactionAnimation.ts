import { clamp01, interactionEnvelope, timestampMs } from './actorAnimation';
import type { InteractionKind, InteractionPose } from './actorAnimation';
import type { PresentationEntity as Row } from './presentationEntity';

interface Action { kind: InteractionKind; at: number; duration: number }
const actions = new Map<string, Action>();
export function clearActorInteraction(player: string): void { actions.delete(player); }
export function recordActorInteraction(player: string, kind: InteractionKind, at = Date.now(), duration = 900): void {
  actions.delete(player); actions.set(player, { kind, at, duration });
  while (actions.size > 256) actions.delete(actions.keys().next().value!);
}
const owner = (value: unknown): string => typeof value === 'string' ? value : value && typeof value === 'object' && 'toHexString' in value ? (value as { toHexString(): string }).toHexString() : '';
const variant = (value: unknown): string => typeof value === 'string' ? value : value && typeof value === 'object' && 'tag' in value ? String(value.tag) : '';

/** Consume authoritative action/effect timestamps, never inventory-open state. */
export function actorInteraction(tables: Record<string, unknown>, id: string, player: Row, now: number): InteractionPose | undefined {
  const pose = (kind: InteractionKind, start: number, duration: number): InteractionPose | undefined => {
    const progress = (now - start) / duration;
    return start > 0 && progress >= 0 && progress < 1 ? { kind, progress, weight: interactionEnvelope(progress) } : undefined;
  };
  if (tables.activeConsumableEffects instanceof Map) for (const effect of tables.activeConsumableEffects.values() as Iterable<Row>) {
    if (owner(effect.playerId) !== id) continue;
    const type = variant(effect.effectType), start = timestampMs(effect.startedAt);
    const duration = Math.min(4000, Math.max(650, timestampMs(effect.endsAt) - start));
    const action = type === 'BandageBurst' || type === 'RemoteBandageBurst' ? pose('bandage', start, duration)
      : type === 'WaterDrinking' ? pose('drink', start, duration) : undefined;
    if (action) return action;
  }
  const recent = actions.get(id);
  const event = recent && pose(recent.kind, recent.at, recent.duration);
  if (event) return event;
  const food = pose('eat', timestampMs(player.lastConsumedAt), 1300);
  if (food) return food;
  const fishing = tables.fishingSessions instanceof Map ? tables.fishingSessions.get(id) as Row | undefined : undefined;
  if (fishing?.isActive) {
    const cast = pose('fish-cast', timestampMs(fishing.castTime), 1000);
    return cast ?? { kind: fishing.hasBite ? 'fish-reel' : 'fish-idle', progress: clamp01(((now - timestampMs(fishing.castTime)) % 1600) / 1600), weight: 1 };
  }
  return undefined;
}
