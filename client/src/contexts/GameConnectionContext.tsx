import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { Identity as SpacetimeDBIdentity } from '@clockworklabs/spacetimedb-sdk';
import { DbConnection } from '../generated';
import { useAuth } from './AuthContext';

// SpacetimeDB connection parameters (Should move to a config later)
const SPACETIME_DB_ADDRESS = 'ws://localhost:3000';
const SPACETIME_DB_NAME = 'vibe-survival-game';

// Define the connection context state type
interface ConnectionContextState {
    connection: DbConnection | null;
    dbIdentity: SpacetimeDBIdentity | null; // Store the SpacetimeDB Identity
    isConnected: boolean; // Is the connection to SpacetimeDB established?
    isLoading: boolean;   // Is the connection attempt in progress?
    error: string | null; // Stores connection-related errors
    registerPlayer: (username: string) => void;
}

// Create the context with a default value
const GameConnectionContext = createContext<ConnectionContextState>({
    connection: null,
    dbIdentity: null,
    isConnected: false,
    isLoading: false, // Start not loading
    error: null,
    registerPlayer: () => { console.warn("GameConnectionContext not initialized for registerPlayer"); },
});

// Provider props type
interface GameConnectionProviderProps {
    children: ReactNode;
}

// Provider component
export const GameConnectionProvider: React.FC<GameConnectionProviderProps> = ({ children }) => {
    // Get Spacetime token and auth state from AuthContext
    const { spacetimeToken, isAuthenticated, isLoading: authIsLoading, authError: authContextError } = useAuth();
    const [connection, setConnection] = useState<DbConnection | null>(null);
    const [dbIdentity, setDbIdentity] = useState<SpacetimeDBIdentity | null>(null);
    const [isConnected, setIsConnected] = useState<boolean>(false); // Tracks SpacetimeDB connection status
    const [isConnecting, setIsConnecting] = useState<boolean>(false); // Specific state for connection attempt
    const [connectionError, setConnectionError] = useState<string | null>(null); // Specific connection error
    const connectionInstanceRef = useRef<DbConnection | null>(null); // Ref to hold the instance

    // Connection logic - Triggered by spacetimeToken changes
    useEffect(() => {
        // --- Condition to attempt connection ---
        // Connect if: user is authenticated, we have a spacetimeToken, auth isn't loading, and we aren't already connected/connecting
        const shouldConnect = isAuthenticated && spacetimeToken && !authIsLoading && !connectionInstanceRef.current && !isConnecting;

        if (shouldConnect) {
            console.log("[GameConnectionProvider] Conditions met for SpacetimeDB connection attempt.");
            setIsConnecting(true);
            setConnectionError(null);
            let newConnectionInstance: DbConnection | null = null;

            try {
                newConnectionInstance = DbConnection.builder()
                    .withUri(SPACETIME_DB_ADDRESS)
                    .withModuleName(SPACETIME_DB_NAME)
                    .withToken(spacetimeToken) // *** Use the SpacetimeDB token from AuthContext ***
                    .onConnect((conn: DbConnection, identity: SpacetimeDBIdentity) => {
                        console.log('[GameConnectionProvider] SpacetimeDB Connected. Identity:', identity.toHexString());
                        connectionInstanceRef.current = conn; // Store instance in ref
                        setConnection(conn);
                        setDbIdentity(identity);
                        setIsConnected(true);
                        setConnectionError(null);
                        setIsConnecting(false);
                    })
                    .onDisconnect((context: any, err?: Error) => {
                        console.log('[GameConnectionProvider] SpacetimeDB Disconnected.', err?.message);
                        connectionInstanceRef.current = null; // Clear ref on disconnect
                        setConnection(null);
                        setDbIdentity(null);
                        setIsConnected(false);
                        setIsConnecting(false);
                        // Don't set error on graceful disconnect, only if there's an error object
                        if (err) {
                            setConnectionError(`SpacetimeDB Disconnected: ${err.message || 'Unknown reason'}`);
                        }
                    })
                    .onConnectError((context: any, err: Error) => {
                        console.error('[GameConnectionProvider] SpacetimeDB Connection Error:', err);
                        connectionInstanceRef.current = null; // Clear ref on error
                        setConnection(null);
                        setDbIdentity(null);
                        setIsConnected(false);
                        setIsConnecting(false);
                        setConnectionError(`SpacetimeDB Connection failed: ${err.message || err}`);
                    })
                    .build();
            } catch (err: any) { // Catch errors during .build() itself
                console.error('[GameConnectionProvider] Failed to build SpacetimeDB connection:', err);
                setConnectionError(`SpacetimeDB Build failed: ${err.message || err}`);
                setIsConnecting(false);
            }
        } else if ((!isAuthenticated || !spacetimeToken) && connectionInstanceRef.current) {
            // --- Condition to disconnect ---
            // Disconnect if: user is no longer authenticated OR spacetime token is lost, AND we have an active connection
            console.log("[GameConnectionProvider] Not authenticated or no Spacetime token, disconnecting existing connection.");
            connectionInstanceRef.current.disconnect();
            connectionInstanceRef.current = null;
            setConnection(null);
            setDbIdentity(null);
            setIsConnected(false);
            setConnectionError(null); // Clear connection error on explicit disconnect
            setIsConnecting(false);
        }

        // Cleanup: If the component unmounts while a connection exists, disconnect.
        return () => {
             if (connectionInstanceRef.current) {
                console.log("[GameConnectionProvider] Unmounting, disconnecting.");
                connectionInstanceRef.current.disconnect();
                connectionInstanceRef.current = null; // Ensure ref is cleared on unmount
             }
        };
    // Depend on spacetimeToken presence, authentication status, and auth loading state
    }, [spacetimeToken, isAuthenticated, authIsLoading, isConnecting]);

    // Player registration function (no changes needed here)
    const registerPlayer = useCallback((username: string) => {
        const currentConnection = connectionInstanceRef.current; // Use ref for potentially faster access
        if (currentConnection && isConnected && username.trim()) {
            setConnectionError(null);
            try {
                console.log(`[GameConnectionProvider] Calling registerPlayer reducer with username: ${username}`);
                currentConnection.reducers.registerPlayer(username);
            } catch (err: any) {
                console.error('[GameConnectionProvider] Failed to call registerPlayer reducer:', err);
                setConnectionError(`Failed to call registerPlayer: ${err.message || err}.`);
            }
        } else {
            let reason = !currentConnection ? "No connection" : !isConnected ? "Not connected" : "Empty username";
            console.warn(`[GameConnectionProvider] Cannot register player: ${reason}.`);
            setConnectionError(`Cannot register: ${reason}.`);
        }
    }, [isConnected]); // Depend only on isConnected state

    // Combine loading states and errors for the context value
    const combinedIsLoading = authIsLoading || isConnecting;
    const combinedError = authContextError || connectionError;

    // Create the context value
    const contextValue: ConnectionContextState = {
        connection: connectionInstanceRef.current, // Provide the connection from the ref
        dbIdentity,
        isConnected,
        isLoading: combinedIsLoading, // Reflect overall loading (auth + connection attempt)
        error: combinedError, // Reflect overall error (auth OR connection)
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