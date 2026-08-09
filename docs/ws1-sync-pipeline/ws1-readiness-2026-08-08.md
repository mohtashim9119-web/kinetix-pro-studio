# WS1 readiness assessment — 2026-08-08

> Written at the WS2 close-out, against `verified-baseline-2026-08-08`. **Analysis only —
> zero production code was written or changed for this document.** Its job is to answer
> whether WS1 (sync) can start cleanly now that WS2 (editor) is complete and verified, and
> to surface anything WS2 built that would get in its way.
>
> Scope note: this re-checks `docs/ws1-sync-pipeline/roadmap-2026-08-07.md` § D4's decoupling verdict against
> **current `main`**, not against the park commit it was originally measured on. Everything
> WS2 landed since — the last-segment edge lock, the duration-invariance guard, Model P's
> assertion, and undo/redo — arrived *after* D4 was written and none of it was in scope then.

---

## Verdict

~~**READY, with one defect to fix first.**~~ **FIXED, 2026-08-08, commit `1b16a50`
("fix(history): Apply Sync pushes exactly one undo entry, not two").** The finding below
(§2a) is retained verbatim as the historical record of the diagnosis — the fix routed
`App.tsx:3005`'s post-hoc boundary-quality log write through `setProjectSilent` instead of
`setProject`, with tests in `src/services/applySyncHistory.test.ts`. WS1 slice 1 is
complete; the 50/50 re-derivation (slice 2) is next.

Three of the four questions came back clean at the time. The fourth did not: **Apply Sync
was pushing TWO history entries, not one.** Pre-existing, not caused by WS1 — but it landed
squarely on the path WS1 spends all its time in, and undoing an Apply Sync is described in
the design doc as the most valuable undo in the app. Fixed as WS1's first slice, ahead of
§4's original plan (§4 itself is superseded by the actual fix, below).

| # | Question | Answer (as of this assessment) |
|---|---|---|
| 1 | Is 50/50 still cleanly decoupled from the editor path? | **YES** [MEASURED] |
| 1b | Do undo/redo, the duration-invariance guard, or the last-segment lock constrain it? | **NO** — none of the three [MEASURED] |
| 2 | Does Apply Sync push exactly one history entry? | **NO — it pushed two** [MEASURED by reading] — **FIXED 2026-08-08, `1b16a50`** |
| 2b | Do stale anchors degrade to no-scroll rather than throwing? | **YES** [ASSERTED — code reading; no test] |
| 3 | Does Model P or the duration-invariance guard block anything in WS1's scope? | **NO** [MEASURED] |

---

## 1. The 50/50 silence split is still cleanly decoupled

§ D4's verdict (2026-08-07) was measured against park commit `210855d`. Re-verified against
current `main` today, because four WS2 changes have landed since.

### 1a. The import graph is unchanged and still one-directional

`src/services/snapBoundaries.ts:212-220` — its complete import list:

```
types.ts                (VideoSegment, TranscriptToken — type-only)
silenceDetector.ts      (SilenceInterval — type-only)
whisperService.ts       (SegmentAlignment — type-only)
syncConstants.ts        (tuning constants)
```

**Zero editor-side imports.** No `dragCascade`, no `dragSession`, no `dragGeometry`, no
`timelinePartition`, no component.

Reverse direction — everything that imports `snapBoundaries` on current `main`:

| Importer | Line | Side |
|---|---|---|
| `src/App.tsx` | `104` (`snapCoveredBoundaries`) | **Sync** — used only at the Apply Sync call site, `App.tsx:2839-2840` |
| `src/services/syncContracts.ts` | `18` (`computeBoundarySearchWindow`, `boundaryUsedFallback`) | **Sync** |

Every other hit in a repo-wide grep is a **comment**, including `dragCascade.ts:188`, which
mentions `snapBoundaries.ts` only to explain that it reads the same token array. Confirmed
in the other direction too: `dragCascade.ts:51` and `timelinePartition.ts:46` each import
`../types` and nothing else.

**Conclusion:** the editor path and the boundary-placement path share *data* (segment
timings, transcript tokens) and share no *code*. D4's verdict holds unchanged.

### 1b. None of WS2's three new constraints reach it

This is the part D4 could not have assessed, since none of it existed then.

**The duration-invariance guard — does not apply.** It is `conserveTotalDuration`, an
**opt-in** field on `DragCascadeOptions` (`dragCascade.ts:114-134`), defaulting off, and it
is read at exactly one place — `dragCascade.ts:431-432`'s `conserveAtTail`. It is passed
only via the shared `DRAG_CASCADE_OPTIONS` constant (`dragCascade.ts:140`), and only by the
drag path. **Apply Sync never calls `computeDragCascade` at all**, so the guard is not
merely disabled on that path — it is not on it. This was a deliberate design choice recorded
at the time: `docs/decisions/2026-08-08-last-segment-edge.md` § 4 enumerates Apply Sync
first in its table of paths that legitimately still change total duration.

