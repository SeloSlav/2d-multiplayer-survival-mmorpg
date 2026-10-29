import test from 'node:test';
import assert from 'node:assert/strict';
import { ShoreAmbienceRuntime } from '../client/src/engine/runtime/shoreAmbience.ts';
import { AmbientSoundRuntime } from '../client/src/engine/runtime/ambientSoundRuntime.ts';
import { HotSpringEffects3d } from '../client/src/engine/presentation/world3d/HotSpringEffects3d.ts';
import { WaterWorld3d } from '../client/src/engine/presentation/world3d/WaterWorld3d.ts';
import { ModelKit } from '../client/src/engine/presentation/world3d/modelKit.ts';

function chunksFor(terrain) {
  const chunks = new Map();
  for (let cy = 0; cy < 16; cy++) for (let cx = 0; cx < 16; cx++) chunks.set(`${cx},${cy}`, {
    chunkSize: 8, tileTypes: Uint8Array.from({ length: 64 }, (_, i) => terrain(cx * 8 + i % 8, cy * 8 + Math.floor(i / 8))),
  });
  return chunks;
}
const listener = (x, y = 64.5) => ({ positionX: x * 48, positionY: y * 48 });
const sample = (chunks, x, y) => new ShoreAmbienceRuntime().update(chunks, listener(x, y), 48);

test('geothermal water produces no shoreline ambience on the bank or inside the pool', () => {
  const chunks = chunksFor((x, y) => Math.hypot(x - 64, y - 64) < 12 ? 6 : 4);
  for (const x of [50.5, 52.5, 60.5, 64.5]) {
    const result = sample(chunks, x);
    assert.equal(result.shoreAmbienceGain, 0); assert.equal(result.distanceToShore, Infinity);
    const audio = new AmbientSoundRuntime(); audio.options = result;
    assert.equal(audio.getActiveContinuousSounds().includes('ocean_ambience'), false);
    assert.equal(audio.getProximityVolumeModifier('ocean_ambience'), 0);
  }
});

test('river banks and diagonal channels are quieter and shorter range than exposed ocean shores', () => {
  const coast = chunksFor(x => x >= 64 ? 3 : 4);
  const river = chunksFor(x => x >= 64 && x <= 78 ? 3 : 9);
  const diagonal = chunksFor((x, y) => Math.abs(x - y) < 8 ? 3 : 9);
  const oceanSound = sample(coast, 63.5), riverSound = sample(river, 63.5);
  assert.ok(oceanSound.shoreAmbienceGain > .99);
  assert.ok(riverSound.shoreAmbienceGain > 0 && riverSound.shoreAmbienceGain <= .22);
  assert.equal(riverSound.distanceToShore, Infinity);
  assert.ok(sample(diagonal, 54.5).shoreAmbienceGain <= .22);
  assert.equal(sample(river, 56.5).shoreAmbienceGain, 0);
  assert.ok(sample(coast, 56.5).shoreAmbienceGain > .4);
  assert.equal(sample(coast, 44.5).shoreAmbienceGain, 0);
  const audio = new AmbientSoundRuntime(); audio.options = riverSound;
  assert.equal(audio.getActiveContinuousSounds().includes('ocean_ambience'), true);
  assert.equal(audio.getProximityVolumeModifier('ocean_ambience'), riverSound.shoreAmbienceGain);
});

test('surf follows actual shore and chunk arrivals while stationary, independent of the camera', () => {
  const runtime = new ShoreAmbienceRuntime(), player = listener(63.5);
  const empty = chunksFor(() => 4);
  assert.equal(runtime.update(empty, player, 48).shoreAmbienceGain, 0);
  assert.ok(runtime.update(chunksFor(x => x >= 64 ? 3 : 4), player, 48).shoreAmbienceGain > .99);
  assert.equal(sample(chunksFor(() => 3), 64.5).shoreAmbienceGain, 0, 'far from land, water tiles alone must not emit surf');
  const mouth = chunksFor((x, y) => x >= 76 || Math.abs(y - 64) <= 7 && x >= 20 ? 3 : 4);
  assert.ok(sample(mouth, 75.5, 56.5).shoreAmbienceGain > sample(mouth, 50.5, 56.5).shoreAmbienceGain);
  runtime.stop(); assert.equal(runtime.update(undefined, player, 48).shoreAmbienceGain, 0);
});

function springTiles() {
  const tiles = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) tiles.push({ worldX: x, worldY: y, tileType: { tag: x > 2 && x < 9 && y > 2 && y < 8 ? 'HotSpringWater' : 'Beach' } });
  return tiles;
}

test('steam and bubbles remain seeded, bounded, tile-confined and stable across frame rates / terrain rebuilds', () => {
  const fx = new HotSpringEffects3d(), tiles = springTiles(); fx.rebuild(tiles); fx.update(5, 1, false);
  assert.equal(fx.sources.length, 60); assert.equal(fx.root.visible, true);
  for (const source of fx.sources) {
    assert.ok(source.x > 3 && source.x < 9 && source.z / 2 > 3 && source.z / 2 < 8);
  }
  const snapshot = () => [...fx.steam.mesh.instanceMatrix.array];
  const expected = snapshot(); fx.update(5.5, 1, false); assert.notDeepEqual(snapshot(), expected);
  for (let t = 0; t <= 5; t += 1 / 30) fx.update(t, 1, false); fx.update(5, 1, false); assert.deepEqual(snapshot(), expected);
  fx.rebuild([...tiles].reverse()); fx.update(5, 1, false); assert.deepEqual(snapshot(), expected);
  assert.ok([...fx.bubbles.opacity.array].some(n => n > 0)); assert.ok([...fx.ripples.opacity.array].some(n => n > 0));
  fx.update(5, .1, true); assert.equal(fx.root.visible, false);
  fx.rebuild([]); fx.update(5, 1, false); assert.equal(fx.steam.mesh.count, 0); assert.equal(fx.root.visible, false);
  fx.rebuild(Array.from({length: 3000}, (_, x) => ({worldX: x, worldY: 0, tileType: 'HotSpringWater'})));
  assert.equal(fx.sources.length, fx.steam.mesh.instanceMatrix.count); fx.dispose(); assert.equal(fx.root.children.length, 0);
});

test('production water owns geothermal effects and removes them when the spring leaves the terrain window', () => {
  const kit = new ModelKit(), water = new WaterWorld3d(kit); water.rebuild(springTiles()); water.beginFrame(3, 1, false);
  const steam = water.root.getObjectByName('hot-spring-steam'); assert.equal(steam.count, 60);
  assert.equal(steam.parent.visible, true); water.beginFrame(4, 1, true); assert.equal(steam.parent.visible, false);
  water.rebuild([{worldX: 0, worldY: 0, tileType: 'Sea'}]); water.beginFrame(5, 1, false); assert.equal(steam.count, 0);
  water.dispose(); kit.dispose();
});
