/**
 * GameScreen.tsx
 * 
 * Renders the main game view after the player has successfully logged in.
 * Composes the core game UI components:
 *  - `GameCanvas`: Renders the game world, players, entities.
 *  - `PlayerUI`: Renders inventory, equipment, crafting, container UIs.
 *  - `Hotbar`: Renders the player's quick-access item slots.
 *  - `DayNightCycleTracker`: Displays the current time of day visually.
 * Receives all necessary game state and action handlers as props from `App.tsx` 
 * and passes them down to the relevant child components.
 */

// Import child components
import GameCanvas from './GameCanvas';
import PlayerUI from './PlayerUI';
import Hotbar from './Hotbar';
import DayNightCycleTracker from './DayNightCycleTracker';
import Chat from './Chat';
import SpeechBubbleManager from './SpeechBubbleManager';
import TargetingReticle from './TargetingReticle';

// Import menu components
import GameMenuButton from './GameMenuButton';
import GameMenu from './GameMenu';
import ControlsMenu from './ControlsMenu';
import GameTipsMenu from './GameTipsMenu';
import type { MenuType } from './GameMenu';

// Import types used by props
import { 
    Player as SpacetimeDBPlayer,
    Tree as SpacetimeDBTree,
    Stone as SpacetimeDBStone,
    Campfire as SpacetimeDBCampfire,
    Mushroom as SpacetimeDBMushroom,
    Hemp as SpacetimeDBHemp,
    Corn as SpacetimeDBCorn,
    Potato as SpacetimeDBPotato,
    Pumpkin as SpacetimeDBPumpkin,
    DroppedItem as SpacetimeDBDroppedItem,
    WoodenStorageBox as SpacetimeDBWoodenStorageBox,
    InventoryItem as SpacetimeDBInventoryItem,
    ItemDefinition as SpacetimeDBItemDefinition,
    WorldState as SpacetimeDBWorldState,
    ActiveEquipment as SpacetimeDBActiveEquipment,
    Recipe as SpacetimeDBRecipe,
    CraftingQueueItem as SpacetimeDBCraftingQueueItem,
    DbConnection,
    Message as SpacetimeDBMessage,
    PlayerPin,
    ActiveConnection,
    SleepingBag as SpacetimeDBSleepingBag,
    PlayerCorpse as SpacetimeDBPlayerCorpse,
    Stash as SpacetimeDBStash,
    ActiveConsumableEffect as SpacetimeDBActiveConsumableEffect,
    Cloud as SpacetimeDBCloud,
    Grass as SpacetimeDBGrass,
    KnockedOutStatus as SpacetimeDBKnockedOutStatus,
    RangedWeaponStats,
    Projectile as SpacetimeDBProjectile,
    DeathMarker as SpacetimeDBDeathMarker,
    Shelter as SpacetimeDBShelter,
    MinimapCache as SpacetimeDBMinimapCache
} from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import { PlacementItemInfo, PlacementActions } from '../hooks/usePlacementManager';
import { InteractionTarget } from '../hooks/useInteractionManager';
import { DraggedItemInfo } from '../types/dragDropTypes';

// Import useSpeechBubbleManager hook
import { useSpeechBubbleManager } from '../hooks/useSpeechBubbleManager';

// Import other necessary imports
import { useInteractionManager } from '../hooks/useInteractionManager';
import { useState, useEffect, useRef, useCallback } from 'react';

// Import debug context
import { useDebug } from '../contexts/DebugContext';

