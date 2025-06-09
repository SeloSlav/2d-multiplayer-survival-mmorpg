import { useEffect, useRef, useState, useCallback, RefObject } from 'react';
import * as SpacetimeDB from '../generated';
import { DbConnection, Player, ItemDefinition, ActiveEquipment, WoodenStorageBox, Stash } from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import { PlacementItemInfo, PlacementActions } from './usePlacementManager'; // Assuming usePlacementManager exports these
import React from 'react';
import { usePlayerActions } from '../contexts/PlayerActionsContext';
import { JUMP_DURATION_MS, JUMP_HEIGHT_PX } from '../config/gameConfig'; // <<< ADDED IMPORT
import { isPlacementTooFar } from '../utils/renderers/placementRenderingUtils';

// Ensure HOLD_INTERACTION_DURATION_MS is defined locally if not already present
// If it was already defined (e.g., as `const HOLD_INTERACTION_DURATION_MS = 250;`), this won't change it.
// If it was missing, this adds it.
export const HOLD_INTERACTION_DURATION_MS = 250;
export const REVIVE_HOLD_DURATION_MS = 6000; // 6 seconds for reviving knocked out players

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
    closestInteractableCampfireId: bigint | null;
    closestInteractableDroppedItemId: bigint | null;
    closestInteractableBoxId: bigint | null;
    isClosestInteractableBoxEmpty: boolean;
    woodenStorageBoxes: Map<string, WoodenStorageBox>;
    closestInteractableCorpseId: bigint | null;
    closestInteractableStashId: bigint | null;
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
    onToggleAutoWalk: () => void;
}

