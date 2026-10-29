import type { DepthTexture, DirectionalLight } from 'three/webgpu';
import { float, positionWorld, texture, vec2 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

const DISK = [[0, 0], [-.65, -.35], [.55, -.5], [-.25, .75], [.8, .25], [-.9, .3], [.2, -.9], [.4, .8], [-.5, -.8]] as const;
interface FilterInputs { depthTexture: DepthTexture; shadowCoord: Node<'vec3'> }

/** One sun shadow. A bounded world-stable PCF kernel spreads with receiver depth. */
export function configureWaterShadows(light: DirectionalLight): void {
  const shadow = light.shadow as typeof light.shadow & { filterNode: (params: FilterInputs) => Node<'float'> };
  shadow.filterNode = ({ depthTexture, shadowCoord }) => {
    const radius = positionWorld.y.negate().max(0).mul(1.4).add(1.15);
    const texel = vec2(1 / shadow.mapSize.x, 1 / shadow.mapSize.y).mul(radius);
    let sum = float(0).add(0);
    for (const [x, y] of DISK) {
      // Three's compare node evaluates to float; r186's declaration retains vec4.
      const comparison = texture(depthTexture, shadowCoord.xy.add(texel.mul(vec2(x, y)))).compare(shadowCoord.z) as unknown as Node<'float'>;
      sum = sum.add(comparison);
    }
    return sum.div(DISK.length);
  };
}
