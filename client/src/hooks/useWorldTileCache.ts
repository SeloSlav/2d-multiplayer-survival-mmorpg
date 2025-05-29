import { useState, useEffect, useRef } from 'react';
import { ProceduralWorldRenderer } from '../utils/renderers/proceduralWorldRenderer';
import { WorldTile } from '../generated/world_tile_type';
import { TileType } from '../generated/tile_type_type';

interface WorldTileCacheHook {
    proceduralRenderer: ProceduralWorldRenderer | null;
    isInitialized: boolean;
    cacheStats: {
        tilesLoaded: number;
        imagesLoaded: number;
        isInitialized: boolean;
        lastUpdate: number;
    };
    updateTileCache: (worldTiles: Map<string, WorldTile>) => void;
}

export function useWorldTileCache(): WorldTileCacheHook {
    const [proceduralRenderer, setProceduralRenderer] = useState<ProceduralWorldRenderer | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [cacheStats, setCacheStats] = useState({
        tilesLoaded: 0,
        imagesLoaded: 0,
        isInitialized: false,
        lastUpdate: 0
    });
    
    // Use a ref to track initialization to avoid stale closure issues
    const isInitializedRef = useRef(false);

    // Initialize the procedural renderer on first mount
    useEffect(() => {
        const renderer = new ProceduralWorldRenderer();
        setProceduralRenderer(renderer);
        
        // Poll for initialization status
        const checkInitialization = () => {
            const stats = renderer.getCacheStats();
            setCacheStats(stats);
            
            // Use ref instead of state to avoid stale closure
            if (stats.isInitialized && !isInitializedRef.current) {
                isInitializedRef.current = true;
                setIsInitialized(true);
                console.log('[useWorldTileCache] Procedural world renderer initialized');
            }
        };
        
        const intervalId = setInterval(checkInitialization, 100);
        
        // Cleanup interval on unmount
        return () => {
            clearInterval(intervalId);
        };
    }, []); // FIXED: Empty dependency array to prevent infinite loop

    const updateTileCache = (worldTiles: Map<string, WorldTile>) => {
        if (proceduralRenderer) {
            proceduralRenderer.updateTileCache(worldTiles);
            setCacheStats(proceduralRenderer.getCacheStats());
        }
    };

    return {
        proceduralRenderer,
        isInitialized,
        cacheStats,
        updateTileCache
    };
}

export type { WorldTile, TileType }; 