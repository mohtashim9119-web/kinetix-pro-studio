# P4b — cap resolution + signature readiness (2026-09-19)

Docs-only, small. Resolves the cap-arithmetic discrepancy flagged in
`baseline-clean-declaration-2026-09-19.md`'s Decision Log item 4.

## T1 — Enumeration of open `docs/STATUS.md` lines, pre-P4b

Counted directly against the file at branch tip `795a1dd` (immediately before this
pass's edit), via `grep -cE "^\- (\[OPEN|D[0-9]+ \[OPEN\]|\[NEW · OPEN)" docs/STATUS.md`:
**42**, not 41 — the P4 pass's own closing report undercounted by one (it asserted 41
via "40 − 1 + 2"; the actual pre-P4 baseline was 41, not 40, so the real post-P4 total
was 42). Full list, in file order:

1. `docs/STATUS.md:42` — Live acceptance run, owner verdict
2. `:43` — Flip `FA_PROJECT_DEFAULT_ON` once three preconditions met
3. `:45` — Produce `fa-vocab-<lang>.json` files / wire vocab (PARTLY CLOSED)
4. `:46` — Task 2 — re-derive 50/50 silence-split rule
5. `:47` — Task 3 — stale-anchor scroll degradation test
6. `:48` — Wire `FaEvent` to a UI progress consumer
7. `:49` — Rule-stage fixture-backed regression
8. `:51` — Pillar 2 passive detector
9. `:52` — Sync log revamp
10. `:53` — Phases 4–7 restructure
11. `:54` — Rule-stage propose/arbitrate rebuild
12. `:66` — 5 Zero-Defect Register rows
13. `:67` — Alignment cost unbounded for real inputs
14. `:68` — D24 (re-filed from WS3)
15. `:69` — `fa-dev-digest-memo-reset-race` (new, P4)
16. `:70` — `whisper-terminal-buffer-cap-eviction-race` (new, P4)
17. `:94` — Transcription Req 2 incremental draft save
18. `:95` — Raw IPC for ffmpeg probes
19. `:136` — Complete remaining `windows-validation.md` hardware rows
20. `:137` — Append-path batching throughput claim unverified
21. `:138` — Part C 500-segment export silent gaps
22. `:139` — D23 (with T4's consumer report + recommendation)
23. `:143` — `ExportFinishShortfallCard` blocked on D7 frame accounting
24. `:144` — `IdbToNativeMigrationView` orphan
25. `:150` — Whisper-cache flake bounded only by `--test-threads=1`
26. `:151` — `navigator.storage.persist()` WebView2 return value unrecorded
27. `:176` — D9 encoder-restart investigation
28. `:202` — ORT intra-op thread ceiling undecided
29. `:203` — `fa_cancel` has zero frontend callers
30. `:204` — `faBoundaryTypes.ts` missing one-way drift entries
31. `:205` — `.digest.json` not removed on model delete
32. `:206` — Two `fa_dev` digest tests share process-global memo
33. `:207` — Whisper attach buffer 30s stale-replay window
34. `:208` — React max update depth during V8 FA run
35. `:209` — Dev-profile WebKit IDB holds 469MB legacy v1 data
36. `:210` — Legacy export ffmpeg concat/mux paths unbounded
37. `:211` — macOS `VideoEncoder` output not byte-reproducible
38. `:212` — Part C longest silent interval lacks phase attribution
39. `:213` — `GL_TRANSITION_SLUGS` duplicated
40. `:214` — Three parallel disk-size estimators
41. `:215` — **~33 cloud CI test failures from missing `.work-phase4/replay/` fixtures** — closed this pass, see T2
42. `:216` — 10 local `archive/wt-*-2026-09-14` branches, none pushed to origin

## T2 — Path A

Checked both named candidates against the live file:

- **(a) machine-dependent npm failure count** — no live `docs/STATUS.md` line exists for
  this. Grepped for `npm`/`34 fail`/`13 failed`: zero hits. Not applicable.
- **(b) gitignored replay fixtures** — **exists**, item 41 above (`:215`, "~33 cloud CI
  test failures from missing `.work-phase4/replay/` fixtures").

Only (b) exists. Closed it, with evidence:

- **Fixtures tracked:** `549ce63` — "chore(ws1): commit `.work-phase4/replay/` fixtures
  as tracked content."
- **Canonical zero-failure line reconfirmed at current tip:** `53449b9` — gate 6 of
  `baseline-p1b-p3-2026-09-19.md`: `npm test` → 3925 passed / 78 skipped / 0 failed.
  Matches the canonical line first established in `baseline-p1-2026-09-19.md`
  ("`npm test → Test Files 254 passed | 63 skipped (317); Tests 3925 passed | 78
  skipped (4003)`").
- The other 1 of the originally-observed 34 `npm test` failures (the WS1 single-tracker
  allowlist gap) was closed earlier and separately, by `2b7d33a` — it was never this
  line's failure mode and had no `docs/STATUS.md` line of its own to close.

(a) does not exist, so there was nothing to close for it — not a gap in this pass, just
a candidate that turned out inapplicable.

## Cap arithmetic, re-shown

```
Pre-P4 baseline (verified count, corrected):        41
P4 pass:      R.7 closed (:32, now fully closed)     -1
              2 new Wave-1 defects registered         +2
                                                    -------
Post-P4 (actual, corrected from the earlier "41"):    42

P4b pass:     replay-fixtures line closed (:215)      -1
                                                    -------
Post-P4b:                                             41
```

**41 open lines**, evidence-backed. No Path B raise note is needed — Path A resolved the
discrepancy without inventing a deliberate-raise justification.

## T4 — Signature-readiness check (no edits, verification only)

Read all three artifacts named in the P4b brief in full, against their current committed
state, to confirm each is complete and self-contained for the operator to act on without
needing to reconstruct context from chat:

- **(a) D23 consumer-report verdict + recommendation**, `docs/STATUS.md:139` (landed in
  `383569d`): states the full consumer list with file:line for each
  (`exportCheckpointWriter.ts`, `exportResumeSession.ts`, `exportReexportCheck.ts`,
  `exportPipelineWebCodecs.ts`), names the one non-consumer (`ffmpeg.rs`'s test fixture
  strings), states the finding ("checkpoint invalidation is the only consumer"), and
  states the recommendation explicitly as "recommendation only, operator decides: retire
  D23 as moot under the WS3 wholesale render-engine replacement." **Complete and
  self-contained** — an operator reading only this line has everything needed to decide.
- **(b) Final baseline declaration table**,
  `docs/ws1-sync-pipeline/baseline-clean-declaration-2026-09-19.md` "Baseline criteria ×
  evidence" table: seven rows, each criterion paired with its evidence commit
  (`53449b9`, `549ce63`, `2b7d33a`, `2e74209`, `5221c95`, and this pass's own work).
  **Complete and self-contained** — every row resolves to a commit SHA an operator can
  `git show`, no row left as prose-only. (The cap-arithmetic section beneath it is now
  stale as of this P4b pass — see the note added below.)
- **(c) Merge + wipe proposal**, same file, "Merge proposal" section: states the single
  action (`ws1-plan-rewrite` → `main` merge, not executed), the trigger (operator go),
  and the follow-on (four-worktree wipe via the audited delete helper, webgl2 stash
  preserved as a patch first). **Complete and self-contained** — states what, when, and
  the one precondition (stash preservation) an operator needs to check before the wipe.

A one-line pointer has been appended to `baseline-clean-declaration-2026-09-19.md`'s
cap-arithmetic section directing to this note, since that section's own numbers (40 − 1 +
2 = 41 claimed as "actual") are now superseded by the corrected accounting above — the
original error was undercounting the pre-P4 baseline as 40 rather than 41. No other edit
was made to (a), (b), or (c) themselves, per this pass's "no edits, just confirm" scope.

## Decision Log

1. T1's recount found 42, not the task brief's stated 41, immediately pre-P4b. Root
   cause: the P4 pass's own cap arithmetic (`40 − 1 + 2 = 41`) was built on an
   uncorrected pre-P4 baseline of 40, when the verified pre-P4 baseline was actually 41
   (see `baseline-clean-declaration-2026-09-19.md` Decision Log item 4). Compounding the
   error forward gives 42, not 41. Recorded here rather than silently using the brief's
   assumed 41 as ground truth.
2. Path A applied for (b) only — (a) has no live `docs/STATUS.md` line and was correctly
   left untouched rather than fabricated to make a closure available.
3. Path B (raise note) was not needed once Path A resolved one line — no deliberate cap
   raise to justify.
4. `baseline-clean-declaration-2026-09-19.md` was pointed at this note rather than
   rewritten in place, keeping that file's own text as a historical record of the
   original (imperfect) accounting.

## Commit

This note is added to `scripts/ws1-single-tracker.test.ts`'s `ALLOWLIST` in the same
commit, per the WS1 single-tracker convention (dated, read-only, docs-only note).

## SHAs

- Branch tip immediately before this pass: `795a1dd`
- Fixtures tracked: `549ce63`
- Canonical zero-failure line first established: (part of the `baseline-p1-2026-09-19.md`
  pass, folded into `ce8bca1`)
- Canonical zero-failure line reconfirmed at current tip: `53449b9`
- Allowlist gap closure (unrelated to the replay-fixtures line, cited for completeness): `2b7d33a`
