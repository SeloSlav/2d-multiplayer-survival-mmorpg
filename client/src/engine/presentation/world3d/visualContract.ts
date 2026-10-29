/** Presentation units are tiles. Authoritative positions and input remain in pixels. */
export const WORLD_3D = {
  tilePixels: 48,
  // Low oblique view, 30° above the ground, keeps the survivor's face visible.
  elevationRadians: 30 * Math.PI / 180,
  pixelScale: 2,
  shadowMapSize: 2048,
  seed: 73021,
  maxLocalLights: 8,
  cullMarginPixels: 240,
} as const;

export const GROUND_Y_SCALE = 1 / Math.sin(WORLD_3D.elevationRadians);

/** Compensated depth preserves the existing ground-plane mouse/collision mapping. */
export function worldToScene(x: number, y: number): { x: number; z: number } {
  return { x: x / WORLD_3D.tilePixels, z: y / WORLD_3D.tilePixels * GROUND_Y_SCALE };
}

export function sceneToWorld(x: number, z: number): { x: number; y: number } {
  return { x: x * WORLD_3D.tilePixels, y: z / GROUND_Y_SCALE * WORLD_3D.tilePixels };
}

export function seedFromId(id: string): number {
  let hash: number = WORLD_3D.seed;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export type VisualDebugMode = 'lit' | 'unlit' | 'wireframe' | 'fields';
export type PresentationStatus = { phase: 'initializing' | 'ready' | 'error'; message: string };

export const TERRAIN_PALETTE: Record<string, number> = {
  Grass: 0x78845b, Forest: 0x58694a, Dirt: 0x8c775e, DirtRoad: 0xa49374,
  Sea: 0x427c88, DeepSea: 0x294b65, Beach: 0xc4b48c, Sand: 0xd0bc8e,
  HotSpringWater: 0x71a7a0, Quarry: 0x85867d, Asphalt: 0x535b5c,
  Tundra: 0x8e9680, Alpine: 0xc7ceca, TundraGrass: 0x8a9071, Tilled: 0x65513f,
};

export const WATER_TERRAINS = new Set(['Sea', 'DeepSea', 'HotSpringWater']);
