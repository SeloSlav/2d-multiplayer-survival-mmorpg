import { Group, Vector3 } from 'three/webgpu';
import { COLORS as C, ModelKit } from './modelKit';

/** Existing variant-6 red/white navigation buoy, with a separately switched LED. */
export function createBuoy(kit: ModelKit): Group {
  const root = new Group(), body = new Group();
  kit.vessel(body, 0x484e4b, .93, .93, .23, .26, 12).position.y = -.13;
  kit.part(body, 'cylinder', 0x5b6259, [1.5, .16, 1.5], [0, .05, 0]);
  for (let i = 0; i < 4; i++) {
    const bottom = .14 + i * .59, r = .73 - i * .085;
    kit.branch(body, i % 2 ? 0xd0d7ca : 0xb44e42,
      [new Vector3(0, bottom, 0), new Vector3(0, bottom + .6, 0)], [r, r - .085], 12);
  }
  const railing = kit.vessel(body, 0xa8463b, .46, .46, .032, .055, 12); railing.position.y = 2.78;
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    kit.beam(body, 0x963e36, new Vector3(Math.sin(a) * .46, 2.48, Math.cos(a) * .46), new Vector3(Math.sin(a) * .46, 2.81, Math.cos(a) * .46), .018);
  }
  kit.part(body, 'cylinder', 0x953d35, [.28, .35, .28], [0, 2.65, 0]);
  kit.part(body, 'rock', 0xb6c9c3, [.19, .22, .19], [0, 2.94, 0]);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    kit.part(body, 'box', C.iron, [.1, .47, .14], [Math.sin(a) * .86, .08, Math.cos(a) * .86]).rotation.y = a;
  }
  root.add(kit.compile(body));
  const beacon = new Group(); beacon.name = 'buoy-led'; beacon.position.y = 2.94;
  kit.part(beacon, 'rock', 0xf05d4d, [.205, .23, .205], [0, 0, 0], true);
  beacon.visible = false; root.add(beacon); root.userData.buoy = true; return root;
}

export function floatingPose(time: number, x: number, y: number): { height: number; roll: number; pitch: number } {
  return { height: Math.sin(time * 1.5 + x * .02) * .036,
    roll: Math.sin(time * .8 + x * .01) * .015 + Math.sin(time * .6 + y * .01 + Math.PI * .5) * .0075,
    pitch: Math.sin(time * .67 + y * .013) * .009 };
}
