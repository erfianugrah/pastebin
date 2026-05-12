import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from '../logging/logger';
import { ACCESS_TOKEN_COOKIE, getCookie } from '../../interfaces/api/cookies';
import { getServiceRoleClient } from '../supabase/getSupabaseClient';

/**
 * Worker-side Supabase Auth verification.
 *
 * Validates a JWT (bearer token from Supabase Auth) and returns the user ID.
 * Uses `supabase.auth.getUser(jwt)` which calls the Supabase Auth API to
 * verify the token signature, expiry, and revocation status.
 *
 * Cost: one network round-trip per authenticated request. Acceptable for
 * a pastebin where API throughput is low. For high-throughput services
 * consider `getClaims()` (local JWKS-based verification) or caching.
 *
 * Returns null if:
 *   - the header is missing or malformed
 *   - the token is invalid, expired, or revoked
 *   - the user has been deleted
 *
 * Returns the user id (string) when the token is valid.
 */
export class AuthService {
	private readonly client: SupabaseClient;

	constructor(url: string, secretKey: string, private readonly logger: Logger) {
		this.client = getServiceRoleClient(url, secretKey);
	}

	/**
	 * Extract and validate a JWT from a request. Looks at two places, in order:
	 *
	 *  1. `sb-access-token` HttpOnly cookie (set by /api/auth/login on the
	 *     Worker BFF path)
	 *  2. `Authorization: Bearer <jwt>` header (for non-browser API clients
	 *     or programmatic callers)
	 *
	 * Returns the authenticated user_id or null if no/invalid token was found.
	 */
	async getUserIdFromRequest(request: Request): Promise<string | null> {
		const jwt = getCookie(request, ACCESS_TOKEN_COOKIE) ?? this.extractBearer(request);
		if (!jwt) return null;

		try {
			const { data, error } = await this.client.auth.getUser(jwt);
			if (error || !data?.user) {
				this.logger.debug('Auth: JWT validation failed', { error: error?.message });
				return null;
			}
			return data.user.id;
		} catch (err) {
			this.logger.warn('Auth: getUser threw', { error: err });
			return null;
		}
	}

	private extractBearer(request: Request): string | null {
		const header = request.headers.get('Authorization') ?? request.headers.get('authorization');
		if (!header) return null;
		const match = /^Bearer\s+(.+)$/i.exec(header.trim());
		return match ? match[1].trim() : null;
	}
}
