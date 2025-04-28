import { useCallback } from 'react';
import { useGameConnection } from '../contexts/GameConnectionContext';

// Define the return type for this hook
interface PlayerActions {
    // Movement actions
    updatePlayerPosition: (moveX: number, moveY: number) => void;
    jump: () => void;
    setSprinting: (isSprinting: boolean) => void;
    
    // Viewport updates
    updateViewport: (minX: number, minY: number, maxX: number, maxY: number) => void;
}

/**
 * Hook that provides player action methods for gameplay
 * Separates game mechanics from connection management
 */
export const usePlayerActions = (): PlayerActions => {
    // Get the SpacetimeDB connection from the connection hook
    const { connection } = useGameConnection();
    
    // --- Player Movement Actions ---
    const updatePlayerPosition = useCallback((moveX: number, moveY: number) => {
        if (!connection?.reducers) {
            console.warn("[usePlayerActions] Connection not ready for updatePlayerPosition");
            return;
        }
        try {
            connection.reducers.updatePlayerPosition(moveX, moveY);
        } catch (err) {
            console.error("[usePlayerActions] Error calling updatePlayerPosition reducer:", err);
        }
    }, [connection]);

    const setSprinting = useCallback((isSprinting: boolean) => {
        if (!connection?.reducers) {
            console.warn("[usePlayerActions] Connection not ready for setSprinting");
            return;
        }
        try {
            connection.reducers.setSprinting(isSprinting);
        } catch (err: any) {
            console.error('[usePlayerActions] Failed to call setSprinting reducer:', err);
        }
    }, [connection]);

    const jump = useCallback(() => {
        if (!connection?.reducers) {
            console.warn("[usePlayerActions] Connection not ready for jump");
            return;
        }
        try {
            connection.reducers.jump();
        } catch (err: any) {
            console.error('[usePlayerActions] Failed to call jump reducer:', err);
        }
    }, [connection]);

    // --- Viewport Actions ---
    const updateViewport = useCallback((minX: number, minY: number, maxX: number, maxY: number) => {
        if (!connection?.reducers) {
            console.warn("[usePlayerActions] Connection not ready for updateViewport");
            return;
        }
        try {
            connection.reducers.updateViewport(minX, minY, maxX, maxY);
        } catch (err: any) {
            console.error('[usePlayerActions] Failed to call updateViewport reducer:', err);
        }
    }, [connection]);

    return {
        updatePlayerPosition,
        jump,
        setSprinting,
        updateViewport
    };
}; 