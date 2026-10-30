import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three/webgpu';
import { ModelKit } from './modelKit';
import { VILLAGE_DOOR_HALF_WIDTH } from '../../../config/villageGeometry';

/** Subtract a real portal from every façade/roof triangle, including low
 * sod roofs, braces and station window panels crossing the entrance. */
export function carveVillageEntrance(kit:ModelKit,assembly:Group,front:number,bottom=.075):void {
  const half=VILLAGE_DOOR_HALF_WIDTH-.1;
  const planes=[[0,1,-half],[0,-1,-half],[1,1,bottom],[1,-1,-1.98],[2,1,front-1.1],[2,-1,-front-1]];
  assembly.traverse(object=>{
    if(!(object instanceof Mesh))return;
    const source=object.geometry,index=source.index,names=Object.keys(source.attributes);
    const attrs=names.map(name=>source.getAttribute(name) as BufferAttribute),offsets:number[]=[];let size=0;
    for(const attr of attrs){offsets.push(size);size+=attr.itemSize;}
    const positionOffset=offsets[names.indexOf('position')],out:number[][]=names.map(()=>[]);
    const push=(polygon:number[][])=>{for(let i=1;i<polygon.length-1;i++)for(const vertex of [polygon[0],polygon[i],polygon[i+1]])for(let a=0;a<attrs.length;a++){
      for(let k=0;k<attrs[a].itemSize;k++)out[a].push(vertex[offsets[a]+k]);
    }};
    const length=index?.count??attrs[names.indexOf('position')].count;
    for(let i=0;i<length;i+=3){
      let polygon:number[][]=[];
      for(let j=0;j<3;j++){const v=index?index.getX(i+j):i+j,vertex:number[]=[];for(const a of attrs)for(let k=0;k<a.itemSize;k++)vertex.push(a.getComponent(v,k));polygon.push(vertex);}
      for(const [axis,sign,edge] of planes){
        if(!polygon.length)break;
        const inside:number[][]=[],outside:number[][]=[];
        for(let j=0;j<polygon.length;j++){
          const a=polygon[j],b=polygon[(j+1)%polygon.length],da=a[positionOffset+axis]*sign-edge,db=b[positionOffset+axis]*sign-edge;
          (da>=0?inside:outside).push(a);
          if((da>=0)!==(db>=0)){const t=da/(da-db),intersection=a.map((value,k)=>value+(b[k]-value)*t);inside.push(intersection);outside.push(intersection);}
        }
        push(outside);polygon=inside;
      }
      // The remainder is inside the doorway volume and is deliberately omitted.
    }
    const geometry=new BufferGeometry();for(let a=0;a<attrs.length;a++)geometry.setAttribute(names[a],new Float32BufferAttribute(out[a],attrs[a].itemSize));
    geometry.normalizeNormals();geometry.computeBoundingSphere();object.geometry=kit.ownGeometry(geometry);
  });
}
