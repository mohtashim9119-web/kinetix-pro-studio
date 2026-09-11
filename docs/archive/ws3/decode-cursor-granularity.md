# WS3 — decode-cursor granularity: the per-asset fix is refuted, measured

Scope: `exportWorker.ts`, `decodeCursorLifetime.ts`, `videoDemuxer.ts`,
`exportPipelineWebCodecs.ts`. Branch `ws3-export-liveness-occlusion`.

## 1. Per-segment cursor granularity — confirmed

Cursors are keyed by **segment id**, not asset id:

- `exportWorker.ts:599` — `let cursor = this.cursors.get(seg.id);`
- `exportWorker.ts:611` — `this.cursors.open(seg.id, cursor);`
- `decodeCursorLifetime.ts:187` — release resolves the key as a segment:
  `const seg = segments.find((s) => s.id === id);`

Measured on a 332-segment / 4-unique-asset timeline (`probeFrameLoopCursorPeak`,
0.4s segments, 30fps): **`cursorsCreated: 332`, `peakOpenCursors: 2`**, identical
with no transition and with `cross-dissolve` 0.2s on every boundary.

## 2. The proposed per-asset change is refuted — twice, independently

### (a) Release timing cannot change the open count

The playhead is strictly monotone and each segment occupies one contiguous
interval, so a segment-keyed cursor is opened **exactly once** whenever it is
released. 332 opens across 332 segments = zero reopens. There is no reopen for a
later release to prevent. Moving release from per-segment to per-asset cannot
lower 332 by one.

The audit's premise ("opens 332 cursors instead of 4") is correct as a *count*
and wrong as a *diagnosis*: the count is 332 because there are 332 distinct trim
ranges, not because release fires early. The Round 6 release fix did not cause it.

### (b) `assetLastNeededSecByAsset` does not fit, measured

It exists (`decodeCursorLifetime.ts:85`) and is already used for the demux/bitmap
caches. For cursors it is inert. Measured per-asset last-needed on the 332/4
timeline (run length 132.8s):

| asset | last needed (s) |
|---|---|
| a0 | 131.600 |
| a1 | 132.000 |
| a2 | 132.400 |
| a3 | 132.800 |

Assets are cycled, so each one's final referencing segment sits in the last four
segments of the run. Per-asset release therefore releases **nothing** until the
run is over, while raising simultaneous open cursors from 2 to 4 (one per unique
asset — i.e. bounded by asset count, not by 2). Strictly worse: same 332 opens,
double the resident decoders and frame queues.

### (c) Asset-keyed cursor IDENTITY is unsound

A `DecodeCursor` wraps one `decodeSegmentFrames(url, start, end)` generator over
**one segment's** source range (`exportWorker.ts:340`, `sourceRange`), and
`frameAt` is forward-only — it advances with `gen.next()` and has no rewind of
any kind. An asset-keyed cursor is therefore only sound if consecutive segments
sharing an asset also read its *source* forward.

They do not. Every segment in the field fixture is authored `trimStart: 0`
(`src/dev/exportLivenessProbe/generatePartCFixture.ts:125,186`), so each reuse
restarts the same source range at zero. Segment i+1 needs frames the shared
generator has already yielded and cannot produce again.

This precondition is now a named, tested predicate:
`assetSourceTimeIsMonotone` (`decodeCursorLifetime.ts`), which returns **false**
for the field shape and true for a genuinely forward-reading timeline.

### (d) Measured cost of shipping it anyway

Destructive probe B re-keyed the registry by `assetId` — literally the proposed
change — and ran the same walk:

```
cursorsCreated: 332  ->  3952     (11.9x WORSE)
```

Cause: with an asset key, `releaseStale`'s `segments.find(s => s.id === id)`
misses (an assetId is not a segment id), the cursor is judged stale and closed
**every tick**, then reopened next tick. The change converts 332 one-time opens
into a per-frame open/close storm on the very release path it was meant to fix.

**Recommendation: do not ship the per-asset cursor change.** Invariant unchanged:
`MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS = 2`, still enforced, still safe (release
is exclusive-end and matches `deriveSlotPlan`, so no later frame can read a
released cursor — locked by the peak-bound test).

## 3. Before / after, and decode actually saved

