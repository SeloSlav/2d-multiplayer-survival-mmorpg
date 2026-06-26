import { gameConfig, JUMP_DURATION_MS, JUMP_HEIGHT_PX, FOUNDATION_TILE_SIZE } from '../../config/gameConfig';
import type {
  ActiveEquipment,
  AnimalCorpse,
  Barbecue,
  Campfire,
  Door,
  FirePatch,
  Furnace,
  HarvestableResource,
  ItemDefinition,
  Lantern,
  Player,
  Projectile,
  Shelter,
  WallCell,
  WildAnimal,
} from '../../generated/types';
import { getClampedRafDeltaMs } from '../../utils/frameDelta';
import { isCompoundMonument } from '../../config/compoundBuildings';
import { SHELTER_DIMS } from '../../utils/clientCollision';
import { getResourceConfig } from '../../utils/renderers/resourceConfigurations';
import { getResourceType } from '../../types/resourceTypes';
import {
  CAMPFIRE_HEIGHT,
  CAMPFIRE_RENDER_Y_OFFSET,
  CAMPFIRE_SMOKE_LINGER_MS,
  getPlacedCampfireFireAnchorWorld,
  getStaticMonumentCampfireFireAnchorWorld,
} from '../../utils/renderers/campfireRenderingUtils';
import {
  deleteCampfireGpuFire01,
  getCampfireGpuFireDt,
  stepCampfireGpuFire01,
  syncCampfireGpuLight01,
} from '../../utils/renderers/campfireGpuFireSmoothing';
import { getSmokePlumeReach01 } from '../../utils/renderers/campfireSmokePlumeReach';
import type { CampfireFireGpuEmitter } from '../../utils/renderers/campfireFireOverlayUtils';
import { isCampfireFireWebGLOverlayAvailable } from '../../utils/renderers/campfireFireOverlayUtils';
import { MAX_EMITTERS } from '../../utils/renderers/campfireFireWebGL';
import {
  getTorchGpuFlameAnchorWorld,
  TORCH_FLAME_ANCHOR_FIRE_BASE_Y_OFFSET,
} from '../../utils/renderers/torchFlameAnchorWorldUtils';
import { sampleProjectileState } from '../../utils/projectileSampling';
import { getProjectileTrackingKey } from '../../utils/renderers/projectileRenderingUtils';
import {
  FURNACE_HEIGHT,
  FURNACE_RENDER_Y_OFFSET,
  FURNACE_TYPE_LARGE,
  LARGE_FURNACE_HEIGHT,
  LARGE_FURNACE_RENDER_Y_OFFSET,
  MONUMENT_LARGE_FURNACE_HEIGHT,
  MONUMENT_LARGE_FURNACE_RENDER_Y_OFFSET,
} from '../../utils/renderers/furnaceRenderingUtils';
import { BARBECUE_HEIGHT } from '../../utils/renderers/barbecueRenderingUtils';
import {
  getLanternDimensions,
  LANTERN_RENDER_Y_OFFSET,
  LANTERN_TYPE_ANCESTRAL_WARD,
  LANTERN_TYPE_MEMORY_BEACON,
  LANTERN_TYPE_SIGNAL_DISRUPTOR,
} from '../../utils/renderers/lanternRenderingUtils';
import { renderParticlesToCanvas } from '../../utils/renderers/particleRenderingUtils';
import type {
  GameCanvasRuntimeParticleSnapshot,
  GameCanvasRuntimeSceneSnapshot,
} from './GameCanvasRuntimeHost';
import type { MutableRef } from '../types';

interface Particle {
  id: string;
  type: 'fire' | 'smoke' | 'smoke_burst' | 'ember' | 'spark';
  x: number;
  y: number;
  vx: number;
  vy: number;
  spawnTime: number;
  initialLifetime: number;
  lifetime: number;
  size: number;
  color?: string;
  alpha: number;
}

interface FurnaceParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  alpha: number;
  type: 'forge_fire' | 'industrial_smoke' | 'metal_spark';
}

interface BarbecueParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  alpha: number;
  type: 'grill_fire' | 'grill_smoke' | 'ember';
}

interface StaticCampfirePosition {
  id: string;
  posX: number;
  posY: number;
}

interface HostileDeathEvent {
  id: string;
  x: number;
  y: number;
  species: string;
  timestamp: number;
}

interface HitRecord {
  entityId: string;
  lastHitTimeMicros: bigint;
}

interface CachedAnimalState {
  posX: number;
  posY: number;
  species: string;
  lastHitTimeMicros: bigint;
}

interface StructureHitRecord {
  structureId: string;
  lastHitTimeMicros: bigint;
}

export interface GameCanvasParticleRuntimeOptions {
  localPlayer: Player | null | undefined;
  sceneRuntime: GameCanvasRuntimeSceneSnapshot;
  localPlayerId?: string;
  localFacingDirectionRef?: MutableRef<string | undefined>;
}

const SMOKE_TARGET_ALPHA = 0.05;
const SMOKE_INITIAL_ALPHA = 0.6;
const SMOKE_BURST_LIFETIME_MIN = 600;
const SMOKE_BURST_LIFETIME_MAX = 1500;
const SMOKE_BURST_COLORS = ['#1a1a1a', '#2a2a2a', '#333333', '#000000'];
const SMOKE_BURST_SPEED_X_SPREAD = 0.5;
const SMOKE_BURST_SPEED_Y_MIN = -0.2;
const SMOKE_BURST_SPEED_Y_MAX = -0.5;
const SMOKE_BURST_SIZE_MIN = 3;
const SMOKE_BURST_SIZE_MAX = 6;
const SMOKE_BURST_INITIAL_ALPHA = 0.9;

const TORCH_PARTICLE_LIFETIME_MIN = 100;
const TORCH_PARTICLE_LIFETIME_MAX = 250;
const TORCH_PARTICLE_SPEED_Y_MIN = -0.8;
const TORCH_PARTICLE_SPEED_Y_MAX = -1.5;
const TORCH_PARTICLE_SPEED_X_SPREAD = 0.8;
const TORCH_PARTICLE_SIZE_MIN = 3;
const TORCH_PARTICLE_SIZE_MAX = 6;
const TORCH_PARTICLE_COLORS = ['#FFE55C', '#FFD878', '#FFB04A', '#FF783C', '#FC9842', '#FF4500'];
const TORCH_FIRE_PARTICLES_PER_FRAME = 2.0;
const TORCH_SMOKE_PARTICLES_PER_FIRE_PARTICLE = 0.4;
const TORCH_SMOKE_LIFETIME_MIN = 300;
const TORCH_SMOKE_LIFETIME_MAX = 600;
const TORCH_SMOKE_SPEED_Y_MIN = -0.2;
const TORCH_SMOKE_SPEED_Y_MAX = -0.5;
const TORCH_SMOKE_SPEED_X_SPREAD = 0.4;
const TORCH_SMOKE_SIZE_MIN = 4;
const TORCH_SMOKE_SIZE_MAX = 7;
const TORCH_SMOKE_COLORS = ['#A0A0A0', '#B0B0B0', '#C0C0C0'];
const TORCH_SMOKE_GROWTH_RATE = 0.025;
const TORCH_SMOKE_INITIAL_ALPHA = 0.5;
const TORCH_SMOKE_TARGET_ALPHA = 0.05;
const TORCH_SMOKE_Y_ACCELERATION = -0.008;

const FIRE_ARROW_PARTICLE_LIFETIME_MIN = 80;
const FIRE_ARROW_PARTICLE_LIFETIME_MAX = 180;
const FIRE_ARROW_PARTICLE_SPEED_Y_MIN = -0.4;
const FIRE_ARROW_PARTICLE_SPEED_Y_MAX = -1.0;
const FIRE_ARROW_PARTICLE_SPEED_X_SPREAD = 0.5;
const FIRE_ARROW_PARTICLE_SIZE_MIN = 2;
const FIRE_ARROW_PARTICLE_SIZE_MAX = 4;
const FIRE_ARROW_PARTICLE_COLORS = ['#FFE878', '#FFC04A', '#FF983C', '#FFA842'];
const FIRE_ARROW_PARTICLES_PER_FRAME = 1.2;
const PROJECTILE_FIRE_ARROW_PARTICLES_PER_FRAME = 2.0;
const PROJECTILE_FIRE_ARROW_PARTICLE_LIFETIME_MIN = 120;
const PROJECTILE_FIRE_ARROW_PARTICLE_LIFETIME_MAX = 250;
const FIRE_ARROW_SMOKE_PARTICLES_PER_FIRE_PARTICLE = 0.5;
const FIRE_ARROW_SMOKE_LIFETIME_MIN = 250;
const FIRE_ARROW_SMOKE_LIFETIME_MAX = 500;
const FIRE_ARROW_SMOKE_SPEED_Y_MIN = -0.15;
const FIRE_ARROW_SMOKE_SPEED_Y_MAX = -0.4;
const FIRE_ARROW_SMOKE_SPEED_X_SPREAD = 0.4;
const FIRE_ARROW_SMOKE_SIZE_MIN = 3;
const FIRE_ARROW_SMOKE_SIZE_MAX = 5;
const FIRE_ARROW_SMOKE_COLORS = ['#B0B0B0', '#C0C0C0', '#D0D0D0'];
const FIRE_ARROW_SMOKE_GROWTH_RATE = 0.03;
const FIRE_ARROW_SMOKE_INITIAL_ALPHA = 0.6;
const FIRE_ARROW_SMOKE_TARGET_ALPHA = 0.05;
const FIRE_ARROW_SMOKE_Y_ACCELERATION = -0.008;

const FIRE_PATCH_FIRE_LIFETIME_MIN = 80;
const FIRE_PATCH_FIRE_LIFETIME_MAX = 200;
const FIRE_PATCH_FIRE_SPEED_Y_MIN = -0.60;
const FIRE_PATCH_FIRE_SPEED_Y_MAX = -0.75;
const FIRE_PATCH_FIRE_SPEED_X_SPREAD = 0.8;
const FIRE_PATCH_FIRE_SIZE_MIN = 2;
const FIRE_PATCH_FIRE_SIZE_MAX = 4;
const FIRE_PATCH_FIRE_COLORS = ['#FFD878', '#FFB04A', '#FF783C', '#FC9842'];
const FIRE_PATCH_SMOKE_LIFETIME_MIN = 800;
const FIRE_PATCH_SMOKE_LIFETIME_MAX = 1800;
const FIRE_PATCH_SMOKE_SPEED_Y_MIN = -0.1;
const FIRE_PATCH_SMOKE_SPEED_Y_MAX = -0.3;
const FIRE_PATCH_SMOKE_SPEED_X_SPREAD = 0.4;
const FIRE_PATCH_SMOKE_SIZE_MIN = 3;
const FIRE_PATCH_SMOKE_SIZE_MAX = 5;
const FIRE_PATCH_SMOKE_GROWTH_RATE = 0.03;
const FIRE_PATCH_SMOKE_INITIAL_ALPHA = 0.6;
const FIRE_PATCH_SMOKE_COLORS = ['#666666', '#777777', '#888888', '#999999', '#555555'];
const FIRE_PATCH_EMISSION_ZONES = [
  { name: 'top', yOffset: -10, emissionRate: 0.4, spread: { x: 6, y: 3 }, speedMultiplier: 1.0 },
  { name: 'middle', yOffset: 0, emissionRate: 0.3, spread: { x: 10, y: 5 }, speedMultiplier: 0.8 },
  { name: 'base', yOffset: 5, emissionRate: 0.15, spread: { x: 12, y: 6 }, speedMultiplier: 0.6 },
];

const SPARKLE_PARTICLE_LIFETIME_MIN = 800;
const SPARKLE_PARTICLE_LIFETIME_MAX = 1200;
const SPARKLE_PARTICLE_SPEED_Y_MIN = -0.3;
const SPARKLE_PARTICLE_SPEED_Y_MAX = -0.6;
const SPARKLE_PARTICLE_SPEED_X_SPREAD = 0.2;
const SPARKLE_PARTICLE_SIZE_MIN = 1;
const SPARKLE_PARTICLE_SIZE_MAX = 3;
const DAY_SPARKLE_COLORS = ['#FFD700', '#FFEB3B', '#FFF59D', '#FFFFFF', '#E1F5FE'];
const NIGHT_SPARKLE_COLORS = ['#00DDFF', '#00BFFF', '#1E90FF', '#87CEEB', '#00FFFF'];
const SPARKLES_PER_RESOURCE_FRAME = 0.15;

const DEATH_PARTICLE_LIFETIME_MIN = 400;
const DEATH_PARTICLE_LIFETIME_MAX = 900;
const DEATH_PARTICLE_SPEED_Y_MIN = -1.5;
const DEATH_PARTICLE_SPEED_Y_MAX = -3.0;
const DEATH_PARTICLE_SPEED_X_SPREAD = 2.5;
const DEATH_PARTICLE_SIZE_MIN = 2;
const DEATH_PARTICLE_SIZE_MAX = 5;
const DEATH_PARTICLE_COLORS_BASE = ['#6366F1', '#8B5CF6', '#A855F7', '#7C3AED', '#4F46E5'];
const DEATH_PARTICLE_COLORS_BRIGHT = ['#818CF8', '#A78BFA', '#C4B5FD', '#60A5FA', '#93C5FD'];
const DEATH_PARTICLE_COLORS_WHITE = ['#E0E7FF', '#EDE9FE', '#F5F3FF', '#FFFFFF'];
const WHITE_FLASH_LIFETIME_MS = 120;
const WHITE_FLASH_PARTICLE_COUNT = 18;
const SPECIES_COLORS: Record<string, string[]> = {
  Shorebound: ['#22D3EE', '#06B6D4', '#0EA5E9', '#38BDF8', '#67E8F9'],
  Shardkin: ['#A855F7', '#8B5CF6', '#7C3AED', '#C084FC', '#D8B4FE'],
  DrownedWatch: ['#3B82F6', '#2563EB', '#1D4ED8', '#60A5FA', '#1E40AF'],
};
const SPECIES_PARTICLE_COUNT: Record<string, number> = {
  Shorebound: 45,
  Shardkin: 25,
  DrownedWatch: 80,
};
const HOSTILE_DEATH_MAX_PARTICLES = 800;
const PROCESSED_EVENTS_MAX = 50;

