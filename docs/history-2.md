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
