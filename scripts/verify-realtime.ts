// Realtime broadcast pipeline verification + limitations matrix.
//
// Runs three groups of checks:
//
//   1. End-to-end pipeline:
//      - Subscribe as anon to topic 'recent:public' (private channel)
//      - Create a public paste → expect a paste_created broadcast
//      - Create a private paste → expect NO broadcast (trigger filter)
//      - Verify payload contains only safe metadata fields
//
//   2. Compatibility matrix:
//      - All combinations of (key type) x (channel type) x (setAuth?)
//      - Documents which combinations subscribe successfully
//
//   3. Negative tests:
//      - Subscribing to a topic without a matching RLS policy fails
//      - Trigger does NOT fire on upsert-induced UPDATE (read count
//        increments shouldn't broadcast)
//
// Run: npm run test:realtime

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

const API = env.PASTE_API_URL ?? process.env.PASTE_API_URL ?? 'https://paste.erfi.dev';
const SUPABASE_URL = env.SUPABASE_URL ?? process.env.SUPABASE_URL!;
const PUB = env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY!;
const SECRET = env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SECRET_KEY!;

if (!SUPABASE_URL || !PUB) {
	console.error('Need SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env');
	process.exit(2);
}

interface PasteCreatedPayload {
	id: string;
	title: string;
	language: string | null;
	createdAt: string;
	expiresAt: string;
	readCount: number;
	isEncrypted: boolean;
	version: number;
}

const SAFE_PAYLOAD_KEYS = new Set([
	'id',
	'title',
	'language',
	'createdAt',
	'expiresAt',
	'readCount',
	'isEncrypted',
	'version',
]);

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let failures = 0;

function assert(ok: boolean, name: string, hint?: string) {
	console.log(`  ${ok ? PASS : FAIL} ${name}${!ok && hint ? `\n    \x1b[31m${hint}\x1b[0m` : ''}`);
	if (!ok) failures++;
}

async function createPaste(opts: {
	content: string;
	title: string;
	visibility: 'public' | 'private';
}): Promise<{ id: string; deleteToken: string }> {
	const res = await fetch(`${API}/pastes`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...opts, expiresIn: '1h' }),
	});
	if (!res.ok) throw new Error(`create ${res.status}: ${await res.text()}`);
	return (await res.json()) as { id: string; deleteToken: string };
}

async function deletePaste(id: string, token: string): Promise<void> {
	await fetch(`${API}/pastes/${id}/delete`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ deleteToken: token }),
	}).catch(() => {});
}

async function subscribeStatus(opts: {
	key: string;
	private: boolean;
	topic: string;
	setAuth?: string;
	timeoutMs?: number;
}): Promise<string> {
	const supabase: SupabaseClient = createClient(SUPABASE_URL, opts.key, {
		auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
	});

	if (opts.setAuth) {
		try {
			await supabase.realtime.setAuth(opts.setAuth);
		} catch (e) {
			return `setAuth threw: ${(e as Error).message}`;
		}
	}

	const channel = supabase.channel(opts.topic, { config: { private: opts.private } });

	const status = await Promise.race([
		new Promise<string>((res) => {
			channel.subscribe((s, err) => {
				if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
					res(`${s}${err ? ' / ' + err.message : ''}`);
				}
			});
		}),
		new Promise<string>((r) => setTimeout(() => r(`TIMEOUT(${opts.timeoutMs ?? 5000}ms)`), opts.timeoutMs ?? 5000)),
	]);

	await supabase.removeAllChannels().catch(() => {});
	return status;
}

// ---------- Group 1: end-to-end pipeline ----------

