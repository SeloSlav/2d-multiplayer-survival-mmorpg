import type { DbConnection } from '../../generated';
import type { Barrel } from '../../generated/types';
import { isGrassDestructionDelete, recordWorldBarrelBreak } from '../presentation/world3d/presentationEffectEvents';

/** Feed both renderers from actual destruction. Initial dead snapshots and
 * subscription eviction must never explode intact scenery. */
export function bindBarrelBreakEvents(connection: DbConnection, legacyBreak: (barrel: Barrel) => void): () => void {
  const broken = (barrel: Barrel) => {
    if (barrel.variant === 6) return;
    const deathKey = String(barrel.respawnAt?.microsSinceUnixEpoch || barrel.lastHitTime?.microsSinceUnixEpoch || Date.now());
    recordWorldBarrelBreak(String(barrel.id), barrel.posX, barrel.posY, barrel.variant, deathKey);
    legacyBreak(barrel);
  };
  const updated = (context: unknown, oldBarrel: Barrel, newBarrel: Barrel) => {
    const alive = oldBarrel.health > 0 && (oldBarrel.respawnAt?.microsSinceUnixEpoch ?? 0n) === 0n;
    const dead = newBarrel.health <= 0 || (newBarrel.respawnAt?.microsSinceUnixEpoch ?? 0n) !== 0n;
    if (isGrassDestructionDelete(context) && alive && dead) broken(newBarrel);
  };
  const deleted = (context: unknown, barrel: Barrel) => { if (isGrassDestructionDelete(context)) broken(barrel); };
  connection.db.barrel.onUpdate(updated); connection.db.barrel.onDelete(deleted);
  return () => { connection.db.barrel.removeOnUpdate(updated); connection.db.barrel.removeOnDelete(deleted); };
}
