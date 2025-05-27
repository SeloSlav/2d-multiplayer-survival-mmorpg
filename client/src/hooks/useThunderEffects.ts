import { useEffect } from 'react';
import { triggerThunderFlash } from '../utils/renderers/rainRenderingUtils';

interface UseThunderEffectsProps {
  connection: any | null;
}

export function useThunderEffects({ connection }: UseThunderEffectsProps) {
  useEffect(() => {
    if (!connection) return;

    // Listen for thunder events from the server
    const handleThunderEvent = (ctx: any, thunderEvent: any) => {
      console.log(`[Thunder] Received thunder event with intensity ${thunderEvent.intensity}`);
      
      // Trigger the client-side thunder flash effect
      triggerThunderFlash(thunderEvent.intensity);
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

    // Add manual test function for development
    if (process.env.NODE_ENV === 'development') {
      (window as any).testThunder = (intensity: number = 0.8) => {
        console.log(`⚡ Testing thunder flash with intensity ${intensity}`);
        triggerThunderFlash(intensity);
      };
      console.log('⚡ Test function available! Use: window.testThunder() or window.testThunder(0.9)');
    }

    // Cleanup function
    return () => {
      try {
        // Note: SpacetimeDB client doesn't have a direct unsubscribe method
        // The subscription will be cleaned up when the connection is closed
        console.log('[Thunder] Thunder effects hook cleanup');
        
        // Clean up test function
        if (process.env.NODE_ENV === 'development') {
          delete (window as any).testThunder;
        }
      } catch (error) {
        console.error('[Thunder] Error during thunder effects cleanup:', error);
      }
    };
  }, [connection]);
} 