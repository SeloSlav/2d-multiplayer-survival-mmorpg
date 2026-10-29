import { Group, Vector3 } from 'three/webgpu';
import { COLORS as C, ModelKit } from './modelKit';
import { cauldron, fireAssembly, ring } from './placeablePrimitives';

export const CAMP_MODEL_TABLES = ['furnaces', 'barbecues', 'lanterns', 'homesteadHearths', 'brothPots', 'sleepingBags', 'stashes', 'shelters', 'rainCollectors'] as const;

export function createFurnace(kit: ModelKit, large: boolean): Group {
  const group = new Group();
  const base = new Group();
  const radius = large ? 0.83 : 0.64;
  kit.part(base, 'cylinder', C.stoneDark, [radius * 2.1, 0.14, radius * 2.1], [0, 0.07, 0]);
  if (large) {
    ring(kit, base, 0x7c8173, radius, 0.15, 0.14, 0.55, 12, true);
    ring(kit, base, C.iron, radius, 0.14, 0.56, 1.65, 12, false);
    for (const y of [0.61, 1.12, 1.59]) ring(kit, base, C.steel, radius + 0.04, 0.05, y, y + 0.055);
    kit.vessel(base, C.iron, radius, 0.28, 0.1, 0.48).position.y = 1.66;
    kit.vessel(base, C.iron, 0.28, 0.26, 0.07, 0.68).position.y = 2.1;
    for (const x of [-0.55, 0.55]) kit.part(base, 'box', C.iron, [0.12, 1.1, 0.13], [x, 0.55, 0.71]);
    kit.part(base, 'box', C.woodDark, [0.56, 0.07, 0.66], [0, 0.15, 1.04]);
  } else {
    ring(kit, base, 0x9d8b70, radius, 0.14, 0.14, 0.55, 12, true);
    for (let level = 0; level < 4; level++) {
      const r = radius - level * 0.09;
      ring(kit, base, level % 2 ? 0xa79375 : 0x8f8068, r, 0.14, 0.55 + level * 0.18, 0.73 + level * 0.18, 12);
    }
    kit.vessel(base, C.stoneDark, 0.26, 0.23, 0.08, 0.45).position.y = 1.23;
  }
  kit.part(base, 'box', C.coal, [0.59, 0.07, 0.45], [0, 0.15, 0.12]);
  group.add(kit.compile(base));
  const fire = fireAssembly(kit, large ? 0.44 : 0.36, 0.15);
  fire.position.set(0, 0.18, 0.22);
  group.add(fire);
  return group;
}

export function createBarbecue(kit: ModelKit): Group {
  const group = new Group();
  const base = new Group();
  for (const x of [-0.47, 0.47]) for (const z of [-0.27, 0.27]) kit.part(base, 'box', C.iron, [0.055, 0.63, 0.055], [x, 0.32, z]);
  kit.part(base, 'box', C.iron, [1.12, 0.08, 0.72], [0, 0.61, 0]);
  for (const sign of [-1, 1]) {
    kit.part(base, 'box', C.iron, [1.12, 0.25, 0.065], [0, 0.77, sign * 0.34]);
    kit.part(base, 'box', C.iron, [0.065, 0.25, 0.72], [sign * 0.53, 0.77, 0]);
  }
  for (let i = 0; i < 11; i++) kit.part(base, 'box', C.steel, [0.025, 0.025, 0.68], [-0.48 + i * 0.096, 0.91, 0]);
  for (let i = 0; i < 6; i++) kit.part(base, 'rock', C.coal, [0.21, 0.13, 0.2], [Math.sin(i * 2.4) * 0.35, 0.69, Math.cos(i * 2.4) * 0.2]);
  group.add(kit.compile(base));
  const fire = fireAssembly(kit, 0.2, 0.13); fire.position.y = 0.68; group.add(fire);
  return group;
}

