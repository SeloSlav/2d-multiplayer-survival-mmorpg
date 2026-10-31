import { Color, Group, InstancedBufferAttribute, InstancedMesh, Matrix3, Matrix4, MeshStandardNodeMaterial, Quaternion, Vector3 } from 'three/webgpu';
import { attribute, mix } from 'three/tsl';
import { barrelPaint, createBarrel } from './environmentModels';
import { combatCoverProfile } from '../../../config/combatCover';
import { CombatCoverDebris3d } from './CombatCoverDebris3d';
import type { ModelKit } from './modelKit';
import { barrelFractureSeeds, createVoronoiFragments } from './voronoiFracture';
import type { FracturePiece } from './voronoiFracture';
import { seedFromId, seededRandom } from './visualContract';
import { worldBarrelBreaksAfter } from './presentationEffectEvents';
import type { WorldBarrelBreak } from './presentationEffectEvents';

export const BARREL_FRACTURE_CAPACITY = 12, BARREL_FRACTURE_LIFETIME = 2000;
const GRAVITY = 9.8;
interface Motion { start: Vector3; velocity: Vector3; axis: Vector3; spin: number; impact: number; rebound: number }
interface Burst { at: number; paint: Color; linear: Matrix4; floor: number; motion: Motion[] }
export type BarrelFracturePose = (event: WorldBarrelBreak, target: Matrix4) => number | null;

/** Precut, capped solid cells. One instanced draw per cell serves every burst;
 * geometry and motion storage are allocated once, not during destruction. */
export class BarrelFractureEffects3d {
  private readonly coverDebris: CombatCoverDebris3d;
  readonly root = new Group();
  readonly fragments: readonly FracturePiece[];
  readonly meshes: InstancedMesh[] = [];
  private readonly material = new MeshStandardNodeMaterial({ roughness: .9, metalness: .12, flatShading: true });
  private readonly paintAttributes: InstancedBufferAttribute[] = [];
  private readonly slots: Burst[] = [];
  private readonly origin = new Matrix4();
  private readonly linear3 = new Matrix3();
  private readonly rotation = new Quaternion();
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private cursor = 0;
  private count = 0;

  constructor(kit: ModelKit) {
    this.coverDebris=new CombatCoverDebris3d(kit);this.root.add(this.coverDebris.root);
    this.root.name = 'barrel-voronoi-fractures'; this.root.visible = false;
    this.fragments = createVoronoiFragments(createBarrel(kit), barrelFractureSeeds(), barrelPaint(0));
    // Only the original painted shell changes between barrel variants. Bands,
    // labels and fresh cut faces retain their own linear pigment.
    this.material.colorNode = mix(attribute('color', 'vec3'), attribute('fracturePaint', 'vec3'), attribute('paintMask', 'float'));
    for (const [i, piece] of this.fragments.entries()) {
      const paint = new InstancedBufferAttribute(new Float32Array(BARREL_FRACTURE_CAPACITY * 3), 3);
      piece.geometry.setAttribute('fracturePaint', paint); this.paintAttributes.push(paint);
      const mesh = new InstancedMesh(piece.geometry, this.material, BARREL_FRACTURE_CAPACITY);
      mesh.name = `barrel-fracture-cell-${i}`; mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true;
      mesh.userData.warmupPerObject = true;
      this.meshes.push(mesh); this.root.add(mesh);
    }
    for (let i = 0; i < BARREL_FRACTURE_CAPACITY; i++) this.slots.push({ at: 0, paint: new Color(), linear: new Matrix4(), floor: 0,
      motion: this.fragments.map(() => ({ start: new Vector3(), velocity: new Vector3(), axis: new Vector3(), spin: 0, impact: 0, rebound: 0 })) });
  }
  get activeCount(): number { return this.count; }

