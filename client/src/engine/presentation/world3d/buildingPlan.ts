import { worldConfig } from '../../../config/sharedGameConfig';

export type GroundPoint = readonly [number, number];
export const BUILDING = {
  cellPixels: worldConfig.foundationTileSizePx,
  cellSize: worldConfig.foundationTileSizePx / worldConfig.tileSizePx,
  floorTop: 0.16,
  wallHeight: 1.86,
  wallThickness: 0.13,
  roofHeight: 2.1,
  cutawayWallScale: 0.22,
} as const;
const H = BUILDING.cellSize / 2;

/** These corner orders reproduce the authoritative FoundationShape footprint. */
export const FOUNDATION_FOOTPRINTS: Readonly<Record<number, readonly GroundPoint[]>> = {
  0: [],
  1: [[-H, -H], [H, -H], [H, H], [-H, H]],
  2: [[-H, -H], [H, -H], [-H, H]],
  3: [[-H, -H], [H, -H], [H, H]],
  4: [[H, -H], [H, H], [-H, H]],
  5: [[-H, -H], [H, H], [-H, H]],
};

export function polygonArea(polygon: readonly GroundPoint[]): number {
  return Math.abs(polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
}

/** Clip a convex footprint before emission: planks and masonry stop at its edge. */
export function clipGroundPolygon(polygon: readonly GroundPoint[], axis: 0 | 1, limit: number, keepAbove: boolean): GroundPoint[] {
  const output: GroundPoint[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const insideA = keepAbove ? a[axis] >= limit - 1e-8 : a[axis] <= limit + 1e-8;
    const insideB = keepAbove ? b[axis] >= limit - 1e-8 : b[axis] <= limit + 1e-8;
    if (insideA) output.push(a);
    if (insideA !== insideB) {
      const t = (limit - a[axis]) / (b[axis] - a[axis]);
      output.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return output.filter((point, i) => {
    const previous = output[(i + output.length - 1) % output.length];
    return Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-7;
  });
}

export interface FloorPanel { polygon: GroundPoint[]; material: 'base' | 'surface' | 'alternate'; bottom: number; top: number }
export interface FoundationPlan { shape: number; tier: number; footprint: readonly GroundPoint[]; panels: FloorPanel[] }

export function planFoundation(shape: number, tier: number): FoundationPlan {
  const footprint = FOUNDATION_FOOTPRINTS[shape];
  if (!footprint) throw new Error(`Unknown foundation shape ${shape}`);
  if (tier < 0 || tier > 3) throw new Error(`Unknown construction tier ${tier}`);
  const panels: FloorPanel[] = [];
  if (!footprint.length) return { shape, tier, footprint, panels };
  panels.push({ polygon: [...footprint], material: 'base', bottom: -0.08, top: BUILDING.floorTop - 0.045 });
  const rows = tier === 2 ? 4 : tier === 3 ? 2 : 8;
  const columns = tier === 2 ? 4 : 1;
  for (let x = 0; x < rows; x++) for (let z = 0; z < columns; z++) {
    const gap = tier === 0 ? 0.018 : 0.008;
    let polygon = clipGroundPolygon(footprint, 0, -H + x * BUILDING.cellSize / rows + gap, true);
    polygon = clipGroundPolygon(polygon, 0, -H + (x + 1) * BUILDING.cellSize / rows - gap, false);
    polygon = clipGroundPolygon(polygon, 1, -H + z * BUILDING.cellSize / columns + gap, true);
    polygon = clipGroundPolygon(polygon, 1, -H + (z + 1) * BUILDING.cellSize / columns - gap, false);
    if (polygon.length >= 3 && polygonArea(polygon) > 1e-6) panels.push({ polygon,
      material: (x + z) % 3 === 0 ? 'alternate' : 'surface', bottom: BUILDING.floorTop - 0.05, top: BUILDING.floorTop });
  }
  return { shape, tier, footprint, panels };
}

export interface BoundaryPlan { start: GroundPoint; end: GroundPoint; length: number; center: GroundPoint; yaw: number }

export function planBoundary(edge: number, foundationShape = 1, centered = false): BoundaryPlan {
  let start: GroundPoint;
  let end: GroundPoint;
  switch (edge) {
    case 0: start = [-H, -H]; end = [H, -H]; break;
    case 1: start = [H, -H]; end = [H, H]; break;
    case 2: start = [H, H]; end = [-H, H]; break;
    case 3: start = [-H, H]; end = [-H, -H]; break;
    case 4:
    case 5:
      // Existing diagonal labels disagree with triangle-corner names in old
      // sprite code. The actual foundation footprint owns its hypotenuse.
      if (foundationShape === 2 || foundationShape === 4) { start = [-H, H]; end = [H, -H]; }
      else if (foundationShape === 3 || foundationShape === 5) { start = [-H, -H]; end = [H, H]; }
      else if (edge === 4) { start = [H, -H]; end = [-H, H]; }
      else { start = [-H, -H]; end = [H, H]; }
      break;
    default: throw new Error(`Unknown construction edge ${edge}`);
  }
  const center: GroundPoint = centered ? [0, 0] : [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  return { start, end, center, length: Math.hypot(dx, dz), yaw: -Math.atan2(dz, dx) };
}

export function pointOnFoundation(shape: number, x: number, z: number): boolean {
  const polygon = FOUNDATION_FOOTPRINTS[shape] ?? [];
  if (!polygon.length) return false;
  return polygon.every((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) >= -1e-7;
  });
}
