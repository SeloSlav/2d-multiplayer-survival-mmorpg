import geometry from '../../../shared/config/collisionGeometry.json';

export const ALK_GEOMETRY = geometry.alk;
export type AlkBuildingAsset = keyof typeof ALK_GEOMETRY.buildings;

/** Ground-plane dimensions in authoritative pixels. The renderer compensates
 * its depth projection; that compensation must never inflate collision sizes. */
export function alkBuildingFootprint(asset:AlkBuildingAsset, x:number, y:number) {
  const plan=ALK_GEOMETRY.buildings[asset],pixels=ALK_GEOMETRY.tilePixels;
  return {x,y:y+plan.centerOffsetY,width:plan.width*pixels,height:plan.depth*pixels};
}

export function alkTurretFootprint(monument:boolean, x:number, y:number) {
  const plan=ALK_GEOMETRY.turrets[monument?'monument':'player'];
  return {x,y:y+plan.centerOffsetY,radius:plan.diameter*ALK_GEOMETRY.tilePixels/2};
}
