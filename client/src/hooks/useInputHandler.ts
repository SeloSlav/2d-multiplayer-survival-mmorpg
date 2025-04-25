import { useEffect, useRef, useState, useCallback, RefObject } from 'react';
import * as SpacetimeDB from '../generated';
import { DbConnection } from '../generated';
import { PlacementItemInfo, PlacementActions } from './usePlacementManager'; // Assuming usePlacementManager exports these
import React from 'react';
import { usePlayerActions } from '../contexts/PlayerActionsContext';

// --- Constants (Copied from GameCanvas) ---
const HOLD_INTERACTION_DURATION_MS = 250;
const SWING_COOLDOWN_MS = 500;

// --- Hook Props Interface ---
interface UseInputHandlerProps {
    canvasRef: RefObject<HTMLCanvasElement | null>;
    connection: DbConnection | null;
    localPlayerId?: string;
    localPlayer?: SpacetimeDB.Player | null; // Pass the local player data
    activeEquipments?: Map<string, SpacetimeDB.ActiveEquipment>; // Pass active equipment map
    placementInfo: PlacementItemInfo | null;
    placementActions: PlacementActions;
    worldMousePos: { x: number | null; y: number | null }; // Pass world mouse position
    // Closest interactables (passed in for now)
    closestInteractableMushroomId: bigint | null;
    closestInteractableCornId: bigint | null;
    closestInteractableCampfireId: number | null;
    closestInteractableDroppedItemId: bigint | null;
    closestInteractableBoxId: number | null;
    isClosestInteractableBoxEmpty: boolean;
    // Callbacks for actions
    onSetInteractingWith: (target: { type: string; id: number | bigint } | null) => void;
    // Note: movement functions are now provided by usePlayerActions hook
    // Note: attemptSwing logic will be internal to the hook
    // Add minimap state and setter
    isMinimapOpen: boolean;
    setIsMinimapOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isChatting: boolean;
}

// --- Hook Return Value Interface ---
interface InputHandlerState {
    // State needed for rendering or other components
    interactionProgress: InteractionProgressState | null;
    isSprinting: boolean; // Expose current sprint state if needed elsewhere
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
    placementInfo,
    placementActions,
    worldMousePos,
    closestInteractableMushroomId,
    closestInteractableCornId,
    closestInteractableCampfireId,
    closestInteractableDroppedItemId,
    closestInteractableBoxId,
    isClosestInteractableBoxEmpty,
    onSetInteractingWith,
    isMinimapOpen,
    setIsMinimapOpen,
    isChatting,
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
    const eKeyHoldTimerRef = useRef<number | null>(null); // Use number for browser timeout ID
    const [interactionProgress, setInteractionProgress] = useState<InteractionProgressState | null>(null);

