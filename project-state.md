# Kinetix Pro Studio — Project State

> **Purpose:** the situation report — perishable status only, always true as of right
> now. Six fixed sections (Current State, Active Workstreams, Open Decisions,
> Next Action, Rulings In Force, Deferred Planned Items); don't add a seventh. **Never
> put here:** task-level detail (checkbox lists, per-task notes) — that's
> `docs/work-in-progress.md`, which also holds each active workstream's own
> WS-specific rulings and deferred/known-bugs list; durable rules/invariants — that's
> `CLAUDE.md`; anything completed — remove it, don't mark it done, its record lives in
> `docs/history.md`. **Cap: ~250 lines.**

---

## 1. Current State

| Field | Value |
|---|---|
| Branch | `main` (trunk; `webgl2-effects-engine` tracks it, name is historical) |
| HEAD | `918018f`, 2026-08-11 — docs(ws1): relocate deferred items to wip, add polish list, roll next-3 |
| `vitest` | 1803 tests — 1803 pass, 0 fail, 1 skip — 72 files |
| `tsc --noEmit` | clean |
| `cargo check` | clean |
| `cargo clippy --all-targets` | clean |
| Golden replay (`scripts/phase4-handoff-replay-sync.test.ts`) | 3/3 byte-identical |

App status: shipping desktop app (Tauri DMG/installer, native ffmpeg sidecar export, no server/web hosting). Target users: YouTube creators, initial internal use across 5–10 channels. Repo: `github.com/mohtashim9119-web/kinetix-pro-studio`.

---

## 2. Active Workstreams

Task-level detail lives in [`docs/work-in-progress.md`](docs/work-in-progress.md), not here.

- **WS1 — Sync Pipeline (forced-alignment timing-source upgrade):** 2/10 tasks done (slice 1; K13 fix) — Slice 2 (50/50 silence-split re-derivation) is next. See `docs/work-in-progress.md`.

---

## 3. Open Decisions

- **C10 structural check is not CI-ready; C05 and C11 now are.** Step W (2026-08-06) recovered C05's FA token arrays and re-scored it against the shipped gate itself: verdict CI-IN (also has the manual Python harness, `scripts/phase4-step-w-trust.py`). C11 (live K13 repro, `scripts/phase4-step-w-k13-repro.test.ts`) is CI-IN too — as of K13's 2026-08-11 fix it has flipped from proving the defect to proving the fix holds (3/3, inverted); `scripts/phase4-step-w-trust.py`/`phase4-step-x-verify.py` were repaired the same day to narrate the held regression instead of the old defect-trap framing. Only C10 (seam cross-attribution) stays CI-OUT: ear-verified recall is 0/4 regardless of predicate tuning — "quieter is not fixed." None of the three block WS1's current slice.

---

## 4. Next Action

Rolling 3 — worked in order. **Maintenance rule:** when the first task completes it is removed, the list shifts up, and the next task from the roadmap's priority order is appended; the list is always exactly three.

1. **Task 5 — Rust integration for forced alignment (Phase 3).** Replace Whisper's word timestamps with a forced-alignment (CTC) sidecar — the real timing-source upgrade WS1 exists to deliver. Sits first: unblocks the most downstream work (task 4 as a side effect, task 6 transitively) and was gated on the Spanish accuracy gate, which closed 2026-08-11. Unblocked — all 3 Rust-integration gates closed. Detail: `docs/ws1-sync-pipeline/ws1-master-roadmap.md`'s NEXT UP block.
2. **Task 2 — Slice 2, re-derive the 50/50 silence-split rule.** Port `snapBoundaries.ts` + Apply-Sync plumbing (park-commit `210855d`) against current `main`. Sequenced after task 5 — cleanly decoupled from the editor path, so it can proceed once the higher-leverage timing-source work is underway; will deliberately break the golden replay, budget a per-boundary review, never a blind re-baseline. Unblocked. Detail: `docs/work-in-progress.md` WS1 item 2.
3. **Task 3 — Verify stale-anchor scroll degradation with a dedicated test.** Currently asserted correct by code reading only, no test exists yet. Lowest-effort of the three; closes a verification gap rather than shipping new behavior. Unblocked. Detail: `docs/work-in-progress.md` WS1 item 3.

---

## 5. Rulings In Force

One line each — full record in `docs/history.md`'s "Decisions Log — Dissolved from `docs/decisions/`" section (operative rule also in `CLAUDE.md` §4 Invariants). This section holds only cross-cutting rulings that apply beyond a single workstream; WS-specific rulings (currently WS1's) live in that workstream's block in `docs/work-in-progress.md` instead.

