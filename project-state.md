# Kinetix Pro Studio — Project State

> **Purpose:** the situation report — perishable status only, always true as of right
> now. Six fixed sections (Current State, Active Workstreams, Open Decisions,
> Deferred and Known-Broken, Rulings In Force, Next Action); don't add a seventh. **Never
> put here:** task-level detail (checkbox lists, per-task notes) — that's
> `docs/work-in-progress.md`; durable rules/invariants — that's `CLAUDE.md`; anything
> completed — remove it, don't mark it done, its record lives in `docs/history.md`.
> **Cap: ~250 lines.**

---

## 1. Current State

| Field | Value |
|---|---|
| Branch | `main` (trunk; `webgl2-effects-engine` tracks it, name is historical) |
| HEAD | `5066852`, 2026-08-10 — WS2+WS3 closeout: workstream docs archived/pruned, `FORCE_LEGACY_VIDEO_PREVIEW` dev toggle removed from `PreviewStage.tsx` (a docs-and-comments-only stale-reference sweep may follow this commit) |
| `vitest` | 1793 tests — 1792 pass, 0 fail, 1 skip — 71 files |
| `tsc --noEmit` | clean |
| `cargo check` | clean |
| `cargo clippy --all-targets` | clean |
| Golden replay (`scripts/phase4-handoff-replay-sync.test.ts`) | 3/3 byte-identical |

App status: shipping desktop app (Tauri DMG/installer, native ffmpeg sidecar export, no server/web hosting). Target users: YouTube creators, initial internal use across 5–10 channels. Repo: `github.com/mohtashim9119-web/kinetix-pro-studio`.

---

## 2. Active Workstreams

Task-level detail lives in [`docs/work-in-progress.md`](docs/work-in-progress.md), not here.

- **WS1 — Sync Pipeline (forced-alignment timing-source upgrade):** 1/8 tasks done — Slice 2 (50/50 silence-split re-derivation) is next. See `docs/work-in-progress.md`.

---

## 3. Open Decisions

- **C10 structural check is not CI-ready; C05 and C11 now are — corrected 2026-08-11, this bullet was stale.** Step W (2026-08-06) recovered C05's FA token arrays and re-scored it against the shipped gate itself: verdict CI-IN. C11 (live K13 repro) is CI-IN too — it correctly reproduces the K13 defect today, and is designed to flip to failing once K13 is fixed; that's the point, not a blocker. Only C10 (seam cross-attribution) stays CI-OUT: ear-verified recall is 0/4 regardless of predicate tuning — "quieter is not fixed." Verified by running `scripts/phase4-step-w-trust.py` directly. None of the three block WS1's current slice.

---

## 4. Deferred and Known-Broken

