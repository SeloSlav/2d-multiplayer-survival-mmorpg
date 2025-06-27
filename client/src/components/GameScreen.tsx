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
import FishingManager from './FishingManager';
import MusicControlPanel from './MusicControlPanel';
// Import menu components
import GameMenuButton from './GameMenuButton';
import GameMenu from './GameMenu';
import ControlsMenu from './ControlsMenu';
import GameTipsMenu from './GameTipsMenu';
import GameSettingsMenu from './GameSettingsMenu';
import type { MenuType } from './GameMenu';

// Import types used by props
import { 
    Player as SpacetimeDBPlayer,
    Tree as SpacetimeDBTree,
    Stone as SpacetimeDBStone,
    Campfire as SpacetimeDBCampfire,
    Lantern as SpacetimeDBLantern,
    Mushroom as SpacetimeDBMushroom,
    Hemp as SpacetimeDBHemp,
    Reed as SpacetimeDBReed,
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
    RainCollector as SpacetimeDBRainCollector,
    WaterPatch as SpacetimeDBWaterPatch,
    ActiveConsumableEffect as SpacetimeDBActiveConsumableEffect,
    Cloud as SpacetimeDBCloud,
    Grass as SpacetimeDBGrass,
    KnockedOutStatus as SpacetimeDBKnockedOutStatus,
    RangedWeaponStats,
    Projectile as SpacetimeDBProjectile,
    DeathMarker as SpacetimeDBDeathMarker,
    Shelter as SpacetimeDBShelter,
    MinimapCache as SpacetimeDBMinimapCache,
    FishingSession,
    PlantedSeed as SpacetimeDBPlantedSeed,
    PlayerDrinkingCooldown as SpacetimeDBPlayerDrinkingCooldown,
    WildAnimal as SpacetimeDBWildAnimal,
    ViperSpittle as SpacetimeDBViperSpittle,
    AnimalCorpse as SpacetimeDBAnimalCorpse,
} from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import { PlacementItemInfo, PlacementActions } from '../hooks/usePlacementManager';
import { InteractionTarget } from '../hooks/useInteractionManager';
import { DraggedItemInfo, DragSourceSlotInfo } from '../types/dragDropTypes';

// Import useSpeechBubbleManager hook
import { useSpeechBubbleManager } from '../hooks/useSpeechBubbleManager';

// Import voice interface components and hooks
import VoiceInterface from './VoiceInterface';
import SOVALoadingBar from './SOVALoadingBar';
import { useVoiceInterface } from '../hooks/useVoiceInterface';

// Import other necessary imports
import { useInteractionManager } from '../hooks/useInteractionManager';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useMusicSystem } from '../hooks/useMusicSystem';

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
    lanterns: Map<string, SpacetimeDBLantern>;
    mushrooms: Map<string, SpacetimeDBMushroom>;
    hemps: Map<string, SpacetimeDBHemp>;
    reeds: Map<string, SpacetimeDBReed>;
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
    plantedSeeds: Map<string, SpacetimeDBPlantedSeed>;
    worldTiles: Map<string, any>;
    minimapCache: SpacetimeDBMinimapCache | null;
    wildAnimals: Map<string, SpacetimeDBWildAnimal>;
    viperSpittles: Map<string, SpacetimeDBViperSpittle>;
    animalCorpses: Map<string, SpacetimeDBAnimalCorpse>;
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
    
    // Add player drinking cooldowns for water interaction
    playerDrinkingCooldowns: Map<string, SpacetimeDBPlayerDrinkingCooldown>;
    
    // Rain collectors
    rainCollectors: Map<string, SpacetimeDBRainCollector>;
    
    // Water patches
    waterPatches: Map<string, SpacetimeDBWaterPatch>;
    
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

    // 🎣 FISHING INPUT FIX: Add callback to notify parent of fishing state changes
    onFishingStateChange?: (isFishing: boolean) => void;
    
    // Add fishing sessions for rendering other players' fishing
    fishingSessions: Map<string, FishingSession>;
    
    // Music system for debug controls
    musicSystem: ReturnType<typeof useMusicSystem>;
    
    // Volume settings for menu controls
    musicVolume: number;
    soundVolume: number;
    environmentalVolume: number;
    onMusicVolumeChange: (volume: number) => void;
    onSoundVolumeChange: (volume: number) => void;
    onEnvironmentalVolumeChange: (volume: number) => void;
    
    // Sound system for immediate sound effects
    soundSystem: ReturnType<typeof import('../hooks/useSoundSystem').useSoundSystem>;

    // Music panel state
    isMusicPanelVisible: boolean;
    setIsMusicPanelVisible: React.Dispatch<React.SetStateAction<boolean>>;
}

