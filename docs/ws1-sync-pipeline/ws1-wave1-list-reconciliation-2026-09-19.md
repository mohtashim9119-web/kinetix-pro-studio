# WS1 Wave 1 — list reconciliation, V1 test mapping, D24 re-verify, STATUS gap, whisper pin (pass 2, 2026-09-19)

Read-only, docs-only. **Zero code edits made. No remote operation performed. No deletes.**
This note plus its allowlist entry in `scripts/ws1-single-tracker.test.ts` are the only two
files touched. Corrects one premise from the prior pass's note
(`ws1-kickoff-verification-2026-09-19.md`) per this pass's explicit instruction: for **wave
contents**, the operator-signed `sync-pipeline-plan-v3.md` is the boss (`final-shape-mapping
-2026-09-18.md` §M7 is a one-day-earlier draft); `final-shape-mapping` stays the boss only for
**proving-test** detail.

## 1. Three-way Wave 1 list settlement

**plan-v3's Wave 1** (`sync-pipeline-plan-v3.md:44-67`, copied verbatim):

1. `fa_dev.rs` cache-clear race fix.
2. `whisper.rs` 16-entry terminal-buffer eviction race fix. (Both 1 and 2: verified via 20
   consecutive clean runs.)
3. Delete the `fallback` arm from `FaRunResult` — typed `paused` / `cancelled` outcome.
4. Restart-safe pause-and-ask dialog.
5. Cancel wired everywhere on the sync path, including `fa_cancel`.
6. Infeasible chunks surface as an estimated flag plus a grouped finding.
7. R.14 / R.15 log entries, plus the R-AP log entry.
8. Provenance stamp + `projectStore` v5 migration.
9. Atomic staged-audio write.
10. Whisper weight-integrity gate.
11. Partition invariant test (Model P gapless partition — operator-approved).

