# WS3 Documentation Inventory & Consolidation Plan (PROMPT 16)

> **Mode:** read-only audit. Produced on branch `docs-inventory`, cut from `main` @ `4d4922c`.
> Rollback anchor for WS3 integration work: `15002e5` (`ws3-export-integration`).
> **This file is the only artifact created this round.** No existing doc was edited, moved, or deleted.

---

## STEP 0 — True document set

### Method

For each branch, without checkout:

```bash
git ls-tree -r --name-only <branch> | grep -E '\.(md|mdx|txt)$'
```

Working-tree untracked (main worktree):

```bash
git status --porcelain --untracked-files=all | grep -Ei '\.(md|mdx|txt)$'
```

### Explicit exclusions (reconcile counts)

| Exclusion | Reason |
|---|---|
| `node_modules/**` | vendored; not project docs |
| `src-tauri/binaries/README.md` | gitignored sidecar provisioning; vendored path |
| `src-tauri/models/README.md` | model-pack provisioning; vendored path |
| `src-tauri/onnxruntime/README.md` | ORT bundle provisioning; vendored path |
| `.work-phase4/session-ws2-49-legacy-v1/findings.md` | ephemeral session artifact on all branches |

### Summary counts

| Metric | Value |
|---|---|
| **Total distinct doc paths** (after exclusions) | **36** |
| **Branch-exclusive** (exists on exactly one branch) | **0** |
| **Content-divergent** (same path, different blob on ≥2 branches) | **3** |
| **Pre-existing untracked on main worktree** (out of scope this round) | **3** |

### Per-branch doc counts

| Branch | Doc count |
|---|---|
| `main` | 27 |
| `ws3-export-integration` | 34 |
| `ws3-tier1-close` | 35 |
| `ws3-tier2-wire` | 35 |
| `ws3-tier3-failover` | 35 |
| `ws3-durable-resume` | 35 |
| `ws3-hardening-windows` | 36 |

The +7/+9 delta vs `main` is the WS3 export doc cluster (9 paths) minus `ws3-export-architecture-ledger` / `ws3-export-pipeline-audit` presence variance.

### Branch presence tiers (not exclusive, but merge-relevant)

| Branches present | Paths |
|---|---|
| 7/7 (all enumerated branches) | 27 shared core + measurement + script runbook paths |
| 6/7 (absent from `main` only) | `docs/ws3-append-path-audit.md`, `docs/ws3-decode-cursor-granularity.md`, `docs/ws3-export-durable-state.md`, `docs/ws3-export-recovery-architecture.md`, `docs/ws3-export-throughput-regression-audit.md`, `docs/ws3-round4-static-fixes.md`, `docs/ws3-silent-gaps-diagnosis.md` |
| 4/7 | `docs/ws3-export-architecture-ledger.md` — on `ws3-tier1-close`, `ws3-tier2-wire`, `ws3-tier3-failover`, `ws3-hardening-windows` only |
| 2/7 | `docs/ws3-export-pipeline-audit.md` — on `ws3-durable-resume`, `ws3-hardening-windows` only |

### Content-divergent docs (merge hazards)

These **must be reconciled before any merge of WS3 branches to `main` or to each other** — a green merge conflict count can still land the wrong blob.

| Path | Distinct blobs | Branch → last commit touching path |
|---|---|---|
| `docs/work-in-progress.md` | **2** | `main` @ `4d4922c` (blob `34e526e…`) vs all six WS3 branches @ `15002e5` (blob `c16afea…`, identical across WS3 branches) |
| `docs/ws3-export-architecture-ledger.md` | **3** | `ws3-tier1-close` @ `51e1f6b`; `ws3-tier2-wire` + `ws3-hardening-windows` @ `57fc882`; `ws3-tier3-failover` @ `dedc3bf` |
| `docs/ws3-export-durable-state.md` | **3** | `ws3-export-integration` + tier1 + tier3 @ `beab034`; `ws3-tier2-wire` @ `81bde88`; `ws3-durable-resume` + `ws3-hardening-windows` @ `1b3d369` |

### Pre-existing untracked (main worktree — do not stage/commit/move this round)

| Path | Lines (main WT) | Notes |
|---|---|---|
| `docs/ws3-export-durable-state.md` | 64 | **Stub only** — committed version on `ws3-hardening-windows` is 1602 lines @ `1b3d369`. Do not treat WT copy as authoritative. |
| `docs/ws3-export-speed-architecture-audit.md` | 461 | Cursor-authored feasibility audit; cited by name in `ws3-export-pipeline-audit.md` on integration branches |
| `docs/ws3-groq-transcription-architecture-audit.md` | 430 | Cursor-authored feasibility audit; zero inbound refs found in tracked tree |

---

## STEP 1 — Per-document records

