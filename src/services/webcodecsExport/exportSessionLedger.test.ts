// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  exportSessionCreatedAt,
  forgetExportSession,
  recordExportSessionCreated,
} from './exportSessionLedger';

describe('export session ledger', () => {
  beforeEach(() => localStorage.clear());

  it('records and reads back a creation time', () => {
    recordExportSessionCreated('s1', 1_000);
    expect(exportSessionCreatedAt('s1')).toBe(1_000);
  });

  it('returns null for an unknown session — the "treat as oldest" input', () => {
    expect(exportSessionCreatedAt('never-seen')).toBeNull();
  });

  it('forgets a session', () => {
    recordExportSessionCreated('s1', 1_000);
    forgetExportSession('s1');
    expect(exportSessionCreatedAt('s1')).toBeNull();
  });

  it('keeps only the newest rows, so the ledger cannot grow without bound', () => {
    for (let i = 0; i < 100; i++) recordExportSessionCreated(`s${i}`, i);
    expect(exportSessionCreatedAt('s99')).toBe(99);
    expect(exportSessionCreatedAt('s0')).toBeNull();
  });

  it('survives corrupt storage without throwing', () => {
    localStorage.setItem('kinetix:exportSessions:v1', '{ not json');
    expect(exportSessionCreatedAt('s1')).toBeNull();
    recordExportSessionCreated('s1', 5);
    expect(exportSessionCreatedAt('s1')).toBe(5);
  });
});
