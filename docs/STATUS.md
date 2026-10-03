# Project Status

Last updated: 2026-10-03 — v1.4.3 on `ws1-143-hotfix`: found-and-fixed (waiting-mislabel, dual GPU door, worker OOM + chunked long-audio alignment, ffmpeg serialization) — queued bulk rows read Waiting with a static bar; only the running row animates Transcribing; editor cloud GPU waits on the bulk queue; align submit refuses >1h (`too-long`) and windows over MAX_RUN_SEC before any GPU; export and thumbnail generation never share the ffmpeg sidecar. Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count.
Last updated: 2026-10-03 — v1.4.1 on `ws1-wininstall-hotfix`: found-and-fixed (hardcoded sidecar roots blocked custom Windows installs; tombstones not carried on relocation) — ffmpeg/whisper are allowed when they sit in the current exe's own install directory on any drive; a blocked sidecar is reported as sidecar-blocked (not “Couldn't read the voiceover”); `deleted-projects.json` moves with the storage root. Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count. found-and-fixed (last-stage handoff miss) — the last transcribe→align of a chain now carries the same `holdJobId` claim as every intermediate handoff (cache-hit and None-tombstone included), so `handedOff=true` and held=0; the client submits that last align without a pre-submit job-list and without skipping the submit on a lookup hit. Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count.
Last updated: 2026-10-03 — v1.4.0 on `ws1-shipfix`: found-and-fixed (stale-gateway silent client, hold-window vs measured handoff, liveJobId cross-target, cost attribution) — ping validates schema 2 with a loud deploy-required pause; stage chaining submits the next job immediately (no 1.5s poll wait) and HOLD_FOR_PLAN_SEC is 8s so a measured handoff stays one boot; Cancel/pause bind per project/row job; row cost is per-job seconds not the global counter. Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count.
Last updated: 2026-10-02 — v1.4.0 on `ws1-unify-build`: found-and-fixed (deleted projects resurrected on immediate reload) — confirm writes a crash-safe tombstone file before the grid updates; every load path (dashboard, store, mirror adoption, staged restore, reattach, scanner) skips those ids forever; only vault/reclaim stays background. Prior: cancelled bulk row looked finished; GPU idle after finish; server-owned jobs P0–P11. Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count.
Prior header: 2026-10-02 — v1.4.0 on `ws1-unify-build`: found-and-fixed (cancelled bulk row looked finished) — cancel is not a successful finish, so the row stays unsealed; Retry resumes from checkpoint (cache hits); replacing files re-keys a fresh run; status reads Cancelled — Retry; sunk cost stays in the P7 sum. Prior: GPU idle after finish (no 30s hold); server-owned jobs P0–P11. Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count.
Prior header: 2026-10-02 — v1.4.0 on `ws1-unify-build`: found-and-fixed (GPU idle after a finished cloud job) — a done transcribe/align/finish releases the worker immediately (no 30s hold, no dead-man billing); operator Kill releases the GPU and keeps the job record; the last batch row and an orphaned container sit the 2s scaledown floor, not 30s. Prior: server-owned jobs (poll/reattach; abort detaches; pause on the job; boot reattach; forward-only stage chips; cumulative row cost; one auto-retry then Failed — Retry; crash-proof align poll; Cancel / Cancel all / Stop all; pre-flight before GPU). Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count.
Prior header: 2026-10-02 — v1.4.0 on `ws1-unify-build`: found-and-fixed (app lifecycle killed cloud jobs) — submitted jobs are server-owned; the client polls/reattaches; abort detaches the poller and does not DELETE; pause questions live on the job; boot reattaches bulk rows; bulk stage chips are a forward-only checklist (furthest checkpoint + live job, never loop); row cost sums every billed attempt; a failed row auto-retries once from its checkpoint then parks as Failed — Retry while the queue keeps moving. Prior: sidecar symlink guard, real-disk import flush batching, delete main-thread hang. Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count.
Prior header: 2026-10-02 — v1.4.0 on `ws1-unify-build`: found-and-fixed sidecar symlink guard (canonicalize exe before the StartingBinary check), real-disk import flush batching (one registry fsync + deferred part-rename per batch), and delete main-thread hang (no per-hash vault IPC; confirm paints first). Prior: one Build Timeline (editor and bulk share `runBuildTimeline`); bulk no longer skips autoMatch / lock / effect restore; import-path slowness measured and fixed (JSZip `loadAsync` on the JS thread plus per-file SHA-256 and per-file dir-fsync — zip extract off-thread, batched dir-fsync, live Adding… progress, voiceover add no longer awaits Opus encode). Cached-row finish is the same service as the editor (cache hits, ~$0). Installers are built by the operator. Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count.
Prior header: 2026-10-02 — v1.3.2 on `main` (`ws1-bulk-fixes` → `main`): operator 1.3.1 follow-ups — real cloud errors on the row/log/record, files stay editable until the first successful build, staged restore on open, honest Paused/Build-failed dashboard cards, a clickable status popover, chips only in the expanded row, footer cost/grammar, Open on paused/failed. Cache-hit finish slowness is parked (bulk-only pipeline the unify merge deletes). Installers are built by the operator. Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count.
Prior header: 2026-10-02 — v1.3.1 on `main` (`ws1-bulk-media-fix` → `main`): bulk builds now save their media (found and fixed), the bulk drawer docks as the dashboard's left column with a restyle, built rows keep their cost and files across reloads, and bulk-built projects get the editor's sync log. Installers are built by the operator; the operator's real-window verification of 1.3.1 precedes distribution. Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count.
Prior header: 2026-10-01 — v1.3.0 bulk landing on `main` (`ws1-bulk2-landing` → `main`: merges of `ws1-bulk2-pipeline` and `ws1-bulk2-ui`, then the wiring between them). The operator's bulk workflow replaces the 1.2.2 interim finishing UX. Landed unverified per operator instruction; installers are built by the operator, and the operator's real-window verification of 1.3.0 precedes distribution. Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count.
Prior header: 2026-10-01 — v1.2.2 P0 stabilization on `main` (`ws1-bulk-stabilize` → `main`): the operator's real-window verification of 1.2.1 FAILED (bulk finish wrote row 1's content into every row's record), so 1.2.1 is held from distribution and superseded by 1.2.2; the team stays on 1.1.1 until the operator verifies 1.2.2. The operator's planned bulk workflow is pending and supersedes the interim finishing UX. Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count.
Prior header (2026-10-01): v1.2.1 fix-forward on `main` (`ws1-drawer-layering` → `main`): the bulk drawer was painted over by the dashboard, so 1.2.0 was held from distribution by the operator and is superseded by 1.2.1. Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count.
Prior header (2026-10-01): v1.2.0 bulk-queue landing on `main` (merge `08f1bd7`, `ws1-bulk-queue` → `main`). Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count. Landed unverified per operator instruction; operator verification on the built 1.2.0 precedes distribution; fix-forward is 1.2.1.
Prior header (2026-10-01): registry follow-up pack landed on `main` (merge `f962d23`, `ws1-registry-relocation` → `main`; folds into 1.2.0, no installer rebuild). Open count **40 → 41 → 40**: +1 storage-root relocation races the registry gate (41/40, a one-line cap breach) and CLOSED in the same edit by `97df04e` — net **40/40**, breach resolved; trail in the registry follow-up block below.
Prior header (2026-10-01): v1.1.1 hotfix: media-vault registry corruption class fixed and landed on `main` (merge `85f515e`, `ws1-registry-lock` → `main`). Open count unchanged at **40/40** (at cap) — found-and-fixed is prose, outside the count.
Prior header (2026-09-30): Wave 3 CLOSED: U9 media unification + hardening landed on `main` (merge `d90c6fd`, `ws1-wave3-media-unify` → `main`), release v1.1.0.
Open count **38 → 40** (**40/40, AT CAP, not over**): +1 manual binding markers not carried across a full re-sync, +1 spot re-sync
(deferred to long-term backlog by operator ruling at Wave 3 close). Trail is in the Wave 3 close block below.
Prior header (2026-09-30): housekeeping landing on `main` (merge `bd4a3b6`, `ws1-housekeeping` → `main`), open count 41 → 38
(38/40, back under the cap): fold 41 → 40, harness closed 39, orphans closed 38, grammar closed 37, one new parked line
(boundary-vs-FA-truth accuracy) 38.
Prior header (2026-09-30): Wave 3 mini-landing (merge `88f2936`), open count 37 → 41 (41/40, over the cap by one).
Prior header (2026-09-27): Wave 2 landing, open count 38 → 37 (37/40) — two closures (38 − 2 = 36:
Settings model-status divergence, per-scene pre-flight gate), one addition (36 + 1 = 37: byte-deletion
lifecycle). Wave 1 landing (merge `ws1-wave1`, 2026-09-20) had taken 40 → 36; Wave 1 formal close
(`e039c4d`) then queued two Wave 2 lines (36 → 38).

> **Single source of truth for project tracking.** Retired trackers live under
> `docs/archive/history/` (`work-in-progress.md`, `project-state.md`). Update this file only;
> do not create a parallel tracking doc.

---

## NEW RULINGS

Dated entries from the FA wiring ground-truth audit (`docs/architecture/fa-wiring-audit.md`, source SHA `ebec58a`, worktree `4.kinetix-pro-studio-cloud-asr`, branch `ws-cloud-asr-plan`).

