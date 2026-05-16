# Kinetix Pro Studio — Project State

> **Purpose:** Living source of truth for project status. Updated at the end of every work session.
> Distinct from `CLAUDE.md` — that file covers architecture/conventions; this file tracks where we are.

---

## Meta

| Field | Value |
|---|---|
| Last updated | 2026-05-16 |
| Current phase | Phase 2 complete — ready for Phase 3 planning |
| Hosting target | Cloudflare Pages (frontend) · Render backend TBD |
| Target users | YouTube creators — initial internal use across 5–10 channels |
| Repo | TBD |

---

## Roadmap Phases

| Phase | Description | Status |
|---|---|---|
| Phase 0 | Audit & baseline — understand the codebase, establish conventions, git setup | ✅ Complete |
| Phase 1 | Foundation refactor — component decomposition, strict TS, immutable updates, UUID swap | ✅ Complete |
| Phase 2 | Persistence — localStorage for project state, IndexedDB for binary assets | ✅ Complete |
| Phase 3 | Export pipeline rebuild — replace broken MediaRecorder approach with proper render | ⬜ Not started |
| Phase 4 | Polish — implement missing filters/transitions, Safari compat, API proxy, error handling | ⬜ Not started |
| Phase 5 | Production hardening — auth, tests, accessibility, responsive design | ⬜ Not started |

---

## Current Sprint

Phase 2 complete. Next: Phase 3 (export pipeline rebuild).

| Step | Description | Status |
|---|---|---|
| Step 1 | IndexedDB asset store service (`assetStore.ts`) | ✅ Done |
| Step 2 | localStorage project serializer (`projectStore.ts`) | ✅ Done |
| Step 3 | Debounced save hook (`usePersistProject.ts`) | ✅ Done |
| Step 4 | Asset blob persistence wiring — uploads and deletes | ✅ Done |
| Step 5 | Project rehydration on load — blob URL reconstruction | ✅ Done |
| Step 6 | "New Project" reset action | ✅ Done |
| Step 7 | Docs + final verification | ✅ Done |

---

## Decisions Log

| Date | Decision |
|---|---|
| 2026-05-16 | **Hosting:** Cloudflare Pages for frontend. Free tier, edge CDN, unlimited bandwidth. Render backend deferred to Phase 3. |
| 2026-05-16 | **Target users:** YouTube creators. Initial private use across 5–10 channels owned by user's team. |
| 2026-05-16 | **Export approach:** TBD in Phase 3. Options on the table: Remotion, custom canvas/WebGL renderer, server-side ffmpeg worker. |
| 2026-05-16 | **Branch strategy:** `main` is the stable branch. Feature work goes on short-lived branches, merged via PR. |
| 2026-05-16 | **Output format:** MP4 required for YouTube upload. Current WebM output is unacceptable for production — this is a Phase 3 blocker. |

---

## Open Questions

- [ ] Export rendering approach — Remotion vs custom canvas/WebGL vs server-side ffmpeg worker
- [ ] Render backend host — Railway, Fly.io, Hetzner, Remotion Lambda (decide in Phase 3 planning)
- [ ] Multi-user support — team accounts in v1, or stay single-user through Phase 5?
- [x] Asset storage for persistence — **Resolved (Phase 2):** IndexedDB is sufficient for single-user browser-local persistence. R2/S3 will be revisited when multi-user/cloud-sync arrives (likely Phase 5 or later).
- [ ] Dangling segment references on asset delete — segments referencing a deleted asset are cleaned up on reload (hydration unsets `assetId`) but not at delete time. Decide in Phase 3 whether to clean up at delete time or keep the current eventually-consistent behavior. Affects export pipeline.
- [ ] Bundle splitting — main chunk is ~521 kB. Candidates for lazy-loading: SegmentEditorPanel, StockSearchModal, SyncReviewModal. Defer to Phase 4 (polish).
- [ ] Stock API key handling — keep client-side for internal use, or proxy immediately in Phase 4?

---

## Completed Work Log

