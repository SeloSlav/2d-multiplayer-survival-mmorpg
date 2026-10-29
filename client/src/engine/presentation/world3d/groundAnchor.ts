import { COLLISION_OFFSETS as O, MONUMENT_BUILDING_COLLISION, SHELTER_DIMS, getTreeCollisionOffset, getBarrelCollisionOffset } from '../../../config/entityGroundGeometry';
import { isCompoundMonument } from '../../../config/compoundBuildings';
import { BUILDING } from './buildingPlan';
import { isVillageCampfire, VILLAGE_CAMPFIRE_Y_OFFSET } from '../../../config/villageGeometry';
import type { PresentationEntity as Row } from './presentationEntity';

const ORIGIN = { x: 0, y: 0 };

/** Compound buildings need their own architecture, not scaled portable props. */
export function isCompoundBuilding(kind: string, row: Row): boolean {
  if (!isCompoundMonument(Boolean(row.isMonument), row.posX ?? 0, row.posY ?? 0)) return false;
  return kind === 'woodenStorageBoxes' && [3, 5, 6].includes(row.boxType ?? 0)
    || kind === 'furnaces' && row.furnaceType === 1 || kind === 'rainCollectors';
}

/** The model origin is the existing predicted ground/collision center. Sprite
 * padding never becomes model height or an additional ground displacement. */
export function groundOffset(kind: string, row: Row, onSea = false): { x: number; y: number } {
  if (isCompoundBuilding(kind, row)) return { x: 0, y: kind === 'woodenStorageBoxes' ? -40
    : kind === 'furnaces' ? MONUMENT_BUILDING_COLLISION.CENTER_Y_OFFSET - 60
    : MONUMENT_BUILDING_COLLISION.RAIN_COLLECTOR_CENTER_Y_OFFSET };
  switch (kind) {
    case 'alkStations': return {x:0,y:row.stationId===0?MONUMENT_BUILDING_COLLISION.ALK_CENTER_Y_OFFSET:-80};
    case 'turrets': return {x:0,y:row.isMonument?40:O.TURRET.y};
    case 'monumentParts': return isVillageCampfire(row) ? {x:0,y:VILLAGE_CAMPFIRE_Y_OFFSET} : ORIGIN;
    case 'trees': return getTreeCollisionOffset(row);
    case 'stones': return O.STONE;
    case 'runeStones': return O.RUNE_STONE;
    case 'cairns': return O.CAIRN;
    case 'livingCorals': return O.LIVING_CORAL;
    case 'basaltColumns': return O.BASALT_COLUMN;
    case 'roadLampposts': return O.ROAD_LAMPPOST;
    case 'seaStacks': return { x: 0, y: -70 * (row.scale ?? 1) };
    case 'woodenStorageBoxes': return row.boxType === 11 || row.boxType === 12 ? { x: 0, y: -82 }
      : (row.boxType ?? 0) >= 14 && (row.boxType ?? 0) <= 17 ? { x: 0, y: -48 } : O.STORAGE_BOX;
    case 'barrels': return getBarrelCollisionOffset(row, onSea);
    case 'furnaces': return row.furnaceType === 1 ? O.LARGE_FURNACE : O.FURNACE;
    case 'rainCollectors': return O.RAIN_COLLECTOR;
    case 'homesteadHearths': return O.HOMESTEAD_HEARTH;
    case 'shelters': return { x: 0, y: -SHELTER_DIMS.AABB_CENTER_Y_OFFSET_FROM_POS_Y };
    case 'lanterns': return (row.lanternType ?? 0) > 0 ? O.WARD : { x: 0, y: -34 };
    case 'sleepingBags': return { x: 0, y: -48 };
    case 'stashes': return { x: 0, y: -24 };
    default: return ORIGIN;
  }
}

export function groundPosition(kind: string, row: Row, onSea = false): { x: number; y: number } {
  if (kind === 'foundationCells' || kind === 'wallCells' || kind === 'ceilings') return {
    x: ((row.cellX ?? 0) + 0.5) * BUILDING.cellPixels,
    y: ((row.cellY ?? 0) + 0.5) * BUILDING.cellPixels,
  };
  const offset = groundOffset(kind, row, onSea);
  return { x: (row.positionX ?? row.posX ?? row.worldPosX ?? row.worldX ?? 0) + offset.x,
    y: (row.positionY ?? row.posY ?? row.worldPosY ?? row.worldY ?? 0) + offset.y };
}

export function insideShelter(x: number, y: number, center: { x: number; y: number }): boolean {
  return Math.abs(x - center.x) <= SHELTER_DIMS.HALF_WIDTH && Math.abs(y - center.y) <= SHELTER_DIMS.HALF_HEIGHT;
}
