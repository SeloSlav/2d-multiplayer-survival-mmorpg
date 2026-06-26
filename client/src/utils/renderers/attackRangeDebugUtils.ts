/**
 * Attack Range Debug Rendering Utilities
 * 
 * Renders debug visualization for server-side attack range detection.
 * Shows:
 * - Attack range semicircles (default 144px, spear 192px)
 * - Dashed lines from player to attackable entities
 * - Distance labels showing exact pixel distances
 * - Color-coded indicators (green = in range, yellow = spear range, red = out of range)
 */

import { Player, WoodenStorageBox, Barbecue, Furnace, Tree, Stone, WildAnimal, Barrel, Grass, Campfire, SleepingBag, Stash, ItemDefinition as SpacetimeDBItemDefinition } from '../../generated/types';
import { InterpolatedGrassData } from '../../engine/runtime/grassInterpolationRuntime'; // Merged grass+grassState data
import {
  DEFAULT_MELEE_ARC_DEGREES as DEFAULT_ATTACK_ARC_DEGREES,
  DEFAULT_MELEE_ATTACK_RANGE as DEFAULT_ATTACK_RANGE,
  SCYTHE_MELEE_ARC_DEGREES as SCYTHE_ATTACK_ARC_DEGREES,
  SCYTHE_MELEE_ATTACK_RANGE as SCYTHE_ATTACK_RANGE,
  SPEAR_MELEE_ARC_DEGREES as SPEAR_ATTACK_ARC_DEGREES,
  SPEAR_MELEE_ATTACK_RANGE as SPEAR_ATTACK_RANGE,
} from '../../config/combatConstants';

// Server-side collision offsets (from server combat.rs, campfire.rs, sleeping_bag.rs)
const SERVER_BOX_Y_OFFSET = 52; // BOX_COLLISION_Y_OFFSET
const CAMPFIRE_VISUAL_CENTER_Y_OFFSET = 42; // (CAMPFIRE_HEIGHT/2) + CAMPFIRE_RENDER_Y_OFFSET
const SLEEPING_BAG_COLLISION_Y_OFFSET = 5; // Low profile

// Max distance to render attack lines (performance optimization)
const MAX_RENDER_DISTANCE = 400;

// ===== TYPES =====
export interface AttackRangeDebugEntities {
  woodenStorageBoxes?: Map<string, WoodenStorageBox>;
  barbecues?: Map<string, Barbecue>;
  furnaces?: Map<string, Furnace>;
  campfires?: Map<string, Campfire>;
  sleepingBags?: Map<string, SleepingBag>;
  stashes?: Map<string, Stash>;
  trees?: Map<string, Tree>;
  stones?: Map<string, Stone>;
  wildAnimals?: Map<string, WildAnimal>;
  players?: Map<string, Player>;
  barrels?: Map<string, Barrel>;
  grass?: Map<string, InterpolatedGrassData>; // Merged grass+grassState data
}

export interface AttackRangeDebugOptions {
  playerX: number;
  playerY: number;
  facingDirection: string;
  localPlayerId: string;
  equippedItemDef?: SpacetimeDBItemDefinition | null; // Equipped weapon to show its specific range
}

// ===== HELPER FUNCTIONS =====

/**
 * Converts facing direction string to angle in radians
 * Handles both lowercase ('up', 'down', 'left', 'right') and capitalized ('Up', 'Down', etc.)
 */
function getFacingAngle(facingDir: string): number {
  const dir = facingDir.toLowerCase();
  switch (dir) {
    case 'up': return -Math.PI / 2;
    case 'down': return Math.PI / 2;
    case 'left': return Math.PI;
    case 'right': return 0;
    default: return Math.PI / 2; // Default down
  }
}

/**
 * Draws a label with black background
 */
function drawRangeLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string
): void {
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(text);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillRect(x - metrics.width / 2 - 4, y - 8, metrics.width + 8, 16);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * Gets weapon-specific attack range and arc based on equipped item
 * Must match the logic in equippedItemRenderingUtils.ts getWeaponAttackParams
 */
function getWeaponRangeAndArc(itemDef: SpacetimeDBItemDefinition | null | undefined): { range: number; arcDegrees: number; color: string; label: string } {
  if (!itemDef) {
    return { range: DEFAULT_ATTACK_RANGE, arcDegrees: DEFAULT_ATTACK_ARC_DEGREES, color: 'rgba(255, 69, 0, 0.4)', label: 'Default' };
  }
  
  const name = itemDef.name;
  
  // Scythe - LONGEST range, WIDEST arc
  if (name === 'Scythe') {
    return { range: SCYTHE_ATTACK_RANGE, arcDegrees: SCYTHE_ATTACK_ARC_DEGREES, color: 'rgba(0, 255, 128, 0.4)', label: 'Scythe' };
  }
  
  // Spears - extended range, narrow thrust cone (60°)
  if (name === 'Wooden Spear' || name === 'Stone Spear' || name === 'Reed Harpoon') {
    return { range: SPEAR_ATTACK_RANGE, arcDegrees: SPEAR_ATTACK_ARC_DEGREES, color: 'rgba(255, 200, 0, 0.4)', label: 'Spear' };
  }
  
  // All other weapons/tools use default melee range
  // Use item's custom arc if defined, otherwise default to 90°
  const itemArc = itemDef.attackArcDegrees ?? DEFAULT_ATTACK_ARC_DEGREES;
  return { range: DEFAULT_ATTACK_RANGE, arcDegrees: itemArc, color: 'rgba(255, 69, 0, 0.4)', label: itemDef.name || 'Melee' };
}

/**
 * Draws attack range arc for the currently equipped weapon only
 * The arc changes direction based on player facing direction
 */
function drawAttackRangeSemicircles(
  ctx: CanvasRenderingContext2D,
  playerX: number,
  playerY: number,
  facingAngle: number,
  equippedItemDef?: SpacetimeDBItemDefinition | null
): void {
  // Only show if an item is equipped
  if (!equippedItemDef) {
    return;
  }
  
  // Show attack range for any equipped item
  // getWeaponRangeAndArc will return appropriate defaults for non-weapons
  
  // Get the equipped weapon's specific range and arc
  const equipped = getWeaponRangeAndArc(equippedItemDef);
  const equippedHalfArc = (equipped.arcDegrees / 2) * (Math.PI / 180);
  
  // Draw EQUIPPED weapon's actual attack arc (filled, solid)
  // Arc is centered on the facing angle and extends half-arc on each side
  ctx.save(); // Save context state
  ctx.beginPath();
  ctx.moveTo(playerX, playerY);
  ctx.arc(playerX, playerY, equipped.range, facingAngle - equippedHalfArc, facingAngle + equippedHalfArc);
  ctx.closePath();
  // Use more visible colors
  ctx.fillStyle = equipped.color.replace('0.4', '0.5'); // Slightly more opaque
  ctx.fill();
  ctx.strokeStyle = equipped.color.replace('0.4', '1.0'); // Fully opaque stroke
  ctx.lineWidth = 4; // Thicker line
  ctx.stroke();
  ctx.restore(); // Restore context state
  
  // Draw arc edge lines (from player center to arc endpoints)
  ctx.beginPath();
  ctx.moveTo(playerX, playerY);
  ctx.lineTo(playerX + Math.cos(facingAngle - equippedHalfArc) * equipped.range, 
             playerY + Math.sin(facingAngle - equippedHalfArc) * equipped.range);
  ctx.moveTo(playerX, playerY);
  ctx.lineTo(playerX + Math.cos(facingAngle + equippedHalfArc) * equipped.range, 
             playerY + Math.sin(facingAngle + equippedHalfArc) * equipped.range);
  ctx.strokeStyle = equipped.color.replace('0.4', '0.7');
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw equipped weapon info label (positioned in front of player)
  const labelX = playerX + Math.cos(facingAngle) * (equipped.range + 25);
  const labelY = playerY + Math.sin(facingAngle) * (equipped.range + 25);
  const weaponName = equippedItemDef.name || 'Unknown';
  const labelText = `${weaponName}: ${Math.round(equipped.range)}px, ${equipped.arcDegrees}° arc`;
  drawRangeLabel(ctx, labelText, labelX, labelY, equipped.color.replace('0.4', '1'));
}

/**
 * Draws a dashed line from player to entity with distance label
 * Also checks if target is within attack arc angle (not just distance)
 */
function drawAttackLine(
  ctx: CanvasRenderingContext2D,
  playerX: number,
  playerY: number,
  targetX: number,
  targetY: number,
  equippedRange: number,
  facingAngle?: number,
  equippedHalfArc?: number
): void {
  const dx = targetX - playerX;
  const dy = targetY - playerY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Only draw if reasonably close
  if (dist > MAX_RENDER_DISTANCE) return;

  // Check if in attack range distance-wise
  let inEquippedRange = dist <= equippedRange;
  
  // Also check if target is within attack arc angle (if angle info provided)
  if (facingAngle !== undefined && equippedHalfArc !== undefined && inEquippedRange) {
    const targetAngle = Math.atan2(dy, dx);
    // Normalize angles to [-PI, PI] range
    let angleDiff = targetAngle - facingAngle;
    // Normalize to [-PI, PI]
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    // Check if target is within the attack arc
    inEquippedRange = Math.abs(angleDiff) <= equippedHalfArc;
  }

  // Draw dashed line from player center to target center
  ctx.beginPath();
  ctx.setLineDash([6, 4]);
  ctx.moveTo(playerX, playerY);
  ctx.lineTo(targetX, targetY);

  // Color based ONLY on equipped weapon's range
  if (inEquippedRange) {
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)'; // Green if within equipped weapon's range
  } else {
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)'; // Red if out of equipped weapon's range
  }
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw target point marker (server uses center for distance check)
  ctx.beginPath();
  ctx.arc(targetX, targetY, 6, 0, Math.PI * 2);
  ctx.fillStyle = inEquippedRange ? 'rgba(0, 255, 0, 0.9)' : 'rgba(255, 0, 0, 0.8)';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw distance label at midpoint
  const midX = (playerX + targetX) / 2;
  const midY = (playerY + targetY) / 2;
  const distText = `${Math.round(dist)}px`;
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(distText);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.fillRect(midX - metrics.width / 2 - 3, midY - 7, metrics.width + 6, 14);
  ctx.fillStyle = inEquippedRange ? '#00ff00' : '#ff6666'; // Green if in range, red if out
  ctx.fillText(distText, midX, midY);
}

