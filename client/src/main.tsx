// Silence console.log in production - MUST be first import
import './utils/productionLogger';

import ReactDOM from 'react-dom/client';
import App from './App';
import { clearDevelopmentServiceWorker } from './services/developmentServiceWorker';

const EXPECTED_SILENT_SENDER_ERRORS = [
  'Too far away to interact with this resource',
  'Too far away to pick up the item',
  'This resource has already been harvested and is respawning.',
  'Dropped item with ID',
  'Already dodge rolling.',
];

// Global error handler for unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason;
  const errorMessage = error?.message || String(error);
  
  // Check if this is a SpacetimeDB deserialization error
  if (errorMessage.includes('Tried to read') && errorMessage.includes('byte(s)')) {
    console.error('[CRITICAL] SpacetimeDB deserialization error detected:', errorMessage);
    console.error('[CRITICAL] This usually indicates:', {
      possibleCauses: [
        'Schema mismatch between client and server',
        'Corrupted data in the database',
        'Version mismatch between SDK versions',
        'Network corruption during data transmission'
      ],
      error: error,
      stack: error?.stack
    });
    
    // Prevent the error from crashing the app
    event.preventDefault();
    
    // Try to recover by reloading the page after a delay
    // This will force a fresh connection and regenerate bindings if needed
    console.warn('[RECOVERY] Attempting to recover by reloading page in 3 seconds...');
    setTimeout(() => {
      window.location.reload();
    }, 3000);
    
    return;
  }

  // Ignore expected reducer rejections that are normal gameplay races
  // (e.g., target moved out of range or another player harvested first).
  if (error?.name === 'SenderError') {
    const shouldSilence = EXPECTED_SILENT_SENDER_ERRORS.some((msg) => errorMessage.includes(msg));
    if (shouldSilence) {
      event.preventDefault();
      return;
    }
  }
  
  // Log other unhandled rejections but don't prevent them
  console.error('[Unhandled Promise Rejection]:', error);
});

// Global error handler for regular errors
window.addEventListener('error', (event) => {
  const error = event.error;
  const errorMessage = error?.message || event.message || String(event);
  
  // Check if this is a SpacetimeDB deserialization error
  if (errorMessage.includes('Tried to read') && errorMessage.includes('byte(s)')) {
    console.error('[CRITICAL] SpacetimeDB deserialization error detected:', errorMessage);
    event.preventDefault();
    
    // Try to recover by reloading the page
    console.warn('[RECOVERY] Attempting to recover by reloading page in 3 seconds...');
    setTimeout(() => {
      window.location.reload();
    }, 3000);
    
    return;
  }
});

// Register Service Worker for asset caching
if (import.meta.env.DEV) {
  void clearDevelopmentServiceWorker().catch(error=>console.warn('[SW] Local worker cleanup failed:',error));
} else if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[SW] Service Worker registered successfully:', registration.scope);
        
        // Check for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[SW] New content available, will be used on next reload');
              }
            });
          }
        });
      })
      .catch((error) => {
        console.warn('[SW] Service Worker registration failed:', error);
        // Don't block the app if SW fails
      });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
);