const BLOOD_PARTICLE_LIFETIME_MIN = 200;
const BLOOD_PARTICLE_LIFETIME_MAX = 500;
const BLOOD_PARTICLE_SPEED = 2.5;
const BLOOD_PARTICLE_GRAVITY = 0.15;
const BLOOD_PARTICLE_SIZE_MIN = 2;
const BLOOD_PARTICLE_SIZE_MAX = 5;
const BLOOD_COLORS = ['#8B0000', '#A52A2A', '#B22222', '#CD5C5C', '#DC143C'];
const BLOOD_COLORS_BRIGHT = ['#E74C3C', '#EC7063', '#F1948A'];
const ETHEREAL_PARTICLE_LIFETIME_MIN = 300;
const ETHEREAL_PARTICLE_LIFETIME_MAX = 600;
const ETHEREAL_PARTICLE_SPEED = 1.5;
const ETHEREAL_PARTICLE_SIZE_MIN = 3;
const ETHEREAL_PARTICLE_SIZE_MAX = 6;
const ETHEREAL_COLORS: Record<string, string[]> = {
  Shorebound: ['#22D3EE', '#06B6D4', '#0EA5E9', '#67E8F9', '#A5F3FC'],
  Shardkin: ['#A855F7', '#8B5CF6', '#C084FC', '#D8B4FE', '#E9D5FF'],
  DrownedWatch: ['#3B82F6', '#2563EB', '#60A5FA', '#93C5FD', '#BFDBFE'],
};
const ETHEREAL_COLORS_WHITE = ['#E0E7FF', '#EDE9FE', '#F5F3FF', '#FFFFFF'];
const HOSTILE_SPECIES = ['Shorebound', 'Shardkin', 'DrownedWatch'];
const BASE_PARTICLE_COUNT = 8;
const MAX_PARTICLES_PER_HIT = 25;

const STRUCT_SPARK_PARTICLE_LIFETIME_MIN = 150;
const STRUCT_SPARK_PARTICLE_LIFETIME_MAX = 400;
const STRUCT_SPARK_PARTICLE_SPEED = 3.0;
const STRUCT_SPARK_PARTICLE_GRAVITY = 0.2;
const STRUCT_SPARK_PARTICLE_SIZE_MIN = 2;
const STRUCT_SPARK_PARTICLE_SIZE_MAX = 4;
const STRUCT_SPARK_COLORS_HOT = ['#FFD700', '#FFA500', '#FF8C00', '#FFE4B5', '#FFFF00'];
const STRUCT_SPARK_COLORS_COOL = ['#FF6347', '#FF4500', '#CD853F'];
const BASE_SPARK_COUNT = 12;
const MAX_SPARKS_PER_HIT = 20;

const TALLOW_SMOKE_CORE_COLORS = ['#A08060', '#9C8C70', '#8B7355'];
const TALLOW_SMOKE_CORE_LIFETIME_MIN = 3000;
const TALLOW_SMOKE_CORE_LIFETIME_MAX = 5000;
const TALLOW_SMOKE_CORE_SPEED_Y_MIN = -0.15;
const TALLOW_SMOKE_CORE_SPEED_Y_MAX = -0.25;
const TALLOW_SMOKE_CORE_SIZE_MIN = 4;
const TALLOW_SMOKE_CORE_SIZE_MAX = 8;
const TALLOW_SMOKE_CORE_EMISSION_RATE = 0.8;
const TALLOW_SMOKE_CORE_INITIAL_ALPHA = 0.45;
const TALLOW_SMOKE_GROWTH_RATE = 0.02;
const TALLOW_SMOKE_X_DRIFT_SPEED = 0.002;
const ANCESTRAL_WARD_SMOKE_Y_OFFSET_FACTOR = 0.55;
const ANCESTRAL_WARD_SMOKE_Y_DROP_OFFSET = 55;
const ANCESTRAL_WARD_SMOKE_X_OFFSET = -8;
const TALLOW_FIRE_CORE_COLORS = ['#FFEE99', '#FFE066', '#FFD633'];
const TALLOW_FIRE_CORE_LIFETIME_MIN = 400;
const TALLOW_FIRE_CORE_LIFETIME_MAX = 600;
const TALLOW_FIRE_CORE_SPEED_Y_MIN = -0.3;
const TALLOW_FIRE_CORE_SPEED_Y_MAX = -0.5;
const TALLOW_FIRE_CORE_SIZE_MIN = 3;
const TALLOW_FIRE_CORE_SIZE_MAX = 5;
const TALLOW_FIRE_CORE_EMISSION_RATE = 2.5;
const TALLOW_FIRE_MID_COLORS = ['#FFB04A', '#FFA030', '#FF9020'];
const TALLOW_FIRE_MID_LIFETIME_MIN = 500;
const TALLOW_FIRE_MID_LIFETIME_MAX = 800;
const TALLOW_FIRE_MID_EMISSION_RATE = 1.5;
const STATIC_COLORS = ['#00FFFF', '#FFFFFF', '#88FFFF', '#AAFFFF', '#66DDFF'];
const STATIC_LIFETIME_MIN = 50;
const STATIC_LIFETIME_MAX = 150;
const STATIC_SPEED_Y_MIN = -0.5;
const STATIC_SPEED_Y_MAX = -1.2;
const STATIC_SPEED_X_SPREAD = 0.8;
const STATIC_SIZE_MIN = 1;
const STATIC_SIZE_MAX = 2;
const STATIC_EMISSION_RATE = 0.6;
const STATIC_INITIAL_ALPHA = 1.0;
const DISRUPTOR_FIRE_CORE_COLORS = ['#FFEE99', '#FFE066', '#FFD633', '#FF9933'];
const DISRUPTOR_FIRE_CORE_LIFETIME_MIN = 350;
const DISRUPTOR_FIRE_CORE_LIFETIME_MAX = 550;
const DISRUPTOR_FIRE_CORE_SIZE_MIN = 3;
const DISRUPTOR_FIRE_CORE_SIZE_MAX = 5;
const DISRUPTOR_FIRE_CORE_EMISSION_RATE = 2.0;
const DISRUPTOR_FIRE_MID_COLORS = ['#FFB04A', '#FFA030', '#FF9020'];
const DISRUPTOR_FIRE_MID_LIFETIME_MIN = 400;
const DISRUPTOR_FIRE_MID_LIFETIME_MAX = 650;
const DISRUPTOR_FIRE_MID_EMISSION_RATE = 1.2;
const DISRUPTOR_FURNACE_Y_OFFSET = -60;
const DISRUPTOR_FURNACE_X_OFFSET = -25;
const DISRUPTOR_FURNACE_X_SPREAD = 25;
const MEMORY_COLORS = ['#9966FF', '#7744DD', '#AA88FF', '#6633CC', '#BB99FF', '#5522AA'];
const MEMORY_LIFETIME_MIN = 800;
const MEMORY_LIFETIME_MAX = 1800;
const MEMORY_SPEED_Y_MIN = -0.04;
const MEMORY_SPEED_Y_MAX = -0.12;
const MEMORY_SPEED_X_SPREAD = 0.2;
const MEMORY_SIZE_MIN = 2;
const MEMORY_SIZE_MAX = 5;
const MEMORY_EMISSION_RATE = 0.35;
const MEMORY_INITIAL_ALPHA = 0.7;
const MEMORY_PULSE_SPEED = 0.003;
const WARD_EMISSION_Y_OFFSET_FACTOR = 0.3;
const TALLOW_FIRE_BASE_Y_OFFSET = -50;
const TALLOW_FIRE_X_OFFSET = -10;
const TALLOW_FIRE_Y_OFFSET_UP = -20;

function isNightTime(cycleProgress: number): boolean {
  return cycleProgress >= 0.76;
}

function getSpeciesName(animal: WildAnimal): string {
  return (animal.species as any)?.tag || 'Unknown';
}

export class GameCanvasParticleRuntime {
  private options: GameCanvasParticleRuntimeOptions | null = null;

  private readonly memoryParticleGradientCache = new Map<string, CanvasGradient>();
  private readonly particleBuckets = {
    fire: [] as any[],
    ember: [] as any[],
    spark: [] as any[],
    other: [] as any[],
    memory: [] as any[],
    regularSmoke: [] as any[],
  };

  private readonly campfireParticles: Particle[] = [];
  private readonly campfireSmokeBurstAcc = new Map<string, number>();
  private readonly campfireLastUpdateTime = { current: performance.now() };

  private readonly torchParticles: Particle[] = [];
  private readonly torchEmissionAcc = new Map<string, number>();
  private readonly torchLastUpdateTime = { current: performance.now() };

  private readonly fireArrowParticles: Particle[] = [];
  private readonly fireArrowEmissionAcc = new Map<string, number>();
  private readonly projectileFireArrowEmissionAcc = new Map<string, number>();
  private readonly clientProjectileStartTimes = new Map<string, number>();
  private readonly lastKnownServerProjectileTimes = new Map<string, number>();
  private readonly fireArrowLastUpdateTime = { current: performance.now() };

  private readonly furnaceParticles: FurnaceParticle[] = [];
  private readonly furnaceLastUpdateTime = { current: performance.now() };

  private readonly barbecueParticles: BarbecueParticle[] = [];
  private readonly barbecueLastUpdateTime = { current: performance.now() };

  private readonly firePatchParticles: Particle[] = [];
  private readonly firePatchFireAcc = new Map<string, number>();
  private readonly firePatchSmokeAcc = new Map<string, number>();
  private readonly firePatchSmokeBurstAcc = new Map<string, number>();
  private readonly firePatchLastUpdateTime = { current: performance.now() };

  private readonly wardParticles: Particle[] = [];
  private readonly wardEmissionAcc = new Map<string, number>();
  private readonly wardLastUpdateTime = { current: performance.now() };

  private readonly resourceSparkleParticles: Particle[] = [];
  private readonly resourceSparkleEmissionAcc = new Map<string, number>();
  private readonly resourceSparkleLastUpdateTime = { current: performance.now() };

  private readonly hostileDeathParticles: Particle[] = [];
  private readonly processedHostileDeathEvents = new Set<string>();
  private readonly hostileDeathLastUpdateTime = { current: performance.now() };

  private readonly impactParticles: Particle[] = [];
  private readonly animalHitRecords = new Map<string, HitRecord>();
  private readonly corpseHitRecords = new Map<string, HitRecord>();
  private playerHitRecord = 0n;
  private prevAnimals = new Map<string, CachedAnimalState>();
  private initializedCorpses = false;
  private readonly seenCorpses = new Set<string>();
  private readonly impactLastUpdateTime = { current: performance.now() };

  private readonly structureImpactParticles: Particle[] = [];
  private readonly wallHitRecords = new Map<string, StructureHitRecord>();
  private readonly doorHitRecords = new Map<string, StructureHitRecord>();
  private readonly shelterHitRecords = new Map<string, StructureHitRecord>();
  private readonly structureImpactLastUpdateTime = { current: performance.now() };

  private readonly campfireEmitterScratch: CampfireFireGpuEmitter[] = [];
  private readonly campfirePrevBurning = new Map<string, boolean>();
  private readonly campfireLingerUntil = new Map<string, number>();
  private readonly campfireLastPlumeReach01 = new Map<string, number>();
  private readonly villageCampfirePositions: StaticCampfirePosition[] = [];

  private readonly snapshot: GameCanvasRuntimeParticleSnapshot;

  constructor() {
    this.snapshot = {
      renderParticles: this.renderParticles,
      computeCampfireFireOverlayEmitters: this.computeCampfireFireOverlayEmitters,
      campfireParticles: this.campfireParticles,
      torchParticles: this.torchParticles,
      fireArrowParticles: this.fireArrowParticles,
      furnaceParticles: this.furnaceParticles,
      barbecueParticles: this.barbecueParticles,
      firePatchParticles: this.firePatchParticles,
      wardParticles: this.wardParticles,
      resourceSparkleParticles: this.resourceSparkleParticles,
      hostileDeathParticles: this.hostileDeathParticles,
      impactParticles: this.impactParticles,
      structureImpactParticles: this.structureImpactParticles,
    };
  }

  configure(options: GameCanvasParticleRuntimeOptions): GameCanvasRuntimeParticleSnapshot {
    this.options = options;
    this.updateVillageCampfires(options.sceneRuntime);
    return this.snapshot;
  }

  getSnapshot(): GameCanvasRuntimeParticleSnapshot {
    return this.snapshot;
  }

  update(): void {
    const options = this.options;
    if (!options) {
      return;
    }

    this.updateVillageCampfires(options.sceneRuntime);
    this.updateCampfireParticles(options.sceneRuntime.visibleCampfiresMap);
    this.updateTorchParticles(options);
    this.updateFireArrowParticles(options.sceneRuntime);
    this.updateFurnaceParticles(options.sceneRuntime.visibleFurnacesMap);
    this.updateBarbecueParticles(options.sceneRuntime.visibleBarbecuesMap);
    this.updateFirePatchParticles(options.sceneRuntime.firePatches, options.localPlayer ?? null);
    this.updateWardParticles(options.sceneRuntime.visibleLanternsMap);
    this.updateResourceSparkleParticles(
      options.sceneRuntime.visibleHarvestableResourcesMap,
      options.sceneRuntime.worldState?.cycleProgress ?? 0.5,
    );
    this.updateHostileDeathParticles(options.sceneRuntime.hostileDeathEvents ?? []);
    this.updateImpactParticles(
      options.sceneRuntime.wildAnimals,
      options.sceneRuntime.animalCorpses,
      options.localPlayer ?? null,
    );
    this.updateStructureImpactParticles(
      options.sceneRuntime.wallCells,
      options.sceneRuntime.doors,
      options.sceneRuntime.shelters,
    );
  }

  stop(): void {
    this.campfireParticles.length = 0;
    this.torchParticles.length = 0;
    this.fireArrowParticles.length = 0;
    this.furnaceParticles.length = 0;
    this.barbecueParticles.length = 0;
    this.firePatchParticles.length = 0;
    this.wardParticles.length = 0;
    this.resourceSparkleParticles.length = 0;
    this.hostileDeathParticles.length = 0;
    this.impactParticles.length = 0;
    this.structureImpactParticles.length = 0;
  }

  private readonly renderParticles = (ctx: CanvasRenderingContext2D, particles: any[]) => {
    renderParticlesToCanvas(
      ctx,
      particles,
      this.particleBuckets,
      this.memoryParticleGradientCache,
    );
  };