// ===== MAIN RENDER FUNCTION =====

/**
 * Renders the attack range debug overlay
 * Shows server-side attack detection ranges and distances to nearby entities
 * Only shows the currently equipped weapon's attack range arc
 */
export function renderAttackRangeDebug(
  ctx: CanvasRenderingContext2D,
  options: AttackRangeDebugOptions,
  entities: AttackRangeDebugEntities
): void {
  const { playerX, playerY, facingDirection, localPlayerId, equippedItemDef } = options;
  const { woodenStorageBoxes, barbecues, furnaces, campfires, sleepingBags, stashes, trees, stones, wildAnimals, players, barrels, grass } = entities;

  // Only render if an item is equipped
  if (!equippedItemDef) {
    return;
  }
  
  // Show attack range for any equipped item (getWeaponRangeAndArc will handle determining range)
  // This way we can see attack range even for tools or other items that might have attack capabilities

  const facingAngle = getFacingAngle(facingDirection);
  
  // Get equipped weapon's range and arc for attack line coloring
  const equipped = getWeaponRangeAndArc(equippedItemDef);
  const equippedRange = equipped.range;
  const equippedHalfArc = (equipped.arcDegrees / 2) * (Math.PI / 180);

  // Draw attack range arc (shows ONLY the equipped weapon's arc, oriented by player direction)
  drawAttackRangeSemicircles(ctx, playerX, playerY, facingAngle, equippedItemDef);

  // Draw attack lines to wooden storage boxes
  if (woodenStorageBoxes) {
    woodenStorageBoxes.forEach((box) => {
      if (box.isDestroyed) return;
      // Server uses: target_y = box.pos_y - BOX_COLLISION_Y_OFFSET
      const targetY = box.posY - SERVER_BOX_Y_OFFSET;
      drawAttackLine(ctx, playerX, playerY, box.posX, targetY, equippedRange, facingAngle, equippedHalfArc);
    });
  }

  // Draw attack lines to barbecues
  if (barbecues) {
    barbecues.forEach((bbq) => {
      if (bbq.isDestroyed) return;
      // Barbecues use same Y offset pattern
      const targetY = bbq.posY - SERVER_BOX_Y_OFFSET;
      drawAttackLine(ctx, playerX, playerY, bbq.posX, targetY, equippedRange, facingAngle, equippedHalfArc);
    });
  }

  // Draw attack lines to furnaces
  if (furnaces) {
    furnaces.forEach((furnace) => {
      if (furnace.isDestroyed) return;
      const targetY = furnace.posY - SERVER_BOX_Y_OFFSET;
      drawAttackLine(ctx, playerX, playerY, furnace.posX, targetY, equippedRange, facingAngle, equippedHalfArc);
    });
  }

  // Draw attack lines to campfires (server uses visual center for targeting)
  if (campfires) {
    campfires.forEach((campfire) => {
      if (campfire.isDestroyed) return;
      const targetY = campfire.posY - CAMPFIRE_VISUAL_CENTER_Y_OFFSET;
      drawAttackLine(ctx, playerX, playerY, campfire.posX, targetY, equippedRange, facingAngle, equippedHalfArc);
    });
  }

  // Draw attack lines to sleeping bags
  if (sleepingBags) {
    sleepingBags.forEach((bag) => {
      if (bag.isDestroyed) return;
      const targetY = bag.posY - SLEEPING_BAG_COLLISION_Y_OFFSET;
      drawAttackLine(ctx, playerX, playerY, bag.posX, targetY, equippedRange, facingAngle, equippedHalfArc);
    });
  }

  // Draw attack lines to stashes (server uses pos directly, no Y offset)
  if (stashes) {
    stashes.forEach((stash) => {
      if (stash.isDestroyed || stash.isHidden) return;
      drawAttackLine(ctx, playerX, playerY, stash.posX, stash.posY, equippedRange, facingAngle, equippedHalfArc);
    });
  }

  // Draw attack lines to trees
  if (trees) {
    trees.forEach((tree) => {
      if (tree.respawnAt && tree.respawnAt.microsSinceUnixEpoch !== 0n) return;
      drawAttackLine(ctx, playerX, playerY, tree.posX, tree.posY, equippedRange, facingAngle, equippedHalfArc);
    });
  }

  // Draw attack lines to stones
  if (stones) {
    stones.forEach((stone) => {
      if (stone.respawnAt && stone.respawnAt.microsSinceUnixEpoch !== 0n) return;
      drawAttackLine(ctx, playerX, playerY, stone.posX, stone.posY, equippedRange, facingAngle, equippedHalfArc);
    });
  }

  // Draw attack lines to wild animals
  if (wildAnimals) {
    wildAnimals.forEach((animal) => {
      if (animal.health <= 0) return;
      drawAttackLine(ctx, playerX, playerY, animal.posX, animal.posY, equippedRange, facingAngle, equippedHalfArc);
    });
  }

  // Draw attack lines to other players
  if (players) {
    players.forEach((otherPlayer, id) => {
      if (id === localPlayerId) return; // Skip self
      if (!otherPlayer.isOnline) return;
      drawAttackLine(ctx, playerX, playerY, otherPlayer.positionX, otherPlayer.positionY, equippedRange, facingAngle, equippedHalfArc);
    });
  }

  // Draw attack lines to barrels
  if (barrels) {
    barrels.forEach((barrel) => {
      if (barrel.respawnAt && barrel.respawnAt.microsSinceUnixEpoch !== 0n) return; // Skip destroyed/respawning barrels
      drawAttackLine(ctx, playerX, playerY, barrel.posX, barrel.posY, equippedRange, facingAngle, equippedHalfArc);
    });
  }

  // Draw attack lines to grass (uses merged InterpolatedGrassData)
  if (grass) {
    grass.forEach((grassEntity) => {
      // Skip respawning grass (respawnAt !== null && microsSinceUnixEpoch !== 0)
      if (grassEntity.respawnAt && (grassEntity.respawnAt as any).microsSinceUnixEpoch !== 0n) return;
      // InterpolatedGrassData has posX/posY from merged data
      const grassX = grassEntity.posX;
      const grassY = grassEntity.posY;
      drawAttackLine(ctx, playerX, playerY, grassX, grassY, equippedRange, facingAngle, equippedHalfArc);
    });
  }
}
