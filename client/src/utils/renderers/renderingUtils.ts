import {
    Player as SpacetimeDBPlayer,
    Tree as SpacetimeDBTree,
    Stone as SpacetimeDBStone,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    SleepingBag as SpacetimeDBSleepingBag,
    ActiveConnection,
    ActiveEquipment as SpacetimeDBActiveEquipment,
    ItemDefinition as SpacetimeDBItemDefinition,
    InventoryItem as SpacetimeDBInventoryItem,
    Stash as SpacetimeDBStash,
    DroppedItem as SpacetimeDBDroppedItem,
    Campfire as SpacetimeDBCampfire,
    ActiveConsumableEffect,
    Corn as SpacetimeDBCorn,
    Hemp as SpacetimeDBHemp,
    Mushroom as SpacetimeDBMushroom,
    Potato as SpacetimeDBPotato,
    Pumpkin as SpacetimeDBPumpkin,
    Grass as SpacetimeDBGrass,
    Projectile as SpacetimeDBProjectile,
    Shelter as SpacetimeDBShelter
} from '../../generated';
import { PlayerCorpse as SpacetimeDBPlayerCorpse } from '../../generated/player_corpse_type';
// Import individual rendering functions
import { renderTree } from './treeRenderingUtils';
import { renderStone } from './stoneRenderingUtils';
import { renderWoodenStorageBox } from './woodenStorageBoxRenderingUtils';
import { renderEquippedItem } from './equippedItemRenderingUtils';
// Import the extracted player renderer
import { renderPlayer, isPlayerHovered } from './playerRenderingUtils';
// Import unified resource renderer instead of individual ones
import { renderCorn, renderHemp, renderMushroom, renderPotato, renderPumpkin } from './unifiedResourceRenderer';
import { renderCampfire } from './campfireRenderingUtils';
import { renderDroppedItem } from './droppedItemRenderingUtils';
import { renderStash } from './stashRenderingUtils';
import { renderGrass } from './grassRenderingUtils';
import { renderProjectile } from './projectileRenderingUtils';
import { renderShelter } from './shelterRenderingUtils';

// Type alias for Y-sortable entities
import { YSortedEntityType } from '../../hooks/useEntityFiltering';
import { InterpolatedGrassData } from '../../hooks/useGrassInterpolation';

// Module-level cache for debug logging
const playerDebugStateCache = new Map<string, { prevIsDead: boolean, prevLastHitTime: string | null }>();

// Movement smoothing cache to prevent animation jitters
const playerMovementCache = new Map<string, { 
    lastMovementTime: number, 
    isCurrentlyMoving: boolean,
    lastKnownPosition: { x: number, y: number } | null
}>();

// Movement buffer duration - keep animation going for this long after movement stops
const MOVEMENT_BUFFER_MS = 150;

