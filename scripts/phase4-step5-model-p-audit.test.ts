// TASK 5 — Golden baseline diff, audited not accepted.
//
// Re-runs the exact same replay pipeline `phase4-handoff-replay-sync.test.ts`
// does (Model P now in effect: enforceGaplessPartition, the 50/50 boundary
// rule) against the three corpus projects, and for every INTERIOR boundary
// (between two kept, unlocked segments — none of the three corpora contain a
// lock) does two independent things a bare pass/fail diff does not:
//
//   1. Logs old (committed Step M baseline) / new (this run) / delta for every
//      shifted boundary.
//   2. PREDICTS what the new boundary should be, independently of
//      `snapCoveredBoundaries`'s own arithmetic: `(tokens[lastTokenIdx].endSec
//      + tokens[firstTokenIdx].startSec) / 2` computed directly from the
//      alignment's own token indices — the ruling's formula, read off the raw
//      inputs rather than re-executed through the function under audit. Then
//      asserts the ACTUAL new boundary equals the prediction.
//
// A boundary whose delta matches the ruling's formula is the intended shift —
// expected, and not a bug. A boundary that does NOT match the prediction is
// flagged separately and loudly: it means something OTHER than the 50/50 rule
// moved it (a floor, a contiguity push from an upstream floor, a degenerate-
// pair skip) and needs to be looked at as a possible defect, not filed away as
// "the ruling did this."
//
// This does NOT write a new baseline. It reads the existing, committed
// docs/phase4-baseline-*-segments.csv files exactly as
// phase4-handoff-replay-sync.test.ts does, and only reports.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'fs';
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
import { applyAnchorBasedTiming } from '../src/services/syncEngine';
import { snapCoveredBoundaries } from '../src/services/snapBoundaries';
import { enforceGaplessPartition } from '../src/services/timelinePartition';
import type { TranscriptToken, VideoSegment, Asset } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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

