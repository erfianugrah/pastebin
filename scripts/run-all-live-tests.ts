// Run all live verification scripts in sequence with cooldowns.
//
// The Supabase Realtime and Auth API endpoints rate-limit fresh
// connections. Running the live tests back-to-back can produce
// spurious failures (CHANNEL_ERROR on the first subscription) even
// though each test passes in isolation. Cooldowns let the server-
// side state settle.
//
// Order rationale:
//   1. realtime   -- multiple WS subscriptions; runs first because the
//                    Realtime layer is sensitive to prior load (the race
//                    test fires 100 INSERT triggers which saturate the
//                    replication slot for a few seconds)
//   2. smoke      -- API + DB, no auth, no realtime
//   3. rls        -- creates real auth users via admin API
//   4. race       -- 100 concurrent API hits; cleanup deletes via cron
//                    (no immediate cleanup required from this script)

import { spawn } from 'node:child_process';

interface Suite {
	name: string;
	script: string;
	cooldownAfterSec: number;
}

const suites: Suite[] = [
	{ name: 'smoke', script: 'scripts/smoke-test.ts', cooldownAfterSec: 5 },
	{ name: 'rls', script: 'scripts/verify-rls.ts', cooldownAfterSec: 5 },
	{ name: 'race', script: 'scripts/concurrent-burn-test.ts', cooldownAfterSec: 0 },
];

function run(script: string): Promise<{ code: number; output: string }> {
	return new Promise((resolve) => {
		const child = spawn('npx', ['tsx', script], { stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout.on('data', (chunk) => {
			process.stdout.write(chunk);
			output += chunk.toString();
		});
		child.stderr.on('data', (chunk) => {
			process.stderr.write(chunk);
			output += chunk.toString();
		});
		child.on('close', (code) => resolve({ code: code ?? 1, output }));
	});
}

async function main() {
	console.log('\nRunning all live test suites in sequence with cooldowns...\n');

	const results: Array<{ name: string; ok: boolean }> = [];
	for (let i = 0; i < suites.length; i++) {
		const s = suites[i];
		console.log(`\n[${i + 1}/${suites.length}] ${s.name}\n${'-'.repeat(40)}`);
		const { code } = await run(s.script);
		const ok = code === 0;
		results.push({ name: s.name, ok });
		if (i < suites.length - 1 && s.cooldownAfterSec > 0) {
			console.log(`\n  Cooldown ${s.cooldownAfterSec}s...`);
			await new Promise((r) => setTimeout(r, s.cooldownAfterSec * 1000));
		}
	}

	console.log(`\n\n${'='.repeat(40)}\nSummary:`);
	let allOk = true;
	for (const r of results) {
		console.log(`  ${r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${r.name}`);
		if (!r.ok) allOk = false;
	}
	console.log('');
	process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