**Known bugs, not yet fixed:**
- **K13 — lock preservation is broken across resync.** Clean-slate resync mints every segment fresh via `parseProjectData`, which has no `locked` field and never reads `project.segments` — so a locked segment silently loses both its position and its lock flag on the next Apply Sync. Live repro: `scripts/phase4-step-w-k13-repro.test.ts` (must start failing when this is fixed — that's the signal, not a broken test). Fix path: `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`'s Stage 3, an order-keyed carry-forward of `locked` into the freshly-parsed array.
- **`boundaryUsedFallback` calls `isBreathSilence` with 4 arguments instead of 5** (`src/services/snapBoundaries.ts`) — the omitted 5th parameter silently defaults to disabling the seam exemption, so every `validateBoundaryQuality` reading on a seam-exempted pair has been wrong since it shipped. Diagnostic-only — never affects a committed boundary. Scheduled for v2 Phase 7; self-resolves if v2 Phase 6 deletes the exemption instead.
- **Stuck `resizingId` on an early-bail drag start** (`src/services/dragSession.ts`) — **WONTFIX (owner ruling, 2026-08-08).** Unreachable through the UI (both bail conditions require state a real gesture can't produce), and fixing it would retire a characterization test that proves the WS2 task-1 extraction was behavior-preserving. The desired behavior is pinned as a deliberately skipped spec test (`dragSessionHarness.test.ts` PART 4) and the residue is actively audited by `acknowledgeKnownResidue`, which fails if the residue ever stops appearing. Ruling lapses if the path ever becomes reachable.

**Deferred polish (not scheduled):**
- **22 blank `boundary-quality-flag` rows** in `scripts/fixtures/verification-baseline.csv` — deferred, non-blocking (owner ruling R-A, 2026-08-11). WS1 does not pause for an ear-listening pass to fill them in.
- Export quality — real color-space conversion + cross-segment drift correction (mux-time bt709 tagging already fixes the practical color mismatch; revisit only if a real issue surfaces).
- Version snapshots — blocked on two open design decisions (asset-restoration approach, full-rewind-on-restore).
- Auto-captions (reuse Whisper transcript tokens as a timed text layer).
- Multi-user support — team accounts vs. staying single-user, revisit if demand materializes.
- Adaptive per-voice silence thresholds (noise-floor estimation, falling back to the current fixed −45dB).
- Sync loading screen — live 0–100% progress instead of the current static message.

**SaaS/public-launch readiness (not scheduled — required before public launch or multi-user distribution, tracked here so they aren't forgotten):**
- Backend proxy for API keys — Pexels/Pixabay/Coverr keys currently ship in the client JS bundle (`VITE_`-prefixed).
- Auth layer — no authentication today; open access. Required for multi-user.
- LGPL ffmpeg swap — current sidecar (`libx264`) is GPL; swap for an LGPL-only build (OpenH264 or a commercial x264 license) before public distribution.
- Restrict `fetch_url_bytes` with a domain allowlist (SSRF hardening, `src-tauri/src/lib.rs`) — currently fetches any URL the webview passes; acceptable for internal single-user use, required before public launch.
- Download-on-first-use for the whisper model — `ggml-large-v3-turbo.bin` (~1.51 GiB) is bundled via `tauri.conf.json`'s `bundle.resources` glob today; needs fetch + progress UI + SHA-256 verification + storage-path resolution before public distribution, or every install ships ~1.65 GiB of model weight.

---

## 5. Rulings In Force

One line each — full record in `docs/history.md`'s "Decisions Log — Dissolved from `docs/decisions/`" section (operative rule also in `CLAUDE.md` §4 Invariants).

- **Model P (gapless partition)** — `project.segments` is a gapless partition; Model S (independently-positioned slots with legal gaps) is rejected. [`docs/history.md#the-model-p-ruling--official-and-locked-2026-08-07`](docs/history.md#the-model-p-ruling--official-and-locked-2026-08-07), full analysis [`#the-segments-invariant--ruling-document-2026-08-07`](docs/history.md#the-segments-invariant--ruling-document-2026-08-07), revert-scope context [`#the-model-p-revert--what-actually-happened-2026-08-07`](docs/history.md#the-model-p-revert--what-actually-happened-2026-08-07).
- **Last-segment right edge is locked, both directions, w.r.t. drag.** `segments[N-1].end === mediaDuration` is a hard invariant. [`docs/history.md#the-last-segments-right-edge--official-and-locked-2026-08-08`](docs/history.md#the-last-segments-right-edge--official-and-locked-2026-08-08).
- **A cancelled drag (`pointercancel`) discards, never commits.** [`docs/history.md#the-pointercancel-question--ruled-discard-2026-08-08`](docs/history.md#the-pointercancel-question--ruled-discard-2026-08-08).
- **Undo/redo design** — snapshots not patches, 20-state depth, page-reload persistence, lock-blocks-traversal policy. [`docs/history.md#undo--redo--design-2026-08-08`](docs/history.md#undo--redo--design-2026-08-08) (now a record of what was built, not a proposal).
- **Heading-wildcard assignment (Option A)** — unscripted audio (spoken chapter headings) is absorbed entirely by the preceding segment, logged as an explicit `unscripted-gap` entry. Owner decision 8, recorded in `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`'s Steps Y–Z section. Blocks v2 Phase 5, not Phase 3.
- **Spanish forced-alignment gate — cleared.** Step F's breath-aware reference scores p95 50.4ms against the approved 250ms gate (1 of 22 pauses over) — passes. All three WS1 Rust-integration gates (Spanish accuracy, structural checks, heading assignment) are closed. Evidence: `docs/ws1-sync-pipeline/spanish-gate-scoring.md`, `docs/ws1-sync-pipeline/roadmap-2026-08-07.md` §D2, `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` Step U/T.7.
- **K13 fixed fresh on `main`; `model-p-editor-work` never merges.** Owner ruling R-C (2026-08-11): `model-p-editor-work` stays permanently unmerged; K13 (lock preservation across resync) is fixed as a new bug written directly against `main`, porting only the logic/idea from the parked branch, never its stale code. Tracked as its own task in `docs/work-in-progress.md`.

---

## 6. Next Action

**WS1 slice 2** (the 50/50 silence-split re-derivation) is the next concrete implementation task — it's cleanly decoupled from the editor path on current `main`. Budget the golden-replay per-boundary review as part of that work, never a blind re-baseline.

**WS1 task 5** (Rust integration for forced alignment) is also unblocked as of this consolidation — all three gates are closed — and can proceed in parallel with slice 2. Per owner ruling R-B, the fr/de/pt unvalidated-language warning surfaces (Step T.7) ship in that same task/release, not after.

K13 (lock preservation across resync) is scheduled as its own WS1 task, to be fixed fresh against `main` per owner ruling R-C — see `docs/work-in-progress.md`.
