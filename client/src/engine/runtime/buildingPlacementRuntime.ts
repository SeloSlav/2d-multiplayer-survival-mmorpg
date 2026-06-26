import type { DbConnection } from '../../generated';
import {
  FOUNDATION_TILE_SIZE,
  TILE_SIZE,
  foundationCellToWorldCenter,
  worldPixelsToFoundationCell,
} from '../../config/gameConfig';
import { playImmediateSound } from '../../hooks/useSoundSystem';
import { getTileTypeFromChunkData } from '../../utils/renderers/placementRenderingUtils';
import { isWaterTileTag } from '../../utils/tileTypeGuards';

export enum BuildingMode {
  None = 'none',
  Foundation = 'foundation',
  Wall = 'wall',
  Door = 'door',
  Fence = 'fence',
}

export enum FoundationShape {
  Empty = 0,
  Full = 1,
  TriNW = 2,
  TriNE = 3,
  TriSE = 4,
  TriSW = 5,
}

export enum BuildingEdge {
  N = 0,
  E = 1,
  S = 2,
  W = 3,
  DiagNE_SW = 4,
  DiagNW_SE = 5,
}

export enum BuildingFacing {
  Interior = 0,
  Exterior = 1,
}

export enum BuildingTier {
  Twig = 0,
  Wood = 1,
  Stone = 2,
  Metal = 3,
}

export interface BuildingPlacementState {
  isBuilding: boolean;
  mode: BuildingMode;
  foundationShape: FoundationShape;
  buildingEdge: BuildingEdge;
  buildingFacing: BuildingFacing;
  buildingTier: BuildingTier;
  placementError: string | null;
}

export interface BuildingPlacementActions {
  startBuildingMode: (mode: BuildingMode, tier?: BuildingTier, initialShape?: FoundationShape) => void;
  cancelBuildingMode: () => void;
  cycleFoundationShape: (direction: 'next' | 'prev') => void;
  rotateTriangleShape: () => void;
  cycleBuildingEdge: (direction: 'next' | 'prev') => void;
  toggleBuildingFacing: () => void;
  attemptPlacement: (worldX: number, worldY: number) => void;
}

export interface BuildingPlacementRuntimeOptions {
  connection: DbConnection | null;
  localPlayerX: number;
  localPlayerY: number;
  activeEquipments?: Map<string, EquipmentRow>;
  itemDefinitions?: Map<string, ItemDefinitionRow>;
  localPlayerId?: string;
  worldMousePos: { x: number | null; y: number | null };
  foundationCells?: Map<string, FoundationCellRow>;
  fences?: Map<string, FenceRow>;
}

export interface BuildingPlacementRuntimeSnapshot {
  buildingState: BuildingPlacementState;
  buildingActions: BuildingPlacementActions;
  hasRepairHammer: boolean;
  hasStoneTiller: boolean;
}

interface RuntimeUpdateOptions {
  emit?: boolean;
}

const EMPTY_OPTIONS: BuildingPlacementRuntimeOptions = {
  connection: null,
  localPlayerX: 0,
  localPlayerY: 0,
  worldMousePos: { x: null, y: null },
};

interface EquipmentRow {
  equippedItemDefId?: unknown;
}

interface ItemDefinitionRow {
  name?: string;
}

interface CellPosition {
  cellX: number;
  cellY: number;
  isDestroyed?: boolean;
}

interface FoundationCellRow extends CellPosition {
  shape: number;
}

interface FenceRow extends CellPosition {
  edge: number;
}

function getBuildingCellKey(cellX: number, cellY: number): string {
  return `${cellX},${cellY}`;
}

function worldPosToTileCoords(worldX: number, worldY: number): { tileX: number; tileY: number } {
  return {
    tileX: Math.floor(worldX / TILE_SIZE),
    tileY: Math.floor(worldY / TILE_SIZE),
  };
}

