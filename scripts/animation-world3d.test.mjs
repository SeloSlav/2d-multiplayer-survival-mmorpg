import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Group, Matrix4, Mesh, OrthographicCamera, Scene, Vector3 } from 'three/webgpu';
import { ModelKit } from '../client/src/engine/presentation/world3d/modelKit.ts';
import { SurvivorRig } from '../client/src/engine/presentation/world3d/survivor.ts';
import { AnimalRig } from '../client/src/engine/presentation/world3d/animalRigs.ts';
import { createTree } from '../client/src/engine/presentation/world3d/treeModels.ts';
import { createPlant } from '../client/src/engine/presentation/world3d/plantModels.ts';
import { WebGpuWorldRenderer } from '../client/src/engine/presentation/world3d/WebGpuWorldRenderer.ts';
import { actorInteraction, recordActorInteraction } from '../client/src/engine/presentation/world3d/interactionAnimation.ts';
import { bowDrawPhase, RangedAnimationTimeline, recoilEnvelope, recordPredictedRangedShot, reloadPhase } from '../client/src/engine/presentation/world3d/actorAnimation.ts';
import { GROUND_Y_SCALE } from '../client/src/engine/presentation/world3d/visualContract.ts';
import { FootContactEffects3d } from '../client/src/engine/presentation/world3d/FootContactEffects3d.ts';
import { ProjectileWorld3d, projectileScenePosition } from '../client/src/engine/presentation/world3d/ProjectileWorld3d.ts';
import { StaticWorldBatches } from '../client/src/engine/presentation/world3d/StaticWorldBatches.ts';
import { ExplosionEffects3d } from '../client/src/engine/presentation/world3d/ExplosionEffects3d.ts';
import { FishingEffects3d } from '../client/src/engine/presentation/world3d/FishingEffects3d.ts';
import { isLiveDetonation, recordWorldExplosion } from '../client/src/engine/presentation/world3d/presentationEffectEvents.ts';
import { sampleProjectileState } from '../client/src/utils/projectileSampling.ts';
import { WORLD_3D, worldToScene } from '../client/src/engine/presentation/world3d/visualContract.ts';

const rest = { speed: 0, sprinting: false, crouching: false, swimming: false, dead: false, jump: 0, roll: 0, attack: 0, yaw: 0, weapon: '' };
const stamp = ms => ({ microsSinceUnixEpoch: BigInt(ms) * 1000n });

test('local shot prediction and remote confirmations produce one readable recoil per shot', () => {
  const timeline = new RangedAnimationTimeline(), now = 700000;
  recordPredictedRangedShot('local-shot', 'shot-a', now);
  assert.equal(timeline.age('local-shot', 'Makarov PM', 0, now), 0);
  assert.equal(timeline.age('local-shot', 'Makarov PM', now + 30, now + 70), .07, 'confirmation does not restart the predicted flash');
  assert.equal(timeline.age('remote-shot', 'Makarov PM', now, now + 160), .035, 'a fresh remote shot is visible after network transit');
  assert.equal(timeline.age('remote-shot', 'Makarov PM', now, now + 500), .375, 'an unchanged server timestamp never repeats');
  assert.equal(timeline.age('stale-shot', 'Makarov PM', now - 5000, now), Infinity, 'entering view does not replay old shots');
});

