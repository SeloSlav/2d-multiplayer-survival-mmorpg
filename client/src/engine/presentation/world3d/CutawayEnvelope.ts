import { Group, Matrix4, Mesh } from 'three/webgpu';
import type { MeshStandardMaterial } from 'three/webgpu';
import { ModelKit } from './modelKit';

/** Composite the nearest shell surface once. Multiplying opacity on every
 * overlapping leaf/log triangle makes a 30% roof almost opaque. A colorless
 * depth pass AFTER the opaque world selects the nearest envelope; its color
 * pass then blends once over the already-rendered interior/player. */
export class CutawayEnvelope {
  private readonly sources=new Map<Mesh,{material:MeshStandardMaterial;order:number;shadow:boolean}>();
  private readonly depth=new Group();
  private inside=false;
  constructor(private kit:ModelKit,shell:Group,private opacity:number){
    shell.updateMatrixWorld(true);const inverse=new Matrix4().copy(shell.matrixWorld).invert();
    shell.traverse(o=>{if(o instanceof Mesh)this.sources.set(o,{material:o.material as MeshStandardMaterial,order:o.renderOrder,shadow:o.castShadow});});
    for(const [mesh,source] of this.sources){
      const copy=mesh.clone(false),local=new Matrix4().multiplyMatrices(inverse,mesh.matrixWorld);
      copy.matrix.copy(local);copy.matrix.decompose(copy.position,copy.quaternion,copy.scale);
      copy.material=kit.cutawayMaterials(source.material,opacity).depth;copy.renderOrder=12;copy.castShadow=false;copy.userData.cutawayDepth=true;
      this.depth.add(copy);
    }
    this.depth.name='cutaway-depth-envelope';this.depth.visible=false;shell.add(this.depth);
  }
  set(inside:boolean):void {
    if(inside===this.inside)return;this.inside=inside;this.depth.visible=inside;
    for(const [mesh,source] of this.sources){
      mesh.material=inside?this.kit.cutawayMaterials(source.material,this.opacity).color:source.material;
      mesh.castShadow=inside?false:source.shadow;mesh.renderOrder=inside?13:source.order;
    }
  }
}
