import { DataTexture, LinearFilter, MeshStandardNodeMaterial, NearestFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector2 } from 'three/webgpu';
import { attribute, cameraViewMatrix, color, dFdx, dFdy, float, max, mix, normalWorldGeometry, sin, smoothstep, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { createTerrainField, sampleTerrainDepth, TERRAIN_KINDS } from './terrainField';
import type { TerrainTile, TerrainField } from './terrainField';
import { CloudShadows3d } from './CloudShadows3d';
export { createTerrainField, TERRAIN_KINDS, WATER_DEPTH } from './terrainField';
export type { TerrainTile, TerrainField } from './terrainField';

const INNER = 128, PAD = 4, STRIDE = INNER + PAD * 2, ATLAS = STRIDE * 4;
const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const wrap = (n: number, period: number) => (n % period + period) % period;
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x + seed * 13, 374761393) ^ Math.imul(y + seed * 7, 668265263);
  h = Math.imul(h ^ h >>> 13, 1274126177); return (h ^ h >>> 16) >>> 0;
}
function noise(u: number, v: number, frequency: number, seed: number): number {
  const x = u * frequency, y = v * frequency, ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (dx: number, dy: number) => hash(wrap(ix + dx, frequency), wrap(iy + dy, frequency), seed) / 4294967295;
  return (at(0, 0) * (1 - sx) + at(1, 0) * sx) * (1 - sy) + (at(0, 1) * (1 - sx) + at(1, 1) * sx) * sy;
}
const PAINT_BASE: Record<string, number> = {
  Grass: 0x829260, Forest: 0x536a48, Dirt: 0x9b8061, DirtRoad: 0xb2a181,
  Sea: 0xa0aa8c, DeepSea: 0x748d82, Beach: 0xcebf98, Sand: 0xd9c69d,
  HotSpringWater: 0xb1b69a, Quarry: 0x969b92, Asphalt: 0x66706e,
  Tundra: 0x9ca18b, Alpine: 0xd7dfd7, TundraGrass: 0xa2a273, Tilled: 0x7f634b,
};
export interface PaintedAtlases { albedo: Uint8Array; normal: Uint8Array; size: number }

/** Seamless pigment patches, small painted marks and species-specific relief.
 * Albedo/roughness/normal derive from the same height and pigment fields. */
