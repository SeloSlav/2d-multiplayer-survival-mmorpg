/** Narrow presentation-facing fields shared by the existing server row families. */
export interface PresentationEntity {
  identity?: unknown;
  placedBy?: unknown;
  imagePath?: string; partType?: string; monumentType?: unknown; rotationRad?: number; collisionRadius?: number; isCenter?: boolean;
  itemDefId?: bigint|number; quantity?: number;
  positionX?: number; positionY?: number; posX?: number; posY?: number; worldX?: number; worldY?: number; worldPosX?: number; worldPosY?: number;
  stationId?: number; isActive?: boolean;
  explosiveType?: unknown; isDud?: boolean; blastRadius?: number; fuseDurationSecs?: number;
  armedAt?: { microsSinceUnixEpoch: bigint }; detonatesAt?: { microsSinceUnixEpoch: bigint };
  cellX?: number; cellY?: number; edge?: number; tier?: number; variant?: number;
  shape?: number; boxType?: number;
  foundationShape?: number; doorType?: number; furnaceType?: number; lanternType?: number; terrainVariant?: number;
  isOpen?: boolean; isCooking?: boolean; isMonument?: boolean;
  waterLevelMl?: number; maxWaterCapacityMl?: number;
  health?: number; isDestroyed?: boolean; isDead?: boolean; isKnockedOut?: boolean;
  respawnAt?: { microsSinceUnixEpoch: bigint };
  isSprinting?: boolean; isCrouching?: boolean; isOnWater?: boolean; isFlying?: boolean; isBurning?: boolean; isAimingThrow?: boolean;
  isTorchLit?: boolean; isSnorkeling?: boolean; isSubmerged?: boolean; isNpc?: boolean;
  direction?: string; facingDirection?: string; directionX?: number; directionY?: number;
  treeType?: unknown; oreType?: unknown; species?: unknown; plantType?: unknown; tileType?: unknown; state?: unknown;
  animalSpecies?: unknown; runeType?: unknown; columnType?: unknown; loreId?: string;
  targetPlayerId?: unknown; investigationX?: number; investigationY?: number; stateChangeTime?: { microsSinceUnixEpoch: bigint };
  animalId?: bigint | number; scale?: number; rotation?: number;
  lastAttackTime?: { microsSinceUnixEpoch: bigint }; lastHitTime?: { microsSinceUnixEpoch: bigint };
  deathTime?: { microsSinceUnixEpoch: bigint }; shockActiveUntil?: { microsSinceUnixEpoch: bigint };
  deathTimestamp?: { microsSinceUnixEpoch: bigint }; knockedOutAt?: { microsSinceUnixEpoch: bigint }; lastConsumedAt?: { microsSinceUnixEpoch: bigint };
  playerId?: unknown; playerIdentity?: unknown; effectType?: unknown; itemName?: string;
  startedAt?: { microsSinceUnixEpoch: bigint }; endsAt?: { microsSinceUnixEpoch: bigint };
  castTime?: { microsSinceUnixEpoch: bigint }; targetX?: number; targetY?: number; fishingRod?: string; hasBite?: boolean;
  equippedItemDefId?: bigint | number; iconAssetName?: string; name?: string;
  swingStartTimeMs?: bigint | number; jumpStartTimeMs?: bigint | number;
  loadedAmmoCount?: number; isReadyToFire?: boolean; reloadStartTimeMs?: bigint | number;
  attackIntervalSecs?: number;
  reloadTimeSecs?: number; magazineReloadTimeSecs?: number;
  cycleProgress?: number;
}
