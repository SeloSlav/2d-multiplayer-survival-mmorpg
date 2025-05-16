import {
    Player as SpacetimeDBPlayer,
    Tree as SpacetimeDBTree,
    Stone as SpacetimeDBStone,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    SleepingBag as SpacetimeDBSleepingBag,
    ActiveConnection,
    ActiveEquipment as SpacetimeDBActiveEquipment,
    ItemDefinition as SpacetimeDBItemDefinition,
    Stash as SpacetimeDBStash,
    DroppedItem as SpacetimeDBDroppedItem,
    Campfire as SpacetimeDBCampfire,
    PlayerCorpse,
    ActiveConsumableEffect
} from '../../generated';
import { PlayerCorpse as SpacetimeDBPlayerCorpse } from '../../generated/player_corpse_type';
// Import individual rendering functions
import { renderTree } from './treeRenderingUtils';
import { renderStone } from './stoneRenderingUtils';
import { renderWoodenStorageBox } from './woodenStorageBoxRenderingUtils';
import { renderEquippedItem } from './equippedItemRenderingUtils';
// Import the extracted player renderer
import { renderPlayer, isPlayerHovered } from './playerRenderingUtils';

// Type alias for Y-sortable entities
import { YSortedEntityType } from '../../hooks/useEntityFiltering';

interface RenderYSortedEntitiesProps {
    ctx: CanvasRenderingContext2D;
    ySortedEntities: YSortedEntityType[];
    heroImageRef: React.RefObject<HTMLImageElement | null>;
    lastPositionsRef: React.RefObject<Map<string, { x: number; y: number }>>;
    activeConnections: Map<string, ActiveConnection> | undefined;
    activeEquipments: Map<string, SpacetimeDBActiveEquipment>;
    activeConsumableEffects: Map<string, ActiveConsumableEffect>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
    worldMouseX: number | null;
    worldMouseY: number | null;
    localPlayerId?: string;
    animationFrame: number;
    nowMs: number;
    hoveredPlayerIds: Set<string>;
    onPlayerHover: (identity: string, hover: boolean) => void;
    cycleProgress: number;
    renderPlayerCorpse: (props: { 
        ctx: CanvasRenderingContext2D; 
        corpse: SpacetimeDBPlayerCorpse; 
        nowMs: number; 
        itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
    }) => void;
}

/**
 * Renders entities that need to be sorted by their Y-coordinate for correct overlapping.
 */