- **NR-1 (2026-09-17):** Forced alignment is an officially wired, first-class **local** feature. When the project high-precision toggle is ON, alignment must run; it must **never** silently substitute Whisper timings while presenting a successful sync. Evidence: production path `App.tsx:3960-4022` + fail-clean `forcedAlignmentRun.ts`; CI compiles `fa-inference` (`.github/workflows/build.yml:424`).
- **NR-2 (2026-09-17) — SUPERSEDED 2026-09-19.** Was: toggle default becomes ON for all builds and users, subject to migration (`faGate.ts` absent-key semantics — audit STEP 4). NR-2 assumed the `faHighPrecisionSync` toggle persists and only its default changes. Operator ruling this pass (2026-09-19, recorded verbatim in [`operator-product-rulings-2026-09-19.md`](ws1-sync-pipeline/operator-product-rulings-2026-09-19.md)) replaces the premise entirely: cloud becomes the default sync engine and **no FA toggle will exist** — there is no toggle left for NR-2's default to apply to. Left in place rather than deleted so the FA wiring audit discovery trail (`ebec58a`) stays intact; do not implement NR-2's migration.
- **NR-3 (2026-09-17):** Silent FA → Whisper fallback while toggle ON is defect **D24** (see WS1 Open Bugs — re-filed 2026-09-19, was WS3). Inventory: audit STEP 3; Sync Log `fa-fallback` is not sufficient under NR-1.
- **NR-4 (2026-09-17):** Prior “FA disabled / not in shipped build / cloud-only first delivery” claims are stale. Index: audit STEP 5 + Amendment 3 in [`docs/architecture/cloud-asr-plan.md`](architecture/cloud-asr-plan.md). WS1 `sync-pipeline-v2-plan.md` body unchanged; one status line at file top points here.
- **NR-5 (2026-09-17):** `main` moved **`4d4922c` → `42988f1`** (merge `ws3-export-integration` @ `45d5860`, then `ws-cloud-asr-plan` @ `eb1c4fa`). Rollback: annotated tag **`pre-round28-main`** on `4d4922c`. Windows verification of Round 29 D12–D22 passed before merge. **D23** and **D24** were open and unblocked by this merge — D23 closed 2026-09-19 (RETIRED AS MOOT, operator ruling, see WS3 Open Bugs); **D24** remains open (re-filed to WS1).
- **NR-6 (2026-09-19):** Product direction ruling set recorded verbatim in [`operator-product-rulings-2026-09-19.md`](ws1-sync-pipeline/operator-product-rulings-2026-09-19.md) — cloud default engine, FA toggle deletion (supersedes NR-2 above), Whisper-only as flagged degraded state, per-pack local readiness, pause-and-offer-local on disconnect, WPM warn-only band, cloud mid-coverage abort cost allocation, one-job/two-cache-stage cloud pipeline, SaaS/credits out of scope, partition invariant test approved, Wave 1 gating on both cache-race fixes below, fr/de/pt native-audio validation.

---

## WS1: Sync Pipeline

### Charter (2026-09-19)
Sync pipeline: transcription (local Whisper + cloud), forced alignment, boundary
placement, the sync log. NR-6 sets product direction — see
[`operator-product-rulings-2026-09-19.md`](ws1-sync-pipeline/operator-product-rulings-2026-09-19.md):
cloud becomes the default engine, FA toggles are deleted, Whisper-only is a flagged
degraded state, local is savable as default once Whisper + at least one selected pack
is per-pack green. Both cache races below (`fa_shared.rs`, `whisper.rs`) are a Wave 1
prerequisite, not a someday item. D24 lives in this lane (re-filed 2026-09-19 from WS3
— it is a sync-behavior defect: silent FA→Whisper substitution, not an export/storage
one).

### In Progress
Phase 3 (Task 5); 3b/3c closed, 3d dormant. FA default toggle still OFF at read time ([faGate.ts:91](../src/services/faGate.ts)); CI installers compile `fa-inference` — see NR-1 / [`fa-wiring-audit.md`](architecture/fa-wiring-audit.md). NR-2's ON-by-default migration is superseded (NR-6) — do not implement it; the toggle is slated for deletion instead.
**END GOAL:** all Stage 1 lock gates satisfied — target state per NR-6 supersedes `FA_PROJECT_DEFAULT_ON` → ON — `docs/ws1-sync-pipeline/stage1-live-run-prep.md`

### Next Tasks
- [OPEN] Live acceptance run, owner verdict — `docs/ws1-sync-pipeline/stage1-live-run-prep.md`
- [OPEN] Flip `FA_PROJECT_DEFAULT_ON` once three preconditions met (two 12/12 ear passes, empty Zero-Defect Register, runtime-cost ruling) — [faGate.ts:91](../src/services/faGate.ts) — superseded in direction by NR-6 (toggle deletion), left open pending the toggle-removal implementation pass
- CLOSED (2026-09-19, mapping report §M3.11 / verification-sweep W7) — R.7 confidence-flag handling. Clauses 1–2 ship by other means: clause 1 via `CONF_MIN = 0.3` (`syncConstants.ts:536`, `fa.rs:416`, drift-guard `fa.rs:2156-2188`); clause 2 built and wired (`faAnchors.ts:319-333`, `faChunkPlan.ts:159`). Clause 3 retired: `CONF_MIN` has **no production consumer** implementing a skip-and-flag/force-split failure path — exhaustive grep (`verification-sweep-2026-09-18.md` W7, `grep -rnE "\bCONF_MIN\b" src/ src-tauri/src/ scripts/`, 57 hits, none a clause-3 consumer), not a restated assumption. Ratified per the V2 verdict rather than built as originally scoped.
- [OPEN · PARTLY CLOSED] Produce `fa-vocab-<lang>.json` files; wire `project.language`/`vocabChars` into both `computeFaChunkPlan` call sites — fixtures exist (`scripts/fixtures/fa-vocab-<lang>.json`, `scripts/fixtures/fa-cardinal-<lang>.json`, mapping report §M3.9); what remains open is the **runtime loader** — a production data path for the vocab/cardinal files plus a defined failure mode for a missing pack (no silent fallback, per NR-6's per-pack-readiness ruling).
- [OPEN] Task 2 — re-derive 50/50 silence-split rule in `snapBoundaries.ts` (breaks golden replay by design)
- [OPEN] Task 3 — stale-anchor scroll degradation test (code-read only today)
- [OPEN] Wire `FaEvent` to a UI progress consumer (none exists)
- [OPEN] Rule-stage fixture-backed regression (golden replay stops at `snapCoveredBoundaries`)
- CLOSED (FA wiring audit 2026-09-17, NR-1) — CI installers pass `-f fa-inference` (`.github/workflows/build.yml:424`); local plain `tauri:build` still omits FA unless `-f` — [`fa-wiring-audit.md`](architecture/fa-wiring-audit.md)
- [OPEN] Pillar 2 passive detector (4 rules, `MIN_IMPLIED_PRECISION = 0.50`) — `sync-pipeline-v2-plan.md` Part AK.2
- [OPEN] Sync log revamp (6 collapsible groups) — Part AK.3
- [OPEN] Phases 4–7 (Align&Select, Place, Finalize&Report restructure) — `sync-pipeline-v2-plan.md`
- [OPEN] Rule-stage propose/arbitrate rebuild (R.11/R.12 collision root cause)

### Rule register closures (2026-09-19, mapping report `final-shape-mapping-2026-09-18.md` §E1/E4/E5, table row "Formal closure")
These were never separate lines in this file's Next Tasks — they are Zero-Defect-Register
rule numbers formally closed by the mapping report's audit, recorded here so the closure
has a STATUS.md citation:
- **R.3 — CLOSED, RETIRE.** Not found as code; only `syncConstants.ts:126` records that R3's char-rate constants "are gone" (mapping report §E1).
- **R.8 — CLOSED, RETIRE.** Not found as runtime code — a fixture-tuning pass only (`syncConstants.ts:35`, `whisperService.ts:148`) (mapping report §E4).
- **R.9 — CLOSED, RETIRE.** Explicitly deleted, removed with `MAX_INTERPOLABLE_GAP` (`App.tsx:1120`) (mapping report §E5).
- **R.5 — CLOSED, CONFORMS.** Ships via excision at `faChunkPlan.ts:924` (detector at `:413`; prior docs' `:422` citation was the detector wrapper, not the excision — corrected here) (mapping report §E2).

### Open Bugs
- [OPEN · NON-BLOCKING] 5 Zero-Defect Register rows, no rule fix yet — `scripts/ws1-session-ak-step1-gate.ts:59`
- [OPEN · NON-BLOCKING] Alignment cost unbounded for real inputs (Contract A4, `__ALIGN_INSTRUMENT__` dormant)
- D24 CLOSED (Wave 1, `4e36080`) — Silent FA→Whisper substitution removed on the six typed fallback sites in `forcedAlignmentRun.ts` / `App.tsx`; preflight and silence-detect audit rows verified **non-substituting** (observational / continue-on-error only — see [`fa-wiring-audit.md`](architecture/fa-wiring-audit.md) STEP 3 annotations). Degraded paths are explicit (`degraded`, abort, or flagged ok-with-log); no successful sync that presents FA while committing Whisper timings from those sites.
- CLOSED (Wave 1, `5243e78`) — `fa-dev-digest-memo-reset-race` (Flake A): per-test digest memo namespacing / isolation in `fa_shared.rs` test harness.
- CLOSED (Wave 1, `c6c7428`) — `whisper-terminal-buffer-cap-eviction-race` (Flake B): terminal attach buffer test isolation in `whisper.rs`.

**Wave 1 formal close (2026-09-21, merge `e039c4d`, `ws1-wave1-hotfix` → `main`).** Six hotfixes plus a rebuilt end-to-end test layer closed the operator's manual-verification findings on top of the `ws1-wave1` landing: R.10-skipped placeholder gap (`a80cc74`), typed whisper model-not-found (`faf1d33`), late whole-run cancel abort-listener fix (`8e199d4`), FA victim re-timing (`18b3d5f`), infeasible-chunk serde snake_case fix (`1fd9c98`), fail-loud whisper model-failure modal (`fb51358`), and a real end-to-end FA-arm test (`0c85e6d`). The `applySyncCancelInvariant.test.ts` setProject-count invariant (stale at 3 after `18b3d5f`'s victim-pause branch) was found on first full-suite run and fixed pre-merge (`bb8b805`), not left open. Operator manual verification passed, including the new whisper fail-loud dialog — this is the acceptance gate per standing ruling. Canonical gate numbers from `main` at merge tip: `npm test` 4027 passed / 78 skipped / 0 failed; `cargo test` 449/0/5; `cargo test --features fa-inference` 536/0/35; `tsc --noEmit` / release build / `vite build` all clean.

### Open Bugs — Wave 2 queue (added at Wave 1 close, 2026-09-21)
- CLOSED (Wave 2, `ecc5f38` + `a4e2799`) — Settings model-status divergence — `whisper_model_status` checks storage-root only while `model_path` resolves 5 locations; dev builds mask a storage-root rename. Fold into the Wave 2 Settings Sync tab rebuild. Standing ruling reaffirmed 2026-09-21.
- CLOSED (Wave 2, `87607e4`) — Per-scene pre-flight gate (operator design) — script word-count vs. its audio window (~2-3 words/sec norm); impossible density (e.g. 100 words in a 10s window) warns BEFORE FA runs; warn-only, actionable copy. Sharpens the planned WPM + pre-FA coverage checks.

**Wave 2 landing (2026-09-27, merge `c895007`, `ws1-wave2` → `main`).** G1 content-hash spine + honest Apply Sync, G2 off-thread matcher + single-flight + ETA, G3 engine resolver + truthful settings, G4 language checks + pre-FA gates, G6 media vault, G5 cleanup + sync-log user view + bundle ingest, macOS metadata fix, Item A corruption fixes (`6dc650b`, `5bd893c`, `447dd62`), media workflow units 1–4. Operator acceptance: 2-item smoke (rename + Match) passed; the remaining four items of the 6-item media click protocol were **waived by operator ruling** — risk logged: any user-visible media-workflow bug surfacing later lands on a Wave 2 hotfix branch. Canonical gate numbers from `main` at merge tip: `npm test` 4422 passed / 78 skipped / 0 failed; `cargo test` 486/0/5; `cargo test --features fa-inference` 573/0/35; `tsc --noEmit` (≡ `npm run lint`) / release build with `fa-inference` (0 warnings) / `vite build` all clean.

### Open Bugs — added at Wave 2 landing (2026-09-27)
- [OPEN] Byte-deletion lifecycle — delete-then-undo destroys an asset's bytes at source; G6 imports write vault + IDB only (the native store lags until boot). Rescued today by the vault rung (`447dd62`) + boot migration. Source fix — defer byte deletion until undo history drops the step — is a deferred design change.

### Wave 3 mini-landing — 2026-09-30 (merge `88f2936`, `ws1-wave3` → `main`)
- **FOUND AND FIXED THIS SESSION (not counted open) — amount/currency normalization.** A written amount ("$11,000", "$9,400", "84,000") was unmatched (`canonicalize` read numbers above 9999 digit by digit and canonicalized each transcript token alone) and never sent to forced alignment (`normalizeForForcedAlignment` dropped every non-bare-integer token), so the neighbouring words were stretched over the amount's speech and cuts collapsed ~1.5s early on cloud transcripts. Fixed in `6612741` (amounts as words in all three normalizers — TS, Rust, Python — plus the `canonicalize` fix, guarded by a 41-case cross-implementation lockstep), `041e47d` (a cut is never derived from a scene's last MATCHED word when its tail words were never found; number tripwire; engine-switch boundary-delta finding; the <60% word-coverage finding is also persisted on the timing provenance) and `db80b04` (M4 plan-byte-equality net, direct-vs-batch equality, restart stability, U8 parity 98.4–100% within 100 ms on Spanish/173/V6). Operator click check passed 3/3. v6/173/Spanish chunk plans and their alignment cache keys are byte-identical to before; only plans whose script carries an amount re-key (one-time re-align, cents).
- CLOSED (2026-09-30, DISCARDED by operator ruling — closed, not parked) — head-word anchor extension for the 0.00-confidence stranded "you"/"the" words. The rule was too greedy: it re-anchored 213/312 v6, 48/142 173 and 3/4 Spanish anchors and failed 24 frozen tests (the R-U seam tests, the ear-verified R.11/R.12 production pins, the pinned chunk structure). Branch `ws1-wave3-anchor-extension-held` deleted at SHA `f1a3371a83fa90d51b1a684a7744cd2c19243d1c`; not merged, not to be resurrected.
- CLOSED (housekeeping landing, merge `bd4a3b6`) — Grammar coverage: (a) standalone `%`, `&`, `@` read as spoken words per language in all three normalizers and the matcher, the numeric tripwire covers them (`c389e18`, lockstep 41 → 59 with `4db7935`); (b) the matcher reads bare non-English integers in the detected language's words (`9726834`), with the Spanish golden re-baselined DELIBERATELY in `37d5bb0` (seg 1 duration 2.16 → 1.385 / endTime 8.21 → 7.435; seg 2 startTime 8.21 → 7.435 / duration 2.58 → 3.355; seg 3 tokenHash `d0ed247ed56cbc4b` → `7013c97908409587`; plus four conformance phrases and two test pins that had encoded the English-reading hole). M4 chunk plans byte-equal. A project whose script has bare non-English digits re-keys and shows one expected boundary-delta finding on its first re-sync.
- CLOSED (housekeeping landing) — Broken `cloud/` harness: `cloud/u8_gate.sh` runs the whole U8 parity gate in one command (plan → local FA under an isolated HOME → cache-hit-only cloud arm → compare → check against the recorded results); `build_chunk_plan.ts` is a CLI over `scripts/chunkPlanCorpora.ts`. Reproduced starts 99.60 / 99.58 / 98.40, ends 100.00 / 99.70 / 98.84 (`299b160`).
- CLOSED (housekeeping landing) — Orphaned-file projects: two live paths fixed (vault refs leaked on delete, `b6c8250`; shared store vs per-origin dashboard list, `17c9f2c`); a read-only scanner on the storage settings surface (`b10c99c`) and a two-phase crash-safe quarantine (`096a7dd`) are the standing net; the vault-ref drop is exported-first and reversible (`f9ab9ec`, `e68da55`). Dispositions executed with the operator's ruling: 43 refs dropped (manifests under `quarantine/vault-refs/`), 7 WS3 test-fixture records quarantined (sha256-verified), one blob left reclaimable (never auto-deleted); `7aae8238`, `9fcbdb83`, `2de45e28` were never on this machine. Scanner on the live origins: 0 findings. Note: two dead dev origins (last written 2026-09-08) still list five of the quarantined fixture ids on their own dashboards; those stores are not touched.
- [OPEN · NON-BLOCKING] Boundary-vs-FA-truth accuracy — Spanish seg-1/2: new cut 7.435 vs true word gap 7.70-8.04 (silence midpoint ~7.87); suspected transcript-token vs FA-word time divergence; pre-existing (old cut 8.21 also off-truth), exposed by B's improved matching.
- Open-count arithmetic: 37 (Wave 2 landing) + 4 (the four lines parked at the Wave 3 landing) = 41/40 (over the cap) → 40 (fold: the two grammar-gap lines merged per operator ruling, `f1393f5`) → 39 (harness closed) → 38 (orphans closed) → 37 (grammar closed) → +1 (boundary-vs-FA-truth accuracy, above) = **38/40 — back under the cap**. The Wave 3 cap breach is resolved.

