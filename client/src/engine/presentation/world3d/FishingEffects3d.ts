import { Color, Group, InstancedMesh, MeshStandardMaterial, Object3D, Vector3 } from 'three/webgpu';
import { ModelKit } from './modelKit';
import { smoothPhase, timestampMs } from './actorAnimation';
import type { PresentationEntity as Row } from './presentationEntity';
import { worldToScene } from './visualContract';

const UP = new Vector3(0, 1, 0), CAPACITY = 1024;
/** A cast carries the float from the actual rod tip to the authoritative
 * water target. Lines then sag in world space and dip when a fish bites. */
export class FishingEffects3d {
  readonly root = new Group();
  readonly lines: InstancedMesh;
  readonly floats: InstancedMesh;
  private readonly lineMaterial = new MeshStandardMaterial({ color: 0x574b38, roughness: 1 });
  private readonly floatMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: .8 });
  private readonly transform = new Object3D();
  private readonly tint = new Color();
  private readonly tip = new Vector3();
  private readonly target = new Vector3();
  private readonly start = new Vector3();
  private readonly end = new Vector3();
  private readonly direction = new Vector3();

  constructor(kit: ModelKit) {
    this.root.name = 'fishing-lines-and-floats';
    this.lines = new InstancedMesh(kit.geometry('cylinder'), this.lineMaterial, CAPACITY);
    this.floats = new InstancedMesh(kit.geometry('rock'), this.floatMaterial, 128); this.floats.setColorAt(0, this.tint);
    for (const mesh of [this.lines, this.floats]) { mesh.count = 0; mesh.frustumCulled = false; this.root.add(mesh); }
    this.root.visible = false;
  }

  update(sessions: Map<string, Row>, now: number, rodTip: (owner: string, target: Vector3) => boolean, submerged = false): void {
    let lines = 0, floats = 0;
    for (const [owner, session] of sessions) {
      if (!session.isActive || !rodTip(owner, this.tip) || floats >= 128) continue;
      const age = (now - timestampMs(session.castTime)) / 1000;
      if (age < .2) continue;
      const water = worldToScene(session.targetX ?? 0, session.targetY ?? 0), cast = smoothPhase((age - .2) / .7);
      this.target.set(water.x, .04 + (session.hasBite ? Math.sin(age * 15) * .025 : Math.sin(age * 3) * .012), water.z);
      this.target.lerp(this.tip, 1 - cast); this.target.y += Math.sin(cast * Math.PI) * .8;
      this.transform.position.copy(this.target); this.transform.rotation.set(0, age, session.hasBite ? Math.sin(age * 13) * .25 : 0);
      this.transform.scale.set(.1, .18, .1); this.transform.updateMatrix(); this.floats.setMatrixAt(floats, this.transform.matrix);
      this.floats.setColorAt(floats++, this.tint.setHex(session.hasBite ? 0xc57648 : 0xcab58c));
      this.start.copy(this.tip);
      for (let i = 1; i <= 16 && lines < CAPACITY; i++) {
        const t = i / 16;
        this.end.copy(this.tip).lerp(this.target, t); this.end.y -= Math.sin(t * Math.PI) * .2 * cast;
        this.direction.copy(this.end).sub(this.start);
        this.transform.position.copy(this.start).add(this.end).multiplyScalar(.5);
        this.transform.scale.set(.025, this.direction.length(), .025);
        this.transform.quaternion.setFromUnitVectors(UP, this.direction.normalize()); this.transform.updateMatrix();
        this.lines.setMatrixAt(lines++, this.transform.matrix); this.start.copy(this.end);
      }
    }
    this.lines.count = lines; this.floats.count = floats; this.root.visible = !submerged && lines + floats > 0;
    if (lines) this.lines.instanceMatrix.needsUpdate = true;
    if (floats) { this.floats.instanceMatrix.needsUpdate = true; this.floats.instanceColor!.needsUpdate = true; }
  }
  dispose(): void { this.root.removeFromParent(); this.lines.dispose(); this.floats.dispose(); this.lineMaterial.dispose(); this.floatMaterial.dispose(); }
}
