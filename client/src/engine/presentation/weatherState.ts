import { calculateChunkIndex } from '../../utils/chunkUtils';

interface WeatherRow { currentWeather?: unknown; rainIntensity?: number }
const RAIN_BY_TYPE:Readonly<Record<string,number>>={Clear:0,LightRain:.3,ModerateRain:.6,HeavyRain:.9,HeavyStorm:1.2};

export function weatherTag(value:unknown):string {
  return typeof value==='string'?value:value&&typeof value==='object'&&'tag' in value?String(value.tag):'Clear';
}

/** A known local Clear row overrides global rain. An absent streamed row may
 * use the world fallback, and rainy enum values always have visible intensity. */
export function weatherForChunk(chunkWeather:unknown,chunkIndex:number,world?:WeatherRow) {
  const row:WeatherRow|undefined=chunkWeather instanceof Map
    ? chunkWeather.get(String(chunkIndex))??chunkWeather.get(chunkIndex) : undefined;
  const source=row??world,tag=weatherTag(source?.currentWeather);
  const raw=source?.rainIntensity;
  const rainIntensity=tag==='Clear'?0:typeof raw==='number'&&Number.isFinite(raw)&&raw>0
    ? Math.min(1.2,raw):RAIN_BY_TYPE[tag]??0;
  return {tag,rainIntensity,chunkIndex,source:row?'chunk':'world'};
}

export function weatherAtPosition(chunkWeather:unknown,x:number,y:number,world?:WeatherRow) {
  return weatherForChunk(chunkWeather,calculateChunkIndex(x,y),world);
}