export function createLantern(kit: ModelKit, type: number): Group {
  const group = new Group();
  const base = new Group();
  let lightHeight = 0.46;
  let lightColor = C.flame as number;
  if (type === 0) {
    kit.part(base, 'box', C.iron, [0.34, 0.09, 0.29], [0, 0.07, 0]);
    for (const x of [-0.14, 0.14]) for (const z of [-0.11, 0.11]) kit.part(base, 'box', C.iron, [0.035, 0.43, 0.035], [x, 0.3, z]);
    kit.part(base, 'cone', C.iron, [0.43, 0.18, 0.37], [0, 0.59, 0]);
    kit.beam(base, C.iron, new Vector3(-0.12, 0.67, 0), new Vector3(0, 0.84, 0), 0.018);
    kit.beam(base, C.iron, new Vector3(0, 0.84, 0), new Vector3(0.12, 0.67, 0), 0.018);
    lightHeight = 0.18;
  } else if (type === 1) {
    kit.part(base, 'rock', C.stoneDark, [0.71, 0.19, 0.66], [0, 0.09, 0]);
    kit.beam(base, C.bark, new Vector3(0, 0.12, 0), new Vector3(0, 1.28, 0), 0.1);
    for (const sign of [-1, 1]) {
      kit.beam(base, C.bark, new Vector3(0, 0.83, 0), new Vector3(sign * 0.43, 1.14, 0), 0.045);
      kit.part(base, 'rock', C.bone, [0.16, 0.23, 0.12], [sign * 0.4, 1.02, 0]);
    }
    kit.part(base, 'rock', C.bone, [0.31, 0.35, 0.25], [0, 1.23, 0]);
    for (const x of [-0.065, 0.065]) kit.part(base, 'box', C.coal, [0.055, 0.065, 0.03], [x, 1.26, 0.13]);
    lightHeight = 1.45; lightColor = 0x8fc5c0;
  } else if (type === 2) {
    kit.part(base, 'box', 0x63786c, [0.78, 0.6, 0.51], [0, 0.3, 0]);
    for (const x of [-0.23, 0.23]) {
      kit.beam(base, C.iron, new Vector3(x, 0.59, 0), new Vector3(x, x < 0 ? 1.65 : 1.37, 0), 0.018);
      kit.part(base, 'cylinder', C.steel, [0.12, 0.31, 0.12], [x, 0.96, 0]);
    }
    kit.part(base, 'box', C.iron, [0.54, 0.34, 0.03], [0, 0.35, 0.27]);
    for (let i = 0; i < 4; i++) kit.part(base, 'box', C.steel, [0.24, 0.02, 0.025], [-0.06, 0.26 + i * 0.05, 0.29]);
    lightHeight = 0.42; lightColor = 0x84bce0;
  } else if (type === 3) {
    kit.part(base, 'cylinder', C.iron, [0.64, 0.13, 0.64], [0, 0.07, 0]);
    for (const sign of [-1, 1]) kit.beam(base, C.steel, new Vector3(sign * 0.26, 0.14, 0), new Vector3(sign * 0.2, 1.28, 0), 0.025);
    for (const y of [0.37, 1.13]) ring(kit, base, C.iron, 0.38, 0.05, y, y + 0.05);
    kit.part(base, 'rock', 0x79a9ad, [0.27, 0.65, 0.27], [0, 0.74, 0]);
    lightHeight = 0.6; lightColor = 0x82d0e1;
  } else throw new Error(`Unknown lantern type ${type}`);
  group.add(kit.compile(base));
  const fire = fireAssembly(kit, type === 0 ? 0.3 : 0.25, type === 0 ? 0.065 : 0.09, lightColor);
  fire.position.y = lightHeight;
  group.add(fire);
  return group;
}

