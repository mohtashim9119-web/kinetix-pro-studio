// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
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

describe('the ledger forgets a session the moment it is destroyed', () => {
  beforeEach(() => localStorage.clear());
  it('after many create/destroy cycles there are no dead rows, and no live row is evicted', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { TauriFfmpeg } = await import('../tauriFfmpeg');
    const { exportSessionProjectId } = await import('./exportSessionLedger');
    let n = 0;
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'ffmpeg_create_session') return `dead-${n++}`;
      if (cmd === 'ffmpeg_destroy_session') return { disposition: 'destroyed' };
      if (cmd === 'ffmpeg_take_durability_warnings') return [];
      return undefined;
    });
    recordExportSessionCreated('live-checkpoint', 1, 'P');
    for (let i = 0; i < 100; i++) {
      const s = await TauriFfmpeg.create();
      recordExportSessionCreated(s.sessionId, 1_000 + i, 'P');
      await s.destroy({ force: false });
    }
    const rows = JSON.parse(localStorage.getItem('kinetix:exportSessions:v1') ?? '{}') as Record<string, unknown>;
    expect(Object.keys(rows)).toEqual(['live-checkpoint']);
    expect(exportSessionProjectId('live-checkpoint')).toBe('P');
  });

  it('a destroy the manifest guard refused keeps the row — the folder is still there', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { TauriFfmpeg } = await import('../tauriFfmpeg');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'ffmpeg_create_session') return 'kept';
      if (cmd === 'ffmpeg_destroy_session') return { disposition: 'refused_manifest' };
      if (cmd === 'ffmpeg_take_durability_warnings') return [];
      return undefined;
    });
    const s = await TauriFfmpeg.create();
    recordExportSessionCreated('kept', 5, 'P');
    await s.destroy({ force: false });
    expect(exportSessionCreatedAt('kept')).toBe(5);
  });
});
