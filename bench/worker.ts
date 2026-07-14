/// <reference types="@cloudflare/workers-types" />
//
// Isolated A/B benchmark: Supabase read latency from a CF Worker via
//   A) PostgREST over HTTPS  (the path Pasteriser uses today)
//   B) Cloudflare Hyperdrive -> Postgres direct connection (pg driver)
//
// Runs ONLY on the hyperdrive-bench branch, via `wrangler dev --remote`.
// Not wired into src/index.ts. Throwaway.
import { Client } from "pg";

interface Env {
	HYPERDRIVE: Hyperdrive;
	SUPABASE_URL: string;
	SUPABASE_ANON_KEY: string;
}

// Deterministic read against a throwaway 25-row / ~50KB table. Deterministic
// (no now()/volatile fn) so Hyperdrive will CACHE it - lets us measure
// cache-miss vs cache-hit. Mirrors a "list recent rows" read shape.
const COLS = "id,body";
const SQL = `select ${COLS} from hd_bench order by id limit $1`;

function stats(xs: number[]) {
	const s = [...xs].sort((a, b) => a - b);
	const at = (p: number) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
	const sum = s.reduce((a, b) => a + b, 0);
	return {
		n: s.length,
		min: +s[0].toFixed(1),
		median: +at(50).toFixed(1),
		p95: +at(95).toFixed(1),
		max: +s[s.length - 1].toFixed(1),
		mean: +(sum / s.length).toFixed(1),
	};
}

async function timeRest(env: Env, n: number, limit: number) {
	const url = `${env.SUPABASE_URL}/rest/v1/hd_bench?select=${COLS}&order=id&limit=${limit}`;
	const times: number[] = [];
	let rows = 0;
	for (let i = 0; i < n; i++) {
		const t = performance.now();
		const res = await fetch(url, {
			headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
		});
		const body = (await res.json()) as unknown[];
		times.push(performance.now() - t);
		rows = body.length;
	}
	return { ...stats(times), rows };
}

// Hyperdrive: connect a fresh client per request (the documented pattern -
// Hyperdrive keeps the real pool warm, so connect() is cheap), then run the
// same SELECT. Hyperdrive caches read queries by default, so we report the
// first (cache-miss) call separately from the warm (cache-hit) run.
async function timeHyperdrive(env: Env, n: number, limit: number, nocache: boolean) {
	const times: number[] = [];
	let firstCall = 0;
	let rows = 0;
	for (let i = 0; i < n; i++) {
		const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
		// A volatile function (now()) makes the query non-cacheable in Hyperdrive,
		// so this measures the pooled-but-UNCACHED path (every call hits Postgres).
		const sql = nocache
			? `select ${COLS} from hd_bench where now() is not null order by id limit $1`
			: SQL;
		const t = performance.now();
		await client.connect();
		const r = await client.query(sql, [limit]);
		const dt = performance.now() - t;
		if (i === 0) firstCall = dt;
		else times.push(dt);
		rows = r.rows.length;
		env_ctx_waitClose(client);
	}
	return { firstCallMs: +firstCall.toFixed(1), warm: stats(times), rows };
}

// close without blocking the response
function env_ctx_waitClose(client: Client) {
	client.end().catch(() => {});
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const u = new URL(request.url);
		if (u.pathname !== "/bench") {
			return new Response("GET /bench?n=30&limit=10", { status: 404 });
		}
		const n = Math.min(200, Math.max(2, Number(u.searchParams.get("n") ?? 30)));
		const limit = Math.min(25, Math.max(1, Number(u.searchParams.get("limit") ?? 25)));

		// Warm both paths once (DNS/TLS/pool warmup) before measuring.
		try {
			const rest = await timeRest(env, n, limit);
			const hdCached = await timeHyperdrive(env, n, limit, false);
			const hdUncached = await timeHyperdrive(env, n, limit, true);
			return Response.json({
				query: "25 rows / ~50KB",
				n,
				limit,
				restHttps: rest,
				hyperdriveCached: hdCached,
				hyperdriveUncached: hdUncached,
				note: "times in ms, measured from the Worker on CF edge (wrangler dev --remote). Hyperdrive.warm excludes the first cache-miss call.",
			});
		} catch (e: any) {
			return Response.json({ error: String(e?.message ?? e), stack: e?.stack }, { status: 500 });
		}
	},
};
