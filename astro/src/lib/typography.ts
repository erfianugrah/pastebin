// ─── Shared Typography Constants ─────────────────────────────────────
// Single source of truth for recurring text patterns.
//
// Each value is a CSS class name defined in `astro/src/styles/globals.css`
// under the "Semantic typography helpers (.t-*)" section. Components still
// import this as `T` and compose with `cn()` for contextual overrides — but
// the actual rules live in CSS, so HTML artefacts outside the React tree
// (preview cards in ui-overhaul/, the design-system kit, etc.) can apply
// the same class names without Tailwind.
//
// Visual semantics are preserved 1:1 with the previous Tailwind-utility
// values; only the implementation moved into CSS.

export const T = {
	// ── Page-level ────────────────────────────────────────────────────
	pageTitle: 't-page-title',
	pageSubtitle: 't-page-subtitle',

	// ── Cards ─────────────────────────────────────────────────────────
	cardTitle: 't-card-title',
	cardDescription: 't-card-description',

	// ── Form ──────────────────────────────────────────────────────────
	formLabel: 't-form-label',
	formError: 't-form-error',
	formHelp: 't-form-help',

	// ── Paste metadata ───────────────────────────────────────────────
	metaRow: 't-meta-row',
	pasteTitle: 't-paste-title',

	// ── Section headings ─────────────────────────────────────────────
	sectionTitle: 't-section-title',
	sectionSubtitle: 't-section-subtitle',

	// ── Notices ───────────────────────────────────────────────────────
	noticeInfo: 't-notice-info',
	noticeWarning: 't-notice-warning',
	noticeSuccess: 't-notice-success',

	// ── Muted helpers ─────────────────────────────────────────────────
	muted: 't-muted',
	mutedSm: 't-muted-sm',

	// ── Centered empty / status screens ──────────────────────────────
	emptyTitle: 't-empty-title',
	emptyDescription: 't-empty-description',
} as const;
