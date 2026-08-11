# Measurement Data Index

Raw output from completed, scored, or superseded measurement phases of the
sync-pipeline research programme (Phase 2b through Phase 4's
structural-check/scoring passes). WS1 research data — accepted findings live
in `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`; these files are the raw
numbers behind them. None of these files is read by hardcoded path in any
executable `scripts/*.py` or `scripts/*.ts` (a handful are write-only outputs
of the scripts named in their own row below — moving them only required
updating that script's write-target path, not any read path). Nothing here
was deleted or edited; content is unchanged from its original commit.

For files that ARE read by hardcoded path in a test or reusable script (the
Step M golden baseline, forced-alignment ground truth, transcript-inspector
exports) see `scripts/fixtures/README.md` instead — those live in
`scripts/fixtures/`, beside the code that reads them.

| File | Phase | Date | Purpose |
|---|---|---|---|
| `v6-smear-baseline.csv` | Phase 1b/2a | 2026-08-04 | Full per-token transcript-inspector output, V6 project (447-seg, base.en model pre-Phase-2a). Cited by row number in `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`'s smear-mechanism writeups (e.g. row 1179, segment 144's displacement). |
| `173-smear-baseline.csv` | Phase 1b/2a | 2026-08-04 | Same, 173-seg project. |
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
| `phase3-step-c-clips-manifest.csv` | Phase 3, Step C | 2026-08-06 | Public manifest (script text only, no answer key) for the 12-clip blinded listening batch. Batch scored — see `docs/history.md`'s "Phase 3/4 Blinded Listening Protocols" archive entry. Read via a required `--batch1-manifest` CLI argument in `scripts/phase3-step-i-l-audit.py`, not a hardcoded path. |
| `phase3-step-e-stale-pause-audit.csv` | Phase 3 reference-correction, Step E | 2026-08-06 | Stale-pause selection audit against all 446 real V6 boundaries — found the selection rule correct 95% of the time. Write-only output of `scripts/phase3-stale-pause-audit.py`'s `--out-csv`. |
| `phase3-step-h-batch2-manifest.csv` | Phase 3, Step H | 2026-08-06 | Public manifest for the second, independent 20-clip V6 confirmation batch. Batch scored — same archive entry as Step C above. Read via `--batch2-manifest`, not a hardcoded path. |
| `phase3-step-i-transcript-audit.csv` | Phase 3 blinded-batch scoring, Step I | 2026-08-06 | Export-integrity audit — confirmed only clip2_11 was a genuine content mismatch (segment 320's zero-FA-token cascade), all other clips clean. |
| `phase3-step-j-batch2-scored.csv` | Phase 3 blinded-batch scoring, Step J | 2026-08-06 | Scored results for the 17 valid clips from Step H's batch, excluding clip 11. |
| `phase3-step-k-heading-sweep.csv` | Phase 3 blinded-batch scoring, Step K | 2026-08-06 | Full-transcript sweep finding all 10 of V6's unscripted chapter-heading recitations. |
| `phase3-step2-joint-context-results.csv` | Phase 3 data-cleaning, Step 2 | 2026-08-05 | Joint multi-segment-context re-measurement of the 49 remaining >250ms V6 failures after Step 1's scorer-bug fix. |
| `phase3-step2-targets-v6.json` | Phase 3 data-cleaning, Step 2 | 2026-08-05 | Target segment set for the Step 2 joint-context re-measurement. |
| `phase3-step4-script-vs-whisper.csv` | Phase 3 data-cleaning, Step 4 | 2026-08-05 | Script-text-mode vs. whisper-text-mode FA comparison on the WER/CER-verified-faithful subset. |
| `phase3-step4-wer-cer.csv` | Phase 3 data-cleaning, Step 4 | 2026-08-05 | WER/CER classification (V6/173/Spanish) establishing all three transcripts as faithful before any FA comparison. |
| `phase3-step-a-threshold-sweep.csv` | Phase 3 reference-validity, Step A | 2026-08-05 | Full per-row, per-floor threshold sweep. Write-only output of `scripts/phase3-reference-validity-step-a-sweep.py`; no other script reads it back. |
| `phase3-step-b-phoneme-bucket.csv` | Phase 3 reference-validity, Step B | 2026-08-05 | Every V6 boundary tagged by phoneme bucket. Write-only output of `scripts/phase3-reference-validity-step-b-phoneme.py`; no other script reads it back. |
| `phase4-step-q-integrity-check.csv` | Phase 4, Step Q | 2026-08-06 | Spanish blinded-clip export-integrity check. Write-only output of `scripts/phase4-step-q-spanish-clips.py`; no other script reads it back. |
| `phase4-step-q-spanish-manifest.csv` | Phase 4, Step Q | 2026-08-06 | Public manifest for the Spanish blinded-clip batch. Write-only output of `scripts/phase4-step-q-spanish-clips.py`; no other script reads it back. |
| `phase4-step-s-check-results.csv` | Phase 4, Step S | 2026-08-06 | Structural-check results (V6/173/Spanish baselines). Write-only output of `scripts/phase4-step-s-structural-checks.py`; no other script reads it back. |
| `phase4-step-u-spanish-scored.csv` | Phase 4, Step U | 2026-08-06 | Scored results for the Spanish blinded batch. Write-only output of `scripts/phase4-step-u-score-spanish.py`; no other script reads it back. |

## Rescued data

One exception to "nothing here was deleted or edited": `rescued-2026-08-07-model-p-park/` was never previously committed anywhere reachable from `main`. It's a byte-for-byte preservation copy, pulled 2026-08-11 from the orphaned, unmerged branch `wip/preserve-2026-08-07` (commit `79f779523a35920320ce0f791415d9783e493197`) before that branch could be pruned with no other copy of its data existing. See the folder's own `PROVENANCE.md` for the full per-file manifest and byte-identity verification; indexed here at folder grain only.

| Folder | Phase | Date | Purpose |
|---|---|---|---|
| `rescued-2026-08-07-model-p-park/answer-keys/` | Phase 4, Step Q | data 2026-08-06, rescued 2026-08-11 | Spanish blinded-listening ground truth (10-clip answer key + human transcripts). |
| `rescued-2026-08-07-model-p-park/listening-clips/spanish-batch/` | Phase 4, Step Q | data 2026-08-06, rescued 2026-08-11 | The 10 Spanish `.wav` clips those answer keys score. |
| `rescued-2026-08-07-model-p-park/work-phase4/replay/{173,spanish,v6}/` | Phase 4, Step M | data 2026-08-07, rescued 2026-08-11 | Golden-baseline replay snapshots (segments, silences, transcript tokens, audio) + Task 5 boundary-audit reports for the three real corpus projects. |
| `rescued-2026-08-07-model-p-park/work-phase4/` (root files + `step-x-clips/`) | Phase 4, Steps U/W/X/AA | data 2026-08-06/07, rescued 2026-08-11 | Spanish breath-aware reference + 22-pause targets (cited by `spanish-gate-scoring.md`); K13/K14 live-repro evidence; 5 named structural-check audio clips (C02–C10). |
