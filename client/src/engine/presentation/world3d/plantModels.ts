import { Group, Quaternion, Vector3 } from 'three/webgpu';
import { ModelKit } from './modelKit';
import { PLANT_PROFILES } from './plantCatalog';
import type { PlantProfile, PlantSpecies } from './plantCatalog';
import { seededRandom } from './visualContract';
import { createMemoryShard } from './memoryShardModels';

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);
const TAU = Math.PI * 2;
type Point = [number, number, number];

/** Small semantic growth writer. Leaves and petals are closed solids; no
 * camera-facing foliage cards, sprite textures or random leaf-cloud spheres. */
class PlantWriter {
  readonly root = new Group();
  readonly random: () => number;
  constructor(readonly kit: ModelKit, readonly p: PlantProfile, seed: number) {
    this.random = seededRandom(seed);
  }
  stem(a: Point, b: Point, radius = .012, color = this.p.green): void {
    // Keep the finest stems readable at the two-CSS-pixel world raster.
    this.kit.beam(this.root, color, new Vector3(...a), new Vector3(...b), Math.max(.018, radius));
  }
  leaf(base: Point, end: Point, width = this.p.leaf, color = this.p.green): void {
    const direction = new Vector3(...end).sub(new Vector3(...base));
    const mesh = this.kit.part(this.root, 'leaf', color, [Math.max(.045, width), .025, direction.length()], base);
    mesh.quaternion.setFromUnitVectors(FORWARD, direction.normalize());
  }
  fruit(position: Point, size: number, color = this.p.accent, shape: 'rock' | 'cone' = 'rock'): void {
    this.kit.part(this.root, shape, color, [size, size * (shape === 'cone' ? 1.15 : 1), size], position);
  }
  flower(position: Point, radius = .1, petals = 5, color = this.p.accent, center = 0xc8a44e): void {
    for (let i = 0; i < petals; i++) {
      const a = i * TAU / petals;
      this.leaf(position, [position[0] + Math.sin(a) * radius, position[1] + radius * .15, position[2] + Math.cos(a) * radius], radius * .65, color);
    }
    this.fruit([position[0], position[1] + .025, position[2]], radius * .55, center);
  }
  feather(base: Point, angle: number, length: number, pairs = 5): void {
    const tip: Point = [base[0] + Math.sin(angle) * length, base[1] + length * .3, base[2] + Math.cos(angle) * length];
    this.stem(base, tip, .006);
    for (let i = 1; i <= pairs; i++) for (const side of [-1, 1]) {
      const t = i / (pairs + 1), reach = length * .28 * (1 - t * .65);
      const a = angle + side * 1.15;
      const b: Point = [base[0] + (tip[0] - base[0]) * t, base[1] + (tip[1] - base[1]) * t, base[2] + (tip[2] - base[2]) * t];
      this.leaf(b, [b[0] + Math.sin(a) * reach, b[1] + reach * .2, b[2] + Math.cos(a) * reach], this.p.leaf);
    }
  }
  umbel(position: Point, radius: number, flat: boolean): void {
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6;
      const end: Point = [position[0] + Math.sin(a) * radius, position[1] + (flat ? .055 : .12), position[2] + Math.cos(a) * radius];
      this.stem(position, end, .007);
      this.flower(end, .055, 5);
    }
  }
}

