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
//
// STEP Y (2026-08-07) — two changes, both because a baseline that cannot be
// re-run cannot prove anything:
//
//  1. INPUTS MOVED OFF /tmp. This harness previously read its transcripts and
//     silences from /tmp/phase3/..., which macOS purged — the fourth K8
//     recurrence (docs/ws1-sync-pipeline/sync-pipeline-v2-plan.md Part K). Inputs now live under
//     .work-phase4/replay/ (gitignored, durable, resolved relative to this
//     file, not to cwd) and are regenerated deterministically from COMMITTED
//     sources by `python3 scripts/phase4-restore-replay-inputs.py`. A missing
//     input now fails with that command in the message instead of a bare ENOENT.
//
//  2. IT NOW ASSERTS. The original harness wrote a summary and asserted almost
//     nothing ("not a correctness test"). It now diffs every replayed segment
//     against the committed Step M golden values in
//     scripts/fixtures/phase4-baseline-<key>-segments.csv (start/duration/end to 1e-9, plus
//     tag/text/order) and the skip set against -skipped.csv. That is what makes
//     it a usable per-boundary reference for the Phase 3 timing-source swap: a
//     post-swap run diffs against these same rows, and any boundary that moved
//     shows up by name.
//
// IF THIS TEST FAILS AFTER A src/ CHANGE, THAT IS THE POINT — it means the
// shipped sync pipeline now commits different timings than the Step M baseline.
// Investigate the diff. Do NOT re-baseline the CSVs to whatever the new run
// produces without a recorded decision.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
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

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Durable, gitignored artifact root. Deliberately NOT /tmp — see the K8 note above. */
const REPLAY_ROOT = resolve(REPO, '.work-phase4/replay');
const RESTORE_CMD = 'python3 scripts/phase4-restore-replay-inputs.py';

interface ProjectSpec {
  key: string;
  sceneDetailsPath: string;
  scriptPath: string;
  audioDuration: number;
}

const PROJECTS: ProjectSpec[] = [
  {
    key: 'v6',
    sceneDetailsPath: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Sync.txt',
    scriptPath: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Script.txt',
    audioDuration: 1421.29,
  },
  {
    key: '173',
    sceneDetailsPath: '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/sync.txt',
    scriptPath: '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/script.txt',
    audioDuration: 709.01,
  },
  {
    key: 'spanish',
    sceneDetailsPath: '/Users/mohtashim/Downloads/All Projects Test Data/Spanish Project/Spanish Sync.txt',
    scriptPath: '/Users/mohtashim/Downloads/All Projects Test Data/Spanish Project/Spanish Script.txt',
    audioDuration: 92.04,
  },
];

/** Reads a required replay input, failing with the regeneration command rather
 *  than a bare ENOENT — the whole point of Step Y. */
function requireInput(key: string, fileName: string): string {
  const path = resolve(REPLAY_ROOT, key, fileName);
  if (!existsSync(path)) {
    throw new Error(
      `Replay input missing: ${path}\n` +
      `Regenerate it (deterministically, from committed sources — no whisper run needed):\n` +
      `    ${RESTORE_CMD}\n` +
      `That script also verifies the regenerated inputs value-for-value against the ` +
      `committed Step M baseline before this harness ever runs.`,
    );
  }
  return readFileSync(path, 'utf-8');
}

function loadTokens(key: string): TranscriptToken[] {
  const raw = JSON.parse(requireInput(key, 'transcript_tokens.json')) as Array<{ text: string; start: number; end: number }>;
  return raw.map(t => ({ text: t.text, startSec: t.start, endSec: t.end }));
}

function loadSilences(key: string): SilenceInterval[] {
  const raw = JSON.parse(requireInput(key, 'silences_app.json')) as { silences: SilenceInterval[] };
  return raw.silences;
}

