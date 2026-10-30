import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Color, Group, Matrix4, Mesh, Vector3 } from 'three/webgpu';
import { ModelKit } from '../client/src/engine/presentation/world3d/modelKit.ts';
import { barrelPaint, createBarrel } from '../client/src/engine/presentation/world3d/environmentModels.ts';
import { barrelFractureSeeds, createVoronoiFragments } from '../client/src/engine/presentation/world3d/voronoiFracture.ts';
import { BarrelFractureEffects3d, BARREL_FRACTURE_CAPACITY } from '../client/src/engine/presentation/world3d/BarrelFractureEffects3d.ts';
import { bindBarrelBreakEvents } from '../client/src/engine/runtime/barrelBreakEventRuntime.ts';
import { recordWorldBarrelBreak, worldBarrelBreaksAfter } from '../client/src/engine/presentation/world3d/presentationEffectEvents.ts';
import { RuneStoneEffects3d } from '../client/src/engine/presentation/world3d/RuneStoneEffects3d.ts';
import { createRuneStone } from '../client/src/engine/presentation/world3d/naturalObjects.ts';
import { RUNE_PALETTES, RUNE_LIGHT_RADIUS, runeNightStrength } from '../client/src/engine/presentation/world3d/runeStoneProfile.ts';
import { LIGHT_FADE_FULL_AT, NIGHT_LIGHTS_OFF, NIGHT_LIGHTS_ON } from '../client/src/config/dayNightConstants.ts';
import { WebGpuWorldRenderer } from '../client/src/engine/presentation/world3d/WebGpuWorldRenderer.ts';
import { PipelineWarmup3d } from '../client/src/engine/presentation/world3d/PipelineWarmup3d.ts';
import { OrthographicCamera, Scene } from 'three/webgpu';

const stamp = ms => ({ microsSinceUnixEpoch: BigInt(ms) * 1000n });
function meshVolume(geometry) {
  const p = geometry.getAttribute('position'), a = new Vector3(), b = new Vector3(), c = new Vector3(); let volume = 0;
  for (let i = 0; i < p.count; i += 3) volume += a.fromBufferAttribute(p, i).dot(b.fromBufferAttribute(p, i + 1).cross(c.fromBufferAttribute(p, i + 2))) / 6;
  return volume;
}

test('Voronoi cells partition the actual barrel volume, including capped bands and label', () => {
  const kit = new ModelKit(), source = createBarrel(kit), seeds = barrelFractureSeeds();
  const fragments = createVoronoiFragments(source, seeds, barrelPaint(0));
  assert.equal(fragments.length, 18); let sourceVolume = 0;
  source.traverse(mesh => { if (mesh instanceof Mesh) sourceVolume += meshVolume(mesh.geometry); });
  assert.ok(Math.abs(fragments.reduce((sum, p) => sum + p.volume, 0) - sourceVolume) < 1e-6, 'no source volume is lost or added at cut planes');
  const sourceBounds = new Box3().setFromObject(source), rebuilt = new Box3(); let cuts = 0, paint = 0, band = 0, label = 0;
  for (let cell = 0; cell < fragments.length; cell++) {
    const piece = fragments[cell], p = piece.geometry.getAttribute('position'), colors = piece.geometry.getAttribute('color'), mask = piece.geometry.getAttribute('paintMask');
    assert.ok(piece.volume > .001 && Math.abs(meshVolume(piece.geometry) - piece.volume) < 1e-7, 'each cell is a closed solid with outward winding');
    for (let i = 0; i < p.count; i++) {
      const point = new Vector3().fromBufferAttribute(p, i).add(piece.center); rebuilt.expandByPoint(point);
      for (const other of seeds) assert.ok(point.distanceToSquared(seeds[cell]) <= point.distanceToSquared(other) + 1e-6, 'all pieces stay inside their own Voronoi cell');
      const pigment = new Color(colors.getX(i), colors.getY(i), colors.getZ(i)).getHex();
      if (mask.getX(i)) paint++; else if (pigment === 0x666a64) cuts++; else if (pigment === 0x535e62) band++; else if (pigment === 0xe0d5b7) label++;
    }
    piece.geometry.dispose();
  }
  assert.ok(rebuilt.min.distanceTo(sourceBounds.min) < 1e-6 && rebuilt.max.distanceTo(sourceBounds.max) < 1e-6);
  assert.ok(cuts > 0 && paint > 0 && band > 0 && label > 0, 'retain distinct shell, cap, iron and label surfaces'); kit.dispose();
});

