import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { Identity as SpacetimeDBIdentity } from '@clockworklabs/spacetimedb-sdk';
import { DbConnection } from '../generated';
import { useAuth } from './AuthContext'; // Import useAuth

// --- Environment-based SpacetimeDB Configuration ---
const isDevelopment = import.meta.env.DEV || window.location.hostname === 'localhost';

const SPACETIME_DB_ADDRESS = isDevelopment 
  ? 'ws://localhost:3000' 
  : 'wss://maincloud.spacetimedb.com'; // SpacetimeDB Maincloud

const SPACETIME_DB_NAME = isDevelopment
  ? 'broth-bullets-local'
  : 'broth-bullets'; // Your Maincloud database name

console.log(`[SpacetimeDB] Environment: ${isDevelopment ? 'development' : 'production'}`);
console.log(`[SpacetimeDB] Using server: ${SPACETIME_DB_ADDRESS}`);
console.log(`[SpacetimeDB] Database name: ${SPACETIME_DB_NAME}`);

// Define the connection context state type
interface ConnectionContextState {
    connection: DbConnection | null;
    dbIdentity: SpacetimeDBIdentity | null; // Store the SpacetimeDB Identity
    isConnected: boolean; // Is the connection to SpacetimeDB established?
    isLoading: boolean;   // Is the SpacetimeDB connection attempt in progress?
    error: string | null; // Stores SpacetimeDB connection-related errors
    registerPlayer: (username: string) => Promise<void>; // Return Promise to handle errors
    retryConnection: () => void; // Manual retry function
}