/** Minimal RFC4180-ish CSV reader — the baseline CSVs quote any field containing a comma. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') { field += c; }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows
    .filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])) as Record<string, string>);
}

function loadBaselineCsv(name: string): Record<string, string>[] {
  return parseCsv(readFileSync(resolve(REPO, 'scripts', 'fixtures', name), 'utf-8'));
}

describe('Phase 3->4 handoff Step M — golden baseline replay', () => {
  for (const spec of PROJECTS) {
    it(`replays the shipped Apply-Sync pipeline for ${spec.key}`, async () => {
      const sceneDetails = readFileSync(spec.sceneDetailsPath, 'utf-8');
      const script = readFileSync(spec.scriptPath, 'utf-8');
      const tokens = loadTokens(spec.key);
      const silences = loadSilences(spec.key);
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

      const outDir = resolve(REPLAY_ROOT, spec.key);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(resolve(outDir, 'golden_baseline_segments.json'), JSON.stringify(summary, null, 2));

      // ---------------------------------------------------------------------
      // Step Y — GOLDEN DIFF. Every replayed segment must reproduce the
      // committed Step M value exactly. Reported as a list of named boundaries
      // that moved, not a bare count, so a post-swap diff is actionable.
      // ---------------------------------------------------------------------
      const goldenSegments = loadBaselineCsv(`phase4-baseline-${spec.key}-segments.csv`);
      expect(
        summary.finalSegments.length,
        `${spec.key}: replayed ${summary.finalSegments.length} segments, committed baseline has ${goldenSegments.length}`,
      ).toBe(goldenSegments.length);

      const drifted: string[] = [];
      for (let i = 0; i < goldenSegments.length; i++) {
        // Both indices are in range: the length equality above already asserted it.
        const got = summary.finalSegments[i]!;
        const want = goldenSegments[i]!;
        const fields: Array<[string, unknown, unknown]> = [
          ['order', got.order, Number(want.order)],
          ['tag', got.tag, want.tag],
          ['text', got.text, want.text],
          ['anchorSource', got.anchorSource, want.anchorSource],
        ];
        for (const [name, a, b] of fields) {
          if (a !== b) drifted.push(`seg ${i} (${want.tag}) ${name}: replay=${String(a)} baseline=${String(b)}`);
        }
        const numeric: Array<[string, number, number]> = [
          ['startTime', got.startTime, Number(want.startTime)],
          ['duration', got.duration, Number(want.duration)],
          ['endTime', got.endTime, Number(want.endTime)],
        ];
        for (const [name, a, b] of numeric) {
          if (Math.abs(a - b) > 1e-9) {
            drifted.push(`seg ${i} (${want.tag}) ${name}: replay=${a} baseline=${b} (Δ${(a - b).toFixed(6)}s)`);
          }
        }
      }
      expect(
        drifted,
        `${spec.key}: ${drifted.length} field(s) diverged from the committed Step M golden baseline:\n` +
        drifted.slice(0, 25).join('\n') + (drifted.length > 25 ? `\n… and ${drifted.length - 25} more` : '') +
        `\n\nThis is the Phase 3 timing-source swap's per-boundary reference. If a src/ change ` +
        `caused this, that is the signal it was built to give — investigate the diff before ` +
        `re-baselining scripts/fixtures/phase4-baseline-${spec.key}-segments.csv.`,
      ).toEqual([]);

      // Skip set must match by segment index AND reason numbers — the three
      // findings Step M independently re-derived (V6 27-29, 173 1/13/112) live here.
      const goldenSkipped = loadBaselineCsv(`phase4-baseline-${spec.key}-skipped.csv`);
      expect(
        summary.skipped.map(s => s.segmentIndex),
        `${spec.key}: skipped-segment set changed vs. the committed Step M baseline`,
      ).toEqual(goldenSkipped.map(r => Number(r.segmentIndex)));
      for (let i = 0; i < goldenSkipped.length; i++) {
        // In range: the segmentIndex-array equality above already asserted length.
        const gotSkip = summary.skipped[i]!;
        const wantSkip = goldenSkipped[i]!;
        expect(gotSkip.segmentTag).toBe(wantSkip.segmentTag);
        expect(gotSkip.matchedWords).toBe(Number(wantSkip.matchedWords));
        expect(gotSkip.totalWords).toBe(Number(wantSkip.totalWords));
      }

      // The coverage gate must not abort on real narration (R13).
      expect(gate.aborted, `${spec.key}: coverage gate aborted — it did not at Step M`).toBe(false);

      // Key Invariant (b), CLAUDE.md: Σ committed content-segment duration ===
      // audioDuration. Held exactly on all three projects at Step M.
      const totalCommitted = finalTimedSegments.reduce((acc, s) => acc + s.duration, 0);
      expect(
        Math.abs(totalCommitted - spec.audioDuration),
        `${spec.key}: Key Invariant (b) broken — Σ duration ${totalCommitted} vs audioDuration ${spec.audioDuration}`,
      ).toBeLessThan(1e-6);

      // eslint-disable-next-line no-console
      console.log(
        `[replay:${spec.key}] parsed=${newSegmentsRaw.length} kept=${kept.length} skipped=${skipped.length} ` +
        `gate.aborted=${gate.aborted} totalCommittedDuration=${totalCommitted.toFixed(2)} audioDuration=${spec.audioDuration}`,
      );
    }, 120_000);
  }
});

// ---------------------------------------------------------------------------
// R-H — forced-alignment fixture (fidelity reference, captured while FA is
// still unwired from Apply Sync — the diff against production is zero today,
// which is what makes a later non-zero diff, once faAnchors.ts gets a real
// caller, unambiguous).
//
// This is NOT a re-run of the shipped sync pipeline with FA tokens substituted
// for Whisper tokens (there is no wiring to do that yet — faAnchors.ts has no
// caller, per Slice D1). It is a SECOND, INDEPENDENT capture: MMS-FA's own
// per-word alignment of each project's already-committed segment text against
// its own audio, produced by the Python harness (measure-forced-alignment.py,
// torch/torchaudio — not runnable from vitest/Node), and committed as a fixed
// pair of fixtures:
//   - scripts/fixtures/phase4-fa-tokens-<key>.json  (the raw per-word capture)
//   - scripts/fixtures/phase4-fa-baseline-<key>-words.csv (the same data, as
//     a diffable table — the actual "second baseline" 2.3 asks for)
// There was nothing to diff the FA pass against before this run — THIS RUN's
// own committed output IS the baseline going forward. What these tests check
// is that the pair stays internally consistent (the CSV table matches the
// JSON capture it was derived from, exactly) and that the required fidelity
// caveat (below) survives any future edit to either file.
//
// Exact harness commands used to produce the raw captures (torch==2.2.2,
// torchaudio==2.2.2, numpy<2, uroman, per measure-forced-alignment.md's
// documented setup):
//   python3 scripts/measure-forced-alignment.py align \
//     --workdir .work-phase4/replay/v6      --segments-json <v6 committed segments as JSON>      --label fa --language en
//   python3 scripts/measure-forced-alignment.py align \
//     --workdir .work-phase4/replay/173     --segments-json <173 committed segments as JSON>     --label fa --language en
//   python3 scripts/measure-forced-alignment.py align \
//     --workdir .work-phase4/replay/spanish --segments-json <spanish committed segments as JSON> --label fa --language es
// `--segments-json` in each case was scripts/fixtures/phase4-baseline-<key>-segments.csv
// (the committed Step M golden segments — text/startTime/duration) converted
// to the bare-array JSON shape measure-forced-alignment.py's loader accepts;
// those are alignment WINDOWS only (R.4/pad-sec 3.0, neighbour-midpoint
// clamped), never a ground truth this harness scores against.
//
// CRITICAL — do not mistake this for a production behavioral target: pad-sec
// 3.0 and neighbour-midpoint windowing are MEASUREMENT convention. R.4
// specifies PAD_BASE 0.75s for production, and the audit that produced R.4
// traced the midpoint-clamp strategy used here to five documented failures on
// gapless corpora (docs/history.md). This is a FIDELITY reference for the
// future Rust MMS-FA/Viterbi port to reproduce — not a claim about what Apply
// Sync should ever commit.
// ---------------------------------------------------------------------------

interface FaWordToken {
  text: string;
  start: number;
  end: number;
  score: number;
  seg: number;
}

interface FaTokensFixture {
  _caveat: string[];
  _provenance: {
    model: string;
    torch_version: string;
    torchaudio_version: string;
    pad_sec: number;
    language: string;
    token_count: number;
    segment_count: number;
    failed_segments: unknown[];
    dropped_unrepresentable: Array<{ seg: number; words: string[] }>;
  };
  words: FaWordToken[];
}

function loadFaTokensFixture(key: string): FaTokensFixture {
  return JSON.parse(
    readFileSync(resolve(REPO, 'scripts', 'fixtures', `phase4-fa-tokens-${key}.json`), 'utf-8'),
  ) as FaTokensFixture;
}

/** Same row format `loadBaselineCsv` reads, plus leading `#`-prefixed
 *  provenance/caveat comment lines stripped before parsing — a distinct
 *  helper so the existing three Whisper baselines' loading path
 *  (`loadBaselineCsv`/`parseCsv`) is never touched by this addition. */