export const renderYSortedEntities = ({
    ctx,
    ySortedEntities,
    heroImageRef,
    lastPositionsRef,
    activeConnections,
    activeEquipments,
    activeConsumableEffects,
    itemDefinitions,
    itemImagesRef,
    worldMouseX,
    worldMouseY,
    localPlayerId,
    animationFrame,
    nowMs,
    hoveredPlayerIds,
    onPlayerHover,
    cycleProgress,
    renderPlayerCorpse: renderCorpse,
}: RenderYSortedEntitiesProps) => {

    // First Pass: Render all entities. Trees and stones will skip their dynamic ground shadows.
    // Other entities (players, boxes, etc.) render as normal.
    ySortedEntities.forEach(({ type, entity }) => {
        if (type === 'player') {
            const player = entity as SpacetimeDBPlayer;
            const playerId = player.identity.toHexString();
           const lastPos = lastPositionsRef.current.get(playerId);
           let isPlayerMoving = false;
           if (lastPos) {
                const dx = Math.abs(player.positionX - lastPos.x);
                const dy = Math.abs(player.positionY - lastPos.y);
                if (dx > 0.1 || dy > 0.1) {
               isPlayerMoving = true;
             }
           }
            lastPositionsRef.current.set(playerId, { x: player.positionX, y: player.positionY });

           let jumpOffset = 0;
            const jumpStartTime = player.jumpStartTimeMs;
           if (jumpStartTime > 0) {
               const elapsedJumpTime = nowMs - Number(jumpStartTime);
                if (elapsedJumpTime < 500) { 
                    const t = elapsedJumpTime / 500;
                    jumpOffset = Math.sin(t * Math.PI) * 50;
               }
           }
           
            const currentlyHovered = isPlayerHovered(worldMouseX, worldMouseY, player);
           const isPersistentlyHovered = hoveredPlayerIds.has(playerId);
           
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

            if (player.direction === 'left' || player.direction === 'up') {
              if (canRenderItem && equipment) {
                    renderEquippedItem(ctx, player, equipment, itemDef!, itemImg!, nowMs, jumpOffset, itemImagesRef.current, activeConsumableEffects, localPlayerId);
              }
              if (heroImg) {
                renderPlayer(
                        ctx, player, heroImg, isOnline, 
                        isPlayerMoving, 
                        currentlyHovered,
                  animationFrame, 
                  nowMs, 
                  jumpOffset,
                  isPersistentlyHovered,
                  activeConsumableEffects,
                  localPlayerId
                );
              }
              if (canRenderItem && equipment) {
                    renderEquippedItem(ctx, player, equipment, itemDef!, itemImg!, nowMs, jumpOffset, itemImagesRef.current, activeConsumableEffects, localPlayerId);
              }
           } else {
              if (heroImg) {
                renderPlayer(
                        ctx, player, heroImg, isOnline, 
                        isPlayerMoving, 
                        currentlyHovered,
                  animationFrame, 
                  nowMs, 
                  jumpOffset,
                  isPersistentlyHovered,
                  activeConsumableEffects,
                  localPlayerId
                );
              }
              if (canRenderItem && equipment) {
                    renderEquippedItem(ctx, player, equipment, itemDef!, itemImg!, nowMs, jumpOffset, itemImagesRef.current, activeConsumableEffects, localPlayerId);
              }
           }
        } else if (type === 'tree') {
            // Render tree, skip its dynamic shadow in this pass
            renderTree(ctx, entity as SpacetimeDBTree, nowMs, cycleProgress, false, true);
        } else if (type === 'stone') {
            // Render stone, skip its dynamic shadow in this pass
            renderStone(ctx, entity as SpacetimeDBStone, nowMs, cycleProgress, false, true);
        } else if (type === 'wooden_storage_box') {
            // Render box normally, its applyStandardDropShadow will handle the shadow
            renderWoodenStorageBox(ctx, entity as SpacetimeDBWoodenStorageBox, nowMs, cycleProgress);
        } else if (type === 'player_corpse') {
            renderCorpse({ 
                ctx, 
                corpse: entity as SpacetimeDBPlayerCorpse, 
                nowMs, 
                itemImagesRef
            });
        } else {
            console.warn('Unhandled entity type for Y-sorting (first pass):', type, entity);
        } 
    });

    // Second Pass: Render ONLY the dynamic ground shadows for trees and stones.
    // These will be drawn on top of the entities rendered in the first pass.
    // MODIFIED: Tree shadows are now drawn in GameCanvas.tsx *before* this function runs.
    // So, this pass will now only handle stone shadows (and other entities if they get a similar treatment).
    ySortedEntities.forEach(({ type, entity }) => {
        if (type === 'tree') {
            // Tree shadows are already rendered in GameCanvas.tsx, so skip here.
        } else if (type === 'stone') {
            renderStone(ctx, entity as SpacetimeDBStone, nowMs, cycleProgress, true, false);
        } else if (type === 'wooden_storage_box') {
            // No shadow-only pass needed for wooden_storage_box as it uses applyStandardDropShadow
            // renderWoodenStorageBox(ctx, entity as SpacetimeDBWoodenStorageBox, nowMs, cycleProgress, true, false);
        } else if (type === 'player_corpse') {
            renderCorpse({ 
                ctx, 
                corpse: entity as SpacetimeDBPlayerCorpse, 
                nowMs, 
                itemImagesRef
            });
        } else if (type === 'player') {
            // Players are fully rendered in the first pass, including their shadows.
            // No action needed for players in this second (shadow-only) pass.
        } else {
            console.warn('Unhandled entity type for Y-sorting (second pass):', type, entity);
        }
    });
}; 