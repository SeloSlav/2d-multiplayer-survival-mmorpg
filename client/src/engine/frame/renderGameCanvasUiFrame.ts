import { renderTranslatedWorldExtrasOverCampfireOverlay } from './renderTranslatedWorldExtras';
import { renderStatusOverlayPasses } from './renderStatusOverlayPasses';
import { renderLateFramePasses } from './renderLateFramePasses';
import { renderScreenSpaceWeather } from './renderScreenSpaceWorldEffects';
import { renderHealthBarOverlay } from '../../utils/renderers/healthBarOverlayUtils';
import { drawNameTag, isPlayerHovered } from '../../utils/renderers/playerRenderingUtils';
import { getViewBounds, gameConfig } from '../../config/gameConfig';
import type { GameCanvasRuntimeRenderContext } from '../runtime/GameCanvasRuntimeHost';
import type { Player } from '../../generated/types';
import { addWebGpuSample, webGpuProfilerTimings } from '../presentation/world3d/world3dProfiler';
import type { World3dProfile, WebGpuFrameProfile } from '../presentation/world3d/world3dProfiler';
import { isProfilerRecording } from '../../utils/profilerRecording';
import { groundPosition } from '../presentation/world3d/groundAnchor';
import type { PresentationEntity } from '../presentation/world3d/presentationEntity';

type Extras = Parameters<typeof renderTranslatedWorldExtrasOverCampfireOverlay>[0];
const HEALTH_WORLD_KINDS:Record<string,string>={wooden_storage_box:'woodenStorageBoxes',campfire:'campfires',rain_collector:'rainCollectors',homestead_hearth:'homesteadHearths',sleeping_bag:'sleepingBags'};
type Late = Parameters<typeof renderLateFramePasses>[0];
type UiContext = Partial<Extras & Late & Parameters<typeof renderScreenSpaceWeather>[0]> & {
  gameCanvasRef: { current: HTMLCanvasElement | null };
  canvasSize: { width: number; height: number };
  cameraOffsetRef: { current: { x: number; y: number } };
  predictedPositionRef: { current: { x: number; y: number } | null };
  worldMousePosRef: { current: { x: number | null; y: number | null } };
  ySortedEntitiesRef: { current: Parameters<typeof renderHealthBarOverlay>[0]['ySortedEntities'] };
  renderGameDepsRef: { current: Partial<Late> & { unifiedInteractableTarget?: Extras['unifiedInteractableTarget'] } };
  deltaTimeRef: { current: number };
  vignetteOpacityRef: { current: number };
  cycleProgressRef: { current: number };
  activeConnections?: Map<string, unknown>;
  playerStats?: Map<string, { activeTitleId?: string }>;
  hoveredPlayerIds?: Set<string>;
  alwaysShowPlayerNames?: boolean;
  showStatusOverlays?: boolean;
  activeConsumableEffects: Parameters<typeof renderStatusOverlayPasses>[0]['activeConsumableEffects'];
  isProfilerRecording?: boolean;
};