  private updateVillageCampfires(sceneRuntime: GameCanvasRuntimeSceneSnapshot): void {
    this.villageCampfirePositions.length = 0;
    const monumentParts = sceneRuntime.monumentParts;
    if (!monumentParts || monumentParts.size === 0) {
      return;
    }

    monumentParts.forEach((part: any) => {
      const tag = part.monumentType?.tag ?? '';
      const isFishingVillageCampfire = tag === 'FishingVillage' && part.isCenter;
      const isHuntingVillageCampfire = tag === 'HuntingVillage' && part.partType === 'campfire';

      if ((isFishingVillageCampfire || isHuntingVillageCampfire) && part.imagePath === 'fv_campfire.png') {
        this.villageCampfirePositions.push({ id: part.id.toString(), posX: part.worldX, posY: part.worldY });
      }
    });
  }

  private updateCampfireParticles(visibleCampfiresMap: Map<string, Campfire>): void {
    const now = performance.now();
    const deltaTime = getClampedRafDeltaMs(now, this.campfireLastUpdateTime);
    if (deltaTime <= 0) return;

    const currentParticles = this.campfireParticles;
    let liveParticleCount = 0;
    const deltaTimeFactor = deltaTime / 16.667;

    for (let i = 0; i < currentParticles.length; i++) {
      const p = currentParticles[i]!;
      if (p.type !== 'smoke_burst') continue;

      const age = now - p.spawnTime;
      const lifetimeRemaining = p.initialLifetime - age;
      if (lifetimeRemaining <= 0) continue;

      const newVy = p.vy - 0.0015 * deltaTimeFactor;
      const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
      const currentAlpha = SMOKE_TARGET_ALPHA + (SMOKE_INITIAL_ALPHA + 0.4 - SMOKE_TARGET_ALPHA) * lifeRatio;

      p.x += p.vx * deltaTimeFactor;
      p.y += newVy * deltaTimeFactor;
      p.vy = newVy;
      p.lifetime = lifetimeRemaining;
      p.alpha = Math.max(0, Math.min(1, currentAlpha));

      if (p.alpha > 0.01) currentParticles[liveParticleCount++] = p;
    }
    currentParticles.length = liveParticleCount;

    const currentVisibleCampfireIds = new Set<string>();
    visibleCampfiresMap.forEach((campfire, campfireId) => {
      currentVisibleCampfireIds.add(campfireId);
      if (campfire.isDestroyed) return;

      const visualCenterX = campfire.posX;
      const visualCenterY = campfire.posY - CAMPFIRE_HEIGHT / 2 - CAMPFIRE_RENDER_Y_OFFSET;

      if (campfire.isPlayerInHotZone && campfire.isBurning) {
        let burstAcc = this.campfireSmokeBurstAcc.get(campfireId) || 0;
        burstAcc += 4.0 * deltaTimeFactor;
        while (burstAcc >= 1) {
          burstAcc -= 1;
          const lifetime = SMOKE_BURST_LIFETIME_MIN + Math.random() * (SMOKE_BURST_LIFETIME_MAX - SMOKE_BURST_LIFETIME_MIN);
          currentParticles.push({
            id: `smokeburst_${campfireId}_${now}_${Math.random()}`,
            type: 'smoke_burst',
            x: visualCenterX + (Math.random() - 0.5) * 20,
            y: visualCenterY + (Math.random() - 0.5) * 16,
            vx: (Math.random() - 0.5) * SMOKE_BURST_SPEED_X_SPREAD,
            vy: SMOKE_BURST_SPEED_Y_MIN + Math.random() * (SMOKE_BURST_SPEED_Y_MAX - SMOKE_BURST_SPEED_Y_MIN),
            spawnTime: now,
            initialLifetime: lifetime,
            lifetime,
            size: SMOKE_BURST_SIZE_MIN + Math.floor(Math.random() * (SMOKE_BURST_SIZE_MAX - SMOKE_BURST_SIZE_MIN + 1)),
            color: SMOKE_BURST_COLORS[Math.floor(Math.random() * SMOKE_BURST_COLORS.length)],
            alpha: SMOKE_BURST_INITIAL_ALPHA,
          });
        }
        this.campfireSmokeBurstAcc.set(campfireId, burstAcc);
      } else {
        this.campfireSmokeBurstAcc.set(campfireId, 0);
      }
    });

    this.villageCampfirePositions.forEach((s) => currentVisibleCampfireIds.add(`static_${s.id}`));
    this.campfireSmokeBurstAcc.forEach((_value, campfireId) => {
      if (!currentVisibleCampfireIds.has(campfireId)) this.campfireSmokeBurstAcc.delete(campfireId);
    });
  }

  private updateTorchParticles({
    sceneRuntime,
    localPlayerId,
    localFacingDirectionRef,
  }: GameCanvasParticleRuntimeOptions): void {
    const now = performance.now();
    const deltaTime = getClampedRafDeltaMs(now, this.torchLastUpdateTime);
    if (deltaTime <= 0) return;

    const currentParticles = this.torchParticles;
    const deltaTimeFactor = deltaTime / 16.667;

    sceneRuntime.players.forEach((player: Player, playerId: string) => {
      if (!player || player.isDead) {
        this.torchEmissionAcc.set(playerId, 0);
        return;
      }

      const equipment = sceneRuntime.activeEquipments.get(playerId) as ActiveEquipment | undefined;
      const itemDefId = equipment?.equippedItemDefId;
      const itemDef = itemDefId ? sceneRuntime.itemDefinitions.get(itemDefId.toString()) as ItemDefinition | undefined : null;
      const isTorchCurrentlyActiveAndLit = !!(itemDef && itemDef.name === 'Torch' && player.isTorchLit);

      if (!isTorchCurrentlyActiveAndLit) {
        this.torchEmissionAcc.set(playerId, 0);
        return;
      }

      if (isCampfireFireWebGLOverlayAvailable()) {
        this.torchEmissionAcc.set(playerId, 0);
        return;
      }

      let acc = this.torchEmissionAcc.get(playerId) || 0;
      acc += TORCH_FIRE_PARTICLES_PER_FRAME * deltaTimeFactor;

      const directionForTorch =
        localPlayerId && playerId === localPlayerId
          ? localFacingDirectionRef?.current ?? player.direction ?? 'down'
          : player.direction ?? 'down';

      const anchor = getTorchGpuFlameAnchorWorld({
        worldX: player.positionX,
        worldY: player.positionY,
        direction: directionForTorch,
        jumpStartTimeMs: player.jumpStartTimeMs,
        swingStartTimeMs: Number(equipment?.swingStartTimeMs ?? 0),
        nowMs: now,
      });
      const emissionPointX = anchor.x;
      const emissionPointY = anchor.y - TORCH_FLAME_ANCHOR_FIRE_BASE_Y_OFFSET;

      while (acc >= 1) {
        acc -= 1;
        const lifetime = TORCH_PARTICLE_LIFETIME_MIN + Math.random() * (TORCH_PARTICLE_LIFETIME_MAX - TORCH_PARTICLE_LIFETIME_MIN);
        const fireEmissionY = emissionPointY + TORCH_FLAME_ANCHOR_FIRE_BASE_Y_OFFSET;
        currentParticles.push({
          id: `torch_fire_${playerId}_${now}_${Math.random()}`,
          type: 'fire',
          x: emissionPointX + (Math.random() - 0.5) * 3,
          y: fireEmissionY + (Math.random() - 0.5) * 3,
          vx: (Math.random() - 0.5) * TORCH_PARTICLE_SPEED_X_SPREAD,
          vy: TORCH_PARTICLE_SPEED_Y_MIN + Math.random() * (TORCH_PARTICLE_SPEED_Y_MAX - TORCH_PARTICLE_SPEED_Y_MIN),
          spawnTime: now,
          initialLifetime: lifetime,
          lifetime,
          size: Math.floor(TORCH_PARTICLE_SIZE_MIN + Math.random() * (TORCH_PARTICLE_SIZE_MAX - TORCH_PARTICLE_SIZE_MIN)) + 1,
          color: TORCH_PARTICLE_COLORS[Math.floor(Math.random() * TORCH_PARTICLE_COLORS.length)],
          alpha: 1.0,
        });

        if (Math.random() < TORCH_SMOKE_PARTICLES_PER_FIRE_PARTICLE) {
          const smokeLifetime = TORCH_SMOKE_LIFETIME_MIN + Math.random() * (TORCH_SMOKE_LIFETIME_MAX - TORCH_SMOKE_LIFETIME_MIN);
          currentParticles.push({
            id: `torch_smoke_${playerId}_${now}_${Math.random()}`,
            type: 'smoke',
            x: emissionPointX + (Math.random() - 0.5) * 4,
            y: emissionPointY - 3 + (Math.random() - 0.5) * 3,
            vx: (Math.random() - 0.5) * TORCH_SMOKE_SPEED_X_SPREAD,
            vy: TORCH_SMOKE_SPEED_Y_MIN + Math.random() * (TORCH_SMOKE_SPEED_Y_MAX - TORCH_SMOKE_SPEED_Y_MIN),
            spawnTime: now,
            initialLifetime: smokeLifetime,
            lifetime: smokeLifetime,
            size: Math.floor(TORCH_SMOKE_SIZE_MIN + Math.random() * (TORCH_SMOKE_SIZE_MAX - TORCH_SMOKE_SIZE_MIN)) + 1,
            color: TORCH_SMOKE_COLORS[Math.floor(Math.random() * TORCH_SMOKE_COLORS.length)],
            alpha: TORCH_SMOKE_INITIAL_ALPHA,
          });
        }
      }
      this.torchEmissionAcc.set(playerId, acc);
    });

    let liveParticleCount = 0;
    for (let i = 0; i < currentParticles.length; i++) {
      const p = currentParticles[i]!;
      const age = now - p.spawnTime;
      const lifetimeRemaining = p.initialLifetime - age;
      if (lifetimeRemaining <= 0) continue;

      let newVx = p.vx;
      let newVy = p.vy;
      let newSize = p.size;
      let currentAlpha = p.alpha;

      if (p.type === 'smoke') {
        newVy += TORCH_SMOKE_Y_ACCELERATION * deltaTimeFactor;
        newSize = Math.min(p.size + TORCH_SMOKE_GROWTH_RATE * deltaTimeFactor, TORCH_SMOKE_SIZE_MAX);
        const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
        currentAlpha = TORCH_SMOKE_TARGET_ALPHA + (TORCH_SMOKE_INITIAL_ALPHA - TORCH_SMOKE_TARGET_ALPHA) * lifeRatio;
      } else if (p.type === 'fire') {
        const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
        newVx += (Math.random() - 0.5) * 0.3 * deltaTimeFactor;
        const baseSize = p.size * (0.7 + 0.3 * lifeRatio);
        newSize = Math.max(1, baseSize + (Math.random() - 0.5) * 0.4);
        currentAlpha = Math.max(0, Math.min(1, lifeRatio + (Math.random() - 0.5) * 0.1));
      }

      p.x += newVx * deltaTimeFactor;
      p.y += newVy * deltaTimeFactor;
      p.vx = newVx;
      p.vy = newVy;
      p.lifetime = lifetimeRemaining;
      p.size = newSize;
      p.alpha = Math.max(0, Math.min(1, currentAlpha));
      if (p.alpha > 0.01) currentParticles[liveParticleCount++] = p;
    }
    currentParticles.length = liveParticleCount;
  }

