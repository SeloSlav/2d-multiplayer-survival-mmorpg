/**
 * Draws a simple circular progress indicator.
 * 
 * @param ctx The canvas rendering context.
 * @param x The center X coordinate.
 * @param y The center Y coordinate.
 * @param progress A value between 0 (empty) and 1 (full).
 * @param radius The radius of the circle.
 * @param bgColor Background color of the circle.
 * @param progressColor Color of the progress arc.
 */
export function drawInteractionIndicator(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    progress: number,
    radius: number = 15,
    bgColor: string = 'rgba(255, 255, 255, 0.3)',
    progressColor: string = 'rgba(255, 255, 255, 0.9)'
  ): void {
    const startAngle = -Math.PI / 2; // Start at the top
    const endAngle = startAngle + (progress * 2 * Math.PI);
  
    ctx.save();
  
    // Draw background circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = bgColor;
    ctx.fill();
  
    // Draw progress arc
    if (progress > 0) {
      ctx.beginPath();
      ctx.moveTo(x, y); // Start from center for a pie-like fill
      ctx.arc(x, y, radius, startAngle, endAngle);
      ctx.closePath(); // Close path back to center
      ctx.fillStyle = progressColor;
      ctx.fill();
    }
  
    ctx.restore();
  }

import { Player as SpacetimeDBPlayer, Campfire as SpacetimeDBCampfire, Lantern as SpacetimeDBLantern, DroppedItem as SpacetimeDBDroppedItem, ItemDefinition as SpacetimeDBItemDefinition, WoodenStorageBox as SpacetimeDBWoodenStorageBox, PlayerCorpse as SpacetimeDBPlayerCorpse, Stash as SpacetimeDBStash, SleepingBag as SpacetimeDBSleepingBag } from '../generated';
import { InteractableTarget } from '../types/interactions';

interface InteractionIndicatorState {
    target: InteractableTarget | null;
    campfires: Map<string, SpacetimeDBCampfire>;
    lanterns: Map<string, SpacetimeDBLantern>;
    droppedItems: Map<string, SpacetimeDBDroppedItem>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>;
    playerCorpses: Map<string, SpacetimeDBPlayerCorpse>;
    stashes: Map<string, SpacetimeDBStash>;
    sleepingBags: Map<string, SpacetimeDBSleepingBag>;
    localPlayer: SpacetimeDBPlayer | null;
}

export function getInteractionText(state: InteractionIndicatorState): string {
    const { target, campfires, lanterns, droppedItems, itemDefinitions, woodenStorageBoxes, playerCorpses, stashes, sleepingBags, localPlayer } = state;
    
    if (!target) return '';

    switch (target.type) {
        case 'mushroom':
            return '[E] Harvest Mushroom';
        case 'corn':
            return '[E] Harvest Corn';
        case 'potato':
            return '[E] Harvest Potato';
        case 'pumpkin':
            return '[E] Harvest Pumpkin';
        case 'hemp':
            return '[E] Harvest Hemp';
        case 'reed':
            return '[E] Harvest Reed';
        case 'dropped_item':
            // Get specific item name if possible
            const droppedItem = droppedItems?.get(String(target.id));
            if (droppedItem) {
                const itemDef = itemDefinitions?.get(String(droppedItem.itemDefId));
                if (itemDef) {
                    return `[E] Pick up ${itemDef.name}`;
                }
            }
            return '[E] Pick up Item';
        case 'campfire':
            const campfire = campfires?.get(String(target.id));
            if (campfire) {
                const status = campfire.isBurning ? 'Lit' : 'Unlit';
                // Calculate total fuel quantity from individual slots
                let totalFuel = 0;
                if (campfire.fuelInstanceId0) totalFuel++;
                if (campfire.fuelInstanceId1) totalFuel++;
                if (campfire.fuelInstanceId2) totalFuel++;
                if (campfire.fuelInstanceId3) totalFuel++;
                if (campfire.fuelInstanceId4) totalFuel++;
                const fuelStatus = totalFuel > 0 ? ` (${totalFuel} fuel)` : ' (no fuel)';
                return `[E] Campfire ${status}${fuelStatus} [Hold E] Toggle`;
            }
            return '[E] Campfire';
        case 'lantern':
            const lantern = lanterns?.get(String(target.id));
            if (lantern) {
                const status = lantern.isBurning ? 'Lit' : 'Unlit';
                // Calculate total fuel quantity from individual slots
                let totalFuel = 0;
                if (lantern.fuelInstanceId0) totalFuel++;
                const fuelStatus = totalFuel > 0 ? ` (${totalFuel} fuel)` : ' (no fuel)';
                return `[E] Lantern ${status}${fuelStatus} [Hold E] Toggle`;
            }
            return '[E] Lantern';
        case 'box':
            const box = woodenStorageBoxes?.get(String(target.id));
            if (box) {
                let hasItems = false;
                for (let i = 0; i < 20; i++) { // Assuming 20 slots
                    const slotKey = `slotInstanceId${i}` as keyof SpacetimeDBWoodenStorageBox;
                    if (box[slotKey] !== null && box[slotKey] !== undefined) {
                        hasItems = true;
                        break;
                    }
                }
                const status = hasItems ? '' : ' (empty)';
                const pickupText = hasItems ? '' : ' [Hold E] Pickup';
                return `[E] Storage Box${status}${pickupText}`;
            }
            return '[E] Storage Box';
        case 'corpse':
            const corpse = playerCorpses?.get(String(target.id));
            if (corpse) {
                return `[E] Player Corpse`;
            }
            return '[E] Corpse';
        case 'stash':
            const stash = stashes?.get(String(target.id));
            if (stash) {
                const visibilityText = stash.isHidden ? ' (hidden)' : ' (visible)';
                const toggleText = ' [Hold E] Toggle';
                return `[E] Stash${visibilityText}${toggleText}`;
            }
            return '[E] Stash';
        case 'sleeping_bag':
            const sleepingBag = sleepingBags?.get(String(target.id));
            if (sleepingBag) {
                // Check if the sleeping bag has an owner field
                const ownerText = ''; // Simplified since we need to check the actual field structure
                return `[E] Sleeping Bag${ownerText}`;
            }
            return '[E] Sleeping Bag';
        case 'knocked_out_player':
            return '[Hold E] Revive Player';
        case 'water':
            return '[Hold E] Drink Water';
        case 'rain_collector':
            return '[E] Manage Rain Collector';
        default:
            return `[E] Interact with ${target.type}`;
    }

    return '';
} 