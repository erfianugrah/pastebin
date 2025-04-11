// Enhanced service worker for Pasteriser with better error handling
const CACHE_NAME = 'pastebin-v1';

// Files to cache - only include stable files that don't change often
const CACHE_FILES = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  '/site.webmanifest',
  '/offline.html'
];

// Explicitly exclude problematic JavaScript assets
const EXCLUDE_FILES = [
  '/assets/crypto',  // Don't cache crypto.js file
  '/assets/CodeViewer' // Don't cache CodeViewer.js file
];

// Check if URL should be excluded from caching
function shouldExclude(url) {
  return EXCLUDE_FILES.some(pattern => url.includes(pattern));
}

// Install event - cache static assets
self.addEventListener('install', (event) => {
  // Skip waiting to activate immediately
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Pre-caching offline page');
        return cache.addAll(CACHE_FILES)
          .catch(error => {
            console.error('[ServiceWorker] Pre-cache error:', error);
            // Continue even if some files fail to cache
            return Promise.resolve();
          });
      })
  );
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  // Claim clients immediately
  event.waitUntil(self.clients.claim());
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event - respond with cached content when offline
self.addEventListener('fetch', (event) => {
  // Skip for excluded files
  if (shouldExclude(event.request.url)) {
    console.log('[ServiceWorker] Skipping cache for:', event.request.url);
    return;
  }

  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // For HTML navigations, use network-first strategy
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          return caches.match('/offline.html');
        })
    );
    return;
  }

  // For other assets, use cache-first strategy
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return the cached response
        if (response) {
          return response;
        }

        // Clone the request for the fetch call
        const fetchRequest = event.request.clone();

        // Make the network request
        return fetch(fetchRequest)
          .then((response) => {
            // Check if we received a valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone the response for caching and returning
            const responseToCache = response.clone();

            // Cache the new file
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              })
              .catch(error => {
                console.error('[ServiceWorker] Cache put error:', error);
              });

            return response;
          })
          .catch(() => {
            // If the network is unavailable, serve fallback content
            if (event.request.destination === 'image') {
              return caches.match('/favicon.svg');
            }
            
            return new Response('Network error occurred', {
              status: 408,
              headers: { 'Content-Type': 'text/plain' }
            });
          });
      })
  );
});