  private updateFireArrowParticles(sceneRuntime: GameCanvasRuntimeSceneSnapshot): void {
    const now = performance.now();
    const deltaTime = getClampedRafDeltaMs(now, this.fireArrowLastUpdateTime);
    if (deltaTime <= 0) return;

    const currentProjectileIds = new Set<string>();
    sceneRuntime.renderableProjectiles.forEach((projectile: Projectile) => currentProjectileIds.add(getProjectileTrackingKey(projectile)));
    for (const key of Array.from(this.projectileFireArrowEmissionAcc.keys())) {
      if (!currentProjectileIds.has(key)) this.projectileFireArrowEmissionAcc.delete(key);
    }
    for (const key of Array.from(this.clientProjectileStartTimes.keys())) {
      if (!currentProjectileIds.has(key)) this.clientProjectileStartTimes.delete(key);
    }
    for (const key of Array.from(this.lastKnownServerProjectileTimes.keys())) {
      if (!currentProjectileIds.has(key)) this.lastKnownServerProjectileTimes.delete(key);
    }

    const currentParticles = this.fireArrowParticles;
    const deltaTimeFactor = deltaTime / 16.667;

    sceneRuntime.players.forEach((player: Player, playerId: string) => {
      if (!player || player.isDead) {
        this.fireArrowEmissionAcc.set(playerId, 0);
        return;
      }

      const equipment = sceneRuntime.activeEquipments.get(playerId) as ActiveEquipment | undefined;
      if (!equipment || !equipment.equippedItemDefId || !equipment.isReadyToFire || !equipment.loadedAmmoDefId) {
        this.fireArrowEmissionAcc.set(playerId, 0);
        return;
      }

      const weaponDef = sceneRuntime.itemDefinitions.get(equipment.equippedItemDefId.toString()) as ItemDefinition | undefined;
      const ammoDef = sceneRuntime.itemDefinitions.get(equipment.loadedAmmoDefId.toString()) as ItemDefinition | undefined;
      const isFireArrowLoaded = !!(weaponDef && ammoDef &&
        (weaponDef.name === 'Hunting Bow' || weaponDef.name === 'Crossbow') &&
        ammoDef.name === 'Fire Arrow');

      if (!isFireArrowLoaded) {
        this.fireArrowEmissionAcc.set(playerId, 0);
        return;
      }

      let acc = this.fireArrowEmissionAcc.get(playerId) || 0;
      acc += FIRE_ARROW_PARTICLES_PER_FRAME * deltaTimeFactor;

      let currentJumpOffsetY = 0;
      if (player.jumpStartTimeMs > 0) {
        const elapsedJumpTime = now - Number(player.jumpStartTimeMs);
        if (elapsedJumpTime >= 0 && elapsedJumpTime < JUMP_DURATION_MS) {
          const t = elapsedJumpTime / JUMP_DURATION_MS;
          currentJumpOffsetY = Math.sin(t * Math.PI) * JUMP_HEIGHT_PX;
        }
      }

      const playerWorldX = player.positionX;
      const playerWorldY = player.positionY - currentJumpOffsetY;
      let arrowTipX = playerWorldX;
      let arrowTipY = playerWorldY;

      if (weaponDef.name === 'Hunting Bow' || weaponDef.name === 'Crossbow') {
        switch (player.direction) {
          case 'up':
            arrowTipX = playerWorldX + gameConfig.spriteWidth * 0.25 + 25;
            arrowTipY = playerWorldY - gameConfig.spriteHeight * 0.05 - 25;
            break;
          case 'down':
            arrowTipX = playerWorldX + gameConfig.spriteWidth * -0.25 - 25;
            arrowTipY = playerWorldY + gameConfig.spriteHeight * 0.25 + 25;
            break;
          case 'left':
            arrowTipX = playerWorldX - gameConfig.spriteWidth * 0.25 - 25;
            arrowTipY = playerWorldY + 15;
            break;
          case 'right':
            arrowTipX = playerWorldX - gameConfig.spriteWidth * -0.25 - 5;
            arrowTipY = playerWorldY + 20.0;
            break;
        }
      }

      this.emitFireArrowParticles(currentParticles, playerId, now, acc, arrowTipX, arrowTipY, FIRE_ARROW_PARTICLE_LIFETIME_MIN, FIRE_ARROW_PARTICLE_LIFETIME_MAX, (nextAcc) => {
        this.fireArrowEmissionAcc.set(playerId, nextAcc);
      });
    });

    sceneRuntime.renderableProjectiles.forEach((projectile: Projectile) => {
      const projectileTrackingKey = getProjectileTrackingKey(projectile);
      const ammoDef = sceneRuntime.itemDefinitions.get(projectile.ammoDefId.toString()) as ItemDefinition | undefined;

      if (!ammoDef || ammoDef.name !== 'Fire Arrow') {
        this.projectileFireArrowEmissionAcc.set(projectileTrackingKey, 0);
        return;
      }

      const serverStartTimeMs = Number(projectile.startTime.microsSinceUnixEpoch) / 1000;
      const lastKnownServerTime = this.lastKnownServerProjectileTimes.get(projectileTrackingKey) || 0;
      let elapsedTime = 0;

      if (serverStartTimeMs !== lastKnownServerTime) {
        this.lastKnownServerProjectileTimes.set(projectileTrackingKey, serverStartTimeMs);
        this.clientProjectileStartTimes.set(projectileTrackingKey, now);
      } else {
        const clientStartTime = this.clientProjectileStartTimes.get(projectileTrackingKey);
        if (clientStartTime) {
          elapsedTime = (now - clientStartTime) / 1000;
        } else {
          this.clientProjectileStartTimes.set(projectileTrackingKey, now);
        }
      }

      if (elapsedTime < 0) elapsedTime = 0;
      const sampledState = sampleProjectileState(projectile, elapsedTime, sceneRuntime.itemDefinitions);
      let projAcc = this.projectileFireArrowEmissionAcc.get(projectileTrackingKey) || 0;
      projAcc += PROJECTILE_FIRE_ARROW_PARTICLES_PER_FRAME * deltaTimeFactor;
      this.emitFireArrowParticles(
        currentParticles,
        projectileTrackingKey,
        now,
        projAcc,
        sampledState.x,
        sampledState.y,
        PROJECTILE_FIRE_ARROW_PARTICLE_LIFETIME_MIN,
        PROJECTILE_FIRE_ARROW_PARTICLE_LIFETIME_MAX,
        (nextAcc) => this.projectileFireArrowEmissionAcc.set(projectileTrackingKey, nextAcc),
        'projectile_',
      );
    });

    let liveParticleCount = 0;
    for (let i = 0; i < currentParticles.length; i++) {
      const p = currentParticles[i]!;
      const age = now - p.spawnTime;
      const lifetimeRemaining = p.initialLifetime - age;
      if (lifetimeRemaining <= 0) continue;

      let newVy = p.vy;
      let newSize = p.size;
      let currentAlpha = p.alpha;
      if (p.type === 'smoke') {
        newVy += FIRE_ARROW_SMOKE_Y_ACCELERATION * deltaTimeFactor;
        newSize = Math.min(p.size + FIRE_ARROW_SMOKE_GROWTH_RATE * deltaTimeFactor, FIRE_ARROW_SMOKE_SIZE_MAX);
        const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
        currentAlpha = FIRE_ARROW_SMOKE_TARGET_ALPHA + (FIRE_ARROW_SMOKE_INITIAL_ALPHA - FIRE_ARROW_SMOKE_TARGET_ALPHA) * lifeRatio;
      } else if (p.type === 'fire') {
        currentAlpha = Math.max(0, Math.min(1, lifetimeRemaining / p.initialLifetime));
      }

      p.x += p.vx * deltaTimeFactor;
      p.y += newVy * deltaTimeFactor;
      p.vy = newVy;
      p.lifetime = lifetimeRemaining;
      p.size = newSize;
      p.alpha = Math.max(0, Math.min(1, currentAlpha));
      if (p.alpha > 0.01) currentParticles[liveParticleCount++] = p;
    }
    currentParticles.length = liveParticleCount;
  }

  private emitFireArrowParticles(
    currentParticles: Particle[],
    id: string,
    now: number,
    initialAcc: number,
    x: number,
    y: number,
    lifetimeMin: number,
    lifetimeMax: number,
    saveAcc: (value: number) => void,
    idPrefix = '',
  ): void {
    let acc = initialAcc;
    while (acc >= 1) {
      acc -= 1;
      const lifetime = lifetimeMin + Math.random() * (lifetimeMax - lifetimeMin);
      currentParticles.push({
        id: `${idPrefix}fire_arrow_${id}_${now}_${Math.random()}`,
        type: 'fire',
        x: x + (Math.random() - 0.5) * 3,
        y: y + (Math.random() - 0.5) * 3,
        vx: (Math.random() - 0.5) * FIRE_ARROW_PARTICLE_SPEED_X_SPREAD,
        vy: FIRE_ARROW_PARTICLE_SPEED_Y_MIN + Math.random() * (FIRE_ARROW_PARTICLE_SPEED_Y_MAX - FIRE_ARROW_PARTICLE_SPEED_Y_MIN),
        spawnTime: now,
        initialLifetime: lifetime,
        lifetime,
        size: Math.floor(FIRE_ARROW_PARTICLE_SIZE_MIN + Math.random() * (FIRE_ARROW_PARTICLE_SIZE_MAX - FIRE_ARROW_PARTICLE_SIZE_MIN)) + 1,
        color: FIRE_ARROW_PARTICLE_COLORS[Math.floor(Math.random() * FIRE_ARROW_PARTICLE_COLORS.length)],
        alpha: 1.0,
      });

      if (Math.random() < FIRE_ARROW_SMOKE_PARTICLES_PER_FIRE_PARTICLE) {
        const smokeLifetime = FIRE_ARROW_SMOKE_LIFETIME_MIN + Math.random() * (FIRE_ARROW_SMOKE_LIFETIME_MAX - FIRE_ARROW_SMOKE_LIFETIME_MIN);
        currentParticles.push({
          id: `${idPrefix}fire_arrow_smoke_${id}_${now}_${Math.random()}`,
          type: 'smoke',
          x: x + (Math.random() - 0.5) * 4,
          y: y - 2 + (Math.random() - 0.5) * 3,
          vx: (Math.random() - 0.5) * FIRE_ARROW_SMOKE_SPEED_X_SPREAD,
          vy: FIRE_ARROW_SMOKE_SPEED_Y_MIN + Math.random() * (FIRE_ARROW_SMOKE_SPEED_Y_MAX - FIRE_ARROW_SMOKE_SPEED_Y_MIN),
          spawnTime: now,
          initialLifetime: smokeLifetime,
          lifetime: smokeLifetime,
          size: Math.floor(FIRE_ARROW_SMOKE_SIZE_MIN + Math.random() * (FIRE_ARROW_SMOKE_SIZE_MAX - FIRE_ARROW_SMOKE_SIZE_MIN)) + 1,
          color: FIRE_ARROW_SMOKE_COLORS[Math.floor(Math.random() * FIRE_ARROW_SMOKE_COLORS.length)],
          alpha: FIRE_ARROW_SMOKE_INITIAL_ALPHA,
        });
      }
    }
    saveAcc(acc);
  }

  private updateFurnaceParticles(visibleFurnacesMap: Map<string, Furnace>): void {
    const now = performance.now();
    const deltaTime = getClampedRafDeltaMs(now, this.furnaceLastUpdateTime);
    if (deltaTime <= 0) return;

    const currentParticles = this.furnaceParticles;
    let writeIndex = 0;
    const dt = deltaTime / 16.67;

    for (let i = 0; i < currentParticles.length; i++) {
      const particle = currentParticles[i]!;
      const newLife = particle.life - deltaTime;
      if (newLife <= 0) continue;

      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.life = newLife;
      particle.alpha = Math.max(0, newLife / particle.maxLife);
      particle.vy = particle.type === 'metal_spark' ? particle.vy + 0.08 : particle.vy - 0.02;
      currentParticles[writeIndex++] = particle;
    }
    currentParticles.length = writeIndex;

    visibleFurnacesMap.forEach((furnace) => {
      if (!furnace.isBurning || furnace.isDestroyed) return;

      const isLargeFurnace = furnace.furnaceType === FURNACE_TYPE_LARGE;
      const isCompound = isCompoundMonument(furnace.isMonument, furnace.posX, furnace.posY);
      const furnaceHeight = isLargeFurnace
        ? (isCompound ? MONUMENT_LARGE_FURNACE_HEIGHT : LARGE_FURNACE_HEIGHT)
        : FURNACE_HEIGHT;
      const yOffset = isLargeFurnace
        ? (isCompound ? MONUMENT_LARGE_FURNACE_RENDER_Y_OFFSET : LARGE_FURNACE_RENDER_Y_OFFSET)
        : FURNACE_RENDER_Y_OFFSET;
      const centerX = isLargeFurnace
        ? (isCompound ? furnace.posX - 60 : furnace.posX - 30)
        : furnace.posX - 8;
      const centerY = isLargeFurnace
        ? furnace.posY - (furnaceHeight / 2) - yOffset - 60
        : furnace.posY - (furnaceHeight / 2) - yOffset - 12;

      if (Math.random() < 0.08) {
        const life = 600 + Math.random() * 400;
        currentParticles.push({
          x: centerX + (Math.random() - 0.5) * (isLargeFurnace ? 10 : 6),
          y: centerY + furnaceHeight * (isLargeFurnace ? 0.45 : 0.55),
          vx: (Math.random() - 0.5) * 0.3,
          vy: -Math.random() * 0.8 - 0.3,
          life,
          maxLife: life,
          size: 2 + Math.random() * 2,
          color: ['#cc4400', '#aa3300', '#dd5500'][Math.floor(Math.random() * 3)],
          alpha: 0.8,
          type: 'forge_fire',
        });
      }

      if (Math.random() < 0.05) {
        const life = 300 + Math.random() * 400;
        currentParticles.push({
          x: centerX + (Math.random() - 0.5) * (isLargeFurnace ? 12 : 8),
          y: centerY + furnaceHeight * (isLargeFurnace ? 0.35 : 0.40),
          vx: (Math.random() - 0.5) * 1.5,
          vy: -Math.random() * 1.0 - 0.2,
          life,
          maxLife: life,
          size: 1 + Math.random() * 3,
          color: ['#ffaa00', '#ff8800', '#ffcc22', '#ff9900'][Math.floor(Math.random() * 4)],
          alpha: 1,
          type: 'metal_spark',
        });
      }

      if (!isLargeFurnace && Math.random() < 0.25) {
        const life = 2500 + Math.random() * 2000;
        currentParticles.push({
          x: centerX + 10 + (Math.random() - 0.5) * 6,
          y: centerY + 25,
          vx: (Math.random() - 0.5) * 0.05,
          vy: -Math.random() * 0.1 - 0.02,
          life,
          maxLife: life,
          size: 2 + Math.random() * 4,
          color: ['#888888', '#999999', '#777777', '#aaaaaa'][Math.floor(Math.random() * 4)],
          alpha: 0.3,
          type: 'industrial_smoke',
        });
      }
    });
  }

  private updateBarbecueParticles(visibleBarbecuesMap: Map<string, Barbecue>): void {
    const now = performance.now();
    const deltaTime = getClampedRafDeltaMs(now, this.barbecueLastUpdateTime);
    if (deltaTime <= 0) return;

    const currentParticles = this.barbecueParticles;
    let writeIndex = 0;
    const dt = deltaTime / 16.67;

    for (let i = 0; i < currentParticles.length; i++) {
      const particle = currentParticles[i]!;
      const newLife = particle.life - deltaTime;
      if (newLife <= 0) continue;

      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.life = newLife;
      particle.alpha = Math.max(0, newLife / particle.maxLife);
      particle.vy = particle.type === 'ember' ? particle.vy + 0.05 : particle.vy - 0.015;
      currentParticles[writeIndex++] = particle;
    }
    currentParticles.length = writeIndex;

    visibleBarbecuesMap.forEach((barbecue) => {
      if (!barbecue.isBurning || barbecue.isDestroyed) return;
      const centerX = barbecue.posX;
      const centerY = barbecue.posY;

      if (Math.random() < 0.12) {
        const life = 500 + Math.random() * 400;
        currentParticles.push({
          x: centerX + (Math.random() - 0.5) * 24,
          y: centerY + BARBECUE_HEIGHT * 0.25,
          vx: (Math.random() - 0.5) * 0.4,
          vy: -Math.random() * 0.9 - 0.4,
          life,
          maxLife: life,
          size: 2 + Math.random() * 3,
          color: ['#ff6600', '#ff4400', '#ff8800', '#dd5500'][Math.floor(Math.random() * 4)],
          alpha: 0.85,
          type: 'grill_fire',
        });
      }

      if (Math.random() < 0.06) {
        const life = 400 + Math.random() * 500;
        currentParticles.push({
          x: centerX + (Math.random() - 0.5) * 20,
          y: centerY + BARBECUE_HEIGHT * 0.20,
          vx: (Math.random() - 0.5) * 1.2,
          vy: -Math.random() * 1.5 - 0.5,
          life,
          maxLife: life,
          size: 1 + Math.random() * 2,
          color: ['#ffaa00', '#ff9900', '#ffcc33', '#ff8800'][Math.floor(Math.random() * 4)],
          alpha: 1,
          type: 'ember',
        });
      }

      if (Math.random() < 0.18) {
        const life = 2000 + Math.random() * 1500;
        currentParticles.push({
          x: centerX + (Math.random() - 0.5) * 16,
          y: centerY - 10,
          vx: (Math.random() - 0.5) * 0.08,
          vy: -Math.random() * 0.15 - 0.03,
          life,
          maxLife: life,
          size: 3 + Math.random() * 5,
          color: ['#666666', '#777777', '#555555', '#888888'][Math.floor(Math.random() * 4)],
          alpha: 0.35,
          type: 'grill_smoke',
        });
      }
    });
  }

