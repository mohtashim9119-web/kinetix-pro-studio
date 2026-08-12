# D11 chunked-alignment measurements — 2026-08-13

> WS1 Task 5, Slice D11 (`eda13b1`). Produced live during Slice D12's landing
> pass by actually running the two `#[ignore]`d real-corpus tests D11 shipped
> (`fa_onnx.rs`'s `real_corpus_measurement` module:
> `agreement_240s_excerpt_whole_file_vs_windowed`,
> `full_length_709s_windowed_sanity`) against the real `.work-phase4/replay/173/`
> corpus on this machine — not reconstructed from memory or a prior session.
> Every number below is either copy-pasted verbatim from that run's own
> `--nocapture` output or independently computed from it (labeled which).
>
> **Commands run, in order:**
> ```
> SCRATCHPAD_DIR=/tmp/fa-chunk-plans npx tsx scripts/dump-fa-chunk-plan.ts
> ORT_DYLIB_PATH=<repo>/.work-phase4/spike-runtime/onnxruntime-osx-x86_64-1.23.2/lib/libonnxruntime.dylib \
>   FA_CHUNK_PLAN_DIR=/tmp/fa-chunk-plans /usr/bin/time -l cargo test --features fa-inference \
>   -- --ignored --nocapture agreement_240s_excerpt
> ORT_DYLIB_PATH=<same> FA_CHUNK_PLAN_DIR=/tmp/fa-chunk-plans /usr/bin/time -l cargo test --features fa-inference \
>   -- --ignored --nocapture full_length_709s_windowed_sanity
> ```
> `/usr/bin/time -l` (not part of the test itself) wraps each `cargo test`
> invocation purely to capture "maximum resident set size" — the test binary
> was not modified to add memory instrumentation.

---

## 1. 240s excerpt — whole-file vs. windowed agreement (verbatim)

Test: `agreement_240s_excerpt_whole_file_vs_windowed`. Chunk plan: 32 windowed
chunks (from `computeFaChunkPlan`, unmodified — the pre-coalescing D11 plan),
1 whole-file chunk, both dumped by `scripts/dump-fa-chunk-plan.ts` from the
real 241.18s-audio 173-project excerpt (63 segments).

```
agreement_240s_excerpt_whole_file_vs_windowed: windowed=32 chunks, whole_file=1 chunk(s), running whole-file pass...
agreement_240s_excerpt_whole_file_vs_windowed: whole-file pass done in 113.1s, 569 words
agreement_240s_excerpt_whole_file_vs_windowed: running windowed pass (per-chunk, see FINDING comment above)...
agreement_240s_excerpt_whole_file_vs_windowed: chunk 4 [18.08,18.70) FAILED (81 chars): forced alignment failed: targets length is too long for CTC. Found input length: 30, target length: 80, and number of repeats: 1
agreement_240s_excerpt_whole_file_vs_windowed: windowed pass done in 53.0s, 556 words, 31/32 chunks succeeded, 1 failed
agreement_240s_excerpt_whole_file_vs_windowed: 1 of 32 chunks failed — R.7 (out of scope) would be needed to make production align_chunked survive this; the agreement distribution below is over the 31 SUCCEEDING chunks' words only, not the full 240s.
agreement_240s_excerpt_whole_file_vs_windowed: all hard structural invariants hold on the 31 succeeding windowed chunks' output.
agreement_240s_excerpt_whole_file_vs_windowed: text-matched 556/556 windowed words against 569 whole-file words (1 windowed chunks skipped)
agreement_240s_excerpt_whole_file_vs_windowed: START diff (s) — min=0.0000 p50=2.0200 p90=4.3000 p99=6.2000 max=7.5400
agreement_240s_excerpt_whole_file_vs_windowed: END diff (s) — min=0.0000 p50=1.9800 p90=4.3200 p99=6.2400 max=7.4800
test fa_onnx::real_corpus_measurement::agreement_240s_excerpt_whole_file_vs_windowed ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 127 filtered out; finished in 170.49s
```

