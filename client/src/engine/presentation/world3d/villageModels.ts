import { Group, Matrix4, Vector3 } from 'three/webgpu';
import { ModelKit, COLORS as C } from './modelKit';
import { gableRoof, profileAcrossWidth } from './architecturePrimitives';
import { createCampfire } from './environmentModels';
import { seededRandom } from './visualContract';
import { VILLAGE_BUILDINGS } from './villagePlans';
import type { VillageBuildingPlan } from './villagePlans';
import type { GroundPoint } from './buildingPlan';
import { CutawayEnvelope } from './CutawayEnvelope';

const V=(x:number,y:number,z:number)=>new Vector3(x,y,z);
function beam(kit:ModelKit,g:Group,c:number,a:number[],b:number[],r=.06):void{kit.beam(g,c,new Vector3(...a as [number,number,number]),new Vector3(...b as [number,number,number]),r);}

function compileFixtures(kit:ModelKit,source:Group):Group {
  source.updateMatrixWorld(true);const inverse=new Matrix4().copy(source.matrixWorld).invert(),rotors:Group[]=[],animated:Group[]=[];
  source.traverse(o=>{if(o.name==='village-turbine'||o.name==='village-wind-rotor')rotors.push(o as Group);});
  for(const rotor of rotors){
    const local=new Matrix4().multiplyMatrices(inverse,rotor.matrixWorld),assembly=rotor.clone(true);
    assembly.position.set(0,0,0);assembly.rotation.set(0,0,0);assembly.scale.setScalar(1);
    const packed=kit.compileColored(kit.compile(assembly));packed.name=rotor.name;local.decompose(packed.position,packed.quaternion,packed.scale);
    animated.push(packed);rotor.removeFromParent();
  }
  const result=kit.compileColored(kit.compile(source));if(animated.length)result.add(...animated);return result;
}

function floorAndFurniture(kit:ModelKit,g:Group,p:VillageBuildingPlan):void {
  for(let i=0;i<Math.ceil(p.width/.35);i++){
    const count=Math.ceil(p.width/.35),step=p.width/count;
    const x=-p.width/2+(i+.5)*step,depth=p.form==='round'?p.depth*Math.sqrt(Math.max(.02,1-(x/(p.width/2))**2)):p.depth;
    kit.part(g,'box',i%3?0x554735:0x6b583e,[step-.008,.065,depth],[x,.035,0]);
  }
  const table=new Group();table.position.set(-p.width*.26,0,-p.depth*.18);
  kit.part(table,'box',p.trim,[1.25,.1,.72],[0,.72,0]);
  for(const x of [-.48,.48])for(const z of [-.23,.23])kit.part(table,'cylinder',p.wood,[.12,.65,.12],[x,.36,z]);
  kit.part(table,'cylinder',C.bone,[.27,.035,.27],[.3,.8,0]);kit.part(table,'box',C.cloth,[.38,.025,.3],[-.24,.8,0]);g.add(table);
  kit.part(g,'rock',0x6f785c,[1.1,.15,1.8],[p.width*.27,.13,-p.depth*.2]);
  kit.part(g,'rock',0xa69b7a,[.8,.13,.36],[p.width*.27,.22,-p.depth*.2-.6]);
  const stool=kit.part(g,'cylinder',p.wood,[.54,.38,.54],[-p.width*.25,.25,p.depth*.2]);stool.rotation.y=.2;
}

