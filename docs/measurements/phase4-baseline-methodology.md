# Phase 3 -> Phase 4 handoff — Step M golden-baseline methodology

Companion to `docs/phase4-baseline-{v6,173,spanish}-{segments,words,skipped}.csv`.
Read this before trusting or diffing those files against a future
post-Phase-4 run.

## Provenance

| | |
|---|---|
| Commit | `c4fc289939a14a94b5d93269ccbf4de147063755` (`feat(sync): Phase 3 blinded-batch scoring pass — Steps I-L...`), branch `webgl2-effects-engine` |
| Whisper model | `ggml-large-v3-turbo.bin` (turbo), `-l` per-project (`en` for V6/173, `es` for Spanish), flash attention default-on, `--dtw`/`-np` both dropped per Phase 2a |
| ffmpeg | 8.1.1-tessus (evermeet.cx), the same bundled `src-tauri/binaries/ffmpeg-x86_64-apple-darwin` sidecar the app ships |
| Hardware | Intel Core i9-9980HK @ 2.40GHz (x86_64), macOS 26.5.2 (build 25F84), no GPU backend (matches every other measurement in `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`) |
| Whisper token source | Turbo's own raw transcript, captured during Phase 2a Step 5's fresh resync (2026-08-04/05) — `docs/{V6,173,Spanish}-Smear-Phase2a.csv` and the full (un-1000-row-capped) transcript dumps at `/tmp/phase3/{v6,173,spanish}_raw_transcript*.json` (re-extracted here as `docs/phase4-baseline-{v6,173,spanish}-words.csv`) |

## Why this is a valid "current shipped pipeline" baseline despite being computed, not clicked through the UI

No `src/` file touched by the sync pipeline has changed between Phase 2a Step
5's resync (2026-08-04/05, which produced the raw Whisper token captures
above) and this commit (2026-08-06) — every intervening pass (Phase 2b,
Phase 3 Blockers 1-3, the data-cleaning pass, the reference-validity pass,
the reference-correction pass, the blinded-batch scoring pass) is explicitly
recorded as measurement-only with no `src/` edits (see each pass's own entry
in `docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md` / `project-state.md`). Determinism of the
Whisper→Hirschberg→snap pipeline was independently re-verified on turbo
(Phase 2a, byte-identical MD5s across repeated runs). Given that, and given
`docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md`'s own Blocker 3 statement that the sync
pipeline's alignment/boundary code is **pure and DOM/React-free**, replaying
the exact, unmodified, currently-committed pipeline functions against the
already-captured token data reproduces byte-for-byte what a fresh Apply Sync
click in the real running app would commit today — without paying for a
second ~14-minute whisper-turbo run per project.

## What was actually run

`scripts/phase4-handoff-replay-sync.test.ts` (a vitest harness, not a
correctness test — no pipeline assertions) calls, in the exact sequence
`App.tsx`'s `handleApplySyncFromFiles` (`cachedTokensReady` branch, lines
~2400-2551) and `useWhisper.ts`'s `alignSegmentsFromCachedTranscript` use in
production, with **zero reimplementation** — every call is into the real,
unmodified, currently-committed module:

1. `parseProjectData(script, sceneDetails, assets=[], audioDuration)` — the
   real scene-doc parser, run against each project's own `Sync.txt`/
   `Script.txt` (or `sync.txt`/`script.txt`) from `All Projects Test Data/`.
   `assets=[]` only means every segment's `assetId` stays unset — it does not
   affect segment text, order, or timing.
2. `applyAnchorBasedTiming` (fresh-parse anchor normalization).
3. `filterMalformedTokens` -> `alignScenestoTranscript` -> `distributeSegmentTimes`
   -> `applyAnchorBasedTiming` (the inlined body of `alignSegmentsFromCachedTranscript`).
4. `evaluateCoverageGate` (R13 abort check — false/non-aborting on all three
   projects, confirmed in the output).
5. `filterToCoveredSegments` (R4-1/R4-2 skip-unmatched).
6. `snapCoveredBoundaries` (covered-only boundary re-snap).
7. `headExtendFirstSegment` (segment-1 head extension).

## One real, disclosed substitution: the silence source

Step 6 needs a `SilenceInterval[]` array — in production this comes from
`silenceDetector.ts`'s `detectSilences()`, a Web Audio API frame-RMS/dB scan
that only runs inside a browser context (`AudioContext`, unavailable in
Node/vitest). **This is a different algorithm from the `ffmpeg silencedetect`
ground truth every Phase 1b-3 timing-source measurement uses as an
independent scoring reference** — reusing the ffmpeg output here would mean
snapping against the wrong silence source.

