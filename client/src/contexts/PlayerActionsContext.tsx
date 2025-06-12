import React, { createContext, useContext, ReactNode, useCallback, useRef, useState } from 'react';
import { useGameConnection } from './GameConnectionContext';

// Performance monitoring constants
const NETWORK_LAG_THRESHOLD = 50; // More than 50ms for network call setup is concerning
const NETWORK_LOG_INTERVAL = 15000; // Log every 15 seconds
const THROTTLE_LOG_INTERVAL = 30000; // Log throttling stats every 30 seconds

// Performance monitoring for network actions
class NetworkPerformanceMonitor {
  private networkTimings: number[] = [];
  private lastLogTime = 0;
  private lagSpikes = 0;
  private totalCalls = 0;
  private throttledCalls = 0;
  private duplicateCalls = 0;

  logNetworkCall(callTime: number, callType: string) {
    this.totalCalls++;
    this.networkTimings.push(callTime);
    
    if (callTime > NETWORK_LAG_THRESHOLD) {
      this.lagSpikes++;
      console.warn(`🐌 [PlayerActions] NETWORK LAG SPIKE: ${callType} took ${callTime.toFixed(2)}ms (threshold: ${NETWORK_LAG_THRESHOLD}ms)`);
    }

    const now = Date.now();
    if (now - this.lastLogTime > NETWORK_LOG_INTERVAL) {
      this.reportPerformance();
      this.reset();
      this.lastLogTime = now;
    }
  }

  logThrottledCall(callType: string) {
    this.throttledCalls++;
    console.log(`⏭️ [PlayerActions] Call throttled: ${callType}`);
  }

  logDuplicateCall(callType: string) {
    this.duplicateCalls++;
    console.log(`🔄 [PlayerActions] Duplicate call ignored: ${callType}`);
  }

  private reportPerformance() {
    if (this.networkTimings.length === 0) return;

    const avg = this.networkTimings.reduce((a, b) => a + b, 0) / this.networkTimings.length;
    const max = Math.max(...this.networkTimings);

    // console.log(`📊 [PlayerActions] Network Performance Report:
    //   Average Network Call Time: ${avg.toFixed(2)}ms
    //   Max Network Call Time: ${max.toFixed(2)}ms
    //   Network Lag Spikes: ${this.lagSpikes}/${this.totalCalls} (${((this.lagSpikes/this.totalCalls)*100).toFixed(1)}%)
    //   Throttled Calls: ${this.throttledCalls}
    //   Duplicate Calls: ${this.duplicateCalls}
    //   Total Calls: ${this.totalCalls}`);
  }

  private reset() {
    this.networkTimings = [];
    this.lagSpikes = 0;
    this.totalCalls = 0;
    this.throttledCalls = 0;
    this.duplicateCalls = 0;
  }
}

const networkMonitor = new NetworkPerformanceMonitor();

// Enhanced player actions interface with restored auto-walk and auto-attack
interface PlayerActionsContextState {
    // Movement actions
    updatePlayerPosition: (moveX: number, moveY: number) => void;
    jump: () => void;
    setSprinting: (isSprinting: boolean) => void;
    
    // Auto-walking state and controls - RESTORED
    isAutoWalking: boolean;
    toggleAutoWalk: () => void;
    stopAutoWalk: () => void;
    
    // Auto-attacking state and controls - RESTORED
    isAutoAttacking: boolean;
    toggleAutoAttack: () => void;
    stopAutoAttack: () => void;
    
    // Viewport updates
    updateViewport: (minX: number, minY: number, maxX: number, maxY: number) => void;
}

const PlayerActionsContext = createContext<PlayerActionsContextState | undefined>(undefined);

// Throttling constants for performance
const MOVEMENT_THROTTLE_MS = 16; // ~60fps max for movement updates
const VIEWPORT_THROTTLE_MS = 200; // Slower viewport updates
const JUMP_THROTTLE_MS = 500; // Prevent jump spam
const AUTO_ACTION_THROTTLE_MS = 1000; // Prevent auto-action spam