function buildActiveRowsByCell<Row extends CellPosition>(rows: Map<string, Row> | undefined): Map<string, Row[]> {
  const rowsByCell = new Map<string, Row[]>();

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

function isFoundationPlacementTooFar(
  connection: DbConnection | null,
  cellX: number,
  cellY: number,
  playerX: number,
  playerY: number,
): boolean {
  if (!connection) return false;

  const maxDistance = 128.0;
  const maxDistanceSquared = maxDistance * maxDistance;
  const { x: worldX, y: worldY } = foundationCellToWorldCenter(cellX, cellY);
  const dx = worldX - playerX;
  const dy = worldY - playerY;

  return dx * dx + dy * dy > maxDistanceSquared;
}

function predictTriangleShape(
  foundationsByCell: Map<string, { cellX: number; cellY: number; shape: number }[]>,
  cellX: number,
  cellY: number,
): FoundationShape | null {
  if (foundationsByCell.size === 0) return null;

  const sameCellFoundations = (foundationsByCell.get(getBuildingCellKey(cellX, cellY)) ?? []).map((foundation) => ({
    x: foundation.cellX,
    y: foundation.cellY,
    shape: foundation.shape as FoundationShape,
  }));
  const adjacentFoundations = new Map<string, { x: number; y: number; shape: FoundationShape }>();
  const triangleComplements = new Map<FoundationShape, FoundationShape>([
    [FoundationShape.TriNW, FoundationShape.TriSE],
    [FoundationShape.TriNE, FoundationShape.TriSW],
    [FoundationShape.TriSE, FoundationShape.TriNW],
    [FoundationShape.TriSW, FoundationShape.TriNE],
  ]);

  for (let offsetY = -1; offsetY <= 1; offsetY++) {
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      if (offsetX === 0 && offsetY === 0) continue;

      const adjacentKey = getBuildingCellKey(cellX + offsetX, cellY + offsetY);
      const adjacentCellFoundations = foundationsByCell.get(adjacentKey);
      const adjacentFoundation = adjacentCellFoundations?.[0];
      if (!adjacentFoundation) continue;

      adjacentFoundations.set(adjacentKey, {
        x: adjacentFoundation.cellX,
        y: adjacentFoundation.cellY,
        shape: adjacentFoundation.shape as FoundationShape,
      });
    }
  }

  for (const sameCell of sameCellFoundations) {
    if (sameCell.shape >= FoundationShape.TriNW && sameCell.shape <= FoundationShape.TriSW) {
      const complement = triangleComplements.get(sameCell.shape);
      if (complement) {
        return complement;
      }
    }
  }

  if (adjacentFoundations.size === 0 && sameCellFoundations.length === 0) {
    return null;
  }

  for (const adjacentFoundation of adjacentFoundations.values()) {
    if (adjacentFoundation.shape < FoundationShape.TriNW || adjacentFoundation.shape > FoundationShape.TriSW) {
      continue;
    }

    const dx = adjacentFoundation.x - cellX;
    const dy = adjacentFoundation.y - cellY;
    if (Math.abs(dx) === 1 && Math.abs(dy) === 1) {
      const complement = triangleComplements.get(adjacentFoundation.shape);
      if (complement) {
        return complement;
      }
    }
  }

  const curveSuggestions: FoundationShape[] = [];
  const getTriangleAt = (dx: number, dy: number): FoundationShape | null => {
    const key = getBuildingCellKey(cellX + dx, cellY + dy);
    const adjacentFoundation = adjacentFoundations.get(key);
    if (
      adjacentFoundation
      && adjacentFoundation.shape >= FoundationShape.TriNW
      && adjacentFoundation.shape <= FoundationShape.TriSW
    ) {
      return adjacentFoundation.shape;
    }
    return null;
  };

  for (const triangle of [
    getTriangleAt(0, -1),
    getTriangleAt(0, 1),
    getTriangleAt(1, 0),
    getTriangleAt(-1, 0),
  ]) {
    switch (triangle) {
      case FoundationShape.TriNW:
        curveSuggestions.push(FoundationShape.TriSE);
        break;
      case FoundationShape.TriNE:
        curveSuggestions.push(FoundationShape.TriSW);
        break;
      case FoundationShape.TriSE:
        curveSuggestions.push(FoundationShape.TriNW);
        break;
      case FoundationShape.TriSW:
        curveSuggestions.push(FoundationShape.TriNE);
        break;
    }
  }

  const cardinalSuggestions: FoundationShape[] = [];
  const hasFoundation = (dx: number, dy: number): boolean => {
    const key = getBuildingCellKey(cellX + dx, cellY + dy);
    const adjacentFoundation = adjacentFoundations.get(key);
    return adjacentFoundation !== undefined && adjacentFoundation.shape === FoundationShape.Full;
  };

  const hasNorth = hasFoundation(0, -1);
  const hasSouth = hasFoundation(0, 1);
  const hasEast = hasFoundation(1, 0);
  const hasWest = hasFoundation(-1, 0);

  if (hasNorth && hasEast) {
    cardinalSuggestions.push(FoundationShape.TriNE);
  } else if (hasNorth && hasWest) {
    cardinalSuggestions.push(FoundationShape.TriNW);
  } else if (hasSouth && hasEast) {
    cardinalSuggestions.push(FoundationShape.TriSE);
  } else if (hasSouth && hasWest) {
    cardinalSuggestions.push(FoundationShape.TriSW);
  } else if (hasNorth) {
    cardinalSuggestions.push(FoundationShape.TriNE);
  } else if (hasSouth) {
    cardinalSuggestions.push(FoundationShape.TriSE);
  } else if (hasEast) {
    cardinalSuggestions.push(FoundationShape.TriNE);
  } else if (hasWest) {
    cardinalSuggestions.push(FoundationShape.TriNW);
  }

  if (curveSuggestions.length > 0) {
    return getMostCommonShape(curveSuggestions);
  }

  if (cardinalSuggestions.length > 0) {
    return cardinalSuggestions[0];
  }

  const diagonalSuggestions: FoundationShape[] = [];
  const diagonalMap = new Map<string, FoundationShape>([
    [getBuildingCellKey(cellX - 1, cellY - 1), FoundationShape.TriSE],
    [getBuildingCellKey(cellX + 1, cellY - 1), FoundationShape.TriSW],
    [getBuildingCellKey(cellX + 1, cellY + 1), FoundationShape.TriNW],
    [getBuildingCellKey(cellX - 1, cellY + 1), FoundationShape.TriNE],
  ]);

  for (const [key, suggestedShape] of diagonalMap.entries()) {
    if (adjacentFoundations.has(key)) {
      diagonalSuggestions.push(suggestedShape);
    }
  }

  return diagonalSuggestions.length > 0 ? getMostCommonShape(diagonalSuggestions) : null;
}

