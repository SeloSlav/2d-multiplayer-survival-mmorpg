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

import { useState, useEffect, useRef, useCallback } from 'react';

// Components
import LoginScreen from './components/LoginScreen';
import GameScreen from './components/GameScreen';

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
import { PLAYER_BOX_INTERACTION_DISTANCE_SQUARED } from './utils/renderers/woodenStorageBoxRenderingUtils';
import { PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED } from './utils/renderers/campfireRenderingUtils';
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
        loginRedirect
    } = useAuth();
    
    // --- Core Hooks --- 
    const {
        connection,
        dbIdentity, // Get the derived SpacetimeDB identity
        isConnected: spacetimeConnected, // Rename for clarity
        isLoading: spacetimeLoading, // Rename for clarity
        error: connectionError,
        registerPlayer,
    } = useGameConnection();

    // --- Player Actions ---
    const {
        updatePlayerPosition,
        setSprinting,
        jump,
        updateViewport,
    } = usePlayerActions();

    const [placementState, placementActions] = usePlacementManager(connection);
    const { placementInfo, placementError } = placementState; // Destructure state
    const { cancelPlacement, startPlacement } = placementActions; // Destructure actions

    const { interactingWith, handleSetInteractingWith } = useInteractionManager();

    const { draggedItemInfo, dropError, handleItemDragStart, handleItemDrop } = useDragDropManager({ connection, interactingWith, playerIdentity: dbIdentity });

    // --- App-Level State --- 
    const [isRegistering, setIsRegistering] = useState<boolean>(false); // Still track registration attempt
    const [uiError, setUiError] = useState<string | null>(null);
    const [isMinimapOpen, setIsMinimapOpen] = useState<boolean>(false);
    const [isChatting, setIsChatting] = useState<boolean>(false);

    // --- Viewport State & Refs ---
    const [currentViewport, setCurrentViewport] = useState<{ minX: number, minY: number, maxX: number, maxY: number } | null>(null);
    const lastSentViewportCenterRef = useRef<{ x: number, y: number } | null>(null);
    const localPlayerRef = useRef<any>(null); // Ref to hold local player data

    // --- Pass viewport state to useSpacetimeTables ---
    const { 
      players, trees, clouds, stones, campfires, mushrooms, corns, potatoes, pumpkins, hemps,
      itemDefinitions, 
      inventoryItems, worldState, activeEquipments, droppedItems, 
      woodenStorageBoxes, recipes, craftingQueueItems, localPlayerRegistered,
      messages,
      playerPins, // Destructure playerPins
      activeConnections, // <<< Destructure here
      sleepingBags, // ADD destructuring
      playerCorpses, // <<< ADD playerCorpses destructuring
      stashes, // <<< ADD stashes destructuring
      activeConsumableEffects, // <<< ADD activeConsumableEffects destructuring
      grass, // <<< ADD grass destructuring
      knockedOutStatus, // <<< ADD knockedOutStatus destructuring
      rangedWeaponStats, // Ensure this is destructured
      projectiles, // Ensure this is destructured
      deathMarkers, // Ensure this is destructured
      shelters, // <<< ADD shelters HERE
      worldTiles, // <<< ADD worldTiles HERE
      minimapCache // <<< ADD minimapCache HERE
    } = useSpacetimeTables({ 
        connection, 
        cancelPlacement, 
        viewport: currentViewport, 
    });

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

    // --- Action Handlers --- 
    const handleAttemptRegisterPlayer = useCallback(async (usernameToRegister: string | null): Promise<void> => {
        setUiError(null);
        // Ensure we are authenticated and connected before registering
        if (!isAuthenticated || !spacetimeConnected) {
            console.error("Cannot register player: Not authenticated or not connected to SpacetimeDB.");
            const errorMessage = "Connection error, cannot register.";
            setUiError(errorMessage);
            throw new Error(errorMessage);
        }
        // Validate the username passed from the LoginScreen
        if (!usernameToRegister || !usernameToRegister.trim()) { 
             const errorMessage = "Username cannot be empty.";
             setUiError(errorMessage);
             throw new Error(errorMessage);
        }
        
        setIsRegistering(true);
        try {
            // Call the SpacetimeDB registerPlayer reducer with the provided username
            await registerPlayer(usernameToRegister);
        } catch (error) {
            setIsRegistering(false);
            throw error; // Re-throw to let LoginScreen handle the error display
        }
    }, [registerPlayer, isAuthenticated, spacetimeConnected]);

    // --- Global Window Effects --- 
    useEffect(() => {
        // Prevent global context menu unless placing item
        const handleGlobalContextMenu = (event: MouseEvent) => {
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

            // Prevent global context menu unless placing item (moved from other effect)
            if (event.key === 'ContextMenu' && !placementInfoRef.current) {
                event.preventDefault();
            }

            // Other global keybinds could go here if needed
        };

        // Prevent global context menu unless placing item (separate listener for clarity)
        const handleGlobalContextMenu = (event: MouseEvent) => {
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
    }, [isChatting]); // <<< Add isChatting dependency

    // --- Effect to manage registration state based on table hook --- 
    useEffect(() => {
         if (localPlayerRegistered && isRegistering) {
             // console.log("[AppContent] Player registered, setting isRegistering = false");
             setIsRegistering(false);
         }
         // Maybe add logic here if registration fails?
         // Currently, errors are shown via connectionError or uiError
    }, [localPlayerRegistered, isRegistering]);

    // --- Effect to automatically clear interactionTarget if player moves too far ---
    useEffect(() => {
        const player = localPlayerRef.current;
        if (!player || !interactingWith) {
            // No player or not interacting with anything, so nothing to check.
            return;
        }

        let entityPosition: { x: number, y: number } | null = null;
        let interactionDistanceSquared: number | null = null;

        switch (interactingWith.type) {
            case 'wooden_storage_box':
                const box = woodenStorageBoxes.get(interactingWith.id.toString());
                if (box) {
                    entityPosition = { x: box.posX, y: box.posY };
                    interactionDistanceSquared = PLAYER_BOX_INTERACTION_DISTANCE_SQUARED;
                }
                break;
            case 'campfire':
                const campfire = campfires.get(interactingWith.id.toString());
                if (campfire) {
                    entityPosition = { x: campfire.posX, y: campfire.posY };
                    interactionDistanceSquared = PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED;
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
            const dx = player.positionX - entityPosition.x;
            const dy = player.positionY - entityPosition.y;
            const currentDistSq = dx * dx + dy * dy;

            if (currentDistSq > interactionDistanceSquared) {
                // console.log(`[AppContent] Player moved too far from ${interactingWith.type} (ID: ${interactingWith.id}). Clearing interaction.`);
                handleSetInteractingWith(null);
            }
        }
    }, [
        interactingWith, 
        players, // Depends on localPlayer, which comes from players map
        woodenStorageBoxes, 
        campfires, 
        stashes, 
        playerCorpses, // Add playerCorpses to dependency array
        handleSetInteractingWith
    ]); // Add other entity maps to dependency array if new cases are added

    // --- Determine overall loading state ---
    // Loading if either Auth is loading OR SpacetimeDB connection is loading
    const overallIsLoading = authLoading || (isAuthenticated && spacetimeLoading);

    // --- Determine combined error message ---
    const displayError = connectionError || uiError || placementError || dropError;

    // --- Find the logged-in player data from the tables --- 
    const loggedInPlayer = dbIdentity ? players.get(dbIdentity.toHexString()) ?? null : null;

    // --- Render Logic --- 
    // console.log("[AppContent] Rendering. Hemps map:", hemps); // <<< TEMP DEBUG LOG
    return (
        <div className="App" style={{ backgroundColor: '#111' }}>
            {/* Display combined errors */} 
            {displayError && <div className="error-message">{displayError}</div>}

            {/* Show loading screen */} 
            {overallIsLoading && (
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'center', 
                    alignItems: 'center', 
                    height: '100vh',
                    color: 'white',
                    fontFamily: '"Press Start 2P", cursive'
                }}>
                    {authLoading ? 'Authenticating...' : 'Connecting to Server...'}
                </div>
            )}

            {/* Conditional Rendering: Login vs Game (only if not loading) */} 
            {!overallIsLoading && !isAuthenticated && (
                 <LoginScreen
                    handleJoinGame={loginRedirect} // Correctly pass loginRedirect
                    loggedInPlayer={null} 
                 />
            )}

            {/* If authenticated but not yet registered/connected to game */}
            {!overallIsLoading && isAuthenticated && !localPlayerRegistered && (
                 <LoginScreen 
                    handleJoinGame={handleAttemptRegisterPlayer} // Pass the updated handler
                    loggedInPlayer={null} 
                 />
            )}
            
            {/* If authenticated AND registered/game ready */}
            {!overallIsLoading && isAuthenticated && localPlayerRegistered && loggedInPlayer && (
                (() => { 
                    const localPlayerIdentityHex = dbIdentity ? dbIdentity.toHexString() : undefined;
                    return (
                        <GameScreen 
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
                            playerCorpses={playerCorpses}
                            stashes={stashes}
                            shelters={shelters}
                            worldTiles={worldTiles}
                            minimapCache={minimapCache}
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
                            updatePlayerPosition={updatePlayerPosition}
                            callJumpReducer={jump}
                            callSetSprintingReducer={setSprinting}
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