Metadata ref branch: **`ws3-hardening-windows`** when the path exists there; else highest WS3 branch; else `main`.
Reference scan: `git grep -n '<basename>' ws3-hardening-windows` across `*.md`, `*.ts`, `*.tsx`, `*.rs`, `*.yml`, `*.yaml`, plus root docs. Listed refs are **inbound** (file cites the doc).

### Root tier (cross-cutting)

| Path | Branches | Lines | Last commit | Inbound refs | Purpose (one line) | Workstream |
|---|---|---:|---|---|---|---|
| `CLAUDE.md` | all 7 | 287 | `09b0662` 2026-09-06 | `README.md:62`; `project-state.md:9,56,63`; `scripts/fixtures/README.md:8,432`; `scripts/phase4-fa-replay.test.ts:15,1675,2222,2450`; `scripts/phase4-handoff-replay-sync.test.ts:324`; `scripts/fa-run-distribution.ts:17`; `scripts/generate-canonicalize-conformance-fixture.ts:80` | Durable operating manual: architecture map, invariants, conventions | **root** |
| `project-state.md` | all 7 | 121 | `918eae3` 2026-08-27 | `CLAUDE.md:6,94,246,278,283`; `README.md:63,65`; `scripts/fixtures/README.md:142`; `src-tauri/models/README.md:25`; `src-tauri/src/fa.rs:48`; `src/components/Timeline.tsx:189`; `src/services/dragSession.test.ts:273`; `src/services/dragSessionHarness.test.ts:824`; `src/services/exportPipeline.ts:249`; `src/services/gaplessInvariant.test.ts:21` | Perishable situation report (six fixed sections) | **root** |
| `README.md` | all 7 | 65 | `2631daf` 2026-08-09 | (entry point; outbound refs only) | Repo onboarding and doc index | **root** |
| `docs/history.md` | all 7 | 9618 | `faaaaf8` 2026-08-25 | pervasive — `CLAUDE.md`, `project-state.md`, `README.md`, `scripts/fixtures/README.md`, many `docs/` cross-refs | Append-only completed-work archive | **root** |
| `docs/history-2.md` | all 7 | 3548 | `4d4922c` 2026-09-07 | `CLAUDE.md:248`; `project-state.md:38,55,70`; `scripts/phase4-fa-replay.test.ts:385,683,893,1365`; `scripts/ws1-ear-pass-ledger.ts:95,165,458,669,762,984`; `scripts/ws1-session-ag-census.test.ts:9`; `docs/work-in-progress.md:31` | WS1/WS2 session completion archive (overflow from WIP) | **root** |
| `docs/work-in-progress.md` | all 7 (**divergent**) | 212 | `15002e5` 2026-09-10 on WS3 branches; `4d4922c` on `main` | `CLAUDE.md:6,33,124,246,248,250`; `project-state.md:7,19,36,38,44-47,55-57`; `.github/workflows/fa-ort-matrix.yml:6,160`; `docs/ws3-append-path-audit.md` cited at `:32` | Active task ledger (all workstreams) | **root** |
| `docs/wkwebview-drag-checklist.md` | all 7 | 132 | `918018f` 2026-08-11 | `CLAUDE.md:246,281,282` | Standing manual QA procedure for timeline drag | **root** / **ws2-editor** |

### WS1 — sync pipeline (`docs/ws1-sync-pipeline/`)

| Path | Branches | Lines | Last commit | Inbound refs | Purpose | Workstream |
|---|---|---:|---|---|---|---|
| `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` | all 7 | 10694 | `5526340` 2026-08-27 | `CLAUDE.md:144,280`; `project-state.md` (many); `scripts/fixtures/README.md:338,349,352`; `scripts/generate-canonicalize-conformance-fixture.ts:80`; `src/services/faAnchorTrustGate.ts:115`; `scripts/measure-word-onset.md:4,23,48`; `scripts/ws1-single-tracker.test.ts` (guard) | Accepted sync-pipeline v2 architecture and measurement programme | **ws1-sync** |
| `docs/ws1-sync-pipeline/stage1-live-run-prep.md` | all 7 | 382 | `704abce` 2026-08-25 | `project-state.md:57`; `scripts/ws1-single-tracker.test.ts:53`; `src/services/ruleBothSides.test.ts:18`; `src/services/syncLog.indexConvention.test.ts:10` | Stage 1 live acceptance runbook | **ws1-sync** |
| `docs/ws1-sync-pipeline/stage1-mover-audit.md` | all 7 | 379 | `918eae3` 2026-08-27 | `scripts/ws1-single-tracker.test.ts:48,50`; `docs/history-2.md` (multiple) | 24-row blind ear-scoring dossier for Apply Sync movers | **ws1-sync** |
| `docs/ws1-sync-pipeline/measurements/README.md` | all 7 | 113 | `45e9fe1` 2026-08-15 | `CLAUDE.md:287` | Index for WS1 research-phase CSV/JSON (not script fixtures) | **ws1-sync** |
| `docs/ws1-sync-pipeline/measurements/.../PROVENANCE.md` | all 7 | 31 | `45e9fe1` | none in code/scripts | Provenance note for rescued measurement park | **ws1-sync** |
| `docs/ws1-sync-pipeline/measurements/.../task5-audit-report.txt` (×4) | all 7 | 30–431 | `bb7b0f8` 2026-08-11 | none in code/scripts | Frozen replay audit text artifacts | **ws1-sync** / **archive** |
| `docs/ws1-sync-pipeline/measurements/.../task1-breath-clip-report.txt` | all 7 | 39 | `bb7b0f8` | none | Breath-clip investigation output | **ws1-sync** / **archive** |

