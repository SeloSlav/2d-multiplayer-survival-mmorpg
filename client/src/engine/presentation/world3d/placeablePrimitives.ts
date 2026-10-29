import { Group, Vector3 } from 'three/webgpu';
import { COLORS as C, ModelKit } from './modelKit';

/** An actual hollow ring, with closed wall wedges rather than a painted opening. */
export function ring(kit: ModelKit, group: Group, color: number, radius: number, thickness: number,
  bottom: number, top: number, segments = 12, skipFront = false): void {
  for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2;
    const b = (i + 1) / segments * Math.PI * 2;
    const mid = (a + b) / 2;
    if (skipFront && Math.sin(mid) > 0.68) continue;
    kit.prism(group, color, [
      [Math.cos(a) * radius, Math.sin(a) * radius], [Math.cos(b) * radius, Math.sin(b) * radius],
      [Math.cos(b) * (radius - thickness), Math.sin(b) * (radius - thickness)],
      [Math.cos(a) * (radius - thickness), Math.sin(a) * (radius - thickness)],
    ], bottom, top);
  }
}

export function tableFrame(kit: ModelKit, group: Group, width: number, depth: number, height: number, top: number = C.wood): void {
  for (const x of [-width * 0.39, width * 0.39]) for (const z of [-depth * 0.36, depth * 0.36]) {
    kit.part(group, 'box', C.woodDark, [0.12, height, 0.12], [x, height / 2, z]);
  }
  for (let i = 0; i < 5; i++) kit.part(group, 'box', i % 2 ? top : C.wood, [width, 0.095, depth / 5 - 0.012], [0, height, -depth / 2 + (i + 0.5) * depth / 5]);
  kit.part(group, 'box', C.woodDark, [width * 0.85, 0.1, 0.1], [0, height * 0.4, 0]);
}

export function cauldron(kit: ModelKit): Group {
  const group = new Group();
  kit.part(group, 'cylinder', C.iron, [0.86, 0.1, 0.86], [0, 0.14, 0]);
  ring(kit, group, C.iron, 0.47, 0.07, 0.15, 0.64, 12);
  ring(kit, group, C.steel, 0.49, 0.055, 0.61, 0.67, 12);
  const contents = new Group();
  contents.name = 'pot-contents';
  kit.part(contents, 'cylinder', 0x807d42, [0.79, 0.025, 0.79], [0, 0, 0]);
  contents.position.y = 0.52;
  group.add(contents);
  for (const sign of [-1, 1]) {
    kit.beam(group, C.iron, new Vector3(sign * 0.43, 0.5, -0.14), new Vector3(sign * 0.6, 0.48, 0), 0.025);
    kit.beam(group, C.iron, new Vector3(sign * 0.6, 0.48, 0), new Vector3(sign * 0.43, 0.5, 0.14), 0.025);
  }
  return group;
}

export function fireAssembly(kit: ModelKit, height = 0.6, radius = 0.18, color: number = C.flame): Group {
  const fire = new Group();
  fire.name = 'fire';
  fire.userData.lightColor = color;
  for (let i = 0; i < 5; i++) {
    const angle = i * 2.4;
    const flame = kit.part(fire, 'cone', i % 2 || color !== C.flame ? color : C.ember,
      [radius, height * (0.8 + i * 0.07), radius], [Math.cos(angle) * radius * 0.6, height * 0.4, Math.sin(angle) * radius * 0.6], true);
    flame.userData.baseHeight = flame.scale.y;
  }
  return fire;
}
