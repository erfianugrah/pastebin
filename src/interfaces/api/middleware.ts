import { ConfigurationService } from '../../infrastructure/config/config';
import { Logger } from '../../infrastructure/logging/logger';

export class ApiMiddleware {
  constructor(
    private readonly configService: ConfigurationService,
    private readonly logger: Logger,
  ) {}

  async handleCors(request: Request): Promise<Response | null> {
    // Handle preflight request
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: this.getCorsHeaders(request),
      });
    }
    
    // For actual requests, just add CORS headers
    return null;
  }

  getCorsHeaders(request: Request): Headers {
    const headers = new Headers();
    const securityConfig = this.configService.getSecurityConfig();
    
    const origin = request.headers.get('Origin');
    
    // If allowed origins is configured and not wildcard
    if (
      securityConfig.allowedOrigins &&
      securityConfig.allowedOrigins.length > 0 &&
      !securityConfig.allowedOrigins.includes('*')
    ) {
      // Check if request origin is in allowed origins
      if (origin && securityConfig.allowedOrigins.includes(origin)) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Allow-Credentials', 'true');
      } else {
        // Reject requests from unauthorized origins
        console.warn(`CORS: Blocked request from unauthorized origin: ${origin}`);
        // Don't set any CORS headers for unauthorized origins
      }
    } else {
      // SECURITY: Never allow wildcard CORS in production
      // Only allow same-origin requests if no explicit allowlist is configured
      if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        // Allow localhost origins for development
        headers.set('Access-Control-Allow-Origin', origin);
      } else {
        console.warn(`CORS: No allowlist configured, blocking origin: ${origin}`);
        // Block all cross-origin requests when no allowlist is configured
      }
    }
    
    headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );
    
    return headers;
  }

  async handleRateLimit(request: Request): Promise<Response | null> {
    const securityConfig = this.configService.getSecurityConfig();
    
    // Skip rate limiting if disabled
    if (!securityConfig.rateLimit.enabled) {
      return null;
    }
    
    // For simplicity, we're not implementing actual rate limiting in this example
    // A real implementation would use Cloudflare Workers KV or another store to track requests
    
    return null;
  }

  async addResponseHeaders(response: Response): Promise<Response> {
    const headers = new Headers(response.headers);
    
    // Add comprehensive security headers
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval'", // unsafe-eval needed for crypto workers
      "style-src 'self' 'unsafe-inline'", // unsafe-inline needed for dynamic styles
      "connect-src 'self'",
      "img-src 'self' data: blob:", // data: for dynamically generated images, blob: for object URLs
      "font-src 'self'",
      "object-src 'none'",
      "media-src 'self'",
      "worker-src 'self' blob:", // blob: for Web Workers
      "child-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ');
    
    headers.set('Content-Security-Policy', cspDirectives);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-XSS-Protection', '1; mode=block');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    
    // Clone response with new headers
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