function plankWalls(kit:ModelKit,shell:Group,p:VillageBuildingPlan):void {
  const front=p.depth/2,half=p.width/2,door=.63,top=p.eave;
  if(p.form==='round'){
    for(let i=0;i<28;i++){
      const a=i/28*Math.PI*2;if(i<2||i>26)continue;
      const panel=kit.part(shell,'box',i%4?p.wood:p.roofLight,[p.width*Math.PI/28+.02,p.eave,.13],[Math.sin(a)*half,p.eave/2,Math.cos(a)*front]);panel.rotation.y=a;
    }
    for(const sign of [-1,1])beam(kit,shell,p.trim,[sign*.6,0,front],[sign*.6,1.25,front*.93],.1);
    kit.part(shell,'rock',0xa48f73,[1.02,1.12,.07],[0,.57,front+.015]);
    return;
  }
  for(const side of [-1,1]){
    const count=Math.ceil(p.depth/.25);
    for(let i=0;i<count;i++){
      if(p.family==='ruin'&&i%6===1)continue;
      kit.part(shell,'box',i%3?p.wood:p.trim,[.13,top,p.depth/count-.012],[side*half,top/2,-front+(i+.5)*p.depth/count]);
    }
  }
  for(const side of [-1,1]){
    const z=side*front,count=Math.ceil(p.width/.24);
    for(let i=0;i<count;i++){
      const x=-half+(i+.5)*p.width/count;
      const height=p.form==='vault'?p.eave+p.rise*Math.sqrt(Math.max(0,1-(x/(half+.23))**2))-.1:top;
      const doorway=Math.min(1.95,p.form==='vault'?p.eave+p.rise*.8:top);
      const bottom=side>0&&Math.abs(x)<door?doorway:0;
      if(height<=bottom+.01)continue;
      if(p.family==='ruin'&&i%7===2)continue;
      kit.part(shell,'box',i%4?p.wood:p.trim,[p.width/count-.008,height-bottom,.14],[x,(height+bottom)/2,z]);
    }
    if(side<0||p.form!=='vault')kit.part(shell,'box',p.trim,[p.width+.16,.14,.2],[0,top-.03,z]);
  }
  for(const x of [-half,half])for(const z of [-front,front])kit.part(shell,'cylinder',p.trim,[.23,top+.25,.23],[x,top/2,z]);
  const doorTop=Math.min(1.95,p.form==='vault'?p.eave+p.rise*.8:top);
  for(const sign of [-1,1])kit.part(shell,'box',p.trim,[.17,doorTop,.23],[sign*door,doorTop/2,front+.04]);
  kit.part(shell,'box',p.trim,[door*2+.2,.18,.25],[0,doorTop,front+.04]);
  // Gable infill follows the pitched roof, leaving an actual doorway below.
  if(p.form==='gable')for(const side of [-1,1]){
    const poly:GroundPoint[]=[[-half,top],[0,top+p.rise],[half,top],[half,top-.1],[-half,top-.1]];
    const end=new Group();profileAcrossWidth(kit,end,p.wood,poly,.15);end.rotation.y=Math.PI/2;end.position.z=side*front;shell.add(end);
  }
}