/** Reuse original UI painters verbatim on the original full-resolution canvas. */
export function renderGameCanvasUiFrame(context: GameCanvasRuntimeRenderContext, runtime?: {frameStartMs:number; frameGapMs:number; world:World3dProfile | null; occludes?:(x:number,y:number)=>boolean}): void {
  const args = context as unknown as UiContext;
  const canvas = args.gameCanvasRef.current;
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const start = performance.now();
  const nowMs = Date.now();
  const emptyMap = new Map();
  const width = args.canvasSize.width, height = args.canvasSize.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const camera = args.cameraOffsetRef.current;
  const position = args.predictedPositionRef.current;
  const pointer = args.worldMousePosRef.current;
  const deps = args.renderGameDepsRef.current;
  const translated = { ...args, ctx, currentPredictedPosition: position,
    currentCameraOffsetX: camera.x, currentCameraOffsetY: camera.y,
    currentWorldMouseX: pointer.x, currentWorldMouseY: pointer.y,
    unifiedInteractableTarget: deps.unifiedInteractableTarget ?? null,
    emptyMap, renderPlacementGeometry: false,
  } as Extras;
  ctx.save(); ctx.translate(camera.x, camera.y);
  renderTranslatedWorldExtrasOverCampfireOverlay(translated);
  const healthEntities=runtime?.occludes?args.ySortedEntitiesRef.current.filter(entry=>{
    if(entry.type==='shelter')return true;
    const p=groundPosition(HEALTH_WORLD_KINDS[entry.type]??`${entry.type}s`,entry.entity as PresentationEntity);return !runtime.occludes!(p.x,p.y);
  }):args.ySortedEntitiesRef.current;
  renderHealthBarOverlay({ ctx, ySortedEntities: healthEntities, nowMs,
    playerX: position?.x ?? 0, playerY: position?.y ?? 0 });
  for (const [id, player] of args.players ?? []) {
    if (player.isDead) continue;
    const local = id === args.localPlayerId;
    const display = local && position ? position : { x: player.positionX, y: player.positionY };
    if(runtime?.occludes?.(display.x,display.y))continue;
    const hovered = isPlayerHovered(pointer.x, pointer.y, player as Player);
    drawNameTag(ctx, player as Player, display.y - gameConfig.playerSpriteHeight * 0.8, display.x,
      args.activeConnections?.has(id) ?? false, Boolean(args.alwaysShowPlayerNames || hovered || args.hoveredPlayerIds?.has(id)),
      args.playerStats?.get(id)?.activeTitleId ?? null, nowMs);
  }
  ctx.restore();
  const weatherStart = performance.now();
  renderScreenSpaceWeather({ ...args, ctx, worldState: args.worldState, localPlayer: args.localPlayer, chunkWeather: args.chunkWeather,
    currentPredictedPosition: position, isSnorkeling: Boolean(args.localPlayer?.isSnorkeling),
    currentCameraOffsetX: camera.x, currentCameraOffsetY: camera.y, currentCanvasWidth: width, currentCanvasHeight: height,
    deltaTimeMs: args.deltaTimeRef.current, currentCycleProgress: args.cycleProgressRef.current,
    showPrecipitation: Boolean(args.showPrecipitation), stormAtmosphereEnabled: Boolean(args.stormAtmosphereEnabled) });
  const weatherMs = performance.now() - weatherStart;
  renderStatusOverlayPasses({ ctx, localPlayer: args.localPlayer, isSnorkeling: Boolean(args.localPlayer?.isSnorkeling),
    canvasWidth: width, canvasHeight: height, showStatusOverlays: Boolean(args.showStatusOverlays),
    deltaTimeMs: args.deltaTimeRef.current, activeConsumableEffects: args.activeConsumableEffects,
    localPlayerId: args.localPlayerId, cycleProgress: args.cycleProgressRef.current });
  renderLateFramePasses({ ...args, ...deps, ctx, renderLighting: false, frameStartTime: start,
    showFpsProfiler: runtime?.world ? false : args.showFpsProfiler,
    timingMarks: { t0: start, t1: start, t1a: start, t1b: start, t1c: start, t2: start, t3: start, t3a: start },
    cameraOffsetX: camera.x, cameraOffsetY: camera.y, currentPredictedPosition: position, cycleProgress: args.cycleProgressRef.current,
    currentWorldMouseX: pointer.x, currentWorldMouseY: pointer.y,
    vignetteOpacity: args.vignetteOpacityRef.current, canvasWidth: width, canvasHeight: height,
    viewBounds: getViewBounds(camera.x, camera.y, width, height), nowMs, emptyMap,
    holdInteractionProgress: deps.holdInteractionProgress ?? null, isActivelyHolding: deps.isActivelyHolding ?? false,
    closestInteractableKnockedOutPlayerId: deps.closestInteractableKnockedOutPlayerId ?? null,
    closestInteractableWaterPosition: deps.closestInteractableWaterPosition ?? null,
    ySortedEntityCount: args.ySortedEntitiesRef.current.length,
  } as Late);
  if (runtime?.world) {
    const end = performance.now();
    const sample: WebGpuFrameProfile = {...runtime.world, frameGapMs:runtime.frameGapMs || end-runtime.frameStartMs,
      preparationMs:runtime.world.startMs-runtime.frameStartMs, totalCpuMs:end-runtime.frameStartMs,
      weatherMs, uiMs:end-start-weatherMs};
    // Expose diagnostics on the world canvas without adding or changing HUD UI.
    if (sample.frame % 30 === 0) {
      const worldCanvas = canvas.parentElement?.querySelector<HTMLCanvasElement>('canvas[data-world-presentation="webgpu"]');
      if (worldCanvas) worldCanvas.dataset.frameProfile = JSON.stringify(sample);
    }
    if (isProfilerRecording()) addWebGpuSample(sample);
    if (args.showFpsProfiler) {
      const profiler = args.fpsProfilerRef!.current;
      const timings = webGpuProfilerTimings(sample);
      profiler.update(timings, sample.frameGapMs, args.ySortedEntitiesRef.current.length);
      profiler.recordIfActive(timings, sample.frameGapMs, args.ySortedEntitiesRef.current.length);
      profiler.render(ctx, width, args.isProfilerRecording ?? false);
    }
  }
}
