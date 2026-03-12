// ─── Shared Typography Constants ─────────────────────────────────────
// Single source of truth for recurring text patterns.
// Import as `T` and compose with `cn()` for contextual overrides.

export const T = {
	// ── Page-level ────────────────────────────────────────────────────
	pageTitle: 'text-3xl font-bold',
	pageSubtitle: 'text-sm text-muted-foreground',

	// ── Cards ─────────────────────────────────────────────────────────
	cardTitle: 'text-2xl font-semibold leading-none tracking-tight',
	cardDescription: 'text-sm text-muted-foreground',

	// ── Form ──────────────────────────────────────────────────────────
	formLabel: 'block text-sm font-medium mb-1',
	formError: 'text-destructive text-sm mt-1',
	formHelp: 'text-xs text-muted-foreground mt-1',

	// ── Paste metadata ───────────────────────────────────────────────
	metaRow: 'text-muted-foreground text-sm flex flex-wrap gap-x-4 gap-y-1',
	pasteTitle: 'font-medium text-lg truncate',

	// ── Notices ───────────────────────────────────────────────────────
	noticeInfo: 'text-sm text-info',
	noticeWarning: 'text-sm text-warning',
	noticeSuccess: 'text-sm text-success',

	// ── Muted helpers ─────────────────────────────────────────────────
	muted: 'text-xs text-muted-foreground',
	mutedSm: 'text-sm text-muted-foreground',

	// ── Security panel ───────────────────────────────────────────────
	panelTitle: 'text-sm font-semibold mb-2',
	panelLabel: 'font-medium',
	panelHelp: 'text-xs mt-0.5',
} as const;
