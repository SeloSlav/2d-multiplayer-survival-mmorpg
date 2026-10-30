import { Group, InstancedMesh, Matrix4, MeshBasicMaterial, MeshBasicNodeMaterial, MeshStandardMaterial, Object3D, OctahedronGeometry, PlaneGeometry, Vector3 } from 'three/webgpu';
import { float, smoothstep, uniform, uv } from 'three/tsl';
import { GROUND_Y_SCALE, seedFromId, seededRandom } from './visualContract';
import { RUNE_LIGHT_RADIUS, RUNE_PALETTES, RUNE_POOL_DIAMETER, runeNightStrength, runeType } from './runeStoneProfile';
import type { RuneType } from './runeStoneProfile';

const CAPACITY = 32, MOTES = 18;
export interface RuneLocalLight { position: Vector3; color: number; intensity: number; distance: number; flicker: number }
interface RuneLayer { glyph: MeshStandardMaterial; haloMaterial: MeshBasicNodeMaterial; moteMaterial: MeshBasicMaterial; halos: InstancedMesh; motes: InstancedMesh; count: number }

/** Emissive inscriptions plus pooled ground radiance and slow rising motes.
 * Illumination joins the world's fixed local-light budget, lighting all surfaces. */
export class RuneStoneEffects3d {
  readonly root = new Group();
  private readonly plane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly mote = new OctahedronGeometry(.5, 0);
  private readonly strength = uniform(0);
  private readonly layers = new Map<RuneType, RuneLayer>();
  private readonly matrix = new Matrix4();
  private readonly transform = new Object3D();
  private time = 0;
  private night = 0;

  constructor() {
    this.root.name = 'runestone-night-effects'; this.root.visible = false;
    for (const type of ['Green', 'Red', 'Blue'] as const) {
      const palette = RUNE_PALETTES[type];
      const glyph = new MeshStandardMaterial({ color: palette.glow, emissive: palette.glow, emissiveIntensity: 0, roughness: .65 });
      const haloMaterial = new MeshBasicNodeMaterial({ color: palette.glow, transparent: true, depthWrite: false, toneMapped: false });
      haloMaterial.opacityNode = float(1).sub(smoothstep(.02, 1, uv().sub(.5).length().mul(2))).pow(2).mul(this.strength).mul(.24);
      const moteMaterial = new MeshBasicMaterial({ color: palette.accent, transparent: true, depthWrite: false, toneMapped: false });
      const halos = new InstancedMesh(this.plane, haloMaterial, CAPACITY), motes = new InstancedMesh(this.mote, moteMaterial, CAPACITY * MOTES);
      halos.name = `rune-${type}-ground-glow`; motes.name = `rune-${type}-motes`;
      for (const mesh of [halos, motes]) { mesh.count = 0; mesh.frustumCulled = false; this.root.add(mesh); }
      this.layers.set(type, { glyph, haloMaterial, moteMaterial, halos, motes, count: 0 });
    }
  }
  materialFor(type: string): MeshStandardMaterial { return this.layers.get(runeType(type))!.glyph; }
  beginFrame(time: number, cycle: number): void {
    this.time = time; this.night = runeNightStrength(cycle); this.strength.value = this.night;
    const breath = 1 + Math.sin(time * .4) * .06 + Math.sin(time * .7) * .04 + Math.sin(time * 1.2) * .02;
    for (const layer of this.layers.values()) {
      layer.count = 0; layer.glyph.emissiveIntensity = this.night * 3 * breath; layer.moteMaterial.opacity = this.night * .85;
    }
  }
  add(id: string, type: string, base: Vector3): RuneLocalLight | undefined {
    if (this.night <= 0) return;
    const key = runeType(type), layer = this.layers.get(key)!;
    if (layer.count >= CAPACITY) return;
    const index = layer.count++, random = seededRandom(seedFromId(`rune:${id}`));
    this.matrix.makeScale(RUNE_POOL_DIAMETER, 1, RUNE_POOL_DIAMETER * GROUND_Y_SCALE).setPosition(base.x, base.y + .035, base.z);
    layer.halos.setMatrixAt(index, this.matrix);
    for (let i = 0; i < MOTES; i++) {
      const phase = (this.time / 5 + random()) % 1, angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * 1.6;
      const size = (.08 + random() * .13) * Math.sin(Math.PI * phase);
      this.transform.position.set(base.x + Math.cos(angle) * radius + Math.sin(this.time * .25 + i) * .12,
        base.y + .25 + phase * 3.7, base.z + Math.sin(angle) * radius * GROUND_Y_SCALE);
      this.transform.rotation.set(0, angle + this.time * .2, Math.PI / 4); this.transform.scale.setScalar(size); this.transform.updateMatrix();
      layer.motes.setMatrixAt(index * MOTES + i, this.transform.matrix);
    }
    const pulse = 1 + Math.sin(this.time * .4 + seedFromId(id) % 13) * .06;
    return { position: new Vector3(base.x, base.y + 2.8, base.z), color: RUNE_PALETTES[key].glow,
      intensity: 14 * this.night * pulse, distance: RUNE_LIGHT_RADIUS, flicker: 0 };
  }
  endFrame(): void {
    let count = 0;
    for (const layer of this.layers.values()) {
      layer.halos.count = layer.count; layer.motes.count = layer.count * MOTES; count += layer.count;
      if (layer.count) { layer.halos.instanceMatrix.needsUpdate = true; layer.motes.instanceMatrix.needsUpdate = true; }
    }
    this.root.visible = count > 0;
  }
  dispose(): void {
    this.root.removeFromParent();
    for (const layer of this.layers.values()) { layer.halos.dispose(); layer.motes.dispose(); layer.glyph.dispose(); layer.haloMaterial.dispose(); layer.moteMaterial.dispose(); }
    this.plane.dispose(); this.mote.dispose(); this.layers.clear();
  }
}