function getMostCommonShape(shapes: FoundationShape[]): FoundationShape {
  const counts = new Map<FoundationShape, number>();
  for (const shape of shapes) {
    counts.set(shape, (counts.get(shape) ?? 0) + 1);
  }

  let maxCount = 0;
  let mostCommon = shapes[0];
  for (const [shape, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      mostCommon = shape;
    }
  }
  return mostCommon;
}

function isFoundationPositionOccupied(
  foundationsByCell: Map<string, { shape: number }[]>,
  cellX: number,
  cellY: number,
  shape: FoundationShape,
): boolean {
  const cellFoundations = foundationsByCell.get(getBuildingCellKey(cellX, cellY)) ?? [];
  let foundOverlap = false;

  for (const foundation of cellFoundations) {
    const existingShape = foundation.shape as FoundationShape;
    if (existingShape === shape) {
      return true;
    }
    if (existingShape === FoundationShape.Full || shape === FoundationShape.Full) {
      return true;
    }

    const isComplementary = (
      (existingShape === FoundationShape.TriNW && shape === FoundationShape.TriSE)
      || (existingShape === FoundationShape.TriSE && shape === FoundationShape.TriNW)
      || (existingShape === FoundationShape.TriNE && shape === FoundationShape.TriSW)
      || (existingShape === FoundationShape.TriSW && shape === FoundationShape.TriNE)
    );
    if (!isComplementary) {
      foundOverlap = true;
    }
  }

  return foundOverlap || cellFoundations.length >= 2;
}