function roofAssembly(kit:ModelKit,g:Group,p:VillageBuildingPlan):void {
  const roof=new Group(),span=p.width+.45,length=p.depth+.48;
  if(p.form==='round'){
    const dome=new Group();dome.scale.z=p.depth/p.width;
    for(let i=0;i<9;i++){
      const a=i/9,b=(i+1)/9;
      const radius=(t:number)=>span/2*Math.sqrt(Math.max(.003,1-t*t));
      const shell=kit.vessel(dome,i%3?p.roof:p.roofLight,radius(a),radius(b),.1,p.rise/9+.02,14);shell.position.y=p.eave+a*p.rise;
    }
    kit.part(dome,'rock',p.roofLight,[.48,.16,.48],[0,p.eave+p.rise,0]);roof.add(dome);
  }else if(p.form==='vault'){
    const profile:GroundPoint[]=[],inside:GroundPoint[]=[];
    for(let i=0;i<=12;i++){const x=-span/2+span*i/12,y=p.eave+p.rise*Math.sqrt(Math.max(0,1-(x/(span/2))**2));profile.push([x,y]);inside.push([x,y-.18]);}
    profileAcrossWidth(kit,roof,p.roof,[...profile,...inside.reverse()],length);roof.rotation.y=Math.PI/2;
  }else{
    gableRoof(kit,roof,p.roof,length,span,p.eave,p.rise,.15);roof.rotation.y=Math.PI/2;
  }
  g.add(roof);
  const height=(x:number)=>p.eave+p.rise*(p.form==='gable'?Math.max(0,1-Math.abs(x)/(span/2)):Math.sqrt(Math.max(0,1-(x/(span/2))**2)));
  const random=seededRandom(Math.floor(p.width*217+p.depth*113));
  if(p.form!=='round')for(let x=-span/2+.12;x<span/2;x+=.27){
    const y=height(x),piece=new Group();
    if(p.family==='fishing'&&p.form==='gable'||p.family==='ruin'){
      for(let j=0;j<4;j++){
        if(p.family==='ruin'&&Math.floor(x*10+j)%6===0)continue;
        const plank=kit.part(piece,'box',random()<.2?p.roofLight:p.roof,[.265,.055,length/4+.05],[x,y+.055,-length/2+(j+.5)*length/4]);
        plank.rotation.z=(x<0?1:-1)*Math.atan2(p.rise,span/2);
      }
    }else for(let z=-length/2+.13;z<length/2;z+=.42){
      const snow=p.snow&&(Math.abs(x)<span*.31||random()<.3);
      const tuft=kit.part(piece,'rock',snow?0xd3e4e3:random()>.5?p.roof:p.roofLight,[.42,.12+random()*.07,.58],[x,y+.07,z]);tuft.rotation.y=random()*.5;
    }
    g.add(piece);
  }
  if(p.snow){
    const cap=new Group(),upper:GroundPoint[]=[],lower:GroundPoint[]=[];
    for(let i=0;i<=12;i++){const x=-span*.33+span*.66*i/12;upper.push([x,height(x)+.115]);lower.push([x,height(x)+.025]);}
    profileAcrossWidth(kit,cap,0xd6e5e5,[...upper,...lower.reverse()],length*.98);cap.rotation.y=Math.PI/2;g.add(cap);
  }
  if(p.form==='round'){
    // Scattered sod growth breaks the concentric construction seams; ribs wrap
    // the actual round volume instead of suggesting a rectangular tent frame.
    for(let ring=1;ring<=4;ring++)for(let i=0;i<18;i++){
      const r=ring/4*.92,a=(i+random()*.35)/18*Math.PI*2,x=Math.sin(a)*span/2*r,z=Math.cos(a)*p.depth/2*r;
      const tuft=kit.part(g,'rock',random()<.3?p.roofLight:p.roof,[.4,.08,.35],[x,p.eave+p.rise*Math.sqrt(1-r*r)+.07,z]);tuft.rotation.y=a;
    }
    for(let i=1;i<8;i++){
      const a=i/8*Math.PI*2,sx=Math.sin(a),sz=Math.cos(a);
      kit.branch(g,p.trim,[V(sx*p.width/2,.04,sz*p.depth/2),V(sx*p.width*.45,p.eave+p.rise*.43,sz*p.depth*.45),V(sx*p.width*.22,p.eave+p.rise*.9,sz*p.depth*.22),V(0,p.eave+p.rise+.12,0)],[.12,.1,.08,.05],7);
    }
    return;
  }
  // Main rafters project beyond the ridge; bone frames follow the authored vault.
  for(const z of [-p.depth/2-.07,p.depth/2+.07])for(const side of [-1,1]){
    if(p.bone){
      const points=[V(side*p.width/2,0,z),V(side*p.width*.42,p.eave+.45,z),V(side*p.width*.19,p.eave+p.rise*.9,z),V(-side*.18,p.eave+p.rise+.22,z)];
      kit.branch(g,p.trim,points,[.14,.12,.1,.065],7);
    }else beam(kit,g,p.trim,[side*p.width/2,p.eave-.08,z],[-side*.18,p.eave+p.rise+.2,z],.1);
  }
  if(p.ladder){
    const x=p.width*.31;
    for(const side of [-1,1])beam(kit,g,p.trim,[x+side*.24,.05,p.depth/2+.14],[x+side*.24,p.eave+p.rise*.82,-p.depth*.23],.035);
    for(let i=0;i<12;i++){const t=i/12;beam(kit,g,p.trim,[x-.24,.2+t*(p.eave+p.rise*.82),p.depth/2+.14-t*p.depth*.73],[x+.24,.2+t*(p.eave+p.rise*.82),p.depth/2+.14-t*p.depth*.73],.028);}
    kit.part(g,'box',0x292c27,[.8,.035,.8],[0,p.eave+p.rise-.1,-p.depth*.17]);
  }
}

