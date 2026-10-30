import type { DbConnection } from '../../generated';
import type { GrassState } from '../../generated/types';
import { isGrassDestructionDelete } from '../presentation/world3d/presentationEffectEvents';

/** A filtered live-only subscription reports cuts as deletes; an unfiltered
 * subscription reports the same transition as an update. */
export function bindGrassCutEvents(connection: DbConnection, onCut: (state: GrassState) => void): () => void {
  const deleted = (ctx: unknown, state: GrassState) => { if (isGrassDestructionDelete(ctx)) onCut(state); };
  const updated = (_ctx: unknown, oldState: GrassState, newState: GrassState) => {
    if (oldState.isAlive && !newState.isAlive) onCut(newState);
  };
  connection.db.grass_state.onDelete(deleted); connection.db.grass_state.onUpdate(updated);
  return () => { connection.db.grass_state.removeOnDelete(deleted); connection.db.grass_state.removeOnUpdate(updated); };
}
