/**
 * Profiler recording - capture frame timing samples for analysis.
 * Record → Stop → Copy to clipboard. Samples are stored in memory (capped).
 */

import { buildWebGpuSummary, resetWebGpuRecording } from '../engine/presentation/world3d/world3dProfiler';

export interface ProfilerSample {
  frameTime: number;
  entityCount: number;
  phaseWorld: number;
  phaseWorldBackground: number;
  phaseWorldCacheUpdate: number;
  phaseWorldBaseTiles: number;
  phaseWorldTransitions: number;
  phaseWorldDoodads: number;
  phaseWorldDoodadsTransitionChecks: number;
  phaseWorldDoodadsSpawnEvaluation: number;
  phaseWorldDoodadsBlurredDraws: number;
  phaseWorldDoodadsOpaqueDraws: number;
  phaseWorldPatches: number;
  phaseWater: number;
  phaseWaterSeaStacks: number;
  phaseWaterCaustics: number;
  phaseWaterSwimming: number;
  phaseWaterOverlay: number;
  phaseWaterOverlayGrid: number;
  phaseWaterOverlayShader: number;
  phaseWaterOverlayMask: number;
  phaseWaterOverlayComposite: number;
  phaseWaterOverlayDraw: number;
  phaseWaterShoreline: number;
  phaseEntities: number;
  phaseEntitiesFootprints: number;
  phaseEntitiesProjectileCollision: number;
  phaseEntitiesMainRender: number;
  phaseEntitiesSwimTop: number;
  phaseEntitiesYSorted: number;
  phaseEntitiesShadows: number;
  phaseEntitiesEffects: number;
  phaseEntitiesTranslatedUnder: number;
  phaseEntitiesCampfireFire: number;
  phaseEntitiesTranslatedOver: number;
  phaseEntitiesScreenFx: number;
  phaseEntitiesInteraction: number;
  phaseEntitiesOverlays: number;
  phaseLights: number;
  phaseOther: number;
}

export interface CameraProfilerSample {
  sampleIndex: number;
  dtMs: number;
  frameGapMs: number;
  playerX: number;
  playerY: number;
  playerDx: number;
  playerDy: number;
  playerDist: number;
  cameraX: number;
  cameraY: number;
  cameraDx: number;
  cameraDy: number;
  cameraDist: number;
  cameraJerk: number;
  serverX: number;
  serverY: number;
  predictedMinusServerX: number;
  predictedMinusServerY: number;
  predictedMinusServerDist: number;
  correctionDelta: number;
  reconciliationChanged: number;
  reconciliationEventType: string;
  reconciliationEventAgeMs: number;
  reconciliationErrorDist: number;
  reconciliationSequenceAdvance: number;
  tileX: number;
  tileY: number;
}

const MAX_SAMPLES = 5000; // ~2.5 min at 30fps
const samples: ProfilerSample[] = [];
const cameraSamples: CameraProfilerSample[] = [];
let isRecording = false;

export function startRecording(): void {
  resetWebGpuRecording();
  samples.length = 0;
  cameraSamples.length = 0;
  isRecording = true;
}

export function stopRecording(): void {
  isRecording = false;
}

export function isProfilerRecording(): boolean {
  return isRecording;
}

