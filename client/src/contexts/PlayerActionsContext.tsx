import React, { createContext, useContext, useCallback, ReactNode } from 'react';
import { useGameConnection } from './GameConnectionContext';

// Define the player actions interface
interface PlayerActionsContextState {
    // Movement actions
    updatePlayerPosition: (moveX: number, moveY: number) => void;
    jump: () => void;
    setSprinting: (isSprinting: boolean) => void;
    
    // Viewport updates
    updateViewport: (minX: number, minY: number, maxX: number, maxY: number) => void;
}

// Create the context with default functions that log warnings if used before provider is set up
const PlayerActionsContext = createContext<PlayerActionsContextState>({
    updatePlayerPosition: () => console.warn("PlayerActionsContext not initialized"),
    jump: () => console.warn("PlayerActionsContext not initialized"),
    setSprinting: () => console.warn("PlayerActionsContext not initialized"),
    updateViewport: () => console.warn("PlayerActionsContext not initialized"),
});

// Provider props type
interface PlayerActionsProviderProps {
    children: ReactNode;
}

// Provider component
export const PlayerActionsProvider: React.FC<PlayerActionsProviderProps> = ({ children }) => {
    // Get connection from the GameConnectionContext
    const { connection } = useGameConnection();
    
    // --- Player Movement Actions ---
    const updatePlayerPosition = useCallback((moveX: number, moveY: number) => {
        if (!connection?.reducers) {
            console.warn("[PlayerActionsContext] Connection not ready for updatePlayerPosition");
            return;
        }
        try {
            connection.reducers.updatePlayerPosition(moveX, moveY);
        } catch (err) {
            console.error("[PlayerActionsContext] Error calling updatePlayerPosition reducer:", err);
        }
    }, [connection]);

    const setSprinting = useCallback((isSprinting: boolean) => {
        if (!connection?.reducers) {
            console.warn("[PlayerActionsContext] Connection not ready for setSprinting");
            return;
        }
        try {
            connection.reducers.setSprinting(isSprinting);
        } catch (err: any) {
            console.error('[PlayerActionsContext] Failed to call setSprinting reducer:', err);
        }
    }, [connection]);

    const jump = useCallback(() => {
        console.log("🦘 CLIENT: jump() called from PlayerActionsContext");
        if (!connection?.reducers) {
            console.warn("[PlayerActionsContext] Connection not ready for jump");
            return;
        }
        try {
            console.log("🦘 CLIENT: Calling connection.reducers.jump()");
            connection.reducers.jump();
            console.log("🦘 CLIENT: jump() reducer call completed");
        } catch (err: any) {
            console.error('[PlayerActionsContext] Failed to call jump reducer:', err);
        }
    }, [connection]);

    // --- Viewport Actions ---
    const updateViewport = useCallback((minX: number, minY: number, maxX: number, maxY: number) => {
        if (!connection?.reducers) {
            console.warn("[PlayerActionsContext] Connection not ready for updateViewport");
            return;
        }
        try {
            connection.reducers.updateViewport(minX, minY, maxX, maxY);
        } catch (err: any) {
            console.error('[PlayerActionsContext] Failed to call updateViewport reducer:', err);
        }
    }, [connection]);

    // Create the context value
    const contextValue: PlayerActionsContextState = {
        updatePlayerPosition,
        jump,
        setSprinting,
        updateViewport
    };

    // Provide the context to children
    return (
        <PlayerActionsContext.Provider value={contextValue}>
            {children}
        </PlayerActionsContext.Provider>
    );
};

// Custom hook for consuming the context
export const usePlayerActions = (): PlayerActionsContextState => {
    const context = useContext(PlayerActionsContext);
    if (context === undefined) {
        throw new Error('usePlayerActions must be used within a PlayerActionsProvider');
    }
    return context;
}; 