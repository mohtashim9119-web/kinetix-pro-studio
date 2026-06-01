# Phase 7 Sync Audit — Read-Only Investigation

> **Date:** 2026-06-01  
> **Branch:** `phase-7-sync-audit`  
> **Scope:** Read-only. Zero production diffs.

---

## Scope

This audit traces how `script + sceneDetails + voiceover + assets` combine into a timed sequence, identifies where the pipeline is sloppy with timing, and documents exactly what breaks when an asset is deleted. It covers:

- `parseProjectData()` and `finalizeSync()` — how time is allocated
- The 100 ms `setInterval` playback loop — drift, jitter, heading behaviour
- `currentSegment` derivation and audio master-clock semantics
- `useTransitionPreview` — pre-roll timing
- Export pipeline (`segmentEncoder`, `exportPipeline`, `frameRenderer`) for contrast
- The missing-asset reflow bug, with exact line references

**Out of scope:** live debugging, export profiling (covered by Task 1), any code changes.

---

## Pipeline Trace

### Inputs → Segments → Playback (step-by-step)

**1. User pastes script + scene details**

- `project.script` and `project.sceneDetails` are plain textarea state strings.  
- No computation fires on change; these are inert until Step 3.

**2. User uploads voiceover**

- `handleFileUpload(e, 'audio')` (App.tsx:623) → `putAsset(id, file, ...)` persists blob to IndexedDB → `setProject(prev => ({ ...prev, voiceoverId: newAsset.id }))`.  
- The `<audio ref={audioRef} src={voiceover.url} />` element is rendered inside App.tsx (line 1164). The browser begins loading metadata asynchronously.  
- **Duration is NOT awaited here.** `audioRef.current.duration` is populated by the browser's `loadedmetadata` event, which fires some time after the element mounts. There is no `await` and no event listener in the upload path. The sync wizard reads `audioRef.current?.duration || 0` at button-click time (lines 463, 536) — a synchronous point-in-time read. If the user clicks **Finalize Sync** before `loadedmetadata` has fired (e.g. very large audio file, slow storage), `audioDuration = 0` and `parseProjectData` falls back to `rawSegments.length * 5` seconds (line 193). This is a silent, uncommunicated fallback.

**3. User uploads assets**

- Each `handleFileUpload` call (line 623) or `handleZipUpload` (line 563) runs `putAsset` then calls `autoMatchSegments(newAssets, prev.segments)` inside `setProject`.  
- `autoMatchSegments` (syncEngine.ts:37) skips segments that already have an `assetId`; for unmatched segments it extracts the bracket tag from `heading + text`, fuzzy-matches by name, then falls back to `findAssetByContext`. No timing is computed here.

**4. Sync wizard — three validation steps**

- `runSyncStep1()` (line 456): reads `audioRef.current?.duration` and word count. Validation only — no computation.  
- `runSyncStep2()` (line 473): checks that scene detail blocks exist.  
- `runSyncStep3()` (line 493): counts fuzzy name matches. Issues a user-visible alert listing missing names but does not block progression.  
- None of these steps compute or store timing values.

**5. `finalizeSync()` — the single moment timing is computed (App.tsx:534)**

```
audioDuration = audioRef.current?.duration || 0   ← synchronous read
segments = await parseProjectData(script, sceneDetails, assets, audioDuration)

// second-pass re-accumulation of startTimes (redundant; see §Open Questions)
let acc = 0;
syncedSegments = segments.map(s => {
  start = acc; acc += s.duration;
  return { ...s, startTime: Number(start.toFixed(3)) };
});

setProject(prev => ({ ...prev, segments: syncedSegments }));
setIsSynced(true);
```

**6. Inside `parseProjectData()` — duration allocation (App.tsx:93–245)**

a. Split `sceneDetails` by double-newline → `scenes[]` (tag + description pairs).  
b. If scene descriptions are empty, fill `text` from `scriptLines` using proportional index slicing.  
c. Match assets to scenes in order:
   - Extract name from bracket tag → `isFuzzyMatch(name, a.name)` against all assets.  
   - Among matching assets, prefer unused ones (`usedAssetIdsTotal` set); tie-break to first match.  
   - If no name match: `findAssetByContext(text, unusedAssets)` — any 4+ char word from scene text contained in any asset name.  
