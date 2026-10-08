// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { TransitionType, AnimationType } from '../types';
import type { Asset, VideoSegment } from '../types';
import { useExportMediaGate } from './useExportMediaGate';

const seg = (n: number, assetId?: string): VideoSegment => ({
  id: `s${n}`, text: '', startTime: n, duration: 1, transition: TransitionType.NONE,
  animation: AnimationType.NONE, order: n, assetId,
});
const asset = (id: string, over: Partial<Asset> = {}): Asset =>
  ({ id, name: id, url: `blob:${id}`, type: 'image', ...over }) as Asset;

type Payload = { kind: 'settings' } | { kind: 'resume'; sessionId: string };

function setup(segments: VideoSegment[], assets: Asset[]) {
  const onProceed = vi.fn<(p: Payload) => void>();
  let api!: ReturnType<typeof useExportMediaGate<Payload>>;
  function Probe(): null {
    api = useExportMediaGate<Payload>(segments, assets, onProceed);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<Probe />));
  return { onProceed, get api() { return api; }, root };
}

describe('useExportMediaGate', () => {
  it('proceeds immediately when every scene has usable media', () => {
    const t = setup([seg(0, 'a')], [asset('a')]);
    act(() => t.api.request({ kind: 'settings' }));
    expect(t.onProceed).toHaveBeenCalledWith({ kind: 'settings' });
    expect(t.api.issues).toBeNull();
  });

  it('RESUME path shows the same card instead of proceeding; Continue then proceeds with the resume payload', () => {
    const t = setup([seg(0, 'a'), seg(1)], [asset('a')]);
    act(() => t.api.request({ kind: 'resume', sessionId: 'sess-1' }));
    expect(t.onProceed).not.toHaveBeenCalled();
    expect(t.api.issues?.none).toEqual([2]);
    act(() => t.api.confirm());
    expect(t.onProceed).toHaveBeenCalledWith({ kind: 'resume', sessionId: 'sess-1' });
    expect(t.api.issues).toBeNull();
  });

  it('Cancel drops the request without proceeding', () => {
    const t = setup([seg(0, 'gone')], []);
    act(() => t.api.request({ kind: 'resume', sessionId: 'x' }));
    expect(t.api.issues?.offline).toEqual([1]);
    act(() => t.api.cancel());
    expect(t.onProceed).not.toHaveBeenCalled();
    expect(t.api.issues).toBeNull();
    // Closing (X / Escape) after a dismissed card must leave nothing pending to confirm.
    act(() => t.api.confirm());
    expect(t.onProceed).not.toHaveBeenCalled();
  });
});
