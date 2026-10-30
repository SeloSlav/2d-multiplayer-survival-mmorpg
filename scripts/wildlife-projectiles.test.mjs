import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three/webgpu';
import { AnimalRig, ANIMAL_PROFILES } from '../client/src/engine/presentation/world3d/animalRigs.ts';
import { ModelKit } from '../client/src/engine/presentation/world3d/modelKit.ts';
import { GROUND_Y_SCALE, WORLD_3D } from '../client/src/engine/presentation/world3d/visualContract.ts';

const profiles = JSON.parse(await readFile('shared/config/wildlifeProjectileGeometry.json', 'utf8'));

test('every wildlife model has valid projectile geometry, while apparition dimensions stay unchanged', () => {
  assert.deepEqual(Object.keys(profiles).sort(), Object.keys(ANIMAL_PROFILES).sort());
  for (const [species, profile] of Object.entries(profiles)) {
    assert.ok(profile.radius >= 32 && profile.radius <= 84, species);
    assert.ok(profile.aimHeight > 0 && profile.aimHeight < profile.height, species);
  }
  for (const [species, height] of [['Shorebound', 76], ['Shardkin', 46], ['DrownedWatch', 98]]) {
    assert.equal(profiles[species].radius, 32);
    assert.equal(profiles[species].height, height);
  }
});

test('wildlife projectile volumes cover visible torsos and heads across headings, gaits and lunges', () => {
  const kit = new ModelKit();
  try {
    for (const species of ['TundraWolf', 'CinderFox', 'Wolverine', 'PolarBear', 'ArcticWalrus', 'Vole']) {
      const profile = profiles[species];
      for (const seed of [0, 17, 819]) {
        const rig = new AnimalRig(kit, species, seed);
        for (let step = 0; step < 24; step++) {
          const time = step / 24, speed = step < 8 ? 0 : ANIMAL_PROFILES[species].runSpeed;
          rig.update(speed, step * Math.PI / 4, 1 / 24, time, false, false, {
            state: 'Chasing', attackAge: step < 16 ? -1 : (step - 16) / 12,
          });
          rig.root.updateMatrixWorld(true);
          // The body contains articulated limbs/tail too. Check its direct
          // torso meshes and the complete head, where players place the reticle.
          const parts = [...rig.body.children.filter(child => child.isMesh), rig.root.getObjectByName('animal-head')];
          for (const part of parts) {
            const bounds = new Box3().setFromObject(part);
            assert.ok(bounds.max.y * WORLD_3D.tilePixels <= profile.height + 0.001,
              `${species}: visible upper body ${bounds.max.y * 48} exceeds ${profile.height}`);
            for (const x of [bounds.min.x, bounds.max.x]) for (const z of [bounds.min.z, bounds.max.z]) {
              const radius = Math.hypot(x * WORLD_3D.tilePixels, z / GROUND_Y_SCALE * WORLD_3D.tilePixels);
              assert.ok(radius <= profile.radius + 0.001, `${species}: visible body extent ${radius} exceeds ${profile.radius}`);
            }
            const yaw = rig.root.rotation.y, point = new Vector3();
            part.traverse(mesh => {
              if (!mesh.isMesh) return;
              const positions = mesh.geometry.getAttribute('position');
              for (let i = 0; i < positions.count; i++) {
                point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).multiplyScalar(WORLD_3D.tilePixels);
                const across = point.x * Math.cos(yaw) - point.z * Math.sin(yaw);
                const along = point.x * Math.sin(yaw) + point.z * Math.cos(yaw);
                const footprint = (across / (profile.halfWidth ?? profile.radius)) ** 2 + (along / profile.radius) ** 2;
                assert.ok(footprint <= 1.001, `${species}: visible body vertex outside oriented projectile volume (${footprint})`);
              }
            });
          }
        }
      }
    }
  } finally { kit.dispose(); }
});

test('ground-plane reticle projection uses the same height correction as server aim', () => {
  const heightScale = Math.cos(WORLD_3D.elevationRadians);
  assert.ok(Math.abs(heightScale - 0.8660254) < 1e-7);
  for (const species of ['TundraWolf', 'CinderFox', 'PolarBear', 'Vole']) {
    const profile = profiles[species];
    const point = new Vector3(400, profile.aimHeight, 200 * GROUND_Y_SCALE);
    const reticle = { x: point.x, y: point.z / GROUND_Y_SCALE - point.y * heightScale };
    assert.equal(reticle.x, 400);
    assert.ok(Math.abs(reticle.y + profile.aimHeight * heightScale - 200) < 1e-8);
  }
});