function fish(kit:ModelKit,g:Group,x:number,y:number,z:number,color:number=C.coal,scale=1):void {
  kit.part(g,'rock',color,[.6*scale,.2*scale,.09*scale],[x,y,z]);
  const tail=kit.part(g,'cone',color,[.23*scale,.25*scale,.07*scale],[x-.35*scale,y,z]);tail.rotation.z=-Math.PI/2;
}

function ornament(kit:ModelKit,g:Group,lamps:Group,p:VillageBuildingPlan):void {
  const front=p.depth/2+.13;
  if(p.totems)for(const side of [-1,1]){
    const x=side*(p.width/2-.1);kit.part(g,'cylinder',p.wood,[.4,p.eave+1.2,.4],[x,(p.eave+1.2)/2,front]);
    for(let i=0;i<3;i++){
      kit.part(g,'box',0xa37355,[.32,.25,.08],[x,.6+i*.67,front+.2]);
      for(const eye of [-1,1])kit.part(g,'rock',0x555c48,[.07,.07,.055],[x+eye*.09,.65+i*.67,front+.25]);
    }
    const top=V(x,p.eave+1.2,front);for(let i=0;i<3;i++){
      const end=top.clone().add(V((i-1)*.21,.35+Math.abs(i-1)*.15,0));kit.beam(g,0xba7561,top,end,.045);
      kit.beam(g,0xba7561,end.clone().lerp(top,.4),end.clone().add(V(.13,.1,.02)),.025);
    }
    fish(kit,g,side*p.width*.25,1.2,front+.04,0x3f5358,1.2);
  }
  if(p.family==='hunting'){
    for(const side of [-1,1]){
      const hide=kit.part(g,'rock',side<0?0xa68e63:0x7c674e,[.85,1.15,.045],[side*p.width*.32,1.1,front]);hide.rotation.z=side*.12;
      for(let i=0;i<4;i++)beam(kit,g,C.leather,[side*p.width*.32+(i-1.5)*.19,.66,front],[side*p.width*.32+(i-1.5)*.19,.4,front+.02],.012);
    }
  }
  if(p.family==='alpine'){
    for(const side of [-1,1]){
      const x=side*.83;kit.part(g,'cylinder',p.trim,[.29,2.2,.29],[x,1.1,front]);
      for(let j=0;j<5;j++)kit.part(g,'box',p.wood,[.2,.045,.045],[x,.35+j*.31,front+.16]);
    }
  }
  if(p.chimney){
    const x=p.width*.36,z=-p.depth*.15,top=p.eave+p.rise+.2;
    for(let y=.15;y<top;y+=.22)for(const side of [-1,1]){
      kit.part(g,'box',Math.round(y*9)%3?0x797869:0x969382,[.65,.21,.19],[x,y,z+side*.24]);
      kit.part(g,'box',0x6d7065,[.18,.21,.32],[x+side*.24,y,z]);
    }
    kit.part(g,'box',0x222a29,[.38,.03,.36],[x,top-.1,z]);
  }
  if(p.family!=='ruin')for(const side of [-1,1]){
    const window=kit.part(lamps,'cylinder',0xffb965,[.32,.025,.32],[side*p.width*.34,1.55,front+.01],true);window.rotation.x=Math.PI/2;
    const rim=kit.vessel(g,p.trim,.21,.21,.045,.04,10);rim.rotation.x=Math.PI/2;rim.position.set(side*p.width*.34,1.55,front+.025);
  }
  if(p.family==='ruin')for(let i=0;i<8;i++){
    const plank=kit.part(g,'box',i%2?p.trim:p.wood,[.16,.065,1.1],[Math.sin(i*3.7)*p.width*.6,.05,p.depth/2+.3+i*.08]);plank.rotation.y=i*.7;
  }
}

