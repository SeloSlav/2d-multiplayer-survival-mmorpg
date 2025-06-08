import { useEffect, useRef, useState, useCallback, RefObject } from 'react';
import * as SpacetimeDB from '../generated';
import { DbConnection } from '../generated';
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

// --- Hook Props Interface ---
interface UseInputHandlerProps {
    canvasRef: RefObject<HTMLCanvasElement | null>;
    connection: DbConnection | null;
    localPlayerId?: string;
    localPlayer?: SpacetimeDB.Player | null;
    activeEquipments?: Map<string, SpacetimeDB.ActiveEquipment>;
    itemDefinitions: Map<string, SpacetimeDB.ItemDefinition>;
    placementInfo: PlacementItemInfo | null;
    placementActions: PlacementActions;
    worldMousePos: { x: number | null; y: number | null }; // Pass world mouse position
    // Closest interactables (passed in for now)
    closestInteractableMushroomId: bigint | null;
    closestInteractableCornId: bigint | null;
    closestInteractablePotatoId: bigint | null;
    closestInteractablePumpkinId: bigint | null;
    closestInteractableHempId: bigint | null;
    closestInteractableCampfireId: number | null;
    closestInteractableDroppedItemId: bigint | null;
    closestInteractableBoxId: number | null;
    isClosestInteractableBoxEmpty: boolean;
    woodenStorageBoxes: Map<string, SpacetimeDB.WoodenStorageBox>; // <<< ADDED
    closestInteractableCorpseId: bigint | null;
    closestInteractableStashId: number | null; // Changed from bigint to number for Stash ID
    stashes: Map<string, SpacetimeDB.Stash>; // Added stashes map
    closestInteractableKnockedOutPlayerId: string | null; // Added for knocked out player revive
    players: Map<string, SpacetimeDB.Player>; // Added players map for knocked out revive
    // Callbacks for actions
    onSetInteractingWith: (target: { type: string; id: number | bigint } | null) => void;
    // Note: movement functions are now provided by usePlayerActions hook
    // Note: attemptSwing logic will be internal to the hook
    // Add minimap state and setter
    isMinimapOpen: boolean;
    setIsMinimapOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isChatting: boolean;
    isSearchingCraftRecipes?: boolean;
    isInventoryOpen: boolean; // Prop to indicate if inventory is open
    isGameMenuOpen: boolean; // Prop to indicate if game menu is open
}