function requireInput(key: string, fileName: string): string {
  const path = resolve(REPLAY_ROOT, key, fileName);
  if (!existsSync(path)) {
    throw new Error(`Replay input missing: ${path}\nRegenerate: ${RESTORE_CMD}`);
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
  return parseCsv(readFileSync(resolve(REPO, 'docs', name), 'utf-8'));
}

interface AuditRow {
  pairIndex: number;
  tag: string;
  oldBoundary: number;
  newBoundary: number;
  delta: number;
  predicted: number;
  predictedMatches: boolean;
}

describe('TASK 5 — golden baseline diff, audited against the 50/50 formula', () => {
  for (const spec of PROJECTS) {
    it(`audits every shifted boundary for ${spec.key}`, async () => {
      const sceneDetails = readFileSync(spec.sceneDetailsPath, 'utf-8');
      const script = readFileSync(spec.scriptPath, 'utf-8');
      const tokens = loadTokens(spec.key);
      const silences = loadSilences(spec.key);
      const assets: Asset[] = [];

      const newSegmentsRaw = await parseProjectData(script, sceneDetails, assets, spec.audioDuration);
      const anchorTimed = applyAnchorBasedTiming(newSegmentsRaw, spec.audioDuration);
      const filtered = filterMalformedTokens(tokens, spec.audioDuration);
      const usableTokens = filtered.tokens;
      const alignments: SegmentAlignment[] = alignScenestoTranscript(anchorTimed, usableTokens, silences, spec.audioDuration);
      const updated = distributeSegmentTimes(anchorTimed, alignments);
      const alignedSegments = applyAnchorBasedTiming(updated, spec.audioDuration);
      const totalTranscriptWords = countTranscriptWords(usableTokens);
      const gate = evaluateCoverageGate(alignedSegments, alignments, totalTranscriptWords);
      expect(gate.aborted, `${spec.key}: coverage gate aborted`).toBe(false);

      const { kept, keptAlignments } = filterToCoveredSegments(alignedSegments, alignments);
      expect(kept.every(s => !s.locked), `${spec.key}: this audit assumes no locks (matches the plan doc's own note)`).toBe(true);

      const preHead = usableTokens.length > 0
        ? snapCoveredBoundaries(kept, keptAlignments, usableTokens, silences, spec.audioDuration)
        : kept;
      const finalTimedSegments: VideoSegment[] = enforceGaplessPartition(preHead, spec.audioDuration);

      // ---- Load the committed Step M baseline (pre-ruling) --------------------
      const goldenSegments = loadBaselineCsv(`phase4-baseline-${spec.key}-segments.csv`);
      expect(finalTimedSegments.length, `${spec.key}: length mismatch vs baseline`).toBe(goldenSegments.length);

      // ---- Audit every INTERIOR boundary --------------------------------------
      // Index 0's start (head rule) and the last segment's end (tail rule) are
      // array EDGES, not pair boundaries between two kept segments — excluded,
      // same convention the ruling document and timelinePartition.ts use.
      const rows: AuditRow[] = [];
      for (let i = 0; i < finalTimedSegments.length - 1; i++) {
        const currAlign = keptAlignments[i];
        const nextAlign = keptAlignments[i + 1];
        if (!currAlign || !nextAlign) continue; // shouldn't happen — every kept segment has one
        const lastTok = usableTokens[currAlign.lastTokenIdx];
        const nextTok = usableTokens[nextAlign.firstTokenIdx];
        if (!lastTok || !nextTok) continue; // sentinel/malformed — not a plain pair

        const oldBoundary = Number(goldenSegments[i + 1]!.startTime);
        const newBoundary = finalTimedSegments[i + 1]!.startTime;
        const delta = Number((newBoundary - oldBoundary).toFixed(6));

        // The ruling's own formula, computed independently from the raw token
        // array — NOT by calling into snapCoveredBoundaries or reading its
        // internal spokenMid. This is what makes the check non-circular.
        const predicted = Number(((lastTok.endSec + nextTok.startSec) / 2).toFixed(3));
        const predictedMatches = Math.abs(newBoundary - predicted) < 0.0015;

        rows.push({
          pairIndex: i,
          tag: finalTimedSegments[i]!.tag ?? finalTimedSegments[i]!.id,
          oldBoundary,
          newBoundary,
          delta,
          predicted,
          predictedMatches,
        });
      }

      const shifted = rows.filter(r => Math.abs(r.delta) > 0.0015);
      const bugs = rows.filter(r => !r.predictedMatches);

      // ---- Report, unconditionally, to a durable artifact ---------------------
      const lines: string[] = [];
      lines.push(`=== TASK 5 AUDIT — ${spec.key} ===`);
      lines.push(`Total interior boundaries: ${rows.length}`);
      lines.push(`Shifted vs. Step M baseline: ${shifted.length}`);
      lines.push(`Boundaries whose new value does NOT match the 50/50 prediction: ${bugs.length}`);
      lines.push('');
      lines.push('-- Every shifted boundary (old, new, delta) --');
      for (const r of shifted) {
        lines.push(
          `  pair ${r.pairIndex} (${r.tag}) old=${r.oldBoundary.toFixed(3)} new=${r.newBoundary.toFixed(3)} ` +
          `delta=${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(3)} predicted=${r.predicted.toFixed(3)} ` +
          `${r.predictedMatches ? 'OK (matches 50/50 formula)' : '*** BUG — DOES NOT MATCH ***'}`,
        );
      }
      if (bugs.length > 0) {
        lines.push('');
        lines.push('-- BUGS (new value does not equal the ruling formula) --');
        for (const r of bugs) {
          lines.push(
            `  *** pair ${r.pairIndex} (${r.tag}): new=${r.newBoundary.toFixed(3)} predicted=${r.predicted.toFixed(3)} ` +
            `diff=${(r.newBoundary - r.predicted).toFixed(6)}s ***`,
          );
        }
      }
      const report = lines.join('\n');
      // eslint-disable-next-line no-console
      console.log(report);
      writeFileSync(resolve(REPLAY_ROOT, spec.key, 'task5-audit-report.txt'), report);

      // ---- The actual assertion: EVERY new boundary matches the formula -------
      // This is the audit's verdict. A shift is not itself a failure — the
      // ruling changed the rule on purpose. A PREDICTION MISMATCH is.
      expect(
        bugs.map(r => `pair ${r.pairIndex} (${r.tag}): new=${r.newBoundary} predicted=${r.predicted}`),
        `${spec.key}: ${bugs.length} boundary/boundaries do not match the 50/50 formula — see report above`,
      ).toEqual([]);
    }, 120_000);
  }
});