Wall-clock (whole `cargo test` invocation, includes compile check + model load
+ both passes, from `/usr/bin/time -l`): **172.99s real**, of which the test
body itself reports 170.49s. Peak memory (`/usr/bin/time -l`'s "maximum
resident set size"): **21,809,991,680 bytes ≈ 20.31 GiB** — this figure is
dominated by the whole-file pass (113.1s of the 170.49s), consistent with
D10's own 240s data point (19.52 GiB) — the ~0.8 GiB difference from D10's
number is within the range of "not the same process, not the same exact
build" noise, not a new finding.

**This agreement distribution is NOT a pass/fail verdict against any budget.**
It is the raw measurement Slice D12's Step 3/5/6 work exists to interpret —
see §5 below.

---

## 2. Per-chunk word-density breakdown (verbatim, diagnostic)

From the same run, per-chunk mean `|start diff|` against the whole-file
reference, plus each chunk's own window and word count — the signal Slice
D12's Step 3(a)/6 investigation used to separate "diffuse small disagreement
everywhere" from "a few chunks carry a large systematic offset":

```
chunk 0 [0.00,4.36) 24 words mean|diff|=2.283s text="Some places in the 41st Millennium don't"
chunk 1 [4.36,12.54) 10 words mean|diff|=4.904s text="Training, equipment, formation, doctrine"
chunk 2 [12.54,16.64) 9 words mean|diff|=1.833s text="These aren't the worst battlefields beca"
chunk 3 [16.64,18.08) 3 words mean|diff|=1.527s text="They're the worst"
chunk 4 — FAILED (CTC infeasible, see §4) — 0 words, excluded from the distribution
chunk 5 [18.70,30.34) 19 words mean|diff|=0.365s text="Number Six, Catachan. Before Catachan pr"
chunk 6 [30.34,32.88) 5 words mean|diff|=2.264s text="It killed everything on it."
chunk 7 [32.88,34.82) 7 words mean|diff|=2.249s text="The jungle didn't evolve around human wa"
chunk 8 [34.82,40.08) 10 words mean|diff|=3.206s text="It spent millions of years optimizing to"
chunk 9 [40.08,42.48) 14 words mean|diff|=3.221s text="and anything with a nervous system is on"
chunk 10 [42.48,54.52) 25 words mean|diff|=4.214s text="Humidity wrecks unprotected electronics "
chunk 11 [54.52,65.28) 18 words mean|diff|=3.683s text="something the Mechanicus has catalogued "
chunk 12 [65.28,69.30) 9 words mean|diff|=3.400s text="Catachan devil ants dissolve flesh faste"
chunk 13 [69.30,75.82) 9 words mean|diff|=3.220s text="The Catachan devil itself, six limbs, ch"
chunk 14 [75.82,82.88) 21 words mean|diff|=0.790s text="to deflect small arms fire, hunts by the"
chunk 15 [82.88,89.68) 20 words mean|diff|=4.996s text="Miral land sharks track ground vibration"
chunk 16 [89.68,99.40) 14 words mean|diff|=4.167s text="Forces without Catachan-born soldiers op"
chunk 17 [99.40,101.86) 6 words mean|diff|=2.500s text="The jungle doesn't telegraph its threats"
chunk 18 [101.86,106.70) 11 words mean|diff|=2.738s text="It withholds them until they're already "
chunk 19 [106.70,115.20) 21 words mean|diff|=0.440s text="Catachan regiments work in that environm"
chunk 20 [115.20,118.62) 9 words mean|diff|=2.329s text="For everyone else, the mission doesn't f"
chunk 21 [118.62,121.66) 7 words mean|diff|=2.637s text="The jungle absorbs it and moves on."
chunk 22 [121.66,123.90) 4 words mean|diff|=2.240s text="Number Five, Space Hulks."
chunk 23 [123.90,127.14) 9 words mean|diff|=2.316s text="A Space Hulk is centuries of accumulated"
chunk 24 [127.14,135.86) 23 words mean|diff|=2.794s text="and debris, fused by warp transit into a"
chunk 25 [135.86,161.46) 55 words mean|diff|=0.077s text="Boarding one isn't a tactical challenge."
chunk 26 [161.46,173.12) 28 words mean|diff|=0.107s text="directions in rooms separated by a singl"
chunk 27 [173.12,174.96) 12 words mean|diff|=2.877s text="of whatever the last crew left behind, w"
chunk 28 [174.96,194.22) 54 words mean|diff|=1.844s text="Genestealers are adapted to this geometr"
chunk 29 [194.22,218.68) 57 words mean|diff|=0.665s text="and flanking acquires a third dimension "
chunk 30 [218.68,225.56) 14 words mean|diff|=3.231s text="Number Four, Vraks. Seventeen years. Tha"
chunk 31 [225.56,241.18) 29 words mean|diff|=0.083s text="the terrain did to every assault the Imp"
```

**Independently computed pattern (from this table, not asserted by the test
itself):** the lowest-disagreement chunks (25, 26, 29, 31 — mean diff
0.08–0.67s) are also the LONGEST chunks (14–29s); the highest-disagreement
chunks (1, 15 — mean diff 4.9–5.0s) are SHORT (2–7s). This correlation —
disagreement shrinking as window size grows — is the direct motivation for
Step 5's window-size ladder (§5), not yet itself a conclusion about which
variable dominates (see §5's "conclusions NOT yet supported" note: this
table conflates window size with attribution error, since D11's chunk text
comes from `segment.startTime` membership, not from the whole-file
reference's own words).

---

## 3. 709s full project — windowed-only wall-clock/memory (verbatim + measured)

Test: `full_length_709s_windowed_sanity`. Whole-file is not attempted (D10
proved it infeasible at this length) — this is windowed-only, 97 chunks.

```
full_length_709s_windowed_sanity: running 97 chunks over the full 709s project...
full_length_709s_windowed_sanity: chunk 4 [18.08,18.70) FAILED (81 chars): forced alignment failed: targets length is too long for CTC. Found input length: 30, target length: 80, and number of repeats: 1
full_length_709s_windowed_sanity: chunk 52 [405.58,406.98) FAILED (77 chars): forced alignment failed: targets length is too long for CTC. Found input length: 69, target length: 76, and number of repeats: 0
full_length_709s_windowed_sanity: wall_clock=132.1s chunks_ok=95/97 chunks_failed=2 words=1616 audio_duration=709.01s
full_length_709s_windowed_sanity: all hard structural invariants hold at full 709s length (over the succeeding chunks).
test fa_onnx::real_corpus_measurement::full_length_709s_windowed_sanity ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 127 filtered out; finished in 132.30s
```

Wall-clock (`/usr/bin/time -l`, whole invocation): **134.63s real**, test body
itself 132.1–132.30s. Peak memory: **2,391,486,464 bytes ≈ 2.23 GiB** — this
is the headline finding of D11's own infrastructure: windowing a 709s project
peaks at **2.23 GiB**, not the 60–154 GiB D10 extrapolated for a whole-file
pass at this length. The mechanism (session-cached model + one small window's
activations in memory at a time, never the whole file's) is exactly what
`fa_onnx.rs`'s session-cache module doc comment states; this is the first
real-corpus number confirming it holds at production length, not just in
principle.

---

## 4. CTC-infeasibility cases: 2/97 (709s), input shapes

Both cases are the same underlying `forced_align` error
(`AlignError`/`FaOnnxError::Align`, surfaced as "targets length is too long
for CTC"): the CTC alignment DP requires `input_length >= target_length +
number_of_consecutive_repeated_target_symbols`, and neither chunk's own
audio window is long enough to fit its assigned text at that constraint.

| Chunk | Window | Window duration | Chars in assigned text | CTC input length (frames) | CTC target length (tokens) | Repeats |
|---|---|---|---|---|---|---|
| 4 | `[18.08, 18.70)` | 0.62s | 81 | 30 | 80 | 1 |
| 52 | `[405.58, 406.98)` | 1.40s | 77 | 69 | 76 | 0 |

**Input-shape derivation, independently checked against the frame rate**
(`conv_stride` = 320 samples/16kHz = 0.02s/frame, D6/`d10-runtime-observations`
§4): chunk 4's 0.62s window → 0.62/0.02 = 31 raw frames, reconciling to the
reported 30 CTC input frames after the model's own convolutional downsampling
edge effect; chunk 52's 1.40s window → 1.40/0.02 = 70 raw frames, reconciling
to the reported 69. Both are consistent with the stated window durations, not
an unrelated bug.

**Root cause (not R.7's problem to fix — R.7 is out of scope per Slice D11's
own scope note, and per this slice's constraints): the WINDOW, not the
TEXT-ATTRIBUTION rule, is the proximate cause of both failures.** Both
windows are far shorter than their neighbors (0.62s and 1.40s vs. a 240s-run
median of 3.12s — see the earlier Step 3(a) run-distribution measurement) —
both are runs that landed between two closely-spaced `agreed-anchor`
boundaries, and each nonetheless inherited an entire committed segment's full
text via `startTime` membership (`faChunkPlan.ts`'s attribution rule) — a
segment whose own committed duration is much larger than the run window that
happens to start inside it. This is exactly the FINDING already recorded in
`fa_onnx.rs`'s own test comment for chunk 4 (copied verbatim from source,
`fa_onnx.rs`'s `agreement_240s_excerpt_whole_file_vs_windowed` doc comment):
> "one chunk ([18.08s, 18.70s), 0.62s of audio) is assigned a 81-character/
> ~80-target-token text load (the segment whose committed `startTime` falls
> in that window has a stale, imprecise OLD timing — its real committed
> duration is 4.65s, far more than the 0.62s window the anchor-verified run
> structure gave it)"

Chunk 52 is the same failure mode, not independently diagnosed in this pass
beyond the input-shape table above — see §5's open question.

---

## 5. Conclusions NOT yet supported by the above

The following would be natural things to conclude from §1–§4, and this
document explicitly does NOT assert any of them — that is Slice D12's Step
3/5/6 job, not this recording step's:

1. **NOT concluded: that windowing itself is inaccurate.** §1's START/END
   diff distribution (p50 ≈ 2.0s, max 7.54s) conflates at least two effects
   that have not been separated yet: (a) genuinely running FA on a smaller
   audio window (a different algorithm run, per D7's own cancellation
   rationale — no frame-level equivalence is guaranteed even when both runs
   are individually correct) and (b) `faChunkPlan.ts`'s attribution rule
   (segment-`startTime` membership) assigning a run TEXT that doesn't
   actually match what's acoustically inside that run's own window — exactly
   the mechanism §4 identifies as the direct cause of both CTC failures, at
   the extreme. §2's own window-size/disagreement correlation is consistent
   with either effect (or both) and does not, on its own, isolate which one
   dominates.
2. **NOT concluded: that 7s-scale windows are too small.** No wider window
   size has been measured yet — this document reports only D11's own,
   already-committed chunk plan (raw R.0 runs, no coalescing).
3. **NOT concluded: that a specific accuracy budget should gate production
   `align_chunked`.** No budget has been derived from a stated principle
   (frame duration, or a measured Whisper-delta baseline) — §1's numbers are
   raw measurements, not evaluated against any threshold.
4. **NOT concluded: that the 2/97 CTC-infeasibility rate is representative.**
   Measured on ONE 709s project from a private corpus — no claim is made
   about how this rate would look on a different project's segment/anchor
   density.

Separating these is the explicit subject of Slice D12's remaining Step 5/6
work (window-size ladder, attribution isolation, Whisper triage) — see
`task5-slice-ledger.md`'s D12 entry once that work lands.

---

## 6. Filename-date check (D12 Step 2 instruction)

`d10-runtime-observations-2026-08-13.md`'s filename date was checked against
its actual commit date: `git log --follow` shows it was committed at `1993733`
on **2026-08-13** — today's date, not the future. No rename was needed.

---

## Cross-references

- Windowing/chunk-plan design and D11's own scope: `task5-slice-ledger.md`
  (D11 entry, once added).
- The prior whole-file-infeasibility finding this slice's memory numbers
  confirm: `d10-runtime-observations-2026-08-13.md` §1.
- Real corpus fixture used: `.work-phase4/replay/173/` (gitignored, not
  committed — present on this machine).
