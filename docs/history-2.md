# History 2 — WS1 Session Archive

> **Purpose:** append-only companion to `docs/history.md`, opened 2026-08-25 for Docs Cleanup
> Round 1. Holds every completed/abandoned item moved out of `docs/work-in-progress.md`'s WS1
> section (Sessions A through AN, the ledger/measurement archive, and the Changelog) so that
> file could be cut down to only live work and standing constraints. Same rules as
> `docs/history.md`: never edited mid-workstream, only appended to; data preserved, narrative
> kept minimal. **Not a replacement for `docs/history.md`** — that file stays untouched and is
> still the primary archive; this one exists because splitting the WS1 dump into it directly
> was out of scope for this round. No line cap.
>
> **Docs Cleanup Round 2 (2026-08-25).** Folded and deleted the 20 finished raw session,
> measurement, and ear-list files under `docs/ws1-sync-pipeline/` (`fa-chunk-phantom-root-
> cause.md`, the `session-al/am/an-*.md` dumps, and the `stage1-*` run sheets/ear lists other
> than `stage1-mover-audit.md`/`stage1-live-run-prep.md`, which stay — the mover-audit dossier
> is still unscored, a live task named directly in `docs/work-in-progress.md`). Their content
> that wasn't already captured above was appended into the matching dated Session entry below
> (each addition is marked inline). `sync-pipeline-v2-plan.md`'s own Parts AE–AH (Sessions
> AK–AN) were condensed to short pointers at the same time — this file is now their primary
> record. Full original text of every deleted file remains retrievable: find the fold commit
> with `git log --oneline -- docs/ws1-sync-pipeline/<filename>` (the newest commit touching a
> now-deleted path is the fold commit, which still carries the file) and run `git show
> <that-sha>:docs/ws1-sync-pipeline/<filename>`.

## Index

