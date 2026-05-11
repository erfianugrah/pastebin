// End-to-end verification of Phase 4.4 (Auth + RLS).
//
// Creates two Supabase Auth users via the admin API, then verifies:
//
//   1. Worker accepts JWT and persists user_id on the paste row
//   2. User A can SELECT their own private paste via direct DB query
//      using their JWT (RLS lets them through)
//   3. User A CANNOT SELECT User B's private paste (RLS blocks)
//   4. Both users CAN SELECT public pastes (mirrors anon policy)
//   5. User A can DELETE their own paste via direct DB query
//   6. User A CANNOT DELETE User B's paste
//   7. Anonymous paste creation (no JWT) still works
//
// Cleanup: deletes test users + their pastes.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const env: Record<string, string> = {};
try {
	for (const line of readFileSync(resolve(process.cwd(), '.env'), 'utf-8').split('\n')) {
		const t = line.trim();
		if (!t || t.startsWith('#')) continue;
		const i = t.indexOf('=');
		if (i === -1) continue;
		env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
	}
} catch {
	// fall through
}

const API = env.PASTE_API_URL ?? 'https://paste.erfi.dev';
const SUPABASE_URL = env.SUPABASE_URL!;
const SECRET = env.SUPABASE_SECRET_KEY!;
const PUB = env.SUPABASE_PUBLISHABLE_KEY!;

if (!SUPABASE_URL || !SECRET || !PUB) {
	console.error('Need SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY in .env');
	process.exit(2);
}

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let failures = 0;
function assert(ok: boolean, name: string, hint?: string) {
	console.log(`  ${ok ? PASS : FAIL} ${name}${!ok && hint ? `\n    \x1b[31m${hint}\x1b[0m` : ''}`);
	if (!ok) failures++;
}

const SERVER_OPTS = {
	auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
};

const admin: SupabaseClient = createClient(SUPABASE_URL, SECRET, SERVER_OPTS);

interface TestUser {
	id: string;
	email: string;
	password: string;
	jwt: string;
	client: SupabaseClient;
}

async function createUser(label: string): Promise<TestUser> {
	const email = `rls-test-${label}-${Date.now()}@pastebin.test`;
	const password = `pw-${crypto.randomUUID().slice(0, 16)}`;

	const { data: createData, error: createErr } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
	});
	if (createErr || !createData?.user) throw new Error(`createUser failed: ${createErr?.message}`);

	// Sign in to get a JWT (admin createUser doesn't return one)
	const browser = createClient(SUPABASE_URL, PUB, SERVER_OPTS);
	const { data: signInData, error: signInErr } = await browser.auth.signInWithPassword({ email, password });
	if (signInErr || !signInData?.session?.access_token) {
		throw new Error(`signIn failed: ${signInErr?.message}`);
	}

	return {
		id: createData.user.id,
		email,
		password,
		jwt: signInData.session.access_token,
		client: browser,
	};
}

async function deleteUser(userId: string) {
	await admin.auth.admin.deleteUser(userId).catch(() => {});
}

async function createPasteAs(user: TestUser | null, opts: {
	content: string;
	title: string;
	visibility: 'public' | 'private';
}): Promise<{ id: string; deleteToken: string }> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (user) headers.Authorization = `Bearer ${user.jwt}`;

	const res = await fetch(`${API}/pastes`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ ...opts, expiresIn: '1h' }),
	});
	if (!res.ok) throw new Error(`create ${res.status}: ${await res.text()}`);
	return (await res.json()) as { id: string; deleteToken: string };
}

async function dbGetPaste(id: string) {
	const { data } = await admin.from('pastes').select('id, user_id, visibility, title').eq('id', id).maybeSingle();
	return data;
}

