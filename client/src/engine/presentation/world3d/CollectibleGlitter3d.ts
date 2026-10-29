import {
  AdditiveBlending, Color, DynamicDrawUsage, Group, InstancedBufferAttribute,
  InstancedMesh, MeshBasicNodeMaterial, Object3D, PlaneGeometry, Quaternion,
} from 'three/webgpu';
import { attribute, float, smoothstep, uv } from 'three/tsl';
import { LIGHT_FADE_FULL_AT, NIGHT_LIGHTS_OFF, NIGHT_LIGHTS_ON } from '../../../config/dayNightConstants';
import { seedFromId } from './visualContract';

const SPARKLES_PER_PICKUP = 9;
const CAPACITY = 16384;
const DAY_COLORS = [0xffd700, 0xffeb3b, 0xfff59d, 0xfff5d6, 0xffe49c].map(hex => new Color(hex));
const NIGHT_COLORS = [0x759bff, 0x9b79ff, 0xc195ff, 0x71c9ff, 0xbab0ff].map(hex => new Color(hex));

function smooth(a: number, b: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Same shared dusk/dawn boundaries as the world lights, with no palette pop. */
export function collectibleNightMix(progress: number): number {
  const cycle = ((progress % 1) + 1) % 1;
  return cycle >= NIGHT_LIGHTS_ON
    ? smooth(NIGHT_LIGHTS_ON, LIGHT_FADE_FULL_AT, cycle)
    : 1 - smooth(0, NIGHT_LIGHTS_OFF, cycle);
}

function random(seed: number, salt: number): number {
  let n = Math.imul(seed ^ salt, 0x85ebca6b);
  n = Math.imul(n ^ n >>> 13, 0xc2b2ae35);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}

/** The old rising 0.8–1.2 s resource twinkle, in a single world-space draw.
 * Analytic, ID-seeded lanes avoid frame-dependent spawning, particle backlogs,
 * and retained emitters after a pickup despawns or leaves view. */
export class CollectibleGlitter3d {
  readonly root = new Group();
  readonly sparkles: InstancedMesh;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicNodeMaterial({
    transparent: true, blending: AdditiveBlending, depthWrite: false,
    depthTest: true, toneMapped: false,
  });
  private readonly opacity = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1).setUsage(DynamicDrawUsage);
  private readonly transform = new Object3D();
  private readonly facing = new Quaternion();
  private readonly tint = new Color();
  private count = 0;
  private time = 0;
  private night = 0;

  constructor() {
    this.root.name = 'collectible-glitter';
    this.geometry.setAttribute('glitterOpacity', this.opacity);
    const point = uv().sub(.5).mul(2).abs();
    const core = float(1).sub(smoothstep(.02, .4, point.length())).pow(2);
    const vertical = float(1).sub(smoothstep(.015, .12, point.x))
      .mul(float(1).sub(smoothstep(.08, .98, point.y)));
    const horizontal = float(1).sub(smoothstep(.015, .12, point.y))
      .mul(float(1).sub(smoothstep(.08, .98, point.x)));
    this.material.opacityNode = core.max(vertical.add(horizontal).mul(.65)).clamp(0, 1)
      .mul(attribute('glitterOpacity', 'float'));
    this.sparkles = new InstancedMesh(this.geometry, this.material, CAPACITY);
    this.sparkles.instanceMatrix.setUsage(DynamicDrawUsage);
    // Allocate colors before the first shader warmup, even with no pickups.
    this.sparkles.setColorAt(0, this.tint);
    this.sparkles.instanceColor!.setUsage(DynamicDrawUsage);
    this.sparkles.frustumCulled = false;
    this.sparkles.castShadow = false;
    this.sparkles.receiveShadow = false;
    this.sparkles.count = 0;
    this.sparkles.renderOrder = 3;
    this.root.add(this.sparkles);
    this.root.visible = false;
  }

  beginFrame(time: number, cycle: number, cameraFacing: Quaternion): void {
    this.count = 0;
    this.time = Math.max(0, time);
    this.night = collectibleNightMix(cycle);
    this.facing.copy(cameraFacing);
  }

  add(id: string, x: number, y: number, z: number, height = .3, spread = .4): void {
    const seed = seedFromId(id);
    for (let i = 0; i < SPARKLES_PER_PICKUP && this.count < CAPACITY; i++) {
      const lane = seed ^ Math.imul(i + 1, 0x9e3779b1);
      const lifetime = .8 + random(lane, 1) * .4;
      const clock = this.time / lifetime + random(lane, 2);
      const phase = clock - Math.floor(clock), age = phase * lifetime;
      const birth = lane ^ Math.imul(Math.floor(clock), 0x27d4eb2d);
      const rise = (.4 + random(birth, 3) * .35) * age * (1 - phase * .15);
      this.transform.position.set(
        x + (random(birth, 4) - .5) * spread * 2 + (random(birth, 5) - .5) * age * .25,
        y + .1 + height * (.4 + random(birth, 6) * .5) + rise,
        z + (random(birth, 7) - .5) * spread * 1.3,
      );
      this.transform.quaternion.copy(this.facing);
      const twinkle = .55 + .45 * Math.sin(age * 10 + random(lane, 8) * Math.PI) ** 2;
      const size = (.14 + random(birth, 9) * .13) * (.65 + twinkle * .35);
      this.transform.scale.setScalar(size);
      this.transform.updateMatrix();
      this.sparkles.setMatrixAt(this.count, this.transform.matrix);
      const paletteIndex = Math.floor(random(birth, 10) * DAY_COLORS.length);
      this.tint.copy(DAY_COLORS[paletteIndex]).lerp(NIGHT_COLORS[paletteIndex], this.night);
      this.sparkles.setColorAt(this.count, this.tint);
      this.opacity.setX(this.count++, smooth(0, .08, phase) * (1 - phase) * twinkle);
    }
  }

  endFrame(): void {
    this.sparkles.count = this.count;
    this.root.visible = this.count > 0;
    if (!this.count) return;
    this.sparkles.instanceMatrix.needsUpdate = true;
    this.sparkles.instanceColor!.needsUpdate = true;
    this.opacity.needsUpdate = true;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.sparkles.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
