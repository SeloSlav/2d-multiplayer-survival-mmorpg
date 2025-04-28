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
    isConnected: boolean; // Is the connection to SpacetimeDB established?
    isLoading: boolean;   // Is the SpacetimeDB connection attempt in progress?
    error: string | null; // Stores SpacetimeDB connection-related errors
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
    // Get the spacetimeToken obtained from the auth-server by AuthContext
    // We don't need authIsLoading or authError here anymore for the connection logic itself
    const { spacetimeToken } = useAuth(); 
    const [connection, setConnection] = useState<DbConnection | null>(null);
    const [dbIdentity, setDbIdentity] = useState<SpacetimeDBIdentity | null>(null);
    const [isConnected, setIsConnected] = useState<boolean>(false); // Tracks SpacetimeDB connection status
    const [isConnecting, setIsConnecting] = useState<boolean>(false); // Specific state for this connection attempt
    const [connectionError, setConnectionError] = useState<string | null>(null); // Specific connection error for this context
    const connectionInstanceRef = useRef<DbConnection | null>(null); // Ref to hold the instance

    // Connection logic - Triggered ONLY by spacetimeToken changes
    useEffect(() => {
        // --- Revised Guard Conditions ---
        if (!spacetimeToken) {
            console.log("GameConnectionProvider: Skipping connection (no token exists).");
            return;
        }
        
        // Use state variables to check if we are already connected or in the process
        if (isConnecting || isConnected) { 
            // console.log("GameConnectionProvider: Skipping connection attempt (already connecting or connected)."); // Optional: Log if needed
            return;
        }

        // --- Condition to attempt connection ---
        // Now we only proceed if we have a token AND are not connecting/connected
        console.log("[GameConnectionProvider] Spacetime token available. Attempting SpacetimeDB connection.");
        setIsConnecting(true); // Start loading *this* connection
        setConnectionError(null);
        let newConnectionInstance: DbConnection | null = null;

        try {
            newConnectionInstance = DbConnection.builder()
                .withUri(SPACETIME_DB_ADDRESS)
                .withModuleName(SPACETIME_DB_NAME)
                .withToken(spacetimeToken) // *** USE THE SPACETIMEDB TOKEN FROM AUTHCONTEXT ***
                .onConnect((conn: DbConnection, identity: SpacetimeDBIdentity) => {
                    console.log('[GameConnectionProvider] SpacetimeDB Connected. Identity:', identity.toHexString());
                    connectionInstanceRef.current = conn; // Store instance in ref
                    setConnection(conn);
                    setDbIdentity(identity);
                    setIsConnected(true);
                    setConnectionError(null);
                    setIsConnecting(false); // Stop loading *this* connection
                })
                .onDisconnect((context: any, err?: Error) => {
                    console.log('[GameConnectionProvider] SpacetimeDB Disconnected.', err?.message);
                    connectionInstanceRef.current = null; // Clear ref on disconnect
                    setConnection(null);
                    setDbIdentity(null);
                    setIsConnected(false);
                    setIsConnecting(false);
                    if (err) {
                        setConnectionError(`SpacetimeDB Disconnected: ${err.message || 'Unknown reason'}`);
                    } else {
                        setConnectionError(null); // Clear error on graceful disconnect
                    }
                })
                .onConnectError((context: any, err: Error) => {
                    console.error('[GameConnectionProvider] SpacetimeDB Connection Error:', err);
                    connectionInstanceRef.current = null; // Clear ref on error
                    setConnection(null);
                    setDbIdentity(null);
                    setIsConnected(false);
                    setIsConnecting(false); // Stop loading *this* connection
                    setConnectionError(`SpacetimeDB Connection failed: ${err.message || err}`);
                })
                .build();
        } catch (err: any) { // Catch errors during .build() itself
            console.error('[GameConnectionProvider] Failed to build SpacetimeDB connection:', err);
            setConnectionError(`SpacetimeDB Build failed: ${err.message || err}`);
            setIsConnecting(false); // Stop loading *this* connection
        }

        // --- Condition to disconnect (Using STATE variable) ---
        // Disconnect if: spacetime token is lost AND we have an active connection (use state)
        if (!spacetimeToken && connection) { // Check state variable
            console.log("[GameConnectionProvider] Spacetime token lost, disconnecting existing connection.");
            connection.disconnect(); // Call disconnect on the state variable
            // Note: onDisconnect callback should handle clearing state (setConnection(null))
        }

        // Cleanup (Using STATE variable)
        return () => {
            // Use connection state variable for cleanup check
             if (connection) { 
                console.log("[GameConnectionProvider] Unmounting, disconnecting.");
                connection.disconnect();
                // Note: onDisconnect callback should handle clearing state
             }
        };
    // Add `isConnected` to dependency array as we now check it in the guards
    }, [spacetimeToken, isConnecting, connection, isConnected]);

    // Player registration function (can safely use state variable)
    const registerPlayer = useCallback((username: string) => {
        if (connection && isConnected && username.trim()) { // Use state variable
            setConnectionError(null); // Clear previous errors on new attempt
            try {
                console.log(`[GameConnectionProvider] Calling registerPlayer reducer with username: ${username}`);
                connection.reducers.registerPlayer(username); // Use state variable
            } catch (err: any) {
                console.error('[GameConnectionProvider] Failed to call registerPlayer reducer:', err);
                setConnectionError(`Failed to call registerPlayer: ${err.message || err}.`);
            }
        } else {
            let reason = !connection ? "No SpacetimeDB connection" : !isConnected ? "Not connected to SpacetimeDB" : "Empty username"; // Use state
            console.warn(`[GameConnectionProvider] Cannot register player: ${reason}.`);
            setConnectionError(`Cannot register: ${reason}.`);
        }
    }, [isConnected, connection]); // Add connection state to dependencies

    // Context value (provide state variable)
    const contextValue: ConnectionContextState = {
        connection, // Provide state variable
        dbIdentity,
        isConnected,
        isLoading: isConnecting, 
        error: connectionError, 
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