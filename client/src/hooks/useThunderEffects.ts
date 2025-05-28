import { useEffect } from 'react';
import { handleServerThunderEvent } from '../utils/renderers/rainRenderingUtils';

interface UseThunderEffectsProps {
  connection: any | null;
}

export function useThunderEffects({ connection }: UseThunderEffectsProps) {
  useEffect(() => {
    if (!connection) return;

    // Listen for thunder events from the server
    const handleThunderEvent = (ctx: any, thunderEvent: any) => {
      console.log(`[Thunder] Received thunder event with intensity ${thunderEvent.intensity}`);
      
      // Use the safe server thunder event handler
      handleServerThunderEvent(thunderEvent);
    };

    // Subscribe to thunder events
    try {
      // Check if thunderEvent table exists in the generated bindings (note: camelCase)
      if (connection.db.thunderEvent && typeof connection.db.thunderEvent.onInsert === 'function') {
        connection.db.thunderEvent.onInsert(handleThunderEvent);
        console.log('[Thunder] Subscribed to thunder events');
      } else {
        console.warn('[Thunder] thunderEvent table not found in generated bindings. Available tables:', Object.keys(connection.db || {}));
      }
    } catch (error) {
      console.error('[Thunder] Failed to subscribe to thunder events:', error);
    }

    // REMOVED: Manual test function for safety - prevents players from triggering epileptic seizures
    // No debug commands that could be used to spam thunder flashes

    // Cleanup function
    return () => {
      try {
        // Note: SpacetimeDB client doesn't have a direct unsubscribe method
        // The subscription will be cleaned up when the connection is closed
        console.log('[Thunder] Thunder effects hook cleanup');
      } catch (error) {
        console.error('[Thunder] Error during thunder effects cleanup:', error);
      }
    };
  }, [connection]);
} 