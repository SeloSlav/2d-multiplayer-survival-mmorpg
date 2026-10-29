import { BufferGeometry, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three/webgpu';
import { GROUND_Y_SCALE, WORLD_3D, worldToScene } from './visualContract';

interface WakeSlot { root: Group; mesh: Mesh; active: boolean; born: number; lifetime: number; idle: boolean; hot: boolean; owner: string }
interface Swimmer { x: number; y: number; distance: number; lastIdle: number; seen: boolean }

function wakeBand(): BufferGeometry {
  const positions = new Float32Array(48 * 6 * 3), normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  return geometry;
}

/** World-anchored mesh wakes, reusing the former 36→95 px / 1.4 s rhythm.
 * No sprites or screen canvas; emissions depend on distance rather than FPS. */
export class SwimmingEffects3d {
  readonly root = new Group();
  private readonly materials: MeshBasicMaterial[] = [];
  private readonly slots: WakeSlot[] = [];
  private readonly swimmers = new Map<string, Swimmer>();
  private cursor = 0;

  constructor(capacity = 128) {
    this.root.name = 'swimming-wakes';
    for (const hot of [false, true]) for (let opacity = 0; opacity < 12; opacity++) this.materials.push(new MeshBasicMaterial({
      color: hot ? 0x207680 : 0xa0c8dc, transparent: true, opacity: (opacity + 1) / 12 * 0.3, depthWrite: false, side: DoubleSide,
    }));
    for (let i = 0; i < capacity; i++) {
      const root = new Group(), mesh = new Mesh(wakeBand(), this.materials[0]);
      root.scale.z = GROUND_Y_SCALE * .6; root.visible = false; mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      root.add(mesh); this.root.add(root);
      this.slots.push({ root, mesh, active: false, born: 0, lifetime: 1.4, idle: false, hot: false, owner: '' });
    }
  }

  beginFrame(): void { for (const swimmer of this.swimmers.values()) swimmer.seen = false; }

  observe(id: string, x: number, y: number, yaw: number, speed: number, swimming: boolean, sprinting: boolean, hot: boolean, time: number, submerged = false): void {
    if(submerged){this.swimmers.delete(id);for(const slot of this.slots)if(slot.owner===id){slot.active=false;slot.root.visible=false;}return;}
    if (!swimming) { this.swimmers.delete(id); return; }
    let state = this.swimmers.get(id);
    if (!state) {
      state = { x, y, distance: 0, lastIdle: time, seen: true };
      this.swimmers.set(id, state); this.emit(id, x, y, yaw, true, hot, time);
    }
    state.seen = true;
    const distance = Math.hypot(x - state.x, y - state.y);
    if (distance < 120) state.distance += distance;
    state.x = x; state.y = y;
    const moving = speed > 0.25;
    // The old frame-count emitter produced roughly 2–4 arcs per second at
    // gameplay speeds. Distance spacing preserves that rhythm at any FPS.
    const spacing = sprinting ? 66 : 60;
    if (moving && state.distance >= spacing) {
      this.emit(id, x, y, yaw, false, hot, time);
      state.distance %= spacing; state.lastIdle = time;
    } else if (!moving && time - state.lastIdle >= 0.6) {
      this.emit(id, x, y, yaw, true, hot, time); state.lastIdle = time;
    }
  }

  private emit(id: string, x: number, y: number, yaw: number, idle: boolean, hot: boolean, time: number): void {
    const slot = this.slots[this.cursor++ % this.slots.length];
    const p = worldToScene(x, y);
    slot.root.position.set(p.x, -0.016, p.z);
    slot.mesh.rotation.y = yaw;
    slot.active = true; slot.root.visible = true; slot.born = time; slot.idle = idle; slot.hot = hot; slot.owner=id;
  }

  endFrame(time: number): void {
    for (const [id, state] of this.swimmers) if (!state.seen) this.swimmers.delete(id);
    for (const slot of this.slots) {
      if (!slot.active) continue;
      const age = (time - slot.born) / slot.lifetime;
      if (age >= 1) { slot.active = false; slot.root.visible = false; continue; }
      const radius = (slot.idle ? 20 + age * 50 : 36 + Math.pow(age, .7) * 59) / WORLD_3D.tilePixels;
      const halfWidth = 1.5 * (1 - age * .2) / WORLD_3D.tilePixels;
      const attribute = slot.mesh.geometry.attributes.position;
      const positions = attribute.array as Float32Array;
      const span = slot.idle ? Math.PI * 2 : Math.PI;
      let cursor = 0;
      const vertex = (t: number, side: number) => {
        const angle = -span / 2 + t * span;
        const squish = slot.idle ? 1 : .75 + Math.abs(t - .5) * .25;
        const turbulence = (Math.sin(angle * 8 + time * 3 + slot.born) + .5 * Math.sin(angle * 12 + time * 2 + slot.born * 1.3)) * Math.pow(age, 1.5) * radius * .1;
        const r = radius * squish + turbulence + side * halfWidth;
        positions[cursor++] = Math.sin(angle) * r;
        positions[cursor++] = 0;
        positions[cursor++] = -Math.cos(angle) * r;
      };
      for (let i = 0; i < 48; i++) {
        const a = i / 48, b = (i + 1) / 48;
        vertex(a, -1); vertex(b, -1); vertex(b, 1); vertex(a, -1); vertex(b, 1); vertex(a, 1);
      }
      attribute.needsUpdate = true;
      const opacity = Math.min(11, Math.max(0, Math.floor((1 - age) * 11)));
      slot.mesh.material = this.materials[(slot.hot ? 12 : 0) + opacity];
    }
  }

  dispose(): void { this.slots.forEach(slot => slot.mesh.geometry.dispose()); this.materials.forEach(material => material.dispose()); this.swimmers.clear(); this.root.clear(); }
}
