# Work In Progress

> **Purpose:** the active task ledger — one line per task, no narrative. **Line cap: 250.**
> Chosen because, post-cleanup, live WS1 content is a short list of standing constraints and
> open roadmap items, not a second history file — 250 gives headroom for a few more workstreams
> without inviting narrative back in. When the cap is hit, move finished work to
> `docs/history-2.md` (companion to `docs/history.md`, same append-only rule: never edited
> mid-workstream, only appended to) and re-measure.
>
> WS1's full session-by-session history (Sessions A through AN, the component/measurement
> ledger, and the Changelog) moved to `docs/history-2.md` on 2026-08-25. This file now tracks
> only what's still open plus the constraints that still bind it.

---

> ⚠ **SINGLE-TRACKER RULE:** No additional tracking or status files may be created for
> Workstream 1. All task progress, open decisions, and roadmap steps must be recorded directly
> in this file or appended to `sync-pipeline-v2-plan.md`.

---

## WS1 — Sync Pipeline Rewrite
Started: 2026-08-04 | Status: active, accuracy bar met — see below

**The bar, as of 2026-08-25.** We have stopped trying to make the sync pipeline perfect on
first pass. Current accuracy is roughly 97–98% of boundaries correct on first sync. Anything
at or above 95% is acceptable. Remaining errors are handled by manual review in the UI, not by
further pipeline changes. Global chunking work is closed. Production chunking is frozen.

### Standing constraints

- **Stage/Phase terminology:** Stage 1 = Prepare (phases 1b, 2a, 2b, 3, 3b, 3c, 3d); Stage 2 =
  Align & Select (phase 4); Stage 3 = Place (phases 5, 6, 6b); Stage 4 = Finalize & Report
  (phase 7). Task 5 = Phase 3, inside Stage 1.
- **Stage lock status:** 0 of 4 stage locks passed.
- **`textNormalize.ts`/`canonicalize` must never change** — frozen English alignment baseline;
  non-English work goes through the separate `faTextNormalize.ts` path instead.
- **fr/de/pt real narration-audio corpus does not exist** — only synthetic fleurs-audio
  engine-parity fixtures do. Accepted in writing (H.8 dormant-rules allowance); reopens only if
  fr/de/pt-specific code ships.
- **Phase 3d reopens only if** a future measurement shows a silence-side cost from the Phase
  3b/3c normalizer changes — otherwise stays skipped.
- **Do not re-investigate** (all confirmed dead ends): DTW (confirmed dead twice); `--vad`
  (needs an unbundled model); the curr-side seam-exemption variant (disabled); FENCE/QUIET
  word-shift fixes (both failed); the "246 PICK-WRONG" figure (debunked — overcounts by ≥45,
  only 11 ear-verified cases are trustworthy).
- **Boundary-quality watcher:** do not reintroduce as previously built — the prior attempt was
  reverted for a safety-bound failure, a React render loop, and an uncalibrated formula.
- **FA default toggle** (`Project.faHighPrecisionSync` / `FA_PROJECT_DEFAULT_ON`): currently
  **OFF**. Turning it ON was gated on an owner-scored 24-row mover audit plus a live acceptance
  run — see Work In Progress below for whether that gate still matters under the new bar.
- **Zero-Defect Register:** 0 open rows, but 4 v6 closures (`085`, `224`, `307`, `383`) were
  closed structurally by R.12 and were never individually ear-scored — provisional, per ruling
  R-AM.
- **Contract 1→2 compliance:** 6 of 8 requirements met. P4 (silence assertion) and P8 (bundled
  Stage-1 output object) block on Phase 4.

### Work in progress

- **Owner scoring of the 24-row mover audit dossier** (`stage1-mover-audit.md`) — the last gate
  on the live acceptance run and the FA-default flip. Not scored as of last update.
- **4 provisional R.12 closures** (v6 boundaries 085/224/307/383) — need an ear pass to move
  from "structurally correct" to verified.

### Not started

- `FaEvent` → UI progress consumer — no hook/component consumes it yet; not blocked on
  anything.
- R.7 confidence-flag ratification, plus its two unbuilt failure paths (skip-and-flag,
  force-split).
- R.3 (clamp reference point), R.8, R.9 — designed, never built.
- Real `fa-vocab-<lang>.json` production files, and wiring `project.language`/`vocabChars`
  into both real `computeFaChunkPlan` call sites.
- Task 2 — re-derive the 50/50 silence-split rule in `snapBoundaries.ts` against current
  `main` (independent of Task 5; will deliberately break golden replay — needs per-boundary
  review, not a blind re-baseline).
- Task 3 — a dedicated test for stale-anchor scroll degradation (currently only asserted
  correct by code reading).
- Stage 1 lock → Phase 4 (Stage 2 restructure) → Stage 2 lock → Phase 5 (replace the boundary
  picker with the fence) → Phase 6/6b → Stage 3 lock → Phase 7 (observability) → Stage 4 lock.
  Each step sequenced behind the last; none started beyond Task 5's production wiring (done,
  gate off).

---

*Full WS1 history: `docs/history-2.md`.*