test('ranged shots recoil with attached hands, flash at the muzzle and return to the exact ready pose', () => {
  const kit = new ModelKit();
  for (const weapon of ['Makarov PM', 'PP-91 KEDR', 'Rifle', 'Shotgun']) {
    const rig = new SurvivorRig(kit), wrapper = new Group(); wrapper.scale.z = GROUND_Y_SCALE; wrapper.add(rig.root);
    rig.update({ ...rest, weapon }, .016, 1); wrapper.updateMatrixWorld(true);
    const model = rig.root.getObjectByName('held-weapon'), grip = model.getObjectByName('primary-grip');
    const ready = grip.getWorldPosition(new Vector3());
    rig.update({ ...rest, weapon, shotAge: .035 }, .016, 1.035); wrapper.updateMatrixWorld(true);
    assert.equal(rig.muzzleFlash.visible, true, `${weapon}: flash is visible during the shot`);
    assert.ok(grip.getWorldPosition(new Vector3()).distanceTo(ready) > .025, `${weapon}: the gun visibly kicks`);
    assert.ok(grip.getWorldPosition(new Vector3()).distanceTo(rig.root.getObjectByName('right-hand').getWorldPosition(new Vector3())) < .001);
    const muzzle = model.getObjectByName('muzzle');
    assert.ok(rig.muzzleFlash.getWorldPosition(new Vector3()).distanceTo(muzzle.getWorldPosition(new Vector3())) < .001);
    rig.update({ ...rest, weapon, shotAge: .4 }, .016, 1.4); wrapper.updateMatrixWorld(true);
    assert.equal(rig.muzzleFlash.visible, false);
    assert.ok(grip.getWorldPosition(new Vector3()).distanceTo(ready) < .02, `${weapon}: recoil does not accumulate`);
  }
  assert.equal(recoilEnvelope(-1), 0); assert.equal(recoilEnvelope(Infinity), 0); assert.equal(recoilEnvelope(1), 0);
  kit.dispose();
});

test('reload hands visit the belt and weapon action while the primary grip stays attached', () => {
  const kit = new ModelKit();
  for (const weapon of ['Makarov PM', 'PP-91 KEDR', 'Crossbow']) {
    const rig = new SurvivorRig(kit), positions = [];
    for (const progress of [0, .2, .45, .67, .8, .99]) {
      rig.update({ ...rest, weapon, reloadProgress: progress }, .016, progress);
      rig.root.updateMatrixWorld(true);
      positions.push(rig.root.getObjectByName('left-hand').getWorldPosition(new Vector3()));
      const model = rig.root.getObjectByName('held-weapon');
      assert.ok(model.getObjectByName('primary-grip').getWorldPosition(new Vector3()).distanceTo(rig.root.getObjectByName('right-hand').getWorldPosition(new Vector3())) < .001);
    }
    assert.ok(positions[2].distanceTo(positions[0]) > .12, `${weapon}: reload is a hand action, not only a weapon tilt`);
    assert.ok(positions[4].distanceTo(positions[2]) > .12, `${weapon}: hand returns to rack/seat the weapon`);
  }
  assert.equal(reloadPhase(1000, 2, 900), undefined);
  assert.equal(reloadPhase(1000, 2, 2000), .5);
  assert.equal(reloadPhase(1000, 2, 3000), undefined, 'a retained server timestamp cannot loop the reload');
  kit.dispose();
});

test('the bow string, nock and drawing hand move together through loading and release', () => {
  const kit = new ModelKit(), rig = new SurvivorRig(kit);
  for (const draw of [0, .25, .5, .75, 1, .2, 0]) {
    rig.update({ ...rest, weapon: 'Hunting Bow', bowDraw: draw, loaded: draw > 0 }, .016, 1);
    rig.root.updateMatrixWorld(true);
    const model = rig.root.getObjectByName('held-weapon');
    const nock = model.localToWorld(new Vector3(0, 0, -.3 * draw));
    assert.ok(nock.distanceTo(rig.root.getObjectByName('right-hand').getWorldPosition(new Vector3())) < .025);
    for (const name of ['bow-string-upper', 'bow-string-lower']) {
      const string = model.getObjectByName(name);
      const endpoint = string.localToWorld(new Vector3(0, .5, 0));
      assert.ok(endpoint.distanceTo(nock) < 1e-5, 'string endpoint stays on the moving nock');
    }
    assert.equal(model.getObjectByName('loaded-projectile').visible, draw > 0);
  }
  const released = [];
  for (const shotAge of [0, .02, .04, .06, .1]) {
    rig.update({ ...rest, weapon: 'Hunting Bow', bowDraw: 1, loaded: true, shotAge }, .016, 2 + shotAge);
    rig.root.updateMatrixWorld(true);
    const model = rig.root.getObjectByName('held-weapon'), draw = bowDrawPhase(1, shotAge);
    const nock = model.localToWorld(new Vector3(0, 0, -.3 * draw));
    assert.ok(nock.distanceTo(rig.root.getObjectByName('right-hand').getWorldPosition(new Vector3())) < .025);
    released.push(draw);
    if (shotAge >= .02) assert.equal(model.getObjectByName('loaded-projectile').visible, false, 'shot prediction removes the arrow before server ammo confirmation');
  }
  assert.equal(released[0], 1); assert.ok(released[2] < .25); assert.ok(released[3] < .02);
  rig.update({ ...rest, weapon: 'Hunting Bow', bowDraw: 1, loaded: true, shotAge: .5 }, .016, 2.5);
  assert.equal(rig.root.userData.animation.bowDraw, 0, 'a delayed ammo row cannot redraw the released string');
  assert.equal(rig.root.getObjectByName('loaded-projectile').visible, false);
  rig.update({ ...rest, weapon: 'Hunting Bow', bowDraw: .4, reloadProgress: .4, loaded: false, shotAge: 1 }, .016, 3);
  assert.equal(rig.root.userData.animation.bowDraw, .4, 'the next reload can draw normally');
  kit.dispose();
});