### WS2 — FA models & video ingest

| Path | Branches | Lines | Last commit | Inbound refs | Purpose | Workstream |
|---|---|---:|---|---|---|---|
| `docs/ws2-fa-models/manage-models.md` | all 7 | 107 | `5387c39` 2026-08-27 | `docs/history-2.md` (Step 13 entry) | Manage Models modal operator doc | **ws2-fa-models** |
| `docs/ws2-fa-models/ort-provisioning.md` | all 7 | 230 | `e1103ac` 2026-08-27 | `.github/workflows/build.yml:225`; `src-tauri/onnxruntime/README.md:54,107` (excluded path but referenced) | ORT bundle provisioning runbook | **ws2-fa-models** |
| `docs/ws2-video-ingest/bug3-diagnosis.md` | all 7 | 291 | `bbe7168` 2026-08-26 | none by basename in code/scripts | Video ingest defect diagnosis | **ws2-video-ingest** |
| `docs/ws2-video-ingest/step10-windows-fetch-diagnosis.md` | all 7 | 183 | `56e2116` 2026-08-26 | `docs/history-2.md` (Step 10 entry) | Windows voiceover fetch fix record | **ws2-video-ingest** |

### WS3 — export pipeline (loose `docs/ws3-*.md` today)

| Path | Branches | Lines | Last commit | Inbound refs | Purpose | Workstream |
|---|---|---:|---|---|---|---|
| `docs/ws3-export-architecture-ledger.md` | tier1/2/3, hardening (**divergent**; **LIVE**) | 526 | `57fc882` 2026-09-11 on hardening | `docs/ws3-export-durable-state.md:16,195,581,590,1515`; `docs/ws3-export-pipeline-audit.md:10,497` | Round-by-round export architecture ledger (Rung/Tier registers) | **ws3-export** |
| `docs/ws3-export-durable-state.md` | integration+tier1–3+durable+hardening (**divergent**; **LIVE**) | 1602 | `1b3d369` 2026-09-11 | `docs/ws3-export-architecture-ledger.md:6,443,454,470`; `docs/ws3-export-pipeline-audit.md:10,196,427,498` | Durable checkpoint/resume preconditions and Round 11–13 records | **ws3-export** |
| `docs/ws3-export-pipeline-audit.md` | durable-resume, hardening (**LIVE**) | 500 | `80a7458` 2026-09-11 | none by basename outside WS3 docs | PROMPT 12 cross-branch pipeline audit (static) | **ws3-export** |
| `docs/ws3-export-recovery-architecture.md` | integration+tier1–3+durable+hardening | 829 | `6efd525` 2026-09-09 | `docs/ws3-export-architecture-ledger.md:18,108,206,209,210,480,485`; **`src/services/webcodecsExport/exportPipelineWebCodecs.ts:883,1365`**; **`exportWorker.ts:897,1180`**; **`exportWorkerDiagnostics.ts:208`**; **`flushSalvage.test.ts:7`**; **`hardwareRungDiagnostics.test.ts:6`**; **`sessionOutputFenceCallSite.test.ts:4`** | Flush-timeout / rung failover architecture (code-cited living spec) | **ws3-export** |
| `docs/ws3-silent-gaps-diagnosis.md` | integration+tier1–3+durable+hardening | 1570 | `3ad686e` 2026-09-08 | `docs/ws3-export-architecture-ledger.md:498,524`; `docs/ws3-export-recovery-architecture.md:515`; `docs/ws3-export-throughput-regression-audit.md:75`; **`driveGlRun.test.ts:400`**; **`exportPipelineWebCodecs.ts:1904`**; **`exportWorker.ts:255`**; **`exportWorkerDiagnostics.ts:25`** | Timer-starvation / occlusion diagnosis (code-cited) | **ws3-export** |
| `docs/ws3-append-path-audit.md` | integration+tier1–3+durable+hardening | 304 | `15002e5` 2026-09-10 | **`docs/work-in-progress.md:32`** | Append-path watchdog occlusion + batching audit | **ws3-export** |
| `docs/ws3-decode-cursor-granularity.md` | integration+tier1–3+durable+hardening | 175 | `ca9130c` 2026-09-09 | none in code/scripts | Decode-cursor root-cause refutation record | **ws3-export** |
| `docs/ws3-export-throughput-regression-audit.md` | integration+tier1–3+durable+hardening | 137 | `e6a0012` 2026-09-09 | `docs/ws3-silent-gaps-diagnosis.md:1098` (outbound) | Throughput regression static audit | **ws3-export** |
| `docs/ws3-round4-static-fixes.md` | integration+tier1–3+durable+hardening | 484 | `422af3a` 2026-09-08 | none by basename in code | Round 4 liveness static-fix changelog | **ws3-export** |
| `docs/ws3-export-speed-architecture-audit.md` | **untracked main WT only** | 461 | n/a (untracked) | `docs/ws3-export-pipeline-audit.md:499` (on integration branches) | Export speed optimization feasibility study | **ws3-export** |
| `docs/ws3-groq-transcription-architecture-audit.md` | **untracked main WT only** | 430 | n/a (untracked) | none | Groq vs whisper-cli feasibility study | **ws2-transcription** (proposed) |