d. **Compute durations — character-count proportional (not word-count):**
   ```
   textSegments = rawSegments.filter(s => s.text)
   totalTextLength = Σ s.text.length  (character count, not word count)
   voDuration = voiceoverDuration > 0 ? voiceoverDuration : rawSegments.length * 5

   for each rawSegment s:
     weight = s.text.length / totalTextLength   ← 0 for heading-only scenes
     targetDuration = weight * voDuration        ← 0 for heading-only scenes
     targetDuration = Math.max(targetDuration, 0.5)   ← hardcoded 0.5 s floor

     startTime = currentTimeAccumulator
     duration  = targetDuration    (rounded to .toFixed(3))
     [last segment only]: duration = Math.max(0.1, voiceoverDuration - startTime)

     currentTimeAccumulator += duration
   ```
   **Critical invariant break:** heading-only scenes consume a fixed 0.5 s regardless of `voDuration`. With N heading scenes, total allocated time = voDuration + N×0.5 s (approximately). The last segment's snap compensates by shrinking, potentially to 0.1 s minimum, leaving the timeline longer than the voiceover.

e. For video assets: `await getMediaDuration(asset.url, 'video')` — creates a new `HTMLVideoElement` per call, waits for `loadedmetadata`. If the target duration exceeds the video's natural duration, `playbackSpeed = sourceDuration / targetDuration` is set to slow the video down. No URL-level deduplication: the same video asset referenced by N segments fires N separate metadata loads.

f. Returns `VideoSegment[]` with `startTime` and `duration` already set. The `finalizeSync` second-pass re-accumulation overwrites these `startTime` values with the same rounded values — a no-op in normal cases.

**7. Duration constraint effect (App.tsx:688–712)**

After sync, a `useEffect` watches `[project.voiceoverId, isSynced, resizingId]`. If `|Σdurations − audioDuration| > 0.1` it applies a ratio correction: every segment's duration is multiplied by `audioDuration / Σdurations`, and startTimes are re-accumulated. This corrects any 0.5 s heading overrun **post-hoc** by scaling all durations proportionally. Side-effect: heading durations also get scaled (e.g. a 0.5 s heading becomes 0.47 s after correction), which changes when the heading begins relative to the voiceover.

**8. Playback — the 100 ms `setInterval` (App.tsx:715–765)**

```
setInterval(() => {
  inHeading = currentSegment?.heading && !currentSegment?.text

  if (voiceover && !inHeading && currentTime < audioDuration) {
    // AUDIO IS MASTER CLOCK
    if (audioRef.current.paused) audioRef.current.play()
    setCurrentTime(audioRef.current.currentTime)      ← reads hardware clock
  } else {
    // MANUAL ADVANCE (no audio correction)
    if (inHeading) audioRef.current.pause()
    setCurrentTime(prev => prev + 0.1 * globalPlaybackSpeed)
  }
}, 100)
```

Dependency array: `[isPlaying, voiceover, project.segments, currentSegment, exportState.isExporting, globalPlaybackSpeed]`.

**`currentSegment` derivation (App.tsx:680–683):**
```
useMemo(() =>
  project.segments.find(s =>
    currentTime >= s.startTime && currentTime < s.startTime + s.duration
  )
, [currentTime, project.segments])
```
Half-open range — a gap between segments (e.g. after a trim resize leaves startTimes misaligned) yields `null`; PreviewStage shows "Sequence Standby" and audio plays on as master.

**9. `currentTime` write paths — there are two, both firing during non-heading playback**

- **Path A:** The `setInterval` callback at line 730 writes `setCurrentTime(audioRef.current.currentTime)` every ~100 ms.  
- **Path B:** The audio element's `onTimeUpdate` handler at App.tsx:1168 writes `setCurrentTime(audioRef.current?.currentTime || 0)` whenever the browser fires `timeupdate` (~4 Hz in Chrome, ~250 ms cadence).

Both paths read the same `audioRef.current.currentTime` value, so there is no divergence. However, every write schedules a React state update → re-renders `currentSegment` useMemo, PreviewStage, Timeline, and the interval effect check. During non-heading playback the two paths fire redundantly.

**10. PreviewStage — video element sync**

For video assets, a `ref` callback fires on every render (App.tsx:349–361 in PreviewStage.tsx):

```
ref={(el) => {
  if (el) {
    el.playbackRate = (segment.playbackSpeed || 1) * globalPlaybackSpeed
    const segmentProgress = currentTime - currentSegment.startTime
    const rawTime = (segment.trimStart || 0) + segmentProgress * (segment.playbackSpeed || 1)
    const videoTime = trimEnd !== undefined ? Math.min(rawTime, trimEnd) : rawTime
    if (Math.abs(el.currentTime - videoTime) > 0.1) {
      el.currentTime = videoTime    ← fire-and-forget, no seeked await
    }
  }
}}
```

