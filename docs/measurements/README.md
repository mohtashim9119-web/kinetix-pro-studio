# Measurement Data Index

Raw output from completed, scored, or superseded measurement phases of the sync-pipeline
research programme (Phase 2b through Phase 3's data-cleaning/reference-validity passes).
Moved here 2026-08-07 during the documentation baseline cleanup — none of these files are
referenced by hardcoded path in any script under `scripts/`, so moving them breaks nothing
live. Everything still directly load-bearing for a re-runnable tool or test (e.g. the Step M
golden baseline, `verification-baseline.csv`, the forced-alignment onset CSVs `phase4-step-w-
trust.py`/`phase4-step-x-verify.py` read) remains in `docs/` — see `project-state.md`'s
Documentation Map for that list. Nothing here was deleted or edited; content is unchanged from
its original commit.

| File | Phase | Date | Purpose |
|---|---|---|---|
| `phase2b-onset-173-turbo-dtw.csv` | Phase 2b | 2026-08-05 | Per-pause word-onset error, project 173, turbo model + DTW. Part of the measurement that led to DTW being permanently abandoned (changed timestamps by exactly 0.000000000s). |
| `phase2b-onset-173-turbo-raw.csv` | Phase 2b | 2026-08-05 | Same, turbo model without DTW (the no-DTW control). |
| `phase2b-onset-v6-turbo-dtw.csv` | Phase 2b | 2026-08-05 | Per-pause word-onset error, V6 project, turbo model + DTW. |
| `phase2b-onset-v6-turbo-raw.csv` | Phase 2b | 2026-08-05 | Same, turbo model without DTW. |
| `phase3-onset-173-hf.csv` | Phase 3 follow-up, Task 2 | 2026-08-05 | Per-pause onset error, project 173, jonatasgrosman/wav2vec2 commercial CTC model (Apache-2.0 de-risking measurement). |
| `phase3-onset-v6-hf.csv` | Phase 3 follow-up, Task 2 | 2026-08-05 | Same model, V6 project. |
| `phase3-onset-spanish-hf.csv` | Phase 3 follow-up, Task 2 | 2026-08-06 | Same model, Spanish project. |
| `phase3-onset-v6-fa-ratio.csv` | Phase 3, Blocker 2 | 2026-08-05 | V6 severity-ratio join (error, committed duration, ratio, FA confidence) against every V6 boundary scoring >250ms. |
| `phase3-onset-173-wtext.csv` | Phase 3 data-cleaning, Step 4 | 2026-08-05 | Project 173, whisper-text-mode forced alignment (alignment against Whisper's own transcript rather than the script, the drifted-audio fallback mode). |
| `phase3-onset-v6-wtext.csv` | Phase 3 data-cleaning, Step 4 | 2026-08-05 | Same, V6 project. |
| `phase3-step-c-clips-manifest.csv` | Phase 3, Step C | 2026-08-06 | Public manifest (script text only, no answer key) for the 12-clip blinded listening batch. Batch scored — see `docs/history.md`'s "Phase 3/4 Blinded Listening Protocols" archive entry. |
| `phase3-step-e-stale-pause-audit.csv` | Phase 3 reference-correction, Step E | 2026-08-06 | Stale-pause selection audit against all 446 real V6 boundaries — found the selection rule correct 95% of the time. |
| `phase3-step-h-batch2-manifest.csv` | Phase 3, Step H | 2026-08-06 | Public manifest for the second, independent 20-clip V6 confirmation batch. Batch scored — same archive entry as Step C above. |
| `phase3-step-i-transcript-audit.csv` | Phase 3 blinded-batch scoring, Step I | 2026-08-06 | Export-integrity audit — confirmed only clip2_11 was a genuine content mismatch (segment 320's zero-FA-token cascade), all other clips clean. |
| `phase3-step-j-batch2-scored.csv` | Phase 3 blinded-batch scoring, Step J | 2026-08-06 | Scored results for the 17 valid clips from Step H's batch, excluding clip 11. |
| `phase3-step-k-heading-sweep.csv` | Phase 3 blinded-batch scoring, Step K | 2026-08-06 | Full-transcript sweep finding all 10 of V6's unscripted chapter-heading recitations. |
| `phase3-step2-joint-context-results.csv` | Phase 3 data-cleaning, Step 2 | 2026-08-05 | Joint multi-segment-context re-measurement of the 49 remaining >250ms V6 failures after Step 1's scorer-bug fix. |
| `phase3-step2-targets-v6.json` | Phase 3 data-cleaning, Step 2 | 2026-08-05 | Target segment set for the Step 2 joint-context re-measurement. |
| `phase3-step4-script-vs-whisper.csv` | Phase 3 data-cleaning, Step 4 | 2026-08-05 | Script-text-mode vs. whisper-text-mode FA comparison on the WER/CER-verified-faithful subset. |
| `phase3-step4-wer-cer.csv` | Phase 3 data-cleaning, Step 4 | 2026-08-05 | WER/CER classification (V6/173/Spanish) establishing all three transcripts as faithful before any FA comparison. |

## What stayed in `docs/` instead

Files with a hardcoded path in an executable script (`.py`/`.ts`, not just a docstring
example or CLI `help=` text) were left in place, since moving them would silently change or
break a re-runnable tool without a corresponding code change — out of scope for this pass.
This includes the full Step M golden baseline (`phase4-baseline-*.csv`, read directly by
`scripts/phase4-handoff-replay-sync.test.ts` and `scripts/phase4-restore-replay-inputs.py`),
`verification-baseline.csv` (read by `scripts/phase4-step-w-trust.py` and
`scripts/phase4-step-x-verify.py`), the `*-Smear-Phase2a.csv` transcript-inspector exports
(read by `scripts/phase4-restore-replay-inputs.py`), and the core `phase3-onset-{v6,173,
spanish}-fa*.csv` forced-alignment tables (read by `scripts/phase4-step-w-trust.py` and
others). `v6-smear-baseline.csv`/`173-smear-baseline.csv` also stayed — `CLAUDE.md` cites a
specific row number in `v6-smear-baseline.csv` (row 1179) as evidence for a DO-NOT-DO rule,
and moving the file without also updating that citation risked leaving it silently wrong.
