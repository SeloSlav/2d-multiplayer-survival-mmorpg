/**
 * App.tsx
 * 
 * Main application component.
 * Handles:
 *  - Initializing all core application hooks (connection, tables, placement, drag/drop, interaction).
 *  - Managing top-level application state (connection status, registration status).
 *  - Conditionally rendering either the `LoginScreen` or the main `GameScreen`.
 *  - Displaying global errors (connection, UI, etc.).
 *  - Passing down necessary state and action callbacks to the active screen (`LoginScreen` or `GameScreen`).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// Components
import LoginScreen from './components/LoginScreen';
import GameScreen from './components/GameScreen';
import CyberpunkLoadingScreen, { CyberpunkErrorBar } from './components/CyberpunkLoadingScreen';

// Context Providers
import { GameContextsProvider } from './contexts/GameContexts';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DebugProvider } from './contexts/DebugContext';

// Hooks
import { useGameConnection } from './contexts/GameConnectionContext';
import { usePlayerActions } from './contexts/PlayerActionsContext';
import { useSpacetimeTables } from './hooks/useSpacetimeTables';
import { usePlacementManager } from './hooks/usePlacementManager';
import { useDragDropManager } from './hooks/useDragDropManager';
import { useInteractionManager } from './hooks/useInteractionManager';
import { useAuthErrorHandler } from './hooks/useAuthErrorHandler';
import { useMovementInput } from './hooks/useMovementInput';
import { usePredictedMovement } from './hooks/usePredictedMovement';
import { useSoundSystem } from './hooks/useSoundSystem';
import { useMusicSystem } from './hooks/useMusicSystem';

// Assets & Styles
import './App.css';
import { useDebouncedCallback } from 'use-debounce'; // Import debounce helper

// Viewport constants
const VIEWPORT_WIDTH = 1200; // Example: Base viewport width
const VIEWPORT_HEIGHT = 800; // Example: Base viewport height
const VIEWPORT_BUFFER = 1200; // Increased buffer (was 600) to create larger "chunks" of visible area
const VIEWPORT_UPDATE_THRESHOLD_SQ = (VIEWPORT_WIDTH / 2) ** 2; // Increased threshold (was WIDTH/4), so updates happen less frequently
const VIEWPORT_UPDATE_DEBOUNCE_MS = 750; // Increased debounce time (was 250ms) to reduce update frequency

// Import interaction distance constants directly from their respective rendering utility files
import { PLAYER_BOX_INTERACTION_DISTANCE_SQUARED, BOX_HEIGHT } from './utils/renderers/woodenStorageBoxRenderingUtils';
import { PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED, CAMPFIRE_HEIGHT, CAMPFIRE_RENDER_Y_OFFSET } from './utils/renderers/campfireRenderingUtils';
import { PLAYER_FURNACE_INTERACTION_DISTANCE_SQUARED, FURNACE_HEIGHT, FURNACE_RENDER_Y_OFFSET } from './utils/renderers/furnaceRenderingUtils'; // ADDED: Furnace interaction constants
import { PLAYER_STASH_INTERACTION_DISTANCE_SQUARED } from './utils/renderers/stashRenderingUtils';
import { PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED } from './utils/renderers/playerCorpseRenderingUtils';
// Add other relevant interaction distances if new interactable container types are added

// Import the cut grass effect system
import { initCutGrassEffectSystem, cleanupCutGrassEffectSystem } from './effects/cutGrassEffect';

function AppContent() {
    // --- Global Auth Error Handler ---
    useAuthErrorHandler(); // This will automatically handle 401 errors and invalidate tokens
    
    // --- Auth Hook ---
    const { 
        userProfile, 
        isAuthenticated, 
        isLoading: authLoading, 
        loginRedirect,
        spacetimeToken
    } = useAuth();
    
    // --- Core Hooks --- 
    const {
        connection,
        dbIdentity, // Get the derived SpacetimeDB identity
        isConnected: spacetimeConnected, // Rename for clarity
        isLoading: spacetimeLoading, // Rename for clarity
        error: connectionError,
        registerPlayer,
        retryConnection,
    } = useGameConnection();

    // --- Player Actions ---
    const {
        updateViewport,
        updatePlayerPosition,
        setSprinting,
        stopAutoWalk, // Added for auto-walk management
        toggleAutoAttack, // Added for auto-attack functionality
    } = usePlayerActions();

    const [placementState, placementActions] = usePlacementManager(connection);
    const { placementInfo, placementError } = placementState; // Destructure state
    const { cancelPlacement, startPlacement } = placementActions; // Destructure actions

    const { interactingWith, handleSetInteractingWith } = useInteractionManager();

    const { draggedItemInfo, dropError, handleItemDragStart, handleItemDrop } = useDragDropManager({ connection, interactingWith, playerIdentity: dbIdentity });

    // --- App-Level State --- 
    const [isRegistering, setIsRegistering] = useState<boolean>(false);
    const [uiError, setUiError] = useState<string | null>(null);
    const [isMinimapOpen, setIsMinimapOpen] = useState<boolean>(false);
    const [isChatting, setIsChatting] = useState<boolean>(false);
    const [isCraftingSearchFocused, setIsCraftingSearchFocused] = useState(false);
    // Auto-walking state is now managed by PlayerActionsContext via usePredictedMovement
    const [loadingSequenceComplete, setLoadingSequenceComplete] = useState<boolean>(false);
    // 🎣 FISHING INPUT FIX: Add fishing state to App level
    const [isFishing, setIsFishing] = useState(false);
    // Music panel state
    const [isMusicPanelVisible, setIsMusicPanelVisible] = useState(false);
    
    // --- Volume Settings State ---
    const [musicVolume, setMusicVolume] = useState(() => {
        const saved = localStorage.getItem('musicVolume');
        return saved ? Math.min(parseFloat(saved), 1.0) : 0.5; // 50% default (0.5 out of 1.0 max)
    });
    const [soundVolume, setSoundVolume] = useState(() => {
        const saved = localStorage.getItem('soundVolume');
        return saved ? Math.min(parseFloat(saved), 1.0) : 0.8; // 80% default (0.8 out of 1.0 max)
    });
    const [environmentalVolume, setEnvironmentalVolume] = useState(() => {
        const saved = localStorage.getItem('environmentalVolume');
        return saved ? Math.min(parseFloat(saved), 1.0) : 0.7; // 70% default (0.7 out of 1.0 max)
    });
    
    // --- Volume Change Handlers ---
    const handleMusicVolumeChange = useCallback((volume: number) => {
        console.log(`[App] handleMusicVolumeChange called with: ${volume.toFixed(3)}`);
        setMusicVolume(volume);
        localStorage.setItem('musicVolume', volume.toString());
    }, []);
    
    const handleSoundVolumeChange = useCallback((volume: number) => {
        console.log(`[App] handleSoundVolumeChange called with: ${volume.toFixed(3)}`);
        setSoundVolume(volume);
        localStorage.setItem('soundVolume', volume.toString());
    }, []);
    
    const handleEnvironmentalVolumeChange = useCallback((volume: number) => {
        console.log(`[App] handleEnvironmentalVolumeChange called with: ${volume.toFixed(3)}`);
        setEnvironmentalVolume(volume);
        localStorage.setItem('environmentalVolume', volume.toString());
    }, []);

    // --- Viewport State & Refs ---
    const [currentViewport, setCurrentViewport] = useState<{ minX: number, minY: number, maxX: number, maxY: number } | null>(null);
    const lastSentViewportCenterRef = useRef<{ x: number, y: number } | null>(null);
    const localPlayerRef = useRef<any>(null); // Ref to hold local player data
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // --- Pass viewport state to useSpacetimeTables ---
    const { 
      players, trees, clouds, stones, campfires, furnaces, lanterns, // ADDED: furnaces
      harvestableResources,
      itemDefinitions, 
      inventoryItems, worldState, activeEquipments, droppedItems, 
      woodenStorageBoxes, recipes, craftingQueueItems, localPlayerRegistered,
      messages,
      playerPins, // Destructure playerPins
      activeConnections, // <<< Destructure here
      sleepingBags, // ADD destructuring
      playerCorpses, // <<< ADD playerCorpses destructuring
      stashes, // <<< ADD stashes destructuring
      rainCollectors, // <<< ADD rainCollectors destructuring
      waterPatches, // <<< ADD waterPatches destructuring
      activeConsumableEffects, // <<< ADD activeConsumableEffects destructuring
      grass, // <<< ADD grass destructuring
      knockedOutStatus, // <<< ADD knockedOutStatus destructuring
      rangedWeaponStats, // Ensure this is destructured
      projectiles, // Ensure this is destructured
      deathMarkers, // Ensure this is destructured
      shelters, // <<< ADD shelters HERE
      plantedSeeds, // <<< ADD plantedSeeds HERE
      worldTiles, // <<< ADD worldTiles HERE
      minimapCache, // <<< ADD minimapCache HERE
      fishingSessions, // <<< ADD fishingSessions HERE
      soundEvents, // <<< ADD soundEvents HERE
      continuousSounds, // <<< ADD continuousSounds HERE
      localPlayerIdentity, // <<< ADD localPlayerIdentity HERE
      playerDrinkingCooldowns, // <<< ADD playerDrinkingCooldowns HERE
      wildAnimals, // <<< ADD wildAnimals HERE
      viperSpittles, // <<< ADD viperSpittles HERE
      animalCorpses, // <<< ADD animalCorpses HERE (NON-SPATIAL)
      barrels, // <<< ADD barrels HERE
      seaStacks, // <<< ADD sea stacks HERE
    } = useSpacetimeTables({ 
        connection, 
        cancelPlacement, 
        viewport: currentViewport, 
    });

    // --- Movement Hooks ---
    const isUIFocused = isChatting || isCraftingSearchFocused;
    const localPlayer = dbIdentity ? players.get(dbIdentity.toHexString()) : undefined;
    
    // Simplified movement input - no complex processing
    const { inputState } = useMovementInput({ 
        isUIFocused,
        localPlayer,
        onToggleAutoAttack: toggleAutoAttack, // Keep auto-attack functionality
        // 🎣 FISHING INPUT FIX: Pass fishing state to disable input during fishing
        isFishing,
    });
    
    // Simplified predicted movement - minimal lag
    const { predictedPosition, isAutoAttacking, facingDirection } = usePredictedMovement({
        localPlayer,
        inputState,
        connection,
        isUIFocused,
        entities: {
            trees,
            stones,
            boxes: woodenStorageBoxes,
            rainCollectors,
            shelters,
            players,
            wildAnimals, // Add wild animals to collision system
            barrels // Add barrels to collision system
        }
    });

    // --- Sound System ---
    const localPlayerPosition = predictedPosition ? { x: predictedPosition.x, y: predictedPosition.y } : null;
    const soundSystemState = useSoundSystem({
        soundEvents,
        continuousSounds,
        localPlayerPosition,
        localPlayerIdentity,
        masterVolume: soundVolume,
        environmentalVolume: environmentalVolume,
    });

    // --- Music System ---
    const musicSystem = useMusicSystem({
        enabled: true,
        volume: musicVolume,
        crossfadeDuration: 3000, // 3 second crossfade
        shuffleMode: true,
        preloadAll: true,
    });
    
    // Update music volume when state changes
    useEffect(() => {
        if (musicSystem.setVolume) {
            musicSystem.setVolume(musicVolume);
        }
    }, [musicVolume, musicSystem.setVolume]);

    // --- Game Performance Monitor ---
    useEffect(() => {
        let frameCount = 0;
        let lastReportTime = Date.now();
        let totalRenderTime = 0;
        let maxRenderTime = 0;
        let lagSpikes = 0;
        
        const RENDER_LAG_THRESHOLD = 20; // 20ms+ is a lag spike
        const REPORT_INTERVAL = 10000; // Report every 10 seconds
        
        const monitorPerformance = () => {
            const frameStart = performance.now();
            
            // Monitor after the current render cycle
            requestAnimationFrame(() => {
                const frameEnd = performance.now();
                const frameTime = frameEnd - frameStart;
                
                frameCount++;
                totalRenderTime += frameTime;
                maxRenderTime = Math.max(maxRenderTime, frameTime);
                
                if (frameTime > RENDER_LAG_THRESHOLD) {
                    lagSpikes++;
                    // console.warn(`🐌 [App] RENDER LAG SPIKE: ${frameTime.toFixed(2)}ms`);
                }
                
                const now = Date.now();
                if (now - lastReportTime > REPORT_INTERVAL) {
                    const avgRenderTime = totalRenderTime / frameCount;
                    const fps = 1000 / avgRenderTime;
                    
                    // console.log(`📊 [App] Game Performance Report:
                    //     Frames: ${frameCount}
                    //     Average Render Time: ${avgRenderTime.toFixed(2)}ms
                    //     Max Render Time: ${maxRenderTime.toFixed(2)}ms
                    //     Estimated FPS: ${fps.toFixed(1)}
                    //     Lag Spikes: ${lagSpikes} (${((lagSpikes/frameCount)*100).toFixed(1)}%)
                    //     Players Count: ${players.size}
                    //     Connection Status: ${connection ? 'Connected' : 'Disconnected'}`);
                    
                    // Reset counters
                    frameCount = 0;
                    totalRenderTime = 0;
                    maxRenderTime = 0;
                    lagSpikes = 0;
                    lastReportTime = now;
                }
                
                // Continue monitoring
                monitorPerformance();
            });
        };
        
        // Start monitoring
        monitorPerformance();
        
        // No cleanup needed as we're using requestAnimationFrame
    }, [players.size, connection]);

    // Note: Movement is now handled entirely by usePredictedMovement hook
    // No need for complex movement processing in App.tsx anymore

    // --- Refs for Cross-Hook/Component Communication --- 
    // Ref for Placement cancellation needed by useSpacetimeTables callbacks
    const cancelPlacementActionRef = useRef(cancelPlacement);
    useEffect(() => {
        cancelPlacementActionRef.current = cancelPlacement;
    }, [cancelPlacement]);
    // Ref for placementInfo needed for global context menu effect
    const placementInfoRef = useRef(placementInfo);
    useEffect(() => {
        placementInfoRef.current = placementInfo;
    }, [placementInfo]);

    // --- Debounced Viewport Update ---
    const debouncedUpdateViewport = useDebouncedCallback(
        (vp: { minX: number, minY: number, maxX: number, maxY: number }) => {
            // console.log(`[App] Calling debounced server viewport update: ${JSON.stringify(vp)}`);
            updateViewport(vp.minX, vp.minY, vp.maxX, vp.maxY);
            lastSentViewportCenterRef.current = { x: (vp.minX + vp.maxX) / 2, y: (vp.minY + vp.maxY) / 2 };
        },
        VIEWPORT_UPDATE_DEBOUNCE_MS
    );

    // --- Effect to Update Viewport Based on Player Position ---
    useEffect(() => {
        const localPlayer = connection?.identity ? players.get(connection.identity.toHexString()) : undefined;
        localPlayerRef.current = localPlayer; // Update ref whenever local player changes

        // If player is gone, dead, or not fully connected yet, clear viewport
        if (!localPlayer || localPlayer.isDead) {
             if (currentViewport) setCurrentViewport(null);
             // Consider if we need to tell the server the viewport is invalid?
             // Server might time out old viewports anyway.
             return;
        }

        const playerCenterX = localPlayer.positionX;
        const playerCenterY = localPlayer.positionY;

        // Check if viewport center moved significantly enough
        const lastSentCenter = lastSentViewportCenterRef.current;
        const shouldUpdate = !lastSentCenter ||
            (playerCenterX - lastSentCenter.x)**2 + (playerCenterY - lastSentCenter.y)**2 > VIEWPORT_UPDATE_THRESHOLD_SQ;

        if (shouldUpdate) {
            const newMinX = playerCenterX - (VIEWPORT_WIDTH / 2) - VIEWPORT_BUFFER;
            const newMaxX = playerCenterX + (VIEWPORT_WIDTH / 2) + VIEWPORT_BUFFER;
            const newMinY = playerCenterY - (VIEWPORT_HEIGHT / 2) - VIEWPORT_BUFFER;
            const newMaxY = playerCenterY + (VIEWPORT_HEIGHT / 2) + VIEWPORT_BUFFER;
            const newViewport = { minX: newMinX, minY: newMinY, maxX: newMaxX, maxY: newMaxY };

            // console.log(`[App] Viewport needs update. Triggering debounced call.`);
            setCurrentViewport(newViewport); // Update local state immediately for useSpacetimeTables
            debouncedUpdateViewport(newViewport); // Call debounced server update
        }
    // Depend on the players map (specifically the local player's position), connection identity, and app connected status.
    }, [players, connection?.identity, debouncedUpdateViewport]); // Removed currentViewport dependency to avoid loops

    // --- Effect to initialize and cleanup cut grass effect system ---
    useEffect(() => {
        if (connection && localPlayerRegistered) {
            // console.log("[App.tsx] Initializing CutGrassEffectSystem...");
            initCutGrassEffectSystem(connection);

            return () => {
                // console.log("[App.tsx] Cleaning up CutGrassEffectSystem...");
                cleanupCutGrassEffectSystem();
            };
        }
    }, [connection, localPlayerRegistered]);

    // --- Action Handlers will be defined after loggedInPlayer is available ---

    // --- Global Window Effects --- 
    useEffect(() => {
        // Prevent global context menu unless placing item
        const handleGlobalContextMenu = (event: MouseEvent) => {
            // Don't prevent context menu when dragging sliders or if game menu is open
            if (document.body.style.cursor === 'grabbing') {
                return;
            }
            
            if (!placementInfoRef.current) { // Use ref to check current placement status
                event.preventDefault();
            }
        };
        window.addEventListener('contextmenu', handleGlobalContextMenu);
        return () => {
            window.removeEventListener('contextmenu', handleGlobalContextMenu);
        };
    }, []); // Empty dependency array: run only once on mount

    // --- Effect to handle global key presses that aren't directly game actions ---
    useEffect(() => {
        const handleGlobalKeyDown = (event: KeyboardEvent) => {
            // If chat is active, let the Chat component handle Enter/Escape
            if (isChatting) return;

            // Don't handle keys when dragging sliders
            if (document.body.style.cursor === 'grabbing') {
                return;
            }

            // Auto-walk functionality removed

            // Prevent global context menu unless placing item (moved from other effect)
            if (event.key === 'ContextMenu' && !placementInfoRef.current) {
                event.preventDefault();
            }

            // Other global keybinds could go here if needed
        };

        // Prevent global context menu unless placing item (separate listener for clarity)
        const handleGlobalContextMenu = (event: MouseEvent) => {
            // Don't prevent context menu when dragging sliders
            if (document.body.style.cursor === 'grabbing') {
                return;
            }
            
            if (!placementInfoRef.current) { // Use ref to check current placement status
                event.preventDefault();
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        window.addEventListener('contextmenu', handleGlobalContextMenu);

        return () => {
            window.removeEventListener('keydown', handleGlobalKeyDown);
            window.removeEventListener('contextmenu', handleGlobalContextMenu);
        };
    }, [isChatting]); // Removed isAutoWalking dependency

    // --- Effect to manage registration state based on table hook --- 
    useEffect(() => {
         if (localPlayerRegistered && isRegistering) {
             // console.log("[AppContent] Player registered, setting isRegistering = false");
             setIsRegistering(false);
         }
         // Auto-walk functionality removed
         // Maybe add logic here if registration fails?
         // Currently, errors are shown via connectionError or uiError
    }, [localPlayerRegistered, isRegistering]);

    // --- Effect to automatically clear interactionTarget if player moves too far ---
    useEffect(() => {
        // Get the current local player directly instead of relying on ref
        const localPlayer = connection?.identity ? players.get(connection.identity.toHexString()) : undefined;
        
        if (!localPlayer || !interactingWith) {
            // No player or not interacting with anything, so nothing to check.
            return;
        }

        // Add a small delay to prevent immediate clearing when interaction is first set
        const timeoutId = setTimeout(() => {
            // Re-get the current player to ensure we have the latest position
            const currentPlayer = connection?.identity ? players.get(connection.identity.toHexString()) : undefined;
            if (!currentPlayer || !interactingWith) return;

            let entityPosition: { x: number, y: number } | null = null;
            let interactionDistanceSquared: number | null = null;

            switch (interactingWith.type) {
                case 'wooden_storage_box':
                    const box = woodenStorageBoxes.get(interactingWith.id.toString());
                    if (box) {
                        // Use the visual center of the box (middle of the visible sprite)
                        const visualCenterY = box.posY - (BOX_HEIGHT / 2) - 20;
                        entityPosition = { x: box.posX, y: visualCenterY };
                        interactionDistanceSquared = PLAYER_BOX_INTERACTION_DISTANCE_SQUARED;
                    }
                    break;
                case 'campfire':
                    const campfire = campfires.get(interactingWith.id.toString());
                    if (campfire) {
                        // Use the same visual center calculation as useInteractionFinder
                        const visualCenterY = campfire.posY - (CAMPFIRE_HEIGHT / 2) - CAMPFIRE_RENDER_Y_OFFSET;
                        entityPosition = { x: campfire.posX, y: visualCenterY };
                        interactionDistanceSquared = PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED;
                    }
                    break;
                case 'furnace': // ADDED: Furnace interaction distance handling
                    const furnace = furnaces.get(interactingWith.id.toString());
                    if (furnace) {
                        // Use the same visual center calculation as useInteractionFinder
                        const visualCenterY = furnace.posY - (FURNACE_HEIGHT / 2) - FURNACE_RENDER_Y_OFFSET;
                        entityPosition = { x: furnace.posX, y: visualCenterY };
                        interactionDistanceSquared = PLAYER_FURNACE_INTERACTION_DISTANCE_SQUARED;
                    }
                    break;
                case 'stash':
                    const stash = stashes.get(interactingWith.id.toString());
                    if (stash) {
                        entityPosition = { x: stash.posX, y: stash.posY };
                        interactionDistanceSquared = PLAYER_STASH_INTERACTION_DISTANCE_SQUARED;
                    }
                    break;
                case 'player_corpse': // Added case for player_corpse
                    // Player corpse ID is typically a bigint
                    const corpse = playerCorpses.get(interactingWith.id.toString());
                    if (corpse) {
                        entityPosition = { x: corpse.posX, y: corpse.posY };
                        interactionDistanceSquared = PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED;
                    }
                    break;
                default:
                    // Unknown interaction type, or type not handled for auto-closing.
                    return;
            }

            if (entityPosition && interactionDistanceSquared !== null) {
                const dx = currentPlayer.positionX - entityPosition.x;
                const dy = currentPlayer.positionY - entityPosition.y;
                const currentDistSq = dx * dx + dy * dy;

                console.log(`[App] Distance check for ${interactingWith.type} (ID: ${interactingWith.id}): distance=${Math.sqrt(currentDistSq).toFixed(1)}, threshold=${Math.sqrt(interactionDistanceSquared).toFixed(1)}`);

                if (currentDistSq > interactionDistanceSquared) {
                    console.log(`[App] Player moved too far from ${interactingWith.type} (ID: ${interactingWith.id}). Clearing interaction.`);
                    handleSetInteractingWith(null);
                }
            }
        }, 100); // Small delay to prevent immediate clearing

        return () => clearTimeout(timeoutId);
    }, [
        interactingWith, 
        players, // Re-add players dependency to trigger on position changes
        connection?.identity, // Add connection identity dependency
        woodenStorageBoxes, 
        campfires, 
        furnaces, // ADDED: Furnaces dependency
        stashes, 
        playerCorpses,
        handleSetInteractingWith
    ]); // Added back players dependency and connection identity to properly trigger on player position changes

    // --- Determine overall loading state ---
    // We'll determine this after loggedInPlayer and getStoredUsername are defined
    
    // Debug logging for loading states  
    // console.log(`[App DEBUG] authLoading: ${authLoading}, isAuthenticated: ${isAuthenticated}, spacetimeLoading: ${spacetimeLoading}, loadingSequenceComplete: ${loadingSequenceComplete}, shouldShowLoadingScreen: ${shouldShowLoadingScreen}`);

    // --- Handle loading sequence completion ---
    const handleSequenceComplete = useCallback(() => {
        console.log("[App] Loading sequence complete, setting loadingSequenceComplete to true");
        setLoadingSequenceComplete(true);
        
        // Start music when entering the game
        if (!musicSystem.isPlaying) {
            console.log("[App] Starting background music...");
            musicSystem.start().catch(error => {
                console.warn("[App] Failed to start music:", error);
            });
        }
    }, [musicSystem]);

    // Reset sequence completion when loading starts again - will be moved after shouldShowLoadingScreen is defined

    // --- Determine combined error message ---
    const displayError = connectionError || uiError || placementError || dropError;
    
    // Debug logging for connection error
    // if (connectionError) {
    //     console.log(`[App DEBUG] connectionError: ${connectionError}`);
    // }

    // --- Find the logged-in player data from the tables --- 
    const loggedInPlayer = dbIdentity ? players.get(dbIdentity.toHexString()) ?? null : null;

    // --- Store last known player info for connection error fallback ---
    useEffect(() => {
        if (loggedInPlayer && dbIdentity) {
            const playerInfo = {
                identity: dbIdentity.toHexString(),
                username: loggedInPlayer.username,
                lastStored: Date.now()
            };
            localStorage.setItem('lastKnownPlayerInfo', JSON.stringify(playerInfo));
        }
    }, [loggedInPlayer, dbIdentity]);

    // --- Action Handlers --- 
    const handleAttemptRegisterPlayer = useCallback(async (usernameToRegister: string | null): Promise<void> => {
        setUiError(null);
        
        // SECURITY: Multiple layers of authentication validation
        // Layer 1: Basic authentication check - Must be authenticated with OpenAuth
        if (!isAuthenticated) {
            console.error("SECURITY: Attempted player registration without proper authentication.");
            const errorMessage = "Authentication required. Please sign in to access the game.";
            throw new Error(errorMessage);
        }
        
        // Layer 2: Verify we have a valid spacetime token
        if (!spacetimeToken) {
            console.error("SECURITY: No valid SpacetimeDB token available for registration.");
            const errorMessage = "Authentication error, please sign out and sign in again.";
            throw new Error(errorMessage);
        }
        
        // Layer 3: Verify SpacetimeDB connection and identity
        // NOTE: For new users after database clearing, we need to allow some flexibility here
        // The connection might be established but identity might not be set yet
        if (!connection) {
            console.error("SECURITY: No valid SpacetimeDB connection for registration.");
            const errorMessage = spacetimeLoading ? 
                "Connecting to game servers, please wait..." : 
                "Please refresh your browser to re-establish connection.";
            throw new Error(errorMessage);
        }
        
        // If we have a connection but no identity yet, wait for it to be established
        if (!dbIdentity) {
            console.warn("SpacetimeDB identity not yet established, waiting for connection to complete...");
            const errorMessage = "Establishing connection, please wait a moment...";
            throw new Error(errorMessage);
        }
        
        // Layer 4: Check SpacetimeDB connection status
        // NOTE: We allow registration attempts even if spacetimeConnected is temporarily false,
        // as long as we have a connection object and identity. This handles the case where
        // the database was cleared and the user is trying to re-register.
        if (!spacetimeConnected) {
            console.warn("SpacetimeDB connection status is false, but proceeding with registration attempt since user is authenticated and has connection identity.");
        }
        
        // Layer 5: Handle existing player reconnection vs new registration
        if (!usernameToRegister || !usernameToRegister.trim()) {
            // This could be a returning player (no username provided)
            // OR a new player who forgot to enter username
            
            // If we have no player data and no username, this is likely an error
            if (!loggedInPlayer) {
                const errorMessage = "Username cannot be empty.";
                setUiError(errorMessage);
                throw new Error(errorMessage);
            }
            // If we have loggedInPlayer data, this is a reconnection attempt
            // The server will handle existing player reconnection in the register_player reducer
        }
        
        // Layer 6: Prevent duplicate registration attempts
        if (isRegistering) {
            console.warn("Registration already in progress, ignoring duplicate request.");
            return;
        }
        
        setIsRegistering(true);
        try {
            // Call the SpacetimeDB registerPlayer reducer 
            // The server handles both new registration and existing player reconnection
            const usernameToSend = usernameToRegister?.trim() || loggedInPlayer?.username || "Player";
            await registerPlayer(usernameToSend);
        } catch (error) {
            setIsRegistering(false);
            throw error; // Re-throw to let LoginScreen handle the error display
        }
    }, [registerPlayer, isAuthenticated, spacetimeConnected, spacetimeToken, connection, dbIdentity, isRegistering, loggedInPlayer]);

    // --- Get stored username for connection error cases ---
    const getStoredUsername = useMemo(() => {
        if (connectionError && isAuthenticated && dbIdentity) {
            const stored = localStorage.getItem('lastKnownPlayerInfo');
            if (stored) {
                try {
                    const playerInfo = JSON.parse(stored);
                    // Only use if it's for the same identity and within last 7 days
                    if (playerInfo.identity === dbIdentity.toHexString() && 
                        (Date.now() - playerInfo.lastStored) < 7 * 24 * 60 * 60 * 1000) {
                        return playerInfo.username;
                    }
                } catch (e) {
                    console.warn('[App] Failed to parse stored player info:', e);
                }
            }
        }
        return null;
    }, [connectionError, isAuthenticated, dbIdentity]);

    // --- Determine loading screen visibility ---
    // Loading screen should ONLY show when:
    // 1. User is authenticated AND has existing player data AND (auth loading OR connection not ready OR sequence not complete)
    // NEW USERS (no player data) NEVER see loading screen - they wait in LoginScreen or see black screen
    const hasPlayerDataOrUsername = loggedInPlayer || getStoredUsername;
    const isSpacetimeReady = !spacetimeLoading && !!connection && !!dbIdentity;
    const shouldShowLoadingScreen = isAuthenticated && hasPlayerDataOrUsername && (authLoading || !isSpacetimeReady || !loadingSequenceComplete);

    // Debug logging for loading states (enable when debugging)
    // console.log(`[App DEBUG] authLoading: ${authLoading}, isAuthenticated: ${isAuthenticated}, spacetimeLoading: ${spacetimeLoading}, connection: ${!!connection}, dbIdentity: ${!!dbIdentity}, isSpacetimeReady: ${isSpacetimeReady}, hasPlayerData: ${!!hasPlayerDataOrUsername}, shouldShowLoadingScreen: ${shouldShowLoadingScreen}`);

    // Track when isSpacetimeReady changes (key metric for connection readiness)
    useEffect(() => {
        console.log(`[App] isSpacetimeReady changed to: ${isSpacetimeReady} (spacetimeLoading: ${spacetimeLoading}, connection: ${!!connection}, dbIdentity: ${!!dbIdentity})`);
    }, [isSpacetimeReady, spacetimeLoading, connection, dbIdentity]);

    // Reset sequence completion when loading starts again
    useEffect(() => {
        if (shouldShowLoadingScreen && loadingSequenceComplete) {
            setLoadingSequenceComplete(false);
            
            // Stop music when returning to loading screen
            if (musicSystem.isPlaying) {
                console.log("[App] Stopping music due to returning to loading screen");
                musicSystem.stop();
            }
        }
    }, [shouldShowLoadingScreen, loadingSequenceComplete, musicSystem]);

    // --- Render Logic --- 
    // console.log("[AppContent] Rendering. Hemps map:", hemps); // <<< TEMP DEBUG LOG
    return (
        <div className="App" style={{ backgroundColor: '#111' }}>
            {/* Display combined errors */} 
            {displayError && <CyberpunkErrorBar message={displayError} />}

            {/* Show loading screen only when needed */} 
            {shouldShowLoadingScreen && (
                <CyberpunkLoadingScreen 
                    authLoading={authLoading}
                    spacetimeLoading={spacetimeLoading}
                    onSequenceComplete={handleSequenceComplete}
                    musicPreloadProgress={musicSystem.preloadProgress}
                    musicPreloadComplete={musicSystem.preloadProgress >= 1 && !musicSystem.isLoading}
                />
            )}

            {/* Conditional Rendering: Login vs Game (only if not showing loading screen) */}
            {!shouldShowLoadingScreen && !isAuthenticated && (
                 <LoginScreen
                    handleJoinGame={loginRedirect} // Correctly pass loginRedirect
                    loggedInPlayer={null}
                    connectionError={connectionError}
                    isSpacetimeConnected={spacetimeConnected}
                    isSpacetimeReady={isSpacetimeReady}
                    retryConnection={retryConnection}
                 />
            )}

            {/* If authenticated but not yet registered/connected to game */}
            {!shouldShowLoadingScreen && isAuthenticated && !localPlayerRegistered && (
                 <LoginScreen 
                    handleJoinGame={handleAttemptRegisterPlayer} // Pass the updated handler
                    loggedInPlayer={loggedInPlayer}
                    connectionError={connectionError}
                    storedUsername={getStoredUsername}
                    isSpacetimeConnected={spacetimeConnected}
                    isSpacetimeReady={isSpacetimeReady}
                    retryConnection={retryConnection}
                 />
            )}
            
            {/* If authenticated AND registered/game ready */}
            {!shouldShowLoadingScreen && isAuthenticated && localPlayerRegistered && loggedInPlayer && (
                (() => { 
                    const localPlayerIdentityHex = dbIdentity ? dbIdentity.toHexString() : undefined;
                    return (
                        <GameScreen 
                            players={players}
                            trees={trees}
                            clouds={clouds}
                            stones={stones}
                            campfires={campfires}
                            furnaces={furnaces} // ADDED: Furnaces prop
                            lanterns={lanterns}
                            harvestableResources={harvestableResources}
                            droppedItems={droppedItems}
                            woodenStorageBoxes={woodenStorageBoxes}
                            sleepingBags={sleepingBags}
                            playerCorpses={playerCorpses}
                            stashes={stashes}
                            shelters={shelters}
                            plantedSeeds={plantedSeeds}
                            worldTiles={worldTiles}
                            minimapCache={minimapCache}
                            wildAnimals={wildAnimals}
                            viperSpittles={viperSpittles}
                            animalCorpses={animalCorpses}
                            barrels={barrels}
                            seaStacks={seaStacks}
                            inventoryItems={inventoryItems}
                            itemDefinitions={itemDefinitions}
                            worldState={worldState}
                            activeEquipments={activeEquipments}
                            activeConnections={activeConnections}
                            recipes={recipes}
                            craftingQueueItems={craftingQueueItems}
                            localPlayerId={localPlayerIdentityHex} // Pass the hex string here
                            playerIdentity={dbIdentity} 
                            connection={connection}
                            placementInfo={placementInfo}
                            placementActions={placementActions}
                            placementError={placementError}
                            startPlacement={startPlacement}
                            cancelPlacement={cancelPlacement}
                            interactingWith={interactingWith}
                            handleSetInteractingWith={handleSetInteractingWith}
                            playerPins={playerPins}
                            draggedItemInfo={draggedItemInfo}
                            onItemDragStart={handleItemDragStart}
                            onItemDrop={handleItemDrop}
                            predictedPosition={predictedPosition}
                            canvasRef={canvasRef}
                            isMinimapOpen={isMinimapOpen}
                            setIsMinimapOpen={setIsMinimapOpen}
                            isChatting={isChatting}
                            setIsChatting={setIsChatting}
                            messages={messages}
                            activeConsumableEffects={activeConsumableEffects}
                            grass={grass}
                            knockedOutStatus={knockedOutStatus}
                            rangedWeaponStats={rangedWeaponStats}
                            projectiles={projectiles}
                            deathMarkers={deathMarkers}
                            setIsCraftingSearchFocused={setIsCraftingSearchFocused}
                            isCraftingSearchFocused={isCraftingSearchFocused}
                            onFishingStateChange={setIsFishing}
                            fishingSessions={fishingSessions}
                            musicSystem={musicSystem}
                            musicVolume={musicVolume}
                            soundVolume={soundVolume}
                            environmentalVolume={environmentalVolume}
                            onMusicVolumeChange={handleMusicVolumeChange}
                            onSoundVolumeChange={handleSoundVolumeChange}
                            onEnvironmentalVolumeChange={handleEnvironmentalVolumeChange}
                            soundSystem={soundSystemState}
                            playerDrinkingCooldowns={playerDrinkingCooldowns}
                            rainCollectors={rainCollectors}
                            waterPatches={waterPatches}
                            isMusicPanelVisible={isMusicPanelVisible}
                            setIsMusicPanelVisible={setIsMusicPanelVisible}
                        />
                    );
                })()
            )}
        </div>
    );
}

// Wrap the app with our context providers
function App() {
    return (
        <AuthProvider>
            <GameContextsProvider>
                <DebugProvider>
                    <AppContent />
                </DebugProvider>
            </GameContextsProvider>
        </AuthProvider>
    );
}
export default App;
