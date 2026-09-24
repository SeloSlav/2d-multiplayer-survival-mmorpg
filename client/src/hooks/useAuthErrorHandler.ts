import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

/** A voice-service error must never invalidate the game session. */
export const useAuthErrorHandler = () => {
    const { invalidateCurrentToken } = useAuth();

    useEffect(() => {
        const isGameTokenError = (message: string) => {
            const lower = message.toLowerCase();
            return lower.includes('websocket-token') ||
                (lower.includes('spacetimedb') && (
                    lower.includes('401') ||
                    lower.includes('unauthorized') ||
                    lower.includes('authentication failed') ||
                    lower.includes('invalid token')
                ));
        };

        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            const message = String(event.reason?.message || event.reason || '');
            if (isGameTokenError(message)) invalidateCurrentToken();
        };

        const handleError = (event: ErrorEvent) => {
            const message = String(event.message || event.error?.message || '');
            if (isGameTokenError(message)) invalidateCurrentToken();
        };

        window.addEventListener('unhandledrejection', handleUnhandledRejection);
        window.addEventListener('error', handleError);
        return () => {
            window.removeEventListener('unhandledrejection', handleUnhandledRejection);
            window.removeEventListener('error', handleError);
        };
    }, [invalidateCurrentToken]);
};
