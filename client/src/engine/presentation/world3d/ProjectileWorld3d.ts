import { Color, Group, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { attribute } from 'three/tsl';
import type { ItemDefinition, Projectile } from '../../../generated/types';
import { sampleProjectileState } from '../../../utils/projectileSampling';
import { ModelKit } from './modelKit';
import { createWeapon, resolveWeaponName } from './weaponModels';
import { StaticWorldBatches } from './StaticWorldBatches';
import { GROUND_Y_SCALE, WORLD_3D, worldToScene } from './visualContract';

const FORWARD = new Vector3(0, 0, 1), TRAILS = 2048;
const ownerId = (row: Projectile): string => row.ownerId?.toHexString?.() ?? '';
interface Flight { root: Group; body: Group; launch?: Vector3; born: number; key: string }

/** Reuse the game's existing gravity/range sampler. Raising the model into
 * depth compensates its Z so its screen position still agrees with collision. */
export function projectileScenePosition(projectile: Projectile, age: number, definitions: Map<string, ItemDefinition>, target = new Vector3()): Vector3 {
  const sampled = sampleProjectileState(projectile, Math.max(0, age), definitions), ground = worldToScene(sampled.x, sampled.y);
  const height = .85;
  return target.set(ground.x, height, ground.z + height / Math.tan(WORLD_3D.elevationRadians));
}

export class ProjectileWorld3d {
  readonly root = new Group();
  readonly trails: InstancedMesh;
  private readonly alpha = new InstancedBufferAttribute(new Float32Array(TRAILS), 1);
  private readonly trailMaterial = new MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false });
  private readonly prototypes = new Map<string, Group>();
  private readonly flights = new Map<string, Flight>();
  private readonly transform = new Object3D();
  private readonly color = new Color();
  private readonly position = new Vector3();
  private readonly direction = new Vector3();
  private readonly launchPosition = new Vector3();
  private readonly rotation = new Quaternion();
  get activeCount(): number { return this.flights.size; }

  constructor(private readonly kit: ModelKit, private readonly batches: StaticWorldBatches) {
    this.root.name = 'projectile-world';
    const geometry = kit.geometry('rock').clone(); geometry.setAttribute('projectileTrailAlpha', this.alpha);
    this.trailMaterial.opacityNode = attribute('projectileTrailAlpha', 'float');
    this.trails = new InstancedMesh(geometry, this.trailMaterial, TRAILS);
    this.trails.count = 0; this.trails.frustumCulled = false; this.trails.setColorAt(0, this.color);
    this.root.add(this.trails); this.root.visible = false;
  }

  update(projectiles: Map<string, Projectile>, definitions: Map<string, ItemDefinition>, nowMs: number,
    muzzle: (owner: string, target: Vector3) => boolean, hidden: (x: number, y: number) => boolean): void {
    const seen = new Set<string>(); let trails = 0;
    for (const [id, projectile] of projectiles) {
      if (seen.size >= 512) break;
      const key = projectile.clientShotId || id;
      if (seen.has(key)) continue;
      const start = Number(projectile.startTime.microsSinceUnixEpoch / 1000n), age = (nowMs - start) / 1000;
      const speed = Math.hypot(projectile.velocityX, projectile.velocityY);
      if (age < 0 || age > 15 || speed * age > projectile.maxRange + 16) continue;
      const sample = sampleProjectileState(projectile, age, definitions);
      if (hidden(sample.x, sample.y)) continue;
      seen.add(key);
      const weapon = definitions.get(String(projectile.itemDefId))?.name ?? '', ammo = definitions.get(String(projectile.ammoDefId))?.name ?? '';
      const thrown = projectile.ammoDefId === projectile.itemDefId;
      const bullet = sample.isBullet, npc = projectile.npcProjectileType ?? 0;
      const identity = `${thrown ? weapon : bullet ? 'bullet' : ammo || 'arrow'}:${npc}`;
      let flight = this.flights.get(key);
      if (!flight || flight.key !== identity) {
        let prototype = this.prototypes.get(identity);
        if (!prototype) { prototype = this.createModel(weapon, ammo, thrown, bullet, npc); this.prototypes.set(identity, prototype); }
        const root = new Group(), body = prototype.clone(true); root.add(body); root.scale.z = GROUND_Y_SCALE;
        flight = { root, body, born: start, key: identity };
        if (muzzle(ownerId(projectile), this.launchPosition)) flight.launch = this.launchPosition.clone();
        this.flights.set(key, flight);
      }
      projectileScenePosition(projectile, age, definitions, this.position);
      if (flight.launch && age < .12) {
        const origin = worldToScene(projectile.startPosX, projectile.startPosY), blend = (1 - age / .12) ** 2;
        this.position.x += (flight.launch.x - origin.x) * blend;
        this.position.y += (flight.launch.y - .85) * blend;
        this.position.z += (flight.launch.z - origin.z - .85 / Math.tan(WORLD_3D.elevationRadians)) * blend;
      }
      flight.root.position.copy(this.position);
      this.direction.set(projectile.velocityX, 0, sample.instantaneousVelocityY).normalize();
      this.rotation.setFromUnitVectors(FORWARD, this.direction); flight.body.quaternion.copy(this.rotation);
      if (thrown && !/Spear|Harpoon/.test(weapon)) flight.body.rotateZ(age * Math.PI * 12);
      this.batches.submit(flight.root);
      if (npc || /Fire|Flare/.test(ammo) || /Flare/.test(weapon)) for (let i = 1; i <= 8 && trails < TRAILS; i++) {
        const t = age - i * .025; if (t < 0) continue;
        projectileScenePosition(projectile, t, definitions, this.position);
        this.transform.position.copy(this.position); this.transform.rotation.set(t * 3, t * 5, 0);
        this.transform.scale.setScalar((npc === 3 ? .12 : .09) * (1 - i / 10)); this.transform.updateMatrix();
        this.trails.setMatrixAt(trails, this.transform.matrix);
        this.trails.setColorAt(trails, this.color.setHex(npc === 3 ? 0x9fb94f : npc ? 0xa9d5ed : 0xffa35b));
        this.alpha.setX(trails++, .7 * (1 - i / 9));
      }
    }
    for (const id of this.flights.keys()) if (!seen.has(id)) this.flights.delete(id);
    this.trails.count = trails; this.root.visible = trails > 0;
    if (trails) { this.trails.instanceMatrix.needsUpdate = true; this.trails.instanceColor!.needsUpdate = true; this.alpha.needsUpdate = true; }
  }

  private createModel(weapon: string, ammo: string, thrown: boolean, bullet: boolean, npc: number): Group {
    const root = new Group();
    if (thrown && resolveWeaponName(weapon)) {
      const model = createWeapon(this.kit, weapon);
      model.getObjectByName('muzzle-flash')?.removeFromParent(); model.getObjectByName('held-torch-flame')?.removeFromParent();
      model.getObjectByName('loaded-projectile')?.removeFromParent();
      model.rotation.x = Math.PI / 2; root.add(model);
    } else if (npc) {
      const color = npc === 3 ? 0x92c94c : npc === 1 ? 0xaabedc : 0xd5e8ed;
      const core = this.kit.part(root, npc === 1 ? 'cone' : 'rock', color, [npc === 3 ? .22 : .13, .13, .4], [0, 0, 0], true);
      if (npc === 1) core.rotation.x = Math.PI / 2;
    } else if (bullet) {
      this.kit.part(root, 'box', 0xffdf99, [.055, .055, .3], [0, 0, 0], true);
    } else {
      const harpoon = /Harpoon/.test(ammo + weapon), shaft = this.kit.part(root, 'cylinder', 0x987549, [.035, harpoon ? 1 : .7, .035], [0, 0, 0]); shaft.rotation.x = Math.PI / 2;
      const head = this.kit.part(root, 'cone', /Fire/.test(ammo) ? 0xe6a25b : 0xb8c2b6, [.1, .16, .045], [0, 0, harpoon ? .51 : .37], /Fire/.test(ammo)); head.rotation.x = Math.PI / 2;
      for (const sign of [-1, 1]) this.kit.part(root, 'box', 0xcac7ab, [.13, .022, .16], [sign * .04, 0, -.27]).rotation.z = sign * .7;
    }
    const model = this.kit.compileColored(this.kit.compile(root)); model.userData.projectile = true; return model;
  }

  dispose(): void {
    this.root.removeFromParent(); this.flights.clear(); this.prototypes.clear();
    this.trails.geometry.dispose(); this.trails.dispose(); this.trailMaterial.dispose();
  }
}
