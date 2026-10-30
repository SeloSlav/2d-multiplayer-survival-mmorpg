import { Box3, Camera, Object3D, Vector3 } from 'three/webgpu';
import { pixelCameraPlan } from './pixelCamera';
import type { InteractableTarget } from '../../../types/interactions';

const WORLD_KIND: Partial<Record<InteractableTarget['type'], string>> = {
  campfire:'campfires', furnace:'furnaces', barbecue:'barbecues', fumarole:'fumaroles', lantern:'lanterns',
  turret:'turrets', homestead_hearth:'homesteadHearths', box:'woodenStorageBoxes', corpse:'playerCorpses',
  stash:'stashes', sleeping_bag:'sleepingBags', rain_collector:'rainCollectors', broth_pot:'brothPots',
  door:'doors', alk_station:'alkStations', cairn:'cairns', milkable_animal:'wildAnimals',
  harvestable_resource:'harvestableResources', dropped_item:'droppedItems', knocked_out_player:'players',
};

export function interactionVisualKey(target: InteractableTarget | null | undefined): string | null {
  const kind = target && WORLD_KIND[target.type];
  return kind && target ? `${kind}:${String(target.id)}` : null;
}

export interface InteractionBounds { x:number; y:number; width:number; height:number }

/** Project the actual model's bounds onto the full-resolution UI canvas. */
export function interactionBounds(root:Object3D, camera:Camera, width:number, height:number,
  cameraOffset:{x:number;y:number}, zoom=1): InteractionBounds | null {
  const box = new Box3().setFromObject(root);
  if (box.isEmpty()) return null;
  const plan = pixelCameraPlan(width,height,-cameraOffset.x+width/2,-cameraOffset.y+height/2,zoom);
  camera.updateMatrixWorld();
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for(const x of [box.min.x,box.max.x]) for(const y of [box.min.y,box.max.y]) for(const z of [box.min.z,box.max.z]) {
    const p=new Vector3(x,y,z).project(camera);
    const sx=(p.x+1)*plan.cssWidth/2+plan.translateX, sy=(1-p.y)*plan.cssHeight/2+plan.translateY;
    left=Math.min(left,sx);right=Math.max(right,sx);top=Math.min(top,sy);bottom=Math.max(bottom,sy);
  }
  return {x:(left+right)/2,y:(top+bottom)/2,width:Math.max(16,right-left+8),height:Math.max(16,bottom-top+8)};
}
