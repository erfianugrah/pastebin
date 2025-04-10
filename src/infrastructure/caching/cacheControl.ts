/**
 * Helper functions for adding cache control headers to responses
 */

/**
 * Adds caching headers to a response
 * @param response The original response
 * @param maxAge Maximum age in seconds for the cache
 * @returns A new response with caching headers
 */
export function addCacheHeaders(
  response: Response, 
  options: {
    maxAge?: number;
    staleWhileRevalidate?: number;
    isPrivate?: boolean;
    varyHeaders?: string[];
  } = {}
): Response {
  // Default options
  const maxAge = options.maxAge ?? 3600; // 1 hour default
  const staleWhileRevalidate = options.staleWhileRevalidate ?? 86400; // 1 day default
  const isPrivate = options.isPrivate ?? false;
  const varyHeaders = options.varyHeaders ?? ['Accept', 'Accept-Encoding'];

  // Create new headers from original response
  const headers = new Headers(response.headers);
  
  // Set Cache-Control header
  const cacheControl = [
    isPrivate ? 'private' : 'public',
    `max-age=${maxAge}`,
    `stale-while-revalidate=${staleWhileRevalidate}`,
  ].join(', ');
  
  headers.set('Cache-Control', cacheControl);
  
  // Set Vary header
  headers.set('Vary', varyHeaders.join(', '));
  
  // Return new response with updated headers
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Adds caching headers for static assets
 */
export function cacheStaticAsset(response: Response, fileExtension?: string): Response {
  // Create a new Headers object from the original response
  const headers = new Headers(response.headers);
  
  // Set the correct Content-Type header based on file extension
  if (fileExtension) {
    switch (fileExtension.toLowerCase()) {
      case 'js':
        headers.set('Content-Type', 'application/javascript');
        break;
      case 'css':
        headers.set('Content-Type', 'text/css');
        break;
      case 'svg':
        headers.set('Content-Type', 'image/svg+xml');
        break;
      case 'png':
        headers.set('Content-Type', 'image/png');
        break;
      case 'jpg':
      case 'jpeg':
        headers.set('Content-Type', 'image/jpeg');
        break;
      case 'gif':
        headers.set('Content-Type', 'image/gif');
        break;
      case 'webp':
        headers.set('Content-Type', 'image/webp');
        break;
      case 'ico':
        headers.set('Content-Type', 'image/x-icon');
        break;
      case 'html':
        headers.set('Content-Type', 'text/html');
        break;
    }
  }
  
  // Create a new response with the updated headers
  const responseWithCorrectType = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  
  // Add cache headers
  return addCacheHeaders(responseWithCorrectType, {
    maxAge: 86400, // 1 day
    staleWhileRevalidate: 604800, // 1 week
  });
}

/**
 * Adds caching headers for paste content (view)
 */
export function cachePasteView(response: Response): Response {
  return addCacheHeaders(response, {
    maxAge: 3600, // 1 hour
    staleWhileRevalidate: 86400, // 1 day
  });
}

/**
 * Adds no-cache headers for dynamic content
 */
export function preventCaching(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}