# Audit: Tag Format Change Readiness (`[IMAGE: file]` → bare `[file]`)

> Read-only audit — no code was changed. Scope: everything needed to move
> from `[IMAGE: filename]` / `[VIDEO: filename]` to a bare `[filename]` tag
> with strict exact-match asset resolution, without surprising any other
> consumer of the current tag/matching logic. All claims cite `file:line`;
> several were additionally verified with `grep`/`find` across the *entire*
> codebase, not just the obvious files, specifically to check for hidden
> consumers.

---

## 1. Tag Regex

All three regexes live in or right around `parseProjectData` in [src/App.tsx](../src/App.tsx):

**Scene-boundary recognition** (matches `[IMAGE:`, `[VIDEO:`, `[HEADING:`):
```ts
const TAG_REGEX = /(?=\[(?:IMAGE|VIDEO|HEADING)\s*:)/i;
```
[App.tsx:246](../src/App.tsx#L246) — used to split the whole `sceneDetails` string:
```ts
const rawDetails = sceneDetails.split(TAG_REGEX).filter(block => block.trim() !== '');
```
[App.tsx:247](../src/App.tsx#L247), and again identically in the zero-scenes backup path at [App.tsx:261](../src/App.tsx#L261).

**Heading-tag test** (same pattern restricted to `HEADING`):
```ts
const isHeadingTag = /^\[HEADING\s*:/i.test(scene.tag);
```
[App.tsx:281](../src/App.tsx#L281)

**Filename extraction** (run per-scene, on the tag line only):
```ts
const specificMatch = detail.match(/\[(?:IMAGE|VIDEO|HEADING):\s*(.*?)\s*\]/i);
if (specificMatch) {
  name = specificMatch[1] ?? '';
} else {
  const simpleMatch = detail.match(/\[(.*?)\]/);
  if (simpleMatch) name = simpleMatch[1] ?? '';
  else name = detail;
}
```
[App.tsx:306–313](../src/App.tsx#L306-L313), with the "was this a clean, explicit tag" flag at [App.tsx:315–316](../src/App.tsx#L315-L316):
```ts
const hasExplicitTagName = specificMatch !== null && (specificMatch[1] ?? '').length > 0;
```

**How scene-boundary splitting actually works — it's regex-lookahead-based, not line-based, with a line-based pass layered on top:**

`TAG_REGEX` is a zero-width lookahead (`(?=...)`), so `sceneDetails.split(TAG_REGEX)` doesn't consume any text — it just cuts the string immediately before every occurrence of `[IMAGE`, `[VIDEO`, or `[HEADING` (case-insensitively), anywhere in the string, regardless of line boundaries. That produces one "block" per scene, each block starting with its tag and containing everything up to (not including) the next tag. *Then*, separately, each block is split on newlines and trimmed ([App.tsx:252–258](../src/App.tsx#L252-L258)):
```ts
rawDetails.forEach(block => {
  const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
  const tag = lines[0];
  if (tag !== undefined) {
    scenes.push({ tag, description: lines.slice(1).join(' ') });
  }
});
```
So within a block, "where the tag ends and the description begins" is purely positional: line 1 of the block is the tag, everything else is description — there's no content-based check that line 1 "looks like" a tag beyond the fact that `TAG_REGEX` is what created the block boundary in the first place. Practically: scene boundaries are found by the bracket regex (not by line breaks), but once a block is isolated, the tag/description split *within* that block is line-based.

This matters directly for the planned change: switching to a bare `[filename]` tag means the recognition regex can no longer look for a keyword (`IMAGE|VIDEO|HEADING`) before the colon — colons may not even be present. `[HEADING: ...]` needs to keep being distinguishable from a plain asset tag somehow (a keyword, a different bracket character, a prefix convention, etc.), since `isHeadingTag` currently is what causes `parseProjectData` to `continue` past a scene without emitting a segment for it ([App.tsx:282](../src/App.tsx#L282)) — that decision point has to survive the format change in some form or headings will start being parsed as (unmatchable) asset tags.

---

## 2. Matcher Call Graph

I grepped `isFuzzyMatch` and `findAssetByContext` across the *entire* `src/` tree (not just `parseProjectData`), then traced every caller of anything that itself calls them, and verified liveness (whether each caller is actually reachable from the UI) rather than assuming.

### Direct call sites

| Function | Call site | Enclosing function | Trigger |
|---|---|---|---|
| `isFuzzyMatch` | [App.tsx:319](../src/App.tsx#L319) | `parseProjectData` ([App.tsx:238](../src/App.tsx#L238)) | Runs during Apply Sync — `parseProjectData` is only ever called from `handleApplySyncFromFiles` ([App.tsx:1522](../src/App.tsx#L1522)). |
| `isFuzzyMatch` | [syncEngine.ts:133](../src/services/syncEngine.ts#L133) | `autoMatchSegments` ([syncEngine.ts:125](../src/services/syncEngine.ts#L125)) | See `autoMatchSegments` callers below. |
| `findAssetByContext` | [App.tsx:330](../src/App.tsx#L330) | `parseProjectData` | Same as above — Apply Sync. |
| `findAssetByContext` | [syncEngine.ts:137](../src/services/syncEngine.ts#L137) | `autoMatchSegments` | See below. |

Both matchers are otherwise only referenced by their own definitions ([syncEngine.ts:9](../src/services/syncEngine.ts#L9) and [syncEngine.ts:29](../src/services/syncEngine.ts#L29)) and the shared import line ([App.tsx:52](../src/App.tsx#L52)) — there is no third consumer anywhere in the codebase.

### `autoMatchSegments` callers — the indirect exposure

`autoMatchSegments` ([syncEngine.ts:125–141](../src/services/syncEngine.ts#L125-L141)) wraps both matchers (bracket-match via `isFuzzyMatch`, then a context fallback via `findAssetByContext`) and is called from **four** places in `App.tsx`. I checked each one's own reachability, not just its existence:

1. **[App.tsx:1583](../src/App.tsx#L1583)**, inside `handleApplySyncFromFiles` — **live**. Runs immediately after `parseProjectData` + timing, as a second matching pass over the fully-synced segment array (a no-op for anything `parseProjectData` already matched, since `autoMatchSegments` early-returns when `s.assetId` is already set). Trigger: clicking "Apply Sync" or confirming a Scene Details save.
2. **[App.tsx:1681](../src/App.tsx#L1681)**, inside `processMediaFile` ([App.tsx:1646](../src/App.tsx#L1646)) — **dead code**. I grepped the whole `src/` tree for `processMediaFile` and it appears exactly once: its own definition. Nothing calls it. This call site cannot currently execute.
3. **[App.tsx:1737](../src/App.tsx#L1737)**, inside `processZipFile` ([App.tsx:1688](../src/App.tsx#L1688)) — **dead code**. `processZipFile`'s only caller is `handleZipUpload` ([App.tsx:1751](../src/App.tsx#L1751)), and `handleZipUpload` ([App.tsx:1748](../src/App.tsx#L1748)) itself has zero references anywhere in `src/` beyond its own definition and a doc-comment mentioning it ([App.tsx:1687](../src/App.tsx#L1687)) — it isn't wired to any input element or button. The *live* zip-upload path is a different function, `extractZipToAssets` ([App.tsx:175](../src/App.tsx#L175)), called from `handleApplySyncFromFiles` ([App.tsx:1503](../src/App.tsx#L1503)) — that function only extracts and persists assets; it does not call `autoMatchSegments` itself (matching for zip-sourced assets happens later, via call site #1 above, once `handleApplySyncFromFiles` reaches its own `autoMatchSegments` call).
4. **[App.tsx:2786](../src/App.tsx#L2786)**, inside the inline `onSelect` callback passed to `<StockSearchModal>` ([App.tsx:2742](../src/App.tsx#L2742)) — **live**. Triggered when a user picks a Pexels/Pixabay result in the Stock Search modal to fill one specific segment's asset. The modal is opened via `onOpenStockSearch`, which is wired in three places ([App.tsx:2494](../src/App.tsx#L2494), [App.tsx:2519](../src/App.tsx#L2519), [App.tsx:2804](../src/App.tsx#L2804)) — e.g. the per-segment "Change" button on the timeline. Note this call passes the *entire* segments array (`afterTarget`, all segments with the one target's `assetId` already set), not just the one segment being filled — so it re-runs matching over every other still-unmatched segment in the project too.

### Can `parseProjectData`'s matching be changed in isolation?

**Only partially.** There are exactly two *live* entry points into the shared matchers: `parseProjectData` itself (Apply Sync), and the Stock Search `onSelect` callback (via `autoMatchSegments`) — plus `handleApplySyncFromFiles`'s own second `autoMatchSegments` pass, which runs every Apply Sync regardless of what `parseProjectData` did. Two more call sites exist in the source but are unreachable dead code (`processMediaFile`, `processZipFile`/`handleZipUpload`).

Concretely: if the new bare-`[filename]`/strict-exact-match logic is written entirely *inside* `parseProjectData`'s own inline matching code ([App.tsx:318–335](../src/App.tsx#L318-L335)) without touching `isFuzzyMatch`/`findAssetByContext` themselves, then `autoMatchSegments` (and therefore the live Stock Search call site) keeps using the *old* fuzzy logic as its fallback for anything left unmatched — meaning old fuzzy-match behavior could still resurface for edge cases even after the primary path is switched to strict matching. To get uniform strict-exact-match behavior everywhere, `isFuzzyMatch` itself (or its call sites in `autoMatchSegments`) would need to change too, which would also affect the Stock Search flow's fallback matching.

---

## 3. Test Fixtures

**None exist.** I searched every test file in the repo for literal `[IMAGE:`, `[VIDEO:`, or `[HEADING:` strings (first with a plain grep, then re-confirmed with extended regex in case of a shell-escaping miss) and got zero matches. The full test file list is:

```
src/hooks/useWebCodecsPreview.test.ts
src/services/syncTiming.test.ts
src/services/lockedOverlap.test.ts
src/services/plainSegment.test.ts
src/services/videoDemuxer.test.ts
src/services/videoDecoderPool.test.ts
src/services/animBlend.test.ts
```

`syncTiming.test.ts` — the file most likely to contain such fixtures given it tests the sync/timing pipeline — never parses raw `sceneDetails` text at all. It builds `VideoSegment` objects directly via a local helper:
```ts
function makeSegment(partial: Partial<VideoSegment> & { id: string; text: string; order: number }): VideoSegment {
  return { startTime: 0, duration: 1, transition: TransitionType.NONE, animation: AnimationType.NONE, ...partial };
}
```
[syncTiming.test.ts:13–21](../src/services/syncTiming.test.ts#L13-L21), and transcript tokens via a `wordTokens(...)` helper ([syncTiming.test.ts:23–29](../src/services/syncTiming.test.ts#L23-L29)). It exercises `applyAnchorBasedTiming`, `computeHeadingAnchors`, `reinsertHeadings`, `distributeSegmentTimes`, `applyHeadingTiming`, and `alignScenestoTranscript` directly — all of which sit *downstream* of `parseProjectData`'s tag parsing, operating on already-built segment arrays. None of this file's fixtures reference bracket-tag syntax, so none need rewriting for a tag-format change.

The one other file my loose grep flagged, `plainSegment.test.ts`, matched only because of `Asset` fixtures like:
```ts
const VIDEO_ASSET: Asset = { id: 'v1', name: 'clip.mp4', url: 'blob:v1', type: 'video' };
const IMAGE_ASSET: Asset = { id: 'i1', name: 'pic.jpg', url: 'blob:i1', type: 'image' };
```
[plainSegment.test.ts:6–7](../src/services/plainSegment.test.ts#L6-L7) — these are `Asset.type` string values, unrelated to scene-doc bracket tags.

**Implication:** there is currently no automated regression test covering `parseProjectData`'s tag-recognition regexes (`TAG_REGEX`, `isHeadingTag`, `specificMatch`) at all — changing that code today has no existing safety net to catch a break. Worth writing new tests alongside the format change rather than assuming existing coverage will catch a regression.

---

## 4. Segment Type Source

**`VideoSegment` has no `type` field at all.** I re-read the full interface ([types.ts:154–206](../src/types.ts#L154-L206)) and separately grepped the whole codebase for `segment.type`/`seg.type`/`s.type` (excluding `asset.type` matches) — zero hits. So the premise "where does `VideoSegment.type` get set" doesn't hold; there's nothing to find because the field doesn't exist.

Media type (image vs. video) is **never stored on the segment** — it's re-derived every time from the linked `Asset`'s own `type` field:
```ts
export interface Asset {
  id: string;
  name: string;
  url: string;
  type: 'image' | 'video' | 'audio';
  ...
}
```
[types.ts:112–121](../src/types.ts#L112-L121) (`type` at [types.ts:116](../src/types.ts#L116)), set at upload time from the file extension:
```ts
const type: Asset['type'] = ['mp4', 'mov', 'webm', 'm4v'].includes(ext) ? 'video' : 'image';
```
[App.tsx:1497–1498](../src/App.tsx#L1497-L1498) (the equivalent zip/audio-detection logic runs at [App.tsx:1710–1711](../src/App.tsx#L1710-L1711) and [App.tsx:192–193](../src/App.tsx#L192-L193) for the two other file-ingest paths).

Every consumer that needs to know whether a segment's content is an image or a video looks up the asset via `assetId` and reads `asset.type` fresh, e.g.:
- [App.tsx:363](../src/App.tsx#L363) (`if (asset?.type === 'video')`, inside `parseProjectData` itself, deciding whether to compute `playbackSpeed`)
- [App.tsx:1215](../src/App.tsx#L1215), [App.tsx:1510](../src/App.tsx#L1510)
- [frameRenderer.ts:379](../src/services/frameRenderer.ts#L379), [:382](../src/services/frameRenderer.ts#L382), [:496](../src/services/frameRenderer.ts#L496), [:499](../src/services/frameRenderer.ts#L499)
- [plainSegment.ts:80](../src/services/plainSegment.ts#L80) (`if (!asset || asset.type !== mediaType || !asset.url) return false;`)
- [Timeline.tsx:387](../src/components/Timeline.tsx#L387) (`asset.type === 'video' ? <video .../> : <img .../>`)
- [PreviewStage.tsx:981](../src/components/PreviewStage.tsx#L981), [:1064](../src/components/PreviewStage.tsx#L1064)
- [segmentEncoder.ts:112](../src/services/segmentEncoder.ts#L112) (diagnostic logging only)

**Directly answering the question as posed:** the segment's media type is not read from the tag keyword at all in any lasting way. Once `specificMatch` extracts the filename ([App.tsx:306](../src/App.tsx#L306)), the captured alternation keyword (`IMAGE` vs `VIDEO`) itself is discarded — it's never stored, compared, or branched on anywhere downstream. The **only** keyword `parseProjectData` actually special-cases is `HEADING` (via `isHeadingTag`, [App.tsx:281](../src/App.tsx#L281)). This means today, writing `[IMAGE: clip.mp4]` for an actual video file has **zero functional effect** on parsing — the name is extracted and matched identically regardless of which of `IMAGE`/`VIDEO` was written, and the real media type used for rendering/export comes solely from the resolved asset's own `type` field. This is directly good news for the planned change: dropping the `IMAGE`/`VIDEO` keyword distinction in favor of a bare `[filename]` tag discards no information that anything currently reads — only the `HEADING` keyword (or whatever replaces it) needs to keep being distinguishable, per Section 1.

---

## 5. Case Sensitivity

**Scene-to-asset fuzzy matching is case-insensitive everywhere it happens**, because both matcher functions lowercase before comparing:
```ts
const s = search.toLowerCase().trim()...
const t = target.toLowerCase().trim()...
```
[syncEngine.ts:11–12](../src/services/syncEngine.ts#L11-L12) (`isFuzzyMatch`), and:
```ts
const words = text.toLowerCase().split(...)...
const assetName = asset.name.toLowerCase();
```
[syncEngine.ts:30](../src/services/syncEngine.ts#L30), [syncEngine.ts:32](../src/services/syncEngine.ts#L32) (`findAssetByContext`). `autoMatchSegments` adds no case handling of its own — it calls straight through to both ([syncEngine.ts:133](../src/services/syncEngine.ts#L133), [syncEngine.ts:137](../src/services/syncEngine.ts#L137)) — so every consumer traced in Section 2 inherits case-insensitivity uniformly.

**Upload-time logic uses a *different*, case-sensitive check — but for a different purpose (duplicate-upload prevention, not scene matching):**
```ts
if (allAssets.some(a => a.name === sf.file.name)) continue;              // App.tsx:1496
if (allAssets.some(a => a.name === asset.name)) { ... }                  // App.tsx:1505
if (assetsRef.current.some(a => a.name === file.name)) return;           // App.tsx:1648
if (assetsRef.current.some(a => a.name === name)) return;                // App.tsx:1707
const dedupedNew = newAssets.filter(na => !prev.assets.some(a => a.name === na.name)); // App.tsx:1732
```
All five use strict `===` on the raw, non-lowercased `.name` string — so `Photo.jpg` and `photo.jpg` are treated as two distinct assets for dedup purposes, even though they'd be treated as the same asset by `isFuzzyMatch`'s exact-match branch (`t === s`, [syncEngine.ts:14](../src/services/syncEngine.ts#L14), which runs on the lowercased strings).

**This is a real decision point for the planned change, not just a fact to note:** the current fuzzy resolution path is uniformly case-insensitive end-to-end, while the app's own upload-dedup logic is case-sensitive. A "strict exact-match" replacement could reasonably copy either convention — matching user expectations carried over from the old fuzzy behavior (case-insensitive) vs. matching the case-sensitive identity semantics already used for upload dedup elsewhere in the same file. Nothing in the current code implies one is "more correct" than the other; it's a choice the change needs to make explicitly rather than inherit by accident.
