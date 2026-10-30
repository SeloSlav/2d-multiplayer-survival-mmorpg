import {
  AmbientLight, BufferGeometry, Color, DirectionalLight, Group, HemisphereLight, Mesh,
  OrthographicCamera, PointLight, Renderer,
  Scene, SRGBColorSpace, StandardNodeLibrary, Vector3, WebGPUBackend, ACESFilmicToneMapping,
} from 'three/webgpu';
import { AnimalRig } from './animals';
import {
  createBarrel, createCampfire, createPlant, createRock, createTree,
} from './environmentModels';
import { BUILDING, pointOnFoundation } from './buildingPlan';
import { groundPosition, isCompoundBuilding } from './groundAnchor';
import { createFoundationModel, createWallModel, createFenceModel, DoorRig } from './buildingModels';
import { createStorageModel } from './storageModels';
import { createAlkBuilding, createAlkTurret } from './alkModels';
import type { AlkAsset } from './alkModels';
import { COMPOUND_BUILDINGS, getBuildingWorldPosition } from '../../../config/compoundBuildings';
import { createFurnace, createBarbecue, createLantern, createHearth, createBrothPot, createSleepingBag, createStash, createShelter, createRainCollector, CAMP_MODEL_TABLES } from './campModels';
import { ModelKit } from './modelKit';
import { SurvivorRig } from './survivor';
import { RangedAnimationTimeline, reloadPhase, timestampMs } from './actorAnimation';
import { actorInteraction } from './interactionAnimation';
import { FootContactEffects3d } from './FootContactEffects3d';
import { ProjectileWorld3d } from './ProjectileWorld3d';
import { isThrowableMelee } from '../../runtime/throwableMelee';
import { ExplosionEffects3d } from './ExplosionEffects3d';
import { FishingEffects3d } from './FishingEffects3d';
import { createPlacedExplosive } from './explosiveModels';
import type { ItemDefinition, Projectile } from '../../../generated/types';
import { StaticWorldBatches } from './StaticWorldBatches';
import { PlacementPreview3d } from './PlacementPreview3d';
import type { PlacementPreviewPlan } from '../../placement/placementValidation';
import { pixelCameraPlan } from './pixelCamera';
import { SwimmingEffects3d } from './SwimmingEffects3d';
import { TreeFallEffects3d } from './TreeFallEffects3d';
import { CombatEffects3d, COMBAT_FEEDBACK_KINDS } from './CombatEffects3d';
import { MemoryShardGlow3d } from './MemoryShardGlow3d';
import { CollectibleGlitter3d } from './CollectibleGlitter3d';
import { PLANT_PROFILES } from './plantCatalog';
import { UnderwaterView3d } from './UnderwaterView3d';
import { NATURAL_OBJECT_TABLES, createRuneStone, createCairn, createCoral, createGeologicalObject, createKelp } from './naturalObjects';
import { WaterWorld3d, seabedAnchor } from './WaterWorld3d';
import type { WaterKind } from './WaterWorld3d';
import { TerrainMaterials3d } from './terrainMaterials';
import { createTerrainGround, terrainGeometry } from './terrainGround';
import { TerrainBuildQueue } from './TerrainBuildQueue';
import { PipelineWarmup3d } from './PipelineWarmup3d';
import { ShelterRig, ShelterVisibility, shelterOwnerInside } from './shelterModels';
import { resolveWornArmor } from './survivorArmor';
import { createDroppedModel, droppedModelCacheKey } from './droppedModels';
import { VillageRig, createVillageModel } from './villageModels';
import { villageAsset, villageCullMargin } from './villagePlans';
import type { TerrainBuild } from './terrainBuild';
import { createBuoy, floatingPose } from './buoy';
import { isNightTime } from '../../../config/dayNightConstants';
import { configureWaterShadows } from './waterShadows';
import { treeFallPlayback } from '../../../utils/treeFallAudioSync';
import type { TreeFallPlayback } from '../../../utils/treeFallAudioSync';
import { TerrainWindow3d } from './TerrainWindow3d';
import { GroundDetail3d } from './GroundDetail3d';
import { worldLightAt } from './WorldLighting3d';
import type { World3dProfile } from './world3dProfiler';
import {
  GROUND_Y_SCALE, seedFromId, TERRAIN_PALETTE, WATER_TERRAINS,
  WORLD_3D, worldToScene,
} from './visualContract';
import type { PresentationStatus, VisualDebugMode } from './visualContract';
import type { PresentationEntity as Row } from './presentationEntity';

export interface World3dFrame {
  width: number;
  height: number;
  cameraOffset: { x: number; y: number };
  tables: Record<string, unknown>;
  localPlayerId?: string;
  predictedPosition?: { x: number; y: number } | null;
  facing?: string;
  jumpStartMs?: number;
  rollProgress?: number;
  shadows?: boolean;
  cloudsEnabled?: boolean;
  grassAnimationEnabled?: boolean;
  timeSeconds?: number;
  nowMs?: number;
  debug?: VisualDebugMode;
  zoom?: number;
  placement?: PlacementPreviewPlan | null;
  profile?: boolean;
  getRemotePlayerPosition?: (player: Row) => { x: number; y: number };
}

interface EntityVisual {
  root: Group;
  signature: string;
  survivor?: SurvivorRig;
  animal?: AnimalRig;
  lastX: number;
  lastY: number;
  fire?: Group;
  door?: DoorRig;
  corpseYaw?: number;
  shelter?: ShelterRig;
  village?: VillageRig;
  treeAudio?: TreeFallPlayback & { fallStartedAt:number };
}

interface LocalLight { position: Vector3; color: number; intensity: number; priority?: number }

const STATIC_TABLES = [
  'trees', 'stones', 'campfires', 'woodenStorageBoxes', 'barrels', 'foundationCells',
  'wallCells', 'harvestableResources', 'fences', 'doors', ...CAMP_MODEL_TABLES, ...NATURAL_OBJECT_TABLES,
  'droppedItems', 'monumentParts', 'alkStations', 'turrets',
  'playerCorpses', 'placedExplosives',
] as const;
const UNFINISHED_TABLES = [
  'plantedSeeds', 'waterPatches',
  'fertilizerPatches', 'firePatches',
] as const;

function rows(value: unknown): Iterable<[string, Row]> {
  return value instanceof Map ? value as Map<string, Row> : [];
}
function tag(value: unknown): string {
  return typeof value === 'string' ? value : value && typeof value === 'object' && 'tag' in value ? String(value.tag) : '';
}
function identity(value: unknown): string {
  return value && typeof value === 'object' && 'toHexString' in value && typeof value.toHexString === 'function'
    ? value.toHexString() : String(value ?? '');
}
function coralVariant(id: string): number { return /^\d+$/.test(id) ? Number(BigInt(id) % 4n) : seedFromId(id) % 4; }
function cycleOf(frame: World3dFrame): number { return (frame.tables.worldState as Row | null)?.cycleProgress ?? .45; }
function yaw(direction: string): number {
  const value = direction.toLowerCase();
  const x = value.includes('right') || value === 'e' || value === 'east' ? 1 : value.includes('left') || value === 'w' || value === 'west' ? -1 : 0;
  const z = value.includes('up') || value === 'n' || value === 'north' ? -1 : value.includes('down') || value === 's' || value === 'south' ? 1 : 0;
  return x || z ? Math.atan2(x, z) : 0;
}

