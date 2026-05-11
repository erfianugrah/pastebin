// Concurrent burn-after-reading test.
//
// Demonstrates the race condition fix from view_paste() RPC.
//
// Setup: create a single burn_after_reading paste. Hit GET /pastes/:id
// N times in parallel from the same client. With FOR UPDATE row locking,
// exactly one request should see the content; the rest should 404.
//
// Without the RPC (e.g. the old KV path), multiple requests could see the
// content before any of them deleted it.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
	// fall through to process.env
}

const API = env.PASTE_API_URL ?? process.env.PASTE_API_URL ?? 'https://paste.erfi.io';
const CONCURRENCY = Number(env.BURN_CONCURRENCY ?? process.env.BURN_CONCURRENCY ?? 20);
const RUNS = Number(env.BURN_RUNS ?? process.env.BURN_RUNS ?? 5);

interface ViewOutcome {
	status: number;
	body: string;
}

async function viewOnce(id: string): Promise<ViewOutcome> {
	const res = await fetch(`${API}/pastes/${id}`, {
		headers: { Accept: 'application/json' },
	});
	let body = '';
	try {
		body = await res.text();
	} catch {
		body = '';
	}
	return { status: res.status, body };
}

async function runOnce(runIdx: number): Promise<{ wins: number; misses: number; otherStatuses: Record<number, number> }> {
	// Create a fresh burn-after-reading paste
	const sentinel = `burn-sentinel-${runIdx}-${Date.now()}`;
	const createRes = await fetch(`${API}/pastes`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			content: sentinel,
			title: `burn-test-${runIdx}`,
			expiresIn: '1h',
			visibility: 'public',
			burnAfterReading: true,
		}),
	});
	if (!createRes.ok) throw new Error(`create failed: ${createRes.status} ${await createRes.text()}`);
	const { id } = (await createRes.json()) as { id: string };

	// Fire N concurrent views
	const results = await Promise.all(Array.from({ length: CONCURRENCY }, () => viewOnce(id)));

	let wins = 0;
	let misses = 0;
	const otherStatuses: Record<number, number> = {};

	for (const r of results) {
		if (r.status === 200 && r.body.includes(sentinel)) {
			wins++;
		} else if (r.status === 404) {
			misses++;
		} else {
			otherStatuses[r.status] = (otherStatuses[r.status] ?? 0) + 1;
		}
	}

	return { wins, misses, otherStatuses };
}

async function main() {
	console.log(`\nConcurrent burn-after-reading test`);
	console.log(`  API:         ${API}`);
	console.log(`  concurrency: ${CONCURRENCY} parallel views per paste`);
	console.log(`  runs:        ${RUNS} (each with a fresh paste)\n`);

	let totalWins = 0;
	let totalMisses = 0;
	let runs = 0;
	const allOther: Record<number, number> = {};

	for (let i = 0; i < RUNS; i++) {
		const { wins, misses, otherStatuses } = await runOnce(i);
		runs++;
		totalWins += wins;
		totalMisses += misses;
		for (const [s, n] of Object.entries(otherStatuses)) {
			allOther[Number(s)] = (allOther[Number(s)] ?? 0) + n;
		}
		const otherSummary = Object.keys(otherStatuses).length
			? ` other=${JSON.stringify(otherStatuses)}`
			: '';
		const verdict = wins === 1 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
		console.log(`  Run ${i + 1}/${RUNS}: ${verdict} wins=${wins} (expected 1)  misses=${misses}${otherSummary}`);
	}

	console.log(`\nTotals across ${runs} runs:`);
	console.log(`  Total wins (content served):    ${totalWins}`);
	console.log(`  Total misses (404):             ${totalMisses}`);
	if (Object.keys(allOther).length) {
		console.log(`  Other statuses:                 ${JSON.stringify(allOther)}`);
	}

	const expected = runs;
	const isClean = totalWins === expected && Object.keys(allOther).length === 0;
	console.log(`\n  Expected wins (race-free):      ${expected} (exactly one per run)`);
	console.log(`  Result: ${isClean ? '\x1b[32mRACE-FREE ✓\x1b[0m' : '\x1b[31mRACE DETECTED ✗\x1b[0m'}`);

	if (!isClean) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
