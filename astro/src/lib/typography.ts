// ─── Shared Typography Constants ─────────────────────────────────────
// Single source of truth for recurring text patterns.
// Import as `T` and compose with `cn()` for contextual overrides.

export const T = {
	// ── Page-level ────────────────────────────────────────────────────
	pageTitle: 'text-2xl font-bold tracking-tight',
	pageSubtitle: 'text-sm text-muted-foreground',

	// ── Cards ─────────────────────────────────────────────────────────
	cardTitle: 'text-2xl font-semibold leading-none tracking-tight',
	cardDescription: 'text-sm text-muted-foreground',

	// ── Form ──────────────────────────────────────────────────────────
	formLabel: 'text-sm font-medium mb-1 block',
	formError: 'text-destructive text-sm mt-1',
	formHelp: 'text-xs text-muted-foreground mt-1',

	// ── Paste metadata ───────────────────────────────────────────────
	metaRow: 'flex flex-wrap items-center gap-2 text-sm text-muted-foreground',
	pasteTitle: 'text-xl font-bold',

	// ── Section headings ─────────────────────────────────────────────
	sectionTitle: 'text-lg font-semibold',
	sectionSubtitle: 'text-sm text-muted-foreground',

	// ── Notices ───────────────────────────────────────────────────────
	noticeInfo: 'text-sm text-info',
	noticeWarning: 'text-sm text-warning',
	noticeSuccess: 'text-sm text-success',

	// ── Muted helpers ─────────────────────────────────────────────────
	muted: 'text-xs text-muted-foreground',
	mutedSm: 'text-sm text-muted-foreground',

	// ── Centered empty / status screens ──────────────────────────────
	emptyTitle: 'text-lg font-semibold mb-1',
	emptyDescription: 'text-sm text-muted-foreground mb-6 max-w-sm',
} as const;
