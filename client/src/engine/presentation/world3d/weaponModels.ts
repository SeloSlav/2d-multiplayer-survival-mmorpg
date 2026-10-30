import { Group, Matrix4, Object3D, Vector3 } from 'three/webgpu';
import { COLORS as C, ModelKit } from './modelKit';

type Form = 'blade' | 'axe' | 'pick' | 'hammer' | 'club' | 'crowbar' | 'spear' | 'scythe' | 'paddle' | 'bow' | 'crossbow' | 'harpoon-gun' | 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'skull' | 'ladle' | 'torch' | 'flashlight' | 'rock' | 'grenade' | 'flare' | 'rod' | 'gaff' | 'tiller';
export type GripStyle = 'one' | 'pistol' | 'longgun' | 'bow' | 'staff';
export interface WeaponSpec { form: Form; hold: GripStyle; length: number; color: number }
const spec = (form: Form, hold: GripStyle, length: number, color: number = C.steel): WeaponSpec => ({ form, hold, length, color });

// Arrows fly along +Z. The grip sits in front of the limb tips and braced
// string; drawing the nock moves it farther toward the archer along -Z.
export const BOW_GEOMETRY = { tipSetback: .18, drawLength: .3, arrowLength: .85, arrowHeadLength: .13 } as const;
export const bowNockZ = (draw: number): number => -BOW_GEOMETRY.tipSetback - BOW_GEOMETRY.drawLength * draw;

/** Every weapon in items_database/weapons.rs and every gathering/combat tool
 * has its own authored dimensions. Generic inspection guns are explicit too. */
export const WEAPON_MODELS = {
  'Combat Ladle': spec('ladle', 'one', .94, 0xb3834d),
  'Torch': spec('torch', 'one', .92, C.wood),
  'Flashlight': spec('flashlight', 'pistol', .35, C.iron),
  'Stone Hatchet': spec('axe', 'one', .75, C.stone),
  'Metal Hatchet': spec('axe', 'one', .8, C.steel),
  'Battle Axe': spec('axe', 'staff', 1.16, C.iron),
  'Stone Pickaxe': spec('pick', 'one', .86, C.stoneDark),
  'Metal Pickaxe': spec('pick', 'one', .93, C.steel),
  'Diving Pick': spec('pick', 'one', .64, 0x86a69e),
  'Stone Tiller': spec('tiller', 'staff', 1.1, C.stone),
  'Repair Hammer': spec('hammer', 'one', .65, C.wood),
  'War Hammer': spec('hammer', 'staff', 1.05, C.iron),
  'Engineers Maul': spec('hammer', 'staff', 1.14, 0x65736f),
  'Bone Club': spec('club', 'one', .88, C.bone),
  'Stone Mace': spec('club', 'staff', 1.02, C.stoneDark),
  'Military Crowbar': spec('crowbar', 'one', .99, 0x757e7b),
  'Bush Knife': spec('blade', 'one', .68, 0xa4aaa0),
  'Bone Knife': spec('blade', 'one', .43, C.bone),
  'Tidebreaker Blade': spec('blade', 'one', .58, 0xa6c6c5),
  'Naval Cutlass': spec('blade', 'one', 1.15, C.steel),
  'AK74 Bayonet': spec('blade', 'one', .62, 0x9ca9a2),
  'Bone Shiv': spec('blade', 'one', .38, 0xc8b99a),
  'Metal Dagger': spec('blade', 'one', .53, 0xb8c3ba),
  'Wooden Spear': spec('spear', 'staff', 1.92, C.wood),
  'Stone Spear': spec('spear', 'staff', 2.08, C.stone),
  'Reed Harpoon': spec('spear', 'staff', 1.73, C.bone),
  'Scythe': spec('scythe', 'staff', 1.65, C.steel),
  'Kayak Paddle': spec('paddle', 'staff', 1.9, 0xa48358),
  'Hunting Bow': spec('bow', 'bow', 1.32, C.woodDark),
  'Crossbow': spec('crossbow', 'longgun', 1.02, C.wood),
  'Reed Harpoon Gun': spec('harpoon-gun', 'longgun', 1.12, 0x9e9c68),
  'Makarov PM': spec('pistol', 'pistol', .48, C.iron),
  'PP-91 KEDR': spec('smg', 'longgun', .76, 0x465454),
  'Grenade': spec('grenade', 'one', .28, 0x707d59),
  'Flare': spec('flare', 'one', .42, 0xab5143),
  'Rock': spec('rock', 'one', .3, C.stone),
  'Primitive Reed Fishing Rod': spec('rod', 'staff', 2.25, 0x9c9b69),
  'Bone Gaff Hook': spec('gaff', 'one', .7, C.bone),
  'Human Skull': spec('skull', 'one', .38, C.bone),
  'Fox Skull': spec('skull', 'one', .32, 0xd0c7a8),
  'Wolf Skull': spec('skull', 'one', .4, 0xccc4ac),
  'Viper Skull': spec('skull', 'one', .24, 0xc2c3a1),
  'Walrus Skull': spec('skull', 'one', .52, 0xd5c9ab),
  'Vole Skull': spec('skull', 'one', .17, 0xd9cdb3),
  'Wolverine Skull': spec('skull', 'one', .35, 0xc4bba4),
  'Polar Bear Skull': spec('skull', 'one', .56, 0xdcd3ba),
  'Hare Skull': spec('skull', 'one', .25, 0xd6cfb3),
  'Owl Skull': spec('skull', 'one', .27, 0xdbd9bc),
  'Tern Skull': spec('skull', 'one', .23, 0xc9ccb7),
  'Crow Skull': spec('skull', 'one', .26, 0xc9c5aa),
  'Shark Skull': spec('skull', 'one', .53, 0xc5d1bb),
  'Rifle': spec('rifle', 'longgun', 1.32, C.iron),
  'Shotgun': spec('shotgun', 'longgun', 1.17, C.iron),
  'Pistol': spec('pistol', 'pistol', .5, C.iron),
  'Revolver': spec('pistol', 'pistol', .58, C.iron),
} as const satisfies Record<string, WeaponSpec>;

