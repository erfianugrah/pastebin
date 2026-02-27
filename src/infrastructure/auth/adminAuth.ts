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
export async function validateAdminAuth(request: Request, env?: { ADMIN_API_KEY?: string }): Promise<AuthResult> {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader) {
    return { success: false, error: 'Missing Authorization header' };
  }
  
  const token = authHeader.replace('Bearer ', '');
  
  if (!token) {
    return { success: false, error: 'Invalid Authorization header format' };
  }
  
  // Get admin API key from environment (prefer explicit env, fall back to global)
  const adminApiKey = env?.ADMIN_API_KEY || (globalThis as any).ADMIN_API_KEY;
  
  if (!adminApiKey) {
    console.error('ADMIN_API_KEY environment variable not set');
    return { success: false, error: 'Server configuration error' };
  }
  
  // Use timing-safe comparison to prevent timing attacks
  if (!(await timingSafeEquals(token, adminApiKey))) {
    return { success: false, error: 'Invalid API key' };
  }
  
  return { success: true };
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 * Hashes both inputs with SHA-256 first so that length differences
 * do not leak through an early return.
 */
async function timingSafeEquals(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const viewA = new Uint8Array(hashA);
  const viewB = new Uint8Array(hashB);

  // Constant-time comparison of the fixed-length hashes
  let result = 0;
  for (let i = 0; i < viewA.length; i++) {
    result |= viewA[i] ^ viewB[i];
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
