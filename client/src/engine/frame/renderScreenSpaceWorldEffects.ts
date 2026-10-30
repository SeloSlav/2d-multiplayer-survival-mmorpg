import { renderScreenSpaceWeather } from './renderScreenSpaceWeather';
export { renderScreenSpaceWeather } from './renderScreenSpaceWeather';
import { renderWardRadius, LANTERN_TYPE_LANTERN } from '../../utils/renderers/lanternRenderingUtils';
import { renderStatusOverlayPasses } from './renderStatusOverlayPasses';

interface RenderScreenSpaceWorldEffectsOptions {
  ctx: CanvasRenderingContext2D;
  localPlayer: any;
  chunkWeather: Map<string, any> | undefined;
  currentPredictedPosition: { x: number; y: number } | null;
  worldState: any;
  showPrecipitation: boolean;
  isSnorkeling: boolean;
  currentCameraOffsetX: number;
  currentCameraOffsetY: number;
  currentCanvasWidth: number;
  currentCanvasHeight: number;
  deltaTimeMs: number;
  stormAtmosphereEnabled: boolean;
  currentCycleProgress: number;
  resolvedOverlayRgba: string;
  maskCanvas: HTMLCanvasElement | null;
  redrawMask: (args: {
    cameraOffsetX: number;
    cameraOffsetY: number;
    predictedPosition: { x: number; y: number } | null;
    worldMouseX: number | null;
    worldMouseY: number | null;
  }) => void;
  currentWorldMouseX: number | null;
  currentWorldMouseY: number | null;
  visibleLanterns: any[];
  worldParticlesQuality: number;
  renderParticles: (ctx: CanvasRenderingContext2D, particles: any[]) => void;
  resourceSparkleParticles: any[];
  impactParticles: any[];
  structureImpactParticles: any[];
  hostileDeathParticles: any[];
  showStatusOverlays: boolean;
  activeConsumableEffects: Map<string, any>;
  localPlayerId?: string;
}


export function renderScreenSpaceWorldEffects({
  ctx,
  localPlayer,
  chunkWeather,
  currentPredictedPosition,
  worldState,
  showPrecipitation,
  isSnorkeling,
  currentCameraOffsetX,
  currentCameraOffsetY,
  currentCanvasWidth,
  currentCanvasHeight,
  deltaTimeMs,
  stormAtmosphereEnabled,
  currentCycleProgress,
  resolvedOverlayRgba,
  maskCanvas,
  redrawMask,
  currentWorldMouseX,
  currentWorldMouseY,
  visibleLanterns,
  worldParticlesQuality,
  renderParticles,
  resourceSparkleParticles,
  impactParticles,
  structureImpactParticles,
  hostileDeathParticles,
  showStatusOverlays,
  activeConsumableEffects,
  localPlayerId,
}: RenderScreenSpaceWorldEffectsOptions): void {
  renderScreenSpaceWeather({ ctx, localPlayer, chunkWeather, currentPredictedPosition, worldState, showPrecipitation, isSnorkeling, currentCameraOffsetX, currentCameraOffsetY, currentCanvasWidth, currentCanvasHeight, deltaTimeMs, stormAtmosphereEnabled, currentCycleProgress });

  if (resolvedOverlayRgba !== 'transparent' && resolvedOverlayRgba !== 'rgba(0,0,0,0.00)' && maskCanvas) {
    redrawMask({
      cameraOffsetX: currentCameraOffsetX,
      cameraOffsetY: currentCameraOffsetY,
      predictedPosition: currentPredictedPosition,
      worldMouseX: currentWorldMouseX,
      worldMouseY: currentWorldMouseY,
    });
    ctx.drawImage(maskCanvas, 0, 0);
  }

  if (visibleLanterns && visibleLanterns.length > 0) {
    ctx.save();
    ctx.translate(currentCameraOffsetX, currentCameraOffsetY);
    for (const lantern of visibleLanterns) {
      if (lantern.lanternType !== LANTERN_TYPE_LANTERN && !lantern.isDestroyed) {
        renderWardRadius(ctx, lantern, currentCycleProgress, true);
      }
    }
    ctx.restore();
  }

  if (worldParticlesQuality > 1) {
    ctx.save();
    ctx.translate(currentCameraOffsetX, currentCameraOffsetY);
    renderParticles(ctx, resourceSparkleParticles);
    ctx.restore();
  }

  if (worldParticlesQuality > 0 && impactParticles.length > 0) {
    ctx.save();
    ctx.translate(currentCameraOffsetX, currentCameraOffsetY);
    renderParticles(ctx, impactParticles);
    ctx.restore();
  }

  if (worldParticlesQuality > 0 && structureImpactParticles.length > 0) {
    ctx.save();
    ctx.translate(currentCameraOffsetX, currentCameraOffsetY);
    renderParticles(ctx, structureImpactParticles);
    ctx.restore();
  }

  if (worldParticlesQuality > 0 && hostileDeathParticles.length > 0) {
    ctx.save();
    ctx.translate(currentCameraOffsetX, currentCameraOffsetY);
    renderParticles(ctx, hostileDeathParticles);
    ctx.restore();
  }

  renderStatusOverlayPasses({
    ctx,
    isSnorkeling,
    canvasWidth: currentCanvasWidth,
    canvasHeight: currentCanvasHeight,
    showStatusOverlays,
    localPlayer,
    deltaTimeMs,
    activeConsumableEffects,
    localPlayerId,
    cycleProgress: currentCycleProgress,
  });
}