### Wave 3 close — 2026-09-30 (merge `d90c6fd`, `ws1-wave3-media-unify` → `main`, v1.1.0)
**WAVE 3 CLOSED at `d90c6fd` / v1.1.0.** Cloud sync arc delivered (gateway + auth, Opus staging + two-stage cache, sync-intent pipeline, hour cap, engine picker, bulk queue + persistence, media unification + hardening), amount/currency normalization fix, U8 parity recorded (98.4–100% within 100 ms), housekeeping (scanner, quarantine, one-command U8 gate `cloud/u8_gate.sh`).

What landed (grouped commits stand, operator ruling): **Phase A** — one always-visible Media block, spine-only Build Timeline gate reversing U4.6's four-slot rule and reconciled with the U4.5 sync intent (which never waited on media), the wand filling unbound scenes with a visible summary, delete leaving honest placeholders without bleed (`722d437`, `889109e`). **Phase B** — manual (drag-assigned) picks authoritative with "N manual picks kept" (`198bfef`), typed per-asset states and corrupt handling (`bb6fd55`), Bulk Projects spine-gating (`14dd21e`), regression net. **Operator-directed** — slot chevron/collapse, one import menu, folder drops (`75b8ef3`, `e3428e5`), scrollbar width (`1112105`, `e3428e5`), `dragDropEnabled: false` (`d531838`), video thumbnails (`339b110`), sync-log icons/clear/dot (`2d8ea24`, `cb0cfd9`, `8bdcc69`). Zero sync-math changes: M4 chunk plans byte-equal, golden replay green. Gates from `main` at the merge commit: `npm test` 4911 passed / 78 skipped; `cargo test` 514; `cargo test --features fa-inference` 601; release build with `fa-inference` 0 warnings; `tsc`, `vite build`, `pytest cloud` 51 clean.

**FOUND AND FIXED — recorded here in prose, outside the open count** (the count is the open-work ledger, amount-defect precedent — not a bug total):
- Delete-all-media never released its media-vault references, pinning every blob against reclaim (`f26d95f`; both delete paths now share `vaultHashesToUnreference`; blobs read as reclaimable only, never auto-deleted).
- The Media block leaked one blob URL per video thumbnail, never revoked (`9e9dea8`, wiring-scan follow-up `eae8e15`).
- Tauri's native drag-drop handler was on: wry's macOS handler claims every drag and never forwards it to WebKit, so no HTML5 dragenter/dragover/drop reached the page — Media tile → segment, Finder file drops on the slots and folder drops were all dead in the real window while jsdom tests stayed green (`d531838`, `dragDropEnabled: false`, guarded by `tauriDragDropConfig.test.ts`). v1.0.0 has this defect.
- Video tiles stayed a film-strip icon: in-flight thumbnail results were dropped when `rows` changed and never re-requested (`339b110`; thumbnails now key off the stored `contentHash`; a failed generation is "corrupt" only when the vault registry knows the blob).
- Also in this landing: a deleted asset's tagged scene was fuzzy-matched from its spoken text on the next import (the "bleed"); tagged scenes are now flagged `unmatchedExplicitTag` on delete (`889109e`).

**Rulings embedded:** (1) the sync-log clear behaviour stays honest — the status card is driven by CURRENT state, so clearing the log empties entries only and must never repaint an offline file green (`2d8ea24`); (2) the defects above are prose, not open lines; (3) grouped commit granularity stands; (4) version 1.1.0.

**Testing note:** real-window drag-and-drop changes need a manual check — jsdom fabricates its DragEvents and cannot catch the Tauri-drag class of defect above.