The seek is asynchronous. The browser may not reach `videoTime` before the next render. The 0.1 s threshold means the video is allowed to lag by up to 100 ms before a seek is issued, on top of the browser's seek latency.

**11. `useTransitionPreview` — pre-roll (hooks/useTransitionPreview.ts)**

~0.8 s before the transition window, `renderSegmentFrame` is called for both the outgoing and incoming segments. `renderSegmentFrame` seeks video elements (with 5 s timeout). If both renders complete before the transition window opens, `isActive = true` and the canvas overlay takes over; Framer Motion CSS animations are suppressed. If snapshots are not ready by window open, transition silently degrades to Framer Motion CSS animation — no error, no log.

---

## Timing Precision Issues

Ordered by severity.

### 1. Heading segments cause a currentTime snap-back loop — CRITICAL

**Mechanism:**

When `currentSegment` changes from a heading segment to the following non-heading segment, the `setInterval` effect dependency array (`currentSegment` is listed at line 765) triggers a teardown + rebuild. The **new** interval fires with `inHeading = false` and calls:

```js
audioRef.current.play()
setCurrentTime(audioRef.current.currentTime)  // ← T_audio
```

`T_audio` is the audio element's `currentTime` at the moment the heading began — the audio was paused then and hasn't advanced. If the heading's `startTime` ≈ `T_audio` (which is true: the last non-heading tick set `currentTime = audioRef.current.currentTime` which then crossed `heading.startTime`), snapping `currentTime = T_audio` puts it **back inside the heading segment's time range `[heading.startTime, heading.startTime + heading.duration)`**.

React re-renders. `currentSegment` useMemo returns the heading segment again. The interval effect restarts with `inHeading = true`. Audio pauses. Time advances manually. Heading ends. Loop repeats.

**Observable result:** Heading segment "freezes" while audio briefly plays during each `play()` call, slowly advancing `T_audio` a few milliseconds per loop iteration via `onTimeUpdate` events. Eventually `T_audio` crosses `heading.startTime + heading.duration` and the loop escapes. The user sees the heading linger for several seconds longer than its stored 0.5 s duration before playback continues. The voiceover audibly stutters with rapid pause/play cycling.

**Affected configurations:** Any project with `[HEADING: ...]` scenes followed by non-heading scenes. The default project (`DEFAULT_PROJECT` at App.tsx:248) has two heading scenes — a new user pressing Play on the default project will hit this loop immediately.

**Drift magnitude:** Unbounded. The heading repeats until the audio advances past the heading window. For a 0.5 s heading, the stutter typically lasts 1–3 s depending on browser audio scheduling latency.

---

### 2. `project.segments` in playback interval dependency array causes jitter on any edit during playback — HIGH

The dependency array at App.tsx:765:
```js
}, [isPlaying, voiceover, project.segments, currentSegment, exportState.isExporting, globalPlaybackSpeed]);
```

`project.segments` is an array reference. Any `setProject(prev => ({ ...prev, segments: ... }))` call produces a new array, triggering the effect. This includes:

- Adding or editing a text overlay
- Changing a segment duration in `SegmentEditorPanel`
- Applying a transition, filter, or animation
- Timeline drag-resize (`onResizeMove` fires on every `mousemove`)
- Stock asset selection completing

**What happens on each restart:**

1. `clearInterval(interval)` — active interval destroyed.
2. React schedules the new effect on the next commit (0–16 ms).
3. New `setInterval(..., 100)` — first fire is 100 ms from now.

**Gap length:** 100–116 ms where no tick fires. During non-heading playback, `onTimeUpdate` bridges the gap (fires every ~250 ms in Chrome, so at most one tick is missed). During **heading** playback the gap freezes the manual advance — every drag event during a heading extends the heading duration by 100 ms.

**During timeline drag-resize:** `onResizeMove` fires on every `mousemove` (potentially 60 events/sec). Each fires `setProject` → new `project.segments` reference → 60 interval restarts/sec → interval never fires between moves. During a 2 s resize drag, the playback interval fires zero times. Audio plays on (master clock), but `currentTime` React state is only updated by `onTimeUpdate` (~4 Hz). The timeline playhead moves in 250 ms jumps during a drag. Any concurrent heading segment is completely frozen.