export type WeaponName = keyof typeof WEAPON_MODELS;
const nameKey = (value: string) => value.toLowerCase().replace(/\.png$/, '').replace(/[^a-z0-9]/g, '');
const aliases = new Map(Object.keys(WEAPON_MODELS).map(name => [nameKey(name), name as WeaponName]));
for (const alias of ['wooden spoon', 'wooden ladle']) aliases.set(nameKey(alias), 'Combat Ladle');
aliases.set('torchon', 'Torch');
aliases.set('sovietbayonet', 'AK74 Bayonet');
export const resolveWeaponName = (name: string): WeaponName | undefined => aliases.get(nameKey(name));

function marker(parent: Group, name: string, x = 0, y = 0, z = 0): void {
  const object = new Object3D(); object.name = name; object.position.set(x, y, z); parent.add(object);
}

/** Authored profile in XY. Directional heads are turned into the forward swing
 * plane before compilation; the shaft/grip frame remains unchanged. */
function plate(kit: ModelKit, group: Group, color: number, outline: [number, number][], thickness = .045): void {
  const points: [number, number][] = outline.map(([x, y]) => [x, -y]);
  const area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
  if (area < 0) points.reverse();
  const mesh = kit.prism(group, color, points, -thickness / 2, thickness / 2);
  mesh.rotation.x = Math.PI / 2;
}

function shaft(kit: ModelKit, group: Group, length: number, color: number = C.wood, radius = .037, startY = -.2): void {
  const handle = new Group(); handle.name = 'weapon-shaft'; group.add(handle);
  kit.beam(handle, color, new Vector3(0, startY, 0), new Vector3(.025, length, 0), radius);
  for (let i = 0; i < 4; i++) kit.part(handle, 'cylinder', C.leather, [radius * 2.12, .022, radius * 2.12], [0, -.1 + i * .06, 0]);
}