test('fracture motion reassembles the visible pose at zero, tumbles, bounces and expires independently of frame rate', () => {
  const kit = new ModelKit(), effects = new BarrelFractureEffects3d(kit), origin = new Matrix4().makeRotationZ(.08).scale(new Vector3(1, 1, 2)).setPosition(3, 0, 5);
  effects.spawn('motion', 1, 100000, origin, 0); effects.update(100000);
  const matrix = new Matrix4(), start = [];
  effects.meshes.forEach((mesh, i) => {
    mesh.getMatrixAt(0, matrix); start.push(matrix.clone());
    const expected = origin.clone().multiply(new Matrix4().makeTranslation(...effects.fragments[i].center.toArray()));
    assert.ok(matrix.elements.every((n, j) => Math.abs(n - expected.elements[j]) < 1e-6));
  });
  effects.update(100350);
  effects.meshes[0].getMatrixAt(0, matrix); assert.ok(matrix.elements.some((n, i) => Math.abs(n - start[0].elements[i]) > .1));
  effects.update(101550);
  for (const mesh of effects.meshes) {
    mesh.getMatrixAt(0, matrix); const p = mesh.geometry.getAttribute('position'); let bottom = Infinity;
    for (let i = 0; i < p.count; i++) bottom = Math.min(bottom, new Vector3().fromBufferAttribute(p, i).applyMatrix4(matrix).y);
    assert.ok(bottom >= -1e-6 && bottom < .04, 'settled pieces touch the floor without penetrating');
  }
  const final = matrix.clone(); effects.update(100050); effects.update(100700); effects.update(101550);
  effects.meshes.at(-1).getMatrixAt(0, matrix); assert.deepEqual(matrix.elements, final.elements, 'absolute event age gives identical motion after skipped frames');
  effects.update(102000); assert.equal(effects.activeCount, 0); assert.ok(!effects.root.visible);
  effects.dispose(); kit.dispose();
});

test('fracture bursts stay bounded and densely retain their own paint when slots expire', () => {
  const kit = new ModelKit(), effects = new BarrelFractureEffects3d(kit), origin = new Matrix4();
  const before = effects.meshes.map(mesh => mesh.geometry);
  for (let i = 0; i < 60; i++) effects.spawn(`capacity-${i}`, i % 3, 200000 + i * 50, origin, 0);
  assert.equal(effects.activeCount, BARREL_FRACTURE_CAPACITY); effects.update(203000);
  assert.ok(effects.meshes.every((mesh, i) => mesh.count === BARREL_FRACTURE_CAPACITY && mesh.geometry === before[i]));
  effects.update(204900); assert.equal(effects.activeCount, 1);
  const paint = effects.meshes[0].geometry.getAttribute('fracturePaint'), expected = new Color(barrelPaint(59 % 3));
  assert.ok(Math.abs(paint.getX(0) - expected.r) < 1e-7 && Math.abs(paint.getY(0) - expected.g) < 1e-7);
  effects.update(204950); assert.equal(effects.activeCount, 0);
  const disposed = []; effects.meshes.forEach(mesh => mesh.geometry.addEventListener('dispose', () => disposed.push(mesh.geometry)));
  effects.dispose(); assert.equal(disposed.length, 18); kit.dispose();
});

