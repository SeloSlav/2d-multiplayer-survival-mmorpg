import { useState, useEffect, useRef, useCallback } from 'react';
import { ProceduralWorldRenderer } from '../utils/renderers/proceduralWorldRenderer';
import { WorldTile } from '../generated/world_tile_type';
import { TileType } from '../generated/tile_type_type';

interface WorldTileCacheHook {
    proceduralRenderer: ProceduralWorldRenderer | null;
    isInitialized: boolean;
    cacheStats: {
        tileCount: number;
        imageCount: number;
        initialized: boolean;
        lastUpdate: number;
    };
    updateTileCache: (worldTiles: Map<string, WorldTile>) => void;
}

export function useWorldTileCache(): WorldTileCacheHook {
    const [proceduralRenderer, setProceduralRenderer] = useState<ProceduralWorldRenderer | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [cacheStats, setCacheStats] = useState({
        tileCount: 0,
        imageCount: 0,
        initialized: false,
        lastUpdate: 0
    });
    
    // Use a ref to track initialization to avoid stale closure issues
    const isInitializedRef = useRef(false);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    // Initialize the procedural renderer on first mount
    useEffect(() => {
        const renderer = new ProceduralWorldRenderer();
        setProceduralRenderer(renderer);
        
        // Poll for initialization status
        const checkInitialization = () => {
            const stats = renderer.getCacheStats();
            
            // Only update state if stats have actually changed
            setCacheStats(prevStats => {
                if (
                    prevStats.tileCount !== stats.tileCount ||
                    prevStats.imageCount !== stats.imageCount ||
                    prevStats.initialized !== stats.initialized ||
                    prevStats.lastUpdate !== stats.lastUpdate
                ) {
                    return stats;
                }
                return prevStats;
            });
            
            // Use ref instead of state to avoid stale closure
            if (stats.initialized && !isInitializedRef.current) {
                isInitializedRef.current = true;
                setIsInitialized(true);
                console.log('[useWorldTileCache] Procedural world renderer initialized');
                
                // Clear the interval once initialization is complete
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                    intervalRef.current = null;
                }
            }
        };
        
        intervalRef.current = setInterval(checkInitialization, 100);
        
        // Cleanup interval on unmount
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, []); // FIXED: Empty dependency array to prevent infinite loop

    // Memoize updateTileCache to prevent it from changing on every render
    const updateTileCache = useCallback((worldTiles: Map<string, WorldTile>) => {
        if (proceduralRenderer) {
            proceduralRenderer.updateTileCache(worldTiles);
            // Only update cache stats if needed, and do it in a way that doesn't cause re-renders
            const newStats = proceduralRenderer.getCacheStats();
            setCacheStats(prevStats => {
                if (
                    prevStats.tileCount !== newStats.tileCount ||
                    prevStats.imageCount !== newStats.imageCount ||
                    prevStats.initialized !== newStats.initialized ||
                    prevStats.lastUpdate !== newStats.lastUpdate
                ) {
                    return newStats;
                }
                return prevStats;
            });
        }
    }, [proceduralRenderer]);

    return {
        proceduralRenderer,
        isInitialized,
        cacheStats,
        updateTileCache
    };
}

export type { WorldTile, TileType }; 