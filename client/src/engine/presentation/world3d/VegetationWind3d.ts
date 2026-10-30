import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, float, mix, positionLocal, sin, uniform, vec3 } from 'three/tsl';

/** One shared material retains instancing. Wind weights are authored in model
 * space; the deformation runs after the instance transform, in scene space. */
export class VegetationWind3d {
  readonly material = new MeshStandardNodeMaterial({ color: 0xffffff, roughness: .92, flatShading: true });
  private readonly clock = uniform(0);
  private readonly strength = uniform(.35);
  private readonly diagnostic = uniform(0);
  get intensity(): number { return this.strength.value; }

  constructor() {
    const data = attribute('windData', 'vec4');
    const phase = positionLocal.x.mul(.17).add(positionLocal.z.mul(.11));
    const gust = sin(this.clock.mul(.63).add(phase.mul(.35))).mul(.5).add(.5).pow(3);
    const primary = sin(this.clock.mul(1.25).add(phase)).add(sin(this.clock.mul(2.13).add(phase.mul(.7))).mul(.28));
    const bend = primary.mul(data.x).mul(data.w).mul(this.strength).mul(gust.mul(.65).add(.35));
    // The petiole's flutter weight is exactly zero. Each leaf's phase comes
    // from its original attachment, keeping its two sides moving together.
    const flutter = sin(this.clock.mul(7.4).add(data.z)).mul(data.y).mul(this.strength).mul(.025);
    this.material.positionNode = positionLocal.add(vec3(bend.add(flutter), 0, bend.mul(.36).sub(flutter.mul(.4))));
    this.material.colorNode = mix(attribute('color', 'vec3'), vec3(data.x, data.y, float(1).sub(data.x)), this.diagnostic);
  }

  update(seconds: number, rainIntensity = 0, storm = false, diagnostic = false): void {
    this.clock.value = Math.max(0, seconds);
    this.strength.value = storm ? 1.15 : .3 + Math.max(0, Math.min(1, rainIntensity)) * .55;
    this.diagnostic.value = Number(diagnostic);
  }

  dispose(): void { this.material.dispose(); }
}
