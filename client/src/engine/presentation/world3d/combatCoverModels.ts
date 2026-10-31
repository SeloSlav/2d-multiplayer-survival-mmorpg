import { Color, Group, Vector3 } from 'three/webgpu';
import { ModelKit } from './modelKit';
import { combatCoverProfile } from '../../../config/combatCover';
import { seededRandom } from './visualContract';

/** Waist-high natural cover, dimensioned from the shared collision contract.
 * The renderer stretches ground depth like every other authoritative prop. */
export function createCombatCover(kit: ModelKit, variant: number): Group {
  const profile = combatCoverProfile(variant);
  if (!profile) throw new Error(`Unknown combat cover ${variant}`);
  const root = new Group(); root.name = profile.name;
  const w=profile.width/48, d=profile.depth/48, h=profile.height/48;
  const random=seededRandom(73021+variant);
  const shade=(factor:number)=>new Color(profile.color).multiplyScalar(factor).getHex();
  if (profile.material === 'wood') {
    // Fallen old-growth trunk with split sapwood, bark ridges and broken limbs.
    const trunk=kit.part(root,'cylinder',profile.color,[h*.9,w*.94,d*.9],[0,h*.46,0]);
    trunk.rotation.z=Math.PI/2;
    for(const side of [-1,1]) {
      const cap=kit.part(root,'cylinder',variant===8?0xc6b58d:0xb69563,[h*.77,.025,d*.77],[side*w*.475,h*.46,0]);
      cap.rotation.z=Math.PI/2;
      for(let ring=0;ring<3;ring++) {
        const heart=kit.part(root,'cylinder',ring%2?shade(.77):0x99805a,
          [h*(.56-ring*.13),.028,d*(.56-ring*.13)],[side*(w*.475+.018+ring*.004),h*.46,0]);
        heart.rotation.z=Math.PI/2;
      }
    }
    for(let i=0;i<12;i++) {
      const angle=i/12*Math.PI*2, y=h*.46+Math.cos(angle)*h*.43, z=Math.sin(angle)*d*.43;
      kit.beam(root,shade(i%3===0?.7:1.07),new Vector3(-w*.43,y,z),new Vector3(w*.43,y+(random()-.5)*.055,z),.025+random()*.025);
    }
    for(const side of [-1,1]) {
      kit.branch(root,shade(.78),[new Vector3(side*w*.26,h*.6,0),new Vector3(side*w*.35,h*.83,side*d*.26),new Vector3(side*w*.38,h*.98,side*d*.31)],[.14,.095,.055],7);
    }
    if(variant===7) for(let i=0;i<6;i++) kit.part(root,'rock',i%2?0x63734a:0x7c8750,
      [.45,.12,.29],[-w*.34+i*w*.13,h*.88,(random()-.5)*d*.32]);
  } else {
    // Overlapping fractured slabs form a continuous shield with broken edges.
    for(let i=0;i<5;i++) {
      const x=(i-2)*w*.15, height=h*(i===2?1:.78+random()*.16);
      const rock=kit.part(root,'rock',shade(.82+random()*.25),[w*.40,height*1.12,d*.98],[x,height*.48,0]);
      rock.rotation.y=(random()-.5)*.25;
    }
    for(let i=0;i<8;i++) kit.part(root,'rock',shade(.65+random()*.3),[.28,.2,.25],
      [(random()-.5)*w*.9,.1,(i%2?1:-1)*d*.38]);
    if(variant===10) for(let i=0;i<4;i++) kit.part(root,'rock',0xd6ded8,[.57,.10,.38],
      [(i-1.5)*w*.19,h*(i===1||i===2?.89:.76),0]);
    if(variant===9) for(let i=0;i<4;i++) kit.part(root,'rock',0x90915e,[.32,.07,.28],
      [(i-1.5)*w*.21,h*.69,-.14]);
  }
  const result=kit.compileColored(root); result.name=profile.name;
  return result;
}