- [OPEN · NON-BLOCKING] Manual binding markers are not carried across a full re-sync — drag-assign a tile onto a scene, then re-sync, and the binding is re-derived from tags (`assetAssignedBy: 'manual'` is set by drag-to-assign and honoured by the wand, but a full re-sync rebuilds segments from the scene doc).
- [OPEN · LONG-TERM BACKLOG] Spot re-sync — deferred by operator ruling at Wave 3 close.
- Parked at Wave 3 close: spot re-sync, the manual-marker re-sync gap, boundary-vs-FA-truth accuracy (open line above), signing credentials, stale WebKit origins sweep. Next arc: SaaS design session, per operator.
- Open-count arithmetic: 38 (housekeeping landing) → +1 (manual binding markers not carried across a full re-sync) → +1 (spot re-sync, long-term backlog) = **40/40 — AT CAP, not over**.

### v1.1.1 hotfix — media-vault registry corruption (merge `85f515e`, `ws1-registry-lock` → `main`)
A team member's imports all failed ("0 imported, N failed") with `media-vault: parse …/registry.json: trailing characters at line 43460 column 4` in Storage settings. Root cause, pinned by red tests on `75f4b01` before any fix: every registry mutation was an unsynchronized load → modify → save, and every write went through `atomic_stage::write_bytes_atomic`, whose temp path was one shared fixed `registry.json.part`. Two concurrent writers each opened (truncating) that one file and wrote from their own offset 0; the shorter document overwrote the head of the longer, leaving one complete document followed by the other's tail — exactly serde_json's "trailing characters" — or the loser's rename failed outright (1,584 mutations failed in the first red stress run on `75f4b01`). `load_registry` then correctly refused a corrupt file, and with no recovery path every import bricked.

What landed: **serialize** — every registry mutation routes through one gate (in-process mutex, then an OS advisory lock on `media-vault/.registry.lock`, released by the OS on process death; covers two app instances on one root), and import re-checks its blob under the gate so a reclaim between the two import phases can no longer leave an entry with no blob. **Isolate** — unique per-write temp names, fsync of the file and (Unix) its directory before/after the atomic rename. **Self-heal** — the loader is a ladder, every rung loud: strict parse → salvage the first complete JSON document (the reported field shape, zero loss) → parse-verified `registry.json.lastgood` → quarantine + rebuild from blobs and project records. Each recovery keeps the replaced bytes under `quarantine/vault-registry-<sha16>/` (two-phase, `MANIFEST.json`), persists a typed `vault-registry-recovered` finding before replacing the registry, runs at launch, and surfaces as sync-log attention kind 11 (amber, dismissible = acknowledged) and in Storage settings. The consistency scanner gained registry-parseability and registry-vs-blob findings (read-only; it reports a damaged registry, never repairs it). Zero sync-math changes.

**FOUND AND FIXED — recorded here in prose, outside the open count** (amount-defect precedent). The caller audit of every atomic-write site found the same shared-temp class in five more places, each fixed with its own red-first test: `asset_store.rs` (`write_atomic_bytes`, `copy_atomic_with_hash`; temp = pid + millisecond), `project_mirror.rs` (same), `storage_root.rs` (the `storage-root.json` pointer; temp = pid only), the vault thumbnail staging (`<hash>.thumb.jpg.part`, shared by concurrent generations), and model import (`models.rs` staged into `<target>.part` — the resumable download's own file, so an import could delete or promote a download's partial bytes). Quarantine's manifest/copy/ref-drop writes moved to unique temps too. Audited and deliberately unchanged: `cloud_gateway.rs` and `fa.rs` (already uuid temps), `model_download.rs` (in-flight registry serializes the `.part`), `ffmpeg.rs` `export_state.json.tmp` and `session_claim.rs` (one writer per session directory by the claim protocol; recovery addresses the fixed temp name by design).

Gates from `main`: `npm test` 4918 passed / 78 skipped (baseline 4911); `cargo test` 547 (514); `cargo test --features fa-inference` 634 (601); release build with `fa-inference` 0 warnings; `tsc`, `vite build`, `pytest cloud` 51 clean; consistency scan of the real root 0 findings. Proofs retained as tests: 8 threads × 200 mutations with exact final reference sets, a 10,000-mutation soak, a two-process contention test (verified to fail with the OS lock disabled), crash injection at every recovery phase boundary. Release 1.1.1.
- Open-count arithmetic: 40 (Wave 3 close) → **40/40, unchanged** — no new open line; the defects above are closed in this landing.

### Registry follow-up — 1.2.0 (merge `f962d23`, `ws1-registry-relocation` → `main`)
Two follow-ups to the v1.1.1 registry-corruption fix, both operator-directed. No installer rebuild; folds into 1.2.0. Zero sync-math changes.

**Open-line trail (honest arithmetic).** 40/40 at v1.1.1 → **+1** *storage-root relocation races the registry gate* (lost-update class; each registry write is whole-file atomic, so it loses an update but never corrupts the file) = **41/40, a one-line breach of the cap** → **CLOSED** in the same edit by the Unit 1 commit `97df04e` → **40/40**, breach resolved. Net zero; recorded rather than skipped because the line was real for the time it was open.

**Unit 1 — relocation gate (`97df04e`, red test `70ff316`).** Relocation copied `media-vault/` and later switched the storage pointer without touching the registry gate, so a registry mutation landing in the OLD root between the copy and the switch reported success and was read by nobody afterwards. Pinned red-first on `0e84091` with a real-file test that fires an import from inside the pointer-commit step. The gate is now taken before the vault subtree is copied and held through verify, the pointer switch and the retirement of the old root; a command that resolved the old root before the switch is refused loudly (nothing staged, nothing written) instead of writing to an abandoned root; cancel or any failure drops the gate and leaves the old root authoritative and writable; relocating back un-retires a root. Two-phase crash-safety unchanged. Cost: registry mutations wait while the vault copy runs (other subtrees copy without the gate).

**Unit 2 — recovery notice scoping (`8b44253`).** The media-library recovery surface is no longer an eleventh sync-log category: the sync-log user view is back to its ten run-scoped kinds, pinned by a test. The recovery is an event-scoped, dismissible launch notice that shows only while the persisted finding is unacknowledged (dismissing acknowledges it durably); Storage settings' "Media library repairs" block remains the durable record.

**Noticed, not changed.** Relocating back into a root that still holds a stale earlier copy fails verification when the stale copy has files the source lacks (pre-existing behaviour of the copy-verify flow, unrelated to the registry); not added to the count.

### v1.2.0 — bulk finish, one container, hide-never-close drawer (merge `08f1bd7`, `ws1-bulk-queue` → `main`, release `246e4d0`)
Landed unverified, per operator instruction: the operator verifies on the built 1.2.0, and distribution is the gate. Fix-forward is 1.2.1. Zero sync-math changes (chunk-plan M4 and golden replay green on the branch before the merge).

What landed (`edf917b`, branch merge of `origin/main` at `fe91035` / `cf8157e`): row 2's finish adopts the cached transcript by the batch language key and force-starts only on a lookup miss; a transcription finish owns is not cancelled by the project switch. A paused intent releases the held GPU container before and while the dialog is up, and a transcribe-to-align gap over 10 seconds warns (`HOLD_FOR_PLAN_SEC` stays 30). `gpu_boot_allowed` refuses a boot for a lookup, a handoff, or a second container (`max_containers=1`, `buffer_containers=0`). Each bulk row checkpoints `staged → transcript-cached → aligned → built`; retry is a free cache lookup; a content re-key resets. Reveal persists word timings, provenance, plan hash, and alignment key; an unchanged hash serves locally. The billing report prints per-row lines and a boot-unused total. The bulk window is a drawer that hides and never closes: no overlay, the editor stays usable, and each row has stage chips, retry, and open.

**FOUND AND FIXED — recorded here in prose, outside the open count** (amount-defect precedent):
- The second project in a bulk batch timed out with "its transcript is not ready" while that transcript was already `cached: true` on the gateway. Finish was a passive 90-second poll of `transcriptionReady`; bulk auto-fire suppression never started the editor's own transcription.
- The shared whisper instance was cancelled by the project switch before the row's adopt could commit tokens.
- A peek under `auto` missed a transcript the batch had stored under `en`.
- An operator prompt between transcribe and align left the GPU container holding for the full 30-second window.
- A submission that a live container could serve booted a second container that did no work (`boot-unused`).

- Open-count arithmetic: 40 (registry follow-up) → **40/40, unchanged** — no new open line; the defects above are closed in this landing.

### v1.2.1 — bulk drawer layering fix-forward (`ws1-drawer-layering` → `main`, release `2686eae`)
**1.2.0 was held from distribution by the operator and is superseded by 1.2.1; its installers are not to be distributed.** Zero sync-math changes (chunk-plan M4 and golden replay unaffected).

