import { useSyncExternalStore } from 'react';
import { useGameCanvasInteractionRuntime } from './useGameCanvasInteractionRuntime';
import type { GameCanvasRuntimeControllerSnapshot, GameCanvasRuntimeHost } from '../runtime/GameCanvasRuntimeHost';

/**
 * Temporary React adapter for canvas controller state.
 *
 * `GameCanvasRuntimeHost` now owns the mutable frame-state refs consumed by the
 * render and frame pipeline. Build/interaction logic is still hook-bound here,
 * so this adapter currently synchronizes React hook outputs into host-owned
 * controller state while the remaining controller services are extracted.
 */
interface UseGameCanvasControllerRuntimeOptions {
  host: GameCanvasRuntimeHost;
  gameCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  sceneRuntime: any;
  localPlayer: any;
  localPlayerId?: string;
  connection: any | null;
  predictedPosition: { x: number; y: number } | null;
  getCurrentPositionNow: () => { x: number; y: number } | null;
  localFacingDirection: string | undefined;
  cameraOffsetX: number;
  cameraOffsetY: number;
  canvasSize: { width: number; height: number };
  onDodgeRollStart?: (moveX: number, moveY: number) => void;
  addSOVAMessage?: (message: any) => void;
  showSovaSoundBox?: (audio: HTMLAudioElement, label: string) => void;
  onCairnNotification?: (notification: any) => void;
  onSetInteractingWith: (target: any | null) => void;
  isMinimapOpen: boolean;
  setIsMinimapOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isChatting: boolean;
  showInventory: boolean;
  isGameMenuOpen: boolean;
  isSearchingCraftRecipes?: boolean;
  isFishing: boolean;
  setMusicPanelVisible: React.Dispatch<React.SetStateAction<boolean>>;
  movementDirection: { x: number; y: number };
  isAutoWalking: boolean;
  showFpsProfiler: boolean;
  isProfilerRecording: boolean;
  startProfilerRecording?: () => void;
  stopProfilerRecording?: () => Promise<boolean>;
  onProfilerCopied?: () => void;
  placementInfo: any;
  placementActions: any;
  isMobile?: boolean;
  onMobileInteractInfoChange?: (info: { hasTarget: boolean; label?: string } | null) => void;
  mobileInteractTrigger?: number;
  showError: (message: string) => void;
}

