import { Group, Vector3 } from 'three/webgpu';
import { COLORS as C, ModelKit } from './modelKit';
import { seededRandom } from './visualContract';
import { createMemoryOre } from './memoryShardModels';

export { createTree } from './treeModels';

export function createRock(kit: ModelKit, type: string, seed: number): Group {
  if(type==='Memory')return createMemoryOre(kit);
  const group = new Group();
  const random = seededRandom(seed);
  const color = /Sulfur/.test(type) ? 0xaca367 : /Metal|Iron/.test(type) ? 0x747976 : C.stone;
  for (let i = 0; i < 4; i++) {
    const angle = i * 2.4;
    const size = i === 0 ? 1.32 : 0.58 + random() * 0.48;
    const mesh = kit.part(group, 'rock', i % 2 ? C.stoneDark : color,
      [size, size * (0.75 + random() * 0.35), size * 0.85],
      [Math.cos(angle) * (i ? 0.45 : 0), size * 0.29, Math.sin(angle) * (i ? 0.4 : 0)]);
    mesh.rotation.set(random() * 0.3, random() * 6.28, random() * 0.2);
  }
  if (/Metal|Sulfur|Iron/.test(type)) for (let i = 0; i < 6; i++) {
    kit.part(group, 'box', /Sulfur/.test(type) ? 0xd0b85c : 0xb2a493,
      [0.13, 0.08, 0.28], [(random() - 0.5) * 0.8, 0.68 + random() * 0.12, (random() - 0.5) * 0.6]);
  }
  return kit.compile(group);
}

export function createCampfire(kit: ModelKit, seed: number): Group {
  const group = new Group();
  const base = new Group();
  const random = seededRandom(seed);
  for (let i = 0; i < 9; i++) {
    const angle = i / 9 * Math.PI * 2;
    kit.part(base, 'rock', i % 2 ? C.stoneDark : C.stone, [0.28, 0.24, 0.3], [Math.cos(angle) * 0.5, 0.1, Math.sin(angle) * 0.5]);
  }
  for (let i = 0; i < 3; i++) {
    const angle = i / 3 * Math.PI;
    kit.beam(base, C.woodDark, new Vector3(-Math.cos(angle) * 0.38, 0.17, -Math.sin(angle) * 0.38),
      new Vector3(Math.cos(angle) * 0.38, 0.25, Math.sin(angle) * 0.38), 0.09);
  }
  group.add(kit.compile(base));
  const fire = new Group();
  fire.name = 'fire';
  for (let i = 0; i < 7; i++) {
    const angle = i * 2.4;
    const flame = kit.part(fire, 'cone', i % 2 ? C.flame : C.ember,
      [0.19, 0.48 + random() * 0.3, 0.19], [Math.cos(angle) * 0.16, 0.46, Math.sin(angle) * 0.16], true);
    flame.userData.phase = random() * 6.28;
    flame.userData.baseHeight = flame.scale.y;
  }
  group.add(fire);
  return group;
}

export function createCrate(kit: ModelKit): Group {
  const group = new Group();
  kit.part(group, 'box', C.woodDark, [1.06, 0.75, 0.75], [0, 0.4, 0]);
  for (let i = 0; i < 5; i++) {
    kit.part(group, 'box', C.wood, [0.18, 0.72, 0.79], [-0.41 + i * 0.205, 0.41, 0]);
    kit.part(group, 'box', C.wood, [0.18, 0.06, 0.75], [-0.41 + i * 0.205, 0.8, 0]);
  }
  for (const x of [-0.35, 0.35]) kit.part(group, 'box', C.iron, [0.07, 0.85, 0.84], [x, 0.41, 0]);
  kit.part(group, 'box', C.iron, [0.15, 0.16, 0.05], [0, 0.64, 0.43]);
  return kit.compile(group);
}

export function barrelPaint(variant: number): number {
  return variant % 3 === 0 ? 0x906447 : variant % 3 === 1 ? 0x667d75 : 0x8b8a78;
}
export function createBarrel(kit: ModelKit, variant = 0): Group {
  const group = new Group();
  const color = barrelPaint(variant);
  kit.part(group, 'cylinder', color, [0.71, 1.06, 0.71], [0, 0.53, 0]);
  for (const y of [0.1, 0.85, 1.04]) kit.part(group, 'cylinder', C.iron, [0.74, 0.055, 0.74], [0, y, 0]);
  kit.part(group, 'box', C.bone, [0.24, 0.25, 0.035], [0, 0.57, 0.36]);
  return kit.compile(group);
}

export { createPlant } from './plantModels';
