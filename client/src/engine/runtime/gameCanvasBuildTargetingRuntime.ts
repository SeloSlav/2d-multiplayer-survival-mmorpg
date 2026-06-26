import { FOUNDATION_TILE_SIZE, foundationCellToWorldCenter } from '../../config/gameConfig';

const BUILDING_PLACEMENT_MAX_DISTANCE = 128.0;
const BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED = BUILDING_PLACEMENT_MAX_DISTANCE * BUILDING_PLACEMENT_MAX_DISTANCE;
const WALL_CLICK_THRESHOLD = 24;
const FENCE_CLICK_THRESHOLD = 32;
const FOUNDATION_SNAP_THRESHOLD_SQUARED = (FOUNDATION_TILE_SIZE * 1.5) * (FOUNDATION_TILE_SIZE * 1.5);
const FENCE_SIZE = 96;

export interface GameCanvasBuildTargetingSnapshot {
  targetedFoundation: any | null;
  targetTileX: number | null;
  targetTileY: number | null;
  targetedWall: any | null;
  targetWallTileX: number | null;
  targetWallTileY: number | null;
  targetedFence: any | null;
}

export interface GameCanvasBuildTargetingRuntimeOptions {
  foundationCells: Map<string, any> | undefined;
  wallCells: Map<string, any> | undefined;
  fences: Map<string, any> | undefined;
  worldMousePos: { x: number | null; y: number | null };
  localPlayerX: number;
  localPlayerY: number;
  hasRepairHammer: boolean;
}

export const EMPTY_GAME_CANVAS_BUILD_TARGETING_SNAPSHOT: GameCanvasBuildTargetingSnapshot = {
  targetedFoundation: null,
  targetTileX: null,
  targetTileY: null,
  targetedWall: null,
  targetWallTileX: null,
  targetWallTileY: null,
  targetedFence: null,
};

function getBuildingCellKey(cellX: number, cellY: number): string {
  return `${cellX},${cellY}`;
}

function buildActiveRowsByCell(rows: Map<string, any> | undefined): Map<string, any[]> {
  const rowsByCell = new Map<string, any[]>();
  rows?.forEach((row) => {
    if (!row || row.isDestroyed) {
      return;
    }

    const key = getBuildingCellKey(row.cellX, row.cellY);
    const existingRows = rowsByCell.get(key);
    if (existingRows) {
      existingRows.push(row);
    } else {
      rowsByCell.set(key, [row]);
    }
  });
  return rowsByCell;
}

function getWallBounds(wall: any, tileCenterX: number, tileCenterY: number): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const halfTile = FOUNDATION_TILE_SIZE / 2;
  const wallThickness = 4;
  const eastWestWallThickness = 12;
  const northSouthWallHeight = FOUNDATION_TILE_SIZE;

  switch (wall.edge) {
    case 0:
      return {
        minX: tileCenterX - halfTile,
        maxX: tileCenterX + halfTile,
        minY: tileCenterY - FOUNDATION_TILE_SIZE - northSouthWallHeight + wallThickness / 2,
        maxY: tileCenterY - FOUNDATION_TILE_SIZE + wallThickness / 2,
      };
    case 1:
      return {
        minX: tileCenterX + halfTile - eastWestWallThickness / 2,
        maxX: tileCenterX + halfTile + eastWestWallThickness / 2,
        minY: tileCenterY - halfTile,
        maxY: tileCenterY + halfTile,
      };
    case 2:
      return {
        minX: tileCenterX - halfTile,
        maxX: tileCenterX + halfTile,
        minY: tileCenterY + halfTile - northSouthWallHeight,
        maxY: tileCenterY + halfTile + wallThickness / 2,
      };
    case 3:
      return {
        minX: tileCenterX - halfTile - eastWestWallThickness / 2,
        maxX: tileCenterX - halfTile + eastWestWallThickness / 2,
        minY: tileCenterY - halfTile,
        maxY: tileCenterY + halfTile,
      };
    default:
      return {
        minX: tileCenterX - halfTile,
        maxX: tileCenterX + halfTile,
        minY: tileCenterY - halfTile,
        maxY: tileCenterY + halfTile,
      };
  }
}

function isPointNearWall(wall: any, tileCenterX: number, tileCenterY: number, mouseX: number, mouseY: number): boolean {
  if (wall.edge === 4 || wall.edge === 5) {
    const dx = mouseX - tileCenterX;
    const dy = mouseY - tileCenterY;
    const distToDiagonal = wall.edge === 4
      ? Math.abs(dx - dy) / Math.sqrt(2)
      : Math.abs(dx + dy) / Math.sqrt(2);
    return distToDiagonal <= WALL_CLICK_THRESHOLD;
  }

  const bounds = getWallBounds(wall, tileCenterX, tileCenterY);
  return (
    mouseX >= bounds.minX - WALL_CLICK_THRESHOLD &&
    mouseX <= bounds.maxX + WALL_CLICK_THRESHOLD &&
    mouseY >= bounds.minY - WALL_CLICK_THRESHOLD &&
    mouseY <= bounds.maxY + WALL_CLICK_THRESHOLD
  );
}