export function useGameCanvasControllerRuntime({
  host,
  gameCanvasRef,
  sceneRuntime,
  localPlayer,
  localPlayerId,
  connection,
  predictedPosition,
  getCurrentPositionNow,
  localFacingDirection,
  cameraOffsetX,
  cameraOffsetY,
  canvasSize,
  onDodgeRollStart,
  addSOVAMessage,
  showSovaSoundBox,
  onCairnNotification,
  onSetInteractingWith,
  isMinimapOpen,
  setIsMinimapOpen,
  isChatting,
  showInventory,
  isGameMenuOpen,
  isSearchingCraftRecipes,
  isFishing,
  setMusicPanelVisible,
  movementDirection,
  isAutoWalking,
  showFpsProfiler,
  isProfilerRecording,
  startProfilerRecording,
  stopProfilerRecording,
  onProfilerCopied,
  placementInfo,
  placementActions,
  isMobile,
  onMobileInteractInfoChange,
  mobileInteractTrigger,
  showError,
}: UseGameCanvasControllerRuntimeOptions): GameCanvasRuntimeControllerSnapshot {
  const {
    worldMousePosRef,
    localOptimisticDodgeRollStartMsRef,
    localOptimisticJumpPressMsRef,
  } = host.getControllerRefs();
  const buildTargetingRef = host.getBuildTargetingRef();
  const interactionTargetRef = host.getInteractionTargetRef();
  const inputRuntime = host.getInputRuntime();

  useSyncExternalStore(
    host.subscribeToBuildingPlacementRuntime,
    host.getBuildingPlacementRuntimeVersion,
    host.getBuildingPlacementRuntimeVersion,
  );

  const buildState = host.configureControllerBuildRuntimeState({
    connection,
    predictedPosition,
    localPlayer,
    activeEquipments: sceneRuntime.activeEquipments,
    itemDefinitions: sceneRuntime.itemDefinitions,
    localPlayerId,
    foundationCells: sceneRuntime.foundationCells,
    fences: sceneRuntime.fences,
  });

  const interactionRuntime = useGameCanvasInteractionRuntime({
    localPlayer,
    predictedPosition,
    getCurrentPositionNow,
    campfires: sceneRuntime.campfires,
    furnaces: sceneRuntime.furnaces,
    barbecues: sceneRuntime.barbecues,
    fumaroles: sceneRuntime.fumaroles,
    lanterns: sceneRuntime.lanterns,
    visibleTurretsMap: sceneRuntime.visibleTurretsMap,
    homesteadHearths: sceneRuntime.homesteadHearths,
    droppedItems: sceneRuntime.droppedItems,
    woodenStorageBoxes: sceneRuntime.woodenStorageBoxes,
    playerCorpses: sceneRuntime.playerCorpses,
    stashes: sceneRuntime.stashes,
    sleepingBags: sceneRuntime.sleepingBags,
    players: sceneRuntime.players,
    shelters: sceneRuntime.shelters,
    connection,
    inventoryItems: sceneRuntime.inventoryItems,
    itemDefinitions: sceneRuntime.itemDefinitions,
    playerDrinkingCooldowns: sceneRuntime.playerDrinkingCooldowns,
    rainCollectors: sceneRuntime.rainCollectors,
    brothPots: sceneRuntime.brothPots,
    doors: sceneRuntime.doors,
    visibleAlkStationsMap: sceneRuntime.visibleAlkStationsMap,
    cairns: sceneRuntime.cairns,
    harvestableResources: sceneRuntime.harvestableResources,
    visibleWorldTiles: sceneRuntime.visibleWorldTiles,
    wildAnimals: sceneRuntime.wildAnimals,
    caribouBreedingData: sceneRuntime.caribouBreedingData ?? new Map(),
    walrusBreedingData: sceneRuntime.walrusBreedingData ?? new Map(),
    worldState: sceneRuntime.worldState,
    showFpsProfiler,
    isProfilerRecording,
    canvasWidth: canvasSize.width,
    startProfilerRecording,
    stopProfilerRecording,
    onProfilerCopied,
    onDodgeRollStart,
    localOptimisticDodgeRollStartMsRef,
    localOptimisticJumpPressMsRef,
    canvasRef: gameCanvasRef,
    activeEquipments: sceneRuntime.activeEquipments,
    placementInfo,
    placementActions,
    buildingState: buildState.buildingState,
    buildingActions: buildState.buildingActions,
    worldMousePos: buildState.worldMousePos,
    worldMousePosRef,
    interactionTargetRef,
    visibleTreesMap: sceneRuntime.visibleTreesMap,
    visibleStonesMap: sceneRuntime.visibleStonesMap,
    visibleLivingCoralsMap: sceneRuntime.visibleLivingCoralsMap,
    visibleBarrelsMap: sceneRuntime.visibleBarrelsMap,
    visibleAnimalCorpsesMap: sceneRuntime.visibleAnimalCorpsesMap,
    visibleWildAnimalsMap: sceneRuntime.visibleWildAnimalsMap,
    playerDiscoveredCairns: sceneRuntime.playerDiscoveredCairns,
    addSOVAMessage,
    showSovaSoundBox,
    onCairnNotification,
    onSetInteractingWith,
    isMinimapOpen,
    setIsMinimapOpen,
    isChatting,
    showInventory,
    isGameMenuOpen,
    isSearchingCraftRecipes,
    isFishing,
    setMusicPanelVisible,
    movementDirection,
    isAutoWalking,
    targetedFoundation: buildTargetingRef.current.targetedFoundation ?? buildState.targetedFoundation,
    targetedWall: buildTargetingRef.current.targetedWall ?? buildState.targetedWall,
    targetedFence: buildTargetingRef.current.targetedFence ?? buildState.targetedFence,
    buildTargetingRef,
    rangedWeaponStats: sceneRuntime.rangedWeaponStats,
    projectiles: sceneRuntime.projectiles,
    isMobile,
    onMobileInteractInfoChange,
    mobileInteractTrigger,
    showError,
    inputRuntime,
  });

  const controllerSnapshot = host.configureControllerSnapshotFromRuntime({
    buildState,
    interactionRuntime,
    sceneRuntime,
    cameraOffsetX,
    cameraOffsetY,
    predictedPosition,
    localFacingDirection,
    localPlayer,
    connection,
    isGameMenuOpen,
    placementInfo,
  });

  return controllerSnapshot;
}
