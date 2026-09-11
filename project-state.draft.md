# Kinetix Pro Studio — Project State (DRAFT)

> **TEMPORARY — Phase 2 only.** Replace `project-state.md` with this file, then delete
> `project-state.draft.md`. Absorbs `docs/work-in-progress.md` task content; the WIP file
> itself moves to `docs/archive/history/` in Phase 2.

> **Purpose:** perishable situation report — six fixed sections. Durable rules → `CLAUDE.md`.
> Completed work → `docs/archive/history/`. **Cap: ~250 lines.**

---

## 1. Current State

| Field | Value |
|---|---|
| Branch | **`ws3-hardening-windows`** — primary export hardening; integration trunk **`ws3-export-integration`** @ `15002e5` carries append-path batching + WS3 WIP blob. **`main`** @ `4d4922c` is decode-cursor doc only. |
| HEAD (WS3) | CC mid-Round 14 on hardening (`9c80e71` and beyond from `be332ee` taxonomy restore). Ledger/durable-state **LIVE** — do not consolidate WS3 paths until CC lands. |
| Test floors | **Do not freeze counts here** — CC is moving vitest/cargo totals on hardening. Re-measure on the branch under test; export round detail → `docs/ws3-export/architecture-ledger.md` (Phase 2 path). |
| Golden replay | 6/6 byte-identical on `main`; WS3 branches may differ — state branch measured. |
| App | Shipping desktop (Tauri DMG, ffmpeg sidecar export). Local-first; Groq feasibility documented, not shipped. |

Decode-cursor leak **CLOSED** on `main` (`4d4922c`): 3/3 live 200s/1080p/6000-frame runs, `peakOpenCursors:2`, `FORWARD_PROGRESS_BOUND_MS` (45s) alongside 30s `WATCHDOG_MS`. Full writeup: `docs/archive/history/history-2.md`'s "Export liveness" entry.

---

## 2. Active Workstreams

Task checklists folded from `docs/work-in-progress.md` (`main` @ `4d4922c` base + `15002e5` WS3 append-path item). Detail in lane READMEs and ledgers.

### WS3 — Export (primary — team release blocker)

**Goal:** Export watchdog / liveness / durable resume / Windows hardening for internal team build.

**Status (`main` WIP + `15002e5` delta):**
1. [OPEN] Append-path batching landed static-only (`docs/ws3-append-path-audit.md`): the 30s watchdog was killing COMPLETED exports during their final append drain (a completed append reset only the 45s progress bound, never `WATCHDOG_MS`, and no chunk can arrive after 'done'). Fixed, plus 1-per-chunk `appendFileRaw` IPC batched 100:1 and a 256MB queue ceiling. Unverified live: no export was run, so the throughput claim is arithmetic on call count only.
2. [OPEN] Part C 500-segment live export (200s/1080p, transition+animation on every boundary/segment) shows intermittent multi-second silent gaps mid-run — reproduced in 1 of 3 live runs 2026-09-07 (15 intervals >5s, longest 10.74s), never crossing either watchdog so the export still completes. Root cause not isolated; most intervals lack phase attribution.

**In progress on `ws3-hardening-windows`:** STEPs 5–10 (profile ladder, encoder session accounting, durable recovery budget, Windows long-path delivery, ledger Round 14). See branch HEAD and `docs/ws3-export-architecture-ledger.md`.

### WS1 — Sync pipeline (maintenance)

Phase 3 (Task 5) past 3b/3c; accuracy bar met (~97–98%). FA default toggle gated: EMPTY Zero-Defect Register (5 open rows), two further blind ear passes, runtime cost ruling — 0/4 stage locks.

**In progress:** live acceptance run (`stage1-live-run-prep.md`); `FA_PROJECT_DEFAULT_ON` flip; rule-stage fixture coverage; Slice 2 silence-split re-derive; FA backend default-on (`fa-inference` feature).

**END GOAL:** Stage 1 locks satisfied + `FA_PROJECT_DEFAULT_ON` ON.

Session AN (arm H) remains strongest S2-family measurement — not a shipping candidate. Detail: `sync-pipeline-v2-plan.md` Part AH, `docs/work-in-progress.md` §11p (historical until Phase 2 archive).

### WS2 — Non-sync (closed)

Status: OPEN for backlog only. Baselines (8dbbcea): see branch measurement when touching WS2 paths. Next from WIP: transcription Req 2 (blocked on Whisper partial-token IPC), raw IPC for ffmpeg probes.

---

## 3. Open Decisions

- WS3 ledger reconciliation at Phase 2 merge: fold tier3 Round 9 Rung 5c DEFER block; resolve Round 9 number collision by renumbering later entry (not dropping content).
- WS1: three defect classes (wrong-landmark, ordinalDelta mirror, improved-not-closed) — detail in WIP §11h.
- WS1: R.14 reliable-onset guard relaxation — needs one listening pass.
- WS1: propose/arbitrate rule-stage rebuild scheduled, not started.

---

## 4. Next Action

Rolling 3 — WS3-weighted:

1. **Let CC land Round 14 on `ws3-hardening-windows`**, then merge to integration — **BLOCKED-UNTIL-CC-LANDS** for any `docs/ws3-*` move except Phase 1b rescue.
2. **Phase 2 doc consolidation** — apply `CLAUDE.draft.md`, `project-state.draft.md`, WS3 lane `git mv`s, deferred reference rewrites in export code + `CLAUDE.md`.
3. **Part C 500-segment live export** — reproduce/attribute silent gaps (WS3 item 2 above).

---

## 5. Rulings In Force

Index only — full record in `docs/archive/history/history.md` Decisions Log; operative one-liners in `CLAUDE.md` §4.

- Model P (gapless partition)
- Last-segment right edge locked (drag)
- pointercancel discards
- Undo/redo snapshot design
- Task 5 rulings R-D through R-N, R-O, R-P
- Spanish-corpus acceptance (2026-08-27)

---

## 6. Deferred Planned Items

**Polish:** version snapshots, auto-captions, multi-user, sync loading screen, export quality.

**SaaS/readiness:** API key proxy, auth, LGPL ffmpeg swap, `fetch_url_bytes` allowlist.

**Backlog (from WIP):** ORT thread ceiling; `fa_cancel` no UI; digest sidecar cleanup; Whisper attach buffer; React max-depth during FA; legacy v1 IDB; golden replay restore script; legacy export concat unbounded; VideoEncoder non-reproducible; Part C phase:null intervals; `GL_TRANSITION_SLUGS` duplication — see archived WIP Backlog Items section for file:line refs.
