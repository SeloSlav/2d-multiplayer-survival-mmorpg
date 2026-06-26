import React, { type MutableRefObject, useEffect, useRef, useState } from 'react';
import DeathScreen from './DeathScreen';
import GameMinimapOverlay from './GameMinimapOverlay';
import { BuildingRadialMenu } from './BuildingRadialMenu';
import { UpgradeRadialMenu } from './UpgradeRadialMenu';
import PlantedSeedTooltip from './PlantedSeedTooltip';
import TamedAnimalTooltip from './TamedAnimalTooltip';
import { BuildingMode, BuildingTier, FoundationShape } from '../engine/runtime/buildingPlacementRuntime';
import { logDebug } from '../utils/gameDebugUtils';
import { useGameplaySession } from '../contexts/GameplaySessionContext';
import { useEngineSnapshot } from '../engine/react/useEngineSnapshot';
import { useGameScreenWorldTables, useLocalPlayer } from '../engine/react/selectors';
import { calculateChunkIndex } from '../utils/chunkUtils';
import {
  EMPTY_TOOLTIP_WORLD_ENV,
  type TooltipWorldEnv,
} from './plantedSeedTooltipSnapshot';
import { usePlantedSeedHover } from '../hooks/usePlantedSeedHover';
import { useTamedAnimalHover } from '../hooks/useTamedAnimalHover';
import type { GameCanvasPointerSnapshot } from '../engine/runtime/gameCanvasPointerRuntime';

const EMPTY_MAP = new Map();

export interface GameCanvasOverlayUIProps {
  connection: any;
  localPlayerId?: string;
  itemImagesRef: any;
  deathMarkerImg: any;
  pinMarkerImg: any;
  campfireWarmthImg: any;
  torchOnImg: any;
  canvasSize: { width: number; height: number };
  showBuildingRadialMenu: boolean;
  radialMenuMouseX: number;
  radialMenuMouseY: number;
  buildingActions: any;
  setShowBuildingRadialMenu: (show: boolean) => void;
  showUpgradeRadialMenu: boolean;
  setShowUpgradeRadialMenu: (show: boolean) => void;
  upgradeMenuFoundationRef: MutableRefObject<any | null>;
  upgradeMenuWallRef: MutableRefObject<any | null>;
  upgradeMenuFenceRef: MutableRefObject<any | null>;
  pointerSnapshot: GameCanvasPointerSnapshot;
  plantedSeeds: Map<string, any>;
  wildAnimals: Map<string, any>;
}

