# Code Review Remediation Plan

Findings from security and UI/UX audit after Astro v5 -> v6 upgrade.

## Phase 1: Critical Security (do first)

### S1 — Strip console.log from crypto paths in production

- **Files:** `src/lib/crypto.ts`, `src/lib/crypto-worker.ts`
- **Lines:** crypto.ts:153, 453-502, 543, 583-584, 637; CodeViewer.tsx:143
- **Action:** Gate all `console.log` in crypto module behind `typeof window !== 'undefined' && window.location.hostname === 'localhost'` or remove entirely. Same for `CodeViewer.tsx:143` which logs the URL fragment (the encryption key).
- **Risk if skipped:** Key material and crypto metadata visible in any user's devtools.

### S3 — Remove plaintext localStorage fallback for encryption keys

- **Files:** `src/components/PasteForm.tsx:388-393`, `src/components/CodeViewer.tsx:352-356, 587-589`
- **Action:** When `secureStore` fails, show an error toast instead of silently falling back to `localStorage.setItem()` with the raw key. The user can still copy the key manually from the URL.
- **Risk if skipped:** Any same-origin script can read encryption keys from localStorage.

### S6 + S7 — Delete flow: add confirmation gate, remove auto-delete

- **Files:** `src/pages/pastes/[id]/delete.astro`
- **Action:** Replace the auto-delete-on-DOMContentLoaded with a confirmation UI. Show paste ID + a "Confirm Delete" button. Only send the DELETE request after explicit user action.
- **Risk if skipped:** Navigating a user to the URL (via link, prefetch, CSRF) deletes the paste with no confirmation.

## Phase 2: High Security

### S4 + S5 — Add CSP and clickjacking protection

- **Files:** `src/layouts/Layout.astro`
- **Action:** Add `<meta http-equiv="Content-Security-Policy">` with `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';`. The inline theme script requires `'unsafe-inline'` for now. Add `<meta http-equiv="X-Frame-Options" content="DENY">`.
- **Note:** A server-side header is better but this is a static site; meta tags are the available mechanism.

### S10 — Replace global event bus for decrypted content

- **Files:** `src/components/CodeViewer.tsx`, `src/pages/pastes/[id].astro`
- **Action:** Replace `window.dispatchEvent(CustomEvent)` + `window.pasteSessionInfo` with a closure-scoped callback passed via props or a `MessageChannel`. Remove the global `window.pasteSessionInfo` object.

### S9 — Don't reduce PBKDF2 iterations for large files

- **Files:** `src/lib/crypto.ts:14-15`, `src/lib/crypto-worker.ts:13-14`
- **Action:** Use 300K iterations uniformly. The Web Worker already runs off the main thread so the performance concern is minimal. Remove the `PBKDF2_ITERATIONS_LARGE_FILE` constant and all conditional logic that selects it.

### S14 — Service worker: network-first for API routes

- **Files:** `public/service-worker.js`
- **Action:** Add `/api/`, `/pastes/` to an exclusion list that uses network-first strategy. Only use cache-first for static assets (JS, CSS, images, fonts).

## Phase 3: Critical + High Accessibility

### U1 + U4 — Modal focus trap and ARIA

- **Files:** `src/components/ui/modal.tsx`
- **Action:** Add `role="dialog"`, `aria-modal="true"`, `aria-labelledby` to Modal. Implement focus trap (cycle Tab within modal, return focus on close). Rewrite `showConfirmModal` to use the React Modal component instead of raw DOM.

### U2 — Toast aria-live region

- **Files:** `src/components/ui/toast.tsx`
- **Action:** Wrap ToastContainer in `<div aria-live="polite">`. Use `role="status"` for success/info, `role="alert"` only for errors. Add `aria-label="Dismiss notification"` to close button. Increase default duration from 3000ms to 5000ms. Pause timer on hover/focus.

### U3 — Replace window.confirm() in CodeViewer

- **Files:** `src/components/CodeViewer.tsx:559`
- **Action:** Replace `window.confirm()` with the Modal component or an inline prompt asking whether to save the password.

