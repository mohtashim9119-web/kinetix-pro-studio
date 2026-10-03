import { describe, expect, it, beforeEach } from 'vitest';
import {
  bulkRowBar, groupAllBuilt, resetBulkBarPeaksForTests, tickBarFill,
  STAGE_END, SETTLE_MS, transcribeDurationMs, shouldAnimateBulkBar,
} from './bulkRowProgress';
import { shortLogTitle } from './bulkLogTitle';

beforeEach(() => resetBulkBarPeaksForTests());

describe('bulk row progress bar (cloud+timeline only)', () => {
  it('staging / idle stays 0% with label Staged', () => {
    const a = bulkRowBar({ rowId: 'r1' });
    const b = bulkRowBar({ rowId: 'r1', queuePhase: 'Adding 3 of 4…' });
    const c = bulkRowBar({ rowId: 'r1', queuePhase: 'Voiceover uploaded to the cloud' });
    expect(a).toMatchObject({ target: 0, label: 'Staged', kind: 'idle' });
    expect(tickBarFill('r1', b, 0, 0)).toBe(0);
    expect(c.label).toBe('Staged');
  });

  it('one continuous fill per stage — job percent ticks coalesce onto the same target', () => {
    const dur = 600;
    const a = bulkRowBar({ rowId: 'r', phase: 'cloud', queuePhase: 'Transcribing on the cloud… 10%', durationSec: dur });
    const b = bulkRowBar({ rowId: 'r', phase: 'cloud', queuePhase: 'Transcribing on the cloud… 80%', durationSec: dur });
    expect(a.target).toBe(b.target);
    expect(a.target).toBe(STAGE_END.transcribe - 1);
    expect(a.durationMs).toBe(b.durationMs);
    expect(a.durationMs).toBe(transcribeDurationMs(dur));

    let fill = 0;
    fill = tickBarFill('coalesce', a, 0, fill);
    const afterFirst = fill;
    fill = tickBarFill('coalesce', b, 50, fill);
    fill = tickBarFill('coalesce', b, 80, fill);
    fill = tickBarFill('coalesce', b, 120, fill);
    expect(fill).toBeGreaterThanOrEqual(afterFirst);
    expect(fill).toBeLessThan(STAGE_END.transcribe);
    expect(fill).not.toBe(80);
    expect(fill).not.toBe(10);
  });

  it('lands on the stage mark exactly when the stage completes', () => {
    const trans = bulkRowBar({
      rowId: 'r', phase: 'cloud', queuePhase: 'Transcribing on the cloud…', durationSec: 330,
    });
    let fill = 0;
    fill = tickBarFill('land', trans, 0, fill);
    fill = tickBarFill('land', trans, trans.durationMs!, fill);
    expect(fill).toBeCloseTo(STAGE_END.transcribe - 1, 0);

    const align = bulkRowBar({
      rowId: 'r', phase: 'cloud', checkpoint: 'transcript-cached',
      queuePhase: 'Aligning on the cloud…', durationSec: 330,
    });
    const t1 = trans.durationMs! + 1;
    fill = tickBarFill('land', align, t1, fill);
    fill = tickBarFill('land', align, t1 + SETTLE_MS, fill);
    expect(fill).toBeCloseTo(STAGE_END.transcribe, 0);

    fill = tickBarFill('land', align, t1 + SETTLE_MS + align.durationMs!, fill);
    expect(fill).toBeCloseTo(STAGE_END.align - 1, 0);

    const build = bulkRowBar({ rowId: 'r', phase: 'finishing', checkpoint: 'aligned' });
    const t2 = t1 + SETTLE_MS + (align.durationMs ?? 0) + 1;
    fill = tickBarFill('land', build, t2, fill);
    fill = tickBarFill('land', build, t2 + SETTLE_MS, fill);
    expect(fill).toBeCloseTo(STAGE_END.align, 0);

    const ready = bulkRowBar({ rowId: 'r', phase: 'done', checkpoint: 'ready' });
    expect(ready.kind).toBe('hold');
    expect(ready.target).toBe(100);
    fill = tickBarFill('land', ready, t2 + SETTLE_MS + 1, fill);
    expect(fill).toBe(100);
  });

  it('indeterminate cloud work animates without a number', () => {
    const v = bulkRowBar({ rowId: 'r', phase: 'cloud', queuePhase: 'Transcribing on the cloud…' });
    expect(v.kind).toBe('indeterminate');
    expect(v.percentVisible).toBe(false);
    expect(v.glowing).toBe(true);
  });

  it('one pass: retry resumes from the checkpoint, never resets to 0', () => {
    const mid = bulkRowBar({
      rowId: 'r', phase: 'cloud', checkpoint: 'transcript-cached',
      queuePhase: 'Aligning on the cloud… 10%', durationSec: 120,
    });
    expect(mid.start).toBe(STAGE_END.transcribe);
    let fill = tickBarFill('retry', mid, 0, 42);
    fill = tickBarFill('retry', mid, 200, fill);
    expect(fill).toBeGreaterThanOrEqual(42);
    const failed = bulkRowBar({ rowId: 'r', phase: 'failed', checkpoint: 'transcript-cached' });
    fill = tickBarFill('retry', failed, 400, fill);
    expect(fill).toBeGreaterThan(0);
    expect(failed.label).toBe('Failed — Retry');
    const retry = bulkRowBar({
      rowId: 'r', phase: 'cloud', checkpoint: 'transcript-cached',
      queuePhase: 'Aligning on the cloud…', durationSec: 120,
    });
    const before = fill;
    fill = tickBarFill('retry', retry, 500, fill);
    expect(fill).toBeGreaterThanOrEqual(before);
    expect(fill).toBeGreaterThan(0);
  });

  it('a new content key restarts the row at 0', () => {
    const old = bulkRowBar({ rowId: 'r', contentKey: 'a', phase: 'cloud', checkpoint: 'aligned' });
    tickBarFill('r|a', old, 0, 80);
    const fresh = bulkRowBar({ rowId: 'r', contentKey: 'b', phase: 'queued', durationSec: 60 });
    expect(fresh.start).toBe(0);
    expect(tickBarFill('r|b', fresh, 0, 0)).toBe(0);
  });

  it('a finished row paints at 100 immediately — no 75→100 replay', () => {
    const ready = bulkRowBar({ rowId: 'r', phase: 'done', checkpoint: 'ready' });
    expect(ready.kind).toBe('hold');
    expect(tickBarFill('done-reload', ready, 0, 0)).toBe(100);
    expect(tickBarFill('done-reload', ready, 500, 100)).toBe(100);
  });

  it('paused / cancelled labels match the operator spec', () => {
    expect(bulkRowBar({ rowId: 'r', phase: 'paused' }).label).toBe('Paused — open project to answer');
    expect(bulkRowBar({ rowId: 'r', phase: 'cancelled' }).label).toBe('Cancelled');
  });

  it('H1: three queued rows — only the running item is Transcribing; the other two are static Waiting', () => {
    const waitingA = bulkRowBar({ rowId: 'a', phase: 'queued', queueStatus: 'queued', durationSec: 60 });
    const waitingB = bulkRowBar({ rowId: 'b', phase: 'queued', queueStatus: 'queued', durationSec: 60 });
    const running = bulkRowBar({
      rowId: 'c', phase: 'cloud', queueStatus: 'running',
      queuePhase: 'Transcribing on the cloud…', durationSec: 60,
    });
    expect(waitingA).toMatchObject({ label: 'Waiting', glowing: false, kind: 'hold' });
    expect(waitingB).toMatchObject({ label: 'Waiting', glowing: false, kind: 'hold' });
    expect(running.label).toBe('Transcribing');
    expect(running.glowing).toBe(true);
    const fill0 = tickBarFill('wait-a', waitingA, 0, 0);
    const fill1 = tickBarFill('wait-a', waitingA, 5_000, fill0);
    expect(fill1).toBe(fill0);
  });

  it('H1: eased rAF is idle when the bar is static or the drawer is hidden', () => {
    const idle = bulkRowBar({ rowId: 'r' });
    expect(idle.kind).toBe('idle');
    expect(shouldAnimateBulkBar(idle, false)).toBe(false);
    const waiting = bulkRowBar({ rowId: 'r', phase: 'queued', queueStatus: 'queued' });
    expect(shouldAnimateBulkBar(waiting, false)).toBe(false);
    expect(shouldAnimateBulkBar(waiting, true)).toBe(false);
    const running = bulkRowBar({
      rowId: 'r', phase: 'cloud', queueStatus: 'running',
      queuePhase: 'Transcribing on the cloud…', durationSec: 30,
    });
    expect(shouldAnimateBulkBar(running, false)).toBe(true);
    expect(shouldAnimateBulkBar(running, true)).toBe(false);
  });

  it('group sound fires only when every row is built', () => {
    expect(groupAllBuilt(['done', 'done'])).toBe(true);
    expect(groupAllBuilt(['done', 'failed'])).toBe(false);
    expect(groupAllBuilt(['done', 'paused'])).toBe(false);
    expect(groupAllBuilt(['done', 'cancelled'])).toBe(false);
    expect(groupAllBuilt([])).toBe(false);
  });
});

describe('log-title truncation', () => {
  it('short logs stay as-is', () => {
    expect(shortLogTitle('Ready')).toEqual({ title: 'Ready', truncated: false });
    expect(shortLogTitle('Cancelled — Retry')).toEqual({ title: 'Cancelled — Retry', truncated: false });
  });

  it('long messages get a fitted short title', () => {
    const paused = shortLogTitle('Paused — CUDA OOM on worker-7: device-side assert while running inference');
    expect(paused.truncated).toBe(true);
    expect(paused.title).toBe('Paused — inference');
    expect(paused.title.length).toBeLessThanOrEqual(28);
    const fail = shortLogTitle('Failed — Retry — The cloud job failed (worker-error). CUDA OOM on worker-7: device-side assert');
    expect(fail.title).toBe('Failed — Retry');
    const up = shortLogTitle('Upload failed because the voiceover could not be encoded for the cloud worker');
    expect(up.title).toBe('Upload failed');
  });
});