test('knockdown, death and get-up are smooth, finite, grounded and restore an upright survivor', () => {
  const kit = new ModelKit(), rig = new SurvivorRig(kit), body = rig.root.getObjectByName('survivor-body');
  rig.update(rest, .016, 0);
  let last = -1;
  for (const age of [0, .1, .3, .5, .72, 1]) {
    rig.update({ ...rest, knockedOut: true, downAge: age }, .016, age);
    assert.ok(body.rotation.z >= last && Number.isFinite(body.position.y)); last = body.rotation.z;
    assert.equal(rig.root.position.length(), 0, 'collapse never moves the ground/collision origin');
  }
  assert.equal(body.rotation.z, Math.PI / 2);
  rig.update(rest, .016, 2);
  const down = body.rotation.z;
  rig.update(rest, .016, 2.5); assert.ok(body.rotation.z > 0 && body.rotation.z < down);
  rig.update(rest, .016, 3.2); assert.equal(body.rotation.z, 0); assert.equal(rig.root.userData.animation.lifeAmount, 0);
  rig.update({ ...rest, dead: true, downAge: 500 }, .016, 4); assert.equal(body.rotation.z, Math.PI / 2, 'old corpses are already settled');
  kit.dispose();
});

test('consumption, bandaging, gathering and fishing poses are driven by fresh gameplay state', () => {
  const now = 500000, id = 'animation-actions', player = { lastConsumedAt: stamp(now - 500) };
  assert.equal(actorInteraction({}, id, player, now).kind, 'eat');
  assert.equal(actorInteraction({}, id, player, now + 2000), undefined);
  const effects = new Map([['water', { playerId: id, startedAt: stamp(now - 300), endsAt: stamp(now + 900), effectType: { tag: 'WaterDrinking' } }]]);
  assert.equal(actorInteraction({ activeConsumableEffects: effects }, id, {}, now).kind, 'drink');
  effects.set('water', { ...effects.get('water'), effectType: { tag: 'BandageBurst' } });
  assert.equal(actorInteraction({ activeConsumableEffects: effects }, id, {}, now).kind, 'bandage');
  recordActorInteraction(id, 'gather', now - 300);
  assert.equal(actorInteraction({}, id, {}, now).kind, 'gather');
  const fishing = { isActive: true, castTime: stamp(now - 200), hasBite: false };
  assert.equal(actorInteraction({ fishingSessions: new Map([[id, fishing]]) }, id, {}, now + 1500).kind, 'fish-idle');
  fishing.hasBite = true;
  assert.equal(actorInteraction({ fishingSessions: new Map([[id, fishing]]) }, id, {}, now + 1500).kind, 'fish-reel');
  const kit = new ModelKit(), rig = new SurvivorRig(kit);
  for (const kind of ['gather', 'eat', 'drink', 'bandage', 'fish-cast', 'fish-reel']) {
    rig.update({ ...rest, weapon: kind.startsWith('fish') ? 'Primitive Reed Fishing Rod' : '', interaction: { kind, progress: .5, weight: 1 } }, .016, now / 1000);
    assert.equal(rig.root.userData.animation.state, kind);
    assert.ok(rig.root.getObjectByName('right-hand').position.toArray().every(Number.isFinite));
  }
  rig.update(rest, .016, now / 1000 + 1);
  assert.equal(rig.root.getObjectByName('interaction-props').visible, false, 'temporary food/cup/bandage props are cleared');
  kit.dispose();
});

