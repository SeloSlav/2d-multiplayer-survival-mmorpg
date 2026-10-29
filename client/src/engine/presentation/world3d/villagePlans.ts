import type { PresentationEntity as Row } from './presentationEntity';

export interface VillageBuildingPlan {
  family:'fishing'|'hunting'|'alpine'|'hermit'|'ruin'|'weather';
  form:'gable'|'vault'|'round'|'station';
  width:number;depth:number;eave:number;rise:number;
  wood:number;trim:number;roof:number;roofLight:number;
  bone?:boolean;snow?:boolean;chimney?:boolean;ladder?:boolean;totems?:boolean;
}
/** Ground dimensions in tile units. The front sill is the stored worldX/Y
 * anchor; all occupied ground extends north from it, as in the original art. */
export const VILLAGE_BUILDINGS:Record<string,VillageBuildingPlan>={
  'fv_lodge.png':{family:'fishing',form:'gable',width:7,depth:4.7,eave:2.25,rise:1.8,wood:0x796750,trim:0xa18c68,roof:0x72694f,roofLight:0x938267,totems:true},
  'fv_hut2.png':{family:'fishing',form:'vault',width:4.5,depth:5.1,eave:.9,rise:2.25,wood:0x59664b,trim:0xa9b2a2,roof:0x587640,roofLight:0x84984e,bone:true},
  'fv_hut3.png':{family:'fishing',form:'vault',width:5.6,depth:4.8,eave:1.1,rise:2.25,wood:0x705c45,trim:0xc4bea3,roof:0x7c8c50,roofLight:0x9ca363,bone:true,ladder:true},
  'hv_lodge.png':{family:'hunting',form:'gable',width:6.4,depth:4.7,eave:2.3,rise:2,wood:0x655442,trim:0x8a9284,roof:0x6e624e,roofLight:0x7a8551,chimney:true},
  'hv_hut2.png':{family:'hunting',form:'round',width:4.6,depth:3.9,eave:.8,rise:1.85,wood:0x697250,trim:0xb0b4a0,roof:0x6d8246,roofLight:0x93a75d,bone:true},
  'hv_hut3.png':{family:'hunting',form:'gable',width:4.5,depth:3.7,eave:1.6,rise:1.65,wood:0x795944,trim:0x986f4d,roof:0x587c3a,roofLight:0x84a34c},
  'hv_hut1.png':{family:'hunting',form:'gable',width:4.2,depth:3.6,eave:1.5,rise:1.6,wood:0x725c43,trim:0xb4b39c,roof:0x697e42,roofLight:0x8c9f58,bone:true},
  'av_lodge.png':{family:'alpine',form:'vault',width:6.6,depth:5.6,eave:1.1,rise:2.8,wood:0x695340,trim:0x9b7b55,roof:0x6f8151,roofLight:0x93a06b,snow:true},
  'av_hut.png':{family:'alpine',form:'vault',width:4.3,depth:4.7,eave:1,rise:2.3,wood:0x745644,trim:0x976f4d,roof:0x66844e,roofLight:0x89a065,snow:true},
  'av_banya.png':{family:'alpine',form:'gable',width:4.8,depth:4.5,eave:1.65,rise:1.9,wood:0x665440,trim:0x948368,roof:0x79805a,roofLight:0xa1a27c,snow:true,chimney:true},
  'wbg_hermit_hut.png':{family:'hermit',form:'gable',width:4.5,depth:4,eave:1.7,rise:1.75,wood:0x836347,trim:0xb6b8a0,roof:0x8e9856,roofLight:0xacad70,bone:true},
  'hs_shack.png':{family:'ruin',form:'gable',width:5.7,depth:4.2,eave:1.9,rise:1.7,wood:0x806b4f,trim:0xa28a67,roof:0x8e785a,roofLight:0xb69b75},
  'ws_station.png':{family:'weather',form:'station',width:8,depth:5.9,eave:2.15,rise:.3,wood:0x596871,trim:0x9aa6a5,roof:0x6f7c83,roofLight:0x89989d},
};
export const VILLAGE_PROPS=['fv_campfire.png','av_campfire.png','fv_drying_rack.png','hv_drying_rack.png','av_drying_rack.png','scarecrow.png','av_weather_station_mast.png','ws_radar.png','ws_satellite.png','fv_dock.png','fv_kayak.png'] as const;
export function villageAsset(row:Row):string {
  const file=(row.imagePath??'').split(/[\\/]/).at(-1)??'';
  if(file in VILLAGE_BUILDINGS||VILLAGE_PROPS.includes(file as typeof VILLAGE_PROPS[number]))return file;
  return row.partType==='scarecrow'?'scarecrow.png':'';
}
export function villageCullMargin(row:Row):number {
  const p=VILLAGE_BUILDINGS[villageAsset(row)];return p?Math.max(p.width/2,p.depth+p.eave+p.rise)*48+48:260;
}