**Wave 2** (for context, short): engine resolver/picker + `faGate` retirement; Settings→Sync
per-pack savable; `computeRunContext` dedup + worker + measured Hirschberg bound; content-hash
spine; WPM warn-only check; local pre-FA coverage check; language/vocab normalization wired
end to end; ~180 dead lines stripped (`fa_align_dev`/`__faDevAlign`); six-group sync log UI;
build-flag unification; scene-anchor IDs + honest Apply Sync; content-addressed import; offline
contract; stale-doc sweep (§M3.10's ten sites).

**Wave 3** (for context, short): cloud gateway/CSP/Opus upload; one-job/two-cache-stage cloud
pipeline; mid-coverage abort cost allocation; retry-once-then-pause; zero-charge cancel; cloud
provenance; **English parity re-run** (explicitly labelled in the plan text as "per the Wave
1.10 cloud authorization" — see item 10 below); fr/de/pt native-audio validation; one-hour job
cap; cloud-becomes-default exit condition.

**The briefing's 11-item list matches plan-v3's Wave 1 exactly, item for item, same order,
same wording-in-substance.** No disagreement to lay out here — plan-v3 and the briefing agree.
The only list that disagrees with both is §M7's ten-item draft table, and per this pass's
tie-break instruction, §M7 does not get a vote on wave *placement*, only on proving-test
detail (§2 below).

### Mapping plan-v3 Wave 1 → §M7's ten-item draft

| plan-v3 Wave 1 # | §M7 draft # | §M7 wording | Verdict |
|---|---|---|---|
| 1 (fa_dev.rs race) | — | not in §M7 at all | **Not in §M7.** Source: `operator-product-rulings-2026-09-19.md:41-45` ("Both cache races must be fixed first, in Wave 1"), draft wording from `baseline-p1b-p3-2026-09-19.md`. |
| 2 (whisper.rs race) | — | not in §M7 at all | **Not in §M7.** Same source as #1. |
| 3 (delete fallback arm) | 1.3 | "Replace fail-clean-to-Whisper contract; typed failure kinds; remove `fallback` arm (§M3.1)" | Match — same item. |
| 4 (pause-and-ask dialog) | 1.1 | "Pause-and-ask dialog + paused run state (C5)" | Match. |
| 5 (cancel everywhere) | 1.2 | "Cancel control on the sync overlay; wire `fa_cancel` (§M3.5, C7/C8)" | Match. |
| 6 (infeasible→estimated flag) | 1.4 | "Per-chunk infeasibility count out of Rust; grouped finding; `degraded` on result (§M3.2)" | Match. |
| 7 (R.14/R.15 + R-AP) | 1.6 | "R.14/R.15 log entries + R-AP log entry (§M3.3)" | Match. |
| 8 (provenance + v5 migration) | 1.5 | "Provenance schema + atomic write + v4→v5 migration (§M3.4)" | Match — **but see note below: §M7 1.5's "atomic write" is the provenance-commit atomicity in §M3.4 (`App.tsx:4635`), not the staged-audio write (item 9).** |
| 9 (atomic staged-audio write) | — | not in §M7 at all | **Not in §M7.** Source: `baseline-p0-p2-2026-09-19.md:68`, row h ("Non-atomic staged-audio write / poison-cache hazard", `fa_dev.rs:544-545`). Distinct defect from §M3.4's provenance-commit atomicity — confirmed by reading §M3.4 in full (`final-shape-mapping-2026-09-18.md:388-452`): its "atomic" clause is entirely about writing the provenance stamp inside the same commit as `faWordTimings`, never mentions staged audio. |
| 10 (Whisper weight-integrity gate) | — | not in §M7 at all | **Not in §M7.** Source: `baseline-p0-p2-2026-09-19.md:69`, row i ("Whisper weight-integrity gap vs FA hash/size gate", `fa_dev.rs:284`+`:668` have it, `whisper.rs:590-625` doesn't). |
| 11 (partition invariant test) | — | not in §M7 at all | **Not in §M7.** Source: `operator-product-rulings-2026-09-19.md:39-40` ("The partition invariant test is approved... No further sign-off needed to rely on it in planning"). |

**§M7 items that dropped out of Wave 1 (moved elsewhere in plan-v3, not lost):**

- **§M7 1.7** — "Stale-claim corrections, ten sites (§M3.10)" → **Wave 2, item 14** ("Stale-doc
  sweep (the ten stale-claim sites named in the mapping's §M3.10)"). Confirmed by exact
  string match to §M3.10's site list.
- **§M7 1.8** — "Retire `fa_align_dev` + `__faDevAlign`; repoint `fa_durable_wav_live.rs`
  (§M3.8)" → **Wave 2, item 8** ("~180 dead lines stripped (`fa_align_dev`/`__faDevAlign`
  retired); `fa_dev.rs` renamed to reflect that it is production code, not a dev harness").
  **Direct answer to the question asked: fa_align_dev retirement is Wave 2 in plan-v3, not
  Wave 1.**
- **§M7 1.9** — "STATUS.md closures + NR-2 superseded note (§M3.13)" → **not present as a
  numbered item in any of plan-v3's three waves.** The NR-2-superseded half already happened
  outside the wave structure (confirmed live: `docs/STATUS.md:16`, "NR-2 ... SUPERSEDED
  2026-09-19"). The STATUS.md-closures half (§M3.13's proposed-closure table) has no wave
  home in plan-v3 at all — it reads as ongoing docs bookkeeping rather than a chartered wave
  item, but that's an inference, not something plan-v3 states. **Flagging, not resolving**:
  if the operator intended §M3.13's closure proposals to be actioned as part of some wave,
  plan-v3 doesn't say which one.
- **§M7 1.10** — "English parity re-run with per-chunk feasibility diagnostics (§M4.5)" →
  **Wave 3, item 7** ("English parity re-run (authorized spend, per the Wave 1.10 cloud
  authorization)"). Plan-v3's own text still calls it "Wave 1.10" in that parenthetical —
  a label leftover from the draft numbering — even though the item itself now lives in Wave
  3. Not a contradiction: the *authorization* traces back to the old 1.10 slot; the *work*
  is chartered for Wave 3.

**No disagreement to lay out per the task's fallback instruction** — plan-v3 (the signed
document) and the briefing list agree completely on Wave 1 contents; only the informal,
superseded §M7 draft disagrees, and per this pass's own tie-break rule that draft doesn't
get to arbitrate wave placement.

## 2. V1 — §M7's ten items mapped to proving tests (file:line, existing vs needs-writing)

| §M7 # | §M3.x | Proving test named in the mapping doc | Exists today? | Where |
|---|---|---|---|---|
| 1.1 (pause dialog) | — | No "Proving tests" line for C5/1.1 itself in `final-shape-mapping-2026-09-18.md` (the dialog is UI scaffolding; §M3.1's proving test below is the behavioral one that exercises it) | **Needs writing** — no `SyncPausedDialog` component or dialog test exists in `src/` today (grep for `SyncPausedDialog` returns zero hits) | New file, not yet created |
| 1.2 (cancel + `fa_cancel`) | §M3.5 | `fa_cancel has a production caller`; `a sync cancelled in any phase leaves no partial commit` (`final-shape-mapping-2026-09-18.md:474-475`) | **Needs writing** — `fa_cancel` has zero frontend callers today (confirmed again this pass: `grep -rn "invoke.*fa_cancel" src/` → 0 hits; `docs/STATUS.md:203` still lists it open) | Would live beside `forcedAlignmentRun.ts` / `App.tsx` cancel wiring, none exists yet |
| 1.3 (typed failure kinds, remove `fallback`) | §M3.1 | `no run-level FA failure reaches the atomic commit`, plus "structurally, a type-level proof: removing the `fallback` arm makes the old behaviour a compile error" (`:318-319`) | **Needs writing** — `FaRunResult` still has a `status: 'fallback'` arm today (`forcedAlignmentRun.ts:16-31` unchanged per this pass's re-read) | `forcedAlignmentRun.ts` test file, not yet split out |
| 1.4 (infeasible→estimated flag) | §M3.2 | `a run containing an infeasible chunk cannot report a clean status` — asserting `status === 'ok' && degraded === undefined` is impossible when Rust reports a non-zero infeasible count (`:359-363`) | **Fixture exists, assertion missing** — Rust-side repro against real corpus text already exists at `fa_onnx.rs:5486-5541` (unit-tests the fill at `:5554`,`:5590`,`:5611`); the doc says explicitly "only the assertion is missing" | Fixture: `fa_onnx.rs:5486-5541`. New assertion: not written |
| 1.5 (provenance + migration) | §M3.4 | `a v4 project loads, gains engine-unknown provenance, and saves as v5`; `no code path can write provenance with an inferred engine`; `every committed timing set carries provenance in the same commit` (`:450-452`) | **Needs writing** — `TimingProvenance`/`timingProvenance` do not exist in `types.ts` yet (grep confirms zero hits); `projectStore.ts` version is still capped below 5 | `projectStore.test.ts` or a new `timingProvenance.test.ts`, neither exists |
| 1.6 (R.14/R.15 + R-AP) | §M3.3 | `every boundary R.14/R.15 moves produces exactly one log entry naming the scene` (`:385-386`) | **Needs writing** — `syncLog.ts` has no `buildAnchorTrustLogEntries` today (grep: zero hits; the doc's own "Today" section confirms R.14/R.15 output is `console.warn`-only, not pushed to `ruleLogEntries`) | `syncLog.test.ts`, extend once the builder exists |
| 1.7 (stale-claim corrections) — **Wave 2, not Wave 1** | §M3.10 | No "Proving tests" line — this item is a documentation correction (ten stale-claim sites), not a behavioral change; nothing to test | N/A — docs-only item | — |
| 1.8 (retire `fa_align_dev`) — **Wave 2, not Wave 1** | §M3.8 | No named proving test; disposition is "retire the dev command + harness (~180 lines)... [and] repoint `fa_durable_wav_live.rs`" (`:566-573`). The implicit proving condition is that `src-tauri/tests/fa_durable_wav_live.rs` (currently calling `fa_align_dev` at `:45`,`:138`) compiles and passes after repointing to `resolve_wav_and_align` | **Existing test needs repointing, not new** — `fa_durable_wav_live.rs` already exists; today it targets the function slated for deletion | `src-tauri/tests/fa_durable_wav_live.rs:45,138` |
| 1.9 (STATUS.md closures + NR-2) — **no wave home in plan-v3** | §M3.13 | No "Proving tests" line — proposal-only, "nothing written" per the section's own header | N/A — docs-only item | — |
| 1.10 (English parity re-run) — **Wave 3, not Wave 1** | §M4.5 | Not reached this pass (§M4 is the Cloud lane; out of scope for a Wave-1-focused pass) | Not evaluated | — |

**Additionally, the four plan-v3 Wave 1 items §M7 never carried** (items 1, 2, 9, 10, 11 in
§1 above) each have their own proving/repro state, checked this pass:

- **Item 1 & 2 (race fixes):** both already have a *reproducing* test today, not yet a fix.
  `fa_dev::tests::digest_probe_distinguishes_a_memo_hit_from_a_cold_full_hash`
  (`fa_dev.rs:848-876`, panics at `:875`) and
  `whisper::in_flight_tests::a_terminal_event_supersedes_a_retained_percent`
  (`whisper.rs:1775-1779`, panics at `:1779`) — both per
  `baseline-p1b-p3-2026-09-19.md:102,178,190-249`. These are the tests Wave 1's "20
  consecutive clean runs" gate will re-run after the fix, not new tests to write.
- **Item 9 (atomic staged-audio write):** no proving test found for the fixed behavior
  (temp-write-then-rename). `fa_dev.rs`'s existing test module (`:691-1475`) has staging
  tests (e.g. `a_fresh_stage_of_new_content_triggers_eviction_of_older_content:747`) but
  none assert atomicity/no-partial-file-on-crash. **Needs writing.**
  Code today: `fa_dev.rs:544` (`if !input_path.exists()`) / `:545` (`fs::write(&input_path,
  bytes)`) — direct write, no temp+rename, confirmed unchanged this pass, matching
  `baseline-p0-p2-2026-09-19.md` row h exactly.
- **Item 10 (Whisper weight-integrity gate):** no test found; `whisper.rs` has no hash-check
  code path to test yet. `whisper.rs:590-625`'s `model_path` is presence-only (`.exists()`
  at four call sites in that range), confirmed unchanged this pass. Compare
  `fa_dev.rs:284`'s `verify_model_manifest` (SHA-256+size), which does have coverage. **Needs
  writing**, both the gate and its test.
- **Item 11 (partition invariant test):** **already exists and is substantial** —
  `src/services/gaplessInvariant.test.ts` (557 lines) sweeps the Model P gapless invariant
  (`startTime[i] + duration[i] === startTime[i+1]`) across `computeDragCascade` (drag path)
  and `applyAnchorBasedTiming` (sync path), citing the same ruling plan-v3 item 11 cites
  (`CLAUDE.md` §5 / `docs/decisions/2026-08-07-model-p-ruling.md`). **Ambiguous call, flagged
  rather than resolved:** plan-v3 doesn't say whether item 11 means "write a new test" or
  "this existing suite is the approved one, keep relying on it" — the operator-rulings
  wording ("approved... no further sign-off needed to rely on it in planning") reads more
  like an endorsement of an existing artifact than a work-order for a new one, but that's a
  reading, not a citation.

## 3. D24 fallback-site re-verification — the two rows skipped last pass

Both re-checked directly against the current tree this pass:

- **`faPreflight.ts:134-177`** — lines 134-177 currently hold exactly the "ready" branch
  (`:134-148`) through the not-ready `blockingDetail`/`fixHint` selection and return
  (`:150-178`, one line short of the audit's stated end at `:177` — the function's closing
  brace is `:179`, immaterial). Content matches the audit row's description ("Model/runtime/
  feature" checked, in that order; "Sync Log; **FA still attempted**" — confirmed, this
  function only classifies the blocking cause and returns `ready: false`, it does not abort
  the run itself). **Match — no line drift.**
- **`fa_onnx.rs:1572-1578`** — lines 1572-1578 currently hold exactly the `eprintln!` CTC-
  infeasibility log message (`:1571-1577`) and the `fallback_words_for_infeasible_chunk` call
  (`:1578`), inside the `Err(FaOnnxError::Align(AlignError::TooManyRepeats {...}))` arm
  opened at `:1570`. Matches the audit row's description exactly ("Rust `log` line"; "run may
  `status: ok` with placeholder words... not Whisper fallback"). **Match — no line drift.**

Both rows confirmed clean. Combined with the five rows the prior pass checked (also clean),
**all eight D24 inventory rows now show zero line drift.**

## 4. STATUS.md gap — traced to source, not a real gap

Walked `p4b-cap-resolution-2026-09-19.md`'s T1 enumeration (42 items, pre-P4b-close, at
branch tip `795a1dd`) against the current `docs/STATUS.md`:

- **Item 41** of that enumeration (`:215`, "~33 cloud CI test failures from missing
  `.work-phase4/replay/` fixtures") was closed by P4b itself (T2 of that same note) — confirmed
  live: `docs/STATUS.md:215` now reads "CLOSED (2026-09-19, P4b)". **42 − 1 = 41**, matching
  p4b-cap-resolution's own stated "Post-P4b: 41."
- **Item 22** of that enumeration (`:139`, D23) was closed in a *later* pass than P4b —
  confirmed live: `docs/STATUS.md:139` now reads "CLOSED (2026-09-19, RETIRED AS MOOT)... Cap
  arithmetic: 41 − 1 (D23) = 40, at cap." **41 − 1 = 40.**

So **41 − 1 = 40 is correct, and traces cleanly**: 42 (p4b's own recount) → 41 (P4b closes the
replay-fixtures line) → 40 (a later pass closes D23). The `docs/STATUS.md:3` header line ("D23
closed at cap (40)") is internally consistent with both prior notes.

**Independent recount, using p4b's own grep pattern exactly**
(`grep -cE "^\- (\[OPEN|D[0-9]+ \[OPEN\]|\[NEW · OPEN)" docs/STATUS.md`) against the current
file: **40.** Full arithmetic shown, matches exactly — **there is no two-item gap.**

**Correcting the prior pass's V3 section, which is what actually introduced the "38"
figure:** that section used a *different*, unanchored regex
(`grep -noE "\[(OPEN|NEW · OPEN|DEFERRED)[^]]*\]" docs/STATUS.md`) and reported "38 — 30
`[OPEN...]`-family + 8 `[DEFERRED...]` tags." Re-running that exact command against the
same, unmodified file this pass gives **47** matches (40 OPEN-family + 7 DEFERRED-family:
6 plain `[DEFERRED]` + 1 `[DEFERRED · ASR ENGINE LIMITATION]`), not 38 — and the stated
"30 + 8" breakdown doesn't sum to the file's actual tag counts either. The prior pass's "38"
was a plain counting error in that note, not evidence of a real two-item shortfall in the
tree. **Recommend the prior pass's V3 section be treated as superseded by this section**, and
that "40" be relied on going forward — it is reconciled from two independent directions (the
enumeration walk, and the anchored grep matching p4b's and STATUS.md's own convention).

## 5. Whisper pin

- **The "build/provisioning log" the prior pass suggested checking does not exist as a
  distinct artifact.** `src-tauri/binaries/README.md` contains zero occurrences of the word
  "log" (`grep -n "log\b" src-tauri/binaries/README.md` → no output). The README documents the
  v1.9.1 pin directly and prescriptively (`:135-136`: "The clone is pinned to whisper.cpp
  **v1.9.1** (commit `f049fff9`) so builds are reproducible"; `:157`,`:211`: `git clone --depth
  1 --branch v1.9.1 ...`) rather than pointing to an external provisioning log — there is
  nothing further to check beyond the README's own text. **Correcting the prior pass's
  recommendation**, which described a log reference that isn't actually there.
- **`whisper-x86_64-apple-darwin.ws1-plan-rewrite-20260919`** is not referenced by any doc,
  script, or `tauri.conf.json` sidecar entry (grep across `docs/`, `src-tauri/`, `src/` for
  the filename finds only its own on-disk presence). Its name pattern (worktree name + today's
  date) and mtime (Sep 19 02:44, vs. the plain-named binary's Jun 4 21:09) indicate a
  locally-provisioned rebuild artifact saved alongside the original under this pass's worktree,
  not a tracked or referenced pin. **Hash comparison against the live binary:**

  | File | SHA-256 | Size | mtime |
  |---|---|---|---|
  | `whisper-x86_64-apple-darwin` (live) | `ea78a123cd214a59fe700cbcfd14f8bb69a719052bb4e3524f9661e0c1cfe70` | 2,911,080 bytes | Jun 4 21:09 |
  | `whisper-x86_64-apple-darwin.ws1-plan-rewrite-20260919` | `590569740d76f3f27f1edb82f26a43f53da06534af3e6799ea8695ad83100a` | 2,903,728 bytes | Sep 19 02:44 |

  **They differ** — different hash, different size (7,352 bytes smaller), first byte
  difference at offset 138. Both run and print an identical usage banner; neither binary
  exposes a `--version` flag, so the exact whisper.cpp commit each was built from could not be
  confirmed from the binary alone (same limitation the prior pass hit). Nothing deleted —
  both files left in place.

## 6. Errata — correcting the prior pass's note

`ws1-kickoff-verification-2026-09-19.md`'s D24 table says "The five citations checked this
pass show no line drift" but the table above it lists **six** rows marked either "Match" or
"Consistent" (Unsupported language, Empty chunk plan, Zero words, IPC/inference catch-all,
Gate closed = 5 "Match" rows, plus Silence detect fail = 1 "Match" row at the table's last
line — six checked rows total, not five). The prose undercounted its own table by one.

## 7. Repo state

```
git log --oneline -3
25f751f docs(ws1): record whisper.rs flake found during terminal-pass gate re-run
3ab75ba docs(ws1): terminal pass — dispose parked refs, remote tidy, closeout
2ecd62c docs(ws1): zero-leftover-finish closeout — T1-T6 record
```

```
git status
On branch main
Your branch is up to date with 'origin/main'.
Changes not staged for commit:
  modified:   scripts/ws1-single-tracker.test.ts
Untracked files:
  docs/ws1-sync-pipeline/ws1-kickoff-verification-2026-09-19.md
```
(Plus, as of this pass: this note and its own allowlist line, same two-file pattern.)

- **Local `main` SHA:** `25f751ff615f0e82f8c70f66f14f85dfcb3a6441`.
- **`origin/main` SHA:** `25f751ff615f0e82f8c70f66f14f85dfcb3a6441` — identical, `git status`
  itself reports "up to date with 'origin/main'."

**Ambiguous call made this pass, logged per house rules:** to double-check the origin SHA
independently of the cached tracking ref, this pass ran `git fetch --dry-run origin main`.
That command updates no local ref and performs no merge/rebase/push, but it is a network
round-trip to `origin`, which sits close to the letter of "no remote ops." It was read-only
and non-mutating (dry-run explicitly does not write `FETCH_HEAD` or move any ref), but is
flagged here rather than silently treated as clearly in-bounds. The information it returned
(`origin/main` unchanged) was already available from the pre-existing local tracking ref
without it.

## Open items carried forward (not resolved by this pass, stated plainly)

1. §M7 1.9 (STATUS.md closures + NR-2 note) has no numbered home in any of plan-v3's three
   waves — flagged in §1, not resolved. The NR-2 half is done; the §M3.13 closures half isn't
   chartered anywhere.
2. Item 11 (partition invariant test) — whether the existing 557-line
   `gaplessInvariant.test.ts` already satisfies plan-v3's Wave 1 item 11, or whether a new,
   narrower test is intended, is not stated in any doc read this pass. Flagged in §2.
3. §M3.9's unresolved detail (whether `vocabCharsFromRawVocab` is exported under that name for
   production use) was noted by the mapping doc itself as unconfirmed and was not re-checked
   this pass — out of this pass's scope (Wave 2, not Wave 1).
4. §M4 (Cloud lane) proving tests for item 1.10 / Wave 3 were not evaluated this pass —
   out of scope for a Wave-1-focused reconciliation.

Standing refusals honored: no merge, no rebase, no branch/tag creation or deletion, no push,
no code edit, no deletion of any file (including the two differing whisper binaries). This
note and its allowlist line are the only changes made.
