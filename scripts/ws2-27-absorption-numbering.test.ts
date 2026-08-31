// WS2 ws2-27 — Clip-N off-by-one fix, pinned against the REAL v6/173 corpora.
//
// Replays the real Apply-Sync pipeline exactly as
// scripts/phase4-handoff-replay-sync.test.ts does (same inputs, same call
// sequence, through headExtendFirstSegment), then runs the real
// computeAbsorbedGaps/measureOtherNeighborGain/buildSkipLogEntries against
// the result and pins BOTH the printed sync-log label and the resolved jump
// target segmentId for every named row, so a future change can't fix one and
// break the other. Golden-replay-style external inputs (see that file's own
// header) — this test does not read or write anything golden-replay itself
// depends on and does not assert on `finalTimedSegments`/committed timing at
// all, only on the reporting-only absorption layer built on top of it.
//
// Run: npx vitest run scripts/ws2-27-absorption-numbering.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  parseProjectData, filterToCoveredSegments, buildSkipLogEntries,
  type AbsorbedGapLogInfo,
} from '../src/App';
import {
  alignScenestoTranscript, distributeSegmentTimes, filterMalformedTokens,
  type SegmentAlignment,
} from '../src/services/whisperService';
import { applyAnchorBasedTiming, headExtendFirstSegment } from '../src/services/syncEngine';
import { snapCoveredBoundaries } from '../src/services/snapBoundaries';
import { computeAbsorbedGaps, measureOtherNeighborGain } from '../src/services/absorbedGaps';
import { MIN_SEGMENT_DURATION } from '../src/services/dragCascade';
import type { TranscriptToken, VideoSegment, Asset } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPLAY_ROOT = resolve(REPO, '.work-phase4/replay');
const RESTORE_CMD = 'python3 scripts/phase4-restore-replay-inputs.py';

interface Spec { key: string; sceneDetailsPath: string; scriptPath: string; audioDuration: number; }
const PROJECTS: Spec[] = [
  { key: 'v6',
    sceneDetailsPath: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Sync.txt',
    scriptPath: '/Users/mohtashim/Downloads/All Projects Test Data/V6 Natural Long Pause Segs/All Text Files/Script.txt',
    audioDuration: 1421.29 },
  { key: '173',
    sceneDetailsPath: '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/sync.txt',
    scriptPath: '/Users/mohtashim/Downloads/All Projects Test Data/173 Segs Project/script.txt',
    audioDuration: 709.01 },
];

function requireInput(key: string, fileName: string): string {
  const path = resolve(REPLAY_ROOT, key, fileName);
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    throw new Error(`Replay input missing: ${path}\nRegenerate: ${RESTORE_CMD}`);
  }
}
function loadTokens(key: string): TranscriptToken[] {
  const raw = JSON.parse(requireInput(key, 'transcript_tokens.json')) as Array<{ text: string; start: number; end: number }>;
  return raw.map(t => ({ text: t.text, startSec: t.start, endSec: t.end }));
}
function loadSilences(key: string): SilenceInterval[] {
  return (JSON.parse(requireInput(key, 'silences_app.json')) as { silences: SilenceInterval[] }).silences;
}

interface RunResult {
  committed: VideoSegment[];
  entriesByS: Map<number, { message: string; segmentId: string | undefined }>;
}

/** Runs the real pipeline through the real reporting layer this fix touches
 *  (computeAbsorbedGaps -> measureOtherNeighborGain -> buildSkipLogEntries),
 *  mirroring App.tsx's own call sequence around the sync-log patch block
 *  (App.tsx ~3443-3465) exactly, including the note-threshold gate. */