interface RenderYSortedEntitiesProps {
    ctx: CanvasRenderingContext2D;
    ySortedEntities: YSortedEntityType[];
    heroImageRef: React.RefObject<HTMLImageElement | null>;
    lastPositionsRef: React.RefObject<Map<string, { x: number; y: number }>>;
    activeConnections: Map<string, ActiveConnection> | undefined;
    activeEquipments: Map<string, SpacetimeDBActiveEquipment>;
    activeConsumableEffects: Map<string, ActiveConsumableEffect>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    inventoryItems: Map<string, SpacetimeDBInventoryItem>; // Add inventory items for validation
    itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
    shelterImage: HTMLImageElement | null;
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
        heroImageRef: React.RefObject<HTMLImageElement | null>;
    }) => void;
    localPlayerPosition?: { x: number; y: number } | null;
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
    inventoryItems,
    itemImagesRef,
    shelterImage,
    worldMouseX,
    worldMouseY,
    localPlayerId,
    animationFrame,
    nowMs,
    hoveredPlayerIds,
    onPlayerHover,
    cycleProgress,
    renderPlayerCorpse: renderCorpse,
    localPlayerPosition,
}: RenderYSortedEntitiesProps) => {

    // First Pass: Render all entities. Trees and stones will skip their dynamic ground shadows.
    // Other entities (players, boxes, etc.) render as normal.
    ySortedEntities.forEach(({ type, entity }) => {
        if (type === 'player') {
            const player = entity as SpacetimeDBPlayer;
            const playerId = player.identity.toHexString();

            // ##### ADD LOGGING HERE #####
            if (localPlayerId && playerId === localPlayerId) {
              const currentIsDead = player.isDead;
              const currentLastHitTimeEpoch = player.lastHitTime ? player.lastHitTime.__timestamp_micros_since_unix_epoch__.toString() : null;

              const cachedState = playerDebugStateCache.get(playerId);
              const prevIsDead = cachedState?.prevIsDead;
              const prevLastHitTimeEpoch = cachedState?.prevLastHitTime;

              if (currentIsDead !== prevIsDead || 
                  (!currentIsDead && currentLastHitTimeEpoch !== prevLastHitTimeEpoch)) {
                console.log(`[renderingUtils] LocalPlayer State Change: ${player.username} (ID: ${playerId}). ` +
                            `isDead: ${currentIsDead} (was: ${prevIsDead}), ` +
                            `lastHitTime: ${currentLastHitTimeEpoch} (was: ${prevLastHitTimeEpoch})`);
                playerDebugStateCache.set(playerId, { 
                  prevIsDead: currentIsDead, 
                  prevLastHitTime: currentLastHitTimeEpoch 
                });
              }
            }
            // ##########################

           const lastPos = lastPositionsRef.current.get(playerId);
           let isPlayerMoving = false;
           let movementReason = 'none'; // Debug: track why player is considered moving
           
           // Get or create movement cache for this player
           let movementCache = playerMovementCache.get(playerId);
           if (!movementCache) {
               movementCache = {
                   lastMovementTime: 0,
                   isCurrentlyMoving: false,
                   lastKnownPosition: null
               };
               playerMovementCache.set(playerId, movementCache);
           }
           
           // Check for actual position changes
           let hasPositionChanged = false;
           if (lastPos) {
                const dx = Math.abs(player.positionX - lastPos.x);
                const dy = Math.abs(player.positionY - lastPos.y);
                // Use a smaller threshold (0.1) but with smoothing
                if (dx > 0.1 || dy > 0.1) {
                    hasPositionChanged = true;
                }
           }
           
           // Update movement cache if position changed
           if (hasPositionChanged) {
               movementCache.lastMovementTime = nowMs;
               movementCache.isCurrentlyMoving = true;
               isPlayerMoving = true;
               movementReason = 'position_change';
           } else {
               // Check if we're still in the movement buffer period
               const timeSinceLastMovement = nowMs - movementCache.lastMovementTime;
               if (timeSinceLastMovement < MOVEMENT_BUFFER_MS) {
                   isPlayerMoving = true;
                   movementReason = `movement_buffer(${timeSinceLastMovement}ms)`;
               } else {
                   movementCache.isCurrentlyMoving = false;
               }
           }
           
           // If position-based detection fails, check if player is actively sprinting
           if (!isPlayerMoving && player.isSprinting) {
               movementCache.lastMovementTime = nowMs;
               movementCache.isCurrentlyMoving = true;
               isPlayerMoving = true;
               movementReason = 'sprinting';
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

           if (equipment && equipment.equippedItemDefId && equipment.equippedItemInstanceId) {
             // Validate that the equipped item instance actually exists in inventory
             const equippedItemInstance = inventoryItems.get(equipment.equippedItemInstanceId.toString());
             if (equippedItemInstance && equippedItemInstance.quantity > 0) {
               itemDef = itemDefinitions.get(equipment.equippedItemDefId.toString()) || null;
               itemImg = (itemDef ? itemImagesRef.current.get(itemDef.iconAssetName) : null) || null;
        
             } else {
               // Item was consumed but equipment table hasn't updated yet - don't render
             }
           } else if (localPlayerId && playerId === localPlayerId) {
             // Debug logging removed for performance (was spamming every frame)
           }
           const canRenderItem = itemDef && itemImg && itemImg.complete && itemImg.naturalHeight !== 0;
           
            // Determine rendering order based on player direction
            if (player.direction === 'up' || player.direction === 'left') {
                // For UP or LEFT, item should be rendered BENEATH the player
              if (canRenderItem && equipment) {
                    renderEquippedItem(ctx, player, equipment, itemDef!, itemDefinitions, itemImg!, nowMs, jumpOffset, itemImagesRef.current, activeConsumableEffects, localPlayerId);
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
                  localPlayerId,
                  false, // isCorpse
                  cycleProgress // cycleProgress
                );
              }
            } else { // This covers 'down' or 'right'
                // For DOWN or RIGHT, item should be rendered ABOVE the player
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
                  localPlayerId,
                  false, // isCorpse
                  cycleProgress // cycleProgress
                );
              }
              if (canRenderItem && equipment) {
                    renderEquippedItem(ctx, player, equipment, itemDef!, itemDefinitions, itemImg!, nowMs, jumpOffset, itemImagesRef.current, activeConsumableEffects, localPlayerId);
              }
           }
        } else if (type === 'tree') {
            // Render tree, skip its dynamic shadow in this pass
            renderTree(ctx, entity as SpacetimeDBTree, nowMs, cycleProgress, false, true);
        } else if (type === 'stone') {
            // Render stone, skip its dynamic shadow in this pass
            renderStone(ctx, entity as SpacetimeDBStone, nowMs, cycleProgress, false, true);
        } else if (type === 'shelter') {
            const shelter = entity as SpacetimeDBShelter;
            if (shelterImage) { 
                renderShelter({
                    ctx,
                    shelter,
                    shelterImage: shelterImage, 
                    nowMs,
                    cycleProgress,
                    localPlayerId,
                    localPlayerPosition,
                });
            } else {
                // console.warn('[renderYSortedEntities] Shelter image not available for shelter:', shelter.id); // DEBUG LOG
            }
        } else if (type === 'corn') {
            renderCorn(ctx, entity as SpacetimeDBCorn, nowMs, cycleProgress);
        } else if (type === 'hemp') {
            renderHemp(ctx, entity as SpacetimeDBHemp, nowMs, cycleProgress);
        } else if (type === 'campfire') {
            renderCampfire(ctx, entity as SpacetimeDBCampfire, nowMs, cycleProgress);
        } else if (type === 'dropped_item') {
            const droppedItem = entity as SpacetimeDBDroppedItem;
            const itemDef = itemDefinitions.get(droppedItem.itemDefId.toString());
            renderDroppedItem({ ctx, item: droppedItem, itemDef, nowMs, cycleProgress });
        } else if (type === 'mushroom') {
            renderMushroom(ctx, entity as SpacetimeDBMushroom, nowMs, cycleProgress);
        } else if (type === 'potato') {
            renderPotato(ctx, entity as SpacetimeDBPotato, nowMs, cycleProgress);
        } else if (type === 'pumpkin') {
            renderPumpkin(ctx, entity as SpacetimeDBPumpkin, nowMs, cycleProgress);
        } else if (type === 'stash') {
            renderStash(ctx, entity as SpacetimeDBStash, nowMs, cycleProgress);
        } else if (type === 'wooden_storage_box') {
            // Render box normally, its applyStandardDropShadow will handle the shadow
            renderWoodenStorageBox(ctx, entity as SpacetimeDBWoodenStorageBox, nowMs, cycleProgress);
        } else if (type === 'player_corpse') {
            renderCorpse({ 
                ctx, 
                corpse: entity as SpacetimeDBPlayerCorpse, 
                nowMs, 
                itemImagesRef,
                heroImageRef
            });
        } else if (type === 'grass') {
            renderGrass(ctx, entity as InterpolatedGrassData, nowMs, cycleProgress, false, true);
        } else if (type === 'projectile') {
            const projectile = entity as SpacetimeDBProjectile;
            
            // Get the ammunition definition to determine the correct arrow image
            const ammoDef = itemDefinitions.get(projectile.ammoDefId.toString());
            let arrowImageName = 'wooden_arrow.png'; // Default fallback
            
            if (ammoDef) {
                // Use the icon asset name from the ammunition definition
                arrowImageName = ammoDef.iconAssetName;
            }
            
            const arrowImage = itemImagesRef.current?.get(arrowImageName);
            if (arrowImage) {
                renderProjectile({
                    ctx,
                    projectile,
                    arrowImage,
                    currentTimeMs: nowMs,
                });
            }
        } else if (type === 'shelter') {
            // Shelters are fully rendered in the first pass, including shadows.
            // No action needed in this second (shadow-only) pass.
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
        } else if (type === 'shelter') {
            // Shelters are fully rendered in the first pass, including shadows.
            // No action needed in this second (shadow-only) pass.
        } else if (type === 'corn') {
            // Corn is fully rendered in the first pass - no second pass needed
        } else if (type === 'hemp') {
            // Hemp is fully rendered in the first pass - no second pass needed
        } else if (type === 'campfire') {
            // Campfires handle their own shadows, no separate pass needed here generally
        } else if (type === 'dropped_item') {
            // Dropped items handle their own shadows
        } else if (type === 'mushroom') {
            // Mushrooms are fully rendered in the first pass - no second pass needed
        } else if (type === 'potato') {
            // Potatoes are fully rendered in the first pass - no second pass needed
        } else if (type === 'pumpkin') {
            // Pumpkins are fully rendered in the first pass - no second pass needed
        } else if (type === 'stash') {
            // Stashes handle their own shadows within their main render function
        } else if (type === 'wooden_storage_box') {
            // No shadow-only pass needed for wooden_storage_box as it uses applyStandardDropShadow
        } else if (type === 'player_corpse') {
            // Player corpses are fully rendered in the first pass.
            // Their shadows (if any, like applyStandardDropShadow) are part of that initial render.
            // Do not re-render here.
        } else if (type === 'player') {
            // Players are fully rendered in the first pass, including their shadows.
            // No action needed for players in this second (shadow-only) pass.
        } else if (type === 'grass') {
            // Grass is fully rendered in the first pass - no second pass needed
        } else if (type === 'projectile') {
            // Projectiles are fully rendered in the first pass and don't have separate shadows
            // No action needed in the shadow-only pass
        } else {
            console.warn('Unhandled entity type for Y-sorting (second pass):', type, entity);
        }
    });
};