import { useEffect } from 'react';

/**
 * Component that registers the service worker with
 * a delay and proper error handling
 */
export default function DelayedServiceWorker() {
  useEffect(() => {
    // Check if service workers are supported
    if ('serviceWorker' in navigator) {
      // Delay registration to avoid competing with critical resources
      const timer = setTimeout(() => {
        navigator.serviceWorker.register('/service-worker.js')
          .then(registration => {
            console.log('Service Worker registered with scope:', registration.scope);
          })
          .catch(error => {
            console.warn('Service Worker registration failed:', error);
            // This is non-critical, app will still work without service worker
          });
      }, 5000); // 5 second delay
      
      return () => clearTimeout(timer);
    }
  }, []);
  
  // This component doesn't render anything
  return null;
}