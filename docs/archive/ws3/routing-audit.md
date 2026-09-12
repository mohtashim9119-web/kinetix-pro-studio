# WS3 — Export routing audit (fast path, cursor reopen, demux release)

**Branch:** `ws3-export-liveness-occlusion` @ `a92a855`  
**Compared to:** `main` @ `4d4922c`  
**Date:** 2026-09-09  
**Method:** static analysis only. No live export. Export sources read, not edited.

> There is no function named `segmentTier`. Per-segment routing is
> `computeIndividualTier` (`exportPipelineWebCodecs.ts:229`). `routeSegments`
> (`:333`) is the orchestrator.

---

## Verdict (one screen)

| Question | Answer |
|---|---|
| Fast path this round? | **PATH INTACT.** `plainSegment.ts` and `glCompositable.ts` are byte-identical to `main`. `computeIndividualTier` / `routeSegments` / `groupConnectedComponents` are the same predicates. |
| Why "Encoding segment 1 / 1"? | That string is **piece count**, not segment count and not a tier name. Consecutive GL segments collapse to one piece. A true Tier 1 timeline of N segments would read `1 / N`. |
| If a no-effects project still went GL | Pre-existing `isPlain` failure, not a this-round routing change. Most likely predicate: `segment.overlayFilter` is the **string `'none'`** (`plainSegment.ts:111`) — truthy, so Tier 1 rejects; GL treats `'none'` as unset (`glCompositable.ts:154-157`). |
| Cursor opens (332 segs / 4 assets) | **332 times — once per segment**, not once per asset. Peak live cursors stay ≤ 2. |
| Demux re-parse? | **Not inside one GL piece** (release uses max last-needed over the piece). **Yes across GL pieces** (each piece is a new Worker; cache dies). Measured per-asset `parseMs` from Round 2 was **not archived in docs**. |

---

## Part 1 — Did the fast path break?

### 1a. Citations and every routing condition

**`computeIndividualTier`** — `src/services/webcodecsExport/exportPipelineWebCodecs.ts:229-241`

```
isPlain?
  video  → isPlainVideoSegment(...)
  image  → isPlainImageSegment(...)
  if yes → 'plain'          (Tier 1)
  else   → isGlCompositableSegment(...) ? 'gl' : 'canvas'
```

**`routeSegments`** — same file `:333-345`  
Computes individual tiers, then `groupConnectedComponents` (`:299-326`).

**`groupConnectedComponents`** does not invent a tier. It only unions adjacent segments joined by a **real-duration GL-slug transition**. If any member of that component is not individually `'gl'`, the **whole component becomes `'canvas'`**. A `'plain'` segment is never unioned (Tier 1 already requires duration-0 on both edges). Zero-duration edges are hard cuts; each side keeps its own tier.

Then **`buildPiecePlans`** (`:530-560`) groups consecutive `'gl'` tiers into one run (even across hard cuts), then may split that run at `MAX_ENCODER_SESSION_FRAMES` (1800) **only at hard cuts**. `'plain'` and `'canvas'` pieces are always exactly one segment.

#### Tier 1 (`'plain'`) — all of `isPlainMediaSegment` must pass

`src/services/plainSegment.ts:67-154` (shared by `isPlainVideoSegment:24` / `isPlainImageSegment:52`):

| # | Condition (fail → not Tier 1) | Lines |
|---|---|---|
| 1 | A heading intersects the segment's `[start, start+duration)` | `:80-83` |
| 2 | No usable asset of the required type (`video` / `image`) with a URL | `:86-89` |
| 3 | Caption on: `showOverlay && text` (non-empty) | `:91-92` |
| 4 | Any `extraOverlays` | `:95` |
| 5 | A global `textLayers` entry visible on this segment | `:100-103` |
| 6 | `animation !== AnimationType.NONE` | `:107` |
| 7 | `effectAnimation` set and not `'none'` | `:108` |
| 8 | `segment.overlayFilter` **truthy** (includes the string `'none'`) | `:111` |
| 9 | `project.globalOverlayFilter` **truthy** (includes `'none'`) | `:112` |
| 10 | Incoming or outgoing resolved transition duration ≠ 0 | `:117-131` |
| 11 | Freeze-last-frame: `asset.duration - trimStart < segment.duration` | `:146-152` |