### Script runbooks (`scripts/` — stay beside readers per `CLAUDE.md` §7)

| Path | Branches | Lines | Last commit | Inbound refs | Purpose | Workstream |
|---|---|---:|---|---|---|---|
| `scripts/fixtures/README.md` | all 7 | 484 | `37e3a73` 2026-09-01 | `CLAUDE.md:287`; many self-referential fixture tables | Index for hardcoded-path test fixtures | **scripts** |
| `scripts/measure-forced-alignment.md` | all 7 | 201 | `f6fda90` 2026-08-22 | `scripts/measure-forced-alignment-hf.md:199`; `scripts/phase3-data-cleaning.md:11,34`; `scripts/phase4-handoff-replay-sync.test.ts:364` | MMS-FA measurement runbook | **ws1-sync** / **scripts** |
| `scripts/measure-forced-alignment-hf.md` | all 7 | 202 | `f6fda90` | cross-ref from `measure-forced-alignment.md` | HF FA measurement variant | **ws1-sync** / **scripts** |
| `scripts/measure-word-onset.md` | all 7 | 134 | `f6fda90` | self-contained | Word-onset measurement runbook | **ws1-sync** / **scripts** |
| `scripts/phase3-data-cleaning.md` | all 7 | 131 | `020a678` 2026-08-05 | none | Phase 3 data-cleaning notes | **ws1-sync** / **scripts** |
| `scripts/phase3-reference-validity.md` | all 7 | 135 | `c77509d` 2026-08-05 | none | Phase 3 reference validity notes | **ws1-sync** / **scripts** |
| `scripts/ws2-49-measurement/README.md` | all 7 | 16 | `cb55639` 2026-09-05 | none | WS2-49 measurement output index | **ws2** / **scripts** |

---

## STEP 2 — Derived workstream taxonomy

Derived from **branch names**, **existing `docs/` directory prefixes**, and **doc subject matter** — not invented categories.

| Workstream folder (proposed) | Evidence | Living doc budget (target) |
|---|---|---|
| **`docs/ws1-sync-pipeline/`** (exists) | `docs/ws1-sync-pipeline/*`; WS1 branches in git history; `work-in-progress.md` §WS1; `sync-pipeline-v2-plan.md` | `README.md`, `ledger.md` (optional — plan doc may remain the ledger), `sync-pipeline-v2-plan.md`, `stage1-live-run-prep.md`, `stage1-mover-audit.md` |
| **`docs/ws2-fa-models/`** (exists) | `docs/ws2-fa-models/*`; WS2 Step 12–13 history | `README.md`, `manage-models.md`, `ort-provisioning.md` |
| **`docs/ws2-video-ingest/`** (exists) | `docs/ws2-video-ingest/*`; WS2 Step 10 | `README.md`, closed diagnoses → archive |
| **`docs/ws2-transcription/`** (new) | Untracked `ws3-groq-transcription-architecture-audit.md` is transcription scope, not export; `hooks/useWhisper.ts`, `whisper.rs` | `README.md`, `groq-feasibility.md` (optional 1 living feasibility doc) |
| **`docs/ws3-export/`** (new — consolidate 9+ loose `docs/ws3-*.md`) | Branches `ws3-*`; `work-in-progress.md` §WS3; code refs in `webcodecsExport/` | `README.md`, `ledger.md`, `durable-state.md`, `pipeline-audit.md`, `recovery-architecture.md`, `speed-feasibility.md` (≤6 living) |
| **`docs/ws2-editor/`** (new, thin) | `wkwebview-drag-checklist.md`; drag services; WS2 close-out | `README.md`, `wkwebview-drag-checklist.md` |
| **`docs/` root index** | Five-doc scheme in `CLAUDE.md` | `docs/README.md` only (plus repo-root `CLAUDE.md`, `project-state.md`, `README.md`) |
| **`scripts/` runbooks** | `CLAUDE.md` §7: fixtures beside readers | unchanged location; indexed from `docs/README.md` |

