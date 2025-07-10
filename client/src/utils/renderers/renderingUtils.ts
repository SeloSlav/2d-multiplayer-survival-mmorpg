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
    HarvestableResource as SpacetimeDBHarvestableResource,
    Grass as SpacetimeDBGrass,
    Projectile as SpacetimeDBProjectile,
    Shelter as SpacetimeDBShelter,
    PlayerDodgeRollState as SpacetimeDBPlayerDodgeRollState,
    PlantedSeed as SpacetimeDBPlantedSeed,
    RainCollector as SpacetimeDBRainCollector,
    WildAnimal as SpacetimeDBWildAnimal,
    ViperSpittle as SpacetimeDBViperSpittle,
    AnimalCorpse as SpacetimeDBAnimalCorpse
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
// Import unified resource renderer - these functions now work with HarvestableResource
import { renderHarvestableResource } from './unifiedResourceRenderer';
// Import planted seed renderer (will be activated once client bindings are generated)
import { renderPlantedSeed } from './plantedSeedRenderingUtils';
import { renderCampfire } from './campfireRenderingUtils';
import { renderFurnace } from './furnaceRenderingUtils'; // ADDED: Furnace renderer import
import { renderLantern } from './lanternRenderingUtils';
import { renderStash } from './stashRenderingUtils';
import { renderSleepingBag } from './sleepingBagRenderingUtils';
// Import shelter renderer
import { renderShelter } from './shelterRenderingUtils';
// Import rain collector renderer
import { renderRainCollector } from './rainCollectorRenderingUtils';
// Import wild animal renderer
import { renderWildAnimal, renderTamingThoughtBubbles } from './wildAnimalRenderingUtils';
// Import viper spittle renderer
import { renderViperSpittle } from './viperSpittleRenderingUtils';
// Import animal corpse renderer
import { renderAnimalCorpse } from './animalCorpseRenderingUtils';
// Import player corpse renderer
import { renderPlayerCorpse } from './playerCorpseRenderingUtils';
// Import barrel renderer
import { renderBarrel } from './barrelRenderingUtils';
// Import sea stack renderer
import { renderSeaStackSingle } from './seaStackRenderingUtils';
// Import grass renderer
import { renderGrass } from './grassRenderingUtils';
// Import dropped item renderer
import { renderDroppedItem } from './droppedItemRenderingUtils';
// Import projectile renderer
import { renderProjectile } from './projectileRenderingUtils';
import { imageManager } from './imageManager';
import { getItemIcon } from '../itemIconUtils';
import { renderPlayerTorchLight, renderCampfireLight } from './lightRenderingUtils';
import { drawInteractionOutline, drawCircularInteractionOutline, getInteractionOutlineColor } from './outlineUtils';
import { drawDynamicGroundShadow } from './shadowUtils';

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
    heroSprintImageRef: React.RefObject<HTMLImageElement | null>;
    heroIdleImageRef: React.RefObject<HTMLImageElement | null>;
    heroSwimImageRef?: React.RefObject<HTMLImageElement | null>; // Add swim sprite ref (optional)
    heroDodgeImageRef?: React.RefObject<HTMLImageElement | null>; // NEW: Add dodge roll sprite ref (optional)
    lastPositionsRef: React.RefObject<Map<string, { x: number; y: number }>>;
    activeConnections: Map<string, ActiveConnection> | undefined;
    activeEquipments: Map<string, SpacetimeDBActiveEquipment>;
    activeConsumableEffects: Map<string, ActiveConsumableEffect>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    inventoryItems: Map<string, SpacetimeDBInventoryItem>; // Add inventory items for validation
    itemImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
    doodadImagesRef: React.RefObject<Map<string, HTMLImageElement>>;
    shelterImage: HTMLImageElement | null;
    worldMouseX: number | null;
    worldMouseY: number | null;
    localPlayerId?: string;
    animationFrame: number;
    sprintAnimationFrame: number;
    idleAnimationFrame: number;
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
        heroSwimImageRef: React.RefObject<HTMLImageElement | null>;
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
    closestInteractableHarvestableResourceId?: bigint | null;
    closestInteractableDroppedItemId?: bigint | null;
    // New unified single target system (replaces individual resource IDs)
    closestInteractableTarget?: { type: string; id: bigint | number | string; position: { x: number; y: number }; distance: number; isEmpty?: boolean; } | null;
    // NEW: Shelter clipping data for shadow rendering
    shelterClippingData?: Array<{posX: number, posY: number, isDestroyed: boolean}>;
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
    heroSprintImageRef,
    heroIdleImageRef,
    heroSwimImageRef,
    heroDodgeImageRef,
    lastPositionsRef,
    activeConnections,
    activeEquipments,
    activeConsumableEffects,
    itemDefinitions,
    inventoryItems,
    itemImagesRef,
    doodadImagesRef,
    shelterImage,
    worldMouseX,
    worldMouseY,
    localPlayerId,
    animationFrame,
    sprintAnimationFrame,
    idleAnimationFrame,
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
    closestInteractableHarvestableResourceId,
    closestInteractableDroppedItemId,
    // Unified target system (replaces individual resource IDs)
    closestInteractableTarget,
    shelterClippingData,
}: RenderYSortedEntitiesProps) => {
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
            
            // Compare current position with last known position
            if (movementCache.lastKnownPosition) {
                const positionThreshold = 0.1; // Small threshold to avoid floating point precision issues
                const dx = Math.abs(playerForRendering.positionX - movementCache.lastKnownPosition.x);
                const dy = Math.abs(playerForRendering.positionY - movementCache.lastKnownPosition.y);
                hasPositionChanged = dx > positionThreshold || dy > positionThreshold;
            } else {
                // First time seeing this player, initialize position
                movementCache.lastKnownPosition = { x: playerForRendering.positionX, y: playerForRendering.positionY };
                hasPositionChanged = false;
            }
            
            // Update movement cache if position changed
            if (hasPositionChanged) {
                movementCache.lastMovementTime = nowMs;
                movementCache.isCurrentlyMoving = true;
                movementCache.lastKnownPosition = { x: playerForRendering.positionX, y: playerForRendering.positionY };
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
           
           // Choose sprite based on water status FIRST (highest priority), then crouching, but don't switch to water sprite while jumping
           let heroImg: HTMLImageElement | null;
           // For local player, use immediate local crouch state; for others, use server state
           const effectiveIsCrouching = isLocalPlayer && localPlayerIsCrouching !== undefined 
               ? localPlayerIsCrouching 
               : playerForRendering.isCrouching;
           
           // console.log(`[DEBUG] Player ${playerId} image selection - effectiveIsCrouching:`, effectiveIsCrouching, 'isOnWater:', playerForRendering.isOnWater, 'isCurrentlyJumping:', isCurrentlyJumping);
           // console.log(`[DEBUG] Image refs available - heroImageRef:`, !!heroImageRef.current, 'heroWaterImageRef:', !!heroWaterImageRef.current, 'heroCrouchImageRef:', !!heroCrouchImageRef.current);
           
           if (playerForRendering.isOnWater && !isCurrentlyJumping) {
               heroImg = heroWaterImageRef.current; // HIGHEST PRIORITY: Use water sprite when on water (but not jumping)
              // console.log(`[DEBUG] Using water sprite for ${playerId}:`, !!heroImg);
           } else if (effectiveIsCrouching && !playerForRendering.isOnWater) {
               heroImg = heroCrouchImageRef.current; // SECOND PRIORITY: Use crouch sprite when crouching (and NOT on water)
              // console.log(`[DEBUG] Using crouch sprite for ${playerId}:`, !!heroImg);
           } else {
               heroImg = heroImageRef.current; // DEFAULT: Use normal sprite otherwise
              // console.log(`[DEBUG] Using normal sprite for ${playerId}:`, !!heroImg);
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
              
              // console.log(`[DEBUG] Rendering player ${playerId} - heroImg available:`, !!heroImg, 'direction:', playerForRendering.direction);
              if (heroImg) {
                // console.log(`[DEBUG] Calling renderPlayer for ${playerId}`);
                // Choose animation frame based on player state and environment
                let currentAnimFrame: number;
                if (playerForRendering.isOnWater) {
                  // Swimming animations - ALL swimming uses idle animation frames from water sprite
                  currentAnimFrame = idleAnimationFrame; // Swimming sprite uses idle frames for all swimming movement
                } else {
                  // Land animations
                  if (!isPlayerMoving) {
                    currentAnimFrame = idleAnimationFrame; // Use idle animation when not moving
                  } else if (playerForRendering.isSprinting) {
                    currentAnimFrame = sprintAnimationFrame; // Use sprint animation when sprinting
                  } else {
                    currentAnimFrame = animationFrame; // Use walking animation for normal movement
                  }
                }
                // For swimming players, render only the bottom half (underwater portion) - but skip underwater shadow since it was rendered earlier
                const renderHalf = (playerForRendering.isOnWater && !playerForRendering.isDead && !playerForRendering.isKnockedOut) ? 'bottom' : 'full';
                
                renderPlayer(
                        ctx, 
                        playerForRendering, 
                        heroImg, 
                        heroSprintImageRef.current || heroImg, 
                        heroIdleImageRef.current || heroImg,
                        heroCrouchImageRef.current || heroImg, // crouch sprite
                        heroSwimImageRef?.current || heroImg, // swim sprite
                        heroDodgeImageRef?.current || heroImg, // NEW: dodge roll sprite
                        isOnline, 
                        isPlayerMoving, 
                        currentlyHovered,
                  currentAnimFrame, // Use appropriate animation frame
                  nowMs, 
                  jumpOffset,
                  isPersistentlyHovered,
                  activeConsumableEffects,
                  localPlayerId,
                  false, // isCorpse
                  cycleProgress, // cycleProgress
                  localPlayerIsCrouching, // NEW: pass local crouch state for optimistic rendering
                  renderHalf // Render full player for normal Y-sorting
                );
              } else {
                console.log(`[DEBUG] heroImg is null for player ${playerId} - cannot render`);
              }
            } else { // This covers 'down' or 'right'
                // For DOWN or RIGHT, item should be rendered ABOVE the player
              // console.log(`[DEBUG] Rendering player ${playerId} (down/right) - heroImg available:`, !!heroImg, 'direction:', playerForRendering.direction);
              if (heroImg) {
                // console.log(`[DEBUG] Calling renderPlayer for ${playerId} (down/right)`);
                // Choose animation frame based on player state and environment
                let currentAnimFrame: number;
                if (playerForRendering.isOnWater) {
                  // Swimming animations - ALL swimming uses idle animation frames from water sprite
                  currentAnimFrame = idleAnimationFrame; // Swimming sprite uses idle frames for all swimming movement
                } else {
                  // Land animations
                  if (!isPlayerMoving) {
                    currentAnimFrame = idleAnimationFrame; // Use idle animation when not moving
                  } else if (playerForRendering.isSprinting) {
                    currentAnimFrame = sprintAnimationFrame; // Use sprint animation when sprinting
                  } else {
                    currentAnimFrame = animationFrame; // Use walking animation for normal movement
                  }
                }
                // For swimming players, render only the bottom half (underwater portion) - but skip underwater shadow since it was rendered earlier
                const renderHalf = (playerForRendering.isOnWater && !playerForRendering.isDead && !playerForRendering.isKnockedOut) ? 'bottom' : 'full';
                
                renderPlayer(
                    ctx, 
                    playerForRendering, 
                    heroImg, 
                    heroSprintImageRef.current || heroImg, 
                    heroIdleImageRef.current || heroImg,
                    heroCrouchImageRef.current || heroImg, // crouch sprite
                    heroSwimImageRef?.current || heroImg, // swim sprite
                    heroDodgeImageRef?.current || heroImg, // NEW: dodge roll sprite
                    isOnline, 
                    isPlayerMoving, 
                    currentlyHovered,
                  currentAnimFrame, // Use appropriate animation frame
                  nowMs, 
                  jumpOffset,
                  isPersistentlyHovered,
                  activeConsumableEffects,
                  localPlayerId,
                  false, // isCorpse
                  cycleProgress, // cycleProgress
                  localPlayerIsCrouching, // NEW: pass local crouch state for optimistic rendering
                  renderHalf // Render full player for normal Y-sorting
                );
              } else {
                console.log(`[DEBUG] heroImg is null for player ${playerId} (down/right) - cannot render`);
              }
              if (canRenderItem && equipment) {
                    renderEquippedItem(ctx, playerForRendering, equipment, itemDef!, itemDefinitions, itemImg!, nowMs, jumpOffset, itemImagesRef.current, activeConsumableEffects, localPlayerId);
              }
              
              // Ghost trail disabled for cleaner dodge roll experience
              // if (heroImg && isDodgeRolling) {
              //     renderGhostTrail(ctx, playerId, heroImg, playerForRendering);
              // }
           }

           // Check if this knocked out player is the closest interactable target
           const isTheClosestKnockedOutTarget = closestInteractableTarget?.type === 'knocked_out_player' && closestInteractableTarget?.id === playerId;

           // Draw outline for knocked out players who are the closest interactable target
           if (isTheClosestKnockedOutTarget && playerForRendering.isKnockedOut && !playerForRendering.isDead) {
               const outlineColor = getInteractionOutlineColor('revive');
               // Use an oval outline that's wider than tall to represent a lying down player
               drawCircularInteractionOutline(ctx, playerForRendering.positionX, playerForRendering.positionY, 40, cycleProgress, outlineColor);
           }
        } else if (type === 'tree') {
            // Render tree with its shadow in the normal order (shadow first, then tree)
            renderTree(ctx, entity as SpacetimeDBTree, nowMs, cycleProgress, false, false, localPlayerPosition);
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
        } else if (type === 'harvestable_resource') {
            const resource = entity as SpacetimeDBHarvestableResource;
            
            // Use unified renderer that handles all plant types internally
            renderHarvestableResource(ctx, resource, nowMs, cycleProgress);
            
            // Note: Green circle outline removed - interaction indicators now handled by cyberpunk "E" labels only
        } else if (type === 'campfire') {
            const campfire = entity as SpacetimeDBCampfire;
            const isTheClosestTarget = closestInteractableTarget?.type === 'campfire' && closestInteractableTarget?.id === campfire.id;
            renderCampfire(ctx, campfire, nowMs, cycleProgress);
            
            // Draw outline only if this is THE closest interactable target
            if (isTheClosestTarget) {
                const outlineColor = getInteractionOutlineColor('open');
                drawInteractionOutline(ctx, campfire.posX, campfire.posY - 48, 64, 96, cycleProgress, outlineColor);
            }
        } else if (type === 'furnace') { // ADDED: Furnace handling (same as campfire)
            const furnace = entity as any; // Furnace type from generated types
            const isTheClosestTarget = closestInteractableTarget?.type === 'furnace' && closestInteractableTarget?.id === furnace.id;
            renderFurnace(ctx, furnace, nowMs, cycleProgress);
            
            // Draw outline only if this is THE closest interactable target
            if (isTheClosestTarget) {
                const outlineColor = getInteractionOutlineColor('open');
                drawInteractionOutline(ctx, furnace.posX, furnace.posY - 64, 96, 128, cycleProgress, outlineColor); // Standard 96x96 furnace size
            }
        } else if (type === 'lantern') {
            const lantern = entity as any; // Type will be Lantern from generated types
            const isTheClosestTarget = closestInteractableTarget?.type === 'lantern' && closestInteractableTarget?.id === lantern.id;
            renderLantern(ctx, lantern, nowMs, cycleProgress);
            
            // Draw outline only if this is THE closest interactable target
            if (isTheClosestTarget) {
                const outlineColor = getInteractionOutlineColor('open');
                // Make outline taller (height: 56 -> 72) and extend more downward (Y offset: -48 -> -40)
                drawInteractionOutline(ctx, lantern.posX, lantern.posY - 40, 48, 72, cycleProgress, outlineColor);
            }
        } else if (type === 'dropped_item') {
            const droppedItem = entity as SpacetimeDBDroppedItem;
            const itemDef = itemDefinitions.get(droppedItem.itemDefId.toString());
            renderDroppedItem({ ctx, item: droppedItem, itemDef, nowMs, cycleProgress });
        } else if (type === 'stash') {
            const stash = entity as SpacetimeDBStash;
            const isTheClosestTarget = closestInteractableTarget?.type === 'stash' && closestInteractableTarget?.id === stash.id;
            
            // Always render the stash (will show nothing if hidden, but that's okay)
            renderStash(ctx, stash, nowMs, cycleProgress);
            
            // Draw outline if this is the closest target, even if stash is hidden
            // This allows players to see where hidden stashes are when close enough
            if (isTheClosestTarget) {
                const outlineColor = getInteractionOutlineColor('open');
                drawInteractionOutline(ctx, stash.posX, stash.posY - 24, 48, 48, cycleProgress, outlineColor);
            }
        } else if (type === 'wooden_storage_box') {
            // Render box normally, its applyStandardDropShadow will handle the shadow
            const box = entity as SpacetimeDBWoodenStorageBox;
            const isTheClosestTarget = closestInteractableTarget?.type === 'box' && closestInteractableTarget?.id === box.id;
            renderWoodenStorageBox(ctx, box, nowMs, cycleProgress);
            
            // Draw outline only if this is THE closest interactable target
            if (isTheClosestTarget) {
                const outlineColor = getInteractionOutlineColor('open');
                drawInteractionOutline(ctx, box.posX, box.posY - 58, 64, 72, cycleProgress, outlineColor);
            }
        } else if (type === 'player_corpse') {
            const corpse = entity as SpacetimeDBPlayerCorpse;
            
            renderCorpse({ 
                ctx, 
                corpse, 
                nowMs, 
                itemImagesRef,
                heroImageRef,
                heroWaterImageRef,
                heroCrouchImageRef,
                heroSwimImageRef: heroSwimImageRef || { current: null }
            });
            
            // Check if this corpse is the closest interactable target
            const isTheClosestTarget = closestInteractableTarget && 
                                     closestInteractableTarget.type === 'corpse' && 
                                     closestInteractableTarget.id.toString() === corpse.id.toString();
            
            // Draw outline only if this is THE closest interactable target
            if (isTheClosestTarget) {
                const outlineColor = getInteractionOutlineColor('open');
                // Make outline wider and positioned lower for lying down corpse (rectangular shape)
                drawInteractionOutline(ctx, corpse.posX, corpse.posY + 0, 80, 72, cycleProgress, outlineColor); // Made taller: 48 → 72
            }
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
        } else if (type === 'planted_seed') {
            const plantedSeed = entity as SpacetimeDBPlantedSeed;
            const plantedSeedImg = doodadImagesRef.current?.get('planted_seed.png');
            renderPlantedSeed(ctx, plantedSeed, nowMs, cycleProgress, plantedSeedImg);
        } else if (type === 'rain_collector') {
            const rainCollector = entity as SpacetimeDBRainCollector;
            renderRainCollector(ctx, rainCollector, nowMs, cycleProgress);
            
            // Check if this rain collector is the closest interactable target
            const isTheClosestTarget = closestInteractableTarget && 
                                     closestInteractableTarget.type === 'rain_collector' && 
                                     closestInteractableTarget.id.toString() === rainCollector.id.toString();
            
            // Draw outline only if this is THE closest interactable target
            if (isTheClosestTarget) {
                const outlineColor = getInteractionOutlineColor('open');
                drawInteractionOutline(ctx, rainCollector.posX, rainCollector.posY, 96 + 20, 128 + 20, cycleProgress, outlineColor);
            }
        } else if (type === 'wild_animal') {
            const wildAnimal = entity as SpacetimeDBWildAnimal;
            renderWildAnimal({
                ctx,
                animal: wildAnimal,
                nowMs,
                cycleProgress,
                animationFrame,
                localPlayerPosition: localPlayerPosition || { x: 0, y: 0 },
            });
            
            // Render thought bubbles for tamed animals (hearts, crying, etc.)
            renderTamingThoughtBubbles({
                ctx,
                animal: wildAnimal,
                nowMs,
            });
        } else if (type === 'viper_spittle') {
            const viperSpittle = entity as SpacetimeDBViperSpittle;
            renderViperSpittle({
                ctx,
                spittle: viperSpittle,
                currentTimeMs: nowMs,
            });
        } else if (type === 'animal_corpse') {
            const animalCorpse = entity as SpacetimeDBAnimalCorpse;
            renderAnimalCorpse(ctx, animalCorpse, nowMs);
        } else if (type === 'barrel') {
            const barrel = entity as any; // Use any for now, will be properly typed
            // Check if this barrel is the closest interactable target  
            const isTheClosestTarget = closestInteractableTarget?.type === 'barrel' && closestInteractableTarget?.id === barrel.id;
            // Render barrel using imported function
            renderBarrel(ctx, barrel, nowMs, cycleProgress);
            
            // Draw outline only if this is THE closest interactable target
            if (isTheClosestTarget) {
                const outlineColor = getInteractionOutlineColor('open');
                drawInteractionOutline(ctx, barrel.posX, barrel.posY - 24, 48, 48, cycleProgress, outlineColor);
            }
        } else if (type === 'sea_stack') {
            const seaStack = entity as any; // Sea stack from SpacetimeDB
            // Render full sea stack with underwater tinting zones
            renderSeaStackSingle(ctx, seaStack, doodadImagesRef.current, cycleProgress, nowMs, 'full');
        } else if (type === 'shelter') {
            // Shelters are fully rendered in the first pass, including shadows.
            // No action needed in this second (shadow-only) pass.
        } else {
            console.warn('Unhandled entity type for Y-sorting (first pass):', type, entity);
        } 
    });

    // Second Pass: Render ONLY the dynamic ground shadows for entities that need special shadow handling.
    // UPDATED: Trees now render their shadows inline with their entities for proper Y-sorting.
    // This pass is kept for any future entities that might need special shadow treatment.
    ySortedEntities.forEach(({ type, entity }) => {
        if (type === 'tree') {
            // Trees now render their shadows inline with the entity for proper Y-sorting
        } else if (type === 'stone') {
            // Stones render their shadows inline with the entity
        } else if (type === 'shelter') {
            // Shelters are fully rendered in the first pass, including shadows.
            // No action needed in this second (shadow-only) pass.
        } else if (type === 'harvestable_resource') {
            // Harvestable resources are fully rendered in the first pass - no second pass needed
        } else if (type === 'campfire') {
            // Campfires handle their own shadows, no separate pass needed here generally
        } else if (type === 'furnace') { // ADDED: Furnace second pass
            // Furnaces are fully rendered in the first pass - no second pass needed (same as campfires)
        } else if (type === 'lantern') {
            // Lanterns are fully rendered in the first pass - no second pass needed
        } else if (type === 'dropped_item') {
            // Dropped items handle their own shadows
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
        } else if (type === 'planted_seed') {
            // Planted seeds are fully rendered in the first pass - no second pass needed
        } else if (type === 'rain_collector') {
            // Rain collectors are fully rendered in the first pass - no second pass needed
        } else if (type === 'wild_animal') {
            // Wild animals are rendered separately in GameCanvas - no second pass needed
        } else if (type === 'viper_spittle') {
            // Viper spittle is rendered separately in GameCanvas - no second pass needed
        } else if (type === 'animal_corpse') {
            // Animal corpses are fully rendered in the first pass - no second pass needed
        } else if (type === 'barrel') {
            // Barrels are fully rendered in the first pass - no second pass needed
        } else if (type === 'sea_stack') {
            // Sea stacks are fully rendered in the first pass - no second pass needed
        } else {
            console.warn('Unhandled entity type for Y-sorting (second pass):', type, entity);
        }
    });
};
