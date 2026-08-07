// TASK 1 (second half) — breath-clip measurement.
//
// The owner ruled 50/50 placement. This runs TWO independent measurements
// over the real, unmodified Apply-Sync pipeline (Model P, 50/50 boundaries)
// across all three corpus projects, because "lands inside a breath" has two
// distinct, both-legitimate readings and only one is cheap to get wrong.
//
// MEASUREMENT A — the Phase 3 calibration, applied directly. Phase 3's own
// listening pass (docs/sync-pipeline-v2-plan.md, "C3 — the breath mechanism,
// tested explicitly") measured a human-audible breath ending 63-139ms BEFORE
// the following word's actual onset, consistently, across every breath clip
// it found — the source of the owner's "60-140ms" figure and the mechanism
// behind clip C04's audible clip. That gives a concrete, checkable RISK ZONE
// for every pair: `[nextSpokenStart - 0.140, nextSpokenStart - 0.060]` is
// where a real inhale plausibly still sounds, if the pair has one. A boundary
// landing in that zone is measured directly here, gated on a real DETECTED
// silence (from silencedetect) actually overlapping it — evidence the pause
// is acoustically real, not an artifact of token-timestamp noise.
//
// MEASUREMENT B — the existing candidacy predicates, reused rather than
// reimplemented. `fillsTokenGapWithinSpan`/`isBreathSilence`
// (services/snapBoundaries.ts) are the codebase's own, already-verified
// breath classifier — they used to REJECT a silence as a boundary candidate
// on exactly this basis. `snapCoveredBoundaries`'s `onBreathClip` sink reports
// instead of rejecting, since rejection has no effect on placement anymore.
// This measures a DIFFERENT, narrower shape (an intra-segment breath the
// midpoint happens to fall inside) and is included for completeness; its
// near-certain-zero result is itself informative — see the report's own note.
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
import { snapCoveredBoundaries, type BreathClip } from '../src/services/snapBoundaries';
import { enforceGaplessPartition } from '../src/services/timelinePartition';
import type { TranscriptToken, Asset } from '../src/types';
import type { SilenceInterval } from '../src/services/silenceDetector';

/** Phase 3's own measured range for how far before the next word's onset an
 *  audible inhale ends (docs/sync-pipeline-v2-plan.md, "C3"): 63-139ms across
 *  every breath clip that pass found. Widened to a round 60-140ms — the
 *  owner's own figure — for the risk zone below. */
const INHALE_END_MIN_SEC = 0.060;
const INHALE_END_MAX_SEC = 0.140;

interface InhaleZoneClip {
  project: string;
  pairIndex: number;
  tag: string;
  /** The committed 50/50 boundary. */
  boundarySec: number;
  /** How far before `nextSpokenStart` the boundary sits — inside
   *  [INHALE_END_MIN_SEC, INHALE_END_MAX_SEC] is what makes this a clip. */
  distanceFromNextWordSec: number;
  nextSpokenStartSec: number;
  /** The real detected silence corroborating an actual pause exists here. */
  silenceStartSec: number;
  silenceEndSec: number;
}

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

