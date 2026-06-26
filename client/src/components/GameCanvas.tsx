/**
 * GameCanvas - Canvas host around runtime-backed frame, interaction, and render state.
 *
 * Bridges the DOM canvas into the client runtime, wires canvas-local hooks that still
 * feed frame assembly and interaction/render pipelines, and renders only the canvas
 * surface plus canvas-adjacent overlay UI. This file is now much closer to a host
 * boundary, but it still assembles a large amount of canvas-specific runtime input.
 */

import React, { useEffect, useRef, useMemo } from 'react';

// --- Core Hooks ---
import { useAssetLoader } from '../hooks/useAssetLoader';
import { useDoodadImages } from '../hooks/useDoodadImages';
import { useGameViewport } from '../hooks/useGameViewport';
import { useDamageEffects } from '../hooks/useDamageEffects';
import { useSettings } from '../contexts/SettingsContext';
import { useErrorDisplay } from '../contexts/ErrorDisplayContext';
import { useGameUI } from '../contexts/GameUIContext';
import { useGameplaySession } from '../contexts/GameplaySessionContext';
import { useGameplayInteraction } from '../contexts/GameplayInteractionContext';
import { useGameplayMovement } from '../contexts/GameplayMovementContext';
import { useLocalPlayer } from '../engine/react/selectors';

// --- Rendering Utilities ---
import { setWaterOverlayIntensity } from '../utils/renderers/waterOverlayUtils';

// --- Other Components & Utils ---
import GameCanvasOverlayUI from './GameCanvasOverlayUI';
import type { PlacementItemInfo, PlacementActions } from '../hooks/usePlacementManager';
// V2 system removed due to performance issues
import { useGameCanvasAssetPreload } from '../hooks/useGameCanvasAssetPreload';
import { useGameCanvasFramePipeline } from '../engine/react/useGameCanvasFramePipeline';
import { useGameCanvasSceneRuntime } from '../engine/react/useGameCanvasSceneRuntime';
import { useGameCanvasControllerRuntime } from '../engine/react/useGameCanvasControllerRuntime';
import { useGameCanvasOverlayRuntime } from '../engine/react/useGameCanvasOverlayRuntime';
import { configureGameCanvasRenderRuntime } from '../engine/runtime/configureGameCanvasRenderRuntime';
import { GameCanvasRuntimeHost } from '../engine/runtime/GameCanvasRuntimeHost';

// --- Prop Interface ---
interface GameCanvasProps {
  localPlayerId?: string;
  connection: any | null;
  placementInfo: PlacementItemInfo | null;
  placementActions: PlacementActions;
  placementError: string | null;
  setPlacementWarning: (warning: string | null) => void;
  gameCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  addSOVAMessage?: (message: { id: string; text: string; isUser: boolean; timestamp: Date; flashTab?: boolean }) => void; // SOVA message sink for cairn lore.
  showSovaSoundBox?: (audio: HTMLAudioElement, label: string) => void; // SOVA audio visualization callback.
  onCairnNotification?: (notification: { id: string; cairnNumber: number; totalCairns: number; title: string; isFirstDiscovery: boolean; timestamp: number }) => void;
  showAutotileDebug: boolean;
  showChunkBoundaries: boolean;
  showInteriorDebug: boolean;
  showCollisionDebug: boolean;
  showAttackRangeDebug: boolean;
  showYSortDebug: boolean;
  showShipwreckDebug: boolean;
  showFpsProfiler?: boolean; // FPS profiler overlay - lightweight, no extra lag when enabled
  isProfilerRecording?: boolean; // Show REC indicator when recording
  startProfilerRecording?: () => void;
  stopProfilerRecording?: () => Promise<boolean>;
  onProfilerCopied?: () => void; // Toast callback when stop & copy succeeds
  isGameMenuOpen: boolean;
  onAutoActionStatesChange?: (isAutoAttacking: boolean) => void;
}

