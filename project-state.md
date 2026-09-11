# Kinetix Pro Studio — Project State

> **Purpose:** perishable situation report — six fixed sections. Durable rules → `CLAUDE.md`.
> Completed work → `docs/archive/history/`. Task ledger archived at
> `docs/archive/history/work-in-progress.md`. **Cap: ~250 lines.**

---

## 1. Current State

| Field | Value |
|---|---|
| Branch | **`docs-consolidate-p2`** — Phase 2 doc consolidation on integration trunk **`ws3-export-integration`**. Round 16 (C1–C11, H1–H10) landed on integration; Windows validation + installer build remain. |
| HEAD | Re-measure on the branch under test — do not freeze SHAs or test totals here. Export round detail → `docs/ws3-export/architecture-ledger.md` (canonical ledger blob `191db9d5`). |
| Golden replay | 6/6 byte-identical baseline on `main`; re-verify on the branch measured. |
| App | Shipping desktop (Tauri DMG, ffmpeg sidecar export). Local-first; Groq feasibility documented, not shipped. |

Decode-cursor leak **CLOSED** on `main`: 3/3 live 200s/1080p/6000-frame runs, `peakOpenCursors:2`, `FORWARD_PROGRESS_BOUND_MS` (45s) alongside 30s `WATCHDOG_MS`. Full writeup: `docs/archive/history/history-2.md`'s "Export liveness" entry.

---

## 2. Active Workstreams

Task detail in lane READMEs and ledgers. Historical WIP sections → `docs/archive/history/work-in-progress.md`.

### WS3 — Export (primary — team release blocker)

**Goal:** Export watchdog / liveness / durable resume / Windows hardening for internal team build.

**Status:**
1. [OPEN] Append-path batching landed static-only (`docs/archive/ws3/append-path-audit.md`): the 30s watchdog was killing COMPLETED exports during their final append drain. Fixed, plus 1-per-chunk `appendFileRaw` IPC batched 100:1 and a 256MB queue ceiling. Unverified live: no export was run post-fix.
2. [OPEN] Part C 500-segment live export shows intermittent multi-second silent gaps mid-run — reproduced in 1 of 3 live runs 2026-09-07, never crossing either watchdog. Root cause not isolated.

**Round 16 closed on integration:** C1–C11 (export-scoped recovery budget across piece boundaries), H1–H10 hardening items, ledger reconciliation (Round 7 disambiguation via qualified headings + cross-lineage round map — no renumbering). Remaining export work is **`docs/ws3-export/windows-validation.md`** (Windows long-path delivery + installer validation checklist) and the production installer build.

### WS1 — Sync pipeline (maintenance)

Phase 3 (Task 5) past 3b/3c; accuracy bar met (~97–98%). FA default toggle gated: EMPTY Zero-Defect Register (5 open rows), two further blind ear passes, runtime cost ruling — 0/4 stage locks.

**In progress:** live acceptance run (`stage1-live-run-prep.md`); `FA_PROJECT_DEFAULT_ON` flip; rule-stage fixture coverage; Slice 2 silence-split re-derive; FA backend default-on (`fa-inference` feature).

**END GOAL:** Stage 1 locks satisfied + `FA_PROJECT_DEFAULT_ON` ON.

Session AN (arm H) remains strongest S2-family measurement — not a shipping candidate. Detail: `sync-pipeline-v2-plan.md` Part AH, archived WIP §11p.

### WS2 — Non-sync (closed)

Status: OPEN for backlog only. Next from archived WIP: transcription Req 2 (blocked on Whisper partial-token IPC), raw IPC for ffmpeg probes.

---

## 3. Open Decisions

- WS1: three defect classes (wrong-landmark, ordinalDelta mirror, improved-not-closed) — detail in archived WIP §11h.
- WS1: R.14 reliable-onset guard relaxation — needs one listening pass.
- WS1: propose/arbitrate rule-stage rebuild scheduled, not started.

---

## 4. Next Action

Rolling 3 — WS3-weighted:

1. **Execute `docs/ws3-export/windows-validation.md`** — Windows long-path delivery checklist and installer build validation.
2. **Merge `docs-consolidate-p2` → integration** after gate green on this branch.
3. **Part C 500-segment live export** — reproduce/attribute silent gaps (WS3 item 2 above).

---

## 5. Rulings In Force

Index only — full record in `docs/archive/history/history.md` Decisions Log; operative one-liners in `CLAUDE.md` §5.

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

**Backlog:** ORT thread ceiling; `fa_cancel` no UI; digest sidecar cleanup; Whisper attach buffer; React max-depth during FA; legacy v1 IDB; golden replay restore script; legacy export concat unbounded; VideoEncoder non-reproducible; Part C phase:null intervals; `GL_TRANSITION_SLUGS` duplication — see archived WIP Backlog Items section for file:line refs.