export class BuildingPlacementRuntime {
  private options = EMPTY_OPTIONS;
  private foundationCellsSource: Map<string, FoundationCellRow> | undefined;
  private fencesSource: Map<string, FenceRow> | undefined;
  private foundationsByCell = new Map<string, FoundationCellRow[]>();
  private fencesByCell = new Map<string, FenceRow[]>();
  private manuallySetShape: FoundationShape | null = null;
  private lastPredictedTile: { tileX: number; tileY: number } | null = null;
  private currentCell: { cellX: number; cellY: number } | null = null;
  private version = 0;
  private readonly listeners = new Set<() => void>();

  private readonly state: BuildingPlacementState = {
    isBuilding: false,
    mode: BuildingMode.None,
    foundationShape: FoundationShape.Full,
    buildingEdge: BuildingEdge.N,
    buildingFacing: BuildingFacing.Exterior,
    buildingTier: BuildingTier.Twig,
    placementError: null,
  };

  private readonly actions: BuildingPlacementActions = {
    startBuildingMode: (...args) => this.startBuildingMode(...args),
    cancelBuildingMode: () => this.cancelBuildingMode(),
    cycleFoundationShape: (...args) => this.cycleFoundationShape(...args),
    rotateTriangleShape: () => this.rotateTriangleShape(),
    cycleBuildingEdge: (...args) => this.cycleBuildingEdge(...args),
    toggleBuildingFacing: () => this.toggleBuildingFacing(),
    attemptPlacement: (...args) => this.attemptPlacement(...args),
  };

