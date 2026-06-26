/**
 * useInputHandler - Keyboard and mouse input → reducer calls and UI actions.
 *
 * Maps player input (WASD, E, F, mouse clicks, etc.) to SpacetimeDB reducers and
 * local actions. Handles movement, pickup, attack, building placement, container
 * interactions, and E-key interactions with the closest interactable entity.
 *
 * Responsibilities:
 * 1. MOVEMENT: Sends updatePlayerPositionSimple via usePredictedMovement. Blocks
 *    movement when UI is focused (inventory, chat, etc.).
 *
 * 2. E-KEY INTERACTIONS: When closestInteractableEntityId is set, E triggers
 *    interactWithEntity. Supports tap (instant) and hold (timed) interactions for
 *    doors, campfires, furnaces, animals, cairns, etc.
 *
 * 3. COMBAT & HARVEST: Left-click attacks/harvests based on equipped item and
 *    target. Triggers optimistic shake effects for responsive feedback.
 *
 * 4. BUILDING: Delegates to the host-owned building placement runtime for foundation/wall/door/fence
 *    placement. Handles placement mode activation and cancellation.
 *
 * Performance: Reads latest values and host-owned runtime state without re-rendering
 * on every interaction check. Tap-to-walk and mobile controls supported.
 */

import { useEffect, useSyncExternalStore, useCallback, useMemo, MutableRefObject } from 'react';
import { useLatest } from './useLatest';
import { DbConnection } from '../generated';
import {
    Player,
    ItemDefinition,
    ActiveEquipment,
    WoodenStorageBox,
    Stash,
    PlayerCorpse,
    InventoryItem,
    RangedWeaponStats,
    ItemCategory,
} from '../generated/types';
import type { Projectile, PlayerDiscoveredCairn } from '../generated/types';
import { Identity } from 'spacetimedb';
import { PlacementItemInfo, PlacementActions } from './usePlacementManager'; // Assuming usePlacementManager exports these
import { BuildingMode } from '../engine/runtime/buildingPlacementRuntime';
import React from 'react';
import { usePlayerActions } from '../contexts/PlayerActionsContext';
import { HOLD_INTERACTION_DURATION_MS, REVIVE_HOLD_DURATION_MS } from '../config/gameConfig';
import { DEFAULT_MELEE_ATTACK_RANGE, SPEAR_MELEE_ATTACK_RANGE } from '../config/combatConstants';
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
import type { InteractionTargetRuntimeResult } from '../engine/runtime/interactionTargetRuntime';
import { hasWaterContent, getWaterContent, getWaterCapacity, isWaterContainer } from '../utils/waterContainerHelpers';
import { wasAlkPanelJustClosed } from '../components/AlkDeliveryPanel';
import { CAIRN_LORE_TIDBITS } from '../data/cairnLoreData';
import { Cairn as SpacetimeDBCairn } from '../generated/types';
import { createCairnLoreAudio, isCairnAudioPlaying, getTotalCairnLoreCount, stopCairnLoreAudio } from '../utils/cairnAudioUtils';
import { previewSeaweedHarvestBlockedIfNeeded, playImmediateSound } from './useSoundSystem';
import { CairnNotification } from '../components/CairnUnlockNotification';
import { registerLocalPlayerRangedShot, registerLocalPlayerSwing } from '../utils/renderers/equippedItemRenderingUtils';
import { triggerTreeShakeOptimistic, triggerTreeHitEffect } from '../utils/renderers/treeRenderingUtils';
import { triggerStoneShakeOptimistic, getStoneOreType, triggerStoneHitEffect } from '../utils/renderers/stoneRenderingUtils';
import { triggerCoralShakeOptimistic, triggerCoralHitEffect } from '../utils/renderers/livingCoralRenderingUtils';
import { triggerBarrelShakeOptimistic } from '../utils/renderers/barrelRenderingUtils';
import { triggerAnimalCorpseShakeOptimistic } from '../utils/renderers/animalCorpseRenderingUtils';
import { triggerPlayerCorpseShakeOptimistic } from '../utils/renderers/playerCorpseRenderingUtils';
import { triggerPlayerShakeOptimistic } from '../utils/renderers/playerRenderingUtils';
import { triggerAnimalShakeOptimistic } from '../utils/renderers/wildAnimalRenderingUtils';
import type {
    GameCanvasInputInteractionProgressState,
    GameCanvasInputRuntime,
} from '../engine/runtime/gameCanvasInputRuntime';

// --- Constants (Copied from GameCanvas) ---
/** Immediate hit SFX on optimistic harvest target (matches server barrel variant rules in barrel.rs). */
type HarvestHitPredictSound = 'tree_chop' | 'stone_hit' | 'barrel_hit' | 'hit_wood' | 'hit_trash';

type OptimisticHarvestPick = {
    d2: number;
    trigger: () => void;
    predictHarvestSound?: HarvestHitPredictSound;
};

function barrelHarvestPredictSound(variant: number): HarvestHitPredictSound {
    if (variant === 4) return 'hit_trash';
    if (variant === 3) return 'hit_wood';
    return 'barrel_hit';
}

const SWING_COOLDOWN_MS = 500;
const TREE_COLLISION_Y_OFFSET = 60; // Match server tree.rs
const OPTIMISTIC_AXE_RANGE = DEFAULT_MELEE_ATTACK_RANGE;
const OPTIMISTIC_SPEAR_RANGE = SPEAR_MELEE_ATTACK_RANGE;

function getReducerErrorMessage(err: unknown): string {
    const status = (err as { status?: { tag?: string; value?: string } } | undefined)?.status;
    if (status?.tag === 'Failed' && status.value) return status.value;
    if (err instanceof Error) return err.message;
    return String(err ?? '');
}

// Define a comprehensive props interface for the hook
interface InputHandlerProps {
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    connection: DbConnection | null;
    localPlayerId?: string;
    localPlayer: Player | undefined | null;
    predictedPosition: { x: number; y: number } | null; // ADDED: Client's predicted position for accurate firing
    getCurrentPositionNow: () => { x: number; y: number } | null; // ADDED: Function for exact position at firing time
    activeEquipments: Map<string, ActiveEquipment>;
    itemDefinitions: Map<string, ItemDefinition>;
    inventoryItems: Map<string, InventoryItem>;
    rangedWeaponStats?: Map<string, RangedWeaponStats>; // ADDED: For auto-fire detection
    serverProjectiles?: Map<string, Projectile>; // Lifecycle-only reconciliation for optimistic projectiles
    placementInfo: PlacementItemInfo | null;
    placementActions: PlacementActions;
    buildingState?: { isBuilding: boolean; mode: string }; // ADDED: Building state
    buildingActions?: { startBuildingMode: (mode: BuildingMode, tier?: number, initialShape?: number) => void; attemptPlacement: (worldX: number, worldY: number) => void; cancelBuildingMode: () => void; cycleFoundationShape: (direction: 'next' | 'prev') => void; rotateTriangleShape: () => void }; // ADDED: rotateTriangleShape
    worldMousePos: { x: number | null; y: number | null };
    worldMousePosRef?: MutableRefObject<{ x: number | null; y: number | null }>;
    canvasMousePos?: { x: number | null; y: number | null }; // ADDED: Canvas mouse position for radial menu
    
    // UNIFIED INTERACTION TARGET - replaces all individual closestInteractable* props
    closestInteractableTarget: InteractableTarget | null;
    interactionTargetRef?: MutableRefObject<InteractionTargetRuntimeResult>;
    
    // Essential entity maps for validation and data lookup (for optimistic shake on hit)
    trees?: Map<string, { id: bigint; posX: number; posY: number; health?: number }>;
    stones?: Map<string, { id: bigint; posX: number; posY: number; health?: number; oreType?: { tag?: string } | unknown }>;
    livingCorals?: Map<string, { id: bigint; posX: number; posY: number }>;
    barrels?: Map<string, { id: bigint; posX: number; posY: number; health?: number }>;
    animalCorpses?: Map<string, { id: number; posX: number; posY: number; health?: number }>;
    wildAnimals?: Map<string, { id: bigint; posX: number; posY: number; health?: number }>;
    woodenStorageBoxes: Map<string, WoodenStorageBox>;
    stashes: Map<string, Stash>;
    players: Map<string, Player>;
    turrets: Map<string, any>; // ADDED: Turrets for pickup check
    cairns: Map<string, SpacetimeDBCairn>; // ADDED: Cairns for lore lookup
    playerDiscoveredCairns: Map<string, PlayerDiscoveredCairn>; // ADDED: Player discovery tracking
    playerCorpses: Map<string, PlayerCorpse>; // ADDED: Player corpses for protection check
    
    onSetInteractingWith: (target: any | null) => void;
    addSOVAMessage?: (message: { id: string; text: string; isUser: boolean; timestamp: Date; flashTab?: boolean }) => void; // ADDED: SOVA message adder for cairn lore
    showSovaSoundBox?: (audio: HTMLAudioElement, label: string) => void; // ADDED: SOVA sound box for cairn lore audio with waveform
    onCairnNotification?: (notification: CairnNotification) => void; // ADDED: Cairn unlock notification callback
    isMinimapOpen: boolean;
    setIsMinimapOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isChatting: boolean;
    isInventoryOpen: boolean;
    isGameMenuOpen: boolean;
    isSearchingCraftRecipes?: boolean;
    isFishing: boolean;
    setMusicPanelVisible: React.Dispatch<React.SetStateAction<boolean>>;
    movementDirection: { x: number; y: number };
    isAutoWalking: boolean; // Auto-walk state for dodge roll detection
    onDodgeRollStart?: (moveX: number, moveY: number) => boolean | void; // Optional optimistic local dodge start hook; returns false to skip reducer call
    /** Shared with canvas render (same pattern as dodge); immediate jump arc for local player. */
    localOptimisticJumpPressMsRef: MutableRefObject<number>;
    targetedFoundation: any | null; // ADDED: Targeted foundation for upgrade menu
    targetedWall: any | null; // ADDED: Targeted wall for upgrade menu
    targetedFence: any | null; // ADDED: Targeted fence for repair/demolish
    buildTargetingRef?: MutableRefObject<{
        targetedFoundation: any | null;
        targetedWall: any | null;
        targetedFence: any | null;
    }>;
    onProfilerRecordClick?: (canvasX: number, canvasY: number) => boolean; // Profiler Record button hit test
    inputRuntime: GameCanvasInputRuntime;
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
    // ADDED: Building radial menu state
    showBuildingRadialMenu: boolean;
    radialMenuMouseX: number;
    radialMenuMouseY: number;
    setShowBuildingRadialMenu: (show: boolean) => void;
    showUpgradeRadialMenu: boolean;
    setShowUpgradeRadialMenu: (show: boolean) => void;
    optimisticProjectiles: Map<string, Projectile>;
    // Function to be called each frame by the game loop
    processInputsAndActions: () => void;
}

type InteractionProgressState = GameCanvasInputInteractionProgressState;