// --- Hook Return Value Interface ---
interface InputHandlerState {
    // State needed for rendering or other components
    interactionProgress: InteractionProgressState | null;
    isActivelyHolding: boolean;
    isSprinting: boolean; // Expose current sprint state if needed elsewhere
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
    closestInteractableKnockedOutPlayerId, // Added for knocked out player revive
    players, // Added players map for knocked out revive
    onSetInteractingWith,
    isMinimapOpen,
    setIsMinimapOpen,
    isChatting,
    isSearchingCraftRecipes,
    isInventoryOpen, // Destructure new prop
    isGameMenuOpen, // Destructure new prop
}: UseInputHandlerProps): InputHandlerState => {
    // console.log('[useInputHandler IS RUNNING] isInventoryOpen:', isInventoryOpen);
    // Get player actions from the context instead of props
    const { updatePlayerPosition, jump, setSprinting } = usePlayerActions();

    // --- Internal State and Refs ---
    const keysPressed = useRef<Set<string>>(new Set());
    const isSprintingRef = useRef<boolean>(false);
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
    const isAutoWalkingRef = useRef<boolean>(false);
    const autoWalkDirectionRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
    const lastMovementDirectionRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 1 }); // Default to facing down

    // Refs for auto-attack state
    const isAutoAttackingRef = useRef<boolean>(false);
    
    // Ref to track shift key state (since shift isn't added to keysPressed)
    const isShiftHeldRef = useRef<boolean>(false);

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
        campfire: null as number | null,
        droppedItem: null as bigint | null,
        box: null as number | null,
        boxEmpty: false,
        corpse: null as bigint | null,
        stash: null as number | null, // Changed from bigint to number for Stash ID
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
    
    // --- No longer needed since we removed throttling for super smooth facing ---
    // const lastMouseFacingUpdateRef = useRef<number>(0);
    // const MOUSE_FACING_UPDATE_INTERVAL_MS = 16;

    // --- Derive input disabled state based ONLY on player death --- 
    const isPlayerDead = localPlayer?.isDead ?? false;

    // --- Effect to reset sprint state if player dies --- 
    useEffect(() => {
        if (localPlayer?.isDead && isSprintingRef.current) {
            // console.log("[InputHandler] Player died while sprinting, forcing sprint off.");
            isSprintingRef.current = false;
            // Call reducer to ensure server state is consistent
            setSprinting(false);
        }
        // Also clear E hold state if player dies
        if (localPlayer?.isDead && isEHeldDownRef.current) {
             isEHeldDownRef.current = false;
             if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current as number);
             eKeyHoldTimerRef.current = null;
             setInteractionProgress(null);
             setIsActivelyHolding(false);
        }
        // Also clear auto-attack state if player dies
        if (localPlayer?.isDead && isAutoAttackingRef.current) {
            isAutoAttackingRef.current = false;
        }
        // Also clear auto-walk state if player dies
        if (localPlayer?.isDead && isAutoWalkingRef.current) {
            isAutoWalkingRef.current = false;
        }
    }, [localPlayer?.isDead, setSprinting]); // Depend on death state and the reducer callback

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
            const key = event.key.toLowerCase();

            // MODIFIED: Block if player is dead, chatting, or searching recipes
            // REMOVED isInventoryOpen from this top-level guard for general keydown events
            if (isPlayerDead || isChatting || isSearchingCraftRecipes) {
                // Allow escape for placement even if inventory is open (this was a good specific check)
                if (event.key.toLowerCase() === 'escape' && placementInfo && isInventoryOpen) {
                    placementActionsRef.current?.cancelPlacement();
                }
                // Allow escape to close inventory (this is typically handled by PlayerUI, but good to not block it here)
                // No, PlayerUI handles tab. Escape here if inventory is open should only be for placement.
                return;
            }

            // Placement cancellation (checked before general input disabled)
            // This check is fine as is, if placement is active, escape should cancel it.
            if (key === 'escape' && placementInfo) {
                placementActionsRef.current?.cancelPlacement();
                return;
            }

            // Sprinting start
            if (key === 'shift' && !isSprintingRef.current && !event.repeat) {
                isSprintingRef.current = true;
                isShiftHeldRef.current = true; // Track shift state
                setSprinting(true);
                return; // Don't add shift to keysPressed
            }

            // Avoid adding modifier keys
            if (key === 'shift' || key === 'control' || key === 'alt' || key === 'meta') {
                return;
            }

            // Handle 'Insert' for fine movement toggle
            if (key === 'c' && !event.repeat) {
                const currentConnection = connectionRef.current;
                if (currentConnection?.reducers) {
                    try {
                        currentConnection.reducers.toggleCrouch();
                        // console.log("[InputHandler Insert] Called toggleCrouch reducer.");
                    } catch (err) {
                        console.error("[InputHandler Insert] Error calling toggleCrouch reducer:", err);
                    }
                }
                return; // 'Insert' is handled, don't process further
            }

            // Handle 'q' for auto-walk
            if (key === 'f' && !event.repeat) {
                if (isAutoWalkingRef.current) {
                    isAutoWalkingRef.current = false;
                    // console.log("[InputHandler Q] Auto-walk stopped.");
                } else {
                    isAutoWalkingRef.current = true;
                    // Use player's current facing direction instead of last movement
                    const currentPlayer = localPlayerRef.current;
                    if (currentPlayer) {
                        const facingDirection = getDirectionVector(currentPlayer.direction);
                        autoWalkDirectionRef.current = facingDirection;
                        // console.log(`[InputHandler Q] Auto-walk started with facing direction: ${currentPlayer.direction} (dx=${facingDirection.dx}, dy=${facingDirection.dy})`);
                    } else {
                        // Fallback to last movement direction if player not available
                        autoWalkDirectionRef.current = lastMovementDirectionRef.current;
                        // console.log(`[InputHandler Q] Auto-walk started with fallback direction: dx=${autoWalkDirectionRef.current.dx}, dy=${autoWalkDirectionRef.current.dy}`);
                    }
                }
                return; // 'q' is handled
            }

            // Handle 'z' for auto-attack
            if (key === 'z' && !event.repeat) {
                if (isAutoAttackingRef.current) {
                    isAutoAttackingRef.current = false;
                    console.log("[InputHandler Z] Auto-attack stopped.");
                } else {
                    isAutoAttackingRef.current = true;
                    console.log("[InputHandler Z] Auto-attack started.");
                }
                return; // 'z' is handled
            }

            // Dodge Roll (Q key)
            if (key === 'q' && !event.repeat) {
                const currentConnection = connectionRef.current;
                const currentLocalPlayer = localPlayerRef.current;
                
                if (currentConnection?.reducers && currentLocalPlayer && !currentLocalPlayer.isDead) {
                    try {
                        // Get current movement direction from pressed keys
                        let moveX = 0;
                        let moveY = 0;
                        
                        if (keysPressed.current.has('a')) moveX -= 1;
                        if (keysPressed.current.has('d')) moveX += 1;
                        if (keysPressed.current.has('w')) moveY -= 1;
                        if (keysPressed.current.has('s')) moveY += 1;
                        
                        console.log(`[InputHandler] Q key pressed, triggering dodge roll with direction: (${moveX}, ${moveY})`);
                        currentConnection.reducers.dodgeRoll(moveX, moveY);
                    } catch (err) {
                        console.error("[InputHandler] Error calling dodgeRoll reducer:", err);
                    }
                }
                return; // Q key handled
            }

            // Handle movement keys (WASD)
            if (['w', 'a', 's', 'd'].includes(key)) {
                // Cancel auto-walk if shift + movement key is pressed
                if (isShiftHeldRef.current && isAutoWalkingRef.current) {
                    isAutoWalkingRef.current = false;
                    // console.log("[InputHandler] Auto-walk canceled by Shift + movement key");
                }
                
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
                const currentConnection = connectionRef.current;
                if (!currentConnection?.reducers) return;
                const closest = closestIdsRef.current;
                const currentStashes = stashesRef.current;
                const currentClosestStashId = closest.stash;
                
                // --- Stash Interaction ---
                if (currentClosestStashId !== null && currentStashes) {
                    const stashEntity = currentStashes.get(currentClosestStashId.toString());
                    if (stashEntity) {
                        // console.log(`[DEBUG E-Press] Stash interaction - ID: ${currentClosestStashId}, Hidden: ${stashEntity.isHidden}`);
                        
                        isEHeldDownRef.current = true; 
                        eKeyDownTimestampRef.current = Date.now();

                        setInteractionProgress({ targetId: currentClosestStashId, targetType: 'stash', startTime: Date.now() });
                        setIsActivelyHolding(true);
                        
                        if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current as number);
                        eKeyHoldTimerRef.current = setTimeout(() => {
                            if (isEHeldDownRef.current && connectionRef.current?.reducers && currentClosestStashId !== null) {
                                try {
                                    connectionRef.current.reducers.toggleStashVisibility(Number(currentClosestStashId));
                                } catch (error) {
                                    console.error("[InputHandler] Error calling toggleStashVisibility in timer:", error);
                                }
                            }
                            setInteractionProgress(null); 
                            setIsActivelyHolding(false);
                            isEHeldDownRef.current = false; 
                            if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current as number); 
                            eKeyHoldTimerRef.current = null; 
                        }, HOLD_INTERACTION_DURATION_MS);
                        return; 
                    }
                }

                // --- Knocked Out Player Interaction ---
                const currentClosestKnockedOutPlayerId = closest.knockedOutPlayer;
                const currentPlayers = playersRef.current;
                if (currentClosestKnockedOutPlayerId !== null && currentPlayers) {
                    const knockedOutPlayer = currentPlayers.get(currentClosestKnockedOutPlayerId);
                    if (knockedOutPlayer && knockedOutPlayer.isKnockedOut && !knockedOutPlayer.isDead) {
                        // console.log(`[DEBUG E-Press] Knocked out player interaction - ID: ${currentClosestKnockedOutPlayerId}`);
                        
                        isEHeldDownRef.current = true; 
                        eKeyDownTimestampRef.current = Date.now();

                        setInteractionProgress({ targetId: currentClosestKnockedOutPlayerId, targetType: 'knocked_out_player', startTime: Date.now() });
                        setIsActivelyHolding(true);
                        
                        if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current as number);
                        eKeyHoldTimerRef.current = setTimeout(() => {
                            if (isEHeldDownRef.current && connectionRef.current?.reducers && currentClosestKnockedOutPlayerId !== null) {
                                try {
                                    // Convert hex string back to Identity for the reducer call
                                    currentConnection.reducers.reviveKnockedOutPlayer(Identity.fromString(currentClosestKnockedOutPlayerId));
                                } catch (error) {
                                    console.error("[InputHandler] Error calling reviveKnockedOutPlayer in timer:", error);
                                }
                            }
                            setInteractionProgress(null); 
                            setIsActivelyHolding(false);
                            isEHeldDownRef.current = false; 
                            if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current as number); 
                            eKeyHoldTimerRef.current = null; 
                        }, REVIVE_HOLD_DURATION_MS); // Use 6-second duration for revive
                        return; 
                    }
                }

                // Pure Tap Actions (If no stash or knocked out player interaction was initiated)
                if (closest.droppedItem !== null) {
                    // console.log(`[DEBUG E-Press] Dropped item interaction - ID: ${closest.droppedItem}`);
                    try {
                        currentConnection.reducers.pickupDroppedItem(closest.droppedItem);
                    } catch (err) {
                        console.error("Error calling pickupDroppedItem reducer:", err);
                    }
                    return; 
                }

                if (closest.mushroom !== null) {
                    // console.log(`[DEBUG E-Press] Mushroom interaction - ID: ${closest.mushroom}`);
                    try {
                        const result = currentConnection.reducers.interactWithMushroom(closest.mushroom);
                        // console.log(`[DEBUG E-Press] Mushroom reducer called successfully:`, result);
                    } catch (err) {
                        console.error("Error calling interactWithMushroom reducer:", err);
                    }
                    return; 
                }
                if (closest.corn !== null) {
                    // console.log(`[DEBUG E-Press] Corn interaction - ID: ${closest.corn}`);
                    try {
                        const result = currentConnection.reducers.interactWithCorn(closest.corn);
                        // console.log(`[DEBUG E-Press] Corn reducer called successfully:`, result);
                    } catch (err) {
                        console.error("Error calling interactWithCorn reducer:", err);
                    }
                    return; 
                }
                if (closest.potato !== null) {
                    // console.log(`[DEBUG E-Press] Potato interaction - ID: ${closest.potato}`);
                    try {
                        const result = currentConnection.reducers.interactWithPotato(closest.potato);
                        // console.log(`[DEBUG E-Press] Potato reducer called successfully:`, result);
                    } catch (err) {
                        console.error("Error calling interactWithPotato reducer:", err);
                    }
                    return; 
                }
                if (closest.pumpkin !== null) {
                    // console.log(`[DEBUG E-Press] Pumpkin interaction - ID: ${closest.pumpkin}`);
                    try {
                        const result = currentConnection.reducers.interactWithPumpkin(closest.pumpkin);
                        // console.log(`[DEBUG E-Press] Pumpkin reducer called successfully:`, result);
                    } catch (err) {
                        console.error("Error calling interactWithPumpkin reducer:", err);
                    }
                    return; 
                }
                if (closest.hemp !== null) {
                    // console.log(`[DEBUG E-Press] Hemp interaction - ID: ${closest.hemp}`);
                    try {
                        const result = currentConnection.reducers.interactWithHemp(closest.hemp);
                        // console.log(`[DEBUG E-Press] Hemp reducer called successfully:`, result);
                    } catch (err) {
                        console.error("Error calling interactWithHemp reducer:", err);
                    }
                    return; 
                }
                
                // Tap-or-Hold Actions for other entities (Box, Campfire)
                if (closest.box !== null) {
                    // console.log(`[DEBUG E-Press] Box interaction - ID: ${closest.box}, Empty: ${closest.boxEmpty}`);
                    isEHeldDownRef.current = true;
                    eKeyDownTimestampRef.current = Date.now();
                    if (closest.boxEmpty) { 
                        setInteractionProgress({ targetId: closest.box, targetType: 'wooden_storage_box', startTime: Date.now() });
                        setIsActivelyHolding(true);
                        if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current as number);
                        eKeyHoldTimerRef.current = setTimeout(() => {
                            if (isEHeldDownRef.current) {
                                const stillClosest = closestIdsRef.current;
                                if (stillClosest.box === closest.box && stillClosest.boxEmpty) {
                                    try {
                                        connectionRef.current?.reducers.pickupStorageBox(closest.box!);
                                    } catch (err) { console.error("[InputHandler Hold Timer] Error calling pickupStorageBox reducer:", err); }
                                }
                            }
                            setInteractionProgress(null); 
                            setIsActivelyHolding(false);
                            isEHeldDownRef.current = false; 
                            if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current as number);
                            eKeyHoldTimerRef.current = null;
                        }, HOLD_INTERACTION_DURATION_MS);
                    }
                    return; 
                }
                
                if (closest.campfire !== null) {
                    // console.log(`[DEBUG E-Press] Campfire interaction - ID: ${closest.campfire}`);
                    isEHeldDownRef.current = true;
                    eKeyDownTimestampRef.current = Date.now();
                    setInteractionProgress({ targetId: closest.campfire, targetType: 'campfire', startTime: Date.now() });
                    setIsActivelyHolding(true);
                    if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current as number);
                    eKeyHoldTimerRef.current = setTimeout(() => {
                        if (isEHeldDownRef.current) {
                            const stillClosest = closestIdsRef.current;
                            if (stillClosest.campfire === closest.campfire) {
                                try {
                                    connectionRef.current?.reducers.toggleCampfireBurning(closest.campfire!);
                                } catch (err) { console.error("[InputHandler Hold Timer - Campfire] Error toggling campfire:", err); }
                            }
                        }
                        setInteractionProgress(null); 
                        setIsActivelyHolding(false);
                        isEHeldDownRef.current = false; 
                        if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current as number);
                        eKeyHoldTimerRef.current = null;
                    }, HOLD_INTERACTION_DURATION_MS);
                    return; 
                }

                if (closest.corpse !== null) {
                    // console.log(`[DEBUG E-Press] Corpse interaction - ID: ${closest.corpse}`);
                    isEHeldDownRef.current = true;
                    eKeyDownTimestampRef.current = Date.now();
                    return; 
                }
            }

            // --- Handle Minimap Toggle ---
            if (key === 'g') { // Check lowercase key
                setIsMinimapOpen((prev: boolean) => !prev); // Toggle immediately
                event.preventDefault(); // Prevent typing 'g' in chat etc.
                return; // Don't add 'g' to keysPressed
            }

            // --- E Key (Interact / Hold Interact) ---
            if (event.key.toLowerCase() === 'e') {
                if (isEHeldDownRef.current) return; // Prevent re-triggering if already held

                const currentClosestStashId = closestIdsRef.current.stash;
                const currentStashes = stashesRef.current;

                // Priority 1: Stash Interaction (Open or Initiate Hold)
                if (currentClosestStashId !== null && currentStashes) {
                    const stashEntity = currentStashes.get(currentClosestStashId.toString());
                    if (stashEntity) {
                        if (!stashEntity.isHidden) {
                            // Short press E on VISIBLE stash: Open it
                            onSetInteractingWithRef.current({ type: 'stash', id: currentClosestStashId });
                            // console.log(`[InputHandler E-Press] Opening stash: ${currentClosestStashId}`);
                            return; // Interaction handled, don't proceed to hold logic for this press
                        }
                        // If stash is hidden OR if it's visible and we didn't return above (e.g. future proofing for explicit hide action)
                        // Initiate HOLD interaction for toggling visibility
                        eKeyDownTimestampRef.current = Date.now();
                        isEHeldDownRef.current = true;
                        setInteractionProgress({ targetId: currentClosestStashId, targetType: 'stash', startTime: Date.now() });
                        setIsActivelyHolding(true);
                        // console.log(`[InputHandler E-Press] Starting HOLD for stash: ${currentClosestStashId}`);

                        eKeyHoldTimerRef.current = setTimeout(() => {
                            if (isEHeldDownRef.current && connectionRef.current?.reducers && currentClosestStashId !== null) {
                                // console.log(`[InputHandler E-Hold COMPLETED] Toggling visibility for stash: ${closestIdsRef.current.stash}`);
                                try {
                                    connectionRef.current.reducers.toggleStashVisibility(Number(currentClosestStashId));
                                } catch (error) {
                                    console.error("[InputHandler] Error calling toggleStashVisibility:", error);
                                }
                            }
                            setInteractionProgress(null);
                            setIsActivelyHolding(false);
                            isEHeldDownRef.current = false; // Reset hold state after action or if key was released
                        }, HOLD_INTERACTION_DURATION_MS);
                        return; // Hold initiated or visible stash opened, interaction handled
                    }
                }
            }
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();

            // Sprinting stop
            if (key === 'shift' && isSprintingRef.current) {
                isSprintingRef.current = false;
                isShiftHeldRef.current = false; // Reset shift state
                setSprinting(false);
                return;
            }

            // MODIFIED: Block if player is dead, chatting, or searching recipes
            // REMOVED isInventoryOpen from this top-level guard for general keyup events
            if (isPlayerDead || isChatting || isSearchingCraftRecipes) {
                return;
            }
            // keysPressed.current.delete(key);
            // If auto-walking, and the released key was a movement key, it might have been added to keysPressed.current
            // temporarily for direction calculation. Ensure it's removed so it doesn't stick.
            const isMovementKey = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key);
            if (isAutoWalkingRef.current && isMovementKey) {
                keysPressed.current.delete(key);
            } else if (!isAutoWalkingRef.current) {
                // If not auto-walking, normal removal from keysPressed.
                keysPressed.current.delete(key);
            }

            // Interaction key ('e') up
            if (key === 'e') {
                if (isEHeldDownRef.current) { // Check if E was being held for an interaction
                    const holdDuration = Date.now() - eKeyDownTimestampRef.current;
                    const RETAINED_CLOSEST_STASH_ID = closestIdsRef.current.stash; 
                    const RETAINED_CLOSEST_CORPSE_ID = closestIdsRef.current.corpse;
                    const RETAINED_CLOSEST_BOX_ID = closestIdsRef.current.box;
                    const RETAINED_CLOSEST_CAMPFIRE_ID = closestIdsRef.current.campfire;

                    // Always clear the timer if it exists (in case keyUp happens before timer fires)
                    if (eKeyHoldTimerRef.current) {
                        clearTimeout(eKeyHoldTimerRef.current as number);
                        eKeyHoldTimerRef.current = null;
                    }

                    // Reset hold state and unconditionally clear interaction progress if a hold was active
                    isEHeldDownRef.current = false;
                    eKeyDownTimestampRef.current = 0;
                    if (interactionProgress) { // If there was any interaction progress, clear it now
                        setInteractionProgress(null);
                        // console.log(`[InputHandler E-KeyUp] Cleared interactionProgress because E hold ended.`);
                    }

                    // Also ensure isActivelyHolding is false if E key is up and was part of a hold
                    setIsActivelyHolding(false);

                    // Check if it was a TAP action (released before hold duration)
                    if (holdDuration < HOLD_INTERACTION_DURATION_MS) {
                        const currentConnection = connectionRef.current;
                        const currentStashes = stashesRef.current;

                        if (RETAINED_CLOSEST_STASH_ID !== null && currentStashes) {
                            const stashEntity = currentStashes.get(RETAINED_CLOSEST_STASH_ID.toString());
                            if (stashEntity && !stashEntity.isHidden) {
                                onSetInteractingWithRef.current({ type: 'stash', id: RETAINED_CLOSEST_STASH_ID });
                            }
                        } 
                        else if (RETAINED_CLOSEST_CORPSE_ID !== null) {
                            onSetInteractingWithRef.current({ type: 'player_corpse', id: RETAINED_CLOSEST_CORPSE_ID });
                        } 
                        else if (RETAINED_CLOSEST_BOX_ID !== null && currentConnection?.reducers) {
                             try {
                                currentConnection.reducers.interactWithStorageBox(RETAINED_CLOSEST_BOX_ID);
                                onSetInteractingWithRef.current({ type: 'wooden_storage_box', id: RETAINED_CLOSEST_BOX_ID });
                             } catch (err) { 
                                console.error("[InputHandler KeyUp E - TAP Box] Error calling interactWithStorageBox:", err);
                             }
                        } 
                        else if (RETAINED_CLOSEST_CAMPFIRE_ID !== null && currentConnection?.reducers) {
                            try {
                                currentConnection.reducers.interactWithCampfire(RETAINED_CLOSEST_CAMPFIRE_ID);
                                onSetInteractingWithRef.current({ type: 'campfire', id: RETAINED_CLOSEST_CAMPFIRE_ID });
                            } catch (err) {
                                console.error("[InputHandler KeyUp E - TAP Campfire] Error calling interactWithCampfire:", err);
                            }
                        }
                    } 
                    // If it was a hold, the timer in keyDown (or its clearing here) handles the action.
                    // Interaction progress is cleared above.
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
                    connectionRef.current.reducers.useEquippedItem(); 
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
                        isAutoWalkingRef.current
                    );
                    
                    if (isCurrentlyMoving) {
                        // Use current movement direction
                        if (isAutoWalkingRef.current) {
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
            if (isSprintingRef.current) {
                isSprintingRef.current = false;
                isShiftHeldRef.current = false; // Reset shift state on blur
                // Call reducer regardless of focus state if window loses focus
                setSprinting(false); 
            }
            // keysPressed.current.clear(); // Keep this commented out
            isMouseDownRef.current = false;
            isRightMouseDownRef.current = false; // Reset right mouse state
            isEHeldDownRef.current = false;
            if(eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current);
            eKeyHoldTimerRef.current = null;
            setInteractionProgress(null);
            // Clear auto-attack state when window loses focus
            isAutoAttackingRef.current = false;
            // Clear auto-walk state when window loses focus
            isAutoWalkingRef.current = false;
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
    }, [canvasRef, localPlayer?.isDead, placementInfo, setSprinting, jump, attemptSwing, setIsMinimapOpen, isChatting, isSearchingCraftRecipes, isInventoryOpen, isGameMenuOpen]);

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
        
        // --- Update mouse-based facing direction ---
        // Send mouse position to server to update player facing direction (overrides movement-based direction)
        // No throttling for super smooth facing direction like Blazing Beaks
        if (!isInputDisabledState && worldMousePosRefInternal.current.x !== null && worldMousePosRefInternal.current.y !== null) {
            try {
                currentConnection.reducers.updatePlayerFacingDirection(
                    worldMousePosRefInternal.current.x,
                    worldMousePosRefInternal.current.y
                );
            } catch (err) {
                console.error("[InputHandler] Error calling updatePlayerFacingDirection reducer:", err);
            }
        }

        // Input is disabled if the player is dead
        // Do not process any game-related input if disabled
        if (isInputDisabledState) {
            return; // Early return - player is dead, skip all input processing
        }

        // MODIFIED: Do nothing if player is dead, or if chatting/searching
        if (!currentLocalPlayer || currentLocalPlayer.isDead || isChatting || isSearchingCraftRecipes) {
             // Reset sprint state on death if not already handled by useEffect
            if (isSprintingRef.current && currentLocalPlayer?.isDead) { // Only reset sprint due to death
                isSprintingRef.current = false;
                // No need to call reducer here, useEffect for player.isDead handles it for death
            } else if (isSprintingRef.current && (isChatting || isSearchingCraftRecipes)) {
                // If chatting or searching and was sprinting, send stop sprinting
                isSprintingRef.current = false;
                setSprinting(false); 
            }
            // Reset auto-attack state when in UI states
            if (isAutoAttackingRef.current && (isChatting || isSearchingCraftRecipes)) {
                isAutoAttackingRef.current = false;
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

        // Process movement with throttling
        // Calculate movement direction from currently pressed keys
        const dx = (keysPressed.current.has('d') || keysPressed.current.has('arrowright') ? 1 : 0) -
                   (keysPressed.current.has('a') || keysPressed.current.has('arrowleft') ? 1 : 0);
        const dy = (keysPressed.current.has('s') || keysPressed.current.has('arrowdown') ? 1 : 0) -
                   (keysPressed.current.has('w') || keysPressed.current.has('arrowup') ? 1 : 0);

        // Throttle movement updates to prevent network spam
        const now = Date.now();
        const shouldUpdateMovement = now - lastMovementUpdateRef.current >= MOVEMENT_UPDATE_INTERVAL_MS;

        if (isAutoWalkingRef.current) {
            // Auto-walking mode: use manual input if any keys are pressed, otherwise use stored auto-walk direction
            if (dx !== 0 || dy !== 0) {
                // Manual input takes priority during auto-walk
                if (shouldUpdateMovement) {
                    updatePlayerPosition(dx, dy);
                    lastMovementUpdateRef.current = now;
                }
                // Update auto-walk direction to match current input for smoother transitions
                autoWalkDirectionRef.current = { dx, dy };
                lastMovementDirectionRef.current = { dx, dy };
            } else {
                // No manual input, use stored auto-walk direction
                const { dx: autoDx, dy: autoDy } = autoWalkDirectionRef.current;
                if ((autoDx !== 0 || autoDy !== 0) && shouldUpdateMovement) {
                    updatePlayerPosition(autoDx, autoDy);
                    lastMovementUpdateRef.current = now;
                }
            }
        } else {
            // Manual movement mode
            if ((dx !== 0 || dy !== 0) && shouldUpdateMovement) {
                updatePlayerPosition(dx, dy);
                lastMovementDirectionRef.current = { dx, dy };
                lastMovementUpdateRef.current = now;
            }
        }

        // Handle continuous swing check
        // MODIFIED: Guard this with isChatting, isSearchingCraftRecipes, AND isInventoryOpen
        if (isMouseDownRef.current && !placementInfo && !isChatting && !isSearchingCraftRecipes && !isInventoryOpen) {
            attemptSwing(); // Call internal attemptSwing function
        }

        // Handle auto-attack
        if (isAutoAttackingRef.current && !placementInfo && !isChatting && !isSearchingCraftRecipes && !isInventoryOpen) {
            attemptSwing(); // Call internal attemptSwing function for auto-attack
        }
    }, [
        isPlayerDead, updatePlayerPosition, attemptSwing, placementInfo,
        localPlayerId, localPlayer, activeEquipments, worldMousePos, connection,
        closestInteractableMushroomId, closestInteractableCornId, closestInteractablePotatoId, closestInteractablePumpkinId, closestInteractableHempId, 
        closestInteractableCampfireId, closestInteractableDroppedItemId, closestInteractableBoxId, 
        isClosestInteractableBoxEmpty, onSetInteractingWith,
        isChatting, isSearchingCraftRecipes, setSprinting, isInventoryOpen 
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
        isSprinting: isSprintingRef.current, // Return the ref's current value
        currentJumpOffsetY: currentJumpOffsetYRef.current, // Return current ref value
        isAutoAttacking: isAutoAttackingRef.current,
        isAutoWalking: isAutoWalkingRef.current,
        processInputsAndActions,
    };
}; 