`scripts/phase4-handoff-app-silence.py` is a line-for-line Python port of
`silenceDetector.ts`'s exact frame loop (20ms frames, -45dB threshold, 0.25s
minimum duration, RMS -> dB, including the trailing-open-silence boundary
case), run against the same already-transcoded 16kHz mono WAV
`measure-word-onset.py`'s `prepare` step produces. **One disclosed
approximation**: the app decodes the *original* voiceover file (m4a, native
sample rate) via `AudioContext.decodeAudioData`; this port reads the 16kHz
transcode instead. Every threshold in the algorithm is time-based (ms/sec),
not sample-based, so this changes results only by sub-frame quantization
noise — not a source of disagreement large enough to move a boundary
decision. Output: `docs/phase4-baseline-{v6,173,spanish}-silences.csv`
(RMS-detected, 547 / 239 / 27 intervals respectively) — **do not confuse
these with `docs/phase3-onset-*-fa.csv`'s ffmpeg-`silencedetect` ground
truth (539 / different count on 173)**; the two are deliberately different
algorithms serving different purposes (production boundary source vs.
independent scoring reference).

## Cross-validation against already-published findings

Three results this replay produced independently corroborate findings
already published elsewhere in the Phase 2a/3 record, which is the strongest
available evidence the harness is faithful rather than silently wrong:

- **V6 skips exactly segments 27, 28, 29** (0-indexed) — the same three
  segments Phase 2a's Step 5 entry already named as the ~9.7s content
  dropout ("But something stayed in you. Small and permanent. A new
  understanding of what the night actually is.") that turbo's transcript
  never captured at all.
- **173 skips exactly segments 0, 12, 111** (0-indexed = 1-based segments 1,
  13, 112) — segment 1 (title card) and segment 13 (planted "blue monkey"
  string) were already confirmed correct skips at Phase 2a; **segment 112 is
  the turbo-era regression Phase 2b's Finding 2 only *hypothesized*
  ("presented as the most likely mechanism from token evidence, not verified
  by running the pipeline")** — this replay is the first time that
  hypothesis was actually run through the live pipeline, and it resolves
  exactly as predicted: confidence 0.25, 1 of 4 words matched, below the
  run-survival gate.
- **Every project's total committed content-segment duration equals its
  `audioDuration` exactly** (1421.29 / 709.01 / 92.04) — Key Invariant (b),
  `CLAUDE.md` — holding cleanly across all three replays.

## Running the harness on a fresh checkout — the two external inputs it needs

`scripts/phase4-handoff-replay-sync.test.ts` runs as part of the ordinary
`npx vitest run` suite, but it depends on **two things that are deliberately
not committed**. On a machine where either is absent, its three tests fail
with an explicit message naming the fix — that loud failure is Step Y's
design, not a bug, and the tests must never be deleted or have their
assertions loosened to make it quiet.

**1. The regenerable replay inputs** (`.work-phase4/replay/{v6,173,spanish}/`
— gitignored, durable, never `/tmp`, per the K8 pattern). These hold each
project's post-`filterMalformedTokens` token array and its
`silenceDetector.ts`-equivalent silence array. Regenerate all three in one
command, deterministically, from committed sources — **no whisper run
needed**:

```sh
python3 scripts/phase4-restore-replay-inputs.py
```

The script self-verifies its output value-for-value against the committed
`docs/phase4-baseline-*-{words,silences}.csv` before exiting, and refuses to
write a set that doesn't match. Expected output: `3989 tokens / 547 silences`
(v6), `1836 / 239` (173), `363 / 27` (spanish). Verified re-runnable this way
on 2026-08-07 — a clean regeneration reproduced all three sets identically
and took the suite from 1362/1365 to 1365/1365.

Deliberately **not** regenerated by a fresh whisper run: the lost files were
the *post*-filter arrays (3989/1836/363), not whisper's *pre*-filter output
(4556/2082/399), so re-transcribing would supply a different input and
silently invalidate the golden diff.

**2. The corpus itself** (`~/Downloads/All Projects Test Data/`) — the three
projects' `Sync.txt`/`Script.txt` scene docs, read directly by absolute path
at the top of the harness. This is private research material that is not in
the repository on any branch and has no regeneration script; a checkout
without it cannot run these three tests at all. This is the known, separately
documented corpus dependency that `scripts/no-tmp-artifacts.test.ts`'s own
disclosure calls out as *not* covered by its `/tmp` tripwire.

## Known gap, stated plainly

This is a **computed replay of the shipped pipeline's pure functions**, not
a click-through of the live Tauri app — no fresh whisper-cli invocation, no
fresh IPC round-trip, no UI interaction was exercised by this pass. If a
future regression lives in code this replay does not exercise (IPC
marshaling, the Rust sidecar boundary, `App.tsx` state-commit wiring outside
the functions listed above, waveform-based UI rendering), this baseline will
not have caught it. The alignment/boundary math itself — the part every
Phase 1b-3 measurement and this handoff's own gate concerns itself with — is
exercised exactly as shipped.
