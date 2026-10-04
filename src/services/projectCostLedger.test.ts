import { describe, expect, it } from 'vitest';
import { ProjectCostLedger, summarizeLedger } from './projectCostLedger';

const RATE = (0.59 + 0.0473 * 2 + 0.008 * 8) / 3600;
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const make = (storage = mem(), deleted = new Set<string>()) => ({ storage, ledger: new ProjectCostLedger({ storage, usdPerSec: RATE, isDeleted: id => deleted.has(id), now: () => 1 }) });

describe('project cost ledger', () => {
  it('retry: attempt 2 adds, attempt 1 transcription kept, cached marker is $0', () => {
    const { ledger } = make();
    ledger.noteStage({ ownerId: 'p', stage: 'transcribe', workerSec: 24, cached: false, handedOff: false, jobId: 'a' });
    ledger.settleAttempt('p', 100, 24);
    ledger.noteStage({ ownerId: 'p', stage: 'transcribe', workerSec: 0, cached: true, handedOff: false });
    ledger.noteStage({ ownerId: 'p', stage: 'align', workerSec: 35.6, cached: false, handedOff: false, jobId: 'b' });
    ledger.settleAttempt('p', 200, 35.6);
    ledger.noteTimeline('p', 4.2);
    const s = summarizeLedger(ledger.get('p'), [{ at: 100, workerSec: 24 }, { at: 200, workerSec: 35.6 }], RATE);
    const by = Object.fromEntries(s.stages.map(x => [x.stage, x]));
    expect(by.transcription!.usd).toBeCloseTo(24 * RATE, 6);
    expect(by.transcription!.attempts.map(a => a.cached)).toEqual([false, true]);
    expect(by.alignment!.usd).toBeCloseTo(35.6 * RATE, 6);
    expect(by.timeline!.usd).toBe(0);
    expect(s.totalUsd).toBeCloseTo(59.6 * RATE, 6);
    expect(s.legacy).toEqual([]);
  });
  it('failed stage seconds land in Other, never dropped', () => {
    const { ledger } = make();
    ledger.noteStage({ ownerId: 'p', stage: 'transcribe', workerSec: 10, cached: false, handedOff: true });
    ledger.settleAttempt('p', 5, 30);
    const s = summarizeLedger(ledger.get('p'), [{ at: 5, workerSec: 30 }], RATE);
    expect(s.stages.find(x => x.stage === 'other')!.sec).toBeCloseTo(20);
    expect(s.totalSec).toBeCloseTo(30);
  });
  it('old records without a ledger show sum-only legacy attempts', () => {
    const s = summarizeLedger(undefined, [{ at: 1, workerSec: 10 }], RATE);
    expect(s.legacy).toHaveLength(1);
    expect(s.stages.every(x => !x.ran)).toBe(true);
    expect(s.totalUsd).toBeCloseTo(10 * RATE, 6);
  });
  it('persists, honors tombstones, and goes with a delete', () => {
    const deleted = new Set<string>();
    const { storage, ledger } = make(mem(), deleted);
    ledger.noteTimeline('p', 1);
    expect(new ProjectCostLedger({ storage, usdPerSec: RATE }).get('p')?.entries).toHaveLength(1);
    deleted.add('p'); ledger.forget('p'); ledger.noteTimeline('p', 1);
    expect(ledger.get('p')).toBeUndefined();
  });
});