/** Sole owner of the 3D world canvas. It cannot construct a WebGL backend. */
export class WebGpuWorldRenderer {
  private static readonly canvasReleases = new WeakMap<HTMLCanvasElement, Promise<void>>();
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-10, 10, 7, -7, 0.1, 160);
  readonly kit = new ModelKit();
  readonly unfinished = new Set<string>();
  private readonly compoundLandmarks = new Map(COMPOUND_BUILDINGS.map(building=>{
    const position=getBuildingWorldPosition(building);
    return [building.id,{worldX:position.x,worldY:position.y+(building.collisionAabb?.centerYOffset??-building.collisionYOffset),name:building.id}] as const;
  }));
  private renderer: Renderer | null = null;
  private initializing = false;
  private initialization: Promise<void> | null = null;
  private disposal: Promise<void> | null = null;
  private disposed = false;
  private failed = false;
  private readonly visuals = new Map<string, EntityVisual>();
  private readonly prototypes = new Map<string, Group>();
  private readonly batches = new StaticWorldBatches(this.scene);
  private readonly placementPreview = new PlacementPreview3d(this.kit);
  private readonly swimmingEffects = new SwimmingEffects3d();
  private readonly treeFallEffects = new TreeFallEffects3d(this.kit);
  private readonly combatEffects = new CombatEffects3d(this.kit);
  private readonly footEffects = new FootContactEffects3d(this.kit);
  private readonly projectileWorld = new ProjectileWorld3d(this.kit, this.batches);
  private readonly explosionEffects = new ExplosionEffects3d(this.kit);
  private readonly fishingEffects = new FishingEffects3d(this.kit);
  private readonly rangedTimeline = new RangedAnimationTimeline();
  private readonly thrownAt = new Map<string, number>();
  private readonly shardGlow = new MemoryShardGlow3d();
  private readonly collectibleGlitter = new CollectibleGlitter3d();
  private readonly underwater = new UnderwaterView3d(this.camera);
  private diving = false;
  private readonly terrainMaterials = new TerrainMaterials3d();
  private readonly groundDetail = new GroundDetail3d();
  private readonly terrainWindow = new TerrainWindow3d();
  private terrainWorker: TerrainBuildQueue | null = null;
  private readyTerrain: {build:TerrainBuild;tiles:Row[];reason:string} | null = null;
  private terrainBuildMs = 0;
  private readonly pipelineWarmup = new PipelineWarmup3d();
  private readonly dormantLightEffects: Group[] = [];
  readonly shelterVisibility = new ShelterVisibility();
  private readonly water = new WaterWorld3d(this.kit, this.terrainMaterials);
  private readonly terrain: Mesh;
  private readonly sun = new DirectionalLight(0xffe3b2, 2.7);
  private readonly sky = new HemisphereLight(0xb9d0ce, 0x59604b, 2);
  private readonly flatLight = new AmbientLight(0xffffff, 0);
  private readonly lights: PointLight[] = [];
  private readonly foundationCells = new Map<string, Row[]>();
  private readonly roofCells = new Set<string>();
  private readonly indoorCells = new Set<string>();
  private readonly seaTiles = new Set<string>();
  private readonly hotSpringTiles = new Set<string>();
  private readonly waterTiles = new Map<string, WaterKind>();
  private readonly terrainKinds = new Map<string, string>();
  private previousTime = 0;
  private motionDelta = 1 / 60;
  private lastTerrain = '';
  private lastSize = '';
  private debug: VisualDebugMode = 'lit';
  private frameCount = 0;
  private device: GPUDevice | null = null;
  private readonly bootTime = performance.now();
  lastProfile: World3dProfile | null = null;
  private terrainTileCount = 0;
  private frameNewVisuals = 0;
  private gpuTimingPending = false;
  private gpuTiming: {ms: number; frame: number} | null = null;
  private readonly profileWindow: World3dProfile[] = [];

  constructor(readonly canvas: HTMLCanvasElement, private readonly onStatus: (status: PresentationStatus) => void = () => {}) {
    this.scene.background = new Color(0x475e60);
    this.scene.add(this.sun, this.sun.target, this.sky, this.flatLight, this.camera, this.underwater.silhouettes);
    this.scene.add(this.placementPreview.root);
    this.scene.add(this.swimmingEffects.root);
    this.scene.add(this.treeFallEffects.root);
    this.scene.add(this.combatEffects.root);
    this.scene.add(this.footEffects.root);
    this.scene.add(this.projectileWorld.root, this.explosionEffects.root, this.fishingEffects.root);
    this.scene.add(this.shardGlow.root);
    this.scene.add(this.collectibleGlitter.root);
    this.scene.add(this.water.root);
    this.sun.castShadow = true;
    // Three's analytic light node accepts a color node, allowing cloud cover to
    // affect every lit material without multiplying local or emissive lights.
    (this.sun as DirectionalLight & {colorNode: unknown}).colorNode = this.terrainMaterials.cloudShadows.directLight;
    this.sun.shadow.mapSize.setScalar(WORLD_3D.shadowMapSize);
    this.sun.shadow.camera.near = 0.1;
    this.sun.shadow.camera.far = 100;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.025;
    configureWaterShadows(this.sun);
    this.terrain = new Mesh(new BufferGeometry(), this.terrainMaterials.material);
    this.terrain.name = 'continuous-terrain-and-seabed';
    this.terrain.receiveShadow = true;
    this.terrain.frustumCulled = false;
    this.scene.add(this.terrain);
    this.scene.add(this.groundDetail.root);
    for (let i = 0; i < WORLD_3D.maxLocalLights; i++) {
      const light = new PointLight(0xffac63, 0, 5, 2);
      this.lights.push(light);
      this.scene.add(light);
    }
  }

  initialize(): Promise<void> {
    if (!this.initialization) this.initialization = this.initializeBackend();
    return this.initialization;
  }

  private async initializeBackend(): Promise<void> {
    if (this.initializing || this.renderer || this.failed || this.disposed) return;
    this.initializing = true;
    this.onStatus({ phase: 'initializing', message: 'Starting WebGPU…' });
    let candidate: Renderer | null = null;
    try {
      await WebGpuWorldRenderer.canvasReleases.get(this.canvas);
      if (this.disposed) return;
      if (!globalThis.isSecureContext || !navigator.gpu) throw new Error('This game requires WebGPU in a secure browser context.');
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (this.disposed) return;
      if (!adapter) throw new Error('No WebGPU adapter is available. Enable hardware acceleration and use a WebGPU-capable browser.');
      const device = await adapter.requestDevice({ requiredFeatures: [...adapter.features] as GPUFeatureName[] });
      if (this.disposed) { device.destroy(); return; }
      this.device = device;
      // Use the base renderer with an explicit backend. WebGPURenderer installs a
      // WebGL fallback in its constructor, even when forceWebGL is false.
      candidate = new Renderer(new WebGPUBackend({ canvas: this.canvas, device }), { getFallback: null, alpha: false, antialias: false });
      candidate.library = new StandardNodeLibrary();
      candidate.outputColorSpace = SRGBColorSpace;
      candidate.toneMapping = ACESFilmicToneMapping;
      candidate.toneMappingExposure = 1.12;
      candidate.shadowMap.enabled = true;
      candidate.setPixelRatio(1);
      await candidate.init();
      if (this.disposed) { await candidate.dispose(); return; }
      this.renderer = candidate;
      if (typeof Worker !== 'undefined') this.terrainWorker = new TerrainBuildQueue(
        new Worker(new URL('./terrain.worker.ts', import.meta.url), {type:'module'}),
        (build, tiles, reason) => { if (!this.disposed) this.readyTerrain = {build, tiles, reason}; },
        message => this.fail(message));
      void device.lost.then((info) => {
        if (!this.disposed) this.fail(`The WebGPU device was lost (${info.reason}). Reload to reconnect.`);
      });
      this.canvas.dataset.renderer = 'three-webgpu';
      this.onStatus({ phase: 'ready', message: 'WebGPU ready' });
    } catch (error) {
      if (candidate) { try { await candidate.dispose(); } catch { /* Initialization can fail before resources exist. */ } }
      this.device?.destroy();
      this.device = null;
      if (!this.disposed) this.fail(error instanceof Error ? error.message : String(error));
    } finally { this.initializing = false; }
  }

  private fail(message: string): void {
    this.failed = true;
    this.canvas.dataset.renderer = 'webgpu-error';
    this.onStatus({ phase: 'error', message });
  }

  render(frame: World3dFrame): void {
    this.lastProfile = null;
    if (this.disposed || this.failed) return;
    if (!this.renderer) { void this.initialize(); return; }
    const start = performance.now();
    const prototypesBefore = this.prototypes.size;
    this.frameNewVisuals = 0;
    // Installed Three.js exposes this flag; its Backend declaration omits it.
    const backend = this.renderer.backend as typeof this.renderer.backend & {trackTimestamp:boolean};
    backend.trackTimestamp = Boolean(frame.profile && this.device?.features.has('timestamp-query'));
    const time = frame.timeSeconds ?? (start - this.bootTime) / 1000;
    this.motionDelta = this.previousTime ? Math.max(0, time - this.previousTime) : 1 / 60;
    const dt = Math.min(0.05, this.motionDelta);
    this.previousTime = time;
    this.configureCamera(frame);
    const cameraEnd = performance.now();
    const terrainReason = this.updateTerrain(frame);
    const terrainEnd = performance.now();
    if (!this.terrainMaterials.ready) return;
    const local = [...rows(frame.tables.players)].find(([id, row]) => (identity(row.identity) || id) === frame.localPlayerId)?.[1];
    this.diving = Boolean(local?.isSnorkeling);
    this.terrainMaterials.setDiving(this.diving);
    this.terrainMaterials.cloudShadows.update(frame.tables.interpolatedClouds, -frame.cameraOffset.x + frame.width / 2, -frame.cameraOffset.y + frame.height / 2, frame.cloudsEnabled !== false);
    this.underwater.beginFrame(this.camera,this.diving,time);
    this.swimmingEffects.root.visible = !this.diving;
    const cycle = (frame.tables.worldState as Row | null)?.cycleProgress ?? .45;
    const worldState = frame.tables.worldState as {isFullMoon?:boolean;cycleCount?:number} | undefined;
    const celestial = worldLightAt(cycle,worldState?.isFullMoon,worldState?.cycleCount);
    const weatherState = frame.tables.worldState as { rainIntensity?: number; currentWeather?: unknown } | undefined;
    let windRain = weatherState?.rainIntensity ?? 0, windStorm = /Storm|Thunder|Blizzard/.test(tag(weatherState?.currentWeather));
    if (frame.tables.chunkWeather instanceof Map) for (const weather of frame.tables.chunkWeather.values()) {
      windRain = Math.max(windRain, weather.rainIntensity ?? 0);
      windStorm ||= /Storm|Thunder|Blizzard/.test(tag(weather.currentWeather));
    }
    this.kit.wind.update(time, windRain, windStorm, frame.debug === 'fields');
    this.water.beginFrame(time, Math.max(.08, celestial.daylight), this.diving);
    const waterEnd = performance.now();
    const seen = new Set<string>();
    const fires: LocalLight[] = [];
    this.dormantLightEffects.length = 0;
    this.batches.beginFrame();
    this.swimmingEffects.beginFrame();
    this.treeFallEffects.beginFrame();
    this.shardGlow.beginFrame(time);
    this.collectibleGlitter.beginFrame(time, cycle, this.camera.quaternion);
    this.prepareBuildings(frame);
    this.groundDetail.update(frame.tables.interpolatedGrass, this.terrainKinds, time, frame.grassAnimationEnabled !== false, (x,y) => this.floorAt(x,y), frame.tables.chunkWeather, weatherState?.currentWeather);
    const renderNow = frame.nowMs ?? Date.now();
    if (frame.tables.projectiles instanceof Map && frame.tables.itemDefinitions instanceof Map) {
      for (const shot of frame.tables.projectiles.values()) {
        const def = frame.tables.itemDefinitions.get(String(shot.itemDefId));
        if (shot.sourceType !== 0 || shot.itemDefId !== shot.ammoDefId || !isThrowableMelee(def)) continue;
        const owner = identity(shot.ownerId), at = timestampMs(shot.startTime);
        if (owner && at > (this.thrownAt.get(owner) ?? 0)) this.thrownAt.set(owner, at);
      }
    }
    for (const [owner, at] of this.thrownAt) if (renderNow - at > 700) this.thrownAt.delete(owner);
    this.shelterVisibility.prepare(frame.tables.shelters instanceof Map?frame.tables.shelters.values():[],frame.localPlayerId,frame.predictedPosition);
    for (const kind of STATIC_TABLES) this.syncTable(kind, frame, dt, time, seen, fires);
    this.syncTable('compoundLandmarks', {...frame,tables:{...frame.tables,compoundLandmarks:this.compoundLandmarks}},dt,time,seen,fires);
    this.syncTable('players', frame, dt, time, seen, fires);
    this.syncTable('wildAnimals', frame, dt, time, seen, fires);
    this.syncTable('animalCorpses', frame, dt, time, seen, fires);
    this.projectileWorld.update(frame.tables.projectiles instanceof Map ? frame.tables.projectiles as Map<string, Projectile> : new Map(),
      frame.tables.itemDefinitions instanceof Map ? frame.tables.itemDefinitions as Map<string, ItemDefinition> : new Map(), frame.nowMs ?? Date.now(),
      (owner, target) => {
        const survivor = this.visuals.get(`players:${owner}`)?.survivor?.root;
        const muzzle = survivor?.getObjectByName('muzzle') ?? survivor?.getObjectByName('projectile-origin') ?? survivor?.getObjectByName('right-hand-socket');
        if (!muzzle) return false; muzzle.getWorldPosition(target); return true;
      }, (x, y) => this.shelterVisibility.occludes(x, y));
    this.fishingEffects.update(frame.tables.fishingSessions instanceof Map ? frame.tables.fishingSessions : new Map(), frame.nowMs ?? Date.now(), (owner, target) => {
      const visual = this.visuals.get(`players:${owner}`), tip = visual?.survivor?.root.getObjectByName('rod-tip');
      if (!tip || !visual?.root.visible) return false; tip.getWorldPosition(target); return true;
    }, this.diving);
    // Visible markers ensure missing content is inspectable throughout migration.
    for (const kind of UNFINISHED_TABLES) this.syncTable(kind, frame, dt, time, seen, fires);
    const ceilings = new Map<string, Row>();
    for (const [id, row] of rows(frame.tables.foundationCells)) {
      const cell = `${row.cellX},${row.cellY}`;
      if (!row.isDestroyed && row.shape !== 0 && this.roofCells.has(cell) && !this.indoorCells.has(cell)) ceilings.set(id, row);
    }
    this.syncTable('ceilings', { ...frame, tables: { ...frame.tables, ceilings } }, dt, time, seen, fires);
    for (const [key, visual] of this.visuals) if (!seen.has(key)) {
      this.scene.remove(visual.root);
      this.visuals.delete(key);
    }
    this.placementPreview.update(frame.placement ?? null, descriptor => {
      if (descriptor.unfinished) this.unfinished.add(`placement:${descriptor.unfinished}`);
      const variant = JSON.stringify({ ...descriptor.row, posX: 0, posY: 0, cellX: 0, cellY: 0 });
      return this.createVisual(descriptor.kind, descriptor.row, 'placement-ghost', variant, 0, 0).root;
    }, (x, y) => this.floorAt(x, y));
    this.swimmingEffects.endFrame(time);
    this.treeFallEffects.endFrame();
    const effectZoom=Math.max(.5,Math.min(2,frame.zoom??1));
    this.combatEffects.apparitions.observeDeaths(frame.tables.hostileDeathEvents,renderNow,(x,y)=>{
      const sx=(x+frame.cameraOffset.x-frame.width/2)*effectZoom+frame.width/2;
      const sy=(y+frame.cameraOffset.y-frame.height/2)*effectZoom+frame.height/2;
      return !this.diving&&!this.shelterVisibility.occludes(x,y)&&sx>=-240&&sx<=frame.width+240&&sy>=-240&&sy<=frame.height+240;
    },(x,y)=>this.floorAt(x,y));
    this.combatEffects.update(frame.nowMs??Date.now());
    this.footEffects.update(time, this.diving);
    this.explosionEffects.update(frame.nowMs ?? Date.now(), this.diving);
    this.shardGlow.endFrame();
    this.collectibleGlitter.endFrame();
    this.underwater.endFrame();
    if (frame.profile) this.canvas.dataset.animationEffects = JSON.stringify({
      projectiles: this.projectileWorld.activeCount, projectileTrails: this.projectileWorld.trails.count,
      contactParticles: this.footEffects.particles.count, footprints: this.footEffects.prints.count,
      explosionParticles: this.explosionEffects.particles.count, fishingFloats: this.fishingEffects.floats.count, wind: this.kit.wind.intensity,
      apparitionBursts: this.combatEffects.apparitions.activeCount, apparitionWisps: this.combatEffects.apparitions.wisps.count,
    });
    const entitiesEnd = performance.now();
    this.batches.flush();
    const batchesEnd = performance.now();
    this.updateLighting(frame, time, fires, celestial);
    const mode = frame.debug ?? 'lit';
    if (mode !== this.debug) { this.debug = mode; this.kit.setDebug(mode === 'fields' ? 'lit' : mode); this.terrainMaterials.setDebug(mode); this.water.setDebug(mode); }
    this.flatLight.intensity = mode === 'unlit' ? 3 : 0;
    this.sun.visible = mode !== 'unlit';
    this.sky.visible = mode !== 'unlit';
    this.renderer.shadowMap.enabled = frame.shadows !== false && mode === 'lit';
    const lightingEnd = performance.now();
    if(!this.diving)this.dormantLightEffects.push(this.underwater.overlay);
    if(!this.treeFallEffects.root.visible)this.dormantLightEffects.push(this.treeFallEffects.root);
    if(!this.combatEffects.root.visible)this.dormantLightEffects.push(this.combatEffects.root);
    this.dormantLightEffects.push(this.combatEffects.apparitions.flashWarmup);
    if(!this.footEffects.root.visible)this.dormantLightEffects.push(this.footEffects.root);
    if(!this.projectileWorld.root.visible)this.dormantLightEffects.push(this.projectileWorld.root);
    if(!this.explosionEffects.root.visible)this.dormantLightEffects.push(this.explosionEffects.root);
    if(!this.fishingEffects.root.visible)this.dormantLightEffects.push(this.fishingEffects.root);
    if(!this.shardGlow.root.visible)this.dormantLightEffects.push(this.shardGlow.root);
    if(!this.collectibleGlitter.root.visible)this.dormantLightEffects.push(this.collectibleGlitter.root);
    const restorePrepared = this.pipelineWarmup.prepare(this.scene,this.camera,this.renderer,this.scene,`${mode}:${this.renderer.shadowMap.enabled}`,message=>this.fail(message),this.dormantLightEffects);
    if (frame.profile) this.canvas.dataset.materialsReady = String(this.pipelineWarmup.visibleReady);
    const warmupEnd = performance.now();
    try {
      this.renderer.info.reset();
      this.renderer.render(this.scene, this.camera);
    } catch (error) { this.fail(error instanceof Error ? error.message : String(error)); }
    finally { restorePrepared(); }
    const end = performance.now();
    this.frameCount++;
    this.lastProfile = {frame:this.frameCount, startMs:start, cpuMs:end-start, cameraMs:cameraEnd-start, terrainMs:terrainEnd-cameraEnd,
      waterMs:waterEnd-terrainEnd, entitiesMs:entitiesEnd-waterEnd, batchesMs:batchesEnd-entitiesEnd,
      lightingMs:lightingEnd-batchesEnd, submitMs:end-warmupEnd, warmupMs:warmupEnd-lightingEnd, terrainRebuilt:Number(terrainReason !== 'none'),
      terrainReason, terrainTiles:this.terrainTileCount, newVisuals:this.frameNewVisuals, newPrototypes:this.prototypes.size-prototypesBefore,
      terrainBuildMs:this.terrainBuildMs,
      drawCalls:this.renderer.info.render.drawCalls, triangles:this.renderer.info.render.triangles, gpuMs:this.gpuTiming?.ms ?? null, gpuFrame:this.gpuTiming?.frame ?? null};
    // Never wait for GPU completion in the frame loop or queue unbounded readbacks.
    if (backend.trackTimestamp && !this.gpuTimingPending) {
      this.gpuTimingPending = true;
      const gpuFrame = this.frameCount;
      void this.renderer.resolveTimestampsAsync('render').then(ms => {
        if (Number.isFinite(ms)) this.gpuTiming = {ms:ms as number, frame:gpuFrame};
      }).catch(() => { this.gpuTiming = null; }).finally(() => { this.gpuTimingPending = false; });
    }
    if (this.frameCount % 30 === 0) {
      const samples = this.profileWindow;
      const sorted = samples.map(s=>s.cpuMs).sort((a,b)=>a-b);
      this.canvas.dataset.metrics = JSON.stringify({ backend: 'WebGPU', frame: this.frameCount,
        profile:this.lastProfile,
        profileWindow: sorted.length ? {frames:sorted.length, p95CpuMs:sorted[Math.floor((sorted.length-1)*.95)],p99CpuMs:sorted[Math.floor((sorted.length-1)*.99)],maxCpuMs:sorted.at(-1),
          maxSubmitMs:Math.max(...samples.map(s=>s.submitMs)),maxTerrainMs:Math.max(...samples.map(s=>s.terrainMs)),maxWarmupMs:Math.max(...samples.map(s=>s.warmupMs??0)),terrainRebuilds:samples.reduce((n,s)=>n+s.terrainRebuilt,0)} : null,
        cpuFrameMs: Number((performance.now() - start).toFixed(2)), drawCalls: this.renderer.info.render.drawCalls,
        triangles: this.renderer.info.render.triangles, entities: this.visuals.size,
        geometries: this.renderer.info.memory.geometries, renderTargets: this.renderer.info.memory.renderTargets,
        unfinished: [...this.unfinished].sort(), resolution: [this.canvas.width, this.canvas.height] });
    }
    this.profileWindow.push(this.lastProfile); if (this.profileWindow.length>300)this.profileWindow.shift();
  }

  private configureCamera(frame: World3dFrame): void {
    const width = Math.max(1, frame.width);
    const height = Math.max(1, frame.height);
    const zoom = Math.max(0.5, Math.min(2, frame.zoom ?? 1));
    const pixelCamera = pixelCameraPlan(width, height, -frame.cameraOffset.x + width / 2, -frame.cameraOffset.y + height / 2, zoom);
    const sizeKey = `${width}:${height}`;
    if (sizeKey !== this.lastSize) {
      this.lastSize = sizeKey;
      this.renderer!.setSize(pixelCamera.renderWidth, pixelCamera.renderHeight, false);
      this.canvas.style.width = `${pixelCamera.cssWidth}px`;
      this.canvas.style.height = `${pixelCamera.cssHeight}px`;
      this.canvas.style.imageRendering = 'pixelated';
      this.camera.left = -pixelCamera.cssWidth / WORLD_3D.tilePixels / 2;
      this.camera.right = -this.camera.left;
      this.camera.top = pixelCamera.cssHeight / WORLD_3D.tilePixels / 2;
      this.camera.bottom = -this.camera.top;
      this.camera.updateProjectionMatrix();
    }
    this.canvas.style.transform = `translate3d(${pixelCamera.translateX}px, ${pixelCamera.translateY}px, 0)`;
    const center = worldToScene(pixelCamera.centerX, pixelCamera.centerY);
    const target = new Vector3(center.x, 0, center.z);
    this.camera.position.copy(target).add(new Vector3(0, Math.sin(WORLD_3D.elevationRadians) * 50, Math.cos(WORLD_3D.elevationRadians) * 50));
    this.camera.lookAt(target);
    if (this.camera.zoom !== zoom) { this.camera.zoom = zoom; this.camera.updateProjectionMatrix(); }
    const shadowExtent = Math.max(width, height) / WORLD_3D.tilePixels / zoom * 0.8 + 4;
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = shadowCamera.bottom = -shadowExtent;
    shadowCamera.right = shadowCamera.top = shadowExtent;
    shadowCamera.updateProjectionMatrix();
    // Stabilize shadow translation in light-space-sized increments.
    const texel = shadowExtent * 2 / WORLD_3D.shadowMapSize;
    this.sun.target.position.set(Math.round(center.x / texel) * texel, 0, Math.round(center.z / texel) * texel);
    this.sun.position.copy(this.sun.target.position).add(new Vector3(-15, 25, -12));
  }

  private updateTerrain(frame: World3dFrame): string {
    this.terrainBuildMs = 0;
    let applied = 'none';
    if (this.readyTerrain) {
      const ready = this.readyTerrain; this.readyTerrain = null;
      this.applyTerrain(ready.tiles, ready.build); this.terrainBuildMs = ready.build.buildMs; applied = ready.reason;
    }
    let tileRows: Row[], reason: string;
    if (frame.tables.worldChunkDataMap instanceof Map) {
      const window = this.terrainWindow.update(frame.tables.worldChunkDataMap, frame);
      if (window.reason === 'none') return applied;
      tileRows = window.tiles; reason = window.reason;
    } else {
      tileRows = [...rows(frame.tables.visibleWorldTiles)].map(([, tile]) => tile);
      const signature = tileRows.map(tile => `${tile.worldX},${tile.worldY},${tag(tile.tileType)}`).sort().join(';');
      if (signature === this.lastTerrain) return applied;
      this.lastTerrain = signature; reason = 'tiles';
    }
    if (this.terrainWorker) this.terrainWorker.request(tileRows,reason);
    else { this.applyTerrain(tileRows); applied = reason; }
    return applied;
  }

  private applyTerrain(tileRows:Row[], build?:TerrainBuild):void {
    this.terrainTileCount = tileRows.length;
    this.seaTiles.clear();
    this.hotSpringTiles.clear();
    this.waterTiles.clear();
    this.terrainKinds.clear();
    for (const tile of tileRows) this.terrainKinds.set(`${tile.worldX},${tile.worldY}`, tag(tile.tileType));
    for (const tile of tileRows) if (WATER_TERRAINS.has(tag(tile.tileType))) this.seaTiles.add(`${tile.worldX},${tile.worldY}`);
    for (const tile of tileRows) if (WATER_TERRAINS.has(tag(tile.tileType))) this.waterTiles.set(`${tile.worldX},${tile.worldY}`, tag(tile.tileType) as WaterKind);
    for (const tile of tileRows) if (tag(tile.tileType) === 'HotSpringWater') this.hotSpringTiles.add(`${tile.worldX},${tile.worldY}`);
    if (build) this.terrainMaterials.applyField(build.field); else this.terrainMaterials.rebuild(tileRows);
    this.water.rebuild(tileRows);
    this.groundDetail.rebuild(tileRows);
    for (const tile of tileRows) {
      const type = tag(tile.tileType);
      if (!(type in TERRAIN_PALETTE)) this.unfinished.add(`terrain:${type}`);
    }
    this.terrain.geometry.dispose();
    this.terrain.geometry = build ? terrainGeometry(build.ground) : createTerrainGround(tileRows, (x, y) => this.terrainMaterials.depthAt(x, y));
  }

  private prepareBuildings(frame: World3dFrame): void {
    this.foundationCells.clear(); this.roofCells.clear(); this.indoorCells.clear();
    for (const [, row] of rows(frame.tables.foundationCells)) {
      if (row.isDestroyed || row.shape === 0) continue;
      const key = `${row.cellX},${row.cellY}`;
      const list = this.foundationCells.get(key) ?? [];
      list.push(row); this.foundationCells.set(key, list);
    }
    const clusters = frame.tables.resolvedBuildingClusters ?? frame.tables.buildingClusters;
    if (!(clusters instanceof Map)) return;
    const position = frame.predictedPosition;
    const localCell = position ? `${Math.floor(position.x / BUILDING.cellPixels)},${Math.floor(position.y / BUILDING.cellPixels)}` : '';
    for (const cluster of clusters.values()) {
      if (!cluster?.isEnclosed || !(cluster.cellCoords instanceof Set)) continue;
      const inside = cluster.cellCoords.has(localCell) && position && this.floorAt(position.x, position.y) > 0;
      for (const key of cluster.cellCoords) { this.roofCells.add(String(key)); if (inside) this.indoorCells.add(String(key)); }
    }
  }

  private floorAt(x: number, y: number): number {
    const cellX = Math.floor(x / BUILDING.cellPixels), cellY = Math.floor(y / BUILDING.cellPixels);
    const localX = x / WORLD_3D.tilePixels - (cellX + 0.5) * BUILDING.cellSize;
    const localZ = y / WORLD_3D.tilePixels - (cellY + 0.5) * BUILDING.cellSize;
    return this.foundationCells.get(`${cellX},${cellY}`)?.some(row => pointOnFoundation(row.shape ?? 1, localX, localZ)) ? BUILDING.floorTop : 0;
  }

  private syncTable(kind: string, frame: World3dFrame, dt: number, time: number, seen: Set<string>, fires: LocalLight[]): void {
    for (const [mapId, row] of rows(frame.tables[kind])) {
      if(kind==='alkStations'&&row.isActive===false)continue;
      if(kind==='monumentParts'&&!row.imagePath)continue;
      const isTreeFalling=kind==='trees'&&typeof frame.tables.isTreeFalling==='function'&&Boolean((frame.tables.isTreeFalling as (id:string)=>boolean)(String(mapId)));
      const id = kind === 'players' ? identity(row.identity) || mapId : String(mapId);
      const isLocal = kind === 'players' && id === frame.localPlayerId;
      if (kind === 'players' && row.isDead && frame.tables.playerCorpses instanceof Map
        && [...frame.tables.playerCorpses.values()].some(corpse => identity(corpse.playerIdentity) === id)) continue;
      const position = isLocal && frame.predictedPosition ? frame.predictedPosition
        : kind === 'players' && frame.getRemotePlayerPosition ? frame.getRemotePlayerPosition(row)
        : groundPosition(kind, row, this.seaTiles.has(`${Math.floor((row.posX ?? 0) / WORLD_3D.tilePixels)},${Math.floor((row.posY ?? 0) / WORLD_3D.tilePixels)}`));
      if (kind !== 'shelters' && this.shelterVisibility.occludes(position.x,position.y)) continue;
      const zoom = Math.max(0.5, Math.min(2, frame.zoom ?? 1));
      const screenX = (position.x + frame.cameraOffset.x - frame.width / 2) * zoom + frame.width / 2;
      const screenY = (position.y + frame.cameraOffset.y - frame.height / 2) * zoom + frame.height / 2;
      const margin = kind==='monumentParts'?Math.max(WORLD_3D.cullMarginPixels,villageCullMargin(row))
        : kind==='alkStations'||kind==='compoundLandmarks'||isCompoundBuilding(kind,row)?Math.max(500,WORLD_3D.cullMarginPixels):WORLD_3D.cullMarginPixels;
      // Tall crowns can still occupy the viewport with their roots well below
      // it. Falling trees need the same allowance along their landing axis.
      const treeMargin = kind==='trees' ? Math.max(margin, 12 * WORLD_3D.tilePixels * zoom) : margin;
      const horizontalMargin = isTreeFalling ? treeMargin : margin;
      if (screenX < -horizontalMargin || screenY < -margin || screenX > frame.width + horizontalMargin || screenY > frame.height + treeMargin) continue;
      const waterKind = this.waterTiles.get(`${Math.floor(position.x / 48)},${Math.floor(position.y / 48)}`);
      const subtype=tag(row.species??row.animalSpecies??row.oreType);
      const visibleHit=!this.diving||kind==='livingCorals'||kind==='animalCorpses'||kind==='players'&&(isLocal||Boolean(row.isSnorkeling))
        ||kind==='wildAnimals'&&['SalmonShark','Jellyfish'].includes(subtype);
      let reaction=0;
      if(visibleHit&&COMBAT_FEEDBACK_KINDS.has(kind)){
        let hitGround=this.floorAt(position.x,position.y);
        if(kind==='livingCorals'&&waterKind)hitGround=-this.terrainMaterials.depthAt(position.x,position.y)+.02;
        if(kind==='players'&&row.isSnorkeling)hitGround=-Math.min(.9,Math.max(.35,this.terrainMaterials.depthAt(position.x,position.y)*.65));
        reaction=this.combatEffects.observe(kind,id,row.lastHitTime?.microsSinceUnixEpoch??0n,position.x,position.y,hitGround,subtype,frame.nowMs??Date.now());
      }
      if (row.isDestroyed && !isTreeFalling || row.isDead && kind !== 'players' || row.health === 0 && (kind === 'trees' && !isTreeFalling || kind === 'stones' || kind === 'barrels')) continue;
      if ((kind === 'barrels' || kind === 'harvestableResources' || kind === 'livingCorals') && row.respawnAt && row.respawnAt.microsSinceUnixEpoch !== 0n) continue;
      if (kind === 'animalCorpses' && row.health === 0) continue;
      if ((kind === 'foundationCells' || kind === 'ceilings') && row.shape === 0) continue;
      const key = `${kind}:${id}`;
      seen.add(key);
      const item=kind==='droppedItems'&&frame.tables.itemDefinitions instanceof Map?frame.tables.itemDefinitions.get(String(row.itemDefId)):null;
      const signature = [tag(row.treeType ?? row.oreType ?? row.species ?? row.animalSpecies ?? row.plantType ?? row.runeType ?? row.columnType ?? row.explosiveType), row.tier ?? 0,
        tag(row.variant) || row.variant || 0, row.shape ?? 1, row.edge ?? 0, row.foundationShape ?? 1, row.boxType ?? 0,
        row.furnaceType ?? 0, row.lanternType ?? 0, row.doorType ?? 0, row.terrainVariant ?? 0, isCompoundBuilding(kind, row), row.loreId ?? '', kind === 'livingCorals' ? coralVariant(id) : '',
        kind==='droppedItems'?`${row.itemDefId}:${item?.name??''}`:'',
        kind==='monumentParts'?`${row.imagePath}:${row.partType}:${tag(row.monumentType)}:${row.rotationRad??0}`:'',
        kind==='fumaroles'?Boolean(row.isSubmerged):'',kind==='turrets'?Boolean(row.isMonument):'',
        kind==='alkStations'?row.stationId===0?'central':'station':'',kind==='compoundLandmarks'?row.name:''].join(':');
      let visual = this.visuals.get(key);
      if (!visual || visual.signature !== signature) {
        this.frameNewVisuals++;
        if (visual) this.scene.remove(visual.root);
        visual = this.createVisual(kind, item?{...row,name:item.name}:row, id, signature, position.x, position.y);
        if (kind === 'playerCorpses') {
          const owner = identity(row.playerIdentity), previous = this.visuals.get(`players:${owner}`)?.survivor;
          const player = frame.tables.players instanceof Map ? frame.tables.players.get(owner) as Row | undefined : undefined;
          visual.corpseYaw = previous?.root.rotation.y ?? yaw(player?.direction ?? 'down');
        }
        this.visuals.set(key, visual);
        if (!visual.root.userData.staticBatch) this.scene.add(visual.root);
      }
      const smooth = visual.animal && kind === 'wildAnimals' && Math.hypot(position.x - visual.lastX, position.y - visual.lastY) < 480 ? 1 - Math.exp(-dt * 14) : 1;
      const displayX = visual.lastX + (position.x - visual.lastX) * smooth, displayY = visual.lastY + (position.y - visual.lastY) * smooth;
      const p = worldToScene(displayX, displayY);
      const distanceMoved = Math.hypot(displayX - visual.lastX, displayY - visual.lastY);
      const speed = this.motionDelta > 0 && distanceMoved < WORLD_3D.tilePixels * 10 ? distanceMoved / WORLD_3D.tilePixels / this.motionDelta : 0;
      visual.lastX = displayX;
      visual.lastY = displayY;
      const boundary = ['foundationCells', 'wallCells', 'ceilings', 'doors', 'fences'].includes(kind);
      visual.root.position.set(p.x, boundary ? 0 : this.floorAt(position.x, position.y), p.z);
      if(COMBAT_FEEDBACK_KINDS.has(kind)&&kind!=='shelters')visual.root.rotation.z=0;
      const kelp = kind === 'harvestableResources' && ['Seaweed','SeaweedBed'].includes(tag(row.plantType));
      const submergedVent = kind === 'fumaroles' && Boolean(row.isSubmerged);
      if (kind === 'livingCorals' || kelp && waterKind || submergedVent) {
        const depth = this.terrainMaterials.depthAt(position.x, position.y);
        const bottom = seabedAnchor(position.x, position.y, waterKind ?? 'Sea', submergedVent ? Math.max(.12,depth) : depth);
        visual.root.position.set(bottom.x, bottom.y + .02, bottom.z);
        if(!submergedVent)visual.root.scale.y = Math.min(1, Math.max(.08, -bottom.y / 1.25));
        if (kelp) { visual.root.rotation.z = Math.sin(time * 1.25 + seedFromId(id)) * .05; visual.root.rotation.x = Math.sin(time * 1.1 + seedFromId(id)) * .04; }
      }
      if(kind==='fumaroles'){
        const plume=visual.root.getObjectByName('vent-emission');
        const depth=submergedVent ? Math.max(.12,-visual.root.position.y-.05) : 1.2;
        plume?.children.forEach((particle,i)=>{
          const phase=(time*(submergedVent ? .28 : .19)+i/7+seedFromId(id)%31/31)%1;
          particle.position.set(Math.sin(phase*7+i)*(.04+phase*.14),.2+phase*Math.max(.05,depth-.2),Math.cos(phase*6+i)*.06);
          particle.scale.setScalar((submergedVent ? .07 : .13)*(1+phase*.7));
        });
      }
      const underwaterAnimal=kind==='wildAnimals'&&['SalmonShark','Jellyfish'].includes(tag(row.species));
      const underwaterEntity=kind==='livingCorals'||kelp||submergedVent||kind==='droppedItems'||underwaterAnimal||kind==='players'&&(isLocal||Boolean(row.isSnorkeling));
      const hiddenBySurface=this.diving&&!underwaterEntity;
      visual.root.visible=!hiddenBySurface;
      if (!hiddenBySurface && (kind === 'harvestableResources' || kind === 'droppedItems')) {
        const profile = kind === 'harvestableResources' ? PLANT_PROFILES[tag(row.plantType) as keyof typeof PLANT_PROFILES] : undefined;
        const anchor = visual.root.position;
        this.collectibleGlitter.add(key, anchor.x, anchor.y, anchor.z,
          (profile?.height ?? .3) * visual.root.scale.y, profile?.spread ?? .4);
      }
      const isShard=kind==='harvestableResources'&&tag(row.plantType)==='MemoryShard'
        ||kind==='droppedItems'&&item?.name==='Memory Shard'||kind==='stones'&&tag(row.oreType)==='Memory';
      if(isShard&&!hiddenBySurface){
        const ore=kind==='stones';
        this.shardGlow.add(p.x,visual.root.position.y,p.z,ore?3.1:2.2);
        fires.push({position:new Vector3(p.x,visual.root.position.y+(ore ? .7 : .45),p.z),color:ore?0x5da8ee:0xb67cf6,intensity:ore?1.6:1.1,priority:1});
      }
      if(kind==='trees'){
        const tree=visual.root.children[0];
        const fall=frame.tables.fallingTrees instanceof Map ? frame.tables.fallingTrees.get(id) : null;
        const now=frame.nowMs??Date.now();
        if(!isTreeFalling || !fall || visual.treeAudio?.fallStartedAt!==fall.startTime)visual.treeAudio=undefined;
        // The audio and tree row arrive independently. Accept a newly started
        // sound only near the start of this fall, avoiding stale or late audio
        // forcing a visibly advanced tree backwards.
        if(isTreeFalling&&fall&&!visual.treeAudio&&now-fall.startTime<400){
          const playback=treeFallPlayback(row.posX??position.x,row.posY??position.y,fall.startTime);
          if(playback)visual.treeAudio={...playback,fallStartedAt:fall.startTime};
        }
        const elapsed=fall ? visual.treeAudio ? (now-visual.treeAudio.startedAt)*visual.treeAudio.playbackRate : now-fall.startTime : 0;
        const linear=Math.max(0,Math.min(1,elapsed/2500));
        const audioProgress=linear<.5?2*linear*linear:1-Math.pow(-2*linear+2,2)/2;
        const progress=visual.treeAudio ? audioProgress : isTreeFalling&&typeof frame.tables.getFallProgress==='function'
          ? Number((frame.tables.getFallProgress as (id:string)=>number)(id)) : 0;
        // The old ease reaches 0.9928 at 2.35 s. Reach the ground there,
        // coinciding with the impact in the existing falling sound.
        tree.rotation.z=progress>0 ? -Math.PI/2*Math.min(1,progress/.9928) : 0;
        if(isTreeFalling&&!hiddenBySurface&&fall && typeof fall.startTime==='number'){
          this.treeFallEffects.observe(id,visual.root.position,tree.userData.treeHeight??3,
            tree.userData.leafColor??0x58764a,tree.userData.leafLightColor??0x91a969,elapsed);
        }
      }
      if(hiddenBySurface&&waterKind){
        const radius=kind==='seaStacks' ? 1.3*(row.scale??1) : kind==='players' ? .42 : kind==='barrels' ? .48 : .55;
        this.underwater.mark(position.x,position.y,radius,radius*.75);
      }
      if (kind === 'seaStacks') visual.root.scale.set(row.scale ?? 1, row.scale ?? 1, (row.scale ?? 1) * GROUND_Y_SCALE);
      if (!hiddenBySurface && kind === 'roadLampposts' && isNightTime(cycleOf(frame))) fires.push({ position: new Vector3(p.x + .6, 3.75, p.z), color: 0xffd299, intensity: 4 });
      if (kind === 'barrels' && (waterKind || row.variant === 6 || (row.variant ?? 0) >= 3)) {
        const bob = floatingPose(time, row.posX ?? position.x, row.posY ?? position.y);
        // Center the 1.06-unit barrel body on the waterline, keeping its gentle bob.
        visual.root.position.y = (row.variant === 6 ? -.1 : -.52) + bob.height; visual.root.rotation.set(bob.pitch, 0, bob.roll);
        const beacon = visual.root.getObjectByName('buoy-led');
        if (beacon) {
          beacon.visible = isNightTime(cycleOf(frame));
          if (beacon.visible && !hiddenBySurface) { visual.root.updateMatrixWorld(true); fires.push({ position: beacon.getWorldPosition(new Vector3()), color: 0xff554b, intensity: 8 }); }
          else if (beacon instanceof Group) this.dormantLightEffects.push(beacon);
          visual.root.userData.buoyLit = beacon.visible;
        }
      }
      if (kind === 'wallCells' || kind === 'doors') {
        const target = this.indoorCells.has(`${row.cellX},${row.cellY}`) ? BUILDING.cutawayWallScale : 1;
        visual.root.scale.y += (target - visual.root.scale.y) * (1 - Math.exp(-dt * 14));
      }
      visual.door?.update(Boolean(row.isOpen), dt);
      if (kind === 'placedExplosives') {
        const fuse = visual.root.getObjectByName('explosive-fuse') as Group | undefined, now = frame.nowMs ?? Date.now();
        if (fuse) {
          fuse.visible = !row.isDud && timestampMs(row.armedAt) > 0 && timestampMs(row.armedAt) <= now && timestampMs(row.detonatesAt) > now;
          fuse.scale.setScalar(1 + Math.sin(time * 45) * .2);
          if (!fuse.visible) this.dormantLightEffects.push(fuse);
        }
      }
      const potContents = kind === 'brothPots' ? visual.root.getObjectByName('pot-contents') : null;
      if (potContents) {
        potContents.visible = (row.waterLevelMl ?? 0) > 0;
        potContents.position.y = 0.2 + Math.min(1, (row.waterLevelMl ?? 0) / (row.maxWaterCapacityMl || 5000)) * 0.36;
      }
      visual.shelter?.update(shelterOwnerInside(row,frame.localPlayerId,frame.predictedPosition),frame.nowMs??Date.now(),Number(row.lastHitTime?.microsSinceUnixEpoch??0n)/1000);
      visual.village?.update(frame.predictedPosition,position,row.rotationRad??0,time);
      if(visual.village&&!hiddenBySurface&&isNightTime(cycleOf(frame)))for(const point of visual.village.nightLights())fires.push({position:point,color:0xffbc73,intensity:3.5});
      if (visual.survivor) {
        if(row.isSnorkeling){
          const depth=Math.min(.9,Math.max(.35,this.terrainMaterials.depthAt(position.x,position.y)*.65));
          visual.root.position.set(p.x,-depth,p.z-depth/Math.tan(WORLD_3D.elevationRadians));
        }
        if (isLocal) this.canvas.dataset.localPose = JSON.stringify({ x: position.x, y: position.y, swimming: Boolean(row.isOnWater), sprinting: Boolean(row.isSprinting), speed: Number(speed.toFixed(2)), facing: frame.facing ?? row.direction });
        const equipment = frame.tables.activeEquipments instanceof Map ? frame.tables.activeEquipments.get(id) : null;
        const definitions = frame.tables.itemDefinitions;
        const item = definitions instanceof Map ? definitions.get(String(equipment?.equippedItemDefId)) : null;
        const fishing = frame.tables.fishingSessions instanceof Map ? frame.tables.fishingSessions.get(id) : undefined;
        const weapon = fishing?.isActive ? fishing.fishingRod : item?.name ?? equipment?.iconAssetName ?? '';
        const nowMs = frame.nowMs ?? Date.now();
        const jumpAge = nowMs - (isLocal && frame.jumpStartMs ? frame.jumpStartMs : Number(row.jumpStartTimeMs ?? 0));
        const swingAge = nowMs - Number(equipment?.swingStartTimeMs ?? 0);
        const throwAge = nowMs - (this.thrownAt.get(id) ?? 0);
        const swingDuration = Math.max(120, Math.min(1500, (item?.attackIntervalSecs ?? .5) * 1000));
        const stats = frame.tables.rangedWeaponStats instanceof Map ? frame.tables.rangedWeaponStats.get(weapon) : undefined;
        const reload = reloadPhase(equipment?.reloadStartTimeMs, stats?.magazineReloadTimeSecs || stats?.reloadTimeSecs || 1.3, nowMs);
        const playerCorpse = kind === 'playerCorpses';
        const downAt = timestampMs(playerCorpse ? row.deathTime : row.isDead ? row.deathTimestamp : row.knockedOutAt);
        const shotAge = this.rangedTimeline.age(id, weapon, Number(equipment?.swingStartTimeMs ?? 0), nowMs);
        visual.survivor.update({ speed, sprinting: Boolean(row.isSprinting), crouching: Boolean(row.isCrouching),
          swimming: Boolean(row.isOnWater || row.isSnorkeling), dead: Boolean(row.isDead || playerCorpse), knockedOut: Boolean(row.isKnockedOut),
          downAge: downAt ? Math.max(0, (nowMs - downAt) / 1000) : undefined,
          jumpAge: jumpAge / 1000,
          jump: jumpAge > 0 && jumpAge < 500 ? Math.sin(jumpAge / 500 * Math.PI) : 0,
          roll: isLocal ? frame.rollProgress ?? 0 : 0,
          attack: throwAge >= 0 && throwAge < 400 ? throwAge / 400 : swingAge > 0 && swingAge < swingDuration ? swingAge / swingDuration : 0,
          throwAiming: Boolean(row.isAimingThrow && isThrowableMelee(item)),
          throwRelease: throwAge >= 0 && throwAge < 400 ? throwAge / 400 : undefined,
          yaw: playerCorpse ? visual.corpseYaw ?? 0 : yaw(isLocal ? frame.facing ?? row.direction ?? '' : row.direction ?? ''), weapon,
          armor: playerCorpse ? undefined : resolveWornArmor(equipment, frame.tables.inventoryItems instanceof Map ? frame.tables.inventoryItems : undefined,
            definitions instanceof Map ? definitions : undefined),
          torchLit: Boolean(row.isTorchLit && !row.isSnorkeling), loaded: Boolean(equipment?.loadedAmmoCount && equipment?.isReadyToFire),
          shotAge, reloadProgress: reload, reloading: reload !== undefined,
          bowDraw: reload ?? (equipment?.isReadyToFire && equipment?.loadedAmmoCount ? 1 : 0),
          interaction: actorInteraction(frame.tables, id, row, nowMs) }, dt, time);
        if (isLocal && frame.profile) this.canvas.dataset.localAnimation = JSON.stringify(visual.survivor.root.userData.animation);
        const muzzleFlash = visual.survivor.muzzleFlash;
        if (muzzleFlash && !muzzleFlash.visible) this.dormantLightEffects.push(muzzleFlash);
        if (kind === 'players' && !hiddenBySurface) {
          const terrain = visual.root.position.y > .02 ? 'Building' : this.terrainKinds.get(`${Math.floor(position.x / WORLD_3D.tilePixels)},${Math.floor(position.y / WORLD_3D.tilePixels)}`) ?? 'Grass';
          this.footEffects.observe(id, { x: position.x, y: position.y, ground: visual.root.position.y, speed,
            swimming: Boolean(row.isOnWater || row.isSnorkeling), down: Boolean(row.isDead || row.isKnockedOut), jumpAge: jumpAge / 1000,
            terrain, snow: terrain !== 'Building' && (terrain === 'Alpine' || tag((frame.tables.worldState as { currentSeason?: unknown })?.currentSeason) === 'Winter' && !waterKind) }, visual.survivor, time);
        }
        const torchFlame = visual.survivor.torchFlame;
        if (torchFlame?.visible && !hiddenBySurface) {
          visual.root.updateMatrixWorld(true);
          fires.push({ position: torchFlame.getWorldPosition(new Vector3()), color: 0xffb969, intensity: 4.8 });
        } else if (torchFlame) this.dormantLightEffects.push(torchFlame);
        if (isLocal) this.canvas.dataset.localEquipment = JSON.stringify({ weapon, torchLit: Boolean(row.isTorchLit), flameVisible: Boolean(torchFlame?.visible) });
        if (visual.survivor.unfinishedWeapon) this.unfinished.add(`weapon:${weapon}`);
        this.swimmingEffects.observe(id, position.x, position.y, visual.survivor.root.rotation.y, speed,
          Boolean(row.isOnWater), Boolean(row.isSprinting), this.hotSpringTiles.has(`${Math.floor(position.x / WORLD_3D.tilePixels)},${Math.floor(position.y / WORLD_3D.tilePixels)}`), time, Boolean(row.isSnorkeling));
        if (playerCorpse && (!downAt || nowMs - downAt >= 800)) {
          let settled = this.prototypes.get('settled-player-corpse');
          if (!settled) {
            const anatomy = visual.survivor.root.clone(true);
            anatomy.position.set(0, 0, 0); anatomy.rotation.set(0, 0, 0); anatomy.scale.set(1, 1, 1);
            anatomy.getObjectByName('interaction-props')?.removeFromParent(); anatomy.getObjectByName('held-weapon')?.removeFromParent();
            settled = this.kit.compileColored(anatomy); settled.userData.playerCorpse = true;
            this.prototypes.set('settled-player-corpse', settled);
          }
          const corpse = settled.clone(true); corpse.rotation.y = visual.corpseYaw ?? 0;
          visual.root.remove(visual.survivor.root); visual.root.add(corpse); visual.survivor = undefined;
          visual.root.userData.staticBatch = true; this.scene.remove(visual.root);
        }
      }
      if (visual.animal) {
        if(kind==='wildAnimals')visual.animal.setHitFlash(this.combatEffects.isHitFlashing(kind,id,frame.nowMs??Date.now()),this.combatEffects.apparitions.flashMaterial);
        const direction = visual.corpseYaw ?? (Math.hypot(row.directionX ?? 0, row.directionY ?? 0) > 0.01
          ? Math.atan2(row.directionX ?? 0, row.directionY ?? 0) : yaw(row.facingDirection ?? ''));
        const now = frame.nowMs ?? Date.now();
        const age = (stamp?: { microsSinceUnixEpoch: bigint }) => stamp ? (now - Number(stamp.microsSinceUnixEpoch / 1000n)) / 1000 : -1;
        const corpse = kind === 'animalCorpses';
        const targetId = row.targetPlayerId ? identity(row.targetPlayerId) : '';
        const target = frame.tables.players instanceof Map ? frame.tables.players.get(targetId) as Row | undefined : undefined;
        const lookX = target?.positionX ?? row.investigationX, lookY = target?.positionY ?? row.investigationY;
        visual.animal.update(speed, direction, dt, time, Boolean(row.isFlying), false, {
          attackAge: age(row.lastAttackTime), deathAge: corpse ? Math.max(0, age(row.deathTime)) : row.health === 0 ? Math.max(0, age(row.lastHitTime)) : undefined,
          hidden: !corpse && ['Burrowed', 'Hiding'].includes(tag(row.state)), shock: age(row.shockActiveUntil) < 0 && Boolean(row.shockActiveUntil),
          state: tag(row.state), alertAge: Math.max(0, age(row.stateChangeTime)),
          lookYaw: lookX !== undefined && lookY !== undefined ? Math.atan2(lookX - position.x, lookY - position.y) : undefined,
        });
        if (waterKind && ['SalmonShark', 'Jellyfish'].includes(visual.animal.species)) {
          const submerged = seabedAnchor(displayX, displayY, waterKind, this.terrainMaterials.depthAt(displayX, displayY));
          const depth = corpse ? submerged.y : -Math.min(.6, Math.max(.1, -submerged.y * .6));
          visual.root.position.set(p.x, depth, p.z + depth / Math.tan(WORLD_3D.elevationRadians));
        }
      }
      if (visual.fire) {
        visual.fire.visible = kind === 'homesteadHearths' || kind==='monumentParts'&&row.partType==='campfire' || Boolean(row.isBurning);
        visual.fire.children.forEach((flame, i) => {
          flame.scale.y = flame.userData.baseHeight * (0.9 + Math.sin(time * 9 + i * 2.4) * 0.18);
          flame.rotation.z = Math.sin(time * 5 + i) * 0.12;
        });
        if (visual.fire.visible && !hiddenBySurface) {
          visual.root.updateMatrixWorld(true);
          const position = visual.fire.getWorldPosition(new Vector3()); position.y += 0.22;
          fires.push({ position, color: visual.fire.userData.lightColor ?? 0xffac63, intensity: kind === 'lanterns' ? 3.5 : 7 });
        } else this.dormantLightEffects.push(visual.fire);
      }
      if(reaction&&kind!=='shelters'){
        const strength=kind==='trees' ? .035 : kind==='stones' ? .045 : kind==='players' ? .07 : .06;
        visual.root.rotation.z+=reaction*strength;
        visual.root.position.x+=reaction*(kind==='trees' ? .025 : .045);
      }
      if (visual.root.userData.staticBatch && !hiddenBySurface) this.batches.submit(visual.root);
    }
  }

  private createVisual(kind: string, row: Row, id: string, signature: string, x: number, y: number): EntityVisual {
    const seed = seedFromId(id);
    let root: Group;
    let survivor: SurvivorRig | undefined;
    let animal: AnimalRig | undefined;
    let door: DoorRig | undefined;
    let shelter: ShelterRig | undefined;
    let village: VillageRig | undefined;
    if (kind === 'players' || kind === 'playerCorpses') { survivor = new SurvivorRig(this.kit); root = survivor.root; }
    else if (kind === 'wildAnimals' || kind === 'animalCorpses') {
      const previous = kind === 'animalCorpses' ? this.visuals.get(`wildAnimals:${row.animalId}`) : undefined;
      animal = previous?.animal ?? new AnimalRig(this.kit, tag(row.species ?? row.animalSpecies), seed); root = animal.root;
      if (previous) previous.root.remove(root);
      if (root.userData.unfinishedSpecies) this.unfinished.add(`animal:${tag(row.species)}`);
    } else if (kind === 'monumentParts'&&villageAsset(row)) {
      const asset=villageAsset(row),key=`village:${asset}`;let prototype=this.prototypes.get(key);
      if(!prototype){prototype=createVillageModel(this.kit,asset);this.prototypes.set(key,prototype);}
      village=new VillageRig(this.kit,asset,prototype);root=village.root;
    } else if (kind === 'shelters') {
      const key=`shelter:${row.terrainVariant??0}`;let prototype=this.prototypes.get(key);
      if(!prototype){prototype=createShelter(this.kit,row.terrainVariant??0);this.prototypes.set(key,prototype);}
      shelter=new ShelterRig(this.kit,row.terrainVariant??0,prototype);root=shelter.root;
    } else if (kind === 'doors') {
      const key = `door:${row.doorType ?? 0}:${row.edge ?? 0}`;
      let prototype = this.prototypes.get(key);
      if (!prototype) { prototype = new DoorRig(this.kit, row.doorType ?? 0, row.edge ?? 0).root; this.prototypes.set(key, prototype); }
      door = new DoorRig(this.kit, row.doorType ?? 0, row.edge ?? 0, prototype); root = door.root;
    } else if (kind === 'campfires') {
      const prototypeKey = `campfire:${seed % 8}`;
      let prototype = this.prototypes.get(prototypeKey);
      if (!prototype) { prototype = createCampfire(this.kit, seed % 8); this.prototypes.set(prototypeKey, prototype); }
      root = prototype.clone(true);
    }
    else {
      const prototypeKey = kind==='droppedItems'?`drop:${droppedModelCacheKey(row.name??'',seed)}`:`${kind}:${signature}:${['trees', 'stones', 'harvestableResources', ...NATURAL_OBJECT_TABLES].includes(kind) ? seed % 8 : 0}`;
      let prototype = this.prototypes.get(prototypeKey);
      if (!prototype) {
        try {
        if (isCompoundBuilding(kind, row)) {
          const asset:AlkAsset=kind==='rainCollectors'?'water':kind==='furnaces'?'furnace':row.boxType===3?'compost':row.boxType===5?'weapons':'food';
          prototype=createAlkBuilding(this.kit,asset);
        }
        else if(kind==='alkStations')prototype=createAlkBuilding(this.kit,row.stationId===0?'central':'station');
        else if(kind==='compoundLandmarks')prototype=createAlkBuilding(this.kit,row.name as AlkAsset);
        else if(kind==='turrets')prototype=createAlkTurret(this.kit,Boolean(row.isMonument));
        else if (kind === 'trees') prototype = createTree(this.kit, tag(row.treeType), seed % 8);
        else if (kind === 'placedExplosives') prototype = createPlacedExplosive(this.kit, tag(row.explosiveType) === 'MatriarchWrath');
        else if (kind === 'stones') prototype = createRock(this.kit, tag(row.oreType), seed % 8);
        else if (kind === 'woodenStorageBoxes') prototype = createStorageModel(this.kit, row.boxType ?? 0);
        else if (kind === 'barrels') prototype = row.variant === 6 ? createBuoy(this.kit) : createBarrel(this.kit, row.variant ?? 0);
        else if (kind === 'foundationCells' || kind === 'ceilings') prototype = createFoundationModel(this.kit, row.tier ?? 0, row.shape ?? 1, kind === 'ceilings');
        else if (kind === 'wallCells') prototype = createWallModel(this.kit, row.tier ?? 0, row.edge ?? 0, row.foundationShape ?? 1);
        else if (kind === 'fences') prototype = createFenceModel(this.kit, row.tier ?? 1, row.edge ?? 0);
        else if (kind === 'furnaces') prototype = createFurnace(this.kit, row.furnaceType === 1);
        else if (kind === 'barbecues') prototype = createBarbecue(this.kit);
        else if (kind === 'lanterns') prototype = createLantern(this.kit, row.lanternType ?? 0);
        else if (kind === 'homesteadHearths') prototype = createHearth(this.kit);
        else if (kind === 'brothPots') prototype = createBrothPot(this.kit);
        else if (kind === 'sleepingBags') prototype = createSleepingBag(this.kit);
        else if (kind === 'stashes') prototype = createStash(this.kit);
        else if (kind === 'shelters') prototype = createShelter(this.kit, row.terrainVariant ?? 0);
        else if (kind === 'rainCollectors') prototype = createRainCollector(this.kit);
        else if (kind === 'harvestableResources') prototype = ['Seaweed','SeaweedBed'].includes(tag(row.plantType)) ? createKelp(this.kit, seed % 8) : createPlant(this.kit, tag(row.plantType), seed % 8);
        else if (kind === 'droppedItems') prototype = createDroppedModel(this.kit,row.name??'',seed%4);
        else if (kind === 'runeStones') prototype = createRuneStone(this.kit, tag(row.runeType), seed % 8);
        else if (kind === 'cairns') prototype = createCairn(this.kit, seed % 8, row.loreId);
        else if (kind === 'livingCorals') prototype = createCoral(this.kit, coralVariant(id), seed % 8);
        else if (NATURAL_OBJECT_TABLES.includes(kind as typeof NATURAL_OBJECT_TABLES[number])) prototype = createGeologicalObject(this.kit, kind, tag(row.variant ?? row.columnType), seed % 8,Boolean(row.isSubmerged));
        else {
          prototype = new Group();
          this.kit.part(prototype, 'rock', 0xc576b5, [0.4, 0.6, 0.4], [0, 0.3, 0]);
          this.unfinished.add(`table:${kind}`);
        }
        } catch (error) {
          prototype = new Group();
          this.kit.part(prototype, 'rock', 0xc576b5, [0.4, 0.6, 0.4], [0, 0.3, 0]);
          this.unfinished.add(`${kind}:${error instanceof Error ? error.message : String(error)}`);
        }
        if (['trees','stones','harvestableResources',...NATURAL_OBJECT_TABLES].includes(kind) && kind!=='fumaroles') prototype = this.kit.compileColored(prototype);
        this.prototypes.set(prototypeKey, prototype);
      }
      root = prototype.clone(true);
      if(kind==='droppedItems')root.userData.itemName=row.name??'';
    }
    const wrapper = new Group(); wrapper.add(root);
    wrapper.name = `${kind}:${id}`;
    // World ground compensation wraps every local yaw/hinge transform (S * R).
    // Applying it on the rotating model itself would stretch the wrong axis.
    wrapper.scale.z = GROUND_Y_SCALE;
    const fire = wrapper.getObjectByName('fire') as Group | undefined;
    if (!survivor && !animal && !door && !fire && !village && kind !== 'brothPots' && kind !== 'shelters' && kind!=='fumaroles' && !(kind === 'barrels' && row.variant === 6)) wrapper.userData.staticBatch = true;
    return { root: wrapper, signature, survivor, animal, door, shelter, village, lastX: x, lastY: y, fire,
      corpseYaw: kind === 'animalCorpses' ? animal?.root.rotation.y ?? (seed % 360) * Math.PI / 180 : undefined };
  }

  private updateLighting(frame: World3dFrame, time: number, fires: LocalLight[], celestial = worldLightAt(cycleOf(frame))): void {
    this.sun.intensity=celestial.directPower;this.sun.color.copy(celestial.direct);
    this.sun.position.copy(this.sun.target.position).addScaledVector(celestial.direction,32);
    this.sky.intensity=celestial.skyPower;this.sky.color.copy(celestial.sky);this.sky.groundColor.copy(celestial.ground);
    this.terrainMaterials.cloudShadows.setLight(this.sun.color,this.sun.intensity,celestial.direction);
    fires.sort((a, b) => (a.priority??0)-(b.priority??0) || a.position.distanceToSquared(this.camera.position) - b.position.distanceToSquared(this.camera.position));
    this.lights.forEach((light, i) => {
      // Visibility changes alter the lights-node cache key and synchronously
      // rebuild pipelines for the entire scene. Keep a fixed shader light list;
      // inactive slots contribute zero illumination instead.
      light.visible = true;
      light.intensity = 0;
      if (this.debug !== 'unlit' && fires[i]) {
        light.position.copy(fires[i].position);
        light.color.setHex(fires[i].color);
        light.intensity = fires[i].intensity + Math.sin(time * 9 + i) * 0.3;
      }
    });
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    this.terrainWorker?.dispose(); this.readyTerrain = null;
    this.rangedTimeline.clear();
    this.thrownAt.clear();
    const warmupRelease = this.pipelineWarmup.dispose();
    // Renderer releases GPU resources before their shared CPU owners are disposed.
    const release = () => { this.device?.destroy(); this.device = null; this.water.dispose(); this.groundDetail.dispose(); this.terrainMaterials.dispose(); this.swimmingEffects.dispose(); this.treeFallEffects.dispose(); this.combatEffects.dispose(); this.footEffects.dispose(); this.projectileWorld.dispose(); this.explosionEffects.dispose(); this.fishingEffects.dispose(); this.shardGlow.dispose(); this.collectibleGlitter.dispose(); this.underwater.dispose(); this.placementPreview.dispose(); this.batches.dispose(); this.terrain.geometry.dispose(); this.kit.dispose(); this.scene.clear(); this.visuals.clear(); this.prototypes.clear(); };
    this.disposal = (async () => {
      // A pending init may still own the canvas context. Finish its release before
      // a remount or seed reset is allowed to configure this same canvas again.
      await this.initialization;
      await warmupRelease;
      const renderer = this.renderer;
      this.renderer = null;
      if (renderer) await renderer.dispose().catch(() => {});
      release();
    })();
    WebGpuWorldRenderer.canvasReleases.set(this.canvas, this.disposal);
    return this.disposal;
  }
}