**FOUND AND FIXED — recorded here in prose, outside the open count** (amount-defect precedent):
- **The bulk drawer was invisible over the dashboard.** `BulkProjectsModal` painted at `z-[40]`; `ProjectDashboard` is `fixed inset-0 z-[200]`, so in the real window the bulk entry point opened a drawer that sat entirely underneath the page (DOM said open, `elementFromPoint` at the drawer's position returned the dashboard). This is a jsdom-blind paint class — the same family as the Tauri drag-and-drop defect — caught by running the real page, not by any test. Fixed in `94541c6`: one named overlay scale (`overlayLayers.ts`) now owns every overlay-level z value — editor controls 60 < review 150 < dashboard 200 < **drawer 201** < modals 205 (the nine former z-200 overlays) < app settings 210 < relocation 220 < popups 300 < banners 400 < blockers 500 < dialogs 600 < fullscreen preview 5000 < dev panel — pinned by a source-scan test that also forbids a raw overlay `z-[N]`. The audit also found the preview stage's floating controls at `z-[1001]`, which would have painted over the drawer in the editor; they are now on the scale at 60. The dashboard lifts itself to the modal layer while its own delete dialog is open (that dialog lives inside the dashboard's stacking context). Real-browser reference: `elementFromPoint` over the drawer returns the drawer, and a modal opened over it covers it; final proof is the operator's real-window pass.
- **No way back to the drawer from the editor** — opening a row's project hides the drawer, and the only reopen door was the dashboard button. `b54c445` adds a slim right-edge handle with the batch's project count, present in the editor while a batch exists and the drawer is closed, through the same open logic as the dashboard's "Bulk builds (n)" (one `openBulkDrawer`).

**Known, not changed:** the dashboard's profile-menu dropdown is part of the dashboard page, so it sits under the drawer while the drawer is open (hide the drawer to use it).
- Open-count arithmetic: 40 (v1.2.0) → **40/40, unchanged** — no new open line; both defects are closed in this landing.

### v1.2.2 — bulk stabilization (`ws1-bulk-stabilize` → `main`)
**1.2.1 was held from distribution by the operator (real-window verification failed) and is superseded by 1.2.2; its installers are not to be distributed.** Surgical stabilization only — no new UX that the operator's planned bulk workflow (pending, delivered separately) would replace; the interim finishing behaviour below is superseded by that workflow when it lands. Zero sync-math changes (chunk-plan M4 and golden replay green).

**FOUND AND FIXED — recorded here in prose, outside the open count** (amount-defect precedent):
- **TOP SEVERITY — bulk finish cross-wrote every row with row 1's content.** Operator repro: a 3-row batch, every stage cloud-cached; after Build Timeline all three project records held project 1's script, scene doc, voiceover, segments and spine. Cause, pinned with runtime evidence on the real finish path (real `App`, real finalizer — `App.bulkFinishOwnership.test.tsx`: finishing row B hashed "script A" / "scene A" into B's spine and persisted A's voiceover as B's asset): bulk finish switches project → project INSIDE the editor, so `DropZonePanel` never unmounted between rows; its staged-slot restore saw a non-empty set — the previous row's — and skipped the new project's own rows ("never clobber"), so Build Timeline read row 1's files for rows 2 and 3. None of the suspects listed for tracing (cancel-ownership, the ready ref, checkpoints keyed by index) was the cause. Fixed in `09aaf23`: the panel drops the previous project's set (in memory only) on a project change before restoring the new one; staged files carry their owner id and Apply Sync refuses a set staged for another project; finish readiness requires it. Same commit: `adoptCachedTranscript` read the post-render `projectRef`, which still named the outgoing project right after the switch, so the cache hit was never adopted and finish always force-started a transcription. Blast radius audited: the foreign voiceover/media were persisted into the victim's asset store (IndexedDB; native/vault copies follow through boot migration); the victim's staged store stayed its own (no reconcile ran under the foreign set on the finish path); mirrors and backups carry the corrupted record until it is rewritten.
- **Repair + standing guard (`ebf4b51`, wired in `c9278cf`).** Each bulk record is proven against its OWN staged script / scene doc / voiceover (the hashes Apply Sync stamps into `lastSyncSpine`); a mismatch is reset to its pre-build state (timeline/transcript fields cleared; the build-added assets dropped from the record, its asset stores and its own vault refs; its own bundle media kept) and re-queued to rebuild from its own files — transcript and alignment are gateway cache hits, ~$0. It never reads or copies another record. Runs at boot over the batch's built rows and after every finish. **Not run on the operator's three projects from this machine:** this machine's project registry is empty (the records live on the operator's machine); the guard runs there on the first boot of 1.2.2 if those rows are still in the batch. A record whose own staged files are gone (or whose batch row was cleared) is reported unverifiable and left untouched.
- **Mid-run reopen routed to create-new.** Closing the drawer mid-run and pressing the dashboard's bulk button asked for a NEW batch quantity: the dashboard showed two doors ("Bulk Projects" → count prompt, and "Bulk builds (n)"). Now one door: with a batch it is "View batch (n)" and opens THAT batch with live progress; "New batch" lives inside the drawer; with no batch it creates as before (`c9278cf`). The editor handle's reopen is unchanged.
- **Finish focus chaos.** Rows auto-opened one over another under the operator. Interim rule (`c9278cf`): rows finish one at a time; after each, the app returns to where the operator was unless they opened something since (a navigation mid-finish makes the finisher yield); an operator actively editing (input in the last 20 s, or a sync running) is never flipped away — the row reads "Ready — one click to finish" and its own Open finishes it. True background finishing (Build Timeline without the editor) stays PARKED for the operator's planned workflow. 20-run × 3 distinct cached rows stability on the finish path is pinned in jsdom; jsdom cannot prove finish order in the real window (DnD ruling) — the operator's real-window pass is the final proof.
- Open-count arithmetic: 40 (v1.2.1) → **40/40, unchanged** — no new open line; every defect above is closed in this landing.

### v1.3.0 — bulk pipeline + bulk UI (`ws1-bulk2-landing` → `main`)
**Supersedes the 1.2.2 interim finishing UX** (one-at-a-time finishing inside the editor, "Ready — one click to finish"). Two branches merged with `--no-ff` (never rebased) and wired together. Zero sync-math changes. The finish pipeline was extracted, not rewritten, and a golden test pins background finish byte-identical to the editor path.

**What landed:**
- **Background pipeline (`ws1-bulk2-pipeline`, `7d32a9c`…`522df5a`).** A bulk row's timeline is built by the extracted `runFinishPipeline` without opening the editor: no project switch, no screen change. Checkpoints `staged → transcript-cached → aligned → built → ready` persist, so a crash between stages resumes from the last one for free. The 1.2.2 owner-id refusal and record guard stay in force.
- **Bulk UI (`ws1-bulk2-ui`, `dbf74b0`…`2c4b919`).** Groups: a name, a collapse toggle, 2–30 rows each, at most 10 groups; a saved pre-1.3.0 batch becomes one default group. The drawer is on the LEFT edge. Group headers show a progress ring, "n/m done" and a red dot with the failed count. "Create Projects" (2–30) lives inside the drawer, and the dashboard button only ever opens the drawer. Each row has four slots (media marked Optional), one Upload menu ("Files & zips…" / "Folder…") and mixed drag-and-drop. Expanding a row lets you replace or delete each file, or replace or delete all of them; files are staged under their own row's id. Per-row delete sits behind a confirm (a created row's project is deleted with it, through the dashboard's own delete, now shared as `projectDelete.ts`), and each group has its own "Clear finished". Nothing clears by itself, and draft rows survive a restart. The dashboard button carries a ring plus "n/m" while running and a red dot plus count on failures. The toast reads "*Name* ready" and never auto-opens anything.

**Wiring (this landing):**
- **Pipeline → drawer.** A row runs Build Timeline → cloud → background finish → "Ready" with Open enabled, even while the drawer is hidden, and nothing navigates (`a5be2b6`, pinned in `BulkProjectsModal.test.tsx`).
- **Build Timeline flips rows onto the dashboard.** An unbuilt row is a drawer draft with no project record, so it never reaches the grid. Build Timeline creates the record, and that is the flip. The UI branch's interim filter, which hid created-but-unfinished bulk projects from the grid, is removed. The grid also re-reads records when a row turns ready, so the built scene count shows without a reload (`a5be2b6`).

**FOUND AND FIXED — recorded here in prose, outside the open count:**
- **The storage scanner read unbuilt bulk rows as orphaned data.** A draft row's bundle media and vault refs sit on disk under its id with no project record until Build Timeline, so the consistency scan reported them as "Files belonging to … remain, but the project itself is gone". Quarantine re-runs that scan, so it could have moved them. Both now take the unbuilt bulk row ids (`pendingIds`) and treat those rows as normal. A tombstoned id is never excused (`a4a4a77`; Rust tests in `storage_consistency.rs` and `storage_quarantine.rs`).
- Open-count arithmetic: 40 (v1.2.2) → **40/40, unchanged** — no new open line; the defect above is closed in this landing.

### v1.3.1 — bulk media fix, drawer docking, sync-log parity (`ws1-bulk-media-fix` → `main`)
**FOUND AND FIXED — recorded here in prose, outside the open count:**
- **Bulk builds saved no media (`4749263`).** Operator repro on 1.3.0: every slot read green in the drawer, the cloud work and finish ran clean, but an opened project had none of its media, staged or committed; re-adding the files and syncing with the wand brought them in. Cause: the extracted finish pipeline (`finishPipeline.ts`) committed only the script, scene doc and voiceover; the editor's media step (staged media files and zips into the project's assets) was never part of it, so both of its callers — the background finalizer and the wand on a bulk project — dropped the media. Fix: the editor's media step is now ONE function (`persistStagedMedia`, `App.tsx`), used by the editor's own Build Timeline and passed to the pipeline as a REQUIRED step from both call sites (a call without it does not compile; a source test pins both sites). Projects built on 1.3.0 are not repaired retroactively: re-add their media (or rebuild the row).
- Open-count arithmetic: 40 (v1.3.0) → **40/40, unchanged** — the defect above is closed in this landing.

**Also landed (operator-directed):**
- **Dashboard bulk button** keeps its ring and "n/m" after a batch finishes, until the batch is cleared (`e6d1576`).
- **Drawer workflow (`2317baa`).** "Create Group" is inline (a 2–30 field and one button; the count popup is gone), groups rename in place, every group has its own Build Timeline (the bottom bar is gone), and at most 5 groups exist at a time.
- **Drawer restyle and docking (`360bc3f`).**
  - The panel uses the dashboard's neutral palette, and each group sits in its own box.
  - A row reads name / Open / Upload, then one line of chips (Script · Scenes · Audio · Media, with type icons), then "N files", then ONE fixed-height message line with prev/next arrows and the bin.
  - The file list is four rows. Media replaces or deletes only the media (a bundle zip replaces every slot; the copy says so) and has its own collapsible per-file list.
  - The panel stays open across a reload. At 900px and wider it docks as the dashboard's left column: fixed-width cards, a translate-only FLIP glide on the panel's curve, and no background flash. Narrower windows and the editor keep the overlay.
- **Built rows keep their cost and files (`663ee99`).** The batch record keeps each row's cloud worker-seconds and a names-only file summary saved at Build Timeline, so a reload no longer shows "0 files" with no cost. Rows built before this fall back to their staged files; their cost was never recorded.
- **Sync-log parity, report only (`e377d71`).** A bulk build wrote only the one-line run summary. It now writes the editor's own report entries, from the editor's builders in the editor's order, plus a "Cloud billing (bulk build): …" line. No timing changes.

**Pending architect decision (not in this landing):** the bulk pipeline is a separate, shorter implementation of Build Timeline. It does not run several of the editor's steps that come after alignment:
- the R.5–R.13 rule corrections and victim re-timing;
- absorbed-gap and placeholder skip handling;
- automatic media matching;
- carrying effects forward and restoring locks;
- the engine boundary-delta check;
- stamping findings onto the timing provenance.

The same files can therefore yield a different timeline in bulk than in the editor. The operator's requirement is one Build Timeline (the editor's) run for each bulk row; the options were handed to the architect.