**The last-segment edge lock — does not apply.** `isDragEdgeLocked`
(`dragCascade.ts:100-108`) has exactly three call sites: `Timeline.tsx:730` (whether to
render a handle), `dragSession.ts:161` (whether to start a gesture), and
`dragDurationInvariant.test.ts`. All drag. Apply Sync is free to set the last segment's end
wherever the audio says, which is what `headExtendFirstSegment` and the tail extension
already rely on (`App.tsx:2853`).

**Undo/redo — does not constrain placement.** Restores go through `setProjectSilent`, not
`setProject`, so a traversal is not itself undoable (`App.tsx:1884-1917`). The restore path
explicitly documents that it is *not* subject to the drag guard and that a restored state
may legitimately differ in total duration — "undoing an Apply Sync is the obvious case"
(`App.tsx:1892-1896`). And the lock-block policy has an explicit carve-out for exactly this
boundary: a segment absent from the target state is **not** a conflict
(`historyLockPolicy.ts:69-84`), because Apply Sync mints a fresh id set and treating that as
a conflict "would make the most valuable undo in the app unreachable."

**One thing that would falsify this** — carried forward from D4 because it is still the
right tripwire: if a future editor feature needed to *display* or *recompute* a 50/50-style
split live during a drag (a "preview where sync would place this boundary" affordance), that
would create a genuine editor→sync dependency this analysis does not see. Nothing like it
exists today.

---

## 2. Apply Sync and the history stack — **one defect, now fixed**

### 2a. It pushed TWO entries, not one [MEASURED — by reading at the time] — **FIXED, `1b16a50`**

**This was the finding of this assessment; retained verbatim below as the diagnosis record.**

`setProject` (`App.tsx:1208-1248`) pushes a history entry whenever `next !== prev`
(`App.tsx:1228`). There is no exemption for log-only writes. Coalescing cannot absorb a
second write either: `coalesceWrite` returns `{ decision: 'push', open: null }` for any
write with no `coalesceKey` (`historyCoalesce.ts:88-92` — "discrete: never coalesced"), and
**neither Apply Sync write passes a `meta` argument at all.**

On the success path, Apply Sync makes two separate `setProject` calls:

| # | Site | What it writes |
|---|---|---|
| 1 | `App.tsx:2917` — "8. Single atomic state update" | The real commit: segments, script, assets, log entries, summary |
| 2 | `App.tsx:3005` | Post-hoc boundary-quality log entries — **`syncLog` only**, no segments |

Both push. **Result: undoing an Apply Sync costs two presses, and the first one is a
visual no-op** — it removes a sync-log entry while the timeline does not move. That is
precisely the "one gesture = one entry" invariant the coalescing design exists to uphold
(`historyCoalesce.ts`, design § 3.2).

**How often:** the second write is guarded by `if (boundaryLogEntries.length > 0)`
(`App.tsx:3004`), inside `if (pendingBoundaryCheckInput)`. Reading the branch at
`App.tsx:2995-3003`: when `resolvedWaveform` is falsy the array is built from a
non-conditional `[makeSyncLogEntry(...'Waveform unavailable — …')]`, i.e. **always exactly
one entry**. So on the waveform-unavailable path this is guaranteed, every run. With a
waveform present it fires whenever `buildGroupedViolationEntry` returns an entry.

**Why nobody caught it.** No test asserts a history depth around Apply Sync.
`history.test.ts` and `historyCoalesce.test.ts` contain no Apply Sync case (grep: zero
hits), and the only harness that counts entries end-to-end — `dragSessionHarness.test.ts`'s
`historyDepth` assertions — is drag-only. There is no App-level integration test, and this
repo has no jsdom React-hook/component testing setup for `App.tsx` (the same gap
`usePlayback.test.ts` and `useGlPreview.test.ts` already document).

**It is not WS1's fault, and it is WS1's problem.** It predates WS1 entirely. But WS1 works
almost exclusively on the Apply Sync path, will re-run it constantly, and will lean on undo
to compare before/after placements. Fix it first — see § 4.

### 2b. Stale anchors degrade to no-scroll, and do not throw [ASSERTED]

Correct, and deliberately so. `Timeline.tsx:333-356`, the anchor scroll/flash effect:

```ts
const seg = segments.find(s => s.id === historyAnchor.segmentId);
// An unresolvable anchor falls back to NO scroll and NO flash, never a throw
// — reachable across an Apply Sync boundary, where the whole id set changes.
if (!seg) return;
```

The failure mode was anticipated at the exact place it can occur. The selection state is
repaired on the same path rather than left dangling (`App.tsx:1919-1928`), and the playhead
is clamped into the restored timeline's bounds (`App.tsx:1935-1938`) so a shorter restored
timeline cannot strand it.

**Tagged [ASSERTED], not [MEASURED]:** this is code reading. Grep for `historyAnchor` across
all `*.test.ts`/`*.test.tsx` returns **zero hits** — the degradation path has no test. It is
a two-line guard whose correctness is legible on inspection, so this is a low-severity gap,
but it should not be reported as measured.

---

## 3. What Model P and the duration-invariance guard would block in WS1's scope

**Nothing. And the 50/50 rule is *more* compatible with Model P than what it replaces.**

WS1 legitimately changes total timeline duration through Apply Sync, so the question is
fair — but neither constraint is positioned to stop it.

