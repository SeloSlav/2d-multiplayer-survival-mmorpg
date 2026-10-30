import { Group, Mesh, Vector3 } from 'three/webgpu';
import { ModelKit } from './modelKit';
import { GROUND_Y_SCALE, seededRandom, WORLD_3D } from './visualContract';

interface TreeProfile {
  form: 'spire' | 'weeping' | 'umbrella' | 'crooked' | 'deciduous' | 'shrub';
  height: number; spread: number; start: number; branches: number; stems: number;
  /** Bare trunk height that must remain visible below the projected crown. */
  trunkClearance: number;
  bark: number; leaf: number; light: number; lean: number; droop: number;
  fruit?: 'apple' | 'hazel' | 'rowan' | 'olive'; snow?: boolean; whiteBark?: boolean;
}

/** Each server species owns its silhouette, branching habit and material identity. */
export const TREE_PROFILES: Record<string, TreeProfile> = {
  SiberianBirch: { form: 'deciduous', height: 4.1, spread: 2.6, start: .42, branches: 12, stems: 1, trunkClearance: 1.6, bark: 0xd0d3bb, leaf: 0x6f8c4d, light: 0xa5b36a, lean: .13, droop: .2, whiteBark: true },
  SitkaAlder: { form: 'deciduous', height: 3.3, spread: 3.15, start: .29, branches: 11, stems: 3, trunkClearance: 1.5, bark: 0x787468, leaf: 0x60804d, light: 0x8da65b, lean: .26, droop: .1 },
  SitkaAlder2: { form: 'weeping', height: 3.85, spread: 2.75, start: .43, branches: 13, stems: 1, trunkClearance: 1.5, bark: 0xbdc8b5, leaf: 0x638f54, light: 0x94b66b, lean: -.12, droop: .64, whiteBark: true },
  ArcticWillow: { form: 'shrub', height: 1.6, spread: 2.2, start: .18, branches: 10, stems: 5, trunkClearance: 1.2, bark: 0x7c8b80, leaf: 0x8eaaa0, light: 0xbdc9aa, lean: .33, droop: .08 },
  SitkaSpruce: { form: 'spire', height: 5.35, spread: 3.15, start: .14, branches: 8, stems: 1, trunkClearance: 1.5, bark: 0x69513b, leaf: 0x294d3e, light: 0x557a4d, lean: .04, droop: .12 },
  MountainHemlock: { form: 'weeping', height: 4.55, spread: 2.5, start: .24, branches: 7, stems: 1, trunkClearance: 1.45, bark: 0x77624a, leaf: 0x385b4a, light: 0x728a59, lean: .15, droop: .43 },
  MountainHemlock2: { form: 'spire', height: 6.1, spread: 3.65, start: .12, branches: 10, stems: 1, trunkClearance: 1.65, bark: 0x76543b, leaf: 0x345c42, light: 0x6c8d50, lean: -.06, droop: .26 },
  DwarfPine: { form: 'umbrella', height: 2.0, spread: 3.1, start: .25, branches: 10, stems: 3, trunkClearance: 1.65, bark: 0x806249, leaf: 0x44674d, light: 0x7b9561, lean: .35, droop: .07 },
  MountainHemlockSnow: { form: 'spire', height: 3.8, spread: 2.75, start: .19, branches: 7, stems: 1, trunkClearance: 1.9, bark: 0x6d6255, leaf: 0x415b53, light: 0x6e8271, lean: .16, droop: .32, snow: true },
  KrummholzSpruce: { form: 'crooked', height: 2.85, spread: 3.7, start: .18, branches: 8, stems: 1, trunkClearance: 1.85, bark: 0x77715a, leaf: 0x456653, light: 0x819572, lean: .95, droop: .08 },
  CrabAppleTree: { form: 'deciduous', height: 2.9, spread: 2.9, start: .3, branches: 9, stems: 1, trunkClearance: 1.9, bark: 0x705442, leaf: 0x5f7c43, light: 0x98a955, lean: .22, droop: .16, fruit: 'apple' },
  HazelnutTree: { form: 'shrub', height: 2.45, spread: 2.8, start: .16, branches: 11, stems: 5, trunkClearance: 1.6, bark: 0x8a7559, leaf: 0x6c8346, light: 0xa3ad5d, lean: .14, droop: .12, fruit: 'hazel' },
  RowanberryTree: { form: 'deciduous', height: 3.65, spread: 2.65, start: .43, branches: 10, stems: 2, trunkClearance: 2.0, bark: 0x8b8271, leaf: 0x718a4d, light: 0xa9b373, lean: -.16, droop: .18, fruit: 'rowan' },
  OliveTree: { form: 'umbrella', height: 2.95, spread: 3.2, start: .27, branches: 9, stems: 1, trunkClearance: 1.9, bark: 0x81745c, leaf: 0x78856a, light: 0xacb395, lean: .35, droop: .23, fruit: 'olive' },
};

