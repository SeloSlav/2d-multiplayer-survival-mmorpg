import { Group, Vector3 } from 'three/webgpu';
import { COLORS as C, ModelKit } from './modelKit';
import { createCrate } from './environmentModels';
import { cauldron, ring, tableFrame } from './placeablePrimitives';

/** Numeric IDs come directly from server/src/wooden_storage_box.rs. */
export const STORAGE_MODELS = [
  'Wooden box', 'Large wooden box', 'Refrigerator', 'Compost bin', 'Backpack', 'Repair bench',
  'Cooking station', 'Scarecrow', 'Military ration', 'Mine cart', 'Fish trap', 'Wild beehive',
  'Wooden beehive', 'Military crate', 'Wolf pelt', 'Fox pelt', 'Polar bear pelt', 'Walrus pelt', 'Tanning rack',
] as const;

export function createStorageModel(kit: ModelKit, type: number): Group {
  if (!STORAGE_MODELS[type]) throw new Error(`Unknown storage object ${type}`);
  if (type === 0 || type === 1) {
    const crate = createCrate(kit);
    if (type === 1) crate.scale.set(1.55, 1.1, 1.18);
    crate.userData.storageType = type;
    return crate;
  }
  const group = new Group();
  const box = (color: number, size: [number, number, number], at: [number, number, number]) => kit.part(group, 'box', color, size, at);
  const rock = (color: number, size: [number, number, number], at: [number, number, number]) => kit.part(group, 'rock', color, size, at);
  if (type === 2) {
    box(0x6c817b, [0.9, 1.85, 0.75], [0, 1, 0]);
    box(0xb4bdb0, [0.83, 1.21, 0.09], [0, 0.78, 0.405]);
    box(0xc8cebf, [0.83, 0.46, 0.09], [0, 1.66, 0.405]);
    for (const y of [1.1, 1.65]) box(C.iron, [0.055, 0.21, 0.07], [-0.29, y, 0.48]);
    for (let i = 0; i < 5; i++) box(C.iron, [0.47, 0.025, 0.025], [0, 0.18 + i * 0.035, 0.39]);
    for (const x of [-0.31, 0.31]) for (const z of [-0.25, 0.25]) box(C.iron, [0.1, 0.13, 0.1], [x, 0.065, z]);
  } else if (type === 3) {
    for (const x of [-0.55, 0.55]) for (const z of [-0.43, 0.43]) box(C.woodDark, [0.11, 0.92, 0.11], [x, 0.46, z]);
    for (let i = 0; i < 5; i++) {
      const y = 0.1 + i * 0.17;
      for (const z of [-0.43, 0.43]) box(C.wood, [1.2, 0.13, 0.07], [0, y, z]);
      for (const x of [-0.55, 0.55]) box(C.wood, [0.07, 0.13, 0.9], [x, y, 0]);
    }
    box(0x514d35, [1.04, 0.3, 0.74], [0, 0.49, 0]);
    for (let i = 0; i < 8; i++) rock(i % 2 ? C.leaf : 0xa48c58, [0.23, 0.1, 0.18], [Math.sin(i * 2.4) * 0.4, 0.67, Math.cos(i * 2.4) * 0.25]);
  } else if (type === 4) {
    rock(C.leather, [0.66, 0.77, 0.37], [0, 0.39, 0]);
    box(0x92714f, [0.42, 0.27, 0.13], [0, 0.31, 0.22]);
    for (const x of [-0.18, 0.18]) box(C.woodDark, [0.055, 0.56, 0.06], [x, 0.41, -0.22]);
    kit.part(group, 'cylinder', 0xb0a17d, [0.2, 0.65, 0.2], [0, 0.81, 0]).rotation.z = Math.PI / 2;
    box(C.iron, [0.09, 0.09, 0.035], [0, 0.38, 0.3]);
  } else if (type === 5 || type === 6) {
    tableFrame(kit, group, 1.6, 0.85, 0.92);
    if (type === 5) {
      box(C.iron, [0.39, 0.17, 0.35], [-0.42, 1.05, 0.23]);
      for (const x of [-0.56, -0.31]) box(C.steel, [0.08, 0.22, 0.27], [x, 1.19, 0.23]);
      kit.beam(group, C.iron, new Vector3(-0.44, 0.98, 0.4), new Vector3(-0.44, 0.98, 0.65), 0.035);
      kit.beam(group, C.wood, new Vector3(0.15, 1.01, 0.15), new Vector3(0.58, 1.01, -0.1), 0.03);
      box(C.steel, [0.18, 0.09, 0.13], [0.6, 1.03, -0.1]);
      for (let i = 0; i < 3; i++) box(C.steel, [0.12, 0.025, 0.27], [0.1 + i * 0.2, 1, -0.21]);
    } else {
      const pot = cauldron(kit); pot.scale.setScalar(0.56); pot.position.set(-0.42, 0.98, -0.05); group.add(pot);
      box(0xba9a68, [0.5, 0.035, 0.42], [0.37, 0.99, 0.03]);
      box(C.steel, [0.22, 0.025, 0.055], [0.37, 1.02, 0.06]);
      for (let i = 0; i < 3; i++) rock(i % 2 ? 0xb98749 : C.leaf, [0.1, 0.12, 0.1], [0.26 + i * 0.13, 1.07, -0.11]);
      box(0xc8bda0, [0.29, 0.43, 0.04], [0.3, 0.72, 0.46]);
    }
  } else if (type === 7) {
    kit.beam(group, C.bark, new Vector3(0, 0, 0), new Vector3(0, 1.83, 0), 0.07);
    kit.beam(group, C.woodDark, new Vector3(-0.8, 1.25, 0), new Vector3(0.8, 1.25, 0), 0.045);
    rock(0x967950, [0.58, 0.68, 0.34], [0, 1.1, 0]);
    for (const sign of [-1, 1]) box(0x967950, [0.52, 0.19, 0.25], [sign * 0.45, 1.25, 0]);
    rock(0xc0a46d, [0.35, 0.39, 0.32], [0, 1.64, 0]);
    kit.part(group, 'cone', 0x9e8050, [0.72, 0.26, 0.66], [0, 1.92, 0]);
    for (const x of [-0.075, 0.075]) box(C.coal, [0.035, 0.045, 0.025], [x, 1.68, 0.163]);
    for (let i = 0; i < 6; i++) kit.beam(group, C.barkLight, new Vector3(-0.23 + i * 0.09, 0.93, 0), new Vector3(-0.25 + i * 0.1, 0.62, 0.02), 0.018);
  } else if (type === 8 || type === 13) {
    const width = type === 8 ? 0.65 : 1.2;
    const height = type === 8 ? 0.38 : 0.82;
    box(0x66734e, [width, height, width * 0.7], [0, height / 2, 0]);
    box(0x7e875f, [width + 0.035, 0.08, width * 0.74], [0, height, 0]);
    for (const x of [-width * 0.32, width * 0.32]) box(C.iron, [0.06, height + 0.08, width * 0.76], [x, height / 2, 0]);
    box(C.bone, [width * 0.27, 0.05, 0.02], [0, height * 0.58, width * 0.36]);
    if (type === 8) box(C.bone, [0.05, 0.19, 0.02], [0, height * 0.58, width * 0.36]);
    else for (const sign of [-1, 1]) box(C.iron, [0.035, 0.13, 0.27], [sign * width * 0.52, height * 0.63, 0]);
  } else if (type === 9) {
    box(C.iron, [1.17, 0.11, 0.77], [0, 0.39, 0]);
    for (const sign of [-1, 1]) {
      box(0x788783, [1.3, 0.62, 0.08], [0, 0.73, sign * 0.41]);
      box(0x6a7b77, [0.08, 0.62, 0.87], [sign * 0.62, 0.73, 0]);
      box(C.iron, [1.38, 0.07, 0.1], [0, 1.04, sign * 0.42]);
      for (const z of [-0.3, 0.3]) kit.part(group, 'cylinder', C.coal, [0.33, 0.12, 0.33], [sign * 0.57, 0.21, z]).rotation.z = Math.PI / 2;
    }
    for (let i = 0; i < 5; i++) rock(i % 2 ? C.stone : C.stoneDark, [0.38, 0.32, 0.34], [Math.sin(i * 2.4) * 0.36, 0.66, Math.cos(i * 2.4) * 0.24]);
  } else if (type === 10) {
    const cage = new Group();
    for (let i = 0; i < 12; i++) {
      const angle = i / 12 * Math.PI * 2;
      kit.beam(cage, C.barkLight, new Vector3(Math.cos(angle) * 0.34, -0.58, Math.sin(angle) * 0.34), new Vector3(Math.cos(angle) * 0.34, 0.58, Math.sin(angle) * 0.34), 0.018);
    }
    for (const y of [-0.55, -0.25, 0.1, 0.5]) ring(kit, cage, C.woodDark, 0.36, 0.035, y, y + 0.04);
    ring(kit, cage, C.barkLight, 0.28, 0.07, 0.4, 0.54);
    cage.rotation.x = Math.PI / 2;
    cage.position.y = 0.36;
    group.add(cage);
    kit.beam(group, C.leather, new Vector3(0, 0.7, 0.35), new Vector3(0.36, 0.1, 0.75), 0.016);
  } else if (type === 11) {
    for (let i = 0; i < 6; i++) kit.part(group, 'skirt', i % 2 ? 0x9d8053 : 0x887044,
      [0.78 - i * 0.075, 0.18, 0.78 - i * 0.075], [0, 0.12 + i * 0.145, 0]);
    box(C.coal, [0.14, 0.07, 0.025], [0, 0.39, 0.31]);
    kit.beam(group, C.bark, new Vector3(-0.4, 1.07, 0), new Vector3(0.38, 1.13, 0), 0.045);
  } else if (type === 12) {
    for (let i = 0; i < 3; i++) {
      box(i % 2 ? 0xb08c55 : 0x9d7948, [0.77, 0.27, 0.62], [0, 0.24 + i * 0.29, 0]);
      box(C.woodDark, [0.81, 0.035, 0.66], [0, 0.39 + i * 0.29, 0]);
    }
    box(C.woodDark, [0.92, 0.11, 0.74], [0, 1.02, 0]);
    box(C.coal, [0.4, 0.035, 0.02], [0, 0.14, 0.32]);
    box(C.wood, [0.5, 0.055, 0.23], [0, 0.1, 0.43]);
    for (const x of [-0.26, 0.26]) box(C.woodDark, [0.11, 0.16, 0.51], [x, 0.08, 0]);
  } else if (type >= 14 && type <= 17) {
    const fur = type === 14 ? 0x949b91 : type === 15 ? 0xb87e4b : type === 16 ? 0xd8d5bf : 0x9d8973;
    const width = type === 16 ? 1.25 : type === 17 ? 1.35 : 0.82;
    rock(fur, [width, 0.11, 1.42], [0, 0.065, 0]);
    for (const x of [-1, 1]) for (const z of [-1, 1]) rock(fur, [width * 0.46, 0.065, 0.27], [x * width * 0.44, 0.045, z * 0.45]);
    rock(fur, [width * 0.42, 0.23, 0.44], [0, 0.12, 0.79]);
    rock(C.coal, [0.12, 0.07, 0.1], [0, 0.14, 0.99]);
    if (type === 17) for (const sign of [-1, 1]) kit.part(group, 'cone', C.bone, [0.07, 0.29, 0.07], [sign * 0.16, 0.17, 1.01]).rotation.x = Math.PI / 2;
    else for (const sign of [-1, 1]) kit.part(group, 'cone', fur, [0.14, 0.17, 0.08], [sign * width * 0.17, 0.27, 0.73]);
  } else if (type === 18) {
    for (const x of [-0.65, 0.65]) {
      kit.beam(group, C.bark, new Vector3(x, 0, -0.2), new Vector3(x, 1.65, 0), 0.055);
      kit.beam(group, C.bark, new Vector3(x, 0, 0.35), new Vector3(x, 1.2, 0), 0.04);
    }
    kit.beam(group, C.barkLight, new Vector3(-0.72, 1.58, 0), new Vector3(0.72, 1.58, 0), 0.06);
    const hide = new Group();
    kit.prism(hide, 0xb19a70, [[-0.44, -0.51], [0.34, -0.56], [0.5, -0.22], [0.4, 0.46], [-0.34, 0.54], [-0.5, 0.13]], -0.02, 0.02);
    hide.rotation.x = Math.PI / 2; hide.position.set(0, 0.95, 0.03); group.add(hide);
    for (const x of [-0.45, 0.45]) for (const y of [0.61, 1, 1.4]) kit.beam(group, C.bone,
      new Vector3(x, y, 0.03), new Vector3(Math.sign(x) * 0.65, y + 0.06, 0), 0.012);
  }
  const compiled = kit.compile(group);
  compiled.userData.storageType = type;
  compiled.userData.assetName = STORAGE_MODELS[type];
  return compiled;
}
