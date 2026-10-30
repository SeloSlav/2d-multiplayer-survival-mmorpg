import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'spacetimedb';
import { runtimeEngine } from '../client/src/engine/runtimeEngine.ts';
import { movementPredictionRuntime } from '../client/src/engine/runtime/movementPredictionRuntime.ts';
import { createCombatTableBindings } from '../client/src/engine/adapters/spacetime/worldAndCombatTableBindings.ts';
import { readLocalPlayerLife, recoverRejectedPlayerLife, sendAlivePlayerAction } from '../client/src/engine/runtime/localPlayerLifecycle.ts';

const playerId = 'death-regression';
const makePlayer = (overrides = {}) => ({
  identity: { toHexString: () => playerId },
  positionX: 4000, positionY: 4000, direction: 'right',
  health: 100, stamina: 100, hunger: 100, thirst: 100, warmth: 100,
  isDead: false, isKnockedOut: false, isSprinting: false, isCrouching: false, isOnWater: false,
  jumpStartTimeMs: 0n, clientMovementSequence: 0n, lastRespawnTime: new Timestamp(1000n),
  ...overrides,
});
const entities = () => Object.fromEntries([
  'trees', 'stones', 'runeStones', 'cairns', 'boxes', 'rainCollectors', 'furnaces', 'barbecues',
  'shelters', 'players', 'wildAnimals', 'barrels', 'seaStacks', 'wallCells', 'foundationCells',
  'homesteadHearths', 'basaltColumns', 'doors', 'livingCorals', 'monumentParts',
].map(key => [key, new Map()]));
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function setup(t) {
  const alive = makePlayer();
  let cached = alive;
  const sent = [];
  const connection = {
    db: { player: { identity: { find: () => cached } }, active_consumable_effect: { iter: () => [] } },
    reducers: { updatePlayerPositionSimple: args => { sent.push(args); return Promise.resolve(); } },
  };
  runtimeEngine.setConnection(connection, playerId);
  runtimeEngine.updateWorldTable('players', () => new Map([[playerId, alive]]));
  movementPredictionRuntime.reset();
  const config = {
    connection, localPlayer: alive, inputState: { direction: { x: 1, y: 0 }, sprinting: false },
    isUIFocused: false, entities: entities(), isAutoWalking: false, stopAutoWalk: () => {}, isAutoAttacking: false,
  };
  t.after(() => {
    movementPredictionRuntime.reset();
    runtimeEngine.setConnection(null, null);
    runtimeEngine.updateWorldTable('players', () => new Map());
  });
  return {
    alive, connection, config, sent,
    cache: player => { cached = player; },
    published: () => runtimeEngine.getSnapshot().world.tables.players.get(playerId),
  };
}

test('missed player callback still shows death and stops movement before React reconfigures', t => {
  const env = setup(t);
  movementPredictionRuntime.configure(env.config);
  env.cache(makePlayer({ isDead: true, health: 0, positionX: 4050 }));
  movementPredictionRuntime.stepPredictedMovement(20);
  assert.equal(env.sent.length, 0);
  assert.equal(env.published().isDead, true, 'the existing DeathScreen selector sees the recovered player');
  assert.deepEqual(movementPredictionRuntime.getCurrentPositionNow(), { x: 4050, y: 4000 });
});

test('movement death rejection recovers the respawn screen even while the SDK cache is stale', async t => {
  const env = setup(t);
  env.connection.reducers.updatePlayerPositionSimple = args => {
    env.sent.push(args);
    return Promise.reject(new Error('Player is dead'));
  };
  movementPredictionRuntime.configure(env.config);
  movementPredictionRuntime.lastSentTime = -Infinity;
  movementPredictionRuntime.stepPredictedMovement(20);
  await flush();
  assert.equal(env.published().isDead, true);
  movementPredictionRuntime.configure(env.config);
  assert.equal(movementPredictionRuntime.wasDead, true, 'stale React effects cannot simulate a respawn');
  movementPredictionRuntime.lastSentTime = -Infinity;
  movementPredictionRuntime.stepPredictedMovement(20);
  assert.equal(env.sent.length, 1, 'confirmed death stops retries with stale alive props');
});