function radar(kit:ModelKit,g:Group,scale=1):void {
  const structure=new Group();structure.scale.setScalar(scale);g.add(structure);
  for(const x of [-1,1])for(const z of [-1,1]){
    beam(kit,structure,C.iron,[x*.95,.02,z*.8],[x*.4,2.8,z*.35],.065);
    beam(kit,structure,C.steel,[x*.95,.25,z*.8],[-x*.4,2.4,z*.35],.027);
  }
  const head=new Group();head.name='village-radar-head';head.position.y=2.8;head.rotation.x=.85;structure.add(head);
  for(let i=0;i<9;i++){
    const r0=i/9*1.6,r1=(i+1)/9*1.6,y0=r0*r0*.32,y1=r1*r1*.32;
    if(i===0)kit.part(head,'cylinder',C.steel,[r1*2,.055,r1*2],[0,y1,0]);
    else{const shell=kit.vessel(head,i%2?0x9eafb1:0xb8c6c4,r0,r1,.035,y1-y0+.015,16);shell.position.y=y0;}
  }
  for(let i=0;i<3;i++){const a=i/3*Math.PI*2;beam(kit,head,C.iron,[Math.cos(a)*1.55,.8,Math.sin(a)*1.55],[0,1.3,0],.035);}
  kit.part(head,'cylinder',C.coal,[.14,.45,.14],[0,1.25,0]);
}

function mast(kit:ModelKit,g:Group,height=4):void {
  for(let i=0;i<3;i++){const a=i/3*Math.PI*2;beam(kit,g,C.steel,[Math.cos(a)*.7,0,Math.sin(a)*.7],[0,height,0],.045);}
  for(const sign of [-1,1])beam(kit,g,C.iron,[0,height*.65,0],[sign*.55,height*.65,.02],.035);
  const rotor=new Group();rotor.name='village-wind-rotor';rotor.position.set(0,height,0);g.add(rotor);
  for(let i=0;i<3;i++){const a=i/3*Math.PI*2;beam(kit,rotor,C.steel,[0,0,0],[Math.cos(a)*.5,0,Math.sin(a)*.5],.025);const cup=kit.vessel(rotor,C.iron,.055,.12,.02,.13,8);cup.position.set(Math.cos(a)*.5,0,Math.sin(a)*.5);}
  kit.part(g,'box',0x909c95,[.22,.32,.2],[.3,height*.6,0]);
}