export function createPaintedAtlases(): PaintedAtlases {
  const albedo = new Uint8Array(ATLAS * ATLAS * 4), normal = new Uint8Array(albedo.length);
  TERRAIN_KINDS.forEach((kind, layer) => {
    const heights = new Float32Array(INNER * INNER), pigments = new Float32Array(INNER * INNER);
    const grass = /Grass|Forest/.test(kind), sand = /Sand|Beach|Sea|HotSpring/.test(kind), snow = kind === 'Alpine';
    for (let y = 0; y < INNER; y++) for (let x = 0; x < INNER; x++) {
      const u = x / INNER, v = y / INNER, wash = noise(u, v, 4, 73), patches = noise(u, v, 9, 48);
      const warp = noise(u, v, 5, 21) - .5, grit = noise(u, v, 48, 9);
      const bx = u * 11, by = v * 9, cellX = Math.floor(bx), cellY = Math.floor(by), h = hash(cellX, cellY, layer + 27);
      const angle = (h % 127) / 127 * 2.5 - 1.25;
      const dx = bx - cellX - (.22 + (h & 255) / 255 * .56), dy = by - cellY - (.22 + (h >>> 8 & 255) / 255 * .56);
      const along = dx * Math.cos(angle) + dy * Math.sin(angle), across = -dx * Math.sin(angle) + dy * Math.cos(angle);
      const dab = Math.exp(-along * along * 7 - across * across * (grass ? 100 : 35));
      const ridges = Math.sin((u * (kind === 'Tilled' ? 16 : 8) + v * (kind === 'Tilled' ? 0 : 3) + warp * .28) * Math.PI * 2);
      let relief = (wash - .5) * .25 + (patches - .5) * .13 + (grit - .5) * .045;
      let pigment = (Math.round(wash * 6) / 6 - .5) * .18 + (patches - .5) * .11;
      if (grass) {
        // Interlocking, irregular leaf marks read as painted ground cover rather
        // than a stretched wash. Periodic cells keep the atlas edges seamless.
        const gx = u * 24, gy = v * 24, ix = Math.floor(gx), iy = Math.floor(gy);
        let distance = 10, tone = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const mark = hash(wrap(ix + ox, 24), wrap(iy + oy, 24), layer + 101);
          const mx = gx - ix - ox - (.12 + (mark & 255) / 255 * .76);
          const my = gy - iy - oy - (.12 + (mark >>> 8 & 255) / 255 * .76);
          const d = Math.abs(mx + my * ((mark & 0x10000) ? .38 : -.38)) * 1.1 + Math.abs(my) * .7;
          if (d < distance) { distance = d; tone = ((mark >>> 18) % 5 - 2) * .045; }
        }
        const leaf = distance < .34;
        const fleck = hash(x, y, layer + 211) % 19 === 0;
        relief += (leaf ? .09 : -.025) + (fleck ? .025 : 0);
        pigment += (leaf ? .095 + tone : -.045) + (fleck ? .045 : 0) + (Math.round(patches * 4) / 4 - .5) * .13;
      }
      else if (sand) {
        const grain = hash(x, y, layer + 301) % 13;
        relief += ridges * .025 + (grain === 0 ? .035 : 0);
        pigment += ridges * .024 + (grain === 0 ? -.095 : grain === 1 ? .055 : 0);
      }
      else if (kind === 'Tilled') { relief += ridges * .15; pigment += ridges * .095; }
      else if (kind === 'Quarry') { const slab = Math.round(patches * 5) / 5; relief += slab * .24; pigment += (slab - .5) * .22; }
      else if (kind === 'Asphalt') { relief = (grit - .5) * .035; pigment = (wash - .5) * .09 + (grit - .5) * .07 - (patches < .23 ? .06 : 0); }
      else if (snow) {
        const crystal = hash(x, y, layer + 351) % 17;
        relief = (wash - .5) * .17 + dab * .025 + (crystal === 0 ? .025 : 0);
        pigment = (wash - .5) * .1 + (patches - .5) * .055 + (crystal === 0 ? -.065 : crystal === 1 ? .025 : 0);
      }
      else {
        const grain = hash(x, y, layer + 401) % 17;
        relief += dab * .05 + (grain === 0 ? .035 : 0);
        pigment += dab * .045 + (grain === 0 ? -.1 : grain === 1 ? .055 : 0);
      }
      heights[y * INNER + x] = relief; pigments[y * INNER + x] = pigment;
    }
    const base = PAINT_BASE[kind], rgb = [(base >> 16) & 255, (base >> 8) & 255, base & 255];
    for (let y = -PAD; y < INNER + PAD; y++) for (let x = -PAD; x < INNER + PAD; x++) {
      const ix = wrap(x, INNER), iy = wrap(y, INNER), p = iy * INNER + ix;
      const offset = ((Math.floor(layer / 4) * STRIDE + y + PAD) * ATLAS + (layer % 4 * STRIDE + x + PAD)) * 4;
      const pigment = pigments[p], height = heights[p];
      for (let c = 0; c < 3; c++) albedo[offset + c] = clamp(rgb[c] * (1 + pigment) + (c === 0 ? 7 : c === 2 ? -5 : 2) * pigment, 0, 255);
      albedo[offset + 3] = clamp((snow ? .92 : kind === 'Asphalt' ? .87 : .94) - height * .4) * 255;
      const dx = heights[iy * INNER + wrap(ix + 1, INNER)] - heights[iy * INNER + wrap(ix - 1, INNER)];
      const dz = heights[wrap(iy + 1, INNER) * INNER + ix] - heights[wrap(iy - 1, INNER) * INNER + ix];
      const strength = snow ? 2 : sand ? 3 : 4, nx = -dx * strength, nz = -dz * strength, length = Math.hypot(nx, 1, nz);
      normal[offset] = (nx / length * .5 + .5) * 255; normal[offset + 1] = (1 / length * .5 + .5) * 255;
      normal[offset + 2] = (nz / length * .5 + .5) * 255; normal[offset + 3] = clamp(height + .5) * 255;
    }
  });
  return { albedo, normal, size: ATLAS };
}

/** One shared stable field drives biome blending, coastal wetness and shoreline waves. */
export class TerrainMaterials3d {
  readonly cloudShadows = new CloudShadows3d();
  readonly material = new MeshStandardNodeMaterial({ roughness: .95 });
  readonly origin = uniform(new Vector2());
  readonly dimensions = uniform(new Vector2(1, 1));
  private readonly diagnostic = uniform(0);
  private readonly diving = uniform(0);
  private readonly albedo: DataTexture;
  private readonly normals: DataTexture;
  readonly field = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  private readonly coastTexture = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  private readonly fieldNode;
  private readonly coastNode;
  private readonly pigmentNode;
  private readonly normalNode;
  private currentField: TerrainField | null = null;

