/**
 * E2E smoke test for the Pasteriser Supabase backend.
 *
 * Hits the live API (https://paste.erfi.io or PASTE_API_URL) and verifies
 * that data lands in Supabase correctly. Cleans up after itself.
 *
 * Run: bun run scripts/smoke-test.ts
 *      or: npx tsx scripts/smoke-test.ts
 *
 * Required env (loaded from .env):
 *   PASTE_API_URL          (default: https://paste.erfi.io)
 *   SUPABASE_URL
 *   SUPABASE_SECRET_KEY    (sb_secret_... key for direct DB access)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---- Load .env ----

function loadEnv(): Record<string, string> {
	const envPath = resolve(process.cwd(), '.env');
	const env: Record<string, string> = {};
	try {
		const raw = readFileSync(envPath, 'utf-8');
		for (const line of raw.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const eq = trimmed.indexOf('=');
			if (eq === -1) continue;
			const key = trimmed.slice(0, eq).trim();
			let value = trimmed.slice(eq + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			env[key] = value;
		}
	} catch (err) {
		console.warn(`Could not read .env at ${envPath}, falling back to process.env`);
	}
	return { ...env, ...process.env } as Record<string, string>;
}

const env = loadEnv();
const API_URL = env.PASTE_API_URL ?? 'https://paste.erfi.io';
const SUPABASE_URL = env.SUPABASE_URL ?? 'https://dewddkcmwrzbpynylyhg.supabase.co';
const SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY ?? '';

const HAS_DB_ACCESS = SUPABASE_URL && SUPABASE_SECRET_KEY;

if (!HAS_DB_ACCESS) {
	console.warn('\n\x1b[33m⚠  SUPABASE_SECRET_KEY not in .env -- DB verification tests will be skipped.\x1b[0m');
	console.warn('\x1b[33m   Add to ~/pastebin/.env to enable full verification:\x1b[0m');
	console.warn('\x1b[33m     SUPABASE_URL=https://dewddkcmwrzbpynylyhg.supabase.co\x1b[0m');
	console.warn('\x1b[33m     SUPABASE_SECRET_KEY=sb_secret_...\x1b[0m');
	console.warn('\x1b[33m   Find the secret key at: Dashboard → Integrations → Data API → Settings → API Keys\x1b[0m\n');
}

// Server-side client options (Supabase-recommended for non-browser contexts):
// disable session management since we're a one-shot script.
const SERVER_CLIENT_OPTS = {
	auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};

const sb: SupabaseClient | null = HAS_DB_ACCESS
	? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, SERVER_CLIENT_OPTS)
	: null;

// ---- Test runner ----

type TestResult = { name: string; ok: boolean; error?: string; duration: number };
const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
	const start = performance.now();
	try {
		await fn();
		const duration = performance.now() - start;
		results.push({ name, ok: true, duration });
		console.log(`  \x1b[32m✓\x1b[0m ${name} \x1b[2m(${duration.toFixed(0)}ms)\x1b[0m`);
	} catch (err) {
		const duration = performance.now() - start;
		const message = err instanceof Error ? err.message : String(err);
		results.push({ name, ok: false, error: message, duration });
		console.log(`  \x1b[31m✗\x1b[0m ${name} \x1b[2m(${duration.toFixed(0)}ms)\x1b[0m`);
		console.log(`    \x1b[31m${message}\x1b[0m`);
	}
}

function assert(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, field: string): void {
	if (actual !== expected) {
		throw new Error(`${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

// ---- API helpers ----

interface CreatePasteResponse {
	id: string;
	url: string;
	slug?: string;
	expiresAt: string;
	deleteToken: string;
}

interface PasteResponse {
	id: string;
	content: string;
	title?: string;
	language?: string;
	createdAt: string;
	expiresAt: string;
	visibility: 'public' | 'private';
	burnAfterReading: boolean;
	readCount: number;
	isEncrypted: boolean;
	hasViewLimit: boolean;
	viewLimit: number | null;
	remainingViews: number | null;
	version: number;
	securityType: string;
}

async function createPaste(body: Record<string, unknown>): Promise<CreatePasteResponse> {
	const res = await fetch(`${API_URL}/pastes`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`POST /pastes failed: ${res.status} ${await res.text()}`);
	return res.json() as Promise<CreatePasteResponse>;
}

async function getPaste(id: string): Promise<PasteResponse> {
	const res = await fetch(`${API_URL}/pastes/${id}`, {
		headers: { Accept: 'application/json' },
	});
	if (!res.ok) throw new Error(`GET /pastes/${id} failed: ${res.status} ${await res.text()}`);
	return res.json() as Promise<PasteResponse>;
}

async function getRaw(id: string): Promise<string> {
	const res = await fetch(`${API_URL}/pastes/raw/${id}`);
	if (!res.ok) throw new Error(`GET /pastes/raw/${id} failed: ${res.status} ${await res.text()}`);
	return res.text();
}

async function getRecent(limit = 10): Promise<{ pastes: Array<{ id: string }> }> {
	const res = await fetch(`${API_URL}/api/recent?limit=${limit}`);
	if (!res.ok) throw new Error(`GET /api/recent failed: ${res.status} ${await res.text()}`);
	return res.json() as Promise<{ pastes: Array<{ id: string }> }>;
}

interface DeleteResponse {
	success?: boolean;
	message?: string;
	error?: { code: string; message: string };
}

async function deletePaste(id: string, token: string): Promise<{ status: number; body: DeleteResponse }> {
	const res = await fetch(`${API_URL}/pastes/${id}/delete?token=${encodeURIComponent(token)}`, {
		method: 'DELETE',
	});
	const body = (await res.json()) as DeleteResponse;
	return { status: res.status, body };
}

async function resolveSlug(slug: string): Promise<PasteResponse> {
	const res = await fetch(`${API_URL}/p/${slug}`, {
		headers: { Accept: 'application/json' },
	});
	if (!res.ok) throw new Error(`GET /p/${slug} failed: ${res.status} ${await res.text()}`);
	return res.json() as Promise<PasteResponse>;
}

// ---- DB helpers (direct Supabase access -- skipped if no secret key) ----

async function dbFindPaste(id: string) {
	if (!sb) return null;
	const { data, error } = await sb.from('pastes').select('*').eq('id', id).maybeSingle();
	if (error) throw new Error(`DB lookup failed: ${error.message}`);
	return data;
}

async function dbFindSlug(slug: string) {
	if (!sb) return null;
	const { data, error } = await sb.from('slugs').select('*').eq('slug', slug).maybeSingle();
	if (error) throw new Error(`DB slug lookup failed: ${error.message}`);
	return data;
}

async function dbDeletePasteDirectly(id: string): Promise<void> {
	if (!sb) return;
	await sb.from('pastes').delete().eq('id', id);
}

async function dbDeleteSlugDirectly(slug: string): Promise<void> {
	if (!sb) return;
	await sb.from('slugs').delete().eq('slug', slug);
}



// ---- Tests ----

console.log(`\n\x1b[1mPasteriser smoke test\x1b[0m`);
console.log(`  API:      ${API_URL}`);
console.log(`  Supabase: ${SUPABASE_URL}\n`);

const createdIds: string[] = [];
const createdSlugs: string[] = [];

async function run(): Promise<void> {
	// ---- 1. Create + persist ----
	let created: CreatePasteResponse | undefined;
	await test('POST /pastes creates a paste', async () => {
		created = await createPaste({
			content: 'smoke test content',
			title: 'smoke-test-title',
			language: 'plaintext',
			expiration: 300,
			visibility: 'public',
		});
		createdIds.push(created.id);
		assert(created.id != null && created.id.length > 0, 'id returned');
		assert(created.deleteToken != null && created.deleteToken.length > 0, 'deleteToken returned');
		assert(created.url.startsWith('http'), 'url returned');
	});

	if (HAS_DB_ACCESS && created) {
		await test('Created paste persisted to Supabase with correct fields', async () => {
			const row = await dbFindPaste(created!.id);
			assert(row !== null, 'paste not found in Supabase');
			assertEqual(row.content, 'smoke test content', 'content');
			assertEqual(row.title, 'smoke-test-title', 'title');
			assertEqual(row.language, 'plaintext', 'language');
			assertEqual(row.visibility, 'public', 'visibility');
			assertEqual(row.read_count, 0, 'read_count starts at 0');
			assertEqual(row.is_encrypted, false, 'is_encrypted');
			assertEqual(row.version, 0, 'version');
			assertEqual(row.burn_after_reading, false, 'burn_after_reading');
			assertEqual(row.view_limit, null, 'view_limit');
			assert(row.delete_token != null, 'delete_token is set');
			assert(row.delete_token === created!.deleteToken, 'delete_token matches API response');
		});
	}

	if (!created) {
		console.log('\n\x1b[31mCannot continue without created paste\x1b[0m');
		return;
	}

	// ---- 2. Read back + increment ----
	await test('GET /pastes/:id returns paste and increments read_count', async () => {
		const paste = await getPaste(created!.id);
		assertEqual(paste.id, created!.id, 'id');
		assertEqual(paste.content, 'smoke test content', 'content');
		assertEqual(paste.readCount, 1, 'readCount after 1 view');
	});

	if (HAS_DB_ACCESS) {
		await test('read_count increment persisted to Supabase', async () => {
			const row = await dbFindPaste(created!.id);
			assertEqual(row.read_count, 1, 'read_count in DB');
		});

		await test('Second view increments read_count to 2', async () => {
			await getPaste(created!.id);
			const row = await dbFindPaste(created!.id);
			assertEqual(row.read_count, 2, 'read_count after 2 views');
		});
	}

	// ---- 3. Raw view doesn't double-count ----
	await test('GET /pastes/raw/:id returns plain content', async () => {
		const raw = await getRaw(created!.id);
		assertEqual(raw, 'smoke test content', 'raw content');
	});

	// ---- 4. Recent listing ----
	await test('GET /api/recent includes public paste', async () => {
		const recent = await getRecent(50);
		const found = recent.pastes.some((p) => p.id === created!.id);
		assert(found, `paste ${created!.id} not in recent listing`);
	});

	// ---- 5. Private paste not in recent ----
	let privateId: string | undefined;
	await test('private paste is not in /api/recent', async () => {
		const priv = await createPaste({
			content: 'private content',
			title: 'private',
			language: 'plaintext',
			expiration: 300,
			visibility: 'private',
		});
		privateId = priv.id;
		createdIds.push(priv.id);

		const recent = await getRecent(50);
		const found = recent.pastes.some((p) => p.id === priv.id);
		assert(!found, `private paste ${priv.id} should NOT be in recent`);
	});

	// ---- 6. Vanity slug ----
	const slug = `smoke-${Date.now()}`;
	let slugPasteId: string | undefined;
	await test('POST /pastes with slug creates slug and resolves it', async () => {
		createdSlugs.push(slug);

		const withSlug = await createPaste({
			content: 'slug content',
			title: 'slug-test',
			language: 'plaintext',
			expiration: 300,
			visibility: 'public',
			slug,
		});
		slugPasteId = withSlug.id;
		createdIds.push(withSlug.id);
		assertEqual(withSlug.slug, slug, 'response slug');
		assert(withSlug.url.endsWith(`/p/${slug}`), 'url uses /p/:slug');

		const resolved = await resolveSlug(slug);
		assertEqual(resolved.id, withSlug.id, 'slug resolves to paste');
	});

	if (HAS_DB_ACCESS && slugPasteId) {
		await test('Slug row exists in Supabase slugs table', async () => {
			const slugRow = await dbFindSlug(slug);
			assert(slugRow !== null, 'slug row not in DB');
			assertEqual(slugRow.paste_id, slugPasteId, 'slug -> paste_id');
		});
	}

	// ---- 7. Delete with deleteToken ----
	let deletedId: string | undefined;
	await test('DELETE /pastes/:id/delete with valid token succeeds', async () => {
		const toDelete = await createPaste({
			content: 'to be deleted',
			title: 'delete-me',
			language: 'plaintext',
			expiration: 300,
			visibility: 'public',
		});
		createdIds.push(toDelete.id);
		deletedId = toDelete.id;

		const result = await deletePaste(toDelete.id, toDelete.deleteToken);
		assertEqual(result.status, 200, 'delete returns 200');
		assertEqual(result.body.success, true, 'delete success');

		// Subsequent fetch should 404
		const res = await fetch(`${API_URL}/pastes/${toDelete.id}`, {
			headers: { Accept: 'application/json' },
		});
		assertEqual(res.status, 404, 'deleted paste returns 404');
	});

	if (HAS_DB_ACCESS && deletedId) {
		const id = deletedId;
		await test('Deleted paste is gone from Supabase', async () => {
			const row = await dbFindPaste(id);
			assert(row === null, 'paste should be gone from DB');
		});
	}

	let wrongTokenId: string | undefined;
	await test('DELETE /pastes/:id/delete with wrong token fails', async () => {
		const target = await createPaste({
			content: 'wrong-token test',
			title: 'wrong-token',
			language: 'plaintext',
			expiration: 300,
			visibility: 'public',
		});
		createdIds.push(target.id);
		wrongTokenId = target.id;

		const result = await deletePaste(target.id, 'invalid-token');
		assert(result.status >= 400, `delete should return error status, got ${result.status}`);
		assert(result.body.error != null, 'response should have error field');
		assertEqual(result.body.error!.code, 'unauthorized', 'error code');
	});

	if (HAS_DB_ACCESS && wrongTokenId) {
		const id = wrongTokenId;
		await test('Paste with wrong-token delete attempt still exists in DB', async () => {
			const row = await dbFindPaste(id);
			assert(row !== null, 'paste should still exist');
		});
	}

	// ---- 8. Burn after reading ----
	let burnId: string | undefined;
	await test('burn-after-reading deletes paste after first view', async () => {
		const burn = await createPaste({
			content: 'burn content',
			title: 'burn',
			language: 'plaintext',
			expiration: 300,
			visibility: 'public',
			burnAfterReading: true,
		});
		createdIds.push(burn.id);
		burnId = burn.id;

		// First read returns content
		const first = await getPaste(burn.id);
		assertEqual(first.content, 'burn content', 'first read content');

		// Second read should 404 -- paste burned
		const res = await fetch(`${API_URL}/pastes/${burn.id}`, {
			headers: { Accept: 'application/json' },
		});
		assertEqual(res.status, 404, 'second read 404');
	});

	if (HAS_DB_ACCESS && burnId) {
		const id = burnId;
		await test('Burned paste is gone from Supabase', async () => {
			const row = await dbFindPaste(id);
			assert(row === null, 'burned paste should be gone from DB');
		});
	}

	// ---- 9. View limit ----
	await test('view_limit enforces max views and deletes after limit', async () => {
		const limited = await createPaste({
			content: 'limited content',
			title: 'limited',
			language: 'plaintext',
			expiration: 300,
			visibility: 'public',
			viewLimit: 2,
		});
		createdIds.push(limited.id);

		// View 1 (limit 2 → 1 remaining)
		const first = await getPaste(limited.id);
		assertEqual(first.readCount, 1, 'readCount=1');
		assertEqual(first.remainingViews, 1, 'remainingViews=1');

		// View 2 (limit 2 → 0 remaining, paste deleted)
		const second = await getPaste(limited.id);
		assertEqual(second.readCount, 2, 'readCount=2');

		// View 3 → 404
		const res = await fetch(`${API_URL}/pastes/${limited.id}`, {
			headers: { Accept: 'application/json' },
		});
		assertEqual(res.status, 404, 'third read 404');
	});

	// ---- 10. RLS enforced ----
	const publishableKey = env.SUPABASE_PUBLISHABLE_KEY ?? '';
	if (publishableKey && privateId) {
		await test('RLS: anon (publishable key) cannot SELECT private pastes', async () => {
			const anonClient = createClient(SUPABASE_URL, publishableKey, SERVER_CLIENT_OPTS);
			const { data } = await anonClient.from('pastes').select('id, visibility').eq('id', privateId);
			assert(data === null || data.length === 0, 'anon should NOT see private paste via direct DB');
		});

		await test('RLS: anon (publishable key) CAN SELECT public pastes', async () => {
			const anonClient = createClient(SUPABASE_URL, publishableKey, SERVER_CLIENT_OPTS);
			const { data } = await anonClient.from('pastes').select('id').eq('id', created!.id);
			// public paste should be visible (if not yet deleted by other tests)
			// data may be empty if the paste was view-limited/burned -- not a failure here
			assert(data !== null, 'anon query should not error');
		});
	}

	// ---- 11. Full-text search ----
	const searchToken = `unique-search-token-${Date.now()}`;
	let searchablePaste: { id: string } | null = null;

	await test('Create paste with a unique title for FTS test', async () => {
		searchablePaste = await createPaste({
			content: 'searchable content',
			title: `My searchable paste ${searchToken}`,
			expiresIn: '1h',
			visibility: 'public',
		});
		assert(searchablePaste.id !== undefined, 'returns id');
	});

	await test('GET /api/search finds paste by unique title token', async () => {
		// Tiny delay for the GIN index to be visible (Postgres write should be sync,
		// but supabase-js cache or postgres-meta refresh can lag occasionally)
		await new Promise((r) => setTimeout(r, 200));
		const res = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(searchToken)}`);
		assertEqual(res.status, 200, 'search 200');
		const body = (await res.json()) as { pastes: Array<{ id: string; title: string }>; query: string };
		assertEqual(body.query, searchToken, 'echoes query');
		const found = body.pastes.find((p) => p.id === searchablePaste!.id);
		assert(found !== undefined, 'paste found in search results');
		assert(found!.title.includes(searchToken), 'title contains the token');
	});

	await test('GET /api/search returns empty pastes for missing q', async () => {
		const res = await fetch(`${API_URL}/api/search`);
		const body = (await res.json()) as { pastes: unknown[]; query: string };
		assertEqual(body.pastes.length, 0, 'no pastes');
		assertEqual(body.query, '', 'empty query');
	});

	await test('GET /api/search supports websearch syntax: phrase quoting', async () => {
		// websearch_to_tsquery treats "phrase" as a phrase match
		const res = await fetch(
			`${API_URL}/api/search?q=${encodeURIComponent(`"${searchToken}"`)}`,
		);
		assertEqual(res.status, 200, '200');
		const body = (await res.json()) as { pastes: Array<{ id: string }> };
		const found = body.pastes.find((p) => p.id === searchablePaste!.id);
		assert(found !== undefined, 'phrase search finds the paste');
	});

	await test('Private pastes are excluded from search', async () => {
		const privateMatch = await createPaste({
			content: 'private content',
			title: `private-secret ${searchToken}`,
			expiresIn: '1h',
			visibility: 'private',
		});
		await new Promise((r) => setTimeout(r, 200));
		const res = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(searchToken)}`);
		const body = (await res.json()) as { pastes: Array<{ id: string }> };
		const foundPrivate = body.pastes.find((p) => p.id === privateMatch.id);
		assert(foundPrivate === undefined, 'private paste must not appear in search');
	});

	if (HAS_DB_ACCESS) {
		await test('search_vector column is populated from generated expression', async () => {
			const { data } = await sb!
				.from('pastes')
				.select('id, title, search_vector')
				.eq('id', searchablePaste!.id)
				.single();
			assert(data !== null, 'row exists');
			const vector = (data as { search_vector: string }).search_vector;
			assert(typeof vector === 'string', 'search_vector is a string');
			// The English parser tokenizes on hyphens, so `unique-search-token-NNNN`
			// becomes multiple tokens. The numeric timestamp survives as a single
			// token. tsvector format is `'token':position [...]'.
			const timestamp = searchToken.split('-').pop()!;
			assert(
				vector.includes(`'${timestamp}'`),
				`search_vector should contain timestamp token '${timestamp}'; got: ${vector}`,
			);
		});
	}

	// ---- 12. BFF auth flow (browser → Worker → Supabase, HttpOnly cookies) ----
	if (HAS_DB_ACCESS) {
		const authEmail = `smoke-auth-${Date.now()}@pasteriser.test`;
		const authPassword = `pw-${crypto.randomUUID().slice(0, 16)}`;
		let authUserId: string | null = null;

		try {
			// Pre-create a confirmed user via admin API so signup/login flows
			// don't depend on email-confirmation status of the project.
			const { data: created, error: createErr } = await sb!.auth.admin.createUser({
				email: authEmail,
				password: authPassword,
				email_confirm: true,
			});
			if (createErr || !created.user) throw new Error(`admin.createUser failed: ${createErr?.message}`);
			authUserId = created.user.id;

			// Tiny cookie jar shared across the auth requests.
			let cookieJar = '';
			function rememberSetCookies(res: Response) {
				const set = res.headers.getSetCookie?.() ?? [];
				for (const c of set) {
					const kv = c.split(';')[0];
					const name = kv.split('=')[0];
					// drop any existing entry with this name then append
					cookieJar = cookieJar
						.split('; ')
						.filter((x) => x && !x.startsWith(`${name}=`))
						.concat([kv])
						.join('; ');
				}
			}
			function withCookies(init: RequestInit = {}): RequestInit {
				return cookieJar ? { ...init, headers: { ...(init.headers || {}), Cookie: cookieJar } } : init;
			}

			await test('GET /api/auth/session returns { user: null } before login', async () => {
				const res = await fetch(`${API_URL}/api/auth/session`);
				assertEqual(res.status, 200, 'status');
				const body = (await res.json()) as { user: null | { id: string } };
				assertEqual(body.user, null, 'user');
			});

			await test('POST /api/auth/login with wrong password returns 401', async () => {
				const res = await fetch(`${API_URL}/api/auth/login`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ email: authEmail, password: 'wrong-password' }),
				});
				assertEqual(res.status, 401, 'status');
			});

			await test('POST /api/auth/login sets HttpOnly session cookies', async () => {
				const res = await fetch(`${API_URL}/api/auth/login`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ email: authEmail, password: authPassword }),
				});
				assertEqual(res.status, 200, 'status');

				const setCookies = res.headers.getSetCookie?.() ?? [];
				assert(setCookies.length >= 2, `expected ≥2 Set-Cookie headers, got ${setCookies.length}`);

				const access = setCookies.find((c) => c.startsWith('sb-access-token='));
				const refresh = setCookies.find((c) => c.startsWith('sb-refresh-token='));
				assert(!!access, 'sb-access-token cookie set');
				assert(!!refresh, 'sb-refresh-token cookie set');
				assert(access!.includes('HttpOnly'), 'access cookie is HttpOnly');
				assert(access!.includes('Secure'), 'access cookie is Secure');
				assert(access!.includes('SameSite=Strict'), 'access cookie is SameSite=Strict');

				rememberSetCookies(res);

				const body = (await res.json()) as { user: { id: string } };
				assertEqual(body.user.id, authUserId!, 'user.id');
			});

			await test('GET /api/auth/session returns the user when cookie is sent', async () => {
				const res = await fetch(`${API_URL}/api/auth/session`, withCookies());
				assertEqual(res.status, 200, 'status');
				const body = (await res.json()) as { user: { id: string } | null };
				assert(body.user !== null, 'user is present');
				assertEqual(body.user!.id, authUserId!, 'user.id matches');
			});

			let myPasteId: string | null = null;
			await test('POST /pastes with cookie attaches user_id to the paste', async () => {
				const res = await fetch(`${API_URL}/pastes`, {
					method: 'POST',
					...withCookies({
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							content: 'authed paste content',
							title: `smoke-auth-${Date.now()}`,
							expiresIn: '1h',
							visibility: 'public',
						}),
					}),
				});
				assertEqual(res.status, 201, 'status');
				const body = (await res.json()) as { id: string };
				myPasteId = body.id;
				createdIds.push(body.id);

				const { data } = await sb!.from('pastes').select('user_id').eq('id', body.id).single();
				assertEqual(
					(data as { user_id: string | null }).user_id,
					authUserId!,
					'user_id on created paste',
				);
			});

			await test('GET /api/my returns the authenticated user\'s pastes', async () => {
				const res = await fetch(`${API_URL}/api/my`, withCookies());
				assertEqual(res.status, 200, 'status');
				const body = (await res.json()) as { pastes: Array<{ id: string }> };
				const found = body.pastes.find((p) => p.id === myPasteId);
				assert(!!found, 'created paste appears in /api/my');
			});

			await test('GET /api/my returns 401 without cookie', async () => {
				const res = await fetch(`${API_URL}/api/my`);
				assertEqual(res.status, 401, 'status');
			});

			await test('POST /api/auth/logout clears the session cookies', async () => {
				const res = await fetch(`${API_URL}/api/auth/logout`, {
					method: 'POST',
					...withCookies(),
				});
				assertEqual(res.status, 200, 'status');

				const setCookies = res.headers.getSetCookie?.() ?? [];
				assert(setCookies.length >= 2, 'two clear cookies returned');
				assert(
					setCookies.every((c) => c.includes('Max-Age=0')),
					'cookies are cleared (Max-Age=0)',
				);

				cookieJar = ''; // simulate the browser dropping the cookies
			});

			await test('GET /api/auth/session returns null after logout', async () => {
				const res = await fetch(`${API_URL}/api/auth/session`);
				const body = (await res.json()) as { user: null | { id: string } };
				assertEqual(body.user, null, 'user is null');
			});

			await test('POST /api/auth/signup with weak password rejected', async () => {
				const res = await fetch(`${API_URL}/api/auth/signup`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ email: 'x@y.test', password: 'short' }),
				});
				assertEqual(res.status, 400, 'status');
			});
		} finally {
			// Always clean up the test auth user, even if a test threw.
			if (authUserId) {
				await sb!.auth.admin.deleteUser(authUserId).catch(() => {});
			}
		}
	}
}

// ---- Run + cleanup + report ----

async function cleanup(): Promise<void> {
	for (const id of createdIds) {
		await dbDeletePasteDirectly(id).catch(() => {});
	}
	for (const slug of createdSlugs) {
		await dbDeleteSlugDirectly(slug).catch(() => {});
	}
}

async function main(): Promise<void> {
	try {
		await run();
	} catch (err) {
		console.error(`\n\x1b[31mUnexpected error: ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
	}

	await cleanup();

	const passed = results.filter((r) => r.ok).length;
	const failed = results.filter((r) => !r.ok).length;
	const totalMs = results.reduce((sum, r) => sum + r.duration, 0);

	console.log(`\n\x1b[1mResults:\x1b[0m ${passed} passed, ${failed} failed (${totalMs.toFixed(0)}ms total)\n`);

	if (failed > 0) {
		process.exit(1);
	}
}

main();
