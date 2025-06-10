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
import { DraggedItemInfo, DragSourceSlotInfo } from '../types/dragDropTypes';

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
    
    // Predicted Position
    predictedPosition: { x: number; y: number } | null;
    canvasRef: React.RefObject<HTMLCanvasElement | null>;

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
    onItemDrop: (targetSlotInfo: DragSourceSlotInfo | null) => void;

    // Reducer Actions (from usePlayerActions)
    isMinimapOpen: boolean;
    setIsMinimapOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isChatting: boolean;
    setIsChatting: React.Dispatch<React.SetStateAction<boolean>>;

    // Additional props
    projectiles: Map<string, SpacetimeDBProjectile>;
    deathMarkers: Map<string, SpacetimeDBDeathMarker>;
    setIsCraftingSearchFocused: React.Dispatch<React.SetStateAction<boolean>>;
    isCraftingSearchFocused: boolean;
    isAutoWalking: boolean;
}

const GameScreen: React.FC<GameScreenProps> = (props) => {
    // ADD THIS LOG AT THE VERY BEGINNING OF THE COMPONENT
    // console.log("[GameScreen.tsx] Received props including activeConsumableEffects:", props.activeConsumableEffects);
    const [showInventoryState, setShowInventoryState] = useState(false);
    
    // Add menu state management
    const [currentMenu, setCurrentMenu] = useState<MenuType>(null);
    
    // Add auto-action state management
    const [autoActionStates, setAutoActionStates] = useState({ isAutoAttacking: false, isAutoWalking: false });
    
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
        predictedPosition, canvasRef,
        placementInfo, placementActions, placementError, startPlacement, cancelPlacement,
        interactingWith, handleSetInteractingWith,
        draggedItemInfo, onItemDragStart, onItemDrop,
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
        setIsCraftingSearchFocused,
        isCraftingSearchFocused,
        isAutoWalking,
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

    // Handler for auto-action state changes from GameCanvas
    const handleAutoActionStatesChange = useCallback((isAutoAttacking: boolean, isAutoWalking: boolean) => {
        console.log('[GameScreen] Auto-action states changed:', { isAutoAttacking, isAutoWalking });
        setAutoActionStates({ isAutoAttacking, isAutoWalking });
    }, []);

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
            {/* CSS Animation for Auto-Action Indicators */}
            <style>{`
                @keyframes pulse {
                    0% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.7; transform: scale(1.05); }
                    100% { opacity: 1; transform: scale(1); }
                }
            `}</style>
            
            {/* Game Menu Button */}
            <GameMenuButton onClick={handleMenuOpen} />
            
            {/* Auto-Action Status Indicators */}
            {/* Debug: {JSON.stringify(autoActionStates)} */}
            {(autoActionStates.isAutoAttacking || autoActionStates.isAutoWalking) && (
                <div style={{
                    position: 'fixed',
                    top: '70px', // Position below DayNightCycleTracker (which is at 15px)
                    right: '15px', // Same right position as DayNightCycleTracker
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    zIndex: 50, // Same z-index as DayNightCycleTracker
                    pointerEvents: 'none' // Don't interfere with clicks
                }}>
                    {autoActionStates.isAutoAttacking && (
                        <div style={{
                            backgroundColor: 'rgba(40, 40, 60, 0.85)', // Same as DayNightCycleTracker
                            color: 'white',
                            padding: '8px 12px', // Slightly less padding for compact look
                            borderRadius: '4px', // Same as DayNightCycleTracker
                            fontSize: '10px', // Same as DayNightCycleTracker
                            fontFamily: '"Press Start 2P", cursive', // Same as DayNightCycleTracker
                            fontWeight: 'normal', // Remove bold for pixel font
                            textAlign: 'center',
                            border: '1px solid #a0a0c0', // Same border as DayNightCycleTracker
                            boxShadow: '2px 2px 0px rgba(0,0,0,0.5)', // Same shadow as DayNightCycleTracker
                            width: '140px', // Fixed width for consistency
                            animation: 'pulse 2s infinite'
                        }}>
                            ⚔️ AUTO ATTACK (Z)
                        </div>
                    )}
                    {autoActionStates.isAutoWalking && (
                        <div style={{
                            backgroundColor: 'rgba(40, 40, 60, 0.85)', // Same as DayNightCycleTracker
                            color: 'white',
                            padding: '8px 12px', // Slightly less padding for compact look
                            borderRadius: '4px', // Same as DayNightCycleTracker
                            fontSize: '10px', // Same as DayNightCycleTracker
                            fontFamily: '"Press Start 2P", cursive', // Same as DayNightCycleTracker
                            fontWeight: 'normal', // Remove bold for pixel font
                            textAlign: 'center',
                            border: '1px solid #a0a0c0', // Same border as DayNightCycleTracker
                            boxShadow: '2px 2px 0px rgba(0,0,0,0.5)', // Same shadow as DayNightCycleTracker
                            width: '140px', // Fixed width for consistency
                            animation: 'pulse 2s infinite'
                        }}>
                            🚶 AUTO WALK (Q)
                        </div>
                    )}
                </div>
            )}
            
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
                        onClick={(e) => {
                            toggleAutotileDebug();
                            e.currentTarget.blur(); // Remove focus immediately after clicking
                        }}
                        onFocus={(e) => {
                            e.currentTarget.blur(); // Prevent the button from staying focused
                        }}
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
                predictedPosition={predictedPosition}
                placementInfo={placementInfo}
                placementActions={placementActions}
                placementError={placementError}
                onSetInteractingWith={handleSetInteractingWith}
                isMinimapOpen={isMinimapOpen}
                setIsMinimapOpen={setIsMinimapOpen}
                isChatting={isChatting}
                messages={messages}
                isSearchingCraftRecipes={isCraftingSearchFocused}
                activeConsumableEffects={activeConsumableEffects}
                showInventory={showInventoryState}
                grass={grass}
                worldTiles={worldTiles}
                gameCanvasRef={canvasRef}
                projectiles={projectiles}
                deathMarkers={deathMarkers}
                shelters={shelters}
                showAutotileDebug={showAutotileDebug}
                minimapCache={minimapCache}
                isGameMenuOpen={currentMenu !== null}
                onAutoActionStatesChange={handleAutoActionStatesChange}
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
                gameCanvasRef={canvasRef}
                cameraOffsetX={cameraOffsetX}
                cameraOffsetY={cameraOffsetY}
            />
        </div>
    );
};

export default GameScreen; 