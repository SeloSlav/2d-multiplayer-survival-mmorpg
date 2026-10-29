import { mark } from '../../utils/profiler';
import { renderInteractionIndicators } from '../../utils/renderers/interactionIndicatorRenderingUtils';
import {
  renderRoadLamppostLight,
  renderBuoyLight,
  renderAllPlayerLights,
  renderAllStructureLights,
  renderFishingVillageCampfireLight,
  renderSovaAura,
} from '../../utils/renderers/lightRenderingUtils';
import { renderRuneStoneNightLight } from '../../utils/renderers/runeStoneRenderingUtils';
import {
  renderAllShipwreckNightLights,
  renderAllShipwreckDebugZones,
} from '../../utils/renderers/shipwreckRenderingUtils';
import { renderCompoundEerieLights } from '../../utils/renderers/compoundEerieLightUtils';
import { renderMobileTapAnimation } from '../../utils/renderers/mobileRenderingUtils';

interface TimingMarks {
  t0: number;
  t0a?: number;
  t1: number;
  t1a: number;
  t1b: number;
  t1c: number;
  t1d?: number;
  t2: number;
  t2a?: number;
  t2b?: number;
  t2c?: number;
  t3: number;
  t3a: number;
  t3b?: number;
  t3c?: number;
  t3d?: number;
  t3e?: number;
  t3f?: number;
  t3g?: number;
  worldCacheUpdateMs?: number;
  worldBaseTilesMs?: number;
  worldTransitionsMs?: number;
  worldDoodadsMs?: number;
  worldDoodadsTransitionChecksMs?: number;
  worldDoodadsSpawnEvaluationMs?: number;
  worldDoodadsBlurredDrawsMs?: number;
  worldDoodadsOpaqueDrawsMs?: number;
  waterOverlayGridMs?: number;
  waterOverlayShaderMs?: number;
  waterOverlayMaskMs?: number;
  waterOverlayCompositeMs?: number;
  waterOverlayDrawMs?: number;
}

interface RenderLateFramePassesOptions {
  renderLighting?: boolean;
  ctx: CanvasRenderingContext2D;
  frameStartTime: number;
  showFpsProfiler: boolean;
  timingMarks: TimingMarks;
  cameraOffsetX: number;
  cameraOffsetY: number;
  holdInteractionProgress: { targetId: string | number | bigint | null; targetType: string; startTime: number } | null;
  isActivelyHolding: boolean;
  closestInteractableKnockedOutPlayerId: string | null;
  closestInteractableWaterPosition: { x: number; y: number } | null;
  visibleCampfiresMap: Map<string, any>;
  visibleFurnacesMap: Map<string, any>;
  visibleBarbecuesMap: Map<string, any>;
  visibleLanternsMap: Map<string, any>;
  visibleBoxesMap: Map<string, any>;
  visibleDoorsMap: Map<string, any>;
  visibleHomesteadHearthsMap: Map<string, any>;
  stashes: Map<string, any>;
  players: Map<string, any>;
  emptyMap: Map<string, any>;
  buildingClusters: any;
  monumentParts: Map<string, any> | null | undefined;
  cycleProgress: number;
  visibleRoadLamppostsMap: Map<string, any>;
  visibleBarrelsMap: Map<string, any>;
  visibleRuneStonesMap: Map<string, any>;
  nowMs: number;
  shipwreckPartsMap: Map<string, any>;
  viewBounds: { minX: number; maxX: number; minY: number; maxY: number };
  showShipwreckDebug: boolean;
  localPlayerId?: string;
  currentPredictedPosition: { x: number; y: number } | null;
  remotePlayerInterpolation: any;
  activeEquipments: Map<string, any>;
  itemDefinitions: Map<string, any>;
  currentWorldMouseX: number | null;
  currentWorldMouseY: number | null;
  isMobile: boolean;
  tapAnimation: any;
  vignetteOpacity: number;
  canvasWidth: number;
  canvasHeight: number;
  fpsProfilerRef: { current: any };
  isProfilerRecording?: boolean;
  ySortedEntityCount: number;
}