- [FA Rust/ONNX component build (D1–D25)](#fa-rustonnx-component-build-d1d25) — 2026-08-12–14
- [Feasibility & memory measurements](#feasibility--memory-measurements) — 2026-08-12–14
- [K13 — lock preservation across resync](#k13--lock-preservation-across-resync) — 2026-08-11
- [Apply Sync history-entry fix](#apply-sync-history-entry-fix) — undated
- [WS1 tracker consolidation & close-out audit](#ws1-tracker-consolidation--close-out-audit) — 2026-08-14/15
- [Phase 3 production wiring shipped, gate OFF](#phase-3-production-wiring-shipped-gate-off) — 2026-08-15
- [Sequencing & scope decisions](#sequencing--scope-decisions) — 2026-08-15
- [Phase 3b — language-keyed normalization, Rules 1–5](#phase-3b--language-keyed-normalization-rules-15) — 2026-08-15
- [Phase 3c — hyphen-asymmetry closed](#phase-3c--hyphen-asymmetry-closed) — 2026-08-15
- [Documentation bookkeeping fixes](#documentation-bookkeeping-fixes) — 2026-08-15
- [FA-on smoke test](#fa-on-smoke-test) — 2026-08-15
- [R-H second-baseline pass + R-Q fixture regeneration](#r-h-second-baseline-pass--r-q-fixture-regeneration) — 2026-08-16
- [Ear-pass root-cause diagnosis](#ear-pass-root-cause-diagnosis) — 2026-08-16
- [D.-1 evidence dossier](#d-1-evidence-dossier) — 2026-08-16
- [Session A — nine owner rulings](#session-a--nine-owner-rulings) — 2026-08-16
- [Session A.5 — R-R found unbuildable](#session-a5--r-r-found-unbuildable) — 2026-08-16
- [Session B — R-U shipped](#session-b--r-u-shipped) — 2026-08-16
- [Session B.1 — R-AA, the seam-region reading](#session-b1--r-aa-the-seam-region-reading) — 2026-08-16
- [Session C — ear pass closes, Zero-Defect Register opens](#session-c--ear-pass-closes-zero-defect-register-opens) — 2026-08-16/17
- [`faChunkPlan.ts` forced-split attribution fix (item 9)](#faChunkplants-forced-split-attribution-fix-item-9) — 2026-08-16
- [Ear-pass items 6/7 circularity checkpoint](#ear-pass-items-67-circularity-checkpoint) — 2026-08-16
- [Session D — R.5 shipped](#session-d--r5-shipped) — 2026-08-17
- [Session E — R.10 shipped](#session-e--r10-shipped) — 2026-08-17
- [Session F — R.11 shipped, register hits zero](#session-f--r11-shipped-register-hits-zero) — 2026-08-17
- [Session G — F6 resolved, per-project toggle](#session-g--f6-resolved-per-project-toggle) — 2026-08-17
- [Session H — R.12 shipped](#session-h--r12-shipped) — 2026-08-18
- [Session I — R-AM ruled, mover audit dossier](#session-i--r-am-ruled-mover-audit-dossier) — 2026-08-18
- [Session J — logging gap closed, P6 passes](#session-j--logging-gap-closed-p6-passes) — 2026-08-18
- [Session K — 24-row audit, R.13 shipped](#session-k--24-row-audit-r13-shipped) — 2026-08-18
- [Session M — FA had never run in-app](#session-m--fa-had-never-run-in-app) — 2026-08-18
- [Session N — R.11 wiring bug fixed](#session-n--r11-wiring-bug-fixed) — 2026-08-19
- [Session O — data-loss investigation](#session-o--data-loss-investigation) — 2026-08-19
- [Session P — stale-vintage hypothesis confirmed](#session-p--stale-vintage-hypothesis-confirmed) — 2026-08-19
- [Session Q — R.12 mutation-gate hole fixed](#session-q--r12-mutation-gate-hole-fixed) — 2026-08-19
- [Session R — word containment structurally blind](#session-r--word-containment-structurally-blind) — 2026-08-20
- [Session S — R.11/R.12 conflict resolved](#session-s--r11r12-conflict-resolved) — 2026-08-20
- [Session T — clamp dropped, A/B-overturns-solo established](#session-t--clamp-dropped-abovertuns-solo-established) — 2026-08-21
- [Session V, Part 1 — 7 register rows close](#session-v-part-1--7-register-rows-close) — 2026-08-22
- [Session W — 173 pre-fix capture frozen](#session-w--173-pre-fix-capture-frozen) — 2026-08-22
- [Session X — 173 precision/recall measured](#session-x--173-precisionrecall-measured) — 2026-08-22
- [Session Y — engine determinism pinned](#session-y--engine-determinism-pinned) — 2026-08-22
- [Session Z — chunk-plan hypothesis refuted](#session-z--chunk-plan-hypothesis-refuted) — 2026-08-22
- [Session AA — near-zero confidence predicts nothing](#session-aa--near-zero-confidence-predicts-nothing) — 2026-08-22
- [Session AB — R.11 firings corrected](#session-ab--r11-firings-corrected) — 2026-08-22
- [Session AC — register drift audit, Stage 1 exit scorecard](#session-ac--register-drift-audit-stage-1-exit-scorecard) — 2026-08-22
- [Session AD — ledger correction, two negative discriminator searches](#session-ad--ledger-correction-two-negative-discriminator-searches) — 2026-08-22
- [Session AE — R.14/R.15 shipped](#session-ae--r14r15-shipped) — 2026-08-23
- [Session AG — phantom-tail mechanism confirmed](#session-ag--phantom-tail-mechanism-confirmed) — 2026-08-23
- [Session AH — S1 rejected and rolled back](#session-ah--s1-rejected-and-rolled-back) — 2026-08-23
- [Session AI — S2 built, not shipped](#session-ai--s2-built-not-shipped) — 2026-08-23
- [Session AJ-0 — machine oracle installed](#session-aj-0--machine-oracle-installed) — 2026-08-23
- [Session AK — R.5 excision a contributing, not sole, cause](#session-ak--r5-excision-a-contributing-not-sole-cause) — 2026-08-23
- [Session AL — chunk width eliminated as cause](#session-al--chunk-width-eliminated-as-cause) — 2026-08-24
- [Session AM — chunk-edge placement identified as driver](#session-am--chunk-edge-placement-identified-as-driver) — 2026-08-24
- [Session AN — arm H widens the search, still not shippable](#session-an--arm-h-widens-the-search-still-not-shippable) — 2026-08-24
- [Priority 2 — Multi-Project Dashboard storage/migration](#2026-08-25--ace07c7--ace07c7-multi-project-storage-migration) — 2026-06-11/12 (moved from `docs/history.md` 2026-08-25)
- [FA session-cache OOM fix](#2026-08-25--6a1b939--6a1b939-fa-session-cache-oom-fix) — 2026-08-25
- [WS2 bug 1 — trusted-spine rescue ordering](#2026-08-26--2ae4d18--2ae4d18-ws2-bug1-trusted-spine) — 2026-08-26
- [WS2 bug 2 — FA compiled into the installer](#2026-08-26--d8baef5--d8baef5-ws2-bug2-fa-compiled-into-installer) — 2026-08-26
- [WS2 bug 4 — in-app model acquisition](#2026-08-26--8c6e4e8--8c6e4e8-ws2-bug4-in-app-model-download) — 2026-08-26
- [WS2 bug 3 — closed, did not reproduce](#2026-08-26--no-fix--ws2-bug3-closed-did-not-reproduce) — 2026-08-26
- [WS2 bug 2 — correction: Windows/arm64 ORT runtime still absent](#2026-08-26--correction--ws2-bug2-ort-runtime-platform-gap) — 2026-08-26
- [WS2 Step 10 — FA error serialization fix](#2026-08-26--88ff701--88ff701-ws2-step10-error-serialization) — 2026-08-26
- [WS2 Step 10 — Windows voiceover fetch fix](#2026-08-26--56e2116--56e2116-ws2-step10-windows-voiceover-fetch) — 2026-08-26
- [WS2 Step 11 — FA model provenance (A5)](#2026-08-26--ws2-step11-fa-model-provenance-a5) — 2026-08-26
- [WS2 Step 11 — remaining fetch(asset.url) sites fixed](#2026-08-26--ws2-step11-fetch-sites) — 2026-08-26
- [WS2 Step 11 — boundaryUsedFallback 4-arg bug fixed](#2026-08-26--ws2-step11-boundaryUsedFallback-fix) — 2026-08-26
- [WS2 Step 12 — Manage Models & Add-ons modal (A3)](#2026-08-27--ws2-step12-manage-models-modal-a3) — 2026-08-27
- [WS2 Step 13 — FA download engine + ORT provisioning](#2026-08-27--ws2-step13-fa-download-engine-ort-provisioning) — 2026-08-27
- [CI fix — macOS stray-.onnx guard globstar](#2026-08-27--fix--5adbbf4-ci-macos-globstar-fix) — 2026-08-27
- [Correction — CI installer artifacts now exist](#2026-08-27--correction--ws2-ci-installer-artifacts-now-exist) — 2026-08-27
- [Correction — FA acquisition + ORT gate superseded](#2026-08-27--correction--ws2-fa-acquisition-and-ort-gate-superseded) — 2026-08-27
- [OPERATOR-ATTESTED — macOS CI-built artifact FA verified](#2026-08-26--operator-attested--ws2-macos-ci-artifact-fa-verified) — 2026-08-26
- [OPERATOR-ATTESTED — macOS arm64 FA dlopen/inference verified](#2026-08-26--operator-attested--ws2-macos-arm64-fa-dlopen-inference-verified) — 2026-08-26
- [OPERATOR-ATTESTED — WS1 R.12 live re-confirmation (085/224/307/383)](#2026-08-27--operator-attested--ws1-r12-live-reconfirmation) — 2026-08-27
- [OPERATOR-ATTESTED — WS1 mover-audit dossier closed 24/24](#2026-08-27--operator-attested--ws1-mover-audit-24-of-24-closed) — 2026-08-27
- [WS1 Phase 1b–3d groundwork closed](#2026-08-05-08-25--ws1-phase1b-3d-groundwork) — 2026-08-05–08-25
- [OPERATOR-ATTESTED — WS1 Spanish-corpus acceptance lapse closed](#2026-08-27--operator-attested--ws1-spanish-corpus-acceptance-lapse-closed) — 2026-08-27
- [WS2 Phase 4 close-out (T4.1/T4.2) and the four false-greens](#2026-09-03--ws2-phase-4-close-out-t41--t42-and-the-four-false-greens) — 2026-09-03
- [WS2 T4.4–T4.8 — model download arc closed](#ws2-t4t8--model-download-arc-closed-2026-09-04) — 2026-09-04
- [WS2-45 — Phase 4 manual checklist retired](#ws2-45--phase-4-manual-checklist-retired-2026-09-04) — 2026-09-04

---

## FA Rust/ONNX component build (D1–D25) — 2026-08-12–14

Built and tested the forced-alignment engine's Rust/ONNX components as 24 dated slices: ONNX
forward pass (0/577 argmax mismatches vs. real jonatasgrosman models), a byte-identical Rust
port of the text-normalization pipeline, Viterbi DP/char→word merge (zero-tolerance parity vs.
torchaudio, all 5 languages), frame→time conversion, model caching, cancellation, chunk index
attribution (`qi`, 0/1643 fallback fires on the real 709s corpus, down from 2/97), a durable
16kHz WAV cache (1538× speedup on cache hit), and a green 4-cell CI ORT matrix. D7 was
cancelled as scoped and absorbed into D8–D10 instead. At D25 close: `cargo test --features
fa-inference` 150 passed/19 ignored, `npm test` 79 files/1942 passed/1 skipped, golden replay
6/6.

## Feasibility & memory measurements — 2026-08-12–14

Whole-file (unchunked) memory ladder: 30s=1.94GiB → 240s=19.52GiB, extrapolating to
60–150GB at the real 709s corpus length — this is why chunking was mandated. A separate
Python/MMS-FA feasibility spike peaked at 2.49–4.01GiB RSS on real corpora. R.7's `CONF_MIN`
threshold validated by Youden's J (best J=0.9176 at 0.3112, matching the shipped 0.3 across 3
tolerance definitions). Spanish language pause gate passed (p95=50.4ms, 1/22 pauses over the
250ms gate). R.2 (chunk-edge padding) was built, measured net-unfavorable (below-CONF_MIN tail
grew 155→164), and deleted — closed negative. CTC-infeasibility, attribution isolation, and a
mis-assignment diagnostic all confirmed attribution logic, not window size, was the dominant
accuracy factor.

## K13 — lock preservation across resync — 2026-08-11

Ruling R-C. Shipped `preserveSegmentLocks` in `App.tsx` so a locked segment survives Apply
Sync. 11 unit tests, a 3/3 repro test, 5 manual tests.

## Apply Sync history-entry fix — undated

Commit `1b16a50`. Closed; exact session date not recorded in the source tracker.

## WS1 tracker consolidation & close-out audit — 2026-08-14/15

Consolidated 29 scattered WS1 tracking/slice/decision/measurement files (625,715 bytes) into
one structured tracker section (57,967 bytes, ~9% of source) at commit `9cf5867`. A next-day
close-out audit found 8/12 checks failing (dangling references, a missing archive section) and
fixed all but one permanent blocker (`project-state.md` pointing at a deleted roadmap file, out
of scope). Also corrected a "Part Z" → "Part M" mislabel for `sync-pipeline-v2-plan.md`'s
status addendum. Full retrieval commands (`git show 251be64:<path>`) for all 29 source files
exist at that commit for anyone who needs the original text.

## Phase 3 production wiring shipped, gate OFF — 2026-08-15

Wired `fa_align_production` end-to-end and reachable from `App.tsx` (insertion at
`App.tsx:2792-2837`), fail-clean on every failure mode, gate deliberately left OFF. `npm test`
82 files/2107 passed; `cargo test --features fa-inference` 206 passed/19 ignored; golden replay
6/6; real end-to-end smoke run on v6 (447 segments, ~231s wall-clock).

## Sequencing & scope decisions — 2026-08-15

Bundled owner decisions: gate-sequencing chose Option B (stay OFF through Phase 3b/3c), R.5's
build timing was DEFERRED (ship wiring without it, build before Phase 4), and Phase 3b/3c
ownership was assigned to the project owner. Added the `npm run tauri:dev:fa` dev script
enabling the `fa-inference` Cargo feature locally.

## Phase 3b — language-keyed normalization, Rules 1–5 — 2026-08-15

Shipped in `faTextNormalize.ts`/`text.rs`, verified against the gap empirically before each
build: Rule 1 French elision typo-fold, Rule 2 Spanish cardinals 0–30, Rule 3 German cardinals
0–30, Rule 4 Portuguese cardinals 0–20/30 (PT-BR; found the multi-word wall starts at 21, not
31 like Spanish), Rule 5 French cardinals 0–30 minus 21 (traditional spelling). Owner ruled
single-word-output only, permanently — currency and thousands-separator expansion are
permanently out of scope. Phase 3b closed.

## Phase 3c — hyphen-asymmetry closed — 2026-08-15

19 compound-word cases audited (8 clean-split-fixable, 1 boundary-affecting: v6 seg 150,
457.83s vs. 458.12s). Owner ear-tested both candidates and ruled the unfixed 457.83s correct.
Accepted as a known Stage 1 defect (D.-1 criterion 3); no code change; Phase 3c closed.

## Documentation bookkeeping fixes — 2026-08-15

Bundled docs-only corrections: verification-harness vocabulary corrected (14 real checks,
C01a/b–C13, not "C1–C12"); an H.5 framing correction (fixed a claim that `faTextNormalize.ts`
started with `textNormalize.ts`'s digit/currency/contraction handling, which it didn't); an
ownership-contradiction fix plus reassignment of two normalizer gaps (diacritic destruction,
thousands-separator mangling) from Phase 3b to Phase 3c, since neither reaches FA input text.

## FA-on smoke test — 2026-08-15

First real end-to-end `fa_align_production` run against real audio through a built `.app` with
`ORT_DYLIB_PATH` set: ~231s for 447 segments, 0 monotonicity violations. V6 seam landed 457.81s
vs. the ear-correct 457.83s — proved the plumbing works, not timing quality.

## R-H second-baseline pass + R-Q fixture regeneration — 2026-08-16

Real Rust ONNX capture across all 3 corpora through the full production pipeline: median
boundary |Δ|=0.00s, p90 ~0.1–0.3s, 45 boundaries >0.5s / 25 >1.0s. Regenerated FA fixtures from
the jonatasgrosman HF models (Apache-2.0), replacing the barred MMS-FA license. Measurement
only, gate stayed OFF.

## Ear-pass root-cause diagnosis — 2026-08-16

Diagnosed the owner's 12-item ear pass (5 correct / 7 wrong), attributing all 7 failures to
four mechanisms: unscripted audio, scripted-but-unspoken text, false-anchor timestamp smear,
and a forced-split attribution bug. Diagnosis only, no fix.

## D.-1 evidence dossier — 2026-08-16

Assembled code/test/measurement evidence for all 21 Contract IN / Contract 1→2 guarantee rows
so the owner's required inspection was a short read. No ruling made; Stage 1 lock stayed NOT
PASSED.

## Session A — nine owner rulings — 2026-08-16

Recorded R1–R9: items 6/7 fix approach, a sharpened CLAUDE.md timestamp-identity invariant, the
R.10 companion rule spec, fr/de/pt deferral, and the FA-default acceptance bar. Built the
8-test FA replay gate. Measured true anchor exposure: 481 real accepted anchors, 100% sharing a
Whisper token. No fix implemented; gate stayed OFF.

## Session A.5 — R-R found unbuildable — 2026-08-16

Ruling R-R's amended R.1(c) proved unsatisfiable against the real token stream. Extended the
FA replay gate to actually cover the code it names (8→12 tests). Measured blast radius at
179–636 of 649 boundaries depending on scope. No fix shipped; Session B blocked on an owner
ruling.

## Session B — R-U shipped — 2026-08-16

Rulings R-U (zero-seam rejection), R-V (unbundles item 7 into new rule R.11), R-W (rejects a
two-pass T1 design), R-X (two-tier ear-verification bar), R-Y (authorizes real-ONNX
re-capture), R-Z (reopens R.10's detector as an independent track). Implemented R-U in
`faAnchors.ts` (a silence spanning no token seam is rejected); measured 16/649 boundaries moved
before shipping. FA replay gate re-pinned to 13 tests. Session's own close flagged the "instant
seam" premise might be wrong — resolved same day by Session B.1.

## Session B.1 — R-AA, the seam-region reading — 2026-08-16

Amended R-U's seam definition from an instant to a closed-interval region in `faAnchors.ts`,
narrowing the mover set from 16 to 4 of 649 (a strict subset). 12 previously-flagged boundaries
revert to unmoved; 3 of those 12 (`protection_failure`, `abysmal_opinion`, `226_four_scouts`)
were flagged as candidate defects for later triage (Session C's OV3). FA replay gate re-pinned
a second time.

## Session C — ear pass closes, Zero-Defect Register opens — 2026-08-16/17

Rulings R-AB/R-AC (Tier 2 satisfied), R-AD (defers the FA-default flip to an empty register),
R-AE (pulls item 7/R.11 into Stage 1), R-AF (triages 3 OV3 candidates rather than parking
them). Built the Zero-Defect Register (5 open / 2 closed / roster 7), machine-checked in
`phase4-fa-replay.test.ts`. Shipped two measured diagnoses: Diagnosis A gives R.10 a clean
discriminant (`matched===false ∧ max(word.confidence)<5e-4 ∧ wordCount≥2`, 2/2 TP, 0 FP, 850×
separation margin); Diagnosis B roots item 7 in a chunk-window text/audio mismatch. R.5's spec
brought to buildable depth (10/10 recall, 0 FP on v6 Level-N recitations). No production code
changed except the gate. Scope explicitly limited to en/es.

## `faChunkPlan.ts` forced-split attribution fix (item 9) — 2026-08-16

Fixed `attributeByIndex`'s empty-run fold direction for forced splits (was folding backward,
should fold forward). Spanish `023_scylla_six_sailors` moved from 66.73 to the ear-correct
65.12, exactly. V6/173 unaffected (no forced splits there). Closes ear-pass item 9; items 6/7
stayed open.

## Ear-pass items 6/7 circularity checkpoint — 2026-08-16

Independently confirmed the false-anchor mechanism behind items 6/7 in `faAnchors.ts`'s
`findAgreeingSilence`. Found the CLAUDE.md timestamp-identity invariant (landed `53b26ee`)
actually predates `faAnchors.ts` (authored `e0c9c89`) — not a grandfather case, but not a clean
violation either (the invariant names a different operation). Measured population exposure at
116/639 boundaries (18.2%) sharing the same structural precondition. Proposed 4 fix options; no
ruling made.

## Session D — R.5 shipped — 2026-08-17

Ruling R-AG (triage outcome + register schema). Built and measured R.5 (unscripted-run
excision from the FA chunk plan): 8/649 boundaries moved (v6 8/447 only), every one landing
exactly on the Whisper-committed value; items 4 & 5 resolve to 0.000s residual. Refuted the
owner's pre-registered "Level-N heading" hypothesis. Both OV3 triage defects traced to a single
root cause named R.11 (R.12 stays unused). Tests: 83 files/2148 passed/2 skipped; golden replay
6/6.

## Session E — R.10 shipped — 2026-08-17

Ruling R-AH. Built R.10 (drop never-spoken scripted text): 3/649 boundaries changed (2 dropped,
1 moved, all 173); items 10 & 11 close. Re-validated Session C's discriminant post-R.5
(unchanged, 850× margin). Corrected the record on the R-Z 0.769/0.778 pair — R-Z was right, the
earlier measurement used the wrong array. Fixed a real gate defect where a post-R.10 chunk-plan
input fixture had silently shortened. Register: 5→3.

## Session F — R.11 shipped, register hits zero — 2026-08-17

Ruling R-AI. Built R.11 (crushed-chunk seam-fit correction against real silence midpoints): 4
corrections (v6 3, 173 1, spanish 0), all landing exactly on ear-correct values. Constants:
`R11_MIN_FIT_DEVIATION=1.3093`, `R11_MAX_SPAN_WORD_CONF=1.0835e-2`. Register reaches **zero**
(3→0). F6 fired: the FA toggle's global (not per-project) shape blocked flipping the default —
resolved next session.

## Session G — F6 resolved, per-project toggle — 2026-08-17

Rulings R-AK (per-project FA toggle, default ON) and R-AL (R-N: stay load-dynamic + bundle the
onnxruntime dylib as a Tauri resource). Shipped `Project.faHighPrecisionSync`. Measured and
fixed the fail-clean tax (uncached model-manifest hashing on every call: 76.51s debug/4.99s
release first-call → 0.254ms/0.099ms cached repeat). Corrected the FA-recovery-set count to 5
members (not 6/7). Tests: 86 files/2234 passed/1 skipped; golden replay 6/6. Also ran the
Contract 1→2 guarantee-by-guarantee verification pass required for the Stage 1 lock: 5 of 12
guarantees DIRECT, 4 PARTIAL, 3 ABSENT, and found `validate1to2` is never called from the
`alignFromCache` commit path — an exposure the FA-default flip widened without changing the
contract itself.

## Session H — R.12 shipped — 2026-08-18

Built R.12 (atomic-run invariant): 9 corrections, all v6, all landing bit-exact on measured
values. Register raised then lowered in one commit: 0→9→0, roster 19 total. Reverted
`FA_PROJECT_DEFAULT_ON` back to **false** — readiness criteria (two disjoint 12/12 blind passes
plus a live acceptance run) weren't yet met. Amended R-E to assign excised-run seconds to the
following segment, not the preceding one, for the committed boundary specifically.

## Session I — R-AM ruled, mover audit dossier — 2026-08-18

Ruling R-AM: no register entry may be closed until that rule's movers are ear-scored — this
made Session H's four structural R.12 closures (085/224/307/383) PROVISIONAL. Documentation-
only session: an exhaustive mover audit found 31 unique movers across 8 commits (16
ear-verified, 4 structural, 11 never scored), all reconciled to named rule owners, and produced
a 24-row blind ear-scoring dossier (`stage1-mover-audit.md`).

## Session J — logging gap closed, P6 passes — 2026-08-18

Ruling R-AN (standing autonomy directive: delegated calls cover "how," never "what is true").
Closed the rule-firing/engine/FA-fallback logging gap Session I flagged
(`owningRule`/`ruleDetail` fields, new log entry types). Measured Contract 1→2's P6
(normalizer-symmetry property) — passes, zero asymmetries; Stage 1 lock's blocking set is now
empty on that row. Register unchanged: 19 roster/0 open; the four R.12 provisional closures
remained provisional. The same session also closed Stage 1's nine non-ear-answerable lock items
in one sitting: Step T (model distribution) deferred to the release phase (~10.5+1
engineer-days, not blocking Task 5); Contract 1→2's A4 accepted unenforced; Contract IN's A3
accepted; R-S(iii)/R7 accepted for the toggle, deferred for the default; and D.-1 items 4/5/8/9
accepted as a documented subset or permanently unautomated — all nine ratified by the owner
verbatim, no code change.

## Session K — 24-row audit, R.13 shipped — 2026-08-18

Scored 22/24 mover-audit rows; the 2 failures root-caused and fixed. Shipped R.13 (atomic-
utterance invariant, `225_night_scouts` 667.47→669.05); predicted blast radius 1/649, actual
1/649. New ruling R-AO. Found and fixed a third, independent defect during tracing: a
display-only PARSE-vs-COMMITTED index off-by-two bug in `syncLog.ts`.

## Session M — FA had never run in-app — 2026-08-18

The most material finding of the programme: forced alignment had never once executed inside
the real app — every prior measurement came from a `cargo test`/Python driver that set
`ORT_DYLIB_PATH` manually, which the app process never set, so it silently fell back to
Whisper-only timing. Fixed by implementing R-N: bundling the signed onnxruntime dylib
(`libonnxruntime.1.23.2.dylib`, sha256 `8c9c78de...`) as a Tauri resource and setting
`ORT_DYLIB_PATH` at runtime. Also added a non-sticky `Project.detectedLanguage` field and a
pre-flight readiness check.

## Session N — R.11 wiring bug fixed — 2026-08-19

R.11 was reachable the whole time but blocked by a one-argument wiring bug (fixed to resolve
by ID). Opened R-AO as a machine-checkable production-path class.

## Session O — data-loss investigation — 2026-08-19

Investigated a reported data-loss incident: no data was actually lost (12/12 projects hydrate
cleanly). Real defect was `localStorage` being origin-scoped across dev (`localhost:3000`) and
release (`tauri://localhost`) builds, worsened by `setLastOpenedProjectId` using
`sessionStorage` (doesn't survive app restart). Shipped a fix: promoted to `localStorage`,
guarded against empty-over-non-empty overwrites, and added `project_mirror.rs` (atomic writes,
10-deep rotating backups) plus a strictly-additive boot-time adoption pass.

## Session P — stale-vintage hypothesis confirmed — 2026-08-19

Confirmed the FA arm used in tests had gone stale relative to the live chunk plan (277 live vs.
280 stale chunks) and corrected the regeneration methodology. Root-caused R.12's zero findings:
97.76% of adjacent raw-token pairs have zero gap, so the fix moved to substantive-token space
(no new constant). R.12 now fires 7 (was 0). Ruled Class A (4 rows) out as a threshold problem
via sensitivity analysis — no threshold value separates the known defects from the 291-row
candidate pool without degenerating to 100%.

## Session Q — R.12 mutation-gate hole fixed — 2026-08-19

Corrected the mutation matrix from a 12-file to a 16-file gate (M1 was invisible under the old
gate) and fixed the real hole it exposed. Fixed a genuine R.13 carrier-identification bug
(keyed on punctuation-inflated `startSec` instead of acoustic onset). Confirmed R.13's
zero-firing was genuinely correct, not suppressed. A silence-distance signal separated 7/9
known defects but proposed the wrong correction on both reachable rows — not shipped.

## Session R — word containment structurally blind — 2026-08-20

Confirmed the real defect behind Class A/B rows is upstream — a word-attribution error in
Hirschberg alignment, not a boundary-placement error — so any boundary-vs-span rule is
structurally blind to it by construction (0 violations measured across all 446 v6 boundaries).
A sample-rate artifact was confirmed (`403_vigilant_embers` only crosses the amplitude floor at
native rate, not 16kHz). No production code touched; Class A/B remained unfixed.

## Session S — R.11/R.12 conflict resolved — 2026-08-20

Found two rules racing for the same boundary with ordering silently deciding the winner; fixed
structurally with a new ownership ruling, R-AP (R.11 declines `266_forty_one_burden`, reason
`origin-inside-run`). Root-caused R.12's "EARLY" placements to a clamp anchored on a Whisper
token timestamp landing inside the silence itself (correct rows sit at 44–50% of silence width,
defective rows at 2–15%). Re-audited every "verified" pin in the suite and demoted five that had
been verified against the wrong (pre-correction) value — register 8→14 open. No R.12 value
change shipped.

## Session T — clamp dropped, A/B-overturns-solo established — 2026-08-21

Dropped the clamp that was masking a Whisper onset inside real silence, closing five register
rows. A side-by-side A/B pass reversed a prior SOLO-listened verdict at boundary 383
(1188.950 vs. 1189.050, both inside 1.26s of digital silence) — this is the case that
established the "a side-by-side pass can overturn a solo one; a solo pass doesn't re-litigate a
side-by-side one" rule now in CLAUDE.md. Register 14→15 open (one row regressed 0.10s, flagged
not special-cased).

## Session V, Part 1 — 7 register rows close — 2026-08-22

Closed seven register rows against a fresh run-id-stamped bundle through the real production
rule stage (not fixture regeneration): register 15→8 open. All 7 matched their stored targets
exactly. Refuted the `266_forty_one_burden` "regression" classification — 788.75 confirmed
correct, not a defect. The remaining 8 open rows are all Class A/B, explicitly scoped as a
separate, not-yet-started "Part 2."

## Session W — 173 pre-fix capture frozen — 2026-08-22

Froze 173's pre-fix live-sync state as ground truth for a future fix, after the operator
flagged a suspect cut at boundary 6-7. Confirmed audio-byte identity between the live sync and
the replay bundle; found one divergence (`vessel_damage_clue`, live 174.740 vs. regen
172.910 — later solved in Session AJ-0 as a stale bundle pointer, not non-determinism).
Emitted a 20-row ear list with blank verdicts for the next session to score.

## Session X — 173 precision/recall measured — 2026-08-22

Ingested 173's 24 ear verdicts (5 real defects) into the ear-pass ledger and measured, for the
first time, every live boundary-defect signal's precision/recall against them: still-playing
detector recall 20%/precision ≈17%; silence-distance>20ms recall 20%/precision ≈6%;
R.5/R.10/R.11/R.12/R.13 all 0 fires on 173. The v6 silence-midpoint geometry does not
generalize to 173. Chased a 45-46 boundary non-determinism to a likely mechanism (ONNX
Runtime's unpinned intra-op thread pool) — inferred, not directly confirmed. Ruling R-MD
(FA-confidence suppression signal) came back negative.

## Session Y — engine determinism pinned — 2026-08-22

Phase 1 pinned ONNX determinism (byte-identical 3× on 173/v6), though the mutation control was
also byte-identical, leaving the gate inert on this hardware. Phase 2 tested and refuted the
word-gap placement hypothesis (2/5 candidate rows refute) — ships nothing. Phase 3 designed,
not implemented. Phase 4a blocked (no TTS/audio tooling available to source WPM corpora).

## Session Z — chunk-plan hypothesis refuted — 2026-08-22

173's chunk counts were non-deterministic across captures (118/119/126) but word-level FA
output stayed byte-identical despite the chunk-edge differences — the chunk-plan hypothesis for
the 45-46 divergence was REFUTED by this, verdict left UNEXPLAINED. `CONF_MIN_FALLBACK=0.056`
derived from the empty gap between confidence distribution modes. Word-gap pre-roll rule ships
nothing (second negative in a row).

## Session AA — near-zero confidence predicts nothing — 2026-08-22

Found near-zero FA confidence predicts neither token class nor misplacement — Session Z's
"unreliable placement" reading was a misreading. R.10 stayed evidence-backed (850× margin);
R.11 stayed under-evidenced (2.8× margin). No confidence guard wired. Word-gap candidates
refuted a third session running.

## Session AB — R.11 firings corrected — 2026-08-22

Corrected R.11's "six ear-confirmed firings" premise to two real ones, and re-derived and
shipped a wider-margin threshold: `R11_MAX_SPAN_WORD_CONF` 1.0835e-2 → 3.9362e-3 (~4× margin).
A third Class A discriminator candidate topped out at 40% precision — not shipped.

## Session AC — register drift audit, Stage 1 exit scorecard — 2026-08-22

Full register drift re-audit (came back byte-identical to the prior record) plus a formal
Stage 1 lock-gate scorecard: 3 exit criteria MET, 6 NOT MET, 5 WAIVED-WITH-REASON. Concluded
the register's 8 open rows and the Spanish reopening trigger are the only two binding
blockers left for the lock.

## Session AD — ledger correction, two negative discriminator searches — 2026-08-22

Reinstated `152_frozen_brush_mice` to 451.03 (450.99 was a transcription slip). Two more
negative searches: a Class A amplitude/energy discriminator (worse than the prior 0.400
precision) and a Class B amplitude floor re-derivation (reaches 5/5 recall at native rate but
flags one new unscored boundary) — neither shipped.

## Session AE — R.14/R.15 shipped — 2026-08-23

Discovered `ordinalDelta` as the real Class A/B separator (not interval word count). Shipped
R.14 (smeared-anchor placement) and R.15 (tail attribution) in `faAnchorTrustGate.ts`, zero
false positives across 37+ ear-verified controls in 3 corpora. Register: 8→14→7 open in one
session, closing the long-standing `152_frozen_brush_mice` item among others.

## Session AG — phantom-tail mechanism confirmed — 2026-08-23

Confirmed the phantom-tail mechanism as causal via a fold (`foldPhantomTails`, S1): drops R.14
v6 firings 11→1, fixes 10/13 attributed rows — but costs 2 ear-verified control regressions,
so `foldPhantomTails` defaults false. Built, measured, deliberately not shipped. Its listening
gate drew 19 rows across three corpora (v6 21 moved / 173 1 / spanish 1) — close to but not
identical to the pre-registered 21-row prediction, not itself a red flag.

## Session AH — S1 rejected and rolled back — 2026-08-23

S1 rejected on 18/18 operator ear regressions and deleted outright from `faChunkPlan.ts` (not
just disabled) — committed boundaries verified byte-identical pre/post rollback. Ruling R-AS:
a detector's precision must be measured before its repair ships (S1's underlying signal was
~7% precision, should have blocked it). 173's long-standing chunk-plan discrepancy (126 vs.
119) retired as undetermined cause, re-captured at 119. Ruling R-AT: a no-ears word-gap-
containment validation proxy FAILS (negative separation margin) — any S2 validation needs real
ears, no shortcut works. The rejected S1 fold's own root-cause analysis found the phantom-tail
mechanism explains 10/13 attributed v6 defects via a measured waveform proof (e.g.
`231/230_slowing_pace`: true silence 681.47–682.43s vs. FA's smeared 681.64–682.34s) and a
10-row phantom-tail census (66.1% v6 / 38.7% 173 / 60.0% spanish of chunks carry a phantom
tail). It also named two still-unsolved defect mechanisms outside S1's scope, for which no rule
is designed: `iron_bounce` (173, wrong-silence-selection — a real silence exists but is the
wrong one) and `gadget_decay` (173, no usable chunk edge or silence at all — its ear target
sits 0.06s past its own segment's first-word onset, unreachable by any right-edge-minus-pre-roll
placement). Both remain open; tracked at the class level in `project-state.md`'s Open Decisions §3(a)
and by boundary id in that file's Current State table (173 5-6/106-107).

## Session AI — S2 built, not shipped — 2026-08-23

Built `computeFaChunkPlanS2`: eliminates the phantom-tail funnel condition to 0 on all 3
corpora, but causes severe alignment drift on v6 (up to -27.7s), regressing 36 ear-verified
controls (30 v6 + 6 173) — a hard fail vs. the ship gate. Not shipped, not deleted; the defect
is in FA quality on longer chunks, not in the planning logic itself. (Its own 372-row listening
bill tallies 35 control-moved rows rather than 36 — a minor unreconciled discrepancy in the raw
count, not in the shipped conclusion, since S2 stays unshipped either way.)

## Session AJ-0 — machine oracle installed — 2026-08-23

Extracted and installed the operator's ear-verified live-app saves as a machine oracle
(`session-aj0-oracle-*.json`) for regression testing. Solved `vessel_damage_clue`'s apparent
non-determinism as a stale default-bundle pointer, not a real FA non-determinism. Reconciled
Session AI's apparent unaccounted-boundary discrepancy — no rows were actually lost.

## Session AK — R.5 excision a contributing, not sole, cause — 2026-08-23

Three-arm ablation: R.5 (unscripted-run) excision repairs 14/30 of v6's S2 drift regressions
exactly, but is inert on 173/spanish (zero R.5 runs there) — yet 173 still regresses 40
boundaries identically under both arms, refuting excision as the general cause. Confirmed the
drift is an "arch" (peaks mid-corpus, returns to ~0 in the final decile), not a cumulative
error. Global S2 implied precision measured at 0.62%, far under the 50% ship gate. Escalated,
not shipped.

## Session AL — chunk width eliminated as cause — 2026-08-24

A period-strict 1–15s chunk band (half the median width of the 10–30s baseline) made drift
*worse*, not better (peak -20.617s vs. -19.155s) — eliminating chunk width as the driver.
Traced the arch's real correlate to `applyAnchorBasedTiming`'s own per-decile estimate error
(r=0.9940), consistent with a conserved-total redistribution error rather than an accumulating
one. v6 only. The supporting 110-row chunk census found arm D's own narrower band still blew
its own cap 22 times (plus 2 oversize-unbreakable-groups, 4 excision-collapsed-chunks) —
narrowing the band didn't buy structural cleanliness either. Period-detection census: 368
sentence ends, 0 disagreements with `s2EndsSentence`.

## Session AM — chunk-edge placement identified as driver — 2026-08-24

Confirmed chunk-edge placement, not width, drives the drift arch: substituting three-source-
agreement anchors for estimate-derived chunk edges (arm F) cut oracle regressions 76%
(279→68) and killed the arch outright (peak 3.249s, under the ≤5.0s DIED band). A diagnostic
oracle-placed-edge arm (G) went further (0.042s, 2 regressions) as the ceiling. `231_slowing_
pace` traced end to end as direct mechanistic proof. Arm F itself failed the ship gate (2.86%
implied precision vs. 50% bar) — not shipped, but the S2 research line continued from here.
Arm G's 3-regression ceiling is not contaminated by its own oracle's 3 known-defective rows
(`214_solitary_fire`, `231_slowing_pace`, `447_scout_facing_dark`) — none lands on a chunk seam
arm G actually uses, confirmed by a 229-file scan showing arm G's attested-table lookup is
structurally unreachable from any production path. The anchor set feeding arm F was
independently measured GEOMETRIC (0 fitted numeric constants): 325 anchors, 100%
three-source-agreement, 85.6% seam coverage, uniform across deciles (no front-loading
confound) — ruling out the substitution being gamed to the target rows.

## Session AN — arm H widens the search, still not shippable — 2026-08-24

Widening the anchor search one sentence-group further at arm F's 5 unresolved fallback seams
(arm H) cut v6 oracle regressions a further 32% (68→46), shrank the arch 9× (3.249s→0.349s),
and landed all 3 previously-open v6 defects for the first time in the workstream. 173 also
improved (40→31 regressions vs. arm C) with no arch at all. Still far under the 50% ship-gate
precision (6.12%) — nothing shipped. The pre-registered edge-accuracy budget found the
edge/boundary error correlation real (Pearson r=0.876) but explicitly NOT STEEP — substitutable
edges could close at most 26 of the 67 residual v6 boundaries, not the looser 39 first
estimated, bounding how much further an arm-H-style widening could ever buy. The measurement's
own automated adjudication function initially mis-scored this result as a failure (a hardcoded
`false` conflating "proxy curve didn't cross" with "arm H worsened something"); caught and
corrected in the same session, with HARD FAIL 3 confirmed not firing and both the internal
PROGRESS and SHIP-CANDIDATE review bars met. On 173, arm H's peak drift fell to 1.988s from arm
C's 3.854s (both already under the DIED band, so 173 shows no arch either way) — but
`gadget_decay`, one of 173's two open defects, still does not land under arm H. **This is the
last entry in the S2/chunk-edge research line: as of the 2026-08-25 accuracy-bar decision
recorded in `docs/work-in-progress.md`, further chunk-width/chunk-edge research is frozen —
current ~97–98% accuracy is accepted and remaining errors go through manual review instead.**

## Audit — 2026-08-25 — Open-bugs audit closes the chunk-plan non-determinism bug as not applicable

Re-examined `work-in-progress.md`'s "FA chunk-plan generation is non-deterministic on 173
(118/119/126)" bug against current `main`. Already settled by Session AH's own bisection (Part
AB.7 above): the three counts trace to three different commits/bundles, not three runs of
identical code — every tree from `4b9bea9` through HEAD computes 119 deterministically
(byte-identical `chunk[11]`), and the 126-chunk bundle was traced to code that never landed in the
repository (an uncommitted Session P working state) and was RETIRED that session. No commit since
has touched the production chunk-plan path — every `faChunkPlan.ts` commit after Session AH adds a
diagnostic-only S2 arm with no production caller (Session AN's own verification line: "the
production default remains untouched"). Removed from `work-in-progress.md`'s Open bugs. Full audit
trail: `sync-pipeline-v2-plan.md` Part AI §3.

### 2026-08-25 · ace07c7 · ace07c7-multi-project-storage-migration
Outcome: Multi-project dashboard's persistence/migration layer (localStorage registry +
IndexedDB v2 scoping) — moved verbatim out of `docs/history.md`'s frozen "Priority 2" section,
which now points here; original work merged 2026-06-11/12.
Evidence: manual (pre-dates the gate ladder) — verified behaviours listed below were asserted
in-app at merge time, not re-derived this session.
Numbers: 3 commits (OPERATOR-DIRECTED selection of the storage/migration-relevant subset of the
larger priority-2 commit run).
Detail:
**What was built**
- Persistence layer (Task 2): project registry `kinetix:projects:v1` in localStorage holding
  `ProjectMeta[]`; per-project storage `kinetix:project:{id}:v1` key per project; IndexedDB
  assets store upgraded to v2 with projectId scoping and compound keyPath `['projectId', 'id']`;
  `migrateLegacyIfNeeded()` copies v1 IDB assets and v1 localStorage project to new scoped keys
  on first launch — the one-shot v1→v2 migration.
- Multi-project picker (Task 5): full-screen dashboard, grid layout with thumbnail/name/scene
  count/last-saved date, three-dot rename/delete menu, search bar, + New Project button, current-
  project badge, ← Projects nav.
- Session/launch behaviour: `sessionStorage` `lastOpenedProjectId` — reload reopens the last
  active project, full app close+reopen shows the dashboard; `clearLastOpenedProjectId()` called
  on all three user-initiated dashboard-navigation sites; `confirmed` flag on `Project` gates
  autosave so an unconfirmed default project never pollutes the registry.
- Thumbnails: `buildThumbnailBase64()` draws the blob URL onto a 320×180 offscreen canvas,
  exports JPEG at 0.7 quality (~15–25 KB/project), written to meta immediately (not deferred to
  the debounced save) — survives app restart as a plain-text base64 data URL.

**Commits**
- `ace07c7` — feat: multi-project dashboard + persistence scoping + manual save. Introduces the
  registry pattern, `migrateLegacyIfNeeded` (v1→v2 migration), and the IDB v2 `assets-v2` store
  (compound keyPath `[projectId, id]`, `byProject` index).
- `c625561` — fix: dashboard duplicate project + remove back button + thumbnail meta. Closes the
  phantom-duplicate-on-New-Project bug; deleting a project removes its card and all associated
  localStorage + IDB data.
- `a6c13dd` — fix: reload reopens last active project via lastOpenedProjectId. Adds
  `setLastOpenedProjectId`/`getLastOpenedProjectId` (key `kinetix:lastOpenedProjectId`) and the
  hydration-time skip-to-last-project path.

**Key files (as of the original merge):** `src/types.ts` (`ProjectMeta`, `Project.confirmed`),
`src/services/projectStore.ts` (registry, per-project keys, `lastOpenedProjectId` helpers),
`src/services/assetStore.ts` (projectId scoping, v2 IDB upgrade, `getLegacyAssets()`),
`src/hooks/usePersistProject.ts`, `src/components/ProjectDashboard.tsx`,
`src/components/NewProjectModal.tsx` (new), `src/App.tsx` (hydration rewrite).

**Verified behaviours (asserted at merge time):** dashboard appears on fresh launch, last
project reopens on reload; no duplicate "Untitled Project" on creation; thumbnails load from
base64 on fresh launch; deleting a project removes its card and all localStorage + IDB data;
search filters in real time; confirmed flag prevents blank-project registry pollution.
Superseded-by: none

### 2026-08-25 · 6a1b939 · 6a1b939-fa-session-cache-oom-fix
Outcome: WS1 Session AP's FA ONNX session-cache OOM closed — root cause (build-then-drop
session eviction) fixed by swapping to drop-then-build; a memory-pattern fix landed earlier the
same session (`a6f2978`) measured statistically indistinguishable from no fix and is superseded
by this entry, not a separate cause. Moved out of `docs/work-in-progress.md`'s "Other active
work" (now a one-line pointer there) per the 2026-08-25 audit.
Evidence: rss-guardrail = PASS (peak RSS 2894.5 MiB, MEASURED `cargo test --features
fa-inference -- --ignored guardrail_multi_corpus_peak_rss_bounded` @ `c295cb3`); golden replay
6/6, oracle diff green, 13 production pins, full `npm test`/`cargo test --features fa-inference`
suites all green (MEASURED, same SHA range).
Numbers: peak RSS 3844–4066 MiB (`a6f2978` alone, 3-run spread) → 2743.7 / 2894.5 MiB
post-fix (~30% reduction); spanish cache-miss jump 763–1330 MiB → 137.2 MiB (MEASURED,
`6a1b939`/`c295cb3` commit messages). Real-app confirmation: ~21-minute V8 corpus project
completed Apply Sync via `npm run tauri:dev:fa`, no crash, ~2.58 GiB RSS afterward
(OPERATOR-ATTESTED).
Detail: `with_cached_session` (`src-tauri/src/fa_onnx.rs`) rebuilt the replacement ONNX session
before dropping the incumbent one (build-then-drop), briefly co-residing two sessions on every
cache-miss reload (language switch) — ORT's allocator never returns those pages to the OS, so
the transient became the new floor. Fixed by swapping to drop-then-build. Output-neutral: exact
word-timing and `needsReview`-flag equality on v6/173/spanish, confidence drift up to 2.6e-5
(v6)/8.9e-5 (173)/4.6e-6 (spanish), never crossing the 0.3 `needsReview` threshold. Guardrail
test added (`c295cb3`, `guardrail_multi_corpus_peak_rss_bounded`, 3500 MiB ceiling,
`#[ignore]`d/`require_ort`-gated, not in the default sweep) so this class of regression — it
already regressed once, closed by the since-superseded `a6f2978` — has a test from here on.
Full detail: `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` Part AI's AI.1 Addendum.
Superseded-by: none

### 2026-08-26 · 2ae4d18 · 2ae4d18-ws2-bug1-trusted-spine
Outcome: WS2 bug 1 (a low-confidence segment's rescue anchoring out of order vs. its neighbors)
closed. AJ.4's naive backward ordering bound — nearest earlier segment with ANY genuine global
match, unconditional reject on violation — is replaced with a trusted spine that treats an
overflowing predecessor as transparent (skips it) and lets a genuine conflict resolve by
evidence instead of an unconditional reject. Moved out of `docs/work-in-progress.md`'s "In
progress" section (was `[OPEN] WS2 bug 1`) per this session's gate-verified pass.
Evidence: gate_verified — all 13 previously-failing WS6/Bug C "P-blocks-C" tests pass
UNMODIFIED (MEASURED, `2ae4d18`); the 3 Bug 1 regression tests from WS2 Step 4 pass unmodified,
re-verified they fail on pre-fix `whisperService.ts` (git-stash both-states check); full
`src/services/syncTiming.test.ts` 260/260; `gaplessInvariant.test.ts` 36/36; golden replay
6/6, v6/173/spanish byte-identical (444/172/26 kept, zero delta); full `vitest run src scripts`
2512 passed / 0 failed outside one CPU-contention timeout on an unrelated slow test (isolated
re-run passed twice, ~42-46s, matching baseline — NOT DETERMINED to relate to this change);
`cargo test` 141 passed / 0 failed (no Rust touched). Full design rationale, the AJ.4 no-op
proof, the Row 8a confidence-vs-count finding, and the complete evidence table:
`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` Part AJ's AJ.5.
Numbers: 13/13 target tests fixed; 0 regressions in 2512 measured passing tests; 3-corpus golden
replay delta: 0 boundaries moved on any of 444/172/26 kept segments.
Detail: root cause was that AJ.4's bound was mathematically a no-op wrapper around "consult the
nearest genuine neighbor unconditionally" — genuine global matches can never be mutually
inconsistent (one monotonic Hirschberg alignment), so no filtering of genuine-only matches can
ever produce a different answer than the naive bound. The fix instead lets a segment's own
rescue candidate compete against a conflicting genuine predecessor: transparent when the
predecessor's own matches straddle the candidate (P-overflow), evidence-ranked (raw matched-word
count primary — confidence alone is gameable by segment length, verified live via the Row 8a
fixture) when not. Layer 2: a permanent, detection-only diagnostic
(`src/services/residualOrderingDetector.ts`) added independently, logging (never correcting) any
residual ordering violation in the committed anchor set immediately before the `setProject`
commit in `App.tsx`.
Superseded-by: none

### 2026-08-26 · d8baef5 · d8baef5-ws2-bug2-fa-compiled-into-installer
Outcome: WS2 bug 2 (forced alignment silently unavailable in every shipped desktop build, with no
signal that it was off) closed at the build level. `build.yml` now passes `-f fa-inference` to
both matrix targets' `tauri build` (a Cargo.toml default feature was rejected so `cargo
check`/`cargo test` and the `fa-ort-matrix.yml` feature-off cell stay feature-off), provisions
`libonnxruntime.1.23.2.dylib` on the macOS runner via the existing `src-tauri/onnxruntime/
README.md` recipe with a sha256 gate, and a new guard step fails the build if `src-tauri/models/`
holds a stray `*.bin` at bundle time. Layered with a new `'fa-gate-closed'` Sync Log entry
(`App.tsx`) so a closed gate is visible in-app rather than silent. Moved out of
`docs/work-in-progress.md`'s "Other active work" (now a one-line pointer there) per this
session's close-out.
Evidence: CODE FIX, MACHINE-VERIFIED — `npx tsc --noEmit` clean; `npx vitest run src scripts`
(excluding the pre-existing, unrelated stray worktree `.claude/worktrees/elated-haibt-ab90e1/`,
a leftover checkout missing its own private replay corpora, confirmed by `git worktree list`)
2513 passed / 0 failed, 109 test files; `gaplessInvariant.test.ts` 36/36; golden replay 6/6;
`cargo test` (default) 141/141, `cargo check --features fa-inference` clean. A real local `tauri
build --target x86_64-apple-darwin -f fa-inference` was run to confirm bundle contents/size.
Then OPERATOR-ATTESTED on a 2026-08-26 local-build run (import, preview, export all worked) —
but that run did not specifically exercise forced alignment (`FA_PROJECT_DEFAULT_ON` is `false`
by ruling, so a default sync never invokes FA at all): the FA-runs-in-a-real-build claim itself
stays operator-attested only, not confirmed, and the arm64/Windows CI legs remain NOT
DETERMINED — no arm64 or Windows runner was available to this session or to the operator's local
build (Intel dev machine).
Numbers: installer FA capability — OFF-and-silent → compiled-in with an explicit Sync Log
signal when the per-project gate is still closed.
Detail: bug 2 had two independent causes — (1) `fa-inference` was never passed to the release
`tauri build` invocation at all, so no shipped binary could run FA regardless of the per-project
toggle; (2) even with FA compiled in, a closed gate produced no user-visible signal. This entry
closes both. Design + full verification narrative: `sync-pipeline-v2-plan.md` Part AJ (AJ.1).
Superseded-by: none

### 2026-08-26 · 8c6e4e8 · 8c6e4e8-ws2-bug4-in-app-model-download
Outcome: WS2 bug 4 (the bundled `ggml-large-v3-turbo.bin` inflated the installer to 4.7 GB and
required hand-placement) closed. `whisper.rs`'s `model_path` now checks `app_local_data_dir()/
models/` first, ahead of every existing fallback; new `model_download.rs` streams the model into
a `.part` file with HTTP Range resume and SHA-256 verification before an atomic rename; new
`ModelDownloadPanel.tsx`/`modelDownload.ts` give it progress/cancel/resume/retry UI, reachable
manually (Project Settings → Sync) and automatically (`TranscriptionBar`'s model-not-found
prompt). `tauri.conf.json` no longer bundles `models/*` at all. Moved out of
`docs/work-in-progress.md`'s "Other active work" (now a one-line pointer there) per this
session's close-out.
Evidence: CODE FIX, MACHINE-VERIFIED — same build-level suite as bug 2 above (`tsc` clean,
`vitest` 2513/0 excluding the known stray worktree, `gaplessInvariant` 36/36, golden replay 6/6,
`cargo test` 141/141), plus this commit's own prior, separately-recorded OPERATOR-ATTESTED live
verification (2026-08-26, against a real built app): start, live progress, cancel-with-partial-
kept, and resume-from-partial all confirmed working — a real bug was caught and fixed in that
same pass (`ModelDownloadEvent`'s `rename_all` was on the enum instead of the `Progress` variant,
so the UI stayed stuck at 0/0 while the `.part` file grew correctly on disk). Today's separate
Step 8 operator run (import/preview/export) did NOT re-exercise the download path — that surface
rests on the prior attestation above, not today's test. CI-installer verification (the actual
compiled installer's bundle size and download flow on a CI-built artifact, arm64/Windows
included) remains NOT DETERMINED.
Numbers: installer size 4.7 GB → 135 MB `.app` / 4.2 GB → 47 MB `.dmg` (local build, MEASURED at
commit time, not re-measured this session).
Detail: URL/size/hash are hardcoded constants cross-checked against a real local copy's measured
SHA-256 and the Hugging Face API's `lfs.oid` for the same file — matched exactly (1,624,555,275
bytes). FA's own per-language `.onnx` models still have no downloader (NOT DETERMINED — no
canonical download source exists in the repo); the existing manual-placement error message is
the accepted interim path, left unchanged by design. Design + full verification narrative:
`sync-pipeline-v2-plan.md` Part AJ (AJ.1).
Superseded-by: none

### 2026-08-26 · no-fix · ws2-bug3-closed-did-not-reproduce
Outcome: WS2 bug 3 (an externally-exported video imports and shows in the timeline but never
advances in preview, while the same asset exports and plays correctly) closed as
DID-NOT-REPRODUCE against a HEAD build. NO CODE FIX EXISTS. Operator ran import/preview/export
against a current `main` build on 2026-08-26 and all three worked; the original bug report traced
to an installer 8 commits stale. Moved out of `docs/work-in-progress.md`'s "Other active work"
(was `[OPEN] WS2 bug 3`) per this session's Step 8/Step 9 close-out.
Evidence: OPERATOR-ATTESTED — 2026-08-26 live run (import, preview, export) against a HEAD build,
no freeze observed. The prior diagnosis session (`docs/ws2-video-ingest/bug3-diagnosis.md`,
sessions `ws2-06`/`ws2-07`) established three facts by direct measurement, preserved here since
they remain true regardless of the non-repro: (1) the `elst`/edit-list hypothesis is ruled out by
direct ISOBMFF box inspection of the reported-failing asset — no `edts`/`elst` box exists in the
file at all, and `mvhd`/`tkhd`/`mdhd` durations agree exactly at 5.0s; (2) all 10 assets in the
operator's failed-export folder are uniformly H.264 High@4.2, 1920x1080, yuv420p, bt709, 120fps
CFR, no audio track, 5.000000s duration (MEASURED via `ffprobe` on all 10 files,
`.work-phase4/session-ws2-07/asset-probe.txt`); (3) a code-level decode-ahead buffer overflow was
reproduced against the real, unmodified `videoDecoderPool.ts` (mock-`VideoDecoder` harness fed the
asset's actual measured 120fps/600-frame profile) — `MAX_BUFFERED_FRAMES_PER_SESSION = 90` sized
against `WINDOW_AHEAD_SEC = 1.5s` for ~24-30fps content overflows at 120fps within the first
decode-ahead batch, permanently dropping the excess since `feedCursor` has already advanced past
it. Live-app confirmation of THIS specific decode-overflow mechanism was never obtained (blocked
twice: no Tauri UI driver reachable in session `ws2-06`; `request_access` for the native app
denied by the user in session `ws2-07`) — the mechanism remains a code-level reproduction, not an
on-screen observation, and the 2026-08-26 non-repro run does not itself rule the mechanism in or
out (it was not instrumented to check for it).
Numbers: 10/10 probed assets share the identical 120fps CFR profile; 0/3 (import/preview/export)
reproduced the freeze on the 2026-08-26 HEAD-build run.
Detail: the report that triggered the original diagnosis was 8 commits stale relative to the
build used in the 2026-08-26 verification run — the underlying code may have changed in the
interim (e.g. other WS2 fixes landing), or the original report's exact build/asset/environment
combination may not have been reproduced. Because the reproduced buffer-overflow mechanism
(§B3/B4 of the diagnosis doc) is a real, code-level defect independent of whether THIS bug report
reproduces, it is tracked separately and NOT closed by this entry — see
`docs/work-in-progress.md`'s `[DEFERRED] 120fps preview decode lag` row, the sole remaining
record of that mechanism. Full diagnosis: `docs/ws2-video-ingest/bug3-diagnosis.md`.
Superseded-by: none

### 2026-08-26 · correction · ws2-bug2-ort-runtime-platform-gap
**CORRECTION NOTE — does not edit the entry above (`d8baef5-ws2-bug2-fa-compiled-into-installer`),
appended per this session's WS2 Step 10 diagnosis.** That entry's closure is about the *compiled*
feature flag and the closed-gate Sync Log signal, and both remain true and unchanged. What needs
qualifying: forced alignment is now compiled into **every** shipped target (`-f fa-inference`
passed to both `build.yml` matrix legs), but the **onnxruntime C runtime it depends on at
runtime is still bundled for macOS x86_64 only** — `fa_onnx.rs:319`'s `resolve_bundled_ort_dylib`
hard-gates on `cfg!(all(target_os = "macos", target_arch = "x86_64"))` and fails loudly (never
silently) on every other target. Confirmed this session: a Windows installer build's
`[FA PRE-FLIGHT]` Sync Log entry read "not ready — the alignment runtime did not load for
'en'... no bundled onnxruntime C runtime for this target (windows-x86_64)" — this is the gate
firing **correctly**, not a regression, but it means bug 2's "FA compiled in" fix does not by
itself make FA runnable on Windows. The operator's Mac is Intel (x86_64) per this session's Q1 —
so Apple Silicon Macs carry the identical gap, unverified until now: `build.yml`'s macOS leg
targets `universal-apple-darwin` (a fat binary spanning both architectures) but its ORT
provisioning step fetches only the x86_64 `.dylib`, and no arm64 Mac has been available in any
session to date to confirm what actually happens on that architecture at runtime.
Evidence: MEASURED (Sync Log text quoted verbatim from the operator's Windows run, this session's
operator report) for Windows; the arm64 gap is code-read (`fa_onnx.rs:319`'s `cfg!` condition)
plus `build.yml:124-148`'s provisioning step fetching only `onnxruntime-osx-x86_64-1.23.2.tgz` —
NOT independently confirmed on real arm64 hardware this session or any prior one.
Detail: full scoped plan for closing this (Windows DLL provisioning, generalizing the
`fa_onnx.rs:319` gate to a per-platform table, an arm64 macOS slice) sized but explicitly NOT
built this session (out of scope by operator instruction) — `docs/ws2-video-ingest/step10-windows-fetch-diagnosis.md`'s
"B3" section. New WS2 open item tracking this: `docs/work-in-progress.md`'s
"Operational / verification tasks" section (add: FA runtime provisioning for Windows + macOS
arm64 — no code exists yet, unlike bug 2's compiled-in-but-gated state for macOS x86_64).
Superseded-by: none

### 2026-08-26 · 88ff701 · 88ff701-ws2-step10-error-serialization
Outcome: a Tauri `invoke()` rejection that is a plain JSON object (any `#[tauri::command]`
returning `Err(struct)`, e.g. `FaError { kind, message }`) was being stringified via the naive
`err instanceof Error ? err.message : String(err)` pattern, which collapses a plain object to the
literal text `"[object Object]"` — exactly what the operator's Windows Sync Log showed for the FA
FALLBACK entry (`error: [object Object]`), discarding the actual backend message
("failed to initialize onnxruntime: no bundled onnxruntime C runtime for this target
(windows-x86_64)...") the user most needed to see. Root cause: `fa_align_production`
(`fa_production.rs`) returns `Result<(), FaError>`; when it errors before ever emitting a
`Channel<FaEvent>` event (e.g. the ONNX runtime failing to load), the JS-side `invoke()` promise
rejects with the JSON-deserialized `FaError` object directly — not an `Error` instance, not a
string — and `forcedAlignmentRun.ts`'s existing `.catch()` handler's `String(err)` call on that
object produced the garbled text.
Fix: new shared `src/services/invokeError.ts`'s `describeInvokeError()` — prefers an `Error`'s own
message, a raw string, then an object's own `.message` field (the shape every serde-serialized
Tauri command error in this codebase uses) before falling back to a JSON dump, never the bare
`String(err)`. Wired into both places carrying the same defect class: `forcedAlignmentRun.ts`
(the FA FALLBACK entry's `detail`, both the channel-error catch at what was line 183 and the
outer catch at what was line 204) and `faPreflight.ts` (the FA PRE-FLIGHT entry's
`blockingDetail`, for a rejected `fa_preflight` probe call).
Evidence: CODE FIX, MACHINE-VERIFIED — new `src/services/invokeError.test.ts` (9 tests, including
one asserting the fix directly: "never collapses an object rejection to '[object Object]'");
`npx tsc --noEmit` clean; full `npx vitest run` outside the pre-existing stray worktree
(`.claude/worktrees/elated-haibt-ab90e1/`, missing its own private replay corpora — the same
documented exclusion as the `d8baef5`/`8c6e4e8` entries above) 4988 passed / 0 failed / 154
skipped across 209 test files (30 failures, all inside the stray worktree only, none in `src/` or
`scripts/`); `gaplessInvariant.test.ts` 36/36; `scripts/phase4-handoff-replay-sync.test.ts` (the
real, non-worktree copy) 6/6, byte-identical committed totals for v6 (1421.29s),
173 (709.01s), and spanish (92.04s); `cargo test` 141/141, 1 ignored (pre-existing, unrelated to
this change).
Numbers: `[object Object]` → the real backend message, for both the FA FALLBACK entry and the FA
PRE-FLIGHT entry's blocking-detail line.
Detail: this is a general JS defect (not Windows-specific in mechanism) that happened to surface
first on Windows because that is the platform whose onnxruntime is unprovisioned (see the bug 2
correction note above) — the same garbled text would appear on any platform whose
`fa_align_production` call rejects before its first `Channel` event.
Superseded-by: none

### 2026-08-26 · 56e2116 · 56e2116-ws2-step10-windows-voiceover-fetch
Outcome: Windows installer's Apply Sync run reported `[SILENCE] Silence detection failed... reason:
voiceover fetch failed: Failed to fetch`, degrading every boundary to the token-midpoint fallback
(the 117 "cuts landed on audio that's still playing" entries in the same run are a consequence of
this, not a separate defect — confirmed structurally, not re-investigated individually per the
operator's own framing). Root cause NOT fully determined down to the exact WebView2-internal
mechanism (no Windows hardware available this session) but hard-narrowed: `useWhisper.ts`'s
`fetchAndDetectSilences` called `fetch(asset.url)` unconditionally; `Asset.url` is always a
`blob:` object URL from `URL.createObjectURL()` (never the Tauri asset protocol, never a
filesystem path — confirmed by exhaustive grep, zero `asset://`/`assetProtocol`/`convertFileSrc`
references anywhere in the codebase or its Tauri capabilities). The same-run video preview
(`PreviewStage.tsx`'s `<video src={asset.url}>`) decoded the identical URL scheme successfully in
the same build — the one concrete code-level difference between the two consumers is DOM-native
media loading vs. an explicit Fetch API call.
Fix: `fetchAndDetectSilences` now prefers the already-in-memory `asset.file` (present for a
freshly-staged voiceover — the operator's exact scenario) and only falls back to
`fetch(asset.url)` when `.file` is absent (a project asset reconstructed from IndexedDB after a
reload never carries a `File` — `projectStore.ts` strips it before persisting). This mirrors an
established, already-shipped pattern (`App.tsx`'s `resolveVoiceoverDuration`, introduced in
`0aac444` for a different original reason — a reload losing the `File` reference — but the same
shape of fix) that three other call sites already carried; this function did not.
Evidence: CODE FIX, MACHINE-VERIFIED (macOS only — see below for what stays unverified). New
`src/hooks/useWhisper.test.ts` (4 tests) is a genuine regression test: confirmed failing against
the pre-fix code via `git stash`/`git stash pop` bisection (3 of 4 cases failed — the export
didn't exist pre-fix, and the fetch-avoidance assertion failed since fetch was called
unconditionally) and passing after. Same suite counts as the error-serialization entry above (one
combined `npx vitest run`/`cargo test`/`tsc` pass covered both fixes): 4988/0/154 across 209 files
outside the stray worktree, `gaplessInvariant` 36/36, golden replay 6/6 byte-identical (v6/173/
spanish), `cargo test` 141/141. `npm run build` (frontend) succeeds cleanly and the built bundle
contains the changed string literal (`voiceover fetch failed`), confirming the fix shipped into
the artifact; a full `npm run tauri:build` installer was NOT produced this session (time/scope) —
the operator's own local build is the next real installer build.
**NOT DETERMINED, explicitly carried forward:** (1) the exact WebView2 mechanism behind the
original failure — candidate ruled the strongest by cross-signal contrast (A4 in the diagnosis
doc), not proven; (2) whether the 303/2855 filtered-token count is Windows-specific — needs the
operator's promised macOS run on the identical project for comparison; (3) live confirmation on
real Windows hardware — the operator must rebuild and re-run.
**Windows verification steps for the operator:** rebuild via `build.yml` (or a local Windows
`npm run tauri:build`), run the same project's Apply Sync, and check the Sync Log for: no
`[SILENCE]` entry with a "voiceover fetch failed" reason (or, if one appears, that it names a
different underlying cause than "Failed to fetch"); the `[INFO] N cuts landed on audio that's
still playing` count should drop from 117 toward whatever a real silence-informed sync produces
for this project (not necessarily zero — some loud-fallback boundaries can be legitimate even
with working silence detection); no `[object Object]` text anywhere in the log (the separate
error-serialization fix above should make the `[FA FALLBACK]` line, if it still appears because
Windows ORT remains unprovisioned, show the real message instead).
**Cross-platform blast radius, found but NOT fixed this session** (operator instruction — wants
to review the list before authorizing further changes): 8 other unguarded `fetch(asset.url)` call
sites carrying the identical defect shape (no `asset.file` fallback) — `App.tsx:3781`/`:3901`
(dev-only instrumentation), `videoDemuxer.ts:66`, `waveformPipeline.ts:81`,
`segmentEncoder.ts:416`, `whisperService.ts:1686`, `exportPipeline.ts:277`,
`webcodecsExport/exportWorker.ts:301` (runs inside a Web Worker — a materially different, likely
more fragile case), `webcodecsExport/exportPipelineWebCodecs.ts:1031`. Full list with per-site
notes: `docs/ws2-video-ingest/step10-windows-fetch-diagnosis.md`'s "A6" section. New WS2 open
item: `docs/work-in-progress.md`'s `[IN-PROGRESS]` row for this bug names the same list.
Full diagnosis (candidate ruling, A1-A6, deviation note on the C1 test spec, B3 sizing):
`docs/ws2-video-ingest/step10-windows-fetch-diagnosis.md`.
Superseded-by: none

### 2026-08-26 · WS2 Step 11 · ws2-step11-fa-model-provenance-a5
Outcome: operator ran Apply Sync on an Intel Mac install with High-Precision Auto-Sync (FA)
manually flipped ON in Settings and English selected; Sync Log showed `[FA PRE-FLIGHT] FA
pre-flight: ready — runtime loaded and model present for "en"` and `[INFO] Timing engine: forced
alignment (2181 aligned word(s))` — FA ran genuinely end-to-end, MEASURED (operator-attested log,
not re-derived). This supersedes `docs/work-in-progress.md`'s prior note that FA "has never been
observed running in any packaged desktop build" — narrowed to: never observed running from a
*fresh, unmodified* install.
A5 provenance investigation (this session, before any Phase B/ORT work, per operator instruction
to resolve provenance FIRST): `app_local_data_dir` for identifier `com.kinetix.pro-studio`
resolves to `~/Library/Application Support/com.kinetix.pro-studio/` (macOS Tauri v2 convention,
confirmed via `fa.rs:470`'s `app.path().app_local_data_dir()`). `fa-models/{en,es,fr,de,pt}/
model.onnx` all exist there, each ~1.26 GiB, sha256 for `en` = `48a3c2e143a9741e92a7ccd7e0600af
e498e2c42c3dc01f78bc0c335f916240f` — byte-identical to the sha `sync-pipeline-v2-plan.md:8994`
already recorded for the "production model" during prior WS1 research. All 5 files' birthtime is
2026-08-12 14:54-14:56 (a ~2-minute window, one export run) — **14 days before** the `.app`
bundle's own install/creation date, 2026-08-26 13:55 (`mdls kMDItemFSCreationDate`). `find
/Applications/Kinetix Pro Studio.app -iname '*.onnx'` returns nothing — zero ONNX files ship
inside the bundle. Neither `tauri.conf.json`'s `bundle.resources` nor `build.yml` ever stages or
references `fa-models/` (grep, zero hits outside `fa.rs`'s own path-builder and `fa_dev.rs:362`'s
dev-only test-fixture path, which only READS the same location). No code path anywhere in
`src-tauri/src/` or `src/` WRITES to `fa-models/` — the only writer that exists at all is
`scripts/export-fa-onnx.py`, a standalone Python script never invoked by the app, CI, or the
installer. Classification: **P2 — hand-placed / dev-session leftover.** The operator's own dev
machine had these 5 files sitting in `app_local_data_dir` from an unrelated 2026-08-12 research
session (this project has a local `.venv-phase4-fa` Python venv, corroborating a manual
`export-fa-onnx.py` run) — not P1 (installer bundling, ruled out by the empty `.app` search and
the 14-day birthtime gap) and not P3 (no download code exists anywhere). Consequence: the FA
end-to-end claim is real for THIS machine's current state, but is **CLAIM-UNVERIFIED for any fresh
install** — Windows, or a clean macOS machine with no `.venv-phase4-fa`/manual export history —
which would hit `fa.rs`'s `no_model_found_error` (fa.rs:454-462) immediately. A5.8 (side finding):
the wav2vec2 CTC vocab is NOT part of this gap — it is already compiled in per-language via
`include_str!` (`fa_onnx.rs:625-631`) from committed `scripts/fixtures/fa-vocab-{en,es,fr,de,pt}
.json` files, no acquisition needed. `docs/work-in-progress.md`'s FA-provisioning rows updated to
reflect P2 and the still-open "no canonical model source" question. Phase B (Windows/arm64 ORT
provisioning) NOT started this session per the operator's own instruction — gated on A5's
classification landing first, and on a follow-up decision (real hosting vs. a real guided
manual-placement UI) neither built nor authorized this session.
Superseded-by: none

### 2026-08-26 · WS2 Step 11 · ws2-step11-fetch-sites
Outcome: fixed 6 of the 9 sibling `fetch(asset.url)` sites Step 10's A6 sweep found (that sweep's
own "8 other" count undercounts its own bullet list by one — 9 sites are actually listed) with the
identical `asset.file ??` guard as Step 10's `fetchAndDetectSilences` fix: `App.tsx:3781`/`:3901`
(dev-only `[calibrate]`/`[inspector]` instrumentation), `segmentEncoder.ts:416`
(`encodePlainVideoSegment`'s source-bytes pull), `exportPipeline.ts:277` (legacy export's
voiceover mux), `webcodecsExport/exportPipelineWebCodecs.ts:1031` (WebCodecs export's voiceover
mux), `webcodecsExport/exportWorker.ts:301` (image-asset `createImageBitmap` inside the Web
Worker — confirmed `File`/`Blob` objects survive `postMessage`'s structured-clone algorithm, so
the same-shape guard is valid there despite the different execution context A6 flagged as
"materially different"). `waveformPipeline.ts:81` was found ALREADY guarded — A6's list was stale
on that one (git history shows the guard predates this session). NOT fixed: `whisperService.ts
:1686` is FROZEN this session (operator directive); `videoDemuxer.ts:66`'s `demux(url: string)`
takes only a raw URL, and its sole production caller (`videoDecoderPool.ts`, also frozen) has no
`Asset`/`File` to pass — fixing it would require changing a frozen file's call site, so left
unfixed and flagged rather than forced.
Verification: `tsc --noEmit` clean; new/updated regression tests in `segmentEncoder.test.ts`,
`exportPipeline.test.ts` (new file), `exportPipelineWebCodecs.test.ts` — each asserts `fetch` is
never called when `.file` is present and IS called with the exact `asset.url` when `.file` is
absent (fallback preserved, macOS behavior unchanged). No test added for the two App.tsx dev-only
sites (not independently unit-tested before this change either — they're closures inside a large
component, dev-only, unreachable from the shipped sync path) or for `exportWorker.ts` (a Worker
entry module with `self.onmessage` registered at import time; no existing test imports it, matches
`CLAUDE.md`'s accepted DOM/worker-testing gap already cited for `usePlayback.ts`/`useGlPreview.ts`
/`useExport.ts`) — verified by code inspection only for those three sites. Full vitest suite:
2533 passed, 77 skipped, 0 failed (`npx vitest run --exclude "**/.claude/worktrees/**"` — an
unrelated pre-existing worktree at `.claude/worktrees/elated-haibt-ab90e1` on branch
`claude/elated-haibt-ab90e1` sits inside this repo and would otherwise double-run the suite
against its own stale checkout; not created or touched this session).
Superseded-by: none

### 2026-08-26 · WS2 Step 11 · ws2-step11-boundaryUsedFallback-fix
Outcome: fixed `boundaryUsedFallback`'s next-side `isBreathSilence` call
(`snapBoundaries.ts:381`) from 4 args to 5, passing `currLastTokenIdx` as `otherSideLastTokenIdx`
— matching the already-correct pattern at `snapBoundaries.ts:744-745`. The 4-arg form silently
defaulted the seam exemption off for every next-side breath-silence check, so a genuine
seam-exempted boundary candidate could be misread as an interior breath and excluded from
candidacy, making `boundaryUsedFallback` over-report "fallback used" on affected pairs. Narrow
unfreeze of `snapBoundaries.ts` for this one 2-line change only, per operator instruction — no
signature change, no other edit to the file. Diagnostic-only by the function's own doc comment
(never replays `snapCoveredBoundaries`'s Pass 2 contention-aware assignment; never touches
committed segment timing) — confirmed, not assumed: golden replay
(`scripts/phase4-handoff-replay-sync.test.ts`, after regenerating replay inputs via
`scripts/phase4-restore-replay-inputs.py`) stayed byte-identical across v6/173/spanish, 6/6 passed.
Regression test added (`syncTiming.test.ts`, new case in the `boundaryUsedFallback` describe
block) reusing the real production V6 "seg 96→97 predator" fixture already committed for
`isBreathSilence`'s own seam-exemption tests — proves the 5-arg call now reads the fixture's
silence as a real assignable candidate (`boundaryUsedFallback` returns `false`) where the old 4-arg
call would have wrongly read it as a breath and reported fallback (`true`); both readings asserted
directly via `isBreathSilence` with 4 vs. 5 args in the same test.
Superseded-by: none

### 2026-08-27 · WS2 Step 12 · ws2-step12-manage-models-modal-a3
Outcome: shipped the Manage Models & Add-ons modal (A3), replacing the whisper-only "Manage sync
model" dialog (`ModelDownloadPanel.tsx`, deleted) with one UI covering both the whisper
transcription engine and the 5 per-language FA packs. New backend: `src-tauri/src/models.rs`
(`check_installed_models`, `import_local_model`, `delete_installed_model`,
`get_available_disk_space`), reusing rather than duplicating existing infrastructure — target-path
resolution via `model_download.rs::models_dir`/`fa.rs::fa_model_candidate_paths` (widened to
`pub(crate)`), and FA import validation via `fa_dev.rs::verify_model_manifest` (also widened),
which does an EXACT sha256+size check against the already-committed, already-tested
`fa-onnx-manifest.json` rather than a live ONNX graph/session inspection — deliberate: session
creation needs `ORT_DYLIB_PATH` set (`fa_onnx.rs::load_session`), unavailable in the plain
`tauri:dev`/`tauri:build` this modal must work in regardless of the `fa-inference` feature.
Import uses `rfd::AsyncFileDialog` (the SAME crate `ffmpeg.rs::pick_save_path` already uses) —
confirmed no `@tauri-apps/plugin-dialog` or capabilities/`tauri.conf.json` change was needed at
all (the owner's Q4 pre-authorized a narrow unfreeze for this that turned out to be unnecessary;
zero changes made to either file). Import is atomic: copy to `.part`, fsync, validate, rename;
any failure (including validation) deletes the `.part` and leaves any prior installed model at
`target` untouched — regression-tested directly against `import_to_target` (no `AppHandle` needed,
split out specifically for this). `model_id` is allowlist-parsed (`"whisper"` or `"fa-<lang>"`
for `lang` in a fixed 5-language array) via pure string comparison, never `Path::new`/`join` on
the raw input — path-traversal payloads (`"fa-../../etc"`, `"fa-..%2f.."`, `"fa-"`, `"fa-EN"`)
rejected before any filesystem call, asserted by a dedicated test. Disk-free-space uses a new
`fs4` dependency (`available_space(path)` — statvfs/GetDiskFreeSpaceExW on the path's own volume,
not `disks.list().first()`); no other new crate added.

FA Download is NOT wired to a real network transfer in this build — the owner's Q1 answer
("own-cdn, HuggingFace public model repo") and Q2 answer ("repo is private") conflict as recorded,
and this session had neither a real repo id nor a bearer token to reconcile them with. Per Q3
("if no host, Download should be always-enabled"), the button stays enabled rather than disabled
forever, but clicking it surfaces an explainer pointing at the new
`docs/ws2-fa-models/manage-models.md` page instead of attempting any request — Import (working,
manifest-validated) is the only real acquisition path in this build. That doc records the exact
per-language `scripts/export-fa-onnx.py` invocation, HF checkpoint ids/expected sizes (pulled
from the committed manifest, not re-measured), and what a real Download command would still need
(host URL, token env var, a `model_download.rs`-shaped resumable downloader).

`check_installed_models` never uses a `len > 1_000_000` heuristic — exact size match against a
known constant (whisper) or the manifest (FA), with a `.sha256` sidecar written on first successful
verification so a hand-placed model (e.g. A5's 5 P2 dev-leftover FA models) is re-verified once,
not on every check. `SyncLogPanel.tsx` gained an optional `onOpenModelsModal` prop and a deep-link
button that renders only when an `fa-preflight`/`fa-fallback` entry's detail names a missing model
(text-matched against `fa.rs:461`'s verbatim "No FA model found" message) and only when the modal
handler is actually wired — wired from `App.tsx`'s `SyncLogPanel` usage. `ProjectSettingsModal.tsx`
's link relabeled "Manage models & add-ons"; `App.tsx`'s `showModelDownloadPanel` state renamed
`showManageModelsModal` throughout.

Verification: `tsc --noEmit` clean. `cargo test --lib`: 147 passed, 1 ignored, 0 failed
(141 pre-existing + 6 new — 3 `ModelId` allowlist/parse tests, 2 import-atomicity tests, 1 FA
wrong-manifest-match test; no regression). Golden replay (`scripts/phase4-handoff-replay-sync.test.ts`, run against the top-level
copy only via `--exclude '**/.claude/worktrees/**'`) byte-identical 6/6 across v6/173/spanish —
expected and required, since nothing in this session touches `snapCoveredBoundaries` or any FA
rule stage. New component tests: `ManageModelsModal.test.tsx` (7 cases — jsdom + `react-dom/client`
+ `act`, the same pattern `BottomDrawer.trimDrag.test.tsx` already uses, no `@testing-library`
dependency in this repo — installed-vs-missing rendering from a mocked `check_installed_models`,
project-needed-language badge, Download-stays-enabled-but-explains on click, Import calling the
real `importLocalModel('whisper')`, a rejected import's verbatim backend message surfacing in the
row, and Cancel during a whisper download invoking the real `cancelWhisperModelDownload`) and 3
new `SyncLogPanel.test.tsx` cases for the deep-link (renders when detail names a missing model and
a handler is given; omitted with no handler; omitted for an unrelated preflight failure).

NOT DETERMINED this session: which of Q1/Q2 (public vs. private FA-model repo) is actually correct
— flagged rather than guessed; a real Download implementation is blocked on that answer plus a
concrete repo id/token, not on any remaining code work (the downloader itself is a short,
mechanical port of `model_download.rs`'s existing whisper downloader once those are supplied).
Windows/arm64 FA ORT runtime provisioning is unchanged and still separately blocking — a model a
Windows user imports via this modal still cannot run FA there (see `docs/work-in-progress.md`'s
FA ORT item).
Superseded-by: none

### 2026-08-27 · WS2 Step 13 · ws2-step13-fa-download-engine-ort-provisioning
Outcome: four parts — a real status-check bug fix, modal UI busy/refresh fixes, a working FA
download engine, and cross-platform onnxruntime provisioning.

**Phase 0 (hard gate).** The owner's `mohtashim9/kinetix-fa-models` HF repo was PUBLIC but
contained only `.gitattributes` at session start (all 5 `<lang>/model.onnx` 404'd) — upload
genuinely in progress, not a Q1/Q2 conflict as flagged last session. Re-probed mid-session after
building the download engine anyway: upload had completed — all 5 languages return 200, real LFS
content (not pointer files), `Content-Length`/`X-Linked-ETag` matching `fa-onnx-manifest.json`
exactly for every language, `Range: bytes=0-1023` returns 206 with correct `Content-Range`. Commit
`f618960d71728eba5f12528d5571838a10d262bf` (MEASURED via the HF API's `sha` field) is pinned as
`models.rs::FA_MODEL_REVISION` — NOT `"main"` (this session's earlier, pre-upload placeholder) and
NOT the pre-upload commit `7cab396...` a literal reading of last session's "pin from 0.4" brief
would have picked (that commit predates the files entirely and would have been permanently
unreachable).

**Phase 1 — status-check bug.** A live probe against the REAL `app_local_data_dir`
(`src-tauri/tests/models_status_live.rs`, mirroring `fa_durable_wav_live.rs`'s
`mock_context::<Wry,_>` pattern) proved `check_installed_models` correctly read every real model on
this machine as installed — the backend was never wrong. The actual defect:
`ManageModelsModal.tsx`'s `refresh()` silently swallowed a failed `checkInstalledModels()` call into
`console.error`, leaving `report` at `null` forever with no visible signal — indistinguishable from
the genuine "nothing installed yet" state the same rendering path also produces. Fixed with a
`statusError` banner + retry action, never by weakening `status_for`'s exact-size/sidecar/hash-fallback
logic (which was already correct per the HARD RULE). `status_for` was split into a pure,
`AppHandle`-free `status_for_generic(path, expected_size, verify)` specifically so the fallback-hash
branch could be regression-tested with a tiny synthetic file instead of a real ~1.2 GiB one — 5 new
tests (`models.rs`): sidecar-present fast path, sidecar-absent-falls-back-and-writes-one,
verify-fails-writes-no-sidecar, wrong-size-with-stale-sidecar, stale-`.part`-does-not-affect-status.

**Phase 2 — modal UI.** Import/delete/download now show a spinner and disable the row while busy
(`RowState` gained `deleting`; `isBusy()` gates every action button). `refresh()` now runs after
EVERY completion path, not just success — successful import, failed import, delete, and download
completion all re-invoke `check_installed_models`. New tests exercise the REAL command shape (a
plain `{whisper, fa}` object matching what the live probe printed, not a shape hand-picked to pass)
and assert `mockCheckInstalledModels` call COUNTS increase on each path — the class of test that
would have caught the swallowed-error bug, per the session brief's own framing.

**Phase 3 — FA download engine.** `model_download.rs`'s resumable download loop was generalized
(`stream_download_verified`, taking a caller-supplied `verify` closure and URL/paths/expected-size)
rather than copy-pasted — `whisper_model_download` now calls it too, unchanged behavior/wire format
(`ModelDownloadEvent`/`ModelDownloadStatus` untouched, so `modelDownload.ts` needed no change).
`models::fa_model_download` is the FA caller: verification is `fa_dev::verify_model_manifest` (no
new pinned hash), disk space is precomputed via the existing `fs4` dependency
(`ensure_disk_space`, 200 MiB margin), and `ModelDownloadState`'s cancel flag was widened from a
single `Arc<AtomicBool>` to a `HashMap<String, Arc<AtomicBool>>` keyed by `"whisper"`/`"fa-<lang>"`
so a whisper and an FA download can be cancelled independently. Frontend: `services/models.ts`
gained `downloadFaModel`/`cancelFaModelDownload`, reusing the `ModelDownloadEvent` shape verbatim.
The Step 12 "Download not yet configured" placeholder is gone — FA Download now performs a real
transfer with live progress.

REAL END-TO-END VERIFICATION (not simulated): ran `src-tauri/tests/fa_download_live.rs`
(`FA_LIVE_DOWNLOAD=1`) against production `app_local_data_dir`, with the real pre-existing `en`
model moved aside first. Pass 1 (fresh download): 1,262,512,711 bytes in 307.2s (3.92 MiB/s),
`.sha256` sidecar written, `fa_dev::verify_model_manifest` passed before the atomic rename. Pass 2
(cancel-then-resume): cancelled after 28,793,177 real bytes on disk (confirmed via `.part` file
size, not just the progress-channel's own text), resumed from 29,907,289 bytes (NOT from zero —
proves resume actually resumes) and completed to the exact expected size in 325.9s, manifest
verification passing again before the second finalize. The freshly-downloaded file was confirmed
byte-identical (sha256) to the original before cleanup; no data was lost.

**Phase 4 — ORT provisioning.** `ort = "=2.0.0-rc.13"`'s required onnxruntime C-API version is 17
(the floor, no `api-NN` feature enabled) — MEASURED against `Cargo.toml:41` and confirmed via the
pre-existing `onnxruntime.manifest.json`'s own `apiVersionRationale`. `fa_onnx.rs::ORT_DYLIB_FILENAME`
(a single hardcoded macOS-x86_64-only constant + a `cfg!` hard gate) became
`SUPPORTED_ORT_TARGETS: &[OrtTarget]`, a table of (os, arch, filename) rows —
`resolve_bundled_ort_dylib`'s refusal message is now generated FROM that table, and
`onnxruntime.manifest.json` widened from one flat object to a `targets` array;
`scripts/onnxruntimeBundle.guard.test.ts` rewritten to iterate it (34 tests, up from ~13, all
passing) including a new cross-check that every `SUPPORTED_ORT_TARGETS` row has a matching manifest
entry.

macOS: chose LIPO into one universal (x86_64+arm64) dylib over shipping both and selecting at
runtime — the app's own bundle target is already `universal-apple-darwin`, so a fat onnxruntime
dylib needs zero new runtime arch-selection code (dyld already does it, same as for the main
executable). MEASURED 2026-08-27: downloaded both official v1.23.2 per-arch dylibs
(x86_64 sha256 `8c9c78de...` — matches the PRE-EXISTING pin exactly, confirming no drift;
aarch64 sha256 `d306d2bc...`, newly measured), `lipo -create`d them (`lipo -info`: "x86_64 arm64",
74,902,752 bytes), and confirmed the result `dlopen()`s successfully on this session's real Intel
hardware via Python's `ctypes.CDLL` — real dynamic-linker proof, not just a well-formed-file check.
The arm64 slice's own load/runtime behavior is UNVERIFIED (no Apple Silicon hardware this session).
`build.yml`'s macOS ORT step downloads+verifies both per-arch dylibs against these hashes then lipos
them; the lipo OUTPUT's own hash is recorded (informational) but deliberately NOT CI-gated — `lipo`
doesn't guarantee byte-identical output across toolchain versions from identical inputs, so gating
on it risks failing a legitimate build over a toolchain difference.

Windows: downloaded and hashed Microsoft's `onnxruntime-win-x64-1.23.2.zip` — `onnxruntime.dll`
(14,186,016 bytes, sha256 `dec964ab...`) and its same-directory dependency
`onnxruntime_providers_shared.dll` (22,088 bytes, sha256 `a2b3a509...`), both MEASURED, neither
previously provisioned anywhere in this repo (Windows shipped `-f fa-inference` compiled in since
bug 2 but with ZERO runtime bytes — the hard `cfg!` gate made it permanently refuse regardless).
`build.yml` gained a Windows ORT step downloading+sha256-verifying both into the existing
`onnxruntime/` resource folder (`tauri.conf.json`'s `"onnxruntime/*": "onnxruntime/"` glob needed no
change — already target-agnostic). FLAGGED, not fixed: Microsoft's prebuilt `onnxruntime.dll`
needs the Microsoft Visual C++ Redistributable (x64) on the end-user machine — not bundled, not
chain-installed by the NSIS/MSI installer, and (OPERATOR-ATTESTED, not independently confirmed — no
Windows hardware) likely an existing, undocumented risk for the already-shipping `whisper-cli.exe`
too, which this session did not introduce but did surface. Full options recorded, none implemented:
`docs/ws2-fa-models/ort-provisioning.md`.

Both `Guard against stray dev models being bundled` steps (macOS + Windows) extended from `*.bin`
in `src-tauri/models/` only to also reject any `*.onnx` anywhere under `src-tauri/` — closes the
gap where a Manage-Models-imported/downloaded FA pack accidentally left in a dev checkout's
`src-tauri/` tree (never the actual install location, `app_local_data_dir`, but a plausible mistake)
would have shipped silently.

Verification: `tsc --noEmit` clean. `cargo test --lib`: 157 passed, 1 ignored, 0 failed (147 prior +
10 new — 5 in `model_download.rs`'s first-ever tests, 5 in `models.rs`). `cargo check --features
fa-inference` clean (generalized ORT table compiles under the feature). Full `vitest` (excluding the
stray worktree, `npx vitest run --exclude '**/.claude/worktrees/**'`): 2561 passed / 77 skipped / 0
failed, +18 over the prior session's 2543 — `ManageModelsModal.test.tsx` grew 7→15 tests, all
green; `scripts/onnxruntimeBundle.guard.test.ts` grew to 34/34 (rewritten for the `targets` array;
prior count not independently re-verified, so the exact split of the +18 between the two files is
not claimed precisely — both are individually confirmed green at their new counts).
Golden replay untouched by this session (no sync-timing file touched) — not re-run as a redundant
check beyond the standing regression suite.

NOT DETERMINED this session: whether the arm64 macOS dylib slice or either Windows DLL actually
loads/runs FA inference (no matching hardware); whether `whisper-cli.exe` has ever actually hit the
VC++ redistributable gap on a real end-user Windows machine; a full built installer's before/after
size on any platform (component-level byte deltas only — macOS ORT +35.2 MB [39.7→74.9 MB dylib],
Windows ORT +14.2 MB net-new [was 0 bytes bundled]; both comfortably under the "jump into GB range"
concern the session brief flagged, neither an actual end-to-end installer build was run).
Superseded-by: none

### 2026-08-27 · fix · 5adbbf4-ci-macos-globstar-fix
Outcome: the "Build desktop installers" workflow's macOS leg broke on `4f31d38`'s new stray-model
guard step (WS2 Step 13 Phase 4): `shopt -s globstar` (needed for the `src-tauri/**/*.onnx` glob)
fails outright on macOS runners' default `/bin/bash` 3.2 (Apple has never shipped GPLv3 bash 4+,
which is the first version with a `globstar` shell option at all). Fixed by replacing the glob with
`find src-tauri -type f -name '*.onnx'`, which needs no shell option to recurse on any bash
version; the `*.bin` half of the guard (a plain non-recursive glob) was unaffected and unchanged.
Evidence: CI-VERIFIED — GitHub Actions run `33017398678` (triggered 2026-08-26T21:53:41Z, ~5 min
after this commit) built `head_sha` `5adbbf46436db3f3eb2259dd92d413c1da716319` on branch `main` and
both matrix legs succeeded: `windows-latest`/`x86_64-pc-windows-msvc` (`kinetix-windows-x64`
artifact, 8m42s) and `macos-latest`/`universal-apple-darwin` (`kinetix-macos-universal` artifact,
6m52s). Also verified locally per the commit message (guard still fails on a tree with stray files,
passes on a clean one). This is the first CI run since Step 13 Phase 4 (`4f31d38`) to actually
complete on both targets — the immediately prior run (`33015069184`, same day, 21:22:42Z) failed on
exactly the globstar defect this commit fixes.
Detail: this run proves the *build* succeeds on both targets with FA compiled in and ORT
provisioned per `SUPPORTED_ORT_TARGETS` — it does not run the app, does not run FA, and is not
evidence that forced alignment executes correctly on either artifact. See the correction entry
below for what this does and does not close.
Superseded-by: none

### 2026-08-27 · correction · ws2-ci-installer-artifacts-now-exist
**CORRECTION NOTE — supersedes the "arm64/Windows have never been built (CI or local...)" half of
`docs/work-in-progress.md`'s `[CLAIM-UNVERIFIED] CI-installer verification of WS2 bugs 2+4` row,
and the equivalent "NOT DETERMINED"/"never been built" language in the
`8c6e4e8-ws2-bug4-in-app-model-download` and `d8baef5-ws2-bug2-fa-compiled-into-installer` entries
above.** Those entries are correct that CI-installer verification of bugs 2/4 was NOT DETERMINED
at the time they were written (2026-08-26) — no arm64 or Windows CI run had ever completed. That
specific fact changed the next day: run `33017398678` (see the entry immediately above) built BOTH
`windows-x86_64-pc-windows-msvc` and `universal-apple-darwin` installer artifacts successfully at
`5adbbf4`, the first time either has been built anywhere other than the operator's own Intel
dev machine.
What this DOES close: "have CI-built installer artifacts for Windows and macOS-universal ever been
produced" — yes, CI-VERIFIED, run `33017398678`.
What this does NOT close, and stays exactly as NOT DETERMINED as before: whether forced alignment
(or anything else in the app) actually runs correctly when launched from either of those two
specific artifacts. No operator report of installing and running either CI-built artifact exists in
this repo's records as of this entry. In particular, the question of which machine/install type
produced any working Windows FA run — a fresh CI-built installer, a fresh locally-built installer,
or a dev machine with hand-placed models — was posed to the owner this session (WS2 Step 14 Q1) and
came back **blank/not answered**; per that session's own instruction, an unanswered question records
as NOT DETERMINED and does not upgrade any grade. Bug 2 and bug 4 therefore stay graded
OPERATOR-ATTESTED (dev-machine only), not END-TO-END VERIFIED, despite the CI artifacts now
existing — artifact existence and runtime correctness are separate claims. Full evidence table:
`docs/work-in-progress.md`'s WS2 section (added WS2 Step 14).
Superseded-by: none

### 2026-08-27 · correction · ws2-fa-acquisition-and-ort-gate-superseded
**CORRECTION NOTE — several statements made true-at-the-time in earlier entries are now false as
written; this entry cites and supersedes each, per the append-only rule (nothing below is edited).**

1. **"FA cannot run on Windows / no bundled onnxruntime C runtime for windows-x86_64 / only macOS
   x86_64 bundled."** True when written (`2026-08-26--correction--ws2-bug2-ort-runtime-platform-gap`,
   above): `fa_onnx.rs:319`'s `resolve_bundled_ort_dylib` hard-gated on
   `cfg!(all(target_os = "macos", target_arch = "x86_64"))`. Superseded by WS2 Step 13 Phase 4
   (`4f31d38`, 2026-08-27, entry `ws2-step13-fa-download-engine-ort-provisioning` above):
   `fa_onnx.rs:310` now defines `SUPPORTED_ORT_TARGETS: &[OrtTarget]`, a table covering
   macos-x86_64, macos-aarch64 (served by the same lipo'd universal dylib), and windows-x86_64;
   `fa_onnx.rs:319` is now the table lookup
   (`SUPPORTED_ORT_TARGETS.iter().find(|t| t.os == os && t.arch == arch)`), not a single hard `cfg!`
   gate. New evidence grade: CODE-FIX MACHINE-VERIFIED (`cargo test --lib` 157/0/1,
   `scripts/onnxruntimeBundle.guard.test.ts` 34/34) for compile/table correctness; DLL/dylib
   presence and hash-verification is CI-VERIFIED as of run `33017398678` (both targets' ORT
   provisioning steps ran and passed); actual runtime dlopen/inference on Windows or Apple Silicon
   remains NOT DETERMINED (no matching hardware in any session; Q1/Q2 this session came back blank,
   so this stays the weaker grade, not upgraded).
2. **"fa_onnx.rs:319 refusal-message" as a single hardcoded string.** Superseded by the same Step 13
   Phase 4 change — the refusal message is now generated FROM `SUPPORTED_ORT_TARGETS` inside
   `resolve_bundled_ort_dylib` (`fa_onnx.rs:360`), not a fixed string. Any doc quoting the old
   verbatim Windows refusal text (`docs/ws2-video-ingest/step10-windows-fetch-diagnosis.md:16`,
   `docs/history-2.md`'s Step 10 correction entry) is quoting a real, MEASURED log line from
   2026-08-26 — historically accurate and left as-is — but should not be read as still describing
   current gate behavior; this entry is the pointer forward.
3. **"Fresh installs of any platform have no FA model; macOS FA works only on this machine"**
   (A5 finding P2, `ws2-step11-fa-model-provenance-a5` above, 2026-08-26). True when written — no
   acquisition UI existed at all, and the 5 working `model.onnx` files on the operator's machine
   were a P2 hand-placed dev-session leftover. Superseded by WS2 Step 12's Manage Models & Add-ons
   modal (`ws2-step12-manage-models-modal-a3`, Import path, real end-to-end) and WS2 Step 13 Phase 3
   (`ws2-step13-fa-download-engine-ort-provisioning`, real Download, REAL END-TO-END VERIFICATION
   against production `app_local_data_dir`: fresh download 1,262,512,711 bytes/307.2s, cancel-then-
   resume from a real partial file, both manifest-verified). New evidence grade: MACHINE-VERIFIED for
   the download engine's mechanics (a real network transfer, on the operator's own machine); still
   NOT DETERMINED whether a genuinely fresh install (no prior `app_local_data_dir` state) completes
   this flow without operator intervention, since no fresh-install session has run it — this is
   narrower than P2's original claim, not equivalent to it.
4. **`docs/ws2-fa-models/manage-models.md`'s "Download is NOT wired to a real network transfer in
   this build" status line** (WS2 Step 12, 2026-08-27 morning). Superseded same-day by WS2 Step 13
   Phase 3, same session arc. The page itself is rewritten in this pass (WS2 Step 14) to describe the
   real flow — public HF repo `mohtashim9/kinetix-fa-models`, pinned revision
   `f618960d71728eba5f12528d5571838a10d262bf`, unauthenticated GET, resumable, manifest-gated
   verification before install — rather than carry a superseded status line forward.

None of the corrections above touch `docs/history.md`, any frozen source file, or any fixture.
Superseded-by: none

### 2026-08-27 · WS2 Step 15 · ws2-step15-windows-operator-log-before-after
**MEASURED-FROM-OPERATOR-LOG. Two separate runs, not merged: the 03:57:28 entries are one run on
the FA path; the single trailing 03:39:00 line is a separate, earlier run on the Whisper-timing
path. 303/2855 belongs to the 03:39:00 Whisper run, not the 03:57 FA run.** Same project
("Failed Export Project Data", 229 segments), same Windows machine class, two builds — the
19:38:19 BEFORE run predates the Step 10/11 fetch fix (`56e2116` + Step 11's 6-site sweep); the
03:57:28 AFTER run postdates it.

| metric | Windows BEFORE (19:38:19) | Windows AFTER (03:57:28) | macOS baseline |
|---|---|---|---|
| cuts on still-playing audio | 117 | 9 | 10 |
| segments matched | 226 of 229 (3 skipped) | 228 of 229 (1 skipped) | 228 of 229 |
| skipped segment ids | 152, 131, 1 | 52 | — |
| scenes under 60% words | 6 (75,79,125,132,136,199) | 4 (8,69,79,102) | — |
| tokens filtered | 303 of 2855 (10.6%), Whisper-path 03:39:00 run | 1 of 2181 (0.05%), FA path | 310/2823, Whisper path |
| silence detection | FAILED: voiceover fetch | ran (cuts evaluated) | ran |
| FA pre-flight | runtime not loaded | ready, model present "en" | ready |
| timing engine | Whisper fallback | forced alignment, 2181 words | forced alignment, 2181 words |
| error serialization | `[object Object]` | absent | absent |

**Confirmation by absence (A2):** none of `voiceover fetch failed`, `Failed to fetch`,
`[object Object]`, `runtime not loaded` appear anywhere in the 03:57:28 run. Absence of these four
strings is the proof for the fetch fix (below) and the error-serialization fix (below).
Superseded-by: none

### 2026-08-27 · WS2 Step 15 · ws2-step15-windows-fetch-bug-closed
**CLOSES** the `[IN-PROGRESS]` Windows voiceover `fetch(blob:)` failure
(`56e2116-ws2-step10-windows-voiceover-fetch` + `ws2-step11-fetch-sites` above). Grade:
MEASURED-FROM-OPERATOR-LOG. Evidence: 117 → 9 cuts on still-playing audio on the identical
229-segment "Failed Export Project Data" project, silence detection restored (ran and evaluated
cuts vs. FAILED before), all four failure-signature strings absent from the AFTER run
(`ws2-step15-windows-operator-log-before-after` above). The residual 9/228 cuts on live audio are
NOT attributed to this bug — see `ws2-step15-cut-placement-quality-open` below; they sit at macOS
parity (10), a pre-existing cross-platform gap this fix does not touch.
Superseded-by: none

### 2026-08-27 · WS2 Step 15 · ws2-step15-error-serialization-closed
**CLOSES** the B1 error-serialization defect (`88ff701-ws2-step10-error-serialization` above) on
Windows specifically. Grade: MEASURED-FROM-OPERATOR-LOG. Evidence: `[object Object]` does not
appear anywhere in the 03:57:28 AFTER run; it appears in the 19:38:19 BEFORE run per the A1 table.
Superseded-by: none

### 2026-08-27 · WS2 Step 15 · ws2-step15-bug2-fa-desktop-closed-ci-verified
**CLOSES bug 2** (FA silently disabled on desktop, `d8baef5-ws2-bug2-fa-compiled-into-installer`
above). Grade: **CI-VERIFIED BUILD + MEASURED RUNTIME**, per Q1 = "AFTER THE PUSH AFTER FIXING
THESE ISSUES, THE BUILD WAS PRODUCED FROM GITHUB ACTIONS, BUILD DESKTOP INSTALLER" — the 03:57:28
Windows build was produced by the `build.yml` "Build desktop installers" CI workflow, not a local
build. Combined with `5adbbf4-ci-macos-globstar-fix` above (CI run `33017398678` producing the
`kinetix-windows-x64` artifact), this is the first time a CI-produced Windows artifact has an
operator-measured runtime result: FA pre-flight ready with model "en" present, forced alignment
executed, **2181 aligned words — identical to the macOS production figure** (see
`ws2-fa-acquisition-and-ort-gate-superseded` above, item 1, which this entry now upgrades from
"NOT DETERMINED" to CI-VERIFIED + MEASURED for the Windows leg specifically). Moved out of
`[OPEN]`/pending-verification; no remaining step.
Superseded-by: none

### 2026-08-27 · WS2 Step 15 · ws2-step15-bug4-acquisition-closed-end-to-end
**CLOSES bug 4's acquisition-path half** (installer size already closed at
`8c6e4e8-ws2-bug4-in-app-model-download` above; this entry closes the remaining acquisition-on-a-
never-provisioned-machine question). Grade: **END-TO-END VERIFIED**, per Q2 = "Download button in
Manage Models & Add-ons" — the "en" FA model on the 03:57:28 Windows machine was acquired through
the in-app Download flow (`ws2-step13-fa-download-engine-ort-provisioning` above's engine), not
hand-placed and not imported. This is the first proof the acquisition UI works end-to-end on a
machine that never ran `export-fa-onnx.py` and never had operator-placed `model.onnx` files —
directly retiring the A5 P2 finding's remaining scope (see the correction entry immediately below).
Superseded-by: none

### 2026-08-27 · correction · ws2-step15-a5-p2-fully-superseded
**CORRECTION NOTE — supersedes the remaining NOT-DETERMINED scope left open by
`ws2-fa-acquisition-and-ort-gate-superseded` item 3 above.** That entry closed P2's macOS half
(real Download, real cancel/resume, on the operator's own already-provisioned dev machine) but left
open "whether a genuinely fresh install completes this flow without operator intervention." The
03:57:28 Windows run answers that for the Windows leg: per Q1 the build came from a CI artifact
(never touched by `export-fa-onnx.py` or any hand-placement step) and per Q2 the "en" model reached
it via the in-app Download button — a machine with zero prior FA provisioning, provisioned
end-to-end through the shipped UI alone. **What survives of A5 P2:** nothing on the Windows leg;
P2's original claim ("fresh installs of any platform have no FA model; macOS FA works only on this
machine") is now refuted for both platforms this project ships (macOS: Download/Import path
machine-verified; Windows: Download path end-to-end verified on a CI-built, never-hand-provisioned
artifact). The only remaining unverified leg is macOS running from a **CI-built** artifact
specifically (the macOS Download verification in `ws2-fa-acquisition-and-ort-gate-superseded` ran
on the operator's local dev build, not the CI `universal-apple-darwin` artifact) — recorded as
NOT DETERMINED, not rounded up.
Superseded-by: none

### 2026-08-27 · WS2 Step 15 · ws2-step15-token-filtering-resolved
**MEASURED, resolving the token-filtering question permanently.** Whisper-timing path: Windows
303/2855 (10.6%, 03:39:00 run) vs. macOS 310/2823 (11.0%) — confirmed twice now, not
Windows-specific. FA path: 1/2181 (0.05%) on Windows (03:57:28 run), consistent with macOS FA's
own near-zero filter rate. Recorded as MEASURED that Whisper-path filtering is materially higher
than FA-path filtering across both platforms — the FA path structurally avoids most of what the
Whisper path filters. **Mechanism: NOT DETERMINED.** No file:line evidence was gathered this
session to show *why* FA avoids the filtering; the numeric contrast alone does not establish a
mechanism, and none is asserted. Do not infer one from these figures without separate
investigation.
Superseded-by: none

### 2026-08-27 · WS2 Step 15 · ws2-step15-r11-normal-firing-note
Informational, no action: R.11 fired normally in the 03:57:28 run (scene 2, `002_kitchen_border`,
0.73s → 1.43s, +0.7s) — expected rule operation, not a defect. Recorded per operator instruction,
not flagged.
Superseded-by: none

### 2026-08-27 · WS2 Step 17 Part 0 · stray-worktree-preserved-and-removed
**CLOSED.** `.claude/worktrees/elated-haibt-ab90e1` (branch `claude/elated-haibt-ab90e1`, tip
`2f699ab`, already fully merged into `origin/main`) carried 597 lines of uncommitted working-tree
changes across 13 tracked files plus one untracked file (`src/services/projectDataStore.ts`) — a
complete, self-consistent, already-manually-verified fix for a real reported bug (autosave
`QuotaExceededError`, see WS2 §5's new `[OPEN]` entry for the underlying bug, still open on
`main`). Per the STOP-before-remove rule, this was never simply discarded. Preserved verbatim on
`preserve/indexeddb-project-store` (commit `0386542`, based on `2f699ab`), pushed to origin;
committed-tree-vs-backup diff confirmed byte-identical (MEASURED, zero differences) before the
worktree was removed. `git worktree remove --force` + `git worktree prune` + `git branch -D
claude/elated-haibt-ab90e1` all ran clean, no errors. The preserved branch is unreviewed, un-rebased
onto current `main`, and NOT merged — evaluating/rebasing it is separate future work per owner
decision. Its own `docs/history.md` hunk was left as-is on that side branch (predates the
`docs/history.md`/`docs/history-2.md` split still in use on `main`); relocating it to
`docs/history-2.md` is a prerequisite for any future merge, not done here.
Superseded-by: none

### 2026-08-26 · operator-attested · ws2-macos-ci-artifact-fa-verified
**OPERATOR-ATTESTED, 2026-08-26.** Operator ran the CI-built `universal-apple-darwin` installer
artifact (GitHub Actions "Build desktop installers") and confirmed forced alignment executes
successfully from it — this was the last remaining unverified leg named by
`ws2-step15-a5-p2-fully-superseded` above ("the only remaining unverified leg is macOS running
from a CI-built artifact specifically"). No artifact in this repository reproduces this run;
graded OPERATOR-ATTESTED, never MEASURED or CI-VERIFIED. Hardware/build identifiers beyond "the
CI-built universal-apple-darwin artifact" were not recorded by the operator.
Superseded-by: none

### 2026-08-26 · operator-attested · ws2-macos-arm64-fa-dlopen-inference-verified
**OPERATOR-ATTESTED, 2026-08-26.** Operator ran the built app on real Apple Silicon (macOS arm64)
hardware and confirmed the onnxruntime universal dylib dlopen's and forced-alignment inference
executes correctly on it — closing the gap tracked in `docs/ws2-fa-models/ort-provisioning.md`
("the macOS universal dylib is built and lipo'd but has never executed on real Apple Silicon
hardware"). No artifact in this repository reproduces this run; graded OPERATOR-ATTESTED, never
MEASURED or CI-VERIFIED. Specific hardware model was not recorded by the operator.
Superseded-by: none

### 2026-08-27 · operator-attested · ws1-r12-live-reconfirmation
**OPERATOR-ATTESTED, 2026-08-27.** Owner ran a live Apply Sync with forced alignment enabled on
current `main` (v6 corpus) and ear-verified all four boundaries WS1 §3 had listed as "provisional
R.12 closures" (085, 224, 307, 383), scoring all four VERIFIED PERFECT: `085_the_spear_bearer`
250.81, `224_thirty_three` 664.33, `307_forty_nine_years` 925.43, `383_sixty_four` 1189.05.
**This is a re-confirmation, not new ground truth — the WIP checklist item's own framing was
stale.** Three of the four were already independently ear-verified via a Session T (2026-08-21)
side-by-side A/B pass and are locked into a production regression pin
(`scripts/ws1-session-q-production-pins.test.ts:106-109`, `pinEarVerified` at exactly 664.33 /
925.43 / 1189.05); 383's value in particular is the *reversal* value from that A/B pass (Session T
overturned a prior SOLO verdict of 1188.95 in favor of 1189.05 — CLAUDE.md's own standing
"side-by-side overturns solo" invariant). **085 is not R.12-owned at all** — confirmed by
`scripts/ws1-ear-pass-ledger.ts:434-436` ("`085_the_spear_bearer` already commits outside the
run, so R.12 does not fire") and `scripts/phase4-fa-replay.test.ts:1289-1299`'s register entry:
R.12's own FA-derived value (252.74, later fixture-pinned 250.69) is wrong, Whisper independently
commits 250.81 "correctly outside the run," and that file's own caveat already flagged 250.81 as
"the BETTER-evidenced value, not a regression" pending fixture regeneration — not done here, per
the standing rule that fixture regeneration is a deliberate, separate action, never hand-patched.
**What this session confirms, freshly:** all four values still hold, byte-identical to the
existing pins, on a genuinely fresh live sync against current `main` — a determinism/regression
check, not a new ear-verification of previously-unscored numbers. WS1 §3's checklist item removed
as already-closed by Session T/Q; no code or fixture changed.
Superseded-by: none

### 2026-08-27 · operator-attested · ws1-mover-audit-24-of-24-closed
**OPERATOR-ATTESTED, 2026-08-27.** `docs/ws1-sync-pipeline/stage1-mover-audit.md`'s 24-row blind
mover-audit dossier (WS1 Session I, drawn 2026-08-18 at HEAD `726112b`) is closed 24/24. It was
never actually unscored — its own blind table sat blank for over a week because Session K
(2026-08-18, same HEAD) recorded its result in `scripts/ws1-ear-pass-ledger.ts`'s `mover-audit-k`
sitting and this file's own entry above instead of writing the verdicts back into the table
itself. Session K's own log said "scored 22/24 mover-audit rows; the 2 failures root-caused and
fixed" — three separate places nonetheless kept calling the dossier "still unscored" after that
date without cross-checking Session K's record: this file's own Docs Cleanup Round 2 note above
(2026-08-25), `project-state.md` §4's Next Action item 1, and a comment in
`scripts/ws1-single-tracker.test.ts` (that file's comment is pre-Session-K, 2026-08-15, and
merely never updated — not touched here, source file, out of scope for a docs session).

The table itself is now filled in: `docs/ws1-sync-pipeline/stage1-mover-audit.md`'s §1 records
YES for all 24 rows and Score 24/24, with a **Scoring provenance** note explaining the two-sitting
history above, and a **Live re-confirmation, 2026-08-27** note/table for the 5 rows (12, 13, 14,
23, 24) whose committed value moved after the dossier was drawn (Session T/Q, 2026-08-21 — see
`#2026-08-27--operator-attested--ws1-r12-live-reconfirmation` above for 4 of them) — the owner
re-verified all 24 boundaries against current `main` on this date, all VERIFIED PERFECT, and the
5 moved rows' live values are recorded alongside the original drawn values rather than
overwriting them, preserving the table's own historical provenance.

**Net effect on Stage 1 lock:** this closes the mover-audit-dossier criterion named in WS1 §3's
END GOAL. `work-in-progress.md` WS1 §3's separate "Owner scoring of the 24-row mover audit
dossier" checklist line is removed as already covered by this closure (it had drifted out of
sync with the actual WS1 §1 "Mover-audit dossier" pointer, which already claimed 22/24 done — this
entry reconciles both to the same 24/24 fact). No code or fixture changed.
Superseded-by: none

### 2026-08-27 · WS2 Step 18 · ws2-step18-msvc-crt-closed
**OPERATOR-ATTESTED closure.** The MSVC C++ runtime bug (WS2 Step 17 Part 1, commits `6b22231`/
`e1103ac`) moves from Finished-but-pending-verification to Finished.

**What was built (Step 17 recap, for a self-contained closure record):** MEASURED per-binary
import list (`pefile` against the real, hash-verified `onnxruntime-win-x64-1.23.2` release,
`docs/ws2-fa-models/ort-provisioning.md`) — `onnxruntime.dll` needs `VCRUNTIME140.dll`,
`VCRUNTIME140_1.dll`, `MSVCP140.dll`, `MSVCP140_1.dll`; `onnxruntime_providers_shared.dll` needs
`VCRUNTIME140.dll`. Option A (app-local deployment) shipped over Option B (NSIS chain-install):
`build.yml`'s Windows leg downloads the official `vc_redist.x64.exe` (pinned URL, sha256
`cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b`), installs it on the disposable
CI runner, and copies the 4 resulting `System32` files into `src-tauri/onnxruntime/` alongside
`onnxruntime.dll` — sanctioned by Microsoft's own docs ("Install individual redistributable
files": *"It's also possible to directly install the Redistributable DLLs in the application
local folder"*) and licensed as Distributable Code under the VS2022 Microsoft Software License
Terms ("Visual C++ Runtime Files": *"you may copy and distribute with your program any of the
files within the following folder and its subfolders... [VisualStudioFolder]\VC\redist"*), both
fetched and quoted verbatim in `docs/ws2-fa-models/ort-provisioning.md`. Build guard: "Guard
against missing app-local MSVC runtime DLLs" fails the build if any of the 4 CRT files or 2
onnxruntime files are absent from `src-tauri/onnxruntime/` before `tauri:build` runs. Diagnostic:
`src-tauri/src/fa_onnx.rs:433`'s `augment_ort_load_error` names the missing dependency on a
Windows `ort::init_from` load failure instead of surfacing a raw, ambiguous `os error 126`.

**Closing evidence (OPERATOR-ATTESTED, this session).** Installer built by "Build desktop
installers" from commit `6b22231`, installed and run on a Windows machine the operator reports
had recently had a fresh Windows installation. Grade note: "recently had a fresh Windows
installation" is a strong attestation, not a provable never-had-Visual-Studio machine — this is
the evidence ceiling for this class of check, not inflated to MEASURED and not discounted. Sync
Log: `[17:50:09] FA PRE-FLIGHT: ready — runtime loaded and model present for "en"` and
`[17:50:09] Timing engine: forced alignment (312 aligned word(s))` — FA loaded and produced
timing, not a fallback to Whisper (the failure mode Step 15's 117-cut regression exhibited before
this fix). This project is a different, smaller project (33 segments) than the 229-segment
corpus WS2 Step 15 closed against — it does not re-verify Step 15's findings, only this fix's own
runtime behavior on a clean-ish machine. Satisfies `docs/ws2-fa-models/ort-provisioning.md`'s
"Operator checklist" steps 3-6 in substance (FA pre-flight ready, sync used FA timing, pass
reported); step 1's explicit `Test-Path` clean-machine confirmation was not separately run or
reported by name.

**Three NOT DETERMINED items this run retires (from `ort-provisioning.md`'s "What Phase 4/Step 17
Part 1 did NOT verify"):**
- **CI execution of the provisioning + guard steps: CI-VERIFIED.** Run `33068050720`
  (https://github.com/mohtashim9119-web/kinetix-pro-studio/actions/runs/33068050720), headSha
  `e1103ac` (a descendant commit carrying `6b22231`'s full diff, confirmed via `git log`),
  conclusion `success`. Job step list (`gh api .../jobs`, this session): both "Provision MSVC C++
  runtime DLLs app-local (Windows x86_64, WS2 Step 17 Part 1)" and "Guard against missing
  app-local MSVC runtime DLLs (Windows, WS2 Step 17 Part 1.4)" show `conclusion: success`.
- **`whisper-cli.exe` CRT dependency: RESOLVED BY OBSERVATION (OPERATOR-ATTESTED).** The operator
  log's 33/33-segment match with real transcript tokens requires `whisper-cli.exe` to have loaded
  and executed successfully on this machine — it loaded.
- **`ffmpeg.exe` / `ffprobe.exe`: `ffmpeg.exe` exercised (code + operator log); `ffprobe.exe` is
  not a real open question.** `src-tauri/src/whisper.rs:216`'s `transcode_to_wav` runs
  unconditionally before `whisper-cli` ever sees a file (`whisper.rs:293`'s "Universal
  pre-transcode" call site) — every successful Whisper transcription on this machine, including
  this run's 33/33-segment match, therefore required `ffmpeg.exe` to load and exit 0 first.
  CORRECTION to `ort-provisioning.md`'s per-binary table: this codebase ships no separate
  `ffprobe` binary at all — `src-tauri/tauri.conf.json:39`'s `externalBin` lists only
  `binaries/ffmpeg`/`binaries/whisper`, `src-tauri/binaries/` contains no ffprobe file, and
  `src-tauri/src/ffmpeg.rs:539`'s own comment states it directly: "the bundled build ships ffmpeg
  only (no separate ffprobe binary)" — duration probing reuses the `ffmpeg` sidecar
  (`ffmpeg_probe_duration_secs`). `ort-provisioning.md`'s NOT DETERMINED line naming `ffprobe.exe`
  as an open question is a documentation error, not a real gap — there is nothing to determine.

**Installer size delta: MEASURED (CI build-artifact zip, not confirmed as the isolated installer
file alone).** Comparing the last pre-MSVC Windows CI artifact (run `33017398678`, headSha
`5adbbf4`, `kinetix-windows-x64` 84,262,143 bytes) against the first post-MSVC run (`33068050720`,
headSha `e1103ac`, 84,815,772 bytes): **+553,629 bytes (~540.7 KiB / ~0.53 MB).** Sanity check:
the same two runs' `kinetix-macos-universal` artifact moved only 14 bytes (82,297,900 →
82,297,886), consistent with the change being Windows-only and the delta above being
attributable to it rather than noise. Kept labeled as an artifact-zip delta, not upgraded to
"installer size," because no Windows hardware separated the `.msi`/NSIS `.exe` from the rest of
the CI artifact's contents this session.

Superseded-by: none

### 2026-08-27 · WS2 Step 18 · ws1-nonascii-segment8-third-occurrence
**Corroborating evidence, WS1 §5's open non-ASCII/numeral-matching bug — no fix attempted.**
Segment 8, "The complexity originates in 1198," matched 4 of 7 words (57%) in this session's
33-segment operator run — the third time this exact segment has failed, now including a
33-segment project structurally unrelated to the 229-segment corpus the first two failures came
from (WS2 Step 15's before/after Windows runs). Practical consequence: the bug is now
reproducible on a small (33-segment) project, which is materially cheaper to debug than the
229-segment corpus it was previously confined to.

Of the bug's three standing hypotheses (Unicode NFC/NFD normalization mismatch; en-language CTC
vocab glyph coverage for í/ñ/é; numeral-to-word expansion), this run speaks only to the third:
segment 8 contains a bare numeral ("1198") and no diacritics, so it cannot corroborate or refute
the NFC/NFD or CTC-vocab hypotheses (those remain evidenced only by the Llívia/Peñón segments,
still UNVERIFIED). Numeral-expansion is now the best-supported of the three hypotheses on
available evidence — three independent failures, all numeral-bearing, none diacritic-bearing —
but this is a corroboration count, not a diagnosis; no fix attempted, no code touched.

**Token-filtering figure, recorded alongside the existing platform-comparison figures.** This
run's Sync Log: `[17:47:03] TOKENS Filtered 47 of 411 tokens (42 empty text, 5 zero/inverted)` —
47/411 = 11.4%, Whisper path. Alongside the existing measurements (Windows 303/2855 = 10.6%,
macOS 310/2823 = 11.0%, both Whisper path, `#2026-08-27--ws2-step-15--ws2-step15-token-filtering-resolved`
above), this is a third data point in the same 10-11% band, further confirming token filtering is
a Whisper-path property, not platform-specific. **Mechanism remains NOT DETERMINED** — same
standing caveat as the prior entry: the numeric contrast alone does not establish why, and none
is asserted. Per this session's handling rules for this log: no arithmetic relationship between
411, 47, and this run's separately-reported 312-aligned-word FA figure is derived or implied —
they do not reconcile (411 − 47 = 364 ≠ 312) and the provenance of the 17:47 TOKENS line relative
to the 17:50 sync-completion line is unresolved; both figures are recorded as stated, nothing
more.

No "cuts landed on audio that's still playing" line appears anywhere in this run's Sync Log —
recorded as an observation (zero such cuts on this specific 33-segment project), not as evidence
the separate cut-placement-quality bug (WS1 §5) is fixed; a 33-segment project is not a test of a
defect rate measured in parts-per-228 on a much larger corpus.

Superseded-by: none

### 2026-08-05–08-25 · ws1-phase1b-3d-groundwork
Outcome: WS1 Phase 1b–3d groundwork closed — dev instrumentation, Whisper/FA setup, a
Dynamic-Time-Warping per-token timestamp approach abandoned in favor of forced alignment
(`docs/history.md` line 407 for the earlier DTW mention), the 5 fr/es/de/pt language-keyed
normalization rules (Phase 3b, see `phase-3b--language-keyed-normalization-rules-15` above),
compound-word/hyphen-asymmetry audit (Phase 3c, see `phase-3c--hyphen-asymmetry-closed` above),
and Phase 3d explicitly skipped. Moved out of `docs/work-in-progress.md`'s WS1 Finished Tasks
line, which had pointed here generically without a specific anchor.
Superseded-by: none

### 2026-08-27 · operator-attested · ws1-spanish-corpus-acceptance-lapse-closed
Outcome: Spanish-corpus non-English-corpus written-acceptance reopening trigger (fired in literal
text when Phase 3b shipped Spanish cardinal normalization, 2026-08-15; unruled since Session AC
flagged it 2026-08-22) ruled CLOSED via Option (a) of `sync-pipeline-v2-plan.md` Part AI.8: the
owner personally ear-verified all 27 Spanish corpus boundaries following a live forced-alignment
sync and confirmed 100% timing accuracy across all boundaries. Full ruling text:
`project-state.md` §5 ("Spanish-corpus acceptance ruling (2026-08-27)").
Evidence: OPERATOR-ATTESTED (owner ear-verification pass, 27/27 boundaries).
Numbers: 27 Spanish corpus boundaries, 27/27 (100%) confirmed correct.
Superseded-by: none
boundary). `cargo test` 31 passed, 0 failed (19 -> 31, +12, exactly the tests added). `npm test`
74 files / 1857 passed / 1 skipped / 0 failed (unchanged). `npm run lint` clean. Golden replay 6/6
(unchanged). `git diff --stat` on `Cargo.toml`/`Cargo.lock`: empty (no dependency added).

## Project Persistence — localStorage QuotaExceededError (2026-08-25)

**Report.** A real desktop run (V8 project, ~21 min audio) hit `QuotaExceededError` repeatedly
on `projectStore.ts`'s debounced autosave once the serialized project reached ~915,000 chars —
logged (`[Kinetix] FAILED to save project ... QuotaExceededError`) but every edit since the last
successful save was silently unpersisted from the user's point of view.

**Root cause, confirmed by reading the code rather than reproducing the exact byte count.**
Two independent defects, both real:

1. **The reporting plumbing already existed and was already discarded.** `saveProject` (WS1
   Session O) already returned a typed `SaveOutcome` distinguishing `quota-exceeded` from success
   — but every call site (`usePersistProject.ts`'s debounced autosave and `saveNow`, `App.tsx`'s
   `handleNewProjectConfirm`) discarded the return value. Worse: `usePersistProject.ts`
   unconditionally called `setLastSavedAt(ts)` after firing `saveProject`, regardless of whether
   it succeeded — so the footer's "Saved" label was driven by "a save was attempted," not "a save
   landed." A failed autosave was **indistinguishable in the UI from a successful one.**
2. **`localStorage` is a single ~5-10 MB budget shared across every project's JSON, the registry,
   and per-project thumbnail data URLs on the origin** (the same ceiling already measured
   elsewhere in this codebase — 20 history snapshots of the largest known corpus project alone is
   6.02 MB, see the "history persistence" ruling above). A single ~915,000-char project is not
   itself near that ceiling; it is the write that tips an origin already holding several other
   projects over the edge. The threshold that actually mattered was never "how big is one
   project" — it was "how much is already on this origin," which nothing surfaced to the user
   either.

**Fix — full localStorage → IndexedDB migration for project bodies**, scoped per owner decision
(the alternative — a visible-warning-only fix — was explicitly declined in favor of removing the
shared-budget problem at its root, matching the fix already applied to assets (`assetStore.ts`)
and waveform peaks (`waveformStore.ts`)):

- New `src/services/projectDataStore.ts` — an IndexedDB store (`kinetix-projects` DB,
  `projects-v1` object store, keyed by project id), mirroring `assetStore.ts`'s existing
  open/transaction pattern. `projectStore.ts`'s `saveProject`/`loadProject`/`loadProjectDetailed`/
  `deleteProjectData`/`migrateLegacyIfNeeded`/`adoptMirroredProjects` all became `async`, backed
  by this store instead of `localStorage.setItem(kinetix:project:<id>:v1, ...)`. The registry
  (`ProjectMeta[]`, small — no segment/heading bodies) and `kinetix:lastOpenedProjectId` stay in
  `localStorage`, synchronous, unchanged — they were never the problem.
- **`migrateLocalStorageProjectsToIndexedDB()`** (new, `projectStore.ts`) — a one-time,
  idempotent boot-time migration for projects an existing installed build already saved under the
  old per-project `localStorage` keys: copies each into IndexedDB, then removes the `localStorage`
  key, freeing exactly the budget that was going stale. A per-id failure (bad JSON, wrong shape)
  leaves that id's `localStorage` copy untouched for a retry on the next boot, matching this
  module's existing "never destroy unreadable evidence" posture. Runs in `App.tsx`'s boot effect,
  before mirror adoption (whose own "already present locally" check now looks at IndexedDB, not
  `localStorage`).
- **The UI wiring gap is closed.** `usePersistProject.ts` now tracks the latest in-flight save
  attempt and only stamps `lastSavedAt` on a genuine success; a failure is exposed as `saveError`
  instead. `App.tsx` shows a red "Save failed" label (replacing "Saved"/"Unsaved") with the
  failure reason as a tooltip, plus a one-shot toast per distinct failure reason (not once per
  500 ms retry, since the underlying condition typically persists across several autosave ticks).
- `saveProject`'s Guard 3 (write verified by reading it back, not merely trusted) was kept in the
  IndexedDB form — a transaction resolving is normally durability itself, but the read-back is one
  cheap indexed lookup and preserves the same "verified, not trusted" posture Session O
  established for `localStorage`. The `parse-error` `StoreFailureReason` is now effectively
  unreachable via `loadProjectDetailed` (IndexedDB records are structured, not JSON text to
  `JSON.parse`) — left in the union rather than removed, since `adoptMirroredProjects` still
  parses JSON text arriving from the Rust-side durable mirror.

**Verified:**
- `npm run lint` (tsc --noEmit) clean.
- `npm test`: the 5 directly-touched suites (`projectStoreGuard.test.ts` — rewritten to mock
  `projectDataStore.ts` with a Map-backed fake plus injectable put/get failures rather than
  simulating real IndexedDB quota enforcement (`fake-indexeddb` does not enforce one);
  `projectMirrorAdoption.test.ts`, `faGate.test.ts`, `faWordTimingsSchema.test.ts`,
  `d1RegressionChecklist.test.ts` — updated for the new `async` signatures, polyfilled via
  `fake-indexeddb/auto`) — 87/87 passing. Full `npm test`: 29 pre-existing failures, all in
  `scripts/ws1-*` FA-pipeline replay suites failing on a missing local fixture
  (`Missing replay input: .../audio_16k.wav` — needs `python3
  scripts/phase4-restore-replay-inputs.py`), unrelated to this change and unchanged by it.
- Manual verification in the running dev app (`npm run dev`, browser preview): a new project
  saves and reloads correctly with its data confirmed to live in the `kinetix-projects` IndexedDB
  database and NOT in any `kinetix:project:*` `localStorage` key. A simulated quota failure
  (monkey-patched `IDBObjectStore.prototype.put` to throw `QuotaExceededError`) produced the red
  "Save failed" footer label and the expected toast; un-patching and retrying recovered cleanly.
  A simulated pre-migration project (seeded directly into the legacy `kinetix:project:<id>:v1`
  `localStorage` key + registry, as an already-installed build would have it) was migrated into
  IndexedDB on the next boot, its `localStorage` key removed, and the project opened from the
  dashboard with its segment intact.

## WS2 T1.1 — Storage Loss Diagnosis (2026-08-27, session ws2-20)

**Question.** Whether "lost on upgrade" data was (a) never persisted (sync state missing from
the save payload), (b) a storage-backend/lifecycle failure, or (c) genuinely destroyed by an
installer/bundle-identifier change. Full write-up: `.work-phase4/session-ws2-20/t11-storage-audit.md`.

**Findings, repo-audited (MEASURED) then corroborated on-machine (OPERATOR-ATTESTED):**
- `saveProject()` (`projectStore.ts:152` at the time) serializes the entire `Project` object,
  `segments[]` included — sync/timing state was never excluded from the payload. Ruled out as
  the cause.
- Bundle identifier/productName (`com.kinetix.pro-studio`) never changed since introduction
  (`git log -p --follow` on `tauri.conf.json`, commit `30847f2`, 2026-05-25) — ruled out.
- No `beforeunload`/Tauri `CloseRequested` handler exists anywhere in the codebase — the 500ms
  autosave debounce has no forced flush on exit (real, narrow gap, not the reported symptom).
- Dev (`http://localhost:3000`) vs. release (`tauri://localhost`) origin split is real and
  already the subject of WS1 Session O's `project_mirror.rs`/`adoptMirroredProjects()` mitigation.
- WebView2 data-folder location (the one item not settled by repo code alone): operator ran the
  Part B read-only scripts on both machines. Windows install-dir scan (`Program Files`/`Program
  Files (x86)` for `*.WebView2`) came back EMPTY; `EBWebView` (586 MB) lives inside the
  identifier-keyed `%LOCALAPPDATA%\com.kinetix.pro-studio` tree (3.37 GB total) — ruling out the
  install-dir-wipe-on-upgrade hypothesis. macOS: 11 GB `Application Support` /
  `com.kinetix.pro-studio`, 1.2 GB dev-origin WebKit, 829 MB release-origin WebKit. Gigabyte-scale
  figures are consistent with `assetStore.ts`'s separate IndexedDB video/image blob store sharing
  the identifier-keyed tree, not project JSON (not independently re-derived from the reported
  numbers — flagged as inference, not measured).
- `preserve/indexeddb-project-store` (commit `0386542`) verified rebase-clean via `git merge-tree`
  against `main` — 12 of 14 touched files byte-identical to their merge-base version; `App.tsx`
  and `docs/history.md` diverged (37 commits ahead) but auto-merge cleanly (no conflict markers).

**Operator decision (owner, in-session):** run the Part B evidence scripts before choosing a
recovery-vs-rebuild path; results above closed the one open question (A5), so proceeded straight
to T1.3 rather than a separate pre-upgrade-data recovery task.

## WS2 T1.3 — OS-Backed Project Store (2026-08-27, session ws2-20)

**Context.** T1.1 above found the quota/lifecycle defect (`work-in-progress.md`'s now-closed
`[DEFERRED]` entry — `QuotaExceededError` at ~915,000 chars, `localStorage`'s shared ~5-10 MB
origin budget) was the real gap, not data ever being excluded from saves. The prior session's
`preserve/indexeddb-project-store` candidate (see the entry immediately above this one) targeted
IndexedDB; this task's brief specified an OS-backed file store instead
(`app_local_data_dir()/projects/<id>/project.json`, Rust-written), so the backend differs from
that preserved branch even though its async-refactor/race-dedup/UI-error-surfacing work was
reused as-is.

**Design decisions (owner-confirmed via AskUserQuestion before implementation):**
1. Promote `project_mirror.rs` into the primary store rather than build a parallel Rust module —
   its `write_atomic`/`safe_id`/`rotate_backup` were already the crate's most rigorous atomic-write
   implementation and are reused unchanged.
2. Keep a `localStorage` fallback behind `isTauri()` for plain `npm run dev` (no Tauri IPC bridge
   there) rather than breaking that preview mode.
3. Registry (`kinetix:projects:v1`), thumbnails, and `kinetix:lastOpenedProjectId` stay in
   `localStorage` — out of scope, not the source of the quota cliff.

**Implementation.**
- `project_mirror.rs`: new `project_store_{read,write,delete,list_ids}` `#[tauri::command]`s,
  writing to `app_local_data_dir()/projects/<id>/project.json` (separate tree from
  `project-mirror/`'s existing backup path), with their own `project-store-backups/<id>/`
  rotation tree (`rotate_backup` generalized to take an explicit `backups_root` parameter so both
  trees share the logic without contending over one directory). 5 new unit tests (path shape,
  backup-tree separation, write/read/delete round trip incl. empty-dir pruning, `list_ids`
  filtering) — 161/162 `cargo test` passing (1 unrelated pre-existing live-network test ignored).
  Registered in `lib.rs`'s `invoke_handler`.
- `src/services/projectStoreClient.ts` (new): thin `invoke()` wrappers for the 4 commands,
  throwing (not swallowing) on failure — unlike `projectMirror.ts`'s best-effort mirror client,
  this is the primary path and `saveProject`/`loadProjectDetailed` need the real error.
- `projectStore.ts`: cherry-picked `preserve/indexeddb-project-store`'s `0386542` verbatim first
  (`git merge-tree` confirmed zero-conflict), then swapped every `projectDataStore.ts`
  (IndexedDB) call for the new client + an `isTauri()` branch falling back to the original
  `localStorage.setItem/getItem/removeItem(projectKey(id))` behavior. `projectDataStore.ts`
  deleted (unused). Migration renamed `migrateLocalStorageProjectsToIndexedDB` →
  `migrateLocalStorageProjectsToOsStore` (no-ops outside Tauri), targeting the OS store.
  `adoptMirroredProjects()` modified in place to adopt into the OS store rather than back into
  `localStorage` — simpler than the plan's originally-sketched separate adoption pass, since the
  function already did exactly this job, just against the wrong backend.
- `docs/history.md`: the cherry-picked commit's 83-line append relocated here (this file) per its
  own note and the current docs split, since `main`'s `docs/history.md` had already collapsed
  that region to a pointer.
- Test suites updated: `projectStoreGuard.test.ts` and `projectMirrorAdoption.test.ts` rewritten
  to mock `isTauri()` true + `projectStoreClient.ts` (Map-backed fake, string-in/string-out,
  matching the real client's contract) instead of IndexedDB/`fake-indexeddb`; `faGate.test.ts`'s
  "G1 proof" block (the only describe block there stubbing `window.__TAURI_INTERNALS__` while
  calling `saveProject`/`loadProject`) given the same client mock.
  `faWordTimingsSchema.test.ts`/`d1RegressionChecklist.test.ts` needed no changes — they never
  stub Tauri, so `isTauri()` resolves false and they already exercised the (unchanged)
  `localStorage` fallback path.

**Verified:**
- `npm run lint` (tsc --noEmit) clean.
- `npm test`: 2560 passed, 77 skipped (unrelated, pre-existing gate), 0 failed — full suite, not
  just the 5 touched files (which are 87/87 on their own).
- `cargo test` (src-tauri): 161 passed, 1 ignored (unrelated live-network test), 0 failed.
- Golden replay (`scripts/phase4-handoff-replay-sync.test.ts`): 6/6, run as the standing sanity
  check (this change doesn't touch sync timing).
- Manual browser verification (`npm run dev`, Browser pane): created a project, confirmed the
  `localStorage` fallback key (`kinetix:project:<id>:v1`) was written, footer showed "Saved" (not
  "Save failed" — confirms `saveError` wiring), reloaded, project reopened intact with zero
  console errors.
- OPERATOR-ATTESTED (2026-08-27, following session): live `npm run tauri:dev` round trip on the
  physical build — synced an existing project, quit the app completely, reopened it; project data
  and synced state persisted and reloaded correctly from the OS file store. This was the one gap
  the implementing session couldn't close itself (no native macOS app control tool available to
  it) and closes T1.3 fully verified. Branch `ws2-t13-os-project-store` merged to `main`
  immediately after.

## WS2 T1.2 — Stable Content-Derived Segment IDs (2026-08-27, branch ws2-t12-stable-segment-ids)

**Context.** `VideoSegment.id` predated this task but was minted fresh with `crypto.randomUUID()`
on every Apply Sync — useless as a cross-run identity, only a per-render React key. T2.2's planned
operator-override layer (keep/hide/manually add/delete a segment, persisted by id) needs an id
that survives a re-sync of the same script, which random UUIDs cannot provide.

**Chosen hybrid semantics (owner-selected, WS2 session ws2-21).** Two building blocks:
- `computeContentKey(text, ordinal)` — a PURE function of (normalized text, ordinal), where
  ordinal is the segment's 0-based rank among prior segments in the same array that normalize to
  identical text, assigned in document order. Two parses of the same script always produce the
  same keys; this is what makes an id "content-derived."
- `assignSegmentIds(segments, previousSegments?)` — the JOIN that makes an id "persisted, assign-
  once" rather than a pure hash: a freshly-parsed segment whose content key matches one from
  `previousSegments` (the project's segments before this Apply Sync run) carries forward that
  previous segment's persisted `id`; a segment with no match (new text, or the first-ever parse)
  gets its freshly-computed content key as its id instead. The join compares content keys only,
  never the id values themselves — so a previous id that isn't itself content-shaped (e.g. a
  backfilled pre-T1.2 UUID) still joins correctly on its segment's text.

**`SEGMENT_ID_NORM_V1` freeze note.** `normalizeForSegmentId` (`src/services/segmentId.ts`) is
frozen and versioned independently of `textNormalize.ts`'s alignment-tuned pipeline — it only
collapses cosmetic differences (NFKC, case, whitespace, punctuation), not spoken-audio matching
rules. It must never be edited in place, including by T3.1's canonical-match-form work: any future
change to id-derivation normalization ships as a new `SEGMENT_ID_NORM_V2` function alongside V1,
with its own version tag, so a rotation is a detectable event (`id.startsWith('segv2_')`) rather
than a silent id change for every existing project on its next load. The version tag
(`SEGMENT_ID_NORM_VERSION = 'segv1'`) is embedded in every id produced by this module.

**Implementation.**
- `src/services/segmentId.ts` (new): `normalizeForSegmentId`, `computeContentKey`,
  `assignSegmentIds`, and `backfillSegmentIds` (one-time load-path backfill — replaces any id
  that's missing or predates this module with its content key; idempotent, a segment already
  carrying a current-version id is left untouched).
- `App.tsx`'s `parseProjectData` now calls `assignSegmentIds(finalSegments, previousSegments)`
  once per whole array instead of minting `crypto.randomUUID()` per segment.
- `projectStore.ts`: on-disk schema version bumped to 3; `loadProjectDetailed` calls
  `backfillSegmentIds` on every load. `migrateLegacyIfNeeded` (the single-project legacy-key path)
  was found NOT to call it during this close-out pass — a legacy project re-saved through that path
  would keep pre-T1.2 ids instead of being backfilled. Fixed as a one-line addition
  (`stored.project.segments = backfillSegmentIds(stored.project.segments);` before the re-save),
  same call style as `loadProjectDetailed`.
- Three pre-existing tests (`faGate.test.ts`, `faWordTimingsSchema.test.ts`) used legacy-shaped
  fixture ids (`s1`/`seg-N`) in byte-for-byte round-trip assertions; updated to strip `id` before
  comparing, since those ids are now intentionally backfilled on load — a deliberate migration, not
  a retime. New `projectStoreSegmentId.test.ts` covers the backfill/load path directly.

**Verified (post-fix, full branch close-out):**
- `npm run lint` (tsc --noEmit) clean.
- `npm test`: 2581 passed, 77 skipped (unrelated, pre-existing gate), 0 failed — full suite.
- Golden replay (`scripts/phase4-handoff-replay-sync.test.ts`): 6/6.
- `gaplessInvariant.test.ts`: 36/36.
- Merged to `main`, fast-forward push (no divergence — `main` matched `origin/main` before merge).

## WS2 T2.1/T2.2 — Gap-Absorption Restore, and the Abandoned Never-Drop Design (branch ws2-t21-gap-absorption, sessions ws2-19 through ws2-26)

**The pivot.** Phase 2's ORIGINAL spec (`docs/work-in-progress.md`, still titled this at the
start of the branch) was "Never-drop segments & operator override": T2.1 was to place every
unmatched segment at an interpolated timestamp with a `timingSource`/`confidence` flag and a
sync-log warning, so nothing Apply Sync couldn't match would ever leave the timeline — dropping
was to be eliminated, not tracked. A branch toward that design (referenced in this session's own
brief as `ws2-t21-never-drop-segments`) was abandoned before landing on `main` or anywhere
reachable from this repository's local history — this entry cannot cite its specific commits or
diagnose why it stalled, only record that it existed and was not carried forward. What actually
shipped on `ws2-t21-gap-absorption` instead keeps R4-1/R.10's existing drop behavior unchanged
and, across sessions ws2-19 through the first half of ws2-26, added a RECOVERY layer on top:
`computeAbsorbedGaps` (`absorbedGaps.ts`) records exactly which survivor absorbed a dropped
scene's reclaimable span at Apply Sync time, and a restore UI (context menu + sync-log
multi-select) recreated the dropped scene from that record on request — first automatically
(evidence-gated), then via an explicit Forced Restore human override for the zero-evidence case.
The rationale for the pivot, as best reconstructed from the shipped design: interpolating a
timestamp for a scene the transcript never recorded is the same fabrication problem restore
Commits 1/2 later had to solve explicitly (character-weighting a span with no acoustic evidence
behind it) — never-drop would have shipped that fabrication silently and automatically for EVERY
unmatched scene, where the shipped design instead made it an explicit, evidence-gated, opt-in
recovery action.

**Round 1 of 2 — the operator reverted the whole restore UI, later the same session (ws2-26).**
Both the automatic and the Forced Restore paths still ultimately sized a recreated segment either
from real orphan tokens (when they existed) or from character-weighted guesswork (when they
didn't) — and even the orphan-token case only approximates real word timing. The operator found
these durations inaccurate enough in practice to require manual adjustment anyway, making the
whole automated/semi-automated reconstruction a wasted step rather than a real convenience.
Decision: remove restoration entirely — automatic, Forced, and the context menu that triggered
either — and make recovery fully manual (jump to the drop via the sync log's existing
"Jump to absorbing scene" link, then split (`S`) the absorbing clip and retype). The read-only
half of the design (`computeAbsorbedGaps` feeding the skip-log's warning message and the jump
link) was kept — that part was never a fabrication, only a report of what the sync pipeline
already decided.

**Commits, `8ed1d51` (salvage — `SyncLogEntry.segmentId` + char-weighted split helper) through
the round 1 revert (`2d773e8`):**

| Commit | Session | What it did |
|---|---|---|
| `8ed1d51` | ws2-19 (salvage) | `SyncLogEntry.segmentId` field; `charWeightedSplit.ts` helper |
| `8fd15f9` | ws2-19 | Slice segment ids for restored/split absorbed-gap segments *(reverted)* |
| `f4ebf82` | ws2-19 | Absorbed-gap metadata, telemetry, sync-log deep link *(metadata/telemetry reverted; deep link kept)* |
| `f6dd6af` | ws2-19 | Restore absorbed segments (context menu + sync-log multi-select) *(reverted)* |
| `a61ac33` | ws2-19 | Split (S) / delete (D) for restored/split segments *(split kept; restored-segment delete path reverted)* |
| `b340f8d` | ws2-19 | Made the restore/split/delete UI actually reachable (bugs 4/5/6) *(restore-UI part reverted)* |
| `b69c14c` | ws2-25 | Pinned the absorbed-gap word source (Commit 1 — audit found the premise already refuted: `App.tsx` already passed the alignment engine's own word array, not a stale one) |
| `c17d7b6` | ws2-25 | Size a restore from its own orphan tokens, not the raw gap width *(reverted — the whole sizing problem this solved no longer exists)* |
| `00bf03d` | ws2-25 | Fixed restore geometry — double-floor bug, leading-run direction, merge rule (Commit 3) *(reverted)* |
| `75ac55b` | ws2-25 | Restored/split segment lifecycle — titles, deletability, text (Commit 4) *(restored-segment half reverted; plain split lifecycle kept)* |
| `0fa341d` | ws2-25 | Honest sync-log numbering and wording (Commit 5) *(kept — this is the numbering later found still off by one, see Open bugs)* |
| `cac9658` | ws2-25 | Real-corpus regression tests for the whole restore path (Commit 6) *(deleted with the restore path it tested)* |
| `37f6fde` | ws2-26 | Evidence-only refusal — removed the 0.25s width clause that let 173's `blue_monkey` (0 orphan tokens, 0.88s gap) fabricate a clip while v6 027-029 (identical evidence, 0.24s gap) was correctly refused (Commit 1) *(moot — reverted along with the restore path it gated)* |
| `c6480b1` | ws2-26 | Fixed a live-app text-loss bug: deleting an unrelated segment unconditionally cleared `selectedSegmentId`, unmounting the caption drawer of whatever OTHER segment was open (Commit 3) *(kept — but the operator reports the underlying symptom still reproduces; see Open bugs)* |
| `84fdc57` | ws2-26 | Single-click selection highlight on Timeline clips — `selectedSegmentId` was never threaded into `Timeline.tsx` at all (Commit 4) *(reverted — operator found the ring "looked weird")* |
| `225da76` | ws2-26 | WKWebView Timeline-clip context-menu fix, `.kx-timeline-clip` CSS exemption (Commit 5, unverified — needs a live macOS check) *(reverted along with the context menu it existed to make clickable)* |
| `087b5cc` | ws2-26 | Forced Restore — human override for a zero-evidence gap, `isForceRestored`/`'force-keep'`, `ForceRestoreConfirmModal` (Commit 2) *(reverted)* |
| `2d773e8` | ws2-26 (round 1) | THE REVERT. Deletes `absorbedGapRestore.ts`/test, `ForceRestoreConfirmModal.tsx`/test, `scripts/ws2-restore-corpus.test.ts`; removes `VideoSegment.absorbedGaps`/`isForceRestored`, `Project.segmentOverrides`, `SyncLogEntry.restoreGapId`; removes Timeline's right-click context menu and its `.kx-timeline-clip` CSS exemption; removes the Timeline selection ring (separately requested — "looked weird"); trims `absorbedGaps.ts` down to read-only reporting (`computeAbsorbedGaps` minus orphan-token/spokenSpan/hostSide computation, `applyAbsorbedGaps` gone); simplifies `segmentSplitDelete.ts`'s `deleteSegment` to drop the `restoredIds` parameter and the merged-restore-slot carve-out; reverts `projectStore.ts`'s on-disk schema version 5 -> 4. |

**State at close of round 1 (ws2-26).** Phase 2 (T2.1/T2.2) is closed at a much smaller scope
than any point in its history above: gap-absorption tracking survives ONLY as read-only sync-log
reporting (the skip warning's "Absorbed X -> Y -> Z" message and the "Jump to absorbing scene"
link); every restore/recovery mechanism — automatic, Forced, and the context menu that triggered
either — is gone. Two real bugs surfaced during this work remain open (`docs/work-in-progress.md`
§4, not fixed in round 1): the sync-log's "Clip N" numbering is off by one on both real corpora
(v6 and 173, operator-confirmed), and the split-then-delete caption-loss symptom still reproduces
live despite `c6480b1`'s fix landing. Full gate state at round 1's close: `npx tsc --noEmit`
clean, `npm run lint` clean, `npm test` 2627 passed / 77 skipped / 0 failed, golden replay
(`scripts/phase4-handoff-replay-sync.test.ts`) 6/6 byte-identical, `gaplessInvariant`
(`dragSession.test.ts`) 36/36 — sync pipeline untouched throughout. `docs/history.md` untouched
throughout this session (verified with an empty `git diff -- docs/history.md`).

---

## WS2 T2.1/T2.2 — Round 2: host attribution, the boundary-policy round trip, and the two real bugs closed (branch ws2-t21-gap-absorption, session ws2-27 through this session, 2026-08-31)

**Host attribution (`computeAbsorbedGaps`) was wrong, not "off by one."** Round 1's Open Bugs
entry explained the mislabelled "Clip N" as a rehydration/renumbering shift — the theory being
that S27/28/29 dropping as one run shifts every later clip number, so "clip 30 becomes clip 27"
and the log's arithmetic just hadn't caught up. That explanation was wrong. S-numbers are the
scripted scene's ORIGINAL position and never renumber, no matter what drops; clip numbers are
positions in the COMMITTED (post-drop) array and do renumber every time something upstream is
skipped — the two are different axes entirely, not the same number seen before and after a shift.
The actual defect was in `computeAbsorbedGaps` itself (`absorbedGaps.ts`): `hostKeptIdx` preferred
the survivor BEFORE a dropped run (`prevKeptIdx`) over the one after it, so both the printed label
and the sync log's "Jump to absorbing scene" link named the wrong clip — not a numbering-shift bug
at all. Measured directly against both real corpora once the real cause was suspected: v6 S27-29
showed the previous survivor is a NET LOSER of duration once `snapCoveredBoundaries` writes its
shared boundary (-0.17s), while the next survivor gains materially in every observed case (v6
+0.41s, 173 +1.79s) — "prev absorbed it" was simply the wrong guess, not an equally-valid
alternative convention. Fixed by flipping the preference to `nextKeptIdx` (falling back to
`prevKeptIdx` only for a trailing run with no next survivor, which is unaffected). A gated
"Clip N also holds X.XXs" note (`otherNeighborId`/`measureOtherNeighborGain`) reports when the
non-host neighbour also gained a material share, so the read-only report stays honest about both
sides of a shared boundary rather than silently crediting only the majority absorber.

**The boundary-policy round trip.** A 100%-to-next gap-absorbing boundary policy (the next
survivor absorbs the WHOLE reclaimable span; the previous survivor is pinned exactly at its own
last spoken word, `lastSpokenEnd`) was implemented to spec this round — and failed live testing:
pinning the previous segment at its last spoken word chopped off its trailing room tone and the
natural breathing pause after it, producing audible hard cuts on playback. Reverted back to the
pre-existing balanced silence-centre/spoken-edge-midpoint rule for every adjacent pair, including
pairs flanking a skipped scene — that pair now gets no special treatment at all, same as every
other boundary in `snapCoveredBoundaries`. The whole implement-then-revert cycle happened inside
one uncommitted working tree and never reached a commit of its own; `git log` shows no commit
between `2d773e8` and `main` that touches `snapBoundaries.ts` for anything but this round's
docstring update. **Standing constraint, not just history: a future gap-absorption boundary
change must not pin either side of a covered pair to `lastSpokenEnd`/`nextSpokenStart` — the
silence-centre/spoken-midpoint rule is the one that survives contact with real audio.**

**Consequence of restoring silence-midpoint: split absorption is normal, not exceptional.** With
the 100%-to-next policy gone, `snapCoveredBoundaries` writes ONE boundary shared by both
neighbours of a dropped run (the pre-existing WS2 ws2-22 finding), and that shared write routinely
gives BOTH sides a real, nonzero share of the reclaimed span — not just the declared host. Of the
four rows checked directly against real corpus numbers this round (v6 S27-29, 173 S112, plus two
more), two were splits large enough to trip the `MIN_SEGMENT_DURATION` note gate; row S13 was not
anticipated going in and only surfaced once real pre/post-snap numbers were pulled. The practical
upshot: the gated "Clip N also holds X.XXs" note is the ROUTINE case for a middle-run drop under
silence-midpoint, not a rare edge case — any future work on this reporting path should expect it
to fire often, not treat a fired note as evidence of something unusual.

**Split-text retention took three attempts because the first two verified the pure functions,
not the app.** Both `c6480b1` (round 1) and the round-2 pair `4f5e09d`+`16b0643` shipped with
passing unit tests against `segmentSplitDelete.ts`'s pure functions, and the live symptom
persisted through all of them — because the pure-function tests could not see either of the two
real defects, which lived elsewhere:
1. **A stale-render defect** (`4f5e09d`, ws2-28 Commit 1) — `BottomDrawer`'s editor was an
   `AnimatePresence` mount/unmount keyed on `segment || heading`. When the open segment was split
   or deleted out from under it, `AnimatePresence` held the last-committed subtree on screen for
   the whole exit transition, so `SegmentControls` kept rendering a segment object already absent
   from `project.segments` — measured directly against the real app's committed React props,
   still stale 3+ seconds later. Fixed by keeping the drawer's `motion.div` always mounted and
   driving the slide with `animate` variants instead of presence, so nothing ever "exits" holding
   stale props; a dev-only console warning now fires whenever `selectedSegmentId` points at a
   segment absent from `project.segments`, so a future path that orphans the selection the same
   way is loud instead of silently degrading to a blank drawer.
2. **A text-merge omission, found only after 1 was fixed** (`054d154`, ws2-28 Commit 3) — with
   the stale-render bug gone, the operator reported a second, genuinely distinct symptom: the
   surviving slice visually stretches to fill the deleted slice's full span, but its caption still
   only covers its own original half of the sentence. `deleteSegment` had, correctly for the
   render bug under investigation at the time, never touched a sibling absorber's text — but that
   was wrong as a STANDING behavior once a clip visually re-spans its whole original duration.
   Fixed by reuniting a SIBLING absorber's text with the deleted slice's own text in chronological
   order (`joinAbsorbedText`), reconstructing the pre-split sentence exactly for the common
   2-slice case; the downstream (non-sibling) absorption fallback is deliberately left untouched
   — merging captions across unrelated segments would not make sense there.
`16b0643` (ws2-28 Commit 2, see below) landed between these two and is a real fix in its own
right, but is not one of the two text-loss defects itself — it is the selection-integrity fix the
text-merge defect's own symptom depended on being visible correctly.

**Selection integrity across split/delete/undo/redo — three related fixes, one theme.**
`16b0643` (ws2-28 Commit 2) reversed ws2-25's "clear `selectedSegmentId` to null on delete" — the
operator's ruling was that closing the caption editor because a NEIGHBOURING slice was deleted is
wrong on its own terms, not just a workaround for a bug. `splitSegmentAtTime`/`deleteSegment`
already decide which segment inherits a split/deleted one's role; that decision was surfaced
(`deleteSegment` gained `absorbedById`) and reused by two new wrappers,
`splitSelectedSegment`/`deleteSelectedSegment`, so a split moves the selection to the first
resulting slice and a delete moves it to the absorbing neighbour, with an unrelated delete/split
still leaving an unrelated selection untouched. This session's own two fixes extend the same
theme to the two remaining places a selection could still go stale:
- **Chained-split sibling detection** (`dfbd093`, this session's Commit C) — repeated tail splits
  nest slice ids arbitrarily deep (`slice1_slice1_ORIG::1::1::0`), and `parentIdFromSliceId` only
  ever recovers ONE level, so an interior slice's true sibling (split away at a different
  generation) no longer matched on immediate parent id and `deleteSegment`'s "last remaining
  slice" refusal fired wrongly. `VideoSegment` gained an optional `rootSegmentId`, set to a
  native segment's own id by `parseProjectData` and propagated unchanged through every split at
  any depth; `deleteSegment` now compares `effectiveRootId` (falling back to the new
  `rootIdFromSliceId` string-walk for a segment saved before the field existed) so same-root
  slices delete in any order regardless of nesting depth.
- **Synchronous undo/redo selection guard** (`c4b6de5`, this session's Commit B) — a traversal
  that made the selected segment disappear still fired the dev warning `4f5e09d` added, because
  `applyRestoredStateImpl`'s async repair updater ran too late to beat the render. `performUndo`/
  `performRedo` (`historySession.ts`) now null `selectedSegmentId` synchronously, in the same
  handler invocation that restores the project, before anything can render the drawer against the
  stale id.

**Commits this round (chronological):** `2d773e8` (ws2-26 round-1 revert, prior entry above) →
`0fa341d` (ws2-25 Commit 5, "honest sync-log numbering and wording" — the numbering fix that
turned out not to be the real host-attribution fix; kept, prior entry above) → `4f5e09d` (ws2-28
Commit 1, stale-render fix) → `16b0643` (ws2-28 Commit 2, selection-redirect on split/delete) →
`054d154` (ws2-28 Commit 3, sibling text reunification) → `4250081` (this session's Commit A,
gap-absorbing boundary policy reverted to silence-midpoint + the real host-attribution/numbering
fix) → `c4b6de5` (this session's Commit B, synchronous undo/redo selection guard) → `dfbd093`
(this session's Commit C, chained-split delete via `rootSegmentId`).

**State at close of this round.** Both real bugs left open at round 1's close (sync-log clip
mislabelling, split-then-delete text loss) are fixed and operator-verified live in `tauri:dev`,
along with two more issues found in the course of closing them (chained-split delete refusal,
undo/redo selection orphaning). Gate state: `npx tsc --noEmit` clean, `npm run lint` clean,
`npm test` 2670 passed / 77 skipped / 0 failed, golden replay
(`scripts/phase4-handoff-replay-sync.test.ts`) 6/6 byte-identical, `gaplessInvariant`
(`src/services/gaplessInvariant.test.ts`) 36/36 — sync pipeline untouched by this round's actual
commits (the boundary-policy experiment never reached a commit; `snapBoundaries.ts`'s only
committed change this round is a documentation comment). `docs/history.md` untouched throughout
this round (verified with an empty `git diff -- docs/history.md`).

**A5 (WebView2 user-data folder location) leaves the ledger as superseded, not re-investigated.**
T1.1 (session ws2-20, entry above) already ran the Part B read-only scripts on both Windows and
macOS and answered A5's original question directly from that evidence. T1.3's later OS-backed
project store — writing through Tauri fs to `app_data_dir/projects/<id>/project.json` — then made
the WebView2 user-data-folder question moot for project persistence regardless of that answer, so
the WIP ledger's "Part B storage scripts unrun" line (stale relative to this record) is removed
rather than re-run or re-verified.

## WS2 T3.1/T3.2 — Phase 3 close-out: canonical text matching and a compositional FA
cardinal-number generator (branch `ws2-t31-language-thread`, sessions ws2-28 through ws2-36,
2026-08-31/2026-09-01)

**T3.1 opened on a language-threading gap that made the whole non-ASCII investigation moot for
the specific rows it was chasing.** `extractSegmentAlignments`/`alignScenestoTranscript` (the
Whisper-matcher functions that actually produce the operator-visible match percentages) had no
`languageCode` parameter at all — every call site normalized script and transcript text with the
English/default fold regardless of `project.language`, even though `useWhisper.ts` already had
the project's real language in scope a few lines above each call (session ws2-29's diagnosis).
Commit `5b439f3` threaded a new `toAlignmentLanguageCode` helper into all six call sites plus
`filterMalformedTokens`'s five. The fix's own measurement (session ws2-30) surfaced a
load-bearing identity: **`canonicalize(text, 'en')` and `canonicalize(text, undefined)` are
byte-identical**, because `textNormalize.ts`'s `NON_ENGLISH_CANONICALIZE_LANGUAGES` set is
`{'es','fr','de','pt'}` — `'en'` never takes the non-English branch. Every real corpus and every
real operator project behind the WS1 §4 rows is `'en'`-tagged, so `'en' ≡ undefined` held
throughout this workstream: golden replay stayed 6/6 byte-identical after the language-threading
commit (not the 0/6 the diagnosis's own worst case predicted), and the WS1 §4 rows' match rates
were measured to be literally unchanged by Commit 1 alone.

**The real fix for WS1 §4's diacritic rows (52/69/79) was a separate defect the diagnosis found
underneath the language-threading gap — an ASCII-strip-to-space bug that split words instead of
folding them.** `canonicalize()`'s English/default branch replaced any non-ASCII character with a
space rather than removing the accent, so `"Llívia"` → `"ll via"` → tokenized as two garbage
fragments `["ll","via"]`, and `"Peñón de Vélez de la Gomera"` → 8 tokens, 4 of them garbage —
reproducing the WIP's reported "4 of 8, 50%" almost exactly. Commit `69d7cfc` added an
NFD-decompose-and-strip-combining-marks step ahead of the existing ASCII strip, on the
English/default branch only (the non-English branch already preserves diacritics via `\p{L}` and
was deliberately left untouched, to protect `fa/text.rs` parity). Measured directly against all
five WS1 §4 rows' exact quoted text: 52/69/79 now tokenize as clean whole words (`"llivia"`,
`"penon"`/`"velez"`); rows 8/102 (numeral rows) were unaffected, as expected, and were separately
measured (session ws2-30) to already produce identical tokens under any plausible transcript
spelling — no code change was needed there. This closed the confirmed mechanism; whether the
operator's real Whisper transcript actually spells these words the way the script does remains
open pending real `project.transcriptTokens` data (`docs/work-in-progress.md` §4, not retired).

**A `tokenHash` identity column was added to all six golden-replay fixtures as a prospective
guard, and was proven, not assumed, to be currently unable to move on any of the three in-repo
corpora.** Session ws2-31's own measurement of `058ccaa` (closing the last two `languageCode`
gaps, in R.12/R.13/R-AP and `countTranscriptWords`) found zero movement in every rule-stage
metric on v6/173/spanish — v6 confirmed the `'en' ≡ undefined` equivalence on real content (8
defect rows, byte-identical); 173 and spanish were structural nulls (zero unscripted runs to
evaluate). Session ws2-32 then added `sha256(JSON.stringify(canonicalize(text, languageCode)))`
(16 hex chars) to both the segments and skipped fixtures — the skipped fixture needed it too
because a skipped segment's `matchedWords`/`totalWords`/`confidence` are counts and ratios, not
content, and a content-changing-but-match-preserving edit (exactly what `69d7cfc`'s fold turned
out to be, symmetrically, on the Spanish corpus) leaves all of them unchanged. Deliberately broke
the NFD-fold and confirmed the hash column would have caught it (all three of
`Llívia`/`café`/`Peñón...`'s hashes moved when hashed directly) — but on the three actual golden
corpora, the probe showed zero hash movement, for a structural reason confirmed, not assumed:
v6/173 contain zero diacritic-bearing text and spanish takes the untouched non-English branch.
The column is a real, working guard with nothing in the current fixtures for it to catch yet.

**Adding the hash column broke an unrelated regression guard by fixed-offset assumption, and the
fix generalizes past this one column.** `scripts/phase4-step-w-k13-repro.test.ts` (the K13
lock-preservation guard) read `startTime`/`duration` by counting backward from the end of each
CSV row, on the documented assumption that the last four fields never change. Appending
`tokenHash` shifted that offset by one and made the reader silently swap `duration` into
`startTime`, surfacing as a real, bisection-confirmed test failure (`900.0000000000003 < 1`).
`loadBaselineSegments()` was rewritten to parse the header row and look up columns by name
through a quote-aware splitter, fixed in the same commit per `CLAUDE.md`'s own rule for a
hardcoded-path fixture consumer — a fresh sweep for any other column-position-dependent reader
across the fixture group found none.

**T3.2 opened with a scope correction: English was never missing a cardinal table on the matcher
side, only on the FA side.** The premise "English lacks a cardinal table" conflated two
independent modules — `textNormalize.ts`'s `canonicalize()` (matcher) has always had a
language-blind `digitTokenToWords` that emits English words for every language's digits;
`faTextNormalize.ts`/`fa/text.rs` (FA) genuinely has zero cardinal-table coverage for English and
a 0-30 cap for es/fr/de (0-20+30 for pt). Session ws2-33's real-corpus measurement found the two
sides can never agree on a digit-bearing token's string, in any language, by design (different
consumers, deliberately not shared) — fixing one closes nothing for the other. Given real-corpus
content (`"2024"`/`"1198"`/`"300"`-shaped values) is the FA side's live, production-path gap (via
the Rust port, not the TS mirror — see below) and doesn't trigger the standing sign-off gate the
matcher-side fix would, the operator scoped T3.2 to **Option 2: FA side only**. The matcher-side
gap (`digitTokenToWords` never gated by `languageCode`) was recorded as deferred, not fixed —
`docs/work-in-progress.md` §5.

**A blocking pre-check found the FA path strictly one-to-one at every layer, before any code was
written.** Session ws2-34 traced normalization (`FaWordResult.mapped`: one string, never
candidates) through tokenization (one flat `Vec<i64>`), alignment (`forced_align`'s Viterbi DP
sized to exactly one fixed `targets` sequence, no lattice/beam/OR-node), and merge (assumes the
one sequence that was aligned) — the pipeline's own only failure-handling path (`TooManyRepeats`
→ whole-chunk placeholder) confirms rather than mitigates this: even it doesn't retry with an
alternate reading, it surrenders the chunk. A same-session pre-check (also ws2-34) found the wall
was broader than the existing 21-99/multi-word documentation implied: **any composed reading
whose joiner is a space is structurally unrepresentable**, because no language's CTC vocab
contains a literal space character — this affects "300"/"2024"/"1198" in 4 of 5 languages even
under a fully correct unbounded generator, unless the tokenizer itself is extended to carry
multiple `WordSpan`s per source word.

**The multi-word tokenizer extension shipped as its own, behavior-neutral capability, gated
behind a proven straddle invariant.** Session ws2-35's precheck proved a chunk boundary can never
fall between two fragments of the same source word — not by a runtime guard, but as an
architectural sequencing fact: chunk boundaries are fully decided in TypeScript over whole,
unsplit raw tokens (`faChunkPlan.ts`'s `attributeByIndex`) before the resulting chunks ever cross
into Rust, and FA-side expansion only ever sees one already-finished chunk's text at a time with
no memory of how its boundaries were chosen. This is what makes the fragment-collapse
(first-fragment-start to last-fragment-end) always have a coherent single-chunk span to
reassemble; it's enforced going forward by a locked test (`faChunkPlan.test.ts`'s
chunk-boundary-independent-of-FA-normalization assertion), named explicitly in
`collapse_word_fragments`'s own doc comment as the thing this proof depends on staying green.
Commit `e7377db` landed `tokenize_normalized_words`/`collapse_word_fragments` in `fa_onnx.rs`,
confirmed behavior-neutral (every gate byte-identical, including the real-ONNX suites) because no
`mapped` string contained whitespace before this step.

**The year-reading policy was measured off the matcher's own live behavior, then mirrored into
FA's data — including a quirk the matcher wasn't designed to have.** Session ws2-35 ran the
matcher's `digitTokenToWords` across the full 1100-2999 range and found it is NOT a single
convention: 1100-1999 splits into "pair" (90%, e.g. 1998 → "nineteen ninety-eight") and
"cardinal" (the 10% whose last two digits are <10, i.e. every xx00-xx09 year — e.g. 1900 → "one
thousand nine hundred", not "nineteen hundred"), while 2000-2009 is 100% cardinal and 2010-2099
is 100% pair — a deterministic, exact function of `n % 100 >= 10`, not an inconsistency, but not
a single blanket reading either. The operator ruled to mirror this exact conditional into FA's
`yearReading.selectionPolicy` for en/de (the two languages with a real two-candidate choice),
rather than pick a single constant that would silently disagree with the matcher on part of the
range. `fa-cardinal-en.json`/`fa-cardinal-de.json` carry the policy as a `{name, threshold,
atOrAboveThreshold, belowThreshold}` object with a `matcherParityNote` stating explicitly that
the x00-x09 cardinal fallback is a known matcher quirk being deliberately mirrored, not
independently corrected, and that the two sides must not diverge if the matcher's own threshold
is ever revisited.

**The compositional generator itself (`a2754bb`) replaced all four capped 0-30 tables with a
shared, unbounded, data-driven implementation in both `faTextNormalize.ts` and `fa/text.rs`,
reading the `fa-cardinal-<lang>.json` files — and found two real, independent bugs in the Step 2
data during implementation, both the same class of apocope/count-word irregularity already
established by the existing German-million precedent.** German `hundred`/`thousand` were missing
`countWordOverride: "ein"` (would have composed "einshundert" instead of "einhundert"); Spanish
`million` was missing `countWordOverride: "un"` (would have composed "uno millón" instead of the
correct apocopated "un millón"). Both were caught and fixed before the commit landed, verified
against a live run of the generator before and after. `es/fr/de/pt/en` fixture regeneration (124
entries) passed the hard-gate Rust parity test on the first attempt post-fix.

**The standing inference that a wrong number reading only costs local mis-timing was traced end
to end and found false as a categorical claim — then measured for how much real exposure that
creates.** `forced_align` requires `T ≥ L+R` (frame budget ≥ target-sequence length + adjacent-
repeat count) for the WHOLE chunk's text, and `align_chunked`'s only failure-handling path
replaces the ENTIRE chunk's words with evenly-spaced placeholder timing on violation — there is
no per-word fallback. So a wrong reading that pushes a chunk's own margin negative doesn't stay
local; it can flatten every word in that chunk. Session ws2-36 measured this against all three
corpora's real, currently-shipped production chunk plans, deriving frame counts from the real
ONNX model graph's conv-layer kernel/stride values (not assumed) and cross-checked once against
real ONNX inference on 173 (zero `TooManyRepeats` signature at production margins, matching the
derived numbers exactly). Result: **no real chunk is infeasible today**, but margins are not
uniformly wide — 173's worst real chunk sits at margin 9 (chunk 84), and a plausible English year
misread (picking "compound" where "pair" is correct) costs `delta(L+R) = +16`, enough to flip 2
of 173's 118 chunks (both already the corpus's only near-miss chunks) from feasible to
whole-chunk placeholder timing. v6 (280 chunks) and spanish (5 chunks) have zero exposure at this
delta. No corpus currently contains a year-shaped token, so this is unreachable today — recorded
as a deferred exposure with an explicit revisit trigger (`docs/work-in-progress.md` §5), not
fixed.

**The durability pass (`7901c27`) added cargo-side isolation guards, encoded the French
cent-pluralization gap and the CTC margin finding as fixture-level data, and documented that
`faTextNormalize.ts`'s generator has no production caller.** The isolation test
(`cardinal_generator_uses_each_languages_own_data_no_cross_contamination`) guards a different,
still-live property than the four obsolete gating tests below: that each language's dispatch
(`cardinal_json_for`) actually pairs with THAT language's own `fa-cardinal-<lang>.json`, not a
cross-wired one — a mutation this test catches that the pre-existing non-emptiness check does
not. The French "cent"-before-a-numeral-scale-word pluralization gap (`composeHundred` has no
signal for whether its result is about to feed a further NUMERAL scale word like "mille" vs. a
NOUN scale word like "million", so it pluralizes unconditionally and produces "deux cents mille"
for 200000 where correct French is "deux cent mille") and the CTC margin finding above were both
encoded as fixture-level data (a `knownLossy` entry on `fa-cardinal-fr.json`'s `hundred` config;
a note alongside `fa-cardinal-en.json`'s `yearReading` policy) — previously recorded only in this
workstream's own scratch session artifacts under `.work-phase4/`. Neither behavior changed. The
commit also documents explicitly, in `faTextNormalize.ts`'s own header, that **the TS generator
has no production caller today** — `computeFaChunkPlan*`'s `languageCode`/`vocabChars`/
`cardinalData` gate is never fully supplied by any current call site — and exists as the parity
reference `fa/text.rs` is hand-ported against and proven byte-identical to via the fixture-parity
gate, not as a shipping code path itself. The live production path is entirely the Rust side,
via `fa_onnx.rs`.

**`cargo test`'s count moved from 242 (after the multi-word tokenizer capability, `e7377db`) to
210 (after the generator, `a2754bb`) to 211 (after the durability pass, `7901c27`), and every one
of the 32 tests dropped between the first two points is accounted for, not lost.** All 32 lived
in `fa/text.rs`'s old per-language capped-table blocks (English never had this style of test — it
had no cardinal rule to test before this step). 23 positive-value assertions survive verbatim
inside the new table-driven `<language>_cardinal_generator` tests; 8 negative "stays dropped for
decimal/leading-zero" tests consolidated into 1 cross-language test that is a strict superset
(adds English, which had none before); 6 negative "past the old scope cap" tests were
deliberately inverted — the same value, now re-asserted with the new, correct, representable
outcome, since removing the cap was the literal point of this step; and 4 "expansion is
language-gated" tests (which used English as the unaffected control) are genuinely retired with
no survivor, for a structural reason: this same step gave English its own cardinal generator, so
there is no language left in the current five-language set that can serve as an "unaffected"
witness for that property. The durability pass's own new cross-language isolation test (above) is
a different guard entirely — reading a fixture from your own dispatch arm, not gating expansion
by language — not a restoration of these four.

**Gate state at close of Phase 3** (final state at `7901c27`, per the operator's stated baseline,
not re-measured here): `npx vitest run` 2845 passed / 77 skipped / 0 failed; `gaplessInvariant.
test.ts` 36/36; golden replay 6/6; K13 3/3; `cargo test --features fa-inference` 211 passed / 0
failed / 26 ignored. `docs/history.md` untouched throughout this workstream.

---

## WS2 T4.1 Step 0a — the WS1 §4 retire-gate, settled by measurement to a one-row gate (2026-09-02, branch ws2-t41-app-settings)

**Diagnostic only. No source changed.** Full artifact:
`.work-phase4/session-ws2-38/step0a-retire-gate-report.md`.

**The gate does not open, and the reason is data absence rather than a disproven fold.** The five
WS1 §4 rows come from the WS2 Step 15 03:57:28 Windows operator run, and that project was never
committed. Swept, not assumed: `livia`/`gomera`/`velez`/`peñón`/`penon`/`vélez` across 3,245
`*.json`/`*.csv`/`*.txt`/`*.log` files spanning the whole tree minus `node_modules`, the two
Python venvs, `.git` and `spike-runtime` — including the extracted operator projects under
`.work-phase4/forensics-20260819-033211/` and `.work-phase4/session-w/live/projects/`. Zero hits
(sole match: a `uroman` ISO-639-3 language list). `scripts/fixtures/` and
`docs/ws1-sync-pipeline/measurements/` contain none of them either — no inspector CSV, no golden
fixture, no oracle. Neither branch of the operator's instruction was therefore reachable: there is
no Whisper output for these words in reach to call convergent or divergent. Disposition is
`NOT DETERMINED — data absent`, not `NOT DETERMINED — analysis inconclusive`.

**The finding that changes how the gate is read: two of the three rows cannot test the fold at
all.** Script-side tokenization post-`69d7cfc` is `52 → ["llivia"]` (1 token,
`requiredRunLength` 1), `69 → ["llivia","stayed","spanish"]` (3 tokens, threshold 1), and
`79 → ["penon","de","velez","de","la","gomera"]` (6 tokens, threshold 2). Run through the real
production `extractSegmentAlignments` under two arms — arm A spelling the diacritic word on the
transcript side exactly as the script does, arm B making it match nothing while every other word
is spelled identically (a stand-in for any divergent spelling, requiring no invented ASR output):

| row | arm A (fold converges) | arm B (diacritic word matches nothing) | discriminating? |
|---|---|---|---|
| 52 | 1/1, conf 1.00, run 1, `matched: true` | 0/1, conf 0.00, run 0, **`matched: false`** | **YES** |
| 69 | 3/3, conf 1.00, run 3, `matched: true` | 2/3, conf 0.67, run 2, `matched: true` | NO |
| 79 | 6/6, conf 1.00, run 6, `matched: true` | 4/6, conf 0.67, run 3, `matched: true` | NO |

The operator's stated suspicion about row 79 is confirmed exactly: it syncs on `de`/`de`/`la`/
`gomera` with `penon` and `velez` matching nothing at all. Row 69 is *weaker* evidence after the
fix than before it — pre-fix it was 4 tokens (`ll`,`via`,`stayed`,`spanish`) needing a run of 2;
post-fix it is 3 tokens needing a run of **1**, so a single matched word carries it. Row 52 is
decisive for the same reason it was skipped originally: with one token and nothing else to survive
on, its confidence is a direct readout of whether `llivia` matched.

**Retire-gate, restated:** retire WS1 §4 only on an operator pull of `project.transcriptTokens`
showing **row 52 at 1/1, confidence 1.00**. Rows 69/79 reporting `matched: true` is not evidence
and must not be counted as any; if consulted, only their per-token detail is informative.

**Both existing proofs of the fold are symmetric fixtures, and that is the whole of what they
measure.** `69d7cfc`'s T3.1 measurement ran "each row's exact quoted text" — the *script* text —
through `canonicalize()`, deriving both sides of the comparison from the script. The regression
lock in `whisperService.languageThread.test.ts` has the same shape, authoring `tok('más')` against
`seg('más')`. Each is a correct test of the fold and structurally incapable of detecting ASR
divergence, because the divergence is what the fixture authors away. Generalized into
`CLAUDE.md` §4 Testing this session as the fixture-reach rule (destructive probe, not green run).

**Also recorded this session, docs-only:** the `digitTokenToWords` deferred entry reframed
(T3.2 closed the English half of a two-sided divergence and left es/fr/pt/de diverging in a *new*
way — the two sides now fail differently rather than uniformly, so the failure signature depends
on which arm you read; deferring stays correct, "T3.2 is done" overstates it); and ruling C3
queued for re-examination on the ground that the shared surface acquired a *policy* rather than
merely growing — a conformance fixture over a threshold rule tests agreement, not correctness, and
both arms can satisfy it while both are wrong, the propagated x00-x09 quirk being the standing
example.

## WS2 status narrative displaced from the tracker (2026-09-02, branch ws2-t41-app-settings)

`docs/work-in-progress.md` crossed its own 300-line cap (315), so its remedy was applied: WS2's
multi-paragraph `Status:` block was cut to the single line the five-section structure contract
calls for, and the displaced prose is preserved here VERBATIM. Nothing was reworded or dropped;
no deferred entry was touched. This is the Phase 1/2/3 close-out narrative that stood at the top
of the WS2 section immediately before Phase 4 began — its constituent records live in this file's
own `WS2 T1.x`, `WS2 T2.1/T2.2`, and `WS2 T3.1/T3.2` sections above, of which this was the
running summary.

Tracker line after the cut:
`Started: 2026-08-26 (Step 3) | Status: active — all 4 numbered bugs and Phases 1-3 closed; Phase 4 (Settings & project creation) in progress.`

Displaced text, exactly as it stood:

> Started: 2026-08-26 (Step 3) | Status: all 4 numbered bugs closed (1/2/4 code-fixed and now
> runtime-verified on real Windows hardware; 3 closed did-not-reproduce, no code fix). A
> sync-pipeline defect surfaced by WS2 Step 15's Windows operator log (non-ASCII matching) was
> relocated to WS1 §4 — see that section. macOS CI-artifact/arm64 FA
> platform verification and MSVC redistributable are both closed (OPERATOR-ATTESTED); the
> autosave-quota bug is fixed (T1.3, OPERATOR-ATTESTED live `tauri:dev` verification, see
> `docs/history-2.md`). Phase 1 (project data durability & foundations) is fully closed —
> T1.1/T1.2/T1.3 all done. Phase 2 closed at a MUCH SMALLER scope than originally planned: T2.1
> pivoted from its original never-drop design through a full gap-absorption restore UI
> (automatic + a Forced Restore human override) to, finally, visibility-only reporting — the
> restore UI produced inaccurate micro-durations in silent gaps that needed manual correction
> anyway, so the operator had it removed entirely (session ws2-26, round 1 of 2,
> `docs/history-2.md`'s ws2-t21 entry). T2.2 (the operator-override persistence layer the restore
> UI needed) is closed as not-building — there is nothing left for it to persist. Recovering a
> dropped scene is now fully manual: jump to it via the sync log's "Jump to absorbing scene" link,
> then split (`S`) the absorbing clip and retype. Two real bugs surfaced by that same removal pass
> (sync-log host-numbering off-by-one, split-then-delete text loss) are fixed and
> operator-verified (`docs/history-2.md`'s ws2-t21 round-2 record). Phase 3 (Text and number
> normalization, T3.1+T3.2) is now closed — canonical-form matching (T3.1: language-threaded
> matcher, NFD diacritic fold, tokenHash identity column, es/fr/de/pt conformance fixture) and a
> compositional FA-side cardinal-number generator (T3.2, TS+Rust atomic) both landed on
> `ws2-t31-language-thread`, sessions ws2-28 through ws2-36; full record in `docs/history-2.md`.
> Phase 4 (Settings & project creation) is now in progress.

## WS2 T4.1 (D4) — the overlay cascade that fired on an untouched control (2026-09-03, branch ws2-t41-app-settings)

Found by the Step 0 settings-inventory sweep (`.work-phase4/session-ws2-39/step0-settings-inventory.md`),
not by a bug report — nothing in either target settings list mentioned it.

**Defect.** `ProjectSettingsModal.handleSave` called `onSetAllOverlay(draftOverlayOn)`
unconditionally. That callback is a CASCADE: `App.tsx`'s `handleSetAllOverlay` (`:2287`) maps
*every* segment to the value it is handed. The draft seeded from
`segments.every(s => s.showOverlay)`, which is `false` on any project whose per-segment overlay
state is MIXED. So on a mixed project, opening the modal to change the resolution tier and
pressing Save silently turned every segment's overlay off — from a control the user never
touched, with no undo entry naming it.

**Why the seed cannot be re-written safely.** `every()` is a lossy summary of an N-valued fact:
it cannot round-trip a mixed project, so writing its own seed back is never a no-op there. This
is the same shape the codebase had already diagnosed and fixed once, for the retired global FA
key (`faGate.ts:44-56` — an unconditional write from a shared Save carries no recoverable
intent), and the fix is the same shape: capture the opening value once and gate on
`draft !== initial`, mirroring `shouldPersistFaChoice`.

**Reach, measured by destructive probe, not by a green run** (CLAUDE.md §4 Testing). The
assertion is on the segment array — `onSetAllOverlay` is wired to a reducer with the same body
as `App.tsx:2287` — because a spy-only assertion would pass a refactor that still calls the
callback with a matching value. Three probes, each reddening exactly the intended subset of 7:

| Probe | Mutation | Result |
|---|---|---|
| P1 | gate removed (the verbatim pre-fix line) | 4 red / 3 green — the three greens are the two genuine-change cases and Cancel, which the gate does not govern |
| P2 | gate hard-muted (`if (false)`) | 2 red — both genuine-change cases; the "writes nothing" cases stay green, so the suite distinguishes a gate from a mute |
| P3 | `initialOverlayOn` aliased to the live draft instead of a captured seed | 2 red — same two, confirming the seed's capture-once semantics are load-bearing and not incidental |

**Files.** `src/components/ProjectSettingsModal.tsx`,
`src/components/ProjectSettingsModal.overlayIntent.test.tsx` (new, 7 tests).
Gates: tsc/lint clean; vitest 2868 passed / 77 skipped / 0 failed (2861 + 7); gaplessInvariant
36/36; golden replay 6/6; K13 3/3. Nothing in `src-tauri/` moved.

## WS2 T4.1 (D6/D3) — the toggle that named half of what it does, and the default that had no name (2026-09-03, branch ws2-t41-app-settings)

Both found by the Step 0 settings-inventory sweep.

**D6 — "Export Engine" was measurably wrong, not merely narrow.** `PreviewStage.tsx:399`
computes `glPathActive = useWebCodecsPath && webgl2Supported`, so `webcodecsExportEnabled` also
selects the WebGL2 **preview** renderer (`useGlPreview.ts`). Turning the toggle off changes what
the user sees while editing, not just how the file is encoded — a control whose label names one
of its two consumers is a control the user cannot reason about. Renamed to **Rendering Engine**
in App Settings, with copy stating it governs both; the internal constant became
`WEBCODECS_TOGGLE_KEY`. **The storage key string is deliberately unchanged**
(`webcodecsExportEnabled`): it is already written into every existing profile's `kinetix:ui:v1`,
and a migration across real user state for a tidier string is the same trade `faGate.ts`'s
`LEGACY_GLOBAL_FA_TOGGLE_KEY` declined. A key is a storage address, not a description.

**D3 — the same class of default as `FA_PROJECT_DEFAULT_ON`, with no name and no guard.**
`isWebCodecsExportToggleOn()` resolved an absent preference with a bare `true`, written twice in
one function (the `??` arm and the `catch` arm) with a third statement of the value in the doc
comment above it. Three copies, none named, none answerable to each other — the exact shape that
let `types.ts`'s FA comment sit wrong for two sessions with nothing failing. Now
`WEBCODECS_TOGGLE_DEFAULT_ON`, pinned by `src/hooks/webcodecsDefaultDrift.test.ts` (a deliberate
sibling copy of `faDefaultDrift.test.ts`, not a generalisation of it — two guards pin different
constants with different prose forms, and a shared abstraction would need re-probing every time a
third default appears).

**The guard's own first draft was broken, and the probe is what caught it.** Probe P3 — flip the
constant, leave the prose behind, i.e. the literal FA failure the pattern exists to catch — came
back **GREEN**. Cause: the same edit that introduced the named constant had reworded the doc
comment out of `DEFAULTS_PROSE`'s reach, so the prose arm was scanning **zero** occurrences and
could not fail. A prose guard with no prose to scan passes forever and is indistinguishable from
one that works. Fixed on both sides: the doc comment carries the canonical machine-checkable
phrasing, and a floor assertion fails if that phrasing ever disappears. Final probe results:

| Probe | Mutation | Result |
|---|---|---|
| P1 | `??` arm reverted to a bare literal (the verbatim pre-fix code) | red |
| P2 | only the `catch` arm reverted (the arm a casual edit forgets) | red |
| P3 | constant flipped, prose left behind | red (green before the reach fix) |
| P4 | prose reworded out of the regex's reach | red (the reach gap itself) |

**D1/D2 excluded, with the criterion recorded.** CLAUDE.md §5 now carries the live-feedback rule:
a control belongs on a settings surface only when it has **no live visual feedback at its point of
use**. Style/look presets are a machine-global *content library* previewed in the Effects tab; the
five per-project global effects fields render into the preview the instant they change. Both stay
where they are. Recorded so the boundary is not re-argued in Phase 5.

**Displaced from `docs/work-in-progress.md` to pay for the new deferred entry (300-line cap):**
the `digitTokenToWords` item's post-T3.2 reframing narrative, preserved here in full. Before T3.2
both arms were wrong in the same direction — FA and the matcher each emitted the English reading —
so the divergence was uniform and one fix would have closed it. After T3.2 the FA side emits
`veintitrés` for Spanish while the matcher still emits `twenty three`, because `digitTokenToWords`
is not language-gated. The two sides now fail DIFFERENTLY, so the observed failure signature
depends on which arm you read, and a diagnosis that reads only one will mis-attribute it. English
is genuinely closed; es/fr/pt/de are not, and that wrongness ships today. Deferring remains correct
(zero non-English digit corpora, so a fix cannot be measured against real content), but "T3.2 is
done" overstates it: only the English half is. The C3 re-examination entry was compressed at the
same time; its full argument was already in this file's Step 0a section.

**Files.** `src/hooks/useExport.ts`, `src/hooks/webcodecsDefaultDrift.test.ts` (new, 10 tests),
`src/components/AppSettingsModal.tsx`, `CLAUDE.md`, `docs/work-in-progress.md`.

## WS2 T4.1 Step 1 — the App Settings surface: dashboard gear, three flat blocks, inline models (2026-09-03, branch ws2-t41-app-settings)

**Entry point.** A gear in the dashboard header, and nothing else. It has to live there rather
than in the editor because App Settings is machine-global: the state in which a user most needs
it is a fresh install with no project to open, where an editor-only entry point can never be
reached. `AppSettingsModal` therefore moved out of `mainContent`'s editor branch into App's outer
fragment, beside `NewProjectModal` — the same hoist, for the same reason, as Step 2b's.

**Three blocks, one flat scrolling surface, hairline dividers, no nested modal.** Block 1
Rendering Engine (renamed by D6). Block 2 Models & Add-ons rendered INLINE. Block 3 New Project
Defaults.

**The Models extraction.** `ManageModelsModal`'s body became `src/components/ModelsSection.tsx`;
the modal kept only its chrome (dialog role, focus trap, Escape, Done) and now renders the section.
The behaviour is not a rendering detail — it owns an `InstalledModelsReport` refresh cycle, a
per-row state machine, two cancellable download channels, and the Step 13 Phase 1 status-probe
failure banner — so a parallel implementation would have drifted on the first one-sided bug fix.
Filtering for Step 3 is a PROP (`faLanguages`, `includeWhisper`), not a fork, so the filtered
surface is the same code path with a shorter list. The chrome survives because the two REMEDIATION
links (TranscriptionBar, SyncLogPanel) must still open a models UI directly from inside a failing
flow. Evidence the extraction is behaviour-preserving: `ManageModelsModal.test.tsx`'s 15 existing
tests pass unchanged against it.

**Project Settings has no models entry point of any kind** — the deep-link button and its
`onOpenAppSettings` prop are gone. A project-scoped surface offering a door into machine-global
model management re-creates exactly the confusion the T4.1 split exists to remove.

**The base text colour, fixed at the root.** `#root` now declares `color: var(--kx-text-base)`
(`#E4E3E0`, the editor root's own former literal), and `App.tsx`'s `text-[#E4E3E0]` was removed in
the same commit so there is one source of truth rather than two. Measured in the running app, not
inferred — computed `color` on the New Project modal, before and after:

| Element | Before | After |
|---|---|---|
| `<h2>New Project</h2>` | `rgb(0,0,0)` on `#111` | `rgb(228,227,224)` |
| name `<input>` | `rgb(48,48,48)` on `#1A1A1A` | `rgb(228,227,224)` |
| resolution `<select>` | `rgb(48,48,48)` on `#1A1A1A` | `rgb(228,227,224)` |

Form controls are covered by the root declaration because Tailwind's preflight sets
`color: inherit` on `button, input, select, optgroup, textarea` (verified in
`node_modules/tailwindcss/preflight.css`), which is why no per-element patch was needed. One
measurement note worth keeping: an in-page probe that set `#root { color: initial }` reported the
form controls as still light, and an HMR-only CSS swap reported them as still black — both
disagreed with a full reload. The before/after table above is from full page loads only.

**Reach, by destructive probe** (CLAUDE.md §4 Testing) — 6 probes over the 10 new tests in
`src/App.appSettings.test.tsx`:

| Probe | Mutation | Result |
|---|---|---|
| P1 | App Settings rendered back inside the editor branch | 7 red — every test that needs it over the dashboard |
| P2 | dashboard gear removed | 8 red |
| P3 | block 2 reverted to a link instead of the inline section | 2 red (inline-ness, pack list) |
| P4 | App Settings deep link restored in Project Settings | 2 red |
| P5 | the immediate-side-effect copy removed from block 2 | 1 red |
| P6 | hairline dividers replaced with per-block cards | 1 red |

**Deviation from the stated step split, reported rather than made silently.** Block 3's persisted
store (`src/services/appDefaults.ts`) landed in THIS commit rather than in Step 2. Step 1 was asked
to render all three blocks; a block whose Save silently discards everything the user typed is a
defect, and shipping one for the length of a commit is worse than moving ~90 lines of store
forward. Step 2 keeps the rest of its scope: the New Project modal's pre-fill, its language
dropdown and FA toggle, and the Save/Cancel unification.

**Files.** `src/components/ModelsSection.tsx` (new), `src/components/ManageModelsModal.tsx`
(reduced to chrome), `src/components/AppSettingsModal.tsx` (rewritten),
`src/components/ProjectSettingsModal.tsx`, `src/components/ProjectDashboard.tsx`,
`src/services/appDefaults.ts` (new), `src/App.tsx`, `src/index.css`,
`src/App.appSettings.test.tsx` (new, 10 tests), `src/App.projectSwitch.test.tsx` (the S/D App
Settings case rewritten to the gear route, the deep link it used being gone).
Gates: tsc/lint clean; vitest 2888 passed / 77 skipped / 0 failed; gaplessInvariant 36/36; golden
replay 6/6; K13 3/3. Nothing in `src-tauri/` moved.

## WS2 T4.1 Step 2 — New Project Defaults wired, and Save/Cancel unified (2026-09-03, branch ws2-t41-app-settings)

**The New Project modal now has five fields, every one pre-filled from App Settings' block 3.**
Language and a High-Precision Auto-Sync toggle are new. Defaults are read ONCE, lazily, at mount:
an App Settings edit must not reach into a New Project dialog already on screen.

**Two of the five write conditionally, and the condition is the point.**

- *Language.* `AUTO_DETECT` writes NOTHING — a project created under it carries no `language` key
  at all. `resolveFaLanguage` is `language ?? detectedLanguage` and `useWhisper.ts` writes a
  detection only into an EMPTY `language`, so any stored code (`'en'` included) shadows detection
  permanently: a Spanish voiceover would resolve FA to English forever.
- *FA.* Written only when it diverges from `FA_PROJECT_DEFAULT_ON`, through the same
  `shouldPersistFaChoice` Project Settings uses. **Seeing a control at creation and leaving it
  alone is not a choice** — persisting an untouched default would convert "no preference" into an
  explicit one and put the project permanently out of reach of a future default flip.

**`Project.defaultTextOverlay` — a new optional field, and the reasoning for it.** Block 3's
text-overlay default had no consumer: `parseProjectData` hardcoded `showOverlay: false`. Reading
the machine-global default there instead would have been wrong, because `parseProjectData` runs on
every Apply Sync for any project — a preference changed today would silently re-style a project
created months ago on its next re-sync, the same "a global reaches backward into existing work"
failure that made the old per-machine FA toggle unshippable (WS1 Session F, F6). So the choice is
seeded onto the project at creation and read from there. `parseProjectData` gained an OPTIONAL 6th
parameter defaulting to `false`, so every existing caller — golden replay and `syncTiming.test.ts`
included — is byte-identical to before it existed (measured: golden replay 6/6 unchanged).

**Save/Cancel unification is a REFACTOR, not a defect fix, and the record says so.** The Step 0
sweep asked whether Export Engine, the FA toggle or language wrote on interaction. Read against
source, all three already held draft state and wrote only inside `handleSave` — Cancel was not
lying. What was missing was anything asserting it, which is exactly how the one genuine defect in
that family (D4's overlay cascade, `da2d255`) sat next to them unnoticed.
`settingsCommitSemantics.test.tsx` now states the rule once for both surfaces: a control's value
reaches storage only through that surface's Save; interaction, Cancel and Escape write nothing.
Block 2's model install/delete is the stated exemption (owner ruling) and is deliberately not
covered there.

**Text visibility: already fixed, at the root, in Step 1** — see that entry's before/after table.
No per-element patch was applied, and none is needed.

**Reach, by destructive probe** — 6 probes over the 23 new tests:

| Probe | Mutation | Result |
|---|---|---|
| P1 | Auto-detect seeds `'en'` onto the project | 2 red |
| P2 | FA written unconditionally at creation | 2 red |
| P3 | modal ignores the stored defaults (hardcoded seeds) | 3 red |
| P4 | App Settings' renderer toggle writes on interaction | 3 red |
| P5 | App Settings' defaults dropdown writes on interaction | 2 red |
| P6 | Project Settings' Cancel routed to `handleSave` | 1 red |

**Files.** `src/components/NewProjectModal.tsx` (rewritten), `src/App.tsx`, `src/types.ts`,
`src/App.newProjectDefaults.test.tsx` (new, 13 tests),
`src/components/settingsCommitSemantics.test.tsx` (new, 10 tests).
Gates: tsc/lint clean; vitest 2911 passed / 77 skipped / 0 failed; gaplessInvariant 36/36; golden
replay 6/6; K13 3/3. Nothing in `src-tauri/` moved.

## WS2 T4.1 Step 3 — the per-project FA pack detector, and the capability-probe verdict (2026-09-03, branch ws2-t41-app-settings)

**Capability verdict: no new probe was needed, and no `not_implemented` round-trip either.** The
concern was correct — `isFaCapable()` (`faGate.ts:96`) is `isTauri()` and nothing more, so in a
plain `tauri:dev`/`tauri:build` binary it returns `true` while `fa_align` returns `NotImplemented`
for every run (`src-tauri/src/fa.rs`'s `#[cfg(not(feature = "fa-inference"))]` arm). A detector
built on it would report an installed pack as usable in the exact binary that ships today. But
`fa_preflight` already exists (`src-tauri/src/fa_preflight.rs`, registered `lib.rs:165`, TS wrapper
`src/services/faPreflight.ts`, already invoked at `App.tsx:3195`) and returns `featureCompiled`
straight from a `#[cfg(feature = "fa-inference")]` — the build fact reported **directly**, not
inferred from a failed alignment. It is cheap by construction (path stat + dlopen/ort env init;
explicitly no 1.2 GiB hash) because it was designed to run before every FA sync. Step 3 therefore
stayed **one commit** and needed no Rust change: `probeFaReadiness(language)` is a thin wrapper
calling the same command with an explicit language.

**Five states, not two.** The two that a naive detector collapses:

- **Auto-detect** renders neither indicator and no download prompt, and probes nothing at all. The
  project stores no language and the pack it will need is chosen by Whisper on the first
  transcription — "missing" would be false (nothing is missing) and "installed" would be false too
  (nothing was checked). It states the condition and what would resolve it.
- **`featureCompiled: false`** renders a warning and **no install affordance**, and short-circuits
  before consulting disk. The pack's presence is irrelevant: this build returns `not_implemented`
  for every alignment no matter what is on disk. Offering a 1.2 GiB download there would promise
  precision the binary cannot deliver.

The other three are `unsupported` (outside the five packs), `unavailable` (no desktop runtime, or
the probe was rejected — status unknown, stated as unknown), and the ordinary `installed`/`missing`.
Check order is build → runtime → disk, the order the real run fails in. A **failed** disk check
degrades to `unavailable`, never to `missing`: that conflation is the WS2 Step 13 Phase 1 defect in
a new place.

Pack presence reads from `checkInstalledModels`, the same source the Models section renders from,
so the detector and the list it links to can never disagree about what is on disk.

**The install affordance is `ModelsSection` filtered to one language** (`faLanguages={[lang]}`,
`includeWhisper={false}`) — the same component, the same download engine, the same progress and
completion refresh as App Settings' block 2, because it is that code path with a shorter list.

**Reach, by destructive probe** — and one probe found a real gap rather than confirming coverage:

| Probe | Mutation | Result |
|---|---|---|
| P1 | `featureCompiled` ignored (the `isFaCapable`-only detector) | 2 red |
| P2 | Auto-detect rendered as `missing` with a download prompt | 2 red |
| P3 | installer not filtered (full pack list) | 1 red |
| P4 | a failed disk check reported as `missing` | 1 red |
| P5 | stale-probe guard removed | 1 red |
| P6 | detector rebound from `draftLanguage` to the SAVED `language` | **GREEN — a real gap** |

P6 is the useful one. Every other test drives `FaPackStatus` directly and therefore cannot see
which value the modal hands it, so nothing guarded "live as the dropdown changes rather than on
Save" — the property the step was specified around. A 13th test now renders `ProjectSettingsModal`
itself, changes the dropdown, and asserts the detector follows without any Save; P6 reddens it.

**Narrowed, with the reason recorded:** Step 1's "Project Settings mentions no models" assertion
was a word blocklist (`/models|add-ons|download/i`). Step 3 adds, by instruction, a targeted
single-pack affordance, so the guarded property is not "the word never appears" but "no general
models MANAGEMENT surface is reachable from here" — now asserted structurally (no `models-section`,
no whisper row, no models dialog) instead of by wording.

**Files.** `src/components/FaPackStatus.tsx` (new), `src/services/faPreflight.ts`,
`src/components/ProjectSettingsModal.tsx`, `src/components/FaPackStatus.test.tsx` (new, 13 tests),
`src/App.appSettings.test.tsx` (one assertion narrowed).
Gates: tsc/lint clean; vitest 2924 passed / 77 skipped / 0 failed; gaplessInvariant 36/36; golden
replay 6/6; K13 3/3. Nothing in `src-tauri/` moved.

---

## 2026-09-03 — WS2 Phase 4 close-out (T4.1 / T4.2), and the four false-greens

Closes WS2. Phase 4 was "Settings & project creation": give the machine-global settings a named
home, stop Project Settings from editing machine state behind a project-scoped title, and make the
FA model requirement visible before a sync needs it. What follows is the record of what shipped and,
more usefully, of what the suite failed to see.

### The four-site view-flip fix

The gear had to raise App Settings from the dashboard with no project loaded, which meant the modal
could not live inside `App.tsx`'s editor branch. Four call sites flipped the view before raising a
modal; each one individually looked correct and the set of them was the defect — a modal raised from
the dashboard would flip into an editor with no project. Fixed by moving the render into the outer
fragment and adding `showAppSettingsModal` to `shortcutsSuppressedRef`, so the surface is reachable
over an empty install and bare-key shortcuts do not fire behind it.

### The settings re-partition, and the criterion that made it decidable

Project Settings had accumulated two machine-global controls wearing a project-scoped title: the
WebCodecs toggle (a `localStorage` key) and the models link (`app_local_data_dir/models`). Both moved
to App Settings — one flat scrolling surface, three blocks (Export Engine, Models & Add-ons rendered
INLINE rather than behind a nested dialog, New Project Defaults), hairlines rather than cards.

The Step 0 inventory sweep is what made the split decidable rather than a matter of taste. It found
every persisted value in the app and forced a per-value ruling, which produced CLAUDE.md §5's
**live-feedback criterion**: a control belongs on a settings surface when it has no live visual
feedback at its point of use. Two groups were excluded by it and must not be re-litigated without
overturning the criterion — style/look presets (`kinetix:stylePresets:v1`, `kinetix:lookPresets:v1`),
a machine-global *content library* authored in the Effects tab, and the five per-project global
effects fields, which render into the preview the instant they change. The criterion is about the
control's feedback, not its storage scope: a machine-global persisted value is not automatically a
setting.

### D4 — the changed-intent gate

The global overlay cascade fired on every Save, overwriting per-segment overlay choices whenever the
modal was opened and closed without touching them. Gated on changed intent: the cascade runs only
when the global field's value actually differs from what was loaded.

### The base-colour fix

Grade base colours were restated in more than one place; the restatements were dropped so the value
has one home. Landed with the two repo-operation rules below.

### The `fa_preflight`-backed detector

The per-language FA pack detector reports from a real Rust-side pre-flight rather than from a disk
guess, and — the part worth keeping — in a **non-FA build it says the build cannot run high-precision
sync** instead of offering a pack that would not help. That honesty is why T4.1 could close while the
backend wiring is still pending: the UI does not advertise a capability the binary lacks.

### The four false-greens, and what each one taught

Every one of these was a suite that was green and blind at the same time. They are the substance of
this phase.

**1. D3 — the WebCodecs default, three unnamed copies.** `isWebCodecsExportToggleOn()` resolved an
absent preference with a bare `true` written twice inside one function, with a third statement of it
in the doc comment. Three copies, none answerable to each other — the exact shape that let a wrong FA
comment stand for two sessions. Fixed by naming it `WEBCODECS_TOGGLE_DEFAULT_ON` and pinning all
three with `webcodecsDefaultDrift.test.ts`.

**2. That guard's own first draft was itself a false-green.** Probe P3 — flip the constant, leave the
prose behind, the literal failure the pattern exists to catch — came back GREEN, because the same
edit that introduced the constant had rewritten the doc comment out of the prose regex's reach. *A
prose guard with no prose to scan passes forever and is indistinguishable from one that works.* Fixed
on both sides, and the floor assertion that fails on an empty sweep is now standard in this family of
guards.

**3. D6 — a rationale written from a line number.** D6 recorded that the WebCodecs toggle had a
second consumer, citing `PreviewStage.tsx:399`'s
`glPathActive = useWebCodecsPath && webgl2Supported`, and three prose surfaces were rewritten to
match, including a block rename to "Rendering Engine". The claim was false:
`PreviewStage.tsx:380` binds its `useWebCodecsPath` from `isWebCodecsPreviewSupported()`, a
`'VideoDecoder' in window` capability probe that never reads `kinetix:ui:v1`. The two files share a
**local variable name** and nothing else. Corrected in C4 (below).

**4. Step 3's detector tests, P6.** Twelve of thirteen probes against the new `FaPackStatus` drove
the component directly and therefore could not see which value the modal handed it — nothing guarded
the property the step was specified around ("live as the dropdown changes, not on Save"). Only the
13th test, which renders `ProjectSettingsModal` itself, reddens under P6.

The through-line is CLAUDE.md §4's probe rule, earned four separate times in one phase: **a passing
gate is compatible with two indistinguishable worlds — the change is safe, or the gate cannot see
it.** Green never separates them.

### C4 — correct the copy, do not invent the wiring

The disposition of D6. Two options were live: wire the preview to the toggle so the shipped sentence
becomes true, or correct the sentence. **Ruling: correct the copy.** The Canvas2D/CSS preview path
was DELETED at the WebGL2 cutover rather than gated, so wiring the preview to a user-facing toggle
would ship a switch that disables the only preview renderer that exists — promoting a copy error into
a way to break the editor.

Block 1's title reverts to **Export Engine** (it was renamed solely on the false finding and has no
independent justification); the label and aria strings say "encoder"; the body says only that the
toggle chooses the export encoder and that the preview is unaffected. `useExport.ts`'s gate header
carries the measurement, including that D6's rationale was written from a line number and a same-named
identifier rather than from the value flowing through it.

The guard that was missing is `src/hooks/webcodecsToggleConsumers.test.ts`: the set of non-test source
files whose **code** (comments stripped — prose about the toggle is exactly what a file may carry)
reaches the persisted toggle must be exactly `useExport.ts`, `AppSettingsModal.tsx`, and the dev-only
`src/dev` spike harness, plus a direct assertion that `PreviewStage.tsx` does not reference it.
Destructive probe: adding `isWebCodecsExportToggleOn()` to `PreviewStage.tsx`'s path selection turned
the new guard RED on 2 of 5 assertions and named the path, while the full pre-existing suite under the
same mutation returned **2924 passed / 77 skipped / 0 failed — baseline exactly, entirely blind.**

### The two repo-operation rules

Both landed in CLAUDE.md §4 with the same standing as the probe rule, because both are about not
trusting an operation that *looks* like it succeeded.

**Stage named paths only** — never `git add -A` / `.` / `-u`. This repo carries standing untracked,
deliberately out-of-scope directories (`public/` since Phase 3); a wildcard stage sweeps them in
silently, the commit looks correct because the diff is only inspected for the intended files, and the
stray path is found later. Worked instance: `public/ws2-23-seed.json`, committed that way and
untracked in Step 4. Care at the keyboard cannot make a wildcard safe in a repo shaped like this —
the fix is the mechanism, not the vigilance.

**Never redirect into an existing file with `>`** — read it, write the replacement to a temp path,
`mv` it into place. A shell redirect truncates before the writer runs, so a mistake destroys the
original with no undo and no git history when the path is gitignored. Worked instance:
`.claude/launch.json`, overwritten this way and recovered only because its content happened to still
be in the session's context. Recovery-by-luck is not a property of the process.

### Row 52 and the non-ASCII cluster, closed

The five-row cluster from the WS2 Step 15 Windows run is settled. Rows 69 and 79 closed on `69d7cfc`'s
NFD fold, with 69 the row that verifies it. Rows **8** ("The complexity originates in 1198") and
**102** ("300 American residents.") closed by measurement and never needed a code change: their
numeral tokenization converges under every plausible transcript spelling
(`.work-phase4/session-ws2-30/phase3-t31-step1-report.md` §5), and T4.1 Step 0a had already narrowed
the retire-gate away from them to row 52 alone. The standing "segments 8 and 102 remain mine"
reservation that had been carried in operator prompts is retired permanently with this entry.

Row **52** ("Llívia") is deferred as an **ASR engine limitation**, not a pipeline defect: Whisper did
not transcribe the isolated token at all, so there was never a token for the confidence gate to match
against, and no normalization change can reach it. Owner ruling: do not patch. Revisit only on an
ASR/G2P change.

### The fa-inference blocker, reclassified

The `[DEFERRED · BLOCKS T4.1 CLOSE]` entry was deleted from WS2 rather than carried: it was never a
Phase 4 item. The FA **user interface is complete** — toggle, per-language detector, inline installer,
and honest copy in a non-FA build. What is pending is **backend wiring**: `fa-inference` is a
non-default Cargo feature, so `tauri:build` compiles the fallback arm and FA runs return
`not_implemented`. Making it default-on — and T3.2's cardinal generator becoming production-reachable
as a consequence of that flip — belongs to WS1, gated behind the same Stage 1 preconditions as
`FA_PROJECT_DEFAULT_ON`. The FA project toggle's shipped default **stays OFF** (owner, A3), which is
the honest state of a non-FA production build.

### Verification and disposition

All 45 rows of `docs/ws2-t41-phase4-manual-checklist.md` passed under operator observation, which
makes groups G3 and G4 operator-observed and closes the replica-inheritance gap. `launch.json` is
permanently **NOT DETERMINED** and is not to be pursued again. The `fa-inference` build measurement
was cancelled by the operator; `src-tauri/` did not move this phase.

`docs/work-in-progress.md`: 298 lines before, 267 after (cap 300). WS2 is CLOSED; WS1 is the active
workstream.

Gates on every commit and on `main` after merge: tsc clean, lint clean, vitest 2929 passed / 77
skipped / 0 failed, gaplessInvariant 36/36, golden replay 6/6, K13 3/3.

---

## WS2 T4.2 — backlog hygiene on the closed workstream, plus the bare-key fix (2026-09-03)

Branch off `main` @ `261562b`. Artifacts: `.work-phase4/session-ws2-41/`.

### Step 1 — six deletion premises, verified before deleting

Six §5 entries were proposed for deletion. Each rested on a premise nobody had checked. Verdicts:

**DELETED — 3.**

1. **Presets / global-effects exclusion.** Premise held completely. `CLAUDE.md:202` states the
   live-feedback criterion and `:204` names BOTH excluded groups verbatim — the two storage keys
   (`kinetix:stylePresets:v1`, `kinetix:lookPresets:v1`) and all five global effects fields — plus
   the "do not re-litigate without overturning the criterion" clause. The ledger entry was a strict
   subset of the durable manual, so deleting it deletes nothing.
2. **Cold-start switch outlier.** No measurement artifact contradicts the noise reading.
   `.work-phase4/session-ws2-38/step2a-sweep-and-load-measurement.md` §2.3 shows one cold r0
   (V6: 1051 ms `loadProjectDetailed`, 1177 ms total) against warm 44-160 ms, with the other three
   projects' r0 warm; §5 records it as not isolated to a cause. One wording correction: the
   artifact says "seen once per session", slightly stronger than the entry's "one observed
   project-open" — not enough to change the verdict, since neither establishes a class.
3. **`getMediaDuration` back-compat backfill.** Artifact §2.3 is explicit: "No video asset in any
   project is missing `Asset.duration`, so the back-compat probe leg cost **zero** everywhere."
   The open question (cost on a legacy project) is unmeasurable — §5 records that no such project
   exists on this machine. Correct as written; nothing to track.

**NOT DELETED — 3.**

4. **E8 / FA pack `unsupported`.** Two findings, both against the entry. Its claim that "whether it
   renders is untested" is **wrong** — `FaPackStatus.test.tsx:156` renders the branch with `'ja'`.
   Its load-bearing claim, that `SUPPORTED_LANGUAGES` is exactly the five FA packs, was guarded by
   **nothing**: `models.ts:21` derives `FA_MODEL_LANGUAGES` as `SUPPORTED_LANGUAGE_CODES`
   intersected with a hardcoded five-code literal, and `models.rs:182` hardcodes the same five a
   third time, tied only by a comment. Adding a sixth language compiled clean, passed every test,
   and made the branch reachable from the dropdown on the same commit — with the Rust side
   rejecting the `fa-<lang>` id, so the inline installer would offer a download the backend
   refuses. Cheap guard added (`faPackLanguageParity.test.ts`, `a6e7529`), reach established
   destructively: adding `it` to `SUPPORTED_LANGUAGES` turns 2 of 3 red
   (`.work-phase4/session-ws2-41/step1-e8-probe.txt`); `constants.ts` restored byte-identical.
   Entry kept and corrected.
5. **S/D timeline focus.** A **distinct leak**, not subsumed by Step 2. Step 2 answers "does a
   modal own the keyboard" (`shortcutsSuppressedRef`); this asks "does the TIMELINE own it", and
   needs no modal open at all — a click anywhere outside a text field leaves S/D live. The blocker
   is unchanged and structural: no tabIndex/role on clips or the scroll container (removed in
   `299f014`) and `Timeline.tsx:433-446`'s `onMouseDownCapture` `preventDefault()` actively
   suppressing the native focus-shift. Kept.
6. **CTC margin exposure.** Not deleted — relocated (below).

### CTC margin relocation

Moved from WS2 §5 onto WS1 §2's "Make forced alignment reachable in a shipped build" bullet, so
whoever flips `fa-inference` reads it at the flip rather than finding it after. Numbers and trigger
carried intact and verified after the move: per-CHUNK `TooManyRepeats` fallback; misread-year
`delta(L+R) = +16`; 173's worst real margin **9** (chunk 84); **2 of 403** real chunks across all
three corpora, both in 173; trigger = any corpus with a year-shaped (4-digit, in-range) numeral.

### Step 2 — the bare-key shortcut leak (`e071149`)

T4.1 fixed only S and D (destructive) and said in-code that the rest of the chain still leaked. It
did. Space, `+`/`-`, arrows and `F` were guarded by `isTextEntryElement(document.activeElement)`
alone — which asks what has FOCUS, not whether a modal owns the keyboard — so with any of the eight
suppressing surfaces up and focus on a non-text element (a toggle button, which those modals are
full of) every one still fired behind the dialog.

Extracted to `services/bareKeyShortcut.ts`, a pure sibling of `undoShortcut.ts`/`appShortcuts.ts`,
reading the same `shortcutsSuppressedRef`. Behaviour otherwise carried across unchanged, including
the inline chain's asymmetric modifier handling — a leak fix must not quietly become a rebinding.
The stale in-code SCOPE note on the S/D block was corrected in the same commit.

**Per-key probe (the point of the step).** One `it` per key, and each probed by reverting the guard
for that key ALONE. 6/6 probes failed exactly their own key's test and left the other five green —
no test covers for another. Full transcript: `.work-phase4/session-ws2-41/step2-perkey-probe.txt`.

| probe | own test | other five |
|---|---|---|
| Space | × | ✓✓✓✓✓ |
| `+` | × | ✓✓✓✓✓ |
| `-` | × | ✓✓✓✓✓ |
| ArrowRight | × | ✓✓✓✓✓ |
| ArrowLeft | × | ✓✓✓✓✓ |
| `F` | × | ✓✓✓✓✓ |

(The one deliberately broad assertion also fails on every probe, as designed.)

### Step 3 — orphaned asset blobs: diagnosis only, and it is an ACTIVE write bug

Full report: `.work-phase4/session-ws2-41/step3-duplicate-asset-blobs.md`. Headlines:

- **Not duplicates.** `assets-v2`'s key is compound `['projectId','id']` (`assetStore.ts:47`) and
  `put` replaces, so the same pair cannot occupy two rows. 798 rows = 798 DISTINCT ids under one
  project, ~399 of them orphans. A de-duplicator would find nothing to collapse.
- **Ongoing, not historical.** `App.tsx:4677` writes the blob to IndexedDB; `App.tsx:4696`'s "final
  dedup (catches concurrent adds)" then drops by name and never calls `deleteAsset`. The
  compensation for one race leaks a blob every time it fires. The race is structural — all file
  promises run concurrently off one `assetsRef.current` snapshot, so two archive entries with the
  same basename both pass the `4670` pre-check. Filed as its own `[OPEN]` item per operator ruling
  A1, not patched here.
- **NOT DETERMINED:** whether this produced V8's specific 798/399. Needs the live app and that
  IndexedDB. A full re-stage by the user also yields 2× (per `CLAUDE.md`'s "every file-stage event
  mints a fresh `Asset` id"), and that is a user action, not a bug. Repro recipe is in the report.
- **The naive `id-not-in-project.assets` rule is disqualified.** Eight asset-id holders enumerated;
  the fatal one is `historyPersist.ts:170`, which stores whole `Project` snapshots — an undo state
  legitimately references assets the current `project.assets` does not, so deleting their blobs
  turns a working undo into silent data loss. Also unsafe: `lastTranscribedAssetId`
  (`types.ts:349`), the staged-voiceover window (`App.tsx:351`→`3019`), and the second asset-id
  keyed store `waveformStore.ts:114`. Report-only classifier and its four go/no-go conditions are
  specified in §§4-5 of the report.

### Step 4 — consolidation

**Frame-rate merge REFUSED, on evidence.** Both halves of the shared-cause claim are individually
true — the preview cap is a frame COUNT (`videoDecoderPool.ts:107`, `MAX_BUFFERED_FRAMES_PER_SESSION
= 90`, with `MAX_TOTAL_BUFFERED_FRAMES = 150` at `:130`), and a single project frame rate IS assumed
(`ExportFps = 24 | 30 | 60`, `useExport.ts:27`, applied per-run at `:190`/`:490`, with
`Asset.nativeFps` "used only to auto-suggest exportFps", `types.ts:134-136`). But two true facts are
not one cause. `bug3-diagnosis.md:124` and `:199-200` locate the 120fps defect in the preview pool
never reading the SOURCE ASSET's rate, and `:212` records export as unaffected; the arbitrary-frame-
rate item is an export/project-model question. Different subsystems, neither fix advancing the
other. Kept as two entries — a shared label over two unshared causes is the false-green pattern this
phase was cleaning up.

**Non-English four merged into one entry**, sharing the fr/de/pt corpus prerequisite as their
parent, with each retained as a named sub-item carrying its own file:line and its own distinct fix:
(a) `digitTokenToWords` language gating, (b) fr/pt/de elision, (c) French `composeHundred`
pluralization (which keeps its own independent trigger), (d) the corpus gap itself.

**Where WS2's deferred entries live.** The structure contract rules on closed ITEMS (drop from the
section, fold into the workstream `Status:` line plus `docs/history-2.md`) but is **silent on a
closed workstream's still-OPEN ones**. Nothing was moved: the single-tracker rule puts task state in
`docs/work-in-progress.md` under its own workstream section or nowhere, and relocating open defects
into an append-only archive would make them unfindable as work. Recorded on the WS2 `Status:` line.

### Counts

WS2 §5 deferred entries: **15 before → 8 after.** 3 deleted (content in `CLAUDE.md:202-204` and the
Step 2a measurement artifact), 1 closed by the Step 2 fix, 1 relocated to WS1, 4 merged into 1, 1
new entry filed (the active write bug). `docs/work-in-progress.md`: **267 lines before → 275 after**
(cap 300) — the file grows slightly because entries gained file:line evidence and refuted claims
gained their refutations, which is the point of the pass.

Gates on every commit: tsc clean, lint clean, vitest 2954 passed / 77 skipped / 0 failed (2929
baseline + 22 bare-key + 3 parity), gaplessInvariant 36/36, golden replay 6/6, K13 3/3. `src-tauri/`
untouched throughout, so `cargo test` was not required.

---

## WS2 T4.3 — model download transfer resilience (2026-09-03)

Operator report: deleting the French FA pack and redownloading it failed on completion with
`download interrupted: error decoding response body (partial download kept at
.../fa-models/fr/model.onnx.part for resume)`.

**Step 1 (diagnosis) refuted the brief's own hypothesis on three independent grounds**, all
measured:
1. `delete_installed_model` already purged the `.part` — corroborated by the operator's own
   `fa-models/fr/` directory mtime (Sep 3 15:43), i.e. the directory had been removed and recreated.
2. The retained partial was a byte-exact prefix: 1_071_567_076 of 1_262_619_311 (84.87 %), with
   local-vs-server `cmp` MATCHing at offsets 0, 123_456_789, 536_870_912, 800_000_000, 999_999_999
   and the 1 KiB before its own tail — 5 of 5. The server answered `Range: bytes=1071566076-` with
   206 and a correct `Content-Range`, and sent no `Content-Encoding`.
3. The error string was the transport-stage message, not the verification-stage one; verification
   never ran.

So the partial was recoverable the whole time and "for resume" was true. `error decoding response
body` is reqwest 0.12's `Kind::Decode` Display — not a decompression failure, since
`cargo tree -e features -i reqwest@0.12.28` shows no `gzip`/`brotli`/`deflate`/`zstd`. The real
defect was the absence of retry, plus `{e}` discarding the `source()` chain. **This was a transfer
bug, not a recovery bug.** Manifest checksums were already present and enforced
(`fa-onnx-manifest.json`, `sha256` + `byteSize` per language, `fa_dev.rs:40`), so none was invented.

**Step 2 (fix, one commit).** Bounded retry (3 attempts, 1s/2s exponential backoff) resuming from
the partial's new length each time; conditional resume gated on a new `<target>.part.meta` sidecar
(URL, expected size, `X-Linked-ETag`/`ETag`/`Last-Modified`) plus a 206 `Content-Range`
start-and-total check, any disagreement discarding rather than splicing; the 416 permanent-stick
discharged (discard once, restart from zero, second 416 permanent); `cause_chain` walking `source()`;
three distinct message forms, none of which promises a resume that cannot work; `fa_model_status`
sharing `status_for_target` with `whisper_model_status`; and a UI that offers "Resume <bytes>" and a
"Reconnecting… (attempt N of 3)" line. Delete gained the `.part.meta` purge — the round's only
delete-path change, and only because the round introduced the file.

**Two probe findings, both fixed.** (a) The sidecar test was a FALSE GREEN: it asserted connection
COUNT, and a successful resume and a successful fresh fetch are both one connection, so it stayed
green with its own guard reverted. It now records and asserts the `Range` header of every request.
(b) `plan_resume` carried an unreachable duplicate sidecar check, so reverting either copy alone left
the other standing and neither could be shown load-bearing; the redundancy was removed.

**Whisper** shares the engine and was verified by destructive probe rather than call-graph inference:
breaking the retry classifier, the shared status helper, or the resume-416 restart each turns a
whisper-filename test red.

**Also fixed, unrelated to the report:** the download percentage used `Math.round`, displaying "100%"
from 99.5 % onward while up to ~6.3 MiB was still missing. Now floored. It does NOT explain the
operator's perception of completion at 84.87 %, which remains **unreproduced**.

Gates: tsc clean, lint clean, vitest 2954 → 2960 passed / 77 skipped / 0 failed, cargo 129 → 153
(default) and 211 → 235 (`--features fa-inference`), 0 failed both, gaplessInvariant 36/36, golden
replay 6/6, K13 3/3. Full record: `.work-phase4/session-ws2-42/` (gitignored, local).

---

## WS2 T4.4–T4.8 — model download arc closed (2026-09-04)

Phase 4 (Settings & project creation) closed with T4.1 and T4.2 on 2026-09-03. The download
resilience arc T4.3 through T4.8 closed the same workstream on 2026-09-04 at merge `bc3a156`.

**Root finding (T4.8 retrospective):** every round was a different symptom of one redundant
**second read** of the just-downloaded file, competing with macOS Spotlight indexing on the same
bytes, until the read was deleted and the existing cached verify digest was reused for the `.sha256`
sidecar write (`finalize_verified_download`, `model_download.rs`).

| Round | Symptom class | Mechanism fixed or surfaced |
|---|---|---|
| **T4.3** (`946223e`) | Transfer interrupted mid-stream | No retry; resume sidecar + honest errors — prerequisite, not the root read |
| **T4.4** (`f9ed1b6`) | Silent stalls, duplicate writers | Two concurrent writers on one `.part` with no single-flight guard (`IN_FLIGHT`, `try_acquire_in_flight`) |
| **T4.5** (`74f8faf`) | Installed FA rows offer "Resume \<full size\>" | `status_for_target` reported a **completed** target's own on-disk bytes as `partial_bytes` |
| **T4.6** (`aa797f6`) | Reload leaves download invisible; all rows "Checking…" | Tauri does **not** cancel a spawned command future on webview reload — the event `Channel` belonged to the dead page until `EventSink.replace` + `*_download_attach` re-attached a fresh page to the live native job |
| **T4.7** (`1787c29`) | Operator scenarios untested | Added cancel-then-resume, sibling-pack isolation, reload-reattach coverage — sibling test found that asserting **only settled DOM** passes with the T4.6 "all rows Checking" bug reintroduced |
| **T4.8** (`08caf5f`) | Post-download verify hangs (de pack) | Deleted the redundant post-download re-hash; verify returns the digest and the sidecar writer reuses it — no second `hash_file` on the finished ONNX |

T4.7 shipped tests only; T4.8 shipped no TS changes. Full-suite vitest at `bc3a156` (3059 total) is
green only sometimes under CPU load — not a single reconciled number. Measured flake profiles (both
timeout-budget failures under contention, not logic failures): **2980 / 2 / 77** (session-ws2-06 at
`bc3a156`) and **2979 / 3 / 77** (back-to-back load at `a8e22c1`, pre-timeout-fix). Green profile
when uncontended: **2982 / 77 / 0**.

**Operator-verified closed (2026-09-04):** the `de` FA pack's missing sidecar — operator verified
in the real app post-T4.8, symptom closed; no separate de-only root-cause trace was performed, and
the symptom matches the redundant-read class removed by T4.8.

---

## WS2-45 — Phase 4 manual checklist retired (2026-09-04)

`docs/ws2-t41-phase4-manual-checklist.md` was written at T4.1 Step 5 as a one-time Phase 4
observability runbook. Every actionable row carries a **RESOLVED** annotation or lives under §Z as
NOT OBSERVABLE — the checklist did its job and is not a standing repeated procedure (contrast
`docs/wkwebview-drag-checklist.md`, which stays tracked because drag regressions are re-run every
release).

**Decision:** fold outcomes into this file and **untrack** the checklist. Keeping a tracked doc
full of spent RESOLVED rows would imply live work remains; the durable record belongs here and in
the T4.1/T4.2 close-out entry above. Key outcomes preserved:

- **C4 / Z1:** Export Engine toggle governs export encoder only — preview deliberately unwired;
  `webcodecsToggleConsumers.test.ts` pins the consumer set.
- **D4 / F-rows:** Overlay cascade gates on changed intent, not modal open alone.
- **E2 / Z6:** Default `tauri:dev` build reports `unbuilt` — no pack download offer when FA cannot run.
- **A6 / Z4:** Bare-key leak (Space, arrows, `F`) closed in T4.2; S/D timeline-focus scope stays deferred in §5.
- **E8:** `unsupported` FA-pack state still deferred — dropdown built from five supported codes only.

Full row text retrievable: `git show bc3a156:docs/ws2-t41-phase4-manual-checklist.md`.

---

## WS2-50 — Apply Sync entry point + staged-slot persistence (2026-09-05)

Branch `ws2-50-staged-slot-persistence`, three commits off `eb10bef`.

**The operator-reported defect.** After a reload, the recovery banner's Apply Sync failed with
the empty-scene-doc abort even with all four slots re-populated, while the main bottom Apply
Sync button worked on the same project in the same session. Cause: both buttons shared
`handleApplySyncFromFiles` but diverged on its INPUT. The panel passed its live staged files;
the banner passed a hand-written all-`null` `StagedFiles` literal, written on the reasoning
that a returning user has nothing staged and every staged field falls back to its committed
project value. The second half only holds once something has been committed — after a reload
of a project whose first Apply Sync never completed, `project.sceneDetails` is `''`. Predicted
verbatim in the WS2-47 report.

**Fix (`f9a99d0`).** Structural rather than "pass the right argument": `handleApplySyncFromFiles`
takes no staged argument and reads a shared `App`-level ref as its first synchronous statement,
so no call site retains the ability to invent an input. `DropZonePanel` publishes that ref from
`updateStaged` — the one choke point every staged mutation already passes through — and
republishes on mount, because the panel unmounts on the `showDashboard` ternary. `updateStaged`
now derives its next value from the ref rather than from `setState`'s `prev`; the previous form
assigned the ref inside the state updater, which React is free to defer.

Also closed the §5 misleading-message entry: `emptySceneDocAbortMessage` now takes the resolved
scene text and distinguishes "a real doc with no scene tags" (`EMPTY_SCENE_DOC_MESSAGE`) from
"no scene doc at all" (`NO_SCENE_DOC_MESSAGE`), which classifies `transcript_unrelated` like its
sibling.

**Storage design (`b2a415f`, `4d1e...` for slots 3-4).** A dedicated IndexedDB database
`kinetix-staged`, NOT a field on `Project`. Reasons in descending order of force: (1) undo would
resurrect it — `history.ts` snapshots the whole `Project`, so a staged slot there becomes
undoable and an undo past a file swap re-stages a file the user already replaced; (2) a `File`
cannot round-trip a `Project` snapshot, since `projectStore`/`historyPersist` both strip `blob:`
URLs and `File` handles by design; (3) payload multiplication. Separate from `kinetix-assets`
deliberately: WS2-49's orphan accounting there is "rows == `project.assets` references", and
staged rows are referenced by no such entry, so co-locating them would make every staged file
read as an orphan and destroy that measurement.

**Correction to a premise carried into this round.** The brief stated that "the pattern this repo
already settled for transcription drafts was a dedicated store rather than a field on Project."
That is inverted: `unappliedTranscript` IS a field on `Project` (`types.ts:556`), persisted with
the project JSON and present in history snapshots. The design above reaches the same destination
by different reasoning, and the accurate half of the premise — staged state stays distinct from
the committed fields, as `unappliedTranscript` is distinct from `transcriptTokens` — is honoured.

**Delete contract.** A pure set diff (`stagedFilesPersist.ts`) reconciled at `updateStaged`, so
persisted rows always equal currently-staged slots. Covers replace, clear, remove-one, Apply and
Discard without any of them remembering to call a delete, plus `deleteAllStagedForProject` on
project deletion. Avoids `processZipFile`'s shape: `next` is the decided membership and only keys
present in it are written, so no blob is written before its membership is decided. Singleton slots
address by kind (a replace overwrites in place); multi-file slots by React key.

**Raw bytes: required, all four slots.** `App.tsx:3285/3288` read `.text()`; `:3306` and
`:3333-3339` pass the `File` to `persistFileToAsset`; `:3340` unzips it; the duration probe does
`blob.arrayBuffer()`. Restoring references without bytes would satisfy the UI and break the
action. `lastModified` is preserved because `getFileIdentity` is `name|size|lastModified` and is
the transcription cache key.

**The voiceover hazard, and the gate built for it.** `handleVoiceoverStaged` has exactly one
non-destructive branch — the same-file-with-cached-tokens early return. Every other branch clears
`transcriptTokens` and launches whisper-cli, so restoring a voiceover unconditionally would start
an unrequested transcription ON APP LOAD and wipe the cache the recovery banner depends on, in
precisely the scenario this workstream exists to fix. `canAdoptRestoredVoiceover` is therefore the
same condition as that early return, extracted as a pure function; a refusal drops both the slot
and its row. **Named degradation:** a voiceover staged but never successfully transcribed does not
survive a reload — the user re-drops it, starting transcription on their action.

**Measurements.** Orphan row counts before/after identical across all 9 projects (1:1 everywhere
except FINAL TEST V8's diagnosed 2.0 write-off and two pre-existing anomalies already in §5).
Eager-write cost: zero IPC/base64 (structured clone only, guarded structurally); worst-case text
payload 58,023 B on the largest corpus. Full artefacts: `.work-phase4/session-ws2-50/`.

**NOT DETERMINED:** real WebKit IndexedDB write throughput — every timing figure here is either a
sequential read of the store's backing files or `fake-indexeddb` in memory. No live-app run was
performed this round; the orphan evidence is store-level row-count assertions plus an unchanged
disk snapshot, not an observed app session.

---

## WS2 docs restructure — items moved from work-in-progress (2026-09-05)

Restructured WS2 to the five-section contract at base `f28a012`. Current baselines at that SHA:
vitest 3121 passed / 77 skipped / 0 failed; cargo 182/0/1 default and 264/0/26 with
`--features fa-inference`; gaplessInvariant 36/36; golden replay 6/6; K13 3/3.

### Vitest timeout flakes (order-dependent, not a code defect)

Harness budgets raised: `faSeamFitGate.test.ts` `V6_TIMEOUT_MS = 120_000` at `:241` (was 5s
default); `scripts/ws1-session-aj0-oracle-diff.test.ts` `:98` raised to 180s. Flakes appeared
only under two parallel suites — not reproduced uncontended across three runs at `d9e2c24` and
three at `eb10bef`. Raises landed; cause not fixed. `scripts/ws1-session-s-exclusion.test.ts`
stays recorded as unconfirmed (named from session-ws2-06 at `bc3a156`, not reproduced under load
at `a8e22c1`). Historical flake profiles under contention (timeout budgets, not logic failures):
2980/2/77 at `bc3a156`, 2979/3/77 at `a8e22c1`.

### WebKit profile split (WS2-49)

Expected dev behaviour, not an end-user defect. The dev binary sets no `CFBundleIdentifier`, so
WebKit falls back to `~/Library/WebKit/app/` instead of the folder matching
`tauri.conf.json`'s bundle id — that bundle-id folder holds a stale profile with no V8
(IndexedDB) in it. Any IndexedDB measurement or cleanup must target the dev binary's actual
profile, not the bundle-id path config implies.

### Transcription Requirement 3 (merged at `eb10bef`)

Shipped `Project.unappliedTranscript { tokens, assetId, fileIdentity, completedAt }`. Staleness
via `name|size|lastModified` against `lastTranscribedFileIdentity`; banner on mount only;
Discard clears both stored field and staged whisper state. Soft spot: `assetId` is
diagnostics-only, so the banner could not rebind a file — WS2-50 addresses that.

### Lane C inventory correction

`unappliedTranscript` IS a `Project` field at `types.ts:556`, persisted with project JSON and
present in history snapshots. The dedicated-store recommendation applied to `transcriptionDraft`
only — not to `unappliedTranscript`.

### 798/399 IndexedDB orphan diagnosis (WS2-49)

399 orphan rows written 2026-08-25, byte-identical to the referenced batch of 2026-08-27;
mechanism was re-commit with fresh UUIDs after a quota failure logged in `projectStore.ts:71`.
Historical accident, not a live bug — all other projects measure 1:1. Normal UI project delete
DOES purge asset rows (`ProjectDashboard.tsx:133` calls `deleteAllAssets`;
`assetStore.ts:129-147`), so this is one-time cleanup, not an active leak. **NOT DETERMINED:**
whether the abort was `QuotaExceededError`, a crash, or a cancel.

### Zero-duration timeline — operator decision (2026-09-05)

Operator chose **abort with error** (explicit error/toast requiring a voiceover track) rather
than generating a 0-duration timeline or a character-timed fallback. **Implemented** in
`handleApplySyncFromFiles`: `NO_VOICEOVER_MESSAGE` aborts before `parseProjectData` when no
voiceover asset resolves; classified `transcript_unrelated` in `applySyncAbort.ts` so the banner
salvage path retains tokens and dismisses the banner.

### Section 1 verification close-out (2026-09-05)

Operator manually verified all three items; entries removed from `docs/work-in-progress.md`
section 1. Full staged-slot design: [WS2-50 section above](#ws2-50--apply-sync-entry-point--staged-slot-persistence-2026-09-05).

**Staged slot persistence** (f9a99d0 / b2a415f / 0f10575): dedicated `kinetix-staged`
IndexedDB, deliberately not a `Project` field — undo would resurrect staged slots and `File`
cannot round-trip a history snapshot. Pure set-diff delete contract reconciled at
`DropZonePanel`'s `updateStaged` choke point; `deleteAllStagedForProject` on project
deletion; `canAdoptRestoredVoiceover` gate; structured clone only, no IPC or base64. Row
counts identical before and after across all nine corpus projects.

**Banner Apply Sync parity** (f9a99d0): `handleApplySyncFromFiles` takes no argument and reads
`stagedFilesRef.current`; zero `StagedFiles` literals remain in `App.tsx`. `NO_SCENE_DOC_MESSAGE`
replaced the misleading "no scenes to sync" text and is classified `transcript_unrelated`.

**Banner staged-slot clear** (f28a012): the banner path called `handleApplySyncFromFiles`
directly and bypassed `DropZonePanel`'s `triggerSync`, the only place that cleared local staged
state, so slots stayed Pending after a successful banner sync. Fixed with a
`stagedFilesClearSignal` counter prop — bump at `App.tsx:4445`, consumed by the effect at
`DropZonePanel.tsx:717-722` (`updateStaged(() => EMPTY_STAGED)` at `:721`). Pushed to `main` on
partial gates (tsc plus five targeted files); retroactively fully green afterwards (tsc, lint,
vitest 3121/77/0, gaplessInvariant 36/36, golden replay 6/6, K13 3/3); required-prop
constructor sweep found only the two f28a012 sites plus one source-text regex test with no props
object.

---

## WS2 — closed-workstream open-items placement (2026-09-05)

**Where a closed workstream's still-open items belong.** Its entries stay here under the closed
workstream: the structure contract rules on closed ITEMS (fold into the workstream `Status:` line
plus `docs/history-2.md`) but is silent on a closed workstream's still-open ones, and the
single-tracker rule puts them in `docs/work-in-progress.md` under their own workstream section or
nowhere. Relocating open defects into an append-only archive would make them unfindable as work.

This question is now moot: WS2 is simply open as a general non-sync workstream with no finite scope
to close.

---

## WS2 — tooling tracking decision (2026-09-05)

**Measured sizes (this machine).** `.work-phase4/session-ws2-49/` = 44K on disk
(`measure_orphans.py` 24K, `idbkey.py` 4K, plus run output). `.work-phase4/replay/` = 85M on disk.

**Gitignore rule.** Both paths are excluded by `.gitignore:45` (`.work-phase4/` — single blanket rule).

**Test behaviour without replay fixtures (fresh worktree, no `.work-phase4/replay/`).**
- `scripts/phase4-handoff-replay-sync.test.ts` — **fails hard** (3/6): `requireInput` throws with
  `python3 scripts/phase4-restore-replay-inputs.py` in the message; not skipped, not silent pass.
- `scripts/phase4-fa-replay.test.ts` — passes (50/50): uses committed `scripts/fixtures/` only.
- ~35 other `scripts/*.test.ts` files reference `REPLAY_ROOT`; most throw or use `skipIf` when
  inputs are absent — golden replay is the named gate that fails without regeneration.

**Decision.**
- **Tracked:** `scripts/ws2-49-measurement/{measure_orphans.py,idbkey.py,README.md}` — small text
  files; audit numbers are unreproducible without them.
- **Not tracked:** `.work-phase4/replay/` (~85M). Reproduction gap recorded explicitly in
  `docs/work-in-progress.md` §3 (replay fixture reproduction gap entry).

---

## WS2 — FA Pack Detector E8 closed (2026-09-05)

**Verdict:** CLOSED — unreachable by construction, guarded against drift; no code change warranted.

The deferral in `FaPackStatus.tsx:81` remains correct: the Project Settings language dropdown is
built from `SUPPORTED_LANGUAGES`, and those five codes are exactly the five FA packs. What was
missing was a guard that notices when that premise stops holding — `faPackLanguageParity.test.ts`
(WST2 T4.2 Step 1) now provides it.

**Assertions (will fail on drift):**
- Set equality: `expect([...FA_MODEL_LANGUAGES].sort()).toEqual([...SUPPORTED_LANGUAGE_CODES].sort());`
- Per-code: `for (const code of SUPPORTED_LANGUAGE_CODES) { expect(FA_MODEL_LANGUAGES.includes(code), code).toBe(true); }`
- Rust mirror: `expect([...FA_MODEL_LANGUAGES].sort()).toEqual(['de', 'en', 'es', 'fr', 'pt']);`

Adding a sixth language to `constants.ts` turns 2 of 3 tests red (measured in session ws2-41).
Entry removed from `docs/work-in-progress.md` §4.

---

## WS2 — Timeline Clip Focus closed (2026-09-05)

S/D split/delete were global window shortcuts: any click outside a text field left them live
whenever a playhead or selection target existed (Preview, Effects, left panel). Fix:
`timelineShortcutsArmedRef` in `App.tsx` — set true on capture-phase `pointerdown` inside
`#timeline-scroll-area`, false elsewhere; both S and D require it. No tabIndex/focus redesign;
`Timeline.tsx:433` preventDefault unchanged. Guard: `timelineShortcutScope.test.ts`.

