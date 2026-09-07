import { describe, expect, it, vi, beforeEach } from 'vitest';

function mockLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  });
}

import {
  buildPreviewDiagnosticsSnapshot,
  previewDiagnosticsActive,
  recordChunkDecoded,
  recordDecoderOutput,
  recordFramePresented,
  recordPreviewDiagnosticsError,
  recordRafTick,
  recordSelectionChange,
  resetPreviewDiagnosticsState,
  serializeVideoDecoderConfig,
  sessionCountersFor,
  setPreviewDiagnosticsEnabled,
  syncPreviewDiagnosticsEnabled,
} from './previewDiagnostics';

describe('previewDiagnostics', () => {
  beforeEach(() => {
    mockLocalStorage();
    setPreviewDiagnosticsEnabled(false);
    resetPreviewDiagnosticsState();
  });

  it('is inactive by default', () => {
    syncPreviewDiagnosticsEnabled();
    expect(previewDiagnosticsActive()).toBe(false);
  });

  it('activates from localStorage toggle', () => {
    setPreviewDiagnosticsEnabled(true);
    expect(previewDiagnosticsActive()).toBe(true);
  });

  it('records configure, decode counters, presentation, and selection when active', async () => {
    setPreviewDiagnosticsEnabled(true);
    const session = sessionCountersFor('seg-1', 'blob:abc', 120);
    recordChunkDecoded(session);
    recordDecoderOutput(session, true, 0.008333);
    recordDecoderOutput(session, false, 0.016666);
    recordFramePresented(session, 0.5, 0.491666);
    recordRafTick(0.5);
    recordRafTick(0.516);
    recordSelectionChange({
      selectedSegmentId: 'seg-1',
      activeAssetId: 'asset-1',
      mediaType: 'video',
      compositorBoundAssetId: 'asset-0',
      compositorBoundSegmentId: 'seg-0',
      textureRebound: false,
      requestedTimelineSec: 0.5,
      activeFrameTimestampSec: 0.491666,
    });
    recordPreviewDiagnosticsError(new DOMException('configure failed', 'NotSupportedError'));

    const snap = buildPreviewDiagnosticsSnapshot(['control: 30fps pass after 120fps fail']);
    expect(snap.firstError?.name).toBe('NotSupportedError');
    expect(snap.sessions).toHaveLength(1);
    expect(snap.sessions[0]).toMatchObject({
      segmentId: 'seg-1',
      sourceFps: 120,
      chunksDecoded: 1,
      decoderOutputCallbacks: 2,
      framesAdmitted: 1,
      framesDropped: 1,
      framesPresented: 1,
    });
    expect(snap.selectionEvents).toHaveLength(1);
    expect(snap.selectionEvents[0]?.textureRebound).toBe(false);
    expect(snap.notes[0]).toContain('30fps');
  });

  it('serializeVideoDecoderConfig copies verbatim fields', () => {
    const desc = new Uint8Array([1, 2, 3]);
    const out = serializeVideoDecoderConfig({
      codec: 'avc1.640028',
      codedWidth: 1920,
      codedHeight: 1080,
      description: desc,
      hardwareAcceleration: 'prefer-hardware',
      optimizeForLatency: true,
    });
    expect(out).toEqual({
      codec: 'avc1.640028',
      codedWidth: 1920,
      codedHeight: 1080,
      descriptionBytes: 3,
      hardwareAcceleration: 'prefer-hardware',
      optimizeForLatency: true,
    });
  });

  it('does not mutate counters when inactive', () => {
    const session = sessionCountersFor('seg-x', 'blob:x', 30);
    recordChunkDecoded(session);
    recordDecoderOutput(session, true, 0);
    const snap = buildPreviewDiagnosticsSnapshot();
    expect(snap.sessions).toHaveLength(0);
  });

  it('copyPreviewDiagnosticsToClipboard writes JSON', async () => {
    setPreviewDiagnosticsEnabled(true);
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: write }, userAgent: 'test-ua' });

    const { copyPreviewDiagnosticsToClipboard } = await import('./previewDiagnostics');
    const ok = await copyPreviewDiagnosticsToClipboard(['round-trip']);
    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(write.mock.calls[0]![0] as string);
    expect(parsed.enabled).toBe(true);
    expect(parsed.notes).toEqual(['round-trip']);
  });
});
