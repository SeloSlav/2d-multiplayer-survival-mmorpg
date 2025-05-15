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
import React from 'react';

// Components
import LoginScreen from './components/LoginScreen';
import GameScreen from './components/GameScreen';

// Context Providers
import { GameContextsProvider } from './contexts/GameContexts';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// Hooks
import { useGameConnection } from './contexts/GameConnectionContext';
import { usePlayerActions } from './contexts/PlayerActionsContext';
import { useSpacetimeTables } from './hooks/useSpacetimeTables';
import { usePlacementManager } from './hooks/usePlacementManager';
import { useDragDropManager } from './hooks/useDragDropManager';
import { useInteractionManager } from './hooks/useInteractionManager';

// Assets & Styles
import './App.css';
import { useDebouncedCallback } from 'use-debounce'; // Import debounce helper

// Viewport constants
const VIEWPORT_WIDTH = 1200; // Example: Base viewport width
const VIEWPORT_HEIGHT = 800; // Example: Base viewport height
const VIEWPORT_BUFFER = 1200; // Increased buffer (was 600) to create larger "chunks" of visible area
const VIEWPORT_UPDATE_THRESHOLD_SQ = (VIEWPORT_WIDTH / 2) ** 2; // Increased threshold (was WIDTH/4), so updates happen less frequently
const VIEWPORT_UPDATE_DEBOUNCE_MS = 750; // Increased debounce time (was 250ms) to reduce update frequency

function AppContent() {
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
      players, trees, stones, campfires, mushrooms, corns, hemps,
      itemDefinitions, 
      inventoryItems, worldState, activeEquipments, droppedItems, 
      woodenStorageBoxes, recipes, craftingQueueItems, localPlayerRegistered,
      messages,
      playerPins, // Destructure playerPins
      activeConnections, // <<< Destructure here
      sleepingBags, // ADD destructuring
      playerCorpses, // <<< ADD playerCorpses destructuring
      stashes // <<< ADD stashes destructuring
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

    // --- Action Handlers --- 
    const handleAttemptRegisterPlayer = useCallback((usernameToRegister: string | null) => {
        setUiError(null);
        // Ensure we are authenticated and connected before registering
        if (!isAuthenticated || !spacetimeConnected) {
            console.error("Cannot register player: Not authenticated or not connected to SpacetimeDB.");
            setUiError("Connection error, cannot register.");
            return;
        }
        // Validate the username passed from the LoginScreen
        if (!usernameToRegister || !usernameToRegister.trim()) { 
             setUiError("Username cannot be empty.");
             return;
        }
        
        setIsRegistering(true);
        // Call the SpacetimeDB registerPlayer reducer with the provided username
        registerPlayer(usernameToRegister); 
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
                    {authLoading ? 'Authenticating...' : 'Connecting to SpacetimeDB...'}
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
                (() => { // Use an IIFE to allow logging before returning GameScreen
                    // console.log("[AppContent] About to render GameScreen. hemps variable:", hemps);
                    return (
                        <GameScreen 
                            players={players}
                            trees={trees}
                            stones={stones}
                            campfires={campfires}
                            mushrooms={mushrooms}
                            hemps={hemps}
                            corns={corns}
                            droppedItems={droppedItems}
                            woodenStorageBoxes={woodenStorageBoxes}
                            sleepingBags={sleepingBags}
                            playerCorpses={playerCorpses}
                            stashes={stashes}
                            inventoryItems={inventoryItems}
                            itemDefinitions={itemDefinitions}
                            worldState={worldState}
                            activeEquipments={activeEquipments}
                            activeConnections={activeConnections}
                            recipes={recipes}
                            craftingQueueItems={craftingQueueItems}
                            localPlayerId={dbIdentity?.toHexString() ?? undefined} // Use derived SpacetimeDB ID
                            playerIdentity={dbIdentity} // Pass derived SpacetimeDB Identity
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
                <AppContent />
            </GameContextsProvider>
        </AuthProvider>
    );
}

export default App;
