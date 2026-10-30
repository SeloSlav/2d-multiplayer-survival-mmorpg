import { Group, Vector3 } from 'three/webgpu';
import type { MeshStandardMaterial } from 'three/webgpu';
import { COLORS as C, ModelKit } from './modelKit';
import { seededRandom } from './visualContract';
import { RUNE_PALETTES, RUNE_STONE_SCALE, runeType } from './runeStoneProfile';

export const NATURAL_OBJECT_TABLES = ['runeStones', 'cairns', 'livingCorals', 'seaStacks', 'basaltColumns', 'fumaroles', 'roadLampposts'] as const;

export function createRuneStone(kit: ModelKit, type: string, seed: number, glyphMaterial?: MeshStandardMaterial): Group {
  const g = new Group(), random = seededRandom(seed);
  const glow = RUNE_PALETTES[runeType(type)].glow;
  const glyph = (a: Vector3, b: Vector3, radius: number) => {
    const beam = kit.beam(g, glow, a, b, radius);
    if (glyphMaterial) beam.material = glyphMaterial;
  };
  g.scale.setScalar(RUNE_STONE_SCALE);
  kit.part(g, 'rock', C.stoneDark, [1.65, .35, 1.05], [0, .13, 0]);
  const slab = kit.prism(g, 0x768b87, [[-.53, -.22], [.51, -.22], [.57, .17], [-.56, .2]], .23, 2.18);
  slab.rotation.z = -.035;
  kit.part(g, 'rock', 0x8e9e96, [1.1, .42, .44], [0, 2.13, 0]);
  // Actual raised/chiselled strokes on both faces, never text on a sprite plane.
  for (const face of [-1, 1]) {
    for (const x of [-.43, .43]) kit.beam(g, 0x4d6867, new Vector3(x, .42, face * .235), new Vector3(x, 1.96, face * .235), .018);
    for (let i = 0; i < 9; i++) for (const s of [-1, 1]) {
      const y = .49 + i * .17, x = s * .43;
      kit.beam(g, 0x4d6867, new Vector3(x - .06, y, face * .24), new Vector3(x + .05, y + .07 * (i % 2 ? 1 : -1), face * .24), .015);
    }
    glyph(new Vector3(0, .65, face * .253), new Vector3(0, 1.75, face * .253), .026);
    for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
      const a = new Vector3(0, .95 + i * .35, face * .253), b = new Vector3(s * .28, 1.18 + i * .35, face * .253);
      glyph(a, b, .025);
      if (type === 'Red') glyph(b, new Vector3(s * .2, .9 + i * .35, face * .253), .025);
      if (type === 'Blue') glyph(b, new Vector3(0, 1.55 + i * .15, face * .253), .025);
    }
  }
  for (let i = 0; i < 12; i++) kit.part(g, 'rock', i % 2 ? 0x6d8051 : 0x89965b,
    [.14 + random() * .2, .07, .16], [(random() - .5) * 1.3, .29, (random() - .5) * .7]);
  const model = kit.compile(g); model.userData.naturalObject = `rune:${type}`; return model;
}

export function createCairn(kit: ModelKit, seed: number, zone = ''): Group {
  const g = new Group(), random = seededRandom(seed);
  const stone = /alpine/.test(zone) ? 0xabb5b0 : /beach/.test(zone) ? 0x9e9481 : /tundra/.test(zone) ? 0x8b9483 : 0x87908a;
  for (let i = 0; i < 6; i++) {
    const width = 1.13 - i * .145;
    const mesh = kit.part(g, 'rock', i % 2 ? stone : C.stoneDark, [width, .25 + random() * .06, width * .63], [(random() - .5) * .1, .13 + i * .22, (random() - .5) * .08]);
    mesh.rotation.y = i * 1.7;
  }
  for (let i = 0; i < 5; i++) kit.part(g, 'rock', stone, [.25, .15, .23], [Math.sin(i * 2.4) * .7, .06, Math.cos(i * 2.4) * .48]);
  return kit.compile(g);
}