/** Check if target (tx, ty) is in player's attack cone. Matches server combat::find_targets_in_cone. */
function isInAttackCone(
  playerX: number, playerY: number, playerDir: string,
  targetX: number, targetY: number, targetYOffset: number,
  attackRange: number, attackAngleDeg: number
): { inCone: boolean; distSq: number } {
  const dx = targetX - playerX;
  const ty = targetY - targetYOffset;
  const dy = ty - playerY;
  const distSq = dx * dx + dy * dy;
  if (distSq >= attackRange * attackRange || distSq <= 0) return { inCone: false, distSq };
  const { dx: fwdX, dy: fwdY } = getDirectionVector(playerDir);
  const dist = Math.sqrt(distSq);
  const dot = (fwdX * dx + fwdY * dy) / dist;
  const angleRad = Math.acos(Math.max(-1, Math.min(1, dot)));
  const halfAngleRad = (attackAngleDeg * Math.PI / 180) / 2;
  return { inCone: angleRad <= halfAngleRad, distSq };
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

function getUnifiedInteractionTarget(result: InteractionTargetRuntimeResult | null | undefined): InteractableTarget | null {
    if (!result) return null;
    if (result.closestInteractableTarget) return result.closestInteractableTarget;
    if (result.closestInteractableWaterPosition) {
        return {
            type: 'water',
            id: 'water',
            position: {
                x: result.closestInteractableWaterPosition.x,
                y: result.closestInteractableWaterPosition.y,
            },
            distance: 0,
            data: undefined,
        };
    }
    return null;
}

export const useInputHandler = ({
    canvasRef,
    connection,
    turrets,
    localPlayerId,
    localPlayer,
    predictedPosition, // ADDED: Client's predicted position for accurate firing
    getCurrentPositionNow, // ADDED: Function for exact position at firing time
    activeEquipments,
    itemDefinitions,
    inventoryItems,
    placementInfo,
    placementActions,
    buildingState, // ADDED: Building state
    buildingActions, // ADDED: Building actions
    worldMousePos,
    worldMousePosRef,
    
    // UNIFIED INTERACTION TARGET - single source of truth
    closestInteractableTarget,
    interactionTargetRef,
    
    // Essential entity maps for validation
    trees,
    stones,
    livingCorals,
    barrels,
    animalCorpses,
    wildAnimals,
    players,
    cairns, // ADDED: Cairns for lore lookup
    playerDiscoveredCairns, // ADDED: Player discovery tracking
    playerCorpses, // ADDED: Player corpses for protection check
    addSOVAMessage, // ADDED: SOVA message adder for cairn lore
    showSovaSoundBox, // ADDED: SOVA sound box for cairn lore audio with waveform
    onCairnNotification, // ADDED: Cairn unlock notification callback
    
    onSetInteractingWith,
    isMinimapOpen,
    setIsMinimapOpen,
    isChatting,
    isSearchingCraftRecipes,
    isInventoryOpen,
    isGameMenuOpen,
    isFishing,
    setMusicPanelVisible,
    movementDirection,
    isAutoWalking, // Auto-walk state for dodge roll detection
    onDodgeRollStart,
    localOptimisticJumpPressMsRef,
    targetedFoundation, // ADDED: Targeted foundation
    targetedWall, // ADDED: Targeted wall
    targetedFence, // ADDED: Targeted fence
    buildTargetingRef,
    rangedWeaponStats, // ADDED: For auto-fire detection
    serverProjectiles,
    onProfilerRecordClick,
    inputRuntime,
}: InputHandlerProps): InputHandlerState => {
    // console.log('[useInputHandler IS RUNNING] isInventoryOpen:', isInventoryOpen);
    // Get player actions from the context instead of props
    const { jump } = usePlayerActions();

    // --- Internal State and Refs ---
    const inputRuntimeState = useSyncExternalStore(
        inputRuntime.subscribe,
        inputRuntime.getSnapshot,
        inputRuntime.getSnapshot,
    );
    const {
        interactionProgress,
        isActivelyHolding,
        isAutoAttacking,
        isCrouching,
        showBuildingRadialMenu,
        showUpgradeRadialMenu,
        radialMenuMouseX,
        radialMenuMouseY,
        optimisticProjectiles,
    } = inputRuntimeState;
    const {
        setInteractionProgress,
        setIsActivelyHolding,
        setIsAutoAttacking,
        setIsCrouching,
        setShowBuildingRadialMenu,
        setShowUpgradeRadialMenu,
        setRadialMenuMouseX,
        setRadialMenuMouseY,
    } = inputRuntime;
    const isAutoWalkingRef = useLatest(isAutoWalking); // Track auto-walk state for event handlers

    const jumpOptRef = localOptimisticJumpPressMsRef;

    const movementDirectionRef = useLatest(movementDirection);
    const onDodgeRollStartRef = useLatest(onDodgeRollStart);

    // Refs for dependencies - using useLatest to avoid stale closures without useEffect overhead
    const placementActionsRef = useLatest(placementActions);
    const connectionRef = useLatest(connection);
    const localPlayerRef = useLatest(localPlayer);
    const predictedPositionRef = useLatest(predictedPosition); // ADDED: Ref for client's predicted position
    const getCurrentPositionNowRef = useLatest(getCurrentPositionNow); // ADDED: Ref for exact position function
    const activeEquipmentsRef = useLatest(activeEquipments);
    // UNIFIED TARGET REF - single source of truth for current interaction target
    const latestClosestTargetRef = useLatest(closestInteractableTarget);
    const closestTargetRef = useMemo(() => ({
        get current(): InteractableTarget | null {
            return getUnifiedInteractionTarget(interactionTargetRef?.current) ?? latestClosestTargetRef.current;
        },
    }), [interactionTargetRef, latestClosestTargetRef]);
    const latestWorldMousePosRef = useLatest(worldMousePos);
    const worldMousePosRefInternal = worldMousePosRef ?? latestWorldMousePosRef;
    const treesRef = useLatest(trees);
    const stonesRef = useLatest(stones);
    const livingCoralsRef = useLatest(livingCorals);
    const barrelsRef = useLatest(barrels);
    const animalCorpsesRef = useLatest(animalCorpses);
    const playerCorpsesRef = useLatest(playerCorpses);
    const wildAnimalsRef = useLatest(wildAnimals);
    const playersRef = useLatest(players);
    const targetedFoundationRef = useLatest(targetedFoundation);
    const targetedWallRef = useLatest(targetedWall);
    const targetedFenceRef = useLatest(targetedFence);
    const buildTargetingRefInternal = buildTargetingRef;
    const itemDefinitionsRef = useLatest(itemDefinitions);
    const rangedWeaponStatsRef = useLatest(rangedWeaponStats); // ADDED: Ref for ranged weapon stats

    // --- Derive input disabled state based ONLY on player death --- 
    const isPlayerDead = localPlayer?.isDead ?? false;

    // --- Effect to reset sprint state if player dies --- 
    useEffect(() => {
        // Player death no longer needs to manage sprinting here.
        // It's handled by the movement hooks.

        // Also clear E hold state if player dies
        if (localPlayer?.isDead && inputRuntime.isEHoldActive()) {
            inputRuntime.cancelEHoldInteraction();
        }
        // Also clear auto-attack state if player dies
        if (localPlayer?.isDead && isAutoAttacking) {
            setIsAutoAttacking(false);
        }
        // Auto-walk removed - movement handled by usePredictedMovement
    }, [inputRuntime, localPlayer?.isDead, isAutoAttacking, setIsAutoAttacking]); // Depend on death state and the reducer callback

    // Building refs - using useLatest to avoid stale closures
    const buildingActionsRef = useLatest(buildingActions);
    const buildingStateRef = useLatest(buildingState);

    // ADDED: Reset upgrade menu refs when menu closes
    useEffect(() => {
        if (!showUpgradeRadialMenu) {
            // Menu closed - reset all refs to allow menu to open again
            inputRuntime.clearUpgradeMenuTargetIds();
            inputRuntime.setRadialMenuShown(false);
            // Clear any pending timeout
            inputRuntime.clearRadialMenuTimeout();
        }
    }, [inputRuntime, showUpgradeRadialMenu]);

    // ADDED: Reset building menu refs when menu closes
    useEffect(() => {
        if (!showBuildingRadialMenu) {
            // Building menu closed - reset refs
            inputRuntime.setRadialMenuShown(false);
            // Clear any pending timeout
            inputRuntime.clearRadialMenuTimeout();
        }
    }, [inputRuntime, showBuildingRadialMenu]);

    useEffect(() => {
        inputRuntime.reconcileAuthoritativeProjectiles(localPlayerId, serverProjectiles);
    }, [inputRuntime, localPlayerId, optimisticProjectiles.size, serverProjectiles]);

    // ADDED: Clear radial menu state when building mode ends (switching tools)
    useEffect(() => {
        if (!buildingState?.isBuilding) {
            // Building mode ended - clear all radial menu state
            inputRuntime.setRadialMenuShown(false);
            setShowBuildingRadialMenu(false);
            inputRuntime.clearRadialMenuTimeout();
        }
    }, [buildingState?.isBuilding, inputRuntime, setShowBuildingRadialMenu]);

    // Synchronize local crouch state with server state to prevent desync
    // Don't override optimistic state while pending requests are in flight
    useEffect(() => {
        if (localPlayer?.isCrouching !== undefined && !inputRuntime.isCrouchTogglePending()) {
            setIsCrouching(localPlayer.isCrouching);
        }
    }, [inputRuntime, localPlayer?.isCrouching, setIsCrouching]);

    // Jump offset calculation is now handled directly in processInputsAndActions
    // to avoid React re-renders every frame

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

        const cooldownKey =
            !localEquipment ||
            localEquipment.equippedItemDefId === null ||
            localEquipment.equippedItemInstanceId === null
                ? 'unarmed'
                : String(localEquipment.equippedItemDefId);

        inputRuntime.ensureMeleeCooldownKey(cooldownKey);

        if (!localEquipment || localEquipment.equippedItemDefId === null || localEquipment.equippedItemInstanceId === null) {
            // Server-side use_equipped_item intentionally requires an item. Empty hands
            // have no gameplay action, so do not send a reducer that will reject.
            inputRuntime.setIsMouseDown(false);
            inputRuntime.clearMeleeHeldTickSuppression();
            inputRuntime.blockMeleeSwingFor(SWING_COOLDOWN_MS);
            return;
        } else {
            // Armed (melee/tool)
            if (!itemDef) return;
            if (itemDef.name === "Bandage" || itemDef.name === "Selo Olive Oil" || itemDef.name === "Hunting Bow" || itemDef.category === ItemCategory.RangedWeapon) {
                // Ranged/Bandage/Selo Olive Oil should not be triggered by swing
                return;
            }
            const nowPerf = performance.now();
            if (!inputRuntime.canMeleeSwing(nowPerf)) return;
            const attackIntervalMs = Math.max(
                50,
                itemDef.attackIntervalSecs ? itemDef.attackIntervalSecs * 1000 : SWING_COOLDOWN_MS
            );
            inputRuntime.suppressNextMeleeHeldTick();
            try {
                // 🎬 CLIENT-AUTHORITATIVE ANIMATION: Register swing immediately for smooth visuals
                registerLocalPlayerSwing();
                playImmediateSound('weapon_swing', 0.8);
                // Optimistic shake: any melee weapon can damage trees/stones/corals - find closest in attack cone
                const player = localPlayerRef.current;
                if (player) {
                    const px = predictedPositionRef.current?.x ?? player.positionX;
                    const py = predictedPositionRef.current?.y ?? player.positionY;
                    const dir = player.direction ?? 'down';
                    let best: OptimisticHarvestPick | null = null;
                    const attackAngle = 90;
                    const attackRange = OPTIMISTIC_AXE_RANGE; // Default melee range
                    // Trees - any weapon can hit
                    treesRef.current?.forEach((tree) => {
                        if (tree.health === 0) return;
                        const { inCone, distSq } = isInAttackCone(px, py, dir, tree.posX, tree.posY, TREE_COLLISION_Y_OFFSET, attackRange, attackAngle);
                        if (inCone && (!best || distSq < best.d2))
                            best = {
                                d2: distSq,
                                predictHarvestSound: 'tree_chop',
                                trigger: () => {
                                    const tid = tree.id.toString();
                                    triggerTreeShakeOptimistic(tid, tree.posX, tree.posY);
                                    triggerTreeHitEffect(tid, tree.posX, tree.posY);
                                },
                            };
                    });
                    // Stones - any weapon can hit
                    const STONE_COLLISION_Y_OFFSET = 50;
                    stonesRef.current?.forEach((stone) => {
                        if (stone.health === 0) return;
                        const { inCone, distSq } = isInAttackCone(px, py, dir, stone.posX, stone.posY, STONE_COLLISION_Y_OFFSET, attackRange, attackAngle);
                        if (inCone && (!best || distSq < best.d2))
                            best = {
                                d2: distSq,
                                predictHarvestSound: 'stone_hit',
                                trigger: () => {
                                    const sid = stone.id.toString();
                                    const ore = getStoneOreType(stone as any);
                                    triggerStoneShakeOptimistic(sid, stone.posX, stone.posY, ore);
                                    triggerStoneHitEffect(sid, stone.posX, stone.posY, ore);
                                },
                            };
                    });
                    // Corals - only when snorkeling (underwater)
                    if (player.isSnorkeling) {
                        const CORAL_COLLISION_Y_OFFSET = 60;
                        livingCoralsRef.current?.forEach((coral) => {
                            const { inCone, distSq } = isInAttackCone(px, py, dir, coral.posX, coral.posY, CORAL_COLLISION_Y_OFFSET, OPTIMISTIC_SPEAR_RANGE, 60);
                            if (inCone && (!best || distSq < best.d2))
                                best = {
                                    d2: distSq,
                                    predictHarvestSound: 'stone_hit',
                                    trigger: () => {
                                        const cid = coral.id.toString();
                                        const v = Number(coral.id) % 4;
                                        triggerCoralShakeOptimistic(cid, coral.posX, coral.posY, v);
                                        triggerCoralHitEffect(cid, coral.posX, coral.posY, v);
                                    },
                                };
                        });
                    }
                    // Barrels - any weapon can hit (variant 6 = buoy uses different collision offset)
                    barrelsRef.current?.forEach((barrel) => {
                        if (barrel.health === 0) return;
                        const barrelVariant = (barrel as { variant?: number }).variant ?? 0;
                        const barrelCollisionYOffset = barrelVariant === 6 ? 110 : barrelVariant === 4 ? 96 : 48;
                        const { inCone, distSq } = isInAttackCone(px, py, dir, barrel.posX, barrel.posY, barrelCollisionYOffset, attackRange, attackAngle);
                        if (inCone && (!best || distSq < best.d2)) {
                            const bvs = barrelVariant;
                            best = {
                                d2: distSq,
                                predictHarvestSound: barrelHarvestPredictSound(bvs),
                                trigger: () => {
                                    triggerBarrelShakeOptimistic(barrel.id.toString());
                                },
                            };
                        }
                    });
                    // Animal corpses - any weapon can hit
                    const ANIMAL_CORPSE_COLLISION_Y_OFFSET = 8;
                    animalCorpsesRef.current?.forEach((corpse) => {
                        if (corpse.health === 0) return;
                        const { inCone, distSq } = isInAttackCone(px, py, dir, corpse.posX, corpse.posY, ANIMAL_CORPSE_COLLISION_Y_OFFSET, attackRange, attackAngle);
                        if (inCone && (!best || distSq < best.d2)) best = { d2: distSq, trigger: () => triggerAnimalCorpseShakeOptimistic(corpse.id.toString()) };
                    });
                    // Player corpses - any weapon can hit
                    const PLAYER_CORPSE_COLLISION_Y_OFFSET = 10;
                    playerCorpsesRef.current?.forEach((corpse) => {
                        if (corpse.health === 0) return;
                        const { inCone, distSq } = isInAttackCone(px, py, dir, corpse.posX, corpse.posY, PLAYER_CORPSE_COLLISION_Y_OFFSET, attackRange, attackAngle);
                        if (inCone && (!best || distSq < best.d2)) best = { d2: distSq, trigger: () => triggerPlayerCorpseShakeOptimistic(corpse.id.toString()) };
                    });
                    // Other players (PvP) - exclude local player
                    const PLAYER_COLLISION_Y_OFFSET = 0;
                    playersRef.current?.forEach((p) => {
                        if (p.identity.toHexString() === localPlayerId) return;
                        if (p.isDead) return;
                        const { inCone, distSq } = isInAttackCone(px, py, dir, p.positionX, p.positionY, PLAYER_COLLISION_Y_OFFSET, attackRange, attackAngle);
                        if (inCone && (!best || distSq < best.d2)) best = { d2: distSq, trigger: () => triggerPlayerShakeOptimistic(p.identity.toHexString()) };
                    });
                    // Wild animals
                    const WILD_ANIMAL_COLLISION_Y_OFFSET = 40;
                    wildAnimalsRef.current?.forEach((animal) => {
                        if (animal.health === 0) return;
                        const { inCone, distSq } = isInAttackCone(px, py, dir, animal.posX, animal.posY, WILD_ANIMAL_COLLISION_Y_OFFSET, attackRange, attackAngle);
                        if (inCone && (!best || distSq < best.d2)) best = { d2: distSq, trigger: () => triggerAnimalShakeOptimistic(animal.id.toString()) };
                    });
                    // forEach mutations aren't tracked — `best` stays `null` in control flow; cast for use below.
                    const harvestPick = best as OptimisticHarvestPick | null;
                    if (harvestPick) {
                        harvestPick.trigger();
                        if (harvestPick.predictHarvestSound) {
                            playImmediateSound(harvestPick.predictHarvestSound, 0.85);
                        }
                    }
                }
                connectionRef.current.reducers.useEquippedItem({})
                    .catch((err: unknown) => {
                        console.warn('[attemptSwing Armed] useEquippedItem failed:', getReducerErrorMessage(err));
                        inputRuntime.blockMeleeSwingFor(50);
                    });
                inputRuntime.setNextMeleeSwingAllowedPerf(nowPerf + attackIntervalMs);
            } catch (err) {
                console.error("[attemptSwing Armed] Error calling useEquippedItem reducer:", err);
                inputRuntime.blockMeleeSwingFor(50);
            }
        }
    }, [inputRuntime, localPlayerId, isFishing]); // 🎣 FISHING INPUT FIX: Add isFishing dependency

    // Unified ranged fire: single dispatch path for click and held-auto-fire, shared cooldown
    const attemptRangedFire = useCallback(() => {
        if (!connectionRef.current?.reducers || !localPlayerId || worldMousePosRefInternal.current.x === null || worldMousePosRefInternal.current.y === null) return;
        const eq = activeEquipmentsRef.current?.get(localPlayerId);
        if (!eq?.isReadyToFire || !eq.equippedItemDefId) return;
        const itemDef = itemDefinitionsRef.current?.get(String(eq.equippedItemDefId));
        if (!itemDef || itemDef.category?.tag !== "RangedWeapon") return;
        const weaponStats = rangedWeaponStatsRef.current?.get(itemDef.name || "");
        const fireIntervalMs = (weaponStats?.reloadTimeSecs ?? 0.1) * 1000;
        const now = performance.now();
        if (!inputRuntime.canFireRanged(fireIntervalMs, now)) return;
        const currentPlayer = localPlayerRef.current;
        if (!currentPlayer) return;
        const exactPos = getCurrentPositionNowRef.current?.();
        const fallbackPos = predictedPositionRef.current;
        const fireX = exactPos?.x ?? fallbackPos?.x ?? currentPlayer.positionX;
        const fireY = exactPos?.y ?? fallbackPos?.y ?? currentPlayer.positionY;
        const clientShotId = inputRuntime.createClientShotId(localPlayerId);
        registerLocalPlayerRangedShot(itemDef.name);
        connectionRef.current.reducers.fireProjectile({
            targetWorldX: worldMousePosRefInternal.current.x,
            targetWorldY: worldMousePosRefInternal.current.y,
            clientPlayerX: fireX,
            clientPlayerY: fireY,
            clientShotId,
        });
        inputRuntime.markRangedFire(now);
    }, [inputRuntime, localPlayerId]);

    useEffect(() => {
        return inputRuntime.bindDomInputEvents({
            getCanvas: () => canvasRef?.current ?? null,
        });
    }, [canvasRef, inputRuntime]);

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
                // Skip clearing if the input explicitly allows spacebar (e.g., matronage name input)
                const allowsSpacebar = target?.getAttribute('data-allow-spacebar') === 'true' ||
                    document.activeElement?.getAttribute('data-allow-spacebar') === 'true';
                if (key === ' ' && isChatInputFocused && !isChatting && !isSearchingCraftRecipes && !allowsSpacebar) {
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
                            inputRuntime.setCrouchTogglePending(true);
                            connectionRef.current?.reducers.toggleCrouch({});
                            // Clear pending flag after a brief delay (server should respond by then)
                            setTimeout(() => {
                                inputRuntime.setCrouchTogglePending(false);
                            }, 200); // 200ms should be enough for server response
                            return !prev;
                        });
                        return; // Handled
                    // NOTE: 'g' key for map is now handled in GameScreen.tsx 
                    // to properly manage interfaceInitialView (always opens to map)
                    case 'm': // Handle music panel toggle here
                        setMusicPanelVisible(prev => !prev);
                        event.preventDefault(); // Prevent typing 'm' in chat etc.
                        console.log('[M-Key] Toggled music control panel');
                        return;
                    case 'r': // ADDED: Rotate triangle foundation shape
                        if (buildingStateRef.current?.isBuilding && buildingActionsRef.current) {
                            event.preventDefault();
                            // Only rotate triangle foundation shapes (fences use dynamic edge detection like walls)
                            if (buildingStateRef.current.mode !== 'fence') {
                                buildingActionsRef.current.rotateTriangleShape();
                                console.log('[R-Key] Rotated triangle foundation shape');
                            }
                        }
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
                    // Check if target or active element has data-allow-spacebar attribute (for search inputs)
                    const allowsSpacebar = target.getAttribute('data-allow-spacebar') === 'true' ||
                        document.activeElement?.getAttribute('data-allow-spacebar') === 'true';
                    if (allowsSpacebar) {
                        return; // Let the input handle spacebar for typing
                    }
                    
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

                    // Check if player is moving (either via keyboard input or auto-walk)
                    const moveX = movementDirectionRef.current.x;
                    const moveY = movementDirectionRef.current.y;
                    const isMoving = Math.abs(moveX) > 0.01 || Math.abs(moveY) > 0.01 || isAutoWalkingRef.current;

                    if (isMoving) {
                        inputRuntime.setJumpNeedsRelease(false);
                        if (localPlayerRef.current.isOnWater) {
                            console.log('[Input] Dodge roll blocked - player is on water');
                            return;
                        }

                        // Dodge Roll (works with both manual movement and auto-walk)
                        // Only call reducer when optimistic trigger actually ran (avoids "Already dodge rolling" rejections)
                        const didTrigger = onDodgeRollStartRef.current?.(moveX, moveY);
                        if (connectionRef.current?.reducers && didTrigger !== false) {
                            connectionRef.current.reducers.dodgeRoll({ moveX, moveY })
                                .catch((err: unknown) => {
                                    // Silently ignore expected server rejections (already rolling, cooldown, etc.)
                                    const msg = err instanceof Error ? err.message : String(err);
                                    if (!msg.includes('Already dodge rolling') && !msg.includes('cooldown')) {
                                        console.error('[InputHandler] dodgeRoll rejected:', err);
                                    }
                                });
                            console.log('[Input] Dodge roll triggered', { direction: { x: moveX, y: moveY }, isAutoWalking: isAutoWalkingRef.current });
                        }
                    } else {
                        // Jump (only when truly stationary - no manual input AND no auto-walk)
                        if (inputRuntime.shouldIgnoreJumpUntilRelease()) {
                            return;
                        }
                        try {
                            // Optimistic ref only after reducer is actually sent (jump() applies server-aligned throttle).
                            if (jump()) {
                                inputRuntime.markLocalOptimisticJump(jumpOptRef);
                                inputRuntime.setJumpNeedsRelease(true);
                                console.log('[Input] Jump triggered (stationary)');
                            }
                        } catch (err) {
                            inputRuntime.clearLocalOptimisticJump(jumpOptRef);
                            console.error("[InputHandler] Error calling jump:", err);
                        }
                    }
                }
            }

            // Multi-function key ('f'): Water container filling + Headlamp toggle
            if (key === 'f' && !event.repeat) {
                if (isPlayerDead) return;
                
                let handledWaterFilling = false;
                let handledHeadlampToggle = false;
                
                // === WATER CONTAINER FILLING (equipped item) ===
                const localPlayerActiveEquipment = activeEquipmentsRef.current?.get(localPlayerId || '');
                if (localPlayerActiveEquipment?.equippedItemInstanceId && localPlayerActiveEquipment?.equippedItemDefId) {
                    const equippedItemDef = itemDefinitionsRef.current?.get(localPlayerActiveEquipment.equippedItemDefId.toString());
                    
                    if (equippedItemDef && isWaterContainer(equippedItemDef.name)) {
                        // Get the water container item
                        const waterContainer = inventoryItems.get(localPlayerActiveEquipment.equippedItemInstanceId.toString());
                        
                        if (waterContainer && connectionRef.current?.reducers && localPlayerRef.current?.isOnWater) {
                            console.log('[F-Key] Player is on water - attempting to fill container');
                            
                            // TODO: Add salt water detection when implemented
                            const isOnSaltWater = false; // Placeholder - all water is fresh for now
                            
                            if (!isOnSaltWater) {
                                // Calculate remaining capacity using helper functions
                                const currentWaterContent = getWaterContent(waterContainer) || 0; // in liters
                                const maxCapacityLiters = getWaterCapacity(equippedItemDef.name); // in liters
                                const remainingCapacityMl = Math.floor((maxCapacityLiters - currentWaterContent) * 1000); // Convert L to mL

                                console.log(`[F-Key] Current water: ${currentWaterContent}L, Max: ${maxCapacityLiters}L, Remaining: ${remainingCapacityMl}mL`);

                                if (remainingCapacityMl > 0) {
                                    const fillAmount = Math.min(250, remainingCapacityMl); // Fill 250mL or remaining capacity
                                    console.log(`[F-Key] Attempting to fill ${equippedItemDef.name} with ${fillAmount}mL from fresh water source`);

                                    try {
                                        connectionRef.current.reducers.fillWaterContainerFromNaturalSource({
                                            itemInstanceId: localPlayerActiveEquipment.equippedItemInstanceId,
                                            fillAmountMl: fillAmount
                                        });
                                        console.log(`[F-Key] Successfully called fillWaterContainerFromNaturalSource`);
                                        handledWaterFilling = true;
                                    } catch (err) {
                                        console.error('[F-Key] Error filling water container:', err);
                                    }
                                } else {
                                    console.log('[F-Key] Water container is already full');
                                }
                            } else {
                                console.log('[F-Key] Cannot fill water container from salt water source');
                            }
                        }
                    }
                }
                
                // === HEADLAMP / SNORKEL TOGGLE (head armor slot) ===
                // Check if player has a headlamp or snorkel equipped in head armor slot
                let handledSnorkelToggle = false;
                const activeArmor = activeEquipmentsRef.current?.get(localPlayerId || '');
                if (activeArmor?.headItemInstanceId && connectionRef.current?.reducers) {
                    // Get the head armor item
                    const headItem = inventoryItems.get(activeArmor.headItemInstanceId.toString());
                    if (headItem) {
                        const headItemDef = itemDefinitionsRef.current?.get(headItem.itemDefId.toString());
                        if (headItemDef) {
                            // Check for Headlamp
                            if (headItemDef.name === 'Headlamp') {
                                console.log('[F-Key] Toggling headlamp');
                                try {
                                    connectionRef.current.reducers.toggleHeadlamp({});
                                    console.log('[F-Key] Successfully called toggleHeadlamp');
                                    handledHeadlampToggle = true;
                                } catch (err) {
                                    console.error('[F-Key] Error toggling headlamp:', err);
                                }
                            }
                            // Check for Snorkel (must be on water to toggle)
                            else if (headItemDef.name === 'Reed Diver\'s Helm') {
                                if (localPlayerRef.current?.isOnWater) {
                                    // Check if we're about to go UNDERWATER (toggling snorkel ON)
                                    const isCurrentlySnorkeling = localPlayerRef.current?.isSnorkeling ?? false;
                                    
                                    // If going underwater and torch is equipped, unequip it first for seamless transition
                                    if (!isCurrentlySnorkeling && localPlayerId) {
                                        const localPlayerActiveEquip = activeEquipmentsRef.current?.get(localPlayerId);
                                        if (localPlayerActiveEquip?.equippedItemDefId) {
                                            const equippedDef = itemDefinitionsRef.current?.get(localPlayerActiveEquip.equippedItemDefId.toString());
                                            if (equippedDef?.name === 'Torch') {
                                                console.log('[F-Key] Unequipping torch before going underwater for seamless transition');
                                                try {
                                                    // Use Identity.fromString to convert localPlayerId to proper Identity type
                                                    const playerIdentity = Identity.fromString(localPlayerId);
                                                    connectionRef.current.reducers.clearActiveItemReducer({ playerIdentity });
                                                } catch (err) {
                                                    console.error('[F-Key] Error unequipping torch:', err);
                                                }
                                            }
                                        }
                                    }
                                    
                                    console.log('[F-Key] Toggling snorkel (player is on water)');
                                    try {
                                        connectionRef.current.reducers.toggleSnorkel({});
                                        console.log('[F-Key] Successfully called toggleSnorkel');
                                        handledSnorkelToggle = true;
                                    } catch (err) {
                                        console.error('[F-Key] Error toggling snorkel:', err);
                                    }
                                } else {
                                    console.log('[F-Key] Cannot toggle snorkel - player is not on water');
                                }
                            }
                        }
                    }
                }
                
                // Log if no action was taken
                if (!handledWaterFilling && !handledHeadlampToggle && !handledSnorkelToggle) {
                    console.log('[F-Key] No applicable action - no water container on water, no headlamp, or no snorkel on water');
                }
                
                return;
            }


            // Interaction key ('e')
            if (key === 'e' && !event.repeat && inputRuntime.canBeginEHold()) {
                inputRuntime.beginEHold();

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
                            startTime: inputRuntime.getEHoldStartTime(),
                        };
                        console.log('[E-KeyDown] Setting up primary hold target:', holdTarget);
                    } 
                    // Check for secondary hold actions (interface targets that also support hold)
                    else if (hasSecondaryHoldAction(currentTarget)) {
                        holdTarget = { 
                            targetId: currentTarget.id, 
                            targetType: currentTarget.type,
                            startTime: inputRuntime.getEHoldStartTime(),
                        };
                        console.log('[E-KeyDown] Setting up secondary hold target:', holdTarget, 'isEmpty:', currentTarget.data?.isEmpty);
                    }
                    // If no hold action is available, trigger tap action immediately for instant responsiveness
                    else if (isTapInteraction(currentTarget)) {
                        console.log('[E-KeyDown] Immediate tap interaction:', getActionType(currentTarget));
                        // Trigger tap action immediately for vegetables, dropped items, cairns, etc.
                        inputRuntime.markTapActionTriggeredOnKeyDown(); // Mark that we've triggered the action
                        switch (currentTarget.type) {
                            case 'harvestable_resource':
                                const resourceId = currentTarget.id as bigint;
                                console.log('[E-KeyDown] Immediate harvest:', resourceId);
                                previewSeaweedHarvestBlockedIfNeeded(
                                  currentConnection,
                                  resourceId,
                                  localPlayer?.isSnorkeling,
                                );
                                void Promise.resolve(
                                  currentConnection.reducers.interactWithHarvestableResource({ resourceId }),
                                ).catch(() => {});
                                break;
                            case 'dropped_item':
                                console.log('[E-KeyDown] Immediate pickup:', currentTarget.id);
                                currentConnection.reducers.pickupDroppedItem({ droppedItemId: currentTarget.id as bigint });
                                break;
                            case 'cairn':
                                // Interact with cairn: call reducer, play audio, show lore text in SOVA chat
                                if (typeof currentTarget.id === 'bigint') {
                                    const cairnId = currentTarget.id;
                                    const cairn = cairns?.get(String(cairnId));
                                    
                                    console.log(`[Cairn] KeyDown interaction - cairnId: ${cairnId}, cairn found: ${!!cairn}`);
                                    
                                    if (cairn) {
                                        // If audio is already playing, stop it first so we can restart
                                        if (isCairnAudioPlaying()) {
                                            console.log('[Cairn] Audio already playing, stopping to restart');
                                            stopCairnLoreAudio();
                                        }
                                        
                                        // Check if this is the first time THIS PLAYER is discovering this cairn
                                        // Must filter by player identity since playerDiscoveredCairns contains ALL players' discoveries
                                        const isFirstDiscovery = !Array.from(playerDiscoveredCairns?.values() || [])
                                            .some(discovery => 
                                                discovery.playerIdentity?.toHexString() === localPlayerId &&
                                                discovery.cairnId === cairnId
                                            );
                                        console.log(`[Cairn] isFirstDiscovery check: localPlayerId=${localPlayerId?.slice(0, 16)}, cairnId=${cairnId}, result=${isFirstDiscovery}`);
                                        
                                        // Find the lore entry
                                        const loreEntry = CAIRN_LORE_TIDBITS.find(entry => entry.id === cairn.loreId);
                                        console.log(`[Cairn] Found lore entry for cairn ${cairnId}:`, loreEntry?.id, loreEntry?.index, 'isFirstDiscovery:', isFirstDiscovery);
                                        
                                        // Calculate discovery count for THIS PLAYER only
                                        const currentDiscoveryCount = Array.from(playerDiscoveredCairns?.values() || [])
                                            .filter(d => d.playerIdentity?.toHexString() === localPlayerId).length;
                                        const newDiscoveryCount = isFirstDiscovery ? currentDiscoveryCount + 1 : currentDiscoveryCount;
                                        const totalCairns = getTotalCairnLoreCount();
                                        
                                        // Call the reducer
                                        try {
                                            currentConnection.reducers.interactWithCairn({ cairnId });
                                            console.log(`[Cairn] Reducer called for cairn ${cairnId}`);
                                            
                                            // Note: Sound is played via PlayerDiscoveredCairn.onInsert callback
                                            // to ensure it only plays on actual first discovery (after server confirms)
                                            
                                            if (loreEntry) {
                                                // Create lore audio element
                                                console.log(`[Cairn] Creating audio for lore index ${loreEntry.index}`);
                                                const loreAudio = createCairnLoreAudio(loreEntry.index, 0.9);
                                                
                                                // Play with SovaSoundBox if available (shows waveform, click to cancel)
                                                if (loreAudio) {
                                                    if (showSovaSoundBox) {
                                                        loreAudio.play().then(() => {
                                                            showSovaSoundBox(loreAudio, `SOVA: ${loreEntry.title}`);
                                                        }).catch(err => {
                                                            console.warn(`[Cairn] Failed to play lore audio:`, err);
                                                            // CRITICAL: Clear the pending flag if audio fails to play
                                                            // Otherwise notification sounds will be blocked forever
                                                            stopCairnLoreAudio();
                                                        });
                                                    } else {
                                                        // Fallback: play without SovaSoundBox
                                                        loreAudio.play().catch(err => {
                                                            console.warn(`[Cairn] Failed to play lore audio (fallback):`, err);
                                                            // CRITICAL: Clear the pending flag if audio fails to play
                                                            stopCairnLoreAudio();
                                                        });
                                                    }
                                                }
                                                
                                                // Show notification
                                                if (onCairnNotification) {
                                                    console.log(`[Cairn] Showing notification - ${newDiscoveryCount}/${totalCairns}`);
                                                    onCairnNotification({
                                                        id: `cairn_${cairnId}_${Date.now()}`,
                                                        cairnNumber: newDiscoveryCount,
                                                        totalCairns: totalCairns,
                                                        title: loreEntry.title,
                                                        isFirstDiscovery: isFirstDiscovery,
                                                        timestamp: Date.now()
                                                    });
                                                }
                                                
                                                // Add lore text to SOVA chat with tab flash
                                                if (addSOVAMessage) {
                                                    addSOVAMessage({
                                                        id: `cairn_${cairnId}_${Date.now()}`,
                                                        text: loreEntry.text,
                                                        isUser: false,
                                                        timestamp: new Date(),
                                                        flashTab: true // Flash the SOVA tab to draw attention
                                                    });
                                                } else {
                                                    console.warn('[Cairn] addSOVAMessage not available, cannot display lore text');
                                                }
                                            } else {
                                                console.warn(`[Cairn] Lore entry not found for lore_id: ${cairn.loreId}`);
                                            }
                                        } catch (error) {
                                            console.error('[Cairn] Error interacting with cairn:', error);
                                        }
                                    } else {
                                        console.warn(`[Cairn] Cairn not found in map: ${cairnId}`);
                                    }
                                }
                                break;
                            case 'milkable_animal':
                                // Milk a tamed animal (caribou or walrus)
                                if (typeof currentTarget.id === 'bigint') {
                                    const animalId = currentTarget.id;
                                    console.log(`[Milk] Attempting to milk animal: ${animalId}`);
                                    try {
                                        // Cast to any until bindings are regenerated after server build
                                        (currentConnection.reducers as any).milkAnimal(animalId);
                                        console.log(`[Milk] Reducer called for animal ${animalId}`);
                                    } catch (error) {
                                        console.error('[Milk] Error milking animal:', error);
                                    }
                                }
                                break;
                        }
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

                    inputRuntime.startHoldTimer(holdTarget, currentConnection, {
                        getCurrentTarget: () => closestTargetRef.current,
                        getTurret: (targetId) => turrets?.get(String(targetId)),
                    });
                }
            }
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();

            // Movement key handling is now done by useMovementInput hook
            // Only handle non-movement keys here to avoid conflicts

            if (event.code === 'Space') {
                inputRuntime.setJumpNeedsRelease(false);
            }

            if (key === 'e') {
                if (inputRuntime.isEHoldActive()) { // Check if E was being held for an interaction
                    const holdDuration = inputRuntime.getEHoldDuration();
                                            // Get the current target for tap action processing
                        const currentTarget = closestTargetRef.current;

                    // Always clear the timer if it exists (in case keyUp happens before timer fires)
                    const timerDebugValue = inputRuntime.getEHoldTimerDebugValue();
                    console.log(`[E-KeyUp] Timer ref state: ${timerDebugValue} (holdDuration: ${holdDuration}ms)`);
                    if (timerDebugValue) {
                        console.log(`[E-KeyUp] *** CLEARING TIMER *** Timer ID: ${timerDebugValue}, holdDuration: ${holdDuration}ms`);
                        inputRuntime.clearEHoldTimer();
                    } else {
                        console.log(`[E-KeyUp] No timer to clear (holdDuration: ${holdDuration}ms)`);
                    }

                    // Reset hold state and unconditionally clear interaction progress if a hold was active
                    inputRuntime.finishEHoldKeyPress();
                    if (interactionProgress) { // If there was any interaction progress, clear it now
                        setInteractionProgress(null);
                    }

                    // Also ensure isActivelyHolding is false if E key is up and was part of a hold
                    setIsActivelyHolding(false);

                    // Check if tap action was already triggered on keyDown (for instant responsiveness)
                    const wasTapActionTriggeredOnKeyDown = inputRuntime.consumeTapActionTriggeredOnKeyDown();

                    // Check if it was a TAP or HOLD based on duration and target type
                    const expectedDuration = currentTarget?.type === 'knocked_out_player' ? REVIVE_HOLD_DURATION_MS : 
                                            currentTarget && hasSecondaryHoldAction(currentTarget) ? getSecondaryHoldDuration(currentTarget) :
                                            HOLD_INTERACTION_DURATION_MS;

                    console.log('[E-KeyUp] Processing hold/tap decision:', {
                        holdDuration,
                        expectedDuration,
                        wasLongEnough: holdDuration >= expectedDuration,
                        wasTapActionTriggeredOnKeyDown,
                        currentTarget: currentTarget ? formatTargetForLogging(currentTarget) : 'null'
                    });

                    if (holdDuration >= expectedDuration) {
                        // This was a HOLD that completed naturally - actions should have been handled by timer
                        console.log('[E-KeyUp] HOLD completed naturally - timer should have handled action');
                    } else if (!wasTapActionTriggeredOnKeyDown) {
                        // This was a TAP (or early release) - handle tap interactions only if not already triggered on keyDown
                        console.log('[E-KeyUp] Processing as TAP interaction');
                        let tapActionTaken = false;

                        // Handle tap actions using unified target system
                        if (connectionRef.current?.reducers && currentTarget && isTargetValid(currentTarget)) {
                            // console.log('[E-Tap ACTION] Processing tap for:', formatTargetForLogging(currentTarget));
                            
                            // Handle immediate tap actions (harvest/pickup)
                            if (isTapInteraction(currentTarget)) {
                                switch (currentTarget.type) {
                                    case 'harvestable_resource':
                                        // Enhanced debugging: Get the actual resource data for detailed logging
                                        const resourceId = currentTarget.id as bigint;
                                        
                                        // Try to get the resource entity from the connection's database
                                        let resourceEntity = null;
                                        try {
                                            if (connectionRef.current?.db?.harvestable_resource) {
                                                // Use the generated table handle to find the resource by ID
                                                resourceEntity = Array.from(connectionRef.current.db.harvestable_resource.iter())
                                                    .find((resource: { id: bigint }) => resource.id === resourceId);
                                            }
                                        } catch (error) {
                                            console.warn('[E-Tap ACTION] Error accessing harvestable resources:', error);
                                        }
                                        
                                        if (resourceEntity) {
                                            // console.log('[E-Tap ACTION] 🌱 HARVESTING RESOURCE - Details:', {
                                            //     id: resourceId,
                                            //     plantType: resourceEntity.plantType,
                                            //     position: `(${resourceEntity.posX}, ${resourceEntity.posY})`,
                                            //     chunkIndex: resourceEntity.chunkIndex,
                                            //     respawnAt: resourceEntity.respawnAt,
                                            //     isRespawning: !!resourceEntity.respawnAt
                                            // });
                                            
                                            // Also log just the plant type tag for easy scanning
                                            // console.log(`[E-Tap ACTION] 🎯 Harvesting: ${resourceEntity.plantType.tag} at (${resourceEntity.posX.toFixed(1)}, ${resourceEntity.posY.toFixed(1)})`);
                                        } else {
                                            console.warn('[E-Tap ACTION] ⚠️ Resource not found in cache:', resourceId);
                                            // Log target details we do have
                                            // console.log('[E-Tap ACTION] Target details:', {
                                            //     id: resourceId,
                                            //     type: currentTarget.type,
                                            //     position: currentTarget.position,
                                            //     distance: currentTarget.distance,
                                            //     data: currentTarget.data
                                            // });
                                        }
                                        
                                        // console.log('[E-Tap ACTION] Harvesting resource:', currentTarget.id);
                                        previewSeaweedHarvestBlockedIfNeeded(
                                          connectionRef.current,
                                          resourceId,
                                          localPlayer?.isSnorkeling,
                                        );
                                        connectionRef.current.reducers.interactWithHarvestableResource({ resourceId });
                                        tapActionTaken = true;
                                        break;
                                    case 'dropped_item':
                                        // console.log('[E-Tap ACTION] Picking up dropped item:', currentTarget.id);
                                        connectionRef.current.reducers.pickupDroppedItem({ droppedItemId: currentTarget.id as bigint });
                                        tapActionTaken = true;
                                        break;
                                    case 'door':
                                        // Toggle door open/close state
                                        console.log('[E-Tap ACTION] Interacting with door:', currentTarget.id);
                                        connectionRef.current.reducers.interactDoor({ doorId: currentTarget.id as bigint });
                                        tapActionTaken = true;
                                        break;
                                }
                            }
                            // Handle interface opening actions for containers/interactables
                            else if (isInterfaceInteraction(currentTarget)) {
                                switch (currentTarget.type) {
                                    case 'campfire':
                                        // console.log('[E-Tap ACTION] Opening campfire interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'campfire', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'furnace':
                                        // console.log('[E-Tap ACTION] Opening furnace interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'furnace', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'barbecue':
                                        // console.log('[E-Tap ACTION] Opening barbecue interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'barbecue', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'lantern':
                                        // console.log('[E-Tap ACTION] Opening lantern interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'lantern', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'turret' as InteractionTargetType: {
                                        // Monument turrets cannot be interacted with
                                        const tapTurret = turrets?.get(String(currentTarget.id));
                                        if (tapTurret && tapTurret.isMonument) break;
                                        // console.log('[E-Tap ACTION] Opening turret interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'turret' as InteractionTargetType, id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    }
                                    case 'box':
                                        // console.log('[E-Tap ACTION] Opening box interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'wooden_storage_box', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'stash':
                                        // console.log('[E-Tap ACTION] Opening stash interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'stash', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'corpse':
                                        // Check corpse protection before opening
                                        const corpseId = currentTarget.id.toString();
                                        const corpse = playerCorpses?.get(corpseId);
                                        
                                        if (corpse && corpse.lockedUntil && localPlayer) {
                                            const now = Date.now();
                                            const lockExpires = Number(corpse.lockedUntil.microsSinceUnixEpoch / 1000n);
                                            const isOwner = corpse.playerIdentity.toHexString() === localPlayer.identity.toHexString();
                                            
                                            if (now < lockExpires && !isOwner) {
                                                // Corpse is protected and player is not the owner - play Sova sound
                                                console.log('[E-Tap ACTION] Corpse protected - playing sova_corpse_protected.mp3');
                                                const sovaAudio = new Audio('/sounds/sova_corpse_protected.mp3');
                                                sovaAudio.volume = 0.8;
                                                sovaAudio.play().catch(err => console.warn('Failed to play corpse protection sound:', err));
                                                tapActionTaken = true;
                                                break;
                                            }
                                        }
                                        
                                        // console.log('[E-Tap ACTION] Opening corpse interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'player_corpse', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'sleeping_bag':
                                        //  console.log('[E-Tap ACTION] Opening sleeping bag interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'sleeping_bag', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'rain_collector':
                                        // console.log('[E-Tap ACTION] Opening rain collector interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'rain_collector', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'homestead_hearth':
                                        // console.log('[E-Tap ACTION] Opening hearth interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'homestead_hearth', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'fumarole':
                                        // console.log('[E-Tap ACTION] Opening fumarole interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'fumarole', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'broth_pot':
                                        // console.log('[E-Tap ACTION] Opening broth pot interface:', currentTarget.id);
                                        onSetInteractingWith({ type: 'broth_pot', id: currentTarget.id });
                                        tapActionTaken = true;
                                        break;
                                    case 'alk_station':
                                        // Check if panel was just closed to prevent immediate reopen
                                        if (!wasAlkPanelJustClosed()) {
                                            // console.log('[E-Tap ACTION] Opening ALK station interface:', currentTarget.id);
                                            onSetInteractingWith({ type: 'alk_station', id: currentTarget.id });
                                            tapActionTaken = true;
                                        } else {
                                            console.log('[E-Tap ACTION] Skipping ALK station open - panel was just closed');
                                            tapActionTaken = true; // Still mark as taken to prevent other actions
                                        }
                                        break;
                                    // Note: cairn is handled in isTapInteraction block above, not here
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

                        // console.log('[E-KeyUp] TAP processing complete. Action taken:', tapActionTaken);
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
                // console.log('[InputHandler] Mouse input blocked - chat focused:', { 
                //     isChatting, 
                //     isChatInputFocused,
                //     targetTag: target?.tagName,
                //     targetDataAttr: target?.getAttribute('data-is-chat-input')
                // });
                
                // If user is trying to left-click but chat input is blocking, try to clear focus
                // Only clear if not actively searching in crafting recipes
                if (event.button === 0 && isChatInputFocused && !isChatting && !isSearchingCraftRecipes) {
                    // console.log('[InputHandler] Attempting to clear stuck chat input focus on mouse click');
                    forceClearInputFocus();
                }
                
                return;
            }

            if (event.button === 0) { // Left Click
                // 🎣 FISHING INPUT FIX: Disable left mouse button actions while fishing
                if (isFishing) {
                    // console.log('[Input] Left mouse blocked - player is fishing');
                    event.preventDefault();
                    return;
                }
                
                // Normal left click logic for attacks, interactions, etc.
                inputRuntime.setIsMouseDown(true);

                const localPlayerActiveEquipment = localPlayerId ? activeEquipmentsRef.current?.get(localPlayerId) : undefined;
                // console.log("[InputHandler DEBUG MOUSEDOWN] localPlayerId:", localPlayerId, "activeEquip:", !!localPlayerActiveEquipment, "itemDefs:", !!itemDefinitionsRef.current);

                if (localPlayerActiveEquipment?.equippedItemDefId && itemDefinitionsRef.current) {
                    const equippedItemDef = itemDefinitionsRef.current.get(String(localPlayerActiveEquipment.equippedItemDefId));
                    //  console.log("[InputHandler DEBUG MOUSEDOWN] Equipped item Def (raw object): ", equippedItemDef);

                    if (equippedItemDef) {
                        // console.log("[InputHandler DEBUG MOUSEDOWN] Equipped item name: ", equippedItemDef.name, "Category tag:", equippedItemDef.category?.tag);

                        // 1. Ranged Weapon Firing (unified path: click + auto-fire share attemptRangedFire)
                        if (equippedItemDef.category?.tag === "RangedWeapon") {
                            attemptRangedFire();
                            return; // Ranged weapon logic handled
                        }
                        // 2. Torch: Prevent left-click swing   
                        else if (equippedItemDef.name === "Torch") {
                            // console.log("[InputHandler MOUSEDOWN] Torch equipped. Left-click does nothing (use Right-Click to toggle).");
                            return; // Torch has no default left-click action here
                        }
                        // 2b. Broken Lighter: Prevent left-click (right-click only plays sound)
                        else if (equippedItemDef.name === "Broken Lighter") {
                            return;
                        }
                        // 3. Medical consumables: Prevent left-click swing (handled by right-click)
                        else if (
                            equippedItemDef.name === "Bandage" ||
                            equippedItemDef.name === "Med Kit" ||
                            equippedItemDef.name === "Jellyfish Compress" ||
                            equippedItemDef.name === "Selo Olive Oil"
                        ) {
                            // console.log("[InputHandler MOUSEDOWN] Medical consumable equipped. Left-click does nothing. Use Right-Click.");
                            return;
                        }
                                                // 5. Water Containers: Prevent left-click pouring while on water, only allow crop watering
                        else if (isWaterContainer(equippedItemDef.name) && localPlayerActiveEquipment.equippedItemInstanceId) {
                            // console.log('[InputHandler] Left-click with water container');
                            
                            // Get the water container item first
                            const waterContainer = inventoryItems.get(localPlayerActiveEquipment.equippedItemInstanceId.toString());
                            if (!waterContainer || !connectionRef.current?.reducers) {
                                // console.log('[InputHandler] No water container found or no connection');
                                return;
                            }
                            
                            // Prevent left-click actions while on water tiles to avoid race conditions
                            if (localPlayerRef.current?.isOnWater) {
                                // console.log('[InputHandler] Player is on water - left-click disabled for water containers (use F key to fill)');
                                return;
                            } else {
                                // console.log('[InputHandler] Player not on water - checking for crop watering');
                                // Not on water - check if container has water for watering crops
                                if (hasWaterContent(waterContainer)) {
                                    // console.log("[InputHandler] Water container with water equipped. Calling water_crops reducer.");
                                    // Watering is a discrete click action. Do not leave mouse-down active,
                                    // or the frame loop will also swing/use the bottle while held.
                                    inputRuntime.setIsMouseDown(false);
                                    connectionRef.current.reducers.waterCrops({ containerInstanceId: localPlayerActiveEquipment.equippedItemInstanceId })
                                        .catch((err: unknown) => {
                                            const message = getReducerErrorMessage(err);
                                            if (message.toLowerCase().includes('already water at that location')) {
                                                return;
                                            }
                                            console.warn('[InputHandler] Failed to water crops:', message);
                                        });
                                    return;
                                } else {
                                    // console.log('[InputHandler] No water content - falling through to normal swing behavior');
                                }
                                // If no water content, fall through to normal swing behavior
                            }
                        }
                        // 6. Fertilizer: Apply to nearby crops on left-click
                        else if (equippedItemDef.name === "Fertilizer" && localPlayerActiveEquipment.equippedItemInstanceId) {
                            console.log('[InputHandler] Left-click with fertilizer');
                            
                            // Get the fertilizer item
                            const fertilizerItem = inventoryItems.get(localPlayerActiveEquipment.equippedItemInstanceId.toString());
                            if (!fertilizerItem || !connectionRef.current?.reducers) {
                                console.log('[InputHandler] No fertilizer found or no connection', {
                                    fertilizerItem: !!fertilizerItem,
                                    hasReducers: !!connectionRef.current?.reducers,
                                    instanceId: localPlayerActiveEquipment.equippedItemInstanceId?.toString()
                                });
                                return;
                            }
                            
                            // Check if fertilizer has quantity
                            if (fertilizerItem.quantity > 0) {
                                console.log("[InputHandler] Fertilizer equipped. Calling apply_fertilizer reducer.", {
                                    instanceId: localPlayerActiveEquipment.equippedItemInstanceId.toString(),
                                    quantity: fertilizerItem.quantity
                                });
                                try {
                                    connectionRef.current.reducers.applyFertilizer({ fertilizerInstanceId: localPlayerActiveEquipment.equippedItemInstanceId });
                                    console.log("[InputHandler] Successfully called applyFertilizer reducer");
                                    return;
                                } catch (err) {
                                    console.error("[InputHandler] Error applying fertilizer:", err);
                                    return;
                                }
                            } else {
                                console.log('[InputHandler] Fertilizer bag is empty');
                                return;
                            }
                        }
                        // If none of the above special cases, fall through to default item use (melee/tool)
                    } else {
                        // console.log("[InputHandler DEBUG MOUSEDOWN] Equipped item definition NOT FOUND for ID:", localPlayerActiveEquipment.equippedItemDefId);
                        // Fall through to default unarmed action if item def is missing
                    }
                }

                // Default action for other items (tools, melee weapons) or if unarmed
                // ⚠️ FIX: Use attemptSwing() which has proper cooldown checks
                // Previously this block called registerLocalPlayerSwing() + useEquippedItem() without
                // checking cooldowns, causing animations to play even when server rejected the attack
                attemptSwing();
            } else if (event.button === 2) { // Right Click
                if (isPlayerDead) return;
                if (isInventoryOpen) return;

                // console.log("[InputHandler] Right mouse button pressed");
                inputRuntime.setIsRightMouseDown(true);

                // ADDED: Check for Blueprint on right mouse down
                const localPlayerActiveEquipment = localPlayerId ? activeEquipmentsRef.current?.get(localPlayerId) : undefined;
                if (localPlayerActiveEquipment?.equippedItemDefId && itemDefinitionsRef.current) {
                    const equippedItemDef = itemDefinitionsRef.current.get(String(localPlayerActiveEquipment.equippedItemDefId));
                    if (equippedItemDef?.name === "Blueprint") {
                        // Clear upgrade menu if it's showing (switching from hammer to blueprint)
                        if (showUpgradeRadialMenu) {
                            setShowUpgradeRadialMenu(false);
                            inputRuntime.setUpgradeMenuFoundationId(null);
                            inputRuntime.setRadialMenuShown(false);
                        }
                        // Don't show menu if it's already showing (prevent flickering)
                        if (showBuildingRadialMenu || inputRuntime.isRadialMenuShown()) {
                            return;
                        }
                        // Get mouse position for radial menu
                        const mouseX = event.clientX;
                        const mouseY = event.clientY;
                        setRadialMenuMouseX(mouseX);
                        setRadialMenuMouseY(mouseY);
                        // Show menu after a short delay to allow for drag detection
                        inputRuntime.clearRadialMenuTimeout();
                        console.log('[BuildingRadialMenu] Right-click detected with Blueprint, setting up menu at', mouseX, mouseY);
                        inputRuntime.setRadialMenuTimeout(() => {
                            console.log('[BuildingRadialMenu] Timeout fired, isRightMouseDown:', inputRuntime.getIsRightMouseDown());
                            if (inputRuntime.getIsRightMouseDown()) {
                                console.log('[BuildingRadialMenu] Showing radial menu');
                                inputRuntime.setRadialMenuShown(true);
                                setShowBuildingRadialMenu(true);
                            }
                        }, 100); // 100ms delay before showing menu
                        return;
                    }
                    // ADDED: Check for Repair Hammer on right mouse down
                    // Prioritize walls over foundations - check walls first
                    if (equippedItemDef?.name === "Repair Hammer") {
                        const currentBuildTargeting = buildTargetingRefInternal?.current;
                        const currentTargetedWall = currentBuildTargeting?.targetedWall ?? targetedWallRef.current;
                        const currentTargetedFence = currentBuildTargeting?.targetedFence ?? targetedFenceRef.current;
                        const currentTargetedFoundation = currentBuildTargeting?.targetedFoundation ?? targetedFoundationRef.current;
                        // Check for targeted wall first
                        if (currentTargetedWall) {
                            // Don't show menu if it's already showing (prevent flickering)
                            if (showBuildingRadialMenu) {
                                setShowBuildingRadialMenu(false);
                                inputRuntime.setRadialMenuShown(false);
                            }
                            if (showUpgradeRadialMenu || inputRuntime.isRadialMenuShown()) {
                                return;
                            }
                            // Store the wall ID so menu stays open even if targetedWall changes
                            inputRuntime.setUpgradeMenuWallId(currentTargetedWall.id);
                            // Get mouse position for upgrade radial menu
                            const mouseX = event.clientX;
                            const mouseY = event.clientY;
                            setRadialMenuMouseX(mouseX);
                            setRadialMenuMouseY(mouseY);
                            // Show menu after a short delay to allow for drag detection
                            inputRuntime.clearRadialMenuTimeout();
                            console.log('[UpgradeRadialMenu] Right-click detected with Repair Hammer on wall, setting up menu at', mouseX, mouseY);
                            inputRuntime.setRadialMenuTimeout(() => {
                                if (inputRuntime.getIsRightMouseDown() && inputRuntime.getUpgradeMenuWallId() !== null) {
                                    console.log('[UpgradeRadialMenu] Showing upgrade radial menu for wall');
                                    inputRuntime.setRadialMenuShown(true);
                                    setShowUpgradeRadialMenu(true);
                                } else {
                                    // Clear the wall ID if menu didn't show
                                    inputRuntime.setUpgradeMenuWallId(null);
                                }
                            }, 100);
                            return;
                        }
                        // Check for targeted fence
                        else if (currentTargetedFence) {
                            // Don't show menu if it's already showing (prevent flickering)
                            if (showBuildingRadialMenu) {
                                setShowBuildingRadialMenu(false);
                                inputRuntime.setRadialMenuShown(false);
                            }
                            if (showUpgradeRadialMenu || inputRuntime.isRadialMenuShown()) {
                                return;
                            }
                            // Store the fence ID so menu stays open even if targetedFence changes
                            inputRuntime.setUpgradeMenuFenceId(currentTargetedFence.id);
                            // Get mouse position for upgrade radial menu
                            const mouseX = event.clientX;
                            const mouseY = event.clientY;
                            setRadialMenuMouseX(mouseX);
                            setRadialMenuMouseY(mouseY);
                            // Show menu after a short delay to allow for drag detection
                            inputRuntime.clearRadialMenuTimeout();
                            console.log('[UpgradeRadialMenu] Right-click detected with Repair Hammer on fence, setting up menu at', mouseX, mouseY);
                            inputRuntime.setRadialMenuTimeout(() => {
                                if (inputRuntime.getIsRightMouseDown() && inputRuntime.getUpgradeMenuFenceId() !== null) {
                                    console.log('[UpgradeRadialMenu] Showing upgrade radial menu for fence');
                                    inputRuntime.setRadialMenuShown(true);
                                    setShowUpgradeRadialMenu(true);
                                } else {
                                    // Clear the fence ID if menu didn't show
                                    inputRuntime.setUpgradeMenuFenceId(null);
                                }
                            }, 100);
                            return;
                        }
                        // Fall back to foundation if no wall or fence is targeted
                        else if (currentTargetedFoundation) {
                            // Don't show menu if it's already showing (prevent flickering)
                            if (showBuildingRadialMenu) {
                                setShowBuildingRadialMenu(false);
                                inputRuntime.setRadialMenuShown(false);
                            }
                            if (showUpgradeRadialMenu || inputRuntime.isRadialMenuShown()) {
                                return;
                            }
                            // Store the foundation ID so menu stays open even if targetedFoundation changes
                            inputRuntime.setUpgradeMenuFoundationId(currentTargetedFoundation.id);
                            // Get mouse position for upgrade radial menu
                            const mouseX = event.clientX;
                            const mouseY = event.clientY;
                            setRadialMenuMouseX(mouseX);
                            setRadialMenuMouseY(mouseY);
                            // Show menu after a short delay to allow for drag detection
                            inputRuntime.clearRadialMenuTimeout();
                            console.log('[UpgradeRadialMenu] Right-click detected with Repair Hammer on foundation, setting up menu at', mouseX, mouseY);
                            inputRuntime.setRadialMenuTimeout(() => {
                                if (inputRuntime.getIsRightMouseDown() && inputRuntime.getUpgradeMenuFoundationId() !== null) {
                                    console.log('[UpgradeRadialMenu] Showing upgrade radial menu for foundation');
                                    inputRuntime.setRadialMenuShown(true);
                                    setShowUpgradeRadialMenu(true);
                                } else {
                                    // Clear the foundation ID if menu didn't show
                                    inputRuntime.setUpgradeMenuFoundationId(null);
                                }
                            }, 100);
                            return;
                        }
                    }
                }
                
                // Normal right-click logic for context menu, etc.
            }
        };

        const handleMouseUp = (event: MouseEvent) => {
            // Handle both left and right mouse button releases
            if (event.button === 0) { // Left mouse
                inputRuntime.setIsMouseDown(false);
                
                // ADDED: Close radial menu on left click
                if (showBuildingRadialMenu) {
                    setShowBuildingRadialMenu(false);
                    inputRuntime.setRadialMenuShown(false);
                }
                // Upgrade menu handles its own clicks - don't close it here
                // It will close itself when clicking outside
            } else if (event.button === 2) { // Right mouse
                inputRuntime.setIsRightMouseDown(false);
                
                // ADDED: Close radial menu on right mouse release (menu component will handle selection before this)
                if (showBuildingRadialMenu) {
                    // Small delay to let menu component handle selection first
                    setTimeout(() => {
                        setShowBuildingRadialMenu(false);
                        inputRuntime.setRadialMenuShown(false);
                    }, 50);
                }
                // Close upgrade menu on right mouse release (same as blueprint)
                if (showUpgradeRadialMenu) {
                    // Clear the stored IDs
                    inputRuntime.clearUpgradeMenuTargetIds();
                    // Small delay to let menu component handle selection first
                    setTimeout(() => {
                        setShowUpgradeRadialMenu(false);
                        inputRuntime.setRadialMenuShown(false);
                    }, 50);
                }
                // Only clear timeout if menu wasn't shown yet (user released before delay)
                if (inputRuntime.hasRadialMenuTimeout() && !inputRuntime.isRadialMenuShown()) {
                    inputRuntime.clearPendingRadialMenu();
                }
            }
        };

        // --- Canvas Click for Placement ---
        const handleCanvasClick = (event: MouseEvent) => {
            if (isPlayerDead) return;

            // Profiler Record button hit test (must run before other handlers)
            if (onProfilerRecordClick && canvasRef?.current) {
                const canvas = canvasRef.current;
                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                const canvasX = (event.clientX - rect.left) * scaleX;
                const canvasY = (event.clientY - rect.top) * scaleY;
                if (onProfilerRecordClick(canvasX, canvasY)) {
                    event.preventDefault();
                    return;
                }
            }

            // 🎣 FISHING INPUT FIX: Disable canvas click actions while fishing
            if (isFishing) {
                // console.log('[Input] Canvas click blocked - player is fishing');
                event.preventDefault();
                return;
            }

            // ADDED: Handle building placement first
            if (buildingStateRef.current?.isBuilding && buildingActionsRef.current && worldMousePosRefInternal.current.x !== null && worldMousePosRefInternal.current.y !== null) {
                buildingActionsRef.current.attemptPlacement(worldMousePosRefInternal.current.x, worldMousePosRefInternal.current.y);
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

            // Use existing refs directly — skip canvas `click` for weapons/tools (same as ranged):
            // `mousedown` already calls attemptSwing / attemptRangedFire, and the game loop repeats while held.
            if (connectionRef.current?.reducers && localPlayerId && localPlayerRef.current && activeEquipmentsRef.current && itemDefinitionsRef.current && worldMousePosRefInternal.current.x !== null && worldMousePosRefInternal.current.y !== null) {
                const localEquipment = activeEquipmentsRef.current.get(localPlayerId);
                const currentPlayer = localPlayerRef.current;
                if (localEquipment?.equippedItemDefId && currentPlayer) {
                    const itemDef = itemDefinitionsRef.current.get(String(localEquipment.equippedItemDefId));

                    if (itemDef && (itemDef.name === "Hunting Bow" || itemDef.category === ItemCategory.RangedWeapon)) {
                        return;
                    }
                    // Any melee / tool / torch etc.: avoid click+mousedown duplicate reducer + double SFX/shake.
                    return;
                }
                // Unarmed: mousedown path already swings; skip duplicate click dispatch.
                return;
            }

            attemptSwing();
        };

        // --- Context Menu for Placement Cancellation ---
        const handleContextMenu = (event: MouseEvent) => {
            if (isPlayerDead) return;
            if (isInventoryOpen) return;

            // 🎣 FISHING INPUT FIX: Disable context menu actions while fishing
            if (isFishing) {
                // console.log('[Input] Context menu blocked - player is fishing');
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
                            connectionRef.current.reducers.loadRangedWeapon({});
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
                            connectionRef.current.reducers.toggleTorch({});
                        } else {
                            console.warn("[InputHandler CTXMENU] No connection or reducers to call toggleTorch.");
                        }
                        return;
                    } else if (equippedItemDef.name === "Flashlight") {
                        // Flashlight right-click to toggle on/off (same as torch)
                        event.preventDefault();
                        if (connectionRef.current?.reducers) {
                            console.log("[InputHandler CTXMENU] Calling toggleFlashlight reducer.");
                            connectionRef.current.reducers.toggleFlashlight({});
                        } else {
                            console.warn("[InputHandler CTXMENU] No connection or reducers to call toggleFlashlight.");
                        }
                        return;
                    } else if (equippedItemDef.name === "Broken Lighter") {
                        // Broken Lighter right-click: play flick sound only (client-side, no server call)
                        event.preventDefault();
                        const audio = new Audio('/sounds/light_lighter.mp3');
                        audio.play().catch(err => console.warn('Failed to play lighter sound:', err));
                        return;
                    } else if (equippedItemDef.name === "Blueprint") {
                        // ADDED: Blueprint right-click - prevent context menu, radial menu is handled in mousedown
                        event.preventDefault();
                        return;
                    } else if (equippedItemDef.name === "Repair Hammer") {
                        // ADDED: Repair Hammer right-click - prevent context menu and throwing
                        // Upgrade radial menu is handled in mousedown
                        // Always prevent context menu when Repair Hammer is equipped
                        event.preventDefault();
                        return;
                    } else if (equippedItemDef.name === "Bandage") {
                        // console.log("[InputHandler CTXMENU] Bandage equipped. Attempting to use.");
                        event.preventDefault();
                        if (connectionRef.current?.reducers) {
                            // console.log("[InputHandler CTXMENU] Calling useEquippedItem for Bandage.");
                            // 🔊 IMMEDIATE SOUND: Play button click for bandage use
                            // playButtonClickSound(0.6);
                            connectionRef.current.reducers.useEquippedItem({})
                                .catch((err: unknown) => {
                                    console.warn('[InputHandler CTXMENU] Bandage use failed:', getReducerErrorMessage(err));
                                });
                        } else {
                            console.warn("[InputHandler CTXMENU] No connection or reducers to call useEquippedItem for Bandage.");
                        }
                        return;
                    } else if (equippedItemDef.name === "Selo Olive Oil" || equippedItemDef.name === "Med Kit" || equippedItemDef.name === "Jellyfish Compress") {
                        // console.log("[InputHandler CTXMENU] Medical consumable equipped. Attempting to use.");
                        event.preventDefault();
                        if (connectionRef.current?.reducers) {
                            // console.log("[InputHandler CTXMENU] Calling useEquippedItem for Selo Olive Oil / Med Kit.");
                            // 🔊 IMMEDIATE SOUND: Play button click for consumable use
                            // playButtonClickSound(0.6);
                            connectionRef.current.reducers.useEquippedItem({})
                                .catch((err: unknown) => {
                                    console.warn('[InputHandler CTXMENU] Medical consumable use failed:', getReducerErrorMessage(err));
                                });
                        } else {
                            console.warn("[InputHandler CTXMENU] No connection or reducers to call useEquippedItem for Selo Olive Oil / Med Kit.");
                        }
                        return;
                    } else if (equippedItemDef.name === "Reed Water Bottle" || equippedItemDef.name === "Plastic Water Jug") {
                        // console.log("[InputHandler] Right-click with water container - attempting to drink");
                        event.preventDefault();
                        
                        // Find the equipped item instance to check if it has water
                        const equippedItemInstance = Array.from(inventoryItems.values()).find((item: InventoryItem) => 
                            item.instanceId === BigInt(localPlayerActiveEquipment?.equippedItemInstanceId || 0)
                        );
                        
                        // console.log(`[InputHandler] Found equipped item instance:`, !!equippedItemInstance);
                        // console.log(`[InputHandler] Has water content:`, equippedItemInstance ? hasWaterContent(equippedItemInstance) : false);
                        
                        if (equippedItemInstance && hasWaterContent(equippedItemInstance)) {
                            if (connectionRef.current?.reducers && localPlayerActiveEquipment?.equippedItemInstanceId) {
                                // console.log("[InputHandler] Calling consumeFilledWaterContainer for equipped water container.");
                                try {
                                    connectionRef.current.reducers.consumeFilledWaterContainer({ itemInstanceId: localPlayerActiveEquipment.equippedItemInstanceId });
                                    // console.log("[InputHandler] Successfully called consumeFilledWaterContainer");
                                } catch (err) {
                                    console.error("[InputHandler] Error calling consumeFilledWaterContainer:", err);
                                }
                            } else {
                                console.warn("[InputHandler] No connection or reducers to call consumeFilledWaterContainer for water container.");
                            }
                        } else {
                            // console.log("[InputHandler] Water container is empty, cannot drink.");
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

            if (placementInfo) {
                // console.log("[InputHandler CTXMENU] Right-click during placement - cancelling placement.");
                event.preventDefault();
                placementActionsRef.current?.cancelPlacement();
            }
            
            // REMOVED: Cancel building mode on right-click - interferes with radial menu flow
            
            // ADDED: Hide radial menu on context menu
            if (showBuildingRadialMenu) {
                event.preventDefault();
                inputRuntime.setRadialMenuShown(false);
                setShowBuildingRadialMenu(false);
            }
            // Prevent context menu when upgrade menu is showing (but don't close it)
            if (showUpgradeRadialMenu) {
                event.preventDefault();
                return;
            }
        };

        // --- Wheel for Placement Cancellation (optional) ---
        const handleWheel = (event: WheelEvent) => {
            // Don't interfere with scrolling when game menus are open
            if (isGameMenuOpen) {
                return; // Let menus handle their own scrolling
            }

            // ADDED: Cycle foundation shapes when in building mode
            if (buildingStateRef.current?.isBuilding && buildingActionsRef.current) {
                event.preventDefault();
                const direction = event.deltaY > 0 ? 'next' : 'prev';
                buildingActionsRef.current.cycleFoundationShape(direction);
                return;
            }

            if (placementInfo) {
                placementActionsRef.current?.cancelPlacement();
            }
        };

        // --- Blur Handler ---
        const handleBlur = () => {
            // console.log(`[E-Timer] *** WINDOW BLUR CLEARING TIMER *** Timer ID: ${inputRuntime.getEHoldTimerDebugValue()}`);
            // REMOVED Sprinting logic from blur handler.
            inputRuntime.resetPointerAndJumpState();
            inputRuntime.setIsRightMouseDown(false);

            inputRuntime.cancelEHoldInteraction();
            // NOTE: Auto-attack (Z) intentionally NOT cleared on blur
            // This allows auto-attack to persist through tab-outs for AFK harvesting
        };
        
        // Utility function to force clear all input focus (called when needed)
        const forceClearInputFocus = () => {
            const activeEl = document.activeElement as HTMLElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('data-is-chat-input'))) {
                // console.log('[InputHandler] Force clearing input focus from:', activeEl.tagName, activeEl.getAttribute('data-is-chat-input'));
                activeEl.blur();
                document.body.focus();
                // Small delay to ensure focus change is processed
                setTimeout(() => {
                    if (document.activeElement === activeEl) {
                        // console.log('[InputHandler] Secondary force focus clear');
                        document.body.focus();
                    }
                }, 100);
            }
        };

        const domEventHandlers = {
            onKeyDown: handleKeyDown,
            onKeyUp: handleKeyUp,
            onMouseDown: handleMouseDown,
            onMouseUp: handleMouseUp,
            onWheel: handleWheel,
            onContextMenu: handleContextMenu,
            onWindowBlur: handleBlur,
            onCanvasClick: handleCanvasClick,
        };
        inputRuntime.configureDomEventHandlers(domEventHandlers);

        // Cleanup
        return () => {
            inputRuntime.clearDomEventHandlers(domEventHandlers);
        };
    }, [canvasRef, inputRuntime, localPlayer?.isDead, placementInfo, jump, attemptSwing, setIsMinimapOpen, isChatting, isSearchingCraftRecipes, isInventoryOpen, isGameMenuOpen, isFishing, movementDirection, onProfilerRecordClick]);

    // Auto-walk functionality removed - movement handled by usePredictedMovement hook

    // --- Function to process inputs and call actions (called by game loop) ---
    const processInputsAndActions = useCallback(() => {
        inputRuntime.processFrameActions({
            currentConnection: connectionRef.current,
            localPlayerId,
            currentLocalPlayer: localPlayerRef.current,
            currentActiveEquipments: activeEquipmentsRef.current,
            itemDefinitions: itemDefinitionsRef.current,
            rangedWeaponStats: rangedWeaponStatsRef.current,
            optimisticJumpPressMsRef: jumpOptRef,
            placementInfo,
            isChatting,
            isSearchingCraftRecipes,
            isAutoAttacking,
            isActivelyHolding,
            interactionProgress,
            isFishing,
            attemptSwing,
            attemptRangedFire,
        });
    }, [
        attemptSwing,
        attemptRangedFire,
        inputRuntime,
        isActivelyHolding,
        isAutoAttacking,
        isChatting,
        isFishing,
        isSearchingCraftRecipes,
        localPlayerId,
        placementInfo,
        interactionProgress,
    ]);

    useEffect(() => {
        inputRuntime.setProcessInputsAndActions(processInputsAndActions);
    }, [inputRuntime, processInputsAndActions]);

    // ADDED: Helper function to check if Blueprint is equipped
    const isBlueprintEquipped = useCallback(() => {
        if (!localPlayerId || !activeEquipmentsRef.current || !itemDefinitionsRef.current) return false;
        const equipment = activeEquipmentsRef.current.get(localPlayerId);
        if (!equipment?.equippedItemDefId) return false;
        const itemDef = itemDefinitionsRef.current.get(String(equipment.equippedItemDefId));
        return itemDef?.name === 'Blueprint';
    }, [localPlayerId]);

    // ADDED: Only show radial menu if Blueprint is equipped
    const shouldShowRadialMenu = showBuildingRadialMenu && isBlueprintEquipped();

    // --- Return State & Actions ---
    return {
        interactionProgress,
        isActivelyHolding,
        currentJumpOffsetY: inputRuntime.getCurrentJumpOffsetY(),
        isAutoAttacking,
        isCrouching, // Include local crouch state
        // ADDED: Building radial menu state
        showBuildingRadialMenu: shouldShowRadialMenu,
        radialMenuMouseX,
        radialMenuMouseY,
        setShowBuildingRadialMenu, // Expose setter so parent can close menu
        showUpgradeRadialMenu,
        setShowUpgradeRadialMenu,
        optimisticProjectiles,
        processInputsAndActions,
    };
}; 
