import { VILLAGE_BUILDINGS, villageAsset } from '../engine/presentation/world3d/villagePlans';
import type { PresentationEntity } from '../engine/presentation/world3d/presentationEntity';
import collisionGeometry from '../../../shared/config/collisionGeometry.json';

export const VILLAGE_CAMPFIRE_RADIUS = collisionGeometry.village.campfireRadius;
export const VILLAGE_CAMPFIRE_Y_OFFSET = collisionGeometry.village.campfireOffsetY;
// The 32px player radius needs an opening wider than 64px plus the walls.
export const VILLAGE_DOOR_HALF_WIDTH = collisionGeometry.village.doorHalfWidth;
export const VILLAGE_WALL_THICKNESS = collisionGeometry.village.wallThickness * collisionGeometry.village.tilePixels;
export interface VillageWallSegment { ax:number; ay:number; bx:number; by:number }

export function isInsideVillageBuilding(row:PresentationEntity,x:number,y:number,padding=0):boolean {
  const p=VILLAGE_BUILDINGS[villageAsset(row)];if(!p)return false;
  const dx=x-(row.worldX??0),dy=y-(row.worldY??0),angle=row.rotationRad??0,c=Math.cos(angle),s=Math.sin(angle);
  const u=dx*c+dy*s,v=-dx*s+dy*c,tile=collisionGeometry.village.tilePixels,half=p.width*tile/2,depth=p.depth*tile;
  return p.form==='round'?(u/(half+padding))**2+((v+depth/2)/(depth/2+padding))**2<1
    :Math.abs(u)<half+padding&&v<padding&&v>-depth-padding;
}

export function isVillageCampfire(row:PresentationEntity):boolean {
  const type=typeof row.monumentType==='object'&&row.monumentType&&'tag' in row.monumentType ? String(row.monumentType.tag) : String(row.monumentType??'');
  return type==='FishingVillage'&&Boolean(row.isCenter)
    || (type==='HuntingVillage'||type==='AlpineVillage')&&row.partType==='campfire';
}

/** Collision walls share the same dimensions, sill anchor, doorway and rotation
 * as the 3D building. Coordinates are world pixels, not screen/sprite bounds. */
export function villageWallSegments(row:PresentationEntity):VillageWallSegment[] {
  const plan=VILLAGE_BUILDINGS[villageAsset(row)];if(!plan)return [];
  const x=row.worldX??0,y=row.worldY??0,rotation=row.rotationRad??0,c=Math.cos(rotation),s=Math.sin(rotation);
  const tile=collisionGeometry.village.tilePixels;
  const world=(u:number,v:number)=>({x:x+tile*(u*c-v*s),y:y+tile*(u*s+v*c)});
  const result:VillageWallSegment[]=[];
  const segment=(ax:number,ay:number,bx:number,by:number)=>{
    const a=world(ax,ay),b=world(bx,by);result.push({ax:a.x,ay:a.y,bx:b.x,by:b.y});
  };
  if(plan.form==='round'){
    const half=plan.width/2,front=plan.depth/2,length=plan.width*Math.PI/28+.02;
    for(let i=3;i<=25;i++){
      const a=i/28*Math.PI*2,cx=Math.sin(a)*half,cy=Math.cos(a)*front-front;
      const dx=Math.cos(a)*length/2,dy=-Math.sin(a)*length/2;
      segment(cx-dx,cy-dy,cx+dx,cy+dy);
    }
  }else{
    const half=plan.width/2,door=VILLAGE_DOOR_HALF_WIDTH;
    segment(-half,0,-half,-plan.depth);segment(half,0,half,-plan.depth);
    segment(-half,-plan.depth,half,-plan.depth);
    segment(-half,0,-door,0);segment(door,0,half,0);
  }
  return result;
}