describe('TASK 1 — breath-clip measurement across the three corpora', () => {
  const allBreathClips: Array<{ project: string } & BreathClip> = [];
  const allInhaleZoneClips: InhaleZoneClip[] = [];

  for (const spec of PROJECTS) {
    it(`measures breath clips for ${spec.key}`, async () => {
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

      // ---- MEASUREMENT B (existing predicates) --------------------------
      const breathClips: BreathClip[] = [];
      const preHead = usableTokens.length > 0
        ? snapCoveredBoundaries(
            kept, keptAlignments, usableTokens, silences, spec.audioDuration,
            clip => breathClips.push(clip),
          )
        : kept;
      const finalSegments = enforceGaplessPartition(preHead, spec.audioDuration);
      for (const c of breathClips) allBreathClips.push({ project: spec.key, ...c });

      // ---- MEASUREMENT A (Phase 3 calibration) ---------------------------
      // Independent of `finalSegments`' actual startTime writes — recomputed
      // directly from the alignment's own token indices, the same
      // non-circular technique the Task 5 audit uses, so a bug in the
      // positioning code cannot also hide itself from this measurement.
      for (let i = 0; i < kept.length - 1; i++) {
        const currAlign = keptAlignments[i];
        const nextAlign = keptAlignments[i + 1];
        if (!currAlign || !nextAlign) continue;
        const lastTok = usableTokens[currAlign.lastTokenIdx];
        const nextTok = usableTokens[nextAlign.firstTokenIdx];
        if (!lastTok || !nextTok) continue;

        const boundarySec = (lastTok.endSec + nextTok.startSec) / 2;
        const distanceFromNextWordSec = nextTok.startSec - boundarySec;
        if (distanceFromNextWordSec < INHALE_END_MIN_SEC || distanceFromNextWordSec > INHALE_END_MAX_SEC) continue;

        // Require a REAL detected silence overlapping the risk zone — evidence
        // an actual acoustic pause exists here, not just two tokens whose
        // timestamps happen to be far enough apart.
        const riskZoneStart = nextTok.startSec - INHALE_END_MAX_SEC;
        const riskZoneEnd = nextTok.startSec - INHALE_END_MIN_SEC;
        const corroborating = silences.find(s => s.endSec > riskZoneStart && s.startSec < riskZoneEnd);
        if (!corroborating) continue;

        allInhaleZoneClips.push({
          project: spec.key,
          pairIndex: i,
          tag: kept[i]!.tag ?? kept[i]!.id,
          boundarySec,
          distanceFromNextWordSec,
          nextSpokenStartSec: nextTok.startSec,
          silenceStartSec: corroborating.startSec,
          silenceEndSec: corroborating.endSec,
        });
      }

      void finalSegments;
      // eslint-disable-next-line no-console
      console.log(`[breath-clip:${spec.key}] measurement B: ${breathClips.length}`);
    }, 120_000);
  }

  it('reports the combined counts and the worst cases across all three corpora', () => {
    const worstA = [...allInhaleZoneClips].sort(
      (a, b) => Math.abs(a.distanceFromNextWordSec - 0.1) - Math.abs(b.distanceFromNextWordSec - 0.1),
    ).slice(0, 15);
    const worstB = [...allBreathClips].sort((a, b) => b.depthSec - a.depthSec).slice(0, 10);

    const lines: string[] = [];
    lines.push('=== TASK 1 — BREATH-CLIP MEASUREMENT (owner ruling flag 1) ===');
    lines.push('');
    lines.push('-- MEASUREMENT A: 50/50 boundary lands in the Phase-3-calibrated');
    lines.push('   inhale-end zone (60-140ms before the next word), corroborated by a');
    lines.push('   real detected silence --');
    lines.push(`   Total: ${allInhaleZoneClips.length}`);
    for (const spec of PROJECTS) {
      const n = allInhaleZoneClips.filter(c => c.project === spec.key).length;
      lines.push(`     ${spec.key}: ${n}`);
    }
    lines.push('');
    lines.push(`   -- Worst ${worstA.length} cases (closest to the 100ms centre of the measured 60-140ms range) --`);
    for (const c of worstA) {
      lines.push(
        `     [${c.project}] pair ${c.pairIndex} (${c.tag}): boundary ${c.boundarySec.toFixed(3)}s, ` +
        `${(c.distanceFromNextWordSec * 1000).toFixed(0)}ms before next word (${c.nextSpokenStartSec.toFixed(3)}s), ` +
        `corroborating silence [${c.silenceStartSec.toFixed(3)}, ${c.silenceEndSec.toFixed(3)}]`,
      );
    }
    lines.push('');
    lines.push('-- MEASUREMENT B: 50/50 boundary lands inside a silence the existing');
    lines.push('   fillsTokenGapWithinSpan/isBreathSilence predicates classify as one');
    lines.push('   side\'s own INTERIOR breath (a different, narrower shape than A) --');
    lines.push(`   Total: ${allBreathClips.length}`);
    if (allBreathClips.length === 0) {
      lines.push('   (Structurally expected to be near-zero: these predicates classify a');
      lines.push('    silence as INTERIOR to one segment\'s own matched span — i.e. strictly');
      lines.push('    before lastSpokenEnd or strictly after nextSpokenStart — while the');
      lines.push('    50/50 boundary sits, by construction, BETWEEN those two points. The');
      lines.push('    two measurements are answering different questions: A asks whether the');
      lines.push('    cut lands in the physiologically plausible inhale window immediately');
      lines.push('    before the next word (the C04 mechanism); B asks whether the cut');
      lines.push('    strayed into a segment\'s own unrelated internal pause. A is the');
      lines.push('    measurement that answers the owner\'s flag directly.)');
    }
    for (const c of worstB) {
      lines.push(
        `     [${c.project}] boundary ${c.boundarySec.toFixed(3)}s inside breath [${c.breathStartSec.toFixed(3)}, ` +
        `${c.breathEndSec.toFixed(3)}] (${c.side}-side, depth ${c.depthSec.toFixed(3)}s)`,
      );
    }
    const report = lines.join('\n');
    // eslint-disable-next-line no-console
    console.log(report);
    writeFileSync(resolve(REPLAY_ROOT, 'task1-breath-clip-report.txt'), report);

    // This test only reports — it does not gate. The rule is 50/50 by ruling,
    // and this number is what the owner asked to see before testing, not a
    // pass/fail bar.
    expect(true).toBe(true);
  });
});