// Define props required by GameScreen and its children
interface GameScreenProps {
    // Core Game State (from useSpacetimeTables)
    players: Map<string, SpacetimeDBPlayer>;
    trees: Map<string, SpacetimeDBTree>;
    clouds: Map<string, SpacetimeDBCloud>;
    stones: Map<string, SpacetimeDBStone>;
    campfires: Map<string, SpacetimeDBCampfire>;
    mushrooms: Map<string, SpacetimeDBMushroom>;
    hemps: Map<string, SpacetimeDBHemp>;
    corns: Map<string, SpacetimeDBCorn>;
    potatoes: Map<string, SpacetimeDBPotato>;
    pumpkins: Map<string, SpacetimeDBPumpkin>;
    droppedItems: Map<string, SpacetimeDBDroppedItem>;
    woodenStorageBoxes: Map<string, SpacetimeDBWoodenStorageBox>;
    sleepingBags: Map<string, SpacetimeDBSleepingBag>;
    playerPins: Map<string, PlayerPin>;
    playerCorpses: Map<string, SpacetimeDBPlayerCorpse>;
    stashes: Map<string, SpacetimeDBStash>;
    shelters: Map<string, SpacetimeDBShelter>;
    worldTiles: Map<string, any>;
    minimapCache: SpacetimeDBMinimapCache | null;
    inventoryItems: Map<string, SpacetimeDBInventoryItem>;
    itemDefinitions: Map<string, SpacetimeDBItemDefinition>;
    worldState: SpacetimeDBWorldState | null;
    activeEquipments: Map<string, SpacetimeDBActiveEquipment>;
    recipes: Map<string, SpacetimeDBRecipe>;
    craftingQueueItems: Map<string, SpacetimeDBCraftingQueueItem>;
    messages: Map<string, SpacetimeDBMessage>;
    activeConnections: Map<string, ActiveConnection> | undefined;
    activeConsumableEffects: Map<string, SpacetimeDBActiveConsumableEffect>;
    grass: Map<string, SpacetimeDBGrass>;
    knockedOutStatus: Map<string, SpacetimeDBKnockedOutStatus>;
    rangedWeaponStats: Map<string, RangedWeaponStats>;
    
    // Connection & Player Info
    localPlayerId?: string;
    playerIdentity: Identity | null;
    connection: DbConnection | null;
    
    // Placement State/Actions (from usePlacementManager)
    placementInfo: PlacementItemInfo | null;
    placementActions: PlacementActions; // Pass whole object if GameCanvas needs more than cancel
    placementError: string | null;
    startPlacement: (itemInfo: PlacementItemInfo) => void;
    cancelPlacement: () => void;

    // Interaction Handler (from useInteractionManager)
    interactingWith: InteractionTarget;
    handleSetInteractingWith: (target: InteractionTarget) => void;

    // Drag/Drop Handlers (from useDragDropManager)
    draggedItemInfo: DraggedItemInfo | null;
    onItemDragStart: (info: DraggedItemInfo) => void;
    onItemDrop: (targetSlotInfo: any | null) => void; // Use appropriate type if known

    // Reducer Actions (from usePlayerActions)
    updatePlayerPosition: (moveX: number, moveY: number) => void;
    callJumpReducer: () => void;
    callSetSprintingReducer: (isSprinting: boolean) => void;
    isMinimapOpen: boolean;
    setIsMinimapOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isChatting: boolean;
    setIsChatting: (isChatting: boolean) => void;

    // Additional props
    projectiles: Map<string, SpacetimeDBProjectile>;
    deathMarkers: Map<string, SpacetimeDBDeathMarker>;
}