test('animal idle behaviour varies by species, attends to targets and prepares before lunging', () => {
  const kit = new ModelKit(), grazer = new AnimalRig(kit, 'Caribou'), wolf = new AnimalRig(kit, 'TundraWolf');
  grazer.update(0, 0, .016, 5, false, false, { state: 'Idle' });
  assert.equal(grazer.root.userData.animation.state, 'graze');
  wolf.update(0, 0, .016, 5, false, false, { state: 'Idle' }); assert.equal(wolf.root.userData.animation.state, 'sniff');
  const head = wolf.root.getObjectByName('animal-head');
  wolf.update(0, 0, .016, 6, false, false, { state: 'Investigating', lookYaw: .6, alertAge: 1 });
  assert.ok(head.rotation.y > .4); assert.equal(wolf.root.userData.animation.state, 'alert');
  wolf.update(0, 0, .016, 6.1, false, false, { state: 'Attacking', attackAge: .1 });
  assert.equal(wolf.root.userData.animation.state, 'attack-prepare'); const windup = wolf.body.position.z;
  wolf.update(0, 0, .016, 6.3, false, false, { state: 'Attacking', attackAge: .3 });
  assert.equal(wolf.root.userData.animation.state, 'attack'); assert.ok(wolf.body.position.z > windup);
  wolf.update(0, 0, .016, 7, false, false, { deathAge: 2 });
  assert.equal(wolf.root.userData.animation.state, 'corpse');
  kit.dispose();
});

test('gathering bends the waist and knees with planted boots and releases the free hand from the gun', () => {
  const kit = new ModelKit(), rig = new SurvivorRig(kit), wrapper = new Group();
  wrapper.scale.z = GROUND_Y_SCALE; wrapper.add(rig.root);
  rig.update({ ...rest, weapon: 'PP-91 KEDR' }, .016, 1); wrapper.updateMatrixWorld(true);
  const readyHand = rig.root.getObjectByName('left-hand').getWorldPosition(new Vector3());
  rig.update({ ...rest, weapon: 'PP-91 KEDR', interaction: { kind: 'gather', progress: .5, weight: 1 } }, .016, 1.1);
  wrapper.updateMatrixWorld(true);
  const left = rig.root.getObjectByName('left-hand').getWorldPosition(new Vector3());
  const right = rig.root.getObjectByName('right-hand').getWorldPosition(new Vector3());
  assert.ok(left.y < readyHand.y - .25, 'free hand rests rather than supporting an invisible gun');
  assert.ok(right.y < .65 && right.z > .25, 'gather hand reaches below the waist');
  for (const side of ['left', 'right']) assert.ok(Math.abs(new Box3().setFromObject(rig.root.getObjectByName(`${side}-knee`)).min.y) < 1e-5, 'the lowest boot surface remains planted');
  assert.ok(rig.root.getObjectByName('survivor-torso').rotation.x > .5);
  assert.equal(rig.root.getObjectByName('held-weapon').visible, false);
  rig.update({ ...rest, weapon: 'PP-91 KEDR' }, .016, 2);
  assert.equal(rig.root.getObjectByName('survivor-torso').rotation.x, 0);
  assert.equal(rig.root.getObjectByName('left-knee').rotation.x, 0);
  kit.dispose();
});

