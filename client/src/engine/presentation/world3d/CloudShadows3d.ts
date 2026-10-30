import { Color, Vector2, Vector3, Vector4 } from 'three/webgpu';
import { float, max, min, positionWorld, sin, smoothstep, uniform, vec2 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import { GROUND_Y_SCALE, WORLD_3D } from './visualContract';

interface Cloud { currentRenderPosX: number; currentRenderPosY: number; width: number; height: number; rotationDegrees: number; currentOpacity: number }
const LIMIT = 12;
/** Low-cost ground projection of the same interpolated clouds used by the 2D world. */
export class CloudShadows3d {
  private readonly shapes = Array.from({ length: LIMIT }, () => uniform(new Vector4(0, 0, 1, 1)));
  private readonly properties = Array.from({ length: LIMIT }, () => uniform(new Vector4()));
  private readonly lightColor = uniform(new Color(0xffffff));
  private readonly lightSlope = uniform(new Vector2());

  /** Modulate only the celestial direct light; ambient, fire and emissive light remain independent. */
  readonly directLight = this.lightColor.mul(this.factor(vec2(
    positionWorld.x.sub(positionWorld.y.mul(this.lightSlope.x)),
    positionWorld.z.sub(positionWorld.y.mul(this.lightSlope.y)).div(GROUND_Y_SCALE),
  )));

  setLight(color:Color,intensity:number,direction:Vector3):void {
    this.lightColor.value.copy(color).multiplyScalar(intensity);
    this.lightSlope.value.set(direction.x / direction.y,direction.z / direction.y);
  }

  factor(p: Node<'vec2'>) {
    let shade = float(0).add(0);
    for (let i = 0; i < LIMIT; i++) {
      const shape = this.shapes[i], props = this.properties[i];
      const delta = p.sub(shape.xy);
      const local = vec2(delta.x.mul(props.x).add(delta.y.mul(props.y)), delta.y.mul(props.x).sub(delta.x.mul(props.y))).div(shape.zw);
      // Overlapping lobes make a soft irregular footprint without a screen-space overlay.
      const r = local.length().add(sin(local.x.mul(9).add(sin(local.y.mul(7)))).mul(.045));
      shade = max(shade, float(1).sub(smoothstep(.58, 1, r)).mul(props.z));
    }
    return float(1).sub(min(shade, .5));
  }

  update(clouds: unknown, centerX: number, centerY: number, enabled: boolean): void {
    const candidates = enabled && clouds instanceof Map ? [...clouds.values()] as Cloud[] : [];
    candidates.sort((a, b) => Math.hypot(a.currentRenderPosX - centerX, a.currentRenderPosY - centerY) - Math.hypot(b.currentRenderPosX - centerX, b.currentRenderPosY - centerY));
    for (let i = 0; i < LIMIT; i++) {
      const c = candidates[i];
      if (!c || !Number.isFinite(c.currentRenderPosX) || !Number.isFinite(c.currentRenderPosY) || c.width <= 0 || c.height <= 0) { this.properties[i].value.set(1, 0, 0, 0); continue; }
      const angle = (c.rotationDegrees || 0) * Math.PI / 180;
      this.shapes[i].value.set(c.currentRenderPosX / WORLD_3D.tilePixels, c.currentRenderPosY / WORLD_3D.tilePixels, c.width * .75 / WORLD_3D.tilePixels, c.height * .75 / WORLD_3D.tilePixels);
      this.properties[i].value.set(Math.cos(angle), Math.sin(angle), Math.min(.5, Math.max(0, c.currentOpacity * 2)), 0);
    }
  }
}
