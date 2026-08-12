# D10 runtime observations — 2026-08-13

> WS1 Task 5, Slice D10 (`3787b11`). Recorded during this documentation pass
> (Task 5 Slice D-doc-sync) from the operator's own account of the D10
> session plus what the D10 commit message itself states. See the
> provenance note at the end of each section — some figures below are
> corroborated by a committed artifact (the commit message itself, part of
> `git log`), others are recorded as reported by the operator because no
> committed file captures the dev harness's console output.

---

## 1. Whole-file memory scaling (duration ladder)

**Finding:** running `fa_align_dev` (the D10 dev-only command, `fa_dev.rs`)
against real project audio at increasing clip lengths showed peak memory
scaling **super-linearly, accelerating**, not linearly, with clip duration.

| Clip length | Wall-clock | Peak memory |
|---|---|---|
| 30s | 7.64s | 1.94 GiB |
| 60s | 14.18s | 3.45 GiB |
| 120s | 34.53s | 7.79 GiB |
| 240s | 117.72s | 19.52 GiB |

Extrapolating the same growth curve to a real 709s voiceover (this project's
own approximate upper bound for a single narrated slideshow) lands at
**roughly 60 GB to 154 GB**, several times this development machine's 32 GB
of physical memory.

**Conclusion:** a single whole-file forced-alignment pass is **infeasible**
on production-length audio. This is the finding that makes windowing (Step
R, `sync-pipeline-v2-plan.md`) mandatory rather than a future optimization —
without it, FA simply cannot run to completion on a real project.

**Provenance.** The aggregate shape of this finding — duration ladder at
30/60/120/240s, super-linear/accelerating scaling, extrapolation to a real
709s voiceover landing at "60-150GB," and the 32 GB machine ceiling — is
stated directly in the D10 commit message (`git log -1 3787b11`), which is
itself a committed repository artifact. The per-step wall-clock/peak-memory
figures in the table above (e.g. "30s/7.64s/1.94GiB") are **not** present in
that commit message, in any file under `.work-phase4/` (gitignored, checked
during this pass), or anywhere else `grep`-able in the repository — the dev
harness prints its ladder to the devtools console, which is not captured to
a committed log. They are recorded here as reported by the operator who ran
the D10 session, not independently re-derived from a repo artifact. Anyone
needing to re-verify the exact per-step numbers should re-run
`window.__faDevAlign` (DEV build only) against clips of the stated lengths.

---

## 2. FA-vs-Whisper anchorStart delta (observational)

**Finding:** a 240s real-content run against 64 real segments produced 576
real words. Comparing each segment's FA-derived `anchorStart` against the
existing Whisper-derived value for the same segment:

| Statistic | Value |
|---|---|
| min | -0.77s |
| median | 0.21s |
| max | 1.16s |
| mean | 0.22s |

This is an **observational** comparison, not a pass/fail gate — there is no
independent ground truth in this run distinguishing which source is more
accurate at any individual segment. It is recorded as the first real
instance of the "FA-vs-Whisper delta distribution as a full-length sanity
check," the third leg of the Automated Agreement Budget ruling (see
`docs/ws1-sync-pipeline/task5-slice-ledger.md` §4) — a baseline distribution
future windowing changes should be diffed against for new outliers, not a
correctness verdict on either source.

**Provenance.** `min=-0.77s`/`median=0.21s`/`max=1.16s`, the 64-segment/
576-word counts, and the 240s run length are stated directly in the D10
commit message. The **mean** (0.22s) is not stated in the commit message and
is recorded here as reported by the operator, for the same reason as the
per-step ladder figures above — not independently re-derivable from a
committed artifact.

---

## 3. Confidence range across committed e2e fixtures

**Finding:** applying the confidence-unit conversion (`exp(score)`, ruled at
D9 — see the slice ledger §4) to all six committed `fa-e2e-alignment-*.json`
fixtures' word scores produces a confidence range of **[0.730, 1.0]** across
every word in every fixture.

**Consequence:** `syncConstants.ts`'s `CONF_MIN = 0.3` (R.7's per-word
confidence floor) sits far below the lowest confidence any committed fixture
produces. **R.7's confidence gate is untestable on any audio this repository
currently has** — no existing test exercises the gate's reject branch
against real model output. This is a coverage gap, not a defect in the gate
itself, and is carried in the known-gap register
(`docs/ws1-sync-pipeline/task5-slice-ledger.md` §6).

**Provenance.** Stated directly in the D9 commit message (`git log -1
49dce01`): "exponentiating D8's six fixture score ranges lands entirely in
[0.730, 1.0]." Committed-artifact-verified, not operator-reported.

---

## 4. `conv_stride` → seconds-per-frame

**Finding:** all five jonatasgrosman per-language models share an identical
Wav2Vec2 feature-encoder `conv_stride` of 320 samples at a 16kHz sample
rate, giving exactly 0.02s (320/16000) per emission frame.

**Provenance.** Sourced from each language's own HuggingFace `config.json`
(`.work-phase4/spike-runtime/models/*/config.json`, gitignored — present on
this development machine, confirmed byte-identical across all five before
`fa_onnx.rs::frame_to_seconds` was written to use the constant, per the D6
commit message and `fa_onnx.rs`'s own code comment). Deliberately not
derived from the unrelated MMS_FA-based `fa-emission-*.json` fixtures' own
empirically-measured (and per-clip-drifting, 49.615-49.841 fps) frame rate —
a different model family, downstream of stride rather than an independent
measurement of it.

---

## Cross-references

- Rulings these findings support: `docs/ws1-sync-pipeline/task5-slice-ledger.md`
  §4 (capability gate, caching, R.5 wildcards, Automated Agreement Budget).
- Slice-by-slice build record: `docs/ws1-sync-pipeline/task5-slice-ledger.md`
  §1.
- The unrelated ort/onnxruntime runtime-unblock investigation (a build-time,
  not run-time, question): `docs/ws1-sync-pipeline/measurements/
  runtime-unblock-2026-08-12.md`.
