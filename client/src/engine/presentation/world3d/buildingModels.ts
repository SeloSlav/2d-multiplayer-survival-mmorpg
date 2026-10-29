import { Group, Vector3 } from 'three/webgpu';
import { COLORS as C, ModelKit } from './modelKit';
import { BUILDING, planBoundary, planFoundation, polygonArea } from './buildingPlan';

const TIER_MATERIALS = [
  { base: C.bark, surface: 0xa39168, alternate: 0x8d7a55, frame: C.bark },
  { base: C.woodDark, surface: C.wood, alternate: 0xaa8258, frame: C.woodDark },
  { base: 0x626b66, surface: 0x92998d, alternate: 0x7d877d, frame: 0x757e75 },
  { base: 0x46585a, surface: 0x788b87, alternate: 0x667d79, frame: 0x46585a },
] as const;

export function createFoundationModel(kit: ModelKit, tier: number, shape = 1, ceiling = false): Group {
  const plan = planFoundation(shape, tier);
  const group = new Group();
  const palette = TIER_MATERIALS[tier];
  for (const panel of plan.panels) {
    const offset = ceiling ? BUILDING.roofHeight : 0;
    kit.prism(group, palette[panel.material], panel.polygon, panel.bottom + offset, panel.top + offset);
  }
  const compiled = kit.compile(group);
  compiled.userData.ceiling = ceiling;
  compiled.userData.foundationPlan = { shape, tier, surfaceArea: polygonArea(plan.footprint) };
  return compiled;
}

export function createWallModel(kit: ModelKit, tier: number, edge = 0, foundationShape = 1): Group {
  const plan = planBoundary(edge, foundationShape);
  const group = new Group();
  const assembly = new Group();
  const p = TIER_MATERIALS[tier];
  if (!p) throw new Error(`Unknown wall tier ${tier}`);
  const base = BUILDING.floorTop;
  const height = BUILDING.wallHeight;
  const length = plan.length;
  const half = length / 2;
  if (tier === 0) {
    for (let i = 0; i <= 7; i++) {
      const x = -half + i / 7 * length;
      kit.beam(assembly, C.bark, new Vector3(x, base, 0), new Vector3(x + Math.sin(i * 3) * 0.025, base + height, 0), i % 7 ? 0.025 : 0.065);
    }
    for (let i = 0; i < 9; i++) {
      const y = base + 0.12 + i * height / 10;
      kit.beam(assembly, i % 2 ? C.barkLight : C.bark, new Vector3(-half, y, 0.035), new Vector3(half, y + 0.05, -0.035), 0.022);
    }
    kit.beam(assembly, C.barkLight, new Vector3(-half + 0.06, base + 0.1, 0.07), new Vector3(half - 0.06, base + height - 0.1, 0.07), 0.04);
  } else if (tier === 1) {
    const planks = Math.ceil(length / 0.24);
    for (let i = 0; i < planks; i++) kit.part(assembly, 'box', i % 3 ? p.surface : p.alternate,
      [length / planks - 0.009, height - 0.04, BUILDING.wallThickness], [-half + (i + 0.5) * length / planks, base + height / 2, 0]);
    for (const y of [base + 0.17, base + height - 0.17]) for (const z of [-0.095, 0.095]) {
      kit.part(assembly, 'box', p.frame, [length, 0.13, 0.08], [0, y, z]);
    }
  } else if (tier === 2) {
    kit.part(assembly, 'box', p.base, [length, height, 0.16], [0, base + height / 2, 0]);
    const brickWidth = 0.45;
    const courseHeight = height / 6;
    for (let row = 0; row < 6; row++) {
      for (let x = -half - (row % 2 ? brickWidth / 2 : 0); x < half; x += brickWidth) {
        const left = Math.max(-half, x);
        const right = Math.min(half, x + brickWidth);
        if (right - left > 0.01) kit.part(assembly, 'box', (row + Math.round(x * 10)) % 3 ? p.surface : p.alternate,
          [right - left - 0.012, courseHeight - 0.013, 0.23], [(left + right) / 2, base + (row + 0.5) * courseHeight, 0]);
      }
    }
  } else {
    kit.part(assembly, 'box', p.surface, [length, height, 0.09], [0, base + height / 2, 0]);
    for (let x = -half + 0.08; x < half; x += 0.32) {
      kit.part(assembly, 'box', p.alternate, [0.055, height, 0.17], [x, base + height / 2, 0]);
      for (const y of [base + 0.18, base + height - 0.18]) for (const z of [-0.1, 0.1]) {
        const bolt = kit.part(assembly, 'cylinder', C.steel, [0.037, 0.025, 0.037], [x, y, z]);
        bolt.rotation.x = Math.PI / 2;
      }
    }
  }
  for (const x of [-half + 0.035, half - 0.035]) kit.part(assembly, 'box', p.frame,
    [0.1, height + 0.05, 0.24], [x, base + height / 2, 0]);
  kit.part(assembly, 'box', p.frame, [length + 0.02, 0.1, 0.25], [0, base + height + 0.01, 0]);
  assembly.position.set(plan.center[0], 0, plan.center[1]);
  assembly.rotation.y = plan.yaw;
  group.add(assembly);
  const compiled = kit.compile(group);
  compiled.userData.boundaryPlan = plan;
  return compiled;
}

