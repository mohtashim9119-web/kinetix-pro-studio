# Audit: Scene Details → Synced VideoSegment Flow

> Read-only audit. No code was changed while producing this report. All claims
> below are backed by inline citations to real source (`file:line`); anything
> I could not verify from the code directly is flagged as such rather than
> asserted. Several regex/behavior claims were additionally verified with
> throwaway `node -e` scripts (noted where relevant) rather than reasoned from
> inspection alone.

---

## 1. Tag Recognition

Tag recognition happens inside `parseProjectData` in [src/App.tsx](../src/App.tsx), starting at [App.tsx:238](../src/App.tsx#L238).

### The scene-boundary regex

```ts
const TAG_REGEX = /(?=\[(?:IMAGE|VIDEO|HEADING)\s*:)/i;
```
[App.tsx:246](../src/App.tsx#L246)

`sceneDetails` is split on this pattern:

```ts
const rawDetails = sceneDetails.split(TAG_REGEX).filter(block => block.trim() !== '');
```
[App.tsx:247](../src/App.tsx#L247)

`TAG_REGEX` is a **zero-width lookahead**, so `.split()` doesn't consume the tag — it cuts the string immediately *before* each occurrence of `[IMAGE`, `[VIDEO`, or `[HEADING` (case-insensitive), keeping the tag as the first character of the following block. This is how a blank line — or no line at all — between one scene's tag and the next scene's tag doesn't create a spurious empty scene; and it's how the tag and everything after it (the "description") land in the same `block`, to be split apart again immediately below.

**Case sensitivity:** the trailing `/i` flag makes this case-insensitive. Verified: `[image: x]`, `[Image: x]`, `[IMAGE: x]` all split correctly.

**Whitespace tolerance — verified with `node -e`:**
| Input | Recognized as a scene boundary? |
|---|---|
| `[IMAGE: x]` | ✅ |
| `[IMAGE:x]` (no space after colon) | ✅ (the `\s*` before `:` is 0-or-more, colon itself has no required space) |
| `[IMAGE : x]` (space **before** colon) | ✅ — `\s*` sits between the tag word and `:` |
| `[ IMAGE: x]` (space **after** the opening bracket) | ❌ — the pattern requires `\[` immediately followed by the literal tag word; a space there means `(?:IMAGE|VIDEO|HEADING)` never matches at that position |

So: whitespace *before* the colon is tolerated, whitespace *between the bracket and the tag word* is not.

**Does it require the tag on its own line?** No — `TAG_REGEX` only needs the bracket sequence to appear somewhere in the text; it isn't anchored to line boundaries in any way. In practice tags are always written on their own line (per the block-splitting logic described next), but the split itself is not line-aware.

### Separating the tag from the following script text

Once split into `rawDetails` blocks, each block is broken into trimmed, non-empty lines; the first line is the tag, everything else is the scene's own inline description:

```ts
rawDetails.forEach(block => {
  const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
  const tag = lines[0];
  if (tag !== undefined) {
    scenes.push({ tag, description: lines.slice(1).join(' ') });
  }
});
```
[App.tsx:252–258](../src/App.tsx#L252-L258)

This is the mechanism that answers "how does the parser know `reference-sample.jpg` is the filename and the next line is voiceover text belonging to that scene": it doesn't inspect the second line at all — it simply treats *line 1 of the block* as the tag (parsed for a filename below) and *every subsequent line* as that scene's description text, joined with spaces. There's no separate content-based check; it's purely positional (first line vs. rest).

There is a fallback path if this produces zero scenes at all (`scenes.length === 0`, i.e. no tag anywhere matched `TAG_REGEX`): [App.tsx:260–272](../src/App.tsx#L260-L272) re-splits the same way but treats whatever the first line is as the tag regardless of whether it looks like a bracket tag, wrapping it in `[...]` if it doesn't already have brackets. This only fires when literally nothing in `sceneDetails` matched a recognized tag — for the two-line example in this audit's prompt, the primary path handles it (`scenes.length === 1`), so this fallback is not exercised.

### Heading-tag detection

```ts
const isHeadingTag = /^\[HEADING\s*:/i.test(scene.tag);
if (isHeadingTag) continue; // still a scene boundary (TAG_REGEX), but headings live only in the segments array now — produce no segment
```
[App.tsx:281–282](../src/App.tsx#L281-L282)

Same whitespace tolerance as `TAG_REGEX` (verified: tolerates space before `:`, rejects space after `[`). When a block's tag is a heading tag, the loop `continue`s *before* a `RawSegment` is ever constructed for it — no segment is produced from this function for a heading. This matches CLAUDE.md's "headings are array-only, recognize-and-skip" description, and I verified it directly against this line rather than the doc's prose.

### Filename extraction

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
[App.tsx:306–313](../src/App.tsx#L306-L313)

**This regex is inconsistent with `TAG_REGEX` and `isHeadingTag`** — it has no `\s*` before the colon, so it requires the colon immediately after the tag word. Verified with `node -e`:

| Input | `TAG_REGEX` recognizes as boundary? | `specificMatch` extracts filename cleanly? |
|---|---|---|
| `[IMAGE: x]` | ✅ | ✅ → `"x"` |
| `[IMAGE:x]` | ✅ | ✅ → `"x"` |
| `[IMAGE : x]` | ✅ | ❌ NO MATCH — falls to `simpleMatch`, which captures the whole bracket interior including the stray `"IMAGE : "` prefix |

So a tag like `[IMAGE : reference-sample.jpg]` (space before colon) is recognized as a scene boundary but does **not** get clean filename extraction — see Findings below for what actually happens to matching in that case.

---

## 2. Asset Matching

### The matcher functions ([src/services/syncEngine.ts](../src/services/syncEngine.ts))

```ts
export const isFuzzyMatch = (search: string, target: string): boolean => {
  if (!search || !target) return false;
  const s = search.toLowerCase().trim().replace(/\[(IMAGE|VIDEO|HEADING):?\s*|\]/gi, '').replace(/\.(jpg|jpeg|png|mp4|mov|wav|mp3|zip)$/i, '');
  const t = target.toLowerCase().trim().replace(/\.(jpg|jpeg|png|mp4|mov|wav|mp3|zip)$/i, '');

  if (t === s) return true;
  if (t.includes(s) || s.includes(t)) return true;

  const sWords = s.split(/[\s_\-]+/).filter(w => w.length > 2);
  const tWords = t.split(/[\s_\-]+/).filter(w => w.length > 2);

  let matches = 0;
  for (const word of sWords) {
    if (tWords.some(tw => tw.includes(word) || word.includes(tw))) {
      matches++;
    }
  }
  return matches >= 2;
};
```
[syncEngine.ts:9–27](../src/services/syncEngine.ts#L9-L27)

Matching order, exactly as coded:
1. **Case-insensitive** — both strings are `.toLowerCase()`'d.
2. Extension is stripped from **both** sides, but only for a fixed whitelist: `jpg|jpeg|png|mp4|mov|wav|mp3|zip` ([syncEngine.ts:11–12](../src/services/syncEngine.ts#L11-L12)). `.webp`, `.gif`, `.webm`, `.m4a`, `.avi`, etc. are **not** in this list.
3. **Exact match** (post-normalization) → true ([syncEngine.ts:14](../src/services/syncEngine.ts#L14)).
4. **Substring containment, either direction** (`t.includes(s) || s.includes(t)`) → true ([syncEngine.ts:15](../src/services/syncEngine.ts#L15)). This is the real fallback workhorse — see Findings.
5. **Token overlap**: split both strings on whitespace/underscore/hyphen, keep words >2 chars, and require **at least 2** words to cross-match (substring either direction) between the two word sets ([syncEngine.ts:17–26](../src/services/syncEngine.ts#L17-L26)). Because this requires ≥2 matching words, a single-word search term (e.g. `hero`) can *only* ever succeed via step 3 or 4 above, never via this token-overlap step — verified: `isFuzzyMatch("hero", "cover-hero-shot.png")` returns `true`, but only because `"cover-hero-shot".includes("hero")` (step 4), not because of token overlap.

There is no similarity score anywhere in this function — every rule is a hard boolean short-circuit.

```ts
export const findAssetByContext = (text: string, assets: Asset[]): Asset | null => {
  const words = text.toLowerCase().split(/[\s,.;:!?]+/).filter(w => w.length > 3);
  for (const asset of assets) {
    const assetName = asset.name.toLowerCase();
    if (words.some(word => assetName.includes(word))) return asset;
  }
  return null;
};
```
[syncEngine.ts:29–36](../src/services/syncEngine.ts#L29-L36)

This is a *different* matcher, used only when there's no bracket-derived name at all (see below) — it scans the scene's own script/description text (not the tag) for words >3 chars and returns the **first** asset (in `assets` array order) whose lowercased `name` contains any of those words. No scoring; first hit in array order wins.

### Caller logic in `parseProjectData` — order, ties, and no-match

```ts
if (name) {
  const matchingAssets = assets.filter(a => isFuzzyMatch(name, a.name));
  const unusedAsset = matchingAssets.find(a => !usedAssetIdsTotal.has(a.id));
  const asset = unusedAsset ?? matchingAssets[0];
  if (asset) {
    current.assetId = asset.id;
    usedAssetIdsTotal.add(asset.id);
  }
}

if (!current.assetId && !hasExplicitTagName && text) {
  const availableAssets = assets.filter(a => !usedAssetIdsTotal.has(a.id) && a.type !== 'audio');
  const contextualAsset = findAssetByContext(text, availableAssets.length > 0 ? availableAssets : assets);
  if (contextualAsset) {
    current.assetId = contextualAsset.id;
    usedAssetIdsTotal.add(contextualAsset.id);
  }
}

rawSegments.push(current);
```
[App.tsx:318–337](../src/App.tsx#L318-L337)

- **Exact match first, fuzzy fallback?** Not quite how the task framed it — `isFuzzyMatch` itself *contains* an exact-match check as its first internal branch (`t === s`), but the caller doesn't call two different matchers; it calls `isFuzzyMatch` once per candidate asset and collects everything that returns true, exact or fuzzy alike.
- **Multiple candidate matches:** `matchingAssets` collects *every* asset in `project.assets` that fuzzy-matches `name`. Tie-break is **pure array order, with a "not yet claimed this sync pass" preference**: prefer the first match not already in `usedAssetIdsTotal` (built up incrementally as earlier scenes in the same `parseProjectData` call claim assets); if all matches are already claimed, fall back to `matchingAssets[0]` — the first match in `assets` array order (i.e. upload order), even though it's a duplicate assignment. There is no scoring by string similarity, length, or anything else — just iteration order.
- **No match at all:** `current.assetId` is simply never set — it stays `undefined`. Critically, `rawSegments.push(current)` at [App.tsx:337](../src/App.tsx#L337) runs **unconditionally**, outside any check on whether an asset was found. The scene is never dropped; it becomes a segment with `assetId: undefined`. Downstream, `Timeline.tsx` renders this state explicitly:
  ```ts
  const isMissing = !asset && !!(s.text || s.heading || s.isHeading);
  ```
  [Timeline.tsx:322](../src/components/Timeline.tsx#L322) — shown as a pulsing red `AlertCircle` instead of a thumbnail ([Timeline.tsx:392–395](../src/components/Timeline.tsx#L392-L395)).
- **`hasExplicitTagName`** ([App.tsx:315–316](../src/App.tsx#L315-L316)) is `true` only when `specificMatch` (the strict, colon-sensitive regex) matched and captured a non-empty group. If the tag had a space before its colon (see Section 1), `specificMatch` is `null`, so `hasExplicitTagName` is `false` even though a `name` was still derived via `simpleMatch` — meaning the `findAssetByContext` fallback pass at [App.tsx:328](../src/App.tsx#L328) can *also* run for such a scene if the fuzzy-match pass on the messy `simpleMatch`-derived name fails.

### Duplicate-assignment detection (after the fact, not prevented)

```ts
assetIdCounts.forEach((count, assetId) => {
  if (count > 1) {
    ...
    console.warn(
      `[parseProjectData] Asset "${assetId}" is assigned to ${count} segments: ` + ...
    );
  }
});
```
[App.tsx:395–415](../src/App.tsx#L395-L415)

This only logs a `console.warn` after the fact — it doesn't prevent or resolve the duplicate; it's diagnostic only, and nothing in the UI surfaces this to the user.

### A second, later matching pass: `autoMatchSegments`

```ts
export const autoMatchSegments = (assets: Asset[], segments: VideoSegment[]): VideoSegment[] =>
  segments.map(s => {
    if (s.assetId) return s;
    const headingLabel = s.headingConfig?.text ?? s.heading ?? '';
    const bracketMatch = (headingLabel + s.text).match(/\[(.*?):?\s*(.*?)\]/);
    if (bracketMatch) {
      const name = (bracketMatch[2] ?? '').trim();
      const asset = assets.find(a => isFuzzyMatch(name, a.name));
      if (asset) return { ...s, assetId: asset.id };
    }
    const contextAsset = findAssetByContext(headingLabel + ' ' + s.text, assets);
    if (contextAsset) return { ...s, assetId: contextAsset.id };
    return s;
  });
```
[syncEngine.ts:125–141](../src/services/syncEngine.ts#L125-L141)

This runs later in the Apply Sync chain (see Section 4) as a safety net for any segment still lacking an `assetId` after `parseProjectData`'s own matching — it early-returns immediately (`if (s.assetId) return s;`) for anything already matched, so for the common case (tag matched during `parseProjectData`) it's a no-op pass-through.

---

## 3. Duration / Timing Assignment

### Step A — character-weight seed, inside `parseProjectData`

```ts
const textBearingScenes = rawSegments.filter(s => s.text);
const voDuration = voiceoverDuration > 0 ? voiceoverDuration : rawSegments.length * 5;
const textBudget = Math.max(0.1, voDuration);
const totalTextLength = textBearingScenes.reduce((acc, s) => acc + s.text.length, 0) || 1;

let currentTimeAccumulator = 0;
for (const [i, s] of rawSegments.entries()) {
  let targetDuration: number;
  if (textBearingScenes.length > 0) {
    const weight = s.text.length / totalTextLength;
    targetDuration = weight * textBudget;
  } else {
    targetDuration = voDuration / Math.max(1, rawSegments.length);
  }
  ...
}
```
[App.tsx:340–357](../src/App.tsx#L340-L357)

**This is a character-count weighting, not a word-count weighting.** `s.text.length` is `String.prototype.length` — the number of characters in the scene's text — and `totalTextLength` is the sum of those character counts across all text-bearing scenes. `weight = s.text.length / totalTextLength`, and `targetDuration = weight * textBudget` where `textBudget` is (effectively) the full voiceover duration. This directly contradicts CLAUDE.md's description ("proportioning segment durations to word count") and the framing in this audit's own prompt — per the task's own instruction to verify rather than cite the doc, the code unambiguously weights by characters.

The resulting `VideoSegment` is built as:
```ts
const segment: VideoSegment = {
  ...s,
  id: crypto.randomUUID(),
  startTime: Number(currentTimeAccumulator.toFixed(3)),
  duration: Number(targetDuration.toFixed(3)),
  anchorStart: Number(currentTimeAccumulator.toFixed(3)),
  anchorSource: 'estimate' as const,
  ...
};
if (i === rawSegments.length - 1 && voiceoverDuration > 0) {
  segment.duration = Math.max(0.1, Number((voiceoverDuration - segment.startTime).toFixed(3)));
}
finalSegments.push(segment);
currentTimeAccumulator += segment.duration;
```
[App.tsx:370–392](../src/App.tsx#L370-L392)

Segments are laid contiguously end-to-end via `currentTimeAccumulator`; the last segment is force-clamped to make the total exactly equal `voiceoverDuration` (absorbing/trimming any floating-point drift from the per-scene weighting).

**Do headings participate?** No — confirmed directly, not just per CLAUDE.md. Heading-tagged scenes hit `continue` at [App.tsx:282](../src/App.tsx#L282) *before* a `RawSegment` is constructed, so they never enter `rawSegments`, never enter `textBearingScenes`, and never contribute a character to `totalTextLength`. Heading timing is handled entirely separately, in `reinsertHeadings` (see Section 4).

### Step B — this seed is normally overridden by real Whisper word-alignment before it ever reaches the screen

The character-weight numbers above are *not* generally what the user sees. In the standard Tauri desktop flow, Apply Sync is gated behind transcription completion:
```ts
const applySyncDisabled = effectiveVoiceoverId !== undefined && !transcriptionReady;
```
[App.tsx:1827](../src/App.tsx#L1827)

So by the time a user can actually click Apply Sync, cached Whisper tokens are normally already available, and `handleApplySyncFromFiles` takes the `cachedTokensReady` branch (see Section 4), which runs `alignScenestoTranscript` — a genuinely **word**-level aligner:
```ts
export function normalize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 0);
}
```
[whisperService.ts:40–46](../src/services/whisperService.ts#L40-L46)

`alignScenestoTranscript` ([whisperService.ts:58–250](../src/services/whisperService.ts#L58-L250)) expands every Whisper token into individual normalized words, then for each segment does a bounded sliding-window exact-word-match score (`tokenWords[wi+j]?.word === targetWords[j]`, [whisperService.ts:119–129](../src/services/whisperService.ts#L119-L129)) to find the best-aligned span of the real transcript, derives `t0`/`t1` from the matched tokens' real timestamps, then overrides each segment's `t1` with the *next* segment's `t0` ([whisperService.ts:172–175](../src/services/whisperService.ts#L172-L175)) and nudges shared boundaries to the midpoint of a detected silence gap in the actual audio ([whisperService.ts:177–243](../src/services/whisperService.ts#L177-L243)).

So: the character-weight formula in Section 3A is best understood as a **bootstrap seed** for `anchorStart` (used to order/space segments before real timing exists) — in the code's own words, `anchorSource: 'estimate'`. The precise, on-screen timing in the normal path comes from real audio word-alignment, not character counting. The character-weighted numbers only survive verbatim to the screen in the fallback branch, which the code explicitly flags as an abnormal path:
```ts
// Defensive fallback only — under correct button gating this branch
// should be unreachable whenever a voiceover exists in Tauri. Surface
// it loudly rather than silently shipping character-based timing.
```
[App.tsx:1564–1566](../src/App.tsx#L1564-L1566)

### Step C — `applyAnchorBasedTiming` (both paths pass through this)

```ts
export function applyAnchorBasedTiming(segments: VideoSegment[], audioDuration: number): VideoSegment[] {
  ...
  // PASS 1 — normalize first-segment anchor to 0.
  const first = out[0];
  if (first && ((first.anchorStart ?? 0) > 0 || first.anchorStart === undefined)) {
    if (first.anchorStart === undefined) first.anchorSource = 'estimate';
    first.anchorStart = 0;
  }
  ...
  for (let i = 0; i < out.length; i++) {
    const seg = out[i];
    const isLast = i === out.length - 1;
    const nextAnchor = isLast ? audioDuration : (out[i + 1]?.anchorStart ?? out[i + 1]?.startTime ?? audioDuration);
    const anchorStart = seg.anchorStart ?? seg.startTime ?? 0;
    if (seg.locked) {
      seg.startTime = Number(anchorStart.toFixed(3));
      const preservedDuration = seg.duration ?? 0;
      const availableSpan = Math.max(0, nextAnchor - seg.startTime);
      seg.duration = Number(Math.max(preservedDuration, availableSpan).toFixed(3));
    } else {
      seg.startTime = Number(anchorStart.toFixed(3));
      seg.duration = Number(Math.max(0.1, nextAnchor - seg.startTime).toFixed(3));
    }
  }
  // PASS 3 — clamp last segment exactly to audioDuration.
  ...
}
```
[syncEngine.ts:57–112](../src/services/syncEngine.ts#L57-L112)

Every unlocked segment's `duration` is re-derived as *the gap to the next segment's anchor* (or to `audioDuration` for the last segment) — not from the character-weight/Whisper duration directly. `PASS 1` unconditionally forces the very first segment's anchor to `0`, discarding any leading silence. Locked segments keep their existing duration unless a gap opened after a removal, in which case they grow (never shrink) to absorb it.

---

## 4. Full Call Chain — "Apply Sync" Click to Timeline Pixels

### From click to `setProject`

1. **User-facing trigger — two paths, same destination:**
   - Directly editing the Scene Details textarea and clicking "Save" stages the typed text as a synthetic file: `handleConfirmSaveScene` wraps `sceneDraft` in `new File([sceneDraft], fileName, ...)` and calls `triggerSync({ ...stagedRef.current, sceneFile })` ([components/DropZonePanel.tsx:722–731](../src/components/DropZonePanel.tsx#L722-L731)).
   - The "Apply Sync" button itself: `onClick={handleApplySync}` ([DropZonePanel.tsx:1183](../src/components/DropZonePanel.tsx#L1183)) → `handleApplySync` → `triggerSync(stagedRef.current)` ([DropZonePanel.tsx:713–715](../src/components/DropZonePanel.tsx#L713-L715)).
   - Both funnel through:
     ```ts
     const triggerSync = (snapshot: StagedFiles) => {
       onApplySync(snapshot);
       updateStaged(() => EMPTY_STAGED);
       setActiveTab('segments');
     };
     ```
     [DropZonePanel.tsx:706–711](../src/components/DropZonePanel.tsx#L706-L711)
2. **`onApplySync` prop** is wired in App.tsx's JSX as `onApplySync={handleApplySyncFromFiles}` ([App.tsx:2122](../src/App.tsx#L2122)), on the `<DropZonePanel>` mounted at [App.tsx:2103](../src/App.tsx#L2103).
3. **`handleApplySyncFromFiles(staged)`** ([App.tsx:1445–1604](../src/App.tsx#L1445-L1604)) — the actual orchestrator:
   - Reads script/sceneDetails text, RTF-stripped if needed ([App.tsx:1449–1454](../src/App.tsx#L1449-L1454)).
   - Persists any newly-staged media files to IndexedDB via `persistFileToAsset` / `persistPendingVoiceoverAsset` / `extractZipToAssets`, building `allAssets` ([App.tsx:1459–1512](../src/App.tsx#L1459-L1512)).
   - Resolves `audioDuration` via the real `<audio>` element or `getAudioDuration()` ([App.tsx:1514–1519](../src/App.tsx#L1514-L1519), `getAudioDuration` defined [App.tsx:121–128](../src/App.tsx#L121-L128)).
   - `const newSegmentsRaw = await parseProjectData(scriptText, sceneText, allAssets, audioDuration);` ([App.tsx:1522](../src/App.tsx#L1522)) — Sections 1–3 above.
   - **Escape hatch:** if `parseProjectData` returns zero segments *and* the project already has segments, Apply Sync **aborts and keeps the old segments** rather than committing an empty timeline ([App.tsx:1529–1533](../src/App.tsx#L1529-L1533)).
   - `const contentOnly = newSegmentsRaw.filter(s => !s.isHeading);` and `const headingAnchors = computeHeadingAnchors(previousSegments);` ([App.tsx:1540–1541](../src/App.tsx#L1540-L1541)) — captures the *pre-sync* array's headings (with neighbor-asset context) before any timing runs.
   - Timing resolution ([App.tsx:1548–1575](../src/App.tsx#L1548-L1575)):
     - If cached Whisper tokens exist for this exact voiceover (`cachedTokensReady`): `applyAnchorBasedTiming(contentOnly, audioDuration)` then `alignFromCache(...)` (→ `alignSegmentsFromCachedTranscript`, [hooks/useWhisper.ts:28–51](../src/hooks/useWhisper.ts#L28-L51), which itself runs `alignScenestoTranscript` → `distributeSegmentTimes` → `applyAnchorBasedTiming` again → `applyHeadingTiming`).
     - Else (fallback, logged as unexpected in Tauri): `applyAnchorBasedTiming(contentOnly, audioDuration)` then `applyHeadingTiming(...)` directly ([App.tsx:1573–1574](../src/App.tsx#L1573-L1574)).
   - `const finalTimedSegments = reinsertHeadings(finalTimedContent, headingAnchors);` ([App.tsx:1581](../src/App.tsx#L1581)) — splices the previously-captured headings back onto the freshly-timed content array, stealing duration from their new neighbors ([syncEngine.ts:386–429](../src/services/syncEngine.ts#L386-L429)) and recomputing contiguous `startTime`s for the whole merged array ([syncEngine.ts:431–441](../src/services/syncEngine.ts#L431-L441)).
   - `const committedSegments = preserveEffectFields(autoMatchSegments(allAssets, finalTimedSegments), previousSegments);` ([App.tsx:1582–1585](../src/App.tsx#L1582-L1585)).
   - **`setProject(prev => ({ ...prev, script, sceneDetails, ..., assets: allAssets, voiceoverId: newVoiceoverId, segments: committedSegments }));`** ([App.tsx:1588–1599](../src/App.tsx#L1588-L1599)) — the single atomic commit.

### Is this really "clean-slate"? Verified against the actual code — not fully

CLAUDE.md describes this as a clean-slate rebuild. The code confirms the *timing* math genuinely is: `anchorStart`/`startTime`/`duration` are always recomputed fresh from `parseProjectData` + `applyAnchorBasedTiming`/Whisper alignment, never carried over from the old segment at the same index (`VideoSegment.anchorStart` doc comment: "Under clean-slate re-sync this is NOT preserved across re-syncs", [types.ts:190–191](../src/types.ts#L190-L191)). New segment `id`s are always freshly minted (`crypto.randomUUID()`, [App.tsx:372](../src/App.tsx#L372)), so nothing downstream can key off the old id either.

But two carry-forward mechanisms are real, and neither is timing-related:

1. **Headings** are captured from `previousSegments` (the pre-sync array) via `computeHeadingAnchors` and spliced back in via `reinsertHeadings` — this is the array's *only* record of headings (per the Step 5 "array-only" design), so if this carry-forward didn't happen, every Apply Sync would silently delete all headings. This is by design and documented.
2. **Effects Tab slug fields** — `preserveEffectFields` ([App.tsx:483–519](../src/App.tsx#L483-L519)) copies `effectTransition`, `effectTransitionDuration`, `effectAnimation`, `effectAnimationDuration`, `effectOverlay` from a previous segment onto a new one, matched by an `assetId` that must be unique on both the old and new arrays (ambiguous/duplicate assetIds are explicitly skipped, "fail safe" per the function's own doc comment). **These are not cosmetic bookkeeping fields** — they are read as higher-priority overrides of the legacy `transition`/`animation`/`overlayFilter` enum fields by:
   - `transitionResolver.ts:28` — `if (segment?.effectTransition && segment.effectTransition !== TRANSITION_NONE) { transition: segment.effectTransition, ... }`
   - `frameRenderer.ts:479–480` — `effectiveAnimation = (segment.effectAnimation && segment.effectAnimation !== 'none') ? segment.effectAnimation : ...`
   - `plainSegment.ts:99` — an `effectAnimation` disqualifies the Tier-1 fast export path.

   So a re-sync does **not** wipe a segment's applied transition/animation/overlay effect if that segment's asset survives the re-sync unambiguously — this materially affects preview and export output, not just UI state, and is a real exception to "everything gets wiped and rebuilt."

### From `project.segments` to on-screen pixels — [Timeline.tsx](../src/components/Timeline.tsx)

`<Timeline segments={project.segments} ... />` ([App.tsx:2319–2321](../src/App.tsx#L2319-L2321)).

Zoom/scale factor:
```ts
const pixelsPerSecond = useMemo(() => {
  const totalDur = segments.reduce((acc, s) => acc + s.duration, 0) || 1;
  const width = containerWidth || 800;
  const ppsMin = Math.min((width * 0.95) / totalDur, 100);
  const ppsMax = 100;
  if (ppsMin >= ppsMax) return ppsMax;
  return ppsMin * Math.pow(ppsMax / ppsMin, sliderT);
}, [sliderT, containerWidth, segments]);
```
[Timeline.tsx:96–103](../src/components/Timeline.tsx#L96-L103)

Each segment's row width:
```ts
style={{
  width: `${s.duration * pixelsPerSecond}px`,
  height: '80px',
  ...
}}
```
[Timeline.tsx:355–363](../src/components/Timeline.tsx#L355-L363) — this is the literal answer: **pixel width = `segment.duration` (seconds) × `pixelsPerSecond`**.

Notably, individual segment divs carry **no explicit `left`/position style** — they're rendered inside a plain flex row (`<div className="flex h-full items-stretch">`, [Timeline.tsx:318](../src/components/Timeline.tsx#L318)) via `segments.map((s, i) => ...)`, so their left-to-right screen position is an emergent property of array order + preceding widths, not a direct read of `s.startTime`. (`s.startTime` is used elsewhere in this file — e.g. for the playhead position `left: currentTime * pixelsPerSecond` at [Timeline.tsx:306](../src/components/Timeline.tsx#L306), and for computing which waveform slice belongs under each segment at [Timeline.tsx:472](../src/components/Timeline.tsx#L472) — but not for the visual track's own layout.) This means the visual track's segment order is implicitly trusted to match `project.segments` array order (which does match `order: i` as assigned by `parseProjectData`, since nothing reorders the array independently of that field in this chain).

---

## 5. Worked Example

Concrete trace for `sceneDetails` containing exactly:
```
[IMAGE: reference-sample.jpg]
Some voiceover script line here.
```
assuming one asset was uploaded and named exactly `reference-sample.jpg`, and (for illustration only — not derived from any real file) the synced voiceover audio is 6.0 seconds long.

**1. Splitting.** `TAG_REGEX.split(sceneDetails)` — verified with `node -e` that a match at string-position-0 does not produce a spurious empty leading element — yields one block: the entire string. `rawDetails = [the whole string]`.

**2. Tag/description split.** Lines of that block: `["[IMAGE: reference-sample.jpg]", "Some voiceover script line here."]`. `tag = "[IMAGE: reference-sample.jpg]"`, `description = "Some voiceover script line here."`. `scenes = [{ tag, description }]`.

**3. Heading check.** `/^\[HEADING\s*:/i.test("[IMAGE: reference-sample.jpg]")` → `false`. Not skipped.

**4. Text.** `text = "Some voiceover script line here."` (non-empty, so no fallback to the separate `script` field is needed).

**5. Filename extraction.** `detail = "[IMAGE: reference-sample.jpg]"`. `specificMatch = detail.match(/\[(?:IMAGE|VIDEO|HEADING):\s*(.*?)\s*\]/i)` → matches; `specificMatch[1] = "reference-sample.jpg"`. So `name = "reference-sample.jpg"`, `hasExplicitTagName = true`.

**6. Asset matching.** `matchingAssets = assets.filter(a => isFuzzyMatch("reference-sample.jpg", a.name))`. Inside `isFuzzyMatch`: both strings lowercase to `"reference-sample.jpg"`; the bracket-strip replace does nothing (no `[` present in a bare filename); the extension-strip replace removes `.jpg` from both → `s = t = "reference-sample"` → `t === s` is `true` on the very first check. `matchingAssets = [<the uploaded asset>]`. `usedAssetIdsTotal` is empty, so `unusedAsset` = that asset. `current.assetId = "<that asset's id>"` (illustratively `"abc123"`); `usedAssetIdsTotal = {"abc123"}`. The `findAssetByContext` fallback at [App.tsx:328](../src/App.tsx#L328) is skipped (`current.assetId` is already set).

**7. `rawSegments`** = one `RawSegment`: `{ text: "Some voiceover script line here.", transition: NONE, animation: NONE, playbackSpeed: 1, trimStart: 0, extraOverlays: [], assetId: "abc123" }`.

**8. Duration.** `textBearingScenes` = this one segment (only text-bearing scene). `voDuration = 6.0` (the assumed real audio duration, since `voiceoverDuration > 0`). `textBudget = 6.0`. `totalTextLength` = this segment's own `text.length` (whatever that character count is — call it `L`). `weight = L / L = 1`. `targetDuration = 1 * 6.0 = 6.0`. **With exactly one text-bearing scene, the character-weighting is trivially 1.0 regardless of the actual character count** — the interesting proportioning math only shows up with 2+ scenes. The last-segment clamp ([App.tsx:387–389](../src/App.tsx#L387-L389)) independently also forces `duration = voiceoverDuration - startTime = 6.0 - 0 = 6.0`, so both formulas agree here.

**9. Asset lookup for playback speed.** The matched asset's `type` is `'image'` (not `'video'`), so the `getMediaDuration`/`playbackSpeed` branch ([App.tsx:363–368](../src/App.tsx#L363-L368)) is skipped; `playbackSpeed` stays `1`, `sourceDuration` stays `undefined`.

**10. The `VideoSegment` returned by `parseProjectData`** (illustrative `id`):
```ts
{
  id: "<fresh crypto.randomUUID()>",
  text: "Some voiceover script line here.",
  assetId: "abc123",
  startTime: 0,
  duration: 6.0,
  anchorStart: 0,
  anchorSource: "estimate",
  trimStart: 0,
  playbackSpeed: 1,
  order: 0,
  transition: "none",
  animation: "none",
  showOverlay: false,
  extraOverlays: [],
  sourceDuration: undefined,
}
```

**11. Downstream timing (assuming the normal, cached-Whisper-tokens path).** `applyAnchorBasedTiming` on this single-element array: PASS 1 sees `anchorStart === 0`, so it's left alone; the main loop treats this segment as both first and last (`isLast = true`), so `nextAnchor = audioDuration = 6.0`, giving `startTime = 0`, `duration = 6.0` — unchanged. Then `alignFromCache` → `alignScenestoTranscript` does a real word-level match of `["some","voiceover","script","line","here"]` against the actual Whisper transcript tokens of the real audio and would normally move `t0`/`t1` to the real spoken boundaries — **but** `distributeSegmentTimes` feeds that into `applyAnchorBasedTiming` again, whose PASS 1 unconditionally re-pins the first segment's anchor to `0`, and whose last-segment rule re-pins its end to `audioDuration`. **For a single-segment project, the final on-screen segment therefore always spans the entire voiceover duration (0 to 6.0s) regardless of where Whisper actually detected speech starting/ending** — Whisper alignment only visibly changes anything once there are 2+ segments and it needs to place the boundary *between* them. `applyHeadingTiming` runs last and does nothing (this segment has neither `isHeading` nor a truthy `heading`).

**12. Headings/effects carry-forward.** For a brand-new project, `previousSegments = []`, so `computeHeadingAnceh` finds no headings to carry forward, and `preserveEffectFields` finds no matching previous segment for `assetId "abc123"` — both are no-ops here. (On a *second* Apply Sync of the same project, if `"abc123"` was still uniquely assigned, any `effectTransition`/`effectAnimation`/`effectOverlay` the user had applied to this scene would be copied onto the freshly-timed segment at this point.)

**13. Commit and render.** `setProject` lands this segment into `project.segments`. `Timeline.tsx` renders one segment `<div>` at `width: 6.0 * pixelsPerSecond`px, positioned first (only element in the flex row), labeled `#1`, with a live `<img src={asset.url}>` thumbnail of `reference-sample.jpg` (since the asset resolved and `type !== 'video'`, [Timeline.tsx:386–391](../src/components/Timeline.tsx#L386-L391)).

---

## Findings / Possible Issues

These are observations only — nothing below was changed.

1. **Inconsistent whitespace tolerance between the three tag regexes.** `TAG_REGEX` ([App.tsx:246](../src/App.tsx#L246)) and `isHeadingTag` ([App.tsx:281](../src/App.tsx#L281)) both tolerate a space before the colon (`\s*:`), but the filename-extraction regex `specificMatch` ([App.tsx:306](../src/App.tsx#L306)) does not (`:` with no preceding `\s*`). A tag like `[IMAGE : foo.jpg]` is recognized as a valid scene boundary but fails clean filename extraction and falls to the coarser `simpleMatch` bracket-slurp, which drags the literal `"IMAGE : "` prefix into the candidate name. I verified this still self-heals in practice for typical filenames via `isFuzzyMatch`'s substring-containment fallback (`s.includes(t)`), but that's incidental, not designed-in — a target name that happened to be short or generic could plausibly fail where a cleanly-extracted name would have matched.

2. **A space right after the opening bracket (`[ IMAGE: foo.jpg]`) is invisible to all three regexes.** Verified with `node -e`: if such a tag is the *only* tag in `sceneDetails`, the `scenes.length === 0` backup path ([App.tsx:260–272](../src/App.tsx#L260-L272)) rescues it as a single scene. But if it appears alongside other well-formed tags, `TAG_REGEX` simply never splits there — the malformed tag's line and its intended description silently become extra description text appended to whichever scene precedes it, with no warning surfaced anywhere.

3. **CLAUDE.md's "word count" description does not match the code.** `parseProjectData`'s duration formula ([App.tsx:344, 353–354](../src/App.tsx#L344)) weights by `s.text.length` — character count — not word count. In the common desktop flow this is largely moot in practice (see #4), but the doc and code disagree on the stated mechanism.

4. **The character-weighted duration is usually a throwaway seed, not the shipped value, but the code doesn't say so anywhere visible to a reader of `parseProjectData` alone.** Because Apply Sync is gated behind transcription completion (`applySyncDisabled`, [App.tsx:1827](../src/App.tsx#L1827)), the real on-screen timing almost always comes from `alignScenestoTranscript`'s word-level Whisper alignment, not the character-weight numbers `parseProjectData` computes. Someone reading only `parseProjectData` (as the task prompt itself assumes one might) would reasonably conclude character-weighting is *the* timing mechanism; it's actually a fallback-of-a-fallback in the normal desktop flow.

5. **`applyHeadingTiming` appears to be dead code in the Apply Sync commit chain specifically.** It's called twice per Apply Sync run — directly at [App.tsx:1574](../src/App.tsx#L1574), and internally inside `alignFromCache` at [useWhisper.ts:49](../src/hooks/useWhisper.ts#L49) — but both calls operate on `contentOnly`/its descendants, which is filtered to exclude `isHeading` segments at [App.tsx:1540](../src/App.tsx#L1540), and `parseProjectData` never sets `isHeading` or `heading` on anything it produces. `applyHeadingTiming`'s own heading-detection predicate (`!seg.isHeading && !(seg.heading && !seg.text)`, [whisperService.ts:314](../src/services/whisperService.ts#L314)) can therefore never be true for any element passing through this specific chain — heading duration in the shipped Apply Sync path is governed entirely by `reinsertHeadings`' own steal-duration math, which runs afterward. (The function is *not* dead in general — it has a live call site in the separate live-retranscription flow at [useWhisper.ts:167](../src/hooks/useWhisper.ts#L167) — just apparently redundant in this particular chain.)

6. **"Clean-slate" is a partial description.** Two real carry-forward paths survive Apply Sync: headings (via `computeHeadingAnchors`/`reinsertHeadings`, by design) and the five Effects-Tab slug fields (`effectTransition`/`effectTransitionDuration`/`effectAnimation`/`effectAnimationDuration`/`effectOverlay`, via `preserveEffectFields`, [App.tsx:483–519](../src/App.tsx#L483-L519)), keyed on a unique-both-sides `assetId` match. The latter is not merely UI bookkeeping — `transitionResolver.ts`, `frameRenderer.ts`, and `plainSegment.ts` all treat these slug fields as higher-priority than the legacy `transition`/`animation` enums, so they change actual preview/export output. There's also a third, cruder non-wipe: if `parseProjectData` returns zero segments while the project already has some, Apply Sync silently no-ops and keeps the old segments ([App.tsx:1529–1533](../src/App.tsx#L1529-L1533)).

7. **Multiple fuzzy-match candidates are resolved by array order, not similarity.** [App.tsx:319–321](../src/App.tsx#L319-L321): `matchingAssets.find(a => !usedAssetIdsTotal.has(a.id)) ?? matchingAssets[0]`. Two similarly-named uploaded assets are disambiguated purely by upload order (whichever appears earlier in `project.assets`), with no score comparison. When the unused pool is exhausted, a duplicate assignment across two segments is possible and is only surfaced via `console.warn` ([App.tsx:404–414](../src/App.tsx#L404-L414)) — nothing in the UI flags it.

8. **`isFuzzyMatch`'s extension whitelist is narrow:** `jpg|jpeg|png|mp4|mov|wav|mp3|zip` ([syncEngine.ts:11–12](../src/services/syncEngine.ts#L11-L12)). Common formats like `.webp`, `.gif`, `.webm`, `.m4a`, and `.avi` aren't stripped before comparison, though the substring-containment fallback (rule 4 in Section 2) often masks this in practice.
