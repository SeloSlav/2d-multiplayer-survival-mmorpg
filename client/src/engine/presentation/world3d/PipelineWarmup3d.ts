import { Mesh } from 'three/webgpu';
import type { Object3D, Camera, Scene, Renderer, BufferAttribute, InterleavedBufferAttribute } from 'three/webgpu';

/** Compile unfamiliar material/layout combinations asynchronously before their
 * first draw. Existing scenery keeps rendering; new scenery is discovered in
 * the culling margin. Never wait on a GPU pipeline in the animation loop. */
export class PipelineWarmup3d {
  private readonly ready = new Set<string>();
  private pending:string|null=null;
  private work:Promise<void>|null=null;
  private disposed=false;
  private cache=new WeakMap<Mesh,{version:string;key:string}>();

  prepare(root:Object3D,camera:Camera,renderer:Pick<Renderer,'compileAsync'>,scene:Scene,variant:string,onError:(message:string)=>void, dormantEffects:readonly Object3D[]=[]):()=>void {
    const hidden:Mesh[]=[];let candidate:{mesh:Mesh;key:string}|undefined;
    const inspect=(object:Object3D,shown:boolean)=>{
      if(!(object instanceof Mesh)||Array.isArray(object.material))return;
      const version=`${variant}:${object.material.version}:${object.geometry.id}:${object.castShadow}:${object.receiveShadow}`;
      let entry=this.cache.get(object);
      if(entry?.version!==version){
        const attributes=Object.entries(object.geometry.attributes as Record<string,BufferAttribute|InterleavedBufferAttribute>)
          .map(([name,a])=>`${name}:${a.itemSize}:${a.normalized}:${'array' in a ? a.array.constructor.name : 'interleaved'}`).join('|');
        const instanced='isInstancedMesh' in object&&object.isInstancedMesh;
        entry={version,key:`${variant}:${object.material.uuid}:${object.material.version}:${Boolean(instanced)}:${object.castShadow}:${object.receiveShadow}:${attributes}`};
        this.cache.set(object,entry);
      }
      if(!this.ready.has(entry.key)) {
        if(shown)hidden.push(object);
        if(!candidate&&entry.key!==this.pending)candidate={mesh:object,key:entry.key};
      }
    };
    root.traverseVisible(object=>inspect(object,true));
    // Visible scenery has priority. Once it is ready, prepare the meshes in
    // nearby unlit effects without making their hidden parent visible.
    if(!candidate&&!this.pending&&!this.disposed){
      for(const effect of dormantEffects){
        for(const child of effect.children)child.traverseVisible(object=>inspect(object,false));
        if(candidate)break;
      }
    }
    if(!this.pending&&candidate&&!this.disposed){
      const {mesh,key}=candidate;this.pending=key;
      // compileAsync captures the render object before yielding. Keep its own
      // culling disabled so an off-screen preparation actually warms the key.
      const culled=mesh.frustumCulled;mesh.frustumCulled=false;
      let work:Promise<void>;
      try {work=renderer.compileAsync(mesh,camera,scene);}
      catch(error){work=Promise.reject(error);}
      mesh.frustumCulled=culled;
      this.work = work.then(()=>{if(!this.disposed)this.ready.add(key);})
        .catch(error=>{if(!this.disposed)onError(`Material preparation failed: ${error instanceof Error?error.message:String(error)}`);})
        .finally(()=>{this.pending=null;this.work=null;});
    }
    hidden.forEach(mesh=>{mesh.visible=false;});
    return ()=>hidden.forEach(mesh=>{mesh.visible=true;});
  }
  async dispose():Promise<void> {this.disposed=true;this.ready.clear();this.cache=new WeakMap();await this.work;}
}
