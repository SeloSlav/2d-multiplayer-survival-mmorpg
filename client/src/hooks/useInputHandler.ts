import { useEffect, useRef, useState, useCallback, RefObject } from 'react';
import * as SpacetimeDB from '../generated';
import { DbConnection } from '../generated';
import { PlacementItemInfo, PlacementActions } from './usePlacementManager'; // Assuming usePlacementManager exports these
import React from 'react';
import { usePlayerActions } from '../contexts/PlayerActionsContext';
import { JUMP_DURATION_MS, JUMP_HEIGHT_PX } from '../config/gameConfig'; // <<< ADDED IMPORT

// Ensure HOLD_INTERACTION_DURATION_MS is defined locally if not already present
// If it was already defined (e.g., as `const HOLD_INTERACTION_DURATION_MS = 250;`), this won't change it.
// If it was missing, this adds it.
export const HOLD_INTERACTION_DURATION_MS = 250;

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
    // Callbacks for actions
    onSetInteractingWith: (target: { type: string; id: number | bigint } | null) => void;
    // Note: movement functions are now provided by usePlayerActions hook
    // Note: attemptSwing logic will be internal to the hook
    // Add minimap state and setter
    isMinimapOpen: boolean;
    setIsMinimapOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isChatting: boolean;
    isSearchingCraftRecipes?: boolean;
}

// --- Hook Return Value Interface ---
interface InputHandlerState {
    // State needed for rendering or other components
    interactionProgress: InteractionProgressState | null;
    isActivelyHolding: boolean;
    isSprinting: boolean; // Expose current sprint state if needed elsewhere
    currentJumpOffsetY: number; // <<< ADDED
    // Function to be called each frame by the game loop
    processInputsAndActions: () => void;
}