/** Four reef compositions: branching coral, plates, brain domes and hollow sponges. */
export function createCoral(kit: ModelKit, variant: number, seed: number, miniature = false): Group {
  const g = new Group(), random = seededRandom(seed), v = variant % 4;
  const colors = [[0xb47476, 0xd5a48b, 0x8a9194], [0xc38b5b, 0xd7b57c, 0x73928b], [0xa77b9e, 0xc2a5b3, 0xc9b478], [0x6eaaa0, 0x9ac3b3, 0x8c99b4]][v];
  kit.part(g, 'rock', 0x6b8580, [2.25, .3, 1.6], [0, .05, 0]);
  for (let i = 0; i < 6; i++) {
    const a = i * 2.4, x = Math.sin(a) * (.32 + random() * .45), z = Math.cos(a) * .5;
    if ((i + v) % 3 === 0) {
      const dome = new Group(); dome.position.set(x, .23, z);
      kit.part(dome, 'rock', colors[0], [.75, .57, .66], [0, .12, 0]);
      for (let j = 0; j < 5; j++) kit.branch(dome, colors[1], [new Vector3(-.25, .2 + j * .035, -.21 + j * .1), new Vector3(0, .4, -.16 + j * .08), new Vector3(.24, .21, -.17 + j * .08)], [.017, .022, .014], 5);
      g.add(dome);
    } else if ((i + v) % 3 === 1) {
      const start = new Vector3(x, .16, z), tip = new Vector3(x + .12, .78 + random() * .3, z + .07);
      kit.branch(g, colors[0], [start, start.clone().lerp(tip, .5), tip], [.075, .052, .022]);
      for (let j = 0; j < 4; j++) {
        const b = start.clone().lerp(tip, .35 + j * .15), t = b.clone().add(new Vector3(Math.sin(j * 2.4) * .31, .23, Math.cos(j * 2.4) * .2));
        kit.branch(g, colors[j % 2], [b, t], [.038, .009]);
      }
    } else for (let j = 0; j < 3; j++) {
      const sponge = kit.vessel(g, colors[2], .12 + j * .035, .16 + j * .035, .035, .24 + j * .12, 8);
      sponge.position.set(x + j * .12, .15, z + j * .07); sponge.rotation.z = (j - 1) * .15;
    }
  }
  for (let i = 0; i < 3; i++) kit.part(g, 'rock', colors[1], [.6 + i * .17, .08, .4 + i * .13], [-.58, .25 + i * .16, -.25]).rotation.z = -.12;
  const result = kit.compile(g); result.userData.naturalObject = `coral:${v}`;
  if (miniature) result.scale.setScalar(.28); return result;
}

export function createKelp(kit: ModelKit, seed: number): Group {
  const g = new Group(), random = seededRandom(seed);
  kit.part(g, 'rock', 0x68877c, [.48, .15, .35], [0, .02, 0]);
  for (let i = 0; i < 7; i++) {
    const a = i * 2.399, h = .55 + random() * .7, x = Math.sin(a) * .12, z = Math.cos(a) * .12;
    const points = [new Vector3(x, 0, z), new Vector3(x + .12, h * .4, z + .05), new Vector3(x - .03, h * .72, z + .1), new Vector3(x + .14, h, z + .17)];
    kit.branch(g, 0x537d56, points, [.023, .02, .014, .005], 5);
    for (let j = 1; j < 4; j++) {
      const pos = points[j], leaf = kit.part(g, 'leaf', i % 2 ? 0x719766 : 0x487e62, [.15 + random() * .08, .028, .35 + random() * .16], [pos.x, pos.y - .12, pos.z]);
      leaf.rotation.set(-.85, a + j * .7, .15 * (i % 2 ? 1 : -1));
    }
  }
  g.userData.vegetation={height:1.3,base:.12,flexibility:.15};
  const result = kit.compile(g); result.userData.naturalObject = 'kelp'; return result;
}

