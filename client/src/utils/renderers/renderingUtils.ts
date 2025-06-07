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
import { imageManager } from './imageManager';
import { getItemIcon } from '../itemIconUtils';

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
    localPlayerPosition?: { x: number; y: number } | null;
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
                // console.log(`[renderingUtils] LocalPlayer State Change: ${player.username} (ID: ${playerId}). ` +
                //             `isDead: ${currentIsDead} (was: ${prevIsDead}), ` +
                //             `lastHitTime: ${currentLastHitTimeEpoch} (was: ${prevLastHitTimeEpoch})`);
                // playerDebugStateCache.set(playerId, { 
                //   prevIsDead: currentIsDead, 
                //   prevLastHitTime: currentLastHitTimeEpoch 
                // });
              }
            }
            // ##########################

           const lastPos = lastPositionsRef.current.get(playerId);
           let isPlayerMoving = false;
           let movementReason = 'none'; // Debug: track why player is considered moving
           
           // === DODGE ROLL DETECTION ===
           const isDodgeRolling = detectDodgeRoll(playerId, player, lastPos || null, nowMs, playerDodgeRollStates);
           if (isDodgeRolling) {
               movementReason = 'dodge_rolling';
               isPlayerMoving = true;
           }
           
           // Update ghost trail for dodge roll effects
           updateGhostTrail(playerId, player, nowMs, isDodgeRolling);
           
           // Debug logging for local player dodge roll detection
        //    if (localPlayerId && playerId === localPlayerId && isDodgeRolling) {
        //        console.log(`[renderingUtils] Local player ${player.username} dodge rolling detected at (${player.positionX.toFixed(1)}, ${player.positionY.toFixed(1)})`);
        //    }
           
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
           if (!isPlayerMoving && player.isSprinting) {
               movementCache.lastMovementTime = nowMs;
               movementCache.isCurrentlyMoving = true;
               isPlayerMoving = true;
               movementReason = 'sprinting';
           }
           
           lastPositionsRef.current.set(playerId, { x: player.positionX, y: player.positionY });

           let jumpOffset = 0;
           let isCurrentlyJumping = false;
           const jumpStartTime = player.jumpStartTimeMs;
           if (jumpStartTime > 0) {
               const elapsedJumpTime = nowMs - Number(jumpStartTime);
                if (elapsedJumpTime < 500) { 
                    const t = elapsedJumpTime / 500;
                    jumpOffset = Math.sin(t * Math.PI) * 50;
                    isCurrentlyJumping = true; // Player is mid-jump
               }
           }
           
           const currentlyHovered = isPlayerHovered(worldMouseX, worldMouseY, player);
           const isPersistentlyHovered = hoveredPlayerIds.has(playerId);
           
           // Choose sprite based on crouching state first, then water status, but don't switch to water sprite while jumping
           let heroImg: HTMLImageElement | null;
           if (player.isCrouching) {
               heroImg = heroCrouchImageRef.current; // Use crouch sprite when crouching
           } else if (player.isOnWater && !isCurrentlyJumping) {
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
            if (player.direction === 'up' || player.direction === 'left') {
                // For UP or LEFT, item should be rendered BENEATH the player
              
              // Render ghost trail BEFORE everything else for these directions
              if (heroImg && isDodgeRolling) {
                  renderGhostTrail(ctx, playerId, heroImg, player);
              }
              
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
              
              // Render ghost trail AFTER everything else for these directions
              if (heroImg && isDodgeRolling) {
                  renderGhostTrail(ctx, playerId, heroImg, player);
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
                heroImageRef,
                heroWaterImageRef,
                heroCrouchImageRef
            });
        } else if (type === 'grass') {
            renderGrass(ctx, entity as InterpolatedGrassData, nowMs, cycleProgress, false, true);
        } else if (type === 'projectile') {
            const projectile = entity as SpacetimeDBProjectile;
            
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
        case 'up_right':   spriteRow = 0; break; // Use up sprite for diagonal up directions
        case 'right':      spriteRow = 1; break;
        case 'down_right': spriteRow = 1; break; // Use right sprite for diagonal down-right
        case 'down':       spriteRow = 2; break;
        case 'down_left':  spriteRow = 2; break; // Use down sprite for diagonal down-left
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