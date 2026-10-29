import { Color, Group, InstancedMesh, MeshStandardMaterial, Object3D } from 'three/webgpu';
import { ModelKit } from './modelKit';
import { seedFromId } from './visualContract';

// The existing tree_falling.mp3 has its main ground impact around 2.35 s.
// The tree and sound originate from the same server destruction transaction.
export const TREE_IMPACT_MS = 2350;
const DEBRIS_SECONDS = 1.4;
const CAPACITY = 512;

/** Pooled, deterministic ballistic leaves and soil at a tree's landing point. */
export class TreeFallEffects3d {
  readonly root = new Group();
  readonly leaves: InstancedMesh;
  readonly dirt: InstancedMesh;
  private readonly material = new MeshStandardMaterial({color:0xffffff,roughness:1,flatShading:true});
  private readonly transform = new Object3D();
  private readonly pigment = new Color();
  private leavesUsed=0;
  private dirtUsed=0;

  constructor(kit:ModelKit){
    this.root.name='tree-fall-debris';
    this.leaves=new InstancedMesh(kit.geometry('leaf'),this.material,CAPACITY);
    this.dirt=new InstancedMesh(kit.geometry('rock'),this.material,CAPACITY);
    for(const mesh of [this.leaves,this.dirt]){
      mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;mesh.count=0;
      mesh.setColorAt(0,this.pigment.setHex(0xffffff));
      this.root.add(mesh);
    }
    this.root.visible=false;
  }
  beginFrame():void {this.leavesUsed=0;this.dirtUsed=0;}
  observe(id:string,base:{x:number;y:number;z:number},height:number,leaf:number,light:number,elapsedMs:number):void {
    const age=(elapsedMs-TREE_IMPACT_MS)/1000;
    if(age<0||age>=DEBRIS_SECONDS)return;
    const fade=Math.min(1,(DEBRIS_SECONDS-age)/.35);
    const seed=seedFromId(id);
    const rand=(i:number,salt:number)=>{
      let n=Math.imul(seed ^ Math.imul(i+1,0x9e3779b1) ^ salt,0x85ebca6b);
      n=Math.imul(n ^ n>>>13,0xc2b2ae35);return ((n ^ n>>>16)>>>0)/4294967295;
    };
    const landingX=base.x+height*.83;
    for(let i=0;i<28;i++){
      const isLeaf=i<16, mesh=isLeaf?this.leaves:this.dirt;
      const slot=isLeaf?this.leavesUsed++:this.dirtUsed++;
      if(slot>=CAPACITY)continue;
      const angle=rand(i,1)*Math.PI*2, spread=.5+rand(i,2)*1.1;
      const speed=1.05+rand(i,3)*(isLeaf ? 1.1 : 1.25);
      const rise=(isLeaf ? .9 : 1.55)+rand(i,4)*(isLeaf ? .6 : 1.2);
      const gravity=isLeaf?1.1:3.5;
      this.transform.position.set(landingX+Math.cos(angle)*spread*.55+Math.cos(angle)*speed*age,
        base.y+Math.max(.035,.1+rise*age-gravity*age*age/2),
        base.z+Math.sin(angle)*spread*.5+Math.sin(angle)*speed*age);
      this.transform.rotation.set(age*(isLeaf?3.2:7)+rand(i,5)*3,angle+age*(isLeaf?1.3:3),rand(i,6)*6+age*2);
      const size=(isLeaf ? .19 : .14)*(0.7+rand(i,7)*.7)*fade;
      this.transform.scale.set(isLeaf ? size*1.3 : size,isLeaf ? size*.17 : size,isLeaf ? size*2 : size);
      this.transform.updateMatrix();mesh.setMatrixAt(slot,this.transform.matrix);
      this.pigment.setHex(isLeaf?(i%3?leaf:light):(i%3?0x685340:0x92785a));
      mesh.setColorAt(slot,this.pigment);
    }
  }
  endFrame():void {
    this.leaves.count=Math.min(CAPACITY,this.leavesUsed);this.dirt.count=Math.min(CAPACITY,this.dirtUsed);
    this.root.visible=this.leaves.count+this.dirt.count>0;
    for(const mesh of [this.leaves,this.dirt])if(mesh.count){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
  }
  dispose():void {this.root.removeFromParent();this.leaves.dispose();this.dirt.dispose();this.material.dispose();}
}