export function addSample(sample: ProfilerSample): void {
  if (!isRecording) return;
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export function addCameraSample(sample: CameraProfilerSample): void {
  if (!isRecording) return;
  cameraSamples.push({
    ...sample,
    sampleIndex: cameraSamples.length,
  });
  if (cameraSamples.length > MAX_SAMPLES) cameraSamples.shift();
}

export function getSampleCount(): number {
  return samples.length;
}

export function copyToClipboard(): Promise<boolean> {
  if (samples.length === 0 && cameraSamples.length === 0) return Promise.resolve(false);

  const header = 'frameTime,entityCount,world,worldBackground,worldCacheUpdate,worldBaseTiles,worldTransitions,worldDoodads,worldDoodadsTransitionChecks,worldDoodadsSpawnEvaluation,worldDoodadsBlurredDraws,worldDoodadsOpaqueDraws,worldPatches,water,waterSeaStacks,waterCaustics,waterSwimming,waterOverlay,waterOverlayGrid,waterOverlayShader,waterOverlayMask,waterOverlayComposite,waterOverlayDraw,waterShoreline,entities,entitiesFootprints,entitiesProjectileCollision,entitiesMainRender,entitiesSwimTop,entitiesYSorted,entitiesShadows,entitiesEffects,entitiesTranslatedUnder,entitiesCampfireFire,entitiesTranslatedOver,entitiesScreenFx,entitiesInteraction,entitiesOverlays,lights,other';
  const rows = samples.map(s =>
    [
      s.frameTime.toFixed(2),
      s.entityCount,
      s.phaseWorld.toFixed(2),
      s.phaseWorldBackground.toFixed(2),
      s.phaseWorldCacheUpdate.toFixed(2),
      s.phaseWorldBaseTiles.toFixed(2),
      s.phaseWorldTransitions.toFixed(2),
      s.phaseWorldDoodads.toFixed(2),
      s.phaseWorldDoodadsTransitionChecks.toFixed(2),
      s.phaseWorldDoodadsSpawnEvaluation.toFixed(2),
      s.phaseWorldDoodadsBlurredDraws.toFixed(2),
      s.phaseWorldDoodadsOpaqueDraws.toFixed(2),
      s.phaseWorldPatches.toFixed(2),
      s.phaseWater.toFixed(2),
      s.phaseWaterSeaStacks.toFixed(2),
      s.phaseWaterCaustics.toFixed(2),
      s.phaseWaterSwimming.toFixed(2),
      s.phaseWaterOverlay.toFixed(2),
      s.phaseWaterOverlayGrid.toFixed(2),
      s.phaseWaterOverlayShader.toFixed(2),
      s.phaseWaterOverlayMask.toFixed(2),
      s.phaseWaterOverlayComposite.toFixed(2),
      s.phaseWaterOverlayDraw.toFixed(2),
      s.phaseWaterShoreline.toFixed(2),
      s.phaseEntities.toFixed(2),
      s.phaseEntitiesFootprints.toFixed(2),
      s.phaseEntitiesProjectileCollision.toFixed(2),
      s.phaseEntitiesMainRender.toFixed(2),
      s.phaseEntitiesSwimTop.toFixed(2),
      s.phaseEntitiesYSorted.toFixed(2),
      s.phaseEntitiesShadows.toFixed(2),
      s.phaseEntitiesEffects.toFixed(2),
      s.phaseEntitiesTranslatedUnder.toFixed(2),
      s.phaseEntitiesCampfireFire.toFixed(2),
      s.phaseEntitiesTranslatedOver.toFixed(2),
      s.phaseEntitiesScreenFx.toFixed(2),
      s.phaseEntitiesInteraction.toFixed(2),
      s.phaseEntitiesOverlays.toFixed(2),
      s.phaseLights.toFixed(2),
      s.phaseOther.toFixed(2),
    ].join(',')
  );
  const csv = samples.length > 0 ? [header, ...rows].join('\n') : 'No FPS timing samples recorded.';

  // Summary block for quick analysis
  const fpsSummary = samples.length > 0
    ? (() => {
        const avgFrame = samples.reduce((a, s) => a + s.frameTime, 0) / samples.length;
        const maxFrame = Math.max(...samples.map(s => s.frameTime));
        const avgWater = samples.reduce((a, s) => a + s.phaseWaterOverlay, 0) / samples.length;
        const avgYSort = samples.reduce((a, s) => a + s.phaseEntitiesYSorted, 0) / samples.length;
        const avgLights = samples.reduce((a, s) => a + s.phaseLights, 0) / samples.length;
        const avg = (pick: (sample: ProfilerSample) => number) =>
          samples.reduce((total, sample) => total + pick(sample), 0) / samples.length;
        const max = (pick: (sample: ProfilerSample) => number) =>
          Math.max(...samples.map(pick));
        return [
          `=== Profiler Recording (${samples.length} samples) ===`,
          `Avg Frame: ${avgFrame.toFixed(2)}ms | Max: ${maxFrame.toFixed(2)}ms | FPS: ${(1000 / avgFrame).toFixed(1)}`,
          `Avg Water Overlay: ${avgWater.toFixed(2)}ms | YSort: ${avgYSort.toFixed(2)}ms | Lights: ${avgLights.toFixed(2)}ms`,
          `World Max: BG ${max(s => s.phaseWorldBackground).toFixed(2)}ms | Cache ${max(s => s.phaseWorldCacheUpdate).toFixed(2)}ms | Base ${max(s => s.phaseWorldBaseTiles).toFixed(2)}ms | Trans ${max(s => s.phaseWorldTransitions).toFixed(2)}ms | Doodads ${max(s => s.phaseWorldDoodads).toFixed(2)}ms | Patches ${max(s => s.phaseWorldPatches).toFixed(2)}ms`,
          `World Doodads Max: Check ${max(s => s.phaseWorldDoodadsTransitionChecks).toFixed(2)}ms | Eval ${max(s => s.phaseWorldDoodadsSpawnEvaluation).toFixed(2)}ms | Blur ${max(s => s.phaseWorldDoodadsBlurredDraws).toFixed(2)}ms | Opaq ${max(s => s.phaseWorldDoodadsOpaqueDraws).toFixed(2)}ms`,
          `Water Max: Sea ${max(s => s.phaseWaterSeaStacks).toFixed(2)}ms | Caustics ${max(s => s.phaseWaterCaustics).toFixed(2)}ms | Swim ${max(s => s.phaseWaterSwimming).toFixed(2)}ms | Surface ${max(s => s.phaseWaterOverlay).toFixed(2)}ms | Shore ${max(s => s.phaseWaterShoreline).toFixed(2)}ms`,
          `Water Surface Max: Grid ${max(s => s.phaseWaterOverlayGrid).toFixed(2)}ms | GPU ${max(s => s.phaseWaterOverlayShader).toFixed(2)}ms | Mask ${max(s => s.phaseWaterOverlayMask).toFixed(2)}ms | Comp ${max(s => s.phaseWaterOverlayComposite).toFixed(2)}ms | Draw ${max(s => s.phaseWaterOverlayDraw).toFixed(2)}ms`,
          `Entities Avg/Max: Footprints ${avg(s => s.phaseEntitiesFootprints).toFixed(2)}/${max(s => s.phaseEntitiesFootprints).toFixed(2)}ms | Coll ${avg(s => s.phaseEntitiesProjectileCollision).toFixed(2)}/${max(s => s.phaseEntitiesProjectileCollision).toFixed(2)}ms | Main ${avg(s => s.phaseEntitiesMainRender).toFixed(2)}/${max(s => s.phaseEntitiesMainRender).toFixed(2)}ms | Swim ${avg(s => s.phaseEntitiesSwimTop).toFixed(2)}/${max(s => s.phaseEntitiesSwimTop).toFixed(2)}ms | YSort ${avgYSort.toFixed(2)}/${max(s => s.phaseEntitiesYSorted).toFixed(2)}ms | Shadows ${avg(s => s.phaseEntitiesShadows).toFixed(2)}/${max(s => s.phaseEntitiesShadows).toFixed(2)}ms`,
          `Entity Overlay Max: FX ${max(s => s.phaseEntitiesEffects).toFixed(2)}ms | Under ${max(s => s.phaseEntitiesTranslatedUnder).toFixed(2)}ms | Fire ${max(s => s.phaseEntitiesCampfireFire).toFixed(2)}ms | Over ${max(s => s.phaseEntitiesTranslatedOver).toFixed(2)}ms | Screen ${max(s => s.phaseEntitiesScreenFx).toFixed(2)}ms | UI ${max(s => s.phaseEntitiesInteraction).toFixed(2)}ms`,
          '',
          csv,
        ].join('\n');
      })()
    : [
        '=== Profiler Recording (0 samples) ===',
        csv,
      ].join('\n');

  const cameraSummary = buildCameraSummary();
  const summary = [fpsSummary, cameraSummary, buildWebGpuSummary()].filter(Boolean).join('\n\n');

  return navigator.clipboard.writeText(summary).then(() => true).catch(() => false);
}

function buildCameraSummary(): string | null {
  if (cameraSamples.length === 0) return null;

  const avgCameraDist = cameraSamples.reduce((a, s) => a + s.cameraDist, 0) / cameraSamples.length;
  const maxCameraDist = Math.max(...cameraSamples.map(s => s.cameraDist));
  const maxCameraJerk = Math.max(...cameraSamples.map(s => s.cameraJerk));
  const maxFrameGap = Math.max(...cameraSamples.map(s => s.frameGapMs));
  const maxCorrection = Math.max(...cameraSamples.map(s => s.predictedMinusServerDist));
  const maxCorrectionDelta = Math.max(...cameraSamples.map(s => s.correctionDelta));
  const largeFrameGaps = cameraSamples.filter(s => s.frameGapMs >= 50).length;
  const largeCameraSteps = cameraSamples.filter(s => s.cameraDist >= 24 || s.cameraJerk >= 16).length;
  const hitchCandidates = cameraSamples.filter(s =>
    s.frameGapMs >= 50 ||
    s.cameraJerk >= 16 ||
    s.cameraDist >= 24
  ).length;
  const reconciliationEvents = cameraSamples.filter(s => s.reconciliationChanged === 1);
  const framesNearReconciliation = cameraSamples.filter(s =>
    s.reconciliationEventAgeMs >= 0 && s.reconciliationEventAgeMs <= 50
  ).length;
  const maxReconciliationError = reconciliationEvents.length > 0
    ? Math.max(...reconciliationEvents.map(s => s.reconciliationErrorDist))
    : 0;
  const maxReconciliationSequenceAdvance = reconciliationEvents.length > 0
    ? Math.max(...reconciliationEvents.map(s => s.reconciliationSequenceAdvance))
    : 0;

  const header = 'sampleIndex,dtMs,frameGapMs,playerX,playerY,playerDx,playerDy,playerDist,cameraX,cameraY,cameraDx,cameraDy,cameraDist,cameraJerk,serverX,serverY,predictedMinusServerX,predictedMinusServerY,predictedMinusServerDist,correctionDelta,reconciliationChanged,reconciliationEventType,reconciliationEventAgeMs,reconciliationErrorDist,reconciliationSequenceAdvance,tileX,tileY';
  const rows = cameraSamples.map(s => [
    s.sampleIndex,
    s.dtMs.toFixed(2),
    s.frameGapMs.toFixed(2),
    s.playerX.toFixed(2),
    s.playerY.toFixed(2),
    s.playerDx.toFixed(2),
    s.playerDy.toFixed(2),
    s.playerDist.toFixed(2),
    s.cameraX.toFixed(2),
    s.cameraY.toFixed(2),
    s.cameraDx.toFixed(2),
    s.cameraDy.toFixed(2),
    s.cameraDist.toFixed(2),
    s.cameraJerk.toFixed(2),
    s.serverX.toFixed(2),
    s.serverY.toFixed(2),
    s.predictedMinusServerX.toFixed(2),
    s.predictedMinusServerY.toFixed(2),
    s.predictedMinusServerDist.toFixed(2),
    s.correctionDelta.toFixed(2),
    s.reconciliationChanged,
    s.reconciliationEventType,
    s.reconciliationEventAgeMs.toFixed(2),
    s.reconciliationErrorDist.toFixed(2),
    s.reconciliationSequenceAdvance,
    s.tileX,
    s.tileY,
  ].join(','));

  return [
    `=== Camera Profiler Recording (${cameraSamples.length} samples) ===`,
    `Avg Camera Step: ${avgCameraDist.toFixed(2)}px | Max Step: ${maxCameraDist.toFixed(2)}px | Max Jerk: ${maxCameraJerk.toFixed(2)}px`,
    `Max Frame Gap: ${maxFrameGap.toFixed(2)}ms | Large Frame Gaps: ${largeFrameGaps} | Large Camera Steps: ${largeCameraSteps}`,
    `Max Prediction Error: ${maxCorrection.toFixed(2)}px | Max Correction Delta: ${maxCorrectionDelta.toFixed(2)}px | Hitch Candidates: ${hitchCandidates}`,
    `Reconcile Events: ${reconciliationEvents.length} | Frames <=50ms After Reconcile: ${framesNearReconciliation} | Max Ack Error: ${maxReconciliationError.toFixed(2)}px | Max Seq Advance: ${maxReconciliationSequenceAdvance}`,
    '',
    header,
    ...rows,
  ].join('\n');
}
