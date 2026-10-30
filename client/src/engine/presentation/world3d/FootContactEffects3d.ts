import { Color, Group, InstancedBufferAttribute, InstancedMesh, MeshStandardNodeMaterial, Object3D, Vector3 } from 'three/webgpu';
import { attribute } from 'three/tsl';
import { ModelKit } from './modelKit';
import { GROUND_Y_SCALE, seedFromId, worldToScene } from './visualContract';
import type { SurvivorRig } from './survivor';

interface ContactState { x: number; y: number; phase: number; air: boolean; water: boolean; seen: number }
interface ContactEvent { kind: 'dust' | 'snow' | 'splash'; x: number; y: number; z: number; yaw: number; at: number; seed: number }
interface ContactPose { x: number; y: number; ground: number; speed: number; swimming: boolean; down: boolean; jumpAge: number; terrain: string; snow: boolean }
const CAPACITY = 1024;

/** Foot events are emitted at gait contacts, then remain in world space. All
 * particle motion and fading is analytic, with fixed instance/memory budgets. */
export class FootContactEffects3d {
  readonly root = new Group();
  readonly particles: InstancedMesh;
  readonly prints: InstancedMesh;
  private readonly material = new MeshStandardNodeMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, roughness: 1 });
  private readonly events: ContactEvent[] = [];
  private readonly states = new Map<string, ContactState>();
  private readonly particleAlpha = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  private readonly printAlpha = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
  private readonly transform = new Object3D();
  private readonly pigment = new Color();
  private readonly point = new Vector3();
  private lastTime = -Infinity;

  private synchronizeClock(now: number): void {
    if (now < this.lastTime) { this.events.length = 0; this.states.clear(); }
    this.lastTime = now;
  }

  constructor(kit: ModelKit) {
    this.root.name = 'foot-contact-effects';
    this.material.opacityNode = attribute('contactOpacity', 'float');
    const rock = kit.geometry('rock').clone(), sole = kit.geometry('box').clone();
    rock.setAttribute('contactOpacity', this.particleAlpha); sole.setAttribute('contactOpacity', this.printAlpha);
    this.particles = new InstancedMesh(rock, this.material, CAPACITY);
    this.prints = new InstancedMesh(sole, this.material, CAPACITY);
    for (const mesh of [this.particles, this.prints]) {
      mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false;
      mesh.setColorAt(0, this.pigment.setHex(0xffffff)); this.root.add(mesh);
    }
    this.root.visible = false;
  }

  observe(id: string, pose: ContactPose, rig: SurvivorRig, now: number): void {
    this.synchronizeClock(now);
    const phase = Math.floor(rig.contactPhase / Math.PI), air = pose.jumpAge >= 0 && pose.jumpAge < .5 && !pose.swimming;
    const previous = this.states.get(id);
    this.states.set(id, { x: pose.x, y: pose.y, phase, air, water: pose.swimming, seen: now });
    if (!previous || now - previous.seen > .4 || Math.hypot(previous.x - pose.x, previous.y - pose.y) > 192 || pose.down) return;
    if (pose.swimming && !previous.water) {
      const point = worldToScene(pose.x, pose.y);
      this.emit('splash', point.x, 0, point.z, rig.root.rotation.y, id, now);
    }
    if (pose.swimming || air) return;
    const landing = previous.air && !air;
    if (!landing && (phase === previous.phase || pose.speed < .15)) return;
    rig.footWorldPosition(phase % 2 === 0, this.point);
    if (pose.snow) this.emit('snow', this.point.x, pose.ground, this.point.z, rig.root.rotation.y, id, now);
    if (['Dirt', 'DirtRoad', 'Sand', 'Beach', 'Quarry'].includes(pose.terrain) || landing && !pose.snow && pose.terrain !== 'Building')
      this.emit('dust', this.point.x, pose.ground, this.point.z, rig.root.rotation.y, id, now);
  }

  private emit(kind: ContactEvent['kind'], x: number, y: number, z: number, yaw: number, id: string, at: number): void {
    this.events.push({ kind, x, y, z, yaw, at, seed: seedFromId(`${id}:${Math.floor(at * 1000)}`) });
    if (this.events.length > 256) this.events.shift();
  }

  update(now: number, underwater = false): void {
    this.synchronizeClock(now);
    for (let i = this.events.length - 1; i >= 0; i--) if (now - this.events[i].at >= (this.events[i].kind === 'snow' ? 18 : 1)) this.events.splice(i, 1);
    for (const [id, state] of this.states) if (now - state.seen > 5) this.states.delete(id);
    let particles = 0, prints = 0;
    for (const event of this.events) {
      const age = Math.max(0, now - event.at);
      if (event.kind === 'snow') {
        if (prints >= CAPACITY) continue;
        this.transform.position.set(0, 0, 0);
        this.transform.rotation.set(0, event.yaw, 0); this.transform.scale.set(.19, .012, .39); this.transform.updateMatrix();
        // Match the survivor's S * R ground compensation, preserving yaw.
        for (const index of [2, 6, 10]) this.transform.matrix.elements[index] *= GROUND_Y_SCALE;
        this.transform.matrix.setPosition(event.x, event.y + .012, event.z);
        this.prints.setMatrixAt(prints, this.transform.matrix); this.prints.setColorAt(prints, this.pigment.setHex(0x657580));
        this.printAlpha.setX(prints++, .5 * (1 - age / 18) ** .65);
        continue;
      }
      const splash = event.kind === 'splash';
      for (let i = 0; i < (splash ? 20 : 7) && particles < CAPACITY; i++) {
        const phase = (event.seed % 1009 + i * 137.51) * .01, angle = phase * 2.399, speed = (splash ? .8 : .25) + (i % 5) * .12;
        const rise = splash ? .7 + i % 4 * .24 : .2 + i % 3 * .08;
        this.transform.position.set(event.x + Math.sin(angle) * speed * age, event.y + Math.max(.03, .04 + rise * age - (splash ? 1.9 : .35) * age * age), event.z + Math.cos(angle) * speed * age);
        this.transform.rotation.set(phase + age, angle, phase - age);
        const size = (splash ? .045 : .09) * Math.min(1, (1 - age) * 3);
        this.transform.scale.set(size, splash ? size * 1.6 : size * .7, size); this.transform.updateMatrix();
        this.particles.setMatrixAt(particles, this.transform.matrix); this.particles.setColorAt(particles, this.pigment.setHex(splash ? 0xc0ded9 : 0xb7a080));
        this.particleAlpha.setX(particles++, (splash ? .85 : .34) * (1 - age));
      }
    }
    this.particles.count = particles; this.prints.count = prints; this.root.visible = !underwater && particles + prints > 0;
    for (const mesh of [this.particles, this.prints]) if (mesh.count) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true; }
    this.particleAlpha.needsUpdate = true; this.printAlpha.needsUpdate = true;
  }

  dispose(): void {
    this.root.removeFromParent(); this.events.length = 0; this.states.clear();
    for (const mesh of [this.particles, this.prints]) { mesh.geometry.dispose(); mesh.dispose(); }
    this.material.dispose();
  }
}
