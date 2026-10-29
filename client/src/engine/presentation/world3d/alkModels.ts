import { Group, Vector3 } from 'three/webgpu';
import { ModelKit } from './modelKit';

export type AlkAsset = 'station'|'central'|'warehouse'|'barracks'|'fuel_depot'|'garage'|'shed'|'compost'|'food'|'weapons'|'furnace'|'water';
interface AlkPlan { width:number; depth:number; height:number; shell:number; trim:number; accent:number; roof:'flat'|'dome'|'tank'|'stack'; front:'door'|'service'|'vault'; }

/** Dimensions are ground-space tiles, centered on the existing collision anchor. */
export const ALK_PLANS:Record<AlkAsset,AlkPlan>={
  station:{width:7.1,depth:3.2,height:3.5,shell:0x515c65,trim:0x86979c,accent:0x7dd8da,roof:'flat',front:'service'},
  central:{width:7.1,depth:3.2,height:4.1,shell:0x515c65,trim:0x99a9ac,accent:0x8de3dc,roof:'stack',front:'service'},
  warehouse:{width:7,depth:3.1,height:3.3,shell:0x806e65,trim:0xb1a39a,accent:0x8edbda,roof:'dome',front:'door'},
  barracks:{width:5.5,depth:3.0,height:4.2,shell:0x66554d,trim:0x8f7770,accent:0xd9a665,roof:'stack',front:'door'},
  fuel_depot:{width:5.1,depth:2.9,height:3.8,shell:0x514d51,trim:0x956654,accent:0xd6a764,roof:'tank',front:'door'},
  garage:{width:4.5,depth:2.9,height:3.5,shell:0x75564b,trim:0xa4836a,accent:0xe0ae6e,roof:'stack',front:'service'},
  shed:{width:3.8,depth:2.7,height:3.6,shell:0x4d4d55,trim:0x9c6b59,accent:0x82d0d5,roof:'tank',front:'door'},
  compost:{width:7.0,depth:3.1,height:3.1,shell:0x56636a,trim:0xa4b9b5,accent:0xd09a62,roof:'stack',front:'service'},
  food:{width:7.0,depth:3.1,height:3.2,shell:0x454f58,trim:0x84979a,accent:0xefad68,roof:'flat',front:'service'},
  weapons:{width:7.0,depth:3.1,height:3.1,shell:0x414a55,trim:0x758b91,accent:0x72c5c9,roof:'flat',front:'vault'},
  furnace:{width:7.0,depth:3.1,height:3.2,shell:0x5a5955,trim:0x899395,accent:0xe8934b,roof:'stack',front:'service'},
  water:{width:7.0,depth:3.1,height:3.2,shell:0x8195a0,trim:0xb5c4c4,accent:0x67e1ee,roof:'tank',front:'service'},
};

/** Emit a closed industrial shell, visible façade bays and roof equipment.
 * Details are compiled per material so scene complexity stays bounded. */