// Create the context with a default value
const GameConnectionContext = createContext<ConnectionContextState>({
    connection: null,
    dbIdentity: null,
    isConnected: false,
    isLoading: false, // Start not loading
    error: null,
    registerPlayer: async () => { console.warn("GameConnectionContext not initialized for registerPlayer"); },
    retryConnection: () => { console.warn("GameConnectionContext not initialized for retryConnection"); },
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
    const [retryCount, setRetryCount] = useState<number>(0); // Track retry attempts
    const connectionInstanceRef = useRef<DbConnection | null>(null); // Ref to hold the instance
    const timeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref for timeout cleanup

    // Manual retry function
    const retryConnection = useCallback(() => {
        console.log("[GameConn LOG] Manual retry requested");
        setRetryCount(prev => prev + 1);
        setConnectionError(null);
        setIsConnecting(false); // Reset connecting state to trigger new attempt
    }, []);

    // Connection logic - Triggered by spacetimeToken changes and retry attempts
    useEffect(() => {
        // --- Log Effect Trigger --- 
        console.log(`[GameConn LOG] useEffect triggered. Token exists: ${!!spacetimeToken}. isConnecting: ${isConnecting}. isConnected: ${isConnected}. retryCount: ${retryCount}`);

        // --- Revised Guard Conditions --- 
        if (!spacetimeToken) {
            console.log("[GameConn LOG] Skipping connection: No token.");
            // --- Add disconnect logic if needed when token disappears --- 
            if (connectionInstanceRef.current) {
                console.log("[GameConn LOG] Token lost, disconnecting existing connection (ref)...");
                connectionInstanceRef.current.disconnect();
                // State will be cleared by onDisconnect callback
            }
            return;
        }
        
        if (isConnecting || isConnected) { 
            console.log("[GameConn LOG] Skipping connection: Already connecting or connected.");
            return;
        }

        // --- Condition to attempt connection --- 
        console.log("[GameConn LOG] Attempting SpacetimeDB connection..."); 
        setIsConnecting(true); 
        setConnectionError(null);
        
        // Clear any existing timeout
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        
        // Set up connection timeout - increased for better reliability
        const connectionTimeoutMs = isDevelopment ? 5000 : 8000; // 5s for dev, 8s for prod
        timeoutRef.current = setTimeout(() => {
            console.warn('[GameConn LOG] Connection timeout - SpacetimeDB server may be down');
            setIsConnecting(false);
            setConnectionError(`Connection timeout after ${connectionTimeoutMs/1000}s - SpacetimeDB server may be down. Please try again.`);
        }, connectionTimeoutMs);

        try {
            console.log("[GameConn LOG] Calling DbConnection.builder().build()..."); 
            const builder = DbConnection.builder()
                .withUri(SPACETIME_DB_ADDRESS)
                .withModuleName(SPACETIME_DB_NAME)
                .withToken(spacetimeToken) 
                .onConnect((conn: DbConnection, identity: SpacetimeDBIdentity) => {
                    console.log('[GameConn LOG] onConnect: SpacetimeDB Connected. Identity:', identity.toHexString());
                    console.log('[GameConn LOG] onConnect: About to update React states...');
                    
                    // Clear timeout on successful connection
                    if (timeoutRef.current) {
                        clearTimeout(timeoutRef.current);
                        timeoutRef.current = null;
                    }
                    
                    connectionInstanceRef.current = conn; 
                    setConnection(conn);
                    setDbIdentity(identity);
                    setIsConnected(true);
                    setConnectionError(null);
                    setIsConnecting(false);
                    setRetryCount(0); // Reset retry count on successful connection
                    
                    console.log('[GameConn LOG] onConnect: React state updates called');
                })
                .onDisconnect((context: any, err?: Error) => {
                    console.log('[GameConn LOG] onDisconnect: SpacetimeDB Disconnected.', err ? `Reason: ${err.message}` : 'Graceful disconnect.');
                    
                    // Clear timeout on disconnect
                    if (timeoutRef.current) {
                        clearTimeout(timeoutRef.current);
                        timeoutRef.current = null;
                    }
                    
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
                    console.error('[GameConn LOG] onConnectError: SpacetimeDB Connection Error:', err);
                    
                    // Clear timeout on connection error
                    if (timeoutRef.current) {
                        clearTimeout(timeoutRef.current);
                        timeoutRef.current = null;
                    }
                    
                    connectionInstanceRef.current = null; 
                    setConnection(null);
                    setDbIdentity(null);
                    setIsConnected(false);
                    setIsConnecting(false); 
                    
                    const errorMessage = err.message || err.toString();
                    setConnectionError(`Unable to establish quantum tunnel to Babachain network. Arkyv node may be offline or experiencing consensus failures.`);
                    
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
                });

            // Simplified connection build - remove complex promise racing
            console.log("[GameConn LOG] About to call builder.build()");
            const newConnectionInstance = builder.build();
            console.log("[GameConn LOG] Build completed successfully");
            
        } catch (err: any) { 
            console.error('[GameConn LOG] Failed to build SpacetimeDB connection:', err);
            
            // Clear timeout on build error
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
            
            setConnectionError(`SpacetimeDB Build failed: ${err.message || err}. Please try again.`);
            setIsConnecting(false); 
        }

        // Cleanup
        return () => {
            console.log("[GameConn LOG] useEffect cleanup running...");
            
            // Clear timeout on cleanup
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
            
            if (connectionInstanceRef.current) { 
                console.log("[GameConn LOG] Cleanup: Calling disconnect on connection instance (ref).");
                connectionInstanceRef.current.disconnect();
                // State clearing is handled by onDisconnect callback
             }
        };
    // Include retryCount in dependencies to trigger retries
    // Note: isConnecting and isConnected are NOT included to avoid infinite loops
    }, [spacetimeToken, invalidateCurrentToken, retryCount]);

    // Debug state changes
    useEffect(() => {
        console.log(`[GameConn LOG] State changed - connection: ${!!connection}, dbIdentity: ${!!dbIdentity}, isConnected: ${isConnected}`);
    }, [connection, dbIdentity, isConnected]);

    // Player registration function (can safely use state variable)
    const registerPlayer = useCallback(async (username: string): Promise<void> => {
        if (!connection || !isConnected || !dbIdentity || !username.trim()) {
            let reason = !connection ? "No SpacetimeDB connection" : 
                        !dbIdentity ? "SpacetimeDB identity not established" :
                        !isConnected ? "Not connected to SpacetimeDB" : "Empty username";
            console.warn(`[GameConnectionProvider] Cannot register player: ${reason}.`);
            const errorMessage = `Cannot register: ${reason}. Please wait for connection to establish.`;
            setConnectionError(errorMessage);
            throw new Error(errorMessage);
        }

        setConnectionError(null); // Clear previous errors on new attempt
        
        return new Promise<void>((resolve, reject) => {
            // Set up a one-time listener for the register player result
            const handleRegisterResult = (ctx: any, submittedUsername: string) => {
                // Remove the callback after it's called once
                connection.reducers.removeOnRegisterPlayer(handleRegisterResult);
                
                if (ctx.event?.status?.tag === 'Committed') {
                    console.log('[GameConnectionProvider] Player registration successful');
                    resolve();
                } else {
                    // Handle any non-committed status as an error
                    console.error('[GameConnectionProvider] Player registration failed with status:', ctx.event?.status);
                    console.error('[GameConnectionProvider] Full context:', ctx);
                    
                    // Parse the actual error from the status if available
                    let errorMessage = 'Registration failed';
                    if (ctx.event?.status?.tag === 'Failed' && ctx.event?.status?.value) {
                        errorMessage = ctx.event.status.value;
                    } else if (ctx.event?.status?.tag === 'OutOfEnergy') {
                        errorMessage = 'Server is overloaded, please try again later';
                    } else {
                        // Fallback for unknown status types
                        errorMessage = `Registration failed with status: ${ctx.event?.status?.tag || 'Unknown'}`;
                    }
                    reject(new Error(errorMessage));
                }
            };

            // Register the callback before calling the reducer
            connection.reducers.onRegisterPlayer(handleRegisterResult);

            try {
                console.log(`[GameConnectionProvider] Calling registerPlayer reducer with username: ${username}`);
                connection.reducers.registerPlayer(username);
            } catch (err: any) {
                // Remove the callback if the reducer call itself failed
                connection.reducers.removeOnRegisterPlayer(handleRegisterResult);
                console.error('[GameConnectionProvider] Failed to call registerPlayer reducer:', err);
                const errorMessage = `Failed to call registerPlayer: ${err.message || err}.`;
                setConnectionError(errorMessage);
                reject(new Error(errorMessage));
            }
        });
    }, [isConnected, connection, dbIdentity]); // Include dbIdentity in dependencies

    // Context value (provide state variable)
    const contextValue: ConnectionContextState = {
        connection,
        dbIdentity,
        isConnected,
        isLoading: isConnecting, 
        error: connectionError, 
        registerPlayer,
        retryConnection,
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