function isPointNearFence(fence: any, mouseX: number, mouseY: number): boolean {
  const halfEdge = FENCE_SIZE / 2;
  const fenceThickness = 24;
  const horizontal = fence.edge === 0 || fence.edge === 2;
  const minX = horizontal ? fence.posX - halfEdge : fence.posX - fenceThickness / 2;
  const maxX = horizontal ? fence.posX + halfEdge : fence.posX + fenceThickness / 2;
  const minY = horizontal ? fence.posY - fenceThickness / 2 : fence.posY - halfEdge;
  const maxY = horizontal ? fence.posY + fenceThickness / 2 : fence.posY + halfEdge;

  return (
    mouseX >= minX - FENCE_CLICK_THRESHOLD &&
    mouseX <= maxX + FENCE_CLICK_THRESHOLD &&
    mouseY >= minY - FENCE_CLICK_THRESHOLD &&
    mouseY <= maxY + FENCE_CLICK_THRESHOLD
  );
}

export class GameCanvasBuildTargetingRuntime {
  private foundationCellsSource: Map<string, any> | undefined;
  private wallCellsSource: Map<string, any> | undefined;
  private fencesSource: Map<string, any> | undefined;
  private foundationsByCell = new Map<string, any[]>();
  private wallsByCell = new Map<string, any[]>();
  private fencesByCell = new Map<string, any[]>();
  private snapshot: GameCanvasBuildTargetingSnapshot = EMPTY_GAME_CANVAS_BUILD_TARGETING_SNAPSHOT;

  update(options: GameCanvasBuildTargetingRuntimeOptions): GameCanvasBuildTargetingSnapshot {
    this.refreshIndexes(options);

    const { worldMousePos, localPlayerX, localPlayerY, hasRepairHammer } = options;
    if (!hasRepairHammer || worldMousePos.x === null || worldMousePos.y === null) {
      this.snapshot = EMPTY_GAME_CANVAS_BUILD_TARGETING_SNAPSHOT;
      return this.snapshot;
    }

    const mouseCellX = Math.floor(worldMousePos.x / FOUNDATION_TILE_SIZE);
    const mouseCellY = Math.floor(worldMousePos.y / FOUNDATION_TILE_SIZE);
    const foundationTarget = this.findFoundationTarget(mouseCellX, mouseCellY, worldMousePos.x, worldMousePos.y, localPlayerX, localPlayerY);
    const wallTarget = this.findWallTarget(mouseCellX, mouseCellY, worldMousePos.x, worldMousePos.y, localPlayerX, localPlayerY);
    const fenceTarget = this.findFenceTarget(mouseCellX, mouseCellY, worldMousePos.x, worldMousePos.y, localPlayerX, localPlayerY);

    this.snapshot = {
      targetedFoundation: foundationTarget.targetedFoundation,
      targetTileX: foundationTarget.targetTileX,
      targetTileY: foundationTarget.targetTileY,
      targetedWall: wallTarget.targetedWall,
      targetWallTileX: wallTarget.targetWallTileX,
      targetWallTileY: wallTarget.targetWallTileY,
      targetedFence: fenceTarget.targetedFence,
    };
    return this.snapshot;
  }

  getSnapshot(): GameCanvasBuildTargetingSnapshot {
    return this.snapshot;
  }

  private refreshIndexes({
    foundationCells,
    wallCells,
    fences,
  }: GameCanvasBuildTargetingRuntimeOptions): void {
    if (this.foundationCellsSource !== foundationCells) {
      this.foundationCellsSource = foundationCells;
      this.foundationsByCell = buildActiveRowsByCell(foundationCells);
    }
    if (this.wallCellsSource !== wallCells) {
      this.wallCellsSource = wallCells;
      this.wallsByCell = buildActiveRowsByCell(wallCells);
    }
    if (this.fencesSource !== fences) {
      this.fencesSource = fences;
      this.fencesByCell = buildActiveRowsByCell(fences);
    }
  }