---

## STEP 3 — Classification

### HARD CONSTRAINT — KEEP-AS-IS (this round; disposition fixed)

| Path | Reason |
|---|---|
| `docs/ws3-export-architecture-ledger.md` | **LIVE** — CC appending Round 13 on `ws3-hardening-windows` |
| `docs/ws3-export-durable-state.md` | **LIVE** — Cursor-owned; R13 closed @ `80a7458` but file still authoritative |
| `docs/ws3-export-pipeline-audit.md` | **LIVE** — Cursor-owned audit artifact @ `80a7458` |

### Full classification table

| Path | Disposition | Target / notes |
|---|---|---|
| `CLAUDE.md` | **KEEP-AS-IS** (rewrite deferred — STEP 5) | Root; shrink-to-pointer recommended after WS3 lands |
| `project-state.md` | **KEEP-AS-IS** (rewrite deferred — STEP 5) | Root |
| `README.md` | **KEEP-AS-IS** | Root; update links after consolidation |
| `docs/README.md` | *(create later)* | New docs index |
| `docs/history.md` | **KEEP-AS-IS** | Root archive; no move |
| `docs/history-2.md` | **KEEP-AS-IS** | Root archive; no move |
| `docs/work-in-progress.md` | **KEEP-AS-IS** | Root ledger; resolve **divergent blob** at merge |
| `docs/wkwebview-drag-checklist.md` | **MERGE-INTO** → `docs/ws2-editor/wkwebview-drag-checklist.md` | Same content; update `CLAUDE.md` §7 pointer |
| `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` | **KEEP-AS-IS** | Already in correct folder; too large to fold |
| `docs/ws1-sync-pipeline/stage1-live-run-prep.md` | **KEEP-AS-IS** | Living runbook |
| `docs/ws1-sync-pipeline/stage1-mover-audit.md` | **KEEP-AS-IS** | Living dossier until scored closed |
| `docs/ws1-sync-pipeline/measurements/README.md` | **KEEP-AS-IS** | Index |
| `docs/ws1-sync-pipeline/measurements/**/PROVENANCE.md` | **ARCHIVE** → `docs/ws1-sync-pipeline/measurements/` (unchanged path) | Historical; already non-navigational |
| `docs/ws1-sync-pipeline/measurements/**/**.txt` | **ARCHIVE** | Frozen reports; zero code refs |
| `docs/ws2-fa-models/manage-models.md` | **KEEP-AS-IS** | Add `docs/ws2-fa-models/README.md` entry point only |
| `docs/ws2-fa-models/ort-provisioning.md` | **KEEP-AS-IS** | |
| `docs/ws2-video-ingest/bug3-diagnosis.md` | **ARCHIVE** → `docs/archive/ws2-video-ingest/bug3-diagnosis.md` | Closed diagnosis |
| `docs/ws2-video-ingest/step10-windows-fetch-diagnosis.md` | **ARCHIVE** → `docs/archive/ws2-video-ingest/step10-windows-fetch-diagnosis.md` | Folded to `history-2.md` |
| `docs/ws3-export-architecture-ledger.md` | **KEEP-AS-IS** | Later: `git mv` → `docs/ws3-export/ledger.md` **BLOCKED-UNTIL-CC-LANDS** |
| `docs/ws3-export-durable-state.md` | **KEEP-AS-IS** | Later: `docs/ws3-export/durable-state.md` **BLOCKED** |
| `docs/ws3-export-pipeline-audit.md` | **KEEP-AS-IS** | Later: `docs/ws3-export/pipeline-audit.md` **BLOCKED** |
| `docs/ws3-export-recovery-architecture.md` | **MERGE-INTO** → `docs/ws3-export/recovery-architecture.md` | **All sections survive verbatim**; 7 code refs must update path |
| `docs/ws3-silent-gaps-diagnosis.md` | **ARCHIVE** → `docs/archive/ws3-export/silent-gaps-diagnosis.md` | Historical; mechanisms cited in ledger + code comments — update comment paths |
| `docs/ws3-append-path-audit.md` | **ARCHIVE** → `docs/archive/ws3-export/append-path-audit.md` | Cited from `work-in-progress.md:32` — rewrite ref |
| `docs/ws3-decode-cursor-granularity.md` | **ARCHIVE** → `docs/archive/ws3-export/decode-cursor-granularity.md` | Closed investigation @ `4d4922c` on main |
| `docs/ws3-export-throughput-regression-audit.md` | **ARCHIVE** → `docs/archive/ws3-export/throughput-regression-audit.md` | Superseded by later rounds |
| `docs/ws3-round4-static-fixes.md` | **ARCHIVE** → `docs/archive/ws3-export/round4-static-fixes.md` | Round-specific changelog |
| `docs/ws3-export-speed-architecture-audit.md` | **MERGE-INTO** → `docs/ws3-export/speed-feasibility.md` | Untracked; track on integration branch; update `pipeline-audit.md:499` ref |
| `docs/ws3-groq-transcription-architecture-audit.md` | **MERGE-INTO** → `docs/ws2-transcription/groq-feasibility.md` | Untracked; new workstream folder |
| `scripts/*.md` | **KEEP-AS-IS** | Not under `docs/`; index from `docs/README.md` |
| `scripts/fixtures/README.md` | **KEEP-AS-IS** | Fixture contract doc |
| `scripts/ws2-49-measurement/README.md` | **KEEP-AS-IS** | |