  constructor() {
    const atlas = createPaintedAtlases();
    this.albedo = new DataTexture(atlas.albedo, atlas.size, atlas.size); this.albedo.colorSpace = SRGBColorSpace;
    this.normals = new DataTexture(atlas.normal, atlas.size, atlas.size);
    for (const t of [this.albedo, this.normals, this.coastTexture]) { t.minFilter = t.magFilter = LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; }
    this.field.minFilter = this.field.magFilter = NearestFilter; this.field.needsUpdate = true;
    this.fieldNode = texture(this.field); this.coastNode = texture(this.coastTexture);
    this.pigmentNode = texture(this.albedo); this.normalNode = texture(this.normals);
    const p = attribute('terrainCoordinate', 'vec2');
    const warped = p.add(vec2(sin(p.y.mul(3.7)).mul(.07), sin(p.x.mul(4.3)).mul(.06)));
    const grid = warped.sub(.5), cell = grid.floor(), f = smoothstep(.25, .75, grid.fract());
    const sample = (dx: number, dy: number) => {
      const index = this.fieldNode.sample(cell.add(vec2(dx + .5, dy + .5)).sub(this.origin).div(this.dimensions)).r.mul(255).round();
      return this.paint(index, p);
    };
    const a = sample(0, 0), b = sample(1, 0), c = sample(0, 1), d = sample(1, 1);
    const pigment = mix(mix(a.albedo, b.albedo, f.x), mix(c.albedo, d.albedo, f.x), f.y);
    const normal = mix(mix(a.normal, b.normal, f.x), mix(c.normal, d.normal, f.x), f.y).normalize();
    const coast = this.coastAt(p), wet = float(1).sub(smoothstep(0, .8, coast.negate()));
    const wash = sin(p.x.mul(.63).add(sin(p.y.mul(.83)))).mul(.025);
    const depth = this.depthAtNode(p);
    const beach = this.paint(float(TERRAIN_KINDS.indexOf('Beach')), p);
    const coastalSand = mix(beach.albedo.rgb, pigment.rgb, smoothstep(.25, 1.1, depth));
    const transmitted = coastalSand.mul(depth.mul(vec3(-.28, -.13, -.075)).exp());
    this.material.receivedShadowNode = (shadow = float(1).add(0)) => mix(shadow, 1, float(1).sub(depth.mul(-.34).exp()).mul(.8));
    this.material.colorNode = mix(pigment.rgb, transmitted, smoothstep(-.4, .25, coast)).mul(float(1).add(wash).sub(wet.mul(.06)));
    // From the diving view, land reads as a darker surface above the diver;
    // use the same continuous coast field so it cannot form tile seams.
    const landAbove = float(1).sub(smoothstep(-.55,.15,coast));
    this.material.colorNode = mix(this.material.colorNode,color(0x173c43),landAbove.mul(this.diving).mul(.72));
    const footprint = max(dFdx(p).length(), dFdy(p).length()), relief = float(1).sub(smoothstep(.045, .15, footprint));
    const filtered = normalWorldGeometry.add(vec3(normal.x, 0, normal.z).mul(relief)).normalize();
    this.material.normalNode = cameraViewMatrix.mul(vec4(filtered, 0)).xyz.normalize();
    this.material.roughnessNode = max(.66, pigment.a.sub(wet.mul(.14)));
    const fieldColor = vec3(f.x, f.y, wet);
    this.material.colorNode = mix(this.material.colorNode, fieldColor, this.diagnostic);
  }
  private paint(index: Node<'float'>, p: Node<'vec2'>) {
    p = p.add(vec2(sin(p.x.mul(.43).add(sin(p.y.mul(.71)))).mul(.23), sin(p.y.mul(.53).add(sin(p.x.mul(.61)))).mul(.21)));
    const uv = vec2(index.mod(4), index.div(4).floor()).mul(STRIDE).add(PAD + .5)
      .add(p.div(4.5).fract().mul(INNER - 1)).div(ATLAS);
    return { albedo: this.pigmentNode.sample(uv), normal: this.normalNode.sample(uv).rgb.mul(2).sub(1) };
  }
  coastAt(p: Node<'vec2'>) { return this.coastNode.sample(p.sub(this.origin).div(this.dimensions)).g.mul(16).sub(8); }
  depthAtNode(p: Node<'vec2'>) { return this.coastNode.sample(p.sub(this.origin).div(this.dimensions)).a.mul(4); }
  depthAt(x: number, y: number): number {
    return this.currentField ? sampleTerrainDepth(this.currentField, x, y) : 0;
  }
  get ready(): boolean { return this.currentField !== null; }
  rebuild(tiles: Iterable<TerrainTile>): TerrainField {
    const field = createTerrainField(tiles);
    return this.applyField(field);
  }
  applyField(field: TerrainField): TerrainField {
    this.currentField = field;
    this.origin.value.set(field.minX, field.minY); this.dimensions.value.set(field.width, field.height);
    for (const texture of [this.field, this.coastTexture]) {
      texture.dispose(); texture.image = { data: field.data, width: field.width, height: field.height }; texture.needsUpdate = true;
    }
    return field;
  }
  setDebug(mode: string): void { this.material.wireframe = mode === 'wireframe'; this.diagnostic.value = mode === 'fields' ? 1 : 0; }
  setDiving(diving: boolean): void { this.diving.value = Number(diving); }
  dispose(): void { this.material.dispose(); [this.albedo, this.normals, this.field, this.coastTexture].forEach(t => t.dispose()); }
}
