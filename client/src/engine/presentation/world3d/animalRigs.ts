import { Box3, Group, Mesh, Vector3 } from 'three/webgpu';
import { COLORS as C, ModelKit } from './modelKit';

type Family = 'quadruped' | 'bird' | 'insect' | 'crab' | 'serpent' | 'fish' | 'jelly' | 'humanoid';
interface Profile { family: Family; length: number; height: number; width: number; fur: number; accent: number; muzzle: number; tail: number; runSpeed: number; attackSeconds: number }
export const ANIMAL_PROFILES: Record<string, Profile> = {
  CinderFox: { family: 'quadruped', length: .95, height: .56, width: .36, fur: 0xb87945, accent: 0xdfc69b, muzzle: .3, tail: .83, runSpeed: 3, attackSeconds: .58 },
  TundraWolf: { family: 'quadruped', length: 1.4, height: .82, width: .5, fur: 0x8d978e, accent: 0xc7c9b6, muzzle: .4, tail: .72, runSpeed: 3.5, attackSeconds: .65 },
  Wolverine: { family: 'quadruped', length: 1.1, height: .55, width: .58, fur: 0x504938, accent: 0xbfa375, muzzle: .22, tail: .47, runSpeed: 3, attackSeconds: .65 },
  PolarBear: { family: 'quadruped', length: 2.12, height: 1.08, width: .94, fur: 0xd8d6be, accent: 0xb9bba8, muzzle: .4, tail: .12, runSpeed: 3.3, attackSeconds: .95 },
  Caribou: { family: 'quadruped', length: 1.64, height: 1.4, width: .6, fur: 0x89745c, accent: 0xccc2a3, muzzle: .42, tail: .22, runSpeed: 3.4, attackSeconds: .85 },
  Hare: { family: 'quadruped', length: .64, height: .4, width: .35, fur: 0xc6c9b8, accent: 0xaaa996, muzzle: .12, tail: .14, runSpeed: 2.6, attackSeconds: .45 },
  Vole: { family: 'quadruped', length: .38, height: .22, width: .24, fur: 0x8e7960, accent: 0xb3a58a, muzzle: .11, tail: .28, runSpeed: 1.6, attackSeconds: .4 },
  ArcticWalrus: { family: 'quadruped', length: 2, height: .48, width: 1.12, fur: 0x927e68, accent: 0xb9a18a, muzzle: .3, tail: .3, runSpeed: 1.9, attackSeconds: .95 },
  Crow: { family: 'bird', length: .62, height: .57, width: .33, fur: 0x303f40, accent: 0x586568, muzzle: .18, tail: .3, runSpeed: 2.2, attackSeconds: .5 },
  Tern: { family: 'bird', length: .6, height: .52, width: .28, fur: 0xd0d6c9, accent: 0x6b8385, muzzle: .24, tail: .4, runSpeed: 2.4, attackSeconds: .48 },
  SnowyOwl: { family: 'bird', length: .79, height: .78, width: .53, fur: 0xdce1cd, accent: 0x8b9588, muzzle: .08, tail: .25, runSpeed: 2.6, attackSeconds: .65 },
  Bee: { family: 'insect', length: .23, height: .18, width: .14, fur: 0xc8a24e, accent: 0x394338, muzzle: .03, tail: .05, runSpeed: 2.8, attackSeconds: .35 },
  BeachCrab: { family: 'crab', length: .55, height: .3, width: .7, fur: 0xa86a4b, accent: 0xd39b66, muzzle: .1, tail: 0, runSpeed: 2.2, attackSeconds: .6 },
  CableViper: { family: 'serpent', length: 1.65, height: .17, width: .22, fur: 0x536e54, accent: 0xb3a668, muzzle: .15, tail: .3, runSpeed: 2.7, attackSeconds: .5 },
  SalmonShark: { family: 'fish', length: 2.7, height: .62, width: .66, fur: 0x54777c, accent: 0xb2c0b5, muzzle: .4, tail: .8, runSpeed: 4, attackSeconds: .7 },
  Jellyfish: { family: 'jelly', length: .75, height: .65, width: .85, fur: 0x93beb5, accent: 0xb2ca97, muzzle: 0, tail: .75, runSpeed: .9, attackSeconds: 1 },
  Shorebound: { family: 'humanoid', length: .5, height: 1.58, width: .52, fur: 0x526d69, accent: 0x91a4a0, muzzle: .1, tail: 0, runSpeed: 3.4, attackSeconds: .62 },
  Shardkin: { family: 'humanoid', length: .36, height: .96, width: .42, fur: 0x6d8588, accent: 0xa2c0bd, muzzle: .1, tail: 0, runSpeed: 3.7, attackSeconds: .45 },
  DrownedWatch: { family: 'humanoid', length: .68, height: 2.05, width: 1.05, fur: 0x435f61, accent: 0x81958d, muzzle: .1, tail: 0, runSpeed: 2.2, attackSeconds: 1.05 },
};
export const AUTHORED_ANIMAL_SPECIES = new Set(Object.keys(ANIMAL_PROFILES));
export interface AnimalEvents { attackAge?: number; deathAge?: number; hidden?: boolean; shock?: boolean }
interface Joint { pivot: Group; lower?: Group; index: number; x: number; y: number; z: number }
const ease = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** Shared live/corpse solids. State owns each transform; attacks use server events. */
export class AnimalRig {
  readonly root = new Group();
  readonly body = new Group();
  private readonly joints: Joint[] = [];
  private readonly head = new Group();
  private readonly jaw = new Group();
  private readonly tail = new Group();
  private readonly eyes: Mesh[] = [];
  private readonly p: Profile;
  private readonly bounds = new Box3();
  private readonly origin = new Vector3();
  private phase = 0;
  private stride = 0;
  private running = 0;
  private heading = 0;
  private firstFrame = true;

