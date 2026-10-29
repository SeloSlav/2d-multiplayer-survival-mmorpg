import { Group, Mesh, Vector3 } from 'three/webgpu';
import { ModelKit, COLORS as C } from './modelKit';
import { profileAcrossWidth } from './architecturePrimitives';
import { SHELTER_DIMS } from '../../../config/entityGroundGeometry';
import { WORLD_3D, seededRandom } from './visualContract';
import { groundPosition, insideShelter } from './groundAnchor';
import type { PresentationEntity as Row } from './presentationEntity';
import { CutawayEnvelope } from './CutawayEnvelope';

export const SHELTER_PROFILES = [
  {name:'woodland',wood:0x795737,trim:0xa07a4c,cover:0x56743a,leaves:[0x78974b,0x526b34,0x94a65c],snow:0},
  {name:'beach',wood:0x9b754c,trim:0xc0a573,cover:0x8d984e,leaves:[0xb4ba61,0x85974c,0xc9bd79],snow:0},
  {name:'tundra',wood:0x786446,trim:0xa08a62,cover:0x964c30,leaves:[0xbf6336,0x8e382b,0xd18243],snow:.25},
  {name:'alpine',wood:0x6d5a42,trim:0x96836a,cover:0xd0dfdc,leaves:[0xe0e9df,0xbbd3d4,0xd1dfe1],snow:1},
] as const;
const W=SHELTER_DIMS.HALF_WIDTH/WORLD_3D.tilePixels,D=SHELTER_DIMS.HALF_HEIGHT/WORLD_3D.tilePixels;
const OVERHANG=.28;
export function createBrushShelter(kit:ModelKit,variant:number):Group {
  const v=Math.max(0,Math.min(3,variant)),p=SHELTER_PROFILES[v],random=seededRandom(4921+v);
  const root=new Group(),shell=new Group(),roof=new Group();shell.name='shelter-shell';roof.name='shelter-roof';
  const depth=D+OVERHANG,height=(z:number)=>1.35+1.12*Math.sqrt(Math.max(0,1-(z/depth)**2));
  const upper:Array<readonly[number,number]>=[],lower:Array<readonly[number,number]>=[];
  for(let i=0;i<=12;i++){const z=-depth+depth*2*i/12;upper.push([z,height(z)]);lower.push([z,height(z)-.19]);}
  profileAcrossWidth(kit,roof,p.cover,[...upper,...lower.reverse()],(W+OVERHANG)*2);
  // Bent log ribs, twig lattice and lashed posts retain a usable interior.
  for(let i=0;i<=12;i++){
    const x=-W+W*2*i/12,door=Math.abs(x)<.6;
    const points=[new Vector3(x,door?1.8:.04,D+.15),new Vector3(x*.84,1.25,D*.79),new Vector3(x*.7+.05,2.55,0),new Vector3(x*.85-.09,1.3,-D*.79),new Vector3(x+.04,.04,-D-.15)];
    kit.branch(shell,i%3?p.wood:p.trim,points,[.22,.2,.13,.2,.23],7);
    if(!door)for(const side of [-1,1]){
      const foot=V3(x+(random()-.5)*.2,.04,side*(D+.13));
      const fork=V3(x*.76+(i%2?.14:-.14),1.55,side*D*.7);
      kit.branch(shell,i%2?p.wood:p.trim,[foot,V3(x*.9,.7,side*D*.9),fork],[.15,.13,.09],6);
    }
    const tip=points[2].clone().add(new Vector3((random()-.5)*.3,.3+random()*.22,.15));
    kit.beam(shell,p.trim,points[2],tip,.07);
    if(i%3===0)kit.beam(shell,p.wood,tip.clone().add(new Vector3(-.15,-.15,0)),tip.clone().add(new Vector3(.13,.08,.12)),.035);
  }
  for(const side of [-1,1])for(let level=0;level<4;level++){
    const y=.22+level*.32,z=side*(D-.1-level*.09);
    if(side<0)kit.beam(shell,p.wood,new Vector3(-W,y,z),new Vector3(W,y+.025,z),.045);
    else for(const sign of [-1,1])kit.beam(shell,p.trim,new Vector3(sign*.65,y,z),new Vector3(sign*W,y+.025,z),.045);
  }
  for(const sign of [-1,1]){
    kit.beam(shell,p.wood,new Vector3(sign*.62,0,D+.04),new Vector3(sign*.63,1.85,D*.78),.12);
    for(let j=0;j<3;j++)kit.part(shell,'cylinder',C.leather,[.26,.035,.26],[sign*.63,1.55+j*.055,D*.8]);
    // Close the end walls with interwoven branches rather than a canvas panel.
    for(let j=0;j<8;j++)kit.beam(shell,j%2?p.wood:p.trim,new Vector3(sign*W,.06,-D+j*D/4),new Vector3(sign*(W-.17),1.4,-D+(j+.7)*D/4),.09);
  }
  kit.beam(shell,p.trim,new Vector3(-.67,1.85,D*.78),new Vector3(.67,1.85,D*.78),.1);
  for(let x=-W;x<=W;x+=.45)for(let z=-depth+.13;z<depth;z+=.42){
    const jitterX=x+(random()-.5)*.32,jitterZ=z+(random()-.5)*.22;
    const y=height(jitterZ)+.06,shade=p.leaves[Math.floor(random()*3)];
    if(v===1){
      const frond=kit.part(roof,'leaf',shade,[.42,.09,.85],[jitterX,y,jitterZ-.22]);frond.rotation.set(-jitterZ/depth*.48,(random()-.5)*.5,0);
      kit.beam(roof,p.trim,new Vector3(x,y+.025,z-.2),new Vector3(x+.05,y-.12,z+.5),.012);
    }else{
      const tuft=kit.part(roof,'rock',shade,[.65+random()*.18,.2+random()*.09,.57],[jitterX,y,jitterZ]);tuft.rotation.y=random()*6;
      if(v===0||v===2)for(let j=0;j<2;j++){const leaf=kit.part(roof,'leaf',shade,[.2,.04,.37],[x+(random()-.5)*.4,y+.13,z]);leaf.rotation.set(-.15,random()*6,.2);}
    }
    if(v===2&&random()<p.snow)kit.part(roof,'rock',0xd4e4e4,[.29,.1,.25],[x,y+.19,z]);
  }
  // Ragged hanging brush hides the slab edge and beds into the bent log walls.
  for(const side of [-1,1])for(let x=-W;x<=W;x+=.36){
    const shade=p.leaves[Math.floor(random()*3)],z=side*(D+.22),y=1.35+random()*.2;
    if(v===1){const leaf=kit.part(roof,'leaf',shade,[.4,.055,.75],[x,y+.1,z]);leaf.rotation.x=side*1.1;leaf.rotation.y=(random()-.5)*.4;}
    else{const tuft=kit.part(roof,'rock',shade,[.57,.42,.35],[x+(random()-.5)*.16,y,z]);tuft.rotation.z=(random()-.5)*.45;}
  }
  if(p.snow>0)for(let i=0;i<19;i++){
    const x=-W+(i+.5)*W*2/19;
    kit.part(roof,'cone',0xc7dfe4,[.055,.16+random()*.16,.055],[x,1.18,D+.24]).rotation.z=Math.PI;
  }
  const frame=kit.compileColored(kit.compile(shell));frame.name='shelter-frame';
  const canopy=kit.compileColored(kit.compile(roof));canopy.name='shelter-roof';
  const envelope=new Group();envelope.name='shelter-shell';envelope.add(frame,canopy);root.add(envelope);
  const border=new Group();border.name='shelter-protected-border';
  for(const sign of [-1,1]){
    kit.part(border,'box',0x60462e,[W*2,.018,.06],[0,.018,sign*D]);
    kit.part(border,'box',0x60462e,[.06,.018,D*2],[sign*W,.018,0]);
  }
  const outline=kit.compile(border);outline.name=border.name;outline.visible=false;outline.traverse(o=>{if(o instanceof Mesh){o.castShadow=false;o.receiveShadow=false;}});root.add(outline);
  root.userData.shelterBiome=p.name;root.userData.protectedFootprint={width:SHELTER_DIMS.WIDTH,height:SHELTER_DIMS.HEIGHT};
  return root;
}
const V3=(x:number,y:number,z:number)=>new Vector3(x,y,z);

