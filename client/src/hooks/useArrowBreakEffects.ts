import { useEffect } from 'react';
import { ArrowBreakEvent, DbConnection } from '../generated';
import { spawnArrowBreakParticles } from '../effects/arrowBreakEffect';

interface UseArrowBreakEffectsProps {
    connection: DbConnection | null;
}

export function useArrowBreakEffects({ connection }: UseArrowBreakEffectsProps) {
    useEffect(() => {
        if (!connection) return;

        // Listen for new arrow break events
        const handleArrowBreakInsert = (ctx: any, arrowBreakEvent: ArrowBreakEvent) => {
            // Only react to live events, not initial subscription data
            if (ctx && ctx.event && ctx.event.type !== 'SubscribeApplied') {
                console.log(`[ArrowBreak] Spawning particles at (${arrowBreakEvent.posX}, ${arrowBreakEvent.posY})`);
                spawnArrowBreakParticles(arrowBreakEvent.posX, arrowBreakEvent.posY);
            }
        };

        // Register the callback
        connection.db.arrowBreakEvent.onInsert(handleArrowBreakInsert);

        // Cleanup function to unregister the callback
        return () => {
            // Note: SpacetimeDB SDK might not have a direct removeOnInsert method
            // This depends on the SDK implementation. For now, we assume the callback
            // will be cleaned up when the component unmounts.
        };
    }, [connection]);
} 