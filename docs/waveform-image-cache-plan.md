# Waveform Image Cache — Handoff & Phased Plan

> Session handoff document. Paste this whole file's content (or point Claude at
> this path) at the start of the next session to resume with full context.
> Branch: `webgl2-effects-engine`. This doc covers the tail end of a long
> multi-round waveform-caching investigation; see `docs/waveform-rewrite-plan.md`
> for the original chunked-decode rewrite this builds on.

---

## 0. TL;DR for whoever picks this up

**Goal 1 — waveform image caching — is DONE, confirmed by data, and the
cleanup phase (Phase D) is also done and user-verified.** Build each
project's waveform once, ever — never rebuild it again, whether switching
projects in the same session or fully quitting/relaunching the app. A live
instrumented trace showed 294/294 segment lookups all resolving as cache hits
(`hit:true`) on a cold app restart. Phase D (cache cleanup on
voiceover-replace/project-delete) is wired up and the user confirmed it works
correctly in the real app (voiceover replace re-syncs cleanly, no stale
thumbnails; project delete doesn't error).

**Goal 2 — the ~4s reload pacing — is a SEPARATE problem, still unsolved.**
Even with 100% cache hits (zero rebuilds), the reload of a 294-segment
project still takes ~4 seconds wall-clock before everything settles. Four
different hypotheses were tested this session and ALL were falsified by
real trace data (see Section 6). **This is the important part for whoever
picks this up: do not re-try any of the four ruled-out theories below —
each was tested with real before/after traces, not just reasoned about.**
The user explicitly asked to stop guessing from console logs and pivot to a
real profiler (Safari Web Inspector Timeline/JS Profile) — that capture has
NOT been done yet. See Section 6 for the exact next step.

---

## 1. Current working-tree state (uncommitted)

```
 M src/App.tsx
 M src/components/ProjectDashboard.tsx
 M src/components/SegmentWaveform.tsx
 M src/components/Timeline.tsx
 M src/main.tsx
 M src/services/waveformStore.ts
?? docs/waveform-image-cache-plan.md   (this file)
?? src/instrumentFlag.ts
?? src/services/waveformImageCache.test.ts
?? src/services/waveformImageCache.ts
```

`src/services/waveformStore.ts`'s modifications are from an EARLIER session
(the peaks-mirror gate reorder fix / mirror-arm revert — see Section 7 for
that history) and are unrelated to this session's work; they're already
validated and confirmed working, not something to revisit.

**Validation gate, currently passing:** `npx tsc --noEmit` clean, `npx vitest
run` → 632/632 passing. Always re-run both before considering any further
change "done" — this is the user's established, explicit convention.

---

## 2. What this session built (Phases A, B, C — the caching engine)

### Root cause (confirmed early, still accurate)
Peaks (numeric waveform data) were already cached before this effort started
(`waveformStore.ts`). The actual bottleneck was that the **rendered PNG
thumbnail per segment** was never cached — every remount of the segment list
(project switch OR app restart, both fully unmount/remount every
`SegmentWaveform` via `showDashboard`) redrew every segment's canvas from the
peaks and re-encoded a PNG, throttled 24-per-frame through
`waveformDrawQueue.ts`. That throttled redraw was the visible "building in
front of me."

The rendered image is a pure function of `assetId + blobSize` (content) and
`segment.id/startTime/duration` (window) — confirmed in `waveformPeaks.ts`:
canvas is always sized at a fixed max-zoom density, so timeline zoom is
never a redraw trigger. Fully cacheable by key:
`` `${assetId}:${blobSize}:${segmentId}:${startTime.toFixed(3)}:${duration.toFixed(3)}` ``.

### Phase A — `src/services/waveformImageCache.ts` (new file)
Two-tier cache for rendered segment images, mirroring `waveformStore.ts`'s
pattern for peaks:
- **Tier 1**: in-memory LRU `Map<cacheKey, blob:URL>`, cap `IMAGE_MIRROR_MAX_ENTRIES = 2000`, revokes evicted URLs. Survives project-switch remounts within a session.
- **Tier 2**: own IndexedDB database `kinetix-waveform-images` (deliberately separate from `waveformStore.ts`'s `kinetix-waveforms` DB — additive, doesn't touch that DB's schema/version/tests), store `images`, compound keyPath `['projectId','assetId','segmentId']`, indexes `byProjectAsset` and `byProject`. Stores the PNG as a `Blob` directly.

Public API: `peekImage` (sync Tier-1 lookup), `putImage` (writes both
tiers), `getPersistedImage` (async single-key Tier-2 lookup — see Phase C
below for why this replaced an earlier bulk-read design), `deleteImagesForAsset`,
`deleteAllImagesForProject` (Phase D — wired up, see Section 5).

Connection handling (important, added mid-session after a real bug):
`openWaveformImageDB()` opens the IndexedDB connection **once**, cached in a
module-level `dbPromise`, reused by every function — never closed after each
transaction (only closed via `onversionchange`, for a future schema bump).
An **eager top-level call** (`if (typeof indexedDB !== 'undefined') { void
openWaveformImageDB(); }`) kicks off this connection open the moment the
module loads, guarded so it's a no-op in the plain-node vitest environment
(confirmed via `sceneTagParsing.test.ts`, which transitively imports this
module via `App.tsx` without the IndexedDB polyfill, and must not crash).

Tests: `src/services/waveformImageCache.test.ts`, 9 cases — roundtrip,
cross-"restart" rehydration via `getPersistedImage`, blobSize invalidation,
per-asset/per-project deletion scoping, LRU eviction. Uses
`fake-indexeddb/auto` same as `waveformStore.test.ts`.

### Phase B — `src/components/SegmentWaveform.tsx` (same-session fix, CONFIRMED WORKING)
The redraw effect now checks Tier 1 (`peekImage`) synchronously before ever
touching the draw queue. A hit skips drawing/encoding entirely. On a miss,
draws as before but write-throughs via `putImage` so the next mount hits the
cache. Blob-URL ownership is tracked (`urlIsCacheOwnedRef`) so cache-owned
URLs are never revoked by a component unmount — this also fixed a
previously-flagged, separate `WebKitBlobResource` revoke-race bug as a side
effect.

`Timeline.tsx` and `App.tsx` were threaded to pass `projectId` /
`assetId` / `blobSize` down to each `SegmentWaveform` (new required props,
`undefined`-able to disable caching if identity is missing).

**User-tested and confirmed**: same-session project switch-back (A→B→A) is
now instant with zero visible redraw — this was the first real win of the
whole session.

### Phase C — cross-restart caching (CONFIRMED WORKING, after 3 iterations)

**Iteration 1 (bulk prefetch) — tried, failed, reverted.** Original design:
bulk-warm Tier 1 from IndexedDB via one cursor read over the whole
asset+project, awaited in `App.tsx` before `setWaveformSource` committed.
Live trace showed this cursor walk itself taking ~5 seconds — moved the
delay rather than removing it, and blocked the loading overlay for that
whole span. Fully reverted: `warmImagesFromStore` function deleted,
`App.tsx`'s `buildVoiceoverWaveform` reverted to commit `setWaveformSource`
immediately (no bulk-prefetch step at all).

**Iteration 2 (per-segment lazy lookup) — the design that stuck.** Replaced
the bulk approach with `getPersistedImage(projectId, assetId, segmentId,
blobSize, startTime, duration)` — a single-key IndexedDB `get()`, called
independently by each `SegmentWaveform` on its own Tier-1 miss, not part of
any bulk/blocking operation. `App.tsx` no longer knows about the per-segment
image cache at all; it's entirely `SegmentWaveform.tsx`'s own concern.

**Iteration 3 (connection-churn fix) — needed on top of iteration 2.** First
live test of iteration 2 showed inconsistent timing (1-2s one restart, ~5s
the next, same code path). Traced to: every one of 294 concurrent
`getPersistedImage` calls was independently opening AND closing its own
IndexedDB connection. Fixed via the shared/cached `dbPromise` singleton
described in Phase A above (open once, never close per-call).

**With trustworthy timestamps (see Section 4 for the instrumentation-order
bug that had to be fixed first), the final trace showed:** `db-open-start`
at real time ~230-330ms, `db-open-done` 12-27ms later (fast, confirmed
working) — and all 294 `get-done` events `hit:true`. **Zero rebuilds. Cache
goal achieved and proven by data.**

---

## 3. Section removed (superseded)

*(Earlier drafts of this doc had detailed blow-by-blow sections for the
bulk-prefetch failure and the connection-churn fix as separate numbered
sections. They're folded into Section 2 above now that the whole Phase C
story is resolved, to keep this doc from re-growing into the same sprawl it
was trimmed from mid-session.)*

---

## 4. Instrumentation infrastructure (now permanent-ish, still flagged TEMP in comments)

- **Enable**: in the app's console, run `localStorage.setItem('kinetix:wf-instrument', '1')` — persists across reloads/restarts (unlike a plain `globalThis` var).
- **Disable**: `localStorage.removeItem('kinetix:wf-instrument')`.
- **Filtering the console**: type `wf-imgcache` in the console's filter box for just the cache trace, or `all-ready` for a single summary line with the total elapsed time for the whole batch (from `waveformReadyTracker.ts`'s `maybeFireAllReady`). Typing `wf-` alone catches everything but is very noisy (294+ per-segment lines).
- `src/instrumentFlag.ts` reads this into `globalThis.__WF_INSTRUMENT__` on every load, and MUST stay the first import in `main.tsx`.
- Log tag `[wf-imgcache]` (in `waveformImageCache.ts`): `db-open-start`/`db-open-done`/`db-open-error` (once per session, for the shared connection), `get-done`/`get-error` per `getPersistedImage` call (fields: `segmentId`, `waitForDbMs`, `getMs`, `totalMs`, `hit`).
- Log tag `[wf-switch]` (in `App.tsx`'s `handleSwitchProject`, added this session) — one line per reload/switch: `assetCount`, `segmentCount`, `getAllAssetsMs` (IndexedDB bulk asset read), `rehydrateLoopMs` (the synchronous blob→File→objectURL loop). Added specifically to test and rule out the asset-rehydration-loop hypothesis (Section 6, theory 2) — kept, gated on the flag, in case it's useful again.
- Other pre-existing tags under the same flag, from earlier rounds: `[wf-gate]`, `[wf-gen]`, `[wf-cache]`, `[wf-batch]`, `[wf-blob]`, `[wf-encode]`, `[wf-ready]` (in `App.tsx`, `waveformDrawQueue.ts`, `SegmentWaveform.tsx`, `waveformReadyTracker.ts`, `waveformStore.ts`). All still gated on the same flag now correctly.
- All of these are marked `TEMP diagnostic instrumentation` in their source comments and were intended to be removed "after the audit" per multiple rounds' comments — none have actually been removed yet. Whether to clean these up is an open question for whoever eventually closes out this whole waveform-investigation arc; not urgent.

**CRITICAL gotcha, already fixed once, could resurface if this code is
touched carelessly:** `t0`/`tGotDb` timestamps inside `openWaveformImageDB`
and `getPersistedImage` must be captured **unconditionally**
(`performance.now()` always runs; only the `console.log` call itself is
gated on the instrumentation flag). If a future edit makes timestamp capture
conditional on the flag again, any trace taken with the flag flipped on
*after* the module already loaded will show bogus near-zero durations —
this cost multiple confusing rounds of contradictory data earlier in this
investigation before being caught (see git history / earlier doc drafts for
the full story if needed; not repeated here to keep this section short).

---

## 5. Phase D — DONE, user-verified

Wiring completed this session:
- `App.tsx` — imports `deleteImagesForAsset`; calls it alongside both
  existing `deletePersistedWaveform` sites (the old-asset-replace path and
  the drag-and-drop replace path).
- `ProjectDashboard.tsx` — imports `deleteAllImagesForProject`; calls it
  alongside `deleteAllWaveforms` in `handleDelete`.

**User manually verified in the real app:** replacing a voiceover on an
existing project and re-syncing builds the new voiceover's waveforms
cleanly with no stale thumbnails bleeding through from the old asset;
deleting a project from the dashboard doesn't error. `tsc` clean, vitest
632/632 passing at the time of this wiring. Nothing left to do here.

---

## 6. Open, unsolved investigation: ~4s reload pacing (294-segment project)

Not part of the original waveform-caching goal — discovered as a side effect
of the very clean Phase C trace data (all cache hits, yet the reload still
visibly takes ~4 seconds). This section documents **four falsified
hypotheses with real trace data**, so whoever picks this up does not repeat
them.

### How to correctly read a `[wf-imgcache]` trace (read this first)

The `get-done` lines print in **completion order** (`console.log` fires
synchronously the instant each promise resolves), NOT in the order each
segment's effect fired. A trace typically shows the FIRST-printed line with
the LARGEST `waitForDbMs` (~4000ms+) and the LAST-printed line with the
SMALLEST (~0-4ms), forming a near-perfectly linear staircase across all 294
segments, each step ~13-14ms.

**This does NOT mean IndexedDB is slow.** `db-open-done` consistently fires
in 12-27ms — the shared connection is fast. The correct reading: whichever
segment's effect fired EARLIEST (smallest `t0`) is also the one whose
`await`-continuation had to wait LONGEST to actually run (because — per the
falsified/confirmed theories below — something keeps the JS engine busy
for the next ~4 seconds before it gets back around to resolving that
continuation). The staircase is an artifact of *when each segment's promise
was allowed to settle*, not *how long any individual database operation
took*. Do not re-investigate "why is IndexedDB slow" — it isn't, this was
checked repeatedly across every trace in this session.

### Four hypotheses tested this session, all falsified by real before/after trace data

1. **Loading-spinner overlay (`SyncLoadingOverlay.tsx`'s `backdrop-blur-sm`
   + `animate-spin`) causing paint contention.** User's own hunch, worth
   testing since the overlay is visibly present for the whole ~4s window.
   *Experiment:* removed `backdrop-blur-sm` temporarily. *Result:* trace was
   essentially IDENTICAL before/after (same staircase shape, same
   magnitude). Reverted — confirmed clean revert via `git diff`. **Ruled
   out.**

2. **Synchronous asset-rehydration loop in `handleSwitchProject`**
   ([App.tsx](../src/App.tsx), the `rehydratedAssets = saved.project.assets.map(...)`
   loop that does `URL.createObjectURL` + `new File(...)` per asset, BEFORE
   `setProject`/render). Plausible because this project has 294 segments
   AND 294 distinct assets (one image per segment) — confirmed via the new
   `[wf-switch]` diagnostic log. *Experiment:* added `performance.now()`
   brackets around `getAllAssetsForProject` and the rehydration loop
   specifically. *Result:* `getAllAssetsMs: 126-128`, `rehydrateLoopMs: 2`.
   Both trivially fast. **Ruled out** — confirms the entire ~4s cost happens
   AFTER `setProject`, purely in render/commit/effects.

3. **React 19 not time-slicing the `setProject` update (`startTransition`,
   attempt 1: wrap only `setProject`).** Theory: a big list commit
   triggered from a promise/effect callback gets "Default" lane priority in
   React 18/19, which should be interruptible, but if it isn't actually
   yielding, all 294 components' passive effects run in one continuous
   blocking JS task — meaning none of their `await dbPromise` continuations
   (all queued as microtasks) can run until that whole task finishes, which
   would exactly produce the observed staircase. *Experiment:* wrapped just
   the `setProject({...})` call in `startTransition(() => {...})`.
   *Result:* trace was essentially IDENTICAL. **Ruled out — but see #4,
   this attempt had a confound.**

4. **`startTransition`, attempt 2: wrap the ENTIRE state-update batch.**
   Realized attempt 3's flaw: `handleSwitchProject` calls several more
   `setState`s right after `setProject` (`setLastOpenedProjectId`,
   `setIsSynced`, `setIsPlaying`, `setSelectedSegmentId`/`setCurrentTime`),
   all OUTSIDE the transition, in the same synchronous function body. React
   batches all of these into one flush, and a batch with mixed
   transition/default priority renders at the higher (non-transition)
   priority — silently cancelling any benefit from wrapping just one call.
   *Experiment:* wrapped ALL of `handleSwitchProject`'s state updates in one
   `startTransition(() => {...})`. *Result:* trace was STILL essentially
   identical in shape — and `getMs` (the individual IndexedDB `get()` time)
   actually got noticeably WORSE (up to ~430ms vs ~50ms in the unwrapped
   trace), i.e. the extra scheduling indirection added real overhead with
   zero payoff. **Ruled out, and fully reverted** (plain unwrapped
   `setProject`/etc. calls restored, `startTransition` import removed —
   confirmed via `git diff --stat` and a clean `tsc`/vitest pass).

**Why #4's result is the important one:** if React were genuinely entering
interruptible/time-sliced rendering here, changing the scheduling priority
of the update should have changed *something* about the trace. It changed
nothing (except making it slightly worse). That is strong evidence this
isn't a React-scheduling problem at all — most likely either (a) the
WKWebView's Scheduler isn't honoring `startTransition`'s yield points the
way a full browser would, or (b) the ~14ms/segment is genuine synchronous
CPU cost (real DOM construction + layout for 294 rich Timeline rows, each
with a waveform image slot, drag handles, text, etc.) that no scheduling
wrapper can break apart — React still has to do that work somewhere, and if
the Scheduler isn't actually yielding mid-render, it all happens in one
blocking task regardless of what priority is assigned to it.

### What's NOT yet checked (the real next step)

The user explicitly decided: stop reasoning from `console.log` timestamps —
it has hit its limit (four falsified theories, all requiring real
trace-gathering round-trips through the user, each taking a full
message cycle). **The next session should capture a real profiler trace**
instead of a fifth code-level guess:

1. Open **Safari's Web Inspector** on the Tauri app's WKWebView (Tauri on
   macOS uses WKWebView; enable the Develop menu in Safari's settings if not
   already on, then Develop → [device/app name] → the Tauri window).
2. Go to the **Timelines** tab (or **JS Profile**, depending on Safari
   version), start recording, trigger the reload/project-switch, stop
   recording once the overlay closes.
3. Read the flame chart / category breakdown (Scripting, Layout, Painting,
   etc.) for where the ~4 seconds of CPU time actually goes. This will show
   definitively whether it's genuine React commit/layout cost (theory b
   above), something else entirely (a third-party library, a layout
   thrashing pattern, forced synchronous reflow from reading a DOM property
   inside the render loop, etc.) — something no amount of `console.log`
   bracketing can distinguish.
4. If the profile shows heavy `Layout`/`Recalculate Style` time
   interleaved with each segment's mount, that points toward a genuine
   per-item DOM cost — the fix would likely be virtualizing/windowing the
   294-item list (only mount visible rows, defer the rest) rather than
   anything about caching or scheduling.
5. If the profile shows something unexpected (e.g. one single long
   "Scripting" block with no yields at all across the whole ~4s), that
   would directly confirm the "one continuous blocking task, Scheduler
   never yields" theory from #4 above, and the fix would be figuring out
   why WKWebView's Scheduler integration isn't yielding (possibly a
   `MessageChannel`/`postMessage` timing quirk specific to this webview).

**This section is unstarted past the four ruled-out theories above.** Do
not assume the WKWebView-Scheduler theory or the genuine-per-item-cost
theory are confirmed — they are only the two remaining live candidates
after ruling out the other four; the profiler trace is what will actually
distinguish between them (or reveal a fifth possibility neither theory
anticipated).

---

## 7. Earlier history (for context only, already resolved, do not re-touch)

Before this session, across several earlier sessions: a long investigation
into `App.tsx`'s `buildVoiceoverWaveform` gating (`resident`/`mirror`/
`cold-miss` arms, `waveformReadyTracker.ts`'s generation counter, a
double-begin race between Apply-Sync and a reload-effect). Two real fixes
landed and are confirmed stable, already reflected in the current
(uncommitted) `src/App.tsx` and `src/services/waveformStore.ts` diffs:

