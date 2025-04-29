import {
    Player as SpacetimeDBPlayer,
    Tree as SpacetimeDBTree,
    Stone as SpacetimeDBStone,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    SleepingBag as SpacetimeDBSleepingBag,
    ActiveConnection,
    ActiveEquipment as SpacetimeDBActiveEquipment,
    ItemDefinition as SpacetimeDBItemDefinition,
} from '../../generated';
import { PlayerCorpse as SpacetimeDBPlayerCorpse } from '../../generated/player_corpse_type';
import * as SpacetimeDB from '../../generated';
import {
    isPlayer, isTree, isStone, isWoodenStorageBox,
} from '../typeGuards';
// Import individual rendering functions
import { renderTree } from './treeRenderingUtils';
import { renderStone } from './stoneRenderingUtils';
import { renderWoodenStorageBox } from './woodenStorageBoxRenderingUtils';
import { renderEquippedItem } from './equippedItemRenderingUtils';
import { renderSleepingBag } from './sleepingBagRenderingUtils';
import { renderPlayerCorpse } from './playerCorpseRenderingUtils';
// Import specific constants from gameConfig
import {
    MOVEMENT_POSITION_THRESHOLD,
    JUMP_DURATION_MS,
    JUMP_HEIGHT_PX,
} from '../../config/gameConfig';

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
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
    worldMouseX: number | null;
    worldMouseY: number | null;
    animationFrame: number;
    nowMs: number;
    hoveredPlayerIds: Set<string>;
    onPlayerHover: (identity: string, hover: boolean) => void;
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
    itemDefinitions,
    itemImagesRef,
    worldMouseX,
    worldMouseY,
    animationFrame,
    nowMs,
    hoveredPlayerIds,
    onPlayerHover,
    renderPlayerCorpse: renderCorpse,
}: RenderYSortedEntitiesProps) => {

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
                    renderEquippedItem(ctx, player, equipment, itemDef!, itemImg!, nowMs, jumpOffset);
                }
                if (heroImg) {
                    renderPlayer(
                        ctx, player, heroImg, isOnline, 
                        isPlayerMoving, 
                        currentlyHovered,
                        animationFrame, nowMs, jumpOffset, 
                        isPersistentlyHovered
                    );
                }
            } else { 
                if (heroImg) {
                    renderPlayer(
                        ctx, player, heroImg, isOnline, 
                        isPlayerMoving, 
                        currentlyHovered,
                        animationFrame, nowMs, jumpOffset, 
                        isPersistentlyHovered
                    );
                }
                if (canRenderItem && equipment) {
                    renderEquippedItem(ctx, player, equipment, itemDef!, itemImg!, nowMs, jumpOffset);
                }
            }
        } else if (type === 'tree') {
            renderTree(ctx, entity as SpacetimeDBTree, nowMs);
        } else if (type === 'stone') {
            renderStone(ctx, entity as SpacetimeDBStone, nowMs);
        } else if (type === 'wooden_storage_box') {
            renderWoodenStorageBox(ctx, entity as SpacetimeDBWoodenStorageBox, nowMs);
        } else if (type === 'player_corpse') {
            renderCorpse({ 
                ctx, 
                corpse: entity as SpacetimeDBPlayerCorpse, 
                nowMs, 
                itemImagesRef
            });
        } else {
            console.warn('Unhandled entity type for Y-sorting:', type);
        }
    });
}; 