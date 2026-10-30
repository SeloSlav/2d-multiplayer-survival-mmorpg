import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three/webgpu';
import { ModelKit } from './modelKit';
import { SHELTER_DIMS } from '../../../config/entityGroundGeometry';
import { GROUND_Y_SCALE, WORLD_3D } from './visualContract';

// Shelters are viewed by a fixed orthographic camera. Project each vertex to
// the ground plane before clipping so the clear area follows the drawn border.
const heightShift=1/(Math.tan(WORLD_3D.elevationRadians)*GROUND_Y_SCALE);
type Vertex=number[]; // position, normal, linear vertex color
type Plane=(vertex:Vertex)=>number;

function split(polygon:Vertex[],plane:Plane):[Vertex[],Vertex[]] {
  const inside:Vertex[]=[],outside:Vertex[]=[];
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],da=plane(a),db=plane(b),aInside=da>=0,bInside=db>=0;
    (aInside?inside:outside).push(a);
    if(aInside!==bInside){
      const t=da/(da-db),point=a.map((value,index)=>value+(b[index]-value)*t);
      inside.push(point);outside.push(point);
    }
  }
  return [inside,outside];
}

/** The returned meshes share source materials and are owned by the kit. */
export function createProjectedRim(kit:ModelKit,shell:Group,halfWidth:number,halfDepth:number,rotation=0):Group {
  const rim=new Group();rim.visible=false;
  // The ground footprint rotates with the building, while the camera's height
  // projection remains fixed in world space. Transform that shift back into
  // the building's local coordinates before clipping.
  const sx=Math.sin(rotation)*heightShift,sz=Math.cos(rotation)*heightShift;
  const planes:Plane[]=[v=>v[0]-v[1]*sx+halfWidth,v=>halfWidth-v[0]+v[1]*sx,
    v=>v[2]-v[1]*sz+halfDepth,v=>halfDepth-v[2]+v[1]*sz];
  shell.updateMatrixWorld(true);
  shell.traverse(object=>{
    if(!(object instanceof Mesh)||Array.isArray(object.material))return;
    const geometry=object.geometry,position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),color=geometry.getAttribute('color');
    if(!position||!normal||!color)throw new Error('Cutaway geometry requires position, normal and color attributes');
    const indices=geometry.getIndex(),count=indices?.count??position.count,positions:number[]=[],normals:number[]=[],colors:number[]=[];
    const vertex=(index:number):Vertex=>{
      const i=indices?indices.getX(index):index;
      return [position.getX(i),position.getY(i),position.getZ(i),normal.getX(i),normal.getY(i),normal.getZ(i),color.getX(i),color.getY(i),color.getZ(i)];
    };
    const emit=(polygon:Vertex[])=>{
      for(let i=1;i+1<polygon.length;i++)for(const v of [polygon[0],polygon[i],polygon[i+1]]){
        positions.push(v[0],v[1],v[2]);normals.push(v[3],v[4],v[5]);colors.push(v[6],v[7],v[8]);
      }
    };
    for(let i=0;i+2<count;i+=3){
      let interior=[vertex(i),vertex(i+1),vertex(i+2)];
      for(const plane of planes){
        if(interior.length<3)break;
        const [next,outside]=split(interior,plane);
        if(outside.length>=3)emit(outside);
        interior=next;
      }
    }
    const clipped=new BufferGeometry();clipped.setAttribute('position',new Float32BufferAttribute(positions,3));
    clipped.setAttribute('normal',new Float32BufferAttribute(normals,3));clipped.setAttribute('color',new Float32BufferAttribute(colors,3));
    clipped.computeBoundingSphere();
    // The remaining rim should not cast a dark roof shadow across the clear interior.
    const mesh=new Mesh(kit.ownGeometry(clipped),object.material);mesh.castShadow=false;mesh.receiveShadow=object.receiveShadow;
    rim.add(mesh);
  });
  return rim;
}

export function createShelterRim(kit:ModelKit,shell:Group):Group {
  const rim=createProjectedRim(kit,shell,SHELTER_DIMS.HALF_WIDTH/WORLD_3D.tilePixels,SHELTER_DIMS.HALF_HEIGHT/WORLD_3D.tilePixels);
  rim.name='shelter-rim';return rim;
}