export function renderLateFramePasses({
  renderLighting = true,
  ctx,
  frameStartTime,
  showFpsProfiler,
  timingMarks,
  cameraOffsetX,
  cameraOffsetY,
  holdInteractionProgress,
  isActivelyHolding,
  closestInteractableKnockedOutPlayerId,
  closestInteractableWaterPosition,
  visibleCampfiresMap,
  visibleFurnacesMap,
  visibleBarbecuesMap,
  visibleLanternsMap,
  visibleBoxesMap,
  visibleDoorsMap,
  visibleHomesteadHearthsMap,
  stashes,
  players,
  emptyMap,
  buildingClusters,
  monumentParts,
  cycleProgress,
  visibleRoadLamppostsMap,
  visibleBarrelsMap,
  visibleRuneStonesMap,
  nowMs,
  shipwreckPartsMap,
  viewBounds,
  showShipwreckDebug,
  localPlayerId,
  currentPredictedPosition,
  remotePlayerInterpolation,
  activeEquipments,
  itemDefinitions,
  currentWorldMouseX,
  currentWorldMouseY,
  isMobile,
  tapAnimation,
  vignetteOpacity,
  canvasWidth,
  canvasHeight,
  fpsProfilerRef,
  isProfilerRecording,
  ySortedEntityCount,
}: RenderLateFramePassesOptions): { frameTime: number } {
  renderInteractionIndicators({
    ctx,
    cameraOffsetX,
    cameraOffsetY,
    holdInteractionProgress,
    isActivelyHolding,
    closestInteractableKnockedOutPlayerId,
    closestInteractableWaterPosition,
    visibleCampfiresMap,
    visibleFurnacesMap,
    visibleBarbecuesMap,
    visibleLanternsMap,
    visibleBoxesMap,
    visibleDoorsMap,
    visibleHomesteadHearthsMap,
    stashes,
    players,
    emptyMap,
  });
  const t4 = mark(showFpsProfiler);

  if (renderLighting) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  renderAllStructureLights({
    ctx,
    cameraOffsetX,
    cameraOffsetY,
    buildingClusters,
    visibleCampfiresMap,
    visibleLanternsMap,
    visibleFurnacesMap,
    visibleBarbecuesMap,
  });

  if (monumentParts && monumentParts.size > 0) {
    monumentParts.forEach((part: any) => {
      const isVillageCampfire =
        (part.monumentType?.tag === 'FishingVillage' || part.monumentType?.tag === 'HuntingVillage') &&
        part.partType === 'campfire';
      if (isVillageCampfire) {
        renderFishingVillageCampfireLight({
          ctx,
          worldX: part.worldX,
          worldY: part.worldY,
          cameraOffsetX,
          cameraOffsetY,
          cycleProgress,
        });
      }
    });
  }

  visibleRoadLamppostsMap.forEach((lamppost: any) => {
    renderRoadLamppostLight({
      ctx,
      lamppost,
      cameraOffsetX,
      cameraOffsetY,
      cycleProgress,
    });
  });

  visibleBarrelsMap.forEach((barrel: any) => {
    if ((barrel.variant ?? 0) === 6) {
      renderBuoyLight({
        ctx,
        barrel,
        cameraOffsetX,
        cameraOffsetY,
        cycleProgress,
      });
    }
  });

  visibleRuneStonesMap.forEach((runeStone: any) => {
    renderRuneStoneNightLight(
      ctx,
      runeStone,
      cycleProgress,
      cameraOffsetX,
      cameraOffsetY,
      nowMs,
    );
  });

  if (shipwreckPartsMap && shipwreckPartsMap.size > 0) {
    renderAllShipwreckNightLights(
      ctx,
      shipwreckPartsMap,
      cycleProgress,
      cameraOffsetX,
      cameraOffsetY,
      viewBounds.minX,
      viewBounds.maxX,
      viewBounds.minY,
      viewBounds.maxY,
      nowMs,
    );

    renderCompoundEerieLights(
      ctx,
      cycleProgress,
      cameraOffsetX,
      cameraOffsetY,
      viewBounds.minX,
      viewBounds.maxX,
      viewBounds.minY,
      viewBounds.maxY,
      nowMs,
    );

    if (showShipwreckDebug) {
      renderAllShipwreckDebugZones(
        ctx,
        shipwreckPartsMap,
        cameraOffsetX,
        cameraOffsetY,
        viewBounds.minX,
        viewBounds.maxX,
        viewBounds.minY,
        viewBounds.maxY,
      );
    }
  }

  renderAllPlayerLights({
    ctx,
    players,
    localPlayerId,
    currentPredictedPosition,
    remotePlayerInterpolation,
    activeEquipments,
    itemDefinitions,
    cameraOffsetX,
    cameraOffsetY,
    buildingClusters,
    currentWorldMouseX,
    currentWorldMouseY,
  });

  if (localPlayerId && currentPredictedPosition) {
    renderSovaAura({
      ctx,
      playerWorldX: currentPredictedPosition.x,
      playerWorldY: currentPredictedPosition.y,
      cameraOffsetX,
      cameraOffsetY,
      cycleProgress,
    });
  }

  ctx.restore();
  }
  const t5 = mark(showFpsProfiler);

  if (isMobile && tapAnimation) {
    renderMobileTapAnimation({
      ctx,
      tapAnimation,
      cameraOffsetX,
      cameraOffsetY,
    });
  }

  if (vignetteOpacity > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const maxRadius = Math.sqrt(cx * cx + cy * cy);
    const gradient = ctx.createRadialGradient(cx, cy, maxRadius * 0.2, cx, cy, maxRadius);
    gradient.addColorStop(0, 'transparent');
    gradient.addColorStop(0.7, `rgba(180, 20, 20, ${vignetteOpacity * 0.7})`);
    gradient.addColorStop(1, `rgba(120, 0, 0, ${vignetteOpacity})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  }

  const frameTime = performance.now() - frameStartTime;

  if (showFpsProfiler) {
    const timings = { ...timingMarks, t4, t5 };
    const profiler = fpsProfilerRef.current;
    profiler.update(timings, frameTime, ySortedEntityCount);
    profiler.recordIfActive(timings, frameTime, ySortedEntityCount);
    profiler.render(ctx, canvasWidth, isProfilerRecording ?? false);
  }

  return { frameTime };
}
