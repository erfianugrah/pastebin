#!/usr/bin/env tsx
// ─── check-migrations-grants ──────────────────────────────────────────
// CI guardrail for the Supabase Data API grants change (Oct 30, 2026).
//
// On that date Supabase's default behaviour flips: new tables in `public`
// no longer auto-grant SELECT/INSERT/UPDATE/DELETE to anon/authenticated/
// service_role. Migrations that just `CREATE TABLE public.X` will succeed
// in Postgres but the Worker (using service_role) will fail with 42501
// on every query against X.
//
// Existing tables (`pastes`, `slugs`) keep their grants — see
// `20260407101812_remote_schema.sql` for the `ALTER DEFAULT PRIVILEGES`
// blocks. This script only constrains NEW migrations.
//
// Rule: any file containing `CREATE TABLE public.<name>` must also
// contain `GRANT … ON … public.<name> … TO service_role` in the same
// file. Anon/authenticated grants are NOT enforced here because the
// frontend doesn't query Supabase directly today.
//
// Run via `npm run check:migrations`. Returns exit code 1 on failure.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'supabase/migrations';

// Matches `CREATE TABLE [IF NOT EXISTS] public.foo` (case-insensitive),
// captures `foo`. Excludes `auth.`, `storage.`, etc.
const CREATE_TABLE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.("?)([a-z_][a-z0-9_]*)\1/gi;

function grantPresent(content: string, tableName: string): boolean {
	// GRANT ... ON [TABLE] public.<name> TO service_role
	// Allow optional schema-qualifier quoting and the optional TABLE keyword.
	const grantRe = new RegExp(
		`grant\\s+[a-z,\\s]+\\s+on\\s+(?:table\\s+)?(?:"?public"?\\.)?"?${tableName}"?[\\s\\S]*?to\\s+[^;]*service_role`,
		'i',
	);
	return grantRe.test(content);
}

interface Violation {
	file: string;
	table: string;
}

function scan(): Violation[] {
	const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
	const violations: Violation[] = [];

	for (const file of files) {
		const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

		// Strip line comments to avoid false matches on commented-out CREATE.
		const stripped = content.replace(/^--.*$/gm, '');

		let match: RegExpExecArray | null;
		CREATE_TABLE_RE.lastIndex = 0;
		while ((match = CREATE_TABLE_RE.exec(stripped)) !== null) {
			const table = match[2];
			if (!grantPresent(stripped, table)) {
				violations.push({ file, table });
			}
		}
	}
	return violations;
}

// ─── Legacy allow-list ────────────────────────────────────────────────
// Tables created before this rule was enforced get a free pass — their
// grants live in `20260407101812_remote_schema.sql` via
// `ALTER DEFAULT PRIVILEGES`. The Oct 30 cutover preserves their
// existing grants.
const LEGACY_ALLOW = new Set<string>([
	'pastes', // 20260407104738_creates_pastes_schema.sql
	'slugs', // 20260407104738_creates_pastes_schema.sql
]);

function main(): void {
	const violations = scan().filter((v) => !LEGACY_ALLOW.has(v.table));
	if (violations.length === 0) {
		console.log('✓ All new `public.*` tables have explicit service_role grants.');
		return;
	}

	console.error('✗ Migration grant check failed.');
	console.error('  Tables created without an explicit GRANT … TO service_role:');
	for (const v of violations) {
		console.error(`    - ${v.table} (in ${v.file})`);
	}
	console.error('');
	console.error('Add to the migration:');
	console.error('  GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO service_role;');
	console.error('');
	console.error('After Supabase\'s Oct 30, 2026 cutover, new tables without this grant');
	console.error('return 42501 (insufficient_privilege) on every supabase-js call.');
	process.exit(1);
}

main();