### DELETE list

**Empty.** No doc met the bar: every fact is not held verbatim elsewhere. Round audits overlap in *topic* but not in *content* (SHAs, file:lines, NOT-DETERMINED rows, measured numbers differ). Prefer ARCHIVE over DELETE.

### Living doc count — before vs after

| Scope | Before (navigational) | After (target) |
|---|---:|---:|
| Root (`docs/` loose + root md) | 18 loose under `docs/` + 3 root | **4** root (`CLAUDE.md`, `project-state.md`, `README.md`, `docs/README.md`) + **0** loose under `docs/` |
| ws1-sync-pipeline | 4 md + 1 README + 1 PROVENANCE | **5** (README + plan + 2 stage1 + measurements README) |
| ws2-fa-models | 2 | **3** (+ README) |
| ws2-video-ingest | 2 | **1** (README only; diagnoses archived) |
| ws2-transcription | 0 | **2** (README + groq feasibility) |
| ws2-editor | 1 (misplaced at docs root) | **2** (README + checklist) |
| ws3-export | 9 tracked + 1 untracked speed | **6** (README, ledger, durable-state, pipeline-audit, recovery-architecture, speed-feasibility) |
| scripts runbooks | 7 | **7** (unchanged) |
| **Total living (hand-holdable)** | **~44** paths if counting all scripts+docs | **~30** |

---

## STEP 3 CHECKPOINT (shape confirmation)

At classification time the consolidation shape is:

1. **Nine loose `docs/ws3-*.md` files** are the primary sprawl problem; they collapse into **`docs/ws3-export/`** with three **LIVE** files untouched until CC lands.
2. **WS1 folder already matches** the target pattern except missing `README.md`.
3. **Zero defensible DELETEs** — archive round audits, keep code-cited specs as living docs.
4. **Three merge-hazard blobs** must be reconciled on branch integration before any doc moves.
5. **Two untracked feasibility audits** belong on branch (`speed` → ws3-export, `groq` → ws2-transcription).

---

## STEP 4 — Archive policy

**Decision: `docs/archive/` exists**, with **git as the ultimate retention backstop**.

| For | Against |
|---|---|
| Active ledgers cite round audits **by filename and SHA** (`pipeline-audit.md`, `architecture-ledger.md` Round logs) | Git preserves every byte forever |
| Readers without git checkout (cloud agents, pasted prompts) need resolvable paths | Duplicates content already in git history |
| Archived docs are **read-only references**, not deleted | Extra tree noise if overused |

**Retention rule:** Move closed round audits and closed diagnoses to `docs/archive/<workstream>/` **unchanged**. Never edit archived files in place — append corrections to the living ledger instead. No automatic pruning; if an archived doc has had **zero inbound refs for two consecutive workstream close-outs**, it may move to git-history-only in a dedicated cleanup pass (not this round).

---

## STEP 5 — Stale root doc rewrite drafts (do not apply)

**Trigger condition (both docs):** After CC Round 13 lands on `ws3-hardening-windows`, that branch merges to `ws3-export-integration`, and export architecture (Rungs/Tiers/durable resume) is stable on integration HEAD — **expected same gate as PROMPT 16 hard constraints release**.

### `CLAUDE.md`

**Recommendation:** **Shrink to ~120 lines** — commands, immutable invariants, doc-scheme pointers, do-not list — and **delegate architecture to `docs/<workstream>/README.md`**. WS3 export architecture will drift again if restated in CLAUDE; the ledger/durable-state pair is already the authoritative export source.

#### Inaccurate statements → corrections

