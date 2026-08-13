# WS1 Task 5, Slice D18 — index-keyed word-timing schema

> Filename date note (Step 6, below): the task brief this slice was run
> against asserted "current date is 2026-08-13." Independently verified
> against an external network time source (not this machine's own clock) —
> see Step 6 — the true date at time of writing is **2026-08-14 local
> (PKT, UTC+5)**, matching every other commit and doc filename in this
> repo's own history, which is why this file keeps that date rather than
> being backdated.

## Step 0 — D17 committed and pushed

Committed `6e3293c` ("feat(fa): capability + toggle gate, inert and OFF by
default"), pushed to `origin/main`. Verified immediately before commit:
`tsc --noEmit` clean, full suite 1930/1930 passing (78 files, 1 pre-existing
skip), golden replay 6/6. `isFaGateOpen`/`faGate.ts` has no caller anywhere
in `src/` outside `faGate.ts`/`faGate.test.ts`/`ProjectSettingsModal.tsx`
(confirmed by grep before commit) — the gate is inert.

## Step 1 — index trace (read-only)

**(a) Does `FaWordSpan` carry an index?** No, before this slice.
`src-tauri/src/fa.rs:254-259` (pre-D18):
```rust
pub struct FaWordSpan {
    pub word: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub confidence: f32,
}
```

**(b) Does `TranscriptToken`?** No, before this slice.
`src/types.ts:282-292` (pre-D18):
```ts
export interface TranscriptToken {
  startSec: number;
  endSec: number;
  text: string;
  confidence?: number;
}
```

**(c) Where exactly is the index dropped?**

The word ORDER is available at multiple points upstream, but no explicit
index survives any of them:

1. `src-tauri/src/fa_onnx.rs:570` (`merge_char_spans_to_words`) produces
   `Vec<WordSpan>` purely by walking `char_spans` left-to-right and
   splitting on the vocab's word-delimiter token — the Vec's own order
   already IS the chunk's word order, but nothing tags each `WordSpan` with
   that position (`WordSpan` itself, `fa_onnx.rs:546-551`: `text`,
   `start_seconds`, `end_seconds`, `score` — no index field).
2. `src-tauri/src/fa_onnx.rs:798-837` (`align_chunked`) accumulates every
   chunk's words, in chunk order, into one flat `all_words: Vec<WordSpan>`
   — so by the time this function returns, the FULL run's word order is
   exactly the script's own word order (chunk N's words always precede
   chunk N+1's). This ordering survives intact.
3. **`src-tauri/src/fa.rs:476` (pre-D18) — the exact drop point:**
   ```rust
   let words: Vec<FaWordSpan> = word_spans.into_iter().map(word_span_to_dto).collect();
   ```
   This converts the already-ordered, already-complete `Vec<WordSpan>` into
   `Vec<FaWordSpan>` with a bare `.map()` — no `.enumerate()`. The Vec's own
   position (i.e., the index) is available for free at this exact line and
   is simply never captured. This is the "intended finding" the task brief
   named in advance, confirmed by inspection, not assumption: **the index
   is available at the last point before the DTO conversion and is
   discarded exactly there.**
4. On the TS side, a second, independent drop exists at
   `src/services/faChunkPlan.ts:180-209` (`runsToChunks`): `computeRunContext`
   (lines 97-138) computes `RawScriptToken{ text, qiStart, qiEnd }` — an
   explicit per-raw-token absolute script-word index range — but
   `runsToChunks` never reads it back out; `FaChunk` (`faChunkPlan.ts:51-55`)
   is just `{ startSec, endSec, text: string }`, a flattened joined string.
   The module's own doc comment (`faChunkPlan.ts:38-39`) already says this
   explicitly: *"This module never reads `qi` back out for chunk text —
   only `computeFaAnchors`'s `runs[]` ... is consumed downstream."* This
   drop point was **not** touched this slice (`faChunkPlan.ts` is outside
   the D18 CONSTRAINTS' protected-file list but also outside its stated
   scope — Step 2 only asked to carry the index from `FaWordSpan` onward).

**Is anything downstream already relying on time-based membership instead?**
Yes — this is exactly what the whole slice exists to head off.
`faBoundaryTypes.ts`'s `faWordSpansToTranscriptTokens` (pre-D18) reshapes
`FaWordSpan[]` into `TranscriptToken[]` using only `startSec`/`endSec`/
`text`/`confidence` — the only join key any future consumer of persisted
word timings would have had was TIME, exactly the fragile key the task
brief warned against (timestamps can legitimately overlap/reorder across a
seam in ways a script-word index cannot).

**Caveat carried forward, not solved this slice:** the GLOBAL index
`fa_align` now assigns (Step 2) is the FA run's own word-emission order.
It is intended to equal the script's `queryWords` index space
(`faChunkPlan.ts`'s `computeRunContext`), but that equivalence depends on
chunk-text word-count parity between the RAW whitespace-split text
`runsToChunks` sends to Rust and the NORMALIZED `queryWords` count
`computeRunContext` computes — a distinct, pre-existing risk in
`faChunkPlan.ts`'s own design, not introduced by this slice, and not
verified here (out of Step 2's stated scope: "Add a script-word index to
`FaWordSpan`... this is the join key"). Flagged for whichever slice
attempts real `qi`-space reconciliation.

## Step 2 — carry the index (implemented, tested)

`src-tauri/src/fa.rs`:
- `FaWordSpan` gained `pub word_index: u32` (serde camelCase → `wordIndex`).
- `word_span_to_dto` now takes an explicit `word_index: u32` parameter
  (a single `WordSpan` carries no positional information of its own — only
  its caller, iterating the stitched Vec, knows where it sits).
- New `word_spans_to_dtos(Vec<WordSpan>) -> Vec<FaWordSpan>` helper —
  pulled out of `fa_align`'s Ok arm — does the `.enumerate().map(...)` at
  exactly the point Step 1 found the index was being dropped. `fa_align`
  now calls this helper instead of the bare `.map()`.

`src/services/faBoundaryTypes.ts`: `FaWordSpan` (TS mirror) gained
`wordIndex: number` (required, not optional — Rust always sets it now,
unlike `confidence`'s pre-existing optionality history on
`TranscriptToken`). `faWordSpansToTranscriptTokens` now carries it through.

`src/types.ts`: `TranscriptToken` gained `wordIndex?: number` — optional and
additive, same convention `confidence?: number` already established;
Whisper-sourced tokens never set it.

**Unit tests added** (all passing):
- Rust, `src-tauri/src/fa.rs` (feature-gated `fa-inference`, 3 new tests):
  `word_spans_to_dtos_indices_monotonic_and_no_duplicates`,
  `word_spans_to_dtos_index_resolves_to_expected_script_word`,
  `word_spans_to_dtos_index_survives_chunked_path_across_seams` (the last
  explicitly simulates `align_chunked`'s own two-chunk concatenation and
  asserts chunk 2's first word gets index 2, not 0 — the literal "survives
  the seam" requirement).
- TS, `src/services/faBoundaryTypes.test.ts` (2 new tests): `wordIndex`
  passes through unchanged, and is never re-derived from array position
  (a stitched slice starting at index 42 stays 42, not 0).

**Test results:**
- `cargo test --lib` (default, no `fa-inference`): 63 passed, 0 failed.
- `cargo test --lib --features fa-inference`: 129 passed, 0 failed, 13
  ignored (pre-existing, unrelated to this slice).
- `npm run lint` (`tsc --noEmit`): clean.
- `npm test`: 79 files, 1938 passed, 1 skipped (pre-existing skip) — up
  from 1930/1930 before this slice's new tests.

## Step 3 — schema, minimal

`src/types.ts`'s `Project` gained one optional field:
```ts
faWordTimings?: TranscriptToken[];
```
Reuses `TranscriptToken`'s shape rather than a parallel type — every entry
a future FA production writer produces will have both `wordIndex` and
`confidence` set (unlike `Project.transcriptTokens`, Whisper's own output,
which never sets either). No production path writes it this slice —
confirmed by grep (`faWordTimings` appears only in `types.ts` and the new
Step 4 test file).

**Migration status, stated plainly:** `version` is **not** read or branched
on for this field, and in fact there is no `version` concept on `Project`
at all to read — `StoredProject.version: 2` (`projectStore.ts:23`) lives on
the storage ENVELOPE, is a hardcoded literal at write time, and
`loadProject` never inspects it before reading `stored.project`. Migration
for every other optional `Project` field already follows the same
convention this field now also uses: absence is read as "not present yet"
(e.g. `{ headings: [], ...stored.project }`, `projectStore.ts:82`) — no
field-specific migration code exists or is needed for an additive optional
field, since `JSON.parse` on an object missing a key simply leaves it
`undefined`. **Named prerequisite for the first slice that writes real
data:** none, specifically because of the above — no migration path needs
building before a real writer lands, since the field's mere absence on an
old project is already the correct, zero-code "no FA word timings" state.

## Step 4 — replay, for real (populated, not merely present) — HEADLINE

Populated `faWordTimings` with the REAL, already-committed 1645-word MMS-FA
capture for the 173-segment/709.01s corpus
(`scripts/fixtures/phase4-fa-tokens-173.json`, WS1 Task 5's own R-H
fixture) — chosen over a hand-rolled synthetic array because it is grounded
in a real corpus at real scale (1645 entries, larger than and consistent
with the task brief's "~1,616" estimate), not a guess. New test file:
`src/services/faWordTimingsSchema.test.ts` (6 tests, all passing):

- the fixture is confirmed to be 1645 entries, `wordIndex` monotonic/gapless
  0..1644, every entry carries `confidence`/`text`/valid time range;
- a `Project` carrying this 1645-entry array survives a REAL
  `saveProject`/`loadProject` round trip (real jsdom `localStorage`,
  real `JSON.stringify`/`JSON.parse`) with `faWordTimings` deep-equal to
  the original and every other field (`segments`, `name`,
  `globalOverlayConfig`) unperturbed;
- plain `JSON.parse(JSON.stringify(...))` round-trips the array with no
  precision loss or reordering;
- a `Project` WITHOUT the field still round-trips identically (confirms
  the field stays fully optional, not silently required once used once).

**Byte-identity result, with the field POPULATED at full 1645-entry scale:**
- `npm run lint`: clean.
- `npm test`: 79 files, 1938 passed, 1 skipped.
- Golden replay (`scripts/phase4-handoff-replay-sync.test.ts`): **6/6
  passed, unchanged** — this file never constructs a `Project` at all (it
  operates on `VideoSegment[]`/`TranscriptToken[]` through the real
  pipeline functions directly), so its continuing to pass unmodified is
  itself part of the evidence that this schema addition has zero reach
  into the shipped sync pipeline, not merely a redundant check.

**Byte-identity holds.** Populating the field does not perturb the sync
pipeline's committed output, does not break persistence, and does not
silently reshape any other `Project` field.

## Step 5 — R.7 non-vacuity, redesigned (real measurement)

B4's fixture proved the branch runs; it did not prove real input reaches
it. The observed confidence floor on real, CORRECTLY matched audio is
~0.73 against `CONF_MIN=0.3` (D16 finding) — normal audio essentially never
triggers the gate. This slice ran the actual mismatched-input test the task
asked for, using the already-installed pinned stack
(`torch==2.2.2`/`torchaudio==2.2.2`/`uroman`, cached at `.venv-phase4-fa/`
from an earlier session — no new install needed) and the existing
`scripts/measure-forced-alignment.py align` harness (unmodified).

**Design:** real 173-corpus audio (`.work-phase4/replay/173/audio_16k.wav`,
709.01s, already prepared), with a **shuffled transcript** — every
segment's real committed text (`scripts/fixtures/phase4-baseline-173-segments.csv`)
cyclically rotated by `n/2` positions across segments before alignment, so
every segment is force-aligned against a real, grammatical, correct-length
English sentence that is **not its own** — the audio for segment `i` gets
segment `i + 86 (mod 172)`'s text. This is the "shuffled transcript"
variant the task brief named as an acceptable mismatch design (the
wrong-language variant was not run — flagged below as a follow-up, not
run this slice per the design-only tradeoff already resolved with the
user for the install step).

**Result — real confidence distribution, mismatched vs. matched:**

| | matched (real fa capture, n=1645) | mismatched (shuffled text, n=1596) |
|---|---|---|
| mean | 0.9358 | 0.2959 |
| median (p50) | 0.9916 | 0.2500 |
| p5 | 0.6884 | 0.0000 |
| p95 | 0.9997 | 0.8229 |
| **% below CONF_MIN (0.3)** | **1.8%** (29/1645) | **55.3%** (883/1596) |
| % below 0.5 | 2.6% | 81.7% |

(`n` differs because 4/172 segments failed alignment entirely under the
mismatched condition — see below.)

**CONF_MIN=0.3 is reachable and discriminating.** Under genuinely
mismatched input, the majority of words (55.3%) fall below the threshold,
versus 1.8% on correctly matched input — a real, large, non-vacuous signal.
This directly answers the task's fallback question ("if real mismatched
input still cannot drive scores below 0.3, say so plainly") in the
negative: it can, and does, easily. B4's fabricated-fixture gap is closed
by this measurement — R.7's gate is not testing a dead branch once real
mismatched input is used; the ownership question is no longer "is CONF_MIN
reachable" but ordinary threshold tuning (0.3 vs. some other cut) if that
is ever revisited.

**Secondary finding, not asked for but observed:** 4/172 segments
(indices 4, 9, 56, 102) failed alignment OUTRIGHT under the mismatched
condition — `"targets length is too long for CTC"` — rather than
producing a low-confidence result. Forcing unrelated (and often longer)
text into a real segment's own short audio window can make the CTC
alignment infeasible, not merely low-confidence. This is a distinct
failure mode a real R.7 design needs its own handling path for (the
Rust `fa_onnx.rs` forced-alignment call already surfaces this as an
`Err`, per `fa_onnx.rs`'s existing `InferenceFailed` mapping — not a new
gap, but worth naming explicitly for whoever designs R.7 for real).

**This is design/measurement only — no R.7 implementation landed.** No
threshold-comparison code, no gating logic, nothing wired into any
production path. The measurement outputs
(`.work-phase4/replay/173/tokens_mismatch-shuffled.json` /
`meta_mismatch-shuffled.json`) are local, gitignored artifacts (same
`.work-phase4/` convention the golden-replay harness already uses) — not
committed, per the same "don't touch `scripts/fixtures/`" constraint this
slice honored (the shuffled-segments input JSON lives in the session
scratchpad, not the repo).

**Not run this slice (named as follow-up):** the wrong-language variant
(e.g. Spanish script against English audio) — the shuffled-transcript
result already answers the reachability question unambiguously, so a
second variant was not needed to avoid the "unreachable" conclusion; it
would still be informative for characterizing R.7's failure-mode space
more fully whenever R.7 is actually designed.

## Step 6 — date check

The task brief asserted "current date is 2026-08-13" and asked for an
independent check (not this machine's own clock compared to itself).

- Local machine clock (`date`): `Fri Aug 14 01:44:16 PKT 2026`.
- **Independent external source** (an HTTP `Date` response header from
  `google.com`, i.e. a third party's server clock, not this machine's):
  `Thu, 13 Aug 2026 20:44:25 GMT` — UTC.
- `20:44 UTC + 5:00 (PKT offset) = 01:44 the next day` — the two sources
  **agree exactly** once the timezone offset is applied. This is not clock
  drift or a misconfigured machine; it is the ordinary, correct behavior of
  any UTC+5 timezone in the few hours after UTC midnight-minus-something —
  Pakistan is already into August 14 while UTC is still finishing August 13.
- **This repository's own established convention is local time, not UTC**:
  every commit in `git log` (including this session's own D17 commit,
  `6e3293c`, `2026-08-14T01:27:43+05:00`, and the immediately preceding
  D16 commit, `0219428`, `2026-08-14T00:06:30+05:00`) is stamped in local
  `+05:00` time. The existing `d17-schema-capability-design-memo-2026-08-14.md`
  filename date is consistent with the D16/D17 commits that bracket it —
  correcting it to `2026-08-13` would make it inconsistent with this
  repo's own commit history, not more correct.

**True date: 2026-08-14, local (PKT/UTC+5) — the same clock this repo's
own commit history already uses.** No file requires renaming; this memo
uses the same date for the same reason.

## Full gate table

| Gate | Status |
|---|---|
| `isFaGateOpen()` capability+toggle gate (D17) | OFF by default, inert — no caller in any production path |
| `fa-inference` Cargo feature | OFF by default (not in default feature set) |
| `fa_align`/`fa_align_dev` production wiring | None — only dev-only `__faDevAlign` (D10), unreachable from any UI control |
| `faWordSpansToTranscriptTokens` (D9 reshape) | No live caller — tests only |
| `Project.faWordTimings` (D18, this slice) | Schema only — no production writer |
| R.2 (padding) | Unimplemented |
| R.5 (wildcard destination) | Unimplemented |
| R.7 (CONF_MIN gate) | Unimplemented — measurement only this slice (Step 5) |
| IPC wiring (chunk plan → `fa_align` → UI) | None |

## Empty-diff confirmation on protected files

`git diff --stat` for each: `faAnchors.ts`, `faTextNormalize.ts`,
`syncConstants.ts`, `Cargo.lock`, `project-state.md`, `CLAUDE.md`,
`docs/history.md` — all empty. `scripts/fixtures/` and
`fa-e2e-alignment-*.json` — no modifications (read-only access to
`phase4-fa-tokens-173.json`/`phase4-baseline-173-segments.csv` for Steps 4
and 5's real-data sourcing; `git status --porcelain` for `scripts/fixtures/`
shows no changes).

## No new crates

Rust: zero new dependencies. Feature-gated `word_spans_to_dtos`/
`word_span_to_dto` changes only touch already-present `fa-onnx`-feature
code; `Cargo.lock` untouched (confirmed above). Step 5's measurement used
the already-installed `.venv-phase4-fa/` Python environment from an earlier
session — no new Python packages installed, no new pip/cargo dependency
added to this repo's own manifests.
