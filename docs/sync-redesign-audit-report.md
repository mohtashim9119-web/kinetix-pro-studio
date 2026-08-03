# Sync Pipeline — Structural Audit Report

> **Point-in-time audit** (2026-08-03). Findings absorbed into
> `docs/sync-pipeline-v2-plan.md`; retained here as raw evidence, not a live
> plan. Re-verified 2026-08-03: no `file:line` citation in this report cites
> a source file that changed between this report's audit date and current
> HEAD (`d09a976`) — see `docs/audit-verification-2026-08-03.md` (verified
> against HEAD `8587cac`, itself a docs-only-commits ancestor of `d09a976`).

**Purpose:** Read-only structural audit of the sync pipeline (Apply Sync → committed segment timing) to support a future pipeline redesign. No files were modified as part of this audit.

**Scope:** [App.tsx](../src/App.tsx) (`handleApplySyncFromFiles` and its module-level helpers), [hooks/useWhisper.ts](../src/hooks/useWhisper.ts), [services/whisperService.ts](../src/services/whisperService.ts), [services/snapBoundaries.ts](../src/services/snapBoundaries.ts), [services/syncEngine.ts](../src/services/syncEngine.ts), [services/syncContracts.ts](../src/services/syncContracts.ts), [services/syncLog.ts](../src/services/syncLog.ts), [services/syncConstants.ts](../src/services/syncConstants.ts), [services/silenceDetector.ts](../src/services/silenceDetector.ts), [services/boundaryQuality.ts](../src/services/boundaryQuality.ts), [types.ts](../src/types.ts).

Date of audit: 2026-08-03. Branch: `webgl2-effects-engine`.

---

## 1. Pipeline Execution Map