Tier 1 encode is **not** a bitstream copy. `encodePlainVideoSegment` (`segmentEncoder.ts:396-447`) is `ffmpeg -ss … -t … -vf scale+crop -c:v libx264 -preset fast -crf 16`. Fast relative to GL/canvas; still a re-encode.

#### GL (`'gl'`) — all of `isGlCompositableSegment` must pass, and `isPlain` must have failed

`src/services/webcodecsExport/glCompositable.ts:215-228`:

| # | Condition (fail → not GL) | Lines |
|---|---|---|
| 1 | Renderable video/image asset with URL | `:220` / `hasGlRenderableAsset:200-203` |
| 2 | Animation is zoom-in / zoom-out / none (clip-effect slugs and ken-burns fail) | `:221` / `isGlCompatibleAnimationSlug:124-137` |
| 3 | Color filter unset **or the literal `'none'`** on segment and project | `:222` / `hasNoColorFilter:154-157` |
| 4 | Outgoing edge: duration 0, or a GL slug | `:224` / `isGlCompatibleTransitionEdge:178-191` |
| 5 | Incoming edge: same | `:226` |

**Text is not checked.** Captions, extra overlays, global text layers, and headings do **not** disqualify GL. That is deliberate (`glCompositable.ts:41-44`) and is the documented minimum change that knocks a still out of Tier 1 onto GL (`planWebCodecsExport.test.ts:57-76`; `generateGlWatchdogFixture.ts:4-8`).

#### Tier C (`'canvas'`)

Anything that fails both `isPlain*` and `isGlCompositableSegment`: missing/non-media asset, ken-burns / clip-effect animation, a real (non-`'none'`) CSS filter, a real-duration **legacy** transition on either edge, plus the connected-component downgrade when a GL-slug transition shares a component with a non-GL member (`exportPipelineWebCodecs.ts:323-325`).

### 1b. Zero transitions, zero animations, captions off

Assume those three are true **in the fields the predicates actually read**:

- per-segment `animation === NONE`, `effectAnimation` unset or `'none'`
- resolved transition duration 0 on every edge (`transition`/`effectTransition` duration 0, or `TransitionType.NONE`)
- captions off = `!(showOverlay && text)` — empty text or `showOverlay === false`

Then **each segment is Tier 1 (`'plain'`)** if and only if the remaining `isPlainMediaSegment` gates also pass (asset present, no extra overlays, no visible `textLayers`, no intersecting heading, `overlayFilter` / `globalOverlayFilter` **unset — not the string `'none'`**, clip long enough to cover the segment).

`groupConnectedComponents` does not union anyone (no duration > 0). `buildPiecePlans` emits **one `'plain'` piece per segment**. Progress would read `Encoding segment 1 / N`.

**If the field project still landed on GL**, one of those remaining gates failed `isPlain` while still passing `isGlCompositableSegment`. Ranked:

1. **`overlayFilter === 'none'` or `globalOverlayFilter === 'none'`** — `plainSegment.ts:111-112`. The Effects tab **writes this string on purpose** when applying an overlay or a style preset (`App.tsx:2885`, `:2926`) to clear the legacy twin. GL's `hasNoColorFilter` treats `'none'` as unset (`glCompositable.ts:154-157`, tests at `glCompositable.test.ts:158-167`). A "no filter" project that once touched Effects is then: `isPlain === false`, `isGlCompositable === true` → **GL**. This is the exact predicate that sends a visually no-effects timeline to GL.
2. **Caption leftover:** `showOverlay && text` (`plainSegment.ts:91-92`) while the operator believes captions are off (per-segment toggle vs Project Settings bulk write). Same documented GL force as Round 2's fixture.
3. **Freeze-last-frame** (`plainSegment.ts:146-152`) if a short clip is stretched past `asset.duration - trimStart`.
4. **Visible `textLayers` or intersecting `headings`** (`plainSegment.ts:80-83`, `:100-103`) — both fail plain, neither is checked by GL.

`project.globalAnimation` is **not read** by either predicate. Clearing the global animation control does not, by itself, change the tier.

### 1c. Diff against `main` `4d4922c`

```
git diff 4d4922c a92a855 -- src/services/plainSegment.ts src/services/webcodecsExport/glCompositable.ts
```

Empty. Both files are byte-identical.

`computeIndividualTier` on `main` (`exportPipelineWebCodecs.ts:206-218` at `4d4922c`) and on this branch (`:229-241` at `a92a855`) is the same function; line numbers shifted because this round added liveness / piece-split / session-plan code **above** it, not inside it:

```ts
function computeIndividualTier(...): Tier {
  const asset = segment.assetId ? assetMap.get(segment.assetId) : undefined;
  const isPlain =
    (!!asset && asset.type === 'video' && isPlainVideoSegment(segment, prev, next, project)) ||
    (!!asset && asset.type === 'image' && isPlainImageSegment(segment, prev, next, project));
  if (isPlain) return 'plain';
  return isGlCompositableSegment(segment, project, { prev, next }) ? 'gl' : 'canvas';
}
```

What **did** change this round around routing's *output*, not its predicates:

- `buildPiecePlans` now splits a GL **run** at 1800 frames on hard cuts (`planGlRunPieceStarts`, `:492-527`). That changes piece count, not which tier a segment received.
- Progress `total` is `pieces.length` (`:1721-1723`). Encoder-session suffix only appears when `encoderSessions > 1` (`useExport.ts:246-253`).

Nothing in `4d4922c..a92a855` changed what counts as compositable.

### 1d. PATH INTACT or PATH REGRESSED

**PATH INTACT.**

Evidence: empty predicate diff vs `main`; identical `computeIndividualTier`. A project that satisfies every `isPlainMediaSegment` gate still goes Tier 1 on this branch.

The field UI **does not prove a routing regression.** `Encoding segment 1 / 1` is `pieceIndex+1 / pieces.length`. Consecutive GL segments are one piece (`:532-535`). A 1-segment Tier 1 export prints the same string. A multi-segment no-transition export that truly took Tier 1 would print `1 / N`. Seeing `1 / 1` on N>1 is evidence they **already failed `isPlain`**, coalesced as GL — via a predicate that existed on `main` — most likely `overlayFilter`/`globalOverlayFilter` truthiness of `'none'` (`plainSegment.ts:111-112`).

On this branch a *long* no-transition GL timeline would then be split at 1800 frames (`planGlRunPieceStarts`), so a 200s/30fps job would read `1 / 4`, not `1 / 1`. `1 / 1` on a no-transition project therefore also implies **≤1800 frames in that GL run** (~60s at 30fps), or a single segment.

---

## Part 2 — Cursor reopen churn (Round 6 release fix)

### 2a. Close and reopen sites

| Event | Where |
|---|---|
| Open | `exportWorker.ts:383-404` `openCursor` — starts `decodeSegmentFrames` for **that segment's** `[sourceRange.start, end)` |
| First touch | `exportWorker.ts:598-603` `resolveSlotSource` — `cursors.get(seg.id)`; miss → `openCursor` + `cursors.open(seg.id, …)` |
| Close (stale) | `decodeCursorLifetime.ts:141-159` `DecodeCursorRegistry.releaseStale` → `closeCursor` |
| Close impl | `exportWorker.ts:453-462` `closeCursor` — closes frames, `gen.return()` (decoder teardown) |
| When stale | `shouldReleaseDecodeCursor` `:99-105` = `currentTime >= cursorLastNeededSec` (`:53-65`) = segment end, or end + D/2 if an outgoing centered GL transition |
| Called | every frame, `exportWorker.ts:999` `releaseStaleCursors` after encode |
| End of run | `disposeAll` `:162-166` / `exportWorker.ts` `RunState.disposeAll` |

Keyed by **segment id**, not asset id (`decodeCursorLifetime.ts:4-5`; `exportWorker.ts:598-603`). `MAX_SIMULTANEOUS_OPEN_DECODE_CURSORS = 2` (`decodeCursorLifetime.ts:21`).

### 2b. 332 segments cycling 4 assets — how many opens?

**332 opens. Once per segment.**

`DecodeCursorRegistry.open` increments `cursorsCreated` on every `open(id)` (`:118-122`). The synthetic 8-segment probe asserts `cursorsCreated === 8` (`decodeCursorLifetime.test.ts:99-102`). Round 6 / silent-gaps writeup: "even a segment reusing an already-demuxed asset still gets its own" decoder (`docs/ws3-silent-gaps-diagnosis.md`, cursors keyed by segment id). Peak live cursors stay 1 (hard cut) or 2 (live transition), not 332.

Cycling A,B,C,D,… does not reuse a cursor: the previous A cursor was already `closeCursor`'d when that segment's `cursorLastNeededSec` passed.

### 2c. Wasted decode per reopen

`decodeSegmentFrames` (`sequentialDecode.ts:117-144`) always:

1. `findChunkRange` backs `startIndex` to the last **keyframe at or before** `startSec` (`sequentialDecode.ts:139-144`; `videoDecoderPool.ts:260-288`).
2. Configures a **new** `VideoDecoder` (`sequentialDecode.ts:180-207`).
3. Decodes that preroll; frames with `timestamp < startSec` are closed unshown (`sequentialDecode.ts:188-193`).

This repo treats a GOP as **2 seconds / `2 * fps` frames** on the *output* encoder (`exportWorker.ts:568-570` `gopFrames`) and in decoder-pool fixtures (60 frames @ 30fps). Source GOP is asset-dependent; 2s is the working typical.

Per reopen, discarded preroll is **0 … one source GOP**. Uniform trim points → ~**0.5–1.0 GOP** average ≈ **15–60 frames @ 30fps** (≈ 0.5–2.0s of decode thrown away), plus one `configure()`.

Across 332 segments, same 4 files:

- Discarded preroll: **~5k–20k extra decoded frames** (332 × 15–60).
- Useful timeline frames (e.g. 200s @ 30fps): 6000. Preroll can **match or exceed** useful decode when segments are short (Part C-style 0.4s slices: 12 useful frames vs ~30 preroll).
- `VideoDecoder.configure` + teardown: **332 vs 4**.

A cursor kept per asset, advanced forward, would pay preroll **once per asset** (4 times), not 332.

### 2d. Memory vs throughput

**Yes. Round 6 traded an unbounded cursor leak (peak ~155, death ~62s wall) for a hard per-segment close that bounds peak at 2 and re-seeks every segment.**

Smallest change that keeps peak bounded without re-seeking per segment:

**Do not close a cursor when the segment ends if another later segment in this run shares the same `assetId` and its `sourceRange.start` is ≥ the cursor's current source time.** Release when `assetLastNeededSecByAsset` says the *asset* is done (`decodeCursorLifetime.ts:85-97`) — that map already exists for demux. Peak then equals **distinct in-flight assets**, which `deriveSlotPlan` already caps at 2 simultaneous slots; for a 4-asset cycle with hard cuts only one asset is needed at a time, so peak stays 1 unless a transition overlaps two assets.

A small LRU (size 4, keyed by `assetId`) is the same idea if trims on revisit are not forward-monotonic: eviction still re-seeks, but 4 warm decoders beat 332. Do **not** keep one `decodeSegmentFrames(start,end)` generator per segment and "not close it" — that generator is range-bounded (`openCursor` `:390`) and cannot serve the next trim window. The keep-alive object has to be a per-asset decoder that can continue or re-range, not the current per-segment generator.

---

## Part 3 — Demux release churn (Defect 6)

### How many fetch+parse cycles for 332 segments / 4 assets?

`getOrCreateDemux` caches by **URL** (`videoDemuxer.ts:166-178`). First call per URL in a given Worker: `fetch` + mp4box parse (`demux:79-144`, `fetchMs`/`parseMs`). Later calls in that Worker: cache hit, `onDemuxTiming` reports 0 (`sequentialDecode.ts:124-136`).

`releaseDemux` (`videoDemuxer.ts:206-208`) deletes that URL. Next `getOrCreateDemux` **re-fetches and re-parses** (`:202-204`: "not poisoned").

Inside **one** `RunState` / one GL piece:

`assetLastNeededSecByAsset` (`decodeCursorLifetime.ts:85-97`) stores the **max** `cursorLastNeededSec` over every segment that references the asset. `releaseStaleAssets` (`exportWorker.ts:557-565`) only fires after that max. For A,B,C,D cycling through the piece, each asset's last use is near the end of the piece → **4 fetch+parse cycles, no mid-piece re-parse.** The Round 4 writeup already stated this as the design (`docs/ws3-round4-static-fixes.md` Defect 6; "revisit is never a reopen", `decodeCursorLifetime.ts:77-79`).

**Across GL pieces: re-parse happens.** `driveGlRun` constructs a **new Worker per piece and `terminate()`s it** (`exportPipelineWebCodecs.ts:427` comment, `:832-835`, `:1022`). Module `demuxCache` dies with the Worker. A no-transition GL timeline **can** split at 1800 frames (`planGlRunPieceStarts:492-527`, every boundary is a legal hard cut). A 6000-frame job → ~4 pieces → **~16 fetch+parse cycles** if each piece still touches all 4 URLs. Encoder-session rotation inside one piece does **not** rebuild the Worker (`encoderSessionPlan.ts` header: same demux cache across sessions) — no extra parse there.