export function createHearth(kit: ModelKit): Group {
  const group = new Group();
  const base = new Group();
  for (const sign of [-1, 1]) for (let i = 0; i < 5; i++) kit.part(base, 'box', i % 2 ? C.stone : C.stoneDark,
    [0.33, 0.26, 0.72], [sign * 0.57, 0.14 + i * 0.27, -0.1]);
  kit.part(base, 'box', C.stone, [1.55, 0.2, 0.92], [0, 1.46, -0.1]);
  kit.part(base, 'box', C.stoneDark, [1.32, 0.15, 0.9], [0, 0.08, -0.1]);
  kit.part(base, 'box', C.stoneDark, [1.2, 1.25, 0.12], [0, 0.73, -0.44]);
  for (let i = 0; i < 3; i++) kit.beam(base, C.woodDark, new Vector3(-0.43, 0.22 + i * 0.09, -0.15), new Vector3(0.43, 0.25 + i * 0.09, 0.15), 0.07);
  group.add(kit.compile(base));
  const fire = fireAssembly(kit, 0.6, 0.17); fire.position.set(0, 0.3, -0.04); group.add(fire);
  return group;
}

export function createBrothPot(kit: ModelKit): Group {
  const group = new Group();
  const support = new Group();
  for (let i = 0; i < 3; i++) {
    const angle = i / 3 * Math.PI * 2;
    kit.beam(support, C.iron, new Vector3(Math.cos(angle) * 0.5, 0, Math.sin(angle) * 0.5), new Vector3(Math.cos(angle) * 0.29, 0.5, Math.sin(angle) * 0.29), 0.025);
  }
  group.add(kit.compile(support));
  const pot = cauldron(kit); pot.position.y = 0.27; group.add(pot);
  return group;
}

export function createSleepingBag(kit: ModelKit): Group {
  const group = new Group();
  kit.part(group, 'rock', 0x718478, [0.73, 0.26, 1.75], [0, 0.12, 0]);
  kit.part(group, 'rock', 0xb3b09a, [0.61, 0.17, 0.39], [0, 0.15, -0.68]);
  for (let i = 0; i < 5; i++) kit.part(group, 'box', 0x5d7165, [0.6, 0.012, 0.024], [0, 0.245, -0.34 + i * 0.2]);
  kit.part(group, 'box', C.leather, [0.035, 0.015, 1.14], [0.3, 0.2, 0.08]);
  return kit.compile(group);
}

export function createStash(kit: ModelKit): Group {
  const group = new Group();
  kit.part(group, 'box', C.woodDark, [0.77, 0.17, 0.55], [0, -0.01, 0]);
  for (let i = 0; i < 4; i++) kit.part(group, 'box', C.wood, [0.17, 0.045, 0.57], [-0.27 + i * 0.18, 0.095, 0]);
  kit.part(group, 'box', C.iron, [0.15, 0.035, 0.065], [0, 0.13, 0.12]);
  for (let i = 0; i < 5; i++) kit.part(group, 'rock', C.leaf, [0.2, 0.1, 0.16], [Math.cos(i * 2.4) * 0.43, 0.03, Math.sin(i * 2.4) * 0.3]);
  return kit.compile(group);
}

export { createBrushShelter as createShelter } from './shelterModels';

export function createRainCollector(kit: ModelKit): Group {
  const group = new Group();
  for (let i = 0; i < 10; i++) {
    const angle = i / 10 * Math.PI * 2;
    kit.beam(group, C.barkLight, new Vector3(Math.cos(angle) * 0.39, 0, Math.sin(angle) * 0.39), new Vector3(Math.cos(angle) * 0.5, 1.35, Math.sin(angle) * 0.5), 0.025);
  }
  kit.vessel(group, 0x967b4d, 0.4, 0.44, 0.065, 0.74);
  for (const y of [0.13, 0.57]) ring(kit, group, C.woodDark, 0.445, 0.045, y, y + 0.045);
  kit.vessel(group, 0xa7a282, 0.21, 0.72, 0.025, 0.57).position.y = 0.89;
  ring(kit, group, C.bark, 0.74, 0.04, 1.44, 1.49);
  kit.part(group, 'cylinder', 0x6c9692, [0.66, 0.025, 0.66], [0, 0.6, 0]);
  return kit.compile(group);
}
