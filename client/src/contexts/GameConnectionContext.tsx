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
    const { spacetimeToken, invalidateCurrentToken } = useAuth(); 
    const [connection, setConnection] = useState<DbConnection | null>(null);
    const [dbIdentity, setDbIdentity] = useState<SpacetimeDBIdentity | null>(null);
    const [isConnected, setIsConnected] = useState<boolean>(false); // Tracks SpacetimeDB connection status
    const [isConnecting, setIsConnecting] = useState<boolean>(false); // Specific state for this connection attempt
    const [connectionError, setConnectionError] = useState<string | null>(null); // Specific connection error for this context
    const connectionInstanceRef = useRef<DbConnection | null>(null); // Ref to hold the instance

    // Connection logic - Triggered ONLY by spacetimeToken changes
    useEffect(() => {
        // --- Log Effect Trigger --- 
        // console.log(`[GameConn LOG] useEffect triggered. Token exists: ${!!spacetimeToken}. isConnecting: ${isConnecting}. isConnected: ${isConnected}.`);

        // --- Revised Guard Conditions --- 
        if (!spacetimeToken) {
            // console.log("[GameConn LOG] Skipping connection: No token.");
            // --- Add disconnect logic if needed when token disappears --- 
            if (connectionInstanceRef.current) {
                // console.log("[GameConn LOG] Token lost, disconnecting existing connection (ref)...");
                connectionInstanceRef.current.disconnect();
                // State will be cleared by onDisconnect callback
            }
            return;
        }
        
        if (isConnecting || isConnected) { 
            // console.log("[GameConn LOG] Skipping connection: Already connecting or connected.");
            return;
        }

        // --- Condition to attempt connection --- 
        // console.log("[GameConn LOG] Attempting SpacetimeDB connection..."); // <-- LOG
        setIsConnecting(true); 
        setConnectionError(null);
        let newConnectionInstance: DbConnection | null = null;

        try {
            // console.log("[GameConn LOG] Calling DbConnection.builder().build()..."); // <-- LOG
            newConnectionInstance = DbConnection.builder()
                .withUri(SPACETIME_DB_ADDRESS)
                .withModuleName(SPACETIME_DB_NAME)
                .withToken(spacetimeToken) 
                .onConnect((conn: DbConnection, identity: SpacetimeDBIdentity) => {
                    // console.log('[GameConn LOG] onConnect: SpacetimeDB Connected. Identity:', identity.toHexString()); // <-- LOG
                    connectionInstanceRef.current = conn; 
                    setConnection(conn);
                    setDbIdentity(identity);
                    setIsConnected(true);
                    setConnectionError(null);
                    setIsConnecting(false); 
                })
                .onDisconnect((context: any, err?: Error) => {
                    // console.log('[GameConn LOG] onDisconnect: SpacetimeDB Disconnected.', err ? `Reason: ${err.message}` : 'Graceful disconnect.'); // <-- LOG
                    connectionInstanceRef.current = null; 
                    setConnection(null);
                    setDbIdentity(null);
                    setIsConnected(false);
                    setIsConnecting(false);
                    if (err) {
                        const errorMessage = err.message || 'Unknown reason';
                        setConnectionError(`SpacetimeDB Disconnected: ${errorMessage}`);
                        // Improved 401/auth error detection - check multiple patterns
                        if (errorMessage.includes("401") || 
                            errorMessage.toLowerCase().includes("unauthorized") ||
                            errorMessage.toLowerCase().includes("websocket-token") ||
                            errorMessage.toLowerCase().includes("authentication") ||
                            errorMessage.toLowerCase().includes("auth")) {
                            console.warn("[GameConn LOG] onDisconnect: Error suggests auth issue, invalidating token. Error:", errorMessage);
                            invalidateCurrentToken();
                        }
                    } else {
                        setConnectionError(null); 
                    }
                })
                .onConnectError((context: any, err: Error) => {
                    console.error('[GameConn LOG] onConnectError: SpacetimeDB Connection Error:', err); // <-- LOG
                    connectionInstanceRef.current = null; 
                    setConnection(null);
                    setDbIdentity(null);
                    setIsConnected(false);
                    setIsConnecting(false); 
                    const errorMessage = err.message || err.toString();
                    setConnectionError(`SpacetimeDB Connection failed: ${errorMessage}`);
                    // Improved error detection - be more aggressive about auth failures
                    if (errorMessage.includes("401") || 
                        errorMessage.toLowerCase().includes("unauthorized") ||
                        errorMessage.toLowerCase().includes("websocket-token") ||
                        errorMessage.toLowerCase().includes("authentication") ||
                        errorMessage.toLowerCase().includes("auth") ||
                        errorMessage.toLowerCase().includes("forbidden") ||
                        errorMessage.toLowerCase().includes("invalid token")) {
                        console.warn("[GameConn LOG] onConnectError: Error suggests auth issue, invalidating token. Error:", errorMessage);
                        invalidateCurrentToken(); 
                    }
                })
                .build();
        } catch (err: any) { 
            console.error('[GameConn LOG] Failed to build SpacetimeDB connection:', err); // <-- LOG
            setConnectionError(`SpacetimeDB Build failed: ${err.message || err}`);
            setIsConnecting(false); 
        }

        // Cleanup (Using REF variable for disconnect call)
        return () => {
            // console.log("[GameConn LOG] useEffect cleanup running..."); // <-- LOG
            if (connectionInstanceRef.current) { 
                // console.log("[GameConn LOG] Cleanup: Calling disconnect on connection instance (ref)."); // <-- LOG
                connectionInstanceRef.current.disconnect();
                // State clearing is handled by onDisconnect callback
             }
        };
    // Reverted dependency array to simpler version, only depends on the token
    }, [spacetimeToken, invalidateCurrentToken]); 

    // Player registration function (can safely use state variable)
    const registerPlayer = useCallback((username: string) => {
        if (connection && isConnected && username.trim()) { // Use state variable
            setConnectionError(null); // Clear previous errors on new attempt
            try {
                // console.log(`[GameConnectionProvider] Calling registerPlayer reducer with username: ${username}`);
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
        connection,
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