  private updateFirePatchParticles(visibleFirePatchesMap: Map<string, FirePatch>, localPlayer: Player | null): void {
    const now = performance.now();
    const deltaTime = getClampedRafDeltaMs(now, this.firePatchLastUpdateTime);
    if (deltaTime <= 0) return;

    const currentParticles = this.firePatchParticles;
    let liveParticleCount = 0;
    const deltaTimeFactor = deltaTime / 16.667;

    for (let i = 0; i < currentParticles.length; i++) {
      const p = currentParticles[i]!;
      const age = now - p.spawnTime;
      const lifetimeRemaining = p.initialLifetime - age;
      if (lifetimeRemaining <= 0) continue;

      let newVy = p.vy;
      let newSize = p.size;
      let currentAlpha = p.alpha;
      if (p.type === 'smoke') {
        newVy -= 0.003 * deltaTimeFactor;
        newSize = Math.min(p.size + FIRE_PATCH_SMOKE_GROWTH_RATE * deltaTimeFactor, FIRE_PATCH_SMOKE_SIZE_MAX);
        const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
        currentAlpha = SMOKE_TARGET_ALPHA + (FIRE_PATCH_SMOKE_INITIAL_ALPHA - SMOKE_TARGET_ALPHA) * lifeRatio;
      } else if (p.type === 'fire') {
        currentAlpha = Math.max(0, lifetimeRemaining / p.initialLifetime);
      } else if (p.type === 'smoke_burst') {
        newVy -= 0.0015 * deltaTimeFactor;
        const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
        currentAlpha = SMOKE_TARGET_ALPHA + ((SMOKE_INITIAL_ALPHA + 0.4) - SMOKE_TARGET_ALPHA) * lifeRatio;
      }

      p.x += p.vx * deltaTimeFactor;
      p.y += newVy * deltaTimeFactor;
      p.vy = newVy;
      p.lifetime = lifetimeRemaining;
      p.size = newSize;
      p.alpha = Math.max(0, Math.min(1, currentAlpha));
      if (p.alpha > 0.01) currentParticles[liveParticleCount++] = p;
    }
    currentParticles.length = liveParticleCount;

    const currentVisibleFirePatchIds = new Set<string>();
    const playerX = localPlayer?.positionX ?? 0;
    const playerY = localPlayer?.positionY ?? 0;
    const playerInFireDistanceSq = 30 * 30;

    visibleFirePatchesMap.forEach((firePatch, firePatchId) => {
      currentVisibleFirePatchIds.add(firePatchId);
      const visualCenterX = firePatch.posX;
      const visualCenterY = firePatch.posY;
      const dx = playerX - firePatch.posX;
      const dy = playerY - firePatch.posY;
      const isPlayerOnFire = localPlayer && !localPlayer.isDead && (dx * dx + dy * dy) < playerInFireDistanceSq;

      FIRE_PATCH_EMISSION_ZONES.forEach((zone) => {
        let fireAcc = this.firePatchFireAcc.get(`${firePatchId}_${zone.name}`) || 0;
        fireAcc += zone.emissionRate * deltaTimeFactor;
        while (fireAcc >= 1) {
          fireAcc -= 1;
          const lifetime = FIRE_PATCH_FIRE_LIFETIME_MIN + Math.random() * (FIRE_PATCH_FIRE_LIFETIME_MAX - FIRE_PATCH_FIRE_LIFETIME_MIN);
          currentParticles.push({
            id: `fire_${zone.name}_${now}_${Math.random()}`,
            type: 'fire',
            x: visualCenterX + (Math.random() - 0.5) * zone.spread.x,
            y: visualCenterY + zone.yOffset + (Math.random() - 0.5) * zone.spread.y,
            vx: (Math.random() - 0.5) * FIRE_PATCH_FIRE_SPEED_X_SPREAD,
            vy: (FIRE_PATCH_FIRE_SPEED_Y_MIN + Math.random() * (FIRE_PATCH_FIRE_SPEED_Y_MAX - FIRE_PATCH_FIRE_SPEED_Y_MIN)) * zone.speedMultiplier,
            spawnTime: now,
            initialLifetime: lifetime,
            lifetime,
            size: Math.floor(FIRE_PATCH_FIRE_SIZE_MIN + Math.random() * (FIRE_PATCH_FIRE_SIZE_MAX - FIRE_PATCH_FIRE_SIZE_MIN)) + 1,
            color: FIRE_PATCH_FIRE_COLORS[Math.floor(Math.random() * FIRE_PATCH_FIRE_COLORS.length)],
            alpha: 1.0,
          });
        }
        this.firePatchFireAcc.set(`${firePatchId}_${zone.name}`, fireAcc);
      });

      let smokeAcc = this.firePatchSmokeAcc.get(firePatchId) || 0;
      smokeAcc += 0.3 * deltaTimeFactor;
      while (smokeAcc >= 1) {
        smokeAcc -= 1;
        const lifetime = FIRE_PATCH_SMOKE_LIFETIME_MIN + Math.random() * (FIRE_PATCH_SMOKE_LIFETIME_MAX - FIRE_PATCH_SMOKE_LIFETIME_MIN);
        currentParticles.push({
          id: `smoke_${now}_${Math.random()}`,
          type: 'smoke',
          x: visualCenterX + (Math.random() - 0.5) * 8,
          y: visualCenterY + (Math.random() - 0.5) * 6,
          vx: (Math.random() - 0.5) * FIRE_PATCH_SMOKE_SPEED_X_SPREAD,
          vy: FIRE_PATCH_SMOKE_SPEED_Y_MIN + Math.random() * (FIRE_PATCH_SMOKE_SPEED_Y_MAX - FIRE_PATCH_SMOKE_SPEED_Y_MIN),
          spawnTime: now,
          initialLifetime: lifetime,
          lifetime,
          size: Math.floor(FIRE_PATCH_SMOKE_SIZE_MIN + Math.random() * (FIRE_PATCH_SMOKE_SIZE_MAX - FIRE_PATCH_SMOKE_SIZE_MIN)) + 1,
          color: FIRE_PATCH_SMOKE_COLORS[Math.floor(Math.random() * FIRE_PATCH_SMOKE_COLORS.length)],
          alpha: FIRE_PATCH_SMOKE_INITIAL_ALPHA,
        });
      }
      this.firePatchSmokeAcc.set(firePatchId, smokeAcc);

      if (isPlayerOnFire) {
        let burstAcc = this.firePatchSmokeBurstAcc.get(firePatchId) || 0;
        burstAcc += 4.0 * deltaTimeFactor;
        while (burstAcc >= 1) {
          burstAcc -= 1;
          const lifetime = SMOKE_BURST_LIFETIME_MIN + Math.random() * (SMOKE_BURST_LIFETIME_MAX - SMOKE_BURST_LIFETIME_MIN);
          currentParticles.push({
            id: `smokeburst_${firePatchId}_${now}_${Math.random()}`,
            type: 'smoke_burst',
            x: visualCenterX + (Math.random() - 0.5) * 20,
            y: visualCenterY + (Math.random() - 0.5) * 16,
            vx: (Math.random() - 0.5) * SMOKE_BURST_SPEED_X_SPREAD,
            vy: SMOKE_BURST_SPEED_Y_MIN + Math.random() * (SMOKE_BURST_SPEED_Y_MAX - SMOKE_BURST_SPEED_Y_MIN),
            spawnTime: now,
            initialLifetime: lifetime,
            lifetime,
            size: SMOKE_BURST_SIZE_MIN + Math.floor(Math.random() * (SMOKE_BURST_SIZE_MAX - SMOKE_BURST_SIZE_MIN + 1)),
            color: SMOKE_BURST_COLORS[Math.floor(Math.random() * SMOKE_BURST_COLORS.length)],
            alpha: SMOKE_BURST_INITIAL_ALPHA,
          });
        }
        this.firePatchSmokeBurstAcc.set(firePatchId, burstAcc);
      } else {
        this.firePatchSmokeBurstAcc.set(firePatchId, 0);
      }
    });

    this.firePatchFireAcc.forEach((_value, key) => {
      const firePatchId = key.split('_')[0];
      if (!currentVisibleFirePatchIds.has(firePatchId)) this.firePatchFireAcc.delete(key);
    });
    this.firePatchSmokeAcc.forEach((_value, firePatchId) => {
      if (!currentVisibleFirePatchIds.has(firePatchId)) this.firePatchSmokeAcc.delete(firePatchId);
    });
    this.firePatchSmokeBurstAcc.forEach((_value, firePatchId) => {
      if (!currentVisibleFirePatchIds.has(firePatchId)) this.firePatchSmokeBurstAcc.delete(firePatchId);
    });
  }

  private updateWardParticles(visibleLanternsMap: Map<string, Lantern>): void {
    const now = performance.now();
    const deltaTime = getClampedRafDeltaMs(now, this.wardLastUpdateTime);
    if (deltaTime <= 0) return;

    const currentParticles = this.wardParticles;
    let liveParticleCount = 0;
    const deltaTimeFactor = deltaTime / 16.667;

    for (let i = 0; i < currentParticles.length; i++) {
      const p = currentParticles[i]!;
      const age = now - p.spawnTime;
      const lifetimeRemaining = p.initialLifetime - age;
      if (lifetimeRemaining <= 0) continue;

      let newVx = p.vx;
      let newVy = p.vy;
      let newSize = p.size;
      let currentAlpha = p.alpha;

      if (p.id.startsWith('tallowcore_')) {
        newVy -= 0.001 * deltaTimeFactor;
        const driftPhase = now * TALLOW_SMOKE_X_DRIFT_SPEED + parseFloat(p.id.slice(-6)) * 0.3;
        newVx = Math.sin(driftPhase) * 0.05;
        newSize = Math.min(p.size + TALLOW_SMOKE_GROWTH_RATE * deltaTimeFactor, TALLOW_SMOKE_CORE_SIZE_MAX * 2.5);
        currentAlpha = TALLOW_SMOKE_CORE_INITIAL_ALPHA * Math.max(0, lifetimeRemaining / p.initialLifetime);
      } else if (p.id.startsWith('tallowfirecore_') || p.id.startsWith('tallowfiremid_') || p.id.startsWith('disruptorfirecore_') || p.id.startsWith('disruptorfiremid_')) {
        currentAlpha = Math.max(0, lifetimeRemaining / p.initialLifetime);
        newVy -= 0.002 * deltaTimeFactor;
        newVx += (Math.random() - 0.5) * 0.1 * deltaTimeFactor;
      } else if (p.id.startsWith('static_')) {
        newVx += (Math.random() - 0.5) * 0.3 * deltaTimeFactor;
        newVy += (Math.random() - 0.5) * 0.2 * deltaTimeFactor;
        currentAlpha = STATIC_INITIAL_ALPHA * Math.max(0, lifetimeRemaining / p.initialLifetime);
        if (Math.random() < 0.1) currentAlpha = Math.min(1.0, currentAlpha * (1.5 + Math.random()));
      } else if (p.id.startsWith('memory_')) {
        newVy -= 0.001 * deltaTimeFactor;
        const floatPhase = now * 0.002 + parseFloat(p.id.slice(-6)) * 0.5;
        newVx = Math.sin(floatPhase) * 0.05;
        const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
        const pulse = 0.7 + Math.sin(now * MEMORY_PULSE_SPEED + parseFloat(p.id.slice(-6))) * 0.3;
        currentAlpha = MEMORY_INITIAL_ALPHA * lifeRatio * pulse;
        newSize = p.size * (0.9 + Math.sin(now * MEMORY_PULSE_SPEED * 2) * 0.1);
      }

      p.x += newVx * deltaTimeFactor;
      p.y += newVy * deltaTimeFactor;
      p.vx = newVx;
      p.vy = newVy;
      p.lifetime = lifetimeRemaining;
      p.size = newSize;
      p.alpha = Math.max(0, Math.min(1, currentAlpha));
      if (p.alpha > 0.01) currentParticles[liveParticleCount++] = p;
    }
    currentParticles.length = liveParticleCount;

    const currentWardIds = new Set<string>();
    visibleLanternsMap.forEach((lantern, lanternId) => {
      if (lantern.lanternType === 0 || !lantern.isBurning || lantern.isDestroyed) return;
      currentWardIds.add(lanternId);

      const { height: wardHeight } = getLanternDimensions(lantern.lanternType);
      const visualCenterX = lantern.posX;
      const visualCenterY = lantern.posY - (wardHeight / 2) - LANTERN_RENDER_Y_OFFSET;
      const emissionX = visualCenterX;
      const emissionY = visualCenterY - (wardHeight * WARD_EMISSION_Y_OFFSET_FACTOR);

      if (lantern.lanternType === LANTERN_TYPE_ANCESTRAL_WARD) {
        this.emitAncestralWardParticles(currentParticles, lanternId, now, deltaTimeFactor, visualCenterY, emissionX, lantern.posY, wardHeight);
      }
      if (lantern.lanternType === LANTERN_TYPE_SIGNAL_DISRUPTOR) {
        this.emitSignalDisruptorParticles(currentParticles, lanternId, now, deltaTimeFactor, emissionX, emissionY, lantern);
      }
      if (lantern.lanternType === LANTERN_TYPE_MEMORY_BEACON) {
        this.emitMemoryBeaconParticles(currentParticles, lanternId, now, deltaTimeFactor, emissionX, emissionY);
      }
    });

    this.wardEmissionAcc.forEach((_value, key) => {
      const lanternId = key.split('_')[0];
      if (!currentWardIds.has(lanternId)) this.wardEmissionAcc.delete(key);
    });
  }

