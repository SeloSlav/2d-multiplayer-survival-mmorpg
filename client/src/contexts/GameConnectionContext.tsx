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
}

// Create the context with a default value
const GameConnectionContext = createContext<ConnectionContextState>({
    connection: null,
    dbIdentity: null,
    isConnected: false,
    isLoading: false, // Start not loading
    error: null,
    registerPlayer: async () => { console.warn("GameConnectionContext not initialized for registerPlayer"); },
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

        // Add global unhandled promise rejection handler for SpacetimeDB errors
        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason;
            const errorMessage = reason?.message || reason?.toString() || 'Unknown error';
            
            // Check for connection-related errors
            if (errorMessage.includes('ERR_CONNECTION_REFUSED') || 
                errorMessage.includes('Failed to fetch') ||
                errorMessage.includes('fetch') ||
                errorMessage.includes('NetworkError')) {
                console.warn('[GameConn LOG] Caught unhandled promise rejection - connection error:', reason);
                setIsConnecting(false);
                // setConnectionError('SpacetimeDB server is not responding');
                event.preventDefault(); // Prevent the error from appearing in console as unhandled
            } else {
                console.warn('[GameConn LOG] Unhandled promise rejection (not connection-related):', reason);
            }
        };
        window.addEventListener('unhandledrejection', handleUnhandledRejection);

        // --- Condition to attempt connection --- 
        // console.log("[GameConn LOG] Attempting SpacetimeDB connection..."); // <-- LOG
        setIsConnecting(true); 
        setConnectionError(null);
        let newConnectionInstance: DbConnection | null = null;
        
        // Add timeout to handle cases where SpacetimeDB is completely down
        const connectionTimeout = setTimeout(() => {
            console.warn('[GameConn LOG] Connection timeout - SpacetimeDB server may be down');
            setIsConnecting(false);
            setConnectionError('Connection timeout - SpacetimeDB server may be down');
        }, 1500); // 1.5 second timeout - faster response for better UX

        try {
            console.log("[GameConn LOG] Calling DbConnection.builder().build()..."); // <-- LOG  
            const builder = DbConnection.builder()
                .withUri(SPACETIME_DB_ADDRESS)
                .withModuleName(SPACETIME_DB_NAME)
                .withToken(spacetimeToken) 
                .onConnect((conn: DbConnection, identity: SpacetimeDBIdentity) => {
                    // console.log('[GameConn LOG] onConnect: SpacetimeDB Connected. Identity:', identity.toHexString()); // <-- LOG
                    clearTimeout(connectionTimeout); // Clear timeout on successful connection
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
                    clearTimeout(connectionTimeout); // Clear timeout on connection error
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
                });

            // Use Promise.resolve to handle potential sync/async build() issues
            // Also add a race condition with a faster timeout for immediate failures
            console.log("[GameConn LOG] About to call builder.build()");
            
            try {
                const buildPromise = Promise.resolve(builder.build());
                const fastTimeout = new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error('Connection attempt timed out')), 1000)
                );
                
                Promise.race([buildPromise, fastTimeout])
                    .then((connection: DbConnection) => {
                        console.log("[GameConn LOG] Build promise resolved successfully");
                        clearTimeout(connectionTimeout);
                        newConnectionInstance = connection;
                    })
                    .catch((err: any) => {
                        console.error('[GameConn LOG] Build promise rejected:', err);
                        clearTimeout(connectionTimeout);
                        const errorMessage = err.message || err.toString();
                        setConnectionError(`SpacetimeDB Connection failed: ${errorMessage}`);
                        setIsConnecting(false);
                    });
            } catch (syncErr: any) {
                console.error('[GameConn LOG] Synchronous error from builder.build():', syncErr);
                clearTimeout(connectionTimeout);
                setConnectionError(`SpacetimeDB Connection failed: ${syncErr.message || syncErr}`);
                setIsConnecting(false);
            }

        } catch (err: any) { 
            console.error('[GameConn LOG] Failed to build SpacetimeDB connection:', err); // <-- LOG
            clearTimeout(connectionTimeout); // Clear timeout on build error
            setConnectionError(`SpacetimeDB Build failed: ${err.message || err}`);
            setIsConnecting(false); 
        }

        // Cleanup (Using REF variable for disconnect call)
        return () => {
            // console.log("[GameConn LOG] useEffect cleanup running..."); // <-- LOG
            clearTimeout(connectionTimeout); // Clear timeout on cleanup
            window.removeEventListener('unhandledrejection', handleUnhandledRejection); // Clean up event listener
            if (connectionInstanceRef.current) { 
                // console.log("[GameConn LOG] Cleanup: Calling disconnect on connection instance (ref)."); // <-- LOG
                connectionInstanceRef.current.disconnect();
                // State clearing is handled by onDisconnect callback
             }
        };
    // Reverted dependency array to simpler version, only depends on the token
    }, [spacetimeToken, invalidateCurrentToken]); 

    // Player registration function (can safely use state variable)
    const registerPlayer = useCallback(async (username: string): Promise<void> => {
        if (!connection || !isConnected || !username.trim()) {
            let reason = !connection ? "No SpacetimeDB connection" : !isConnected ? "Not connected to SpacetimeDB" : "Empty username";
            console.warn(`[GameConnectionProvider] Cannot register player: ${reason}.`);
            const errorMessage = `Cannot register: ${reason}.`;
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
                // console.log(`[GameConnectionProvider] Calling registerPlayer reducer with username: ${username}`);
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