test('vegetation wind keeps ground roots and leaf petioles fixed and retains production batching', () => {
  const kit = new ModelKit();
  for (const model of [createTree(kit, 'SiberianBirch', 3), createTree(kit, 'DwarfPine', 5), createPlant(kit, 'BorealNettle', 2)]) {
    assert.ok(model.userData.vegetation);
    let weights = 0, leaves = 0;
    model.traverse(mesh => {
      if (!(mesh instanceof Mesh)) return;
      const p = mesh.geometry.getAttribute('position'), wind = mesh.geometry.getAttribute('windData');
      assert.equal(wind.count, p.count);
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) <= 0) assert.equal(wind.getX(i), 0, 'roots never drift');
        assert.ok(wind.getX(i) >= 0 && wind.getX(i) <= 1);
        weights += wind.getX(i); leaves += wind.getY(i);
      }
    });
    assert.ok(weights > 0);
    if (model.userData.treeSpecies !== 'DwarfPine') assert.ok(leaves > 0, 'broad leaves retain their petiole-to-tip flutter weights');
    const compiled = kit.compileColored(model);
    assert.equal(compiled.children.length, 1); assert.equal(compiled.children[0].material, kit.wind.material);
    assert.ok(compiled.children[0].geometry.hasAttribute('windData'));
  }
  const pile = kit.compileColored(createPlant(kit, 'StonePile', 0));
  assert.notEqual(pile.children[0].material, kit.wind.material, 'inanimate resource piles never sway');
  kit.wind.update(2, 0, false); const calm = kit.wind.strength.value;
  kit.wind.update(2, 1, true); assert.ok(kit.wind.strength.value > calm * 2);
  kit.dispose();
});

test('player corpse rows render the settled survivor and conceal duplicate dead player rows', async () => {
  const renderer = new WebGpuWorldRenderer({ dataset: {}, style: {} }), seen = new Set();
  const frame = { width: 1280, height: 720, cameraOffset: { x: 0, y: 0 }, nowMs: 100000,
    tables: { playerCorpses: new Map([['1', { posX: 400, posY: 400, playerIdentity: 'dead-owner', deathTime: stamp(90000), health: 100 }]]),
      players: new Map([['dead-owner', { identity: 'dead-owner', positionX: 400, positionY: 400, direction: 'right', isDead: true }]]) } };
  renderer.syncTable('playerCorpses', frame, .016, 1, seen, []); renderer.syncTable('players', frame, .016, 1, seen, []);
  assert.ok(seen.has('playerCorpses:1')); assert.equal(seen.has('players:dead-owner'), false);
  const corpse = renderer.visuals.get('playerCorpses:1');
  assert.equal(corpse.root.children[0].userData.playerCorpse, true); assert.equal(corpse.root.userData.staticBatch, true, 'settled corpses become shared instanced anatomy');
  assert.equal(corpse.root.children[0].rotation.y, Math.PI / 2, 'corpse handoff preserves the dead player’s facing');
  assert.equal(renderer.unfinished.has('table:playerCorpses'), false);
  await renderer.dispose();
});

test('gait contacts leave world-fixed snow prints, kick dust, land once and splash once on entering water', () => {
  const kit = new ModelKit(), fx = new FootContactEffects3d(kit), rig = new SurvivorRig(kit);
  const pose = { x: 400, y: 400, ground: 0, speed: 3, swimming: false, down: false, jumpAge: 10, terrain: 'Dirt', snow: true };
  let time = 0;
  for (let i = 0; i < 16; i++) {
    time += .08; pose.x += 9; rig.root.position.x = pose.x / 48;
    rig.update({ ...rest, speed: 3 }, .08, time); fx.observe('walker', pose, rig, time); fx.update(time);
  }
  assert.ok(fx.prints.count > 0 && fx.particles.count > 0);
  const planted = new Matrix4(); fx.prints.getMatrixAt(0, planted);
  rig.root.position.x += 100; fx.update(time + .1);
  const retained = new Matrix4(); fx.prints.getMatrixAt(0, retained); assert.deepEqual(retained.elements, planted.elements);
  pose.speed = 0; pose.snow = false; pose.jumpAge = .2;
  fx.observe('walker', pose, rig, time += .1); const before = fx.events.length;
  pose.jumpAge = .55; fx.observe('walker', pose, rig, time += .1); assert.equal(fx.events.length, before + 1, 'landing emits one grounded burst');
  fx.observe('walker', pose, rig, time += .1); assert.equal(fx.events.length, before + 1, 'settled feet do not repeatedly land');
  pose.swimming = true; fx.observe('walker', pose, rig, time += .1);
  assert.equal(fx.events.at(-1).kind, 'splash'); const entered = fx.events.length;
  fx.observe('walker', pose, rig, time += .1); assert.equal(fx.events.length, entered);
  fx.update(time + 20); assert.equal(fx.prints.count, 0); assert.equal(fx.particles.count, 0);
  fx.dispose(); kit.dispose();
});