function useOverlayPointerSnapshot(pointerSnapshot: GameCanvasPointerSnapshot) {
  const [pointerState, setPointerState] = useState(() => ({
    worldMousePos: { ...pointerSnapshot.worldMousePos },
    canvasMousePos: { ...pointerSnapshot.canvasMousePos },
  }));

  useEffect(() => {
    let rafId: number | null = null;
    let lastWorldX = pointerSnapshot.worldMousePos.x;
    let lastWorldY = pointerSnapshot.worldMousePos.y;
    let lastCanvasX = pointerSnapshot.canvasMousePos.x;
    let lastCanvasY = pointerSnapshot.canvasMousePos.y;

    const tick = () => {
      const nextWorld = pointerSnapshot.worldMousePos;
      const nextCanvas = pointerSnapshot.canvasMousePos;
      if (
        nextWorld.x !== lastWorldX ||
        nextWorld.y !== lastWorldY ||
        nextCanvas.x !== lastCanvasX ||
        nextCanvas.y !== lastCanvasY
      ) {
        lastWorldX = nextWorld.x;
        lastWorldY = nextWorld.y;
        lastCanvasX = nextCanvas.x;
        lastCanvasY = nextCanvas.y;
        setPointerState({
          worldMousePos: { x: nextWorld.x, y: nextWorld.y },
          canvasMousePos: { x: nextCanvas.x, y: nextCanvas.y },
        });
      }

      rafId = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [pointerSnapshot]);

  return pointerState;
}

function CanvasHoverTooltips({
  pointerSnapshot,
  plantedSeeds,
  wildAnimals,
  isGameMenuOpen,
  showInventory,
  worldTables,
  worldChunkDataMap,
}: {
  pointerSnapshot: GameCanvasPointerSnapshot;
  plantedSeeds: Map<string, any>;
  wildAnimals: Map<string, any>;
  isGameMenuOpen: boolean;
  showInventory: boolean;
  worldTables: Record<string, any>;
  worldChunkDataMap: Map<string, any> | null | undefined;
}) {
  const { worldMousePos, canvasMousePos } = useOverlayPointerSnapshot(pointerSnapshot);
  const { hoveredSeed } = usePlantedSeedHover(plantedSeeds, worldMousePos.x, worldMousePos.y);
  const { hoveredTamedAnimal } = useTamedAnimalHover(wildAnimals, worldMousePos.x, worldMousePos.y);

  const resolvedTrees = worldTables.trees ?? EMPTY_MAP;
  const resolvedRuneStones = worldTables.runeStones ?? EMPTY_MAP;
  const resolvedLanterns = worldTables.lanterns ?? EMPTY_MAP;

  const plantedSeedTooltipWorldRef = useRef<TooltipWorldEnv>(EMPTY_TOOLTIP_WORLD_ENV);
  plantedSeedTooltipWorldRef.current = {
    clouds: worldTables.clouds ?? EMPTY_MAP,
    worldState: worldTables.worldState,
    chunkWeather: worldTables.chunkWeather ?? EMPTY_MAP,
    waterPatches: worldTables.waterPatches ?? EMPTY_MAP,
    campfires: worldTables.campfires ?? EMPTY_MAP,
    lanterns: resolvedLanterns,
    furnaces: worldTables.furnaces ?? EMPTY_MAP,
    trees: resolvedTrees,
    runeStones: resolvedRuneStones,
    fertilizerPatches: worldTables.fertilizerPatches ?? EMPTY_MAP,
    worldChunkData: worldChunkDataMap ?? undefined,
  };

  const plantedSeedChunkWxTag =
    hoveredSeed != null
      ? (worldTables.chunkWeather ?? EMPTY_MAP)
          .get(calculateChunkIndex(hoveredSeed.posX, hoveredSeed.posY).toString())
          ?.currentWeather?.tag ?? ''
      : '';
  const plantedSeedGlobalWeatherTag = worldTables.worldState?.currentWeather?.tag ?? '';
  const plantedSeedTimeOfDayTag = worldTables.worldState?.timeOfDay?.tag ?? '';

  return (
    <>
      {hoveredSeed && canvasMousePos.x !== null && canvasMousePos.y !== null && !isGameMenuOpen && !showInventory && (
        <PlantedSeedTooltip
          seed={hoveredSeed}
          visible={true}
          position={{ x: canvasMousePos.x, y: canvasMousePos.y }}
          worldEnvRef={plantedSeedTooltipWorldRef}
          globalWeatherTag={plantedSeedGlobalWeatherTag}
          timeOfDayTag={plantedSeedTimeOfDayTag}
          chunkWxTag={plantedSeedChunkWxTag}
        />
      )}

      {hoveredTamedAnimal && canvasMousePos.x !== null && canvasMousePos.y !== null && !isGameMenuOpen && !showInventory && (
        <TamedAnimalTooltip
          animal={hoveredTamedAnimal}
          visible={true}
          position={{ x: canvasMousePos.x, y: canvasMousePos.y }}
          currentTime={Date.now()}
          caribouBreedingData={worldTables.caribouBreedingData}
          walrusBreedingData={worldTables.walrusBreedingData}
          caribouRutState={worldTables.caribouRutState}
          walrusRutState={worldTables.walrusRutState}
          players={worldTables.players}
        />
      )}
    </>
  );
}

export default function GameCanvasOverlayUI(props: GameCanvasOverlayUIProps) {
  const {
    connection,
    localPlayerId,
    itemImagesRef,
    deathMarkerImg,
    pinMarkerImg,
    campfireWarmthImg,
    torchOnImg,
    canvasSize,
    showBuildingRadialMenu,
    radialMenuMouseX,
    radialMenuMouseY,
    buildingActions,
    setShowBuildingRadialMenu,
    showUpgradeRadialMenu,
    setShowUpgradeRadialMenu,
    upgradeMenuFoundationRef,
    upgradeMenuWallRef,
    upgradeMenuFenceRef,
    pointerSnapshot,
    plantedSeeds,
    wildAnimals,
  } = props;
  const {
    currentMenu,
    showInventoryState,
    showCraftingScreenState,
  } = useGameplaySession();
  const localPlayer = useLocalPlayer(localPlayerId ?? null);
  const worldTables = useGameScreenWorldTables();
  const worldChunkDataMap = useEngineSnapshot(
    (snapshot) => snapshot.world.chunkDataMap as Map<string, any> | null,
  );
  const shouldShowDeathScreen = !!(localPlayer?.isDead && connection);
  const showInventory = showInventoryState || showCraftingScreenState;
  const isGameMenuOpen = currentMenu !== null;
  const closeFoundationUpgrade = () => {
    setShowUpgradeRadialMenu(false);
    upgradeMenuFoundationRef.current = null;
  };

  const closeWallUpgrade = () => {
    setShowUpgradeRadialMenu(false);
    upgradeMenuWallRef.current = null;
  };

  const closeFenceUpgrade = () => {
    setShowUpgradeRadialMenu(false);
    upgradeMenuFenceRef.current = null;
  };

  return (
    <>
      {shouldShowDeathScreen && (
        <DeathScreen
          onRespawnRandomly={() => {
            logDebug('Respawn Randomly Clicked');
            return connection?.reducers?.respawnRandomly({}).catch((err: any) => {
              console.error('[DeathScreen] respawnRandomly failed:', err);
              throw err;
            });
          }}
          onRespawnAtBag={(bagId) => {
            logDebug('Respawn At Bag Clicked:', bagId);
            return connection?.reducers?.respawnAtSleepingBag({ bagId }).catch((err: any) => {
              console.error('[DeathScreen] respawnAtSleepingBag failed:', err);
              throw err;
            });
          }}
          localPlayerIdentity={localPlayerId ?? null}
          sleepingBagImage={itemImagesRef.current?.get('sleeping_bag.png')}
          deathMarkerImage={deathMarkerImg}
          pinMarkerImage={pinMarkerImg}
          campfireWarmthImage={campfireWarmthImg}
          torchOnImage={torchOnImg}
        />
      )}

      <GameMinimapOverlay
        canvasWidth={canvasSize.width}
        canvasHeight={canvasSize.height}
        connection={connection}
        localPlayerId={localPlayerId}
        itemImagesRef={itemImagesRef}
        deathMarkerImg={deathMarkerImg}
        pinMarkerImg={pinMarkerImg}
        campfireWarmthImg={campfireWarmthImg}
        torchOnImg={torchOnImg}
      />

      {showBuildingRadialMenu && (
        <BuildingRadialMenu
          isVisible={showBuildingRadialMenu}
          mouseX={radialMenuMouseX}
          mouseY={radialMenuMouseY}
          connection={connection}
          inventoryItems={worldTables.inventoryItems}
          itemDefinitions={worldTables.itemDefinitions}
          onSelect={(mode: BuildingMode, tier: BuildingTier, initialShape?: FoundationShape) => {
            buildingActions?.startBuildingMode(mode, tier, initialShape);
            setShowBuildingRadialMenu(false);
          }}
          onCancel={() => {
            setShowBuildingRadialMenu(false);
            buildingActions.cancelBuildingMode();
          }}
        />
      )}

      {showUpgradeRadialMenu && upgradeMenuFoundationRef.current && (
        <UpgradeRadialMenu
          isVisible={showUpgradeRadialMenu}
          mouseX={radialMenuMouseX}
          mouseY={radialMenuMouseY}
          connection={connection}
          inventoryItems={worldTables.inventoryItems}
          itemDefinitions={worldTables.itemDefinitions}
          tile={upgradeMenuFoundationRef.current}
          tileType="foundation"
          activeConsumableEffects={worldTables.activeConsumableEffects}
          localPlayerId={localPlayerId}
          homesteadHearths={worldTables.homesteadHearths}
          onSelect={(tier: BuildingTier) => {
            if (connection && upgradeMenuFoundationRef.current) {
              logDebug('[UpgradeRadialMenu] Upgrading foundation', upgradeMenuFoundationRef.current.id, 'to tier', tier);
              connection.reducers.upgradeFoundation({
                foundationId: upgradeMenuFoundationRef.current.id,
                newTier: tier as number,
              });
            }
            closeFoundationUpgrade();
          }}
          onCancel={closeFoundationUpgrade}
          onDestroy={() => {
            if (connection && upgradeMenuFoundationRef.current) {
              logDebug('[UpgradeRadialMenu] Destroying foundation', upgradeMenuFoundationRef.current.id);
              connection.reducers.destroyFoundation({ foundationId: upgradeMenuFoundationRef.current.id });
            }
            closeFoundationUpgrade();
          }}
        />
      )}

      {showUpgradeRadialMenu && upgradeMenuWallRef.current && (
        <UpgradeRadialMenu
          isVisible={showUpgradeRadialMenu}
          mouseX={radialMenuMouseX}
          mouseY={radialMenuMouseY}
          connection={connection}
          inventoryItems={worldTables.inventoryItems}
          itemDefinitions={worldTables.itemDefinitions}
          tile={upgradeMenuWallRef.current}
          tileType="wall"
          activeConsumableEffects={worldTables.activeConsumableEffects}
          localPlayerId={localPlayerId}
          homesteadHearths={worldTables.homesteadHearths}
          onSelect={(tier: BuildingTier) => {
            if (connection && upgradeMenuWallRef.current) {
              logDebug('[UpgradeRadialMenu] Upgrading wall', upgradeMenuWallRef.current.id, 'to tier', tier);
              connection.reducers.upgradeWall({
                wallId: upgradeMenuWallRef.current.id,
                newTier: tier as number,
              });
            }
            closeWallUpgrade();
          }}
          onCancel={closeWallUpgrade}
          onDestroy={() => {
            if (connection && upgradeMenuWallRef.current) {
              logDebug('[UpgradeRadialMenu] Destroying wall', upgradeMenuWallRef.current.id);
              connection.reducers.destroyWall({ wallId: upgradeMenuWallRef.current.id });
            }
            closeWallUpgrade();
          }}
        />
      )}

      {showUpgradeRadialMenu && upgradeMenuFenceRef.current && (
        <UpgradeRadialMenu
          isVisible={showUpgradeRadialMenu}
          mouseX={radialMenuMouseX}
          mouseY={radialMenuMouseY}
          connection={connection}
          inventoryItems={worldTables.inventoryItems}
          itemDefinitions={worldTables.itemDefinitions}
          tile={upgradeMenuFenceRef.current}
          tileType="fence"
          activeConsumableEffects={worldTables.activeConsumableEffects}
          localPlayerId={localPlayerId}
          homesteadHearths={worldTables.homesteadHearths}
          onSelect={(tier: BuildingTier) => {
            if (connection && upgradeMenuFenceRef.current) {
              logDebug('[UpgradeRadialMenu] Upgrading fence', upgradeMenuFenceRef.current.id, 'to tier', tier);
              connection.reducers.upgradeFence({
                fenceId: upgradeMenuFenceRef.current.id,
                newTier: tier as number,
              });
            }
            closeFenceUpgrade();
          }}
          onCancel={closeFenceUpgrade}
          onDestroy={() => {
            if (connection && upgradeMenuFenceRef.current) {
              logDebug('[UpgradeRadialMenu] Destroying fence', upgradeMenuFenceRef.current.id);
              connection.reducers.destroyFence({ fenceId: upgradeMenuFenceRef.current.id });
            }
            closeFenceUpgrade();
          }}
        />
      )}

      <CanvasHoverTooltips
        pointerSnapshot={pointerSnapshot}
        plantedSeeds={plantedSeeds}
        wildAnimals={wildAnimals}
        isGameMenuOpen={isGameMenuOpen}
        showInventory={showInventory}
        worldTables={worldTables}
        worldChunkDataMap={worldChunkDataMap}
      />
    </>
  );
}
