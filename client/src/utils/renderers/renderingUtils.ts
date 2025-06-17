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
    Shelter as SpacetimeDBShelter,
    PlayerDodgeRollState as SpacetimeDBPlayerDodgeRollState
} from '../../generated';
import { PlayerCorpse as SpacetimeDBPlayerCorpse } from '../../generated/player_corpse_type';
import { gameConfig } from '../../config/gameConfig';
import { JUMP_DURATION_MS } from '../../config/gameConfig'; // Import the constant
// Import individual rendering functions
import { renderTree } from './treeRenderingUtils';
import { renderStone } from './stoneRenderingUtils';
import { renderWoodenStorageBox } from './woodenStorageBoxRenderingUtils';
import { renderEquippedItem } from './equippedItemRenderingUtils';
// Import the extracted player renderer
import { renderPlayer, isPlayerHovered } from './playerRenderingUtils';
// Import unified resource renderer instead of individual ones
import { renderCorn, renderHemp, renderMushroom, renderPotato, renderPumpkin, renderReed } from './unifiedResourceRenderer';
import { renderCampfire } from './campfireRenderingUtils';
import { renderDroppedItem } from './droppedItemRenderingUtils';
import { renderStash } from './stashRenderingUtils';
import { renderGrass } from './grassRenderingUtils';
import { renderProjectile, cleanupOldProjectileTracking } from './projectileRenderingUtils';
import { renderShelter } from './shelterRenderingUtils';
import { imageManager } from './imageManager';
import { getItemIcon } from '../itemIconUtils';
import { renderPlayerTorchLight, renderCampfireLight } from './lightRenderingUtils';
import { drawInteractionOutline, drawCircularInteractionOutline, getInteractionOutlineColor } from './outlineUtils';

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

// Dodge roll visual effects cache
interface DodgeRollVisualState {
    startTime: number;
    startX: number;
    startY: number;
    targetX: number;
    targetY: number;
    direction: string;
    ghostTrailPositions: Array<{ x: number, y: number, alpha: number, timestamp: number }>;
}

const dodgeRollVisualCache = new Map<string, DodgeRollVisualState>();

// Movement buffer duration - keep animation going for this long after movement stops
const MOVEMENT_BUFFER_MS = 150;

// Dodge roll constants (should match server)
const DODGE_ROLL_DURATION_MS = 250;
const DODGE_ROLL_DISTANCE = 120;

// Ghost trail constants
const GHOST_TRAIL_LENGTH = 8;
const GHOST_TRAIL_SPACING_MS = 15; // Add new ghost every 15ms
const GHOST_TRAIL_FADE_MS = 200; // Fade out over 200ms

// --- Client-side animation tracking ---
const clientJumpStartTimes = new Map<string, number>(); // playerId -> client timestamp when jump started
const lastKnownServerJumpTimes = new Map<string, number>(); // playerId -> last known server timestamp

interface RenderYSortedEntitiesProps {
    ctx: CanvasRenderingContext2D;
    ySortedEntities: YSortedEntityType[];
    heroImageRef: React.RefObject<HTMLImageElement | null>;
    heroWaterImageRef: React.RefObject<HTMLImageElement | null>;
    heroCrouchImageRef: React.RefObject<HTMLImageElement | null>;
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
    playerDodgeRollStates: Map<string, SpacetimeDBPlayerDodgeRollState>; // Add dodge roll states
    renderPlayerCorpse: (props: { 
        ctx: CanvasRenderingContext2D; 
        corpse: SpacetimeDBPlayerCorpse; 
        nowMs: number; 
        itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
        heroImageRef: React.RefObject<HTMLImageElement | null>;
        heroWaterImageRef: React.RefObject<HTMLImageElement | null>;
        heroCrouchImageRef: React.RefObject<HTMLImageElement | null>;
    }) => void;
    localPlayerPosition?: { x: number; y: number } | null; // This is the predicted position
    remotePlayerInterpolation?: {
        updateAndGetSmoothedPosition: (player: any, localPlayerId?: string) => { x: number; y: number };
    };
    localPlayerIsCrouching?: boolean; // Local crouch state for immediate visual feedback
    // Closest interactable IDs for outline rendering
    closestInteractableCampfireId?: number | null;
    closestInteractableBoxId?: number | null;
    closestInteractableStashId?: number | null;
    closestInteractableSleepingBagId?: number | null;
    closestInteractableMushroomId?: bigint | null;
    closestInteractableCornId?: bigint | null;
    closestInteractablePotatoId?: bigint | null;
    closestInteractablePumpkinId?: bigint | null;
    closestInteractableHempId?: bigint | null;
    closestInteractableReedId?: bigint | null;
    closestInteractableDroppedItemId?: bigint | null;
}

