// Phase 3 -> Phase 4 handoff, Step M — golden-baseline replay harness.
//
// Not a correctness test (no assertions on shape). Runs the REAL, unmodified,
// currently-shipped Apply-Sync pipeline (App.tsx's cachedTokensReady branch,
// verbatim call sequence) against each corpus project's own scene doc/script
// text and its already-captured turbo Whisper token output (unchanged since
// capture — every Phase 2b/3 pass was measurement-only, no src/ edits), to
// produce the exact per-segment committed start/end timings HEAD c4fc289
// would commit on a fresh Apply Sync. Reused rather than re-implemented: the
// same imports sceneTagParsing.test.ts/syncTiming.test.ts already use from
// '../src/App' to exercise parseProjectData outside a full render.
//
// Run: npx vitest run scripts/phase4-handoff-replay-sync.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { parseProjectData, evaluateCoverageGate, filterToCoveredSegments } from '../src/App';
import {
  alignScenestoTranscript,
  distributeSegmentTimes,
  filterMalformedTokens,
  countTranscriptWords,
  type SegmentAlignment,
} from '../src/services/whisperService';
import { applyAnchorBasedTiming, headExtendFirstSegment } from '../src/services/syncEngine';
import { snapCoveredBoundaries } from '../src/services/snapBoundaries';
import type { TranscriptToken, VideoSegment, Asset } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

interface ProjectSpec {
  key: string;
  sceneDetailsPath: string;
  scriptPath: string;
  rawTranscriptPath: string;
  silencesPath: string;
  audioDuration: number;
}

const PROJECTS: ProjectSpec[] = [
  {
    key: 'v6',
    sceneDetailsPath: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Sync.txt',
    scriptPath: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Script.txt',
    rawTranscriptPath: '/tmp/phase3/v6/raw_transcript_full.json',
    silencesPath: '/tmp/phase3/v6/silences_app.json',
    audioDuration: 1421.29,
  },
  {
    key: '173',
    sceneDetailsPath: '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/sync.txt',
    scriptPath: '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/script.txt',
    rawTranscriptPath: '/tmp/phase3/173_raw_transcript.json',
    silencesPath: '/tmp/phase3/173/silences_app.json',
    audioDuration: 709.01,
  },
  {
    key: 'spanish',
    sceneDetailsPath: '/Users/mohtashim/Downloads/All Projects Test Data/Spanish Project/Spanish Sync.txt',
    scriptPath: '/Users/mohtashim/Downloads/All Projects Test Data/Spanish Project/Spanish Script.txt',
    rawTranscriptPath: '/tmp/phase3/spanish_raw_transcript.json',
    silencesPath: '/tmp/phase3/spanish/silences_app.json',
    audioDuration: 92.04,
  },
];

function loadTokens(path: string): TranscriptToken[] {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Array<{ text: string; start: number; end: number }>;
  return raw.map(t => ({ text: t.text, startSec: t.start, endSec: t.end }));
}

function loadSilences(path: string): SilenceInterval[] {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as { silences: SilenceInterval[] };
  return raw.silences;
}

describe('Phase 3->4 handoff Step M — golden baseline replay', () => {
  for (const spec of PROJECTS) {
    it(`replays the shipped Apply-Sync pipeline for ${spec.key}`, async () => {
      const sceneDetails = readFileSync(spec.sceneDetailsPath, 'utf-8');
      const script = readFileSync(spec.scriptPath, 'utf-8');
      const tokens = loadTokens(spec.rawTranscriptPath);
      const silences = loadSilences(spec.silencesPath);
      const assets: Asset[] = [];

      // 1. parseProjectData — the real scene-doc parser, character-weight
      //    initial split. Output text/order is what a fresh Apply Sync click
      //    would produce from this exact scene doc, unaffected by asset
      //    matching (assets=[] only means every assetId stays unset).
      const newSegmentsRaw = await parseProjectData(script, sceneDetails, assets, spec.audioDuration);
      expect(newSegmentsRaw.length).toBeGreaterThan(0);

      // 2. App.tsx line 2401 — anchor the fresh parse before alignFromCache.
      const anchorTimed = applyAnchorBasedTiming(newSegmentsRaw, spec.audioDuration);

      // 3. useWhisper.ts's alignSegmentsFromCachedTranscript, inlined verbatim
      //    (filterMalformedTokens -> alignScenestoTranscript ->
      //    distributeSegmentTimes -> applyAnchorBasedTiming).
      const filtered = filterMalformedTokens(tokens, spec.audioDuration);
      const usableTokens = filtered.tokens;
      const alignments: SegmentAlignment[] = alignScenestoTranscript(anchorTimed, usableTokens, silences, spec.audioDuration);
      const updated = distributeSegmentTimes(anchorTimed, alignments);
      const alignedSegments = applyAnchorBasedTiming(updated, spec.audioDuration);

      // 4. App.tsx's coverage gate (R13) — must not abort on real narration.
      const totalTranscriptWords = countTranscriptWords(usableTokens);
      const gate = evaluateCoverageGate(alignedSegments, alignments, totalTranscriptWords);

      // 5. filterToCoveredSegments (R4-1/R4-2 skip-unmatched).
      const { kept, skipped, keptAlignments } = filterToCoveredSegments(alignedSegments, alignments);

      // 6. Covered-only boundary re-snap (or the fallback re-tile — not
      //    exercised here since usableTokens.length > 0 for every project).
      const finalTimedSegmentsPreHead = usableTokens.length > 0
        ? snapCoveredBoundaries(kept, keptAlignments, usableTokens, silences, spec.audioDuration)
        : kept;

      // 7. Head-extension (segment-1, 2026-07-31).
      const finalTimedSegments: VideoSegment[] = headExtendFirstSegment(finalTimedSegmentsPreHead);

      const summary = {
        project: spec.key,
        audioDuration: spec.audioDuration,
        gate,
        parsedSegmentCount: newSegmentsRaw.length,
        keptSegmentCount: kept.length,
        skippedSegmentCount: skipped.length,
        skipped: skipped.map(s => ({
          segmentIndex: s.segmentIndex,
          segmentTag: s.segmentTag,
          segmentText: s.segmentText,
          matchedWords: s.matchedWords,
          totalWords: s.totalWords,
          confidence: s.confidence,
          longestRun: s.longestRun,
        })),
        malformedTokenCount: filtered.skippedCount,
        totalTokenCount: filtered.totalTokens,
        usedSilenceCount: silences.length,
        finalSegments: finalTimedSegments.map((s, i) => ({
          order: i,
          id: s.id,
          tag: s.tag,
          text: s.text,
          startTime: s.startTime,
          duration: s.duration,
          endTime: Number((s.startTime + s.duration).toFixed(3)),
          anchorStart: s.anchorStart,
          anchorSource: s.anchorSource,
        })),
      };

      writeFileSync(`/tmp/phase3/${spec.key}/golden_baseline_segments.json`, JSON.stringify(summary, null, 2));

      // Sanity, not correctness: sum of content-segment durations should be
      // close to audioDuration (Key Invariant (b), CLAUDE.md) modulo skipped
      // segments' gaps.
      const totalCommitted = finalTimedSegments.reduce((acc, s) => acc + s.duration, 0);
      // eslint-disable-next-line no-console
      console.log(
        `[replay:${spec.key}] parsed=${newSegmentsRaw.length} kept=${kept.length} skipped=${skipped.length} ` +
        `gate.aborted=${gate.aborted} totalCommittedDuration=${totalCommitted.toFixed(2)} audioDuration=${spec.audioDuration}`,
      );
    }, 120_000);
  }
});
