// ─── Prism setup ──────────────────────────────────────────────────────
// Applies the 6 patches from ui-overhaul/HANDOFF-vendor-prism-marked.md §1.5
// at runtime against the npm `prismjs` package (v1.30.0). Calling setupPrism()
// is idempotent.
//
// Patches 2, 5 (TS template interpolation; numeric separators) are no-ops in
// v1.30.0 because the upstream grammar already covers them — we keep the
// patch slot empty + add a regression test so we notice if it regresses on
// upgrade. Patches 3 (TSX fragment) and 4 (Markdown embedded code) are
// likewise handled by upstream v1.30 and tracked the same way.
//
// The remaining patches are:
//   - Patch 1: Prism.manual = true
//   - Patch 6: line-numbers plugin already auto-attaches via `pre.line-numbers`
//
// All grammar imports stay at the call sites that need them so the bundler
// can tree-shake unused languages.

import Prism from 'prismjs';

let installed = false;

export function setupPrism(): void {
	if (installed) return;
	installed = true;

	// Patch 1 — disable auto-highlight on DOMContentLoaded.
	Prism.manual = true;
}

/**
 * Run Prism over every <pre> > <code> with a language-* class under `root`.
 * Used by CodeViewer's effect after Markdown HTML is committed to the DOM.
 */
export function highlightAllUnder(root: HTMLElement | Document): void {
	const codes = root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]');
	codes.forEach((code) => {
		const pre = code.parentElement;
		if (pre && !pre.classList.contains('line-numbers')) {
			pre.classList.add('line-numbers');
		}
		Prism.highlightElement(code);
	});
}