function station(kit:ModelKit,shell:Group,fixtures:Group,p:VillageBuildingPlan):void {
  kit.part(shell,'box',p.wood,[p.width,p.eave,p.depth],[0,p.eave/2,0]);
  kit.part(shell,'box',p.trim,[p.width+.24,.18,p.depth+.2],[0,p.eave,0]);
  for(let x=-p.width/2+.5;x<p.width/2;x+=1.2){
    kit.part(shell,'box',0x3b4d54,[.78,.8,.08],[x,1.1,p.depth/2+.045]);
    for(const side of [-1,1])kit.part(shell,'box',p.trim,[.06,.9,.12],[x+side*.43,1.1,p.depth/2+.07]);
  }
  for(let x=-2.5;x<=1;x+=1.75)for(let z=-1.6;z<=1;z+=1.7){
    const panel=new Group();panel.position.set(x,p.eave+.4,z);panel.rotation.x=-.3;fixtures.add(panel);
    kit.part(panel,'box',0x243c4b,[1.5,.075,1.35],[0,0,0]);
    for(let j=0;j<5;j++)kit.part(panel,'box',0x718690,[1.5,.015,.012],[0,.045,-.6+j*.3]);
    for(let j=0;j<4;j++)kit.part(panel,'box',0x718690,[.012,.015,1.35],[-.65+j*.43,.045,0]);
  }
  const dish=new Group();dish.position.set(2.5,p.eave,-1.6);radar(kit,dish,.42);fixtures.add(dish);
  for(let i=0;i<3;i++){
    const pole=new Group();pole.position.set(-3+i*2.2,p.eave,-p.depth/2+.15);fixtures.add(pole);
    beam(kit,pole,p.trim,[0,0,0],[0,2.8,0],.055);
    const rotor=new Group();rotor.name='village-turbine';rotor.position.y=2.8;pole.add(rotor);
    kit.part(rotor,'rock',p.trim,[.28,.3,.3],[0,0,0]);
    for(let j=0;j<3;j++){const a=j/3*Math.PI*2;beam(kit,rotor,0xafbfbb,[0,0,0],[Math.sin(a)*.85,Math.cos(a)*.85,0],.045);}
  }
  for(const side of [-1,1])kit.part(shell,'box',p.trim,[.17,2,.2],[side*.7,1,p.depth/2+.13]);
  kit.part(shell,'box',0x243139,[1.2,1.9,.04],[0,.95,p.depth/2+.1]);
}

export function createVillageModel(kit:ModelKit,asset:string):Group {
  const root=new Group(),p=VILLAGE_BUILDINGS[asset];root.userData.villageAsset=asset;
  if(p){
    const center=new Group();center.position.z=-p.depth/2;root.add(center);
    const shell=new Group(),interior=new Group(),lamps=new Group(),fixtures=new Group();
    floorAndFurniture(kit,interior,p);
    if(p.form!=='round')kit.part(interior,'box',0x352f26,[p.width-.25,p.eave-.1,.02],[0,p.eave/2,-p.depth/2+.09]);
    if(p.form==='station')station(kit,shell,fixtures,p);
    else{plankWalls(kit,shell,p);roofAssembly(kit,shell,p);ornament(kit,shell,lamps,p);}
    const skin=kit.compileColored(kit.compile(shell));skin.name='village-shell';center.add(skin,kit.compileColored(kit.compile(interior)));
    const glow=kit.compile(lamps);glow.name='village-lamps';center.add(glow);
    if(glow.children.length)for(const side of [-1,1]){const anchor=new Group();anchor.name='village-window-anchor';anchor.position.set(side*p.width*.34,1.55,p.depth/2+.14);glow.add(anchor);}
    // Keep wind instruments as articulated groups; each fixed assembly is tiny.
    center.add(compileFixtures(kit,fixtures));
    root.userData.villagePlan=p;return root;
  }
  if(asset.endsWith('campfire.png')){const fire=createCampfire(kit,391);fire.userData.villageAsset=asset;return fire;}
  const g=new Group();
  if(asset.includes('drying_rack')){
    for(const x of [-1.3,1.3])for(const z of [-.45,.45])beam(kit,g,C.bark,[x,0,z],[x*.9,2.1,0],.08);
    beam(kit,g,C.barkLight,[-1.55,2.1,0],[1.55,2.1,0],.09);
    for(let i=0;i<6;i++){
      const x=-1.05+i*.42;beam(kit,g,C.leather,[x,2.1,0],[x,1.25,0],.015);
      if(asset.startsWith('hv'))kit.part(g,'rock',i%2?0x998266:0x6a594a,[.4,.67,.06],[x,1.06,0]);
      else{const item=new Group();fish(kit,item,0,0,0,0xa89977,.75);item.rotation.z=Math.PI/2;item.position.set(x,1.15,0);g.add(item);}
    }
  }else if(asset==='scarecrow.png'){
    beam(kit,g,C.bark,[0,0,0],[0,2.7,0],.065);beam(kit,g,C.bark,[-.9,1.8,0],[.9,1.8,0],.05);
    kit.part(g,'rock',0x7c6b49,[.6,.75,.3],[0,1.55,0]);kit.part(g,'rock',0xb6a77b,[.35,.42,.3],[0,2.15,0]);
    kit.part(g,'cone',0x85744b,[.7,.3,.65],[0,2.48,0]);
    for(const x of [-.09,.09])kit.part(g,'box',C.coal,[.04,.045,.03],[x,2.18,.16]);
  }else if(asset.includes('radar')||asset.includes('satellite'))radar(kit,g);
  else if(asset.includes('weather_station_mast'))mast(kit,g);
  else if(asset==='fv_dock.png'){
    for(let i=0;i<18;i++)kit.part(g,'box',i%3?C.wood:C.woodDark,[2.4,.09,.33],[0,.25,-i*.34]);
    for(const x of [-1,1])for(const z of [0,-2.8,-5.6])kit.part(g,'cylinder',C.bark,[.2,1.3,.2],[x,.35,z]);
  }else if(asset==='fv_kayak.png'){
    const hull=new Group();hull.scale.set(.5,1,2.4);kit.vessel(hull,0xa9976c,.6,.75,.06,.28,14);g.add(hull);
    beam(kit,g,C.bark,[-.4,.26,-.4],[.4,.26,-.4],.04);beam(kit,g,C.bark,[-.4,.26,.4],[.4,.26,.4],.04);
  }else throw new Error(`Missing village model ${asset}`);
  if(asset.includes('weather_station_mast')){root.add(compileFixtures(kit,g));return root;}
  root.add(kit.compileColored(kit.compile(g)));return root;
}