### U6 — Progress bar ARIA attributes

- **Files:** `src/components/PasteForm.tsx:924-949`, `src/components/CodeViewer.tsx:841-845`
- **Action:** Add `role="progressbar"`, `aria-valuenow`, `aria-valuemin={0}`, `aria-valuemax={100}`, `aria-label`.

### U9 — Keyboard-accessible tooltips

- **Files:** `src/components/ui/tooltip.tsx`
- **Action:** Add `onFocus`/`onBlur` handlers mirroring mouse enter/leave. Add `role="tooltip"` and `aria-describedby` linking trigger to tooltip content.

## Phase 4: Medium Priority

### S11 — Remove silent Base64 error correction

- **Files:** `src/lib/crypto.ts:22-51`, `src/lib/crypto-worker.ts:21-50`
- **Action:** Remove the `fixedInput.replace(/[^A-Za-z0-9+/=]/g, 'A')` fallback. Invalid Base64 should be a hard error with a clear message.

### S15 — Fix password strength sequential detection

- **Files:** `src/lib/passwordStrength.ts:70`
- **Action:** Replace the broken regex with a check for any 3+ character sequential run (abc, 123, xyz, etc.).

### S18 — Sanitize client logger storage

- **Files:** `src/lib/clientLogger.ts:73-84`
- **Action:** Strip stack traces in production before writing to localStorage. Add a blocklist for keys that should never appear in log context (key, password, nonce, salt, etc.).

### U5 — Icon-only button labels

- **Files:** `src/components/PasteForm.tsx` (copy URL, copy key buttons), `src/components/CodeViewer.tsx`
- **Action:** Add `aria-label` to all icon-only buttons. Add `aria-hidden="true"` to all decorative SVGs.

### U7 + U8 — Inline form validation with aria-describedby

- **Files:** `src/components/PasteForm.tsx`
- **Action:** Add `onBlur` validation for required fields. Associate error messages with fields via `id` + `aria-describedby`. Add `aria-invalid` when errors exist.

### U10 — Delete page confirmation UI

- **Covered by S6+S7 above.**

### U12 — Code viewer vertical scroll

- **Files:** `src/components/CodeViewer.tsx:875`
- **Action:** Add `overflow-y-auto` alongside `overflow-x-auto`.

### U13 — Fix React `selected` attribute

- **Files:** `src/components/PasteForm.tsx:591`
- **Action:** Remove `selected` from `<option>`, add `defaultValue="86400"` to the `<select>`.

### U14 + U15 — Toast close button label + timing

- **Covered by U2 above.**

### U16 + U17 — Mobile menu aria-expanded + Escape handler

- **Files:** `src/components/Header.tsx`
- **Action:** Add `aria-expanded`, `aria-controls`, Escape key handler, focus management on open/close.

### U21 — ExpirationCountdown always visible

- **Files:** `src/components/ExpirationCountdown.tsx:101-103`
- **Action:** Show "Expires on [date]" for distant expirations instead of returning `null`.

### U22 — ThemeToggle placeholder during SSR

- **Files:** `src/components/ThemeToggle.tsx:76`
- **Action:** Return a fixed-size placeholder div instead of `null` to prevent layout shift.

## Phase 5: Low Priority / Polish

- **S13** — Use `crypto.randomUUID()` for worker request IDs (`crypto.ts:310`)
- **S16** — Replace `innerHTML = ''` with `replaceChildren()` (`recent.astro:160`)
- **S19** — Trim passwords before length check (`validation.ts:157`)
- **S25** — Remove/gate debug logging in recent.astro (`recent.astro:139-145`)
- **U18** — Active link indication in Header
- **U20** — Replace `alert()` in Footer About with Modal
- **U22** — ThemeToggle SSR placeholder (covered above)
- **U25** — System theme button visible on mobile
- **U26** — Loading spinners with `role="status"`
- **U27** — `select-none` on blurred content
- **U29** — Toast ID counter: module variable instead of localStorage
- **U32** — Fix placeholder `docs.example.com` link
- **U35** — Add skip-to-content link in Layout
