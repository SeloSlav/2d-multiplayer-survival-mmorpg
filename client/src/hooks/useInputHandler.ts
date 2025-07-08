import { useEffect, useRef, useState, useCallback, RefObject } from 'react';
import * as SpacetimeDB from '../generated';
import { DbConnection, Player, ItemDefinition, ActiveEquipment, WoodenStorageBox, Stash } from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import { PlacementItemInfo, PlacementActions } from './usePlacementManager'; // Assuming usePlacementManager exports these
import React from 'react';
import { usePlayerActions } from '../contexts/PlayerActionsContext';
import { JUMP_DURATION_MS, JUMP_HEIGHT_PX, HOLD_INTERACTION_DURATION_MS } from '../config/gameConfig'; // <<< ADDED IMPORT
import { isPlacementTooFar } from '../utils/renderers/placementRenderingUtils';
import { 
    InteractableTarget, 
    InteractionTargetType,
    isTapInteraction, 
    isHoldInteraction, 
    isInterfaceInteraction,
    getHoldDuration,
    hasSecondaryHoldAction,
    getSecondaryHoldDuration,
    getActionType,
    formatTargetForLogging,
    isTargetValid
} from '../types/interactions';
import { hasWaterContent, getWaterContent, getWaterCapacity, isWaterContainer } from '../utils/waterContainerHelpers';
import { 
    isCampfire,
    isHarvestableResource,
    isDroppedItem,
    isWoodenStorageBox,
    isStash,
    isPlayerCorpse,
    isSleepingBag,
    isKnockedOutPlayer,
    isRainCollector,
    isLantern,
    isBarrel
} from '../utils/typeGuards';

// Ensure HOLD_INTERACTION_DURATION_MS is defined locally if not already present
// If it was already defined (e.g., as `const HOLD_INTERACTION_DURATION_MS = 250;`), this won't change it.
// If it was missing, this adds it.
export const REVIVE_HOLD_DURATION_MS = 3000; // 3 seconds for reviving knocked out players

// --- Constants (Copied from GameCanvas) ---
const SWING_COOLDOWN_MS = 500;

// Define a comprehensive props interface for the hook
interface InputHandlerProps {
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    connection: DbConnection | null;
    localPlayerId?: string;
    localPlayer: Player | undefined | null;
    activeEquipments: Map<string, ActiveEquipment>;
    itemDefinitions: Map<string, ItemDefinition>;
    inventoryItems: Map<string, SpacetimeDB.InventoryItem>;
    placementInfo: PlacementItemInfo | null;
    placementActions: PlacementActions;
    worldMousePos: { x: number | null; y: number | null };
    
    // UNIFIED INTERACTION TARGET - replaces all individual closestInteractable* props
    closestInteractableTarget: InteractableTarget | null;
    
    // Essential entity maps for validation and data lookup
    woodenStorageBoxes: Map<string, WoodenStorageBox>;
    stashes: Map<string, Stash>;
    players: Map<string, Player>;
    
    onSetInteractingWith: (target: any | null) => void;
    isMinimapOpen: boolean;
    setIsMinimapOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isChatting: boolean;
    isInventoryOpen: boolean;
    isGameMenuOpen: boolean;
    isSearchingCraftRecipes?: boolean;
    isFishing: boolean;
    setMusicPanelVisible: React.Dispatch<React.SetStateAction<boolean>>;

   
}

// --- Hook Return Value Interface ---
// REMOVED inputState from here. It's now handled by useMovementInput
export interface InputHandlerState {
    // State needed for rendering or other components
    interactionProgress: InteractionProgressState | null;
    isActivelyHolding: boolean;
    currentJumpOffsetY: number; // <<< ADDED
    isAutoAttacking: boolean; // Auto-attack state
    isCrouching: boolean; // Local crouch state for immediate visual feedback
    // Function to be called each frame by the game loop
    processInputsAndActions: () => void;
}

interface InteractionProgressState {
    targetId: number | bigint | string | null;
    targetType: InteractionTargetType;
    startTime: number;
}

// Helper function to convert direction string to vector
const getDirectionVector = (direction: string): { dx: number; dy: number } => {
    switch (direction) {
        case 'up': return { dx: 0, dy: -1 };
        case 'down': return { dx: 0, dy: 1 };
        case 'left': return { dx: -1, dy: 0 };
        case 'right': return { dx: 1, dy: 0 };
        // Handle diagonal directions from dodge rolls
        case 'up_left': return { dx: -1, dy: -1 };
        case 'up_right': return { dx: 1, dy: -1 };
        case 'down_left': return { dx: -1, dy: 1 };
        case 'down_right': return { dx: 1, dy: 1 };
        default:
            console.warn('[getDirectionVector] Unknown direction:', direction, 'defaulting to down');
            return { dx: 0, dy: 1 }; // Default to down
    }
};