const GameScreen: React.FC<GameScreenProps> = (props) => {
    // ADD THIS LOG AT THE VERY BEGINNING OF THE COMPONENT
    // console.log("[GameScreen.tsx] Received props including activeConsumableEffects:", props.activeConsumableEffects);
    const [showInventoryState, setShowInventoryState] = useState(false);
    
    // Add menu state management
    const [currentMenu, setCurrentMenu] = useState<MenuType>(null);
    
    // Add auto-action state management
    const [autoActionStates, setAutoActionStates] = useState({ isAutoAttacking: false });
    
    // Add refresh confirmation dialog state
    const [showRefreshDialog, setShowRefreshDialog] = useState(false);
    
    // SOVA message adder function from Chat component
    const [sovaMessageAdder, setSOVAMessageAdder] = useState<((message: { id: string; text: string; isUser: boolean; timestamp: Date }) => void) | null>(null);
    
    // 🎣 FISHING INPUT FIX: Track fishing state to disable input
    const [isFishing, setIsFishing] = useState(false);
    
    // Debug logging for SOVA message adder
    useEffect(() => {
        console.log('[GameScreen] SOVA message adder changed:', sovaMessageAdder ? 'Available' : 'Not available');
        if (sovaMessageAdder) {
            console.log('[GameScreen] SOVA message adder function is now ready for VoiceInterface');
        }
    }, [sovaMessageAdder]);
    
    // Callback to receive SOVA message adder from Chat
    const handleSOVAMessageAdderReady = useCallback((addMessage: (message: { id: string; text: string; isUser: boolean; timestamp: Date }) => void) => {
        console.log('[GameScreen] Received SOVA message adder from Chat component');
        setSOVAMessageAdder(() => addMessage); // Use function form to avoid stale closure
    }, []);
    
    // Debug context
    const { showAutotileDebug, toggleAutotileDebug, showMusicDebug, toggleMusicDebug } = useDebug();
    

    
    // Destructure props for cleaner usage
    const {
        players, trees, stones, campfires, lanterns, mushrooms, corns, potatoes, pumpkins, hemps, reeds, droppedItems, woodenStorageBoxes, sleepingBags,
        playerPins, playerCorpses, stashes,
        shelters,
        plantedSeeds,
        worldTiles,
        minimapCache,
        wildAnimals,
        viperSpittles,
        animalCorpses,
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
        // Auto-walking removed
        onFishingStateChange,
        fishingSessions,
        musicSystem,
        musicVolume,
        soundVolume,
        environmentalVolume,
        onMusicVolumeChange,
        onSoundVolumeChange,
        onEnvironmentalVolumeChange,
        soundSystem,
        playerDrinkingCooldowns,
        rainCollectors,
        waterPatches,
        isMusicPanelVisible,
        setIsMusicPanelVisible,
    } = props;

    const gameCanvasRef = useRef<HTMLCanvasElement>(null);

    // Voice interface hook
    const {
        voiceState,
        handleTranscriptionComplete,
        handleError: handleVoiceError,
        forceClose: forceCloseVoice,
    } = useVoiceInterface({
        isEnabled: true,
        isChatting,
        isGameMenuOpen: currentMenu !== null,
        isInventoryOpen: showInventoryState,
    });

    // SOVA loading bar state
    const [sovaLoadingState, setSOVALoadingState] = useState({
        isRecording: false,
        isTranscribing: false,
        isGeneratingResponse: false,
        isSynthesizingVoice: false,
        isPlayingAudio: false,
        transcribedText: '',
        currentPhase: 'Ready',
    });

    // Handle SOVA loading state changes from VoiceInterface
    const handleSOVALoadingStateChange = useCallback((state: typeof sovaLoadingState) => {
        setSOVALoadingState(state);
    }, []);

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
    const handleAutoActionStatesChange = useCallback((isAutoAttacking: boolean) => {
        console.log('[GameScreen] Auto-action states changed:', { isAutoAttacking });
        setAutoActionStates({ isAutoAttacking });
    }, []);

    // Combined keyboard handler for game menu (Escape) and refresh confirmation (Ctrl+R)
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Handle Escape key for game menu
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
            // Handle Ctrl+R / Cmd+R for refresh confirmation
            else if ((event.ctrlKey || event.metaKey) && event.key === 'r') {
                console.log('[GameScreen] Ctrl+R intercepted, showing refresh dialog');
                event.preventDefault(); // Prevent default browser refresh
                setShowRefreshDialog(true); // Show our custom dialog
            }
            // Handle M key for music debug panel toggle
            else if (event.key === 'm' || event.key === 'M') {
                toggleMusicDebug();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [currentMenu]); // Include currentMenu in dependencies

    // Handler for refresh dialog actions
    const handleRefreshConfirm = () => {
        window.location.reload(); // Actually refresh the page
    };

    const handleRefreshCancel = () => {
        setShowRefreshDialog(false); // Close the dialog
    };

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
            {autoActionStates.isAutoAttacking && (
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
                    fontSize: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
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
                    
                    <button 
                        onClick={(e) => {
                            // Cycle through all weather types
                            const currentWeather = worldState?.currentWeather?.tag;
                            const weatherTypes = ['Clear', 'LightRain', 'ModerateRain', 'HeavyRain', 'HeavyStorm'];
                            const currentIndex = weatherTypes.indexOf(currentWeather || 'Clear');
                            const nextIndex = (currentIndex + 1) % weatherTypes.length;
                            const nextWeather = weatherTypes[nextIndex];
                            
                            if (connection) {
                                try {
                                    // Call reducer to set next weather type (only available in debug builds)
                                    (connection.reducers as any).debugSetWeather(nextWeather);
                                } catch (error) {
                                    console.warn('Debug weather function not available (production build?):', error);
                                }
                            }
                            e.currentTarget.blur(); // Remove focus immediately after clicking
                        }}
                        onFocus={(e) => {
                            e.currentTarget.blur(); // Prevent the button from staying focused
                        }}
                        style={{
                            backgroundColor: (() => {
                                const weather = worldState?.currentWeather?.tag;
                                switch (weather) {
                                    case 'Clear': return '#4CAF50'; // Green
                                    case 'LightRain': return '#03A9F4'; // Light Blue
                                    case 'ModerateRain': return '#2196F3'; // Blue
                                    case 'HeavyRain': return '#3F51B5'; // Indigo
                                    case 'HeavyStorm': return '#9C27B0'; // Purple
                                    default: return '#FF9800'; // Orange fallback
                                }
                            })(),
                            color: 'white',
                            border: 'none',
                            padding: '4px 8px',
                            borderRadius: '2px',
                            fontSize: '10px',
                            cursor: 'pointer'
                        }}
                    >
                        Weather: {(() => {
                            const weather = worldState?.currentWeather?.tag;
                            switch (weather) {
                                case 'Clear': return 'CLEAR';
                                case 'LightRain': return 'LIGHT RAIN';
                                case 'ModerateRain': return 'MOD RAIN';
                                case 'HeavyRain': return 'HEAVY RAIN';
                                case 'HeavyStorm': return 'STORM';
                                default: return 'UNKNOWN';
                            }
                        })()}
                    </button>
                    
                    <button 
                        onClick={(e) => {
                            // Toggle between day and night for testing lighting
                            const currentTimeOfDay = worldState?.timeOfDay?.tag;
                            const isNight = currentTimeOfDay === 'Night' || currentTimeOfDay === 'Midnight';
                            
                            if (connection) {
                                try {
                                    // Call reducer to toggle time (only available in debug builds)
                                    if (isNight) {
                                        (connection.reducers as any).debugSetTime('Noon');
                                    } else {
                                        (connection.reducers as any).debugSetTime('Night');
                                    }
                                } catch (error) {
                                    console.warn('Debug time function not available (production build?):', error);
                                }
                            }
                            e.currentTarget.blur(); // Remove focus immediately after clicking
                        }}
                        onFocus={(e) => {
                            e.currentTarget.blur(); // Prevent the button from staying focused
                        }}
                        style={{
                            backgroundColor: (() => {
                                const timeOfDay = worldState?.timeOfDay?.tag;
                                return (timeOfDay === 'Night' || timeOfDay === 'Midnight') ? '#3F51B5' : '#FFC107';
                            })(),
                            color: 'white',
                            border: 'none',
                            padding: '4px 8px',
                            borderRadius: '2px',
                            fontSize: '10px',
                            cursor: 'pointer'
                        }}
                    >
                        Time: {(() => {
                            const timeOfDay = worldState?.timeOfDay?.tag;
                            return (timeOfDay === 'Night' || timeOfDay === 'Midnight') ? 'NIGHT' : 'DAY';
                        })()}
                    </button>
                </div>
            )}

            {/* Game Menu Overlays */}
            {currentMenu === 'main' && (
                <GameMenu 
                    onClose={handleMenuClose} 
                    onNavigate={handleMenuNavigate}
                    musicVolume={musicVolume}
                    soundVolume={soundVolume}
                    onMusicVolumeChange={onMusicVolumeChange}
                    onSoundVolumeChange={onSoundVolumeChange}
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
            {currentMenu === 'settings' && (
                <GameSettingsMenu
                    onBack={handleMenuBack}
                    onClose={handleMenuClose}
                    musicVolume={musicVolume}
                    soundVolume={soundVolume}
                    environmentalVolume={environmentalVolume}
                    onMusicVolumeChange={onMusicVolumeChange}
                    onSoundVolumeChange={onSoundVolumeChange}
                    onEnvironmentalVolumeChange={onEnvironmentalVolumeChange}
                />
            )}
            
            {/* Refresh Confirmation Dialog */}
            {showRefreshDialog && (
                <div 
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 9999,
                        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                    }}
                    onClick={handleRefreshCancel} // Click outside to close
                >
                    <div 
                        style={{
                            backgroundColor: 'rgba(20, 20, 40, 0.95)',
                            border: '2px solid #00aaff',
                            borderRadius: '8px',
                            padding: '24px',
                            maxWidth: '400px',
                            textAlign: 'center',
                            boxShadow: '0 0 30px rgba(0, 170, 255, 0.3)',
                        }}
                        onClick={(e) => e.stopPropagation()} // Prevent click from bubbling up
                    >
                        <div style={{
                            color: '#00ddff',
                            fontSize: '16px',
                            marginBottom: '12px',
                            textShadow: '0 0 10px rgba(0, 221, 255, 0.5)',
                            fontWeight: 'bold',
                        }}>
                            NEUROVEIL REFRESH REQUEST
                        </div>
                        
                        <div style={{
                            color: '#e0e0e0',
                            fontSize: '14px',
                            lineHeight: '1.6',
                            marginBottom: '24px',
                            padding: '16px',
                            backgroundColor: 'rgba(0, 0, 0, 0.3)',
                            borderRadius: '4px',
                        }}>
                            Your neural interface is requesting to refresh the Babachain connection.
                            This will reinitialize your session with the latest quantum state synchronization.
                            <br /><br />
                            Proceed with neuroveil refresh?
                        </div>

                        <div style={{
                            display: 'flex',
                            gap: '15px',
                            justifyContent: 'center',
                        }}>
                            <button
                                onClick={handleRefreshConfirm}
                                style={{
                                    background: 'linear-gradient(135deg, rgba(255, 140, 0, 0.8), rgba(200, 100, 0, 0.9))',
                                    color: '#ffffff',
                                    border: '2px solid #ff8c00',
                                    borderRadius: '8px',
                                    padding: '15px 25px',
                                    fontFamily: '"Press Start 2P", cursive',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease',
                                    boxShadow: '0 0 15px rgba(255, 140, 0, 0.3), inset 0 0 10px rgba(255, 140, 0, 0.1)',
                                    textShadow: '0 0 5px currentColor',
                                    position: 'relative',
                                    overflow: 'hidden',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 160, 20, 0.9), rgba(220, 120, 10, 1))';
                                    e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                                    e.currentTarget.style.boxShadow = '0 0 25px rgba(255, 140, 0, 0.6), inset 0 0 15px rgba(255, 140, 0, 0.2)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 140, 0, 0.8), rgba(200, 100, 0, 0.9))';
                                    e.currentTarget.style.transform = 'translateY(0px) scale(1)';
                                    e.currentTarget.style.boxShadow = '0 0 15px rgba(255, 140, 0, 0.3), inset 0 0 10px rgba(255, 140, 0, 0.1)';
                                }}
                            >
                                REFRESH NEUROVEIL
                            </button>
                            
                            <button
                                onClick={handleRefreshCancel}
                                style={{
                                    background: 'linear-gradient(135deg, rgba(20, 40, 80, 0.8), rgba(10, 30, 70, 0.9))',
                                    color: '#ffffff',
                                    border: '2px solid #00aaff',
                                    borderRadius: '8px',
                                    padding: '15px 25px',
                                    fontFamily: '"Press Start 2P", cursive',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease',
                                    boxShadow: '0 0 15px rgba(0, 170, 255, 0.3), inset 0 0 10px rgba(0, 170, 255, 0.1)',
                                    textShadow: '0 0 5px currentColor',
                                    position: 'relative',
                                    overflow: 'hidden',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(30, 50, 100, 0.9), rgba(15, 40, 90, 1))';
                                    e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                                    e.currentTarget.style.boxShadow = '0 0 25px rgba(0, 170, 255, 0.6), inset 0 0 15px rgba(0, 170, 255, 0.2)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(20, 40, 80, 0.8), rgba(10, 30, 70, 0.9))';
                                    e.currentTarget.style.transform = 'translateY(0px) scale(1)';
                                    e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 170, 255, 0.3), inset 0 0 10px rgba(0, 170, 255, 0.1)';
                                }}
                            >
                                CANCEL
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <GameCanvas
                players={players}
                trees={trees}
                clouds={clouds}
                stones={stones}
                campfires={campfires}
                mushrooms={mushrooms}
                hemps={hemps}
                reeds={reeds}
                corns={corns}
                potatoes={potatoes}
                pumpkins={pumpkins}
                droppedItems={droppedItems}
                woodenStorageBoxes={woodenStorageBoxes}
                sleepingBags={sleepingBags}
                playerPins={playerPins}
                playerCorpses={playerCorpses}
                stashes={stashes}
                plantedSeeds={plantedSeeds}
                wildAnimals={wildAnimals}
                viperSpittles={viperSpittles}
                animalCorpses={animalCorpses}
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
                isFishing={isFishing}
                lanterns={lanterns}
                playerDrinkingCooldowns={playerDrinkingCooldowns}
                rainCollectors={rainCollectors}
                waterPatches={waterPatches}
                setMusicPanelVisible={setIsMusicPanelVisible}
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
                lanterns={lanterns}
                woodenStorageBoxes={woodenStorageBoxes}
                playerCorpses={playerCorpses}
                stashes={stashes}
                rainCollectors={rainCollectors}
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
            <MusicControlPanel 
                musicSystem={musicSystem}
                musicVolume={musicVolume}
                onMusicVolumeChange={onMusicVolumeChange}
                isVisible={isMusicPanelVisible}
            />
            <Chat 
                connection={connection}
                messages={messages} 
                players={players}
                isChatting={isChatting}
                setIsChatting={setIsChatting}
                localPlayerIdentity={localPlayerId}
                onSOVAMessageAdderReady={handleSOVAMessageAdderReady}
                worldState={worldState}
                localPlayer={localPlayer}
                itemDefinitions={itemDefinitions}
                activeEquipments={activeEquipments}
                inventoryItems={inventoryItems}
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

            <FishingManager
                localPlayer={localPlayer || null}
                playerIdentity={playerIdentity}
                activeItemDef={activeItemDef}
                gameCanvasRef={canvasRef}
                cameraOffsetX={cameraOffsetX}
                cameraOffsetY={cameraOffsetY}
                connection={connection}
                // 🎣 FISHING INPUT FIX: Add callback to track fishing state
                onFishingStateChange={setIsFishing}
                // Add fishing sessions and players for rendering other players' fishing
                fishingSessions={fishingSessions}
                players={players}
                // Add worldState for weather information
                worldState={worldState}
                isWaterTile={(worldX: number, worldY: number) => {
                    if (!connection) return false;
                    
                    // Debug database once
                    if (!(window as any).dbDebugged) {
                        (window as any).dbDebugged = true;
                        console.log('[WATER DEBUG] Database tables:', Object.keys(connection.db));
                        console.log('[WATER DEBUG] WorldTile exists:', !!connection.db.worldTile);
                        
                        if (connection.db.worldTile) {
                            const allTiles = Array.from(connection.db.worldTile.iter());
                            console.log('[WATER DEBUG] Total tiles in DB:', allTiles.length);
                            if (allTiles.length > 0) {
                                console.log('[WATER DEBUG] Sample tiles:', allTiles.slice(0, 3));
                            }
                        }
                        
                        // Also check worldTiles prop
                        console.log('[WATER DEBUG] WorldTiles prop size:', worldTiles.size);
                        if (worldTiles.size > 0) {
                            const sampleEntries = Array.from(worldTiles.entries()).slice(0, 3);
                            console.log('[WATER DEBUG] Sample worldTiles entries:', sampleEntries);
                        }
                    }
                    
                    // Use the exact same algorithm as placementRenderingUtils.ts
                    const tileX = Math.floor(worldX / 48); // TILE_SIZE is 48, not 32!
                    const tileY = Math.floor(worldY / 48);
                    
                    // Check all world tiles to find the one at this position
                    for (const tile of connection.db.worldTile.iter()) {
                        if (tile.worldX === tileX && tile.worldY === tileY) {
                            // Found the tile at this position, check if it's water
                            return tile.tileType.tag === 'Sea';
                        }
                    }
                    
                    // No tile found at this position, assume it's not water
                    return false;
                }}
            />

            {/* SOVA Loading Bar - positioned above hotbar */}
            <SOVALoadingBar
                isRecording={sovaLoadingState.isRecording}
                isTranscribing={sovaLoadingState.isTranscribing}
                isGeneratingResponse={sovaLoadingState.isGeneratingResponse}
                isSynthesizingVoice={sovaLoadingState.isSynthesizingVoice}
                isPlayingAudio={sovaLoadingState.isPlayingAudio}
                currentPhase={sovaLoadingState.currentPhase}
            />

            {/* Voice Interface - SOVA Voice Commands */}
            <VoiceInterface
                isVisible={voiceState.isVisible}
                onTranscriptionComplete={handleTranscriptionComplete}
                onError={handleVoiceError}
                onAddSOVAMessage={sovaMessageAdder}
                localPlayerIdentity={localPlayerId}
                worldState={worldState}
                localPlayer={localPlayer}
                itemDefinitions={itemDefinitions}
                activeEquipments={activeEquipments}
                inventoryItems={inventoryItems}
                onLoadingStateChange={handleSOVALoadingStateChange}
            />

        </div>
    );
};

export default GameScreen; 