Gates on the branch before the merge: `tsc` clean; `npm test` 5022 passed / 78 skipped (baseline 5011); `cargo test` 554; `vite build` OK; `pytest cloud` 53. Re-run from `main` after the `--no-ff` merge.

### v1.3.2 — operator 1.3.1 bulk follow-ups (`ws1-bulk-fixes` → `main`)
**FOUND AND FIXED — recorded here in prose, outside the open count:**
- **Catch-all `inference-failed` dropped the gateway's real error.** A failing cloud call now carries a typed kind plus the server message verbatim into the row, the pause record, and the project's sync log (`cloudFailureReport`; paused batch rows show `detail`, not only the bucket).
- **Built-at-Create locked files too early.** Rename/replace/delete stay allowed until the first successful finish (`sealed`); a content-key change starts over, unchanged Retry resumes the checkpoint.
- **Opening a failed bulk project showed no staged files.** DropZone now publishes the IndexedDB restore *before* awaiting voiceover adoption, so a cancelled adopt (callback churn on open) cannot blank the panel.
- **Dashboard cards for paused/failed bulk rows looked like empty 0-scene projects.** They now show **Paused** / **Build failed**. Rows still appear the moment Build Timeline creates the record.
- Open-count arithmetic: 40 (v1.3.1) → **40/40, unchanged**.

**Also landed:**
- Fixed-height status line is clickable: a popover shows full status, cost, and the real error.
- Stage chips live only in the expanded file detail (collapsed rows one height).
- Footer uses "1 project", and billed seconds on failed rows (never "no cloud GPU time used" while a row shows cost). Open is enabled wherever a project record exists (paused/failed included).

**PARKED (F4 — do not polish doomed code):** cache-hit finish wall time on the extracted bulk pipeline, unit-measured with instant seams: persistVoiceover ~0.05ms, persistMedia ~0.02ms, parse ~0.05ms, lookupTranscript ~0.02ms, runFa ~0.04ms, alignFromCache ~0.08ms, **total ~4.6ms** (the rest is hashing/snap/save in `finishPipeline.ts`). Operator-perceived slowness on a real cache-hit row lives in this bulk-only pipeline, which the upcoming unify merge deletes. No production polish this landing.

Gates on the branch before the merge: `tsc` clean; `npm test` 5034 passed / 78 skipped (baseline 5022); `cargo test` 554; `vite build` OK; `pytest cloud` 53; chunkPlanM4 + golden replay included in `npm test`. Re-run from `main` after the `--no-ff` merge.

### v1.4.0 — unify Build Timeline (`ws1-unify-build`)
**FOUND AND FIXED — recorded here in prose, outside the open count:**
- **Import-path slowness.** Measured before the fix: JSZip `loadAsync` ran on the JS thread (the freeze), SHA-256 hashed each file on the main thread, and each vault write did its own dir-fsync. After: hash/zip off-thread, one dir-fsync per import batch, live Adding… n-of-m, voiceover add returns without awaiting Opus encode/upload. Speed-guard tests cover a 100MB zip and instant VO add.
- **Bulk builds skipped the editor's post-alignment steps.** `runFinishPipeline` never ran autoMatch, effect carry-forward, lock restore, skip placeholders, or R.11–R.15. Editor and bulk now call `runBuildTimeline`; `runFinishPipeline` is deleted. A no-difference gate runs the 14-segment amount fixture and an autoMatch+locked-scenes fixture through both doors.
- Open-count arithmetic: 40 (v1.3.2) → **40/40, unchanged**.

**Also landed:** Rebuild on a done bulk row re-runs the shared service (cache hits, ~$0). Cached-row finish wall time is the same pipeline as the editor (see F4 measurement in `finishPipeline.test.ts`). Window title and manifests read 1.4.0.

Gates: `tsc` clean; `npm test` 5046 passed / 78 skipped (baseline 5034); `cargo test` 556; `cargo test --features fa-inference` 643; `vite build` OK; `pytest cloud` 53; chunkPlanM4 14/14 + golden replay 6/6 included in `npm test`. Cached-row finish (F4, injected cache-hit seams): persistVoiceover 0.11ms, persistMedia 0.09ms, parse 0.12ms, lookup 0.06ms, runFa 0.11ms, alignFromCache 0.23ms, **total 29ms**. Import freeze was JSZip `loadAsync` 1.3–1.7s for 100MiB plus serial SHA-256; per-file dir-fsync ~45ms/file.

### Deferred Tasks
- [DEFERRED · ASR ENGINE LIMITATION] Row 52 ("Llívia") — Whisper never transcribed isolated token; owner ruling 2026-09-03
- [DEFERRED] Bounded-memory options for residual OOM (capped `FaModelCache` or process isolation) — pending owner call
- [DEFERRED] Full standing-constraints list — `sync-pipeline-v2-plan.md` Part AK.1

---

## WS2: Editing Pipeline