function loadFaBaselineCsv(key: string): Record<string, string>[] {
  const raw = readFileSync(resolve(REPO, 'scripts', 'fixtures', `phase4-fa-baseline-${key}-words.csv`), 'utf-8');
  const withoutComments = raw
    .split('\n')
    .filter(line => !line.startsWith('#'))
    .join('\n');
  return parseCsv(withoutComments);
}

describe('R-H — forced-alignment fixture (second baseline, captured while FA is unwired)', () => {
  for (const spec of PROJECTS) {
    it(`FA capture for ${spec.key}: committed CSV baseline matches the committed JSON capture it was derived from`, () => {
      const fixture = loadFaTokensFixture(spec.key);
      const csvRows = loadFaBaselineCsv(spec.key);

      // The caveat must survive verbatim — this is what stops a future reader
      // from mistaking a measurement-convention fixture for a production target.
      expect(fixture._caveat.join(' ')).toContain('NOT a production behavioral target');
      expect(fixture._caveat.join(' ')).toContain('nothing to diff it against yet');

      expect(fixture._provenance.token_count).toBe(fixture.words.length);
      expect(fixture._provenance.failed_segments).toEqual([]);

      expect(csvRows.length, `${spec.key}: CSV row count vs JSON word count`).toBe(fixture.words.length);
      for (let i = 0; i < fixture.words.length; i++) {
        const w = fixture.words[i]!;
        const row = csvRows[i]!;
        expect(Number(row.seg), `${spec.key} word ${i} seg`).toBe(w.seg);
        expect(row.text, `${spec.key} word ${i} text`).toBe(w.text);
        expect(Math.abs(Number(row.startSec) - w.start), `${spec.key} word ${i} startSec`).toBeLessThan(1e-9);
        expect(Math.abs(Number(row.endSec) - w.end), `${spec.key} word ${i} endSec`).toBeLessThan(1e-9);
        expect(Math.abs(Number(row.score) - w.score), `${spec.key} word ${i} score`).toBeLessThan(1e-9);
      }

      // eslint-disable-next-line no-console
      console.log(
        `[fa-fixture:${spec.key}] words=${fixture.words.length} segments=${fixture._provenance.segment_count} ` +
        `language=${fixture._provenance.language} pad_sec=${fixture._provenance.pad_sec} ` +
        `dropped_unrepresentable=${fixture._provenance.dropped_unrepresentable.length} ` +
        `(this is a FIDELITY reference for a future Rust port — not a production timing target)`,
      );
    });
  }
});