export class VillageRig {
  readonly root:Group;
  private readonly cutaway:CutawayEnvelope|undefined;
  private readonly lamps:Group|undefined;
  private readonly rotors:Group[]=[];
  private faded=false;
  constructor(private kit:ModelKit,readonly asset:string,prototype:Group){
    this.root=prototype.clone(true);this.lamps=this.root.getObjectByName('village-lamps') as Group|undefined;
    const shell=this.root.getObjectByName('village-shell') as Group|undefined;if(shell)this.cutaway=new CutawayEnvelope(kit,shell,.4);
    this.root.traverse(o=>{if(o.name==='village-turbine'||o.name==='village-wind-rotor')this.rotors.push(o as Group);});
  }
  update(local:{x:number;y:number}|null|undefined,anchor:{x:number;y:number},rotation:number,time:number):void {
    const p=VILLAGE_BUILDINGS[this.asset],dx=(local?.x??Infinity)-anchor.x,dy=(local?.y??Infinity)-anchor.y;
    const x=(dx*Math.cos(rotation)+dy*Math.sin(rotation))/48,z=(-dx*Math.sin(rotation)+dy*Math.cos(rotation))/48;
    const inside=Boolean(p&&local&&Math.abs(x)<p.width*.44&&z<.15&&z>-p.depth);
    if(this.faded!==inside){this.faded=inside;this.cutaway?.set(inside);}
    this.rotors.forEach(rotor=>{if(rotor.name==='village-turbine')rotor.rotation.z=time*1.4;else rotor.rotation.y=time*.9;});
    this.root.rotation.y=-rotation;this.root.userData.cutaway=inside;
  }
  nightLights():Vector3[]{
    if(!this.lamps)return[];this.root.updateMatrixWorld(true);
    return this.lamps.children.filter(o=>o.name==='village-window-anchor').slice(0,2).map(o=>o.getWorldPosition(new Vector3()));
  }
}