function herb(w: PlantWriter, species: PlantSpecies): void {
  const { p } = w;
  if (species === 'Glasswort') {
    for (let i = 0; i < p.shoots; i++) {
      const angle = i * 2.4, h = p.height * (.75 + w.random() * .25);
      const base: Point = [Math.sin(angle) * .09, 0, Math.cos(angle) * .09];
      const tip: Point = [Math.sin(angle) * p.spread * .6, h, Math.cos(angle) * p.spread * .6];
      for (let joint = 0; joint < 5; joint++) {
        const t = joint / 5, next = (joint + .88) / 5;
        const a: Point = [base[0] + (tip[0] - base[0]) * t, h * t, base[2] + (tip[2] - base[2]) * t];
        const b: Point = [base[0] + (tip[0] - base[0]) * next, h * next, base[2] + (tip[2] - base[2]) * next];
        w.stem(a, b, .035 * (1 - t * .5), joint > 2 ? p.accent : p.green);
        if (joint === 2 || joint === 3) for (const side of [-1, 1]) w.stem(a, [a[0] + side * .11, a[1] + .13, a[2]], .023, p.accent);
      }
    }
    return;
  }
  for (let i = 0; i < p.shoots; i++) {
    const angle = i * 2.399 + w.random() * .25;
    const h = p.height * (.72 + w.random() * .28);
    const x = Math.sin(angle) * p.spread * .38, z = Math.cos(angle) * p.spread * .38;
    const top: Point = [x, h, z];
    w.stem([x * .35, 0, z * .35], top, species === 'Sunflowers' ? .025 : .012);
    const levels = /spire|spike|whorl/.test(p.detail) ? 6 : 3;
    for (let level = 0; level < levels; level++) {
      const t = .22 + level / levels * .54;
      const y = h * t;
      for (const side of [-1, 1]) {
        const a = angle + side * 1.15 + level * .65;
        const length = p.spread * (.7 - t * .3);
        const base: Point = [x * t, y, z * t];
        if (/feather|pinnate|silver-branches/.test(p.detail)) w.feather(base, a, length, 4);
        else {
          w.leaf(base, [base[0] + Math.sin(a) * length, y + length * .35, base[2] + Math.cos(a) * length], p.leaf);
          if (species === 'BorealNettle') {
            // Three pointed lobes keep nettle's outline different from mint.
            for (const offset of [-.42, .42]) w.leaf(base, [base[0] + Math.sin(a + offset) * length * .72, y + length * .25, base[2] + Math.cos(a + offset) * length * .72], p.leaf * .5);
          }
          if (species === 'Potato') {
            const tip: Point = [base[0] + Math.sin(a) * length * .6, y + .04, base[2] + Math.cos(a) * length * .6];
            for (const offset of [-1, 1]) w.leaf(tip, [tip[0] + Math.sin(a + offset) * .17, tip[1] + .06, tip[2] + Math.cos(a + offset) * .17], .12);
          }
        }
      }
    }
    if (/umbel/.test(p.detail)) w.umbel(top, p.spread * .42, /flat/.test(p.detail));
    else if (/spire|spike/.test(p.detail)) {
      for (let j = 0; j < 7; j++) {
        const a = j * 2.4;
        const at: Point = [x + Math.sin(a) * .06, h * (.7 + j * .044), z + Math.cos(a) * .06];
        if (species === 'Wolfsbane') {
          w.fruit(at, .12, p.accent);
          w.kit.part(w.root, 'cone', 0x565578, [.07, .06, .07], [at[0], at[1] - .04, at[2] + .035]);
        } else w.flower(at, species === 'Fireweed' ? .085 : .045, species === 'Fireweed' ? 4 : 5);
      }
    } else if (/bell|throat|trumpet/.test(p.detail)) {
      const count = species === 'KamchatkaLily' ? 3 : 2;
      for (let j = 0; j < count; j++) {
        const a = angle + j * 2.4;
        const at: Point = [x + Math.sin(a) * .12, h - .04 - j * .065, z + Math.cos(a) * .12];
        w.stem([x, h, z], at, .008);
        const trumpet = w.kit.vessel(w.root, p.accent, .027, species === 'Datura' ? .11 : .07, .012, species === 'Datura' ? .23 : .12, 6);
        trumpet.rotation.z = Math.PI;
        trumpet.position.set(...at);
        if (species === 'Belladonna') w.fruit([x - .1, h * .65, z + .09], .1);
        if (species === 'Henbane') w.fruit([at[0], at[1] - .115, at[2]], .055, 0x73526a);
        if (species === 'Datura') {
          w.fruit([x - .12, h * .55, z], .15, p.green);
          for (let spike = 0; spike < 5; spike++) w.kit.part(w.root, 'cone', p.green, [.035, .08, .035], [x - .12 + Math.sin(spike * 1.25) * .06, h * .55 + .05, z + Math.cos(spike * 1.25) * .06]);
        }
      }
    } else if (species === 'Dogbane') {
      w.umbel(top, .12, false);
      for (const side of [-1, 1]) w.leaf([x, h * .65, z], [x + side * .1, h * .31, z + .04], .04, 0x9e8862);
    } else if (species === 'Mugwort') {
      for (let j = 0; j < 5; j++) w.fruit([x + Math.sin(j * 2.4) * .07, h * (.7 + j * .06), z + Math.cos(j * 2.4) * .07], .045);
    } else if (species === 'Sunflowers') {
      const flower = new PlantWriter(w.kit, p, i);
      flower.flower([0, 0, 0], .28, 11, p.accent, 0x695344);
      flower.root.rotation.x = .8;
      flower.root.position.set(...top);
      w.root.add(flower.root);
    } else w.flower(top, species === 'Chicory' ? .13 : .085, species === 'Chamomile' ? 9 : 5);
  }
  if (species === 'Fennel') w.kit.part(w.root, 'rock', 0xd4d2a8, [.26, .23, .22], [0, .09, 0]);
}

