import { DoubleSide, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, Object3D, PlaneGeometry } from 'three/webgpu';
import { attribute, color, float, max, sin, smoothstep, uniform, uv, vec2 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { GROUND_Y_SCALE, seedFromId, seededRandom, WORLD_3D, worldToScene } from './visualContract';

// Perceptual controls: warm translucent mist, small surface pearls, quiet rings.
const STYLE = { steamPerTile: 2, steamOpacity: .24, rise: 1.65, lifetime: 7.5, bubblePeriod: 2.6, bubbleOpacity: .65 };
const CAPACITY = 1536;
interface Source { x: number; z: number; phase: number; speed: number; size: number }
interface Layer { mesh: InstancedMesh; geometry: PlaneGeometry; material: MeshBasicNodeMaterial; opacity: InstancedBufferAttribute }

/** Tile-confined geothermal emissions. Fixed pools and analytic ages make
 * streaming, re-entry, pauses and different frame rates produce the same result. */
export class HotSpringEffects3d {
  readonly root = new Group();
  private readonly steam: Layer;
  private readonly bubbles: Layer;
  private readonly ripples: Layer;
  private readonly clock = uniform(0);
  private readonly light = uniform(1);
  private readonly diagnostic = uniform(0);
  private readonly transform = new Object3D();
  private readonly sources: Source[] = [];

  constructor() {
    this.root.name = 'hot-spring-steam-and-bubbles';
    this.steam = this.layer('hot-spring-steam', false, 4);
    this.bubbles = this.layer('hot-spring-bubbles', false, 2);
    this.ripples = this.layer('hot-spring-ripples', true, 2);
    const p = uv().sub(.5).mul(2), radius = p.length();
    // Two shared curls break the puff contour; every edge fades smoothly to zero.
    const curl = sin(p.y.mul(5).sub(this.clock.mul(.75))).mul(.11)
      .add(sin(p.x.mul(4).add(p.y.mul(3)).add(this.clock.mul(.45))).mul(.07));
    const mistRadius = vec2(p.x.add(curl), p.y).length();
    this.steam.material.colorNode = color(0xe0ece3).mul(this.light);
    this.steam.material.opacityNode = float(1).sub(smoothstep(.02, 1, mistRadius)).pow(1.7).mul(attribute('effectOpacity', 'float'));
    const ring = float(1).sub(smoothstep(.035, .16, radius.sub(.72).abs()));
    const shine = float(1).sub(smoothstep(.03, .3, p.sub(vec2(-.28, .32)).length()));
    this.bubbles.material.colorNode = color(0xc6e5d8);
    this.bubbles.material.opacityNode = max(ring.mul(.7), shine).mul(attribute('effectOpacity', 'float'));
    this.ripples.material.colorNode = color(0xc5e5d7);
    this.ripples.material.opacityNode = float(1).sub(smoothstep(.025, .1, radius.sub(.8).abs())).mul(attribute('effectOpacity', 'float'));
    for (const layer of [this.steam, this.bubbles, this.ripples]) {
      // Fields view exposes emitter footprints / overdraw independently of lighting.
      layer.material.opacityNode = max(layer.material.opacityNode as Node<'float'>, float(1).sub(smoothstep(.94, 1, radius)).mul(this.diagnostic).mul(.12));
    }
    this.root.visible = false;
  }

  private layer(name: string, horizontal: boolean, order: number): Layer {
    const geometry = new PlaneGeometry(1, 1);
    if (horizontal) geometry.rotateX(-Math.PI / 2);
    const opacity = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1).setUsage(DynamicDrawUsage);
    geometry.setAttribute('effectOpacity', opacity);
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true, side: DoubleSide });
    const mesh = new InstancedMesh(geometry, material, CAPACITY);
    mesh.name = name; mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = order;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage); this.root.add(mesh);
    return { mesh, geometry, material, opacity };
  }

  rebuild(tiles: Iterable<{ worldX?: number; worldY?: number; tileType?: unknown }>): void {
    this.sources.length = 0;
    const hot = [...tiles].filter(tile => (typeof tile.tileType === 'string' ? tile.tileType : (tile.tileType as { tag?: string })?.tag) === 'HotSpringWater');
    // Hash order distributes a capped pool across the whole spring at large views.
    hot.sort((a, b) => seedFromId(`${a.worldX},${a.worldY}`) - seedFromId(`${b.worldX},${b.worldY}`));
    for (const tile of hot) {
      const random = seededRandom(seedFromId(`${tile.worldX},${tile.worldY}`));
      for (let i = 0; i < STYLE.steamPerTile && this.sources.length < CAPACITY; i++) {
        const p = worldToScene(((tile.worldX ?? 0) + .2 + random() * .6) * 48, ((tile.worldY ?? 0) + .2 + random() * .6) * 48);
        this.sources.push({ x: p.x, z: p.z, phase: random(), speed: .8 + random() * .4, size: .8 + random() * .4 });
      }
    }
    for (const layer of [this.steam, this.bubbles, this.ripples]) layer.mesh.count = this.sources.length;
    this.root.visible = this.sources.length > 0;
  }

  update(time: number, daylight: number, diving: boolean): void {
    this.clock.value = time; this.root.visible = this.sources.length > 0 && !diving;
    if (!this.root.visible) return;
    this.light.value = .38 + daylight * .62;
    for (let i = 0; i < this.sources.length; i++) {
      const source = this.sources[i], phase = source.phase * Math.PI * 2;
      const age = (time * source.speed / STYLE.lifetime + source.phase) % 1;
      const envelope = Math.sin(Math.PI * age) ** 1.2;
      const drift = Math.sin(time * .48 + phase + age * 2) * .16 * age;
      this.transform.position.set(source.x + drift, .15 + age * STYLE.rise, source.z + age * .18);
      this.transform.rotation.set(-WORLD_3D.elevationRadians, 0, Math.sin(phase + age * 2) * .18);
      this.transform.scale.set(source.size * (.65 + age * 1.25), source.size * (.8 + age * 1.6), 1);
      this.transform.updateMatrix(); this.steam.mesh.setMatrixAt(i, this.transform.matrix);
      this.steam.opacity.setX(i, STYLE.steamOpacity * envelope);

      const cycle = (time * source.speed / STYLE.bubblePeriod + source.phase) % 1;
      const growth = Math.min(1, cycle / .65), size = (.06 + growth * .16) * source.size;
      this.transform.position.set(source.x, .045 + growth * .035, source.z);
      this.transform.rotation.set(-WORLD_3D.elevationRadians, 0, 0);
      this.transform.scale.set(size, size, 1); this.transform.updateMatrix();
      this.bubbles.mesh.setMatrixAt(i, this.transform.matrix);
      this.bubbles.opacity.setX(i, cycle < .65 ? STYLE.bubbleOpacity * Math.sin(Math.PI * growth) ** .5 : 0);
      const pop = Math.max(0, (cycle - .65) / .35), rippleSize = .13 + pop * .55;
      this.transform.position.y = .027; this.transform.rotation.set(0, 0, 0);
      this.transform.scale.set(rippleSize, 1, rippleSize * GROUND_Y_SCALE); this.transform.updateMatrix();
      this.ripples.mesh.setMatrixAt(i, this.transform.matrix);
      this.ripples.opacity.setX(i, cycle >= .65 ? (1 - pop) ** 1.5 * .32 : 0);
    }
    for (const layer of [this.steam, this.bubbles, this.ripples]) { layer.mesh.instanceMatrix.needsUpdate = true; layer.opacity.needsUpdate = true; }
  }

  setDebug(mode: string): void {
    this.diagnostic.value = Number(mode === 'fields');
    for (const layer of [this.steam, this.bubbles, this.ripples]) layer.material.wireframe = mode === 'wireframe';
  }

  dispose(): void {
    for (const layer of [this.steam, this.bubbles, this.ripples]) { layer.mesh.dispose(); layer.material.dispose(); layer.geometry.dispose(); }
    this.sources.length = 0; this.root.clear(); this.root.removeFromParent();
  }
}
