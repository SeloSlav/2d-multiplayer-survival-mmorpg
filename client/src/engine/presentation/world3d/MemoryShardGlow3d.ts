import { Group, InstancedMesh, Matrix4, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { color, float, positionWorld, sin, smoothstep, uniform, uv } from 'three/tsl';

/** One pooled soft ground glow for visible shard pickups, debris and ore. */
export class MemoryShardGlow3d {
  readonly root=new Group();
  readonly halos:InstancedMesh;
  private readonly geometry=new PlaneGeometry(1,1).rotateX(-Math.PI/2);
  private readonly material=new MeshBasicNodeMaterial({transparent:true,depthWrite:false,depthTest:true,toneMapped:false});
  private readonly clock=uniform(0);
  private readonly matrix=new Matrix4();
  private count=0;
  constructor(){
    this.root.name='memory-shard-glow';
    const distance=uv().sub(.5).length().mul(2);
    const falloff=float(1).sub(smoothstep(.02,1,distance)).pow(1.5);
    const pulse=sin(this.clock.mul(2.4).add(positionWorld.x.mul(.9)).add(positionWorld.z.mul(.4))).mul(.06).add(.25);
    this.material.colorNode=color(0xa978ee);this.material.opacityNode=falloff.mul(pulse);
    this.halos=new InstancedMesh(this.geometry,this.material,512);
    this.halos.frustumCulled=false;this.halos.count=0;this.halos.renderOrder=2;this.root.add(this.halos);this.root.visible=false;
  }
  beginFrame(time:number):void {this.count=0;this.clock.value=time;}
  add(x:number,y:number,z:number,size:number):void {
    if(this.count>=this.halos.instanceMatrix.count)return;
    this.matrix.makeScale(size,1,size);this.matrix.setPosition(x,y+.035,z);this.halos.setMatrixAt(this.count++,this.matrix);
  }
  endFrame():void {this.halos.count=this.count;this.root.visible=this.count>0;if(this.count)this.halos.instanceMatrix.needsUpdate=true;}
  dispose():void {this.root.removeFromParent();this.halos.dispose();this.geometry.dispose();this.material.dispose();}
}