function rosette(w: PlantWriter, species: PlantSpecies): void {
  const { p } = w;
  if (species === 'Cabbage') {
    w.kit.part(w.root, 'rock', p.accent, [.5, .33, .5], [0, .2, 0]);
    for (let i = 0; i < p.shoots; i++) {
      const a = i * 2.4, inner = i > 5, base: Point = [Math.sin(a) * .09, .06 + (inner ? .16 : 0), Math.cos(a) * .09];
      w.leaf(base, [Math.sin(a) * (inner ? .14 : .48), inner ? .42 : .16, Math.cos(a) * (inner ? .14 : .48)], inner ? .28 : .42, i % 2 ? p.green : p.accent);
    }
    return;
  }
  for (let i = 0; i < p.shoots; i++) {
    const a = i * 2.399, length = p.spread * (.75 + w.random() * .25);
    const base: Point = [Math.sin(a) * .025, .04, Math.cos(a) * .025];
    const tip: Point = [Math.sin(a) * length, p.height * (.45 + w.random() * .4), Math.cos(a) * length];
    if (/feather|pinnate/.test(p.detail)) w.feather(base, a, length, species === 'Carrot' ? 7 : 5);
    else {
      if (species === 'Beets') w.stem(base, [tip[0] * .5, tip[1] * .5, tip[2] * .5], .018, p.accent);
      w.leaf(species === 'Beets' ? [tip[0] * .45, tip[1] * .45, tip[2] * .45] : base, tip);
    }
  }
  if (/root/.test(p.detail)) {
    w.kit.part(w.root, species === 'Carrot' ? 'cone' : 'rock', p.accent, [species === 'Beets' ? .22 : .13, .18, .17], [0, .04, 0]);
  }
  if (species === 'Mandrake') for (let i = 0; i < 3; i++) w.fruit([Math.sin(i * 2.4) * .14, .13, Math.cos(i * 2.4) * .14], .12);
  if (species === 'ArcticPoppy' || species === 'BearGarlic' || species === 'ScurvyGrass' || species === 'Silverweed') {
    for (let i = 0; i < (species === 'ScurvyGrass' ? 3 : 2); i++) {
      const a = i * 2.4, top: Point = [Math.sin(a) * .16, p.height, Math.cos(a) * .16];
      w.stem([0, 0, 0], top, .009);
      if (species === 'BearGarlic') w.umbel(top, .12, false);
      else w.flower(top, species === 'ArcticPoppy' ? .17 : .065, species === 'ScurvyGrass' ? 4 : 5);
    }
  }
  if (species === 'SeaPlantain') for (let i = 0; i < 3; i++) {
    const x = (i - 1) * .09;
    w.stem([x, 0, 0], [x, p.height + .12, 0], .009);
    w.kit.part(w.root, 'cylinder', p.accent, [.04, .16, .04], [x, p.height + .04, 0]);
  }
}

