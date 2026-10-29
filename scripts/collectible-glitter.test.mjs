import test from 'node:test';
import assert from 'node:assert/strict';
import { Color, Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { CollectibleGlitter3d, collectibleNightMix } from '../client/src/engine/presentation/world3d/CollectibleGlitter3d.ts';
import { WebGpuWorldRenderer } from '../client/src/engine/presentation/world3d/WebGpuWorldRenderer.ts';
import { PLANT_PROFILES } from '../client/src/engine/presentation/world3d/plantCatalog.ts';
import { LIGHT_FADE_FULL_AT, NIGHT_LIGHTS_OFF, NIGHT_LIGHTS_ON } from '../client/src/config/dayNightConstants.ts';

test('collectible colors blend through shared dusk/dawn thresholds and across midnight', () => {
  assert.equal(collectibleNightMix(.43), 0);
  assert.equal(collectibleNightMix(LIGHT_FADE_FULL_AT), 1);
  assert.equal(collectibleNightMix(NIGHT_LIGHTS_ON), 0);
  assert.equal(collectibleNightMix(NIGHT_LIGHTS_OFF), 0);
  assert.ok(Math.abs(collectibleNightMix((NIGHT_LIGHTS_ON + LIGHT_FADE_FULL_AT) / 2) - .5) < 1e-10);
  assert.ok(Math.abs(collectibleNightMix(NIGHT_LIGHTS_OFF / 2) - .5) < 1e-10);
  assert.ok(Math.abs(collectibleNightMix(1 - 1e-6) - collectibleNightMix(1e-6)) < 1e-8);
});

test('pooled glitter is reproducible at any cadence, rises in world space and changes from gold to blue/purple', () => {
  const fx = new CollectibleGlitter3d(), facing = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -.5);
  const draw = (time, cycle, id = 'pickup') => {
    fx.beginFrame(time, cycle, facing); fx.add(id, 2, 3, 4, .5, .6); fx.endFrame();
    return Array.from(fx.sparkles.instanceMatrix.array.slice(0, fx.sparkles.count * 16));
  };
  const day = draw(7, .43), dayColor = new Color(); fx.sparkles.getColorAt(0, dayColor);
  assert.equal(fx.sparkles.count, 9);
  assert.ok(dayColor.r > dayColor.b && dayColor.g > dayColor.b, 'daytime glitter is golden');
  const matrix = new Matrix4(), position = new Vector3(), scale = new Vector3(), rotation = new Quaternion();
  fx.sparkles.getMatrixAt(0, matrix); matrix.decompose(position, rotation, scale);
  assert.ok(position.y > 3 && position.y < 4.5, 'emission follows the supplied ground/model height');
  assert.ok(rotation.angleTo(facing) < 1e-6, 'sparkles face the camera');
  draw(.1, .43); draw(3, .43); assert.deepEqual(draw(7, .43), day, 'no accumulated frame or emitter history');
  assert.deepEqual(draw(7, .9), day, 'lighting only changes color');
  const nightColor = new Color(); fx.sparkles.getColorAt(0, nightColor);
  assert.ok(nightColor.b > nightColor.r && nightColor.b > nightColor.g, 'nighttime glitter is blue/purple');
  assert.notDeepEqual(draw(7, .9, 'different-pickup'), day, 'neighboring pickups twinkle independently');
  for (let i = 0; i < 9; i++) assert.ok(fx.opacity.getX(i) >= 0 && fx.opacity.getX(i) <= 1);
  fx.beginFrame(8, .43, facing); fx.endFrame();
  assert.equal(fx.sparkles.count, 0); assert.equal(fx.root.visible, false, 'collected pickups leave no stale glitter');
  fx.beginFrame(9, .43, facing);
  for (let i = 0; i < 2000; i++) fx.add(`stress-${i}`, i, 0, 0);
  fx.endFrame(); assert.equal(fx.sparkles.count, fx.sparkles.instanceMatrix.count, 'busy views stay within the pool budget');
  fx.dispose();
});

test('all live harvestables and dropped items glitter; depleted, culled and concealed pickups do not', async () => {
  const renderer = new WebGpuWorldRenderer({ dataset: {}, style: {} });
  const plants = new Map(Object.keys(PLANT_PROFILES).map((plantType, i) => [String(i), { plantType: { tag: plantType }, posX: 400, posY: 400 }]));
  plants.set('depleted', { plantType: 'WoodPile', posX: 400, posY: 400, respawnAt: { microsSinceUnixEpoch: 1n } });
  plants.set('destroyed', { plantType: 'StonePile', posX: 400, posY: 400, isDestroyed: true });
  plants.set('culled', { plantType: 'SulfurPile', posX: 50000, posY: 50000 });
  const frame = { width: 1280, height: 720, cameraOffset: { x: 0, y: 0 }, tables: {
    harvestableResources: plants,
    droppedItems: new Map([['known', { itemDefId: 1n, posX: 400, posY: 400 }], ['pending-definition', { itemDefId: 99n, posX: 450, posY: 400 }]]),
    itemDefinitions: new Map([['1', { name: 'Stone Hatchet' }]]),
  } };
  const render = () => {
    renderer.collectibleGlitter.beginFrame(1, .43, renderer.camera.quaternion);
    const seen = new Set();
    for (const kind of ['harvestableResources', 'droppedItems']) renderer.syncTable(kind, frame, .016, 1, seen, []);
    renderer.collectibleGlitter.endFrame();
    return renderer.collectibleGlitter.sparkles.count;
  };
  assert.equal(render(), (Object.keys(PLANT_PROFILES).length + 2) * 9);
  frame.tables.harvestableResources.clear(); frame.tables.droppedItems.clear(); assert.equal(render(), 0);
  frame.tables.harvestableResources.set('hidden', { plantType: 'WoodPile', posX: 400, posY: 400 });
  renderer.diving = true; assert.equal(render(), 0, 'surface pickups stay hidden while diving');
  renderer.diving = false;
  renderer.shelterVisibility.occludes = () => true; assert.equal(render(), 0, 'shelter concealment also conceals glitter');
  await renderer.dispose();
});