export function shelterOwnerInside(row:Row,viewerId:string|undefined,position:{x:number;y:number}|null|undefined):boolean {
  const owner=typeof row.placedBy==='string'?row.placedBy:(row.placedBy as {toHexString?:()=>string})?.toHexString?.();
  return Boolean(viewerId&&owner===viewerId&&position&&!row.isDestroyed&&insideShelter(position.x,position.y,groundPosition('shelters',row)));
}

export class ShelterRig {
  readonly root:Group;
  private readonly shell:Group;
  private readonly border:Group;
  private readonly cutaway:CutawayEnvelope;
  private inside=false;
  constructor(private kit:ModelKit,variant:number,prototype?:Group){
    this.root=prototype?prototype.clone(true):createBrushShelter(kit,variant);
    this.shell=this.root.getObjectByName('shelter-shell') as Group;this.border=this.root.getObjectByName('shelter-protected-border') as Group;
    this.cutaway=new CutawayEnvelope(kit,this.shell,.3);
  }
  update(ownerInside:boolean,nowMs=0,lastHitMs=0):void {
    const age=nowMs-lastHitMs,strength=lastHitMs>0&&age>=0&&age<180?(1-age/180)**2:0;
    this.shell.position.x=strength?Math.sin(age*.09)*.125*strength:0;this.shell.position.z=strength?Math.cos(age*.11)*.06*strength:0;
    if(this.inside===ownerInside)return;this.inside=ownerInside;
    this.cutaway.set(ownerInside);
    this.border.visible=ownerInside;this.root.userData.ownerInside=ownerInside;
  }
}

/** Preserve the shelter's existing privacy in the new depth-rendered world. */
export class ShelterVisibility {
  private hidden:Array<{x:number;y:number}>=[];
  prepare(shelters:Iterable<Row>,viewerId:string|undefined,position:{x:number;y:number}|null|undefined):void {
    this.hidden=[];for(const row of shelters)if(!row.isDestroyed&&!shelterOwnerInside(row,viewerId,position))this.hidden.push(groundPosition('shelters',row));
  }
  occludes(x:number,y:number):boolean{return this.hidden.some(center=>insideShelter(x,y,center));}
}
