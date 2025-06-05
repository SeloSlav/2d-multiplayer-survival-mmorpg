import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

/**
 * Global auth error handler that listens for various authentication-related errors
 * and automatically invalidates tokens when they occur
 */
export const useAuthErrorHandler = () => {
    const { invalidateCurrentToken } = useAuth();

    useEffect(() => {
        // Global error handler for unhandled promise rejections
        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            const error = event.reason;
            const errorMessage = error?.message || error?.toString() || '';
            
            // Check if this looks like an auth error
            if (errorMessage.includes('401') || 
                errorMessage.toLowerCase().includes('unauthorized') ||
                errorMessage.toLowerCase().includes('websocket-token') ||
                errorMessage.toLowerCase().includes('authentication failed') ||
                errorMessage.toLowerCase().includes('invalid token')) {
                
                console.warn('[AuthErrorHandler] Detected auth error in unhandled rejection:', errorMessage);
                invalidateCurrentToken();
            }
        };

        // Global error handler for uncaught errors
        const handleError = (event: ErrorEvent) => {
            const errorMessage = event.message || event.error?.message || '';
            
            // Check if this looks like an auth error
            if (errorMessage.includes('401') || 
                errorMessage.toLowerCase().includes('unauthorized') ||
                errorMessage.toLowerCase().includes('websocket-token') ||
                errorMessage.toLowerCase().includes('authentication failed') ||
                errorMessage.toLowerCase().includes('invalid token')) {
                
                console.warn('[AuthErrorHandler] Detected auth error in global error:', errorMessage);
                invalidateCurrentToken();
            }
        };

        // Network error interceptor for fetch requests
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            try {
                const response = await originalFetch(...args);
                
                // Check for 401 responses
                if (response.status === 401) {
                    const url = args[0]?.toString() || 'unknown';
                    console.warn('[AuthErrorHandler] Detected 401 response from fetch:', url);
                    invalidateCurrentToken();
                }
                
                return response;
            } catch (error: any) {
                // Re-throw the error but also check if it's auth-related
                const errorMessage = error?.message || error?.toString() || '';
                if (errorMessage.includes('401') || 
                    errorMessage.toLowerCase().includes('unauthorized')) {
                    console.warn('[AuthErrorHandler] Detected auth error in fetch:', errorMessage);
                    invalidateCurrentToken();
                }
                throw error;
            }
        };

        // Add event listeners
        window.addEventListener('unhandledrejection', handleUnhandledRejection);
        window.addEventListener('error', handleError);

        // Cleanup
        return () => {
            window.removeEventListener('unhandledrejection', handleUnhandledRejection);
            window.removeEventListener('error', handleError);
            window.fetch = originalFetch; // Restore original fetch
        };
    }, [invalidateCurrentToken]);
}; 