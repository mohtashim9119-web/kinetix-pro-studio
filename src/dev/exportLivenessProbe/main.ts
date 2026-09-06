/**
 * THROWAWAY — Round 2 measurement harness (Part 1 tick probe + Part 2 fixture
 * predict + Part 3 live export when inside Tauri). Not imported by production.
 */

import { generateGlWatchdogFixture } from './generateGlWatchdogFixture';
import { runLiveExport } from './runLiveExport';
import { isTauri } from '../../services/tauriFfmpeg';
import { runTickProbe } from './runTickProbe';

const EXFIL_URL = 'http://127.0.0.1:8799/result';

function log(msg: string): void {
  const el = document.getElementById('log');
  if (el) el.textContent += '\n' + msg;
  // eslint-disable-next-line no-console
  console.info('[ws3-liveness]', msg);
}

async function exfil(tag: string, payload: unknown): Promise<void> {
  try {
    await fetch(EXFIL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ tag, payload, ts: Date.now() }),
      mode: 'cors',
      keepalive: true,
    });
  } catch {
    log('exfil POST failed (listener may be down)');
  }
}

async function runPart2(): Promise<void> {
  log('Part 2 — generating GL watchdog fixture…');
  const fixture = await generateGlWatchdogFixture();
  log(`  segments=${fixture.segmentCount} uniqueVideos=${fixture.uniqueVideoAssets} timeline=${fixture.timelineDurationSec}s`);
  log(`  GL-forcing: ${fixture.glForcingField}`);
  log(`  predicted segments: ${JSON.stringify(fixture.predicted.segmentCounts)}`);
  log(`  predicted pieces: ${JSON.stringify(fixture.predicted.pieceCounts)}`);
  await exfil('part2', {
    segmentCount: fixture.segmentCount,
    uniqueVideoAssets: fixture.uniqueVideoAssets,
    timelineDurationSec: fixture.timelineDurationSec,
    predicted: fixture.predicted,
    glForcingField: fixture.glForcingField,
  });
}

async function main(): Promise<void> {
  const el = document.getElementById('log');
  if (el) el.textContent = '';
  log(`WS3 export-liveness Round 2 harness  tauri=${isTauri()}  UA=${navigator.userAgent}`);
  log('Part 1 — tick probe…');
  const part1 = await runTickProbe();
  for (const r of part1.demux) {
    log(
      `  DEMUX ${r.label}: ${r.bytes} B  fetch=${r.fetchMs.toFixed(1)}ms  parse=${r.parseMs.toFixed(1)}ms  ` +
      `ticksFetch=${r.ticksDuringFetch}  ticksParse=${r.ticksDuringParse}`,
    );
  }
  log(
    `  GL compositor compile=${part1.gl.compositorCompileMs.toFixed(1)}ms ticks=${part1.gl.compositorTicks}  ` +
    `textCtor=${part1.gl.textCtorMs.toFixed(1)}ms ticks=${part1.gl.textCtorTicks}  ` +
    `textInit=${part1.gl.textInitMs.toFixed(1)}ms ticks=${part1.gl.textInitTicks}`,
  );
  log(
    part1.parseExceeds30sBytes === null
      ? '  parse-vs-size slope <= 0 — cannot extrapolate a 30s file size'
      : `  extrapolated source size for parse>30s: ${(part1.parseExceeds30sBytes / 1e6).toFixed(1)} MB`,
  );
  await runPart2();
  if (isTauri()) {
    log('Part 3 — live WebCodecs export (toggle forced ON)…');
    const live = await runLiveExport();
    log(`  ok=${live.resultOk} watchdog=${live.watchdogString} elapsedMs=${live.elapsedMs.toFixed(0)}`);
    log(`  error=${live.errorMessage}`);
    log(`  actual=${JSON.stringify(live.actual)}`);
  } else {
    log('Part 3 skipped — not Tauri. Use autorun from tauri:dev for the live export.');
    await exfil('part3-skipped', { reason: 'not-tauri', part1 });
  }
  log('DONE');
}

const rerun = document.getElementById('rerun');
if (rerun) rerun.addEventListener('click', () => { void main(); });
void main();
