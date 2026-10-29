import { Group, Mesh, Vector3 } from 'three/webgpu';
import { ModelKit } from './modelKit';

/** Dark, fractured archive glass with the cyan edges and magenta circuit from
 * the existing memory shard icon. Geometry remains a solid 3D object. */
export function createMemoryShard(kit:ModelKit, pickup=false):Group {
  const parts=new Group();
  const axes=[new Vector3(-.08,.04,0),new Vector3(-.06,.32,0),new Vector3(.05,.78,0),new Vector3(.19,1.12,0)];
  kit.branch(parts,0x253358,axes,[.17,.29,.20,.012],5);
  kit.branch(parts,0x33446e,[new Vector3(-.15,.13,-.04),new Vector3(-.23,.36,-.04),new Vector3(-.14,.67,-.05)],[.11,.15,.01],5);
  kit.branch(parts,0x3b4e75,[new Vector3(.08,.13,-.06),new Vector3(.19,.36,-.06),new Vector3(.26,.66,-.06)],[.09,.13,.008],5);
  const edge=(a:[number,number,number],b:[number,number,number],color:number,radius=.012)=>{
    // The low camera sees the upper/front facet. Lift the thin inlays along
    // that view-facing surface so they are not buried inside the dark glass.
    const surface=(p:[number,number,number])=>new Vector3(p[0],p[1]+.12,p[2]+.22);
    const mesh=kit.beam(parts,color,surface(a),surface(b),radius);
    const material=kit.material(color,true);material.emissiveIntensity=.7;
    mesh.material=material;mesh.castShadow=false;mesh.receiveShadow=false;
  };
  // Faceted trace on the camera-facing side and a fractured pink core.
  edge([-.17,.22,.15],[-.1,.45,.24],0x68add0,.012);
  edge([-.1,.45,.24],[.02,.67,.18],0x68add0,.013);
  edge([.02,.67,.18],[.17,1.01,.055],0x68add0,.011);
  edge([-.1,.45,.24],[.10,.44,.20],0x68add0,.01);
  edge([.10,.44,.20],[.02,.25,.16],0xe85cb8,.012);
  edge([.02,.25,.16],[.16,.33,.13],0xe85cb8,.021);
  edge([.16,.33,.13],[.21,.42,.09],0xe85cb8,.018);
  const model=kit.compile(parts);
  model.traverse(o=>{if(o instanceof Mesh && (o.material as {emissive?:{getHex:()=>number}}).emissive?.getHex())o.castShadow=o.receiveShadow=false;});
  model.scale.setScalar(pickup ? .8 : 1.15);
  model.userData.memoryShard=true;model.userData.memoryShardKind=pickup?'pickup':'resource';
  return model;
}

/** The separate minable memory node follows its grey-rock / blue-crystal icon. */
export function createMemoryOre(kit:ModelKit):Group {
  const parts=new Group();
  kit.part(parts,'rock',0x667482,[1.65,1.2,1.35],[0,.55,0]);
  for(let i=0;i<9;i++){
    const a=i*2.399, x=Math.sin(a)*.55, z=Math.cos(a)*.43;
    const base=new Vector3(x,.66,z), tip=new Vector3(x*1.5,.95+(i%3)*.16,z*1.5);
    const crystal=kit.branch(parts,i%2?0x4d9ec6:0x267aa9,[base,base.clone().lerp(tip,.6),tip],[.16,.13,.006],5);
    crystal.material=kit.material(i%2?0x4d9ec6:0x267aa9,true);crystal.castShadow=false;
  }
  const model=kit.compile(parts);model.userData.memoryOre=true;return model;
}
