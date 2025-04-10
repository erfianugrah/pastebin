import { Env } from '../../types';

/**
 * Simple rate limiting implementation using KV storage
 * Limits requests per IP address within a specific time window
 */
export async function handleRateLimit(
  request: Request,
  env: Env,
  options: {
    limit?: number;
    windowSize?: number;
    pathPrefix?: string;
  } = {}
): Promise<Response | null> {
  // Get options with defaults
  const limit = options.limit || 30; // 30 requests per minute by default
  const windowSize = options.windowSize || 60 * 1000; // 1 minute window by default
  const pathPrefix = options.pathPrefix || ''; // Optional path prefix to limit specific endpoints

  // Check if path should be rate limited
  const url = new URL(request.url);
  if (pathPrefix && !url.pathname.startsWith(pathPrefix)) {
    return null;
  }

  // Get client IP
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const key = `ratelimit:${pathPrefix}:${ip}`;

  // Get current rate limit data from KV
  const data = await env.PASTES.get(key);
  const now = Date.now();
  
  let count = 0;
  let resetTime = now + windowSize;

  if (data) {
    try {
      const parsed = JSON.parse(data);
      // If within current window, use existing count
      if (now < parsed.resetTime) {
        count = parsed.count;
        resetTime = parsed.resetTime;
      }
      // Otherwise, we're in a new window, count resets to 0
    } catch (error) {
      // If data is invalid, we'll just use the defaults
      console.error('Error parsing rate limit data:', error);
    }
  }

  // Increment count
  count++;

  // Update KV with new count and expiration
  // TTL is set to the window size in seconds
  await env.PASTES.put(
    key,
    JSON.stringify({ count, resetTime }),
    { expirationTtl: Math.ceil(windowSize / 1000) }
  );

  // If count exceeds limit, return 429 Too Many Requests
  if (count > limit) {
    const retryAfter = Math.ceil((resetTime - now) / 1000);
    return new Response(
      JSON.stringify({
        error: {
          code: 'rate_limit_exceeded',
          message: 'Too many requests, please try again later',
          details: {
            retryAfter,
            limit,
            remaining: 0,
          },
        },
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': retryAfter.toString(),
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': Math.ceil(resetTime / 1000).toString(),
        },
      }
    );
  }

  // Not rate limited, continue processing request
  return null;
}