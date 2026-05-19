// ─── Pure helpers used by CodeViewer ─────────────────────────────────
// Extracted from CodeViewer.tsx so they can be unit-tested without
// jsdom + crypto + the full component tree.

/**
 * Human-readable byte size. Single decimal for KB/MB, no decimal for B.
 *   formatBytes(0)            → "0 B"
 *   formatBytes(1023)         → "1023 B"
 *   formatBytes(1024)         → "1.0 KB"
 *   formatBytes(1024 * 1024)  → "1.0 MB"
 */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Returns an image `src` if `content` is recognisably one image.
 * Used by CodeViewer to decide whether to offer an "Image" view mode.
 *
 * Three patterns accepted:
 *   1. `data:image/{png,jpg,jpeg,gif,webp,svg+xml,avif,bmp,x-icon};base64,…`
 *   2. Direct URL ending in a known image extension (with optional query)
 *   3. A *single* markdown image — `![alt](url)` as the only content
 *
 * Returns null when:
 *   - empty / whitespace-only
 *   - >5MB (refuse to scan giant strings)
 *   - any other shape
 *
 * SECURITY NOTE: returned values are inserted into `<img src=…>` only.
 * `<img>` cannot execute scripts even for `image/svg+xml`. If callers
 * ever switch to inline SVG injection, this function MUST be updated to
 * reject `svg+xml` or to run a separate SVG sanitiser.
 */
export function detectImage(content: string): string | null {
	const trimmed = content.trim();
	if (!trimmed || trimmed.length > 5_000_000) return null;

	// Data URI
	if (
		/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml|avif|bmp|x-icon);base64,[A-Za-z0-9+/=]+$/i.test(
			trimmed,
		)
	) {
		return trimmed;
	}

	// Direct URL with image extension
	if (
		/^https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico)(?:\?[^\s]*)?$/i.test(trimmed)
	) {
		return trimmed;
	}

	// Bare markdown image
	const mdMatch = trimmed.match(
		/^!\[[^\]]*\]\((https?:\/\/[^\s)]+|data:image\/[^)]+)\)$/i,
	);
	if (mdMatch) return mdMatch[1];

	return null;
}