test('3D projectiles preserve the authoritative projected trajectory, deduplicate shots and disappear on resolution', () => {
  const kit = new ModelKit(), scene = new Scene(), batches = new StaticWorldBatches(scene), fx = new ProjectileWorld3d(kit, batches);
  const definitions = new Map([['1', { name: 'Hunting Bow' }], ['2', { name: 'Fire Arrow' }], ['3', { name: 'Makarov PM' }]]);
  const projectile = { id: 1n, clientShotId: 'test-shot', ownerId: { toHexString: () => 'owner' }, itemDefId: 1n, ammoDefId: 2n, sourceType: 0, npcProjectileType: 0,
    startTime: stamp(100000), startPosX: 400, startPosY: 400, velocityX: 300, velocityY: -70, maxRange: 1000 };
  const camera = new OrthographicCamera(-12, 12, 8, -8, .1, 160);
  camera.position.set(0, Math.sin(WORLD_3D.elevationRadians) * 50, Math.cos(WORLD_3D.elevationRadians) * 50); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  for (const age of [0, .1, .5, 1, 2]) {
    const actual = projectileScenePosition(projectile, age, definitions).project(camera);
    const sampled = sampleProjectileState(projectile, age, definitions), p = worldToScene(sampled.x, sampled.y);
    const logical = new Vector3(p.x, 0, p.z).project(camera);
    assert.ok(actual.distanceTo(logical) < .03 && Math.abs(actual.x - logical.x) < 1e-6 && Math.abs(actual.y - logical.y) < 1e-6, 'depth presentation never changes the collision/aiming projection');
  }
  batches.beginFrame();
  fx.update(new Map([['predicted', projectile], ['server', { ...projectile, id: 2n }]]), definitions, 100300, () => false, () => false); batches.flush();
  assert.equal(fx.flights.size, 1, 'optimistic and confirmed copies share their client shot ID'); assert.ok(fx.trails.count > 0);
  batches.beginFrame(); fx.update(new Map(), definitions, 100400, () => false, () => false); batches.flush();
  assert.equal(fx.flights.size, 0); assert.equal(fx.trails.count, 0); assert.ok([...scene.children].every(mesh => !mesh.isInstancedMesh || mesh.count === 0));
  fx.dispose(); batches.dispose(); kit.dispose();
});

test('clock rewinds clear world contact history and a slightly future server shot can still arrive', () => {
  const kit = new ModelKit(), fx = new FootContactEffects3d(kit), rig = new SurvivorRig(kit);
  const pose = { x: 400, y: 400, ground: 0, speed: 0, swimming: false, down: false, jumpAge: .2, terrain: 'Dirt', snow: false };
  fx.observe('rewind', pose, rig, 10);
  fx.observe('rewind', { ...pose, jumpAge: .55 }, rig, 10.1); fx.update(10.1);
  assert.ok(fx.particles.count > 0);
  fx.update(1); assert.equal(fx.particles.count, 0); assert.equal(fx.states.size, 0);
  const timeline = new RangedAnimationTimeline();
  assert.equal(timeline.age('future', 'Makarov PM', 1010, 1000), Infinity);
  assert.equal(timeline.age('future', 'Makarov PM', 1010, 1020), .01);
  fx.dispose(); kit.dispose();
});

