// Wrap a live test script with a concurrent `wrangler tail` so Worker
// logs (errors, console.log, exception traces) stream in interleaved
// with the test output. Useful when production POSTs return 500 and
// the error body is just `{ "error": { "code": "internal_error" } }`.
//
// Usage:
//   tsx scripts/with-wrangler-tail.ts -- tsx scripts/smoke-test.ts
//   tsx scripts/with-wrangler-tail.ts --env staging -- tsx scripts/concurrent-burn-test.ts
//
// All args before `--` are forwarded to `wrangler tail`. All args after
// `--` form the test command. Wrangler tail output is prefixed `[tail]`
// (dim gray) so it's distinguishable from the test stream.
//
// Exit code = test command's exit code. Wrangler is killed in either
// direction (test exits → kill tail; SIGINT → kill both).

import { spawn, ChildProcess } from 'node:child_process';

const args = process.argv.slice(2);
const sep = args.indexOf('--');
if (sep === -1 || sep === args.length - 1) {
	console.error('Usage: tsx with-wrangler-tail.ts [wrangler-args...] -- <test-cmd> [test-args...]');
	process.exit(2);
}

const wranglerArgs = args.slice(0, sep);
const testArgs = args.slice(sep + 1);

// Default to production env if not specified
if (!wranglerArgs.includes('--env')) {
	wranglerArgs.push('--env', 'production');
}
if (!wranglerArgs.includes('--format')) {
	wranglerArgs.push('--format', 'pretty');
}

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function prefixLines(prefix: string, chunk: Buffer): string {
	const text = chunk.toString();
	return text
		.split('\n')
		.map((line, i, arr) => (i === arr.length - 1 && line === '' ? '' : `${prefix}${line}`))
		.join('\n');
}

console.log(`${DIM}[wrap] starting: wrangler tail ${wranglerArgs.join(' ')}${RESET}`);

const tail: ChildProcess = spawn('npx', ['wrangler', 'tail', ...wranglerArgs], {
	stdio: ['ignore', 'pipe', 'pipe'],
});

tail.stdout?.on('data', (chunk: Buffer) => {
	process.stdout.write(prefixLines(`${DIM}[tail] `, chunk) + RESET);
});
tail.stderr?.on('data', (chunk: Buffer) => {
	process.stderr.write(prefixLines(`${DIM}[tail] `, chunk) + RESET);
});

tail.on('exit', (code, signal) => {
	if (signal !== 'SIGTERM' && code !== 0 && code !== null) {
		console.error(`${DIM}[wrap] wrangler tail exited with code ${code}${RESET}`);
	}
});

// Wait a few seconds for the tail session to attach before launching
// the test. Wrangler typically prints "Connected to <worker>" within
// 1-2s; 3s is a safe buffer.
const WAIT_FOR_TAIL_MS = 3000;
console.log(`${DIM}[wrap] waiting ${WAIT_FOR_TAIL_MS}ms for tail to attach...${RESET}`);

setTimeout(() => {
	console.log(`${DIM}[wrap] launching: ${testArgs.join(' ')}${RESET}\n`);
	const test = spawn(testArgs[0], testArgs.slice(1), {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: process.env,
	});

	test.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk));
	test.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));

	test.on('exit', (code) => {
		console.log(`\n${DIM}[wrap] test exited with code ${code}, stopping tail...${RESET}`);
		tail.kill('SIGTERM');
		// Give wrangler a moment to flush, then exit.
		setTimeout(() => process.exit(code ?? 1), 300);
	});
}, WAIT_FOR_TAIL_MS);

// Forward SIGINT to both processes.
process.on('SIGINT', () => {
	console.log(`\n${DIM}[wrap] SIGINT received, killing children...${RESET}`);
	tail.kill('SIGTERM');
	process.exit(130);
});
