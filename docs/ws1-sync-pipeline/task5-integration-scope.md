# WS1 Task 5 — Integration Scoping Memo

> WS1 Task 5, Slice D16, A4. Read-only scoping — nothing implemented here.
> Measurement is closed as of D15/D16 (see `task5-slice-ledger.md`'s D16
> row and `measurements/README.md`'s proxy-retirement note); this memo asks
> what's left before forced alignment can become a real, production timing
> source, and in what order.

---

## 1. Who is the intended consumer of FA word timings?

**No consumer exists in any active roadmap item today. This is the blocking
product decision.**

Searched the repo and the roadmap directly rather than assuming:

- `faWordSpansToTranscriptTokens` (`src/services/faBoundaryTypes.ts:117`)
  has exactly **one** caller anywhere in the codebase: `src/App.tsx`'s
  DEV-only `__faDevAlign` harness (`App.tsx:3498-3607`,
  `import.meta.env.DEV`-gated, no UI, never reachable from production code).
  That harness feeds the reshaped tokens through the real, unmodified
  `alignScenestoTranscript`/`extractSegmentAlignments` to print a per-segment
  `t0` (the FA analog of `anchorStart`) next to the currently-stored
  Whisper-derived value — **observational only, never written back** (no
  `setProject`, no history entry).
- Grepped the whole frontend for a word-level highlight/caption/karaoke
  renderer. **It does not exist.** `VideoSegment`/`TextOverlay`
  (`src/types.ts`) render whole-segment or whole-overlay text only.
- One placeholder was found: `src/components/Timeline.tsx:846-849` —
  `{/* Captions track — hook-in for Task 9d (captionCues not yet wired) */}`.
  No "Task 9d" definition exists anywhere else in the repo (not in
  `project-state.md`, `docs/work-in-progress.md`, or any `ws1-sync-pipeline`
  doc) — it is an unimplemented placeholder comment with no scoped task
  behind it.
- `project-state.md`'s Deferred Planned Items §6 lists **"Auto-captions
  (reuse Whisper transcript tokens as a timed text layer)"** as an
  owner-maintained, unscheduled Polish Feature. Note its own wording: it
  cites **Whisper** transcript tokens as the timing source, not FA — even
  the one deferred idea that resembles a per-word consumer does not
  currently name forced alignment as its input.

**What this means concretely:** Task 5's own R.5/R.7-R.9 design
(`sync-pipeline-v2-plan.md`'s Step R) and D8/D9's word-merge/confidence work
were built assuming FA's word-level output matters *as words* — but the one
real, reachable-today use of that output (`__faDevAlign`) only ever collapses
it back down to a single per-segment `t0`, discarding everything else
(per-word confidence, individual spans) the moment it's computed. Two
genuinely different products are being conflated under "Task 5":

1. **Segment-level timing correction** — replace `anchorStart`'s Whisper
   derivation with an FA-derived one (`anchorSource: 'forced-alignment'`,
   already ruled and ordered above `'whisper'` per R-G,
   `project-state.md`'s Rulings In Force). Needs only each segment's
   *aggregate* boundary. This is what `__faDevAlign` already demonstrates
   end-to-end today, dev-only.
2. **Per-word timing display** (captions/highlight/karaoke, the Task 9d
   placeholder or the deferred Auto-captions item) — needs the *full*
   per-word span array, confidence-gated per R.7, wildcard-aware per R.5,
   surfaced through a real UI that does not exist yet.

Every windowing/attribution measurement D11-D16 ran (window-size ladder,
index attribution, the whole-file-agreement proxy now retired) was scored
against **word-level** onset accuracy — i.e., implicitly against consumer
(2), the one with no scoped owner or UI. If the owner intends only consumer
(1), most of that word-level precision work was already sufficient several
slices ago (D13's index-45s is already indistinguishable from the whole-file
reference against Whisper ground truth) and the remaining integration work
is much smaller than R.5/R.7-R.9's full design implies. If the owner intends
(2), R.5/R.7-R.9 and a UI still need to be built, and the 0.3s
product-decision gate proposed in `d15-mis-assignment-diagnostic-2026-08-13.md`
§2.2 needs real sign-off before anything is wired to it.

**Recommendation: get an explicit owner ruling on which of (1) or (2) — or
both, sequenced — Task 5 is actually for, before scoping further
integration work.** Everything in §3 below is written to be useful under
either answer, but the *order* of B3's four items depends on which is
intended (see §4).

---

## 2. What R.5 and R.7 actually require, and does `faWordSpansToTranscriptTokens` satisfy it today?

Quoted directly from `sync-pipeline-v2-plan.md`:

> **R.5 — Unscripted audio inside a run.** Between consecutive segments
> inside a run, insert a CTC wildcard... that may absorb arbitrary audio at
> zero alignment cost. Audio absorbed by a wildcard belongs to **no**
> segment... **Recommendation, flagged for an owner ruling rather than
> assumed:** assign the whole wildcard gap to the PRECEDING segment...
> (`sync-pipeline-v2-plan.md:1485-1503`)

> **R.7 — Failure paths (the skip-and-flag contract).**
> - target text cannot fit the window even at full run length → skip the
>   segment, insert a wildcard in its place, emit a structural finding.
> - no admissible anchor within `MAX_RUN_SEC` → force-split, mark
>   LOW-CONFIDENCE, emit a finding.
> - FA per-word confidence below `CONF_MIN` (0.3)... on a run's first or
>   last word → do not use that word as a boundary; fall back to the run's
>   own anchor. (`sync-pipeline-v2-plan.md:1521-1533`)

**No. `faWordSpansToTranscriptTokens` (`faBoundaryTypes.ts:117-124`) is a
bare 1:1 reshape** — `words.map(w => ({ startSec, endSec, text: w.word,
confidence: w.confidence }))`. It does not:

- consume or emit anything about wildcards (R.5 is not implemented anywhere
  in the Rust or TS FA surface — confirmed in `task5-slice-ledger.md`'s
  known-gap register, "R.5 wildcards: Deliberately deferred").
- check `CONF_MIN` against any word's confidence, fall back to a run anchor,
  or emit a structural finding (R.7). `CONF_MIN` (`syncConstants.ts:536`)
  is defined but has **zero consumers** — grepped directly, confirmed
  unchanged by D11-D16.
- distinguish a force-split (LOW-CONFIDENCE) boundary from an agreed-anchor
  one in its own output shape — that distinction exists in `FaRun`'s
  `RunBoundaryProvenance` (`faAnchors.ts:67-72`) one layer below, but is not
  threaded through `FaWordSpan`/`TranscriptToken` at all.

So today's FA path satisfies **neither R.5 nor R.7** — it produces raw word
spans and nothing else. Both remain fully unimplemented design, not
partially-done code.

---

## 3. B3's four not-started items — smallest first slice and hard prerequisite

Source: `task5-slice-ledger.md` §6 Known-gap register (reconciled at D15,
re-confirmed unchanged at D16).

| Item | Smallest first slice | Hard prerequisite |
|---|---|---|
| **Windowing wiring** (R.2 padding, R.3 clamp-reference-point change, R.5 wildcards, R.7-R.9 failure paths — R.0/R.1/R.4 already landed, D11-D16) | Implement **R.2 padding alone** in `faChunkPlan.ts`'s run construction (pure TS, no ONNX/inference dependency, testable against the existing real-corpus fixtures without a live model) — today's runs are explicitly "raw, unpadded" (`faChunkPlan.ts:47`). | None technical — but re-run the D11-D16 real-corpus agreement measurements after padding lands, since padding changes each chunk's audio content and could invalidate D16's own "residual is Whisper-intrinsic, not fixable locally" finding for a *differently*-windowed chunk. Also needs §1's product-decision ruling first if the answer is consumer (2) — R.5's own wildcard-destination question is itself still an open owner ruling (`sync-pipeline-v2-plan.md:1499`, "flagged for an owner ruling rather than assumed"), so R.5 specifically cannot be implemented, only R.2/R.3/R.7-R.9 can proceed independently of that ruling. |
| **Durable production audio path** (no production caller leaves a durable WAV on disk today — `fa_align_dev` exists only because of this) | Give a production entry point a durable transcoded WAV, reusing `whisper.rs`'s `transcode_to_wav` helper without its current delete-on-exit lifecycle (`task5-slice-ledger.md`'s known-gap row states this exact reuse path). | **The capability-gated Settings-toggle decision** (`task5-slice-ledger.md` §4, "Capability gate — dev-only is a phase, not the endpoint," ruled REQUIRED before production use) must exist first — there is no reason to persist a WAV without a production caller that will consume it. |
| **Production-side `AppHandle` coverage** (D10 exercised a real `AppHandle` only via the dev tool, `fa_dev.rs`) | A non-dev, capability-gated Tauri command that calls `fa_model_path`/`fa_align` through a live `AppHandle`, mirroring `fa_align_dev`'s already-proven resolution path (`app.path().app_local_data_dir()`) without the dev-only wrapper. | **Same capability-gate decision as the audio-path item above** — these two are naturally one slice, not two: a production command needs both a durable WAV and a real `AppHandle` to do anything. |
| **R-H judgement** (the FA-swap-reviewed-against-baseline half of ruling R-H, `ws1-master-roadmap.md:108-113`) | Not independently startable. Once production wiring lands, run the FA swap against the golden-replay baseline and review per-boundary. | **Completion of the production-wiring slice above** (audio path + `AppHandle` coverage together) — R-H is explicitly recorded as blocked on "a real per-language model" reaching the golden-replay path, which only exists once that slice ships. |

---

## 4. Recommended order

1. **Owner ruling on §1's product question** (segment-timing-only vs.
   per-word display, or both sequenced) — every item below is scoped
   differently depending on the answer, so resolving this first avoids
   building windowing precision (§1) that a segment-timing-only answer
   would make largely moot, or skipping R.5/R.7 (§2) that a per-word-display
   answer would require.
2. **R.2 padding** (windowing wiring's independently-startable slice, §3
   row 1) — proceeds regardless of §1's answer, since realistic (non-zero
   left/right context) chunk audio benefits both a segment-timing-only path
   and a per-word-display path equally, and needs no production wiring to
   build or measure.
3. **R.5's wildcard-destination owner ruling** (`sync-pipeline-v2-plan.md`'s
   own flagged, not-yet-decided recommendation) — a decision, not code;
   sequenced here because it's cheap to resolve and unblocks the rest of
   windowing wiring (R.3/R.7-R.9) once padding (step 2) is in.
4. **Capability-gated production wiring** (durable audio path +
   production-side `AppHandle` coverage together, §3 rows 2-3) — the
   single largest remaining engineering slice, and the one every other open
   item is either downstream of (R-H) or independent of but blocked from
   *mattering* without (word-level precision work has nowhere to ship
   without it).
5. **R-H judgement** — only possible after step 4, by construction.

Steps 2-3 can run in parallel with step 1 sitting open (they don't depend on
its answer); step 4 should wait for step 1's answer even though it is not
strictly blocked by it, since the shape of the production command (does it
need to surface per-word confidence/wildcard data to a caller, or just a
single `t0`?) differs materially between the two answers.
