import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { Identity as SpacetimeDBIdentity } from '@clockworklabs/spacetimedb-sdk';
import { DbConnection } from '../generated';
import { useAuth } from './AuthContext'; // Import useAuth

// SpacetimeDB connection parameters (Should move to a config later)
const SPACETIME_DB_ADDRESS = 'ws://localhost:3000';
const SPACETIME_DB_NAME = 'vibe-survival-game';

// Define the connection context state type
interface ConnectionContextState {
    connection: DbConnection | null;
    dbIdentity: SpacetimeDBIdentity | null; // Store the SpacetimeDB Identity
    isConnected: boolean;
    isLoading: boolean;
    error: string | null;
    registerPlayer: (username: string) => void; // Simplified back - token handled at connect
}

// Create the context with a default value
const GameConnectionContext = createContext<ConnectionContextState>({
    connection: null,
    dbIdentity: null,
    isConnected: false,
    isLoading: false,
    error: null,
    registerPlayer: () => { console.warn("GameConnectionContext not initialized for registerPlayer"); },
});

// Provider props type
interface GameConnectionProviderProps {
    children: ReactNode;
}

// Provider component
export const GameConnectionProvider: React.FC<GameConnectionProviderProps> = ({ children }) => {
    const { authToken, isAuthenticated, isLoading: authIsLoading } = useAuth();
    const [connection, setConnection] = useState<DbConnection | null>(null);
    const [dbIdentity, setDbIdentity] = useState<SpacetimeDBIdentity | null>(null);
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const connectionInstanceRef = useRef<DbConnection | null>(null); // Ref to hold the instance

    // Connection logic - Adjusted to be less sensitive to token refreshes
    useEffect(() => {
        // --- Condition to attempt connection ---
        const shouldConnect = !authIsLoading && isAuthenticated && authToken && !connectionInstanceRef.current;

        if (shouldConnect) {
            console.log("[GameConnectionProvider] Conditions met for initial connection attempt.");
            setIsLoading(true);
            setError(null);
            let newConnectionInstance: DbConnection | null = null;

            try {
                newConnectionInstance = DbConnection.builder()
                    .withUri(SPACETIME_DB_ADDRESS)
                    .withModuleName(SPACETIME_DB_NAME)
                    .withToken(authToken) // Use the token for the initial connection
                    .onConnect((conn: DbConnection, identity: SpacetimeDBIdentity) => {
                        console.log('[GameConnectionProvider] SpacetimeDB Connected. Identity:', identity.toHexString());
                        connectionInstanceRef.current = conn; // Store instance in ref
                        setConnection(conn);
                        setDbIdentity(identity);
                        setIsConnected(true);
                        setError(null);
                        setIsLoading(false);
                    })
                    .onDisconnect((context: any, err?: Error) => {
                        console.log('[GameConnectionProvider] SpacetimeDB Disconnected.', err?.message);
                        connectionInstanceRef.current = null; // Clear ref on disconnect
                        setConnection(null);
                        setDbIdentity(null);
                        setIsConnected(false);
                        setIsLoading(false);
                        setError(`SpacetimeDB Disconnected${err ? ': ' + err.message : ''}.`);
                    })
                    .onConnectError((context: any, err: Error) => {
                        console.error('[GameConnectionProvider] SpacetimeDB Connection Error:', err);
                        connectionInstanceRef.current = null; // Clear ref on error
                        setConnection(null);
                        setDbIdentity(null);
                        setIsConnected(false);
                        setIsLoading(false);
                        setError(`SpacetimeDB Connection failed: ${err.message || err}`);
                    })
                    .build();
            } catch (err: any) {
                console.error('[GameConnectionProvider] Failed to build SpacetimeDB connection:', err);
                setError(`SpacetimeDB Build failed: ${err.message || err}`);
                setIsLoading(false);
            }
        } else if (!isAuthenticated && connectionInstanceRef.current) {
            // --- Condition to disconnect ---
            console.log("[GameConnectionProvider] User not authenticated, disconnecting existing connection.");
            connectionInstanceRef.current.disconnect();
            connectionInstanceRef.current = null;
            setConnection(null);
            setDbIdentity(null);
            setIsConnected(false);
            setError(null); // Clear connection error on explicit disconnect
            setIsLoading(false);
        }

        // Cleanup function: Only disconnects if the component unmounts
        // We rely on the onDisconnect callback to clear state if connection drops
        return () => {
             // No explicit disconnect here on dependency change, only on unmount if needed.
             // If the connection reference exists when the provider unmounts, disconnect it.
             // This might be redundant if onDisconnect handles it, but can be a safeguard.
             // if (connectionInstanceRef.current) {
             //    console.log("[GameConnectionProvider] Unmounting, disconnecting.");
             //    connectionInstanceRef.current.disconnect();
             // }
        };
        // Depend only on auth state readiness and token existence for *triggering* connection logic
    }, [authToken, isAuthenticated, authIsLoading]);

    // Player registration function (remains the same)
    const registerPlayer = useCallback((username: string) => {
        // Use the state variable `connection` here, which is set by the effect
        const currentConnection = connection; 
        if (currentConnection && isConnected && username.trim()) {
            setError(null);
            try {
                currentConnection.reducers.registerPlayer(username);
            } catch (err: any) {
                console.error('[GameConnectionProvider] Failed to register player:', err);
                setError(`Failed to call registerPlayer: ${err.message || err}. Please try again.`);
            }
        } else {
            let reason = !currentConnection ? "No connection" : !isConnected ? "Not connected" : "Empty username";
            console.warn(`[GameConnectionProvider] Cannot register player: ${reason}.`);
            setError(`Cannot register: ${reason}.`);
        }
    }, [connection, isConnected]); // Depend on state `connection` and `isConnected`

    // Create the context value
    const contextValue: ConnectionContextState = {
        connection,
        dbIdentity,
        isConnected,
        isLoading,
        error,
        registerPlayer,
    };

    return (
        <GameConnectionContext.Provider value={contextValue}>
            {children}
        </GameConnectionContext.Provider>
    );
};

// Custom hook for consuming the context
export const useGameConnection = (): ConnectionContextState => {
    const context = useContext(GameConnectionContext);
    if (context === undefined) {
        throw new Error('useGameConnection must be used within a GameConnectionProvider');
    }
    return context;
}; 