test('explosives have separate models, duds hide their batched fuse, and only live detonation events explode', async () => {
  const now = 900000, renderer = new WebGpuWorldRenderer({ dataset: {}, style: {} });
  const bomb = { posX: 400, posY: 400, explosiveType: { tag: 'BabushkaSurprise' }, armedAt: stamp(now - 1000), detonatesAt: stamp(now + 1000), isDud: false };
  const frame = { width: 1280, height: 720, cameraOffset: { x: 0, y: 0 }, nowMs: now, tables: { placedExplosives: new Map([['bomb', bomb]]) } };
  renderer.batches.beginFrame(); renderer.syncTable('placedExplosives', frame, .016, 2, new Set(), []); renderer.batches.flush();
  const model = renderer.visuals.get('placedExplosives:bomb').root;
  assert.equal(model.getObjectByName('explosive-fuse').visible, true); assert.equal(renderer.unfinished.has('table:placedExplosives'), false);
  bomb.isDud = true; renderer.batches.beginFrame(); renderer.syncTable('placedExplosives', frame, .016, 3, new Set(), []); renderer.batches.flush();
  assert.equal(model.getObjectByName('explosive-fuse').visible, false);
  assert.ok([...renderer.batches.batches.values()].filter(batch => batch.mesh.material.emissive.getHex() !== 0).every(batch => batch.used === 0), 'invisible fuse meshes never leak into instancing');
  const live = { isDud: false, detonatesAt: stamp(now) };
  assert.equal(isLiveDetonation({ event: { tag: 'Transaction' } }, live, now), true);
  for (const tag of ['UnsubscribeApplied', 'SubscribeApplied']) assert.equal(isLiveDetonation({ event: { tag } }, live, now), false);
  assert.equal(isLiveDetonation({}, { ...live, isDud: true }, now), false);
  assert.equal(isLiveDetonation({}, { ...live, detonatesAt: stamp(now + 30000) }, now), false);
  const fx = new ExplosionEffects3d(renderer.kit);
  recordWorldExplosion('verified-bomb', 400, 400, 200, true, now); recordWorldExplosion('verified-bomb', 400, 400, 200, true, now + 20);
  fx.update(now + 100); assert.equal(fx.events.length, 1); assert.ok(fx.particles.count > 0 && fx.rings.count > 0);
  fx.update(now + 3000); assert.equal(fx.particles.count, 0); assert.equal(fx.rings.count, 0);
  fx.dispose(); await renderer.dispose();
});

test('fishing casts keep the supporting hand attached and settle the float at the authoritative water target', () => {
  const kit = new ModelKit(), rig = new SurvivorRig(kit), fx = new FishingEffects3d(kit);
  for (const progress of [0, .2, .5, .8, 1]) {
    rig.update({ ...rest, weapon: 'Primitive Reed Fishing Rod', interaction: { kind: 'fish-cast', progress, weight: 1 } }, .016, progress);
    rig.root.updateMatrixWorld(true);
    const support = rig.root.getObjectByName('support-grip').getWorldPosition(new Vector3());
    assert.ok(support.distanceTo(rig.root.getObjectByName('left-hand').getWorldPosition(new Vector3())) < .03, 'cast never leaves the supporting hand floating beside the rod');
  }
  const now = 100000, session = { isActive: true, castTime: stamp(now), targetX: 500, targetY: 650, hasBite: false };
  const getTip = (_owner, target) => { target.set(4, 2.5, 10); return true; };
  fx.update(new Map([['fisher', session]]), now + 450, getTip);
  const midCast = new Matrix4(); fx.floats.getMatrixAt(0, midCast);
  fx.update(new Map([['fisher', session]]), now + 1500, getTip);
  const settled = new Matrix4(); fx.floats.getMatrixAt(0, settled);
  const water = worldToScene(500, 650);
  assert.ok(Math.abs(settled.elements[12] - water.x) < 1e-5 && Math.abs(settled.elements[14] - water.z) < 1e-5);
  assert.ok(Math.abs(midCast.elements[13] - settled.elements[13]) > .3, 'a cast has a visible arc before the float lands');
  assert.equal(fx.lines.count, 16);
  fx.update(new Map(), now + 1600, getTip); assert.equal(fx.floats.count, 0); assert.equal(fx.lines.count, 0);
  fx.dispose(); kit.dispose();
});
