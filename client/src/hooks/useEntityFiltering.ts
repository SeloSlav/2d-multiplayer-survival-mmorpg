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
  Corn as SpacetimeDBCorn
} from '../generated';
import {
  isPlayer, isTree, isStone, isCampfire, isMushroom, isDroppedItem, isWoodenStorageBox,
  isSleepingBag,
  isCorn
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
  visibleMushroomsMap: Map<string, SpacetimeDBMushroom>;
  visibleCampfiresMap: Map<string, SpacetimeDBCampfire>;
  visibleDroppedItemsMap: Map<string, SpacetimeDBDroppedItem>;
  visibleBoxesMap: Map<string, SpacetimeDBWoodenStorageBox>;
  visibleCornsMap: Map<string, SpacetimeDBCorn>;
  groundItems: (SpacetimeDBMushroom | SpacetimeDBDroppedItem | SpacetimeDBCampfire | SpacetimeDBSleepingBag | SpacetimeDBCorn)[];
  ySortedEntities: (SpacetimeDBPlayer | SpacetimeDBTree | SpacetimeDBStone | SpacetimeDBWoodenStorageBox)[];
}

export function useEntityFiltering(
  players: Map<string, SpacetimeDBPlayer>,
  trees: Map<string, SpacetimeDBTree>,
  stones: Map<string, SpacetimeDBStone>,
  campfires: Map<string, SpacetimeDBCampfire>,
  mushrooms: Map<string, SpacetimeDBMushroom>,
  corns: Map<string, SpacetimeDBCorn>,
  droppedItems: Map<string, SpacetimeDBDroppedItem>,
  woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>,
  sleepingBags: Map<string, SpacetimeDBSleepingBag>,
  cameraOffsetX: number,
  cameraOffsetY: number,
  canvasWidth: number,
  canvasHeight: number
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
    Array.from(mushrooms.values()).filter(e => 
      (e.respawnAt === null || e.respawnAt === undefined) && isEntityInView(e, viewBounds)
    ),
    [mushrooms, isEntityInView, viewBounds]
  );

  const visibleCorns = useMemo(() => 
    Array.from(corns.values()).filter(e => 
      (e.respawnAt === null || e.respawnAt === undefined) && isEntityInView(e, viewBounds)
    ),
    [corns, isEntityInView, viewBounds]
  );

  const visibleDroppedItems = useMemo(() => 
    Array.from(droppedItems.values()).filter(e => isEntityInView(e, viewBounds)),
    [droppedItems, isEntityInView, viewBounds]
  );

  const visibleCampfires = useMemo(() => 
    Array.from(campfires.values()).filter(e => isEntityInView(e, viewBounds)),
    [campfires, isEntityInView, viewBounds]
  );

  const visiblePlayers = useMemo(() => 
    Array.from(players.values()).filter(e => isEntityInView(e, viewBounds)),
    [players, isEntityInView, viewBounds]
  );

  const visibleTrees = useMemo(() => 
    Array.from(trees.values()).filter(e => e.health > 0 && isEntityInView(e, viewBounds)),
    [trees, isEntityInView, viewBounds]
  );

  const visibleStones = useMemo(() => 
    Array.from(stones.values()).filter(e => e.health > 0 && isEntityInView(e, viewBounds)),
    [stones, isEntityInView, viewBounds]
  );

  const visibleWoodenStorageBoxes = useMemo(() => 
    Array.from(woodenStorageBoxes.values()).filter(e => isEntityInView(e, viewBounds)),
    [woodenStorageBoxes, isEntityInView, viewBounds]
  );
  
  const visibleSleepingBags = useMemo(() => 
    Array.from(sleepingBags.values())
      .filter(e => isEntityInView(e, viewBounds))
    ,[sleepingBags, isEntityInView, viewBounds]
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

  // Group entities for rendering
  const groundItems = useMemo(() => [
    ...visibleDroppedItems,
    ...visibleCampfires,
    ...visibleSleepingBags
  ], [visibleDroppedItems, visibleCampfires, visibleSleepingBags]);

  // Y-sorted entities with sorting
  const ySortedEntities = useMemo(() => {
    const entities = [
      ...visiblePlayers,
      ...visibleTrees,
      ...visibleStones.filter(stone => stone.health > 0),
      ...visibleWoodenStorageBoxes
    ];
    entities.sort((a, b) => {
      const yA = isPlayer(a) ? a.positionY : a.posY;
      const yB = isPlayer(b) ? b.positionY : b.posY;
      return yA - yB;
    });
    return entities;
  }, [visiblePlayers, visibleTrees, visibleStones, visibleWoodenStorageBoxes]);

  return {
    visibleMushrooms,
    visibleCorns,
    visibleDroppedItems,
    visibleCampfires,
    visiblePlayers,
    visibleTrees,
    visibleStones,
    visibleWoodenStorageBoxes,
    visibleSleepingBags,
    visibleMushroomsMap,
    visibleCampfiresMap,
    visibleDroppedItemsMap,
    visibleBoxesMap,
    visibleCornsMap,
    groundItems,
    ySortedEntities
  };
} 