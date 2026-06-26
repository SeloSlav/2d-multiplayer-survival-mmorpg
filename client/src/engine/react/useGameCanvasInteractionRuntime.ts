import { useCallback, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { useInputHandler } from '../../hooks/useInputHandler';
import { getInteractableLabel } from '../../utils/interactionLabelUtils';
import type { InteractableTarget } from '../../types/interactions';
import { getRecordButtonBounds } from '../../utils/profiler';
import type { GameCanvasInputRuntime } from '../runtime/gameCanvasInputRuntime';
import type { InteractionTargetRuntimeResult } from '../runtime/interactionTargetRuntime';

function getUnifiedInteractionTarget(result: InteractionTargetRuntimeResult): InteractableTarget | null {
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

interface UseGameCanvasInteractionRuntimeOptions {
  localPlayer: any;
  predictedPosition: { x: number; y: number } | null;
  getCurrentPositionNow: () => { x: number; y: number } | null;
  campfires: Map<string, any>;
  furnaces: Map<string, any>;
  barbecues: Map<string, any>;
  fumaroles: Map<string, any>;
  lanterns: Map<string, any>;
  visibleTurretsMap: Map<string, any>;
  homesteadHearths: Map<string, any>;
  droppedItems: Map<string, any>;
  woodenStorageBoxes: Map<string, any>;
  playerCorpses: Map<string, any>;
  stashes: Map<string, any>;
  sleepingBags: Map<string, any>;
  players: Map<string, any>;
  shelters: Map<string, any>;
  connection: any | null;
  inventoryItems: Map<string, any>;
  itemDefinitions: Map<string, any>;
  playerDrinkingCooldowns: Map<string, any>;
  rainCollectors: Map<string, any>;
  brothPots: Map<string, any>;
  doors: Map<string, any>;
  visibleAlkStationsMap: Map<string, any>;
  cairns: Map<string, any>;
  harvestableResources: Map<string, any>;
  visibleWorldTiles: Map<string, any>;
  wildAnimals: Map<string, any>;
  caribouBreedingData: Map<string, any>;
  walrusBreedingData: Map<string, any>;
  worldState: any;
  showFpsProfiler: boolean;
  isProfilerRecording: boolean;
  canvasWidth: number;
  startProfilerRecording?: () => void;
  stopProfilerRecording?: () => Promise<boolean>;
  onProfilerCopied?: () => void;
  onDodgeRollStart?: (moveX: number, moveY: number) => void;
  localOptimisticDodgeRollStartMsRef: MutableRefObject<number>;
  localOptimisticJumpPressMsRef: MutableRefObject<number>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  activeEquipments: Map<string, any>;
  placementInfo: any;
  placementActions: any;
  buildingState: any;
  buildingActions: any;
  worldMousePos: { x: number | null; y: number | null };
  worldMousePosRef?: MutableRefObject<{ x: number | null; y: number | null }>;
  interactionTargetRef: MutableRefObject<InteractionTargetRuntimeResult>;
  visibleTreesMap: Map<string, any>;
  visibleStonesMap: Map<string, any>;
  visibleLivingCoralsMap: Map<string, any>;
  visibleBarrelsMap: Map<string, any>;
  visibleAnimalCorpsesMap: Map<string, any>;
  visibleWildAnimalsMap: Map<string, any>;
  playerDiscoveredCairns: Map<string, any>;
  addSOVAMessage?: (message: any) => void;
  showSovaSoundBox?: (audio: HTMLAudioElement, label: string) => void;
  onCairnNotification?: (notification: any) => void;
  onSetInteractingWith: (target: any | null) => void;
  isMinimapOpen: boolean;
  setIsMinimapOpen: Dispatch<SetStateAction<boolean>>;
  isChatting: boolean;
  showInventory: boolean;
  isGameMenuOpen: boolean;
  isSearchingCraftRecipes?: boolean;
  isFishing: boolean;
  setMusicPanelVisible: React.Dispatch<React.SetStateAction<boolean>>;
  movementDirection: { x: number; y: number };
  isAutoWalking: boolean;
  targetedFoundation: any | null;
  targetedWall: any | null;
  targetedFence: any | null;
  buildTargetingRef?: MutableRefObject<{
    targetedFoundation: any | null;
    targetedWall: any | null;
    targetedFence: any | null;
  }>;
  rangedWeaponStats?: Map<string, any>;
  projectiles: Map<string, any>;
  isMobile?: boolean;
  onMobileInteractInfoChange?: (info: { hasTarget: boolean; label?: string } | null) => void;
  mobileInteractTrigger?: number;
  showError: (message: string) => void;
  inputRuntime: GameCanvasInputRuntime;
}

export function useGameCanvasInteractionRuntime(options: UseGameCanvasInteractionRuntimeOptions) {
  const {
    showFpsProfiler,
    isProfilerRecording,
    canvasWidth,
    startProfilerRecording,
    stopProfilerRecording,
    onProfilerCopied,
  } = options;

  const onProfilerRecordClick = useCallback((canvasX: number, canvasY: number): boolean => {
    if (!showFpsProfiler || !startProfilerRecording || !stopProfilerRecording) return false;
    const bounds = getRecordButtonBounds(canvasWidth);
    if (!bounds) return false;
    const { x, y, w, h } = bounds;
    if (canvasX < x || canvasX > x + w || canvasY < y || canvasY > y + h) return false;
    if (isProfilerRecording) {
      stopProfilerRecording().then((ok) => {
        if (ok) onProfilerCopied?.();
      });
    } else {
      startProfilerRecording();
    }
    return true;
  }, [showFpsProfiler, isProfilerRecording, canvasWidth, startProfilerRecording, stopProfilerRecording, onProfilerCopied]);

  const interactionTargetResult = options.interactionTargetRef.current;
  const unifiedInteractableTarget = getUnifiedInteractionTarget(interactionTargetResult);

  const handleDodgeRollStart = useCallback((moveX: number, moveY: number) => {
    options.localOptimisticDodgeRollStartMsRef.current = Date.now();
    options.onDodgeRollStart?.(moveX, moveY);
  }, [options]);

  const inputState = useInputHandler({
    canvasRef: options.canvasRef,
    connection: options.connection,
    localPlayerId: options.localPlayer?.identity?.toHexString(),
    localPlayer: options.localPlayer,
    predictedPosition: options.predictedPosition,
    getCurrentPositionNow: options.getCurrentPositionNow,
    onDodgeRollStart: handleDodgeRollStart,
    localOptimisticJumpPressMsRef: options.localOptimisticJumpPressMsRef,
    activeEquipments: options.activeEquipments,
    itemDefinitions: options.itemDefinitions,
    inventoryItems: options.inventoryItems,
    placementInfo: options.placementInfo,
    placementActions: options.placementActions,
    buildingState: options.buildingState,
    buildingActions: options.buildingActions,
    worldMousePos: options.worldMousePos,
    worldMousePosRef: options.worldMousePosRef,
    closestInteractableTarget: unifiedInteractableTarget,
    interactionTargetRef: options.interactionTargetRef,
    trees: options.visibleTreesMap,
    stones: options.visibleStonesMap,
    livingCorals: options.visibleLivingCoralsMap,
    barrels: options.visibleBarrelsMap,
    animalCorpses: options.visibleAnimalCorpsesMap,
    wildAnimals: options.visibleWildAnimalsMap,
    woodenStorageBoxes: options.woodenStorageBoxes,
    turrets: options.visibleTurretsMap,
    stashes: options.stashes,
    players: options.players,
    cairns: options.cairns,
    playerDiscoveredCairns: options.playerDiscoveredCairns,
    playerCorpses: options.playerCorpses,
    addSOVAMessage: options.addSOVAMessage,
    showSovaSoundBox: options.showSovaSoundBox,
    onCairnNotification: options.onCairnNotification,
    onSetInteractingWith: options.onSetInteractingWith,
    isMinimapOpen: options.isMinimapOpen,
    setIsMinimapOpen: options.setIsMinimapOpen,
    isChatting: options.isChatting,
    isInventoryOpen: options.showInventory,
    isGameMenuOpen: options.isGameMenuOpen,
    isSearchingCraftRecipes: options.isSearchingCraftRecipes,
    isFishing: options.isFishing,
    setMusicPanelVisible: options.setMusicPanelVisible,
    movementDirection: options.movementDirection,
    isAutoWalking: options.isAutoWalking,
    targetedFoundation: options.targetedFoundation,
    targetedWall: options.targetedWall,
    targetedFence: options.targetedFence,
    buildTargetingRef: options.buildTargetingRef,
    rangedWeaponStats: options.rangedWeaponStats,
    serverProjectiles: options.projectiles,
    onProfilerRecordClick,
    inputRuntime: options.inputRuntime,
  });

  options.inputRuntime.configureMobileInteractionState({
    isMobile: options.isMobile,
    mobileInteractTrigger: options.mobileInteractTrigger,
    connection: options.connection,
    localPlayer: options.localPlayer,
    showError: options.showError,
    showSovaSoundBox: options.showSovaSoundBox,
    onMobileInteractInfoChange: options.onMobileInteractInfoChange,
    getTargetLabel: getInteractableLabel,
  });

  return {
    closestInteractableTarget: interactionTargetResult.closestInteractableTarget,
    closestInteractableHarvestableResourceId: interactionTargetResult.closestInteractableHarvestableResourceId,
    closestInteractableCampfireId: interactionTargetResult.closestInteractableCampfireId,
    closestInteractableDroppedItemId: interactionTargetResult.closestInteractableDroppedItemId,
    closestInteractableBoxId: interactionTargetResult.closestInteractableBoxId,
    isClosestInteractableBoxEmpty: interactionTargetResult.isClosestInteractableBoxEmpty,
    closestInteractableCorpseId: interactionTargetResult.closestInteractableCorpseId,
    closestInteractableStashId: interactionTargetResult.closestInteractableStashId,
    closestInteractableSleepingBagId: interactionTargetResult.closestInteractableSleepingBagId,
    closestInteractableDoorId: interactionTargetResult.closestInteractableDoorId,
    closestInteractableAlkStationId: interactionTargetResult.closestInteractableAlkStationId,
    closestInteractableCairnId: interactionTargetResult.closestInteractableCairnId,
    closestInteractableKnockedOutPlayerId: interactionTargetResult.closestInteractableKnockedOutPlayerId,
    closestInteractableWaterPosition: interactionTargetResult.closestInteractableWaterPosition,
    closestInteractableMilkableAnimalId: interactionTargetResult.closestInteractableMilkableAnimalId,
    unifiedInteractableTarget,
    onProfilerRecordClick,
    ...inputState,
  };
}
