import { useMemo, useCallback } from 'react';
import { gameConfig } from '../config/gameConfig';
import {
  Player as SpacetimeDBPlayer,
  Tree as SpacetimeDBTree,
  Stone as SpacetimeDBStone,
  Campfire as SpacetimeDBCampfire,
  Mushroom as SpacetimeDBMushroom,
  DroppedItem as SpacetimeDBDroppedItem,
  WoodenStorageBox as SpacetimeDBWoodenStorageBox,
  SleepingBag as SpacetimeDBSleepingBag,
  Corn as SpacetimeDBCorn,
  Pumpkin as SpacetimeDBPumpkin,
  Hemp as SpacetimeDBHemp,
  PlayerCorpse as SpacetimeDBPlayerCorpse,
  Stash as SpacetimeDBStash,
  Projectile as SpacetimeDBProjectile,
  Shelter as SpacetimeDBShelter,
  // Grass as SpacetimeDBGrass // Will use InterpolatedGrassData instead
} from '../generated';
import {
  isPlayer, isTree, isStone, isCampfire, isMushroom, isDroppedItem, isWoodenStorageBox,
  isSleepingBag,
  isCorn,
  isHemp,
  isStash,
  isPumpkin,
  isPlayerCorpse,
  isGrass, // Type guard might need adjustment or can work if structure is similar enough
  isShelter // ADDED Shelter type guard import (will be created in typeGuards.ts)
} from '../utils/typeGuards';
import { InterpolatedGrassData } from './useGrassInterpolation'; // Import InterpolatedGrassData

interface ViewportBounds {
  viewMinX: number;
  viewMaxX: number;
  viewMinY: number;
  viewMaxY: number;
}

interface EntityFilteringResult {
  visibleMushrooms: SpacetimeDBMushroom[];
  visibleDroppedItems: SpacetimeDBDroppedItem[];
  visibleCampfires: SpacetimeDBCampfire[];
  visiblePlayers: SpacetimeDBPlayer[];
  visibleTrees: SpacetimeDBTree[];
  visibleStones: SpacetimeDBStone[];
  visibleWoodenStorageBoxes: SpacetimeDBWoodenStorageBox[];
  visibleSleepingBags: SpacetimeDBSleepingBag[];
  visibleCorns: SpacetimeDBCorn[];
  visiblePumpkins: SpacetimeDBPumpkin[];
  visibleHemps: SpacetimeDBHemp[];
  visibleProjectiles: SpacetimeDBProjectile[];
  visibleMushroomsMap: Map<string, SpacetimeDBMushroom>;
  visibleCampfiresMap: Map<string, SpacetimeDBCampfire>;
  visibleDroppedItemsMap: Map<string, SpacetimeDBDroppedItem>;
  visibleBoxesMap: Map<string, SpacetimeDBWoodenStorageBox>;
  visibleCornsMap: Map<string, SpacetimeDBCorn>;
  visiblePumpkinsMap: Map<string, SpacetimeDBPumpkin>;
  visibleHempsMap: Map<string, SpacetimeDBHemp>;
  visibleProjectilesMap: Map<string, SpacetimeDBProjectile>;
  visiblePlayerCorpses: SpacetimeDBPlayerCorpse[];
  visiblePlayerCorpsesMap: Map<string, SpacetimeDBPlayerCorpse>;
  visibleStashes: SpacetimeDBStash[];
  visibleStashesMap: Map<string, SpacetimeDBStash>;
  visibleSleepingBagsMap: Map<string, SpacetimeDBSleepingBag>;
  visibleTreesMap: Map<string, SpacetimeDBTree>;
  groundItems: (SpacetimeDBSleepingBag)[];
  ySortedEntities: YSortedEntityType[];
  visibleGrass: InterpolatedGrassData[]; // Use InterpolatedGrassData
  visibleGrassMap: Map<string, InterpolatedGrassData>; // Use InterpolatedGrassData
  visibleShelters: SpacetimeDBShelter[]; // ADDED
  visibleSheltersMap: Map<string, SpacetimeDBShelter>; // ADDED
}

