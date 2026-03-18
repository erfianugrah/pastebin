/**
 * Heuristic language detection for paste content.
 * Returns a Prism language ID or null if uncertain.
 */

interface Rule {
	lang: string;
	/** At least one pattern must match */
	patterns: RegExp[];
	/** All anti-patterns must NOT match (optional) */
	antiPatterns?: RegExp[];
	/** Higher = checked first (default 0) */
	priority?: number;
}

const RULES: Rule[] = [
	// ── High confidence (structural) ────────────────────────────────
	{
		lang: 'markup',
		patterns: [/<!DOCTYPE\s+html/i, /<html[\s>]/i, /<head[\s>]/i, /<\/html>/i],
		priority: 10,
	},
	{
		lang: 'json',
		patterns: [/^\s*[\[{]/],
		antiPatterns: [/^\s*\/\//, /^\s*\/\*/], // not JS comments
		priority: 9,
	},
	{
		lang: 'yaml',
		patterns: [/^---\s*$/m],
		antiPatterns: [/^\s*</, /^\s*{/],
		priority: 8,
	},
	{
		lang: 'docker',
		patterns: [/^FROM\s+\S+/m],
		priority: 8,
	},
	{
		lang: 'nginx',
		patterns: [/^\s*(server|location|upstream)\s*\{/m, /^\s*server_name\s/m],
		priority: 7,
	},
	{
		lang: 'hcl',
		patterns: [/^\s*(resource|variable|output|provider|terraform|data)\s+"/m],
		priority: 7,
	},

	// ── Shebang-based ───────────────────────────────────────────────
	{ lang: 'python', patterns: [/^#!.*python/], priority: 10 },
	{ lang: 'bash', patterns: [/^#!.*(?:bash|\/sh|zsh)/], priority: 10 },
	{ lang: 'ruby', patterns: [/^#!.*ruby/], priority: 10 },
	{ lang: 'perl', patterns: [/^#!.*perl/], priority: 10 },
	{ lang: 'javascript', patterns: [/^#!.*node/], priority: 10 },
	{ lang: 'php', patterns: [/^<\?php/], priority: 10 },

	// ── Language keywords ───────────────────────────────────────────
	{
		lang: 'tsx',
		patterns: [
			/import\s+.*from\s+['"]react['"]/,
			/import\s+React/,
		],
		priority: 6,
	},
	{
		lang: 'typescript',
		patterns: [/:\s*(string|number|boolean|void|any|never)\b/, /interface\s+\w+\s*\{/, /type\s+\w+\s*=/],
		antiPatterns: [/import.*react/i],
		priority: 5,
	},
	{
		lang: 'javascript',
		patterns: [
			/^import\s+.*from\s+['"]/m,
			/^const\s+\w+\s*=\s*require\(/m,
			/^export\s+(default|const|function|class)\b/m,
			/=>\s*\{/,
		],
		antiPatterns: [/:\s*(string|number|boolean)\b/], // not TS
		priority: 4,
	},
	{
		lang: 'rust',
		patterns: [/\bfn\s+\w+\s*\(/, /\blet\s+mut\b/, /\bimpl\s+\w+/, /\buse\s+std::/, /\bpub\s+(fn|struct|enum)\b/],
		priority: 5,
	},
	{
		lang: 'go',
		patterns: [/^package\s+\w+/m, /\bfunc\s+\w+\s*\(/, /\bfmt\.Print/],
		priority: 5,
	},
	{
		lang: 'python',
		patterns: [/^def\s+\w+\s*\(/m, /^class\s+\w+.*:/m, /^from\s+\w+\s+import\b/m, /^import\s+\w+$/m],
		priority: 4,
	},
	{
		lang: 'java',
		patterns: [/^public\s+class\s+\w+/m, /System\.out\.print/, /public\s+static\s+void\s+main/],
		priority: 4,
	},
	{
		lang: 'csharp',
		patterns: [/^using\s+System/m, /\bnamespace\s+\w+/, /\bConsole\.Write/],
		priority: 4,
	},
	{
		lang: 'cpp',
		patterns: [/^#include\s*<\w+>/m, /\bstd::/m, /\bcout\s*<</],
		antiPatterns: [/^#include\s*<stdio\.h>/m], // more likely C
		priority: 4,
	},
	{
		lang: 'c',
		patterns: [/^#include\s*<stdio\.h>/m, /^#include\s*<stdlib\.h>/m, /\bprintf\s*\(/],
		priority: 3,
	},
	{
		lang: 'ruby',
		patterns: [/^require\s+['"]/, /\bdef\s+\w+/, /\bputs\s/, /\bend$/m],
		priority: 3,
	},
	{
		lang: 'kotlin',
		patterns: [/\bfun\s+\w+\s*\(/, /\bval\s+\w+/, /\bvar\s+\w+\s*:/, /\bprintln\s*\(/],
		antiPatterns: [/\bfn\s/], // not Rust
		priority: 3,
	},
	{
		lang: 'swift',
		patterns: [/\bfunc\s+\w+\s*\(.*\)\s*->/, /\blet\s+\w+\s*:/, /\bvar\s+\w+\s*:\s*\w+/, /\bguard\s+let\b/],
		priority: 3,
	},
	{
		lang: 'sql',
		patterns: [/\b(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|ALTER TABLE)\b/i],
		priority: 5,
	},
	{
		lang: 'css',
		patterns: [/^\s*[\w.#\[\]:]+\s*\{[\s\S]*?[\w-]+\s*:/m],
		antiPatterns: [/^\s*(resource|variable|server)\b/m], // not HCL/nginx
		priority: 2,
	},
	{
		lang: 'scss',
		patterns: [/\$[\w-]+\s*:/, /@mixin\s/, /@include\s/],
		priority: 4,
	},
	{
		lang: 'bash',
		patterns: [/^\s*(if\s+\[|for\s+\w+\s+in\b|while\s|echo\s|export\s)/m],
		priority: 2,
	},
	{
		lang: 'powershell',
		patterns: [/\$\w+\s*=/, /\bGet-\w+/, /\bSet-\w+/, /\bWrite-Host\b/],
		priority: 3,
	},
	{
		lang: 'markdown',
		patterns: [/^#{1,6}\s+\S/m, /^\s*[-*]\s+\S/m],
		antiPatterns: [/^#include\b/m, /^#!/m, /^\s*\{/],
		priority: 1,
	},
	{
		lang: 'latex',
		patterns: [/\\documentclass/, /\\begin\{/, /\\end\{/, /\\usepackage/],
		priority: 5,
	},
	{
		lang: 'graphql',
		patterns: [/^\s*(type|query|mutation|subscription|fragment)\s+\w+/m],
		priority: 5,
	},
	{
		lang: 'toml',
		patterns: [/^\[[\w.]+\]\s*$/m],
		antiPatterns: [/^\[[\w.]+\]\s*\(/m], // not attributes in other langs
		priority: 2,
	},
	{
		lang: 'ini',
		patterns: [/^\[[\w\s]+\]\s*$/m, /^\w+\s*=\s*\S/m],
		priority: 1,
	},
];

/** JSON validation is a special case — try parsing */
function isJson(content: string): boolean {
	const trimmed = content.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
	try {
		JSON.parse(trimmed);
		return true;
	} catch {
		return false;
	}
}

/**
 * Detect the language of a code snippet.
 * Returns a Prism language ID or null if uncertain.
 */
export function detectLanguage(content: string): string | null {
	if (!content || content.trim().length < 10) return null;

	// Special case: JSON (structural check is more reliable than regex)
	if (isJson(content)) return 'json';

	// Sort rules by priority (highest first)
	const sorted = [...RULES].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

	for (const rule of sorted) {
		// Check anti-patterns first
		if (rule.antiPatterns?.some((ap) => ap.test(content))) continue;

		// Check if any pattern matches
		if (rule.patterns.some((p) => p.test(content))) {
			return rule.lang;
		}
	}

	return null;
}