function grasses(w: PlantWriter, species: PlantSpecies): void {
  const { p } = w;
  for (let i = 0; i < p.shoots; i++) {
    const a = i * 2.399 + w.random() * .3, h = p.height * (.65 + w.random() * .35);
    const x = Math.sin(a) * p.spread * .35, z = Math.cos(a) * p.spread * .35;
    if (species === 'Corn') {
      w.stem([x, 0, z], [x, h, z], .025);
      for (let level = 1; level <= 5; level++) {
        const angle = a + level * 2.2, y = h * level / 7;
        const mid: Point = [x + Math.sin(angle) * .24, y + .17, z + Math.cos(angle) * .24];
        w.leaf([x, y, z], mid, p.leaf);
        w.leaf(mid, [x + Math.sin(angle) * .58, y + .08, z + Math.cos(angle) * .58], p.leaf * .72);
      }
      for (const side of [-1, 1]) {
        const cob = w.kit.part(w.root, 'cylinder', p.accent, [.12, .28, .12], [x + side * .11, h * .59, z]);
        cob.rotation.z = side * -.35;
        w.leaf([x, h * .45, z], [x + side * .18, h * .74, z], .14);
      }
      for (let j = -2; j <= 2; j++) w.stem([x, h * .92, z], [x + j * .06, h + .12 - Math.abs(j) * .025, z + .025], .006, p.accent);
      continue;
    }
    const top: Point = [x + Math.sin(a) * .12, h, z + Math.cos(a) * .12];
    w.stem([x, 0, z], top, .009);
    for (let j = 0; j < 3; j++) {
      const angle = a + j * 2.4, at: Point = [x, h * (.15 + j * .18), z];
      const bend: Point = [x + Math.sin(angle) * p.spread * .5, at[1] + h * .33, z + Math.cos(angle) * p.spread * .5];
      w.leaf(at, bend, p.leaf);
      w.leaf(bend, [bend[0] + Math.sin(angle) * .13, bend[1] - .13, bend[2] + Math.cos(angle) * .13], p.leaf * .55);
    }
    if (species === 'BogCotton') w.kit.part(w.root, 'rock', p.accent, [.15, .19, .15], top);
    else if (species === 'Salsify') w.flower(top, .14, 9);
    else {
      const levels = species === 'Reed' ? 5 : 7;
      for (let j = 0; j < levels; j++) {
        const t = j / levels, width = (species === 'Reed' ? .1 : .055) * (1 - t * .7);
        for (const side of [-1, 1]) w.leaf([top[0], h + t * .26, top[2]], [top[0] + side * width, h + t * .26 + .07, top[2] + width * .3], .03, p.accent);
      }
    }
  }
}

function berry(w: PlantWriter, species: PlantSpecies): void {
  const { p } = w;
  for (let i = 0; i < p.shoots; i++) {
    const a = i * 2.399, length = p.spread * (.6 + w.random() * .4);
    const tip: Point = [Math.sin(a) * length, p.height * (.65 + w.random() * .35), Math.cos(a) * length];
    w.stem([0, .015, 0], tip, .012, p.height > .6 ? 0x7d6a4b : p.green);
    if (/pinnate/.test(p.detail)) w.feather([tip[0] * .4, tip[1] * .5, tip[2] * .4], a, .36, 6);
    else for (let j = 1; j <= (species === 'Crowberry' ? 7 : 3); j++) {
      const t = j / (species === 'Crowberry' ? 8 : 4), base: Point = [tip[0] * t, tip[1] * t, tip[2] * t];
      const leaves = /trifoliate|raspberry|amber|palmate/.test(p.detail) ? (species === 'SiberianGinseng' ? 5 : 3) : 2;
      for (let l = 0; l < leaves; l++) {
        const angle = a + (l - (leaves - 1) / 2) * 1.25;
        w.leaf(base, [base[0] + Math.sin(angle) * .18, base[1] + .065, base[2] + Math.cos(angle) * .18], p.leaf);
      }
    }
    const compound = /raspberry|amber|cluster|pinnate/.test(p.detail);
    const center: Point = [tip[0], tip[1] + .035, tip[2]];
    if (compound) for (let j = 0; j < (species === 'RowanBerries' ? 7 : 5); j++) {
      const b = j * 2.4;
      w.fruit([center[0] + Math.sin(b) * .047, center[1] + (j % 2) * .025, center[2] + Math.cos(b) * .047], species === 'RowanBerries' ? .065 : .075);
    } else {
      const at: Point = [center[0], center[1] - (species === 'Bilberries' ? .07 : 0), center[2]];
      w.fruit(at, species === 'WildStrawberries' ? .12 : .09, p.accent, species === 'WildStrawberries' ? 'cone' : 'rock');
      if (species === 'WildStrawberries') w.flower([tip[0] * .7, .22, tip[2] * .7], .055, 5, 0xe0d7b9);
    }
  }
}

