// ─── Shared typography helpers ───────────────────────────────────────
// Source of truth for the (small) set of CSS class names that recur
// across multiple components. Each value resolves to a `.t-*` class
// defined in `astro/src/styles/globals.css` under the "Semantic
// typography helpers" section.
//
// Most styling lives directly in Tailwind utility chains at the call
// site. Only patterns repeated in 3+ places are pulled out here.
//
// The brutalist redesign of May 2026 collapsed an 18-key helper set
// down to 5 — the rest had no real-world users after components moved
// to inline utility classes. Don't re-add keys speculatively; only when
// the same multi-class pattern reappears in ≥3 components.

export const T = {
	// Form fields
	formLabel: 't-form-label',
	formError: 't-form-error',

	// Paste viewer
	pasteTitle: 't-paste-title',

	// Muted body / status text
	muted: 't-muted',
	mutedSm: 't-muted-sm',
} as const;
