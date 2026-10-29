import type { PlacementPreviewPlan } from '../../placement/placementValidation';
import type { PresentationEntity as Row } from './presentationEntity';

export interface PlacementModel { kind: string; row: Row; unfinished?: string }

const STORAGE_ITEMS: Record<string, number> = {
  'wooden_storage_box.png': 0, 'large_wood_box.png': 1, 'refrigerator.png': 2, 'compost.png': 3,
  'repair_bench.png': 5, 'cooking_station.png': 6, 'scarecrow.png': 7, 'fish_trap.png': 10,
  'beehive_wooden.png': 12, 'wolf_pelt.png': 14, 'fox_pelt.png': 15, 'polar_bear_pelt.png': 16,
  'walrus_pelt.png': 17, 'tanning_rack.png': 18,
};

/** Predict the inserted row using the existing hook + Rust reducer transforms.
 * These offsets belong to the stored coordinate contract, not mesh authoring.
 * The ghost must land where the subsequent authoritative model will appear. */
export function placementModel(plan: PlacementPreviewPlan): PlacementModel {
  const row: Row = { posX: plan.x, posY: plan.y, cellX: plan.cellX, cellY: plan.cellY,
    shape: plan.shape, foundationShape: plan.shape, tier: plan.tier, edge: plan.edge, isBurning: false };
  if (plan.kind !== 'item') return { kind: plan.kind === 'foundation' ? 'foundationCells' : plan.kind === 'wall' ? 'wallCells' : 'fences', row };
  const icon = plan.item?.iconAssetName ?? '';
  if (icon in STORAGE_ITEMS) {
    row.boxType = STORAGE_ITEMS[icon];
    row.posY! += row.boxType === 12 ? 152 : row.boxType >= 14 && row.boxType <= 17 ? 48 : 52;
    return { kind: 'woodenStorageBoxes', row };
  }
  switch (icon) {
    case 'campfire.png': row.posY! += 42; return { kind: 'campfires', row };
    case 'furnace_simple.png': row.posY! += 58; row.furnaceType = 0; return { kind: 'furnaces', row };
    case 'large_furnace.png': row.posY! += 128; row.furnaceType = 1; return { kind: 'furnaces', row };
    case 'barbecue.png': return { kind: 'barbecues', row };
    case 'lantern_off.png': row.posY! += 34; row.lanternType = 0; return { kind: 'lanterns', row };
    case 'ancestral_ward.png': row.posY! += 134; row.lanternType = 1; return { kind: 'lanterns', row };
    case 'signal_disruptor.png': row.posY! += 134; row.lanternType = 2; return { kind: 'lanterns', row };
    case 'memory_beacon.png': row.posY! += 134; row.lanternType = 3; return { kind: 'lanterns', row };
    case 'hearth.png': row.posY! += 72.5; return { kind: 'homesteadHearths', row };
    case 'sleeping_bag.png': row.posY! += 48; return { kind: 'sleepingBags', row };
    case 'stash.png': row.posY! += 24; return { kind: 'stashes', row };
    case 'shelter.png': row.posY! += 192; return { kind: 'shelters', row };
    case 'reed_rain_collector.png': return { kind: 'rainCollectors', row };
    case 'field_cauldron.png': return { kind: 'brothPots', row };
    case 'wood_door.png': row.doorType = 0; return { kind: 'doors', row };
    case 'metal_door.png': row.doorType = 1; return { kind: 'doors', row };
    default: return { kind: plan.isSeedPlacement ? 'plantedSeeds' : icon === 'turret_tallow.png' ? 'turrets' : 'placedExplosives', row,
      unfinished: plan.item?.itemName ?? icon };
  }
}