function mushrooms(w: PlantWriter, species: PlantSpecies): void {
  const { p } = w;
  for (let i = 0; i < p.shoots; i++) {
    const angle = i * 2.4, scale = i === 0 ? 1 : .55 + w.random() * .32;
    const x = Math.sin(angle) * p.spread * (i ? .64 : 0), z = Math.cos(angle) * p.spread * (i ? .64 : 0);
    const h = p.height * scale, r = p.leaf * scale;
    w.stem([x, 0, z], [x, h * .85, z], (species === 'Porcini' ? .07 : .025) * scale, p.green);
    if (species === 'Chanterelle') {
      const cap = w.kit.vessel(w.root, p.accent, r * .18, r * .65, .018, h * .35, 9);
      cap.position.set(x, h * .63, z);
    } else if (species === 'ShaggyInkCap' || species === 'DeadlyWebcap') {
      w.kit.part(w.root, 'cone', p.accent, [r * 1.7, species === 'ShaggyInkCap' ? h * .63 : h * .36, r * 1.7], [x, h * .7, z]);
      if (species === 'ShaggyInkCap') for (let j = 0; j < 7; j++) {
        const a = j * TAU / 7;
        w.leaf([x + Math.sin(a) * r * .45, h * .75, z + Math.cos(a) * r * .45], [x + Math.sin(a) * r * .9, h * .4, z + Math.cos(a) * r * .9], .045, j % 2 ? 0x53595a : p.green);
      }
    } else {
      w.kit.part(w.root, species === 'FlyAgaric' ? 'cone' : 'rock', p.accent, [r * 1.8, h * .38, r * 1.8], [x, h * .83, z]);
      w.kit.part(w.root, 'cylinder', p.green, [r * 1.5, .025, r * 1.5], [x, h * .73, z]);
      if (species === 'FlyAgaric') for (let j = 0; j < 7; j++) {
        const a = j * 2.4, reach = (j % 3 + 1) * r * .18;
        const surfaceY = h * (.64 + .38 * (1 - reach / (r * .9)));
        w.kit.part(w.root, 'rock', 0xe4d9bd, [.065 * scale, .035 * scale, .065 * scale], [x + Math.sin(a) * reach, surfaceY + .008, z + Math.cos(a) * reach]);
      }
      if (species === 'DestroyingAngel') {
        w.kit.part(w.root, 'skirt', p.accent, [.13, .1, .13], [x, h * .55, z]);
        w.kit.part(w.root, 'rock', p.accent, [.14, .12, .14], [x, .06, z]);
      }
    }
  }
}