function firearm(kit: ModelKit, root: Group, p: WeaponSpec, name: string): void {
  const pistol = p.form === 'pistol', length = p.length;
  const slideY = .13;
  const barrel = kit.vessel(root, p.color, pistol ? .035 : .042, pistol ? .035 : .042, .012, length * .62, 8);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, slideY, length * .25);
  kit.part(root, 'cylinder', 0x293330, [.042, .015, .042], [0, slideY, length * .87 - .018]).rotation.x = Math.PI / 2;
  kit.part(root, 'box', p.color, [pistol ? .12 : .17, .14, length * (pistol ? .77 : .6)], [0, slideY, length * .27]);
  const grip = kit.part(root, 'box', pistol ? 0x79503a : C.leather, [.105, .24, .12], [0, -.01, -.025]);
  grip.rotation.x = -.17;
  // Trigger guard has an actual opening, not a black rectangle pasted on it.
  for (const x of [-.055, .055]) kit.part(root, 'box', p.color, [.016, .12, .17], [x, -.015, .095]);
  kit.part(root, 'box', p.color, [.12, .016, .17], [0, -.075, .095]);
  kit.part(root, 'box', C.stoneDark, [.025, .055, .025], [0, .015, .09]);
  kit.part(root, 'box', C.coal, [.035, .04, .04], [0, .22, length * .64]);
  kit.part(root, 'box', C.steel, [.045, .025, .025], [0, .215, .015]);
  if (pistol) {
    for (let i = 0; i < 4; i++) kit.part(root, 'box', C.coal, [.125, .07, .012], [0, .15, -.025 + i * .025]);
    if (name === 'Revolver') kit.part(root, 'cylinder', 0x8b9690, [.18, .19, .18], [0, .13, .1]).rotation.x = Math.PI / 2;
  } else {
    kit.part(root, 'box', C.woodDark, [.145, .12, .3], [0, .065, .25]);
    kit.part(root, 'box', C.coal, [.11, p.form === 'smg' ? .33 : .23, .13], [0, -.12, .14]);
    kit.part(root, 'box', p.color, [.13, .07, .26], [.06, .1, -.1]);
    kit.part(root, 'box', C.leather, [.18, .23, .06], [.09, .1, -.23]);
    if (p.form === 'shotgun') {
      kit.part(root, 'cylinder', C.iron, [.06, .45, .06], [0, .04, .55]).rotation.x = Math.PI / 2;
      for (let i = 0; i < 6; i++) kit.part(root, 'box', C.wood, [.18, .13, .022], [0, .045, .3 + i * .028]);
    }
    if (p.form === 'rifle') {
      kit.part(root, 'cylinder', C.coal, [.085, .3, .085], [0, .27, .12]).rotation.x = Math.PI / 2;
      kit.part(root, 'box', C.steel, [.13, .035, .045], [.12, .15, .06]);
    }
    for (let i = 0; i < 4; i++) kit.part(root, 'box', C.coal, [.175, .045, .018], [0, .145, .21 + i * .055]);
  }
}

function crossbow(kit: ModelKit, root: Group, p: WeaponSpec): void {
  kit.part(root, 'box', C.woodDark, [.16, .14, .7], [0, .08, .2]);
  kit.part(root, 'box', C.wood, [.12, .1, .65], [0, .16, .24]);
  kit.part(root, 'box', C.leather, [.11, .22, .13], [0, -.015, 0]);
  for (const side of [-1, 1]) {
    kit.beam(root, C.iron, new Vector3(0, .15, .55), new Vector3(side * .48, .15, .4), .035);
    kit.beam(root, C.bone, new Vector3(side * .48, .15, .4), new Vector3(0, .18, .03), .009);
  }
  kit.part(root, 'box', C.stoneDark, [.19, .2, .06], [0, .08, -.17]);
  kit.part(root, 'box', C.iron, [.025, .04, p.length * .55], [0, .23, .28]);
}

function harpoonGun(kit: ModelKit, root: Group, p: WeaponSpec): void {
  for (const x of [-.07, .07]) {
    kit.part(root, 'cylinder', p.color, [.1, p.length * .83, .1], [x, .12, .35]).rotation.x = Math.PI / 2;
  }
  kit.part(root, 'box', C.woodDark, [.12, .24, .13], [0, 0, -.02]);
  for (const z of [.05, .26, .55, .72]) kit.part(root, 'box', C.leather, [.23, .15, .035], [0, .12, z]);
  kit.beam(root, 0xb8ac79, new Vector3(-.1, .05, .13), new Vector3(-.11, .05, .58), .012);
}