export const useInputHandler = ({
    canvasRef,
    connection,
    localPlayerId,
    localPlayer,
    activeEquipments,
    itemDefinitions,
    inventoryItems,
    placementInfo,
    placementActions,
    worldMousePos,
    
    // UNIFIED INTERACTION TARGET - single source of truth
    closestInteractableTarget,
    
    // Essential entity maps for validation
    woodenStorageBoxes,
    stashes,
    players,
    
    onSetInteractingWith,
    isMinimapOpen,
    setIsMinimapOpen,
    isChatting,
    isSearchingCraftRecipes,
    isInventoryOpen,
    isGameMenuOpen,
    isFishing,
    setMusicPanelVisible,
}: InputHandlerProps): InputHandlerState => {
    // console.log('[useInputHandler IS RUNNING] isInventoryOpen:', isInventoryOpen);
    // Get player actions from the context instead of props
    const { jump } = usePlayerActions();

    // --- Client-side animation tracking ---
    const clientJumpStartTimes = useRef<Map<string, number>>(new Map());
    const lastKnownServerJumpTimes = useRef<Map<string, number>>(new Map()); // Track last known server timestamps

    // --- Internal State and Refs ---
    const [isAutoAttacking, setIsAutoAttacking] = useState(false);
    const [isCrouching, setIsCrouching] = useState(false);
    const pendingCrouchToggleRef = useRef<boolean>(false); // Track pending crouch requests

    const keysPressed = useRef<Set<string>>(new Set());
    const isEHeldDownRef = useRef<boolean>(false);
    const isMouseDownRef = useRef<boolean>(false);
    const lastClientSwingAttemptRef = useRef<number>(0);
    const lastServerSwingTimestampRef = useRef<number>(0); // To store server-confirmed swing time
    const eKeyDownTimestampRef = useRef<number>(0);
    const eKeyHoldTimerRef = useRef<NodeJS.Timeout | number | null>(null); // Use number for browser timeout ID
    const [interactionProgress, setInteractionProgress] = useState<InteractionProgressState | null>(null);
    const [isActivelyHolding, setIsActivelyHolding] = useState<boolean>(false);
    // Use ref for jump offset to avoid re-renders every frame
    const currentJumpOffsetYRef = useRef<number>(0);

    const lastMovementDirectionRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 1 });

    // Refs for dependencies to avoid re-running effect too often
    const placementActionsRef = useRef(placementActions);
    const connectionRef = useRef(connection);
    const localPlayerRef = useRef(localPlayer);
    const activeEquipmentsRef = useRef(activeEquipments);
    // UNIFIED TARGET REF - single source of truth for current interaction target
    // NOTE: This will be null until parent components are updated to pass closestInteractableTarget prop
    const closestTargetRef = useRef<InteractableTarget | null>(null);
    const onSetInteractingWithRef = useRef(onSetInteractingWith);
    const worldMousePosRefInternal = useRef(worldMousePos); // Shadow prop name
    const woodenStorageBoxesRef = useRef(woodenStorageBoxes); // <<< ADDED Ref
    const stashesRef = useRef(stashes); // Added stashesRef
    const playersRef = useRef(players); // Added playersRef for knocked out revive
    const itemDefinitionsRef = useRef(itemDefinitions); // <<< ADDED Ref

    // Add after existing refs in the hook
    const isRightMouseDownRef = useRef<boolean>(false);

    // --- Derive input disabled state based ONLY on player death --- 
    const isPlayerDead = localPlayer?.isDead ?? false;

    // --- Effect to reset sprint state if player dies --- 
    useEffect(() => {
        // Player death no longer needs to manage sprinting here.
        // It's handled by the movement hooks.

        // Also clear E hold state if player dies
        if (localPlayer?.isDead && isEHeldDownRef.current) {
            // console.log(`[E-Timer] *** PLAYER DEATH CLEARING TIMER *** Timer ID: ${eKeyHoldTimerRef.current}`);
            isEHeldDownRef.current = false;
            if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current as number);
            eKeyHoldTimerRef.current = null;
            setInteractionProgress(null);
            setIsActivelyHolding(false);
        }
        // Also clear auto-attack state if player dies
        if (localPlayer?.isDead && isAutoAttacking) {
            setIsAutoAttacking(false);
        }
        // Auto-walk removed - movement handled by usePredictedMovement
    }, [localPlayer?.isDead]); // Depend on death state and the reducer callback

    // Update refs when props change
    useEffect(() => { placementActionsRef.current = placementActions; }, [placementActions]);
    useEffect(() => { connectionRef.current = connection; }, [connection]);
    useEffect(() => { localPlayerRef.current = localPlayer; }, [localPlayer]);
    useEffect(() => { activeEquipmentsRef.current = activeEquipments; }, [activeEquipments]);
    
    // Synchronize local crouch state with server state to prevent desync
    // Don't override optimistic state while pending requests are in flight
    useEffect(() => {
        if (localPlayer?.isCrouching !== undefined && !pendingCrouchToggleRef.current) {
            setIsCrouching(localPlayer.isCrouching);
        }
    }, [localPlayer?.isCrouching]);
    // Update closest target ref when target changes
    useEffect(() => {
        closestTargetRef.current = closestInteractableTarget;
    }, [closestInteractableTarget]);
    useEffect(() => { onSetInteractingWithRef.current = onSetInteractingWith; }, [onSetInteractingWith]);
    useEffect(() => { worldMousePosRefInternal.current = worldMousePos; }, [worldMousePos]);
    useEffect(() => { woodenStorageBoxesRef.current = woodenStorageBoxes; }, [woodenStorageBoxes]); // <<< ADDED Effect
    useEffect(() => { stashesRef.current = stashes; }, [stashes]); // Added stashesRef effect
    useEffect(() => { playersRef.current = players; }, [players]); // Added playersRef effect
    useEffect(() => { itemDefinitionsRef.current = itemDefinitions; }, [itemDefinitions]); // <<< ADDED Effect

    // Jump offset calculation is now handled directly in processInputsAndActions
    // to avoid React re-renders every frame

    // --- Timer Management Functions (Outside of useEffect to avoid cleanup issues) ---
    const startHoldTimer = useCallback((holdTarget: InteractionProgressState, connection: DbConnection) => {
        // Calculate duration based on target type using helper functions
        const currentTarget = closestTargetRef.current;
        const duration = currentTarget && holdTarget.targetType === 'knocked_out_player' ? 
            getHoldDuration(currentTarget) : 
            currentTarget && hasSecondaryHoldAction(currentTarget) ? 
                getSecondaryHoldDuration(currentTarget) : 
                HOLD_INTERACTION_DURATION_MS;

        console.log(`[E-Timer] Setting up timer for ${duration}ms - holdTarget:`, holdTarget);
        const timerId = setTimeout(() => {
            try {
                // console.log(`[E-Timer] *** TIMER FIRED *** after ${duration}ms for:`, holdTarget);
                // Timer fired, so this is a successful HOLD action.
                // Re-check if we are still close to the original target using unified system
                const currentTarget = closestTargetRef.current;
                console.log(`[E-Timer] Current target check:`, currentTarget ? formatTargetForLogging(currentTarget) : 'null');

                let actionTaken = false;

                // Validate that we still have the same target
                const targetStillValid = currentTarget && 
                    currentTarget.type === holdTarget.targetType && 
                    currentTarget.id === holdTarget.targetId &&
                    isTargetValid(currentTarget);

                if (targetStillValid) {
                    switch (holdTarget.targetType) {
                        case 'knocked_out_player':
                            console.log('[E-Hold ACTION] Attempting to revive player:', holdTarget.targetId);
                            connection.reducers.reviveKnockedOutPlayer(Identity.fromString(holdTarget.targetId as string));
                            actionTaken = true;
                            break;
                        case 'water':
                            console.log('[E-Hold ACTION] Attempting to drink water');
                            connection.reducers.drinkWater();
                            actionTaken = true;
                            break;
                        case 'campfire':
                            console.log('[E-Hold ACTION] Attempting to toggle campfire burning:', holdTarget.targetId);
                            connection.reducers.toggleCampfireBurning(Number(holdTarget.targetId));
                            actionTaken = true;
                            break;
                        case 'furnace':
                            console.log('[E-Hold ACTION] Attempting to toggle furnace burning:', holdTarget.targetId);
                            connection.reducers.toggleFurnaceBurning(Number(holdTarget.targetId));
                            actionTaken = true;
                            break;
                        case 'lantern':
                            if (currentTarget.data?.isEmpty) {
                                console.log('[E-Hold ACTION] Attempting to pickup empty lantern:', holdTarget.targetId);
                                connection.reducers.pickupLantern(Number(holdTarget.targetId));
                                actionTaken = true;
                            } else {
                                console.log('[E-Hold ACTION] Attempting to toggle lantern burning:', holdTarget.targetId);
                                connection.reducers.toggleLantern(Number(holdTarget.targetId));
                                actionTaken = true;
                            }
                            break;
                        case 'box':
                            if (currentTarget.data?.isEmpty) {
                                console.log('[E-Hold ACTION] Attempting to pickup storage box:', holdTarget.targetId);
                                connection.reducers.pickupStorageBox(Number(holdTarget.targetId));
                                actionTaken = true;
                            } else {
                                console.log('[E-Hold FAILED] Storage box is no longer empty');
                            }
                            break;
                        case 'stash':
                            console.log('[E-Hold ACTION] Attempting to toggle stash visibility:', holdTarget.targetId);
                            connection.reducers.toggleStashVisibility(Number(holdTarget.targetId));
                            actionTaken = true;
                            break;
                        default:
                            console.log('[E-Hold FAILED] Unknown target type:', holdTarget.targetType);
                    }
                } else {
                    console.log('[E-Hold FAILED] Target no longer valid. Expected:', holdTarget.targetType, holdTarget.targetId, 'Current:', currentTarget ? formatTargetForLogging(currentTarget) : 'null');
                }

                // Clean up UI and state
                // console.log(`[E-Timer] *** TIMER COMPLETE *** Action taken:`, actionTaken);
                setInteractionProgress(null);
                setIsActivelyHolding(false);
                isEHeldDownRef.current = false; // Reset the master hold flag
                eKeyHoldTimerRef.current = null; // Clear the timer ref itself
            } catch (error) {
                // console.error(`[E-Timer] ERROR in timer callback:`, error);
                // Clean up state even if there was an error
                setInteractionProgress(null);
                setIsActivelyHolding(false);
                isEHeldDownRef.current = false;
                eKeyHoldTimerRef.current = null;
            }
        }, duration);

        eKeyHoldTimerRef.current = timerId;
        // console.log(`[E-Timer] Timer assigned to ref. Timer ID:`, timerId);

        // Debug: Check if timer ref gets cleared unexpectedly
        setTimeout(() => {
            if (eKeyHoldTimerRef.current === null) {
                // console.log(`[E-Timer] *** TIMER REF WAS CLEARED *** Timer ${timerId} ref became null before 250ms!`);
            } else if (eKeyHoldTimerRef.current !== timerId) {
                // console.log(`[E-Timer] *** TIMER REF CHANGED *** Timer ${timerId} ref is now:`, eKeyHoldTimerRef.current);
            } else {
                // console.log(`[E-Timer] Timer ${timerId} ref still valid at 100ms checkpoint`);
            }
        }, 100);
    }, []);

    const clearHoldTimer = useCallback(() => {
        if (eKeyHoldTimerRef.current) {
            // console.log(`[E-Timer] Clearing timer manually. Timer ID:`, eKeyHoldTimerRef.current);
            clearTimeout(eKeyHoldTimerRef.current as number);
            eKeyHoldTimerRef.current = null;
        }
    }, []);

    // --- Attempt Swing Function (extracted from canvas click logic) ---
    const attemptSwing = useCallback(() => {
        // 🎣 FISHING INPUT FIX: Disable weapon swinging while fishing
        if (isFishing) {
            console.log('[Input] Swing blocked - player is fishing');
            return;
        }
        
        if (!connectionRef.current?.reducers || !localPlayerId) return;

        const localEquipment = activeEquipmentsRef.current?.get(localPlayerId);
        const itemDef = itemDefinitionsRef.current?.get(String(localEquipment?.equippedItemDefId));

        if (!localEquipment || localEquipment.equippedItemDefId === null || localEquipment.equippedItemInstanceId === null) {
            // Unarmed
            const nowUnarmed = Date.now();
            if (nowUnarmed - lastClientSwingAttemptRef.current < SWING_COOLDOWN_MS) return;
            if (nowUnarmed - Number(localEquipment?.swingStartTimeMs || 0) < SWING_COOLDOWN_MS) return;
            try {
                // 🔊 IMMEDIATE SOUND: Play weapon swing sound for instant feedback
                // playWeaponSwingSound(0.8);
                connectionRef.current.reducers.useEquippedItem();
                lastClientSwingAttemptRef.current = nowUnarmed;
                lastServerSwingTimestampRef.current = nowUnarmed;
            } catch (err) {
                console.error("[attemptSwing Unarmed] Error calling useEquippedItem reducer:", err);
            }
        } else {
            // Armed (melee/tool)
            if (!itemDef) return;
            if (itemDef.name === "Bandage" || itemDef.name === "Selo Olive Oil" || itemDef.name === "Hunting Bow" || itemDef.category === SpacetimeDB.ItemCategory.RangedWeapon) {
                // Ranged/Bandage/Selo Olive Oil should not be triggered by swing
                return;
            }
            const now = Date.now();
            const attackIntervalMs = itemDef.attackIntervalSecs ? itemDef.attackIntervalSecs * 1000 : SWING_COOLDOWN_MS;
            if (now - lastServerSwingTimestampRef.current < attackIntervalMs) return;
            if (now - lastClientSwingAttemptRef.current < attackIntervalMs) return;
            if (now - Number(localEquipment.swingStartTimeMs) < attackIntervalMs) return;
            try {
                // 🔊 IMMEDIATE SOUND: Only play generic swing for non-resource tools
                const activeItem = activeEquipmentsRef.current.get(localPlayerId || '');
                const itemDef = itemDefinitionsRef.current.get(activeItem?.equippedItemDefId?.toString() || '');
                
                // Don't play immediate sounds for resource gathering tools - let server handle those
                const isResourceTool = itemDef?.name && (
                    itemDef.name.toLowerCase().includes('hatchet') || 
                    itemDef.name.toLowerCase().includes('axe') ||
                    itemDef.name.toLowerCase().includes('pickaxe') ||
                    itemDef.name.toLowerCase().includes('pick')
                );
                
                if (!isResourceTool) {
                    // Play immediate sound for combat weapons and other tools
                    // playWeaponSwingSound(0.8);
                }
                connectionRef.current.reducers.useEquippedItem();
                lastClientSwingAttemptRef.current = now;
                lastServerSwingTimestampRef.current = now;
            } catch (err) {
                console.error("[attemptSwing Armed] Error calling useEquippedItem reducer:", err);
            }
        }
    }, [localPlayerId, isFishing]); // 🎣 FISHING INPUT FIX: Add isFishing dependency

    // --- Input Event Handlers ---
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();
            
            // Enhanced chat input detection to prevent race conditions
            const target = event.target as Element;
            const activeElement = document.activeElement as Element;
            
            // Check if ANY input is currently focused (either event target or active element)
            const isChatInputFocused = target?.getAttribute('data-is-chat-input') === 'true' || 
                                     target?.closest('[data-is-chat-input="true"]') !== null ||
                                     target?.tagName === 'INPUT' ||
                                     target?.tagName === 'TEXTAREA' ||
                                     activeElement?.getAttribute('data-is-chat-input') === 'true' ||
                                     activeElement?.tagName === 'INPUT' ||
                                     activeElement?.tagName === 'TEXTAREA';
            
            const isUIFocused = isChatting || isGameMenuOpen || !!isSearchingCraftRecipes || isChatInputFocused;
            
            if (isUIFocused) {
                console.log('[InputHandler] Input blocked - UI focused:', { 
                    key,
                    isChatting, 
                    isGameMenuOpen, 
                    isSearchingCraftRecipes, 
                    isChatInputFocused,
                    targetTag: target?.tagName,
                    targetDataAttr: target?.getAttribute('data-is-chat-input'),
                    activeElement: document.activeElement?.tagName,
                    activeElementDataAttr: document.activeElement?.getAttribute('data-is-chat-input')
                });
                
                // If user is trying to use space but chat input is blocking, try to clear focus
                // Note: Removed F key from this check as it interferes with typing 'f' in inputs
                if (key === ' ' && isChatInputFocused && !isChatting && !isSearchingCraftRecipes) {
                    console.log('[InputHandler] Attempting to clear stuck chat input focus');
                    forceClearInputFocus();
                }
                
                return;
            }

            // This block prevents non-essential game actions from firing while inventory/map is open
            const allowedKeysInUI = ['i', 'tab', 'escape', 'm', 'g']; // 'g' is now allowed
            if ((isInventoryOpen || isMinimapOpen) && !allowedKeysInUI.includes(key)) {
                return;
            }

            // Handle toggles first, as they should work even if other conditions fail
            if (!event.repeat) {
                switch (key) {
                    case 'z':
                        setIsAutoAttacking(prev => {
                            const newState = !prev;
                            if (newState) {
                                // Trigger immediate swing when enabling auto-attack
                                setTimeout(() => attemptSwing(), 0);
                            }
                            return newState;
                        });
                        return; // Handled
                    case 'c':
                        // Check if player is on water before allowing crouch toggle
                        if (localPlayerRef.current?.isOnWater) {
                            console.log('[Input] Crouch blocked - player is on water');
                            return; // Don't allow crouching on water
                        }
                        setIsCrouching(prev => {
                            pendingCrouchToggleRef.current = true; // Mark as pending
                            connectionRef.current?.reducers.toggleCrouch();
                            // Clear pending flag after a brief delay (server should respond by then)
                            setTimeout(() => {
                                pendingCrouchToggleRef.current = false;
                            }, 200); // 200ms should be enough for server response
                            return !prev;
                        });
                        return; // Handled
                    case 'g': // Handle minimap toggle here
                        setIsMinimapOpen((prev: boolean) => !prev);
                        event.preventDefault(); // Prevent typing 'g' in chat etc.
                        return;
                    case 'm': // Handle music panel toggle here
                        setMusicPanelVisible(prev => !prev);
                        event.preventDefault(); // Prevent typing 'm' in chat etc.
                        console.log('[M-Key] Toggled music control panel');
                        return;
                }
            }

            // Placement cancellation (checked before general input disabled)
            if (key === 'escape' && placementInfo) {
                placementActionsRef.current?.cancelPlacement();
                return;
            }

            // Movement keys are now handled by useMovementInput hook
            // Only handle non-movement keys here to avoid conflicts

            // Spacebar Handler (Jump or Dodge Roll)
            if (key === ' ' && !event.repeat) {
                // 🎣 FISHING INPUT FIX: Disable jumping while fishing
                if (isFishing) {
                    console.log('[Input] Jump blocked - player is fishing');
                    event.preventDefault();
                    event.stopPropagation(); // 🎣 FISHING INPUT FIX: Stop event from reaching other handlers
                    event.stopImmediatePropagation(); // 🎣 FISHING INPUT FIX: Stop all other listeners
                    return;
                }
                
                // Don't trigger actions when game menus are open
                if (isGameMenuOpen) {
                    return; // Let menus handle spacebar for scrolling
                }

                // Don't trigger actions when in menu components (to prevent interfering with scrolling)
                const target = event.target as Element;
                if (target) {
                    const isInMenu = target.closest('[data-scrollable-region]') ||
                        target.closest('.menuContainer') ||
                        target.closest('[style*="zIndex: 2000"]') ||
                        target.closest('[style*="z-index: 2000"]') ||
                        document.querySelector('[style*="zIndex: 2000"]') ||
                        document.querySelector('[style*="z-index: 2000"]');
                    if (isInMenu) {
                        return; // Let the menu handle spacebar for scrolling
                    }
                }

                if (localPlayerRef.current && !localPlayerRef.current.isDead && !localPlayerRef.current.isKnockedOut) {
                    event.preventDefault(); // Prevent spacebar from scrolling the page
                    
                    try {
                        // Space always triggers jump - dodge roll is handled by movement system
                        jump();
                        console.log('[Input] Jump triggered');
                    } catch (err) {
                        console.error("[InputHandler] Error calling jump:", err);
                    }
                }
            }

            // Water container filling key ('f')
            if (key === 'f' && !event.repeat) {
                if (isPlayerDead) return;
                
                const localPlayerActiveEquipment = activeEquipmentsRef.current?.get(localPlayerId || '');
                if (!localPlayerActiveEquipment?.equippedItemInstanceId || !localPlayerActiveEquipment?.equippedItemDefId) {
                    console.log('[F-Key] No equipped item for water filling');
                    return;
                }

                const equippedItemDef = itemDefinitionsRef.current?.get(localPlayerActiveEquipment.equippedItemDefId.toString());
                if (!equippedItemDef) {
                    console.log('[F-Key] No item definition found for equipped item');
                    return;
                }

                // Check if equipped item is a water container
                if (!isWaterContainer(equippedItemDef.name)) {
                    console.log('[F-Key] Equipped item is not a water container');
                    return;
                }

                // Get the water container item
                const waterContainer = inventoryItems.get(localPlayerActiveEquipment.equippedItemInstanceId.toString());
                if (!waterContainer || !connectionRef.current?.reducers) {
                    console.log('[F-Key] No water container found or no connection');
                    return;
                }

                // Check if player is standing on water for filling
                if (localPlayerRef.current?.isOnWater) {
                    console.log('[F-Key] Player is on water - attempting to fill container');
                    
                    // TODO: Add salt water detection when implemented
                    const isOnSaltWater = false; // Placeholder - all water is fresh for now
                    
                    if (isOnSaltWater) {
                        console.log('[F-Key] Cannot fill water container from salt water source');
                        return;
                    }

                    // Calculate remaining capacity using helper functions
                    const currentWaterContent = getWaterContent(waterContainer) || 0; // in liters
                    const maxCapacityLiters = getWaterCapacity(equippedItemDef.name); // in liters
                    const remainingCapacityMl = Math.floor((maxCapacityLiters - currentWaterContent) * 1000); // Convert L to mL

                    console.log(`[F-Key] Current water: ${currentWaterContent}L, Max: ${maxCapacityLiters}L, Remaining: ${remainingCapacityMl}mL`);

                    if (remainingCapacityMl <= 0) {
                        console.log('[F-Key] Water container is already full');
                        return;
                    }

                    const fillAmount = Math.min(250, remainingCapacityMl); // Fill 250mL or remaining capacity
                    console.log(`[F-Key] Attempting to fill ${equippedItemDef.name} with ${fillAmount}mL from fresh water source`);

                    try {
                        connectionRef.current.reducers.fillWaterContainerFromNaturalSource(
                            localPlayerActiveEquipment.equippedItemInstanceId, 
                            fillAmount
                        );
                        console.log(`[F-Key] Successfully called fillWaterContainerFromNaturalSource`);
                    } catch (err) {
                        console.error('[F-Key] Error filling water container:', err);
                    }
                } else {
                    console.log('[F-Key] Player not on water - cannot fill container');
                }
                return;
            }

            // Interaction key ('e')
            if (key === 'e' && !event.repeat && !isEHeldDownRef.current) {
                isEHeldDownRef.current = true;
                eKeyDownTimestampRef.current = Date.now();

                const currentConnection = connectionRef.current;
                if (!currentConnection?.reducers) return;

                const currentTarget = closestTargetRef.current;
                console.log('[E-KeyDown] Current target:', currentTarget ? formatTargetForLogging(currentTarget) : 'null');

                // Set up a timer for ANY potential hold action.
                // The keyUp handler will decide if it was a tap or a hold.

                // Determine if current target supports hold actions
                let holdTarget: InteractionProgressState | null = null;
                
                if (currentTarget && isTargetValid(currentTarget)) {
                    console.log('[E-KeyDown] Valid target found:', formatTargetForLogging(currentTarget));
                    
                    // Check for hold-first targets (highest priority)
                    if (isHoldInteraction(currentTarget)) {
                        holdTarget = { 
                            targetId: currentTarget.id, 
                            targetType: currentTarget.type,
                            startTime: eKeyDownTimestampRef.current 
                        };
                        console.log('[E-KeyDown] Setting up primary hold target:', holdTarget);
                    } 
                    // Check for secondary hold actions (interface targets that also support hold)
                    else if (hasSecondaryHoldAction(currentTarget)) {
                        holdTarget = { 
                            targetId: currentTarget.id, 
                            targetType: currentTarget.type,
                            startTime: eKeyDownTimestampRef.current 
                        };
                        console.log('[E-KeyDown] Setting up secondary hold target:', holdTarget, 'isEmpty:', currentTarget.data?.isEmpty);
                    }
                    // If no hold action is available, we'll handle tap action on keyUp
                    else {
                        console.log('[E-KeyDown] Target supports tap interaction only:', getActionType(currentTarget));
                    }
                } else {
                    if (!currentTarget) {
                        console.log('[E-KeyDown] No target available for interaction (waiting for parent components to pass closestInteractableTarget prop)');
                    } else {
                        console.log('[E-KeyDown] Target is invalid:', formatTargetForLogging(currentTarget));
                    }
                }

                if (holdTarget && currentTarget) {
                    const expectedDuration = currentTarget.type === 'knocked_out_player' ? 
                        getHoldDuration(currentTarget) : 
                        getSecondaryHoldDuration(currentTarget);
                        
                    console.log('[E-Hold START]', { 
                        holdTarget,
                        expectedDuration
                    });
                    setInteractionProgress(holdTarget);
                    setIsActivelyHolding(true);

                    startHoldTimer(holdTarget, currentConnection);
                }
            }
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();
            keysPressed.current.delete(key);

            // Movement key handling is now done by useMovementInput hook
            // Only handle non-movement keys here to avoid conflicts

            if (key === 'e') {
                if (isEHeldDownRef.current) { // Check if E was being held for an interaction
                    const holdDuration = Date.now() - eKeyDownTimestampRef.current;
                                            // Get the current target for tap action processing
                        const currentTarget = closestTargetRef.current;

                    // Always clear the timer if it exists (in case keyUp happens before timer fires)
                    console.log(`[E-KeyUp] Timer ref state: ${eKeyHoldTimerRef.current} (holdDuration: ${holdDuration}ms)`);
                    if (eKeyHoldTimerRef.current) {
                        console.log(`[E-KeyUp] *** CLEARING TIMER *** Timer ID: ${eKeyHoldTimerRef.current}, holdDuration: ${holdDuration}ms`);
                        clearTimeout(eKeyHoldTimerRef.current as number);
                        eKeyHoldTimerRef.current = null;
                    } else {
                        console.log(`[E-KeyUp] No timer to clear (holdDuration: ${holdDuration}ms)`);
                    }

                    // Reset hold state and unconditionally clear interaction progress if a hold was active
                    isEHeldDownRef.current = false;
                    eKeyDownTimestampRef.current = 0;
                    if (interactionProgress) { // If there was any interaction progress, clear it now
                        setInteractionProgress(null);
                    }

                    // Also ensure isActivelyHolding is false if E key is up and was part of a hold
                    setIsActivelyHolding(false);

                    // Check if it was a TAP or HOLD based on duration and target type
                    const expectedDuration = currentTarget?.type === 'knocked_out_player' ? REVIVE_HOLD_DURATION_MS : 
                                            currentTarget && hasSecondaryHoldAction(currentTarget) ? getSecondaryHoldDuration(currentTarget) :
                                            HOLD_INTERACTION_DURATION_MS;

                    console.log('[E-KeyUp] Processing hold/tap decision:', {
                        holdDuration,
                        expectedDuration,
                        wasLongEnough: holdDuration >= expectedDuration,
                        currentTarget: currentTarget ? formatTargetForLogging(currentTarget) : 'null'
                    });

                    if (holdDuration >= expectedDuration) {
                        // This was a HOLD that completed naturally - actions should have been handled by timer
                        console.log('[E-KeyUp] HOLD completed naturally - timer should have handled action');
                    } else {
                        // This was a TAP (or early release) - handle tap interactions
                        console.log('[E-KeyUp] Processing as TAP interaction');
                        let tapActionTaken = false;

                        // Handle tap actions using unified target system
                        if (connectionRef.current?.reducers && currentTarget && isTargetValid(currentTarget)) {
                            console.log('[E-Tap ACTION] Processing tap for:', formatTargetForLogging(currentTarget));
                            
                            // Handle immediate tap actions (harvest/pickup)
                            if (isTapInteraction(currentTarget)) {
                                switch (currentTarget.type) {
                                    case 'harvestable_resource':
                                        // Enhanced debugging: Get the actual resource data for detailed logging
                                        const resourceId = currentTarget.id as bigint;
                                        
                                        // Try to get the resource entity from the connection's database
                                        let resourceEntity = null;
                                        try {
                                            if (connectionRef.current?.db?.harvestableResource) {
                                                // Use the generated table handle to find the resource by ID
                                                resourceEntity = Array.from(connectionRef.current.db.harvestableResource.iter())
                                                    .find(resource => resource.id === resourceId);
                                            }
                                        } catch (error) {
                                            console.warn('[E-Tap ACTION] Error accessing harvestable resources:', error);
                                        }
                                        
                                        if (resourceEntity) {
                                            console.log('[E-Tap ACTION] 🌱 HARVESTING RESOURCE - Details:', {
                                                id: resourceId,
                                                plantType: resourceEntity.plantType,
                                                position: `(${resourceEntity.posX}, ${resourceEntity.posY})`,
                                                chunkIndex: resourceEntity.chunkIndex,
                                                respawnAt: resourceEntity.respawnAt,
                                                isRespawning: !!resourceEntity.respawnAt
                                            });
                                            
                                            // Also log just the plant type tag for easy scanning
                                            console.log(`[E-Tap ACTION] 🎯 Harvesting: ${resourceEntity.plantType.tag} at (${resourceEntity.posX.toFixed(1)}, ${resourceEntity.posY.toFixed(1)})`);
                                        } else {
                                            console.warn('[E-Tap ACTION] ⚠️ Resource not found in cache:', resourceId);
                                            // Log target details we do have
                                            console.log('[E-Tap ACTION] Target details:', {
                                                id: resourceId,
                                                type: currentTarget.type,
                                                position: currentTarget.position,
                                                distance: currentTarget.distance,
                                                data: currentTarget.data
                                            });
                                        }
                                        
                                        console.log('[E-Tap ACTION] Harvesting resource:', currentTarget.id);
                                        connectionRef.current.reducers.interactWithHarvestableResource(resourceId);
                                        tapActionTaken = true;
                                        break;
                                    case 'dropped_item':
                                        console.log('[E-Tap ACTION] Picking up dropped item:', currentTarget.id);
                                        connectionRef.current.reducers.pickupDroppedItem(currentTarget.id as bigint);
                                        tapActionTaken = true;
                                        break;
                                }
                            }
                            // Handle interface opening actions for containers/interactables
                            else if (isInterfaceInteraction(currentTarget)) {
                                switch (currentTarget.type) {
                                    case 'campfire':
                                        console.log('[E-Tap ACTION] Opening campfire interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'campfire', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'furnace':
                                        console.log('[E-Tap ACTION] Opening furnace interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'furnace', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'lantern':
                                        console.log('[E-Tap ACTION] Opening lantern interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'lantern', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'box':
                                        console.log('[E-Tap ACTION] Opening box interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'wooden_storage_box', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'stash':
                                        console.log('[E-Tap ACTION] Opening stash interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'stash', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'corpse':
                                        console.log('[E-Tap ACTION] Opening corpse interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'player_corpse', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'sleeping_bag':
                                        console.log('[E-Tap ACTION] Opening sleeping bag interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'sleeping_bag', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'rain_collector':
                                        console.log('[E-Tap ACTION] Opening rain collector interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'rain_collector', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                }
                            }
                        } else {
                            if (!connectionRef.current?.reducers) {
                                console.warn('[E-Tap ACTION] No connection/reducers available');
                            } else if (!currentTarget) {
                                console.log('[E-Tap ACTION] No target available for interaction');
                            } else if (!isTargetValid(currentTarget)) {
                                console.warn('[E-Tap ACTION] Target is invalid:', formatTargetForLogging(currentTarget));
                            } else {
                                console.warn('[E-Tap ACTION] Unknown reason for action failure');
                            }
                        }

                        console.log('[E-KeyUp] TAP processing complete. Action taken:', tapActionTaken);
                    }
                }
            }
        };

        // --- Mouse Handlers ---
        const handleMouseDown = (event: MouseEvent) => {
            if (isPlayerDead) return;
            if (event.target !== canvasRef?.current) return;
            if (isInventoryOpen) return;
            if (isActivelyHolding) return;
            
            // Enhanced chat input detection for mouse events
            const target = event.target as Element;
            const activeElement = document.activeElement as Element;
            
            // Check if ANY input is currently focused (either event target or active element)
            const isChatInputFocused = target?.getAttribute('data-is-chat-input') === 'true' || 
                                     target?.closest('[data-is-chat-input="true"]') !== null ||
                                     target?.tagName === 'INPUT' ||
                                     target?.tagName === 'TEXTAREA' ||
                                     activeElement?.getAttribute('data-is-chat-input') === 'true' ||
                                     activeElement?.tagName === 'INPUT' ||
                                     activeElement?.tagName === 'TEXTAREA';
            
            if (isChatting || isChatInputFocused) {
                console.log('[InputHandler] Mouse input blocked - chat focused:', { 
                    isChatting, 
                    isChatInputFocused,
                    targetTag: target?.tagName,
                    targetDataAttr: target?.getAttribute('data-is-chat-input')
                });
                
                // If user is trying to left-click but chat input is blocking, try to clear focus
                // Only clear if not actively searching in crafting recipes
                if (event.button === 0 && isChatInputFocused && !isChatting && !isSearchingCraftRecipes) {
                    console.log('[InputHandler] Attempting to clear stuck chat input focus on mouse click');
                    forceClearInputFocus();
                }
                
                return;
            }

            if (event.button === 0) { // Left Click
                // 🎣 FISHING INPUT FIX: Disable left mouse button actions while fishing
                if (isFishing) {
                    console.log('[Input] Left mouse blocked - player is fishing');
                    event.preventDefault();
                    return;
                }
                
                // Normal left click logic for attacks, interactions, etc.
                isMouseDownRef.current = true;

                const localPlayerActiveEquipment = localPlayerId ? activeEquipmentsRef.current?.get(localPlayerId) : undefined;
                // console.log("[InputHandler DEBUG MOUSEDOWN] localPlayerId:", localPlayerId, "activeEquip:", !!localPlayerActiveEquipment, "itemDefs:", !!itemDefinitionsRef.current);

                if (localPlayerActiveEquipment?.equippedItemDefId && itemDefinitionsRef.current) {
                    const equippedItemDef = itemDefinitionsRef.current.get(String(localPlayerActiveEquipment.equippedItemDefId));
                    //  console.log("[InputHandler DEBUG MOUSEDOWN] Equipped item Def (raw object): ", equippedItemDef);

                    if (equippedItemDef) {
                        // console.log("[InputHandler DEBUG MOUSEDOWN] Equipped item name: ", equippedItemDef.name, "Category tag:", equippedItemDef.category?.tag);

                        // 1. Ranged Weapon Firing
                        if (equippedItemDef.category?.tag === "RangedWeapon") {
                            if (localPlayerActiveEquipment.isReadyToFire) {
                                if (connectionRef.current?.reducers && worldMousePosRefInternal.current.x !== null && worldMousePosRefInternal.current.y !== null) {
                                    // console.log("[InputHandler MOUSEDOWN] Ranged weapon loaded. Firing!");
                                    connectionRef.current.reducers.fireProjectile(worldMousePosRefInternal.current.x, worldMousePosRefInternal.current.y);
                                } else {
                                    console.warn("[InputHandler MOUSEDOWN] Cannot fire ranged weapon: No connection/reducers or invalid mouse position.");
                                }
                            } else {
                                // console.log("[InputHandler MOUSEDOWN] Ranged weapon equipped but not ready to fire (isReadyToFire: false).");
                            }
                            return; // Ranged weapon logic handled (fired or noted as not ready)
                        }
                        // 2. Torch: Prevent left-click swing   
                        else if (equippedItemDef.name === "Torch") {
                            // console.log("[InputHandler MOUSEDOWN] Torch equipped. Left-click does nothing (use Right-Click to toggle).");
                            return; // Torch has no default left-click action here
                        }
                        // 3. Bandage: Prevent left-click swing (already handled by right-click)
                        else if (equippedItemDef.name === "Bandage") {
                            // console.log("[InputHandler MOUSEDOWN] Bandage equipped. Left-click does nothing. Use Right-Click.");
                            return;
                        }
                                                // 5. Water Containers: Prevent left-click pouring while on water, only allow crop watering
                        else if (isWaterContainer(equippedItemDef.name) && localPlayerActiveEquipment.equippedItemInstanceId) {
                            console.log('[InputHandler] Left-click with water container');
                            
                            // Get the water container item first
                            const waterContainer = inventoryItems.get(localPlayerActiveEquipment.equippedItemInstanceId.toString());
                            if (!waterContainer || !connectionRef.current?.reducers) {
                                console.log('[InputHandler] No water container found or no connection');
                                return;
                            }
                            
                            // Prevent left-click actions while on water tiles to avoid race conditions
                            if (localPlayerRef.current?.isOnWater) {
                                console.log('[InputHandler] Player is on water - left-click disabled for water containers (use F key to fill)');
                                return;
                            } else {
                                console.log('[InputHandler] Player not on water - checking for crop watering');
                                // Not on water - check if container has water for watering crops
                                if (hasWaterContent(waterContainer)) {
                                    console.log("[InputHandler] Water container with water equipped. Calling water_crops reducer.");
                                    connectionRef.current.reducers.waterCrops(localPlayerActiveEquipment.equippedItemInstanceId);
                                    return;
                                } else {
                                    console.log('[InputHandler] No water content - falling through to normal swing behavior');
                                }
                                // If no water content, fall through to normal swing behavior
                            }
                        }
                        // If none of the above special cases, fall through to default item use (melee/tool)
                    } else {
                        // console.log("[InputHandler DEBUG MOUSEDOWN] Equipped item definition NOT FOUND for ID:", localPlayerActiveEquipment.equippedItemDefId);
                        // Fall through to default unarmed action if item def is missing
                    }
                }

                // Default action for other items (tools, melee weapons) or if unarmed
                if (localPlayerId && connectionRef.current?.reducers) {
                    // console.log("[InputHandler MOUSEDOWN] Calling useEquippedItem for melee/tool or unarmed.");
                    try {
                        // 🔊 IMMEDIATE SOUND: Only play generic swing for non-resource tools
                        const activeItem = activeEquipmentsRef.current.get(localPlayerId);
                        const itemDef = itemDefinitionsRef.current.get(activeItem?.equippedItemDefId?.toString() || '');
                        
                        // Don't play immediate sounds for resource gathering tools - let server handle those
                        const isResourceTool = itemDef?.name && (
                            itemDef.name.toLowerCase().includes('hatchet') || 
                            itemDef.name.toLowerCase().includes('axe') ||
                            itemDef.name.toLowerCase().includes('pickaxe') ||
                            itemDef.name.toLowerCase().includes('pick')
                        );
                        
                        if (!isResourceTool) {
                            // Play immediate sound for combat weapons and other tools
                            // playWeaponSwingSound(0.8);
                        }
                        connectionRef.current.reducers.useEquippedItem();
                    } catch (e) {
                        // ignore for now
                    }
                } else {
                    // console.warn("[InputHandler MOUSEDOWN] Cannot use item: No localPlayerId or connection/reducers.");
                }
            } else if (event.button === 2) { // Right Click
                if (isPlayerDead) return;
                if (isInventoryOpen) return;

                // console.log("[InputHandler] Right mouse button pressed");
                isRightMouseDownRef.current = true;

                // Normal right-click logic for context menu, etc.
            }
        };

        const handleMouseUp = (event: MouseEvent) => {
            // Handle both left and right mouse button releases
            if (event.button === 0) { // Left mouse
                isMouseDownRef.current = false;
            } else if (event.button === 2) { // Right mouse
                isRightMouseDownRef.current = false;
            }
        };

        // --- Canvas Click for Placement ---
        const handleCanvasClick = (event: MouseEvent) => {
            if (isPlayerDead) return;

            // 🎣 FISHING INPUT FIX: Disable canvas click actions while fishing
            if (isFishing) {
                console.log('[Input] Canvas click blocked - player is fishing');
                event.preventDefault();
                return;
            }

            if (placementInfo && worldMousePosRefInternal.current.x !== null && worldMousePosRefInternal.current.y !== null) {
                const localPlayerPosition = localPlayerRef.current;
                const isTooFar = localPlayerPosition
                    ? isPlacementTooFar(placementInfo, localPlayerPosition.positionX, localPlayerPosition.positionY, worldMousePosRefInternal.current.x, worldMousePosRefInternal.current.y)
                    : false;
                placementActionsRef.current?.attemptPlacement(worldMousePosRefInternal.current.x, worldMousePosRefInternal.current.y, isTooFar);
                return;
            }
            if (isInventoryOpen) return;
            if (isActivelyHolding) return;
            if (event.target !== canvasRef?.current) return;

            // Use existing refs directly
            if (connectionRef.current?.reducers && localPlayerId && localPlayerRef.current && activeEquipmentsRef.current && itemDefinitionsRef.current && worldMousePosRefInternal.current.x !== null && worldMousePosRefInternal.current.y !== null) {
                const localEquipment = activeEquipmentsRef.current.get(localPlayerId);
                if (localEquipment?.equippedItemDefId) {
                    const itemDef = itemDefinitionsRef.current.get(String(localEquipment.equippedItemDefId));

                    if (itemDef && (itemDef.name === "Hunting Bow" || itemDef.category === SpacetimeDB.ItemCategory.RangedWeapon)) {
                        try {
                            connectionRef.current.reducers.fireProjectile(worldMousePosRefInternal.current.x, worldMousePosRefInternal.current.y);
                            lastClientSwingAttemptRef.current = Date.now();
                            lastServerSwingTimestampRef.current = Date.now();
                            return;
                        } catch (err) {
                            console.error("[CanvasClick Ranged] Error calling fireProjectile reducer:", err);
                        }
                    }
                }
            }

            // --- Re-evaluate swing logic directly for canvas click, similar to attemptSwing ---
            // Ensure connectionRef is used here as well if currentConnection was from outer scope
            if (!connectionRef.current?.reducers || !localPlayerId) return;
            // ... rest of melee swing logic, ensure it uses refs if needed ...
            const localEquipment = activeEquipmentsRef.current?.get(localPlayerId);
            const itemDef = itemDefinitionsRef.current?.get(String(localEquipment?.equippedItemDefId));

            if (!localEquipment || localEquipment.equippedItemDefId === null || localEquipment.equippedItemInstanceId === null) {
                // Unarmed
                const nowUnarmed = Date.now();
                if (nowUnarmed - lastClientSwingAttemptRef.current < SWING_COOLDOWN_MS) return;
                if (nowUnarmed - Number(localEquipment?.swingStartTimeMs || 0) < SWING_COOLDOWN_MS) return;
                try {
                    // 🔊 IMMEDIATE SOUND: Play unarmed swing sound
                    // playWeaponSwingSound(0.8);
                    connectionRef.current.reducers.useEquippedItem();
                    lastClientSwingAttemptRef.current = nowUnarmed;
                    lastServerSwingTimestampRef.current = nowUnarmed;
                } catch (err) { console.error("[CanvasClick Unarmed] Error calling useEquippedItem reducer:", err); }
            } else {
                // Armed (melee/tool)
                if (!itemDef) return;
                if (itemDef.name === "Bandage" || itemDef.name === "Selo Olive Oil" || itemDef.name === "Hunting Bow" || itemDef.category === SpacetimeDB.ItemCategory.RangedWeapon) {
                    // Ranged/Bandage/Selo Olive Oil already handled or should not be triggered by this melee path
                    return;
                }
                
                // Water containers are now handled in handleMouseDown to prevent conflicts
                // This section is for regular melee weapons and tools only
                const now = Date.now();
                const attackIntervalMs = itemDef.attackIntervalSecs ? itemDef.attackIntervalSecs * 1000 : SWING_COOLDOWN_MS;
                if (now - lastServerSwingTimestampRef.current < attackIntervalMs) return;
                if (now - lastClientSwingAttemptRef.current < attackIntervalMs) return;
                if (now - Number(localEquipment.swingStartTimeMs) < attackIntervalMs) return;
                try {
                    // 🔊 IMMEDIATE SOUND: Only play generic swing for non-resource tools
                    const isResourceTool = itemDef?.name && (
                        itemDef.name.toLowerCase().includes('hatchet') || 
                        itemDef.name.toLowerCase().includes('axe') ||
                        itemDef.name.toLowerCase().includes('pickaxe') ||
                        itemDef.name.toLowerCase().includes('pick')
                    );
                    
                    if (!isResourceTool) {
                        // Play immediate sound for combat weapons and other tools
                        // playWeaponSwingSound(0.8);
                    }
                    connectionRef.current.reducers.useEquippedItem();
                    lastClientSwingAttemptRef.current = now;
                    lastServerSwingTimestampRef.current = now;
                } catch (err) { console.error("[CanvasClick Armed] Error calling useEquippedItem reducer:", err); }
            }
        };

        // --- Context Menu for Placement Cancellation ---
        const handleContextMenu = (event: MouseEvent) => {
            if (isPlayerDead) return;
            if (isInventoryOpen) return;

            // 🎣 FISHING INPUT FIX: Disable context menu actions while fishing
            if (isFishing) {
                console.log('[Input] Context menu blocked - player is fishing');
                event.preventDefault();
                return;
            }

            const localPlayerActiveEquipment = localPlayerId ? activeEquipmentsRef.current?.get(localPlayerId) : undefined;
            // console.log("[InputHandler DEBUG CTXMENU] localPlayerId:", localPlayerId, "activeEquip:", !!localPlayerActiveEquipment, "itemDefs:", !!itemDefinitionsRef.current);

            if (localPlayerActiveEquipment?.equippedItemDefId && itemDefinitionsRef.current) {
                const equippedItemDef = itemDefinitionsRef.current.get(String(localPlayerActiveEquipment.equippedItemDefId));
                // console.log("[InputHandler DEBUG CTXMENU] Equipped item Def (raw object): ", equippedItemDef);

                if (equippedItemDef) { // <<< NULL CHECK ADDED
                    // console.log("[InputHandler DEBUG CTXMENU] Equipped item name: ", equippedItemDef.name, "Category tag:", equippedItemDef.category?.tag);
                    if (equippedItemDef.category?.tag === "RangedWeapon") {
                        // console.log("[InputHandler CTXMENU] Ranged Weapon equipped. Attempting to load.");
                        event.preventDefault();
                        if (connectionRef.current?.reducers) {
                            // console.log("[InputHandler CTXMENU] Calling loadRangedWeapon reducer.");
                            connectionRef.current.reducers.loadRangedWeapon();
                        } else {
                            console.warn("[InputHandler CTXMENU] No connection or reducers to call loadRangedWeapon.");
                        }
                        return;
                    }
                    else if (equippedItemDef.name === "Torch") {
                        // console.log("[InputHandler CTXMENU] Torch equipped. Attempting to toggle.");
                        event.preventDefault();
                        if (connectionRef.current?.reducers) {
                            // console.log("[InputHandler CTXMENU] Calling toggleTorch reducer.");
                            connectionRef.current.reducers.toggleTorch();
                        } else {
                            console.warn("[InputHandler CTXMENU] No connection or reducers to call toggleTorch.");
                        }
                        return;
                    } else if (equippedItemDef.name === "Bandage") {
                        // console.log("[InputHandler CTXMENU] Bandage equipped. Attempting to use.");
                        event.preventDefault();
                        if (connectionRef.current?.reducers) {
                            // console.log("[InputHandler CTXMENU] Calling useEquippedItem for Bandage.");
                            // 🔊 IMMEDIATE SOUND: Play button click for bandage use
                            // playButtonClickSound(0.6);
                            connectionRef.current.reducers.useEquippedItem();
                        } else {
                            console.warn("[InputHandler CTXMENU] No connection or reducers to call useEquippedItem for Bandage.");
                        }
                        return;
                    } else if (equippedItemDef.name === "Selo Olive Oil") {
                        // console.log("[InputHandler CTXMENU] Selo Olive Oil equipped. Attempting to use.");
                        event.preventDefault();
                        if (connectionRef.current?.reducers) {
                            // console.log("[InputHandler CTXMENU] Calling useEquippedItem for Selo Olive Oil.");
                            // 🔊 IMMEDIATE SOUND: Play button click for Selo Olive Oil use
                            // playButtonClickSound(0.6);
                            connectionRef.current.reducers.useEquippedItem();
                        } else {
                            console.warn("[InputHandler CTXMENU] No connection or reducers to call useEquippedItem for Selo Olive Oil.");
                        }
                        return;
                    } else if (equippedItemDef.name === "Reed Water Bottle" || equippedItemDef.name === "Plastic Water Jug") {
                        console.log("[InputHandler] Right-click with water container - attempting to drink");
                        event.preventDefault();
                        
                        // Find the equipped item instance to check if it has water
                        const equippedItemInstance = Array.from(inventoryItems.values()).find((item: SpacetimeDB.InventoryItem) => 
                            item.instanceId === BigInt(localPlayerActiveEquipment?.equippedItemInstanceId || 0)
                        );
                        
                        console.log(`[InputHandler] Found equipped item instance:`, !!equippedItemInstance);
                        console.log(`[InputHandler] Has water content:`, equippedItemInstance ? hasWaterContent(equippedItemInstance) : false);
                        
                        if (equippedItemInstance && hasWaterContent(equippedItemInstance)) {
                            if (connectionRef.current?.reducers && localPlayerActiveEquipment?.equippedItemInstanceId) {
                                console.log("[InputHandler] Calling consumeFilledWaterContainer for equipped water container.");
                                try {
                                    connectionRef.current.reducers.consumeFilledWaterContainer(BigInt(localPlayerActiveEquipment.equippedItemInstanceId));
                                    console.log("[InputHandler] Successfully called consumeFilledWaterContainer");
                                } catch (err) {
                                    console.error("[InputHandler] Error calling consumeFilledWaterContainer:", err);
                                }
                            } else {
                                console.warn("[InputHandler] No connection or reducers to call consumeFilledWaterContainer for water container.");
                            }
                        } else {
                            console.log("[InputHandler] Water container is empty, cannot drink.");
                        }
                        return;
                    }
                    else {
                        // console.log("[InputHandler DEBUG CTXMENU] Equipped item is not Ranged, Torch, or Bandage. Proceeding to placement check.");
                    }
                } else {
                    // console.log("[InputHandler DEBUG CTXMENU] Equipped item definition NOT FOUND for ID:", localPlayerActiveEquipment.equippedItemDefId);
                }
            } else {
                // console.log("[InputHandler DEBUG CTXMENU] No active equipment or itemDefinitions for right-click logic.");
            }

            // Check if the equipped item is throwable and handle throwing
            if (localPlayerActiveEquipment?.equippedItemDefId && itemDefinitionsRef.current) {
                const equippedItemDef = itemDefinitionsRef.current.get(String(localPlayerActiveEquipment.equippedItemDefId));

                if (equippedItemDef && isItemThrowable(equippedItemDef)) {
                    console.log("[InputHandler] Right-click - attempting to throw item:", equippedItemDef.name);
                    event.preventDefault();

                    // Quick checks
                    if (!connectionRef.current?.reducers || !localPlayerId || isPlayerDead) {
                        console.log("[InputHandler] Right-click throw - basic requirements not met");
                        return;
                    }

                    const player = localPlayerRef.current;
                    if (!player) {
                        console.log("[InputHandler] Right-click throw - no local player found");
                        return;
                    }

                    // Determine throwing direction based on movement or facing direction
                    let throwingDirection = { dx: 0, dy: 1 }; // Default: facing down

                    // Check if player is currently moving
                    const isCurrentlyMoving = (
                        keysPressed.current.has('w') || keysPressed.current.has('arrowup') ||
                        keysPressed.current.has('s') || keysPressed.current.has('arrowdown') ||
                        keysPressed.current.has('a') || keysPressed.current.has('arrowleft') ||
                        keysPressed.current.has('d') || keysPressed.current.has('arrowright')
                    );

                    if (isCurrentlyMoving) {
                        // Use current movement direction
                        const dx = (keysPressed.current.has('d') || keysPressed.current.has('arrowright') ? 1 : 0) -
                            (keysPressed.current.has('a') || keysPressed.current.has('arrowleft') ? 1 : 0);
                        const dy = (keysPressed.current.has('s') || keysPressed.current.has('arrowdown') ? 1 : 0) -
                            (keysPressed.current.has('w') || keysPressed.current.has('arrowup') ? 1 : 0);

                        if (dx !== 0 || dy !== 0) {
                            throwingDirection = { dx, dy };
                        }
                        console.log("[InputHandler] Right-click throw - using current movement direction:", throwingDirection);
                    } else {
                        // Player is not moving, use their stored facing direction
                        const playerFacingDirection = player.direction || 'down';
                        throwingDirection = getDirectionVector(playerFacingDirection);
                        console.log("[InputHandler] Right-click throw - using player facing direction:", playerFacingDirection, "->", throwingDirection);
                    }

                    // Calculate target position based on direction and throwing distance
                    const THROWING_DISTANCE = 400.0;
                    const magnitude = Math.sqrt(throwingDirection.dx * throwingDirection.dx + throwingDirection.dy * throwingDirection.dy);
                    const normalizedDx = magnitude > 0 ? throwingDirection.dx / magnitude : 0;
                    const normalizedDy = magnitude > 0 ? throwingDirection.dy / magnitude : 1;

                    const targetX = player.positionX + (normalizedDx * THROWING_DISTANCE);
                    const targetY = player.positionY + (normalizedDy * THROWING_DISTANCE);

                    console.log("[InputHandler] Right-click - THROWING:", equippedItemDef.name, "from", player.positionX, player.positionY, "to", targetX, targetY, "direction:", throwingDirection);

                    try {
                        connectionRef.current.reducers.throwItem(targetX, targetY);
                        console.log("[InputHandler] Right-click throw - throwItem called successfully!");
                    } catch (err) {
                        console.error("[InputHandler] Right-click throw - Error throwing item:", err);
                    }

                    return; // Always return after handling throw
                }
            }

            if (placementInfo) {
                console.log("[InputHandler CTXMENU] Right-click during placement - cancelling placement.");
                event.preventDefault();
                placementActionsRef.current?.cancelPlacement();
            }
        };

        // --- Wheel for Placement Cancellation (optional) ---
        const handleWheel = (event: WheelEvent) => {
            // Don't interfere with scrolling when game menus are open
            if (isGameMenuOpen) {
                return; // Let menus handle their own scrolling
            }

            if (placementInfo) {
                placementActionsRef.current?.cancelPlacement();
            }
        };

        // --- Blur Handler ---
        const handleBlur = () => {
            // console.log(`[E-Timer] *** WINDOW BLUR CLEARING TIMER *** Timer ID: ${eKeyHoldTimerRef.current}`);
            // REMOVED Sprinting logic from blur handler.
            // keysPressed.current.clear(); // Keep this commented out
            isMouseDownRef.current = false;
            isRightMouseDownRef.current = false; // Reset right mouse state
            isEHeldDownRef.current = false;
            if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current);
            eKeyHoldTimerRef.current = null;
            setInteractionProgress(null);
            // Clear auto-attack state when window loses focus
            setIsAutoAttacking(false);
        };
        
        // Utility function to force clear all input focus (called when needed)
        const forceClearInputFocus = () => {
            const activeEl = document.activeElement as HTMLElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('data-is-chat-input'))) {
                console.log('[InputHandler] Force clearing input focus from:', activeEl.tagName, activeEl.getAttribute('data-is-chat-input'));
                activeEl.blur();
                document.body.focus();
                // Small delay to ensure focus change is processed
                setTimeout(() => {
                    if (document.activeElement === activeEl) {
                        console.log('[InputHandler] Secondary force focus clear');
                        document.body.focus();
                    }
                }, 100);
            }
        };

        // Add global listeners
        window.addEventListener('keydown', handleKeyDown, { capture: true });
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('wheel', handleWheel, { passive: true });
        window.addEventListener('contextmenu', handleContextMenu);
        window.addEventListener('blur', handleBlur);

        // Add listener for canvas click (if canvas ref is passed in)
        const canvas = canvasRef?.current; // Get canvas element from ref
        if (canvas) {
            // Attach the locally defined handler
            canvas.addEventListener('click', handleCanvasClick);
            // console.log("[useInputHandler] Added canvas click listener.");
        } else {
            // console.warn("[useInputHandler] Canvas ref not available on mount to add click listener.");
        }

        // Cleanup
        return () => {
            // Remove global listeners
            window.removeEventListener('keydown', handleKeyDown, { capture: true }); // 🎣 FISHING INPUT FIX: Match capture option in cleanup
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('wheel', handleWheel);
            window.removeEventListener('contextmenu', handleContextMenu);
            window.removeEventListener('blur', handleBlur);
            // Remove canvas listener on cleanup
            if (canvas) {
                canvas.removeEventListener('click', handleCanvasClick);
                // console.log("[useInputHandler] Removed canvas click listener.");
            }
            // Don't clear timers on cleanup - they're short-lived (250ms) and self-cleaning
            // The cleanup was causing timers to be cleared when dependencies changed during hold
            // if (eKeyHoldTimerRef.current) {
            //     console.log(`[E-Timer] *** USEEFFECT CLEANUP CLEARING TIMER *** Timer ID: ${eKeyHoldTimerRef.current}`);
            //     clearTimeout(eKeyHoldTimerRef.current as number);
            //     eKeyHoldTimerRef.current = null;
            // }
        };
    }, [canvasRef, localPlayer?.isDead, placementInfo, jump, attemptSwing, setIsMinimapOpen, isChatting, isSearchingCraftRecipes, isInventoryOpen, isGameMenuOpen, isFishing]);

    // Auto-walk functionality removed - movement handled by usePredictedMovement hook

    // Movement throttling refs
    const lastMovementUpdateRef = useRef<number>(0);
    const MOVEMENT_UPDATE_INTERVAL_MS = 50; // Limit movement updates to 20fps (every 50ms)

    // --- Function to process inputs and call actions (called by game loop) ---
    const processInputsAndActions = useCallback(() => {
        const currentConnection = connectionRef.current;
        const currentLocalPlayer = localPlayerRef.current;
        const currentActiveEquipments = activeEquipmentsRef.current;

        if (!currentConnection?.reducers || !localPlayerId || !currentLocalPlayer) {
            return; // Early return if dependencies aren't ready
        }

        // Get input disabled state based ONLY on player death
        const isInputDisabledState = currentLocalPlayer.isDead;

        // Input is disabled if the player is dead
        // Do not process any game-related input if disabled
        if (isInputDisabledState) {
            return; // Early return - player is dead, skip all input processing
        }

        // MODIFIED: Do nothing if player is dead, or if chatting/searching
        if (!currentLocalPlayer || currentLocalPlayer.isDead || isChatting || isSearchingCraftRecipes) {
            // Reset auto-attack state when in UI states
            if (isAutoAttacking && (isChatting || isSearchingCraftRecipes)) {
                setIsAutoAttacking(false);
            }
            // Also clear jump offset if player is dead or UI is active
            if (currentJumpOffsetYRef.current !== 0) {
                currentJumpOffsetYRef.current = 0;
            }
            return;
        }

        // --- Jump Offset Calculation (moved here for per-frame update) ---
        // Note: Visual animation only, no cooldown logic (server handles that)
        if (currentLocalPlayer && currentLocalPlayer.jumpStartTimeMs > 0) {
            // Server handles all jump cooldown logic - we just show visual animation
            const jumpStartTime = Number(currentLocalPlayer.jumpStartTimeMs);
            const playerId = currentLocalPlayer.identity.toHexString();

            // Check if this is a NEW jump by comparing server timestamps
            const lastKnownServerTime = lastKnownServerJumpTimes.current.get(playerId) || 0;

            if (jumpStartTime !== lastKnownServerTime) {
                // NEW jump detected! Record both server time and client time
                lastKnownServerJumpTimes.current.set(playerId, jumpStartTime);
                clientJumpStartTimes.current.set(playerId, Date.now());
            }

            // Calculate animation based on client time for smooth animation
            const clientStartTime = clientJumpStartTimes.current.get(playerId);
            if (clientStartTime) {
                const elapsedJumpTime = Date.now() - clientStartTime;

                if (elapsedJumpTime < JUMP_DURATION_MS) {
                    const t = elapsedJumpTime / JUMP_DURATION_MS;
                    const jumpOffset = Math.sin(t * Math.PI) * JUMP_HEIGHT_PX;
                    currentJumpOffsetYRef.current = jumpOffset;
                } else {
                    currentJumpOffsetYRef.current = 0; // Animation finished
                }
            }
        } else {
            // No jump active - clean up
            if (currentLocalPlayer) {
                const playerId = currentLocalPlayer.identity.toHexString();
                clientJumpStartTimes.current.delete(playerId);
                lastKnownServerJumpTimes.current.delete(playerId);
            }
            currentJumpOffsetYRef.current = 0;
        }
        // --- End Jump Offset Calculation ---

        // Handle continuous swing check (removed movement tracking for weapons)
        if (isMouseDownRef.current && !placementInfo && !isChatting && !isSearchingCraftRecipes && !isInventoryOpen) {
            // 🎣 FISHING INPUT FIX: Disable continuous swing while fishing
            if (!isFishing) {
                attemptSwing(); // Call internal attemptSwing function
            }
        }

        // Handle auto-attack
        if (isAutoAttacking && !placementInfo && !isChatting && !isSearchingCraftRecipes && !isInventoryOpen) {
            // 🎣 FISHING INPUT FIX: Disable auto-attack while fishing
            if (!isFishing) {
                attemptSwing(); // Call internal attemptSwing function for auto-attack
            }
        }
    }, [
        isPlayerDead, attemptSwing, placementInfo,
        localPlayerId, localPlayer, activeEquipments, worldMousePos, connection,
        closestInteractableTarget, onSetInteractingWith,
        isChatting, isSearchingCraftRecipes, setIsMinimapOpen, isInventoryOpen,
        isAutoAttacking, isFishing
    ]);

    // Helper function to check if an item is throwable
    const isItemThrowable = useCallback((itemDef: SpacetimeDB.ItemDefinition | undefined): boolean => {
        if (!itemDef) {
            console.log("[isItemThrowable] No item definition provided");
            return false;
        }

        console.log("[isItemThrowable] Checking item:", itemDef.name, "category:", itemDef.category);

        // Don't allow throwing ranged weapons, bandages, or consumables
        if (itemDef.category?.tag === "RangedWeapon") {
            console.log("[isItemThrowable] Rejected: RangedWeapon");
            return false;
        }
        if (itemDef.name === "Bandage" || itemDef.name === "Selo Olive Oil") {
            console.log("[isItemThrowable] Rejected: Bandage/Selo Olive Oil");
            return false;
        }
        if (itemDef.name === "Torch") {
            console.log("[isItemThrowable] Rejected: Torch");
            return false;
        }

        // Allow throwing tools and melee weapons
        const throwableNames = [
            "Rock", "Spear", "Stone Hatchet", "Stone Pickaxe", "Combat Ladle",
            "Bone Club", "Bone Knife", "Repair Hammer", "Stone Spear", "Wooden Spear",
            "Stone Axe", "Stone Knife", "Wooden Club", "Improvised Knife", "Bone Gaff Hook",
            "Bush Knife"
        ];

        const nameMatch = throwableNames.includes(itemDef.name);
        const categoryMatch = itemDef.category?.tag === "Weapon" || itemDef.category?.tag === "Tool";

        console.log("[isItemThrowable] Name match:", nameMatch, "Category match:", categoryMatch);
        console.log("[isItemThrowable] Category tag:", itemDef.category?.tag);

        const result = nameMatch || categoryMatch;
        console.log("[isItemThrowable] Final result:", result);

        return result;
    }, []);

    // --- Return State & Actions ---
    return {
        interactionProgress,
        isActivelyHolding,
        currentJumpOffsetY: currentJumpOffsetYRef.current, // Return current ref value
        isAutoAttacking,
        isCrouching, // Include local crouch state
        processInputsAndActions,
    };
}; 