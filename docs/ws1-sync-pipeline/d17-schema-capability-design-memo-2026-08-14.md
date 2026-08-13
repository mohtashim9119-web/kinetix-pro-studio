# WS1 Task 5 Slice D17 — Schema/History/Golden-Replay/R.5/R.7 Design Memo

> Design only — nothing built here (Track B of Slice D17; Track A landed the
> capability gate itself, `src/services/faGate.ts` +
> `ProjectSettingsModal.tsx`, see
> `task5-integration-scope.md`'s §0 for the owner ruling this memo scopes
> against: D1 SCOPE = Option B, full word-level timings persisted in
> project data, with R.5 wildcards and R.7 CONF_MIN fallback). No schema
> writes, no migration code, no R.5, no R.7, no audio path, no IPC land in
> this slice — every answer below states plainly where the answer is "does
> not exist yet."

---

## B1 — Schema

**Project data structure and serialization** (`src/types.ts:294-369`,
`src/services/projectStore.ts`): `Project` is one big interface
(`types.ts:294`), saved as a single JSON blob per project key
(`projectKey(id)`, `projectStore.ts:8-10`) via
`localStorage.setItem(..., JSON.stringify(stored))` (`saveProject`,
`projectStore.ts:44-51`). `StoredProject` (`projectStore.ts:20-24`) wraps it:
`{ version: 2, savedAt, project }`, with asset blob URLs/files stripped
(`stripAsset`, `projectStore.ts:26-29` — real bytes live in IndexedDB via
`assetStore.ts`, referenced by id only).

**Version field / migration mechanism: a version NUMBER exists but nothing
reads or branches on it.** `StoredProject.version: 2` is written on every
save (`projectStore.ts:44`) but `loadProject` (`projectStore.ts:73-97`)
never inspects `stored.version` anywhere — grepped directly, zero hits for
`stored.version` outside the write site. Backward compatibility today is
handled entirely by **unconditional per-field defaulting/stripping on every
load**, regardless of what version (if any) produced the stored JSON:

- `{ headings: [], ...stored.project }` (`projectStore.ts:80-81`) — defaults
  a field absent on pre-Path-B projects.
- `playbackSpeed`/`sourceDuration` are destructured off and discarded on
  every segment on every load (`projectStore.ts:88-96`) — strips fields that
  no longer exist as a concept, unconditionally.

So: **no real migration mechanism exists.** This is not this slice's
prerequisite to fix — the existing precedent (add an optional field, default
it on read, no version check) already works and is exactly what a new
`faWordTimings` field should follow — but it is worth naming as standing
tech debt: `version` currently lies about being load-bearing.

**Where word timings should attach.** Recommend a **project-level, flat
array** — `Project.faWordTimings?: TranscriptToken[]` — not a per-segment
field. Reasons, grounded in existing patterns rather than invented:

1. `TranscriptToken` (`types.ts:282-292`) already carries an optional
   `confidence` field whose own doc comment says it exists specifically for
   FA-sourced tokens (*"only `faBoundaryTypes.ts`'s
   `faWordSpansToTranscriptTokens` reshape does [set it], and that reshape
   has no live caller yet"*, `types.ts:289-290`) — the shape already exists
   and is already earmarked for this purpose. No new type needed, only a new
   field to hold an array of the existing type.
2. `Project.transcriptTokens?: TranscriptToken[]` (`types.ts:320`) is the
   direct precedent: Whisper's own per-word output already lives as one
   flat, project-level array, not attached per-segment. FA output should
   mirror it (arguably `faWordTimings` should be named/shaped as a sibling
   of `transcriptTokens`, distinguished by which array it's in rather than a
   new per-token `source` discriminant — avoids a schema-wide ripple).
3. Words don't naturally partition into segments at the schema layer — a
   segment's association with a word range is a function of absolute time
   containment, computed on demand, not a static assignment. This exactly
   mirrors `HeadingOverlay` (`types.ts:267-280`), which CLAUDE.md's
   Invariants section already describes as "composited on top of whichever
   segment(s) fall within its time range at render/export time" rather than
   stored per-segment. Attaching word timings per-segment would additionally
   require every drag-cascade/lock/re-sync path to maintain a new
   per-segment invariant (which words "belong" to a resized/relocked
   segment) that a flat, time-keyed array sidesteps entirely.

**Serialized size estimate, 709s/173-segment corpus, real word count.** The
D11 windowed-alignment measurement on this exact corpus recorded
`words=1616` (`docs/ws1-sync-pipeline/measurements/d11-chunked-alignment-2026-08-13.md:129`:
`full_length_709s_windowed_sanity: wall_clock=132.1s chunks_ok=95/97
chunks_failed=2 words=1616 audio_duration=709.01s`). A `TranscriptToken` JSON
object (`{"startSec":123.456,"endSec":123.789,"text":"word","confidence":0.987}`)
runs ~70-90 bytes depending on word length and decimal precision; at 1616
words that's **≈115-145 KB** of additional JSON for this corpus's full word
array, plus negligible array-structure overhead (~1.6 KB of commas/brackets).
For context, this sits well inside a single `localStorage` key's typical
5-10 MB browser quota and is small relative to what a 173-segment
`project.segments` array plus its `syncLog`/`syncRunSummaries` history
already costs in the same JSON blob — not a sizing concern on its own.

---

## B2 — History

**Snapshot, not deep-copy, and by reference.** `history.ts`'s own header
(`history.ts:9-32`) states this as the module's core design: *"an entry
holds the very `Project` object that was committed... segment objects
inside it are shared with every other entry that did not change them...
This is load-bearing."* Measured cost at the ruled depth of 20
(`history.ts:16-19`): **0.07 MB** real retained heap for the largest corpus
project (444 segments) under structural sharing, versus **20.71 MB** for a
naive `structuredClone` per entry, versus **12.18 MB** for the pathological
case of 20 consecutive Apply-Sync commits (each producing a genuinely new
object graph).

**Memory cost of N undo entries carrying word timings, and whether to
exclude them.** Because `faWordTimings` (per B1) would be a project-level
array set once per Apply-Sync/FA run and left untouched by every
unrelated edit (drag, lock, overlay change, etc.), the *same* structural-
sharing mechanism that gets the existing 20-snapshot cost down to 0.07 MB
applies to it automatically and for free: any history entry that doesn't
itself re-run FA shares the *same* `faWordTimings` array reference as its
neighbor, at zero incremental cost, exactly like an untouched segment
object today. The only entries that pay a real cost are ones that set a
genuinely new array — worst case, mirroring the doc's own stated
pathological scenario (20 consecutive Apply-Sync commits), is **≈20 × the
per-run array size** — at the B1 estimate (~130 KB for the 709s corpus),
that's **≈2.6 MB**, comfortably inside the existing pathological-case
budget the design doc already accepted (12.18 MB for a full-project
`structuredClone`, a strictly larger number).

**Recommendation: do not exclude word timings from history, and do not
store them by reference outside the snapshot.** Special-casing one field to
live outside the `Project` snapshot would break the module's own explicit
invariant that `history.ts` treats `Project` as "an opaque value type" (
`history.ts:10`) and would reopen the snapshot-vs-patch tradeoff the design
doc already ruled on (`history.ts:15-23`) for one field, inconsistently
with every other field. The existing architecture already handles this
case correctly and cheaply by construction — attach the field to `Project`
per B1's recommendation and let it ride inside snapshots exactly like every
other field does.

---

## B3 — Golden Replay

**Two different "golden replay" surfaces exist — neither serializes the
full `Project` structure, so a new field is safe by construction, PROVIDED
nothing yet writes it into the diffed surface.**

1. **`scripts/phase4-handoff-replay-sync.test.ts`** (the CSV-baseline
   harness CLAUDE.md's Testing invariant names) does not serialize
   `Project` at all. It re-runs the real pipeline functions
   (`parseProjectData`, `alignScenestoTranscript`,
   `applyAnchorBasedTiming`, `snapCoveredBoundaries`, etc. — imports at
   `phase4-handoff-replay-sync.test.ts:33-38`) and diffs only per-segment
   `start/duration/end` (to `1e-9`) plus `tag/text/order` against
   `scripts/fixtures/phase4-baseline-<key>-segments.csv`, and a separate
   skip set against `-skipped.csv` (per that file's own header comment,
   `phase4-handoff-replay-sync.test.ts:20-25`). It never touches
   `TranscriptToken`/word-level output as a stored field on `Project` at
   all. **Verified**: ran it after B1's proposed field would exist
   nowhere in the write path (Track A landed only the gate, no writer) —
   6/6 passed, byte-identical to baseline, confirming a project-level
   schema *addition* with no live writer is invisible to this harness.
2. **The six `fa-e2e-alignment-*.json` fixtures** (`scripts/fixtures/`,
   consumed by `src-tauri/src/fa_onnx.rs`'s `e2e_parity` module,
   `fa_onnx.rs:3019-3157`+) are lower-level still: each is one short
   single-sentence utterance (`input_samples`, `target_token_ids`,
   `blank_id`, `expected_spans` — verified fixture key list directly) that
   the Rust test forced-aligns via the real ONNX forward pass + Viterbi +
   `merge_tokens`, diffing `expected_spans` to `1e-9`
   (`fa_onnx.rs:3041,3149-3156`). This is a single-utterance numeric parity
   test with no `Project`, no JSON project schema, and no TS-side
   serialization involved at all — see B5 for why this also means R.5
   wildcard insertion can't collide with it.

**If a future slice actually wires `faWordTimings` into the Apply-Sync
commit path** (i.e., a real writer, not just the schema field), the
phase4-handoff-replay-sync harness would still stay byte-identical UNLESS
that slice also changes what it diffs — the harness only asserts on
segment `start/duration/end/tag/text/order`, and adding a sibling
project-level array doesn't touch any of those fields. **No regeneration is
needed now, and none would be needed later either**, unless the harness
itself is deliberately extended to assert on word timings too — a decision
for whichever slice adds the real writer, not this one.

---

## B4 — R.7 Non-Vacuity

`CONF_MIN = 0.3` (`syncConstants.ts:536`) has zero consumers today
(confirmed by grep, matches `task5-integration-scope.md`'s §2 finding). The
real-audio confidence values captured so far all land in **[0.730, 1.0]**
(D9's exponentiation finding across six real-audio fixtures, per
`task5-slice-ledger.md:40`'s commit-message sanity check) — well above
`CONF_MIN`, meaning **no real audio in the current fixture corpus has ever
produced a sub-threshold word**, and there's no guarantee clean, real
recorded speech ever will; CTC confidence tends to be high on any audio the
model can parse at all, and low-confidence cases are more a property of
corrupted/mismatched/silent input than of ordinary speech variation.

**Design (not built): test the R.7 fallback as a pure function on a
hand-fabricated confidence value, not by hunting for or synthesizing real
degraded audio.** The gating check R.7 describes ("FA per-word confidence
below `CONF_MIN`... on a run's first or last word → do not use that word as
a boundary; fall back to the run's own anchor",
`sync-pipeline-v2-plan.md:1521-1533`, quoted in
`task5-integration-scope.md:98-100`) operates on an already-computed
`confidence` value — it's a comparison, not a re-run of the model. This
mirrors how `R-O`'s admissibility test (`project-state.md`'s Rulings In
Force) and other pure gate functions in this codebase are already tested:
construct a `TranscriptToken`/`FaWordSpan`-shaped fixture with
`confidence: 0.1` (or any value `< CONF_MIN`) directly in the test, run it
through the new R.7 gating function once it's built, and assert the
fallback fires (word rejected as a boundary, run's own anchor used
instead) plus that the emitted structural finding (R.7's own contract)
matches. This needs no ONNX inference, no adversarial audio, and no
guessing at what synthetic waveform might coax a sub-0.3 score out of the
model — it tests the boundary-decision logic in isolation from the model
that produces its input, exactly as `CONF_MIN`'s own zero-consumer status
today suggests: the gap is entirely in the consuming logic, not in
producing a low-confidence sample to feed it.

If a slice specifically wants to prove the *model* can emit a sub-threshold
score on real audio (a different, weaker claim than "the fallback logic is
correct"), the honest way to try is intentionally mismatched input — feed
`forced_align` a `target_token_ids` sequence for different words than the
audio actually contains, or truncate/replace a word's frame span with
silence before alignment — but this is a model-behavior probe, not a
substitute for the pure-function fallback test above, which should be
built regardless of whether such a probe ever succeeds.

---

## B5 — R.5 Fixture Collision

**Wildcard insertion can be fully additive and opt-in — the six
`fa-e2e-alignment-*.json` fixtures cannot collide with it, because they
never exercise the code path R.5 lives in.** R.5 ("Between consecutive
segments inside a run, insert a CTC wildcard...",
`sync-pipeline-v2-plan.md:1485-1489`) is a **run-construction** concern —
it operates on how multiple segments' target-token sequences get grouped
and joined across a windowed run, which is `faChunkPlan.ts`'s TS-side
concern (`faChunkPlan.ts:47`'s own "raw, unpadded" chunk-construction
comment; confirmed R.5 has no implementation anywhere in the Rust or TS FA
surface today, `task5-slice-ledger.md:374`, "Deliberately deferred").

The six `e2e_parity` fixtures, by contrast, are **single-utterance,
single-target-sequence** numeric parity fixtures (`_provenance.text`:
e.g. *"Your mother does not look up."* — one sentence, one
`target_token_ids` array, verified directly) run through `forced_align`
`merge_tokens` directly (`fa_onnx.rs:3132-3134`) with **no run/segment
grouping, no chunk plan, and no wildcard-insertion point anywhere in that
code path.** Wherever R.5 eventually gets implemented (`faChunkPlan.ts`'s
run construction, or wherever the multi-segment target sequence gets
assembled before being handed to `forced_align`), it operates strictly
*above* the layer these six fixtures test — they'd still call the same
`forced_align`/`merge_tokens` functions with the same single-sentence
target sequence they use today, untouched by anything upstream deciding
whether/where to splice in a wildcard token for a *different*, multi-
segment scenario.

**Conclusion: no constraint needs lifting and no fixture needs
regenerating.** R.5 can ship as new code in `faChunkPlan.ts` (or wherever
the run-level target sequence gets built) with zero risk to these six
fixtures' byte-identity, because they sit at a lower, single-utterance
layer that R.5 never reaches.

---

## B6 — Recommended Slice Order, D18 Onward

Grounded in B1-B5's findings: several items here have **no dependency on
production wiring** and can proceed immediately; the wiring itself remains
the long pole per the original `task5-integration-scope.md` §4 order (which
this doesn't replace, only extends with the D1-required items ahead of it).

1. **D18 — Schema field.** Add `Project.faWordTimings?: TranscriptToken[]`
   (B1). Purely additive, no writer yet (mirrors the `headings` precedent —
   no migration/version-check work needed). Re-run
   `phase4-handoff-replay-sync.test.ts` to reconfirm it stays invisible to
   that harness (B3) — cheap, and worth doing at the moment the field lands
   rather than assuming.
2. **D19 — R.7 CONF_MIN fallback, pure function + synthetic test.** Build
   the gating function and its fixture-based unit test (B4). Independent of
   chunking/windowing/production wiring — can land in parallel with D18.
3. **D20 — R.2 padding in `faChunkPlan.ts`.** Per the original memo's own
   step 2 (`task5-integration-scope.md` §4) — still the right next windowing
   step regardless of D1's answer, needs no production wiring, testable
   against existing real-corpus fixtures. Re-run the D11-D16 real-corpus
   agreement measurements after, per that memo's own caveat (padding
   changes chunk audio content).
4. **D21 — R.5 wildcard-destination owner ruling, then implementation.**
   Per the original memo's step 3 — a decision first (which segment
   absorbs the wildcard gap, `sync-pipeline-v2-plan.md:1499`'s own flagged
   open question), then code. Confirmed fixture-safe by B5 — no reason to
   delay past D20 for fixture-risk reasons; sequenced after D20 because
   `task5-integration-scope.md` §4 already reasoned padding should land
   before wildcard/R.7-R.9 work generally.
5. **D22 — Capability-gated production wiring** (durable audio path +
   production-side `AppHandle` coverage, the single largest remaining
   engineering slice per the original memo's §3 rows 2-3). Everything
   above is either independent of this or a prerequisite for it mattering
   in production — this is unchanged from the original memo's step 4 and
   remains the long pole.
6. **D23 — Wire Apply-Sync to actually populate and persist
   `faWordTimings`** behind the (already-built, D17) Settings gate, now
   that D18-D22 exist to support a real value. This is the first slice
   where B2's history-memory estimate and B3's "no regeneration needed
   *unless* a writer lands" caveat become load-bearing in practice — budget
   time in this slice specifically to re-verify golden-replay byte-identity
   for real (not just re-confirm the field is dormant) and to spot-check
   undo/redo behavior across a real Apply-Sync-with-FA commit.
7. **D24 — R-H judgement.** Only possible after D22/D23 land, by
   construction (unchanged from the original memo).

Steps 1-4 (D18-D21) have no ordering dependency on each other beyond D20
before D21 as reasoned above, and none of them block or are blocked by D22
— they can run in whatever order is convenient, matching the original
memo's own observation that its steps 2-3 "can run in parallel with step 1
sitting open."