function skull(kit: ModelKit, root: Group, p: WeaponSpec, name: string): void {
  const bird = /Owl|Tern|Crow/.test(name), walrus = name === 'Walrus Skull', shark = name === 'Shark Skull';
  const s = p.length, long = /Fox|Wolf|Hare|Shark/.test(name) ? 1.5 : .9;
  kit.part(root, 'rock', p.color, [s, s * .8, s * .9], [0, .13, .07]);
  kit.part(root, 'rock', p.color, [s * .62, s * .36, s * long], [0, .03, s * .54]);
  for (const side of [-1, 1]) {
    kit.part(root, 'rock', C.coal, [s * (bird ? .34 : .22), s * .25, s * .18], [side * s * .26, .17, s * .39]);
    for (let i = 0; i < (shark ? 7 : 4); i++) kit.part(root, 'cone', C.bone, [.025, shark ? .075 : .035, .025], [side * s * .24, -.025, s * .25 + i * s * .17]).rotation.x = Math.PI;
  }
  if (bird) {
    const beak = kit.part(root, 'cone', p.color, [s * .3, s * (name === 'Tern Skull' ? .95 : .65), s * .25], [0, .09, s * .9]);
    beak.rotation.x = Math.PI / 2;
  }
  if (walrus || name === 'Viper Skull') for (const side of [-1, 1]) {
    const tusk = kit.part(root, 'cone', C.bone, [s * .13, s * (walrus ? 1.1 : .45), s * .13], [side * s * .29, walrus ? -.13 : -.04, s * .6]);
    tusk.rotation.x = Math.PI * .85;
  }
}

/** Canonical frame: main grip at origin, shaft/tip +Y, cutting direction and aim +Z.
 * Models carry semantic sockets after material compilation. */