  private findFoundationTarget(
    mouseCellX: number,
    mouseCellY: number,
    worldMouseX: number,
    worldMouseY: number,
    localPlayerX: number,
    localPlayerY: number,
  ) {
    let targetedFoundation: any | null = null;
    let closestDistanceSq = Infinity;
    let targetTileX: number | null = null;
    let targetTileY: number | null = null;

    for (let offsetY = -2; offsetY <= 2; offsetY++) {
      for (let offsetX = -2; offsetX <= 2; offsetX++) {
        const foundations = this.foundationsByCell.get(getBuildingCellKey(mouseCellX + offsetX, mouseCellY + offsetY));
        if (!foundations) continue;

        for (const foundation of foundations) {
          const { x: tileWorldX, y: tileWorldY } = foundationCellToWorldCenter(foundation.cellX, foundation.cellY);
          const playerDx = tileWorldX - localPlayerX;
          const playerDy = tileWorldY - localPlayerY;
          if (playerDx * playerDx + playerDy * playerDy > BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED) {
            continue;
          }

          const mouseDx = tileWorldX - worldMouseX;
          const mouseDy = tileWorldY - worldMouseY;
          const distSqFromMouse = mouseDx * mouseDx + mouseDy * mouseDy;
          if (distSqFromMouse < closestDistanceSq) {
            closestDistanceSq = distSqFromMouse;
            targetedFoundation = foundation;
            targetTileX = foundation.cellX;
            targetTileY = foundation.cellY;
          }
        }
      }
    }

    if (!targetedFoundation || closestDistanceSq > FOUNDATION_SNAP_THRESHOLD_SQUARED) {
      return { targetedFoundation: null, targetTileX: null, targetTileY: null };
    }

    return { targetedFoundation, targetTileX, targetTileY };
  }

  private findWallTarget(
    mouseCellX: number,
    mouseCellY: number,
    worldMouseX: number,
    worldMouseY: number,
    localPlayerX: number,
    localPlayerY: number,
  ) {
    let targetedWall: any | null = null;
    let closestDistanceSq = Infinity;
    let targetWallTileX: number | null = null;
    let targetWallTileY: number | null = null;

    for (let offsetY = -2; offsetY <= 2; offsetY++) {
      for (let offsetX = -2; offsetX <= 2; offsetX++) {
        const walls = this.wallsByCell.get(getBuildingCellKey(mouseCellX + offsetX, mouseCellY + offsetY));
        if (!walls) continue;

        for (const wall of walls) {
          const { x: tileWorldX, y: tileWorldY } = foundationCellToWorldCenter(wall.cellX, wall.cellY);
          const playerDx = tileWorldX - localPlayerX;
          const playerDy = tileWorldY - localPlayerY;
          if (playerDx * playerDx + playerDy * playerDy > BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED) {
            continue;
          }
          if (!isPointNearWall(wall, tileWorldX, tileWorldY, worldMouseX, worldMouseY)) {
            continue;
          }

          const mouseDx = tileWorldX - worldMouseX;
          const mouseDy = tileWorldY - worldMouseY;
          const distSqFromMouse = mouseDx * mouseDx + mouseDy * mouseDy;
          if (distSqFromMouse < closestDistanceSq) {
            closestDistanceSq = distSqFromMouse;
            targetedWall = wall;
            targetWallTileX = wall.cellX;
            targetWallTileY = wall.cellY;
          }
        }
      }
    }

    return { targetedWall, targetWallTileX, targetWallTileY };
  }

  private findFenceTarget(
    mouseCellX: number,
    mouseCellY: number,
    worldMouseX: number,
    worldMouseY: number,
    localPlayerX: number,
    localPlayerY: number,
  ) {
    let targetedFence: any | null = null;
    let closestDistanceSq = Infinity;

    for (let offsetY = -2; offsetY <= 2; offsetY++) {
      for (let offsetX = -2; offsetX <= 2; offsetX++) {
        const fences = this.fencesByCell.get(getBuildingCellKey(mouseCellX + offsetX, mouseCellY + offsetY));
        if (!fences) continue;

        for (const fence of fences) {
          if (fence.isMonument) continue;
          const playerDx = fence.posX - localPlayerX;
          const playerDy = fence.posY - localPlayerY;
          if (playerDx * playerDx + playerDy * playerDy > BUILDING_PLACEMENT_MAX_DISTANCE_SQUARED) {
            continue;
          }
          if (!isPointNearFence(fence, worldMouseX, worldMouseY)) {
            continue;
          }

          const mouseDx = fence.posX - worldMouseX;
          const mouseDy = fence.posY - worldMouseY;
          const distSqFromMouse = mouseDx * mouseDx + mouseDy * mouseDy;
          if (distSqFromMouse < closestDistanceSq) {
            closestDistanceSq = distSqFromMouse;
            targetedFence = fence;
          }
        }
      }
    }

    return { targetedFence };
  }
}
