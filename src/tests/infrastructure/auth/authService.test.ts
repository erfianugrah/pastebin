import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../../../infrastructure/auth/authService';
import { Logger } from '../../../infrastructure/logging/logger';

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(),
}));

import { createClient } from '@supabase/supabase-js';

const mockLogger = {
	trace: vi.fn(),
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	fatal: vi.fn(),
	setContext: vi.fn(),
	clearContext: vi.fn(),
} as unknown as Logger;

function makeClient(getUserResult: { data: { user: { id: string } | null }; error: { message: string } | null }) {
	return {
		auth: {
			getUser: vi.fn(() => Promise.resolve(getUserResult)),
		},
	};
}

function makeRequest(headers: Record<string, string> = {}): Request {
	return new Request('https://example.com', { headers });
}

describe('AuthService', () => {
	let service: AuthService;

	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns null when no Authorization header is present', async () => {
		vi.mocked(createClient).mockReturnValue(makeClient({ data: { user: null }, error: null }) as any);
		service = new AuthService('https://x.supabase.co', 'sb_secret_test', mockLogger);

		const result = await service.getUserIdFromRequest(makeRequest());

		expect(result).toBeNull();
	});

	it('returns null when header is malformed (no Bearer prefix)', async () => {
		vi.mocked(createClient).mockReturnValue(makeClient({ data: { user: null }, error: null }) as any);
		service = new AuthService('https://x.supabase.co', 'sb_secret_test', mockLogger);

		const result = await service.getUserIdFromRequest(
			makeRequest({ Authorization: 'eyJabc.def.ghi' }),
		);

		expect(result).toBeNull();
	});

	it('passes the bearer token to supabase.auth.getUser', async () => {
		const client = makeClient({ data: { user: { id: 'user-123' } }, error: null });
		vi.mocked(createClient).mockReturnValue(client as any);
		service = new AuthService('https://x.supabase.co', 'sb_secret_test', mockLogger);

		const result = await service.getUserIdFromRequest(
			makeRequest({ Authorization: 'Bearer the.jwt.value' }),
		);

		expect(client.auth.getUser).toHaveBeenCalledWith('the.jwt.value');
		expect(result).toBe('user-123');
	});

	it('accepts case-insensitive "bearer" prefix', async () => {
		const client = makeClient({ data: { user: { id: 'user-456' } }, error: null });
		vi.mocked(createClient).mockReturnValue(client as any);
		service = new AuthService('https://x.supabase.co', 'sb_secret_test', mockLogger);

		const result = await service.getUserIdFromRequest(
			makeRequest({ authorization: 'bearer some.jwt' }),
		);

		expect(client.auth.getUser).toHaveBeenCalledWith('some.jwt');
		expect(result).toBe('user-456');
	});

	it('returns null when getUser reports an error', async () => {
		vi.mocked(createClient).mockReturnValue(
			makeClient({ data: { user: null }, error: { message: 'invalid JWT' } }) as any,
		);
		service = new AuthService('https://x.supabase.co', 'sb_secret_test', mockLogger);

		const result = await service.getUserIdFromRequest(
			makeRequest({ Authorization: 'Bearer expired.jwt.value' }),
		);

		expect(result).toBeNull();
	});

	it('returns null and logs when getUser throws', async () => {
		vi.mocked(createClient).mockReturnValue({
			auth: { getUser: vi.fn(() => Promise.reject(new Error('network down'))) },
		} as any);
		service = new AuthService('https://x.supabase.co', 'sb_secret_test', mockLogger);

		const result = await service.getUserIdFromRequest(
			makeRequest({ Authorization: 'Bearer some.jwt' }),
		);

		expect(result).toBeNull();
		expect(mockLogger.warn).toHaveBeenCalled();
	});

	it('passes server-side auth opts to createClient', () => {
		vi.mocked(createClient).mockReturnValue(makeClient({ data: { user: null }, error: null }) as any);
		service = new AuthService('https://x.supabase.co', 'sb_secret_test', mockLogger);

		expect(createClient).toHaveBeenCalledWith('https://x.supabase.co', 'sb_secret_test', {
			auth: {
				autoRefreshToken: false,
				persistSession: false,
				detectSessionInUrl: false,
			},
		});
	});
});