export function createFenceModel(kit: ModelKit, tier: number, edge: number): Group {
  const plan = planBoundary(edge, 1, true);
  const group = new Group();
  const assembly = new Group();
  const length = plan.length;
  const color = TIER_MATERIALS[Math.max(1, tier)]?.surface ?? C.wood;
  if (tier === 2) {
    for (let course = 0; course < 3; course++) for (let i = 0; i < 5; i++) {
      kit.part(assembly, 'box', (i + course) % 3 ? color : C.stoneDark, [length / 5 - 0.015, 0.24, 0.33],
        [-length / 2 + (i + 0.5) * length / 5, (course + 0.5) * 0.25, 0]);
    }
    kit.part(assembly, 'box', C.stone, [length, 0.08, 0.38], [0, 0.79, 0]);
  } else {
    for (const y of [0.3, 0.7]) kit.part(assembly, 'box', tier === 3 ? C.iron : C.woodDark, [length, 0.09, 0.12], [0, y, 0]);
    const count = tier === 3 ? 10 : 7;
    for (let i = 0; i < count; i++) {
      const x = -length / 2 + (i + 0.5) * length / count;
      kit.part(assembly, 'box', i % 3 ? color : tier === 3 ? C.iron : C.woodDark,
        [tier === 3 ? 0.04 : 0.14, 0.92, 0.08], [x, 0.46, 0.06]);
      kit.part(assembly, 'cone', tier === 3 ? C.steel : color, [tier === 3 ? 0.08 : 0.14, 0.15, 0.08], [x, 0.98, 0.06]);
    }
  }
  for (const x of [-length / 2 + 0.055, length / 2 - 0.055]) kit.part(assembly, 'box', tier === 3 ? C.iron : C.woodDark, [0.14, 1.04, 0.17], [x, 0.52, 0]);
  assembly.rotation.y = plan.yaw;
  group.add(assembly);
  return kit.compile(group);
}

export class DoorRig {
  readonly root = new Group();
  readonly hinge = new Group();
  private initialized = false;

  constructor(kit: ModelKit, type: number, edge: number, prototype?: Group) {
    if (prototype) {
      this.root = prototype.clone(true);
      this.hinge = this.root.getObjectByName('door-hinge') as Group;
      return;
    }
    if (type !== 0 && type !== 1) throw new Error(`Unknown door type ${type}`);
    const plan = planBoundary(edge, 1, true);
    const assembly = new Group();
    const frame = new Group();
    const width = plan.length;
    const base = BUILDING.floorTop;
    const height = BUILDING.wallHeight;
    const wood = type === 0;
    const trim = wood ? C.woodDark : C.iron;
    for (const x of [-width / 2 + 0.07, width / 2 - 0.07]) kit.part(frame, 'box', trim, [0.14, height + 0.05, 0.24], [x, base + height / 2, 0]);
    kit.part(frame, 'box', trim, [width, 0.16, 0.26], [0, base + height, 0]);
    assembly.add(kit.compile(frame));
    const leaf = new Group();
    const leafWidth = width - 0.3;
    if (wood) {
      for (let i = 0; i < 7; i++) kit.part(leaf, 'box', i % 3 ? C.wood : 0xad8355,
        [leafWidth / 7 - 0.007, height - 0.13, 0.11], [(i + 0.5) * leafWidth / 7, base + height / 2 - 0.02, 0]);
      const brace = kit.part(leaf, 'box', C.woodDark, [leafWidth * 1.1, 0.11, 0.065], [leafWidth / 2, base + height / 2, -0.085]);
      brace.rotation.z = 0.65;
    } else {
      kit.part(leaf, 'box', 0x687e79, [leafWidth, height - 0.13, 0.105], [leafWidth / 2, base + height / 2 - 0.02, 0]);
      for (const x of [0.1, leafWidth - 0.1]) kit.part(leaf, 'box', C.iron, [0.06, height - 0.15, 0.15], [x, base + height / 2, 0]);
    }
    for (const y of [base + 0.32, base + height - 0.32]) kit.part(leaf, 'box', C.iron, [leafWidth, 0.09, 0.14], [leafWidth / 2, y, 0]);
    kit.part(leaf, 'box', C.steel, [0.075, 0.15, 0.065], [leafWidth - 0.14, base + height * 0.48, 0.1]);
    this.hinge.position.x = -leafWidth / 2;
    this.hinge.name = 'door-hinge';
    this.hinge.add(kit.compile(leaf));
    assembly.add(this.hinge);
    assembly.rotation.y = plan.yaw;
    this.root.add(assembly);
  }

  update(open: boolean, dt: number): void {
    const target = open ? -Math.PI * 0.49 : 0;
    this.hinge.rotation.y = this.initialized ? this.hinge.rotation.y + (target - this.hinge.rotation.y) * (1 - Math.exp(-dt * 12)) : target;
    this.initialized = true;
  }
}