    // Refs for dependencies to avoid re-running effect too often
    const placementActionsRef = useRef(placementActions);
    const connectionRef = useRef(connection);
    const localPlayerRef = useRef(localPlayer);
    const activeEquipmentsRef = useRef(activeEquipments);
    const closestIdsRef = useRef({
        mushroom: null as bigint | null,
        corn: null as bigint | null,
        campfire: null as number | null,
        droppedItem: null as bigint | null,
        box: null as number | null,
        boxEmpty: false
    });
    const onSetInteractingWithRef = useRef(onSetInteractingWith);
    const worldMousePosRefInternal = useRef(worldMousePos); // Shadow prop name

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
            campfire: closestInteractableCampfireId,
            droppedItem: closestInteractableDroppedItemId,
            box: closestInteractableBoxId,
            boxEmpty: isClosestInteractableBoxEmpty,
        };
    }, [closestInteractableMushroomId, closestInteractableCornId, closestInteractableCampfireId, closestInteractableDroppedItemId, closestInteractableBoxId, isClosestInteractableBoxEmpty]);
    useEffect(() => { onSetInteractingWithRef.current = onSetInteractingWith; }, [onSetInteractingWith]);
    useEffect(() => { worldMousePosRefInternal.current = worldMousePos; }, [worldMousePos]);

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
            const chatInputIsFocused = document.activeElement?.matches('[data-is-chat-input="true"]');
            // Block if player is dead or chat is focused
            if (!event || isPlayerDead || chatInputIsFocused) return; 
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
                if (localPlayerRef.current) { // Check player exists via ref
                    jump();
                }
            }

            // Interaction key ('e')
            if (key === 'e' && !event.repeat && !isEHeldDownRef.current) {
                const currentConnection = connectionRef.current;
                if (!currentConnection?.reducers) return; // Need connection for interactions

                const closest = closestIdsRef.current; // Use ref value
                const { mushroom, corn, campfire, droppedItem, box, boxEmpty } = closest;

                // Priority: DroppedItem > Empty Box > Mushroom > Corn > Open Box > Campfire
                if (droppedItem !== null) {
                    try {
                        currentConnection.reducers.pickupDroppedItem(droppedItem);
                    } catch (err) {
                        console.error("Error calling pickupDroppedItem reducer:", err);
                    }
                    return;
                } else if (box !== null) {
                    // console.log(`[InputHandler KeyDown E] Starting hold check for Box ID: ${box}. Empty: ${boxEmpty}`);
                    isEHeldDownRef.current = true;
                    eKeyDownTimestampRef.current = Date.now();
                    if (boxEmpty) {
                        setInteractionProgress({ targetId: box, targetType: 'wooden_storage_box', startTime: Date.now() });
                        // console.log(`[InputHandler KeyDown E - Box] Set interactionProgress.targetId = ${box}, targetType = wooden_storage_box`);
                    }
                    if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current);
                    eKeyHoldTimerRef.current = setTimeout(() => {
                        if (isEHeldDownRef.current) {
                            const stillClosest = closestIdsRef.current; // Re-check closest box via ref
                            if (stillClosest.box === box && stillClosest.boxEmpty) {
                                // console.log(`[InputHandler Hold Timer] Executing pickup for EMPTY Box ID: ${box}`);
                                try {
                                    connectionRef.current?.reducers.pickupStorageBox(box);
                                    isEHeldDownRef.current = false;
                                    setInteractionProgress(null);
                                    if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current);
                                    eKeyHoldTimerRef.current = null;
                                } catch (err) {
                                    console.error("[InputHandler Hold Timer] Error calling pickupStorageBox reducer:", err);
                                    isEHeldDownRef.current = false;
                                    setInteractionProgress(null);
                                    if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current);
                                    eKeyHoldTimerRef.current = null;
                                }
                            } else {
                                // console.log(`[InputHandler Hold Timer] Hold expired, but box ${box} is not empty or no longer closest. No pickup.`);
                                setInteractionProgress(null);
                                if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current);
                                eKeyHoldTimerRef.current = null;
                            }
                        }
                    }, HOLD_INTERACTION_DURATION_MS);
                    return;
                } else if (mushroom !== null) {
                    try {
                        currentConnection.reducers.interactWithMushroom(mushroom);
                    } catch (err) {
                        console.error("Error calling interactWithMushroom reducer:", err);
                    }
                    return;
                } else if (corn !== null) {
                    try {
                        currentConnection.reducers.interactWithCorn(corn);
                    } catch (err) {
                        console.error("Error calling interactWithCorn reducer:", err);
                    }
                    return;
                } else if (campfire !== null) {
                    // console.log(`[InputHandler KeyDown E] Starting hold check for Campfire ID: ${campfire}`);
                    isEHeldDownRef.current = true;
                    eKeyDownTimestampRef.current = Date.now();
                    setInteractionProgress({ targetId: campfire, targetType: 'campfire', startTime: Date.now() });
                    // console.log(`[InputHandler KeyDown E - Campfire] Set interactionProgress.targetId = ${campfire}, targetType = campfire`);
                    if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current);
                    eKeyHoldTimerRef.current = setTimeout(() => {
                        if (isEHeldDownRef.current) {
                            const stillClosest = closestIdsRef.current; // Re-check via ref
                            if (stillClosest.campfire === campfire) {
                                // console.log(`[InputHandler Hold Timer - Campfire] Executing toggle for Campfire ID: ${campfire}`);
                                try {
                                    connectionRef.current?.reducers.toggleCampfireBurning(campfire);
                                } catch (err) { console.error("[InputHandler Hold Timer - Campfire] Error toggling campfire:", err); }
                            }
                            isEHeldDownRef.current = false;
                            setInteractionProgress(null);
                            if (eKeyHoldTimerRef.current) clearTimeout(eKeyHoldTimerRef.current);
                            eKeyHoldTimerRef.current = null;
                        }
                    }, HOLD_INTERACTION_DURATION_MS);
                    return;
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
            const chatInputIsFocused = document.activeElement?.matches('[data-is-chat-input="true"]');
            // Block if player is dead or chat is focused
            if (!event || isPlayerDead || chatInputIsFocused) return; 
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

                    if (holdDuration < HOLD_INTERACTION_DURATION_MS) {
                        const currentConnection = connectionRef.current;
                        if (!currentConnection?.reducers) return;

                        // Prioritize Box if it was the target. Remove check for emptiness here.
                        if (closestBeforeClear.box !== null) {
                             // console.log(`[KeyUp E - Box] Short press detected for Box ID: ${closestBeforeClear.box}. Opening UI.`);
                             try {
                                currentConnection.reducers.interactWithStorageBox(closestBeforeClear.box);
                                onSetInteractingWithRef.current({ type: 'wooden_storage_box', id: closestBeforeClear.box });
                             } catch (err) { console.error("[KeyUp E - Box] Error interacting:", err); }
                        } else if (closestBeforeClear.campfire !== null) {
                             // console.log(`[KeyUp E - Campfire] Short press detected for Campfire ID: ${closestBeforeClear.campfire}. Opening UI.`);
                            try {
                                currentConnection.reducers.interactWithCampfire(closestBeforeClear.campfire);
                                onSetInteractingWithRef.current({ type: 'campfire', id: closestBeforeClear.campfire });
                            } catch (err) {
                                console.error("[KeyUp E - Campfire] Error interacting:", err);
                            }
                        }
                    }
                }
            }
        };

        // --- Mouse Handlers ---
        const handleMouseDown = (event: MouseEvent) => {
            const chatInputIsFocused = document.activeElement?.matches('[data-is-chat-input="true"]');
            // Block if player is dead, chat focused, button isn't left, or placing
            if (isPlayerDead || chatInputIsFocused || event.button !== 0 || placementInfo) return; 
            isMouseDownRef.current = true;
            attemptSwing(); // Call internal swing logic
        };

        const handleMouseUp = (event: MouseEvent) => {
            // No need to check focus here, just handle the button state
            if (event.button === 0) {
                isMouseDownRef.current = false;
            }
        };

        // --- Canvas Click for Placement ---
        const handleCanvasClick = (event: MouseEvent) => {
            const chatInputIsFocused = document.activeElement?.matches('[data-is-chat-input="true"]');
            // Block if player is dead, chat focused, or button isn't left
            if (isPlayerDead || chatInputIsFocused || event.button !== 0) return; 
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
            }
            // Prevent default context menu unless placing
            else {
                 event.preventDefault();
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
        const chatInputIsFocused = document.activeElement?.matches('[data-is-chat-input="true"]');
        // Block if player is dead or chat is focused
        if (isPlayerDead || chatInputIsFocused) return; 

        // --- Movement --- 
        let dx = 0;
        let dy = 0;

        const pressed = keysPressed.current;
        // Determine raw direction vector components (-1, 0, or 1)
        if (pressed.has('w') || pressed.has('arrowup')) { dy -= 1; }
        if (pressed.has('s') || pressed.has('arrowdown')) { dy += 1; }
        if (pressed.has('a') || pressed.has('arrowleft')) { dx -= 1; }
        if (pressed.has('d') || pressed.has('arrowright')) { dx += 1; }

        // Normalize the direction vector
        let normX = 0;
        let normY = 0;
        const magnitude = Math.sqrt(dx * dx + dy * dy);

        if (magnitude > 0) {
            normX = dx / magnitude;
            normY = dy / magnitude;
        }

        // Call updatePlayerPosition (from context)
        updatePlayerPosition(normX, normY);

        // Handle continuous swing check
        if (isMouseDownRef.current && !placementInfo) { // Only swing if not placing
            attemptSwing(); // Call internal attemptSwing function
        }
    }, [
        isPlayerDead, updatePlayerPosition, attemptSwing, placementInfo,
        localPlayerId, localPlayer, activeEquipments, worldMousePos, connection,
        closestInteractableMushroomId, closestInteractableCornId, closestInteractableCampfireId, 
        closestInteractableDroppedItemId, closestInteractableBoxId, 
        isClosestInteractableBoxEmpty, onSetInteractingWith
    ]);

    // --- Return State & Actions ---
    return {
        interactionProgress,
        isSprinting: isSprintingRef.current, // Return current value of the ref
        processInputsAndActions, // Return the processing function
    };
}; 