  private readonly snapshot: BuildingPlacementRuntimeSnapshot = {
    buildingState: this.state,
    buildingActions: this.actions,
    hasRepairHammer: false,
    hasStoneTiller: false,
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  getSnapshot(): BuildingPlacementRuntimeSnapshot {
    return this.snapshot;
  }

  update(options: BuildingPlacementRuntimeOptions, updateOptions: RuntimeUpdateOptions = {}): BuildingPlacementRuntimeSnapshot {
    this.options = options;
    this.refreshIndexes(options);

    let changed = this.updateEquipmentFlags(false);
    changed = this.updateFoundationPrediction(false) || changed;

    if (changed) {
      this.commit(updateOptions.emit ?? true);
    }

    return this.snapshot;
  }

  stop(): void {
    this.options = EMPTY_OPTIONS;
    this.foundationCellsSource = undefined;
    this.fencesSource = undefined;
    this.foundationsByCell = new Map();
    this.fencesByCell = new Map();
    this.manuallySetShape = null;
    this.lastPredictedTile = null;
    this.currentCell = null;
  }

  private refreshIndexes({ foundationCells, fences }: BuildingPlacementRuntimeOptions): void {
    if (this.foundationCellsSource !== foundationCells) {
      this.foundationCellsSource = foundationCells;
      this.foundationsByCell = buildActiveRowsByCell(foundationCells);
    }
    if (this.fencesSource !== fences) {
      this.fencesSource = fences;
      this.fencesByCell = buildActiveRowsByCell(fences);
    }
  }

  private updateEquipmentFlags(emit: boolean): boolean {
    const hasRepairHammer = this.hasEquippedItemNamed('Repair Hammer');
    const hasStoneTiller = this.hasEquippedItemNamed('Stone Tiller');
    const hasBlueprint = this.hasEquippedItemNamed('Blueprint');
    let changed = false;

    if (this.snapshot.hasRepairHammer !== hasRepairHammer) {
      this.snapshot.hasRepairHammer = hasRepairHammer;
      changed = true;
    }
    if (this.snapshot.hasStoneTiller !== hasStoneTiller) {
      this.snapshot.hasStoneTiller = hasStoneTiller;
      changed = true;
    }

    if (this.state.isBuilding && !hasBlueprint) {
      console.log('[BuildingPlacementRuntime] Blueprint unequipped, canceling building mode');
      changed = this.patchState({ mode: BuildingMode.None, placementError: null }, false) || changed;
    }

    if (changed && emit) {
      this.commit(true);
    }

    return changed;
  }

  private hasEquippedItemNamed(name: string): boolean {
    const { activeEquipments, itemDefinitions, localPlayerId } = this.options;
    if (!localPlayerId || !activeEquipments || !itemDefinitions) return false;

    const equipment = activeEquipments.get(localPlayerId);
    if (!equipment?.equippedItemDefId) return false;

    const itemDef = itemDefinitions.get(String(equipment.equippedItemDefId));
    return itemDef?.name === name;
  }

  private updateFoundationPrediction(emit: boolean): boolean {
    const { connection, worldMousePos } = this.options;
    const currentWorldMouseX = worldMousePos.x;
    const currentWorldMouseY = worldMousePos.y;

    if (!this.state.isBuilding || this.state.mode !== BuildingMode.Foundation) return false;
    if (currentWorldMouseX === null || currentWorldMouseY === null || !connection) return false;

    const { cellX, cellY } = worldPixelsToFoundationCell(currentWorldMouseX, currentWorldMouseY);
    if (this.currentCell && this.currentCell.cellX === cellX && this.currentCell.cellY === cellY) {
      return false;
    }

    this.currentCell = { cellX, cellY };
    const lastTile = this.lastPredictedTile;
    const tileChanged = !lastTile || lastTile.tileX !== cellX || lastTile.tileY !== cellY;

    if (this.manuallySetShape !== null && !tileChanged) {
      return false;
    }
    if (tileChanged && this.manuallySetShape !== null) {
      this.manuallySetShape = null;
    }

    const currentShape = this.state.foundationShape;
    const isTriangle = currentShape >= FoundationShape.TriNW && currentShape <= FoundationShape.TriSW;
    if (!isTriangle && currentShape !== FoundationShape.Full) {
      return false;
    }
    if (!isTriangle) {
      return false;
    }

    const predictedShape = predictTriangleShape(this.foundationsByCell, cellX, cellY);
    const nextShape = predictedShape ?? FoundationShape.TriNW;
    this.lastPredictedTile = { tileX: cellX, tileY: cellY };

    if (nextShape === currentShape && !tileChanged) {
      return false;
    }

    return this.patchState({ foundationShape: nextShape }, emit);
  }

  private startBuildingMode = (newMode: BuildingMode, tier?: BuildingTier, initialShape?: FoundationShape): void => {
    console.log('[BuildingPlacementRuntime] startBuildingMode called:', newMode, tier, initialShape);
    const patch: Partial<BuildingPlacementState> = {
      mode: newMode,
      placementError: null,
    };
    if (tier !== undefined) {
      patch.buildingTier = tier;
    }

    this.manuallySetShape = null;
    this.lastPredictedTile = null;
    this.currentCell = null;

    if (newMode === BuildingMode.Foundation) {
      if (initialShape !== undefined) {
        patch.foundationShape = initialShape;
        if (initialShape >= FoundationShape.TriNW && initialShape <= FoundationShape.TriSW) {
          this.manuallySetShape = initialShape;
        }
      } else {
        patch.foundationShape = FoundationShape.Full;
      }
    } else if (newMode === BuildingMode.Wall) {
      patch.buildingEdge = BuildingEdge.N;
      patch.buildingFacing = BuildingFacing.Exterior;
    }

    this.patchState(patch, true);
  };

  private cancelBuildingMode = (): void => {
    this.patchState({ mode: BuildingMode.None, placementError: null }, true);
  };

  private cycleFoundationShape = (direction: 'next' | 'prev'): void => {
    const shapes = [
      FoundationShape.Full,
      FoundationShape.TriNW,
      FoundationShape.TriNE,
      FoundationShape.TriSE,
      FoundationShape.TriSW,
    ];
    const currentIndex = shapes.indexOf(this.state.foundationShape);
    const safeCurrentIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = direction === 'next'
      ? (safeCurrentIndex + 1) % shapes.length
      : (safeCurrentIndex - 1 + shapes.length) % shapes.length;
    const nextShape = shapes[nextIndex];

    this.manuallySetShape = nextShape;
    this.patchState({ foundationShape: nextShape }, true);
  };

  private rotateTriangleShape = (): void => {
    const triangleShapes = [
      FoundationShape.TriNW,
      FoundationShape.TriNE,
      FoundationShape.TriSE,
      FoundationShape.TriSW,
    ];
    const currentIndex = triangleShapes.indexOf(this.state.foundationShape);
    const nextShape = currentIndex === -1
      ? FoundationShape.TriNW
      : triangleShapes[(currentIndex + 1) % triangleShapes.length];

    this.manuallySetShape = nextShape;
    this.patchState({ foundationShape: nextShape }, true);
  };

  private cycleBuildingEdge = (direction: 'next' | 'prev'): void => {
    const cardinalEdges = [BuildingEdge.N, BuildingEdge.E, BuildingEdge.S, BuildingEdge.W];
    const currentIndex = cardinalEdges.indexOf(this.state.buildingEdge);
    const safeCurrentIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = direction === 'next'
      ? (safeCurrentIndex + 1) % cardinalEdges.length
      : (safeCurrentIndex - 1 + cardinalEdges.length) % cardinalEdges.length;

    this.patchState({ buildingEdge: cardinalEdges[nextIndex] }, true);
  };

  private toggleBuildingFacing = (): void => {
    this.patchState({
      buildingFacing: this.state.buildingFacing === BuildingFacing.Interior
        ? BuildingFacing.Exterior
        : BuildingFacing.Interior,
    }, true);
  };

  private attemptPlacement = (worldX: number, worldY: number): void => {
    const { connection, localPlayerX, localPlayerY } = this.options;
    if (!connection || !this.state.isBuilding) {
      console.warn('[BuildingPlacementRuntime] Attempted placement with no connection or not in building mode.');
      return;
    }

    this.patchState({ placementError: null }, true);
    const { cellX, cellY } = worldPixelsToFoundationCell(worldX, worldY);

    try {
      if (this.state.mode === BuildingMode.Foundation) {
        this.attemptFoundationPlacement(connection, cellX, cellY);
      } else if (this.state.mode === BuildingMode.Wall) {
        this.attemptWallPlacement(connection, cellX, cellY, worldX, worldY);
      } else if (this.state.mode === BuildingMode.Fence) {
        this.attemptFencePlacement(connection, worldX, worldY, localPlayerX, localPlayerY);
      } else {
        console.warn(`[BuildingPlacementRuntime] Placement not implemented for mode: ${this.state.mode}`);
        this.patchState({ placementError: `Placement not implemented for ${this.state.mode}` }, true);
      }
    } catch (err: unknown) {
      console.error('[BuildingPlacementRuntime] Failed to call placement reducer:', err);
      this.patchState({ placementError: err instanceof Error ? err.message : 'Failed to place building piece' }, true);
    }
  };

  private attemptFoundationPlacement(connection: DbConnection, cellX: number, cellY: number): void {
    const { localPlayerX, localPlayerY } = this.options;

    if (isFoundationPlacementTooFar(connection, cellX, cellY, localPlayerX, localPlayerY)) {
      this.rejectPlacement('Too far away');
      return;
    }

    const { x: foundationCenterX, y: foundationCenterY } = foundationCellToWorldCenter(cellX, cellY);
    const { tileX, tileY } = worldPosToTileCoords(foundationCenterX, foundationCenterY);
    const tileType = getTileTypeFromChunkData(connection, tileX, tileY);
    if (isWaterTileTag(tileType)) {
      this.rejectPlacement('Cannot place foundation on water');
      return;
    }

    const foundationSize = 96;
    const foundationMinX = foundationCenterX - foundationSize / 2;
    const foundationMaxX = foundationCenterX + foundationSize / 2;
    const foundationMinY = foundationCenterY - foundationSize / 2;
    const foundationMaxY = foundationCenterY + foundationSize / 2;

    for (const grass of connection.db.grass.iter()) {
      const grassState = connection.db.grass_state.grassId.find(grass.id);
      const isAlive = grassState?.isAlive ?? false;
      if (
        isAlive
        && grass.posX >= foundationMinX
        && grass.posX <= foundationMaxX
        && grass.posY >= foundationMinY
        && grass.posY <= foundationMaxY
      ) {
        this.rejectPlacement('Cannot place foundation on grass. Clear the grass first.');
        return;
      }
    }

    if (isFoundationPositionOccupied(this.foundationsByCell, cellX, cellY, this.state.foundationShape)) {
      console.log('[BuildingPlacementRuntime] Client-side validation: Position already occupied at', { cellX, cellY });
      this.rejectPlacement('Position already occupied');
      return;
    }

    console.log('[BuildingPlacementRuntime] Calling placeFoundation reducer:', {
      cellX,
      cellY,
      shape: this.state.foundationShape,
      tier: this.state.buildingTier,
    });

    connection.reducers.placeFoundation({
      cellX: BigInt(cellX),
      cellY: BigInt(cellY),
      shape: this.state.foundationShape as number,
      tier: this.state.buildingTier as number,
    }).catch((err: { status?: { tag?: string; value?: string } }) => {
      const errorMsg = err?.status?.tag === 'Failed' && err?.status?.value
        ? err.status.value
        : 'Failed to place foundation';
      this.patchState({ placementError: errorMsg }, true);
      if (errorMsg.includes('Not enough')) {
        playImmediateSound('error_resources', 1.0);
      } else if (errorMsg.includes('rune stone') || errorMsg.includes('monument')) {
        playImmediateSound('error_foundation_monument', 1.0);
      } else {
        playImmediateSound('construction_placement_error', 1.0);
      }
    });
  }

  private attemptWallPlacement(connection: DbConnection, cellX: number, cellY: number, worldX: number, worldY: number): void {
    const { localPlayerX, localPlayerY } = this.options;

    if (isFoundationPlacementTooFar(connection, cellX, cellY, localPlayerX, localPlayerY)) {
      this.rejectPlacement('Too far away');
      return;
    }

    const hasFoundation = (this.foundationsByCell.get(getBuildingCellKey(cellX, cellY))?.length ?? 0) > 0;
    if (!hasFoundation) {
      this.rejectPlacement('Walls require a foundation');
      return;
    }

    console.log('[BuildingPlacementRuntime] Calling placeWall reducer:', {
      cellX,
      cellY,
      worldX,
      worldY,
      tier: this.state.buildingTier,
    });

    connection.reducers.placeWall({
      cellX: BigInt(cellX),
      cellY: BigInt(cellY),
      worldX,
      worldY,
      tier: this.state.buildingTier as number,
    }).catch((err: { status?: { tag?: string; value?: string } }) => {
      const errorMsg = err?.status?.tag === 'Failed' && err?.status?.value
        ? err.status.value
        : 'Failed to place wall';
      this.patchState({ placementError: errorMsg }, true);
      playImmediateSound(errorMsg.includes('Not enough') ? 'error_resources' : 'construction_placement_error', 1.0);
    });
  }

  private attemptFencePlacement(
    connection: DbConnection,
    worldX: number,
    worldY: number,
    localPlayerX: number,
    localPlayerY: number,
  ): void {
    const { cellX, cellY } = worldPixelsToFoundationCell(worldX, worldY);
    const cellCenterX = cellX * FOUNDATION_TILE_SIZE + FOUNDATION_TILE_SIZE / 2;
    const cellCenterY = cellY * FOUNDATION_TILE_SIZE + FOUNDATION_TILE_SIZE / 2;
    const edgeDx = worldX - cellCenterX;
    const edgeDy = worldY - cellCenterY;
    const absEdgeDx = Math.abs(edgeDx);
    const absEdgeDy = Math.abs(edgeDy);
    const edge = absEdgeDy > absEdgeDx
      ? (edgeDy < 0 ? BuildingEdge.N : BuildingEdge.S)
      : (edgeDx < 0 ? BuildingEdge.W : BuildingEdge.E);

    let edgePosX: number;
    let edgePosY: number;
    switch (edge) {
      case BuildingEdge.N:
        edgePosX = cellCenterX;
        edgePosY = cellY * FOUNDATION_TILE_SIZE;
        break;
      case BuildingEdge.E:
        edgePosX = (cellX + 1) * FOUNDATION_TILE_SIZE;
        edgePosY = cellCenterY;
        break;
      case BuildingEdge.S:
        edgePosX = cellCenterX;
        edgePosY = (cellY + 1) * FOUNDATION_TILE_SIZE;
        break;
      case BuildingEdge.W:
        edgePosX = cellX * FOUNDATION_TILE_SIZE;
        edgePosY = cellCenterY;
        break;
      default:
        edgePosX = cellCenterX;
        edgePosY = cellCenterY;
    }

    const dx = edgePosX - localPlayerX;
    const dy = edgePosY - localPlayerY;
    if (dx * dx + dy * dy > 128 * 128) {
      this.rejectPlacement('Too far away');
      return;
    }

    const hasExistingFence = (this.fencesByCell.get(getBuildingCellKey(cellX, cellY)) ?? [])
      .some((fence) => fence.edge === edge);
    if (hasExistingFence) {
      this.rejectPlacement('A fence already exists at this edge');
      return;
    }

    console.log('[BuildingPlacementRuntime] Calling placeFence reducer:', { cellX, cellY, edge });
    try {
      connection.reducers.placeFence({
        cellX: BigInt(cellX),
        cellY: BigInt(cellY),
        edge,
      });
      console.log('[BuildingPlacementRuntime] placeFence reducer called successfully');
    } catch (err) {
      console.error('[BuildingPlacementRuntime] Error calling placeFence reducer:', err);
      this.rejectPlacement(`Failed to call reducer: ${err}`);
    }
  }

  private rejectPlacement(message: string): void {
    this.patchState({ placementError: message }, true);
    playImmediateSound('construction_placement_error', 1.0);
  }

  private patchState(patch: Partial<BuildingPlacementState>, emit: boolean): boolean {
    const nextMode = patch.mode ?? this.state.mode;
    const patchWithDerived = {
      ...patch,
      isBuilding: nextMode !== BuildingMode.None,
    };
    let changed = false;

    for (const [key, value] of Object.entries(patchWithDerived) as [keyof BuildingPlacementState, BuildingPlacementState[keyof BuildingPlacementState]][]) {
      if (this.state[key] !== value) {
        (this.state[key] as never) = value as never;
        changed = true;
      }
    }

    if (changed && emit) {
      this.commit(true);
    }
    return changed;
  }

  private commit(emit: boolean): void {
    this.version++;
    if (!emit) {
      return;
    }

    this.listeners.forEach((listener) => listener());
  }
}
