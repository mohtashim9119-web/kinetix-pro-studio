// @vitest-environment jsdom
/**
 * D8 (Round 28) — pins `logExportEvent`'s contract: no-op outside Tauri,
 * calls the native `export_log_event` command with the right shape when
 * inside Tauri, and never throws even when the native call rejects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockIsTauri = vi.fn();
vi.mock('./tauriFfmpeg', () => ({
  isTauri: () => mockIsTauri(),
}));

describe('logExportEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op outside Tauri — never calls invoke', () => {
    mockIsTauri.mockReturnValue(false);
    return import('./exportDiagnosticLog').then(({ logExportEvent }) => {
      logExportEvent('init', 'resolution=1080p bitrate=8000kbps');
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  it('calls export_log_event with phase/detail/level inside Tauri, defaulting level to info', async () => {
    mockIsTauri.mockReturnValue(true);
    mockInvoke.mockResolvedValue(undefined);
    const { logExportEvent } = await import('./exportDiagnosticLog');
    logExportEvent('init', 'resolution=1080p bitrate=8000kbps');
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledWith('export_log_event', {
      phase: 'init',
      detail: 'resolution=1080p bitrate=8000kbps',
      level: 'info',
    });
  });

  it('passes through an explicit level (e.g. disk-full as warn)', async () => {
    mockIsTauri.mockReturnValue(true);
    mockInvoke.mockResolvedValue(undefined);
    const { logExportEvent } = await import('./exportDiagnosticLog');
    logExportEvent('disk-full', 'shortfallBytes=1024', 'warn');
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenCalledWith('export_log_event', {
      phase: 'disk-full',
      detail: 'shortfallBytes=1024',
      level: 'warn',
    });
  });

  it('never throws when the native call rejects', async () => {
    mockIsTauri.mockReturnValue(true);
    mockInvoke.mockRejectedValue(new Error('IPC boom'));
    const { logExportEvent } = await import('./exportDiagnosticLog');
    expect(() => logExportEvent('cancelled', 'user-initiated')).not.toThrow();
    // Let the rejected promise's .catch() run before the test ends.
    await Promise.resolve();
    await Promise.resolve();
  });
});
