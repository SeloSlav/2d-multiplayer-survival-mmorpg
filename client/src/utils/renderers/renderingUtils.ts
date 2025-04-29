import {
    Tree as SpacetimeDBTree,
    Stone as SpacetimeDBStone,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    ItemDefinition as SpacetimeDBItemDefinition,
} from '../../generated';
import * as SpacetimeDB from '../../generated';
import {
    isPlayer, isTree, isStone, isWoodenStorageBox,
} from '../typeGuards';
// Import individual rendering functions
import { renderTree } from './treeRenderingUtils';
import { renderStone } from './stoneRenderingUtils';
import { renderWoodenStorageBox } from './woodenStorageBoxRenderingUtils';
import { renderEquippedItem } from './equippedItemRenderingUtils';
// Import specific constants from gameConfig
import {
    MOVEMENT_POSITION_THRESHOLD,
    JUMP_DURATION_MS,
    JUMP_HEIGHT_PX,
} from '../../config/gameConfig';

// Import the extracted player renderer
import { renderPlayer, isPlayerHovered } from './playerRenderingUtils';

// Type alias for Y-sortable entities
import { Player as SpacetimeDBPlayer } from '../../generated';
type YSortableEntity = SpacetimeDBPlayer | SpacetimeDBTree | SpacetimeDBStone | SpacetimeDBWoodenStorageBox;

interface RenderYSortedEntitiesProps {
    ctx: CanvasRenderingContext2D;
    ySortedEntities: YSortableEntity[];
    heroImageRef: React.RefObject<HTMLImageElement | null>;
    lastPositionsRef: React.MutableRefObject<Map<string, { x: number; y: number; }>>;
    activeConnections: Map<string, SpacetimeDB.ActiveConnection> | undefined;
    activeEquipments: Map<string, SpacetimeDB.ActiveEquipment>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    itemImagesRef: React.MutableRefObject<Map<string, HTMLImageElement>>;
    worldMouseX: number | null;
    worldMouseY: number | null;
    animationFrame: number;
    nowMs: number;
    hoveredPlayerIds?: Set<string>;
    onPlayerHover?: (playerId: string, isHovered: boolean) => void;
}

/**
 * Renders entities that need to be sorted by their Y-coordinate to create
 * a sense of depth (Players, Trees, Stones, Storage Boxes).
 * Assumes the `ySortedEntities` array is already sorted.
 */
export const renderYSortedEntities = ({
    ctx,
    ySortedEntities,
    heroImageRef,
    lastPositionsRef,
    activeConnections,
    activeEquipments,
    itemDefinitions,
    itemImagesRef,
    worldMouseX,
    worldMouseY,
    animationFrame,
    nowMs,
    hoveredPlayerIds = new Set(),
    onPlayerHover = () => {},
}: RenderYSortedEntitiesProps) => {

    ySortedEntities.forEach(entity => {
        if (isPlayer(entity)) {
           const playerId = entity.identity.toHexString();
           const lastPos = lastPositionsRef.current.get(playerId);
           let isPlayerMoving = false;
           if (lastPos) {
             const dx = Math.abs(entity.positionX - lastPos.x);
             const dy = Math.abs(entity.positionY - lastPos.y);
             if (dx > MOVEMENT_POSITION_THRESHOLD || dy > MOVEMENT_POSITION_THRESHOLD) { 
               isPlayerMoving = true;
             }
           } else {
             isPlayerMoving = false;
           }
           lastPositionsRef.current.set(playerId, { x: entity.positionX, y: entity.positionY });

           let jumpOffset = 0;
           const jumpStartTime = entity.jumpStartTimeMs;
           if (jumpStartTime > 0) {
               const elapsedJumpTime = nowMs - Number(jumpStartTime);
               if (elapsedJumpTime < JUMP_DURATION_MS) { 
                   const d = JUMP_DURATION_MS;
                   const h = JUMP_HEIGHT_PX;
                   const x = elapsedJumpTime;
                   jumpOffset = (-4 * h / (d * d)) * x * (x - d);
               }
           }
           
           const currentlyHovered = isPlayerHovered(worldMouseX, worldMouseY, entity);
           const isPersistentlyHovered = hoveredPlayerIds.has(playerId);
           
           if ((worldMouseX !== null && worldMouseY !== null && currentlyHovered !== isPersistentlyHovered) || 
               (worldMouseX === null && worldMouseY === null && isPersistentlyHovered)) {
             const newHoverState = (worldMouseX === null || worldMouseY === null) ? false : currentlyHovered;
             onPlayerHover(playerId, newHoverState);
           }
           
           const heroImg = heroImageRef.current;
           const isOnline = activeConnections ? activeConnections.has(playerId) : false;

           const equipment = activeEquipments.get(playerId);
           let itemDef: SpacetimeDBItemDefinition | null = null;
           let itemImg: HTMLImageElement | null = null;

           if (equipment && equipment.equippedItemDefId) {
             itemDef = itemDefinitions.get(equipment.equippedItemDefId.toString()) || null;
             itemImg = (itemDef ? itemImagesRef.current.get(itemDef.iconAssetName) : null) || null;
           }
           const canRenderItem = itemDef && itemImg && itemImg.complete && itemImg.naturalHeight !== 0;

           if (entity.direction === 'left' || entity.direction === 'up') {
              if (canRenderItem && equipment) {
                renderEquippedItem(ctx, entity, equipment, itemDef!, itemImg!, nowMs, jumpOffset);
              }
              if (heroImg) {
                renderPlayer(
                  ctx, entity, heroImg, isOnline, 
                  isPlayerMoving, currentlyHovered, 
                  animationFrame, nowMs, jumpOffset, 
                  isPersistentlyHovered
                );
              }
           } else { 
              if (heroImg) {
                renderPlayer(
                  ctx, entity, heroImg, isOnline, 
                  isPlayerMoving, currentlyHovered, 
                  animationFrame, nowMs, jumpOffset, 
                  isPersistentlyHovered
                );
              }
              if (canRenderItem && equipment) {
                renderEquippedItem(ctx, entity, equipment, itemDef!, itemImg!, nowMs, jumpOffset);
              }
           }
        } else if (isTree(entity)) { 
           renderTree(ctx, entity, nowMs);
        } else if (isStone(entity)) { 
           renderStone(ctx, entity, nowMs);
        } else if (isWoodenStorageBox(entity)) {
            renderWoodenStorageBox(ctx, entity, nowMs);
        } 
    });
}; 