interface InteractionProgressState {
    targetId: number | bigint | null;
    targetType: 'campfire' | 'wooden_storage_box' | 'stash'; // Added 'stash'
    startTime: number;
}

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
    onSetInteractingWith,
    isMinimapOpen,
    setIsMinimapOpen,
    isChatting,
    isSearchingCraftRecipes,
}: UseInputHandlerProps): InputHandlerState => {
    // Get player actions from the context instead of props
    const { updatePlayerPosition, jump, setSprinting } = usePlayerActions();

    // --- Internal State and Refs ---
    const keysPressed = useRef<Set<string>>(new Set());
    const isSprintingRef = useRef<boolean>(false);
    const isEHeldDownRef = useRef<boolean>(false);
    const isMouseDownRef = useRef<boolean>(false);
    const lastClientSwingAttemptRef = useRef<number>(0);
    const eKeyDownTimestampRef = useRef<number>(0);
    const eKeyHoldTimerRef = useRef<NodeJS.Timeout | number | null>(null); // Use number for browser timeout ID
    const [interactionProgress, setInteractionProgress] = useState<InteractionProgressState | null>(null);
    const [isActivelyHolding, setIsActivelyHolding] = useState<boolean>(false);
    const [currentJumpOffsetY, setCurrentJumpOffsetY] = useState<number>(0); // <<< ADDED

    // Refs for dependencies to avoid re-running effect too often
    const placementActionsRef = useRef(placementActions);
    const connectionRef = useRef(connection);
    const localPlayerRef = useRef(localPlayer);
    const activeEquipmentsRef = useRef(activeEquipments);
    const closestIdsRef = useRef({
        mushroom: null as bigint | null,
        corn: null as bigint | null,
        pumpkin: null as bigint | null,
        hemp: null as bigint | null,
        campfire: null as number | null,
        droppedItem: null as bigint | null,
        box: null as number | null,
        boxEmpty: false,
        corpse: null as bigint | null,
        stash: null as number | null, // Changed from bigint to number for Stash ID
    });
    const onSetInteractingWithRef = useRef(onSetInteractingWith);
    const worldMousePosRefInternal = useRef(worldMousePos); // Shadow prop name
    const woodenStorageBoxesRef = useRef(woodenStorageBoxes); // <<< ADDED Ref
    const stashesRef = useRef(stashes); // Added stashesRef
    const itemDefinitionsRef = useRef(itemDefinitions); // <<< ADDED Ref

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
            pumpkin: closestInteractablePumpkinId,
            hemp: closestInteractableHempId,
            campfire: closestInteractableCampfireId,
            droppedItem: closestInteractableDroppedItemId,
            box: closestInteractableBoxId,
            boxEmpty: isClosestInteractableBoxEmpty,
            corpse: closestInteractableCorpseId,
            stash: closestInteractableStashId, // Changed from bigint to number for Stash ID
        };
    }, [
        closestInteractableMushroomId, 
        closestInteractableCornId,
        closestInteractablePumpkinId,
        closestInteractableHempId,
        closestInteractableCampfireId, 
        closestInteractableDroppedItemId, 
        closestInteractableBoxId, 
        isClosestInteractableBoxEmpty,
        closestInteractableCorpseId,
        closestInteractableStashId, // Changed from bigint to number for Stash ID
    ]);
    useEffect(() => { onSetInteractingWithRef.current = onSetInteractingWith; }, [onSetInteractingWith]);
    useEffect(() => { worldMousePosRefInternal.current = worldMousePos; }, [worldMousePos]);
    useEffect(() => { woodenStorageBoxesRef.current = woodenStorageBoxes; }, [woodenStorageBoxes]); // <<< ADDED Effect
    useEffect(() => { stashesRef.current = stashes; }, [stashes]); // Added stashesRef effect
    useEffect(() => { itemDefinitionsRef.current = itemDefinitions; }, [itemDefinitions]); // <<< ADDED Effect

    // --- Jump Offset Calculation Effect ---
    useEffect(() => {
        const player = localPlayerRef.current;
        if (player && player.jumpStartTimeMs > 0) {
            const nowMs = Date.now();
            const elapsedJumpTime = nowMs - Number(player.jumpStartTimeMs);

            if (elapsedJumpTime >= 0 && elapsedJumpTime < JUMP_DURATION_MS) {
                const t = elapsedJumpTime / JUMP_DURATION_MS; // Normalized time (0 to 1)
                const jumpOffset = Math.sin(t * Math.PI) * JUMP_HEIGHT_PX;
                setCurrentJumpOffsetY(jumpOffset);
            } else {
                setCurrentJumpOffsetY(0); // End of jump
            }
        } else {
            setCurrentJumpOffsetY(0); // Not jumping or no player
        }
        // This effect should run very frequently to update the jump arc smoothly.
        // Relying on localPlayer changes might not be frequent enough.
        // We'll add a requestAnimationFrame based update in processInputsAndActions or a separate loop.
        // For now, localPlayer is the main trigger.
    }, [localPlayer]);

    // --- Swing Logic --- 
    const attemptSwing = useCallback(() => {
        const currentConnection = connectionRef.current;
        // Check focus IN ADDITION to player death
        const chatInputIsFocused = document.activeElement?.matches('[data-is-chat-input="true"]');
        if (!currentConnection?.reducers || !localPlayerId || isPlayerDead || chatInputIsFocused) return; 

        const currentEquipments = activeEquipmentsRef.current;
        const localEquipment = currentEquipments?.get(localPlayerId);
        if (!localEquipment || localEquipment.equippedItemDefId === null || localEquipment.equippedItemInstanceId === null) {
            // If no item equipped (or instance ID is null for some reason), still allow unarmed swing
            const nowUnarmed = Date.now();
            if (nowUnarmed - lastClientSwingAttemptRef.current < SWING_COOLDOWN_MS) return;
            if (nowUnarmed - Number(localEquipment?.swingStartTimeMs || 0) < SWING_COOLDOWN_MS) return;
            try {
                currentConnection.reducers.useEquippedItem(); // Unarmed/default action
                lastClientSwingAttemptRef.current = nowUnarmed;
            } catch (err) { 
                console.error("[AttemptSwing Unarmed] Error calling useEquippedItem reducer:", err);
            }
            return;
        }

        // Check if the equipped item is a Bandage
        const itemDef = itemDefinitionsRef.current?.get(String(localEquipment.equippedItemDefId));
        if (itemDef && itemDef.name === "Bandage") {
            // If Bandage is equipped, left-click (which calls attemptSwing) should NOT use/swing.
            console.log("[AttemptSwing] Bandage equipped, preventing use via attemptSwing (left-click).");
            return;
        }

        const now = Date.now();

        // Client-side cooldown
        if (now - lastClientSwingAttemptRef.current < SWING_COOLDOWN_MS) {
            return;
        }

        // Server-side cooldown check (using equipment state)
        if (now - Number(localEquipment.swingStartTimeMs) < SWING_COOLDOWN_MS) {
            return;
        }

        // Attempt the swing for non-bandage items
        try {
            currentConnection.reducers.useEquippedItem();
            lastClientSwingAttemptRef.current = now;
        } catch (err) { // Use unknown type for error
            console.error("[AttemptSwing] Error calling useEquippedItem reducer:", err);
        }
    }, [localPlayerId, isPlayerDead]); // Remove isInputEffectivelyDisabled dependency

    // --- Input Handling useEffect (Listeners only) ---
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // MODIFIED: Block if player is dead, chatting, or searching recipes
            if (!event || isPlayerDead || isChatting || isSearchingCraftRecipes) return;
            const key = event.key.toLowerCase();

            // Placement cancellation (checked before general input disabled)
            if (key === 'escape' && placementInfo) {
                placementActionsRef.current?.cancelPlacement();
                return;
            }

            // Sprinting start
            if (key === 'shift' && !isSprintingRef.current && !event.repeat) {
                isSprintingRef.current = true;
                setSprinting(true);
                return; // Don't add shift to keysPressed
            }

            // Avoid adding modifier keys
            if (key === 'shift' || key === 'control' || key === 'alt' || key === 'meta') {
                return;
            }

            keysPressed.current.add(key);

            // Jump
            if (key === ' ' && !event.repeat) {
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
                        console.log(`[Stash E-Down] Stash ID: ${currentClosestStashId}, Hidden: ${stashEntity.isHidden}. About to setInteractionProgress.`);
                        
                        isEHeldDownRef.current = true; 
                        eKeyDownTimestampRef.current = Date.now();

                        setInteractionProgress({ targetId: currentClosestStashId, targetType: 'stash', startTime: Date.now() });
                        setIsActivelyHolding(true);
                        
                        console.log(`[Stash E-Down] setInteractionProgress CALLED. interactionProgress in this closure:`, interactionProgress);
                        
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

                // Pure Tap Actions (If no stash interaction was initiated)
                if (closest.droppedItem !== null) {
                    try {
                        currentConnection.reducers.pickupDroppedItem(closest.droppedItem);
                    } catch (err) {
                        console.error("Error calling pickupDroppedItem reducer:", err);
                    }
                    return; 
                }
                if (closest.mushroom !== null) {
                    try {
                        currentConnection.reducers.interactWithMushroom(closest.mushroom);
                    } catch (err) {
                        console.error("Error calling interactWithMushroom reducer:", err);
                    }
                    return; 
                }
                if (closest.corn !== null) {
                    try {
                        currentConnection.reducers.interactWithCorn(closest.corn);
                    } catch (err) {
                        console.error("Error calling interactWithCorn reducer:", err);
                    }
                    return; 
                }
                if (closest.pumpkin !== null) {
                    try {
                        currentConnection.reducers.interactWithPumpkin(closest.pumpkin);
                    } catch (err) {
                        console.error("Error calling interactWithPumpkin reducer:", err);
                    }
                    return; 
                }
                if (closest.hemp !== null) {
                    try {
                        currentConnection.reducers.interactWithHemp(closest.hemp);
                    } catch (err) {
                        console.error("Error calling interactWithHemp reducer:", err);
                    }
                    return; 
                }
                
                // Tap-or-Hold Actions for other entities (Box, Campfire)
                if (closest.box !== null) {
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
            // MODIFIED: Block if player is dead, chatting, or searching recipes
            if (!event || isPlayerDead || isChatting || isSearchingCraftRecipes) return;
            const key = event.key.toLowerCase();
            // Sprinting end
            if (key === 'shift') {
                if (isSprintingRef.current) {
                    isSprintingRef.current = false;
                    // No need to check isInputDisabled here, if we got this far, input is enabled
                    setSprinting(false); 
                }
            }
            keysPressed.current.delete(key);

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
            // MODIFIED: Block if player is dead, chatting, searching, button isn't left, or placing
            if (isPlayerDead || isChatting || isSearchingCraftRecipes || event.button !== 0 || placementInfo) return;
            isMouseDownRef.current = true;
            attemptSwing(); // Call internal swing logic
        };

        const handleMouseUp = (event: MouseEvent) => {
            // No need to check focus here, just handle the button state
            // MODIFIED: Only care about left mouse button for releasing isMouseDownRef
            if (event.button === 0) {
                isMouseDownRef.current = false;
            }
        };

        // --- Canvas Click for Placement ---
        const handleCanvasClick = (event: MouseEvent) => {
            if (isPlayerDead) return; // No actions if dead

            const now = Date.now();
            if (now - lastClientSwingAttemptRef.current < SWING_COOLDOWN_MS) {
                // console.log("Swing cooldown active");
                return;
            }

            if (placementInfo && worldMousePosRefInternal.current.x !== null && worldMousePosRefInternal.current.y !== null) {
                placementActionsRef.current?.attemptPlacement(worldMousePosRefInternal.current.x, worldMousePosRefInternal.current.y);
                return; // Don't swing if placing
            }

            // If an interaction hold was just completed via click (rather than E key release), don't also swing.
            if (isActivelyHolding) {
                return;
            }

            // Prevent swinging if a UI element was clicked (e.g., a button over the canvas)
            if (event.target !== canvasRef.current) {
                // console.log("Clicked on a UI element, not swinging.");
                return;
            }

            const localPlayerEquipment = activeEquipmentsRef.current?.get(localPlayerId || "");
            if (localPlayerEquipment && localPlayerEquipment.equippedItemInstanceId) {
                const itemDefId = localPlayerEquipment.equippedItemDefId;
                const itemDef = itemDefinitionsRef.current?.get(String(itemDefId));

                if (itemDef && itemDef.name === "Bandage") {
                    // If Bandage is equipped, left-click should NOT use/swing.
                    console.log("[InputHandler] Bandage equipped, left-click does not trigger useEquippedItem.");
                } else {
                    // For any other equipped item, proceed with useEquippedItem
                    connectionRef.current?.reducers.useEquippedItem();
                    lastClientSwingAttemptRef.current = now;
                    // console.log("Attempting to use equipped item via click.");
                }
            } else {
                 // No item equipped, or no equipment record, still allow "use" for unarmed / default action
                connectionRef.current?.reducers.useEquippedItem();
                lastClientSwingAttemptRef.current = now;
                // console.log("Attempting to use (unarmed) via click.");
            }
        };

        // --- Context Menu for Placement Cancellation ---
        const handleContextMenu = (event: MouseEvent) => {
            if (isPlayerDead) return; // No actions if dead
            // Prevent default browser context menu
            event.preventDefault(); 

            const localPlayerEquipment = activeEquipmentsRef.current?.get(localPlayerId || "");
            if (localPlayerEquipment && localPlayerEquipment.equippedItemInstanceId) {
                const itemDefId = localPlayerEquipment.equippedItemDefId;
                const itemDef = itemDefinitionsRef.current?.get(String(itemDefId));

                if (itemDef && itemDef.name === "Bandage") {
                    // If Bandage is equipped, right-click should trigger useEquippedItem
                    const now = Date.now();
                    if (now - lastClientSwingAttemptRef.current < SWING_COOLDOWN_MS) {
                        return;
                    }
                    if (connectionRef.current?.reducers) {
                        connectionRef.current.reducers.useEquippedItem();
                        lastClientSwingAttemptRef.current = now;
                        console.log("[InputHandler] Used Bandage via right-click.");
                    }
                    return; // Bandage used, no further context menu logic needed
                } else if (itemDef && itemDef.name === "Torch") {
                    // If Torch is equipped, right-click should toggle it
                    if (connectionRef.current?.reducers) {
                        try {
                            connectionRef.current.reducers.toggleTorch();
                            console.log("[InputHandler] Toggled Torch via right-click.");
                        } catch (err) {
                            console.error("[InputHandler] Error calling toggleTorch reducer:", err);
                        }
                    }
                    return; // Torch toggled, no further context menu logic needed
                }
            }
            
            // If not a bandage or torch, or no item equipped, or other conditions, 
            // you might have other right-click logic here in the future.
            // For now, it does nothing further.
            // console.log("Context menu triggered, no specific action for equipped item or unhandled.");
        };

        // --- Wheel for Placement Cancellation (optional) ---
        const handleWheel = (event: WheelEvent) => {
            if (placementInfo) {
                placementActionsRef.current?.cancelPlacement();
            }
        };

        // --- Blur Handler ---
        const handleBlur = () => {
            if (isSprintingRef.current) {
                isSprintingRef.current = false;
                // Call reducer regardless of focus state if window loses focus
                setSprinting(false); 
            }
            // keysPressed.current.clear(); // Keep this commented out
            isMouseDownRef.current = false;
            isEHeldDownRef.current = false;
            if(eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current);
            eKeyHoldTimerRef.current = null;
            setInteractionProgress(null);
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
    }, [canvasRef, localPlayer?.isDead, placementInfo, setSprinting, jump, attemptSwing, setIsMinimapOpen]);

    // --- Function to process inputs and call actions (called by game loop) ---
    const processInputsAndActions = useCallback(() => {
        const currentConnection = connectionRef.current;
        const player = localPlayerRef.current; // Get the current player state

        // MODIFIED: Do nothing if player is dead, or if chatting/searching
        if (!player || player.isDead || isChatting || isSearchingCraftRecipes) {
             // Reset sprint state on death if not already handled by useEffect
            if (isSprintingRef.current && player?.isDead) { // Only reset sprint due to death
                isSprintingRef.current = false;
                // No need to call reducer here, useEffect for player.isDead handles it for death
            } else if (isSprintingRef.current && (isChatting || isSearchingCraftRecipes)) {
                // If chatting or searching and was sprinting, send stop sprinting
                isSprintingRef.current = false;
                setSprinting(false); 
            }
            // Also clear jump offset if player is dead or UI is active
            if (currentJumpOffsetY !== 0) {
                setCurrentJumpOffsetY(0);
            }
            return;
        }
        
        // --- Jump Offset Calculation (moved here for per-frame update) ---
        if (player && player.jumpStartTimeMs > 0) {
            const nowMs = Date.now();
            const elapsedJumpTime = nowMs - Number(player.jumpStartTimeMs);

            if (elapsedJumpTime >= 0 && elapsedJumpTime < JUMP_DURATION_MS) {
                const t = elapsedJumpTime / JUMP_DURATION_MS;
                const jumpOffset = Math.sin(t * Math.PI) * JUMP_HEIGHT_PX;
                setCurrentJumpOffsetY(jumpOffset);
            } else {
                setCurrentJumpOffsetY(0); // End of jump
            }
        } else if (currentJumpOffsetY !== 0) { // Ensure it resets if not jumping
            setCurrentJumpOffsetY(0);
        }
        // --- End Jump Offset Calculation ---

        // Placement rotation
        // Process movement - This block is now effectively guarded by the check above
        const dx = (keysPressed.current.has('d') || keysPressed.current.has('arrowright') ? 1 : 0) -
                   (keysPressed.current.has('a') || keysPressed.current.has('arrowleft') ? 1 : 0);
        const dy = (keysPressed.current.has('s') || keysPressed.current.has('arrowdown') ? 1 : 0) -
                   (keysPressed.current.has('w') || keysPressed.current.has('arrowup') ? 1 : 0);

        if (dx !== 0 || dy !== 0) {
            updatePlayerPosition(dx, dy);
        }

        // Handle continuous swing check
        // MODIFIED: Guard this with isChatting and isSearchingCraftRecipes as well
        if (isMouseDownRef.current && !placementInfo && !isChatting && !isSearchingCraftRecipes) { // Only swing if not placing and not in UI
            attemptSwing(); // Call internal attemptSwing function
        }
    }, [
        isPlayerDead, updatePlayerPosition, attemptSwing, placementInfo,
        localPlayerId, localPlayer, activeEquipments, worldMousePos, connection,
        closestInteractableMushroomId, closestInteractableCornId, closestInteractablePumpkinId, closestInteractableHempId, 
        closestInteractableCampfireId, closestInteractableDroppedItemId, closestInteractableBoxId, 
        isClosestInteractableBoxEmpty, onSetInteractingWith, currentJumpOffsetY,
        isChatting, isSearchingCraftRecipes, setSprinting // Added isChatting, isSearchingCraftRecipes, setSprinting
    ]);

    // --- Return State & Actions ---
    return {
        interactionProgress,
        isActivelyHolding,
        isSprinting: isSprintingRef.current, // Return the ref's current value
        currentJumpOffsetY, // <<< ADDED
        processInputsAndActions,
    };
}; 