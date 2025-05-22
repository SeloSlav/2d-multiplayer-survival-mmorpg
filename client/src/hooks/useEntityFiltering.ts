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
  Grass as SpacetimeDBGrass
} from '../generated';
import {
  isPlayer, isTree, isStone, isCampfire, isMushroom, isDroppedItem, isWoodenStorageBox,
  isSleepingBag,
  isCorn,
  isHemp,
  isStash,
  isPumpkin,
  isPlayerCorpse,
  isGrass
} from '../utils/typeGuards';

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
  visibleMushroomsMap: Map<string, SpacetimeDBMushroom>;
  visibleCampfiresMap: Map<string, SpacetimeDBCampfire>;
  visibleDroppedItemsMap: Map<string, SpacetimeDBDroppedItem>;
  visibleBoxesMap: Map<string, SpacetimeDBWoodenStorageBox>;
  visibleCornsMap: Map<string, SpacetimeDBCorn>;
  visiblePumpkinsMap: Map<string, SpacetimeDBPumpkin>;
  visibleHempsMap: Map<string, SpacetimeDBHemp>;
  visiblePlayerCorpses: SpacetimeDBPlayerCorpse[];
  visiblePlayerCorpsesMap: Map<string, SpacetimeDBPlayerCorpse>;
  visibleStashes: SpacetimeDBStash[];
  visibleStashesMap: Map<string, SpacetimeDBStash>;
  visibleSleepingBagsMap: Map<string, SpacetimeDBSleepingBag>;
  visibleTreesMap: Map<string, SpacetimeDBTree>;
  groundItems: (SpacetimeDBSleepingBag)[];
  ySortedEntities: YSortedEntityType[];
  visibleGrass: SpacetimeDBGrass[];
  visibleGrassMap: Map<string, SpacetimeDBGrass>;
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
  | { type: 'grass'; entity: SpacetimeDBGrass };

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
  grass: Map<string, SpacetimeDBGrass>
): EntityFilteringResult {
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
  const isEntityInView = useCallback((entity: any, bounds: ViewportBounds): boolean => {
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
    } else if (isGrass(entity)) {
      x = entity.posX;
      y = entity.posY;
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
      (e.respawnAt === null || e.respawnAt === undefined) && isEntityInView(e, viewBounds)
    ) : [],
    [mushrooms, isEntityInView, viewBounds]
  );

  const visibleCorns = useMemo(() => 
    // Check source map
    corns ? Array.from(corns.values()).filter(e => 
      (e.respawnAt === null || e.respawnAt === undefined) && isEntityInView(e, viewBounds)
    ) : [],
    [corns, isEntityInView, viewBounds]
  );

  const visiblePumpkins = useMemo(() => 
    // Check source map
    pumpkins ? Array.from(pumpkins.values()).filter(e => 
      (e.respawnAt === null || e.respawnAt === undefined) && isEntityInView(e, viewBounds)
    ) : [],
    [pumpkins, isEntityInView, viewBounds]
  );

  const visibleDroppedItems = useMemo(() => 
    // Check source map
    droppedItems ? Array.from(droppedItems.values()).filter(e => isEntityInView(e, viewBounds))
    : [],
    [droppedItems, isEntityInView, viewBounds]
  );

  const visibleCampfires = useMemo(() => 
    // Check source map
    campfires ? Array.from(campfires.values()).filter(e => isEntityInView(e, viewBounds))
    : [],
    [campfires, isEntityInView, viewBounds]
  );

  const visiblePlayers = useMemo(() => 
    // Check source map
    players ? Array.from(players.values()).filter(e => isEntityInView(e, viewBounds))
    : [],
    [players, isEntityInView, viewBounds]
  );

  const visibleTrees = useMemo(() => 
    // Check source map
    trees ? Array.from(trees.values()).filter(e => e.health > 0 && isEntityInView(e, viewBounds))
    : [],
    [trees, isEntityInView, viewBounds]
  );

  const visibleStones = useMemo(() => 
    // Check source map
    stones ? Array.from(stones.values()).filter(e => e.health > 0 && isEntityInView(e, viewBounds))
    : [],
    [stones, isEntityInView, viewBounds]
  );

  const visibleWoodenStorageBoxes = useMemo(() => 
    // Check source map
    woodenStorageBoxes ? Array.from(woodenStorageBoxes.values()).filter(e => isEntityInView(e, viewBounds))
    : [],
    [woodenStorageBoxes, isEntityInView, viewBounds]
  );
  
  const visibleSleepingBags = useMemo(() => 
    // Check source map
    sleepingBags ? Array.from(sleepingBags.values())
      .filter(e => isEntityInView(e, viewBounds))
      : []
    ,[sleepingBags, isEntityInView, viewBounds]
  );

  const visiblePlayerCorpses = useMemo(() => 
    // Add check: If playerCorpses is undefined or null, return empty array
    playerCorpses ? Array.from(playerCorpses.values())
      .filter(e => isEntityInView(e, viewBounds))
      : []
    ,[playerCorpses, isEntityInView, viewBounds]
  );

  const visibleStashes = useMemo(() => 
    stashes ? Array.from(stashes.values()).filter(e => !e.isHidden && isEntityInView(e, viewBounds))
    : [],
    [stashes, isEntityInView, viewBounds]
  );

  const visibleHemps = useMemo(() => 
    hemps ? Array.from(hemps.values())
      .filter(e => isEntityInView(e, viewBounds) && !e.respawnAt)
      : []
  , [hemps, isEntityInView, viewBounds]);

  const visibleGrass = useMemo(() => 
    grass ? Array.from(grass.values()).filter(e => 
      e.health > 0 && isEntityInView(e, viewBounds)
    ) : [],
    [grass, isEntityInView, viewBounds]
  );

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
      ...visibleGrass.map(g => ({ type: 'grass' as const, entity: g })),
    ];

    // Filter out any potential null/undefined entries AFTER mapping (just in case)
    const validEntities = mappedEntities.filter(e => e && e.entity);

    const getSortY = (item: YSortedEntityType): number => {
      const entity = item.entity;
      let sortY = 0;

      if (isPlayer(entity)) {
        sortY = entity.positionY;
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
        sortY = entity.posY - Y_OFFSET;
        return sortY;
      }

      // For other entities, use their standard posY.
      // This includes Tree, Stone, WoodenStorageBox, Mushroom, Pumpkin
      sortY = entity.posY;
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
    visibleGrass
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
    visibleMushroomsMap,
    visibleCampfiresMap,
    visibleDroppedItemsMap,
    visibleBoxesMap,
    visibleCornsMap,
    visiblePumpkinsMap,
    visibleHempsMap,
    visiblePlayerCorpsesMap,
    visibleStashesMap,
    visibleSleepingBagsMap,
    visibleTreesMap,
    groundItems,
    ySortedEntities,
    visibleGrass,
    visibleGrassMap
  };
} 