async function main() {
	console.log('\nPhase 4.4 RLS end-to-end verification');
	console.log(`  API:      ${API}`);
	console.log(`  Supabase: ${SUPABASE_URL}\n`);

	const userA = await createUser('a');
	const userB = await createUser('b');
	console.log(`  Created user A: ${userA.email} (${userA.id})`);
	console.log(`  Created user B: ${userB.email} (${userB.id})\n`);

	const createdPasteIds: string[] = [];

	try {
		console.log('[1] Worker accepts JWT and persists user_id');
		const a1 = await createPasteAs(userA, {
			content: 'private from A',
			title: 'A-private',
			visibility: 'private',
		});
		createdPasteIds.push(a1.id);
		const row1 = await dbGetPaste(a1.id);
		assert(row1?.user_id === userA.id, 'A-private has user_id = userA.id');

		console.log('\n[2] Anonymous paste creation (no JWT) still works');
		const anon = await createPasteAs(null, {
			content: 'anon paste',
			title: 'anon',
			visibility: 'public',
		});
		createdPasteIds.push(anon.id);
		const rowAnon = await dbGetPaste(anon.id);
		assert(rowAnon?.user_id === null, 'anon paste has user_id = NULL');

		console.log('\n[3] User A CAN SELECT their own private paste (RLS allows)');
		const { data: selfRead } = await userA.client.from('pastes').select('id, title').eq('id', a1.id);
		assert(Array.isArray(selfRead) && selfRead.length === 1, 'user A sees own private paste');

		console.log('\n[4] User A CANNOT SELECT user B\'s private paste (RLS blocks)');
		const b1 = await createPasteAs(userB, {
			content: 'private from B',
			title: 'B-private',
			visibility: 'private',
		});
		createdPasteIds.push(b1.id);
		const { data: crossRead } = await userA.client.from('pastes').select('id').eq('id', b1.id);
		assert(
			Array.isArray(crossRead) && crossRead.length === 0,
			'user A blocked from B\'s private paste',
		);

		console.log('\n[5] Both users CAN SELECT a public paste from the other (mirrors anon)');
		const bPublic = await createPasteAs(userB, {
			content: 'public from B',
			title: 'B-public',
			visibility: 'public',
		});
		createdPasteIds.push(bPublic.id);
		const { data: aSeesBPublic } = await userA.client.from('pastes').select('id').eq('id', bPublic.id);
		assert(
			Array.isArray(aSeesBPublic) && aSeesBPublic.length === 1,
			'user A can read B\'s public paste',
		);

		console.log('\n[6] User A can list ONLY their own pastes via RLS (no Worker endpoint needed)');
		// This is the /my page pattern: query supabase directly with user JWT.
		const { data: aOwnList } = await userA.client
			.from('pastes')
			.select('id, user_id, visibility')
			.eq('user_id', userA.id)
			.order('created_at', { ascending: false });
		const allOwned = (aOwnList ?? []).every((p) => p.user_id === userA.id);
		assert(Array.isArray(aOwnList) && allOwned, 'user A\'s "my pastes" only contains own rows');
		assert(
			(aOwnList ?? []).some((p) => p.id === a1.id),
			'user A\'s "my pastes" contains the private one they created',
		);

		console.log('\n[7] User A can DELETE their own paste via direct DB (RLS allows)');
		const { error: selfDelErr } = await userA.client.from('pastes').delete().eq('id', a1.id);
		assert(!selfDelErr, 'user A delete on own paste succeeds');
		const stillThere = await dbGetPaste(a1.id);
		assert(stillThere === null, 'paste actually gone from DB');

		console.log('\n[8] User A CANNOT DELETE user B\'s paste (RLS blocks the row, count=0)');
		const { error: crossDelErr, count: crossDelCount } = await userA.client
			.from('pastes')
			.delete({ count: 'exact' })
			.eq('id', b1.id);
		// Supabase returns no error for RLS-blocked deletes -- they're just no-ops.
		assert(!crossDelErr, 'cross-user delete returns no error');
		assert(crossDelCount === 0, 'cross-user delete affected 0 rows (RLS blocked)');
		const stillThereB = await dbGetPaste(b1.id);
		assert(stillThereB !== null, 'B\'s paste still in DB');

		console.log('\n[9] INSERT with mismatched user_id is rejected by RLS WITH CHECK');
		// Try to insert as userA but claim user_id = userB. RLS WITH CHECK
		// should block this since auth.uid() != user_id in the new row.
		const { error: insErr } = await userA.client.from('pastes').insert({
			id: crypto.randomUUID(),
			content: 'attempt to impersonate B',
			title: 'impersonate',
			expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
			visibility: 'private',
			user_id: userB.id,  // <-- wrong
		});
		assert(
			insErr !== null && /policy|row-level/i.test(insErr.message),
			`impersonation INSERT rejected by RLS: ${insErr?.message ?? 'no error'}`,
		);
	} finally {
		// Cleanup
		console.log('\n  Cleaning up...');
		for (const id of createdPasteIds) {
			await admin.from('pastes').delete().eq('id', id).then(() => {});
		}
		await deleteUser(userA.id);
		await deleteUser(userB.id);
	}

	console.log(`\n${failures === 0 ? '\x1b[32mAll checks passed\x1b[0m' : `\x1b[31m${failures} failed\x1b[0m`}\n`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