### Charter (2026-09-19)
WS2 = timeline, editor, preview, storage. **The storage contract is FROZEN.** Future
render-engine tenants (the WS3 wholesale replacement — see WS3 Charter below) conform
to the existing storage contract (`storage_root.rs`'s `MANAGED_RELOCATION_SUBTREES`,
`docs/ws3-export-pipeline/architecture-ledger.md`'s Round 29 contract table); they never
extend it. A new render engine that needs a new persisted subtree is a signal to revisit
this freeze explicitly, not to add a subtree silently.

### In Progress
(none)
**END GOAL:** (none active — next work is Transcription Req 2)

### Next Tasks
- [OPEN · BLOCKED] Transcription Req 2: incremental draft save — blocked on Rust `WhisperEvent` partial-token IPC ([whisper.rs:572](../src-tauri/src/whisper.rs), [whisper.rs:632](../src-tauri/src/whisper.rs))
- [OPEN] Raw IPC for ffmpeg probes — base64 IPC at [tauriFfmpeg.ts:45](../src/services/tauriFfmpeg.ts); duplicated [App.tsx:3168](../src/App.tsx)

### Open Bugs
(none)

### Deferred Tasks
- [DEFERRED] Non-English Localization & C3 Policy — French cardinal/elision rules, C3 fixture ceiling beyond 1,998
- [DEFERRED] Video Engine — 120fps preview buffer byte-capping, native asset export frame rates

---

## WS3: Export & Storage Pipeline

### Charter (2026-09-19)
WS3 becomes **export-only**, carrying one standing task: the render engine is replaced
wholesale per `docs/architecture/saas-target-architecture.md`'s reliability model
(out-of-process render/export). Incremental work on the current in-process WebCodecs
pipeline is abandoned as a strategy — see
[`pipeline-audit-round28.md`](ws3-export-pipeline/pipeline-audit-round28.md) for why: it
is crash-**tolerant** at best (a GL context loss is terminal for the whole piece's worker,
not gracefully rotated — `pipeline-audit-round28.md` §4, `exportWorker.ts:1993-1999`),
never crash-**immune**, because the render/encode work runs in-process (a Worker, not an
OS subprocess). Out-of-process encode is the only real crash immunity available — a
subprocess crash or GPU driver reset is detectable and retryable from outside, the way an
in-process Worker's context loss is not. GPU context loss is fatal to the current
architecture on Windows the same way it is elsewhere; the target architecture's reliability
model addresses this by running render/export "out of process from the main application,
so a GPU driver reset kills a subprocess... rather than taking the whole interface down
with it" (`saas-target-architecture.md` "Reliability model").

**Absorbed into this charter** (orphans and a log-line gap, not separately actioned this
pass):
- `ExportFinishShortfallCard` (verified exact name in tree: `src/components/recovery/ExportFinishShortfallCard.tsx` — the task brief's "ExportFinishShortcard" was a shorthand) — stays unwired pending the frame-accounting producer (Ruling D), tracked below; superseded in relevance by the wholesale render-engine replacement rather than closed.
- `IdbToNativeMigrationView` (`src/components/recovery/IdbToNativeMigrationView.tsx`) — zero render call sites, scope/integration point unknown; same disposition, absorbed rather than separately scheduled.
- D9's encoder-rotation log-line gap (`ExportLogPhase` has no `'session-rotate'` phase — `exportDiagnosticLog.ts:37-44`, `pipeline-audit-round28.md` §5) — a diagnostics gap in a pipeline being replaced wholesale, not worth instrumenting on its own.

### In Progress
Round 28 hardware findings (build `831c872`, branch `ws3-export-integration`) assigned to CC — see Open Bugs D1–D2, D4–D9.
**END GOAL:** Round 28 open bugs closed; remaining `windows-validation.md` hardware rows (W1–W24, E1–E12, W25–W30) executed on Machine 1.

### Next Tasks
- [OPEN] Complete remaining `windows-validation.md` hardware rows — nine Round 27 smoke checks recorded @ `831c872`; W23 partial (retention pass, resume fail); W25–W30 added Round 29 (storage-root relocation cross-platform audit) — `docs/ws3-export-pipeline/windows-validation.md`
- [OPEN] Append-path batching (`af6a300`) — 100:1 IPC batching shipped; no post-fix export run, throughput claim is call-count arithmetic only — `docs/archive/ws3/append-path-audit.md`
- [OPEN] Part C 500-segment export — intermittent multi-second silent gaps (1/3 live runs 2026-09-07, longest 10.74s); root cause not isolated — `docs/ws3-export-pipeline/silent-gaps-diagnosis.md`
- CLOSED (2026-09-19, RETIRED AS MOOT) — D23, false "Timeline modified" on an unmodified project whose assets were imported via the zip-based bulk import path (`extractZipToAssets`, [App.tsx:479](../src/App.tsx)), which never sets `Asset.addedAt` — the timeline-hash fallback the fix relies on has nothing to fall back to for these assets. **Consumer report (2026-09-19, T4, `383569d`):** every real consumer of `sourceTimelineHash`/`buildSourceTimelineHash`/`timelineIdentityFromProject` is part of the same checkpoint/resume/reexport-check mechanism — [`exportCheckpointWriter.ts:162,178,213,232`](../src/services/webcodecsExport/exportCheckpointWriter.ts), [`exportResumeSession.ts:121`](../src/services/webcodecsExport/exportResumeSession.ts), [`exportReexportCheck.ts:105-109`](../src/services/webcodecsExport/exportReexportCheck.ts) (the reexport-offer check D23 actually hits), [`exportPipelineWebCodecs.ts:3138-3140`](../src/services/webcodecsExport/exportPipelineWebCodecs.ts). `ffmpeg.rs:2822,2859` is test-fixture-only, not a real consumer — checkpoint invalidation is the only consumer. **Operator ruling (2026-09-19, recorded verbatim):** "D23 is RETIRED AS MOOT per the STATUS.md:139 recommendation — timeline-hash instability is superseded by the wholesale export-engine replacement; fixing it would be work under a rewrite." Signature: `docs/ws1-sync-pipeline/baseline-clean-declaration-2026-09-19.md`. **Cap arithmetic: 41 − 1 (D23) = 40, at cap.**

### Open Bugs
- CLOSED (WS3 Batch 2, 3A) — `StorageRootRelocationView` now mounted from `App.tsx` as the modal target for `StorageSettingsSection`'s "Move storage root…", fed via a new `useStorageRootRelocation` hook — [App.tsx](../src/App.tsx), [useStorageRootRelocation.ts](../src/hooks/useStorageRootRelocation.ts).
- [OPEN · BLOCKED ON D7 FRAME ACCOUNTING] `ExportFinishShortfallCard` exported ([recovery/index.ts:29-32](../src/components/recovery/index.ts)) but deliberately not rendered — owner ruling (WS3 Batch 2, Ruling D): wiring it needs a `producedFrames`/`expectedFrames` producer, which does not exist anywhere in `src/` and is explicitly out of scope this batch (collides with D7's own frame-accounting work, `ExportLivenessSnapshot.framesEncodedCumulative` — [exportPipeline.ts](../src/services/exportPipeline.ts)). Do not wire without that producer.
- [OPEN · NON-BLOCKING] `IdbToNativeMigrationView` exported ([recovery/index.ts:14-18](../src/components/recovery/index.ts)) but has ZERO render call sites anywhere outside its own file/tests/the barrel — found during WS3 Batch 2's 3.2 orphan grep, not previously tracked here or in Ruling D's exit-condition list (which named only `ExportFinishShortfallCard`/`StorageRootRelocationView`). Not fixed this batch — scope/intended integration point unknown; flagging for a separate pass rather than guessing at wiring.
- D6 CLOSED (Round 28) — a degraded project (unresolved assets) now opens directly into the editor instead of a blocking recovery modal; unresolved assets show an Offline badge (`DropZonePanel.tsx`), autosave stays blocked via the existing `saveProject` Guard 2 poison (`canPersistRecoveredProject`, `assetRecovery.ts`), and the recovery screen is reachable on demand via Files ▸ Relink Media…. See `App.tsx`'s `handleSwitchProject`.
- D7 CLOSED (Round 28) — `c3f96d9` — `ExportLivenessSnapshot.framesEncodedCumulative` added alongside the existing per-session `framesEncoded`, summed across every completed piece in the run — [exportPipeline.ts](../src/services/exportPipeline.ts), wired in [exportPipelineWebCodecs.ts](../src/services/webcodecsExport/exportPipelineWebCodecs.ts).
- CLOSED (Round 28) — `estimateExportDestinationDiskBytes` wired into `ExportSettingsModal.tsx`'s live size badge — [diskFull.ts:546](../src/services/webcodecsExport/diskFull.ts).
- CLOSED (Round 28) — `StorageSettingsSection.tsx:105` now routes through `relinkPickFolder()` — [relinkNative.ts:28](../src/services/relinkNative.ts).
- CLOSED (Round 28) — stale FA downloader string updated to describe the implemented, registered `fa_model_download` — [fa.rs:596-599](../src-tauri/src/fa.rs).
- [OPEN] Whisper-cache flake bounded only by `--test-threads=1`; needs injectable `IN_FLIGHT`/`TERMINAL_BUFFER` — [whisper.rs:109](../src-tauri/src/whisper.rs), [whisper.rs:235](../src-tauri/src/whisper.rs)
- [OPEN] `navigator.storage.persist()` WebView2 return value unrecorded — `windows-validation.md` W24
- D1 CLOSED (Round 28) — `77e8e5b` — resume adoption refusal fixed (Resume now adopts the retained session folder instead of minting a new one) and the early-cancel log gap closed alongside it.
- D2 CLOSED (Round 28) — `686c573` — `ExportFailureMessage` now renders at most one primary action via `resolvePrimarySlot`'s fixed ladder (asset_missing > timeline_gap > disk_full preflight reclaim > retention-evidence resume > none, owner Ruling A), replacing the four equal-weight buttons; Retry removed entirely.
- D4 CLOSED (Round 28, Batch 3) — `683ebe2` — export session temp now resolves under the configured storage
  root's `export-sessions/` subtree instead of a hardcoded `std::env::temp_dir()`
  (`ffmpeg.rs::session_dir`/`session_dir_under`, `storage_root::export_sessions_dir`); the
  create/list/sweep/reclaim commands and the resume-adoption path (`ffmpeg_reenter_session`)
  all route through the same resolver — proven by
  `session_dir_storage_root_routing::session_dir_always_nests_under_the_given_root_never_under_os_temp`,
  `...session_dir_under_a_relocated_root_is_disjoint_from_os_temp_dir`, and
  `...resume_and_session_management_commands_never_call_os_temp_dir_directly` (`src-tauri/src/ffmpeg.rs`).
  Whisper/FA models now resolve their install target through `storage_root::models_dir` first
  (`model_download.rs::models_dir`, `fa.rs::fa_model_candidate_paths`/`fa_model_path`), with the
  pre-Round-28 `app_local_data_dir` location kept as a read-only fallback so an existing install
  is still found without a migration step. `models` is now a fifth relocation subtree in
  `storage_root.rs`'s `MANAGED_RELOCATION_SUBTREES`, moved by the same copy-verify-commit flow and
  the same insufficient-space rejection as `assets`/`projects`/`cache`/`project-store-backups`
  (`relocation_moves_models_alongside_the_other_managed_subtrees`). A model download in flight
  refuses relocation outright (`model_download::any_download_in_flight`,
  `relocate_refuses_outright_while_a_model_download_is_in_flight`) rather than moving files out
  from under a live writer. Remaining hardware confirmation (relocation + a live export actually
  landing on the new volume, Resume adopting the same directory on real Windows) is unit/
  integration-covered only — see the new "Machine 1 checklist" in `windows-validation.md`.
- D5 CLOSED (WS3 Batch 2, 3B/3C) — `70d298e` — D5 was never a wiring gap (`StorageSettingsSection.tsx:130` genuinely called `storage_root_reclaim` all along — STEP 0b re-grep). Three separate defects fixed instead: D5a `reclaimable_dirs`'s backups path was discarded (`storage_root.rs`); D5b `sweep_stale_project_backups`'s freed-byte total was thrown away (now returns `u64`, `project_mirror.rs`); D5c (the one that mattered) — `size_report` advertised the ENTIRE backups directory as reclaimable regardless of staleness, a number that was never true. Now advertises exactly what the sweep would free (`project_mirror::store_backups_stale_bytes`), proven byte-exact-equal to what the sweep actually frees by a mixed aged/fresh fixture test. U36 (the export-failure modal's separate "Reclaim {bytes}" mechanism) is untouched, by design — see `docs/ws3-export-pipeline/reclaim-mechanisms.md` for which root each mechanism covers.
- U36 CLOSED (WS3 Batch 2, STEP 0c) — `b973b8c` — resolved the ownership ambiguity between the export-failure modal's "Reclaim {bytes}" and the App Settings "Free up cached data" button; they are two separate, non-merged mechanisms with separate targets (see `docs/ws3-export-pipeline/reclaim-mechanisms.md` for which root each covers) — not a single bug, not merged.
- [OPEN] D9 Twenty encoder sessions with eighteen restarts on RX 580 in one piece — Round 28, assigned to CC; investigated read-only this round, see Round 28 closeout report for conclusion — log-line gap absorbed into WS3 Charter above (no `'session-rotate'` `ExportLogPhase`)
- D8 CLOSED (Round 28, addendum scope) — `216878f` — added `export_log_event` (Rust, `ffmpeg.rs`) and `logExportEvent` (TS, `exportDiagnosticLog.ts`), a general-purpose door into `kinetix-diagnostic.log` for the export lifecycle, wired at init, cancellation, disk-full-preflight, and session-cleanup (`exportPipelineWebCodecs.ts`). Flush: routes through the same `tauri_plugin_log` `Folder` target the pre-existing `ffmpeg_log_disk_preflight`/`ffmpeg_retain_session_for_resume` commands already use, backed by an unbuffered `std::fs::File::write_all` (no `BufWriter`) — verified by reading `tauri-plugin-log 2.8.0`'s file-target implementation, not assumed. NOT wired: encoder-config, frame-loop progress pulses, and watchdog-update events, which originate inside the WebCodecs Worker (a separate global scope with no direct IPC access) and would need `postMessage`-to-main-thread plumbing this pass didn't build — left for a future pass; see `App.tsx`/`exportWorker.ts` for where that would attach.
- D24 — re-filed 2026-09-19 into WS1 (Open Bugs, above) — it is a sync-behavior defect (silent FA→Whisper substitution), not an export/storage one; see WS1 Charter for why.
- D8 FOLLOW-UP FIX (Round 28, same session) — `8908a03` — the new in-app diagnostic log viewer (`DiagnosticLogModal.tsx`, App Settings → Diagnostics) surfaced that `lib.rs`'s `setup` debug-build branch (`cfg!(debug_assertions)`) attached `tauri_plugin_log` with its OWN DEFAULT targets (`Stdout`, `Webview`, `LogDir`) rather than the pinned `Folder` target at `diagnostic-logs/kinetix-diagnostic.log` — that pinned path was only ever written to by a release build launched with `KINETIX_DIAGNOSTIC_LOG=1`. Every `tauri:dev` session before this fix therefore had `export_log_event`/`ffmpeg_log_disk_preflight` calls succeeding (no error) while writing to a file `get_diagnostic_log_text`/the viewer never reads, so the log always read back empty under `tauri:dev` regardless of export activity — not a viewer bug, a debug-build target mismatch. Fixed by swapping `LogDir` for the same pinned `Folder` target in the debug branch too (keeping `Stdout`/`Webview` for DevTools/console visibility); debug logging itself was never gated, only its destination. `kinetix-diagnostic.log` is now populated live under `tauri:dev` as well as in an opted-in release build.
- D12 CLOSED (Round 29) — transcription stuck "Pending" after Round 28's storage-root routing: [whisper.rs:590](../src-tauri/src/whisper.rs)'s `model_path()` only checked `app_local_data_dir()/models/`, while the presence-check path had moved to `storage_root::resolve_storage_root()` — the two diverged once storage was relocated. Fixed to resolve through the same storage-root function.
- D13 CLOSED (Round 29) — diagnostic log not writing after 14 September: [lib.rs:451](../src-tauri/src/lib.rs) — the unconditional startup boot line was superseded by `216878f`'s export-lifecycle-only logging and never actually written. Boot line restored.
- D14 CLOSED (Round 29) — "Free up cached data" reclaim control missing: Round 28 (`683ebe2`) added `export-sessions/` as a relocatable subtree but never added it to `reclaimable_dirs`/`size_report`, so `totalReclaimable` was always 0. Wired into the size report.
- D15 CLOSED (Round 29) — app hung solid (beachball, Cancel unreachable) on every relocation: [storage_root.rs:626](../src-tauri/src/storage_root.rs) ran the entire copy/hash/verify pass synchronously on the thread Tauri's IPC/event dispatch shares, with zero yield points — starved the whole webview event loop, including Cancel's own click handler. Moved to `tauri::async_runtime::spawn_blocking`; genuine mid-copy cancellation added via a polled `check_cancelled` closure (per file/dir entry) plus a cancel flag/command — a cancelled copy discards the partial new-root copy via `safe_delete`, old root untouched.
- D16 CLOSED (Round 29) — relocation modal rendered behind Settings — z-index fixed; close button + Escape added in the same pass.
- D17 CLOSED (Round 29) — free-space validation showed `AVAILABLE 0 B` then proceeded regardless — the available-space query was fixed for macOS (Phase 1 Windows audit this round confirmed the fix, `fs4`, is genuinely cross-platform, not OS-branched code) and a failed validation now blocks relocation. Required-bytes figure includes the CURRENT root's actual models-folder size (varies per user's downloaded set), per operator correction.
- D18 CLOSED (Round 29) — no progress/completion feedback (1-2 minutes of silence, modal closes silently) — added a `RelocationEvent` IPC channel reporting real cumulative bytes vs. total; the copy itself cut a redundant read (previously read every file three times) to stream-copy-while-hashing, a genuine ~33% I/O reduction.
- D19 CLOSED (Round 29) — investigated: Settings already refreshed correctly on success; what looked like "didn't update" was actually "hadn't finished yet," masked by D18's missing progress feedback. Not a code defect.
- D20 CLOSED (Round 29) — subtrees left behind after relocation (`fa-audio-cache`, `project-mirror`, `diagnostic-logs`) and a `fa-models`/`models` naming mismatch: `fa_audio_cache_dir` ([fa.rs:700](../src-tauri/src/fa.rs)) hardcoded `app_local_data_dir()`, bypassing storage-root entirely; a legacy top-level `fa-models/` predated the nested `models/fa-models/` layout and was never in the relocation set. Fixed, then extended per explicit operator instruction to unify everything: all seven subtrees (`assets`, `projects`, `cache`, `project-store-backups`, `models`, `project-mirror`, `diagnostic-logs`) now move together — see `docs/ws3-export-pipeline/architecture-ledger.md`'s Round 29 entry for the full contract table.
- D21 CLOSED (Round 29) — stray `src-tauri` directory in app data: no code created it — [whisper.rs:663](../src-tauri/src/whisper.rs) suggested a relative `curl -o src-tauri/models/...` command with no `mkdir -p`. Corrected to an absolute-path suggestion.
- D22 CLOSED (Round 29) — FA models undetected on first launch despite being present: `check_installed_models` only checked the storage-root slot of the FA fallback ladder, while the real loader (`fa_model_path`) checks all three tiers. Detection now mirrors the loader.
- Copy-speed CLOSED (Round 29) — relocation verification capped at ~16 MB/s: a hand-rolled scalar SHA-256 (`sha256.rs`) with no hardware acceleration. Switched relocation's copy-verify hash to `crc32fast` (hardware CRC32, ~16x throughput gain) — a deliberate choice, not an oversight; see `docs/ws3-export-pipeline/architecture-ledger.md`'s Round 29 entry for why CRC32 is sufficient here and why `sha256.rs` stays correct everywhere else it's used.
- Round 29 follow-on relocation UX work (operator-requested, not part of the original D-list): no-auto-delete on failure/cancel (records a "stale root" instead); resume support (size-match skip, full re-verify); simplified modal during copy; background continuation on dismiss (X/Escape no longer cancels); an accumulating stale-root list with one "clean up all" action; a `.DS_Store`/`Thumbs.db`/`desktop.ini` exclusion from copy+verify (Windows audit this round added the latter two); a "Reset to default location" action; Settings size-report reordering. Two React 18 StrictMode double-invoke bugs (`cancel()`, `resetToDefault()`) fixed by moving side effects out of `setState` updaters. See `docs/ws3-export-pipeline/architecture-ledger.md`'s Round 29 entry for the storage contract and CRC32 write-up, and `windows-validation.md`'s new W25–W30 rows for what still needs real Windows hardware (an open log-file handle under stale-root cleanup, real Explorer-written `Thumbs.db`/`desktop.ini`, a >260-char path, and real free-space/CRC32 throughput numbers).

### Deferred Tasks
- [DEFERRED] `ExportFinishShortfallCard` stays unwired — blocked on frame accounting. Exported ([recovery/index.ts:32](../src/components/recovery/index.ts)) but no render call site exists anywhere in `src/`; wiring it needs a `producedFrames`/`expectedFrames` producer, which does not exist anywhere in `src/` (owner Ruling D). Deferred to Round 29.
- [DEFERRED] D10 closed-pending-hardware — gap observed on build `831c872`; Ruling A's repair ladder (`resolvePrimarySlot`, [resumeEligibility.ts](../src/services/exportFailure/resumeEligibility.ts), commit `686c573`) did not exist at that build. The repair path is now live with a passing test; step 8 of the Machine 1 checklist (`windows-validation.md`) settles it on real hardware. Deferred to Round 29.

---

## Backlog Items

- [OPEN · NON-BLOCKING] ORT intra-op thread ceiling undecided (32 recommended) — `fa_onnx.rs:503`
- CLOSED (Wave 1, `b547132`) — `fa_cancel` wired from sync cancel path (`useWhisper` / Apply Sync abort); no longer zero frontend callers.
- [OPEN · NON-BLOCKING] `faBoundaryTypes.ts` missing one-way drift entries — `faBoundaryTypes.ts:64`
- [OPEN · NON-BLOCKING] `.digest.json` not removed on model delete — `models.rs:664`
- [OPEN · NON-BLOCKING] Two `fa_shared` digest tests share process-global memo — `fa_shared.rs` (line shifted by the G5 `fa_dev.rs` -> `fa_shared.rs` rename; re-locate before acting on this line)
- [OPEN · NON-BLOCKING] Whisper attach buffer 30s stale-replay window; panic path can orphan registry key — `whisper.rs:172`
- [OPEN · NON-BLOCKING] React max update depth during V8 FA run; trigger unlocated
- [OPEN · NON-BLOCKING] Dev-profile WebKit IDB holds 469MB legacy v1 data; packaged build 15.7MB
- [OPEN · NON-BLOCKING] Legacy export ffmpeg concat/mux paths unbounded vs `concatAnnexbPieces` — `exportPipeline.ts:263`
- [OPEN · NON-BLOCKING] macOS `VideoEncoder` output not byte-reproducible (76/1200 chunks matched) — use `FrameContentDigest`
- [OPEN · NON-BLOCKING] Part C longest silent interval (10.26s) lacks phase attribution — `exportWorkerDiagnostics.ts`
- [OPEN · NON-BLOCKING] `GL_TRANSITION_SLUGS` duplicated — `compositeParams.ts:34`, `decodeCursorLifetime.ts:26`
- [OPEN · NON-BLOCKING] Three parallel disk-size estimators (badge, dead destination module, live preflight) — consolidate to one — `diskFull.ts`
- CLOSED (2026-09-19, P4b) — ~33 cloud CI test failures from missing `.work-phase4/replay/` fixtures — `scripts/phase4-restore-replay-inputs.py`. Fixtures committed as tracked content (`549ce63`); canonical zero-failure line reconfirmed at the current branch tip (`53449b9`, gate 6: `npm test` → 3925 passed / 78 skipped / 0 failed — `baseline-p1b-p3-2026-09-19.md`). The other 1 of the originally-observed 34 `npm test` failures (the WS1 single-tracker allowlist gap) was closed earlier by `2b7d33a`, not this line — that failure was never a "gitignored replay fixtures" issue and had no separate STATUS.md line of its own.
- CANONICAL LINE UPDATE (2026-09-20, Wave 1 landing on `main` @ merge `3c3868e`) — `npm test` → **3992 passed / 78 skipped / 0 failed** (262 test files passed), superseding the 3931/78/0 line. Identity: `npm run lint` ≡ `tsc --noEmit`.
- [OPEN · NON-BLOCKING] 10 local `archive/wt-*-2026-09-14` branches, none pushed to origin
- SaaS target architecture (integration tip at record time `e8ffb6b`, one commit before docs tip `c463814`; branch now merged to `main` @ `42988f1`) — `docs/architecture/saas-target-architecture.md`, Round 28, commit `06c67a3`
- Cloud ASR and alignment plan (branch `ws-cloud-asr-plan` @ `eb1c4fa`, merged to `main` @ `42988f1`) — `docs/architecture/cloud-asr-plan.md`
