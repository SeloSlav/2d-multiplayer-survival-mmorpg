import { Color, Group, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, Object3D, TorusGeometry } from 'three/webgpu';
import { attribute } from 'three/tsl';
import { ModelKit } from './modelKit';
import { seedFromId, worldToScene, WORLD_3D } from './visualContract';
import { worldExplosionsAfter } from './presentationEffectEvents';
import type { WorldExplosion } from './presentationEffectEvents';

const CAPACITY = 1024;
export class ExplosionEffects3d {
  readonly root = new Group();
  readonly particles: InstancedMesh;
  readonly rings: InstancedMesh;
  private readonly alpha = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  private readonly ringAlpha = new InstancedBufferAttribute(new Float32Array(32), 1);
  private readonly material = new MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false });
  private readonly events: WorldExplosion[] = [];
  private readonly transform = new Object3D();
  private readonly color = new Color();
  private cursor = 0;

  constructor(kit: ModelKit) {
    this.root.name = 'world-explosions'; this.material.opacityNode = attribute('blastAlpha', 'float');
    const geometry = kit.geometry('rock').clone(); geometry.setAttribute('blastAlpha', this.alpha);
    const ring = new TorusGeometry(.5, .025, 6, 32); ring.setAttribute('blastAlpha', this.ringAlpha);
    this.particles = new InstancedMesh(geometry, this.material, CAPACITY);
    this.rings = new InstancedMesh(ring, this.material, 32);
    for (const mesh of [this.particles, this.rings]) { mesh.count = 0; mesh.frustumCulled = false; mesh.setColorAt(0, this.color); this.root.add(mesh); }
    this.root.visible = false;
  }

  update(nowMs: number, submerged = false): void {
    for (const event of worldExplosionsAfter(this.cursor, nowMs)) { this.events.push(event); this.cursor = Math.max(this.cursor, event.sequence); }
    if (this.events.length > 32) this.events.splice(0, this.events.length - 32);
    for (let i = this.events.length - 1; i >= 0; i--) if (nowMs < this.events[i].at || nowMs - this.events[i].at >= 2600) this.events.splice(i, 1);
    let particles = 0, rings = 0;
    for (const event of this.events) {
      const age = Math.max(0, (nowMs - event.at) / 1000), point = worldToScene(event.x, event.y);
      const radius = Math.max(2, event.radius / WORLD_3D.tilePixels) * (event.heavy ? 1.3 : 1.1), seed = seedFromId(event.id);
      if (age < .65 && rings < 32) {
        this.transform.position.set(point.x, .04, point.z); this.transform.rotation.set(-Math.PI / 2, 0, 0);
        this.transform.scale.set(radius * 2 * Math.min(1, age / .5), radius * 2 * Math.min(1, age / .5), .3); this.transform.updateMatrix();
        this.rings.setMatrixAt(rings, this.transform.matrix); this.rings.setColorAt(rings, this.color.setHex(0xf1bc80)); this.ringAlpha.setX(rings++, .6 * (1 - age / .65));
      }
      for (let i = 0; i < 44 && particles < CAPACITY; i++) {
        const core = i < 8, smoke = i >= 24, duration = core ? .24 : smoke ? 2.6 : 1.3;
        if (age >= duration) continue;
        const a = (seed % 997 + i * 137.5) * .02399, spread = .3 + i % 7 / 7;
        const radial = (core ? .25 : smoke ? .18 : .6) * radius * age * spread;
        this.transform.position.set(point.x + Math.sin(a) * radial, Math.max(.04, .15 + age * (core ? 1.1 : smoke ? .8 : 1.8) - (smoke ? 0 : .9) * age * age), point.z + Math.cos(a) * radial);
        this.transform.rotation.set(a + age * (smoke ? .3 : 4), a, age * 2);
        const size = core ? (.25 + age * 2) * radius * .45 : smoke ? (.18 + age * .35) * radius * .35 : .1 + i % 3 * .035;
        this.transform.scale.setScalar(size); this.transform.updateMatrix(); this.particles.setMatrixAt(particles, this.transform.matrix);
        this.particles.setColorAt(particles, this.color.setHex(core ? i % 2 ? 0xffbb66 : 0xffe6af : smoke ? i % 2 ? 0x635f56 : 0x898477 : event.heavy ? 0x7d8884 : 0x8b6b49));
        this.alpha.setX(particles++, (core ? 1 : smoke ? .5 : .85) * (1 - age / duration));
      }
    }
    this.particles.count = particles; this.rings.count = rings; this.root.visible = !submerged && particles + rings > 0;
    for (const mesh of [this.particles, this.rings]) if (mesh.count) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true; }
    this.alpha.needsUpdate = true; this.ringAlpha.needsUpdate = true;
  }

  dispose(): void {
    this.root.removeFromParent(); this.events.length = 0;
    for (const mesh of [this.particles, this.rings]) { mesh.geometry.dispose(); mesh.dispose(); }
    this.material.dispose();
  }
}
