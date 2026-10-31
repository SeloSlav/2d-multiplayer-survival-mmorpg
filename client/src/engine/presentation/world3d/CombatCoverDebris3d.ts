import { Color, Group, InstancedMesh, Matrix4, MeshStandardNodeMaterial, Object3D, Vector3 } from 'three/webgpu';
import { combatCoverProfile } from '../../../config/combatCover';
import { ModelKit } from './modelKit';
import { seededRandom, seedFromId } from './visualContract';

const CAPACITY=144, LIFETIME=2400;
type Piece={ at:number; position:Vector3; velocity:Vector3; size:Vector3; spin:number; floor:number; color:Color };
/** Bounded, deterministic splinters and stone chips; shared kit owns the geometry. */
export class CombatCoverDebris3d {
  readonly root=new Group();
  private readonly material=new MeshStandardNodeMaterial({roughness:1,flatShading:true});
  private readonly mesh:InstancedMesh;
  private pieces:Piece[]=[];
  private helper=new Object3D();
  constructor(kit:ModelKit) {
    this.mesh=new InstancedMesh(kit.geometry('rock'),this.material,CAPACITY);
    this.mesh.count=0;this.mesh.frustumCulled=false;this.mesh.receiveShadow=true;
    this.mesh.setColorAt(0,new Color());this.root.add(this.mesh);this.root.visible=false;
  }
  get activeCount() { return this.pieces.length; }
  spawn(id:string,variant:number,at:number,pose:Matrix4,floor:number) {
    const cover=combatCoverProfile(variant);if(!cover)return;
    const random=seededRandom(seedFromId(`${id}:${at}`)), wood=cover.material==='wood';
    for(let i=0;i<12;i++) {
      if(this.pieces.length>=CAPACITY)this.pieces.shift();
      this.pieces.push({at,floor,
        position:new Vector3((random()-.5)*cover.width/48,random()*cover.height/48,(random()-.5)*cover.depth/48).applyMatrix4(pose),
        velocity:new Vector3((random()-.5)*2,1+random()*2,(random()-.5)*2),
        size:new Vector3(wood?.3+random()*.4:.18+random()*.2,.12+random()*.15,.12+random()*.15),
        spin:(random()-.5)*8,color:new Color(cover.color).multiplyScalar(.7+random()*.4)});
    }
  }
  update(now:number) {
    this.pieces=this.pieces.filter(p=>now-p.at>=0&&now-p.at<LIFETIME);
    this.pieces.forEach((p,i)=>{
      const age=(now-p.at)/1000, travel=Math.min(age,.8), fade=Math.min(1,(LIFETIME-(now-p.at))/350);
      this.helper.position.set(p.position.x+p.velocity.x*travel,
        Math.max(p.floor+p.size.length()*.25,p.position.y+p.velocity.y*age-5*age*age),p.position.z+p.velocity.z*travel);
      this.helper.rotation.set(p.spin*travel,p.spin*travel*.7,p.spin*travel*.3);
      this.helper.scale.copy(p.size).multiplyScalar(fade);this.helper.updateMatrix();
      this.mesh.setMatrixAt(i,this.helper.matrix);this.mesh.setColorAt(i,p.color);
    });
    this.mesh.count=this.pieces.length;this.root.visible=this.pieces.length>0;
    if(this.pieces.length){this.mesh.instanceMatrix.needsUpdate=true;this.mesh.instanceColor!.needsUpdate=true;}
  }
  dispose(){this.mesh.dispose();this.material.dispose();this.root.clear();this.pieces=[];}
}
