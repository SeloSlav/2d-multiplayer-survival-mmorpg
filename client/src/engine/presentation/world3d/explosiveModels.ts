import { Group, Vector3 } from 'three/webgpu';
import { ModelKit, COLORS as C } from './modelKit';

export function createPlacedExplosive(kit: ModelKit, heavy: boolean): Group {
  const body = new Group();
  if (heavy) {
    kit.part(body, 'box', 0x596866, [.85, .46, .65], [0, .24, 0]);
    for (const x of [-.3, .3]) kit.part(body, 'box', C.iron, [.06, .49, .68], [x, .25, 0]);
    kit.part(body, 'box', 0xa95e45, [.27, .025, .25], [0, .486, .02]);
    for (const x of [-.38, .38]) for (const z of [-.26, .26]) kit.part(body, 'rock', C.steel, [.045, .045, .045], [x, .48, z]);
  } else {
    kit.part(body, 'rock', 0x9f8562, [.72, .43, .57], [0, .22, 0]);
    for (const x of [-.16, .16]) kit.part(body, 'box', C.leather, [.045, .4, .58], [x, .22, 0]);
    kit.part(body, 'box', C.leather, [.68, .045, .04], [0, .37, 0]);
  }
  kit.branch(body, C.coal, [new Vector3(0, .4, 0), new Vector3(.06, .57, 0), new Vector3(.17, .61, .025)], [.018, .018, .012], 5);
  const root = kit.compileColored(kit.compile(body));
  root.name = heavy ? 'matriarch-wrath' : 'babushka-surprise';
  const fuse = new Group(); fuse.name = 'explosive-fuse'; fuse.position.set(.17, .61, .025);
  for (let i = 0; i < 3; i++) kit.part(fuse, 'rock', i ? 0xffa352 : 0xffe4a3, [.05, .07, .05], [(i - 1) * .025, i * .035, 0], true);
  root.add(fuse); return root;
}