  private emitAncestralWardParticles(
    currentParticles: Particle[],
    lanternId: string,
    now: number,
    deltaTimeFactor: number,
    visualCenterY: number,
    emissionX: number,
    lanternPosY: number,
    wardHeight: number,
  ): void {
    const smokeEmissionY = visualCenterY - (wardHeight * ANCESTRAL_WARD_SMOKE_Y_OFFSET_FACTOR) + ANCESTRAL_WARD_SMOKE_Y_DROP_OFFSET;
    const smokeEmissionX = emissionX + ANCESTRAL_WARD_SMOKE_X_OFFSET;
    const fireEmissionX = emissionX + TALLOW_FIRE_X_OFFSET;
    const fireEmissionY = lanternPosY + TALLOW_FIRE_BASE_Y_OFFSET + TALLOW_FIRE_Y_OFFSET_UP;

    let coreAcc = this.wardEmissionAcc.get(`${lanternId}_tallowcore`) || 0;
    coreAcc += TALLOW_SMOKE_CORE_EMISSION_RATE * deltaTimeFactor;
    while (coreAcc >= 1) {
      coreAcc -= 1;
      const lifetime = TALLOW_SMOKE_CORE_LIFETIME_MIN + Math.random() * (TALLOW_SMOKE_CORE_LIFETIME_MAX - TALLOW_SMOKE_CORE_LIFETIME_MIN);
      currentParticles.push({
        id: `tallowcore_${now}_${Math.random()}`,
        type: 'smoke',
        x: smokeEmissionX + (Math.random() - 0.5) * 6,
        y: smokeEmissionY,
        vx: (Math.random() - 0.5) * 0.1,
        vy: TALLOW_SMOKE_CORE_SPEED_Y_MIN + Math.random() * (TALLOW_SMOKE_CORE_SPEED_Y_MAX - TALLOW_SMOKE_CORE_SPEED_Y_MIN),
        spawnTime: now,
        initialLifetime: lifetime,
        lifetime,
        size: TALLOW_SMOKE_CORE_SIZE_MIN + Math.random() * (TALLOW_SMOKE_CORE_SIZE_MAX - TALLOW_SMOKE_CORE_SIZE_MIN),
        color: TALLOW_SMOKE_CORE_COLORS[Math.floor(Math.random() * TALLOW_SMOKE_CORE_COLORS.length)],
        alpha: TALLOW_SMOKE_CORE_INITIAL_ALPHA,
      });
    }
    this.wardEmissionAcc.set(`${lanternId}_tallowcore`, coreAcc);

    let fireCoreAcc = this.wardEmissionAcc.get(`${lanternId}_tallowfirecore`) || 0;
    fireCoreAcc += TALLOW_FIRE_CORE_EMISSION_RATE * deltaTimeFactor;
    while (fireCoreAcc >= 1) {
      fireCoreAcc -= 1;
      const lifetime = TALLOW_FIRE_CORE_LIFETIME_MIN + Math.random() * (TALLOW_FIRE_CORE_LIFETIME_MAX - TALLOW_FIRE_CORE_LIFETIME_MIN);
      currentParticles.push({
        id: `tallowfirecore_${now}_${Math.random()}`,
        type: 'fire',
        x: fireEmissionX + (Math.random() - 0.5) * 8,
        y: fireEmissionY,
        vx: (Math.random() - 0.5) * 0.2,
        vy: TALLOW_FIRE_CORE_SPEED_Y_MIN + Math.random() * (TALLOW_FIRE_CORE_SPEED_Y_MAX - TALLOW_FIRE_CORE_SPEED_Y_MIN),
        spawnTime: now,
        initialLifetime: lifetime,
        lifetime,
        size: TALLOW_FIRE_CORE_SIZE_MIN + Math.random() * (TALLOW_FIRE_CORE_SIZE_MAX - TALLOW_FIRE_CORE_SIZE_MIN),
        color: TALLOW_FIRE_CORE_COLORS[Math.floor(Math.random() * TALLOW_FIRE_CORE_COLORS.length)],
        alpha: 1.0,
      });
    }
    this.wardEmissionAcc.set(`${lanternId}_tallowfirecore`, fireCoreAcc);

    let fireMidAcc = this.wardEmissionAcc.get(`${lanternId}_tallowfiremid`) || 0;
    fireMidAcc += TALLOW_FIRE_MID_EMISSION_RATE * deltaTimeFactor;
    while (fireMidAcc >= 1) {
      fireMidAcc -= 1;
      const lifetime = TALLOW_FIRE_MID_LIFETIME_MIN + Math.random() * (TALLOW_FIRE_MID_LIFETIME_MAX - TALLOW_FIRE_MID_LIFETIME_MIN);
      currentParticles.push({
        id: `tallowfiremid_${now}_${Math.random()}`,
        type: 'fire',
        x: fireEmissionX + (Math.random() - 0.5) * 12,
        y: fireEmissionY,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -0.2 - Math.random() * 0.2,
        spawnTime: now,
        initialLifetime: lifetime,
        lifetime,
        size: 3 + Math.random() * 3,
        color: TALLOW_FIRE_MID_COLORS[Math.floor(Math.random() * TALLOW_FIRE_MID_COLORS.length)],
        alpha: 1.0,
      });
    }
    this.wardEmissionAcc.set(`${lanternId}_tallowfiremid`, fireMidAcc);
  }

  private emitSignalDisruptorParticles(
    currentParticles: Particle[],
    lanternId: string,
    now: number,
    deltaTimeFactor: number,
    emissionX: number,
    emissionY: number,
    lantern: Lantern,
  ): void {
    let acc = this.wardEmissionAcc.get(`${lanternId}_static`) || 0;
    acc += STATIC_EMISSION_RATE * deltaTimeFactor;
    while (acc >= 1) {
      acc -= 1;
      const lifetime = STATIC_LIFETIME_MIN + Math.random() * (STATIC_LIFETIME_MAX - STATIC_LIFETIME_MIN);
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 0.8;
      currentParticles.push({
        id: `static_${now}_${Math.random()}`,
        type: 'spark',
        x: emissionX + (Math.random() - 0.5) * 16,
        y: emissionY + (Math.random() - 0.5) * 16,
        vx: Math.cos(angle) * speed + (Math.random() - 0.5) * STATIC_SPEED_X_SPREAD,
        vy: Math.sin(angle) * speed + STATIC_SPEED_Y_MIN + Math.random() * (STATIC_SPEED_Y_MAX - STATIC_SPEED_Y_MIN),
        spawnTime: now,
        initialLifetime: lifetime,
        lifetime,
        size: STATIC_SIZE_MIN + Math.floor(Math.random() * (STATIC_SIZE_MAX - STATIC_SIZE_MIN + 1)),
        color: STATIC_COLORS[Math.floor(Math.random() * STATIC_COLORS.length)],
        alpha: STATIC_INITIAL_ALPHA,
      });
    }
    this.wardEmissionAcc.set(`${lanternId}_static`, acc);

    if (Math.random() < 0.03 * deltaTimeFactor) {
      const burstCount = 3 + Math.floor(Math.random() * 5);
      for (let i = 0; i < burstCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.0 + Math.random() * 1.5;
        const lifetime = STATIC_LIFETIME_MIN + Math.random() * (STATIC_LIFETIME_MAX - STATIC_LIFETIME_MIN);
        currentParticles.push({
          id: `staticburst_${now}_${i}_${Math.random()}`,
          type: 'spark',
          x: emissionX + (Math.random() - 0.5) * 8,
          y: emissionY + (Math.random() - 0.5) * 8,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          spawnTime: now,
          initialLifetime: lifetime,
          lifetime,
          size: 2,
          color: '#FFFFFF',
          alpha: 1.0,
        });
      }
    }

    const furnaceEmissionX = lantern.posX + DISRUPTOR_FURNACE_X_OFFSET;
    const furnaceEmissionY = lantern.posY + DISRUPTOR_FURNACE_Y_OFFSET;

    let fireCoreAcc = this.wardEmissionAcc.get(`${lanternId}_disruptorfirecore`) || 0;
    fireCoreAcc += DISRUPTOR_FIRE_CORE_EMISSION_RATE * deltaTimeFactor;
    while (fireCoreAcc >= 1) {
      fireCoreAcc -= 1;
      const lifetime = DISRUPTOR_FIRE_CORE_LIFETIME_MIN + Math.random() * (DISRUPTOR_FIRE_CORE_LIFETIME_MAX - DISRUPTOR_FIRE_CORE_LIFETIME_MIN);
      currentParticles.push({
        id: `disruptorfirecore_${now}_${Math.random()}`,
        type: 'fire',
        x: furnaceEmissionX + (Math.random() - 0.5) * DISRUPTOR_FURNACE_X_SPREAD,
        y: furnaceEmissionY,
        vx: (Math.random() - 0.5) * 0.25,
        vy: -0.25 - Math.random() * 0.25,
        spawnTime: now,
        initialLifetime: lifetime,
        lifetime,
        size: DISRUPTOR_FIRE_CORE_SIZE_MIN + Math.random() * (DISRUPTOR_FIRE_CORE_SIZE_MAX - DISRUPTOR_FIRE_CORE_SIZE_MIN),
        color: DISRUPTOR_FIRE_CORE_COLORS[Math.floor(Math.random() * DISRUPTOR_FIRE_CORE_COLORS.length)],
        alpha: 1.0,
      });
    }
    this.wardEmissionAcc.set(`${lanternId}_disruptorfirecore`, fireCoreAcc);

    let fireMidAcc = this.wardEmissionAcc.get(`${lanternId}_disruptorfiremid`) || 0;
    fireMidAcc += DISRUPTOR_FIRE_MID_EMISSION_RATE * deltaTimeFactor;
    while (fireMidAcc >= 1) {
      fireMidAcc -= 1;
      const lifetime = DISRUPTOR_FIRE_MID_LIFETIME_MIN + Math.random() * (DISRUPTOR_FIRE_MID_LIFETIME_MAX - DISRUPTOR_FIRE_MID_LIFETIME_MIN);
      currentParticles.push({
        id: `disruptorfiremid_${now}_${Math.random()}`,
        type: 'fire',
        x: furnaceEmissionX + (Math.random() - 0.5) * (DISRUPTOR_FURNACE_X_SPREAD + 4),
        y: furnaceEmissionY + 2,
        vx: (Math.random() - 0.5) * 0.2,
        vy: -0.18 - Math.random() * 0.15,
        spawnTime: now,
        initialLifetime: lifetime,
        lifetime,
        size: 3 + Math.random() * 3,
        color: DISRUPTOR_FIRE_MID_COLORS[Math.floor(Math.random() * DISRUPTOR_FIRE_MID_COLORS.length)],
        alpha: 1.0,
      });
    }
    this.wardEmissionAcc.set(`${lanternId}_disruptorfiremid`, fireMidAcc);
  }

  private emitMemoryBeaconParticles(
    currentParticles: Particle[],
    lanternId: string,
    now: number,
    deltaTimeFactor: number,
    emissionX: number,
    emissionY: number,
  ): void {
    let acc = this.wardEmissionAcc.get(`${lanternId}_memory`) || 0;
    acc += MEMORY_EMISSION_RATE * deltaTimeFactor;
    while (acc >= 1) {
      acc -= 1;
      const lifetime = MEMORY_LIFETIME_MIN + Math.random() * (MEMORY_LIFETIME_MAX - MEMORY_LIFETIME_MIN);
      const spawnRadius = 20 + Math.random() * 15;
      const spawnAngle = Math.random() * Math.PI * 2;
      currentParticles.push({
        id: `memory_${now}_${Math.random()}`,
        type: 'smoke',
        x: emissionX + Math.cos(spawnAngle) * spawnRadius * (0.3 + Math.random() * 0.7),
        y: emissionY + Math.sin(spawnAngle) * spawnRadius * 0.4 + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * MEMORY_SPEED_X_SPREAD,
        vy: MEMORY_SPEED_Y_MIN + Math.random() * (MEMORY_SPEED_Y_MAX - MEMORY_SPEED_Y_MIN),
        spawnTime: now,
        initialLifetime: lifetime,
        lifetime,
        size: MEMORY_SIZE_MIN + Math.floor(Math.random() * (MEMORY_SIZE_MAX - MEMORY_SIZE_MIN + 1)),
        color: MEMORY_COLORS[Math.floor(Math.random() * MEMORY_COLORS.length)],
        alpha: MEMORY_INITIAL_ALPHA,
      });
    }
    this.wardEmissionAcc.set(`${lanternId}_memory`, acc);

    if (Math.random() < 0.02 * deltaTimeFactor) {
      const lifetime = MEMORY_LIFETIME_MAX + Math.random() * 500;
      currentParticles.push({
        id: `memoryfrag_${now}_${Math.random()}`,
        type: 'smoke',
        x: emissionX + (Math.random() - 0.5) * 30,
        y: emissionY + (Math.random() - 0.5) * 15,
        vx: (Math.random() - 0.5) * 0.1,
        vy: -0.02 - Math.random() * 0.03,
        spawnTime: now,
        initialLifetime: lifetime,
        lifetime,
        size: MEMORY_SIZE_MAX + 2,
        color: '#BB99FF',
        alpha: 0.9,
      });
    }
  }

  private updateResourceSparkleParticles(
    harvestableResources: Map<string, HarvestableResource>,
    cycleProgress: number,
  ): void {
    const now = performance.now();
    const deltaTime = getClampedRafDeltaMs(now, this.resourceSparkleLastUpdateTime);
    if (deltaTime <= 0) return;

    const currentParticles = this.resourceSparkleParticles;
    let liveParticleCount = 0;
    const deltaTimeFactor = deltaTime / 16.667;

    for (let i = 0; i < currentParticles.length; i++) {
      const p = currentParticles[i]!;
      const age = now - p.spawnTime;
      const lifetimeRemaining = p.initialLifetime - age;
      if (lifetimeRemaining <= 0) continue;

      const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
      const shimmer = 0.8 + 0.2 * Math.sin((now - p.spawnTime) * 0.01);
      const ageRatio = (p.initialLifetime - lifetimeRemaining) / p.initialLifetime;
      const decelerationFactor = 1.0 - (ageRatio * 0.3);
      p.x += p.vx * deltaTimeFactor * decelerationFactor;
      p.y += p.vy * deltaTimeFactor * decelerationFactor;
      p.lifetime = lifetimeRemaining;
      p.alpha = Math.max(0, Math.min(1, lifeRatio * shimmer));
      if (p.alpha > 0.01) currentParticles[liveParticleCount++] = p;
    }
    currentParticles.length = liveParticleCount;

    harvestableResources.forEach((resource, resourceId) => {
      if (resource.respawnAt && resource.respawnAt.microsSinceUnixEpoch !== 0n) {
        this.resourceSparkleEmissionAcc.set(`harvestable_${resourceId}`, 0);
        return;
      }

      try {
        const resourceType = getResourceType(resource);
        const config = getResourceConfig(resourceType);
        let acc = this.resourceSparkleEmissionAcc.get(`harvestable_${resourceId}`) || 0;
        acc += SPARKLES_PER_RESOURCE_FRAME * deltaTimeFactor;
        const colorPalette = isNightTime(cycleProgress) ? NIGHT_SPARKLE_COLORS : DAY_SPARKLE_COLORS;

        while (acc >= 1) {
          acc -= 1;
          const lifetime = SPARKLE_PARTICLE_LIFETIME_MIN + Math.random() * (SPARKLE_PARTICLE_LIFETIME_MAX - SPARKLE_PARTICLE_LIFETIME_MIN);
          const resourceHeight = config.targetWidth;
          const sparkleStartX = resource.posX + (Math.random() - 0.5) * (resourceHeight * 0.6);
          const sparkleStartY = resource.posY - (resourceHeight / 2 * 0.3) + (Math.random() - 0.5) * 8;
          currentParticles.push({
            id: `sparkle_harvestable_${resourceId}_${now}_${Math.random()}`,
            type: 'fire',
            x: sparkleStartX,
            y: sparkleStartY,
            vx: (Math.random() - 0.5) * SPARKLE_PARTICLE_SPEED_X_SPREAD,
            vy: SPARKLE_PARTICLE_SPEED_Y_MIN + Math.random() * (SPARKLE_PARTICLE_SPEED_Y_MAX - SPARKLE_PARTICLE_SPEED_Y_MIN),
            spawnTime: now,
            initialLifetime: lifetime,
            lifetime,
            size: Math.floor(SPARKLE_PARTICLE_SIZE_MIN + Math.random() * (SPARKLE_PARTICLE_SIZE_MAX - SPARKLE_PARTICLE_SIZE_MIN)) + 1,
            color: colorPalette[Math.floor(Math.random() * colorPalette.length)],
            alpha: 1.0,
          });
        }
        this.resourceSparkleEmissionAcc.set(`harvestable_${resourceId}`, acc);
      } catch {
        return;
      }
    });
  }

