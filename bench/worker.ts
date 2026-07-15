/// <reference types="@cloudflare/workers-types" />
//
// Full CF <-> Supabase integration harness (hyperdrive-bench branch only).
// Standalone module Worker, NOT wired into src/index.ts. Run with:
//   wrangler dev --remote --config bench/wrangler.jsonc --port 8799
// Endpoints: /reads /writes /auth /all
import { Client } from "pg";
import postgres from "postgres";
import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader } from "jose";

interface Env {
	HYPERDRIVE: Hyperdrive;
	SUPABASE_URL: string;
	SUPABASE_ANON_KEY: string;
	SUPABASE_SERVICE_KEY: string;
	PG_TXN: string;
	PG_SESSION: string;
	TEST_JWT: string;
}

const COLS = "id,body";
const READ_SQL = `select ${COLS} from hd_bench order by id limit $1`;
const READ_SQL_NOCACHE = `select ${COLS} from hd_bench where now() is not null order by id limit $1`;

function stats(xs: number[]) {
	if (!xs.length) return { n: 0 };
	const s = [...xs].sort((a, b) => a - b);
	const at = (p: number) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
	return {
		n: s.length,
		min: +s[0].toFixed(1),
		median: +at(50).toFixed(1),
		p95: +at(95).toFixed(1),
		mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1),
	};
}

async function timeIt(n: number, fn: () => Promise<number>) {
	const times: number[] = [];
	let first = 0;
	for (let i = 0; i < n; i++) {
		const dt = await fn();
		if (i === 0) first = +dt.toFixed(1);
		else times.push(dt);
	}
	return { firstCallMs: first, warm: stats(times) };
}

// --- one pg query, fresh client each call ---
async function pgOnce(connectionString: string, sql: string, params: any[], ssl = false) {
	const client = new Client(ssl ? { connectionString, ssl: { rejectUnauthorized: false } } : { connectionString });
	const t = performance.now();
	await client.connect();
	const r = await client.query(sql, params);
	const dt = performance.now() - t;
	client.end().catch(() => {});
	return { dt, rows: r.rows.length };
}

async function restRead(env: Env) {
	const url = `${env.SUPABASE_URL}/rest/v1/hd_bench?select=${COLS}&order=id&limit=25`;
	const t = performance.now();
	const res = await fetch(url, { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` } });
	await res.json();
	return performance.now() - t;
}

// Cache API in front of REST: synthetic cache key, 60s TTL.
async function cacheApiRead(env: Env) {
	const cache = (caches as any).default as Cache;
	const key = new Request("https://bench.local/hd_bench_25");
	const t = performance.now();
	let res = await cache.match(key);
	if (!res) {
		const upstream = await fetch(`${env.SUPABASE_URL}/rest/v1/hd_bench?select=${COLS}&order=id&limit=25`, {
			headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
		});
		res = new Response(await upstream.text(), { headers: { "content-type": "application/json", "cache-control": "max-age=60" } });
		await cache.put(key, res.clone());
	}
	await res.text();
	return performance.now() - t;
}

async function reads(env: Env, n: number) {
	const out: Record<string, unknown> = {};
	out.restHttps = await timeIt(n, restRead.bind(null, env));
	out.cacheApi = await timeIt(n, cacheApiRead.bind(null, env));
	out.hyperdriveCached = await timeIt(n, async () => (await pgOnce(env.HYPERDRIVE.connectionString, READ_SQL, [25])).dt);
	out.hyperdriveUncached = await timeIt(n, async () => (await pgOnce(env.HYPERDRIVE.connectionString, READ_SQL_NOCACHE, [25])).dt);
	// raw driver straight to Supavisor (no Hyperdrive)
	// Raw drivers straight to Supavisor from the Worker runtime - single probe
	// each, 6s timeout so a hang fails fast instead of blowing the request.
	const withTimeout = <T>(p: Promise<T>, ms: number) =>
		Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms (connection hung)`)), ms))]);
	try {
		const r = await withTimeout(pgOnce(env.PG_TXN, READ_SQL, [25], true), 6000);
		out.supavisorTxn_nodePg = { ok: true, ms: +r.dt.toFixed(1) };
	} catch (e: any) {
		out.supavisorTxn_nodePg = { ok: false, error: String(e?.message ?? e) };
	}
	try {
		const r = await withTimeout(
			(async () => {
				const sql = postgres(env.PG_TXN, { ssl: "require", prepare: false, fetch_types: false, max: 1, idle_timeout: 2, connect_timeout: 5 });
				const t = performance.now();
				await sql`select id, body from hd_bench order by id limit 25`;
				const dt = performance.now() - t;
				sql.end({ timeout: 1 }).catch(() => {});
				return dt;
			})(),
			6000,
		);
		out.supavisorTxn_postgresJs = { ok: true, ms: +r.toFixed(1) };
	} catch (e: any) {
		out.supavisorTxn_postgresJs = { ok: false, error: String(e?.message ?? e) };
	}
	return out;
}

