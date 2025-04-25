import React, { ReactNode } from 'react';
import { GameConnectionProvider } from './GameConnectionContext';
import { PlayerActionsProvider } from './PlayerActionsContext';

interface GameContextsProviderProps {
    children: ReactNode;
}

/**
 * Combined provider that sets up all game-related contexts in the correct order.
 * This ensures proper dependency hierarchy (player actions depend on game connection).
 */
export const GameContextsProvider: React.FC<GameContextsProviderProps> = ({ children }) => {
    return (
        <GameConnectionProvider>
            <PlayerActionsProvider>
                {children}
            </PlayerActionsProvider>
        </GameConnectionProvider>
    );
};

/**
 * Use this in your App.tsx or main layout component to wrap your application
 * with all the required game contexts.
 * 
 * Example:
 * ```tsx
 * import { GameContextsProvider } from './contexts/GameContexts';
 * 
 * function App() {
 *   return (
 *     <GameContextsProvider>
 *       <YourGameComponents />
 *     </GameContextsProvider>
 *   );
 * }
 * ```
 */ 