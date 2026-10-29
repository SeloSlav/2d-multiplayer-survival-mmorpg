import { Group, Vector3 } from 'three/webgpu';
import { ModelKit, COLORS as C } from './modelKit';
import { createWeapon, resolveWeaponName } from './weaponModels';
import { seededRandom } from './visualContract';
import { createMemoryShard } from './memoryShardModels';

export const COASTAL_DROP_MODELS=['Coral Fragments','Sea Glass','Shell','Shell Fragment','Aleut Charm','Rusty Hook','Reed Water Bottle','Old Boot'] as const;
export function droppedModelCacheKey(name:string,seed:number):string {
  if(name==='Memory Shard')return 'Memory Shard';
  return COASTAL_DROP_MODELS.includes(name as typeof COASTAL_DROP_MODELS[number])?`${name}:${seed%4}`:resolveWeaponName(name)||'loot-sack';
}
export function createDroppedModel(kit:ModelKit,name:string,seed:number):Group {
  if(name==='Memory Shard'){const shard=createMemoryShard(kit,true);shard.userData.itemName=name;return shard;}
  const g=new Group(),random=seededRandom(seed+137);
  if(name==='Coral Fragments'){
    for(let i=0;i<5;i++){
      const x=(random()-.5)*.54,z=(random()-.5)*.42,angle=random()*6.28;
      const end=new Vector3(x+Math.cos(angle)*.25,.08+random()*.08,z+Math.sin(angle)*.24);
      const start=new Vector3(x,.045,z),middle=start.clone().lerp(end,.55).add(new Vector3(0,.07,0));
      kit.branch(g,i%2?0xcbbba6:0xe0d5bd,[start,middle,end],[.045,.055,.034],7);
      const fork=middle.clone().add(new Vector3(Math.sin(angle)*.13,.04,-Math.cos(angle)*.14));
      kit.beam(g,0xd5c6ad,middle,fork,.031);
      for(let p=0;p<3;p++)kit.part(g,'rock',0x9e9686,[.017,.008,.019],[middle.x+(random()-.5)*.06,middle.y+.05,middle.z+(random()-.5)*.05]);
    }
  }else if(name==='Sea Glass'){
    for(let i=0;i<4;i++){const shard=kit.part(g,'rock',[0x8cbbb1,0x6f9f98,0xa6bbb2][i%3],[.18,.055,.14],[(i-1.5)*.1,.035,(random()-.5)*.18]);shard.rotation.y=random()*6;}
  }else if(name==='Shell'||name==='Shell Fragment'){
    const count=name==='Shell'?1:3;
    for(let i=0;i<count;i++){
      const shell=new Group();shell.position.set((i-(count-1)/2)*.17,.035,0);shell.rotation.y=i*.8;
      kit.part(shell,'rock',0xdbcdb5,[.32,.12,.27],[0,.035,0]);
      for(let rib=0;rib<7;rib++){const angle=(rib/6-.5)*2.5;kit.beam(shell,0xb3a68e,new Vector3(0,.085,-.1),new Vector3(Math.sin(angle)*.15,.09,Math.cos(angle)*.13),.012);}
      g.add(shell);
    }
  }else if(name==='Rusty Hook'){
    const points=Array.from({length:9},(_,i)=>{const a=i/8*Math.PI*1.7;return new Vector3(Math.sin(a)*.14,.035,Math.cos(a)*.14);});
    kit.branch(g,0x8f6549,points,points.map((_,i)=>i===8?.008:.025),6);
  }else if(name==='Aleut Charm'){
    kit.part(g,'rock',C.bone,[.19,.06,.29],[0,.055,0]);for(let i=0;i<3;i++)kit.part(g,'box',C.woodDark,[.1,.009,.014],[0,.086,-.07+i*.055]);
    const ring=kit.vessel(g,C.leather,.14,.14,.015,.015,12);ring.rotation.x=Math.PI/2;ring.position.set(0,.02,-.17);
  }else if(name==='Reed Water Bottle'){
    kit.vessel(g,0x9a8152,.12,.09,.025,.35,10);for(let y=.04;y<.34;y+=.05)kit.part(g,'cylinder',C.woodDark,[.245,.015,.245],[0,y,0]);
    kit.part(g,'cylinder',C.wood,[.12,.045,.12],[0,.37,0]);
  }else if(name==='Old Boot'){
    kit.part(g,'rock',0x4f473c,[.3,.12,.43],[0,.065,.06]);kit.vessel(g,0x73664d,.1,.13,.03,.24,8).position.set(0,.1,-.065);
    kit.part(g,'box',0x3a3a32,[.3,.035,.43],[0,.025,.06]);
  }else if(resolveWeaponName(name)){
    const weapon=createWeapon(kit,name),hidden:Group[]=[];
    weapon.traverse(o=>{if(!o.visible)hidden.push(o as Group);});hidden.forEach(o=>o.removeFromParent());
    weapon.rotation.x=Math.PI/2;weapon.rotation.z=-.5;weapon.scale.setScalar(.55);weapon.position.y=.09;g.add(weapon);
  }else{
    // Other item families retain a real cloth loot sack until individually
    // authored. Never substitute a UI item icon or a magenta world marker.
    kit.part(g,'rock',0x948468,[.38,.32,.33],[0,.14,0]);kit.part(g,'cylinder',0x6e644d,[.13,.075,.13],[0,.32,0]);
    kit.beam(g,C.leather,new Vector3(-.1,.315,0),new Vector3(.11,.315,.02),.019);
  }
  const root=kit.compileColored(kit.compile(g));root.userData.itemName=name;return root;
}
