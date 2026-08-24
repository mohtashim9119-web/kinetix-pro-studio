# History 2 — WS1 Session Archive

> **Purpose:** append-only companion to `docs/history.md`, opened 2026-08-25 for Docs Cleanup
> Round 1. Holds every completed/abandoned item moved out of `docs/work-in-progress.md`'s WS1
> section (Sessions A through AN, the ledger/measurement archive, and the Changelog) so that
> file could be cut down to only live work and standing constraints. Same rules as
> `docs/history.md`: never edited mid-workstream, only appended to; data preserved, narrative
> kept minimal. **Not a replacement for `docs/history.md`** — that file stays untouched and is
> still the primary archive; this one exists because splitting the WS1 dump into it directly
> was out of scope for this round. No line cap.

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
members (not 6/7). Tests: 86 files/2234 passed/1 skipped; golden replay 6/6.

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
remained provisional.

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
so `foldPhantomTails` defaults false. Built, measured, deliberately not shipped.

## Session AH — S1 rejected and rolled back — 2026-08-23

S1 rejected on 18/18 operator ear regressions and deleted outright from `faChunkPlan.ts` (not
just disabled) — committed boundaries verified byte-identical pre/post rollback. Ruling R-AS:
a detector's precision must be measured before its repair ships (S1's underlying signal was
~7% precision, should have blocked it). 173's long-standing chunk-plan discrepancy (126 vs.
119) retired as undetermined cause, re-captured at 119. Ruling R-AT: a no-ears word-gap-
containment validation proxy FAILS (negative separation margin) — any S2 validation needs real
ears, no shortcut works.

## Session AI — S2 built, not shipped — 2026-08-23

Built `computeFaChunkPlanS2`: eliminates the phantom-tail funnel condition to 0 on all 3
corpora, but causes severe alignment drift on v6 (up to -27.7s), regressing 36 ear-verified
controls (30 v6 + 6 173) — a hard fail vs. the ship gate. Not shipped, not deleted; the defect
is in FA quality on longer chunks, not in the planning logic itself.

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
one. v6 only.

## Session AM — chunk-edge placement identified as driver — 2026-08-24

Confirmed chunk-edge placement, not width, drives the drift arch: substituting three-source-
agreement anchors for estimate-derived chunk edges (arm F) cut oracle regressions 76%
(279→68) and killed the arch outright (peak 3.249s, under the ≤5.0s DIED band). A diagnostic
oracle-placed-edge arm (G) went further (0.042s, 2 regressions) as the ceiling. `231_slowing_
pace` traced end to end as direct mechanistic proof. Arm F itself failed the ship gate (2.86%
implied precision vs. 50% bar) — not shipped, but the S2 research line continued from here.

## Session AN — arm H widens the search, still not shippable — 2026-08-24

Widening the anchor search one sentence-group further at arm F's 5 unresolved fallback seams
(arm H) cut v6 oracle regressions a further 32% (68→46), shrank the arch 9× (3.249s→0.349s),
and landed all 3 previously-open v6 defects for the first time in the workstream. 173 also
improved (40→31 regressions vs. arm C) with no arch at all. Still far under the 50% ship-gate
precision (6.12%) — nothing shipped. **This is the last entry in the S2/chunk-edge research
line: as of the 2026-08-25 accuracy-bar decision recorded in `docs/work-in-progress.md`,
further chunk-width/chunk-edge research is frozen — current ~97–98% accuracy is accepted and
remaining errors go through manual review instead.**
