// syncInstrument.ts — TEMP diagnostic instrumentation (Apply-Sync freeze audit).
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
// Remove this file (and its two call sites) after the audit.

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