export function createAlkBuilding(kit:ModelKit,asset:AlkAsset):Group {
  const p=ALK_PLANS[asset],g=new Group(),w=p.width,d=p.depth,h=p.height,front=d/2;
  const part=(color:number,size:[number,number,number],pos:[number,number,number],emissive=false)=>kit.part(g,'box',color,size,pos,emissive);
  part(0x343e45,[w,.16,d],[0,.08,0]);
  part(p.shell,[w-.2,h-.22,d-.2],[0,h/2,0]);
  part(p.trim,[w+.06,.18,d+.06],[0,h-.12,0]);
  // Articulated parapets, roof plates and service seams give the silhouettes
  // depth from the elevated game camera and keep large surfaces readable.
  for(const x of [-w/2+.18,w/2-.18])part(p.shell,[.34,.30,d+.04],[x,h+.07,0]);
  for(const z of [-d/2+.13,d/2-.13])part(p.shell,[w-.45,.23,.22],[0,h+.05,z]);
  for(let i=0;i<6;i++){
    const x=-w*.39+i*w*.155;
    part(i%2?0x64747a:p.trim,[w*.14,.045,d*.60],[x,h+.015,-d*.05]);
  }
  for(const x of [-w*.46,w*.46])for(let i=0;i<3;i++)
    part(0x3c4950,[.06,.32,d*.24],[x,h*.24+i*h*.23,-d*.23]);
  for(const x of [-w/2+.16,w/2-.16])part(p.trim,[.22,h-.25,.22],[x,h/2,front-.04]);
  // The front-facing bays are raised geometry, never painted-on UI sprites.
  for(let i=0;i<5;i++){
    const x=-w*.4+i*w*.2;
    part(0x35424a,[w*.17,h*.27,.10],[x,h*.70,front+.015]);
    part(p.trim,[w*.17,.045,.13],[x,h*.56,front+.08]);
    if(i!==2)part(p.accent,[w*.11,.06,.035],[x,h*.70,front+.09],true);
  }
  const opening=p.front==='service'?w*.36:w*.27;
  part(0x202a30,[opening,h*.44,.14],[0,h*.25,front+.08]);
  for(const x of [-opening/2-.10,opening/2+.10])part(p.trim,[.16,h*.48,.20],[x,h*.25,front+.15]);
  part(p.trim,[opening+.36,.16,.22],[0,h*.50,front+.15]);
  if(p.front==='vault'){
    kit.part(g,'cylinder',0x95a4a4,[opening*.7,.12,opening*.7],[0,h*.26,front+.18]).rotation.x=Math.PI/2;
    part(0x36474c,[opening*.55,.10,.16],[0,h*.26,front+.27]);
  } else if(p.front==='service'){
    for(let i=0;i<4;i++)part(p.trim,[opening*.9,.045,.08],[0,h*.12+i*h*.085,front+.18]);
  }
  // Control panels are physical surface modules, with inset screen and bezel.
  const panelX=w*.32;
  part(p.trim,[.53,.82,.16],[panelX,h*.29,front+.18]);
  part(0x26343b,[.41,.42,.05],[panelX,h*.33,front+.28]);
  for(let i=0;i<3;i++)part(p.accent,[.30,.035,.025],[panelX,h*.25+i*.11,front+.32],true);
  if(asset==='central'||asset==='station'){
    part(0x28383f,[w*.32,.48,.14],[w*.18,h*.85,front+.12]);
    // A compact, geometric ALK insignia, visible without a text sprite.
    for(let i=0;i<3;i++){
      const x=w*.08+i*.37;
      part(p.accent,[.09,.30,.04],[x,h*.85,front+.22],true);
      part(p.accent,[.25,.055,.04],[x+.09,h*.94,front+.22],true);
    }
  }
  // Pipework runs over the roof and down the exposed left façade.
  for(let i=0;i<3;i++){
    const x=-w*.33+i*.20;
    kit.beam(g,0x303b43,new Vector3(x,h+.08,-d*.4),new Vector3(x,h+.08,front+.12),.055);
    kit.beam(g,0x303b43,new Vector3(x,h+.08,front+.12),new Vector3(x,h*.45,front+.12),.055);
  }
  for(const x of [-w*.40,w*.40]){
    part(0x303c43,[.52,.72,.18],[x,h*.28,front+.13]);
    for(let i=0;i<4;i++)part(p.trim,[.40,.035,.035],[x,h*.13+i*.13,front+.24]);
  }
  if(p.roof==='stack'){
    part(p.shell,[w*.23,.65,d*.34],[w*.24,h+.27,-d*.12]);
    kit.part(g,'cylinder',p.trim,[.34,1.15,.34],[w*.26,h+.95,-d*.14]);
    kit.part(g,'cylinder',0x303a40,[.46,.13,.46],[w*.26,h+1.55,-d*.14]);
  } else if(p.roof==='tank'){
    kit.part(g,'cylinder',p.trim,[w*.42,.95,w*.42],[0,h+.48,-.1]);
    kit.part(g,'cylinder',p.shell,[w*.44,.15,w*.44],[0,h+.99,-.1]);
    kit.part(g,'cylinder',p.trim,[w*.20,.18,w*.20],[0,h+1.12,-.1]);
  } else if(p.roof==='dome'){
    kit.part(g,'cylinder',0x667f7a,[w*.53,.12,w*.53],[0,h+.1,-.1]);
    kit.part(g,'cylinder',0x68503c,[.32,1.3,.32],[0,h+.75,-.1]);
    for(let i=0;i<7;i++){
      const a=i*Math.PI*2/7;
      kit.part(g,'rock',i%2?0x6f965f:0x527d4d,[1.05,.85,1.05],[Math.cos(a)*.65,h+1.45+Math.sin(i)*.18,Math.sin(a)*.65-.1]);
      kit.beam(g,0x94c3bf,new Vector3(Math.cos(a)*1.6,h+.12,Math.sin(a)*1.6-.1),new Vector3(Math.cos(a)*.35,h+2.25,Math.sin(a)*.35-.1),.035);
    }
  } else {
    part(0x3b474d,[w*.35,.35,d*.25],[w*.19,h+.12,-d*.2]);
    for(let i=0;i<4;i++)part(p.trim,[w*.31,.035,.035],[w*.19,h+.34,-d*.28+i*.13]);
  }
  if(asset==='water'||asset==='compost'||asset==='furnace'){
    const x=-w*.28,z=-d*.18;
    kit.part(g,'cylinder',p.trim,[.85,.76,.85],[x,h+.4,z]);
    kit.part(g,'cylinder',0x35464b,[.92,.09,.92],[x,h+.80,z]);
    kit.beam(g,0x364850,new Vector3(x,h+.45,z),new Vector3(x-.62,h+.45,z),.08);
  }
  if(['warehouse','barracks','fuel_depot','garage','shed'].includes(asset)){
    for(let i=0;i<9;i++){
      const x=-w*.48+(i%3)*.17,y=.35+Math.floor(i/3)*.38;
      kit.part(g,'rock',i%2?0x668454:0x476a48,[.28,.32,.18],[x,y,front+.20]);
    }
  }
  const result=kit.compile(g);result.name=`alk-${asset}`;result.userData.alkAsset=asset;result.userData.alkPlan=p;
  if(asset==='furnace'){
    const fire=new Group();fire.name='fire';fire.position.set(0,.48,front+.26);
    for(let i=0;i<3;i++){
      const flame=kit.part(fire,'cone',i===1?0xffe083:0xf47b39,[.18,.42,.12],[(i-1)*.20,.18,0],true);
      flame.userData.baseHeight=.42;
    }
    result.add(fire);
  }
  return result;
}

/** Two distinct defensive machines with a solid plinth and raised barrel. */
export function createAlkTurret(kit:ModelKit,monument:boolean):Group {
  const g=new Group(),base=monument?2.8:1.25,body=monument?0x667c84:0x755443;
  kit.part(g,'cylinder',0x303c42,[base,.32,base],[0,.16,0]);
  kit.part(g,'cylinder',0x87979a,[base*.77,.18,base*.77],[0,.41,0]);
  kit.part(g,'cylinder',body,[base*.55,.68,base*.55],[0,.78,0]);
  kit.part(g,'box',body,[base*.58,.65,base*.65],[0,1.2,0]);
  for(const x of [-base*.17,base*.17]){
    kit.beam(g,0x2c353a,new Vector3(x,1.16,base*.25),new Vector3(x,1.16,base*.85),monument?.09:.06);
    kit.part(g,'cylinder',0x9ca9a5,[.22,.18,.22],[x,1.16,base*.82]).rotation.x=Math.PI/2;
  }
  kit.part(g,'box',0x78d6d7,[base*.18,.18,.05],[0,1.35,base*.34],true);
  const result=kit.compile(g);result.name=monument?'alk-turret':'steam-turret';return result;
}
