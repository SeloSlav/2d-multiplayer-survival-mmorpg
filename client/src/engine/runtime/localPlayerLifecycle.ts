import type { DbConnection } from '../../generated';
import type { Player } from '../../generated/types';
import { runtimeEngine } from '../runtimeEngine';

// A reducer can reject after the server has killed us but before React has
// observed the player update. Keep that confirmation until a *new life* arrives.
const confirmedDeaths = new WeakMap<DbConnection, Map<string, bigint>>();
const respawnTime = (player: Player): bigint => player.lastRespawnTime?.microsSinceUnixEpoch ?? 0n;

export function reconcilePlayerLife(connection: DbConnection | undefined, player: Player): Player {
  if (!connection) return player;
  let deaths = confirmedDeaths.get(connection);
  const id = player.identity.toHexString();
  if (player.isDead) {
    if (!deaths) confirmedDeaths.set(connection, deaths = new Map());
    deaths.set(id, respawnTime(player));
    return player;
  }
  const confirmedLife = deaths?.get(id);
  if (confirmedLife === undefined) return player;
  if (respawnTime(player) > confirmedLife) {
    deaths!.delete(id);
    return player;
  }
  return { ...player, isDead: true, isSprinting: false };
}

function publishPlayerLife(connection: DbConnection, player: Player): void {
  // A response from an old connection must never change the current session.
  if (runtimeEngine.getSnapshot().connection.connection !== connection) return;
  const id = player.identity.toHexString();
  runtimeEngine.updateWorldTable<Map<string, Player>>('players', current => {
    const previous = current?.get(id);
    if (previous && previous.isDead === player.isDead
      && previous.isKnockedOut === player.isKnockedOut
      && respawnTime(previous) === respawnTime(player)) return current!;
    return new Map(current).set(id, player);
  });
}

/** Read the SDK cache at action time, without waiting for a React effect. */
export function readLocalPlayerLife(
  connection: DbConnection | null | undefined,
  fallback: Player | null | undefined,
): Player | null | undefined {
  if (!connection || !fallback) return fallback;
  const cached = connection.db.player?.identity.find(fallback.identity) ?? fallback;
  const player = reconcilePlayerLife(connection, cached);
  publishPlayerLife(connection, player);
  return player;
}

/** Returns true only for the server's explicit death rejections. */
export function recoverRejectedPlayerLife(error: unknown, connection: DbConnection, sentPlayer: Player): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (message !== 'Player is dead' && message !== 'Dead players cannot fire projectiles') return false;
  if (runtimeEngine.getSnapshot().connection.connection !== connection) return true;

  const current = connection.db.player?.identity.find(sentPlayer.identity) ?? sentPlayer;
  const published = (runtimeEngine.getSnapshot().world.tables.players as Map<string, Player> | undefined)
    ?.get(sentPlayer.identity.toHexString());
  // An in-flight action from before respawn may fail after respawn succeeds.
  if (respawnTime(current) > respawnTime(sentPlayer)
    || (published && respawnTime(published) > respawnTime(sentPlayer))) return true;

  let deaths = confirmedDeaths.get(connection);
  if (!deaths) confirmedDeaths.set(connection, deaths = new Map());
  deaths.set(sentPlayer.identity.toHexString(), respawnTime(sentPlayer));
  publishPlayerLife(connection, reconcilePlayerLife(connection, current));
  return true;
}

/** Catch both asynchronous rejections and synchronous dispatch failures. */
export function sendAlivePlayerAction(
  connection: DbConnection,
  fallback: Player | null | undefined,
  send: (player: Player) => Promise<unknown>,
  onFailure: (error: unknown) => void,
): void {
  const player = readLocalPlayerLife(connection, fallback);
  if (!player || player.isDead || player.isKnockedOut) return;
  const onRejected = (error: unknown) => {
    if (!recoverRejectedPlayerLife(error, connection, player)) onFailure(error);
  };
  try {
    void send(player).catch(onRejected);
  } catch (error) {
    onRejected(error);
  }
}
