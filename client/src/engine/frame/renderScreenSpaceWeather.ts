import { weatherAtPosition } from '../presentation/weatherState';
import { renderRain } from '../../utils/renderers/rainRenderingUtils';
import { renderWeatherOverlay } from '../../utils/renderers/weatherOverlayUtils';

interface ScreenSpaceWeatherOptions {
  ctx: CanvasRenderingContext2D;
  localPlayer?: {positionX:number;positionY:number;isInsideBuilding?:boolean} | null;
  chunkWeather?: Map<string,any>;
  currentPredictedPosition: {x:number;y:number} | null;
  worldState: any;
  showPrecipitation: boolean;
  isSnorkeling: boolean;
  currentCameraOffsetX:number; currentCameraOffsetY:number;
  currentCanvasWidth:number; currentCanvasHeight:number;
  deltaTimeMs:number; stormAtmosphereEnabled:boolean; currentCycleProgress:number;
}

export function renderScreenSpaceWeather({ ctx, localPlayer, chunkWeather, currentPredictedPosition, worldState, showPrecipitation, isSnorkeling, currentCameraOffsetX, currentCameraOffsetY, currentCanvasWidth, currentCanvasHeight, deltaTimeMs, stormAtmosphereEnabled, currentCycleProgress }: ScreenSpaceWeatherOptions): void {
  const playerX=currentPredictedPosition?.x??localPlayer?.positionX??-currentCameraOffsetX+currentCanvasWidth/2;
  const playerY=currentPredictedPosition?.y??localPlayer?.positionY??-currentCameraOffsetY+currentCanvasHeight/2;
  const {rainIntensity}=weatherAtPosition(chunkWeather,playerX,playerY,worldState);

  const isWinter = worldState?.currentSeason?.tag === 'Winter';
  if (showPrecipitation && !isSnorkeling && !localPlayer?.isInsideBuilding) {
    renderRain(
      ctx,
      -currentCameraOffsetX+currentCanvasWidth/2,
      -currentCameraOffsetY+currentCanvasHeight/2,
      currentCanvasWidth,
      currentCanvasHeight,
      rainIntensity,
      deltaTimeMs / 1000,
      isWinter,
    );
  }

  if (stormAtmosphereEnabled) {
    renderWeatherOverlay(
      ctx,
      currentCanvasWidth,
      currentCanvasHeight,
      rainIntensity,
      currentCycleProgress,
      Date.now(),
    );
  }

}