- **Model P (gapless partition)** — `project.segments` is a gapless partition; Model S (independently-positioned slots with legal gaps) is rejected. [`docs/history.md#the-model-p-ruling--official-and-locked-2026-08-07`](docs/history.md#the-model-p-ruling--official-and-locked-2026-08-07), full analysis [`#the-segments-invariant--ruling-document-2026-08-07`](docs/history.md#the-segments-invariant--ruling-document-2026-08-07), revert-scope context [`#the-model-p-revert--what-actually-happened-2026-08-07`](docs/history.md#the-model-p-revert--what-actually-happened-2026-08-07).
- **Last-segment right edge is locked, both directions, w.r.t. drag.** `segments[N-1].end === mediaDuration` is a hard invariant. [`docs/history.md#the-last-segments-right-edge--official-and-locked-2026-08-08`](docs/history.md#the-last-segments-right-edge--official-and-locked-2026-08-08).
- **A cancelled drag (`pointercancel`) discards, never commits.** [`docs/history.md#the-pointercancel-question--ruled-discard-2026-08-08`](docs/history.md#the-pointercancel-question--ruled-discard-2026-08-08).
- **Undo/redo design** — snapshots not patches, 20-state depth, page-reload persistence, lock-blocks-traversal policy. [`docs/history.md#undo--redo--design-2026-08-08`](docs/history.md#undo--redo--design-2026-08-08) (now a record of what was built, not a proposal).

**Task 5 rulings (2026-08-11).** WS1-scoped, registered here rather than `docs/work-in-progress.md` by explicit owner instruction — the detail behind each lives in `docs/ws1-sync-pipeline/ws1-master-roadmap.md`'s NEXT UP block (pointed to per-ruling below), which this section indexes.

- **R-D — Step T is not in Task 5.** Model distribution/on-demand-download is its own task, required before any release build, not before Task 5 (no release is imminent — WS1 finishes first). Task 5 itself resolves FA models via `app_local_data_dir` with a manual-placement fallback. Detail: roadmap NEXT UP, "Files expected to change."
- **R-E — Model P outranks R.5.** A forced-alignment wildcard span is assigned to the preceding segment; forced alignment may never emit a real gap in `project.segments`. Settles the open recommendation at `sync-pipeline-v2-plan.md:1441` in Model P's favor.
- **R-F — Decision 8 splits.** R.5's CTC-wildcard windowing mechanic is in Task 5/Phase 3's own scope; heading-assignment UI (Option A's on-screen behavior) stays Phase 5. Detail: roadmap NEXT UP, "Out of scope for this task."
- **R-G — `anchorSource` gains `'forced-alignment'`**, ordered above `'whisper'` (forced-alignment > whisper > estimate). Demote-only ordering is preserved; the value is set explicitly by the code path that produced it, never inferred. Detail: roadmap NEXT UP hazards list.
- **R-H — Golden replay is extended before FA timing lands.** A forced-alignment input set and a second baseline are added while the diff against the existing baseline is still zero, ahead of any FA timing change. Detail: roadmap NEXT UP acceptance criteria.
- **R-I — `-nfa` stays deferred until after Task 5 ships.** Independent by design, entangled with Task 5 at the measurement-baseline level. Detail: roadmap §13.
- **R-J — `preserveSegmentLocks` position is locked.** Stays at its current post-`autoMatchSegments` call site; must not be moved into `applyAnchorBasedTiming` under Task 5 or any later phase. Detail: roadmap NEXT UP hazards list.

---

## 6. Deferred Planned Items

### Polish Features

Owner-maintained — items are added or removed only on explicit owner instruction, never as a side effect of an audit.

1. Version snapshots — blocked on two open design decisions (asset-restoration approach, full-rewind-on-restore).
2. Auto-captions (reuse Whisper transcript tokens as a timed text layer).
3. Multi-user support — team accounts vs. staying single-user, revisit if demand materializes.
4. Sync loading screen — live 0-100% progress instead of the current static message.
5. Export quality — real color-space conversion + cross-segment drift correction (mux-time bt709 tagging already fixes the practical color mismatch; revisit only if a real issue surfaces).

### SaaS/Public-Launch Readiness

Not scheduled — required before public launch or multi-user distribution, tracked here so they aren't forgotten.

- Backend proxy for API keys — Pexels/Pixabay/Coverr keys currently ship in the client JS bundle (`VITE_`-prefixed).
- Auth layer — no authentication today; open access. Required for multi-user.
- LGPL ffmpeg swap — current sidecar (`libx264`) is GPL; swap for an LGPL-only build (OpenH264 or a commercial x264 license) before public distribution.
- Restrict `fetch_url_bytes` with a domain allowlist (SSRF hardening, `src-tauri/src/lib.rs`) — currently fetches any URL the webview passes; acceptable for internal single-user use, required before public launch.
- Download-on-first-use for the whisper model — `ggml-large-v3-turbo.bin` (~1.51 GiB) is bundled via `tauri.conf.json`'s `bundle.resources` glob today; needs fetch + progress UI + SHA-256 verification + storage-path resolution before public distribution, or every install ships ~1.65 GiB of model weight.