test('queued player batches cannot overwrite a confirmed death, but a new life clears it', t => {
  const env = setup(t);
  recoverRejectedPlayerLife(new Error('Player is dead'), env.connection, env.alive);
  const refs = {
    playersRef: { current: new Map([[playerId, env.alive]]) },
    lastPlayerRenderTimeRef: { current: performance.now() },
    playerRenderPendingRef: { current: false }, playerRenderTimerRef: { current: null },
  };
  const bindings = createCombatTableBindings({
    ...refs, connection: env.connection, connectionIdentity: env.alive.identity,
    setPlayers: players => runtimeEngine.updateWorldTable('players', () => players),
  });
  bindings.player.onUpdate({}, env.alive, { ...env.alive, health: 90 });
  assert.equal(env.published().isDead, true);
  const respawned = makePlayer({ lastRespawnTime: new Timestamp(2000n) });
  env.cache(respawned);
  bindings.player.onUpdate({}, makePlayer({ isDead: true }), respawned);
  assert.equal(env.published().isDead, false);
  assert.equal(readLocalPlayerLife(env.connection, env.alive).isDead, false);
  // A missed local callback can leave an older row in the pending batch.
  refs.playersRef.current.set(playerId, makePlayer({ isDead: true }));
  const other = makePlayer({ identity: { toHexString: () => 'other-player' } });
  bindings.player.onUpdate({}, other, { ...other, health: 90 });
  assert.equal(env.published().isDead, false, 'another player update must not restore our old corpse');
  assert.equal(env.published().lastRespawnTime.microsSinceUnixEpoch, 2000n);
});

test('death cancels an optimistic dodge and respawn resets position', t => {
  const env = setup(t);
  movementPredictionRuntime.configure(env.config);
  assert.equal(movementPredictionRuntime.triggerOptimisticDodgeRoll(1, 0), true);
  env.cache(makePlayer({ isDead: true, positionX: 4020 }));
  movementPredictionRuntime.stepPredictedMovement(20);
  assert.equal(movementPredictionRuntime.getCurrentDodgeRollVisualNow().isDodgeRolling, false);
  assert.equal(movementPredictionRuntime.triggerOptimisticDodgeRoll(1, 0), false);
  const respawned = makePlayer({ lastRespawnTime: new Timestamp(2000n), positionX: 6000, positionY: 7000 });
  env.cache(respawned);
  movementPredictionRuntime.configure({ ...env.config, localPlayer: respawned, inputState: { direction: { x: 0, y: 0 }, sprinting: false } });
  movementPredictionRuntime.stepPredictedMovement(20);
  assert.deepEqual(movementPredictionRuntime.getCurrentPositionNow(), { x: 6000, y: 7000 });
  assert.equal(env.published().isDead, false);
});

test('ranged dispatch blocks cached dead and knocked-out players despite stale React props', t => {
  const env = setup(t);
  let shots = 0;
  const fire = () => { shots++; return Promise.resolve(); };
  for (const state of [{ isKnockedOut: true }, { isDead: true }]) {
    env.cache(makePlayer(state));
    sendAlivePlayerAction(env.connection, env.alive, fire, assert.fail);
  }
  assert.equal(shots, 0);
  assert.equal(env.published().isDead, true);
});

test('a shot racing death is handled and recovers the respawn screen without an unhandled rejection', async t => {
  const env = setup(t);
  let rejectShot;
  sendAlivePlayerAction(env.connection, env.alive,
    () => new Promise((_, reject) => { rejectShot = reject; }), assert.fail);
  rejectShot(new Error('Dead players cannot fire projectiles'));
  await flush();
  assert.equal(env.published().isDead, true);
  sendAlivePlayerAction(env.connection, env.alive, () => assert.fail('must stop firing'), assert.fail);
});

test('late death rejection from an earlier life cannot kill a respawned player', async t => {
  const env = setup(t);
  let rejectShot;
  sendAlivePlayerAction(env.connection, env.alive,
    () => new Promise((_, reject) => { rejectShot = reject; }), assert.fail);
  const respawned = makePlayer({ lastRespawnTime: new Timestamp(2000n) });
  env.cache(respawned);
  readLocalPlayerLife(env.connection, env.alive);
  rejectShot(new Error('Dead players cannot fire projectiles'));
  await flush();
  assert.equal(env.published().isDead, false);
  assert.equal(readLocalPlayerLife(env.connection, respawned).isDead, false);
});

test('old connections and unrelated reducer failures do not change player life', async t => {
  const env = setup(t);
  const failures = [];
  sendAlivePlayerAction(env.connection, env.alive, () => Promise.reject(new Error('Out of ammo')), error => failures.push(error.message));
  sendAlivePlayerAction(env.connection, env.alive, () => { throw new Error('Disconnected'); }, error => failures.push(error.message));
  await flush();
  assert.deepEqual(failures.sort(), ['Disconnected', 'Out of ammo']);
  assert.equal(env.published().isDead, false);
  runtimeEngine.setConnection({}, playerId);
  assert.equal(recoverRejectedPlayerLife(new Error('Player is dead'), env.connection, env.alive), true);
  assert.equal(env.published().isDead, false);
});