async function writes(env: Env, n: number) {
	const out: Record<string, unknown> = {};
	out.restInsert = await timeIt(n, async () => {
		const t = performance.now();
		const res = await fetch(`${env.SUPABASE_URL}/rest/v1/bench_kv`, {
			method: "POST",
			headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "application/json", prefer: "return=minimal" },
			body: JSON.stringify({ v: "rest" }),
		});
		await res.text();
		return performance.now() - t;
	});
	out.hyperdriveInsert = await timeIt(n, async () => (await pgOnce(env.HYPERDRIVE.connectionString, "insert into bench_kv (v) values ($1)", ["hd"])).dt);
	try {
		out.supavisorTxnInsert = await timeIt(n, async () => (await pgOnce(env.PG_TXN, "insert into bench_kv (v) values ($1)", ["txn"], true)).dt);
	} catch (e: any) {
		out.supavisorTxnInsert = { error: String(e?.message ?? e) };
	}
	return out;
}

async function auth(env: Env, n: number) {
	const jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
	const out: Record<string, unknown> = {};
	// A. verify JWT locally at the edge (JWKS cached after first fetch)
	let claims: any = null;
	out.localVerify = await timeIt(n, async () => {
		const t = performance.now();
		const { payload } = await jwtVerify(env.TEST_JWT, jwks, { audience: "authenticated" });
		claims = { sub: payload.sub, role: (payload as any).role, exp: payload.exp };
		return performance.now() - t;
	});
	out.verifiedClaims = claims;
	out.header = decodeProtectedHeader(env.TEST_JWT);
	// B. getUser round-trip to Supabase (revocation-aware)
	out.getUserRoundtrip = await timeIt(n, async () => {
		const t = performance.now();
		const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.TEST_JWT}` } });
		await res.json();
		return performance.now() - t;
	});
	// C. tampered token must be rejected
	try {
		await jwtVerify(env.TEST_JWT.slice(0, -3) + "AAA", jwks, { audience: "authenticated" });
		out.tamperedRejected = false;
	} catch {
		out.tamperedRejected = true;
	}
	return out;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const u = new URL(request.url);
		const n = Math.min(100, Math.max(2, Number(u.searchParams.get("n") ?? 30)));
		try {
			switch (u.pathname) {
				case "/reads":
					return Response.json({ region: "eu-central-1", n, reads: await reads(env, n) });
				case "/writes":
					return Response.json({ n, writes: await writes(env, n) });
				case "/auth":
					return Response.json({ n, auth: await auth(env, n) });
				case "/all":
					return Response.json({ region: "eu-central-1", n, reads: await reads(env, n), writes: await writes(env, Math.min(n, 20)), auth: await auth(env, n) });
				default:
					return new Response("GET /reads | /writes | /auth | /all  (?n=30)", { status: 404 });
			}
		} catch (e: any) {
			return Response.json({ error: String(e?.message ?? e), stack: e?.stack }, { status: 500 });
		}
	},
};
