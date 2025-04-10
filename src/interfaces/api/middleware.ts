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
      }
    } else {
      // Otherwise allow any origin
      headers.set('Access-Control-Allow-Origin', '*');
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
    
    // Add security headers
    headers.set('Content-Security-Policy', "default-src 'self'");
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-XSS-Protection', '1; mode=block');
    
    // Clone response with new headers
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
