import type { ProfilerTimings } from '../../../utils/profiler';

export interface World3dProfile {
  frame: number; startMs: number; cpuMs: number; cameraMs: number; terrainMs: number; waterMs: number;
  entitiesMs: number; batchesMs: number; lightingMs: number; submitMs: number;
  terrainRebuilt: number; terrainTiles: number; terrainReason: string; newVisuals: number; newPrototypes: number;
  terrainBuildMs?: number;
  warmupMs?: number;
  drawCalls: number; triangles: number; gpuMs: number | null; gpuFrame: number | null;
}
export interface WebGpuFrameProfile extends World3dProfile {
  frameGapMs: number; preparationMs: number; totalCpuMs: number; weatherMs: number; uiMs: number;
}
const samples: WebGpuFrameProfile[] = [];
export function resetWebGpuRecording(): void { samples.length = 0; }
export function addWebGpuSample(sample: WebGpuFrameProfile): void {
  samples.push(sample); if (samples.length > 5000) samples.shift();
}

/** Feed broad CPU phase costs into the unchanged profiler painter. Frame time
 * supplied separately is the real callback interval, so its FPS is cadence.
 * Renderer-specific detail belongs in the copied recording, not new HUD UI. */
export function webGpuProfilerTimings(s: WebGpuFrameProfile): ProfilerTimings {
  const t0 = s.startMs - s.preparationMs, t1 = t0 + s.preparationMs + s.cameraMs + s.terrainMs;
  const t2 = t1 + s.waterMs, entityEnd = t2 + s.entitiesMs + s.batchesMs, weatherEnd = entityEnd + s.weatherMs;
  const t4 = weatherEnd + s.uiMs, t5 = t4 + s.lightingMs;
  // These are duration adapters, not a chronological trace. Inactive legacy
  // sprite/Y-sort passes stay at zero; 3D sync maps to Main, rain to Screen FX.
  return {t0, t0a:t0, t1, t1a:t1, t1b:t1, t1c:t2, t1d:t2, t2, t2a:t2, t2b:t2, t2c:t2+s.entitiesMs, t3:t2, t3a:t2,
    t3f:entityEnd, t3g:weatherEnd, t4, t5, worldCacheUpdateMs:s.terrainMs};
}
export function buildWebGpuSummary(): string | null {
  if (!samples.length) return null;
  const percentile = (pick: (s: WebGpuFrameProfile) => number, p: number) => {
    const values = samples.map(pick).sort((a,b) => a-b); return values[Math.min(values.length-1, Math.floor((values.length-1)*p))].toFixed(2);
  };
  const maximum = (pick: (s: WebGpuFrameProfile) => number) => Math.max(...samples.map(pick)).toFixed(2);
  const keys = Object.keys(samples[0]) as (keyof WebGpuFrameProfile)[];
  return [
    `=== WebGPU Profiler Recording (${samples.length} samples) ===`,
    'Frame time/FPS above use callback intervals. CPU costs below include 3D submission and the original weather/UI. GPU time is asynchronous timestamp-query work; blank means unavailable. gpuFrame identifies its source frame, not necessarily the current row. terrainBuildMs is worker CPU time; terrainMs measures main-thread request/apply work.',
    `Frame gap p95/p99/max: ${percentile(s=>s.frameGapMs,.95)}/${percentile(s=>s.frameGapMs,.99)}/${maximum(s=>s.frameGapMs)}ms | CPU p95/p99/max: ${percentile(s=>s.totalCpuMs,.95)}/${percentile(s=>s.totalCpuMs,.99)}/${maximum(s=>s.totalCpuMs)}ms`,
    `Max terrain: ${maximum(s=>s.terrainMs)}ms | entity sync: ${maximum(s=>s.entitiesMs)}ms | submit: ${maximum(s=>s.submitMs)}ms | weather: ${maximum(s=>s.weatherMs)}ms | UI: ${maximum(s=>s.uiMs)}ms | terrain rebuilds: ${samples.reduce((n,s)=>n+s.terrainRebuilt,0)}`,
    `Max async terrain build: ${maximum(s=>s.terrainBuildMs??0)}ms | material preparation in frame: ${maximum(s=>s.warmupMs??0)}ms`,
    keys.join(','), ...samples.map(s=>keys.map(key=>typeof s[key] === 'number' ? (s[key] as number).toFixed(3) : s[key] ?? '').join(',')),
  ].join('\n');
}