**The duration-invariance guard is drag-only and opt-in** (§ 1b). It never sees the Apply
Sync path.

**Model P's gapless assertion is DEV-only, non-throwing, and observational.**
`App.tsx:3012+`: one `useEffect` keyed on `project.segments`, reporting the first violation
of `startTime[i] + duration[i] === startTime[i+1]` to reach committed state. It is
explicitly documented as never throwing and never mutating — "a violation here means the
timeline is already wrong, and taking the editor down on top of that helps nobody." So it
can *report* on WS1's output; it cannot block it.

Two further points in WS1's favour:

- **`audioDuration` is deliberately excluded from the assertion** (`App.tsx:3036+`), because
  the head/tail clauses settle asynchronously during hydration and Apply Sync and would fire
  false positives on legitimately mid-flight states. So WS1's own async commit sequence was
  already accounted for.
- **50/50 makes gaplessness structural rather than patched.** A fixed
  `(lastSpokenEnd + nextSpokenStart) / 2` formula cannot leave a gap by construction. The
  current silence-search-and-assign system can, which is exactly why it needed the appended
  contiguity fix documented in `CLAUDE.md`'s `snapBoundaries.ts` entry (advance
  `next.startTime` when a `MIN_SEGMENT_DURATION`-floored `curr` overruns the boundary).
  Landing 50/50 should let that safety net become redundant rather than needing a new one.

**The one real constraint is not Model P — it is the golden replay.** All three corpus
projects run through `snapCoveredBoundaries`, so a placement change moves committed
boundaries and `scripts/phase4-handoff-replay-sync.test.ts` will go from 3/3 to 0/3. **That
is the harness working**, and it is the single most useful signal WS1 has. Plan for a
deliberate, reviewed re-baseline with the per-boundary diff read and understood — never a
blind regeneration. `docs/measurements/phase4-baseline-methodology.md` is the procedure.

---

## 4. Smallest first slice

**Not the 50/50 rule.** Start with the history defect from § 2a — it is small, it is on the
path WS1 lives in, and it makes every subsequent WS1 iteration's undo behave.

### Slice 1 — make Apply Sync push exactly one history entry — **DONE, `1b16a50`**

**Change:** route the post-hoc boundary-quality log write (`App.tsx:3005`) through
`setProjectSilent` instead of `setProject`.

**Why that and not coalescing:** the write touches `syncLog` only, never `segments`. It is a
*report about* the edit, not part of it — the same category as the lock writes the DO-NOT-DO
list already routes through `setProjectSilent`. Coalescing it to the main commit would work
but would misuse a mechanism built for gestures, and would still leave the entry's stored
state subtly wrong.

**Watch for:** `logSyncAbort` (`App.tsx:2535`) makes a third `setProject`. It is *mutually
exclusive* with the main commit — every abort path returns before it — so it is one entry
per run, not a third. It is arguably also a report-not-an-edit and could take the same
treatment; check whether an aborted sync should be undoable at all before changing it. That
question is worth asking but is not part of this slice.

**Test-count delta: +3 to +5.** Realistically: one asserting a log-only write pushes no
entry, one asserting the main commit pushes exactly one, one asserting a stale anchor across
an id-set change is a no-op rather than a throw (closing § 2b's gap while the area is open).
These need a seam-level test rather than a full App render — the pure `history.ts` /
`historyCoalesce.ts` modules can carry most of it.

**Gate:** golden replay must stay **3/3 byte-identical** — this slice touches no timing code,
so any movement means something unintended happened. Manual U1–U16 spot-check on undo depth
after an Apply Sync.

### Slice 2 — then the 50/50 re-derivation

Per D4: `snapBoundaries.ts` (319 changed lines in the park diff) plus ~25–30 lines of
Apply-Sync plumbing in `App.tsx`. Needs re-derivation against current `main` — the park
commit `210855d` predates K17 and everything after it. **Expect the golden replay to break
deliberately**, and budget the per-boundary review as part of the work rather than as a
follow-up.

---

## Files cited

| File | Lines | For |
|---|---|---|
| `src/services/snapBoundaries.ts` | 212-220 | Import list — decoupling |
| `src/App.tsx` | 104, 2839-2840, 2853 | Apply Sync call site |
| `src/App.tsx` | 1208-1248 | `setProject` wrapper, history capture |
| `src/App.tsx` | 2535, 2917, 3005 | The three Apply Sync `setProject` sites |
| `src/App.tsx` | 2995-3004 | Boundary-log entry construction |
| `src/App.tsx` | 1884-1938 | Restore path, guard exemption, selection/playhead repair |
| `src/App.tsx` | 3012+ | Model P DEV assertion |
| `src/services/dragCascade.ts` | 100-108, 114-134, 140, 431-432 | Edge lock + conservation opt-in |
| `src/services/historyCoalesce.ts` | 88-92 | Discrete writes always push |
| `src/services/historyLockPolicy.ts` | 69-84 | Apply Sync boundary carve-out |
| `src/components/Timeline.tsx` | 333-356, 730 | Anchor degradation; handle affordance |
| `src/services/dragSession.ts` | 161 | Gesture refusal |