function pumpkin(w: PlantWriter): void {
  for (let i = 0; i < w.p.shoots; i++) {
    const a = i * 2.4, tip: Point = [Math.sin(a) * w.p.spread, .035, Math.cos(a) * w.p.spread];
    w.stem([0, .02, 0], tip, .018);
    for (let j = 1; j <= 2; j++) {
      const at: Point = [tip[0] * j / 3, .06, tip[2] * j / 3];
      for (const offset of [-.5, 0, .5]) w.leaf(at, [at[0] + Math.sin(a + offset) * .4, .16, at[2] + Math.cos(a + offset) * .4], .25);
    }
    if (i > 1) continue;
    const center: Point = [tip[0] * .7, .18, tip[2] * .7];
    for (let rib = 0; rib < 7; rib++) {
      const r = rib * TAU / 7;
      w.kit.part(w.root, 'rock', rib % 2 ? w.p.accent : 0xb56d34, [.22, .34, .22], [center[0] + Math.sin(r) * .12, center[1], center[2] + Math.cos(r) * .12]);
    }
    w.stem([center[0], .32, center[2]], [center[0] + .035, .43, center[2]], .024, 0x7f754a);
  }
}

function sapling(w: PlantWriter, species: PlantSpecies): void {
  const { p } = w;
  const bark = species === 'DeciduousSapling' ? p.accent : 0x7c694d;
  w.stem([0, 0, 0], [.025, p.height, 0], .021, bark);
  for (let level = 0; level < p.shoots; level++) {
    const y = p.height * (.28 + level / p.shoots * .6);
    const count = species === 'ConiferSapling' ? 5 : species === 'HazelnutSapling' ? 2 : 1;
    for (let branch = 0; branch < count; branch++) {
      const a = level * 2.399 + branch * TAU / count;
      const length = p.spread * (1 - level / p.shoots * .55);
      const end: Point = [Math.sin(a) * length, y + .12, Math.cos(a) * length];
      w.stem([0, species === 'HazelnutSapling' ? .05 : y, 0], end, .012, bark);
      if (species === 'ConiferSapling') {
        for (let needle = 0; needle < 5; needle++) for (const side of [-1, 1]) {
          const t = (needle + 1) / 6, at: Point = [end[0] * t, y + .12 * t, end[2] * t];
          w.leaf(at, [at[0] + Math.sin(a + side) * .14, at[1] + .04, at[2] + Math.cos(a + side) * .14], .035);
        }
      } else if (species === 'RowanberrySapling') w.feather(end, a, .29, 5);
      else for (let j = 0; j < 3; j++) {
        const angle = a + (j - 1) * 1.2;
        w.leaf(end, [end[0] + Math.sin(angle) * .22, end[1] + .08, end[2] + Math.cos(angle) * .22], p.leaf);
      }
    }
  }
  if (species === 'DeciduousSapling') for (let i = 1; i < 5; i++) w.kit.part(w.root, 'box', 0x756c58, [.045, .022, .045], [0, i * .18, 0]);
}

function piles(w: PlantWriter, species: PlantSpecies): void {
  const { p } = w;
  for (let i = 0; i < p.shoots; i++) {
    const a = i * 2.399, distance = Math.sqrt(w.random()) * p.spread * .65;
    const x = Math.sin(a) * distance, z = Math.cos(a) * distance;
    const y = .035 + (1 - distance / p.spread) * p.height * .3;
    if (/WoodPile/.test(species) || species === 'CharcoalPile') {
      const length = species === 'BeachWoodPile' ? .55 + w.random() * .3 : .28 + w.random() * .3;
      const end: Point = [x + Math.sin(a) * length * .5, y + .045, z + Math.cos(a) * length * .5];
      const start: Point = [x - Math.sin(a) * length * .5, y, z - Math.cos(a) * length * .5];
      w.stem(start, end, species === 'CharcoalPile' ? .04 : .055, i % 2 ? p.green : p.accent);
      if (species === 'BeachWoodPile') w.stem([x, y, z], [x + .14, y + .06, z - .11], .025, p.green);
      else if (species === 'WoodPile') {
        const face = w.kit.part(w.root, 'cylinder', p.accent, [.08, .008, .08], end);
        face.quaternion.copy(new Quaternion().setFromUnitVectors(UP, new Vector3(...end).sub(new Vector3(...start)).normalize()));
      }
    } else if (species === 'LeavesPile') w.leaf([x, y, z], [x + Math.sin(a) * .23, y + .02, z + Math.cos(a) * .23], .12, i % 3 ? p.green : p.accent);
    else if (species === 'SoggyPlantFiberPile') {
      w.stem([x, y, z], [x + Math.sin(a) * .32, y + .012, z + Math.cos(a) * .32], .008, i % 2 ? p.green : p.accent);
    } else if (species === 'BonePile') {
      const end: Point = [x + Math.sin(a) * .25, y + .06, z + Math.cos(a) * .25];
      w.stem([x, y, z], end, .025, p.green);
      for (const side of [-1, 1]) w.fruit([end[0] + Math.cos(a) * side * .035, end[1], end[2] - Math.sin(a) * side * .035], .075);
    } else {
      const size = .12 + w.random() * .14;
      w.kit.part(w.root, 'rock', i % 3 ? p.green : p.accent, [size, size * .7, size], [x, y, z]);
      if (species === 'MetalOrePile') w.kit.part(w.root, 'box', p.accent, [.025, .035, size * .8], [x, y + size * .28, z]);
      if (species === 'SulfurPile') w.kit.part(w.root, 'cone', p.accent, [.065, .13, .065], [x, y + .075, z]);
    }
  }
}