export function createTree(kit: ModelKit, type: string, seed: number): Group {
  const p = TREE_PROFILES[type];
  if (!p) throw new Error(`Unfinished tree species ${type}`);
  const random = seededRandom(seed), group = new Group();
  const h = p.height * (.93 + random() * .14), spread = p.spread * (.94 + random() * .12);
  const conifer = ['SitkaSpruce', 'MountainHemlock', 'MountainHemlock2', 'DwarfPine', 'MountainHemlockSnow', 'KrummholzSpruce'].includes(type);
  const radius = h * (p.form === 'crooked' ? .065 : p.stems > 1 ? .027 : .042);
  const trunk: Vector3[] = [];
  for (let i = 0; i <= 7; i++) {
    const t = i / 7;
    trunk.push(new Vector3(p.lean * t + (p.form === 'crooked' ? Math.sin(t * 7) * .3 * t : Math.sin(t * 4) * .05), h * t,
      Math.sin(t * 3 + seed) * t * .1));
  }
  const stems: Vector3[][] = [];
  for (let s = 1; s < p.stems; s++) {
    const a = s * 2.4, tip = new Vector3(Math.cos(a) * spread * .23, h * (.6 + random() * .2), Math.sin(a) * spread * .23);
    stems.push([new Vector3(.04 * s, 0, 0), tip.clone().multiplyScalar(.45), tip]);
  }
  for (let i = 0; i < 5; i++) {
    const a = i * 1.256 + .2;
    kit.branch(group, p.bark, [new Vector3(Math.cos(a) * radius, .22, Math.sin(a) * radius), new Vector3(Math.cos(a) * radius * 2.8, .01, Math.sin(a) * radius * 2.8)], [radius * .55, .015]);
  }
  const boughs = new Group(), crown = new Group(); group.add(boughs); boughs.add(crown);
  let branchCount = 0;
  const spray = (tip: Vector3, angle: number, length: number, tier: number) => {
    if (conifer) {
      // Individual boughs leave gaps between whorls; no stacked whole-tree cones.
      for (let j = 0; j < 3; j++) {
        const a = angle + (j - 1) * .48;
        const tuft = kit.part(crown, 'rock', (j + tier) % 3 ? p.leaf : p.light,
          [length * .58, .22 + length * .24, length * 1.25],
          [tip.x + Math.sin(a) * length * .14, tip.y - j * .025, tip.z + Math.cos(a) * length * .14]);
        tuft.rotation.set(-p.droop * .55, a, (random() - .5) * .12);
        if (p.snow && j !== 1) kit.part(crown, 'rock', 0xdce3db,
          [length * .5, .12, length * 1.04], [tuft.position.x, tip.y + .17, tuft.position.z]).rotation.y = a;
      }
    } else {
      const small = p.form === 'shrub';
      for (let j = 0; j < (type === 'RowanberryTree' ? 4 : small ? 6 : 8); j++) {
        const a = angle + j * 2.399, r = length * (.2 + random() * .4);
        const leaf = kit.part(crown, 'leaf', j % 3 ? p.leaf : p.light,
          [length * (type === 'ArcticWillow' || type === 'OliveTree' ? .17 : .36), .035, length * .55],
          [tip.x + Math.sin(a) * r, tip.y + (random() - .4) * length * .4, tip.z + Math.cos(a) * r]);
        leaf.rotation.set(.25 + random() * .6, a, (random() - .5) * .4);
        if (type === 'RowanberryTree') for (let k = 0; k < 3; k++) {
          const leaflet = kit.part(crown, 'leaf', j % 3 ? p.leaf : p.light, [length * .1, .022, length * .26],
            [leaf.position.x + Math.sin(a + 1.1) * k * .09, leaf.position.y + .02, leaf.position.z + Math.cos(a + 1.1) * k * .09]);
          leaflet.rotation.copy(leaf.rotation);
        }
      }
      if (p.fruit) for (let j = 0; j < (p.fruit === 'rowan' ? 5 : 3); j++) {
        const color = p.fruit === 'apple' ? 0xb8623d : p.fruit === 'rowan' ? 0xce6946 : p.fruit === 'olive' ? 0x454e36 : 0xb09355;
        const size = p.fruit === 'rowan' ? .065 : p.fruit === 'olive' ? .075 : .12;
        kit.part(crown, 'rock', color, [size, size * 1.15, size], [tip.x + (random() - .5) * .28, tip.y - .18 - random() * .1, tip.z + (random() - .5) * .28]);
      }
    }
  };
  for (let slot = 0; slot < p.branches; slot++) {
    const t = p.start + (slot + random() * .35) / p.branches * (1 - p.start - .03);
    const source = trunk[Math.min(6, Math.floor(t * 7))].clone().lerp(trunk[Math.min(7, Math.floor(t * 7) + 1)], t * 7 % 1);
    const whorl = conifer && p.form !== 'crooked' && p.form !== 'umbrella' ? 5 : 1;
    for (let b = 0; b < whorl; b++) {
      const a = slot * 2.399 + b / whorl * Math.PI * 2 + random() * .25;
      const reach = spread * .48 * (conifer && p.form !== 'umbrella' && p.form !== 'crooked' ? Math.pow(1 - t, .72) : .6 + random() * .4);
      const rise = conifer ? reach * (.13 - p.droop) : (1 - t) * h * .35;
      const tip = source.clone().add(new Vector3(Math.sin(a) * reach, rise, Math.cos(a) * reach));
      const mid = source.clone().lerp(tip, .55); mid.y += conifer ? .12 : .2;
      kit.branch(boughs, p.bark, [source, mid, tip], [radius * .42 * (1 - t * .65), radius * .18, .012]); branchCount++;
      for (let j = 0; j < (conifer ? 2 : 4); j++) {
        const f = (conifer ? .6 : .5) + j * (conifer ? .36 : .16), side = j % 2 ? 1 : -1;
        const start = mid.clone().lerp(tip, (f - .5) * 2);
        const end = start.clone().add(new Vector3(Math.sin(a + side * .8) * reach * .28, .12 - p.droop * .2, Math.cos(a + side * .8) * reach * .28));
        kit.branch(boughs, p.bark, [start, end], [.024, .008], 5); branchCount++;
        spray(end, a + side * .6, conifer ? .33 + reach * .42 : .6 + reach * .24, slot + j);
      }
    }
  }
  if (conifer && p.form === 'spire') spray(trunk[7], 0, .4, 0);
  // Height alone is insufficient: foreground foliage projects down over the
  // trunk in the oblique camera. Measure the entire crown, including drooping
  // tufts, snow and fruit. The production wrapper stretches depth after local
  // yaw, so include that stretch when reserving clearance at every azimuth.
  const slope = GROUND_Y_SCALE * Math.tan(WORLD_3D.elevationRadians), vertex = new Vector3();
  let crownFloor = Infinity;
  crown.updateMatrixWorld(true);
  crown.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const positions = object.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      crownFloor = Math.min(crownFloor, vertex.y - Math.hypot(vertex.x, vertex.z) * slope);
    }
  });
  const trunkExtension = Math.max(0, p.trunkClearance - crownFloor);
  boughs.position.y = trunkExtension;
  const branchStart = h * p.start;
  const lift = (point: Vector3) => point.clone().add(new Vector3(0, trunkExtension * Math.min(1, point.y / branchStart), 0));
  const growStem = (points: Vector3[], radii: number[], segments = 6) => {
    const extended: Vector3[] = [], thickness: number[] = [];
    points.forEach((point, i) => {
      const previous = points[i - 1];
      if (previous && previous.y < branchStart && point.y > branchStart) {
        // Keep the bend at the crown's origin explicit so the first bough
        // stays attached when the bare portion of the trunk is lengthened.
        const t = (branchStart - previous.y) / (point.y - previous.y);
        extended.push(lift(previous.clone().lerp(point, t)));
        thickness.push(radii[i - 1] + (radii[i] - radii[i - 1]) * t);
      }
      extended.push(lift(point)); thickness.push(radii[i]);
    });
    kit.branch(group, p.bark, extended, thickness, segments);
  };
  growStem(trunk, trunk.map((_, i) => radius * (1 - i / 7 * .95)), 7);
  for (const stem of stems) growStem(stem, [radius * .75, radius * .45, .025]);
  if (p.whiteBark) for (let i = 0; i < 18; i++) {
    const t = .05 + i / 20 * .65, pos = lift(trunk[Math.floor(t * 7)].clone().lerp(trunk[Math.floor(t * 7) + 1], t * 7 % 1));
    const a = i * 2.4, r = radius * (1 - t * .95);
    const scar = kit.part(group, 'box', 0x505954, [r * 1.2, .035 + random() * .035, .018],
      [pos.x + Math.sin(a) * r, pos.y, pos.z + Math.cos(a) * r]); scar.rotation.y = a;
  }
  group.userData.vegetation = { height: h + trunkExtension, base: p.trunkClearance * .65, flexibility: .24 };
  const result = kit.compile(group);
  result.userData.treeSpecies = type; result.userData.treeHeight = h + trunkExtension;
  result.userData.leafColor = p.leaf; result.userData.leafLightColor = p.light;
  result.userData.growth = { branchCount, stems: p.stems, form: p.form, seed, trunkExtension, trunkClearance: p.trunkClearance };
  return result;
}