| Location | Current (stale/wrong) | Correction |
|---|---|---|
| §1 | "no server and no AI API calls, everything runs locally" | App remains local-first; **Groq feasibility doc** documents optional online transcription — not shipped, but no longer accurate as absolute |
| §3 Export | Only lists `useExport.ts`, legacy + `webcodecsExport/` | Add **`exportWorker.ts`**, **`exportPipelineWebCodecs.ts`**, **`tauriFfmpeg.ts`**, **`src-tauri/src/ffmpeg.rs`** session/append/resume IPC; WS3 rung/tier failover lives here |
| §3 Export | "WebCodecs default since 2026-07-22" only | Document **liveness watchdog** (`WATCHDOG_MS`, `FORWARD_PROGRESS_BOUND_MS`), **append batching**, **durable checkpoint/resume** (Rust-side), **hardware rung failover** — see `docs/ws3-export/` |
| §3 Native | `ffmpeg.rs` one line | Expand: **`pick_save_path`**, **`append_raw`**, **`count_annexb_frames`**, **`concat_annexb_pieces`**, checkpoint manifest commands on integration branches |
| §4 Export invariants | AnnexB/concat/mux rules | Still valid; add **cancel kills worker before ffmpeg** (already there) + **resume manifest sealing order** from `durable-state.md` |
| §5 Documentation rules | "Five docs" scheme | Extend to **workstream folders** (`docs/ws1-sync-pipeline/`, `docs/ws3-export/`, …) + `docs/archive/`; `work-in-progress.md` now carries **WS3** section |
| §7 Where Things Live | Only `docs/ws1-sync-pipeline/` | Add **`docs/ws3-export/`** (ledger + durable-state + recovery-architecture); WS3 loose files listed as **transitional** until consolidation |
| §2 Commands | vitest/test counts implied current | Remove counts; point to `project-state.md` for perishable numbers |
| §4 Testing | Golden replay 6/6 as FA guard | Unchanged and still true — keep |

#### Proposed outline (thin CLAUDE)

1. What this project is (2 paragraphs)
2. Commands (unchanged block)
3. **Documentation map** (table → `docs/README.md`, workstream READMEs)
4. Invariants (segment timing, undo, export annexb — **no WS3 round detail**)
5. Conventions & do-not list
6. Where things live (pointers only)

### `project-state.md`

#### Inaccurate statements → corrections

| Section | Stale | Correction |
|---|---|---|
| §1 Branch | `main` | Active integration trunk for release work is **`ws3-export-integration`** @ `15002e5`; `main` @ `4d4922c` is WS3 decode-cursor doc only |
| §1 HEAD | WS1 Session AN narrative | WS3 is active: decode-cursor closed, liveness/occlusion rounds, tier1–3 + durable resume + hardening in flight |
| §1 vitest | 2561 passed | Re-measure on target branch (hardening: **~3297+** cited in recovery-architecture baseline — stale vs current) |
| §1 golden replay | 6/6 | Still valid on main; WS3 branches may differ — state branch measured |
| §2 Active WS | WS1 only (main) / WS3 only in WIP on integration | **WS3 — Export hardening** is primary blocker for team build per `work-in-progress.md` §WS3 |
| §4 Next Action | WS1 Slice 2 / rule-stage tests / stage1 live run | Superseded for team release by **WS3 export completion** (watchdog, append, Windows hardening, durable resume) |
| §6 Deferred | unchanged | OK |

#### Proposed outline

1. Current State (branch, HEAD one-liner, **floors table only** — no session essays)
2. Active Workstreams (**WS3 first**, then WS1, WS2 closed one-liner)
3. Open Decisions (short bullets)
4. Next Action (rolling 3, WS3-weighted)
5. Rulings In Force (index only — detail in history)
6. Deferred Planned Items

---

## STEP 6 — Execution plan (later round; do not run)

Base branch assumption: **`ws3-export-integration`** after `ws3-hardening-windows` merges.

### Phase A — Merge hazard resolution (before any `git mv`)

```bash
# A1. Merge ws3-hardening-windows → ws3-export-integration (operator)
# A2. Resolve three divergent blobs explicitly:
#     - docs/work-in-progress.md (keep WS3 § + WS1/WS2 sections from integration)
#     - docs/ws3-export-architecture-ledger.md (take hardening HEAD — CC Round 13)
#     - docs/ws3-export-durable-state.md (take hardening/durable-resume @ 1b3d369)
```

### Phase B — Create folder skeleton

```bash
mkdir -p docs/ws3-export docs/ws2-transcription docs/ws2-editor docs/archive/ws3-export docs/archive/ws2-video-ingest
# Create empty README stubs (content from STEP 2 tables)
touch docs/README.md docs/ws3-export/README.md docs/ws2-transcription/README.md docs/ws2-editor/README.md
```

### Phase C — Moves (non-LIVE)

