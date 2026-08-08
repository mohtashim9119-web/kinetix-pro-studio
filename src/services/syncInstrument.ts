// syncInstrument.ts — diagnostic instrumentation for the Apply-Sync freeze
// audit. KEPT (owner ruling, cleanup run 2026-08-08) — not abandoned; see the
// revisit condition below.
//
// Gated on globalThis.__SYNC_INSTRUMENT__, dormant by default (mirrors the
// __WF_INSTRUMENT__ / __ALIGN_INSTRUMENT__ convention in SegmentWaveform.tsx /
// whisperService.ts): zero effect on normal runs. When enabled, syncMark()
// records a labelled timestamp and logs the delta from the previous mark, so
// the Apply-Sync → parse → align → commit → paint → Timeline-decode sequence
// can be attributed stage-by-stage ACROSS the async boundary — App.tsx's sync
// handler AND Timeline.tsx's post-commit waveform-decode effect share one flag
// and one mark list.
//
// Usage (devtools console):
//   globalThis.__SYNC_INSTRUMENT__ = true   // then click Apply Sync
//   globalThis.__syncDump()                 // after the timeline settles
//
// Call sites [MEASURED, cleanup run 2026-08-08]: 14 total — 11 in App.tsx
// (waveform-mirror/build/commit marks plus the applySync:entry..first-paint
// span) and 3 in services/waveformPipeline.ts (arrayBuffer-ready,
// decodeAudioData-done, source-done). This file's own header previously
// claimed "two call sites" — stale since whichever pass wired the waveform-
// build marks in; count both here and in this file if it drifts again.
//
// Revisit condition: this file predates a confirmable "audit closed" signal
// — nothing in the repo records whether the Apply-Sync freeze investigation
// it was built for is done. Do not delete on a guess. Remove this file and
// all 14 call sites together, in one pass, only once the owner confirms that
// investigation is closed and this instrumentation is no longer needed to
// re-diagnose a freeze/perf regression in the Apply-Sync path.

interface SyncMark { label: string; t: number }

interface SyncInstrGlobal {
  __SYNC_INSTRUMENT__?: boolean;
  __syncMarks?: SyncMark[];
  __syncDump?: () => void;
}

export function syncInstrOn(): boolean {
  return (globalThis as unknown as SyncInstrGlobal).__SYNC_INSTRUMENT__ === true;
}

/**
 * Record a labelled timestamp and log its delta from the previous mark.
 * No-op unless globalThis.__SYNC_INSTRUMENT__ === true. Pass { reset: true } at
 * the start of a fresh Apply-Sync run to clear the previous run's marks.
 */
export function syncMark(label: string, opts?: { reset?: boolean }): void {
  if (!syncInstrOn()) return;
  const g = globalThis as unknown as SyncInstrGlobal;
  if (opts?.reset || !g.__syncMarks) g.__syncMarks = [];
  const marks = g.__syncMarks;
  const now = performance.now();
  const prev = marks.length ? marks[marks.length - 1]!.t : now;
  marks.push({ label, t: now });
  // eslint-disable-next-line no-console
  console.log('[sync-instr] %s  +%sms', label, (now - prev).toFixed(1));
  g.__syncDump ??= () => {
    const ms = g.__syncMarks ?? [];
    if (ms.length < 2) { console.log('[sync-instr] no marks captured'); return; }
    const total = ms[ms.length - 1]!.t - ms[0]!.t;
    // eslint-disable-next-line no-console
    console.log('[sync-instr] === summary (total %sms) ===', total.toFixed(1));
    for (let i = 1; i < ms.length; i++) {
      const d = ms[i]!.t - ms[i - 1]!.t;
      const pct = total > 0 ? (d / total) * 100 : 0;
      // eslint-disable-next-line no-console
      console.log('  %s → %s: %sms (%s%)', ms[i - 1]!.label, ms[i]!.label, d.toFixed(1), pct.toFixed(1));
    }
  };
}