export function createWeapon(kit: ModelKit, requested: string): Group {
  const name = resolveWeaponName(requested);
  if (!name) {
    const root = new Group();
    if (requested) { kit.part(root, 'rock', C.leather, [.22, .23, .2], [0, .08, 0]); root.userData.unfinishedWeapon = requested; }
    return root;
  }
  const p: WeaponSpec = WEAPON_MODELS[name], root = new Group(), length = p.length;
  let strikeEdge: { reach: number; height: number } | undefined;
  if (p.form === 'ladle') {
    shaft(kit, root, .71, p.color, .034);
    const bowl = new Group();
    const shell = kit.vessel(bowl, p.color, .055, .19, .03, .11, 12); shell.scale.z = 1.25;
    kit.part(bowl, 'cylinder', 0x967044, [.12, .025, .15], [0, .013, 0]);
    bowl.position.set(0, .82, -.03); bowl.rotation.x = Math.PI / 2; root.add(bowl);
  } else if (p.form === 'torch') {
    shaft(kit, root, .62, p.color, .045);
    kit.part(root, 'rock', 0x62523f, [.17, .23, .17], [0, .63, 0]);
    for (let i = 0; i < 4; i++) kit.part(root, 'cylinder', C.cloth, [.18, .025, .18], [0, .55 + i * .044, 0]);
  } else if (p.form === 'pistol' || p.form === 'smg' || p.form === 'rifle' || p.form === 'shotgun') firearm(kit, root, p, name);
  else if (p.form === 'crossbow') crossbow(kit, root, p);
  else if (p.form === 'harpoon-gun') harpoonGun(kit, root, p);
  else if (p.form === 'skull') skull(kit, root, p, name);
  else if (p.form === 'axe') {
    shaft(kit, root, length * .82);
    const y = length * .7;
    strikeEdge = { reach: .4, height: y };
    kit.part(root, 'box', p.color, [.2, .25, .13], [0, y, 0]);
    for (const side of (name === 'Battle Axe' ? [-1, 1] : [1])) {
      plate(kit, root, p.color, [[side * .05, y - .1], [side * .35, y - .18], [side * .43, y + .18], [side * .08, y + .14]], .1);
      plate(kit, root, name === 'Stone Hatchet' ? 0xb0b5a2 : C.steel, [[side * .32, y - .17], [side * .4, y - .18], [side * .43, y + .18], [side * .37, y + .17]], .045);
    }
    if (name === 'Stone Hatchet') for (let i = 0; i < 3; i++) kit.part(root, 'box', C.leather, [.14, .025, .15], [0, y - .05 + i * .055, 0]);
  } else if (p.form === 'pick' || p.form === 'tiller') {
    shaft(kit, root, length * .85);
    const y = length * .72;
    strikeEdge = { reach: .42, height: y - .13 };
    plate(kit, root, p.color, [[-.4, y - .15], [-.19, y + .09], [.17, y + .1], [.42, y - .13], [.12, y + .01], [-.14, y]], .08);
    if (p.form === 'tiller') kit.part(root, 'box', p.color, [.25, .08, .23], [.3, y - .12, .06]);
  } else if (p.form === 'hammer') {
    shaft(kit, root, length * .85);
    const y = length * .72, size = name === 'Repair Hammer' ? .32 : .46;
    strikeEdge = { reach: size / 2 + .09, height: y };
    kit.part(root, 'box', p.color, [size, .24, .23], [.06, y, 0]);
    for (const side of [-1, 1]) kit.part(root, 'box', name === 'Repair Hammer' ? C.woodDark : C.steel, [.06, .27, .26], [side * size / 2 + .06, y, 0]);
  } else if (p.form === 'blade') {
    shaft(kit, root, .16, /Bone/.test(name) ? C.bone : C.leather, .039);
    const curve = name === 'Naval Cutlass' ? .22 : .06;
    strikeEdge = { reach: name === 'Naval Cutlass' ? .28 : .13, height: length * .75 };
    plate(kit, root, p.color, [[-.055, .15], [.08, .15], [.1 + curve, length * .85], [.015 + curve, length], [-.045, length * .72]], .045);
    plate(kit, root, /Bone/.test(name) ? 0xe2d6b6 : 0xd3dbcc, [[.045, .18], [.08, .18], [.1 + curve, length * .85], [.015 + curve, length]], .018);
    kit.part(root, 'box', name === 'Naval Cutlass' ? 0xb69b59 : C.iron, [.23, .045, .1], [0, .14, 0]);
    if (name === 'Naval Cutlass') kit.beam(root, 0xb69b59, new Vector3(.1, .14, 0), new Vector3(.1, -.17, 0), .022);
    if (name === 'Tidebreaker Blade') for (let i = 0; i < 5; i++) plate(kit, root, C.steel, [[-.055, .23 + i * .045], [-.095, .26 + i * .045], [-.05, .27 + i * .045]], .03);
  } else if (p.form === 'spear' || p.form === 'scythe' || p.form === 'rod' || p.form === 'gaff' || p.form === 'paddle' || p.form === 'crowbar') {
    const paddleHalfShaft = length * .26;
    shaft(kit, root, p.form === 'paddle' ? paddleHalfShaft : length * .83, p.form === 'crowbar' ? p.color : C.wood, p.form === 'rod' ? .025 : .035, p.form === 'paddle' ? -paddleHalfShaft : -.2);
    if (p.form === 'spear') {
      kit.part(root, 'cone', p.color, [name === 'Wooden Spear' ? .08 : .18, length * .22, .07], [.025, length * .88, 0]);
      if (name === 'Reed Harpoon') for (let i = 0; i < 3; i++) plate(kit, root, C.bone, [[.025, length * .78 + i * .07], [.15, length * .75 + i * .07], [.025, length * .85 + i * .07]], .04);
    } else if (p.form === 'scythe') {
      plate(kit, root, p.color, [[.02, length * .77], [.25, length * .89], [.73, length * .7], [.37, length * .79], [.03, length * .67]], .05);
      strikeEdge = { reach: .6, height: length * .75 };
    }
    else if (p.form === 'paddle') for (const end of [-1, 1]) {
      const centerX = end > 0 ? .025 : 0, base = paddleHalfShaft - .015, wide = paddleHalfShaft + length * .14, tip = length * .5;
      plate(kit, root, p.color, [[centerX - .08, end * base], [centerX - .18, end * wide], [centerX, end * tip], [centerX + .18, end * wide], [centerX + .08, end * base]], .06);
    }
    else if (p.form === 'gaff' || p.form === 'crowbar') {
      const top = length * .83;
      strikeEdge = { reach: .24, height: top - .075 };
      kit.beam(root, p.color, new Vector3(.02, top, 0), new Vector3(.17, top + .1, 0), .032);
      kit.beam(root, p.color, new Vector3(.17, top + .1, 0), new Vector3(.24, top - .03, 0), .026);
      kit.part(root, 'cone', p.color, [.055, .15, .045], [.23, top - .075, 0]).rotation.z = Math.PI;
    } else {
      kit.beam(root, C.wood, new Vector3(.025, length * .83, 0), new Vector3(.18, length, 0), .016);
      // The line and float are world-space fishing-session effects, rather
      // than a fixed cord hanging from the carried rod.
    }
  } else if (p.form === 'bow') {
    for (const side of [-1, 1]) for (let i = 0; i < 7; i++) {
      const a = i / 7, b = (i + 1) / 7;
      kit.beam(root, p.color, new Vector3(0, side * a * length / 2, -BOW_GEOMETRY.tipSetback * a * a), new Vector3(0, side * b * length / 2, -BOW_GEOMETRY.tipSetback * b * b), .028 - a * .014);
    }
    // The string is articulated after compilation so its nock can draw/release.
    for (let i = 0; i < 4; i++) kit.part(root, 'cylinder', C.leather, [.07, .025, .07], [0, -.08 + i * .05, 0]);
  } else if (p.form === 'club') {
    shaft(kit, root, length * .68, C.wood, .045);
    kit.part(root, 'rock', p.color, [name === 'Stone Mace' ? .35 : .23, length * .4, .27], [0, length * .68, 0]);
    if (name === 'Bone Club') for (const side of [-1, 1]) kit.part(root, 'rock', p.color, [.17, .19, .23], [side * .09, length * .83, 0]);
    else for (let i = 0; i < 4; i++) kit.part(root, 'cylinder', C.leather, [.27, .025, .29], [0, length * .6 + i * .05, 0]);
  } else if (p.form === 'flashlight') {
    kit.part(root, 'cylinder', C.iron, [.16, length, .16], [0, 0, .1]).rotation.x = Math.PI / 2;
    const rim = kit.vessel(root, C.steel, .09, .11, .02, .08, 10); rim.rotation.x = Math.PI / 2; rim.position.set(0, 0, .27);
    kit.part(root, 'cylinder', 0xc6d0b6, [.17, .012, .17], [0, 0, .345]).rotation.x = Math.PI / 2;
  } else if (p.form === 'grenade') {
    kit.part(root, 'rock', p.color, [.22, .28, .21], [0, .04, 0]);
    for (let i = 0; i < 4; i++) kit.part(root, 'cylinder', C.woodDark, [.23, .014, .22], [0, -.04 + i * .05, 0]);
    kit.part(root, 'box', C.iron, [.06, .05, .22], [.03, .18, .02]);
    kit.vessel(root, C.steel, .045, .045, .012, .02, 8).position.set(.075, .16, -.05);
  } else if (p.form === 'flare') {
    kit.part(root, 'cylinder', p.color, [.1, length, .1], [0, .1, 0]);
    kit.part(root, 'cylinder', C.bone, [.11, .08, .11], [0, .28, 0]);
  } else kit.part(root, 'rock', p.color, [length, length * .75, length * .85], [0, .08, .035]);

  if (strikeEdge || name === 'Bone Club') {
    // A quarter-turn about the shaft sends the cutting/striking side from +X
    // to +Z. Rotate the head/blade/guard assembly, preserving the handle pose.
    const quarterTurn = new Matrix4().makeRotationY(-Math.PI / 2);
    for (const part of root.children) if (part.name !== 'weapon-shaft') part.applyMatrix4(quarterTurn);
  }
  const compiled = kit.compile(root);
  compiled.name = 'held-weapon'; compiled.userData.weaponName = name; compiled.userData.gripStyle = p.hold;
  compiled.userData.weaponForm = p.form;
  compiled.userData.attackMotion = p.form === 'spear' || p.form === 'rod' ? 'thrust' : 'swing';
  compiled.userData.primaryHand = p.hold === 'bow' ? 'left' : 'right';
  marker(compiled, 'primary-grip');
  if (p.form === 'bow') marker(compiled, 'projectile-origin', 0, 0, bowNockZ(0));
  if (p.form === 'rod') marker(compiled, 'rod-tip', .18, p.length, 0);
  if (p.hold === 'longgun') marker(compiled, 'support-grip', -.14, -.025, p.form === 'crossbow' || p.form === 'harpoon-gun' ? .23 : .2);
  else if (p.hold === 'staff') marker(compiled, 'support-grip', 0, -.22, 0);
  else if (p.hold === 'bow') marker(compiled, 'support-grip', 0, 0, bowNockZ(1));
  if (['pistol', 'smg', 'rifle', 'shotgun', 'crossbow', 'harpoon-gun'].includes(p.form)) marker(compiled, 'muzzle', 0, p.form === 'harpoon-gun' ? .23 : p.form === 'crossbow' ? .23 : .13, p.length * .88);
  if (['pistol', 'smg', 'rifle', 'shotgun'].includes(p.form)) {
    const flash = new Group(); flash.name = 'muzzle-flash';
    for (let i = 0; i < 3; i++) {
      const tongue = kit.part(flash, 'cone', i ? 0xffb44a : 0xffe9a5, [.11 - i * .02, .28 - i * .04, .1], [(i - 1) * .04, 0, .12], true);
      tongue.rotation.x = Math.PI / 2;
    }
    flash.visible = false; compiled.getObjectByName('muzzle')!.add(flash);
  }
  if (p.form === 'bow') for (const side of [-1, 1]) {
    const tip = new Vector3(0, side * p.length / 2, -BOW_GEOMETRY.tipSetback);
    marker(compiled, side > 0 ? 'bow-tip-upper' : 'bow-tip-lower', tip.x, tip.y, tip.z);
    const string = kit.beam(compiled, C.bone, tip, new Vector3(0, 0, bowNockZ(0)), .008);
    string.name = side > 0 ? 'bow-string-upper' : 'bow-string-lower';
    string.userData.tipY = tip.y; string.userData.tipZ = tip.z;
  }
  if (strikeEdge) {
    marker(compiled, 'strike-center', 0, strikeEdge.height, 0);
    marker(compiled, 'outward-edge', 0, strikeEdge.height, strikeEdge.reach);
  }
  if (p.form === 'torch') {
    const flame = new Group(); flame.name = 'held-torch-flame'; flame.position.y = .73;
    for (let i = 0; i < 3; i++) {
      const mesh = kit.part(flame, 'cone', i === 0 ? C.flame : C.ember, [.12 - i * .022, .3 - i * .04, .11 - i * .02], [(i - 1) * .035, .08 + i * .045, 0], true);
      mesh.userData.baseHeight = mesh.scale.y;
    }
    flame.visible = false; compiled.add(flame);
  }
  if (p.form === 'bow' || p.form === 'crossbow' || p.form === 'harpoon-gun') {
    const projectile = new Group(); projectile.name = 'loaded-projectile';
    const harpoon = p.form === 'harpoon-gun';
    const arrow = p.form === 'bow';
    kit.part(projectile, 'cylinder', harpoon ? C.bone : C.wood, [.025, harpoon ? 1 : BOW_GEOMETRY.arrowLength, .025], [0, arrow ? 0 : .24, arrow ? BOW_GEOMETRY.arrowLength / 2 : harpoon ? .4 : .2]).rotation.x = Math.PI / 2;
    kit.part(projectile, 'cone', harpoon ? C.bone : C.steel, [harpoon ? .12 : .065, harpoon ? .18 : BOW_GEOMETRY.arrowHeadLength, .04], [0, arrow ? 0 : .24, arrow ? BOW_GEOMETRY.arrowLength + BOW_GEOMETRY.arrowHeadLength / 2 : harpoon ? .97 : .68]).rotation.x = Math.PI / 2;
    if (arrow) projectile.position.z = bowNockZ(0);
    projectile.visible = false; compiled.add(projectile);
  }
  return compiled;
}
