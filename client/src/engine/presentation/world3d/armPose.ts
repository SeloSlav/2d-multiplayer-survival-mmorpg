import { Group, Quaternion, Vector3 } from 'three/webgpu';

export const ARM_SEGMENT_LENGTH = .31;
const DOWN = new Vector3(0, -1, 0);

/** Analytic two-bone solve in the torso's coordinate frame. The pole owns the
 * elbow bend, and wrist compensation keeps the weapon's authored frame. */
export class ArmPoseSolver {
  private readonly axis = new Vector3();
  private readonly bend = new Vector3();
  private readonly joint = new Vector3();
  private readonly direction = new Vector3();
  private readonly inverse = new Quaternion();

  solve(upper: Group, forearm: Group, wrist: Group, target: Vector3, pole: Vector3, orientation: Quaternion): void {
    this.axis.copy(target).sub(upper.position);
    const distance = Math.min(ARM_SEGMENT_LENGTH * 2 - 1e-5, Math.max(1e-5, this.axis.length()));
    this.axis.normalize();
    this.bend.copy(pole).sub(upper.position);
    this.bend.addScaledVector(this.axis, -this.bend.dot(this.axis));
    if (this.bend.lengthSq() < 1e-8) this.bend.set(upper.position.x < 0 ? -1 : 1, 0, 0);
    this.bend.normalize();
    const half = distance / 2, height = Math.sqrt(Math.max(0, ARM_SEGMENT_LENGTH ** 2 - half ** 2));
    this.joint.copy(upper.position).addScaledVector(this.axis, half).addScaledVector(this.bend, height);
    this.direction.copy(this.joint).sub(upper.position).normalize();
    upper.quaternion.setFromUnitVectors(DOWN, this.direction);
    this.inverse.copy(upper.quaternion).invert();
    // Use the clamped endpoint so unreachable targets never stretch bones.
    this.direction.copy(upper.position).addScaledVector(this.axis, distance).sub(this.joint).normalize().applyQuaternion(this.inverse);
    forearm.quaternion.setFromUnitVectors(DOWN, this.direction);
    this.inverse.copy(upper.quaternion).multiply(forearm.quaternion).invert();
    wrist.quaternion.copy(this.inverse).multiply(orientation);
  }
}