/**
 * Renders entities that need to be sorted by their Y-coordinate for correct overlapping.
 */
export const renderYSortedEntities = ({
    ctx,
    ySortedEntities,
    heroImageRef,
    heroWaterImageRef,
    heroCrouchImageRef,
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
    playerDodgeRollStates,
    renderPlayerCorpse: renderCorpse,
    localPlayerPosition,
    remotePlayerInterpolation,
    localPlayerIsCrouching,
    // Closest interactable IDs for outline rendering
    closestInteractableCampfireId,
    closestInteractableBoxId,
    closestInteractableStashId,
    closestInteractableSleepingBagId,
    closestInteractableMushroomId,
    closestInteractableCornId,
    closestInteractablePotatoId,
    closestInteractablePumpkinId,
    closestInteractableHempId,
    closestInteractableReedId,
    closestInteractableDroppedItemId,
}: RenderYSortedEntitiesProps) => {
    // Clean up old projectile tracking data periodically (every 5 seconds)
    if (nowMs % 5000 < 50) { // Approximately every 5 seconds, with 50ms tolerance
        cleanupOldProjectileTracking();
    }

    // First Pass: Render all entities. Trees and stones will skip their dynamic ground shadows.
    // Other entities (players, boxes, etc.) render as normal.
    ySortedEntities.forEach(({ type, entity }) => {
        if (type === 'player') {
            const player = entity as SpacetimeDBPlayer;
            const playerId = player.identity.toHexString();
            const isLocalPlayer = localPlayerId === playerId;

            // Create a modified player object with appropriate position system
            let playerForRendering = player;
            if (isLocalPlayer && localPlayerPosition) {
                // Local player uses predicted position
                playerForRendering = {
                    ...player,
                    positionX: localPlayerPosition.x,
                    positionY: localPlayerPosition.y
                };
            } else if (!isLocalPlayer && remotePlayerInterpolation) {
                // Remote players use interpolated position between server updates
                const interpolatedPosition = remotePlayerInterpolation.updateAndGetSmoothedPosition(player, localPlayerId);
                playerForRendering = {
                    ...player,
                    positionX: interpolatedPosition.x,
                    positionY: interpolatedPosition.y
                };
            }

            const lastPos = lastPositionsRef.current.get(playerId);
            let isPlayerMoving = false;
            let movementReason = 'none';
           
            // === DODGE ROLL DETECTION ===
            const isDodgeRolling = detectDodgeRoll(playerId, playerForRendering, lastPos || null, nowMs, playerDodgeRollStates);
            if (isDodgeRolling) {
                movementReason = 'dodge_rolling';
                isPlayerMoving = true;
            }
           
            // Ghost trail disabled for cleaner dodge roll experience
            // updateGhostTrail(playerId, playerForRendering, nowMs, isDodgeRolling);
           
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
           
            // Check for actual position changes (skip if already detected dodge rolling)
            let hasPositionChanged = false;
            if (!isDodgeRolling && lastPos) {
                const dx = Math.abs(playerForRendering.positionX - lastPos.x);
                const dy = Math.abs(playerForRendering.positionY - lastPos.y);
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
            } else if (isDodgeRolling) {
                // Dodge rolling was already detected above, keep movement active
                movementCache.lastMovementTime = nowMs;
                movementCache.isCurrentlyMoving = true;
                // isPlayerMoving and movementReason already set above
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
            if (!isPlayerMoving && playerForRendering.isSprinting) {
                movementCache.lastMovementTime = nowMs;
                movementCache.isCurrentlyMoving = true;
                isPlayerMoving = true;
                movementReason = 'sprinting';
            }
           
            lastPositionsRef.current.set(playerId, { x: playerForRendering.positionX, y: playerForRendering.positionY });

           let jumpOffset = 0;
           let isCurrentlyJumping = false;
           const jumpStartTime = playerForRendering.jumpStartTimeMs;
           
           if (jumpStartTime > 0) {
               const serverJumpTime = Number(jumpStartTime);
               const playerId = playerForRendering.identity.toHexString();
               
               // Check if this is a NEW jump by comparing server timestamps
               const lastKnownServerTime = lastKnownServerJumpTimes.get(playerId) || 0;
               
               if (serverJumpTime !== lastKnownServerTime) {
                   // NEW jump detected! Record both server time and client time
                   lastKnownServerJumpTimes.set(playerId, serverJumpTime);
                   clientJumpStartTimes.set(playerId, nowMs);
               }
               
               // Calculate animation based on client time
               const clientStartTime = clientJumpStartTimes.get(playerId);
               if (clientStartTime) {
                   const elapsedJumpTime = nowMs - clientStartTime;
                   
                   if (elapsedJumpTime < JUMP_DURATION_MS) {
                       const t = elapsedJumpTime / JUMP_DURATION_MS;
                       jumpOffset = Math.sin(t * Math.PI) * 50;
                       isCurrentlyJumping = true; // Player is mid-jump
                   }
               }
           } else {
               // No jump active - clean up for this player
               const playerId = playerForRendering.identity.toHexString();
               clientJumpStartTimes.delete(playerId);
               lastKnownServerJumpTimes.delete(playerId);
           }
           
           const currentlyHovered = isPlayerHovered(worldMouseX, worldMouseY, playerForRendering);
           const isPersistentlyHovered = hoveredPlayerIds.has(playerId);
           
           // Choose sprite based on crouching state first, then water status, but don't switch to water sprite while jumping
           let heroImg: HTMLImageElement | null;
           // For local player, use immediate local crouch state; for others, use server state
           const effectiveIsCrouching = isLocalPlayer && localPlayerIsCrouching !== undefined 
               ? localPlayerIsCrouching 
               : playerForRendering.isCrouching;
           
           if (effectiveIsCrouching) {
               heroImg = heroCrouchImageRef.current; // Use crouch sprite when crouching
           } else if (playerForRendering.isOnWater && !isCurrentlyJumping) {
               heroImg = heroWaterImageRef.current; // Use water sprite when on water (but not jumping)
           } else {
               heroImg = heroImageRef.current; // Use normal sprite otherwise
           }
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
            if (playerForRendering.direction === 'up' || playerForRendering.direction === 'left') {
                // For UP or LEFT, item should be rendered BENEATH the player
              
              // Ghost trail disabled for cleaner dodge roll experience
              // if (heroImg && isDodgeRolling) {
              //     renderGhostTrail(ctx, playerId, heroImg, playerForRendering);
              // }
              
              if (canRenderItem && equipment) {
                    renderEquippedItem(ctx, playerForRendering, equipment, itemDef!, itemDefinitions, itemImg!, nowMs, jumpOffset, itemImagesRef.current, activeConsumableEffects, localPlayerId);
              }
              if (heroImg) {
                renderPlayer(
                        ctx, playerForRendering, heroImg, isOnline, 
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
                        ctx, playerForRendering, heroImg, isOnline, 
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
                    renderEquippedItem(ctx, playerForRendering, equipment, itemDef!, itemDefinitions, itemImg!, nowMs, jumpOffset, itemImagesRef.current, activeConsumableEffects, localPlayerId);
              }
              
              // Ghost trail disabled for cleaner dodge roll experience
              // if (heroImg && isDodgeRolling) {
              //     renderGhostTrail(ctx, playerId, heroImg, playerForRendering);
              // }
           }
        } else if (type === 'tree') {
            // Render tree, skip its dynamic shadow in this pass
            renderTree(ctx, entity as SpacetimeDBTree, nowMs, cycleProgress, false, true);
        } else if (type === 'stone') {
            // Render stone with its shadow in the normal order (shadow first, then stone)
            renderStone(ctx, entity as SpacetimeDBStone, nowMs, cycleProgress, false, false);
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
            const corn = entity as SpacetimeDBCorn;
            renderCorn(ctx, corn, nowMs, cycleProgress);
        } else if (type === 'hemp') {
            const hemp = entity as SpacetimeDBHemp;
            renderHemp(ctx, hemp, nowMs, cycleProgress);
        } else if (type === 'reed') {
            const reed = entity as any;
            renderReed(ctx, reed, nowMs, cycleProgress);
        } else if (type === 'campfire') {
            const campfire = entity as SpacetimeDBCampfire;
            const isClosestInteractable = closestInteractableCampfireId === campfire.id;
            renderCampfire(ctx, campfire, nowMs, cycleProgress);
            
            // Draw outline if this is the closest interactable campfire
            if (isClosestInteractable) {
                const outlineColor = getInteractionOutlineColor('open');
                drawInteractionOutline(ctx, campfire.posX, campfire.posY - 48, 64, 96, cycleProgress, outlineColor);
            }
        } else if (type === 'dropped_item') {
            const droppedItem = entity as SpacetimeDBDroppedItem;
            const itemDef = itemDefinitions.get(droppedItem.itemDefId.toString());
            renderDroppedItem({ ctx, item: droppedItem, itemDef, nowMs, cycleProgress });
        } else if (type === 'mushroom') {
            const mushroom = entity as SpacetimeDBMushroom;
            renderMushroom(ctx, mushroom, nowMs, cycleProgress);
        } else if (type === 'potato') {
            const potato = entity as SpacetimeDBPotato;
            renderPotato(ctx, potato, nowMs, cycleProgress);
        } else if (type === 'pumpkin') {
            const pumpkin = entity as SpacetimeDBPumpkin;
            renderPumpkin(ctx, pumpkin, nowMs, cycleProgress);
        } else if (type === 'stash') {
            const stash = entity as SpacetimeDBStash;
            const isClosestInteractable = closestInteractableStashId === stash.id;
            renderStash(ctx, stash, nowMs, cycleProgress);
            
            // Draw outline if this is the closest interactable stash
            if (isClosestInteractable) {
                const outlineColor = getInteractionOutlineColor('open');
                // Use circular outline for stashes since they're small and round
                drawCircularInteractionOutline(ctx, stash.posX, stash.posY, 24, cycleProgress, outlineColor);
            }
        } else if (type === 'wooden_storage_box') {
            // Render box normally, its applyStandardDropShadow will handle the shadow
            const box = entity as SpacetimeDBWoodenStorageBox;
            const isClosestInteractable = closestInteractableBoxId === box.id;
            renderWoodenStorageBox(ctx, box, nowMs, cycleProgress);
            
            // Draw outline if this is the closest interactable box
            if (isClosestInteractable) {
                const outlineColor = getInteractionOutlineColor('open');
                drawInteractionOutline(ctx, box.posX, box.posY - 52, 64, 64, cycleProgress, outlineColor);
            }
        } else if (type === 'player_corpse') {
            renderCorpse({ 
                ctx, 
                corpse: entity as SpacetimeDBPlayerCorpse, 
                nowMs, 
                itemImagesRef,
                heroImageRef,
                heroWaterImageRef,
                heroCrouchImageRef
            });
        } else if (type === 'grass') {
            renderGrass(ctx, entity as InterpolatedGrassData, nowMs, cycleProgress, false, true);
        } else if (type === 'projectile') {
            const projectile = entity as SpacetimeDBProjectile;
            
            // Reduced debug logging - only log when projectiles are found
            console.log(`🏹 [RENDER] Projectile ${projectile.id} found in render queue`);
            
            // Check if this is a thrown weapon (ammo_def_id == item_def_id)
            const isThrown = projectile.ammoDefId === projectile.itemDefId;
            
            // Get the appropriate definition and image
            const ammoDef = itemDefinitions.get(projectile.ammoDefId.toString());
            let projectileImageName: string;
            
            if (isThrown && ammoDef) {
                // For thrown weapons, use the weapon's icon
                projectileImageName = ammoDef.iconAssetName;
            } else if (ammoDef) {
                // For regular projectiles (arrows), use the ammunition's icon
                projectileImageName = ammoDef.iconAssetName;
            } else {
                // Fallback for missing definitions
                projectileImageName = 'wooden_arrow.png';
                console.warn(`🏹 [RENDER] No ammo definition found for projectile ${projectile.id}, using fallback`);
            }
            
            // Use imageManager to get the projectile image for production compatibility
            const projectileImageSrc = getItemIcon(projectileImageName);
            const projectileImage = imageManager.getImage(projectileImageSrc);
            
            if (projectileImage) {
                renderProjectile({
                    ctx,
                    projectile,
                    arrowImage: projectileImage, // Note: parameter name is still 'arrowImage' but now handles both
                    currentTimeMs: nowMs,
                    itemDefinitions, // FIXED: Add itemDefinitions for weapon type detection
                });
            } else {
                console.warn(`🏹 [RENDER] Image not loaded: ${projectileImageName} for projectile ${projectile.id}`);
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
            // Tree shadows are already rendered in GameCanvas.tsx, so skip here.
        } else if (type === 'shelter') {
            // Shelters are fully rendered in the first pass, including shadows.
            // No action needed in this second (shadow-only) pass.
        } else if (type === 'corn') {
            // Corn is fully rendered in the first pass - no second pass needed
        } else if (type === 'hemp') {
            // Hemp is fully rendered in the first pass - no second pass needed
        } else if (type === 'reed') {
            // Reed is fully rendered in the first pass - no second pass needed
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

/**
 * Detects if a player is currently dodge rolling based on server-side dodge roll state
 * Always prioritizes server state for reliable ghost trail rendering
 */
const detectDodgeRoll = (
    playerId: string, 
    player: SpacetimeDBPlayer, 
    lastPos: { x: number; y: number } | null,
    nowMs: number,
    playerDodgeRollStates: Map<string, SpacetimeDBPlayerDodgeRollState>
): boolean => {
    // ONLY use server-side dodge roll state - no movement fallback to prevent false positives
    const dodgeRollState = playerDodgeRollStates.get(playerId);
    
    if (dodgeRollState) {
        // Calculate if dodge roll is still active based on timing
        const elapsedMs = nowMs - Number(dodgeRollState.startTimeMs);
        
        // Extended buffer for longer ghost trail visibility
        const ANIMATION_BUFFER_MS = 200; // Longer buffer for better visual effect
        const totalDuration = DODGE_ROLL_DURATION_MS + ANIMATION_BUFFER_MS;
        const isActive = elapsedMs >= 0 && elapsedMs < totalDuration;
        
        if (isActive) {
            return true; // Server says player is dodge rolling
        }
    }
    
    // NO MOVEMENT FALLBACK - this prevents false positives from WASD movement
    return false;
};

/**
 * Updates the ghost trail for a player during dodge rolling
 * Ensures consistent, visible trail throughout the entire dodge roll
 */
const updateGhostTrail = (
    playerId: string, 
    player: SpacetimeDBPlayer, 
    nowMs: number, 
    isDodgeRolling: boolean
): void => {
    let visualState = dodgeRollVisualCache.get(playerId);
    
    if (isDodgeRolling) {
        if (!visualState) {
            // Start new dodge roll visual state
            visualState = {
                startTime: nowMs,
                startX: player.positionX,
                startY: player.positionY,
                targetX: player.positionX, // Will be updated as we see movement
                targetY: player.positionY,
                direction: player.direction,
                ghostTrailPositions: []
            };
            dodgeRollVisualCache.set(playerId, visualState);
        }
        
        // Add single trail point per frame for smooth, subtle effect
        visualState.ghostTrailPositions.push({
            x: player.positionX,
            y: player.positionY,
            alpha: 0.7, // Strong but not overwhelming
            timestamp: nowMs
        });
        
        // Keep only the 3 most recent positions for subtle effect
        const MAX_TRAIL_POSITIONS = 3;
        if (visualState.ghostTrailPositions.length > MAX_TRAIL_POSITIONS) {
            visualState.ghostTrailPositions.splice(0, visualState.ghostTrailPositions.length - MAX_TRAIL_POSITIONS);
        }
        
        // Always update direction to match current player direction
        visualState.direction = player.direction;
    } else {
        // Quick fade out after dodge roll ends for clean, subtle effect
        if (visualState && visualState.ghostTrailPositions.length > 0) {
            const fadeSpeed = 0.05; // Faster fade for clean, subtle effect
            visualState.ghostTrailPositions = visualState.ghostTrailPositions
                .map(pos => ({ ...pos, alpha: Math.max(0, pos.alpha - fadeSpeed) }))
                .filter(pos => pos.alpha > 0.1);
            
            if (visualState.ghostTrailPositions.length === 0) {
                dodgeRollVisualCache.delete(playerId);
            }
        }
    }
};

/**
 * Helper function to get sprite sheet offsets for a specific direction (supports 8 directions)
 */
const getDirectionSpriteOffsets = (direction: string): { x: number, y: number } => {
    let spriteRow = 2; // Default Down
    switch (direction) {
        case 'up':         spriteRow = 0; break;
        case 'up_right':   spriteRow = 1; break; // Use right sprite for diagonal up-right
        case 'right':      spriteRow = 1; break;
        case 'down_right': spriteRow = 1; break; // Use right sprite for diagonal down-right
        case 'down':       spriteRow = 2; break;
        case 'down_left':  spriteRow = 3; break; // Use left sprite for diagonal down-left
        case 'left':       spriteRow = 3; break;
        case 'up_left':    spriteRow = 3; break; // Use left sprite for diagonal up-left
        default:           spriteRow = 2; break;
    }
    
    return {
        x: 0, // Frame 0 for simplicity in ghost trail
        y: spriteRow
    };
};

/**
 * Renders the ghost trail effect for dodge rolling players
 */
const renderGhostTrail = (
    ctx: CanvasRenderingContext2D, 
    playerId: string, 
    heroImg: HTMLImageElement, 
    currentPlayer: SpacetimeDBPlayer
): void => {
    const visualState = dodgeRollVisualCache.get(playerId);
    if (!visualState || visualState.ghostTrailPositions.length === 0) return;
    
    // Use the dodge direction for all ghost sprites
    const rollDirection = visualState.direction;
    const directionOffsets = getDirectionSpriteOffsets(rollDirection);
    
    // Smooth, subtle ghost trail rendering with uniform size
    visualState.ghostTrailPositions.forEach((ghost, index) => {
        if (ghost.alpha <= 0.1) return;
        
        // Simple interpolated alpha based on position in trail (newest = most opaque)
        const trailProgress = index / Math.max(visualState.ghostTrailPositions.length - 1, 1);
        const interpolatedAlpha = ghost.alpha * (0.3 + 0.7 * (1 - trailProgress)); // Smoothly fade from back to front
        
        // Save context for transformations
        ctx.save();
        
        // Apply smooth, subtle visual effects
        ctx.globalAlpha = interpolatedAlpha;
        ctx.globalCompositeOperation = 'source-over';
        
        // Subtle blue tint for visual distinction
        ctx.filter = `hue-rotate(180deg) brightness(1.1) opacity(0.8)`;
        
        // Uniform size - no scaling variation
        const uniformWidth = gameConfig.spriteWidth * 2;
        const uniformHeight = gameConfig.spriteHeight * 2;
        
        // Calculate sprite position for the specific direction
        const spriteX = directionOffsets.x * gameConfig.spriteWidth;
        const spriteY = directionOffsets.y * gameConfig.spriteHeight;
        
        // Render the ghost sprite with uniform size
        ctx.drawImage(
            heroImg,
            spriteX, spriteY, gameConfig.spriteWidth, gameConfig.spriteHeight, // Source rectangle (specific direction)
            ghost.x - uniformWidth / 2, 
            ghost.y - uniformHeight / 2, 
            uniformWidth, 
            uniformHeight // Destination rectangle (uniform size)
        );
        
        // Restore context
        ctx.restore();
    });
};