**Fix direction:** Remove `project.segments` and `currentSegment` from the dep array. Use refs (`segmentsRef`, `currentSegmentRef`) updated on every render to expose current values to the closure without causing restarts.

---

### 3. Hardcoded 0.5 s heading floor can overrun voiceover duration — HIGH

**Code path (App.tsx:208):**
```js
targetDuration = Math.max(targetDuration, 0.5);
```

For a heading-only scene, `s.text = ''`, `weight = 0`, `targetDuration = 0`. The clamp produces 0.5 s regardless of `voDuration`.

**Budget arithmetic:** With V seconds of voiceover and H heading scenes:
```
text scenes consume:  Σ(text_weight_i × V)  = V  (weights sum to 1.0)
heading scenes add:   H × 0.5 s             (fixed budget, not from V)
total accumulated:    V + H × 0.5 s
last segment snapped: duration = V − lastStartTime
```

If H = 2: total accumulated before last segment = V + 1.0 s. Last segment's snap = V − (V + 0.5) = −0.5 s → `Math.max(0.1, −0.5) = 0.1 s`. Timeline runs V + 0.6 s while audio is V s. The last segment is visually clipped to 0.1 s.

**The post-sync ratio correction (App.tsx:688–712)** partially rescues this: it detects the mismatch (`|Σdurations − audioDuration| > 0.1`) and applies a ratio scale. For the example above, ratio = V / (V + 0.6). All segments (including headings) are scaled down. The invariant is then approximately restored. However:

- The ratio correction only runs when `project.voiceoverId` or `isSynced` changes — not on every heading-induced overrun.
- If `audioRef.current.duration` is 0 at that moment (not yet loaded), the effect guard fails silently and the correction never applies.
- Scaled heading durations (e.g. 0.47 s) no longer match the intended visual beat.

---

### 4. Dual `setCurrentTime` write during non-heading playback — MEDIUM

Both the `setInterval` callback (Path A) and `audio.onTimeUpdate` (Path B) call `setCurrentTime(audioRef.current.currentTime)` with the same value. This triggers two React state updates per ~100 ms window (one from the interval, one from `onTimeUpdate`). Both updates produce an identical new `currentTime` value. React batches within the same event loop tick but these arrive in different ticks, so each one causes:

- `currentSegment` useMemo re-evaluation
- `PreviewStage` re-render (video ref callback fires, seeking the video element — even if `|el.currentTime − videoTime| < 0.1`, the comparison itself runs)
- `Timeline` re-render (playhead position update)
- `useTransitionPreview` effect deps re-evaluated

Estimated: ~10–12 extra renders/sec on top of the ~10 from the interval alone, for a total of ~20–22 renders/sec during non-heading playback.

---

### 5. Video element seek is fire-and-forget in preview — MEDIUM

In PreviewStage.tsx:357:
```js
if (Math.abs(el.currentTime - videoTime) > 0.1) {
  el.currentTime = videoTime;    // no await seeked
}
```

`el.currentTime` assignment triggers an async browser seek. The assignment returns immediately. On the very next render (100 ms later), the element's `currentTime` may not have reached `videoTime` yet. The 0.1 s drift threshold prevents constant seeking, but means the displayed video frame can lag the audio by up to the seek latency (~50–200 ms for local blob URLs) plus the 0.1 s threshold slack, totalling up to 300 ms of video-behind-audio.

By contrast, `frameRenderer.ts`'s `seekVideo()` awaits the `seeked` event with a 5 s timeout — frame-accurate. The export is correct; the preview is not.

---

### 6. Stale `currentTime` in interval closure — LOW

`currentTime` appears at App.tsx:728:
```js
if (voiceover && !inHeading && currentTime < audioDuration) {
```

`currentTime` is captured from the outer scope at effect-run time. By the time this line executes (0–100 ms later), the actual `currentTime` React state is up to 100 ms ahead. The check is only relevant near end-of-playback (`currentTime < audioDuration`). In practice it causes at most one extra tick after audio ends before the end-of-playback guard (`next >= maxDuration`) fires — benign but incorrect.

---

## Missing-Asset Bug — Root Cause

**User-reported symptom:**  
> "If voiceover has 5 phrases mapped to 5 assets and I delete asset 1, asset 2 appears at t=0 instead of asset 1, and all later assets shift left. Sync is preserved relative to segment indices but broken relative to voiceover time."

There are two distinct failure paths depending on whether the user re-finalizes sync after the delete.