test('every fragment buffer prepares asynchronously before the first burst draws it', async () => {
  const kit = new ModelKit(), effects = new BarrelFractureEffects3d(kit), scene = new Scene(), camera = new OrthographicCamera(), warmup = new PipelineWarmup3d();
  scene.add(effects.root); const prepared = [];
  const renderer = { compileAsync: async mesh => { prepared.push(mesh); } };
  for (let i = 0; i < 18; i++) {
    warmup.prepare(scene, camera, renderer, scene, 'lit', assert.fail, [effects.root])();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(new Set(prepared).size, 18, 'distinct custom instance buffers cannot share one preparation key');
  effects.spawn('prepared', 0, 10000, new Matrix4(), 0); effects.update(10000);
  const restore = warmup.prepare(scene, camera, renderer, scene, 'lit', assert.fail);
  assert.ok(warmup.visibleReady && effects.meshes.every(mesh => mesh.visible)); assert.equal(prepared.length, 18); restore();
  await warmup.dispose(); effects.dispose(); kit.dispose();
});

test('barrel destruction events reject stream eviction, deduplicate update/delete, and allow a later respawn to break again', () => {
  const listeners = {}, table = {};
  for (const name of ['Update', 'Delete']) { table[`on${name}`] = fn => listeners[name] = fn; table[`removeOn${name}`] = fn => { assert.equal(fn, listeners[name]); delete listeners[name]; }; }
  const legacy = [], detach = bindBarrelBreakEvents({ db: { barrel: table } }, row => legacy.push(row.id));
  const now = Date.now(), live = { id: 'event-test', posX: 40, posY: 90, variant: 0, health: 50, respawnAt: stamp(0) };
  const dead = { ...live, health: 0, respawnAt: stamp(now + 600000), lastHitTime: stamp(now) };
  for (const tag of ['SubscribeApplied', 'UnsubscribeApplied', 'Error']) { listeners.Delete({ event: { tag } }, live); listeners.Update({ event: { tag } }, live, dead); }
  assert.equal(legacy.length, 0); listeners.Update({}, live, { ...live, health: 20 }); assert.equal(legacy.length, 0);
  listeners.Update({}, live, dead); listeners.Delete({}, dead);
  assert.equal(worldBarrelBreaksAfter(0, Date.now()).filter(e => e.id === live.id).length, 1);
  recordWorldBarrelBreak(live.id, 40, 90, 2, 'later-respawn', now + 600001);
  assert.equal(worldBarrelBreaksAfter(0, now + 600001).filter(e => e.id === live.id).length, 1);
  listeners.Update({}, { ...live, variant: 6 }, { ...dead, variant: 6 }); assert.equal(legacy.length, 2);
  detach(); assert.deepEqual(listeners, {});
});

test('runestones regain monumental scale and retain separate animated emissive inscriptions through compilation', () => {
  const kit = new ModelKit(), effects = new RuneStoneEffects3d();
  for (const type of ['Green', 'Red', 'Blue']) {
    const glyph = effects.materialFor(type), model = kit.compileColored(createRuneStone(kit, type, 2, glyph));
    const bounds = new Box3().setFromObject(model), size = bounds.getSize(new Vector3());
    assert.ok(size.y > 4.4 && size.x > 2.8 && size.x < 3.5);
    assert.ok(model.children.some(mesh => mesh.material === glyph), 'emissive glyphs cannot disappear into static vertex pigment');
    effects.beginFrame(10, .5); assert.equal(glyph.emissiveIntensity, 0);
    effects.beginFrame(10, .94); assert.ok(glyph.emissiveIntensity > 2.5); assert.equal(glyph.emissive.getHex(), RUNE_PALETTES[type].glow);
  }
  effects.dispose(); kit.dispose();
});

test('runestone lighting fades at the shared phase boundaries, lights the environment and clears culled motes', () => {
  assert.equal(runeNightStrength(.5), 0); assert.equal(runeNightStrength(NIGHT_LIGHTS_ON), 0);
  assert.ok(runeNightStrength((NIGHT_LIGHTS_ON + LIGHT_FADE_FULL_AT) / 2) > 0);
  assert.equal(runeNightStrength(LIGHT_FADE_FULL_AT), 1); assert.ok(runeNightStrength(NIGHT_LIGHTS_OFF - .01) < .2);
  assert.ok(Math.abs(runeNightStrength(.999999) - runeNightStrength(.000001)) < .0001, 'the cycle wrap cannot blink off or jump');
  const effects = new RuneStoneEffects3d(); effects.beginFrame(3, .94);
  for (const type of ['Green', 'Red', 'Blue']) {
    const light = effects.add(type, type, new Vector3(3, 0, 4));
    assert.equal(light.color, RUNE_PALETTES[type].glow); assert.ok(light.intensity > 12 && light.position.y > 2);
    assert.equal(light.distance, RUNE_LIGHT_RADIUS); assert.equal(light.flicker, 0);
  }
  effects.endFrame(); assert.ok(effects.root.visible); assert.equal(effects.root.children.reduce((n, mesh) => n + mesh.count, 0), 57);
  effects.beginFrame(4, .94); effects.endFrame(); assert.ok(!effects.root.visible);
  effects.beginFrame(5, .5); assert.equal(effects.add('day', 'Blue', new Vector3()), undefined); effects.endFrame(); assert.ok(!effects.root.visible);
  effects.dispose();
});

test('the world renderer registers runestone illumination beside the enlarged actual model', async () => {
  const renderer = new WebGpuWorldRenderer({ dataset: {} }), now = Date.now();
  renderer.runeEffects.beginFrame(2, .94);
  const lights = [], frame = { width: 800, height: 600, cameraOffset: { x: 0, y: 0 }, tables: { runeStones: new Map([['r', { posX: 120, posY: 180, runeType: { tag: 'Blue' } }]]) }, nowMs: now };
  renderer.syncTable('runeStones', frame, 1 / 60, 2, new Set(), lights);
  assert.equal(lights.length, 1); assert.equal(lights[0].color, RUNE_PALETTES.Blue.glow); assert.ok(lights[0].intensity > 12);
  await renderer.dispose();
});

test('enlarged runestones remain visible with their base below the viewport at close zoom', async () => {
  const renderer = new WebGpuWorldRenderer({ dataset: {} });
  const row = { posX: 400, posY: 800, runeType: { tag: 'Green' } };
  const frame = { width: 800, height: 600, zoom: 2, cameraOffset: { x: 0, y: -140 }, tables: { runeStones: new Map([['tall-rune', row]]) } };
  const seen = new Set(); renderer.runeEffects.beginFrame(1, .5);
  renderer.syncTable('runeStones', frame, 1 / 60, 1, seen, []);
  assert.ok(seen.has('runeStones:tall-rune'), 'the visible upper inscription cannot pop out when its ground anchor crosses the old culling margin');
  await renderer.dispose();
});
