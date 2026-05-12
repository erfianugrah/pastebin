# UI overhaul plan

Branch: `ui/overhaul`. Single branch, no PR. Track progress here, tick boxes as phases land.

Reference: `ui-overhaul/` (design system extracted from prod by Claude Design, with intent files for what we don't yet ship). Specifically:

- `ui-overhaul/README.md` — content fundamentals, visual foundations, iconography
- `ui-overhaul/colors_and_type.css` — standalone token file with `.t-*` helpers
- `ui-overhaul/Pasteriser Design System Assets/assets/prism-pasteriser.css` — token-driven Prism theme (NEW vs prod)
- `ui-overhaul/Pasteriser Design System Assets/assets/prose.css` — markdown prose styles (NEW vs prod)
- `ui-overhaul/HANDOFF-vendor-prism-marked.md` — patch list for Prism + marked (we apply via runtime patches, not literal file vendoring)

## Decisions (user-confirmed)

1. **Strategy**: npm install for `marked` + `dompurify`; apply HANDOFF patches as runtime monkey-patches in `prism-setup.ts` and `marked.use({...})` extensions in `markdown.ts`. No literal file vendoring under `assets/vendor/`.
2. **Iosevka**: keep `@fontsource/iosevka` (already build-bundled WOFF2). Skip 12.6 MB Nerd Font TTF.
3. **e2e**: run against `astro dev` (`http://localhost:3000`) via Playwright `webServer` config.
4. **Typography helpers**: consolidate — `T.*` (`astro/src/lib/typography.ts`) rewritten to point at `.t-*` CSS classes living in `globals.css`.

## Phases

### Phase 0 — Plan + branch setup
- [x] Branch `ui/overhaul` created
- [x] PLAN.md written

### Phase 1 — Token-driven Prism theme ✅
- [x] Copy `ui-overhaul/.../prism-pasteriser.css` to `astro/public/prism-themes/prism-pasteriser.css`
- [x] Add `--fs-*`, `--lh-*`, `--fw-*`, `--tracking-*`, `--radius-full` tokens to `globals.css` (needed by prism-pasteriser.css + prose.css + future `.t-*` helpers)
- [x] Edit `astro/src/layouts/Layout.astro`:
  - Replace the two `<link>` tags with one `<link rel="stylesheet" href="/prism-themes/prism-pasteriser.css">`
  - Delete the runtime `updatePrismThemes()` swap logic
  - Keep dark-class toggle in `themeScript`
- [x] Delete `astro/public/prism-themes/prism-one-light.css` + `prism-okaidia.css`
- [x] Build: `cd astro && npm run build` ✅
- [ ] Visual smoke: localhost shows a TS code block in light + dark — deferred to Phase 8

**Acceptance**: code blocks render through a single CSS file; no FOUC on theme toggle.

### Phase 2 — Brand mark in Header ✅
- [x] Edit `astro/src/components/Header.tsx` — flex container with `<img src="/favicon.svg" aria-hidden width=20 height=20>` preceding "Pasteriser"
- [x] Hover preserves `hover:text-primary transition-colors`
- [x] Build ✅

**Acceptance**: header shows the indigo→blue `</>` monogram inline with the wordmark.

### Phase 3 — Markdown rendering: marked + DOMPurify + prose.css ✅
- [x] Installed `marked@18.0.3` + `dompurify@3.4.2`
- [x] `astro/public/styles/prose.css` — copied from ui-overhaul, added `.prose-table-scroll` rule
- [x] `astro/src/layouts/Layout.astro` — `<link>` for prose.css
- [x] `astro/src/lib/markdown.ts` — 187 lines:
  - `Marked` instance with `{ gfm: true, breaks: false }`
  - Custom renderers: code (Prism-compatible), heading (slugged id), link (ext rel/target), listitem (task-list), table (.prose-table-scroll wrapper)
  - Inline `kbdExtension` tokenizer/renderer for `[[…]]`
  - DOMPurify with `ADD_ATTR: id, class, target, rel, disabled, checked, data-language` + `ADD_TAGS: kbd`
  - Per-render slugger isolation
- [x] `astro/src/components/CodeViewer.tsx`:
  - Removed inline 28-line `renderMarkdown()`
  - Imports `renderMarkdown` from `../lib/markdown`
  - New `proseRef` for rendered markdown container
  - New effect re-runs `Prism.highlightElement` on fenced blocks inside `proseRef` when `showRendered` or content changes
- [x] `astro/src/lib/__tests__/markdown.test.ts` — 25 tests green (sluggers, ext links, fenced blocks, tables, task lists, kbd, DOMPurify sanitization, empty input)
- [x] Build ✅
- [x] `npm test` — 197/197 (was 172 + 25 new)

**Acceptance**: markdown pastes render with tables, task lists, anchor IDs, and fenced-block syntax highlighting.

### Phase 4 — Prism patches via prism-setup.ts ✅
- [x] `astro/src/lib/prism-setup.ts` — 38 lines
  - Patch 1: `Prism.manual = true` (applied)
  - Patches 2/3/4/5: verified no-op in v1.30.0 via tests (TS interpolation, TSX fragment, MD embedded fences, numeric separators all work upstream). Documented in comment.
  - Patch 6: line-numbers plugin already auto-attaches via `pre.line-numbers` class
  - Exports `setupPrism(): void` (idempotent) and `highlightAllUnder(root): void`
- [x] `astro/src/layouts/Layout.astro` — script block calls `setupPrism()` and `highlightAllUnder(document.body)` on DOMContentLoaded; grammar/plugin imports preserved
- [x] `astro/src/lib/__tests__/prism-setup.test.ts` — 5 tests green
  - `Prism.manual === true` after setup
  - TS template literal interpolation token present
  - TSX fragment does not crash + emits `token keyword`
  - MD fenced `ts` block emits TS token classes
  - Numeric separator `600_000` is a single `number` token
- [x] Build ✅

**Acceptance**: TS template-literal interpolation, TSX fragments, MD-nested fences, and numeric separators all tokenize correctly. Future Prism upgrades that regress these will fail the tests.

### Phase 5 — Consolidate T.* / .t-* ✅
- [x] Added `.t-*` classes to `astro/src/styles/globals.css` (18 classes, plain CSS using `var(--muted-foreground)` etc; literal pixel values preserve current visuals because Tailwind's text-* scale differs from the design-system `--fs-*` tokens). Authored in plain CSS so HTML artefacts outside React can reuse them.
- [x] Rewrote `astro/src/lib/typography.ts` — `T.*` now points at single class names (`pasteTitle: 't-paste-title'`, etc.)
- [x] Component tests (jsdom) — 22/22 green
- [x] Build ✅

**Acceptance**: single source of truth (CSS classes in globals.css); component imports unchanged; visuals preserved 1:1 with previous Tailwind values.

### Phase 6 — Cleanup ✅
- [x] Removed `import '@fontsource-variable/inter';` from `Layout.astro`
- [x] Removed `@fontsource-variable/inter` from `astro/package.json` deps
- [x] Lockfile updated via `npm install`
- [x] Build ✅

**Acceptance**: no Inter font in bundle; mono everywhere as the system intends.

### Phase 7 — Playwright e2e ✅
**Pivot**: local astro dev serves only the frontend (Worker backend not available without `wrangler dev` + secrets). Backend-dependent markdown e2e moved to a **component integration test** (RTL + jsdom). Local Playwright covers pure-static behaviours.

- [x] `playwright.config.ts` — two projects:
  - `chromium-prod` (baseURL `https://paste.erfi.io`) — existing suite, hits real API
  - `chromium-local` (baseURL `http://127.0.0.1:4321`) — `testMatch: 'e2e/local/**'`
  - `webServer` auto-spawns `cd astro && npm run dev -- --port 4321 --host 127.0.0.1` (port 3000 was busy with Open WebUI on this dev box)
- [x] `package.json` scripts:
  - `test:e2e` → `--project=chromium-prod`
  - `test:e2e:local` → `--project=chromium-local` (new)
- [x] `e2e/local/header-brand.spec.ts` — logo svg + wordmark visible, header sticky
- [x] `e2e/local/prism-theme.spec.ts` — only `/prism-themes/prism-pasteriser.css` loaded (no `prism-one-light` / `prism-okaidia`); `/styles/prose.css` loaded
- [x] `e2e/local/theme-toggle.spec.ts` — `light` → click → `dark` cycle flips `<html class>`
- [x] `astro/src/components/__tests__/CodeViewer-markdown.test.tsx` (RTL+jsdom, 3 tests) — toggles Preview, asserts heading slug id, table wrapper, task-list items, kbd, fenced TS block markup, and DOMPurify scrubs scripts

- [x] `npm run test:e2e:local` — 5/5 green

**Acceptance**: e2e header + Prism theme + theme toggle specs green against local dev; CodeViewer markdown integration tested via jsdom.

### Phase 8 — Final verification ✅
- [x] `npm run build:ui` — full UI build ✅
- [x] `npm run check` — typecheck clean (root tsconfig now excludes `astro/`, `ui-overhaul/`, `dist`, `.wrangler`)
- [x] `npm run lint` — clean (scoped to `src/**/*.ts`)
- [x] `npm test` — **202 / 202** passed (was 172 + 30 new: markdown 25 + prism-setup 5)
- [x] `npm run test:ui` — **25 / 25** component tests green (was 22 + 3 new CodeViewer markdown integration)
- [x] `npm run test:e2e:local` — **5 / 5** local Playwright specs green (header brand, prism theme, prose.css, theme toggle, sticky header)
- [x] Server-rendered HTML smoke (`curl http://127.0.0.1:4321/`) confirms:
  - `<link rel="stylesheet" href="/prism-themes/prism-pasteriser.css">` is the only Prism theme requested
  - `<link rel="stylesheet" href="/styles/prose.css">` shipped
  - Header brand: `<img src="/favicon.svg" aria-hidden="true" width=20 height=20>` precedes the "Pasteriser" wordmark
  - `.t-form-label`, `.t-paste-title`, `.t-meta-row` class names appear in rendered HTML

**Acceptance**: all automated gates green; SSR HTML inspection confirms each phase landed.

### Phase 9 — Verify pass (post-build review)
- [x] Re-ran all gates from scratch: typecheck, lint, 202 unit, 25 component, 5 local e2e, build — all green
- [x] Deleted orphan `astro/public/prism-themes/prism.css` (default Prism theme, no longer referenced)
- [x] Tightened `.t-*` classes — added explicit `line-height` values matching Tailwind v4 text-* defaults (`1.25rem` for text-sm, `1.75rem` for text-xl, `2rem` for text-2xl, etc.). Without this, `.t-*` classes inherited body's 1.6 line-height where Tailwind would have set a different value. True 1:1 visual parity now.
- [x] Verified prod Playwright project still discovers existing `paste-lifecycle.spec.ts` (10 tests) under the new `--project=chromium-prod` scope
- [x] Verified Worker code (`src/`) untouched — pure frontend overhaul

Final dist contents:
- `astro/dist/prism-themes/` — only `prism-pasteriser.css` (single token-driven theme)
- `astro/dist/styles/` — only `prose.css`
- No `prism-one-light.css`, no `prism-okaidia.css`, no orphan `prism.css`
- `marked` + `dompurify` tree-shaken into `assets/PasteViewer.*.js`
- `@fontsource-variable/inter` fully gone from package.json + lockfile + bundle

## Files touched (final)

| Action | Path |
|---|---|
| New | `astro/public/prism-themes/prism-pasteriser.css` |
| New | `astro/public/styles/prose.css` |
| New | `astro/src/lib/markdown.ts` |
| New | `astro/src/lib/prism-setup.ts` |
| New | `astro/src/lib/__tests__/markdown.test.ts` |
| New | `astro/src/lib/__tests__/prism-setup.test.ts` |
| New | `e2e/markdown-rendering.spec.ts` |
| New | `e2e/header-brand.spec.ts` |
| Edit | `astro/src/layouts/Layout.astro` |
| Edit | `astro/src/components/Header.tsx` |
| Edit | `astro/src/components/CodeViewer.tsx` |
| Edit | `astro/src/lib/typography.ts` |
| Edit | `astro/src/styles/globals.css` |
| Edit | `astro/package.json` |
| Edit | `playwright.config.ts` |
| Edit | `package.json` (root) — add `test:e2e:local` script |
| Delete | `astro/public/prism-themes/prism-one-light.css` |
| Delete | `astro/public/prism-themes/prism-okaidia.css` |

## Risks + rollbacks

- **Prism theme color regression** — palette tweaks in `prism-pasteriser.css` if a token class looks washed out. Revert: restore the two static themes from git.
- **DOMPurify too strict** — adds visible "missing content" gaps. Mitigation: expand `ALLOWED_ATTR` in `markdown.ts`.
- **Vite tree-shaking surprises** with `marked` UMD — if `import { marked } from 'marked'` breaks, fall back to subpath import or `marked.parse()` static call.
- **Playwright webServer port clash** — Astro defaults to 4321; we set `astro dev` script to bind to 3000 elsewhere. Confirm `cd astro && npm run dev` listens on 3000 before running e2e.

## Out of scope (deferred)

- Literal file vendoring under `assets/vendor/` per HANDOFF — npm + runtime patches achieve the same outcome with less toil
- Iosevka Term Nerd Font local bundle (12.6 MB TTF, needs subsetting)
- `/design` showcase route exposing the 20 preview cards + UI kit demo
- Refactoring `AuthForm.tsx` to match the (stale) design-system version — prod has magic-link + GitHub OAuth which the design system lacks