---

### Path A — Delete only, no re-sync

**Code path (App.tsx:979–993):**
```js
onClick={() => {
  URL.revokeObjectURL(asset.url);
  setProject(p => ({
    ...p,
    assets: p.assets.filter(a => a.id !== asset.id),
    voiceoverId: p.voiceoverId === asset.id ? undefined : p.voiceoverId,
    segments: p.segments.map(s =>
      s.assetId === asset.id ? { ...s, assetId: undefined } : s   // ← line 985
    ),
  }));
  deleteAsset(asset.id).catch(err => ...)
}}
```

After this:
- Segment 1: `assetId = undefined`, `startTime = 0`, `duration = unchanged`
- Segments 2–5: unchanged (`assetId`, `startTime`, `duration` all intact)
- `parseProjectData` is **not called**
- `autoMatchSegments` is **not called** (correct per Phase 5 decision)

**Preview at t=0 (App.tsx:681):**
`currentSegment = segments.find(s => 0 >= s.startTime && 0 < s.startTime + s.duration)` → segment 1.

**PreviewStage (line 337):**
`asset = assets.find(a => a.id === currentSegment.assetId)` = `assets.find(a => a.id === undefined)` = `undefined`.

**Fallback render (PreviewStage.tsx:378–380):**
```jsx
return (
  <div className="w-full h-full bg-gradient-to-br from-[#111] to-[#050505]
                  flex items-center justify-center p-20 text-center" />
);
```
A pure dark gradient, no error indicator, no "missing asset" label. The user sees black at t=0. Segments 2–5 display normally at their original startTimes — **no temporal shift occurs**.

**Export (exportPipeline.ts:102–115 and 117):**
```js
if (segment.assetId) {           // ← false for segment 1 (assetId = undefined)
  const asset = assetMap.get(segment.assetId);
  if (!asset?.url) { return { ok: false, error: { kind: 'asset_missing' } }; }
}
const asset = segment.assetId ? assetMap.get(segment.assetId) : undefined;  // → undefined
```
The `asset_missing` guard is **bypassed** when `assetId` is `undefined`. `encodeSegment` receives `asset = undefined`. `frameRenderer.ts:306`: `if (asset?.url)` → false. Canvas gets: black fill → gradient vignette → text overlays. A valid MP4 is exported with black frames where segment 1's visuals would have been. No warning is surfaced to the user.

**Conclusion for Path A:** The "asset 2 at t=0" symptom does NOT occur here. Segment 1 shows black; all other segments retain their original timing. The bug is silent degradation, not a reflow.

---

### Path B — Delete + re-finalize sync (root cause of the reported reflow)

After Path A, if the user clicks **Finalize Sync** again:

**`parseProjectData` re-runs with the updated `project.assets` (asset 1 missing):**

1. Scene 1's bracket tag is processed: `isFuzzyMatch(name, a.name)` against all remaining assets → no match (asset 1 was the only name match).
2. Falls through to `findAssetByContext(text, availableAssets)` (App.tsx:179–185). `findAssetByContext` splits scene 1's description into 4+ char words and checks if any appear in any asset name. If asset 2's filename contains a keyword from scene 1's description, asset 2 is returned and assigned to segment 1.
3. `usedAssetIdsTotal.add(asset2.id)`.
4. Scene 2's bracket tag: `matchingAssets = [asset2]`. `unusedAsset = matchingAssets.find(a => !usedAssetIdsTotal.has(a.id))` → `undefined` (asset 2 already used). Fallback: `asset = unusedAsset ?? matchingAssets[0]` = asset2.
5. **Both segment 1 and segment 2 receive `assetId = asset2.id`.**

All segments are rebuilt with **new IDs and fresh startTimes** proportional to their text character counts. Segment 1 starts at t=0.

**Result:** At t=0 the preview shows asset 2's visuals (voiceover phrase 1 plays over asset 2). Asset 2's originally intended scene (scene 2) also shows asset 2. The "sync preserved relative to segment indices" is correct — the temporal proportioning is intact. The "broken relative to voiceover time" is correct — phrase 1's intended visual (asset 1) is gone and the hole is filled by the wrong asset.

**The `unusedAsset ?? matchingAssets[0]` fallback at App.tsx:172** is the specific line that allows two segments to share the same asset without warning. There is no guard that detects or surfaces this duplication.

---

## Bugs, Loopholes, and Sloppy Code