  constructor(private readonly kit: ModelKit, readonly species: string) {
    const p = ANIMAL_PROFILES[species];
    if (!p) throw new Error(`Unfinished animal species ${species}`);
    this.p = p; this.root.name = `animal-${species}`;
    this.body.name = 'animal-body'; this.head.name = 'animal-head'; this.jaw.name = 'animal-jaw'; this.tail.name = 'animal-tail';
    this.root.add(this.body); this.body.add(this.head, this.tail); this.head.add(this.jaw);
    if (p.family === 'quadruped') this.quadruped();
    else if (p.family === 'bird' || p.family === 'insect') this.bird();
    else if (p.family === 'crab') this.crab();
    else if (p.family === 'serpent') this.serpent();
    else if (p.family === 'fish') this.fish();
    else if (p.family === 'jelly') this.jelly();
    else this.humanoid();
    const groups: Group[] = []; this.root.traverse(o => { if (o instanceof Group) groups.push(o); });
    for (const [index, group] of groups.entries()) {
      const solids = group.children.filter(o => o instanceof Mesh && !this.eyes.includes(o));
      if (!solids.length) continue;
      const fixed = new Group(); solids.forEach(o => fixed.add(o)); group.add(kit.compileShared(fixed, `animal:${species}:${index}`));
    }
    this.root.userData.species = species; this.root.userData.motionFamily = p.family;
  }
  private joint(x: number, y: number, z: number): Group {
    const pivot = new Group(), index = this.joints.length; pivot.name = `animal-limb-${index}`; pivot.position.set(x, y, z);
    this.body.add(pivot); this.joints.push({ pivot, index, x, y, z }); return pivot;
  }
  private eyePair(width: number, y: number, z: number, bright = false): void {
    for (const s of [-1, 1]) this.eyes.push(this.kit.part(this.head, 'rock', bright ? 0xd0b664 : C.coal, [.045, .045, .04], [s * width, y, z]));
  }
  private quadruped(): void {
    const p = this.p, part = this.kit.part.bind(this.kit), walrus = this.species === 'ArcticWalrus', hare = this.species === 'Hare';
    part(this.body, 'rock', p.fur, [p.width, p.height * .8, p.length], [0, p.height * .88, -.04]);
    part(this.body, 'rock', p.accent, [p.width * .78, p.height * .48, p.length * .8], [0, p.height * .65, .08]);
    if (this.species === 'Wolverine') for (const s of [-1, 1]) part(this.body, 'rock', p.accent, [p.width * .22, .14, p.length * .9], [s * p.width * .35, p.height * 1.12, -.12]);
    this.head.position.set(0, p.height * 1.12, p.length * .43);
    part(this.head, 'rock', p.fur, [p.width * .77, p.width * .83, p.width * .88], [0, 0, 0]);
    part(this.head, 'rock', p.accent, [p.width * .48, p.width * .27, p.muzzle], [0, -p.width * .12, p.width * .35]);
    part(this.head, 'rock', C.coal, [p.width * .23, p.width * .13, .06], [0, -p.width * .08, p.width * .35 + p.muzzle * .48]);
    this.jaw.position.set(0, -p.width * .19, p.width * .14);
    part(this.jaw, 'rock', p.accent, [p.width * .43, p.width * .12, p.muzzle * .95], [0, -.025, p.muzzle * .4]);
    this.eyePair(p.width * .27, p.width * .08, p.width * .3);
    for (const s of [-1, 1]) {
      const round = /Bear|Vole/.test(this.species);
      if (!walrus) part(this.head, round ? 'rock' : 'cone', p.fur,
        [p.width * .29, hare ? .5 : p.width * .38, p.width * .25], [s * p.width * .29, p.width * .42 + (hare ? .17 : 0), -.025]);
      if (walrus) {
        this.kit.branch(this.head, C.bone, [new Vector3(s * .19, -.1, .3), new Vector3(s * .23, -.4, .38), new Vector3(s * .2, -.62, .43)], [.055, .035, .006]);
        for (let i = 0; i < 3; i++) this.kit.beam(this.head, p.accent, new Vector3(s * .08, -.05 - i * .04, .45), new Vector3(s * .37, -.06 - i * .05, .5), .009);
      }
    }
    for (let i = 0; i < 4; i++) {
      const limb = this.joint((i % 2 ? 1 : -1) * p.width * .35, p.height * .88, (i < 2 ? 1 : -1) * p.length * .31);
      const upper = p.height * .43, lower = p.height * .4;
      part(limb, 'rock', p.fur, [p.width * .26, upper, walrus ? .48 : p.width * .34], [0, -upper * .45, 0]);
      const shin = new Group(); shin.position.y = -upper; limb.add(shin); this.joints[i].lower = shin;
      part(shin, 'box', p.fur, [p.width * .18, lower, walrus ? .36 : p.width * .21], [0, -lower * .45, 0]);
      part(shin, 'rock', walrus ? p.fur : C.coal, [p.width * .25, .1, walrus ? .46 : p.width * .38], [0, -lower + .03, .04]);
    }
    this.tail.position.set(0, p.height * .94, -p.length * .45);
    part(this.tail, 'rock', p.fur, [p.width * .48, p.width * .4, p.tail], [0, -.06, -p.tail * .43]);
    if (this.species === 'CinderFox') part(this.tail, 'rock', C.bone, [.18, .18, .25], [0, -.07, -p.tail * .85]);
    if (this.species === 'Caribou') for (const s of [-1, 1]) {
      const points = [new Vector3(s * .16, .24, -.05), new Vector3(s * .39, .66, -.16), new Vector3(s * .61, 1.01, -.25)];
      this.kit.branch(this.head, C.bone, points, [.045, .03, .006]);
      for (let i = 0; i < 4; i++) this.kit.branch(this.head, C.bone,
        [points[0].clone().lerp(points[2], .25 + i * .17), new Vector3(s * (.18 + i * .14), .65 + i * .15, .1 - i * .07)], [.026, .005], 5);
    }
  }
  private bird(): void {
    const p = this.p, part = this.kit.part.bind(this.kit), bee = p.family === 'insect', owl = this.species === 'SnowyOwl';
    part(this.body, 'rock', p.fur, [p.width, p.height * .7, p.length], [0, p.height * .58, 0]);
    this.head.position.set(0, p.height * .96, p.length * .26);
    part(this.head, 'rock', owl ? p.fur : p.accent, [p.width * (owl ? .98 : .75), p.width, p.width * .85], [0, 0, 0]);
    if (owl) part(this.head, 'rock', 0xeee8ce, [p.width * .8, p.width * .75, .12], [0, 0, p.width * .36]);
    this.eyePair(p.width * .23, .015, p.width * .35, owl);
    if (!bee) part(this.jaw, 'cone', this.species === 'Tern' ? 0xb99249 : C.coal, [.08, p.muzzle, .09], [0, -.025, p.width * .5]).rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) {
      const wing = this.joint(s * p.width * .35, p.height * .65, -.04), span = bee ? .3 : owl ? .95 : .74;
      for (let i = 0; i < (bee ? 2 : 5); i++) {
        part(wing, 'leaf', bee ? 0xb6cdc0 : i % 2 ? p.accent : p.fur,
          [span * .28, bee ? .012 : .028, span * (.75 - i * .07)], [s * span * (.13 + i * .14), 0, -.06 - i * .045]).rotation.set(.1, s * (.6 + i * .05), -s * .15);
      }
      if (!bee) {
        const leg = this.joint(s * p.width * .24, p.height * .3, .03);
        this.kit.beam(leg, 0x8d8061, new Vector3(), new Vector3(0, -p.height * .27, .06), .018);
        part(leg, 'box', 0x8d8061, [.09, .025, .15], [0, -p.height * .27, .1]);
      }
    }
    this.tail.position.set(0, p.height * .58, -p.length * .4);
    for (const s of [-1, 1]) part(this.tail, 'leaf', p.accent, [p.width * .38, .025, p.tail], [s * .04, 0, -p.tail * .7]).rotation.y = Math.PI + s * .22;
    if (bee) for (let i = 0; i < 3; i++) part(this.body, 'box', p.accent, [p.width * .9, p.height * .58, .025], [0, p.height * .58, -.08 + i * .065]);
  }
  private crab(): void {
    const p = this.p, part = this.kit.part.bind(this.kit);
    part(this.body, 'rock', p.fur, [p.width, .25, p.length], [0, .24, 0]);
    part(this.body, 'rock', p.accent, [p.width * .8, .09, p.length * .7], [0, .36, 0]);
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
      const limb = this.joint(s * .25, .23, -.22 + i * .13);
      this.kit.branch(limb, p.fur, [new Vector3(), new Vector3(s * .28, .035, -.1), new Vector3(s * .4, -.22, -.04)], [.04, .032, .009], 5);
    }
    for (const s of [-1, 1]) {
      const claw = this.joint(s * .29, .24, .22);
      this.kit.beam(claw, p.fur, new Vector3(), new Vector3(s * .17, .06, .22), .045);
      part(claw, 'rock', p.accent, [.22, .19, .32], [s * .22, .08, .3]);
      part(claw, 'cone', p.fur, [.08, .21, .09], [s * .29, .09, .48]).rotation.x = Math.PI / 2;
    }
    this.head.position.set(0, .34, .19); this.eyePair(.15, .08, .03);
  }
  private serpent(): void {
    const p = this.p;
    for (let i = 0; i < 13; i++) {
      const segment = this.joint(Math.sin(i * .7) * .16, .12, (6 - i) * .13), width = p.width * (1 - Math.max(0, i - 6) * .11);
      this.kit.part(segment, 'rock', i % 3 ? p.fur : p.accent, [width, width * .8, .21], [0, 0, 0]);
    }
    this.head.position.set(0, .14, .85);
    this.kit.part(this.head, 'rock', p.fur, [.26, .17, .28], [0, 0, .02]); this.eyePair(.09, .04, .1);
    this.kit.part(this.jaw, 'box', p.accent, [.15, .04, .2], [0, -.06, .04]);
  }
  private fish(): void {
    const p = this.p, part = this.kit.part.bind(this.kit);
    part(this.body, 'rock', p.fur, [p.width, p.height, p.length * .79], [0, .27, 0]);
    part(this.body, 'rock', p.accent, [p.width * .82, p.height * .33, p.length * .68], [0, .09, .08]);
    this.head.position.set(0, .25, p.length * .33);
    part(this.head, 'rock', p.fur, [p.width * .82, .45, .8], [0, 0, .03]); this.eyePair(p.width * .29, .05, .2);
    this.jaw.position.set(0, -.13, .15); part(this.jaw, 'rock', p.accent, [.43, .12, .42], [0, 0, .03]);
    for (const s of [-1, 1]) {
      part(this.body, 'leaf', p.fur, [.4, .07, .8], [s * .28, .19, .1]).rotation.set(0, s * 1.05, s * .28);
      for (let i = 0; i < 3; i++) part(this.body, 'box', 0x39575d, [.015, .21, .035], [s * .3, .27, .35 - i * .08]);
    }
    part(this.body, 'leaf', p.fur, [.08, .67, .65], [0, .45, -.1]).rotation.x = -.8;
    this.tail.position.set(0, .28, -p.length * .37); part(this.tail, 'rock', p.fur, [.22, .25, .6], [0, 0, -.2]);
    for (const s of [-1, 1]) part(this.tail, 'leaf', p.fur, [.1, .65, .5], [0, s * .13, -.5]).rotation.x = s * .9;
  }
  private jelly(): void {
    const p = this.p;
    this.kit.part(this.body, 'rock', p.fur, [.88, .4, .86], [0, .78, 0]);
    this.kit.part(this.body, 'skirt', p.accent, [.69, .15, .69], [0, .62, 0]);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2, tentacle = this.joint(Math.sin(a) * .27, .63, Math.cos(a) * .27);
      this.kit.branch(tentacle, i % 2 ? p.accent : p.fur, [new Vector3(), new Vector3(Math.sin(a) * .04, -.25, 0), new Vector3(-.05, -.5 - i % 3 * .04, .07)], [.025, .018, .006], 5);
    }
  }
  private humanoid(): void {
    const p = this.p, part = this.kit.part.bind(this.kit);
    part(this.body, 'rock', p.fur, [p.width, p.height * .43, p.length], [0, p.height * .6, 0]);
    this.head.position.set(0, p.height * .93, .12); part(this.head, 'rock', p.accent, [p.width * .56, p.height * .23, p.length * .7], [0, 0, 0]);
    this.eyePair(p.width * .14, .03, p.length * .35, true);
    for (let i = 0; i < 4; i++) {
      const arm = i < 2, sign = i % 2 ? 1 : -1, limb = this.joint(sign * p.width * (arm ? .57 : .25), p.height * (arm ? .75 : .44), 0), length = p.height * (arm ? .48 : .42);
      part(limb, 'rock', p.fur, [p.width * .24, length, p.length * .37], [0, -length * .5, .03]);
      part(limb, 'rock', p.accent, [p.width * .2, .11, .2], [0, -length, .1]);
    }
    for (let i = 0; i < (this.species === 'Shardkin' ? 7 : 4); i++) part(this.body, 'cone', p.accent,
      [.15, .3 + i % 2 * .12, .18], [(i % 2 ? 1 : -1) * p.width * .34, p.height * .8, -.16 - Math.floor(i / 2) * .1]).rotation.x = -.5;
  }

  update(speed: number, yaw: number, dt: number, time: number, flying = false, attacking = false, events: AnimalEvents = {}): void {
    const p = this.p, dead = events.deathAge !== undefined, response = 1 - Math.exp(-Math.max(0, dt) * 12);
    this.stride += (Math.min(1, speed / .65) - this.stride) * response;
    this.running += (Math.max(0, Math.min(1, (speed / p.runSpeed - .4) / .5)) - this.running) * response;
    this.phase += Math.max(0, dt) * (3.5 + Math.min(speed, p.runSpeed * 1.5) * 2.4);
    const phase = this.phase, gait = this.stride, run = this.running;
    if (this.firstFrame) { this.heading = yaw; this.firstFrame = false; }
    this.heading += Math.atan2(Math.sin(yaw - this.heading), Math.cos(yaw - this.heading)) * (1 - Math.exp(-dt * 14));
    this.root.rotation.y = this.heading; this.root.visible = !events.hidden;
    this.body.position.set(0, 0, 0); this.body.rotation.set(0, 0, 0); this.body.scale.set(1, 1, 1);
    this.head.rotation.set(0, 0, 0); this.jaw.rotation.x = 0; this.tail.rotation.set(0, 0, 0);
    this.eyes.forEach(eye => { eye.visible = !dead; });
    for (const j of this.joints) { j.pivot.rotation.set(0, 0, 0); j.pivot.position.set(j.x, j.y, j.z); if (j.lower) j.lower.rotation.x = 0; }
    const age = events.attackAge ?? (attacking ? time % p.attackSeconds : -1);
    const attack = !dead && age >= 0 && age < p.attackSeconds ? Math.sin(ease(age / p.attackSeconds) * Math.PI) : 0;
    if (dead) {
      const fall = ease(events.deathAge! / .72);
      this.body.rotation.z = (p.family === 'fish' ? Math.PI : p.family === 'jelly' || p.family === 'serpent' ? .12 : Math.PI / 2) * fall;
      this.body.rotation.x = -.12 * fall;
      if (p.family === 'jelly') this.body.scale.y = 1 - fall * .7;
      for (const j of this.joints) { j.pivot.rotation.x = -.75 * fall; j.pivot.rotation.z = (j.index % 2 ? -1 : 1) * .25 * fall; if (j.lower) j.lower.rotation.x = .9 * fall; }
      this.jaw.rotation.x = .15 * fall;
      this.root.updateMatrixWorld(true); this.root.getWorldPosition(this.origin); this.bounds.setFromObject(this.body);
      this.body.position.y += this.origin.y - this.bounds.min.y;
      this.root.userData.animation = { state: fall < 1 ? 'death' : 'corpse', progress: fall }; return;
    }
    if (p.family === 'quadruped' || p.family === 'humanoid') {
      this.body.position.y = Math.abs(Math.sin(phase * (run > .5 ? 1 : 2))) * gait * (this.species === 'Hare' ? .17 : .025 + run * .055);
      this.body.position.z = attack * .19; this.body.rotation.x = Math.sin(phase * 2) * gait * .025 - attack * .08;
      this.head.rotation.x = .025 * Math.sin(time * 1.7) + attack * (this.species === 'Caribou' ? .75 : -.22); this.jaw.rotation.x = attack * .65;
      for (const j of this.joints) {
        const diagonal = j.index === 0 || j.index === 3 ? 0 : Math.PI, gallop = j.index < 2 ? 0 : 1.4;
        const swing = Math.sin(phase + diagonal) * (1 - run) + Math.sin(phase + gallop) * run;
        j.pivot.rotation.x = swing * gait * (.38 + run * .5) + (p.family === 'humanoid' && j.index < 2 ? -attack * 1.8 : 0);
        if (j.lower) j.lower.rotation.x = Math.max(0, -swing) * gait * (.45 + run * .6);
      }
      this.tail.rotation.y = Math.sin(phase * .65) * (.09 + gait * .2);
    } else if (p.family === 'bird' || p.family === 'insect') {
      const air = flying || p.family === 'insect';
      this.body.position.y = air ? (p.family === 'insect' ? .65 : 1.1) + Math.sin(time * 2.5) * .09 - attack * .42 : Math.abs(Math.sin(phase)) * gait * .035;
      this.body.rotation.x = air ? -.1 - run * .15 + attack * .5 : attack * .55; this.head.rotation.x = attack * .3;
      for (const j of this.joints) {
        const wing = Math.abs(j.x) > p.width * .3;
        if (wing) j.pivot.rotation.z = (j.x > 0 ? 1 : -1) * (air ? Math.sin(time * (p.family === 'insect' ? 75 : 13)) * .75 : -.95);
        else j.pivot.rotation.x = air ? .8 : Math.sin(phase + j.index * Math.PI) * gait * .55;
      }
    } else if (p.family === 'crab') {
      for (const j of this.joints) if (j.index < 8) j.pivot.rotation.z = Math.sin(phase + j.index * 1.7) * gait * .25;
      else { j.pivot.rotation.x = -attack * 1.1; j.pivot.rotation.y = (j.x > 0 ? -1 : 1) * attack * .5; }
    } else if (p.family === 'serpent') {
      for (const j of this.joints) j.pivot.position.x = Math.sin(phase * .8 - j.index * .55) * (.11 + gait * .12) * (1 - attack * .6);
      this.head.position.set(Math.sin(phase * .8) * .1 * (1 - attack), .14 + attack * .18, .85 + attack * .35); this.jaw.rotation.x = attack * .85;
    } else if (p.family === 'fish') {
      this.body.position.y = Math.sin(time * 1.8) * .045; this.body.rotation.y = Math.sin(phase) * (.025 + gait * .04);
      this.tail.rotation.y = Math.sin(phase + .7) * (.2 + gait * .4); this.head.rotation.x = -.12 * attack; this.jaw.rotation.x = attack * .9; this.body.position.z = attack * .24;
    } else {
      const pulse = Math.sin(phase * .55 + time * .8); this.body.position.y = pulse * (.07 + run * .045);
      this.body.scale.set(1 + pulse * .08 + attack * .12, 1 - pulse * .1, 1 + pulse * .08 + attack * .12);
      for (const j of this.joints) { j.pivot.rotation.x = Math.sin(time * 2.2 - j.index * .5) * .18; j.pivot.rotation.z = Math.cos(time * 2.2 - j.index * .5) * .15; }
    }
    this.root.userData.animation = { state: attack > 0 ? 'attack' : flying ? 'flight' : gait > .1 ? run > .5 ? 'run' : 'walk' : 'idle', phase, attack, shock: Boolean(events.shock) };
  }
}
