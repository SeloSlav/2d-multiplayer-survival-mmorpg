import { Euler, Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { COLORS as C, ModelKit } from './modelKit';
import { createWeapon } from './weaponModels';
import type { GripStyle } from './weaponModels';
import { ARM_SEGMENT_LENGTH, ArmPoseSolver } from './armPose';
import { restingWeaponPitch } from './weaponCarry';

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
  yaw: number;
  weapon: string;
  torchLit?: boolean;
  loaded?: boolean;
  reloading?: boolean;
}

/** Articulated solid-mesh survivor. Every limb rotates around its anatomical root. */
export class SurvivorRig {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly head = new Group();
  private readonly leftArm = new Group();
  private readonly rightArm = new Group();
  private readonly leftForearm = new Group();
  private readonly rightForearm = new Group();
  private readonly leftHand = new Group();
  private readonly rightHand = new Group();
  private readonly leftLeg = new Group();
  private readonly rightLeg = new Group();
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
  readonly waterAnchor = new Object3D();

  get unfinishedWeapon(): string | undefined { return this.weapon.userData.unfinishedWeapon; }
  get torchFlame(): Group | undefined { return this.weapon.getObjectByName('held-torch-flame') as Group | undefined; }

  constructor(private readonly kit: ModelKit, coat: number = C.dress) {
    const part = kit.part.bind(kit);
    this.body.name = 'survivor-body';
    this.root.add(this.body);
    this.waterAnchor.name = 'swim-center';
    this.waterAnchor.position.y = 1.08;
    this.body.add(this.waterAnchor);
    this.body.add(this.head, this.leftArm, this.rightArm, this.leftLeg, this.rightLeg);
    part(this.body, 'rock', coat, [0.64, 0.7, 0.4], [0, 1.02, 0]);
    part(this.body, 'skirt', coat, [0.75, 0.42, 0.59], [0, 0.63, 0]);
    part(this.body, 'box', C.apron, [0.36, 0.39, 0.045], [0, 0.93, 0.193]);
    part(this.body, 'box', C.apron, [0.45, 0.24, 0.045], [0, 0.64, 0.23]);
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
    part(this.body, 'rock', C.scarfShadow, [0.55, 0.19, 0.39], [0, 1.28, 0]);
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
    for (const [limb, sign] of [[this.leftLeg, -1], [this.rightLeg, 1]] as const) {
      limb.position.set(sign * 0.135, 0.75, 0);
      part(limb, 'box', 0x485450, [0.21, 0.49, 0.23], [0, -0.24, 0]);
      part(limb, 'box', C.leather, [0.24, 0.2, 0.37], [0, -0.64, 0.06]);
    }
  }

  update(pose: SurvivorPose, dt: number, time: number): void {
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
    if (pose.attack > 0 && !aimed) {
      const windup = Math.sin(Math.PI * pose.attack);
      this.rightArm.rotation.x = -0.45 - windup * 1.45;
      this.body.rotation.y = windup * 0.4;
    } else this.body.rotation.y = 0;
    if (pose.roll > 0) {
      this.body.rotation.x = pose.roll * Math.PI * 2;
    }
    const landBob = Math.abs(Math.cos(this.phase)) * this.stride * 0.055 + Math.sin(time * 2) * 0.009;
    const swimBob = Math.sin(time * 2.7) * (0.042 - this.stride * 0.02) + Math.sin(time * 4.1) * 0.01;
    const anchorHeight = (1.08 + landBob - (pose.crouching ? 0.35 : 0)) * (1 - this.swimBlend) + (0.055 + swimBob) * this.swimBlend
      + pose.jump * 0.9 + (pose.roll > 0 ? 0.25 : 0);
    // Pitch/yaw act around the chest waterline, never the feet. The world X/Z
    // center therefore stays fixed through every swimming direction and pose.
    this.anchorCorrection.set(0, 1.08, 0).applyEuler(this.body.rotation);
    this.body.position.set(-this.anchorCorrection.x, anchorHeight - this.anchorCorrection.y, -this.anchorCorrection.z);
    if (pose.dead) {
      this.body.rotation.z = Math.PI / 2;
      this.body.position.y = 0.34;
    }
    const flame = this.torchFlame;
    const swimmingWithTorch = Boolean(flame) && pose.swimming && !pose.dead && pose.roll <= 0;
    const socket = swimmingWithTorch || this.weapon.userData.primaryHand === 'left' ? this.leftHandSocket : this.handSocket;
    if (this.weapon.parent !== socket) socket.add(this.weapon);
    if (this.swimBlend < .1 && !pose.dead && pose.roll <= 0) {
      this.updateWeaponGrip(grip, pose);
    }
    if (swimmingWithTorch) {
      // Solve a fixed raised hand from the current shoulder, compensating for
      // torso pitch and the ground-depth scale. The other arm still swims.
      this.body.updateWorldMatrix(true, true);
      this.leftArm.getWorldPosition(this.swimTorchTarget);
      this.swimTorchOutward.set(-1, 0, 0).transformDirection(this.root.matrixWorld);
      this.swimTorchOutward.y = 0; this.swimTorchOutward.normalize();
      this.swimTorchTarget.addScaledVector(this.swimTorchOutward, .12).addScaledVector(UP, .43);
      this.body.worldToLocal(this.swimTorchTarget);
      this.swimTorchBodyInverse.copy(this.body.matrixWorld).invert();
      this.flameUp.copy(UP).transformDirection(this.swimTorchBodyInverse);
      this.gripOrientation.setFromUnitVectors(UP, this.flameUp);
      this.armSolver.solve(this.leftArm, this.leftForearm, this.leftHand, this.swimTorchTarget, this.leftPole, this.gripOrientation);
    }
    if (flame) {
      flame.visible = pose.torchLit === true && !pose.dead;
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
    if (projectile) projectile.visible = pose.loaded === true;
  }

  private updateWeaponGrip(grip: GripStyle | undefined, pose: SurvivorPose): void {
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
    if (pose.reloading && grip === 'longgun') this.gripEuler.z = -.2;
    this.gripOrientation.setFromEuler(this.gripEuler);
    if (grip === 'pistol' || grip === 'longgun' || grip === 'bow') {
      // Crouching/stride pitch belongs to the torso. Keep the aiming frame
      // horizontal in the same direction as the authoritative ground aim.
      this.bodyInverse.copy(this.body.quaternion).invert();
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
    if (!support) return;
    // Get the actual clamped primary wrist, then solve the other hand directly
    // onto the model socket. Root turns/crouching cannot separate the grip.
    this.body.updateWorldMatrix(true, true);
    support.getWorldPosition(this.supportPosition);
    this.body.worldToLocal(this.supportPosition);
    this.supportOrientation.copy(this.gripOrientation);
    if (grip === 'longgun') this.supportOrientation.multiply(this.foregripRotation);
    this.armSolver.solve(primaryLeft ? this.rightArm : this.leftArm, primaryLeft ? this.rightForearm : this.leftForearm,
      primaryLeft ? this.rightHand : this.leftHand, this.supportPosition, primaryLeft ? this.rightPole : this.leftPole, this.supportOrientation);
  }
}