const GameCanvas: React.FC<GameCanvasProps> = ({
  localPlayerId,
  connection,
  placementInfo,
  placementActions,
  placementError,
  setPlacementWarning,
  gameCanvasRef,
  showAutotileDebug,
  showChunkBoundaries,
  showInteriorDebug,
  showCollisionDebug,
  showAttackRangeDebug,
  showYSortDebug,
  showShipwreckDebug,
  showFpsProfiler = false,
  isProfilerRecording = false,
  startProfilerRecording,
  stopProfilerRecording,
  onProfilerCopied,
  isGameMenuOpen,
  onAutoActionStatesChange,
  addSOVAMessage,
  showSovaSoundBox,
  onCairnNotification,
}) => {
  const runtimeHostRef = useRef<GameCanvasRuntimeHost | null>(null);
  if (!runtimeHostRef.current) {
    runtimeHostRef.current = new GameCanvasRuntimeHost();
  }
  const runtimeHost = runtimeHostRef.current;

  // --- Settings from context (audio + visual) ---
  const {
    environmentalVolume,
    allShadowsEnabled,
    weatherOverlayEnabled: showPrecipitation,
    stormAtmosphereEnabled,
    statusOverlaysEnabled: showStatusOverlays,
    alwaysShowPlayerNames,
    cloudsEnabled,
    waterSurfaceEffectsEnabled,
    waterSurfaceEffectsIntensity,
    worldParticlesQuality,
    footprintsEnabled,
    grassAnimationEnabled,
    bloomIntensity,
    vignetteIntensity,
    chromaticAberrationIntensity,
    colorCorrection,
    fixedSimulationEnabled,
  } = useSettings();
  const gameUI = useGameUI();
  const {
    onMobileInteractInfoChange,
    mobileInteractTrigger,
    showInventoryState,
    showCraftingScreenState,
  } = useGameplaySession();
  const { handleSetInteractingWith: onSetInteractingWith } = useGameplayInteraction();
  const {
    predictedPosition,
    getCurrentPositionNow,
    getReconciliationProfilerSnapshot,
    getCurrentFacingDirectionNow,
    getCurrentDodgeRollVisualNow,
    onDodgeRollStart,
    stepPredictedMovement,
    movementDirection,
    isAutoWalking,
    facingDirection: localFacingDirection,
    isMobile,
    onMobileTap,
    tapAnimation,
    isFishing,
  } = useGameplayMovement();
  const isMinimapOpen = gameUI.isMinimapOpen;
  const setIsMinimapOpen = gameUI.setIsMinimapOpen;
  const isChatting = gameUI.isChatting;
  const isSearchingCraftRecipes = gameUI.isCraftingSearchFocused;
  const showInventory = showInventoryState || showCraftingScreenState;
  const setMusicPanelVisible = gameUI.setIsMusicPanelVisible;

  useEffect(() => {
    setWaterOverlayIntensity(waterSurfaceEffectsIntensity / 100);
  }, [waterSurfaceEffectsIntensity]);

  const postProcessStyle = useMemo(() => {
    const colorOffset = colorCorrection - 50;
    // Bloom: 25% slider = max effect (cap effective at 25)
    const effectiveBloom = Math.min(bloomIntensity, 25);
    const bloomBrightness = 1 + effectiveBloom * 0.0045;
    const bloomBlur = effectiveBloom * 0.02;
    const colorBrightness = 1 + colorOffset * 0.0025;
    const colorContrast = 1 + colorOffset * 0.004;
    const colorSaturation = 1 + colorOffset * 0.0065;
    const colorHueRotate = colorOffset * 0.28;

    const cssFilterParts = [
      `brightness(${(bloomBrightness * colorBrightness).toFixed(3)})`,
      `contrast(${colorContrast.toFixed(3)})`,
      `saturate(${colorSaturation.toFixed(3)})`,
      `hue-rotate(${colorHueRotate.toFixed(2)}deg)`,
      `blur(${bloomBlur.toFixed(3)}px)`,
    ];

    if (chromaticAberrationIntensity > 0) {
      cssFilterParts.push('url(#game-chromatic-aberration-filter)');
    }

    const vignetteEdgeOpacity = Math.max(0, Math.min(0.72, vignetteIntensity * 0.009));
    // Chromatic aberration: 50% slider = max effect (cap effective at 50)
    const effectiveChromatic = Math.min(chromaticAberrationIntensity, 50);
    const chromaticOffset = effectiveChromatic * 0.03;

    return {
      cssFilter: cssFilterParts.join(' '),
      vignetteEdgeOpacity,
      chromaticOffset,
    };
  }, [bloomIntensity, vignetteIntensity, chromaticAberrationIntensity, colorCorrection]);

  const { showError } = useErrorDisplay();

  // --- Refs ---
  const renderRefs = runtimeHost.getRenderRefs();

  // --- Core Game State Hooks ---
  const localPlayer = useLocalPlayer(localPlayerId ?? null);

  const { canvasSize, cameraOffsetX: baseCameraOffsetX, cameraOffsetY: baseCameraOffsetY } = useGameViewport(localPlayer, predictedPosition);

  // === AAA Combat Effects: Screen shake, vignette, heartbeat ===
  // PERFORMANCE FIX: shakeOffset and vignetteOpacity are now refs (updated by RAF loop,
  // not React state). Only low-health UI state triggers re-renders.
  const {
    isLowHealth,
    isCriticalHealth,
    heartbeatPulse
  } = useDamageEffects(localPlayer, 100); // 100 = max health

  // Camera offset WITHOUT shake - used by hooks (mouse position, day/night, etc.)
  // Screen shake is applied directly inside renderGame() by reading shakeOffsetXRef/YRef,
  // which avoids triggering React re-renders on every shake frame.
  const cameraOffsetX = baseCameraOffsetX;
  const cameraOffsetY = baseCameraOffsetY;

  const pointerSnapshot = runtimeHost.configurePointerRuntime({
    canvasRef: gameCanvasRef,
    cameraOffsetX,
    cameraOffsetY,
    canvasSize,
    isMobile,
    onMobileTap,
  });

  const { heroImageRef, heroSprintImageRef, heroIdleImageRef, heroWaterImageRef, heroCrouchImageRef, heroDodgeImageRef, itemImagesRef, cloudImagesRef, droneImageRef, shelterImageRef } = useAssetLoader();
  const doodadImagesRef = useDoodadImages(); // Extracted to dedicated hook
  const {
    foundationTileImagesRef,
    deathMarkerImg,
    pinMarkerImg,
    campfireWarmthImg,
    torchOnImg,
  } = useGameCanvasAssetPreload({
    itemImagesRef,
  });

  const sceneRuntime = useGameCanvasSceneRuntime({
    host: runtimeHost,
    connection,
    localPlayerId,
    localPlayer,
    predictedPosition,
    cameraOffsetX,
    cameraOffsetY,
    canvasSize,
    pointerSnapshot,
  });

  const {
    players,
    trees,
    clouds,
    droneEvents,
    stones,
    runeStones,
    cairns,
    campfires,
    furnaces,
    barbecues,
    lanterns,
    turrets,
    woodenStorageBoxes,
    sleepingBags,
    playerCorpses,
    stashes,
    rainCollectors,
    brothPots,
    waterPatches,
    fertilizerPatches,
    firePatches,
    placedExplosives,
    inventoryItems,
    itemDefinitions,
    activeEquipments,
    activeConsumableEffects,
    worldState,
    activeConnections,
    plantedSeeds,
    wildAnimals,
    barrels,
    roadLampposts,
    fumaroles,
    basaltColumns,
    seaStacks,
    homesteadHearths,
    foundationCells,
    wallCells,
    doors,
    playerDodgeRollStates,
    chunkWeather,
    alkStations,
    monumentParts,
    largeQuarries,
    playerStats,
    caribouBreedingData,
    walrusBreedingData,
    shelters,
    interpolatedGrass,
    shipwreckPartsMap,
    isTreeFalling,
    getFallProgress,
    visibleWorldTiles,
    waterTileLookup,
    seaTransitionTileLookup,
    detectedHotSprings,
    detectedQuarries,
    visibleSleepingBags,
    visibleHarvestableResources,
    visibleDroppedItems,
    visibleCampfires,
    visibleBarbecues,
    visibleHarvestableResourcesMap,
    visibleCampfiresMap,
    visibleFurnacesMap,
    visibleBarbecuesMap,
    visibleLanternsMap,
    visibleTurretsMap,
    visibleRuneStonesMap,
    visibleDroppedItemsMap,
    visibleBoxesMap,
    visiblePlayerCorpses,
    visibleStashes,
    visiblePlayerCorpsesMap,
    visibleSleepingBagsMap,
    visibleTrees,
    visibleTreesMap,
    visibleGrassMap,
    visibleShelters,
    visibleSheltersMap,
    visibleLanterns,
    visibleAnimalCorpsesMap,
    visibleBarrels,
    visibleBarrelsMap,
    visibleRoadLamppostsMap,
    visibleSeaStacks,
    visibleSeaStacksMap,
    visibleHomesteadHearthsMap,
    visibleDoorsMap,
    visibleFences,
    resolvedBuildingClusters,
    playerBuildingClusterId,
    resolvedOverlayRgba,
    resolvedMaskCanvas,
    redrawMask,
    remotePlayerInterpolation,
  } = sceneRuntime;

  const controllerRuntime = useGameCanvasControllerRuntime({
    host: runtimeHost,
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
  });

  const cursorStyle = controllerRuntime.cursorStyle;
  const localPlayerIsCrouching = controllerRuntime.isCrouching;
  const isAutoAttacking = controllerRuntime.isAutoAttacking;

  const { hoveredPlayerIds, handlePlayerHover, overlayProps } = useGameCanvasOverlayRuntime({
    connection,
    localPlayerId,
    itemImagesRef,
    deathMarkerImg,
    pinMarkerImg,
    campfireWarmthImg,
    torchOnImg,
    canvasSize,
    controllerRuntime,
    pointerSnapshot,
    plantedSeeds,
    wildAnimals,
  });

  runtimeHost.configureParticleRuntime({
    localPlayer,
    sceneRuntime,
    localPlayerId,
    localFacingDirectionRef: controllerRuntime.localFacingDirectionRef,
  });

  runtimeHost.configureAmbientEffectsSnapshot({
    connection,
    localPlayer,
    localPlayerId,
    predictedPosition,
    cameraOffsetX,
    cameraOffsetY,
    canvasSize,
    environmentalVolume,
    onAutoActionStatesChange,
    showError,
  });
  runtimeHost.configureSceneSnapshot(sceneRuntime);
  runtimeHost.configureControllerSnapshot(controllerRuntime);
  runtimeHost.configureFrameBindingsFromController({
    controllerSnapshot: controllerRuntime,
    stepPredictedMovement,
    fixedSimulationEnabled,
    connection,
    getCurrentPositionNow,
    getReconciliationProfilerSnapshot,
    getCurrentFacingDirectionNow,
    localPlayer,
    isAutoWalking,
    canvasSize,
  });

  configureGameCanvasRenderRuntime({
    host: runtimeHost,
    localPlayerId,
    localPlayer,
    predictedPosition,
    connection,
    gameCanvasRef,
    canvasSize,
    placementInfo,
    placementError,
    placementActions,
    setPlacementWarning,
    showFpsProfiler,
    isProfilerRecording,
    showAutotileDebug,
    showChunkBoundaries,
    showInteriorDebug,
    showCollisionDebug,
    showAttackRangeDebug,
    showYSortDebug,
    showShipwreckDebug,
    allShadowsEnabled,
    alwaysShowPlayerNames,
    waterSurfaceEffectsEnabled,
    footprintsEnabled,
    grassAnimationEnabled,
    worldParticlesQuality,
    cloudsEnabled,
    showPrecipitation,
    stormAtmosphereEnabled,
    showStatusOverlays,
    isSearchingCraftRecipes,
    showInventory,
    isMobile,
    tapAnimation,
    localPlayerIsCrouching,
    isAutoAttacking,
    isAutoWalking,
    hoveredPlayerIds,
    handlePlayerHover,
    getCurrentDodgeRollVisualNow,
    assets: {
      doodadImagesRef,
      heroImageRef,
      heroSprintImageRef,
      heroIdleImageRef,
      heroWaterImageRef,
      heroCrouchImageRef,
      heroDodgeImageRef,
      itemImagesRef,
      cloudImagesRef,
      droneImageRef,
      shelterImageRef,
      foundationTileImagesRef,
    },
    renderRefs,
  });

  useGameCanvasFramePipeline({
    host: runtimeHost,
    showFpsProfiler,
  });

  return (
    <div style={{ position: 'relative', width: canvasSize.width, height: canvasSize.height, overflow: 'hidden' }}>
      <svg
        width={0}
        height={0}
        style={{ position: 'absolute', pointerEvents: 'none' }}
        aria-hidden="true"
      >
        <defs>
          <filter id="game-chromatic-aberration-filter" colorInterpolationFilters="sRGB">
            <feOffset in="SourceGraphic" dx={postProcessStyle.chromaticOffset} dy="0" result="redOffset" />
            <feColorMatrix
              in="redOffset"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 0"
              result="redChannel"
            />
            <feOffset in="SourceGraphic" dx={-postProcessStyle.chromaticOffset} dy="0" result="greenOffset" />
            <feColorMatrix
              in="greenOffset"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0.55 0"
              result="greenChannel"
            />
            <feBlend in="redChannel" in2="greenChannel" mode="screen" result="fringe" />
            <feBlend in="SourceGraphic" in2="fringe" mode="screen" />
          </filter>
        </defs>
      </svg>

      <canvas
        ref={gameCanvasRef}
        id="game-canvas"
        width={canvasSize.width}
        height={canvasSize.height}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          filter: postProcessStyle.cssFilter,
          cursor: cursorStyle,
          pointerEvents: isGameMenuOpen ? 'none' : 'auto', // Don't capture events when menu is open
          touchAction: isMobile ? 'none' : 'auto', // Prevent default touch behaviors on mobile
        }}
        onContextMenu={(e) => {
          if (placementInfo) {
            e.preventDefault();
          }
        }}
      />

      {/* === AAA Damage Vignette Effect === */}
      {/* PERFORMANCE FIX: Vignette is now rendered on the game canvas in renderGame() */}
      {/* Reading from vignetteOpacityRef avoids React re-renders during damage animations */}
      {postProcessStyle.vignetteEdgeOpacity > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 45,
            background: `radial-gradient(circle at center, rgba(0, 0, 0, 0) 55%, rgba(0, 0, 0, ${postProcessStyle.vignetteEdgeOpacity.toFixed(3)}) 100%)`,
            transition: 'background 0.12s ease-out',
          }}
        />
      )}

      {/* === Low Health Warning Effect === */}
      {/* Pulsing red border when health is critically low */}
      {isLowHealth && !localPlayer?.isDead && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            boxShadow: `inset 0 0 ${isCriticalHealth ? 80 : 50}px ${isCriticalHealth ? 30 : 15}px rgba(180, 20, 20, ${0.3 + heartbeatPulse * 0.4})`,
            zIndex: 49,
            transition: 'box-shadow 0.1s ease-out',
          }}
        />
      )}

      <GameCanvasOverlayUI {...overlayProps} />
    </div>
  );
};

const MemoizedGameCanvas = React.memo(GameCanvas);
export default MemoizedGameCanvas;