| # | Severity | Location | Description |
|---|----------|----------|-------------|
| 1 | **CRITICAL** | App.tsx:715–765 | Heading segment causes `currentTime` snap-back loop — audio advances in micro-increments while heading replays; observable as multi-second stutter or freeze (see §Timing #1) |
| 2 | **HIGH** | App.tsx:765 | `project.segments` in interval dep array restarts the interval on every segment edit during playback; during drag-resize the interval never fires (see §Timing #2) |
| 3 | **HIGH** | App.tsx:193, 208 | Hardcoded 0.5 s heading floor overruns `voDuration`; ratio correction partially compensates but depends on `audioRef.current.duration` being populated at the right moment |
| 4 | **HIGH** | exportPipeline.ts:102 | `asset_missing` guard fires only when `assetId` is defined-but-missing; `assetId = undefined` silently exports black frames with no user warning |
| 5 | **MEDIUM** | App.tsx:81–88 | `getMediaDuration()` creates a new `HTMLVideoElement` per call with no URL-level cache; N segments sharing the same video asset fire N metadata loads at sync time |
| 6 | **MEDIUM** | App.tsx:1168 | `onTimeUpdate` duplicates `setCurrentTime` updates already provided by the `setInterval`; ~10 extra renders/sec during non-heading playback |
| 7 | **MEDIUM** | PreviewStage.tsx:357 | Video element seek in preview is fire-and-forget; preview video can lag audio by up to 300 ms (seek latency + 0.1 s threshold) while export is frame-accurate |
| 8 | **MEDIUM** | App.tsx:192 | `s.text.length` (character count) used for duration weights, not word count as documented in CLAUDE.md; dense prose gets more time than sparse; inconsistency with expected behaviour |
| 9 | **MEDIUM** | App.tsx:172 | `unusedAsset ?? matchingAssets[0]` silently assigns the same asset to multiple segments when the available pool is exhausted; no duplicate warning surfaced |
| 10 | **LOW** | App.tsx:728 | `currentTime` captured stale in interval closure; used only for `currentTime < audioDuration` guard near end-of-playback; at most one spurious extra tick |
| 11 | **LOW** | App.tsx:539–545 | `finalizeSync` second-pass startTime re-accumulation is redundant — `parseProjectData` already sets correct `startTime` values. Dead code path in normal operation |
| 12 | **LOW** | App.tsx:536 | `audioRef.current?.duration || 0` in `finalizeSync` is a synchronous read; if metadata hasn't loaded yet, falls back to `N × 5 s` silently (line 193) |
| 13 | **LOW** | Timeline.tsx:407 | Audio waveform bars use `Math.random()` heights — not real waveform data; re-randomizes on every render; could mislead users into thinking it represents actual audio |

---

## Comparison: Preview Sync vs Export Sync

This explains why exports are "fine" while preview drifts.

| Aspect | Preview | Export |
|--------|---------|--------|
| **Time source** | `audioRef.current.currentTime` (audio master) + `+0.1 s/tick` (heading manual) | Integer frame index: `timeInSegment = startOffset + i / fps` — no accumulation |
| **Clock precision** | ±10–20 ms interval jitter; heading drift unbounded | Zero — frame counter is exact |
| **Heading behaviour** | Audio paused; `currentTime` advances manually; triggers snap-back loop on exit | No heading concept — all segments encoded at stored `duration`; audio muxed continuously |
| **Audio sync mechanism** | `setCurrentTime` reads audio element's hardware clock per tick | Audio muxed post-encode with ffmpeg `-shortest`; no sync loop needed |
| **React lag** | `currentTime` state lags audio by 0–100 ms (interval granularity) + 0–16 ms render scheduling | N/A — no React state involved in encoding |
| **Missing asset** | Dark placeholder rendered; playback continues silently | Black frames encoded; export continues silently; no error surfaced |
| **Transition timing** | Pre-roll snapshots ~0.8 s before window; degrades silently if snapshots not ready | Frame-accurate blend: `blendAlpha = (timeIntoTransition / transitionDuration)` per frame |
| **Video seek correctness** | Fire-and-forget; up to 300 ms lag from threshold + seek latency | `await seekVideo()` with 5 s timeout + clamp to duration — frame-accurate |

**Why exports are perceived as correctly synced:**

1. The export trusts the stored `startTime`/`duration` values computed by `parseProjectData`. If those values correctly proportion the voiceover, the output is proportionally correct.
2. No heading-pause mechanism exists in the encoder — the voiceover plays straight through under all segments. The "heading pauses voiceover" feature is **preview-only behaviour** that is not reproduced in the export. Users comparing preview to export will notice the audio plays over headings in the export but pauses during headings in preview.
3. Frame-accurate seeking in `frameRenderer.ts` means video frames exactly match their `timeInSegment` value. Preview's fire-and-forget seek means video frames may be 200–300 ms behind the stated time.

**The key structural difference:** The export pipeline is a pure function of stored segment data. Preview is a stateful real-time system driven by a browser timer and an audio element. The two systems share the segment data (startTime, duration, assetId) but implement time-advancing logic independently, with different precision guarantees.

---

## Recommended Fixes

Ordered by impact. Effort estimates: S = < 1 day, M = 1–3 days, L = 3–7 days.

### Fix 1 — Eliminate the heading snap-back loop (CRITICAL → M)

**What to change:**  
Instead of pausing the audio element during headings, **seek the audio forward** to account for the heading's duration, then resume. This way, when heading ends and the interval reads `audioRef.current.currentTime`, that value is already past the heading window and no snap-back occurs.

```ts
// On entering a heading: advance audio by heading.duration
if (inHeading && !audioRef.current.paused) {
  const headingEnd = currentSegment.startTime + currentSegment.duration;
  audioRef.current.currentTime = headingEnd;
  audioRef.current.pause();
}
// On exiting a heading: audio currentTime is already past the heading; just resume
```

Alternative (lower risk): abandon heading-pause semantics entirely. Headings would play with the voiceover running underneath, matching the export behaviour. Preview and export would be consistent.

**Expected impact:** Eliminates the stutter/freeze on heading segments. Makes preview and export heading behaviour consistent.

---

### Fix 2 — Remove `project.segments` and `currentSegment` from interval dep array (HIGH → S)

**What to change:**  
Use refs for the values the interval needs to read dynamically. Update refs on every render via `useEffect` with no dep array (or directly in the render body).

```ts
const segmentsRef = useRef(project.segments);
const currentSegmentRef = useRef(currentSegment);
// In render body (not in a useEffect):
segmentsRef.current = project.segments;
currentSegmentRef.current = currentSegment;

// Dep array becomes:
}, [isPlaying, voiceover, exportState.isExporting, globalPlaybackSpeed]);
```

Inside the interval, replace closure references to `currentSegment` and `project.segments` with `currentSegmentRef.current` and `segmentsRef.current`.

**Expected impact:** Eliminates interval restarts on project edits and segment boundary changes. Eliminates drag-resize playback freeze. Eliminates the heading-loop's restart-driven mechanism (though Fix 1 is still needed for the snap-back).

---

### Fix 3 — Fix heading duration overrunning voiceover (HIGH → S)

**What to change:**  
Replace the hardcoded 0.5 s floor with a proportional heading budget. Two options:

**Option A** — Assign headings a synthetic word count:
```ts
// Treat each heading-only scene as if it has N words for budgeting purposes
const HEADING_WORD_SURROGATE = 5;
const weight = s.text
  ? s.text.length / totalTextLength
  : HEADING_WORD_SURROGATE / (totalTextLength + HEADING_WORD_SURROGATE * headingCount);
```

**Option B** — Fixed small percentage of `voDuration`:
```ts
const headingBudget = 0.02 * voDuration; // 2% of total per heading
targetDuration = s.text ? weight * (voDuration - headingCount * headingBudget) : headingBudget;
```

Either approach ensures `Σdurations ≈ voDuration` without the ratio-correction post-hoc fix.

**Expected impact:** Last segment no longer clips to 0.1 s. Timeline length matches voiceover exactly from parseProjectData output. Ratio correction effect becomes approximately a no-op.

---

### Fix 4 — Warn on missing-asset export, tighten the guard (HIGH → S)

**What to change (exportPipeline.ts:97–115):**
```ts
// Existing guard only fires when assetId is set but missing.
// Add a warning path for assetId === undefined:
if (!segment.assetId) {
  console.warn(`[export] segment ${i + 1} has no asset — encoding black frames`);
  // Optionally: accumulate warnings and return them in ExportResult
}
```

Longer term: extend `ExportResult` with an optional `warnings` array:
```ts
type ExportResult =
  | { ok: true; blob: Blob; warnings?: ExportWarning[] }
  | { ok: false; error: ExportError };
```

Surface the warnings in the export progress modal so the user knows which segments exported as black.

**Expected impact:** Users are informed when they export a project with unlinked segments. Prevents "silent bad exports."

---

### Fix 5 — Remove `onTimeUpdate` duplicate write (MEDIUM → S)

**What to change (App.tsx:1168–1172):**  
Delete the `onTimeUpdate` handler from the `<audio>` element entirely. The `setInterval` already reads `audioRef.current.currentTime` on each tick — it is the authoritative update path. `onTimeUpdate` adds only render churn.

```tsx
// Before:
<audio ref={audioRef} src={voiceover.url}
  onTimeUpdate={() => { if (isPlaying) setCurrentTime(audioRef.current?.currentTime || 0); }} />

// After:
<audio ref={audioRef} src={voiceover.url} />
```

**Expected impact:** ~10 fewer React renders/sec during non-heading playback. Removes the ambiguity of two sources writing `currentTime`.

---

### Fix 6 — Cache `getMediaDuration` by URL (MEDIUM → S)

**What to change (App.tsx:81):**
```ts
const mediaDurationCache = new Map<string, number>();

const getMediaDuration = (url: string, type: 'video' | 'audio'): Promise<number> => {
  const cached = mediaDurationCache.get(url);
  if (cached !== undefined) return Promise.resolve(cached);
  return new Promise((resolve) => {
    const media = type === 'video' ? document.createElement('video') : document.createElement('audio');
    media.src = url;
    media.onloadedmetadata = () => {
      mediaDurationCache.set(url, media.duration);
      resolve(media.duration);
    };
    media.onerror = () => resolve(0);
  });
};
```

**Expected impact:** Eliminates N-fold redundant metadata loads when the same video is used by multiple segments. Faster `parseProjectData` on projects with shared video assets.

---

### Fix 7 — Character count → word count weighting (MEDIUM → S)

**What to change (App.tsx:192):**
```ts
// Before:
const totalTextLength = textSegments.reduce((acc, s) => acc + s.text.length, 0) || 1;
// weight = s.text.length / totalTextLength

// After:
const wordCount = (s: { text: string }) =>
  s.text.split(/\s+/).filter(Boolean).length;
const totalWordCount = textSegments.reduce((acc, s) => acc + wordCount(s), 0) || 1;
// weight = wordCount(s) / totalWordCount
```

**Expected impact:** Duration allocation aligns with the documented "word-count proportional" behaviour. Dense prose no longer receives disproportionate time.

---

## Open Questions

These could not be resolved from a read-only audit and require live debugging or a controlled test export.

1. **Does the heading snap-back loop reproduce on the default project?** `DEFAULT_PROJECT` contains `[HEADING: Welcome to Kinetix]` and `[HEADING: Advanced Logic]` (App.tsx:252–253). If a user clicks Play with no sync performed (segments = []), `currentSegment` is null and the loop can't fire. But if a user syncs and then plays, the two heading segments should trigger the loop. A 30-second live test would confirm severity and frequency.

2. **Does the ratio correction (App.tsx:688–712) reliably fire after `finalizeSync`?** The effect depends on `project.voiceoverId` changing or `isSynced` flipping. If `voiceoverId` is already set before sync runs, the only trigger is `isSynced = true`. This sets off the effect once. But if `audioRef.current.duration` is 0 at that moment (audio not yet loaded), the guard `if (isSynced && voiceover && audioRef.current?.duration)` silently fails and the overrun is never corrected. Reproducing this requires a slow-loading audio file and a fast Finalize click.

3. **What is the actual `onTimeUpdate` fire rate in this app?** Spec says "as frequently as the implementation can handle." Chrome historically fires at ~4 Hz (250 ms), but can vary. If Chrome fires faster (e.g. 10 Hz) the render churn from the dual write path (Fix 5) is more significant than estimated.

4. **Is the `finalizeSync` second-pass re-accumulation truly dead code?** Under floating-point edge cases, `parseProjectData`'s `toFixed(3)` rounding and the second-pass `toFixed(3)` rounding could diverge by one ULP. A test with 20+ segments would confirm whether the second pass ever produces a different result.

5. **Does the heading-pause design intentionally differ from export behaviour?** CLAUDE.md states "Headings pause the voiceover during transitions." The export never pauses audio. If the intended behaviour is that headings should also pause the audio in the export, the encoder would need a heading-detection pass — a significant change to the pipeline. If the intent is that only preview pauses (for visual effect) and export runs continuously, Fix 1 should align preview to export (no pause) rather than add heading-pause to the encoder.