const GameScreen: React.FC<GameScreenProps> = (props) => {
    // ADD THIS LOG AT THE VERY BEGINNING OF THE COMPONENT
    // console.log("[GameScreen.tsx] Received props including activeConsumableEffects:", props.activeConsumableEffects);
    const [showInventoryState, setShowInventoryState] = useState(false);
    
    // Add menu state management
    const [currentMenu, setCurrentMenu] = useState<MenuType>(null);
    
    // Debug context
    const { showAutotileDebug, toggleAutotileDebug } = useDebug();
    
    // Destructure props for cleaner usage
    const {
        players, trees, stones, campfires, mushrooms, corns, potatoes, pumpkins, hemps, droppedItems, woodenStorageBoxes, sleepingBags,
        playerPins, playerCorpses, stashes,
        shelters,
        worldTiles,
        minimapCache,
        inventoryItems, itemDefinitions, worldState, activeEquipments, recipes, craftingQueueItems,
        messages,
        activeConnections,
        localPlayerId, playerIdentity, connection,
        placementInfo, placementActions, placementError, startPlacement, cancelPlacement,
        interactingWith, handleSetInteractingWith,
        draggedItemInfo, onItemDragStart, onItemDrop,
        updatePlayerPosition, callJumpReducer: jump, callSetSprintingReducer: setSprinting,
        isMinimapOpen,
        setIsMinimapOpen,
        isChatting,
        setIsChatting,
        activeConsumableEffects,
        clouds,
        grass,
        knockedOutStatus,
        rangedWeaponStats,
        projectiles,
        deathMarkers,
    } = props;

    const gameCanvasRef = useRef<HTMLCanvasElement>(null);

    // You can also add a useEffect here if the above doesn't show up
    useEffect(() => {
        // console.log("[GameScreen.tsx] activeConsumableEffects prop after destructuring:", activeConsumableEffects);
    }, [activeConsumableEffects]);

    // Find local player for viewport calculations
    const localPlayer = localPlayerId ? players.get(localPlayerId) : undefined;
    
    // Use our custom hook to get camera offsets
    const { cameraOffsetX, cameraOffsetY } = useSpeechBubbleManager(localPlayer);

    // Added state
    const [isCraftingSearchFocused, setIsCraftingSearchFocused] = useState(false);

    // Derive activeItemDef for TargetingReticle
    const localPlayerActiveEquipment = localPlayerId ? activeEquipments.get(localPlayerId) : undefined;
    const activeItemDef = localPlayerActiveEquipment?.equippedItemDefId && itemDefinitions
        ? itemDefinitions.get(localPlayerActiveEquipment.equippedItemDefId.toString()) || null
        : null;

    // Menu handlers
    const handleMenuOpen = () => {
        setCurrentMenu('main');
    };

    const handleMenuClose = () => {
        setCurrentMenu(null);
    };

    const handleMenuNavigate = (menu: MenuType) => {
        setCurrentMenu(menu);
    };

    const handleMenuBack = () => {
        setCurrentMenu('main');
    };

    // Add escape key handler for game menu
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                if (currentMenu === null) {
                    // No menu open - open main menu
                    setCurrentMenu('main');
                } else if (currentMenu === 'main') {
                    // Main menu open - close menu entirely
                    setCurrentMenu(null);
                } else {
                    // Sub-menu open (controls/tips) - return to main menu
                    setCurrentMenu('main');
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [currentMenu]);

    return (
        <div className="game-container">
            {/* Game Menu Button */}
            <GameMenuButton onClick={handleMenuOpen} />
            
            {/* Debug Controls - positioned beneath menu button in dev mode */}
            {process.env.NODE_ENV === 'development' && (
                <div style={{ 
                    position: 'absolute', 
                    top: '70px', // Positioned below the menu button
                    left: '15px', 
                    zIndex: 998, // Below menu button but above other elements
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    color: 'white',
                    padding: '8px',
                    borderRadius: '4px',
                    fontSize: '12px'
                }}>
                    <button 
                        onClick={toggleAutotileDebug}
                        style={{
                            backgroundColor: showAutotileDebug ? '#4CAF50' : '#f44336',
                            color: 'white',
                            border: 'none',
                            padding: '4px 8px',
                            borderRadius: '2px',
                            fontSize: '10px',
                            cursor: 'pointer'
                        }}
                    >
                        Debug Overlay: {showAutotileDebug ? 'ON' : 'OFF'}
                    </button>
                </div>
            )}

            {/* Game Menu Overlays */}
            {currentMenu === 'main' && (
                <GameMenu 
                    onClose={handleMenuClose} 
                    onNavigate={handleMenuNavigate} 
                />
            )}
            {currentMenu === 'controls' && (
                <ControlsMenu 
                    onBack={handleMenuBack} 
                    onClose={handleMenuClose} 
                />
            )}
            {currentMenu === 'tips' && (
                <GameTipsMenu 
                    onBack={handleMenuBack} 
                    onClose={handleMenuClose} 
                />
            )}
            
            <GameCanvas
                players={players}
                trees={trees}
                clouds={clouds}
                stones={stones}
                campfires={campfires}
                mushrooms={mushrooms}
                hemps={hemps}
                corns={corns}
                potatoes={potatoes}
                pumpkins={pumpkins}
                droppedItems={droppedItems}
                woodenStorageBoxes={woodenStorageBoxes}
                sleepingBags={sleepingBags}
                playerPins={playerPins}
                playerCorpses={playerCorpses}
                stashes={stashes}
                inventoryItems={inventoryItems}
                itemDefinitions={itemDefinitions}
                worldState={worldState}
                activeEquipments={activeEquipments}
                activeConnections={activeConnections}
                localPlayerId={localPlayerId}
                connection={connection}
                placementInfo={placementInfo}
                placementActions={placementActions}
                placementError={placementError}
                onSetInteractingWith={handleSetInteractingWith}
                updatePlayerPosition={updatePlayerPosition}
                callJumpReducer={jump}
                callSetSprintingReducer={setSprinting}
                isMinimapOpen={isMinimapOpen}
                setIsMinimapOpen={setIsMinimapOpen}
                isChatting={isChatting}
                messages={messages}
                isSearchingCraftRecipes={isCraftingSearchFocused}
                activeConsumableEffects={activeConsumableEffects}
                showInventory={showInventoryState}
                grass={grass}
                worldTiles={worldTiles}
                gameCanvasRef={gameCanvasRef}
                projectiles={projectiles}
                deathMarkers={deathMarkers}
                shelters={shelters}
                showAutotileDebug={showAutotileDebug}
                minimapCache={minimapCache}
                isGameMenuOpen={currentMenu !== null}
            />
            
            {/* Use our camera offsets for SpeechBubbleManager */}
            <SpeechBubbleManager
                messages={messages}
                players={players}
                cameraOffsetX={cameraOffsetX}
                cameraOffsetY={cameraOffsetY}
                localPlayerId={localPlayerId}
            />
            
            <PlayerUI
                identity={playerIdentity}
                players={players}
                inventoryItems={inventoryItems}
                itemDefinitions={itemDefinitions}
                recipes={recipes}
                craftingQueueItems={craftingQueueItems}
                onItemDragStart={onItemDragStart}
                onItemDrop={onItemDrop}
                draggedItemInfo={draggedItemInfo}
                interactingWith={interactingWith}
                onSetInteractingWith={handleSetInteractingWith}
                campfires={campfires}
                woodenStorageBoxes={woodenStorageBoxes}
                playerCorpses={playerCorpses}
                stashes={stashes}
                currentStorageBox={
                    interactingWith?.type === 'wooden_storage_box'
                        ? woodenStorageBoxes.get(interactingWith.id.toString()) || null
                        : null
                }
                startPlacement={startPlacement}
                cancelPlacement={cancelPlacement}
                placementInfo={placementInfo}
                connection={connection}
                activeEquipments={activeEquipments}
                activeConsumableEffects={activeConsumableEffects}
                onCraftingSearchFocusChange={setIsCraftingSearchFocused}
                onToggleInventory={() => setShowInventoryState(prev => !prev)}
                showInventory={showInventoryState}
                knockedOutStatus={knockedOutStatus}
                worldState={worldState}
                isGameMenuOpen={currentMenu !== null}
            />
            <DayNightCycleTracker worldState={worldState} />
            <Chat 
                connection={connection}
                messages={messages} 
                players={players}
                isChatting={isChatting}
                setIsChatting={setIsChatting}
                localPlayerIdentity={localPlayerId}
            />

            <TargetingReticle
                localPlayer={localPlayer || null}
                playerIdentity={playerIdentity}
                activeItemDef={activeItemDef}
                rangedWeaponStats={rangedWeaponStats || new Map()}
                gameCanvasRef={gameCanvasRef}
                cameraOffsetX={cameraOffsetX}
                cameraOffsetY={cameraOffsetY}
            />
        </div>
    );
};

export default GameScreen; 