import { gameConfig } from '../../config/gameConfig';
import { weatherTag } from './weatherState';

/** Shared cycles per second: light rain is a slow eight-second sway. */
export const VEGETATION_WIND_PROFILES:Readonly<Record<string,{strength:number;cadenceHz:number}>>={
  Clear:{strength:.16,cadenceHz:.10}, LightRain:{strength:.30,cadenceHz:.125},
  ModerateRain:{strength:.55,cadenceHz:.16}, HeavyRain:{strength:.82,cadenceHz:.21}, HeavyStorm:{strength:1.15,cadenceHz:.28},
};
interface WindCell {strength:number;cadenceHz:number;phase:number}

/** Integrate each chunk's cadence so a weather change never resets its phase. */
export class VegetationWindField {
  readonly cells:WindCell[]=Array.from({length:gameConfig.worldWidthChunks*gameConfig.worldHeightChunks},()=>({strength:.16,cadenceHz:.10,phase:0}));
  private readonly chunkKeys=this.cells.map((_,index)=>String(index));
  private previousTime:number|null=null;
  update(seconds:number,chunkWeather?:unknown,world?:{currentWeather?:unknown;rainIntensity?:number}):void {
    const first=this.previousTime===null,dt=first?0:Math.min(.1,Math.max(0,seconds-this.previousTime!));
    this.previousTime=seconds;
    const forceBlend=1-Math.exp(-dt*1.4),rateBlend=1-Math.exp(-dt*.8);
    for(let index=0;index<this.cells.length;index++){
      const row=chunkWeather instanceof Map?chunkWeather.get(this.chunkKeys[index])??chunkWeather.get(index):undefined;
      const tag=weatherTag((row??world)?.currentWeather);
      const target=VEGETATION_WIND_PROFILES[tag]??VEGETATION_WIND_PROFILES.Clear,cell=this.cells[index];
      if(first){cell.strength=target.strength;cell.cadenceHz=target.cadenceHz;cell.phase=seconds*cell.cadenceHz*Math.PI*2;}
      else {cell.strength+=(target.strength-cell.strength)*forceBlend;cell.cadenceHz+=(target.cadenceHz-cell.cadenceHz)*rateBlend;cell.phase+=dt*cell.cadenceHz*Math.PI*2;}
    }
  }
}
