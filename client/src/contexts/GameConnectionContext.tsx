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

// Define connection state enum for better state management
enum ConnectionState {
    DISCONNECTED = 'disconnected',
    CONNECTING = 'connecting', 
    CONNECTED = 'connected',
    ERROR = 'error'
}

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
    const { spacetimeToken, invalidateCurrentToken } = useAuth(); 
    
    // Consolidated connection state
    const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
    const [connection, setConnection] = useState<DbConnection | null>(null);
    const [dbIdentity, setDbIdentity] = useState<SpacetimeDBIdentity | null>(null);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [retryCount, setRetryCount] = useState<number>(0);
    
    // Refs for cleanup and connection management
    const connectionInstanceRef = useRef<DbConnection | null>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const isCleaningUpRef = useRef<boolean>(false);

    // Batch state updates to prevent excessive re-renders
    const updateConnectionState = useCallback((
        state: ConnectionState,
        conn: DbConnection | null = null,
        identity: SpacetimeDBIdentity | null = null,
        error: string | null = null
    ) => {
        // Prevent state updates during cleanup
        if (isCleaningUpRef.current) return;
        
        setConnectionState(state);
        setConnection(conn);
        setDbIdentity(identity);
        setConnectionError(error);
    }, []);

    // Improved cleanup function
    const cleanupConnection = useCallback(() => {
        isCleaningUpRef.current = true;
        
        // Clear timeout
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        
        // Abort any pending connections
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        
        // Disconnect existing connection
        if (connectionInstanceRef.current) {
            try {
                connectionInstanceRef.current.disconnect();
            } catch (err) {
                console.warn('[GameConn] Error during disconnect:', err);
            }
            connectionInstanceRef.current = null;
        }
        
        isCleaningUpRef.current = false;
    }, []);

    // Manual retry function
    const retryConnection = useCallback(() => {
        console.log("[GameConn LOG] Manual retry requested");
        cleanupConnection();
        setRetryCount(prev => prev + 1);
        setConnectionError(null);
        // Don't set state here - let the effect handle it
    }, [cleanupConnection]);

    // Connection logic - Simplified and optimized
    useEffect(() => {
        console.log(`[GameConn LOG] useEffect triggered. Token exists: ${!!spacetimeToken}. State: ${connectionState}. retryCount: ${retryCount}`);

        // Guard conditions
        if (!spacetimeToken) {
            console.log("[GameConn LOG] No token - cleaning up connection");
            cleanupConnection();
            updateConnectionState(ConnectionState.DISCONNECTED);
            return;
        }
        
        if (connectionState === ConnectionState.CONNECTING || connectionState === ConnectionState.CONNECTED) { 
            console.log("[GameConn LOG] Already connecting or connected - skipping");
            return;
        }

        // Start connection attempt
        console.log("[GameConn LOG] Starting connection attempt..."); 
        updateConnectionState(ConnectionState.CONNECTING);
        
        // Create abort controller for this connection attempt
        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        
        // Set up connection timeout with better error handling
        const connectionTimeoutMs = isDevelopment ? 5000 : 8000;
        const timeoutId = setTimeout(() => {
            if (abortController.signal.aborted) return;
            
            console.warn('[GameConn LOG] Connection timeout - force cleanup');
            abortController.abort();
            cleanupConnection();
            updateConnectionState(
                ConnectionState.ERROR,
                null,
                null,
                `Connection timeout after ${connectionTimeoutMs/1000}s. Server may be offline.`
            );
        }, connectionTimeoutMs);
        timeoutRef.current = timeoutId;

        try {
            const builder = DbConnection.builder()
                .withUri(SPACETIME_DB_ADDRESS)
                .withModuleName(SPACETIME_DB_NAME)
                .withToken(spacetimeToken)
                .onConnect((conn: DbConnection, identity: SpacetimeDBIdentity) => {
                    if (abortController.signal.aborted) return;
                    
                    console.log('[GameConn LOG] Connection successful');
                    
                    // Clear timeout
                    if (timeoutRef.current) {
                        clearTimeout(timeoutRef.current);
                        timeoutRef.current = null;
                    }
                    
                    connectionInstanceRef.current = conn;
                    updateConnectionState(ConnectionState.CONNECTED, conn, identity, null);
                    setRetryCount(0);
                })
                .onDisconnect((context: any, err?: Error) => {
                    if (abortController.signal.aborted) return;
                    
                    console.log('[GameConn LOG] Disconnected', err ? `Error: ${err.message}` : 'Graceful');
                    
                    cleanupConnection();
                    
                    if (err) {
                        const errorMessage = err.message || 'Connection lost';
                        updateConnectionState(ConnectionState.ERROR, null, null, errorMessage);
                        
                        // Check for auth errors
                        if (errorMessage.includes("401") || 
                            errorMessage.toLowerCase().includes("unauthorized") ||
                            errorMessage.toLowerCase().includes("auth")) {
                            console.warn("[GameConn LOG] Auth error detected - invalidating token");
                            invalidateCurrentToken();
                        }
                    } else {
                        updateConnectionState(ConnectionState.DISCONNECTED);
                    }
                })
                .onConnectError((context: any, err: Error) => {
                    if (abortController.signal.aborted) return;
                    
                    console.error('[GameConn LOG] Connection error:', err);
                    
                    cleanupConnection();
                    
                    const errorMessage = err.message || err.toString();
                    updateConnectionState(
                        ConnectionState.ERROR,
                        null,
                        null,
                        'Unable to connect to game servers. Please check your connection and try again.'
                    );
                    
                    // Check for auth errors
                    if (errorMessage.includes("401") || 
                        errorMessage.toLowerCase().includes("unauthorized") ||
                        errorMessage.toLowerCase().includes("auth")) {
                        console.warn("[GameConn LOG] Auth error in connect - invalidating token");
                        invalidateCurrentToken();
                    }
                });

            // Build connection
            const newConnectionInstance = builder.build();
            
            // Check if aborted after build
            if (abortController.signal.aborted) {
                try {
                    newConnectionInstance?.disconnect();
                } catch (e) {
                    console.warn('[GameConn] Error disconnecting aborted connection:', e);
                }
                return;
            }
            
        } catch (err: any) { 
            if (abortController.signal.aborted) return;
            
            console.error('[GameConn LOG] Build error:', err);
            cleanupConnection();
            updateConnectionState(
                ConnectionState.ERROR,
                null,
                null,
                `Connection failed: ${err.message || 'Unknown error'}`
            );
        }

        // Cleanup function
        return () => {
            console.log("[GameConn LOG] Effect cleanup");
            abortController.abort();
            cleanupConnection();
        };
    }, [spacetimeToken, invalidateCurrentToken, retryCount, cleanupConnection, updateConnectionState]);

    // Player registration function
    const registerPlayer = useCallback(async (username: string): Promise<void> => {
        if (connectionState !== ConnectionState.CONNECTED || !connection || !dbIdentity || !username.trim()) {
            const errorMessage = "Cannot register: Not connected to game servers";
            updateConnectionState(connectionState, connection, dbIdentity, errorMessage);
            throw new Error(errorMessage);
        }

        setConnectionError(null);
        
        return new Promise<void>((resolve, reject) => {
            const handleRegisterResult = (ctx: any, submittedUsername: string) => {
                connection.reducers.removeOnRegisterPlayer(handleRegisterResult);
                
                if (ctx.event?.status?.tag === 'Committed') {
                    console.log('[GameConn] Player registration successful');
                    resolve();
                } else {
                    let errorMessage = 'Registration failed';
                    if (ctx.event?.status?.tag === 'Failed' && ctx.event?.status?.value) {
                        errorMessage = ctx.event.status.value;
                    } else if (ctx.event?.status?.tag === 'OutOfEnergy') {
                        errorMessage = 'Server overloaded, try again later';
                    }
                    reject(new Error(errorMessage));
                }
            };

            connection.reducers.onRegisterPlayer(handleRegisterResult);

            try {
                connection.reducers.registerPlayer(username);
            } catch (err: any) {
                connection.reducers.removeOnRegisterPlayer(handleRegisterResult);
                const errorMessage = `Registration failed: ${err.message || err}`;
                setConnectionError(errorMessage);
                reject(new Error(errorMessage));
            }
        });
    }, [connectionState, connection, dbIdentity]);

    // Derived state for context
    const contextValue: ConnectionContextState = {
        connection,
        dbIdentity,
        isConnected: connectionState === ConnectionState.CONNECTED,
        isLoading: connectionState === ConnectionState.CONNECTING,
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