  private updateHostileDeathParticles(hostileDeathEvents: HostileDeathEvent[]): void {
    const now = performance.now();
    const deltaTime = getClampedRafDeltaMs(now, this.hostileDeathLastUpdateTime);
    if (deltaTime <= 0) return;

    const currentParticles = this.hostileDeathParticles;
    let liveParticleCount = 0;
    const deltaTimeFactor = deltaTime / 16.667;

    for (let i = 0; i < currentParticles.length; i++) {
      const p = currentParticles[i]!;
      const age = now - p.spawnTime;
      const lifetimeRemaining = p.initialLifetime - age;
      if (lifetimeRemaining <= 0) continue;

      const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
      const sparkle = 0.7 + 0.3 * Math.sin((now - p.spawnTime) * 0.02);
      const ageRatio = age / p.initialLifetime;
      const decelerationFactor = 1.0 - (ageRatio * 0.5);
      p.x += p.vx * deltaTimeFactor * decelerationFactor;
      p.y += p.vy * deltaTimeFactor * decelerationFactor;
      p.vy += 0.02 * deltaTimeFactor;
      p.lifetime = lifetimeRemaining;
      p.alpha = Math.max(0, Math.min(1, lifeRatio * sparkle));
      p.size = Math.max(1, p.size * (1.0 - ageRatio * 0.3));
      if (p.alpha > 0.01) currentParticles[liveParticleCount++] = p;
    }
    currentParticles.length = liveParticleCount;

    let particleCount = currentParticles.length;
    if (particleCount < HOSTILE_DEATH_MAX_PARTICLES) {
      for (const event of hostileDeathEvents) {
        if (this.processedHostileDeathEvents.has(event.id)) continue;
        const newParticles = this.generateDeathParticles(event);
        const spaceLeft = HOSTILE_DEATH_MAX_PARTICLES - particleCount;
        const toAdd = newParticles.length <= spaceLeft ? newParticles : newParticles.slice(0, spaceLeft);
        currentParticles.push(...toAdd);
        particleCount += toAdd.length;
        this.processedHostileDeathEvents.add(event.id);
        if (particleCount >= HOSTILE_DEATH_MAX_PARTICLES) break;
      }
    }

    if (this.processedHostileDeathEvents.size > PROCESSED_EVENTS_MAX) {
      const currentEventIds = new Set(hostileDeathEvents.map((event) => event.id));
      for (const id of Array.from(this.processedHostileDeathEvents)) {
        if (!currentEventIds.has(id)) this.processedHostileDeathEvents.delete(id);
      }
      if (this.processedHostileDeathEvents.size > PROCESSED_EVENTS_MAX) {
        const toKeep = Array.from(this.processedHostileDeathEvents).slice(-PROCESSED_EVENTS_MAX);
        this.processedHostileDeathEvents.clear();
        toKeep.forEach((id) => this.processedHostileDeathEvents.add(id));
      }
    }
  }

  private generateDeathParticles(event: HostileDeathEvent): Particle[] {
    const now = performance.now();
    const newParticles: Particle[] = [];
    const speciesName = event.species;
    const particleCount = SPECIES_PARTICLE_COUNT[speciesName] || 40;
    const speciesColors = SPECIES_COLORS[speciesName] || DEATH_PARTICLE_COLORS_BASE;

    for (let i = 0; i < WHITE_FLASH_PARTICLE_COUNT; i++) {
      const angle = (Math.PI * 2 * i) / WHITE_FLASH_PARTICLE_COUNT + (Math.random() - 0.5) * 0.6;
      const speed = 0.6 + Math.random() * 1.4;
      newParticles.push({
        id: `death-flash-${event.id}-${i}-${now}`,
        type: 'spark',
        x: event.x + (Math.random() - 0.5) * 10,
        y: event.y + (Math.random() - 0.5) * 10,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spawnTime: now,
        initialLifetime: WHITE_FLASH_LIFETIME_MS,
        lifetime: WHITE_FLASH_LIFETIME_MS,
        size: 3 + Math.random() * 3,
        color: '#FFFFFF',
        alpha: 1.0,
      });
    }

    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
      const speed = 1.0 + Math.random() * 2.0;
      const isDirectional = Math.random() > 0.3;
      const vx = isDirectional
        ? Math.cos(angle) * speed * DEATH_PARTICLE_SPEED_X_SPREAD
        : (Math.random() - 0.5) * DEATH_PARTICLE_SPEED_X_SPREAD * 2;
      const vy = isDirectional
        ? Math.sin(angle) * speed + DEATH_PARTICLE_SPEED_Y_MIN
        : DEATH_PARTICLE_SPEED_Y_MIN + Math.random() * (DEATH_PARTICLE_SPEED_Y_MAX - DEATH_PARTICLE_SPEED_Y_MIN);
      const colorRoll = Math.random();
      const color = colorRoll < 0.6
        ? speciesColors[Math.floor(Math.random() * speciesColors.length)]
        : colorRoll < 0.85
          ? DEATH_PARTICLE_COLORS_BRIGHT[Math.floor(Math.random() * DEATH_PARTICLE_COLORS_BRIGHT.length)]
          : DEATH_PARTICLE_COLORS_WHITE[Math.floor(Math.random() * DEATH_PARTICLE_COLORS_WHITE.length)];
      const lifetime = DEATH_PARTICLE_LIFETIME_MIN + Math.random() * (DEATH_PARTICLE_LIFETIME_MAX - DEATH_PARTICLE_LIFETIME_MIN);
      newParticles.push({
        id: `death-${event.id}-${i}-${now}`,
        type: 'spark',
        x: event.x + (Math.random() - 0.5) * 20,
        y: event.y + (Math.random() - 0.5) * 20,
        vx,
        vy,
        spawnTime: now,
        initialLifetime: lifetime,
        lifetime,
        size: DEATH_PARTICLE_SIZE_MIN + Math.random() * (DEATH_PARTICLE_SIZE_MAX - DEATH_PARTICLE_SIZE_MIN),
        color,
        alpha: 1.0,
      });
    }