async function endToEnd() {
	console.log('\n[1/3] End-to-end pipeline');

	const supabase = createClient(SUPABASE_URL, PUB, {
		auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
	});
	await supabase.realtime.setAuth(PUB);

	const received: PasteCreatedPayload[] = [];
	const channel = supabase.channel('recent:public', { config: { private: true } });

	channel.on('broadcast', { event: 'paste_created' }, (msg) => {
		const p = ((msg.payload as { payload?: PasteCreatedPayload })?.payload
			?? (msg.payload as PasteCreatedPayload));
		received.push(p);
	});

	const subscribed = await new Promise<boolean>((res) => {
		channel.subscribe((s) => {
			if (s === 'SUBSCRIBED') res(true);
			if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') res(false);
		});
	});
	assert(subscribed, 'subscribe to recent:public as anon');
	if (!subscribed) {
		await supabase.removeAllChannels();
		return;
	}

	const pubMarker = `rt-pub-${Date.now()}`;
	const privMarker = `rt-priv-${Date.now()}`;
	const pub = await createPaste({ content: 'x', title: pubMarker, visibility: 'public' });
	const priv = await createPaste({ content: 'x', title: privMarker, visibility: 'private' });

	await new Promise((r) => setTimeout(r, 2500));

	const pubMatch = received.find((p) => p.title === pubMarker);
	const privMatch = received.find((p) => p.title === privMarker);

	assert(!!pubMatch, 'public paste insert broadcasts to recent:public');
	assert(!privMatch, 'private paste insert does NOT broadcast (trigger filter)');

	if (pubMatch) {
		const leakedKeys = Object.keys(pubMatch).filter((k) => !SAFE_PAYLOAD_KEYS.has(k));
		assert(leakedKeys.length === 0, 'payload contains only safe fields', leakedKeys.join(','));
		assert(typeof pubMatch.isEncrypted === 'boolean', 'isEncrypted is broadcast as boolean');
		assert(typeof pubMatch.version === 'number', 'version is broadcast as number');
	}

	// Side-effect test: viewing the public paste increments read_count
	// via upsert. Should NOT fire the broadcast trigger (AFTER INSERT only,
	// not AFTER UPDATE).
	const beforeCount = received.length;
	await fetch(`${API}/pastes/${pub.id}`, { headers: { Accept: 'application/json' } });
	await fetch(`${API}/pastes/${pub.id}`, { headers: { Accept: 'application/json' } });
	await new Promise((r) => setTimeout(r, 1500));
	assert(
		received.length === beforeCount,
		'read-count upsert (UPDATE) does NOT fire INSERT trigger',
		`received ${received.length - beforeCount} extra broadcasts after reads`,
	);

	await supabase.removeAllChannels();
	await deletePaste(pub.id, pub.deleteToken);
	await deletePaste(priv.id, priv.deleteToken);
}

// ---------- Group 2: compatibility matrix ----------

async function compatMatrix() {
	console.log('\n[2/3] Compatibility matrix (which key+channel combos subscribe)');

	const cases: Array<{
		name: string;
		opts: { key: string; private: boolean; topic: string; setAuth?: string };
		shouldSucceed: boolean;
	}> = [
		{
			name: 'sb_publishable_ + public channel',
			opts: { key: PUB, private: false, topic: 'compat:public:1' },
			shouldSucceed: true,
		},
		{
			name: 'sb_publishable_ + private channel + setAuth(publishable)',
			opts: { key: PUB, private: true, topic: 'recent:public', setAuth: PUB },
			shouldSucceed: true,
		},
		{
			name: 'sb_publishable_ + private channel + NO setAuth',
			opts: { key: PUB, private: true, topic: 'recent:public' },
			shouldSucceed: true,
		},
		{
			name: 'sb_secret_ + private channel + setAuth(secret)',
			opts: { key: SECRET, private: true, topic: 'recent:public', setAuth: SECRET },
			shouldSucceed: true,
		},
	];

	for (const c of cases) {
		const status = await subscribeStatus(c.opts);
		const ok = status.startsWith('SUBSCRIBED') === c.shouldSucceed;
		assert(
			ok,
			`${c.name} → ${c.shouldSucceed ? 'SUBSCRIBED' : 'fail'}`,
			status,
		);
	}
}

// ---------- Group 3: negative tests ----------

async function negative() {
	console.log('\n[3/3] Negative tests (RLS enforcement)');

	// Subscribing to a topic that NO policy allows must fail.
	const disallowedStatus = await subscribeStatus({
		key: PUB,
		private: true,
		topic: 'forbidden:topic:xyz',
		setAuth: PUB,
	});
	assert(
		!disallowedStatus.startsWith('SUBSCRIBED'),
		'private channel on disallowed topic fails (RLS works)',
		disallowedStatus,
	);

	// The error message should mention authorization
	const isAuthError =
		disallowedStatus.includes('Unauthorized') || disallowedStatus.includes('CHANNEL_ERROR');
	assert(isAuthError, 'RLS denial returns Unauthorized / CHANNEL_ERROR');
}

async function main() {
	console.log('\nRealtime broadcast pipeline + limitations matrix');
	console.log(`  API:      ${API}`);
	console.log(`  Supabase: ${SUPABASE_URL}`);

	await endToEnd();
	await compatMatrix();
	await negative();

	console.log(`\n${failures === 0 ? '\x1b[32mAll checks passed\x1b[0m' : `\x1b[31m${failures} failed\x1b[0m`}\n`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
