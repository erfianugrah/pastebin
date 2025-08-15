/**
 * Admin authentication utility
 * Uses environment variable for admin API key
 */

export interface AuthResult {
  success: boolean;
  error?: string;
}

/**
 * Validates admin authentication token
 */
export function validateAdminAuth(request: Request): AuthResult {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader) {
    return { success: false, error: 'Missing Authorization header' };
  }
  
  const token = authHeader.replace('Bearer ', '');
  
  if (!token) {
    return { success: false, error: 'Invalid Authorization header format' };
  }
  
  // Get admin API key from environment
  const adminApiKey = (globalThis as any).ADMIN_API_KEY;
  
  if (!adminApiKey) {
    console.error('ADMIN_API_KEY environment variable not set');
    return { success: false, error: 'Server configuration error' };
  }
  
  // Use timing-safe comparison to prevent timing attacks
  if (!timingSafeEquals(token, adminApiKey)) {
    return { success: false, error: 'Invalid API key' };
  }
  
  return { success: true };
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Creates a 401 Unauthorized response
 */
export function createUnauthorizedResponse(message: string = 'Unauthorized'): Response {
  return new Response(JSON.stringify({
    error: {
      code: 'unauthorized',
      message: message
    }
  }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="Admin API"'
    }
  });
}