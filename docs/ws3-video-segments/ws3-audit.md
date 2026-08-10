# WS3 Audit — Video Segments, 5 Open Tasks

> Read-only investigation, 2026-08-09. No code changed. Companion to
> `docs/ws3-video-segments/video-segment-investigation.md` (§2/§3 already cover
> tasks 1 and 2 in depth — this document re-verifies those against current
> `main`, then covers tasks 3–5, which the investigation doc does not touch,
> plus the four cross-cutting questions `docs/work-in-progress.md` asked for.

---

## Task 1 — `duration` ↔ `playbackSpeed` coupling on a video-segment drag

**Mechanism, re-verified against current `main`.** `resolveDragEdge`
(`src/services/dragGeometry.ts:209-248`) computes `duration`/`trimStart` for
the dragged edge first (209-223), then, gated on `isVideo && srcDur > 0`
(226-227), does two separable things (227-237):

```
clipLen = (segment.trimEnd ?? srcDur) - trimStart
(a) duration      = clamp(duration, clipLen/MAX_PLAYBACK_SPEED, clipLen/MIN_PLAYBACK_SPEED)
(b) playbackSpeed  = clamp(clipLen / duration, MIN_PLAYBACK_SPEED, MAX_PLAYBACK_SPEED)
```

`MIN_PLAYBACK_SPEED = 0.5`, `MAX_PLAYBACK_SPEED = 2.0` (`dragGeometry.ts:68-69`).
This confirms the investigation doc's §2 mechanism exactly — nothing about it
has changed.

**Where speed gets written during a drag.** `dragSession.ts`'s `handleUp`
(`dragSession.ts:551-561`) calls `resolveDragEdge` once at commit and builds
`speedUpdate = final.playbackSpeed === undefined ? undefined : {
playbackSpeed: final.playbackSpeed }`, forwarded into `commitDurationChange` →
`computeDragCascade`. The live-preview path (`resolveDragPreview`, same file)
calls the identical function per frame so the on-screen card already shows the
re-timed speed before release — commit and preview cannot disagree (this is
the K17 guarantee the file's header exists to protect).

**What reads `playbackSpeed` afterwards — confirmed by grep, one file at a time:**
- `PreviewStage.tsx:934,941,1047` — legacy `<video>` path: `activeEl.playbackRate = segment.playbackSpeed * globalPlaybackSpeed`, and `toSourceTime`-equivalent inline math for the transition-blend read.
- `useWebCodecsPreview.ts:131,141` (`toSourceTime`/`sourceRange`) — maps segment-local time to source time using `segment.playbackSpeed || 1`.
- `useGlPreview.ts` does **not** read `playbackSpeed` directly — it imports and reuses `useWebCodecsPreview.ts`'s own `toSourceTime` (`useGlPreview.ts:63,303,367`), so the WebGL2 preview inherits the same speed-mapping through that one shared function, not a second copy.
- `Timeline.tsx:664,779-781` — passes `playbackSpeed` into `computeSlipBarGeometry` (affects the drawer's slip-bar width) and renders a `{speed}x` badge on the card when `≠ 1`.
- **Legacy export**: `frameRenderer.ts:559` — `rawTime = trimStart + timeInSegment * (playbackSpeed ?? 1)`.
- **WebCodecs export**: `exportWorker.ts:150,157` — identical `toSourceTime`/`sourceRange`-shaped math, independently duplicated (not imported) for the worker context.
- `plainSegment.ts:133-134` — a segment with `playbackSpeed !== 1` is **excluded** from the "plain" GL fast-path export eligibility check.
- `glCompositable.ts:45-47` — the opposite: explicitly documents that `playbackSpeed !== 1` does **not** disqualify a segment from GL-expressible export, because sequential decode already maps segment-local→source time the same way preview does.

**What visibly changes for the user if decoupled.** The clip stops re-timing
to fit the slot — the drawer's `{speed}x` badge stops appearing, and playback
across the segment plays at the clip's native rate. What that leaves
undefined is the tail/head content when the segment's duration no longer
equals `clipLen` at 1×.

**Tail-behaviour options already implied by existing code (not invented here):**
1. **Freeze last frame** — closest existing precedent: `segmentEncoder.ts:220`'s comment ("past `trimStart + duration*playbackSpeed`, the video element holds its last …") describes exactly this behavior already happening at the current trim/speed boundary; decoupling would just make the freeze reachable at 1× instead of only at extreme speed ratios.
2. **Loop** — no existing precedent found anywhere in the codebase; would be new code in both preview paths and both export paths.
3. **Letterbox/black-fill the tail** — no existing precedent found.
4. **Trim the segment back down to `clipLen`** — closest to "images already work this way" but contradicts the ruled decouple direction (option 3 in the owner's three-option list), since it re-imposes an implicit coupling.
This audit does not rank these — the investigation doc is explicit that "this
question must be answered before the code change, not discovered after it"
(§2), and that stands.

**Invariant check — `CLAUDE.md` §4 Drag/timeline.** Decoupling does not
mechanically touch `DRAG_CASCADE_OPTIONS.conserveTotalDuration` or the
last-segment-right-edge rule — those are enforced in `dragCascade.ts`/
`dragSession.ts`, upstream of `resolveDragEdge`'s speed-coupling block, and
removing block (b) (and optionally (a)) does not change `computeDragCascade`'s
own logic. **However**, per the investigation doc §2's own explicit warning
(re-verified true by reading `slipBarGeometry.ts`/`BottomDrawer.tsx` above):
decoupling removes the `duration × playbackSpeed === clipLen` guarantee that
currently keeps `widthPct ≤ 100` for video segments in the Task 2 slip-bar
computation "by construction" — so decoupling **makes Task 2 (symptom 3)
reachable for video segments too**, not just image/no-`sourceDuration`
segments. This is not a violation of a `CLAUDE.md` invariant (none of the
named Drag/timeline invariants govern `playbackSpeed`), but it is a real
cross-task dependency, confirmed by code reading, not just asserted in the doc.

**Test coverage today:** `dragGeometry.test.ts` PART 1 (`dragGeometry.test.ts:89`)
pins `resolveDragEdge` byte-identical to the pre-K16 expression across a
30-case sweep **including video fixtures** (`isVideo: true` cases confirmed at
`dragGeometry.test.ts:146,209,218` and surrounding). A decoupling **will** fail
this block by design — it must be updated deliberately, per the investigation
doc's own instruction, never weakened. Separately, `dragSessionHarness.test.ts`
(`src/services/dragSessionHarness.test.ts`) — the DOM/session-level harness
that drives a real `startDragSession` — has **zero video fixtures**: grepping
the file for `video`/`sourceDuration`/`isVideoSeg` returns no hits at all. So
the pure-math layer (`dragGeometry.test.ts`) is covered for video, but the
live multi-frame drag-session layer is not — this confirms `docs/work-in-
progress.md`'s note that a purpose-built fixture is needed there specifically,
not at the math layer.

---

## Task 2 — bottom-drawer slip-trim bar overflow

**Root cause, re-verified against current `main`.** `BottomDrawer.tsx` renders
three quantities for the Clip Trim bar: the fill (`left: leftPct%, width:
widthPct%`, `BottomDrawer.tsx:180`), the left handle (`left: calc(leftPct% -
5px)`, `BottomDrawer.tsx:223`), and the right handle
(`left: calc(${leftPct + widthPct}% - 5px)`, `BottomDrawer.tsx:250`).
`computeSlipBarGeometry` (`slipBarGeometry.ts:49-54`) clamps `widthPct` and
`leftPct` **individually** to `[0, 100]` — confirmed by reading the function
body — but their **sum**, computed inline at `BottomDrawer.tsx:250`, is never
clamped anywhere. `leftPct + widthPct` can reach up to 200, at which point the
right-edge handle renders past the track, past the drawer's own bounding box,
into the page background.

**What the prior fix (`a7044c1`) actually clamped.** `git show a7044c1`
confirms the commit introduced `slipBarGeometry.ts`'s `hasKnownSourceDuration`
gate plus the individual `widthPct`/`leftPct` clamps — it never touches
`BottomDrawer.tsx:250`'s `left: calc(${leftPct + widthPct}% - 5px)` expression
at all (verified: that literal template-string composition is not part of the
diff). `git log -S "leftPct + widthPct" -- src/components/BottomDrawer.tsx`
(cited in the investigation doc, re-verified true by reading the current file)
shows the line predates `a7044c1` entirely — it was introduced by the
`BottomDrawer.tsx` redesign commit (`7141e34`), long before the fix.

**Why the left-edge path bypasses it.** The overflow is reachable through the
**left-edge drag handle itself** (`BottomDrawer.tsx:221-245`) — dragging it
computes `newStart` bounded by `maxStart = Math.max(0, srcDur - s.duration)`
(`BottomDrawer.tsx:228`), which the investigation doc's §3 fix-shape section
also traces back to `resolveDragEdge`'s **Timeline** left-edge drag path (a
different drag surface, `dragGeometry.ts:220-222`): a `'start'`-edge drag
computes `trimStart = Math.max(0, originalTrimStart + rawDelta)` with **no
upper bound** tied to `sourceDuration`/`trimEnd` — unlike `duration`, which the
speed-coupling block (when engaged) does clamp. This `trimStart` is committed
straight through `dragSession.ts:552` → `computeDragCascade`
(`dragCascade.ts:315`, `segs[draggedIdx] = { ...dragged, trimStart:
finalTrimStart }`) with no intervening clamp. So an ordinary Timeline
left-edge drag on a video segment (not the drawer's own left handle) can push
`trimStart` arbitrarily high, and the drawer's `leftPct` computation then
renders it past 100 combined with `widthPct`.

**Fix shape — minimum diff.** Two independent, stackable options, matching
the investigation doc's own framing exactly:
1. **Presentation-only clamp** — cap `leftPct + widthPct` (or just the right
   handle's rendered `left`) to 100 in `BottomDrawer.tsx` or
   `slipBarGeometry.ts`. Stops the visual overflow; leaves an already-invalid
   `trimStart` uncorrected (cosmetic).
2. **Data-level clamp** — bound `trimStart` at the point `resolveDragEdge`
   computes it for a `'start'`-edge drag (`dragGeometry.ts:220-222`), against
   `sourceDuration`/`trimEnd`. This is the real root-cause fix, but it touches
   the same live-timing surface `dragGeometry.test.ts` PART 1 pins
   byte-identical — same "update the pin deliberately" discipline as Task 1.

Given Task 1's finding above (decoupling removes the `duration ×
playbackSpeed === clipLen` guarantee that currently *contains* this bug for
video segments specifically), option (2) is the fix that closes the gap for
both today's image/unknown-`sourceDuration` case **and** the video case
Task 1's decoupling would otherwise newly expose. Option (1) alone is a valid
stopgap independent of Task 1's sequencing.

---

## Task 3 — the 5.0s hard limit / stretch behavior

**Repro attempted: full-repo grep.** Searched `src/`, `src-tauri/src/`,
`scripts/` (including fixture CSVs), and all `.md` docs for `5.0`, `5000`,
`MAX_*`, `clamp`, and any duration ceiling near image/video segment handling.

**Finding: no 5.0-second duration ceiling exists anywhere in the codebase**,
confirming `docs/work-in-progress.md`'s own note. Every numeric hit near "5.0"
or "5000" is unrelated to a segment-duration cap:
- `syncConstants.ts:154` `TEMPORAL_TOLERANCE_MAX_SEC = 5.0` — a sync-pipeline
  boundary-pairing tolerance (also reused as `DEGENERATE_PAIR_INVERSION_
  THRESHOLD_SEC`, `docs/history.md:2269`), nothing to do with segment/clip
  duration or the editor.
- `App.tsx:352` `TOAST_DURATION = 5000` (ms) — the lock-block toast auto-dismiss
  timer.
- `frameRenderer.ts:172,192` — a **5-second seek timeout** for the legacy
  export path's `waitForVideoFrame`, unrelated to segment length.
- The only duration **floor** that exists is `MIN_SEGMENT_DURATION = 0.3`
  (`dragCascade.ts:55`) — 0.3s, not 5.0s, and it is a minimum, not a maximum.
- No `MAX_*` constant anywhere in `src/services/*.ts` bounds a segment's
  duration to 5 seconds (full list checked: `MAX_PLAYBACK_SPEED`,
  `MAX_HISTORY_STATES`, `MAX_LOOK_PRESETS`, `MAX_LOG_ENTRIES`,
  `MAX_SYNC_RUN_SUMMARIES`, `MAX_CONCAT_TOKENS`, `MAX_CANVAS_BACKING_WIDTH`,
  `MAX_SESSION_FRAMES`, `MAX_BUFFERED_FRAMES_PER_SESSION`,
  `MAX_CACHED_SESSIONS`, `MAX_TOTAL_BUFFERED_FRAMES`,
  `MAX_IDLE_DECODER_HANDLES_PER_ASSET`, `MAX_ZOOM_SCALE_RATE`,
  `MAX_PEAK_SCALE` — none is a segment-duration ceiling, none is 5.0).
- No `<input>` in `SegmentControls.tsx` (the drawer's own numeric fields) has
  `max={5}`; the only `max` attributes present are `400` (font size) and `100`
  (position sliders, `SegmentControls.tsx:120,151,165,280,331,345`) —
  unrelated fields, not duration.

**Verdict: (b) — does not exist in code.** This is a definitive negative
result from a full-repo grep, not an inference from absence of a doc
reference.

**Three most likely things the owner actually saw, ranked by plausibility
given what *does* exist in code:**

1. **Most likely — the video-drag speed-coupling clamp (Task 1) produced an
   apparent 5.0s ceiling for a specific clip length.** `resolveDragEdge`
   (`dragGeometry.ts:230`) clamps a video segment's draggable duration to
   `maxDur = clipLen / MIN_PLAYBACK_SPEED = clipLen / 0.5 = clipLen × 2`. If
   the owner was dragging a video segment whose **clip length (`trimEnd −
   trimStart`, or `sourceDuration` if untrimmed) happened to be ~2.5 seconds**,
   the drag would hard-stop at exactly `2.5 × 2 = 5.0s` — reproducing "a 5.0s
   hard limit" precisely, without any literal `5.0` constant existing anywhere
   — the number is emergent from `clipLen × 2`, not stored. This is the
   single most concrete, code-grounded candidate found.
2. **The drag felt like a ceiling because of `MIN_SEGMENT_DURATION`'s
   opposite-direction floor (0.3s) confused for a max**, or the owner was
   dragging in the *shrinking* direction and hit `clipLen / MAX_PLAYBACK_SPEED
   = clipLen / 2.0`, which for a **10-second clip** would floor at exactly
   5.0s — the same clamp expression, opposite edge.
3. **Not a segment-duration limit at all** — possibly a per-export or
   per-operation timeout the owner is misremembering as a duration limit (the
   codebase has several unrelated 5-second timeouts: `frameRenderer.ts`'s seek
   timeout, `App.tsx`'s toast auto-dismiss), or a UI number-input `step`/`max`
   the owner saw on a *different*, non-duration field (font size caps at 400,
   positions at 100 — none near 5) and is misattributing.

**Exact repro steps to run before this can be worked (do not guess a fix):**
1. Import a **video** asset with a known, short clip length (e.g. trim it or
   use a ~2–3s source clip) and assign it to a segment.
2. In the Timeline, drag that segment's right edge outward as far as it will
   go. Record: (a) the exact duration where it stops, (b) the clip's exact
   `sourceDuration`/`trimEnd − trimStart` at that moment (visible in the
   drawer's Clip Trim bar labels, `BottomDrawer.tsx:277-279`), (c) whether the
   `{speed}x` badge (`Timeline.tsx:779-781`) reads `0.50x` at the stopping
   point (confirms hypothesis 1 — the speed clamp, not a hidden duration
   constant, is what stopped the drag).
3. If the badge does **not** read `0.50x`/`2.00x` at the stop point, or the
   segment is an **image** (no speed coupling at all — `resolveDragEdge`'s
   gate at `dragGeometry.ts:227` requires `isVideo && srcDur > 0`), hypothesis
   1 is falsified and the owner should note the exact asset type, clip length,
   and drag direction so a fresh grep can be targeted instead of repeating
   this one.

---

## Task 4 — dead trim/editor UI

**Confirmed unreachable, re-verified from scratch against current `main`.**

- `isAdjustingTrim` / `setIsAdjustingTrim` — declared `App.tsx:1246`, `useState(false)`.
  Grepping `src/` for `setIsAdjustingTrim(` outside test files returns **no
  call site** other than the declaration itself. Read at `Timeline.tsx:651,695-697,705,708,710,712`
  — all gated branches are permanently dead since the flag never becomes `true`.
- `trimmingSegmentId` / `setTrimmingSegmentId` — declared `App.tsx:1492`,
  `useState<string | null>(null)`. Same result: no live call site sets it to a
  non-null value anywhere in `src/`. Read at the same `Timeline.tsx` lines
  above (paired conditions with `isAdjustingTrim`).
- `editingSegment` / `setEditingSegment` — declared `App.tsx:1248`,
  `useState<VideoSegment | null>(null)`. Every `setEditingSegment(...)` call
  site in the live modal block (`App.tsx:4856,4873,4913-4941,4963-4964,4973,4988,4990`)
  either passes `null` (closing) or spreads the **already-non-null**
  `editingSegment` (editing an already-open modal) — none opens the modal
  fresh from a real segment. The one historical trigger,
  `onClick={() => setEditingSegment(s)}`, was removed in `1c8abf1` (2026-05-16,
  "extract SegmentEditorPanel") with no replacement added in the same commit —
  confirmed via `git log -S "setEditingSegment(s)"` showing that commit as the
  last to add/remove a *live-value* call.

**Test references.** `grep`ing all `*.test.*` files for these three symbols
returns exactly one file: `src/components/timeline.render.test.tsx:43-44`,
which sets `trimmingSegmentId: null, isAdjustingTrim: false` as static default
props for rendering `Timeline.tsx` in isolation — it does not exercise any
live branch gated on them being true/non-null. No test references
`editingSegment` at all.

**`BottomDrawer.tsx` supersession — confirmed.** `4ed6a04` (2026-06-04,
"unified drop zone + bottom drawer segment editor") introduces `BottomDrawer.tsx`
as the sole intended segment-editing surface, three weeks *after* the old
modal's trigger was already gone (not built as a reaction to the modal's
death — the investigation doc's §3 1c section already established this
timeline via `git show`, re-confirmed here by reading the same commits).
`BottomDrawer.tsx` today owns 100% of live segment editing (`SegmentControls`,
the Clip Trim bar, lock toggle) — nothing in the dead code duplicates a
capability `BottomDrawer.tsx` lacks.

**Deletion blast radius, if the owner rules delete:**
- `App.tsx`: 3 `useState` declarations (lines 1246, 1248, 1492) + the entire
  `editingSegment && (...)` modal JSX block, `App.tsx:4817-4998` (182 lines) +
  its 2 prop-pass-throughs into `Timeline.tsx` (`App.tsx:4351-4352`).
- `Timeline.tsx`: 2 interface fields (`Timeline.tsx:66-67`) + 2 destructured
  props (`107-108`) + the in-place trim-drag `onMouseDown` branch
  (`651-683`, ~33 lines) + 5 conditional style/class expressions folded back to
  their `else` branches (`695,696,697,705,708,710`) + the orange "Drag to Slip
  Content" banner block (`712-716`, 5 lines).
- Tests: `timeline.render.test.tsx:43-44`'s two default-prop lines become
  dead props to strip from the test's own prop object — a trivial, same-commit
  edit, not a coverage loss (nothing there tests live behavior of these flags
  today).
- No service/hook file references any of the three symbols — the blast radius
  is confined to these two component files plus the one test file.

---

## Task 5 — duplicate-asset assignment on re-sync

**Verdict: provable by reading alone — yes, the hypothesis is confirmed, and
the codebase already anticipates and logs it (silently) today.**

**The mechanism.** `handleDeleteAsset` (`App.tsx:3261-3284`) removes the asset
from `project.assets` and — critically — **nulls `assetId` on every segment
that referenced it** (`App.tsx:3274-3276`: `s.assetId === assetId ? { ...s,
assetId: undefined } : s`). It does **not** re-sync or otherwise touch the
other, unaffected segments' `assetId`s.

Re-running Apply Sync performs a **clean-slate rebuild** via `parseProjectData`
(`App.tsx:360-603`), per `CLAUDE.md` §4's own stated invariant — every
segment is minted fresh, with fresh `assetId` assignment redone from scratch
against the **current** (now-shorter) `assets` array, scene-by-scene in
order:
1. Explicit bracket-tag exact match (`App.tsx:463-482`) — no
   already-used exclusion; two tags naming the same asset legitimately share
   it (not a bug).
2. Explicit-tag contiguous-word fallback (`App.tsx:491-503`) — same, no
   exclusion, and requires a *unique* match or leaves it unmatched.
3. **Untagged/context fallback** (`App.tsx:505-512`):
   ```
   const availableAssets = assets.filter(a => !usedAssetIdsTotal.has(a.id) && a.type !== 'audio');
   const contextualAsset = findAssetByContext(text, availableAssets.length > 0 ? availableAssets : assets);
   ```
   `availableAssets` excludes assets already claimed **earlier in this same
   parse pass** (via the running `usedAssetIdsTotal` set, seeded at
   `App.tsx:421`). This is the mechanism that made N segments originally match
   N *distinct* assets. But once a deletion shrinks the pool below N, the
   `availableAssets.length > 0 ? availableAssets : assets` fallback
   (`App.tsx:507`) means the **last** segment(s) to be processed, once
   `availableAssets` is exhausted, fall through to matching against **all**
   `assets` again — including ones already claimed by an earlier segment in
   this same pass — and `findAssetByContext` (`syncEngine.ts:29-36`) returns
   the *first* substring-matching asset with no already-used check at all.
   That segment then shares an `assetId` with whichever earlier segment
   claimed it first.

**The codebase already knows this can happen.** `parseProjectData` itself
contains a dedicated duplicate-detection pass immediately after segment
construction (`App.tsx:580-600`):
```js
// Detect segments sharing the same assetId — can happen when the
// unused-asset pool is exhausted after a deletion and re-sync.
// This is a data quality warning, not a hard error.
```
— followed by a `console.warn` per duplicated `assetId`, naming the affected
segments. This comment is a direct, pre-existing acknowledgment of exactly
the WS3 task-5 hypothesis, written by whoever built `parseProjectData`. What
it does **not** do is surface anything to the user — it's `console.warn`
only, invisible outside DevTools, with no toast/badge/sync-log entry despite
the app having a sync-log mechanism (`clearSyncLog`, `App.tsx:3256-3258`) that
other warnings do use.

**`autoMatchSegments` itself (`syncEngine.ts:435-458`) is not the vector for
this specific hypothesis** — it early-returns for any segment that already
has an `assetId` (`syncEngine.ts:437`), so it only ever fills in *previously
unmatched* segments and cannot reassign a segment that already has one. The
duplicate-producing path is `parseProjectData`'s own fallback at
`App.tsx:507`, not `autoMatchSegments`. (`autoMatchSegments` is called
separately, later, for narrower cases — e.g. `App.tsx:3338,3394,4754` — new
asset uploads, drop-zone matching — not the Apply Sync clean-slate path,
which uses `parseProjectData`'s own inline matching instead.)

**Is a test needed, or is reading conclusive?** Reading is conclusive for
*whether the mechanism exists* — the `console.warn` is proof the author
already found and named this exact case. A test is still worth writing, not
to establish the mechanism (settled) but to (a) pin the current silent
behavior as a named regression baseline before any fix, and (b) prove the
*count* — how many segments actually end up duplicated in the N-segments/1-
deletion case the task hypothesis describes, which depends on scene-processing
order and is not obvious by inspection alone for N > 2.

**Fixture shape for that test (not written — description only):**
- 3 assets (`a`, `b`, `c`, `type: 'image'`), 3 script scenes with **no
  explicit bracket tags** (empty `[]`), each scene's text containing a distinct
  word matching exactly one asset's filename (so `findAssetByContext` gives a
  clean 1:1 match on the first pass).
- Call `parseProjectData` once to confirm 3 distinct `assetId`s (baseline).
- Remove one asset from the `assets` array (simulating `handleDeleteAsset`,
  without needing the full IndexedDB/React plumbing — `parseProjectData` is a
  pure-enough async function to call directly with a shorter `assets` array).
- Call `parseProjectData` again with the same script/scene text and the
  2-asset array; assert on the returned segments' `assetId`s — expect exactly
  one duplicate (two segments sharing one `assetId`), which segment ends up
  duplicated (order-dependent — worth pinning), and that `console.warn` fired
  with the `"assigned to 2 segments"` message.

---

## Cross-cutting questions

### 1. Sequencing

Recommended order, with reasons:

1. **Task 4 (dead-code ruling)** first — zero technical dependency on
   anything else, pure owner yes/no, and removing ~220 dead lines shrinks the
   surface every subsequent `App.tsx`/`Timeline.tsx` diff has to be read
   against. No code risk either way.
2. **Task 5 (duplicate-asset audit)** next — independent of the drag/timing
   work entirely (different files: `App.tsx`'s `parseProjectData` +
   `syncEngine.ts`'s matchers, not `dragGeometry.ts`/`dragCascade.ts`/
   `BottomDrawer.tsx`). Low risk, and the fix (if the owner wants one — e.g.
   extending `usedAssetIdsTotal`'s exclusion, or surfacing the existing
   `console.warn` as a real sync-log entry) doesn't block or get blocked by
   anything in tasks 1–3.
3. **Task 2's clamp (option 1, presentation-only)** — cheapest, no ruling
   needed, closes the *currently reachable* image/no-`sourceDuration`
   overflow immediately.
4. **Task 3's repro** — needs the owner to actually run the 3-step repro
   above before anyone can write a fix; can happen in parallel with 1/2/5,
   but no code work should start on it until the repro result is in (per the
   prompt's own "do not guess a fix" instruction, and because hypothesis 1
   above means it may turn out to be Task 1's clamp, not a separate defect).
5. **Task 1 (decouple) + Task 2's option 2 (trimStart clamp), together** —
   last, and explicitly bundled: the investigation doc's §2 already states
   Task 2's data-level fix "belongs in the same pass" as Task 1 because
   decoupling removes the guarantee that currently contains Task 2 for video
   segments. Task 1 also cannot start until the owner answers the tail-
   behavior product question (freeze/loop/letterbox/trim — none decided).
   This is the highest-risk, highest-diff task and should go last, gated on:
   the owner's tail-behavior ruling, `dragGeometry.test.ts` PART 1 deliberately
   updated (not weakened), a new `dragSessionHarness.test.ts` video fixture
   (Task 1 has none today), and Task 3's repro result (if Task 3 turns out to
   *be* Task 1's clamp, fixing Task 1 first would silently resolve Task 3 too
   — worth knowing before spending time on Task 3 separately).

### 2. Test coverage per task

| Task | Regression test exists today? | Notes |
|---|---|---|
| 1 | Partial. `dragGeometry.test.ts` PART 1 covers the pure math (including video cases) and **will** catch an accidental behavior change there. `dragSessionHarness.test.ts` has **zero video fixtures** — the live multi-frame session/DOM layer is uncovered. A purpose-built fixture is needed at that layer (shape: a video-backed `VideoSegment` with `sourceDuration` set, driven through `startDragSession` across several simulated frames, asserting `playbackSpeed` no longer changes and the tail behavior matches whatever the owner rules). |
| 2 | No. `slipBarGeometry.test.ts` asserts `widthPct`/`leftPct` individually ≤ 100 but nothing asserts their **sum**, and nothing renders `BottomDrawer.tsx` itself to check the handle's actual DOM position (confirmed by grep — no `leftPct + widthPct` assertion anywhere in the test suite). |
| 3 | N/A until the repro identifies a real mechanism — nothing to test yet. |
| 4 | N/A — deleting dead code needs no new test; the one existing reference (`timeline.render.test.tsx:43-44`) needs a same-commit prop-cleanup, not new coverage. |
| 5 | No. `parseProjectData`'s own duplicate-detection `console.warn` is the only existing signal, and nothing asserts on it. Fixture shape described in Task 5 above. |

### 3. Blast radius on WS1

- **Task 5** touches `syncEngine.ts` (`isFuzzyMatch`/`findAssetByContext`) and
  `App.tsx`'s `parseProjectData` — both participate in the Apply Sync path
  WS1 also touches, but the **specific functions** involved are asset-matching
  only, not timing. The golden-replay baseline CSVs
  (`scripts/fixtures/phase4-baseline-*-segments.csv`) have the column header
  `order,tag,text,startTime,duration,endTime,anchorSource` — **no `assetId`
  column at all** — confirmed by reading `phase4-baseline-v6-segments.csv`'s
  header directly. So a Task 5 fix cannot break golden-replay byte-identity
  regardless of what it changes about asset assignment. Collision risk with
  WS1 slice 2 (which touches `snapBoundaries.ts` + Apply-Sync plumbing, not
  `syncEngine.ts`'s matcher functions): **low** — different functions in
  (mostly) the same file, disjoint concerns, no shared state.
- **Tasks 1, 2, 4** touch `dragGeometry.ts`, `dragCascade.ts`, `dragSession.ts`,
  `BottomDrawer.tsx`, `slipBarGeometry.ts`, `App.tsx`, `Timeline.tsx` — none of
  these are read by `scripts/phase4-handoff-replay-sync.test.ts` or any golden
  baseline. **Zero collision risk with WS1.**
- **Task 3** — no file identified yet (repro-first), so risk is unknown but
  likely nil given the leading hypothesis points back at Task 1's own file.

### 4. Manual QA gate

Per `docs/wkwebview-drag-checklist.md`'s own "when to run" rule (any change to
`dragSession.ts`/`dragCascade.ts`/`dragGeometry.ts`, or timeline-affecting CSS):

- **Task 1** — yes, touches `dragGeometry.ts`. Also needs checklist steps 12
  (video boundary playback) and 13 (drawer slip bar) re-run per the
  checklist's own "video path" note, plus manual verification of whatever
  tail-behavior gets chosen (no checklist step exists for that yet — would
  need a new step).
- **Task 2, option 2 (trimStart clamp)** — yes, touches `dragGeometry.ts`.
  Needs the full checklist plus step 13 specifically (drawer slip bar) with a
  **new** case added (a known-`sourceDuration` segment whose `trimStart` a
  left-edge drag has pushed out of range) — the investigation doc §3 already
  notes step 13 as written only exercises the `?? 60` case, not this one.
- **Task 2, option 1 (presentation clamp only)** — no; it's a pure render
  clamp in `BottomDrawer.tsx`/`slipBarGeometry.ts`, outside the checklist's
  listed trigger files. A quick manual look at step 13 is still sensible but
  not the full checklist.
- **Task 3** — depends entirely on what the repro finds; if it confirms
  hypothesis 1, it collapses into Task 1's QA requirement.
- **Task 4** — no; deleting unreachable branches in `Timeline.tsx` touches a
  file the checklist's trigger list names, but only in dead branches — still,
  because `Timeline.tsx` is explicitly named as a trigger file, a
  precautionary run (steps 1–7, the always-reachable ones) is the safe call
  rather than asserting confidence the deletion touched nothing live.
- **Task 5** — no; `syncEngine.ts`/`parseProjectData` are not checklist
  trigger files.

---

## Owner decisions needed

1. **Task 1 — tail behavior when a decoupled video segment is dragged longer
   than its clip.** Options found implied by existing code: freeze last frame
   (closest precedent, `segmentEncoder.ts:220`), loop (no precedent), letterbox/
   black-fill (no precedent), or refuse the drag past `clipLen` (contradicts
   the ruled decouple direction). **Recommendation: freeze last frame** — it's
   the only option with an existing code precedent to extend rather than
   build from scratch, and it matches the "hold" behavior over-length exports
   already fall back to per `segmentEncoder.ts`'s existing comment.
2. **Task 2 — ship the presentation-only clamp now, or wait and bundle the
   full `trimStart` clamp with Task 1?** Presentation-only closes the
   currently-reachable bug fastest; the data-level clamp is more complete and
   is needed regardless once Task 1 ships. **Recommendation: ship the
   presentation clamp immediately** (cheap, no ruling needed, closes today's
   real bug) **and** do the `trimStart` clamp as part of the Task 1 pass, per
   the investigation doc's own sequencing note.
3. **Task 3 — who runs the repro, and when?** This audit could not reproduce
   any 5.0s limit from code alone; the next step is the 3-step manual repro
   above, which needs a real video asset and the real app running.
   **Recommendation: owner runs it** (fastest path — they already have the
   asset/project that showed the behavior) rather than trying to reconstruct
   the exact clip length from a description after the fact.
4. **Task 4 — delete or keep?** Confirmed fully unreachable, confirmed
   superseded by `BottomDrawer.tsx`, confirmed refactor collateral damage (not
   deliberate), confirmed zero live test coverage lost by deleting.
   **Recommendation: delete.** No argument for keeping was found in the code
   or history that survives this audit's re-check.
5. **Task 5 — is the silent `console.warn` acceptable, or does this need a
   real user-facing fix (sync-log entry, or excluding already-used assets
   pool-wide rather than falling back to all assets)?** The mechanism is
   confirmed and already self-diagnosed by the code; what's undecided is
   product severity. **Recommendation: surface the existing warning into the
   sync log** (`clearSyncLog`'s mechanism already exists and other warnings
   use it) as the minimum fix — it requires no change to matching behavior,
   just wiring an already-computed warning to a channel the user can see,
   before deciding whether the matching algorithm itself needs to change.

---

## Implementation note — Batch A, Task 4 + Task 5 (not yet committed)

Implemented against this audit's own recommendations. Not committed — owner
manual test is the gate, per the batch prompt. `npm run lint`, `npm test`
(1757 passed, 1 pre-existing skip in `dragSessionHarness.test.ts`, unrelated
to this batch), and `npx vitest run scripts/phase4-handoff-replay-sync.test.ts`
(3/3, byte-identical) all pass. `cargo check` not run — neither task touches
Rust.

**Task 4 — deleted as ruled.** `isAdjustingTrim`, `trimmingSegmentId`,
`editingSegment` and the entire dead modal block are gone from `App.tsx`/
`Timeline.tsx`, the 5 conditional style/class expressions folded to their
`else` branches, `timeline.render.test.tsx` stripped of the two dead default
props. Re-grepping the three symbols at implementation time (not the audit's
line numbers) turned up two things not itemized in the audit's blast-radius
list, both deleted as pure collateral of deleting the three ruled symbols
(not new independent decisions):
- `segmentEditorTrapRef` (`App.tsx`, a `useFocusTrap` ref used only inside
  the dead modal) — flagged and confirmed with the owner before deleting.
- `onSetTrimmingSegment`/`onSetAdjustingTrim` — 2 more `Timeline.tsx` Props
  fields + destructured props + `App.tsx` pass-throughs (`setTrimmingSegmentId`/
  `setIsAdjustingTrim` callbacks). Undiscussed in the audit, but not optional:
  once the 3 `useState` declarations are gone, these callbacks reference
  setters that no longer exist — leaving them in place would not compile.
  Grepped inside `Timeline.tsx`: neither callback was ever actually invoked
  there, confirming they were dead too.
`computeTrimDrag`/`computeSlipBarGeometry` imports removed from `Timeline.tsx`
(now unused there); left both functions themselves untouched in
`timelineLayout.ts`/`slipBarGeometry.ts` — `computeTrimDrag` has its own
independent test coverage in `timelineLayout.test.ts` and `slipBarGeometry.ts`
is explicitly out of scope for this pass.

**Task 5 — fallback removed, grouped log entry added, gap found.**
1. `parseProjectData`'s untagged/context fallback (`App.tsx`) now matches
   only `availableAssets`; an exhausted pool (or no match) leaves `assetId`
   undefined. No change to either explicit-tag path.
2. New grouped entry, `buildParseUnassignedSummaryEntry` (`App.tsx`, beside
   `buildNoAssetSummaryEntry`), computed from `parseProjectData`'s own output
   right after the parse pass (in `handleApplySyncFromFiles`, before timing
   alignment/`autoMatchSegments` can change the picture), and appended to the
   run's log only on a successful commit. **Exact wording**, `count` = of
   `total`, `available` = non-audio assets in the project:
   `` `No asset available for ${count} of ${total} segments (${available} asset${available === 1 ? '' : 's'} for ${total} segments): ${ranges}.` ``
   e.g. `"No asset available for 1 of 3 segments (2 assets for 3 segments): 3."`
   Reuses the existing `'no-asset'` `SyncLogEntryType` (same orange
   `SyncLogPanel.tsx` styling as `buildNoAssetSummaryEntry`'s own entry — the
   two are independent, complementary signals, not a replacement of one by
   the other: this one reports what the parse pass itself couldn't assign;
   the pre-existing one reports the final committed picture after
   `autoMatchSegments` has had a chance to fill gaps).
3. `console.warn` duplicate-detection pass left untouched, as instructed.
4. New test: `src/services/sceneTagParsing.test.ts`, describe block
   `'parseProjectData — Task 5: exhausted context-fallback pool leaves a
   segment unassigned, never a duplicate'`. Fixture: 3 untagged (`[]`)
   scenes / 3 image assets (`mountain.jpg`, `river.jpg`, `forest.jpg`); scene
   3's text deliberately contains both "river" (its own match) and
   "mountain" (scene 1's), so that removing `river.jpg` reproduces the exact
   old-fallback vector (scene 3 would have re-matched scene 1's already-
   claimed `mountain.jpg`) rather than a case the old code would have left
   unmatched anyway. **Pinned answer: scene 3 (1-based; index 2) is the one
   left unassigned** after `river.jpg` is removed — scenes 1 and 2 are
   unaffected. Baseline (all 3 assets present) asserts 3 distinct `assetId`s.

**Gap found, not fixed — flagging for an owner decision, not fixing
unilaterally (out of this task's stated scope).** `autoMatchSegments`
(`syncEngine.ts`) is called unconditionally on every Apply Sync commit,
downstream of `parseProjectData`, on every segment that still has no
`assetId` (`if (s.assetId) return s;` skips the rest). For a genuinely
untagged scene (`unmatchedExplicitTag` is never set on those — only explicit-
tag failures get it), a segment `parseProjectData` now correctly leaves
unassigned flows straight into `autoMatchSegments`' own
`findAssetByContext(s.text, assets)` call — against the FULL, unrestricted
asset array, with no already-used exclusion of its own. That call can
independently re-produce the same *kind* of duplicate this task just closed
in `parseProjectData`, silently overwriting the `undefined` this fix
produces. This was not exercised by the audit's original repro trace (every
segment there started out matched, so `autoMatchSegments` early-returned for
all of them) — it only shows up once `parseProjectData` can legitimately
leave a genuinely-untagged segment unassigned, which is exactly what this
fix newly enables. Confirmed by reading `autoMatchSegments` directly
(`syncEngine.ts`); not covered by the new test above, which calls
`parseProjectData` in isolation. **This task's own instructions scoped the
fix to `parseProjectData`'s fallback specifically** (and the required test
exercises only that function), so this was surfaced rather than fixed here.

---

## Implementation note — Batch B, Tasks 1 + 2 (+ the Batch A gap, + Task 3's resolution) — not yet committed

Implemented against this audit's own sequencing recommendation (§ Cross-cutting
questions 1): Task 1's decoupling and Task 2's `trimStart` clamp landed
together, in the same pass, exactly as flagged as necessary above. The owner's
tail-behavior ruling (needed before Task 1 could start at all) was
**freeze-last-frame** — this audit's own recommendation. Also folded into this
batch: the `autoMatchSegments` gap Batch A found and explicitly declined to
fix ("flagging for an owner decision, not fixing unilaterally") — the owner
decided to fix it, so it's closed here too, and Task 3 (the 5.0s-limit
investigation) resolves as a side effect of Task 1 landing, per this audit's
own leading hypothesis. Not committed — owner manual test is the gate. `npm
run lint` (clean), `npm test` (1774 passed, 1 pre-existing skip, 70 files),
and `npx vitest run scripts/phase4-handoff-replay-sync.test.ts` (3/3,
byte-identical) all pass, independently re-run and confirmed rather than
trusted from a prior report. `cargo check` also re-run (clean) even though the
diff touches no file under `src-tauri/` — confirmed by `git diff --stat`
matching no `src-tauri` path.

### What changed, per file

- **`src/types.ts`** — `playbackSpeed?: number` removed from `VideoSegment`.
- **`src/App.tsx`** — `playbackSpeed` removed from `RawSegment`, the
  `parseProjectData` segment builder, and the drop-zone asset-assign path;
  the untagged/context fallback (Task 5, Batch A) is unchanged this batch;
  `buildNoAssetSummaryEntry` gains an `availableAssetCount` parameter and new
  wording (Piece 1, merging the Batch A `buildParseUnassignedSummaryEntry`
  into it — see below); new `buildFreezeFrameEntries` (Piece 2, Case A
  warnings); `handlePlaybackSpeedChange`, `speedBaselineRef`, and the
  speed-slider's `applyDurationChange` plumbing (`additionalUpdates` param,
  `getAssets`/`clearSpeedBaseline` deps) all deleted; the dead
  double-click Scene Editor modal, `isAdjustingTrim`/`trimmingSegmentId`/
  `editingSegment` state, and `segmentEditorTrapRef` deleted (Task 4).
- **`src/services/dragGeometry.ts`** — `MIN_PLAYBACK_SPEED`/
  `MAX_PLAYBACK_SPEED` and the whole `isVideo && srcDur > 0` speed-coupling
  block deleted from `resolveDragEdge`; a `'start'`-edge drag's `trimStart`
  now clamped to `[0, max(0, sourceDuration - duration)]` (Piece 3).
- **`src/services/dragGeometry.test.ts`** — PART 1's oracle rewritten from a
  literal transcription of the old (speed-coupled) commit math to one of the
  new math; a new PART 1b adds four explicit before/after cases (detailed
  below).
- **`src/services/dragSession.ts`** — the `isVideoSeg`/`dragAsset` lookup,
  the `getAssets`/`clearSpeedBaseline` deps, and `speedUpdate` construction
  all deleted; `commitDurationChange`'s call signature shortened to drop the
  now-nonexistent `additionalUpdates` argument.
- **`src/services/dragSessionHarness.ts`** — mirrors `dragSession.ts`:
  `assets`/`getAssets` config and state, `clearSpeedBaseline`/
  `speedBaselineCleared`, and `additionalUpdates` handling all deleted.
- **`src/services/dragSessionHarness.test.ts`** — new PART 5, two tests: a
  right-edge drag proving the 2×-clip-length speed clamp no longer engages,
  and a left-edge drag proving the committed `trimStart` stays inside the
  Piece 3 bound across several simulated frames — the live multi-frame
  session/DOM layer this audit flagged as having zero video coverage.
- **`src/services/dragSession.test.ts`** — three now-unused `isVideo: false`
  arguments dropped from `resolveDragEdge` call sites.
- **`src/services/dragTriage.test.ts`** — the one test asserting
  `clearSpeedBaseline` fires on a cancelled drag deleted (the feature it
  tested no longer exists).
- **`src/components/Timeline.tsx`** — the in-place trim-drag `onMouseDown`
  branch, the `trimmingSegmentId`/`isAdjustingTrim` props and every
  conditional style/class keyed on them, the orange "Drag to Slip Content"
  banner, and the `{speed}x` badge all deleted (Task 4 + Piece 2).
- **`src/components/timeline.render.test.tsx`** — the two now-dead default
  props (`trimmingSegmentId`, `isAdjustingTrim`) stripped.
- **`src/components/BottomDrawer.tsx`** — `computeSlipBarGeometry` call drops
  `playbackSpeed`, destructures `isInert`/`rightPct`; the Clip Trim bar
  renders a disabled/inert message block when `isInert`; the fill and right
  handle render at `rightPct` instead of each recomposing
  `leftPct + widthPct` inline (the actual overflow bug, per the investigation
  doc).
- **`src/services/slipBarGeometry.ts`** — `playbackSpeed` dropped from
  `SlipBarGeometryInput`; `widthPct` is now a plain `duration / sourceDuration`
  ratio; new `isInert` (clip ≤ segment duration) and `rightPct`
  (`leftPct + widthPct`, clamped once, here) outputs.
- **`src/services/slipBarGeometry.test.ts`** — the `playbackSpeed` factoring
  test replaced with a plain-ratio test; new `isInert` and `rightPct` describe
  blocks, including the exact investigation-doc repro
  (`duration: 5, trimStart: 500, sourceDuration: 60` → `rightPct` clamped to
  100).
- **`src/hooks/useWebCodecsPreview.ts`** — `toSourceTime`/`sourceRange` drop
  the `playbackSpeed` multiply and the `trimEnd` clamp, clamping instead at
  `sourceDuration` (Piece 2's freeze/trim-window mechanism — see below).
- **`src/hooks/useWebCodecsPreview.test.ts`** — the `playbackSpeed`-change and
  `trimEnd`-clamp tests replaced with explicit Case A (freeze) / Case B
  (trimmed window) / no-`sourceDuration` tests.
- **`src/components/PreviewStage.tsx`** — the legacy `<video>` seek math and
  `activeEl.playbackRate` assignment drop the `segment.playbackSpeed` factor
  (now just `globalPlaybackSpeed`); the seek clamp switches from `trimEnd` to
  `sourceDuration`.
- **`src/services/frameRenderer.ts`** — the legacy export path's per-frame
  seek math gets the identical `playbackSpeed` removal + `sourceDuration`
  clamp.
- **`src/services/webcodecsExport/exportWorker.ts`** — the worker's own
  (independently duplicated, not imported) `toSourceTime`/`sourceRange` copies
  updated identically.
- **`src/dev/webcodecsStep2Spike/exportWorkerInstrumentedSpike.ts`** and
  **`exportWorkerSoftwareSpike.ts`** — mirror the same `toSourceTime`/
  `sourceRange` fix. Necessary, not incidental: both files import
  `VideoSegment` from `../../types`, so once `playbackSpeed` left the type,
  `tsc --noEmit` (`npm run lint`) would fail on these two files' own
  `segment.playbackSpeed` reads without the same fix. Neither file is
  imported from `src/main.tsx` or reachable from `index.html`'s Vite entry
  graph (confirmed by grep — no reference to `webcodecsStep2Spike` exists
  outside that directory); they're loaded only via the standalone
  `spike-webcodecs-step2.html` page during `npm run dev`, which
  `vite.config.ts` does not register as a `build.rollupOptions.input` entry,
  so neither ships in `npm run build`'s or `npm run tauri:build`'s output.
- **`src/services/plainSegment.ts`** — the fast-path exclusion retargeted
  from `playbackSpeed !== 1` to `availableClipLen < duration` (see below).
- **`src/services/plainSegment.test.ts`** — the speed-exclusion tests replaced
  with freeze/trimmed-window/unknown-`sourceDuration`/`trimStart`-eats-into-
  clip cases.
- **`src/services/segmentEncoder.ts`** — comment-only: the `trailingExtension`
  seek-past-end note now covers both the old case (past
  `trimStart + duration`) and the new freeze case (past `sourceDuration`).
- **`src/services/webcodecsExport/glCompositable.ts`** — comment-only: the
  non-disqualifier reasoning restated for the freeze/trimmed-window cases
  instead of speed.
- **`src/services/webcodecsExport/glCompositable.test.ts`** — the
  `playbackSpeed = 2` non-disqualifier test replaced with a freeze-tail case
  and a trimmed-window case.
- **`src/services/projectStore.ts`** — `loadProject` now strips any legacy
  `playbackSpeed` field from a project saved before this change, leaving
  segment `duration` untouched (Piece 2 back-compat).
- **`src/services/syncEngine.ts`** — `autoMatchSegments` now seeds a
  `usedAssetIds` set from every segment that already has an `assetId` and
  grows it across both its own matching paths (embedded-bracket fuzzy match,
  context match), closing the gap Batch A found and declined to fix
  unilaterally (Piece 4).
- **`src/services/sceneTagParsing.test.ts`** — Task 5's describe block now
  imports `buildNoAssetSummaryEntry` (not the since-merged
  `buildParseUnassignedSummaryEntry`) and asserts its new merged wording.
- **`src/services/syncLog.test.ts`** — `buildNoAssetSummaryEntry`'s tests
  updated for the new `availableAssetCount` parameter and wording, including
  a new singular-"asset" case.
- **`docs/work-in-progress.md`** — WS3 tasks 1–5 updated to `[>]` with
  one-line Batch B implementation summaries (task 3 carries its
  resolved-as-duplicate-of-task-1 note); nothing marked `[x]`.

### The two sync-log entries, quoted exactly as the code emits them

**The merged "no asset" entry** (`buildNoAssetSummaryEntry`, `App.tsx`) —
now the sole emitter; the Batch A `buildParseUnassignedSummaryEntry` this
audit described as "complementary, not a replacement" was superseded by
folding its richer asset-count wording into this one, computed on the run's
final committed segments (post-`autoMatchSegments`) rather than on
`parseProjectData`'s pre-`autoMatchSegments` snapshot — closing exactly the
false-positive risk the merge comment in `App.tsx` itself names ("a segment
the parse pass left unassigned that `autoMatchSegments` went on to fill would
still have been reported as unassigned" under the old two-emitter design):

```
`No asset available for ${count} of ${total} segments (${available} asset${available === 1 ? '' : 's'} for ${total} segments): ${ranges}.`
```

Example instantiation (from `syncLog.test.ts`):
`"No asset available for 33 of 294 segments (200 assets for 294 segments): 7–18, 23, 78–97."`

**The freeze-frame warning** (`buildFreezeFrameEntries`, `App.tsx`) — one
entry per committed video segment whose available clip (`sourceDuration -
trimStart`) is shorter than the segment's own duration:

```
`Segment #${i + 1}: source clip (${availableClipLen.toFixed(1)}s) is shorter than the segment duration (${s.duration.toFixed(1)}s); the final frame will hold for the remaining ${heldFor.toFixed(1)}s.`
```

Both reuse the pre-existing `'no-asset'` / `'warning'` `SyncLogEntryType`s —
no new entry type was added.

### Freeze-last-frame, per source-time path — mechanism and why clamping alone is sufficient

The owner's tail-behavior ruling is implemented as one idea in four places:
`rawTime` (segment-local progress mapped onto the source clip) is clamped at
`sourceDuration` rather than left to run past it. What differs between the
four paths is *why* that clamp alone is enough to produce a visible freeze,
because each path's underlying player has a different execution model.

- **WebCodecs preview** (`useWebCodecsPreview.ts`'s `toSourceTime`/
  `sourceRange`). `sourceRange.end` is clamped at `sourceDuration`, so the
  decode session (`videoDecoderPool.ts`) is built to cover source time only
  up to the clip's real end — never past it. Every subsequent
  `toSourceTime` query during the frozen tail resolves to that same clamped
  timestamp. **Verified in code**: `VideoDecoderPool.getFrameAt` (
  `videoDecoderPool.ts:605-660`) selects "the latest buffered frame at or
  before `targetSec`" — its own doc comment's wording — so repeatedly
  querying the same terminal timestamp deterministically re-selects the same
  last-decoded frame rather than erroring, returning null, or blanking.
  This is a real mechanism, not a hopeful default. **Not verified**: whether
  this actually renders as a held frame on a real WKWebView canvas during a
  live playback session — only the arithmetic and the pool's selection rule
  were read, not watched.
- **WebCodecs export** (`exportWorker.ts`'s independently-duplicated
  `toSourceTime`/`sourceRange`). Same mechanism as the preview path — the
  worker drives its own decode loop against the same clamped `sourceRange`,
  so the frames it encodes past the clip's real end are repeats of the last
  in-range frame by the same "select at-or-before `targetSec`" logic (the
  worker's decode loop was not read in this pass to confirm it shares
  `VideoDecoderPool`'s selection rule verbatim rather than a separate
  implementation — **unverified**, flagging for the owner's export test
  rather than asserting it from the shared naming alone).
- **Legacy `<video>` preview** (`PreviewStage.tsx`). The clamp
  (`videoTime = Math.min(rawTime, sourceDuration)`) only fires at segment
  **transition** boundaries (`seekToTime`, called when the active segment
  slot changes or the next segment is warmed for crossfade) — there is no
  per-frame re-seek during ongoing playback within one segment; the
  `<video>` element's own internal clock runs freely once `.play()` is
  called. For Case A (clip shorter than segment), reaching the clip's real
  end during that free-running playback relies on the browser's native
  `HTMLMediaElement` behavior — pause and hold the last frame when
  `currentTime` reaches `duration` with no `loop` attribute set (this app
  never sets `loop` on the preview `<video>` elements). This is standard,
  well-established HTML5 behavior, but **it is an assumption, not something
  this diff's code enforces or a test exercises** — no `'ended'` handler
  exists in `PreviewStage.tsx`, and nothing in the automated suite plays a
  real `<video>` element to its end. **Unverified** — needs the owner's
  manual preview test to confirm the browser actually holds rather than,
  say, showing a black frame or the poster image on some platform/codec
  combination.
- **Legacy export** (`frameRenderer.ts`'s `renderSegmentFrame`, via
  `seekVideo`). Unlike preview, this path IS a per-frame seek — every
  exported frame calls `seekVideo(videoEl, videoTime)` with `videoTime`
  clamped at `sourceDuration`. `seekVideo` also clamps to `el.duration`
  internally as a second backstop (pre-existing, unchanged this batch). A
  `<video>` element seeked repeatedly to the same valid in-range timestamp
  simply re-decodes and displays that same frame — this is ordinary seek
  behavior, not a special case, so this path's freeze is the most
  mechanically certain of the four (**verified in code** — no reliance on
  `'ended'`/native pause behavior at all, just an ordinary bounded seek
  target). `segmentEncoder.ts`'s own pre-existing comment already documented
  this exact "video element holds its last decoded frame" behavior for a
  different trigger (a `trailingExtension` seek past the old
  `trimStart + duration * playbackSpeed` bound) — this batch's change makes
  that same held-frame behavior reachable from the new `sourceDuration`
  bound too, not a new mechanism.

**Summary: 2 of 4 paths (WebCodecs preview's selection rule, legacy export's
plain seek) are verified in code; 2 (WebCodecs export's decode loop, legacy
preview's reliance on native `<video>` end-of-playback behavior) are
reasoned but unverified.** No export has been watched and no preview session
has been played through a Case A tail in the real app as part of this
session — see the "Not verified" line below.

### The trim invariant now enforced

`trimStart`, `duration`, and `sourceDuration` (the clip's real length) relate
as follows, post-Batch-B:

- **`trimStart` is the only field that positions the clip window** — it is
  the source-time offset the segment's own local time-zero maps to.
  `trimEnd` still exists on `VideoSegment` (unremoved) and is still *written*
  by `BottomDrawer.tsx`'s drag handlers (`trimEnd: newStart + s.duration`,
  kept in sync as a redundant mirror of `trimStart + duration`), but it is no
  longer *read* by any of the four source-time paths above, by
  `resolveDragEdge` (present only in its `Pick<...>` input type, never
  referenced in the function body), or by `slipBarGeometry.ts`. It remains
  live only in `useFirstFrameCache.ts`'s thumbnail-cache key/clamp — a file
  untouched by this batch and out of scope for it. This is a real,
  now-partial redundancy this batch introduces (not removes) and does not
  resolve: `trimEnd` is vestigial for playback/export purposes but not yet
  deleted from the type or its one remaining live reader.
- **The clip's available length** is `availableClipLen = sourceDuration -
  trimStart`, computed identically in three places that all needed the same
  answer: `buildFreezeFrameEntries` (to decide whether to warn and by how
  much), `plainSegment.ts`'s `isPlainMediaSegment` (to decide fast-path
  eligibility), and `slipBarGeometry.ts`'s `isInert` (`sourceDuration <=
  duration`, the boundary-inclusive sibling of the same comparison against
  `trimStart` folded in via `widthPct`'s own `duration / sourceDuration`
  ratio).
- **Case A (freeze)**: `availableClipLen < duration` — the clip runs out
  before the segment does; the tail holds the last frame. **Case B (trimmed
  window)**: `availableClipLen >= duration` — the clip has at least as much
  material as the segment needs; playback is a plain `trimStart`-positioned
  window, unclamped within the segment's own span.
- **Enforcement points**: `resolveDragEdge` (`dragGeometry.ts`) is the sole
  place `trimStart` is ever computed from a drag gesture, and its `'start'`-
  edge branch is the sole place it is bounded — `trimStart = min(candidate,
  max(0, sourceDuration - duration))` — guaranteeing `trimStart + duration
  <= sourceDuration` can never be violated by a drag once it engages (it
  only engages when `sourceDuration` is known and positive; an unset
  `sourceDuration` leaves `trimStart` unbounded, same as before, since there
  is nothing to bound it against). Nothing enforces this same bound on a
  duration change that ISN'T a drag (e.g. a numeric edit, if one existed) —
  none does today, so this is not a live gap, just a scope note. Everywhere
  else (`toSourceTime`, `sourceRange`, `frameRenderer.ts`, `exportWorker.ts`,
  `PreviewStage.tsx`) the invariant is not re-enforced but *consumed*: they
  clamp their own query/range at `sourceDuration` regardless of what
  `trimStart`/`duration` say, which is what makes Case A safe to reach even
  from a state `resolveDragEdge` didn't produce (e.g. a project loaded from
  an old save, or the drop-zone re-assign path at `App.tsx`'s asset-assign
  handler, which sets `trimStart: 0` but does not itself check
  `sourceDuration` against the segment's existing `duration`).

### `dragGeometry.test.ts` PART 1 — every expectation that changed

PART 1's oracle function was rewritten (`preK16Commit` → `preBatchBCommit`,
now historical-reference-only, plus a new `postBatchBCommit` as the sweep's
actual oracle). The sweep itself (all edges × all fixtures × 0–25s in 0.25s
steps) no longer asserts a `playbackSpeed` field at all — instead, four new
PART 1b tests pin the specific cases where old and new values disagree,
with the reasoning inline:

1. **Video segment dragged to stretch past 2× clip length** (`sourceDuration:
   12, trimStart: 1` → `clipLen 11`, dragged to ask for `duration: 25`). OLD:
   `duration` clamped to `22` (`clipLen / MIN_SPEED`), `playbackSpeed` set to
   `0.5`. NEW: `duration` is exactly the raw `25`, no `playbackSpeed` field
   at all. **Why new is correct**: this is the ruled behavior itself — a
   video segment's duration is no longer bounded by its clip length at all;
   the tail is handled by the freeze mechanism, not by refusing the drag.
2. **Video segment dragged to squeeze below 0.5× clip length** (same
   fixture, dragged to ask for `duration: 2`). OLD: `duration` floored to
   `5.5` (`clipLen / MAX_SPEED`), `playbackSpeed` set to `2.0`. NEW:
   `duration` is exactly `2`. **Why new is correct**: same reasoning as
   (1) — no clip-length-derived floor exists any more.
3. **A `'start'`-edge drag whose raw `trimStart` candidate (`5.9`) stays under
   the Piece 3 bound** (`sourceDuration: 12, duration` floors to `0.3` →
   bound is `max(0, 12 - 0.3) = 11.7`). OLD and NEW both give `trimStart:
   5.9` — a deliberate **non-change** case, included to prove the new clamp
   is a no-op when the old, unbounded value already happens to be legal, not
   just when it's forced.
4. **A `'start'`-edge drag whose raw `trimStart` candidate (`4.9`) exceeds a
   short clip's bound** (`sourceDuration: 4, duration` floors to `0.3` →
   bound is `max(0, 4 - 0.3) = 3.7`). OLD: `trimStart: 4.9` — already past
   the clip's own 4s length, uncorrected. NEW: `trimStart` clamped to `3.7`,
   and the test additionally asserts `trimStart + duration <= 4`. **Why new
   is correct**: this is Piece 3's actual root-cause fix for the slip-bar
   overflow — the old value is provably invalid (past the clip's real
   length) and the new one is the tightest legal value that still reflects
   the drag direction.

### Why `plainSegment.ts`'s exclusion was retargeted, not deleted

The Tier-1 fast path this gate guards (`encodePlainVideoSegment`,
`segmentEncoder.ts`) is a single `ffmpeg -ss trimStart -t duration` trim+
scale call with no padding step. Before this batch, the gate excluded any
segment with `playbackSpeed !== 1` because the fast path cannot re-time
source frames (no speed-aware filter in that ffmpeg invocation). Removing
`playbackSpeed` as a concept doesn't remove the underlying constraint the
gate exists to protect — it changes what can violate it. Now the failure
mode is Case A specifically: if `availableClipLen < duration`, asking
`ffmpeg -ss trimStart -t duration` for more seconds than the clip actually
has produces a SHORTER output file than `duration` (ffmpeg trims to what
exists, it does not pad), which would silently break the `Σ segment duration
= voiceoverDuration` invariant (`CLAUDE.md` §4). So the gate's job is
unchanged — "exclude anything the fast path can't correctly produce" — only
the specific condition that can go wrong changed from a speed mismatch to a
length mismatch. Case B (clip at least as long as the segment) has no such
problem — a plain trim window is exactly what the fast path already does —
so it stays fast-path eligible, unlike before Batch B where ANY
`playbackSpeed !== 1` was excluded regardless of direction.

### Not verified

**No export has been watched, and no preview session has been played through
a Case A (freeze) or Case B (trimmed-window) tail in the running app, as part
of this session.** Everything above about actual on-screen/in-file behavior
during the frozen tail is either (a) traced through code with a specific
citation (WebCodecs preview's decode-pool selection rule, legacy export's
plain-seek semantics), or (b) an explicitly labeled assumption resting on
standard platform behavior that was not exercised (WebCodecs export's decode
loop, legacy preview's reliance on native `<video>` end-of-playback pause).
`npm run lint`, `npm test`, and the golden replay are the only checks this
session actually ran. The owner's manual test — a real MP4 export plus both
preview paths, against a project with at least one Case A (short-clip) and
one Case B (long-clip) video segment — is the gate before commit, per the
batch's own instruction, and is the only thing that can convert the
"reasoned but unverified" claims above into confirmed ones.

---

## Batch B tail defect — owner manual test, investigation, root cause, fix

**The defect, as reported.** Video segment, clip ~10s, segment duration
~3.4s (Case B, long clip). Dragging the bottom drawer's Clip Trim slider
toward the right/end of the clip: the segment sometimes stalled/froze,
sometimes showed a black frame, and no effects/transitions rendered at that
segment's boundary. Exports (both Case A and Case B) passed, and the full
`docs/wkwebview-drag-checklist.md` passed. That export/preview split was the
strongest clue and is exactly where the investigation below lands.

### Investigation — hypotheses worked, with verdicts

The prompt's own hypothesis list assumed the bug would be arithmetic (a
clamp/boundary mistake in the trimStart/sourceTime math this batch touched).
It is not — every one of those hypotheses is ruled out by reading the code:

1. **Two different clamp bounds** — ruled out. `resolveDragEdge`
   (`dragGeometry.ts:220-226`) and `BottomDrawer.tsx`'s own three drag
   handlers (`BottomDrawer.tsx:212,249,277` in the pre-fix file — computing
   `maxStart`) all use the identical `Math.max(0, srcDur - duration)`
   formula, and `srcDur` reads `s?.sourceDuration ?? 0` (`BottomDrawer.tsx:87`
   pre-fix) — no `?? 60` fallback anywhere. No divergence.
2. **Boundary-exact request** — real (at max slip `trimStart + duration ===
   sourceDuration` exactly) but not causal. `sourceRange`'s `end` clamps to
   exactly `sourceDuration` (`useWebCodecsPreview.ts:151-158`) by design —
   this is the intended Case B boundary, already covered by an existing test
   (`useWebCodecsPreview.test.ts`'s Case B `sourceRange` assertion at the
   exact `trimStart + duration === sourceDuration` condition), and that test
   passes unchanged before and after this fix.
3. **Freeze clamp firing where it shouldn't** — ruled out. `toSourceTime`'s
   `Math.min(rawTime, segment.sourceDuration)` clamp (`useWebCodecsPreview.ts
   :136-143`) is a no-op in Case B by construction: `rawTime` never exceeds
   `sourceDuration` within the segment's own span once `trimStart` is
   correctly bounded upstream.
4. **`sourceRange` overrunning** — ruled out. Clamped to `Math.min(rawEnd,
   sourceDuration)` (`useWebCodecsPreview.ts:151-158`); given the maxStart
   bound, `rawEnd` never exceeds `sourceDuration` in this repro at all.
5. **Seek/keyframe behavior deep into the clip** — confirmed, but refined:
   the mechanism is not "a deep seek is unstable," it's that the decode
   session gets torn down and rebuilt from scratch on every single
   `pointermove` tick of the drag (see Root Cause below).
6. **Null frame → effects skipped** — confirmed as the symptom-level
   explanation. `useGlPreview.ts`'s render effect (`useGlPreview.ts:493-511`)
   and `PreviewCanvas.tsx`'s draw effect (`PreviewCanvas.tsx:106-119`) both
   deliberately *retain* the last painted frame rather than clearing when a
   resolved frame is null — a session that never finishes producing even one
   frame leaves the canvas exactly as it was (nothing ever drawn reads as
   black; a frame that did land earlier reads as frozen). The transition
   path (`useGlPreview.ts:508-511`) requires both sides' frames non-null to
   render a blend — a churned segment's frame staying null blocks the
   transition from ever rendering, which is "no effects/transitions render
   at that segment's boundary."
7. **Why export escaped it** — confirmed. `frameRenderer.ts`/`exportWorker.ts`
   run once, sequentially, over an already-committed, static project. There
   is no live drag in progress and no repeated `onUpdateSegment` call during
   export — the decode/seek for each segment happens once and is never
   invalidated mid-flight by a competing commit. The bug lives entirely in
   the live-editing gesture, not in any value that ends up stored.

**Both preview paths, or just one?** Only **WebCodecs/GL**, confirmed by
reading (not inferred): the legacy `<video>` path's segment-seek effect
deliberately depends only on `[currentSegment?.id]` (`PreviewStage.tsx:883-
894`, comment explicit about avoiding "every state update"), and that whole
effect is a hard no-op whenever the WebCodecs path is active
(`PreviewStage.tsx:905`: `if (useWebCodecsPathRef.current) { setCoverState
(null); return; }`) — which it is by default per `CLAUDE.md`.

### Root cause (confirmed, single mechanism, all three symptoms)

`BottomDrawer.tsx`'s three Clip Trim drag handlers (the fill/slip drag, the
left handle, the right handle) called `onUpdateSegment` — a full, immutable
`setProject` — inside their `pointermove` listener, on **every raw pointer
event**, unthrottled, with no live-preview/commit-on-release split. This
directly contradicts the pattern `Timeline.tsx`'s own resize-drag
(`dragSession.ts`) was deliberately built around: `dragSession.ts:208`'s own
comment states the live gesture "avoid[s] a per-move setProject/full
re-render," committing exactly once, at `pointerup`
(`dragSession.ts:519-561`).

Each of those per-tick `onUpdateSegment` calls rebuilds `project.segments`
immutably, which makes `App.tsx`'s `currentSegment` (`App.tsx:3414-3424`, a
`useMemo` over `project.segments.find(...)`) a **brand-new object every
tick** — it is never frozen for this gesture the way a Timeline resize-drag
freezes it via `isResizingRef` (`App.tsx:3415-3419`): `BottomDrawer.tsx`
never touches that ref at all (confirmed by grep — no reference in the
file). `currentSegment` is a dependency of `useWebCodecsPreview.ts`'s
decode-ahead effect (`useWebCodecsPreview.ts:547-588`), so
`VideoDecoderPool.ensureSession` (`videoDecoderPool.ts:250-267`) sees
`startSec`/`endSec` differ from its cached session on every tick and, per
its cache-miss branch, **closes the existing session and starts an entirely
new one** — an async pipeline (demux lookup, decoder-handle acquire,
`configure()`, `seedWindow`, `fillWindow` awaiting real decoder output) —
dozens of times per second, racing against itself. A session that gets
invalidated before it ever produces a frame leaves `useWebCodecsPreview`'s
`frame` state null; downstream, both the GL and Canvas2D paint paths retain
rather than clear on null (hypothesis 6 above), so the visible result is
either nothing ever painted (black) or a stale frame that stops advancing
(freeze) — both faces of the same "the session never gets to finish" race.
This pre-dates Batch B (the same per-tick `trimEnd` write existed before it
too — `sourceRange` just read `trimEnd` instead of `sourceDuration` — so the
churn was already there); Batch B did not introduce it, the owner's manual
test of Batch B's Clip Trim bar surfaced it.

### The fix

`BottomDrawer.tsx` — the three drag handlers no longer call `onUpdateSegment`
inside `pointermove`. A local `liveTrimStart` (state + a mirroring ref, so
the `pointerup` handler can read the latest value synchronously without
depending on a stale closure) drives the bar's rendered geometry
(`leftPct`/`rightPct`) and time labels live during the gesture, exactly
matching what the user's pointer is doing; the actual `onUpdateSegment`
commit happens exactly **once**, in the `pointerup`/cleanup handler, using
the final live value — mirroring `dragSession.ts`'s own commit-once-at-
release pattern for the identical class of problem. No math changed: the
`maxStart = Math.max(0, srcDur - s.duration)` clamp and the ratio arithmetic
in all three handlers are untouched, since they were never the bug. A
`useEffect` resets `liveTrimStart` to null whenever the drawer's target
segment (`s?.id`) changes, guarding against a stale live override leaking
into a different segment's rendering if the drawer's target changes out from
under an in-flight gesture.

This is a single, minimal-diff change confined to `BottomDrawer.tsx` — no
other file in Batch B's diff needed touching, and none of Batch B's own
`trimStart`/`sourceDuration`/freeze-tail math changed.

### Test coverage — what's pinnable, what isn't

**A unit test cannot reach the actual runtime failure.** The real defect is
an async decode-session race against a live `VideoDecoder` inside jsdom-free
territory — no WebCodecs decoder, no real decode timing, no real frame
delivery exists in the test environment, so no jsdom test can observe a
black frame or a stall the way the owner did. Adding another `toSourceTime`/
`sourceRange` boundary-math test would be "pretending coverage": that math
was never wrong, and `useWebCodecsPreview.test.ts`'s existing Case B
boundary test (`sourceDuration: 25, trimStart: 20, duration: 5` — a max-slip
case structurally identical to the owner's, `useWebCodecsPreview.test.ts:155
-160`) already pins it, unchanged by this fix.

What **is** pinnable is the actual trigger this fix removes: how many times
a Clip Trim drag gesture calls `onUpdateSegment`. New test
`src/components/BottomDrawer.trimDrag.test.tsx` (`// @vitest-environment
jsdom`, mounts the real `BottomDrawer` via `react-dom/client`'s `createRoot`
and dispatches real `PointerEvent`s — the same jsdom-real-DOM approach
`dragSessionHarness.ts` already established as this repo's precedent for
gesture-level tests) drives a 5-tick drag of the fill toward the clip's end,
using the owner's exact numbers (10s clip, 3.4s segment, max slip 6.6), and
asserts: zero `onUpdateSegment` calls during any `pointermove`, and exactly
one call at `pointerup`, with `trimStart` clamped to `6.6` and `trimEnd` to
`10`. **Verified fails before this fix** (asserting on the pre-fix handler
reproduces exactly 5 calls, one per tick, with the last two both landing on
the clamped `6.6` value) **and passes after.** This proves the trigger
(excess project commits during the gesture) is closed; it does not and
cannot prove the downstream decode-session race can never manifest for some
other reason — that remains the owner's manual test to confirm.

### What remains unverified

Everything this audit's own "Not verified" section above already flagged
(WebCodecs export's decode loop, legacy preview's native end-of-playback
reliance) is still unverified — this pass did not touch either. New to this
pass: **the fix itself has not been watched in the running app.** The owner
should re-drag the Clip Trim slider toward the clip's end on a Case B (long
clip) video segment and confirm the preview no longer stalls, blacks out, or
drops transitions at that segment's boundary — the exact repro from the top
of this section, re-run against the fix.

---

## Batch B tail defect, second pass — the pointerup fix was not the cause

**Status of the previous section.** The commit-once-at-release fix
(`BottomDrawer.tsx`, previous section) is correct and stays — it removes a
real per-tick `setProject` churn. But the owner re-tested against it and the
freeze/black-frame persisted, so it was not the root cause. This pass
re-opened the investigation from scratch and **reproduced the defect**, which
the previous pass never did (its own "What remains unverified" section says
so).

### The prompt's three hypotheses — all disproven, empirically

1. **Live slip override exceeding `sourceDuration - duration`.** Not
   reachable. All three Clip Trim handlers clamp to
   `maxStart = Math.max(0, srcDur - s.duration)` (`BottomDrawer.tsx`), and
   `liveTrimStart` never reaches the preview at all — it drives bar geometry
   and labels only, by construction of the previous fix.
2. **An EOF stall / null / throw at `t = sourceDuration`.** Driven directly
   against the real `VideoDecoderPool` with an **asynchronous** decoder mock
   (the existing suite's mock emits synchronously and hides decode timing),
   sweeping a max-slip segment: `0 decoder resets, 1 flush`, a correct frame
   at every tick including exactly `t = sourceDuration`. No null, no throw,
   no stall. A safe-EOF epsilon would be inert here, and at >25fps it would
   additionally select the second-to-last frame instead of the last — a
   silent change to the freeze semantics with nothing to buy for it. **Not
   applied**, deliberately.
3. **Null-frame blend skipping.** Already handled: `useGlPreview.ts`'s
   `resolveSlotSource` rejects a closed frame via its `displayWidth === 0`
   read and `uploadSlot` catches the upload race, both retaining the last
   good draw by design.

Also checked and cleared: the commit's session teardown/rebuild orchestration
(simulated faithfully with the hook's own exported chase primitives — the
frame-pull effect recovers in both the playing and paused cases, with and
without keying its epoch on the source range), and `MAX_SESSION_FRAMES`
(600 — far out of reach for the reported ~10s clip).

### Root cause — a stale clip length, not a timing bug

`segment.sourceDuration` was written in exactly **one** place —
`parseProjectData` (`App.tsx`) — and refreshed by **nothing**. Three live
paths reassign a segment's `assetId` without touching it:

- `SegmentControls.tsx`'s asset dropdown — which sits in the very drawer that
  hosts the Clip Trim bar,
- the stock-search assign in `App.tsx` (it resets `trimStart: 0`, showing the
  author knew trim state is asset-relative, but not the length),
- `autoMatchSegments` (`syncEngine.ts`).

A stale-**long** value inflates `maxStart`, so max slip commits a `trimStart`
whose window lies past the new clip's real media. Reproduced against the real
pool — segment claims a 10s clip, media is 4s:

```
STALE    -> 3.9666 3.9666 3.9666 3.9666 3.9666 3.9666 3.9666 3.9666 3.9666  (1 distinct frame)
ACCURATE -> 6.5999 6.9999 7.3999 7.7999 8.1999 8.5999 8.9999 9.3999 9.7999
```

One frame held for the entire segment, **no error and no null** — which is
why nothing surfaced it. It matches every reported symptom: it worsens as the
slip moves toward the end (more of the segment lands past real media), it is
intermittent (only after an asset reassignment), it is invisible to export
(ffmpeg `-ss/-t` trims to what exists), and the drawer's own `10.0s total`
label reads the same stale field so the UI cannot contradict it. A
commit-frequency fix could never have touched it.

A partial-overhang variant of the same mechanism is reachable without any
reassignment: `getMediaDuration` reads `HTMLVideoElement.duration` (the
container's length), which exceeds the video track's last PTS whenever the
audio track is longer — the segment then freezes for exactly that overhang.

### The fix — owner ruling: derive the length from the Asset

`Asset.duration` is now the single source of truth, probed once per asset at
every creation site (mirroring the existing `nativeFps` pattern):
`persistFileToAsset`, `processMediaFile` (the drop-zone/file-picker path),
both ZIP import paths, and stock download — plus a back-compat backfill at
the one place stored blob URLs are recreated, so an older project keeps its
trim bar instead of declining for the whole session.

`VideoSegment.sourceDuration` is **deleted**, and `projectStore.ts` strips it
on load beside the existing `playbackSpeed` strip — a stored copy is not just
redundant, it can be wrong. `toSourceTime`/`sourceRange` take the length as an
explicit parameter (in `useWebCodecsPreview.ts` and its three duplicated
mirrors: `exportWorker.ts` and the two dev spikes), and every caller resolves
it from the asset it already has in hand. `resolveDragEdge` takes it as its
own `DragEdgeInput` field; `dragSession.ts` reaches it through a new narrow
`getSourceDuration` dep rather than re-adding the whole `getAssets` config
Batch B removed. `plainSegment.ts` and `buildFreezeFrameEntries` look it up
from the project's assets. This makes the stale state **unrepresentable**
rather than merely corrected.

### Verification

`npm run lint` clean; `npm test` 1777 passed / 1 pre-existing skip / 71 files;
`scripts/phase4-handoff-replay-sync.test.ts` 3/3 byte-identical.

Two new tests in `BottomDrawer.trimDrag.test.tsx` pin the defect: a segment
pointed at a shorter asset slips against the **short** clip (`trimStart` 0.6,
not 6.6), and an asset with no probed duration hides the bar rather than
guessing. **Verified discriminating** — both fail when the old stale-length
read is temporarily restored (`expected 6.6 to be close to 0.6`) and pass
after.

### Not verified

No export has been watched and no preview session has been played in the
running app during this pass. The reproduction is against the real
`VideoDecoderPool` with a mocked decoder, which is strong evidence for the
*mechanism* but is not the running app. **The owner's manual retest is still
the gate**: re-drag the Clip Trim slider toward the end of a long-clip
segment — ideally one whose asset was reassigned after Apply Sync, which is
the condition that triggers it — and confirm the preview advances instead of
holding one frame.

## Batch B tail defect, third pass — concurrent `getFrameAt` on one decode session

**Status of the previous two passes.** Both fixes were real improvements and
both stay: the commit-once-at-release change (`BottomDrawer.tsx`) removes a
genuine per-tick `setProject` churn, and the `Asset.duration` refactor makes a
stale clip length unrepresentable. Neither was the cause — the owner retested
after each and the freeze/black-frame persisted. This pass found a defect in a
different layer entirely, and one that no unit test could have caught because
every existing test upholds by construction the exact invariant that the
running app violates.

### Ruled out first (empirically, against the real `VideoDecoderPool`)

- **B-frame decode order.** `videoDemuxer.ts` pushes chunks in container
  (decode) order but timestamps them with `sample.cts` (presentation time), so
  for any B-frame clip `DemuxedVideo.chunks` is genuinely NOT ascending by
  timestamp — while `findChunkRange` and `feedWindow` both assume it is. Every
  test in `videoDecoderPool.test.ts` uses strictly ascending timestamps, so
  this is untested. Probed with a realistic IPBBB decode-ordered chunk list
  plus a reorder-buffer decoder mock, sweeping a 3.4s segment at trimStart 0 /
  3.3 / 6.6: **19/19 distinct, correctly advancing frames in every arm, 0
  stalls, 0 nulls, 0 resets.** The ordering assumption is technically wrong but
  the pool absorbs it. Not the cause; left alone deliberately.
- **The slip commit's session teardown/rebuild.** Simulated the real gesture —
  a live session at `trimStart=0`, then `ensureSession` with the new
  `[6.6, 10]` range — across five arms: fresh session, slip-replace, slip while
  a `getFrameAt` is still in flight, four successive slips, and two segments
  sharing one asset (exercising the decoder-handle recycle path). **All five
  produced 13/13 correct frames, 0 nulls, 0 stalls.** The pool handles the slip
  commit correctly.

### Root cause — three chases, three mutexes, one session

`videoDecoderPool.ts`'s `getFrameAt` is **not re-entrant per session**, and
nothing in the class enforces it. Per call it closes every buffered frame older
than the one it selects, closes the previous `displayedFrame`, and advances
`retainedFloorUs`; a divergent second target additionally trips `needsReset`,
whose `resetSessionWindow` discards the entire frame buffer and re-seeds the
decoder at that other target's keyframe. The module header states the rule
callers must uphold — "at most one `getFrameAt` call in flight per session" —
and `useWebCodecsPreview.ts` upholds it with a chase mutex.

But that mutex is per-**chase**, not per-**session**, and there are three
chases against one pool: `useWebCodecsPreview`'s current-segment pull, and
`useGlPreview`'s outgoing and incoming transition chases. Each holds its own
`ChaseMutex`; none can see the others.

The incoming chase was written with a guard — it declines to run while
`currentSegment?.id === incomingVideoSeg.id`. **The outgoing chase had no such
guard**, on the strength of a claim in `resolveVideoFrame`'s own comment that
the three frame tags "never collide for the same seg at the same tick." They do
collide. A centered (D7) transition window opens `duration/2` BEFORE the A/B
boundary, so for that entire pre-boundary half `currentTime` is still
bounds-inside the OUTGOING segment — `currentSegment.id ===
outgoingVideoSeg.id`. The incoming chase's own comment says exactly this. So
across every transition window, `useWebCodecsPreview` and `useGlPreview` called
`getFrameAt` on one session concurrently.

Reproduced against the real pool (10s clip, keyframes every 2s, segment
`[6.6, 10]`, async-output decoder):

```
concurrent targets 9.90 / 9.95 -> A=9.900 (ALREADY CLOSED)  B=9.933
concurrent targets 6.70 / 9.90 -> A=8.000 (asked 6.70!)     B=9.900
```

One caller is handed a frame the sibling already closed; with divergent targets
a caller is answered with a frame **over a second wrong** — the keyframe the
sibling's reset re-seeded at. Sequentially, the identical targets are correct.

This accounts for every reported symptom. A closed frame reads back 0×0, so
`useGlPreview`'s `resolveSlotSource` returns null (or `uploadSlot`'s
`texImage2D` throws), and the render effect returns early to **retain the last
good draw** — which is precisely "the preview freezes with the previous
segment's frame fully covering this video segment." When slot `b` is the
casualty the blend collapses to outgoing-alone — "loses boundary transitions."
When it lands before any good draw, the canvas is **black**. And since it is
the *transition window* that creates the overlap, "near max slip" is
transition-boundary behaviour, not a trim-arithmetic bug — which is why two
passes of trim-arithmetic fixes did not touch it.

### The fix

`useGlPreview.ts` gains `canChaseTransitionFrame(enabled, chaseSegmentId,
currentSegmentId)` — one exported pure predicate now shared by BOTH chases,
encoding the single rule they must obey: never pull a session
`useWebCodecsPreview` is already pulling as `currentSegment`. The incoming
chase's inline guard is replaced by it (same semantics); the outgoing chase
gains it, and `currentSegment?.id` is added to that effect's dependency array.
Nothing is lost visually — `resolveVideoFrame`'s priority 1 (`currentFrame`,
matching segment id) already supplies that slot for exactly this half, which is
why the collapse was silent. Post-boundary, `current` moves to the incoming
segment and the outgoing chase resumes, which is the case it exists for.
`resolveVideoFrame`'s "never collide" comment is corrected in place, since that
claim is what licensed the missing guard.

### Verification

`npm run lint` clean; `npm test` 1785 passed / 1 pre-existing skip / 71 files
(+8 new); `scripts/phase4-handoff-replay-sync.test.ts` 3/3 byte-identical.

Five tests pin the rule in `useGlPreview.test.ts`; three characterization tests
in `videoDecoderPool.test.ts` pin the underlying non-re-entrancy (concurrent →
closed frame / wrong frame; sequential → correct), so if the pool is ever made
genuinely re-entrant those tests fail and signal that the upstream guard may be
relaxed.

### Honest coverage gap

This repo has no jsdom/@testing-library/react, so the hook itself cannot be
rendered in a test. The predicate is tested and the pool hazard is tested, but
**nothing fails if a future edit deletes the guard from the effect** — the same
accepted gap CLAUDE.md already records for DOM-touching hooks. A test that
could catch it needs a React test harness, which is a separate decision.

### Not verified

Not watched in the running app. The reproduction is against the real
`VideoDecoderPool` with a mocked decoder — strong evidence for the mechanism,
and unlike the previous two passes it explains the transition-loss symptom
directly, but **the owner's manual retest is still the gate.** Re-drag the Clip
Trim slider toward the end of a long-clip segment and watch a boundary
*with a transition set* on it.

### Recommended follow-up (not done — owner's call)

Make the invariant unrepresentable rather than merely upheld: serialize
`getFrameAt` per session inside `VideoDecoderPool` (a per-session promise
chain), so a fourth caller cannot reintroduce this class of bug. Deferred here
because it changes pool timing semantics — a current-segment pull could queue
behind a transition pull — which deserves its own measurement pass rather than
riding along with a defect fix.

---

## Batch B tail defect, fourth pass — serialization implemented, owner retest: **still fails**

Implemented the third pass's own recommended follow-up: `VideoDecoderPool.getFrameAt`
now enforces "at most one call in flight per session" itself (per-session
`queueTail` + `turnRunning` + a coalescing `pendingCall`, see the class's own
doc comment in `videoDecoderPool.ts`). Two regression tests were added
(`videoDecoderPool.test.ts`): the divergent-target failure shape is a
rigorously verified red-before/green-after test (reverting the source
reproduces the exact ~8.0s wrong-keyframe answer this investigation found;
the fix produces the correct ~6.7s answer). The close-target
("already-closed frame") shape does **not** discriminate pre/post-fix with
this file's synchronous mock — traced to JS's single-threaded execution
making each call's post-`fillWindow` tail atomic, so two calls' tails cannot
literally interleave regardless of serialization; this was reported
honestly at the time rather than claimed as fixed. `npm run lint` clean,
`npm test` 1786/1 skip, golden replay 3/3, `cargo check` clean.

**Owner manually retested against the exact repro (10s clip, ~3.4s segment,
boundary with a transition set): the bug is unchanged.** Three code-reading
fixes (commit-once-at-release, `Asset.duration` single source of truth,
transition-chase serialization) have now missed the actual cause.

### New owner observations (ground truth — override every theory above)

1. **Slider at the extreme left → plays fine.**
2. **Removing all animations and transitions has no effect** — the bug still
   appears as the slider reaches mid-to-end, and clears when dragged left
   again.
3. **Undo/redo and reloading a project saved at max slip → bug persists.**

**Observation 2 directly falsifies the transition-chase collision theory**
that motivated patch #3 (`canChaseTransitionFrame`) and this pass's own
serialization work — both were built to fix a hazard between the outgoing/
incoming transition chases and the current-segment pull, and that hazard
cannot be the cause of a bug that reproduces with transitions removed
entirely. Observations 1 and 3 say the failure is **positional** — a
function of how deep into the source clip `trimStart` (and so the requested
decode target) sits — not of gesture timing, concurrency, or app state:
`chunks[]` is a property of the demuxed file itself, re-derived identically
from the same bytes on every `getOrCreateDemux` call, so a bug that depends
only on *where* in that array a target falls would reproduce identically on
a fresh reload or after undo/redo, exactly as observed. Also worth noting,
traced by reading (not yet confirmed against data): `BottomDrawer.tsx`'s
three Clip Trim drag handlers only ever call `onUpdateSegment` at
`pointerup` (the first-pass fix, still in place) — nothing moves
`currentTime` during the drag itself, so the preview shown while dragging
reflects whatever `currentTime` already was, and the actual "deep source
time" request only happens once the drag commits (or a saved project
reloads at that `trimStart`). If confirmed, this means the bug needs no
drag gesture, no timing race, and no concurrency at all to reproduce — a
single `getFrameAt`/`ensureSession` call seeded at a large enough source
time would be sufficient. This is a hypothesis the instrumentation below is
built to confirm or refute, not a conclusion.

**Patch #3 (`canChaseTransitionFrame`) and this pass's per-session
serialization are now unjustified by evidence** — both were built against a
theory observation 2 falsifies. **Neither has been reverted.** They stay in
place until the real cause is found and a decision is made about whether
either is independently worth keeping (per Stage 3's own instruction: no
fifth fix, evidence first).

### Part A — B-frame chunk-ordering re-examined against the positional symptom

**Verdict: plausible — and, unlike the third pass's dismissal, consistent
with all three new observations.** Not fixed; read-only per this pass's
scope.

`videoDemuxer.ts`'s `onSamples` callback (`demux()`) pushes `chunks` in the
order `mp4box` delivers samples — **container (decode) order** — but
timestamps each one with `sample.cts` (**presentation** time,
`videoDemuxer.ts:88`). For any source with B-frames, decode order and
presentation order diverge, so `chunks[]` is architecturally guaranteed to
be non-monotonic in `timestamp` for a real encode — this is not a
synthetic-only concern.

`findChunkRange` (`videoDecoderPool.ts`) is a **plain linear scan from index
0**, not a binary search, and its correctness depends on ascending order:
the `startIndex` loop `break`s at the first chunk whose timestamp exceeds
`startUs`, assuming (without checking) that every later chunk also exceeds
it. On a non-monotonic array this assumption can be locally violated: a
decode-order P-frame with a `cts` numerically ahead of the B-frames that
follow it in the array (a normal artifact of B-frame reordering — see
`docs/history.md`'s "B-frame decode order" note referenced by the third
pass) can trip the `break` before the scan reaches the chunk range's true
correct position. The `endIndex` loop has the identical `break`-on-first-
exceed assumption.

**Why this wasn't disproven by the third pass, only dismissed.** That pass's
own probe used a hand-constructed "realistic IPBBB" synthetic chunk list —
a small, fixed, uniform reorder pattern — and found 0 stalls/nulls/resets.
It did not use chunks from an actual demuxed file, whose real encoder (GOP
structure, adaptive B-frame count, scene-cut keyframes, variable reorder
distance) may produce a materially different, less uniform ordering than
the synthetic probe assumed. "Dismissed with synthetic data" and "disproven"
are not the same claim, and the prompt's own framing of this re-examination
is correct to distinguish them.

**Does this explain the POSITIONAL symptom specifically?** Not proven by
reading alone — flagging this honestly rather than overclaiming. The
mechanism (a local reordering artifact tripping an early `break`) recurs at
every GOP boundary structurally, not obviously worse deep in the file than
near the start, by the algorithm's own logic. But there is a plausible,
non-rigorous reason it could still manifest as "fine at the very start,
degrades mid-to-end": near `targetSec ≈ 0`, the absolute `cts` values in
play are too small for any local reorder spike to exceed the target at all
(a P-frame's "ahead" timestamp is bounded by the GOP's own reorder
distance, typically well under a second); at larger target times the
absolute values are large enough that a local artifact can plausibly
straddle the target. This is exactly the kind of claim that needs the
monotonicity audit and chunk-range-lookup data below to confirm or refute —
not more reading.

### What the instrumentation captures

New temporary module `src/dev/ws3Diagnostics.ts` (single `WS3_DIAG_ENABLED`
flag; rip out this file and its guarded call sites in one commit once done).
A fixed-capacity (6000-record) circular buffer — O(1) push whether full or
not, so logging doesn't itself perturb the timing being measured; nothing is
serialized until the recording is actually dumped. Every record carries a
sequence number, `performance.now()` timestamp, and the Clip Trim slider's
current ratio (0=left..1=right, set by `BottomDrawer.tsx` on every
`pointermove`) so left/mid/end zones can be correlated directly.

Captured, wired into `videoDecoderPool.ts`, `useWebCodecsPreview.ts`,
`useGlPreview.ts`, and `BottomDrawer.tsx`:
- **Every `getFrameAt` call**: session key, caller tag (`current-decode-ahead`
  / `current-pull` / `boundary-prepull` / `outgoing-chase` / `incoming-chase`),
  requested target.
- **Every `getFrameAt` result**: `frame` / `null` / `closed` (closed frames
  are detected the same way `useGlPreview.ts`'s own `resolveSlotSource`
  does — `displayWidth`/`displayHeight` reading 0, since a real `VideoFrame`
  has no public "is it closed" getter), the resolved frame's own timestamp,
  whether a reset/re-seed fired, and the keyframe chunk index seeded from
  when it did.
- **Every session lifecycle event** (create/replace/teardown): asset URL,
  `[startSec, endSec]`, and — at creation only — the monotonicity audit
  (`auditMonotonicity`): total chunk count, adjacent-pair inversion count,
  and the index of the first inversion. This is the direct evidence Part A's
  verdict needs.
- **Every chunk-range lookup** (`seedWindow`'s call into `findChunkRange`):
  requested target/end, the returned `[startIndex, endIndex]`, the
  timestamps at both ends of that range, and whether the requested target
  actually falls inside it — a `false` here on a real file is direct
  confirmation of Part A's hypothesized failure mode.
- **Every render tick**: `painted`, or which specific retain branch fired
  (`retained-no-plan` / `retained-a-missing` / `retained-a-upload-failed` /
  `retained-b-missing` / `retained-b-upload-failed`) — pinpoints whether a
  stall is "slot a never resolves," "slot a resolves but upload throws
  (closed-frame race)," or the transition-slot equivalent.
- **Every gesture sample** (`pointermove` on any of the three Clip Trim
  handles): which handle, `trimStart`, segment `duration`, `Asset.duration`,
  and the `maxStart` clamp bound actually applied.
- **Every source-time computation** (`toSourceTime`'s five call sites):
  caller tag, `trimStart`, `currentTime`, `sourceDuration`, the raw
  (unclamped) time, whether the `sourceDuration` clamp actually engaged, and
  the final computed source time — lets the owner see whether the numbers
  going in are sane before blaming what happens downstream, per the prompt's
  own instruction.

Output: `window.__WS3_DIAG__.copyToClipboard()` (primary — copies the full
JSON dump directly) or `window.__WS3_DIAG__.download()` (saves a
`ws3-diag-<timestamp>.json` file via the browser's normal download flow).
`window.__WS3_DIAG__.clear()` resets the buffer between recordings;
`window.__WS3_DIAG__.count()` reports how many records are currently held.

### Recording script for the owner

Run in `npm run tauri:dev` (the only place the WebCodecs preview/decode path
is live). Open DevTools first if you want to run the console commands below
via the DevTools console — otherwise a keyboard shortcut isn't wired up this
pass, so the commands must be typed there.

1. Open a project with a video segment whose clip is meaningfully longer
   than the segment (a good Case B candidate) and, ideally, one whose
   trailing boundary has a transition set (matches the original repro).
   Open its Clip Trim bar in the BottomDrawer.
2. In DevTools console, run `window.__WS3_DIAG__.clear()` to start from an
   empty recording.
3. **Recording 1 — full sweep, transitions ON.** Slowly drag the Clip Trim
   slider from the far left toward the far right, **pausing for ~1-2 seconds
   at three points**: near the left edge, near the middle, and near the
   right edge (where the bug reproduces). This puts all three zones — good,
   transitional, and bad — into one recording for direct comparison. Watch
   for the stall/black-frame/missing-transition symptom and note roughly
   when (left/mid/end) it appeared.
4. Run `window.__WS3_DIAG__.copyToClipboard()` in the console (or
   `window.__WS3_DIAG__.download()` if clipboard access is blocked) and send
   that JSON back.
5. Run `window.__WS3_DIAG__.clear()` again.
6. **Recording 2 — comparison, transitions OFF.** Remove the transition from
   that segment's trailing boundary (per owner observation 2) and repeat the
   same slow left → mid → end drag with pauses. Copy/download and send this
   recording too, labeled separately from Recording 1.
7. If convenient, a third short recording: reload the project after saving
   it with the slider left at max slip (per owner observation 3, no drag
   gesture at all — just load and let the segment play/preview once) is
   valuable if it reproduces the stall without any drag ever happening, since
   that would directly confirm the "positional, not gesture-dependent"
   hypothesis above.

Do not diagnose from this data before sending it back — the next theory
comes from what these recordings actually show, not from reading source
again.

---

## Batch B tail defect, fourth pass resolved — `findChunkRange` fixed

The owner's diagnostic recording confirmed Part A directly: record #320
showed `getFrameAt` called with `targetSec: 9.6144`, resolving to
`resultTimestampSec: 3.7916` — a stale, ~5.8s-early frame — with the
session's own monotonicity audit showing 119 timestamp inversions across
240 chunks (`firstInversionIndex: 2`). This is exactly Part A's hypothesized
mechanism, now confirmed from the running app rather than inferred from
reading.

### The fix

`findChunkRange` (`videoDecoderPool.ts`) no longer trusts ANY non-keyframe
chunk's timestamp for range resolution, and no longer early-`break`s on the
first exceedance. It scans keyframe indices only (a full scan, not stopping
early) and takes the LAST keyframe whose own timestamp is at-or-before the
target — correct because keyframe (I-frame) presentation timestamps are
reliably non-decreasing across a whole file even when delta/B-frame
timestamps inside a GOP are not (B-frame reordering is confined within a
GOP, never across a GOP boundary) — a materially weaker, safer assumption
than "the whole array is ascending." `endIndex` is resolved the same way,
extended one GOP further as margin (the GOP-granular equivalent of the
original "one chunk of margin," since a per-chunk margin isn't meaningful
against a non-monotonic array). `videoDemuxer.ts` itself is unchanged — its
decode-order-chunks-timestamped-by-presentation-time output is correct per
the WebCodecs data model; the bug was entirely in how `findChunkRange`
consumed that array.

**A narrower, not-yet-verified scope note.** `feedWindow`'s own incremental
per-chunk boundary check (`chunks[feedCursor].timestamp <= boundaryUs`) has
the same theoretical vulnerability as the old `findChunkRange` — a
non-monotonic array could in principle make a single feed batch stop short
mid-GOP. This pass did not touch it: the reported symptom (a wrong SEED
position, not an incomplete window once correctly seeded) is fully
explained by `findChunkRange` alone, and the fix is scoped to what the
diagnostic evidence specifically implicated. Flagging this as a known,
unconfirmed residual risk rather than asserting it's also fine.

### Test coverage

Two `findChunkRange` fixtures were built: `makeReorderedChunks` (a
realistic per-GOP B-frame decode-order pattern) and
`makeChunksWithEarlyInversion` (one early non-keyframe timestamp spike,
matching the live trace's `firstInversionIndex: 2` shape exactly). Only the
second one actually discriminates the fix — verified by reverting the
source and re-running: `makeReorderedChunks`'s per-GOP spikes stay below a
large target until the scan is already inside the correct GOP, so the old
algorithm happens to still land correctly against that fixture for this
target; `makeChunksWithEarlyInversion` reliably reproduces the reported
symptom class pre-fix (resolves to index 0) and the correct answer post-fix.
This is documented directly in the test file's own comments rather than
left implicit, given this project's history of tests that looked like they
covered a fix but didn't discriminate it. An end-to-end
`VideoDecoderPool.getFrameAt` test (using a reorder-buffering decoder mock,
since the plain synchronous mock used elsewhere in this file doesn't
simulate real decoder output reordering) confirms the same fix at the pool
level, not just the pure function.

### Validation

`npm run lint` clean; `npm test` 1790 passed / 1 pre-existing skip / 71
files (+4 new tests); `npx vitest run scripts/phase4-handoff-replay-sync.test.ts`
3/3 byte-identical; `cargo check` clean — no Rust file touched.

### Not verified

Not watched in the running app. The fix is verified against the exact
numbers the owner's own instrumentation recorded (target 9.6144 → the old
algorithm's shape of failure reproduced and fixed), which is stronger
evidence than the previous three passes had at this stage, but the owner's
manual retest — the same repro, boundary with a transition, dragged near
max slip — is still the gate before this is called closed.

---

## Close-out — baseline cleaned, preview stall still open

The owner ran the full retest matrix against every fix above (real MP4
exports for Case A and Case B, both preview paths, the full
`docs/wkwebview-drag-checklist.md`) and confirmed the cleaned baseline
behaves exactly as it did before this investigation started — no
regression from any of the five passes. What follows is the honest
close-out: what each attempt actually found, which two turned out to be
chasing a falsified theory, what stays and why, and where the original
reported defect — the preview stall — actually stands.

### The five attempts, in order

1. **Commit-once-at-release** (`BottomDrawer.tsx`, first pass). Found a
   real bug: the Clip Trim drag handlers called `onUpdateSegment` on every
   raw `pointermove`, churning `currentSegment`'s identity and tearing down
   the WebCodecs decode session dozens of times a second. Fixed by
   deferring the commit to `pointerup`, matching `dragSession.ts`'s own
   pattern. Real fix, owner-retested — **not the cause** of the reported
   stall (it persisted after this landed).
2. **`Asset.duration` single source of truth** (second pass). Found a
   second real bug: `VideoSegment.sourceDuration` was written once by
   `parseProjectData` and never refreshed by any of the three paths that
   reassign `assetId` afterwards, so a reassigned asset could leave a stale
   clip length that let max slip commit a `trimStart` past the real media.
   Fixed by deleting the cached field entirely and resolving clip length
   from `Asset.duration` everywhere it's needed (now `CLAUDE.md` §4). Real
   fix, owner-retested — **not the cause** either.
3. **`canChaseTransitionFrame` guard** (third pass). Found that
   `useGlPreview.ts`'s outgoing transition chase and
   `useWebCodecsPreview.ts`'s current-segment pull could target the same
   decode session concurrently during the pre-boundary half of a centered
   transition window, and that `videoDecoderPool.ts`'s `getFrameAt` was not
   safe against that — a closed-frame race or a wrong-keyframe answer. Fixed
   by adding a shared guard so the outgoing chase declines to run whenever
   the pull is already covering that segment.
4. **Per-session `getFrameAt` serialization** (fourth pass). Implemented
   the third pass's own recommended follow-up: `getFrameAt` now enforces
   "at most one call in flight per session" itself (`queueTail` +
   `turnRunning` in `videoDecoderPool.ts`), making the invariant
   unrepresentable rather than merely upheld by an upstream guard.
5. **`findChunkRange` keyframe-only scan** (fourth pass resolved). The
   owner's diagnostic recording caught the mechanism directly: a
   `getFrameAt` call for `targetSec: 9.6144` resolved to a frame at
   `3.7916` — 119 timestamp inversions across 240 chunks
   (`firstInversionIndex: 2`). `findChunkRange` was a linear scan that
   trusted every chunk's timestamp and broke on the first one exceeding the
   target; for a B-frame source, interior (non-keyframe) timestamps are not
   reliably ordered, so a local reorder spike could trip that break early
   and hand back a range anchored at the wrong keyframe. Fixed by scanning
   keyframe indices only — keyframe presentation timestamps are reliably
   ordered across a whole file even though delta/B-frame timestamps inside
   a GOP are not. This is a confirmed, real bug, verified against the
   owner's own trace numbers. **The owner retested afterward and the
   preview stall was unchanged.**

### Which two were falsified, and by what

Attempts 3 and 4 were both built on the same theory: that the reported
stall was caused by the outgoing-chase / current-segment-pull collision
around a transition boundary. **Owner observation 2 falsifies this
directly: removing all transitions and animations from the repro segment
did not change the bug** — it still appeared as the slider reached
mid-to-end and cleared when dragged back left. A bug that depends on a
transition being present cannot be caused by a hazard that only exists
when a transition is present and disappears when it isn't. That rules out
the transition-chase collision as the cause of *this* bug, full stop.

### What was kept, and why

- **Attempts 1, 2, and 5 stay** — each is a confirmed, independently real
  bug with its own reproduction, unrelated to the falsified transition
  theory. Reverting them would reintroduce genuine defects (per-tick
  session churn, a stale-clip-length trim bar, a wrong-keyframe range
  lookup) to chase a theory that's already dead. Keeping them costs
  nothing and fixes real problems.
- **Attempt 3 (`canChaseTransitionFrame`) was removed.** Its guard existed
  specifically to keep the outgoing chase and the current-segment pull
  disjoint — a precaution against a race that attempt 4's serialization
  now closes at the source. With the transition-collision theory falsified
  as the cause of the reported stall, there was no remaining reason to
  keep a second, redundant guard for a hazard the pool itself now handles.
  `useGlPreview.ts`'s own comment documents this in place.
- **Attempt 4 (per-session serialization) was kept, despite resting on the
  same falsified premise as attempt 3.** The reasoning: falsifying "this
  hazard causes the reported stall" does not falsify "this hazard exists."
  Three independent chases (`useWebCodecsPreview`'s pull, `useGlPreview`'s
  outgoing and incoming chases) genuinely can call `getFrameAt` on one
  session concurrently during a transition window — that part was
  confirmed by reading the code and is not in dispute, only its
  responsibility for *this* bug is. Serializing `getFrameAt` per session
  closes that hazard permanently and structurally (an invariant the class
  itself now enforces, not one three call sites have to individually
  remember to respect), at effectively no cost — a same-target call
  reuses in-flight work, and normal usage rarely has more than one caller
  per session anyway. Removing it would restore a real, reachable
  correctness gap for no benefit, so it was argued to keep it and the
  owner agreed.

### Current state of the preview stall: unresolved, cause unknown

Five attempts, three of them confirmed-real bugs now fixed, and the
originally reported preview stall is unchanged. This is not a partial fix
or a "probably fixed, awaiting confirmation" — the owner has directly
retested against the exact repro (a long clip, short segment, slider
dragged toward the end) after every pass, including this one, and it still
reproduces. Two pieces of owner evidence narrow, but do not yet solve, the
search:

- **It reproduces on a reloaded project at max slip, with no drag gesture
  at all.** A project saved with the slider left at max slip stalls on
  load and first preview — no `pointermove`, no live commit, nothing
  gesture-timed involved. This clears every gesture-churn and drag-timing
  theory (including attempts 1 and 3's original targets) as *sufficient*
  explanations, even though those fixes stay for their own independent
  reasons.
- **Exports render correctly from the same `trimStart`.** The same source
  time math that stalls in preview produces a correct frame sequence when
  run through the legacy export path (`frameRenderer.ts`) or the WebCodecs
  export worker. This clears the trim/clamp arithmetic itself (shared by
  both preview and export) as the cause, and points at something specific
  to the live preview's decode/render path — the WebCodecs decoder pool,
  its GL compositing consumers, or the legacy `<video>` preview path,
  which has never been tested in isolation against this repro.

No sixth fix is proposed here. The cause is genuinely unknown after five
attempts across the trim math, the asset model, and the decode pool's
concurrency and range-lookup logic.

### Two live leads for the next pass

1. **`feedWindow`'s untested exposure to the same chunk non-monotonicity
   `findChunkRange` was fixed for.** `findChunkRange` only fixed how a
   session's *initial* `[startIndex, endIndex]` window is chosen;
   `feedWindow`'s own incremental scan (`chunks[feedCursor].timestamp <=
   boundaryUs`) makes the identical ordering assumption over the chunks
   *inside* that window, and was never touched. This pass's own
   diagnostic trace evidence is the direct motivation for checking it: the
   119-inversion, 240-chunk session that resolved 9.61s to 3.79s is proof
   that real, non-synthetic B-frame sources in this app do have exactly
   the kind of non-monotonic interior ordering `feedWindow` also assumes
   away. See the read-only analysis below for what was checked without
   touching the code.
2. **The never-run legacy-`<video>` A/B experiment.** `PreviewStage.tsx`'s
   legacy `<video>` render path has existed the whole time and has never
   been used to test whether the stall is specific to the WebCodecs decode
   pool at all. This is the cheapest remaining way to learn whether the
   pool is implicated in the first place, rather than guessing at which
   corner of it to fix next. Built in Stage 2, below.

### Read-only analysis — `feedWindow`'s exposure to chunk non-monotonicity

Scope: read-only, per instruction. No code changed for this section.

**Does `feedWindow` make an ordering assumption a non-monotonic array
breaks?** Yes, structurally the same one `findChunkRange` had.
`feedWindow`'s primary loop (`videoDecoderPool.ts`) advances
`session.feedCursor` one index at a time and feeds chunks while
`chunks[feedCursor].timestamp <= boundaryUs`, stopping the instant that
condition is false. On a non-monotonic interior (a decode-order chunk
whose `cts` spikes ahead of chunks that follow it in the array — the same
B-frame reordering artifact `findChunkRange` was fixed for, now confirmed
to be real and not merely synthetic by this session's own trace) that
condition can go false before every chunk actually due to be fed in this
window has been fed.

**Would the resulting failure be positional — fine near the start,
degrading further in?** No convincing mechanism for that shape was found,
and this is where the hypothesis is weakest. `feedWindow` has two
structural properties that a non-monotonic-array read alone does not have:
first, it *always* feeds at least one chunk of forward progress per call
even when the boundary check fails immediately (the explicit fallback
branch for "nothing fell within the window boundary yet"); second,
`fillWindow` calls it in a loop, re-invoking `startFeedBatch` for the same
`targetSec` until either a satisfying frame has arrived or the session is
fully fed. Together these mean a local reordering spike can only ever cost
extra round trips within one already-bounded window (the window size is
roughly constant, set by `findChunkRange`'s now-fixed GOP-anchored
`[startIndex, endIndex]`, not by how deep into the file the target is) —
it cannot, by this reading, cause the cursor to stop short permanently or
land on the wrong frame the way `findChunkRange`'s single-shot break did.
GOP/B-frame reorder structure also recurs uniformly through a typical
encode rather than clustering toward a file's end, so there's no
positional reason a fixed per-GOP hazard would specifically worsen
mid-to-end. This does not match the owner's reported shape (fine at the
extreme left, degrading toward the end), so on the reasoning above, this
specific mechanism is a poor fit for the reported symptom — but this is
inference from reading the retry/fallback logic, not from running it
against a real non-monotonic chunk array the way `findChunkRange`'s fix
was validated, so it should be treated as a lead to check with data, not a
closed question.

**Would it survive the `findChunkRange` fix — can the seek land on the
right keyframe while the buffer still fills wrong?** In principle yes:
`findChunkRange`'s fix only changes how the session's window boundaries
are chosen, not how `feedWindow` walks the chunks inside them, so the same
class of assumption violation is still present in the fill phase
regardless of the seed fix. Whether that residual exposure actually
produces a visible symptom is a separate question this reading cannot
settle — the self-healing properties above (guaranteed forward progress,
retry-until-satisfied) are a plausible reason it doesn't, but plausible
isn't verified. **Can't tell without data** whether it ever manifests in
practice; it wasn't ruled out, only reasoned about.

---

## Stage 2 result — the legacy `<video>` A/B experiment, and what it eliminates

**Result: decisive.** With `FORCE_LEGACY_VIDEO_PREVIEW = true`
(`PreviewStage.tsx:294`, still committed and defaulted to `false`) the
reported stall **completely disappears**, on the exact same project, the
exact same repro (long clip, short segment, slip dragged toward the end).
The legacy `<video>` path and the WebCodecs/GL path compute source time
identically (`trimStart + timeInSegment`, both read `Asset.duration` via
`sourceRange`/`toSourceTime` in `useWebCodecsPreview.ts`) and the legacy
path works — so this result isolates the defect to **the decode pool or
the GL layer that consumes its frames**, and clears every theory that
lives in shared code both paths execute.

**What this eliminates — do not re-investigate these:**
- `trimStart`, the source-time math (`toSourceTime`/`sourceRange`), the
  segment-local→source-time clamp, the slip-bar/slider UI itself, and the
  export path (`frameRenderer.ts`, the WebCodecs export worker) — all
  either share this exact math with the legacy path or were independently
  cleared by "exports render correctly from the same `trimStart`" in the
  prior pass.
- The transition-chase collision theory (attempts 3/4's premise) — already
  falsified in the prior pass by "removing all transitions didn't change
  the bug"; this result doesn't reopen it.

**What remains in scope:** `videoDecoderPool.ts` (the decode pool: window
feeding, buffer caps, eviction, scrub-reset) and `useGlPreview.ts`'s GL
consumption side (`resolveSlotSource`/the render tick).

## H1 — keyframe distance vs. buffer caps

**Mechanism.** `getFrameAt` seeds a session's window at the nearest
keyframe at-or-before the target (`findChunkRange`/`seedWindow`) and feeds
forward from there. Per call, `feedWindow` feeds every chunk from that
keyframe up to `targetSec + WINDOW_AHEAD_SEC` (1.5s) in one synchronous
batch — for a target sitting deep inside a GOP whose *keyframe* is far
behind it, that batch must decode every frame in between before the
target's own frame can be selected. Two hard caps sit on that path:
`MAX_BUFFERED_FRAMES_PER_SESSION` (90 unconsumed frames/session) and
`MAX_TOTAL_BUFFERED_FRAMES` (150 pool-wide). `handleDecoderOutput`
(`videoDecoderPool.ts`) silently **drops and closes** any decoded frame
that arrives once the per-session cap is already full — it does not evict
an older buffered frame to make room. So if the run from keyframe to
target requires decoding more than ~90 frames, the target's own frame can
be produced by the decoder and then immediately discarded before
`getFrameAt` ever sees it, with no error — `fillWindow`'s wait condition
(`frames.some(f => f.timestampSec > targetSec)`) then never becomes true
from that batch, and the call either keeps re-issuing batches or
eventually resolves `null`/stale once the session's window is exhausted.

**This is positional by construction**, matching every owner observation:
fine near the start of a GOP (short decode run to any nearby target), and
degrading specifically as the target moves deeper into a GOP relative to
its keyframe — independent of gestures, reloads, undo/redo, transitions,
or which segment is involved, since it only depends on (keyframe
position, target position) within whichever clip is playing.

**Predicted signature if H1 is real:**
- Part A: the failing clip has keyframes sparse enough that the gap
  between some keyframe and the failing slip position exceeds roughly
  90 frames (at the clip's own fps) — e.g. a keyframe interval materially
  longer than ~3s at 30fps, or the failing slip range simply sitting more
  than ~90 frames past its nearest preceding keyframe.
- Part B: for calls made while the slider sits in the failing range,
  `perSessionCapFired: true` and/or a large `distanceFrames`/`framesDecodedThisTurn`
  approaching or exceeding 90, correlated with `outcome: 'null'` (not
  `'closed'` — the session is alive, just never gets fed the frame it
  needed) — as opposed to left/early-range calls, which should show small
  `distanceFrames`, `perSessionCapFired: false`, and `outcome: 'frame'`.

**What kills it:** Part A shows keyframes densely and regularly spaced
(every ~1-2s or less) with no gap anywhere near 90 frames — then no target
in the file is ever far enough from a keyframe for the cap to bind, and H1
is dead regardless of what Part B would show.

## What the measurement captures

**Part A** (`ffprobe`, run by the owner outside the app): total duration,
frame count, total keyframe count, every keyframe timestamp, and the
largest gap between consecutive keyframes, for the actual failing clip —
cheap, code-independent data that confirms or kills H1 before any
instrumentation runs.

**Part B** (temporary instrumentation, `src/services/videoDecoderPool.ts`
+ two call sites in `src/hooks/useGlPreview.ts` and
`src/hooks/useWebCodecsPreview.ts`, all marked `WS3 INSTRUMENTATION`, gated
by the single `WS3_MEASURE` constant): per `getFrameAt` turn — requested
target, whether a scrub-reset fired, the keyframe/window-floor timestamp
the call was actually anchored to, distance to target in both seconds and
an estimated frame count, how many frames were decoded during the turn,
whether the per-session or pool-wide buffer cap fired, wall-clock time to
settle, and the outcome (`'frame'` / `'null'` / `'closed'`) plus the
caller's slider position for left/mid/end comparison. Per render tick
(`useGlPreview.ts`'s render `useLayoutEffect`): `'painted-new'` /
`'retained-previous'` / `'painted-nothing'`, tagged with slider position.
`window.__ws3ExportLog()` (exposed on `window` when `WS3_MEASURE` is on)
downloads both logs plus the eviction log as one JSON file — no
screenshot needed. One known imprecision: a coalesced `getFrameAt` call
(rapid successive calls during a fast scrub) logs the slider position of
whichever call *started* the queued turn, not the retargeted one it
actually resolves against — acceptable for a diagnostic recording, since
coalescing only happens between near-adjacent positions in the same
gesture.

**Fallback note.** The legacy `<video>` path is a confirmed-working
escape hatch (`FORCE_LEGACY_VIDEO_PREVIEW`) if the decode pool's fix turns
out to be expensive or risky — it's a viable permanent fallback for the
preview path specifically (not export, which already goes through its own
pipeline), not just an A/B diagnostic.

## Validation (this pass — measurement only, no fix)

`npm run lint` — clean. `npm test` — 1785 passed, 1 skipped (pre-existing
skip, unrelated), 71 files. Golden replay
(`scripts/phase4-handoff-replay-sync.test.ts`) — 3/3. Rust: **not
touched** — no `cargo check` needed. Instrumentation is additive-only
(new optional trailing parameters, new log-only branches at existing
early-return points) and does not change any decode/selection/render
logic — confirmed by the full suite passing unchanged.

---

## H1 CONFIRMED — Part A result, mechanism re-verified by reading, no fix yet

**Part A result, failing clip (`008_salesman_walks.mp4`).** `ffprobe`:
h264, 24fps, 10.000s, 240 frames, **keyframe count: 1** — the largest-gap
calculation returned empty because there is no second keyframe to measure
a gap against. The entire clip is one GOP. This is H1 in its strongest
possible form: not "keyframes sparse enough to sometimes exceed the cap,"
but "zero keyframes anywhere past t=0," so absolute source position alone
determines reachability. Part B (the recording session) was skipped per
instruction — ffprobe alone already answers the question the
instrumentation was built to measure.

**Mechanism, re-verified against current `main`, item by item:**

1. **`MAX_BUFFERED_FRAMES_PER_SESSION = 90`** (`src/services/videoDecoderPool.ts:155`).
   At the failing clip's real 24fps, `90 / 24 = 3.75s` of decodable range
   from the single keyframe at t=0. Confirmed.

2. **`handleDecoderOutput` drops overflow frames rather than evicting older
   ones.** Quoted verbatim (`src/services/videoDecoderPool.ts:1137-1148`):
   ```ts
   private handleDecoderOutput(handle: DecoderHandle, frame: VideoFrame): void {
     const session = handle.activeSession;
     if (!session || session.closed || session.frames.length >= MAX_BUFFERED_FRAMES_PER_SESSION) {
       ...
       frame.close();
       return;
     }
     ...
     session.frames.push({ frame, timestampSec });
   ```
   Once `session.frames.length` hits 90, every further decoded frame is
   closed and discarded on arrival — `session.frames` (the buffer
   `getFrameAt` selects from) is never touched to make room. This is a hard
   drop, not an eviction. Confirmed — this is the crux, and it is a drop.

   **Consequence traced one level further than the prompt asked, because it
   changes the observable symptom's shape.** For a deep target (e.g. 6.6s)
   on a single-keyframe clip, the first 90 decoded frames (source time
   ~0–3.75s) fill the buffer and everything after is dropped. `fillWindow`'s
   satisfying condition (`frames.some(f => f.timestampSec > targetSec)`,
   `videoDecoderPool.ts:665`) never becomes true, but the feed loop still
   reaches `session.fullyFed = true` once `feedCursor` exhausts the range
   (`videoDecoderPool.ts:614`), so `fillWindow` returns anyway
   (`videoDecoderPool.ts:666`). `getFrameAtInternal`'s selection loop
   (`videoDecoderPool.ts:899-903`, "latest buffered frame at or before
   `targetSec`") then finds every remaining buffered frame satisfies
   `<= targetSec` and returns the **last one it has** — the ~3.75s frame —
   not `null`. So the failure mode is a **frozen stale frame**, not a blank
   canvas: the preview stalls, holding whatever frame was buffered when the
   cap tripped.

   This also **entrenches**, rather than self-heals, on the next call:
   selecting that stale frame advances `session.retainedFloorUs` to its
   timestamp (`videoDecoderPool.ts:917`), and `needsReset`
   (`videoDecoderPool.ts:505-509`) only re-seeks when the new target falls
   *below* the floor. A target further right never does, and the session is
   already `fullyFed` from the first exhausting run, so `fillWindow`
   short-circuits immediately (`videoDecoderPool.ts:666`) without decoding
   anything further. The session parks on the same stale frame permanently
   until something forces a hard reset (a genuine backward scrub past the
   floor, or the session being torn down and rebuilt).

3. **Every seek reseeds at t=0; cost is proportional to absolute target
   time, not drag distance.** `seedWindow` positions a session's window at
   the keyframe `findChunkRange` returns for the target
   (`videoDecoderPool.ts:490-498` → `findChunkRange`,
   `videoDecoderPool.ts:319-350`). With `keyIndices.length === 1`
   (`videoDecoderPool.ts:328-332`), the loop at `videoDecoderPool.ts:335-338`
   can never advance `startIndex` past that single entry — every call
   returns `startIndex = 0` regardless of `targetSec`. So every reset
   re-seeds at the clip's start, and `feedWindow` must decode forward from
   chunk 0 up to the target every time — cost scales with the target's
   absolute position in the 10s clip, never with how far a slip gesture
   moved. Confirmed.

4. **`retainedFloorUs` and `MAX_SESSION_FRAMES` — compound, don't help.**
   `retainedFloorUs` (`videoDecoderPool.ts:262`, set at `:497` and `:917`)
   exists to let a session skip a full reset when a new target is still
   reachable from what's already retained. In the failure case this doesn't
   help recovery — as described in item 2, once the cap has already fired
   and a stale frame is selected, the floor advances to that stale
   timestamp and *prevents* the reset that would otherwise re-anchor the
   session, locking in the frozen frame rather than giving the session a
   path back to a correct one. `MAX_SESSION_FRAMES = 600`
   (`videoDecoderPool.ts:144`, the outer cap on `findChunkRange`'s
   `endIndex`) does not bind here at all — the failing clip is 240 frames,
   well under 600 — so it neither causes nor mitigates this specific
   failure; it's a separate, much larger ceiling on the session's own
   *tracked range*, orthogonal to the *buffered-frame* cap that actually
   trips. For a longer single-keyframe clip it would eventually matter too,
   but only after `MAX_BUFFERED_FRAMES_PER_SESSION` (the far tighter cap)
   has already been the binding constraint.

5. **Export is unaffected because it decodes sequentially with backpressure,
   never a capped fire-and-forget batch.** The WebCodecs export path does
   not use `VideoDecoderPool`/`getFrameAt` at all — confirmed by grep, zero
   references to `videoDecoderPool`/`VideoDecoderPool` outside
   `src/services/webcodecsExport/exportWorker.ts`'s one comment and
   `sequentialDecode.ts`'s reuse of the pure `findChunkRange` helper. Export
   uses `decodeSegmentFrames`
   (`src/services/webcodecsExport/sequentialDecode.ts:100-...`), an async
   generator that walks a segment's source range exactly once, start to
   end, in presentation order. Its own cap, `DECODE_AHEAD_CAP = 8`
   (`sequentialDecode.ts:43`), is enforced with real backpressure, not a
   drop: the feed loop pauses (`sequentialDecode.ts:208-212`,
   `await new Promise(...)` inside `while (outputQueue.length >= DECODE_AHEAD_CAP ...)`)
   until the consumer drains a frame via `yield`, then resumes — every
   decoded frame is eventually yielded, none is ever closed-and-discarded
   the way `handleDecoderOutput` does. The legacy export path
   (`frameRenderer.ts`) doesn't touch this pool either — it drives a real
   `<video>` element's own seek, unrelated machinery entirely. Confirmed.

**Predicted failure boundary — matches the owner's report exactly, no
different number to give.** With the segment's own duration ~3.4s and the
cap's budget at `90 / 24 = 3.75s`: while `trimStart + duration <= 3.75s`
(true at or near extreme-left slip, `trimStart` near 0), every target the
segment ever requests is reachable within the 90-frame budget and preview
is correct. Once slipping right pushes `trimStart + duration` past 3.75s,
the target nearest the segment's own tail becomes unreachable, the cap
trips, and playback approaching that point freezes on the last frame that
made it into the buffer (~3.75s absolute) rather than showing the correct
frame for wherever `trimStart` has actually moved the window to. Because
the boundary is a hard absolute-time cutoff, not a gradual degradation, the
failure onset is close to the left edge of the slip range for this
particular clip/segment pairing (budget 3.75s vs. segment length 3.4s
leaves very little slack) — consistent with "fine at extreme left, fails
moving right," not requiring a large rightward slip to trigger.

**Why five prior fix passes missed this.** All five (the tail-defect
investigation's first through fourth passes, the trim/asset-model/
`findChunkRange` fixes kept in this baseline, and the concurrency
serialization fix) looked at *ordering*, *concurrency*, and *trim math* —
races between drag commits and preview reads, chunk-array non-monotonicity
inside a single decode window, stale `Asset.duration`/trim values, and
overlapping `getFrameAt` calls corrupting one session's buffer. Every one
of those is a defect in *how a target gets resolved once decoding starts*.
H1 is different in kind: it's a **capacity limit** (`MAX_BUFFERED_FRAMES_
PER_SESSION`) that only binds once a target's absolute distance from the
nearest keyframe exceeds a fixed frame count — for a normal multi-keyframe
clip this rarely matters (a nearby keyframe keeps the decode run short
regardless of where in the file the target sits), so nothing about
*ordering* or *trim correctness* would ever surface it. It only becomes
visible on a clip whose keyframe interval (here, "interval" of one — no
second keyframe at all) is long enough that a legitimate target sits more
than ~90 frames past its keyframe. None of the prior passes' repros or
reasoning turned on keyframe *density*, so none of them were positioned to
find it — the ffprobe check in this pass is the first time keyframe
placement was ever measured against the buffer cap.

## Phase 2 — fix options (not implemented, no option chosen)

**Sliding window / evict-behind.** Change `handleDecoderOutput` (or the
selection step in `getFrameAtInternal`) to discard the *oldest* buffered
frame instead of the newest when the cap is hit, keeping a rolling window
around the target rather than a frozen prefix. Cost: a bounded-size ring
buffer/eviction policy change confined to `videoDecoderPool.ts`, no API
change for callers. Risk: `retainedFloorUs`'s contract ("timestamp below
which this session can no longer answer without a reset") currently
assumes the retained set is a contiguous *prefix* ending at the most
recently selected frame; evicting from the front while decoding continues
past the cap breaks that assumption unless the floor is also redefined
(e.g. as the oldest still-buffered frame, not the selected one) — every
`needsReset` call and the backward-scrub path depend on this, so this
touches a genuinely load-bearing invariant, not just a buffer policy.
Backward scrubbing within the discarded window would also start needing a
real reset it doesn't need today (currently a scrub within the already-
buffered 90-frame prefix is free). Scales to any clip length and fixes the
whole class (any low-keyframe-density clip, not just single-keyframe), at
the cost of being the highest-risk, highest-diff option here.

**Raise the cap.** Bump `MAX_BUFFERED_FRAMES_PER_SESSION` (and likely
`MAX_TOTAL_BUFFERED_FRAMES` alongside it, since one session filling to a
much larger number would itself blow the pool-wide ceiling). Cost: linear,
real memory — each buffered `VideoFrame` is a live GPU/CPU-backed buffer
(the module's own header comment), so covering even this one clip's whole
10s/240 frames outright means holding 240 decoded frames simultaneously
per such session, times however many sessions the pool concurrently
protects (`MAX_CACHED_SESSIONS = 3` today). Does not scale: a 60s
single-keyframe clip needs ~1440 frames just for that one session, and the
cap would have to be raised per-clip-worst-case, not per this repro, since
any future asset could have an even longer single GOP. This is a constant
stretched to cover the worst case anyone imports, not a fix for the
mechanism.

**Per-clip fallback to legacy `<video>` for sparse-keyframe clips.** Detect
at probe/import time (or lazily, first decode) that a clip's keyframe
interval exceeds some threshold (e.g. via the same `ffprobe`-style
keyframe scan Part A did, or by inspecting `demuxed.chunks` for the gap
between consecutive `type === 'key'` entries) and route just those
segments through `FORCE_LEGACY_VIDEO_PREVIEW`'s already-existing,
already-proven-working code path instead of the WebCodecs pool. Cost:
lowest of the four — no change to `videoDecoderPool.ts`'s core logic at
all, just a per-segment routing decision plus the keyframe-gap probe
(itself cheap and already informally prototyped by this pass's Part A).
Risk: lowest of the four — the legacy path already exists, is already
confirmed working against this exact repro (Stage 2's A/B result), and the
`FORCE_LEGACY_VIDEO_PREVIEW` toggle referenced in `project-state.md`'s
notes proves the fallback path is live, not theoretical. Cost to the
affected segments only: no GL transitions, zoom, or color grading on
whichever segments get routed to legacy — the WS1/WS3 invariant that these
effects are GL-only stays true, just inapplicable to this subset. Scales
trivially to any clip length — a 60s single-keyframe clip just also gets
routed to legacy, no new constant to tune per worst case.

**Re-encode on import to insert keyframes.** Force a GOP size ceiling
(e.g. `ffmpeg -g <N>`) on any imported video asset whose native encoding
has sparse keyframes, so no clip the pool ever sees has a keyframe gap
large enough to matter. Cost: real import-time latency (a full re-encode,
not a probe), extra disk for the re-encoded copy, and a quality/bitrate
tradeoff from the re-encode itself (transcoding a delivered H.264 stream a
second time is lossy). Also raises a product question this task is not
scoped to answer: does the original file get replaced, kept alongside, or
is this opt-in — none of which is decidable from code alone.

**Recommendation: the per-clip legacy-`<video>` fallback**, in plain
language — it is the only option that is both cheap and already proven to
work against the exact failing case (Stage 2 already ran this A/B and it's
decisive), it doesn't touch the pool's serialization/eviction invariants
that three prior passes already fought hard to get correct, and it scales
to arbitrarily long single-keyframe clips without a per-clip constant to
tune. Its cost (no GL transitions/zoom/grading on the affected segments)
is real but narrow and clearly named, unlike raising the cap (doesn't
scale, unbounded memory) or re-encoding (import-time cost + a product
decision this investigation can't make). The sliding-window fix is the
"real" long-term fix and closes the class for every path including
WebCodecs preview's GL effects, but it's the highest-risk option — it
redefines `retainedFloorUs`'s meaning, which `needsReset` and the
backward-scrub path both depend on — and would need its own dedicated pass
with the same care the three prior kept fixes each took, not something to
bundle in quickly.

**Does any option make Stage 1's serialization (or the other kept fixes)
redundant?** No. The per-session `queueTail`/`turnRunning` serialization
(the "third pass" fix), `findChunkRange`'s keyframe-only scan (the "fourth
pass" fix), and `Asset.duration` as the single source of truth for clip
length all fix independent, already-confirmed-real defects unrelated to
the buffer cap — none of the four options above changes *what* gets
decoded or *how concurrent calls are ordered*, only *how much* gets
buffered before something is dropped (or whether the pool is used for a
given clip at all, for the fallback option). All three kept fixes stay
necessary regardless of which H1 fix is chosen.

---

## Sliding-window fix — the permanent fix for the preview stall (not committed)

Implemented after the H1 confirmation above. Owner ruling: fix the decode
pool properly rather than route around it. Not committed — the owner's
manual test is the gate, and on this bug "tests pass" has been wrong five
times.

### The library-wide keyframe scan — why this is the default path, not a fallback

An owner scan of the real asset library found **6 of 7 clips carry exactly
one keyframe**, at t=0. This is not a property of the one clip Part A
measured; generated and stock media are routinely encoded as a single GOP.
That single fact is what decides the design, because it means the failing
configuration is the *normal* one, and any fix that only handles it as a
special case would be handling almost every video segment in a real
project as a special case.

**Why the per-clip legacy-`<video>` fallback — this document's own prior
recommendation — was rejected.** That recommendation was made before the
library scan, on the assumption that sparse-keyframe clips were the
exception. At 6-of-7 it inverts: routing sparse-keyframe clips to the
legacy path would strip GL transitions, zoom, and colour grading from
nearly every video segment in a real project. The recommendation does not
survive its own evidence, and is withdrawn here.

**Also rejected:** raising `MAX_BUFFERED_FRAMES_PER_SESSION` (a 60s
single-keyframe clip needs ~1440 simultaneously-live `VideoFrame`s — real
GPU/CPU buffers — so no fixed cap survives and memory would scale with
clip length); and re-encoding assets on import to insert keyframes
(mutating the user's source media to work around a player limitation,
paying import latency, disk, and a second lossy transcode).

### The design — evict behind the playhead

`handleDecoderOutput` no longer drops the arriving frame when the
per-session buffer is full. It first tries to slide the buffer's trailing
edge forward (`slideWindowForward`), closing frames the current target has
already passed, and only drops the new frame if nothing is passed — the
case the cap was always genuinely meant to contain (a decoder emitting
faster than `getFrameAt` consumes). Reachable depth is now unbounded;
memory is bounded exactly as before.

**Window shape: 0.5s behind, 1.5s ahead.**
- **Ahead — `WINDOW_AHEAD_SEC = 1.5s`, unchanged.** Already the plan's
  chosen decode-ahead depth; nothing about this defect implicates it.
- **Behind — `RETAIN_BEHIND_SEC = 0.5s`, new.** ~12 frames at 24fps, ~15
  at 30fps. The number is chosen from what it has to absorb, not from
  memory pressure: a frame-step back, scrub jitter inside one gesture, and
  a transition blend reading slightly behind the playhead. On a
  single-keyframe clip *any* backward target below the retained floor
  costs a full re-decode from t=0, so retaining something is what matters
  far more than the exact figure — 0.5s is the smallest value that covers
  those three cases with margin.
- **Total live window: 2.0s ≈ 48 frames at 24fps, 60 at 30fps** — safely
  under the unchanged `MAX_BUFFERED_FRAMES_PER_SESSION = 90`, which is
  therefore a real safety net again rather than the binding constraint it
  had silently become.

### `retainedFloorUs` — the contract that changed

**Before:** the timestamp of the most recently *selected* frame, because
forward eviction closed everything strictly older than the selection on
every `getFrameAt` call. This is what made the failure self-entrenching:
once the cap had dropped the frames a deep target needed, the floor
advanced to the stale frame that got returned instead, and with the
session already `fullyFed`, `needsReset` could never fire again (a target
further right is never *below* the floor) and nothing could ever move it.

**After:** the timestamp of the **oldest frame still buffered** — the
sliding window's trailing edge — or, when nothing is buffered, the lower
bound of what the current window can still produce (the seeding chunk's
timestamp after `seedWindow`, the retain-behind cutoff after a slide).

**Every consumer checked.** `retainedFloorUs` has exactly one reader,
`needsReset`, and now exactly three writers: `seedWindow` (empty buffer),
`slideWindowForward` (slide eviction), and `getFrameAtInternal`'s
post-selection trim. Verified by grep across `src/` — nothing outside this
file reads or writes it.

**One consequence worth naming.** `getFrameAtInternal`'s post-selection
trim now measures its cutoff from the *selected frame*, never from
`targetSec`. A target the decode run has not reached yet sits arbitrarily
far ahead of everything buffered, so a target-relative cutoff would evict
the very frame the call is about to return. Related: the previously
displayed frame is no longer explicitly closed on supersession — it may
still sit inside the retain-behind tail, and closing it there would hand a
later call an already-closed frame. Every frame is now closed exactly once,
at the moment it leaves `session.frames`.

### `MAX_SESSION_FRAMES` — removed, because it was the same bug at 25s

`findChunkRange` additionally clamped `endIndex` to `startIndex + 599`. On
a single-keyframe clip `startIndex` is always 0, so this was a hard ceiling
on reachable depth: past chunk 599 (~25s at 24fps) a session reports itself
`fullyFed` and answers every deeper target with the frame at the ceiling,
forever — the exact failure this pass fixes at the buffer-cap level,
silently reintroduced at a different depth. It also bounded nothing real:
`chunks` is already fully in memory (the demuxer owns it), per-batch feed
volume is bounded by `boundaryUs` in `feedWindow`, and live decoded-frame
memory is bounded by `MAX_BUFFERED_FRAMES_PER_SESSION`. Removed, with a
regression test on a 60s clip.

### Backward seeks — the accepted tradeoff, with numbers

A backward target below the retained tail re-seeds at the keyframe and
decodes forward again. On a single-keyframe clip that means from t=0. This
is inherent to the encoding, not a defect in the pool — but it is now
*correct and bounded*: the reseek completes and returns the right frame
rather than stalling or answering from stale buffer (pinned by a test).

Cost, 10s clip at 24fps: a backward jump to a *shallow* target is cheap
(landing at 0.1s decodes ~40 frames — the target plus the 1.5s lookahead).
The worst case is a backward jump to a *deep* target: 9.9s → 9.0s must
re-decode ~240 frames. At 720p, hardware H.264 decode typically runs well
above 500fps, so the expected cost is a few hundred milliseconds — in the
same range as the architecture doc's ~250ms cold-scrub-seek goal, and
acceptable for a scrub. **This is an estimate from decoder throughput, not
a measurement** — no timing was taken in the real app this pass.

### Long decode runs — UI thread and abandonment

The synchronous work on the main thread is the *enqueue* loop in
`feedWindow` (up to 240 `decoder.decode()` calls for this clip), not the
decoding itself, which the browser performs off-thread. Reaching a deep
target on a single-keyframe clip is inherently a long run; chunking the
enqueue would only add round trips.

Abandonment: the kept serialization/coalescing work **suffices, and needed
no adjustment**. A turn already running completes (its chunks are already
enqueued in the decoder), but every call arriving during it coalesces into
a single pending turn that is retargeted to the newest position. So a fast
drag costs at most one stale in-flight decode plus the latest — bounded
regardless of gesture length.

### Global caps — arithmetic re-checked

- `MAX_BUFFERED_FRAMES_PER_SESSION = 90` — **unchanged.** The live window
  is now ~48-60 frames, so 90 is genuine headroom. During a long forward
  run a session does legitimately sit at 90 while sliding; that is the
  design, and it is the same ceiling as before.
- `MAX_TOTAL_BUFFERED_FRAMES = 150` — **unchanged, and still a soft
  ceiling for protected sessions**, exactly as its existing comment
  documents. Worst case is still 3 protected sessions × 90 = 270, because
  `enforceBudget` never evicts a protected session. The fix does not raise
  steady-state per-session occupancy (a post-`getFrameAt` trim leaves ~22
  frames), so no revision is warranted.
- `MAX_CACHED_SESSIONS = 3` — **unchanged**, nothing in this fix affects
  session count.
- `MAX_SESSION_FRAMES = 600` — **removed**, see above.

### Scope

Confined to `src/services/videoDecoderPool.ts` and its own test file. **No
consumer changed** — `useGlPreview.ts` and `useWebCodecsPreview.ts` are
back at their committed baseline, and the GL layer was not touched. The
`WS3_MEASURE` instrumentation and its three call sites are removed;
`FORCE_LEGACY_VIDEO_PREVIEW` stays at `false` as the standing escape hatch.

### Test coverage — what a unit test genuinely proves, and what it cannot

New describe block, `videoDecoderPool.test.ts`, on a fixture matching the
real failing clip exactly: 240 frames at 24fps, keyframe only at index 0.
Deliberately monotonic — this defect has nothing to do with B-frame
ordering (that was the separate, already-fixed `findChunkRange` defect), so
an inversion here would only muddy which mechanism a failure implicates.

**Genuinely verified by these tests** (the mock decoder emits
synchronously, so selection is fully deterministic):
- A target ~230 frames past the only keyframe resolves to frame 230, not
  the last frame that fit under the cap. **This is the red/green
  discriminator.**
- A target at the very end of the clip.
- A backward seek from a deep target re-seeks (asserted via `resetCalls`)
  and returns the correct frame.
- A short backward nudge inside the retained tail is answered *without* a
  re-seek — pins the reason `RETAIN_BEHIND_SEC` exists.
- Live frame count stays bounded across a full forward walk, and every
  frame is closed at teardown. (A guard, not a discriminator — this passed
  pre-fix too, since dropping also bounded memory. Its job is to prove the
  fix did not trade the stall for a leak.)
- Two sessions each reach their own deep target in parallel.
- A target past the removed 600-chunk clamp, on a 60s clip.

**Not reachable by any `jsdom` test, and left to the owner's manual run:**
real decode latency (so the backward-seek cost above stays an estimate);
real WKWebView/hardware `VideoDecoder` behaviour, including whether output
timing under a real async decoder differs from the mock's synchronous
emission; whether the enqueue burst is perceptible as jank; actual GPU
memory; and — the thing that actually matters — whether the reported stall
is gone on the real project.

### Red-before / green-after — verified, not assumed

The source was reverted to the committed baseline with the new tests left
in place, and the suite re-run. **7 tests failed**, and every deep-target
case failed with timestamp `3708363` — frame 89, 3.708s — which is exactly
`MAX_BUFFERED_FRAMES_PER_SESSION` frames past the keyframe, the predicted
stale value. The fix was then restored and all 48 pass.

### Validation

`npm run lint` clean. `npm test`: **1792 passed, 1 skipped, 71 files** (up
from 1785/1/71 — +7 new tests). One pre-existing test changed result and
was deliberately rewritten: `'closes every buffered frame it supersedes,
but keeps the currently displayed one open'` → `'retains a superseded frame
while it is inside the retain-behind tail, and closes it once the tail
slides past it'`. That test pinned the exact behaviour this fix changes;
it now pins the invariant that survives (a frame is closed exactly when it
leaves the buffer, never while still reachable, never left open at
teardown). No other test changed result. Golden replay 3/3, byte-identical.
Rust **not touched** (`git diff --name-only` matches no `src-tauri` path),
so no `cargo check` was needed.

### What remains unverified

The fix is unproven in the real app. Nothing in this pass ran the real
decoder, the real preview, or the real project — and on this bug, five
prior passes each landed a real, test-backed fix that did not resolve the
reported symptom. This is not called fixed. The owner's manual test is the
gate: load the project that reproduces the stall, slip a long clip toward
its end, and confirm the preview tracks the slider instead of freezing —
then re-run `docs/wkwebview-drag-checklist.md` steps 12 and 13, and check
backward scrubbing and a real export for regressions.