  spawn(id: string, variant: number, at: number, origin: Matrix4, floor: number): void {
    if (variant === 6) return;
    let slot: Burst;
    if (this.count < BARREL_FRACTURE_CAPACITY) slot = this.slots[this.count++];
    else slot = this.slots.reduce((oldest, value) => value.at < oldest.at ? value : oldest);
    slot.at = at; slot.floor = floor; slot.paint.setHex(barrelPaint(variant)); slot.linear.copy(origin).setPosition(0, 0, 0);
    this.linear3.setFromMatrix4(slot.linear);
    const random = seededRandom(seedFromId(`barrel:${id}:${at}`));
    for (let i = 0; i < this.fragments.length; i++) {
      const piece = this.fragments[i], motion = slot.motion[i], angle = Math.atan2(piece.center.z, piece.center.x) + (random() - .5) * .55;
      const speed = 1.5 + random() * 1.5;
      motion.start.copy(piece.center).applyMatrix4(origin);
      motion.velocity.set(Math.cos(angle) * speed, 2.5 + random() * 1.8, Math.sin(angle) * speed).applyMatrix3(this.linear3);
      motion.axis.set(random() - .5, random() - .5, random() - .5).normalize(); motion.spin = 3 + random() * 5;
      const clearance = Math.max(0, motion.start.y + this.bottom(piece, slot.linear) - floor);
      motion.impact = (motion.velocity.y + Math.sqrt(motion.velocity.y ** 2 + 2 * GRAVITY * clearance)) / GRAVITY;
      motion.rebound = Math.max(0, GRAVITY * motion.impact - motion.velocity.y) * .24;
    }
  }

  update(now: number, submerged = false, pose?: BarrelFracturePose): void {
    for (const event of worldBarrelBreaksAfter(this.cursor, now)) {
      this.cursor = Math.max(this.cursor, event.sequence);
      const floor = pose?.(event, this.origin);
      if (floor !== undefined && floor !== null) {
        if(combatCoverProfile(event.variant))this.coverDebris.spawn(event.id,event.variant,event.at,this.origin,floor);
        else this.spawn(event.id, event.variant, event.at, this.origin, floor);
      }
    }
    for (let i = 0; i < this.count;) {
      const age = now - this.slots[i].at;
      if (age < 0 || age >= BARREL_FRACTURE_LIFETIME) {
        const expired = this.slots[i]; this.slots[i] = this.slots[--this.count]; this.slots[this.count] = expired;
      } else i++;
    }
    for (let index = 0; index < this.count; index++) {
      const slot = this.slots[index], age = (now - slot.at) / 1000;
      const fade = Math.min(1, (BARREL_FRACTURE_LIFETIME / 1000 - age) / .4);
      this.scale.setScalar(Math.max(0, fade));
      for (let i = 0; i < this.fragments.length; i++) {
        const piece = this.fragments[i], motion = slot.motion[i], after = Math.max(0, age - motion.impact);
        const travel = Math.min(age, motion.impact) + .35 * (1 - Math.exp(-4 * after)) / 4;
        const spinTime = Math.min(age, motion.impact) + (1 - Math.exp(-5 * after)) / 5;
        this.rotation.setFromAxisAngle(motion.axis, spinTime * motion.spin);
        this.matrix.compose(this.position.set(0, 0, 0), this.rotation, this.scale).multiply(slot.linear);
        const bottom = this.bottom(piece, this.matrix);
        let y = motion.start.y + motion.velocity.y * age - .5 * GRAVITY * age * age;
        if (after > 0) {
          const bounceTime = Math.min(after, motion.rebound * 2 / GRAVITY);
          y = slot.floor - bottom + motion.rebound * bounceTime - .5 * GRAVITY * bounceTime * bounceTime;
        }
        this.matrix.setPosition(motion.start.x + motion.velocity.x * travel, age === 0 ? y : Math.max(slot.floor - bottom, y), motion.start.z + motion.velocity.z * travel);
        this.meshes[i].setMatrixAt(index, this.matrix);
        this.paintAttributes[i].setXYZ(index, slot.paint.r, slot.paint.g, slot.paint.b);
      }
    }
    this.coverDebris.update(now);
    this.root.visible = !submerged && (this.count > 0 || this.coverDebris.activeCount > 0);
    for (let i = 0; i < this.meshes.length; i++) {
      this.meshes[i].count = this.count;
      if (this.count) { this.meshes[i].instanceMatrix.needsUpdate = true; this.paintAttributes[i].needsUpdate = true; }
    }
  }

  private bottom(piece: FracturePiece, matrix: Matrix4): number {
    // Exact rotated support, so even long irregular pieces rest on the floor
    // rather than floating on an oversized sphere or tunnelling into it.
    const p = piece.geometry.getAttribute('position'), e = matrix.elements;
    let bottom = Infinity;
    for (let i = 0; i < p.count; i++) bottom = Math.min(bottom, e[1] * p.getX(i) + e[5] * p.getY(i) + e[9] * p.getZ(i));
    return bottom;
  }
  dispose(): void {
    this.coverDebris.dispose();
    this.root.removeFromParent(); this.count = 0;
    for (const mesh of this.meshes) { mesh.dispose(); mesh.geometry.dispose(); }
    this.material.dispose(); this.root.clear();
  }
}
