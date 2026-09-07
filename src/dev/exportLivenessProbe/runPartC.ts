/**
 * THROWAWAY — Part C: live 500-segment/200s transitioned+animated export,
 * and a 40s digest-reproducibility check on the same fixture shape.
 * Not imported by any production file.
 */

import { setWebCodecsExportToggle } from '../../hooks/useExport';
import {
  lastWebCodecsRunDiagnostics,
  setFrameContentDigestEnabled,
} from '../../services/webcodecsExport/exportPipelineWebCodecs';
import type { SilentIntervalAttribution } from '../../services/webcodecsExport/exportWorkerDiagnostics';
import { persistLivenessReport } from './autorunFlag';
import { generatePartCFixture, slicePartCFixture, PART_C_FPS } from './generatePartCFixture';
import { runProductionExport, type Round6ExportRow } from './runRound6';

export interface PartCRunReport extends Round6ExportRow {
  openAtEnd: number | null;
  silentIntervalsOver5s: SilentIntervalAttribution[];
  expectedFrames: number;
}

export async function runPartC500(): Promise<PartCRunReport> {
  setWebCodecsExportToggle(true);
  setFrameContentDigestEnabled(false);
  const fixture = await generatePartCFixture();
  persistLivenessReport('part-c-500-predicted', {
    segmentCount: fixture.segmentCount,
    uniqueVideoAssets: fixture.uniqueVideoAssets,
    timelineDurationSec: fixture.timelineDurationSec,
    predicted: fixture.predicted,
    transitionCycle: fixture.transitionCycle,
    animationCycle: fixture.animationCycle,
  });

  const expectedFrames = Math.round(fixture.timelineDurationSec * PART_C_FPS);
  const row = await runProductionExport(
    'part-c-500',
    fixture.project,
    { fps: PART_C_FPS, width: 1920, height: 1080, savePath: '/tmp/ws3-part-c-500.mp4' },
    false,
  );

  const gl = lastWebCodecsRunDiagnostics?.glPieces[0] ?? null;
  const silentIntervalsOver5s = (gl?.silentIntervals ?? []).filter((s) => s.durationMs > 5000);

  const report: PartCRunReport = {
    ...row,
    openAtEnd: row.openCursors,
    silentIntervalsOver5s,
    expectedFrames,
  };
  persistLivenessReport('part-c-500-report', report);
  return report;
}

export interface PartCDigestReproReport {
  runA: string | null;
  runB: string | null;
  framesA: number | null;
  framesB: number | null;
  reproducible: boolean;
}

export async function runPartCDigestRepro40s(): Promise<PartCDigestReproReport> {
  setWebCodecsExportToggle(true);
  setFrameContentDigestEnabled(true);
  const fixture = await generatePartCFixture();
  // ~40s slice: 100 segments at the same 0.4s/segment grid as the 500-segment fixture.
  const sliced = slicePartCFixture(fixture.project, 100, 40, PART_C_FPS);

  const rowA = await runProductionExport(
    'part-c-digest-a',
    sliced,
    { fps: PART_C_FPS, width: 1920, height: 1080, savePath: '/tmp/ws3-part-c-digest-a.mp4' },
    false,
  );
  const rowB = await runProductionExport(
    'part-c-digest-b',
    sliced,
    { fps: PART_C_FPS, width: 1920, height: 1080, savePath: '/tmp/ws3-part-c-digest-b.mp4' },
    false,
  );

  const report: PartCDigestReproReport = {
    runA: rowA.frameContentDigest,
    runB: rowB.frameContentDigest,
    framesA: rowA.frameContentDigestFrames,
    framesB: rowB.frameContentDigestFrames,
    reproducible:
      rowA.resultOk && rowB.resultOk && !!rowA.frameContentDigest && rowA.frameContentDigest === rowB.frameContentDigest,
  };
  persistLivenessReport('part-c-digest-repro-40s', report);
  return report;
}
