// ─── pasteTokenStorage ─────────────────────────────────────────────────
// Delete/edit capability tokens for pastes the user has created.
//
// Threat model: the token is the only thing protecting an anonymous
// paste from being deleted by anyone who knows the ID. An XSS payload
// on `paste.erfi.io` that could read `localStorage.keys()` would have
// previously been able to enumerate every `paste_token_<id>` key and
// delete every paste the user has ever made from that browser.
//
// This wrapper routes those reads/writes through `secureStorage`, which
// encrypts under a master key kept in sessionStorage. XSS can still
// pull the master key off `sessionStorage[__secure_pasteriser_mk]` and
// decrypt — see secureStorage.ts for the full caveat — but it raises
// the bar to "find and use the master key" rather than "grep
// localStorage". Backwards compatibility: on read miss, falls back to
// the old plaintext `paste_token_<id>` key and migrates forward.

import { secureStore, secureRetrieve, secureRemove } from './secureStorage';

const isDev = typeof window !== 'undefined' && window.location?.hostname === 'localhost';

const KEY_PREFIX = 'paste_token_';

function legacyKey(pasteId: string): string {
	return `${KEY_PREFIX}${pasteId}`;
}

function storageKey(pasteId: string): string {
	return `${KEY_PREFIX}${pasteId}`;
}

/** Persist a paste's delete token. Best effort — if secureStorage fails
 *  (storage quota, master-key derivation error, etc.) the user can still
 *  delete via paste lookup UI; we just log and continue.
 */
export async function savePasteToken(pasteId: string, token: string): Promise<void> {
	try {
		await secureStore(storageKey(pasteId), token);
		// Clean up any prior plaintext entry from older versions of the app.
		try {
			localStorage.removeItem(legacyKey(pasteId));
		} catch {
			/* ignore */
		}
	} catch {
		// Last-resort fallback so the user isn't left without recourse.
		try {
			localStorage.setItem(legacyKey(pasteId), token);
		} catch {
			/* ignore */
		}
	}
}

/** Load a paste's delete token. Returns null if not found.
 *  Falls back to (and silently migrates) any legacy plaintext entry.
 */
export async function loadPasteToken(pasteId: string): Promise<string | null> {
	try {
		const fromSecure = await secureRetrieve(storageKey(pasteId));
		if (fromSecure) return fromSecure;
	} catch {
		/* fall through to legacy lookup */
	}

	// Legacy plaintext fallback. Migrate forward if found.
	let legacy: string | null = null;
	try {
		legacy = localStorage.getItem(legacyKey(pasteId));
	} catch {
		return null;
	}
	if (legacy) {
		// Migrate forward (best-effort, no re-stamp on failure — caller
		// already has the value via `legacy`). Importantly, this does NOT
		// fall through to the plaintext-rewrite branch in savePasteToken;
		// if it did, a later removePasteToken() during the same flow
		// could be undone by a delayed catch-fallback re-stamping the
		// plaintext key.
		void (async () => {
			try {
				await secureStore(storageKey(pasteId), legacy as string);
				try { localStorage.removeItem(legacyKey(pasteId)); } catch { /* ignore */ }
			} catch (err) {
				if (isDev) console.warn('pasteTokenStorage: migration failed', err);
			}
		})();
	}
	return legacy;
}

/** Synchronous "do we have a token for this paste?" probe. Used only by
 *  PasteActions to decide whether to render the Edit button at mount.
 *  Returns true if either the secure or legacy entry exists. Avoids
 *  awaiting decryption for a boolean UI state.
 */
export function hasPasteToken(pasteId: string): boolean {
	try {
		const SECURE_PREFIX = '__secure_pasteriser_';
		if (localStorage.getItem(`${SECURE_PREFIX}${storageKey(pasteId)}`)) return true;
		if (localStorage.getItem(legacyKey(pasteId))) return true;
	} catch {
		/* storage blocked */
	}
	return false;
}

export function removePasteToken(pasteId: string): void {
	try {
		secureRemove(storageKey(pasteId));
	} catch {
		/* ignore */
	}
	try {
		localStorage.removeItem(legacyKey(pasteId));
	} catch {
		/* ignore */
	}
}