// Define a unified entity type for sorting
export type YSortedEntityType =
  | { type: 'player'; entity: SpacetimeDBPlayer }
  | { type: 'tree'; entity: SpacetimeDBTree }
  | { type: 'stone'; entity: SpacetimeDBStone }
  | { type: 'wooden_storage_box'; entity: SpacetimeDBWoodenStorageBox }
  | { type: 'player_corpse'; entity: SpacetimeDBPlayerCorpse }
  | { type: 'stash'; entity: SpacetimeDBStash }
  | { type: 'corn'; entity: SpacetimeDBCorn }
  | { type: 'hemp'; entity: SpacetimeDBHemp }
  | { type: 'campfire'; entity: SpacetimeDBCampfire }
  | { type: 'dropped_item'; entity: SpacetimeDBDroppedItem }
  | { type: 'mushroom'; entity: SpacetimeDBMushroom }
  | { type: 'pumpkin'; entity: SpacetimeDBPumpkin }
  | { type: 'projectile'; entity: SpacetimeDBProjectile }
  | { type: 'shelter'; entity: SpacetimeDBShelter }
  | { type: 'grass'; entity: InterpolatedGrassData }; // Use InterpolatedGrassData

export function useEntityFiltering(
  players: Map<string, SpacetimeDBPlayer>,
  trees: Map<string, SpacetimeDBTree>,
  stones: Map<string, SpacetimeDBStone>,
  campfires: Map<string, SpacetimeDBCampfire>,
  mushrooms: Map<string, SpacetimeDBMushroom>,
  corns: Map<string, SpacetimeDBCorn>,
  pumpkins: Map<string, SpacetimeDBPumpkin>,
  hemps: Map<string, SpacetimeDBHemp>,
  droppedItems: Map<string, SpacetimeDBDroppedItem>,
  woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>,
  sleepingBags: Map<string, SpacetimeDBSleepingBag>,
  playerCorpses: Map<string, SpacetimeDBPlayerCorpse>,
  stashes: Map<string, SpacetimeDBStash>,
  cameraOffsetX: number,
  cameraOffsetY: number,
  canvasWidth: number,
  canvasHeight: number,
  grass: Map<string, InterpolatedGrassData>, // Use InterpolatedGrassData
  projectiles: Map<string, SpacetimeDBProjectile>,
  shelters: Map<string, SpacetimeDBShelter> // ADDED shelters argument
): EntityFilteringResult {
  // Get consistent timestamp for all projectile calculations in this frame
  const currentTime = Date.now();
  // Removed debug log that was causing excessive console output

  // Calculate viewport bounds
  const getViewportBounds = useCallback((): ViewportBounds => {
    const buffer = gameConfig.tileSize * 2;
    const viewMinX = -cameraOffsetX - buffer;
    const viewMaxX = -cameraOffsetX + canvasWidth + buffer;
    const viewMinY = -cameraOffsetY - buffer;
    const viewMaxY = -cameraOffsetY + canvasHeight + buffer;
    return { viewMinX, viewMaxX, viewMinY, viewMaxY };
  }, [cameraOffsetX, cameraOffsetY, canvasWidth, canvasHeight]);

  // Entity visibility check
  const isEntityInView = useCallback((entity: any, bounds: ViewportBounds, timestamp: number): boolean => {
    let x: number | undefined;
    let y: number | undefined;
    let width: number = gameConfig.tileSize;
    let height: number = gameConfig.tileSize;

    if (isPlayer(entity)) {
      x = entity.positionX;
      y = entity.positionY;
      width = 64; // Approx player size
      height = 64;
    } else if (isTree(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 96; // Approx tree size
      height = 128;
    } else if (isStone(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 64;
      height = 64;
    } else if (isCampfire(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 64;
      height = 64;
    } else if (isMushroom(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 32;
      height = 32;
    } else if (isDroppedItem(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 32;
      height = 32;
    } else if (isWoodenStorageBox(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 64;
      height = 64;
    } else if (isSleepingBag(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 64;
      height = 32;
    } else if (isCorn(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 32;
      height = 48;
    } else if (isPumpkin(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 48;
      height = 48;
    } else if (isHemp(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 32;
      height = 48;
    } else if (isStash(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 32;
      height = 32;
    } else if ((entity as any).startPosX !== undefined && (entity as any).startPosY !== undefined) {
      // Handle projectiles - calculate current position based on time
      const projectile = entity as any;
      const startTime = Number(projectile.startTime.microsSinceUnixEpoch / 1000n);
      const elapsedSeconds = (timestamp - startTime) / 1000.0;
      x = projectile.startPosX + projectile.velocityX * elapsedSeconds;
      y = projectile.startPosY + projectile.velocityY * elapsedSeconds;
      width = 32;
      height = 32;
    } else if (isShelter(entity)) {
      x = entity.posX;
      y = entity.posY;
      width = 384; // Based on SHELTER_RENDER_WIDTH
      height = 384; // Based on SHELTER_RENDER_HEIGHT
    } else if (isGrass(entity)) {
      // After isGrass, entity could be SpacetimeDBGrass or InterpolatedGrassData
      if ('serverPosX' in entity) { // It's InterpolatedGrassData
        x = entity.serverPosX;
        y = entity.serverPosY;
      } else { // It's SpacetimeDBGrass (should ideally not happen if input is always InterpolatedGrassData)
        x = entity.posX;
        y = entity.posY;
      }
      width = 48;
      height = 48;
    } else {
      return false; // Unknown entity type
    }

    if (x === undefined || y === undefined) return false;

    // AABB overlap check
    return (
      x + width / 2 > bounds.viewMinX &&
      x - width / 2 < bounds.viewMaxX &&
      y + height / 2 > bounds.viewMinY &&
      y - height / 2 < bounds.viewMaxY
    );
  }, []);

  // Get viewport bounds
  const viewBounds = useMemo(() => getViewportBounds(), [getViewportBounds]);

  // Filter entities by visibility
  const visibleMushrooms = useMemo(() => 
    // Check source map
    mushrooms ? Array.from(mushrooms.values()).filter(e => 
      (e.respawnAt === null || e.respawnAt === undefined) && isEntityInView(e, viewBounds, currentTime)
    ) : [],
    [mushrooms, isEntityInView, viewBounds, currentTime]
  );

  const visibleCorns = useMemo(() => 
    // Check source map
    corns ? Array.from(corns.values()).filter(e => 
      (e.respawnAt === null || e.respawnAt === undefined) && isEntityInView(e, viewBounds, currentTime)
    ) : [],
    [corns, isEntityInView, viewBounds, currentTime]
  );

  const visiblePumpkins = useMemo(() => 
    // Check source map
    pumpkins ? Array.from(pumpkins.values()).filter(e => 
      (e.respawnAt === null || e.respawnAt === undefined) && isEntityInView(e, viewBounds, currentTime)
    ) : [],
    [pumpkins, isEntityInView, viewBounds, currentTime]
  );

  const visibleDroppedItems = useMemo(() => 
    // Check source map
    droppedItems ? Array.from(droppedItems.values()).filter(e => isEntityInView(e, viewBounds, currentTime))
    : [],
    [droppedItems, isEntityInView, viewBounds, currentTime]
  );

  const visibleCampfires = useMemo(() => 
    // Check source map
    campfires ? Array.from(campfires.values()).filter(e => isEntityInView(e, viewBounds, currentTime))
    : [],
    [campfires, isEntityInView, viewBounds, currentTime]
  );

  const visiblePlayers = useMemo(() => 
    // Check source map
    players ? Array.from(players.values()).filter(e => isEntityInView(e, viewBounds, currentTime))
    : [],
    [players, isEntityInView, viewBounds, currentTime]
  );

  const visibleTrees = useMemo(() => 
    // Check source map
    trees ? Array.from(trees.values()).filter(e => e.health > 0 && isEntityInView(e, viewBounds, currentTime))
    : [],
    [trees, isEntityInView, viewBounds, currentTime]
  );

  const visibleStones = useMemo(() => 
    // Check source map
    stones ? Array.from(stones.values()).filter(e => e.health > 0 && isEntityInView(e, viewBounds, currentTime))
    : [],
    [stones, isEntityInView, viewBounds, currentTime]
  );

  const visibleWoodenStorageBoxes = useMemo(() => 
    // Check source map
    woodenStorageBoxes ? Array.from(woodenStorageBoxes.values()).filter(e => isEntityInView(e, viewBounds, currentTime))
    : [],
    [woodenStorageBoxes, isEntityInView, viewBounds, currentTime]
  );
  
  const visibleSleepingBags = useMemo(() => 
    // Check source map
    sleepingBags ? Array.from(sleepingBags.values())
      .filter(e => isEntityInView(e, viewBounds, currentTime))
      : []
    ,[sleepingBags, isEntityInView, viewBounds, currentTime]
  );

  const visiblePlayerCorpses = useMemo(() => 
    // Add check: If playerCorpses is undefined or null, return empty array
    playerCorpses ? Array.from(playerCorpses.values())
      .filter(e => isEntityInView(e, viewBounds, currentTime))
      : []
    ,[playerCorpses, isEntityInView, viewBounds, currentTime]
  );

  const visibleStashes = useMemo(() => 
    stashes ? Array.from(stashes.values()).filter(e => !e.isHidden && isEntityInView(e, viewBounds, currentTime))
    : [],
    [stashes, isEntityInView, viewBounds, currentTime]
  );

  const visibleHemps = useMemo(() => 
    hemps ? Array.from(hemps.values())
      .filter(e => isEntityInView(e, viewBounds, currentTime) && !e.respawnAt)
      : []
  , [hemps, isEntityInView, viewBounds, currentTime]);

  const visibleProjectiles = useMemo(() => 
    projectiles ? Array.from(projectiles.values()).filter(e => isEntityInView(e, viewBounds, currentTime))
    : [],
    [projectiles, isEntityInView, viewBounds, currentTime]
  );

  const visibleGrass = useMemo(() => 
    grass ? Array.from(grass.values()).filter(e => 
      e.health > 0 && isEntityInView(e, viewBounds, currentTime)
    ) : [],
    [grass, isEntityInView, viewBounds, currentTime]
  ); // grass parameter is now Map<string, InterpolatedGrassData>

  // ADDED: Filter visible shelters
  const visibleShelters = useMemo(() => {
    const filtered = shelters ? Array.from(shelters.values()).filter(e => !e.isDestroyed && isEntityInView(e, viewBounds, currentTime)) : [];
    // console.log('[useEntityFiltering] Filtered visibleShelters count:', filtered.length, filtered); // DEBUG LOG 2
    return filtered;
  }, [shelters, isEntityInView, viewBounds, currentTime]);

  // Create maps from filtered arrays for easier lookup
  const visibleMushroomsMap = useMemo(() => 
    new Map(visibleMushrooms.map(m => [m.id.toString(), m])), 
    [visibleMushrooms]
  );
  
  const visibleCampfiresMap = useMemo(() => 
    new Map(visibleCampfires.map(c => [c.id.toString(), c])), 
    [visibleCampfires]
  );
  
  const visibleDroppedItemsMap = useMemo(() => 
    new Map(visibleDroppedItems.map(i => [i.id.toString(), i])), 
    [visibleDroppedItems]
  );
  
  const visibleBoxesMap = useMemo(() => 
    new Map(visibleWoodenStorageBoxes.map(b => [b.id.toString(), b])), 
    [visibleWoodenStorageBoxes]
  );

  const visibleCornsMap = useMemo(() => 
    new Map(visibleCorns.map(c => [c.id.toString(), c])), 
    [visibleCorns]
  );

  const visiblePumpkinsMap = useMemo(() => 
    new Map(visiblePumpkins.map(p => [p.id.toString(), p])), 
    [visiblePumpkins]
  );

  const visibleHempsMap = useMemo(() => 
    new Map(visibleHemps.map(h => [h.id.toString(), h])), 
    [visibleHemps]
  );

  const visibleProjectilesMap = useMemo(() => 
    new Map(visibleProjectiles.map(p => [p.id.toString(), p])), 
    [visibleProjectiles]
  );

  const visiblePlayerCorpsesMap = useMemo(() => {
    const map = new Map<string, SpacetimeDBPlayerCorpse>();
    visiblePlayerCorpses.forEach(c => map.set(c.id.toString(), c));
    return map;
  }, [visiblePlayerCorpses]);

  const visibleStashesMap = useMemo(() => new Map(visibleStashes.map(st => [st.id.toString(), st])), [visibleStashes]);

  const visibleSleepingBagsMap = useMemo(() => 
    new Map(visibleSleepingBags.map(sl => [sl.id.toString(), sl])), 
    [visibleSleepingBags]
  );

  const visibleTreesMap = useMemo(() => {
    const map = new Map<string, SpacetimeDBTree>();
    visibleTrees.forEach(e => map.set(e.id.toString(), e));
    return map;
  }, [visibleTrees]);

  const visibleGrassMap = useMemo(() => 
    new Map(visibleGrass.map(g => [g.id.toString(), g])),
    [visibleGrass]
  ); // visibleGrass is now InterpolatedGrassData[]

  // ADDED: Map for visible shelters
  const visibleSheltersMap = useMemo(() =>
    new Map(visibleShelters.map(s => [s.id.toString(), s])),
    [visibleShelters]
  );

  // Group entities for rendering
  const groundItems = useMemo(() => [
    ...visibleSleepingBags,
  ], [visibleSleepingBags]);

  // Y-sorted entities with sorting and correct type structure
  const ySortedEntities = useMemo(() => {
    const mappedEntities: YSortedEntityType[] = [
      // Map each entity type to the { type, entity } structure
      ...visiblePlayers.map(p => ({ type: 'player' as const, entity: p })),
      ...visibleTrees.map(t => ({ type: 'tree' as const, entity: t })),
      ...visibleStones.filter(stone => stone.health > 0).map(s => ({ type: 'stone' as const, entity: s })),
      ...visibleWoodenStorageBoxes.map(b => ({ type: 'wooden_storage_box' as const, entity: b })),
      ...visibleStashes.map(st => ({ type: 'stash' as const, entity: st })),
      ...visibleCorns.map(c => ({ type: 'corn' as const, entity: c })),
      ...visibleHemps.map(h => ({ type: 'hemp' as const, entity: h })),
      ...visibleCampfires.map(cf => ({ type: 'campfire' as const, entity: cf })),
      ...visibleDroppedItems.map(di => ({ type: 'dropped_item' as const, entity: di })),
      ...visiblePlayerCorpses.map(c => ({ type: 'player_corpse' as const, entity: c })),
      ...visibleMushrooms.map(m => ({ type: 'mushroom' as const, entity: m })),
      ...visiblePumpkins.map(p => ({ type: 'pumpkin' as const, entity: p })),
      ...visibleProjectiles.map(p => ({ type: 'projectile' as const, entity: p })),
      ...visibleShelters.map(s => ({ type: 'shelter' as const, entity: s })),
      ...visibleGrass.map(g => ({ type: 'grass' as const, entity: g })), // g is InterpolatedGrassData
    ];
    // console.log('[useEntityFiltering] Mapped entities before filtering nulls (shelter portion):', mappedEntities.filter(e => e.type === 'shelter')); // DEBUG LOG 3

    // Filter out any potential null/undefined entries AFTER mapping (just in case)
    const validEntities = mappedEntities.filter(e => e && e.entity);

    const getSortY = (item: YSortedEntityType): number => {
      const entity = item.entity;
      let sortY = 0;

      if (isPlayer(entity)) {
        sortY = entity.positionY;
        return sortY;
      }

      // Explicit handling for Shelter to ensure it uses its base posY
      if (isShelter(entity)) {
        const Y_OFFSET = 120; 
        sortY = entity.posY - Y_OFFSET;
        return sortY;
      }

      if (isCorn(entity) || isHemp(entity) || isDroppedItem(entity)) {
        const Y_OFFSET = 48; 
        sortY = entity.posY - Y_OFFSET;
        return sortY;
      }
 
      if (isCampfire(entity)) { 
        const Y_OFFSET = 78; 
        sortY = entity.posY - Y_OFFSET;
        return sortY;
      }

      if (isGrass(entity)) {
        const Y_OFFSET = 16;
        // entity here is already InterpolatedGrassData due to how ySortedEntities is constructed
        sortY = (entity as InterpolatedGrassData).serverPosY - Y_OFFSET;
        return sortY;
      }

      // Handle projectiles - calculate current Y position
      if ((entity as any).startPosX !== undefined && (entity as any).startPosY !== undefined && (entity as any).velocityY !== undefined) {
        const projectile = entity as any;
        const startTime = Number(projectile.startTime.microsSinceUnixEpoch / 1000n);
        const elapsedSeconds = (currentTime - startTime) / 1000.0;
        sortY = projectile.startPosY + projectile.velocityY * elapsedSeconds;
        return sortY;
      }

      // For other entities, use their standard posY if it exists, otherwise default or handle error.
      // This check is a bit broad, ideally, each type in YSortedEntityType should have a defined posY or equivalent.
      if ('posY' in entity && typeof (entity as any).posY === 'number') {
        sortY = (entity as any).posY;
      } else if ('positionY' in entity && typeof (entity as any).positionY === 'number') { // For Player
        sortY = (entity as any).positionY;
      } else {
        // Fallback for entities that might not have posY directly (e.g. InterpolatedGrassData without serverPosY)
        // or if we hit an unexpected type. For grass, serverPosY is used above.
        // console.warn("Entity type in getSortY does not have a standard posY or positionY property:", entity);
        sortY = 0; // Default sortY if no position found, or handle as an error
      }
      return sortY;
    };

    // Sort the mapped entities using the adjusted Y value
    validEntities.sort((a, b) => {
      const yA = getSortY(a);
      const yB = getSortY(b);
      return yA - yB;
    });

    return validEntities;
  }, [
    visiblePlayers, visibleTrees, visibleStones, visibleWoodenStorageBoxes, 
    visiblePlayerCorpses, visibleStashes, visibleCorns, visibleHemps,
    visibleCampfires, visibleDroppedItems, visibleMushrooms, visiblePumpkins,
    visibleProjectiles, visibleGrass, // visibleGrass is now InterpolatedGrassData[]
    visibleShelters // ADDED visibleShelters to dependencies
  ]);

  return {
    visibleMushrooms,
    visibleCorns,
    visiblePumpkins,
    visibleHemps,
    visibleDroppedItems,
    visibleCampfires,
    visiblePlayers,
    visibleTrees,
    visibleStones,
    visibleWoodenStorageBoxes,
    visibleSleepingBags,
    visiblePlayerCorpses,
    visibleStashes,
    visibleProjectiles,
    visibleMushroomsMap,
    visibleCampfiresMap,
    visibleDroppedItemsMap,
    visibleBoxesMap,
    visibleCornsMap,
    visiblePumpkinsMap,
    visibleHempsMap,
    visibleProjectilesMap,
    visiblePlayerCorpsesMap,
    visibleStashesMap,
    visibleSleepingBagsMap,
    visibleTreesMap,
    groundItems,
    ySortedEntities,
    visibleGrass,
    visibleGrassMap,
    visibleShelters,
    visibleSheltersMap
  };
} 