```bash
git mv docs/wkwebview-drag-checklist.md docs/ws2-editor/wkwebview-drag-checklist.md
git mv docs/ws3-export-recovery-architecture.md docs/ws3-export/recovery-architecture.md
git mv docs/ws3-export-speed-architecture-audit.md docs/ws3-export/speed-feasibility.md  # after tracking file
git mv docs/ws3-groq-transcription-architecture-audit.md docs/ws2-transcription/groq-feasibility.md
git mv docs/ws3-silent-gaps-diagnosis.md docs/archive/ws3-export/
git mv docs/ws3-append-path-audit.md docs/archive/ws3-export/
git mv docs/ws3-decode-cursor-granularity.md docs/archive/ws3-export/
git mv docs/ws3-export-throughput-regression-audit.md docs/archive/ws3-export/
git mv docs/ws3-round4-static-fixes.md docs/archive/ws3-export/
git mv docs/ws2-video-ingest/bug3-diagnosis.md docs/archive/ws2-video-ingest/
git mv docs/ws2-video-ingest/step10-windows-fetch-diagnosis.md docs/archive/ws2-video-ingest/
```

### Phase D — LIVE doc moves (**BLOCKED-UNTIL-CC-LANDS**)

```bash
# BLOCKED-UNTIL-CC-LANDS
git mv docs/ws3-export-architecture-ledger.md docs/ws3-export/ledger.md
git mv docs/ws3-export-durable-state.md docs/ws3-export/durable-state.md
git mv docs/ws3-export-pipeline-audit.md docs/ws3-export/pipeline-audit.md
```

### Phase E — Reference rewrites (mandatory for MERGE-INTO / ARCHIVE / mv)

| Old ref | New ref | Files to edit |
|---|---|---|
| `docs/ws3-export-recovery-architecture.md` | `docs/ws3-export/recovery-architecture.md` | `exportPipelineWebCodecs.ts:883,1365`; `exportWorker.ts:897,1180`; `exportWorkerDiagnostics.ts:208`; `flushSalvage.test.ts:7`; `hardwareRungDiagnostics.test.ts:6`; `sessionOutputFenceCallSite.test.ts:4`; `architecture-ledger.md` cross-refs |
| `docs/ws3-silent-gaps-diagnosis.md` | `docs/archive/ws3-export/silent-gaps-diagnosis.md` | `driveGlRun.test.ts:400`; `exportPipelineWebCodecs.ts:1904`; `exportWorker.ts:255`; `exportWorkerDiagnostics.ts:25`; ledger + recovery-architecture cross-refs |
| `docs/ws3-append-path-audit.md` | `docs/archive/ws3-export/append-path-audit.md` | `docs/work-in-progress.md:32` |
| `docs/wkwebview-drag-checklist.md` | `docs/ws2-editor/wkwebview-drag-checklist.md` | `CLAUDE.md:246,281,282` |
| `docs/ws3-export-architecture-ledger.md` | `docs/ws3-export/ledger.md` | `durable-state.md`, `pipeline-audit.md` — **BLOCKED** |
| `docs/ws3-export-speed-architecture-audit.md` | `docs/ws3-export/speed-feasibility.md` | `pipeline-audit.md:499` |

### Phase F — Root doc rewrites (trigger STEP 5)

Apply thin `CLAUDE.md` and refreshed `project-state.md` **after Phase D completes**.

### Collision check — active branch dirty paths

Docs modified on **`ws3-hardening-windows`** vs `main` (will conflict with Phase C–D moves if attempted in parallel):

- `docs/work-in-progress.md`
- `docs/ws3-append-path-audit.md`
- `docs/ws3-decode-cursor-granularity.md`
- **`docs/ws3-export-architecture-ledger.md`** (LIVE)
- **`docs/ws3-export-durable-state.md`** (LIVE)
- **`docs/ws3-export-pipeline-audit.md`** (LIVE)
- `docs/ws3-export-recovery-architecture.md`
- `docs/ws3-export-throughput-regression-audit.md`
- `docs/ws3-round4-static-fixes.md`
- `docs/ws3-silent-gaps-diagnosis.md`

Docs modified on **`ws3-durable-resume`** (subset; no architecture-ledger):

- Same list **except** `docs/ws3-export-architecture-ledger.md`

**Wait rule:** Do not `git mv` any path in the collision list until the corresponding branch is merged or abandoned.

---

## Unclassified / blocked items

| Item | Reason |
|---|---|
| `.work-phase4/session-ws2-49-legacy-v1/findings.md` | Excluded ephemeral artifact |
| Vendored READMEs under `src-tauri/{binaries,models,onnxruntime}/` | Excluded by audit scope |
| `public/` symlink entries in `git status` | Expected noise; out of scope |

---

## Gates (this round)

| Gate | Status |
|---|---|
| Only added file: `docs/ws3-docs-inventory.md` | **Pending commit** on `docs-inventory` |
| Pre-existing untracked: 3 ws3 md files on main WT | **Not staged** |
| No `git mv` / `git rm` / edits to existing docs | **Confirmed** |
| No merge to `main` | **Confirmed** |
| No push to `main` | **Confirmed** |
| No npm/cargo test runs | **Confirmed** (audit-only) |

---

*Audit agent: Cursor. Inventory date: 2026-09-11. Enumeration HEAD reference: `ws3-hardening-windows` @ `96fec65`.*
