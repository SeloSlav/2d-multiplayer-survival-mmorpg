import { useEffect, useRef, useState, useCallback, RefObject } from 'react';
import * as SpacetimeDB from '../generated';
import { DbConnection } from '../generated';
import { PlacementItemInfo, PlacementActions } from './usePlacementManager'; // Assuming usePlacementManager exports these
import React from 'react';
import { usePlayerActions } from '../contexts/PlayerActionsContext';
import { JUMP_DURATION_MS, JUMP_HEIGHT_PX } from '../config/gameConfig'; // <<< ADDED IMPORT

// --- Constants (Copied from GameCanvas) ---
const HOLD_INTERACTION_DURATION_MS = 250;
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
    closestInteractableHempId: bigint | null;
    closestInteractableCampfireId: number | null;
    closestInteractableDroppedItemId: bigint | null;
    closestInteractableBoxId: number | null;
    isClosestInteractableBoxEmpty: boolean;
    woodenStorageBoxes: Map<string, SpacetimeDB.WoodenStorageBox>; // <<< ADDED
    closestInteractableCorpseId: bigint | null;
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
    isSprinting: boolean; // Expose current sprint state if needed elsewhere
    currentJumpOffsetY: number; // <<< ADDED
    // Function to be called each frame by the game loop
    processInputsAndActions: () => void;
}

interface InteractionProgressState {
    targetId: number | bigint | null;
    targetType: 'campfire' | 'wooden_storage_box';
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
    closestInteractableHempId,
    closestInteractableCampfireId,
    closestInteractableDroppedItemId,
    closestInteractableBoxId,
    isClosestInteractableBoxEmpty,
    woodenStorageBoxes, // <<< ADDED
    closestInteractableCorpseId,
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
    const [currentJumpOffsetY, setCurrentJumpOffsetY] = useState<number>(0); // <<< ADDED