function seaweed(w: PlantWriter): void {
  for (let i = 0; i < w.p.shoots; i++) {
    const a = i * 2.399, h = w.p.height * (.7 + w.random() * .3);
    const x = Math.sin(a) * .22, z = Math.cos(a) * .22;
    let base: Point = [x, -.14, z];
    for (let j = 0; j < 4; j++) {
      const end: Point = [x + Math.sin(a + j * .7) * .15, (j + 1) * h / 4 - .14, z + Math.cos(a + j * .7) * .15];
      w.leaf(base, end, w.p.leaf * (1 - j * .15), j % 2 ? w.p.green : w.p.accent);
      if (j === 2) w.leaf(base, [end[0] + .16, end[1] - .02, end[2] - .12], .1);
      base = end;
    }
  }
}

export function createPlant(kit: ModelKit, type: string, seed: number): Group {
  if (!Object.prototype.hasOwnProperty.call(PLANT_PROFILES, type)) throw new Error(`Unfinished plant species ${type}`);
  if(type==='MemoryShard'){
    const shard=createMemoryShard(kit);shard.name='plant:MemoryShard';
    shard.userData.plantSpecies=type;shard.userData.growthForm=PLANT_PROFILES.MemoryShard.detail;return shard;
  }
  const species = type as PlantSpecies;
  const profile: PlantProfile = PLANT_PROFILES[species];
  const writer = new PlantWriter(kit, profile, seed);
  switch (profile.form) {
    case 'herb': herb(writer, species); break;
    case 'rosette': rosette(writer, species); break;
    case 'grass': grasses(writer, species); break;
    case 'berry': berry(writer, species); break;
    case 'mushroom': mushrooms(writer, species); break;
    case 'vine': pumpkin(writer); break;
    case 'sapling': sapling(writer, species); break;
    case 'pile': piles(writer, species); break;
    case 'seaweed': seaweed(writer); break;
    case 'shard':
      for (let i = 0; i < 3; i++) {
        const shard = kit.part(writer.root, 'box', i === 0 ? profile.accent : profile.green, [.12, profile.height * (1 - i * .2), .04], [(i - 1) * .11, .12, i * .06], i === 0);
        shard.rotation.set(.25, i * 1.3, (i - 1) * .6);
        kit.part(writer.root, 'box', 0xc2d4ca, [.06, .018, .045], [(i - 1) * .11, .12, i * .06 + .025]);
      }
  }
  if (!['pile', 'shard'].includes(profile.form)) writer.root.userData.vegetation = {
    height: profile.height, base: .025, flexibility: profile.form === 'mushroom' ? .018 : profile.form === 'sapling' ? .12 : .22,
  };
  const result = kit.compile(writer.root);
  result.name = `plant:${type}`;
  result.userData.plantSpecies = type;
  result.userData.growthForm = profile.detail;
  return result;
}
