# Timeline Waveform Rewrite + Apply-Sync Loading Experience — Implementation Plan

> **Status:** Steps 1-6 shipped in commit `f3d429e` on branch
> `webgl2-effects-engine`. Waveform-peaks persistence (the "Persistence of
> peaks" addendum, §1/§4.3 below) is implemented on top of that commit but is
> currently **uncommitted** in the working tree. See "Implementation Status"
> immediately below for the per-step breakdown.
> **Baseline:** HEAD = `f3d429e` (this doc was originally written against
> baseline `de4c195`, before any of Steps 1-6 existed — that baseline is now
> historical).
> **Lifecycle:** This document was originally meant to be **temporary** —
> deleted once the rewrite was merged and verified. That is **deferred**:
> the persistence layer above is still uncommitted, at least one known issue
> (timeline scroll-lag) is still open, and this doc is still the active
> reference for both. Do not delete until everything below is committed and
> verified.

---

## Implementation Status

| Step | What | Status |
|---|---|---|
| 1 | Chunked decode pipeline — `waveformPipeline.ts`'s yielding twin of the synchronous peak builder (`buildSourceChunked`), called once from Apply Sync + the reload effect, never from a render-triggered effect (§3, §4.3) | ✅ Done — `f3d429e` |
| 2 | Async draw queue — `waveformDrawQueue.ts` + `SegmentWaveform.tsx`'s off-screen-canvas → `<img>` draw (§7 mitigation #1), batched across frames instead of one synchronous flush | ✅ Done — `f3d429e` |
| 3 | Peak density tuning — `PEAKS_PER_SECOND` retuned from the originally-planned 200 to a shipped value of **10** after evaluating 200/6/30/10 on the 294-segment reference project (§4.2, corrected below) | ✅ Done — `f3d429e` |
| 4 | Ready-tracker — `waveformReadyTracker.ts`, a generation-tagged draw-completion registry gating the loading overlay (§6.6) | ✅ Done — `f3d429e` |
| 5 | Loading overlay — `SyncLoadingOverlay.tsx`, spanning both the pre-waveform sync phase (`isProcessing`) and the waveform-draw phase (`isWaveformReady`) (§10) | ✅ Done — `f3d429e` |
| 6 | Legacy 300-bar system removal — `ENABLE_LEGACY_BARS`, `buildLegacyBars`, `LEGACY_BAR_COUNT`, `waveformBars` state, and the DOM-bar lane JSX all deleted outright, not flagged off (§11 step 6) | ✅ Done — `f3d429e` |
| 7 | Waveform-peaks persistence — `waveformStore.ts`, an IndexedDB cache keyed by `[projectId, assetId]` + a blob-size invalidation guard, wired into `buildVoiceoverWaveform`'s read/write paths and all three eviction points (voiceover replace ×2, project delete) — an addendum beyond the original 6-step plan (see the "Persistence of peaks" addendum under §1 and the updated §4.3) | ✅ Done — **uncommitted** |
| — | Delete this document (original "Lifecycle" intent above) | ⏳ Deferred until Step 7 is committed and the open scroll-lag issue is resolved/verified |

---

## 1. Overview / Goals / Non-Goals

### What this rewrite replaces

Today the timeline voiceover waveform is a **fixed 300-bar DOM waveform**:

- **Decode + sampling** — `src/components/Timeline.tsx:117-149`. One
  `AudioContext.decodeAudioData` pass over the whole voiceover, then a
  **fixed `BAR_COUNT = 300`** loop that computes a **mean** of
  `Math.abs(sample)` per block (`sum / blockSize`), normalized against the
  global max. Result stored in `waveformBars: number[]` state
  (`Timeline.tsx:113`).
- **Rendering** — `src/components/Timeline.tsx:551-592`. Per segment, a
  slice of the 300-element array is computed by proportion
  (`startBar`/`endBar` from `segStart/totalDuration`), then each element
  becomes a **DOM `<div>` bar** with `height: Math.max(6, pow(amp,0.5)*68)px`
  (`Timeline.tsx:574-580`). This produces individual bar rectangles, and the
  per-segment bar count is whatever falls inside the proportional slice.

This has three concrete defects we are fixing:
1. **Resolution is global, not per-segment** — 300 bars spread across a
   21-minute project is ~4 bars/segment for a 294-segment project. Useless
   detail.
2. **Mean sampling flattens transients** — speech peaks disappear.
3. **No feedback during Apply Sync** — after "Apply Sync" is clicked, the app
   shows a black screen for several seconds (`handleApplySyncFromFiles`,
   `src/App.tsx:1499-1652`, sets only `isProcessing` which drives no
   full-screen UI — see §6). The waveform then pops in whenever the decode
   effect happens to finish.

### Goals

1. **Per-segment, peak-based waveform** drawn on a **Canvas 2D element per
   segment**, at **maximum-zoom detail density**, drawn **once** and only
   redrawn on an explicit, tightly-controlled set of triggers.
2. **Mirrored filled-curve waveform** (CapCut/Premiere look), not bars.
3. **Zoom is never a redraw trigger** — zooming out visually shrinks the
   already-drawn canvas.
4. **New Apply-Sync loading screen** with spinner + rotating status text that
   also front-loads drawing every segment's waveform before the editable
   timeline is revealed.
5. **Zero regression** to the resize-drag engine, which depends on
   `data-seg-id` + width-driven segment containers.

### Non-Goals (explicitly out of scope — do NOT attempt in this rewrite)

- **No click-to-seek, hover-scrub, or amplitude tooltip on the waveform.**
  The prior audit confirmed none exists today (bars are pure `<div>`s with no
  handlers). We preserve container-level behavior only; we add no new
  waveform interactions.
- **No change to the transcription pipeline** (`useWhisper`,
  `whisperService`, whisper sidecar). The transcription progress UI already
  exists (`TranscriptionBar`, see §6.4) and is untouched except where §6
  explicitly says to reuse/verify it.
- **No change to the resize-drag math, cascade, speed-coupling, or
  ghost-click fix** in `App.tsx` `onResizeStart` (`src/App.tsx:2453-2602`).
  The only new obligation there is "commit → redraw one segment" (§5.3).
- **No change to export / frameRenderer / the WebGL2 engine.** The waveform
  is a timeline-only editor affordance; it never participates in export.
- **No multi-channel waveform.** Channel 0 only, exactly as today
  (`decoded.getChannelData(0)`).
- **No persistence of *waveform pixels/canvas bitmaps*.** Canvas bitmaps
  are never serialized to IndexedDB — they're cheap to redraw from peaks and
  tied to per-session DPR/zoom geometry.
  > **Addendum (2026-07-18, `webgl2-effects-engine`):** this bullet originally
  > covered peaks too — "Waveforms are recomputed from the decoded audio each
  > app session" — but that part of the decision is **reversed**. An audit
  > found every project reload re-ran the full `decodeAudioData` + peak-
  > extraction pass unconditionally (§4.3's reload path), even when the
  > voiceover was byte-identical to the prior session, because nothing about
  > the decoded *peaks* (a small `Float32Array`, ~10 columns/sec) was ever
  > kept — only the blob itself round-tripped through IndexedDB. On a large
  > voiceover (e.g. the 294-segment/21-minute project referenced throughout
  > this doc) that's a multi-second rebuild on *every* reload, not just the
  > first. The reload cost turned out worse in practice than this doc
  > anticipated when it waved the rebuild off as "the audio decode already
  > reruns each session" — that framing undersold how much heavier the reload
  > path is than a cheap redraw. Peaks are now persisted to IndexedDB
  > (`src/services/waveformStore.ts`), keyed by the voiceover asset's stable
  > `id` (not its blob URL, which is re-minted every session) with the source
  > blob's byte size stored alongside as an invalidation guard. Canvas
  > bitmaps/images remain unpersisted — this reversal is peaks-only. See
  > updated §4.3 below.
- **No visual redesign of the rest of the timeline** (ruler, playhead,
  headings, segment rows) beyond swapping the audio-lane bar markup for a
  canvas.

---

## 2. Confirmed Facts From the Current Code (do not re-derive)

| Fact | Location | Value |
|---|---|---|
| Max zoom density (`ppsMax`) | `src/components/Timeline.tsx:103` | **`100` px/s**, hard ceiling |
| Zoom formula | `Timeline.tsx:99-106` | exp-interp `ppsMin..100` via `sliderT`; short projects pin at 100 |
| App's pps ref (non-render consumers) | `src/App.tsx:659-661` | `pixelsPerSecondRef` default `100`, kept in sync via `onPixelsPerSecondChange` |
| Current waveform decode | `Timeline.tsx:117-149` | one whole-track `decodeAudioData`, channel 0 |
| Current sampling | `Timeline.tsx:134-143` | fixed 300 bars, **mean** of abs, global-max normalize |
| Current per-segment render | `Timeline.tsx:566-583` | proportional slice → DOM bars |
| Audio-lane container (width-driven) | `Timeline.tsx:554-560` | `data-seg-id={s.id}`, `width: s.duration*pixelsPerSecond` |
| Resize-drag live width write | `src/App.tsx:2474-2521` | `querySelectorAll('[data-seg-id]')` → `el.style.width` per rAF |
| Resize-drag commit | `src/App.tsx:2528-2599` | `handleUp` → `applyDurationChange` (one state commit on mouseup) |
| Apply Sync handler | `src/App.tsx:1499-1652` | async; sets `isProcessing`, then `isSynced`, `syncStep` |
| `isProcessing` UI | (none full-screen) | only drives the RefreshCw spin on the Apply button (`DropZonePanel.tsx:1261`) |
| Transcription progress UI | `src/components/TranscriptionBar.tsx` + `App.tsx:2284-2292` | already exists; phases idle/transcribing/done/warning/error |
| Segment fields available | `src/types.ts:161-205` | `id`, `startTime`, `duration`, `assetId`, `trimStart?`, `trimEnd?`, `sourceDuration?` |
| Voiceover props into Timeline | `src/App.tsx:2445-2447` | `voiceoverName`, `voiceoverUrl`, `voiceoverFile` |

**Reference project for all estimates:** **294 segments, 21 minutes**
(1260 s) of voiceover.

---

## 3. High-Level Architecture

```
Apply Sync click
   │
   ▼
handleApplySyncFromFiles (App.tsx)
   │  (1) parse + persist + align  → committedSegments      [existing]
   │  (2) decode voiceover ONCE → Float32Array (channel 0)  [NEW, moved here]
   │  (3) draw ALL segment canvases → wait for all-drawn     [NEW]
   │        gated by a Promise.all / counter (§6.3)
   ▼
Loading screen visible the whole time (spinner + rotating status)  [NEW]
   │
   ▼
setIsSynced(true) + reveal editable timeline   [only after (1)+(3) done]
```

Runtime data ownership:

- **A new module `src/services/waveformPeaks.ts`** (pure, no React/DOM):
  decode-to-peaks math + the canvas drawing routine. Keeps the heavy math out
  of the component and testable in isolation, matching the repo's
  services-vs-components split (CLAUDE.md conventions).
- **A new component `src/components/SegmentWaveform.tsx`**: owns exactly one
  `<canvas>` for one segment, plus the redraw effect (§5). Replaces the inline
  DOM-bar IIFE at `Timeline.tsx:566-583`.
- **A new hook or context to hold the decoded peaks** for the whole track so
  each `SegmentWaveform` can extract its own window without re-decoding
  (§4.3). Recommended: lift decoded peaks into `App.tsx` (it already owns the
  voiceover asset and the Apply-Sync flow) and pass a stable
  `WaveformSource` object down through `Timeline` → `SegmentWaveform`.

---

## 4. Data Pipeline Design

### 4.1 Decode strategy — once per project, whole-track

**Keep the single whole-track decode** (as today). Decoding per-segment would
require slicing the compressed audio, which `decodeAudioData` cannot do
cheaply. Instead:

1. Decode the whole voiceover **once**, obtaining `Float32Array` = channel 0
   PCM at the file's native sample rate (`decoded.sampleRate`, typically
   44100 or 48000). Also capture `decoded.duration` (seconds).
2. From that PCM, **reduce to a single global peaks array at max-zoom
   density** (§4.2). This global peaks array — NOT the raw PCM — is what
   `SegmentWaveform` components read from. Each segment maps its
   `[startTime, startTime+duration)` window onto index ranges of the global
   peaks array by seconds (peaks are stored at a known, fixed samples-per-
   second, so the mapping is `floor(time * PEAKS_PER_SECOND)`).

**Why keep whole-track PCM reduction rather than store per-segment PCM:**
segments can be re-timed (resize-drag, re-sync) so their windows shift; a
time-indexed global peaks array survives re-timing without re-decoding.
Discard the raw `Float32Array` after building the global peaks array (it is
large; see §7) — keep only the reduced peaks.

### 4.2 Sampling — peak-based, at max-zoom density

**Originally planned: one waveform "column" per screen pixel at maximum
zoom.** Max zoom is `100 px/s` (`Timeline.tsx:103`). The initial design
called for sampling at **max-zoom px/s × DPR-cap columns per second** so the
drawn image would never be under-sampled even at the 2× DPR cap (§5.5 /
decision #4):

```
PEAKS_PER_SECOND = ppsMax * DPR_CAP = 100 * 2 = 200   // originally-planned columns per second
```

> **Addendum (shipped in `f3d429e`) — density retuned to 10/sec, decoupled
> from `WAVEFORM_MAX_PPS × WAVEFORM_DPR_CAP`:** the 200/sec design above was
> diagnosed as the dominant cost in a ~2.5-minute Apply-Sync freeze on the
> 294-segment/21-min reference project. Several densities — 200, 6, 30, and
> 10 peaks/sec — were evaluated on that project before settling on **10/sec**:
> good enough visual fidelity for this product's zoom levels, while keeping
> the Apply-Sync peak build fast. `PEAKS_PER_SECOND` is now a deliberate,
> permanent product choice, **not** derived from `WAVEFORM_MAX_PPS ×
> WAVEFORM_DPR_CAP` — see `waveformPeaks.ts`'s own comment on the constant,
> which this addendum mirrors. Because 10/sec is well below
> `WAVEFORM_MAX_PPS × WAVEFORM_DPR_CAP` (200), the "≥1 peak column per
> backing pixel at max zoom" property this section originally guaranteed
> **no longer holds** — waveforms are visibly coarser at high timeline zoom.
> That is an accepted, permanent trade-off, not a bug. The shipped constant:
>
> ```ts
> export const PEAKS_PER_SECOND = 10;
> ```
>
> `WAVEFORM_MAX_PPS` (100) and `WAVEFORM_DPR_CAP` (2) are unchanged and still
> govern the canvas **backing-store** size (§5.2) — only the peak-extraction
> density decoupled from them. See §5.3's addendum below for the downstream
> effect on the drawn curve, and §12 risk #6 for the retired guarantee.

The constants as originally proposed, for historical context on the coupling
this section used to describe:

```ts
export const WAVEFORM_MAX_PPS = 100;   // must equal Timeline.tsx ppsMax — still true
export const WAVEFORM_DPR_CAP = 2;     // decision #4 — still true
// PEAKS_PER_SECOND was originally proposed as WAVEFORM_MAX_PPS * WAVEFORM_DPR_CAP
// (200); see the addendum above for why that derivation was dropped.
```

> **Coupling callout:** `WAVEFORM_MAX_PPS` MUST stay equal to `ppsMax` in
> `Timeline.tsx:103`. Add a `console.assert` (dev-only, matching the repo's
> `constants.ts` guard style) in `Timeline.tsx` that asserts
> `WAVEFORM_MAX_PPS === ppsMax`. This remains true independent of the
> `PEAKS_PER_SECOND` retuning above — `WAVEFORM_MAX_PPS` still sizes the
> backing store, it just no longer sizes the peak density too.

**Peak (not mean) extraction.** For each output column `c`, take the block of
PCM samples `[c*blockSize, (c+1)*blockSize)` and record the **max absolute
amplitude** in that block, not the average:

```
blockSize   = round(sampleRate / PEAKS_PER_SECOND)      // e.g. 48000/10 = 4800 samples/column (shipped value)
totalColumns = ceil(pcm.length / blockSize)

for c in 0..totalColumns-1:
    peak = 0
    for j in c*blockSize .. min((c+1)*blockSize, pcm.length)-1:
        a = abs(pcm[j])
        if a > peak: peak = a
    peaks[c] = peak
```

`peaks` is a `Float32Array` of length `totalColumns`.

**Normalization.** Normalize by the **global peak** (matches today's global-
max normalize, so no per-segment brightness jumps):

```
globalMax = max(peaks) || 1e-3        // avoid /0 on silence
for c: peaks[c] = peaks[c] / globalMax   // now in [0,1]
```

Store the normalized `Float32Array peaks` plus `PEAKS_PER_SECOND` as the
`WaveformSource`:

```ts
interface WaveformSource {
  peaks: Float32Array;        // normalized [0,1], global max
  peaksPerSecond: number;     // = PEAKS_PER_SECOND (10, shipped value — see §4.2 addendum)
  totalDuration: number;      // decoded.duration (s), for bounds
}
```

**Per-segment window extraction** (done inside `SegmentWaveform`, no copy
needed — pass indices):

```
startCol = floor(segment.startTime * peaksPerSecond)
endCol   = floor((segment.startTime + segment.duration) * peaksPerSecond)
// clamp both to [0, peaks.length]
```

> Note: today's slice uses `segStart` computed by summing preceding segment
> durations (`Timeline.tsx:567`). Prefer `segment.startTime` directly
> (`types.ts:165`) — it is already the cumulative start and avoids the O(n)
> reduce per segment. Confirm `startTime` is populated by
> `applyAnchorBasedTiming` before relying on it (it is — every timing pass
> sets `startTime`).

### 4.3 When the decode runs

- **Primary path (new):** decode happens **inside the Apply-Sync loading
  flow** (§6.3), so peaks exist before the timeline is revealed. Move the
  decode out of `Timeline.tsx`'s mount effect and into the Apply-Sync
  orchestration in `App.tsx`.
- **Reload path (updated 2026-07-18 — see Addendum above):** on app load with
  a persisted project + voiceover blob restored from IndexedDB, the timeline
  mounts already-synced. An `App.tsx` effect keyed on the voiceover asset id
  first checks `waveformStore.ts` for persisted peaks matching that asset id
  + blob size; if found, they're loaded directly and no decode happens at
  all. Only on a cache miss (first-ever sync, a genuinely new/replaced
  voiceover, or a size-guard mismatch) does the original decode-to-peaks pass
  run, after which its result is written back to `waveformStore.ts` for the
  next reload. Canvas bitmaps are still never persisted — every reload (cache
  hit or miss) draws all segment canvases fresh from whichever peaks it
  ended up with. During a cache-miss rebuild, show a lightweight inline
  "Loading waveform…" state on the audio lane (NOT the full Apply-Sync screen
  — the project is already usable). This is an accepted, low-risk async:
  segments render immediately; each canvas fills in when peaks arrive. See
  §6.5.

---

## 5. Canvas Drawing Design

### 5.1 One canvas per segment

Replace the DOM-bar IIFE (`Timeline.tsx:566-583`) with
`<SegmentWaveform segment={s} source={waveformSource} pixelsPerSecond={pixelsPerSecond} />`,
rendered inside the existing width-driven container
(`Timeline.tsx:554-560`) **which keeps `data-seg-id` and the width style
unchanged** (§8).

Structure:

```
<div data-seg-id={s.id} style={{ width: s.duration*pixelsPerSecond }} ...>   // UNCHANGED container
   ...resize handles (unchanged)...
   <SegmentWaveform ... />   // replaces the bars IIFE; absolutely fills the lane
</div>
```

`SegmentWaveform` renders a single `<canvas>` with:

```
style={{ width: '100%', height: '100%', display: 'block' }}
```

so it **visually stretches with the container width** — this is the mechanism
that makes zoom-out shrink the image with zero redraw (§5.4). The canvas's
**backing store** (`canvas.width/height` attributes) is set at max detail;
CSS `width:100%` scales the bitmap down to the current segment pixel width.

### 5.2 Backing-store dimensions (max-detail, DPR-capped)

The backing store is drawn at **maximum-zoom density**, independent of current
zoom:

```
DPR_CAP    = 2
dpr        = min(window.devicePixelRatio || 1, DPR_CAP)     // decision #4 cap

cssMaxWidthPx  = segment.duration * WAVEFORM_MAX_PPS         // width AT max zoom (100 px/s)
laneHeightPx   = 80                                          // audio lane is h-20 = 80px (Timeline.tsx:552)

canvas.width   = round(cssMaxWidthPx * dpr)                  // backing store, capped at 2x
canvas.height  = round(laneHeightPx  * dpr)
```

Then `ctx.scale(dpr, dpr)` so all drawing math below is in CSS pixels against
a `cssMaxWidthPx × laneHeightPx` coordinate space.

> **Where the DPR cap is applied:** exactly here, `min(devicePixelRatio, 2)`,
> at canvas creation in `SegmentWaveform`. It is the ONLY place DPR is read.
> On a 3× screen this caps backing-store memory at 2×. See §7 for the memory
> estimate.

> **Guard against huge single canvases:** a very long segment at 100 px/s ×
> 2 dpr could produce a very wide backing store (e.g. a 60 s segment →
> 60·100·2 = 12000 px wide). Browsers cap canvas dimensions (~16384 px in
> WebKit/Blink for one side; total-area caps are lower). Add a
> `MAX_CANVAS_BACKING_WIDTH = 8192` clamp: if `canvas.width` would exceed it,
> reduce the effective peaks-per-column (draw fewer columns) so the image
> stays within the cap. In practice a 21-min/294-seg project averages ~4.3 s
> per segment (~860 px backing width) — well under the cap — so this clamp is
> a safety net, not a common path. Flag as a validation item (§10).

### 5.3 Mirrored filled-curve algorithm (CapCut style)

Draw a **single continuous filled shape**, symmetric above and below a
horizontal center line. Not bars.

Coordinate setup (CSS-pixel space after `ctx.scale(dpr,dpr)`):

```
W        = cssMaxWidthPx
H        = laneHeightPx           // 80
midY     = H / 2                  // 40
maxAmpPx = (H / 2) - 2            // 2px vertical padding top+bottom → 38
```

Column-to-x mapping. Let `N = endCol - startCol` be the number of source peak
columns for this segment. As originally designed, backing width == `W*dpr`
and sampling at `PEAKS_PER_SECOND = 200 = 100*2` would give (by construction)
**exactly one peak column per backing pixel at max zoom** — so peak columns
could be iterated directly and mapped each to its x:

> **Addendum (shipped in `f3d429e`):** with the retuned `PEAKS_PER_SECOND = 10`
> (§4.2 addendum), this 1:1 property **does not hold** — `N` is typically far
> smaller than the backing width in device pixels. The shipped
> `sampleColumnPeaks`/`drawSegmentWaveform` (`waveformPeaks.ts`) handle this by
> computing `outputColumns = min(N, canvas.width)`, which in the common case
> resolves to `N`: the sparse peak columns are spread (not collapsed) across
> the full CSS width via `xs[i] = (i / M) * W`, same as the mapping below —
> only now `M` (`= N`) is small relative to `W`, so the drawn curve is
> deliberately coarser/blockier at high zoom than this section's original
> "exactly one column per pixel" framing assumed. Still a straight iterate-
> and-map, just over fewer points.

```
for i in 0..N-1:
    col   = startCol + i
    amp   = clamp(source.peaks[col] ?? 0, 0, 1)     // [0,1]
    x     = (i / N) * W                              // spread window across full CSS width
    aPx   = max(1, amp * maxAmpPx)                   // min 1px so silence still shows a hairline
    store topY[i] = midY - aPx
    store botY[i] = midY + aPx
```

Optional amplitude shaping to match today's perceptual curve
(`pow(amp,0.5)`): apply `amp = Math.pow(amp, 0.65)` before scaling. Keep this
tunable; document the exact value chosen.

**Path construction — smooth mirrored fill.** Build ONE path that traces the
top envelope left→right, then the bottom envelope right→left, and fill it:

```
ctx.beginPath()
ctx.moveTo(0, midY)
// top envelope, left→right, smoothed
for i in 0..N-1: lineTo(x[i], topY[i])         // (see smoothing note)
ctx.lineTo(W, midY)
// bottom envelope, right→left (mirror)
for i in N-1..0: lineTo(x[i], botY[i])
ctx.closePath()
ctx.fill()
```

**Smoothing (the "curve" look).** Two acceptable approaches — pick ONE and
document it:

- **(A) Straight `lineTo` per column (simplest, still reads as a curve at
  200 cols/s).** Given ~200 columns/sec the polyline already looks smooth.
  Start here; it is the lowest-risk implementation.
- **(B) Quadratic smoothing** for an explicitly rounded envelope: replace the
  top loop with midpoint-quadratic segments —
  `for i: ctx.quadraticCurveTo(x[i], topY[i], (x[i]+x[i+1])/2, (topY[i]+topY[i+1])/2)`
  — and mirror for the bottom. Use only if (A) looks too jagged in Tauri on
  real audio. Costs more path ops; validate performance with 294 canvases
  (§10).

> **Addendum (shipped in `f3d429e`) — approach (A) confirmed final, at a
> different density than assumed here:** `drawSegmentWaveform`
> (`waveformPeaks.ts`) ships straight `lineTo` per column, exactly as (A)
> describes — no escalation to quadratic (B) was needed. But it runs at the
> shipped **10 cols/sec** (§4.2 addendum), not the ~200 cols/sec this
> subsection assumed when judging (A) "already looks smooth." The polyline is
> visibly coarser as a result, especially at high timeline zoom; that's the
> same accepted trade-off noted in §4.2 and §5.3's earlier addendum above, not
> a re-opened decision between (A) and (B).

**Down-sampling when there are more columns than pixels.** At max zoom there
is ~1 column/pixel, so no down-sampling is needed for the backing store. If
the `MAX_CANVAS_BACKING_WIDTH` clamp (§5.2) reduces width, collapse multiple
peak columns into each output x by taking the **max** over the collapsed group
(never the mean — preserve transients).

> **Addendum (shipped in `f3d429e`) — the shipped density inverts this
> assumption:** at the originally-planned 200/sec this paragraph's "~1
> column/pixel, so no down-sampling needed" held. At the shipped 10/sec
> (§4.2 addendum) the opposite is now the common case at max zoom: **fewer**
> peak columns than backing pixels, so `sampleColumnPeaks` is *spreading* a
> sparse `N` across the full backing width rather than collapsing a dense one
> — see the §5.3 addendum above. The `MAX_CANVAS_BACKING_WIDTH` collapse-by-max
> path described here still exists in the code for the (now rarer) case where
> a very long segment's `N` does exceed the clamped backing width, and it is
> still MAX-based, not mean-based, exactly as originally specified.

### 5.4 Fill / stroke / color spec (CapCut-like)

Match the existing accent color (`#F27D26`, used throughout the timeline) and
the current `/60` opacity feel:

```
// Filled body — vertical gradient for depth (CapCut look)
const grad = ctx.createLinearGradient(0, 0, 0, H)
grad.addColorStop(0.00, 'rgba(242,125,38,0.15)')   // faint at extremes
grad.addColorStop(0.50, 'rgba(242,125,38,0.75)')   // strongest at center line
grad.addColorStop(1.00, 'rgba(242,125,38,0.15)')
ctx.fillStyle = grad
// (fill the mirrored path from §5.3)

// Center line — thin, brighter (optional but matches CapCut)
ctx.strokeStyle = 'rgba(242,125,38,0.9)'
ctx.lineWidth = 1
ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke()
```

Background stays the lane's existing `bg-[#0A0A0A]` (the container div), so the
canvas itself is drawn with a **transparent** backing (do NOT fill a
background rect — let the lane show through, and let the active-segment
`bg-[#F27D26]/5` overlay at `Timeline.tsx:585-587` continue to work).

Clear before draw: `ctx.clearRect(0,0,canvas.width,canvas.height)` (in device
pixels, before the `ctx.scale`), so redraws don't ghost.

### 5.5 Empty / silent / missing-source states

- No `WaveformSource` yet (still decoding): render the canvas empty, or a
  centered hairline (matches today's `h-px` fallback at `Timeline.tsx:571`).
- Segment window is empty (`N <= 0`) or entirely silent: draw the center-line
  hairline only.

---

## 6. Redraw Triggers — Exhaustive Specification (highest-risk area)

> **Context / prior failure:** an earlier attempt this session accidentally
> wired redraws to scroll events (auto-scroll, persistence, zoom-center) and
> had to be fully reverted. The rules below are the guardrail. **The redraw
> effect's dependency array is the single source of truth for what triggers a
> redraw — everything hinges on it being exactly right.**

### 6.1 The complete allowed trigger set

A segment's canvas is redrawn **only** when:

1. **Initial draw** during the Apply-Sync loading phase (§6.3) — once, up
   front, for every segment.
2. **Reload draw** when peaks are rebuilt on app load (§4.3) — once per
   segment when the `WaveformSource` first becomes available.
3. **Resize-drag COMMIT** (mouseup / drag-end) — redraw of the **one**
   affected segment only, because its `duration` (and possibly `startTime` of
   following segments) changed, which changes `cssMaxWidthPx` and the peak
   window. **Never during the live drag** — the live drag only stretches the
   existing bitmap via the container's `style.width` write (§8), exactly as
   today.

That is the entire list.

### 6.2 The complete forbidden trigger set (must NEVER redraw)

- **Scroll** — manual, auto-scroll (`Timeline.tsx:197-222`), zoom-center
  (`Timeline.tsx:225-245`), persistence scroll restore
  (`Timeline.tsx:159-166`), or the debounced scroll persist
  (`Timeline.tsx:170-187`). The redraw effect must not depend on `scrollLeft`
  or any scroll state, and `SegmentWaveform` must not subscribe to scroll.
- **Playback / `currentTime` tick** — the ~16ms RAF playback loop. `currentTime`
  MUST NOT be in the redraw dependency array, and `SegmentWaveform` must not
  receive `currentTime` as a prop at all.
- **Zoom-level change** (`sliderT` / `pixelsPerSecond`). The canvas backing
  store is fixed at max-zoom detail; zoom only changes the container CSS width,
  which scales the bitmap via `width:100%`. `pixelsPerSecond` MUST NOT be in
  the redraw dependency array. (It may be passed to the component for
  unrelated reasons, but must not be a redraw dep — see §6.6.)
- **Window resize** — does not change any segment's `duration`, so no redraw.
  (If a future feature makes window resize change durations, that path would
  go through the normal `duration`-changed redraw; it does not today.)
- **Parent re-renders** from unrelated state (selection highlight, headings,
  etc.). `SegmentWaveform` should be wrapped in `React.memo` with a comparator
  that ignores everything except the redraw-relevant inputs (§6.4).

### 6.3 Redraw effect structure (`SegmentWaveform`)

```tsx
const canvasRef = useRef<HTMLCanvasElement>(null);

useEffect(() => {
  const canvas = canvasRef.current;
  if (!canvas || !source) return;              // no peaks yet → skip (draws on reload path when source arrives)
  drawSegmentWaveform(canvas, source, segment.startTime, segment.duration);
  // deps: ONLY the inputs that change the drawn bitmap.
}, [source, segment.id, segment.startTime, segment.duration]);
//     └ peaks + peaksPerSecond change on new project / reload rebuild
//                └ stable identity per segment
//                            └ window start (shifts on re-time)
//                                                 └ window length + canvas width at max zoom
```

**Explicitly excluded from this dependency array, and why:**

| Excluded | Why it must be excluded |
|---|---|
| `currentTime` | Ticks ~60×/s during playback → would redraw 294 canvases every frame. Not passed to component at all. |
| `pixelsPerSecond` / `sliderT` | Backing store is fixed at max detail; zoom scales via CSS. Including it re-introduces blur-vs-redraw coupling we are removing. |
| `scrollLeft` / any scroll state | The reverted bug. Canvas content is scroll-independent. |
| `isPlaying`, `currentSegmentId`, selection | Cosmetic highlight only; handled by sibling CSS overlay, not the canvas. |
| `resizingId` / live drag state | Live drag stretches CSS width, not the bitmap. Redraw happens on commit via a `duration` change (which IS a dep). |
| `assets`, `headings`, unrelated project fields | Irrelevant to the audio waveform. `React.memo` blocks these re-renders too. |

**Why `segment.duration` as a dep gives us "redraw on resize commit" for
free:** the live drag never calls `setProject` (it writes `style.width`
directly — `App.tsx:2516-2521`). Only `handleUp` → `applyDurationChange`
(`App.tsx:2594`) commits a new `duration` into state. That state commit is the
first and only time `segment.duration` changes, so the effect fires exactly
once, for exactly the segments whose duration changed (the dragged segment,
and any cascade-affected neighbors whose `startTime`/`duration` shifted). This
is precisely decision #3's "commit only, one redraw."

> **Verification hook:** during implementation, temporarily add a
> `console.count('waveform-draw:'+segment.id)` inside `drawSegmentWaveform` and
> confirm in the manual test matrix (§9) that scrolling, playing, and zooming
> produce **zero** increments, while an Apply Sync produces exactly N (one per
> segment) and a resize-commit produces exactly 1 (or 1 + cascade count).
> Remove before commit.

### 6.4 `React.memo` comparator

```tsx
export default React.memo(SegmentWaveform, (prev, next) =>
  prev.source === next.source &&                 // same peaks object identity
  prev.segment.id === next.segment.id &&
  prev.segment.startTime === next.segment.startTime &&
  prev.segment.duration === next.segment.duration
);
```

`source` must be a **stable object reference** — build the `WaveformSource`
once (in `App.tsx`) and memoize it (`useMemo` keyed on voiceover asset id +
peaks build). If you recreate it every render, every canvas redraws every
render. This is a load-bearing invariant.

### 6.5 Where the initial-draw gate lives (Apply Sync)

Hook point: `handleApplySyncFromFiles` (`src/App.tsx:1499-1652`). Current tail:

```ts
setIsSynced(true);       // line 1649
setIsProcessing(false);  // line 1650
setSyncStep(4);          // line 1651
```

**New flow** (replace the tail):

```ts
// ... after committedSegments computed and setProject(...) called ...

// (A) Show the loading screen (already visible via isProcessing/new flag; see §6.6)
// (B) Decode voiceover → peaks ONCE (new; see §4)
const source = voiceoverAsset
  ? await buildWaveformSource(voiceoverAsset)   // decode + peak-reduce
  : null;
setWaveformSource(source);                       // stable ref stored in App state

// (C) Wait for every segment's canvas to have drawn once.
await waitForAllWaveformsDrawn(committedSegments.length);   // §6.6

// (D) Only now reveal the editable project.
setIsSynced(true);
setIsProcessing(false);
setSyncStep(4);
setSyncLoading(false);   // dismiss loading screen
```

> **Ordering subtlety:** `setProject(...)` (segments) must happen before the
> canvases can mount and draw. React batches; the canvases mount on the next
> commit after `setProject`. So `waitForAllWaveformsDrawn` cannot simply
> `await` synchronously — it must resolve when the mounted canvases report
> completion. See §6.6 for the tracking mechanism.

### 6.6 Tracking "all images drawn"

Use an explicit **draw-completion registry**, not a fragile timer.

**Mechanism (counter + promise):**

1. `App.tsx` holds a `useRef` to a mutable registry:
   ```ts
   const waveformDrawRegistry = useRef<{
     expected: number;
     drawn: Set<string>;         // segment ids that finished drawing
     resolve: (() => void) | null;
   }>({ expected: 0, drawn: new Set(), resolve: null });
   ```
2. `waitForAllWaveformsDrawn(expected)` returns a promise:
   ```ts
   function waitForAllWaveformsDrawn(expected: number): Promise<void> {
     const reg = waveformDrawRegistry.current;
     reg.expected = expected;
     reg.drawn.clear();
     if (expected === 0) return Promise.resolve();
     return new Promise(res => { reg.resolve = res; });
   }
   ```
3. Each `SegmentWaveform`, at the END of its draw effect, calls a callback
   passed from `App` (through `Timeline`): `onDrawn(segment.id)`:
   ```ts
   const onDrawn = useCallback((id: string) => {
     const reg = waveformDrawRegistry.current;
     reg.drawn.add(id);
     if (reg.resolve && reg.drawn.size >= reg.expected) {
       reg.resolve();
       reg.resolve = null;
     }
   }, []);
   ```
4. `SegmentWaveform` calls `onDrawn(segment.id)` inside its draw effect,
   AFTER `drawSegmentWaveform` returns, but only during the initial batch.
   Simplest: always call `onDrawn` after every draw; the registry only cares
   during an active `waitForAllWaveformsDrawn` window (guarded by
   `reg.resolve !== null`).

**Robustness — never hang the loading screen:**
- Wrap the wait in `Promise.race([waitForAllWaveformsDrawn(n), timeout(8000)])`
  so a missed callback (e.g. a canvas that failed to draw) cannot trap the
  user on the loading screen forever. On timeout, proceed to reveal anyway and
  `console.warn` the count mismatch. This is a safety valve, not the normal
  path.
- If `source` is null (no voiceover), skip the waveform wait entirely — reveal
  immediately after segment generation. A project can be synced with no
  voiceover; do not block on a waveform that will never exist.

**Why a counter, not `Promise.all` of per-canvas promises:** the canvases are
created by React on the commit after `setProject`, so their promises don't
exist at the time `handleApplySyncFromFiles` calls the wait. A registry the
mounting canvases report into decouples "start waiting" from "canvases exist."

### 6.7 Draw batching to keep the loading screen animating

Drawing 294 canvases synchronously in one microtask will jank the spinner.
Draw work is already naturally spread because each canvas draws in its own
mount effect across React commits, but to be safe:

- Let the canvases mount and draw normally (React will commit them; effects
  run per commit). The spinner animates via CSS, unaffected by JS-thread draw
  bursts as long as each individual draw is short (one segment ≈ a few hundred
  path ops — sub-millisecond).
- If profiling shows jank, chunk the reveal: mount the audio lane's canvases
  in slices via an incrementing "drawUpTo" index advanced on
  `requestAnimationFrame`. Treat this as an optimization to add only if needed
  (§10), not a day-one requirement.

---

## 7. Memory / Performance Estimate

**Reference: 294 segments, 21 min (1260 s), lane height 80px, DPR cap 2×.**

### Backing-store memory (the bounded resource)

Total backing pixels across all canvases:

```
Σ (segment.duration * WAVEFORM_MAX_PPS * dpr) * (laneHeight * dpr)  over all segments
= (Σ duration) * WAVEFORM_MAX_PPS * dpr * laneHeight * dpr
= 1260 s * 100 px/s * 2 * 80 px * 2
= 1260 * 100 * 80 * 4
= 4,032,000,000  px ... wait — recompute carefully:
```

Careful recomputation (total backing area = total-CSS-width × dpr × height ×
dpr):

```
total CSS width at max zoom = 1260 s * 100 px/s          = 126,000 px
total backing width         = 126,000 * dpr(2)           = 252,000 px
backing height              = 80 * dpr(2)                = 160 px
total backing pixels        = 252,000 * 160              = 40,320,000 px
bytes at 4 bytes/px (RGBA)  = 40,320,000 * 4             ≈ 161 MB
```

**≈ 161 MB of canvas backing store** for the whole 21-min project at the 2×
cap. Without the cap, a 3× screen would be `126000*3 * 240 * 4 ≈ 363 MB` —
the cap roughly halves worst-case memory, which is the point of decision #4.

**Canvas count: 294 canvases.** This is the flagged risk (see below).

**Per-segment average:** 4.3 s → backing ~`430*2 × 160 = 860×160 px ≈ 0.55 MB`
each; ×294 ≈ 161 MB (consistent).

### Risk flagged in the prior audit: WebKit accelerated-canvas-count pressure

WebKit (Tauri's WKWebView on macOS) hardware-accelerates canvases and has an
internal ceiling on the number of accelerated canvas backing stores; beyond
it, canvases fall back to software or (worst case) stop compositing, causing
blank/black canvases or severe scroll jank. **294 simultaneous live canvases
is well into the range where this can bite.** Static analysis cannot tell us
the exact threshold — it varies by WebKit version and GPU.

**Mitigations (in priority order — implement #1, keep #2/#3 as fallbacks):**

1. **`ImageBitmap` / detached-canvas approach (preferred if needed):** draw
   each segment's waveform into an `OffscreenCanvas` (or a transient
   `<canvas>`), convert to an `ImageBitmap` (or a `blob:`/`data:` URL via
   `convertToBlob`), and render it as a plain `<img>` or a CSS
   `background-image` in the lane. Images are cheap, non-accelerated, and have
   no per-element canvas-count pressure — the 294-canvas ceiling disappears
   because there are **zero** live canvases after draw. The draw-once model
   makes this clean: we never need to redraw except on resize-commit, at which
   point we regenerate that one image. **This is the recommended default if
   the plain-canvas approach shows any WebKit canvas-count symptom in
   testing.** Backing memory is similar, but as decoded image data the
   compositor manages it far better than 294 live GPU canvases.
2. **Virtualize canvases to the viewport:** only mount canvases for segments
   currently within (or near) the horizontal scroll viewport; unmount
   off-screen ones. This reintroduces scroll-coupling **for mount/unmount
   only, never for redraw** — a mounted off-screen→on-screen canvas draws once
   from the already-computed peaks (fast) and does not re-decode. This is more
   complex and risks violating the "scroll never triggers redraw" spirit, so
   prefer #1.
3. **Accept the risk** and ship 294 live canvases, contingent on the Tauri
   smoke test (§9/§10) showing no blanking/jank on the reference project on
   target hardware.

> **Decision for the builder:** start with the simplest correct thing —
> **plain per-segment `<canvas>`** (§5) — and run the Tauri 294-segment smoke
> test early. If it blanks or janks, switch to **mitigation #1 (ImageBitmap/
> `<img>`)**, which requires no change to the peaks pipeline or redraw-trigger
> logic (the `<img>` src is just regenerated on the same triggers). Budget for
> #1; treat plain-canvas as the optimistic path.

### CPU / decode cost

- One `decodeAudioData` over 21 min of audio: seconds of work, one-time,
  happens on the loading screen (acceptable — the screen exists precisely to
  cover it).
- Peak reduction: single linear pass over PCM (~`1260 * 48000 ≈ 60M` samples),
  a few hundred ms. On the loading screen. Fine.
- 294 draws × ~a few hundred path ops: a few ms total. Fine.

---

## 8. Interaction-Preservation Checklist (mapped to prior audit)

| Prior-audit finding | Requirement | How this plan satisfies it |
|---|---|---|
| Audio-lane container carries `data-seg-id` (`Timeline.tsx:557`) | Must remain, unchanged | §5.1 keeps the exact container; `SegmentWaveform` is a child of it. `data-seg-id` stays on the container div. |
| Container is width-driven `width: s.duration*pps` (`Timeline.tsx:558`) | Must remain, unchanged | §5.1 keeps the width style on the container. Canvas is `width:100%` inside it. |
| Resize-drag dual-write `querySelectorAll('[data-seg-id]')` → `style.width` (`App.tsx:2474-2521`) | Must keep working during LIVE drag with no redraw | The live drag writes the container's `style.width`; the child canvas (`width:100%`) stretches with it visually. No redraw fires because no `duration` state change happens mid-drag. §6.2/§6.3. |
| Resize-drag commit → one redraw (decision #3/#6) | Exactly one redraw of affected segment on mouseup | `applyDurationChange` (`App.tsx:2594`) is the only `duration` state change; the redraw effect deps include `segment.duration`, firing once per affected segment. §6.3. |
| No click-to-seek/hover/tooltip on bars (audit: none exists) | Do not add any | §1 non-goals; `SegmentWaveform` renders a canvas with `pointer-events:none` so it never intercepts the container's resize-handle mousedown or the row's seek. |
| Active-segment highlight overlay (`Timeline.tsx:585-587`) | Preserve | Left as a sibling `<div>` over the canvas; unaffected. |

> **Critical:** set `pointer-events: none` on the canvas so the resize handles
> (`Timeline.tsx:561-564`, `z-20`) and any row-level interactions keep
> receiving events exactly as today.

---

## 9. Manual Test Checklist (run before commit)

Run in the **Tauri app** (not just `vite` dev in a browser — WebKit
canvas-count behavior only reproduces in WKWebView):

**Waveform correctness**
1. Sync a short project (fits at 100 px/s, slider pinned): waveform fills each
   segment, mirrored curve, transients visible (peaks, not flattened).
2. Sync the 294-segment/21-min reference project: every segment has a
   waveform; scroll end-to-end — no blank canvases, no jank.
3. Zoom slider from min→max: waveform image scales, does not re-decode, does
   not flicker. (Originally written as "stays sharp at max zoom, no blur" —
   with the shipped 10/sec peak density, §4.2's addendum, the curve is
   deliberately coarser at high zoom by design, not per-pixel sharp. Check
   for correct scaling/no-redraw behavior, not pixel sharpness.)

**Redraw-trigger discipline** (temporarily instrument with the
`console.count` from §6.3):
4. Play through the whole timeline: **zero** waveform draws logged.
5. Scroll manually + trigger auto-scroll (click a far segment): **zero** draws.
6. Change zoom repeatedly: **zero** draws.
7. Resize window: **zero** draws.
8. Resize-drag a segment's edge: during the drag, container stretches, **zero**
   draws; on release, **exactly one** draw for the dragged segment (plus one
   per cascade-affected neighbor whose duration changed) — no more.

**Loading experience**
9. Click Apply Sync on a fresh project: loading screen appears immediately,
   spinner animates, status text rotates (§ below), timeline is NOT visible
   until all waveforms drawn; then reveals with waveforms already present (no
   pop-in).
10. Apply Sync with **no voiceover**: reveals promptly, no waveform, no hang.
11. Reload the app with a persisted synced project: timeline appears; audio
    lane shows a brief "loading waveform" state, then canvases fill in; no full
    Apply-Sync screen.
12. Simulate a slow/failed decode (throw in `buildWaveformSource`): loading
    screen does not hang past the 8s safety timeout; reveals with a hairline
    fallback; `console.warn` logged.

**Interaction preservation**
13. Resize handles still grabbable (canvas `pointer-events:none`).
14. Clicking a segment still seeks; the D12 ghost-click swallow still works
    after a left-edge drag.

**Transcription phase**
15. Stage a 20-min voiceover: existing `TranscriptionBar` shows
    "Transcribing… %"; Apply Sync stays disabled until done (unchanged — §6.4
    below / §6 of this doc; verify no regression).

---

## 10. Loading / Sync UI Design

### 10.1 Two distinct pre-ready phases (do not conflate)

1. **Transcription phase (already exists — verify, do not rebuild).**
   When a voiceover is staged, `useWhisper` transcribes it (1–2 min for
   20-min audio). Progress is shown by `TranscriptionBar`
   (`src/components/TranscriptionBar.tsx`, rendered at `App.tsx:2284-2292`)
   with a live percent bar and Cancel. Apply Sync is **disabled** until
   transcription reaches `done` (`applySyncDisabled`, `App.tsx:1928`;
   `transcriptionReady`, `App.tsx:1915-1917`). **This satisfies decision #5's
   transcription-phase requirement — it already exists. Do NOT build a new
   one; just confirm it still renders after the waveform changes** (nothing in
   this plan touches it). Cite it in the PR description so reviewers know it
   was verified, not missed.

2. **Apply-Sync phase (NEW — build this).** Between the Apply Sync click and
   the editable timeline appearing. Today: black screen, no feedback
   (`handleApplySyncFromFiles` sets only `isProcessing`, which drives no
   full-screen UI). New: a full-screen loading overlay (§10.2) that stays up
   until BOTH segment generation AND all-waveforms-drawn complete (§6.5/§6.6).

### 10.2 New Apply-Sync loading overlay component

New component `src/components/SyncLoadingOverlay.tsx` (model it on the existing
`ModalLoadingFallback`, `App.tsx:496-501`, which already provides the spinner
markup and the `fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm` shell):

- Full-screen, `z-[150]`, dark backdrop (reuse the existing spinner:
  `border-t-[#F27D26] animate-spin`).
- Spinner + a status line + a subtle secondary progress hint.
- **Rotating / stage-based status messages.** Use stage-based (tied to real
  progress) where possible, falling back to a timed rotation for the
  indeterminate stretches:
  - Stage 1 (parse/align, `handleApplySyncFromFiles` steps 1–7):
    **"Syncing your project…"**
  - Stage 2 (decoding audio, `buildWaveformSource`): **"Reading your
    voiceover…"**
  - Stage 3 (drawing waveforms, waiting on the registry): **"Drawing the
    timeline…"** with an optional `drawn/expected` count
    (`"Drawing the timeline… 128 / 294"`) sourced from the draw registry
    (§6.6) for real determinate progress.
  - Optional flavor rotation while indeterminate (2.5 s each):
    "Placing your scenes…", "Matching your assets…", "Almost there…".
- Drive it from a new state flag `syncLoading` (or reuse `isProcessing` if it
  is not read elsewhere for a different purpose — verify; `isProcessing` is
  also set by the zip-extraction path (`processZipFile`, `App.tsx:1737`), so
  **add a dedicated `syncLoading` flag** to avoid coupling). Set `syncLoading=true` at the top of
  `handleApplySyncFromFiles`, `false` in the reveal step (§6.5) and in every
  early-return abort path (`App.tsx:1579-1581`, `1590-1592`) — audit all
  returns so the overlay can never get stuck.

### 10.3 Gating logic (the transition to "ready")

```
click Apply Sync
  → syncLoading = true                       // overlay up
  → [existing] parse/persist/align → setProject(committedSegments)
  → source = await buildWaveformSource(...)   // stage 2 message
  → await Promise.race([                      // stage 3 message
        waitForAllWaveformsDrawn(committedSegments.length),
        timeout(8000)                         // safety valve (§6.6)
     ])
  → setIsSynced(true); setSyncStep(4)
  → syncLoading = false                       // overlay down → editable timeline visible
```

Reveal happens **only** after both segment generation and all-waveforms-drawn
(or the safety timeout) resolve — exactly decision #5.

### 10.4 Reload-phase inline waveform loading (not the full overlay)

On reload of a persisted synced project (§4.3), the project is already
editable; do **not** show the full overlay. Instead, while
`buildWaveformSource` runs in the mount effect, `SegmentWaveform` renders its
hairline fallback (§5.5). When `source` arrives (stable ref), all canvases
draw once via the normal effect. No blocking, no overlay.

---

## 11. Rollback / Safety Plan

- **Incremental, independently-verifiable steps:**
  1. Add `src/services/waveformPeaks.ts` (pure functions:
     `buildWaveformSource`, `drawSegmentWaveform`, constants). Unit-testable
     with a synthetic `Float32Array`; no UI wired yet.
  2. Add `src/components/SegmentWaveform.tsx` rendering a canvas from a
     `WaveformSource` prop; wire it into `Timeline.tsx` **behind the existing
     `waveformBars` path** first (render both, compare visually), then delete
     the DOM-bar IIFE.
  3. Move the decode from `Timeline.tsx` into `App.tsx` (Apply-Sync flow +
     reload effect); pass `WaveformSource` down.
  4. Add the draw registry + `waitForAllWaveformsDrawn` gating.
  5. Add `SyncLoadingOverlay` + `syncLoading` flag.
  6. Remove `waveformBars` state and the old decode effect
     (`Timeline.tsx:113,117-149,566-583`).
- **Rollback:** each step is a separate commit; reverting the branch restores
  the 300-bar path. The old code is deleted only in the final step, so a
  partial rollback still leaves a working (old) waveform.
- **Guard rails to keep in code:** the dev `console.assert(WAVEFORM_MAX_PPS ===
  ppsMax)` (§4.2) and — during bring-up only — the `console.count` draw
  instrumentation (§6.3), removed before the final commit.
- **Definition of done:** all §9 checks pass in the Tauri app on the
  294-segment reference project, with the redraw-discipline checks (4–8)
  showing zero unexpected draws.

---

## 12. Open Risks / Assumptions To Validate During Implementation

1. **WebKit accelerated-canvas count (§7).** The 294-live-canvas ceiling can
   only be confirmed by running the reference project in the actual Tauri
   WKWebView on target hardware. **Assumption:** plain canvases may blank/jank
   → **mitigation budgeted:** switch to ImageBitmap/`<img>` (§7 mitigation #1),
   which needs no pipeline change. Validate early, before building the loading
   UI, so the memory model is settled.
2. **`segment.startTime` accuracy for peak-window mapping (§4.2).** Assumes
   `startTime` is always the cumulative timeline start after any timing pass.
   Confirmed true in current code; re-verify after any change to
   `applyAnchorBasedTiming` isn't in scope but the assumption should be spot-
   checked (segment 0 starts at 0, last segment ends at `audioDuration`).
3. **Canvas max-dimension clamp (§5.2).** `MAX_CANVAS_BACKING_WIDTH = 8192` is
   a conservative guess for WebKit; validate the real single-canvas limit on
   target hardware. Long single segments (>40 s) are the only ones that
   approach it.
4. **Draw-registry timing (§6.6).** Assumes each canvas's draw effect runs and
   calls `onDrawn` on the commit after `setProject`. The 8s `Promise.race`
   safety valve covers a missed callback, but validate the happy path resolves
   promptly (should be well under 1s for 294 short draws).
5. **Smoothing choice (§5.3) — RESOLVED.** Approach (A) straight `lineTo`
   shipped (confirmed in `waveformPeaks.ts`'s `drawSegmentWaveform`) — not at
   the originally-assumed 200 cols/s, but at the shipped **10/sec** density
   (§4.2 addendum), which is now typically *sparser* than the backing-pixel
   width rather than roughly 1:1 with it. The curve is visibly coarser at
   high zoom as a result; accepted as-is, no escalation to quadratic (B) was
   needed.
6. **DPR cap interaction with `PEAKS_PER_SECOND` (§4.2/§5.2) — RESOLVED,
   outcome differs from the original assumption.** This risk originally
   assumed peaks density (200/s) was derived as `ppsMax * DPR_CAP`,
   guaranteeing ≥1 peak column per backing pixel at max zoom for dpr ≤ 2.
   Shipped outcome (`f3d429e`): `PEAKS_PER_SECOND` was retuned to **10/sec**
   and deliberately decoupled from `WAVEFORM_MAX_PPS * WAVEFORM_DPR_CAP` (see
   §4.2's addendum) — the ≥1-peak-per-backing-pixel guarantee this risk
   worried about does **not** hold today, by design. Waveforms are visibly
   coarser at high timeline zoom; this is an accepted permanent trade-off, not
   something to re-verify per-arithmetic, since it's no longer meant to hold.
7. **`isProcessing` reuse (§10.2).** `isProcessing` is also set by the
   zip-extraction flow (`processZipFile`, `App.tsx:1737`); a dedicated
   `syncLoading` flag avoids the coupling. Verify `isProcessing` has no other
   full-screen consumer before finalizing.
```