### Can an asset be released and then needed again?

| Scope | Re-parse? |
|---|---|
| Same piece, cycling 4 assets | **No** — max last-needed holds the cache until the last use |
| Next GL piece (new Worker) | **Yes** — cache is gone; full fetch+parse again |
| Eager `releaseDemux` before a later use in the same piece | **Would** re-parse; current max-last-needed rule is what prevents it |
| Preview vs export | Separate Maps (worker vs main). Export release cannot evict preview |

### Measured parse cost from earlier rounds

**Not archived.** Round 2's tick probe (`src/dev/exportLivenessProbe/runTickProbe.ts:9-13, 59-62`) records `fetchMs`/`parseMs` for three fixtures (≈0.95 / 3.67 / 10.13 MB) and writes them to localStorage / `__ws3-liveness` jsonl. Those wall times were never copied into `docs/`. What the docs *do* record: for the 4-asset Part C fixture, `demuxCacheSize` cannot exceed 4 **inside one Worker** (`docs/ws3-silent-gaps-diagnosis.md` Part 3c); RSS growth was modest (~18 MB / 320s) when demuxers were **not** released. Defect 6's own comment treats a mistaken release as "a re-fetch/re-parse, never a failure" (`videoDemuxer.ts:202-204`).

**Fix if a re-parse is observed mid-piece:** stop calling `releaseDemux` until the asset's max last-needed (already the rule) — or drop per-piece Workers and keep one Worker for the whole GL run (session rotate already exists for encoder state). If the cost is piece-boundary re-parse, pass parsed `DemuxedVideo` in (not viable: structured clone of chunk arrays) or **reuse one Worker across pieces of the same run**, clearing only encoder state.

---

## Part 4 — Ranked 5×-slowdown candidates

Ordered by how much wall-clock they can add on a no-effects / 332×4 job. No code.

1. **Wrong tier: whole timeline GL instead of Tier 1** — `plainSegment.ts:111-112` (`overlayFilter` / `globalOverlayFilter` truthy `'none'`), or `plainSegment.ts:91-92` (caption). Cost: every output frame is decode + GL composite + `VideoEncoder`, vs one native `ffmpeg` trim+scale per segment. This alone is **far more than 5×** on video. UI `1 / 1` on N>1 is the coalesced-GL signature (`exportPipelineWebCodecs.ts:532-535`, `:1721-1723`).
2. **Per-segment decode-cursor close/reopen** — `exportWorker.ts:453-462`, `:598-603`; `decodeCursorLifetime.ts:141-159`. 332 keyframe seeks + GOP preroll vs 4. Estimate **~5k–20k discarded frames** plus 332 `VideoDecoder.configure`s. On short segments preroll ≥ useful decode (**~2–5× decode work**). This is the Round 6 memory fix's throughput bill. Does not run at all on a true Tier 1 path.
3. **GL piece split → new Worker → re-demux** — `exportPipelineWebCodecs.ts:492-527`, `:832-835`. No-transition GL *can* cut every 1800 frames; 4 assets × ~4 pieces ≈ **16 full fetch+parse** vs 4. Parse times were measured in Round 2 and not filed; order of magnitude is "whole-file mp4box per URL per piece," not a few milliseconds.
4. **332× `VideoDecoder` session open/close on 4 files** — same sites as (2); silent-gaps already named hardware-session churn as a live candidate. Extra cost on top of preroll frames: decoder bring-up / VideoToolbox session, **hundreds of ms × 332** in the bad case, unmeasured.
5. **Encoder-session rotate every 1800 frames** — `encoderSessionPlan.ts:68`, `exportWorker.ts` flush+`createEncoder`. Fixed cost per ~60s of *GL* output (one flush + hardware-ladder configure). Small next to (1)–(2). Unreachable on Tier 1.

If the project **did** take Tier 1, none of (2)–(5) run, `1 / 1` means one segment (or one piece), and a 5× claim needs a different cause (many `ffmpeg` trim invocations, IPC, remux). The field string plus "no effects should be native trim" is the GL-coalesce story, not a this-round predicate regression.

---

## Gates

Static report only; no production/test source changed in this round of the audit. `tsc` / `lint` / suite: see the session command log after this file lands. `git diff` must contain only this document.