async function run(spec: Spec): Promise<RunResult> {
  const sceneDetails = readFileSync(spec.sceneDetailsPath, 'utf-8');
  const script = readFileSync(spec.scriptPath, 'utf-8');
  const tokens = loadTokens(spec.key);
  const silences = loadSilences(spec.key);
  const assets: Asset[] = [];

  const raw = await parseProjectData(script, sceneDetails, assets, spec.audioDuration);
  const anchorTimed = applyAnchorBasedTiming(raw, spec.audioDuration);
  const filtered = filterMalformedTokens(tokens, spec.audioDuration);
  const usableTokens = filtered.tokens;
  const alignments: SegmentAlignment[] = alignScenestoTranscript(anchorTimed, usableTokens, silences, spec.audioDuration);
  const updated = distributeSegmentTimes(anchorTimed, alignments);
  const alignedSegments = applyAnchorBasedTiming(updated, spec.audioDuration);
  const { kept, skipped, keptAlignments } = filterToCoveredSegments(alignedSegments, alignments);

  const absorbedGapsByHostId = computeAbsorbedGaps(
    alignedSegments, skipped, kept.map(s => s.id), keptAlignments, usableTokens, silences,
  );

  const postSnap = usableTokens.length > 0
    ? snapCoveredBoundaries(kept, keptAlignments, usableTokens, silences, spec.audioDuration)
    : kept;
  const committed = headExtendFirstSegment(postSnap);

  // Mirrors App.tsx's own resolution block exactly (hostDisplayIndex against
  // the FINAL committed array, otherNeighbor gated on MIN_SEGMENT_DURATION).
  const absorbedInfoBySkipIndex = new Map<number, AbsorbedGapLogInfo>();
  for (const [hostId, gaps] of absorbedGapsByHostId) {
    const hostDisplayIndex = committed.findIndex(s => s.id === hostId);
    if (hostDisplayIndex < 0) continue;
    const otherNeighborId = gaps[0]?.otherNeighborId;
    let otherNeighbor: AbsorbedGapLogInfo['otherNeighbor'];
    if (otherNeighborId) {
      const otherDisplayIndex = committed.findIndex(s => s.id === otherNeighborId);
      const gainSec = measureOtherNeighborGain(hostId, otherNeighborId, kept, committed);
      if (otherDisplayIndex >= 0 && gainSec !== undefined && gainSec > MIN_SEGMENT_DURATION) {
        otherNeighbor = { displayIndex: otherDisplayIndex, gainSec };
      }
    }
    for (const gap of gaps) {
      const skipRecord = skipped.find(r => alignedSegments[r.segmentIndex]?.id === gap.segmentId);
      if (skipRecord) {
        absorbedInfoBySkipIndex.set(skipRecord.segmentIndex, {
          hostSegmentId: hostId, hostDisplayIndex, span: gap.span, gapAudio: gap.gapAudio, otherNeighbor,
        });
      }
    }
  }

  const entries = buildSkipLogEntries('run-1', skipped, 0, absorbedInfoBySkipIndex);
  const entriesByS = new Map(entries.map(e => [e.segmentIndex! + 1, { message: e.message, segmentId: e.segmentId }]));
  return { committed, entriesByS };
}

describe('WS2 ws2-27 — Clip-N off-by-one fix, real corpora', () => {
  it('v6 S27, S28, S29 — all three name the same host, Clip 27, jump resolves to 030_watching_older_hunters', async () => {
    const { committed, entriesByS } = await run(PROJECTS[0]!);
    const host = committed.find(s => s.tag === '030_watching_older_hunters');
    expect(host).toBeDefined();
    expect(committed.indexOf(host!)).toBe(26); // 0-based -> Clip 27

    for (const s of [27, 28, 29]) {
      const entry = entriesByS.get(s);
      expect(entry, `S${s} entry`).toBeDefined();
      expect(entry!.message).toContain('Clip 27');
      expect(entry!.message).not.toContain('Clip 26'); // the pre-fix (wrong) host
      expect(entry!.segmentId).toBe(host!.id);
      expect(entry!.message).not.toContain('also holds'); // prev is a net loser here, not material
    }
  }, 120_000);

  it('173 S1 (leading run) — S-number is 1, Clip 1, byte-identical to the pre-fix behaviour', async () => {
    const { committed, entriesByS } = await run(PROJECTS[1]!);
    const entry = entriesByS.get(1);
    expect(entry).toBeDefined();
    expect(entry!.message).toBe(
      'S1 / Clip 1 skipped — no text match. Absorbed 0.000s → 0.160s → 0.160s (speech).',
    );
    expect(entry!.segmentId).toBe(committed[0]!.id);
  }, 120_000);

  it('173 S13 — mid-script, with an unrelated upstream drop at S1: moves from Clip 11 (pre-fix) to Clip 12, jump resolves to eternal_focus', async () => {
    const { committed, entriesByS } = await run(PROJECTS[1]!);
    const host = committed.find(s => s.tag === 'eternal_focus');
    expect(host).toBeDefined();
    const entry = entriesByS.get(13);
    expect(entry).toBeDefined();
    expect(entry!.message).toContain('Clip 12');
    expect(entry!.message).not.toContain('Clip 11 skipped'); // old host wouldn't print as a clip suffix anyway; guards the exact string
    expect(entry!.segmentId).toBe(host!.id);
    // The other neighbour (the old, wrong host) also gained a material 0.67s.
    expect(entry!.message).toContain('also holds 0.67s');
  }, 120_000);

  it('173 S112 — moves from Clip 109 (pre-fix) to Clip 110, jump resolves to shirking_foundation, notes Clip 109\'s 0.63s', async () => {
    const { committed, entriesByS } = await run(PROJECTS[1]!);
    const host = committed.find(s => s.tag === 'shirking_foundation');
    expect(host).toBeDefined();
    expect(committed.indexOf(host!)).toBe(109); // 0-based -> Clip 110

    const entry = entriesByS.get(112);
    expect(entry).toBeDefined();
    expect(entry!.message).toBe(
      'S112 / Clip 110 skipped — no text match. Absorbed 442.940s → 2.420s → 445.360s (speech). '
      + 'Clip 109 also holds 0.63s.',
    );
    expect(entry!.segmentId).toBe(host!.id);
  }, 120_000);
});
