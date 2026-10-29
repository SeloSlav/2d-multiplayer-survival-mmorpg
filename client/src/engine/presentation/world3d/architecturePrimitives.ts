import { Group, Matrix4, Vector3 } from 'three/webgpu';
import { ModelKit } from './modelKit';
import type { GroundPoint } from './buildingPlan';

/** Extrude a semantic depth/height profile along the building's width. */
export function profileAcrossWidth(kit:ModelKit,parent:Group,color:number,profile:GroundPoint[],width:number):void {
  const area=profile.reduce((sum,p,i)=>{const q=profile[(i+1)%profile.length];return sum+p[0]*q[1]-q[0]*p[1];},0);
  const assembly=new Group();parent.add(assembly);
  assembly.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(0,0,1),new Vector3(1,0,0),new Vector3(0,1,0)));
  kit.prism(assembly,color,area<0?[...profile].reverse():profile,-width/2,width/2);
}

export function gableRoof(kit:ModelKit,parent:Group,color:number,width:number,depth:number,eave:number,rise:number,thickness=.12):void {
  profileAcrossWidth(kit,parent,color,[[-depth/2,eave],[0,eave+rise],[depth/2,eave],[depth/2,eave-thickness],[0,eave+rise-thickness],[-depth/2,eave-thickness]],width);
}