Apply Sync is a single async handler, `handleApplySyncFromFiles` ([App.tsx:2206](../src/App.tsx#L2206)), invoked from the DropZonePanel "Apply Sync" button (`onApplySync` prop, [App.tsx:3515](../src/App.tsx#L3515)). It is the *only* sync entry point — there is no separate "re-sync" code path; the same function runs on first sync and every subsequent one, branching internally on whether a cached Whisper transcript exists.

### 1.1 Top-level call graph

```
handleApplySyncFromFiles(staged: StagedFiles)                         [App.tsx:2206]
│
├─ 1. Read staged script/scene text (RTF-stripped)                    [App.tsx:2236]
│
├─ 2. Persist staged files → assets[] (IndexedDB via putAsset)        [App.tsx:2243-2302]
│      - voiceover asset (dedup/replace old voiceover)
│      - image/video assets (dedup by filename)
│      - zip extraction → extractZipToAssets()
│
├─ 3. resolveVoiceoverDuration(voiceoverAsset)                        [App.tsx:186, 2309]
│      → native ffmpeg probe (Tauri IPC `probe_audio_duration`)
│      → THROWS on failure ⇒ hard abort, logSyncAbort(), return       [App.tsx:2310-2321]
│
├─ 4. parseProjectData(scriptText, sceneText, allAssets, audioDuration) [App.tsx:311, 2326]
│      - splits sceneDetails on bracket-tag boundaries (TAG_REGEX)
│      - exact / contiguous-word / fuzzy asset matching per scene
│      - character-weight duration proportioning (voDuration * charWeight)
│      - per-segment anchorStart = character-weight bootstrap, anchorSource='estimate'
│      → produces newSegmentsRaw: VideoSegment[]
│
├─ 5. emptySceneDocAbortMessage(newSegmentsRaw.length)                 [App.tsx:677]
│      → 0 segments ⇒ hard abort (WS1b, doc §3.11(b))                 [App.tsx:2332-2339]
│
├─ 6. cachedTokensReady? check                                        [App.tsx:2346-2350]
│      (voiceoverAsset id/file-identity matches project.lastTranscribedAssetId
│       /lastTranscribedFileIdentity AND project.transcriptTokens non-empty)
│
├─ 7. emptyTranscriptAbortMessage(hasVoiceover, transcriptTokenCount)  [App.tsx:684, 2356-2365]
│      → voiceover staged but 0 cached tokens ⇒ hard abort
│
├─ 8. BRANCH A — cachedTokensReady === true (normal path)              [App.tsx:2386-2537]
│  │
│  ├─ 8a. applyAnchorBasedTiming(newSegmentsRaw, audioDuration)        [syncEngine.ts:174]
│  │       → anchorTimed: re-derives startTime/duration from
│  │         each segment's own anchorStart (character-weight bootstrap)
│  │
│  ├─ 8b. alignFromCache(voiceoverAsset, anchorTimed, transcriptTokens, audioDuration)
│  │       = useWhisper.ts's alignSegmentsFromCachedTranscript()       [useWhisper.ts:66]
│  │       │
│  │       ├─ fetchAndDetectSilences(audioAsset)                       [useWhisper.ts:24]
│  │       │    → detectSilences(blob)                                 [silenceDetector.ts:37]
│  │       │      (Web Audio API RMS/dB scan; NEVER throws — returns
│  │       │       {status:'ok'|'error'})
│  │       │
│  │       ├─ filterMalformedTokens(tokens, durationSecs)              [whisperService.ts:1291]
│  │       │    → drops non-finite / negative-start / inverted /
│  │       │      past-audio-end / empty-text tokens
│  │       │    → usableTokens (THE array every downstream stage must use)
│  │       │
│  │       ├─ alignScenestoTranscript(segments, usableTokens, silences, audioDuration)
│  │       │      [whisperService.ts:1345]
│  │       │   │
│  │       │   ├─ extractSegmentAlignments(segments, tokens, audioDuration)
│  │       │   │      [whisperService.ts:784]
│  │       │   │   │
│  │       │   │   ├─ tokenize scene-doc (normalizeSceneDoc) + transcript
│  │       │   │   │    (normalize) into word sequences
│  │       │   │   ├─ alignQueryToSubject(queryWords, subjectWords)     [whisperService.ts:320]
│  │       │   │   │    → semi-global Hirschberg diff (Needleman-Wunsch +
│  │       │   │   │      linear-space divide & conquer traceback), ONE
│  │       │   │   │      GLOBAL pass over the whole document
│  │       │   │   ├─ per-segment extraction of matchedCount/firstSub/lastSub
│  │       │   │   │    from the global matchedSubjectOf array
│  │       │   │   ├─ hasQualifyingRun(totalWords, matchedCount, occ)   [whisperService.ts:723]
│  │       │   │   │    (computeLongestRunWithHoles + density fallback
│  │       │   │   │     isLocallyClustered)
│  │       │   │   ├─ IF NOT qualifying AND seg.anchorStart defined:
│  │       │   │   │    PER-SEGMENT TEMPORAL-BOUNDING RESCUE (3 passes):
│  │       │   │   │      Pass 1 — windowed Hirschberg + exact-text scan,
│  │       │   │   │               bounded to [anchorStart-tol, nextAnchor+tol]
│  │       │   │   │      Pass 2 — unbounded exact-text scan, document order,
│  │       │   │   │               over ALL unclaimed tokens
│  │       │   │   │      Pass 3 — sub-word CONCATENATION match
│  │       │   │   │               (findConcatenatingMatches, up to
│  │       │   │   │               MAX_CONCAT_TOKENS touching tokens)
│  │       │   │   │    each pass gated by the forward-ordering bound
│  │       │   │   │    (computeForwardBoundStartSec / exceedsForwardBound)
│  │       │   │   │    and by globallyClaimed (never steals another
│  │       │   │   │    segment's true global match)
│  │       │   │   └─ shouldAdopt = wasZeroMatch || hasQualifyingRun(candidate)
│  │       │   │        → AlignResult[] (t0,t1,firstTokenIdx,lastTokenIdx,
│  │       │   │          confidence,matched,matchedWords,totalWords,
│  │       │   │          longestRun,audioRegion?,recoveredVia?,recoveredRegion?)
│  │       │   │
│  │       │   ├─ Step 2 — override each unlocked segment's t1 with the
│  │       │   │    NEXT segment's t0 (before gap-fill)                [whisperService.ts:1364]
│  │       │   │
│  │       │   ├─ Gap-fill (3-pass, full-array):                       [whisperService.ts:1410-1531]
│  │       │   │    Pass 1 — per-pair computeBoundarySearchWindow +
│  │       │   │             candidacy filter (fillsTokenGapWithinSpan,
│  │       │   │             isBreathSilence, isBoundarySilenceCandidate)
│  │       │   │    Pass 2 — contention-aware silence ASSIGNMENT
│  │       │   │             (closest-spoken-midpoint wins; ties→later pair)
│  │       │   │    Pass 3 — left-to-right resolve: silence-centre boundary,
│  │       │   │             else token-midpoint fallback; monotonic clamp
│  │       │   │
│  │       │   └─ clamp last segment's t1 to audioEnd
│  │       │        → SegmentAlignment[] (= AlignResult[]) returned as `aligned.segments`
│  │       │          (this file also returns this as `coverage`, same array)
│  │       │
│  │       ├─ distributeSegmentTimes(segments, alignments)             [whisperService.ts:1648]
│  │       │    → writes startTime/duration/anchorStart(='whisper')
│  │       │      per non-locked segment from each alignment's {t0,t1}
│  │       │
│  │       └─ applyAnchorBasedTiming(updated, durationSecs)  (AGAIN)    [syncEngine.ts:174]
│  │            → re-derives startTime/duration from the now-whisper-
│  │              tagged anchors (click-1==click-2 normalization)
│  │            → returns { segments: final, coverage: alignments,
│  │                silences, tokens: usableTokens, silenceError?,
│  │                malformedTokenCount, totalTokenCount }
│  │
│  ├─ 8c. countTranscriptWords(transcriptTokens)                       [whisperService.ts:1590]
│  ├─ 8d. evaluateCoverageGate(aligned.segments, aligned.coverage, totalTranscriptWords)
│  │       [App.tsx:704] → computeCoverageSummary()                    [whisperService.ts:1614]
│  │       R13 two-signal abort: longestCoveredRun < MIN_COVERED_RUN_LENGTH (2)
│  │                          OR bidirectionalCoverage < NOISE_FLOOR_COVERAGE (0.1)
│  │       → ABORT (full mismatch) ⇒ logSyncAbort(), return            [App.tsx:2405-2411]
│  │
│  ├─ 8e. filterToCoveredSegments(aligned.segments, aligned.coverage)  [App.tsx:803]
│  │       → { kept, skipped, keptAlignments }
│  │       keep test: alignment.matched === true (NOT a confidence
│  │       threshold — see §3/§5)
│  │
│  ├─ 8f. rescue-observability harvesting (aligned.coverage[i].recoveredVia)
│  │       → rescued: RescuedSegmentRecord[]                            [App.tsx:2437-2448]
│  │
│  ├─ 8g. validateWordCoverage(kept, keptAlignments)                    [syncContracts.ts:420]
│  │       → wordCoverageViolations (Contract 3→4, 'low-word-coverage')
│  │       → buildGroupedViolationEntry()                               [syncLog.ts:208]
│  │
│  ├─ 8h. stage pendingLogEntries / pendingLogSummary                   [App.tsx:2480-2499]
│  │       (silence-error, malformed-token, skip×N, rescue×N,
│  │        word-coverage-group, sync-info summary)
│  │
│  ├─ 8i. BOUNDARY RE-SNAP (covered-only, "middle-gap" fix):            [App.tsx:2521-2531]
│  │       transcriptTokens = aligned.tokens (the MALFORMED-FILTERED array)
│  │       transcriptTokens.length > 0
│  │         ? snapCoveredBoundaries(kept, keptAlignments, transcriptTokens,
│  │                                 aligned.silences, audioDuration)   [snapBoundaries.ts:653]
│  │         : retileCoveredSegments(kept, audioDuration)               [App.tsx:860]  (fallback)
│  │       → finalTimedSegments
│  │       (also captures pendingBoundaryCheckInput for the post-hoc
│  │        boundary-quality checker, step 10 below)
│  │
│  └─ 8j. headExtendFirstSegment(finalTimedSegments)                    [syncEngine.ts:298]
│          → stretches segment 0's startTime back to 0 (absorbs lead-in
│            silence) without moving its END
│
├─ 9. BRANCH B — cachedTokensReady === false (defensive fallback)      [App.tsx:2538-2576]
│       finalTimedSegments = applyAnchorBasedTiming(newSegmentsRaw, audioDuration)
│       (character-weight timing only — no audio alignment at all;
│        logs a 'warning' entry if a voiceover exists in Tauri, since
│        this branch "should be unreachable" under correct button gating)
│
├─ 10. autoMatchSegments(allAssets, finalTimedSegments)                 [syncEngine.ts:311]
│       → fuzzy/context asset (re-)matching for segments with no assetId
│     preserveEffectFields(..., previousSegments)                       [App.tsx, module-level]
│       → carries effectTransition/effectAnimation/effectGrade/etc.
│         forward by matching assetId against the PREVIOUS segments array
│     → committedSegments: VideoSegment[]
│
├─ 11. buildNoAssetSummaryEntry(...) if any committed segment has no assetId
│       [App.tsx:2589-2596]
│
├─ 12. SINGLE setProject(prev => ({ ...appendSyncLogEntries(...), segments:
│        committedSegments, assets: allAssets, voiceoverId, script,
│        sceneDetails, headings: clampHeadingsToDuration(...) }))       [App.tsx:2601-2616]
│        ⇐ THE COMMIT POINT — timing is fully resolved before this call
│
├─ 13. setIsSynced(true); setSyncStep(4)                                [App.tsx:2625-2626]
│
├─ 14. buildVoiceoverWaveform(voiceoverAsset)  (async, post-commit)     [App.tsx:2634]
│       → waveform peaks (used for playback UI, and for step 15 below)
│
└─ 15. POST-HOC boundary-quality check (read-only, never re-mutates timing):
        if pendingBoundaryCheckInput:
          validateBoundaryQuality(committedSegments, alignments, tokens,
                                   silences, resolvedWaveform, K, window)
            [syncContracts.ts:256] → findQuietestRegion()              [boundaryQuality.ts:58]
          → buildGroupedViolationEntry(..., 'info')                     [syncLog.ts:208]
          → second setProject() appending only log entries              [App.tsx:2688-2690]
```

### 1.2 Key branch/fallback summary

| Condition | Effect |
|---|---|
| Voiceover duration probe throws | Hard abort, no commit (`logSyncAbort`) |
| `parseProjectData` → 0 segments | Hard abort |
| Voiceover staged but 0 cached transcript tokens | Hard abort |
| `evaluateCoverageGate` trips (full mismatch) | Hard abort |
| `cachedTokensReady === false` (no cached Whisper transcript, voiceover present, Tauri) | Falls back to **character-weight timing only** (`applyAnchorBasedTiming` on raw segments) — logged as `'warning'`, described in-code as "should be unreachable" |
| Per-segment `matched === false` (`filterToCoveredSegments`) | Segment is **dropped** from the timeline entirely (skip, not interpolated) |
| `transcriptTokens.length === 0` after malformed-token filtering, on the Whisper path | Falls back to `retileCoveredSegments` (plain arithmetic re-tile) instead of `snapCoveredBoundaries` |
| Silence detection fails (`detectSilences` → `status:'error'`) | Boundaries fall back to **token midpoints** instead of acoustic silence centers; logged as `'silence-error'` |
| No silence candidate survives the 3 candidacy predicates for a pair | `snapCoveredBoundaries`/`alignScenestoTranscript` fall back to the **plain spoken-edge midpoint** (`(lastSpokenEnd + nextSpokenStart) / 2`) |
| Boundary goes monotonically backwards | Falls back to the token-midpoint, then (if still backwards) clamps to `prevBoundary` |
| Pair's spoken edges inverted > `DEGENERATE_PAIR_INVERSION_THRESHOLD_SEC` (5.0s) | `snapCoveredBoundaries` skips writing that boundary entirely (leaves upstream timing untouched) — **not** mirrored in `alignScenestoTranscript`'s own gap-fill, which has no equivalent guard |

---

## 2. Stage Data Structures

### `TranscriptToken` — [types.ts:268](../src/types.ts#L268)
```ts
export interface TranscriptToken {
  startSec: number;
  endSec: number;
  text: string;
}
```

### `MalformedTokenFilterResult` / `TokenDrop` — [whisperService.ts:1251](../src/services/whisperService.ts#L1251)
```ts
export interface TokenDrop {
  index: number;                 // position in the RAW pre-filter tokens array
  reason: 'non-finite' | 'negative-start' | 'inverted-or-zero-duration'
        | 'past-audio-end' | 'empty-text';
  startSec: number;
  endSec: number;
  text: string;
}

export interface MalformedTokenFilterResult {
  tokens: TranscriptToken[];     // the array every LATER stage must use
  skippedCount: number;
  totalTokens: number;           // pre-filter count (denominator for logs)
  drops: TokenDrop[];
}
```

### `TokenAlignmentOp` / `TokenAlignment` — [whisperService.ts:141](../src/services/whisperService.ts#L141)
```ts
export interface TokenAlignmentOp {
  type: 'match' | 'sub' | 'del';
  qi: number;   // query (scene-doc) word index
  sj: number;   // subject (transcript) word index for match/sub; -1 for del
}

export interface TokenAlignment {
  ops: TokenAlignmentOp[];
  matchedSubjectOf: Int32Array;   // query i -> subject index iff true match, else -1
  score: number;                  // optimal semi-global alignment score
}
```

### `AlignResult` (aliased as `SegmentAlignment`) — [whisperService.ts:383](../src/services/whisperService.ts#L383)
```ts
export interface AlignResult {
  t0: number;
  t1: number;
  firstTokenIdx: number;          // -1 if none
  lastTokenIdx: number;           // -1 if none
  confidence: number;             // matchedWords / totalWords
  matched: boolean;                // hasQualifyingRun() decision, NOT matchedCount>0
  matchedWords: number;
  totalWords: number;
  longestRun: number;              // longest qualifying-shape run (Bug C)
  audioRegion?: { startSec: number; endSec: number };
  recoveredVia?: 'windowed' | 'global' | 'concat';   // rescue provenance
  recoveredRegion?: { startSec: number; endSec: number };
}

export type SegmentAlignment = AlignResult;
```

### `OccEntry` (occupancy array, run-survival internal) — [whisperService.ts:573](../src/services/whisperService.ts#L573)
```ts
export type OccEntry = { start: number; end: number } | null;
```

### `CoveredSegmentFilter` / `SkippedSegmentRecord` — [App.tsx:758](../src/App.tsx#L758), [App.tsx:740](../src/App.tsx#L740)
```ts
export type SegmentSkipReason = 'no audio match';

export interface SkippedSegmentRecord {
  segmentIndex: number;   // index into the PRE-filter aligned array
  segmentText: string;
  reason: SegmentSkipReason;
  segmentTag?: string;
  matchedWords?: number;
  totalWords?: number;
  confidence?: number;
  longestRun?: number;
}

export interface CoveredSegmentFilter {
  kept: VideoSegment[];
  skipped: SkippedSegmentRecord[];
  keptAlignments: SegmentAlignment[];   // index-parallel with `kept`
}
```

### `BoundarySearchWindow` / `GapFillPairPlan` / `PairPlan` — [snapBoundaries.ts:304](../src/services/snapBoundaries.ts#L304), [whisperService.ts:1403](../src/services/whisperService.ts#L1403), [snapBoundaries.ts:670](../src/services/snapBoundaries.ts#L670)
```ts
export interface BoundarySearchWindow {
  spokenMid: number;
  spokenGapWidth: number;
  searchStart: number;
  searchEnd: number;
}

// whisperService.ts's alignScenestoTranscript gap-fill (module-local):
interface GapFillPairPlan {
  lastSpokenEnd: number;
  nextSpokenStart: number;
  spokenMid: number;
  overlapping: SilenceInterval[];
}

// snapBoundaries.ts's snapCoveredBoundaries (module-local):
interface PairPlan {
  lastSpokenEnd: number;
  nextSpokenStart: number;
  spokenMid: number;
  spokenGapWidth: number;
  searchStart: number;
  searchEnd: number;
  overlapping: SilenceInterval[];
}
```

### `SilenceInterval` / `SilenceDetectResult` — [silenceDetector.ts:1](../src/services/silenceDetector.ts#L1)
```ts
export interface SilenceInterval {
  startSec: number;
  endSec: number;
}

export type SilenceDetectResult =
  | { status: 'ok'; silences: SilenceInterval[] }
  | { status: 'error'; errorMessage: string };
```

### `AlignFromCacheResult` — [useWhisper.ts:40](../src/hooks/useWhisper.ts#L40)
```ts
export interface AlignFromCacheResult {
  segments: VideoSegment[];
  coverage: SegmentAlignment[];
  silences: SilenceInterval[];
  tokens: TranscriptToken[];     // MALFORMED-FILTERED — coverage[i].firstTokenIdx/lastTokenIdx index into THIS
  silenceError?: string;
  malformedTokenCount: number;
  totalTokenCount: number;
}
```

### `VideoSegment` (timing-relevant fields only) — [types.ts:171](../src/types.ts#L171)
```ts
export interface VideoSegment {
  id: string;
  text: string;
  assetId?: string;
  startTime: number;
  duration: number;
  locked?: boolean;
  anchorStart?: number;
  anchorSource?: 'whisper' | 'estimate';
  unmatchedExplicitTag?: boolean;
  tag?: string;
  // ...plus transition/animation/overlay/effect* fields, not timing-relevant
}
```

### `ContractViolation` / `BoundaryQualityMeasurement` — [syncContracts.ts:33](../src/services/syncContracts.ts#L33), [syncContracts.ts:205](../src/services/syncContracts.ts#L205)
```ts
export interface ContractViolation {
  contract: '1->2' | '2->3' | '3->4' | '4->5' | '5->6' | '6->7';
  rule: string;
  severity: 'warning' | 'error';
  message: string;
  fixHint: string;
  detail?: Record<string, unknown>;
}

export interface BoundaryQualityMeasurement {
  segmentIndex: number;
  boundaryTime: number;
  boundaryAmplitude: number;
  quietestTime: number | undefined;
  quietestAmplitude: number | undefined;
  windowStart: number;
  windowEnd: number;
  flagged: boolean;
}
```

### `SyncLogEntry` / `SyncRunSummary` — [types.ts:375](../src/types.ts#L375), [types.ts:456](../src/types.ts#L456)
(See file for full field list — `type`, `syncRunId`, per-skip fields `matchedWords`/`totalWords`/`confidence`/`longestRun`, `severity`/`fixHint`/`groupedItems` for contract-violation-derived entries.)

---

## 3. Picker & Window Logic (snapBoundaries.ts)

### `computeBoundarySearchWindow` — [snapBoundaries.ts:330](../src/services/snapBoundaries.ts#L330)
```ts
export function computeBoundarySearchWindow(
  lastSpokenEnd: number,
  nextSpokenStart: number,
  currFirstSpokenStart: number,
  nextLastSpokenEnd: number,
): BoundarySearchWindow {
  const spokenMid = (lastSpokenEnd + nextSpokenStart) / 2;
  const spokenGapWidth = nextSpokenStart - lastSpokenEnd;
  const searchRadius = spokenGapWidth < 0.1
    ? 1.0
    : Math.max(0.5, spokenGapWidth / 2 + 0.4);
  const searchStart = Math.max(spokenMid - searchRadius, currFirstSpokenStart);
  const searchEnd = Math.min(spokenMid + searchRadius, nextLastSpokenEnd);
  return { spokenMid, spokenGapWidth, searchStart, searchEnd };
}
```
- Window is centered on the **midpoint of the two spoken edges**, radius-clamped: `max(0.5, gap/2 + 0.4)`, or fixed `1.0s` when the spoken gap is near-zero (`<0.1s`) — Whisper compresses adjacent-word timestamps in that case.
- The window is **hard-clamped** to `[currFirstSpokenStart, nextLastSpokenEnd]` — i.e. it can never reach past either segment's own outer spoken edge, which prevents a near-zero-gap pair from stealing a silence that belongs to a different (further) boundary.

### `isBoundarySilenceCandidate` — [snapBoundaries.ts:294](../src/services/snapBoundaries.ts#L294)
```ts
export function isBoundarySilenceCandidate(
  silence: SilenceInterval,
  searchStart: number,
  searchEnd: number,
): boolean {
  return silence.endSec > searchStart && silence.startSec < searchEnd;
}
```
- **Pure window-overlap** test only — as of the 2026-08-03 regression fix, there is deliberately **no** distance-from-spoken-edge tolerance test here (one existed previously — `BOUNDARY_SILENCE_INTRUSION_TOLERANCE_SEC`, now deleted from `syncConstants.ts` — and was found to reject genuine boundary silences on a real 173/174-segment project because trailing-word timestamps routinely blur past a fixed 0.3s tolerance).

### `snapCoveredBoundaries` — [snapBoundaries.ts:653](../src/services/snapBoundaries.ts#L653)
Three passes over the covered-only (`kept`) array, operating on `keptAlignments` (index-parallel):

1. **Pass 1 (per-pair plan)** — for each adjacent pair `(i, i+1)` not touching a locked segment: derive `lastSpokenEnd`/`nextSpokenStart`/`currFirstSpokenStart`/`nextLastSpokenEnd` from `tokens[align.lastTokenIdx].endSec` / `tokens[align.firstTokenIdx].startSec` (fallback `??` to the pristine segment's own `startTime`/`startTime+duration` if the index resolves to `undefined`); call `computeBoundarySearchWindow`; filter `silences` through **three composed predicates, in this order** (short-circuiting):
   - `!fillsTokenGapWithinSpan(...)` for curr's own span — alignment evidence, breath rejection
   - `!fillsTokenGapWithinSpan(...)` for next's own span
   - `!isBreathSilence(...)` for curr's own span (curr-side seam exemption **permanently disabled**, passes `-1`)
   - `!isBreathSilence(...)` for next's own span (next-side seam exemption **enabled**, passes `currAlign.lastTokenIdx`)
   - `isBoundarySilenceCandidate(s, searchStart, searchEnd)` — plain window overlap, tested **last**
   → stores `overlapping: SilenceInterval[]` per pair.

2. **Pass 2 (contention-aware assignment)** — every silence overlapped by 2+ pairs' windows is assigned to whichever pair's `spokenMid` it is numerically closest to (`dist <= best.dist` ⇒ later pair wins ties); a silence overlapped by exactly one pair goes to it unconditionally; a silence overlapped by none is simply unused.

3. **Pass 3 (left-to-right resolve)** — for each pair, in order:
   - **Degenerate-pair guard**: if `lastSpokenEnd - nextSpokenStart > DEGENERATE_PAIR_INVERSION_THRESHOLD_SEC` (5.0s, `= TEMPORAL_TOLERANCE_MAX_SEC`), **skip this pair's boundary write entirely** (leaves upstream timing untouched; `prevBoundary` is not advanced) — this is defense-in-depth against a false-positive rescue producing a multi-minute phantom boundary.
   - Pick the pair's own assigned candidate closest to `spokenMid` (closest-centre reduce), or fall back to `boundary = (lastSpokenEnd + nextSpokenStart) / 2` if it has none.
   - **Monotonic check**: if `boundary < prevBoundary`, recompute the plain midpoint fallback; if that fallback is *still* backwards, **clamp to `prevBoundary`** (2026-08-02 fix — closes a previously-open gap where a corrupted substituted midpoint could still commit backwards).
   - Write `curr.duration = round3(max(MIN_SEGMENT_DURATION(0.1), snapped - curr.startTime))`; `next.startTime = next.anchorStart = snapped`.
   - **Contiguity fixup**: if the `MIN_SEGMENT_DURATION` floor pushed `curr`'s end past `snapped`, advance `next.startTime`/`anchorStart` to `curr.startTime + curr.duration` so `startTime[i]+duration[i] === startTime[i+1]` always holds.

4. **Tail**: the last (non-locked) survivor's duration is set to `max(MIN_SEGMENT_DURATION, audioDuration - last.startTime)` — always runs to the true audio end.

`alignScenestoTranscript`'s own full-array gap-fill ([whisperService.ts:1345](../src/services/whisperService.ts#L1345)) is a **verbatim-ported duplicate** of the same 3-pass structure (Pass 1/2/3), using the same three candidacy predicates imported from `snapBoundaries.ts`, but operating on the FULL segment array (including unmatched/-1-sentinel segments) rather than the covered-only array. There is a documented "parity" claim between the two, pinned by a dedicated test, but they remain two independently-maintained call sites of the same logic rather than one shared function — see §5 for the divergences (degenerate-pair guard and the backward-monotonic re-check exist ONLY in `snapCoveredBoundaries`, not in `alignScenestoTranscript`'s gap-fill).

---

## 4. Token INDEX vs. TIMESTAMP Usage

The pipeline deliberately treats **token indices** (produced by the Hirschberg text-alignment pass) as more trustworthy than **token timestamps** (produced by Whisper's own model output) for certain classes of decision, because timestamps are documented to smear/blur by 100ms–900ms across real silence boundaries while indices are pure text-match artifacts unaffected by acoustic timing error.

### Decisions made by TOKEN INDEX (alignment evidence)

| Location | What it does |
|---|---|
| `fillsTokenGapWithinSpan` — [snapBoundaries.ts:426](../src/services/snapBoundaries.ts#L426) | Tests whether a silence sits between two **consecutive token indices** (`j`, `j+1`) both inside `[firstTokenIdx, lastTokenIdx]` of ONE segment's matched span — an index-range containment test, not a timestamp-distance test (the *interval* tested is `[firstTokenIdx, lastTokenIdx]`, an index range; the timestamps of `tokens[j]`/`tokens[j+1]` are only read to check that specific gap, not compared against a tolerance). |
| `isBreathSilence`'s **index-based seam exemption** — [snapBoundaries.ts:560](../src/services/snapBoundaries.ts#L560), lines 607-617 | The multi-fragment override's decision of "is this the preceding segment's seam, not my own breath" is made by comparing the silence's `startSec` against `tokens[otherSideLastTokenIdx].endSec` — but which token index is `otherSideLastTokenIdx` (`curr.lastTokenIdx` for a next-side call) is determined by the Hirschberg alignment, not by nearest-in-time search. The doc comment is explicit: *"Token INDICES, unlike token TIMESTAMPS, are never smeared… This exemption therefore re-poses the multi-fragment override's question in INDEX terms instead of timestamp terms."* |
| `extractSegmentAlignments`'s rescue **forward-ordering bound** — [whisperService.ts:837-905](../src/services/whisperService.ts#L837) | `computeForwardBoundStartSec`/`exceedsForwardBound` reject a rescue claim based on **document order** (index position in `tokenWords`, hence order of Hirschberg match), not distance in seconds — explicitly chosen over a distance/tolerance cap because a legitimate rescue can be 44s away while a false positive must be rejected regardless of distance. |
| `AlignResult.firstTokenIdx`/`lastTokenIdx` propagation | Every downstream consumer (`snapCoveredBoundaries`, `validateBoundaryQuality`, `boundaryUsedFallback`) reads spoken-edge **timestamps by looking them up through these indices** (`tokens[align.lastTokenIdx].endSec`) rather than storing timestamps directly on `AlignResult` — the index is the load-bearing identity; the timestamp is derived. |
| `globallyClaimed` set (rescue exclusivity) — [whisperService.ts:829-835](../src/services/whisperService.ts#L829) | A rescue may only claim a `tokenWords` index no other segment's global pass already matched — an index-set membership test, not a time-window test. |

### Decisions made by TOKEN TIMESTAMP (acoustic/temporal evidence)

| Location | What it does |
|---|---|
| `isBoundarySilenceCandidate` — [snapBoundaries.ts:294](../src/services/snapBoundaries.ts#L294) | Pure timestamp-window overlap: `silence.endSec > searchStart && silence.startSec < searchEnd`. |
| `computeBoundarySearchWindow` — [snapBoundaries.ts:330](../src/services/snapBoundaries.ts#L330) | Entirely timestamp arithmetic (`lastSpokenEnd`, `nextSpokenStart`, midpoint, radius). |
| `isBreathSilence`'s MOSTLY-EMPTY / MULTI-FRAGMENT branches (pre-seam-exemption) — [snapBoundaries.ts:560](../src/services/snapBoundaries.ts#L560), lines 578-605 | `extentOverlap`, `covered`, and the coverage `ratio` are all computed from `tok.startSec`/`tok.endSec` vs. `silence.startSec`/`silence.endSec` — timestamp arithmetic. The doc comment explicitly flags this as the *unreliable* half of the predicate that the index-based seam exemption was added to patch around. |
| Rescue window bounds (`windowStart`/`windowEnd`, `expectedStart`/`expectedEnd`, `temporalBonus`) — [whisperService.ts:992-1043](../src/services/whisperService.ts#L992) | Pass 1's bounded search and its Hirschberg temporal-proximity bonus are pure timestamp-window math (`seg.anchorStart`, `TEMPORAL_TOLERANCE_*` seconds). |
| Monotonic checks in both `snapCoveredBoundaries` and `alignScenestoTranscript`'s gap-fill | `boundary < prevBoundary` — a raw timestamp comparison. |
| `DEGENERATE_PAIR_INVERSION_THRESHOLD_SEC` guard — [snapBoundaries.ts:820](../src/services/snapBoundaries.ts#L820) | `lastSpokenEnd - nextSpokenStart > 5.0` — timestamp-seconds comparison. |
| `validateBoundaryQuality` / `findQuietestRegion` — [syncContracts.ts:256](../src/services/syncContracts.ts#L256), [boundaryQuality.ts:58](../src/services/boundaryQuality.ts#L58) | Waveform-amplitude-vs-time comparisons, entirely timestamp/time-column-indexed. |
| `filterMalformedTokens` — [whisperService.ts:1291](../src/services/whisperService.ts#L1291) | Every rejection rule (`negative-start`, `inverted-or-zero-duration`, `past-audio-end`) is a raw timestamp comparison. |

### The documented tension between the two

The codebase's own comments (see [snapBoundaries.ts:1-210](../src/services/snapBoundaries.ts#L1) header and [CLAUDE.md's DO-NOT-DO list](../CLAUDE.md)) explicitly call out that **classifying breath-vs-boundary from token timestamps alone is unreliable** (measured 100-900ms of Whisper smear across a real seam) and that this is *why* the index-based seam exemption exists — but the exemption is **NEXT-SIDE ONLY**; the symmetric CURR-side exemption was tried and permanently disabled (confirmed false-positive on two independent real production projects) because the only symmetric anchor available (the segment two positions back) has no temporal relationship to the tested silence. This is flagged in the code as *"not fixable by tuning"* — a structural asymmetry a redesign should treat as a known, accepted limitation rather than a bug to "complete."

---

## 5. Console-Only & Silent-Fallback Inventory

Entries below are grouped by whether they reach the user-facing sync log (`SyncLogEntry`/`SyncLogPanel`) or are DEV-console/`console.warn`-only with **no** corresponding log entry.

### 5.1 Fallbacks/clamps with NO user-facing log entry (console-only or fully silent)

| Location | Behavior |
|---|---|
| [snapBoundaries.ts:820-828](../src/services/snapBoundaries.ts#L820) — degenerate-pair guard | Silently **skips writing a boundary** for a pair whose spoken edges are inverted >5.0s; `console.warn` only inside `import.meta.env.DEV` (never shipped to production builds, never a `SyncLogEntry`). |
| [snapBoundaries.ts:849-874](../src/services/snapBoundaries.ts#L849) — monotonic-fallback re-check | Silently clamps a still-backwards substituted boundary to `prevBoundary`; `console.warn` only inside `import.meta.env.DEV`. |
| [whisperService.ts:1519-1524](../src/services/whisperService.ts#L1519) — `alignScenestoTranscript`'s own monotonic check | Silently substitutes the plain midpoint on a backwards boundary. **No console.warn at all here**, and — unlike `snapCoveredBoundaries` — **no second-level re-check**: if the substituted midpoint is itself still backwards, it is committed anyway (a documented, accepted gap per `snapBoundaries.ts`'s own header, since this full-array pass's output for covered pairs is normally superseded by `snapCoveredBoundaries` downstream). |
| [syncEngine.ts:196-202](../src/services/syncEngine.ts#L196) — `applyAnchorBasedTiming` out-of-order anchor detection | `console.warn('[anchor] out-of-order anchor…')` — **always fires** (not DEV-gated), but is purely diagnostic; the actual correction happens silently a few lines later (line 215-223, the "backstop monotonic clamp") which pulls an inflated anchor down to its successor with **no log entry and no warning of its own** — the warning above only fires for the detection pass, not the correction pass, so a corrected inversion is not user-visible at all. |
| [syncEngine.ts:298-309](../src/services/syncEngine.ts#L298) — `headExtendFirstSegment` | Silently stretches segment 0 back to t=0. No log entry of any kind — purely additive/invisible by design. |
| [App.tsx:2542-2548](../src/App.tsx#L2542) — Branch B "unexpected fallback" detection | `console.warn` fires only when `unexpectedFallback` is true; the log entry (`pendingLogEntries`) is emitted in **both** sub-cases (`'warning'` vs `'info'`) — this one IS surfaced to the user, but only as a single generic sentence, not per-segment. |
| [whisperService.ts:1200-1209](../src/services/whisperService.ts#L1200) — rescue recovery | `console.log('[align-recover] seg=…')` — **DEV-gated only** (`import.meta.env.DEV`); the *aggregate* fact that a rescue happened DOES reach the user via `buildRescueLogEntries` (App.tsx) → `'rescue'` SyncLogEntry, but the per-pass diagnostic detail (`recovered N/total via <pass> range=[...] anchor=... distance=...`) is DEV-console-only and never appears in the persisted log. |
| [whisperService.ts:227](../src/hooks/useWhisper.ts#L227) (`useWhisper.ts`) — empty Whisper token array on the STAGING transcription path | `console.warn('[whisper] empty token array received…')` plus a **transient** `TranscriptionStatus` UI banner (auto-dismissed after 8s) — not written to the persistent `SyncLogEntry` array at all, so it does not survive to be reviewed later the way other findings do. |
| [useWhisper.ts:312](../src/hooks/useWhisper.ts#L312) — stale alignment discard | `console.warn('[whisper] Discarding fresh transcription alignment — segment set no longer matches')` — **fully silent to the user**; no toast, no log entry. The transcription still reports `'done'` even though its result was discarded. |
| [useWhisper.ts:79](../src/hooks/useWhisper.ts#L79), [useWhisper.ts:88](../src/hooks/useWhisper.ts#L88) — `alignSegmentsFromCachedTranscript`'s own silence/malformed-token console.warns | These duplicate (via `console.warn`) findings that are *also* separately logged by the caller (`App.tsx`'s `pendingLogEntries`) via the returned `silenceError`/`malformedTokenCount` fields — redundant, not missing, but worth noting as duplicate reporting paths that could drift. |
| [App.tsx:422-427](../src/App.tsx#L422), [449-453](../src/App.tsx#L449) — `parseProjectData`'s duplicate/ambiguous tag-match warnings | `console.warn` only — **"diagnostic only, no UI surfacing"** per the code's own comment. A tag matching 2+ assets, or a contiguous-word match resolving ambiguously, is silently resolved (first match wins) or left unmatched, with no `SyncLogEntry` ever produced for either case. |
| [App.tsx:534-551](../src/App.tsx#L534) — `parseProjectData`'s duplicate-assetId-across-segments warning | `console.warn` only — "a data quality warning, not a hard error" per comment; never surfaced in the sync log UI. |
| [App.tsx:202](../src/App.tsx#L202) — `resolveVideoNativeFps` failure | `console.warn` only; silently leaves `nativeFps` undefined — affects export-fps auto-match suggestion, not sync timing, but is part of the same asset-ingestion path. |
| [App.tsx:2765-2767](../src/App.tsx#L2765) — DEV calibration harness (`__calibrateBoundaryQuality`) silence-detection failure | `console.warn` only; by design (DEV-only tool, never shipped, never logged to `SyncLogEntry`). |
| `whisperService.ts:1544` and `:368` — Hirschberg/pass-timing instrumentation | `console.log` gated behind `globalThis.__ALIGN_INSTRUMENT__` (opt-in, off by default) — intentionally invisible unless manually enabled; not part of the sync log. |

### 5.2 Fallbacks/clamps that DO reach the user-facing sync log

For contrast — these are correctly surfaced and are **not** part of the "silent" gap:

- Silence-detection failure → `'silence-error'` entry (buildSilenceErrorEntry).
- Malformed-token drops → `'malformed-token'` entry.
- Segment skipped (unmatched) → `'skip'` entry per segment.
- Rescue recovery (aggregate) → `'rescue'` entry per segment.
- No-asset committed segments → `'no-asset'` summary entry.
- Low word-coverage (Contract 3→4) → grouped `'warning'`-severity entry.
- Boundary-quality fallback-landed-on-loud-audio (Contract 5→6) → grouped `'info'`-severity entry (deliberately downgraded from the validator's own `'warning'` — Phase 1 is "observability only", per App.tsx's own comment at the wiring site).
- Full-mismatch abort, empty-scene-doc abort, empty-transcript abort, voiceover-duration-probe-failure abort → `'abort'` entry + toast.
- Character-weight-only fallback (Branch B) → `'warning'` or `'info'` entry (see above).

### 5.3 Notable duration/value clamps (not failures, but silent floors worth flagging for a redesign)

| Location | Clamp |
|---|---|
| `MIN_SEGMENT_DURATION = 0.1` — [snapBoundaries.ts:230](../src/services/snapBoundaries.ts#L230) | Engine-level floor on any computed segment duration. |
| `MIN_SEGMENT_DURATION = 0.3` — [App.tsx:302](../src/App.tsx#L302) | A **second, independent, unsynchronized** constant of the same name, display-only (resize-drag UX) — flagged as a "documented gap, not an oversight" in `syncConstants.ts`'s own header, but is exactly the kind of duplicated-constant risk a redesign should consolidate or explicitly re-affirm. |
| `distributeSegmentTimes`'s `Math.max(0.1, a.t1 - a.t0)` — [whisperService.ts:1656](../src/services/whisperService.ts#L1656) | A third independent literal `0.1` floor, not imported from either `MIN_SEGMENT_DURATION` constant above. |
| `retileCoveredSegments`'s degenerate-duration guard — [App.tsx:868-871](../src/App.tsx#L868) | If a recomputed duration would be `<= 0`, silently keeps the segment's **original** (pre-retile) duration instead — no log entry, no warning at all (not even DEV-gated). |
| `t1 = Math.max(t0 + 0.05, rawT1)` — [whisperService.ts:1192](../src/services/whisperService.ts#L1192) | Rescue-path minimum span floor (0.05s) — silent, no logging. |
| `applyAnchorBasedTiming`'s backstop monotonic clamp — [syncEngine.ts:215-223](../src/services/syncEngine.ts#L215) | See 5.1 above — corrects without logging. |

---

## Appendix: Files Read For This Audit

- `src/App.tsx` (handler + module-level helpers, lines ~150-950, ~2200-2830)
- `src/hooks/useWhisper.ts` (full)
- `src/services/whisperService.ts` (full, 1731 lines)
- `src/services/snapBoundaries.ts` (full, 904 lines)
- `src/services/syncEngine.ts` (full)
- `src/services/syncContracts.ts` (full)
- `src/services/syncLog.ts` (full)
- `src/services/syncConstants.ts` (full)
- `src/services/silenceDetector.ts` (full)
- `src/services/boundaryQuality.ts` (full)
- `src/types.ts` (relevant interfaces)

No files were modified. This report is descriptive only.
