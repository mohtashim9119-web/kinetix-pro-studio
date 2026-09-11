/**
 * WS3 STEP 8 (C6) — the durable ledger `TauriFfmpeg.destroy()` and
 * `muxOnly.ts`'s premux cleanup feed. Pure roundtrip + bound tests; the
 * callers that actually populate it are pinned in `muxOnly.test.ts`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  recordCleanupFailure,
  readCleanupNotices,
  clearCleanupNotices,
  CLEANUP_NOTICE_CAP,
} from './exportCleanupNotices';

function installLocalStorage(): void {
  const backing = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
    setItem: (k: string, v: string) => backing.set(k, String(v)),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: (i: number) => [...backing.keys()][i] ?? null,
    get length() {
      return backing.size;
    },
  } as Storage);
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('exportCleanupNotices', () => {
  it('records and reads back a notice', () => {
    installLocalStorage();
    clearCleanupNotices();
    recordCleanupFailure('session-destroy', 'sess-1', 'ENOENT: directory gone', 1_000);
    const notices = readCleanupNotices();
    expect(notices).toEqual([
      { kind: 'session-destroy', sessionId: 'sess-1', detail: 'ENOENT: directory gone', atMs: 1_000 },
    ]);
  });

  it('clearCleanupNotices empties the ledger', () => {
    installLocalStorage();
    recordCleanupFailure('premux-intermediate', 'sess-2', 'busy', 2_000);
    expect(readCleanupNotices().length).toBeGreaterThan(0);
    clearCleanupNotices();
    expect(readCleanupNotices()).toEqual([]);
  });

  it('is a bounded ring — never grows past CLEANUP_NOTICE_CAP, oldest dropped first', () => {
    installLocalStorage();
    clearCleanupNotices();
    for (let i = 0; i < CLEANUP_NOTICE_CAP + 5; i++) {
      recordCleanupFailure('session-destroy', `sess-${i}`, 'detail', i);
    }
    const notices = readCleanupNotices();
    expect(notices).toHaveLength(CLEANUP_NOTICE_CAP);
    // Oldest 5 (sess-0..sess-4) were dropped; the newest CLEANUP_NOTICE_CAP survive.
    expect(notices[0]!.sessionId).toBe('sess-5');
    expect(notices[notices.length - 1]!.sessionId).toBe(`sess-${CLEANUP_NOTICE_CAP + 4}`);
  });

  it('never throws when localStorage is absent (this file\'s default node test environment) — read returns empty, record is a silent no-op', () => {
    // Deliberately NOT calling installLocalStorage() — this is the real
    // "no DOM" case recordCleanupFailure/readCleanupNotices must survive.
    expect(() => recordCleanupFailure('session-destroy', 'sess-x', 'detail')).not.toThrow();
    expect(readCleanupNotices()).toEqual([]);
  });

  it('never throws when localStorage.setItem itself throws (quota exceeded / private-window)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new DOMException('QuotaExceededError'); },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage);
    expect(() => recordCleanupFailure('session-destroy', 'sess-y', 'detail')).not.toThrow();
  });
});