| | cursors opened | peak open | decode saved |
|---|---|---|---|
| before (per-segment) | 332 | 2 | — |
| after per-asset *release* | 332 | 4 | **zero** |
| after per-asset *identity* (probe B) | 3952 | 4 | strongly negative |
| **shipped (unchanged)** | **332** | **2** | **n/a** |

The "~5k-20k wasted frames" estimate does not survive contact with the trims.
With `trimStart: 0` the keyframe at source 0 *is* the range start, so GOP preroll
is ~0 frames per open, not ~2s. The real per-open cost is a `VideoDecoder`
configure plus re-decoding the same opening 0.4s of the same 4 files 332 times.
Demux fetch+parse is not repeated — it is cached per URL within the piece.

## 4. Demux: worker-per-piece confirmed; release needs no fix

`driveGlRun` constructs a fresh `Worker` per GL piece
(`exportPipelineWebCodecs.ts:834`) and `terminate()`s it
(`exportPipelineWebCodecs.ts:1022`). `demuxCache` is module state
(`videoDemuxer.ts:53`), so it dies with the worker — the per-piece reset is
deliberate and documented (`exportPipelineWebCodecs.ts:427`).

`videoDemuxer.ts` itself spawns **no** Worker; it is in-realm mp4box.

Fetch+parse cycles = pieces x assets touched per piece. The cap is
`MAX_ENCODER_SESSION_FRAMES = 1800` (60s @30fps), and `isLegalPieceBoundary`
refuses to cut where a transition straddles the boundary. So:

- **Field shape** (transition on every boundary, e.g. Part C): *no* legal
  boundary anywhere -> **1 piece -> 4 fetch+parse**, not 16.
- Transition-free 332x0.4s (3984 frames): 3 pieces -> 12 fetch+parse.

The "~16" figure assumes 4 pieces and does not arise at this cap.

**Can a released demuxer be needed again? No.** `assetLastNeededSec` is the
**max** over every referencing segment in the piece, and the playhead is
monotone, so once it is passed no segment in that piece reads the asset again —
including the incoming-lookahead case, since the incoming segment's own
last-needed time is later still. Across pieces it is moot: a new worker starts
with an empty cache. And per `videoDemuxer.ts:206`'s contract a released URL is
not poisoned — `getOrCreateDemux` re-demuxes — so release is a memory decision,
never a correctness one. **No fix and no conditional needed.**

Reducing the cross-piece re-parse would mean reusing one worker across pieces,
which deliberately trades away the "piece boundary resets every accumulator"
property that the encoder-session bound and failure attribution rely on. Flagged,
not taken unilaterally.

## 5. Frame-loop sub-timers

Five buckets now partition the tick (no double-counting; `resolveSlotSource`
books its own time and the GL upload after it is charged to `composite`):

| bucket | covers | scales with |
|---|---|---|
| `cursor-open` | first touch: generator ctor, demux lookup, decoder configure, GOP preroll, first frame | **segment count** |
| `decode-wait` | steady-state `frameAt` on an already-open cursor | frame count |
| `composite` | `uploadSlot` x2 + `renderFrame` + text pass | frame count |
| `encode-submit` | `VideoFrame` ctor, content digest, `encoder.encode` submit | frame count |
| `wait-dequeue` | backpressure wait (pre-existing) | encoder throughput |

`cursor-open` vs `decode-wait` is the split that answers the question this task
was really asking — whether per-segment cursor granularity costs real time on a
field run. It is measurable now instead of estimated.

Cheap by construction: `ExportPhaseTracker.add` accumulates into a `Map` and
posts **nothing** (locked by a test; probe C made `add` post and it went red).
Ten `performance.now()` calls per frame; the tracker self-measures its own
overhead into `instrumentationMs`.

## 6. Tests and destructive probes

`src/services/webcodecsExport/decodeCursorGranularity.test.ts` (4 tests) —
locks the **true** invariant. The task asked for a test asserting
"cursors opened equals unique assets"; that assertion is false (measured 332 vs
4), so what is locked instead is the real relation plus the two reasons the
asset target is unreachable.

Probes (each run, confirmed red, reverted):

| probe | mutation | result |
|---|---|---|
| A | `releaseStale` returns early (no release) | RED — peak-open bound |
| B | registry keyed by `assetId` | RED — `expected 3952 to be 332` |
| C | `tracker.add` posts a token | RED — cheapness test |

Every assertion added here has measured reach.