export function createGeologicalObject(kit: ModelKit, kind: string, variant: string, seed: number, submerged = false): Group {
  const g = new Group(), random = seededRandom(seed);
  if (kind === 'seaStacks') {
    const height = variant === 'Tall' ? 4.6 : variant === 'Wide' ? 2.5 : 3.4, width = variant === 'Wide' ? 3.4 : 2.5;
    for (let i = 0; i < 6; i++) {
      const t = i / 6, r = width * (.55 - t * .22);
      kit.part(g, 'rock', i % 2 ? 0x7e8983 : 0x91978a, [r * 2, height / 4, r * 1.25], [Math.sin(i * .8) * .15, height * t + height / 10, .05]);
      if (i === 5) kit.part(g, 'rock', 0x6b8153, [r * 1.7, .16, r], [.08, height * t + height / 5, .05]);
    }
  } else if (kind === 'basaltColumns') {
    const n = variant === 'Type2' ? 9 : 5;
    for (let i = 0; i < n; i++) {
      const a = i * 2.4, h = .7 + random() * 2.0, x = Math.sin(a) * i * .1, z = Math.cos(a) * i * .09;
      const polygon: [number, number][] = Array.from({ length: 6 }, (_, j) => [x + Math.sin(j / 6 * Math.PI * 2) * .32, z + Math.cos(j / 6 * Math.PI * 2) * .32]);
      polygon.reverse(); kit.prism(g, i % 2 ? 0x56656a : 0x6d797a, polygon, 0, h);
      for (let j = 1; j < 3; j++) kit.part(g, 'box', 0x414e52, [.4, .018, .017], [x, h * j / 3, z + .28]);
    }
  } else if (kind === 'fumaroles') {
    // Low volcanic crater with a dark open throat, scorched mineral lip and
    // fractured ground, based on the original vent rather than a fire ring.
    const base=new Group();
    for(let i=0;i<15;i++){
      const a=i/15*Math.PI*2, r=.73+random()*.14;
      const rock=kit.part(base,'rock',i%3===0?0xb47c58:i%2?0x795b4e:0x96715a,
        [.54+random()*.14,.12+random()*.08,.42+random()*.12],[Math.sin(a)*r,.045,Math.cos(a)*r*.78]);rock.rotation.y=a;
    }
    for(let i=0;i<12;i++){
      const a=i/12*Math.PI*2, b=(i+1)/12*Math.PI*2;
      const points:[[number,number],[number,number],[number,number],[number,number]]=[
        [Math.sin(a)*.37,Math.cos(a)*.30],[Math.sin(b)*.37,Math.cos(b)*.30],
        [Math.sin(b)*.72,Math.cos(b)*.59],[Math.sin(a)*.72,Math.cos(a)*.59]];
      kit.prism(base,i%3===0?0xc77a40:i%2?0x9c593b:0xb46b3d,points,.055,.18+(i%3)*.015);
    }
    kit.part(base,'cylinder',0x402d2d,[.76,.035,.61],[0,.12,0]);
    const body=kit.compileColored(base);body.name='volcanic-vent';
    body.traverse(object=>{if('castShadow' in object)object.castShadow=false;});
    const plume=new Group();plume.name='vent-emission';
    for(let i=0;i<7;i++){
      const particle=kit.part(plume,'rock',submerged?0xa4ceca:0xd2d1bc,[.09,.09,.09],[0,0,0]);
      particle.material=kit.fadedMaterial(particle.material as import('three/webgpu').MeshStandardMaterial,submerged ? .55 : .28);
      particle.castShadow=false;particle.receiveShadow=false;particle.userData.phase=i/7;
    }
    g.add(body,plume);g.userData.naturalObject='fumarole';return g;
  } else if (kind === 'roadLampposts') {
    kit.part(g, 'rock', 0x6c746b, [.5, .25, .46], [0, .1, 0]);
    kit.beam(g, C.iron, new Vector3(), new Vector3(0, 3.7, 0), .065);
    kit.branch(g, C.iron, [new Vector3(0, 3.5, 0), new Vector3(.12, 3.9, 0), new Vector3(.6, 3.9, 0)], [.06, .055, .05]);
    kit.part(g, 'box', C.iron, [.48, .13, .36], [.59, 3.85, 0]);
    kit.part(g, 'box', 0xc4c5a0, [.36, .045, .25], [.59, 3.76, 0]);
  } else throw new Error(`Unfinished natural object ${kind}`);
  return kit.compile(g);
}