// --- Hook Return Value Interface ---
// REMOVED inputState from here. It's now handled by useMovementInput
export interface InputHandlerState {
    // State needed for rendering or other components
    interactionProgress: InteractionProgressState | null;
    isActivelyHolding: boolean;
    currentJumpOffsetY: number; // <<< ADDED
    isAutoAttacking: boolean; // Auto-attack state
    isAutoWalking: boolean; // Auto-walk state
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
        default: return { dx: 0, dy: 1 }; // Default to down
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
    onToggleAutoWalk,
}: InputHandlerProps): InputHandlerState => {
    // console.log('[useInputHandler IS RUNNING] isInventoryOpen:', isInventoryOpen);
    // Get player actions from the context instead of props
    const { jump } = usePlayerActions();

    // --- Internal State and Refs ---
    const [isAutoAttacking, setIsAutoAttacking] = useState(false);
    const [isAutoWalking, setIsAutoWalking] = useState(false);
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

    // Refs for auto-walk state
    const autoWalkDirectionRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
    const lastMovementDirectionRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 1 }); // Default to facing down

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
        campfire: null as bigint | null,
        droppedItem: null as bigint | null,
        box: null as bigint | null,
        boxEmpty: false,
        corpse: null as bigint | null,
        stash: null as bigint | null,
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
        // Also clear auto-walk state if player dies
        if (localPlayer?.isDead && isAutoWalking) {
            setIsAutoWalking(false);
        }
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

    // --- Swing Logic --- 
    const attemptSwing = useCallback(() => {
        const currentConnection = connectionRef.current;
        // MODIFIED: Check isInventoryOpen here as a primary guard
        if (isInventoryOpen || !currentConnection?.reducers || !localPlayerId || isPlayerDead) return;

        const chatInputIsFocused = document.activeElement?.matches('[data-is-chat-input="true"]');
        if (chatInputIsFocused) return; 

        const currentEquipments = activeEquipmentsRef.current;
        const localEquipment = currentEquipments?.get(localPlayerId);
        const itemDefMap = itemDefinitionsRef.current;

        // --- Unarmed Swing ---
        if (!localEquipment || localEquipment.equippedItemDefId === null || localEquipment.equippedItemInstanceId === null) {
            const nowUnarmed = Date.now();
            // Using a generic SWING_COOLDOWN_MS for unarmed as it has no specific itemDef
            if (nowUnarmed - lastClientSwingAttemptRef.current < SWING_COOLDOWN_MS) return;
            // Also check against the server's swing start time for this equipment record if available
            if (nowUnarmed - Number(localEquipment?.swingStartTimeMs || 0) < SWING_COOLDOWN_MS) return;
            
            try {
                currentConnection.reducers.useEquippedItem(); // Unarmed/default action
                lastClientSwingAttemptRef.current = nowUnarmed;
                lastServerSwingTimestampRef.current = nowUnarmed; // Assume server allows unarmed swing immediately for client prediction
            } catch (err) { 
                console.error("[AttemptSwing Unarmed] Error calling useEquippedItem reducer:", err);
            }
            return;
        }

        // --- Armed Swing ---
        const itemDef = itemDefMap?.get(String(localEquipment.equippedItemDefId));
        if (!itemDef) {
            // console.warn("[AttemptSwing] No itemDef found for equipped item:", localEquipment.equippedItemDefId);
            return; // Cannot proceed without item definition
        }

        // Check if the equipped item is a Bandage (handled by right-click/context menu)
        if (itemDef.name === "Bandage" || itemDef.name === "Selo Olive Oil") {
            // console.log("[AttemptSwing] Bandage/Selo Olive Oil equipped, preventing use via attemptSwing (left-click).");
            return;
        }

        const now = Date.now();
        const attackIntervalMs = itemDef.attackIntervalSecs ? itemDef.attackIntervalSecs * 1000 : SWING_COOLDOWN_MS;

        // Client-side prediction based on last successful *server-confirmed* swing for this item type
        // and the item's specific attack interval.
        if (now - lastServerSwingTimestampRef.current < attackIntervalMs) {
            // console.log(`[Client Cooldown] Attack too soon. Now: ${now}, LastServerSwing: ${lastServerSwingTimestampRef.current}, Interval: ${attackIntervalMs}`);
            return;
        }
        
        // Fallback: Client-side cooldown based on last *attempt* (less accurate but a safety net)
        if (now - lastClientSwingAttemptRef.current < attackIntervalMs) {
            // console.log(`[Client Cooldown - Fallback] Attack attempt too soon. Now: ${now}, LastAttempt: ${lastClientSwingAttemptRef.current}, Interval: ${attackIntervalMs}`);
            return;
        }
        
        // Server-side cooldown check (using equipment state from server)
        // This is crucial as the server has the true state of swingStartTimeMs
        if (now - Number(localEquipment.swingStartTimeMs) < attackIntervalMs) {
            // console.log(`[Server Cooldown Check] SwingStartTimeMs: ${localEquipment.swingStartTimeMs}, Now: ${now}, Interval: ${attackIntervalMs}`);
            return;
        }

        // Attempt the swing for non-bandage items
        try {
            currentConnection.reducers.useEquippedItem();
            lastClientSwingAttemptRef.current = now;
            // Optimistically update server swing timestamp here, assuming the server call will succeed
            // The server will update its PlayerLastAttackTimestamp, which we don't directly read here.
            // The localEquipment.swingStartTimeMs will be updated when the ActiveEquipment table syncs.
            // For immediate client feedback, we rely on our lastServerSwingTimestampRef.
            // When ActiveEquipment table updates with new swingStartTimeMs from server, that's the source of truth.
            lastServerSwingTimestampRef.current = now; 
        } catch (err) { // Use unknown type for error
            console.error("[AttemptSwing] Error calling useEquippedItem reducer:", err);
        }
    }, [localPlayerId, isPlayerDead, isInventoryOpen]); // Added isInventoryOpen to dependencies

    // --- Input Handling useEffect (Listeners only) ---
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
                            if (!prev) setIsAutoWalking(false); // Stop walking if starting to attack
                            return !prev;
                        });
                        return; // Handled
                    case 'f':
                        onToggleAutoWalk();
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

            // Dodge Roll (Q key)
            if (key === 'q' && !event.repeat) {
                const currentConnection = connectionRef.current;
                const currentLocalPlayer = localPlayerRef.current;
                
                if (currentConnection?.reducers && currentLocalPlayer && !currentLocalPlayer.isDead) {
                    try {
                        const worldMouse = worldMousePosRefInternal.current;
                        if (worldMouse.x !== null && worldMouse.y !== null) {
                            currentConnection.reducers.dodgeRoll(worldMouse.x, worldMouse.y);
                        }
                    } catch (err) {
                        console.error("[InputHandler] Error calling dodgeRoll reducer:", err);
                    }
                }
                return; // Q key handled
            }

            // Handle movement keys (WASD) - no longer needed for movement, but tracked for other actions
            if (['w', 'a', 's', 'd'].includes(key)) {
                // This hook no longer processes movement keys directly,
                // but we need to track them for dodge rolls.
                keysPressed.current.add(key);
                return; // Movement keys handled
            }

            // Jump
            if (key === ' ' && !event.repeat) {
                // Don't trigger jump when game menus are open
                if (isGameMenuOpen) {
                    return; // Let menus handle spacebar for scrolling
                }
                
                // Don't trigger jump when in menu components (to prevent interfering with scrolling)
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
                
                if (localPlayerRef.current && !localPlayerRef.current.isDead) { // Check player exists and is not dead
                    jump();
                }
            }

            // Interaction key ('e')
            if (key === 'e' && !event.repeat && !isEHeldDownRef.current) {
                isEHeldDownRef.current = true;
                eKeyDownTimestampRef.current = Date.now();

                const currentConnection = connectionRef.current;
                if (!currentConnection?.reducers) return;

                const closest = closestIdsRef.current;

                // Set up a timer for ANY potential hold action.
                // The keyUp handler will decide if it was a tap or a hold.
                
                // Determine the highest priority holdable target
                let holdTarget: InteractionProgressState | null = null;
                if (closest.knockedOutPlayer) {
                    holdTarget = { targetId: closest.knockedOutPlayer, targetType: 'knocked_out_player', startTime: eKeyDownTimestampRef.current };
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
                    
                    const duration = holdTarget.targetType === 'knocked_out_player' ? REVIVE_HOLD_DURATION_MS : HOLD_INTERACTION_DURATION_MS;

                    eKeyHoldTimerRef.current = setTimeout(() => {
                        console.log('[E-Hold COMPLETED] Timer fired for:', holdTarget);
                        // Timer fired, so this is a successful HOLD action.
                        // Re-check if we are still close to the original target.
                        const stillClosest = closestIdsRef.current;
                        console.log('[E-Hold COMPLETED] stillClosest check:', stillClosest);
                        
                        switch(holdTarget.targetType) {
                            case 'knocked_out_player':
                                if (stillClosest.knockedOutPlayer === holdTarget.targetId) {
                                    console.log('[E-Hold ACTION] Attempting to revive player:', holdTarget.targetId);
                                    currentConnection.reducers.reviveKnockedOutPlayer(Identity.fromString(holdTarget.targetId as string));
                                }
                                break;
                            case 'campfire':
                                if (stillClosest.campfire === holdTarget.targetId) {
                                    console.log('[E-Hold ACTION] Attempting to toggle campfire:', holdTarget.targetId);
                                    currentConnection.reducers.toggleCampfireBurning(Number(holdTarget.targetId));
                                }
                                break;
                            case 'wooden_storage_box':
                                if (stillClosest.box === holdTarget.targetId && stillClosest.boxEmpty) {
                                    console.log('[E-Hold ACTION] Attempting to pickup box:', holdTarget.targetId);
                                    currentConnection.reducers.pickupStorageBox(Number(holdTarget.targetId));
                                }
                                break;
                            case 'stash':
                                if (stillClosest.stash === holdTarget.targetId) {
                                    console.log('[E-Hold ACTION] Attempting to toggle stash:', holdTarget.targetId);
                                    currentConnection.reducers.toggleStashVisibility(Number(holdTarget.targetId));
                                }
                                break;
                        }

                        // Clean up UI and state
                        console.log('[E-Hold COMPLETED] Cleaning up state.');
                        setInteractionProgress(null);
                        setIsActivelyHolding(false);
                        isEHeldDownRef.current = false; // Reset the master hold flag
                        eKeyHoldTimerRef.current = null; // Clear the timer ref itself
                    }, duration);
                }
            }
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();
            keysPressed.current.delete(key);

            if (key === 'e') {
                console.log('[E-KeyUp] KeyUp event for "e" detected.');
                if (isEHeldDownRef.current) {
                    // An 'E' interaction was in progress.
                    isEHeldDownRef.current = false;
                    
                    const holdDuration = Date.now() - eKeyDownTimestampRef.current;
                    console.log('[E-KeyUp] A hold was in progress. holdDuration:', holdDuration, 'ms');

                    if (eKeyHoldTimerRef.current) {
                        console.log('[E-KeyUp] Clearing active hold timer.');
                        clearTimeout(eKeyHoldTimerRef.current as number);
                        eKeyHoldTimerRef.current = null;
                    }

                    // It was a TAP, not a hold.
                    if (holdDuration < HOLD_INTERACTION_DURATION_MS) {
                        console.log('[E-KeyUp] Hold was a TAP. Executing tap action.');
                        // Clean up any hold UI that might have started
                        setInteractionProgress(null);
                        setIsActivelyHolding(false);

                        // Perform the tap action.
                        const currentConnection = connectionRef.current;
                        if (!currentConnection?.reducers) return;

                        const closest = closestIdsRef.current;
                        const currentStashes = stashesRef.current;

                        // Priority order for tap actions:
                        if (closest.campfire !== null) {
                            currentConnection.reducers.interactWithCampfire(Number(closest.campfire));
                            onSetInteractingWithRef.current({ type: 'campfire', id: closest.campfire });
                        } else if (closest.box !== null) {
                            currentConnection.reducers.interactWithStorageBox(Number(closest.box));
                            onSetInteractingWithRef.current({ type: 'wooden_storage_box', id: closest.box });
                        } else if (closest.stash !== null) {
                            const stashEntity = currentStashes.get(closest.stash.toString());
                            if (stashEntity && !stashEntity.isHidden) {
                                onSetInteractingWithRef.current({ type: 'stash', id: closest.stash });
                            }
                        } else if (closest.corpse !== null) {
                            onSetInteractingWithRef.current({ type: 'player_corpse', id: closest.corpse });
                        } else if (closest.droppedItem !== null) {
                            currentConnection.reducers.pickupDroppedItem(closest.droppedItem);
                        } else if (closest.mushroom !== null) {
                            currentConnection.reducers.interactWithMushroom(closest.mushroom);
                        } else if (closest.corn !== null) {
                            currentConnection.reducers.interactWithCorn(closest.corn);
                        } else if (closest.potato !== null) {
                            currentConnection.reducers.interactWithPotato(closest.potato);
                        } else if (closest.pumpkin !== null) {
                            currentConnection.reducers.interactWithPumpkin(closest.pumpkin);
                        } else if (closest.hemp !== null) {
                            currentConnection.reducers.interactWithHemp(closest.hemp);
                        }
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
                        keysPressed.current.has('d') || keysPressed.current.has('arrowright') ||
                        isAutoWalking
                    );
                    
                    if (isCurrentlyMoving) {
                        // Use current movement direction
                        if (isAutoWalking) {
                            throwingDirection = autoWalkDirectionRef.current;
                        } else {
                            const dx = (keysPressed.current.has('d') || keysPressed.current.has('arrowright') ? 1 : 0) -
                                       (keysPressed.current.has('a') || keysPressed.current.has('arrowleft') ? 1 : 0);
                            const dy = (keysPressed.current.has('s') || keysPressed.current.has('arrowdown') ? 1 : 0) -
                                       (keysPressed.current.has('w') || keysPressed.current.has('arrowup') ? 1 : 0);
                            
                            if (dx !== 0 || dy !== 0) {
                                throwingDirection = { dx, dy };
                            }
                        }
                        console.log("[InputHandler] Right-click throw - using current movement direction:", throwingDirection);
                    } else {
                        // Use last movement direction if available
                        if (lastMovementDirectionRef.current.dx !== 0 || lastMovementDirectionRef.current.dy !== 0) {
                            throwingDirection = lastMovementDirectionRef.current;
                            console.log("[InputHandler] Right-click throw - using last movement direction:", throwingDirection);
                        } else {
                            console.log("[InputHandler] Right-click throw - using default direction (down):", throwingDirection);
                        }
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
            // REMOVED Sprinting logic from blur handler.
            // keysPressed.current.clear(); // Keep this commented out
            isMouseDownRef.current = false;
            isRightMouseDownRef.current = false; // Reset right mouse state
            isEHeldDownRef.current = false;
            if(eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current);
            eKeyHoldTimerRef.current = null;
            setInteractionProgress(null);
            // Clear auto-attack state when window loses focus
            setIsAutoAttacking(false);
            // Clear auto-walk state when window loses focus
            setIsAutoWalking(false);
        };

        // Add global listeners
        window.addEventListener('keydown', handleKeyDown);
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
            window.removeEventListener('keydown', handleKeyDown);
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
            // Clear any active timers on cleanup
            if (eKeyHoldTimerRef.current) {
                clearTimeout(eKeyHoldTimerRef.current as number); // Ensure casting for browser env
                eKeyHoldTimerRef.current = null;
            }
        };
    }, [canvasRef, localPlayer?.isDead, placementInfo, jump, attemptSwing, setIsMinimapOpen, isChatting, isSearchingCraftRecipes, isInventoryOpen, isGameMenuOpen, onToggleAutoWalk, isMinimapOpen]);

    useEffect(() => {
        if (!isAutoWalking || isChatting || isGameMenuOpen || !!isSearchingCraftRecipes) {
            return;
        }

        const move = () => {
            const player = localPlayerRef.current;
            const mouse = worldMousePosRefInternal.current;
            if (!player || !mouse.x || !mouse.y) return;

            const dx = mouse.x - player.positionX;
            const dy = mouse.y - player.positionY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 20) { // Stop when close to the target
                const dirX = dx / dist;
                const dirY = dy / dist;
                connectionRef.current?.reducers.updatePlayerPosition(dirX, dirY);
            } else {
                setIsAutoWalking(false); // Stop auto-walking upon arrival
            }
        };

        const intervalId = setInterval(move, 50); // Move 20 times per second

        return () => clearInterval(intervalId);
    }, [isAutoWalking, isChatting, isGameMenuOpen, isSearchingCraftRecipes]);

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
            // This hook no longer manages sprinting, so no need to reset it here.

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
        if (currentLocalPlayer && currentLocalPlayer.jumpStartTimeMs > 0) {
            const nowMs = Date.now();
            const elapsedJumpTime = nowMs - Number(currentLocalPlayer.jumpStartTimeMs);

            if (elapsedJumpTime >= 0 && elapsedJumpTime < JUMP_DURATION_MS) {
                const t = elapsedJumpTime / JUMP_DURATION_MS;
                const jumpOffset = Math.sin(t * Math.PI) * JUMP_HEIGHT_PX;
                currentJumpOffsetYRef.current = jumpOffset;
            } else {
                currentJumpOffsetYRef.current = 0; // End of jump
            }
        } else if (currentJumpOffsetYRef.current !== 0) { // Ensure it resets if not jumping
            currentJumpOffsetYRef.current = 0;
        }
        // --- End Jump Offset Calculation ---

        // This hook doesn't send movement updates, but it does need to track the last
        // direction for actions like throwing.
        const dx = (keysPressed.current.has('d') || keysPressed.current.has('arrowright') ? 1 : 0) -
                   (keysPressed.current.has('a') || keysPressed.current.has('arrowleft') ? 1 : 0);
        const dy = (keysPressed.current.has('s') || keysPressed.current.has('arrowdown') ? 1 : 0) -
                   (keysPressed.current.has('w') || keysPressed.current.has('arrowup') ? 1 : 0);

        if (dx !== 0 || dy !== 0) {
            lastMovementDirectionRef.current = { dx, dy };
        }

        // Handle continuous swing check
        // MODIFIED: Guard this with isChatting, isSearchingCraftRecipes, AND isInventoryOpen
        if (isMouseDownRef.current && !placementInfo && !isChatting && !isSearchingCraftRecipes && !isInventoryOpen) {
            attemptSwing(); // Call internal attemptSwing function
        }

        // Handle auto-attack
        if (isAutoAttacking && !placementInfo && !isChatting && !isSearchingCraftRecipes && !isInventoryOpen) {
            attemptSwing(); // Call internal attemptSwing function for auto-attack
        }
    }, [
        isPlayerDead, attemptSwing, placementInfo,
        localPlayerId, localPlayer, activeEquipments, worldMousePos, connection,
        closestInteractableMushroomId, closestInteractableCornId, closestInteractablePotatoId, closestInteractablePumpkinId, closestInteractableHempId, 
        closestInteractableCampfireId, closestInteractableDroppedItemId, closestInteractableBoxId, 
        isClosestInteractableBoxEmpty, onSetInteractingWith,
        isChatting, isSearchingCraftRecipes, setIsMinimapOpen, isInventoryOpen 
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
            "Stone Axe", "Stone Knife", "Wooden Club", "Improvised Knife"
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
        isAutoWalking,
        processInputsAndActions,
    };
}; 