export const PlayerActionsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const connection = useGameConnection();
    
    // RESTORED: Auto-walking and auto-attacking state
    const [isAutoWalking, setIsAutoWalking] = useState(false);
    const [isAutoAttacking, setIsAutoAttacking] = useState(false);
    
    // Throttling state with performance monitoring
    const lastMovementCall = useRef<number>(0);
    const lastViewportCall = useRef<number>(0);
    const lastJumpCall = useRef<number>(0);
    const lastAutoActionCall = useRef<number>(0);
    const lastMovementData = useRef<{ x: number; y: number } | null>(null);
    const lastViewportData = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
    const sprintState = useRef<boolean>(false);

    // Performance-monitored movement update
    const updatePlayerPosition = useCallback((moveX: number, moveY: number) => {
        const callStartTime = performance.now();
        
        try {
            if (!connection?.isConnected) {
                console.warn(`⚠️ [PlayerActions] Movement called but connection not ready`);
                return;
            }

            const now = Date.now();
            
            // Throttle rapid movement calls
            if (now - lastMovementCall.current < MOVEMENT_THROTTLE_MS) {
                networkMonitor.logThrottledCall('updatePlayerPosition');
                return;
            }

            // Check for duplicate movement data
            if (lastMovementData.current && 
                lastMovementData.current.x === moveX && 
                lastMovementData.current.y === moveY) {
                networkMonitor.logDuplicateCall('updatePlayerPosition');
                return;
            }

            // Update tracking data
            lastMovementCall.current = now;
            lastMovementData.current = { x: moveX, y: moveY };

            // NOTE: Movement is now handled by usePredictedMovement hook
            // This function is kept for backwards compatibility but does nothing
            console.log(`[PlayerActions] Movement handled by simple movement system: (${moveX}, ${moveY})`);

        } catch (error) {
            console.error(`❌ [PlayerActions] Error in updatePlayerPosition:`, error);
        } finally {
            const callTime = performance.now() - callStartTime;
            networkMonitor.logNetworkCall(callTime, 'updatePlayerPosition');
        }
    }, [connection]);

    // Performance-monitored jump action
    const jump = useCallback(() => {
        const callStartTime = performance.now();
        
        try {
            if (!connection?.isConnected) {
                console.warn(`⚠️ [PlayerActions] Jump called but connection not ready`);
                return;
            }

            const now = Date.now();
            
            // Throttle rapid jump calls
            if (now - lastJumpCall.current < JUMP_THROTTLE_MS) {
                networkMonitor.logThrottledCall('jump');
                return;
            }

            lastJumpCall.current = now;
            connection.connection?.reducers.jump();

        } catch (error) {
            console.error(`❌ [PlayerActions] Error in jump:`, error);
        } finally {
            const callTime = performance.now() - callStartTime;
            networkMonitor.logNetworkCall(callTime, 'jump');
        }
    }, [connection]);

    // Performance-monitored sprint state update
    const setSprinting = useCallback((isSprinting: boolean) => {
        const callStartTime = performance.now();
        
        try {
            if (!connection?.isConnected) {
                console.warn(`⚠️ [PlayerActions] Sprint called but connection not ready`);
                return;
            }

            // Check for duplicate sprint state
            if (sprintState.current === isSprinting) {
                networkMonitor.logDuplicateCall('setSprinting');
                return;
            }

            sprintState.current = isSprinting;
            connection.connection?.reducers.setSprinting(isSprinting);

        } catch (error) {
            console.error(`❌ [PlayerActions] Error in setSprinting:`, error);
        } finally {
            const callTime = performance.now() - callStartTime;
            networkMonitor.logNetworkCall(callTime, 'setSprinting');
        }
    }, [connection]);

    // RESTORED: Auto-walking toggle with performance monitoring
    const toggleAutoWalk = useCallback(() => {
        const callStartTime = performance.now();
        
        try {
            const now = Date.now();
            
            // Throttle rapid auto-action calls
            if (now - lastAutoActionCall.current < AUTO_ACTION_THROTTLE_MS) {
                networkMonitor.logThrottledCall('toggleAutoWalk');
                return;
            }

            lastAutoActionCall.current = now;
            setIsAutoWalking(prev => {
                const newState = !prev;
                console.log(`🚶 [PlayerActions] Auto-walk ${newState ? 'ENABLED' : 'DISABLED'}`);
                return newState;
            });

        } catch (error) {
            console.error(`❌ [PlayerActions] Error in toggleAutoWalk:`, error);
        } finally {
            const callTime = performance.now() - callStartTime;
            networkMonitor.logNetworkCall(callTime, 'toggleAutoWalk');
        }
    }, []);

    // RESTORED: Auto-walking stop with performance monitoring
    const stopAutoWalk = useCallback(() => {
        const callStartTime = performance.now();
        
        try {
            if (isAutoWalking) {
                setIsAutoWalking(false);
                console.log(`🛑 [PlayerActions] Auto-walk STOPPED`);
            }

        } catch (error) {
            console.error(`❌ [PlayerActions] Error in stopAutoWalk:`, error);
        } finally {
            const callTime = performance.now() - callStartTime;
            networkMonitor.logNetworkCall(callTime, 'stopAutoWalk');
        }
    }, [isAutoWalking]);

    // RESTORED: Auto-attacking toggle with performance monitoring
    const toggleAutoAttack = useCallback(() => {
        const callStartTime = performance.now();
        
        try {
            const now = Date.now();
            
            // Throttle rapid auto-action calls
            if (now - lastAutoActionCall.current < AUTO_ACTION_THROTTLE_MS) {
                networkMonitor.logThrottledCall('toggleAutoAttack');
                return;
            }

            lastAutoActionCall.current = now;
            setIsAutoAttacking(prev => {
                const newState = !prev;
                console.log(`⚔️ [PlayerActions] Auto-attack ${newState ? 'ENABLED' : 'DISABLED'}`);
                return newState;
            });

        } catch (error) {
            console.error(`❌ [PlayerActions] Error in toggleAutoAttack:`, error);
        } finally {
            const callTime = performance.now() - callStartTime;
            networkMonitor.logNetworkCall(callTime, 'toggleAutoAttack');
        }
    }, []);

    // RESTORED: Auto-attacking stop with performance monitoring
    const stopAutoAttack = useCallback(() => {
        const callStartTime = performance.now();
        
        try {
            if (isAutoAttacking) {
                setIsAutoAttacking(false);
                console.log(`🛑 [PlayerActions] Auto-attack STOPPED`);
            }

        } catch (error) {
            console.error(`❌ [PlayerActions] Error in stopAutoAttack:`, error);
        } finally {
            const callTime = performance.now() - callStartTime;
            networkMonitor.logNetworkCall(callTime, 'stopAutoAttack');
        }
    }, [isAutoAttacking]);

    // Performance-monitored viewport update
    const updateViewport = useCallback((minX: number, minY: number, maxX: number, maxY: number) => {
        const callStartTime = performance.now();
        
        try {
            if (!connection?.isConnected) {
                console.warn(`⚠️ [PlayerActions] Viewport called but connection not ready`);
                return;
            }

            const now = Date.now();
            
            // Throttle rapid viewport calls
            if (now - lastViewportCall.current < VIEWPORT_THROTTLE_MS) {
                networkMonitor.logThrottledCall('updateViewport');
                return;
            }

            // Check for duplicate viewport data
            if (lastViewportData.current && 
                lastViewportData.current.minX === minX && 
                lastViewportData.current.minY === minY &&
                lastViewportData.current.maxX === maxX && 
                lastViewportData.current.maxY === maxY) {
                networkMonitor.logDuplicateCall('updateViewport');
                return;
            }

            // Update tracking data
            lastViewportCall.current = now;
            lastViewportData.current = { minX, minY, maxX, maxY };
            
            connection.connection?.reducers.updateViewport(minX, minY, maxX, maxY);

        } catch (error) {
            console.error(`❌ [PlayerActions] Error in updateViewport:`, error);
        } finally {
            const callTime = performance.now() - callStartTime;
            networkMonitor.logNetworkCall(callTime, 'updateViewport');
        }
    }, [connection]);

    // Enhanced context value with restored auto-walk and auto-attack functionality
    const contextValue: PlayerActionsContextState = {
        // Movement actions
        updatePlayerPosition,
        jump,
        setSprinting,
        
        // RESTORED: Auto-walking state and controls
        isAutoWalking,
        toggleAutoWalk,
        stopAutoWalk,
        
        // RESTORED: Auto-attacking state and controls
        isAutoAttacking,
        toggleAutoAttack,
        stopAutoAttack,
        
        // Viewport updates
        updateViewport,
    };

    return (
        <PlayerActionsContext.Provider value={contextValue}>
            {children}
        </PlayerActionsContext.Provider>
    );
};

export const usePlayerActions = () => {
    const context = useContext(PlayerActionsContext);
    if (context === undefined) {
        throw new Error('usePlayerActions must be used within a PlayerActionsProvider');
    }
    return context;
}; 