| Date | Work |
|---|---|
| 2026-05-16 | Extracted project from Google AI Studio ZIP, initialized git repo on `main` |
| 2026-05-16 | Wrote comprehensive codebase audit covering architecture, bugs, missing features, and risks |
| 2026-05-16 | Created `CLAUDE.md` — architectural reference with conventions, do-not-do list, known limitations, refactor status |
| 2026-05-16 | Created `project-state.md` — this file |
| 2026-05-16 | Initial commit pushed to GitHub (15 files, 8,254 insertions) |
| 2026-05-16 | Git identity configured (Mohtashim / mohtashim9119@gmail.com) |
| 2026-05-16 | Created and pushed `phase-1-foundation` branch — Phase 1 work begins here |
| 2026-05-16 | **Phase 1 Step 1:** Enabled strict TS (strict, noUncheckedIndexedAccess, noImplicitOverride, noFallthroughCasesInSwitch). Installed @types/react + @types/react-dom. Fixed all 82 type errors in App.tsx and stockService.ts. Added immutable update helpers. 0 tsc errors. |
| 2026-05-16 | **Phase 1 Step 2:** Replaced all Math.random().toString(36) IDs with crypto.randomUUID(). |
| 2026-05-16 | **Phase 1 Step 3:** Fixed stale closure in keyboard listener, dead audio sync branch, .mp4→.webm export, index.html title, stripped AI Studio artifacts from vite.config.ts, removed unused storyMap state. |
| 2026-05-16 | **Phase 1 Step 4:** Removed dead deps (@google/genai, express, dotenv, tsx, @types/express). Moved @types/jszip, vite, @tailwindcss/vite, @vitejs/plugin-react to devDependencies. |
| 2026-05-16 | **Phase 1 Step 5:** Extracted 7 components from App.tsx: StockSearchModal, SyncReviewModal, SegmentEditorPanel, Timeline, PreviewStage, SyncWizard, SettingsPanel. Also extracted syncEngine.ts and constants.ts. App.tsx reduced from 3,167 → 1,449 LOC. 0 tsc errors throughout. |
| 2026-05-16 | **Phase 1 Verification fixes:** Caught two layout regressions during post-extraction browser testing. (1) Timeline not visible at 100% zoom — fixed by adding `min-h-0` to PreviewStage's `flex-1` root so the Timeline's `h-72` is respected by the flex container. (2) Fullscreen CSS specificity conflict — `relative` (in base className) was overriding `fixed` (in conditional classes) due to Tailwind utility ordering. This was a pre-existing bug in the original code, discovered during verification. Fixed by splitting the className into a ternary so position utilities are mutually exclusive. Both verified at 1280×800 using browser preview. |
| 2026-05-16 | **Phase 1 complete.** Branch `phase-1-foundation` pushed and PR opened for review. |
| 2026-05-16 | **Phase 2 Step 1:** Created `src/services/assetStore.ts` — pure IndexedDB service exposing `putAsset`, `getAsset`, `getAllAssets`, `deleteAsset`, `clearAllAssets`. No React, no `any`. (5ff4edd) |
| 2026-05-16 | **Phase 2 Step 2:** Created `src/services/projectStore.ts` — localStorage serializer with versioned key `kinetix:project:v1`. Strips `url` and `file` from assets before save; loads and returns typed `StoredProject`. (c18ac91) |
| 2026-05-16 | **Phase 2 Step 3:** Created `src/hooks/usePersistProject.ts` — debounced (500ms) save hook that skips the first render and accepts an `enabled` flag to suppress saves during hydration. (b04a37c) |
| 2026-05-16 | **Phase 2 Step 4:** Wired `putAsset` into all asset-add paths (`handleFileUpload`, `handleZipUpload`, stock `onSelect`). Stock assets now fetch to blob first. Wired `deleteAsset` + `URL.revokeObjectURL` into gallery delete. Bail-on-failure pattern: if `putAsset` throws, asset is not added to project state. (8bfbc52) |
| 2026-05-16 | **Phase 2 Step 5:** Wired rehydration mount effect into `App.tsx`. On load: reads localStorage → fetches all IDB blobs → reconstructs `blob:` URLs. Orphaned assets dropped with `console.warn`; referencing segments and `voiceoverId` cleared. `isHydrating` flag gates UI and suppresses premature saves. (ca7447d) |
| 2026-05-16 | **Phase 2 Step 6:** Added "New Project" button in Settings panel Danger Zone. Confirm → revoke all blob URLs → clear localStorage → clear IndexedDB → reset React state to `DEFAULT_PROJECT`. Cancel path is a no-op. (b782072) |
| 2026-05-16 | **Phase 2 complete.** Branch `phase-2-persistence` pushed. `tsc --noEmit` 0 errors, `npm run build` clean. Full smoke test passed: upload → refresh → rehydration → "New Project" → post-reset upload all verified. |

---

## Quick Stats

| Metric | Value |
|---|---|
| `src/App.tsx` LOC | 1,560 (was 3,167 — 51% reduction; +111 for persistence wiring) |
| localStorage key | `kinetix:project:v1` |
| IndexedDB store | `kinetix-assets` / `assets` (keyPath: `id`) |
| Total dependencies | 20 (12 prod + 8 dev) |
| Dead dependencies identified | 5 (`@google/genai`, `express`, `dotenv`, `tsx`, `vite` duplicated in prod deps) |
| Critical bugs identified | 5 (stale closure in playback, `togglePlay` listener churn, dead branch in audio sync, `trimEnd` unimplemented, `storyMap` param unused) |
| Export-blocking issues | 2 (canvas misses DOM overlays; `.webm` mislabeled as `.mp4`) |
| Transition enum values unmapped | ~42 of 57 |
| Filter names with no style implementation | ~30 of 55 |
