/**
 * THROWAWAY — Round 2 live WebCodecs export of the GL watchdog fixture.
 * Not imported by any production file. Tree-shaken out of the production
 * bundle because the only importer is behind `import.meta.env.DEV`.
 */

import { isTauri, TauriFfmpeg } from '../../services/tauriFfmpeg';
import {
  exportProjectWebCodecs,
  lastWebCodecsRunDiagnostics,
  planWebCodecsExport,
  type WebCodecsFfmpeg,
} from '../../services/webcodecsExport/exportPipelineWebCodecs';
import { setWebCodecsExportToggle } from '../../hooks/useExport';
import { generateGlWatchdogFixture, FIXTURE_FPS } from './generateGlWatchdogFixture';
import { persistLivenessReport } from './autorunFlag';

const SAVE_PATH = '/tmp/ws3-gl-watchdog-repro.mp4';

export interface LiveExportReport {
  tauri: boolean;
  predicted: ReturnType<typeof planWebCodecsExport>;
  actual: typeof lastWebCodecsRunDiagnostics;
  resultOk: boolean;
  errorMessage: string | null;
  errorCause: string | null;
  watchdogString: boolean;
  elapsedMs: number;
  savePath: string;
  segmentCount: number;
  uniqueVideoAssets: number;
  timelineDurationSec: number;
  glForcingField: string;
}

async function exfil(tag: string, payload: unknown): Promise<void> {
  persistLivenessReport(tag, payload);
}

export async function runLiveExport(): Promise<LiveExportReport> {
  setWebCodecsExportToggle(true);
  const fixture = await generateGlWatchdogFixture();
  const predicted = fixture.predicted;

  if (!isTauri()) {
    const report: LiveExportReport = {
      tauri: false,
      predicted,
      actual: null,
      resultOk: false,
      errorMessage: 'not running inside Tauri — ffmpeg sidecar unavailable',
      errorCause: null,
      watchdogString: false,
      elapsedMs: 0,
      savePath: SAVE_PATH,
      segmentCount: fixture.segmentCount,
      uniqueVideoAssets: fixture.uniqueVideoAssets,
      timelineDurationSec: fixture.timelineDurationSec,
      glForcingField: fixture.glForcingField,
    };
    await exfil('live-export-skipped', report);
    return report;
  }

  const ffmpeg = await TauriFfmpeg.create();
  persistLivenessReport('live-export-started', { t: Date.now(), predicted });
  const t0 = performance.now();
  let resultOk = false;
  let errorMessage: string | null = null;
  let errorCause: string | null = null;
  let watchdogString = false;
  let lastProgressAt = 0;
  try {
    const result = await exportProjectWebCodecs(
      fixture.project,
      ffmpeg as unknown as WebCodecsFfmpeg,
      { fps: FIXTURE_FPS, width: 1920, height: 1080, savePath: SAVE_PATH },
      (stage) => {
        const now = performance.now();
        if (now - lastProgressAt < 5000 && stage.type === 'encoding_segment') return;
        lastProgressAt = now;
        persistLivenessReport('live-export-progress', {
          t: Date.now(),
          elapsedMs: now - t0,
          stage,
        });
      },
    );
    resultOk = result.ok;
    if (!result.ok) {
      errorMessage = result.error.message;
      errorCause = result.error.cause ?? null;
      watchdogString = result.error.message.includes('no output for 30s');
    }
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  } finally {
    try { await ffmpeg.kill(); } catch { /* best-effort */ }
    try { await ffmpeg.destroy(); } catch { /* best-effort */ }
  }

  const report: LiveExportReport = {
    tauri: true,
    predicted,
    actual: lastWebCodecsRunDiagnostics,
    resultOk,
    errorMessage,
    errorCause,
    watchdogString,
    elapsedMs: performance.now() - t0,
    savePath: SAVE_PATH,
    segmentCount: fixture.segmentCount,
    uniqueVideoAssets: fixture.uniqueVideoAssets,
    timelineDurationSec: fixture.timelineDurationSec,
    glForcingField: fixture.glForcingField,
  };
  // eslint-disable-next-line no-console
  console.info('[ws3-liveness] live-export report', JSON.stringify(report));
  await exfil('live-export', report);
  return report;
}
