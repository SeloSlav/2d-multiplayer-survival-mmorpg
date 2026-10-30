import { Box3, Euler, Group, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { COLORS as C, ModelKit } from './modelKit';
import { BOW_GEOMETRY, bowNockZ, createWeapon } from './weaponModels';
import type { GripStyle } from './weaponModels';
import { ARM_SEGMENT_LENGTH, ArmPoseSolver } from './armPose';
import { restingWeaponPitch } from './weaponCarry';
import { bowDrawPhase, clamp01, recoilEnvelope, reloadHandPhase, smoothPhase } from './actorAnimation';
import type { InteractionPose } from './actorAnimation';
import { SurvivorArmor } from './survivorArmor';
import type { WornArmor } from './survivorArmor';

const UP = new Vector3(0, 1, 0);

export { createWeapon } from './weaponModels';

export interface SurvivorPose {
  speed: number;
  sprinting: boolean;
  crouching: boolean;
  swimming: boolean;
  dead: boolean;
  jump: number;
  roll: number;
  attack: number;
  throwAiming?: boolean;
  throwRelease?: number;
  yaw: number;
  weapon: string;
  torchLit?: boolean;
  loaded?: boolean;
  reloading?: boolean;
  shotAge?: number;
  reloadProgress?: number;
  bowDraw?: number;
  knockedOut?: boolean;
  downAge?: number;
  jumpAge?: number;
  interaction?: InteractionPose;
  armor?: WornArmor;
}

/** Articulated solid-mesh survivor. Every limb rotates around its anatomical root. */
export class SurvivorRig {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly torso = new Group();
  private readonly head = new Group();
  private readonly leftArm = new Group();
  private readonly rightArm = new Group();
  private readonly leftForearm = new Group();
  private readonly rightForearm = new Group();
  private readonly leftHand = new Group();
  private readonly rightHand = new Group();
  private readonly leftLeg = new Group();
  private readonly rightLeg = new Group();
  private readonly leftKnee = new Group();
  private readonly rightKnee = new Group();
  private readonly handSocket = new Group();
  private readonly leftHandSocket = new Group();
  private weaponName = '';
  private weapon = new Group();
  private readonly weaponCache = new Map<string, Group>();
  private readonly armSolver = new ArmPoseSolver();
  private readonly gripPosition = new Vector3();
  private readonly gripOrientation = new Quaternion();
  private readonly gripEuler = new Euler();
  private readonly supportPosition = new Vector3();
  private readonly supportOrientation = new Quaternion();
  private readonly bodyInverse = new Quaternion();
  private readonly foregripRotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
  private readonly swingRotation = new Quaternion();
  private readonly swingAxis = new Vector3(1, 0, 0);
  private readonly readyArmInverse = new Quaternion().setFromEuler(new Euler(-.45, 0, .12)).invert();
  private readonly oneHandGrip = new Quaternion();
  private readonly carryRotation = new Quaternion();
  private carryPitch = restingWeaponPitch(0);
  private previousAttack = 0;
  private readonly flameFrameInverse = new Matrix4();
  private readonly flameUp = new Vector3();
  private readonly swimTorchTarget = new Vector3();
  private readonly swimTorchOutward = new Vector3();
  private readonly swimTorchBodyInverse = new Matrix4();
  private readonly rightPole = new Vector3(.8, .75, .1);
  private readonly leftPole = new Vector3(-.8, .75, .1);
  private phase = 0;
  private stride = 0;
  private swimBlend = 0;
  private swimPhase = 0;
  private swimKickPhase = 0;
  private swimKickSprint = 0;
  private yawInitialized = false;
  private readonly anchorCorrection = new Vector3();
  private readonly bounds = new Box3();
  private readonly partBounds = new Box3();
  private readonly groundOrigin = new Vector3();
  private readonly stringDirection = new Vector3();
  private readonly actionTarget = new Vector3();
  private readonly actionRest = new Vector3();
  private readonly actionOrientation = new Quaternion();
  private readonly actionProps = new Group();
  private readonly armor: SurvivorArmor;
  private wasDown = false;
  private lifeInitialized = false;
  private recoveryAt = -Infinity;
  private lifeAmount = 0;
  private bowReleased = false;
  private previousBowShotAge = Infinity;
  readonly waterAnchor = new Object3D();

  get unfinishedWeapon(): string | undefined { return this.weapon.userData.unfinishedWeapon; }
  get torchFlame(): Group | undefined { return this.weapon.getObjectByName('held-torch-flame') as Group | undefined; }
  get muzzleFlash(): Group | undefined { return this.weapon.getObjectByName('muzzle-flash') as Group | undefined; }
  get contactPhase(): number { return this.phase; }
  footWorldPosition(left: boolean, target: Vector3): Vector3 {
    const knee = left ? this.leftKnee : this.rightKnee;
    knee.updateWorldMatrix(true, false);
    return knee.localToWorld(target.set(0, -.35, .1));
  }

  constructor(private readonly kit: ModelKit, coat: number = C.dress) {
    const part = kit.part.bind(kit);
    this.body.name = 'survivor-body';
    this.root.add(this.body);
    this.waterAnchor.name = 'swim-center';
    this.waterAnchor.position.y = 1.08;
    this.body.add(this.waterAnchor);
    this.torso.name = 'survivor-torso';
    this.body.add(this.torso, this.leftLeg, this.rightLeg); this.torso.add(this.head, this.leftArm, this.rightArm);
    part(this.torso, 'rock', coat, [0.64, 0.7, 0.4], [0, 1.02, 0]);
    const skirt = new Group(); skirt.name = 'survivor-skirt'; this.body.add(skirt);
    part(skirt, 'skirt', coat, [0.75, 0.42, 0.59], [0, 0.63, 0]);
    part(this.torso, 'box', C.apron, [0.36, 0.39, 0.045], [0, 0.93, 0.193]);
    part(skirt, 'box', C.apron, [0.45, 0.24, 0.045], [0, 0.64, 0.23]);
    part(this.body, 'box', C.leather, [0.49, 0.055, 0.34], [0, 0.77, 0.01]);
    part(this.body, 'box', C.woodDark, [0.22, 0.23, 0.14], [0.18, 0.77, -0.2]);
    this.head.position.y = 1.36;
    // Preserve the canonical babushka's scarf, dress, apron and exposed face.
    part(this.head, 'rock', C.scarf, [0.48, 0.5, 0.47], [0, 0.13, -0.015]);
    part(this.head, 'box', C.skin, [0.29, 0.29, 0.085], [0, 0.1, 0.205]);
    part(this.head, 'box', C.bone, [0.31, 0.045, 0.035], [0, 0.245, 0.248]);
    for (const x of [-0.075, 0.075]) {
      part(this.head, 'box', C.coal, [0.033, 0.035, 0.02], [x, 0.13, 0.253]);
      part(this.head, 'box', C.bone, [0.065, 0.018, 0.02], [x, 0.18, 0.253]);
    }
    part(this.head, 'rock', C.skin, [0.065, 0.08, 0.075], [0, 0.075, 0.27]);
    part(this.head, 'box', 0x8b5f54, [0.07, 0.018, 0.02], [0, 0.01, 0.253]);
    const kerchief = part(this.head, 'cone', C.scarf, [0.3, 0.2, 0.15], [0, -0.105, 0.19]);
    kerchief.rotation.x = Math.PI;
    for (const sign of [-1, 1]) {
      const tail = part(this.head, 'cone', C.scarfShadow, [0.17, 0.32, 0.1], [sign * 0.08, -0.09, -0.2]);
      tail.rotation.z = Math.PI + sign * 0.35;
    }
    part(this.torso, 'rock', C.scarfShadow, [0.55, 0.19, 0.39], [0, 1.28, 0]);
    for (const [limb, forearm, hand, sign] of [[this.leftArm, this.leftForearm, this.leftHand, -1], [this.rightArm, this.rightForearm, this.rightHand, 1]] as const) {
      limb.position.set(sign * 0.32, 1.22, 0);
      limb.name = sign < 0 ? 'left-upper-arm' : 'right-upper-arm';
      part(limb, 'rock', coat, [0.22, ARM_SEGMENT_LENGTH + .08, 0.23], [0, -ARM_SEGMENT_LENGTH / 2, 0]);
      forearm.position.y = -ARM_SEGMENT_LENGTH;
      forearm.name = sign < 0 ? 'left-forearm' : 'right-forearm';
      limb.add(forearm);
      part(forearm, 'rock', coat, [.18, ARM_SEGMENT_LENGTH, .19], [0, -ARM_SEGMENT_LENGTH / 2 + .025, 0]);
      hand.position.y = -ARM_SEGMENT_LENGTH;
      hand.name = sign < 0 ? 'left-hand' : 'right-hand';
      forearm.add(hand);
      // The palm and curled fingers surround the grip origin rather than
      // placing an item beside an unconnected mitten.
      part(hand, 'rock', C.skin, [.13, .16, .14], [sign * .035, 0, -.015]);
      for (const y of [-.04, .015, .06]) part(hand, 'box', C.skin, [.12, .033, .04], [0, y, .055]);
      part(hand, 'rock', C.skin, [.055, .085, .07], [-sign * .055, .045, .025]);
    }
    this.handSocket.name = 'right-hand-socket';
    this.leftHandSocket.name = 'left-hand-socket';
    this.rightHand.add(this.handSocket);
    this.leftHand.add(this.leftHandSocket);
    this.handSocket.add(this.weapon);
    this.actionProps.name = 'interaction-props'; this.actionProps.visible = false;
    this.rightHand.add(this.actionProps);
    const food = part(this.actionProps, 'rock', 0x9c603d, [.17, .15, .18], [0, .05, .02]); food.name = 'eat-prop';
    const cup = new Group(); cup.name = 'drink-prop'; this.actionProps.add(cup);
    kit.vessel(cup, 0xa5aaa0, .07, .08, .015, .15, 8).position.set(0, -.01, .02);
    const bandage = part(this.actionProps, 'cylinder', C.bone, [.12, .08, .12], [0, 0, .03]); bandage.name = 'bandage-prop';
    for (const [limb, knee, sign] of [[this.leftLeg, this.leftKnee, -1], [this.rightLeg, this.rightKnee, 1]] as const) {
      limb.position.set(sign * 0.135, 0.75, 0);
      part(limb, 'box', 0x485450, [0.21, 0.37, 0.23], [0, -0.18, 0]);
      knee.position.y = -.39; knee.name = sign < 0 ? 'left-knee' : 'right-knee'; limb.add(knee);
      part(knee, 'rock', 0x485450, [.22, .13, .24], [0, -.005, 0]);
      part(knee, 'box', 0x485450, [.21, .25, .23], [0, -.12, 0]);
      part(knee, 'box', C.leather, [0.24, 0.2, 0.37], [0, -0.25, 0.06]);
    }
    // Articulation stays in the anatomical groups; their rigid solids share
    // compiled geometry across players instead of adding a draw per finger.
    const groups: Group[] = []; this.root.traverse(object => { if (object instanceof Group) groups.push(object); });
    groups.forEach((group, index) => {
      if (this.actionProps.getObjectById(group.id)) return;
      const solids = group.children.filter(object => object instanceof Mesh);
      if (!solids.length) return;
      const fixed = new Group(); solids.forEach(object => fixed.add(object));
      group.add(kit.compileShared(fixed, `survivor:${coat}:${index}`));
    });
    this.armor = new SurvivorArmor(kit, { head: this.head, torso: this.torso,
      arms: [this.leftArm, this.rightArm], hands: [this.leftHand, this.rightHand],
      legs: [this.leftLeg, this.rightLeg], knees: [this.leftKnee, this.rightKnee] }, skirt);
  }

  update(pose: SurvivorPose, dt: number, time: number): void {
    this.armor.update(pose.armor);
    const down = pose.dead || pose.knockedOut === true;
    const shotAge = pose.shotAge ?? Infinity;
    if (this.lifeInitialized && this.wasDown && !down) this.recoveryAt = time;
    if (down) this.recoveryAt = -Infinity;
    this.lifeAmount = down ? pose.downAge === undefined ? 1 : smoothPhase(pose.downAge / .72)
      : 1 - smoothPhase((time - this.recoveryAt) / 1.15);
    this.wasDown = down; this.lifeInitialized = true;
    const action = !down && this.lifeAmount < .01 && !pose.swimming && pose.roll <= 0 && pose.attack <= 0 && (pose.shotAge ?? Infinity) >= .28 && pose.reloadProgress === undefined
      ? pose.interaction : undefined;
    this.head.rotation.set(0, 0, 0);
    this.body.rotation.z = 0;
    this.torso.rotation.set(action?.kind === 'gather' ? action.weight * .65 : 0, 0, 0);
    this.torso.position.set(0, .75, 0).sub(this.anchorCorrection.set(0, .75, 0).applyEuler(this.torso.rotation));
    this.leftKnee.rotation.set(0, 0, 0); this.rightKnee.rotation.set(0, 0, 0);
    const weaponChanged = pose.weapon !== this.weaponName;
    if (weaponChanged) {
      this.weapon.removeFromParent();
      this.weapon = this.weaponCache.get(pose.weapon) ?? createWeapon(this.kit, pose.weapon);
      this.weaponCache.set(pose.weapon, this.weapon);
      this.weapon.name = 'held-weapon';
      (this.weapon.userData.primaryHand === 'left' ? this.leftHandSocket : this.handSocket).add(this.weapon);
      this.weaponName = pose.weapon;
    }
    const moving = Math.min(1, pose.speed / 1.4);
    const grip = this.weapon.userData.gripStyle as GripStyle | undefined;
    if (weaponChanged || grip !== 'bow') { this.bowReleased = false; this.previousBowShotAge = Infinity; }
    if (grip === 'bow') {
      if (shotAge >= 0 && shotAge < .65 && shotAge < this.previousBowShotAge) this.bowReleased = true;
      if (!pose.loaded || pose.reloadProgress !== undefined) this.bowReleased = false;
      this.previousBowShotAge = shotAge;
    }
    const draw = bowDrawPhase(this.bowReleased ? 0 : pose.bowDraw ?? 1, shotAge);
    const aimed = grip === 'pistol' || grip === 'longgun' || grip === 'bow';
    this.leftForearm.quaternion.identity(); this.rightForearm.quaternion.identity();
    this.leftHand.quaternion.identity(); this.rightHand.quaternion.identity();
    this.stride += (moving - this.stride) * (1 - Math.exp(-dt * 14));
    this.phase += dt * (pose.sprinting ? 13 : pose.swimming ? 5 : 8);
    const swing = Math.sin(this.phase) * this.stride * (pose.sprinting ? 0.95 : 0.62);
    const turn = Math.atan2(Math.sin(pose.yaw - this.root.rotation.y), Math.cos(pose.yaw - this.root.rotation.y));
    this.root.rotation.y = this.yawInitialized ? this.root.rotation.y + turn * (1 - Math.exp(-dt * 16)) : pose.yaw;
    this.yawInitialized = true;
    if (weaponChanged || pose.attack <= 0 || pose.attack < this.previousAttack) {
      // Capture a new carry grip at rest / swing start, then keep it rigid
      // until the swing ends even when the survivor turns during the attack.
      this.carryPitch = restingWeaponPitch(this.root.rotation.y);
      this.carryRotation.setFromAxisAngle(this.swingAxis, this.carryPitch);
      this.oneHandGrip.copy(this.readyArmInverse).multiply(this.carryRotation);
    }
    this.previousAttack = pose.attack;
    this.swimBlend += (Number(pose.swimming) - this.swimBlend) * (1 - Math.exp(-dt * 12));
    const fastSwim = pose.sprinting ? 1 : Math.min(1, Math.max(0, (pose.speed - 2.1) / 2.5));
    const swimRate = 3.4 + this.stride * (2.8 + fastSwim * 3.6);
    this.swimPhase += dt * swimRate;
    // Normal kicks stay gentle even when measured movement speed fluctuates.
    // Ease sprint cadence and range together without resetting the leg cycle.
    this.swimKickSprint += (Number(pose.sprinting) - this.swimKickSprint) * (1 - Math.exp(-dt * 5));
    const normalKickRate = 1.6 + this.stride * .6;
    const normalKickRange = .12 + this.stride * .06;
    this.swimKickPhase += dt * (normalKickRate + (swimRate - normalKickRate) * this.swimKickSprint);
    const kickRange = normalKickRange + (.7 - normalKickRange) * this.swimKickSprint;
    if(!pose.swimming && this.swimBlend < .001)this.swimKickPhase = this.swimPhase;
    const swimPitch = 0.08 + this.stride * (0.92 + fastSwim * 0.32);
    const landPitch = pose.crouching ? 0.27 : this.stride * 0.06;
    this.body.rotation.set(landPitch + (swimPitch - landPitch) * this.swimBlend, 0, 0);
    this.leftLeg.rotation.x = swing;
    this.rightLeg.rotation.x = -swing;
    this.leftArm.rotation.x = -swing * 0.65;
    this.rightArm.rotation.x = pose.weapon ? -0.45 + swing * 0.25 : swing * 0.65;
    this.rightArm.rotation.z = pose.weapon ? 0.12 : 0;
    this.leftArm.rotation.z = 0;
    this.leftArm.rotation.y = this.rightArm.rotation.y = 0;
    if (this.swimBlend > 0.001) {
      const stroke = Math.sin(this.swimPhase), recovery = Math.cos(this.swimPhase);
      const kick = Math.sin(this.swimKickPhase);
      const tread = 1 - this.stride;
      const amount = this.swimBlend;
      // Moving arms reach forward relative to the pitched torso. Idle arms
      // spread at the waterline so sculling hands remain visibly connected.
      const reach = -0.4 * tread + (-Math.PI / 2 - swimPitch) * this.stride;
      const sweep = (0.22 * tread + this.stride * (0.72 + fastSwim * 0.25)) * stroke;
      this.leftArm.rotation.x += (reach - sweep - this.leftArm.rotation.x) * amount;
      this.rightArm.rotation.x += (reach + sweep - this.rightArm.rotation.x) * amount;
      this.leftArm.rotation.z = (-0.42 - tread - recovery * (0.1 + this.stride * 0.27)) * amount;
      this.rightArm.rotation.z = (0.42 + tread + recovery * (0.1 + this.stride * 0.27)) * amount;
      this.leftArm.rotation.y = recovery * 0.3 * amount;
      this.rightArm.rotation.y = -recovery * 0.3 * amount;
      this.leftLeg.rotation.x = (-0.2 + kick * kickRange) * amount + swing * (1 - amount);
      this.rightLeg.rotation.x = (-0.2 - kick * kickRange) * amount - swing * (1 - amount);
    }
    if (pose.throwAiming && !down && pose.roll <= 0) {
      this.rightArm.rotation.set(-2.35, 0, .12);
      this.rightForearm.quaternion.identity();
      this.rightHand.quaternion.copy(this.oneHandGrip);
      this.body.rotation.y = 0;
    } else if (pose.throwRelease !== undefined && !down && pose.roll <= 0) {
      this.rightArm.rotation.set(-2.35 + 1.9 * smoothPhase(pose.throwRelease), 0, .12);
      this.body.rotation.y = Math.sin(Math.PI * pose.throwRelease) * .4;
    } else if (pose.attack > 0 && !aimed) {
      const windup = Math.sin(Math.PI * pose.attack);
      this.rightArm.rotation.x = -0.45 - windup * 1.45;
      this.body.rotation.y = windup * 0.4;
    } else this.body.rotation.y = 0;
    if (pose.roll > 0) {
      this.body.rotation.x = pose.roll * Math.PI * 2;
    }
    const landingAge = (pose.jumpAge ?? -1) - .5;
    const landing = !pose.swimming && landingAge >= 0 && landingAge < .24 ? Math.sin(landingAge / .24 * Math.PI) : 0;
    const anticipation = !pose.swimming && pose.jumpAge !== undefined && pose.jumpAge >= 0 && pose.jumpAge < .055
      ? Math.sin(pose.jumpAge / .055 * Math.PI) : 0;
    this.body.rotation.x += landing * .12 + anticipation * .08;
    this.leftLeg.rotation.x -= landing * .18; this.rightLeg.rotation.x -= landing * .18;
    const kneeBend = (pose.crouching ? .98 : 0) + (action?.kind === 'gather' ? action.weight * .8 : 0) + landing * .2;
    if (!pose.swimming && !down) {
      this.leftLeg.rotation.x -= kneeBend; this.rightLeg.rotation.x -= kneeBend;
      this.leftKnee.rotation.x = this.rightKnee.rotation.x = kneeBend * 2;
    }
    if (this.lifeAmount > 0) {
      this.body.rotation.set(this.body.rotation.x * (1 - this.lifeAmount), 0, Math.PI / 2 * this.lifeAmount);
      this.leftLeg.rotation.x = -.35 * this.lifeAmount; this.rightLeg.rotation.x = -.6 * this.lifeAmount;
      this.leftArm.rotation.set(-.7 * this.lifeAmount, 0, -.3 * this.lifeAmount);
      this.rightArm.rotation.set(-.5 * this.lifeAmount, 0, .4 * this.lifeAmount);
      this.leftKnee.rotation.x = this.rightKnee.rotation.x = .6 * this.lifeAmount;
      this.head.rotation.z = -.12 * this.lifeAmount;
    }
    const landBob = Math.abs(Math.cos(this.phase)) * this.stride * 0.055 + Math.sin(time * 2) * 0.009;
    const swimBob = Math.sin(time * 2.7) * (0.042 - this.stride * 0.02) + Math.sin(time * 4.1) * 0.01;
    const anchorHeight = ((1.08 + landBob - (pose.crouching ? 0.35 : 0)) * (1 - this.swimBlend) + (0.055 + swimBob) * this.swimBlend
      + pose.jump * 0.9 + (pose.roll > 0 ? 0.25 : 0) - landing * .1 - anticipation * .07 - (action?.kind === 'gather' ? action.weight * .22 : 0)) * (1 - this.lifeAmount) + .3 * this.lifeAmount;
    // Pitch/yaw act around the chest waterline, never the feet. The world X/Z
    // center therefore stays fixed through every swimming direction and pose.
    this.anchorCorrection.set(0, 1.08, 0).applyEuler(this.body.rotation);
    this.body.position.set(-this.anchorCorrection.x, anchorHeight - this.anchorCorrection.y, -this.anchorCorrection.z);
    this.weapon.visible = this.lifeAmount < .25 && (!action || action.kind.startsWith('fish-'));
    const flame = this.torchFlame;
    const swimmingWithTorch = Boolean(flame) && pose.swimming && !pose.dead && pose.roll <= 0;
    const socket = swimmingWithTorch || this.weapon.userData.primaryHand === 'left' ? this.leftHandSocket : this.handSocket;
    if (this.weapon.parent !== socket) socket.add(this.weapon);
    if (this.swimBlend < .1 && !down && this.lifeAmount < .01 && pose.roll <= 0 && !pose.throwAiming && (!action || action.kind.startsWith('fish-'))) {
      this.updateWeaponGrip(grip, pose, draw);
    }
    this.actionProps.visible = Boolean(action && ['eat', 'drink', 'bandage'].includes(action.kind));
    if (action) this.updateInteraction(action);
    if (this.lifeAmount > .001 || pose.crouching || action?.kind === 'gather' || landing > 0) this.groundBody();
    if (swimmingWithTorch) {
      // Solve a fixed raised hand from the current shoulder, compensating for
      // torso pitch and the ground-depth scale. The other arm still swims.
      this.body.updateWorldMatrix(true, true);
      this.leftArm.getWorldPosition(this.swimTorchTarget);
      this.swimTorchOutward.set(-1, 0, 0).transformDirection(this.root.matrixWorld);
      this.swimTorchOutward.y = 0; this.swimTorchOutward.normalize();
      this.swimTorchTarget.addScaledVector(this.swimTorchOutward, .12).addScaledVector(UP, .43);
      this.torso.worldToLocal(this.swimTorchTarget);
      this.swimTorchBodyInverse.copy(this.torso.matrixWorld).invert();
      this.flameUp.copy(UP).transformDirection(this.swimTorchBodyInverse);
      this.gripOrientation.setFromUnitVectors(UP, this.flameUp);
      this.armSolver.solve(this.leftArm, this.leftForearm, this.leftHand, this.swimTorchTarget, this.leftPole, this.gripOrientation);
    }
    if (flame) {
      flame.visible = pose.torchLit === true && !down && this.lifeAmount < .01 && this.weapon.visible;
      if (flame.visible) {
        // The shaft can lean in the hand; fire still rises with world gravity.
        this.weapon.updateWorldMatrix(true, false);
        this.flameFrameInverse.copy(this.weapon.matrixWorld).invert();
        this.flameUp.copy(UP).transformDirection(this.flameFrameInverse);
        flame.quaternion.setFromUnitVectors(UP, this.flameUp);
      }
      flame.children.forEach((part, i) => {
        part.scale.y = part.userData.baseHeight * (.94 + Math.sin(time * 10 + i * 2.4) * .13);
        part.rotation.z = Math.sin(time * 7 + i) * .1;
      });
    }
    const projectile = this.weapon.getObjectByName('loaded-projectile');
    if (projectile) projectile.visible = pose.loaded === true && !this.bowReleased && !(shotAge >= .012 && shotAge < .2);
    const flash = this.muzzleFlash;
    if (flash) {
      flash.visible = !down && this.weapon.visible && shotAge >= 0 && shotAge < .065;
      flash.scale.setScalar(.7 + recoilEnvelope(shotAge) * .5);
    }
    for (const name of ['bow-string-upper', 'bow-string-lower']) {
      const string = this.weapon.getObjectByName(name);
      if (!string) continue;
      const tipY = string.userData.tipY as number, tipZ = string.userData.tipZ as number, nockZ = bowNockZ(draw);
      this.stringDirection.set(0, -tipY, nockZ - tipZ);
      string.position.set(0, tipY / 2, (tipZ + nockZ) / 2);
      string.scale.y = this.stringDirection.length();
      string.quaternion.setFromUnitVectors(UP, this.stringDirection.normalize());
      if (projectile) projectile.position.z = nockZ;
    }
    const projectileOrigin = this.weapon.getObjectByName('projectile-origin');
    if (projectileOrigin) projectileOrigin.position.z = bowNockZ(draw);
    this.root.userData.animation = { state: down ? pose.dead ? 'death' : 'knockdown' : this.lifeAmount > .001 ? 'get-up' : pose.throwAiming ? 'throw-aim' : pose.throwRelease !== undefined ? 'throw-release' : action?.kind ?? 'locomotion', lifeAmount: this.lifeAmount, landing, shotAge, reloadProgress: pose.reloadProgress, bowDraw: draw };
  }

  private updateWeaponGrip(grip: GripStyle | undefined, pose: SurvivorPose, draw: number): void {
    const stroke = Math.sin(Math.PI * pose.attack);
    this.gripEuler.set(0, 0, 0);
    if (grip === 'pistol') this.gripPosition.set(.31, 1.1, .46);
    else if (grip === 'longgun') this.gripPosition.set(.14, 1.1, .28);
    else if (grip === 'bow') this.gripPosition.set(-.02, 1.13, .49);
    else if (grip === 'staff') {
      const thrust = this.weapon.userData.attackMotion === 'thrust';
      this.gripPosition.set(thrust ? .06 : .03, thrust ? 1.01 : 1.11, thrust ? .3 + stroke * .14 : .37);
      this.gripEuler.x = this.carryPitch + (thrust ? stroke * (1.35 - this.carryPitch) : 0);
    } else {
      // A fixed grip, not a second weapon animation. The arm carries the whole
      // weapon up/down through the swing, including its blade and handle.
      this.rightHand.quaternion.copy(this.oneHandGrip);
      return;
    }
    const recoil = recoilEnvelope(pose.shotAge ?? Infinity);
    if (this.muzzleFlash) { this.gripPosition.z -= recoil * .11; this.gripEuler.x -= recoil * .13; }
    const reload = pose.reloadProgress === undefined ? undefined : reloadHandPhase(pose.reloadProgress);
    if (reload && (grip === 'longgun' || grip === 'pistol')) {
      this.gripPosition.y -= reload.lower * .12;
      this.gripEuler.set(-reload.lower * .38, reload.lower * -.12, reload.lower * -.24);
    } else if (pose.reloading && grip === 'longgun') this.gripEuler.z = -.2;
    this.gripOrientation.setFromEuler(this.gripEuler);
    if (grip === 'pistol' || grip === 'longgun' || grip === 'bow') {
      // Crouching/stride pitch belongs to the torso. Keep the aiming frame
      // horizontal in the same direction as the authoritative ground aim.
      this.bodyInverse.copy(this.body.quaternion).multiply(this.torso.quaternion).invert();
      this.gripOrientation.premultiply(this.bodyInverse);
    }
    const primaryLeft = grip === 'bow';
    this.armSolver.solve(primaryLeft ? this.leftArm : this.rightArm, primaryLeft ? this.leftForearm : this.rightForearm,
      primaryLeft ? this.leftHand : this.rightHand, this.gripPosition, primaryLeft ? this.leftPole : this.rightPole, this.gripOrientation);
    if (grip === 'staff' && this.weapon.userData.attackMotion !== 'thrust') {
      // Solve the ready grip once, then swing that entire arm chain rigidly.
      // The other hand follows the weapon socket rather than steering it.
      this.swingRotation.setFromAxisAngle(this.swingAxis, -stroke * .9);
      this.rightArm.quaternion.premultiply(this.swingRotation);
      this.gripOrientation.premultiply(this.swingRotation);
    }
    const support = this.weapon.getObjectByName('support-grip');
    if (!support && !reload) return;
    // Get the actual clamped primary wrist, then solve the other hand directly
    // onto the model socket. Root turns/crouching cannot separate the grip.
    this.body.updateWorldMatrix(true, true);
    if (support) { support.getWorldPosition(this.supportPosition); this.torso.worldToLocal(this.supportPosition); }
    else this.supportPosition.set(.25, .98, .34);
    if (grip === 'bow') this.supportPosition.z += BOW_GEOMETRY.drawLength * (1 - draw);
    if (reload) {
      this.supportPosition.lerp(this.actionTarget.set(-.24, .65, .1), reload.pocket);
      this.supportPosition.lerp(this.actionTarget.set(.11, 1.05, .41), reload.rack);
    }
    this.supportOrientation.copy(this.gripOrientation);
    if (grip === 'longgun') this.supportOrientation.multiply(this.foregripRotation);
    this.armSolver.solve(primaryLeft ? this.rightArm : this.leftArm, primaryLeft ? this.rightForearm : this.leftForearm,
      primaryLeft ? this.rightHand : this.leftHand, this.supportPosition, primaryLeft ? this.rightPole : this.leftPole, this.supportOrientation);
  }

  private updateInteraction(action: InteractionPose): void {
    const weight = clamp01(action.weight), phase = action.progress;
    this.body.updateWorldMatrix(true, true); this.rightHand.getWorldPosition(this.actionRest); this.torso.worldToLocal(this.actionRest);
    this.actionProps.children.forEach(prop => { prop.visible = prop.name === `${action.kind}-prop`; });
    this.actionOrientation.identity();
    if (action.kind === 'gather') {
      this.actionTarget.set(.22, 1.05 - weight * .4, .2 + weight * .3);
      this.head.rotation.x = weight * .28;
    } else if (action.kind === 'eat' || action.kind === 'drink') {
      this.actionTarget.set(.22 - weight * .12, 1.0 + weight * .37, .25 + weight * .09);
      this.actionOrientation.setFromAxisAngle(new Vector3(1, 0, 0), action.kind === 'drink' ? -weight * .9 : -weight * .25);
      this.head.rotation.x = action.kind === 'drink' ? -weight * .13 : weight * .06;
    } else if (action.kind === 'bandage') {
      this.actionTarget.set(-.16, .98 + Math.sin(phase * Math.PI * 8) * .035, .32);
      this.armSolver.solve(this.leftArm, this.leftForearm, this.leftHand, this.supportPosition.set(-.27, .98, .34), this.leftPole, this.actionOrientation);
      this.head.rotation.x = .15 * weight;
    } else {
      // A cast winds behind the shoulder before the forward flick. The reel
      // hand circles beside the rod; the other hand keeps its primary grip.
      const cast = action.kind === 'fish-cast' ? Math.sin(Math.PI * phase) : 0;
      this.rightArm.rotation.x -= cast * 1.1;
      this.body.rotation.y = cast * -.18;
      if (action.kind === 'fish-cast') {
        const support = this.weapon.getObjectByName('support-grip');
        if (support) {
          this.body.updateWorldMatrix(true, true); support.getWorldPosition(this.actionTarget); this.torso.worldToLocal(this.actionTarget);
          this.armSolver.solve(this.leftArm, this.leftForearm, this.leftHand, this.actionTarget, this.leftPole, this.gripOrientation);
        }
      }
      if (action.kind === 'fish-reel') {
        this.actionTarget.set(-.04 + Math.cos(phase * Math.PI * 10) * .055, 1.02 + Math.sin(phase * Math.PI * 10) * .055, .32);
        this.armSolver.solve(this.leftArm, this.leftForearm, this.leftHand, this.actionTarget, this.leftPole, this.actionOrientation);
      }
      return;
    }
    this.actionTarget.lerp(this.actionRest, 1 - weight);
    this.armSolver.solve(this.rightArm, this.rightForearm, this.rightHand, this.actionTarget, this.rightPole, this.actionOrientation);
  }

  /** Ground the anatomy, excluding carried items and temporary action props. */
  private groundBody(): void {
    this.root.updateWorldMatrix(true, true); this.root.getWorldPosition(this.groundOrigin); this.bounds.makeEmpty();
    this.body.traverse(object => {
      if (!(object instanceof Mesh)) return;
      for (let parent: Object3D | null = object; parent && parent !== this.body; parent = parent.parent) {
        if (parent === this.weapon || parent === this.actionProps) return;
      }
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      this.partBounds.copy(object.geometry.boundingBox!).applyMatrix4(object.matrixWorld); this.bounds.union(this.partBounds);
    });
    this.body.position.y += this.groundOrigin.y - this.bounds.min.y;
  }
}