    // Refs for dependencies to avoid re-running effect too often
    const placementActionsRef = useRef(placementActions);
    const connectionRef = useRef(connection);
    const localPlayerRef = useRef(localPlayer);
    const activeEquipmentsRef = useRef(activeEquipments);
    const closestIdsRef = useRef({
        mushroom: null as bigint | null,
        corn: null as bigint | null,
        hemp: null as bigint | null,
        campfire: null as number | null,
        droppedItem: null as bigint | null,
        box: null as number | null,
        boxEmpty: false,
        corpse: null as bigint | null,
    });
    const onSetInteractingWithRef = useRef(onSetInteractingWith);
    const worldMousePosRefInternal = useRef(worldMousePos); // Shadow prop name
    const woodenStorageBoxesRef = useRef(woodenStorageBoxes); // <<< ADDED Ref
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
             if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current);
             eKeyHoldTimerRef.current = null;
             setInteractionProgress(null);
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
            hemp: closestInteractableHempId,
            campfire: closestInteractableCampfireId,
            droppedItem: closestInteractableDroppedItemId,
            box: closestInteractableBoxId,
            boxEmpty: isClosestInteractableBoxEmpty,
            corpse: closestInteractableCorpseId,
        };
    }, [
        closestInteractableMushroomId, 
        closestInteractableCornId, 
        closestInteractableHempId,
        closestInteractableCampfireId, 
        closestInteractableDroppedItemId, 
        closestInteractableBoxId, 
        isClosestInteractableBoxEmpty,
        closestInteractableCorpseId,
    ]);
    useEffect(() => { onSetInteractingWithRef.current = onSetInteractingWith; }, [onSetInteractingWith]);
    useEffect(() => { worldMousePosRefInternal.current = worldMousePos; }, [worldMousePos]);
    useEffect(() => { woodenStorageBoxesRef.current = woodenStorageBoxes; }, [woodenStorageBoxes]); // <<< ADDED Effect
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
        if (!localEquipment || localEquipment.equippedItemDefId === null) {
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

        // Attempt the swing
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
                console.log(`[Input E Down] Closest IDs: M=${closest.mushroom}, Co=${closest.corn}, H=${closest.hemp}, Ca=${closest.campfire}, D=${closest.droppedItem}, B=${closest.box}(${closest.boxEmpty}), Corpse=${closest.corpse}`);

                // Pure Tap Actions (Highest Priority)
                if (closest.droppedItem !== null) {
                    try {
                        currentConnection.reducers.pickupDroppedItem(closest.droppedItem);
                    } catch (err) {
                        console.error("Error calling pickupDroppedItem reducer:", err);
                    }
                    return; // Consume E press
                }
                if (closest.mushroom !== null) {
                    try {
                        currentConnection.reducers.interactWithMushroom(closest.mushroom);
                    } catch (err) {
                        console.error("Error calling interactWithMushroom reducer:", err);
                    }
                    return; // Consume E press
                }
                if (closest.corn !== null) {
                    try {
                        currentConnection.reducers.interactWithCorn(closest.corn);
                    } catch (err) {
                        console.error("Error calling interactWithCorn reducer:", err);
                    }
                    return; // Consume E press
                }
                if (closest.hemp !== null) {
                    try {
                        currentConnection.reducers.interactWithHemp(closest.hemp);
                    } catch (err) {
                        console.error("Error calling interactWithHemp reducer:", err);
                    }
                    return; // Consume E press
                }

                // Tap-or-Hold Actions (Process one, then return)
                if (closest.box !== null) {
                    isEHeldDownRef.current = true;
                    eKeyDownTimestampRef.current = Date.now();
                    if (closest.boxEmpty) { // Primary action for empty box is HOLD to pickup
                        setInteractionProgress({ targetId: closest.box, targetType: 'wooden_storage_box', startTime: Date.now() });
                        if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current);
                        eKeyHoldTimerRef.current = setTimeout(() => {
                            if (isEHeldDownRef.current) {
                                const stillClosest = closestIdsRef.current;
                                if (stillClosest.box === closest.box && stillClosest.boxEmpty) {
                                    try {
                                        connectionRef.current?.reducers.pickupStorageBox(closest.box!);
                                    } catch (err) { console.error("[InputHandler Hold Timer] Error calling pickupStorageBox reducer:", err); }
                                }
                                isEHeldDownRef.current = false;
                                setInteractionProgress(null);
                                if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current);
                                eKeyHoldTimerRef.current = null;
                            }
                        }, HOLD_INTERACTION_DURATION_MS);
                    }
                    // For non-empty box, tap is handled by keyUp. No timer started here for tap.
                    return; // Box interaction initiated (either hold timer or setup for tap)
                }
                
                if (closest.campfire !== null) {
                    isEHeldDownRef.current = true;
                    eKeyDownTimestampRef.current = Date.now();
                    // Primary interaction for campfire on E-down is to start hold for toggling burn
                    setInteractionProgress({ targetId: closest.campfire, targetType: 'campfire', startTime: Date.now() });
                    if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current);
                    eKeyHoldTimerRef.current = setTimeout(() => {
                        if (isEHeldDownRef.current) {
                            const stillClosest = closestIdsRef.current;
                            if (stillClosest.campfire === closest.campfire) {
                                try {
                                    connectionRef.current?.reducers.toggleCampfireBurning(closest.campfire!);
                                } catch (err) { console.error("[InputHandler Hold Timer - Campfire] Error toggling campfire:", err); }
                            }
                            isEHeldDownRef.current = false;
                            setInteractionProgress(null);
                            if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current);
                            eKeyHoldTimerRef.current = null;
                        }
                    }, HOLD_INTERACTION_DURATION_MS);
                    return; // Campfire interaction initiated (hold timer or setup for tap)
                }

                if (closest.corpse !== null) {
                    isEHeldDownRef.current = true;
                    eKeyDownTimestampRef.current = Date.now();
                    // Tap to loot corpse is handled by keyUp. No timer started here for tap.
                    // console.log(`[Input E Down] Closest interactable is Corpse ID: ${closest.corpse}. Waiting for KeyUp.`);
                    return; // Corpse interaction setup for tap resolution on keyUp
                }
            }

            // --- Handle Minimap Toggle ---
            if (key === 'g') { // Check lowercase key
                setIsMinimapOpen((prev: boolean) => !prev); // Toggle immediately
                event.preventDefault(); // Prevent typing 'g' in chat etc.
                return; // Don't add 'g' to keysPressed
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
                if (isEHeldDownRef.current) {
                    const closestBeforeClear = { ...closestIdsRef.current }; // Capture state before clearing
                    const holdDuration = Date.now() - eKeyDownTimestampRef.current;

                    isEHeldDownRef.current = false;
                    if (eKeyHoldTimerRef.current) {
                        clearTimeout(eKeyHoldTimerRef.current);
                        eKeyHoldTimerRef.current = null;
                    }
                    setInteractionProgress(null);
                    eKeyDownTimestampRef.current = 0;
                    console.log(`[Input E Up] Hold duration: ${holdDuration}ms. Closest before clear:`, closestBeforeClear);

                    if (holdDuration < HOLD_INTERACTION_DURATION_MS) {
                        const currentConnection = connectionRef.current;
                        if (!currentConnection?.reducers) return;

                        // <<< MODIFY Priority: Check Corpse first on short press >>>
                        if (closestBeforeClear.corpse !== null) {
                            console.log(`[Input E Up - Short Press] Attempting interaction with Corpse ID: ${closestBeforeClear.corpse}`);
                            // Try calling a (non-existent yet?) interact reducer or just set state
                            // For now, just set the interaction state
                            onSetInteractingWithRef.current({ type: 'player_corpse', id: closestBeforeClear.corpse });
                            console.log(`[Input E Up - Short Press] Set interactingWith to Corpse ID: ${closestBeforeClear.corpse}`);
                        } else if (closestBeforeClear.box !== null) {
                             // console.log(`[InputHandler KeyUp E - Short Press] Attempting interaction with Box ID: ${closestBeforeClear.box}`);
                             try {
                                currentConnection.reducers.interactWithStorageBox(closestBeforeClear.box);
                                // console.log(`[InputHandler KeyUp E - Short Press] Called interactWithStorageBox for Box ID: ${closestBeforeClear.box}`);
                                onSetInteractingWithRef.current({ type: 'wooden_storage_box', id: closestBeforeClear.box });
                             } catch (err) { 
                                console.error("[InputHandler KeyUp E - Short Press] Error calling interactWithStorageBox:", err);
                             }
                        } else if (closestBeforeClear.campfire !== null) {
                             // console.log(`[InputHandler KeyUp E - Short Press] Attempting interaction with Campfire ID: ${closestBeforeClear.campfire}`);
                            try {
                                currentConnection.reducers.interactWithCampfire(closestBeforeClear.campfire);
                                // console.log(`[InputHandler KeyUp E - Short Press] Called interactWithCampfire for Campfire ID: ${closestBeforeClear.campfire}`);
                                onSetInteractingWithRef.current({ type: 'campfire', id: closestBeforeClear.campfire });
                            } catch (err) {
                                console.error("[InputHandler KeyUp E - Short Press] Error calling interactWithCampfire:", err);
                            }
                        }
                    }
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
            // MODIFIED: Block if player is dead, chatting, searching, or button isn't left
            if (isPlayerDead || isChatting || isSearchingCraftRecipes || event.button !== 0) return;
            const currentWorldMouse = worldMousePosRefInternal.current;
            if (placementInfo && currentWorldMouse.x !== null && currentWorldMouse.y !== null) {
                 placementActionsRef.current?.attemptPlacement(currentWorldMouse.x, currentWorldMouse.y);
                 return;
            }
            // If not placing, maybe handle other clicks later?
        };

        // --- Context Menu for Placement Cancellation ---
        const handleContextMenu = (event: MouseEvent) => {
            if (placementInfo) {
                event.preventDefault();
                placementActionsRef.current?.cancelPlacement();
            } else {
                 event.preventDefault(); // Prevent default context menu even when not placing
                 const currentConnection = connectionRef.current;
                 const player = localPlayerRef.current;
                 const equipments = activeEquipmentsRef.current;
                 const definitions = itemDefinitionsRef.current; // Use the ref

                 if (currentConnection?.reducers && player && !player.isDead && equipments && definitions) { // Added !player.isDead check
                    const localPlayerEquipment = equipments.get(player.identity.toHexString());
                    if (localPlayerEquipment && localPlayerEquipment.equippedItemDefId) {
                        const itemDef = definitions.get(localPlayerEquipment.equippedItemDefId.toString());
                        if (itemDef && itemDef.name === "Torch") {
                            try {
                                currentConnection.reducers.toggleTorch();
                                // console.log("[InputHandler] Called toggleTorch reducer for Torch."); // Keep for debugging if desired
                            } catch (err) {
                                console.error("[InputHandler] Error calling toggleTorch reducer:", err);
                            }
                        }
                    }
                 }
            }
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
                clearTimeout(eKeyHoldTimerRef.current);
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
        closestInteractableMushroomId, closestInteractableCornId, closestInteractableHempId, 
        closestInteractableCampfireId, closestInteractableDroppedItemId, closestInteractableBoxId, 
        isClosestInteractableBoxEmpty, onSetInteractingWith, currentJumpOffsetY,
        isChatting, isSearchingCraftRecipes, setSprinting // Added isChatting, isSearchingCraftRecipes, setSprinting
    ]);

    // --- Return State & Actions ---
    return {
        interactionProgress,
        isSprinting: isSprintingRef.current, // Return the ref's current value
        currentJumpOffsetY, // <<< ADDED
        processInputsAndActions,
    };
}; 