1. **Reorder fix (kept)**: an early, synchronous dedupe check
   (`waveformBuiltForRef.current === incomingAssetId`) added before the
   resident/mirror gate and before any generation bump — fixed a confirmed
   double-begin race on cold Apply-Sync.
2. **Tracker-bump attempt (tried, reverted)**: making `resident`/`mirror`
   arms call `beginWaveformGeneration` was tried to fix a diagnostic-only
   "stale expected count" issue, but caused a real regression (reintroduced
   the full-screen loading overlay on every cache-hit switch) and was fully
   reverted. `resident`/`mirror` arms do NOT call `beginWaveformGeneration` —
   confirmed correct, do not re-attempt without full understanding of why it
   was reverted.

This history is why `waveformStore.ts` shows as modified in the current
working tree even though this session didn't touch it.

---

## 8. Process reminders (unchanged, apply to whoever picks this up)

- User's explicit process: implement one phase/fix at a time, stop for the
  user to manually verify in the real Tauri app, wait for their description
  of what they observe, THEN proceed. Do not batch multiple phases' code
  changes together without a verification stop between them.
- Validation gate before ever handing anything back as "done": `npx tsc
  --noEmit` clean AND `npx vitest run` fully passing (632/632 as of this
  doc).
- If a fix causes a regression or doesn't achieve the stated goal, revert
  fully and re-validate rather than layering a second fix on top — this
  user's explicit, repeatedly-confirmed preference. Followed twice more
  this session (overlay CSS revert, `startTransition` revert).
- When instrumenting/debugging, verify the instrumentation itself is
  trustworthy before trusting its output (an earlier round of this
  investigation hit a real, time-consuming bug where the instrumentation's
  OWN timing was wrong, not the thing being measured — see Section 4's
  "CRITICAL gotcha" callout).
- **When console-log-level reasoning stops producing new information (as
  happened this session after four falsified hypotheses), the user prefers
  pivoting to a real profiler over a fifth speculative code change.** Don't
  keep proposing "one more startTransition-shaped experiment" — if the
  pattern is identical across multiple different interventions, the next
  step should be observing the actual browser/engine behavior directly
  (Web Inspector Timeline), not another indirect inference from timestamps.
- When you hit ~90% of the session's limit again, stop mid-phase (not
  mid-edit) and produce an updated version of this document — same as this
  handoff.
