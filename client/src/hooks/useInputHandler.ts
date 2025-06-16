import { useEffect, useRef, useState, useCallback, RefObject } from 'react';
import * as SpacetimeDB from '../generated';
import { DbConnection, Player, ItemDefinition, ActiveEquipment, WoodenStorageBox, Stash } from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import { PlacementItemInfo, PlacementActions } from './usePlacementManager'; // Assuming usePlacementManager exports these
import React from 'react';
import { usePlayerActions } from '../contexts/PlayerActionsContext';
import { JUMP_DURATION_MS, JUMP_HEIGHT_PX, HOLD_INTERACTION_DURATION_MS } from '../config/gameConfig'; // <<< ADDED IMPORT
import { isPlacementTooFar } from '../utils/renderers/placementRenderingUtils';

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
    placementInfo: PlacementItemInfo | null;
    placementActions: PlacementActions;
    worldMousePos: { x: number | null; y: number | null };
    closestInteractableMushroomId: bigint | null;
    closestInteractableCornId: bigint | null;
    closestInteractablePotatoId: bigint | null;
    closestInteractablePumpkinId: bigint | null;
    closestInteractableHempId: bigint | null;
    closestInteractableReedId: bigint | null;
    closestInteractableCampfireId: number | null;
    closestInteractableDroppedItemId: bigint | null;
    closestInteractableBoxId: number | null;
    isClosestInteractableBoxEmpty: boolean;
    woodenStorageBoxes: Map<string, WoodenStorageBox>;
    closestInteractableCorpseId: bigint | null;
    closestInteractableStashId: number | null;
    stashes: Map<string, Stash>;
    closestInteractableKnockedOutPlayerId: string | null;
    players: Map<string, Player>;
    onSetInteractingWith: (target: any | null) => void;
    isMinimapOpen: boolean;
    setIsMinimapOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isChatting: boolean;
    isInventoryOpen: boolean;
    isGameMenuOpen: boolean;
    isSearchingCraftRecipes?: boolean;
    isFishing: boolean;
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
    targetType: 'campfire' | 'wooden_storage_box' | 'stash' | 'knocked_out_player'; // Added 'knocked_out_player'
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
    placementInfo,
    placementActions,
    worldMousePos,
    closestInteractableMushroomId,
    closestInteractableCornId,
    closestInteractablePotatoId,
    closestInteractablePumpkinId,
    closestInteractableHempId,
    closestInteractableReedId,
    closestInteractableCampfireId,
    closestInteractableDroppedItemId,
    closestInteractableBoxId,
    isClosestInteractableBoxEmpty,
    woodenStorageBoxes, // <<< ADDED
    closestInteractableCorpseId,
    closestInteractableStashId, // Changed from bigint to number for Stash ID
    stashes, // Added stashes map
    closestInteractableKnockedOutPlayerId, // Added for knocked out player
    players, // Added players map for knocked out revive
    onSetInteractingWith,
    isMinimapOpen,
    setIsMinimapOpen,
    isChatting,
    isSearchingCraftRecipes,
    isInventoryOpen, // Destructure new prop
    isGameMenuOpen, // Destructure new prop
    isFishing,
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
    const closestIdsRef = useRef({
        mushroom: null as bigint | null,
        corn: null as bigint | null,
        potato: null as bigint | null,
        pumpkin: null as bigint | null,
        hemp: null as bigint | null,
        reed: null as bigint | null,
        campfire: null as number | null,
        droppedItem: null as bigint | null,
        box: null as number | null,
        boxEmpty: false,
        corpse: null as bigint | null,
        stash: null as number | null,
        knockedOutPlayer: null as string | null, // Added for knocked out player
    });
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
    useEffect(() => {
        closestIdsRef.current = {
            mushroom: closestInteractableMushroomId,
            corn: closestInteractableCornId,
            potato: closestInteractablePotatoId,
            pumpkin: closestInteractablePumpkinId,
            hemp: closestInteractableHempId,
            reed: closestInteractableReedId,
            campfire: closestInteractableCampfireId,
            droppedItem: closestInteractableDroppedItemId,
            box: closestInteractableBoxId,
            boxEmpty: isClosestInteractableBoxEmpty,
            corpse: closestInteractableCorpseId,
            stash: closestInteractableStashId, // Changed from bigint to number for Stash ID
            knockedOutPlayer: closestInteractableKnockedOutPlayerId, // Added for knocked out player
        };
    }, [
        closestInteractableMushroomId,
        closestInteractableCornId,
        closestInteractablePotatoId,
        closestInteractablePumpkinId,
        closestInteractableHempId,
        closestInteractableReedId,
        closestInteractableCampfireId,
        closestInteractableDroppedItemId,
        closestInteractableBoxId,
        isClosestInteractableBoxEmpty,
        closestInteractableCorpseId,
        closestInteractableStashId, // Changed from bigint to number for Stash ID
        closestInteractableKnockedOutPlayerId, // Added for knocked out player
    ]);
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
        const duration = holdTarget.targetType === 'knocked_out_player' ? REVIVE_HOLD_DURATION_MS : HOLD_INTERACTION_DURATION_MS;

        console.log(`[E-Timer] Setting up timer for ${duration}ms - holdTarget:`, holdTarget);
        const timerId = setTimeout(() => {
            try {
                // console.log(`[E-Timer] *** TIMER FIRED *** after ${duration}ms for:`, holdTarget);
                // Timer fired, so this is a successful HOLD action.
                // Re-check if we are still close to the original target.
                const stillClosest = closestIdsRef.current;
                // console.log(`[E-Timer] stillClosest check:`, stillClosest);

                let actionTaken = false;

                switch (holdTarget.targetType) {
                    case 'knocked_out_player':
                        if (stillClosest.knockedOutPlayer === holdTarget.targetId) {
                            console.log('[E-Hold ACTION] Attempting to revive player:', holdTarget.targetId);
                            connection.reducers.reviveKnockedOutPlayer(Identity.fromString(holdTarget.targetId as string));
                            actionTaken = true;
                        } else {
                            console.log('[E-Hold FAILED] No longer closest to knocked out player. Expected:', holdTarget.targetId, 'Actual closest:', stillClosest.knockedOutPlayer);
                        }
                        break;
                    case 'campfire':
                        if (stillClosest.campfire === holdTarget.targetId) {
                            // console.log(`[E-Timer] *** EXECUTING CAMPFIRE ACTION *** ID:`, holdTarget.targetId);
                            connection.reducers.toggleCampfireBurning(Number(holdTarget.targetId));
                            actionTaken = true;
                            // console.log(`[E-Timer] Campfire action completed successfully`);
                        } else {
                            // console.log(`[E-Timer] FAILED - No longer closest to campfire. Expected:`, holdTarget.targetId, 'Actual closest:', stillClosest.campfire);
                        }
                        break;
                    case 'wooden_storage_box':
                        if (stillClosest.box === holdTarget.targetId && stillClosest.boxEmpty) {
                            console.log('[E-Hold ACTION] Attempting to pickup storage box:', holdTarget.targetId);
                            connection.reducers.pickupStorageBox(Number(holdTarget.targetId));
                            actionTaken = true;
                        } else {
                            console.log('[E-Hold FAILED] Storage box conditions not met. Expected ID:', holdTarget.targetId, 'Actual closest:', stillClosest.box, 'Is empty:', stillClosest.boxEmpty);
                        }
                        break;
                    case 'stash':
                        if (stillClosest.stash === holdTarget.targetId) {
                            console.log('[E-Hold ACTION] Attempting to toggle stash visibility:', holdTarget.targetId);
                            connection.reducers.toggleStashVisibility(Number(holdTarget.targetId));
                            actionTaken = true;
                        } else {
                            console.log('[E-Hold FAILED] No longer closest to stash. Expected:', holdTarget.targetId, 'Actual closest:', stillClosest.stash);
                        }
                        break;
                    default:
                        console.log('[E-Hold FAILED] Unknown target type:', holdTarget.targetType);
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
            const isUIFocused = isChatting || isGameMenuOpen || !!isSearchingCraftRecipes;
            if (isUIFocused) {
                return;
            }

            const key = event.key.toLowerCase();

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
                        setIsCrouching(prev => {
                            connectionRef.current?.reducers.toggleCrouch();
                            return !prev;
                        });
                        return; // Handled
                    case 'g': // Handle minimap toggle here
                        setIsMinimapOpen((prev: boolean) => !prev);
                        event.preventDefault(); // Prevent typing 'g' in chat etc.
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

            // Interaction key ('e')
            if (key === 'e' && !event.repeat && !isEHeldDownRef.current) {
                isEHeldDownRef.current = true;
                eKeyDownTimestampRef.current = Date.now();

                const currentConnection = connectionRef.current;
                if (!currentConnection?.reducers) return;

                const closest = closestIdsRef.current;
                console.log('[E-KeyDown] Current closest targets:', closest);

                // Set up a timer for ANY potential hold action.
                // The keyUp handler will decide if it was a tap or a hold.

                // Determine the highest priority holdable target
                let holdTarget: InteractionProgressState | null = null;
                if (closest.knockedOutPlayer) {
                    holdTarget = { targetId: closest.knockedOutPlayer, targetType: 'knocked_out_player', startTime: eKeyDownTimestampRef.current };
                    console.log('[E-KeyDown] Setting up knocked out player hold target:', holdTarget);
                } else if (closest.campfire) {
                    holdTarget = { targetId: closest.campfire, targetType: 'campfire', startTime: eKeyDownTimestampRef.current };
                } else if (closest.box && closest.boxEmpty) {
                    holdTarget = { targetId: closest.box, targetType: 'wooden_storage_box', startTime: eKeyDownTimestampRef.current };
                } else if (closest.stash) {
                    holdTarget = { targetId: closest.stash, targetType: 'stash', startTime: eKeyDownTimestampRef.current };
                }

                if (holdTarget) {
                    console.log('[E-Hold START]', { holdTarget });
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
                    const RETAINED_CLOSEST_STASH_ID = closestIdsRef.current.stash;
                    const RETAINED_CLOSEST_CORPSE_ID = closestIdsRef.current.corpse;
                    const RETAINED_CLOSEST_BOX_ID = closestIdsRef.current.box;
                    const RETAINED_CLOSEST_CAMPFIRE_ID = closestIdsRef.current.campfire;
                    const RETAINED_CLOSEST_KNOCKED_OUT_PLAYER_ID = closestIdsRef.current.knockedOutPlayer;

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

                    // Check if it was a TAP or HOLD based on duration
                    const expectedDuration = RETAINED_CLOSEST_KNOCKED_OUT_PLAYER_ID ? REVIVE_HOLD_DURATION_MS : HOLD_INTERACTION_DURATION_MS;

                    console.log('[E-KeyUp] Processing hold/tap decision:', {
                        holdDuration,
                        expectedDuration,
                        wasLongEnough: holdDuration >= expectedDuration,
                        hasClosestIds: {
                            campfire: RETAINED_CLOSEST_CAMPFIRE_ID,
                            box: RETAINED_CLOSEST_BOX_ID,
                            stash: RETAINED_CLOSEST_STASH_ID,
                            corpse: RETAINED_CLOSEST_CORPSE_ID,
                            knockedOut: RETAINED_CLOSEST_KNOCKED_OUT_PLAYER_ID
                        }
                    });

                    if (holdDuration >= expectedDuration) {
                        // This was a HOLD that completed naturally - actions should have been handled by timer
                        console.log('[E-KeyUp] HOLD completed naturally - timer should have handled action');
                    } else {
                        // This was a TAP (or early release) - handle tap interactions
                        console.log('[E-KeyUp] Processing as TAP interaction');
                        let tapActionTaken = false;

                        // Get the retained closest IDs for harvesting/pickup
                        const RETAINED_CLOSEST_MUSHROOM_ID = closestIdsRef.current.mushroom;
                        const RETAINED_CLOSEST_CORN_ID = closestIdsRef.current.corn;
                        const RETAINED_CLOSEST_POTATO_ID = closestIdsRef.current.potato;
                        const RETAINED_CLOSEST_PUMPKIN_ID = closestIdsRef.current.pumpkin;
                        const RETAINED_CLOSEST_HEMP_ID = closestIdsRef.current.hemp;
                        const RETAINED_CLOSEST_REED_ID = closestIdsRef.current.reed;
                        const RETAINED_CLOSEST_DROPPED_ITEM_ID = closestIdsRef.current.droppedItem;

                        // Handle harvest/pickup actions FIRST (these are the main tap actions)
                        if (connectionRef.current?.reducers) {
                            if (RETAINED_CLOSEST_MUSHROOM_ID !== null) {
                                console.log('[E-Tap ACTION] Harvesting mushroom:', RETAINED_CLOSEST_MUSHROOM_ID);
                                connectionRef.current.reducers.interactWithMushroom(RETAINED_CLOSEST_MUSHROOM_ID);
                                tapActionTaken = true;
                            } else if (RETAINED_CLOSEST_CORN_ID !== null) {
                                console.log('[E-Tap ACTION] Harvesting corn:', RETAINED_CLOSEST_CORN_ID);
                                connectionRef.current.reducers.interactWithCorn(RETAINED_CLOSEST_CORN_ID);
                                tapActionTaken = true;
                            } else if (RETAINED_CLOSEST_POTATO_ID !== null) {
                                console.log('[E-Tap ACTION] Harvesting potato:', RETAINED_CLOSEST_POTATO_ID);
                                connectionRef.current.reducers.interactWithPotato(RETAINED_CLOSEST_POTATO_ID);
                                tapActionTaken = true;
                            } else if (RETAINED_CLOSEST_PUMPKIN_ID !== null) {
                                console.log('[E-Tap ACTION] Harvesting pumpkin:', RETAINED_CLOSEST_PUMPKIN_ID);
                                connectionRef.current.reducers.interactWithPumpkin(RETAINED_CLOSEST_PUMPKIN_ID);
                                tapActionTaken = true;
                            } else if (RETAINED_CLOSEST_HEMP_ID !== null) {
                                console.log('[E-Tap ACTION] Harvesting hemp:', RETAINED_CLOSEST_HEMP_ID);
                                connectionRef.current.reducers.interactWithHemp(RETAINED_CLOSEST_HEMP_ID);
                                tapActionTaken = true;
                            } else if (RETAINED_CLOSEST_REED_ID !== null) {
                                console.log('[E-Tap ACTION] Harvesting reed:', RETAINED_CLOSEST_REED_ID);
                                connectionRef.current.reducers.interactWithReed(RETAINED_CLOSEST_REED_ID);
                                tapActionTaken = true;
                            } else if (RETAINED_CLOSEST_DROPPED_ITEM_ID !== null) {
                                console.log('[E-Tap ACTION] Picking up dropped item:', RETAINED_CLOSEST_DROPPED_ITEM_ID);
                                connectionRef.current.reducers.pickupDroppedItem(RETAINED_CLOSEST_DROPPED_ITEM_ID);
                                tapActionTaken = true;
                            }
                            // Handle interface opening actions SECOND (for containers/interactables)
                            else if (RETAINED_CLOSEST_CAMPFIRE_ID) {
                                console.log('[E-Tap ACTION] Opening campfire interface:', RETAINED_CLOSEST_CAMPFIRE_ID);
                                onSetInteractingWith({ type: 'campfire', id: RETAINED_CLOSEST_CAMPFIRE_ID });
                                tapActionTaken = true;
                            } else if (RETAINED_CLOSEST_BOX_ID) {
                                console.log('[E-Tap ACTION] Opening box interface:', RETAINED_CLOSEST_BOX_ID);
                                onSetInteractingWith({ type: 'wooden_storage_box', id: RETAINED_CLOSEST_BOX_ID });
                                tapActionTaken = true;
                            } else if (RETAINED_CLOSEST_STASH_ID) {
                                console.log('[E-Tap ACTION] Opening stash interface:', RETAINED_CLOSEST_STASH_ID);
                                onSetInteractingWith({ type: 'stash', id: RETAINED_CLOSEST_STASH_ID });
                                tapActionTaken = true;
                            } else if (RETAINED_CLOSEST_CORPSE_ID) {
                                console.log('[E-Tap ACTION] Opening corpse interface:', RETAINED_CLOSEST_CORPSE_ID);
                                onSetInteractingWith({ type: 'player_corpse', id: RETAINED_CLOSEST_CORPSE_ID });
                                tapActionTaken = true;
                            }
                        } else {
                            console.warn('[E-Tap ACTION] No connection/reducers available for tap actions');
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
                        // 4. Selo Olive Oil: Prevent left-click swing (only right-click allowed)
                        else if (equippedItemDef.name === "Selo Olive Oil") {
                            // console.log("[InputHandler MOUSEDOWN] Selo Olive Oil equipped. Left-click does nothing. Use Right-Click.");
                            return;
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
                const now = Date.now();
                const attackIntervalMs = itemDef.attackIntervalSecs ? itemDef.attackIntervalSecs * 1000 : SWING_COOLDOWN_MS;
                if (now - lastServerSwingTimestampRef.current < attackIntervalMs) return;
                if (now - lastClientSwingAttemptRef.current < attackIntervalMs) return;
                if (now - Number(localEquipment.swingStartTimeMs) < attackIntervalMs) return;
                try {
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
                            connectionRef.current.reducers.useEquippedItem();
                        } else {
                            console.warn("[InputHandler CTXMENU] No connection or reducers to call useEquippedItem for Selo Olive Oil.");
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
        closestInteractableMushroomId, closestInteractableCornId, closestInteractablePotatoId, closestInteractablePumpkinId, closestInteractableHempId,
        closestInteractableCampfireId, closestInteractableDroppedItemId, closestInteractableBoxId,
        isClosestInteractableBoxEmpty, onSetInteractingWith,
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
            "Stone Axe", "Stone Knife", "Wooden Club", "Improvised Knife", "Bone Gaff Hook"
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