    const coreCount = Math.floor(particleCount * 0.3);
    for (let i = 0; i < coreCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 1.5;
      newParticles.push({
        id: `death-core-${event.id}-${i}-${now}`,
        type: 'spark',
        x: event.x + (Math.random() - 0.5) * 10,
        y: event.y + (Math.random() - 0.5) * 10,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.0,
        spawnTime: now,
        initialLifetime: DEATH_PARTICLE_LIFETIME_MIN * 1.5,
        lifetime: DEATH_PARTICLE_LIFETIME_MIN * 1.5,
        size: DEATH_PARTICLE_SIZE_MAX + 1 + Math.random() * 2,
        color: DEATH_PARTICLE_COLORS_WHITE[Math.floor(Math.random() * DEATH_PARTICLE_COLORS_WHITE.length)],
        alpha: 1.0,
      });
    }
    return newParticles;
  }

  private updateImpactParticles(
    wildAnimals: Map<string, WildAnimal>,
    animalCorpses: Map<string, AnimalCorpse>,
    localPlayer: Player | null,
  ): void {
    const now = performance.now();
    const deltaTime = getClampedRafDeltaMs(now, this.impactLastUpdateTime);
    if (deltaTime <= 0) return;

    const currentParticles = this.impactParticles;
    let liveParticleCount = 0;
    const deltaTimeFactor = deltaTime / 16.667;

    for (let i = 0; i < currentParticles.length; i++) {
      const p = currentParticles[i]!;
      const age = now - p.spawnTime;
      const lifetimeRemaining = p.initialLifetime - age;
      if (lifetimeRemaining <= 0) continue;

      const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
      if (p.id.startsWith('blood-')) {
        p.x += p.vx * deltaTimeFactor;
        p.y += p.vy * deltaTimeFactor;
        p.vy += BLOOD_PARTICLE_GRAVITY * deltaTimeFactor;
        p.alpha = lifeRatio;
        if (age / p.initialLifetime > 0.5) p.size = Math.max(1, p.size * 0.98);
      } else {
        const sparkle = 0.6 + 0.4 * Math.sin((now - p.spawnTime) * 0.015);
        p.x += p.vx * deltaTimeFactor * 0.95;
        p.y += p.vy * deltaTimeFactor * 0.95;
        p.vx *= 0.995;
        p.vy *= 0.995;
        p.alpha = lifeRatio * sparkle;
        if (age / p.initialLifetime < 0.3) {
          p.size = Math.min(ETHEREAL_PARTICLE_SIZE_MAX + 2, p.size * 1.01);
        } else {
          p.size = Math.max(1, p.size * 0.99);
        }
      }
      p.lifetime = lifetimeRemaining;
      if (p.alpha > 0.01) currentParticles[liveParticleCount++] = p;
    }
    currentParticles.length = liveParticleCount;

    wildAnimals.forEach((animal, id) => {
      const hitTimeMicros = animal.lastHitTime?.microsSinceUnixEpoch ?? 0n;
      const prevRecord = this.animalHitRecords.get(id);
      if (hitTimeMicros <= 0n || (prevRecord && hitTimeMicros <= prevRecord.lastHitTimeMicros)) return;

      const species = getSpeciesName(animal);
      const particleCount = Math.min(MAX_PARTICLES_PER_HIT, BASE_PARTICLE_COUNT + Math.floor(Math.random() * 10));
      currentParticles.push(
        ...(HOSTILE_SPECIES.includes(species)
          ? this.generateEtherealParticles(animal.posX, animal.posY, particleCount, species)
          : this.generateBloodParticles(animal.posX, animal.posY, particleCount)),
      );
      this.animalHitRecords.set(id, { entityId: id, lastHitTimeMicros: hitTimeMicros });
    });

    const nowUnixMs = Date.now();
    const currentAnimalIds = new Set(wildAnimals.keys());
    this.prevAnimals.forEach((cached, id) => {
      if (currentAnimalIds.has(id)) return;
      const hitMs = cached.lastHitTimeMicros > 0n ? Number(cached.lastHitTimeMicros / 1000n) : 0;
      if (hitMs <= 0 || nowUnixMs - hitMs > 500) return;

      if (HOSTILE_SPECIES.includes(cached.species)) {
        currentParticles.push(...this.generateWhiteFlashParticles(cached.posX, cached.posY, 12));
        currentParticles.push(...this.generateEtherealParticles(cached.posX, cached.posY, 12, cached.species));
      } else {
        currentParticles.push(...this.generateWhiteFlashParticles(cached.posX, cached.posY, 10));
        currentParticles.push(...this.generateBloodParticles(cached.posX, cached.posY, 14));
      }
    });

    if (!this.initializedCorpses) {
      this.seenCorpses.clear();
      animalCorpses.forEach((_corpse, id) => this.seenCorpses.add(id));
      this.initializedCorpses = true;
    } else {
      animalCorpses.forEach((corpse, id) => {
        if (this.seenCorpses.has(id)) return;
        const sourceAnimalId = corpse.animalId?.toString?.() ?? '';
        const cachedAnimal = sourceAnimalId ? this.prevAnimals.get(sourceAnimalId) : undefined;
        const flashX = cachedAnimal?.posX ?? corpse.posX;
        const flashY = cachedAnimal?.posY ?? corpse.posY;
        currentParticles.push(...this.generateWhiteFlashParticles(flashX, flashY, 18));
        currentParticles.push(...this.generateBloodParticles(flashX, flashY, 18));
        this.seenCorpses.add(id);
      });
      const currentCorpseIds = new Set(animalCorpses.keys());
      for (const id of Array.from(this.seenCorpses)) {
        if (!currentCorpseIds.has(id)) this.seenCorpses.delete(id);
      }
    }

    const nextPrevAnimals = new Map<string, CachedAnimalState>();
    wildAnimals.forEach((animal, id) => {
      nextPrevAnimals.set(id, {
        posX: animal.posX,
        posY: animal.posY,
        species: getSpeciesName(animal),
        lastHitTimeMicros: animal.lastHitTime?.microsSinceUnixEpoch ?? 0n,
      });
    });
    this.prevAnimals = nextPrevAnimals;

    this.cleanupMissingRecords(this.animalHitRecords, wildAnimals);

    animalCorpses.forEach((corpse, id) => {
      const hitTimeMicros = corpse.lastHitTime?.microsSinceUnixEpoch ?? 0n;
      const prevRecord = this.corpseHitRecords.get(id);
      if (hitTimeMicros <= 0n || (prevRecord && hitTimeMicros <= prevRecord.lastHitTimeMicros)) return;

      const particleCount = Math.min(MAX_PARTICLES_PER_HIT, BASE_PARTICLE_COUNT + Math.floor(Math.random() * 8));
      currentParticles.push(...this.generateBloodParticles(corpse.posX, corpse.posY, particleCount));
      this.corpseHitRecords.set(id, { entityId: id, lastHitTimeMicros: hitTimeMicros });
    });
    this.cleanupMissingRecords(this.corpseHitRecords, animalCorpses);

    if (localPlayer && !localPlayer.isDead) {
      const playerHitTimeMicros = localPlayer.lastHitTime?.microsSinceUnixEpoch ?? 0n;
      if (playerHitTimeMicros > 0n && playerHitTimeMicros > this.playerHitRecord) {
        currentParticles.push(...this.generateBloodParticles(localPlayer.positionX, localPlayer.positionY, Math.min(MAX_PARTICLES_PER_HIT, BASE_PARTICLE_COUNT + 5)));
        this.playerHitRecord = playerHitTimeMicros;
      }
    }
  }

  private generateBloodParticles(x: number, y: number, count: number): Particle[] {
    const now = performance.now();
    const newParticles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2;
      const speed = BLOOD_PARTICLE_SPEED * (0.5 + Math.random());
      const color = Math.random() < 0.7
        ? BLOOD_COLORS[Math.floor(Math.random() * BLOOD_COLORS.length)]
        : BLOOD_COLORS_BRIGHT[Math.floor(Math.random() * BLOOD_COLORS_BRIGHT.length)];
      const lifetime = BLOOD_PARTICLE_LIFETIME_MIN + Math.random() * (BLOOD_PARTICLE_LIFETIME_MAX - BLOOD_PARTICLE_LIFETIME_MIN);
      newParticles.push({
        id: `blood-${now}-${i}-${Math.random()}`,
        type: 'spark',
        x: x + (Math.random() - 0.5) * 15,
        y: y + (Math.random() - 0.5) * 15,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spawnTime: now,
        initialLifetime: lifetime,
        lifetime,
        size: BLOOD_PARTICLE_SIZE_MIN + Math.random() * (BLOOD_PARTICLE_SIZE_MAX - BLOOD_PARTICLE_SIZE_MIN),
        color,
        alpha: 1.0,
      });
    }
    return newParticles;
  }

  private generateEtherealParticles(x: number, y: number, count: number, species: string): Particle[] {
    const now = performance.now();
    const newParticles: Particle[] = [];
    const speciesColors = ETHEREAL_COLORS[species] || ETHEREAL_COLORS.Shardkin;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = ETHEREAL_PARTICLE_SPEED * (0.5 + Math.random());
      const color = Math.random() < 0.8
        ? speciesColors[Math.floor(Math.random() * speciesColors.length)]
        : ETHEREAL_COLORS_WHITE[Math.floor(Math.random() * ETHEREAL_COLORS_WHITE.length)];
      const lifetime = ETHEREAL_PARTICLE_LIFETIME_MIN + Math.random() * (ETHEREAL_PARTICLE_LIFETIME_MAX - ETHEREAL_PARTICLE_LIFETIME_MIN);
      newParticles.push({
        id: `ethereal-${now}-${i}-${Math.random()}`,
        type: 'spark',
        x: x + (Math.random() - 0.5) * 20,
        y: y + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.5,
        spawnTime: now,
        initialLifetime: lifetime,
        lifetime,
        size: ETHEREAL_PARTICLE_SIZE_MIN + Math.random() * (ETHEREAL_PARTICLE_SIZE_MAX - ETHEREAL_PARTICLE_SIZE_MIN),
        color,
        alpha: 0.9,
      });
    }
    return newParticles;
  }

  private generateWhiteFlashParticles(x: number, y: number, count: number): Particle[] {
    const now = performance.now();
    const newParticles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 0.5 + Math.random() * 1.2;
      const lifetime = 110 + Math.random() * 50;
      newParticles.push({
        id: `flash-${now}-${i}-${Math.random()}`,
        type: 'spark',
        x: x + (Math.random() - 0.5) * 12,
        y: y + (Math.random() - 0.5) * 12,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spawnTime: now,
        initialLifetime: lifetime,
        lifetime,
        size: 2.5 + Math.random() * 2.5,
        color: '#FFFFFF',
        alpha: 1.0,
      });
    }
    return newParticles;
  }

  private updateStructureImpactParticles(
    walls: Map<string, WallCell>,
    doors: Map<string, Door>,
    shelters: Map<string, Shelter>,
  ): void {
    const now = performance.now();
    const deltaTime = getClampedRafDeltaMs(now, this.structureImpactLastUpdateTime);
    if (deltaTime <= 0) return;

    const currentParticles = this.structureImpactParticles;
    let liveParticleCount = 0;
    const deltaTimeFactor = deltaTime / 16.667;

    for (let i = 0; i < currentParticles.length; i++) {
      const p = currentParticles[i]!;
      if (!p.id.startsWith('struct-spark-')) {
        currentParticles[liveParticleCount++] = p;
        continue;
      }
      const age = now - p.spawnTime;
      const lifetimeRemaining = p.initialLifetime - age;
      if (lifetimeRemaining <= 0) continue;

      const lifeRatio = Math.max(0, lifetimeRemaining / p.initialLifetime);
      p.x += p.vx * deltaTimeFactor;
      p.y += p.vy * deltaTimeFactor;
      p.vy += STRUCT_SPARK_PARTICLE_GRAVITY * deltaTimeFactor;
      p.alpha = lifeRatio;
      if (age / p.initialLifetime > 0.3) p.size = Math.max(0.5, p.size * 0.97);
      p.vx *= 0.98;
      p.lifetime = lifetimeRemaining;
      if (p.alpha > 0.01) currentParticles[liveParticleCount++] = p;
    }
    currentParticles.length = liveParticleCount;

    walls.forEach((wall, id) => {
      if (wall.isDestroyed) return;
      const hitTimeMicros = wall.lastHitTime?.microsSinceUnixEpoch ?? 0n;
      const prevRecord = this.wallHitRecords.get(id);
      if (hitTimeMicros <= 0n || (prevRecord && hitTimeMicros <= prevRecord.lastHitTimeMicros)) return;
      const worldX = (wall.cellX * FOUNDATION_TILE_SIZE) + (FOUNDATION_TILE_SIZE / 2);
      const worldY = (wall.cellY * FOUNDATION_TILE_SIZE) + (FOUNDATION_TILE_SIZE / 2);
      currentParticles.push(...this.generateSparkParticles(worldX, worldY, BASE_SPARK_COUNT + Math.floor(Math.random() * 8)));
      this.wallHitRecords.set(id, { structureId: id, lastHitTimeMicros: hitTimeMicros });
    });

    doors.forEach((door, id) => {
      if (door.isDestroyed) return;
      const hitTimeMicros = door.lastHitTime?.microsSinceUnixEpoch ?? 0n;
      const prevRecord = this.doorHitRecords.get(id);
      if (hitTimeMicros <= 0n || (prevRecord && hitTimeMicros <= prevRecord.lastHitTimeMicros)) return;
      const worldX = (door.cellX * FOUNDATION_TILE_SIZE) + (FOUNDATION_TILE_SIZE / 2);
      const worldY = (door.cellY * FOUNDATION_TILE_SIZE) + (FOUNDATION_TILE_SIZE / 2);
      currentParticles.push(...this.generateSparkParticles(worldX, worldY, BASE_SPARK_COUNT + Math.floor(Math.random() * 8)));
      this.doorHitRecords.set(id, { structureId: id, lastHitTimeMicros: hitTimeMicros });
    });

    shelters.forEach((shelter, id) => {
      if (shelter.isDestroyed) return;
      const hitTimeMicros = shelter.lastHitTime?.microsSinceUnixEpoch ?? 0n;
      const prevRecord = this.shelterHitRecords.get(id);
      if (hitTimeMicros <= 0n || (prevRecord && hitTimeMicros <= prevRecord.lastHitTimeMicros)) return;
      currentParticles.push(...this.generateSparkParticles(
        shelter.posX,
        shelter.posY - SHELTER_DIMS.AABB_CENTER_Y_OFFSET_FROM_POS_Y,
        BASE_SPARK_COUNT + Math.floor(Math.random() * 8),
      ));
      this.shelterHitRecords.set(id, { structureId: id, lastHitTimeMicros: hitTimeMicros });
    });

    this.cleanupMissingRecords(this.wallHitRecords, walls);
    this.cleanupMissingRecords(this.doorHitRecords, doors);
    this.cleanupMissingRecords(this.shelterHitRecords, shelters);
  }

  private generateSparkParticles(worldX: number, worldY: number, count: number): Particle[] {
    const now = performance.now();
    const newParticles: Particle[] = [];
    const cappedCount = Math.min(count, MAX_SPARKS_PER_HIT);
    for (let i = 0; i < cappedCount; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
      const speed = STRUCT_SPARK_PARTICLE_SPEED * (0.5 + Math.random() * 0.8);
      const color = Math.random() < 0.7
        ? STRUCT_SPARK_COLORS_HOT[Math.floor(Math.random() * STRUCT_SPARK_COLORS_HOT.length)]
        : STRUCT_SPARK_COLORS_COOL[Math.floor(Math.random() * STRUCT_SPARK_COLORS_COOL.length)];
      const lifetime = STRUCT_SPARK_PARTICLE_LIFETIME_MIN + Math.random() * (STRUCT_SPARK_PARTICLE_LIFETIME_MAX - STRUCT_SPARK_PARTICLE_LIFETIME_MIN);
      newParticles.push({
        id: `struct-spark-${now}-${i}-${Math.random()}`,
        type: 'spark',
        x: worldX + (Math.random() - 0.5) * 30,
        y: worldY + (Math.random() - 0.5) * 30,
        vx: Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1),
        vy: Math.sin(angle) * speed,
        spawnTime: now,
        initialLifetime: lifetime,
        lifetime,
        size: STRUCT_SPARK_PARTICLE_SIZE_MIN + Math.random() * (STRUCT_SPARK_PARTICLE_SIZE_MAX - STRUCT_SPARK_PARTICLE_SIZE_MIN),
        color,
        alpha: 1.0,
      });
    }
    return newParticles;
  }

  private cleanupMissingRecords<T extends { entityId?: string; structureId?: string }>(
    records: Map<string, T>,
    liveMap: Map<string, unknown>,
  ): void {
    if (records.size <= liveMap.size * 2) return;
    const currentIds = new Set(liveMap.keys());
    for (const id of Array.from(records.keys())) {
      if (!currentIds.has(id)) records.delete(id);
    }
  }

  private readonly computeCampfireFireOverlayEmitters = (nowMs: number): readonly CampfireFireGpuEmitter[] => {
    const out = this.campfireEmitterScratch;
    out.length = 0;
    const options = this.options;
    if (!options) return out;

    const dt = getCampfireGpuFireDt(nowMs);
    const visit = (idKey: string, anchorX: number, anchorY: number, isBurning: boolean, hotZone: boolean, scale: number) => {
      if (out.length >= MAX_EMITTERS) return;

      const wasBurning = this.campfirePrevBurning.get(idKey) ?? false;
      if (isBurning) {
        this.campfireLingerUntil.delete(idKey);
      } else if (wasBurning && !isBurning) {
        this.campfireLingerUntil.set(idKey, nowMs + CAMPFIRE_SMOKE_LINGER_MS);
      }
      this.campfirePrevBurning.set(idKey, isBurning);

      const fireAmt = idKey.startsWith('static_') && isBurning
        ? 1
        : stepCampfireGpuFire01(idKey, isBurning, dt);

      if (idKey.startsWith('static_') && isBurning) {
        syncCampfireGpuLight01(idKey, true, dt, 1);
      } else {
        syncCampfireGpuLight01(idKey, isBurning, dt, fireAmt);
      }

      let smokeAmt = 0;
      if (isBurning) {
        smokeAmt = fireAmt;
      } else {
        const until = this.campfireLingerUntil.get(idKey);
        if (until !== undefined && nowMs < until) {
          smokeAmt = (until - nowMs) / CAMPFIRE_SMOKE_LINGER_MS;
        } else if (until !== undefined) {
          this.campfireLingerUntil.delete(idKey);
          this.campfireLastPlumeReach01.delete(idKey);
        }
      }

      if (fireAmt <= 0 && smokeAmt <= 0 && !isBurning) {
        this.campfireLastPlumeReach01.delete(idKey);
        deleteCampfireGpuFire01(idKey);
        return;
      }

      const smokePlumeReach01 = isBurning
        ? getSmokePlumeReach01(idKey, nowMs)
        : this.campfireLastPlumeReach01.get(idKey) ?? 0;
      if (isBurning) this.campfireLastPlumeReach01.set(idKey, smokePlumeReach01);

      out.push({
        anchorX,
        anchorY,
        fireAmt,
        smokeAmt,
        hotBoost: isBurning && hotZone ? Math.min(1, fireAmt * 1.25) : 0,
        scale,
        smokePlumeReach01,
      });
    };

    const visibleCampfiresMap = options.sceneRuntime.visibleCampfiresMap;
    visibleCampfiresMap.forEach((campfire: Campfire, idKey: string) => {
      if (campfire.isDestroyed) {
        this.campfirePrevBurning.delete(idKey);
        this.campfireLingerUntil.delete(idKey);
        this.campfireLastPlumeReach01.delete(idKey);
        deleteCampfireGpuFire01(idKey);
        return;
      }
      const { x, y } = getPlacedCampfireFireAnchorWorld(campfire.posX, campfire.posY);
      visit(idKey, x, y, campfire.isBurning, campfire.isPlayerInHotZone ?? false, 1);
    });

    const staticIdKeys = new Set<string>();
    for (let i = 0; i < this.villageCampfirePositions.length; i++) {
      const s = this.villageCampfirePositions[i]!;
      const idKey = `static_${s.id}`;
      staticIdKeys.add(idKey);
      const { x, y } = getStaticMonumentCampfireFireAnchorWorld(s.posX, s.posY);
      visit(idKey, x, y, true, false, 2);
    }

    const dropStatic: string[] = [];
    const dropGone: string[] = [];
    this.campfirePrevBurning.forEach((_value, idKey) => {
      if (idKey.startsWith('static_')) {
        if (!staticIdKeys.has(idKey)) dropStatic.push(idKey);
      } else if (!visibleCampfiresMap.has(idKey)) {
        dropGone.push(idKey);
      }
    });

    for (const key of [...dropStatic, ...dropGone]) {
      this.campfirePrevBurning.delete(key);
      this.campfireLingerUntil.delete(key);
      this.campfireLastPlumeReach01.delete(key);
      deleteCampfireGpuFire01(key);
    }

    return out;
  };
}
